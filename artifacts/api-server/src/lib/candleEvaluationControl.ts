/**
 * Kite Candle Store Control — Pack 33 Gate 9 (evaluation) + Pack 33 Corrective (warehouse population).
 *
 * Two independent compile-time locks govern distinct lifecycle phases:
 *
 *   FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED  (this file, Lock W)
 *     false → warehouse scheduler does NOT register; no Kite historical requests
 *             for full-NSE warehouse purposes can occur regardless of DB state.
 *     true  → warehouse population may start when all other DB/lock conditions are met.
 *
 *   SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED  (this file, Lock E)
 *     false → Phase A: store populates, all rows NOT_EVALUATED.
 *     true  → Phase B: evaluated recommendations enabled for canonical rows.
 *
 * Both locks must be true independently before their respective path is live.
 * Neither has any environment-variable, route, query, admin, or force bypass.
 */

/**
 * Compile-time warehouse population lock.
 *
 * false → PAUSED_BY_COMPILE_TIME_CONTROL:
 *   - Warehouse scheduler does NOT register (no setTimeout).
 *   - runFullNseWarehousePopulation() returns immediately with skipReason.
 *   - fetchWarehouseEntry() throws BUG-error if somehow reached.
 *   - No Kite historical API call occurs for full-NSE warehouse purposes.
 *   - Curated candle-store hydration (kiteCandleStore.ts) is independent and unaffected.
 *   - Safe after deployment even if no owner action is performed.
 *
 * true → warehouse population may proceed when DB/advisory-lock conditions allow.
 *
 * Set to `false as boolean` to prevent TypeScript dead-code elimination of guards.
 * Changing requires a code edit + review + redeploy.
 *
 * RULES:
 *   1. No environment variable, feature flag, query parameter, header,
 *      admin route, or process.env read may bypass this constant.
 *   2. While false, the scheduler MUST NOT register, even if the DB shows CANARY.
 *   3. While false, no full-NSE Kite historical request may occur.
 *   4. This lock controls WAREHOUSE POPULATION ONLY.
 *      Curated candle-store hydration, scanner evaluation, and paper trading
 *      are governed by their own independent locks.
 */
export const FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED = false as boolean;

/**
 * Machine-readable code returned when the warehouse population lock is false.
 * Surfaced in scheduler logs, metrics, and runFullNseWarehousePopulation().skipReason.
 */
export const WAREHOUSE_POPULATION_LOCKED_CODE =
  "PAUSED_BY_COMPILE_TIME_CONTROL" as const;

export type WarehousePopulationLockedCode = typeof WAREHOUSE_POPULATION_LOCKED_CODE;

/**
 * Returns the current warehouse population lock status without any DB or
 * environment-variable lookups. Safe to call on any code path.
 */
export function getWarehousePopulationLockStatus(): {
  authorized: boolean;
  lockedCode: WarehousePopulationLockedCode | null;
  reason: string;
} {
  return {
    authorized: FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED,
    lockedCode: FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED ? null : WAREHOUSE_POPULATION_LOCKED_CODE,
    reason: FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED
      ? "Warehouse population authorized. Scheduler will register on next boot."
      : "Warehouse population is compile-time locked. Set FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED=true in candleEvaluationControl.ts after canary evidence passes.",
  };
}

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
