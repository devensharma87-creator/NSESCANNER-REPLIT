/**
 * NSE Authoritative Equity Security Master.
 *
 * Fetches the NSE EQUITY_L.csv file — the NSE-published authoritative list of
 * all equity-category securities listed on the Exchange, with their official
 * series, ISIN, and listing date.
 *
 * PURPOSE
 * ───────
 * This reference is the single authoritative source for confirming that a Kite
 * EQ instrument is ordinary main-board equity (series=EQ) vs. Trade-to-Trade
 * (series=BE), SME (series=SM/ST), or another series.
 *
 * Without this reference, Kite EQ instruments are classified as
 * KITE_NSE_EQ_LIKE_PROVISIONAL — they cannot drive breadth, rankings, signals,
 * market mood, or trade actions.
 *
 * JOIN RULES (per owner requirement):
 *   1. Primary: symbol match (NSE tradingsymbol = EQUITY_L SYMBOL column).
 *   2. ISIN where available for tie-breaking.
 *   3. Suffix is only SUPPORTING evidence, not independently authoritative.
 *   4. Missing/conflicting → UNRESOLVED_SECURITY_TYPE.
 *
 * CSV FORMAT (NSE EQUITY_L.csv)
 * ─────────────────────────────
 *   SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,PAID UP VALUE,MARKET LOT,ISIN NUMBER,FACE VALUE
 *
 * SERIES CLASSIFICATION
 * ─────────────────────
 *   EQ  → ORDINARY_MAIN_BOARD_EQUITY   (ordinary tradeable equity)
 *   BE  → TRADE_TO_TRADE_EQUITY        (trade-to-trade, book entry, no intraday)
 *   BT  → TRADE_TO_TRADE_EQUITY        (alternate T2T notation)
 *   SM  → SME_EQUITY                   (SME platform)
 *   ST  → SME_EQUITY                   (SME trade-to-trade)
 *   BL  → OTHER_NSE_SERIES             (block deal mechanism — price-only)
 *   Other → OTHER_NSE_SERIES
 *
 * SOURCE
 * ──────
 * NSE EQUITY_L.csv is published daily. Effective/reference date: the Date of
 * Listing column + the snapshot fetch timestamp (snapshotDate).
 *
 * CACHE
 * ─────
 * In-memory, 6 hours TTL. On refresh failure, falls back to last-good disk
 * snapshot (via loadBlob/saveBlob from diskCache.ts). If both fail → null.
 *
 * LAST-GOOD DISK SAFETY
 * ─────────────────────
 * On every successful refresh, the parsed result is atomically written to disk
 * via saveBlob (write-temp + rename). On refresh failure, the disk snapshot is
 * loaded and served with isLastGood=true. The cache is never replaced by
 * malformed or empty data (< 100 records triggers parse rejection).
 *
 * This ensures classifier never silently degrades after a transient NSE
 * network failure: it either serves authoritative data or last-good (labeled
 * as stale), never provisional data masquerading as authoritative.
 */

import { logger } from "./logger";
import { createHash } from "crypto";
import { loadBlob, saveBlob, clearBlob } from "./diskCache";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A single NSE-published equity security record from EQUITY_L.csv.
 * These fields are authoritative — sourced directly from NSE, not inferred.
 */
export interface NseEquityRecord {
  /** NSE tradingsymbol (uppercase). Used as primary join key to Kite master. */
  symbol: string;
  /** Company name as published by NSE. */
  name: string;
  /**
   * NSE series code:
   *   EQ = ordinary main-board equity
   *   BE = trade-to-trade (book entry)
   *   BT = trade-to-trade alternate notation
   *   SM = SME equity
   *   ST = SME trade-to-trade
   *   BL = block deal price indicator
   *   (others: N1-N9 corporate debt, etc. — appear in EQUITY_L only for equity-class securities)
   */
  series: string;
  /** NSE effective date of listing: DD-MON-YYYY. */
  dateOfListing: string;
  /** ISIN (International Securities Identification Number). INExxxxxxxxxxx format. */
  isin: string;
  /** Always "EQUITY_L.csv" — the source file identifier per owner requirement. */
  sourceFile: "EQUITY_L.csv";
  /** ISO date-string when this record was fetched from NSE (the snapshot date). */
  snapshotDate: string;
  /** First 8 hex characters of the SHA-256 hash of the full CSV body (source hash). */
  sourceHash: string;
}

