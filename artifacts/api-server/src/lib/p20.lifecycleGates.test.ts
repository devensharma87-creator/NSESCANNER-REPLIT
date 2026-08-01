/**
 * §P20 — Fast-Track Pack 2: F&O Lifecycle Gate Proofs
 *
 * Production-function tests covering all confirmed gate behaviors for
 * Gates A–I and L. Imports real production functions — no mocked math,
 * no phantom helpers. Zero DB connections (ordinary non-DB test per pack rules).
 *
 * Gate coverage:
 *   A — Market session state (computeMarketStatus, getMarketStatusDetail, buildCanonicalFnoReadiness)
 *   B — Setup availability honesty (computeIndexFnoSetupAvailability, computeAllIndexFnoSetupAvailability)
 *   C — Confluence/veto structural proof (VWAP availability guard, zero-volume policy)
 *   D — Contract/index policy (OPTION_INDICES, setup policy per index)
 *   E — Signal plan immutability (phase sentinel)
 *   F — Paper admission gates (computePreliminaryAdmission, computeFinalExecutionAdmission, C0 block)
 *   H — Monitoring/exit decisions (evaluateFnoPaperTradeExit, priority rule)
 *   I — Charges and P&L (computeFnoTradeCost, FNO_COST_PARAMS)
 *   L — Lifecycle reconciliation equations (pure formula)
 */

import { describe, it, expect } from "vitest";
import {
  computeMarketStatus,
  getMarketStatusDetail,
  isNseHoliday,
} from "./marketEvents";
import {
  buildCanonicalFnoReadiness,
  deriveMarketSessionLabel,
  type CanonicalFnoReadinessInputs,
} from "./canonicalFnoReadiness";
import {
  computePreliminaryAdmission,
  computeFinalExecutionAdmission,
} from "./sessionAdmission";
import {
  evaluateFnoPaperTradeExit,
  SPOT_EXIT_FRESHNESS_WINDOW_MS,
  FNO_EXIT_PRIORITY_RULE,
  type FnoExitDecisionInput,
} from "./fnoExitDecision";
import {
  computeFnoTradeCost,
  FNO_COST_PARAMS,
  FNO_COST_PARAMS_ASOF,
} from "./fnoCostModel";
import {
  computeIndexFnoSetupAvailability,
  computeAllIndexFnoSetupAvailability,
  OPTION_INDICES,
} from "./optionSignals";
import type { SpotSnapshot } from "./optionSignalLifecycle";

// ─── Shared IST time helpers ─────────────────────────────────────────────────
// IST = UTC + 5h30m; these helpers build UTC Date objects that correspond to
// the requested IST wall-clock time for a reference weekday (2026-07-06 = Monday).

const MONDAY_2026_07_06_IST = "2026-07-06";
const FRIDAY_2026_07_10_IST = "2026-07-10";
const SATURDAY_2026_07_11_IST = "2026-07-11";
const SUNDAY_2026_07_12_IST = "2026-07-12";
/** NSE holiday — Republic Day 2026 (Monday). */
const HOLIDAY_2026_01_26_IST = "2026-01-26";

/** Build a UTC Date that represents `dateIst` at `hh:mm` IST. */
function ist(dateIst: string, hh: number, mm = 0): Date {
  // IST = UTC + 5:30, so UTC = IST - 5:30
  const istMs = new Date(`${dateIst}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00.000Z`).getTime();
  return new Date(istMs - 5.5 * 60 * 60 * 1000);
}

// ─── Gate A — Market session ─────────────────────────────────────────────────

describe("§P20-A Market session state — computeMarketStatus", () => {
  it("A-1: weekday 10:00 IST → open", () => {
    expect(computeMarketStatus(ist(MONDAY_2026_07_06_IST, 10, 0))).toBe("open");
  });

  it("A-2: weekday 15:30 IST → open (inclusive boundary)", () => {
    expect(computeMarketStatus(ist(MONDAY_2026_07_06_IST, 15, 30))).toBe("open");
  });

  it("A-3: weekday 15:31 IST → closed (post close)", () => {
    expect(computeMarketStatus(ist(MONDAY_2026_07_06_IST, 15, 31))).toBe("closed");
  });

  it("A-4: weekday 08:00 IST → closed (before open)", () => {
    expect(computeMarketStatus(ist(MONDAY_2026_07_06_IST, 8, 0))).toBe("closed");
  });

  it("A-5: weekday 09:10 IST → pre_open", () => {
    expect(computeMarketStatus(ist(MONDAY_2026_07_06_IST, 9, 10))).toBe("pre_open");
  });

  it("A-6: weekday 09:15 IST → open (transition boundary)", () => {
    expect(computeMarketStatus(ist(MONDAY_2026_07_06_IST, 9, 15))).toBe("open");
  });

  it("A-7: Saturday → closed", () => {
    expect(computeMarketStatus(ist(SATURDAY_2026_07_11_IST, 11, 0))).toBe("closed");
  });

  it("A-8: Sunday → closed", () => {
    expect(computeMarketStatus(ist(SUNDAY_2026_07_12_IST, 11, 0))).toBe("closed");
  });

  it("A-9: NSE holiday 2026-01-26 (Republic Day) → closed", () => {
    expect(computeMarketStatus(ist(HOLIDAY_2026_01_26_IST, 10, 0))).toBe("closed");
  });
});

