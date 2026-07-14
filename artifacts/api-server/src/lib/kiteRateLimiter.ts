/**
 * Central Kite REST API quote rate limiter (F-08).
 *
 * Kite allows ≤3 quote requests/sec. Without a shared throttle, parallel
 * callers (index-quotes, option-chain, OI heatmap, scanner) can burst past
 * the limit and receive 429 "Too many requests" errors.
 *
 * Design mirrors the historical-data throttle in kiteIntraday.ts:
 *   - `reserveQuoteSlot()` enqueues the caller, waits for the next available
 *     dispatch window (at most one call per QUOTE_MIN_INTERVAL_MS), then
 *     returns. The caller makes the actual HTTP call AFTER reservation returns.
 *   - `pendingCount` tracks callers currently waiting for a slot (not in-flight
 *     HTTP calls). When the cap is hit we fail-fast so the caller can degrade
 *     gracefully rather than stacking up unbounded waiting promises.
 *
 * Usage:
 *   const ok = await reserveQuoteSlot();
 *   if (!ok) { logger.warn(...); return fallback; }
 *   const data = await kc.getQuote(symbols); // HTTP call outside the slot
 */

const QUOTE_MIN_INTERVAL_MS = 334; // ≈ 3 req/s with headroom under Kite's limit
const QUOTE_MAX_PENDING     = 10;  // fail-fast above this queue depth

let quoteNextSlotAt  = 0;
let quotePendingCount = 0;

/**
 * Reserve a quote dispatch slot. Waits until the per-second budget allows
 * another call (at most 3/s). Returns true when the caller may proceed with
 * `kc.getQuote()`; returns false when the queue is full (caller must degrade).
 */
export async function reserveQuoteSlot(): Promise<boolean> {
  if (quotePendingCount >= QUOTE_MAX_PENDING) return false;
  quotePendingCount++;
  try {
    const now  = Date.now();
    const slot = Math.max(now, quoteNextSlotAt);
    quoteNextSlotAt = slot + QUOTE_MIN_INTERVAL_MS;
    const wait = slot - now;
    if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait));
    return true;
  } finally {
    quotePendingCount--;
  }
}

/** Snapshot of the current quote throttle counters for diagnostics. */
export function getQuoteThrottleStats(): {
  pendingCount: number;
  maxPending: number;
  minIntervalMs: number;
} {
  return {
    pendingCount: quotePendingCount,
    maxPending: QUOTE_MAX_PENDING,
    minIntervalMs: QUOTE_MIN_INTERVAL_MS,
  };
}

// ── Test-only helpers (prefix _ signals internal/test use) ───────────────────

/** Reset throttle state to pristine. Called in test beforeEach. */
export function _resetQuoteThrottleForTest(): void {
  quoteNextSlotAt  = 0;
  quotePendingCount = 0;
}

/** Artificially fill the pending count to trigger fail-fast. Test use only. */
export function _setQuotePendingCountForTest(n: number): void {
  quotePendingCount = n;
}
