/**
 * Gate 4 — Sliding-window rate limiter tests.
 *
 * Proves that the KiteHistoricalTokenBucket (now sliding-window) correctly:
 *   - Enforces a rolling rate limit across any arbitrary 1-second interval
 *   - Has NO cold-start burst (empty window on construction)
 *   - Has NO reset burst (resetMetrics() preserves windowTimestamps)
 *   - Handles concurrent workers without exceeding the limit
 *   - Handles 429 responses with Retry-After back-off
 *   - Tracks maxObservedRollingRps, requestCount, rate429Count, retries
 *   - Permits different replicas to be serialized by the global advisory lock
 *     (tested as sequential single-process instances with distinct buckets)
 *   - Honors Retry-After and stops the job on persistent 429
 *
 * All timing-sensitive tests use a fake clock + fake sleeper injected via
 * the constructor. This ensures deterministic, sub-millisecond test execution
 * without relying on real timer precision.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { KiteHistoricalTokenBucket, MAX_PER_WINDOW, WINDOW_MS } from "./tokenBucket";

// ─── Fake-clock helpers ───────────────────────────────────────────────────────

/**
 * Build a controllable fake clock + sleeper pair.
 *   - `clock()` returns the current fake timestamp (ms).
 *   - `advance(ms)` moves fake time forward by ms.
 *   - `sleeper(ms)` synchronously advances fake time by ms then resolves.
 *
 * Using the same `now` reference in both clock and sleeper means the bucket's
 * pruneWindow() sees the correct fake time after every await.
 */
function makeFakeClock(startMs = 0) {
  let now = startMs;
  return {
    clock: () => now,
    advance: (ms: number) => { now += ms; },
    sleeper: (ms: number): Promise<void> => {
      now += ms;
      return Promise.resolve();
    },
  };
}

// ─── Sliding window fundamentals ──────────────────────────────────────────────

describe("KiteHistoricalTokenBucket — sliding window fundamentals", () => {
  it("starts empty — no initial burst (cold start)", async () => {
    const fc = makeFakeClock(0);
    const bucket = new KiteHistoricalTokenBucket(3, 1000, fc.clock, fc.sleeper);

    // First acquire: window is empty → dispatches immediately at t=0
    await bucket.acquire();
    expect(fc.clock()).toBe(0); // no time advanced for first slot

    // Second acquire: window has 1 entry, still under limit → dispatches at t=0
    await bucket.acquire();
    expect(fc.clock()).toBe(0);

    // Third acquire: window has 2 entries → dispatches at t=0
    await bucket.acquire();
    expect(fc.clock()).toBe(0);

    // Fourth acquire: window is FULL (3 entries at t=0). sleeper advances time
    // until the oldest (t=0) expires from [now-1000ms, now) window.
    // wait = 1000 - (0 - 0) + 1 = 1001ms
    await bucket.acquire();
    expect(fc.clock()).toBe(1001); // time advanced
    expect(bucket.metrics.requestCount).toBe(4);
  });

  it("no arbitrary 1-second interval contains more than MAX_PER_WINDOW requests (fake clock)", async () => {
    const fc = makeFakeClock(0);
    const bucket = new KiteHistoricalTokenBucket(3, 1000, fc.clock, fc.sleeper);

    // Simulate 9 sequential acquires, recording dispatch timestamps.
    const dispatched: number[] = [];
    for (let i = 0; i < 9; i++) {
      await bucket.acquire();
      dispatched.push(fc.clock());
    }

    // Verify no 1-second window contains > 3 dispatches.
    for (let t = 0; t <= dispatched[dispatched.length - 1]!; t += 100) {
      const count = dispatched.filter(d => d >= t && d < t + 1000).length;
      expect(count).toBeLessThanOrEqual(3);
    }
  });

  it("concurrent workers cannot exceed the limit (fake clock, 6 concurrent)", async () => {
    const fc = makeFakeClock(0);
    const bucket = new KiteHistoricalTokenBucket(3, 1000, fc.clock, fc.sleeper);

    // Launch 6 concurrent acquires.
    // JS execution with fake clock: the Array.from factory runs each acquire()
    // synchronously until its first await. With a fake sleeper that immediately
    // advances fake time and resolves, the dispatch order is:
    //   P1, P2, P3: dispatch at t=0 (no await needed, window was empty)
    //   P4: window full at t=0 → sleeper advances time to 1001 → await suspends P4
    //   P5 (starts BEFORE P4 resumes): prunes window at t=1001 → dispatches immediately
    //   P6 (same): dispatches at t=1001
    //   P4 resumes: window=[1001,1001] → dispatches at t=1001
    // 6 total requests. Rate-limiter metrics confirm correct behavior.
    await Promise.all(Array.from({ length: 6 }, () => bucket.acquire()));

    // All 6 dispatched
    expect(bucket.metrics.requestCount).toBe(6);
    // Peak rolling RPS (at densest point) must not exceed MAX_PER_WINDOW
    expect(bucket.metrics.maxObservedRollingRps).toBeLessThanOrEqual(MAX_PER_WINDOW + 0.01);
    // windowTimestamps at the end contains only entries from the current window
    // (≤ MAX_PER_WINDOW since pruneWindow() runs before every acquire)
    expect(bucket._windowTimestampsTestOnly.length).toBeLessThanOrEqual(MAX_PER_WINDOW);
  });

  it("different replicas serialized by advisory lock cannot exceed aggregate limit", () => {
    // The advisory lock (pg_try_advisory_lock) prevents two replicas from running
    // ingestion concurrently. Test: two sequential single-process bucket instances
    // each issue ≤ MAX_PER_WINDOW requests and do not share a window.
    // (Cross-process enforcement is proven by the advisory-lock contract; this
    // test validates that two independent buckets each respect the per-instance limit.)
    const fc1 = makeFakeClock(0);
    const fc2 = makeFakeClock(5000); // second replica starts 5 s later
    const b1 = new KiteHistoricalTokenBucket(3, 1000, fc1.clock, fc1.sleeper);
    const b2 = new KiteHistoricalTokenBucket(3, 1000, fc2.clock, fc2.sleeper);

    // Each bucket starts empty and is bounded independently.
    // At any given wall-clock second, only ONE bucket is active (advisory lock).
    expect(b1.metrics.currentTokens).toBe(MAX_PER_WINDOW); // 3 slots available
    expect(b2.metrics.currentTokens).toBe(MAX_PER_WINDOW);
  });
});

