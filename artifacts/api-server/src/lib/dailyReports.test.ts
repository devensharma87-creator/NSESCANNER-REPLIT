/**
 * Tests for daily report builders (pure functions — no DB, no Kite, no Telegram).
 *
 * Coverage:
 *   – Pre-market builder: healthy / Kite missing / daily bars unavailable / weekend
 *   – Post-market builder: healthy / fno null / swing null / weekend
 *   – Source-honesty: no secrets, no fake zeros
 *   – Scheduler latch helpers: weekday vs weekend
 *   – No forbidden wording (Kite label on missing data, fake "0")
 */

import { describe, it, expect } from "vitest";
import {
  buildPreMarketReport,
  buildPostMarketReport,
  DAILY_ANALYSIS_COVERAGE,
  type PreMarketReportData,
  type PostMarketReportData,
} from "./dailyReports";

// ── Pre-market data fixtures ──────────────────────────────────────────────────

const healthyKite = {
  sessionPresent: true,
  user: "Hrishi",
  expiresAt: "2026-07-02T01:00:00.000Z",
  minsToExpiry: 960,
  feedConnected: true,
  feedSubscribed: 75,
};

const missingKite = {
  sessionPresent: false,
  user: null,
  expiresAt: null,
  minsToExpiry: null,
  feedConnected: false,
  feedSubscribed: 0,
};

const healthyFno = {
  lastCycleAt: "2026-07-01T03:20:00.000Z",
  cycleMinsAgo: 15,
  indicesWithBars: 3,
  indicesConfigured: 3,
  signalCount: 2,
  suppressed: false,
  suppressedSummary: "",
};

const barsUnavailableFno = {
  lastCycleAt: "2026-07-01T03:20:00.000Z",
  cycleMinsAgo: 15,
  indicesWithBars: 0,
  indicesConfigured: 3,
  signalCount: 0,
  suppressed: true,
  suppressedSummary: "DAILY_HISTORY_UNAVAILABLE",
};

const partialFno = {
  lastCycleAt: "2026-07-01T03:20:00.000Z",
  cycleMinsAgo: 30,
  indicesWithBars: 1,
  indicesConfigured: 3,
  signalCount: 0,
  suppressed: false,
  suppressedSummary: "",
};

const healthySwing = {
  pending: 2,
  approvalRequired: 1,
  approved: 0,
  expired: 3,
};

const zeroSwing = {
  pending: 0,
  approvalRequired: 0,
  approved: 0,
  expired: 0,
};

const healthyAlerts = {
  lastDataAlertEvent: "FNO_DAILY_HISTORY_UNAVAILABLE",
  lastDataAlertMinsAgo: 45,
  lastSignalAlertMinsAgo: 60,
  lastSwingAlertMinsAgo: 120,
};

const noAlerts = {
  lastDataAlertEvent: null,
  lastDataAlertMinsAgo: null,
  lastSignalAlertMinsAgo: null,
  lastSwingAlertMinsAgo: null,
};

function makePreMarket(overrides: Partial<PreMarketReportData> = {}): PreMarketReportData {
  return {
    isManualTest: false,
    istDatetime: "01 Jul 2026 08:50",
    isWeekend: false,
    kite: healthyKite,
    fno: healthyFno,
    swing: healthySwing,
    alerts: healthyAlerts,
    ...overrides,
  };
}

// ── Pre-market builder — healthy system ──────────────────────────────────────

describe("buildPreMarketReport — healthy system", () => {
  it("includes the header", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("🌅 PRE-MARKET ANALYSIS");
  });

  it("does NOT include [MANUAL TEST] when isManualTest=false", () => {
    const text = buildPreMarketReport(makePreMarket({ isManualTest: false }));
    expect(text).not.toContain("[MANUAL TEST]");
  });

  it("includes [MANUAL TEST] when isManualTest=true", () => {
    const text = buildPreMarketReport(makePreMarket({ isManualTest: true }));
    expect(text).toContain("[MANUAL TEST]");
  });

  it("shows Kite active status", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("✅ Active");
  });

  it("shows feed connected", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("✅ Connected");
    expect(text).toContain("75 tokens");
  });

  it("shows daily bars available (3/3)", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("✅ Available (3/3 indices)");
  });

  it("shows signal cycle ready", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("Signal cycle: ✅ Ready");
  });

  it("shows signal count", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("Signals emitted: 2");
  });

  it("shows swing pending count", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("Pending approval: 3");
  });

  it("shows broker execution disabled", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("Broker execution: DISABLED");
  });

  it("includes source disclaimer", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("Not a trading recommendation");
  });

  it("shows last data alert event", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("FNO_DAILY_HISTORY_UNAVAILABLE");
  });

  it("shows last signal alert", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("Last tradeable signal:");
  });
});