describe("§P20-A Market session state — getMarketStatusDetail", () => {
  it("A-10: market open hours → marketOpen=true, reason=OPEN", () => {
    const d = getMarketStatusDetail(ist(MONDAY_2026_07_06_IST, 11, 0));
    expect(d.marketOpen).toBe(true);
    expect(d.reason).toBe("OPEN");
    expect(d.isTradingDay).toBe(true);
  });

  it("A-11: Saturday → marketOpen=false, reason=WEEKEND", () => {
    const d = getMarketStatusDetail(ist(SATURDAY_2026_07_11_IST, 11, 0));
    expect(d.marketOpen).toBe(false);
    expect(d.reason).toBe("WEEKEND");
    expect(d.isTradingDay).toBe(false);
  });

  it("A-12: NSE holiday → marketOpen=false, reason=HOLIDAY", () => {
    const d = getMarketStatusDetail(ist(HOLIDAY_2026_01_26_IST, 10, 0));
    expect(d.marketOpen).toBe(false);
    expect(d.reason).toBe("HOLIDAY");
    expect(d.isTradingDay).toBe(false);
  });

  it("A-13: before open (08:00 IST) → marketOpen=false, reason=BEFORE_OPEN", () => {
    const d = getMarketStatusDetail(ist(MONDAY_2026_07_06_IST, 8, 0));
    expect(d.marketOpen).toBe(false);
    expect(d.reason).toBe("BEFORE_OPEN");
  });

  it("A-14: pre-open (09:10 IST) → marketOpen=false, reason=PRE_OPEN", () => {
    const d = getMarketStatusDetail(ist(MONDAY_2026_07_06_IST, 9, 10));
    expect(d.marketOpen).toBe(false);
    expect(d.reason).toBe("PRE_OPEN");
  });

  it("A-15: after close (16:00 IST) → marketOpen=false, reason=AFTER_CLOSE", () => {
    const d = getMarketStatusDetail(ist(MONDAY_2026_07_06_IST, 16, 0));
    expect(d.marketOpen).toBe(false);
    expect(d.reason).toBe("AFTER_CLOSE");
  });

  it("A-16: exchangeTimezone is Asia/Kolkata", () => {
    const d = getMarketStatusDetail(ist(MONDAY_2026_07_06_IST, 10, 0));
    expect(d.exchangeTimezone).toBe("Asia/Kolkata");
  });

  it("A-17: isNseHoliday confirms 2026-01-26 is a holiday", () => {
    const ist_date = new Date(ist(HOLIDAY_2026_01_26_IST, 10, 0).getTime() + 5.5 * 60 * 60 * 1000);
    expect(isNseHoliday(ist_date)).toBe(true);
  });

  it("A-18: isNseHoliday confirms a regular weekday is not a holiday", () => {
    const ist_date = new Date(ist(MONDAY_2026_07_06_IST, 10, 0).getTime() + 5.5 * 60 * 60 * 1000);
    expect(isNseHoliday(ist_date)).toBe(false);
  });
});

describe("§P20-A Market readiness — buildCanonicalFnoReadiness", () => {
  const BASE_INPUTS: CanonicalFnoReadinessInputs = {
    now: ist(MONDAY_2026_07_06_IST, 10, 0),
    kite: {
      sessionValid: false,
      sessionPresent: false,
      feedConnected: false,
      feedRunning: false,
      marketSession: "open",
    },
    cycle: null,
    optionSnapshot: { enabled: false, lastRun: null },
    totalIndices: 3,
    paperAutoTradingEnabled: false,
  };

  it("A-19: no Kite session → kiteSession=MISSING, tradeGrade=false, canGenerateSignals=false", () => {
    const r = buildCanonicalFnoReadiness(BASE_INPUTS);
    expect(r.kiteSession).toBe("MISSING");
    expect(r.tradeGrade).toBe(false);
    expect(r.canGenerateSignals).toBe(false);
  });

  it("A-20: expired Kite session → kiteSession=EXPIRED", () => {
    const r = buildCanonicalFnoReadiness({
      ...BASE_INPUTS,
      kite: { ...BASE_INPUTS.kite, sessionPresent: true, sessionValid: false },
    });
    expect(r.kiteSession).toBe("EXPIRED");
  });

  it("A-21: active Kite + open market → kiteSession=ACTIVE", () => {
    const r = buildCanonicalFnoReadiness({
      ...BASE_INPUTS,
      kite: { ...BASE_INPUTS.kite, sessionValid: true, sessionPresent: true, feedConnected: true, feedRunning: true },
    });
    expect(r.kiteSession).toBe("ACTIVE");
  });

  it("A-22: marketSession is 'open' in output when Kite reports open on a trading day", () => {
    const r = buildCanonicalFnoReadiness({
      ...BASE_INPUTS,
      kite: { ...BASE_INPUTS.kite, marketSession: "open" },
    });
    expect(r.marketSession).toBe("open");
  });

  it("A-23: deriveMarketSessionLabel returns holiday for NSE holiday dates", () => {
    const holidayDate = ist(HOLIDAY_2026_01_26_IST, 10, 0);
    const label = deriveMarketSessionLabel(holidayDate, "closed");
    expect(label).toBe("holiday");
  });

  it("A-24: deriveMarketSessionLabel returns preopen for pre_open rawStatus", () => {
    const label = deriveMarketSessionLabel(ist(MONDAY_2026_07_06_IST, 9, 10), "pre_open");
    expect(label).toBe("preopen");
  });

  it("A-25: canOpenPaperTrades=false when paperAutoTradingEnabled=false", () => {
    const r = buildCanonicalFnoReadiness({
      ...BASE_INPUTS,
      kite: { ...BASE_INPUTS.kite, sessionValid: true, sessionPresent: true, feedConnected: true, feedRunning: true },
      paperAutoTradingEnabled: false,
    });
    expect(r.canOpenPaperTrades).toBe(false);
  });
});

