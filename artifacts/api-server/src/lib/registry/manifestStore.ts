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
 * generation id, and bounded retention inside the same transaction — retention
 * is a consequence of a committed insert that actually created a row, never a
 * standalone sweep and never a side effect of a duplicate no-op. See the DELETE
 * in `saveRegistryGeneration` for the precise contract.
 *
 * LOADING IS NOT AUTHORIZING. A stored generation can be perfectly intact and
 * still be unable to speak for today, because its committed trading calendar
 * only covers the period its official sources cover. Loads therefore return
 * last-known data and record the authority verdict; the coverage boundary is
 * what refuses to hand out a denominator once that verdict expires.
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
import { evaluateCalendarAuthorityNow, type CalendarAuthorityEvaluation } from "./exchangeCalendar";
import {
  evaluateStoredBseReferenceAuthorityNow,
  type StoredBseReferenceAuthorityEvaluation,
} from "./bseReferencePolicy";
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

      const insertedRows = (inserted.rows ?? []) as Array<{ id: string; saved_at: string | Date }>;

      // RETENTION IS PAID FOR BY AN ACTUAL INSERT.
      //
      // Retention exists to bound the table as new generations arrive. A run
      // that adds nothing has bought no room and must therefore delete nothing:
      // re-running an identical generation, or replaying an old one, must not be
      // able to prune history it did not extend. So we return here, BEFORE the
      // DELETE, whenever ON CONFLICT DO NOTHING suppressed the insert.
      if (insertedRows.length !== 1) return insertedRows;

      // BOUNDED RETENTION — the exact contract, stated as it actually behaves:
      //
      //  * It runs inside THIS transaction, after an insert that created exactly
      //    one row, so it can never delete a row unless that insert also
      //    commits. A rolled-back write leaves the stored history untouched, and
      //    a failing DELETE takes the new row down with it.
      //  * It touches the registry manifest table and nothing else.
      //  * It keeps the newest REGISTRY_DB_MAX_SNAPSHOTS rows by generated_at,
      //    tie-broken on id so the retained set is deterministic when two
      //    generations share a timestamp. It is NOT partitioned by version, so
      //    accepting new generations across every schema and policy version is
      //    what eventually evicts superseded-schema rows — that, and nothing
      //    manual, is what removed the schema-1 rows. Older rows are history,
      //    not backups; pruned evidence is gone and is not reconstructed.
      await tx.execute(sql`
        DELETE FROM instrument_universe_manifests
        WHERE id NOT IN (
          SELECT id FROM instrument_universe_manifests
          ORDER BY generated_at DESC, id DESC
          LIMIT ${REGISTRY_DB_MAX_SNAPSHOTS}
        )
      `);

      return insertedRows;
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

// ───────────────────────────────────────────────────────────────────────────
// PHASE 0.7B — BOOT RESTORATION STATE
//
// Restoration has to answer two different questions and never conflate them:
//   INTEGRITY  — do the stored bytes still describe the generation they claim?
//                Immutable; evaluated against the payload, never the clock.
//   AUTHORITY  — may that generation speak for NOW? Evaluated at the actual
//                boot instant and re-evaluated at every calendar boundary.
//
// A consumer must also be able to tell "restoration has not run yet" from
// "restoration ran and found nothing". Before it settles, no caller may claim
// authoritative coverage — an empty registry at t=0 is an unanswered question,
// not an answered one.
// ───────────────────────────────────────────────────────────────────────────

export type RegistryRestorationState =
  /** Restoration has not been attempted yet in this process. Not settled. */
  | "NOT_ATTEMPTED"
  /** Installed, integrity verified, calendar authoritative for right now. */
  | "RESTORED_CURRENT"
  /** Installed, integrity verified, but its calendar no longer speaks for now. */
  | "RESTORED_LAST_KNOWN"
  /** Nothing durable to restore (no table, no compatible row, no disk blob). */
  | "NOT_CONFIGURED"
  /** Stored generation was built under a different schema or policy version. */
  | "INCOMPATIBLE_SCHEMA"
  /** Payload checksum, record-set hash or record count disagreed. */
  | "CHECKSUM_MISMATCH"
  /** The embedded trading-calendar commitment does not verify. */
  | "CALENDAR_COMMITMENT_INVALID"
  /** Reserved for authority-only refusals; carried as a blocker code today. */
  | "AUTHORITY_EXPIRED"
  /** The durable store could not be reached or queried. */
  | "DATABASE_UNAVAILABLE"
  /** Anything else — always explicit, never a silent empty universe. */
  | "RESTORE_FAILED";

