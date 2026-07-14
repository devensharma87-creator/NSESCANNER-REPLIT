import { describe, expect, it } from "vitest";
import {
  buildDataParityMismatches,
  buildDataParityResult,
  classifyModuleUnavailable,
  classifyPriceDivergence,
  classifySourceDivergence,
  classifyStalenessDivergence,
  classifyTradeGradeDivergence,
  deriveOverallSeverity,
} from "./classify";
import type { DataParityObservation } from "./types";

const NOW = "2026-07-04T05:00:00.000Z"; // 10:30 IST

function obs(overrides: Partial<DataParityObservation>): DataParityObservation {
  return {
    moduleId: "router",
    moduleLabel: "Canonical Router",
    symbol: "RELIANCE",
    assetType: "equity",
    status: "OK",
    reason: null,
    kind: "quote",
    freshnessClass: "trade_grade",
    price: 100,
    asOf: NOW,
    freshnessSec: 30,
    source: "kite",
    trustTier: "authoritative",
    tradeGrade: true,
    capturedAt: NOW,
    ...overrides,
  };
}

describe("classifyPriceDivergence", () => {
  it("returns null when prices agree within 0.1%", () => {
    const a = obs({ price: 100 });
    const b = obs({ moduleId: "scanner", moduleLabel: "Scanner", price: 100.05 });
    expect(classifyPriceDivergence(a, b)).toBeNull();
  });

  it("returns P1 when diff is between 0.1% and 0.5%", () => {
    const a = obs({ price: 100 });
    const b = obs({ moduleId: "scanner", moduleLabel: "Scanner", price: 100.3 });
    const m = classifyPriceDivergence(a, b);
    expect(m?.severity).toBe("P1");
    expect(m?.kind).toBe("PRICE_DIVERGENCE");
  });

  it("returns P0 when diff exceeds 0.5% AND both are trade_grade+fresh", () => {
    const a = obs({ price: 100 });
    const b = obs({ moduleId: "fno", moduleLabel: "F&O Diagnostics", price: 102, freshnessSec: 15 });
    const m = classifyPriceDivergence(a, b);
    expect(m?.severity).toBe("P0");
  });

  it("caps severity at P1 when diff exceeds 0.5% but classes differ (cross-class, no false P0)", () => {
    const a = obs({ price: 100 });
    const b = obs({
      moduleId: "reportGrade",
      moduleLabel: "Report-Grade Index Quotes",
      price: 102,
      freshnessClass: "report_grade",
      tradeGrade: false,
    });
    const m = classifyPriceDivergence(a, b);
    expect(m?.severity).toBe("P1");
  });

  it("caps severity at P1 when diff exceeds 0.5% but one side is stale (not fresh)", () => {
    const a = obs({ price: 100 });
    const b = obs({
      moduleId: "scanner",
      moduleLabel: "Scanner",
      price: 102,
      freshnessSec: 5000, // way outside the 10-min budget
    });
    const m = classifyPriceDivergence(a, b);
    expect(m?.severity).toBe("P1");
  });

  it("returns null when either price is missing", () => {
    const a = obs({ price: null });
    const b = obs({ price: 100 });
    expect(classifyPriceDivergence(a, b)).toBeNull();
  });
});

describe("classifyStalenessDivergence", () => {
  it("returns null when asOf drift is within 5 minutes", () => {
    const a = obs({ asOf: "2026-07-04T05:00:00.000Z" });
    const b = obs({ moduleId: "fno", asOf: "2026-07-04T05:02:00.000Z" });
    expect(classifyStalenessDivergence(a, b)).toBeNull();
  });

  it("returns P1 when both claim fresh but asOf drift exceeds 5 minutes", () => {
    const a = obs({ asOf: "2026-07-04T05:00:00.000Z", freshnessSec: 30 });
    const b = obs({ moduleId: "fno", asOf: "2026-07-04T04:50:00.000Z", freshnessSec: 30 });
    const m = classifyStalenessDivergence(a, b);
    expect(m?.severity).toBe("P1");
    expect(m?.kind).toBe("STALENESS_DIVERGENCE");
  });

  it("does not compare staleness against a frozen_plan observation", () => {
    const a = obs({ asOf: "2026-07-04T05:00:00.000Z" });
    const b = obs({
      moduleId: "swingQueue",
      kind: "frozen_plan",
      freshnessClass: "frozen",
      asOf: "2026-07-01T05:00:00.000Z",
    });
    expect(classifyStalenessDivergence(a, b)).toBeNull();
  });

  it("does not compare staleness when one side is already stale", () => {
    const a = obs({ asOf: "2026-07-04T05:00:00.000Z", freshnessSec: 30 });
    const b = obs({
      moduleId: "scanner",
      asOf: "2026-07-03T05:00:00.000Z",
      freshnessSec: 90000,
      freshnessClass: "cache",
    });
    expect(classifyStalenessDivergence(a, b)).toBeNull();
  });
});