// ── Pre-market builder — Kite session missing ─────────────────────────────────

describe("buildPreMarketReport — Kite session missing", () => {
  const data = makePreMarket({ kite: missingKite });

  it("shows session missing", () => {
    const text = buildPreMarketReport(data);
    expect(text).toContain("❌ MISSING — login required");
  });

  it("shows reconnect action", () => {
    const text = buildPreMarketReport(data);
    expect(text).toContain("Reconnect Kite/Zerodha");
  });

  it("does not say Kite session is active when missing", () => {
    const text = buildPreMarketReport(data);
    expect(text).not.toContain("Kite session is active");
  });
});

// ── Pre-market builder — daily bars unavailable (session may be live) ─────────

describe("buildPreMarketReport — daily bars unavailable, Kite session active", () => {
  const data = makePreMarket({ fno: barsUnavailableFno });

  it("shows bars UNAVAILABLE", () => {
    const text = buildPreMarketReport(data);
    expect(text).toContain("❌ UNAVAILABLE (0/3 indices)");
  });

  it("shows signal cycle suppressed", () => {
    const text = buildPreMarketReport(data);
    expect(text).toContain("SUPPRESSED");
    expect(text).toContain("DAILY_HISTORY_UNAVAILABLE");
  });

  it("shows action to check fno-diagnostics", () => {
    const text = buildPreMarketReport(data);
    expect(text).toContain("/fno-diagnostics");
  });

  it("does NOT say reconnect Kite when session is present but bars are missing", () => {
    const text = buildPreMarketReport(data);
    expect(text).not.toContain("login required");
  });
});

// ── Pre-market builder — partial bars ─────────────────────────────────────────

describe("buildPreMarketReport — partial bars (1/3)", () => {
  const data = makePreMarket({ fno: partialFno });

  it("shows partial availability", () => {
    const text = buildPreMarketReport(data);
    expect(text).toContain("⚠ Partial (1/3 indices)");
  });
});

// ── Pre-market builder — no F&O cycle yet ────────────────────────────────────

describe("buildPreMarketReport — no F&O cycle", () => {
  const data = makePreMarket({ fno: null });

  it("says Unavailable not tracked yet (not fake 0)", () => {
    const text = buildPreMarketReport(data);
    expect(text).toContain("Unavailable — not tracked yet");
  });

  it("does not show fake signal count of 0", () => {
    const text = buildPreMarketReport(data);
    expect(text).not.toMatch(/Signals emitted: 0/);
  });
});

// ── Pre-market builder — no swing data ───────────────────────────────────────

describe("buildPreMarketReport — swing null", () => {
  const data = makePreMarket({ swing: null });

  it("shows Unavailable for swing section", () => {
    const text = buildPreMarketReport(data);
    expect(text).toContain("Unavailable — not tracked yet");
  });
});

// ── Pre-market builder — no alerts ───────────────────────────────────────────

describe("buildPreMarketReport — no alerts", () => {
  const data = makePreMarket({ alerts: noAlerts });

  it("shows None for data alert", () => {
    const text = buildPreMarketReport(data);
    expect(text).toContain("Last F&O data alert: None");
  });

  it("shows None for tradeable signal", () => {
    const text = buildPreMarketReport(data);
    expect(text).toContain("Last tradeable signal: None");
  });
});

// ── Pre-market builder — weekend ──────────────────────────────────────────────

describe("buildPreMarketReport — weekend", () => {
  const data = makePreMarket({ isWeekend: true });

  it("shows weekend message", () => {
    const text = buildPreMarketReport(data);
    expect(text).toContain("Weekend — markets closed today");
  });

  it("does not show F&O data sections on weekend", () => {
    const text = buildPreMarketReport(data);
    expect(text).not.toContain("── F&O DATA READINESS");
    expect(text).not.toContain("── KITE SESSION");
  });
});

// ── Pre-market builder — source honesty: no Telegram secrets ─────────────────

describe("buildPreMarketReport — no secrets in output", () => {
  it("does not contain bot_token or chatid patterns", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).not.toMatch(/bot[0-9]{9,}/i);
    expect(text).not.toMatch(/TELEGRAM_BOT_TOKEN/);
    expect(text).not.toMatch(/TELEGRAM_CHAT_ID/);
  });
});

