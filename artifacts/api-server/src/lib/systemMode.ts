/**
 * SystemMode state machine (fix-file BUG-28).
 *
 * Global operating mode ∈ {NORMAL, DEGRADED, READ_ONLY, HALT}:
 *   NORMAL     — everything runs.
 *   DEGRADED   — existing positions managed, NO new auto-opens.
 *   READ_ONLY  — no trades at all; tabs still display last known data.
 *   HALT       — everything paused (manual emergency latch).
 *
 * Derivation (pure, unit-tested):
 *   - Kite session invalid                       → READ_ONLY
 *   - WS feed down > 30s during market hours     → DEGRADED
 *   - DB health-check failed or latency > 500ms  → DEGRADED
 * Effective mode = worst of (derived, manual override). Manual override is
 * persisted in app_state (`system_mode_override`) so it survives restarts.
 *
 * Enforcement: `paperAutoTradeFlag.isPaperAutoTradingEnabled()` reads the
 * cached effective mode and refuses new auto-opens unless NORMAL. Manual
 * user-driven closes are never gated. Transitions alert the owner (Telegram).
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { getKiteReadiness } from "./kiteReadiness";
import { getAppState, setAppState, deleteAppState } from "./appStateStore";
import { alertOwner } from "./alerting";
import { logger } from "./logger";
import {
  SYSTEM_MODES,
  SYSTEM_MODE_RANK,
  setCachedSystemMode,
  type SystemMode,
} from "./systemModeCache";

export type { SystemMode };
export { SYSTEM_MODES };

export const WS_DOWN_DEGRADE_MS = 30_000;
export const DB_LATENCY_DEGRADE_MS = 500;
export const MODE_TICK_MS = 10_000;
const OVERRIDE_KEY = "system_mode_override";

export interface SystemModeInputs {
  sessionValid: boolean;
  feedConnected: boolean;
  feedDisconnectedForMs: number;
  marketSession: "open" | "closed" | "pre_open";
  dbLatencyMs: number | null; // null = health check failed
}

export interface SystemModeSnapshot {
  derived: SystemMode;
  override: SystemMode | null;
  effective: SystemMode;
  drivers: string[];
  dbLatencyMs: number | null;
  checkedAt: string;
  autoOpensAllowed: boolean;
}

/** PURE — first-principles derivation per the fix-file transition table. */
export function deriveSystemMode(i: SystemModeInputs): { mode: SystemMode; drivers: string[] } {
  const drivers: string[] = [];
  let mode: SystemMode = "NORMAL";
  const bump = (m: SystemMode, driver: string) => {
    drivers.push(driver);
    if (SYSTEM_MODE_RANK[m] > SYSTEM_MODE_RANK[mode]) mode = m;
  };
  if (!i.sessionValid) {
    bump("READ_ONLY", "KITE_SESSION_INVALID");
  } else if (i.marketSession === "open" && !i.feedConnected && i.feedDisconnectedForMs > WS_DOWN_DEGRADE_MS) {
    bump("DEGRADED", `KITE_WS_DOWN_${Math.round(i.feedDisconnectedForMs / 1000)}S`);
  }
  if (i.dbLatencyMs === null) {
    bump("DEGRADED", "DB_HEALTH_CHECK_FAILED");
  } else if (i.dbLatencyMs > DB_LATENCY_DEGRADE_MS) {
    bump("DEGRADED", `DB_LATENCY_${i.dbLatencyMs}MS`);
  }
  return { mode, drivers };
}

/** PURE — worst-of combination of derived mode and manual override. */
export function combineWithOverride(derived: SystemMode, override: SystemMode | null): SystemMode {
  if (override === null) return derived;
  return SYSTEM_MODE_RANK[override] >= SYSTEM_MODE_RANK[derived] ? override : derived;
}

export function isValidSystemMode(v: unknown): v is SystemMode {
  return typeof v === "string" && (SYSTEM_MODES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Monitor loop (module state)
// ---------------------------------------------------------------------------

let lastFeedConnectedAt = Date.now();
let lastSnapshot: SystemModeSnapshot | null = null;
let timer: NodeJS.Timeout | null = null;

async function measureDbLatencyMs(): Promise<number | null> {
  const t0 = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    return Date.now() - t0;
  } catch {
    return null;
  }
}

export async function getSystemModeOverride(): Promise<SystemMode | null> {
  const raw = await getAppState(OVERRIDE_KEY);
  return isValidSystemMode(raw) ? raw : null;
}

export async function setSystemModeOverride(mode: SystemMode | null): Promise<void> {
  if (mode === null) {
    await deleteAppState(OVERRIDE_KEY);
  } else {
    await setAppState(OVERRIDE_KEY, mode);
  }
  await runSystemModeTick(); // apply immediately, don't wait for next tick
}

export async function runSystemModeTick(): Promise<SystemModeSnapshot> {
  const [readiness, dbLatencyMs, override] = await Promise.all([
    getKiteReadiness(),
    measureDbLatencyMs(),
    getSystemModeOverride(),
  ]);
  const now = Date.now();
  if (readiness.feedConnected) lastFeedConnectedAt = now;

  const { mode: derived, drivers } = deriveSystemMode({
    sessionValid: readiness.sessionValid,
    feedConnected: readiness.feedConnected,
    feedDisconnectedForMs: now - lastFeedConnectedAt,
    marketSession: readiness.marketSession,
    dbLatencyMs,
  });
  if (override !== null) drivers.push(`MANUAL_OVERRIDE_${override}`);
  const effective = combineWithOverride(derived, override);

  const prev = lastSnapshot?.effective ?? null;
  const snapshot: SystemModeSnapshot = {
    derived,
    override,
    effective,
    drivers,
    dbLatencyMs,
    checkedAt: new Date().toISOString(),
    autoOpensAllowed: effective === "NORMAL",
  };
  lastSnapshot = snapshot;
  setCachedSystemMode(effective);

  if (prev !== null && prev !== effective) {
    const msg = `SystemMode ${prev} → ${effective} (drivers: ${drivers.join(", ") || "none"})`;
    logger.warn({ prev, effective, drivers }, "system mode transition");
    alertOwner(
      "SYSTEM_MODE_CHANGED",
      msg,
      undefined,
      5 * 60_000,
      `SYSTEM_MODE_CHANGED::${prev}->${effective}`,
    );
  }
  return snapshot;
}

export function getSystemModeSnapshot(): SystemModeSnapshot | null {
  return lastSnapshot;
}

export function startSystemModeMonitor(): void {
  if (timer) return;
  void runSystemModeTick().catch((err) =>
    logger.warn({ err: (err as Error).message }, "system-mode tick failed"),
  );
  timer = setInterval(() => {
    void runSystemModeTick().catch((err) =>
      logger.warn({ err: (err as Error).message }, "system-mode tick failed"),
    );
  }, MODE_TICK_MS);
  timer.unref?.();
  logger.info({ tickMs: MODE_TICK_MS }, "system-mode monitor started (BUG-28)");
}