/** Terminal states. Anything else means restoration has not settled. */
const SETTLED_STATES: ReadonlySet<RegistryRestorationState> = new Set<RegistryRestorationState>([
  "RESTORED_CURRENT",
  "RESTORED_LAST_KNOWN",
  "NOT_CONFIGURED",
  "INCOMPATIBLE_SCHEMA",
  "CHECKSUM_MISMATCH",
  "CALENDAR_COMMITMENT_INVALID",
  "AUTHORITY_EXPIRED",
  "DATABASE_UNAVAILABLE",
  "RESTORE_FAILED",
]);

/**
 * Safe additive diagnostics. Deliberately carries NO payload, NO record
 * contents, NO connection string and NO exception stack — only the identity
 * and verdict of the restoration attempt.
 */
export interface RegistryRestorationDiagnostics {
  readonly state: RegistryRestorationState;
  /** True once restoration reached a terminal state (installed or refused). */
  readonly settled: boolean;
  readonly source: "L2_POSTGRESQL" | "L1_DISK" | null;
  readonly registryGenerationId: string | null;
  readonly schemaVersion: number | null;
  readonly policyVersion: number | null;
  readonly recordCount: number | null;
  readonly authorityState: CalendarAuthorityEvaluation["state"] | null;
  /** Machine-readable refusal/limitation code; null when fully current. */
  readonly blockerCode: string | null;
  readonly attemptedAt: string | null;
  readonly restoredAt: string | null;
  readonly lastSuccessfulRestorationAt: string | null;
  /** Caller-supplied reason string for the attempt (e.g. STARTUP_L2_RESTORE). */
  readonly reason: string | null;
}

const NOT_ATTEMPTED: RegistryRestorationDiagnostics = Object.freeze({
  state: "NOT_ATTEMPTED" as const,
  settled: false,
  source: null,
  registryGenerationId: null,
  schemaVersion: null,
  policyVersion: null,
  recordCount: null,
  authorityState: null,
  blockerCode: null,
  attemptedAt: null,
  restoredAt: null,
  lastSuccessfulRestorationAt: null,
  reason: null,
});

let _restoration: RegistryRestorationDiagnostics = NOT_ATTEMPTED;

export function getRegistryRestorationDiagnostics(): RegistryRestorationDiagnostics {
  return _restoration;
}

/** Has boot restoration reached a terminal state in this process? */
export function isRegistryRestorationSettled(): boolean {
  return _restoration.settled;
}

/**
 * COVERAGE BOUNDARY ENTRY POINT.
 *
 * Coverage consumers must read the registry through this function, never
 * `getActiveGeneration()`. Before restoration settles it returns null, so a
 * consumer racing the boot sequence sees "not configured" instead of an empty
 * universe it might mistake for a complete one.
 */
export function getSettledActiveGeneration(): RegistryGeneration | null {
  return _restoration.settled ? _memory : null;
}

export function _resetRestorationStateForTest(): void {
  _restoration = NOT_ATTEMPTED;
}

/**
 * IN-MEMORY AUTHORITY BOUNDARY.
 *
 * `getActiveGeneration` returns the last-known generation for display. This
 * asks the separate question: may it still speak for NOW? The answer changes
 * without any load, write or restart — at the next session close, and again at
 * IST midnight — so it is recomputed whenever the previous evaluation's own
 * `validUntilMs` has passed, and cached until then.
 */
let _authorityMemo: { readonly generationId: string; readonly evaluation: CalendarAuthorityEvaluation } | null =
  null;
let _lastLoggedAuthorityState: string | null = null;

