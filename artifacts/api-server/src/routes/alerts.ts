/**
 * Owner-only alert management routes.
 *
 * GET  /alerts/status                   — Telegram config status + last alert records (no secrets).
 * POST /alerts/test-telegram            — Send a test Telegram message; rate-limited to 1/30s.
 * POST /alerts/test-swing-staged-order  — Send a sample Swing staged-order alert; rate-limited to 1/30s.
 * POST /alerts/test-fno-trade-signal    — Send a sample F&O tradeable signal alert; rate-limited to 1/30s.
 * POST /alerts/test-pre-market-report   — Send a manual pre-market readiness report; rate-limited to 1/30s.
 * POST /alerts/test-post-market-report  — Send a manual post-market summary report; rate-limited to 1/30s.
 * GET  /alerts/system-health            — Owner-strict: DB-backed alert claim/state diagnostics (no secrets).
 */
import { Router, type IRouter } from "express";
import { requireOwner, requireOwnerStrict } from "../lib/userAuth";
import {
  getTelegramStatus,
  getPrePostTelegramStatus,
  getLastAlertRecord,
  sendTestTelegramMessage,
  alertOwnerRaw,
  resetAlertDedup,
  getSkippedAlertStats,
} from "../lib/alerting";
import { getLastSwingAlertRecord } from "../lib/swingAlerts";
import {
  getLastFnoSignalAlertRecord,
  buildFnoSampleAlertText,
} from "../lib/fnoSignalAlerts";
import {
  getLastPreMarketReportRecord,
  getLastPostMarketReportRecord,
  sendPreMarketReport,
  sendPostMarketReport,
} from "../lib/dailyReports";
import { listRecentSystemAlertClaims, listSystemAlertStates } from "../lib/systemAlertDedup";
import { getLastSystemAlertDedupSelfTestResult } from "../lib/systemAlertDedupSelfTest";

const router: IRouter = Router();

