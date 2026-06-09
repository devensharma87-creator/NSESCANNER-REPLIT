/**
 * P15 — fnoReasoningAnalytics pure tests.
 *
 * Covers: empty data, setup-wise aggregation, stop/target/expired/demotion
 * grouping, snapshot-derived histograms (demotionTags, missing[]),
 * confidence-bucket distribution, regime/index stop-loss histograms,
 * tier realized-pnl, T1→stop reversal proxy, low-winrate demotions,
 * filter normalisation (default + invalid + cap), and stable ordering.
 */
import { describe, it, expect } from "vitest";
import type { FnoSignalReasoningRow } from "@workspace/db";
import {
  analyticsFiltersFromQuery,
  computeReasoningAnalytics,
  buildBlockedSignalsReview,
  resolveBlockedWindow,
  shiftYmd,
  BLOCKED_EVENTS_DEFAULT_CAP,
  BLOCKED_DEFAULT_DAYS,
} from "./fnoReasoningAnalytics";

const baseRow = (over: Partial<FnoSignalReasoningRow> = {}): FnoSignalReasoningRow => ({
  id: 1,
  capturedAt: new Date("2026-05-15T09:20:00Z"),
  signalDate: "2026-05-15",
  indexSymbol: "NIFTY",
  indexName: null,
  setupKey: "TREND_CONTINUATION",
  direction: "BULLISH",
  optionType: "CE",
  tier: "STANDARD",
  decision: "EMITTED",
  reasonCode: "EMITTED",
  confidence: 70,
  confluenceScore: "8.50",
  regime: "TRENDING",
  vix: "13.20",
  ivr: "42.00",
  ivp: "38.00",
  spot: "24500.00",
  spotEntry: "24500.00",
  spotStop: null,
  spotTarget1: null,
  spotTarget2: null,
  selectedStrike: "24500.00",
  signalFingerprint: null,
  optionEntry: null,
  optionStop: null,
  optionTarget1: null,
  optionTarget2: null,
  optionSpreadPct: null,
  optionOi: null,
  optionLtp: null,
  optionExit: null,
  realizedPnl: null,
  lifecycleStatus: null,
  exitReason: null,
  dataQuality: "OK",
  maxLossPct: null,
  lots: null,
  lotSize: null,
  snapshot: null,
  note: null,
  ...over,
});

describe("P15 — analyticsFiltersFromQuery", () => {
  it("returns sane defaults on empty input", () => {
    const f = analyticsFiltersFromQuery({});
    expect(f.latestN).toBe(2000);
    expect(f.indexSymbol).toBeUndefined();
    expect(f.from).toBeUndefined();
  });

  it("accepts the documented filter aliases", () => {
    const f = analyticsFiltersFromQuery({
      index: "BANKNIFTY", setup: "VWAP_RECLAIM", side: "BEARISH",
      option: "PE", tier: "MICRO", status: "CLOSED_STOPPED",
      reason: "OI_CONFLICT", regime: "VOLATILE",
      from: "2026-05-01", to: "2026-05-15", limit: "500",
    });
    expect(f).toEqual({
      indexSymbol: "BANKNIFTY", setupKey: "VWAP_RECLAIM", direction: "BEARISH",
      optionType: "PE", tier: "MICRO", decision: "CLOSED_STOPPED",
      reasonCode: "OI_CONFLICT", regime: "VOLATILE",
      from: "2026-05-01", to: "2026-05-15", latestN: 500,
      exactOnly: false,
    });
  });

  it("parses exactOnly from query string truthy variants", () => {
    expect(analyticsFiltersFromQuery({ exactOnly: "true" }).exactOnly).toBe(true);
    expect(analyticsFiltersFromQuery({ exactOnly: "1" }).exactOnly).toBe(true);
    expect(analyticsFiltersFromQuery({ exactOnly: true }).exactOnly).toBe(true);
    expect(analyticsFiltersFromQuery({ exactOnly: "false" }).exactOnly).toBe(false);
    expect(analyticsFiltersFromQuery({}).exactOnly).toBe(false);
  });

  it("rejects invalid dates and caps latestN", () => {
    const f = analyticsFiltersFromQuery({ from: "2026-13-99", to: "junk", latestN: "99999" });
    expect(f.from).toBeUndefined();
    expect(f.to).toBeUndefined();
    expect(f.latestN).toBe(10_000);
  });

  it("ignores zero / negative latestN", () => {
    expect(analyticsFiltersFromQuery({ latestN: "0" }).latestN).toBe(2000);
    expect(analyticsFiltersFromQuery({ latestN: "-5" }).latestN).toBe(2000);
    expect(analyticsFiltersFromQuery({ latestN: "abc" }).latestN).toBe(2000);
  });
});

