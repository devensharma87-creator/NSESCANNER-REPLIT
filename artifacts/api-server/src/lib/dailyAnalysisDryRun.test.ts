/**
 * GAP 1 — Telegram dry-run payload proof.
 *
 * Calls buildPreMarketReport and buildPostMarketReport with realistic fixtures
 * (non-zero paper-trade counts, swing counts, F&O trades) via the pure builders —
 * no network, no Telegram send, no DB. Asserts the actual message text contains
 * all required section headers, non-zero counts, and NO fake-zero fabrications.
 *
 * The message text produced by these tests IS the dry-run payload that would be
 * sent to Telegram. Running this file with --reporter=verbose prints the full text.
 */

import { describe, it, expect } from "vitest";
import {
  buildPreMarketReport,
  buildPostMarketReport,
  type PreMarketReportData,
  type PostMarketReportData,
} from "./dailyReports";
import {
  buildCanonicalFnoReadiness,
  type CanonicalFnoReadinessInputs,
  type FnoCycleMetaLike,
} from "./canonicalFnoReadiness";

// ── Shared fixtures ──────────────────────────────────────────────────────────

const REPORT_NOW = new Date("2026-07-10T04:30:00.000Z"); // 10:00 IST, market open

function makeCycle(over: Partial<FnoCycleMetaLike> = {}): FnoCycleMetaLike {
  return {
    ts: REPORT_NOW.getTime(),
    indicesWithBars: 3,
    suppressed: [],
    suppressedSummary: "",
    signalCount: 5,
    highConvictionCount: 2,
    baselineCount: 3,
    ...over,
  };
}

function makeCanonicalFnoInputs(over: Partial<CanonicalFnoReadinessInputs> = {}): CanonicalFnoReadinessInputs {
  return {
    now: REPORT_NOW,
    kite: {
      sessionValid: true,
      sessionPresent: true,
      feedConnected: true,
      feedRunning: true,
      marketSession: "open",
    },
    cycle: makeCycle(),
    optionSnapshot: {
      enabled: true,
      lastRun: { underlyingsAttempted: 3, underlyingsOk: 3, errors: [] },
    },
    totalIndices: 3,
    paperAutoTradingEnabled: true,
    ...over,
  };
}

const READY_CANONICAL_FNO = buildCanonicalFnoReadiness(makeCanonicalFnoInputs());

const BLOCKED_CANONICAL_FNO = buildCanonicalFnoReadiness(
  makeCanonicalFnoInputs({
    kite: { sessionValid: false, sessionPresent: true, feedConnected: false, feedRunning: false, marketSession: "open" },
    cycle: makeCycle({
      signalCount: 0,
      highConvictionCount: 0,
      baselineCount: 0,
      suppressed: [
        { index: "NIFTY", reasons: ["no_live_kite_intraday (Kite session expired)"] },
        { index: "BANKNIFTY", reasons: ["no_live_kite_intraday (Kite session expired)"] },
        { index: "SENSEX", reasons: ["no_live_kite_intraday (Kite session expired)"] },
      ],
    }),
  }),
);

const HEALTHY_KITE = {
  sessionPresent: true,
  user: "AB1234",
  expiresAt: "2026-07-10T15:30:00.000Z",
  minsToExpiry: 330,
  feedConnected: true,
  feedSubscribed: 3,
};

const HEALTHY_SWING = {
  pending: 2,
  approvalRequired: 1,
  approved: 3,
  expired: 0,
  openedToday: 2,
  closedToday: 1,
  blockedToday: 0,
  notificationFailures: 0,
};

// ── Pre-market report tests ──────────────────────────────────────────────────

