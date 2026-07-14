/**
 * Composite next-day bias score — pure, deterministic, never throws.
 *
 * Implements the "composite bias score" from the Pro Market Analyser
 * methodology (§3): synthesise seven independent overnight/EOD signals into
 * one weighted number on a -10..+10 scale, then map to a five-band verdict.
 *
 * REPORTING ONLY. Nothing here feeds signal generation, paper-trade
 * execution, sizing, stops, targets, gates, or any trading decision. It is
 * consumed solely by the Pre/Post-market report aggregator for display.
 *
 * ── Formula note (deliberate, documented deviation) ───────────────────────
 * The methodology's headline formula is:
 *     Bias = Σ(signal × weight) / Σ(weights), clipped to [-10, +10]
 * With per-signal scores on a -3..+3 scale this yields a weighted AVERAGE in
 * [-3, +3] — which can never reach the ±5 / ±10 thresholds the doc's own
 * "final mapping" bands require, and the doc's worked example silently applies
 * an unexplained "× 10 / 1.71" fudge factor to land on -3.5. That arithmetic
 * is internally inconsistent and the example's per-signal scores are hand-
 * assigned rather than produced by any stated curve.
 *
 * We therefore implement the *principled* interpretation that honours the
 * documented threshold table AND the final-mapping bands:
 *     score = clip( (Σ(signal × weight) / Σ(weightsUsed)) × (10 / 3), -10, +10 )
 * i.e. the weighted average (natural range -3..+3) is linearly scaled so that
 * a maximally-aligned reading (every signal at ±3) maps to exactly ±10.
 * Signals with null inputs are excluded from BOTH numerator and denominator so
 * a missing feed never drags the score toward a false neutral.
 *
 * Per-signal scores are continuous piecewise-linear interpolations between the
 * explicit anchors in the methodology's threshold table (the table is the spec;
 * the worked-example numbers are illustrative and not reproduced exactly).
 */

export type BiasLabel =
  | "STRONGLY_BULLISH"
  | "MILDLY_BULLISH"
  | "NEUTRAL"
  | "MILDLY_BEARISH"
  | "STRONGLY_BEARISH";

export interface CompositeBiasInput {
  /** GIFT NIFTY overnight change %, e.g. -0.19 for -0.19%. */
  giftNiftyChangePct: number | null;
  /** FII net cash (₹ Cr). Positive = net buy. */
  fiiCashCr: number | null;
  /** DII net cash (₹ Cr). Positive = net buy. */
  diiCashCr: number | null;
  /** FII index-futures long-short ratio as a PERCENT 0..100 (long / (long+short) × 100). */
  fiiFutLsrPct: number | null;
  /** Option PCR by OI (NIFTY front expiry). */
  pcr: number | null;
  /** India VIX day change %, e.g. -4.87 for -4.87%. Rising VIX = bearish. */
  vixChangePct: number | null;
  /**
   * Macro overlay composite already reduced to a -3..+3 score
   * (hostile = -3: yields ↑, dollar ↑; supportive = +3). Computed upstream
   * in the macro-overlay builder; null when no macro inputs are available.
   */
  macroScore: number | null;
}

export interface BiasSignalBreakdown {
  signal: string;
  weight: number;
  rawValue: number | null;
  score: number | null;
  contribution: number;
  note: string;
}

export interface CompositeBiasResult {
  /** -10..+10, 1 decimal. */
  score: number;
  label: BiasLabel;
  verdict: string;
  breakdown: BiasSignalBreakdown[];
  /** Sum of weights for signals that had data (max 9.0). */
  totalWeightUsed: number;
  /** usedWeight / 9.0, 0..1 — how complete the read is this cycle. */
  dataCompleteness: number;
  invalidation: {
    bullishFlip: string;
    bearishAcceleration: string;
  };
}

/** Signal weights from the methodology threshold table. Σ = 9.0 when all present. */
export const BIAS_WEIGHTS = {
  gift: 1.0,
  fiiCash: 1.5,
  diiCash: 1.5,
  fiiFutOi: 2.0,
  pcr: 1.0,
  vix: 1.0,
  macro: 1.0,
} as const;

