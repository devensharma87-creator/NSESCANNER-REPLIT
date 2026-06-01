/**
 * Actionable trade-setup derivation — pure, deterministic, never throws.
 *
 * Implements methodology item #10 ("Actionable trade setups with entry / target
 * / SL / RR") and #12 ("invalidation criteria"). Given each index's classic
 * pivot levels and the composite bias score, derive a concrete, descriptive
 * setup per index: a primary directional plan plus an explicit invalidation.
 *
 * REPORTING ONLY. This produces descriptive numbers + text for the Pre/Post-
 * market page (mirroring the existing `buildScenarios` narrative output). It
 * does NOT place orders, open paper trades, size positions, or feed any
 * execution / signal path. No trading decision consumes this module.
 */

export type SetupDirection = "LONG" | "SHORT" | "RANGE";

export interface SetupLevels {
  symbol: string;
  pivot: number;
  r1: number;
  r2: number;
  s1: number;
  s2: number;
}

export interface TradeSetup {
  symbol: string;
  direction: SetupDirection;
  /** Short label, e.g. "Short on rally to R1". */
  label: string;
  /** Suggested entry reference (price). */
  entry: number;
  /** Profit objective (price). */
  target: number;
  /** Protective stop (price). */
  stop: number;
  /** Reward-to-risk multiple, null when degenerate (zero risk). */
  riskReward: number | null;
  rationale: string;
  invalidation: string;
}

const round = (n: number) => Math.round(n * 100) / 100;

function rr(entry: number, target: number, stop: number): number | null {
  const reward = Math.abs(target - entry);
  const risk = Math.abs(entry - stop);
  if (risk <= 0) return null;
  return round(reward / risk);
}

function levelsValid(l: SetupLevels): boolean {
  return (
    [l.pivot, l.r1, l.r2, l.s1, l.s2].every(Number.isFinite) &&
    l.s2 < l.s1 && l.s1 < l.pivot && l.pivot < l.r1 && l.r1 < l.r2
  );
}

const fmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

/**
 * Derive one primary setup per index from the bias score + levels.
 *  - score ≥ +2  → LONG: buy dips toward S1, target R1, stop below S2.
 *  - score ≤ -2  → SHORT: fade rallies toward R1, target S1, stop above R2.
 *  - otherwise   → RANGE: fade the CPR/pivot extremes, RR reported per leg.
 * Indices with malformed levels are skipped (never fabricate a setup).
 */
export function deriveTradeSetups(args: {
  biasScore: number;
  levels: SetupLevels[];
}): TradeSetup[] {
  const { biasScore, levels } = args;
  const out: TradeSetup[] = [];

  const direction: SetupDirection = biasScore >= 2 ? "LONG" : biasScore <= -2 ? "SHORT" : "RANGE";

  for (const l of levels) {
    if (!levelsValid(l)) continue;

    if (direction === "LONG") {
      const entry = round(l.s1);
      const target = round(l.r1);
      const stop = round(l.s2);
      out.push({
        symbol: l.symbol,
        direction: "LONG",
        label: `Long on dip to S1 ${fmt(l.s1)}`,
        entry,
        target,
        stop,
        riskReward: rr(entry, target, stop),
        rationale: `Composite bias is bullish (${biasScore > 0 ? "+" : ""}${biasScore}). Buy pullbacks into immediate support S1 ${fmt(l.s1)} with the pivot ${fmt(l.pivot)} as the trend anchor; first objective immediate resistance R1 ${fmt(l.r1)}.`,
        invalidation: `15-min close below strong support S2 ${fmt(l.s2)} voids the long — step aside / flip defensive.`,
      });
    } else if (direction === "SHORT") {
      const entry = round(l.r1);
      const target = round(l.s1);
      const stop = round(l.r2);
      out.push({
        symbol: l.symbol,
        direction: "SHORT",
        label: `Short on rally to R1 ${fmt(l.r1)}`,
        entry,
        target,
        stop,
        riskReward: rr(entry, target, stop),
        rationale: `Composite bias is bearish (${biasScore}). Fade rallies into immediate resistance R1 ${fmt(l.r1)}; first objective immediate support S1 ${fmt(l.s1)}, with the pivot ${fmt(l.pivot)} as the line in the sand.`,
        invalidation: `15-min close above strong resistance R2 ${fmt(l.r2)} voids the short — cover and reassess.`,
      });
    } else {
      const entryLong = round(l.s1);
      const entryShort = round(l.r1);
      out.push({
        symbol: l.symbol,
        direction: "RANGE",
        label: `Range — fade ${fmt(l.s1)}–${fmt(l.r1)} extremes`,
        entry: round(l.pivot),
        target: round(l.r1),
        stop: round(l.s1),
        riskReward: rr(round(l.pivot), round(l.r1), round(l.s1)),
        rationale: `Composite bias is neutral (${biasScore > 0 ? "+" : ""}${biasScore}). Trade the range: scalp longs near S1 ${fmt(entryLong)} toward the pivot ${fmt(l.pivot)}, scalp shorts near R1 ${fmt(entryShort)}. Cut size versus a trend day; avoid directional option buying (theta drag).`,
        invalidation: `A decisive 15-min close above R1 ${fmt(l.r1)} or below S1 ${fmt(l.s1)} ends the range — switch to the directional plan in that direction.`,
      });
    }
  }

  return out;
}