/**
 * THE CURRENT-TIME AUTHORITY BOUNDARY — both questions, asked together.
 *
 * A generation's right to speak for NOW has two independent expiries, and
 * asking only one of them is how stale data gets labelled current:
 *
 *   1. the committed TRADING CALENDAR must still cover today and must still
 *      name the latest completed session the manifest reconciled to, and
 *   2. the committed BSE REFERENCE verdict must still satisfy the approved
 *      current-IST-day List-of-Scrips rule.
 *
 * The second is not implied by the first. A manifest built yesterday afternoon
 * still agrees with the calendar all through today until today's session
 * closes — but its List of Scrips was retrieved yesterday, so under the
 * owner-approved policy it stopped being able to authorize at IST midnight.
 *
 * Pure and non-mutating: nothing here rewrites a stored verdict, a checksum or
 * an evaluation instant. An expired generation keeps every figure it was
 * persisted with and loses only the right to be believed about the present.
 */
export interface RegistryAuthorityNow {
  readonly calendar: CalendarAuthorityEvaluation;
  readonly bse: StoredBseReferenceAuthorityEvaluation;
  /** The weaker of the two verdicts — what any consumer must act on. */
  readonly combined: CalendarAuthorityEvaluation;
}

const AUTHORITY_RANK: Readonly<Record<string, number>> = Object.freeze({
  CURRENT_AUTHORITATIVE: 0,
  LAST_KNOWN: 1,
  STALE: 2,
});

export function evaluateRegistryAuthorityNow(
  manifest: InstrumentUniverseManifest,
  nowMs: number,
): RegistryAuthorityNow {
  const calendar = evaluateCalendarAuthorityNow(manifest.tradingCalendar, nowMs);
  const bse = evaluateStoredBseReferenceAuthorityNow(
    manifest.bseReferenceAuthority,
    Date.parse(manifest.generatedAt),
    nowMs,
  );
  const weaker =
    (AUTHORITY_RANK[bse.state] ?? 2) > (AUTHORITY_RANK[calendar.state] ?? 2) ? bse.state : calendar.state;
  const combined: CalendarAuthorityEvaluation = Object.freeze({
    ...calendar,
    state: weaker,
    reasons: Object.freeze([...calendar.reasons, ...bse.reasons].sort()),
    // Whichever expiry comes first governs how long this verdict may be cached.
    validUntilMs: Math.min(calendar.validUntilMs, bse.validUntilMs),
  });
  return { calendar, bse, combined };
}

export interface ActiveGenerationAuthority {
  readonly generation: RegistryGeneration | null;
  readonly authority: CalendarAuthorityEvaluation | null;
  /** True only for CURRENT_AUTHORITATIVE. LAST_KNOWN and STALE may not authorize. */
  readonly mayAuthorize: boolean;
}

export function getActiveGenerationAuthority(nowMs: number = Date.now()): ActiveGenerationAuthority {
  const gen = _memory;
  if (!gen) return { generation: null, authority: null, mayAuthorize: false };
  const id = gen.manifest.registryGenerationId;
  const memo = _authorityMemo;
  const usable =
    memo &&
    memo.generationId === id &&
    nowMs >= memo.evaluation.evaluatedAtMs &&
    nowMs < memo.evaluation.validUntilMs;
  const evaluation = usable ? memo!.evaluation : evaluateRegistryAuthorityNow(gen.manifest, nowMs).combined;
  if (!usable) {
    _authorityMemo = { generationId: id, evaluation };
    const key = `${id}|${evaluation.state}`;
    if (evaluation.state !== "CURRENT_AUTHORITATIVE" && key !== _lastLoggedAuthorityState) {
      logger.warn(
        {
          registryGenerationId: id,
          authorityState: evaluation.state,
          reasons: evaluation.reasons,
          diagnosticEvent: "REGISTRY_CALENDAR_AUTHORITY_EXPIRED",
        },
        "Instrument registry: committed trading calendar no longer authoritative for the current date",
      );
    }
    _lastLoggedAuthorityState = key;
  }
  return { generation: gen, authority: evaluation, mayAuthorize: evaluation.state === "CURRENT_AUTHORITATIVE" };
}

export function _resetAuthorityMemoForTest(): void {
  _authorityMemo = null;
  _lastLoggedAuthorityState = null;
}