describe("classifySourceDivergence", () => {
  it("flags P2 when source differs but prices agree", () => {
    const a = obs({ source: "kite" });
    const b = obs({ moduleId: "optionChain", source: "yahoo", price: 100.02 });
    const m = classifySourceDivergence(a, b);
    expect(m?.severity).toBe("P2");
  });

  it("returns null when source differs but prices also diverge beyond tolerance (already PRICE_DIVERGENCE)", () => {
    const a = obs({ source: "kite" });
    const b = obs({ moduleId: "optionChain", source: "yahoo", price: 105 });
    expect(classifySourceDivergence(a, b)).toBeNull();
  });

  it("returns null when source is the same", () => {
    const a = obs({ source: "kite" });
    const b = obs({ moduleId: "fno", source: "kite" });
    expect(classifySourceDivergence(a, b)).toBeNull();
  });
});

describe("classifyTradeGradeDivergence", () => {
  it("flags INFO when tradeGrade flag differs", () => {
    const a = obs({ tradeGrade: true });
    const b = obs({ moduleId: "reportGrade", tradeGrade: false });
    const m = classifyTradeGradeDivergence(a, b);
    expect(m?.severity).toBe("INFO");
  });

  it("returns null when either side has no tradeGrade concept", () => {
    const a = obs({ tradeGrade: null });
    const b = obs({ moduleId: "globalHealth", tradeGrade: false });
    expect(classifyTradeGradeDivergence(a, b)).toBeNull();
  });
});

describe("classifyModuleUnavailable", () => {
  it("flags P1 when the router itself is unavailable", () => {
    const a = obs({ status: "UNAVAILABLE", reason: "Kite offline", price: null });
    const m = classifyModuleUnavailable(a);
    expect(m?.severity).toBe("P1");
  });

  it("flags INFO when a non-router module is unavailable", () => {
    const a = obs({ moduleId: "portfolio", status: "UNAVAILABLE", reason: "No server pricing path", price: null });
    const m = classifyModuleUnavailable(a);
    expect(m?.severity).toBe("INFO");
  });

  it("returns null when the observation is OK", () => {
    expect(classifyModuleUnavailable(obs({}))).toBeNull();
  });
});

describe("buildDataParityMismatches / deriveOverallSeverity / buildDataParityResult", () => {
  it("returns no mismatches and OK severity for fully agreeing observations", () => {
    const a = obs({ moduleId: "router", price: 100 });
    const b = obs({ moduleId: "scanner", moduleLabel: "Scanner", price: 100.02 });
    const mismatches = buildDataParityMismatches([a, b]);
    expect(mismatches).toHaveLength(0);
    expect(deriveOverallSeverity(mismatches)).toBe("OK");
  });

  it("escalates overall severity to the worst mismatch found", () => {
    const a = obs({ moduleId: "router", price: 100, freshnessSec: 15 });
    const b = obs({ moduleId: "fno", moduleLabel: "F&O Diagnostics", price: 103, freshnessSec: 15 });
    const c = obs({ moduleId: "portfolio", status: "UNAVAILABLE", reason: "No server pricing path", price: null });
    const result = buildDataParityResult("RELIANCE", "equity", [a, b, c], NOW);
    expect(result.overallSeverity).toBe("P0");
    expect(result.mismatches.some((m) => m.kind === "PRICE_DIVERGENCE" && m.severity === "P0")).toBe(true);
    expect(result.mismatches.some((m) => m.kind === "MODULE_UNAVAILABLE")).toBe(true);
  });

  it("never fabricates data — an all-UNAVAILABLE observation set produces only MODULE_UNAVAILABLE mismatches", () => {
    const a = obs({ status: "UNAVAILABLE", reason: "Kite offline", price: null });
    const b = obs({ moduleId: "scanner", status: "UNAVAILABLE", reason: "Scanner cache empty", price: null });
    const result = buildDataParityResult("RELIANCE", "equity", [a, b], NOW);
    expect(result.mismatches).toHaveLength(2);
    expect(result.mismatches.every((m) => m.kind === "MODULE_UNAVAILABLE")).toBe(true);
  });
});
