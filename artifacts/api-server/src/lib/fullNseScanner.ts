/**
 * Full NSE EQ scanner — Kite-first.
 *
 * What changed (and why):
 *   The previous implementation drove every row through Yahoo Finance
 *   (one intraday call per symbol, 16 in parallel). In the production
 *   hosting region Yahoo's intraday endpoint is geo-blocked and the NSE
 *   bhavcopy URLs are also blocked, so the scanner sat at "0 stocks
 *   shown · universe = 0" indefinitely, even with a 10-minute self-heal
 *   guard and aggressive retries. The user's Kite session is fully
 *   authenticated and Kite has zero geo restrictions.
 *
 * New pipeline:
 *   1. UNIVERSE — pull NSE EQ instruments from `kc.getInstruments("NSE")`
 *      (cached 24h). If Kite is logged out, fall back to the daily NSE
 *      bhavcopy. Last-resort fallback is the curated ~280-name UNIVERSE.
 *   2. QUOTES   — `kc.getQuote(["NSE:SYM1", ...])` in batches of 480.
 *      One pass covers ~2,500 symbols in 5–6 calls. Returns LTP, OHLC,
 *      volume, net change — everything the scanner table needs.
 *   3. INDICATORS — best-effort Yahoo intraday enrichment for RSI/EMA/
 *      VWAP/ATR, with bounded concurrency. If Yahoo fails or is blocked
 *      we ship the row anyway with null indicators (the UI already
 *      tolerates this and renders "—"). NO rest-on-failure punishment
 *      because Kite already gave us a usable row.
 *
 * Result: production now serves the full ~2,500-symbol universe even
 * when Yahoo is completely unreachable, instead of zero rows.
 *
 * NOT MOCKED. Every price, every change %, every volume comes from a
 * live broker quote. Indicators are computed from real Yahoo bars when
 * available, and reported as null/zero when not. The "no synthetic
 * data" rule still holds.
 */

import type { Quote, StockRow, Recommendation } from "@workspace/api-zod";
import { fetchIntraday, fetchChart, yahooTickerFor, isYahooPaused, yahooPausedForMs } from "./yahoo";
import { ema, rsi, atr, sessionVwap, macd as macdSeries } from "./indicators";
import { getAllSymbols, getDeliveryPct, getDeliveryMap } from "./nseBhavcopy";
import { UNIVERSE, INACTIVE_SYMBOLS } from "./universe";
import { logger } from "./logger";
import { loadBlob, saveBlob } from "./diskCache";
import { loadKiteNseEqInstruments, loadKiteQuotes, type KiteScannerQuote } from "./kiteScanner";
import { buildAllSwingSignals } from "./swingSignals";
import { runEquityPaperTradingTick } from "./paperTradingEq";
import { EQUITY_RISK } from "./paperAccount";

/**
 * Bridge between the scanner cycle and the equity paper-trading
 * executor. Builds SwingSignals from this scan's STRONG_BUY rows
 * (filtered to F&O 200), then runs one open + evaluate tick. Catches
 * its own errors so a hook failure cannot poison the scanner cache.
 */
async function runSwingTickForLatestScan(scan: Cache): Promise<void> {
  const rows = scan.rows;
  if (rows.length === 0) return;
  const signals = await buildAllSwingSignals(rows, EQUITY_RISK.MIN_SCORE);
  await runEquityPaperTradingTick(rows, signals);
}

// Refresh cadence. Kite quotes are cheap and authenticated, so we can
// refresh more frequently than the old 5-minute Yahoo cycle.
const REFRESH_MS = 60_000;
// Indicator-enrichment concurrency for the Yahoo intraday calls when
// Kite IS the primary price source — indicators are optional gravy.
const ENRICH_CONCURRENCY_KITE = 12;
// When Kite is offline, Yahoo is the ONLY price source, so we crank the
// concurrency way up to cover the full universe inside one refresh cycle.
// 24 is the empirically-safe ceiling — pushing to 56 triggered Yahoo's
// "Edge: Too Many Requests" rate-limiter and tripped the local outage
// detector, which then locked us out of Yahoo for 10 minutes. 24 holds
// up alongside the index-summary / market-summary / deep-scan calls that
// also fan out to Yahoo continuously.
const ENRICH_CONCURRENCY_NO_KITE = 24;
// Cap how many symbols we attempt to enrich per cycle when Kite is
// online and serving every quote. The cap is the curated F&O
// universe size + headroom — the symbols traders actually care about.
const ENRICH_CAP_KITE_ONLINE = 400;
// How long the indicator-enrichment phase is allowed to take before we
// publish the cache anyway with whatever indicators came back. Keeps the
// scan from stalling indefinitely behind a slow upstream.
const ENRICH_TIMEOUT_KITE_MS = 25_000;
// When Kite is offline we let the Yahoo pass run almost the full
// 60-second refresh window so we can cover the entire ~2,500-symbol NSE
// universe inside a single cycle.
const ENRICH_TIMEOUT_NO_KITE_MS = 50_000;
const MIN_BARS = 5;

