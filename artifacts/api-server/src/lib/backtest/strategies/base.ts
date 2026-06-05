/**
 * Backtest Lab V2 — Strategy Research: shared contracts & constants.
 *
 * HONESTY CONTRACT (identical to the rest of the Backtest Lab):
 *   - There are NO historical option premiums in this environment. Every strategy
 *     module evaluates purely on REAL historical index SPOT candles. Option P&L is
 *     a clearly-LABELED ATM delta proxy (|delta| ≈ 0.5) on the REAL spot move —
 *     never a fabricated premium. Entry/exit PREMIUMS stay null.
 *   - VWAP is impossible without volume; historical index candles carry none, so we
 *     use an honest EQUAL-weighted session-mean of typical price and say so.
 *   - No look-ahead: a strategy at bar i may only read candles/series at index ≤ i,
 *     and the runner manages an open position only with bars at/after entry.
 *   - This file NEVER imports or mutates the live engine (optionSignals.ts).
 */

import type { Candle } from "../directional";

export type StrategyId =
  | "ORB_BREAKOUT"
  | "VWAP_PULLBACK"
  | "EMA_TREND_RETEST"
  | "FAILED_BREAKOUT_REVERSAL"
  | "RANGE_REVERSAL"
  | "COMPRESSION_BREAKOUT";

export const STRATEGY_IDS: StrategyId[] = [
  "ORB_BREAKOUT",
  "VWAP_PULLBACK",
  "EMA_TREND_RETEST",
  "FAILED_BREAKOUT_REVERSAL",
  "RANGE_REVERSAL",
  "COMPRESSION_BREAKOUT",
];

export function isStrategyId(v: unknown): v is StrategyId {
  return typeof v === "string" && (STRATEGY_IDS as string[]).includes(v);
}

export type FilterKey =
  | "vwapFilter"
  | "emaTrendFilter"
  | "optionChainConfirmation"
  | "avoidChopZone"
  | "avoidLast15Minutes"
  | "avoidWideSpread"
  | "avoidLowVolume"
  | "minimumRiskReward";

export interface FilterConfig {
  vwapFilter: boolean;
  emaTrendFilter: boolean;
  /** Always auto-disabled in backtest — no historical option-chain data. */
  optionChainConfirmation: boolean;
  avoidChopZone: boolean;
  avoidLast15Minutes: boolean;
  /** Always auto-disabled in backtest — no historical option spread data. */
  avoidWideSpread: boolean;
  /** Always auto-disabled in backtest — no historical option volume data. */
  avoidLowVolume: boolean;
  /** Minimum reward:risk multiple; ≤ 0 means the filter is off. */
  minimumRiskReward: number;
}

export const DEFAULT_FILTERS: FilterConfig = {
  vwapFilter: true,
  emaTrendFilter: true,
  optionChainConfirmation: false,
  avoidChopZone: true,
  avoidLast15Minutes: true,
  avoidWideSpread: false,
  avoidLowVolume: false,
  minimumRiskReward: 1.5,
};

/** Filters that depend on option/chain/volume data we do NOT have historically. */
export const OPTION_DEPENDENT_FILTERS: FilterKey[] = [
  "optionChainConfirmation",
  "avoidWideSpread",
  "avoidLowVolume",
];

export type Direction = "BULL" | "BEAR";

/** Common signal object every strategy returns (or null when no setup). */
export interface StrategyEntry {
  direction: Direction;
  optionType: "CALL" | "PUT";
  entrySpot: number;
  stop: number;
  target1: number;
  target2: number;
  /** 0–100 transparent confidence from the conditions actually met. */
  confidence: number;
  entryReason: string;
  passedConditions: string[];
  failedConditions: string[];
  warnings: string[];
}

export interface IndexCfg {
  expiryWeekday: number;
  expiryCadence: "weekly" | "monthly";
  strikeStep: number;
}

// Real configured values (mirror optionChain.ts IndexCfg / STRIKE_STEPS).
export const INDEX_CFG: Record<string, IndexCfg> = {
  NIFTY: { expiryWeekday: 2, expiryCadence: "weekly", strikeStep: 50 },
  BANKNIFTY: { expiryWeekday: 4, expiryCadence: "monthly", strikeStep: 100 },
  SENSEX: { expiryWeekday: 2, expiryCadence: "weekly", strikeStep: 100 },
};

