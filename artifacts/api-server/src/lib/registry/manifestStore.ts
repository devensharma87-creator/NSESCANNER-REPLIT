/**
 * PHASE 0.6 — REGISTRY DURABILITY (L0 memory → L1 disk → L2 PostgreSQL)
 *
 * A restart or redeploy must not lose the registry, and must never silently
 * resurrect a manifest that was produced under a different schema or policy.
 *
 * The durable store is PostgreSQL. A generation is reported durable ONLY after
 * the transaction commits. A failed write preserves the previous durable
 * manifest and is never reported as success.
 *
 * EVERY read re-verifies the stored checksum before the manifest is allowed to
 * become active, so a truncated or hand-edited row is rejected rather than
 * trusted. Schema and policy versions are matched exactly, because a coverage
 * number computed under an old policy is not comparable to a new one.
 *
 * This mirrors the accepted `fullNseScanner` durability pattern deliberately:
 * transaction-scoped advisory lock, ON CONFLICT DO NOTHING on a unique
 * generation id, and bounded retention inside the same transaction.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../logger";
import { loadBlob, saveBlob } from "../diskCache";
import {
  CLASSIFICATION_POLICY_VERSION,
  MANIFEST_SCHEMA_VERSION,
  computeEligibleLiveSetHash,
  computeRecordSetHash,
  isManifestAccepted,
  verifyManifestChecksum,
  type InstrumentUniverseManifest,
} from "./universeManifest";
import type { RegistryRecord } from "./instrumentRegistry";

/** Transaction-scoped advisory lock. Distinct from 7312847 / 8274613. */
const REGISTRY_DB_ADVISORY_LOCK_KEY = 6413902;
/** Keep the last N generations, so a bad generation can be compared to a good one. */
const REGISTRY_DB_MAX_SNAPSHOTS = 3;
/** Disk (L1) blob name + version. A version bump discards incompatible blobs. */
const DISK_NAME = "instrument_universe_manifest";
const DISK_VERSION = 1;

/**
 * A generation below this record count indicates a truncated source or a test
 * artifact rather than a real universe (real generations carry ~9,700 records).
 * Matches the MIN=1000 durability floor used elsewhere in this codebase.
 */
export const MIN_RECORDS_FOR_COMMIT = 1000;

export interface RegistryGeneration {
  readonly manifest: InstrumentUniverseManifest;
  readonly records: readonly RegistryRecord[];
}

export type RegistryPersistenceResult =
  | {
      ok: true;
      durablyCommitted: true;
      durableStore: "POSTGRESQL";
      snapshotId: string;
      committedAt: string;
    }
  | {
      ok: true;
      durablyCommitted: false;
      /** Committed previously; this generation id already exists. */
      skippedReason: "DUPLICATE_GENERATION_ID";
    }
  | {
      ok: false;
      durablyCommitted: false;
      reasonCode: string;
      detail: string;
    };

/** Runtime counter for monitoring; a failed durable write is never invisible. */
export let registryPersistenceFailureCount = 0;

export function _resetRegistryPersistenceFailureCountForTest(): void {
  registryPersistenceFailureCount = 0;
}

let _schemaEnsured = false;

/**
 * Idempotent DDL. Declared in `lib/db/src/schema/runtimeTables.ts` so
 * drizzle-kit push produces a zero-diff no-op instead of scheduling a DROP.
 */
