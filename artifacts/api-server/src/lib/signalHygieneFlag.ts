/**
 * Feature flag for the 2026-06-09 F&O signal-hygiene changes.
 *
 * Bundles three behaviour changes behind a single switch so the whole
 * set can be rolled back instantly without a code change:
 *
 *   1. BASELINE-tier signals become strictly INFO_ONLY — the paper
 *      auto-trader refuses to open them (see paperTradingFO.openPaperTrade).
 *   2. The two new directional vetoes (RECOVERY_MODE_VETO / CHASE_RISK_VETO)
 *      are evaluated and used to demote setups to INFO_ONLY.
 *   3. The daily circuit breaker counts ACTUAL executed paper-trade stops
 *      (CLOSED paper_trade_fo, exit_reason STOPPED) instead of modeled
 *      signal-history STOPPED rows.
 *
 * Resolution:
 *   - `FNO_SIGNAL_HYGIENE_V2` set explicitly → use it
 *     ("1"/"true"/"yes"/"on" → ON, "0"/"false"/"no"/"off" → OFF).
 *   - Unrecognised value → ON (default toward the safer new behaviour).
 *   - Unset → ON.
 *
 * To roll back in production, set `FNO_SIGNAL_HYGIENE_V2=0` and restart
 * the worker. Evaluated on every call (not memoised) so the flag can be
 * flipped at runtime by editing the env and restarting only the worker.
 */

const TRUTHY = new Set(["1", "true", "yes", "on"]);
const FALSY = new Set(["0", "false", "no", "off"]);

export function isSignalHygieneV2Enabled(): boolean {
  const raw = process.env.FNO_SIGNAL_HYGIENE_V2;
  if (raw != null && raw.length > 0) {
    const v = raw.trim().toLowerCase();
    if (TRUTHY.has(v)) return true;
    if (FALSY.has(v)) return false;
    // Unrecognised — default ON (the new behaviour blocks bad trades, so
    // failing toward it is the conservative choice).
    return true;
  }
  return true;
}