/**
 * NSE series → security class mapping.
 * Authoritative: sourced from NSE series definition.
 */
export type NseSeriesClass =
  | "ORDINARY_MAIN_BOARD_EQUITY"  // EQ series — ordinary, tradeable, main-board
  | "TRADE_TO_TRADE_EQUITY"       // BE/BT series — T2T, no intraday squaring
  | "SME_EQUITY"                  // SM/ST series — SME platform
  | "OTHER_NSE_SERIES";           // BL or any other series

/**
 * Classify an NSE EQUITY_L series code into a canonical security class.
 */
export function classifyNseSeries(series: string): NseSeriesClass {
  const s = (series ?? "").trim().toUpperCase();
  if (s === "EQ") return "ORDINARY_MAIN_BOARD_EQUITY";
  if (s === "BE" || s === "BT") return "TRADE_TO_TRADE_EQUITY";
  if (s === "SM" || s === "ST") return "SME_EQUITY";
  return "OTHER_NSE_SERIES";
}

// ── Stale governance ──────────────────────────────────────────────────────────

/**
 * Maximum accepted age (hours) for the NSE reference to be considered
 * authoritative enough to drive universe classification and admission decisions.
 *
 * If the cached reference is older than this threshold — even when loaded from
 * a last-good source — canAuthorizeUniverse is set to false and new
 * evaluation/admission is fail-closed for that reference.
 */
export const NSE_REFERENCE_MAX_AGE_HOURS = 48;

// ── Disk-persistence constants ────────────────────────────────────────────────

/** Blob name for last-good NSE security master disk snapshot. */
const LAST_GOOD_BLOB_NAME = "nse-security-master-last-good";
/**
 * Version for the last-good blob. Increment when NseEquityRecord shape changes
 * or when the serialization format changes. Old blobs are silently discarded.
 */
const LAST_GOOD_BLOB_VERSION = 1;

/** Serializable payload stored in the last-good disk blob. */
interface LastGoodPayload {
  /** All records as a plain array (Maps are not JSON-serializable). */
  records: NseEquityRecord[];
  totalRecords: number;
  seriesCounts: Record<string, number>;
  fetchedAt: string;
  sourceUrl: string;
  sourceHash: string;
  snapshotDate: string;
  /** ISO timestamp when this snapshot was saved to disk. */
  savedAt: string;
}

// ── Internal cache ────────────────────────────────────────────────────────────

interface MasterCache {
  /** Symbol → record map for O(1) lookup. */
  bySymbol: Map<string, NseEquityRecord>;
  /** ISIN → record map for secondary join. */
  byIsin: Map<string, NseEquityRecord>;
  /** Total records loaded from the file. */
  totalRecords: number;
  /** Count per series: { EQ: 4321, BE: 150, ... } */
  seriesCounts: Record<string, number>;
  /** ISO timestamp of the fetch that produced this cache entry. */
  fetchedAt: string;
  /** Source URL that was successfully fetched. */
  sourceUrl: string;
  /** First 8 hex chars of SHA-256 of the raw CSV body. */
  sourceHash: string;
  /** ISO date of the snapshot (YYYY-MM-DD). */
  snapshotDate: string;
  /**
   * true = this cache entry was loaded from the last-good disk snapshot
   *        or the PostgreSQL last-good snapshot — NOT from a fresh HTTP fetch.
   *        The reference data may be stale.
   */
  isLastGood: boolean;
  /**
   * Human-readable reason why the last-good fallback was used.
   * null when isLastGood=false.
   */
  staleReason: string | null;
  /**
   * true when this reference is fresh enough and authoritative enough to drive
   * instrument universe classification, scanner generation, and admission.
   *
   * false when:
   *   - isLastGood=true (not a fresh HTTP fetch)
   *   - reference age exceeds NSE_REFERENCE_MAX_AGE_HOURS (48h)
   *   - no reference loaded at all
   */
  canAuthorizeUniverse: boolean;
}

const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

let cache: MasterCache | null = null;
let inflight: Promise<MasterCache | null> | null = null;

// ── HTTP helpers ──────────────────────────────────────────────────────────────

const NSE_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "text/csv,text/plain,application/octet-stream,*/*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.nseindia.com/",
  Origin: "https://www.nseindia.com",
  Connection: "keep-alive",
};

