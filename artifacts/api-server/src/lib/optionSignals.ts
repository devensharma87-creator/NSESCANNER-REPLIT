import type { OptionSignal, SignalReason } from "@workspace/api-zod";
import { fetchIntraday, type YahooChart } from "./yahoo";
import { ema, rsi, sessionVwap, volumeProfile, pivots, atr } from "./indicators";
import { logger } from "./logger";
import { fetchOptionChain, type OcRow, type OcSide } from "./optionChain";
import {
  recordOrUpdate as recordLifecycle,
  expireOpenSignalsForToday,
  type SpotSnapshot,
} from "./optionSignalLifecycle";
import { computeMarketStatus } from "./marketEvents";

export interface IndexCfg {
  symbol: string;
  yahoo: string;
  display: string;
  strikeStep: number;
  /** Cadence at which the *near* expiry rolls. NSE made BANKNIFTY/FINNIFTY/MIDCPNIFTY
   *  monthly-only in Nov 2024; only NIFTY (Tue) and SENSEX (Tue) still have weeklies. */
  expiryCadence: "weekly" | "monthly";
  /** ISO weekday for the expiry. 0=Sun … 4=Thu. NSE convention as of FY26:
   *  NIFTY weekly: Tuesday. SENSEX (BSE) weekly: Tuesday. Monthly indices use
   *  *last* occurrence of the same weekday in the calendar month. */
  expiryWeekday: number;
}

export const OPTION_INDICES: IndexCfg[] = [
  { symbol: "NIFTY",     yahoo: "^NSEI",              display: "NIFTY 50",      strikeStep:  50, expiryCadence: "weekly",  expiryWeekday: 2 /* Tue */ },
  { symbol: "BANKNIFTY", yahoo: "^NSEBANK",           display: "BANK NIFTY",    strikeStep: 100, expiryCadence: "monthly", expiryWeekday: 4 /* last Thu */ },
  { symbol: "FINNIFTY",  yahoo: "^CNXFIN",            display: "FIN NIFTY",     strikeStep:  50, expiryCadence: "monthly", expiryWeekday: 2 /* last Tue */ },
  { symbol: "MIDCPNIFTY",yahoo: "NIFTY_MID_SELECT.NS",display: "MIDCAP NIFTY",  strikeStep:  25, expiryCadence: "monthly", expiryWeekday: 1 /* last Mon */ },
  { symbol: "SENSEX",    yahoo: "^BSESN",             display: "SENSEX",        strikeStep: 100, expiryCadence: "weekly",  expiryWeekday: 2 /* Tue */ },
  { symbol: "BANKEX",    yahoo: "BSE-BANK.BO",        display: "BSE BANKEX",    strikeStep: 100, expiryCadence: "monthly", expiryWeekday: 2 /* last Tue */ },
];

// ---------- helpers ----------
function lastVal(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i] as number;
  return null;
}
function round2(n: number): number { return Math.round(n * 100) / 100; }
function nearestStrike(spot: number, step: number): number { return Math.round(spot / step) * step; }
function fmtExpiry(d: Date): string { return d.toISOString().slice(0, 10); }

/** Next weekly expiry for an index, on the configured weekday in IST. */
function nextWeeklyExpiry(weekday: number): string {
  // Use IST so 23:50 UTC Monday isn't treated as Tuesday already
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const day = now.getUTCDay();
  let diff = (weekday - day + 7) % 7;
  if (diff === 0) diff = 7;            // today is the expiry day → roll to next week
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + diff);
  return fmtExpiry(d);
}

/** Next *monthly* expiry: the LAST occurrence of `weekday` in the current month
 *  (or next month if today already past it). NSE convention for monthly indices. */
function nextMonthlyExpiry(weekday: number): string {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const yr = now.getUTCFullYear(), mo = now.getUTCMonth();
  const lastInMonth = (year: number, month: number): Date => {
    // start at last day of month, walk backward to weekday
    const d = new Date(Date.UTC(year, month + 1, 0));
    while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() - 1);
    return d;
  };
  let candidate = lastInMonth(yr, mo);
  if (candidate.getTime() <= now.getTime()) {
    candidate = lastInMonth(mo === 11 ? yr + 1 : yr, (mo + 1) % 12);
  }
  return fmtExpiry(candidate);
}

