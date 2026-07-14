import { logger } from "./logger";

/**
 * ETF Net Asset Value (NAV) sourcing — AMFI (Association of Mutual Funds in
 * India) daily NAV feed.
 *
 * AMFI publishes the official end-of-day NAV for every Indian mutual-fund
 * scheme (ETFs included) as a public, semicolon-delimited text file. This is
 * the canonical, free NAV source — we NEVER fabricate a NAV. The feed is
 * keyed by ISIN, so we map each whitelisted NSE ETF trading symbol to its
 * verified ISIN (curated below) and look the NAV up by ISIN.
 *
 * IMPORTANT honesty notes:
 *   - The AMFI NAV is END-OF-DAY (the latest published trading session), not a
 *     live intraday iNAV. So a premium/discount computed against a live CMP is
 *     APPROXIMATE and slightly lagged — the route surfaces the NAV date so the
 *     UI can label it. This is standard for retail tooling (true real-time
 *     iNAV requires a paid exchange feed).
 *   - When the feed is unreachable or a symbol has no ISIN mapping, callers get
 *     null and the UI shows an explicit "NAV unavailable" — never a guess.
 */

/** Source URL for AMFI's daily NAV dump (all schemes). */
const AMFI_NAV_URL = "https://www.amfiindia.com/spages/NAVAll.txt";

/** Hard timeout for the AMFI fetch (the file is ~1.6 MB plain text). */
const FETCH_TIMEOUT_MS = 12_000;

/** In-memory cache TTL. NAV is published once per day; 1h keeps it fresh
 *  enough while sparing the upstream from repeated multi-MB downloads. */
const TTL_MS = 60 * 60 * 1000;

/**
 * Date the curated symbol -> ISIN map was last verified against the live AMFI
 * NAVAll.txt feed. Surface this in the UI alongside the reference note.
 */
export const ETF_ISIN_MAP_AS_OF = "2026-06-03";

/**
 * Curated, VERIFIED map of whitelisted NSE ETF trading symbol -> ISIN. Each
 * ISIN was confirmed present in the live AMFI NAVAll.txt feed (see the
 * "as of" date above). Mirrors `ETF_WHITELIST` in kiteScanner.ts. ETFs absent
 * here resolve to null unless the caller supplies an ISIN override (e.g. from
 * the user's own holding row).
 */
export const ETF_ISIN_MAP: ReadonlyMap<string, string> = new Map<string, string>([
  ["NIFTYBEES", "INF204KB14I2"],
  ["BANKBEES", "INF204KB15I9"],
  ["GOLDBEES", "INF204KB17I5"],
  ["JUNIORBEES", "INF732E01045"],
  ["LIQUIDBEES", "INF732E01037"],
  ["PSUBNKBEES", "INF204KB16I7"],
  ["SILVERBEES", "INF204KC1402"],
  ["ITBEES", "INF204KB15V2"],
  ["PHARMABEES", "INF204KC1089"],
  ["CPSEETF", "INF457M01133"],
  ["SETFNIF50", "INF200KA1FS1"],
  ["SETFNIFBK", "INF200KA1580"],
  ["SETFGOLD", "INF200KA16D8"],
  ["ICICIB22", "INF109KB15Y7"],
  ["MON100", "INF247L01AP3"],
  ["MAFANG", "INF769K01HF4"],
  ["MASPTOP50", "INF769K01HP3"],
  ["NIFTYIETF", "INF109K012R6"],
  ["BANKIETF", "INF109KC15I8"],
  ["GOLDIETF", "INF109KC1NT3"],
  ["SILVERIETF", "INF109KC1Y56"],
]);

/** Validate the loose shape of an ISIN (12 alphanumerics, INF/INE… prefix). */
export function isValidIsin(isin: string): boolean {
  return /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin.trim().toUpperCase());
}

/**
 * Resolve the ISIN to look up a NAV for. Prefers a caller-supplied override
 * (e.g. the user's own holding ISIN) so ETFs outside the curated map still
 * work; falls back to the curated map. Returns null when neither yields a
 * valid ISIN.
 */
export function resolveEtfIsin(symbol: string, override?: string | null): string | null {
  const ov = (override ?? "").trim().toUpperCase();
  if (ov && isValidIsin(ov)) return ov;
  return ETF_ISIN_MAP.get(symbol.trim().toUpperCase()) ?? null;
}

/** One AMFI NAV datum for a single ISIN. */
export interface AmfiNavEntry {
  isin: string;
  nav: number;
  /** As published by AMFI, e.g. "03-Jun-2026". */
  navDate: string;
  schemeName: string;
}

