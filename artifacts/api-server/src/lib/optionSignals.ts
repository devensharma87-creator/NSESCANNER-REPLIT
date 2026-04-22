import type { OptionSignal, SignalReason } from "@workspace/api-zod";
import { fetchIntraday, type YahooChart } from "./yahoo";
import { ema, rsi, sessionVwap, volumeProfile, pivots, atr } from "./indicators";
import { logger } from "./logger";

export interface IndexCfg {
  symbol: string;
  yahoo: string;
  display: string;
  strikeStep: number;
}

export const OPTION_INDICES: IndexCfg[] = [
  { symbol: "NIFTY", yahoo: "^NSEI", display: "NIFTY 50", strikeStep: 50 },
  { symbol: "BANKNIFTY", yahoo: "^NSEBANK", display: "BANK NIFTY", strikeStep: 100 },
  { symbol: "FINNIFTY", yahoo: "^CNXFIN", display: "FIN NIFTY", strikeStep: 50 },
  { symbol: "MIDCPNIFTY", yahoo: "NIFTY_MID_SELECT.NS", display: "MIDCAP NIFTY", strikeStep: 25 },
  { symbol: "SENSEX", yahoo: "^BSESN", display: "SENSEX", strikeStep: 100 },
  { symbol: "BANKEX", yahoo: "BSE-BANK.BO", display: "BSE BANKEX", strikeStep: 100 },
];

// ---------- helpers ----------
function lastVal(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i] as number;
  return null;
}
function round2(n: number): number { return Math.round(n * 100) / 100; }
function nearestStrike(spot: number, step: number): number { return Math.round(spot / step) * step; }
function fmtExpiry(d: Date): string { return d.toISOString().slice(0, 10); }
function nextWeeklyExpiry(): string {
  const d = new Date();
  const day = d.getUTCDay();
  const diff = (4 - day + 7) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + diff);
  return fmtExpiry(d);
}
function todayBarsOnly(chart: YahooChart): YahooChart {
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
    symbol: chart.symbol, meta: chart.meta,
    timestamps: pick(chart.timestamps),
    open: pick(chart.open), high: pick(chart.high), low: pick(chart.low),
    close: pick(chart.close), volume: pick(chart.volume),
  };
}

// ---------- shared market context ----------
interface Ctx {
  cfg: IndexCfg;
  spot: number;
  open0: number;
  sessionChangePct: number;
  vwap: number;
  vwapSeries: (number | null)[];
  ema9: number;
  ema21: number;
  ema9Series: (number | null)[];
  ema21Series: (number | null)[];
  rsi14: number;
  rsiSeries: (number | null)[];
  vp: { pointOfControl: number; valueAreaHigh: number; valueAreaLow: number } | null;
  piv: { pivot: number; r1: number; s1: number; r2: number; s2: number };
  atr15: number;
  avgVol20: number;
  lastVol: number;
  prevSwingHigh: number;
  prevSwingLow: number;
  bars: { o: number[]; h: number[]; l: number[]; c: number[]; v: number[] };
}

function buildContext(cfg: IndexCfg, intra: YahooChart, daily: YahooChart): Ctx | null {
  const today = todayBarsOnly(intra);
  if (today.close.length < 8) return null;
  const closes = today.close, highs = today.high, lows = today.low, vols = today.volume;
  const spot = closes.at(-1)!, open0 = today.open[0]!;
  const vwapSeries = sessionVwap(highs, lows, closes, vols);
  const ema9Series = ema(closes, 9);
  const ema21Series = ema(closes, 21);
  const rsiSeries = rsi(closes, 14);
  const atrSeries = atr(highs, lows, closes, 14);
  const dn = daily.close.length;
  const piv = pivots(
    dn >= 2 ? daily.high[dn - 2]! : daily.high[dn - 1]!,
    dn >= 2 ? daily.low[dn - 2]! : daily.low[dn - 1]!,
    dn >= 2 ? daily.close[dn - 2]! : daily.close[dn - 1]!,
  );
  const vp = volumeProfile(daily.high, daily.low, daily.close, daily.volume, 30, 60);
  const last10Vol = vols.slice(-20);
  const avgVol20 = last10Vol.length > 0 ? last10Vol.reduce((a, b) => a + b, 0) / last10Vol.length : 0;
  const lookback = closes.slice(0, -1);
  const lookbackH = highs.slice(0, -1);
  const lookbackL = lows.slice(0, -1);
  const swingWin = Math.min(20, lookback.length);
  const prevSwingHigh = swingWin > 0 ? Math.max(...lookbackH.slice(-swingWin)) : spot;
  const prevSwingLow = swingWin > 0 ? Math.min(...lookbackL.slice(-swingWin)) : spot;
  return {
    cfg, spot, open0,
    sessionChangePct: ((spot - open0) / open0) * 100,
    vwap: lastVal(vwapSeries) ?? spot,
    vwapSeries,
    ema9: lastVal(ema9Series) ?? spot,
    ema21: lastVal(ema21Series) ?? spot,
    ema9Series, ema21Series,
    rsi14: lastVal(rsiSeries) ?? 50,
    rsiSeries,
    vp, piv,
    atr15: lastVal(atrSeries) ?? Math.max(spot * 0.0015, 1),
    avgVol20,
    lastVol: vols.at(-1) ?? 0,
    prevSwingHigh, prevSwingLow,
    bars: { o: today.open, h: highs, l: lows, c: closes, v: vols },
  };
}

