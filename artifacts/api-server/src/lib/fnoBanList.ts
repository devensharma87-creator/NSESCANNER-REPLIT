/**
 * NSE F&O Ban List feed.
 *
 * NSE publishes a daily list of F&O stocks whose Market-Wide Position Limit
 * (MWPL) is breached and are therefore restricted to square-off-only trades.
 * Trading a banned stock outside of square-off carries a penalty for the
 * broker/client. Critical safety information for any F&O trader.
 *
 * Sources tried, in order:
 *   1. https://nsearchives.nseindia.com/content/fo/fo_secban.csv          (current archive host)
 *   2. https://archives.nseindia.com/content/fo/fo_secban.csv              (legacy archive host)
 *   3. https://nsearchives.nseindia.com/content/fo/fo_secban.txt           (legacy text format)
 *
 * The published file format has historically taken several shapes, all of
 * which we tolerate:
 *   - "Sr.No,Symbol\n1,ABFRL\n2,ADANIENT\n..."
 *   - "1#ABFRL\n2#ADANIENT\n..." (legacy hash-separated)
 *   - "ABFRL\nADANIENT\n..."     (one symbol per line)
 *
 * Parser strategy: strip non-symbol lines (numeric IDs, header words),
 * extract `/^[A-Z][A-Z0-9&-]{1,14}$/` tokens. Also tolerates file headers
 * like "Securities placed in Ban Period for the day".
 *
 * Cached in-memory for 30 minutes (matches the bhavcopy cadence). NSE
 * refreshes this file once around 19:00 IST when next-day positions are
 * computed; intra-day the same list applies all session, so a 30-min cache
 * is generous.
 */

import { logger } from "./logger";

const TTL_MS = 30 * 60 * 1000;

interface CacheEntry {
  ts: number;
  symbols: string[];
  /** Set view for O(1) `isBanned()` lookups. */
  set: Set<string>;
  sourceUrl: string;
  fetchedAt: string;
}

let cache: CacheEntry | null = null;
let inflight: Promise<CacheEntry | null> | null = null;

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "text/csv,text/plain,application/octet-stream,*/*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.nseindia.com/",
  Origin: "https://www.nseindia.com",
  Connection: "keep-alive",
};

const CANDIDATE_URLS = [
  "https://nsearchives.nseindia.com/content/fo/fo_secban.csv",
  "https://archives.nseindia.com/content/fo/fo_secban.csv",
  "https://nsearchives.nseindia.com/content/fo/fo_secban.txt",
];

/** Validate a candidate token looks like a real NSE F&O underlying. */
const SYMBOL_RE = /^[A-Z][A-Z0-9&-]{1,14}$/;

/** Lines we never want to mis-parse as symbols. */
const BLACKLIST = new Set([
  "SYMBOL",
  "SECURITIES",
  "NAME",
  "PERIOD",
  "BAN",
  "DATE",
  "SR",
  "NO",
  "S",
  "REPORT",
  "DAILY",
  "SECURITY",
  "F&O",
  "FNO",
  "NSE",
  "TOTAL",
]);

function tryExtractSymbol(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  // Common formats:
  //   "1,ABFRL"     →  ABFRL
  //   "1#ABFRL"     →  ABFRL
  //   "ABFRL"       →  ABFRL
  //   "1\tABFRL"    →  ABFRL
  // Take whatever token sits AFTER the first separator if the line begins
  // with a numeric serial; otherwise the first token.
  const parts = trimmed.split(/[,\t#]+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const candidate =
    /^\d+$/.test(parts[0] ?? "") && parts.length >= 2 ? parts[1]! : parts[0]!;
  const up = candidate.toUpperCase();
  if (BLACKLIST.has(up)) return null;
  if (!SYMBOL_RE.test(up)) return null;
  return up;
}

async function tryFetch(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const r = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const txt = await r.text();
    if (!txt || txt.length < 5) return null;
    return txt;
  } catch {
    return null;
  }
}

function parseBody(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const sym = tryExtractSymbol(raw);
    if (!sym) continue;
    if (seen.has(sym)) continue;
    seen.add(sym);
    out.push(sym);
  }
  return out.sort();
}

async function refresh(): Promise<CacheEntry | null> {
  for (const url of CANDIDATE_URLS) {
    const body = await tryFetch(url);
    if (!body) continue;
    const symbols = parseBody(body);
    // Sanity: a real ban list has anywhere from 0 (rare) up to ~30 names.
    // If we got > 250 we almost certainly mis-parsed a different file.
    if (symbols.length > 250) {
      logger.warn(
        { url, count: symbols.length },
        "F&O ban list: parser produced too many symbols, ignoring",
      );
      continue;
    }
    const entry: CacheEntry = {
      ts: Date.now(),
      symbols,
      set: new Set(symbols),
      sourceUrl: url,
      fetchedAt: new Date().toISOString(),
    };
    logger.info({ count: symbols.length, url }, "F&O ban list loaded");
    return entry;
  }
  // Total failure on every URL.
  logger.warn("F&O ban list: all upstream URLs unreachable");
  return null;
}

/**
 * Machine-readable F&O ban list availability status.
 *
 *   CURRENT          — fresh upstream fetch or in-TTL cache; admission can be authorized.
 *   LAST_KNOWN_STALE — all upstream refreshes failed; serving expired cache;
 *                      DO NOT use for admission authorization.
 *   UNAVAILABLE      — no data at all; admission status is UNKNOWN.
 */
export type FnoBanStatus = "CURRENT" | "LAST_KNOWN_STALE" | "UNAVAILABLE";

