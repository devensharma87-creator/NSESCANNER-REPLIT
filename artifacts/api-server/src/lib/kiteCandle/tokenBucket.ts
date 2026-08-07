/**
 * Token-bucket rate limiter for the Kite Historical Data API.
 *
 * Problem with the prior approach (6 concurrent + 2-second pause):
 *   Six requests are released simultaneously. All 6 fire within ~100 ms,
 *   which is a burst of 60 req/s — violating the 3 req/s rolling limit —
 *   before the 2-second pause begins. The 2-second pause reduces the
 *   AVERAGE rate, but does not bound the INSTANTANEOUS rate.
 *
 * Solution — token-bucket with rolling enforcement:
 *   Tokens refill at REFILL_RATE_PER_SEC tokens/second, up to CAPACITY.
 *   Each API call must acquire() one token before dispatching. If no token
 *   is available, the acquire() call sleeps until refill produces enough.
 *   This guarantees the rolling rate never exceeds REFILL_RATE_PER_SEC
 *   requests/second regardless of concurrency.
 *
 * 429 handling:
 *   reportRateLimit() drains the bucket, waits Retry-After + jitter, and
 *   logs diagnostics. The caller should retry after this returns.
 *
 * Metrics captured per refresh cycle:
 *   - requestCount        total Kite historical API calls attempted
 *   - rate429Count        HTTP 429 responses received
 *   - retryCount          total retry attempts (≥ rate429Count)
 *   - maxObservedRollingRps  peak req/s measured over any 1-second window
 *   - currentTokens       remaining bucket fill (snapshot at call time)
 */

import { logger } from "../logger";

// ─── Config ──────────────────────────────────────────────────────────────────

/** Kite's documented historical-data rate limit (requests per second per account). */
const REFILL_RATE_PER_SEC = 3;

/**
 * Bucket capacity = 1 second worth of tokens.
 *
 * With CAPACITY=3 and 6 concurrent workers, the first 3 workers dispatch
 * immediately; the next 3 wait ~333 ms for the next token. After that,
 * each token arrives every 333 ms. Effective rate is exactly 3 req/s.
 *
 * A higher capacity (e.g. 6) would allow a 6-request burst up front. We
 * keep it at 3 (one second's worth) so we never exceed 3 req/s even in
 * a cold-start burst.
 */
const CAPACITY = 3;

/** Rolling window for max-RPS measurement. */
const WINDOW_MS = 1_000;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TokenBucketMetrics {
  requestCount: number;
  rate429Count: number;
  retryCount: number;
  /** Peak req/s observed over any 1-second window in this cycle. */
  maxObservedRollingRps: number;
  /** Current fill level (0.0 – CAPACITY). Snapshot at call time. */
  currentTokens: number;
}

// ─── Implementation ───────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class KiteHistoricalTokenBucket {
  private tokens: number;
  private lastRefillMs: number;
  private readonly capacityTokens: number;
  private readonly refillPerMs: number; // tokens / ms

  // Metrics
  private _requestCount = 0;
  private _rate429Count = 0;
  private _retryCount = 0;
  private _maxObservedRps = 0;
  private _windowStart = Date.now();
  private _windowCount = 0;

  constructor(
    capacityTokens = CAPACITY,
    refillRatePerSec = REFILL_RATE_PER_SEC,
  ) {
    this.capacityTokens = capacityTokens;
    this.refillPerMs = refillRatePerSec / 1_000;
    this.tokens = capacityTokens; // start full — permits immediate initial requests
    this.lastRefillMs = Date.now();
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  /** Refill tokens proportional to elapsed wall-clock time. */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillMs;
    this.tokens = Math.min(
      this.capacityTokens,
      this.tokens + elapsed * this.refillPerMs,
    );
    this.lastRefillMs = now;
  }

  /** Track requests within a sliding 1-second window and update peak RPS. */
  private recordRequest(): void {
    const now = Date.now();
    if (now - this._windowStart >= WINDOW_MS) {
      const elapsed = (now - this._windowStart) / 1_000;
      const rps = elapsed > 0 ? this._windowCount / elapsed : 0;
      if (rps > this._maxObservedRps) this._maxObservedRps = rps;
      this._windowStart = now;
      this._windowCount = 0;
    }
    this._windowCount++;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Acquire a token before dispatching one Kite Historical API request.
   * Blocks (awaits sleep) until a token is available. This is the sole
   * rate-enforcement point — all workers must call this before every request.
   */
  async acquire(): Promise<void> {
    while (true) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        this._requestCount++;
        this.recordRequest();
        return;
      }
      // Wait precisely until the next token arrives (ceil to avoid busy-loop).
      const waitMs = Math.ceil((1 - this.tokens) / this.refillPerMs);
      await sleep(waitMs);
    }
  }

  /**
   * Report a 429 rate-limit response from Kite.
   *
   * Actions:
   *   1. Increment 429 and retry counters.
   *   2. Drain the token bucket so other in-flight workers also back off.
   *   3. Sleep for Retry-After + jitter to avoid thundering herd on retry.
   *
   * The caller should retry the request after this promise resolves.
   *
   * @param retryAfterSec  Value from the Retry-After response header (default 5).
   */
  async reportRateLimit(retryAfterSec = 5): Promise<void> {
    this._rate429Count++;
    this._retryCount++;
    const jitterMs = Math.floor(Math.random() * 1_000); // 0–999 ms
    const waitMs = retryAfterSec * 1_000 + jitterMs;
    // Drain bucket — forces all workers to wait for refill before next acquire.
    this.tokens = 0;
    logger.warn(
      {
        retryAfterSec,
        jitterMs,
        waitMs,
        rate429Count: this._rate429Count,
        retryCount: this._retryCount,
      },
      "kiteCandleStore: Kite 429 received — bucket drained, backing off",
    );
    await sleep(waitMs);
  }

  /** Current metrics snapshot. */
  get metrics(): TokenBucketMetrics {
    // Finalize the current window before reporting.
    const now = Date.now();
    if (this._windowCount > 0) {
      const elapsed = (now - this._windowStart) / 1_000;
      const rps = elapsed > 0 ? this._windowCount / elapsed : 0;
      if (rps > this._maxObservedRps) this._maxObservedRps = rps;
    }
    return {
      requestCount: this._requestCount,
      rate429Count: this._rate429Count,
      retryCount: this._retryCount,
      maxObservedRollingRps: Math.round(this._maxObservedRps * 100) / 100,
      currentTokens: Math.round(this.tokens * 100) / 100,
    };
  }

  /** Reset all counters — call at the start of each refresh cycle. */
  resetMetrics(): void {
    this._requestCount = 0;
    this._rate429Count = 0;
    this._retryCount = 0;
    this._maxObservedRps = 0;
    this._windowStart = Date.now();
    this._windowCount = 0;
    // Refill tokens — a new cycle starts fresh.
    this.tokens = this.capacityTokens;
    this.lastRefillMs = Date.now();
  }
}

/**
 * Module-level singleton — shared by all background refresh workers.
 * Reset by runKiteCandleRefresh() at the start of each refresh cycle.
 */
export const kiteHistoricalBucket = new KiteHistoricalTokenBucket();