describe("P15b — signal_fingerprint exact lifecycle linkage", () => {
  it("exact T1→stop linkage uses fingerprint when present (mode='exact')", () => {
    const fp = "deadbeefcafe1234";
    const rows = [
      baseRow({ id: 1, decision: "EMITTED", signalFingerprint: fp }),
      baseRow({ id: 2, decision: "OPENED", signalFingerprint: fp }),
      baseRow({ id: 3, decision: "CLOSED_TARGET1", signalFingerprint: fp, realizedPnl: "500.00" }),
      baseRow({ id: 4, decision: "CLOSED_STOPPED", signalFingerprint: fp, realizedPnl: "-300.00" }),
    ];
    const a = computeReasoningAnalytics(rows);
    expect(a.t1ThenStopped.exact).toBe(1);
    expect(a.t1ThenStopped.proxy).toBe(0);
    expect(a.t1ThenStopped.mode).toBe("exact");
    expect(a.t1ThenStopped.rowsWithFingerprint).toBe(4);
    expect(a.t1ThenStopped.rowsWithoutFingerprint).toBe(0);
    expect(a.t1ThenStoppedGroups).toBe(1);
  });

  it("different fingerprints do not collide", () => {
    const a = computeReasoningAnalytics([
      baseRow({ id: 1, decision: "CLOSED_TARGET1", signalFingerprint: "aaaaaaaaaaaaaaaa" }),
      baseRow({ id: 2, decision: "CLOSED_STOPPED", signalFingerprint: "bbbbbbbbbbbbbbbb" }),
    ]);
    expect(a.t1ThenStopped.exact).toBe(0);
    expect(a.t1ThenStopped.proxy).toBe(0);
  });

  it("proxy fallback fires for legacy null-fingerprint rows (mode='proxy')", () => {
    const rows = [
      baseRow({ id: 1, decision: "CLOSED_TARGET1", signalFingerprint: null, selectedStrike: "24500.00" }),
      baseRow({ id: 2, decision: "CLOSED_STOPPED", signalFingerprint: null, selectedStrike: "24500.00" }),
    ];
    const a = computeReasoningAnalytics(rows);
    expect(a.t1ThenStopped.exact).toBe(0);
    expect(a.t1ThenStopped.proxy).toBe(1);
    expect(a.t1ThenStopped.mode).toBe("proxy");
    expect(a.t1ThenStopped.rowsWithFingerprint).toBe(0);
    expect(a.t1ThenStopped.rowsWithoutFingerprint).toBe(2);
    expect(a.t1ThenStoppedGroups).toBe(1);
  });

  it("hybrid mode: mix of fingerprinted and legacy rows tallies both independently", () => {
    const fp = "1234567890abcdef";
    const a = computeReasoningAnalytics([
      baseRow({ id: 1, decision: "CLOSED_TARGET1", signalFingerprint: fp }),
      baseRow({ id: 2, decision: "CLOSED_STOPPED", signalFingerprint: fp }),
      baseRow({ id: 3, decision: "CLOSED_TARGET1", signalFingerprint: null, selectedStrike: "24500.00", setupKey: "VWAP_RECLAIM" }),
      baseRow({ id: 4, decision: "CLOSED_STOPPED", signalFingerprint: null, selectedStrike: "24500.00", setupKey: "VWAP_RECLAIM" }),
    ]);
    expect(a.t1ThenStopped.exact).toBe(1);
    expect(a.t1ThenStopped.proxy).toBe(1);
    expect(a.t1ThenStopped.mode).toBe("hybrid");
    expect(a.t1ThenStopped.rowsWithFingerprint).toBe(2);
    expect(a.t1ThenStopped.rowsWithoutFingerprint).toBe(2);
    expect(a.t1ThenStoppedGroups).toBe(2);
  });

  it("mode is 'exact' when ALL lifecycle (T1/STOPPED) rows carry a fingerprint, even if non-lifecycle rows do not", () => {
    const fp = "9999999999999999";
    const a = computeReasoningAnalytics([
      // Non-lifecycle rows without fingerprint MUST NOT degrade the mode.
      baseRow({ id: 1, decision: "SKIPPED", signalFingerprint: null }),
      baseRow({ id: 2, decision: "PRE_EMISSION_REJECTED", signalFingerprint: null }),
      // Lifecycle rows fully fingerprinted.
      baseRow({ id: 3, decision: "CLOSED_TARGET1", signalFingerprint: fp }),
      baseRow({ id: 4, decision: "CLOSED_STOPPED", signalFingerprint: fp }),
    ]);
    expect(a.t1ThenStopped.mode).toBe("exact");
    expect(a.t1ThenStopped.exact).toBe(1);
    expect(a.t1ThenStopped.proxy).toBe(0);
    // Dataset-wide coverage still surfaces the unfingerprinted SKIPPED rows.
    expect(a.t1ThenStopped.rowsWithFingerprint).toBe(2);
    expect(a.t1ThenStopped.rowsWithoutFingerprint).toBe(2);
  });

  it("mode is 'hybrid' only when lifecycle rows themselves are mixed", () => {
    const fp = "7777777777777777";
    const a = computeReasoningAnalytics([
      baseRow({ id: 1, decision: "CLOSED_TARGET1", signalFingerprint: fp }),
      baseRow({ id: 2, decision: "CLOSED_STOPPED", signalFingerprint: null, selectedStrike: "24500.00" }),
    ]);
    expect(a.t1ThenStopped.mode).toBe("hybrid");
  });

  it("mode is 'exact' when there are zero lifecycle rows (trivially)", () => {
    const a = computeReasoningAnalytics([
      baseRow({ id: 1, decision: "EMITTED", signalFingerprint: null }),
    ]);
    expect(a.t1ThenStopped.mode).toBe("exact");
  });

  it("distinct trades that share the 6-tuple but were emitted on different days do NOT collapse", () => {
    // signalDate is part of the fingerprint key, so cross-day repeats stay separated.
    const fpA = "aaaaaaaaaaaaaaaa";
    const fpB = "bbbbbbbbbbbbbbbb";
    const a = computeReasoningAnalytics([
      baseRow({ id: 1, signalDate: "2026-05-15", decision: "CLOSED_TARGET1", signalFingerprint: fpA }),
      baseRow({ id: 2, signalDate: "2026-05-15", decision: "CLOSED_STOPPED", signalFingerprint: fpA }),
      baseRow({ id: 3, signalDate: "2026-05-16", decision: "CLOSED_TARGET1", signalFingerprint: fpB }),
      baseRow({ id: 4, signalDate: "2026-05-16", decision: "CLOSED_STOPPED", signalFingerprint: fpB }),
    ]);
    expect(a.t1ThenStopped.exact).toBe(2);
  });

  it("null-safe: missing fingerprint AND missing proxy fields does not crash", () => {
    const a = computeReasoningAnalytics([
      baseRow({ id: 1, decision: "CLOSED_TARGET1", signalFingerprint: null, selectedStrike: null, setupKey: null, direction: null }),
    ]);
    expect(a.t1ThenStopped.exact).toBe(0);
    expect(a.t1ThenStopped.proxy).toBe(0);
  });
});