const TOTAL_POSSIBLE_WEIGHT =
  BIAS_WEIGHTS.gift +
  BIAS_WEIGHTS.fiiCash +
  BIAS_WEIGHTS.diiCash +
  BIAS_WEIGHTS.fiiFutOi +
  BIAS_WEIGHTS.pcr +
  BIAS_WEIGHTS.vix +
  BIAS_WEIGHTS.macro; // 9.0

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Piecewise-linear interpolation across an ordered list of [x, y] anchors.
 * Flat-extrapolates beyond the first/last anchor. `anchors` must be sorted
 * ascending by x and have at least two entries.
 */
function interp(x: number, anchors: Array<[number, number]>): number {
  if (x <= anchors[0]![0]) return anchors[0]![1];
  const last = anchors[anchors.length - 1]!;
  if (x >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i - 1]!;
    const [x2, y2] = anchors[i]!;
    if (x <= x2) {
      const t = (x - x1) / (x2 - x1);
      return y1 + t * (y2 - y1);
    }
  }
  return last[1];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Per-signal scoring (each clamped to -3..+3) ──────────────────────────
// Anchors come straight from the methodology threshold table.

/** GIFT: -3 at ≤-0.5%, 0 across [-0.1%,+0.1%], +3 at ≥+0.5%. */
export function scoreGift(changePct: number): number {
  return clamp(
    interp(changePct, [[-0.5, -3], [-0.1, 0], [0.1, 0], [0.5, 3]]),
    -3,
    3,
  );
}

/** Cash (FII or DII): -3 at ≤-3000 Cr, 0 across [-500,+500], +3 at ≥+3000 Cr. */
export function scoreCash(netCr: number): number {
  return clamp(
    interp(netCr, [[-3000, -3], [-500, 0], [500, 0], [3000, 3]]),
    -3,
    3,
  );
}

/** FII futures LSR (percent): -3 at ≤20%, 0 across [40%,50%], +3 at ≥70%. */
export function scoreFiiFutLsr(lsrPct: number): number {
  return clamp(
    interp(lsrPct, [[20, -3], [40, 0], [50, 0], [70, 3]]),
    -3,
    3,
  );
}

/**
 * PCR (contrarian at extremes per methodology): -3 at ≤0.7, 0 across
 * [0.9,1.1], +3 at ≥1.3. High PCR = excess put writing = contrarian bullish.
 */
export function scorePcr(pcr: number): number {
  return clamp(
    interp(pcr, [[0.7, -3], [0.9, 0], [1.1, 0], [1.3, 3]]),
    -3,
    3,
  );
}

/**
 * India VIX day change: rising volatility is bearish for equities.
 * +3 when falling ≥5%, 0 at flat, -3 when rising ≥10%. (Asymmetric per doc.)
 */
export function scoreVix(changePct: number): number {
  return clamp(
    interp(changePct, [[-5, 3], [0, 0], [10, -3]]),
    -3,
    3,
  );
}

const LABEL_BANDS: Array<{ min: number; label: BiasLabel }> = [
  { min: 5, label: "STRONGLY_BULLISH" },
  { min: 2, label: "MILDLY_BULLISH" },
  { min: -2, label: "NEUTRAL" },
  { min: -5, label: "MILDLY_BEARISH" },
  { min: -Infinity, label: "STRONGLY_BEARISH" },
];

export function labelForScore(score: number): BiasLabel {
  for (const band of LABEL_BANDS) if (score >= band.min) return band.label;
  return "STRONGLY_BEARISH";
}

function verdictForLabel(label: BiasLabel): string {
  switch (label) {
    case "STRONGLY_BULLISH":
      return "Strongly bullish — overnight cues and institutional positioning align to the upside; favour longs, buy dips.";
    case "MILDLY_BULLISH":
      return "Mildly bullish — net positive lean; buy dips selectively but keep size measured.";
    case "NEUTRAL":
      return "Range-bound / neutral — signals are mixed; trade the levels, avoid directional conviction.";
    case "MILDLY_BEARISH":
      return "Mildly bearish — net negative lean; fade rallies, keep longs on a short leash.";
    case "STRONGLY_BEARISH":
      return "Strongly bearish — cues and institutional positioning align to the downside; favour shorts, sell rallies.";
  }
}

