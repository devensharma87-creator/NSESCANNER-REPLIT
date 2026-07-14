/**
 * Swing Regression Gate (F-37)
 *
 * Detects silent degradation of the swing engine's historical
 * 61.3% WR / 5.05 PF performance by querying the last 90 days
 * of AUTONOMOUS closed trades from paper_trade_eq.
 *
 * Informational only — does NOT block auto-trades. Surfaces
 * degradation for owner review; actual blocking requires explicit
 * owner sign-off to prevent overfit.
 */
import { db, paperTradeEqTable } from "@workspace/db";
import { and, eq, gte, ne, isNotNull } from "drizzle-orm";
import { logger } from "./logger";

export interface SwingRegressionResult {
  /** True if at sufficient data and both WR and PF pass the floor. */
  ok: boolean;
  /** Win rate [0, 1]. 0 when tradeCount === 0. */
  winRate: number;
  /** Profit factor (sum_wins / sum_losses_abs). Infinity when no losing trades. */
  profitFactor: number;
  /** Number of AUTONOMOUS closed trades in the 90-day window. */
  tradeCount: number;
  /** Human-readable reason when ok=false and tradeCount >= MIN_SAMPLE. */
  reason?: string;
  /** How many days back the window looks. */
  windowDays: number;
  /** ISO timestamp of when this result was generated. */
  generatedAt: string;
}

/** Minimum trade count before the gate applies (below this → ok:true, insufficient data). */
const MIN_SAMPLE = 10;
/** Conservative WR floor (well below the 61% peak). */
const MIN_WIN_RATE = 0.45;
/** Conservative PF floor (well below the 5.05 peak). */
const MIN_PROFIT_FACTOR = 2.0;
/** Look-back window in days. */
const WINDOW_DAYS = 90;

/**
 * Query and compute swing regression metrics for the last 90 days of
 * AUTONOMOUS (non-MANUAL_BUY) closed equity trades.
 *
 * Returns ok:true when tradeCount < MIN_SAMPLE (insufficient data
 * to make a fair judgment — do not block on insufficient samples).
 */
export async function checkSwingRegressionBaseline(): Promise<SwingRegressionResult> {
  const generatedAt = new Date().toISOString();
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  let rows: { realizedPnl: string | null }[];
  try {
    rows = await db
      .select({ realizedPnl: paperTradeEqTable.realizedPnl })
      .from(paperTradeEqTable)
      .where(
        and(
          eq(paperTradeEqTable.status, "CLOSED"),
          ne(paperTradeEqTable.source, "MANUAL_BUY"),
          gte(paperTradeEqTable.openedAt, cutoff),
          isNotNull(paperTradeEqTable.realizedPnl),
        ),
      );
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "swingRegressionGate: DB query failed");
    return {
      ok: true,
      winRate: 0,
      profitFactor: 0,
      tradeCount: 0,
      reason: "DB query failed — gate fails open",
      windowDays: WINDOW_DAYS,
      generatedAt,
    };
  }

  const pnls = rows
    .filter((r) => r.realizedPnl !== null)
    .map((r) => parseFloat(r.realizedPnl!))
    .filter(Number.isFinite);
  const tradeCount = pnls.length;

  if (tradeCount < MIN_SAMPLE) {
    return {
      ok: true,
      winRate: 0,
      profitFactor: 0,
      tradeCount,
      reason: `Insufficient data (${tradeCount} < ${MIN_SAMPLE} trades in ${WINDOW_DAYS}d window)`,
      windowDays: WINDOW_DAYS,
      generatedAt,
    };
  }

  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const winRate = wins.length / tradeCount;
  const sumWins = wins.reduce((a, b) => a + b, 0);
  const sumLossAbs = losses.reduce((a, b) => a + Math.abs(b), 0);
  const profitFactor = sumLossAbs === 0 ? Infinity : sumWins / sumLossAbs;

  const reasons: string[] = [];
  if (winRate < MIN_WIN_RATE) {
    reasons.push(`WR ${(winRate * 100).toFixed(1)}% < floor ${(MIN_WIN_RATE * 100).toFixed(0)}%`);
  }
  if (Number.isFinite(profitFactor) && profitFactor < MIN_PROFIT_FACTOR) {
    reasons.push(`PF ${profitFactor.toFixed(2)} < floor ${MIN_PROFIT_FACTOR.toFixed(1)}`);
  }

  const ok = reasons.length === 0;
  return {
    ok,
    winRate,
    profitFactor,
    tradeCount,
    reason: ok ? undefined : `Degraded: ${reasons.join("; ")}`,
    windowDays: WINDOW_DAYS,
    generatedAt,
  };
}

export const SWING_REGRESSION_THRESHOLDS = {
  MIN_SAMPLE,
  MIN_WIN_RATE,
  MIN_PROFIT_FACTOR,
  WINDOW_DAYS,
} as const;
