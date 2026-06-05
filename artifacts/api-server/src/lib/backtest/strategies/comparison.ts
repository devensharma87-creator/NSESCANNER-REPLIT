/**
 * Backtest Lab V2 — pure, multi-factor strategy comparison & ranking.
 *
 * NEVER ranks on net profit alone. The composite score blends net P&L, profit
 * factor, win-rate, drawdown (inverted), average R, and consistency, each
 * min-max normalised across the strategies that clear a minimum-trades gate.
 * Strategies below the gate are reported but flagged ineligible (compositeScore
 * null) so a 2-trade fluke can never "win".
 */

import {
  ATM_DELTA,
  CHARGES_PER_LOT,
  SLIPPAGE_POINTS,
} from "./base";
import type { BacktestBlockedOut, BacktestTradeOut } from "../types";
import type {
  BacktestComparisonRowOut,
  BacktestRankingCardOut,
  BacktestStrategyAggregateOut,
  BacktestStrategyComparisonOut,
} from "../types";

export const MIN_TRADES_TO_RANK = 10;

export interface ComparisonUnit {
  strategyId: string;
  strategyName: string;
  indexSymbol: string;
  timeframe: string;
  trades: BacktestTradeOut[];
  blocked: BacktestBlockedOut[];
}

export interface ComparisonOptions {
  includeCharges: boolean;
  includeSlippage: boolean;
}

interface NetTrade {
  net: number;
  r: number | null;
  reachedT1: boolean;
  exitReason: string | null;
  entryAt: string | null;
  holdingMin: number | null;
}

function perTradeCharges(t: BacktestTradeOut, o: ComparisonOptions): number {
  const lots = t.lots ?? 0;
  const qty = t.qty ?? 0;
  const charges = o.includeCharges ? CHARGES_PER_LOT * lots : 0;
  // Round-trip slippage modeled in spot points × ATM delta × qty × 2 fills.
  const slip = o.includeSlippage ? SLIPPAGE_POINTS * ATM_DELTA * qty * 2 : 0;
  return charges + slip;
}

function toNetTrade(t: BacktestTradeOut, o: ComparisonOptions): NetTrade {
  const gross = t.pnl ?? 0;
  const net = gross - perTradeCharges(t, o);
  const params = (t.strategyParams ?? {}) as Record<string, unknown>;
  const r = typeof params["rMultiple"] === "number" ? (params["rMultiple"] as number) : null;
  const reachedT1 = params["reachedT1"] === true;
  let holdingMin: number | null = null;
  if (t.entryAt && t.exitAt) {
    const ms = new Date(t.exitAt).getTime() - new Date(t.entryAt).getTime();
    if (Number.isFinite(ms) && ms >= 0) holdingMin = ms / 60000;
  }
  return { net, r, reachedT1, exitReason: t.exitReason, entryAt: t.entryAt, holdingMin };
}

function maxDrawdown(netSeq: number[]): number {
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const x of netSeq) {
    equity += x;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

function profitFactor(nets: number[]): number | null {
  let gp = 0;
  let gl = 0;
  for (const x of nets) {
    if (x > 0) gp += x;
    else if (x < 0) gl += -x;
  }
  if (gl === 0) return gp > 0 ? null : null; // undefined PF (no losers) → reported as n/a
  return gp / gl;
}

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
  return Math.sqrt(v);
}

function classifyExit(nt: NetTrade): "T1" | "T2" | "SL" | "TIME" {
  switch (nt.exitReason) {
    case "STOP":
      return "SL";
    case "TARGET2":
      return "T2";
    case "TARGET1":
    case "TRAIL_STOP":
      return "T1";
    default:
      return nt.reachedT1 ? "T1" : "TIME";
  }
}