function expiryFor(cfg: IndexCfg): string {
  return cfg.expiryCadence === "weekly"
    ? nextWeeklyExpiry(cfg.expiryWeekday)
    : nextMonthlyExpiry(cfg.expiryWeekday);
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
  atrDaily: number;        // ATR(14) on daily bars — used for stop placement
  dailyEma50: number;      // higher-timeframe trend filter
  htfBias: "BULLISH" | "BEARISH" | "NEUTRAL";
  avgVol20: number;
  lastVol: number;
  prevSwingHigh: number;
  prevSwingLow: number;
  bars: { o: number[]; h: number[]; l: number[]; c: number[]; v: number[] };
}

function buildContext(cfg: IndexCfg, intra: YahooChart, daily: YahooChart): Ctx | null {
  const today = todayBarsOnly(intra);
  // Require enough intraday bars for EMA21 + RSI14 + ATR14 + VWAP to be real,
  // not approximations. Earlier in the session we simply emit no high-conviction
  // signals — Baseline Outlook still renders so the UI is never blank.
  if (today.close.length < 21) return null;
  const closes = today.close, highs = today.high, lows = today.low, vols = today.volume;
  const spot = closes.at(-1)!, open0 = today.open[0]!;
  const vwapSeries = sessionVwap(highs, lows, closes, vols);
  const ema9Series = ema(closes, 9);
  const ema21Series = ema(closes, 21);
  const rsiSeries = rsi(closes, 14);
  const atrSeries = atr(highs, lows, closes, 14);
  const dn = daily.close.length;
  if (dn < 50) return null;  // dailyEma50 + meaningful pivots need history
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
  // Higher-timeframe filter: daily EMA50 + daily ATR for stop placement.
  // ZERO synthetic fallbacks here — every value below must be a real series tail.
  const dailyEma50Series = ema(daily.close, 50);
  const dailyAtrSeries = atr(daily.high, daily.low, daily.close, 14);

  const vwap     = lastVal(vwapSeries);
  const ema9Last = lastVal(ema9Series);
  const ema21Last= lastVal(ema21Series);
  const rsi14    = lastVal(rsiSeries);
  const atr15    = lastVal(atrSeries);
  const dailyEma50 = lastVal(dailyEma50Series);
  const atrDaily = lastVal(dailyAtrSeries);

  // If ANY core indicator is unknown we refuse to build a context. The
  // detectors that follow assume real values; we will not invent neutral
  // defaults to make a "signal" appear.
  if (vwap == null || ema9Last == null || ema21Last == null
      || rsi14 == null || atr15 == null || dailyEma50 == null || atrDaily == null) {
    return null;
  }

  const htfBias: "BULLISH" | "BEARISH" | "NEUTRAL" =
    spot > dailyEma50 * 1.001 ? "BULLISH"
    : spot < dailyEma50 * 0.999 ? "BEARISH"
    : "NEUTRAL";

  return {
    cfg, spot, open0,
    sessionChangePct: ((spot - open0) / open0) * 100,
    vwap, vwapSeries,
    ema9: ema9Last, ema21: ema21Last,
    ema9Series, ema21Series,
    rsi14, rsiSeries,
    vp, piv,
    atr15, atrDaily, dailyEma50,
    htfBias,
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
  // Soft HTF filter: counter-HTF signals get a confidence haircut and a tag,
  // not a silent drop. A trader who explicitly wants to fade the daily trend
  // still gets the actionable plan.
  if ((dir === "BULLISH" && c.htfBias === "BEARISH") || (dir === "BEARISH" && c.htfBias === "BULLISH")) {
    conf = Math.max(0, conf - 12);
    drivers.push({
      label: "HTF conflict — daily trend opposes",
      detail: `Daily EMA50 ${c.dailyEma50.toFixed(2)} vs spot ${c.spot.toFixed(2)} suggests counter-trend; size smaller.`,
      weight: 12, bullish: dir === "BULLISH",
    });
  }
  if (conf < 50) return null;

  // Stops snapped to structural levels (pivot S1/R1) — does NOT shift bar-by-bar.
  const trigger = dir === "BULLISH" ? c.prevSwingHigh : c.prevSwingLow;
  const stop = dir === "BULLISH"
    ? Math.min(c.piv.s1, c.vwap - c.atrDaily * 0.3)
    : Math.max(c.piv.r1, c.vwap + c.atrDaily * 0.3);
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
  // Require REAL VWAP at both look-back points (n-3 and n-4). If either is
  // null (insufficient warm-up early in the session) we skip — we will not
  // substitute 0 and pretend the previous bars closed above/below VWAP.
  const v3 = series[n - 3];
  const v4 = series[n - 4];
  if (v3 == null || v4 == null) return null;
  const wasBelow = (closes[n - 3]! < v3) || (closes[n - 4]! < v4);
  const wasAbove = (closes[n - 3]! > v3) || (closes[n - 4]! > v4);
  const nowAbove = c.spot > c.vwap;
  const nowBelow = c.spot < c.vwap;

  let dir: Direction | null = null;
  if (wasBelow && nowAbove && c.ema9 > c.ema21) dir = "BULLISH";
  else if (wasAbove && nowBelow && c.ema9 < c.ema21) dir = "BEARISH";
  if (!dir) return null;

  // RSI must be moving in the direction. Require a REAL prior RSI reading;
  // substituting 50 would let the gate pass on missing data.
  const rsiPrev = c.rsiSeries[n - 4];
  if (rsiPrev == null) return null;
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
  if (conf < 50) return null;

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
  if (conf < 50) return null;

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
  if (conf < 50) return null;

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

/** 6. Baseline directional outlook (always-on) — uses dominant VWAP + EMA21 + RSI bias.
 * Lower confidence; emitted for EVERY index so the user always has a directional read.
 * Higher-conviction setups (when they fire) are listed first; baseline is the fallback floor. */
function detectBaselineOutlook(c: Ctx): Detected | null {
  const bullVotes = (c.spot > c.vwap ? 1 : 0) + (c.spot > c.ema21 ? 1 : 0) + (c.ema9 > c.ema21 ? 1 : 0) + (c.rsi14 > 50 ? 1 : 0);
  const bearVotes = 4 - bullVotes;
  // Tie → resolve toward the intraday session move so a -1.3% day can't show "bullish".
  const dir: Direction = bullVotes > bearVotes
    ? "BULLISH"
    : bullVotes < bearVotes
      ? "BEARISH"
      : (c.sessionChangePct >= 0 ? "BULLISH" : "BEARISH");
  const align = Math.max(bullVotes, bearVotes);

  const conf = 35 + align * 5; // 35–55%
  const drivers: SignalReason[] = [
    { label: dir === "BULLISH" ? "Spot vs VWAP bullish" : "Spot vs VWAP bearish", detail: `Spot ${c.spot.toFixed(2)} ${c.spot > c.vwap ? ">" : "<"} VWAP ${c.vwap.toFixed(2)}.`, weight: 12, bullish: c.spot > c.vwap },
    { label: dir === "BULLISH" ? "Spot vs EMA21 bullish" : "Spot vs EMA21 bearish", detail: `Spot ${c.spot > c.ema21 ? "above" : "below"} EMA21 ${c.ema21.toFixed(2)}.`, weight: 10, bullish: c.spot > c.ema21 },
    { label: c.ema9 > c.ema21 ? "EMA 9 > 21" : "EMA 9 < 21", detail: `EMA9 ${c.ema9.toFixed(2)} vs EMA21 ${c.ema21.toFixed(2)}.`, weight: 10, bullish: c.ema9 > c.ema21 },
    { label: `RSI ${c.rsi14.toFixed(1)}`, detail: `RSI ${c.rsi14 > 50 ? "above" : "below"} 50 — ${c.rsi14 > 50 ? "bullish" : "bearish"} bias.`, weight: 8, bullish: c.rsi14 > 50 },
  ];

  const trigger = dir === "BULLISH" ? c.prevSwingHigh : c.prevSwingLow;
  const stop = dir === "BULLISH" ? Math.min(c.vwap, c.ema21) - c.atr15 * 0.5 : Math.max(c.vwap, c.ema21) + c.atr15 * 0.5;
  // Ensure RR >= 1.5 by construction; expand pivot target if it's too tight.
  const risk = Math.abs(trigger - stop);
  const minReward = risk * 1.5;
  const pivT1 = dir === "BULLISH" ? c.piv.r1 : c.piv.s1;
  const pivT2 = dir === "BULLISH" ? c.piv.r2 : c.piv.s2;
  const t1 = dir === "BULLISH"
    ? Math.max(pivT1, trigger + minReward)
    : Math.min(pivT1, trigger - minReward);
  const t2 = dir === "BULLISH"
    ? Math.max(pivT2, t1 + risk * 0.8)
    : Math.min(pivT2, t1 - risk * 0.8);

  return {
    // BASELINE keeps its own setup key so the level-lock store doesn't
    // confuse it with a high-conviction TREND_CONTINUATION signal in the
    // same direction (which would freeze the wrong levels for the day).
    setupKey: "BASELINE",
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
function toSignal(c: Ctx, d: Detected, tier: "HIGH_CONVICTION" | "BASELINE"): OptionSignal {
  const strike = nearestStrike(c.spot, c.cfg.strikeStep);
  // RR is measured from the actual entry trigger to T1/SL (not from spot), so the
  // displayed ratio matches what the trader will get at the documented entry.
  const risk = Math.abs(d.entryLevel - d.stopLevel);
  const reward = Math.abs(d.targetLevel - d.entryLevel);
  const rr = risk > 0 ? round2(reward / risk) : undefined;
  const htfConflict =
    (d.direction === "BULLISH" && c.htfBias === "BEARISH") ||
    (d.direction === "BEARISH" && c.htfBias === "BULLISH");
  const tags: string[] = [];
  if (tier === "BASELINE") tags.push("BASELINE");
  if (htfConflict) tags.push("HTF_CONFLICT");
  if ((rr ?? 0) < 1) tags.push("RR_LOW");
  // Mean-reversion setups are by construction "fade extremes"; tag for clarity.
  if (d.setupKey === "MEAN_REVERSION") tags.push("COUNTER_TREND");
  return {
    index: c.cfg.symbol,
    indexName: c.cfg.display,
    spot: round2(c.spot),
    spotChangePercent: round2(c.sessionChangePct),
    bias: d.direction,
    confidence: d.confidence,
    tier,
    timeframe: "intraday-15m",
    vwap: round2(c.vwap),
    ema9: round2(c.ema9),
    ema21: round2(c.ema21),
    rsi: round2(c.rsi14),
    valueAreaHigh: c.vp ? round2(c.vp.valueAreaHigh) : undefined,
    valueAreaLow: c.vp ? round2(c.vp.valueAreaLow) : undefined,
    pointOfControl: c.vp ? round2(c.vp.pointOfControl) : undefined,
    dailyEma50: round2(c.dailyEma50),
    htfBias: c.htfBias,
    htfConflict,
    tags,
    setupKey: d.setupKey,
    setupName: d.setupName,
    setupSummary: d.setupSummary,
    entryTrigger: d.entryTrigger,
    leg: {
      type: d.direction === "BULLISH" ? "CALL" : "PUT",
      strike,
      action: "BUY",
      expiry: expiryFor(c.cfg),
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

export interface IndexBuildResult {
  signals: OptionSignal[];
  /** Reasons no high-conviction setup fired. Used by the diagnostics block. */
  suppressed: string[];
  /** Did this index produce ≥1 bar of intraday data? */
  hasBars: boolean;
  /** Live snapshot used to evaluate lifecycle — null if no bars. */
  snapshot?: SpotSnapshot;
}

function buildSignalsForIndex(cfg: IndexCfg, intra: YahooChart, daily: YahooChart): IndexBuildResult {
  const ctx = buildContext(cfg, intra, daily);
  if (!ctx) return { signals: [], suppressed: ["NO_BARS_OR_INSUFFICIENT_DATA"], hasBars: false };

  // IST market-hours gate for high-conviction detectors. Outside the
  // 09:15–15:30 IST regular session the most-recent intraday bar is
  // either yesterday's last bar or this morning's pre-open quote — both
  // of which would emit stale "live" signals if we let the detectors
  // run. We still evaluate the always-on Baseline Outlook below so the
  // user sees a directional read, but it is clearly labelled "BASELINE"
  // and never shipped to the lifecycle as a fresh entry plan.
  const marketStatus = computeMarketStatus(new Date());
  const isMarketOpen = marketStatus === "open";

  const detectors = [
    { name: "trend_continuation", fn: detectTrendContinuation },
    { name: "vwap_reclaim",       fn: detectVwapReclaim },
    { name: "volume_breakout",    fn: detectVolumeBreakout },
    { name: "ema_pullback",       fn: detectEmaPullback },
    { name: "mean_reversion",     fn: detectMeanReversion },
  ];
  const highConviction: Detected[] = [];
  const suppressed: string[] = [];
  if (!isMarketOpen) {
    suppressed.push(`market_closed: ${marketStatus} (high-conviction setups gated to 09:15–15:30 IST)`);
  } else {
    for (const det of detectors) {
      try {
        const r = det.fn(ctx);
        if (r) highConviction.push(r);
        else suppressed.push(`${det.name}: conditions not met`);
      } catch (err) {
        const msg = (err as Error).message;
        logger.warn({ err: msg, idx: cfg.symbol, det: det.name }, "Setup detector failed");
        suppressed.push(`${det.name}: error`);
      }
    }
  }

  // Always-on baseline outlook for EVERY index — never gated, never dropped.
  let baseline: Detected | null = null;
  try {
    baseline = detectBaselineOutlook(ctx);
  } catch (err) {
    logger.warn({ err: (err as Error).message, idx: cfg.symbol }, "Baseline outlook failed");
  }

  // Sort high-conviction by confidence; keep top 3. Then append the baseline.
  highConviction.sort((a, b) => b.confidence - a.confidence);
  const out: OptionSignal[] = [];
  for (const d of highConviction.slice(0, 3)) {
    out.push(applyLock(toSignal(ctx, d, "HIGH_CONVICTION")));
  }
  if (baseline) {
    out.push(applyLock(toSignal(ctx, baseline, "BASELINE")));
  }
  return { signals: out, suppressed, hasBars: true, snapshot: snapshotFromCtx(ctx) };
}

/**
 * Last-bar high/low/spot for the index — fed to lifecycle so wicks count.
 *
 * Hard-gated on real bar high & low. Old code fell back to `ctx.spot`
 * when the bar's high/low were missing, but the lifecycle uses these
 * values to test "did the wick touch entry / SL / target?" — substituting
 * spot would cause a stop or target to be marked HIT off a fabricated
 * extreme. If a real bar extreme is missing, omit high/low so the
 * lifecycle skips that tick (no fabricated fills).
 */
function snapshotFromCtx(ctx: Ctx): SpotSnapshot | undefined {
  const h = ctx.bars.h.at(-1);
  const l = ctx.bars.l.at(-1);
  if (h == null || l == null) return undefined;
  return { spot: ctx.spot, high: h, low: l };
}

export interface OptionSignalsResult {
  signals: OptionSignal[];
  diagnostics: {
    indicesConfigured: number;
    indicesWithBars: number;
    highConvictionCount: number;
    baselineCount: number;
    suppressed: { index: string; reasons: string[] }[];
  };
}
interface CachedSignals { ts: number; data: OptionSignalsResult; }
let cache: CachedSignals | null = null;
const TTL = 30 * 1000;

/**
 * Session-level signal lock: once a setup of a given (date, index, setupKey, direction) is
 * emitted, its entry/SL/T1/T2 levels are FROZEN for the rest of the IST trading session.
 * This is what prevents the "stop-loss keeps shifting through the day" problem — the user's
 * trade plan no longer mutates as new bars arrive. Spot, RR, drivers, and confidence still
 * update live; only the actionable price levels are locked.
 *
 * The lock auto-resets at 00:00 IST (because the date key changes) so each new trading day
 * gets fresh levels.
 */
interface LockedLevels {
  entryLevel: number;
  stopLevel: number;
  targetLevel: number;
  target2Level: number;
  entryTrigger: string;
  invalidation: string;
  lockedAt: Date;
}
const lockStore: Map<string, LockedLevels> = new Map();
function istDateKey(): string {
  const d = new Date();
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}
function lockKey(symbol: string, setupKey: string, direction: string): string {
  return `${istDateKey()}|${symbol}|${setupKey}|${direction}`;
}
function applyLock(s: OptionSignal): OptionSignal {
  const k = lockKey(s.index, s.setupKey ?? "default", s.bias ?? "NEUTRAL");
  const existing = lockStore.get(k);
  if (existing) {
    const risk = Math.abs(existing.entryLevel - existing.stopLevel);
    const reward = Math.abs(existing.targetLevel - existing.entryLevel);
    const rr = risk > 0 ? Math.round((reward / risk) * 100) / 100 : undefined;
    return {
      ...s,
      entryTrigger: existing.entryTrigger,
      invalidation: existing.invalidation,
      leg: {
        ...s.leg,
        entry: round2(existing.entryLevel),
        stopLoss: round2(existing.stopLevel),
        target1: round2(existing.targetLevel),
        target2: round2(existing.target2Level),
        riskRewardRatio: rr,
      },
    };
  }
  lockStore.set(k, {
    entryLevel: s.leg.entry,
    stopLevel: s.leg.stopLoss,
    targetLevel: s.leg.target1,
    target2Level: s.leg.target2 ?? s.leg.target1,
    entryTrigger: s.entryTrigger ?? "",
    invalidation: s.invalidation ?? "",
    lockedAt: new Date(),
  });
  return s;
}
// Sweep stale locks (older than 36h) once an hour to keep memory tidy.
setInterval(() => {
  const cutoff = Date.now() - 36 * 3600 * 1000;
  for (const [k, v] of lockStore.entries()) {
    if (v.lockedAt.getTime() < cutoff) lockStore.delete(k);
  }
}, 60 * 60 * 1000).unref?.();

// ─── Option-level enrichment (current LTP / projected entry-T1-T2-SL) ────
//
// We translate each signal's spot-level plan into option-premium values using
// delta from the live chain. Math (works for both CALL and PUT because delta
// sign cancels with the move sign):
//
//   optionEntry = optionLtp + delta × (spotEntry − spot)
//   optionT1    = optionEntry + delta × (spotT1   − spotEntry)
//   optionT2    = optionEntry + delta × (spotT2   − spotEntry)
//   optionSL    = optionEntry + delta × (spotSL   − spotEntry)   (floored at 0.05)
//
// Floor on SL: option premium can't trade below ~0; we cap at 0.05 ₹/share to
// avoid showing negative or absurd targets when the move blows past intrinsic.
function projectOptionLevel(optionEntry: number, delta: number, spotFrom: number, spotTo: number): number {
  return optionEntry + delta * (spotTo - spotFrom);
}

interface BundleLike { signals: OptionSignal[]; snapshot?: SpotSnapshot }

async function enrichBundlesWithOptionLevels(bundles: BundleLike[]): Promise<void> {
  await Promise.all(
    bundles.map(async (b) => {
      if (b.signals.length === 0) return;
      // All signals in a bundle share the same index + ATM strike + expiry,
      // so we fetch the chain once per bundle.
      const first = b.signals[0]!;
      const expiry = first.leg.expiry;
      try {
        const chain = await fetchOptionChain(first.index, expiry);
        if (!chain) return;
        const row: OcRow | undefined = chain.rows.find((r) => r.strike === first.leg.strike);
        if (!row) return;
        for (const s of b.signals) {
          const side: OcSide | undefined = s.leg.type === "CALL" ? row.ce : row.pe;
          if (!side || side.ltp == null || side.delta == null) continue;
          const ltp = side.ltp;
          const delta = side.delta;
          // Ground projection in current spot, not signal-time spot, so the
          // displayed entry adapts as price moves toward the trigger.
          const spotNow = chain.spot;
          const optionEntry = Math.max(0.05, projectOptionLevel(ltp, delta, spotNow, s.leg.entry));
          const optionT1 = Math.max(0.05, projectOptionLevel(optionEntry, delta, s.leg.entry, s.leg.target1));
          const optionT2 = s.leg.target2 != null
            ? Math.max(0.05, projectOptionLevel(optionEntry, delta, s.leg.entry, s.leg.target2))
            : undefined;
          const optionSL = Math.max(0.05, projectOptionLevel(optionEntry, delta, s.leg.entry, s.leg.stopLoss));
          s.optionLtp = round2(ltp);
          s.optionEntry = round2(optionEntry);
          s.optionTarget1 = round2(optionT1);
          s.optionTarget2 = optionT2 != null ? round2(optionT2) : undefined;
          s.optionStopLoss = round2(optionSL);
          s.optionDelta = +delta.toFixed(4);
          if (side.theta != null) s.optionTheta = +side.theta.toFixed(4);
          if (side.vega != null) s.optionVega = +side.vega.toFixed(4);
        }
      } catch (err) {
        logger.warn(
          { err: (err as Error).message, idx: first.index, expiry },
          "Option-level enrichment failed",
        );
      }
    }),
  );
}

export async function getOptionSignals(): Promise<OptionSignalsResult> {
  if (cache && Date.now() - cache.ts < TTL) return cache.data;
  const out: OptionSignal[] = [];
  const suppressed: { index: string; reasons: string[] }[] = [];
  let indicesWithBars = 0;
  let highConvictionCount = 0;
  let baselineCount = 0;

  // Per-index bundle so we can run lifecycle persistence with the right snapshot.
  interface IdxBundle { signals: OptionSignal[]; snapshot?: SpotSnapshot; }
  const bundles: IdxBundle[] = [];

  for (const cfg of OPTION_INDICES) {
    try {
      const intra = await fetchIntraday(cfg.yahoo, "15m", "5d");
      const daily = await fetchIntraday(cfg.yahoo, "1d" as never, "3mo" as never);
      if (!intra || !daily) {
        suppressed.push({ index: cfg.symbol, reasons: ["yahoo_data_unavailable"] });
        continue;
      }
      const r = buildSignalsForIndex(cfg, intra, daily);
      if (r.hasBars) indicesWithBars++;
      out.push(...r.signals);
      bundles.push({ signals: r.signals, snapshot: r.snapshot });
      for (const s of r.signals) {
        if (s.tier === "BASELINE") baselineCount++;
        else highConvictionCount++;
      }
      // Only record suppression detail when no high-conviction setup fired —
      // otherwise the dashboard noise outweighs the value.
      const hcForIdx = r.signals.filter(s => s.tier === "HIGH_CONVICTION").length;
      if (hcForIdx === 0) suppressed.push({ index: cfg.symbol, reasons: r.suppressed });
    } catch (err) {
      const msg = (err as Error).message;
      logger.warn({ err: msg, idx: cfg.symbol }, "Option signal failed");
      suppressed.push({ index: cfg.symbol, reasons: [`exception: ${msg}`] });
    }
  }

  // Persist + evaluate lifecycle for every signal (best-effort; mutates each
  // signal in-place so the API response carries status/MFE/MAE/etc).
  for (const b of bundles) {
    if (!b.snapshot) continue;
    for (const s of b.signals) {
      try {
        const lc = await recordLifecycle({ signal: s, snapshot: b.snapshot });
        if (!lc) continue;
        s.status = lc.status;
        s.firstSeenAt = lc.firstSeenAt;
        s.triggeredAt = lc.triggeredAt;
        s.exitedAt = lc.exitedAt;
        s.exitReason = lc.exitReason;
        s.exitPrice = lc.exitPrice;
        s.maxFavorableExcursionPts = lc.maxFavorableExcursionPts;
        s.maxAdverseExcursionPts = lc.maxAdverseExcursionPts;
        s.lastSpot = lc.lastSpot;
        // DB-as-source-of-truth for locked levels: after a server restart
        // the in-process lockStore is empty, so without this override the
        // card would show recomputed levels that drift from what's already
        // persisted. Splice the persisted levels back in and re-derive RR.
        const lockedRisk = Math.abs(lc.lockedEntry - lc.lockedStopLoss);
        const lockedReward = Math.abs(lc.lockedTarget1 - lc.lockedEntry);
        const lockedRr = lockedRisk > 0
          ? Math.round((lockedReward / lockedRisk) * 100) / 100
          : undefined;
        s.leg = {
          ...s.leg,
          entry: round2(lc.lockedEntry),
          stopLoss: round2(lc.lockedStopLoss),
          target1: round2(lc.lockedTarget1),
          target2: round2(lc.lockedTarget2),
          riskRewardRatio: lockedRr,
        };
        if (lc.lockedEntryTrigger != null && lc.lockedEntryTrigger !== "") {
          s.entryTrigger = lc.lockedEntryTrigger;
        }
      } catch (err) {
        logger.warn(
          { err: (err as Error).message, idx: s.index, setup: s.setupKey },
          "Lifecycle merge failed",
        );
      }
    }
  }

  // Enrich every signal with option-level pricing AFTER lifecycle merge so
  // the math uses the FINAL locked spot entry/T1/T2/SL the UI will display.
  // (Doing this before lifecycle would compute against pre-merge values that
  // get overwritten on server restart, giving a card where the spot plan and
  // option plan disagree — a real bug for a paying user.)
  // Best-effort — if the chain isn't available (NSE block / no Kite session)
  // we silently skip and the card just falls back to spot-only display
  // (with an inline notice on the card so the absence isn't mistaken for a bug).
  await enrichBundlesWithOptionLevels(bundles);

  // Sweep open rows to EXPIRED after market close (no-op intra-session).
  await expireOpenSignalsForToday().catch(() => 0);

  const result: OptionSignalsResult = {
    signals: out,
    diagnostics: {
      indicesConfigured: OPTION_INDICES.length,
      indicesWithBars,
      highConvictionCount,
      baselineCount,
      suppressed,
    },
  };
  cache = { ts: Date.now(), data: result };
  return result;
}
