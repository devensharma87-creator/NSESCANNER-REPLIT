/**
 * Daily Analysis routes — owner-only endpoints for pre/post market report management.
 *
 * GET  /daily-analysis/status                — PREPOST bot status + last report records + schedule info
 * GET  /daily-analysis/pre-market/latest     — latest pre-market report record
 * GET  /daily-analysis/post-market/latest    — latest post-market report record
 * GET  /daily-analysis/history               — DB-backed report run history (last 30, all types incl. eod_reconcile)
 * GET  /daily-analysis/telegram/preview       — preview rendered report text + data contract (dry-run, no send)
 * POST /daily-analysis/generate-pre-market   — manual generate + send to PREPOST bot (30s rate limit)
 * POST /daily-analysis/generate-post-market  — manual generate + send to PREPOST bot (30s rate limit)
 * POST /daily-analysis/generate-eod-reconcile — manual EOD reconcile summary (30s rate limit)
 *
 * Safety guarantees:
 *   – All endpoints are owner-only (requireOwner).
 *   – No trading logic, signals, paper-trade creation, or broker execution.
 *   – No secrets returned — bot config is status-only (no token/chatId).
 *   – Manual generate endpoints bypass DB dedup but remain rate-limited.
 *   – Preview endpoint never sends Telegram and never touches DB dedup state.
 */

import { Router, type IRouter } from "express";
import { requireOwner, requireOwnerStrict } from "../lib/userAuth";
import { getTelegramStatus, getPrePostTelegramStatus } from "../lib/alerting";
import {
  getLastPreMarketReportRecord,
  getLastPostMarketReportRecord,
  getLastEodReconcileRecord,
  sendPreMarketReport,
  sendPostMarketReport,
  sendEodReconcileReport,
  getReportHistory,
  DAILY_ANALYSIS_COVERAGE,
  gatherPreMarketData,
  gatherPostMarketData,
  buildPreMarketReport,
  buildPostMarketReport,
} from "../lib/dailyReports";

const router: IRouter = Router();

// ── GET /daily-analysis/status ─────────────────────────────────────────────

router.get("/daily-analysis/status", requireOwner, async (_req, res, next) => {
  try {
    const history = await getReportHistory(5);
    res.json({
      prepostTelegram: getPrePostTelegramStatus(),
      defaultTelegram: getTelegramStatus(),
      schedule: {
        preMarket: {
          time: "08:50 IST",
          windowMinutes: 20,
          description: "Sent once at 08:50–09:10 IST on weekdays",
        },
        postMarket: {
          time: "15:45 IST",
          windowMinutes: 30,
          description: "Sent once at 15:45–16:15 IST on weekdays",
        },
      },
      lastPreMarket: getLastPreMarketReportRecord(),
      lastPostMarket: getLastPostMarketReportRecord(),
      lastEodReconcile: getLastEodReconcileRecord(),
      recentHistory: history,
      workerDedup: {
        mechanism: "DB UNIQUE(report_type, ist_date) INSERT ON CONFLICT DO NOTHING",
        description: "Prevents multi-worker duplicate sends on autoscale deployments",
      },
      coverage: DAILY_ANALYSIS_COVERAGE,
      brokerExecution: "DISABLED",
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /daily-analysis/pre-market/latest ─────────────────────────────────

router.get("/daily-analysis/pre-market/latest", requireOwner, (_req, res, next) => {
  try {
    const record = getLastPreMarketReportRecord();
    if (!record) {
      res.status(404).json({
        error: "not_found",
        message: "No pre-market report has been sent since server start.",
      });
      return;
    }
    res.json({ record, brokerExecution: "DISABLED" });
  } catch (err) {
    next(err);
  }
});

// ── GET /daily-analysis/post-market/latest ────────────────────────────────

router.get("/daily-analysis/post-market/latest", requireOwner, (_req, res, next) => {
  try {
    const record = getLastPostMarketReportRecord();
    if (!record) {
      res.status(404).json({
        error: "not_found",
        message: "No post-market report has been sent since server start.",
      });
      return;
    }
    res.json({ record, brokerExecution: "DISABLED" });
  } catch (err) {
    next(err);
  }
});

// ── GET /daily-analysis/history ───────────────────────────────────────────

router.get("/daily-analysis/history", requireOwner, async (req, res, next) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query["limit"]) || 30));
    const history = await getReportHistory(limit);
    res.json({ history, count: history.length });
  } catch (err) {
    next(err);
  }
});

// ── GET /daily-analysis/telegram/preview ──────────────────────────────────
// Dry-run preview: renders the report text + returns the underlying data
// contract as JSON. Never sends Telegram, never claims/mutates DB dedup
// state — it calls the pure gatherer + builder directly, bypassing
// sendPreMarketReport/sendPostMarketReport entirely. Always labeled as a
// manual/test render so it can never be mistaken for a live send.

