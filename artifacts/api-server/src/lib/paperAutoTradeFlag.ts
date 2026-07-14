/**
 * Centralised "is the auto-trader allowed to open new paper trades right
 * now?" check. Used to keep dev/preview environments read-only by default
 * so they don't fight production for trade history.
 *
 * Resolution order:
 *   1. If `PAPER_TRADING_ENABLED` is set explicitly, use that
 *      ("1" / "true" / "yes" / "on", case-insensitive → enabled).
 *   2. Otherwise auto-detect: enabled iff running inside a Replit
 *      deployment (`REPLIT_DEPLOYMENT === "1"`). Dev / Workspace
 *      preview defaults to read-only.
 *
 * The check is intentionally evaluated on every call (not memoised) so
 * an operator can flip the flag at runtime by editing secrets and
 * restarting only the worker — no rebuild needed.
 *
 * Manual user-driven actions (`POST /paper/positions/eq/manual`,
 * `POST /paper/positions/*\/:id/close`, etc.) are NOT gated by this
 * flag — they remain available in dev so the owner can inspect /
 * exercise the UI without touching production data.
 */

const TRUTHY = new Set(["1", "true", "yes", "on"]);
const FALSY = new Set(["0", "false", "no", "off"]);

import { getCachedSystemMode } from "./systemModeCache";

export function isPaperAutoTradingEnabled(): boolean {
  // BUG-28 SystemMode gate: new auto-opens require NORMAL. The cache defaults
  // to NORMAL until the monitor produces a verdict, so boot/test behavior is
  // unchanged. Manual user-driven actions are NOT routed through this flag.
  if (getCachedSystemMode() !== "NORMAL") return false;
  const raw = process.env.PAPER_TRADING_ENABLED;
  if (raw != null && raw.length > 0) {
    const v = raw.trim().toLowerCase();
    if (TRUTHY.has(v)) return true;
    if (FALSY.has(v)) return false;
    // Unrecognised value — fail closed (safer than opening trades).
    return false;
  }
  return process.env.REPLIT_DEPLOYMENT === "1";
}

/**
 * Human-friendly environment label for diagnostics / banners. Never
 * leaks secrets. Only safe identifiers (`production` / `development`)
 * and the Replit deployment domain (already public).
 */
export function getEnvironmentLabel(): {
  env: "production" | "development";
  autoTradingEnabled: boolean;
  reason: string;
} {
  const enabled = isPaperAutoTradingEnabled();
  const isDeployment = process.env.REPLIT_DEPLOYMENT === "1";
  const flagSet = process.env.PAPER_TRADING_ENABLED != null
    && process.env.PAPER_TRADING_ENABLED.length > 0;
  const env: "production" | "development" = isDeployment ? "production" : "development";
  const mode = getCachedSystemMode();
  let reason: string;
  if (mode !== "NORMAL") {
    reason = `SystemMode=${mode} — auto-opens suspended until NORMAL (BUG-28 gate)`;
  } else if (flagSet) {
    reason = enabled
      ? "PAPER_TRADING_ENABLED override is set to a truthy value"
      : "PAPER_TRADING_ENABLED override is set to a falsy value";
  } else {
    reason = isDeployment
      ? "Auto-detected: REPLIT_DEPLOYMENT=1 (live deployment)"
      : "Auto-detected: not a deployment (Replit Workspace / dev preview)";
  }
  return { env, autoTradingEnabled: enabled, reason };
}