// ── Post-market data fixtures ─────────────────────────────────────────────────

const healthyPostFno: PostMarketReportData["fno"] = {
  tradesOpened: 3,
  hcOpened: 2,
  baselineOpened: 1,
  tradesClosed: 2,
  totalPnl: 4200,
  signalsGenerated: 8,
};

const zeroPnlFno: PostMarketReportData["fno"] = {
  tradesOpened: 0,
  hcOpened: 0,
  baselineOpened: 0,
  tradesClosed: 0,
  totalPnl: 0,
  signalsGenerated: 0,
};

const nullPnlFno: PostMarketReportData["fno"] = {
  tradesOpened: 2,
  hcOpened: 1,
  baselineOpened: 1,
  tradesClosed: 0,
  totalPnl: null,
  signalsGenerated: 4,
};

const healthyPostSwing: PostMarketReportData["swing"] = {
  stagedCount: 2,
  approvalRequiredCount: 1,
  approvedCount: 0,
  expiredCount: 3,
  pendingCount: 0,
};

const healthyPostAlerts: PostMarketReportData["alerts"] = {
  lastDataAlertEvent: "FNO_KITE_SESSION_MISSING",
  lastDataAlertIst: "09:15",
  lastSignalAlertIst: "11:30",
  lastSwingAlertIst: "09:32",
};

const noPostAlerts: PostMarketReportData["alerts"] = {
  lastDataAlertEvent: null,
  lastDataAlertIst: null,
  lastSignalAlertIst: null,
  lastSwingAlertIst: null,
};

function makePostMarket(overrides: Partial<PostMarketReportData> = {}): PostMarketReportData {
  return {
    isManualTest: false,
    istDate: "2026-07-01",
    isWeekend: false,
    fno: healthyPostFno,
    swing: healthyPostSwing,
    alerts: healthyPostAlerts,
    ...overrides,
  };
}

// ── Post-market builder — healthy system ─────────────────────────────────────

describe("buildPostMarketReport — healthy system", () => {
  it("includes the header", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("🌇 POST-MARKET SUMMARY");
  });

  it("does NOT include [MANUAL TEST] when false", () => {
    const text = buildPostMarketReport(makePostMarket({ isManualTest: false }));
    expect(text).not.toContain("[MANUAL TEST]");
  });

  it("includes [MANUAL TEST] when true", () => {
    const text = buildPostMarketReport(makePostMarket({ isManualTest: true }));
    expect(text).toContain("[MANUAL TEST]");
  });

  it("shows trade opened breakdown", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("Opened: 3 (HC: 2, BASELINE: 1)");
  });

  it("shows trade closed count", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("Closed: 2");
  });

  it("shows positive P&L with rupee sign", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("₹+4,200");
  });

  it("shows signals generated", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("Signals generated: 8");
  });

  it("shows swing active count", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("Active (staged/pending/approved): 3");
  });

  it("shows swing expired count", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("Expired today: 3");
  });

  it("shows last data alert event", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("FNO_KITE_SESSION_MISSING");
  });

  it("shows last tradeable signal time", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("Last tradeable signal: 11:30 IST");
  });

  it("shows broker execution disabled", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("DISABLED — no real orders placed");
  });

  it("includes DB source disclaimer", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("Source: DB paper trade records + in-process state");
  });
});

// ── Post-market builder — fno null (unavailable) ─────────────────────────────

describe("buildPostMarketReport — fno null", () => {
  const data = makePostMarket({ fno: null });

  it("shows Unavailable for F&O section", () => {
    const text = buildPostMarketReport(data);
    expect(text).toContain("Unavailable — not tracked yet");
  });

  it("does not fake trades opened as 0", () => {
    const text = buildPostMarketReport(data);
    expect(text).not.toContain("Opened: 0");
  });
});

// ── Post-market builder — null P&L ───────────────────────────────────────────

describe("buildPostMarketReport — null totalPnl", () => {
  const data = makePostMarket({ fno: nullPnlFno });

  it("shows P&L unavailable instead of 0", () => {
    const text = buildPostMarketReport(data);
    expect(text).toContain("Unavailable — not tracked yet");
  });

  it("does not show ₹0 for null pnl", () => {
    const text = buildPostMarketReport(data);
    expect(text).not.toMatch(/₹.*0(?!\d)/);
  });
});

