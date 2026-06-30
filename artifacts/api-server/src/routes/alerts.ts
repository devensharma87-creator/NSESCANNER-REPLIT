/**
 * Owner-only alert management routes.
 *
 * GET  /alerts/status          — Telegram config status + last alert record (no secrets).
 * POST /alerts/test-telegram   — Send a test Telegram message; rate-limited to 1/30s.
 */
import { Router, type IRouter } from "express";
import { requireOwner } from "../lib/userAuth";
import {
  getTelegramStatus,
  getLastAlertRecord,
  sendTestTelegramMessage,
} from "../lib/alerting";

const router: IRouter = Router();

router.get("/alerts/status", requireOwner, (_req, res, next) => {
  try {
    res.json({
      telegram: getTelegramStatus(),
      lastAlert: getLastAlertRecord(),
    });
  } catch (err) {
    next(err);
  }
});

/** In-process rate limit for the test endpoint — prevents accidental spam. */
let lastTestSentAt = 0;
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

export default router;
