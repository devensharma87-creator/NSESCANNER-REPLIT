/**
 * Kite Candle Evaluation Activation Control — Pack 33 Gate 9.
 *
 * Phase A: This constant is `false`.
 *   - The Kite candle store populates PostgreSQL and L1 in the background.
 *   - The full-NSE warehouse population job runs asynchronously.
 *   - Scanner rows remain NOT_EVALUATED regardless of candle availability.
 *   - score=null, confidence=null, reasons=[].
 *   - No alerts, rankings, setups, paper admission, or trading admission.
 *   - Yahoo/incomplete Indian rows are also NOT_EVALUATED (unchanged).
 *
 * Phase B: Change `false` to `true` in a new reviewed commit after Phase A
 *   production evidence passes (candle store >95% ok for curated universe,
 *   no 429 breaches, production screenshots, Prompt 31 canary 30 min pass).
 *
 * RULES (non-negotiable):
 *   1. No environment variable, feature flag, query parameter, header,
 *      admin route, or process.env read may bypass this constant.
 *      Changing the value requires a code edit + review + redeploy.
 *   2. While false, buildRowFromKiteCandles() MUST return a NOT_EVALUATED
 *      row after computing all canonical inputs and indicators — the store
 *      population path is unaffected (it runs whether this is true or false).
 *   3. The `as boolean` cast prevents TypeScript from narrowing to the
 *      literal `false`, which would dead-code-eliminate the guard.
 *   4. This constant controls EVALUATION ONLY. The candle store populates
 *      and the background warehouse job runs regardless of this value.
 *
 * Activation sequence:
 *   1. Publish with `false` (Phase A) — verify production candle store.
 *   2. Set `true`, review, publish (Phase B) — verify evaluated output.
 *
 * Machine-readable reason code returned when locked:
 *   PHASE_A_POPULATION_ONLY — score=null, signal=NOT_EVALUATED
 */

/**
 * Compile-time activation gate for Kite candle evaluation.
 *
 * false  →  Phase A: store populates, all rows NOT_EVALUATED
 * true   →  Phase B: evaluated recommendations enabled for canonical rows
 *
 * Set to `false as boolean` (not `false`) to prevent TypeScript dead-code
 * elimination of the guard in scanner.ts line ~424.
 */
export const SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED = false as boolean;

/**
 * Stable reason code surfaced in recommendation.setupMessage when the
 * evaluation lock is false. Clients may key on this string to distinguish
 * an intentional Phase A lock from a data-availability NOT_EVALUATED.
 */
export const CANDLE_EVALUATION_LOCKED_CODE =
  "PHASE_A_POPULATION_ONLY" as const;

export type CandleEvaluationLockedCode = typeof CANDLE_EVALUATION_LOCKED_CODE;

/**
 * Returns the current evaluation authorization state without any DB or
 * environment-variable lookups. Safe to call on any code path.
 */
export function getCandleEvaluationStatus(): {
  authorized: boolean;
  phase: "A" | "B";
  reason: string;
} {
  return {
    authorized: SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED,
    phase: SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED ? "B" : "A",
    reason: SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED
      ? "Phase B: Kite candle evaluation enabled."
      : "Phase A: candle store population active; evaluation locked until Phase B authorization. Change SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED=true in candleEvaluationControl.ts after Phase A evidence passes.",
  };
}