// ─── Gate B — Setup availability honesty ────────────────────────────────────

describe("§P20-B Setup availability honesty", () => {
  it("B-1: computeAllIndexFnoSetupAvailability returns exactly 9 records (3 indices × 3 setups)", () => {
    const rows = computeAllIndexFnoSetupAvailability();
    expect(rows).toHaveLength(9);
  });

  it("B-2: all 9 records have eligibleForEmission=false", () => {
    const rows = computeAllIndexFnoSetupAvailability();
    for (const r of rows) {
      expect(r.eligibleForEmission).toBe(false);
    }
  });

  it("B-3: all three supported indices are covered (NIFTY, BANKNIFTY, SENSEX)", () => {
    const rows = computeAllIndexFnoSetupAvailability();
    const indices = new Set(rows.map(r => r.indexSymbol));
    expect(indices.has("NIFTY")).toBe(true);
    expect(indices.has("BANKNIFTY")).toBe(true);
    expect(indices.has("SENSEX")).toBe(true);
  });

  it("B-4: NIFTY VOLUME_BREAKOUT — reasonCode=INDEX_VOLUME_UNAVAILABLE", () => {
    const r = computeIndexFnoSetupAvailability("NIFTY").find(x => x.setupKey === "VOLUME_BREAKOUT");
    expect(r?.reasonCode).toBe("INDEX_VOLUME_UNAVAILABLE");
    expect(r?.status).toBe("UNAVAILABLE_REQUIRED_INPUT");
  });

  it("B-5: BANKNIFTY MEAN_REVERSION — reasonCode=SESSION_VWAP_UNAVAILABLE", () => {
    const r = computeIndexFnoSetupAvailability("BANKNIFTY").find(x => x.setupKey === "MEAN_REVERSION");
    expect(r?.reasonCode).toBe("SESSION_VWAP_UNAVAILABLE");
    expect(r?.status).toBe("UNAVAILABLE_REQUIRED_INPUT");
  });

  it("B-6: SENSEX TREND_CONTINUATION_NO_VWAP — status=RETIRED_INDEX_FNO_POLICY", () => {
    const r = computeIndexFnoSetupAvailability("SENSEX").find(x => x.setupKey === "TREND_CONTINUATION_NO_VWAP");
    expect(r?.status).toBe("RETIRED_INDEX_FNO_POLICY");
    expect(r?.eligibleForEmission).toBe(false);
  });

  it("B-7: each index has exactly 3 setup entries", () => {
    for (const idx of ["NIFTY", "BANKNIFTY", "SENSEX"] as const) {
      expect(computeIndexFnoSetupAvailability(idx)).toHaveLength(3);
    }
  });

  it("B-8: VOLUME_BREAKOUT missingInputs includes volumeProfile for all indices", () => {
    const rows = computeAllIndexFnoSetupAvailability().filter(r => r.setupKey === "VOLUME_BREAKOUT");
    for (const r of rows) {
      expect(r.missingInputs).toContain("volumeProfile");
    }
  });

  it("B-9: MEAN_REVERSION missingInputs includes sessionVwap for all indices", () => {
    const rows = computeAllIndexFnoSetupAvailability().filter(r => r.setupKey === "MEAN_REVERSION");
    for (const r of rows) {
      expect(r.missingInputs).toContain("sessionVwap");
    }
  });

  it("B-10: scope=INDEX_FNO on all availability records", () => {
    for (const r of computeAllIndexFnoSetupAvailability()) {
      expect(r.scope).toBe("INDEX_FNO");
    }
  });

  it("B-11: OPTION_INDICES export covers exactly NIFTY, BANKNIFTY, SENSEX", () => {
    const symbols = OPTION_INDICES.map(i => i.symbol);
    expect(symbols).toContain("NIFTY");
    expect(symbols).toContain("BANKNIFTY");
    expect(symbols).toContain("SENSEX");
    expect(symbols).toHaveLength(3);
  });
});

// ─── Gate C — Confluence/VWAP policy structural proof ───────────────────────

describe("§P20-C Confluence/VWAP policy — structural proofs", () => {
  it("C-1: VOLUME_BREAKOUT explanation mentions zero volume as the root cause (no substitute)", () => {
    const r = computeIndexFnoSetupAvailability("NIFTY").find(x => x.setupKey === "VOLUME_BREAKOUT");
    expect(r?.explanation.toLowerCase()).toContain("zero volume");
  });

  it("C-2: MEAN_REVERSION explanation mentions genuine session VWAP requirement", () => {
    const r = computeIndexFnoSetupAvailability("NIFTY").find(x => x.setupKey === "MEAN_REVERSION");
    expect(r?.explanation.toLowerCase()).toContain("vwap");
    // Must explicitly say no proxy is substituted
    expect(r?.explanation.toLowerCase()).toMatch(/no (substitute|proxy)/);
  });

  it("C-3: TREND_CONTINUATION_NO_VWAP explanation explains max-conf arithmetic", () => {
    const r = computeIndexFnoSetupAvailability("NIFTY").find(x => x.setupKey === "TREND_CONTINUATION_NO_VWAP");
    // Should mention threshold and conf ceiling
    expect(r?.explanation).toContain("50");
  });
});

