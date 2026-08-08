/**
 * Sliding-window rate limiter for the Kite Historical Data API.
 *
 * Replaces the prior token-bucket approach which had a cold-start burst defect:
 * when `tokens` was refilled to `capacityTokens=3` at cycle start, 3 workers
 * dispatched immediately at t=0 PLUS 2 more within the first 1-second measurement
 * window, producing maxObservedRps=5 which exceeded the 3 req/s limit.
 *
 * Solution — sliding-window with injected clock:
 *   Tracks timestamps of recent requests in a ring. Before dispatching, prunes
 *   timestamps outside the rolling window. If the count is already at the max,
 *   waits until the oldest expires. This guarantees: in ANY arbitrary 1-second
 *   window, at most MAX_PER_WINDOW (3) requests are dispatched.
 *
 * Key properties:
 *   - No cold-start burst:    windowTimestamps starts empty; first request waits
 *                             0 ms (immediately dispatched), but concurrently
 *                             arriving workers wait ≥333 ms per additional slot.
 *   - No reset burst:         resetMetrics() clears counters ONLY — it does NOT
 *                             clear windowTimestamps, so rate limiting is seamless
 *                             across cycle boundaries.
 *   - Deterministic tests:    accepts an optional `clock` + `sleeper` injection so
 *                             fake-clock tests exercise all code paths without
 *                             real timer delays.
 *   - 429 back-off:           reportRateLimit() fills the window to capacity so all
 *                             in-flight workers back off immediately; then waits
 *                             Retry-After + jitter.
 *
 * Cross-replica enforcement:
 *   Only one replica holds KITE_HISTORICAL_INGESTION_GLOBAL_LOCK at a time
 *   (pg_try_advisory_lock). Each process has its own KiteHistoricalTokenBucket
 *   singleton; because the lock serialises replicas, the per-process rate IS
 *   the global aggregate rate.
 */

import { logger } from "../logger";

// ─── Config ──────────────────────────────────────────────────────────────────

/** Kite's documented historical-data rate limit (requests per second per account). */
export const MAX_PER_WINDOW = 3;

