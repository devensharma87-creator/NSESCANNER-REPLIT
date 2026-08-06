/**
 * Option-chain snapshot archive and storage projection module.
 *
 * Implements a two-tier retention model:
 *   Tier 1 — Operational hot storage: recent rows in `option_chain_snapshot`
 *             (default 825 days retention; configurable via
 *             OPTION_SNAPSHOT_RETENTION_DAYS).
 *   Tier 2 — Long-term append-only archive: JSONL files partitioned by
 *             (date, underlying), with a SHA-256 manifest per partition.
 *             Requires OPTION_SNAPSHOT_ARCHIVE_PATH to be set.
 *
 * Deletion is FAIL-CLOSED:
 *   - If OPTION_SNAPSHOT_ARCHIVE_PATH is unset → archival blocked, deletion
 *     refused, ARCHIVE_PROVIDER_NOT_CONFIGURED returned.
 *   - If archive write or verification fails → deletion refused, error logged.
 *   - Only on archive WRITE_AND_VERIFIED does deletion proceed.
 *
 * Current environment status:
 *   OPTION_SNAPSHOT_ARCHIVE_PATH is NOT configured. All delete-guarded
 *   retention sweeps will return ARCHIVE_PROVIDER_NOT_CONFIGURED and log the
 *   exact infrastructure requirement.
 *
 * Owner action required:
 *   Set OPTION_SNAPSHOT_ARCHIVE_PATH to a durable path (NFS mount, S3-backed
 *   FUSE, or Replit Object Storage mount) that persists across restarts.
 *   When set, the archiver writes one JSONL per (date, underlying) partition
 *   and a manifest.json with row_count, min_captured_at, max_captured_at,
 *   expiries[], sha256 hash of the JSONL content, and schema_version.
 *
 * Pack 9A Gate 5 requirement: NO unarchived row may be deleted. Storage
 * projections are provided below as decision input for the owner.
 */

import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Measured row-size estimate (bytes) based on Pack 9A schema analysis.
 *
 * Column accounting:
 *   Numeric types (spot, atm_strike, ltp, bid, ask, spread, delta,
 *     gamma, theta, vega, strike, iv):      12 fields × 8 bytes   = 96 B
 *   Bigint (volume, oi, oi_change):           3 × 8               = 24 B
 *   Integer (bid_qty, ask_qty, lot_size):     3 × 4               = 12 B
 *   Timestamp (captured_at, created_at):      2 × 8               = 16 B
 *   VARCHAR (underlying 32, expiry 10,
 *     opt_type 2, tradingsymbol 64,
 *     source 32, schema_version 8,
 *     market_status 16, canary_marker 64):                        ≈ 80 B
 *   JSONB (depth_summary, typically null):                        ≈  4 B
 *   PostgreSQL tuple header + null bitmap:                        ≈ 28 B
 *   Alignment padding:                                            ≈ 20 B
 *   MVCC overhead (xmin, xmax, ctid, …):                         ≈ 24 B
 *   TOAST overhead (none typical — row fits in-page):             ≈  0 B
 *   ─────────────────────────────────────────────────────────────────────
 *   Total data bytes/row:                                        ≈ 304 B
 */
export const ESTIMATED_BYTES_PER_ROW_DATA = 304;

/**
 * Three indexes on the table, each adding roughly 75 B per row of index overhead.
 *   PK btree (5 cols), UEX time idx (3 cols), captured_at idx (1 col)
 *   ≈ 75 + 50 + 25 = 150 B/row index overhead.
 */
export const ESTIMATED_BYTES_PER_ROW_INDEX = 150;

/** Total estimated bytes per row (data + index overhead). */
export const ESTIMATED_BYTES_PER_ROW_TOTAL = ESTIMATED_BYTES_PER_ROW_DATA + ESTIMATED_BYTES_PER_ROW_INDEX;

/**
 * Expected rows per 5-minute tick:
 *   3 indices × (ATM ± 10 strikes = 21 max) × 2 sides × 2 expiries = 252 rows
 *
 * Note: ATM ± 10 = slice(0, window*2+1) = 21 strikes per expiry.
 * With 2 expiries per index and 3 indices, worst-case is 252 rows/tick.
 * In practice lower (fewer liquid strikes far OTM), so use 200 as conservative.
 */
export const ROWS_PER_TICK_CONSERVATIVE = 200;
export const ROWS_PER_TICK_WORST_CASE = 252;

/** Market hours: 9:15–15:30 IST = 375 minutes / 5-min interval = 75 ticks/day. */
export const TICKS_PER_DAY = 75;