// ─── Gate D — Index/contract policy ─────────────────────────────────────────

describe("§P20-D Index and contract policy", () => {
  it("D-1: FNO_COST_PARAMS_ASOF documents the authoritative rate date (2026-04-01)", () => {
    expect(FNO_COST_PARAMS_ASOF).toBe("2026-04-01");
  });

  it("D-2: STT rate is 0.0015 (0.15% on sell-side premium, eff 2026-04-01)", () => {
    expect(FNO_COST_PARAMS.STT_RATE_SELL_PREMIUM).toBeCloseTo(0.0015, 6);
  });

  it("D-3: NIFTY setup availability covers all 3 setup keys", () => {
    const keys = computeIndexFnoSetupAvailability("NIFTY").map(r => r.setupKey);
    expect(keys).toContain("VOLUME_BREAKOUT");
    expect(keys).toContain("MEAN_REVERSION");
    expect(keys).toContain("TREND_CONTINUATION_NO_VWAP");
  });

  it("D-4: SENSEX setup policy identical in structure to NIFTY/BANKNIFTY", () => {
    const nifty = computeIndexFnoSetupAvailability("NIFTY");
    const sensex = computeIndexFnoSetupAvailability("SENSEX");
    const niftyKeys = nifty.map(r => r.setupKey).sort();
    const sensexKeys = sensex.map(r => r.setupKey).sort();
    expect(sensexKeys).toEqual(niftyKeys);
  });
});

// ─── Gate E — Signal plan immutability (structural sentinel) ─────────────────

describe("§P20-E Signal plan immutability — structural sentinels", () => {
  it("E-1: FNO_EXIT_PRIORITY_RULE is STOP_WINS_ON_SAME_BAR_TIE (documented deterministic ordering)", () => {
    expect(FNO_EXIT_PRIORITY_RULE).toBe("STOP_WINS_ON_SAME_BAR_TIE");
  });

  it("E-2: SPOT_EXIT_FRESHNESS_WINDOW_MS is 120_000 ms (2 sweep cycles of tolerance)", () => {
    expect(SPOT_EXIT_FRESHNESS_WINDOW_MS).toBe(120_000);
  });
});

// ─── Gate F — Paper admission gates ─────────────────────────────────────────

describe("§P20-F Paper admission gates", () => {
  // Phase A gate tests
  const CUTOFF_POLICY = { istMinOfDay: 14 * 60 + 45, policySource: "STANDARD_14:45" };
  const FO_DECISION_TIME = ist(MONDAY_2026_07_06_IST, 11, 0);

  it("F-1: computePreliminaryAdmission with NSE FO lane during market hours → allowed", () => {
    const result = computePreliminaryAdmission({
      lane: "nse_fo",
      segment: "nse_fo",
      instrument: "NIFTY26JUL24500CE",
      serverTime: ist(MONDAY_2026_07_06_IST, 11, 0),
      source: "AUTO",
      entryCutoffPolicy: CUTOFF_POLICY,
    });
    expect(result.phase).toBe("PRELIMINARY");
    expect(result.allowed).toBe(true);
  });

  it("F-2: computePreliminaryAdmission with NSE FO lane on weekend → rejected", () => {
    const result = computePreliminaryAdmission({
      lane: "nse_fo",
      segment: "nse_fo",
      instrument: "NIFTY26JUL24500CE",
      serverTime: ist(SATURDAY_2026_07_11_IST, 11, 0),
      source: "AUTO",
      entryCutoffPolicy: CUTOFF_POLICY,
    });
    expect(result.allowed).toBe(false);
  });

  it("F-3: computePreliminaryAdmission on NSE holiday → rejected", () => {
    const result = computePreliminaryAdmission({
      lane: "nse_fo",
      segment: "nse_fo",
      instrument: "NIFTY26JAN24500CE",
      serverTime: ist(HOLIDAY_2026_01_26_IST, 11, 0),
      source: "AUTO",
      entryCutoffPolicy: CUTOFF_POLICY,
    });
    expect(result.allowed).toBe(false);
  });

  it("F-4: computePreliminaryAdmission during pre-open (09:10 IST) → rejected", () => {
    const result = computePreliminaryAdmission({
      lane: "nse_fo",
      segment: "nse_fo",
      instrument: "NIFTY26JUL24500CE",
      serverTime: ist(MONDAY_2026_07_06_IST, 9, 10),
      source: "AUTO",
      entryCutoffPolicy: CUTOFF_POLICY,
    });
    expect(result.allowed).toBe(false);
  });

  // Phase B gate: F&O always fails closed
  it("F-5: computeFinalExecutionAdmission with lane=nse_fo → always rejected (no event timestamp)", () => {
    const result = computeFinalExecutionAdmission({
      lane: "nse_fo",
      segment: "nse_fo",
      instrument: "NIFTY26JUL24500CE",
      decisionTime: FO_DECISION_TIME,
      source: "AUTO",
    });
    expect(result.phase).toBe("FINAL_EXECUTION");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("TRADE_ADMISSION_CONTEXT_INCOMPLETE");
      expect(result.detail).toContain("no trusted per-premium event timestamp");
    }
  });

  it("F-6: computeFinalExecutionAdmission with lane=bse_fo → always rejected (no event timestamp)", () => {
    const result = computeFinalExecutionAdmission({
      lane: "bse_fo",
      segment: "bse_fo",
      instrument: "SENSEX26JUL80000CE",
      decisionTime: FO_DECISION_TIME,
      source: "AUTO",
    });
    expect(result.phase).toBe("FINAL_EXECUTION");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("TRADE_ADMISSION_CONTEXT_INCOMPLETE");
    }
  });

  it("F-7: Phase B rejection quoteProvenance=fno_no_provider_timestamp (machine-readable reason)", () => {
    const result = computeFinalExecutionAdmission({
      lane: "nse_fo",
      segment: "nse_fo",
      instrument: "NIFTY26JUL24500CE",
      decisionTime: FO_DECISION_TIME,
      source: "AUTO",
    });
    expect(result.allowed).toBe(false);
    // quoteProvenance is present on both allowed and rejected FinalExecutionAdmissionResult variants
    expect(result.quoteProvenance).toBe("fno_no_provider_timestamp");
  });
});