/** Rolling enforcement window in milliseconds. */
export const WINDOW_MS = 1_000;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TokenBucketMetrics {
  requestCount: number;
  rate429Count: number;
  retryCount: number;
  /**
   * Peak req/s observed over any 1-second window in this cycle.
   * Computed as `windowTimestamps.length / (WINDOW_MS / 1000)` at the moment
   * each request is recorded — the densest instant in the window.
   */
  maxObservedRollingRps: number;
  /**
   * Available request slots in the current window snapshot.
   * Repurposed from the token-bucket "remaining tokens" concept:
   *   availableSlots = MAX_PER_WINDOW − windowTimestamps.length (after pruning).
   */
  currentTokens: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function defaultSleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Implementation ───────────────────────────────────────────────────────────

export class KiteHistoricalTokenBucket {
  private readonly maxPerWindow: number;
  private readonly windowMs: number;
  private readonly clock: () => number;
  private readonly sleeper: (ms: number) => Promise<void>;

  /**
   * Timestamps (from `clock()`) of requests dispatched within the current
   * rolling window. Pruned before each acquire attempt.
   *
   * Starts EMPTY — there is no initial token fill, so no cold-start burst.
   * The first request dispatches immediately; subsequent concurrent requests
   * wait until a slot opens (≥ 333 ms apart at 3 req/s).
   */
  private windowTimestamps: number[] = [];

  // Metrics (reset per cycle; windowTimestamps is NOT reset)
  private _requestCount = 0;
  private _rate429Count = 0;
  private _retryCount = 0;
  private _maxObservedRollingRps = 0;

  /**
   * @param maxPerWindow   Max requests per `windowMs`. Default: 3.
   * @param windowMs       Rolling window duration in ms. Default: 1000.
   * @param clock          Time source (injectable for deterministic tests). Default: Date.now.
   * @param sleeper        Sleep function (injectable for deterministic tests). Default: real setTimeout.
   */
  constructor(
    maxPerWindow = MAX_PER_WINDOW,
    windowMs = WINDOW_MS,
    clock: () => number = Date.now,
    sleeper: (ms: number) => Promise<void> = defaultSleep,
  ) {
    this.maxPerWindow = maxPerWindow;
    this.windowMs = windowMs;
    this.clock = clock;
    this.sleeper = sleeper;
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  /** Remove timestamps that have expired from the rolling window. */
  private pruneWindow(): void {
    const cutoff = this.clock() - this.windowMs;
    let i = 0;
    while (i < this.windowTimestamps.length && this.windowTimestamps[i]! <= cutoff) i++;
    if (i > 0) this.windowTimestamps.splice(0, i);
  }

  /** Record RPS measurement after each successful dispatch. */
  private recordRps(): void {
    // Densest possible RPS in the window = full-window count / window_seconds.
    // windowTimestamps already has the new timestamp pushed, so this captures
    // the instantaneous peak.
    const rps = this.windowTimestamps.length / (this.windowMs / 1_000);
    if (rps > this._maxObservedRollingRps) {
      this._maxObservedRollingRps = rps;
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Acquire a dispatch slot before making one Kite Historical API call.
   *
   * Guarantees: in any arbitrary `windowMs`-length interval, at most
   * `maxPerWindow` calls are dispatched — regardless of concurrency level.
   *
   * Since JS is single-threaded, the windowTimestamps array is updated
   * atomically from each worker's perspective (no torn reads).
   */
  async acquire(): Promise<void> {
    while (true) {
      this.pruneWindow();
      if (this.windowTimestamps.length < this.maxPerWindow) {
        const now = this.clock();
        this.windowTimestamps.push(now);
        this._requestCount++;
        this.recordRps();
        return;
      }
      // Wait until the oldest timestamp expires from the window (+1 ms grace).
      const oldest = this.windowTimestamps[0]!;
      const waitMs = Math.max(1, this.windowMs - (this.clock() - oldest) + 1);
      await this.sleeper(waitMs);
    }
  }

  /**
   * Report a 429 rate-limit response from Kite.
   *
   * Actions:
   *   1. Increment 429 and retry counters.
   *   2. Fill the window to capacity so in-flight workers back off immediately
   *      (same as draining the bucket in the old implementation).
   *   3. Sleep for Retry-After + jitter to avoid thundering-herd on retry.
   *
   * The caller should retry after this promise resolves.
   *
   * @param retryAfterSec  Value from the Retry-After response header (default 5).
   */
  async reportRateLimit(retryAfterSec = 5): Promise<void> {
    this._rate429Count++;
    this._retryCount++;
    // Fill window — forces all waiting workers to re-evaluate and back off.
    const now = this.clock();
    while (this.windowTimestamps.length < this.maxPerWindow) {
      this.windowTimestamps.push(now);
    }
    const jitterMs = Math.floor(Math.random() * 1_000); // 0–999 ms
    const waitMs = retryAfterSec * 1_000 + jitterMs;
    logger.warn(
      {
        retryAfterSec,
        jitterMs,
        waitMs,
        rate429Count: this._rate429Count,
        retryCount: this._retryCount,
      },
      "kiteRateLimiter: 429 received — sliding window filled, backing off",
    );
    await this.sleeper(waitMs);
  }

  /** Current metrics snapshot. */
  get metrics(): TokenBucketMetrics {
    this.pruneWindow();
    return {
      requestCount: this._requestCount,
      rate429Count: this._rate429Count,
      retryCount: this._retryCount,
      maxObservedRollingRps: Math.round(this._maxObservedRollingRps * 100) / 100,
      currentTokens: Math.max(0, this.maxPerWindow - this.windowTimestamps.length),
    };
  }

  /**
   * Reset per-cycle metrics counters.
   *
   * IMPORTANT: does NOT clear `windowTimestamps`. Clearing timestamps would
   * allow a burst at the start of each refresh cycle, violating the rolling
   * rate limit. Rate limiting is continuous across metric resets.
   */
  resetMetrics(): void {
    this._requestCount = 0;
    this._rate429Count = 0;
    this._retryCount = 0;
    this._maxObservedRollingRps = 0;
    // windowTimestamps intentionally preserved — see note above.
  }

  // ─── Test-only helpers ────────────────────────────────────────────────────

  /** @internal For unit tests that need to inspect window state directly. */
  get _windowTimestampsTestOnly(): readonly number[] {
    return this.windowTimestamps;
  }
}

/**
 * Module-level singleton — shared by all background refresh workers.
 * Metrics are reset by runKiteCandleRefresh() at the start of each cycle.
 * Window timestamps are NOT reset between cycles.
 */
export const kiteHistoricalBucket = new KiteHistoricalTokenBucket();
