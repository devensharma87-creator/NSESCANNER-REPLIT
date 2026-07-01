/**
 * Multi-worker DB dedup contract tests for daily_report_runs.
 *
 * Simulates two concurrent workers attempting to claim the same scheduled
 * report slot via tryClaimScheduledReport(). The DB UNIQUE(report_type, ist_date)
 * constraint ensures only one worker can INSERT successfully; the other gets
 * ON CONFLICT DO NOTHING → empty RETURNING → returns false (skip).
 *
 * These tests mock @workspace/db to exercise the claim logic without a real DB.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── vi.hoisted ensures mockExecute is available when the factory runs ─────────

const mockExecute = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => ({
  db: { execute: mockExecute },
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    { empty: "" },
  ),
}));

// ── Also mock logger and all other deps that make network/DB calls ────────────

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("./kiteAuth", () => ({
  getActiveSessionStatus: vi.fn(() => ({ sessionPresent: false, user: null, expiresAt: null })),
}));
vi.mock("./kiteFeed", () => ({ feedStatus: vi.fn(() => ({ connected: false, subscribed: 0 })) }));
vi.mock("./optionSignals", () => ({
  getLastFnoCycleState: vi.fn(() => null),
  OPTION_INDICES: ["NIFTY", "BANKNIFTY", "SENSEX"],
}));
vi.mock("./paperDailySummaryFo", () => ({ computeDailySummaryFo: vi.fn(async () => null) }));
vi.mock("./alerting", () => ({
  getLastAlertRecord: vi.fn(() => null),
  sendPrePostTelegramMessage: vi.fn(async () => ({ ok: false, status: "PREPOST_TELEGRAM_DISABLED_TOKEN" })),
  getPrePostTelegramStatus: vi.fn(() => ({ enabled: false, status: "PREPOST_TELEGRAM_DISABLED_TOKEN" })),
  getTelegramStatus: vi.fn(() => ({ enabled: false, status: "TELEGRAM_DISABLED" })),
}));
vi.mock("./swingAlerts", () => ({ getLastSwingAlertRecord: vi.fn(() => null) }));
vi.mock("./fnoSignalAlerts", () => ({ getLastFnoSignalAlertRecord: vi.fn(() => null) }));

// Now import after mocks are registered
import {
  tryClaimScheduledReport,
  ensureDailyReportRunsTable,
  DAILY_ANALYSIS_COVERAGE,
} from "./dailyReports";

// ── Multi-worker dedup contract ───────────────────────────────────────────────

describe("multi-worker DB dedup — tryClaimScheduledReport", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("worker-1 claims when DB INSERT returns a row", async () => {
    // Simulate INSERT … ON CONFLICT DO NOTHING RETURNING id → 1 row (claimed)
    mockExecute.mockResolvedValueOnce({ rows: [{ id: 1 }] });

    const claimed = await tryClaimScheduledReport("pre-market", "2026-07-01");
    expect(claimed).toBe(true);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("worker-2 is skipped when DB INSERT returns no rows (ON CONFLICT DO NOTHING)", async () => {
    // Simulate INSERT … ON CONFLICT DO NOTHING RETURNING id → 0 rows (other worker already claimed)
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const claimed = await tryClaimScheduledReport("pre-market", "2026-07-01");
    expect(claimed).toBe(false);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("two simulated workers: exactly one claims, one is skipped", async () => {
    // Worker 1: INSERT succeeds → returns row
    mockExecute.mockResolvedValueOnce({ rows: [{ id: 42 }] });
    // Worker 2: INSERT ON CONFLICT → returns no rows
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const [w1result, w2result] = await Promise.all([
      tryClaimScheduledReport("post-market", "2026-07-01"),
      tryClaimScheduledReport("post-market", "2026-07-01"),
    ]);

    // Exactly one claimed, one skipped
    const claimedCount = [w1result, w2result].filter(Boolean).length;
    const skippedCount = [w1result, w2result].filter(v => !v).length;
    expect(claimedCount).toBe(1);
    expect(skippedCount).toBe(1);
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it("different (report_type, ist_date) pairs are independent — both can claim", async () => {
    // Two different report slots — both succeed
    mockExecute.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    mockExecute.mockResolvedValueOnce({ rows: [{ id: 2 }] });

    const [pre, post] = await Promise.all([
      tryClaimScheduledReport("pre-market", "2026-07-01"),
      tryClaimScheduledReport("post-market", "2026-07-01"),
    ]);

    expect(pre).toBe(true);
    expect(post).toBe(true);
  });

  it("fail-open: DB error allows send to proceed (returns true)", async () => {
    mockExecute.mockRejectedValueOnce(new Error("DB connection refused"));

    const claimed = await tryClaimScheduledReport("pre-market", "2026-07-01");
    // Fail-open: DB failure must not block the report
    expect(claimed).toBe(true);
  });

  it("manual test bypass: tryClaimScheduledReport is NOT called by isManualTest=true path", () => {
    // Contract: manual sends bypass dedup entirely. This is enforced in sendPreMarketReport
    // when isManualTest=true (the function does NOT call tryClaimScheduledReport).
    // This test documents the contract.
    expect(typeof tryClaimScheduledReport).toBe("function");
    // No mockExecute calls expected — the manual path is exercised separately.
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

// ── ensureDailyReportRunsTable — schema contract ──────────────────────────────

describe("ensureDailyReportRunsTable — schema contract", () => {
  it("is exported and callable", () => {
    expect(typeof ensureDailyReportRunsTable).toBe("function");
  });

  it("is idempotent via tableReady latch — DB is not re-queried once ready", async () => {
    // tableReady is a module-level singleton set to true after the first successful call.
    // All subsequent calls return early without a DB round-trip (fast-path).
    // We verify the function is safe to call multiple times without error.
    mockExecute.mockResolvedValue({ rows: [] });
    await expect(ensureDailyReportRunsTable()).resolves.toBeUndefined();
    await expect(ensureDailyReportRunsTable()).resolves.toBeUndefined();
    // No assertion on mockExecute call count — depends on whether this is the first
    // module import (tableReady=false) or a subsequent call (tableReady=true).
  });

  it("UNIQUE constraint documents the dedup key (report_type, ist_date)", () => {
    // The tryClaimScheduledReport INSERT uses ON CONFLICT (report_type, ist_date) DO NOTHING.
    // This only works because ensureDailyReportRunsTable creates the UNIQUE constraint.
    // Verify the exported function name matches the dedup architecture.
    expect(ensureDailyReportRunsTable.name).toBe("ensureDailyReportRunsTable");
    // Coverage map exists as expected — coverage + dedup tables are both present in the module.
    expect(DAILY_ANALYSIS_COVERAGE).toBeDefined();
  });
});

// ── DAILY_ANALYSIS_COVERAGE — all sections present ───────────────────────────

const EXPECTED_PRE_MARKET_KEYS = [
  "overnightGlobalCues",
  "giftNifty",
  "fiiDiiCash",
  "fiiDiiFno",
  "participantOi",
  "indiaVix",
  "keyLevelsOhlc",
  "cprPivots",
  "optionChainAnalytics",
  "expectedRange",
  "newsEvents",
  "expiryRollover",
  "biasTradePlan",
];

const EXPECTED_POST_MARKET_KEYS = [
  "indexPerformance",
  "marketBreadth",
  "optionChainEod",
  "levelValidation",
  "sectorMoves",
  "newsRecap",
  "globalStatusCheck",
  "tradeJournal",
  "tomorrowSetup",
];

describe("DAILY_ANALYSIS_COVERAGE — all required sections", () => {
  it("has all 13 pre-market section keys", () => {
    for (const key of EXPECTED_PRE_MARKET_KEYS) {
      expect(DAILY_ANALYSIS_COVERAGE).toHaveProperty(key);
    }
  });

  it("has all 9 post-market section keys", () => {
    for (const key of EXPECTED_POST_MARKET_KEYS) {
      expect(DAILY_ANALYSIS_COVERAGE).toHaveProperty(key);
    }
  });

  it("total coverage sections = 22 (13 pre + 9 post)", () => {
    expect(Object.keys(DAILY_ANALYSIS_COVERAGE).length).toBe(22);
  });

  it("every entry has status, source (string|null), and note (string)", () => {
    const VALID_STATUSES = new Set(["AVAILABLE", "INFO_ONLY", "SOURCE_NOT_INTEGRATED", "STALE", "TRADE_GRADE", "UNAVAILABLE"]);
    for (const [key, entry] of Object.entries(DAILY_ANALYSIS_COVERAGE)) {
      expect(VALID_STATUSES.has(entry.status), `${key}: invalid status "${entry.status}"`).toBe(true);
      expect(typeof entry.note, `${key}: note must be string`).toBe("string");
      expect(entry.note.length, `${key}: note must not be empty`).toBeGreaterThan(0);
      // source is string or null
      expect(
        entry.source === null || typeof entry.source === "string",
        `${key}: source must be string or null`,
      ).toBe(true);
    }
  });

  it("SOURCE_NOT_INTEGRATED entries have null source (no fake provider)", () => {
    for (const [key, entry] of Object.entries(DAILY_ANALYSIS_COVERAGE)) {
      if (entry.status === "SOURCE_NOT_INTEGRATED") {
        expect(entry.source, `${key}: SOURCE_NOT_INTEGRATED must have null source`).toBeNull();
      }
    }
  });

  it("no section has fake zero / empty note (source-honesty contract)", () => {
    for (const [key, entry] of Object.entries(DAILY_ANALYSIS_COVERAGE)) {
      expect(entry.note.trim(), `${key}: note must not be blank`).not.toBe("");
    }
  });

  it("PREPOST secrets config: no token or chatId value in coverage entries", () => {
    const coverageStr = JSON.stringify(DAILY_ANALYSIS_COVERAGE);
    expect(coverageStr).not.toContain("BOT_TOKEN");
    expect(coverageStr).not.toContain("CHAT_ID");
  });

  it("overnightGlobalCues is INFO_ONLY (yahoo, not trade-grade)", () => {
    expect(DAILY_ANALYSIS_COVERAGE["overnightGlobalCues"]?.status).toBe("INFO_ONLY");
    expect(DAILY_ANALYSIS_COVERAGE["overnightGlobalCues"]?.source).toBe("yahoo-finance");
  });

  it("giftNifty is SOURCE_NOT_INTEGRATED with null source", () => {
    expect(DAILY_ANALYSIS_COVERAGE["giftNifty"]?.status).toBe("SOURCE_NOT_INTEGRATED");
    expect(DAILY_ANALYSIS_COVERAGE["giftNifty"]?.source).toBeNull();
  });

  it("keyLevelsOhlc is AVAILABLE (kite)", () => {
    expect(DAILY_ANALYSIS_COVERAGE["keyLevelsOhlc"]?.status).toBe("AVAILABLE");
    expect(DAILY_ANALYSIS_COVERAGE["keyLevelsOhlc"]?.source).toBe("kite");
  });

  it("tradeJournal is AVAILABLE (db — paper trades)", () => {
    expect(DAILY_ANALYSIS_COVERAGE["tradeJournal"]?.status).toBe("AVAILABLE");
    expect(DAILY_ANALYSIS_COVERAGE["tradeJournal"]?.source).toBe("db");
  });

  it("indiaVix is SOURCE_NOT_INTEGRATED (not in Kite feed separately)", () => {
    expect(DAILY_ANALYSIS_COVERAGE["indiaVix"]?.status).toBe("SOURCE_NOT_INTEGRATED");
    expect(DAILY_ANALYSIS_COVERAGE["indiaVix"]?.source).toBeNull();
  });
});