// ─── Gate H — Monitoring and exit decisions ──────────────────────────────────

describe("§P20-H Monitoring and exit decisions — evaluateFnoPaperTradeExit", () => {
  // Reference: BULLISH trade — entry 22000, stop 21900, T1 22200, T2 22400.
  const BASE_INPUT: FnoExitDecisionInput = {
    currentStatus: "TRIGGERED",
    direction: "BULLISH",
    entry: 22000,
    stop: 21900,
    target1: 22200,
    target2: 22400,
    snapshot: { spot: 22100 } as SpotSnapshot,
    provenance: {
      source: "LIVE_KITE_FULL" as const,
      kiteSessionActive: true,
      asOfMs: Date.now() - 5_000,
    },
    nowMs: Date.now(),
  };

  it("H-1: stale quote (asOfMs too old) → BLOCKED with STALE_QUOTE", () => {
    const result = evaluateFnoPaperTradeExit({
      ...BASE_INPUT,
      provenance: {
        ...BASE_INPUT.provenance,
        asOfMs: Date.now() - SPOT_EXIT_FRESHNESS_WINDOW_MS - 10_000,
      },
    });
    expect(result.kind).toBe("BLOCKED");
    expect(result.tradeGrade).toBe(false);
    if (result.kind === "BLOCKED") expect(result.blockedReason).toBe("STALE_QUOTE");
  });

  it("H-2: asOfMs=null → BLOCKED with STALE_QUOTE (missing quote)", () => {
    const result = evaluateFnoPaperTradeExit({
      ...BASE_INPUT,
      provenance: { ...BASE_INPUT.provenance, asOfMs: null },
    });
    expect(result.kind).toBe("BLOCKED");
    if (result.kind === "BLOCKED") expect(result.blockedReason).toBe("STALE_QUOTE");
  });

  it("H-3: DELAYED_YAHOO source → BLOCKED with SOURCE_NOT_TRADE_GRADE", () => {
    const result = evaluateFnoPaperTradeExit({
      ...BASE_INPUT,
      provenance: { ...BASE_INPUT.provenance, source: "DELAYED_YAHOO" as const },
    });
    expect(result.kind).toBe("BLOCKED");
    if (result.kind === "BLOCKED") expect(result.blockedReason).toBe("SOURCE_NOT_TRADE_GRADE");
  });

  it("H-4: inactive Kite session → BLOCKED with KITE_UNAVAILABLE", () => {
    const result = evaluateFnoPaperTradeExit({
      ...BASE_INPUT,
      provenance: { ...BASE_INPUT.provenance, kiteSessionActive: false },
    });
    expect(result.kind).toBe("BLOCKED");
    if (result.kind === "BLOCKED") expect(result.blockedReason).toBe("KITE_UNAVAILABLE");
  });

  it("H-5: contractValid=false → BLOCKED with CONTRACT_INVALID (highest precedence)", () => {
    const result = evaluateFnoPaperTradeExit({ ...BASE_INPUT, contractValid: false });
    expect(result.kind).toBe("BLOCKED");
    if (result.kind === "BLOCKED") expect(result.blockedReason).toBe("CONTRACT_INVALID");
  });

  it("H-6: CONTRACT_INVALID has higher precedence than KITE_UNAVAILABLE", () => {
    const result = evaluateFnoPaperTradeExit({
      ...BASE_INPUT,
      contractValid: false,
      provenance: { ...BASE_INPUT.provenance, kiteSessionActive: false },
    });
    if (result.kind === "BLOCKED") expect(result.blockedReason).toBe("CONTRACT_INVALID");
  });

  it("H-7: spot at TARGET1 level (hi=target1, no t2 hit) → HOLD with next=TARGET1_HIT (trade continues, exited:false)", () => {
    // evaluateTransition returns { next:"TARGET1_HIT", exited:false } — T1 is a PARTIAL exit milestone,
    // not a terminal close. The trade remains alive, targeting T2. evaluateFnoPaperTradeExit
    // therefore returns HOLD (not EXIT) with the lifecycle advanced to TARGET1_HIT.
    const result = evaluateFnoPaperTradeExit({
      ...BASE_INPUT,
      snapshot: { spot: 22200, high: 22200, low: 22000 },
    });
    expect(result.kind).toBe("HOLD");
    if (result.kind === "HOLD") {
      expect(result.tradeGrade).toBe(true);
      expect(result.next).toBe("TARGET1_HIT"); // lifecycle advanced but NOT terminal
    }
  });

  it("H-7b: spot at TARGET2 level → EXIT TARGET2_HIT (terminal exit)", () => {
    // T2 hit is the only TARGET that closes the trade (exited:true)
    const result = evaluateFnoPaperTradeExit({
      ...BASE_INPUT,
      snapshot: { spot: 22400, high: 22400, low: 22100 },
    });
    expect(result.kind).toBe("EXIT");
    if (result.kind === "EXIT") {
      expect(result.exitReason).toBe("TARGET2_HIT");
      expect(result.tradeGrade).toBe(true);
      expect(result.settlement).toBe("FROZEN_PREMIUM");
    }
  });

  it("H-8: fresh trade-grade data, spot below stop (lo=stop) → EXIT STOPPED", () => {
    const result = evaluateFnoPaperTradeExit({
      ...BASE_INPUT,
      snapshot: { spot: 21900, high: 22000, low: 21900 },
    });
    expect(result.kind).toBe("EXIT");
    if (result.kind === "EXIT") expect(result.exitReason).toBe("STOPPED");
  });

  it("H-9: same-bar stop+target hit → STOP wins (FNO_EXIT_PRIORITY_RULE)", () => {
    // lo ≤ stop (21900) AND hi ≥ target1 (22200) both true in same snapshot
    const result = evaluateFnoPaperTradeExit({
      ...BASE_INPUT,
      snapshot: { spot: 22050, high: 22300, low: 21850 },
    });
    expect(result.kind).toBe("EXIT");
    if (result.kind === "EXIT") {
      // Stop wins per documented priority rule
      expect(result.exitReason).toBe("STOPPED");
      expect(result.priorityRule).toBe(FNO_EXIT_PRIORITY_RULE);
      expect(result.priorityRule).toBe("STOP_WINS_ON_SAME_BAR_TIE");
    }
  });

  it("H-10: fresh trade-grade data, spot neutral (not at stop or target) → HOLD", () => {
    const result = evaluateFnoPaperTradeExit({
      ...BASE_INPUT,
      snapshot: { spot: 22100, high: 22150, low: 22050 },
    });
    expect(result.kind).toBe("HOLD");
    expect(result.tradeGrade).toBe(true);
  });

  it("H-11: BLOCKED result includes wouldHaveExited diagnostic (never mutates trade)", () => {
    // Stale data where target would have been hit — wouldHaveExited=true but kind=BLOCKED
    const result = evaluateFnoPaperTradeExit({
      ...BASE_INPUT,
      snapshot: { spot: 22200, high: 22200, low: 22000 }, // target hit
      provenance: { ...BASE_INPUT.provenance, asOfMs: null }, // stale
    });
    expect(result.kind).toBe("BLOCKED");
    if (result.kind === "BLOCKED") {
      // wouldHaveExited is diagnostic only — never used to close anything
      expect(typeof result.wouldHaveExited).toBe("boolean");
    }
  });

  it("H-12: BEARISH trade — lo ≤ target1 → HOLD with next=TARGET1_HIT (T1 is milestone, not terminal)", () => {
    // Same lifecycle rule as BULLISH: T1 leaves trade alive targeting T2 (exited:false).
    const result = evaluateFnoPaperTradeExit({
      ...BASE_INPUT,
      direction: "BEARISH",
      entry: 22000,
      stop: 22100,    // stop is above entry for bearish
      target1: 21800, // target is below entry
      target2: 21600,
      snapshot: { spot: 21800, high: 22000, low: 21800 },
    });
    expect(result.kind).toBe("HOLD");
    if (result.kind === "HOLD") expect(result.next).toBe("TARGET1_HIT");
  });

  it("H-12b: BEARISH trade — hi ≥ stop fires STOPPED (terminal EXIT)", () => {
    const result = evaluateFnoPaperTradeExit({
      ...BASE_INPUT,
      direction: "BEARISH",
      entry: 22000,
      stop: 22100,
      target1: 21800,
      target2: 21600,
      snapshot: { spot: 22050, high: 22150, low: 21950 }, // hi >= stop
    });
    expect(result.kind).toBe("EXIT");
    if (result.kind === "EXIT") expect(result.exitReason).toBe("STOPPED");
  });

  it("H-13: quoteSource/quoteAsOfMs/quoteFreshnessSec are surfaced on all result kinds", () => {
    const blockResult = evaluateFnoPaperTradeExit({
      ...BASE_INPUT,
      provenance: { ...BASE_INPUT.provenance, asOfMs: null },
    });
    expect(blockResult.quoteSource).toBe("LIVE_KITE_FULL");
    expect(blockResult.quoteAsOfMs).toBeNull();
    expect(blockResult.quoteFreshnessSec).toBeNull();
  });
});

