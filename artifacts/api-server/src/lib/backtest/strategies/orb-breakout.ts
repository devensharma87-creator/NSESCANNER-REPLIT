/** Opening Range Breakout (ORB_BREAKOUT). Trending / gap-continuation days. */
import {
  clamp,
  hasRealBody,
  type StrategyContext,
  type StrategyEntry,
  type StrategyModule,
} from "./base";

const OPTION_PREMIUM_NOTE =
  "Option-premium confirmation unavailable (no historical option data) — evaluated on spot only.";

function evaluate(ctx: StrategyContext, i: number): StrategyEntry | null {
  if (i < 2) return null;
  const a = ctx.atr14[i];
  const sm = ctx.sessionMean[i];
  const orHi = ctx.orHigh[i];
  const orLo = ctx.orLow[i];
  if (a == null || a <= 0 || !Number.isFinite(sm) || orHi == null || orLo == null) return null;

  const o = ctx.opens[i]!;
  const h = ctx.highs[i]!;
  const l = ctx.lows[i]!;
  const c = ctx.closes[i]!;
  const prevHi = ctx.prevDayHigh[i];
  const prevLo = ctx.prevDayLow[i];

  // ---- CE: opening-range high broken and held above VWAP -------------------
  if (c > orHi) {
    if (!hasRealBody(o, h, l, c)) return null; // breakout candle is only a wick
    if (c < sm) return null; // not above VWAP
    if (prevHi != null && c >= prevHi - 0.25 * a && c <= prevHi) return null; // into resistance
    const stop = Math.min(l, orLo);
    const risk = c - stop;
    if (risk <= 0) return null;
    const passed = [
      "Opening-range high broken",
      "Candle closed above the range (real body, not just a wick)",
      "Price above session VWAP",
    ];
    if (prevHi != null) passed.push("Not opening directly into prior-day resistance");
    const conf = clamp(
      60 +
        (ctx.adx14[i]! >= 25 ? 12 : 0) +
        ((c - orHi) / a > 0.3 ? 8 : 0),
      50,
      90,
    );
    return {
      direction: "BULL",
      optionType: "CALL",
      entrySpot: c,
      stop,
      target1: c + risk,
      target2: c + 2 * risk,
      confidence: conf,
      entryReason: "CE: opening-range high broken and held above VWAP with a real breakout body.",
      passedConditions: passed,
      failedConditions: [],
      warnings: [OPTION_PREMIUM_NOTE],
    };
  }

  // ---- PE: opening-range low broken and held below VWAP --------------------
  if (c < orLo) {
    if (!hasRealBody(o, h, l, c)) return null;
    if (c > sm) return null;
    if (prevLo != null && c <= prevLo + 0.25 * a && c >= prevLo) return null; // into support
    const stop = Math.max(h, orHi);
    const risk = stop - c;
    if (risk <= 0) return null;
    const passed = [
      "Opening-range low broken",
      "Candle closed below the range (real body, not just a wick)",
      "Price below session VWAP",
    ];
    if (prevLo != null) passed.push("Not opening directly into prior-day support");
    const conf = clamp(
      60 +
        (ctx.adx14[i]! >= 25 ? 12 : 0) +
        ((orLo - c) / a > 0.3 ? 8 : 0),
      50,
      90,
    );
    return {
      direction: "BEAR",
      optionType: "PUT",
      entrySpot: c,
      stop,
      target1: c - risk,
      target2: c - 2 * risk,
      confidence: conf,
      entryReason: "PE: opening-range low broken and held below VWAP with a real breakdown body.",
      passedConditions: passed,
      failedConditions: [],
      warnings: [OPTION_PREMIUM_NOTE],
    };
  }

  return null;
}


export const orbBreakout: StrategyModule = {
  meta: {
    id: "ORB_BREAKOUT",
    name: "Opening Range Breakout",
    category: "Breakout",
    bestCondition: "Trending days, gap continuation, strong momentum",
    suitableIndices: ["NIFTY", "BANKNIFTY", "SENSEX"],
    recommendedTimeframes: ["5m", "15m", "30m"],
    riskLevel: "Medium",
    description:
      "Trades a clean break and close beyond the first-candle opening range in the direction of VWAP, with a real breakout body (not a wick).",
    ignoredFilters: [],
    defaultParams: { target1R: 1, target2R: 2 },
  },
  evaluate,
};