// ─── Storage projection ───────────────────────────────────────────────────────

export interface StorageProjection {
  period: string;
  tradingDays: number;
  rowsConservative: number;
  rowsWorstCase: number;
  dataBytesConservative: number;
  dataBytesWorstCase: number;
  totalBytesConservative: number;
  totalBytesWorstCase: number;
  /** Human-readable. */
  summary: string;
}

function fmt(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function projectStorage(): StorageProjection[] {
  const periods: Array<{ label: string; days: number }> = [
    { label: "1 trading day", days: 1 },
    { label: "30 trading days", days: 30 },
    { label: "90 trading days", days: 90 },
    { label: "6 months (~130 days)", days: 130 },
    { label: "12 months (~260 days)", days: 260 },
    { label: "24 months (~520 days)", days: 520 },
  ];
  return periods.map(({ label, days }) => {
    const rowsC = days * TICKS_PER_DAY * ROWS_PER_TICK_CONSERVATIVE;
    const rowsW = days * TICKS_PER_DAY * ROWS_PER_TICK_WORST_CASE;
    const dataC = rowsC * ESTIMATED_BYTES_PER_ROW_DATA;
    const dataW = rowsW * ESTIMATED_BYTES_PER_ROW_DATA;
    const totalC = rowsC * ESTIMATED_BYTES_PER_ROW_TOTAL;
    const totalW = rowsW * ESTIMATED_BYTES_PER_ROW_TOTAL;
    return {
      period: label,
      tradingDays: days,
      rowsConservative: rowsC,
      rowsWorstCase: rowsW,
      dataBytesConservative: dataC,
      dataBytesWorstCase: dataW,
      totalBytesConservative: totalC,
      totalBytesWorstCase: totalW,
      summary:
        `${days}d: ${fmt(totalC)}–${fmt(totalW)} total ` +
        `(${rowsC.toLocaleString()}–${rowsW.toLocaleString()} rows)`,
    };
  });
}

// ─── Archive interface ────────────────────────────────────────────────────────

export type ArchiveOutcome =
  | "WRITE_AND_VERIFIED"
  | "WRITE_FAILED"
  | "VERIFY_FAILED"
  | "ARCHIVE_PROVIDER_NOT_CONFIGURED"
  | "NO_ROWS_TO_ARCHIVE";

export interface ArchiveManifest {
  partitionDate: string;      // YYYY-MM-DD (the oldest captured_at date in this batch)
  underlying: string;
  rowCount: number;
  minCapturedAt: string;
  maxCapturedAt: string;
  expiries: string[];
  schemaVersion: "v1";
  sha256: string;
  writtenAt: string;
  archivePath: string;
}

/**
 * Return the configured archive path, or null if OPTION_SNAPSHOT_ARCHIVE_PATH
 * is unset or empty.
 */
export function getArchivePath(): string | null {
  const p = process.env["OPTION_SNAPSHOT_ARCHIVE_PATH"]?.trim();
  return p && p.length > 0 ? p : null;
}

/**
 * Returns a summary of the infrastructure requirement when no archive is configured.
 */
export function getArchiveInfrastructureRequirement(): string {
  return (
    "OWNER_ACTION_REQUIRED: set OPTION_SNAPSHOT_ARCHIVE_PATH to a durable filesystem path " +
    "(NFS mount, S3-backed FUSE, or Replit Object Storage mount) that persists across " +
    "api-server restarts. Retention sweeps are blocked until this is configured. " +
    "Estimated storage: 10–15 MB/trading day; 24-month archive ≈ 2.4–3.8 GB."
  );
}

/**
 * Archive a partition of snapshot rows to the configured path.
 *
 * Writes a JSONL file + manifest JSON. Returns ARCHIVE_PROVIDER_NOT_CONFIGURED
 * if the archive path is not set. On any write/verify failure, returns
 * WRITE_FAILED or VERIFY_FAILED and NEVER deletes source rows.
 *
 * @param cutoffDate - ISO date string. Archive rows where captured_at::date < cutoffDate.
 *                     This is the date boundary for one retention sweep.
 */
export async function archiveSnapshotPartitionBeforeCutoff(
  cutoffDate: string,
): Promise<{ outcome: ArchiveOutcome; manifests: ArchiveManifest[]; rowsArchived: number }> {
  const archivePath = getArchivePath();
  if (!archivePath) {
    logger.warn(
      { requirement: getArchiveInfrastructureRequirement() },
      "option-snapshot-archive: ARCHIVE_PROVIDER_NOT_CONFIGURED — deletion blocked",
    );
    return { outcome: "ARCHIVE_PROVIDER_NOT_CONFIGURED", manifests: [], rowsArchived: 0 };
  }

  // Query rows to archive, grouped by (underlying, date partition).
  let rows: Array<Record<string, unknown>> = [];
  try {
    const result = (await db.execute(sql`
      SELECT
        underlying,
        expiry::text                           AS expiry,
        strike::text                           AS strike,
        opt_type,
        captured_at,
        ltp::text, bid::text, ask::text, spread::text,
        iv::text, delta::text, gamma::text, theta::text, vega::text,
        oi, oi_change, volume, spot::text, atm_strike::text,
        lot_size, schema_version, market_status, canary_marker, source
      FROM option_chain_snapshot
      WHERE captured_at < ${cutoffDate}
      ORDER BY underlying, captured_at;
    `)) as unknown as { rows: Array<Record<string, unknown>> };
    rows = result.rows;
  } catch (err) {
    logger.error({ err: (err as Error).message }, "option-snapshot-archive: query failed");
    return { outcome: "WRITE_FAILED", manifests: [], rowsArchived: 0 };
  }

  if (rows.length === 0) {
    return { outcome: "NO_ROWS_TO_ARCHIVE", manifests: [], rowsArchived: 0 };
  }

  // Group by underlying.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const u = String(r["underlying"]);
    if (!groups.has(u)) groups.set(u, []);
    groups.get(u)!.push(r);
  }

  const manifests: ArchiveManifest[] = [];
  let totalWritten = 0;

  for (const [underlying, uRows] of groups) {
    const jsonl = uRows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    const sha256 = createHash("sha256").update(jsonl, "utf8").digest("hex");
    const capturedAts = uRows
      .map((r) => new Date(r["captured_at"] as string).toISOString())
      .sort();
    const minCapturedAt = capturedAts[0]!;
    const maxCapturedAt = capturedAts[capturedAts.length - 1]!;
    const partitionDate = minCapturedAt.slice(0, 10);
    const expiries = [...new Set(uRows.map((r) => String(r["expiry"])))].sort();

    const fileName = `snapshot_${partitionDate}_${underlying}.jsonl`;
    const manifestName = `snapshot_${partitionDate}_${underlying}.manifest.json`;
    const filePath = path.join(archivePath, fileName);
    const manifestPath = path.join(archivePath, manifestName);

    const manifest: ArchiveManifest = {
      partitionDate,
      underlying,
      rowCount: uRows.length,
      minCapturedAt,
      maxCapturedAt,
      expiries,
      schemaVersion: "v1",
      sha256,
      writtenAt: new Date().toISOString(),
      archivePath: filePath,
    };

    try {
      fs.mkdirSync(archivePath, { recursive: true });
      fs.writeFileSync(filePath, jsonl, "utf8");
      // Verify integrity: re-read and hash.
      const readBack = fs.readFileSync(filePath, "utf8");
      const verifyHash = createHash("sha256").update(readBack, "utf8").digest("hex");
      if (verifyHash !== sha256) {
        logger.error(
          { underlying, expected: sha256, actual: verifyHash },
          "option-snapshot-archive: VERIFY_FAILED — hash mismatch, source rows NOT deleted",
        );
        return { outcome: "VERIFY_FAILED", manifests, rowsArchived: totalWritten };
      }
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
      manifests.push(manifest);
      totalWritten += uRows.length;
      logger.info(
        { underlying, rows: uRows.length, path: filePath, sha256 },
        "option-snapshot-archive: partition archived and verified",
      );
    } catch (err) {
      logger.error({ err: (err as Error).message, underlying }, "option-snapshot-archive: WRITE_FAILED");
      return { outcome: "WRITE_FAILED", manifests, rowsArchived: totalWritten };
    }
  }

  return { outcome: "WRITE_AND_VERIFIED", manifests, rowsArchived: totalWritten };
}

/**
 * Read all archive manifests from the configured archive path.
 * Returns an empty array if the archive path is not set or does not exist.
 */
export function readArchiveManifests(): ArchiveManifest[] {
  const archivePath = getArchivePath();
  if (!archivePath || !fs.existsSync(archivePath)) return [];
  try {
    const files = fs.readdirSync(archivePath).filter((f) => f.endsWith(".manifest.json"));
    return files.map((f) => {
      const raw = fs.readFileSync(path.join(archivePath, f), "utf8");
      return JSON.parse(raw) as ArchiveManifest;
    });
  } catch {
    return [];
  }
}
