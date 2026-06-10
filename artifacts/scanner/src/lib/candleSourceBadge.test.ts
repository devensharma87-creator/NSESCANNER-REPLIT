import { describe, it, expect } from "vitest";
import { candleSourceBadge, type CandleProvenance } from "./stocksToWatchView";

const cp = (over: Partial<CandleProvenance>): CandleProvenance => ({
  scanDate: "2026-06-10",
  bySource: { kite: 480, yahoo: 0 },
  noBarsCount: 0,
  dominant: "kite",
  asOf: "2026-06-09T10:00:00.000Z",
  ...over,
});

describe("candleSourceBadge", () => {
  it("returns null when provenance is null or undefined (honest 'unavailable')", () => {
    expect(candleSourceBadge(null)).toBeNull();
    expect(candleSourceBadge(undefined)).toBeNull();
  });

  it("kite-dominant → Kite source, delayed (EOD), no fallback", () => {
    const b = candleSourceBadge(cp({ dominant: "kite", bySource: { kite: 480, yahoo: 0 } }))!;
    expect(b.source).toBe("kite");
    expect(b.status).toBe("delayed");
    expect(b.fallbackActive).toBe(false);
    expect(b.note).toMatch(/Kite/);
    expect(b.asOf).toBe("2026-06-09T10:00:00.000Z");
  });

  it("yahoo-dominant → Yahoo source with fallback flagged", () => {
    const b = candleSourceBadge(cp({ dominant: "yahoo", bySource: { kite: 0, yahoo: 470 } }))!;
    expect(b.source).toBe("yahoo");
    expect(b.fallbackActive).toBe(true);
    expect(b.note).toMatch(/Yahoo/);
  });

  it("mixed → mixed source, fallback flagged, counts in note", () => {
    const b = candleSourceBadge(cp({ dominant: "mixed", bySource: { kite: 300, yahoo: 180 } }))!;
    expect(b.source).toBe("mixed");
    expect(b.fallbackActive).toBe(true);
    expect(b.note).toContain("300 Kite");
    expect(b.note).toContain("180 Yahoo");
  });

  it("none → unknown source, down status, never fabricated", () => {
    const b = candleSourceBadge(cp({ dominant: "none", bySource: { kite: 0, yahoo: 0 } }))!;
    expect(b.source).toBe("unknown");
    expect(b.status).toBe("down");
    expect(b.fallbackActive).toBe(false);
    expect(b.note).toMatch(/unavailable/i);
  });
});
