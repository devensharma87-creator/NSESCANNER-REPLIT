/**
 * Pure-function tests for the option-chain snapshot ingestor.
 *
 * Live-DB integration is exercised manually via the diagnostic endpoint
 * and the optional `runIngestionTick({ force: true })` owner action.
 * These tests cover only the bucketing + transformation layer that we
 * MUST get right before any DB write happens.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  bucketTimestamp,
  selectStrikesAroundAtm,
  flattenChainToRows,
  isOptionSnapshotEnabled,
  getSnapshotConfig,
  SNAPSHOT_INDICES,
} from "./optionChainSnapshotIngestor";
import type { OcResponse } from "./optionChain";

describe("bucketTimestamp", () => {
  it("rounds DOWN to the nearest interval", () => {
    const t = (iso: string) => new Date(iso);
    expect(bucketTimestamp(t("2026-05-15T10:03:14.000Z"), 5).toISOString())
      .toBe("2026-05-15T10:00:00.000Z");
    expect(bucketTimestamp(t("2026-05-15T10:07:59.999Z"), 5).toISOString())
      .toBe("2026-05-15T10:05:00.000Z");
    expect(bucketTimestamp(t("2026-05-15T10:14:00.000Z"), 5).toISOString())
      .toBe("2026-05-15T10:10:00.000Z");
  });

  it("respects different bucket sizes", () => {
    const ts = new Date("2026-05-15T10:23:14.000Z");
    expect(bucketTimestamp(ts, 1).toISOString()).toBe("2026-05-15T10:23:00.000Z");
    expect(bucketTimestamp(ts, 15).toISOString()).toBe("2026-05-15T10:15:00.000Z");
    expect(bucketTimestamp(ts, 30).toISOString()).toBe("2026-05-15T10:00:00.000Z");
  });

  it("is idempotent at bucket boundaries", () => {
    const boundary = new Date("2026-05-15T10:05:00.000Z");
    expect(bucketTimestamp(boundary, 5).toISOString()).toBe("2026-05-15T10:05:00.000Z");
  });
});

describe("selectStrikesAroundAtm", () => {
  const rows = [
    { strike: 24800 }, { strike: 24850 }, { strike: 24900 },
    { strike: 24950 }, { strike: 25000 }, { strike: 25050 },
    { strike: 25100 }, { strike: 25150 }, { strike: 25200 },
  ];

  it("returns 2*window+1 closest strikes", () => {
    const out = selectStrikesAroundAtm(rows, 25000, 2);
    expect(out.map((r) => r.strike)).toEqual([24900, 24950, 25000, 25050, 25100]);
  });

  it("re-sorts by strike ascending after distance pick", () => {
    const out = selectStrikesAroundAtm(rows, 24950, 1);
    expect(out.map((r) => r.strike)).toEqual([24900, 24950, 25000]);
  });

  it("handles ATM at the edge by extending the window in the available direction", () => {
    // ATM=24800 (the smallest strike). Closest 2*3+1=7 by distance are
    // 24800..25100 — the function does NOT artificially clip when one
    // side runs out; it just keeps walking the other direction. This is
    // the desired behaviour: we always store as much context as the
    // chain has, even when the chain is asymmetric around ATM.
    const out = selectStrikesAroundAtm(rows, 24800, 3);
    expect(out.map((r) => r.strike)).toEqual([24800, 24850, 24900, 24950, 25000, 25050, 25100]);
  });

  it("returns all rows when 2*window+1 exceeds the chain length", () => {
    const small = [{ strike: 100 }, { strike: 200 }, { strike: 300 }];
    const out = selectStrikesAroundAtm(small, 200, 50);
    expect(out.map((r) => r.strike)).toEqual([100, 200, 300]);
  });

  it("returns empty for empty input", () => {
    expect(selectStrikesAroundAtm([], 25000, 5)).toEqual([]);
  });
});

describe("flattenChainToRows", () => {
  const baseChain: OcResponse = {
    underlying: "NIFTY",
    underlyingName: "NIFTY 50",
    kind: "INDEX",
    spot: 25012.5,
    prevClose: 24980,
    changePercent: 0.13,
    expiry: "2026-05-21",
    expiries: ["2026-05-21", "2026-05-28"],
    atmStrike: 25000,
    strikeStep: 50,
    lotSize: 75,
    maxPainStrike: 25000,
    source: "kite",
    generatedAt: "2026-05-15T10:00:00.000Z",
    rows: [
      {
        strike: 24950,
        ce: { ltp: 95.5, oi: 12000, chgOi: 500, volume: 3000, iv: 14.5, bid: 95, ask: 96, bidQty: 75, askQty: 150, delta: 0.62, gamma: 0.001, theta: -1.2, vega: 8.5 },
        pe: { ltp: 32.0, oi: 9500, chgOi: -200, volume: 1500, iv: 14.0, bid: 31.5, ask: 32.5, delta: -0.38 },
      },
      {
        strike: 25000,
        ce: { ltp: 65, oi: 25000, chgOi: 1500, volume: 6000, iv: 14.2, bid: 64.5, ask: 65.5 },
        pe: { ltp: 52, oi: 22000, chgOi: 1200, volume: 4500, iv: 14.1, bid: 51.5, ask: 52.5 },
      },
      {
        strike: 25050,
        ce: { ltp: 40, oi: 11000, chgOi: 800, volume: 2500 },
        pe: { ltp: 78, oi: 8000, chgOi: -100, volume: 1800 },
      },
    ],
  };

  it("emits one row per leg within the ATM window", () => {
    const captured = new Date("2026-05-15T10:00:00.000Z");
    const out = flattenChainToRows(baseChain, captured, 1);
    expect(out).toHaveLength(6); // 3 strikes * 2 sides
    expect(out.every((r) => r.underlying === "NIFTY")).toBe(true);
    expect(out.every((r) => r.expiry === "2026-05-21")).toBe(true);
    expect(out.every((r) => r.capturedAt === captured)).toBe(true);
    expect(out.every((r) => r.source === "kite")).toBe(true);
  });

  it("computes spread = ask - bid when both present", () => {
    const out = flattenChainToRows(baseChain, new Date(), 1);
    const ce25k = out.find((r) => r.strike === "25000.00" && r.optType === "CE")!;
    expect(ce25k.spread).toBe("1.00");
  });

  it("leaves spread null when bid or ask is missing", () => {
    const out = flattenChainToRows(baseChain, new Date(), 1);
    const ce25050 = out.find((r) => r.strike === "25050.00" && r.optType === "CE")!;
    expect(ce25050.spread).toBeNull();
    expect(ce25050.bid).toBeNull();
  });

  it("formats numerics as drizzle-numeric strings, ints as numbers", () => {
    const out = flattenChainToRows(baseChain, new Date(), 1);
    const ce24950 = out.find((r) => r.strike === "24950.00" && r.optType === "CE")!;
    expect(typeof ce24950.ltp).toBe("string");
    expect(ce24950.ltp).toBe("95.50");
    expect(typeof ce24950.oi).toBe("number");
    expect(ce24950.oi).toBe(12000);
    expect(ce24950.delta).toBe("0.6200");
  });

  it("returns [] when atmStrike is 0 (defensive)", () => {
    const broken = { ...baseChain, atmStrike: 0 } as OcResponse;
    expect(flattenChainToRows(broken, new Date(), 5)).toEqual([]);
  });

  it("respects strikeWindow (window=0 → just ATM strike)", () => {
    const out = flattenChainToRows(baseChain, new Date(), 0);
    expect(out).toHaveLength(2); // ATM only, CE+PE
    expect(out.every((r) => r.strike === "25000.00")).toBe(true);
  });
});

describe("isOptionSnapshotEnabled", () => {
  const orig = { ...process.env };
  afterEach(() => {
    process.env = { ...orig };
  });

  it("respects explicit truthy override", () => {
    process.env["OPTION_SNAPSHOT_ENABLED"] = "true";
    process.env["REPLIT_DEPLOYMENT"] = "0";
    expect(isOptionSnapshotEnabled()).toBe(true);
  });

  it("respects explicit falsy override", () => {
    process.env["OPTION_SNAPSHOT_ENABLED"] = "0";
    process.env["REPLIT_DEPLOYMENT"] = "1";
    expect(isOptionSnapshotEnabled()).toBe(false);
  });

  it("fails closed on unrecognised override value", () => {
    process.env["OPTION_SNAPSHOT_ENABLED"] = "maybe";
    process.env["REPLIT_DEPLOYMENT"] = "1";
    expect(isOptionSnapshotEnabled()).toBe(false);
  });

  it("falls back to REPLIT_DEPLOYMENT when override unset", () => {
    delete process.env["OPTION_SNAPSHOT_ENABLED"];
    process.env["REPLIT_DEPLOYMENT"] = "1";
    expect(isOptionSnapshotEnabled()).toBe(true);
    process.env["REPLIT_DEPLOYMENT"] = "0";
    expect(isOptionSnapshotEnabled()).toBe(false);
  });
});

describe("getSnapshotConfig", () => {
  it("provides safe defaults", () => {
    const orig = { ...process.env };
    delete process.env["OPTION_SNAPSHOT_INTERVAL_MIN"];
    delete process.env["OPTION_SNAPSHOT_STRIKE_WINDOW"];
    delete process.env["OPTION_SNAPSHOT_RETENTION_DAYS"];
    delete process.env["OPTION_SNAPSHOT_EXPIRIES"];
    const cfg = getSnapshotConfig();
    expect(cfg.intervalMinutes).toBe(5);
    expect(cfg.strikeWindow).toBe(10);
    // Long by design: option-chain snapshots are the substrate for a future
    // faithful 2yr Backtest-Lab replay, so the sweep must not purge that window.
    expect(cfg.retentionDays).toBe(825);
    expect(cfg.expiriesPerUnderlying).toBe(2);
    process.env = orig;
  });

  it("clamps values to safe ranges", () => {
    const orig = { ...process.env };
    process.env["OPTION_SNAPSHOT_INTERVAL_MIN"] = "9999";
    process.env["OPTION_SNAPSHOT_STRIKE_WINDOW"] = "0";
    process.env["OPTION_SNAPSHOT_RETENTION_DAYS"] = "-5";
    process.env["OPTION_SNAPSHOT_EXPIRIES"] = "abc";
    const cfg = getSnapshotConfig();
    expect(cfg.intervalMinutes).toBe(60); // clamped to max
    expect(cfg.strikeWindow).toBe(1); // clamped to min
    expect(cfg.retentionDays).toBe(1); // clamped to min
    expect(cfg.expiriesPerUnderlying).toBe(2); // NaN → fallback
    process.env = orig;
  });
});

describe("SNAPSHOT_INDICES", () => {
  it("matches the F&O active universe (NIFTY/BANKNIFTY/SENSEX only)", () => {
    expect([...SNAPSHOT_INDICES]).toEqual(["NIFTY", "BANKNIFTY", "SENSEX"]);
  });
});
