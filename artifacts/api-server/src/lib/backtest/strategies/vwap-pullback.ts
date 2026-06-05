/** VWAP Pullback Continuation (VWAP_PULLBACK). Clean trending days after move 1. */
import {
  clamp,
  isBearRejection,
  isBullRejection,
  type StrategyContext,
  type StrategyEntry,
  type StrategyModule,
} from "./base";

const OPTION_PREMIUM_NOTE =
  "Option-premium expansion unavailable (no historical option data) — evaluated on spot only.";

function nearLevel(low: number, high: number, level: number, tol: number): boolean {
  return level >= low - tol && level <= high + tol;
}

function evaluate(ctx: StrategyContext, i: number): StrategyEntry | null {
  if (i < 2) return null;
  const a = ctx.atr14[i];
  const sm = ctx.sessionMean[i];
  const e20 = ctx.ema20[i];
  const e50 = ctx.ema50[i];
  if (a == null || a <= 0 || !Number.isFinite(sm) || e20 == null || e50 == null) return null;

  const c = ctx.closes[i]!;
  // The rejection candle is the prior bar; the current bar must break it.
  const ph = ctx.highs[i - 1]!;
  const pl = ctx.lows[i - 1]!;
  const po = ctx.opens[i - 1]!;
  const pc = ctx.closes[i - 1]!;
  const tol = 0.3 * a;

  // ---- CE: uptrend pullback to VWAP/EMA20 then break of rejection high -----
  if (c > sm && e20 > e50) {
    const pulled = nearLevel(pl, ph, sm, tol) || nearLevel(pl, ph, e20, tol);
    const rejection = isBullRejection(po, ph, pl, pc);
    if (pulled && rejection && ctx.highs[i]! > ph && c > pc) {
      const stop = Math.min(pl, ctx.lows[i]!);
      const risk = c - stop;
      if (risk <= 0) return null;
      const conf = clamp(58 + (e20 - e50 > 0.2 * a ? 10 : 0) + (ctx.adx14[i]! >= 22 ? 10 : 0), 50, 90);
      return {
        direction: "BULL",
        optionType: "CALL",
        entrySpot: c,
        stop,
        target1: c + risk,
        target2: c + 2 * risk,
        confidence: conf,
        entryReason: "CE: uptrend pullback into VWAP/EMA20, bullish rejection, break of rejection high.",
        passedConditions: [
          "Price above VWAP",
          "EMA20 above EMA50",
          "Pullback into VWAP/EMA20",
          "Bullish rejection candle",
          "Next candle broke the rejection high",
        ],
        failedConditions: [],
        warnings: [OPTION_PREMIUM_NOTE],
      };
    }
  }

  // ---- PE: downtrend pullback to VWAP/EMA20 then break of rejection low ----
  if (c < sm && e20 < e50) {
    const pulled = nearLevel(pl, ph, sm, tol) || nearLevel(pl, ph, e20, tol);
    const rejection = isBearRejection(po, ph, pl, pc);
    if (pulled && rejection && ctx.lows[i]! < pl && c < pc) {
      const stop = Math.max(ph, ctx.highs[i]!);
      const risk = stop - c;
      if (risk <= 0) return null;
      const conf = clamp(58 + (e50 - e20 > 0.2 * a ? 10 : 0) + (ctx.adx14[i]! >= 22 ? 10 : 0), 50, 90);
      return {
        direction: "BEAR",
        optionType: "PUT",
        entrySpot: c,
        stop,
        target1: c - risk,
        target2: c - 2 * risk,
        confidence: conf,
        entryReason: "PE: downtrend pullback into VWAP/EMA20, bearish rejection, break of rejection low.",
        passedConditions: [
          "Price below VWAP",
          "EMA20 below EMA50",
          "Pullback into VWAP/EMA20",
          "Bearish rejection candle",
          "Next candle broke the rejection low",
        ],
        failedConditions: [],
        warnings: [OPTION_PREMIUM_NOTE],
      };
    }
  }

  return null;
}

export const vwapPullback: StrategyModule = {
  meta: {
    id: "VWAP_PULLBACK",
    name: "VWAP Pullback Continuation",
    category: "Trend Continuation",
    bestCondition: "Clean trending days after the first move",
    suitableIndices: ["NIFTY", "BANKNIFTY", "SENSEX"],
    recommendedTimeframes: ["5m", "15m"],
    riskLevel: "Medium",
    description:
      "Buys the first orderly pullback to VWAP/EMA20 in an established trend, entering on the break of a rejection candle.",
    ignoredFilters: [],
    defaultParams: { target1R: 1, target2R: 2 },
  },
  evaluate,
};