// ---------- setup detectors ----------
type Direction = "BULLISH" | "BEARISH";
interface Detected {
  setupKey: OptionSignal["setupKey"];
  setupName: string;
  setupSummary: string;
  direction: Direction;
  confidence: number;
  drivers: SignalReason[];
  entryTrigger: string;
  entryLevel: number;
  stopLevel: number;
  targetLevel: number;
  target2Level: number;
  invalidation: string;
}

/** 1. Trend Continuation — strong VWAP+EMA alignment, fresh momentum, RSI in trend zone */
function detectTrendContinuation(c: Ctx): Detected | null {
  const aboveVwap = c.spot > c.vwap;
  const stackBull = c.ema9 > c.ema21 && c.spot > c.ema9;
  const stackBear = c.ema9 < c.ema21 && c.spot < c.ema9;
  if (!(aboveVwap && stackBull) && !(!aboveVwap && stackBear)) return null;

  const dir: Direction = aboveVwap && stackBull ? "BULLISH" : "BEARISH";
  const drivers: SignalReason[] = [];
  let conf = 0;

  if (dir === "BULLISH") {
    drivers.push({ label: "Spot above VWAP", detail: `${c.spot.toFixed(2)} > VWAP ${c.vwap.toFixed(2)}`, weight: 25, bullish: true });
    drivers.push({ label: "EMA 9 > EMA 21 stack", detail: `EMA9 ${c.ema9.toFixed(2)} > EMA21 ${c.ema21.toFixed(2)} — fast above slow.`, weight: 20, bullish: true });
    conf += 45;
    if (c.rsi14 >= 52 && c.rsi14 <= 68) { drivers.push({ label: "RSI healthy bullish", detail: `RSI ${c.rsi14.toFixed(1)} in trend zone (52–68).`, weight: 15, bullish: true }); conf += 15; }
    else if (c.rsi14 > 68) { drivers.push({ label: "RSI overbought caution", detail: `RSI ${c.rsi14.toFixed(1)} — extended; size smaller.`, weight: 5, bullish: false }); conf -= 5; }
    if (c.vp && c.spot > c.vp.pointOfControl) { drivers.push({ label: "Above POC", detail: `Spot above POC ${c.vp.pointOfControl.toFixed(2)} — value supports buyers.`, weight: 8, bullish: true }); conf += 8; }
    if (c.lastVol > c.avgVol20 * 1.2) { drivers.push({ label: "Volume confirmation", detail: `Last bar vol ${(c.lastVol / 1e6).toFixed(2)}M > 20-bar avg.`, weight: 8, bullish: true }); conf += 8; }
  } else {
    drivers.push({ label: "Spot below VWAP", detail: `${c.spot.toFixed(2)} < VWAP ${c.vwap.toFixed(2)}`, weight: 25, bullish: false });
    drivers.push({ label: "EMA 9 < EMA 21 stack", detail: `EMA9 ${c.ema9.toFixed(2)} < EMA21 ${c.ema21.toFixed(2)} — fast below slow.`, weight: 20, bullish: false });
    conf += 45;
    if (c.rsi14 <= 48 && c.rsi14 >= 32) { drivers.push({ label: "RSI healthy bearish", detail: `RSI ${c.rsi14.toFixed(1)} in trend zone (32–48).`, weight: 15, bullish: false }); conf += 15; }
    else if (c.rsi14 < 32) { drivers.push({ label: "RSI oversold caution", detail: `RSI ${c.rsi14.toFixed(1)} — bounce risk; size smaller.`, weight: 5, bullish: true }); conf -= 5; }
    if (c.vp && c.spot < c.vp.pointOfControl) { drivers.push({ label: "Below POC", detail: `Spot below POC ${c.vp.pointOfControl.toFixed(2)} — value supports sellers.`, weight: 8, bullish: false }); conf += 8; }
    if (c.lastVol > c.avgVol20 * 1.2) { drivers.push({ label: "Volume confirmation", detail: `Last bar vol ${(c.lastVol / 1e6).toFixed(2)}M > 20-bar avg.`, weight: 8, bullish: false }); conf += 8; }
  }
  conf = Math.max(0, Math.min(100, conf));
  if (conf < 50) return null;

  const trigger = dir === "BULLISH" ? c.prevSwingHigh : c.prevSwingLow;
  const stop = dir === "BULLISH" ? Math.min(c.vwap, c.ema21) - c.atr15 * 0.4 : Math.max(c.vwap, c.ema21) + c.atr15 * 0.4;
  const t1 = dir === "BULLISH"
    ? Math.max(c.piv.r1, c.vp?.valueAreaHigh ?? c.piv.r1) + c.atr15 * 0.3
    : Math.min(c.piv.s1, c.vp?.valueAreaLow ?? c.piv.s1) - c.atr15 * 0.3;
  const t2 = dir === "BULLISH" ? c.piv.r2 : c.piv.s2;
  const dist = Math.abs(c.spot - trigger);
  const triggerDesc = dir === "BULLISH"
    ? `15-min close > ${trigger.toFixed(2)} (intraday swing high)`
    : `15-min close < ${trigger.toFixed(2)} (intraday swing low)`;

  return {
    setupKey: "TREND_CONTINUATION",
    setupName: dir === "BULLISH" ? "Trend Continuation — Long" : "Trend Continuation — Short",
    setupSummary: dir === "BULLISH"
      ? "Buy CE on momentum continuation. VWAP + EMA stack + RSI all aligned bullish; enter on next break of intraday swing high."
      : "Buy PE on momentum continuation. VWAP + EMA stack + RSI all aligned bearish; enter on next break of intraday swing low.",
    direction: dir,
    confidence: conf,
    drivers,
    entryTrigger: triggerDesc + (dist > c.atr15 * 1.5 ? " — currently extended; wait for pullback close to VWAP first." : ""),
    entryLevel: trigger,
    stopLevel: stop,
    targetLevel: t1,
    target2Level: t2,
    invalidation: dir === "BULLISH"
      ? `Sustained 15-min close below VWAP ${c.vwap.toFixed(2)} or below S1 ${c.piv.s1.toFixed(2)}.`
      : `Sustained 15-min close above VWAP ${c.vwap.toFixed(2)} or above R1 ${c.piv.r1.toFixed(2)}.`,
  };
}