function buildRow(u: ComparisonUnit, o: ComparisonOptions): BacktestComparisonRowOut {
  const nts = u.trades.map((t) => toNetTrade(t, o));
  const nets = nts.map((x) => x.net);
  const total = nts.length;
  const winning = nets.filter((x) => x > 0).length;
  const losing = nets.filter((x) => x < 0).length;
  const grossPnl = u.trades.reduce((a, t) => a + (t.pnl ?? 0), 0);
  const charges = u.trades.reduce(
    (a, t) => a + (o.includeCharges ? CHARGES_PER_LOT * (t.lots ?? 0) : 0),
    0,
  );
  const slippage = u.trades.reduce(
    (a, t) => a + (o.includeSlippage ? SLIPPAGE_POINTS * ATM_DELTA * (t.qty ?? 0) * 2 : 0),
    0,
  );
  const netPnl = grossPnl - charges - slippage;
  const rs = nts.map((x) => x.r).filter((x): x is number => x != null);
  const holds = nts.map((x) => x.holdingMin).filter((x): x is number => x != null);
  let t1 = 0;
  let t2 = 0;
  let sl = 0;
  let time = 0;
  for (const nt of nts) {
    const k = classifyExit(nt);
    if (k === "T1") t1++;
    else if (k === "T2") t2++;
    else if (k === "SL") sl++;
    else time++;
  }
  const rejected = u.blocked
    .filter((b) => b.category === "FILTER")
    .reduce((a, b) => a + b.count, 0);
  const dataBlocked = u.blocked
    .filter((b) => b.category === "DATA")
    .reduce((a, b) => a + b.count, 0);
  const riskBlocked = u.blocked
    .filter((b) => b.category === "RISK")
    .reduce((a, b) => a + b.count, 0);

  return {
    strategyId: u.strategyId,
    strategyName: u.strategyName,
    indexSymbol: u.indexSymbol,
    timeframe: u.timeframe,
    totalTrades: total,
    winningTrades: winning,
    losingTrades: losing,
    winRate: total > 0 ? winning / total : null,
    grossPnl,
    charges,
    slippage,
    netPnl,
    profitFactor: profitFactor(nets),
    avgR: mean(rs),
    maxDrawdown: maxDrawdown(nets),
    bestTrade: nets.length ? Math.max(...nets) : null,
    worstTrade: nets.length ? Math.min(...nets) : null,
    avgHoldingMinutes: mean(holds),
    target1HitCount: t1,
    target2HitCount: t2,
    slHitCount: sl,
    timeExitCount: time,
    rejectedSetupCount: rejected,
    dataBlockedCount: dataBlocked,
    riskBlockedCount: riskBlocked,
  };
}

interface AggAccum {
  strategyId: string;
  strategyName: string;
  nts: NetTrade[];
}

function normalize(values: (number | null)[]): (number | null)[] {
  const finite = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (finite.length === 0) return values.map(() => null);
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  if (hi === lo) return values.map((v) => (v == null ? null : 0.5));
  return values.map((v) => (v == null ? null : (v - lo) / (hi - lo)));
}

