/**
 * Kite live intraday OHLCV for the index basket.
 *
 * Why this exists: optionSignals.ts previously sourced 15-minute candles
 * from Yahoo (`fetchIntraday(symbol, "15m", "5d")`). Yahoo's intraday
 * feed for Indian indices is delayed by 15 minutes, frequently rate
 * limits during US market overlap, and occasionally serves a stale
 * cached chart for hours. The result on the F&O Intraday tab was every
 * card stuck on "Waiting trigger" and many signals expiring at 15:30
 * without ever firing — even when the index actually broke the level
 * intra-session.
 *
 * Now that Kite is connected we pull `getHistoricalData` directly for
 * each index, getting real-time 15-minute candles that are fresh to
 * within the current bar and have no rate-limit issues for our scale.
 *
 * Returns the same `YahooChart` shape so optionSignals.buildContext is
 * a drop-in consumer. Returns null when Kite is offline so the caller
 * can fall back to Yahoo (no fabricated data, ever).
 */

import { getRestClient } from "./kiteAuth";
import { getInstrumentToken } from "./kiteFeed";
import { logger } from "./logger";
import type { YahooChart, YahooMeta } from "./yahoo";

/** Yahoo-symbol → Kite (exchange, tradingsymbol, instrument_token) for every
 *  index buildSignalsForIndex consumes. Tokens are the well-known publicly
 *  documented index tokens; we cross-check them against the live instrument
 *  dump on first use and overwrite if NSE/BSE ever changes them. */
interface IndexEntry {
  yahoo: string;
  exchange: "NSE" | "BSE";
  /** Exact tradingsymbol Kite accepts in `getInstruments(exchange)` lookup. */
  tradingSymbol: string;
  /** Pre-known instrument token; revalidated against the live dump. */
  fallbackToken: number;
}

const INDEX_TABLE: IndexEntry[] = [
  { yahoo: "^NSEI",                exchange: "NSE", tradingSymbol: "NIFTY 50",          fallbackToken: 256265 },
  { yahoo: "^NSEBANK",             exchange: "NSE", tradingSymbol: "NIFTY BANK",        fallbackToken: 260105 },
  { yahoo: "^CNXFIN",              exchange: "NSE", tradingSymbol: "NIFTY FIN SERVICE", fallbackToken: 257801 },
  // FINNIFTY alias — different parts of the codebase historically used
  // the newer Yahoo symbol. Both keys must hit the same Kite token so
  // hasKiteIntradayCoverage() returns true regardless of which side
  // calls us. Same for the major NSE indices that have both old and
  // new Yahoo aliases in the wild.
  { yahoo: "NIFTY_FIN_SERVICE.NS", exchange: "NSE", tradingSymbol: "NIFTY FIN SERVICE", fallbackToken: 257801 },
  { yahoo: "NIFTY_MID_SELECT.NS",  exchange: "NSE", tradingSymbol: "NIFTY MID SELECT",  fallbackToken: 288009 },
  // NIFTY NEXT 50 has no reliable Yahoo intraday symbol in 2026 (see
  // preMarket.ts comment) — use a synthetic Yahoo key so this entry only
  // resolves through the Kite path. Live bias for NIFTYNXT50 therefore
  // depends on an active Kite session; absence is handled gracefully by
  // computeLiveBias() (returns null → structural bias only).
  { yahoo: "NIFTY_NEXT_50.NS",     exchange: "NSE", tradingSymbol: "NIFTY NEXT 50",     fallbackToken: 270857 },
  { yahoo: "^BSESN",               exchange: "BSE", tradingSymbol: "SENSEX",            fallbackToken: 265    },
  { yahoo: "BSE-BANK.BO",          exchange: "BSE", tradingSymbol: "BANKEX",            fallbackToken: 274441 },
  // Phase-4 (2026-05-06): INDIA VIX must be in this table so kiteFeed
  // subscribeIndices() includes it in the WS subscription. Without it,
  // kiteIndexQuotes.allFresh check will permanently fail (because the
  // homepage strip's INDEX_MAP includes ^INDIAVIX) and the function
  // would always fall back to the REST batch path — defeating the
  // purpose of Phase-4. Token 264969 is the publicly-documented VIX
  // instrument_token; revalidated via the live dump on first use.
  { yahoo: "^INDIAVIX",            exchange: "NSE", tradingSymbol: "INDIA VIX",         fallbackToken: 264969 },
];

