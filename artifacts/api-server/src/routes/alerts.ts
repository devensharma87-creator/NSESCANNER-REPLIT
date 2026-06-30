/**
 * Owner-only alert management routes.
 *
 * GET  /alerts/status                   — Telegram config status + last alert records (no secrets).
 * POST /alerts/test-telegram            — Send a test Telegram message; rate-limited to 1/30s.
 * POST /alerts/test-swing-staged-order  — Send a sample Swing staged-order alert; rate-limited to 1/30s.
 */
import { Router, type IRouter } from "express";
import { requireOwner } from "../lib/userAuth";
import {
  getTelegramStatus,
  getLastAlertRecord,
  sendTestTelegramMessage,
  alertOwnerRaw,
  resetAlertDedup,
} from "../lib/alerting";
import { getLastSwingAlertRecord } from "../lib/swingAlerts";

const router: IRouter = Router();

router.get("/alerts/status", requireOwner, (_req, res, next) => {
  try {
    res.json({
      telegram: getTelegramStatus(),
      lastAlert: getLastAlertRecord(),
      lastSwingAlert: getLastSwingAlertRecord(),
    });
  } catch (err) {
    next(err);
  }
});

/** In-process rate limits for the test endpoints — prevents accidental spam. */
let lastTestSentAt = 0;
let lastSwingTestSentAt = 0;
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

export default router;