const CANDIDATE_URLS = [
  "https://archives.nseindia.com/content/equities/EQUITY_L.csv",
  "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",
];

async function tryFetch(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    const r = await fetch(url, { headers: NSE_HEADERS, signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) {
      logger.debug({ url, status: r.status }, "NSE equity master: HTTP error");
      return null;
    }
    const text = await r.text();
    if (!text || text.length < 100) return null;
    return text;
  } catch (err) {
    logger.debug({ url, err }, "NSE equity master: fetch failed");
    return null;
  }
}

// ── CSV parsing ───────────────────────────────────────────────────────────────

/**
 * Parse the NSE EQUITY_L.csv body.
 *
 * Expected header (case-insensitive):
 *   SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,PAID UP VALUE,MARKET LOT,ISIN NUMBER,FACE VALUE
 *
 * Tolerates:
 *   - Tab-separated variant
 *   - Windows line endings
 *   - Quoted fields
 *   - Extra whitespace
 *   - Partial lines (skipped)
 */
function parseCsv(
  body: string,
  snapshotDate: string,
  sourceUrl: string,
  sourceHash: string,
): { bySymbol: Map<string, NseEquityRecord>; byIsin: Map<string, NseEquityRecord>; seriesCounts: Record<string, number>; totalRecords: number } {
  const lines = body.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const bySymbol = new Map<string, NseEquityRecord>();
  const byIsin = new Map<string, NseEquityRecord>();
  const seriesCounts: Record<string, number> = {};
  let totalRecords = 0;

  // Detect delimiter
  const delim = lines[0]?.includes("\t") ? "\t" : ",";

  // Detect header row
  let dataStartLine = 0;
  if (lines[0]) {
    const firstUpper = lines[0].toUpperCase();
    if (firstUpper.includes("SYMBOL") && firstUpper.includes("SERIES")) {
      dataStartLine = 1; // skip header
    }
  }

  for (let i = dataStartLine; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw) continue;
    // Simple split — EQUITY_L has no embedded commas in any field
    const parts = raw.split(delim).map((p) => p.trim().replace(/^"|"$/g, ""));
    if (parts.length < 7) continue;

    const symbol = (parts[0] ?? "").toUpperCase().trim();
    const name = (parts[1] ?? "").trim();
    const series = (parts[2] ?? "").toUpperCase().trim();
    const dateOfListing = (parts[3] ?? "").trim();
    // parts[4] = PAID UP VALUE, parts[5] = MARKET LOT
    const isin = (parts[6] ?? "").toUpperCase().trim();

    if (!symbol || !series || !isin) continue;
    if (!/^[A-Z][A-Z0-9&.-]{0,19}$/.test(symbol)) continue;
    if (!/^IN[A-Z0-9]{10}$/.test(isin)) continue;

    const record: NseEquityRecord = {
      symbol,
      name,
      series,
      dateOfListing,
      isin,
      sourceFile: "EQUITY_L.csv",
      snapshotDate,
      sourceHash,
    };

    bySymbol.set(symbol, record);
    byIsin.set(isin, record);
    seriesCounts[series] = (seriesCounts[series] ?? 0) + 1;
    totalRecords++;
  }

  return { bySymbol, byIsin, seriesCounts, totalRecords };
}

// ── Last-good disk helpers ────────────────────────────────────────────────────

/** Compute canAuthorizeUniverse from a MasterCache entry. */
function computeCanAuthorize(fetchedAt: string, isLastGood: boolean): boolean {
  if (isLastGood) return false;
  const ageMs = Date.now() - new Date(fetchedAt).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  return ageHours < NSE_REFERENCE_MAX_AGE_HOURS;
}

/** Reconstruct MasterCache Maps from a serialized LastGoodPayload. */
function buildCacheFromLastGood(payload: LastGoodPayload, staleReason: string): MasterCache {
  const bySymbol = new Map<string, NseEquityRecord>();
  const byIsin = new Map<string, NseEquityRecord>();
  for (const rec of payload.records) {
    bySymbol.set(rec.symbol, rec);
    byIsin.set(rec.isin, rec);
  }
  return {
    bySymbol,
    byIsin,
    totalRecords: payload.totalRecords,
    seriesCounts: payload.seriesCounts,
    fetchedAt: payload.fetchedAt,
    sourceUrl: payload.sourceUrl,
    sourceHash: payload.sourceHash,
    snapshotDate: payload.snapshotDate,
    isLastGood: true,
    staleReason,
    canAuthorizeUniverse: false, // last-good is never authoritative
  };
}