describe("P15 — computeReasoningAnalytics", () => {
  it("returns the empty shape for zero rows without throwing", () => {
    const a = computeReasoningAnalytics([]);
    expect(a.rowCount).toBe(0);
    expect(a.windowFrom).toBeNull();
    expect(a.windowTo).toBeNull();
    expect(a.bySetup).toEqual([]);
    expect(a.byDecision).toEqual([]);
    expect(a.t1ThenStoppedGroups).toBe(0);
    expect(a.t1ThenStopped).toMatchObject({ exact: 0, proxy: 0, mode: "exact", rowsWithFingerprint: 0, rowsWithoutFingerprint: 0 });
    expect(a.t1ThenStopped.proxyMethod).toContain("group_by");
    expect(a.lowWinRateDemotions).toBe(0);
    expect(a.rowSampleType).toBe("event_rows_not_unique_signals");
  });

  it("aggregates per-setup counts across decisions", () => {
    const rows = [
      baseRow({ id: 1, setupKey: "TREND_CONTINUATION", decision: "EMITTED" }),
      baseRow({ id: 2, setupKey: "TREND_CONTINUATION", decision: "EMITTED", reasonCode: "DEMOTED" }),
      baseRow({ id: 3, setupKey: "TREND_CONTINUATION", decision: "OPENED" }),
      baseRow({ id: 4, setupKey: "TREND_CONTINUATION", decision: "CLOSED_STOPPED", realizedPnl: "-1200.00" }),
      baseRow({ id: 5, setupKey: "TREND_CONTINUATION", decision: "CLOSED_TARGET1", realizedPnl: "800.00" }),
      baseRow({ id: 6, setupKey: "VWAP_RECLAIM", decision: "PRE_EMISSION_REJECTED", reasonCode: "POST_CLAMP_RR" }),
      baseRow({ id: 7, setupKey: "VWAP_RECLAIM", decision: "CLOSED_EXPIRED" }),
    ];
    const a = computeReasoningAnalytics(rows);
    const tc = a.bySetup.find(s => s.setupKey === "TREND_CONTINUATION")!;
    expect(tc.total).toBe(5);
    expect(tc.emitted).toBe(2);
    expect(tc.demoted).toBe(1);
    expect(tc.opened).toBe(1);
    expect(tc.stopped).toBe(1);
    expect(tc.target1).toBe(1);
    const vr = a.bySetup.find(s => s.setupKey === "VWAP_RECLAIM")!;
    expect(vr.preEmissionRejected).toBe(1);
    expect(vr.expired).toBe(1);
  });

  it("computes stop-loss histograms by setup / index / confidence / regime", () => {
    const rows = [
      baseRow({ id: 1, setupKey: "MEAN_REVERSION", indexSymbol: "NIFTY", confidence: 58, regime: "VOLATILE", decision: "CLOSED_STOPPED" }),
      baseRow({ id: 2, setupKey: "MEAN_REVERSION", indexSymbol: "BANKNIFTY", confidence: 62, regime: "TRENDING", decision: "CLOSED_STOPPED" }),
      baseRow({ id: 3, setupKey: "VOLUME_BREAKOUT", indexSymbol: "BANKNIFTY", confidence: 72, regime: "TRENDING", decision: "CLOSED_STOPPED" }),
      baseRow({ id: 4, setupKey: "MEAN_REVERSION", decision: "EMITTED" }), // non-stop ignored
    ];
    const a = computeReasoningAnalytics(rows);
    expect(a.stoppedBySetup[0]).toEqual({ key: "MEAN_REVERSION", count: 2 });
    expect(a.stoppedByIndex[0]).toEqual({ key: "BANKNIFTY", count: 2 });
    expect(a.stoppedByConfidenceBucket).toContainEqual({ key: "55-59", count: 1 });
    expect(a.stoppedByConfidenceBucket).toContainEqual({ key: "60-64", count: 1 });
    expect(a.stoppedByConfidenceBucket).toContainEqual({ key: "70-74", count: 1 });
    expect(a.stoppedByRegime).toContainEqual({ key: "TRENDING", count: 2 });
    expect(a.stoppedByRegime).toContainEqual({ key: "VOLATILE", count: 1 });
  });

  it("derives demotion-tag and missing-data histograms from snapshot", () => {
    const rows = [
      baseRow({ id: 1, decision: "EMITTED", reasonCode: "DEMOTED",
        snapshot: { demotionTags: ["LOW_WINRATE", "RS_CONFLICT"], missing: ["ivRank"] } }),
      baseRow({ id: 2, decision: "EMITTED", reasonCode: "DEMOTED",
        snapshot: { demotionTags: ["LOW_WINRATE"], missing: ["ivRank", "ivPercentile", "vix"] } }),
      baseRow({ id: 3, decision: "EMITTED",
        snapshot: { demotionTags: [], missing: [] } }),
    ];
    const a = computeReasoningAnalytics(rows);
    expect(a.byDemotionTag).toEqual([
      { key: "LOW_WINRATE", count: 2 },
      { key: "RS_CONFLICT", count: 1 },
    ]);
    expect(a.byMissingData).toEqual([
      { key: "ivRank", count: 2 },
      { key: "ivPercentile", count: 1 },
      { key: "vix", count: 1 },
    ]);
    expect(a.lowWinRateDemotions).toBe(2);
  });

  it("computes average confidence and confluence per setup", () => {
    const rows = [
      baseRow({ id: 1, setupKey: "X", confidence: 60, confluenceScore: "6.00" }),
      baseRow({ id: 2, setupKey: "X", confidence: 70, confluenceScore: "8.00" }),
      baseRow({ id: 3, setupKey: "Y", confidence: 55, confluenceScore: null }),
    ];
    const a = computeReasoningAnalytics(rows);
    const x = a.bySetup.find(s => s.setupKey === "X")!;
    expect(x.avgConfidence).toBe(65);
    expect(x.avgConfluence).toBe(7);
    const y = a.bySetup.find(s => s.setupKey === "Y")!;
    expect(y.avgConfidence).toBe(55);
    expect(y.avgConfluence).toBeNull();
  });

  it("rolls realized pnl per tier across CLOSED_* rows", () => {
    const rows = [
      baseRow({ id: 1, tier: "STANDARD", decision: "CLOSED_TARGET1", realizedPnl: "1500.50" }),
      baseRow({ id: 2, tier: "STANDARD", decision: "CLOSED_STOPPED", realizedPnl: "-800.00" }),
      baseRow({ id: 3, tier: "BASELINE", decision: "CLOSED_STOPPED", realizedPnl: "-200.00" }),
      baseRow({ id: 4, tier: "BASELINE", decision: "EMITTED" }), // non-closed
    ];
    const a = computeReasoningAnalytics(rows);
    const std = a.byTier.find(t => t.tier === "STANDARD")!;
    expect(std.realizedPnl).toBe(700.5);
    expect(std.target1).toBe(1);
    expect(std.stopped).toBe(1);
    const base = a.byTier.find(t => t.tier === "BASELINE")!;
    expect(base.realizedPnl).toBe(-200);
  });

  it("counts T1→stop reversal groups by (date,index,setup,direction,strike)", () => {
    const rows = [
      baseRow({ id: 1, decision: "CLOSED_TARGET1", signalDate: "2026-05-15", indexSymbol: "NIFTY", setupKey: "TC", direction: "BULLISH", selectedStrike: "24500.00" }),
      baseRow({ id: 2, decision: "CLOSED_STOPPED", signalDate: "2026-05-15", indexSymbol: "NIFTY", setupKey: "TC", direction: "BULLISH", selectedStrike: "24500.00" }),
      baseRow({ id: 3, decision: "CLOSED_TARGET1", signalDate: "2026-05-15", indexSymbol: "BANKNIFTY", setupKey: "TC", direction: "BULLISH", selectedStrike: "48500.00" }),
      // BANKNIFTY group has T1 only — no reversal
      baseRow({ id: 4, decision: "CLOSED_STOPPED", signalDate: "2026-05-15", indexSymbol: "SENSEX", setupKey: "TC", direction: "BULLISH", selectedStrike: "78000.00" }),
      // SENSEX group has STOP only — no reversal
    ];
    const a = computeReasoningAnalytics(rows);
    expect(a.t1ThenStoppedGroups).toBe(1);
  });

  it("emits rejected-reason-by-setup with stable ordering", () => {
    const rows = [
      baseRow({ id: 1, setupKey: "A", decision: "PRE_EMISSION_REJECTED", reasonCode: "POST_CLAMP_RR" }),
      baseRow({ id: 2, setupKey: "A", decision: "PRE_EMISSION_REJECTED", reasonCode: "POST_CLAMP_RR" }),
      baseRow({ id: 3, setupKey: "A", decision: "PRE_EMISSION_REJECTED", reasonCode: "OI_CONFLICT" }),
      baseRow({ id: 4, setupKey: "B", decision: "PRE_EMISSION_REJECTED", reasonCode: "HC_FLOOR" }),
    ];
    const a = computeReasoningAnalytics(rows);
    expect(a.rejectedReasonBySetup[0]).toEqual({ setupKey: "A", reasonCode: "POST_CLAMP_RR", count: 2 });
    expect(a.rejectedReasonBySetup.length).toBe(3);
  });

  it("derives signal-date window from min/max of input rows", () => {
    const rows = [
      baseRow({ id: 1, signalDate: "2026-05-10" }),
      baseRow({ id: 2, signalDate: "2026-05-15" }),
      baseRow({ id: 3, signalDate: "2026-05-12" }),
    ];
    const a = computeReasoningAnalytics(rows);
    expect(a.windowFrom).toBe("2026-05-10");
    expect(a.windowTo).toBe("2026-05-15");
    expect(a.rowCount).toBe(3);
  });
});

