import type { Indicators, Quote, StockHistory, StockRow } from "@workspace/api-zod";
import { UNIVERSE, INACTIVE_SYMBOLS, type UniverseEntry } from "./universe";
import { fetchChart, fetchIntraday, yahooTickerFor, type YahooChart } from "./yahoo";
import { adx, atr, avgVolume, ema, macd, rollingVwap, rsi, sessionVwap, supportResistance, volumeProfile, pivots } from "./indicators";
import { buildRecommendation } from "./scoring";
import { logger } from "./logger";
import { getDeliveryPct } from "./nseBhavcopy";
import { getLiveQuote } from "./kiteFeed";
import { fetchKiteEquityIntraday } from "./kiteIntraday";
import { buildSourceProvenance } from "./scannerProvenance";

interface CachedHistory {
  fetchedAt: number;
  chart: YahooChart;
}

const HISTORY_TTL_MS = 30 * 60 * 1000;
const SCAN_TTL_MS = 60 * 1000;

const historyCache = new Map<string, CachedHistory>();
const intradayVwapCache = new Map<string, { ts: number; vwap: number | null }>();
// 30s — must stay strictly less than the underlying kiteIntraday cache
// (60s) so the worst-case freshness for an equity VWAP is bounded by
// `30s + max-age-of-current-kite-cache-entry`. Going looser (e.g. 90s)
// compounds with the inner cache to ~150s of staleness — long enough
// for a 15-minute bar to roll over and a VWAP-reclaim signal to misfire.
const INTRADAY_TTL = 30 * 1000;

let scanCache: { fetchedAt: number; rows: StockRow[] } | null = null;
// We bind both the in-flight Promise *and* the shared accumulator together
// so that every concurrent awaiter (not just the one that started the scan)
// can read the partial rows when its hard-timeout fires.
let scanInFlight: { work: Promise<StockRow[]>; acc: ScanAccumulator } | null = null;

export async function getHistory(
  symbol: string,
  range: "1mo" | "3mo" | "6mo" | "1y" | "2y" = "6mo",
): Promise<YahooChart | null> {
  const key = `${symbol}:${range}`;
  const cached = historyCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < HISTORY_TTL_MS) return cached.chart;
  const chart = await fetchChart(symbol, range);
  if (chart) historyCache.set(key, { fetchedAt: Date.now(), chart });
  return chart;
}

async function getIntradayVwap(symbol: string): Promise<number | null> {
  const cached = intradayVwapCache.get(symbol);
  if (cached && Date.now() - cached.ts < INTRADAY_TTL) return cached.vwap;
  try {
    // Kite-first: live 15-minute candles direct from the broker (no
    // 15-min Yahoo delay, no rate limits during US overlap). When Kite
    // is offline OR the symbol isn't an NSE EQ instrument, fall back to
    // Yahoo via yahooTickerFor() so renamed tickers (ZOMATO→ETERNAL,
    // MCDOWELL-N→UNITDSPR, NIPPONLIFE→NAM-INDIA, GMRINFRA→GMRAIRPORT)
    // still resolve.
    let intra = await fetchKiteEquityIntraday(symbol, "15minute", 1);
    if (!intra || intra.close.length < 4) {
      intra = await fetchIntraday(yahooTickerFor(symbol), "15m", "1d");
    }
    if (!intra || intra.close.length < 4) {
      intradayVwapCache.set(symbol, { ts: Date.now(), vwap: null });
      return null;
    }
    const vwapSeries = sessionVwap(intra.high, intra.low, intra.close, intra.volume);
    const v = vwapSeries[vwapSeries.length - 1] ?? null;
    intradayVwapCache.set(symbol, { ts: Date.now(), vwap: v });
    return v;
  } catch {
    intradayVwapCache.set(symbol, { ts: Date.now(), vwap: null });
    return null;
  }
}

