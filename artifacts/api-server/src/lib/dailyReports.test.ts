/**
 * Tests for daily report builders (pure functions — no DB, no Kite, no Telegram).
 *
 * Coverage (Checkpoint 1 Part C/D rewrite, 2026-07-03):
 *   – Pre-market builder: healthy / Kite missing / data blocked / partial / no-setup /
 *     canonicalFno null / swing null / weekend
 *   – Post-market builder: healthy / fno null / null P&L / zero-trade / swing null /
 *     index performance / option chain EOD / data health / tomorrow prep / weekend
 *   – Source-honesty: no secrets, no fake zeros
 *   – DAILY_ANALYSIS_COVERAGE data coverage matrix
 *   – No forbidden wording (fake "0" for untracked data)
 */

import { describe, it, expect } from "vitest";
import {
  buildPreMarketReport,
  buildPostMarketReport,
  DAILY_ANALYSIS_COVERAGE,
  type PreMarketReportData,
  type PreMarketKite,
  type PreMarketSwing,
  type PostMarketReportData,
  type PostMarketFno,
  type PostMarketSwing,
  type PostMarketIndexPerformance,
  type PostMarketOptionChainEod,
  type CanonicalFnoReadiness,
} from "./dailyReports";

// ── Pre-market data fixtures ──────────────────────────────────────────────────

const healthyKite: PreMarketKite = {
  sessionPresent: true,
  user: "Hrishi",
  expiresAt: "2026-07-02T01:00:00.000Z",
  minsToExpiry: 960,
  feedConnected: true,
  feedSubscribed: 75,
};

const missingKite: PreMarketKite = {
  sessionPresent: false,
  user: null,
  expiresAt: null,
  minsToExpiry: null,
  feedConnected: false,
  feedSubscribed: 0,
};

const healthyCanonicalFno: CanonicalFnoReadiness = {
  checkedAt: "2026-07-01T03:20:00.000Z",
  kiteSession: "ACTIVE",
  feedStatus: "CONNECTED",
  marketSession: "open",
  dailyBars: { status: "READY", readyCount: 3, totalCount: 3, reason: null },
  intradayBars: { status: "READY", readyCount: 3, totalCount: 3, reason: null },
  optionChain: { status: "READY", reason: null },
  signalCycle: {
    lastCycleAt: "2026-07-01T03:20:00.000Z",
    generatedSignals: 5,
    tradeableSignals: 2,
    suppressedSignals: 3,
    status: "READY",
    reasons: [],
    suppressedIndices: [],
  },
  tradeGrade: true,
  canGenerateSignals: true,
  canOpenPaperTrades: true,
  indexDiagnostics: {},
  telegramSummary: "Kite: ACTIVE | Feed: CONNECTED | Market: open",
};

const missingKiteCanonicalFno: CanonicalFnoReadiness = {
  ...healthyCanonicalFno,
  kiteSession: "MISSING",
  feedStatus: "DISCONNECTED",
  marketSession: "closed",
  dailyBars: { status: "MISSING", readyCount: 0, totalCount: 3, reason: "KITE_SESSION_MISSING" },
  intradayBars: { status: "MISSING", readyCount: 0, totalCount: 3, reason: "KITE_SESSION_MISSING" },
  optionChain: { status: "MISSING", reason: "KITE_SESSION_MISSING" },
  signalCycle: {
    lastCycleAt: null,
    generatedSignals: 0,
    tradeableSignals: 0,
    suppressedSignals: 0,
    status: "DATA_BLOCKED",
    reasons: ["KITE_SESSION_MISSING"],
    suppressedIndices: [],
  },
  tradeGrade: false,
  canGenerateSignals: false,
  canOpenPaperTrades: false,
};

const dataBlockedCanonicalFno: CanonicalFnoReadiness = {
  ...healthyCanonicalFno,
  dailyBars: { status: "MISSING", readyCount: 0, totalCount: 3, reason: "DAILY_HISTORY_UNAVAILABLE" },
  intradayBars: { status: "MISSING", readyCount: 0, totalCount: 3, reason: "DAILY_HISTORY_UNAVAILABLE" },
  optionChain: { status: "MISSING", reason: "DAILY_HISTORY_UNAVAILABLE" },
  signalCycle: {
    lastCycleAt: "2026-07-01T03:20:00.000Z",
    generatedSignals: 0,
    tradeableSignals: 0,
    suppressedSignals: 0,
    status: "DATA_BLOCKED",
    reasons: ["DAILY_HISTORY_UNAVAILABLE"],
    suppressedIndices: [],
  },
  tradeGrade: false,
  canGenerateSignals: false,
  canOpenPaperTrades: false,
};

