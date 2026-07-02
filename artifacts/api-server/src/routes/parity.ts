/**
 * Parity verification routes — Part A of the Deterministic Parity Verification Harness.
 *
 * Endpoints:
 *   GET  /api/parity/status                  — summary of notification_delivery_log
 *   POST /api/parity/trade-event/verify      — dry-run or test_destination parity check
 *   GET  /api/parity/trade-event/latest      — replay parity on latest log records
 *   GET  /api/parity/trade-event/replay/:id  — replay parity on a specific log record
 *
 * ABSOLUTE RULES:
 *   - All endpoints are OWNER-ONLY (requireOwner).
 *   - No endpoint sends to the real trade Telegram channel (TELEGRAM_BOT_TOKEN).
 *   - No endpoint creates paper trades or enables broker execution.
 *   - mode="test_destination" requires separate PARITY_TEST_TELEGRAM_BOT_TOKEN +
 *     PARITY_TEST_TELEGRAM_CHAT_ID env vars; falls back to dry_run if absent.
 *   - All fixtures use environment: "test" — DEV_ENV_BLOCKED prevents accidental
 *     production dispatch.
 *   - Return honest status — never fabricate data.
 */

import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireOwner } from "../lib/userAuth";
import { logger } from "../lib/logger";
import {
  runDryRunParity,
  replayFromNotificationLog,
  loadLatestNotificationLogRecords,
  buildParityStatusSummary,
  type ParityMode,
  type ReplayRecord,
} from "../lib/tradeLifecycle/parityHarness";
import {
  ALL_FIXTURES,
  FIXTURE_SWING_ENTRY_READY,
  FIXTURE_FNO_ENTRY_OPENED,
  FIXTURE_SWING_EXIT_SL,
  FIXTURE_FNO_EXIT_SL,
} from "../lib/tradeLifecycle/parityFixtures";
import type { CanonicalTradeEvent } from "../lib/tradeLifecycle/types";

const router = Router();

// ── GET /parity/status ────────────────────────────────────────────────────────

/**
 * GET /api/parity/status
 *
 * Owner-only status summary of the notification delivery log.
 * Powers the "Signal / Telegram Parity" section on /infra-health.
 *
 * Returns aggregate counts, block reasons, and last records per category.
 * Read-only. No Telegram, no paper trade, no broker execution.
 */
router.get("/parity/status", requireOwner, async (_req, res, next) => {
  try {
    const summary = await buildParityStatusSummary();
    res.json({ ok: true, summary });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "parity: status endpoint failed");
    next(err);
  }
});

// ── POST /parity/trade-event/verify ──────────────────────────────────────────

/**
 * POST /api/parity/trade-event/verify
 *
 * Owner-only parity verification endpoint.
 *
 * Body:
 *   mode: "dry_run" | "test_destination" | "all_fixtures"
 *   fixture?: "swing_entry" | "fno_entry" | "swing_exit_sl" | "fno_exit_sl"
 *             (uses a built-in fixture — defaults to swing_entry)
 *   event?:  CanonicalTradeEvent (custom event for dry_run; must have environment:"test")
 *
 * Modes:
 *   dry_run         — validate + project + format + compare; no Telegram
 *   test_destination — same plus sends to PARITY_TEST_TELEGRAM_BOT_TOKEN channel
 *   all_fixtures    — runs all 14 built-in fixtures and returns aggregate results
 *
 * NEVER sends to the real trade channel. Returns full ParityRunResult.
 */