export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
export const ATM_DELTA = 0.5; // ATM long-option delta magnitude (modeled).
export const WARMUP_BARS = 30; // ADX(14)/EMA50 need warm-up to stabilise.
export const FORCE_EXIT_MIN = 15 * 60 + 20; // 15:20 IST hard intraday exit.
export const LAST_15_MIN = 15 * 60 + 15; // 15:15 IST late-entry cutoff.
export const MARKET_OPEN_MIN = 9 * 60 + 15; // 09:15 IST.
export const MAX_LOTS = 50;
/** Opening range = first N session bars (15-min candle ⇒ first 15-min range). */
export const OR_BARS = 1;
/** ADX below this = a dead/choppy tape for breakout & trend strategies. */
export const CHOP_ADX_FLOOR = 18;
/** Modeled cost estimates (clearly labeled, OFF unless the user opts in). */
export const CHARGES_PER_LOT = 40; // ₹ round-trip brokerage+taxes estimate per lot.
export const SLIPPAGE_POINTS = 0.5; // spot points of slippage modeled per fill.

/**
 * Precomputed per-bar series + structural context, all causal (index i only ever
 * summarises bars ≤ i). Built once per (index, candle-series) by context.ts.
 */
export interface StrategyContext {
  indexSymbol: string;
  cfg: IndexCfg;
  candles: Candle[];
  closes: number[];
  highs: number[];
  lows: number[];
  opens: number[];
  ema9: (number | null)[];
  ema20: (number | null)[];
  ema50: (number | null)[];
  rsi14: (number | null)[];
  atr14: (number | null)[];
  adx14: (number | null)[];
  /** Equal-weighted session-mean of typical price (labeled VWAP substitute). */
  sessionMean: number[];
  istMinute: number[];
  barInSession: number[];
  isLastBarOfDay: boolean[];
  /** Opening-range high/low for the bar's session (valid once barInSession ≥ OR_BARS). */
  orHigh: (number | null)[];
  orLow: (number | null)[];
  /** Running intraday extremes INCLUSIVE of bar i (causal). */
  dayHighSoFar: number[];
  dayLowSoFar: number[];
  /** Previous completed session levels (null on the first day). */
  prevDayHigh: (number | null)[];
  prevDayLow: (number | null)[];
  prevDayClose: (number | null)[];
  /** Central Pivot Range from the previous day (null on the first day). */
  cprHigh: (number | null)[];
  cprLow: (number | null)[];
}

/** Resolved numeric strategy parameters (defaults merged with any user override). */
export type StrategyParams = Record<string, number>;

export interface StrategyModule {
  meta: import("../types").BacktestStrategyMetaOut;
  /**
   * Pure, causal: may read ctx series only at index ≤ i. Returns null = no setup.
   * `params` are the resolved numeric params (defaults ∪ honored overrides).
   */
  evaluate(ctx: StrategyContext, i: number, params: StrategyParams): StrategyEntry | null;
}

/**
 * Merge a user-supplied param override onto a strategy's defaults. ONLY keys that
 * already exist in `defaults` are honored, and only finite numbers — anything else
 * is ignored (defense-in-depth: a stray/garbage key can never change behaviour).
 */
export function resolveParams(
  defaults: Record<string, number>,
  override?: Record<string, unknown> | null,
): StrategyParams {
  const out: StrategyParams = { ...defaults };
  if (override) {
    for (const k of Object.keys(defaults)) {
      const v = override[k];
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
  }
  return out;
}

/** Read a numeric param with a hard fallback (never returns NaN/Infinity). */
export function paramNum(p: StrategyParams, key: string, fallback: number): number {
  const v = p[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

// ---- small pure candle helpers shared by the strategy modules ----------------

export function body(o: number, c: number): number {
  return Math.abs(c - o);
}
export function upperWick(o: number, h: number, c: number): number {
  return h - Math.max(o, c);
}
export function lowerWick(o: number, l: number, c: number): number {
  return Math.min(o, c) - l;
}
export function range(h: number, l: number): number {
  return h - l;
}

/** Bullish rejection: closes up, with a lower wick clearly longer than the body. */
export function isBullRejection(o: number, h: number, l: number, c: number): boolean {
  const b = body(o, c);
  return c >= o && lowerWick(o, l, c) >= Math.max(b, (h - l) * 0.33);
}
/** Bearish rejection: closes down, with an upper wick clearly longer than the body. */
export function isBearRejection(o: number, h: number, l: number, c: number): boolean {
  const b = body(o, c);
  return c <= o && upperWick(o, h, c) >= Math.max(b, (h - l) * 0.33);
}

/** Breakout candle is "not only a wick" — real body closes through the level. */
export function hasRealBody(o: number, h: number, l: number, c: number): boolean {
  const r = h - l;
  return r > 0 && body(o, c) >= r * 0.4;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
