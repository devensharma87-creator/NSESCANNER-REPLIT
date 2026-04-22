import type { OptionSignal, SignalReason } from "@workspace/api-zod";
import { fetchIntraday, type YahooChart } from "./yahoo";
import { ema, rsi, sessionVwap, volumeProfile, pivots } from "./indicators";
import { logger } from "./logger";

export interface IndexCfg {
  symbol: string; // e.g. NIFTY
  yahoo: string; // e.g. ^NSEI
  display: string;
  strikeStep: number;
  weeklyExpiry?: string;
}

export const OPTION_INDICES: IndexCfg[] = [
  { symbol: "NIFTY", yahoo: "^NSEI", display: "NIFTY 50", strikeStep: 50 },
  { symbol: "BANKNIFTY", yahoo: "^NSEBANK", display: "BANK NIFTY", strikeStep: 100 },
  { symbol: "FINNIFTY", yahoo: "^CNXFIN", display: "FIN NIFTY", strikeStep: 50 },
  { symbol: "MIDCPNIFTY", yahoo: "NIFTY_MID_SELECT.NS", display: "NIFTY MIDCAP", strikeStep: 25 },
  { symbol: "SENSEX", yahoo: "^BSESN", display: "SENSEX", strikeStep: 100 },
];

function lastVal(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i] as number;
  return null;
}

function nearestStrike(spot: number, step: number): number {
  return Math.round(spot / step) * step;
}

function todayBarsOnly(chart: YahooChart): YahooChart {
  // Intraday range=5d returns multiple sessions. Slice to last calendar day in IST.
  const lastTs = chart.timestamps[chart.timestamps.length - 1];
  if (lastTs == null) return chart;
  const lastIstDay = new Date((lastTs + 19800) * 1000).toISOString().slice(0, 10);
  const idxs: number[] = [];
  for (let i = 0; i < chart.timestamps.length; i++) {
    const day = new Date((chart.timestamps[i]! + 19800) * 1000).toISOString().slice(0, 10);
    if (day === lastIstDay) idxs.push(i);
  }
  if (idxs.length === 0) return chart;
  const pick = <T,>(a: T[]) => idxs.map(i => a[i]!);
  return {
    symbol: chart.symbol,
    meta: chart.meta,
    timestamps: pick(chart.timestamps),
    open: pick(chart.open),
    high: pick(chart.high),
    low: pick(chart.low),
    close: pick(chart.close),
    volume: pick(chart.volume),
  };
}

function fmtExpiry(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function nextWeeklyExpiry(): string {
  const d = new Date();
  // Indian weekly expiry: Thursday for NIFTY, but we keep generic next Thursday
  const day = d.getUTCDay();
  const diff = (4 - day + 7) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + diff);
  return fmtExpiry(d);
}