describe("buildBlockedSignalsReview — blocked/demoted population", () => {
  const emitted = (over: Partial<FnoSignalReasoningRow> = {}, snap: Record<string, unknown> = {}) =>
    baseRow({ decision: "EMITTED", reasonCode: "DEMOTED", snapshot: snap, ...over });

  it("returns an empty, honest review when no rows match", () => {
    const rows = [
      emitted({}, { demotionTags: [], tradeClass: "TRADEABLE" }),
      emitted({}, { demotionTags: ["LOW_WINRATE"], tradeClass: "TRADEABLE" }), // non-hygiene tag, tradeable
    ];
    const r = buildBlockedSignalsReview(rows);
    expect(r.total).toBe(0);
    expect(r.events).toHaveLength(0);
    expect(r.vetoTotals).toEqual({ recoveryModeVeto: 0, chaseRiskVeto: 0, infoOnly: 0 });
    expect(r.windowFrom).toBeNull();
    expect(r.windowTo).toBeNull();
  });

  it("selects hygiene-veto and INFO_ONLY rows and rolls up correctly", () => {
    const rows = [
      emitted(
        { indexSymbol: "NIFTY", direction: "BULLISH", signalDate: "2026-06-09", capturedAt: new Date("2026-06-09T04:00:00Z") },
        { demotionTags: ["RECOVERY_MODE_VETO"], tradeClass: "TRADEABLE" },
      ),
      emitted(
        { indexSymbol: "BANKNIFTY", direction: "BEARISH", signalDate: "2026-06-10", capturedAt: new Date("2026-06-10T04:00:00Z") },
        { demotionTags: ["CHASE_RISK_VETO"], tradeClass: "TRADEABLE" },
      ),
      emitted(
        { indexSymbol: "NIFTY", direction: "BULLISH", signalDate: "2026-06-11", capturedAt: new Date("2026-06-11T04:00:00Z") },
        { demotionTags: [], tradeClass: "INFO_ONLY" },
      ),
      // ignored: clean tradeable EMITTED
      emitted({ indexSymbol: "SENSEX" }, { demotionTags: [], tradeClass: "TRADEABLE" }),
      // ignored: not EMITTED even though it carries a veto tag
      baseRow({ decision: "SKIPPED", snapshot: { demotionTags: ["RECOVERY_MODE_VETO"] } }),
    ];
    const r = buildBlockedSignalsReview(rows);
    expect(r.total).toBe(3);
    expect(r.vetoTotals).toEqual({ recoveryModeVeto: 1, chaseRiskVeto: 1, infoOnly: 1 });
    expect(r.byIndex.find(k => k.key === "NIFTY")?.count).toBe(2);
    expect(r.byIndex.find(k => k.key === "BANKNIFTY")?.count).toBe(1);
    expect(r.byReasonCode.find(k => k.key === "RECOVERY_MODE_VETO")?.count).toBe(1);
    expect(r.byReasonCode.find(k => k.key === "CHASE_RISK_VETO")?.count).toBe(1);
    expect(r.byReasonCode.find(k => k.key === "INFO_ONLY")?.count).toBe(1);
    expect(r.byDirection.find(k => k.key === "BULLISH")?.count).toBe(2);
    expect(r.windowFrom).toBe("2026-06-09");
    expect(r.windowTo).toBe("2026-06-11");
    // events most-recent-first by capturedAt
    expect(r.events[0]?.signalDate).toBe("2026-06-11");
    expect(r.events[r.events.length - 1]?.signalDate).toBe("2026-06-09");
    // INFO_ONLY event carries the synthetic reason marker
    const infoEvent = r.events.find(e => e.tradeClass === "INFO_ONLY");
    expect(infoEvent?.reasonCodes).toContain("INFO_ONLY");
  });

  it("counts a row carrying BOTH a veto AND INFO_ONLY once in total but in each veto bucket", () => {
    const rows = [
      emitted({}, { demotionTags: ["RECOVERY_MODE_VETO"], tradeClass: "INFO_ONLY" }),
    ];
    const r = buildBlockedSignalsReview(rows);
    expect(r.total).toBe(1);
    expect(r.vetoTotals.recoveryModeVeto).toBe(1);
    expect(r.vetoTotals.infoOnly).toBe(1);
    expect(r.events[0]?.reasonCodes).toEqual(["RECOVERY_MODE_VETO", "INFO_ONLY"]);
  });

  it("honors the event cap while still counting every match in the rollups", () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      emitted(
        { signalDate: `2026-06-0${i + 1}`, capturedAt: new Date(`2026-06-0${i + 1}T04:00:00Z`) },
        { demotionTags: ["CHASE_RISK_VETO"], tradeClass: "TRADEABLE" },
      ),
    );
    const r = buildBlockedSignalsReview(rows, 2);
    expect(r.cap).toBe(2);
    expect(r.total).toBe(5); // rollup counts all
    expect(r.events).toHaveLength(2); // event list capped
    expect(r.vetoTotals.chaseRiskVeto).toBe(5);
  });

  it("falls back to the default cap for non-positive/invalid cap values", () => {
    const r = buildBlockedSignalsReview([], 0);
    expect(r.cap).toBe(BLOCKED_EVENTS_DEFAULT_CAP);
  });
});

