import { describe, it, expect } from "vitest";

import {
  sourcePriority,
  SOURCE_PRIORITY,
  UNKNOWN_SOURCE_PRIORITY,
  candleIngestProvenance,
  candleProvenanceFromMeta,
  dataQualityFromMeta,
} from "./provenance";
import { buildMeta, unavailableMeta } from "./validator";

describe("sourcePriority", () => {
  it("ranks trust tiers (lower = more trusted)", () => {
    expect(sourcePriority("authoritative")).toBe(1);
    expect(sourcePriority("secondary_validation")).toBe(2);
    expect(sourcePriority("secondary_analytics")).toBe(3);
    expect(SOURCE_PRIORITY.authoritative).toBeLessThan(SOURCE_PRIORITY.secondary_analytics);
  });
  it("treats null/unknown as the lowest trust", () => {
    expect(sourcePriority(null)).toBe(UNKNOWN_SOURCE_PRIORITY);
    expect(sourcePriority(undefined)).toBe(UNKNOWN_SOURCE_PRIORITY);
  });
});

describe("candleIngestProvenance", () => {
  it("stamps a Kite bar as authoritative (priority 1, no fallback)", () => {
    const p = candleIngestProvenance("kite", {
      tsMs: 1_747_267_200_000,
      nowMs: 1_747_300_000_000,
      kiteInstrumentToken: 738561,
      tradingsymbol: "RELIANCE",
    });
    expect(p.sourceProvider).toBe("kite");
    expect(p.sourcePriority).toBe(1);
    expect(p.fallbackUsed).toBe(false);
    expect(p.isStale).toBe(false);
    expect(p.dataQuality).toBe("OK");
    expect(p.asof?.getTime()).toBe(1_747_267_200_000);
    expect(p.fetchedAt?.getTime()).toBe(1_747_300_000_000);
    expect(p.kiteInstrumentToken).toBe(738561);
    expect(p.tradingsymbol).toBe("RELIANCE");
    expect(p.freshnessSec).toBeNull();
  });
  it("marks a Yahoo bar lower-trust and flags the fallback", () => {
    const p = candleIngestProvenance("yahoo", { tsMs: 1_747_267_200_000 });
    expect(p.sourceProvider).toBe("yahoo");
    expect(p.sourcePriority).toBe(3);
    expect(p.fallbackUsed).toBe(true);
  });
  it("guards a non-finite timestamp", () => {
    const p = candleIngestProvenance("kite", { tsMs: Number.NaN });
    expect(p.asof).toBeNull();
  });
});

describe("candleProvenanceFromMeta", () => {
  it("maps a fresh authoritative quote meta", () => {
    const meta = buildMeta({
      source: "kite",
      trustTier: "authoritative",
      asOfMs: Date.now(),
      delayed: false,
      notForSignals: false,
      complete: true,
    });
    const p = candleProvenanceFromMeta(meta, { kiteInstrumentToken: 1, tradingsymbol: "X" });
    expect(p.sourceProvider).toBe("kite");
    expect(p.sourcePriority).toBe(1);
    expect(p.dataQuality).toBe("OK");
    expect(p.validationStatus).toBe("validated");
  });
  it("maps an unavailable meta to UNAVAILABLE quality", () => {
    const meta = unavailableMeta("kite", "authoritative", "offline");
    expect(dataQualityFromMeta(meta)).toBe("UNAVAILABLE");
    const p = candleProvenanceFromMeta(meta);
    expect(p.dataQuality).toBe("UNAVAILABLE");
    expect(p.sourcePriority).toBe(1); // tier still authoritative, just unavailable
  });
});