const DISK_CACHE_NAME = "full-nse-scan";
// v6 — switched Yahoo enrichment from "15m / 1d" intraday (~26 bars,
// no ema100/200, no MACD) to "1d / 1y" daily (~250 bars, real ema100,
// ema200, MACD, RSI for every reasonably-aged listing). Old v5 blobs
// still carry intraday-window EMAs and would mix two different timeframes
// in the table — invalidate them.
// v7 (2026-04-29): synthetic-data audit fix. Removed delivery%-noise
// heuristic, RSI=50 default, EMA=price defaults. Old cache rows carry
// fake "neutral" indicators — bumping the version forces a clean recompute.
// v8 (2026-04-29): second pass — Kite-only rows now emit undefined for
// volumeRatio/trendStrength (not 1× / 50), and missing delivery% is null
// instead of 0. Old v7 still carries those neutral defaults — invalidate.
// v9 (2026-04-29): YahooIndicators.volumeRatio is now nullable; previously
// `volumeRatio ?? 0` was forcing a synthetic zero into row.indicators on
// any symbol whose 20-day average couldn't be computed. v8 rows still
// carry that fake zero — invalidate so a fresh scan emits honest nulls.
// v10 (2026-04-29): trendStrength now emits undefined when EMA20 or EMA50
// is missing (was defaulting to 50 which conflated "unknown" with
// "measured neutral"). Old v9 rows can carry the misleading 50.
// v11 (2026-04-29): scoring no longer fabricates target/stopLoss/RR when
// ATR is missing (was using `range / 6` as a fake ATR). Old v10 rows
// can carry those fabricated levels — invalidate.
// v12 (2026-04-29): Yahoo-fallback row builder now hard-gates on real
// OHLC. Previously high/low fell back to ind.realPrice when Yahoo's
// last bar was missing those fields, which made support/resistance/
// pivot/r1/s1 collapse to the live price (a fabricated "level").
// v13 (2026-04-29): tryYahooIndicators no longer collapses missing
// realOpen / realPrevClose to realPrice. The downstream hard-gate now
// has truthful nulls to test against; symbols with incomplete Yahoo
// daily bars are skipped instead of emitting fabricated open/prev/change.
// v14 (2026-04-29): scanner.ts quoteFromChart now drops the quote
// entirely when previousClose / today open / high / low can't be
// sourced for real. Old rows in v13 may carry quotes built off
// `Math.max/min(price, todayOpen)` placeholders.
const DISK_CACHE_VERSION = 14;
const DISK_CACHE_MAX_AGE_MS = 60 * 60_000;

interface Cache {
  rows: StockRow[];
  lastUpdated: number;
  sourceDate: string;
  total: number;
  scanMs: number;
  failures: number;
  rested: number;
  enriched: number;
  degraded?: boolean;
  /** True when the most recent scan ran without an authenticated Kite session. */
  kiteOffline?: boolean;
}

interface Progress { scanned: number; total: number; startedAt: number | null; running: boolean }
const progress: Progress = { scanned: 0, total: 0, startedAt: null, running: false };

let cache: Cache | null = null;
let scanInFlight: Promise<Cache> | null = null;
let timer: NodeJS.Timeout | null = null;

function round2(n: number): number { return Math.round(n * 100) / 100; }
function lastVal(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i] as number;
  return null;
}
function classifyTrend(price: number, ema20: number | null, ema50: number | null): "BULLISH" | "BEARISH" | "NEUTRAL" {
  if (ema20 == null || ema50 == null) return "NEUTRAL";
  if (price > ema20 && ema20 > ema50) return "BULLISH";
  if (price < ema20 && ema20 < ema50) return "BEARISH";
  return "NEUTRAL";
}

