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
 * Persist a fresh MasterCache snapshot to PostgreSQL. Non-blocking — errors are
 * logged but do not interrupt the caller.
 *
 * EXPORTED for test mocking via vi.spyOn.
 */
export async function _saveSnapshotToDb(entry: MasterCache): Promise<void> {
  try {
    await ensureNseMasterSnapshotSchema();
    const records = Array.from(entry.bySymbol.values());
    await db.execute(sql`
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
    `);
    // Prune old snapshots: keep DB_MAX_SNAPSHOTS most recent.
    await db.execute(sql`
      DELETE FROM nse_security_master_snapshots
      WHERE id NOT IN (
        SELECT id FROM nse_security_master_snapshots
        ORDER BY retrieved_at DESC
        LIMIT ${DB_MAX_SNAPSHOTS}
      )
    `);
    logger.info(
      { totalRecords: entry.totalRecords, sourceHash: entry.sourceHash },
      "NSE equity master: saved snapshot to PostgreSQL (L2)",
    );
  } catch (err) {
    logger.warn({ err }, "NSE equity master: _saveSnapshotToDb failed (non-fatal)");
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

/** Try to acquire the PostgreSQL session advisory lock for refresh single-flight.
 *  Only used in production (NODE_ENV=production). In dev/test, advisory locks
 *  are skipped because Drizzle's connection pool uses different connections for
 *  acquire and release, causing cross-test lock leakage with pg_advisory_lock.
 */
async function _tryAcquireAdvisoryLock(): Promise<boolean> {
  if (process.env.NODE_ENV !== "production") return true; // single-process in dev/test
  try {
    const result = await db.execute(sql`SELECT pg_try_advisory_lock(${DB_ADVISORY_LOCK_KEY}) AS acquired`);
    const rows = result.rows as Array<{ acquired: boolean }>;
    return rows[0]?.acquired ?? false;
  } catch {
    // DB unavailable — proceed without lock (fail open for lock, fail closed for data).
    return true;
  }
}

/** Release the PostgreSQL session advisory lock. Only used in production. */
async function _releaseAdvisoryLock(): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;
  try {
    await db.execute(sql`SELECT pg_advisory_unlock(${DB_ADVISORY_LOCK_KEY})`);
  } catch {
    // Ignore — connection reset or DB error; lock auto-releases on connection close.
  }
}

// ── Refresh ───────────────────────────────────────────────────────────────────

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

    // Persist to disk (L1) synchronously (write-temp + rename).
    // Then await PostgreSQL (L2) — no fire-and-forget; errors logged but non-fatal.
    // We wait for the DB commit before returning so the snapshot is durable before
    // any caller can read it as "just refreshed". Failure is non-fatal (logs warn).
    saveLastGoodToDisk(entry);
    await _saveSnapshotToDb(entry);

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
 * Refresh single-flight: a PostgreSQL session advisory lock (key 8274613)
 * prevents concurrent replicas from all hitting NSE simultaneously.
 */
export async function getNseSecurityMaster(): Promise<MasterCache | null> {
  // L0: Return from in-memory cache if still fresh.
  if (cache && !cache.isLastGood && Date.now() - new Date(cache.fetchedAt).getTime() < TTL_MS) {
    return cache;
  }
  // If we're serving a last-good in-memory, still attempt a background refresh
  // but return the in-memory last-good for the current caller to avoid blocking.
  if (cache && cache.isLastGood) {
    // Fall through to refresh (will update cache if HTTP succeeds).
  }
  if (inflight) return inflight;

  const p = (async () => {
    // Single-flight advisory lock — non-blocking attempt.
    const lockAcquired = await _tryAcquireAdvisoryLock();
    if (!lockAcquired) {
      // Another replica is already refreshing. Load from DB (L2) while we wait.
      logger.info("NSE equity master: advisory lock not acquired — loading from DB (another replica refreshing)");
      const dbSnap = await _loadLatestSnapshotFromDb("CONCURRENT_REFRESH_DB_FALLBACK");
      if (dbSnap) {
        cache = dbSnap;
        inflight = null;
        return cache;
      }
      // No DB snapshot either — return current in-memory (may be null).
      inflight = null;
      return cache;
    }

    try {
      // L3: HTTP fetch from NSE.
      const r = await refresh();
      if (r) {
        cache = r;
        inflight = null;
        return cache;
      }

      // L3 failed. Try fallbacks if we have no in-memory cache.
      if (!cache) {
        // L1: Try local disk.
        const diskSnap = tryLoadLastGoodFromDisk("HTTP_FETCH_FAILED");
        if (diskSnap) {
          cache = diskSnap;
          // Push disk snapshot to DB so other replicas benefit.
          // Awaited — no fire-and-forget; DB failure is logged but non-fatal.
          await _saveSnapshotToDb(diskSnap);
          inflight = null;
          return cache;
        }
        // L2: Try PostgreSQL.
        const dbSnap = await _loadLatestSnapshotFromDb("HTTP_FETCH_FAILED_DISK_MISS");
        cache = dbSnap; // may still be null
        inflight = null;
        return cache;
      } else {
        // We already have a last-good in memory — keep it.
        logger.warn("NSE equity master: HTTP refresh failed, continuing with in-memory last-good");
        inflight = null;
        return cache;
      }
    } finally {
      await _releaseAdvisoryLock();
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
