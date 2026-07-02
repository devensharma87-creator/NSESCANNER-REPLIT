import { logger } from "./logger";
import { getKiteReadiness } from "./kiteReadiness";
import { alertOwnerRaw } from "./alerting";

/**
 * Pre-open Kite reconnect safeguard — logs + Telegram alert edition.
 *
 * VISIBILITY ONLY: this scheduler never logs the owner in, never places an
 * order, and never changes any trading decision. It emits an escalating log
 * AND a Telegram alert if the Kite session is offline as the market open
 * approaches, so the operator gets a heads-up instead of silently missing
 * the session.
 *
 * Cadence: a 5-minute interval, IST-gated to the 08:40–09:20 window. Per-IST-day
 * latches keep each log level to a single emission per day across the 5-min
 * ticks.  Telegram alerts use alertOwnerRaw() with per-IST-day dedup keys so
 * at most one Telegram message per scenario per calendar day is sent.
 * Single-replica assumption (latches live in-process), matching the other
 * schedulers in this service.
 *
 * Alert dedup keys (per-IST-day, 1-hour window in alertOwnerRaw):
 *   KITE_SESSION_MISSING_PREOPEN::YYYY-MM-DD  — no session configured
 *   KITE_SESSION_EXPIRED_PREOPEN::YYYY-MM-DD  — session present but expired
 *   KITE_FEED_DISCONNECTED_PREOPEN::YYYY-MM-DD — session valid, feed stopped
 */

const TICK_MS = 5 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Custom dedup window for pre-open alerts: 1 h (sufficient to avoid duplicate
 *  5-min-tick repeats within the 40-min window, while the per-day key scope
 *  already ensures at most one alert per calendar-IST day). */
const PREOPEN_ALERT_DEDUP_MS = 60 * 60 * 1000;

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

// ── Alert builders (pure text, no secrets) ────────────────────────────────────

function buildMissingSessionAlert(day: string): string {
  return [
    "🚨 KITE PRE-OPEN ACTION REQUIRED",
    "",
    "Kite session is missing (no API credentials / session configured).",
    "F&O signals, Scanner, Paper Trading, and live data will not be",
    "trade-grade until the session is reconnected.",
    "",
    `IST date: ${day}`,
    "",
    "Action: Open the Kite Login page and configure / reconnect before market open.",
  ].join("\n");
}

function buildExpiredSessionAlert(day: string): string {
  return [
    "🚨 KITE PRE-OPEN ACTION REQUIRED",
    "",
    "Kite session has expired.",
    "F&O signals, Scanner, Paper Trading, and live data will not be",
    "trade-grade until the daily Zerodha reconnect is completed.",
    "",
    `IST date: ${day}`,
    "",
    "Action: Open the Kite Login page and reconnect before market open.",
  ].join("\n");
}

function buildFeedDisconnectedAlert(day: string): string {
  return [
    "⚠️ KITE DATA PARTIAL — PRE-OPEN WINDOW",
    "",
    "Kite session is valid but the live WebSocket feed has disconnected.",
    "Affected modules may show delayed data until the feed reconnects.",
    "",
    `IST date: ${day}`,
    "",
    "Action: Monitor Infra Health (/infra-health) for warmup / feed status.",
  ].join("\n");
}

// ── Core tick logic ───────────────────────────────────────────────────────────

/**
 * One readiness check. Exported for tests + reuse. No-op outside the
 * 08:40–09:20 IST window, and re-entrancy guarded so a slow check never
 * overlaps the next tick.
 *
 * Escalation ladder:
 *   08:45 IST — WARN log + Telegram alert (if offline)
 *   09:05 IST — ERROR log + Telegram alert (if still offline; separate key)
 *
 * Telegram alert dedup: per-IST-day key via alertOwnerRaw, 1-hour window.
 * Feed-disconnected partial state fires a separate lower-severity alert.
 */
export async function runKiteReadinessCheckOnce(now: Date = new Date()): Promise<void> {
  const mins = istMinutes(now);
  if (mins < 8 * 60 + 40 || mins > 9 * 60 + 20) return;
  if (inFlight) return;
  inFlight = true;
  try {
    const r = await getKiteReadiness();
    const day = istDayKey(now);

    // Critical offline: no session or session expired going into market open.
    const criticallyOffline =
      r.state === "KITE_OFFLINE_PREOPEN" || r.state === "KITE_OFFLINE_MARKET_HOURS";

    if (mins >= 8 * 60 + 45 && criticallyOffline && warnLoggedDay !== day) {
      warnLoggedDay = day;
      logger.warn(
        { state: r.state, expiresAt: r.expiresAt, kiteOfflineSince: r.kiteOfflineSince },
        "Kite offline approaching market open — reconnect required (visit Live Feed → Reconnect)",
      );

      // Telegram alert — separate key per session-missing vs expired.
      if (!r.sessionPresent) {
        alertOwnerRaw(
          `KITE_SESSION_MISSING_PREOPEN::${day}`,
          `Kite session missing during pre-open window (${day})`,
          buildMissingSessionAlert(day),
          PREOPEN_ALERT_DEDUP_MS,
        );
      } else {
        alertOwnerRaw(
          `KITE_SESSION_EXPIRED_PREOPEN::${day}`,
          `Kite session expired during pre-open window (${day})`,
          buildExpiredSessionAlert(day),
          PREOPEN_ALERT_DEDUP_MS,
        );
      }
    }

    if (mins >= 9 * 60 + 5 && criticallyOffline && errorLoggedDay !== day) {
      errorLoggedDay = day;
      logger.error(
        { state: r.state, expiresAt: r.expiresAt, kiteOfflineSince: r.kiteOfflineSince },
        "Kite STILL offline near market open — live data will be unavailable until reconnect",
      );
      // Second Telegram alert at 09:05 with a distinct key so the operator
      // gets a final escalation even if the 08:45 alert was already deduped.
      const escalationKey = r.sessionPresent
        ? `KITE_SESSION_EXPIRED_PREOPEN_FINAL::${day}`
        : `KITE_SESSION_MISSING_PREOPEN_FINAL::${day}`;
      const escalationText = r.sessionPresent
        ? buildExpiredSessionAlert(day).replace("🚨", "🔴").replace("PRE-OPEN ACTION REQUIRED", "FINAL WARNING — MARKET OPENS IN ~10 MIN")
        : buildMissingSessionAlert(day).replace("🚨", "🔴").replace("PRE-OPEN ACTION REQUIRED", "FINAL WARNING — MARKET OPENS IN ~10 MIN");
      alertOwnerRaw(
        escalationKey,
        `Kite still offline at 09:05 IST — final pre-open escalation (${day})`,
        escalationText,
        PREOPEN_ALERT_DEDUP_MS,
      );
    }

    // Partial: feed disconnected during pre-open (session valid, feed stopped).
    if (r.state === "KITE_CONNECTED_BUT_FEED_STALE" && mins >= 8 * 60 + 45) {
      alertOwnerRaw(
        `KITE_FEED_DISCONNECTED_PREOPEN::${day}`,
        `Kite feed disconnected during pre-open window (${day})`,
        buildFeedDisconnectedAlert(day),
        PREOPEN_ALERT_DEDUP_MS,
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
  logger.info(
    { tickMs: TICK_MS },
    "kite readiness scheduler started (pre-open safeguard 08:40–09:20 IST, Telegram alerts enabled)",
  );
}
