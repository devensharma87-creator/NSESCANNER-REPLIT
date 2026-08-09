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
 * In-memory, 6 hours TTL. Retry each scan cycle if not loaded.
 */

import { logger } from "./logger";
import { createHash } from "crypto";

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

    const entry: MasterCache = {
      bySymbol,
      byIsin,
      totalRecords,
      seriesCounts,
      fetchedAt: new Date().toISOString(),
      sourceUrl: url,
      sourceHash,
      snapshotDate,
    };

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
 * Returns null if the NSE archive is unreachable — callers MUST treat null as
 * "reference unavailable" and classify instruments as KITE_NSE_EQ_LIKE_PROVISIONAL
 * rather than guessing security type.
 */
export async function getNseSecurityMaster(): Promise<MasterCache | null> {
  if (cache && Date.now() - new Date(cache.fetchedAt).getTime() < TTL_MS) {
    return cache;
  }
  if (inflight) return inflight;

  const p = refresh().then((r) => {
    if (r) cache = r;
    inflight = null;
    return r;
  });
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

/**
 * Snapshot metadata for the current cache — used in ClassifierProvenance reporting.
 */
export function getNseSecurityMasterMeta(): {
  loaded: boolean;
  totalRecords: number | null;
  seriesCounts: Record<string, number> | null;
  snapshotDate: string | null;
  sourceHash: string | null;
  sourceUrl: string | null;
  fetchedAt: string | null;
} {
  if (!cache) {
    return { loaded: false, totalRecords: null, seriesCounts: null, snapshotDate: null, sourceHash: null, sourceUrl: null, fetchedAt: null };
  }
  return {
    loaded: true,
    totalRecords: cache.totalRecords,
    seriesCounts: cache.seriesCounts,
    snapshotDate: cache.snapshotDate,
    sourceHash: cache.sourceHash,
    sourceUrl: cache.sourceUrl,
    fetchedAt: cache.fetchedAt,
  };
}

/** Expose the bySymbol map directly for batch usage (classifyInstrumentBatch). */
export function getNseSecurityMasterMap(): Map<string, NseEquityRecord> | null {
  return cache ? cache.bySymbol : null;
}

/** Reset cache for testing. Internal use only. */
export function _resetNseSecurityMasterForTest(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("_resetNseSecurityMasterForTest is not available outside NODE_ENV=test");
  }
  cache = null;
  inflight = null;
}