const partialCanonicalFno: CanonicalFnoReadiness = {
  ...healthyCanonicalFno,
  dailyBars: { status: "PARTIAL", readyCount: 1, totalCount: 3, reason: "PARTIAL_INDEX_COVERAGE" },
  intradayBars: { status: "PARTIAL", readyCount: 1, totalCount: 3, reason: "PARTIAL_INDEX_COVERAGE" },
  signalCycle: {
    lastCycleAt: "2026-07-01T03:20:00.000Z",
    generatedSignals: 1,
    tradeableSignals: 0,
    suppressedSignals: 1,
    status: "DATA_BLOCKED",
    reasons: ["PARTIAL_INDEX_COVERAGE"],
    suppressedIndices: [],
  },
  tradeGrade: false,
  canOpenPaperTrades: false,
};

const noSetupCanonicalFno: CanonicalFnoReadiness = {
  ...healthyCanonicalFno,
  signalCycle: {
    lastCycleAt: "2026-07-01T03:20:00.000Z",
    generatedSignals: 3,
    tradeableSignals: 0,
    suppressedSignals: 3,
    status: "NO_SETUP",
    reasons: ["LOW_CONFIDENCE"],
    suppressedIndices: [],
  },
  canOpenPaperTrades: false,
};

const healthySwing: PreMarketSwing = {
  pending: 2, approvalRequired: 1, approved: 0, expired: 3,
  openedToday: 1, closedToday: 0, blockedToday: 0, notificationFailures: 0,
};
const zeroSwing: PreMarketSwing = {
  pending: 0, approvalRequired: 0, approved: 0, expired: 0,
  openedToday: 0, closedToday: 0, blockedToday: 0, notificationFailures: 0,
};

function makePreMarket(overrides: Partial<PreMarketReportData> = {}): PreMarketReportData {
  return {
    isManualTest: false,
    istDatetime: "01 Jul 2026 08:50",
    isWeekend: false,
    kite: healthyKite,
    canonicalFno: healthyCanonicalFno,
    swing: healthySwing,
    ...overrides,
  };
}

// ── Pre-market builder — healthy system ──────────────────────────────────────

describe("buildPreMarketReport — healthy system", () => {
  it("includes the header", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("PRE-MARKET STATUS");
  });

  it("does NOT include [MANUAL TEST] when isManualTest=false", () => {
    const text = buildPreMarketReport(makePreMarket({ isManualTest: false }));
    expect(text).not.toContain("[MANUAL TEST]");
  });

  it("includes [MANUAL TEST] when isManualTest=true", () => {
    const text = buildPreMarketReport(makePreMarket({ isManualTest: true }));
    expect(text).toContain("PRE-MARKET STATUS [MANUAL TEST]");
  });

  it("shows Kite session state from canonical readiness", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("Kite: ACTIVE");
    expect(text).toContain("Feed: CONNECTED");
  });

  it("shows market mode", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("Market mode: open");
  });

  it("shows F&O readiness READY", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("F&O readiness: READY");
  });

  it("shows daily/intraday bars and option chain status", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("Daily bars: 3/3");
    expect(text).toContain("Intraday bars: 3/3");
    expect(text).toContain("Option chain: READY");
  });

  it("shows signal counts", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("Signals: 5 generated | 2 tradeable | 3 suppressed");
  });

  it("shows swing staging count folding pending + approvalRequired", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("Pending 3 | Approved 0 | Expired 3");
  });

  it("shows the monitor action when readiness is READY", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("Action:");
    expect(text).toContain("- Monitor /option-chain if data ready");
  });

  it("shows broker execution disabled", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("Broker execution: DISABLED");
  });

  it("collapses SOURCE_NOT_INTEGRATED providers to one footer line", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain(
      "Not included: GIFT Nifty, live global cues, India VIX, news/events — provider not configured.",
    );
  });

  it("does not print old per-section headers", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).not.toMatch(/── .+ ──/);
  });
});