function quoteFromChart(entry: UniverseEntry, chart: YahooChart): Quote | null {
  const meta = chart.meta;
  if (meta.regularMarketPrice == null) return null;
  // Prefer the live Kite tick for *price + intraday H/L/V* if available; fall
  // back to Yahoo (~15-min delayed) otherwise. We always keep the historical
  // chart-derived prevClose & 52-week levels from Yahoo since Kite ticks
  // don't carry those.
  //
  // Strict no-synthetic policy: previously we collapsed missing prevClose to
  // `regularMarketPrice` (zero change), and missing high/low to
  // `Math.max/min(price, todayOpen)` — both fabricate a "real" quote field
  // out of the live price. Now: previousClose, high, low, and todayOpen
  // are required to be REAL. If any one is missing we drop the quote
  // entirely (`return null`) — the caller treats that as "no data" and
  // never presents a fake one to the user.
  const live = getLiveQuote(entry.symbol);
  const closes = chart.close;
  const lastIdx = closes.length - 1;
  const todayOpenY = chart.open[lastIdx] ?? null;
  const prevCloseRaw = lastIdx >= 1
    ? (closes[lastIdx - 1] ?? meta.chartPreviousClose ?? null)
    : (meta.chartPreviousClose ?? null);

  const price = live?.ltp ?? meta.regularMarketPrice;
  const todayOpen = live?.open ?? todayOpenY;
  const high = live?.high ?? meta.regularMarketDayHigh ?? null;
  const low = live?.low ?? meta.regularMarketDayLow ?? null;
  // Volume must be REAL — Kite tick → Yahoo meta → last daily-bar volume.
  // If all three are missing we used to silently substitute 0, which then
  // routed through scoring's `volRatio < 0.6` "Low volume" rule and biased
  // every score bearish. No-synthetic policy: drop the quote instead.
  const volumeRaw = live?.volume ?? meta.regularMarketVolume ?? chart.volume[lastIdx] ?? null;
  if (
    prevCloseRaw == null || todayOpen == null || high == null || low == null
    || volumeRaw == null
  ) {
    return null;
  }
  const prevClose = prevCloseRaw;
  const volume = volumeRaw;
  const change = price - prevClose;
  const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;
  const avgV = avgVolume(chart.volume.slice(0, -1).filter(v => v > 0), 20);
  const updatedAt = live ? new Date(live.ts) : new Date((meta.regularMarketTime ?? Date.now() / 1000) * 1000);
  return {
    symbol: entry.symbol,
    name: meta.longName ?? meta.shortName ?? entry.name,
    exchange: meta.exchangeName ?? "NSE",
    price: round2(price),
    change: round2(change),
    changePercent: round2(changePct),
    open: round2(todayOpen),
    high: round2(high),
    low: round2(low),
    previousClose: round2(prevClose),
    volume,
    avgVolume: avgV > 0 ? Math.round(avgV) : undefined,
    dayRange: `${round2(low)} - ${round2(high)}`,
    yearRange: meta.fiftyTwoWeekLow != null && meta.fiftyTwoWeekHigh != null
      ? `${round2(meta.fiftyTwoWeekLow)} - ${round2(meta.fiftyTwoWeekHigh)}`
      : undefined,
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh != null ? round2(meta.fiftyTwoWeekHigh) : undefined,
    fiftyTwoWeekLow: meta.fiftyTwoWeekLow != null ? round2(meta.fiftyTwoWeekLow) : undefined,
    updatedAt,
  };
}

interface ComputedSeries {
  indicators: Indicators;
  closes: number[];
  ema9Series: (number | null)[];
  ema21Series: (number | null)[];
  ema20Series: (number | null)[];
  ema50Series: (number | null)[];
  rsiSeries: (number | null)[];
  macdHistSeries: (number | null)[];
}