export interface FnoBanList {
  symbols: string[];
  count: number;
  sourceUrl: string | null;
  /**
   * ISO timestamp of when this data was fetched from NSE upstream.
   * null when UNAVAILABLE (no successful fetch has occurred).
   */
  sourceAsOf: string | null;
  /**
   * true when data comes from a fresh upstream fetch or an in-TTL cache entry.
   * false for LAST_KNOWN_STALE (refresh failed) and UNAVAILABLE (no data).
   */
  currentAvailable: boolean;
  /**
   * true when we have any cached data (fresh or stale) we can return.
   * false ONLY when UNAVAILABLE.
   */
  hasLastKnown: boolean;
  /**
   * true when serving an expired cache entry because all upstream refreshes failed.
   * false for CURRENT and UNAVAILABLE.
   */
  stale: boolean;
  /**
   * true ONLY when status === "CURRENT".
   *
   * NEVER use symbols to make admission decisions when canAuthorizeAdmission=false:
   *   - LAST_KNOWN_STALE: symbols reflect last-known state, not current; do NOT authorize
   *   - UNAVAILABLE: no data; cannot determine whether symbol is banned or not
   */
  canAuthorizeAdmission: boolean;
  /**
   * Machine-readable availability state. See FnoBanStatus above.
   */
  status: FnoBanStatus;
}

/** Returns the latest F&O ban list. In-memory cached for 30 min.
 *
 * Returns null only when no data has ever been fetched (UNAVAILABLE).
 * When the cache has expired and a refresh fails, returns a LAST_KNOWN_STALE
 * result with canAuthorizeAdmission=false.
 */
export async function getFnoBanList(): Promise<FnoBanList | null> {
  // 1. Warm cache, still inside TTL → instant return (not stale: data is current).
  if (cache && Date.now() - cache.ts < TTL_MS) {
    return toDto(cache, false);
  }
  // 2. Another caller is already refreshing → ride that promise.
  if (inflight) {
    const fresh = await inflight;
    if (fresh) return toDto(fresh, false);
    // Refresh completed but returned null → serve expired cache as STALE, or null.
    return cache ? toDto(cache, true) : null;
  }
  // 3. We are the refresher.
  const p = refresh().then((r) => {
    if (r) cache = r;
    inflight = null;
    return r;
  });
  inflight = p;
  const fresh = await p;
  if (fresh) return toDto(fresh, false);
  // Refresh failed — fall back to whatever we last had, marked explicitly STALE.
  return cache ? toDto(cache, true) : null;
}

function toDto(e: CacheEntry, stale: boolean): FnoBanList {
  if (stale) {
    // LAST_KNOWN_STALE: serving expired cache because refresh failed.
    // canAuthorizeAdmission=false — callers must not use for admission decisions.
    return {
      symbols: e.symbols,
      count: e.symbols.length,
      sourceUrl: e.sourceUrl,
      sourceAsOf: e.fetchedAt,
      currentAvailable: false,
      hasLastKnown: true,
      stale: true,
      canAuthorizeAdmission: false,
      status: "LAST_KNOWN_STALE",
    };
  }
  // CURRENT: in-TTL or just fetched successfully.
  // canAuthorizeAdmission=true — symbols are the authoritative current ban list.
  return {
    symbols: e.symbols,
    count: e.symbols.length,
    sourceUrl: e.sourceUrl,
    sourceAsOf: e.fetchedAt,
    currentAvailable: true,
    hasLastKnown: true,
    stale: false,
    canAuthorizeAdmission: true,
    status: "CURRENT",
  };
}

/**
 * Tri-state F&O ban check.
 *
 * Returns:
 *   true  — symbol is on the current ban list (source was reachable)
 *   false — symbol is NOT on the ban list (source was reachable)
 *   null  — upstream is UNAVAILABLE (all refresh URLs failed, no stale cache)
 *
 * CRITICAL: never collapse null→false. A null return means the ban-list source
 * was unreachable, not that the symbol is clear. Callers must treat null as
 * UNAVAILABLE (show "BAN STATUS UNAVAILABLE"), never as ALL_CLEAR.
 *
 * The old isFnoBanned() returned false when upstream was unreachable — this was
 * a false-zero that could convert a data-outage into an ALL_CLEAR signal.
 */
export async function isFnoBanned(symbol: string): Promise<boolean | null> {
  const list = await getFnoBanList();
  // Fail closed for both UNAVAILABLE (list=null) and LAST_KNOWN_STALE (canAuthorizeAdmission=false).
  // A stale ban list cannot authorize admission — even "not in the stale list" must not return false.
  if (list === null || !list.canAuthorizeAdmission) return null;
  return cache?.set.has(symbol.toUpperCase()) ?? false;
}

/**
 * Legacy convenience wrapper — TEST/COMPAT-ISOLATED ONLY.
 * Converts null→false with an explicit warning.
 *
 * RESTRICTIONS (enforced by p33b.fnoBanGuard.test.ts import-guard):
 *   • No production route may import this function.
 *   • No signal consumer (preMarket, fnoSignal, swingScanner, etc.) may import this.
 *   • Only test helpers and explicit compatibility shims (with owner sign-off) may import it.
 *
 * Use isFnoBanned() directly and branch true/false/null for honest availability reporting.
 * null = ban-list source UNAVAILABLE → render "BAN STATUS UNAVAILABLE", never "ALL CLEAR".
 *
 * @deprecated Use isFnoBanned() (tri-state: boolean | null) for production paths.
 */
export async function isFnoBannedLegacy(symbol: string): Promise<boolean> {
  const result = await isFnoBanned(symbol);
  if (result === null) {
    logger.warn({ symbol }, "isFnoBannedLegacy: upstream UNAVAILABLE — returning false (conservative). Use isFnoBanned() to handle null.");
    return false;
  }
  return result;
}