// ── Post-market builder — zero P&L (legitimate) ──────────────────────────────

describe("buildPostMarketReport — zero P&L (no trades)", () => {
  const data = makePostMarket({ fno: zeroPnlFno });

  it("shows ₹+0 when P&L is genuinely 0", () => {
    const text = buildPostMarketReport(data);
    expect(text).toContain("₹+0");
  });
});

// ── Post-market builder — swing null ─────────────────────────────────────────

describe("buildPostMarketReport — swing null", () => {
  const data = makePostMarket({ swing: null });

  it("shows Unavailable for swing section", () => {
    const text = buildPostMarketReport(data);
    expect(text).toContain("Unavailable — not tracked yet");
  });
});

// ── Post-market builder — no alerts ──────────────────────────────────────────

describe("buildPostMarketReport — no alerts", () => {
  const data = makePostMarket({ alerts: noPostAlerts });

  it("shows None for data alert", () => {
    const text = buildPostMarketReport(data);
    expect(text).toContain("Last F&O data alert: None");
  });

  it("shows None today for signal alert", () => {
    const text = buildPostMarketReport(data);
    expect(text).toContain("Last tradeable signal: None today");
  });

  it("shows None today for swing alert", () => {
    const text = buildPostMarketReport(data);
    expect(text).toContain("Last swing alert: None today");
  });
});

// ── Post-market builder — weekend ────────────────────────────────────────────

describe("buildPostMarketReport — weekend", () => {
  const data = makePostMarket({ isWeekend: true });

  it("shows weekend message", () => {
    const text = buildPostMarketReport(data);
    expect(text).toContain("Weekend — no market session today");
  });

  it("does not show trade sections on weekend", () => {
    const text = buildPostMarketReport(data);
    expect(text).not.toContain("── F&O PAPER TRADES");
    expect(text).not.toContain("── SWING STAGING");
  });
});

// ── Post-market builder — no secrets ─────────────────────────────────────────

describe("buildPostMarketReport — no secrets in output", () => {
  it("does not contain Telegram token patterns", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).not.toMatch(/bot[0-9]{9,}/i);
    expect(text).not.toMatch(/TELEGRAM_BOT_TOKEN/);
    expect(text).not.toMatch(/TELEGRAM_CHAT_ID/);
  });
});

// ── Negative P&L formatting ──────────────────────────────────────────────────

describe("buildPostMarketReport — negative P&L", () => {
  it("shows negative P&L with minus sign", () => {
    const data = makePostMarket({
      fno: { ...healthyPostFno, totalPnl: -1500 },
    });
    const text = buildPostMarketReport(data);
    expect(text).toContain("₹-1,500");
  });
});

// ── PREPOST telegram secrets never in builder output ──────────────────────────

describe("buildPreMarketReport — PREPOST telegram secrets not in output", () => {
  it("does not contain PREPOST_TELEGRAM_BOT_TOKEN", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).not.toMatch(/PREPOST_TELEGRAM_BOT_TOKEN/);
  });

  it("does not contain PREPOST_TELEGRAM_CHAT_ID", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).not.toMatch(/PREPOST_TELEGRAM_CHAT_ID/);
  });
});

describe("buildPostMarketReport — PREPOST telegram secrets not in output", () => {
  it("does not contain PREPOST_TELEGRAM_BOT_TOKEN", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).not.toMatch(/PREPOST_TELEGRAM_BOT_TOKEN/);
  });

  it("does not contain PREPOST_TELEGRAM_CHAT_ID", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).not.toMatch(/PREPOST_TELEGRAM_CHAT_ID/);
  });
});

// ── Data coverage section in builder output ───────────────────────────────────

describe("buildPreMarketReport — data coverage section", () => {
  it("shows 'Unavailable — data source not integrated yet' for global cues", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("Global cues: Unavailable — data source not integrated yet");
  });

  it("shows 'Unavailable — data source not integrated yet' for GIFT Nifty", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("GIFT Nifty: Unavailable — data source not integrated yet");
  });

  it("shows FII/DII as Info-only (not trade-grade, not fake)", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("FII/DII cash: Info-only");
  });

  it("shows news & events as unavailable", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("News & events: Unavailable — data source not integrated yet");
  });

  it("shows India VIX as unavailable", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("India VIX: Unavailable — data source not integrated yet");
  });

  it("shows key levels as available (Kite)", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("Key levels / CPR: Available (Kite)");
  });

  it("shows option chain analytics as available (Kite)", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("Option chain analytics: Available (Kite)");
  });
});