/** Attempt to load the last-good snapshot from disk. Returns null if unavailable or malformed. */
function tryLoadLastGoodFromDisk(reason: string): MasterCache | null {
  const blob = loadBlob<LastGoodPayload>(LAST_GOOD_BLOB_NAME, LAST_GOOD_BLOB_VERSION);
  if (!blob || !blob.payload) return null;
  const p = blob.payload;
  if (!p.records || p.records.length < 100) {
    logger.warn({ recordCount: p.records?.length ?? 0 }, "NSE equity master: last-good disk blob too small, ignoring");
    return null;
  }
  const entry = buildCacheFromLastGood(p, reason);
  logger.info(
    { totalRecords: entry.totalRecords, snapshotDate: entry.snapshotDate, reason },
    "NSE equity master: loaded last-good from disk (STALE fallback)",
  );
  return entry;
}

/** Persist current fresh MasterCache to last-good disk blob. */
function saveLastGoodToDisk(entry: MasterCache): void {
  const records = Array.from(entry.bySymbol.values());
  const payload: LastGoodPayload = {
    records,
    totalRecords: entry.totalRecords,
    seriesCounts: entry.seriesCounts,
    fetchedAt: entry.fetchedAt,
    sourceUrl: entry.sourceUrl,
    sourceHash: entry.sourceHash,
    snapshotDate: entry.snapshotDate,
    savedAt: new Date().toISOString(),
  };
  saveBlob(LAST_GOOD_BLOB_NAME, LAST_GOOD_BLOB_VERSION, payload);
  logger.info(
    { totalRecords: entry.totalRecords, snapshotDate: entry.snapshotDate },
    "NSE equity master: saved last-good to disk",
  );
}

// ── PostgreSQL persistence (L2 — durable, cross-replica) ─────────────────────

/** PostgreSQL advisory lock key for NSE master refresh single-flight. */
const DB_ADVISORY_LOCK_KEY = 8274613;
/** DB schema version stored in nse_security_master_snapshots.schema_version. */
const DB_SCHEMA_VERSION = 1;
/** Rows to retain in nse_security_master_snapshots (keep last N). */
const DB_MAX_SNAPSHOTS = 5;

let schemaEnsured = false;