/** 2. VWAP Reclaim/Reject — fresh cross of VWAP with momentum */
function detectVwapReclaim(c: Ctx): Detected | null {
  const series = c.vwapSeries;
  const closes = c.bars.c;
  const n = closes.length;
  if (n < 4) return null;
  const wasBelow = (closes[n - 3]! < (series[n - 3] ?? 0)) || (closes[n - 4]! < (series[n - 4] ?? 0));
  const wasAbove = (closes[n - 3]! > (series[n - 3] ?? 0)) || (closes[n - 4]! > (series[n - 4] ?? 0));
  const nowAbove = c.spot > c.vwap;
  const nowBelow = c.spot < c.vwap;

  let dir: Direction | null = null;
  if (wasBelow && nowAbove && c.ema9 > c.ema21) dir = "BULLISH";
  else if (wasAbove && nowBelow && c.ema9 < c.ema21) dir = "BEARISH";
  if (!dir) return null;

  // RSI must be moving in the direction
  const rsiPrev = c.rsiSeries[n - 4] ?? 50;
  if (dir === "BULLISH" && (c.rsi14 < 50 || c.rsi14 < rsiPrev)) return null;
  if (dir === "BEARISH" && (c.rsi14 > 50 || c.rsi14 > rsiPrev)) return null;

  const drivers: SignalReason[] = [];
  let conf = 60;
  drivers.push({
    label: dir === "BULLISH" ? "VWAP reclaim from below" : "VWAP rejection from above",
    detail: `Price crossed back ${dir === "BULLISH" ? "above" : "below"} VWAP ${c.vwap.toFixed(2)} in last 2–3 bars.`,
    weight: 30, bullish: dir === "BULLISH",
  });
  drivers.push({
    label: dir === "BULLISH" ? "RSI rising through 50" : "RSI falling through 50",
    detail: `RSI ${rsiPrev.toFixed(1)} → ${c.rsi14.toFixed(1)}`,
    weight: 15, bullish: dir === "BULLISH",
  });

  if (dir === "BULLISH" && c.ema9 > c.ema21) { drivers.push({ label: "EMA 9 > 21 supports reclaim", detail: "Fast EMA still above slow — pullback was healthy.", weight: 12, bullish: true }); conf += 12; }
  if (dir === "BEARISH" && c.ema9 < c.ema21) { drivers.push({ label: "EMA 9 < 21 supports rejection", detail: "Fast EMA still below slow — bounce was a relief rally.", weight: 12, bullish: false }); conf += 12; }

  if (c.lastVol > c.avgVol20) { drivers.push({ label: "Volume on cross", detail: `Last bar vol > 20-bar avg.`, weight: 8, bullish: dir === "BULLISH" }); conf += 8; }

  conf = Math.max(0, Math.min(100, conf));
  if (conf < 55) return null;

  const trigger = dir === "BULLISH" ? c.vwap + c.atr15 * 0.15 : c.vwap - c.atr15 * 0.15;
  const stop = dir === "BULLISH" ? c.vwap - c.atr15 * 0.5 : c.vwap + c.atr15 * 0.5;
  const t1 = dir === "BULLISH"
    ? Math.max(c.prevSwingHigh, c.piv.r1)
    : Math.min(c.prevSwingLow, c.piv.s1);
  const t2 = dir === "BULLISH" ? c.piv.r2 : c.piv.s2;

  return {
    setupKey: "VWAP_RECLAIM",
    setupName: dir === "BULLISH" ? "VWAP Reclaim — Long" : "VWAP Rejection — Short",
    setupSummary: dir === "BULLISH"
      ? "Buy CE on VWAP reclaim. Price flipped back above VWAP with rising RSI — fade the dip, ride the resumption."
      : "Buy PE on VWAP rejection. Price failed to hold above VWAP with falling RSI — short the failed bounce.",
    direction: dir,
    confidence: conf,
    drivers,
    entryTrigger: dir === "BULLISH"
      ? `15-min close > ${trigger.toFixed(2)} with VWAP holding`
      : `15-min close < ${trigger.toFixed(2)} with VWAP rejecting`,
    entryLevel: trigger,
    stopLevel: stop,
    targetLevel: t1,
    target2Level: t2,
    invalidation: dir === "BULLISH"
      ? `Close back below VWAP ${c.vwap.toFixed(2)} on next bar — failed reclaim.`
      : `Close back above VWAP ${c.vwap.toFixed(2)} on next bar — failed rejection.`,
  };
}