router.get("/alerts/status", requireOwner, (_req, res, next) => {
  try {
    res.json({
      telegram: getTelegramStatus(),
      prepostTelegram: getPrePostTelegramStatus(),
      lastAlert: getLastAlertRecord(),
      lastSwingAlert: getLastSwingAlertRecord(),
      lastFnoSignalAlert: getLastFnoSignalAlertRecord(),
      lastPreMarketReport: getLastPreMarketReportRecord(),
      lastPostMarketReport: getLastPostMarketReportRecord(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /alerts/system-health
 *
 * Owner-strict, read-only diagnostics for the DB-backed system-alert dedup/
 * claim layer (systemAlertDedup.ts). Surfaces the cross-process source of
 * truth (recent claims + per-family state) plus this process's in-memory
 * skip counter, so the owner can see dedup/CAS-state health without reading
 * server logs. No secrets, no trading state, no writes.
 */
router.get("/alerts/system-health", requireOwnerStrict, async (_req, res, next) => {
  try {
    const [recentClaims, states] = await Promise.all([
      listRecentSystemAlertClaims(50),
      listSystemAlertStates(),
    ]);
    res.json({
      states,
      recentClaims,
      skipped: getSkippedAlertStats(),
      selfTest: getLastSystemAlertDedupSelfTestResult(),
    });
  } catch (err) {
    next(err);
  }
});

/** In-process rate limits for the test endpoints — prevents accidental spam. */
let lastTestSentAt = 0;
let lastSwingTestSentAt = 0;
let lastFnoTestSentAt = 0;
let lastPreMarketTestSentAt = 0;
let lastPostMarketTestSentAt = 0;
const TEST_RATE_LIMIT_MS = 30_000;

router.post("/alerts/test-telegram", requireOwner, async (_req, res, next) => {
  try {
    const now = Date.now();
    if (now - lastTestSentAt < TEST_RATE_LIMIT_MS) {
      const retryAfterSec = Math.ceil((TEST_RATE_LIMIT_MS - (now - lastTestSentAt)) / 1000);
      res.status(429).json({
        error: "rate_limited",
        message: `Test endpoint rate-limited. Retry after ${retryAfterSec}s.`,
      });
      return;
    }
    lastTestSentAt = now;
    const result = await sendTestTelegramMessage();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/alerts/test-swing-staged-order", requireOwner, async (_req, res, next) => {
  try {
    const now = Date.now();
    if (now - lastSwingTestSentAt < TEST_RATE_LIMIT_MS) {
      const retryAfterSec = Math.ceil((TEST_RATE_LIMIT_MS - (now - lastSwingTestSentAt)) / 1000);
      res.status(429).json({
        error: "rate_limited",
        message: `Test endpoint rate-limited. Retry after ${retryAfterSec}s.`,
      });
      return;
    }
    lastSwingTestSentAt = now;

    const sampleText = [
      "\uD83D\uDCCC SWING CASH ALERT",
      "",
      "Event: Order staged for approval [SAMPLE]",
      "Symbol: RELIANCE",
      "Setup: Breakout_Swing_Long",
      "Entry: \u20B92,450.00",
      "SL: \u20B92,350.00",
      "Target 1: \u20B92,650.00  Target 2: \u20B92,800.00",
      "R:R: 2.00  Qty: 10  Risk: 0.50%",
      "Capital: \u20B924,500.00  Max Risk: \u20B91,000.00",
      "Sector: Energy",
      "Risk eval: kite (sample data \u2014 not a real order)",
      "Status: Broker execution DISABLED",
      "Action: Review in Swing Live Queue",
    ].join("\n");

    const testDedupKey = "SWING_TEST_STAGED_ORDER";
    resetAlertDedup(testDedupKey);
    alertOwnerRaw(testDedupKey, "Test swing staged-order alert", sampleText, 0);

    // alertOwnerRaw dispatches Telegram in the background — wait briefly for delivery.
    await new Promise(r => setTimeout(r, 500));

    const lastAlert = getLastAlertRecord();
    res.json({
      sent: true,
      telegramStatus: lastAlert?.event === testDedupKey ? lastAlert.telegramStatus : "DISPATCHED",
      note: "Sample message only — no DB write, no real order, broker execution disabled.",
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /alerts/test-fno-trade-signal
 *
 * Send a clearly-labeled [SAMPLE] F&O format-test alert to Telegram.
 * Owner-only. Rate-limited to 1 call per 30 seconds.
 *
 * REQUIRES body: { "confirmSampleAlert": true }
 * — prevents accidental spam from repeated manual verification calls.
 *
 * Does NOT create a paper trade, does NOT use real signal state,
 * does NOT call the Kite API, does NOT enable broker execution.
 */
router.post("/alerts/test-fno-trade-signal", requireOwner, async (req, res, next) => {
  try {
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || body["confirmSampleAlert"] !== true) {
      res.status(400).json({
        error: "confirmation_required",
        message: "Sample alert requires confirmSampleAlert=true in request body to prevent accidental spam.",
        sampleOnly: true,
        paperTradeCreated: false,
        realOrderPlaced: false,
        priceSource: "SAMPLE_NOT_LIVE",
      });
      return;
    }

    const now = Date.now();
    if (now - lastFnoTestSentAt < TEST_RATE_LIMIT_MS) {
      const retryAfterSec = Math.ceil((TEST_RATE_LIMIT_MS - (now - lastFnoTestSentAt)) / 1000);
      res.status(429).json({
        error: "rate_limited",
        message: `Test endpoint rate-limited. Retry after ${retryAfterSec}s.`,
        sampleOnly: true,
        paperTradeCreated: false,
        realOrderPlaced: false,
        priceSource: "SAMPLE_NOT_LIVE",
      });
      return;
    }
    lastFnoTestSentAt = now;

    const sampleText = buildFnoSampleAlertText(now);
    const testDedupKey = "FNO_TEST_TRADEABLE_SIGNAL";
    resetAlertDedup(testDedupKey);
    alertOwnerRaw(testDedupKey, "Test F&O format-test alert [SAMPLE]", sampleText, 0);

    // alertOwnerRaw dispatches Telegram in the background — wait briefly for delivery.
    await new Promise(r => setTimeout(r, 500));

    const lastAlert = getLastAlertRecord();
    res.json({
      sent: true,
      telegramStatus: lastAlert?.event === testDedupKey ? lastAlert.telegramStatus : "DISPATCHED",
      note: "Sample message only — no paper trade created, no real order, broker execution disabled.",
      sampleOnly: true,
      paperTradeCreated: false,
      realOrderPlaced: false,
      priceSource: "SAMPLE_NOT_LIVE",
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /alerts/test-pre-market-report
 *
 * Send a [MANUAL TEST] pre-market readiness report to Telegram.
 * Owner-only. Rate-limited to 1 call per 30 seconds.
 *
 * Gathers live Kite session status, F&O cycle state, swing order counts,
 * and alert records. Does NOT create paper trades, does NOT place real orders,
 * does NOT enable broker execution.
 */
router.post("/alerts/test-pre-market-report", requireOwner, async (_req, res, next) => {
  try {
    const now = Date.now();
    if (now - lastPreMarketTestSentAt < TEST_RATE_LIMIT_MS) {
      const retryAfterSec = Math.ceil((TEST_RATE_LIMIT_MS - (now - lastPreMarketTestSentAt)) / 1000);
      res.status(429).json({
        error: "rate_limited",
        message: `Test endpoint rate-limited. Retry after ${retryAfterSec}s.`,
      });
      return;
    }
    lastPreMarketTestSentAt = now;

    const result = await sendPreMarketReport(now, true);

    res.json({
      sent: true,
      result,
      type: "pre-market",
      isManualTest: true,
      telegramDestination: "prepost",
      paperTradeCreated: false,
      realOrderPlaced: false,
      brokerExecution: "DISABLED",
      note: "Manual test report — labeled [MANUAL TEST] in Telegram. No trading state mutated.",
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /alerts/test-post-market-report
 *
 * Send a [MANUAL TEST] post-market summary report to Telegram.
 * Owner-only. Rate-limited to 1 call per 30 seconds.
 *
 * Gathers today's F&O daily summary, swing order counts, and alert records.
 * Does NOT create paper trades, does NOT place real orders,
 * does NOT enable broker execution.
 */
router.post("/alerts/test-post-market-report", requireOwner, async (_req, res, next) => {
  try {
    const now = Date.now();
    if (now - lastPostMarketTestSentAt < TEST_RATE_LIMIT_MS) {
      const retryAfterSec = Math.ceil((TEST_RATE_LIMIT_MS - (now - lastPostMarketTestSentAt)) / 1000);
      res.status(429).json({
        error: "rate_limited",
        message: `Test endpoint rate-limited. Retry after ${retryAfterSec}s.`,
      });
      return;
    }
    lastPostMarketTestSentAt = now;

    const result = await sendPostMarketReport(now, true);

    res.json({
      sent: true,
      result,
      type: "post-market",
      isManualTest: true,
      telegramDestination: "prepost",
      paperTradeCreated: false,
      realOrderPlaced: false,
      brokerExecution: "DISABLED",
      note: "Manual test report — labeled [MANUAL TEST] in Telegram. No trading state mutated.",
    });
  } catch (err) {
    next(err);
  }
});

export default router;