/**
 * Compute the composite bias. Pure: identical inputs → identical output.
 * Never throws; missing inputs are simply excluded from the weighted average.
 */
export function computeCompositeBias(input: CompositeBiasInput): CompositeBiasResult {
  const breakdown: BiasSignalBreakdown[] = [];
  let weightedSum = 0;
  let weightUsed = 0;

  const add = (
    signal: string,
    weight: number,
    rawValue: number | null,
    score: number | null,
    note: string,
  ) => {
    const contribution = score == null ? 0 : round2(score * weight);
    if (score != null) {
      weightedSum += score * weight;
      weightUsed += weight;
    }
    breakdown.push({ signal, weight, rawValue, score: score == null ? null : round2(score), contribution, note });
  };

  add(
    "GIFT NIFTY",
    BIAS_WEIGHTS.gift,
    input.giftNiftyChangePct,
    input.giftNiftyChangePct == null ? null : scoreGift(input.giftNiftyChangePct),
    input.giftNiftyChangePct == null ? "No live GIFT NIFTY feed" : "Overnight gap signal (most direct pre-open cue)",
  );
  add(
    "FII cash",
    BIAS_WEIGHTS.fiiCash,
    input.fiiCashCr,
    input.fiiCashCr == null ? null : scoreCash(input.fiiCashCr),
    input.fiiCashCr == null ? "FII cash flow unavailable" : "Foreign institutional net cash (₹ Cr)",
  );
  add(
    "DII cash",
    BIAS_WEIGHTS.diiCash,
    input.diiCashCr,
    input.diiCashCr == null ? null : scoreCash(input.diiCashCr),
    input.diiCashCr == null ? "DII cash flow unavailable" : "Domestic institutional net cash (₹ Cr)",
  );
  add(
    "FII futures OI (LSR)",
    BIAS_WEIGHTS.fiiFutOi,
    input.fiiFutLsrPct,
    input.fiiFutLsrPct == null ? null : scoreFiiFutLsr(input.fiiFutLsrPct),
    input.fiiFutLsrPct == null
      ? "Participant OI unavailable"
      : "FII index-futures long-share % — the 'king metric' (<30% bearish, >60% bullish)",
  );
  add(
    "Option PCR",
    BIAS_WEIGHTS.pcr,
    input.pcr,
    input.pcr == null ? null : scorePcr(input.pcr),
    input.pcr == null ? "Option chain unavailable" : "Put/Call OI ratio (contrarian at extremes)",
  );
  add(
    "India VIX",
    BIAS_WEIGHTS.vix,
    input.vixChangePct,
    input.vixChangePct == null ? null : scoreVix(input.vixChangePct),
    input.vixChangePct == null ? "India VIX change unavailable" : "Volatility day-change (rising = bearish)",
  );
  add(
    "Macro overlay",
    BIAS_WEIGHTS.macro,
    input.macroScore,
    input.macroScore == null ? null : clamp(input.macroScore, -3, 3),
    input.macroScore == null ? "Macro overlay unavailable" : "Yields / dollar / crude composite (hostile = bearish)",
  );

  // Weighted average in [-3,+3], scaled to the -10..+10 display scale.
  const avg = weightUsed > 0 ? weightedSum / weightUsed : 0;
  const score = round1(clamp(avg * (10 / 3), -10, 10));
  const label = labelForScore(score);

  return {
    score,
    label,
    verdict: verdictForLabel(label),
    breakdown,
    totalWeightUsed: round2(weightUsed),
    dataCompleteness: round2(weightUsed / TOTAL_POSSIBLE_WEIGHT),
    invalidation: {
      bullishFlip:
        "Sustained 15-min reclaim of the immediate resistance with visible FII short-covering by mid-session flips the read bullish.",
      bearishAcceleration:
        "A decisive 15-min close below the immediate support with India VIX expanding accelerates the downside.",
    },
  };
}
