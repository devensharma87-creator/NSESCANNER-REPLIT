/**
 * Backtest Lab — pure performance-summary computation, shared by all modes.
 *
 * Honesty rules baked in:
 *   - winRate / profitFactor / averages / expectancy return `null` when their
 *     denominator is zero (no decided trades, no losers, etc.) — NEVER a
 *     fabricated 0 or 100.
 *   - Only trades with a finite `pnl` participate in stats (an undecided /
 *     no-captured-exit trade contributes nothing).
 *   - The equity curve is built strictly in exit-time order, walking forward —
 *     no look-ahead.
 *   - When charges have been applied (Mode A/B/C with `chargesBreakdown`, or
 *     Mode D with `costs`), all P&L metrics and the equity curve use the NET
 *     (post-charges) value. Gross totals are reported separately so the user
 *     can see the cost drag.
 */

import type {
  BacktestEquityPoint,
  BacktestInstrumentStat,
  BacktestSummaryOut,
  BacktestTradeOut,
} from "./types";

const EPS = 1e-9;

function isLong(direction: string): boolean {
  const d = direction.toUpperCase();
  return d === "LONG" || d === "BULLISH" || d === "BUY" || d === "CALL";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Effective (net) P&L for a trade:
 *   - Uses `netPnl` when it has been populated (Modes A/B/C with charges
 *     applied, or Mode D where netPnl == pnl == net).
 *   - Falls back to `pnl` for backward compat (old runs without charges, or
 *     Mode D trades whose netPnl field wasn't explicitly set).
 */
function effectivePnl(t: BacktestTradeOut): number {
  if (t.netPnl != null && Number.isFinite(t.netPnl)) return t.netPnl;
  return t.pnl as number;
}

/**
 * Gross (pre-charges) P&L for a trade:
 *   - Uses `grossPnl` when set (Mode D or Modes A/B/C after charges applied).
 *   - Falls back to `pnl` when grossPnl is not set (runs without charges, or
 *     Mode A/B/C pre-charges-feature).
 */
function grossPnlOf(t: BacktestTradeOut): number {
  if (t.grossPnl != null && Number.isFinite(t.grossPnl)) return t.grossPnl;
  return t.pnl as number;
}

/** True when this trade has charges computed (Mode D uses `costs`, A/B/C use `chargesBreakdown`). */
function hasTradeCharges(t: BacktestTradeOut): boolean {
  return (t.chargesBreakdown?.computable === true) || (t.costs != null);
}

/** A trade is "decided" only when it carries a finite realized P&L. */
export function decidedTrades(trades: BacktestTradeOut[]): BacktestTradeOut[] {
  return trades.filter((t) => typeof t.pnl === "number" && Number.isFinite(t.pnl));
}

function instrumentStats(decided: BacktestTradeOut[]): BacktestInstrumentStat[] {
  const map = new Map<string, { trades: number; pnl: number; wins: number; decided: number }>();
  for (const t of decided) {
    const k = t.indexSymbol;
    const cur = map.get(k) ?? { trades: 0, pnl: 0, wins: 0, decided: 0 };
    const p = effectivePnl(t);
    cur.trades += 1;
    cur.pnl += p;
    cur.decided += 1;
    if (p > EPS) cur.wins += 1;
    map.set(k, cur);
  }
  return Array.from(map.entries())
    .map(([instrument, v]) => ({
      instrument,
      trades: v.trades,
      pnl: round2(v.pnl),
      winRate: v.decided > 0 ? round2((v.wins / v.decided) * 100) : null,
    }))
    .sort((a, b) => b.pnl - a.pnl);
}

function buildEquityCurve(
  decided: BacktestTradeOut[],
  startingCapital: number,
  pnlFn: (t: BacktestTradeOut) => number,
): { curve: BacktestEquityPoint[]; maxDrawdown: number } {
  // Stable sort by exit time (undated exits keep input order, after dated ones).
  const ordered = [...decided].sort((a, b) => {
    const ta = a.exitAt ? Date.parse(a.exitAt) : Number.POSITIVE_INFINITY;
    const tb = b.exitAt ? Date.parse(b.exitAt) : Number.POSITIVE_INFINITY;
    return ta - tb;
  });

  const curve: BacktestEquityPoint[] = [];
  let equity = startingCapital;
  let peak = startingCapital;
  let maxDd = 0;
  for (const t of ordered) {
    equity += pnlFn(t);
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? peak - equity : 0;
    if (dd > maxDd) maxDd = dd;
    curve.push({
      t: t.exitAt ?? "",
      equity: round2(equity),
      drawdown: round2(dd),
    });
  }
  return { curve, maxDrawdown: round2(maxDd) };
}

export function computeSummary(
  trades: BacktestTradeOut[],
  startingCapital: number,
): BacktestSummaryOut {
  const decided = decidedTrades(trades);
  const totalTrades = decided.length;

  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let netWinSum = 0;  // sum of winning effectivePnl
  let netLossSum = 0; // sum of losing effectivePnl magnitudes (positive)
  let longTrades = 0;
  let shortTrades = 0;
  let best: number | null = null;
  let worst: number | null = null;
  let sumGrossPnl = 0;
  let sumNetPnl = 0;
  let anyCharges = false;

  for (const t of decided) {
    const p = effectivePnl(t);
    const g = grossPnlOf(t);
    sumGrossPnl += g;
    sumNetPnl += p;
    if (hasTradeCharges(t)) anyCharges = true;

    if (p > EPS) {
      wins += 1;
      netWinSum += p;
    } else if (p < -EPS) {
      losses += 1;
      netLossSum += -p;
    } else {
      breakeven += 1;
    }
    if (isLong(t.direction)) longTrades += 1;
    else shortTrades += 1;
    if (best === null || p > best) best = p;
    if (worst === null || p < worst) worst = p;
  }

  const totalPnl = sumNetPnl;

  // Primary equity curve uses net P&L (post-charges when applied).
  const { curve, maxDrawdown } = buildEquityCurve(decided, startingCapital, effectivePnl);

  // Gross equity curve — only computed when charges differ from net.
  let grossMaxDrawdown: number | undefined;
  if (anyCharges) {
    const grossEc = buildEquityCurve(decided, startingCapital, grossPnlOf);
    if (grossEc.maxDrawdown !== maxDrawdown) {
      grossMaxDrawdown = grossEc.maxDrawdown;
    }
  }

  const winRate = totalTrades > 0 ? round2((wins / totalTrades) * 100) : null;
  const profitFactor = netLossSum > EPS ? round2(netWinSum / netLossSum) : null;
  const avgWin = wins > 0 ? round2(netWinSum / wins) : null;
  const avgLoss = losses > 0 ? round2(netLossSum / losses) : null;
  const avgTradePnl = totalTrades > 0 ? round2(totalPnl / totalTrades) : null;
  const expectancy =
    totalTrades > 0
      ? round2(
          (wins / totalTrades) * (avgWin ?? 0) -
            (losses / totalTrades) * (avgLoss ?? 0),
        )
      : null;
  const returnPct =
    startingCapital > 0 && totalTrades > 0
      ? round2((totalPnl / startingCapital) * 100)
      : null;

  const totalGrossPnlVal = round2(sumGrossPnl);
  const totalNetPnlVal = round2(sumNetPnl);
  const totalCostsVal = round2(sumGrossPnl - sumNetPnl);

  return {
    totalTrades,
    wins,
    losses,
    breakeven,
    winRate,
    totalPnl: round2(totalPnl),
    // NOTE: grossProfit/grossLoss are accounting terms here (winning/losing net sums),
    // NOT "pre-charges". They are used internally for profitFactor etc.
    grossProfit: round2(netWinSum),
    grossLoss: round2(netLossSum),
    profitFactor,
    avgWin,
    avgLoss,
    avgTradePnl,
    expectancy,
    maxDrawdown,
    returnPct,
    longTrades,
    shortTrades,
    bestTradePnl: best === null ? null : round2(best),
    worstTradePnl: worst === null ? null : round2(worst),
    byInstrument: instrumentStats(decided),
    equityCurve: curve,
    // Gross/net breakdown — populated for all modes when charges were applied.
    totalGrossPnl: anyCharges ? totalGrossPnlVal : undefined,
    totalCosts: anyCharges ? totalCostsVal : undefined,
    totalNetPnl: anyCharges ? totalNetPnlVal : undefined,
    grossMaxDrawdown: grossMaxDrawdown ?? undefined,
    chargesApplied: anyCharges,
  };
}