// ── Pre-market builder — Kite session missing ─────────────────────────────────

describe("buildPreMarketReport — Kite session missing (canonicalFno present)", () => {
  const data = makePreMarket({ kite: missingKite, canonicalFno: missingKiteCanonicalFno });

  it("shows Kite MISSING and Feed DISCONNECTED", () => {
    const text = buildPreMarketReport(data);
    expect(text).toContain("Kite: MISSING");
    expect(text).toContain("Feed: DISCONNECTED");
  });

  it("shows F&O readiness DATA_BLOCKED", () => {
    const text = buildPreMarketReport(data);
    expect(text).toContain("F&O readiness: DATA_BLOCKED");
  });

  it("shows the Kite-session-missing status reason", () => {
    const text = buildPreMarketReport(data);
    expect(text).toContain("Status: DATA_BLOCKED — Kite session missing");
  });

  it("shows the reconnect and diagnostics actions", () => {
    const text = buildPreMarketReport(data);
    expect(text).toContain("- Reconnect Kite if session missing/expired");
    expect(text).toContain("- Check /fno-diagnostics if data blocked");
  });

  it("does not show the monitor-only action", () => {
    const text = buildPreMarketReport(data);
    expect(text).not.toContain("- Monitor /option-chain if data ready");
  });
});

// ── Pre-market builder — data blocked while Kite session is active ────────────

describe("buildPreMarketReport — data blocked, Kite session active", () => {
  const data = makePreMarket({ canonicalFno: dataBlockedCanonicalFno });

  it("shows readiness DATA_BLOCKED with 0/3 bars", () => {
    const text = buildPreMarketReport(data);
    expect(text).toContain("F&O readiness: DATA_BLOCKED");
    expect(text).toContain("Daily bars: 0/3");
  });

  it("shows the DAILY_HISTORY_UNAVAILABLE reason, not a Kite-session reason", () => {
    const text = buildPreMarketReport(data);
    expect(text).toContain("Status: DATA_BLOCKED — DAILY_HISTORY_UNAVAILABLE");
  });

  it("does NOT show reconnect Kite when session is present but bars are missing", () => {
    const text = buildPreMarketReport(data);
    expect(text).not.toContain("- Reconnect Kite if session missing/expired");
  });

  it("shows the fno-diagnostics action", () => {
    const text = buildPreMarketReport(data);
    expect(text).toContain("- Check /fno-diagnostics if data blocked");
  });
});

// ── Pre-market builder — partial bars ─────────────────────────────────────────

describe("buildPreMarketReport — partial bars (1/3)", () => {
  const data = makePreMarket({ canonicalFno: partialCanonicalFno });

  it("shows PARTIAL readiness label overriding the machine DATA_BLOCKED status", () => {
    const text = buildPreMarketReport(data);
    expect(text).toContain("F&O readiness: PARTIAL");
    expect(text).toContain("Daily bars: 1/3");
  });

  it("shows the intraday-bars reason inline", () => {
    const text = buildPreMarketReport(data);
    expect(text).toContain("Intraday bars: 1/3 — PARTIAL_INDEX_COVERAGE");
  });

  it("does not print a Status: line for PARTIAL (not DATA_BLOCKED/NO_SETUP)", () => {
    const text = buildPreMarketReport(data);
    expect(text).not.toContain("Status: PARTIAL");
  });

  it("prints no Action section when Kite is active and readiness is merely PARTIAL", () => {
    const text = buildPreMarketReport(data);
    expect(text).not.toContain("Action:");
  });
});

// ── Pre-market builder — no setup (data ready, no confident signal) ──────────

describe("buildPreMarketReport — no setup today", () => {
  const data = makePreMarket({ canonicalFno: noSetupCanonicalFno });

  it("shows F&O readiness NO_SETUP", () => {
    const text = buildPreMarketReport(data);
    expect(text).toContain("F&O readiness: NO_SETUP");
  });

  it("shows the honest no-signal-met-threshold reason", () => {
    const text = buildPreMarketReport(data);
    expect(text).toContain("Status: NO_SETUP — data ready, no signal met the confidence threshold today");
  });

  it("does not show any action (nothing actionable when merely no setup)", () => {
    const text = buildPreMarketReport(data);
    expect(text).not.toContain("Action:");
  });
});