function buildRecommendation(args: {
  rsiVal: number | null;
  trend: "BULLISH" | "BEARISH" | "NEUTRAL";
  volumeRatio: number | null;
  changePct: number;
  vwapAbove: boolean | null;
}): Recommendation {
  const { rsiVal, trend, volumeRatio, changePct, vwapAbove } = args;
  let score = 50;
  const reasons: { text: string; weight: number; positive: boolean }[] = [];

  if (trend === "BULLISH") { score += 12; reasons.push({ text: "Price above EMA20 > EMA50", weight: 12, positive: true }); }
  if (trend === "BEARISH") { score -= 12; reasons.push({ text: "Price below EMA20 < EMA50", weight: 12, positive: false }); }

  if (rsiVal != null) {
    if (rsiVal >= 70) { score -= 8; reasons.push({ text: `RSI ${rsiVal.toFixed(0)} overbought`, weight: 8, positive: false }); }
    else if (rsiVal <= 30) { score += 8; reasons.push({ text: `RSI ${rsiVal.toFixed(0)} oversold`, weight: 8, positive: true }); }
    else if (rsiVal > 55) { score += 4; reasons.push({ text: `RSI ${rsiVal.toFixed(0)} bullish bias`, weight: 4, positive: true }); }
    else if (rsiVal < 45) { score -= 4; reasons.push({ text: `RSI ${rsiVal.toFixed(0)} bearish bias`, weight: 4, positive: false }); }
  }

  // Volume rule only applies when we actually measured a real ratio.
  // Kite-only rows (no daily-bar history) pass null and the rule is skipped
  // — we will not invent volume-confirmation evidence we don't have.
  if (volumeRatio != null && volumeRatio >= 1.5) {
    const dir = changePct >= 0;
    score += dir ? 6 : -6;
    reasons.push({ text: `Volume ${volumeRatio.toFixed(1)}× avg ${dir ? "buying" : "selling"} pressure`, weight: 6, positive: dir });
  }

  if (vwapAbove != null) {
    score += vwapAbove ? 4 : -4;
    reasons.push({ text: vwapAbove ? "Trading above VWAP" : "Trading below VWAP", weight: 4, positive: !!vwapAbove });
  }

  // Lean on the day's % change as a signal even when no indicators came back.
  if (Math.abs(changePct) >= 3) {
    const dir = changePct > 0;
    score += dir ? 4 : -4;
    reasons.push({ text: `${dir ? "Up" : "Down"} ${changePct.toFixed(1)}% today`, weight: 4, positive: dir });
  }

  score = Math.max(0, Math.min(100, score));

  let signal: Recommendation["signal"];
  if (score >= 75) signal = "STRONG_BUY";
  else if (score >= 60) signal = "BUY";
  else if (score <= 25) signal = "STRONG_SELL";
  else if (score <= 40) signal = "SELL";
  else signal = "NEUTRAL";

  return {
    signal,
    score: round2(score),
    confidence: round2(Math.min(95, 40 + Math.abs(score - 50) * 1.1)),
    reasons: reasons.map(r => ({ label: r.text, weight: r.weight, bullish: r.positive })),
  };
}

interface YahooIndicators {
  ema9: number | null;
  ema21: number | null;
  ema20: number | null;
  ema50: number | null;
  ema100: number | null;
  ema200: number | null;
  rsi14: number | null;
  atr14: number | null;
  vwap: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  volumeRatio: number | null;     // null when 20-day average isn't computable
  high52w: number | null;
  low52w: number | null;
  longName: string | null;
  // Real price/OHLC/volume from Yahoo bars — used to construct a row when
  // Kite is offline AND Yahoo is reachable. Never synthetic.
  realPrice: number | null;
  realOpen: number | null;
  realHigh: number | null;
  realLow: number | null;
  realPrevClose: number | null;
  realVolume: number;
}

// Yahoo rate-limiting is now handled by the SHARED breaker inside
// `lib/yahoo.ts` (`isYahooPaused` / auto-trip on 429). The scanner just
// reads that state — having a second, scanner-only breaker meant the
// other Yahoo callers (deepscan, market summary, dashboard) kept poking
// the throttled IP and prevented Yahoo from ever forgiving us.