export function _setActiveGenerationForTest(gen: RegistryGeneration | null): void {
  _memory = gen;
}

/**
 * Outcome of re-verifying one durable candidate. `generation` is non-null only
 * when every integrity gate passed; the calendar's CURRENT/LAST_KNOWN verdict
 * is reported separately so a caller can never read "loaded" as "authoritative".
 */
export interface LoadedGenerationVerdict {
  readonly generation: RegistryGeneration | null;
  readonly state: RegistryRestorationState;
  readonly blockerCode: string | null;
  readonly authority: CalendarAuthorityEvaluation | null;
}

/**
 * Re-verify a candidate loaded from any durable layer. Shared by L1 and L2 so
 * disk and database are held to exactly the same bar.
 *
 * ORDER MATTERS: integrity first (immutable, payload-only), authority second
 * (clock-dependent). Nothing is installed before the checksum, the record-set
 * hash, the record count AND the embedded calendar commitment have verified.
 */
export function evaluateLoadedGeneration(
  candidate: RegistryGeneration,
  origin: "L1_DISK" | "L2_POSTGRESQL",
  nowMs: number = Date.now(),
): LoadedGenerationVerdict {
  const m = candidate.manifest;
  const refuse = (
    state: RegistryRestorationState,
    blockerCode: string,
    message: string,
    extra: Record<string, unknown> = {},
  ): LoadedGenerationVerdict => {
    logger.warn({ origin, blockerCode, ...extra }, message);
    return { generation: null, state, blockerCode, authority: null };
  };

  if (m.schemaVersion !== MANIFEST_SCHEMA_VERSION || m.policyVersion !== CLASSIFICATION_POLICY_VERSION) {
    return refuse(
      "INCOMPATIBLE_SCHEMA",
      m.schemaVersion !== MANIFEST_SCHEMA_VERSION ? "SCHEMA_VERSION_UNSUPPORTED" : "POLICY_VERSION_UNSUPPORTED",
      "Instrument registry: stored generation rejected — schema/policy version mismatch",
      { schemaVersion: m.schemaVersion, policyVersion: m.policyVersion },
    );
  }
  if (!isManifestAccepted(m)) {
    return refuse(
      "RESTORE_FAILED",
      "MANIFEST_NOT_ACCEPTED",
      "Instrument registry: stored generation rejected — not ACCEPTED",
    );
  }
  if (!verifyManifestChecksum(m)) {
    return refuse(
      "CHECKSUM_MISMATCH",
      "MANIFEST_CHECKSUM_MISMATCH",
      "Instrument registry: stored generation rejected — checksum mismatch",
    );
  }
  if (computeEligibleLiveSetHash(candidate.records) !== m.eligibleLiveSetHash) {
    return refuse(
      "CHECKSUM_MISMATCH",
      "ELIGIBLE_LIVE_SET_HASH_MISMATCH",
      "Instrument registry: stored generation rejected — records do not match manifest hash",
    );
  }
  if (computeRecordSetHash(candidate.records) !== m.recordSetHash) {
    return refuse(
      "CHECKSUM_MISMATCH",
      "RECORD_SET_HASH_MISMATCH",
      "Instrument registry: stored generation rejected — full record set does not match its commitment",
    );
  }
  if (candidate.records.length !== m.totalOfficialRecords + m.indexCount) {
    return refuse(
      "CHECKSUM_MISMATCH",
      "RECORD_COUNT_MISMATCH",
      "Instrument registry: stored generation rejected — record count disagrees with the manifest",
      { loaded: candidate.records.length, expected: m.totalOfficialRecords + m.indexCount },
    );
  }

  // COLD-LOAD AUTHORITY BOUNDARY (both L1 disk and L2 PostgreSQL).
  //
  // An intact generation is still installed when its calendar has expired:
  // last-known data keeps its display value, and its stored checksums are NOT
  // rewritten just because the clock moved. What it loses is the right to
  // authorize — the coverage boundary re-asks the same question there.
  //
  // A commitment that does not VERIFY is a different matter: those bytes do not
  // describe the calendar they claim, so the generation is not installed at all.
  const { calendar, bse, combined: authority } = evaluateRegistryAuthorityNow(m, nowMs);
  if (calendar.state === "STALE") {
    return refuse(
      "CALENDAR_COMMITMENT_INVALID",
      "CALENDAR_COMMITMENT_UNVERIFIABLE",
      "Instrument registry: stored generation rejected — embedded calendar commitment does not verify",
      { registryGenerationId: m.registryGenerationId, reasons: calendar.reasons },
    );
  }
  // Committed BSE evidence that cannot be believed at all (missing, unparseable
  // or dated after the generation carrying it) is an integrity inconsistency,
  // not an expiry: refuse rather than serve it as last-known.
  if (bse.state === "STALE") {
    return refuse(
      "RESTORE_FAILED",
      "BSE_REFERENCE_EVIDENCE_INVALID",
      "Instrument registry: stored generation rejected — committed BSE reference evidence is inconsistent",
      { registryGenerationId: m.registryGenerationId, reasons: bse.reasons },
    );
  }
  if (authority.state !== "CURRENT_AUTHORITATIVE") {
    logger.warn(
      {
        origin,
        registryGenerationId: m.registryGenerationId,
        authorityState: authority.state,
        reasons: authority.reasons,
        diagnosticEvent: "REGISTRY_CALENDAR_AUTHORITY_EXPIRED",
      },
      "Instrument registry: stored generation loaded as LAST KNOWN — its trading calendar is not authoritative now",
    );
    return {
      generation: candidate,
      state: "RESTORED_LAST_KNOWN",
      blockerCode: "AUTHORITY_EXPIRED",
      authority,
    };
  }
  return { generation: candidate, state: "RESTORED_CURRENT", blockerCode: null, authority };
}

