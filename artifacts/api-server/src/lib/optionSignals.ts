import type { OptionSignal, SignalReason } from "@workspace/api-zod";
import { resolveContractMaster } from "./contractMasterFact";
import type { YahooChart } from "./yahoo";
import { centralIndexCandles, centralHasIndexCoverage, centralIndexQuotes } from "./marketData/compat";
import { getActiveSessionStatus } from "./kiteAuth";
import { alertOwner } from "./alerting";
import { handleFnoDataSuppressionTransition } from "./fnoDataRecoveryTransition";
import { scoreConfluence, type ConfluenceInputs } from "./confluenceEngine";
import { ema, rsi, sessionVwap, volumeProfile, pivots, atr } from "./indicators";
import { classifyRegimeWithHysteresis, type RegimeResult } from "./regimeClassifier";
import { recordAtmIv, computeIvMetrics } from "./ivHistory";
import { logger } from "./logger";
import { logUpstreamReasoningBatch } from "./fnoSignalReasoningLogger";
import { fetchOptionChain, type OcRow, type OcSide } from "./optionChain";
import {
  recordOrUpdate as recordLifecycle,
  expireOpenSignalsForToday,
  expireStalePendingSignals,
  persistOptionPremiums,
  getPlanRevisedKeys,
  getPaperFillsForDate,
  type SpotSnapshot,
  type LifecycleFields,
} from "./optionSignalLifecycle";
// Type-only: does not create a runtime import of fnoExitDecision.ts here.
import type { FnoExitQuoteProvenance } from "./fnoExitDecision";
import {
  beginFnoExitMonitorCycle,
  finalizeFnoExitMonitorCycle,
  type FnoExitMonitorCycleAccumulator,
} from "./fnoExitMonitorHealth";
import { computeMarketStatus } from "./marketEvents";
import { fetchOiInsights, type OiInsightsResponse, type OiStrikeRow } from "./oiLab";
import { classifyVolRegime, resolveDataQuality, isActionableForFno, type VolRegime, type DataQualityLabel } from "./tradingConfig";
import {
  loadGateContext,
  isBiasFlipSuppressed,
  applyCorrelationCap,
  STALE_PENDING_MAX_MIN,
  VWAP_RECLAIM_LATE_CUTOFF_IST_MIN,
  OI_VETO_THRESHOLD,
  type GateContext,
} from "./optionSignalGates";
import { WIN_RATE_CALIBRATION, RELATIVE_STRENGTH, isEventBlackoutDay } from "./paperAccount";
import { evaluateDirectionalVetoes, deriveTradeClass } from "./optionSignalVetoes";
import { isSignalHygieneV2Enabled } from "./signalHygieneFlag";
import {
  buildOptionChainProvenance,
  classifyOcSource,
  premiumTrustVerdict,
} from "./marketData/optionChainProvenance";

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

// Owner-restricted F&O universe (2026-05-08): only NIFTY / BANKNIFTY / SENSEX
// trade live. FINNIFTY / MIDCPNIFTY / BANKEX removed — monthly-only cadence
// + thinner OI on weekly OTM strikes was producing low-quality fills and
// disproportionate stop-loss hits relative to the bigger-three indices.
// Restoring an index = re-add its entry below AND its SIGNAL_INDEX_TO_LTP_KEY row.
export const OPTION_INDICES: IndexCfg[] = [
  { symbol: "NIFTY",     yahoo: "^NSEI",              display: "NIFTY 50",      strikeStep:  50, expiryCadence: "weekly",  expiryWeekday: 2 /* Tue */ },
  { symbol: "BANKNIFTY", yahoo: "^NSEBANK",           display: "BANK NIFTY",    strikeStep: 100, expiryCadence: "monthly", expiryWeekday: 4 /* last Thu */ },
  { symbol: "SENSEX",    yahoo: "^BSESN",             display: "SENSEX",        strikeStep: 100, expiryCadence: "weekly",  expiryWeekday: 2 /* Tue */ },
];

/**
 * Single source of truth mapping OPTION_INDICES.symbol → the Yahoo-style
 * key the live-LTP source (`getKiteIndexQuotes`) returns. The historical
 * Yahoo intraday endpoint and the live Kite-LTP source disagree on which
 * key to use for FINNIFTY (`^CNXFIN` vs `NIFTY_FIN_SERVICE.NS`), so we
 * never derive one from the other — they are looked up explicitly here.
 */
const SIGNAL_INDEX_TO_LTP_KEY: Record<string, string> = {
  NIFTY:      "^NSEI",
  BANKNIFTY:  "^NSEBANK",
  SENSEX:     "^BSESN",
};

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

/** BUG-80 helper — list of index symbols whose expiry is today (IST).
 *  Weekly indices match by weekday only; monthly indices only match on the
 *  LAST occurrence of the weekday in the IST month. Pure — no side effects. */
export function indexesExpiringTodayIst(now: Date = new Date()): string[] {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const istWd = ist.getUTCDay();
  const out: string[] = [];
  for (const cfg of OPTION_INDICES) {
    if (istWd !== cfg.expiryWeekday) continue;
    if (cfg.expiryCadence === "weekly") {
      out.push(cfg.symbol);
      continue;
    }
    // Monthly: only the LAST occurrence of the weekday in the IST month.
    const next = new Date(Date.UTC(
      ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + 7,
    ));
    if (next.getUTCMonth() !== ist.getUTCMonth()) out.push(cfg.symbol);
  }
  return out;
}

const MIN_REAL_SESSION_BARS = 15;

function lastSessionBars(chart: YahooChart): YahooChart {
  if (chart.timestamps.length === 0) return chart;

  const dayMap = new Map<string, number[]>();
  for (let i = 0; i < chart.timestamps.length; i++) {
    const day = new Date((chart.timestamps[i]! + 19800) * 1000).toISOString().slice(0, 10);
    let arr = dayMap.get(day);
    if (!arr) { arr = []; dayMap.set(day, arr); }
    arr.push(i);
  }

  const days = [...dayMap.keys()].sort().reverse();
  if (days.length === 0) return chart;

  const latestDay = days[0]!;
  const latestBars = dayMap.get(latestDay)!;

  const mktStatus = computeMarketStatus(new Date());
  const isLiveSession = mktStatus === "open" || mktStatus === "pre_open";

  let selectedIdxs = latestBars;
  if (!isLiveSession && latestBars.length < MIN_REAL_SESSION_BARS) {
    for (let d = 1; d < days.length; d++) {
      const candidate = dayMap.get(days[d]!)!;
      if (candidate.length >= MIN_REAL_SESSION_BARS) {
        selectedIdxs = candidate;
        break;
      }
    }
  }

  if (selectedIdxs.length === 0) return chart;
  const pick = <T,>(a: T[]) => selectedIdxs.map(i => a[i]!);
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
  /**
   * True only when the session VWAP is a genuine volume-weighted average.
   * False for cash indices (NIFTY/BANKNIFTY/SENSEX) — their Kite candles
   * carry zero volume, so `vwap` is set to `spot` as a geometric
   * placeholder and MUST NOT be surfaced as institutional fair value.
   * Detectors must gate their VWAP-dependent drivers on this flag.
   */
  vwapAvailable: boolean;
  vwapSeries: (number | null)[];
  ema9: number;
  ema21: number;
  /** Phase-2: EMA20 / EMA50 of intraday closes — fed to confluence engine. */
  ema20: number;
  ema50: number;
  ema9Series: (number | null)[];
  ema21Series: (number | null)[];
  rsi14: number;
  rsiSeries: (number | null)[];
  /** Daily-bar volume profile (legacy). Used for daily HVN/LVN context. */
  vp: { pointOfControl: number; valueAreaHigh: number; valueAreaLow: number } | null;
  /** Phase-2: INTRADAY volume profile (last 60 15-min bars across the
   *  current Kite intraday window). Fed to the confluence engine to
   *  identify out-of-balance vs in-value tape. Nullable during warm-up. */
  vpIntraday: { pointOfControl: number; valueAreaHigh: number; valueAreaLow: number } | null;
  piv: { pivot: number; r1: number; s1: number; r2: number; s2: number };
  atr15: number;
  atrDaily: number;
  dailyEma50: number;
  htfBias: "BULLISH" | "BEARISH" | "NEUTRAL";
  /** Pass-3 (A): TRUE 1-hour HTF bias derived from 4×15m aggregated bars
   *  (EMA9/21 stack on the resampled 60m close series). Independent of
   *  the daily-EMA50 `htfBias` — surfaces direction agreement at the
   *  next-higher swing-trade timeframe. NEUTRAL when warm-up is
   *  incomplete (<21 60m bars). */
  htf1hBias: "BULLISH" | "BEARISH" | "NEUTRAL";
  /** Pass-3 (D): this index's 5-day spot return % from the daily series.
   *  Compared in the emission loop against gateCtx.nifty5dReturn for the
   *  RS_CONFLICT gate. Null when daily series too short. */
  index5dReturn: number | null;
  avgVol20: number;
  lastVol: number | null;
  prevSwingHigh: number;
  prevSwingLow: number;
  bars: { o: number[]; h: number[]; l: number[]; c: number[]; v: number[] };
  fullIndicators: boolean;
  /**
   * Previous completed session's daily close from the daily candle series.
   * Used to compute canonical change% (vs prevClose) for the signal card,
   * distinct from `sessionChangePct` which uses today's open as the baseline.
   * Null when the daily series has < 2 bars.
   */
  prevClose: number | null;
  realizedVol14: number | null;
  volRegime: VolRegime;
  /** Phase-1 regime classification (TRENDING_BULL/BEAR | RANGING | VOLATILE | EXPIRY_DAY).
   *  Read-only label attached to every emitted signal — does NOT gate any setup yet. */
  regime: RegimeResult;
}

const MIN_BARS_FOR_CONTEXT = 2;

function simpleAvgRange(highs: number[], lows: number[]): number {
  let sum = 0;
  for (let i = 0; i < highs.length; i++) sum += highs[i]! - lows[i]!;
  return highs.length > 0 ? sum / highs.length : 0;
}

