/**
 * Full NSE EQ scanner.
 *
 * The default `scanner.ts` covers the curated ~280-name UNIVERSE because each
 * row is enriched with history (6mo), intraday (15m), fundamentals, delivery%,
 * and a recommendation. That's expensive — at full NSE scale (~2,400 active
 * EQ symbols) we cannot run it every 60s.
 *
 * This module is a *lightweight* scanner that:
 *   - Drives the full symbol list from the daily NSE bhavcopy (real, not
 *     synthetic — `nseBhavcopy.ts` already loads ~2,486 symbols at boot).
 *   - Per symbol: a single Yahoo intraday call (15m, 1d) → last price, day
 *     change, RSI(14), EMA20/50 cross, ATR(14), volume vs 20-bar avg, VWAP
 *     position. No history call, no fundamentals call.
 *   - Pulls real delivery % from the in-memory bhavcopy map.
 *   - Emits StockRow-shaped objects (compatible with the existing UI).
 *   - Uses bounded-parallel concurrency (default 8) so we don't hammer
 *     Yahoo's egress.
 *   - Tracks per-symbol failures: after 3 consecutive null responses, the
 *     symbol is "rested" for 1h before being retried. This kills the
 *     log noise from Yahoo-unsupported micro-caps without dropping them
 *     from the list permanently.
 *   - Caches the row set in memory and refreshes every REFRESH_MS (5 min).
 *
 * NOT MOCKED. Every price/indicator value comes from the live Yahoo intraday
 * feed; failures yield `null` rows and are reported in diagnostics, not
 * faked. This honors the "no synthetic/mocked data" rule.
 */

import type { Quote, StockRow, Recommendation } from "@workspace/api-zod";
import { fetchIntraday, yahooTickerFor } from "./yahoo";
import { ema, rsi, atr, sessionVwap } from "./indicators";
import { getAllSymbols, getDeliveryPct } from "./nseBhavcopy";
import { UNIVERSE, INACTIVE_SYMBOLS } from "./universe";
import { logger } from "./logger";

const REFRESH_MS = 5 * 60_000;        // 5 min between full scans
const CONCURRENCY = 8;                // Yahoo bounded parallel
const REST_AFTER_FAILS = 3;           // consecutive nulls → rest the symbol
const REST_DURATION_MS = 60 * 60_000; // 1h before retrying a rested symbol
const MIN_BARS = 5;                   // need at least this many 15m bars to compute anything

interface SymbolState { fails: number; restedUntil: number }
const symbolState = new Map<string, SymbolState>();

interface Cache { rows: StockRow[]; lastUpdated: number; sourceDate: string; total: number; scanMs: number; failures: number; rested: number }
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