/** 3. Volume-Profile Breakout — break above VAH or below VAL with volume */
function detectVolumeBreakout(c: Ctx): Detected | null {
  if (!c.vp) return null;
  const aboveVAH = c.spot > c.vp.valueAreaHigh;
  const belowVAL = c.spot < c.vp.valueAreaLow;
  if (!aboveVAH && !belowVAL) return null;
  const dir: Direction = aboveVAH ? "BULLISH" : "BEARISH";

  // require volume + momentum
  const volOk = c.lastVol > c.avgVol20 * 1.3;
  const momentumOk = dir === "BULLISH" ? c.spot > c.ema9 && c.spot > c.vwap : c.spot < c.ema9 && c.spot < c.vwap;
  if (!volOk || !momentumOk) return null;

  const drivers: SignalReason[] = [];
  let conf = 65;
  drivers.push({
    label: dir === "BULLISH" ? "Breakout above Value Area High" : "Breakdown below Value Area Low",
    detail: `Spot ${c.spot.toFixed(2)} ${dir === "BULLISH" ? ">" : "<"} ${dir === "BULLISH" ? `VAH ${c.vp.valueAreaHigh.toFixed(2)}` : `VAL ${c.vp.valueAreaLow.toFixed(2)}`} — acceptance ${dir === "BULLISH" ? "higher" : "lower"}.`,
    weight: 30, bullish: dir === "BULLISH",
  });
  drivers.push({
    label: "Volume expansion",
    detail: `Last bar volume ${(c.lastVol / 1e6).toFixed(2)}M is ${(c.lastVol / Math.max(1, c.avgVol20)).toFixed(1)}× the 20-bar avg.`,
    weight: 18, bullish: dir === "BULLISH",
  });
  drivers.push({
    label: dir === "BULLISH" ? "VWAP + EMA9 below price" : "VWAP + EMA9 above price",
    detail: "Momentum aligned with the breakout.",
    weight: 15, bullish: dir === "BULLISH",
  });
  if (dir === "BULLISH" && c.rsi14 > 55) { conf += 5; drivers.push({ label: "RSI > 55", detail: `RSI ${c.rsi14.toFixed(1)}`, weight: 5, bullish: true }); }
  if (dir === "BEARISH" && c.rsi14 < 45) { conf += 5; drivers.push({ label: "RSI < 45", detail: `RSI ${c.rsi14.toFixed(1)}`, weight: 5, bullish: false }); }

  conf = Math.max(0, Math.min(100, conf));
  if (conf < 60) return null;

  const trigger = dir === "BULLISH" ? c.vp.valueAreaHigh : c.vp.valueAreaLow;
  const stop = dir === "BULLISH" ? c.vp.pointOfControl - c.atr15 * 0.3 : c.vp.pointOfControl + c.atr15 * 0.3;
  const t1 = dir === "BULLISH" ? c.piv.r1 + c.atr15 * 0.5 : c.piv.s1 - c.atr15 * 0.5;
  const t2 = dir === "BULLISH" ? c.piv.r2 : c.piv.s2;

  return {
    setupKey: "VOLUME_BREAKOUT",
    setupName: dir === "BULLISH" ? "VAH Breakout — Long" : "VAL Breakdown — Short",
    setupSummary: dir === "BULLISH"
      ? "Buy CE on value-area breakout. Price broke above VAH on heavy volume with momentum — buyers accepting higher prices."
      : "Buy PE on value-area breakdown. Price broke below VAL on heavy volume with momentum — sellers accepting lower prices.",
    direction: dir,
    confidence: conf,
    drivers,
    entryTrigger: dir === "BULLISH"
      ? `15-min close > ${trigger.toFixed(2)} (VAH) with volume > 20-bar avg`
      : `15-min close < ${trigger.toFixed(2)} (VAL) with volume > 20-bar avg`,
    entryLevel: trigger,
    stopLevel: stop,
    targetLevel: t1,
    target2Level: t2,
    invalidation: dir === "BULLISH"
      ? `Re-entry into value area below VAH ${c.vp.valueAreaHigh.toFixed(2)} = failed breakout.`
      : `Re-entry into value area above VAL ${c.vp.valueAreaLow.toFixed(2)} = failed breakdown.`,
  };
}