// ── Pre-market builder — canonicalFno gatherer itself failed ─────────────────

describe("buildPreMarketReport — canonicalFno null (gatherer failed)", () => {
  const data = makePreMarket({ canonicalFno: null });

  it("shows UNKNOWN readiness, not a fabricated status", () => {
    const text = buildPreMarketReport(data);
    expect(text).toContain("F&O readiness: UNKNOWN — canonical readiness check failed this run");
  });

  it("falls back to the raw kite fixture for Kite/Feed lines", () => {
    const text = buildPreMarketReport(data);
    expect(text).toContain("Kite: ACTIVE");
    expect(text).toContain("Feed: CONNECTED");
  });

  it("still shows a reconnect action (fail-safe when readiness is unknown)", () => {
    const text = buildPreMarketReport(data);
    expect(text).toContain("- Reconnect Kite if session missing/expired");
  });
});

// ── Pre-market builder — no swing data ───────────────────────────────────────

describe("buildPreMarketReport — swing null", () => {
  const data = makePreMarket({ swing: null });

  it("shows the unavailable-this-run swing line, not a fabricated 0", () => {
    const text = buildPreMarketReport(data);
    expect(text).toContain("Pending 0 | Approved 0 | Expired 0 (unavailable this run)");
  });
});

// ── Pre-market builder — zero swing (legitimate) ─────────────────────────────

describe("buildPreMarketReport — swing all zero (legitimate)", () => {
  const data = makePreMarket({ swing: zeroSwing });

  it("shows a genuine zero swing line without the unavailable suffix", () => {
    const text = buildPreMarketReport(data);
    expect(text).toContain("Pending 0 | Approved 0 | Expired 0");
    expect(text).not.toContain("(unavailable this run)");
  });
});

// ── Pre-market builder — weekend ──────────────────────────────────────────────

describe("buildPreMarketReport — weekend", () => {
  const data = makePreMarket({ isWeekend: true });

  it("shows weekend message", () => {
    const text = buildPreMarketReport(data);
    expect(text).toContain("Weekend — markets closed today.");
  });

  it("does not show F&O data sections on weekend", () => {
    const text = buildPreMarketReport(data);
    expect(text).not.toContain("F&O readiness:");
    expect(text).not.toContain("Kite:");
  });

  it("shows broker execution disabled on weekend too", () => {
    const text = buildPreMarketReport(data);
    expect(text).toContain("Broker execution: DISABLED");
  });
});

// ── Pre-market builder — source honesty: no Telegram secrets ─────────────────

describe("buildPreMarketReport — no secrets in output", () => {
  it("does not contain bot_token or chatid patterns", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).not.toMatch(/bot[0-9]{9,}/i);
    expect(text).not.toMatch(/TELEGRAM_BOT_TOKEN/);
    expect(text).not.toMatch(/TELEGRAM_CHAT_ID/);
    expect(text).not.toMatch(/PREPOST_TELEGRAM_BOT_TOKEN/);
    expect(text).not.toMatch(/PREPOST_TELEGRAM_CHAT_ID/);
  });
});

// ── Post-market data fixtures ─────────────────────────────────────────────────

const healthyPostFno: PostMarketFno = {
  tradesOpened: 3,
  tradesClosed: 2,
  openCount: 1,
  totalPnl: 4200,
};

const zeroTradesFno: PostMarketFno = {
  tradesOpened: 0,
  tradesClosed: 0,
  openCount: 0,
  totalPnl: 0,
};

const zeroPnlWithTradesFno: PostMarketFno = {
  tradesOpened: 2,
  tradesClosed: 2,
  openCount: 0,
  totalPnl: 0,
};

const nullPnlFno: PostMarketFno = {
  tradesOpened: 2,
  tradesClosed: 0,
  openCount: 2,
  totalPnl: null,
};

const healthyPostSwing: PostMarketSwing = {
  pending: 3, approved: 0, expired: 3,
  openedToday: 2, closedToday: 1, blockedToday: 0, equityOpenCount: 1,
};