export function buildComparison(
  units: ComparisonUnit[],
  o: ComparisonOptions,
): BacktestStrategyComparisonOut {
  const rows = units.map((u) => buildRow(u, o)).sort((a, b) => b.netPnl - a.netPnl);

  // Aggregate per strategy across all indices.
  const accum = new Map<string, AggAccum>();
  const dataBlockedByStrategy = new Map<string, number>();
  for (const u of units) {
    const a = accum.get(u.strategyId) ?? {
      strategyId: u.strategyId,
      strategyName: u.strategyName,
      nts: [],
    };
    for (const t of u.trades) a.nts.push(toNetTrade(t, o));
    accum.set(u.strategyId, a);
    const dataBlocked = u.blocked
      .filter((b) => b.category === "DATA")
      .reduce((s, b) => s + b.count, 0);
    dataBlockedByStrategy.set(
      u.strategyId,
      (dataBlockedByStrategy.get(u.strategyId) ?? 0) + dataBlocked,
    );
  }

  const aggRaw = Array.from(accum.values()).map((a) => {
    const chrono = [...a.nts].sort((x, y) => {
      const tx = x.entryAt ? new Date(x.entryAt).getTime() : 0;
      const ty = y.entryAt ? new Date(y.entryAt).getTime() : 0;
      return tx - ty;
    });
    const nets = chrono.map((x) => x.net);
    const wins = nets.filter((x) => x > 0).length;
    const total = nets.length;
    const netPnl = nets.reduce((s, x) => s + x, 0);
    const pf = profitFactor(nets);
    const dd = maxDrawdown(nets);
    const rs = chrono.map((x) => x.r).filter((x): x is number => x != null);
    const avgR = mean(rs);
    const sd = stdev(nets);
    const avgNet = mean(nets);
    const consistency = sd != null && sd > 0 && avgNet != null ? avgNet / sd : null;
    const dataBlocked = dataBlockedByStrategy.get(a.strategyId) ?? 0;
    const opportunities = total + dataBlocked;
    const dataQuality = opportunities > 0 ? total / opportunities : null;
    const eligible = total >= MIN_TRADES_TO_RANK;
    return {
      strategyId: a.strategyId,
      strategyName: a.strategyName,
      total,
      winRate: total > 0 ? wins / total : null,
      netPnl,
      pf,
      dd,
      avgR,
      consistency,
      dataQuality,
      eligible,
    };
  });

  // Composite score over ELIGIBLE strategies only (multi-factor, normalised).
  const eligibleIdx = aggRaw.map((a, i) => (a.eligible ? i : -1)).filter((i) => i >= 0);
  const pick = (sel: (a: (typeof aggRaw)[number]) => number | null) =>
    eligibleIdx.map((i) => sel(aggRaw[i]!));
  const nNet = normalize(pick((a) => a.netPnl));
  const nPf = normalize(pick((a) => a.pf));
  const nWin = normalize(pick((a) => a.winRate));
  const nDd = normalize(pick((a) => (a.dd != null ? -a.dd : null))); // less DD = better
  const nR = normalize(pick((a) => a.avgR));
  const nCons = normalize(pick((a) => a.consistency));
  const nDq = normalize(pick((a) => a.dataQuality)); // more executed-vs-data-blocked = better
  const W = { net: 0.25, pf: 0.2, win: 0.15, dd: 0.15, r: 0.1, cons: 0.1, dq: 0.05 };
  const composite = new Map<string, number>();
  eligibleIdx.forEach((idx, k) => {
    const parts: Array<[number, number]> = [
      [nNet[k]!, W.net],
      [nPf[k]!, W.pf],
      [nWin[k]!, W.win],
      [nDd[k]!, W.dd],
      [nR[k]!, W.r],
      [nCons[k]!, W.cons],
      [nDq[k]!, W.dq],
    ];
    let num = 0;
    let den = 0;
    for (const [v, w] of parts) {
      if (v != null && Number.isFinite(v)) {
        num += v * w;
        den += w;
      }
    }
    composite.set(aggRaw[idx]!.strategyId, den > 0 ? (num / den) * 100 : 0);
  });

  const byStrategy: BacktestStrategyAggregateOut[] = aggRaw
    .map((a) => ({
      strategyId: a.strategyId,
      strategyName: a.strategyName,
      totalTrades: a.total,
      winRate: a.winRate,
      netPnl: a.netPnl,
      profitFactor: a.pf,
      maxDrawdown: a.dd,
      avgR: a.avgR,
      consistency: a.consistency,
      dataQuality: a.dataQuality,
      compositeScore: composite.has(a.strategyId) ? composite.get(a.strategyId)! : null,
      eligible: a.eligible,
    }))
    .sort((x, y) => (y.compositeScore ?? -1) - (x.compositeScore ?? -1) || y.netPnl - x.netPnl);

  const ranking = buildRanking(byStrategy, rows, units);

  const notes: string[] = [];
  const timeframes = Array.from(new Set(units.map((u) => u.timeframe)));
  if (timeframes.length === 1) {
    notes.push(
      `Only the ${timeframes[0]} timeframe was tested — best/worst-timeframe ranking is not meaningful with a single timeframe.`,
    );
  }
  notes.push(
    `Composite ranking blends net P&L, profit factor, win-rate, drawdown, avg R and consistency; strategies with fewer than ${MIN_TRADES_TO_RANK} trades are ineligible to rank.`,
  );
  notes.push(
    "Option P&L uses a labeled ATM delta proxy (|Δ|≈0.5) on the real spot move — no historical option premiums exist.",
  );

  return { rows, byStrategy, ranking, notes };
}

function card(
  key: string,
  label: string,
  agg: BacktestStrategyAggregateOut | null,
  value: string | null,
  note: string | null,
): BacktestRankingCardOut {
  return {
    key,
    label,
    strategyId: agg?.strategyId ?? null,
    strategyName: agg?.strategyName ?? null,
    value,
    note,
  };
}