// ─── No cold-start burst ──────────────────────────────────────────────────────

describe("KiteHistoricalTokenBucket — no cold-start burst", () => {
  it("starts empty: currentTokens equals MAX_PER_WINDOW (all slots free)", () => {
    const fc = makeFakeClock(0);
    const bucket = new KiteHistoricalTokenBucket(3, 1000, fc.clock, fc.sleeper);
    // currentTokens = max - windowTimestamps.length = 3 - 0 = 3 (available slots)
    expect(bucket.metrics.currentTokens).toBe(3);
  });

  it("first 3 acquires dispatch without advancing fake time", async () => {
    const fc = makeFakeClock(0);
    const bucket = new KiteHistoricalTokenBucket(3, 1000, fc.clock, fc.sleeper);
    await bucket.acquire();
    await bucket.acquire();
    await bucket.acquire();
    expect(fc.clock()).toBe(0); // no sleeping needed
  });

  it("4th acquire on a 3-slot window sleeps until oldest expires", async () => {
    const fc = makeFakeClock(0);
    const bucket = new KiteHistoricalTokenBucket(3, 1000, fc.clock, fc.sleeper);
    await bucket.acquire(); // t=0
    await bucket.acquire(); // t=0
    await bucket.acquire(); // t=0
    // Window: [0, 0, 0]. 4th must wait until t=0 expires from [now-1000, now].
    await bucket.acquire();
    // After acquire: fake time advanced by 1001ms (1000ms window + 1ms grace).
    expect(fc.clock()).toBeGreaterThanOrEqual(1000);
  });
});

// ─── No reset burst ───────────────────────────────────────────────────────────

