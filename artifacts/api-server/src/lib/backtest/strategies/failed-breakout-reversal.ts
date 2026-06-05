/** Failed Breakout / Liquidity Sweep Reversal (FAILED_BREAKOUT_REVERSAL). */
import {
  clamp,
  lowerWick,
  upperWick,
  type StrategyContext,
  type StrategyEntry,
  type StrategyModule,
} from "./base";

const OPTION_PREMIUM_NOTE =
  "Option-premium failure unavailable (no historical option data) — evaluated on spot only.";

function evaluate(ctx: StrategyContext, i: number): StrategyEntry | null {
  if (i < 2) return null;
  const a = ctx.atr14[i];
  const sm = ctx.sessionMean[i];
  const e9 = ctx.ema9[i];
  if (a == null || a <= 0 || !Number.isFinite(sm) || e9 == null) return null;

  const o = ctx.opens[i]!;
  const h = ctx.highs[i]!;
  const l = ctx.lows[i]!;
  const c = ctx.closes[i]!;
  // Levels that get swept: opening-range or prior-day extremes.
  const upLevel = ctx.orHigh[i] ?? ctx.prevDayHigh[i];
  const downLevel = ctx.orLow[i] ?? ctx.prevDayLow[i];
  const body = Math.abs(c - o);

  // ---- PE after a failed UPSIDE breakout (sweep + reclaim back below) -------
  if (upLevel != null && h > upLevel && c < upLevel) {
    const wickRej = upperWick(o, h, c) >= Math.max(body, 0.4 * a);
    const lostVwap = c < sm || c < e9;
    if (wickRej && lostVwap) {
      const stop = h;
      const risk = stop - c;
      if (risk <= 0) return null;
      const conf = clamp(58 + (upperWick(o, h, c) / a > 0.6 ? 12 : 0) + (c < sm && c < e9 ? 8 : 0), 50, 90);
      return {
        direction: "BEAR",
        optionType: "PUT",
        entrySpot: c,
        stop,
        target1: c - risk,
        target2: c - 2 * risk,
        confidence: conf,
        entryReason: "PE: upside breakout swept the level then reclaimed back below with wick rejection.",
        passedConditions: [
          "Price broke the opening-range/prior-day high",
          "Failed to sustain — closed back below the level",
          "Upper-wick rejection visible",
          "Lost VWAP / short EMA",
        ],
        failedConditions: [],
        warnings: [OPTION_PREMIUM_NOTE],
      };
    }
  }

  // ---- CE after a failed DOWNSIDE breakdown (sweep + reclaim back above) ----
  if (downLevel != null && l < downLevel && c > downLevel) {
    const wickRej = lowerWick(o, l, c) >= Math.max(body, 0.4 * a);
    const reclaimed = c > sm || c > e9;
    if (wickRej && reclaimed) {
      const stop = l;
      const risk = c - stop;
      if (risk <= 0) return null;
      const conf = clamp(58 + (lowerWick(o, l, c) / a > 0.6 ? 12 : 0) + (c > sm && c > e9 ? 8 : 0), 50, 90);
      return {
        direction: "BULL",
        optionType: "CALL",
        entrySpot: c,
        stop,
        target1: c + risk,
        target2: c + 2 * risk,
        confidence: conf,
        entryReason: "CE: downside breakdown swept the level then reclaimed back above with wick rejection.",
        passedConditions: [
          "Price broke the opening-range/prior-day low",
          "Failed to sustain — closed back above the level",
          "Lower-wick rejection visible",
          "Reclaimed VWAP / short EMA",
        ],
        failedConditions: [],
        warnings: [OPTION_PREMIUM_NOTE],
      };
    }
  }

  return null;
}

export const failedBreakoutReversal: StrategyModule = {
  meta: {
    id: "FAILED_BREAKOUT_REVERSAL",
    name: "Failed Breakout / Liquidity Sweep Reversal",
    category: "Reversal",
    bestCondition: "Fake-breakout days, trap days, expiry-style reversals",
    suitableIndices: ["NIFTY", "BANKNIFTY", "SENSEX"],
    recommendedTimeframes: ["5m", "15m"],
    riskLevel: "High",
    description:
      "Fades a failed sweep of the opening-range/prior-day extreme that reclaims back inside with a clear wick rejection.",
    // Counter-trend by nature — the EMA-trend filter would wrongly veto it.
    ignoredFilters: ["emaTrendFilter"],
    defaultParams: { target1R: 1, target2R: 2 },
  },
  evaluate,
};
