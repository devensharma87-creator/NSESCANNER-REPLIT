/**
 * Pack 9A Gate 7 — canary coverage supplement.
 *
 * Covers the pure-function surface of the option-chain snapshot ingestor
 * that the existing optionChainSnapshotIngestor.test.ts intentionally
 * deferred (circuit-breaker, alert-dedup, retention fail-closed, storage
 * projections, lot-size constants, scheduler idempotency, V2 hard locks).
 *
 * All tests are pure-function or environment-only — no live DB, no
 * live provider calls, no network I/O.
 *
 * Rules:
 *   - No .skip, .only, retries, or arbitrary sleeps.
 *   - No live DB calls (DATABASE_URL not present in test env).
 *   - No live provider calls (fetchOptionChain not imported here).
 *   - afterEach resets module-level circuit state via _resetCircuitBreaker().
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  isCircuitOpen,
  updateCircuitBreaker,
  shouldSendOwnerAlert,
  getCircuitState,
  _resetCircuitBreaker,
  CIRCUIT_BREAKER_THRESHOLD,
  CIRCUIT_RESET_MINUTES,
  ALERT_COOLDOWN_MINUTES,
  TICK_TIMEOUT_MS,
  SNAPSHOT_LOT_SIZES,
  SNAPSHOT_INDICES,
  startOptionSnapshotIngestor,
  stopOptionSnapshotIngestor,
  runRetentionSweep,
} from "./optionChainSnapshotIngestor";
import {
  projectStorage,
  getArchivePath,
  getArchiveInfrastructureRequirement,
  ROWS_PER_TICK_CONSERVATIVE,
  ROWS_PER_TICK_WORST_CASE,
  TICKS_PER_DAY,
  ESTIMATED_BYTES_PER_ROW_TOTAL,
  ESTIMATED_BYTES_PER_ROW_DATA,
} from "./optionSnapshotArchive";
import { FNO_PAPER_V2_RUNTIME_AUTHORIZED, SWING_PAPER_V2_RUNTIME_AUTHORIZED } from "./v2PaperLocks";

afterEach(() => {
  _resetCircuitBreaker();
  stopOptionSnapshotIngestor();
});

// ─── P9A-T01 — T06: Circuit-breaker state machine ─────────────────────────

describe("isCircuitOpen", () => {
  it("P9A-T01: returns false when no circuit has tripped (fresh state)", () => {
    expect(isCircuitOpen(new Date())).toBe(false);
  });

  it("P9A-T02: returns false after circuit window has expired (auto-reset)", () => {
    // Manually trip the circuit by injecting threshold full-failures.
    const now = new Date("2026-08-07T05:00:00.000Z");
    const fullFailure = {
      underlyingsAttempted: 3,
      underlyingsOk: 0,
      expiriesCovered: 0,
      rowsWritten: 0,
      errors: [{ underlying: "*", message: "timeout" }],
      source: "none",
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
    };
    for (let i = 0; i < CIRCUIT_BREAKER_THRESHOLD; i++) {
      updateCircuitBreaker(fullFailure, now);
    }
    // Circuit is now open.
    expect(isCircuitOpen(now)).toBe(true);

    // One full CIRCUIT_RESET_MINUTES later — circuit auto-resets.
    const afterReset = new Date(now.getTime() + CIRCUIT_RESET_MINUTES * 60_000 + 1);
    expect(isCircuitOpen(afterReset)).toBe(false);
  });
});

describe("updateCircuitBreaker", () => {
  it("P9A-T03: does not trip circuit before threshold full-failures", () => {
    const now = new Date("2026-08-07T05:00:00.000Z");
    const fullFailure = {
      underlyingsAttempted: 3,
      underlyingsOk: 0,
      expiriesCovered: 0,
      rowsWritten: 0,
      errors: [{ underlying: "*", message: "timeout" }],
      source: "none",
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
    };
    for (let i = 0; i < CIRCUIT_BREAKER_THRESHOLD - 1; i++) {
      const r = updateCircuitBreaker(fullFailure, now);
      expect(r.circuitTripped).toBe(false);
    }
    const state = getCircuitState();
    expect(state.consecutiveFullFailures).toBe(CIRCUIT_BREAKER_THRESHOLD - 1);
    expect(state.circuitOpenUntil).toBeNull();
  });

  it("P9A-T04: trips circuit exactly at threshold and sets openUntil", () => {
    const now = new Date("2026-08-07T05:00:00.000Z");
    const fullFailure = {
      underlyingsAttempted: 3,
      underlyingsOk: 0,
      expiriesCovered: 0,
      rowsWritten: 0,
      errors: [{ underlying: "*", message: "timeout" }],
      source: "none",
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
    };
    for (let i = 0; i < CIRCUIT_BREAKER_THRESHOLD; i++) {
      updateCircuitBreaker(fullFailure, now);
    }
    const state = getCircuitState();
    expect(state.circuitOpenUntil).not.toBeNull();
    const openUntil = new Date(state.circuitOpenUntil!);
    const expectedOpenUntil = new Date(now.getTime() + CIRCUIT_RESET_MINUTES * 60_000);
    expect(openUntil.toISOString()).toBe(expectedOpenUntil.toISOString());
  });

  it("P9A-T05: any partial success resets consecutive failure counter", () => {
    const now = new Date("2026-08-07T05:00:00.000Z");
    const fullFailure = {
      underlyingsAttempted: 3,
      underlyingsOk: 0,
      expiriesCovered: 0,
      rowsWritten: 0,
      errors: [{ underlying: "*", message: "timeout" }],
      source: "none",
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
    };
    const partialSuccess = {
      ...fullFailure,
      underlyingsOk: 1,
      rowsWritten: 42,
      source: "nse",
    };
    // Build up 3 failures.
    for (let i = 0; i < 3; i++) updateCircuitBreaker(fullFailure, now);
    expect(getCircuitState().consecutiveFullFailures).toBe(3);

    // One partial success.
    const r = updateCircuitBreaker(partialSuccess, now);
    expect(r.circuitTripped).toBe(false);
    expect(getCircuitState().consecutiveFullFailures).toBe(0);
    expect(getCircuitState().circuitOpenUntil).toBeNull();
  });

  it("P9A-T06: market_closed result does NOT count as a full failure", () => {
    const now = new Date("2026-08-07T05:00:00.000Z");
    const marketClosed = {
      underlyingsAttempted: 0,
      underlyingsOk: 0,
      expiriesCovered: 0,
      rowsWritten: 0,
      errors: [{ underlying: "*", message: "market_closed" }],
      source: "none",
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      skippedReason: "market_closed" as const,
    };
    for (let i = 0; i < CIRCUIT_BREAKER_THRESHOLD + 2; i++) {
      updateCircuitBreaker(marketClosed, now);
    }
    // Market-closed ticks must not trip the circuit.
    expect(getCircuitState().consecutiveFullFailures).toBe(0);
    expect(getCircuitState().circuitOpenUntil).toBeNull();
  });
});

// ─── P9A-T07 — T09: Alert-dedup state machine ─────────────────────────────

describe("shouldSendOwnerAlert", () => {
  it("P9A-T07: first alert of each kind is always allowed", () => {
    const now = new Date("2026-08-07T05:00:00.000Z");
    expect(shouldSendOwnerAlert("failure", now)).toBe(true);
    _resetCircuitBreaker();
    expect(shouldSendOwnerAlert("recovery", now)).toBe(true);
  });

  it("P9A-T08: second alert within cooldown window is suppressed (dedup active)", () => {
    const t0 = new Date("2026-08-07T05:00:00.000Z");
    // First call arms the latch.
    shouldSendOwnerAlert("failure", t0);
    // Second call within cooldown.
    const t1 = new Date(t0.getTime() + (ALERT_COOLDOWN_MINUTES - 1) * 60_000);
    expect(shouldSendOwnerAlert("failure", t1)).toBe(false);
  });

  it("P9A-T09: alert is allowed again after cooldown expires", () => {
    const t0 = new Date("2026-08-07T05:00:00.000Z");
    shouldSendOwnerAlert("failure", t0);
    const t1 = new Date(t0.getTime() + ALERT_COOLDOWN_MINUTES * 60_000 + 1);
    expect(shouldSendOwnerAlert("failure", t1)).toBe(true);
  });

  it("P9A-T10: failure and recovery dedup are independent state channels", () => {
    const t0 = new Date("2026-08-07T05:00:00.000Z");
    shouldSendOwnerAlert("failure", t0);
    // Recovery kind still allowed at t0 (different channel).
    expect(shouldSendOwnerAlert("recovery", t0)).toBe(true);
  });
});

// ─── P9A-T11 — T12: Constants sanity ──────────────────────────────────────

describe("SNAPSHOT_LOT_SIZES", () => {
  it("P9A-T11: carries date-effective 2026-JAN lot sizes for F&O index universe", () => {
    expect(SNAPSHOT_LOT_SIZES["NIFTY"]).toBe(65);
    expect(SNAPSHOT_LOT_SIZES["BANKNIFTY"]).toBe(30);
    expect(SNAPSHOT_LOT_SIZES["SENSEX"]).toBe(20);
  });

  it("P9A-T12: has an entry for every SNAPSHOT_INDEX (no universe drift)", () => {
    for (const idx of SNAPSHOT_INDICES) {
      expect(SNAPSHOT_LOT_SIZES[idx]).toBeGreaterThan(0);
    }
  });
});

describe("reliability constants", () => {
  it("P9A-T13: circuit breaker threshold is 5 consecutive full-failure ticks", () => {
    expect(CIRCUIT_BREAKER_THRESHOLD).toBe(5);
  });

  it("P9A-T14: circuit reset window is 15 minutes", () => {
    expect(CIRCUIT_RESET_MINUTES).toBe(15);
  });

  it("P9A-T15: alert cooldown is 60 minutes (once per hour max)", () => {
    expect(ALERT_COOLDOWN_MINUTES).toBe(60);
  });

  it("P9A-T16: tick timeout is 60 seconds (hard abort before next 5-min tick)", () => {
    expect(TICK_TIMEOUT_MS).toBe(60_000);
  });
});

// ─── P9A-T17 — T20: Storage projection arithmetic ─────────────────────────

describe("projectStorage", () => {
  it("P9A-T17: returns projections for 6 time horizons", () => {
    const projections = projectStorage();
    expect(projections).toHaveLength(6);
  });

  it("P9A-T18: 1-day projection matches the formula (75 ticks × 200 rows × 454 bytes)", () => {
    const projections = projectStorage();
    const oneDay = projections.find((p) => p.tradingDays === 1);
    expect(oneDay).toBeDefined();
    expect(oneDay!.rowsConservative).toBe(TICKS_PER_DAY * ROWS_PER_TICK_CONSERVATIVE);
    expect(oneDay!.rowsWorstCase).toBe(TICKS_PER_DAY * ROWS_PER_TICK_WORST_CASE);
    expect(oneDay!.totalBytesConservative).toBe(
      TICKS_PER_DAY * ROWS_PER_TICK_CONSERVATIVE * ESTIMATED_BYTES_PER_ROW_TOTAL,
    );
  });

  it("P9A-T19: conservative estimates are always lower than worst-case", () => {
    for (const p of projectStorage()) {
      expect(p.rowsConservative).toBeLessThan(p.rowsWorstCase);
      expect(p.totalBytesConservative).toBeLessThan(p.totalBytesWorstCase);
    }
  });

  it("P9A-T20: 130-trading-day data estimate is under 2 GB (fits Replit DB tier)", () => {
    const p130 = projectStorage().find((p) => p.tradingDays === 130);
    expect(p130).toBeDefined();
    // Worst-case data bytes (no index) must be under 2 GB = 2 × 1024³
    const twoGb = 2 * 1024 * 1024 * 1024;
    expect(p130!.dataBytesWorstCase).toBeLessThan(twoGb);
  });
});

// ─── P9A-T21 — T22: Archive path and infrastructure requirement ───────────

describe("getArchivePath", () => {
  it("P9A-T21: returns null when OPTION_SNAPSHOT_ARCHIVE_PATH is unset", () => {
    const orig = process.env["OPTION_SNAPSHOT_ARCHIVE_PATH"];
    delete process.env["OPTION_SNAPSHOT_ARCHIVE_PATH"];
    expect(getArchivePath()).toBeNull();
    if (orig !== undefined) process.env["OPTION_SNAPSHOT_ARCHIVE_PATH"] = orig;
  });

  it("P9A-T22: returns the configured value when the variable is set", () => {
    const orig = process.env["OPTION_SNAPSHOT_ARCHIVE_PATH"];
    process.env["OPTION_SNAPSHOT_ARCHIVE_PATH"] = "/tmp/archive";
    expect(getArchivePath()).toBe("/tmp/archive");
    if (orig !== undefined) process.env["OPTION_SNAPSHOT_ARCHIVE_PATH"] = orig;
    else delete process.env["OPTION_SNAPSHOT_ARCHIVE_PATH"];
  });
});

describe("getArchiveInfrastructureRequirement", () => {
  it("P9A-T23: returns a non-empty human-readable requirement string", () => {
    const req = getArchiveInfrastructureRequirement();
    expect(typeof req).toBe("string");
    expect(req.length).toBeGreaterThan(10);
  });
});

// ─── P9A-T24: Retention sweep — archive-absent fail-closed ────────────────

describe("runRetentionSweep (archive absent)", () => {
  it("P9A-T24: returns SKIPPED_ARCHIVE_REQUIRED and zero deletions when archive path is unset", async () => {
    const orig = process.env["OPTION_SNAPSHOT_ARCHIVE_PATH"];
    delete process.env["OPTION_SNAPSHOT_ARCHIVE_PATH"];
    const result = await runRetentionSweep();
    if (orig !== undefined) process.env["OPTION_SNAPSHOT_ARCHIVE_PATH"] = orig;
    expect(result.outcome).toBe("SKIPPED_ARCHIVE_REQUIRED");
    expect(result.snapshotRowsDeleted).toBe(0);
    expect(result.runRowsDeleted).toBe(0);
    expect(result.archiveOutcome).toBe("ARCHIVE_PROVIDER_NOT_CONFIGURED");
  });
});

// ─── P9A-T25: Scheduler idempotency ───────────────────────────────────────

describe("startOptionSnapshotIngestor idempotency", () => {
  it("P9A-T25: calling start twice with OPTION_SNAPSHOT_ENABLED=0 is a safe no-op", () => {
    const origEnabled = process.env["OPTION_SNAPSHOT_ENABLED"];
    process.env["OPTION_SNAPSHOT_ENABLED"] = "0";
    expect(() => {
      startOptionSnapshotIngestor();
      startOptionSnapshotIngestor(); // second call — idempotent
    }).not.toThrow();
    if (origEnabled !== undefined) process.env["OPTION_SNAPSHOT_ENABLED"] = origEnabled;
    else delete process.env["OPTION_SNAPSHOT_ENABLED"];
  });
});

// ─── P9A-T26 — T27: V2 hard-lock compile-time constants unchanged ─────────

describe("V2 hard-lock invariants", () => {
  it("P9A-T26: FNO_PAPER_V2_RUNTIME_AUTHORIZED is false as boolean (compile-time lock)", () => {
    // Must be exactly `false as boolean` — this is a Pack 32 compile-time guard.
    // Any change to true would activate V2 paper cohort without going through
    // the full Pack 32 activation gate sequence.
    expect(FNO_PAPER_V2_RUNTIME_AUTHORIZED).toBe(false);
  });

  it("P9A-T27: SWING_PAPER_V2_RUNTIME_AUTHORIZED is false as boolean (compile-time lock)", () => {
    expect(SWING_PAPER_V2_RUNTIME_AUTHORIZED).toBe(false);
  });
});
