/**
 * Trading-day utilities for F&O signal-gap tracking.
 *
 * "Trading day" = Mon–Fri only. No NSE public holiday list is maintained
 * server-side — the count is honest (always Mon–Fri) and intentionally
 * conservative (public holidays are NOT excluded).
 */

/**
 * Count Mon–Fri days strictly between `from` (exclusive) and `to` (inclusive
 * date-portion). Zero-safe: returns 0 when `from >= to` (same day or inverted).
 */
export function countTradingDays(from: Date, to: Date): number {
  let count = 0;
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end    = new Date(to.getFullYear(),   to.getMonth(),   to.getDate());
  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1);
    const day = cursor.getDay(); // 0=Sun, 6=Sat
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}
