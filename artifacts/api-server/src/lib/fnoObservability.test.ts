/**
 * P17a — F&O Observability Substrate tests.
 *
 * Diagnostics-only repair. These tests assert:
 *   1. The reasoning logger's process-local health counters increment on
 *      every attempt and on success/failure.
 *   2. A logger DB failure increments the failure counter and captures
 *      the error class WITHOUT crashing the caller (fire-and-forget
 *      safety preserved).
 *   3. The reset helper is idempotent (used between tests).
 *   4. The writer-boundary test-env guard (2026-07-16) refuses to write
 *      from a vitest process without ALLOW_TEST_DB_WRITES=1.
 *
 * IMPORTANT (2026-07-16 P0.4 Step 2 quarantine):
 * This file previously wrote into the production `fno_signal_reasoning`
 * table on every test run (the live-DB branch of the second test
 * called `logFnoReasoning` with a real db client bound to prod
 * DATABASE_URL, leaking 18 stub rows over two days).
 *
 * The systemic fix now lives inside `logFnoReasoning` itself
 * (`assertNotProdDbInTest`). This test file additionally uses
 * `vi.mock("@workspace/db")` to substitute a fake `db.insert(...)`
 * chain — so even if the writer guard were disabled, this test cannot
 * reach a real database. No `process.env.DATABASE_URL` mutation is
 * used (thread-unsafe under --pool=threads).
 *
 * No signal, gate, sizing, exec, scheduler, Kite, swing, equity,
 * scanner, strategy, combo, snapshot, or candle behaviour is touched.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the db client at module boundary. Every `db.insert(...).values(...)`
// call resolves to undefined without touching a real database. Thread-safe
// under --pool=threads because vi.mock is per-module and shared-state-free.
//
// We avoid `vi.importActual` on `@workspace/db` because that module's
// top-level requires DATABASE_URL — importing it in a test env would
// either reintroduce the prod-DB coupling we're closing, or fail. The
// only two symbols the writer references from this module are `db` and
// `fnoSignalReasoningTable`; both are stubbed here.
vi.mock("@workspace/db", () => ({
  db: {
    insert: () => ({
      values: async () => undefined,
    }),
  },
  fnoSignalReasoningTable: {},
}));

import {
  __resetReasoningLoggerHealthForTests,
  getReasoningLoggerHealth,
  logFnoReasoning,
  type FnoReasoningPayload,
} from "./fnoSignalReasoningLogger";

const BASE_PAYLOAD: FnoReasoningPayload = {
  decision: "EMITTED",
  signalDate: "2026-05-17",
  indexSymbol: "NIFTY",
  setupKey: "TREND_CONTINUATION",
  direction: "BULLISH",
  tier: "STANDARD",
  confidence: 72,
};

describe("P17a — reasoning logger health counters", () => {
  beforeEach(() => {
    __resetReasoningLoggerHealthForTests();
  });

  it("starts with zero counters and a bootedAt timestamp", () => {
    const h = getReasoningLoggerHealth();
    expect(h.writesAttempted).toBe(0);
    expect(h.writesSucceeded).toBe(0);
    expect(h.writesFailed).toBe(0);
    expect(h.lastSuccessAt).toBeNull();
    expect(h.lastErrorAt).toBeNull();
    expect(h.lastErrorClass).toBeNull();
    expect(h.lastErrorMessage).toBeNull();
    expect(typeof h.bootedAt).toBe("string");
    expect(Number.isFinite(Date.parse(h.bootedAt))).toBe(true);
  });

  it("__resetReasoningLoggerHealthForTests preserves bootedAt and zeroes the rest", () => {
    const before = getReasoningLoggerHealth();
    __resetReasoningLoggerHealthForTests();
    const after = getReasoningLoggerHealth();
    expect(after.bootedAt).toBe(before.bootedAt);
    expect(after.writesAttempted).toBe(0);
    expect(after.writesFailed).toBe(0);
  });

  it("increments writesAttempted and either writesSucceeded or writesFailed (exactly one), never throws to caller", async () => {
    // With the db module mocked, this call cannot reach a real DB.
    // With the test-env guard armed, it also cannot proceed past the
    // guard unless ALLOW_TEST_DB_WRITES=1. Either way the caller must
    // see the fire-and-forget contract: never throws, counter advances.
    const before = getReasoningLoggerHealth();
    await expect(logFnoReasoning(BASE_PAYLOAD)).resolves.toBeTypeOf("boolean");
    const after = getReasoningLoggerHealth();
    expect(after.writesAttempted).toBe(before.writesAttempted + 1);
    const succeeded = after.writesSucceeded - before.writesSucceeded;
    const failed = after.writesFailed - before.writesFailed;
    expect(succeeded + failed).toBe(1);
  });

  it("rejects bad payloads silently (decision still attempted, counter advances)", async () => {
    // A payload with non-string signalDate should NOT throw to the caller.
    const badPayload = {
      ...BASE_PAYLOAD,
      signalDate: 12345,
    } as unknown as FnoReasoningPayload;
    const before = getReasoningLoggerHealth();
    await expect(logFnoReasoning(badPayload)).resolves.toBeTypeOf("boolean");
    const after = getReasoningLoggerHealth();
    expect(after.writesAttempted).toBe(before.writesAttempted + 1);
  });

  it("truncates lastErrorMessage to ≤ 200 chars (defensive bound for the health endpoint)", async () => {
    __resetReasoningLoggerHealthForTests();
    // The writer-boundary guard makes every test-env call fail with a
    // deterministic Error, so `lastErrorMessage` is populated. Assert
    // the ≤200 char cap.
    await logFnoReasoning(BASE_PAYLOAD);
    const h = getReasoningLoggerHealth();
    if (h.lastErrorMessage != null) {
      expect(h.lastErrorMessage.length).toBeLessThanOrEqual(200);
    }
  });

  it("writer-boundary guard: refuses to write in a vitest process without ALLOW_TEST_DB_WRITES=1", async () => {
    // Systemic quarantine (2026-07-16): the writer itself refuses
    // to insert when VITEST/NODE_ENV=test is set. This test proves
    // the guard is armed. Any regression would flip writesSucceeded
    // instead of writesFailed and the assertion below would fail.
    __resetReasoningLoggerHealthForTests();
    const savedAllow = process.env.ALLOW_TEST_DB_WRITES;
    delete process.env.ALLOW_TEST_DB_WRITES;
    try {
      const ok = await logFnoReasoning(BASE_PAYLOAD);
      expect(ok).toBe(false);
      const h = getReasoningLoggerHealth();
      expect(h.writesFailed).toBe(1);
      expect(h.writesSucceeded).toBe(0);
      expect(h.lastErrorClass).toBe("Error");
      expect(h.lastErrorMessage).toContain("REASONING_WRITER_TEST_GUARD");
    } finally {
      if (savedAllow !== undefined) {
        process.env.ALLOW_TEST_DB_WRITES = savedAllow;
      }
    }
  });
});
