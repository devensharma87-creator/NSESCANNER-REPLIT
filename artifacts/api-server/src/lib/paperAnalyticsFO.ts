/**
 * F&O paper-trading strategy analytics.
 *
 * All metrics are computed from `paper_trade_fo` (status = CLOSED) —
 * no mocks, no projections. If there are zero closed trades the
 * response is shaped the same way but with empty arrays and zero
 * scalars, so the UI can render skeletons / empty-state copy without
 * special-casing missing fields.
 *
 * "R-multiple" is computed as realized_pnl / risk-per-trade, where
 * risk-per-trade = (entry_premium - stop_premium) * lots * lot_size.
 * If the row is missing stop_premium or it would yield risk <= 0 the
 * trade is excluded from the R-multiple aggregates (but still counted
 * for cumulative P&L, win-rate, and drawdown).
 */
import { db, paperTradeFoTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import type { PaperTradeFoRow } from "@workspace/db";

function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : parseFloat(v);
}

/**
 * Honest win-rate as a 0..1 fraction (4-dp), or `null` when there are no
 * decided trades (wins + losses === 0). Returning null — never a fabricated
 * 0% or 100% — lets the UI render "—" for an empty/undecided bucket. Pure.
 */
export function foWinRate(wins: number, losses: number): number | null {
  const decided = wins + losses;
  return decided > 0 ? +(wins / decided).toFixed(4) : null;
}

export interface FoAnalyticsBySetup {
  setupKey: string;
  trades: number;
  wins: number;
  losses: number;
  /** wins / (wins + losses); null when no decided trades (honest "—" in UI). */
  winRate: number | null;
  totalPnl: number;
  avgPnl: number;
  bestTrade: number;
  worstTrade: number;
}

export interface FoAnalyticsEquityPoint {
  date: string;            // IST signal date YYYY-MM-DD
  dailyPnl: number;
  cumulativePnl: number;
  drawdown: number;        // ₹ below running peak (negative or zero)
}

export interface FoAnalyticsResponse {
  totalTrades: number;
  wins: number;
  losses: number;
  scratches: number;
  winRate: number | null;   // 0..1; null when no decided trades
  totalRealizedPnl: number;
  avgWin: number;
  avgLoss: number;          // signed (negative)
  largestWin: number;
  largestLoss: number;      // signed (negative)
  profitFactor: number;     // sum(wins) / |sum(losses)|; Infinity → number cap
  expectancy: number;       // avg P&L per trade
  avgRMultiple: number | null;
  rMultipleSamples: number;
  maxDrawdown: number;      // negative
  currentDrawdown: number;  // negative or zero
  peakEquity: number;
  exitReasonCounts: Record<string, number>;
  bySetup: FoAnalyticsBySetup[];
  equityCurve: FoAnalyticsEquityPoint[];
  generatedAt: string;
  range: { from: string | null; to: string | null };
}

