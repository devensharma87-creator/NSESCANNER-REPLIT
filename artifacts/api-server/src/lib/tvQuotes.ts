/**
 * TradingView batch quote fetcher.
 *
 * Same backend as `giftNifty.ts` (TradingView's public scanner endpoint at
 * https://scanner.tradingview.com/global/scan) but generalised to fetch
 * many tickers in ONE POST and return a Map keyed by TV symbol.
 *
 * Why this exists — the indices board was rendering the entire Markets
 * tab (Global indices, Commodities, Indian ADRs, FX/Macro) with a
 * "DELAYED" badge because every non-Indian instrument was sourced from
 * Yahoo Finance (which the project documents as ~15-min delayed). The
 * TradingView scanner backend already returns near-real-time streaming
 * quotes for all of those categories — for the same instruments the
 * tradingview.com chart pages render — and is what the existing GIFT
 * NIFTY integration uses. Re-using it gives us live LTP/change for
 * the whole board without introducing any new API keys or paid feeds.
 *
 * Strict honesty rules (project-wide):
 *   - Returns null on any per-symbol failure; callers MUST treat null
 *     as "data unavailable" and fall back to Yahoo without renaming.
 *   - Cache is admitted only on successful fetches; partial responses
 *     populate the map for the rows that came back and omit the rest.
 *   - We never substitute one symbol's value for another.
 */
import { logger } from "./logger";

export interface TvQuote {
  /** Last traded price. */
  price: number;
  /** % change vs previous close (TradingView "change" column). */
  changePercent: number;
  /** Absolute change vs previous close. */
  change: number;
  /** Previous close, derived as price - change. */
  previousClose: number;
  /** Volume for the current session, when reported. */
  volume: number | null;
  /**
   * TradingView's `update_mode` — "streaming" (true real-time tick),
   * "delayed_streaming" (delayed but live-ticking), or "endofday" /
   * "delayed" (snapshot). Surfaced so the UI can be honest about
   * per-symbol data quality (e.g. some exchanges restrict free real-time).
   */
  updateMode: string | null;
  /** Unix-seconds when this snapshot was fetched. */
  asOf: number;
  /** TradingView symbol used to fetch (e.g. "TVC:SPX"). */
  tvSymbol: string;
}

const TV_SCANNER_URL = "https://scanner.tradingview.com/global/scan";
const FETCH_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 10_000;

let cache: { ts: number; quotes: Map<string, TvQuote> } | null = null;
/**
 * Inflight map keyed by the normalized ticker-set fingerprint (sorted,
 * deduped, joined with "|"). Two callers asking for the SAME set share a
 * single network round-trip; callers asking for DIFFERENT sets each get
 * their own request. The previous design used a single global inflight
 * promise, which leaked partial maps to a second caller asking for a
 * different ticker set than the first.
 */
const inflight = new Map<string, Promise<Map<string, TvQuote>>>();

function fingerprint(tickers: string[]): string {
  return [...tickers].sort().join("|");
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function round(n: number, p: number): number {
  const m = Math.pow(10, p);
  return Math.round(n * m) / m;
}

async function fetchOnce(tickers: string[]): Promise<Map<string, TvQuote>> {
  const out = new Map<string, TvQuote>();
  if (tickers.length === 0) return out;

  // Column order matters — the response `d` array is positional.
  const columns = ["close", "change", "change_abs", "volume", "update_mode"] as const;
  const body = {
    symbols: { tickers, query: { types: [] } },
    columns,
  };

  let res: Response;
  try {
    res = await fetchWithTimeout(TV_SCANNER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // TradingView's scanner endpoint 403s requests without a UA.
        "User-Agent": "Mozilla/5.0",
      },
      body: JSON.stringify(body),
    }, FETCH_TIMEOUT_MS);
  } catch (e) {
    logger.warn({ err: (e as Error).message, count: tickers.length }, "tvQuotes: scanner fetch failed");
    return out;
  }
  if (!res.ok) {
    logger.warn({ status: res.status, count: tickers.length }, "tvQuotes: scanner non-200");
    return out;
  }

  let json: unknown;
  try { json = await res.json(); } catch (e) {
    logger.warn({ err: (e as Error).message }, "tvQuotes: invalid JSON");
    return out;
  }

  // Expected shape:
  //   { totalCount: N, data: [ { s: "TVC:SPX", d: [close, chPct, chAbs, vol, mode] }, ... ] }
  const data = (json as { data?: Array<{ s?: string; d?: unknown[] }> })?.data;
  if (!Array.isArray(data)) {
    logger.warn({ json }, "tvQuotes: unexpected response shape");
    return out;
  }

  const now = Math.floor(Date.now() / 1000);
  for (const row of data) {
    const sym = row?.s;
    const d = row?.d;
    if (typeof sym !== "string" || !Array.isArray(d) || d.length < 3) continue;

    const price     = typeof d[0] === "number" ? (d[0] as number) : NaN;
    const changePct = typeof d[1] === "number" ? (d[1] as number) : NaN;
    const changeAbs = typeof d[2] === "number" ? (d[2] as number) : NaN;
    const volume    = typeof d[3] === "number" ? (d[3] as number) : null;
    const mode      = typeof d[4] === "string" ? (d[4] as string) : null;

    if (!Number.isFinite(price) || price <= 0) continue;
    if (!Number.isFinite(changePct) || !Number.isFinite(changeAbs)) continue;

    const previousClose = price - changeAbs;
    if (!Number.isFinite(previousClose) || previousClose <= 0) continue;

    out.set(sym, {
      price: round(price, 4),
      changePercent: round(changePct, 3),
      change: round(changeAbs, 4),
      previousClose: round(previousClose, 4),
      volume,
      updateMode: mode,
      asOf: now,
      tvSymbol: sym,
    });
  }
  return out;
}

/**
 * Fetch live quotes for a batch of TradingView tickers, deduped + cached.
 *   - Returns a Map keyed by the EXACT ticker string supplied (e.g. "TVC:SPX").
 *   - Concurrent callers share a single inflight request.
 *   - On total failure, returns an empty Map (callers must handle missing
 *     entries by falling back to Yahoo for those symbols).
 *   - Cache TTL matches the indices-board cache (10s) so the whole pipeline
 *     refreshes in lock-step.
 */
export async function getTvQuotes(tickers: string[]): Promise<Map<string, TvQuote>> {
  const unique = Array.from(new Set(tickers.filter(t => typeof t === "string" && t.length > 0)));
  if (unique.length === 0) return new Map();

  // Cache hit only if it covers every requested ticker — partial coverage
  // would force per-symbol bookkeeping we don't need at this scale (~25
  // symbols, single batched request).
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    const allCovered = unique.every(t => cache!.quotes.has(t));
    if (allCovered) return cache.quotes;
  }
  // Coalesce concurrent callers asking for the SAME ticker set onto one
  // request. Different sets (e.g. board vs an ad-hoc subset) each get
  // their own inflight slot so a smaller request never silently returns
  // a map missing tickers it asked for.
  const fp = fingerprint(unique);
  const existing = inflight.get(fp);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const quotes = await fetchOnce(unique);
      // Always update the cache, even on a partial response — the next
      // caller still benefits from whatever rows we did get back. An
      // empty map (total failure) does NOT poison the cache: we leave
      // the previous successful snapshot in place if one exists.
      if (quotes.size > 0) cache = { ts: Date.now(), quotes };
      return quotes;
    } finally {
      inflight.delete(fp);
    }
  })();
  inflight.set(fp, promise);
  return promise;
}