const healthyPostIndexPerformance: PostMarketIndexPerformance = {
  rows: [
    { name: "NIFTY 50", close: 24821.4, changePct: 0.62, high: 24860.1, low: 24655.3 },
    { name: "NIFTY BANK", close: 51234.5, changePct: -0.15, high: 51500, low: 51000 },
    { name: "SENSEX", close: 81234.6, changePct: 0.41, high: 81500, low: 80900 },
  ],
  asOfIst: "15:30",
};

const healthyPostOptionChainEod: PostMarketOptionChainEod = {
  rows: [
    {
      underlying: "NIFTY",
      expiry: "2026-07-10",
      pcr: 0.92,
      maxPainStrike: 24800,
      atmStrike: 24800,
      atmStraddleTotal: 312.5,
      capturedAtIst: "15:25",
    },
  ],
};

function makePostMarket(overrides: Partial<PostMarketReportData> = {}): PostMarketReportData {
  return {
    isManualTest: false,
    istDate: "2026-07-01",
    isWeekend: false,
    canonicalFno: healthyCanonicalFno,
    fno: healthyPostFno,
    swing: healthyPostSwing,
    equityPaper: null,
    indexPerformance: null,
    optionChainEod: null,
    exitMonitorVerified: false,
    ...overrides,
  };
}

// ── Post-market builder — healthy system ─────────────────────────────────────

describe("buildPostMarketReport — healthy system", () => {
  it("includes the header", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("POST-MARKET SUMMARY");
  });

  it("does NOT include [MANUAL TEST] when false", () => {
    const text = buildPostMarketReport(makePostMarket({ isManualTest: false }));
    expect(text).not.toContain("[MANUAL TEST]");
  });

  it("includes [MANUAL TEST] when true", () => {
    const text = buildPostMarketReport(makePostMarket({ isManualTest: true }));
    expect(text).toContain("POST-MARKET SUMMARY [MANUAL TEST]");
  });

  it("shows F&O signal counts from canonical readiness", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("Signals: generated 5 | tradeable 2 | suppressed 3");
  });

  it("shows opened/closed/open trade counts", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("Paper trades: opened 3 | closed 2 | open 1");
  });

  it("shows positive P&L with rupee sign", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("Realized P&L: ₹+4,200");
  });

  it("shows exit monitor status", () => {
    const text = buildPostMarketReport(makePostMarket({ exitMonitorVerified: true }));
    expect(text).toContain("Exit monitor: DEV_VERIFIED");
  });

  it("shows exit monitor waiting message when not yet verified", () => {
    const text = buildPostMarketReport(makePostMarket({ exitMonitorVerified: false }));
    expect(text).toContain("Exit monitor: waiting for live open trade evidence");
  });

  it("shows swing pending/approved/expired counts", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("Pending 3 | Approved 0 | Expired 3");
  });

  it("shows data health trade-grade module roll-up", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("Kite: ACTIVE");
    expect(text).toContain("Trade-grade modules: 4/4");
  });

  it("shows tomorrow prep derived from canonical readiness", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("Key levels ready: Yes");
    expect(text).toContain("Option chain ready: Yes");
    expect(text).toContain("Kite reconnect required tomorrow: No");
  });

  it("shows broker execution disabled", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("Broker execution: DISABLED");
  });

  it("collapses SOURCE_NOT_INTEGRATED providers to one footer line", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain(
      "Not included: Market breadth, live news, India VIX, participant OI, global close — provider not configured.",
    );
  });
});

// ── Post-market builder — fno null (unavailable) ─────────────────────────────

describe("buildPostMarketReport — fno null", () => {
  const data = makePostMarket({ fno: null });

  it("shows Unavailable for F&O paper-trades section, not fake zeros", () => {
    const text = buildPostMarketReport(data);
    expect(text).toContain("Paper trades: Unavailable — not tracked yet");
  });

  it("does not fake trades opened as 0", () => {
    const text = buildPostMarketReport(data);
    expect(text).not.toContain("opened 0");
  });
});

// ── Post-market builder — null P&L ───────────────────────────────────────────

describe("buildPostMarketReport — null totalPnl", () => {
  const data = makePostMarket({ fno: nullPnlFno });

  it("shows P&L unavailable instead of 0", () => {
    const text = buildPostMarketReport(data);
    expect(text).toContain("Realized P&L: Unavailable");
  });

  it("does not show a fabricated ₹0", () => {
    const text = buildPostMarketReport(data);
    expect(text).not.toMatch(/Realized P&L: ₹0/);
  });
});

