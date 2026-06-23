import { logger } from "./logger";
import { getKiteReadiness } from "./kiteReadiness";

/**
 * Pre-open Kite reconnect safeguard.
 *
 * VISIBILITY ONLY: this scheduler never logs the owner in, never places an
 * order, and never changes any trading decision. It simply emits an escalating
 * log if the Kite session is offline as the market open approaches, so the
 * operator gets a heads-up instead of silently missing the session.
 *
 * Cadence: a 5-minute interval, IST-gated to the 08:40–09:20 window. Per-IST-day
 * latches keep each level to a single log per day across the 5-min ticks.
 * Single-replica assumption (latches live in-process), matching the other
 * schedulers in this service.
 */

const TICK_MS = 5 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

let started = false;
let inFlight = false;
let warnLoggedDay: string | null = null;
let errorLoggedDay: string | null = null;

function istDayKey(now: Date): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function istMinutes(now: Date): number {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

/**
 * One readiness check. Exported for tests + reuse. No-op outside the
 * 08:40–09:20 IST window, and re-entrancy guarded so a slow check never
 * overlaps the next tick.
 */
export async function runKiteReadinessCheckOnce(now: Date = new Date()): Promise<void> {
  const mins = istMinutes(now);
  if (mins < 8 * 60 + 40 || mins > 9 * 60 + 20) return;
  if (inFlight) return;
  inFlight = true;
  try {
    const r = await getKiteReadiness();
    const day = istDayKey(now);
    // Only the trading-day critical-offline states are gated here; on weekends
    // and holidays the readiness state is KITE_EXPIRED (not critical), so no
    // spurious pre-open alarm fires.
    const criticallyOffline =
      r.state === "KITE_OFFLINE_PREOPEN" || r.state === "KITE_OFFLINE_MARKET_HOURS";

    if (mins >= 8 * 60 + 45 && criticallyOffline && warnLoggedDay !== day) {
      warnLoggedDay = day;
      logger.warn(
        { state: r.state, expiresAt: r.expiresAt, kiteOfflineSince: r.kiteOfflineSince },
        "Kite offline approaching market open — reconnect required (visit Live Feed → Reconnect)",
      );
    }
    if (mins >= 9 * 60 + 5 && criticallyOffline && errorLoggedDay !== day) {
      errorLoggedDay = day;
      logger.error(
        { state: r.state, expiresAt: r.expiresAt, kiteOfflineSince: r.kiteOfflineSince },
        "Kite STILL offline near market open — live data will be unavailable until reconnect",
      );
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "kite readiness scheduler tick failed (fail-open)");
  } finally {
    inFlight = false;
  }
}

/** Idempotent. Starts the 5-min interval (unref'd so it never blocks exit). */
export function startKiteReadinessScheduler(): void {
  if (started) return;
  started = true;
  const t = setInterval(() => {
    void runKiteReadinessCheckOnce();
  }, TICK_MS);
  t.unref?.();
  logger.info({ tickMs: TICK_MS }, "kite readiness scheduler started (pre-open safeguard 08:40–09:20 IST)");
}