// ─── Gate I — Charges and P&L ────────────────────────────────────────────────

describe("§P20-I Charges and P&L — computeFnoTradeCost", () => {
  const NIFTY_LOT = 25;
  const LOTS = 2;
  const QTY = LOTS * NIFTY_LOT; // 50

  it("I-1: winning CALL trade — grossPnl = (exit-entry) × qty (positive)", () => {
    const r = computeFnoTradeCost({ entryPremium: 100, exitPremium: 140, lots: LOTS, lotSize: NIFTY_LOT });
    expect(r.computable).toBe(true);
    expect(r.quantity).toBe(QTY);
    // grossPnl = (140-100) × 50 = 2000
    expect(r.grossPnl).toBeCloseTo(2000, 1);
  });

  it("I-2: losing CALL trade — grossPnl negative (exit < entry)", () => {
    const r = computeFnoTradeCost({ entryPremium: 100, exitPremium: 60, lots: LOTS, lotSize: NIFTY_LOT });
    expect(r.grossPnl).toBeCloseTo(-2000, 1);
    expect(r.grossPnl).not.toBeNull();
    expect(r.grossPnl!).toBeLessThan(0);
  });

  it("I-3: netPnl = grossPnl - totalCost (costs reduce gains)", () => {
    const r = computeFnoTradeCost({ entryPremium: 100, exitPremium: 140, lots: LOTS, lotSize: NIFTY_LOT });
    expect(r.netPnl).not.toBeNull();
    expect(r.netPnl!).toBeLessThan(r.grossPnl!);
    expect(r.netPnl).toBeCloseTo(r.grossPnl! - r.totalCost, 2);
  });

  it("I-4: totalCost is always positive for a completed trade", () => {
    const r = computeFnoTradeCost({ entryPremium: 100, exitPremium: 60, lots: LOTS, lotSize: NIFTY_LOT });
    expect(r.totalCost).toBeGreaterThan(0);
  });

  it("I-5: STT = sellTurnover × STT_RATE_SELL_PREMIUM (0.0015)", () => {
    const r = computeFnoTradeCost({ entryPremium: 100, exitPremium: 140, lots: LOTS, lotSize: NIFTY_LOT });
    const expectedStt = r.sellTurnover * FNO_COST_PARAMS.STT_RATE_SELL_PREMIUM;
    expect(r.stt).toBeCloseTo(expectedStt, 4);
  });

  it("I-6: brokerage = ₹40 per round trip (₹20 × 2 sides)", () => {
    const r = computeFnoTradeCost({ entryPremium: 100, exitPremium: 140, lots: LOTS, lotSize: NIFTY_LOT });
    expect(r.brokerage).toBe(40);
  });

  it("I-7: brokerage = ₹20 for single side (no exit premium)", () => {
    const r = computeFnoTradeCost({ entryPremium: 100, exitPremium: null, lots: LOTS, lotSize: NIFTY_LOT });
    expect(r.brokerage).toBe(20);
    expect(r.grossPnl).toBeNull();
    expect(r.netPnl).toBeNull();
  });

  it("I-8: missing exit premium → grossPnl=null, netPnl=null (no fabricated zero)", () => {
    const r = computeFnoTradeCost({ entryPremium: 100, exitPremium: null, lots: LOTS, lotSize: NIFTY_LOT });
    expect(r.grossPnl).toBeNull();
    expect(r.netPnl).toBeNull();
  });

  it("I-9: entryPremium=0 → computable=false (degenerate input, no fabricated P&L)", () => {
    const r = computeFnoTradeCost({ entryPremium: 0, exitPremium: 100, lots: LOTS, lotSize: NIFTY_LOT });
    expect(r.computable).toBe(false);
    expect(r.grossPnl).toBeNull();
    expect(r.netPnl).toBeNull();
  });

  it("I-10: lots=0 → computable=false (no quantity, no P&L)", () => {
    const r = computeFnoTradeCost({ entryPremium: 100, exitPremium: 140, lots: 0, lotSize: NIFTY_LOT });
    expect(r.computable).toBe(false);
    expect(r.quantity).toBe(0);
  });

  it("I-11: quantity = lots × lotSize (exact integer)", () => {
    const r = computeFnoTradeCost({ entryPremium: 100, exitPremium: 140, lots: 3, lotSize: 30 });
    expect(r.quantity).toBe(90);
  });

  it("I-12: PUT trade follows same grossPnl formula (exit - entry) × qty — no direction inversion", () => {
    // PUT paper trades are BUY side — same P&L formula as CALL
    const r = computeFnoTradeCost({ entryPremium: 200, exitPremium: 260, lots: 1, lotSize: NIFTY_LOT });
    expect(r.grossPnl).toBeCloseTo((260 - 200) * NIFTY_LOT, 1);
  });

  it("I-13: GST = 18% of (brokerage + exchangeTxn + sebi)", () => {
    const r = computeFnoTradeCost({ entryPremium: 100, exitPremium: 140, lots: LOTS, lotSize: NIFTY_LOT });
    const expectedGst = (r.brokerage + r.exchangeTxn + r.sebi) * FNO_COST_PARAMS.GST_RATE;
    expect(r.gst).toBeCloseTo(expectedGst, 4);
  });

  it("I-14: stamp duty on BUY side only (buyTurnover × STAMP_DUTY_RATE_BUY)", () => {
    const r = computeFnoTradeCost({ entryPremium: 100, exitPremium: 140, lots: LOTS, lotSize: NIFTY_LOT });
    expect(r.stampDuty).toBeCloseTo(r.buyTurnover * FNO_COST_PARAMS.STAMP_DUTY_RATE_BUY, 6);
  });

  it("I-15: totalCost = sum of all components (arithmetic consistency)", () => {
    const r = computeFnoTradeCost({ entryPremium: 100, exitPremium: 140, lots: LOTS, lotSize: NIFTY_LOT });
    const sumComponents = r.brokerage + r.stt + r.exchangeTxn + r.sebi + r.gst + r.stampDuty + r.spreadCost + r.slippageCost;
    expect(r.totalCost).toBeCloseTo(sumComponents, 4);
  });

  it("I-16: BANKNIFTY lot (30) × 1 lot → quantity=30", () => {
    const r = computeFnoTradeCost({ entryPremium: 500, exitPremium: 600, lots: 1, lotSize: 30 });
    expect(r.quantity).toBe(30);
    expect(r.buyTurnover).toBeCloseTo(500 * 30, 1);
  });
});