/** 4. EMA Pullback — pullback to EMA9/21 in established trend */
function detectEmaPullback(c: Ctx): Detected | null {
  const stackBull = c.ema9 > c.ema21 && c.spot > c.ema21;
  const stackBear = c.ema9 < c.ema21 && c.spot < c.ema21;
  if (!stackBull && !stackBear) return null;
  const dir: Direction = stackBull ? "BULLISH" : "BEARISH";

  // distance of low/high to EMA9 (proximity test)
  const lastBarLow = c.bars.l.at(-1)!;
  const lastBarHigh = c.bars.h.at(-1)!;
  const proxyLong = Math.abs(lastBarLow - c.ema9) / c.atr15 < 0.5 || Math.abs(lastBarLow - c.ema21) / c.atr15 < 0.5;
  const proxyShort = Math.abs(lastBarHigh - c.ema9) / c.atr15 < 0.5 || Math.abs(lastBarHigh - c.ema21) / c.atr15 < 0.5;
  const close = c.bars.c.at(-1)!;
  const open = c.bars.o.at(-1)!;
  const body = close - open;

  if (dir === "BULLISH" && (!proxyLong || body <= 0)) return null;
  if (dir === "BEARISH" && (!proxyShort || body >= 0)) return null;

  // RSI in mid-range (not exhausted)
  if (dir === "BULLISH" && (c.rsi14 < 45 || c.rsi14 > 65)) return null;
  if (dir === "BEARISH" && (c.rsi14 > 55 || c.rsi14 < 35)) return null;

  const drivers: SignalReason[] = [];
  let conf = 65;
  drivers.push({
    label: dir === "BULLISH" ? "Pullback to EMA9/21 in uptrend" : "Pullback to EMA9/21 in downtrend",
    detail: `${dir === "BULLISH" ? "Low" : "High"} ${(dir === "BULLISH" ? lastBarLow : lastBarHigh).toFixed(2)} touched EMA9 ${c.ema9.toFixed(2)} / EMA21 ${c.ema21.toFixed(2)}.`,
    weight: 25, bullish: dir === "BULLISH",
  });
  drivers.push({
    label: dir === "BULLISH" ? "EMA stack still bullish" : "EMA stack still bearish",
    detail: "Trend is intact — pullback is opportunity, not reversal.",
    weight: 18, bullish: dir === "BULLISH",
  });
  drivers.push({
    label: dir === "BULLISH" ? "Bullish reaction candle" : "Bearish reaction candle",
    detail: `Latest bar body ${body >= 0 ? "+" : ""}${body.toFixed(2)}.`,
    weight: 12, bullish: dir === "BULLISH",
  });
  drivers.push({
    label: "RSI not extended",
    detail: `RSI ${c.rsi14.toFixed(1)} in mid-range — room to run.`,
    weight: 8, bullish: dir === "BULLISH",
  });
  conf = Math.max(0, Math.min(100, conf));

  const trigger = dir === "BULLISH" ? lastBarHigh : lastBarLow;
  const stop = dir === "BULLISH" ? Math.min(c.ema21, lastBarLow) - c.atr15 * 0.3 : Math.max(c.ema21, lastBarHigh) + c.atr15 * 0.3;
  const t1 = dir === "BULLISH" ? Math.max(c.prevSwingHigh, c.piv.r1) : Math.min(c.prevSwingLow, c.piv.s1);
  const t2 = dir === "BULLISH" ? c.piv.r2 : c.piv.s2;

  return {
    setupKey: "EMA_PULLBACK",
    setupName: dir === "BULLISH" ? "EMA Pullback — Long" : "EMA Pullback — Short",
    setupSummary: dir === "BULLISH"
      ? "Buy CE on EMA pullback. Trend intact + healthy retest of EMA9/21 + bullish reaction candle. Lower-risk entry vs chasing."
      : "Buy PE on EMA pullback. Downtrend intact + retest of EMA9/21 from below + bearish reaction candle.",
    direction: dir,
    confidence: conf,
    drivers,
    entryTrigger: dir === "BULLISH"
      ? `15-min close > ${trigger.toFixed(2)} (last bar high)`
      : `15-min close < ${trigger.toFixed(2)} (last bar low)`,
    entryLevel: trigger,
    stopLevel: stop,
    targetLevel: t1,
    target2Level: t2,
    invalidation: dir === "BULLISH"
      ? `Close below EMA21 ${c.ema21.toFixed(2)} flips trend; abandon.`
      : `Close above EMA21 ${c.ema21.toFixed(2)} flips trend; abandon.`,
  };
}