/** Create nse_security_master_snapshots if it does not exist. Memoized. */
async function ensureNseMasterSnapshotSchema(): Promise<void> {
  if (schemaEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS nse_security_master_snapshots (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        source_url TEXT NOT NULL,
        retrieved_at TIMESTAMPTZ NOT NULL,
        effective_date DATE NOT NULL,
        sha256 TEXT NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        row_count INTEGER NOT NULL,
        validation_result TEXT NOT NULL,
        records JSONB NOT NULL,
        series_counts JSONB NOT NULL,
        saved_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS nse_security_master_snapshots_retrieved_at_idx
        ON nse_security_master_snapshots (retrieved_at DESC)
    `);
    schemaEnsured = true;
    logger.debug("NSE equity master: nse_security_master_snapshots schema ensured");
  } catch (err) {
    logger.warn({ err }, "NSE equity master: ensureNseMasterSnapshotSchema failed (non-fatal)");
  }
}

/**
 * Result of a PostgreSQL persistence operation for an NSE master snapshot.
 *
 * ok=true  → INSERT committed inside a transaction; snapshotId/committedAt/sha256 are valid.
 * ok=false → INSERT failed or RETURNING produced no row; reasonCode/errorClass describe the failure.
 *
 * A newly fetched snapshot is only considered durable after ok=true.
 * A failed write MUST NOT be reported as durable success.
 */
export type SnapshotPersistenceResult =
  | {
      ok: true;
      /** Auto-generated BIGINT id from RETURNING id::text. */
      snapshotId: string;
      /** ISO timestamp when the transaction committed (from RETURNING saved_at). */
      committedAt: string;
      /** SHA-256 prefix (8 hex chars) of the raw CSV body. */
      sha256: string;
    }
  | {
      ok: false;
      /** Short error description or SQLSTATE code. */
      reasonCode: string;
      /** JavaScript error class name (e.g. "Error", "PostgresError"). */
      errorClass: string;
    };

/**
 * Persist a fresh MasterCache snapshot to PostgreSQL.
 *
 * Uses a Drizzle db.transaction() with pg_advisory_xact_lock so the INSERT is:
 *   - Serialized across replicas (only one INSERT per snapshot window).
 *   - Advisory lock auto-released on commit or rollback (transaction-scoped,
 *     safe on pooled connections — no dangling session locks).
 *
 * Returns SnapshotPersistenceResult. ok=false is non-fatal — callers log and continue.
 *
 * EXPORTED for test mocking via vi.spyOn.
 */
export async function _saveSnapshotToDb(entry: MasterCache): Promise<SnapshotPersistenceResult> {
  try {
    await ensureNseMasterSnapshotSchema();
    const records = Array.from(entry.bySymbol.values());

    const insertResult = await db.transaction(async (tx) => {
      // pg_advisory_xact_lock: blocking, transaction-scoped — auto-released on commit/rollback.
      // Serializes concurrent snapshot writes from multiple replicas safely on pooled connections.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${DB_ADVISORY_LOCK_KEY})`);

      const result = await tx.execute(sql`
        INSERT INTO nse_security_master_snapshots
          (source_url, retrieved_at, effective_date, sha256, schema_version, row_count, validation_result, records, series_counts)
        VALUES (
          ${entry.sourceUrl},
          ${entry.fetchedAt}::timestamptz,
          ${entry.snapshotDate}::date,
          ${entry.sourceHash},
          ${DB_SCHEMA_VERSION},
          ${entry.totalRecords},
          ${"ACCEPTED"},
          ${JSON.stringify(records)}::jsonb,
          ${JSON.stringify(entry.seriesCounts)}::jsonb
        )
        RETURNING id::text AS id, saved_at
      `);

      // Prune old snapshots: keep DB_MAX_SNAPSHOTS most recent.
      await tx.execute(sql`
        DELETE FROM nse_security_master_snapshots
        WHERE id NOT IN (
          SELECT id FROM nse_security_master_snapshots
          ORDER BY retrieved_at DESC
          LIMIT ${DB_MAX_SNAPSHOTS}
        )
      `);

      return result;
    });

    const rows = insertResult.rows as Array<{ id: string; saved_at: string | Date }>;
    const row = rows[0];
    if (!row) {
      return { ok: false, reasonCode: "INSERT_RETURNING_EMPTY", errorClass: "Error" };
    }

    const committedAt =
      typeof row.saved_at === "string" ? row.saved_at : new Date(row.saved_at).toISOString();

    logger.info(
      { totalRecords: entry.totalRecords, sourceHash: entry.sourceHash, snapshotId: row.id, committedAt },
      "NSE equity master: snapshot committed to PostgreSQL (L2) — transaction committed",
    );
    return { ok: true, snapshotId: row.id, committedAt, sha256: entry.sourceHash };
  } catch (err) {
    const errorClass = err instanceof Error ? err.constructor.name : "Error";
    const reasonCode =
      (err as { code?: string })?.code ??
      String(err).slice(0, 120);
    logger.warn({ err, reasonCode, errorClass }, "NSE equity master: _saveSnapshotToDb failed (non-fatal)");
    return { ok: false, reasonCode, errorClass };
  }
}

/**
 * Load the latest validated snapshot from PostgreSQL. Returns null if unavailable.
 *
 * EXPORTED for test mocking via vi.spyOn.
 */