function computeIndicators(chart: YahooChart, quote: Quote, intradayVwap: number | null): ComputedSeries {
  const closes = chart.close;
  const ema9Series = ema(closes, 9);
  const ema21Series = ema(closes, 21);
  const ema20Series = ema(closes, 20);
  const ema50Series = ema(closes, 50);
  const ema100Series = ema(closes, 100);
  const ema200Series = ema(closes, 200);
  const rsiSeries = rsi(closes, 14);
  const atrSeries = atr(chart.high, chart.low, closes, 14);
  const adxSeries = adx(chart.high, chart.low, closes, 14);
  const macdRes = macd(closes);
  const avgVol = avgVolume(chart.volume.slice(0, -1).filter(v => v > 0), 20);
  const volumeRatio = avgVol > 0 ? quote.volume / avgVol : 1;
  const sr = supportResistance(chart.high, chart.low, 40);
  const vp = volumeProfile(chart.high, chart.low, closes, chart.volume, 24, 60);
  // VWAP fallback chain: live intraday session VWAP → 20-bar rolling VWAP → undefined
  // (NEVER fall back to spot price — that produces meaningless "spot vs VWAP" comparisons).
  const vwapNum = intradayVwap ?? rollingVwap(chart.high, chart.low, closes, chart.volume, 20);
  const vwap = vwapNum;

  // buildRow() above already guarantees chart.close.length >= 30, so dn is
  // always >= 2 here and the previous-bar OHLC reads below cannot fall off
  // the array. We deliberately do NOT add a `?? quote.price` fallback — that
  // would silently turn a thin-history symbol's "previous-day pivot" into the
  // current spot, producing a degenerate pivot at exactly today's price and
  // tricking scoring.ts into emitting "price respects pivot" signal noise.
  // No-synthetic-data rule: insufficient history → caller rejects the row.
  const dn = closes.length;
  const prevH = chart.high[dn - 2]!;
  const prevL = chart.low[dn - 2]!;
  const prevC = closes[dn - 2]!;
  const piv = pivots(prevH, prevL, prevC);

  // No-synthetic-data rule: every indicator below is left UNDEFINED when the
  // series is too short to compute it honestly. Substituting `quote.price`
  // for a missing EMA (or `50` for a missing RSI) silently passes "neutral"
  // signal noise into scoring.ts, biasing the score toward zero and
  // pretending we had evidence we didn't have. Scoring already gates every
  // rule on `!= null`, so the right thing is to pass the truth through.
  const ema9Last  = lastVal(ema9Series);
  const ema21Last = lastVal(ema21Series);
  const ema20Last = lastVal(ema20Series);
  const ema50Last = lastVal(ema50Series);
  const ema100Last = lastVal(ema100Series);
  const ema200Last = lastVal(ema200Series);
  const rsiLast   = lastVal(rsiSeries);
  const atrLast   = lastVal(atrSeries);
  const adxLast   = lastVal(adxSeries);
  const macdLast    = lastVal(macdRes.macd);
  const macdSigLast = lastVal(macdRes.signal);
  const macdHistLast= lastVal(macdRes.hist);

  // trendStrength is a derived 0-100 indicator that combines the EMA stack
  // and price-vs-EMA50 distance. With no EMA20 / EMA50 we have nothing
  // meaningful to anchor it on — leave it undefined so the UI shows "—".
  let trendStrength: number | undefined;
  if (ema20Last != null && ema50Last != null) {
    let ts = 50;
    if (ema20Last > ema50Last) ts += 15;
    else if (ema20Last < ema50Last) ts -= 15;
    ts += Math.max(-25, Math.min(25, ((quote.price - ema50Last) / ema50Last) * 200));
    trendStrength = Math.max(0, Math.min(100, Math.round(ts)));
  }

  // Delivery % is sourced exclusively from the real NSE bhavcopy in
  // buildRow(). When the bhavcopy is unreachable the field is left undefined
  // — we used to invent a 38–62 % "deterministic noise" number here, which
  // is exactly the kind of synthetic data the audit rules forbid.
  return {
    closes,
    ema9Series,
    ema21Series,
    ema20Series,
    ema50Series,
    rsiSeries,
    macdHistSeries: macdRes.hist,
    indicators: {
      ema9:  ema9Last  != null ? round2(ema9Last)  : undefined,
      ema21: ema21Last != null ? round2(ema21Last) : undefined,
      ema20: ema20Last != null ? round2(ema20Last) : undefined,
      ema50: ema50Last != null ? round2(ema50Last) : undefined,
      ema100: ema100Last != null ? round2(ema100Last) : undefined,
      ema200: ema200Last != null ? round2(ema200Last) : undefined,
      vwap: vwap != null ? round2(vwap) : undefined,
      rsi14: rsiLast != null ? round2(rsiLast) : undefined,
      macd:       macdLast    != null ? round2(macdLast)    : undefined,
      macdSignal: macdSigLast != null ? round2(macdSigLast) : undefined,
      macdHist:   macdHistLast!= null ? round2(macdHistLast): undefined,
      atr14: atrLast != null ? round2(atrLast) : undefined,
      adx14: adxLast != null ? round2(adxLast) : undefined,
      volumeRatio: avgVol > 0 ? round2(volumeRatio) : undefined,
      deliveryPct: undefined, // populated in buildRow() ONLY if real bhavcopy hit
      trendStrength,
      supportLevel: round2(sr.support),
      resistanceLevel: round2(sr.resistance),
      pivot: round2(piv.pivot),
      r1: round2(piv.r1),
      s1: round2(piv.s1),
      pointOfControl: vp ? round2(vp.pointOfControl) : undefined,
      valueAreaHigh: vp ? round2(vp.valueAreaHigh) : undefined,
      valueAreaLow: vp ? round2(vp.valueAreaLow) : undefined,
    },
  };
}