// ── Post-market builder — zero trades (legitimate "none today") ─────────────

describe("buildPostMarketReport — zero trades (no activity)", () => {
  const data = makePostMarket({ fno: zeroTradesFno });

  it("shows 'none today' instead of a fabricated Opened: 0 / Closed: 0", () => {
    const text = buildPostMarketReport(data);
    expect(text).toContain("Paper trades: none today");
  });

  it("does not print a Realized P&L line when there was no activity", () => {
    const text = buildPostMarketReport(data);
    expect(text).not.toContain("Realized P&L");
  });
});

// ── Post-market builder — zero P&L with real trades (legitimate) ────────────

describe("buildPostMarketReport — zero P&L with trades (legitimate)", () => {
  const data = makePostMarket({ fno: zeroPnlWithTradesFno });

  it("shows ₹+0 when P&L is genuinely 0 with real trade activity", () => {
    const text = buildPostMarketReport(data);
    expect(text).toContain("Realized P&L: ₹+0");
  });
});

// ── Post-market builder — negative P&L formatting ────────────────────────────

describe("buildPostMarketReport — negative P&L", () => {
  it("shows negative P&L with minus sign", () => {
    const data = makePostMarket({ fno: { ...healthyPostFno, totalPnl: -1500 } });
    const text = buildPostMarketReport(data);
    expect(text).toContain("Realized P&L: ₹-1,500");
  });
});

// ── Post-market builder — swing null ─────────────────────────────────────────

describe("buildPostMarketReport — swing null", () => {
  const data = makePostMarket({ swing: null });

  it("shows the unavailable-this-run swing line, not a fabricated 0", () => {
    const text = buildPostMarketReport(data);
    expect(text).toContain("Pending 0 | Approved 0 | Expired 0 (unavailable this run)");
  });
});

// ── Post-market builder — canonicalFno null (gatherer failed) ───────────────

describe("buildPostMarketReport — canonicalFno null (gatherer failed)", () => {
  const data = makePostMarket({ canonicalFno: null });

  it("shows Unavailable for F&O signals section", () => {
    const text = buildPostMarketReport(data);
    expect(text).toContain("Signals: Unavailable — canonical readiness check failed this run");
  });

  it("shows Unavailable for data health section", () => {
    const text = buildPostMarketReport(data);
    expect(text).toContain("Unavailable — canonical readiness check failed this run");
  });
});

// ── Post-market builder — index performance ──────────────────────────────────

describe("buildPostMarketReport — index performance", () => {
  it("shows real index performance numbers when Kite data is present", () => {
    const text = buildPostMarketReport(makePostMarket({ indexPerformance: healthyPostIndexPerformance }));
    expect(text).toContain("NIFTY 50: 24,821.4 (+0.62%) H 24,860.1 L 24,655.3");
    expect(text).toContain("NIFTY BANK: 51,234.5 (-0.15%)");
    expect(text).toContain("SENSEX: 81,234.6 (+0.41%)");
    expect(text).toContain("(Kite, as of 15:30 IST)");
  });

  it("shows index performance as unavailable when Kite session is not active", () => {
    const text = buildPostMarketReport(makePostMarket({ indexPerformance: null }));
    expect(text).toContain("Unavailable — Kite session not active");
  });
});

// ── Post-market builder — option chain EOD ───────────────────────────────────

describe("buildPostMarketReport — option chain EOD", () => {
  it("shows real option chain EOD numbers when a snapshot was captured today", () => {
    const text = buildPostMarketReport(makePostMarket({ optionChainEod: healthyPostOptionChainEod }));
    expect(text).toContain("NIFTY: PCR 0.92 | Max Pain 24,800 | ATM 24,800 straddle ₹312.5");
  });

  it("shows option chain EOD as unavailable when no snapshot was captured today", () => {
    const text = buildPostMarketReport(makePostMarket({ optionChainEod: null }));
    expect(text).toContain("Unavailable — no option-chain snapshots captured today");
  });

  it("never fabricates a zero for a null PCR/max pain/ATM field", () => {
    const text = buildPostMarketReport(
      makePostMarket({
        optionChainEod: {
          rows: [
            {
              underlying: "BANKNIFTY",
              expiry: "2026-07-10",
              pcr: null,
              maxPainStrike: null,
              atmStrike: null,
              atmStraddleTotal: null,
              capturedAtIst: "15:25",
            },
          ],
        },
      }),
    );
    expect(text).toContain("BANKNIFTY: PCR — | Max Pain — | ATM —");
    expect(text).not.toContain("PCR 0");
  });
});