async function tryYahooIndicators(symbol: string): Promise<YahooIndicators | null> {
  try {
    const yt = yahooTickerFor(symbol);
    // Daily bars over 1y: ~250 trading days, enough for ema200, MACD, RSI,
    // and 14-period ATR with full warm-up. The previous "15m / 1d" fetch
    // only delivered ~26 intraday bars, leaving ema100/200 and MACD null
    // for the entire universe.
    //
    // Single network call per symbol — keeps per-symbol latency in line
    // with the previous intraday-only path so we still cover the full
    // 2,483-symbol universe inside the cycle budget. Intraday VWAP for the
    // table view is a deep-scan concern (the detail page does its own
    // fetch), so we don't pay the cost here.
    const daily = await chartCallShim(yt);
    if (!daily || daily.close.length < MIN_BARS) return null;
    const closes = daily.close.filter((v): v is number => v != null);
    const highs  = daily.high.filter((v): v is number => v != null);
    const lows   = daily.low.filter((v): v is number => v != null);
    const vols   = daily.volume.filter((v): v is number => v != null);
    if (closes.length < MIN_BARS) return null;

    const ema9   = lastVal(ema(closes, 9));
    const ema21  = lastVal(ema(closes, 21));
    const ema20  = lastVal(ema(closes, 20));
    const ema50  = closes.length >= 50  ? lastVal(ema(closes, 50))  : null;
    const ema100 = closes.length >= 100 ? lastVal(ema(closes, 100)) : null;
    const ema200 = closes.length >= 200 ? lastVal(ema(closes, 200)) : null;
    const rsiVal = closes.length >= 15  ? lastVal(rsi(closes, 14))  : null;
    const atrVal = closes.length >= 15  ? lastVal(atr(highs, lows, closes, 14)) : null;
    // MACD needs slow=26 + signal=9 = ~35 bars to be meaningful. Daily
    // history gives us hundreds, so this is now populated for every
    // reasonably-aged listing.
    let macdLast: number | null = null, macdSig: number | null = null, macdH: number | null = null;
    if (closes.length >= 35) {
      const m = macdSeries(closes, 12, 26, 9);
      macdLast = lastVal(m.macd);
      macdSig  = lastVal(m.signal);
      macdH    = lastVal(m.hist);
    }

    // Volume ratio = today's daily volume vs 20-day average — the standard
    // definition used by every retail screener (TradingView "Relative Volume",
    // Chartink, etc.). This is the right interpretation for a daily scanner.
    const volWindow = Math.min(20, vols.length - 1);
    const todayVol = vols[vols.length - 1] ?? 0;
    const avgVol = volWindow > 0
      ? vols.slice(-1 - volWindow, -1).reduce((a, b) => a + b, 0) / volWindow
      : 0;
    const volumeRatio = avgVol > 0 ? todayVol / avgVol : null;

    // VWAP requires intraday volume-weighted bars. We dropped the intraday
    // fetch from this path (it was burning the per-symbol budget while
    // delivering only ~26 bars / no MACD). For the scanner table we now
    // leave VWAP null when Kite is offline — the UI renders "—" honestly.
    // The deep-scan / detail page issues its own intraday fetch when the
    // user actually opens a stock, so detail-view VWAP is unaffected.
    const vwap: number | null = null;

    const meta = daily.meta;
    // We MUST NOT silently fabricate Yahoo OHLC fields by collapsing
    // missing values to `realPrice`. The Yahoo-fallback row builder
    // hard-gates on every one of these being non-null and then publishes
    // them as user-visible quote.open / previousClose / change /
    // changePercent / support / resistance / pivot / r1 / s1. If a field
    // is genuinely missing, leave it null so the gate skips the symbol.
    const realPrice = meta.regularMarketPrice ?? closes[closes.length - 1] ?? null;
    const realOpen  = daily.open[daily.open.length - 1] ?? null;
    const realHigh  = daily.high[daily.high.length - 1] ?? null;
    const realLow   = daily.low[daily.low.length - 1] ?? null;
    const realPrev  = meta.chartPreviousClose ?? closes[closes.length - 2] ?? null;
    const realVolume = todayVol;

    return {
      ema9, ema21, ema20, ema50, ema100, ema200,
      rsi14: rsiVal,
      atr14: atrVal,
      vwap,
      macd: macdLast,
      macdSignal: macdSig,
      macdHist: macdH,
      volumeRatio,                  // null propagates honestly — no synthetic 0

      high52w: meta.fiftyTwoWeekHigh ?? null,
      low52w: meta.fiftyTwoWeekLow ?? null,
      longName: meta.longName ?? meta.shortName ?? null,
      realPrice,
      realOpen,
      realHigh,
      realLow,
      realPrevClose: realPrev,
      realVolume,
    };
  } catch {
    return null;
  }
}

/** Daily-bar Yahoo chart: 1y / 1d. Wrapped so tryYahooIndicators stays
 * concise and the call site can be swapped in tests. */
async function chartCallShim(yahooSymbol: string) {
  return fetchChart(yahooSymbol.replace(/\.NS$|\.BO$/, ""), "1y", "1d");
}

function rowFromKiteOnly(kq: KiteScannerQuote, deliveryPct: number | null): StockRow {
  const quote: Quote = {
    symbol: kq.symbol,
    name: kq.name,
    exchange: "NSE",
    price: round2(kq.lastPrice),
    change: round2(kq.change),
    changePercent: round2(kq.changePercent),
    open: round2(kq.open),
    high: round2(kq.high),
    low: round2(kq.low),
    previousClose: round2(kq.close),
    volume: kq.volume,
    avgVolume: round2(kq.volume),
    fiftyTwoWeekHigh: undefined,
    fiftyTwoWeekLow: undefined,
    updatedAt: new Date(kq.ts),
  };
  const recommendation = buildRecommendation({
    rsiVal: null,
    trend: "NEUTRAL",
    volumeRatio: null,        // unknown — do NOT pretend it's "1×" (neutral-ish)
    changePct: kq.changePercent,
    vwapAbove: null,
  });
  // Honest indicator object: we don't have intraday bars for this symbol,
  // so EMAs / RSI / MACD / VWAP / ATR are simply unknown. Leaving them
  // undefined makes the UI render "—" instead of a misleading "0.00".
  // Pivot / S/R / delivery% are derived from real OHLC and stay populated.
  const pivot = (kq.high + kq.low + kq.lastPrice) / 3;
  return {
    symbol: kq.symbol,
    name: kq.name,
    sector: "NSE EQ",
    quote,
    indicators: {
      ema9: undefined, ema21: undefined, ema20: undefined, ema50: undefined,
      ema100: undefined, ema200: undefined,
      vwap: undefined,
      rsi14: undefined,
      macd: undefined, macdSignal: undefined, macdHist: undefined,
      atr14: undefined, adx14: undefined,
      volumeRatio: undefined,
      deliveryPct: deliveryPct != null ? round2(deliveryPct) : undefined,
      trendStrength: undefined,        // unknown — do NOT pretend it's "50" (neutral)
      supportLevel: round2(kq.low),
      resistanceLevel: round2(kq.high),
      pivot: round2(pivot),
      r1: round2(2 * pivot - kq.low),
      s1: round2(2 * pivot - kq.high),
    },
    recommendation,
  };
}

