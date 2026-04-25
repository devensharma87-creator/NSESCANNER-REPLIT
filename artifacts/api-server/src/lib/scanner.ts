import type { Indicators, Quote, StockHistory, StockRow } from "@workspace/api-zod";
import { UNIVERSE, INACTIVE_SYMBOLS, type UniverseEntry } from "./universe";
import { fetchChart, fetchIntraday, yahooTickerFor, type YahooChart } from "./yahoo";
import { adx, atr, avgVolume, ema, macd, rollingVwap, rsi, sessionVwap, supportResistance, volumeProfile, pivots } from "./indicators";
import { buildRecommendation } from "./scoring";
import { logger } from "./logger";
import { getDeliveryPct } from "./nseBhavcopy";
import { getLiveQuote } from "./kiteFeed";

interface CachedHistory {
  fetchedAt: number;
  chart: YahooChart;
}

const HISTORY_TTL_MS = 30 * 60 * 1000;
const SCAN_TTL_MS = 60 * 1000;

const historyCache = new Map<string, CachedHistory>();
const intradayVwapCache = new Map<string, { ts: number; vwap: number | null }>();
const INTRADAY_TTL = 90 * 1000;

let scanCache: { fetchedAt: number; rows: StockRow[] } | null = null;
let scanInFlight: Promise<StockRow[]> | null = null;

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
    // Use yahooTickerFor() so renamed NSE symbols (ZOMATO→ETERNAL,
    // MCDOWELL-N→UNITDSPR, NIPPONLIFE→NAM-INDIA, GMRINFRA→GMRAIRPORT, …)
    // get translated to the live Yahoo ticker. Without this we logged
    // "No data found" warnings every scan cycle for these 4 names.
    const intra = await fetchIntraday(yahooTickerFor(symbol), "15m", "1d");
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
  const live = getLiveQuote(entry.symbol);
  const closes = chart.close;
  const lastIdx = closes.length - 1;
  const todayOpenY = chart.open[lastIdx] ?? meta.regularMarketPrice;
  const prevClose = lastIdx >= 1 ? (closes[lastIdx - 1] ?? meta.chartPreviousClose ?? meta.regularMarketPrice) : (meta.chartPreviousClose ?? meta.regularMarketPrice);

  const price = live?.ltp ?? meta.regularMarketPrice;
  const todayOpen = live?.open ?? todayOpenY;
  const high = live?.high ?? meta.regularMarketDayHigh ?? Math.max(price, todayOpen);
  const low = live?.low ?? meta.regularMarketDayLow ?? Math.min(price, todayOpen);
  const volume = live?.volume ?? meta.regularMarketVolume ?? chart.volume[lastIdx] ?? 0;
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

  const dn = closes.length;
  const prevH = dn >= 2 ? chart.high[dn - 2]! : chart.high[dn - 1] ?? quote.price;
  const prevL = dn >= 2 ? chart.low[dn - 2]! : chart.low[dn - 1] ?? quote.price;
  const prevC = dn >= 2 ? closes[dn - 2]! : closes[dn - 1] ?? quote.price;
  const piv = pivots(prevH, prevL, prevC);

  const ema20Last = lastVal(ema20Series) ?? quote.price;
  const ema50Last = lastVal(ema50Series) ?? quote.price;
  // ema100/ema200 are OPTIONAL in the schema — leave them undefined when the
  // series is too short rather than silently substituting ema50 (which would
  // make the UI display the same number twice and mislead the user).
  const ema100Last = lastVal(ema100Series);
  const ema200Last = lastVal(ema200Series);

  let trendStrength = 50;
  if (ema20Last > ema50Last) trendStrength += 15;
  else if (ema20Last < ema50Last) trendStrength -= 15;
  trendStrength += Math.max(-25, Math.min(25, ((quote.price - ema50Last) / ema50Last) * 200));
  trendStrength = Math.max(0, Math.min(100, Math.round(trendStrength)));

  // Placeholder — overridden in buildRow with the real NSE bhavcopy value
  // when available. Heuristic is the fallback only.
  const deliveryPct = estimateDeliveryPctHeuristic(quote);

  return {
    closes,
    ema9Series,
    ema21Series,
    ema20Series,
    ema50Series,
    rsiSeries,
    macdHistSeries: macdRes.hist,
    indicators: {
      ema9: round2(lastVal(ema9Series) ?? quote.price),
      ema21: round2(lastVal(ema21Series) ?? quote.price),
      ema20: round2(ema20Last),
      ema50: round2(ema50Last),
      ema100: ema100Last != null ? round2(ema100Last) : undefined,
      ema200: ema200Last != null ? round2(ema200Last) : undefined,
      vwap: vwap != null ? round2(vwap) : undefined,
      rsi14: round2(lastVal(rsiSeries) ?? 50),
      macd: round2(lastVal(macdRes.macd) ?? 0),
      macdSignal: round2(lastVal(macdRes.signal) ?? 0),
      macdHist: round2(lastVal(macdRes.hist) ?? 0),
      atr14: round2(lastVal(atrSeries) ?? 0),
      adx14: round2(lastVal(adxSeries) ?? 0),
      volumeRatio: round2(volumeRatio),
      deliveryPct: round2(deliveryPct),
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

function deterministicNoise(seed: string, lo: number, hi: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const v = ((h >>> 0) % 10000) / 10000;
  return lo + v * (hi - lo);
}

/** Heuristic fallback only — used when the real NSE bhavcopy is unavailable
 * (network down, NSE returns 403, weekend before first cache fill, etc). */
function estimateDeliveryPctHeuristic(quote: Quote): number {
  const base = deterministicNoise(`${quote.symbol}-delv`, 38, 62);
  const moveBoost = Math.max(-10, Math.min(10, Math.abs(quote.changePercent) * -1.5));
  return Math.max(15, Math.min(85, base + moveBoost));
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

  // Real NSE delivery % override (when bhavcopy is reachable). Falls back
  // silently to the heuristic placeholder set in computeIndicators.
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
  return {
    symbol: entry.symbol,
    name: entry.name,
    sector: entry.sector,
    quote,
    indicators: computed.indicators,
    recommendation,
  };
}

async function performScan(): Promise<StockRow[]> {
  const rows: StockRow[] = [];
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
  logger.info({ rows: rows.length, nullCount, ms: Date.now() - start }, "Scan complete");
  return rows;
}

export async function scanAll(): Promise<StockRow[]> {
  if (scanCache && Date.now() - scanCache.fetchedAt < SCAN_TTL_MS) return scanCache.rows;
  if (scanInFlight) return scanInFlight;
  scanInFlight = (async () => {
    try {
      const rows = await performScan();
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
  return scanInFlight;
}

export async function getStockHistoryWithSeries(
  symbol: string,
  range: "1mo" | "3mo" | "6mo" | "1y" | "2y",
): Promise<StockHistory | null> {
  const chart = await getHistory(symbol, range);
  if (!chart) return null;
  return {
    symbol,
    range,
    candles: chart.timestamps.map((t, i) => ({
      t: new Date(t * 1000),
      o: round2(chart.open[i]!),
      h: round2(chart.high[i]!),
      l: round2(chart.low[i]!),
      c: round2(chart.close[i]!),
      v: chart.volume[i] ?? 0,
    })),
    ema20Series: ema(chart.close, 20).map(v => v == null ? null : round2(v)),
    ema50Series: ema(chart.close, 50).map(v => v == null ? null : round2(v)),
    rsiSeries: rsi(chart.close, 14).map(v => v == null ? null : round2(v)),
  };
}