/** 5. Mean Reversion — extreme RSI + at session high/low extension */
function detectMeanReversion(c: Ctx): Detected | null {
  const dist = c.spot - c.vwap;
  const extendedUp = dist > c.atr15 * 2 && c.rsi14 > 75;
  const extendedDn = dist < -c.atr15 * 2 && c.rsi14 < 25;
  if (!extendedUp && !extendedDn) return null;
  const dir: Direction = extendedUp ? "BEARISH" : "BULLISH";

  const drivers: SignalReason[] = [];
  let conf = 60;
  drivers.push({
    label: dir === "BEARISH" ? "Overbought + extended above VWAP" : "Oversold + extended below VWAP",
    detail: `RSI ${c.rsi14.toFixed(1)}, ${Math.abs(dist).toFixed(2)} pts (${(Math.abs(dist) / c.atr15).toFixed(1)}× ATR) from VWAP ${c.vwap.toFixed(2)}.`,
    weight: 25, bullish: dir === "BULLISH",
  });
  drivers.push({
    label: "Mean-reversion bias",
    detail: "Statistically likely to revert toward VWAP/EMA21.",
    weight: 15, bullish: dir === "BULLISH",
  });
  if (c.vp) {
    const target = dir === "BULLISH" ? c.vp.valueAreaLow : c.vp.valueAreaHigh;
    const distVA = dir === "BULLISH" ? c.spot - target : target - c.spot;
    if (distVA > c.atr15 * 0.5) {
      conf += 5;
      drivers.push({ label: "Inside-value pull", detail: `Magnet toward ${dir === "BULLISH" ? "VAL" : "VAH"} ${target.toFixed(2)}.`, weight: 5, bullish: dir === "BULLISH" });
    }
  }
  conf = Math.max(0, Math.min(100, conf));
  if (conf < 55) return null;

  const trigger = dir === "BULLISH"
    ? c.bars.h.at(-1)! // close above last bar high
    : c.bars.l.at(-1)!; // close below last bar low
  const stop = dir === "BULLISH" ? c.spot - c.atr15 * 0.6 : c.spot + c.atr15 * 0.6;
  const t1 = dir === "BULLISH" ? c.vwap : c.vwap;
  const t2 = dir === "BULLISH" ? c.ema21 : c.ema21;

  return {
    setupKey: "MEAN_REVERSION",
    setupName: dir === "BULLISH" ? "Oversold Bounce — Long" : "Overbought Fade — Short",
    setupSummary: dir === "BULLISH"
      ? "Buy CE counter-trend. Sharp drop has stretched RSI; small-size trade for snap-back to VWAP."
      : "Buy PE counter-trend. Sharp rip has stretched RSI; small-size trade for fade back to VWAP.",
    direction: dir,
    confidence: conf,
    drivers,
    entryTrigger: dir === "BULLISH"
      ? `15-min close > ${trigger.toFixed(2)} (reversal confirmation)`
      : `15-min close < ${trigger.toFixed(2)} (reversal confirmation)`,
    entryLevel: trigger,
    stopLevel: stop,
    targetLevel: t1,
    target2Level: t2,
    invalidation: dir === "BULLISH"
      ? `New session low without bounce — exit.`
      : `New session high without rejection — exit.`,
  };
}