describe("resolveBlockedWindow — inclusive default window derivation", () => {
  const TODAY = "2026-06-09";

  it("defaults to the last BLOCKED_DEFAULT_DAYS dates ending today (inclusive)", () => {
    const w = resolveBlockedWindow({}, TODAY);
    expect(w.to).toBe(TODAY);
    // inclusive: spans exactly BLOCKED_DEFAULT_DAYS calendar dates
    expect(w.from).toBe(shiftYmd(TODAY, -(BLOCKED_DEFAULT_DAYS - 1)));
    expect(w.from).toBe("2026-06-03");
  });

  it("honors an explicit days count inclusively", () => {
    const w = resolveBlockedWindow({ days: 5 }, TODAY);
    expect(w.from).toBe("2026-06-05"); // 5 inclusive dates: 06-05..06-09
    expect(w.to).toBe(TODAY);
  });

  it("anchors the default window on an explicit `to` (not today) when `from` is absent", () => {
    const w = resolveBlockedWindow({ to: "2026-05-20", days: 3 }, TODAY);
    expect(w.to).toBe("2026-05-20");
    expect(w.from).toBe("2026-05-18"); // 3 inclusive dates ending at the provided `to`
  });

  it("honors an explicit `from` verbatim and defaults `to` to today", () => {
    const w = resolveBlockedWindow({ from: "2026-06-01" }, TODAY);
    expect(w.from).toBe("2026-06-01");
    expect(w.to).toBe(TODAY);
  });

  it("honors both explicit `from` and `to`", () => {
    const w = resolveBlockedWindow({ from: "2026-06-01", to: "2026-06-05" }, TODAY);
    expect(w).toEqual({ from: "2026-06-01", to: "2026-06-05" });
  });

  it("clamps days to the 60-day maximum and ignores invalid days", () => {
    expect(resolveBlockedWindow({ days: 9999 }, TODAY).from).toBe(shiftYmd(TODAY, -59));
    expect(resolveBlockedWindow({ days: "abc" }, TODAY).from).toBe(
      shiftYmd(TODAY, -(BLOCKED_DEFAULT_DAYS - 1)),
    );
    expect(resolveBlockedWindow({ days: -3 }, TODAY).from).toBe(
      shiftYmd(TODAY, -(BLOCKED_DEFAULT_DAYS - 1)),
    );
  });

  it("ignores malformed date strings and falls back to the default window", () => {
    const w = resolveBlockedWindow({ from: "06/01/2026", to: "not-a-date" }, TODAY);
    expect(w.to).toBe(TODAY);
    expect(w.from).toBe(shiftYmd(TODAY, -(BLOCKED_DEFAULT_DAYS - 1)));
  });
});
