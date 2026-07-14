/**
 * Backtest Lab — canonical IST/UTC time handling.
 *
 * CONVENTION: every candle `t` Date encodes the IST WALL CLOCK in its UTC fields
 * (e.g. 09:15 IST is stored as the instant `09:15:00Z`). See `candleSource.ts`.
 * That keeps day/minute/session maths trivial and timezone-stable internally
 * (`getUTCHours()` reads the IST clock directly).
 *
 * But anything we PERSIST or EMIT to a client must be an HONEST timestamp. The
 * raw `.toISOString()` of a wall-clock-in-UTC Date is a LIE — it stamps `...Z`
 * onto a value that is really IST, so a consumer that formats it in
 * `Asia/Kolkata` double-applies the +05:30 offset (a 13:30 IST candle then
 * renders as 19:00). This module is the single boundary that converts the
 * internal convention into:
 *   - a TRUE UTC instant ISO (`candleUtcIso`)   — format in any tz correctly,
 *   - an explicit IST wall-clock ISO (`candleIstIso`) — self-describing label,
 *   - a session-validity flag (`isSessionValid`) — honest "in NSE hours?" audit.
 */

/** IST is UTC+05:30 — no DST. */
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
export const IST_OFFSET_MIN = 330;

/** NSE equity/index regular session, as IST minutes-of-day. */
export const SESSION_OPEN_MIN = 9 * 60 + 15; // 09:15 IST
export const SESSION_CLOSE_MIN = 15 * 60 + 30; // 15:30 IST

/** IST minute-of-day, read straight off the wall-clock-in-UTC convention. */
export function istMinuteOfDay(t: Date): number {
  return t.getUTCHours() * 60 + t.getUTCMinutes();
}

/**
 * TRUE UTC instant (ISO) for a wall-clock-IST candle Date. Subtracts the IST
 * offset so the returned `...Z` is genuine UTC; formatting it in `Asia/Kolkata`
 * reproduces the original IST clock exactly (no double conversion).
 */
export function candleUtcIso(t: Date): string {
  return new Date(t.getTime() - IST_OFFSET_MS).toISOString();
}

/** Explicit IST wall-clock ISO, e.g. "2024-06-05T13:30:00+05:30". */
export function candleIstIso(t: Date): string {
  const y = t.getUTCFullYear();
  const mo = String(t.getUTCMonth() + 1).padStart(2, "0");
  const d = String(t.getUTCDate()).padStart(2, "0");
  const hh = String(t.getUTCHours()).padStart(2, "0");
  const mm = String(t.getUTCMinutes()).padStart(2, "0");
  const ss = String(t.getUTCSeconds()).padStart(2, "0");
  return `${y}-${mo}-${d}T${hh}:${mm}:${ss}+05:30`;
}

/**
 * Whether a candle's IST clock falls inside the regular NSE session window
 * [09:15, 15:30]. Used as a defensive audit on emitted trades — a correct
 * intraday backtest should never produce an entry/exit outside these hours
 * (the bug this guards against rendered real 13:30 IST bars as "07:00 pm").
 *
 * Deliberately TIME-OF-DAY only: weekday is NOT enforced, because NSE runs
 * occasional legitimate weekend sessions (e.g. the Union-Budget special live
 * session on Sat 2025-02-01), which are present in the real candle history.
 */
export function isSessionValid(t: Date): boolean {
  const m = istMinuteOfDay(t);
  return m >= SESSION_OPEN_MIN && m <= SESSION_CLOSE_MIN;
}

/**
 * Session-validity for an already-emitted TRUE-UTC ISO instant (the inverse of
 * `candleUtcIso`): re-derive the IST clock and weekday from the real instant.
 * Returns false for unparseable input so callers fail loud, not silent.
 */
export function isSessionValidUtcIso(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return false;
  return isSessionValid(new Date(ms + IST_OFFSET_MS));
}