export async function ensureRegistrySchema(): Promise<void> {
  if (_schemaEnsured) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS instrument_universe_manifests (
      id                          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      saved_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      registry_generation_id      TEXT NOT NULL,
      manifest_version            INTEGER NOT NULL,
      generated_at                TIMESTAMPTZ NOT NULL,
      effective_date              DATE NOT NULL,
      schema_version              INTEGER NOT NULL,
      policy_version              INTEGER NOT NULL,
      manifest_checksum           TEXT NOT NULL,
      eligible_live_set_hash      TEXT NOT NULL,
      classification_policy_hash  TEXT NOT NULL,
      acceptance_status           TEXT NOT NULL,
      total_official_records      INTEGER NOT NULL,
      live_required_count         INTEGER NOT NULL,
      index_count                 INTEGER NOT NULL,
      unmapped_live_count         INTEGER NOT NULL,
      unresolved_count            INTEGER NOT NULL,
      record_count                INTEGER NOT NULL,
      manifest                    JSONB NOT NULL,
      records                     JSONB NOT NULL,
      CONSTRAINT instrument_universe_manifests_generation_id_key UNIQUE (registry_generation_id)
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS instrument_universe_manifests_generated_at_idx
      ON instrument_universe_manifests (generated_at DESC)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS instrument_universe_manifests_version_idx
      ON instrument_universe_manifests (schema_version, policy_version, acceptance_status, generated_at DESC)
  `);
  _schemaEnsured = true;
}

export function _resetSchemaEnsuredForTest(): void {
  _schemaEnsured = false;
}

/**
 * Pre-commit gates. A generation must be internally coherent BEFORE it touches
 * the database, so a rejected or corrupt manifest can never displace a good one.
 */
export function validateGenerationForCommit(gen: RegistryGeneration): string[] {
  const failures: string[] = [];
  const { manifest, records } = gen;

  if (!isManifestAccepted(manifest)) {
    failures.push(`manifest acceptanceStatus is ${manifest.acceptanceStatus} with ${manifest.blockers.length} blockers`);
  }
  if (!verifyManifestChecksum(manifest)) {
    failures.push("manifest checksum does not match its own content");
  }
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    failures.push(`manifest schemaVersion ${manifest.schemaVersion} != current ${MANIFEST_SCHEMA_VERSION}`);
  }
  if (manifest.policyVersion !== CLASSIFICATION_POLICY_VERSION) {
    failures.push(`manifest policyVersion ${manifest.policyVersion} != current ${CLASSIFICATION_POLICY_VERSION}`);
  }
  if (records.length < MIN_RECORDS_FOR_COMMIT) {
    failures.push(`record count ${records.length} is below the durability floor ${MIN_RECORDS_FOR_COMMIT}`);
  }
  // The manifest must describe THESE records, not some other generation's.
  const recomputed = computeEligibleLiveSetHash(records);
  if (recomputed !== manifest.eligibleLiveSetHash) {
    failures.push("eligibleLiveSetHash does not match the supplied records");
  }
  // Covers the whole set, including unmapped LIVE_REQUIRED rows that the
  // live-set hash cannot see.
  if (computeRecordSetHash(records) !== manifest.recordSetHash) {
    failures.push("recordSetHash does not match the supplied records");
  }
  if (records.length !== manifest.totalOfficialRecords + manifest.indexCount) {
    failures.push(
      `record count ${records.length} != manifest total ${manifest.totalOfficialRecords} + indices ${manifest.indexCount}`,
    );
  }
  for (const r of records) {
    if (r.registryGenerationId !== manifest.registryGenerationId) {
      failures.push("records contain a foreign registryGenerationId");
      break;
    }
  }
  return failures;
}

/** Persist a generation. L2 is authoritative; L0/L1 are only written after commit. */
export async function saveRegistryGeneration(
  gen: RegistryGeneration,
): Promise<RegistryPersistenceResult> {
  const failures = validateGenerationForCommit(gen);
  if (failures.length > 0) {
    registryPersistenceFailureCount++;
    logger.warn(
      {
        registryGenerationId: gen.manifest.registryGenerationId,
        failures,
        diagnosticEvent: "REGISTRY_PERSISTENCE_SKIPPED",
      },
      "Instrument registry: durable write skipped — pre-commit gates failed",
    );
    return {
      ok: false,
      durablyCommitted: false,
      reasonCode: "VALIDATION_GATES_FAILED",
      detail: failures.join(" | "),
    };
  }

  const { manifest, records } = gen;
  try {
    await ensureRegistrySchema();

    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${REGISTRY_DB_ADVISORY_LOCK_KEY})`);

      const inserted = await tx.execute(sql`
        INSERT INTO instrument_universe_manifests (
          registry_generation_id, manifest_version, generated_at, effective_date,
          schema_version, policy_version, manifest_checksum,
          eligible_live_set_hash, classification_policy_hash, acceptance_status,
          total_official_records, live_required_count, index_count,
          unmapped_live_count, unresolved_count, record_count, manifest, records
        ) VALUES (
          ${manifest.registryGenerationId}, ${manifest.manifestVersion},
          ${manifest.generatedAt}::timestamptz, ${manifest.effectiveDate}::date,
          ${manifest.schemaVersion}, ${manifest.policyVersion}, ${manifest.manifestChecksum},
          ${manifest.eligibleLiveSetHash}, ${manifest.classificationPolicyHash},
          ${manifest.acceptanceStatus},
          ${manifest.totalOfficialRecords}, ${manifest.tierCounts.LIVE_REQUIRED},
          ${manifest.indexCount}, ${manifest.unmappedLiveCount}, ${manifest.unresolvedCount},
          ${records.length},
          ${JSON.stringify(manifest)}::jsonb,
          ${JSON.stringify(records)}::jsonb
        )
        ON CONFLICT (registry_generation_id) DO NOTHING
        RETURNING id::text AS id, saved_at
      `);

      // Bounded retention inside the same transaction.
      await tx.execute(sql`
        DELETE FROM instrument_universe_manifests
        WHERE id NOT IN (
          SELECT id FROM instrument_universe_manifests
          ORDER BY generated_at DESC
          LIMIT ${REGISTRY_DB_MAX_SNAPSHOTS}
        )
      `);

      return (inserted.rows ?? []) as Array<{ id: string; saved_at: string | Date }>;
    });

    if (rows.length === 0) {
      logger.info(
        { registryGenerationId: manifest.registryGenerationId },
        "Instrument registry: generation already persisted (ON CONFLICT DO NOTHING)",
      );
      return { ok: true, durablyCommitted: false, skippedReason: "DUPLICATE_GENERATION_ID" };
    }

    const row = rows[0]!;
    const committedAt =
      typeof row.saved_at === "string" ? row.saved_at : new Date(row.saved_at).toISOString();

    // Only AFTER commit do the faster layers get to hold this generation.
    _memory = gen;
    try {
      saveBlob(DISK_NAME, DISK_VERSION, gen);
    } catch (err) {
      logger.warn({ err }, "Instrument registry: L1 disk write failed (non-fatal; L2 committed)");
    }

    logger.info(
      {
        registryGenerationId: manifest.registryGenerationId,
        snapshotId: row.id,
        committedAt,
        records: records.length,
        diagnosticEvent: "REGISTRY_PERSISTENCE_SUCCESS",
      },
      "Instrument registry: generation persisted to PostgreSQL (L2)",
    );
    return {
      ok: true,
      durablyCommitted: true,
      durableStore: "POSTGRESQL",
      snapshotId: row.id,
      committedAt,
    };
  } catch (err) {
    registryPersistenceFailureCount++;
    const detail = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    logger.warn(
      { err, detail, diagnosticEvent: "REGISTRY_PERSISTENCE_FAILURE" },
      "Instrument registry: durable write FAILED — previous durable manifest preserved",
    );
    return { ok: false, durablyCommitted: false, reasonCode: "DB_WRITE_FAILED", detail };
  }
}

