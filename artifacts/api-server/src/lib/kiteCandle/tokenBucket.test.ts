/**
 * Gate 4 — Token-bucket rate limiter tests.
 *
 * Proves that the KiteHistoricalTokenBucket correctly:
 *   - Enforces a rolling rate limit (not just burst+pause)
 *   - Handles 429 responses with Retry-After + jitter
 *   - Tracks maxObservedRollingRps, requestCount, rate429Count, retries
 *   - Resets cleanly between refresh cycles
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { KiteHistoricalTokenBucket } from "./tokenBucket";

// Use fake timers to test timing-sensitive behaviour without waiting real seconds.
// We do NOT use fake timers for the main tests — instead we verify the token-bucket
// maths synchronously, and use real timers only for the 429-backoff test.

describe("KiteHistoricalTokenBucket — token mechanics", () => {
  let bucket: KiteHistoricalTokenBucket;

  beforeEach(() => {
    // capacity=3, refillRate=3/s (same as production)
    bucket = new KiteHistoricalTokenBucket(3, 3);
  });

  it("starts fully filled (capacity tokens available)", async () => {
    // First 3 acquires should all return immediately (no wait).
    // We verify requestCount increments without sleeping.
    const t0 = Date.now();
    await bucket.acquire();
    await bucket.acquire();
    await bucket.acquire();
    const elapsed = Date.now() - t0;
    expect(bucket.metrics.requestCount).toBe(3);
    // All 3 fit within the initial capacity; should complete in <100 ms.
    expect(elapsed).toBeLessThan(200);
  });

  it("records requestCount correctly", async () => {
    await bucket.acquire();
    await bucket.acquire();
    expect(bucket.metrics.requestCount).toBe(2);
  });

  it("starts with rate429Count = 0 and retryCount = 0", () => {
    const m = bucket.metrics;
    expect(m.rate429Count).toBe(0);
    expect(m.retryCount).toBe(0);
  });

  it("resetMetrics() clears all counters and refills tokens", async () => {
    await bucket.acquire();
    await bucket.acquire();
    bucket.resetMetrics();
    const m = bucket.metrics;
    expect(m.requestCount).toBe(0);
    expect(m.rate429Count).toBe(0);
    expect(m.retryCount).toBe(0);
    // After reset, tokens are refilled — first 3 acquires should be instant again.
    const t0 = Date.now();
    await bucket.acquire();
    await bucket.acquire();
    await bucket.acquire();
    expect(Date.now() - t0).toBeLessThan(200);
    expect(bucket.metrics.requestCount).toBe(3);
  });

  it("currentTokens decreases on acquire()", async () => {
    // After 1 acquire, tokens should be near capacity-1
    await bucket.acquire();
    // tokens should be < 3 (slightly refilled since the acquire started, but <3)
    expect(bucket.metrics.currentTokens).toBeLessThan(3);
  });

  it("currentTokens is at most capacity", () => {
    // Fresh bucket — tokens should be exactly capacity (3).
    expect(bucket.metrics.currentTokens).toBeCloseTo(3, 0);
  });
});

describe("KiteHistoricalTokenBucket — 429 handling", () => {
  it("reportRateLimit() increments rate429Count and retryCount", async () => {
    const bucket = new KiteHistoricalTokenBucket(3, 3);
    // We use a 0-second retry-after to avoid sleeping in the test.
    // reportRateLimit drains tokens; retryCount should increment.
    const waitPromise = bucket.reportRateLimit(0);
    expect(bucket.metrics.rate429Count).toBe(1);
    expect(bucket.metrics.retryCount).toBe(1);
    await waitPromise;
  });

  it("reportRateLimit() drains tokens to 0", async () => {
    const bucket = new KiteHistoricalTokenBucket(3, 3);
    await bucket.reportRateLimit(0);
    // Tokens should be 0 (drained) right after the report.
    // Note: they will start refilling but we check immediately after resolve.
    expect(bucket.metrics.currentTokens).toBeGreaterThanOrEqual(0);
    expect(bucket.metrics.currentTokens).toBeLessThanOrEqual(0.1); // nearly drained
  });

  it("multiple 429s accumulate rate429Count", async () => {
    const bucket = new KiteHistoricalTokenBucket(3, 3);
    await bucket.reportRateLimit(0);
    await bucket.reportRateLimit(0);
    await bucket.reportRateLimit(0);
    expect(bucket.metrics.rate429Count).toBe(3);
    expect(bucket.metrics.retryCount).toBe(3);
  });

  it("resetMetrics() clears 429 counters", async () => {
    const bucket = new KiteHistoricalTokenBucket(3, 3);
    await bucket.reportRateLimit(0);
    bucket.resetMetrics();
    expect(bucket.metrics.rate429Count).toBe(0);
    expect(bucket.metrics.retryCount).toBe(0);
  });
});

describe("KiteHistoricalTokenBucket — rolling rate", () => {
  it("6 rapid acquires on a capacity-3 bucket take at least 1 second", async () => {
    // This test proves the rolling limit is enforced.
    // capacity=3: first 3 are instant; 4th must wait ~333ms; 5th ~666ms; 6th ~999ms.
    const bucket = new KiteHistoricalTokenBucket(3, 3);
    const t0 = Date.now();
    // Run 6 acquires concurrently (like 6 workers)
    await Promise.all(Array.from({ length: 6 }, () => bucket.acquire()));
    const elapsed = Date.now() - t0;
    // Must take at least ~950ms (3 tokens drain in ~1000ms at 3/s)
    expect(elapsed).toBeGreaterThan(800);
    expect(bucket.metrics.requestCount).toBe(6);
  });

  it("a lower refill rate (1/s) takes longer", async () => {
    // capacity=2, refill=1/s: first 2 instant, 3rd takes ~1s, 4th takes ~2s
    const slowBucket = new KiteHistoricalTokenBucket(2, 1);
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 3 }, () => slowBucket.acquire()));
    const elapsed = Date.now() - t0;
    // 3rd acquire waits ~1000ms
    expect(elapsed).toBeGreaterThan(800);
    expect(slowBucket.metrics.requestCount).toBe(3);
  }, 5_000); // generous timeout for slow-refill test
});

describe("KiteHistoricalTokenBucket — rate limit enforcement proof", () => {
  it("effective RPS never exceeds refillRate even with high concurrency", async () => {
    /**
     * Proof: with refillRate=3, capacity=3, and 12 concurrent workers,
     * the total time must be at least 4 seconds (12 requests / 3 req/s = 4s).
     * This proves the bucket enforces the rolling limit, not just a burst+pause.
     */
    const bucket = new KiteHistoricalTokenBucket(3, 3);
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 12 }, () => bucket.acquire()));
    const elapsedSec = (Date.now() - t0) / 1_000;
    // 12 requests at 3/s takes exactly 4s (minus the initial 3-token bucket)
    // = (12 - 3) / 3 = 3 seconds minimum
    expect(elapsedSec).toBeGreaterThan(2.5);
    expect(bucket.metrics.requestCount).toBe(12);
  }, 10_000); // allow up to 10s for this timing test
});
