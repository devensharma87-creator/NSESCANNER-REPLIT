/** EMA Trend Retest (EMA_TREND_RETEST). Smooth directional days. */
import {
  clamp,
  paramNum,
  type StrategyContext,
  type StrategyEntry,
  type StrategyModule,
  type StrategyParams,
} from "./base";

const OPTION_PREMIUM_NOTE =
  "Option-premium confirmation unavailable (no historical option data) — evaluated on spot only.";

function evaluate(ctx: StrategyContext, i: number, p: StrategyParams): StrategyEntry | null {
  if (i < 2) return null;
  const t1R = paramNum(p, "target1R", 1);
  const t2R = paramNum(p, "target2R", 2);
  const a = ctx.atr14[i];
  const sm = ctx.sessionMean[i];
  const e9 = ctx.ema9[i];
  const e20 = ctx.ema20[i];
  const e50 = ctx.ema50[i];
  if (a == null || a <= 0 || !Number.isFinite(sm) || e9 == null || e20 == null || e50 == null) {
    return null;
  }

  const c = ctx.closes[i]!;
  const l = ctx.lows[i]!;
  const h = ctx.highs[i]!;
  const prevHi = ctx.highs[i - 1]!;
  const prevLo = ctx.lows[i - 1]!;
  const tol = 0.3 * a;

  // ---- CE: stacked bull EMAs, retest of EMA9/20 holds, close > prev high ---
  if (e9 > e20 && e20 > e50 && c > sm) {
    const retest = l <= e9 + tol || l <= e20 + tol; // dipped into the EMAs
    const holds = c > e20; // pullback held above the slow EMA
    if (retest && holds && c > prevHi) {
      const stop = Math.min(l, e20 - 0.1 * a);
      const risk = c - stop;
      if (risk <= 0) return null;
      const conf = clamp(60 + (ctx.adx14[i]! >= 25 ? 12 : 0) + (e9 - e20 > 0.2 * a ? 8 : 0), 50, 90);
      return {
        direction: "BULL",
        optionType: "CALL",
        entrySpot: c,
        stop,
        target1: c + t1R * risk,
        target2: c + t2R * risk,
        confidence: conf,
        entryReason: "CE: EMA9>EMA20>EMA50, retest of fast EMAs held, close above previous high.",
        passedConditions: [
          "EMA9 > EMA20 > EMA50",
          "Price above VWAP",
          "Pullback retested EMA9/EMA20 and held",
          "Close above previous candle high",
        ],
        failedConditions: [],
        warnings: [OPTION_PREMIUM_NOTE],
      };
    }
  }

  // ---- PE: stacked bear EMAs, retest of EMA9/20 fails, close < prev low ----
  if (e9 < e20 && e20 < e50 && c < sm) {
    const retest = h >= e9 - tol || h >= e20 - tol;
    const fails = c < e20;
    if (retest && fails && c < prevLo) {
      const stop = Math.max(h, e20 + 0.1 * a);
      const risk = stop - c;
      if (risk <= 0) return null;
      const conf = clamp(60 + (ctx.adx14[i]! >= 25 ? 12 : 0) + (e20 - e9 > 0.2 * a ? 8 : 0), 50, 90);
      return {
        direction: "BEAR",
        optionType: "PUT",
        entrySpot: c,
        stop,
        target1: c - t1R * risk,
        target2: c - t2R * risk,
        confidence: conf,
        entryReason: "PE: EMA9<EMA20<EMA50, retest of fast EMAs failed, close below previous low.",
        passedConditions: [
          "EMA9 < EMA20 < EMA50",
          "Price below VWAP",
          "Pullback retested EMA9/EMA20 and failed",
          "Close below previous candle low",
        ],
        failedConditions: [],
        warnings: [OPTION_PREMIUM_NOTE],
      };
    }
  }

  return null;
}

export const emaTrendRetest: StrategyModule = {
  meta: {
    id: "EMA_TREND_RETEST",
    name: "EMA Trend Retest",
    category: "Trend Continuation",
    bestCondition: "Smooth directional days",
    suitableIndices: ["NIFTY", "BANKNIFTY", "SENSEX"],
    recommendedTimeframes: ["5m", "15m"],
    riskLevel: "Medium",
    description:
      "Enters in the direction of a fully-stacked EMA trend after price retests the fast EMAs and resumes.",
    ignoredFilters: [],
    defaultParams: { target1R: 1, target2R: 2 },
  },
  evaluate,
};