router.get("/daily-analysis/telegram/preview", requireOwnerStrict, async (req, res, next) => {
  try {
    const type = String(req.query["type"] ?? "");
    if (type !== "pre" && type !== "post") {
      res.status(400).json({
        error: "invalid_type",
        message: "Query param 'type' must be 'pre' or 'post'.",
      });
      return;
    }

    const now = Date.now();
    if (type === "pre") {
      const data = await gatherPreMarketData(now, true);
      const text = buildPreMarketReport(data);
      res.json({
        type: "pre-market",
        isManualTest: true,
        preview: true,
        text,
        data,
        telegramSent: false,
        dedupStateChanged: false,
        brokerExecution: "DISABLED",
      });
      return;
    }

    const data = await gatherPostMarketData(now, true);
    const text = buildPostMarketReport(data);
    res.json({
      type: "post-market",
      isManualTest: true,
      preview: true,
      text,
      data,
      telegramSent: false,
      dedupStateChanged: false,
      brokerExecution: "DISABLED",
    });
  } catch (err) {
    next(err);
  }
});

// ── Manual generate rate limits ───────────────────────────────────────────

let lastPreMarketGenAt = 0;
let lastPostMarketGenAt = 0;
let lastEodReconcileGenAt = 0;
const GENERATE_RATE_LIMIT_MS = 30_000;

// ── POST /daily-analysis/generate-pre-market ─────────────────────────────

router.post("/daily-analysis/generate-pre-market", requireOwner, async (_req, res, next) => {
  try {
    const now = Date.now();
    if (now - lastPreMarketGenAt < GENERATE_RATE_LIMIT_MS) {
      const retryAfterSec = Math.ceil((GENERATE_RATE_LIMIT_MS - (now - lastPreMarketGenAt)) / 1000);
      res.status(429).json({
        error: "rate_limited",
        message: `Rate-limited. Retry after ${retryAfterSec}s.`,
      });
      return;
    }
    lastPreMarketGenAt = now;

    const result = await sendPreMarketReport(now, true);

    res.json({
      result,
      type: "pre-market",
      isManualTest: true,
      telegramDestination: "prepost",
      prepostTelegramStatus: getPrePostTelegramStatus().status,
      paperTradeCreated: false,
      realOrderPlaced: false,
      brokerExecution: "DISABLED",
      note: "Manual generate — labeled [MANUAL TEST] in Telegram. Bypasses DB dedup. No trading state mutated.",
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /daily-analysis/generate-post-market ────────────────────────────

router.post("/daily-analysis/generate-post-market", requireOwner, async (_req, res, next) => {
  try {
    const now = Date.now();
    if (now - lastPostMarketGenAt < GENERATE_RATE_LIMIT_MS) {
      const retryAfterSec = Math.ceil((GENERATE_RATE_LIMIT_MS - (now - lastPostMarketGenAt)) / 1000);
      res.status(429).json({
        error: "rate_limited",
        message: `Rate-limited. Retry after ${retryAfterSec}s.`,
      });
      return;
    }
    lastPostMarketGenAt = now;

    const result = await sendPostMarketReport(now, true);

    res.json({
      result,
      type: "post-market",
      isManualTest: true,
      telegramDestination: "prepost",
      prepostTelegramStatus: getPrePostTelegramStatus().status,
      paperTradeCreated: false,
      realOrderPlaced: false,
      brokerExecution: "DISABLED",
      note: "Manual generate — labeled [MANUAL TEST] in Telegram. Bypasses DB dedup. No trading state mutated.",
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /daily-analysis/generate-eod-reconcile ──────────────────────────

router.post("/daily-analysis/generate-eod-reconcile", requireOwner, async (_req, res, next) => {
  try {
    const now = Date.now();
    if (now - lastEodReconcileGenAt < GENERATE_RATE_LIMIT_MS) {
      const retryAfterSec = Math.ceil((GENERATE_RATE_LIMIT_MS - (now - lastEodReconcileGenAt)) / 1000);
      res.status(429).json({
        error: "rate_limited",
        message: `Rate-limited. Retry after ${retryAfterSec}s.`,
      });
      return;
    }
    lastEodReconcileGenAt = now;

    const result = await sendEodReconcileReport(now, true);

    res.json({
      result,
      type: "eod-reconcile",
      isManualTest: true,
      telegramDestination: "prepost",
      prepostTelegramStatus: getPrePostTelegramStatus().status,
      paperTradeCreated: false,
      realOrderPlaced: false,
      brokerExecution: "DISABLED",
      note: "Manual generate — labeled [MANUAL TEST] in Telegram. Bypasses DB dedup. No trading state mutated.",
    });
  } catch (err) {
    next(err);
  }
});

export default router;