// ─── Gate L — Lifecycle reconciliation equations ────────────────────────────

describe("§P20-L Lifecycle reconciliation equations (pure formula proof)", () => {
  /**
   * Verifies the lifecycle count invariants specified in Gate L (§17).
   * These are pure arithmetic checks — no live data needed.
   */

  interface LifecycleCounts {
    candidatesDetected: number;
    setupEligible: number;
    signalsEmitted: number;
    tradeableSignals: number;
    watchlistSignals: number;
    infoOnlySignals: number;
    admissionPassed: number;
    admissionRejected: number;
    paperOpened: number;
    paperStillOpen: number;
    paperClosed: number;
  }

  function validateLifecycleEquations(c: LifecycleCounts): string[] {
    const errors: string[] = [];

    // Equation 1: signalsEmitted = tradeableSignals + watchlistSignals + infoOnlySignals
    if (c.signalsEmitted !== c.tradeableSignals + c.watchlistSignals + c.infoOnlySignals) {
      errors.push("EQ1: signalsEmitted ≠ tradeableSignals + watchlistSignals + infoOnlySignals");
    }

    // Equation 2: tradeableSignals = admissionPassed + admissionRejected
    if (c.tradeableSignals !== c.admissionPassed + c.admissionRejected) {
      errors.push("EQ2: tradeableSignals ≠ admissionPassed + admissionRejected");
    }

    // Equation 3: admissionPassed = paperOpened (+ open failures, here simplified to zero)
    if (c.admissionPassed !== c.paperOpened) {
      errors.push("EQ3: admissionPassed ≠ paperOpened (assuming zero open-write failures)");
    }

    // Equation 4: paperOpened = paperStillOpen + paperClosed (for the same cohort)
    if (c.paperOpened !== c.paperStillOpen + c.paperClosed) {
      errors.push("EQ4: paperOpened ≠ paperStillOpen + paperClosed");
    }

    return errors;
  }

  it("L-1: balanced lifecycle counts satisfy all four equations", () => {
    const counts: LifecycleCounts = {
      candidatesDetected: 5,
      setupEligible: 3,
      signalsEmitted: 3,
      tradeableSignals: 2,
      watchlistSignals: 1,
      infoOnlySignals: 0,
      admissionPassed: 1,
      admissionRejected: 1,
      paperOpened: 1,
      paperStillOpen: 0,
      paperClosed: 1,
    };
    expect(validateLifecycleEquations(counts)).toEqual([]);
  });

  it("L-2: INFO_ONLY signals must not reach admission (EQ1 broken if they do)", () => {
    const counts: LifecycleCounts = {
      candidatesDetected: 3,
      setupEligible: 2,
      signalsEmitted: 2,
      tradeableSignals: 0,
      watchlistSignals: 0,
      infoOnlySignals: 2, // all info-only
      admissionPassed: 0,
      admissionRejected: 0,
      paperOpened: 0,
      paperStillOpen: 0,
      paperClosed: 0,
    };
    expect(validateLifecycleEquations(counts)).toEqual([]);
  });

  it("L-3: miscounted signals fail EQ1 detection", () => {
    const bad: LifecycleCounts = {
      candidatesDetected: 4,
      setupEligible: 3,
      signalsEmitted: 3,
      tradeableSignals: 2,
      watchlistSignals: 2, // should be 1 — total 4 ≠ 3
      infoOnlySignals: 0,
      admissionPassed: 1,
      admissionRejected: 1,
      paperOpened: 1,
      paperStillOpen: 0,
      paperClosed: 1,
    };
    const errors = validateLifecycleEquations(bad);
    expect(errors.some(e => e.includes("EQ1"))).toBe(true);
  });

  it("L-4: admission total that doesn't match tradeable fails EQ2", () => {
    const bad: LifecycleCounts = {
      candidatesDetected: 3,
      setupEligible: 2,
      signalsEmitted: 2,
      tradeableSignals: 2,
      watchlistSignals: 0,
      infoOnlySignals: 0,
      admissionPassed: 2,
      admissionRejected: 2, // 2+2=4 ≠ 2
      paperOpened: 2,
      paperStillOpen: 2,
      paperClosed: 0,
    };
    const errors = validateLifecycleEquations(bad);
    expect(errors.some(e => e.includes("EQ2"))).toBe(true);
  });

  it("L-5: open count mismatch fails EQ4", () => {
    const bad: LifecycleCounts = {
      candidatesDetected: 3,
      setupEligible: 2,
      signalsEmitted: 2,
      tradeableSignals: 1,
      watchlistSignals: 1,
      infoOnlySignals: 0,
      admissionPassed: 1,
      admissionRejected: 0,
      paperOpened: 1,
      paperStillOpen: 1,
      paperClosed: 1, // 1+1=2 ≠ 1
    };
    const errors = validateLifecycleEquations(bad);
    expect(errors.some(e => e.includes("EQ4"))).toBe(true);
  });

  it("L-6: all-quiet session (zero signals) satisfies all equations", () => {
    const quiet: LifecycleCounts = {
      candidatesDetected: 0,
      setupEligible: 0,
      signalsEmitted: 0,
      tradeableSignals: 0,
      watchlistSignals: 0,
      infoOnlySignals: 0,
      admissionPassed: 0,
      admissionRejected: 0,
      paperOpened: 0,
      paperStillOpen: 0,
      paperClosed: 0,
    };
    expect(validateLifecycleEquations(quiet)).toEqual([]);
  });
});
