import { describe, it, expect } from "vitest";

import { evaluateOptionChain } from "./optionChainProvider";
import type { OcResponse, OcRow } from "../optionChain";

function chain(over: Partial<OcResponse> = {}): OcResponse {
  const rows: OcRow[] = [
    { strike: 100, ce: { oi: 1000 }, pe: { oi: 1000 } },
    { strike: 105, ce: { oi: 1000 }, pe: { oi: 1000 } },
  ];
  return {
    underlying: "NIFTY",
    underlyingName: "NIFTY",
    kind: "INDEX",
    spot: 102,
    prevClose: 101,
    changePercent: 1,
    expiry: "2026-12-31",
    expiries: ["2026-12-31"],
    atmStrike: 100,
    strikeStep: 5,
    rows,
    source: "kite",
    generatedAt: "2026-06-09T05:00:00.000Z",
    spotSource: "kite" as const,
    spotTrusted: true,
    ...over,
  };
}

describe("evaluateOptionChain", () => {
  it("rejects a null chain (Kite offline) without faking data", () => {
    const e = evaluateOptionChain(null, "2026-06-09T00:00:00.000Z");
    expect(e.ok).toBe(false);
    expect(e.complete).toBe(false);
    expect(e.reason).toMatch(/unavailable/i);
  });

  it("rejects an expired active expiry", () => {
    const e = evaluateOptionChain(chain({ expiry: "2026-06-01" }), "2026-06-09T00:00:00.000Z");
    expect(e.ok).toBe(false);
    expect(e.expired).toBe(true);
    expect(e.reason).toMatch(/past/i);
  });

  it("rejects an empty chain", () => {
    const e = evaluateOptionChain(chain({ rows: [] }), "2026-06-09T00:00:00.000Z");
    expect(e.ok).toBe(false);
    expect(e.reason).toMatch(/no strikes/i);
  });

  it("rejects a non-positive spot", () => {
    const e = evaluateOptionChain(chain({ spot: 0 }), "2026-06-09T00:00:00.000Z");
    expect(e.ok).toBe(false);
    expect(e.reason).toMatch(/spot/i);
  });

  it("accepts a healthy chain with no warnings", () => {
    const e = evaluateOptionChain(chain(), "2026-06-09T00:00:00.000Z");
    expect(e.ok).toBe(true);
    expect(e.complete).toBe(true);
    expect(e.expired).toBe(false);
    expect(e.warnings).toEqual([]);
    expect(e.asOfMs).toBe(Date.parse("2026-06-09T05:00:00.000Z"));
  });

  it("flags a chain that carries no open interest", () => {
    const e = evaluateOptionChain(
      chain({ rows: [{ strike: 100, ce: { ltp: 5 }, pe: { ltp: 5 } }] }),
      "2026-06-09T00:00:00.000Z",
    );
    expect(e.ok).toBe(true);
    expect(e.warnings.some((w) => /open-interest/i.test(w))).toBe(true);
  });

  it("flags a chain missing OI on more than half its legs", () => {
    const e = evaluateOptionChain(
      chain({
        rows: [
          { strike: 100, ce: { oi: 1000 }, pe: { oi: 0 } },
          { strike: 105, ce: { oi: 0 }, pe: { oi: 0 } },
        ],
      }),
      "2026-06-09T00:00:00.000Z",
    );
    expect(e.ok).toBe(true);
    expect(e.warnings.some((w) => /half/i.test(w))).toBe(true);
  });
});
