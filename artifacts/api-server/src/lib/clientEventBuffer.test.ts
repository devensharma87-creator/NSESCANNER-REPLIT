/**
 * Client-event ring buffer + IST minute bucketing test.
 *
 * Guards the invariants of the in-memory drain that feeds
 * `/api/observability/summary`:
 *
 *   • Events written after the `since` cutoff appear in buckets.
 *   • IST minute boundaries carry the +05:30 offset in the bucketStart
 *     ISO string.
 *   • Degradation events feed the `topDegradingChips` ranking and
 *     bump `totalDegradations`; recoveries feed `totalRecoveries`
 *     without polluting the degradation count.
 *   • Windows past the buffer's 240-minute cap are clamped, so the
 *     summary never grows unboundedly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  recordClientEvent,
  summariseClientEvents,
  _resetClientEventBuffer,
} from "./clientEventBuffer";

const FIXED_NOW = new Date("2026-07-15T09:30:00.000Z").getTime();

beforeEach(() => {
  _resetClientEventBuffer();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXED_NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("clientEventBuffer", () => {
  it("records and summarises a single degradation event", () => {
    recordClientEvent({
      kind: "unified_grade_downgrade",
      chipId: "scanner-boot",
      fromGrade: "KITE_TRADE_GRADE",
      toGrade: "INFO_ONLY",
      source: "kite",
      sessionId: "s1",
      page: "/scanner",
      wasDegradation: true,
    });
    const s = summariseClientEvents(
      new Date(FIXED_NOW - 60_000).toISOString(),
    );
    expect(s.totalEvents).toBe(1);
    expect(s.totalDegradations).toBe(1);
    expect(s.totalRecoveries).toBe(0);
    expect(s.buckets).toHaveLength(1);
    // IST bucket string carries +05:30 offset for the render layer.
    expect(s.buckets[0]!.bucketStart).toMatch(/\+05:30$/);
    expect(s.buckets[0]!.degradations).toBe(1);
    expect(s.topDegradingChips[0]).toEqual({ chipId: "scanner-boot", degradations: 1 });
  });

  it("recovery event is counted in totalRecoveries, not degradations", () => {
    recordClientEvent({
      kind: "unified_grade_downgrade",
      chipId: "option-chain-analytics",
      fromGrade: "INFO_ONLY",
      toGrade: "KITE_TRADE_GRADE",
      source: "kite",
      sessionId: "s2",
      page: "/option-chain",
      wasDegradation: false,
    });
    const s = summariseClientEvents(
      new Date(FIXED_NOW - 60_000).toISOString(),
    );
    expect(s.totalEvents).toBe(1);
    expect(s.totalDegradations).toBe(0);
    expect(s.totalRecoveries).toBe(1);
    expect(s.topDegradingChips).toEqual([]);
    expect(s.buckets[0]!.recoveries).toBe(1);
  });

  it("groups multiple events into one minute bucket + ranks by chipId", () => {
    for (let i = 0; i < 5; i++) {
      recordClientEvent({
        kind: "unified_grade_downgrade",
        chipId: "scanner-boot",
        fromGrade: "KITE_TRADE_GRADE",
        toGrade: "INFO_ONLY",
        source: "kite",
        sessionId: `s-${i}`,
        page: "/scanner",
        wasDegradation: true,
      });
    }
    for (let i = 0; i < 3; i++) {
      recordClientEvent({
        kind: "unified_grade_downgrade",
        chipId: "option-chain-analytics",
        fromGrade: "KITE_TRADE_GRADE",
        toGrade: "UNAVAILABLE",
        source: "kite",
        sessionId: `s-oc-${i}`,
        page: "/option-chain",
        wasDegradation: true,
      });
    }
    const s = summariseClientEvents(
      new Date(FIXED_NOW - 60_000).toISOString(),
    );
    expect(s.totalDegradations).toBe(8);
    expect(s.buckets).toHaveLength(1);
    expect(s.buckets[0]!.degradations).toBe(8);
    expect(s.topDegradingChips).toEqual([
      { chipId: "scanner-boot", degradations: 5 },
      { chipId: "option-chain-analytics", degradations: 3 },
    ]);
  });

  it("clamps `since` older than 240 minutes to the buffer max", () => {
    const ancient = new Date(FIXED_NOW - 10 * 60 * 60_000).toISOString();
    const s = summariseClientEvents(ancient);
    // No events at all, so nothing shows — but the window must be
    // clamped to <= 240 min, not 10h.
    const start = Date.parse(s.windowStart.replace("+05:30", "Z")) - 5.5 * 60 * 60_000;
    const end = Date.parse(s.windowEnd.replace("+05:30", "Z")) - 5.5 * 60 * 60_000;
    const spanMinutes = (end - start) / 60_000;
    expect(spanMinutes).toBeLessThanOrEqual(240);
  });

  it("invalid `since` falls back to now − 60 min silently (no throw)", () => {
    // Pre-record one event exactly 30 min ago so the fallback window catches it.
    vi.setSystemTime(new Date(FIXED_NOW - 30 * 60_000));
    recordClientEvent({
      kind: "unified_grade_downgrade",
      chipId: "sectors-rollup",
      fromGrade: "INFO_ONLY",
      toGrade: "UNAVAILABLE",
      source: "scanner_cache",
      sessionId: undefined,
      page: undefined,
      wasDegradation: false,
    });
    vi.setSystemTime(new Date(FIXED_NOW));
    const s = summariseClientEvents("garbage-not-a-date");
    expect(s.totalEvents).toBe(1);
  });
});