function buildRanking(
  byStrategy: BacktestStrategyAggregateOut[],
  rows: BacktestComparisonRowOut[],
  units: ComparisonUnit[],
): BacktestRankingCardOut[] {
  const eligible = byStrategy.filter((a) => a.eligible);
  const pool = eligible.length > 0 ? eligible : byStrategy;
  const cards: BacktestRankingCardOut[] = [];

  if (pool.length === 0) {
    cards.push(card("OVERALL", "Best Overall", null, null, "No strategies produced trades."));
    return cards;
  }

  const best = (sel: (a: BacktestStrategyAggregateOut) => number | null, dir: 1 | -1) =>
    [...pool]
      .filter((a) => sel(a) != null)
      .sort((x, y) => dir * ((sel(y) as number) - (sel(x) as number)))[0] ?? null;

  const overall = [...pool].sort(
    (x, y) => (y.compositeScore ?? -1) - (x.compositeScore ?? -1),
  )[0]!;
  cards.push(
    card(
      "OVERALL",
      "Best Overall (composite)",
      overall,
      overall.compositeScore != null ? `${overall.compositeScore.toFixed(1)}/100` : null,
      "Multi-factor — not net profit alone.",
    ),
  );

  const bestNet = best((a) => a.netPnl, 1);
  cards.push(card("NET_PNL", "Best Net P&L", bestNet, bestNet ? `₹${bestNet.netPnl.toFixed(0)}` : null, null));

  const bestWin = best((a) => a.winRate, 1);
  cards.push(
    card("WIN_RATE", "Best Win Rate", bestWin, bestWin?.winRate != null ? `${(bestWin.winRate * 100).toFixed(1)}%` : null, null),
  );

  const bestPf = best((a) => a.profitFactor, 1);
  cards.push(
    card("PROFIT_FACTOR", "Best Profit Factor", bestPf, bestPf?.profitFactor != null ? bestPf.profitFactor.toFixed(2) : null, null),
  );

  const lowDd = best((a) => (a.maxDrawdown != null ? -a.maxDrawdown : null), 1);
  cards.push(
    card("DRAWDOWN", "Lowest Drawdown", lowDd, lowDd ? `₹${lowDd.maxDrawdown.toFixed(0)}` : null, null),
  );

  const bestR = best((a) => a.avgR, 1);
  cards.push(card("AVG_R", "Best Avg R", bestR, bestR?.avgR != null ? `${bestR.avgR.toFixed(2)}R` : null, null));

  const mostStable = best((a) => a.consistency, 1);
  cards.push(
    card(
      "MOST_STABLE",
      "Most Stable",
      mostStable,
      mostStable?.consistency != null ? `${mostStable.consistency.toFixed(2)}` : null,
      "Mean per-trade net ÷ stdev — steadiest equity, not biggest.",
    ),
  );

  // Best strategy per index (by net P&L of that strategy×index row).
  for (const idx of ["NIFTY", "BANKNIFTY", "SENSEX"]) {
    const idxRows = rows.filter((r) => r.indexSymbol === idx && r.totalTrades > 0);
    if (idxRows.length === 0) continue;
    const top = [...idxRows].sort((a, b) => b.netPnl - a.netPnl)[0]!;
    cards.push({
      key: `BEST_${idx}`,
      label: `Best for ${idx}`,
      strategyId: top.strategyId,
      strategyName: top.strategyName,
      value: `₹${top.netPnl.toFixed(0)}`,
      note: null,
    });
  }

  // Timeframe ranking is honest about single-timeframe coverage.
  const timeframes = Array.from(new Set(units.map((u) => u.timeframe)));
  if (timeframes.length === 1) {
    cards.push(
      card("TIMEFRAME", "Timeframe Coverage", null, timeframes[0] ?? null, "Single timeframe tested — no best/worst timeframe comparison."),
    );
  } else {
    // Net P&L summed per timeframe (across every strategy×index row on that tf).
    const byTf = new Map<string, number>();
    for (const r of rows) byTf.set(r.timeframe, (byTf.get(r.timeframe) ?? 0) + r.netPnl);
    const tfRanked = Array.from(byTf.entries()).sort((a, b) => b[1] - a[1]);
    const top = tfRanked[0];
    const bottom = tfRanked[tfRanked.length - 1];
    if (top) {
      cards.push({
        key: "BEST_TIMEFRAME",
        label: "Best Timeframe",
        strategyId: null,
        strategyName: null,
        value: `${top[0]} (₹${top[1].toFixed(0)})`,
        note: "Summed net P&L across all strategies on this timeframe.",
      });
    }
    if (bottom && bottom[0] !== top?.[0]) {
      cards.push({
        key: "WORST_TIMEFRAME",
        label: "Worst Timeframe",
        strategyId: null,
        strategyName: null,
        value: `${bottom[0]} (₹${bottom[1].toFixed(0)})`,
        note: "Summed net P&L across all strategies on this timeframe.",
      });
    }
  }

  return cards;
}