let _memory: RegistryGeneration | null = null;

export function getActiveGeneration(): RegistryGeneration | null {
  return _memory;
}

export function _setActiveGenerationForTest(gen: RegistryGeneration | null): void {
  _memory = gen;
}

/**
 * Re-verify a candidate loaded from any durable layer. Shared by L1 and L2 so
 * disk and database are held to exactly the same bar.
 */
export function acceptLoadedGeneration(
  candidate: RegistryGeneration,
  origin: "L1_DISK" | "L2_POSTGRESQL",
): RegistryGeneration | null {
  const m = candidate.manifest;
  if (m.schemaVersion !== MANIFEST_SCHEMA_VERSION || m.policyVersion !== CLASSIFICATION_POLICY_VERSION) {
    logger.warn(
      { origin, schemaVersion: m.schemaVersion, policyVersion: m.policyVersion },
      "Instrument registry: stored generation rejected — schema/policy version mismatch",
    );
    return null;
  }
  if (!isManifestAccepted(m)) {
    logger.warn({ origin }, "Instrument registry: stored generation rejected — not ACCEPTED");
    return null;
  }
  if (!verifyManifestChecksum(m)) {
    logger.warn({ origin }, "Instrument registry: stored generation rejected — checksum mismatch");
    return null;
  }
  if (computeEligibleLiveSetHash(candidate.records) !== m.eligibleLiveSetHash) {
    logger.warn({ origin }, "Instrument registry: stored generation rejected — records do not match manifest hash");
    return null;
  }
  if (computeRecordSetHash(candidate.records) !== m.recordSetHash) {
    logger.warn(
      { origin },
      "Instrument registry: stored generation rejected — full record set does not match its commitment",
    );
    return null;
  }
  if (candidate.records.length !== m.totalOfficialRecords + m.indexCount) {
    logger.warn(
      { origin, loaded: candidate.records.length, expected: m.totalOfficialRecords + m.indexCount },
      "Instrument registry: stored generation rejected — record count disagrees with the manifest",
    );
    return null;
  }
  return candidate;
}

/**
 * Cold start: PostgreSQL first (authoritative and cross-replica), then disk.
 * Returns null when nothing durable and valid exists — the caller must then
 * report an unconfigured universe rather than inventing one.
 */
export async function loadLatestAcceptedGeneration(reason: string): Promise<RegistryGeneration | null> {
  try {
    await ensureRegistrySchema();
    const res = await db.execute(sql`
      SELECT manifest, records
      FROM instrument_universe_manifests
      WHERE acceptance_status = 'ACCEPTED'
        AND schema_version = ${MANIFEST_SCHEMA_VERSION}
        AND policy_version = ${CLASSIFICATION_POLICY_VERSION}
        AND record_count >= ${MIN_RECORDS_FOR_COMMIT}
      ORDER BY generated_at DESC
      LIMIT 1
    `);
    const row = (res.rows ?? [])[0] as
      | { manifest: InstrumentUniverseManifest; records: RegistryRecord[] }
      | undefined;
    if (row) {
      const accepted = acceptLoadedGeneration(
        { manifest: row.manifest, records: row.records },
        "L2_POSTGRESQL",
      );
      if (accepted) {
        _memory = accepted;
        logger.info(
          { reason, registryGenerationId: accepted.manifest.registryGenerationId },
          "Instrument registry: restored from PostgreSQL (L2)",
        );
        return accepted;
      }
    }
  } catch (err) {
    logger.warn({ err, reason }, "Instrument registry: L2 load failed (non-fatal, trying disk)");
  }

  try {
    const blob = loadBlob<RegistryGeneration>(DISK_NAME, DISK_VERSION);
    if (blob?.payload) {
      const accepted = acceptLoadedGeneration(blob.payload, "L1_DISK");
      if (accepted) {
        _memory = accepted;
        logger.info({ reason }, "Instrument registry: restored from disk (L1)");
        return accepted;
      }
    }
  } catch (err) {
    logger.warn({ err, reason }, "Instrument registry: L1 disk load failed (non-fatal)");
  }

  return null;
}