interface RawInstrument {
  instrument_token: number;
  tradingsymbol: string;
  exchange: string;
  segment?: string;
  name?: string;
}

/** instrument_token cache, revalidated once per day from the live dump. */
let tokenMap: Map<string, number> | null = null;
let tokenMapDate: string | null = null;

function istDayKey(): string {
  const d = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/**
 * Public accessor for the resolved index→token map. Returns null when
 * no Kite session is active. Used by kiteFeed.ts to subscribe the
 * KiteTicker WebSocket to live index spot ticks (Phase-4 2026-05-06).
 */
export async function getIndexTokenMap(): Promise<Map<string, number> | null> {
  const client = await getRestClient();
  if (!client) return null;
  try {
    return await ensureTokenMap(client.kc);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "getIndexTokenMap failed");
    return null;
  }
}

async function ensureTokenMap(kc: { getInstruments: (e: string) => Promise<unknown> }): Promise<Map<string, number>> {
  const today = istDayKey();
  if (tokenMap && tokenMapDate === today) return tokenMap;
  const map = new Map<string, number>();
  // Seed with fallback tokens first so we always have something even if
  // the instrument dump fails (rate-limit, transient 5xx, etc).
  for (const e of INDEX_TABLE) map.set(e.yahoo, e.fallbackToken);

  // Try to revalidate against live dumps (one per exchange we use).
  const exchanges = Array.from(new Set(INDEX_TABLE.map(e => e.exchange)));
  await Promise.all(exchanges.map(async (ex) => {
    try {
      const rows = (await kc.getInstruments(ex)) as RawInstrument[];
      for (const e of INDEX_TABLE.filter(x => x.exchange === ex)) {
        // Indices on Kite are tagged with segment === "INDICES" and have
        // instrument_type === "EQ" (idiosyncratic but stable). Match by
        // exact tradingsymbol — names are not unique across segments.
        const found = rows.find(r =>
          r.tradingsymbol === e.tradingSymbol &&
          (r.segment === "INDICES" || r.segment === undefined)
        );
        if (found && Number.isFinite(found.instrument_token) && found.instrument_token > 0) {
          map.set(e.yahoo, found.instrument_token);
        }
      }
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, exchange: ex },
        "Kite getInstruments failed; using hardcoded index tokens",
      );
    }
  }));

  tokenMap = map;
  tokenMapDate = today;
  return map;
}