function buildSignalForIndex(cfg: IndexCfg, chart: YahooChart, daily: YahooChart): OptionSignal | null {
  const today = todayBarsOnly(chart);
  if (today.close.length < 6) return null;

  const closes = today.close;
  const highs = today.high;
  const lows = today.low;
  const vols = today.volume;
  const spot = closes[closes.length - 1]!;
  const open0 = today.open[0]!;
  const sessionChangePct = ((spot - open0) / open0) * 100;

  const vwapSeries = sessionVwap(highs, lows, closes, vols);
  const vwap = lastVal(vwapSeries) ?? spot;
  const ema9Series = ema(closes, 9);
  const ema21Series = ema(closes, 21);
  const ema9 = lastVal(ema9Series) ?? spot;
  const ema21 = lastVal(ema21Series) ?? spot;
  const rsiSeries = rsi(closes, 14);
  const rsi14 = lastVal(rsiSeries) ?? 50;
  const vp = volumeProfile(daily.high, daily.low, daily.close, daily.volume, 30, 60);

  // Daily pivots from yesterday
  const dn = daily.close.length;
  const prevClose = dn >= 2 ? daily.close[dn - 2]! : daily.close[dn - 1]!;
  const prevHigh = dn >= 2 ? daily.high[dn - 2]! : daily.high[dn - 1]!;
  const prevLow = dn >= 2 ? daily.low[dn - 2]! : daily.low[dn - 1]!;
  const piv = pivots(prevHigh, prevLow, prevClose);

  // Price-action features
  const last = today.close.length - 1;
  const lastBar = { o: today.open[last]!, h: today.high[last]!, l: today.low[last]!, c: closes[last]! };
  const bullCandle = lastBar.c > lastBar.o && (lastBar.c - lastBar.o) > Math.abs(lastBar.h - lastBar.l) * 0.45;
  const bearCandle = lastBar.c < lastBar.o && (lastBar.o - lastBar.c) > Math.abs(lastBar.h - lastBar.l) * 0.45;

  const drivers: SignalReason[] = [];
  let score = 0;

  // 1. VWAP positioning (weight 25)
  if (spot > vwap) {
    score += 25;
    drivers.push({ label: "Above VWAP", detail: `Spot ${spot.toFixed(2)} > VWAP ${vwap.toFixed(2)} — intraday buyers in control.`, weight: 25, bullish: true });
  } else {
    score -= 25;
    drivers.push({ label: "Below VWAP", detail: `Spot ${spot.toFixed(2)} < VWAP ${vwap.toFixed(2)} — intraday sellers in control.`, weight: 25, bullish: false });
  }

  // 2. EMA 9/21 alignment (weight 20)
  if (ema9 > ema21 && spot > ema9) {
    score += 20;
    drivers.push({ label: "EMA 9 > 21 stack", detail: `Fast EMA above slow EMA — bullish momentum.`, weight: 20, bullish: true });
  } else if (ema9 < ema21 && spot < ema9) {
    score -= 20;
    drivers.push({ label: "EMA 9 < 21 stack", detail: `Fast EMA below slow EMA — bearish momentum.`, weight: 20, bullish: false });
  } else {
    score += spot > ema21 ? 4 : -4;
    drivers.push({ label: "EMA structure mixed", detail: `Trend not confirmed — wait for resolution.`, weight: 4, bullish: spot > ema21 });
  }

  // EMA 9/21 crossover in last 4 bars
  const e9p = ema9Series[ema9Series.length - 4] ?? null;
  const e21p = ema21Series[ema21Series.length - 4] ?? null;
  if (e9p != null && e21p != null) {
    if (e9p < e21p && ema9 > ema21) { score += 10; drivers.push({ label: "Fresh bullish EMA cross", detail: "EMA9 crossed above EMA21 in recent bars.", weight: 10, bullish: true }); }
    else if (e9p > e21p && ema9 < ema21) { score -= 10; drivers.push({ label: "Fresh bearish EMA cross", detail: "EMA9 crossed below EMA21 in recent bars.", weight: 10, bullish: false }); }
  }

  // 3. Volume Profile vs spot (weight 15)
  if (vp) {
    if (spot > vp.valueAreaHigh) { score += 15; drivers.push({ label: "Breakout above value area", detail: `Spot above VAH ${vp.valueAreaHigh.toFixed(2)} — acceptance higher.`, weight: 15, bullish: true }); }
    else if (spot < vp.valueAreaLow) { score -= 15; drivers.push({ label: "Breakdown below value area", detail: `Spot below VAL ${vp.valueAreaLow.toFixed(2)} — acceptance lower.`, weight: 15, bullish: false }); }
    else if (Math.abs(spot - vp.pointOfControl) / vp.pointOfControl < 0.001) {
      drivers.push({ label: "Coiling at POC", detail: `Spot pinning POC ${vp.pointOfControl.toFixed(2)} — directional move likely.`, weight: 4, bullish: spot > vwap });
    }
  }

  // 4. RSI (weight 10)
  if (rsi14 >= 55 && rsi14 <= 70) { score += 10; drivers.push({ label: "RSI bullish zone", detail: `RSI ${rsi14.toFixed(1)}.`, weight: 10, bullish: true }); }
  else if (rsi14 < 30) { score += 6; drivers.push({ label: "RSI oversold", detail: `RSI ${rsi14.toFixed(1)} — mean-reversion bias.`, weight: 6, bullish: true }); }
  else if (rsi14 > 70) { score -= 8; drivers.push({ label: "RSI overbought", detail: `RSI ${rsi14.toFixed(1)} — pullback risk.`, weight: 8, bullish: false }); }
  else if (rsi14 <= 45) { score -= 8; drivers.push({ label: "RSI weak", detail: `RSI ${rsi14.toFixed(1)}.`, weight: 8, bullish: false }); }

  // 5. Price action confirmation (weight 8)
  if (bullCandle) { score += 8; drivers.push({ label: "Bullish marubozu", detail: "Strong bullish body on the latest bar.", weight: 8, bullish: true }); }
  else if (bearCandle) { score -= 8; drivers.push({ label: "Bearish marubozu", detail: "Strong bearish body on the latest bar.", weight: 8, bullish: false }); }

  // 6. Pivot proximity (weight 6)
  if (spot > piv.r1) { score += 6; drivers.push({ label: "Above R1 pivot", detail: `Spot above R1 ${piv.r1.toFixed(2)} — trend day potential.`, weight: 6, bullish: true }); }
  else if (spot < piv.s1) { score -= 6; drivers.push({ label: "Below S1 pivot", detail: `Spot below S1 ${piv.s1.toFixed(2)}.`, weight: 6, bullish: false }); }

  score = Math.max(-100, Math.min(100, score));
  let bias: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";
  if (score >= 25) bias = "BULLISH";
  else if (score <= -25) bias = "BEARISH";

  // Confidence
  const direction = score >= 0;
  const aligned = drivers.filter(d => d.bullish === direction).reduce((a, b) => a + b.weight, 0);
  const total = drivers.reduce((a, b) => a + b.weight, 0);
  const confidence = total === 0 ? 0 : Math.round((aligned / total) * 100);

  // Strike & risk math
  const atmStrike = nearestStrike(spot, cfg.strikeStep);
  const recentRange = Math.max(...today.high.slice(-12)) - Math.min(...today.low.slice(-12));
  const atrEst = Math.max(recentRange / 12, spot * 0.0015);

  let leg: OptionSignal["leg"];
  let invalidation = "";
  if (bias === "BULLISH") {
    const strike = atmStrike;
    // For BUY CE we use spot-based stop / target framework: SL below VWAP or pivot S1, T at R1/value-area edge
    const slSpot = Math.max(Math.min(vwap, ema21) - atrEst * 0.3, piv.s1 - atrEst * 0.2);
    const t1Spot = Math.max(piv.r1, vp?.valueAreaHigh ?? piv.r1) + atrEst * 0.4;
    const t2Spot = piv.r2 ?? t1Spot + atrEst * 1.5;
    const risk = spot - slSpot;
    const reward = t1Spot - spot;
    leg = {
      type: "CALL",
      strike,
      action: "BUY",
      expiry: nextWeeklyExpiry(),
      entry: round2(spot),
      stopLoss: round2(slSpot),
      target1: round2(t1Spot),
      target2: round2(t2Spot),
      riskRewardRatio: risk > 0 ? round2(reward / risk) : undefined,
    };
    invalidation = `Sustained close below VWAP ${vwap.toFixed(2)} or below S1 ${piv.s1.toFixed(2)} invalidates the long.`;
  } else if (bias === "BEARISH") {
    const strike = atmStrike;
    const slSpot = Math.min(Math.max(vwap, ema21) + atrEst * 0.3, piv.r1 + atrEst * 0.2);
    const t1Spot = Math.min(piv.s1, vp?.valueAreaLow ?? piv.s1) - atrEst * 0.4;
    const t2Spot = piv.s2 ?? t1Spot - atrEst * 1.5;
    const risk = slSpot - spot;
    const reward = spot - t1Spot;
    leg = {
      type: "PUT",
      strike,
      action: "BUY",
      expiry: nextWeeklyExpiry(),
      entry: round2(spot),
      stopLoss: round2(slSpot),
      target1: round2(t1Spot),
      target2: round2(t2Spot),
      riskRewardRatio: risk > 0 ? round2(reward / risk) : undefined,
    };
    invalidation = `Sustained close above VWAP ${vwap.toFixed(2)} or above R1 ${piv.r1.toFixed(2)} invalidates the short.`;
  } else {
    // NEUTRAL — suggest range-bound iron-style cue but encode as wait
    leg = {
      type: spot >= vwap ? "CALL" : "PUT",
      strike: atmStrike,
      action: "BUY",
      expiry: nextWeeklyExpiry(),
      entry: round2(spot),
      stopLoss: round2(spot - atrEst),
      target1: round2(spot + atrEst),
    };
    invalidation = "Mixed signals — best to wait for a directional close above/below VWAP.";
  }

  return {
    index: cfg.symbol,
    indexName: cfg.display,
    spot: round2(spot),
    spotChangePercent: round2(sessionChangePct),
    bias,
    confidence,
    timeframe: "intraday-15m",
    vwap: round2(vwap),
    ema9: round2(ema9),
    ema21: round2(ema21),
    valueAreaHigh: vp ? round2(vp.valueAreaHigh) : undefined,
    valueAreaLow: vp ? round2(vp.valueAreaLow) : undefined,
    pointOfControl: vp ? round2(vp.pointOfControl) : undefined,
    leg,
    drivers,
    invalidation,
    generatedAt: new Date(),
  };
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

interface CachedSignals { ts: number; data: OptionSignal[]; }
let cache: CachedSignals | null = null;
const TTL = 30 * 1000;

export async function getOptionSignals(): Promise<OptionSignal[]> {
  if (cache && Date.now() - cache.ts < TTL) return cache.data;
  const out: OptionSignal[] = [];
  for (const cfg of OPTION_INDICES) {
    try {
      const intra = await fetchIntraday(cfg.yahoo, "15m", "5d");
      const daily = await fetchIntraday(cfg.yahoo, "1d" as never, "3mo" as never);
      if (!intra || !daily) continue;
      const sig = buildSignalForIndex(cfg, intra, daily);
      if (sig) out.push(sig);
    } catch (err) {
      logger.warn({ err: (err as Error).message, idx: cfg.symbol }, "Option signal failed");
    }
  }
  cache = { ts: Date.now(), data: out };
  return out;
}