function lastVal(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i] as number;
  return null;
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

async function buildRow(entry: UniverseEntry): Promise<StockRow | null> {
  const chart = await getHistory(entry.symbol, "6mo");
  if (!chart || chart.close.length < 30) return null;
  const quote = quoteFromChart(entry, chart);
  if (!quote) return null;
  const intraVwap = await getIntradayVwap(entry.symbol);
  const computed = computeIndicators(chart, quote, intraVwap);

  // Real NSE delivery %. computeIndicators leaves this undefined; we ONLY
  // populate it from the bhavcopy. When bhavcopy is unreachable the field
  // stays undefined and scoring.ts skips the delivery-confirmation rule
  // (no synthetic 38–62 % placeholder is ever passed through).
  const realDelv = await getDeliveryPct(entry.symbol).catch(() => null);
  if (realDelv) {
    computed.indicators.deliveryPct = round2(realDelv.pct);
  }
  const recommendation = buildRecommendation({
    quote,
    indicators: computed.indicators,
    closes: computed.closes,
    ema9Series: computed.ema9Series,
    ema21Series: computed.ema21Series,
    ema20Series: computed.ema20Series,
    ema50Series: computed.ema50Series,
    rsiSeries: computed.rsiSeries,
    macdHistSeries: computed.macdHistSeries,
  });
  // Honest SIGNAL labelling. This row's recommendation/score is computed
  // ENTIRELY from the Yahoo daily history (`getHistory` -> `fetchChart`) plus a
  // Yahoo/Kite intraday VWAP — there is NO Kite candle path feeding the swing
  // indicators here. A live Kite LTP only overlays the *price*; it does NOT
  // make the SIGNAL authoritative. So we label provenance by the SIGNAL source
  // (Yahoo), which keeps `shouldDemoteSignal` honest: a Kite price tick can
  // never silently promote a Yahoo-derived swing signal to "authoritative".
  // `asOf` still carries the freshest displayed instant (the Kite LTP when
  // present) so freshness reflects the live price; the split is spelled out in
  // a warning. Quote is required, so an `asOf` source always resolves here.
  const live = getLiveQuote(entry.symbol);
  const asOfMs = live ? live.ts : new Date(quote.updatedAt).getTime();
  const provenance = buildSourceProvenance({
    provider: "yahoo",
    asOfSec: Number.isFinite(asOfMs) ? Math.floor(asOfMs / 1000) : null,
    tf: "15m",
    warnings: live
      ? ["Live price from Kite; swing indicators derived from delayed Yahoo daily candles."]
      : [],
  });
  return {
    symbol: entry.symbol,
    name: entry.name,
    sector: entry.sector,
    quote,
    indicators: computed.indicators,
    recommendation,
    provenance,
  };
}