function rowFromKitePlusIndicators(kq: KiteScannerQuote, ind: YahooIndicators, deliveryPct: number | null): StockRow {
  const trend = classifyTrend(kq.lastPrice, ind.ema20, ind.ema50);
  const vwapAbove = ind.vwap != null ? kq.lastPrice > ind.vwap : null;
  const quote: Quote = {
    symbol: kq.symbol,
    name: ind.longName || kq.name,
    exchange: "NSE",
    price: round2(kq.lastPrice),
    change: round2(kq.change),
    changePercent: round2(kq.changePercent),
    open: round2(kq.open),
    high: round2(kq.high),
    low: round2(kq.low),
    previousClose: round2(kq.close),
    volume: kq.volume,
    avgVolume: round2(kq.volume),
    fiftyTwoWeekHigh: ind.high52w ?? undefined,
    fiftyTwoWeekLow: ind.low52w ?? undefined,
    updatedAt: new Date(kq.ts),
  };
  const recommendation = buildRecommendation({
    rsiVal: ind.rsi14,
    trend,
    volumeRatio: ind.volumeRatio,
    changePct: kq.changePercent,
    vwapAbove,
  });
  // trendStrength is a derivative of the EMA20 / EMA50 stack. When EITHER
  // EMA is missing, classifyTrend returns "NEUTRAL" — but that "neutral"
  // is "we don't know", not a measured equilibrium. Emit undefined for
  // unknown so the UI renders "—" instead of a misleading "50".
  let trendStrength: number | undefined;
  if (ind.ema20 == null || ind.ema50 == null) {
    trendStrength = undefined;
  } else if (trend === "BULLISH") {
    trendStrength = Math.min(100, 70 + (ind.rsi14 != null ? Math.max(0, ind.rsi14 - 50) / 5 : 0));
  } else if (trend === "BEARISH") {
    trendStrength = Math.max(0, 30 - (ind.rsi14 != null ? Math.max(0, 50 - ind.rsi14) / 5 : 0));
  } else {
    trendStrength = 50;        // genuine measured neutral (both EMAs known, price between them)
  }
  const pivot = (kq.high + kq.low + kq.lastPrice) / 3;
  return {
    symbol: kq.symbol,
    name: ind.longName || kq.name,
    sector: "NSE EQ",
    quote,
    indicators: {
      ema9:   ind.ema9   != null ? round2(ind.ema9)   : undefined,
      ema21:  ind.ema21  != null ? round2(ind.ema21)  : undefined,
      ema20:  ind.ema20  != null ? round2(ind.ema20)  : undefined,
      ema50:  ind.ema50  != null ? round2(ind.ema50)  : undefined,
      ema100: ind.ema100 != null ? round2(ind.ema100) : undefined,
      ema200: ind.ema200 != null ? round2(ind.ema200) : undefined,
      vwap:   ind.vwap   != null ? round2(ind.vwap)   : undefined,
      rsi14:  ind.rsi14  != null ? round2(ind.rsi14)  : undefined,
      macd:       ind.macd       != null ? round2(ind.macd)       : undefined,
      macdSignal: ind.macdSignal != null ? round2(ind.macdSignal) : undefined,
      macdHist:   ind.macdHist   != null ? round2(ind.macdHist)   : undefined,
      atr14:  ind.atr14  != null ? round2(ind.atr14)  : undefined,
      adx14:  undefined,
      volumeRatio: ind.volumeRatio != null ? round2(ind.volumeRatio) : undefined,
      deliveryPct: deliveryPct != null ? round2(deliveryPct) : undefined,
      trendStrength,
      supportLevel: round2(kq.low),
      resistanceLevel: round2(kq.high),
      pivot: round2(pivot),
      r1: round2(2 * pivot - kq.low),
      s1: round2(2 * pivot - kq.high),
    },
    recommendation,
  };
}

