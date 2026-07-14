import { describe, expect, it } from "vitest";
import {
  lifecycleKeyOf,
  mapLifecycleRow,
  type LifecycleSourceRow,
} from "./fnoSpotLifecycle";

/**
 * Pure-function assertions for the READ-ONLY spot-lifecycle enrichment.
 * These never touch the DB — they pin the composite-key construction and
 * the row→DTO mapping (string/number coercion + null handling) so the
 * reporting join can't silently start fabricating or dropping spot levels.
 */
describe("lifecycleKeyOf", () => {
  it("builds a stable \\u0001-joined 4-tuple key", () => {
    const key = lifecycleKeyOf({
      signalDate: "2026-06-03",
      indexSymbol: "NIFTY",
      setupKey: "EMA_PULLBACK",
      direction: "BULLISH",
    });
    expect(key).toBe("2026-06-03\u0001NIFTY\u0001EMA_PULLBACK\u0001BULLISH");
  });

  it("trims surrounding whitespace on each part", () => {
    const a = lifecycleKeyOf({
      signalDate: " 2026-06-03 ",
      indexSymbol: "NIFTY ",
      setupKey: " EMA_PULLBACK",
      direction: "BULLISH",
    });
    const b = lifecycleKeyOf({
      signalDate: "2026-06-03",
      indexSymbol: "NIFTY",
      setupKey: "EMA_PULLBACK",
      direction: "BULLISH",
    });
    expect(a).toBe(b);
  });

  it("does not collide across different tuples", () => {
    const bull = lifecycleKeyOf({
      signalDate: "2026-06-03",
      indexSymbol: "NIFTY",
      setupKey: "EMA_PULLBACK",
      direction: "BULLISH",
    });
    const bear = lifecycleKeyOf({
      signalDate: "2026-06-03",
      indexSymbol: "NIFTY",
      setupKey: "EMA_PULLBACK",
      direction: "BEARISH",
    });
    expect(bull).not.toBe(bear);
  });
});

describe("mapLifecycleRow", () => {
  it("coerces numeric-string columns to finite numbers", () => {
    const row: LifecycleSourceRow = {
      status: "TARGET1_HIT",
      entry: "22000.5",
      stopLoss: "21900",
      target1: "22100",
      target2: "22250.25",
      lastSpot: "22130",
      maxFavorableExcursion: "150.5",
    };
    expect(mapLifecycleRow(row)).toEqual({
      status: "TARGET1_HIT",
      spotEntry: 22000.5,
      spotStop: 21900,
      spotTarget1: 22100,
      spotTarget2: 22250.25,
      lastSpot: 22130,
      maxFavorableExcursionPts: 150.5,
    });
  });

  it("passes through numeric columns unchanged", () => {
    const row: LifecycleSourceRow = {
      status: "OPEN",
      entry: 100,
      stopLoss: 90,
      target1: 110,
      target2: 120,
      lastSpot: 105,
      maxFavorableExcursion: 8,
    };
    const out = mapLifecycleRow(row);
    expect(out.spotEntry).toBe(100);
    expect(out.maxFavorableExcursionPts).toBe(8);
  });

  it("maps null/undefined/empty values to null, never NaN or 0", () => {
    const out = mapLifecycleRow({
      status: "",
      entry: null,
      stopLoss: undefined,
      target1: "not-a-number",
      target2: null,
      lastSpot: null,
      maxFavorableExcursion: null,
    });
    expect(out.status).toBeNull();
    expect(out.spotEntry).toBeNull();
    expect(out.spotStop).toBeNull();
    expect(out.spotTarget1).toBeNull();
    expect(out.spotTarget2).toBeNull();
    expect(out.lastSpot).toBeNull();
    expect(out.maxFavorableExcursionPts).toBeNull();
  });

  it("trims a non-empty status string", () => {
    expect(mapLifecycleRow({ status: "  STOPPED  " }).status).toBe("STOPPED");
  });
});
