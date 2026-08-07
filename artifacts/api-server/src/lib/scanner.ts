import type { Indicators, Quote, StockHistory, StockRow } from "@workspace/api-zod";
import { UNIVERSE, INACTIVE_SYMBOLS, type UniverseEntry } from "./universe";
import { fetchChart, fetchIntraday, yahooTickerFor, type YahooChart } from "./marketData/analyticsYahoo";
import { adx, atr, avgVolume, ema, macd, rollingVwap, rsi, sessionVwap, supportResistance, volumeProfile, pivots } from "./indicators";
// Phase B: Kite daily candle analytics now powers the recommendation for curated stocks.
// Yahoo candles remain as INFO_ONLY fallback when Kite history is unavailable.
import { buildRecommendation } from "./scoring";
import { logger } from "./logger";
import { getDeliveryPct } from "./marketData/referenceData";
import { centralLiveQuote, centralEquityCandles, centralBatchEquityQuotes } from "./marketData/compat";
import { getKiteCandleSeries } from "./kiteCandle/kiteCandleStore";
import type { KiteScannerQuote } from "./marketData/compat";
import { buildSourceProvenance } from "./scannerProvenance";
import { toScannerRowSource } from "./scannerSourceHealth";

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

// Phase B: Kite daily candles are served from the canonical KiteCandleStore (L1
// in-memory cache populated from PostgreSQL at boot).  getKiteHistory() has been
// removed — buildRowFromKiteCandles() calls getKiteCandleSeries() directly, which
// is a synchronous Map lookup that never triggers a Kite HTTP call.