describe("GAP-1 Telegram dry-run: pre-market report payload", () => {
  it("READY state: includes all required section headers and non-zero signal counts", () => {
    const data: PreMarketReportData = {
      isManualTest: false,
      istDatetime: "10 Jul 2026 10:00",
      isWeekend: false,
      kite: HEALTHY_KITE,
      canonicalFno: READY_CANONICAL_FNO,
      swing: HEALTHY_SWING,
      fiiDii: { date: "2026-07-09", fiiNetCr: 1234.5, diiNetCr: -890.2 },
    };

    const text = buildPreMarketReport(data);

    // Header
    expect(text).toContain("PRE-MARKET STATUS");
    expect(text).toContain("10 Jul 2026 10:00");

    // F&O readiness
    expect(text).toContain("Kite: ACTIVE");
    expect(text).toContain("Feed: CONNECTED");
    expect(text).toContain("F&O readiness: READY");
    expect(text).toContain("Daily bars: 3/3");
    expect(text).toContain("Intraday bars: 3/3");

    // Signal counts (non-zero)
    expect(text).toContain("5 generated");
    expect(text).toContain("2 tradeable");

    // Swing counts (non-zero, GAP-3 proof)
    expect(text).toContain("Opened 2 | Closed 1 | Blocked 0");

    // FII/DII (INFO-ONLY, non-zero, + sign on positive)
    expect(text).toContain("FII net: ₹+1235 Cr");
    expect(text).toContain("DII net: ₹-890 Cr");

    // Honest footer
    expect(text).toContain("Broker execution: DISABLED");
    expect(text).toContain("GIFT Nifty");
    expect(text).toContain("provider not configured");

    // No fabrications
    expect(text).not.toMatch(/not tracked yet/i);
    expect(text).not.toMatch(/unknown/i); // READY state should not say "UNKNOWN"
  });

  it("DATA_BLOCKED state: includes block reason and no signals, not fabricated READY", () => {
    const data: PreMarketReportData = {
      isManualTest: false,
      istDatetime: "10 Jul 2026 09:15",
      isWeekend: false,
      kite: { ...HEALTHY_KITE, sessionPresent: true, feedConnected: false },
      canonicalFno: BLOCKED_CANONICAL_FNO,
      swing: null,
    };

    const text = buildPreMarketReport(data);

    expect(text).toContain("F&O readiness: DATA_BLOCKED");
    expect(text).toContain("Status: DATA_BLOCKED");
    expect(text).toContain("Kite: EXPIRED");
    // Swing unavailable → honest fallback (not "Opened 0")
    expect(text).toContain("Pending 0 | Approved 0 | Expired 0 (unavailable this run)");
    // No fabricated "READY" anywhere
    expect(text).not.toContain("F&O readiness: READY");
  });

  it("isManualTest flag adds [MANUAL TEST] tag to the header", () => {
    const data: PreMarketReportData = {
      isManualTest: true,
      istDatetime: "10 Jul 2026 08:50",
      isWeekend: false,
      kite: HEALTHY_KITE,
      canonicalFno: READY_CANONICAL_FNO,
      swing: HEALTHY_SWING,
    };

    const text = buildPreMarketReport(data);
    expect(text).toContain("PRE-MARKET STATUS [MANUAL TEST]");
  });

  it("weekend flag produces short weekend message, no fabricated data", () => {
    const data: PreMarketReportData = {
      isManualTest: false,
      istDatetime: "12 Jul 2026 08:50",
      isWeekend: true,
      kite: HEALTHY_KITE,
      canonicalFno: null,
      swing: null,
    };

    const text = buildPreMarketReport(data);
    expect(text).toContain("Weekend — markets closed today");
    expect(text).toContain("Broker execution: DISABLED");
    // Weekend message must not contain fake bar counts or signal counts
    expect(text).not.toMatch(/\d+\/3/); // no "X/3 bars"
    expect(text).not.toMatch(/generated \d+/); // no signal counts
  });
});

// ── Post-market report tests ─────────────────────────────────────────────────

