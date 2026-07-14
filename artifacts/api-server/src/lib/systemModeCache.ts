/**
 * Tiny dependency-free cache for the effective SystemMode (BUG-28).
 *
 * Written ONLY by the system-mode monitor loop in `systemMode.ts`; read by
 * low-level gates (e.g. `paperAutoTradeFlag`) that must not import the heavy
 * derivation stack (avoids circular imports). Defaults to "NORMAL" so that
 * boot / test behavior is unchanged until the monitor produces a verdict.
 */

export type SystemMode = "NORMAL" | "DEGRADED" | "READ_ONLY" | "HALT";

export const SYSTEM_MODES: readonly SystemMode[] = ["NORMAL", "DEGRADED", "READ_ONLY", "HALT"];

export const SYSTEM_MODE_RANK: Record<SystemMode, number> = {
  NORMAL: 0,
  DEGRADED: 1,
  READ_ONLY: 2,
  HALT: 3,
};

let cachedMode: SystemMode = "NORMAL";

export function getCachedSystemMode(): SystemMode {
  return cachedMode;
}

export function setCachedSystemMode(mode: SystemMode): void {
  cachedMode = mode;
}
