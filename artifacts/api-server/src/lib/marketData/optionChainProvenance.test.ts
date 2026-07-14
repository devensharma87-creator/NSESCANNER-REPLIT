import { describe, it, expect } from "vitest";
import {
  classifyOcSource,
  OC_SOURCE_PRIORITY,
  buildOptionChainProvenance,
  premiumTrustVerdict,
} from "./optionChainProvenance";
import type { OcResponse } from "../optionChain";

const NOW = Date.parse("2026-06-10T06:00:00.000Z");
const TODAY = new Date(NOW).toISOString().slice(0, 10);

function chain(overrides: Partial<OcResponse> = {}): OcResponse {
  return {
    underlying: "NIFTY",
    underlyingName: "NIFTY",
    kind: "INDEX",
    spot: 23000,
    prevClose: 22950,
    changePercent: 0.2,
    expiry: "2026-06-25",
    expiries: ["2026-06-25"],
    atmStrike: 23000,
    strikeStep: 50,
    lotSize: 50,
    maxPainStrike: 23000,
    rows: [
      { strike: 23000, ce: { ltp: 120, oi: 100000 }, pe: { ltp: 110, oi: 90000 } },
    ] as OcResponse["rows"],
    source: "kite",
    generatedAt: new Date(NOW).toISOString(),
    spotSource: "kite" as const,
    spotTrusted: true,
    ...overrides,
  };
}

describe("classifyOcSource", () => {
  it("maps known providers case-insensitively", () => {
    expect(classifyOcSource("kite")).toBe("kite");
    expect(classifyOcSource("KITE")).toBe("kite");
    expect(classifyOcSource("NSE")).toBe("nse");
    expect(classifyOcSource("yahoo")).toBe("yahoo");
  });
  it("treats empty/unknown as unknown", () => {
    expect(classifyOcSource("")).toBe("unknown");
    expect(classifyOcSource(undefined)).toBe("unknown");
    expect(classifyOcSource("something-else")).toBe("unknown");
  });
});

describe("buildOptionChainProvenance — trusted Kite chain", () => {
  const prov = buildOptionChainProvenance(chain(), { nowMs: NOW });
  it("is trusted for signals", () => {
    expect(prov.sourceProvider).toBe("kite");
    expect(prov.sourcePriority).toBe(OC_SOURCE_PRIORITY.kite);
    expect(prov.fallbackUsed).toBe(false);
    expect(prov.trustedForSignals).toBe(true);
    expect(prov.missingReason).toBeNull();
    expect(prov.isStale).toBe(false);
    expect(prov.exchange).toBe("NFO");
    expect(prov.legCount).toBe(2);
    expect(prov.oiLegCount).toBe(2);
  });
  it("premium verdict trusts it", () => {
    expect(premiumTrustVerdict(prov)).toEqual({ trusted: true, reason: null });
  });
});

describe("buildOptionChainProvenance — NSE fallback", () => {
  const prov = buildOptionChainProvenance(chain({ source: "NSE" }), { nowMs: NOW });
  it("is a labelled fallback, never trusted for signals", () => {
    expect(prov.sourceProvider).toBe("nse");
    expect(prov.fallbackUsed).toBe(true);
    expect(prov.trustedForSignals).toBe(false);
    expect(prov.warnings.some((w) => /NSE fallback/i.test(w))).toBe(true);
  });
  it("premium verdict rejects with a concrete reason", () => {
    const v = premiumTrustVerdict(prov);
    expect(v.trusted).toBe(false);
    expect(v.reason).toMatch(/nse.*fallback/i);
  });
});

describe("buildOptionChainProvenance — Yahoo & unknown never trusted", () => {
  for (const src of ["yahoo", "weird-source", ""]) {
    it(`source "${src}" is fallback + untrusted`, () => {
      const prov = buildOptionChainProvenance(chain({ source: src }), { nowMs: NOW });
      expect(prov.fallbackUsed).toBe(true);
      expect(prov.trustedForSignals).toBe(false);
      expect(premiumTrustVerdict(prov).trusted).toBe(false);
    });
  }
});

describe("buildOptionChainProvenance — stale Kite chain", () => {
  const prov = buildOptionChainProvenance(
    chain({ generatedAt: "2026-06-09T06:00:00.000Z" }),
    { nowMs: NOW },
  );
  it("is stale and not trusted despite being Kite", () => {
    expect(prov.sourceProvider).toBe("kite");
    expect(prov.isStale).toBe(true);
    expect(prov.trustedForSignals).toBe(false);
    expect(premiumTrustVerdict(prov).reason).toMatch(/stale/i);
  });
});

describe("buildOptionChainProvenance — expired expiry", () => {
  const prov = buildOptionChainProvenance(
    chain({ expiry: "2026-06-01" }),
    { nowMs: NOW },
  );
  it("rejects a past expiry even from Kite", () => {
    expect(prov.trustedForSignals).toBe(false);
    expect(prov.warnings.some((w) => /past/i.test(w))).toBe(true);
  });
});

describe("buildOptionChainProvenance — missing OI", () => {
  const prov = buildOptionChainProvenance(
    chain({
      rows: [
        { strike: 23000, ce: { ltp: 120, oi: 0 }, pe: { ltp: 110, oi: 0 } },
      ] as OcResponse["rows"],
    }),
    { nowMs: NOW },
  );
  it("flags zero open interest", () => {
    expect(prov.oiLegCount).toBe(0);
    expect(prov.warnings.some((w) => /open-interest|open interest/i.test(w))).toBe(true);
  });
});

describe("buildOptionChainProvenance — null chain", () => {
  const prov = buildOptionChainProvenance(null, { nowMs: NOW, missingReason: "Kite session expired." });
  it("carries a concrete missing reason and is never trusted", () => {
    expect(prov.missingReason).toBe("Kite session expired.");
    expect(prov.trustedForSignals).toBe(false);
    expect(prov.fallbackUsed).toBe(true);
    expect(premiumTrustVerdict(prov).reason).toBe("Kite session expired.");
  });
  it("uses TODAY for the default fetchedAt day", () => {
    expect(prov.fetchedAt.slice(0, 10)).toBe(TODAY);
  });
});
