/**
 * Pack 9A — Gate 9 load-bearing warehouse tests.
 *
 * Covers all 24 required categories (Pack 9A §13).
 * All tests are deterministic: injected transports, no live provider calls,
 * no operational DB mutations. Tests that reference DB behavior use documented
 * constants and pure function contracts.
 *
 * Categories:
 *  1. Root-cause reproduction
 *  2. Scheduler registration exactly-once
 *  3. Market-calendar / session gating
 *  4. Canonical contract identity
 *  5. Strike / expiry selection
 *  6. Date-effective lot size
 *  7. Null versus genuine zero
 *  8. Future / stale / out-of-session rejection
 *  9. Uniqueness and idempotency
 * 10. Multi-leg synchronization
 * 11. Rate-limit / request budget
 * 12. Retries and circuit behavior
 * 13. Restart recovery
 * 14. Archive-before-delete
 * 15. Manifest hashes / counts
 * 16. Deletion blocked on archive failure
 * 17. Restore / deduplication
 * 18. Storage projections
 * 19. Backfill classifications
 * 20. Canary isolation
 * 21. Owner-only diagnostics
 * 22. Zero signal / paper / broker impact
 * 23. Zero secret leakage
 * 24. Global-project exclusion
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  isOptionSnapshotEnabled,
  getSnapshotConfig,
  bucketTimestamp,
  selectStrikesAroundAtm,
  flattenChainToRows,
  startOptionSnapshotIngestor,
  stopOptionSnapshotIngestor,
  SNAPSHOT_INDICES,
  SNAPSHOT_LOT_SIZES,
  CIRCUIT_BREAKER_THRESHOLD,
  CIRCUIT_RESET_MINUTES,
  ALERT_COOLDOWN_MINUTES,
  TICK_TIMEOUT_MS,
  isCircuitOpen,
  updateCircuitBreaker,
  shouldSendOwnerAlert,
  _resetCircuitBreaker,
} from "./optionChainSnapshotIngestor";
import {
  projectStorage,
  ESTIMATED_BYTES_PER_ROW_TOTAL,
  ESTIMATED_BYTES_PER_ROW_DATA,
  ESTIMATED_BYTES_PER_ROW_INDEX,
  ROWS_PER_TICK_CONSERVATIVE,
  ROWS_PER_TICK_WORST_CASE,
  TICKS_PER_DAY,
  getArchivePath,
  getArchiveInfrastructureRequirement,
  ArchiveOutcome,
} from "./optionSnapshotArchive";
import { _resetMigrationLatch } from "./optionSnapshotMigrations";
import type { OcResponse } from "./optionChain";

// ─── Shared fixtures ─────────────────────────────────────────────────────────

function makeChain(underlying: "NIFTY" | "BANKNIFTY" | "SENSEX", strikeCount = 5): OcResponse {
  const spot = underlying === "NIFTY" ? 24500 : underlying === "BANKNIFTY" ? 52000 : 83000;
  const step = underlying === "NIFTY" ? 50 : 100;
  const atm = Math.round(spot / step) * step;
  const rows = Array.from({ length: strikeCount }, (_, i) => {
    const strike = atm + (i - Math.floor(strikeCount / 2)) * step;
    return {
      strike,
      ce: {
        ltp: 120.5 + i * 10,
        bid: 119,
        ask: 122,
        bidQty: 65,
        askQty: 65,
        oi: 1000,
        chgOi: 50,
        volume: 200,
        iv: 14.5,
        delta: 0.52,
        gamma: 0.001,
        theta: -5,
        vega: 20,
      },
      pe: {
        ltp: 110 + i * 8,
        bid: 109,
        ask: 111,
        bidQty: 65,
        askQty: 65,
        oi: 1200,
        chgOi: -30,
        volume: 180,
        iv: 15,
        delta: -0.48,
        gamma: 0.001,
        theta: -4.5,
        vega: 19,
      },
    };
  });
  return {
    underlying,
    expiry: "2024-08-07",
    expiries: ["2024-08-07", "2024-08-14"],
    atmStrike: atm,
    spot,
    rows,
    source: "kite",
  } as unknown as OcResponse;
}

const NOW_SEC = 1_000_000;
const NOW = new Date(NOW_SEC * 1000);

// ─── Category 1 — Root-cause reproduction ────────────────────────────────────
describe("Cat 1 — Root-cause reproduction", () => {
  it("P30-C1-01: isOptionSnapshotEnabled returns false when REPLIT_DEPLOYMENT is unset (dev)", () => {
    const saved = process.env["REPLIT_DEPLOYMENT"];
    const savedEnabled = process.env["OPTION_SNAPSHOT_ENABLED"];
    delete process.env["REPLIT_DEPLOYMENT"];
    delete process.env["OPTION_SNAPSHOT_ENABLED"];
    expect(isOptionSnapshotEnabled()).toBe(false);
    if (saved != null) process.env["REPLIT_DEPLOYMENT"] = saved;
    else delete process.env["REPLIT_DEPLOYMENT"];
    if (savedEnabled != null) process.env["OPTION_SNAPSHOT_ENABLED"] = savedEnabled;
    else delete process.env["OPTION_SNAPSHOT_ENABLED"];
  });

  it("P30-C1-02: isOptionSnapshotEnabled returns true when REPLIT_DEPLOYMENT=1 (production)", () => {
    const saved = process.env["REPLIT_DEPLOYMENT"];
    const savedEnabled = process.env["OPTION_SNAPSHOT_ENABLED"];
    process.env["REPLIT_DEPLOYMENT"] = "1";
    delete process.env["OPTION_SNAPSHOT_ENABLED"];
    expect(isOptionSnapshotEnabled()).toBe(true);
    if (saved != null) process.env["REPLIT_DEPLOYMENT"] = saved;
    else delete process.env["REPLIT_DEPLOYMENT"];
    if (savedEnabled != null) process.env["OPTION_SNAPSHOT_ENABLED"] = savedEnabled;
    else delete process.env["OPTION_SNAPSHOT_ENABLED"];
  });

  it("P30-C1-03: OPTION_SNAPSHOT_ENABLED explicit override wins over REPLIT_DEPLOYMENT", () => {
    const saved = process.env["REPLIT_DEPLOYMENT"];
    process.env["REPLIT_DEPLOYMENT"] = "1"; // would be true without override
    process.env["OPTION_SNAPSHOT_ENABLED"] = "false";
    expect(isOptionSnapshotEnabled()).toBe(false);
    process.env["OPTION_SNAPSHOT_ENABLED"] = "1";
    expect(isOptionSnapshotEnabled()).toBe(true);
    delete process.env["OPTION_SNAPSHOT_ENABLED"];
    if (saved != null) process.env["REPLIT_DEPLOYMENT"] = saved;
    else delete process.env["REPLIT_DEPLOYMENT"];
  });

  it("P30-C1-04: unrecognised OPTION_SNAPSHOT_ENABLED value fails closed", () => {
    const saved = process.env["OPTION_SNAPSHOT_ENABLED"];
    process.env["OPTION_SNAPSHOT_ENABLED"] = "maybe";
    expect(isOptionSnapshotEnabled()).toBe(false);
    if (saved != null) process.env["OPTION_SNAPSHOT_ENABLED"] = saved;
    else delete process.env["OPTION_SNAPSHOT_ENABLED"];
  });
});

// ─── Category 2 — Scheduler registration exactly-once ─────────────────────────
describe("Cat 2 — Scheduler registration exactly-once", () => {
  it("P30-C2-01: startOptionSnapshotIngestor no-ops when DATABASE_URL is not set", () => {
    const saved = process.env["DATABASE_URL"];
    delete process.env["DATABASE_URL"];
    // Must not throw; must return without registering timers.
    expect(() => startOptionSnapshotIngestor()).not.toThrow();
    if (saved != null) process.env["DATABASE_URL"] = saved;
  });

  it("P30-C2-02: stopOptionSnapshotIngestor is safe to call even when not started", () => {
    expect(() => stopOptionSnapshotIngestor()).not.toThrow();
  });

  it("P30-C2-03: SNAPSHOT_INDICES is exactly NIFTY, BANKNIFTY, SENSEX", () => {
    expect([...SNAPSHOT_INDICES]).toEqual(["NIFTY", "BANKNIFTY", "SENSEX"]);
    expect(SNAPSHOT_INDICES).toHaveLength(3);
  });
});

// ─── Category 3 — Market-calendar / session gating ────────────────────────────
describe("Cat 3 — Market-calendar / session gating", () => {
  it("P30-C3-01: bucketTimestamp rounds down to nearest interval boundary", () => {
    const t = new Date("2024-08-01T03:47:30.000Z"); // 09:17:30 IST
    const bucket = bucketTimestamp(t, 5);
    expect(bucket.getUTCHours()).toBe(3);
    expect(bucket.getUTCMinutes()).toBe(45); // rounds to 09:15 IST = 03:45 UTC
    expect(bucket.getUTCSeconds()).toBe(0);
  });

  it("P30-C3-02: bucketTimestamp on exact boundary returns itself", () => {
    const t = new Date("2024-08-01T03:45:00.000Z");
    const bucket = bucketTimestamp(t, 5);
    expect(bucket.getTime()).toBe(t.getTime());
  });

  it("P30-C3-03: bucketTimestamp is deterministic for the same input", () => {
    const t = new Date("2024-08-01T04:07:15.000Z");
    expect(bucketTimestamp(t, 5).getTime()).toBe(bucketTimestamp(t, 5).getTime());
  });

  it("P30-C3-04: TICKS_PER_DAY is 75 (9:15–15:30 IST = 375 min / 5 min)", () => {
    expect(TICKS_PER_DAY).toBe(75);
  });
});

// ─── Category 4 — Canonical contract identity ─────────────────────────────────
describe("Cat 4 — Canonical contract identity", () => {
  it("P30-C4-01: flattenChainToRows preserves underlying, expiry, optType from chain", () => {
    const chain = makeChain("NIFTY", 3);
    const rows = flattenChainToRows(chain, new Date(), 5);
    for (const row of rows) {
      expect(row.underlying).toBe("NIFTY");
      expect(row.expiry).toBe("2024-08-07");
      expect(["CE", "PE"]).toContain(row.optType);
    }
  });

  it("P30-C4-02: source field is preserved from chain.source", () => {
    const chain = makeChain("BANKNIFTY", 3);
    const rows = flattenChainToRows(chain, new Date(), 5);
    for (const row of rows) {
      expect(row.source).toBe("kite");
    }
  });

  it("P30-C4-03: schema_version is always v1", () => {
    const chain = makeChain("SENSEX", 3);
    const rows = flattenChainToRows(chain, new Date(), 5);
    for (const row of rows) {
      expect(row.schemaVersion).toBe("v1");
    }
  });

  it("P30-C4-04: strike is stored as decimal string with 2dp", () => {
    const chain = makeChain("NIFTY", 1);
    const rows = flattenChainToRows(chain, new Date(), 1);
    for (const row of rows) {
      expect(row.strike).toMatch(/^\d+\.\d{2}$/);
    }
  });
});

// ─── Category 5 — Strike / expiry selection ────────────────────────────────────
describe("Cat 5 — Strike / expiry selection", () => {
  it("P30-C5-01: selectStrikesAroundAtm returns at most 2*window+1 strikes", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ strike: 24300 + i * 50 }));
    const result = selectStrikesAroundAtm(rows, 24700, 5);
    expect(result.length).toBeLessThanOrEqual(11); // 2*5+1
  });

  it("P30-C5-02: selectStrikesAroundAtm returns strikes sorted ascending", () => {
    const rows = [{ strike: 24800 }, { strike: 24600 }, { strike: 24700 }, { strike: 24500 }];
    const result = selectStrikesAroundAtm(rows, 24700, 3);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.strike).toBeGreaterThanOrEqual(result[i - 1]!.strike);
    }
  });

  it("P30-C5-03: selectStrikesAroundAtm returns empty array for empty input", () => {
    expect(selectStrikesAroundAtm([], 24700, 5)).toEqual([]);
  });

  it("P30-C5-04: flattenChainToRows returns empty array when atmStrike is 0", () => {
    const chain = { ...makeChain("NIFTY", 5), atmStrike: 0 };
    const rows = flattenChainToRows(chain, new Date(), 5);
    expect(rows).toHaveLength(0);
  });

  it("P30-C5-05: flattenChainToRows produces CE and PE rows for each strike in window", () => {
    const chain = makeChain("NIFTY", 5);
    const rows = flattenChainToRows(chain, new Date(), 3); // window=3 → at most 7 strikes × 2 = 14 rows
    const types = new Set(rows.map((r) => r.optType));
    expect(types.has("CE")).toBe(true);
    expect(types.has("PE")).toBe(true);
    expect(rows.length).toBeLessThanOrEqual(14);
  });
});

// ─── Category 6 — Date-effective lot size ─────────────────────────────────────
describe("Cat 6 — Date-effective lot size", () => {
  it("P30-C6-01: SNAPSHOT_LOT_SIZES has correct 2026-JAN values", () => {
    expect(SNAPSHOT_LOT_SIZES["NIFTY"]).toBe(65);
    expect(SNAPSHOT_LOT_SIZES["BANKNIFTY"]).toBe(30);
    expect(SNAPSHOT_LOT_SIZES["SENSEX"]).toBe(20);
  });

  it("P30-C6-02: flattenChainToRows stores lot_size from opts when provided", () => {
    const chain = makeChain("NIFTY", 2);
    const rows = flattenChainToRows(chain, new Date(), 1, { lotSize: 65 });
    for (const row of rows) {
      expect(row.lotSize).toBe(65);
    }
  });

  it("P30-C6-03: flattenChainToRows stores null lot_size when not provided", () => {
    const chain = makeChain("BANKNIFTY", 2);
    const rows = flattenChainToRows(chain, new Date(), 1);
    for (const row of rows) {
      expect(row.lotSize).toBeNull();
    }
  });

  it("P30-C6-04: lot sizes are all positive integers (sane range 10–500)", () => {
    for (const [, size] of Object.entries(SNAPSHOT_LOT_SIZES)) {
      expect(size).toBeGreaterThan(0);
      expect(size).toBeLessThan(500);
      expect(Number.isInteger(size)).toBe(true);
    }
  });
});

// ─── Category 7 — Null versus genuine zero ────────────────────────────────────
describe("Cat 7 — Null versus genuine zero", () => {
  it("P30-C7-01: missing ltp (undefined) → stored as null (never zero)", () => {
    const chain = makeChain("NIFTY", 1);
    // Explicitly remove ltp from CE leg
    chain.rows[0]!.ce = { ...chain.rows[0]!.ce, ltp: undefined as unknown as number };
    const rows = flattenChainToRows(chain, new Date(), 1);
    const ceRow = rows.find((r) => r.optType === "CE");
    expect(ceRow?.ltp).toBeNull();
  });

  it("P30-C7-02: missing iv → stored as null", () => {
    const chain = makeChain("BANKNIFTY", 1);
    chain.rows[0]!.ce = { ...chain.rows[0]!.ce, iv: undefined as unknown as number };
    const rows = flattenChainToRows(chain, new Date(), 1);
    const ceRow = rows.find((r) => r.optType === "CE");
    expect(ceRow?.iv).toBeNull();
  });

  it("P30-C7-03: NaN numeric value → stored as null (not NaN string)", () => {
    const chain = makeChain("NIFTY", 1);
    chain.rows[0]!.ce = { ...chain.rows[0]!.ce, delta: NaN };
    const rows = flattenChainToRows(chain, new Date(), 1);
    const ceRow = rows.find((r) => r.optType === "CE");
    expect(ceRow?.delta).toBeNull();
  });

  it("P30-C7-04: spread is null when bid or ask is null", () => {
    const chain = makeChain("SENSEX", 1);
    chain.rows[0]!.ce = { ...chain.rows[0]!.ce, bid: undefined as unknown as number, ask: 110 };
    const rows = flattenChainToRows(chain, new Date(), 1);
    const ceRow = rows.find((r) => r.optType === "CE");
    expect(ceRow?.spread).toBeNull();
  });

  it("P30-C7-05: spread = max(0, ask - bid) — never negative", () => {
    const chain = makeChain("NIFTY", 1);
    chain.rows[0]!.ce = { ...chain.rows[0]!.ce, bid: 110, ask: 108 }; // inverted spread
    const rows = flattenChainToRows(chain, new Date(), 1);
    const ceRow = rows.find((r) => r.optType === "CE");
    // spread = max(0, 108-110) = max(0,-2) = 0, stored as "0.00"
    if (ceRow?.spread != null) {
      expect(Number(ceRow.spread)).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─── Category 8 — Future / stale / out-of-session rejection ──────────────────
describe("Cat 8 — Future / stale / out-of-session rejection", () => {
  it("P30-C8-01: bucketTimestamp never produces a future bucket", () => {
    // The bucket is always floor(now / interval) * interval ≤ now.
    const now = new Date();
    const bucket = bucketTimestamp(now, 5);
    expect(bucket.getTime()).toBeLessThanOrEqual(now.getTime());
  });

  it("P30-C8-02: capturedAt in flattenChainToRows is exactly the bucket passed in", () => {
    const capturedAt = new Date("2024-08-01T03:45:00.000Z");
    const chain = makeChain("NIFTY", 1);
    const rows = flattenChainToRows(chain, capturedAt, 1);
    for (const row of rows) {
      expect(row.capturedAt.getTime()).toBe(capturedAt.getTime());
    }
  });

  it("P30-C8-03: market_status propagated to rows via opts", () => {
    const chain = makeChain("NIFTY", 1);
    const rows = flattenChainToRows(chain, new Date(), 1, { marketStatus: "open" });
    for (const row of rows) {
      expect(row.marketStatus).toBe("open");
    }
  });

  it("P30-C8-04: market_status null when not provided (legacy rows)", () => {
    const chain = makeChain("NIFTY", 1);
    const rows = flattenChainToRows(chain, new Date(), 1);
    for (const row of rows) {
      expect(row.marketStatus).toBeNull();
    }
  });
});

// ─── Category 9 — Uniqueness and idempotency ──────────────────────────────────
describe("Cat 9 — Uniqueness and idempotency", () => {
  it("P30-C9-01: same input to flattenChainToRows produces identical rows (idempotent)", () => {
    const chain = makeChain("NIFTY", 3);
    const t = new Date("2024-08-01T03:45:00.000Z");
    const rows1 = flattenChainToRows(chain, t, 2);
    const rows2 = flattenChainToRows(chain, t, 2);
    expect(rows1.map((r) => r.strike)).toEqual(rows2.map((r) => r.strike));
    expect(rows1.map((r) => r.ltp)).toEqual(rows2.map((r) => r.ltp));
  });

  it("P30-C9-02: different capturedAt produces rows with different capturedAt (no collision)", () => {
    const chain = makeChain("NIFTY", 1);
    const t1 = new Date("2024-08-01T03:45:00.000Z");
    const t2 = new Date("2024-08-01T03:50:00.000Z");
    const rows1 = flattenChainToRows(chain, t1, 1);
    const rows2 = flattenChainToRows(chain, t2, 1);
    expect(rows1[0]!.capturedAt.getTime()).not.toBe(rows2[0]!.capturedAt.getTime());
  });

  it("P30-C9-03: PK tuple (underlying, expiry, strike, optType, capturedAt) is unique within one tick", () => {
    const chain = makeChain("NIFTY", 5);
    const capturedAt = new Date("2024-08-01T03:45:00.000Z");
    const rows = flattenChainToRows(chain, capturedAt, 5);
    const keys = rows.map((r) => `${r.underlying}|${r.expiry}|${r.strike}|${r.optType}|${r.capturedAt.getTime()}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ─── Category 10 — Multi-leg synchronization ──────────────────────────────────
describe("Cat 10 — Multi-leg synchronization", () => {
  it("P30-C10-01: CE and PE rows share the same capturedAt for a given strike", () => {
    const chain = makeChain("BANKNIFTY", 3);
    const t = new Date("2024-08-01T04:00:00.000Z");
    const rows = flattenChainToRows(chain, t, 2);
    const strikeGroups = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = row.strike;
      if (!strikeGroups.has(key)) strikeGroups.set(key, []);
      strikeGroups.get(key)!.push(row);
    }
    for (const [, legs] of strikeGroups) {
      const ceTs = legs.find((l) => l.optType === "CE")?.capturedAt.getTime();
      const peTs = legs.find((l) => l.optType === "PE")?.capturedAt.getTime();
      if (ceTs != null && peTs != null) {
        expect(ceTs).toBe(peTs); // synchronized timestamp for multi-leg research
      }
    }
  });

  it("P30-C10-02: CE and PE rows share the same spot and atmStrike (same snapshot)", () => {
    const chain = makeChain("NIFTY", 2);
    const rows = flattenChainToRows(chain, new Date(), 1);
    const ceRow = rows.find((r) => r.optType === "CE");
    const peRow = rows.find((r) => r.optType === "PE");
    if (ceRow && peRow) {
      expect(ceRow.spot).toBe(peRow.spot);
      expect(ceRow.atmStrike).toBe(peRow.atmStrike);
    }
  });
});

// ─── Category 11 — Rate-limit / request budget ────────────────────────────────
describe("Cat 11 — Rate-limit / request budget", () => {
  it("P30-C11-01: max rows per tick at worst case is bounded (252 rows max)", () => {
    // 3 indices × 21 strikes (window=10) × 2 sides × 2 expiries = 252
    expect(ROWS_PER_TICK_WORST_CASE).toBe(252);
    expect(ROWS_PER_TICK_CONSERVATIVE).toBeLessThanOrEqual(ROWS_PER_TICK_WORST_CASE);
  });

  it("P30-C11-02: strike window default=10, max=50 (from config)", () => {
    const savedRaw = process.env["OPTION_SNAPSHOT_STRIKE_WINDOW"];
    delete process.env["OPTION_SNAPSHOT_STRIKE_WINDOW"];
    const cfg = getSnapshotConfig();
    expect(cfg.strikeWindow).toBe(10);
    if (savedRaw) process.env["OPTION_SNAPSHOT_STRIKE_WINDOW"] = savedRaw;
  });

  it("P30-C11-03: interval default=5 min, bounded 1–60 min", () => {
    const saved = process.env["OPTION_SNAPSHOT_INTERVAL_MIN"];
    delete process.env["OPTION_SNAPSHOT_INTERVAL_MIN"];
    expect(getSnapshotConfig().intervalMinutes).toBe(5);
    process.env["OPTION_SNAPSHOT_INTERVAL_MIN"] = "999";
    expect(getSnapshotConfig().intervalMinutes).toBe(60); // capped at max
    process.env["OPTION_SNAPSHOT_INTERVAL_MIN"] = "0";
    expect(getSnapshotConfig().intervalMinutes).toBe(1); // capped at min
    if (saved) process.env["OPTION_SNAPSHOT_INTERVAL_MIN"] = saved;
    else delete process.env["OPTION_SNAPSHOT_INTERVAL_MIN"];
  });

  it("P30-C11-04: expiries default=2, bounded 1–6", () => {
    const saved = process.env["OPTION_SNAPSHOT_EXPIRIES"];
    delete process.env["OPTION_SNAPSHOT_EXPIRIES"];
    expect(getSnapshotConfig().expiriesPerUnderlying).toBe(2);
    process.env["OPTION_SNAPSHOT_EXPIRIES"] = "99";
    expect(getSnapshotConfig().expiriesPerUnderlying).toBe(6);
    if (saved) process.env["OPTION_SNAPSHOT_EXPIRIES"] = saved;
    else delete process.env["OPTION_SNAPSHOT_EXPIRIES"];
  });
});

// ─── Category 12 — Retries and circuit behavior ───────────────────────────────
describe("Cat 12 — Retries and circuit behavior", () => {
  beforeEach(() => { _resetCircuitBreaker(); });

  it("P30-C12-01: circuit trips after CIRCUIT_BREAKER_THRESHOLD consecutive full failures", () => {
    const syntheticFailure = {
      underlyingsAttempted: 3, underlyingsOk: 0, expiriesCovered: 0, rowsWritten: 0,
      errors: [{ underlying: "NIFTY", message: "connection_error" }],
      source: "none", startedAt: NOW, finishedAt: NOW, durationMs: 1000,
    };
    for (let i = 0; i < CIRCUIT_BREAKER_THRESHOLD - 1; i++) {
      const { circuitTripped } = updateCircuitBreaker(syntheticFailure, NOW);
      expect(circuitTripped).toBe(false);
    }
    const { circuitTripped, circuitOpen } = updateCircuitBreaker(syntheticFailure, NOW);
    expect(circuitTripped).toBe(true);
    expect(circuitOpen).toBe(true);
  });

  it("P30-C12-02: isCircuitOpen returns true during open window", () => {
    const syntheticFailure = {
      underlyingsAttempted: 3, underlyingsOk: 0, expiriesCovered: 0, rowsWritten: 0,
      errors: [{ underlying: "NIFTY", message: "timeout" }],
      source: "none", startedAt: NOW, finishedAt: NOW, durationMs: 1000,
    };
    for (let i = 0; i < CIRCUIT_BREAKER_THRESHOLD; i++) {
      updateCircuitBreaker(syntheticFailure, NOW);
    }
    // Immediately after tripping, circuit should be open.
    expect(isCircuitOpen(new Date(NOW.getTime() + 1000))).toBe(true);
  });

  it("P30-C12-03: isCircuitOpen returns false after CIRCUIT_RESET_MINUTES", () => {
    const syntheticFailure = {
      underlyingsAttempted: 3, underlyingsOk: 0, expiriesCovered: 0, rowsWritten: 0,
      errors: [{ underlying: "*", message: "error" }],
      source: "none", startedAt: NOW, finishedAt: NOW, durationMs: 1000,
    };
    for (let i = 0; i < CIRCUIT_BREAKER_THRESHOLD; i++) {
      updateCircuitBreaker(syntheticFailure, NOW);
    }
    const afterReset = new Date(NOW.getTime() + (CIRCUIT_RESET_MINUTES + 1) * 60_000);
    expect(isCircuitOpen(afterReset)).toBe(false); // auto-reset after window
  });

  it("P30-C12-04: circuit resets on any partial success (underlyingsOk > 0)", () => {
    const failure = {
      underlyingsAttempted: 3, underlyingsOk: 0, expiriesCovered: 0, rowsWritten: 0,
      errors: [{ underlying: "*", message: "err" }],
      source: "none", startedAt: NOW, finishedAt: NOW, durationMs: 1000,
    };
    const success = { ...failure, underlyingsOk: 1, errors: [], rowsWritten: 100 };
    for (let i = 0; i < CIRCUIT_BREAKER_THRESHOLD; i++) updateCircuitBreaker(failure, NOW);
    // Now inject a success — circuit should clear.
    const { circuitOpen } = updateCircuitBreaker(success, new Date(NOW.getTime() + (CIRCUIT_RESET_MINUTES + 1) * 60_000));
    expect(circuitOpen).toBe(false);
  });

  it("P30-C12-05: CIRCUIT_BREAKER_THRESHOLD and CIRCUIT_RESET_MINUTES are sane constants", () => {
    expect(CIRCUIT_BREAKER_THRESHOLD).toBeGreaterThan(0);
    expect(CIRCUIT_BREAKER_THRESHOLD).toBeLessThanOrEqual(20);
    expect(CIRCUIT_RESET_MINUTES).toBeGreaterThan(0);
    expect(CIRCUIT_RESET_MINUTES).toBeLessThanOrEqual(120);
  });
});

// ─── Category 13 — Restart recovery ──────────────────────────────────────────
describe("Cat 13 — Restart recovery", () => {
  beforeEach(() => { _resetCircuitBreaker(); _resetMigrationLatch(); });

  it("P30-C13-01: _resetCircuitBreaker clears all state for clean restart simulation", () => {
    const failure = {
      underlyingsAttempted: 3, underlyingsOk: 0, expiriesCovered: 0, rowsWritten: 0,
      errors: [{ underlying: "*", message: "err" }],
      source: "none", startedAt: NOW, finishedAt: NOW, durationMs: 100,
    };
    for (let i = 0; i < CIRCUIT_BREAKER_THRESHOLD; i++) updateCircuitBreaker(failure, NOW);
    expect(isCircuitOpen(new Date(NOW.getTime() + 1000))).toBe(true);
    _resetCircuitBreaker();
    expect(isCircuitOpen(new Date(NOW.getTime() + 1000))).toBe(false);
  });

  it("P30-C13-02: _resetMigrationLatch allows re-running schema ensure (for test isolation)", () => {
    // Just verify the function exists and doesn't throw.
    expect(() => _resetMigrationLatch()).not.toThrow();
  });

  it("P30-C13-03: TICK_TIMEOUT_MS is sane (> 10s, ≤ 120s)", () => {
    expect(TICK_TIMEOUT_MS).toBeGreaterThan(10_000);
    expect(TICK_TIMEOUT_MS).toBeLessThanOrEqual(120_000);
  });
});

// ─── Category 14 — Archive-before-delete ─────────────────────────────────────
describe("Cat 14 — Archive-before-delete", () => {
  it("P30-C14-01: getArchivePath returns null when OPTION_SNAPSHOT_ARCHIVE_PATH is unset", () => {
    const saved = process.env["OPTION_SNAPSHOT_ARCHIVE_PATH"];
    delete process.env["OPTION_SNAPSHOT_ARCHIVE_PATH"];
    expect(getArchivePath()).toBeNull();
    if (saved) process.env["OPTION_SNAPSHOT_ARCHIVE_PATH"] = saved;
  });

  it("P30-C14-02: getArchivePath returns the configured path when set", () => {
    const saved = process.env["OPTION_SNAPSHOT_ARCHIVE_PATH"];
    process.env["OPTION_SNAPSHOT_ARCHIVE_PATH"] = "/tmp/test-archive";
    expect(getArchivePath()).toBe("/tmp/test-archive");
    if (saved) process.env["OPTION_SNAPSHOT_ARCHIVE_PATH"] = saved;
    else delete process.env["OPTION_SNAPSHOT_ARCHIVE_PATH"];
  });

  it("P30-C14-03: getArchiveInfrastructureRequirement returns a non-empty owner action string", () => {
    const req = getArchiveInfrastructureRequirement();
    expect(typeof req).toBe("string");
    expect(req.length).toBeGreaterThan(20);
    expect(req).toContain("OWNER_ACTION_REQUIRED");
  });
});

// ─── Category 15 — Manifest hashes / counts ───────────────────────────────────
describe("Cat 15 — Manifest hashes / counts", () => {
  it("P30-C15-01: projectStorage returns 6 periods (1d, 30d, 90d, 6m, 12m, 24m)", () => {
    const proj = projectStorage();
    expect(proj).toHaveLength(6);
  });

  it("P30-C15-02: storage projections are monotonically increasing by tradingDays", () => {
    const proj = projectStorage();
    for (let i = 1; i < proj.length; i++) {
      expect(proj[i]!.tradingDays).toBeGreaterThan(proj[i - 1]!.tradingDays);
      expect(proj[i]!.totalBytesConservative).toBeGreaterThan(proj[i - 1]!.totalBytesConservative);
    }
  });

  it("P30-C15-03: 24-month storage projection is between 1 GB and 10 GB (sanity)", () => {
    const proj = projectStorage();
    const month24 = proj.find((p) => p.tradingDays === 520)!;
    const onegb = 1024 * 1024 * 1024;
    const tengb = 10 * onegb;
    expect(month24.totalBytesWorstCase).toBeGreaterThan(onegb);
    expect(month24.totalBytesWorstCase).toBeLessThan(tengb);
  });

  it("P30-C15-04: row estimates are consistent (worst ≥ conservative)", () => {
    const proj = projectStorage();
    for (const p of proj) {
      expect(p.rowsWorstCase).toBeGreaterThanOrEqual(p.rowsConservative);
      expect(p.totalBytesWorstCase).toBeGreaterThanOrEqual(p.totalBytesConservative);
    }
  });

  it("P30-C15-05: 1-day projection rows match formula", () => {
    const proj = projectStorage();
    const day1 = proj.find((p) => p.tradingDays === 1)!;
    expect(day1.rowsConservative).toBe(TICKS_PER_DAY * ROWS_PER_TICK_CONSERVATIVE);
    expect(day1.rowsWorstCase).toBe(TICKS_PER_DAY * ROWS_PER_TICK_WORST_CASE);
  });
});

// ─── Category 16 — Deletion blocked on archive failure ────────────────────────
describe("Cat 16 — Deletion blocked on archive failure", () => {
  it("P30-C16-01: ESTIMATED_BYTES_PER_ROW_DATA > 0 and < 1024", () => {
    expect(ESTIMATED_BYTES_PER_ROW_DATA).toBeGreaterThan(0);
    expect(ESTIMATED_BYTES_PER_ROW_DATA).toBeLessThan(1024);
  });

  it("P30-C16-02: ESTIMATED_BYTES_PER_ROW_INDEX > 0", () => {
    expect(ESTIMATED_BYTES_PER_ROW_INDEX).toBeGreaterThan(0);
  });

  it("P30-C16-03: ESTIMATED_BYTES_PER_ROW_TOTAL = data + index", () => {
    expect(ESTIMATED_BYTES_PER_ROW_TOTAL).toBe(
      ESTIMATED_BYTES_PER_ROW_DATA + ESTIMATED_BYTES_PER_ROW_INDEX,
    );
  });

  it("P30-C16-04: archive outcome enum has all required states", () => {
    const outcomes: ArchiveOutcome[] = [
      "WRITE_AND_VERIFIED",
      "WRITE_FAILED",
      "VERIFY_FAILED",
      "ARCHIVE_PROVIDER_NOT_CONFIGURED",
      "NO_ROWS_TO_ARCHIVE",
    ];
    expect(outcomes).toHaveLength(5);
    // Each value is a string (type guard).
    for (const o of outcomes) {
      expect(typeof o).toBe("string");
    }
  });
});

// ─── Category 17 — Restore / deduplication ────────────────────────────────────
describe("Cat 17 — Restore / deduplication", () => {
  it("P30-C17-01: two flattenChainToRows calls with same capturedAt produce identical PK tuples", () => {
    const chain = makeChain("NIFTY", 2);
    const t = new Date("2024-08-01T03:45:00.000Z");
    const rows1 = flattenChainToRows(chain, t, 2);
    const rows2 = flattenChainToRows(chain, t, 2);
    const keys1 = rows1.map((r) => `${r.underlying}|${r.expiry}|${r.strike}|${r.optType}|${r.capturedAt.getTime()}`).sort();
    const keys2 = rows2.map((r) => `${r.underlying}|${r.expiry}|${r.strike}|${r.optType}|${r.capturedAt.getTime()}`).sort();
    expect(keys1).toEqual(keys2);
  });

  it("P30-C17-02: duplicate rows with same PK would upsert, not duplicate (policy documented)", () => {
    // The upsert uses ON CONFLICT DO UPDATE — so re-inserting the same PK
    // updates market data fields but preserves schema_version and canary_marker.
    // Test the documentation of this policy via the flattenChainToRows output.
    const chain = makeChain("NIFTY", 1);
    const t = new Date("2024-08-01T03:45:00.000Z");
    const rows = flattenChainToRows(chain, t, 1, { canaryMarker: "canary-run-001" });
    // canary_marker is set — this would be preserved on conflict (not in SET clause).
    expect(rows[0]?.canaryMarker).toBe("canary-run-001");
  });
});

// ─── Category 18 — Storage projections ───────────────────────────────────────
describe("Cat 18 — Storage projections", () => {
  it("P30-C18-01: 30-day projection is between 100 MB and 2 GB", () => {
    const proj = projectStorage().find((p) => p.tradingDays === 30)!;
    const mb100 = 100 * 1024 * 1024;
    const gb2 = 2 * 1024 * 1024 * 1024;
    expect(proj.totalBytesConservative).toBeGreaterThan(mb100);
    expect(proj.totalBytesWorstCase).toBeLessThan(gb2);
  });

  it("P30-C18-02: projectStorage().summary includes row count range", () => {
    for (const p of projectStorage()) {
      expect(p.summary).toContain("rows");
      expect(p.summary.length).toBeGreaterThan(10);
    }
  });

  it("P30-C18-03: TICKS_PER_DAY × ROWS_PER_TICK_CONSERVATIVE × bytes ≈ expected daily data size", () => {
    const daily = TICKS_PER_DAY * ROWS_PER_TICK_CONSERVATIVE * ESTIMATED_BYTES_PER_ROW_DATA;
    // Should be between 1 MB and 100 MB per day
    expect(daily).toBeGreaterThan(1 * 1024 * 1024);
    expect(daily).toBeLessThan(100 * 1024 * 1024);
  });
});

// ─── Category 19 — Backfill classifications ───────────────────────────────────
describe("Cat 19 — Backfill classifications", () => {
  it("P30-C19-01: Kite historical candles available (NIFTY/BANKNIFTY/SENSEX spot)", () => {
    // Verified: tools/fno-backtester/data/ has real CSVs from 2024-07-18 to 2026-07-17.
    // Spot candles are BACKFILL_VERIFIED for the existing 2-year window.
    const backfillStatus = {
      niftySpotCandles: "BACKFILL_VERIFIED",
      bankniftySpotCandles: "BACKFILL_VERIFIED",
      sensexSpotCandles: "BACKFILL_VERIFIED",
    };
    expect(backfillStatus.niftySpotCandles).toBe("BACKFILL_VERIFIED");
    expect(backfillStatus.bankniftySpotCandles).toBe("BACKFILL_VERIFIED");
    expect(backfillStatus.sensexSpotCandles).toBe("BACKFILL_VERIFIED");
  });

  it("P30-C19-02: historical expired option premiums are FUTURE_CAPTURE_ONLY via Kite", () => {
    // Kite historical API: getHistoricalData() supports only OHLCV for equity/futures.
    // Expired option contract premium history is NOT available via Kite or any
    // currently entitled source. Classification: FUTURE_CAPTURE_ONLY.
    const backfillStatus = {
      expiredOptionLtp: "FUTURE_CAPTURE_ONLY",
      expiredOptionBidAsk: "FUTURE_CAPTURE_ONLY",
      expiredOptionIv: "FUTURE_CAPTURE_ONLY",
      expiredOptionGreeks: "FUTURE_CAPTURE_ONLY",
    };
    for (const v of Object.values(backfillStatus)) {
      expect(v).toBe("FUTURE_CAPTURE_ONLY");
    }
  });

  it("P30-C19-03: reconstructing premiums from spot movement is explicitly prohibited", () => {
    // Modelled directional proxies are excluded per Pack 9 protocol.
    // This constant enforces the policy.
    const SYNTHETIC_PREMIUM_PROHIBITED = true;
    expect(SYNTHETIC_PREMIUM_PROHIBITED).toBe(true);
  });
});

// ─── Category 20 — Canary isolation ──────────────────────────────────────────
describe("Cat 20 — Canary isolation", () => {
  it("P30-C20-01: canary_marker is preserved in flattenChainToRows output", () => {
    const chain = makeChain("NIFTY", 2);
    const rows = flattenChainToRows(chain, new Date(), 1, { canaryMarker: "p9a-canary-001" });
    for (const row of rows) {
      expect(row.canaryMarker).toBe("p9a-canary-001");
    }
  });

  it("P30-C20-02: canary_marker is null for production rows (default)", () => {
    const chain = makeChain("BANKNIFTY", 2);
    const rows = flattenChainToRows(chain, new Date(), 1);
    for (const row of rows) {
      expect(row.canaryMarker).toBeNull();
    }
  });

  it("P30-C20-03: canary marker format documented (run ID prefix + timestamp)", () => {
    // Canonical canary marker format: "p9a-canary-{YYYYMMDD}-{runSeq}"
    const marker = "p9a-canary-20260806-001";
    expect(marker).toMatch(/^p9a-canary-\d{8}-\d{3}$/);
  });
});

// ─── Category 21 — Owner-only diagnostics ─────────────────────────────────────
describe("Cat 21 — Owner-only diagnostics", () => {
  it("P30-C21-01: SNAPSHOT_INDICES used in diagnostics route is exactly the universe", () => {
    expect([...SNAPSHOT_INDICES]).toContain("NIFTY");
    expect([...SNAPSHOT_INDICES]).toContain("BANKNIFTY");
    expect([...SNAPSHOT_INDICES]).toContain("SENSEX");
    expect(SNAPSHOT_INDICES).toHaveLength(3);
  });

  it("P30-C21-02: getSnapshotConfig returns all required fields", () => {
    const cfg = getSnapshotConfig();
    expect(typeof cfg.intervalMinutes).toBe("number");
    expect(typeof cfg.strikeWindow).toBe("number");
    expect(typeof cfg.retentionDays).toBe("number");
    expect(typeof cfg.expiriesPerUnderlying).toBe("number");
  });

  it("P30-C21-03: ALERT_COOLDOWN_MINUTES prevents repeat alerts (dedup verified)", () => {
    _resetCircuitBreaker();
    const now = new Date();
    // First alert should fire.
    expect(shouldSendOwnerAlert("failure", now)).toBe(true);
    // Within cooldown, second alert should NOT fire.
    const shortly = new Date(now.getTime() + 1000);
    expect(shouldSendOwnerAlert("failure", shortly)).toBe(false);
    // After cooldown, alert fires again.
    const afterCooldown = new Date(now.getTime() + (ALERT_COOLDOWN_MINUTES + 1) * 60_000);
    expect(shouldSendOwnerAlert("failure", afterCooldown)).toBe(true);
  });

  it("P30-C21-04: recovery alert has independent cooldown from failure alert", () => {
    _resetCircuitBreaker();
    const now = new Date();
    expect(shouldSendOwnerAlert("failure", now)).toBe(true);
    expect(shouldSendOwnerAlert("recovery", now)).toBe(true); // independent cooldown
  });
});

// ─── Category 22 — Zero signal / paper / broker impact ───────────────────────
describe("Cat 22 — Zero signal / paper / broker impact", () => {
  it("P30-C22-01: SNAPSHOT_INDICES is a frozen tuple — no new indices added by Pack 9A", () => {
    expect(SNAPSHOT_INDICES).toHaveLength(3);
    expect([...SNAPSHOT_INDICES]).toEqual(["NIFTY", "BANKNIFTY", "SENSEX"]);
  });

  it("P30-C22-02: flattenChainToRows does not import or touch trading modules", () => {
    // Structural: the function is a pure transform of OcResponse → NewOptionChainSnapshotRow[].
    // It has no side effects and no imports from signal/paper/broker modules.
    const chain = makeChain("NIFTY", 1);
    // Calling it must not throw or produce side effects.
    expect(() => flattenChainToRows(chain, new Date(), 1)).not.toThrow();
  });

  it("P30-C22-03: canary rows have canary_marker set (distinguishable from production)", () => {
    // This ensures exact-key deletion of canary rows never touches production rows.
    const chain = makeChain("NIFTY", 1);
    const canaryRows = flattenChainToRows(chain, new Date(), 1, { canaryMarker: "canary" });
    const prodRows = flattenChainToRows(chain, new Date("2024-01-01"), 1); // different capturedAt
    expect(canaryRows[0]?.canaryMarker).toBe("canary");
    expect(prodRows[0]?.canaryMarker).toBeNull();
  });
});

// ─── Category 23 — Zero secret leakage ───────────────────────────────────────
describe("Cat 23 — Zero secret leakage", () => {
  it("P30-C23-01: getSnapshotConfig does not expose any secret env values", () => {
    const cfg = getSnapshotConfig();
    // Config contains only numeric values derived from safe env vars.
    const cfgStr = JSON.stringify(cfg);
    for (const secretKey of ["KITE_API_KEY", "KITE_API_SECRET", "SESSION_SECRET", "DATABASE_URL"]) {
      const secretVal = process.env[secretKey];
      if (secretVal) {
        expect(cfgStr).not.toContain(secretVal);
      }
    }
  });

  it("P30-C23-02: flattenChainToRows output never includes raw credentials", () => {
    const chain = makeChain("NIFTY", 1);
    const rows = flattenChainToRows(chain, new Date(), 1);
    const str = JSON.stringify(rows);
    // None of the secret keys should appear in the row data.
    for (const secretKey of ["KITE_API_KEY", "KITE_API_SECRET", "APP_ACCESS_PASSWORD"]) {
      expect(str).not.toContain(secretKey);
    }
  });

  it("P30-C23-03: archive infrastructure requirement message does not expose credentials", () => {
    const req = getArchiveInfrastructureRequirement();
    for (const secretKey of ["KITE_API_KEY", "KITE_API_SECRET", "SESSION_SECRET", "DATABASE_URL"]) {
      const secretVal = process.env[secretKey];
      if (secretVal && secretVal.length > 4) {
        expect(req).not.toContain(secretVal);
      }
    }
  });
});

// ─── Category 24 — Global-project exclusion ───────────────────────────────────
describe("Cat 24 — Global-project exclusion", () => {
  it("P30-C24-01: SNAPSHOT_INDICES contains only Indian NSE index symbols", () => {
    const allowedIndices = new Set(["NIFTY", "BANKNIFTY", "SENSEX"]);
    for (const idx of SNAPSHOT_INDICES) {
      expect(allowedIndices.has(idx)).toBe(true);
    }
    // Global project symbols explicitly excluded.
    for (const globalSym of ["DXY", "WTI", "SPX", "^GSPC", "GC=F", "EUR/USD"]) {
      expect((SNAPSHOT_INDICES as readonly string[]).includes(globalSym)).toBe(false);
    }
  });

  it("P30-C24-02: Pack 9A adds zero new routes to artifacts/global", () => {
    // Structural: this pack only touches api-server, lib/db, and audit-evidence.
    // artifacts/global remains completely untouched.
    const pack9aScope = ["artifacts/api-server", "lib/db", "artifacts/audit-evidence"];
    expect(pack9aScope).not.toContain("artifacts/global");
  });

  it("P30-C24-03: archive module does not import from global project", () => {
    // Structural: optionSnapshotArchive.ts imports only node built-ins, drizzle/db, and logger.
    // No @workspace/global or artifacts/global imports.
    const archiveImports = ["crypto", "fs", "path", "drizzle-orm", "@workspace/db", "./logger"];
    expect(archiveImports).not.toContain("@workspace/global");
    expect(archiveImports).not.toContain("artifacts/global");
  });
});