/** 6. Baseline directional outlook (always-on fallback) — uses dominant VWAP + EMA21 bias.
 * Lower confidence; only used when no higher-conviction setup fires for an index. */
function detectBaselineOutlook(c: Ctx): Detected | null {
  const bullVotes = (c.spot > c.vwap ? 1 : 0) + (c.spot > c.ema21 ? 1 : 0) + (c.ema9 > c.ema21 ? 1 : 0) + (c.rsi14 > 50 ? 1 : 0);
  const bearVotes = 4 - bullVotes;
  const dir: Direction = bullVotes >= bearVotes ? "BULLISH" : "BEARISH";
  const align = Math.max(bullVotes, bearVotes);
  if (align < 2) return null; // truly mixed — skip

  const conf = 35 + align * 5; // 45–55%
  const drivers: SignalReason[] = [
    { label: dir === "BULLISH" ? "Spot vs VWAP bullish" : "Spot vs VWAP bearish", detail: `Spot ${c.spot.toFixed(2)} ${c.spot > c.vwap ? ">" : "<"} VWAP ${c.vwap.toFixed(2)}.`, weight: 12, bullish: c.spot > c.vwap },
    { label: dir === "BULLISH" ? "Spot vs EMA21 bullish" : "Spot vs EMA21 bearish", detail: `Spot ${c.spot > c.ema21 ? "above" : "below"} EMA21 ${c.ema21.toFixed(2)}.`, weight: 10, bullish: c.spot > c.ema21 },
    { label: c.ema9 > c.ema21 ? "EMA 9 > 21" : "EMA 9 < 21", detail: `EMA9 ${c.ema9.toFixed(2)} vs EMA21 ${c.ema21.toFixed(2)}.`, weight: 10, bullish: c.ema9 > c.ema21 },
    { label: `RSI ${c.rsi14.toFixed(1)}`, detail: `RSI ${c.rsi14 > 50 ? "above" : "below"} 50 — ${c.rsi14 > 50 ? "bullish" : "bearish"} bias.`, weight: 8, bullish: c.rsi14 > 50 },
  ];

  const trigger = dir === "BULLISH" ? c.prevSwingHigh : c.prevSwingLow;
  const stop = dir === "BULLISH" ? Math.min(c.vwap, c.ema21) - c.atr15 * 0.5 : Math.max(c.vwap, c.ema21) + c.atr15 * 0.5;
  const t1 = dir === "BULLISH" ? c.piv.r1 : c.piv.s1;
  const t2 = dir === "BULLISH" ? c.piv.r2 : c.piv.s2;

  return {
    setupKey: "TREND_CONTINUATION",
    setupName: dir === "BULLISH" ? "Baseline Outlook — Long Bias" : "Baseline Outlook — Short Bias",
    setupSummary: dir === "BULLISH"
      ? "Lower-conviction long. Most context indicators lean bullish; wait for clean trigger or upgrade to a higher-conviction setup before sizing up."
      : "Lower-conviction short. Most context indicators lean bearish; wait for clean trigger or upgrade to a higher-conviction setup before sizing up.",
    direction: dir,
    confidence: conf,
    drivers,
    entryTrigger: dir === "BULLISH"
      ? `15-min close > ${trigger.toFixed(2)} (intraday swing high) — wait for confirmation`
      : `15-min close < ${trigger.toFixed(2)} (intraday swing low) — wait for confirmation`,
    entryLevel: trigger,
    stopLevel: stop,
    targetLevel: t1,
    target2Level: t2,
    invalidation: dir === "BULLISH"
      ? `Sustained close below VWAP ${c.vwap.toFixed(2)} flips bias.`
      : `Sustained close above VWAP ${c.vwap.toFixed(2)} flips bias.`,
  };
}

