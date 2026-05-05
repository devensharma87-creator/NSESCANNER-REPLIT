/**
 * GIFT NIFTY (NSE-IX International Exchange) live quote fetcher.
 *
 * Background — the real bug this module fixes:
 *   GIFT NIFTY (formerly SGX Nifty) is the overnight-tradable Nifty 50 index
 *   futures contract listed on NSE International Exchange (IFSC, Gujarat).
 *   It is THE primary pre-open signal used by every Indian desk because it
 *   trades almost 21 hours a day — its print right before 09:00 IST is what
 *   the cash market gaps to.
 *
 *   Yahoo Finance does NOT carry it under any public symbol (verified by
 *   `yf.search('GIFT NIFTY')` returning []). The previous implementation
 *   silently substituted `^NSEI` (NIFTY 50 cash spot) and labelled it
 *   "GIFT NIFTY (proxy)". That was wrong on two counts:
 *     1. NIFTY spot doesn't trade overnight, so its day-over-day % is
 *        yesterday's CASH session — not the overnight pre-open signal.
 *     2. The two prints can have OPPOSITE signs (e.g. cash closed -0.74%
 *        while GIFT was +0.34% the same overnight session) — which is
 *        exactly the failure mode the user hit.
 *
 * Source — TradingView's public "scanner" backend (the same JSON the
 * tradingview.com chart pages use). Symbol `NSEIX:NIFTY1!` is the
 * front-month GIFT NIFTY 50 Index Futures continuous contract,
 * description "GIFT NIFTY 50 INDEX FUTURES", update_mode "streaming".
 *
 * Strict honesty rules (project-wide):
 *   - Returns null on ANY failure (network, parse, missing fields).
 *   - NEVER falls back to ^NSEI / NIFTY spot — that fallback is exactly
 *     the bug we are fixing.
 *   - Cache is admitted only on a complete successful fetch.
 */
import { logger } from "./logger";

export interface GiftNiftyQuote {
  /** Last traded price (front-month GIFT NIFTY future). */
  price: number;
  /** Absolute change vs previous settlement. */
  change: number;
  /** % change vs previous settlement. */
  changePercent: number;
  /** Previous settlement price (derived: price - change). */
  previousClose: number;
  /** Volume traded in the current session (lots). */
  volume: number | null;
  /** Unix-seconds — wall-clock when the fetch was made. TradingView's
   *  scanner endpoint does not expose a per-quote timestamp on this
   *  response shape, so we record the fetch time. */
  asOf: number;
  /**
   * Raw TradingView `update_mode` for this row — surfaced so the UI
   * pill can be honest about freshness instead of hardcoding "LIVE".
   * Common values: "streaming" (real-time), "delayed_streaming_900"
   * (~15min delayed but live-updating), "endofday" (snapshot). May be
   * null if the column was missing in the response.
   */
  updateMode: string | null;
  /** Fixed source attribution — surfaced in the UI as a "source: ..."
   *  caption so the user always knows the provenance. */
  source: "TradingView · NSEIX:NIFTY1!";
}

const TV_SCANNER_URL = "https://scanner.tradingview.com/global/scan";
const FETCH_TIMEOUT_MS = 6_000;
const CACHE_TTL_MS = 30_000;

let cache: { ts: number; quote: GiftNiftyQuote | null } | null = null;
let inflight: Promise<GiftNiftyQuote | null> | null = null;

/** Hard-timeout fetch wrapper — TradingView normally responds in <500ms
 *  but a hung connection must never block the pre-market endpoint. */
async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOnce(): Promise<GiftNiftyQuote | null> {
  // Body shape is exactly what the TradingView site sends. The columns
  // order matters — the response `d` array is positional.
  const body = {
    symbols: { tickers: ["NSEIX:NIFTY1!"], query: { types: [] } },
    columns: ["close", "change", "change_abs", "volume", "update_mode", "description"],
  };
  let res: Response;
  try {
    res = await fetchWithTimeout(TV_SCANNER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
      },
      body: JSON.stringify(body),
    }, FETCH_TIMEOUT_MS);
  } catch (e) {
    logger.warn({ err: (e as Error).message }, "giftNifty: TradingView scanner fetch failed");
    return null;
  }
  if (!res.ok) {
    logger.warn({ status: res.status }, "giftNifty: TradingView scanner non-200");
    return null;
  }
  let json: unknown;
  try { json = await res.json(); } catch (e) {
    logger.warn({ err: (e as Error).message }, "giftNifty: invalid JSON");
    return null;
  }
  // Expected shape:
  //   { totalCount: 1, data: [ { s: "NSEIX:NIFTY1!", d: [close, chPct, chAbs, vol, mode, desc] } ] }
  const data = (json as { data?: Array<{ s?: string; d?: unknown[] }> })?.data;
  const row = data?.[0];
  const d = row?.d;
  if (!Array.isArray(d) || d.length < 4) {
    logger.warn({ json }, "giftNifty: unexpected response shape");
    return null;
  }
  const price = typeof d[0] === "number" ? (d[0] as number) : NaN;
  const changePct = typeof d[1] === "number" ? (d[1] as number) : NaN;
  const changeAbs = typeof d[2] === "number" ? (d[2] as number) : NaN;
  const volume = typeof d[3] === "number" ? (d[3] as number) : null;
  const updateMode = typeof d[4] === "string" ? (d[4] as string) : null;
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(changePct) || !Number.isFinite(changeAbs)) {
    logger.warn({ d }, "giftNifty: missing or invalid numeric fields");
    return null;
  }
  const previousClose = price - changeAbs;
  if (!Number.isFinite(previousClose) || previousClose <= 0) {
    logger.warn({ price, changeAbs }, "giftNifty: derived previousClose invalid");
    return null;
  }
  return {
    price: round(price, 2),
    change: round(changeAbs, 2),
    changePercent: round(changePct, 3),
    previousClose: round(previousClose, 2),
    volume,
    asOf: Math.floor(Date.now() / 1000),
    updateMode,
    source: "TradingView · NSEIX:NIFTY1!",
  };
}

function round(n: number, p: number): number {
  const m = Math.pow(10, p);
  return Math.round(n * m) / m;
}

/**
 * Public accessor — cached, deduped, honest.
 *   - Returns the cached quote within `CACHE_TTL_MS` of the last successful fetch.
 *   - Coalesces concurrent callers onto a single inflight request.
 *   - On any failure, returns null and DOES NOT poison the cache (so the
 *     next caller will attempt a fresh fetch). Callers MUST treat null as
 *     "data unavailable" and never substitute another symbol's value.
 */
export async function getGiftNifty(): Promise<GiftNiftyQuote | null> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.quote;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const q = await fetchOnce();
      if (q) cache = { ts: Date.now(), quote: q };
      return q;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
