/**
 * Swing Regression Baseline Gate (F-37).
 *
 * Queries the last LOOKBACK_DAYS (90) days of CLOSED autonomous equity paper
 * trades and computes win-rate / profit-factor metrics.
 *
 * Gate passes (ok = true) when EITHER:
 *   - tradeCount < MIN_SAMPLE (insufficient data — no gate failure yet)
 *   - winRate >= WR_FLOOR AND profitFactor >= PF_FLOOR
 *
 * Gate fails (ok = false) when sample is sufficient AND either metric
 * drops below its floor.
 *
 * "Autonomous" means BOTH:
 *   1. exit_reason IS NOT 'MANUAL_OVERRIDE'  — operator-influenced closes
 *      contaminate the scanner edge; exclude them.
 *   2. source IS NOT 'MANUAL_BUY'            — manually-opened positions don't
 *      reflect scanner quality; exclude them.
 *
 *  NULL exit_reason / source rows are treated as autonomous (no operator
 *  fingerprint → include them via `or(isNull, ne)`).
 *
 * Pure DB read — no mutations, no trading decisions.
 */
import { db, paperTradeEqTable } from "@workspace/db";
import { and, eq, ne, or, isNull, gte } from "drizzle-orm";
import { logger } from "./logger";

export const SWING_REGRESSION_CONFIG = {
  /** Rolling window for the regression check (calendar days). */
  LOOKBACK_DAYS: 90,
  /** Minimum closed autonomous trades required before the gate can fire. */
  MIN_SAMPLE: 10,
  /** Win-rate floor — gate fails when winRate < this AND sample >= MIN_SAMPLE. */
  WR_FLOOR: 0.45,
  /** Profit-factor floor — gate fails when PF < this AND sample >= MIN_SAMPLE. */
  PF_FLOOR: 2.0,
} as const;

export interface SwingRegressionResult {
  /** True = gate passes (system OK or insufficient data); false = regression detected. */
  ok: boolean;
  /** Total autonomous closed trades in the lookback window. */
  tradeCount: number;
  /** Win-rate (0–1) or null when tradeCount < MIN_SAMPLE. */
  winRate: number | null;
  /** Gross profit-factor or null when there are no losses or tradeCount < MIN_SAMPLE. */
  profitFactor: number | null;
  /** Human-readable reason when ok = false. */
  reason?: string;
  /** ISO timestamp when the check was computed. */
  computedAt: string;
}

/**
 * Compute swing regression health from the last LOOKBACK_DAYS days of
 * CLOSED autonomous equity paper trades.
 *
 * Autonomous = exit_reason != 'MANUAL_OVERRIDE' AND source != 'MANUAL_BUY'.
 * NULL exit_reason / source rows are treated as autonomous.
 */
export async function checkSwingRegressionBaseline(): Promise<SwingRegressionResult> {
  const now = new Date();
  const cutoff = new Date(
    now.getTime() - SWING_REGRESSION_CONFIG.LOOKBACK_DAYS * 24 * 3600 * 1000,
  );

  try {
    const rows = await db
      .select({ realizedPnl: paperTradeEqTable.realizedPnl })
      .from(paperTradeEqTable)
      .where(
        and(
          eq(paperTradeEqTable.status, "CLOSED"),
          gte(paperTradeEqTable.exitedAt, cutoff),
          // Exclude manual-override exits (operator influenced).
          or(
            isNull(paperTradeEqTable.exitReason),
            ne(paperTradeEqTable.exitReason, "MANUAL_OVERRIDE"),
          ),
          // Exclude manually-opened trades.
          or(
            isNull(paperTradeEqTable.source),
            ne(paperTradeEqTable.source, "MANUAL_BUY"),
          ),
        ),
      );

    const tradeCount = rows.length;

    // Insufficient data — gate passes trivially; return without metric
    // computation so the caller knows not to act on null metrics.
    if (tradeCount < SWING_REGRESSION_CONFIG.MIN_SAMPLE) {
      return {
        ok: true,
        tradeCount,
        winRate: null,
        profitFactor: null,
        computedAt: now.toISOString(),
      };
    }

    let wins = 0;
    let totalWinPnl = 0;
    let totalLossPnl = 0;

    for (const row of rows) {
      const pnl = row.realizedPnl != null ? Number(row.realizedPnl) : null;
      if (pnl == null || !Number.isFinite(pnl)) continue;
      if (pnl >= 0) {
        wins++;
        totalWinPnl += pnl;
      } else {
        totalLossPnl += Math.abs(pnl);
      }
    }

    const winRate = wins / tradeCount;
    const profitFactor = totalLossPnl > 0 ? totalWinPnl / totalLossPnl : null;

    const wrOk = winRate >= SWING_REGRESSION_CONFIG.WR_FLOOR;
    const pfOk = profitFactor == null || profitFactor >= SWING_REGRESSION_CONFIG.PF_FLOOR;
    const ok = wrOk && pfOk;

    const reasons: string[] = [];
    if (!wrOk) {
      reasons.push(
        `win-rate ${(winRate * 100).toFixed(1)}% < floor ${(SWING_REGRESSION_CONFIG.WR_FLOOR * 100).toFixed(0)}%`,
      );
    }
    if (!pfOk && profitFactor != null) {
      reasons.push(
        `profit-factor ${profitFactor.toFixed(2)} < floor ${SWING_REGRESSION_CONFIG.PF_FLOOR.toFixed(1)}`,
      );
    }

    return {
      ok,
      tradeCount,
      winRate,
      profitFactor,
      reason: reasons.length > 0 ? reasons.join("; ") : undefined,
      computedAt: now.toISOString(),
    };
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "checkSwingRegressionBaseline: DB query failed — returning ok=true (fail-open)",
    );
    // Fail-open: a DB error must NOT block the swing scanner.
    return {
      ok: true,
      tradeCount: 0,
      winRate: null,
      profitFactor: null,
      reason: "DB query failed — see server logs",
      computedAt: now.toISOString(),
    };
  }
}