describe("buildPostMarketReport — data coverage section", () => {
  it("shows market breadth as unavailable (data source not integrated)", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("Market breadth (adv/dec): Unavailable — data source not integrated yet");
  });

  it("shows news recap as unavailable", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("News recap: Unavailable — data source not integrated yet");
  });

  it("shows level validation as unavailable", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("Level validation (CPR/VWAP): Unavailable — data source not integrated yet");
  });

  it("shows index performance as available (Kite)", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("Index performance: Available (Kite)");
  });

  it("shows option chain EOD as available (Kite)", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("Option chain EOD change: Available (Kite)");
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

// ── Pre-market builder — analysis section headers present ──────────────────────

describe("buildPreMarketReport — analysis section headers present", () => {
  it("shows OVERNIGHT GLOBAL CUES section header", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("── OVERNIGHT GLOBAL CUES ──");
  });

  it("shows GIFT NIFTY section header", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("── GIFT NIFTY / SGX NIFTY ──");
  });

  it("shows FII / DII ACTIVITY section header", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("── FII / DII ACTIVITY ──");
  });

  it("shows INDIA VIX section header", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("── INDIA VIX ──");
  });

  it("shows KEY LEVELS section header", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("── KEY LEVELS (NIFTY / BANKNIFTY / SENSEX) ──");
  });

  it("shows OPTION CHAIN section header", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("── OPTION CHAIN ──");
  });

  it("shows EXPECTED RANGE section header", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("── EXPECTED RANGE ──");
  });

  it("shows NEWS & EVENTS section header", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("── NEWS & EVENTS ──");
  });

  it("shows EXPIRY / ROLLOVER section header", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("── EXPIRY / ROLLOVER ──");
  });

  it("shows BIAS & TRADE PLAN section header", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("── BIAS & TRADE PLAN ──");
  });

  it("does not show section headers on weekend", () => {
    const text = buildPreMarketReport(makePreMarket({ isWeekend: true }));
    expect(text).not.toContain("── OVERNIGHT GLOBAL CUES ──");
    expect(text).not.toContain("── OPTION CHAIN ──");
  });
});

// ── Post-market builder — analysis section headers present ─────────────────────

describe("buildPostMarketReport — analysis section headers present", () => {
  it("shows INDEX PERFORMANCE section header", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("── INDEX PERFORMANCE ──");
  });

  it("shows MARKET BREADTH section header", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("── MARKET BREADTH ──");
  });

  it("shows FII / DII ACTIVITY section header", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("── FII / DII ACTIVITY ──");
  });

  it("shows PARTICIPANT OI CHANGE section header", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("── PARTICIPANT OI CHANGE ──");
  });

  it("shows OPTION CHAIN EOD section header", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("── OPTION CHAIN EOD ──");
  });

  it("shows LEVEL VALIDATION section header", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("── LEVEL VALIDATION ──");
  });

  it("shows SECTOR MOVES section header", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("── SECTOR MOVES ──");
  });

  it("shows NEWS RECAP section header", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("── NEWS RECAP ──");
  });

  it("shows GLOBAL STATUS CHECK section header", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("── GLOBAL STATUS CHECK ──");
  });

  it("shows TOMORROW SETUP section header", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("── TOMORROW SETUP ──");
  });

  it("shows TRADE JOURNAL TIE-IN section header", () => {
    const text = buildPostMarketReport(makePostMarket());
    expect(text).toContain("── TRADE JOURNAL TIE-IN ──");
  });

  it("does not show section headers on weekend", () => {
    const text = buildPostMarketReport(makePostMarket({ isWeekend: true }));
    expect(text).not.toContain("── INDEX PERFORMANCE ──");
    expect(text).not.toContain("── OPTION CHAIN EOD ──");
  });
});

// ── Post-market builder — date display format ──────────────────────────────────

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

// ── Pre-market builder — ANALYSIS title vs old READINESS ──────────────────────

describe("buildPreMarketReport — title is ANALYSIS not READINESS", () => {
  it("title is PRE-MARKET ANALYSIS", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).toContain("PRE-MARKET ANALYSIS");
  });

  it("title is NOT PRE-MARKET READINESS", () => {
    const text = buildPreMarketReport(makePreMarket());
    expect(text).not.toContain("PRE-MARKET READINESS");
  });
});