interface RawCandle {
  date: Date | string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface CacheEntry { ts: number; data: YahooChart }
const cache = new Map<string, CacheEntry>();
// 60s cache — finer than the trigger-sweep cadence (60s) but coarse
// enough to stay well under Kite's 3 req/s historical API budget when
// the sweep runs across all 6 indices.
const CACHE_TTL_MS = 60 * 1000;

function cacheKey(yahoo: string, interval: string, daysBack: number): string {
  return `${yahoo}|${interval}|${daysBack}`;
}

// ---- Global throttle for Kite getHistoricalData ----
//
// Kite's documented historical-data budget is ~3 requests/sec. Without
// throttling, the parallel equity scanner (one call per stock symbol on
// a cold cache) and the F&O signal cycle (6 indices) collectively burst
// past the limit and the API returns "Too many requests" — which then
// (a) forces every caller to fall back to Yahoo, downgrading signal
// data quality, and (b) starves the F&O index calls of the bars needed
// to compute EMA21/RSI14/ATR14, leaving every signal stuck on BASELINE.
//
// Two primitives:
//   1) `nextSlotAt` — atomic single-counter token bucket. Each caller
//      reserves the next available slot (at most one slot per
//      HISTORICAL_MIN_INTERVAL_MS), so concurrent callers serialise
//      cleanly without any explicit lock.
//   2) `inflight` — per-cacheKey promise dedup. If three parallel
//      callers ask for the same (token, interval, daysBack) on a cold
//      cache, only one network round-trip fires; the other two await
//      the same promise.
//
// MAX_QUEUE bounds the queue depth so a Kite outage cannot pile up
// dozens of waiting callers — over the cap we fail fast and the caller
// falls back to Yahoo immediately rather than waiting tens of seconds.
const HISTORICAL_MIN_INTERVAL_MS = 400; // ≈ 2.5 req/sec, headroom under Kite's 3/sec limit.
const HISTORICAL_MAX_QUEUE = 30;

let nextSlotAt = 0;
let pendingCount = 0;
const inflight = new Map<string, Promise<YahooChart | null>>();

async function reserveHistoricalSlot(): Promise<boolean> {
  if (pendingCount >= HISTORICAL_MAX_QUEUE) return false;
  pendingCount++;
  try {
    const now = Date.now();
    const slot = Math.max(now, nextSlotAt);
    nextSlotAt = slot + HISTORICAL_MIN_INTERVAL_MS;
    const wait = slot - now;
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    return true;
  } finally {
    pendingCount--;
  }
}

type KiteInterval = "minute" | "3minute" | "5minute" | "10minute" | "15minute" | "30minute" | "60minute" | "day";

// Kite's getHistoricalData expects either a Date or "yyyy-mm-dd HH:MM:SS"
// string interpreted as IST. The JS SDK's Date handling has flipped
// serialization across versions (toISOString vs toString) — passing a
// raw Date from a UTC-hosted Node process can request a 5h30m-shifted
// window, returning 0 candles for the morning session. We pass the
// explicit IST-anchored string form to remove that ambiguity.
function fmtIst(d: Date): string {
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  const yyyy = ist.getUTCFullYear();
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(ist.getUTCDate()).padStart(2, "0");
  const HH = String(ist.getUTCHours()).padStart(2, "0");
  const MM = String(ist.getUTCMinutes()).padStart(2, "0");
  const SS = String(ist.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${HH}:${MM}:${SS}`;
}

/**
 * Generic Kite-historical fetcher. Resolves to the same `YahooChart`
 * shape so every existing consumer keyed on Yahoo's response remains a
 * drop-in. Caller supplies its own `cacheLabel` (used as the cache key
 * AND as the YahooChart.symbol so downstream code that introspects
 * `chart.symbol` keeps working) and a Kite instrument_token.
 *
 * Returns null when:
 *   - Kite session is not active (caller must fall back to Yahoo)
 *   - Kite returned an empty / malformed series
 *   - The historical-data call threw (rate limit, transient 5xx, etc.)
 *
 * Never fabricates bars.
 */
export async function fetchKiteHistoricalByToken(
  token: number,
  cacheLabel: string,
  interval: KiteInterval,
  daysBack: number,
): Promise<YahooChart | null> {
  const k = cacheKey(cacheLabel, interval, daysBack);
  const cached = cache.get(k);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  // Inflight dedup: if a parallel caller already triggered the network
  // round-trip for this exact key, just await theirs. Otherwise create
  // the work and register it so the next concurrent caller piggy-backs.
  const existing = inflight.get(k);
  if (existing) return existing;

  const work = (async (): Promise<YahooChart | null> => {
    const slotOk = await reserveHistoricalSlot();
    if (!slotOk) {
      logger.warn(
        { cacheLabel, interval, token, queueDepth: pendingCount },
        "Kite historical-data throttle queue full; falling back to Yahoo",
      );
      return null;
    }

    const client = await getRestClient();
    if (!client) return null;
    const { kc } = client;

    const now = new Date();
    const toStr = fmtIst(now);
    const fromStr = fmtIst(new Date(now.getTime() - daysBack * 24 * 3600 * 1000));

    let raw: RawCandle[];
    try {
      raw = (await kc.getHistoricalData(token, interval, fromStr, toStr, false, false)) as RawCandle[];
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, cacheLabel, interval, token },
        "Kite getHistoricalData failed; caller will fall back to Yahoo",
      );
      return null;
    }

    if (!Array.isArray(raw) || raw.length === 0) return null;

    const timestamps: number[] = [];
    const open: number[] = [];
    const high: number[] = [];
    const low: number[] = [];
    const close: number[] = [];
    const volume: number[] = [];
    for (const c of raw) {
      const tsMs = c.date instanceof Date ? c.date.getTime() : new Date(c.date).getTime();
      if (!Number.isFinite(tsMs)) continue;
      if (![c.open, c.high, c.low, c.close].every(v => Number.isFinite(v) && v > 0)) continue;
      timestamps.push(Math.floor(tsMs / 1000));
      open.push(c.open);
      high.push(c.high);
      low.push(c.low);
      close.push(c.close);
      // Cash-index volume from Kite is 0 for NIFTY/BANKNIFTY/etc — the
      // detectors that consume volume already gate on null vs zero, so
      // emit zero (downstream filters reject zero before treating it as
      // a real reading).
      volume.push(c.volume > 0 ? c.volume : 0);
    }

    if (close.length === 0) return null;

    const lastClose = close[close.length - 1]!;
    const meta: YahooMeta = {
      symbol: cacheLabel,
      regularMarketPrice: lastClose,
      regularMarketDayHigh: Math.max(...high),
      regularMarketDayLow: Math.min(...low),
      regularMarketTime: timestamps[timestamps.length - 1],
      chartPreviousClose: close[0],
    };

    const chart: YahooChart = {
      symbol: cacheLabel,
      meta,
      timestamps,
      open, high, low, close, volume,
    };
    cache.set(k, { ts: Date.now(), data: chart });
    return chart;
  })().finally(() => {
    // Always clear inflight, even on error/null, so the next call can
    // retry rather than perpetually returning the failed promise.
    inflight.delete(k);
  });

  inflight.set(k, work);
  return work;
}

/**
 * Index-aware wrapper. Resolves the index `yahooSymbol` (e.g. "^NSEI")
 * to its Kite instrument_token via `INDEX_TABLE` (revalidated daily
 * against the live dump) and delegates to `fetchKiteHistoricalByToken`.
 */
export async function fetchKiteIntraday(
  yahooSymbol: string,
  interval: KiteInterval,
  daysBack: number,
): Promise<YahooChart | null> {
  const entry = INDEX_TABLE.find(e => e.yahoo === yahooSymbol);
  if (!entry) return null;

  const client = await getRestClient();
  if (!client) return null;
  const { kc } = client;

  let token: number;
  try {
    const map = await ensureTokenMap(kc);
    const t = map.get(yahooSymbol);
    if (!t) return null;
    token = t;
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, yahooSymbol },
      "Kite intraday: token resolution failed",
    );
    return null;
  }

  return fetchKiteHistoricalByToken(token, yahooSymbol, interval, daysBack);
}

/**
 * Equity-aware wrapper. Resolves an NSE EQ tradingsymbol (e.g. "RELIANCE")
 * via the kiteFeed instrument-dump cache and pulls live intraday/daily
 * candles from Kite. Returns null when no Kite session is active OR the
 * symbol is not an NSE EQ instrument — caller should fall back to Yahoo.
 */
export async function fetchKiteEquityIntraday(
  nseSymbol: string,
  interval: KiteInterval,
  daysBack: number,
): Promise<YahooChart | null> {
  const token = await getInstrumentToken(nseSymbol);
  if (!token) return null;
  return fetchKiteHistoricalByToken(token, `EQ:${nseSymbol}`, interval, daysBack);
}

/** True when we have an index-token entry (not a fallback for arbitrary symbols). */
export function hasKiteIntradayCoverage(yahooSymbol: string): boolean {
  return INDEX_TABLE.some(e => e.yahoo === yahooSymbol);
}
