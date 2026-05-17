/**
 * P17b — Shadow F&O cost analytics.
 *
 * READ-ONLY aggregator over `paper_trade_fo` rows. Applies the pure
 * cost model in `fnoCostModel.ts` to every CLOSED trade and groups
 * gross-vs-shadow-net P&L by setup, index, tier, and exit reason.
 * Also surfaces "would-be unprofitable" trades — closed positions
 * with positive gross P&L that turn negative after estimated costs.
 *
 * NEVER touches signal/exec/scheduler/sizing/gates/Kite/swing/equity/
 * scanner/strategy/combo/snapshot/candle paths. Pure projection of
 * existing trade rows; no schema change.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  FNO_COST_PARAMS,
  computeFnoTradeCost,
  isShadowCostsEnabled,
} from "./fnoCostModel";

function n(v: string | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : parseFloat(v);
}

export interface ShadowCostGroupRow {
  key: string;
  trades: number;
  computable: number;
  grossPnl: number;
  totalCost: number;
  netPnl: number;
  grossWinRate: number | null;
  netWinRate: number | null;
  avgCost: number;
  /** Trades whose sign flipped from gross-profit → net-loss after costs. */
  flippedToLoss: number;
}

export interface ShadowCostFlippedTrade {
  id: string;
  signalDate: string;
  indexSymbol: string;
  setupKey: string;
  tier: string | null;
  direction: string;
  exitReason: string | null;
  lots: number;
  lotSize: number;
  entryPremium: number;
  exitPremium: number | null;
  grossPnl: number;
  totalCost: number;
  netPnl: number;
  costPctOfPremium: number | null;
}

export interface ShadowCostReport {
  enabled: boolean;
  generatedAt: string;
  range: { from: string | null; to: string | null };
  rowCount: number;
  computableCount: number;
  totals: {
    grossPnl: number;
    totalCost: number;
    netPnl: number;
    avgCostPerTrade: number;
    avgCostPctOfPremium: number | null;
    grossWins: number;
    grossLosses: number;
    netWins: number;
    netLosses: number;
    flippedToLossCount: number;
  };
  bySetup: ShadowCostGroupRow[];
  byIndex: ShadowCostGroupRow[];
  byTier: ShadowCostGroupRow[];
  byExitReason: ShadowCostGroupRow[];
  flippedToLossTopN: ShadowCostFlippedTrade[];
  parameters: typeof FNO_COST_PARAMS;
}