export async function _loadLatestSnapshotFromDb(reason: string): Promise<MasterCache | null> {
  try {
    await ensureNseMasterSnapshotSchema();
    type SnapshotRow = {
      source_url: string;
      retrieved_at: string;
      effective_date: string;
      sha256: string;
      row_count: number;
      validation_result: string;
      records: NseEquityRecord[];
      series_counts: Record<string, number>;
    };
    const result = await db.execute(sql`
      SELECT source_url, retrieved_at, effective_date, sha256, row_count, validation_result, records, series_counts
      FROM nse_security_master_snapshots
      WHERE schema_version = ${DB_SCHEMA_VERSION}
        AND validation_result = 'ACCEPTED'
        AND row_count >= 100
      ORDER BY retrieved_at DESC
      LIMIT 1
    `);
    const rows = result.rows as SnapshotRow[];
    if (!rows.length) return null;
    const row = rows[0]!;
    const records: NseEquityRecord[] = Array.isArray(row.records) ? row.records : [];
    if (records.length < 100) return null;

    const payload: LastGoodPayload = {
      records,
      totalRecords: Number(row.row_count),
      seriesCounts: (row.series_counts as Record<string, number>) ?? {},
      fetchedAt: typeof row.retrieved_at === "string" ? row.retrieved_at : new Date(row.retrieved_at).toISOString(),
      sourceUrl: row.source_url,
      sourceHash: row.sha256,
      snapshotDate: typeof row.effective_date === "string" ? row.effective_date.slice(0, 10) : String(row.effective_date),
      savedAt: new Date().toISOString(),
    };
    const entry = buildCacheFromLastGood(payload, reason);
    logger.info(
      { totalRecords: entry.totalRecords, sourceHash: entry.sourceHash, reason },
      "NSE equity master: loaded last-good from PostgreSQL (L2 STALE fallback)",
    );
    return entry;
  } catch (err) {
    logger.warn({ err, reason }, "NSE equity master: _loadLatestSnapshotFromDb failed");
    return null;
  }
}

// ── Refresh ───────────────────────────────────────────────────────────────────
// Note: session advisory lock functions (_tryAcquireAdvisoryLock / _releaseAdvisoryLock)
// have been removed. Session advisory locks are unsafe on pooled connections because
// pg_advisory_lock + pg_advisory_unlock may run on different pool connections, leaving
// dangling locks. INSERT serialization now uses pg_advisory_xact_lock inside
// _saveSnapshotToDb's db.transaction(), which is transaction-scoped and auto-released.
// Within a single process, concurrent HTTP fetches are de-duplicated by the `inflight`
// Promise. Cross-replica concurrent fetches are best-effort (each replica may fetch
// independently, but only one INSERT commits due to the xact lock serialization).