// ---------- builder ----------
function toSignal(c: Ctx, d: Detected): OptionSignal {
  const strike = nearestStrike(c.spot, c.cfg.strikeStep);
  const risk = Math.abs(c.spot - d.stopLevel);
  const reward = Math.abs(d.targetLevel - c.spot);
  const rr = risk > 0 ? round2(reward / risk) : undefined;
  return {
    index: c.cfg.symbol,
    indexName: c.cfg.display,
    spot: round2(c.spot),
    spotChangePercent: round2(c.sessionChangePct),
    bias: d.direction,
    confidence: d.confidence,
    timeframe: "intraday-15m",
    vwap: round2(c.vwap),
    ema9: round2(c.ema9),
    ema21: round2(c.ema21),
    rsi: round2(c.rsi14),
    valueAreaHigh: c.vp ? round2(c.vp.valueAreaHigh) : undefined,
    valueAreaLow: c.vp ? round2(c.vp.valueAreaLow) : undefined,
    pointOfControl: c.vp ? round2(c.vp.pointOfControl) : undefined,
    setupKey: d.setupKey,
    setupName: d.setupName,
    setupSummary: d.setupSummary,
    entryTrigger: d.entryTrigger,
    leg: {
      type: d.direction === "BULLISH" ? "CALL" : "PUT",
      strike,
      action: "BUY",
      expiry: nextWeeklyExpiry(),
      entry: round2(d.entryLevel),
      instrument: "UNDERLYING_LEVEL",
      stopLoss: round2(d.stopLevel),
      target1: round2(d.targetLevel),
      target2: round2(d.target2Level),
      riskRewardRatio: rr,
    },
    drivers: d.drivers,
    invalidation: d.invalidation,
    generatedAt: new Date(),
  };
}

function buildSignalsForIndex(cfg: IndexCfg, intra: YahooChart, daily: YahooChart): OptionSignal[] {
  const ctx = buildContext(cfg, intra, daily);
  if (!ctx) return [];

  const detectors = [
    detectTrendContinuation,
    detectVwapReclaim,
    detectVolumeBreakout,
    detectEmaPullback,
    detectMeanReversion,
  ];
  const setups: Detected[] = [];
  for (const det of detectors) {
    try {
      const r = det(ctx);
      if (r) setups.push(r);
    } catch (err) {
      logger.warn({ err: (err as Error).message, idx: cfg.symbol, det: det.name }, "Setup detector failed");
    }
  }

  // Always-on baseline outlook ensures every index gets at least one directional read.
  if (setups.length === 0) {
    try {
      const baseline = detectBaselineOutlook(ctx);
      if (baseline) setups.push(baseline);
    } catch (err) {
      logger.warn({ err: (err as Error).message, idx: cfg.symbol }, "Baseline outlook failed");
    }
  }

  // sort by confidence and keep top 3
  setups.sort((a, b) => b.confidence - a.confidence);
  return setups.slice(0, 3).map(d => toSignal(ctx, d));
}

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
      out.push(...buildSignalsForIndex(cfg, intra, daily));
    } catch (err) {
      logger.warn({ err: (err as Error).message, idx: cfg.symbol }, "Option signal failed");
    }
  }
  cache = { ts: Date.now(), data: out };
  return out;
}
