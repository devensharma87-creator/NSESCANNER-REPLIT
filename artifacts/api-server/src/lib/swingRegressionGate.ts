/**
 * Swing Regression Baseline Gate (F-37).
 *
 * Queries the last LOOKBACK_DAYS days of CLOSED autonomous equity paper
 * trades and computes win-rate / profit-factor metrics.  A regression signal
 * fires when either metric drops below the defined thresholds.
 *
 * "Autonomous" is defined as BOTH conditions holding:
 *   1. exit_reason IS NOT 'MANUAL_OVERRIDE'  — operator-influenced closes
 *      contaminate the strategy edge; exclude them.
 *   2. source IS NOT 'MANUAL_BUY'  — manually-opened positions don't
 *      reflect scanner quality; exclude them too.
 *
 * Pure DB read — no mutations, no trading decisions.
 */
import { db, paperTradeEqTable } from "@workspace/db";
import { and, eq, ne, or, isNull, gte } from "drizzle-orm";
import { logger } from "./logger";

/** Thresholds and lookback parameters for the regression gate. */
export const SWING_REGRESSION_CONFIG = {
  /** Rolling window for the regression check (calendar days). */
  LOOKBACK_DAYS: 30,
  /** Minimum closed autonomous trades needed before the gate fires. */
  MIN_SAMPLE: 10,
  /** Win-rate floor: below this threshold → WARN. */
  WR_WARN_THRESHOLD: 0.45,
  /** Win-rate floor: below this threshold → ALERT. */
  WR_ALERT_THRESHOLD: 0.35,
  /** Profit-factor floor: below this threshold → WARN. */
  PF_WARN_THRESHOLD: 1.0,
} as const;

export type SwingRegressionStatus = "OK" | "WARN" | "ALERT" | "INSUFFICIENT_DATA";

export interface SwingRegressionResult {
  status: SwingRegressionStatus;
  autonomousTradeCount: number;
  wins: number;
  losses: number;
  winRate: number | null;
  profitFactor: number | null;
  avgWinPnl: number | null;
  avgLossPnl: number | null;
  lookbackDays: number;
  computedAt: string;
  notes: string[];
}

/**
 * Compute swing regression health from the last LOOKBACK_DAYS days of
 * CLOSED autonomous equity paper trades.
 *
 * Autonomous = exit_reason != 'MANUAL_OVERRIDE' AND source != 'MANUAL_BUY'.
 * NULL exit_reason / source rows are treated as autonomous (no operator
 * fingerprint → include them).
 */
export async function checkSwingRegressionBaseline(): Promise<SwingRegressionResult> {
  const now = new Date();
  const cutoff = new Date(
    now.getTime() - SWING_REGRESSION_CONFIG.LOOKBACK_DAYS * 24 * 3600 * 1000,
  );
  const notes: string[] = [];

  try {
    const rows = await db
      .select({
        realizedPnl: paperTradeEqTable.realizedPnl,
      })
      .from(paperTradeEqTable)
      .where(
        and(
          eq(paperTradeEqTable.status, "CLOSED"),
          gte(paperTradeEqTable.exitedAt, cutoff),
          // Exclude manual-override exits — op-influenced closes contaminate
          // the autonomous strategy edge measurement.
          or(
            isNull(paperTradeEqTable.exitReason),
            ne(paperTradeEqTable.exitReason, "MANUAL_OVERRIDE"),
          ),
          // Exclude manually-opened trades — scanner quality only.
          or(
            isNull(paperTradeEqTable.source),
            ne(paperTradeEqTable.source, "MANUAL_BUY"),
          ),
        ),
      );

    const count = rows.length;

    if (count < SWING_REGRESSION_CONFIG.MIN_SAMPLE) {
      notes.push(
        `Only ${count}/${SWING_REGRESSION_CONFIG.MIN_SAMPLE} autonomous trades in last ` +
          `${SWING_REGRESSION_CONFIG.LOOKBACK_DAYS}d — insufficient sample.`,
      );
      return {
        status: "INSUFFICIENT_DATA",
        autonomousTradeCount: count,
        wins: 0,
        losses: 0,
        winRate: null,
        profitFactor: null,
        avgWinPnl: null,
        avgLossPnl: null,
        lookbackDays: SWING_REGRESSION_CONFIG.LOOKBACK_DAYS,
        computedAt: now.toISOString(),
        notes,
      };
    }

    let wins = 0;
    let losses = 0;
    let totalWinPnl = 0;
    let totalLossPnl = 0;

    for (const row of rows) {
      const pnl = row.realizedPnl != null ? Number(row.realizedPnl) : null;
      if (pnl == null || !Number.isFinite(pnl)) continue;
      if (pnl >= 0) {
        wins++;
        totalWinPnl += pnl;
      } else {
        losses++;
        totalLossPnl += Math.abs(pnl);
      }
    }

    const winRate = count > 0 ? wins / count : null;
    const profitFactor = totalLossPnl > 0 ? totalWinPnl / totalLossPnl : null;
    const avgWinPnl = wins > 0 ? totalWinPnl / wins : null;
    const avgLossPnl = losses > 0 ? -(totalLossPnl / losses) : null;

    let status: SwingRegressionStatus = "OK";

    if (winRate != null) {
      if (winRate < SWING_REGRESSION_CONFIG.WR_ALERT_THRESHOLD) {
        status = "ALERT";
        notes.push(
          `Win-rate ${(winRate * 100).toFixed(1)}% is below ALERT threshold ` +
            `(${(SWING_REGRESSION_CONFIG.WR_ALERT_THRESHOLD * 100).toFixed(0)}%).`,
        );
      } else if (winRate < SWING_REGRESSION_CONFIG.WR_WARN_THRESHOLD) {
        status = "WARN";
        notes.push(
          `Win-rate ${(winRate * 100).toFixed(1)}% is below WARN threshold ` +
            `(${(SWING_REGRESSION_CONFIG.WR_WARN_THRESHOLD * 100).toFixed(0)}%).`,
        );
      }
    }

    if (profitFactor != null && profitFactor < SWING_REGRESSION_CONFIG.PF_WARN_THRESHOLD) {
      if (status === "OK") status = "WARN";
      notes.push(
        `Profit-factor ${profitFactor.toFixed(2)} is below threshold ` +
          `(${SWING_REGRESSION_CONFIG.PF_WARN_THRESHOLD.toFixed(1)}).`,
      );
    }

    if (notes.length === 0) {
      notes.push("Autonomous swing edge is within acceptable thresholds.");
    }

    return {
      status,
      autonomousTradeCount: count,
      wins,
      losses,
      winRate,
      profitFactor,
      avgWinPnl,
      avgLossPnl,
      lookbackDays: SWING_REGRESSION_CONFIG.LOOKBACK_DAYS,
      computedAt: now.toISOString(),
      notes,
    };
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "checkSwingRegressionBaseline: DB query failed",
    );
    return {
      status: "INSUFFICIENT_DATA",
      autonomousTradeCount: 0,
      wins: 0,
      losses: 0,
      winRate: null,
      profitFactor: null,
      avgWinPnl: null,
      avgLossPnl: null,
      lookbackDays: SWING_REGRESSION_CONFIG.LOOKBACK_DAYS,
      computedAt: now.toISOString(),
      notes: ["DB query failed — see server logs."],
    };
  }
}
