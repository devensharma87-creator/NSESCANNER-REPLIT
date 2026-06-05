/** Volatility Compression Breakout (COMPRESSION_BREAKOUT). Inside-bar / NR7 squeeze. */
import {
  clamp,
  hasRealBody,
  paramNum,
  range,
  type StrategyContext,
  type StrategyEntry,
  type StrategyModule,
  type StrategyParams,
} from "./base";

const VOLUME_NOTE =
  "Volume expansion modeled via range expansion (no historical volume data for index candles).";

/** Is bar j the narrowest range of the trailing 7 bars (NR7)? */
function isNr7(ctx: StrategyContext, j: number): boolean {
  if (j < 6) return false;
  const rj = range(ctx.highs[j]!, ctx.lows[j]!);
  for (let k = j - 6; k < j; k++) {
    if (range(ctx.highs[k]!, ctx.lows[k]!) <= rj) return false;
  }
  return true;
}

/** Is bar j an inside bar relative to j-1? */
function isInside(ctx: StrategyContext, j: number): boolean {
  if (j < 1) return false;
  return ctx.highs[j]! < ctx.highs[j - 1]! && ctx.lows[j]! > ctx.lows[j - 1]!;
}

function evaluate(ctx: StrategyContext, i: number, p: StrategyParams): StrategyEntry | null {
  if (i < 7) return null;
  const t1R = paramNum(p, "target1R", 1);
  const t2R = paramNum(p, "target2R", 2);
  const a = ctx.atr14[i];
  const sm = ctx.sessionMean[i];
  if (a == null || a <= 0 || !Number.isFinite(sm)) return null;

  // The prior bar is the compression bar.
  const cj = i - 1;
  const compressed = isInside(ctx, cj) || isNr7(ctx, cj);
  if (!compressed) return null;

  const compHi = ctx.highs[cj]!;
  const compLo = ctx.lows[cj]!;
  const o = ctx.opens[i]!;
  const h = ctx.highs[i]!;
  const l = ctx.lows[i]!;
  const c = ctx.closes[i]!;
  // Range-expansion proxy for "volume expansion" (honest: we have no volume).
  const rangeExpands = range(h, l) > 1.2 * range(compHi, compLo);

  // ---- CE: close above the compression high with expansion -----------------
  if (c > compHi && rangeExpands && hasRealBody(o, h, l, c)) {
    const stop = compLo;
    const risk = c - stop;
    if (risk <= 0) return null;
    const conf = clamp(58 + (c >= sm ? 8 : 0) + (range(h, l) > 1.6 * range(compHi, compLo) ? 10 : 0), 50, 90);
    return {
      direction: "BULL",
      optionType: "CALL",
      entrySpot: c,
      stop,
      target1: c + t1R * risk,
      target2: c + t2R * risk,
      confidence: conf,
      entryReason: "CE: break above a volatility-compression bar with range expansion.",
      passedConditions: [
        "Volatility compression (inside bar / NR7)",
        "Close above the compression high",
        "Range expansion on the breakout",
        "Real breakout body (not just a wick)",
      ],
      failedConditions: [],
      warnings: [VOLUME_NOTE],
    };
  }

  // ---- PE: close below the compression low with expansion ------------------
  if (c < compLo && rangeExpands && hasRealBody(o, h, l, c)) {
    const stop = compHi;
    const risk = stop - c;
    if (risk <= 0) return null;
    const conf = clamp(58 + (c <= sm ? 8 : 0) + (range(h, l) > 1.6 * range(compHi, compLo) ? 10 : 0), 50, 90);
    return {
      direction: "BEAR",
      optionType: "PUT",
      entrySpot: c,
      stop,
      target1: c - t1R * risk,
      target2: c - t2R * risk,
      confidence: conf,
      entryReason: "PE: break below a volatility-compression bar with range expansion.",
      passedConditions: [
        "Volatility compression (inside bar / NR7)",
        "Close below the compression low",
        "Range expansion on the breakdown",
        "Real breakout body (not just a wick)",
      ],
      failedConditions: [],
      warnings: [VOLUME_NOTE],
    };
  }

  return null;
}

export const compressionBreakout: StrategyModule = {
  meta: {
    id: "COMPRESSION_BREAKOUT",
    name: "Volatility Compression Breakout",
    category: "Breakout",
    bestCondition: "Low-volatility coil / squeeze before expansion",
    suitableIndices: ["NIFTY", "BANKNIFTY", "SENSEX"],
    recommendedTimeframes: ["5m", "15m"],
    riskLevel: "Medium",
    description:
      "Trades the break of an inside-bar / NR7 compression with a range-expansion confirmation (volume proxy).",
    ignoredFilters: [],
    defaultParams: { target1R: 1, target2R: 2 },
  },
  evaluate,
};