export async function getFoAnalytics(opts: {
  from?: string; // YYYY-MM-DD inclusive
  to?: string;   // YYYY-MM-DD inclusive
}): Promise<FoAnalyticsResponse> {
  // Pull all CLOSED rows ordered by exitedAt and filter date range in
  // JS. Volume is owner-only paper trades (bounded < 10k rows per year)
  // so the round-trip cost is negligible and avoids drizzle string-
  // comparator quirks on the signal_date column.
  const rows: PaperTradeFoRow[] = await db
    .select()
    .from(paperTradeFoTable)
    .where(eq(paperTradeFoTable.status, "CLOSED"))
    .orderBy(asc(paperTradeFoTable.exitedAt));

  const filtered = rows.filter(r => {
    if (opts.from && r.signalDate < opts.from) return false;
    if (opts.to && r.signalDate > opts.to) return false;
    return true;
  });

  const totalTrades = filtered.length;
  let wins = 0;
  let losses = 0;
  let scratches = 0;
  let totalRealizedPnl = 0;
  let sumWins = 0;
  let sumLosses = 0;
  let largestWin = 0;
  let largestLoss = 0;
  let rMultiplesSum = 0;
  let rMultiplesCount = 0;
  const exitReasonCounts: Record<string, number> = {};
  const bySetupMap = new Map<string, FoAnalyticsBySetup>();
  const dailyPnlMap = new Map<string, number>();

  for (const r of filtered) {
    const pnl = num(r.realizedPnl);
    totalRealizedPnl += pnl;
    if (pnl > 0) {
      wins++;
      sumWins += pnl;
      if (pnl > largestWin) largestWin = pnl;
    } else if (pnl < 0) {
      losses++;
      sumLosses += pnl; // sumLosses negative
      if (pnl < largestLoss) largestLoss = pnl;
    } else {
      scratches++;
    }

    const reason = r.exitReason ?? "EXPIRED";
    exitReasonCounts[reason] = (exitReasonCounts[reason] ?? 0) + 1;

    const entry = num(r.entryPremium);
    const stop = num(r.stopPremium);
    const lots = r.lots ?? 0;
    const lotSize = r.lotSize ?? 0;
    const riskPerTrade = (entry - stop) * lots * lotSize;
    if (Number.isFinite(riskPerTrade) && riskPerTrade > 0) {
      rMultiplesSum += pnl / riskPerTrade;
      rMultiplesCount++;
    }

    const key = r.setupKey || "UNKNOWN";
    const cur = bySetupMap.get(key) ?? {
      setupKey: key,
      trades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalPnl: 0,
      avgPnl: 0,
      bestTrade: 0,
      worstTrade: 0,
    };
    cur.trades++;
    cur.totalPnl += pnl;
    if (pnl > 0) cur.wins++;
    else if (pnl < 0) cur.losses++;
    if (pnl > cur.bestTrade) cur.bestTrade = pnl;
    if (pnl < cur.worstTrade) cur.worstTrade = pnl;
    bySetupMap.set(key, cur);

    const date = r.signalDate;
    dailyPnlMap.set(date, (dailyPnlMap.get(date) ?? 0) + pnl);
  }

  const winRate = foWinRate(wins, losses);
  const avgWin = wins > 0 ? sumWins / wins : 0;
  const avgLoss = losses > 0 ? sumLosses / losses : 0;
  const profitFactor =
    sumLosses < 0
      ? sumWins / Math.abs(sumLosses)
      : sumWins > 0
        ? Number.POSITIVE_INFINITY
        : 0;
  const expectancy = totalTrades > 0 ? totalRealizedPnl / totalTrades : 0;
  const avgRMultiple = rMultiplesCount > 0 ? rMultiplesSum / rMultiplesCount : null;

  // Equity curve + drawdown
  const sortedDates = Array.from(dailyPnlMap.keys()).sort();
  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const equityCurve: FoAnalyticsEquityPoint[] = sortedDates.map(date => {
    const dailyPnl = dailyPnlMap.get(date) ?? 0;
    cumulative += dailyPnl;
    if (cumulative > peak) peak = cumulative;
    const drawdown = cumulative - peak; // 0 or negative
    if (drawdown < maxDrawdown) maxDrawdown = drawdown;
    return {
      date,
      dailyPnl: round2(dailyPnl),
      cumulativePnl: round2(cumulative),
      drawdown: round2(drawdown),
    };
  });
  const currentDrawdown = equityCurve.length > 0
    ? equityCurve[equityCurve.length - 1]!.drawdown
    : 0;

  // Finalize per-setup stats
  const bySetup = Array.from(bySetupMap.values())
    .map(s => {
      return {
        ...s,
        winRate: foWinRate(s.wins, s.losses),
        totalPnl: round2(s.totalPnl),
        avgPnl: round2(s.trades > 0 ? s.totalPnl / s.trades : 0),
        bestTrade: round2(s.bestTrade),
        worstTrade: round2(s.worstTrade),
      };
    })
    .sort((a, b) => b.totalPnl - a.totalPnl);

  return {
    totalTrades,
    wins,
    losses,
    scratches,
    winRate: winRate == null ? null : +winRate.toFixed(4),
    totalRealizedPnl: round2(totalRealizedPnl),
    avgWin: round2(avgWin),
    avgLoss: round2(avgLoss),
    largestWin: round2(largestWin),
    largestLoss: round2(largestLoss),
    profitFactor: Number.isFinite(profitFactor) ? +profitFactor.toFixed(2) : 99.99,
    expectancy: round2(expectancy),
    avgRMultiple: avgRMultiple != null ? +avgRMultiple.toFixed(3) : null,
    rMultipleSamples: rMultiplesCount,
    maxDrawdown: round2(maxDrawdown),
    currentDrawdown: round2(currentDrawdown),
    peakEquity: round2(peak),
    exitReasonCounts,
    bySetup,
    equityCurve,
    generatedAt: new Date().toISOString(),
    range: { from: opts.from ?? null, to: opts.to ?? null },
  };
}

function round2(n: number): number {
  return Number.isFinite(n) ? +n.toFixed(2) : 0;
}
