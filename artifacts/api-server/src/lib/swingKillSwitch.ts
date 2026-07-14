/**
 * Swing CASH Live-Readiness — Phase 2 kill-switch (conservative stub).
 *
 * When the kill switch is ENABLED:
 *   - no new staged orders may be created,
 *   - no approvals may proceed,
 *   - no dry-run placements may occur.
 *
 * Persisted in the generic `app_state` kv table (key `swing_kill_switch`) so it
 * survives restarts, with a tiny in-memory cache to keep the hot path cheap.
 * Default is DISABLED (enabled=false ⇒ trading workflow allowed). On any DB
 * read error we FAIL CLOSED (treat as enabled) so a storage outage can never
 * silently open the staging lane.
 *
 * This is a stub: it does not yet talk to any real broker kill mechanism (broker
 * execution is hard-disabled). The interface is shaped so a future real wiring
 * is additive.
 */

import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { appStateTable } from "@workspace/db/schema";

const KEY = "swing_kill_switch";

export interface SwingKillSwitchState {
  enabled: boolean;
  reason: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

const DEFAULT_STATE: SwingKillSwitchState = {
  enabled: false,
  reason: null,
  updatedAt: null,
  updatedBy: null,
};

let cache: SwingKillSwitchState | null = null;

function parse(value: string): SwingKillSwitchState {
  try {
    const o = JSON.parse(value) as Partial<SwingKillSwitchState>;
    return {
      enabled: o.enabled === true,
      reason: typeof o.reason === "string" ? o.reason : null,
      updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : null,
      updatedBy: typeof o.updatedBy === "string" ? o.updatedBy : null,
    };
  } catch {
    // Corrupt value — fail closed.
    return { enabled: true, reason: "kill_switch_state_corrupt", updatedAt: null, updatedBy: null };
  }
}

/** Read the current kill-switch state. Fails CLOSED (enabled) on any DB error. */
export async function getKillSwitch(): Promise<SwingKillSwitchState> {
  if (cache) return cache;
  try {
    const [row] = await db
      .select({ value: appStateTable.value })
      .from(appStateTable)
      .where(eq(appStateTable.key, KEY))
      .limit(1);
    cache = row ? parse(row.value) : { ...DEFAULT_STATE };
    return cache;
  } catch {
    // Storage outage must never open the lane.
    return { enabled: true, reason: "kill_switch_unavailable", updatedAt: null, updatedBy: null };
  }
}

/** True when staging/approval/dry-run must be blocked. Fails CLOSED. */
export async function isKillSwitchActive(): Promise<boolean> {
  return (await getKillSwitch()).enabled;
}

/** Owner-only setter. Persists + refreshes the in-memory cache. */
export async function setKillSwitch(
  enabled: boolean,
  reason: string | null,
  updatedBy: string | null,
): Promise<SwingKillSwitchState> {
  const state: SwingKillSwitchState = {
    enabled,
    reason: reason && reason.trim().length > 0 ? reason.trim().slice(0, 300) : null,
    updatedAt: new Date().toISOString(),
    updatedBy: updatedBy && updatedBy.trim().length > 0 ? updatedBy.trim().slice(0, 80) : null,
  };
  const value = JSON.stringify(state);
  await db
    .insert(appStateTable)
    .values({ key: KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appStateTable.key, set: { value, updatedAt: new Date() } });
  cache = state;
  return state;
}

/** Test-only: drop the in-memory cache so the next read hits the DB. */
export function __resetKillSwitchCacheForTests(): void {
  cache = null;
}