async function getIntradayVwap(symbol: string): Promise<number | null> {
  const cached = intradayVwapCache.get(symbol);
  if (cached && Date.now() - cached.ts < INTRADAY_TTL) return cached.vwap;
  try {
    // Kite-first: live 15-minute candles direct from the broker (no
    // 15-min Yahoo delay). Yahoo fallback removed (Gate 5 Yahoo
    // containment): Yahoo intraday for Indian equities is no longer an
    // acceptable VWAP source. If Kite 15-min candles are unavailable
    // (session inactive, market closed), VWAP returns null and VWAP-
    // dependent scoring conditions are skipped. Null VWAP is honest.
    const intra = await centralEquityCandles(symbol, "15minute", 1);
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

function quoteFromChart(
  entry: UniverseEntry,
  chart: YahooChart,
  kiteQuote?: KiteScannerQuote | null,
): Quote | null {
  const meta = chart.meta;
  // Phase A: a valid Kite batch quote can supply the price even when Yahoo
  // meta lacks a regularMarketPrice (e.g. stale/expired Yahoo session).
  // Without any price source at all there is nothing to show — drop the row.
  const hasKiteQuote = kiteQuote != null && kiteQuote.lastPrice > 0;
  if (!hasKiteQuote && meta.regularMarketPrice == null) return null;

  // Price-source hierarchy (Phase A):
  //   1. Kite REST batch quote  — fresh REST snapshot, covers every symbol,
  //      provides prevClose (ohlc.close = previous session close).
  //   2. Kite WebSocket tick    — real-time in-memory; no prevClose field.
  //   3. Yahoo meta             — ~15-min delayed fallback.
  //
  // Yahoo daily chart is ALWAYS used for: 52-week H/L, avgVolume, and
  // indicator inputs (close series, OHLC arrays). These never come from Kite.
  //
  // Strict no-synthetic policy: previousClose, high, low, and todayOpen must
  // be REAL. If all sources are missing for a field, drop the entire row.
  const live = centralLiveQuote(entry.symbol);  // WebSocket tick (secondary)
  const closes = chart.close;
  const lastIdx = closes.length - 1;
  const todayOpenY = chart.open[lastIdx] ?? null;

  const price = hasKiteQuote ? kiteQuote.lastPrice : (live?.ltp ?? meta.regularMarketPrice!);
  const todayOpen = hasKiteQuote ? kiteQuote.open : (live?.open ?? todayOpenY);
  const high = hasKiteQuote ? kiteQuote.high : (live?.high ?? meta.regularMarketDayHigh ?? null);
  const low = hasKiteQuote ? kiteQuote.low : (live?.low ?? meta.regularMarketDayLow ?? null);
  // Volume: Kite batch quote → WebSocket tick → Yahoo meta → last daily bar.
  const volumeRaw = hasKiteQuote
    ? kiteQuote.volume
    : (live?.volume ?? meta.regularMarketVolume ?? chart.volume[lastIdx] ?? null);
  // prevClose: Kite OHLC.close = previous session close (best source).
  // WebSocket tick has no prevClose field; fall back to Yahoo chart history.
  const prevCloseRaw = hasKiteQuote
    ? kiteQuote.close
    : (lastIdx >= 1
        ? (closes[lastIdx - 1] ?? meta.chartPreviousClose ?? null)
        : (meta.chartPreviousClose ?? null));

  if (prevCloseRaw == null || todayOpen == null || high == null || low == null || volumeRaw == null) {
    return null;
  }
  const prevClose = prevCloseRaw;
  const volume = volumeRaw;
  const change = price - prevClose;
  const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;
  const avgV = avgVolume(chart.volume.slice(0, -1).filter(v => v > 0), 20);
  // updatedAt: Kite batch quote ts → WebSocket tick ts → Yahoo meta time.
  const updatedAt = hasKiteQuote
    ? new Date(kiteQuote.ts)
    : (live ? new Date(live.ts) : new Date((meta.regularMarketTime ?? Date.now() / 1000) * 1000));
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

/**
 * Phase B (Prompt 33 Gate 2): build a curated-scanner row using Kite daily
 * candles as the authoritative analytics source.
 *
 * Returns a fully-evaluated StockRow (STRONG_BUY / BUY / NEUTRAL / SELL /
 * STRONG_SELL) when Kite has ≥200 days of history.
 * Returns a NOT_EVALUATED StockRow with a machine-readable INSUFFICIENT_HISTORY
 * reason when Kite candles exist but history is too short.
 * Returns null when Kite is offline or the batch quote is unavailable —
 * caller (buildRow) falls back to the Yahoo path.
 */
async function buildRowFromKiteCandles(
  entry: UniverseEntry,
  kiteQuotes?: Map<string, KiteScannerQuote> | null,
): Promise<StockRow | null> {
  const kiteQuote = kiteQuotes?.get(entry.symbol) ?? null;
  // Need a live Kite batch quote for today's price/OHLC/volume. Without it we
  // cannot build a valid Quote object; returning null lets caller fall back.
  if (
    !kiteQuote ||
    !(kiteQuote.lastPrice > 0) ||
    !(kiteQuote.open > 0) ||
    !(kiteQuote.high > 0) ||
    !(kiteQuote.low > 0) ||
    !(kiteQuote.close > 0)
  ) return null;

  // Phase B Gate 1: read Kite daily candles from the canonical candle store.
  // This is a synchronous Map lookup — zero Kite HTTP calls on the UI path.
  // The background refresh (kiteCandleStore.ts) keeps the store current.
  const storeEntry = getKiteCandleSeries(entry.symbol);
  const kiteChart = storeEntry.chart;
  // null chart covers: pending (store not yet populated), unavailable (Kite
  // offline), and insufficient<MIN_DISPLAY_BARS.  Return null to let buildRow()
  // fall back to the Yahoo path (KITE_CANDLES_UNAVAILABLE).
  if (!kiteChart) return null;

  const bars = storeEntry.barCount;

  // Append today's partial bar from the Kite batch quote as the final entry.
  // This gives computeIndicators the same "last bar = current partial day"
  // convention that Yahoo charts have, so:
  //   • closes[dn-2] = yesterday's close → correct pivot & EMA anchoring
  //   • chart.volume.slice(0,-1) = completed bars → correct avgVolume baseline
  const chartWithToday: YahooChart = {
    ...kiteChart,
    timestamps: [...kiteChart.timestamps, Math.floor(kiteQuote.ts / 1000)],
    open:   [...kiteChart.open,   kiteQuote.open],
    high:   [...kiteChart.high,   kiteQuote.high],
    low:    [...kiteChart.low,    kiteQuote.low],
    close:  [...kiteChart.close,  kiteQuote.lastPrice],
    volume: [...kiteChart.volume, kiteQuote.volume],
  };

  // 52-week high/low from the last 252 completed daily bars plus today's intraday high/low.
  const sliceStart = Math.max(0, bars - 252);
  const fiftyTwoWeekHigh = Math.max(...kiteChart.high.slice(sliceStart), kiteQuote.high);
  const fiftyTwoWeekLow  = Math.min(...kiteChart.low.slice(sliceStart),  kiteQuote.low);

  const prevClose = kiteQuote.close;
  const change    = kiteQuote.lastPrice - prevClose;
  const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

  // Display avgVolume from last 20 completed daily bars (kiteChart, excluding today's partial).
  const avgVol20 = avgVolume(kiteChart.volume.slice(-20).filter(v => v > 0), 20);

  const quote: Quote = {
    symbol:        entry.symbol,
    name:          entry.name,
    exchange:      "NSE",
    price:         round2(kiteQuote.lastPrice),
    change:        round2(change),
    changePercent: round2(changePct),
    open:          round2(kiteQuote.open),
    high:          round2(kiteQuote.high),
    low:           round2(kiteQuote.low),
    previousClose: round2(prevClose),
    volume:        kiteQuote.volume,
    avgVolume:     avgVol20 > 0 ? Math.round(avgVol20) : undefined,
    dayRange:      `${round2(kiteQuote.low)} - ${round2(kiteQuote.high)}`,
    yearRange:     `${round2(fiftyTwoWeekLow)} - ${round2(fiftyTwoWeekHigh)}`,
    fiftyTwoWeekHigh: round2(fiftyTwoWeekHigh),
    fiftyTwoWeekLow:  round2(fiftyTwoWeekLow),
    updatedAt: new Date(kiteQuote.ts),
  };

  const intraVwap = await getIntradayVwap(entry.symbol);
  const computed  = computeIndicators(chartWithToday, quote, intraVwap);

  // Real NSE delivery % from bhavcopy — same logic as Yahoo path.
  const realDelv = await getDeliveryPct(entry.symbol).catch(() => null);
  if (realDelv) {
    computed.indicators.deliveryPct = round2(realDelv.pct);
  }

  const asOfSec = Number.isFinite(kiteQuote.ts) ? Math.floor(kiteQuote.ts / 1000) : null;
  // Surface stale candle store data in provenance so the UI can flag it.
  const candleStoreWarnings: string[] =
    storeEntry.status === "stale"
      ? [`KITE_CANDLE_STORE_STALE: indicators from last-good bars (session_date=${storeEntry.sessionDate ?? "unknown"}); background refresh in progress.`]
      : [];
  const provenance = buildSourceProvenance({
    provider: "kite",
    asOfSec,
    tf: "1D",      // daily bars → EOD timeframe → delayed:true (correct for EOD data)
    kitePriceOverlay: true,
    warnings: candleStoreWarnings.length > 0 ? candleStoreWarnings : undefined,
  });

  // Minimum bar count for the complete indicator stack:
  //   ≥200 required for EMA200 — the canonical long-trend anchor.
  //   30 – 199 bars: compute partial indicators but keep NOT_EVALUATED.
  if (bars < 200) {
    return {
      symbol: entry.symbol,
      name:   entry.name,
      sector: entry.sector,
      quote,
      indicators: computed.indicators,
      recommendation: {
        signal: "NOT_EVALUATED",
        score: null,
        confidence: null,
        reasons: [],
        setupMessage: `INSUFFICIENT_HISTORY: ${bars} trading days in Kite candle history (need ≥200 for EMA200 and complete indicator stack; session_date=${storeEntry.sessionDate ?? "unknown"}).`,
      },
      provenance,
      rowSource: toScannerRowSource(provenance, entry.symbol),
    };
  }

  // Full Kite-candle recommendation — all series available.
  const recommendation = buildRecommendation({
    quote,
    indicators: computed.indicators,
    closes:         computed.closes,
    ema9Series:     computed.ema9Series,
    ema21Series:    computed.ema21Series,
    ema20Series:    computed.ema20Series,
    ema50Series:    computed.ema50Series,
    rsiSeries:      computed.rsiSeries,
    macdHistSeries: computed.macdHistSeries,
  });

  logger.info(
    { symbol: entry.symbol, signal: recommendation.signal, score: recommendation.score, bars },
    "scanner: Phase B Kite-candle recommendation computed",
  );

  return {
    symbol: entry.symbol,
    name:   entry.name,
    sector: entry.sector,
    quote,
    indicators: computed.indicators,
    recommendation,
    provenance,
    rowSource: toScannerRowSource(provenance, entry.symbol),
  };
}

async function buildRow(
  entry: UniverseEntry,
  kiteQuotes?: Map<string, KiteScannerQuote> | null,
): Promise<StockRow | null> {
  // Phase B (Prompt 33 Gate 2): try Kite daily candle analytics first.
  //  • Kite online + ≥200 bars → fully evaluated row (real score/signal).
  //  • Kite online + <200 bars → NOT_EVALUATED with INSUFFICIENT_HISTORY reason.
  //  • Kite offline / no quote → null → fall through to Yahoo path below.
  const kiteRow = await buildRowFromKiteCandles(entry, kiteQuotes);
  if (kiteRow !== null) return kiteRow;

  // Phase A fallback: Yahoo daily chart (INFO_ONLY / DELAYED / NOT_FOR_SIGNALS).
  // Indicators are still populated for display; recommendation is NOT_EVALUATED.
  const kiteQuote = kiteQuotes?.get(entry.symbol) ?? null;
  const chart = await getHistory(entry.symbol, "6mo");
  if (!chart || chart.close.length < 30) return null;
  const quote = quoteFromChart(entry, chart, kiteQuote);
  if (!quote) return null;
  const intraVwap = await getIntradayVwap(entry.symbol);
  const computed = computeIndicators(chart, quote, intraVwap);

  // Real NSE delivery %. computeIndicators leaves this undefined; we ONLY
  // populate it from the bhavcopy. When bhavcopy is unreachable the field
  // stays undefined and scoring.ts skips the delivery-confirmation rule.
  const realDelv = await getDeliveryPct(entry.symbol).catch(() => null);
  if (realDelv) {
    computed.indicators.deliveryPct = round2(realDelv.pct);
  }

  // NOT_EVALUATED — Kite candles unavailable (offline, session expired, or
  // symbol not in Kite's EQ universe). Yahoo indicators shown for display only.
  const recommendation: import("@workspace/api-zod").Recommendation = {
    signal: "NOT_EVALUATED",
    score: null,
    confidence: null,
    reasons: [],
    setupMessage:
      "KITE_CANDLES_UNAVAILABLE: Kite daily bar history could not be fetched (Kite offline or session expired). Indicators shown are from Yahoo daily data (INFO_ONLY / DELAYED / NOT_FOR_SIGNALS). Score and signal will be activated once Kite candle analytics are available.",
  };

  const kitePriceUsed = kiteQuote != null && kiteQuote.lastPrice > 0;
  const asOfMs = new Date(quote.updatedAt).getTime();
  const provWarning = kitePriceUsed
    ? "Kite batch quote used for price/OHLC/volume. Indicators still use Yahoo daily candles — info-only until Kite candle analytics are available."
    : (() => {
        const ws = centralLiveQuote(entry.symbol);
        return ws ? "Live price from Kite; indicators derived from delayed Yahoo daily candles." : "";
      })();
  const provenance = buildSourceProvenance({
    provider: "yahoo",
    asOfSec: Number.isFinite(asOfMs) ? Math.floor(asOfMs / 1000) : null,
    tf: "15m",
    kitePriceOverlay: kitePriceUsed,
    warnings: provWarning ? [provWarning] : [],
  });
  return {
    symbol: entry.symbol,
    name:   entry.name,
    sector: entry.sector,
    quote,
    indicators: computed.indicators,
    recommendation,
    provenance,
    rowSource: toScannerRowSource(provenance, entry.symbol),
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

  // Phase A: pre-fetch Kite REST batch quotes for the full curated universe in
  // one call before the worker loop starts. 280 symbols fit within the 480-symbol
  // batch limit, so this is a single round-trip (~1s). Returns null when Kite is
  // offline or the session is expired — buildRow() falls back to the existing
  // Yahoo + WebSocket tick path unchanged, so the scan is never blocked.
  const kiteQuotes = await centralBatchEquityQuotes(universe.map(u => u.symbol)).catch(() => null);
  if (kiteQuotes !== null) {
    logger.info({ hits: kiteQuotes.size, universe: universe.length }, "scanner kite batch quotes fetched");
  }

  const concurrency = 6;
  let cursor = 0;
  async function worker() {
    while (cursor < universe.length) {
      const idx = cursor++;
      const entry = universe[idx]!;
      try {
        const r = await buildRow(entry, kiteQuotes);
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