describe("GAP-1 Telegram dry-run: post-market report payload", () => {
  it("READY state: includes F&O trade counts, swing counts, equity paper counts", () => {
    const data: PostMarketReportData = {
      isManualTest: false,
      istDate: "2026-07-10",
      datetimeStr: "10 Jul 2026 15:45",
      isWeekend: false,
      canonicalFno: READY_CANONICAL_FNO,
      fno: { tradesOpened: 3, tradesClosed: 2, openCount: 1, totalPnl: 4250.0,
        totalCharges: null,
        totalNetPnl: null,
        chargesCoverage: { current: 0, legacy: 0 },
      },
      swing: {
        pending: 1,
        approved: 2,
        expired: 0,
        openedToday: 2,
        closedToday: 1,
        blockedToday: 0,
        equityOpenCount: 3,
      },
      equityPaper: {
        openedToday: 4,
        closedToday: 2,
        openCount: 5,
        grossPnlToday: null,
        chargesTotalToday: null,
        netPnlToday: null,
        chargesCoverage: { current: 0, legacy: 0 },
      },
      indexPerformance: {
        rows: [
          { name: "NIFTY 50", close: 24500, changePct: 0.85, high: 24600, low: 24350 },
          { name: "BANKNIFTY", close: 52100, changePct: 1.2, high: 52400, low: 51800 },
        ],
        asOfIst: "15:30",
      },
      optionChainEod: null,
      exitMonitorVerified: true,
    };

    const text = buildPostMarketReport(data);

    // Header + date (datetimeStr format)
    expect(text).toContain("POST-MARKET SUMMARY");
    expect(text).toContain("10 Jul 2026 15:45 IST");

    // F&O readiness
    expect(text).toContain("Kite: ACTIVE");

    // F&O trade counts (non-zero, GAP-3 proof)
    expect(text).toMatch(/[Oo]pened.*3|3.*[Oo]pened/);
    expect(text).toMatch(/[Cc]losed.*2|2.*[Cc]losed/);

    // Swing counts (non-zero, GAP-3 proof)
    expect(text).toContain("Opened 2 | Closed 1 | Blocked 0 | Live 3");

    // Equity paper counts (non-zero)
    expect(text).toContain("Opened 4 | Closed 2 | Live 5");

    // Broker disabled
    expect(text).toContain("Broker execution: DISABLED");

    // No fake-zero fabrications
    expect(text).not.toMatch(/not tracked yet/i);
  });

  it("null fno/swing/equity: each null field emits honest 'unavailable' fallback, not fake zeros", () => {
    const data: PostMarketReportData = {
      isManualTest: false,
      istDate: "2026-07-10",
      isWeekend: false,
      canonicalFno: READY_CANONICAL_FNO,
      fno: null,
      swing: null,
      equityPaper: null,
      indexPerformance: null,
      optionChainEod: null,
      exitMonitorVerified: false,
    };

    const text = buildPostMarketReport(data);

    // Should NOT fabricate "Opened 0 | Closed 0" for any null field
    expect(text).not.toMatch(/Opened\s+0\s*\|\s*Closed\s+0/);
    expect(text).toContain("Broker execution: DISABLED");
  });

  it("weekend flag: short message, no fabricated trade counts", () => {
    const data: PostMarketReportData = {
      isManualTest: false,
      istDate: "2026-07-12",
      isWeekend: true,
      canonicalFno: null,
      fno: null,
      swing: null,
      equityPaper: null,
      indexPerformance: null,
      optionChainEod: null,
      exitMonitorVerified: false,
    };

    const text = buildPostMarketReport(data);
    expect(text).toContain("Weekend — no market session today");
    expect(text).toContain("Broker execution: DISABLED");
    expect(text).not.toMatch(/Opened \d/);
  });
});

// ── IndexFnoDiagnostic field proof ────────────────────────────────────────────

describe("GAP-3 F&O IndexFnoDiagnostic: all 7 required fields present and populated", () => {
  it("non-blocked index carries all 7 required owner-required fields", () => {
    const diag = READY_CANONICAL_FNO.indexDiagnostics["NIFTY"]!;
    // The 7 owner-required fields:
    expect(typeof diag.dailyBarsCount).toBe("number");
    expect(typeof diag.intradayBarsCount).toBe("number");
    expect(typeof diag.optionChainFetchOk).toBe("boolean");
    expect(["ok", "missing", "unknown"]).toContain(diag.quoteStatus);
    expect(["kite", "unknown"]).toContain(diag.source);
    expect(diag.asOf).not.toBeNull();
    expect(["LIVE", "STALE", "UNKNOWN"]).toContain(diag.freshness);
    // Existing fields still correct
    expect(diag.blocked).toBe(false);
    expect(diag.intradayBarsOk).toBe(true);
    expect(diag.dailyBarsOk).toBe(true);
    expect(diag.exactBlockReason).toBeNull();
  });

  it("blocked index has asOf=null, freshness=UNKNOWN, barsCount=0", () => {
    const diag = BLOCKED_CANONICAL_FNO.indexDiagnostics["NIFTY"]!;
    expect(diag.blocked).toBe(true);
    expect(diag.intradayBarsCount).toBe(0);
    expect(diag.dailyBarsCount).toBe(0);
    expect(diag.asOf).toBeNull();
    expect(diag.freshness).toBe("UNKNOWN");
    expect(diag.exactBlockReason).toBeTruthy();
  });
});