/**
 * Back-compatible wrapper: the candidate itself when every integrity gate
 * passed (whether or not it may still authorize), otherwise null.
 */
export function acceptLoadedGeneration(
  candidate: RegistryGeneration,
  origin: "L1_DISK" | "L2_POSTGRESQL",
  nowMs: number = Date.now(),
): RegistryGeneration | null {
  return evaluateLoadedGeneration(candidate, origin, nowMs).generation;
}

/** Record a terminal restoration verdict. Never rewrites stored data. */
function settleRestoration(
  partial: Omit<RegistryRestorationDiagnostics, "settled" | "lastSuccessfulRestorationAt">,
): void {
  const installed = partial.state === "RESTORED_CURRENT" || partial.state === "RESTORED_LAST_KNOWN";
  _restoration = Object.freeze({
    ...partial,
    settled: SETTLED_STATES.has(partial.state),
    lastSuccessfulRestorationAt: installed
      ? partial.restoredAt
      : _restoration.lastSuccessfulRestorationAt,
  });
}

/**
 * Cold start: PostgreSQL first (authoritative and cross-replica), then disk.
 * Returns null when nothing durable and valid exists — the caller must then
 * report an unconfigured universe rather than inventing one.
 *
 * READ-ONLY (Phase 0.7B). This path issues SELECTs only: no INSERT, UPDATE,
 * DELETE, TRUNCATE, ALTER or CREATE — not even an idempotent schema-ensure.
 * An absent table is a fact to report (NOT_CONFIGURED), not a thing to fix
 * during a restore; the writer path owns the DDL. It also performs no provider
 * call and no subscription: every input comes from the durable store.
 *
 * Whatever happens, a terminal state is recorded before returning, so a
 * consumer can always tell "not restored yet" from "restored and empty".
 */