// ── Post-market builder — weekend ────────────────────────────────────────────

describe("buildPostMarketReport — weekend", () => {
  const data = makePostMarket({ isWeekend: true });

  it("shows weekend message", () => {
    const text = buildPostMarketReport(data);
    expect(text).toContain("Weekend — no market session today.");
  });

  it("does not show trade sections on weekend", () => {
    const text = buildPostMarketReport(data);
    expect(text).not.toContain("F&O:");
    expect(text).not.toContain("Option chain:");
  });

  it("shows broker execution disabled on weekend too", () => {
    const text = buildPostMarketReport(data);
    expect(text).toContain("Broker execution: DISABLED");
  });
});

// ── Post-market builder — no secrets ─────────────────────────────────────────

describe("buildPostMarketReport — no secrets in output", () => {
  it("does not contain Telegram token patterns", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).not.toMatch(/bot[0-9]{9,}/i);
    expect(text).not.toMatch(/TELEGRAM_BOT_TOKEN/);
    expect(text).not.toMatch(/TELEGRAM_CHAT_ID/);
    expect(text).not.toMatch(/PREPOST_TELEGRAM_BOT_TOKEN/);
    expect(text).not.toMatch(/PREPOST_TELEGRAM_CHAT_ID/);
  });
});

// ── Post-market builder — data health module roll-up ─────────────────────────

describe("buildPostMarketReport — data health blocked modules", () => {
  it("lists blocked modules by name when some are not ready", () => {
    const text = buildPostMarketReport(makePostMarket({ canonicalFno: dataBlockedCanonicalFno }));
    expect(text).toContain("Trade-grade modules: 1/4");
    expect(text).toContain("Blocked: Daily bars, Intraday bars, Option chain");
  });
});

// ── Post-market builder — datetimeStr display ────────────────────────────────

