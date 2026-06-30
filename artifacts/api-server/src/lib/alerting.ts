/**
 * Owner-alert stub — Phase 1: structured WARN log with 1-hour in-memory dedup.
 * Telegram / webhook delivery is Phase 2 (see TODO below).
 *
 * Wire ONLY at cycle boundaries, never on per-tick hot paths.
 * NEVER log secrets, session tokens, or user data here.
 */
import { logger } from "./logger";

/** Dedup window: at most one alert per event per hour (process-local). */
const DEDUP_WINDOW_MS = 60 * 60 * 1000;

/** Track last-alert epoch-ms per event key. Resets on process restart. */
const lastAlerted = new Map<string, number>();

/**
 * Fire an owner alert for `event` at most once per `DEDUP_WINDOW_MS`.
 *
 * `event` must be a stable SCREAMING_SNAKE_CASE identifier so dedup works
 * across repeated cycles (e.g. "FNO_KITE_SESSION_MISSING").
 * `message` is the human-readable payload logged at WARN level.
 *
 * Phase 2 TODO — Telegram delivery:
 *   POST https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage
 *   { chat_id: TELEGRAM_CHAT_ID, text: `[ALERT] ${event}\n${message}` }
 * Add TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID as Replit secrets (never hardcode).
 * Call AFTER the log.warn so a Telegram failure does not suppress the log entry.
 */
export function alertOwner(event: string, message: string): void {
  const now = Date.now();
  const lastAt = lastAlerted.get(event) ?? 0;
  if (now - lastAt < DEDUP_WINDOW_MS) return; // within dedup window — skip
  lastAlerted.set(event, now);
  logger.warn({ alertEvent: event }, `OWNER_ALERT [${event}]: ${message}`);
  // Phase 2: await sendTelegram(event, message);
}

/** Reset dedup state for `event` (useful in tests). */
export function resetAlertDedup(event?: string): void {
  if (event) lastAlerted.delete(event);
  else lastAlerted.clear();
}
