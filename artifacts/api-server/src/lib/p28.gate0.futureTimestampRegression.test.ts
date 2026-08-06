/**
 * Pack 8 Gate 0 — FUTURE_TIMESTAMP timing regression tests.
 *
 * Proves two things:
 *   1. When `nowSec` is sampled AFTER the Upstox fetch completes,
 *      fetch latency (even several seconds) cannot produce a false
 *      FUTURE_TIMESTAMP classification.
 *   2. A genuinely future provider timestamp (server clock skew,
 *      data error) still fails closed as FUTURE_TIMESTAMP — the
 *      production fail-closed rule is preserved.
 *
 * No live provider calls. No DB connections.
 */

import { describe, it, expect } from "vitest";
import {
  classifyParityObservation,
  PARITY_THRESHOLDS,
} from "./marketData/parityClassification";

const { FUTURE_TOLERANCE_SEC } = PARITY_THRESHOLDS;

describe("Pack 8 Gate 0 — FUTURE_TIMESTAMP timing regression", () => {
  // ── Scenario A: correct nowSec sampling (after fetch) ────────────────────

  it("A1: fetch latency of 1s cannot create false FUTURE_TIMESTAMP (nowSec after fetch)", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    // upstoxAsOfSec = fetch-end time, which is BEFORE nowSec is sampled
    const upstoxAsOfSec = nowSec - 1;
    const result = classifyParityObservation(24000, 24002, null, upstoxAsOfSec, nowSec);
    expect(result).not.toBe("FUTURE_TIMESTAMP");
    expect(result).toBe("MATCH_WITHIN_TOLERANCE");
  });

  it("A2: fetch latency of 3s cannot create false FUTURE_TIMESTAMP (nowSec after fetch)", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const upstoxAsOfSec = nowSec - 3; // 3 seconds before nowSec
    const result = classifyParityObservation(24000, 24001, null, upstoxAsOfSec, nowSec);
    expect(result).not.toBe("FUTURE_TIMESTAMP");
  });

  it("A3: fetch latency of 10s cannot create false FUTURE_TIMESTAMP (nowSec after fetch)", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const upstoxAsOfSec = nowSec - 10;
    const result = classifyParityObservation(24000, 24000, null, upstoxAsOfSec, nowSec);
    expect(result).not.toBe("FUTURE_TIMESTAMP");
  });

  it("A4: upstoxAsOf exactly equal to nowSec does NOT trigger FUTURE_TIMESTAMP", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const upstoxAsOfSec = nowSec; // exactly equal (fetch completed at same second)
    const result = classifyParityObservation(24000, 24001, null, upstoxAsOfSec, nowSec);
    expect(result).not.toBe("FUTURE_TIMESTAMP");
  });

  // ── Scenario B: production fail-closed rule preserved ────────────────────

  it("B1: genuinely future timestamp (100s ahead) still fails closed as FUTURE_TIMESTAMP", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const genuinelyFutureAsOf = nowSec + 100; // 100 seconds in the future
    const result = classifyParityObservation(24000, 24001, null, genuinelyFutureAsOf, nowSec);
    expect(result).toBe("FUTURE_TIMESTAMP");
  });

  it("B2: future timestamp exactly at tolerance boundary+1 fails closed", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const futureAsOf = nowSec + FUTURE_TOLERANCE_SEC + 1; // just over tolerance
    const result = classifyParityObservation(24000, 24001, null, futureAsOf, nowSec);
    expect(result).toBe("FUTURE_TIMESTAMP");
  });

  it("B3: future timestamp at exactly tolerance does NOT trigger FUTURE_TIMESTAMP (boundary inclusive)", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const atToleranceAsOf = nowSec + FUTURE_TOLERANCE_SEC; // exactly at tolerance
    const result = classifyParityObservation(24000, 24001, null, atToleranceAsOf, nowSec);
    // classifyParityObservation: if upstoxAsOfSec > nowSec + FUTURE_TOLERANCE_SEC → FUTURE_TIMESTAMP
    // At exactly tolerance: NOT future (strict >)
    expect(result).not.toBe("FUTURE_TIMESTAMP");
  });

  it("B4: future timestamp 1 year ahead still fails closed", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const farFuture = nowSec + 365 * 24 * 3600;
    const result = classifyParityObservation(24000, 24001, null, farFuture, nowSec);
    expect(result).toBe("FUTURE_TIMESTAMP");
  });

  // ── Scenario C: Pack 27 artifact reproduction ─────────────────────────────
  // In Pack 27, nowSec was sampled BEFORE the fetch. Upstox fetches took
  // ~350ms. This means: if nowSec was sampled at T=0 and fetch finished at
  // T=0.35s, upstoxAsOfSec = Math.floor(T+0.35) could = nowSec+0 (same second)
  // or nowSec+1 depending on alignment. The FUTURE_TOLERANCE_SEC=5 gate
  // prevented most false positives, but multi-second fetches could trigger it.

  it("C1: SIMULATED Pack 27 pattern — nowSec sampled 6s before fetch end → FUTURE_TIMESTAMP", () => {
    // Simulate: nowSec was sampled 6 seconds before the fetch completed
    // upstoxAsOfSec = fetch_end_sec = nowSec + 6 (would have been the Pack 27 bug)
    const nowSec = 1000000000; // fixed for determinism
    const upstoxAsOfSec = nowSec + 6; // > FUTURE_TOLERANCE_SEC=5 → false positive
    const result = classifyParityObservation(24000, 24001, null, upstoxAsOfSec, nowSec);
    expect(result).toBe("FUTURE_TIMESTAMP"); // confirms the old bug produced false positives
  });

  it("C2: FIXED Pack 28 pattern — nowSec sampled after fetch → no false FUTURE_TIMESTAMP", () => {
    // With the fix: upstoxAsOfSec = fetch_end_sec, nowSec sampled after → nowSec >= upstoxAsOfSec
    const fetchEndSec = 1000000006; // fetch ended at T+6
    const upstoxAsOfSec = fetchEndSec; // set to fetch-end time
    const nowSec = fetchEndSec + 0;   // sampled right after → always >= upstoxAsOfSec
    const result = classifyParityObservation(24000, 24001, null, upstoxAsOfSec, nowSec);
    expect(result).not.toBe("FUTURE_TIMESTAMP");
    expect(result).toBe("MATCH_WITHIN_TOLERANCE");
  });

  // ── Scenario D: PARITY_THRESHOLDS unchanged from Pack 7 ─────────────────

  it("D1: PARITY_THRESHOLDS unchanged from Pack 7 values", () => {
    expect(PARITY_THRESHOLDS.PRICE_BPS_TOLERANCE).toBe(50);
    expect(PARITY_THRESHOLDS.TIMESTAMP_SKEW_SEC).toBe(120);
    expect(PARITY_THRESHOLDS.STALE_PROVIDER_SEC).toBe(300);
    expect(PARITY_THRESHOLDS.FUTURE_TOLERANCE_SEC).toBe(5);
  });

  it("D2: null upstoxAsOf skips FUTURE_TIMESTAMP check (no spurious failure)", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    // When LTP endpoint provides no timestamp, upstoxAsOf = null → no future check
    const result = classifyParityObservation(24000, 24001, null, null, nowSec);
    expect(result).not.toBe("FUTURE_TIMESTAMP");
    expect(result).toBe("MATCH_WITHIN_TOLERANCE");
  });

  it("D3: stale provider check still fires correctly when data is old", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const staleAsOf = nowSec - PARITY_THRESHOLDS.STALE_PROVIDER_SEC - 1;
    const result = classifyParityObservation(24000, 24001, null, staleAsOf, nowSec);
    expect(result).toBe("STALE_PROVIDER");
  });
});