describe("buildPostMarketReport — datetimeStr display", () => {
  it("uses datetimeStr for display when provided", () => {
    const data = makePostMarket({ datetimeStr: "01 Jul 2026 15:45" });
    const text = buildPostMarketReport(data);
    expect(text).toContain("Date: 01 Jul 2026 15:45 IST");
  });

  it("falls back to ISO istDate when datetimeStr is absent", () => {
    const data = makePostMarket();
    const text = buildPostMarketReport(data);
    expect(text).toContain("Date: 2026-07-01");
  });

  it("istDate is always ISO YYYY-MM-DD regardless of display format", () => {
    const data = makePostMarket({ datetimeStr: "01 Jul 2026 15:45" });
    expect(data.istDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ── DAILY_ANALYSIS_COVERAGE data coverage matrix ──────────────────────────────

describe("DAILY_ANALYSIS_COVERAGE — data coverage matrix", () => {
  it("contains required pre-market section keys", () => {
    const required = [
      "overnightGlobalCues", "giftNifty", "fiiDiiCash", "participantOi",
      "indiaVix", "keyLevelsOhlc", "optionChainAnalytics", "expectedRange",
      "newsEvents", "expiryRollover", "biasTradePlan",
    ];
    for (const key of required) {
      expect(DAILY_ANALYSIS_COVERAGE, `missing key: ${key}`).toHaveProperty(key);
    }
  });

  it("contains required post-market section keys", () => {
    const required = [
      "indexPerformance", "marketBreadth", "optionChainEod", "levelValidation",
      "sectorMoves", "newsRecap", "tradeJournal", "globalStatusCheck", "tomorrowSetup",
    ];
    for (const key of required) {
      expect(DAILY_ANALYSIS_COVERAGE, `missing key: ${key}`).toHaveProperty(key);
    }
  });

  it("all entries have status, source (possibly null), and note fields", () => {
    for (const [key, entry] of Object.entries(DAILY_ANALYSIS_COVERAGE)) {
      expect(typeof entry.status, `${key}: status should be string`).toBe("string");
      expect(typeof entry.note, `${key}: note should be string`).toBe("string");
      expect(
        entry.source === null || typeof entry.source === "string",
        `${key}: source should be string or null`,
      ).toBe(true);
    }
  });

  it("SOURCE_NOT_INTEGRATED entries have null source (no fake providers)", () => {
    for (const [key, entry] of Object.entries(DAILY_ANALYSIS_COVERAGE)) {
      if (entry.status === "SOURCE_NOT_INTEGRATED") {
        expect(entry.source, `${key}: SOURCE_NOT_INTEGRATED should have null source`).toBeNull();
      }
    }
  });

  it("no entry note contains a secret pattern", () => {
    for (const [key, entry] of Object.entries(DAILY_ANALYSIS_COVERAGE)) {
      expect(entry.note, `${key}: note contains token pattern`).not.toMatch(/bot[0-9]{9,}/i);
      expect(entry.note, `${key}: note exposes env var`).not.toMatch(/TELEGRAM_BOT_TOKEN/);
    }
  });
});

// ── istDate ISO format regression ──────────────────────────────────────────────

describe("istDate format regression — must be ISO YYYY-MM-DD", () => {
  it("PostMarketReportData.istDate fixture is ISO format", () => {
    const data = makePostMarket();
    expect(data.istDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("istDate '2026-07-01' passes ISO regex", () => {
    expect("2026-07-01").toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("IST offset string '01 Jul 2026' does NOT pass ISO regex (guards against off-shift bug)", () => {
    expect("01 Jul 2026").not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ── Weekday regression — 2026-07-13 is MONDAY, not Sunday ──────────────────────
// An earlier evidence summary incorrectly stated "2026-07-13 is Sunday". These
// tests anchor the correct UTC→IST day-of-week arithmetic that the scheduler
// uses (UTC + 5.5h, then getUTCDay()).  They are pure date math — no Kite, no DB.
//
// IST = UTC + 5h30m; getUTCDay() on the shifted Date gives IST day-of-week.
// 2026-07-13 04:43 UTC → +5.5h → 2026-07-13 10:13 IST → getUTCDay()=1 (Monday).

describe("weekday regression — 2026-07-13 is Monday per IST offset arithmetic", () => {
  function istDayOfWeek(utcMs: number): number {
    return new Date(utcMs + 5.5 * 60 * 60 * 1000).getUTCDay();
  }

  it("2026-07-13T04:43:00Z → IST day-of-week = 1 (Monday)", () => {
    const utc = Date.UTC(2026, 6, 13, 4, 43, 0); // month is 0-indexed
    expect(istDayOfWeek(utc)).toBe(1);
  });

  it("2026-07-14T03:20:00Z → IST day-of-week = 2 (Tuesday)", () => {
    const utc = Date.UTC(2026, 6, 14, 3, 20, 0);
    expect(istDayOfWeek(utc)).toBe(2);
  });

  it("2026-07-12T04:43:00Z → IST day-of-week = 0 (Sunday)", () => {
    const utc = Date.UTC(2026, 6, 12, 4, 43, 0);
    expect(istDayOfWeek(utc)).toBe(0);
  });

  it("2026-07-11T04:43:00Z → IST day-of-week = 6 (Saturday)", () => {
    const utc = Date.UTC(2026, 6, 11, 4, 43, 0);
    expect(istDayOfWeek(utc)).toBe(6);
  });

  it("pre-market scheduler window: 08:50 IST = 03:20 UTC on same day", () => {
    // 08:50 IST − 5:30 = 03:20 UTC
    const preMktIst = Date.UTC(2026, 6, 13, 8, 50, 0) - 5.5 * 60 * 60 * 1000;
    const utcHH = new Date(preMktIst).getUTCHours();
    const utcMM = new Date(preMktIst).getUTCMinutes();
    expect(utcHH).toBe(3);
    expect(utcMM).toBe(20);
  });

  it("scheduler weekend gate: dayOfWeek===0||6 is false for 2026-07-13 (Monday)", () => {
    const utc = Date.UTC(2026, 6, 13, 4, 43, 0);
    const dow = istDayOfWeek(utc);
    expect(dow === 0 || dow === 6).toBe(false);
  });
});