interface CacheEntry {
  ts: number;
  byIsin: Map<string, AmfiNavEntry>;
}

let cache: CacheEntry | null = null;
let inflight: Promise<CacheEntry | null> | null = null;

/**
 * Parse the AMFI NAVAll.txt body into an ISIN -> entry map. The file is
 * semicolon-delimited:
 *
 *   Scheme Code;ISIN Div Payout/Growth;ISIN Div Reinvestment;Scheme Name;NAV;Date
 *
 * A scheme can list two ISINs (growth + reinvestment) — both are indexed to
 * the same NAV row. Non-data lines (headers, blank lines, category banners)
 * are skipped. NAVs that aren't finite positive numbers are dropped (e.g.
 * "N.A." for suspended schemes) — never coerced to a fake value.
 */
export function parseAmfiNav(body: string): Map<string, AmfiNavEntry> {
  const out = new Map<string, AmfiNavEntry>();
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || !line.includes(";")) continue;
    const cols = line.split(";");
    if (cols.length < 6) continue;
    const isin1 = cols[1]?.trim().toUpperCase() ?? "";
    const isin2 = cols[2]?.trim().toUpperCase() ?? "";
    const schemeName = cols[3]?.trim() ?? "";
    const navStr = cols[4]?.trim() ?? "";
    const navDate = cols[5]?.trim() ?? "";
    const nav = Number(navStr);
    if (!Number.isFinite(nav) || nav <= 0) continue;
    const entryFor = (isin: string): AmfiNavEntry => ({ isin, nav, navDate, schemeName });
    if (isin1 && isin1 !== "-" && isValidIsin(isin1)) out.set(isin1, entryFor(isin1));
    if (isin2 && isin2 !== "-" && isValidIsin(isin2)) out.set(isin2, entryFor(isin2));
  }
  return out;
}

async function refresh(): Promise<CacheEntry | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(AMFI_NAV_URL, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "text/plain" },
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "AMFI NAV fetch returned non-200");
      return null;
    }
    const body = await res.text();
    const byIsin = parseAmfiNav(body);
    if (byIsin.size === 0) {
      logger.warn("AMFI NAV feed parsed to zero entries");
      return null;
    }
    logger.info({ count: byIsin.size }, "AMFI NAV feed loaded");
    return { ts: Date.now(), byIsin };
  } catch (err) {
    logger.warn({ err }, "AMFI NAV fetch failed");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns the ISIN -> NAV map, in-memory cached for {@link TTL_MS}. Returns
 * null on total upstream failure (caller surfaces "NAV unavailable"). Never
 * fabricates data.
 */
export async function getAmfiNavMap(): Promise<Map<string, AmfiNavEntry> | null> {
  if (cache && Date.now() - cache.ts < TTL_MS) return cache.byIsin;
  if (inflight) {
    const r = await inflight;
    return r ? r.byIsin : null;
  }
  inflight = refresh().then(r => {
    if (r) cache = r;
    inflight = null;
    return r;
  });
  const r = await inflight;
  return r ? r.byIsin : null;
}

/** Outcome of an ETF NAV lookup, distinguishing the honest failure modes. */
export type EtfNavResult =
  | { status: "ok"; symbol: string; isin: string; nav: number; navDate: string; schemeName: string }
  | { status: "no_mapping"; symbol: string }
  | { status: "not_found"; symbol: string; isin: string }
  | { status: "feed_unavailable"; symbol: string };

/**
 * Resolve the latest published AMFI NAV for an ETF symbol. `isinOverride`
 * (e.g. the user's own holding ISIN) takes precedence over the curated map so
 * uncurated ETFs still work when the holding carries an ISIN.
 */
export async function loadEtfNav(symbol: string, isinOverride?: string | null): Promise<EtfNavResult> {
  const sym = symbol.trim().toUpperCase();
  const isin = resolveEtfIsin(sym, isinOverride);
  if (!isin) return { status: "no_mapping", symbol: sym };
  const map = await getAmfiNavMap();
  if (!map) return { status: "feed_unavailable", symbol: sym };
  const entry = map.get(isin);
  if (!entry) return { status: "not_found", symbol: sym, isin };
  return {
    status: "ok",
    symbol: sym,
    isin,
    nav: entry.nav,
    navDate: entry.navDate,
    schemeName: entry.schemeName,
  };
}

/** Reset the in-memory cache. Test-only seam. */
export function __resetEtfNavCacheForTest(): void {
  cache = null;
  inflight = null;
}