router.post("/parity/trade-event/verify", requireOwner, async (req, res, next) => {
  try {
    const body = (req.body as Record<string, unknown>) ?? {};
    const mode = (body["mode"] as ParityMode) ?? "dry_run";
    const fixtureName = (body["fixture"] as string) ?? "swing_entry";

    // all_fixtures mode (raw body check — not a ParityMode enum value)
    if (body["mode"] === "all_fixtures") {
      const results = [];
      for (const fixture of ALL_FIXTURES) {
        results.push(await runDryRunParity(fixture.event, "dry_run"));
      }
      const allOk = results.every((r) => r.ok);
      res.json({
        ok: allOk,
        mode: "all_fixtures",
        fixtureCount: results.length,
        passCount: results.filter((r) => r.ok).length,
        failCount: results.filter((r) => !r.ok).length,
        results,
      });
      return;
    }

    // Single fixture or custom event
    let event: CanonicalTradeEvent;

    if (body["event"]) {
      // Custom event — must have environment: "test" to prevent accidental real dispatch
      const customEvent = body["event"] as Partial<CanonicalTradeEvent>;
      if (customEvent.environment !== "test") {
        res.status(400).json({
          ok: false,
          error: "CUSTOM_EVENT_MUST_BE_TEST",
          message: "Custom events must have environment: \"test\" to prevent accidental production dispatch.",
        });
        return;
      }
      event = customEvent as CanonicalTradeEvent;
    } else {
      // Built-in fixture
      const fixtureMap: Record<string, CanonicalTradeEvent> = {
        swing_entry:  FIXTURE_SWING_ENTRY_READY.event,
        fno_entry:    FIXTURE_FNO_ENTRY_OPENED.event,
        swing_exit_sl: FIXTURE_SWING_EXIT_SL.event,
        fno_exit_sl:  FIXTURE_FNO_EXIT_SL.event,
      };
      event = fixtureMap[fixtureName] ?? FIXTURE_SWING_ENTRY_READY.event;
    }

    const parityMode: "dry_run" | "test_destination" =
      mode === "test_destination" ? "test_destination" : "dry_run";

    const result = await runDryRunParity(event, parityMode);
    res.json({ ok: result.ok, result });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "parity: verify endpoint failed");
    next(err);
  }
});

// ── GET /parity/trade-event/latest ───────────────────────────────────────────

/**
 * GET /api/parity/trade-event/latest
 *
 * Owner-only replay of the latest notification_delivery_log records.
 * Loads up to 10 recent records, runs replayFromNotificationLog on each,
 * and returns structural parity results.
 *
 * Note: Hash match is advisory for replay — the reconstructed event uses
 * placeholder prices (cannot fully reconstruct from log alone). The replay
 * proves the formatter is callable and structurally consistent.
 *
 * Read-only. No Telegram, no paper trade.
 */
router.get("/parity/trade-event/latest", requireOwner, async (_req, res, next) => {
  try {
    const records = await loadLatestNotificationLogRecords(10);

    const replays = records.map((record) => replayFromNotificationLog(record));

    res.json({
      ok:     replays.every((r) => r.parity.ok),
      count:  replays.length,
      replays,
    });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "parity: latest endpoint failed");
    next(err);
  }
});

// ── GET /parity/trade-event/replay/:id ───────────────────────────────────────

/**
 * GET /api/parity/trade-event/replay/:id
 *
 * Owner-only replay of a specific notification_delivery_log record by row ID.
 *
 * Read-only. No Telegram, no paper trade.
 */
router.get("/parity/trade-event/replay/:id", requireOwner, async (req, res, next) => {
  try {
    const rowId = req.params["id"];
    if (!rowId || rowId.length > 128) {
      res.status(400).json({ ok: false, error: "INVALID_ID" });
      return;
    }

    const rows = await db.execute(sql`
      SELECT
        id, event_id, domain, event_type, symbol, exchange,
        order_id, signal_id, paper_trade_id,
        message_hash, status, environment, destination,
        sent_at, created_at
      FROM notification_delivery_log
      WHERE id = ${rowId}
      LIMIT 1
    `);

    if (!rows.rows?.length) {
      res.status(404).json({ ok: false, error: "NOT_FOUND" });
      return;
    }

    const r = rows.rows[0] as Record<string, unknown>;
    const record: ReplayRecord = {
      id:           String(r["id"] ?? ""),
      eventId:      String(r["event_id"] ?? ""),
      domain:       String(r["domain"] ?? ""),
      eventType:    String(r["event_type"] ?? ""),
      symbol:       String(r["symbol"] ?? ""),
      exchange:     String(r["exchange"] ?? ""),
      orderId:      r["order_id"] != null ? String(r["order_id"]) : null,
      signalId:     r["signal_id"] != null ? String(r["signal_id"]) : null,
      paperTradeId: r["paper_trade_id"] != null ? String(r["paper_trade_id"]) : null,
      messageHash:  String(r["message_hash"] ?? ""),
      status:       String(r["status"] ?? ""),
      environment:  String(r["environment"] ?? ""),
      destination:  String(r["destination"] ?? ""),
      sentAt:       r["sent_at"] != null ? new Date(r["sent_at"] as string).toISOString() : null,
      createdAt:    new Date(r["created_at"] as string).toISOString(),
    };

    const replay = replayFromNotificationLog(record);
    res.json({ ok: replay.parity.ok, replay });
  } catch (err) {
    logger.warn({ err: (err as Error).message, id: req.params["id"] }, "parity: replay endpoint failed");
    next(err);
  }
});

export default router;