interface Acc {
  trades: number;
  computable: number;
  grossPnl: number;
  totalCost: number;
  netPnl: number;
  grossWins: number;
  grossLosses: number;
  netWins: number;
  netLosses: number;
  flippedToLoss: number;
}
function newAcc(): Acc {
  return {
    trades: 0,
    computable: 0,
    grossPnl: 0,
    totalCost: 0,
    netPnl: 0,
    grossWins: 0,
    grossLosses: 0,
    netWins: 0,
    netLosses: 0,
    flippedToLoss: 0,
  };
}
function finalize(key: string, a: Acc): ShadowCostGroupRow {
  const totalGross = a.grossWins + a.grossLosses;
  const totalNet = a.netWins + a.netLosses;
  return {
    key,
    trades: a.trades,
    computable: a.computable,
    grossPnl: round2(a.grossPnl),
    totalCost: round2(a.totalCost),
    netPnl: round2(a.netPnl),
    grossWinRate: totalGross > 0 ? +(a.grossWins / totalGross).toFixed(4) : null,
    netWinRate: totalNet > 0 ? +(a.netWins / totalNet).toFixed(4) : null,
    avgCost: a.computable > 0 ? round2(a.totalCost / a.computable) : 0,
    flippedToLoss: a.flippedToLoss,
  };
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Compute the shadow cost report.
 *
 * @param opts.from / opts.to — IST date inclusive bounds (YYYY-MM-DD).
 * @param opts.topNFlipped — cap for the flipped-to-loss spotlight list.
 */
export async function computeShadowCostReport(opts: {
  from?: string;
  to?: string;
  topNFlipped?: number;
} = {}): Promise<ShadowCostReport> {
  const enabled = isShadowCostsEnabled();
  const topN = Math.max(1, Math.min(50, opts.topNFlipped ?? 10));

  // Pull all CLOSED rows in range, joined with option_signal_history
  // so we can group by `tier` (paper_trade_fo doesn't persist tier
  // directly — it lives on the upstream signal row, same join key
  // pattern as the rest of the F&O analytics surface).
  //
  // Owner-only paper book is bounded (~thousands per year) so a single
  // in-memory pass is fine. Read-only — no writes, no schema changes.
  const fromClause = opts.from ? sql` AND p.signal_date >= ${opts.from}` : sql``;
  const toClause = opts.to ? sql` AND p.signal_date <= ${opts.to}` : sql``;
  const result = (await db.execute(sql`
    SELECT
      p.id,
      p.signal_date,
      p.index_symbol,
      p.setup_key,
      p.direction,
      p.lots,
      p.lot_size,
      p.entry_premium,
      p.exit_premium,
      p.exit_reason,
      h.tier
      FROM paper_trade_fo p
      LEFT JOIN option_signal_history h
        ON h.signal_date = p.signal_date
       AND h.index_symbol = p.index_symbol
       AND h.setup_key = p.setup_key
       AND h.direction = p.direction
     WHERE p.status = 'CLOSED'${fromClause}${toClause}
  `)) as unknown as {
    rows: Array<{
      id: string;
      signal_date: string;
      index_symbol: string;
      setup_key: string;
      direction: string;
      lots: number | string | null;
      lot_size: number | string | null;
      entry_premium: string | null;
      exit_premium: string | null;
      exit_reason: string | null;
      tier: string | null;
    }>;
  };
  const rows = result.rows;

  const bySetup = new Map<string, Acc>();
  const byIndex = new Map<string, Acc>();
  const byTier = new Map<string, Acc>();
  const byExit = new Map<string, Acc>();
  const total = newAcc();
  const flipped: ShadowCostFlippedTrade[] = [];

  let computableCount = 0;
  let costPctSum = 0;
  let costPctSamples = 0;

  for (const r of rows) {
    const entry = n(r.entry_premium);
    const exit = r.exit_premium != null ? n(r.exit_premium) : null;
    const lots = Number(r.lots ?? 0);
    const lotSize = Number(r.lot_size ?? 0);

    const b = computeFnoTradeCost({
      entryPremium: entry,
      exitPremium: exit,
      lots,
      lotSize,
    });

    total.trades += 1;
    const setupAcc = bySetup.get(r.setup_key) ?? newAcc();
    setupAcc.trades += 1;
    bySetup.set(r.setup_key, setupAcc);
    const indexAcc = byIndex.get(r.index_symbol) ?? newAcc();
    indexAcc.trades += 1;
    byIndex.set(r.index_symbol, indexAcc);
    const tierKey = r.tier ?? "UNKNOWN";
    const tierAcc = byTier.get(tierKey) ?? newAcc();
    tierAcc.trades += 1;
    byTier.set(tierKey, tierAcc);
    const exitKey = r.exit_reason ?? "UNKNOWN";
    const exitAcc = byExit.get(exitKey) ?? newAcc();
    exitAcc.trades += 1;
    byExit.set(exitKey, exitAcc);

    if (!b.computable || b.grossPnl == null || b.netPnl == null) continue;
    computableCount += 1;

    const accs = [total, setupAcc, indexAcc, tierAcc, exitAcc];
    for (const a of accs) {
      a.computable += 1;
      a.grossPnl += b.grossPnl;
      a.totalCost += b.totalCost;
      a.netPnl += b.netPnl;
      if (b.grossPnl > 0) a.grossWins += 1;
      else if (b.grossPnl < 0) a.grossLosses += 1;
      if (b.netPnl > 0) a.netWins += 1;
      else if (b.netPnl < 0) a.netLosses += 1;
      if (b.grossPnl > 0 && b.netPnl <= 0) a.flippedToLoss += 1;
    }

    if (b.costPctOfPremium != null) {
      costPctSum += b.costPctOfPremium;
      costPctSamples += 1;
    }

    if (b.grossPnl > 0 && b.netPnl <= 0) {
      flipped.push({
        id: r.id,
        signalDate: r.signal_date,
        indexSymbol: r.index_symbol,
        setupKey: r.setup_key,
        tier: tierKey,
        direction: r.direction,
        exitReason: r.exit_reason,
        lots,
        lotSize,
        entryPremium: entry,
        exitPremium: exit,
        grossPnl: round2(b.grossPnl),
        totalCost: round2(b.totalCost),
        netPnl: round2(b.netPnl),
        costPctOfPremium:
          b.costPctOfPremium == null ? null : +(b.costPctOfPremium * 100).toFixed(3),
      });
    }
  }

  // Surface biggest flips first (largest gross→net swing).
  flipped.sort((a, b) => (b.grossPnl - b.netPnl) - (a.grossPnl - a.netPnl));

  const totals = {
    grossPnl: round2(total.grossPnl),
    totalCost: round2(total.totalCost),
    netPnl: round2(total.netPnl),
    avgCostPerTrade: computableCount > 0 ? round2(total.totalCost / computableCount) : 0,
    avgCostPctOfPremium:
      costPctSamples > 0 ? +((costPctSum / costPctSamples) * 100).toFixed(3) : null,
    grossWins: total.grossWins,
    grossLosses: total.grossLosses,
    netWins: total.netWins,
    netLosses: total.netLosses,
    flippedToLossCount: total.flippedToLoss,
  };

  return {
    enabled,
    generatedAt: new Date().toISOString(),
    range: { from: opts.from ?? null, to: opts.to ?? null },
    rowCount: rows.length,
    computableCount,
    totals,
    bySetup: Array.from(bySetup, ([k, v]) => finalize(k, v)).sort((a, b) => b.trades - a.trades),
    byIndex: Array.from(byIndex, ([k, v]) => finalize(k, v)).sort((a, b) => b.trades - a.trades),
    byTier: Array.from(byTier, ([k, v]) => finalize(k, v)).sort((a, b) => b.trades - a.trades),
    byExitReason: Array.from(byExit, ([k, v]) => finalize(k, v)).sort((a, b) => b.trades - a.trades),
    flippedToLossTopN: flipped.slice(0, topN),
    parameters: FNO_COST_PARAMS,
  };
}