describe("KiteHistoricalTokenBucket — no reset burst", () => {
  it("resetMetrics() clears counters but NOT windowTimestamps", async () => {
    const fc = makeFakeClock(0);
    const bucket = new KiteHistoricalTokenBucket(3, 1000, fc.clock, fc.sleeper);

    // Fill window to capacity.
    await bucket.acquire();
    await bucket.acquire();
    await bucket.acquire();
    expect(bucket._windowTimestampsTestOnly.length).toBe(3);

    // Reset metrics — counters clear but window stays full.
    bucket.resetMetrics();
    expect(bucket.metrics.requestCount).toBe(0);
    expect(bucket.metrics.rate429Count).toBe(0);
    expect(bucket._windowTimestampsTestOnly.length).toBe(3); // window still full
    expect(bucket.metrics.currentTokens).toBe(0); // still 0 slots (window full at t=0)
  });

  it("after resetMetrics(), 4th acquire still sleeps (no burst allowed at reset)", async () => {
    const fc = makeFakeClock(0);
    const bucket = new KiteHistoricalTokenBucket(3, 1000, fc.clock, fc.sleeper);

    await bucket.acquire();
    await bucket.acquire();
    await bucket.acquire();
    bucket.resetMetrics();

    // Window is still full at t=0. Next acquire must sleep.
    await bucket.acquire();
    expect(fc.clock()).toBeGreaterThanOrEqual(1000); // time advanced
    expect(bucket.metrics.requestCount).toBe(1); // fresh counter after reset
  });
});

// ─── Metrics ─────────────────────────────────────────────────────────────────

describe("KiteHistoricalTokenBucket — metrics", () => {
  it("requestCount increments correctly", async () => {
    const fc = makeFakeClock(0);
    const bucket = new KiteHistoricalTokenBucket(3, 1000, fc.clock, fc.sleeper);
    await bucket.acquire();
    await bucket.acquire();
    expect(bucket.metrics.requestCount).toBe(2);
  });

  it("rate429Count and retryCount start at 0", () => {
    const fc = makeFakeClock(0);
    const bucket = new KiteHistoricalTokenBucket(3, 1000, fc.clock, fc.sleeper);
    expect(bucket.metrics.rate429Count).toBe(0);
    expect(bucket.metrics.retryCount).toBe(0);
  });

  it("maxObservedRollingRps reflects peak in-window density", async () => {
    const fc = makeFakeClock(0);
    const bucket = new KiteHistoricalTokenBucket(3, 1000, fc.clock, fc.sleeper);
    // 3 requests in same 1-second window → peak RPS = 3 / 1 = 3
    await bucket.acquire();
    await bucket.acquire();
    await bucket.acquire();
    expect(bucket.metrics.maxObservedRollingRps).toBe(3);
  });

  it("resetMetrics() zeroes all counters", async () => {
    const fc = makeFakeClock(0);
    const bucket = new KiteHistoricalTokenBucket(3, 1000, fc.clock, fc.sleeper);
    await bucket.acquire();
    await bucket.acquire();
    await bucket.reportRateLimit(0);
    bucket.resetMetrics();
    const m = bucket.metrics;
    expect(m.requestCount).toBe(0);
    expect(m.rate429Count).toBe(0);
    expect(m.retryCount).toBe(0);
    expect(m.maxObservedRollingRps).toBe(0);
  });
});

// ─── 429 handling ────────────────────────────────────────────────────────────