// Hard cap on a single in-flight scan. With per-Yahoo-call timeouts in
// `yahoo.ts` (~6s) plus an unfriendly upstream, a 280-symbol scan could
// still in theory take minutes. We never want to hold an HTTP request
// open that long, so the awaiter stops waiting after this budget and
// returns whatever rows have already been collected (or whatever's in
// the cache). The underlying scan keeps running in the background and
// will populate the cache for the next request.
const SCAN_HARD_TIMEOUT_MS = 25_000;

// Mutable container the orchestrator can hand to the awaiter so it can
// peek at partial results when the hard timer fires.
interface ScanAccumulator { rows: StockRow[]; done: boolean }

async function performScan(acc?: ScanAccumulator): Promise<StockRow[]> {
  const rows = acc?.rows ?? [];
  const start = Date.now();
  let nullCount = 0;
  // Skip explicitly inactive symbols (delisted, no live feed) so we don't spam logs.
  const universe = UNIVERSE.filter(u => !u.inactive && !INACTIVE_SYMBOLS.has(u.symbol.toUpperCase()));
  const concurrency = 6;
  let cursor = 0;
  async function worker() {
    while (cursor < universe.length) {
      const idx = cursor++;
      const entry = universe[idx]!;
      try {
        const r = await buildRow(entry);
        if (r) rows.push(r);
        else nullCount++;
      } catch (err) {
        nullCount++;
        logger.warn({ err, symbol: entry.symbol }, "Failed to build row");
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  if (acc) acc.done = true;
  logger.info({ rows: rows.length, nullCount, ms: Date.now() - start }, "Scan complete");
  return rows;
}

export async function scanAll(): Promise<StockRow[]> {
  if (scanCache && Date.now() - scanCache.fetchedAt < SCAN_TTL_MS) return scanCache.rows;

  // Lazily start a scan if no one else has. The accumulator is shared
  // between the running scan and *every* awaiter below — so when any
  // caller's hard timer fires, that caller can hand back the partial
  // rows already built rather than wait for the full sweep to finish.
  if (!scanInFlight) {
    const acc: ScanAccumulator = { rows: [], done: false };
    const work = (async () => {
      try {
        const rows = await performScan(acc);
        if (rows.length > 0) {
          scanCache = { fetchedAt: Date.now(), rows };
        } else if (scanCache) {
          scanCache.fetchedAt = Date.now() - SCAN_TTL_MS + 15_000;
        }
        return scanCache?.rows ?? [];
      } finally {
        scanInFlight = null;
      }
    })();
    scanInFlight = { work, acc };
  }

  // EVERY caller — first or piggy-back — gets bounded by the same hard
  // budget. Without this, a slow Yahoo could leave the second/third
  // request to the same in-flight scan waiting indefinitely (`scanInFlight`
  // is unwrapped, with no timer of its own).
  const { work, acc } = scanInFlight;
  return new Promise<StockRow[]>(resolve => {
    let settled = false;
    const finish = (rows: StockRow[]) => { if (!settled) { settled = true; resolve(rows); } };
    const timer = setTimeout(() => {
      if (acc.done) return; // scan finished between schedule + fire — work.then will resolve us
      const partial = acc.rows.slice();
      const fallback = scanCache?.rows ?? [];
      // Prefer whichever is bigger — partial rows from the in-flight
      // scan, or the previously-cached set.
      const out = partial.length > fallback.length ? partial : fallback;
      logger.warn({ partial: partial.length, cached: fallback.length, returned: out.length }, "scanAll hard-timeout reached, returning partial/cached");
      finish(out);
    }, SCAN_HARD_TIMEOUT_MS);
    work.then(rows => { clearTimeout(timer); finish(rows); }).catch(err => {
      clearTimeout(timer);
      logger.warn({ err: (err as Error).message }, "scanAll failed");
      finish(scanCache?.rows ?? []);
    });
  });
}

/**
 * Synchronous accessor for the last completed scan. Returns whatever rows
 * are currently cached without ever awaiting Yahoo. Endpoints that need
 * breadth/A-D ratio for a fast-path response can use this and kick off a
 * fresh `scanAll()` in the background. Returns an empty array if the
 * cache hasn't been populated yet (cold boot).
 */
export function getCachedScanRows(): { rows: StockRow[]; fetchedAt: number | null } {
  if (!scanCache) return { rows: [], fetchedAt: null };
  return { rows: scanCache.rows, fetchedAt: scanCache.fetchedAt };
}

/**
 * Fire-and-forget scan refresh. Returns immediately. Used by fast-path
 * endpoints that serve `getCachedScanRows()` synchronously but want to
 * keep the cache warm.
 */
export function refreshScanInBackground(): void {
  void scanAll().catch(() => undefined);
}

/**
 * Cache-first accessor for endpoints that only need the latest scan snapshot
 * (sector/stock list + aggregation views). When the cache is warm it returns
 * instantly and refreshes in the background — sub-minute staleness is fine for
 * these dashboard views and far better than blocking the request up to
 * `scanAll()`'s 25s timeout. Only a cold boot (empty cache) blocks on a full
 * `scanAll()` so the very first request still returns real data.
 */
export async function getScanRowsFast(): Promise<StockRow[]> {
  return selectScanRows(getCachedScanRows().rows, refreshScanInBackground, scanAll);
}

/**
 * Pure branch logic behind {@link getScanRowsFast}, extracted so the warm/cold
 * decision can be unit-tested without touching the live cache or the network:
 * a warm cache (rows present) returns instantly and only schedules a background
 * refresh; a cold cache awaits the supplied full-scan. Production callers go
 * through `getScanRowsFast` and never pass these in.
 */
export async function selectScanRows(
  cachedRows: StockRow[],
  refresh: () => void,
  full: () => Promise<StockRow[]>,
): Promise<StockRow[]> {
  if (cachedRows.length > 0) {
    refresh();
    return cachedRows;
  }
  return full();
}

export async function getStockHistoryWithSeries(
  symbol: string,
  range: "1mo" | "3mo" | "6mo" | "1y" | "2y",
): Promise<StockHistory | null> {
  const chart = await getHistory(symbol, range);
  if (!chart) return null;
  // Bars with any missing OHLCV field are dropped rather than coerced to
  // 0 — painting a flat-zero volume bar onto the UI chart where Yahoo
  // returned `null` is exactly the kind of synthetic substitution the
  // audit forbids. Yahoo occasionally returns `null` for early
  // pre-market bars; honest absence > fake zero.
  const candles = chart.timestamps.flatMap((t, i) => {
    const o = chart.open[i], h = chart.high[i], l = chart.low[i],
          c = chart.close[i], v = chart.volume[i];
    if (o == null || h == null || l == null || c == null || v == null) return [];
    return [{
      t: new Date(t * 1000),
      o: round2(o), h: round2(h), l: round2(l), c: round2(c), v,
    }];
  });
  return {
    symbol,
    range,
    candles,
    ema20Series: ema(chart.close, 20).map(v => v == null ? null : round2(v)),
    ema50Series: ema(chart.close, 50).map(v => v == null ? null : round2(v)),
    rsiSeries: rsi(chart.close, 14).map(v => v == null ? null : round2(v)),
  };
}