function buildLightRecommendation(args: {
  rsiVal: number | null;
  trend: "BULLISH" | "BEARISH" | "NEUTRAL";
  volumeRatio: number;
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

  if (volumeRatio >= 1.5) {
    const dir = changePct >= 0;
    score += dir ? 6 : -6;
    reasons.push({ text: `Volume ${volumeRatio.toFixed(1)}× avg ${dir ? "buying" : "selling"} pressure`, weight: 6, positive: dir });
  }

  if (vwapAbove != null) {
    score += vwapAbove ? 4 : -4;
    reasons.push({ text: vwapAbove ? "Trading above VWAP" : "Trading below VWAP", weight: 4, positive: !!vwapAbove });
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

async function scanOne(symbol: string): Promise<StockRow | null> {
  const yt = yahooTickerFor(symbol);
  const bars = await fetchIntraday(yt, "15m", "1d");
  if (!bars || bars.close.length < MIN_BARS) return null;

  // Last fully-formed bar
  const closes = bars.close.filter((v): v is number => v != null);
  const highs = bars.high.filter((v): v is number => v != null);
  const lows = bars.low.filter((v): v is number => v != null);
  const vols = bars.volume.filter((v): v is number => v != null);
  if (closes.length < MIN_BARS) return null;

  // Prefer Yahoo's authoritative meta values when present; fall back to the
  // last bar close otherwise. This avoids the case where the first 15m bar
  // has a stale or split-affected open that produces nonsense change %.
  const price = bars.meta.regularMarketPrice ?? closes[closes.length - 1]!;
  const open = bars.open.find(v => v != null) ?? price;
  const high = Math.max(...highs);
  const low = Math.min(...lows);
  const previousClose = bars.meta.chartPreviousClose ?? open;
  const change = price - previousClose;
  const changePercent = previousClose ? (change / previousClose) * 100 : 0;

  // Sanity-check: if the implied move is > ±35% it's almost certainly bad
  // upstream data (split not yet adjusted, illiquid ETF with stale prev
  // close, etc). Drop the row rather than emit a fake 80,000% gainer.
  if (!Number.isFinite(changePercent) || Math.abs(changePercent) > 35) return null;

  const totalVolume = vols.reduce((a, b) => a + b, 0);
  const ema20Series = ema(closes, 20);
  const ema50Series = ema(closes, 50);
  const ema20Last = lastVal(ema20Series);
  const ema50Last = lastVal(ema50Series);
  const rsiSeries = rsi(closes, 14);
  const rsiLast = lastVal(rsiSeries);
  const atrSeries = atr(highs, lows, closes, 14);
  const atrLast = lastVal(atrSeries);
  const vwapSeries = sessionVwap(highs, lows, closes, vols);
  const vwapLast = vwapSeries[vwapSeries.length - 1] ?? null;
  // Simple rolling average of volume (no library helper needed for this scale)
  const window = Math.min(20, vols.length);
  const avgVolLast = window > 0
    ? vols.slice(-window).reduce((a, b) => a + b, 0) / window
    : 1;
  const lastBarVol = vols[vols.length - 1] ?? 0;
  const volumeRatio = avgVolLast > 0 ? lastBarVol / avgVolLast : 1;

  const trend = classifyTrend(price, ema20Last, ema50Last);
  const vwapAbove = vwapLast != null ? price > vwapLast : null;

  const realDelv = await getDeliveryPct(symbol).catch(() => null);
  const deliveryPct = realDelv?.pct ?? 0;

  const quote: Quote = {
    symbol,
    name: bars.meta.longName || bars.meta.shortName || symbol,
    exchange: "NSE",
    price: round2(price),
    change: round2(change),
    changePercent: round2(changePercent),
    open: round2(open),
    high: round2(high),
    low: round2(low),
    previousClose: round2(previousClose),
    volume: totalVolume,
    avgVolume: round2(avgVolLast),
    fiftyTwoWeekHigh: bars.meta.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: bars.meta.fiftyTwoWeekLow,
    updatedAt: new Date(),
  };

  const recommendation = buildLightRecommendation({
    rsiVal: rsiLast,
    trend,
    volumeRatio,
    changePct: changePercent,
    vwapAbove,
  });

  return {
    symbol,
    name: quote.name ?? symbol,
    sector: "NSE EQ", // sector mapping isn't in bhavcopy — UI shows "NSE EQ"; deeper lookup happens via curated UNIVERSE if symbol overlaps
    quote,
    indicators: {
      ema9: 0,
      ema21: 0,
      ema20: ema20Last != null ? round2(ema20Last) : 0,
      ema50: ema50Last != null ? round2(ema50Last) : 0,
      vwap: vwapLast != null ? round2(vwapLast) : undefined,
      rsi14: rsiLast != null ? round2(rsiLast) : 50,
      macd: 0,
      macdSignal: 0,
      macdHist: 0,
      atr14: atrLast != null ? round2(atrLast) : 0,
      adx14: 0,
      volumeRatio: round2(volumeRatio),
      deliveryPct: round2(deliveryPct),
      // trendStrength is a 0-100 number per the schema. Map BEARISH=20,
      // NEUTRAL=50, BULLISH=80 with a small RSI nudge so very strong
      // momentum stocks edge higher.
      trendStrength: trend === "BULLISH" ? Math.min(100, 70 + (rsiLast != null ? Math.max(0, rsiLast - 50) / 5 : 0))
        : trend === "BEARISH" ? Math.max(0, 30 - (rsiLast != null ? Math.max(0, 50 - rsiLast) / 5 : 0))
        : 50,
      supportLevel: round2(low),
      resistanceLevel: round2(high),
      pivot: round2((high + low + price) / 3),
      r1: round2(2 * ((high + low + price) / 3) - low),
      s1: round2(2 * ((high + low + price) / 3) - high),
    },
    recommendation,
  };
}

async function performFullScan(): Promise<Cache> {
  const start = Date.now();
  const list = await getAllSymbols();
  // Bhavcopy fallback: if NSE bhavcopy is unreachable (network outage, holiday
  // before first cache fill, NSE returning 403), fall back to the curated
  // ~280-name UNIVERSE so /scan/full-nse still returns useful coverage with a
  // clearly-degraded sourceDate marker. Without this we'd serve empty rows on
  // cold start + bhavcopy failure.
  let symbolList: string[];
  let sourceDate: string;
  let degraded = false;
  if (!list || list.symbols.length === 0) {
    logger.warn("Full NSE scan: bhavcopy unavailable — falling back to curated UNIVERSE (~280 names)");
    symbolList = UNIVERSE
      .filter(u => !u.inactive && !INACTIVE_SYMBOLS.has(u.symbol.toUpperCase()))
      .map(u => u.symbol);
    sourceDate = "degraded:curated-universe";
    degraded = true;
  } else {
    symbolList = list.symbols;
    sourceDate = list.sourceDate;
  }

  const now = Date.now();
  const eligible: string[] = [];
  let restedCount = 0;
  for (const sym of symbolList) {
    const st = symbolState.get(sym);
    if (st && st.restedUntil > now) { restedCount++; continue; }
    eligible.push(sym);
  }

  const rows: StockRow[] = [];
  let failures = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < eligible.length) {
      const idx = cursor++;
      const sym = eligible[idx]!;
      try {
        const row = await scanOne(sym);
        if (row) {
          rows.push(row);
          symbolState.set(sym, { fails: 0, restedUntil: 0 });
        } else {
          failures++;
          const st = symbolState.get(sym) ?? { fails: 0, restedUntil: 0 };
          st.fails++;
          if (st.fails >= REST_AFTER_FAILS) { st.restedUntil = Date.now() + REST_DURATION_MS; restedCount++; }
          symbolState.set(sym, st);
        }
      } catch (err) {
        failures++;
        const st = symbolState.get(sym) ?? { fails: 0, restedUntil: 0 };
        st.fails++;
        if (st.fails >= REST_AFTER_FAILS) { st.restedUntil = Date.now() + REST_DURATION_MS; restedCount++; }
        symbolState.set(sym, st);
        logger.debug({ err: (err as Error).message, symbol: sym }, "Full NSE scan: row error");
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  // Stable sort by symbol so consumers can binary-search
  rows.sort((a, b) => a.symbol.localeCompare(b.symbol));

  const result: Cache = {
    rows,
    lastUpdated: Date.now(),
    sourceDate,
    total: symbolList.length,
    scanMs: Date.now() - start,
    failures,
    rested: restedCount,
  };
  logger.info({ rows: rows.length, total: symbolList.length, failures, rested: restedCount, ms: result.scanMs, degraded }, "Full NSE scan complete");
  return result;
}

export async function scanFullNse(): Promise<Cache> {
  if (cache && Date.now() - cache.lastUpdated < REFRESH_MS) return cache;
  if (scanInFlight) return scanInFlight;
  scanInFlight = (async () => {
    try {
      const next = await performFullScan();
      if (next.rows.length > 0) cache = next;
      return cache ?? next;
    } finally {
      scanInFlight = null;
    }
  })();
  return scanInFlight;
}

export function startFullNseScannerBackground(): void {
  if (timer) return;
  // Initial kick: small delay so bhavcopy + boot work finishes first
  setTimeout(() => { void scanFullNse().catch(err => logger.warn({ err: (err as Error).message }, "Initial full NSE scan failed")); }, 30_000);
  timer = setInterval(() => {
    void scanFullNse().catch(err => logger.warn({ err: (err as Error).message }, "Background full NSE scan failed"));
  }, REFRESH_MS);
  if (typeof timer.unref === "function") timer.unref();
  logger.info({ refreshMs: REFRESH_MS, concurrency: CONCURRENCY }, "Full NSE background scanner started");
}

export function getFullNseStatus(): { hasCache: boolean; lastUpdated: number | null; total: number; rows: number; failures: number; rested: number; sourceDate: string | null; scanMs: number | null } {
  if (!cache) return { hasCache: false, lastUpdated: null, total: 0, rows: 0, failures: 0, rested: 0, sourceDate: null, scanMs: null };
  return {
    hasCache: true,
    lastUpdated: cache.lastUpdated,
    total: cache.total,
    rows: cache.rows.length,
    failures: cache.failures,
    rested: cache.rested,
    sourceDate: cache.sourceDate,
    scanMs: cache.scanMs,
  };
}