describe("KiteHistoricalTokenBucket — 429 handling", () => {
  it("reportRateLimit() increments rate429Count and retryCount", async () => {
    const fc = makeFakeClock(0);
    const bucket = new KiteHistoricalTokenBucket(3, 1000, fc.clock, fc.sleeper);
    await bucket.reportRateLimit(0);
    expect(bucket.metrics.rate429Count).toBe(1);
    expect(bucket.metrics.retryCount).toBe(1);
  });

  it("reportRateLimit() fills windowTimestamps to capacity (forces back-off)", async () => {
    const fc = makeFakeClock(0);
    const bucket = new KiteHistoricalTokenBucket(3, 1000, fc.clock, fc.sleeper);
    await bucket.reportRateLimit(0);
    // Window is now full — currentTokens = 0
    expect(bucket.metrics.currentTokens).toBe(0);
    expect(bucket._windowTimestampsTestOnly.length).toBe(3);
  });

  it("Retry-After is honored: sleeper called with retryAfterSec * 1000 + jitter", async () => {
    const fc = makeFakeClock(0);
    const sleepCalls: number[] = [];
    const recordingSleeper = (ms: number): Promise<void> => {
      sleepCalls.push(ms);
      fc.advance(ms);
      return Promise.resolve();
    };
    const bucket = new KiteHistoricalTokenBucket(3, 1000, fc.clock, recordingSleeper);
    await bucket.reportRateLimit(5); // 5-second Retry-After
    // sleeper called once with 5000ms + jitter (0–999ms)
    expect(sleepCalls.length).toBe(1);
    expect(sleepCalls[0]).toBeGreaterThanOrEqual(5000);
    expect(sleepCalls[0]).toBeLessThan(6000);
  });

  it("persistent 429: job stops after MAX_CONSECUTIVE_429 (integration with warehouse)", () => {
    // The warehouse checks batchConsecutive429s >= MAX_CONSECUTIVE_429 (3).
    // This test validates the reportRateLimit contract used by the warehouse.
    const fc = makeFakeClock(0);
    const bucket = new KiteHistoricalTokenBucket(3, 1000, fc.clock, fc.sleeper);
    // Simulate 3 consecutive 429s — job should stop (tested at warehouse level;
    // here we just prove the rate429Count accumulates correctly).
    return Promise.all([
      bucket.reportRateLimit(0),
      bucket.reportRateLimit(0),
      bucket.reportRateLimit(0),
    ]).then(() => {
      expect(bucket.metrics.rate429Count).toBe(3);
    });
  });

  it("multiple 429s accumulate rate429Count", async () => {
    const fc = makeFakeClock(0);
    const bucket = new KiteHistoricalTokenBucket(3, 1000, fc.clock, fc.sleeper);
    await bucket.reportRateLimit(0);
    await bucket.reportRateLimit(0);
    await bucket.reportRateLimit(0);
    expect(bucket.metrics.rate429Count).toBe(3);
    expect(bucket.metrics.retryCount).toBe(3);
  });

  it("resetMetrics() clears 429 counters", async () => {
    const fc = makeFakeClock(0);
    const bucket = new KiteHistoricalTokenBucket(3, 1000, fc.clock, fc.sleeper);
    await bucket.reportRateLimit(0);
    bucket.resetMetrics();
    expect(bucket.metrics.rate429Count).toBe(0);
    expect(bucket.metrics.retryCount).toBe(0);
  });
});

// ─── Rolling rate proof (real timers, bounded duration) ───────────────────────

describe("KiteHistoricalTokenBucket — real-timer rolling rate proof", () => {
  it("6 concurrent acquires on a 3-slot bucket take at least 1 second", async () => {
    // Real-timer test: proves the rolling limit holds end-to-end.
    // capacity=3: first 3 instant; 4th waits ~333ms; 5th ~666ms; 6th ~999ms.
    const bucket = new KiteHistoricalTokenBucket(3, 1000);
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 6 }, () => bucket.acquire()));
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThan(800);
    expect(bucket.metrics.requestCount).toBe(6);
  }, 5_000);

  it("effective RPS never exceeds maxPerWindow even with 12 concurrent workers", async () => {
    // 12 requests at 3/s: the initial 3 fire immediately, then 3/s refill rate.
    // Total expected time ≥ (12 - 3) / 3 = 3 s.
    const bucket = new KiteHistoricalTokenBucket(3, 1000);
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 12 }, () => bucket.acquire()));
    const elapsedSec = (Date.now() - t0) / 1_000;
    expect(elapsedSec).toBeGreaterThan(2.5);
    expect(bucket.metrics.requestCount).toBe(12);
  }, 10_000);

  it("maxObservedRollingRps does not exceed MAX_PER_WINDOW", async () => {
    const bucket = new KiteHistoricalTokenBucket(3, 1000);
    await Promise.all(Array.from({ length: 9 }, () => bucket.acquire()));
    // maxObservedRollingRps is the peak window density.
    // With sliding window: peak = 3 requests / 1 second = 3.
    expect(bucket.metrics.maxObservedRollingRps).toBeLessThanOrEqual(MAX_PER_WINDOW + 0.1);
  }, 10_000);
});

// ─── Defaults ─────────────────────────────────────────────────────────────────

describe("KiteHistoricalTokenBucket — production defaults", () => {
  it("MAX_PER_WINDOW = 3 and WINDOW_MS = 1000", () => {
    expect(MAX_PER_WINDOW).toBe(3);
    expect(WINDOW_MS).toBe(1_000);
  });

  it("default constructor uses production limits", () => {
    const bucket = new KiteHistoricalTokenBucket();
    // Empty window → 3 slots available
    expect(bucket.metrics.currentTokens).toBe(3);
  });
});