function sma(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function buildContext(cfg: IndexCfg, intra: YahooChart, daily: YahooChart): Ctx | null {
  const today = lastSessionBars(intra);
  if (today.close.length < MIN_BARS_FOR_CONTEXT) {
    logger.warn({ idx: cfg.symbol, sessionBars: today.close.length }, "F&O buildContext: insufficient bars (<2)");
    return null;
  }
  const closes = today.close, highs = today.high, lows = today.low, vols = today.volume;
  const spot = closes.at(-1)!, open0 = today.open[0]!;
  const vwapSeries = sessionVwap(highs, lows, closes, vols);

  // EMA9 / EMA21 / RSI14 are computed on the FULL intra window
  // (5 calendar days of 15-min bars) and then sliced to the session
  // tail. Two reasons to do this rather than session-only:
  //
  //   (1) Warm-up: session-only EMA21 only becomes non-null after
  //       21 today-bars = 21 × 15min = 5h15m of session = 14:30 IST,
  //       which collides with the 14:30 IST late-entry gate on trend
  //       detectors and silently collapses every signal to BASELINE.
  //
  //   (2) Scalar/series consistency: detectors mix scalar reads
  //       (`c.rsi14`) with positional reads (`c.rsiSeries[n - 4]`).
  //       If the scalar comes from full-window seeding and the series
  //       stays session-only, slope checks compare differently-seeded
  //       values and misclassify momentum mid-session. By slicing the
  //       full-window series to length today.close.length, indexing
  //       semantics are preserved (`[-1]` is the latest bar, `[n-4]`
  //       is 4 today-bars ago) AND the values match c.ema9/c.rsi14.
  const intraCloses = intra.close, intraHighs = intra.high, intraLows = intra.low;
  const sessionLen = closes.length;
  const sliceTail = <T>(arr: T[]): T[] =>
    arr.length >= sessionLen ? arr.slice(arr.length - sessionLen) : arr;
  const ema9Series  = sliceTail(ema(intraCloses, 9));
  const ema21Series = sliceTail(ema(intraCloses, 21));
  // Phase-2 confluence-engine inputs. EMA20 sits between the existing
  // EMA9/EMA21 stack so detectors keyed on EMA21 don't shift; EMA50 is
  // a slower trend filter computed on the full intra window so it warms
  // up by mid-morning rather than late-session.
  const ema20Series = sliceTail(ema(intraCloses, 20));
  const ema50Series = sliceTail(ema(intraCloses, 50));
  const rsiSeries   = sliceTail(rsi(intraCloses, 14));

  const vwapRaw    = lastVal(vwapSeries);
  const ema9Raw    = lastVal(ema9Series);
  const ema21Raw   = lastVal(ema21Series);
  const ema20Raw   = lastVal(ema20Series);
  const ema50Raw   = lastVal(ema50Series);
  const rsi14Raw   = lastVal(rsiSeries);

  // ATR is intentionally split:
  //   - `atr15Raw` (full-window) drives the `fullIndicators` warm-up
  //     gate so high-conviction detectors can fire from the open.
  //   - `effectiveAtr15` (used downstream for stop / target geometry)
  //     prefers session-only ATR once we have 14 session bars; before
  //     then it falls back to the trailing 14-intra-bar high-low
  //     simple range. The session-only and simple-range paths both
  //     avoid the overnight-gap inflation that pure full-window TR
  //     ATR produces (TR(first-bar-of-day) includes the prior-day
  //     close-to-today-open jump, which is not a stop-relevant move).
  const atrSeriesSession = atr(highs, lows, closes, 14);
  const atr15Raw = lastVal(atr(intraHighs, intraLows, intraCloses, 14));
  const sessionAtr15 = closes.length >= 14 ? lastVal(atrSeriesSession) : null;
  const intraTailLen = Math.min(14, intraHighs.length);
  const intraTailHL =
    intraTailLen > 0
      ? simpleAvgRange(
          intraHighs.slice(intraHighs.length - intraTailLen),
          intraLows.slice(intraLows.length - intraTailLen),
        )
      : 0;

  const dn = daily.close.length;
  const dailyEma50Series = dn >= 50 ? ema(daily.close, 50) : [];
  const dailyAtrSeries   = dn >= 14 ? atr(daily.high, daily.low, daily.close, 14) : [];
  const dailyEma50Raw = lastVal(dailyEma50Series);
  const atrDailyRaw   = lastVal(dailyAtrSeries);

  // vwapAvailable is false for cash indices (NIFTY/BANKNIFTY/SENSEX): Kite
  // returns volume=0 for every bar, so sessionVwap now correctly returns null
  // for the entire series. This is a STRUCTURAL gap, not a warm-up gap — we
  // do NOT include it in the fullIndicators warm-up gate (which would suppress
  // ALL detectors for index signals). Detectors individually gate on vwapAvailable.
  const vwapAvailable = vwapRaw != null;
  const fullIndicators = ema9Raw != null && ema21Raw != null
    && rsi14Raw != null && atr15Raw != null && dailyEma50Raw != null && atrDailyRaw != null
    && dn >= 50;

  const effectiveVwap      = vwapRaw ?? spot;
  const effectiveEma9      = ema9Raw ?? sma(closes);
  const effectiveEma21     = ema21Raw ?? ema9Raw ?? sma(closes);
  // Phase-2: EMA20 falls back to EMA21 (≈same timeframe), EMA50 to
  // dailyEma50 once available, else to spot. Confluence engine is
  // resilient to flat-stack readings (returns weight 0).
  const effectiveEma20     = ema20Raw ?? ema21Raw ?? sma(closes);
  const effectiveEma50     = ema50Raw ?? sma(closes);
  const effectiveRsi       = rsi14Raw ?? 50;
  // Stop / target ATR: session-only when warm, else gap-free intra-tail
  // simple range, else session simple range. Never the raw full-window
  // TR ATR — see the comment above for why overnight gaps distort it.
  const effectiveAtr15     = sessionAtr15 ?? (intraTailHL > 0 ? intraTailHL : simpleAvgRange(highs, lows));
  const effectiveDailyEma  = dailyEma50Raw ?? spot;
  const effectiveAtrDaily  = atrDailyRaw ?? effectiveAtr15;

  const piv = dn >= 2
    ? pivots(daily.high[dn - 2]!, daily.low[dn - 2]!, daily.close[dn - 2]!)
    : pivots(
        Math.max(...highs),
        Math.min(...lows),
        closes.at(-1)!,
      );
  const vp = dn >= 30
    ? volumeProfile(daily.high, daily.low, daily.close, daily.volume, 30, 60)
    : null;
  // Phase-2: INTRADAY fixed volume profile over the last 60 15-min bars
  // (~3 trading days of context). Cash-index volume from Kite is 0 for
  // NIFTY/BANKNIFTY/etc — `volumeProfile` now returns null when totalVol=0
  // (the degenerate all-zero-bucket profile is correctly rejected), so this
  // is naturally null for those indices and the confluence engine scores it
  // as weight=0 ("warm-up — insufficient bars").
  const vpIntraday = intraCloses.length >= 30
    ? volumeProfile(intraHighs, intraLows, intraCloses, intra.volume, 24, 60)
    : null;
  const last10Vol = vols.slice(-20);
  const avgVol20 = last10Vol.length > 0 ? last10Vol.reduce((a, b) => a + b, 0) / last10Vol.length : 0;
  const lookback = closes.slice(0, -1);
  const lookbackH = highs.slice(0, -1);
  const lookbackL = lows.slice(0, -1);
  const swingWin = Math.min(20, lookback.length);
  const prevSwingHigh = swingWin > 0 ? Math.max(...lookbackH.slice(-swingWin)) : spot;
  const prevSwingLow = swingWin > 0 ? Math.min(...lookbackL.slice(-swingWin)) : spot;

  const htfBias: "BULLISH" | "BEARISH" | "NEUTRAL" =
    spot > effectiveDailyEma * 1.004 ? "BULLISH"
    : spot < effectiveDailyEma * 0.996 ? "BEARISH"
    : "NEUTRAL";

  // Pass-3 (A): TRUE 1-hour HTF aggregation — session-aware. Naive
  // walking-backwards 4-bar chunking would silently span the overnight
  // gap (mixing yesterday's last bars with today's first into a single
  // synthetic "candle"), distorting EMA9/21 with a phantom gap-jump.
  // Instead: group intra bars by IST trading date using `intra.timestamps`,
  // and within EACH session take the close of every completed 4-bar
  // chunk from session-open forward (e.g. bars 1-4, 5-8, ...). Any
  // orphan partial chunk at the END of a session is discarded — we
  // would otherwise emit a half-formed candle whose close is the same
  // as the latest 15m close (already represented in lower-TF series).
  // For the LATEST (in-progress) session this means the freshest 60m
  // candle has at least 4 closed 15m bars before it appears. NSE F&O
  // sessions are 25 bars (09:15-15:30 IST) so a full day yields 6
  // 60m candles. Concatenating chronologically across the 5-day intra
  // window gives ~30 60m bars by mid-day-3 of warm-up.
  const htf60Closes: number[] = [];
  if (intra.timestamps && intra.timestamps.length === intraCloses.length) {
    const istDateOf = (sec: number): string =>
      new Date(sec * 1000 + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    // Bucket bar indices by IST date in chronological order. Map insertion
    // order in JS is stable, so iterating Map.values() yields sessions
    // in the order they first appear (i.e. oldest → newest).
    const byDay = new Map<string, number[]>();
    for (let i = 0; i < intra.timestamps.length; i++) {
      const ts = intra.timestamps[i]!;
      const day = istDateOf(ts);
      const list = byDay.get(day) ?? [];
      list.push(i);
      byDay.set(day, list);
    }
    for (const idxs of byDay.values()) {
      // Within each session, take the close of every completed 4-bar
      // group from open (bar 0) forward. Orphan partial group at the
      // tail is dropped (≤3 bars left over in a 25-bar session = 1
      // dropped chunk per day, by design).
      for (let i = 3; i < idxs.length; i += 4) {
        htf60Closes.push(intraCloses[idxs[i]!]!);
      }
    }
  }
  let htf1hBias: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";
  if (htf60Closes.length >= 21) {
    const ema9_60  = lastVal(ema(htf60Closes, 9));
    const ema21_60 = lastVal(ema(htf60Closes, 21));
    const last60   = htf60Closes[htf60Closes.length - 1]!;
    if (ema9_60 != null && ema21_60 != null) {
      if (last60 > ema21_60 && ema9_60 > ema21_60) htf1hBias = "BULLISH";
      else if (last60 < ema21_60 && ema9_60 < ema21_60) htf1hBias = "BEARISH";
    }
  }

  // Canonical prevClose for change% parity. The previous completed session's
  // close is daily.close[dn - 2] when the last bar is the current forming
  // session, or daily.close[dn - 1] when today hasn't opened yet (weekend).
  // Conservative: always take [dn - 2] when ≥2 bars exist, consistent with
  // how the pivot is derived (pivotsR3 uses daily.close[dn-2] at line 352).
  const prevClose: number | null = dn >= 2 && daily.close[dn - 2] != null
    ? (daily.close[dn - 2] as number)
    : null;

  // Pass-3 (D): per-index 5-day spot return from the daily series. The
  // benchmark (NIFTY 5d) is loaded once per cycle in loadGateContext and
  // compared in the emission loop. Null when daily series too short.
  let index5dReturn: number | null = null;
  if (dn >= RELATIVE_STRENGTH.LOOKBACK_DAYS + 1) {
    const lastClose = daily.close[dn - 1]!;
    const agoClose  = daily.close[dn - 1 - RELATIVE_STRENGTH.LOOKBACK_DAYS]!;
    if (agoClose > 0 && Number.isFinite(lastClose)) {
      index5dReturn = ((lastClose - agoClose) / agoClose) * 100;
    }
  }

  let realizedVol14: number | null = null;
  if (dn >= 15) {
    const dailyCloses = daily.close.slice(-15);
    const logReturns: number[] = [];
    for (let i = 1; i < dailyCloses.length; i++) {
      const prev = dailyCloses[i - 1]!, curr = dailyCloses[i]!;
      if (prev > 0 && curr > 0) logReturns.push(Math.log(curr / prev));
    }
    if (logReturns.length >= 10) {
      const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
      const variance = logReturns.reduce((a, r) => a + (r - mean) ** 2, 0) / (logReturns.length - 1);
      realizedVol14 = Math.sqrt(variance) * Math.sqrt(252) * 100;
    }
  }
  const volRegime = classifyVolRegime(realizedVol14);

  // Phase-1 regime classifier + BUG-73 hysteresis. The raw classifier is
  // stateless and can flip labels on a single borderline bar, causing
  // downstream signal-cohort thrash. `classifyRegimeWithHysteresis`
  // (state per index-symbol, in-memory) requires N=3 consecutive same
  // reads before a NEW label sticks — EXPIRY_DAY (calendar-driven)
  // still applies immediately.
  const regime = classifyRegimeWithHysteresis(cfg.symbol, {
    bars: { h: highs, l: lows, c: closes },
    spot,
    vwap: effectiveVwap,
    ema9: effectiveEma9,
    ema21: effectiveEma21,
    atr15: effectiveAtr15,
    expiryWeekday: cfg.expiryWeekday,
    expiryCadence: cfg.expiryCadence,
  });

  return {
    cfg, spot, open0,
    prevClose,
    sessionChangePct: ((spot - open0) / open0) * 100,
    vwap: effectiveVwap, vwapAvailable, vwapSeries,
    ema9: effectiveEma9, ema21: effectiveEma21,
    ema20: effectiveEma20, ema50: effectiveEma50,
    ema9Series, ema21Series,
    rsi14: effectiveRsi, rsiSeries,
    vp, vpIntraday, piv,
    atr15: effectiveAtr15, atrDaily: effectiveAtrDaily, dailyEma50: effectiveDailyEma,
    htfBias,
    htf1hBias,
    index5dReturn,
    avgVol20,
    lastVol: vols.at(-1) ?? null,
    prevSwingHigh, prevSwingLow,
    bars: { o: today.open, h: highs, l: lows, c: closes, v: vols },
    fullIndicators,
    realizedVol14,
    volRegime,
    regime,
  };
}

// ─── Intraday plan-quality clamps ────────────────────────────────────────
//
// The original detectors derived stop / target from STRUCTURAL levels
// (pivot S1/R1, swing high/low, value-area edges) which on Indian indices
// regularly sit 1–2% from spot. For an INTRADAY option play that's a
// catastrophic plan: the underlying spends most of the session inside a
// 0.5–1% range, so the locked T1 never hits while the wide stop accumulates
// MAE all session. The user's scoreboard reflects this exactly — every
// triggered trade that didn't immediately fail expired below entry with
// MAE much greater than MFE.
//
// We clamp the structural plan back into the empirically achievable
// intraday envelope:
//
//   stop distance  ≤ max(0.45% of spot, 0.6 × ATR15)
//   T1 distance    ≤ min(structural T1, max(1.0% of spot, 1.6 × ATR15))
//   T2 distance    = T1 distance × 1.7   (preserves the existing T1→T2
//                                         runner geometry)
//
// We REJECT (return null) any high-conviction signal whose post-clamp
// risk-reward falls below 1.4 — the trade plan is no longer worth the
// premium decay, and shipping it would be dishonest.
//
// Mean-reversion setups skip the T1/T2 clamp because by construction
// their target IS a mean (VWAP / EMA21) which is necessarily close to
// spot — re-clamping would mangle the geometry.
const MAX_STOP_PCT_OF_SPOT = 0.0045;
const MAX_T1_PCT_OF_SPOT = 0.010;
const STOP_ATR_MULT = 0.6;
const T1_ATR_MULT = 1.6;
const T2_FROM_T1_MULT = 1.7;
const MIN_RR_FOR_HC = 1.4;

// PHASE-2 SL FLOOR. Empirically the loss sample showed many stops hit by
// a single 15-min wick on otherwise-correct directional reads. The shrink
// cap above can pull the stop in to ~25-30 pts on NIFTY when the structural
// pivot stop is tight, which is well inside one bar of realised noise.
// We now enforce a MINIMUM stop distance of max(0.30% × spot, 1.0 × ATR15)
// so every stop has at least one bar of breathing room. Per-trade rupee
// risk is preserved automatically by paperTradingFO sizing
// (`lots = budget / perLotLoss` — wider stop → smaller qty → same rupees).
// MEAN_REVERSION is exempt by construction (its targets ARE the mean).
const MIN_STOP_PCT_OF_SPOT = 0.0030;
const MIN_STOP_ATR_MULT = 1.0;

// PHASE-2 HC EMISSION FLOOR. Detectors return signals at any conf ≥ 50
// (their internal floor) but the paper-trading auto-trade floor is 70.
// Cards in the 50-69 range therefore display as "HIGH_CONVICTION" but
// never get auto-traded — a UX bug that also pollutes the lifecycle
// outcome ledger with low-edge plans. We now demote anything below 65
// out of the HC pool. Baseline outlook still carries the directional read.
const HC_EMISSION_FLOOR = 65;

// IST minute-of-day after which fresh high-conviction TREND-style entries
// are blocked. Trend Continuation / VWAP Reclaim / Volume Breakout / EMA
// Pullback all target a pivot R1/R2-class move that historically takes
// the full afternoon to materialise. Firing one at 14:45 with 45 minutes
// of session left almost guarantees an EXPIRED_TRIGGERED outcome — which
// is exactly what the scoreboard shows. Mean Reversion is exempt because
// its target is the *nearest* mean (close, fast).
const LATE_ENTRY_CUTOFF_IST_MIN = 14 * 60 + 30; // 14:30 IST

// PHASE-2 OPENING-NOISE FLOOR. Block fresh HC TREND-style emission in the
// first 15 minutes (09:15-09:30 IST). Open-auction order flow in this
// window is dominated by overnight gap-fills and pre-market positioning,
// not the intraday continuation/reclaim/breakout patterns the detectors
// are calibrated for — signals fired here whipsawed out within an hour
// in the loss sample. Mean Reversion is exempt (a fade of the opening
// extreme is a valid setup).
const OPENING_NOISE_CUTOFF_IST_MIN = 9 * 60 + 30; // 09:30 IST

function nowIstMinutes(d: Date = new Date()): number {
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
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
  /** Honest execution semantics. All current setups use TOUCH_OR_TICK: the paper
   * engine fires PENDING→TRIGGERED when bar.high (CALL) or bar.low (PUT) reaches
   * the entry level — the candle does NOT need to close there. */
  triggerSemantics?: "TOUCH_OR_TICK" | "CLOSE_CONFIRMED";
  entryLevel: number;
  stopLevel: number;
  targetLevel: number;
  target2Level: number;
  invalidation: string;
  // Pass-2A: true when the ATR-driven MIN stop floor exceeded the
  // structural MAX stop cap (volatile day). Set inside
  // clampPlanForIntraday. Used downstream to (a) force tier to BASELINE
  // and (b) tag the OptionSignal "VOL_CLAMPED_STOP" so the paper trader
  // routes via the conservative lane (1% loss cap, dynamic sizing).
  volClamped?: boolean;
  // Pass-2B signal-accuracy gates. Each, when set, force-demotes the
  // setup from HIGH_CONVICTION to BASELINE in the emission loop and
  // adds a matching audit tag in toSignal. Set in buildSignalsForIndex
  // emission loop (per-detector and per-tick).
  htfConflictGate?: boolean;          // ctx.htfBias (daily spot vs EMA50) opposes setup direction
  noiseWindow?: "OPENING" | "CLOSING"; // 09:15-09:30 or 15:15-15:30 IST
  inExpiryDay?: boolean;              // ctx.regime.regime === "EXPIRY_DAY"
  // Pass-3 signal-accuracy gates. Same demote-only semantics as Pass-2B.
  htf1hConflictGate?: boolean;        // (A) true 1h HTF bias opposes setup direction
  rsConflictGate?: boolean;           // (D) sector lagging/leading NIFTY against setup direction
  lowWinRateGate?: boolean;           // (E) setup_key 30d win-rate < threshold (with sample guard)
  // 2026-06-09 hygiene vetoes (flag: FNO_SIGNAL_HYGIENE_V2). Demote-only,
  // same partition semantics as the Pass-2B/3 gates above. Surface as the
  // RECOVERY_MODE_VETO / CHASE_RISK_VETO audit tags in toSignal.
  recoveryVetoGate?: boolean;         // fresh BEARISH (PUT) into an intraday V-recovery
  chaseVetoGate?: boolean;            // fresh BULLISH (CALL) chased at top of a vertical run
  // Note: (G) ATM-OI confluence is enforced post-toSignal in
  // applyOiConfirmation by mutating tier/tags directly — not via a
  // Detected flag, since the OI insights aren't available until after
  // buildSignalsForIndex returns.
}

// Pass-2A: extreme-volatility hard reject. When the implied minStop
// exceeds maxStop by more than this multiple, the structural envelope
// is so badly broken that even a soft-demote to BASELINE risks
// avoidable damage on a chaotic day. Below the multiple we accept the
// trade at BASELINE tier (smaller exposure, full audit tag).
const VOL_CLAMP_REJECT_RATIO = 1.5;

/** 1. Trend Continuation — strong VWAP+EMA alignment, fresh momentum, RSI in trend zone */
function detectTrendContinuation(c: Ctx): Detected | null {
  // ── VWAP-UNAVAILABLE BRANCH ──────────────────────────────────────────────
  // For cash indices (NIFTY/BANKNIFTY/SENSEX), Kite candle volume is always
  // zero, so sessionVwap returns null for the entire series and vwapAvailable
  // is false. When VWAP is unavailable we degrade to EMA-stack-only gating:
  //   • The ±25 VWAP confidence driver is omitted (honest — not fabricated).
  //   • Base confidence drops from 45 to 20 (losing the VWAP driver weight).
  //   • Stop/target geometry falls back to pivot-only (effectiveVwap = spot).
  //   • An explicit "VWAP data quality" driver is appended so the card is
  //     transparent about the missing data source.
  if (!c.vwapAvailable) {
    const stackBull = c.ema9 > c.ema21 && c.spot > c.ema9;
    const stackBear = c.ema9 < c.ema21 && c.spot < c.ema9;
    if (!stackBull && !stackBear) return null;
    const dir: Direction = stackBull ? "BULLISH" : "BEARISH";
    const drivers: SignalReason[] = [];
    let conf = 0;
    if (dir === "BULLISH") {
      drivers.push({ label: "EMA 9 > EMA 21 stack", detail: `EMA9 ${c.ema9.toFixed(2)} > EMA21 ${c.ema21.toFixed(2)} — fast above slow.`, weight: 20, bullish: true });
      conf += 20;
      if (c.rsi14 >= 52 && c.rsi14 <= 68) { drivers.push({ label: "RSI healthy bullish", detail: `RSI ${c.rsi14.toFixed(1)} in trend zone (52–68).`, weight: 15, bullish: true }); conf += 15; }
      else if (c.rsi14 > 68) { drivers.push({ label: "RSI overbought caution", detail: `RSI ${c.rsi14.toFixed(1)} — extended; size smaller.`, weight: 5, bullish: false }); conf -= 5; }
      // D-FAB-04 quarantine: POC/VAH/VAL from an untrusted (zero-volume) index
      // series must not contribute directional points. This branch fires only
      // when vwapAvailable=false (cash indices with structural zero candle volume),
      // so c.vp is always null here (volumeProfile returns null when totalVol=0).
      // The explicit absence of the "Above POC" check below closes the structural
      // vulnerability: even if c.vp were somehow non-null (data anomaly), no
      // directional points or confidence change is applied.
      if (c.lastVol != null && c.lastVol > c.avgVol20 * 1.2) { drivers.push({ label: "Volume confirmation", detail: `Last bar vol ${(c.lastVol / 1e6).toFixed(2)}M > 20-bar avg.`, weight: 8, bullish: true }); conf += 8; }
    } else {
      drivers.push({ label: "EMA 9 < EMA 21 stack", detail: `EMA9 ${c.ema9.toFixed(2)} < EMA21 ${c.ema21.toFixed(2)} — fast below slow.`, weight: 20, bullish: false });
      conf += 20;
      if (c.rsi14 <= 48 && c.rsi14 >= 32) { drivers.push({ label: "RSI healthy bearish", detail: `RSI ${c.rsi14.toFixed(1)} in trend zone (32–48).`, weight: 15, bullish: false }); conf += 15; }
      else if (c.rsi14 < 32) { drivers.push({ label: "RSI oversold caution", detail: `RSI ${c.rsi14.toFixed(1)} — bounce risk; size smaller.`, weight: 5, bullish: true }); conf -= 5; }
      // D-FAB-04 quarantine: "Below POC" removed from no-VWAP (index) branch.
      // See BULLISH arm above for rationale.
      if (c.lastVol != null && c.lastVol > c.avgVol20 * 1.2) { drivers.push({ label: "Volume confirmation", detail: `Last bar vol ${(c.lastVol / 1e6).toFixed(2)}M > 20-bar avg.`, weight: 8, bullish: false }); conf += 8; }
    }
    drivers.push({
      label: "VWAP data quality",
      detail: "Index spot candles carry zero volume — session VWAP is structurally unavailable; direction from EMA+RSI only.",
      weight: 0, bullish: dir === "BULLISH",
    });
    if ((dir === "BULLISH" && c.htfBias === "BEARISH") || (dir === "BEARISH" && c.htfBias === "BULLISH")) {
      conf = Math.max(0, conf - 12);
      drivers.push({ label: "HTF conflict — daily trend opposes", detail: `Daily EMA50 ${c.dailyEma50.toFixed(2)} vs spot ${c.spot.toFixed(2)} suggests counter-trend; size smaller.`, weight: 12, bullish: dir === "BULLISH" });
    }
    conf = Math.max(0, Math.min(100, conf));
    if (conf < 50) return null;
    const trigger = dir === "BULLISH" ? c.prevSwingHigh : c.prevSwingLow;
    const stop = dir === "BULLISH"
      ? Math.min(c.piv.s1, c.spot - c.atrDaily * 0.3)
      : Math.max(c.piv.r1, c.spot + c.atrDaily * 0.3);
    // D-FAB-04 quarantine: target must not be widened by an untrusted VP value.
    // In this no-VWAP (index) branch VP is structurally unavailable; use pivot
    // levels only, without the c.vp?.valueAreaHigh / c.vp?.valueAreaLow terms.
    const t1 = dir === "BULLISH"
      ? c.piv.r1 + c.atr15 * 0.3
      : c.piv.s1 - c.atr15 * 0.3;
    const t2 = dir === "BULLISH" ? c.piv.r2 : c.piv.s2;
    const dist = Math.abs(c.spot - trigger);
    const triggerDesc = dir === "BULLISH"
      ? `Spot touches/crosses above ₹${trigger.toFixed(2)} (intraday swing high — touch trigger)`
      : `Spot touches/crosses below ₹${trigger.toFixed(2)} (intraday swing low — touch trigger)`;
    return {
      setupKey: "TREND_CONTINUATION",
      setupName: dir === "BULLISH" ? "Trend Continuation — Long" : "Trend Continuation — Short",
      setupSummary: dir === "BULLISH"
        ? "Buy CE on momentum continuation. EMA stack + RSI aligned bullish; enter on next break of intraday swing high. (VWAP unavailable — index candle volume is 0.)"
        : "Buy PE on momentum continuation. EMA stack + RSI aligned bearish; enter on next break of intraday swing low. (VWAP unavailable — index candle volume is 0.)",
      direction: dir,
      confidence: conf,
      drivers,
      entryTrigger: triggerDesc + (dist > c.atr15 * 1.5 ? " — currently extended; wait for pullback." : ""),
      entryLevel: trigger,
      stopLevel: stop,
      targetLevel: t1,
      target2Level: t2,
      invalidation: dir === "BULLISH"
        ? `Close below EMA21 ${c.ema21.toFixed(2)} or below S1 ${c.piv.s1.toFixed(2)}.`
        : `Close above EMA21 ${c.ema21.toFixed(2)} or above R1 ${c.piv.r1.toFixed(2)}.`,
    };
  }
  // ── VWAP-AVAILABLE PATH (equity stocks / equity-index futures with real volume) ──
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
    if (c.lastVol != null && c.lastVol > c.avgVol20 * 1.2) { drivers.push({ label: "Volume confirmation", detail: `Last bar vol ${(c.lastVol / 1e6).toFixed(2)}M > 20-bar avg.`, weight: 8, bullish: true }); conf += 8; }
  } else {
    drivers.push({ label: "Spot below VWAP", detail: `${c.spot.toFixed(2)} < VWAP ${c.vwap.toFixed(2)}`, weight: 25, bullish: false });
    drivers.push({ label: "EMA 9 < EMA 21 stack", detail: `EMA9 ${c.ema9.toFixed(2)} < EMA21 ${c.ema21.toFixed(2)} — fast below slow.`, weight: 20, bullish: false });
    conf += 45;
    if (c.rsi14 <= 48 && c.rsi14 >= 32) { drivers.push({ label: "RSI healthy bearish", detail: `RSI ${c.rsi14.toFixed(1)} in trend zone (32–48).`, weight: 15, bullish: false }); conf += 15; }
    else if (c.rsi14 < 32) { drivers.push({ label: "RSI oversold caution", detail: `RSI ${c.rsi14.toFixed(1)} — bounce risk; size smaller.`, weight: 5, bullish: true }); conf -= 5; }
    if (c.vp && c.spot < c.vp.pointOfControl) { drivers.push({ label: "Below POC", detail: `Spot below POC ${c.vp.pointOfControl.toFixed(2)} — value supports sellers.`, weight: 8, bullish: false }); conf += 8; }
    if (c.lastVol != null && c.lastVol > c.avgVol20 * 1.2) { drivers.push({ label: "Volume confirmation", detail: `Last bar vol ${(c.lastVol / 1e6).toFixed(2)}M > 20-bar avg.`, weight: 8, bullish: false }); conf += 8; }
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
    ? `Spot touches/crosses above ₹${trigger.toFixed(2)} (intraday swing high — touch trigger)`
    : `Spot touches/crosses below ₹${trigger.toFixed(2)} (intraday swing low — touch trigger)`;

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
      ? `Close below VWAP ${c.vwap.toFixed(2)} or below S1 ${c.piv.s1.toFixed(2)}.`
      : `Close above VWAP ${c.vwap.toFixed(2)} or above R1 ${c.piv.r1.toFixed(2)}.`,
  };
}

/** 2. VWAP Reclaim/Reject — fresh cross of VWAP with momentum */
function detectVwapReclaim(c: Ctx): Detected | null {
  // This setup is entirely VWAP-based — the "reclaim" IS the VWAP cross.
  // Without a real volume-weighted price there is no valid cross to detect.
  // For cash indices (volume=0) the VWAP series is all null, so any
  // apparent cross would be fabricated from HLC3. Hard-suppress.
  if (!c.vwapAvailable) return null;
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

  if (c.lastVol != null && c.lastVol > c.avgVol20) { drivers.push({ label: "Volume on cross", detail: `Last bar vol > 20-bar avg.`, weight: 8, bullish: dir === "BULLISH" }); conf += 8; }

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
      ? `Spot touches/crosses above ₹${trigger.toFixed(2)} with VWAP holding (touch trigger)`
      : `Spot touches/crosses below ₹${trigger.toFixed(2)} with VWAP rejecting (touch trigger)`,
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

  // require volume + momentum. Volume Breakout DEPENDS on a real volume
  // print — without one the entire detector is meaningless, so we drop
  // the signal rather than fire on momentum alone.
  if (c.lastVol == null) return null;
  const lastVol = c.lastVol;
  const volOk = lastVol > c.avgVol20 * 1.3;
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
    detail: `Last bar volume ${(lastVol / 1e6).toFixed(2)}M is ${(lastVol / Math.max(1, c.avgVol20)).toFixed(1)}× the 20-bar avg.`,
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
      ? `Spot touches/crosses above ₹${trigger.toFixed(2)} (VAH) with volume > 20-bar avg (touch trigger)`
      : `Spot touches/crosses below ₹${trigger.toFixed(2)} (VAL) with volume > 20-bar avg (touch trigger)`,
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
      ? `Spot touches/crosses above ₹${trigger.toFixed(2)} (last bar high — touch trigger)`
      : `Spot touches/crosses below ₹${trigger.toFixed(2)} (last bar low — touch trigger)`,
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
    ? c.bars.h.at(-1)! // above last bar high (touch trigger)
    : c.bars.l.at(-1)!; // below last bar low (touch trigger)
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
      ? `Spot touches/crosses above ₹${trigger.toFixed(2)} (reversal — touch trigger)`
      : `Spot touches/crosses below ₹${trigger.toFixed(2)} (reversal — touch trigger)`,
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
 * Higher-conviction setups (when they fire) are listed first; baseline is the fallback floor.
 *
 * When vwapAvailable=false (cash indices with zero candle volume), the VWAP
 * vote is dropped and a 3-vote system is used (EMA21, EMA9vsEMA21, RSI).
 * This avoids the systematic BEARISH bias that would result from scoring
 * `spot > spot` (effectiveVwap=spot → always false → always one free bearish vote). */
function detectBaselineOutlook(c: Ctx): Detected | null {
  let dir: Direction;
  let align: number;
  const spotAboveEma21 = c.spot > c.ema21;
  const ema9AboveEma21 = c.ema9 > c.ema21;
  const rsiAbove50 = c.rsi14 > 50;
  const drivers: SignalReason[] = [];

  if (!c.vwapAvailable) {
    // 3-vote system: EMA21, EMA9vsEMA21, RSI
    const bullVotes3 = (spotAboveEma21 ? 1 : 0) + (ema9AboveEma21 ? 1 : 0) + (rsiAbove50 ? 1 : 0);
    const bearVotes3 = 3 - bullVotes3;
    dir = bullVotes3 > bearVotes3 ? "BULLISH"
      : bullVotes3 < bearVotes3 ? "BEARISH"
      : (c.sessionChangePct >= 0 ? "BULLISH" : "BEARISH");
    align = Math.max(bullVotes3, bearVotes3);
    drivers.push(
      { label: spotAboveEma21 ? "Spot above EMA21" : "Spot below EMA21", detail: `Spot ${spotAboveEma21 ? "above" : "below"} EMA21 ${c.ema21.toFixed(2)}.`, weight: 10, bullish: spotAboveEma21 },
      { label: ema9AboveEma21 ? "EMA 9 > 21" : "EMA 9 < 21", detail: `EMA9 ${c.ema9.toFixed(2)} vs EMA21 ${c.ema21.toFixed(2)}.`, weight: 10, bullish: ema9AboveEma21 },
      { label: `RSI ${c.rsi14.toFixed(1)}`, detail: `RSI ${rsiAbove50 ? "above" : "below"} 50 — ${rsiAbove50 ? "bullish" : "bearish"} bias.`, weight: 8, bullish: rsiAbove50 },
      { label: "VWAP data quality", detail: "Index spot candles carry zero volume — VWAP vote omitted from direction score; using EMA+RSI only.", weight: 0, bullish: dir === "BULLISH" },
    );
  } else {
    const spotAboveVwap = c.spot > c.vwap;
    const bullVotes = (spotAboveVwap ? 1 : 0) + (spotAboveEma21 ? 1 : 0) + (ema9AboveEma21 ? 1 : 0) + (rsiAbove50 ? 1 : 0);
    const bearVotes = 4 - bullVotes;
    dir = bullVotes > bearVotes ? "BULLISH"
      : bullVotes < bearVotes ? "BEARISH"
      : (c.sessionChangePct >= 0 ? "BULLISH" : "BEARISH");
    align = Math.max(bullVotes, bearVotes);
    drivers.push(
      { label: spotAboveVwap ? "Spot above VWAP" : "Spot below VWAP", detail: `Spot ${c.spot.toFixed(2)} ${spotAboveVwap ? ">" : "<"} VWAP ${c.vwap.toFixed(2)}.`, weight: 12, bullish: spotAboveVwap },
      { label: spotAboveEma21 ? "Spot above EMA21" : "Spot below EMA21", detail: `Spot ${spotAboveEma21 ? "above" : "below"} EMA21 ${c.ema21.toFixed(2)}.`, weight: 10, bullish: spotAboveEma21 },
      { label: ema9AboveEma21 ? "EMA 9 > 21" : "EMA 9 < 21", detail: `EMA9 ${c.ema9.toFixed(2)} vs EMA21 ${c.ema21.toFixed(2)}.`, weight: 10, bullish: ema9AboveEma21 },
      { label: `RSI ${c.rsi14.toFixed(1)}`, detail: `RSI ${rsiAbove50 ? "above" : "below"} 50 — ${rsiAbove50 ? "bullish" : "bearish"} bias.`, weight: 8, bullish: rsiAbove50 },
    );
  }

  const conf = (c.vwapAvailable ? 35 : 30) + align * 5; // 35–55% with VWAP, 30–45% without
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
      ? `Spot touches/crosses above ₹${trigger.toFixed(2)} (intraday swing high) — touch trigger; wait for follow-through`
      : `Spot touches/crosses below ₹${trigger.toFixed(2)} (intraday swing low) — touch trigger; wait for follow-through`,
    entryLevel: trigger,
    stopLevel: stop,
    targetLevel: t1,
    target2Level: t2,
    invalidation: dir === "BULLISH"
      ? (c.vwapAvailable
          ? `Sustained close below VWAP ${c.vwap.toFixed(2)} flips bias.`
          : `Sustained close below EMA21 ${c.ema21.toFixed(2)} flips bias.`)
      : (c.vwapAvailable
          ? `Sustained close above VWAP ${c.vwap.toFixed(2)} flips bias.`
          : `Sustained close above EMA21 ${c.ema21.toFixed(2)} flips bias.`),
  };
}

/**
 * Tighten a detector's structural plan to an INTRADAY-realistic envelope.
 * Returns the modified Detected if its post-clamp risk-reward still
 * clears `MIN_RR_FOR_HC`; otherwise returns null and the caller drops
 * the signal. Mean-reversion is exempt — its target is the proximate
 * mean by design and any clamp would distort the geometry.
 *
 * The clamp NEVER widens stops or pulls targets out — it only shrinks
 * a too-wide structural plan back to what the underlying actually
 * traverses in a typical session. If the structural plan is already
 * tight, this is a no-op.
 */
/**
 * Translate the plan so the entry trigger sits at a price spot can
 * actually reach in the remaining session, while preserving the entry→
 * stop and entry→target distances (RR is unchanged).
 *
 * The OG geometry uses prevSwingHigh/Low or pivot levels for the entry
 * trigger. On a stable trending day those are routinely 1.5–3% away from
 * current spot, so the lifecycle marks the plan PENDING and the move
 * never reaches the trigger before 15:30 — the "card stuck on Waiting
 * trigger" complaint. We cap the gap at min(0.5% spot, 1.2 × ATR15).
 *
 * If the structural trigger is already within the cap, this is a no-op.
 * We never push the trigger AWAY from spot (that would reduce edge) and
 * we never invert the side (a BULLISH trigger always sits >= spot).
 */
function applyTriggerRealism(d: Detected, c: Ctx): Detected {
  if (d.setupKey === "MEAN_REVERSION") return d; // by-design counter-trend
  const dir = d.direction;
  const gap = dir === "BULLISH" ? d.entryLevel - c.spot : c.spot - d.entryLevel;
  if (!(gap > 0)) return d; // trigger already at-or-through spot
  const maxGap = Math.max(0.005 * c.spot, 1.2 * c.atr15);
  if (gap <= maxGap) return d;
  // How far we need to pull the trigger toward spot.
  const shift = gap - maxGap;
  const newEntry = dir === "BULLISH" ? d.entryLevel - shift : d.entryLevel + shift;
  // Translate stop and targets by the same shift (in the same direction)
  // so risk and reward distances are preserved.
  const sgn = dir === "BULLISH" ? -1 : +1;
  return {
    ...d,
    entryLevel: newEntry,
    stopLevel: d.stopLevel + sgn * shift,
    targetLevel: d.targetLevel + sgn * shift,
    target2Level: d.target2Level + sgn * shift,
    entryTrigger: dir === "BULLISH"
      ? `Spot touches/crosses above ₹${newEntry.toFixed(2)} (pulled in from ₹${d.entryLevel.toFixed(2)} — touch trigger)`
      : `Spot touches/crosses below ₹${newEntry.toFixed(2)} (pulled in from ₹${d.entryLevel.toFixed(2)} — touch trigger)`,
  };
}

function clampPlanForIntraday(d: Detected, c: Ctx, minRr: number = MIN_RR_FOR_HC): Detected | null {
  if (d.setupKey === "MEAN_REVERSION") return d;

  const dir = d.direction;
  const entry = d.entryLevel;

  // Stop: clamp distance to [minStopDist, maxStopDist].
  //   - maxStopDist (Phase-1) = max(0.45% spot, 0.6 × ATR15) — shrinks
  //     a too-wide structural plan back to a realistic intraday envelope.
  //   - minStopDist (Phase-2) = max(0.30% spot, 1.0 × ATR15) — widens a
  //     too-tight structural plan so the stop survives one bar of noise.
  // The MIN floor wins on volatile days where it would exceed the cap;
  // a stop must always survive realised noise even if it pushes the
  // rupee-budget past the structural ceiling. The paper book auto-
  // shrinks lots so per-trade rupee risk stays constant.
  // Final stop sits at clamp(struct, min, max), enforcing min last.
  //
  // Pass-2A: when minStop > maxStop the structural envelope is broken
  // (the trade no longer fits the regime it was designed for). We:
  //   (1) HARD-REJECT when the breach is extreme (ratio > 1.5) — even
  //       conservative sizing won't fix a stop that's 50%+ wider than
  //       what the structural read can defend.
  //   (2) FLAG everything else as `volClamped` so emission downgrades
  //       the tier from HIGH_CONVICTION to BASELINE (paper trader picks
  //       up the conservative lane: 1% loss cap, dynamic sizing, no
  //       fixed-lot override). The trade still happens but loses
  //       headline status. Audit tag `VOL_CLAMPED_STOP` is added on
  //       the OptionSignal in toSignal().
  const minStopDist = Math.max(MIN_STOP_PCT_OF_SPOT * c.spot, MIN_STOP_ATR_MULT * c.atr15);
  const maxStopDist = Math.max(MAX_STOP_PCT_OF_SPOT * c.spot, STOP_ATR_MULT * c.atr15);
  const volClamped = minStopDist > maxStopDist;
  if (volClamped) {
    const ratio = maxStopDist > 0 ? minStopDist / maxStopDist : Infinity;
    if (ratio > VOL_CLAMP_REJECT_RATIO) {
      logger.info(
        {
          setupKey: d.setupKey,
          symbol: c.cfg.symbol,
          spot: c.spot,
          atr15: c.atr15,
          minStopDist: +minStopDist.toFixed(2),
          maxStopDist: +maxStopDist.toFixed(2),
          ratio: +ratio.toFixed(2),
          rejectAt: VOL_CLAMP_REJECT_RATIO,
        },
        "FO skip: ATR-floor stop excessively beyond structural cap (vol-regime broke trade envelope)",
      );
      return null;
    }
  }
  const structStopDist = Math.abs(entry - d.stopLevel);
  const newStopDist = Math.max(Math.min(structStopDist, maxStopDist), minStopDist);
  const stopLevel = dir === "BULLISH" ? entry - newStopDist : entry + newStopDist;

  // T1: clamp distance to min(structural T1, max(1.0% spot, 1.6 × ATR15)).
  // Same one-sided semantics — we never push the target further out.
  const maxT1Dist = Math.max(MAX_T1_PCT_OF_SPOT * c.spot, T1_ATR_MULT * c.atr15);
  const structT1Dist = Math.abs(d.targetLevel - entry);
  const newT1Dist = Math.min(structT1Dist, maxT1Dist);
  const targetLevel = dir === "BULLISH" ? entry + newT1Dist : entry - newT1Dist;

  // T2: pinned to T1 × 1.7 from entry so a runner still has meaningful
  // upside without being so far away it can never hit. We also keep
  // structural T2 as a ceiling — never push past where the original
  // detector said the move would target.
  //
  // INVARIANT: T2 must always sit strictly beyond T1 in trade direction.
  // Some structural plans put T2 == T1 (or close), and after we shrink T1
  // the structural-T2 ceiling can collapse to a value <= newT1Dist. The
  // lifecycle evaluates T2 BEFORE T1, so a folded geometry would fire
  // false T2 hits the moment T1 is touched. If the structural cap would
  // violate the ordering, drop the cap and use the geometric T2 directly.
  const proposedT2Dist = newT1Dist * T2_FROM_T1_MULT;
  const structT2Dist = Math.abs(d.target2Level - entry);
  const cappedT2Dist =
    structT2Dist > newT1Dist
      ? Math.min(proposedT2Dist, structT2Dist)
      : proposedT2Dist;
  if (cappedT2Dist <= newT1Dist) return null;
  const target2Level = dir === "BULLISH" ? entry + cappedT2Dist : entry - cappedT2Dist;

  // RR gate. Stop distance can collapse to ~0 in pathological cases
  // (entry == structural stop), in which case the trade is meaningless.
  if (newStopDist <= 0) return null;
  const rr = newT1Dist / newStopDist;
  if (rr < minRr) return null;

  return {
    ...d,
    stopLevel,
    targetLevel,
    target2Level,
    volClamped,
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
  // Pass-2A audit tag — surfaces the demote-to-BASELINE reason on the
  // card and in analytics. Trader can see exactly why a setup that
  // would otherwise have been HC is sized down today.
  if (d.volClamped) tags.push("VOL_CLAMPED_STOP");
  // Pass-2B signal-accuracy audit tags. Each maps 1:1 to a flag set
  // in the emission loop; presence implies the setup was demoted from
  // HIGH_CONVICTION to BASELINE for that reason. (HTF_CONFLICT is also
  // emitted by the existing htfConflict computation above; the gate
  // path uses the same tag so analytics see one canonical label.)
  if (d.noiseWindow === "OPENING") tags.push("OPENING_NOISE");
  if (d.noiseWindow === "CLOSING") tags.push("CLOSING_NOISE");
  if (d.inExpiryDay) tags.push("EXPIRY_DAY");
  // Pass-3 audit tags. Each maps 1:1 to a Detected gate flag set in
  // the emission loop; presence implies the setup was demoted from
  // HIGH_CONVICTION to BASELINE for that reason. (OI_ATM_CONFLICT is
  // pushed later in applyOiConfirmation, not here.)
  if (d.htf1hConflictGate) tags.push("HTF1H_CONFLICT");
  if (d.rsConflictGate) tags.push("RS_CONFLICT");
  if (d.lowWinRateGate) tags.push("LOW_WINRATE");
  // 2026-06-09 hygiene veto audit tags. Each maps 1:1 to a Detected flag
  // set in the emission loop; presence implies the setup was demoted from
  // HIGH_CONVICTION to INFO_ONLY (BASELINE tier) for that reason.
  if (d.recoveryVetoGate) tags.push("RECOVERY_MODE_VETO");
  if (d.chaseVetoGate) tags.push("CHASE_RISK_VETO");
  return {
    index: c.cfg.symbol,
    indexName: c.cfg.display,
    spot: round2(c.spot),
    spotChangePercent: round2(c.sessionChangePct),
    spotChangePctVsPrevClose: (c.prevClose != null && c.prevClose > 0)
      ? round2((c.spot - c.prevClose) / c.prevClose * 100)
      : undefined,
    spotPrevClose: c.prevClose != null ? round2(c.prevClose) : undefined,
    bias: d.direction,
    confidence: d.confidence,
    tier,
    // 2026-06-09: explicit tradeability class. Only HIGH_CONVICTION is
    // auto-tradeable; everything else (BASELINE / vetoed / demoted) is
    // strictly INFO_ONLY and the paper auto-trader refuses to open it.
    tradeClass: deriveTradeClass(tier, isSignalHygieneV2Enabled()),
    timeframe: "intraday-15m",
    vwap: round2(c.vwap),
    vwapAvailable: c.vwapAvailable,
    ema9: round2(c.ema9),
    ema21: round2(c.ema21),
    rsi: round2(c.rsi14),
    ema20: round2(c.ema20),
    ema50: round2(c.ema50),
    valueAreaHigh: c.vp ? round2(c.vp.valueAreaHigh) : undefined,
    valueAreaLow: c.vp ? round2(c.vp.valueAreaLow) : undefined,
    pointOfControl: c.vp ? round2(c.vp.pointOfControl) : undefined,
    intradayValueAreaHigh: c.vpIntraday ? round2(c.vpIntraday.valueAreaHigh) : undefined,
    intradayValueAreaLow:  c.vpIntraday ? round2(c.vpIntraday.valueAreaLow)  : undefined,
    intradayPointOfControl: c.vpIntraday ? round2(c.vpIntraday.pointOfControl) : undefined,
    confluenceScore: (d as Detected & { confluenceScore?: number }).confluenceScore,
    dailyEma50: round2(c.dailyEma50),
    htfBias: c.htfBias,
    htfConflict,
    tags,
    setupKey: d.setupKey,
    setupName: d.setupName,
    setupSummary: d.setupSummary,
    entryTrigger: d.entryTrigger,
    triggerSemantics: (d.triggerSemantics ?? "TOUCH_OR_TICK") as "TOUCH_OR_TICK" | "CLOSE_CONFIRMED",
    leg: (() => {
      const _ot = d.direction === "BULLISH" ? ("CE" as const) : ("PE" as const);
      const _ae = expiryFor(c.cfg);
      const _cmf = resolveContractMaster(c.cfg.symbol, _ae, strike, _ot, c.cfg.expiryCadence);
      return {
        type: d.direction === "BULLISH" ? ("CALL" as const) : ("PUT" as const),
        strike,
        action: "BUY" as const,
        expiry: _cmf.expiry,
        expirySource: _cmf.expirySource,
        expiryType: _cmf.expiryType,
        contractInstrumentToken: _cmf.instrumentToken ?? undefined,
        tradingSymbol: _cmf.tradingSymbol ?? undefined,
        exchange: _cmf.exchange === "unknown" ? undefined : _cmf.exchange as "NFO" | "BFO",
        contractGrade: _cmf.contractGrade,
        entry: round2(d.entryLevel),
        instrument: "UNDERLYING_LEVEL" as const,
        stopLoss: round2(d.stopLevel),
        target1: round2(d.targetLevel),
        target2: round2(d.target2Level),
        riskRewardRatio: rr,
      };
    })(),
    drivers: d.drivers,
    invalidation: d.invalidation,
    generatedAt: new Date(),
    regime: c.regime.regime,
    regimeReason: c.regime.reason,
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

function buildSignalsForIndex(
  cfg: IndexCfg,
  intra: YahooChart,
  daily: YahooChart,
  gateCtx?: GateContext,
): IndexBuildResult {
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

  // Trend-class detectors target a pivot R1/R2-class move and need the full
  // afternoon to play out; gate them off after 14:30 IST so we don't ship a
  // signal that geometrically cannot resolve before the 15:30 close. Mean
  // Reversion targets the proximate VWAP/EMA21 mean and remains eligible.
  //
  // VWAP_RECLAIM has an EARLIER cutoff (13:30 IST) than the rest of the
  // trend class — it specifically targets the *next* pivot R1/R2 move
  // after the reclaim, which empirically takes 2+ hours. Every reclaim
  // in the loss sample fired after 13:30 and timed out.
  const istMin = nowIstMinutes(new Date());
  const trendEntryAllowed = istMin < LATE_ENTRY_CUTOFF_IST_MIN;
  const vwapReclaimAllowed = istMin < VWAP_RECLAIM_LATE_CUTOFF_IST_MIN;
  // Phase-2 opening-noise gate: trend-class detectors are blocked in the
  // first 15 minutes of session. Mean Reversion (trendClass:false) is
  // exempt because fading the opening extreme is a valid setup.
  const openingAllowed = istMin >= OPENING_NOISE_CUTOFF_IST_MIN;

  const detectors: Array<{ name: string; fn: (c: Ctx) => Detected | null; trendClass: boolean; lateCutoff?: number }> = [
    { name: "trend_continuation", fn: detectTrendContinuation, trendClass: true  },
    { name: "vwap_reclaim",       fn: detectVwapReclaim,       trendClass: true,  lateCutoff: VWAP_RECLAIM_LATE_CUTOFF_IST_MIN },
    { name: "volume_breakout",    fn: detectVolumeBreakout,    trendClass: true  },
    { name: "ema_pullback",       fn: detectEmaPullback,       trendClass: true  },
    { name: "mean_reversion",     fn: detectMeanReversion,     trendClass: false },
  ];
  const highConviction: Detected[] = [];
  const suppressed: string[] = [];
  if (!isMarketOpen) {
    suppressed.push(`market_closed: ${marketStatus} (high-conviction setups gated to 09:15–15:30 IST)`);
  } else if (!ctx.fullIndicators) {
    suppressed.push("partial_indicators: not enough bars for full EMA21/RSI14/ATR14 — baseline only");
  } else {
    if (ctx.volRegime === "EXTREME") {
      suppressed.push(`vol_regime: EXTREME (realized vol ${ctx.realizedVol14?.toFixed(1)}%) — confidence haircut -8 applied to all setups`);
    } else if (ctx.volRegime === "HIGH") {
      suppressed.push(`vol_regime: HIGH (realized vol ${ctx.realizedVol14?.toFixed(1)}%) — confidence haircut -4 applied`);
    }
    // BUG-80 EXPIRY_DAY special mode. On the index's own expiry day,
    // pin/unwind dynamics dominate — directional trend setups behave
    // erratically and empirically underperform. Restrict to
    // MEAN_REVERSION only (mean-fade of the pinning move remains the
    // one setup class that empirically works on expiry). Sizing is
    // halved (paperAccount.REGIME_SIZING.EXPIRY_DAY_MULT) and every
    // open position is force-closed at 14:30 IST (see trigger sweep)
    // to avoid gamma explosion in the last hour.
    const inExpiryDayForDetectors = ctx.regime.regime === "EXPIRY_DAY";
    for (const det of detectors) {
      if (inExpiryDayForDetectors && det.trendClass) {
        suppressed.push(`${det.name}: expiry-day gate (BUG-80: MEAN_REVERSION only on expiry — pin/unwind dynamics dominate)`);
        continue;
      }
      // Phase-2 opening-noise gate (trend-class only, before 09:30 IST).
      if (det.trendClass && !openingAllowed) {
        suppressed.push(`${det.name}: opening-noise gate (before 09:30 IST — first 15min order-flow chaos)`);
        continue;
      }
      if (det.trendClass && !trendEntryAllowed) {
        suppressed.push(`${det.name}: late-session entry gate (after 14:30 IST — insufficient runway for trend target)`);
        continue;
      }
      // Per-detector late cutoff: VWAP_RECLAIM gates earlier than the
      // generic trend window because its target is a pivot move that
      // historically takes >2 hours to materialise.
      if (det.name === "vwap_reclaim" && !vwapReclaimAllowed) {
        suppressed.push(`${det.name}: late-session VWAP-reclaim gate (after 13:30 IST — reclaim setup needs 2+ hours of runway)`);
        continue;
      }
      try {
        const r = det.fn(ctx);
        if (!r) {
          suppressed.push(`${det.name}: conditions not met`);
          continue;
        }
        // Bias-flip cooldown: if this index just stopped on the OPPOSITE
        // direction within BIAS_FLIP_COOLDOWN_MIN, suppress the new
        // signal. Stops the empirical "stop on PUT then immediately fire
        // CALL" whipsaw that produced multiple back-to-back losses in
        // the sample.
        if (gateCtx) {
          const flip = isBiasFlipSuppressed(gateCtx, cfg.symbol, r.direction);
          if (flip.suppressed) {
            suppressed.push(`${det.name}: ${flip.reason}`);
            continue;
          }
        }
        if (ctx.volRegime === "EXTREME") {
          r.confidence -= 8;
          r.drivers.push({ label: "VOL_REGIME", weight: -8, bullish: false, detail: `Extreme realized vol (${ctx.realizedVol14?.toFixed(1)}%) — reduced confidence, wider expected ranges` });
        } else if (ctx.volRegime === "HIGH") {
          r.confidence -= 4;
          r.drivers.push({ label: "VOL_REGIME", weight: -4, bullish: false, detail: `High realized vol (${ctx.realizedVol14?.toFixed(1)}%) — mild confidence haircut` });
        }
        // ── Phase-3 CONFLUENCE ENGINE (replaces 2026-05-06) ─────────────
        // The detector returns a raw "edge" reading; we now combine it
        // with the trader's full confluence stack (EMA 9/20/50 alignment,
        // VWAP relation, intraday Volume Profile zone, regime, IV Rank)
        // into a unified score. ivRank is null at emission time — the
        // bundle enricher attaches it later for the UI display, but the
        // engine treats null as a no-op factor (weight 0). Pre-Phase-3
        // emission policy is preserved verbatim in
        // optionSignals.legacyEmit.bak.ts for rollback reference.
        const confluenceInputs: ConfluenceInputs = {
          direction: r.direction,
          setupTrendClass: det.trendClass,
          spot: ctx.spot,
          ema9: ctx.ema9,
          ema20: ctx.ema20,
          ema50: ctx.ema50,
          vwap: ctx.vwap,
          vwapAvailable: ctx.vwapAvailable,
          vp: ctx.vpIntraday,
          regime: ctx.regime.regime,
          ivRank: null,
          rawConfidence: r.confidence,
        };
        const confluence = scoreConfluence(confluenceInputs);
        r.confidence = confluence.adjustedConfidence;
        for (const f of confluence.factors) {
          if (f.weight === 0 || f.polarity === "neutral") continue;
          // Map confluence polarity → SignalReason.bullish (chip colour).
          //   supports → agrees with the trade direction (green for BULL,
          //              red for BEAR — NOT the same as "bullish=true")
          //   opposes  → disagrees with the trade direction
          //   risk     → direction-agnostic warning, always rendered as
          //              a negative chip regardless of trade direction
          //              (fixes pre-fix bug where -5 RISK on a BEARISH
          //              signal showed as bullish=true / green)
          let bullish: boolean;
          if (f.polarity === "risk") {
            bullish = false;
          } else if (f.polarity === "supports") {
            bullish = r.direction === "BULLISH";
          } else {
            bullish = r.direction !== "BULLISH";
          }
          r.drivers.push({
            label: f.label,
            weight: f.weight,
            bullish,
            detail: f.detail,
          });
        }
        // Stash the confluence score on the detected setup so toSignal
        // can surface it on the card (read by exposing as a top-level
        // OptionSignal field below). Using a dedicated property keeps the
        // detector's raw confidence accessible separately if ever needed.
        (r as Detected & { confluenceScore?: number }).confluenceScore = confluence.confluenceScore;
        // Phase-2 HC emission floor — applied AFTER vol-regime haircut so
        // it acts on the final shipped confidence. Demoted setups don't
        // appear in the HC pool; baseline outlook still carries the read.
        if (r.confidence < HC_EMISSION_FLOOR) {
          suppressed.push(`${det.name}: confidence ${r.confidence} < HC emission floor ${HC_EMISSION_FLOOR} — demoted (baseline still carries the read)`);
          continue;
        }
        // FIRST translate the plan inward when the structural trigger is
        // unreachable (e.g. prevSwingHigh is 2% above spot — the trigger
        // never fires before close). This preserves entry→stop and
        // entry→T1 distances so RR is unchanged; only the absolute price
        // levels shift. THEN clamp widths to an intraday-realistic
        // envelope and reject if the post-clamp RR no longer justifies
        // the premium decay. Mean Reversion is exempt from both.
        const realistic = applyTriggerRealism(r, ctx);
        const clamped = clampPlanForIntraday(realistic, ctx);
        if (!clamped) {
          suppressed.push(`${det.name}: post-clamp RR < ${MIN_RR_FOR_HC} — plan rejected as not worth premium decay`);
          continue;
        }
        highConviction.push(clamped);
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

  // Apply the same intraday stop/target clamp to the baseline so its
  // option-premium stop loss stays within a realistic intraday envelope.
  // Use a softer RR gate (1.0 instead of 1.4) since baseline is lower
  // conviction by design — we still want the directional read, just with
  // a tighter stop that won't burn 50%+ of the option premium.
  const MIN_RR_FOR_BASELINE = 1.0;
  if (baseline) {
    const realisticBL = applyTriggerRealism(baseline, ctx);
    const clampedBL = clampPlanForIntraday(realisticBL, ctx, MIN_RR_FOR_BASELINE);
    baseline = clampedBL ?? realisticBL;
  }

  // Pass-2B signal-accuracy gates: tag each HC candidate with reasons
  // it should NOT be granted headline status, even if its confidence
  // cleared the HC floor. Each gate is independent and additive — a
  // setup can have multiple. All flagged setups still ship (so the
  // diagnostic is visible) but as BASELINE-tier with audit tags.
  //
  //   (B) HTF gate           — daily HTF bias (spot vs EMA50, computed
  //                            in buildContext) opposes setup direction.
  //                            Same source as the existing HTF_CONFLICT
  //                            tag — promoting it from "tag-only" to
  //                            "tag + tier-demote".
  //   (C) Time-of-day filter — first 15 min (opening noise) or last 15
  //                            min (closing-auction whipsaw)
  //   (F) Event-day filter   — regime classifier flagged today as
  //                            EXPIRY_DAY (high pin/unwind risk)
  //
  // Computed once per emission tick (noiseWindow + inExpiryDay) and
  // once per detector (htfConflict, dir-dependent).
  const istNowGate = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const istMinGate = istNowGate.getUTCHours() * 60 + istNowGate.getUTCMinutes();
  const noiseWindow: "OPENING" | "CLOSING" | undefined =
    istMinGate >= 9 * 60 + 15 && istMinGate < 9 * 60 + 30
      ? "OPENING"
      : istMinGate >= 15 * 60 + 15 && istMinGate < 15 * 60 + 30
        ? "CLOSING"
        : undefined;
  const inExpiryDay = ctx.regime.regime === "EXPIRY_DAY";
  // Pass-3 (D): pull NIFTY 5d benchmark once and skip the RS check on
  // NIFTY itself (it's the benchmark — comparing against itself would
  // always read flat).
  const niftyRet = gateCtx?.nifty5dReturn ?? null;
  const idxRet = ctx.index5dReturn;
  const isNiftyBenchmark = cfg.symbol === "NIFTY";
  const winRates = gateCtx?.setupWinRates;
  // 2026-06-09 hygiene vetoes (flag: FNO_SIGNAL_HYGIENE_V2). Computed once
  // per emission tick from the live tape. `recovery` demotes a fresh
  // BEARISH (PUT) into an intraday V-recovery; `chase` demotes a fresh
  // BULLISH (CALL) chased at the top of a vertical run. Both DEMOTE to
  // INFO_ONLY — see optionSignalVetoes.ts. Requires full indicators so
  // warm-up bars never trip a veto on degraded data.
  const hygieneOn = isSignalHygieneV2Enabled();
  const veto =
    hygieneOn && ctx.fullIndicators
      ? evaluateDirectionalVetoes({
          spot: ctx.spot,
          vwap: ctx.vwap,
          ema9: ctx.ema9,
          atr15: ctx.atr15,
          rsi14: ctx.rsi14,
          highs: ctx.bars.h,
          lows: ctx.bars.l,
          closes: ctx.bars.c,
          rsiSeries: ctx.rsiSeries,
        })
      : { recovery: false, chase: false };
  for (const d of highConviction) {
    // Pass-2B (B): daily-EMA50 HTF
    const htfConflict =
      (d.direction === "BULLISH" && ctx.htfBias === "BEARISH") ||
      (d.direction === "BEARISH" && ctx.htfBias === "BULLISH");
    if (htfConflict) d.htfConflictGate = true;
    if (noiseWindow) d.noiseWindow = noiseWindow;
    if (inExpiryDay) d.inExpiryDay = true;

    // Pass-3 (A): TRUE 1h HTF bias from aggregated 60m candles. Demote
    // when 1h opposes direction — independent of daily-EMA50 (B). A
    // setup can fail just one or both; either alone is enough to demote.
    const htf1hConflict =
      (d.direction === "BULLISH" && ctx.htf1hBias === "BEARISH") ||
      (d.direction === "BEARISH" && ctx.htf1hBias === "BULLISH");
    if (htf1hConflict) d.htf1hConflictGate = true;

    // Pass-3 (D): sector relative strength vs NIFTY. Skip when:
    //   (1) this IS NIFTY (it's the benchmark)
    //   (2) NIFTY benchmark or this index's return is null (load failed
    //       or daily series too short — gate becomes a no-op)
    if (!isNiftyBenchmark && niftyRet != null && idxRet != null) {
      const tol = RELATIVE_STRENGTH.TOLERANCE_PCT;
      const lagging = idxRet < niftyRet - tol;
      const leading = idxRet > niftyRet + tol;
      if (
        (d.direction === "BULLISH" && lagging) ||
        (d.direction === "BEARISH" && leading)
      ) {
        d.rsConflictGate = true;
      }
    }

    // Pass-3 (E): rolling 30d win-rate calibration. Sample guard
    // (>= MIN_SAMPLE) prevents demoting brand-new setups before they've
    // had a fair chance — they get the benefit of the doubt until
    // enough data accumulates.
    const wr = winRates && d.setupKey ? winRates.get(d.setupKey) : undefined;
    if (
      wr &&
      wr.total >= WIN_RATE_CALIBRATION.MIN_SAMPLE &&
      wr.winRate < WIN_RATE_CALIBRATION.MIN_WIN_RATE
    ) {
      d.lowWinRateGate = true;
    }

    // 2026-06-09 hygiene vetoes — direction-scoped demote to INFO_ONLY.
    if (veto.recovery && d.direction === "BEARISH") d.recoveryVetoGate = true;
    if (veto.chase && d.direction === "BULLISH") d.chaseVetoGate = true;
  }

  // Sort high-conviction by confidence; keep top 3. Then append the baseline.
  // Pass-2A + Pass-2B: setups with ANY demote flag (vol-clamped, HTF
  // conflict, in-noise window, expiry-day) must NEVER occupy a top-3 HC
  // slot — that would let e.g. a clamped 80-conf setup displace a clean
  // 75-conf one. Partition first, fill the top-3 from clean HC
  // candidates only, then append demoted setups as BASELINE-tier extras
  // (with audit tags already added in toSignal). Hard-reject for
  // extreme vol breaches already happened inside clampPlanForIntraday
  // (returned null), so anything reaching here is safe to route via the
  // conservative paper-trader lane.
  highConviction.sort((a, b) => b.confidence - a.confidence);
  const isDemoted = (d: Detected): boolean =>
    !!(
      d.volClamped ||
      d.htfConflictGate ||
      d.noiseWindow ||
      d.inExpiryDay ||
      // Pass-3 additions — same partition rule as Pass-2A/2B.
      d.htf1hConflictGate ||
      d.rsConflictGate ||
      d.lowWinRateGate ||
      // 2026-06-09 hygiene vetoes — same demote-only partition rule.
      d.recoveryVetoGate ||
      d.chaseVetoGate
    );
  const cleanHc = highConviction.filter((d) => !isDemoted(d));
  const demotedHc = highConviction.filter(isDemoted);
  const out: OptionSignal[] = [];
  for (const d of cleanHc.slice(0, 3)) {
    const s = toSignal(ctx, d, "HIGH_CONVICTION");
    // F-27: direction-independent per-detector/per-index cooldown (30 min).
    // Key = "index::setupKey" — opposite direction re-fires are also blocked
    // within the window to prevent flip-flopping on the same setup.
    if (isDetectorOnCooldown(s)) {
      logger.debug(
        { index: s.index, setupKey: s.setupKey, tier: "HIGH_CONVICTION" },
        "Detector cooldown: HC signal suppressed",
      );
    } else {
      recordDetectorEmit(s);
      out.push(applyLock(s));
    }
  }
  for (const d of demotedHc) {
    const s = toSignal(ctx, d, "BASELINE");
    if (isDetectorOnCooldown(s)) {
      logger.debug(
        { index: s.index, setupKey: s.setupKey, tier: "BASELINE/demotedHC" },
        "Detector cooldown: demoted HC signal suppressed",
      );
    } else {
      recordDetectorEmit(s);
      out.push(applyLock(s));
    }
  }
  if (baseline) {
    // Surface the veto reason on the baseline card too (it is already
    // INFO_ONLY, so this is audit-visibility only — no behaviour change).
    if (veto.recovery && baseline.direction === "BEARISH") baseline.recoveryVetoGate = true;
    if (veto.chase && baseline.direction === "BULLISH") baseline.chaseVetoGate = true;
    const s = toSignal(ctx, baseline, "BASELINE");
    if (isDetectorOnCooldown(s)) {
      logger.debug(
        { index: s.index, setupKey: s.setupKey, tier: "BASELINE" },
        "Detector cooldown: baseline signal suppressed",
      );
    } else {
      recordDetectorEmit(s);
      out.push(applyLock(s));
    }
  }
  return { signals: out, suppressed, hasBars: true, snapshot: snapshotFromCtx(ctx) };
}

/**
 * Snapshot fed to lifecycle for trigger / SL / target evaluation.
 *
 * Spot is ALWAYS emitted (we have it from the live tick / chart meta).
 * Bar high/low are emitted ONLY when Yahoo has published a real extreme
 * for the latest 15-min bar. If they're missing (e.g. brand-new bar that
 * just opened), the lifecycle's evaluateTransition / bestExcursions
 * fall back to spot — which is the SAFE, honest default (no fabricated
 * wick can mark a stop or target as hit, but a real spot crossing of the
 * entry level still fires the trigger).
 *
 * IMPORTANT: this MUST always return a snapshot. Returning undefined
 * caused getOptionSignals to skip the entire index's lifecycle update,
 * which left every PENDING plan stuck at "Waiting trigger" even when the
 * market crossed the level (the bug paid users reported).
 */
function snapshotFromCtx(ctx: Ctx): SpotSnapshot {
  const h = ctx.bars.h.at(-1);
  const l = ctx.bars.l.at(-1);
  return {
    spot: ctx.spot,
    high: h ?? undefined,
    low: l ?? undefined,
  };
}

export interface OptionSignalsResult {
  signals: OptionSignal[];
  diagnostics: {
    indicesConfigured: number;
    indicesWithBars: number;
    highConvictionCount: number;
    baselineCount: number;
    suppressed: { index: string; reasons: string[] }[];
    /**
     * Phase-1 quality-gate state. Surfaced to the UI so the user can
     * see *why* the live signals tab is empty (or thinned out) on a
     * given session — circuit breaker after consecutive stops, VIX
     * shock, correlated exposure dedupe, etc. Without this the UI
     * would just show fewer cards with no honest explanation.
     */
    gates: {
      circuitBreakerActive: boolean;
      stoppedToday: number;
      /** Real executed paper-trade stops today (drives the breaker when hygiene v2 on). */
      paperStoppedToday: number;
      /** Modeled signal-history stops today — diagnostic only, never gates. */
      modeledStoppedToday: number;
      stopLimit: number;
      vixSpike: boolean;
      vixIntradayPct: number | null;
      vixDayPct: number | null;
      vixSpikeReason: string | null;
      correlationDroppedCount: number;
      oiVetoCount: number;
      staleExpiredCount: number;
      notes: string[];
    };
  };
}
interface CachedSignals { ts: number; data: OptionSignalsResult; }
let cache: CachedSignals | null = null;
const TTL = 30 * 1000;

/** Metadata stamped after each completed F&O signal cycle (never reset between TTL refreshes). */
interface FnoCycleMeta {
  ts: number;
  indicesWithBars: number;
  suppressed: { index: string; reasons: string[] }[];
  suppressedSummary: string;
  signalCount: number;
  highConvictionCount: number;
  baselineCount: number;
}
let lastCycleMeta: FnoCycleMeta | null = null;

/**
 * FNO_DATA_RECOVERED degrade/recover tracking now lives in the DB-backed
 * system_alert_state table (family "fno_data") via transitionSystemAlertState
 * — see systemAlertDedup.ts. This replaces a process-local boolean that reset
 * on autoscale cold starts / multi-replica deploys, which could either miss
 * the recovery alert (new process never saw the "was suppressed" flag) or
 * double-send it (two replicas both flip false->true independently). The
 * CAS transition + alert itself lives in fnoDataRecoveryTransition.ts so it
 * is unit-testable without this module's heavy dependency chain.
 */

/**
 * Returns the metadata from the most recent completed F&O signal cycle,
 * or null if no cycle has run yet. Safe to call at any time — never triggers
 * a new cycle. Consumed by /fno/data-health for intraday bar readiness.
 */
export function getLastFnoCycleState(): FnoCycleMeta | null {
  return lastCycleMeta;
}

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

// ─── Detector cooldown map (F-27) ──────────────────────────────────────────
// Prevents the same (setupKey, index, direction) detector setup from being
// re-emitted within DETECTOR_COOLDOWN_MS after a prior emit.  Avoids
// spamming the signal list and the paper-trader lifecycle with duplicate
// entries on rapid consecutive sweeps.  Key = "setupKey|index|direction";
// value = Date.now() at last emit.
const DETECTOR_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const detectorCooldownMap: Map<string, number> = new Map();

// Key = "index::setupKey" — direction is intentionally excluded so that a
// detector that fires BULLISH cannot immediately re-fire BEARISH on the same
// index within the cooldown window.  Both directions share the same slot.
function cooldownKey(setupKey: string, index: string): string {
  return `${index}::${setupKey}`;
}

function isDetectorOnCooldown(s: { setupKey?: string | null; index: string }): boolean {
  const k = cooldownKey(s.setupKey ?? "default", s.index);
  const last = detectorCooldownMap.get(k);
  return last !== undefined && Date.now() - last < DETECTOR_COOLDOWN_MS;
}

function recordDetectorEmit(s: { setupKey?: string | null; index: string }): void {
  const k = cooldownKey(s.setupKey ?? "default", s.index);
  detectorCooldownMap.set(k, Date.now());
}

// F-32: once-per-day blackout warning set — prevents log spam on every sweep
// while ensuring the operator sees at least one warning per blackout day.
const blackoutWarnedDates = new Set<string>();

// ─── Test helpers (never called in production paths) ─────────────────────
/** Returns the detector cooldown duration in milliseconds (for tests). */
export function _getDetectorCooldownMs(): number {
  return DETECTOR_COOLDOWN_MS;
}
/** Clears the detector cooldown map — call in afterEach in tests. */
export function _resetDetectorCooldownForTest(): void {
  detectorCooldownMap.clear();
}
/** Seeds a specific cooldown entry with an explicit timestamp — for time-travel tests. */
export function _setCooldownForTest(key: string, ts: number): void {
  detectorCooldownMap.set(key, ts);
}
/** Checks whether (index, setupKey) is on cooldown — direction-independent. */
export function _isDetectorOnCooldownForTest(setupKey: string, index: string): boolean {
  return isDetectorOnCooldown({ setupKey, index });
}
/** Records a detector emit for (index, setupKey) — direction-independent. */
export function _recordDetectorEmitForTest(setupKey: string, index: string): void {
  recordDetectorEmit({ setupKey, index });
}

// ─── Server-side trigger evaluator ───────────────────────────────────────
//
// The lifecycle pipeline is otherwise demand-driven: a plan is only
// re-evaluated when /api/options/signals is called, which only happens
// when a user has the page open. If nobody is looking at the page during
// the 09:15–15:30 IST session, plans stay PENDING even when spot crosses
// the trigger.
//
// This interval calls getOptionSignals() once a minute during regular
// market hours so the lifecycle keeps advancing whether or not anyone is
// watching. Errors are swallowed (best-effort heartbeat — the next tick
// will retry), and the call is a no-op outside market hours so it costs
// effectively nothing on weekends / overnight.
let triggerSweepRunning = false;
// 30s (was 60s). Halving the sweep interval cuts the failure window for
// the "MISSED_WINDOW" anti-phantom race in half — a setup that triggers
// AND hits T1/T2/SL between two consecutive sweeps used to be silently
// dropped (signal observed for the first time already in terminal state →
// no paper trade opened, only a missed-signal log row). With a 30s
// cadence, the engine still cannot prevent a within-30s round trip, but
// the median catchable trade is now twice as fast. Kite's per-second cap
// is comfortably under the load of one F&O option-chain pass per index
// per 30s, so this is safe.
const TRIGGER_SWEEP_INTERVAL_MS = 30 * 1000;

// Pass-1 15:20 IST force-exit latch. We piggy-back on the existing
// 30s sweep instead of standing up a dedicated interval — cheaper and
// guarantees ordering with the rest of the lifecycle pipeline.
//
// The latch is set ONLY AFTER a successful force-close call. If the
// import or the close fails (transient DB/network), the next 30s tick
// retries — burning the latch up-front would drop the safety net for
// the rest of the day on a single transient blip.
let lastForceExit1520Date: string | null = null;
// BUG-80 companion latch: EXPIRY_DAY 14:30 IST early force-exit for
// positions on indices expiring today. Separate latch (independent
// idempotency from the global 15:20 sweep — an expiry-day session runs
// BOTH: 14:30 closes only expiring-index rows, 15:20 closes anything
// still open on non-expiring indices).
let lastForceExit1430ExpiryDate: string | null = null;

setInterval(() => {
  if (triggerSweepRunning) return; // skip if previous tick still in flight
  if (computeMarketStatus(new Date()) !== "open") return;
  triggerSweepRunning = true;

  void (async () => {
    try {
      // 1) Run the lifecycle pass FIRST. If a position was about to be
      //    STOPPED / TARGET-hit on this tick anyway, it should record the
      //    natural exit reason (and the natural settlement premium) —
      //    not get overwritten as TIME_EXIT_1520.
      await getOptionSignals();

      // 2) Then force-close any rows that survived the lifecycle pass.
      //    Latch advances only on success so a transient failure retries
      //    on the next 30s tick.
      const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
      const istDay = ist.toISOString().slice(0, 10);
      const istMin = ist.getUTCHours() * 60 + ist.getUTCMinutes();

      // 2a) BUG-80 — 14:30 IST EXPIRY_DAY early force-exit. Runs BEFORE
      //     the 15:20 branch; only touches rows on indices expiring today.
      //     Non-expiring rows continue to ride to the 15:20 latch below.
      if (istMin >= 14 * 60 + 30 && lastForceExit1430ExpiryDate !== istDay) {
        try {
          const expiring = indexesExpiringTodayIst(new Date());
          if (expiring.length > 0) {
            const { forceCloseAllOpenFnoFor1430Expiry } = await import(
              "./paperTradingFO"
            );
            await forceCloseAllOpenFnoFor1430Expiry(expiring);
          }
          lastForceExit1430ExpiryDate = istDay;
        } catch (err) {
          logger.warn(
            { err: (err as Error).message },
            "Paper FO 14:30 EXPIRY force-exit threw — will retry next tick",
          );
        }
      }

      if (istMin >= 15 * 60 + 20 && lastForceExit1520Date !== istDay) {
        try {
          const { forceCloseAllOpenFnoFor1520 } = await import("./paperTradingFO");
          await forceCloseAllOpenFnoFor1520();
          lastForceExit1520Date = istDay; // only burn the latch on success
        } catch (err) {
          logger.warn(
            { err: (err as Error).message },
            "Paper FO 15:20 force-exit threw — will retry next tick",
          );
        }
      }

      // (EOD daily-summary persistence runs on its OWN 60s interval
      //  inside paperDailySummaryFo.ts — it cannot live here because
      //  this sweep short-circuits when computeMarketStatus !== "open"
      //  and that closes at 15:30 IST, before the 15:35 EOD target.)
    } catch (err) {
      logger.warn(
        { err: (err as Error).message },
        "trigger sweep getOptionSignals failed",
      );
    } finally {
      triggerSweepRunning = false;
    }
  })();
}, TRIGGER_SWEEP_INTERVAL_MS).unref?.();

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
        // Premium provenance gate (owner policy 2026-06-10): the option
        // premium/OI that drives optionEntry/optionStopLoss/optionTarget* — and
        // therefore the paper trade and its risk — may ONLY come from a
        // complete, non-stale, non-expired Kite chain. NSE-direct / Yahoo /
        // unknown / missing premium is a fallback: stamp it honestly, demote
        // the signal to INFO_ONLY (so the auto-trader never opens it), and
        // DO NOT project stop/target levels from untrusted premium.
        const prov = buildOptionChainProvenance(chain, {
          missingReason: `No option chain for ${first.index} ${expiry}.`,
        });
        const verdict = premiumTrustVerdict(prov);
        for (const s of b.signals) {
          s.premiumSource = prov.sourceProvider;
          s.premiumTrusted = prov.trustedForSignals;
          if (!prov.trustedForSignals) {
            s.premiumWarning = verdict.reason ?? "Option premium not Kite-trusted.";
            s.tradeClass = "INFO_ONLY";
            if (!s.tags) s.tags = [];
            if (!s.tags.includes("PREMIUM_UNTRUSTED")) s.tags.push("PREMIUM_UNTRUSTED");
          }
        }
        if (!chain || !prov.trustedForSignals) return;
        const row: OcRow | undefined = chain.rows.find((r) => r.strike === first.leg.strike);
        if (!row) return;
        // Spot must be a real, finite number for the projection to mean
        // anything; if upstream pushed NaN/Inf, skip enrichment for the
        // whole bundle rather than emit garbage downstream.
        if (!Number.isFinite(chain.spot)) {
          logger.warn(
            { idx: first.index, expiry, spot: chain.spot },
            "Option-level enrichment skipped: chain.spot is not finite",
          );
          return;
        }
        const spotNow = chain.spot;
        for (const s of b.signals) {
          const side: OcSide | undefined = s.leg.type === "CALL" ? row.ce : row.pe;
          // Need at least an option LTP — without it we have no premium
          // anchor at all. (Strike is ATM by construction; see toSignal()
          // → nearestStrike(spot, step), so ltp here is the at-the-money
          // option's last traded premium.) Reject non-finite values so
          // a NaN/Inf from upstream never silently propagates into
          // paper trades as an "invalid premium plan" much later.
          // Per-leg trust (owner policy 2026-06-10): even on a Kite-trusted
          // chain, the SPECIFIC leg this signal trades must have a real
          // premium anchor AND open interest. A missing/non-positive LTP
          // means no premium to plan from; missing/zero OI on the traded
          // strike means the premium/OI is untrustworthy for THIS signal.
          // Either case DEMOTES the signal (premiumTrusted=false for this
          // signal → fail-closed at the paper-open backstop, INFO_ONLY for
          // UI honesty) and skips level projection so no untrusted premium
          // sets optionEntry/SL/targets. This is in addition to the open
          // path's FNO_LIQUIDITY gate (OI≥50k), giving belt-and-braces.
          const legOiMissing =
            !side || side.oi == null || !Number.isFinite(side.oi) || side.oi <= 0;
          const legLtpMissing =
            !side || side.ltp == null || !Number.isFinite(side.ltp) || side.ltp <= 0;
          if (legLtpMissing || legOiMissing) {
            const legReason = !side
              ? "no_side"
              : legLtpMissing
                ? side.ltp == null
                  ? "ltp_null"
                  : "ltp_non_finite_or_le_zero"
                : "leg_oi_missing";
            s.premiumTrusted = false;
            s.premiumWarning =
              legReason === "leg_oi_missing"
                ? "Traded leg has no open interest — premium/OI untrusted for this signal."
                : "Traded leg has no usable premium (LTP) — untrusted for this signal.";
            s.tradeClass = "INFO_ONLY";
            if (!s.tags) s.tags = [];
            if (!s.tags.includes("PREMIUM_UNTRUSTED")) s.tags.push("PREMIUM_UNTRUSTED");
            logger.info(
              {
                idx: s.index,
                strike: s.leg.strike,
                type: s.leg.type,
                ltp: side?.ltp ?? null,
                oi: side?.oi ?? null,
                reason: legReason,
              },
              "Option-level enrichment skipped + signal demoted (untrusted leg premium/OI)",
            );
            continue;
          }
          // After the guard above, side is present and side.ltp is a finite
          // positive number; this redundant narrowing keeps the compiler's
          // control-flow analysis honest (the compound-boolean guard cannot
          // narrow `side.ltp` to `number` on its own).
          if (!side || side.ltp == null || !Number.isFinite(side.ltp)) continue;
          const ltp = side.ltp;
          // Always publish the LTP first so the lifecycle row gets a
          // premium reference even if downstream Greeks-based projection
          // falls back below.
          s.optionLtp = round2(ltp);

          // Delta sourcing.
          // Primary: broker-supplied delta (Black-Scholes from chain IV),
          // but only when finite — a NaN/Inf delta would propagate into
          // the projection and produce NaN levels that would later be
          // rejected with no actionable log.
          // Fallback: when IV is missing/zero (or returns non-finite)
          // the chain effectively has no greeks. Because the bundle
          // strike is the ATM strike by construction (toSignal →
          // nearestStrike), the analytical ATM delta is ±0.5 by
          // definition (call: +0.5, put: −0.5) — this is NOT a
          // synthetic guess, it is the closed-form Black-Scholes value
          // for K=S in the limit of small T·σ. Using it lets the paper
          // book take the trade instead of silently dropping it just
          // because the broker chain payload is missing greeks.
          let delta: number;
          let deltaIsFallback = false;
          if (side.delta != null && Number.isFinite(side.delta)) {
            delta = side.delta;
          } else {
            delta = s.leg.type === "CALL" ? 0.5 : -0.5;
            deltaIsFallback = true;
            logger.info(
              {
                idx: s.index,
                strike: s.leg.strike,
                type: s.leg.type,
                ltp,
                source: "atm_closed_form_fallback",
              },
              "Option delta missing/non-finite on chain — using ATM closed-form delta (±0.5) so trade is not silently dropped",
            );
          }

          // Ground projection in current spot, not signal-time spot, so the
          // displayed entry adapts as price moves toward the trigger.
          // (spotNow validated as finite once per bundle above.)
          const optionEntry = Math.max(0.05, projectOptionLevel(ltp, delta, spotNow, s.leg.entry));
          const optionT1 = Math.max(0.05, projectOptionLevel(optionEntry, delta, s.leg.entry, s.leg.target1));
          const optionT2 = s.leg.target2 != null
            ? Math.max(0.05, projectOptionLevel(optionEntry, delta, s.leg.entry, s.leg.target2))
            : undefined;
          let optionSL = Math.max(0.05, projectOptionLevel(optionEntry, delta, s.leg.entry, s.leg.stopLoss));

          const MAX_PREMIUM_LOSS_PCT = 0.30;
          const minSL = optionEntry * (1 - MAX_PREMIUM_LOSS_PCT);
          if (optionSL < minSL) {
            logger.info(
              {
                idx: s.index,
                setup: s.setupKey,
                rawSL: round2(optionSL),
                cappedSL: round2(minSL),
                entry: round2(optionEntry),
                maxLossPct: MAX_PREMIUM_LOSS_PCT * 100,
              },
              "Option premium SL tightened: raw SL would exceed max premium loss cap",
            );
            optionSL = minSL;
          }

          s.optionEntry = round2(optionEntry);
          s.optionTarget1 = round2(optionT1);
          s.optionTarget2 = optionT2 != null ? round2(optionT2) : undefined;
          s.optionStopLoss = round2(optionSL);
          // Only publish optionDelta when it came from the chain (real
          // greeks). When we used the ATM fallback we leave it unset so
          // the UI does not falsely advertise a Black-Scholes delta we
          // did not actually compute from market IV.
          if (!deltaIsFallback) s.optionDelta = +delta.toFixed(4);
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

/**
 * Pass-3 (G): map a CE leg's `ceBuildup` tag to a directional vote
 * for the underlying. CE LONG_BUILDUP = call buyers piling on (BULLISH);
 * CE SHORT_BUILDUP = call writers planting resistance (BEARISH);
 * CE SHORT_COVERING = call writers giving up (BULLISH for spot);
 * CE LONG_UNWINDING = call buyers losing conviction (BEARISH for spot).
 */
function ceBuildupVote(b: OiStrikeRow["ceBuildup"]): -1 | 0 | 1 {
  if (b === "LONG_BUILDUP" || b === "SHORT_COVERING") return 1;
  if (b === "SHORT_BUILDUP" || b === "LONG_UNWINDING") return -1;
  return 0;
}

/**
 * Pass-3 (G): map a PE leg's `peBuildup` tag to a directional vote
 * for the underlying. PE SHORT_BUILDUP = put writers selling puts
 * (BULLISH — they don't think the floor breaks);
 * PE LONG_BUILDUP = put buyers piling on (BEARISH);
 * PE LONG_UNWINDING = put buyers losing conviction (BULLISH for spot);
 * PE SHORT_COVERING = put writers covering (BEARISH for spot).
 */
function peBuildupVote(b: OiStrikeRow["peBuildup"]): -1 | 0 | 1 {
  if (b === "SHORT_BUILDUP" || b === "LONG_UNWINDING") return 1;
  if (b === "LONG_BUILDUP" || b === "SHORT_COVERING") return -1;
  return 0;
}

/**
 * Apply OI-derived alignment / conflict adjustments. Returns the set of
 * signals to DROP (hard veto) so the caller can filter them out before
 * they reach the lifecycle. Aligned signals are mutated in place with a
 * confidence bump and a tag; mild conflicts get a haircut + tag; HARD
 * conflicts (|sentimentScore| ≥ OI_VETO_THRESHOLD) are vetoed entirely
 * — this is the Phase-1 gate against trades that fight a well-formed
 * institutional positioning bias.
 *
 * Pass-3 (G) adds a *separate* ATM-strike-specific confluence check:
 * even when aggregate sentiment is neutral, if BOTH legs of the ATM
 * strike show buildup patterns that contradict the signal direction,
 * the HC tier is demoted to BASELINE with `OI_ATM_CONFLICT` tag. Catches
 * "the wider chain looks fine but the strike where the trade actually
 * lives is being defended by writers" — the most common failure mode
 * that aggregate PCR cannot see.
 */
async function applyOiConfirmation(
  signals: OptionSignal[],
): Promise<Set<OptionSignal>> {
  const vetoed = new Set<OptionSignal>();
  const byIndex = new Map<string, OptionSignal[]>();
  for (const s of signals) {
    if (s.tier === "BASELINE") continue;
    const list = byIndex.get(s.index) ?? [];
    list.push(s);
    byIndex.set(s.index, list);
  }
  if (byIndex.size === 0) return vetoed;

  const indexToYahoo: Record<string, string> = {};
  for (const cfg of OPTION_INDICES) indexToYahoo[cfg.symbol] = cfg.yahoo;

  await Promise.all(
    [...byIndex.entries()].map(async ([idx, sigs]) => {
      try {
        const yahoo = indexToYahoo[idx];
        if (!yahoo) return;
        const oi: OiInsightsResponse | null = await fetchOiInsights(idx);
        if (!oi) return;

        for (const s of sigs) {
          const isBullish = s.bias === "BULLISH";
          const oiBullish =
            oi.sentimentScore > 20 ||
            (oi.pcrOi > 1.2 && oi.intradayFlow > 0.2);
          const oiBearish =
            oi.sentimentScore < -20 ||
            (oi.pcrOi < 0.7 && oi.intradayFlow < -0.2);

          const oiAligned =
            (isBullish && oiBullish) || (!isBullish && oiBearish);
          const oiConflict =
            (isBullish && oiBearish) || (!isBullish && oiBullish);

          if (oiAligned) {
            s.confidence = Math.min(100, (s.confidence ?? 0) + 7);
            s.drivers = [
              ...(s.drivers ?? []),
              {
                label: "OI_CONFIRMATION",
                weight: 7,
                bullish: isBullish,
                detail: `OI supports ${s.bias} bias (PCR ${oi.pcrOi}, sentiment ${oi.sentimentScore > 0 ? "+" : ""}${oi.sentimentScore})`,
              },
            ];
            if (!s.tags?.includes("OI_CONFIRMED")) {
              s.tags = [...(s.tags ?? []), "OI_CONFIRMED"];
            }
          } else if (oiConflict) {
            // HARD VETO when the conflict is structurally large. The
            // empirical loss sample showed |sentimentScore|≥30 against
            // the trade direction was a near-certain expiration / stop.
            // A -5 confidence haircut was not enough to keep these out.
            if (Math.abs(oi.sentimentScore) >= OI_VETO_THRESHOLD) {
              vetoed.add(s);
              s.tags = [...(s.tags ?? []), "OI_VETO"];
              s.drivers = [
                ...(s.drivers ?? []),
                {
                  label: "OI_VETO",
                  weight: -100,
                  bullish: !isBullish,
                  detail: `OI hard-veto: sentiment ${oi.sentimentScore > 0 ? "+" : ""}${oi.sentimentScore} (|score|≥${OI_VETO_THRESHOLD}) opposes ${s.bias} bias — signal suppressed`,
                },
              ];
              continue;
            }
            s.confidence = Math.max(0, (s.confidence ?? 0) - 5);
            s.drivers = [
              ...(s.drivers ?? []),
              {
                label: "OI_CONFLICT",
                weight: -5,
                bullish: !isBullish,
                detail: `OI opposes ${s.bias} bias (PCR ${oi.pcrOi}, sentiment ${oi.sentimentScore > 0 ? "+" : ""}${oi.sentimentScore})`,
              },
            ];
            if (!s.tags?.includes("OI_CONFLICT")) {
              s.tags = [...(s.tags ?? []), "OI_CONFLICT"];
            }
          }

          // Pass-3 (G): ATM-strike OI confluence check. Independent of
          // the aggregate-sentiment branches above — runs even when
          // neither aligned nor conflict tripped. Demotes HC to BASELINE
          // when BOTH legs of the ATM strike vote against the signal
          // direction (atmVote == -2 for BULLISH or +2 for BEARISH).
          // Single-leg dissent is intentionally NOT enough — too many
          // false positives on intraday chop. Skip when the signal was
          // already vetoed above (continue at line ~1971), already
          // BASELINE (no demotion to do), or no ATM row available.
          if (vetoed.has(s) || s.tier !== "HIGH_CONVICTION") continue;
          const atmRow = oi.strikes.find((r) => r.isAtm);
          if (!atmRow) continue;
          const atmVote = ceBuildupVote(atmRow.ceBuildup) + peBuildupVote(atmRow.peBuildup);
          const atmConflict =
            (isBullish && atmVote <= -2) || (!isBullish && atmVote >= 2);
          if (atmConflict) {
            s.tier = "BASELINE";
            // Keep tradeClass consistent with the post-OI tier: a signal
            // demoted to BASELINE here must report INFO_ONLY (hygiene v2),
            // never a stale TRADEABLE.
            s.tradeClass = deriveTradeClass(s.tier, isSignalHygieneV2Enabled());
            if (!s.tags?.includes("OI_ATM_CONFLICT")) {
              s.tags = [...(s.tags ?? []), "OI_ATM_CONFLICT"];
            }
            if (!s.tags?.includes("BASELINE")) {
              s.tags = [...(s.tags ?? []), "BASELINE"];
            }
            s.drivers = [
              ...(s.drivers ?? []),
              {
                label: "OI_ATM_CONFLICT",
                weight: -10,
                bullish: !isBullish,
                detail: `ATM ${atmRow.strike} OI buildup opposes ${s.bias}: CE ${atmRow.ceBuildup}, PE ${atmRow.peBuildup} — demoted to BASELINE`,
              },
            ];
          }
        }
      } catch (err) {
        logger.info(
          { err: (err as Error).message, idx },
          "OI confirmation: skipped (data unavailable)",
        );
      }
    }),
  );
  return vetoed;
}

export async function getOptionSignals(): Promise<OptionSignalsResult> {
  if (cache && Date.now() - cache.ts < TTL) return cache.data;

  // F-32: once-per-day blackout observability.  Signal display is NOT
  // suppressed — the paper auto-open gate lives in openPaperTrade.  This
  // single warning per day lets operators correlate sweep timing with the
  // blackout calendar without flooding logs on every poll cycle.
  const todayIstWarn = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(new Date());
  if (!blackoutWarnedDates.has(todayIstWarn)) {
    const bk = isEventBlackoutDay(todayIstWarn);
    if (bk.blocked) {
      blackoutWarnedDates.add(todayIstWarn);
      logger.warn(
        { date: todayIstWarn, label: bk.label },
        "Signal sweep: blackout event day — signals shown but paper auto-opens are BLOCKED",
      );
    }
  }
  // F&O Exit Monitoring Reliability scheduler summary (T004, 2026-07-02):
  // one explicit accumulator PER `getOptionSignals()` invocation, never a
  // module-level singleton — this function is also invoked on-demand (no
  // in-flight dedup), so two concurrent cycles must never cross-attribute
  // counts into a shared mutable object (architect-reviewed). Threaded
  // through the cohort-loop's `recordLifecycle` calls below and into
  // `evaluateOrphanedOpenTrades`; finalized once at the very end of this
  // function into the process-local rolling health snapshot.
  const exitMonitorCycle: FnoExitMonitorCycleAccumulator = beginFnoExitMonitorCycle();
  const out: OptionSignal[] = [];
  const suppressed: { index: string; reasons: string[] }[] = [];
  let indicesWithBars = 0;
  let highConvictionCount = 0;
  let baselineCount = 0;

  // Sweep stale PENDING rows BEFORE loading gate context so the circuit
  // breaker / bias-flip queries see today's most up-to-date counts.
  // Idempotent and cheap when there are no stale rows.
  const staleExpiredCount = await expireStalePendingSignals(
    STALE_PENDING_MAX_MIN,
  ).catch(() => 0);

  // Load session-wide gate context once per cycle. All per-index
  // decisions made below see the same snapshot of consecutive losses,
  // recent stops, and India VIX.
  const gateCtx = await loadGateContext();

  // Per-index bundle so we can run lifecycle persistence with the right snapshot.
  interface IdxBundle { signals: OptionSignal[]; snapshot?: SpotSnapshot; }
  const bundles: IdxBundle[] = [];

  // Pre-fetch live Kite LTPs once per cycle. We use these to overlay
  // snapshot.spot for the lifecycle evaluator below, so triggers fire on
  // real-time ticks instead of the close of a (potentially 15-minute
  // delayed) Yahoo bar — that single change is what unblocks the "every
  // card stuck on Waiting trigger" bug.
  let liveQuotes: Awaited<ReturnType<typeof centralIndexQuotes>> = null;
  // Wall-clock fallback for a live tick's own `asOf` when the provider
  // doesn't stamp one — used ONLY as provenance for the exit-monitoring
  // trust gate below, never for signal emission itself.
  let quotesFetchedAtMs: number | null = null;
  try {
    const q = await centralIndexQuotes();
    if (q) {
      liveQuotes = q;
      quotesFetchedAtMs = Date.now();
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "live Kite quote fetch failed; using bar close as spot");
  }

  // For DAILY_HISTORY_WARMUP detection: check session freshness once per cycle.
  // When the session was established < 5 min ago, a null daily series is likely
  // a transient cold-start artifact (Kite's historical REST API warms up slightly
  // after login) rather than a hard failure. Classify separately so the UI shows
  // "warming up" instead of "error". Fail-open: if session age is unreadable,
  // sessionAgeMs stays null and we fall through to the normal error path.
  const SESSION_WARMUP_MS = 5 * 60 * 1000; // 5 minutes
  let sessionAgeMs: number | null = null;
  // Whether the Kite broker session is currently ACTIVE — feeds the
  // exit-monitoring trust gate's KITE_UNAVAILABLE check (fnoExitDecision.ts).
  // Defaults conservatively to false (fail-closed) if the status read fails.
  let kiteSessionActive = false;
  try {
    const sessionStatus = await getActiveSessionStatus();
    if (sessionStatus.session?.loginTime) {
      sessionAgeMs = Date.now() - new Date(sessionStatus.session.loginTime).getTime();
    }
    kiteSessionActive = sessionStatus.session != null;
  } catch {
    // fail-open for warmup classification, fail-CLOSED for exit trust gate
    // (kiteSessionActive stays false)
  }

  for (const cfg of OPTION_INDICES) {
    try {
      // STRICT KITE-ONLY for intraday F&O signal emission (2026-05-06).
      // Yahoo's 15-min delay produced phantom triggers, wrong entries,
      // and broker/signal mismatch that the user explicitly demanded
      // be eliminated. Skip emission when Kite intraday is unavailable
      // — the MissedSignals card surfaces every skip with a clear
      // reason so the audit trail is preserved. Daily history still
      // uses Yahoo (EOD bars, no live-data sensitivity).
      let intra: YahooChart | null = null;
      let intraSrc: "kite" | null = null;
      if (centralHasIndexCoverage(cfg.yahoo)) {
        intra = await centralIndexCandles(cfg.yahoo, "15minute", 5);
        if (intra) intraSrc = "kite";
      }
      if (!intra) {
        suppressed.push({
          index: cfg.symbol,
          reasons: [
            `no_live_kite_intraday (Kite session expired / throttled / index uncovered) — Yahoo fallback disabled to prevent stale-data signals`,
          ],
        });
        continue;
      }
      // KITE-ONLY daily history (2026-05-06): Yahoo is no longer permitted
      // anywhere in the F&O pipeline, EOD bars included. If Kite cannot
      // serve the daily series we skip the index entirely rather than
      // degrade — surfaced via MissedSignals so the audit trail is honest.
      const daily = await centralIndexCandles(cfg.yahoo, "day", 180);
      if (!daily) {
        // Distinguish between a fresh-session warmup (transient) and a hard
        // data failure. Intraday is already confirmed present above, so the
        // Kite session itself is valid — this is a historical-API warmup lag.
        const isWarmup = sessionAgeMs !== null && sessionAgeMs < SESSION_WARMUP_MS;
        suppressed.push({
          index: cfg.symbol,
          reasons: [
            isWarmup
              ? `daily_history_warmup_kite (session ${Math.round(sessionAgeMs! / 1000)}s old — history API warming up, next cycle retries automatically)`
              : `daily_history_unavailable_kite (Yahoo fallback disabled — F&O is Kite-only)`,
          ],
        });
        continue;
      }
      const r = buildSignalsForIndex(cfg, intra, daily, gateCtx);
      if (r.hasBars) indicesWithBars++;
      const quality = resolveDataQuality(intraSrc);
      for (const s of r.signals) {
        s.dataQuality = quality;
      }
      bundles.push({ signals: r.signals, snapshot: r.snapshot });
      // Phase-1 IVR/IVP — snapshot ATM IV for THIS index regardless of
      // whether any signal emitted (so BANKEX/MIDCPNIFTY accumulate IV
      // history even on quiet days). Best-effort: any failure (chain
      // fetch, missing IV on both legs, DB write) is logged and skipped
      // — never propagates to the signal pipeline.
      try {
        const expiry = cfg.expiryCadence === "weekly"
          ? nextWeeklyExpiry(cfg.expiryWeekday)
          : nextMonthlyExpiry(cfg.expiryWeekday);
        const chain = await fetchOptionChain(cfg.symbol, expiry);
        // Kite-only: NSE/Yahoo-sourced IV must never pollute the IVR/IVP
        // history that feeds signal confidence (owner policy 2026-06-10).
        if (chain && Number.isFinite(chain.spot) && classifyOcSource(chain.source) === "kite") {
          const atmStrike = nearestStrike(chain.spot, cfg.strikeStep);
          const atmRow = chain.rows.find((rr) => rr.strike === atmStrike);
          const ceIv = atmRow?.ce?.iv ?? null;
          const peIv = atmRow?.pe?.iv ?? null;
          const atmIvCandidates = [ceIv, peIv].filter(
            (v): v is number => v != null && Number.isFinite(v) && v > 0,
          );
          if (atmIvCandidates.length > 0) {
            const atmIv = atmIvCandidates.reduce((a, c) => a + c, 0) / atmIvCandidates.length;
            await recordAtmIv(cfg.symbol, atmIv);
            const metrics = await computeIvMetrics(cfg.symbol, atmIv);
            // Only attach to signals if any were emitted for this index.
            for (const s of r.signals) {
              if (metrics.ivRank != null) s.ivRank = metrics.ivRank;
              if (metrics.ivPercentile != null) s.ivPercentile = metrics.ivPercentile;
            }
          }
        }
      } catch (err) {
        logger.warn(
          { err: (err as Error).message, idx: cfg.symbol },
          "IV history snapshot/metrics failed (per-index)",
        );
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

  // ---------------- Phase-1 post-detection gates ----------------
  //
  // These run BEFORE lifecycle persistence so vetoed / suppressed
  // signals never get a DB row written for them — keeping the
  // history table free of "phantom" entries for trades that the
  // engine itself rejected.
  //
  // Order:
  //   1. Global suppression (circuit breaker / VIX spike) — drops
  //      every HIGH_CONVICTION signal across every index. Baseline
  //      outlooks pass through (read-only, never an actionable plan).
  //   2. OI hard veto (|sentiment| ≥ OI_VETO_THRESHOLD opposing).
  //   3. Correlated-exposure cap (BROAD / BANK buckets).
  //
  // Each step records dropped signals in `suppressed[]` so the UI
  // gate banner has an honest explanation for the missing cards.
  const allSignalsPreFilter = bundles.flatMap((b) => b.signals);

  const globallyVetoed = new Set<OptionSignal>();
  if (gateCtx.globalSuppress) {
    for (const s of allSignalsPreFilter) {
      if (s.tier === "HIGH_CONVICTION") globallyVetoed.add(s);
    }
  }

  const oiVetoed = await applyOiConfirmation(allSignalsPreFilter);

  // Phase-2 post-OI HC emission floor recheck. The in-detector
  // HC_EMISSION_FLOOR gate inside buildSignalsForIndex runs BEFORE
  // applyOiConfirmation, but applyOiConfirmation can shave 5 points off
  // the confidence on the OI_CONFLICT branch (s.confidence -= 5 above
  // the OI_VETO_THRESHOLD veto path). A signal admitted at exactly the
  // floor would therefore ship at floor-5 with HIGH_CONVICTION tier —
  // exactly the UX gap this floor was meant to close. Re-apply the
  // floor here on the FINAL post-OI confidence and route demoted cards
  // to suppressed[] so the diagnostics stream stays honest.
  const oiPostFloorDropped = new Set<OptionSignal>();
  for (const s of allSignalsPreFilter) {
    if (oiVetoed.has(s) || globallyVetoed.has(s)) continue;
    if (s.tier !== "HIGH_CONVICTION") continue;
    if ((s.confidence ?? 0) < HC_EMISSION_FLOOR) {
      oiPostFloorDropped.add(s);
    }
  }

  const survivedSoFar = allSignalsPreFilter.filter(
    (s) =>
      !globallyVetoed.has(s) &&
      !oiVetoed.has(s) &&
      !oiPostFloorDropped.has(s),
  );
  const corr = applyCorrelationCap(survivedSoFar);
  const correlationDropped = new Set(corr.dropped.map((d) => d.signal));

  const droppedAll = new Set<OptionSignal>([
    ...globallyVetoed,
    ...oiVetoed,
    ...oiPostFloorDropped,
    ...correlationDropped,
  ]);

  // Record dropped reasons so the UI banner / diagnostics dump is honest.
  if (globallyVetoed.size > 0) {
    const breakerStops = isSignalHygieneV2Enabled()
      ? gateCtx.paperStoppedToday
      : gateCtx.stoppedToday;
    const reason = gateCtx.circuitBreakerActive
      ? `circuit-breaker veto: ${breakerStops} stops today (limit ${2}) — new high-conviction emission suspended`
      : (gateCtx.vix.reason ?? "global suppression active");
    for (const s of globallyVetoed) {
      suppressed.push({ index: s.index, reasons: [`${s.setupKey}: ${reason}`] });
    }
  }
  for (const s of oiVetoed) {
    suppressed.push({
      index: s.index,
      reasons: [`${s.setupKey}: OI hard-veto on ${s.bias} bias (|sentiment|≥${OI_VETO_THRESHOLD})`],
    });
  }
  for (const s of oiPostFloorDropped) {
    suppressed.push({
      index: s.index,
      reasons: [`${s.setupKey}: post-OI confidence ${s.confidence} < HC emission floor ${HC_EMISSION_FLOOR} — demoted (OI conflict ate the buffer)`],
    });
  }
  for (const d of corr.dropped) {
    suppressed.push({ index: d.signal.index, reasons: [d.reason] });
  }

  // Filter bundles to KEPT signals only.  After this point, the rest
  // of the pipeline (lifecycle persistence, enrichment, paper trades)
  // sees only signals that survived every gate.
  for (const b of bundles) {
    b.signals = b.signals.filter((s) => !droppedAll.has(s));
  }

  // Compute final counts now that gates have been applied.
  for (const b of bundles) {
    for (const s of b.signals) {
      if (s.tier === "BASELINE") baselineCount++;
      else highConvictionCount++;
    }
    out.push(...b.signals);
  }

  // Persist + evaluate lifecycle for every signal (best-effort; mutates each
  // signal in-place so the API response carries status/MFE/MAE/etc).
  // P0-00: stash each signal's LifecycleFields so the LOCKED PLAN vs LIVE
  // MTM surfaces can be composed AFTER enrichment + premium locking below.
  const lcBySignal = new Map<OptionSignal, LifecycleFields>();
  for (const b of bundles) {
    // snapshotFromCtx ALWAYS returns a snapshot now (spot is always known;
    // bar h/l are optional). The previous `if (!b.snapshot) continue` was
    // skipping the entire index's lifecycle whenever the just-opened 15-min
    // bar didn't yet have published extremes — leaving every PENDING plan
    // stuck at "Waiting trigger" while the market blew past the level.
    if (!b.snapshot) continue;
    // Overlay live LTP from Kite onto snapshot.spot. The bar close in
    // ctx.spot can be 5–15 minutes stale (whichever interval the source
    // uses); the lifecycle evaluator triggers on `snapshot.spot` crossing
    // the entry level, so a stale spot means the trigger fires late or
    // never. Bar high/low remain from the latest closed bar so wick-based
    // T1/T2/SL hits still work correctly.
    let snapForLc: SpotSnapshot = b.snapshot;
    // Provenance for the F&O Exit Monitoring Reliability trust gate
    // (fnoExitDecision.ts). `source` reuses the SAME DataQualityLabel this
    // index's signals were already stamped with above (zero duplication) —
    // intraday is Kite-only in this pipeline, so it is always
    // LIVE_KITE_FULL/PARTIAL here, never DELAYED_YAHOO/STALE. Freshness is
    // what actually distinguishes a live tick from a stale bar-close: when
    // no live tick is available for this index, `asOfMs` stays null, which
    // fails the gate CLOSED (STALE_QUOTE) rather than assuming a bar close
    // of unknown age is fresh enough to commit an exit.
    let quoteProvenance: FnoExitQuoteProvenance = {
      source: (b.signals[0]?.dataQuality as FnoExitQuoteProvenance["source"]) ?? "STALE",
      kiteSessionActive,
      asOfMs: null,
    };
    if (liveQuotes && b.signals.length > 0) {
      const ltpKey = SIGNAL_INDEX_TO_LTP_KEY[b.signals[0]!.index];
      const live = ltpKey ? liveQuotes.get(ltpKey) : undefined;
      if (live && Number.isFinite(live.price) && live.price > 0) {
        // Expand bar h/l to envelope live spot so a tick that has already
        // crossed the level (but isn't reflected in the closed-bar high
        // yet) still registers as a hit. Never shrink the bar extremes.
        const high = Math.max(b.snapshot.high ?? live.price, live.price);
        const low  = Math.min(b.snapshot.low  ?? live.price, live.price);
        snapForLc = { spot: live.price, high, low };
        quoteProvenance = {
          ...quoteProvenance,
          asOfMs: live.asOf ?? quotesFetchedAtMs,
        };
      }
    }
    for (const s of b.signals) {
      try {
        const lc = await recordLifecycle({
          signal: s,
          snapshot: snapForLc,
          provenance: quoteProvenance,
          exitMonitorCycle,
        });
        if (!lc) continue;
        lcBySignal.set(s, lc);
        s.status = lc.status;
        s.firstSeenAt = lc.firstSeenAt;
        s.triggeredAt = lc.triggeredAt;
        s.exitedAt = lc.exitedAt;
        s.exitReason = lc.exitReason;
        s.exitPrice = lc.exitPrice;
        s.maxFavorableExcursionPts = lc.maxFavorableExcursionPts;
        s.maxAdverseExcursionPts = lc.maxAdverseExcursionPts;
        s.lastSpot = lc.lastSpot;
        s.lastEvaluatedAt = lc.lastEvaluatedAt;
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

  const allSignals = bundles.flatMap((b) => b.signals);

  // Back-fill option premiums into lifecycle rows — they were null at
  // insert/trigger time because enrichment hadn't run yet.
  await persistOptionPremiums(allSignals).catch((err) =>
    logger.warn({ err: (err as Error).message }, "persistOptionPremiums failed"),
  );

  // Paper-trade opens MUST run AFTER enrichment so that signal.optionEntry
  // etc. are populated.  The lifecycle hook (recordLifecycle → onLifecycleUpsert)
  // only handles MTM + close; opens are deferred here.
  const { tryOpenPaperTrades, markOpenFnoTradesToMarket, markAllOpenFnoTradesToMarket, evaluateOrphanedOpenTrades } = await import("./paperTradingFO");
  const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const signalDate = istNow.toISOString().slice(0, 10);
  await tryOpenPaperTrades(allSignals, signalDate).catch((err) =>
    logger.warn({ err: (err as Error).message }, "tryOpenPaperTrades failed"),
  );

  // ── P0-00: compose LOCKED PLAN vs LIVE MTM surfaces ──────────────────────
  // Runs AFTER persistOptionPremiums (so a plan locked THIS cycle is
  // reflected immediately) and AFTER tryOpenPaperTrades (so a fill opened
  // this very cycle is surfaced). Display-only composition — mutates no
  // decision-affecting field: s.optionEntry / tradeClass / tier / confidence
  // are untouched, and the paper-open path has already consumed them above.
  try {
    const [planRevisedKeys, paperFills] = await Promise.all([
      getPlanRevisedKeys(signalDate),
      getPaperFillsForDate(signalDate),
    ]);
    const now = new Date();
    for (const s of allSignals) {
      const lc = lcBySignal.get(s);
      if (!lc) continue;
      const direction = s.bias === "BEARISH" ? "BEARISH" : "BULLISH";
      const key = `${s.index}|${s.setupKey}|${direction}`;
      // The live enrichment leg vs the contract locked on the row. When the
      // ATM has drifted intra-day, this cycle's premium projections price a
      // DIFFERENT contract than the plan — suppress them rather than let a
      // 77200-strike premium masquerade as the 77100 plan.
      const strikeDrift = lc.lockedStrike !== s.leg.strike;
      // Premiums locked by persistOptionPremiums THIS cycle: the row still
      // read premium-less at lifecycle merge, enrichment then produced
      // premiums for the row's own strike, and the IS-NULL-guarded backfill
      // just persisted them. Mirror those exact conditions here so the
      // response shows the plan the DB now holds without a re-read.
      const justLocked =
        lc.lockedOptionEntry == null &&
        lc.optionPremiumLockedAt == null &&
        s.optionEntry != null &&
        !strikeDrift;
      const plannedEntry =
        lc.lockedOptionEntry ?? (justLocked ? (s.optionEntry ?? null) : null);
      const plannedStop =
        lc.lockedOptionStopLoss ?? (justLocked ? (s.optionStopLoss ?? null) : null);
      const plannedT1 =
        lc.lockedOptionTarget1 ?? (justLocked ? (s.optionTarget1 ?? null) : null);
      const plannedT2 =
        lc.lockedOptionTarget2 ?? (justLocked ? (s.optionTarget2 ?? null) : null);
      const premiumLockedAt =
        lc.optionPremiumLockedAt ?? (justLocked ? now : undefined);
      s.planSnapshot = {
        emittedAt: lc.firstSeenAt,
        triggeredAt: lc.triggeredAt ?? undefined,
        strike: lc.lockedStrike,
        optionType: lc.lockedOptionType,
        tier: lc.lockedTier ?? undefined,
        confidenceAtEmission: lc.lockedConfidence,
        entrySpot: round2(lc.lockedEntry),
        stopSpot: round2(lc.lockedStopLoss),
        target1Spot: round2(lc.lockedTarget1),
        target2Spot: round2(lc.lockedTarget2),
        entryTrigger: lc.lockedEntryTrigger ?? undefined,
        entryPremiumPlanned: plannedEntry ?? undefined,
        stopPremiumPlanned: plannedStop ?? undefined,
        target1PremiumPlanned: plannedT1 ?? undefined,
        target2PremiumPlanned: plannedT2 ?? undefined,
        premiumLockedAt,
        // No locked premiums at all: legacy row (pre-dates locking) or the
        // chain has been unavailable/drifted every cycle so far. The card
        // must warn rather than pass live projections off as the plan.
        legacyPlanFields: plannedEntry == null,
      };
      s.liveMtm = {
        currentSpot: s.lastSpot,
        optionLtp: s.optionLtp,
        liveStrike: s.leg.strike,
        strikeDrift,
        entryPremiumLive: strikeDrift ? undefined : s.optionEntry,
        stopPremiumLive: strikeDrift ? undefined : s.optionStopLoss,
        target1PremiumLive: strikeDrift ? undefined : s.optionTarget1,
        target2PremiumLive: strikeDrift ? undefined : s.optionTarget2,
        lastUpdatedAt: now,
      };
      s.planRevised = planRevisedKeys.has(key);
      const fill = paperFills.get(key);
      if (fill) {
        s.paperFill = {
          entryPremium: fill.entryPremium,
          openedAt: fill.openedAt,
          status: fill.status,
        };
      }
    }
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "P0-00 plan/live surface composition failed — cards fall back to legacy fields",
    );
  }

  // P20: drive max_runup / max_drawdown growth on every signal cycle.
  // Must run AFTER enrichBundlesWithOptionLevels so signal.optionLtp is
  // populated. Observability-only — never opens, closes, or changes any
  // decision-affecting field. Safe to run before or after tryOpenPaperTrades;
  // placed after so newly-opened rows pick up their first MTM tick next cycle
  // (matches existing behaviour where last_premium == entry_premium at open).
  await markOpenFnoTradesToMarket(allSignals, signalDate).catch((err) =>
    logger.warn({ err: (err as Error).message }, "markOpenFnoTradesToMarket failed"),
  );

  // P22: Chain-driven fallback sweep. Catches OPEN rows whose (index, setup,
  // direction) is NOT in the current signal cohort and therefore got skipped
  // by the cohort path above. Observability-only; never opens / closes /
  // changes any decision-affecting field. Internal 45s freshness window
  // avoids duplicating cohort-path work. Fail-safe and idempotent.
  await markAllOpenFnoTradesToMarket(signalDate).catch((err) =>
    logger.warn({ err: (err as Error).message }, "markAllOpenFnoTradesToMarket failed"),
  );

  // P0 hotfix: re-evaluate EVERY OPEN paper row against fresh spot using the
  // same pure evaluateTransition + locked spot levels the live lifecycle uses,
  // and close those that have breached their stop/target. Catches the
  // exit-freeze gap for rows the cohort path abandoned when the signal cohort
  // flipped direction (frozen at TRIGGERED, exited_at=null). Settles STOPPED at
  // the locked stop premium / TARGET2 at the locked T2 premium — immune to the
  // stale-last_premium anomaly. Close-only (not gated by PAPER_TRADING_ENABLED,
  // like reconcile / 15:20 force-exit); fail-safe and idempotent.
  await evaluateOrphanedOpenTrades(
    signalDate,
    undefined,
    undefined,
    undefined,
    exitMonitorCycle,
  ).catch((err) =>
    logger.warn({ err: (err as Error).message }, "evaluateOrphanedOpenTrades failed"),
  );

  // F&O Premium Exit Overlay v1 — premium HARD-STOP backstop (LIVE).
  // Runs AFTER the spot-driven orphan sweep (so spot exits get first claim on a
  // row) and BEFORE the 15:20 force-exit. Closes any OPEN long-option row whose
  // live premium has fallen to/through its locked stop premium — the case where
  // the option premium collapses without the SPOT breaching the spot stop, so no
  // spot-driven stop fires and a defined-risk trade would otherwise ride to
  // 15:20 at far worse than -1R. Settles at the locked stop premium via the
  // existing close (reason STOPPED; granular tags in tags[]/journal — no new
  // exit_reason enum). Close-only (not gated by PAPER_TRADING_ENABLED, like the
  // orphan / 15:20 nets); fail-safe and idempotent. Profit-protection rules are
  // NOT wired here — they remain simulation/diagnostic only (see overlay module).
  {
    const { runPremiumHardStopSweep } = await import("./fnoPremiumExitOverlay");
    await runPremiumHardStopSweep(signalDate).catch((err) =>
      logger.warn({ err: (err as Error).message }, "runPremiumHardStopSweep failed"),
    );
  }

  // Sweep open rows to EXPIRED after market close (no-op intra-session).
  await expireOpenSignalsForToday().catch(() => 0);

  const suppressedSummary = suppressed.map(s => `${s.index}:[${s.reasons.join("; ")}]`).join(" | ");
  logger.info(
    { signalCount: out.length, indicesWithBars, highConvictionCount, baselineCount, suppressedSummary },
    "F&O getOptionSignals: cycle complete",
  );

  // Owner alert: fire when ALL configured indices are suppressed due to a
  // data/session failure. 1-hour dedup in alertOwner prevents spam across 30s cycles.
  // Recovery alert fires when a previously data-suppressed cycle clears.
  {
    const allReasons = suppressed.flatMap(s => s.reasons ?? []);
    const hasKiteExpiry = allReasons.some(r => r.includes("no_live_kite_intraday"));
    const hasHistoryWarmup = allReasons.some(r => r.includes("daily_history_warmup_kite"));
    const hasHistoryUnavailable = allReasons.some(r =>
      r.includes("daily_history_unavailable_kite"),
    );
    const isAllDataSuppressed =
      suppressed.length >= OPTION_INDICES.length &&
      out.length === 0 &&
      (hasKiteExpiry || hasHistoryWarmup || hasHistoryUnavailable);
    const affectedIndices = suppressed.map(s => s.index);

    if (suppressed.length >= OPTION_INDICES.length && out.length === 0) {
      // Incident dedup keys include the trading date so:
      //   – A new calendar day is a new incident (fresh send, not suppressed by yesterday's dedup).
      //   – Within the same day the alert fires at most once per 2 hours (even across restarts
      //     that would otherwise reset the in-memory dedup map).
      const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
      if (hasKiteExpiry) {
        alertOwner(
          "FNO_KITE_SESSION_MISSING",
          "All F&O indices suppressed: Kite session expired or unreachable. No signals until session is renewed.",
          { affectedIndices, dashboardPath: "/options or /fno-diagnostics", isDataIssue: true },
          TWO_HOURS_MS,
          `FNO_KITE_SESSION_MISSING::${signalDate}`,
        );
      } else if (hasHistoryWarmup) {
        alertOwner(
          "FNO_DAILY_HISTORY_WARMUP",
          "All F&O indices suppressed: Kite daily history warming up after fresh login. Next cycle retries automatically.",
          { affectedIndices, dashboardPath: "/fno-diagnostics", isDataIssue: true },
          TWO_HOURS_MS,
          `FNO_DAILY_HISTORY_WARMUP::${signalDate}`,
        );
      } else if (hasHistoryUnavailable) {
        alertOwner(
          "FNO_DAILY_HISTORY_UNAVAILABLE",
          "All F&O indices suppressed: Kite daily history unavailable. Kite session is active — F&O daily bars not yet fetched or failed. Check /fno-diagnostics data-health.",
          { affectedIndices, dashboardPath: "/fno-diagnostics", isDataIssue: true },
          TWO_HOURS_MS,
          `FNO_DAILY_HISTORY_UNAVAILABLE::${signalDate}`,
        );
      }

      // Auto-warmup retry when all indices are suppressed with a Kite data failure.
      //
      // Root cause: `centralIndexCandles(..., "15minute", 5)` returns null when the
      // Kite historical API is rate-limited or the process-level bar cache is cold
      // (e.g. boot warmup raced with another worker, or the session was renewed
      // after warmup ran). Without this, the F&O cycle stays suppressed until the
      // next manual warmup or process restart.
      //
      // Dynamic import breaks the kiteWarmup → optionSignals circular dependency
      // (kiteWarmup already imports OPTION_INDICES from this file at module load).
      // `triggerKiteWarmup("scheduler")` is debounced to 60s inside kiteWarmup.ts,
      // so calling on every 30s signal cycle is safe — at most one actual warmup
      // per 60 seconds. Fire-and-forget: never blocks signal cycle, never throws.
      if (hasKiteExpiry || hasHistoryUnavailable) {
        import("./kiteWarmup").then(({ triggerKiteWarmup }) => {
          void triggerKiteWarmup("scheduler");
        }).catch(() => undefined);
      }
    }

    // Degrade/recover tracking via DB-backed CAS state (family "fno_data") — see
    // systemAlertDedup.ts and handleFnoDataSuppressionTransition above.
    await handleFnoDataSuppressionTransition(
      isAllDataSuppressed,
      OPTION_INDICES.map(c => c.symbol),
    );
  }
  // Stamp the last-cycle metadata so /fno/data-health can surface intraday bar
  // readiness without needing to call getOptionSignals() (which would trigger
  // a full cycle refresh from the diagnostics route).
  lastCycleMeta = {
    ts: Date.now(),
    indicesWithBars,
    suppressed,
    suppressedSummary,
    signalCount: out.length,
    highConvictionCount,
    baselineCount,
  };
  const result: OptionSignalsResult = {
    signals: out,
    diagnostics: {
      indicesConfigured: OPTION_INDICES.length,
      indicesWithBars,
      highConvictionCount,
      baselineCount,
      suppressed,
      gates: {
        circuitBreakerActive: gateCtx.circuitBreakerActive,
        stoppedToday: gateCtx.stoppedToday,
        paperStoppedToday: gateCtx.paperStoppedToday,
        modeledStoppedToday: gateCtx.modeledStoppedToday,
        stopLimit: 2,
        vixSpike: gateCtx.vix.spike,
        vixIntradayPct: gateCtx.vix.intradayPct,
        vixDayPct: gateCtx.vix.dayPct,
        vixSpikeReason: gateCtx.vix.reason,
        correlationDroppedCount: corr.dropped.length,
        oiVetoCount: oiVetoed.size,
        staleExpiredCount,
        notes: gateCtx.notes,
      },
    },
  };
  // Finalize this cycle's F&O Exit Monitoring Reliability counters exactly
  // once, after both trust-gate call sites (cohort-loop recordLifecycle +
  // evaluateOrphanedOpenTrades) have run. Side effect only — rolls into the
  // process-local `getFnoExitMonitorHealth()` snapshot; does not affect
  // `result`/`cache`.
  finalizeFnoExitMonitorCycle(exitMonitorCycle);
  cache = { ts: Date.now(), data: result };

  // ─── P14b upstream reasoning logger (diagnostics-only, fire-and-forget) ──
  // Records one EMITTED row per surviving signal + one PRE_EMISSION_REJECTED
  // row per orchestrator suppression. Reads `out` and `suppressed` AFTER
  // every gate/veto/clamp/correlation decision has already been taken, so
  // it cannot influence signal output. The batch helper is non-throwing
  // and statically imported (no per-call await import latency).
  try {
    const istNow2 = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const sigDate2 = istNow2.toISOString().slice(0, 10);
    void logUpstreamReasoningBatch({
      signals: out,
      suppressed,
      signalDate: sigDate2,
      vix: typeof gateCtx.vix.intradayPct === "number" ? gateCtx.vix.intradayPct : null,
    });
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "P14b upstream reasoning hook failed to dispatch (diagnostics-only)",
    );
  }

  return result;
}
