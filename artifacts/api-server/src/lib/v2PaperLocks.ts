/**
 * V2 Paper-Trading Cohort Hard Locks — Pack 32.
 *
 * These are compile-time constants that control whether the V2 paper-trading
 * cohorts are permitted to write any rows to the database.
 *
 * RULES (non-negotiable):
 *
 *   1. Environment variables MUST NOT bypass these constants. There is no
 *      env-var check, feature-flag lookup, or process.env read in this
 *      module. Changing the value requires a code edit + redeploy.
 *
 *   2. No route, scheduler, replay function, test fixture, force flag,
 *      admin request, or internal function may write a V2 row while the
 *      corresponding constant is `false`.
 *
 *   3. A blocked attempt returns a stable machine-readable reason code:
 *        - `FNO_PAPER_V2_DISABLED`
 *        - `SWING_PAPER_V2_DISABLED`
 *
 *   4. Legacy paper trading is NOT disabled or changed by these locks.
 *      `FNO_PAPER_LEGACY` and `SWING_PAPER_LEGACY` write paths are
 *      completely unaffected.
 *
 *   5. The `as boolean` cast is intentional: it prevents TypeScript from
 *      narrowing the type to the literal `false`, which would cause dead-code
 *      elimination of the guard that uses it. The runtime value is always
 *      `false` until a code change explicitly sets it to `true`.
 *
 * Activation sequence (future, requires separate owner authorization):
 *   1. `SWING_PAPER_V2_RUNTIME_AUTHORIZED = true` after swing qualification
 *   2. `FNO_PAPER_V2_RUNTIME_AUTHORIZED = true` after ≥6 months of option-
 *      premium data and frozen-protocol F&O requalification.
 *
 * @see paperCohort.ts  for the full cohort domain contract
 * @see paperCohortMigrations.ts  for additive DB migration (not yet executed)
 */

export const FNO_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean;
export const SWING_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean;

/**
 * Stable error codes returned when a V2 write is attempted while the lock
 * is false. These codes are returned to callers and exposed in API responses
 * so that clients can distinguish a hard lock from a validation error.
 */
export const FNO_PAPER_V2_DISABLED_CODE = "FNO_PAPER_V2_DISABLED" as const;
export const SWING_PAPER_V2_DISABLED_CODE = "SWING_PAPER_V2_DISABLED" as const;

export type V2DisabledCode =
  | typeof FNO_PAPER_V2_DISABLED_CODE
  | typeof SWING_PAPER_V2_DISABLED_CODE;

/**
 * Locked-state descriptor returned to API callers and the UI.
 */
export interface V2LockStatus {
  fnoV2Authorized: boolean;
  swingV2Authorized: boolean;
  fnoV2DisabledReason: string;
  swingV2DisabledReason: string;
  fnoV2DisabledCode: typeof FNO_PAPER_V2_DISABLED_CODE;
  swingV2DisabledCode: typeof SWING_PAPER_V2_DISABLED_CODE;
}

/** Returns the current lock status without any DB or env lookups. */
export function getV2LockStatus(): V2LockStatus {
  return {
    fnoV2Authorized: FNO_PAPER_V2_RUNTIME_AUTHORIZED,
    swingV2Authorized: SWING_PAPER_V2_RUNTIME_AUTHORIZED,
    fnoV2DisabledReason:
      "Awaiting ≥130 trading days of real option-premium capture data and frozen-protocol F&O requalification (Pack 9 Gate 6 verdict).",
    swingV2DisabledReason:
      "Awaiting swing qualification and separate owner activation decision.",
    fnoV2DisabledCode: FNO_PAPER_V2_DISABLED_CODE,
    swingV2DisabledCode: SWING_PAPER_V2_DISABLED_CODE,
  };
}
