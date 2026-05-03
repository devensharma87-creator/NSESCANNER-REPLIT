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
  { yahoo: "^NSEI",               exchange: "NSE", tradingSymbol: "NIFTY 50",          fallbackToken: 256265 },
  { yahoo: "^NSEBANK",            exchange: "NSE", tradingSymbol: "NIFTY BANK",        fallbackToken: 260105 },
  { yahoo: "^CNXFIN",             exchange: "NSE", tradingSymbol: "NIFTY FIN SERVICE", fallbackToken: 257801 },
  { yahoo: "NIFTY_MID_SELECT.NS", exchange: "NSE", tradingSymbol: "NIFTY MID SELECT",  fallbackToken: 288009 },
  { yahoo: "^BSESN",              exchange: "BSE", tradingSymbol: "SENSEX",            fallbackToken: 265    },
  { yahoo: "BSE-BANK.BO",         exchange: "BSE", tradingSymbol: "BANKEX",            fallbackToken: 274441 },
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

type KiteInterval = "minute" | "3minute" | "5minute" | "10minute" | "15minute" | "30minute" | "60minute" | "day";

/**
 * Fetch live OHLCV from Kite for an index, returning the same `YahooChart`
 * shape consumed by optionSignals.buildContext. Returns null when:
 *   - Kite session is not active (caller must fall back to Yahoo)
 *   - Token resolution failed AND no fallback was usable
 *   - Kite returned an empty / malformed series
 *
 * Never fabricates bars.
 */
export async function fetchKiteIntraday(
  yahooSymbol: string,
  interval: KiteInterval,
  daysBack: number,
): Promise<YahooChart | null> {
  const k = cacheKey(yahooSymbol, interval, daysBack);
  const cached = cache.get(k);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

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

  // Kite's getHistoricalData expects either a Date or "yyyy-mm-dd HH:MM:SS"
  // string interpreted as IST. The JS SDK's Date handling has flipped
  // serialization across versions (toISOString vs toString) — passing a
  // raw Date from a UTC-hosted Node process can request a 5h30m-shifted
  // window, returning 0 candles for the morning session. We pass the
  // explicit IST-anchored string form to remove that ambiguity.
  const fmtIst = (d: Date): string => {
    const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
    const yyyy = ist.getUTCFullYear();
    const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(ist.getUTCDate()).padStart(2, "0");
    const HH = String(ist.getUTCHours()).padStart(2, "0");
    const MM = String(ist.getUTCMinutes()).padStart(2, "0");
    const SS = String(ist.getUTCSeconds()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${HH}:${MM}:${SS}`;
  };
  const now = new Date();
  const toStr = fmtIst(now);
  const fromStr = fmtIst(new Date(now.getTime() - daysBack * 24 * 3600 * 1000));

  let raw: RawCandle[];
  try {
    raw = (await kc.getHistoricalData(token, interval, fromStr, toStr, false, false)) as RawCandle[];
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, yahooSymbol, interval, token },
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
    // emit null when Kite reports 0 to keep that downstream path honest.
    volume.push(c.volume > 0 ? c.volume : 0);
  }

  if (close.length === 0) return null;

  const lastClose = close[close.length - 1]!;
  const meta: YahooMeta = {
    symbol: yahooSymbol,
    regularMarketPrice: lastClose,
    regularMarketDayHigh: Math.max(...high),
    regularMarketDayLow: Math.min(...low),
    regularMarketTime: timestamps[timestamps.length - 1],
    chartPreviousClose: close[0],
  };

  const chart: YahooChart = {
    symbol: yahooSymbol,
    meta,
    timestamps,
    open, high, low, close, volume,
  };
  cache.set(k, { ts: Date.now(), data: chart });
  return chart;
}

/** True when we have an index-token entry (not a fallback for arbitrary symbols). */
export function hasKiteIntradayCoverage(yahooSymbol: string): boolean {
  return INDEX_TABLE.some(e => e.yahoo === yahooSymbol);
}
