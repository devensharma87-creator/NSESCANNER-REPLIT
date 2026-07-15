/**
 * P0 Phase B follow-through: charges-drag daily alert wiring.
 *
 * Reads today's and the last 7 IST trading days' F&O drag directly
 * from the durable `paper_trade_fo` columns — no separate history
 * table needed. Only rows with `charges_status = 'CURRENT'` count
 * (they're the only rows whose `charges_total` is stored). Legacy
 * pre-P0 rows are silently excluded.
 *
 * Exposed function `evaluateAndSendChargesDragAlert(nowMs)`:
 *   • Computes today's gross + charges from CURRENT-tagged closes.
 *   • Reads N previous IST days (default 7) into observation history.
 *   • Runs `evaluateDragAlert`.
 *   • On BREACH → sends the message via the pre/post Telegram tier.
 *
 * Fail-open at every seam — a query failure logs at WARN and returns
 * `"QUERY_FAILED"`, but never throws into the post-market cadence.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";
import {
  evaluateDragAlert,
  renderDragAlertMessage,
  type DragObservation,
} from "./chargesDragAlert";
import { sendPrePostTelegramMessage } from "./alerting";

export type DragAlertOutcome =
  | "SENT_BREACH"
  | "OK"
  | "TOO_FEW_SAMPLES"
  | "TODAY_NULL"
  | "SIGMA_ZERO"
  | "QUERY_FAILED"
  | "SEND_FAILED";

interface DailyDragRow {
  ist_date: string;
  gross_pnl: number;
  charges_total: number;
}

/**
 * Load today's + last N days' F&O charges-drag observations from the
 * durable `paper_trade_fo` columns. `ist_date` is derived from
 * `exited_at` shifted to +05:30 so day boundaries line up with the
 * report's IST-day contract.
 */
async function loadDragHistory(
  nowMs: number,
  windowDays: number,
): Promise<{ history: DragObservation[]; today: DragObservation | null }> {
  // Look back windowDays + 1 (today included), plus a small buffer for
  // weekends inside the window. 14 calendar days is a safe superset.
  const lookbackDays = windowDays + 7;
  const cutoffMs = nowMs - lookbackDays * 24 * 60 * 60_000;
  const rows = (await db.execute(sql`
    SELECT
      to_char((exited_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS ist_date,
      COALESCE(SUM(realized_pnl), 0)::float AS gross_pnl,
      COALESCE(SUM(charges_total), 0)::float AS charges_total
      FROM paper_trade_fo
     WHERE status = 'CLOSED'
       AND charges_status = 'CURRENT'
       AND exited_at IS NOT NULL
       AND exited_at >= to_timestamp(${cutoffMs / 1000})
     GROUP BY ist_date
     ORDER BY ist_date
  `)) as unknown as { rows: DailyDragRow[] };

  const list = (rows.rows ?? []).map((r) => ({
    istDate: r.ist_date,
    grossPnl: Number(r.gross_pnl),
    chargesTotal: Number(r.charges_total),
  }));

  const todayIst = istDateFor(nowMs);
  const today = list.find((r) => r.istDate === todayIst) ?? null;
  const history = list.filter((r) => r.istDate !== todayIst).slice(-windowDays);
  return { history, today };
}

function istDateFor(epochMs: number): string {
  const d = new Date(epochMs + 5.5 * 60 * 60_000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export interface EvaluateAndSendResult {
  outcome: DragAlertOutcome;
  todayDragPct: number | null;
  medianPct: number | null;
  thresholdPct: number | null;
  historySampleCount: number;
}

export async function evaluateAndSendChargesDragAlert(
  nowMs: number = Date.now(),
): Promise<EvaluateAndSendResult> {
  let history: DragObservation[] = [];
  let today: DragObservation | null = null;
  try {
    const loaded = await loadDragHistory(nowMs, 7);
    history = loaded.history;
    today = loaded.today;
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "chargesDragAlert: history query failed",
    );
    return {
      outcome: "QUERY_FAILED",
      todayDragPct: null,
      medianPct: null,
      thresholdPct: null,
      historySampleCount: 0,
    };
  }

  if (today == null) {
    // No CURRENT-tagged trades closed today → nothing to compare.
    // Silent by design (same rule as the post-market report line).
    return {
      outcome: "TODAY_NULL",
      todayDragPct: null,
      medianPct: null,
      thresholdPct: null,
      historySampleCount: history.length,
    };
  }

  const result = evaluateDragAlert(today, history);
  if (!result.breach) {
    return {
      outcome:
        result.reason === "OK"
          ? "OK"
          : result.reason === "TOO_FEW_SAMPLES"
            ? "TOO_FEW_SAMPLES"
            : result.reason === "SIGMA_ZERO"
              ? "SIGMA_ZERO"
              : result.reason === "TODAY_NULL"
                ? "TODAY_NULL"
                : "OK",
      todayDragPct: result.todayDragPct,
      medianPct: result.medianPct,
      thresholdPct: result.thresholdPct,
      historySampleCount: history.length,
    };
  }

  // BREACH — send a distinct message (not appended to the main
  // report) so it can be routed independently by Telegram tier config.
  const body = renderDragAlertMessage(today, result);
  try {
    await sendPrePostTelegramMessage(body);
    logger.warn(
      {
        istDate: today.istDate,
        todayDragPct: result.todayDragPct,
        medianPct: result.medianPct,
        thresholdPct: result.thresholdPct,
      },
      "chargesDragAlert: BREACH — Telegram sent",
    );
    return {
      outcome: "SENT_BREACH",
      todayDragPct: result.todayDragPct,
      medianPct: result.medianPct,
      thresholdPct: result.thresholdPct,
      historySampleCount: history.length,
    };
  } catch (err) {
    logger.error(
      { err: (err as Error).message },
      "chargesDragAlert: Telegram send failed for BREACH",
    );
    return {
      outcome: "SEND_FAILED",
      todayDragPct: result.todayDragPct,
      medianPct: result.medianPct,
      thresholdPct: result.thresholdPct,
      historySampleCount: history.length,
    };
  }
}
