/** Range / Mean-Reversion Reversal (RANGE_REVERSAL). Sideways, low-ADX days. */
import {
  CHOP_ADX_FLOOR,
  clamp,
  isBearRejection,
  isBullRejection,
  type StrategyContext,
  type StrategyEntry,
  type StrategyModule,
} from "./base";

const OPTION_PREMIUM_NOTE =
  "Option-premium confirmation unavailable (no historical option data) — evaluated on spot only.";

function evaluate(ctx: StrategyContext, i: number): StrategyEntry | null {
  if (i < 2) return null;
  const a = ctx.atr14[i];
  const ax = ctx.adx14[i];
  const rsiV = ctx.rsi14[i];
  if (a == null || a <= 0 || ax == null || rsiV == null) return null;
  // Only a ranging tape — low ADX. Trending tapes are not this strategy's job.
  if (ax >= CHOP_ADX_FLOOR + 4) return null;

  const o = ctx.opens[i]!;
  const h = ctx.highs[i]!;
  const l = ctx.lows[i]!;
  const c = ctx.closes[i]!;
  const prevHi = ctx.highs[i - 1]!;
  const prevLo = ctx.lows[i - 1]!;
  const tol = 0.25 * a;

  // Support / resistance zones from prior-day + CPR.
  const support = ctx.prevDayLow[i] != null && ctx.cprLow[i] != null
    ? Math.min(ctx.prevDayLow[i]!, ctx.cprLow[i]!)
    : ctx.prevDayLow[i] ?? ctx.cprLow[i];
  const resistance = ctx.prevDayHigh[i] != null && ctx.cprHigh[i] != null
    ? Math.max(ctx.prevDayHigh[i]!, ctx.cprHigh[i]!)
    : ctx.prevDayHigh[i] ?? ctx.cprHigh[i];

  // ---- CE: oversold rejection at the lower edge of the range ---------------
  if (support != null && l <= support + tol && rsiV <= 35 && isBullRejection(o, h, l, c) && c > prevHi) {
    const stop = l - 0.1 * a;
    const risk = c - stop;
    if (risk <= 0) return null;
    const conf = clamp(55 + (rsiV <= 28 ? 12 : 0) + (ax < CHOP_ADX_FLOOR ? 8 : 0), 50, 88);
    return {
      direction: "BULL",
      optionType: "CALL",
      entrySpot: c,
      stop,
      target1: c + risk,
      target2: c + 2 * risk,
      confidence: conf,
      entryReason: "CE: oversold bullish rejection at range support in a low-ADX tape.",
      passedConditions: [
        "Ranging tape (low ADX)",
        "Touched range support",
        "RSI oversold",
        "Bullish rejection candle",
        "Broke the prior candle high",
      ],
      failedConditions: [],
      warnings: [OPTION_PREMIUM_NOTE],
    };
  }

  // ---- PE: overbought rejection at the upper edge of the range -------------
  if (resistance != null && h >= resistance - tol && rsiV >= 65 && isBearRejection(o, h, l, c) && c < prevLo) {
    const stop = h + 0.1 * a;
    const risk = stop - c;
    if (risk <= 0) return null;
    const conf = clamp(55 + (rsiV >= 72 ? 12 : 0) + (ax < CHOP_ADX_FLOOR ? 8 : 0), 50, 88);
    return {
      direction: "BEAR",
      optionType: "PUT",
      entrySpot: c,
      stop,
      target1: c - risk,
      target2: c - 2 * risk,
      confidence: conf,
      entryReason: "PE: overbought bearish rejection at range resistance in a low-ADX tape.",
      passedConditions: [
        "Ranging tape (low ADX)",
        "Touched range resistance",
        "RSI overbought",
        "Bearish rejection candle",
        "Broke the prior candle low",
      ],
      failedConditions: [],
      warnings: [OPTION_PREMIUM_NOTE],
    };
  }

  return null;
}

export const rangeReversal: StrategyModule = {
  meta: {
    id: "RANGE_REVERSAL",
    name: "Range / Mean-Reversion Reversal",
    category: "Mean Reversion",
    bestCondition: "Sideways, low-volatility, range-bound days",
    suitableIndices: ["NIFTY", "BANKNIFTY", "SENSEX"],
    recommendedTimeframes: ["5m", "15m"],
    riskLevel: "Medium",
    description:
      "Fades the edges of an intraday range at support/resistance with an RSI extreme and rejection candle. Counter-trend by design.",
    // A range play deliberately trades against VWAP/EMA-trend and inside chop.
    ignoredFilters: ["vwapFilter", "emaTrendFilter", "avoidChopZone"],
    defaultParams: { rsiOversold: 35, rsiOverbought: 65, target1R: 1, target2R: 2 },
  },
  evaluate,
};
