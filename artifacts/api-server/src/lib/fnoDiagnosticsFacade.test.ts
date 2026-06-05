import { describe, it, expect } from "vitest";
import {
  classifyFreshness,
  atmSpreadPct,
  buildGateWaterfall,
  buildSetupPerformance,
  buildNoTradeReasons,
} from "./fnoDiagnosticsFacade";
import type { ReasoningAnalytics } from "./fnoReasoningAnalytics";

/** Minimal valid analytics scaffold; per-test overrides fill the bits used. */
function analytics(partial: Partial<ReasoningAnalytics>): ReasoningAnalytics {
  return {
    generatedAt: "2026-06-05T00:00:00.000Z",
    rowCount: 0,
    windowFrom: null,
    windowTo: null,
    bySetup: [],
    byIndex: [],
    byTier: [],
    byDecision: [],
    byReasonCode: [],
    byRegime: [],
    byDirection: [],
    byOptionType: [],
    byDemotionTag: [],
    byMissingData: [],
    stoppedBySetup: [],
    stoppedByIndex: [],
    stoppedByConfidenceBucket: [],
    stoppedByRegime: [],
    targetBySetup: [],
    expiredBySetup: [],
    rejectedReasonBySetup: [],
    t1ThenStoppedGroups: 0,
    t1ThenStopped: {
      exact: 0,
      proxy: 0,
      mode: "exact",
      rowsWithFingerprint: 0,
      rowsWithoutFingerprint: 0,
      proxyMethod: "",
      limitation: "",
    },
    lowWinRateDemotions: 0,
    rowSampleType: "event_rows_not_unique_signals",
    ...partial,
  };
}

describe("classifyFreshness", () => {
  it("returns unavailable for null / non-finite age", () => {
    expect(classifyFreshness(null, 1000, 5000)).toBe("unavailable");
    expect(classifyFreshness(Number.NaN, 1000, 5000)).toBe("unavailable");
  });
  it("treats negative (clock-skew) age as fresh", () => {
    expect(classifyFreshness(-500, 1000, 5000)).toBe("ok");
  });
  it("bands ok / warn / fail at thresholds", () => {
    expect(classifyFreshness(500, 1000, 5000)).toBe("ok");
    expect(classifyFreshness(1000, 1000, 5000)).toBe("warn");
    expect(classifyFreshness(4999, 1000, 5000)).toBe("warn");
    expect(classifyFreshness(5000, 1000, 5000)).toBe("fail");
  });
});

describe("atmSpreadPct", () => {
  it("returns null when bid/ask missing or invalid", () => {
    expect(atmSpreadPct(undefined)).toBeNull();
    expect(atmSpreadPct({})).toBeNull();
    expect(atmSpreadPct({ bid: 0, ask: 5 })).toBeNull();
    expect(atmSpreadPct({ bid: 6, ask: 5 })).toBeNull(); // crossed
  });
  it("computes spread as percent of mid", () => {
    // bid 99, ask 101 -> mid 100, spread 2 -> 2%
    expect(atmSpreadPct({ bid: 99, ask: 101 })).toBe(2);
  });
});

describe("buildGateWaterfall", () => {
  it("orders the funnel and computes honest conversion rates", () => {
    const w = buildGateWaterfall(
      analytics({
        rowCount: 42,
        byDecision: [
          { key: "EMITTED", count: 20 },
          { key: "OPENED", count: 6 },
          { key: "SKIPPED", count: 4 },
          { key: "CLOSED_TARGET1", count: 3 },
          { key: "CLOSED_STOPPED", count: 1 },
          { key: "PRE_EMISSION_REJECTED", count: 8 },
        ],
        byDemotionTag: [{ key: "LOW_WINRATE", count: 5 }],
        rejectedReasonBySetup: [
          { setupKey: "TREND_CONTINUATION", reasonCode: "LIQUIDITY_OI", count: 8 },
        ],
      }),
    );
    expect(w.funnel[0]).toEqual({ stage: "EMITTED", count: 20 });
    expect(w.funnel.find((f) => f.stage === "OPENED")?.count).toBe(6);
    // openRate = 6 / (6+4) = 0.6
    expect(w.conversion.openRate).toBe(0.6);
    // decisiveWinRate = 3 / (3+0+1) = 0.75
    expect(w.conversion.decisiveWinRate).toBe(0.75);
  });
  it("returns null conversion rates when denominators are zero", () => {
    const w = buildGateWaterfall(analytics({}));
    expect(w.conversion.openRate).toBeNull();
    expect(w.conversion.decisiveWinRate).toBeNull();
  });
});

describe("buildSetupPerformance", () => {
  it("computes decisive win-rate and sorts by opened desc", () => {
    const p = buildSetupPerformance(
      analytics({
        bySetup: [
          {
            setupKey: "A",
            total: 10,
            emitted: 8,
            preEmissionRejected: 0,
            opened: 2,
            skipped: 0,
            stopped: 1,
            target1: 1,
            target2: 0,
            expired: 0,
            forceExit: 0,
            manualClose: 0,
            demoted: 0,
            avgConfidence: 70,
            avgConfluence: 5,
          },
          {
            setupKey: "B",
            total: 20,
            emitted: 15,
            preEmissionRejected: 0,
            opened: 9,
            skipped: 0,
            stopped: 0,
            target1: 0,
            target2: 0,
            expired: 3,
            forceExit: 0,
            manualClose: 0,
            demoted: 2,
            avgConfidence: 60,
            avgConfluence: 4,
          },
        ],
      }),
    );
    // sorted by opened desc => B (9) first
    expect(p.rows[0]?.setupKey).toBe("B");
    // A decisive = 1 win / (1+1) = 0.5
    expect(p.rows[1]?.decisiveWinRate).toBe(0.5);
    // B has no decisive outcomes (only expired) => null
    expect(p.rows[0]?.decisiveWinRate).toBeNull();
  });
});

describe("buildNoTradeReasons", () => {
  it("separates durable and ephemeral sources with provenance", () => {
    const r = buildNoTradeReasons(
      analytics({
        rejectedReasonBySetup: [
          { setupKey: "X", reasonCode: "SPREAD_WIDE", count: 3 },
        ],
        byDemotionTag: [{ key: "RS_CONFLICT", count: 2 }],
      }),
      [
        { indexSymbol: "NIFTY", skipReason: "LIQUIDITY_OI", tier: "STANDARD" },
        { indexSymbol: "NIFTY", skipReason: "LIQUIDITY_OI", tier: "BASELINE" },
        { indexSymbol: "BANKNIFTY", skipReason: "SPREAD_WIDE", tier: "STANDARD" },
      ],
    );
    expect(r.durable.source).toBe("fno_signal_reasoning");
    expect(r.durable.rejectionReasonsBySetup[0]?.reasonCode).toBe("SPREAD_WIDE");
    expect(r.ephemeral.total).toBe(3);
    expect(r.ephemeral.byReason[0]).toEqual({ key: "LIQUIDITY_OI", count: 2 });
    expect(r.ephemeral.byIndex.find((x) => x.key === "NIFTY")?.count).toBe(2);
  });
});
