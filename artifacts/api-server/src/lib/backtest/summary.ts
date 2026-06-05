/**
 * Backtest Lab — pure performance-summary computation, shared by both modes.
 *
 * Honesty rules baked in:
 *   - winRate / profitFactor / averages / expectancy return `null` when their
 *     denominator is zero (no decided trades, no losers, etc.) — NEVER a
 *     fabricated 0 or 100.
 *   - Only trades with a finite `pnl` participate in stats (an undecided /
 *     no-captured-exit trade contributes nothing).
 *   - The equity curve is built strictly in exit-time order, walking forward —
 *     no look-ahead.
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

/** A trade is "decided" only when it carries a finite realized P&L. */
export function decidedTrades(trades: BacktestTradeOut[]): BacktestTradeOut[] {
  return trades.filter((t) => typeof t.pnl === "number" && Number.isFinite(t.pnl));
}

function instrumentStats(decided: BacktestTradeOut[]): BacktestInstrumentStat[] {
  const map = new Map<string, { trades: number; pnl: number; wins: number; decided: number }>();
  for (const t of decided) {
    const k = t.indexSymbol;
    const cur = map.get(k) ?? { trades: 0, pnl: 0, wins: 0, decided: 0 };
    cur.trades += 1;
    cur.pnl += t.pnl as number;
    cur.decided += 1;
    if ((t.pnl as number) > EPS) cur.wins += 1;
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

function equityCurve(
  decided: BacktestTradeOut[],
  startingCapital: number,
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
    equity += t.pnl as number;
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
  let grossProfit = 0;
  let grossLoss = 0; // positive magnitude
  let longTrades = 0;
  let shortTrades = 0;
  let best: number | null = null;
  let worst: number | null = null;

  for (const t of decided) {
    const p = t.pnl as number;
    if (p > EPS) {
      wins += 1;
      grossProfit += p;
    } else if (p < -EPS) {
      losses += 1;
      grossLoss += -p;
    } else {
      breakeven += 1;
    }
    if (isLong(t.direction)) longTrades += 1;
    else shortTrades += 1;
    if (best === null || p > best) best = p;
    if (worst === null || p < worst) worst = p;
  }

  const totalPnl = grossProfit - grossLoss;
  const { curve, maxDrawdown } = equityCurve(decided, startingCapital);

  const winRate = totalTrades > 0 ? round2((wins / totalTrades) * 100) : null;
  const profitFactor = grossLoss > EPS ? round2(grossProfit / grossLoss) : null;
  const avgWin = wins > 0 ? round2(grossProfit / wins) : null;
  const avgLoss = losses > 0 ? round2(grossLoss / losses) : null;
  const avgTradePnl = totalTrades > 0 ? round2(totalPnl / totalTrades) : null;
  // Expectancy = (winRate·avgWin) − (lossRate·avgLoss). Needs at least one trade.
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

  return {
    totalTrades,
    wins,
    losses,
    breakeven,
    winRate,
    totalPnl: round2(totalPnl),
    grossProfit: round2(grossProfit),
    grossLoss: round2(grossLoss),
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
  };
}