async function refresh(): Promise<MasterCache | null> {
  for (const url of CANDIDATE_URLS) {
    const body = await tryFetch(url);
    if (!body) continue;

    const snapshotDate = new Date().toISOString().slice(0, 10);
    const sourceHash = createHash("sha256").update(body).digest("hex").slice(0, 8);
    const { bySymbol, byIsin, seriesCounts, totalRecords } = parseCsv(body, snapshotDate, url, sourceHash);

    // Sanity: NSE lists ~5,000–8,000 securities in EQUITY_L. If we get <100 it's probably a parse error.
    if (totalRecords < 100) {
      logger.warn({ url, totalRecords }, "NSE equity master: suspiciously low record count, ignoring");
      continue;
    }

    const fetchedAt = new Date().toISOString();
    const entry: MasterCache = {
      bySymbol,
      byIsin,
      totalRecords,
      seriesCounts,
      fetchedAt,
      sourceUrl: url,
      sourceHash,
      snapshotDate,
      isLastGood: false,
      staleReason: null,
      canAuthorizeUniverse: computeCanAuthorize(fetchedAt, false),
    };

    // L1: Persist to disk synchronously (write-temp + rename — atomic).
    // L2: Await PostgreSQL — errors are non-fatal (result logged; we continue).
    // We wait for the DB commit before returning so the snapshot is durable before
    // any caller reads it as "just refreshed". _saveSnapshotToDb uses pg_advisory_xact_lock
    // inside db.transaction() to serialize concurrent replica writes safely.
    saveLastGoodToDisk(entry);
    const persistResult = await _saveSnapshotToDb(entry);
    if (!persistResult.ok) {
      logger.warn(
        { reasonCode: persistResult.reasonCode, errorClass: persistResult.errorClass },
        "NSE equity master: PostgreSQL persistence failed (non-fatal — disk snapshot (L1) available)",
      );
    }

    logger.info(
      { totalRecords, seriesCounts, sourceHash, url },
      "NSE equity security master loaded (EQUITY_L.csv)",
    );
    return entry;
  }

  logger.warn("NSE equity security master: all upstream URLs unreachable (EQUITY_L.csv)");
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Load (or return cached) NSE equity security master.
 *
 * Load path (L0 → L1 → L2 → L3):
 *   L0 — in-memory cache (TTL 6h, fresh)
 *   L1 — local disk blob (diskCache.ts) — fast, instance-local
 *   L2 — PostgreSQL nse_security_master_snapshots — durable, cross-replica
 *   L3 — HTTP fetch from NSE (EQUITY_L.csv) — authoritative, rate-limited
 *
 * On HTTP failure: L1 (disk) then L2 (DB) are tried in order.
 * Returns null ONLY if L1, L2, and L3 all fail.
 *
 * Callers MUST treat null as "reference unavailable" and return
 * BLOCKED_AUTHORITATIVE_NSE_REFERENCE_UNAVAILABLE rather than classifying
 * instruments as provisional.
 *
 * Refresh single-flight: within a single process, concurrent calls share the `inflight`
 * Promise (one HTTP fetch at a time per replica). Cross-replica write serialization is
 * handled by pg_advisory_xact_lock inside _saveSnapshotToDb's db.transaction().
 * Session advisory lock functions have been removed (session locks are unsafe on pooled
 * connections — acquire and release can hit different pool connections, leaving dangling locks).
 */
export async function getNseSecurityMaster(): Promise<MasterCache | null> {
  // L0: Return from in-memory cache if still fresh.
  if (cache && !cache.isLastGood && Date.now() - new Date(cache.fetchedAt).getTime() < TTL_MS) {
    return cache;
  }
  // If we're serving a last-good in-memory, still attempt a refresh
  // but fall through to let the inflight Promise handle it.
  if (cache && cache.isLastGood) {
    // Fall through to refresh (will update cache if HTTP succeeds).
  }
  if (inflight) return inflight;

  const p = (async () => {
    try {
      // L3: HTTP fetch from NSE.
      const r = await refresh();
      if (r) {
        cache = r;
        return cache;
      }

      // L3 failed. Try fallbacks if we have no usable in-memory snapshot.
      if (!cache) {
        // L1 + L2: Load both disk and DB in parallel, then use the newer validated snapshot.
        // This prevents blindly preferring instance-local disk over a fresher DB snapshot
        // written by another replica after the current replica last synced.
        const [diskSnap, dbSnap] = await Promise.all([
          Promise.resolve(tryLoadLastGoodFromDisk("HTTP_FETCH_FAILED_L1_L2_COMPARE")),
          _loadLatestSnapshotFromDb("HTTP_FETCH_FAILED_L1_L2_COMPARE"),
        ]);

        if (diskSnap && dbSnap) {
          // Both available — prefer the newer validated snapshot by fetchedAt timestamp.
          const diskMs = new Date(diskSnap.fetchedAt).getTime();
          const dbMs = new Date(dbSnap.fetchedAt).getTime();
          if (diskMs >= dbMs) {
            logger.info(
              { diskFetchedAt: diskSnap.fetchedAt, dbFetchedAt: dbSnap.fetchedAt },
              "NSE equity master: L3 failed — disk (L1) newer or equal to DB (L2), using disk",
            );
            cache = diskSnap;
            // Push disk to DB best-effort so other replicas get the fresher snapshot.
            _saveSnapshotToDb(diskSnap).catch((e) =>
              logger.warn({ err: e }, "NSE equity master: fallback disk→DB push failed (non-fatal)"),
            );
          } else {
            logger.info(
              { diskFetchedAt: diskSnap.fetchedAt, dbFetchedAt: dbSnap.fetchedAt },
              "NSE equity master: L3 failed — DB (L2) newer than disk (L1), using DB",
            );
            cache = dbSnap;
          }
        } else if (diskSnap) {
          logger.info(
            { diskFetchedAt: diskSnap.fetchedAt },
            "NSE equity master: L3 failed — disk (L1) snapshot available, DB miss",
          );
          cache = diskSnap;
          _saveSnapshotToDb(diskSnap).catch((e) =>
            logger.warn({ err: e }, "NSE equity master: fallback disk→DB push failed (non-fatal)"),
          );
        } else if (dbSnap) {
          logger.info(
            { dbFetchedAt: dbSnap.fetchedAt },
            "NSE equity master: L3 failed — DB (L2) snapshot available, disk miss",
          );
          cache = dbSnap;
        } else {
          logger.warn("NSE equity master: L1, L2, and L3 all failed — no snapshot available");
          cache = null;
        }
        return cache;
      } else {
        // We already have a last-good in memory — keep it.
        logger.warn("NSE equity master: HTTP refresh failed, continuing with in-memory last-good");
        return cache;
      }
    } finally {
      inflight = null;
    }
  })();

  inflight = p;
  return p;
}

/**
 * Lookup a single symbol in the NSE equity master.
 * Returns the record if found, null if not found, undefined if master is not loaded.
 */
export async function lookupNseEquityRecord(
  symbol: string,
): Promise<NseEquityRecord | null | "MASTER_UNAVAILABLE"> {
  const master = await getNseSecurityMaster();
  if (!master) return "MASTER_UNAVAILABLE";
  return master.bySymbol.get(symbol.toUpperCase()) ?? null;
}

export interface NseMasterMeta {
  loaded: boolean;
  totalRecords: number | null;
  seriesCounts: Record<string, number> | null;
  snapshotDate: string | null;
  /** SHA-256 (first 8 hex chars) of the EQUITY_L.csv body. */
  sourceHash: string | null;
  sourceUrl: string | null;
  fetchedAt: string | null;
  /** Age of the reference in hours since fetchedAt. null if not loaded. */
  ageHours: number | null;
  isLastGood: boolean;
  /** Alias for isLastGood — convenience for diagnostics/display. */
  stale: boolean;
  staleReason: string | null;
  /**
   * true when the reference is fresh, non-stale, and within NSE_REFERENCE_MAX_AGE_HOURS.
   * false when loaded from last-good / disk / DB fallback OR when age > 48h.
   * Use this to gate scanner universe generation and instrument admission.
   */
  canAuthorizeUniverse: boolean;
  /** Policy value from NSE_REFERENCE_MAX_AGE_HOURS. */
  maxAgeHours: number;
}

/**
 * Snapshot metadata for the current cache — used in ClassifierProvenance reporting
 * and the /api/data/diagnostics/nse-reference endpoint.
 */
export function getNseSecurityMasterMeta(): NseMasterMeta {
  if (!cache) {
    return {
      loaded: false, totalRecords: null, seriesCounts: null, snapshotDate: null,
      sourceHash: null, sourceUrl: null, fetchedAt: null, ageHours: null,
      isLastGood: false, stale: false, staleReason: null, canAuthorizeUniverse: false,
      maxAgeHours: NSE_REFERENCE_MAX_AGE_HOURS,
    };
  }
  const ageMs = Date.now() - new Date(cache.fetchedAt).getTime();
  const ageHours = Math.round((ageMs / (1000 * 60 * 60)) * 10) / 10;
  return {
    loaded: true,
    totalRecords: cache.totalRecords,
    seriesCounts: cache.seriesCounts,
    snapshotDate: cache.snapshotDate,
    sourceHash: cache.sourceHash,
    sourceUrl: cache.sourceUrl,
    fetchedAt: cache.fetchedAt,
    ageHours,
    isLastGood: cache.isLastGood,
    stale: cache.isLastGood,
    staleReason: cache.staleReason,
    canAuthorizeUniverse: cache.canAuthorizeUniverse,
    maxAgeHours: NSE_REFERENCE_MAX_AGE_HOURS,
  };
}

/** Expose the bySymbol map directly for batch usage (classifyInstrumentBatch). */
export function getNseSecurityMasterMap(): Map<string, NseEquityRecord> | null {
  return cache ? cache.bySymbol : null;
}

/** TEST ONLY: expose clearBlob for last-good disk cleanup between tests. */
export function _clearLastGoodDiskBlobForTest(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("_clearLastGoodDiskBlobForTest is not available outside NODE_ENV=test");
  }
  clearBlob(LAST_GOOD_BLOB_NAME);
}

/** Reset cache for testing. Internal use only. */
export function _resetNseSecurityMasterForTest(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("_resetNseSecurityMasterForTest is not available outside NODE_ENV=test");
  }
  cache = null;
  inflight = null;
  schemaEnsured = false;
}

/**
 * TEST ONLY: Directly inject a cache entry (for testing canAuthorizeUniverse, ageHours, etc.).
 * The entry is accepted as-is without TTL/validation checks.
 */
export function _injectCacheForTest(entry: {
  totalRecords: number;
  seriesCounts: Record<string, number>;
  fetchedAt: string;
  sourceUrl: string;
  sourceHash: string;
  snapshotDate: string;
  isLastGood: boolean;
  staleReason: string | null;
  canAuthorizeUniverse: boolean;
}): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("_injectCacheForTest is not available outside NODE_ENV=test");
  }
  cache = {
    bySymbol: new Map(),
    byIsin: new Map(),
    ...entry,
  };
  inflight = null;
}