export async function loadLatestAcceptedGeneration(reason: string): Promise<RegistryGeneration | null> {
  const attemptedAt = new Date().toISOString();

  const install = (
    verdict: LoadedGenerationVerdict,
    source: "L2_POSTGRESQL" | "L1_DISK",
    gen: RegistryGeneration,
  ): RegistryGeneration => {
    _memory = gen;
    const restoredAt = new Date().toISOString();
    settleRestoration({
      state: verdict.state,
      source,
      registryGenerationId: gen.manifest.registryGenerationId,
      schemaVersion: gen.manifest.schemaVersion,
      policyVersion: gen.manifest.policyVersion,
      recordCount: gen.records.length,
      authorityState: verdict.authority?.state ?? null,
      blockerCode: verdict.blockerCode,
      attemptedAt,
      restoredAt,
      reason,
    });
    logger.info(
      {
        reason,
        registryGenerationId: gen.manifest.registryGenerationId,
        records: gen.records.length,
        restorationState: verdict.state,
        authorityState: verdict.authority?.state ?? null,
        source,
        diagnosticEvent: "REGISTRY_BOOT_RESTORED",
      },
      source === "L2_POSTGRESQL"
        ? "Instrument registry: restored from PostgreSQL (L2)"
        : "Instrument registry: restored from disk (L1)",
    );
    return gen;
  };

  const refused = (state: RegistryRestorationState, blockerCode: string | null): null => {
    // FAIL CLOSED, INCLUDING AGAINST OURSELVES. A refusal must also revoke any
    // generation an earlier restoration installed: once this boot cannot vouch
    // for the durable store, a previously restored universe is no longer a
    // claim this process is entitled to keep serving as authoritative.
    _memory = null;
    _resetAuthorityMemoForTest();
    settleRestoration({
      state,
      source: null,
      registryGenerationId: null,
      schemaVersion: null,
      policyVersion: null,
      recordCount: null,
      authorityState: null,
      blockerCode,
      attemptedAt,
      restoredAt: null,
      reason,
    });
    return null;
  };

  try {
    // Read-only existence probe. `to_regclass` returns NULL instead of raising
    // when the relation is absent, so a missing table is an answer rather than
    // an exception — and no DDL is issued to create one.
    const present = await db.execute(sql`SELECT to_regclass('public.instrument_universe_manifests') AS reg`);
    const reg = ((present.rows ?? [])[0] as { reg: string | null } | undefined)?.reg ?? null;
    if (reg === null) {
      logger.warn(
        { reason, diagnosticEvent: "REGISTRY_BOOT_TABLE_ABSENT" },
        "Instrument registry: durable table does not exist — restoration reports NOT_CONFIGURED (no DDL is issued on the read path)",
      );
    } else {
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
        const verdict = evaluateLoadedGeneration(
          { manifest: row.manifest, records: row.records },
          "L2_POSTGRESQL",
        );
        if (verdict.generation) return install(verdict, "L2_POSTGRESQL", verdict.generation);
        // An unverifiable row is a terminal answer for this boot: falling
        // through to disk could install an older generation while reporting a
        // clean state, hiding the corruption that has to be seen.
        return refused(verdict.state, verdict.blockerCode);
      }
    }
  } catch (err) {
    // AN OUTAGE IS NOT A "NOTHING THERE". The durable store is the authority on
    // which generation is current; while it is unreachable, a disk blob could
    // be any older generation, and installing it would report a healthy restore
    // over an unanswered question. Fail closed and say so.
    logger.warn(
      { err, reason, diagnosticEvent: "REGISTRY_BOOT_STORE_UNAVAILABLE" },
      "Instrument registry: durable store unreachable — restoration fails closed (L1 disk is NOT substituted)",
    );
    return refused("DATABASE_UNAVAILABLE", "DURABLE_STORE_QUERY_FAILED");
  }

  // Reached only when the store answered cleanly and had nothing compatible to
  // give: no table, or no row meeting the acceptance/version/floor predicates.
  // Disk is a legitimate fallback for that answer, and is held to the same bar.
  try {
    const blob = loadBlob<RegistryGeneration>(DISK_NAME, DISK_VERSION);
    if (blob?.payload) {
      const verdict = evaluateLoadedGeneration(blob.payload, "L1_DISK");
      if (verdict.generation) return install(verdict, "L1_DISK", verdict.generation);
      return refused(verdict.state, verdict.blockerCode);
    }
  } catch (err) {
    logger.warn({ err, reason }, "Instrument registry: L1 disk load failed (non-fatal)");
    return refused("RESTORE_FAILED", "DISK_CACHE_READ_FAILED");
  }

  return refused("NOT_CONFIGURED", "NO_COMPATIBLE_GENERATION");
}