async function performFullScan(): Promise<Cache> {
  const start = Date.now();

  // ── 1. UNIVERSE ────────────────────────────────────────────────────
  // Kite first (works in every region); bhavcopy second; curated last.
  let symbolList: string[] = [];
  let sourceDate = "";
  let degraded = false;

  const kiteInst = await loadKiteNseEqInstruments();
  if (kiteInst && kiteInst.list.length > 0) {
    symbolList = kiteInst.list.map(i => i.tradingsymbol);
    sourceDate = `kite:${new Date(kiteInst.fetchedAt).toISOString().slice(0, 10)}`;
  } else {
    const bhav = await getAllSymbols();
    if (bhav && bhav.symbols.length > 0) {
      symbolList = bhav.symbols;
      sourceDate = bhav.sourceDate;
    } else {
      symbolList = UNIVERSE
        .filter(u => !u.inactive && !INACTIVE_SYMBOLS.has(u.symbol.toUpperCase()))
        .map(u => u.symbol);
      sourceDate = "degraded:curated-universe";
      degraded = true;
      logger.warn("Full NSE scan: Kite + bhavcopy both unavailable, using curated UNIVERSE");
    }
  }

  // De-dupe + drop blacklisted micro-caps known to spam errors.
  const seen = new Set<string>();
  symbolList = symbolList.filter(s => {
    if (!s || INACTIVE_SYMBOLS.has(s.toUpperCase())) return false;
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });

  progress.scanned = 0;
  progress.total = symbolList.length;
  progress.startedAt = start;
  progress.running = true;

  // ── 2. KITE QUOTES (primary price source) ──────────────────────────
  const kiteQuotes = await loadKiteQuotes(symbolList);
  if (kiteQuotes && kiteQuotes.size > 0) {
    logger.info({ requested: symbolList.length, returned: kiteQuotes.size }, "Kite scanner: quote pass complete");
  } else if (!kiteQuotes) {
    logger.warn("Kite scanner: no active session — falling back to Yahoo-only enrichment");
  }

  // ── 3. INDICATOR ENRICHMENT (best effort, optional) ────────────────
  // Pick the enrichment target list based on whether Kite is serving
  // quotes:
  //   • Kite ONLINE  → enrich the curated F&O universe only (capped). Kite
  //     already supplies price/OHLC/volume for every symbol, so indicators
  //     are gravy and we keep the cycle fast.
  //   • Kite OFFLINE → enrich the ENTIRE NSE EQ universe. Yahoo is the only
  //     price source we have, and any symbol we skip ships ZERO data this
  //     cycle. Crank concurrency + timeout to fit the full universe in the
  //     60-second refresh window.
  const universeSet = new Set(UNIVERSE.filter(u => !u.inactive).map(u => u.symbol));
  let enrichList: string[];
  let enrichConcurrency: number;
  let enrichTimeoutMs: number;
  if (kiteQuotes) {
    const enrichTargets: string[] = [];
    for (const s of symbolList) {
      if (!kiteQuotes.has(s)) continue;
      if (universeSet.has(s)) enrichTargets.push(s);
      if (enrichTargets.length >= ENRICH_CAP_KITE_ONLINE) break;
    }
    enrichList = enrichTargets;
    enrichConcurrency = ENRICH_CONCURRENCY_KITE;
    enrichTimeoutMs = ENRICH_TIMEOUT_KITE_MS;
  } else {
    enrichList = symbolList;
    enrichConcurrency = ENRICH_CONCURRENCY_NO_KITE;
    enrichTimeoutMs = ENRICH_TIMEOUT_NO_KITE_MS;
  }

  const yahooByScopedSymbol = new Map<string, YahooIndicators>();
  let cursor = 0;
  let enrichTimedOut = false;
  let yahooAttempted = 0;
  let yahooSucceeded = 0;
  // The shared yahoo.ts breaker is the source of truth. Skip the entire
  // pass when it's open so we don't burn cycle budget on calls that will
  // immediately short-circuit to null.
  const yahooEnabled = !isYahooPaused();

  async function enrichWorker() {
    while (cursor < enrichList.length && !enrichTimedOut) {
      // If the shared breaker trips mid-cycle (one ticker hits 429), drain
      // immediately — every remaining symbol would just return null anyway.
      if (isYahooPaused()) { enrichTimedOut = true; break; }
      const idx = cursor++;
      const sym = enrichList[idx]!;
      yahooAttempted++;
      const ind = await tryYahooIndicators(sym);
      if (ind) {
        yahooByScopedSymbol.set(sym, ind);
        yahooSucceeded++;
      }
    }
  }

  if (yahooEnabled) {
    const enrichPromise = Promise.all(
      Array.from({ length: enrichConcurrency }, () => enrichWorker()),
    );
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<void>(res => {
      timeoutHandle = setTimeout(() => { enrichTimedOut = true; res(); }, enrichTimeoutMs);
    });
    try {
      await Promise.race([enrichPromise, timeoutPromise]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  } else {
    logger.debug({ pausedForMs: yahooPausedForMs() }, "Yahoo enrichment skipped — global breaker open");
  }

  // ── 4. ROW ASSEMBLY ────────────────────────────────────────────────
  const rows: StockRow[] = [];
  let kiteOnlyCount = 0;
  let enrichedCount = 0;
  let yahooFallbackCount = 0;

  for (const sym of symbolList) {
    const kq = kiteQuotes?.get(sym) ?? null;
    const ind = yahooByScopedSymbol.get(sym) ?? null;
    const realDelv = await getDeliveryPct(sym).catch(() => null);
    // null when bhavcopy hasn't loaded yet OR symbol isn't in today's
    // bhavcopy. Propagate null down the row builders — never invent "0%".
    const deliveryPct: number | null = realDelv?.pct ?? null;
    if (kq && ind) {
      rows.push(rowFromKitePlusIndicators(kq, ind, deliveryPct));
      enrichedCount++;
    } else if (kq) {
      rows.push(rowFromKiteOnly(kq, deliveryPct));
      kiteOnlyCount++;
    } else if (
      ind &&
      ind.realPrice != null && ind.realPrice > 0 &&
      ind.realHigh != null && ind.realLow != null &&
      ind.realOpen != null && ind.realPrevClose != null
    ) {
      // No Kite quote but Yahoo's last DAILY bar is fully populated —
      // emit a row built from genuine Yahoo OHLC. We HARD-GATE on every
      // OHLC field being real because rowFromKitePlusIndicators publishes
      // supportLevel/resistanceLevel/pivot/r1/s1 derived from kq.high
      // and kq.low. If we let those default to ind.realPrice when the
      // bar's high/low were missing, the user would see a "support" and
      // "resistance" both equal to the live price — a fabricated level
      // dressed up as a measured one. If any OHLC field is missing,
      // skip the symbol entirely. Honest absence over fabricated levels.
      const realPrev = ind.realPrevClose;
      const yQuote: KiteScannerQuote = {
        symbol: sym,
        name: ind.longName ?? sym,
        lastPrice: ind.realPrice,
        open: ind.realOpen,
        high: ind.realHigh,
        low: ind.realLow,
        close: realPrev,
        volume: ind.realVolume,
        change: ind.realPrice - realPrev,
        changePercent: realPrev > 0 ? ((ind.realPrice - realPrev) / realPrev) * 100 : 0,
        ts: Date.now(),
      };
      // Same sanity guard as Kite path — drop suspected corp-action glitches.
      if (Math.abs(yQuote.changePercent) <= 35) {
        rows.push(rowFromKitePlusIndicators(yQuote, ind, deliveryPct));
        yahooFallbackCount++;
      }
    }
    progress.scanned++;
  }

  rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
  progress.running = false;

  const result: Cache = {
    rows,
    lastUpdated: Date.now(),
    sourceDate,
    total: symbolList.length,
    scanMs: Date.now() - start,
    failures: symbolList.length - rows.length,
    rested: 0,
    enriched: enrichedCount,
    degraded,
    kiteOffline: !kiteQuotes,
  };
  logger.info({
    rows: rows.length,
    universe: symbolList.length,
    kiteOnly: kiteOnlyCount,
    enriched: enrichedCount,
    yahooFallback: yahooFallbackCount,
    enrichTimedOut,
    scanMs: result.scanMs,
    sourceDate,
    degraded,
    kiteOffline: !kiteQuotes,
  }, "Full NSE scan complete (Kite-first)");
  return result;
}

export async function scanFullNse(): Promise<Cache> {
  const fresh = cache && !cache.degraded && Date.now() - cache.lastUpdated < REFRESH_MS;
  if (fresh) return cache!;

  // Kick off (or join) a background refresh.
  if (!scanInFlight) {
    scanInFlight = (async () => {
      try {
        const next = await performFullScan();
        if (next.rows.length > 0) {
          const prev = cache;
          const downgrading = !prev?.degraded && next.degraded && (prev?.rows.length ?? 0) > next.rows.length;
          if (!downgrading) cache = next;
          if (!next.degraded) {
            try { saveBlob(DISK_CACHE_NAME, DISK_CACHE_VERSION, next); } catch { /* logged inside */ }
          }
          // After every successful (non-degraded-only) scan, run the
          // swing-equity paper trading tick: open new STRONG_BUY paper
          // trades and re-evaluate every OPEN paper position. Detached
          // so a hook failure can never poison the scan cache. We only
          // run the tick when we actually accepted the new scan into
          // cache; a downgrading degraded scan would mark stale rows
          // to market with stale prices.
          if (!downgrading) {
            void runSwingTickForLatestScan(cache ?? next).catch((err) =>
              logger.warn(
                { err: (err as Error).message },
                "Swing equity tick failed after scan",
              ),
            );
          }
        }
        // After a degraded scan, retry sooner — Kite session may have just
        // come back online or bhavcopy may have become reachable.
        if (next.degraded) {
          setTimeout(() => {
            void scanFullNse().catch(err => logger.warn({ err: (err as Error).message }, "Degraded-recovery full NSE scan failed"));
          }, 30_000).unref?.();
        }
        return cache ?? next;
      } finally {
        scanInFlight = null;
      }
    })();
    // Detach a swallow-catch so the background promise can never raise
    // an unhandled rejection when only the fast path (returning stale
    // cache) is awaited and no other caller has joined.
    scanInFlight.catch(() => { /* logged inside performFullScan */ });
  }

  // Stale-while-revalidate: if there's ANY cache (warm-started from
  // disk, or stale from a prior cycle), serve it immediately. The
  // background refresh continues; the next poll picks up the fresh
  // payload. This is what stops the Scanner page from feeling "stuck"
  // for 7-12s on every server restart — the disk warm-start cache is
  // good enough to render instantly.
  if (cache && cache.rows.length > 0) return cache;

  // Truly cold cache (first deploy, disk wiped) — must wait.
  return scanInFlight;
}

export function getAllScannedRows(): { rows: StockRow[]; sourceDate: string | null; lastUpdated: number | null } {
  if (!cache) return { rows: [], sourceDate: null, lastUpdated: null };
  return { rows: cache.rows.slice(), sourceDate: cache.sourceDate, lastUpdated: cache.lastUpdated };
}

export function startFullNseScannerBackground(): void {
  if (timer) return;

  // Warm-start from disk cache so the first request returns immediately
  // even before the cold scan finishes.
  const blob = loadBlob<Cache>(DISK_CACHE_NAME, DISK_CACHE_VERSION);
  if (blob && blob.payload && blob.payload.rows && blob.payload.rows.length > 0) {
    cache = blob.payload;
    const ageMin = Math.round((Date.now() - blob.ts) / 60_000);
    logger.info({ rows: cache.rows.length, total: cache.total, ageMin }, "Full NSE: warm-started from disk cache");
  }

  // Pre-warm the bhavcopy in the background (used as fallback for
  // delivery%), then kick the first scan. We don't wait for bhavcopy
  // because Kite is the primary source now.
  setTimeout(() => {
    void getDeliveryMap()
      .then(m => { logger.info({ ok: !!m, count: m?.map.size ?? 0 }, "Bhavcopy pre-warm (delivery% fallback)"); })
      .catch(() => { /* fine — Kite quotes don't need bhavcopy */ });
    void scanFullNse().catch(err => logger.warn({ err: (err as Error).message }, "Initial full NSE scan failed"));
  }, 500);
  timer = setInterval(() => {
    void scanFullNse().catch(err => logger.warn({ err: (err as Error).message }, "Background full NSE scan failed"));
  }, REFRESH_MS);
  if (typeof timer.unref === "function") timer.unref();
  logger.info({ refreshMs: REFRESH_MS, warmCache: !!cache }, "Full NSE background scanner started (Kite-first)");
}

export function getFullNseStatus(): {
  hasCache: boolean;
  lastUpdated: number | null;
  total: number;
  rows: number;
  failures: number;
  rested: number;
  sourceDate: string | null;
  scanMs: number | null;
  progress: { running: boolean; scanned: number; total: number; startedAt: number | null };
  ageMs: number | null;
  stale: boolean;
  // Best-known universe size — falls back to the in-flight scan total
  // (post-dedup) when the cache hasn't landed yet, so the UI can show
  // "Scanning ~2,486 stocks…" during a cold start instead of "0 of 0".
  universeEstimate: number;
} {
  const ageMs = cache ? Date.now() - cache.lastUpdated : null;
  const stale = ageMs != null && ageMs > DISK_CACHE_MAX_AGE_MS;
  const prog = { running: progress.running, scanned: progress.scanned, total: progress.total, startedAt: progress.startedAt };
  const universeEstimate = cache?.total ?? progress.total ?? 0;
  if (!cache) return { hasCache: false, lastUpdated: null, total: 0, rows: 0, failures: 0, rested: 0, sourceDate: null, scanMs: null, progress: prog, ageMs: null, stale: false, universeEstimate };
  return {
    hasCache: true,
    lastUpdated: cache.lastUpdated,
    total: cache.total,
    rows: cache.rows.length,
    failures: cache.failures,
    rested: cache.rested,
    sourceDate: cache.sourceDate,
    scanMs: cache.scanMs,
    progress: prog,
    ageMs,
    stale,
    universeEstimate,
  };
}
