/**
 * P20 — Shadow F&O exit-rule simulation (read-only).
 *
 * Compares the realised exit on every CLOSED `paper_trade_fo` row against
 * four hypothetical exit-management rules:
 *
 *   Rule 1: T1=+30% / T2=+60% of option entry premium.
 *           Sim books full size at +60% if MFE ≥ 60%, else at +30% if
 *           MFE ≥ 30%, else at the actual realised exit.
 *
 *   Rule 2: Book 50% at +30% premium move, trail remaining 50% to
 *           breakeven (BE = entry). Remaining half exits at actual
 *           exit_premium, but floored at entry (breakeven trail).
 *
 *   Rule 3: Book 50% at +50% premium move, trail remaining 50% to BE.
 *
 *   Rule 4: No partial; trail full size to BE once MFE ≥ +50%. If MFE
 *           never reached +50%, fall through to actual exit.
 *
 * STRICT GUARDRAILS:
 *   - Pure projection over existing trade rows. Never writes.
 *   - Never reads or alters target1/target2/exit/realized_pnl/status.
 *   - Cannot influence any live trading decision. Reporting only.
 *
 * LIMITATION:
 *   We only have entry_premium, exit_premium, max_runup, max_drawdown
 *   per trade — NOT the full intra-trade premium tick path. So the
 *   simulator can only know whether a level was touched (via MFE/MAE),
 *   not the order in which levels were touched relative to the actual
 *   exit. Two consequences:
 *     1. For Rules 2/3 (partial then trail-to-BE), we assume the
 *        partial booking always *precedes* the final exit if MFE
 *        crossed the partial threshold. This is optimistic for trades
 *        where the partial level was touched only AFTER the final exit
 *        already happened, but for STOPPED / TIME_EXIT_1520 / EXPIRED
 *        trades the level had to be touched before the close to count.
 *     2. For Rules 2/3/4 trail-to-BE, we assume BE holds once armed —
 *        i.e. remaining size exits at MAX(entry, actual_exit_premium).
 *        This is also slightly optimistic. We surface these caveats in
 *        the report.
 *
 *   Trades with `max_runup == 0` AND `max_drawdown == 0` predate the
 *   P20 MFE/MAE-logging fix (max_runup/drawdown were stuck at 0). For
 *   these, MFE is approximated by max(0, exit_premium - entry_premium)
 *   * qty (a strict lower bound — actual peak was ≥ this). The row is
 *   flagged `mfeAvailable: false` so the UI can dim it.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

function n(v: string | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : parseFloat(v);
}
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** Feature-flag mirror of `isShadowCostsEnabled`. Default ON. Reporting-only. */
export function isShadowExitsEnabled(): boolean {
  const v = process.env.PAPER_FO_SHADOW_EXITS_ENABLED;
  if (v == null) return true;
  const norm = v.trim().toLowerCase();
  if (norm === "") return true;
  if (["0", "false", "no", "off"].includes(norm)) return false;
  return true;
}

export type ShadowRuleId = "RULE_1" | "RULE_2" | "RULE_3" | "RULE_4";

export interface ShadowRuleParams {
  /** Rule 1 hard targets, as fraction of entry premium. */
  rule1: { t1Pct: number; t2Pct: number };
  /** Rule 2: partial-booking pct & partial fraction. Trail remainder to BE. */
  rule2: { triggerPct: number; partialFrac: number };
  rule3: { triggerPct: number; partialFrac: number };
  /** Rule 4: trail-to-BE arm threshold (no partial). */
  rule4: { armPct: number };
}

export const SHADOW_RULE_PARAMS: ShadowRuleParams = {
  rule1: { t1Pct: 0.3, t2Pct: 0.6 },
  rule2: { triggerPct: 0.3, partialFrac: 0.5 },
  rule3: { triggerPct: 0.5, partialFrac: 0.5 },
  rule4: { armPct: 0.5 },
};

interface TradeInput {
  /** Entry premium per share. */
  entry: number;
  /** Actual realised exit premium per share, or null if OPEN (skipped upstream). */
  exit: number;
  /** Total shares = lots * lotSize. */
  qty: number;
  /** Peak unrealised P&L observed in rupees (≥ 0). */
  mfeAbs: number;
  /** Whether the row predates the P20 MFE/MAE fix (mfeAbs is approximate). */
  mfeAvailable: boolean;
}

/**
 * Pure rule evaluator. Returns simulated rupee P&L for one trade under
 * one rule. Exported for unit-testability.
 */
export function simulateRule(
  rule: ShadowRuleId,
  t: TradeInput,
  params: ShadowRuleParams = SHADOW_RULE_PARAMS,
): number {
  const { entry, exit, qty, mfeAbs } = t;
  if (entry <= 0 || qty <= 0) return 0;
  const actualPnl = (exit - entry) * qty;
  // Convert MFE rupees back to a per-share premium gain pct.
  const peakPremiumGain = mfeAbs / qty; // rupees per share
  const peakPct = peakPremiumGain / entry; // fraction of entry

  if (rule === "RULE_1") {
    const { t1Pct, t2Pct } = params.rule1;
    if (peakPct >= t2Pct) return entry * t2Pct * qty;
    if (peakPct >= t1Pct) return entry * t1Pct * qty;
    return actualPnl;
  }

  if (rule === "RULE_2" || rule === "RULE_3") {
    const { triggerPct, partialFrac } =
      rule === "RULE_2" ? params.rule2 : params.rule3;
    if (peakPct >= triggerPct) {
      const partialPnl = entry * triggerPct * qty * partialFrac;
      // Remainder trails to BE: exits at max(entry, actual exit).
      const remainderExit = Math.max(entry, exit);
      const remainderPnl = (remainderExit - entry) * qty * (1 - partialFrac);
      return partialPnl + remainderPnl;
    }
    return actualPnl;
  }

  if (rule === "RULE_4") {
    const { armPct } = params.rule4;
    if (peakPct >= armPct) {
      // BE-trail armed: exit at max(entry, actual).
      const trailedExit = Math.max(entry, exit);
      return (trailedExit - entry) * qty;
    }
    return actualPnl;
  }

  return actualPnl;
}

export interface ShadowExitGroupRow {
  key: string;
  trades: number;
  mfeAvailableCount: number;
  actualPnl: number;
  rule1Pnl: number;
  rule2Pnl: number;
  rule3Pnl: number;
  rule4Pnl: number;
  /** Per-rule deltas vs actual (sum across trades in group). */
  rule1Delta: number;
  rule2Delta: number;
  rule3Delta: number;
  rule4Delta: number;
  /** Per-rule "improved" / "reduced" counts (vs actual). */
  rule1Better: number;
  rule1Worse: number;
  rule2Better: number;
  rule2Worse: number;
  rule3Better: number;
  rule3Worse: number;
  rule4Better: number;
  rule4Worse: number;
}

export interface ShadowExitTradeRow {
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
  exitPremium: number;
  mfeAbs: number;
  mfeAvailable: boolean;
  actualPnl: number;
  rule1Pnl: number;
  rule2Pnl: number;
  rule3Pnl: number;
  rule4Pnl: number;
  /** Best of the four rules vs actual (positive = improvement). */
  bestRule: ShadowRuleId;
  bestDelta: number;
}

export interface ShadowExitReport {
  enabled: boolean;
  generatedAt: string;
  range: { from: string | null; to: string | null };
  /**
   * @deprecated Alias of `processedRowCount`; retained for back-compat with
   * the existing UI. Prefer `rawRowCount` / `processedRowCount`.
   */
  rowCount: number;
  /** Raw CLOSED rows returned by the SQL query (pre-validation). */
  rawRowCount: number;
  /** Rows that passed entry>0 && qty>0 and contributed to aggregation. */
  processedRowCount: number;
  mfeAvailableCount: number;
  /** True when fewer than this many trades had post-P20 MFE data. */
  lowSampleWarning: boolean;
  lowSampleThreshold: number;
  totals: {
    actualPnl: number;
    rule1Pnl: number;
    rule2Pnl: number;
    rule3Pnl: number;
    rule4Pnl: number;
    rule1Delta: number;
    rule2Delta: number;
    rule3Delta: number;
    rule4Delta: number;
    rule1Better: number;
    rule1Worse: number;
    rule2Better: number;
    rule2Worse: number;
    rule3Better: number;
    rule3Worse: number;
    rule4Better: number;
    rule4Worse: number;
    bestRule: ShadowRuleId | null;
    bestRuleDelta: number;
  };
  bySetup: ShadowExitGroupRow[];
  byIndex: ShadowExitGroupRow[];
  byTier: ShadowExitGroupRow[];
  improvedTopN: ShadowExitTradeRow[];
  reducedTopN: ShadowExitTradeRow[];
  parameters: ShadowRuleParams;
  limitations: string[];
}

const LOW_SAMPLE_THRESHOLD = 20;

function newGroup(): ShadowExitGroupRow {
  return {
    key: "",
    trades: 0,
    mfeAvailableCount: 0,
    actualPnl: 0,
    rule1Pnl: 0,
    rule2Pnl: 0,
    rule3Pnl: 0,
    rule4Pnl: 0,
    rule1Delta: 0,
    rule2Delta: 0,
    rule3Delta: 0,
    rule4Delta: 0,
    rule1Better: 0,
    rule1Worse: 0,
    rule2Better: 0,
    rule2Worse: 0,
    rule3Better: 0,
    rule3Worse: 0,
    rule4Better: 0,
    rule4Worse: 0,
  };
}

function finalizeGroup(key: string, g: ShadowExitGroupRow): ShadowExitGroupRow {
  return {
    ...g,
    key,
    actualPnl: round2(g.actualPnl),
    rule1Pnl: round2(g.rule1Pnl),
    rule2Pnl: round2(g.rule2Pnl),
    rule3Pnl: round2(g.rule3Pnl),
    rule4Pnl: round2(g.rule4Pnl),
    rule1Delta: round2(g.rule1Delta),
    rule2Delta: round2(g.rule2Delta),
    rule3Delta: round2(g.rule3Delta),
    rule4Delta: round2(g.rule4Delta),
  };
}

/**
 * Build the shadow-exit report.
 *
 * @param opts.from / opts.to — IST date inclusive bounds (YYYY-MM-DD).
 * @param opts.topN — cap for improved/reduced spotlight lists.
 */
/** Raw row shape consumed by {@link aggregateShadowExits}. Exposed for tests
 *  so the pure aggregation logic can run without a live DB. */
export interface ShadowExitRawRow {
  id: string;
  signal_date: string;
  index_symbol: string;
  setup_key: string;
  direction: string;
  lots: number | string | null;
  lot_size: number | string | null;
  entry_premium: string | number | null;
  exit_premium: string | number | null;
  exit_reason: string | null;
  max_runup: string | number | null;
  max_drawdown: string | number | null;
  tier: string | null;
}

export function aggregateShadowExits(
  rows: ShadowExitRawRow[],
  opts: { topN?: number; from?: string; to?: string; enabled?: boolean } = {},
): ShadowExitReport {
  const enabled = opts.enabled ?? true;
  const topN = Math.max(1, Math.min(50, opts.topN ?? 10));
  return aggregateImpl(rows, { enabled, topN, from: opts.from, to: opts.to });
}

export async function computeShadowExitReport(opts: {
  from?: string;
  to?: string;
  topN?: number;
} = {}): Promise<ShadowExitReport> {
  const enabled = isShadowExitsEnabled();
  const topN = Math.max(1, Math.min(50, opts.topN ?? 10));

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
      p.max_runup,
      p.max_drawdown,
      h.tier
      FROM paper_trade_fo p
      LEFT JOIN option_signal_history h
        ON h.signal_date = p.signal_date
       AND h.index_symbol = p.index_symbol
       AND h.setup_key = p.setup_key
       AND h.direction = p.direction
     WHERE p.status = 'CLOSED'
       AND p.exit_premium IS NOT NULL${fromClause}${toClause}
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
      max_runup: string | null;
      max_drawdown: string | null;
      tier: string | null;
    }>;
  };

  return aggregateImpl(result.rows, { enabled, topN, from: opts.from, to: opts.to });
}

function aggregateImpl(
  rows: ShadowExitRawRow[],
  ctx: { enabled: boolean; topN: number; from?: string; to?: string },
): ShadowExitReport {
  const { enabled, topN } = ctx;
  const bySetup = new Map<string, ShadowExitGroupRow>();
  const byIndex = new Map<string, ShadowExitGroupRow>();
  const byTier = new Map<string, ShadowExitGroupRow>();
  const total = newGroup();
  const allTrades: ShadowExitTradeRow[] = [];
  let mfeAvailableCount = 0;

  for (const r of rows) {
    const entry = n(r.entry_premium);
    const exit = n(r.exit_premium);
    const lots = Number(r.lots ?? 0);
    const lotSize = Number(r.lot_size ?? 0);
    const qty = lots * lotSize;
    if (entry <= 0 || qty <= 0) continue;

    const maxRunup = n(r.max_runup);
    const maxDrawdown = n(r.max_drawdown);
    // P20 MFE-fix detector: rows that never had MFE/MAE logged sit at
    // exactly 0/0. Real post-fix rows almost always show a non-zero
    // drawdown (any intra-bar tick against the position records it),
    // so 0/0 is a reliable predicate for "pre-fix or no-tick row".
    const mfeAvailable = !(maxRunup === 0 && maxDrawdown === 0);
    if (mfeAvailable) mfeAvailableCount += 1;
    // Pre-fix approximation: use realised gain as a strict lower bound
    // on MFE. If the trade ended at +X, MFE was at least +X.
    const mfeAbs = mfeAvailable ? Math.max(0, maxRunup) : Math.max(0, (exit - entry) * qty);

    const tInput: TradeInput = { entry, exit, qty, mfeAbs, mfeAvailable };

    const actualPnl = (exit - entry) * qty;
    const rule1 = simulateRule("RULE_1", tInput);
    const rule2 = simulateRule("RULE_2", tInput);
    const rule3 = simulateRule("RULE_3", tInput);
    const rule4 = simulateRule("RULE_4", tInput);

    const rule1Delta = rule1 - actualPnl;
    const rule2Delta = rule2 - actualPnl;
    const rule3Delta = rule3 - actualPnl;
    const rule4Delta = rule4 - actualPnl;

    const deltas: Array<[ShadowRuleId, number]> = [
      ["RULE_1", rule1Delta],
      ["RULE_2", rule2Delta],
      ["RULE_3", rule3Delta],
      ["RULE_4", rule4Delta],
    ];
    deltas.sort((a, b) => b[1] - a[1]);
    const [bestRule, bestDelta] = deltas[0]!;

    const tradeRow: ShadowExitTradeRow = {
      id: r.id,
      signalDate: r.signal_date,
      indexSymbol: r.index_symbol,
      setupKey: r.setup_key,
      tier: r.tier ?? null,
      direction: r.direction,
      exitReason: r.exit_reason,
      lots,
      lotSize,
      entryPremium: entry,
      exitPremium: exit,
      mfeAbs: round2(mfeAbs),
      mfeAvailable,
      actualPnl: round2(actualPnl),
      rule1Pnl: round2(rule1),
      rule2Pnl: round2(rule2),
      rule3Pnl: round2(rule3),
      rule4Pnl: round2(rule4),
      bestRule,
      bestDelta: round2(bestDelta),
    };
    allTrades.push(tradeRow);

    const groups: ShadowExitGroupRow[] = [total];
    const setupAcc = bySetup.get(r.setup_key) ?? newGroup();
    bySetup.set(r.setup_key, setupAcc);
    groups.push(setupAcc);
    const indexAcc = byIndex.get(r.index_symbol) ?? newGroup();
    byIndex.set(r.index_symbol, indexAcc);
    groups.push(indexAcc);
    const tierKey = r.tier ?? "UNKNOWN";
    const tierAcc = byTier.get(tierKey) ?? newGroup();
    byTier.set(tierKey, tierAcc);
    groups.push(tierAcc);

    for (const g of groups) {
      g.trades += 1;
      if (mfeAvailable) g.mfeAvailableCount += 1;
      g.actualPnl += actualPnl;
      g.rule1Pnl += rule1;
      g.rule2Pnl += rule2;
      g.rule3Pnl += rule3;
      g.rule4Pnl += rule4;
      g.rule1Delta += rule1Delta;
      g.rule2Delta += rule2Delta;
      g.rule3Delta += rule3Delta;
      g.rule4Delta += rule4Delta;
      if (rule1Delta > 0.005) g.rule1Better += 1;
      else if (rule1Delta < -0.005) g.rule1Worse += 1;
      if (rule2Delta > 0.005) g.rule2Better += 1;
      else if (rule2Delta < -0.005) g.rule2Worse += 1;
      if (rule3Delta > 0.005) g.rule3Better += 1;
      else if (rule3Delta < -0.005) g.rule3Worse += 1;
      if (rule4Delta > 0.005) g.rule4Better += 1;
      else if (rule4Delta < -0.005) g.rule4Worse += 1;
    }
  }

  // Best overall rule = whichever has the largest aggregate delta.
  const totalDeltas: Array<[ShadowRuleId, number]> = [
    ["RULE_1", total.rule1Delta],
    ["RULE_2", total.rule2Delta],
    ["RULE_3", total.rule3Delta],
    ["RULE_4", total.rule4Delta],
  ];
  totalDeltas.sort((a, b) => b[1] - a[1]);
  const [bestRule, bestRuleDelta] = totalDeltas[0] ?? [null, 0];

  const improvedTopN = [...allTrades]
    .filter((t) => t.bestDelta > 0)
    .sort((a, b) => b.bestDelta - a.bestDelta)
    .slice(0, topN);
  const reducedTopN = [...allTrades]
    .filter((t) => t.bestDelta < 0)
    .sort((a, b) => a.bestDelta - b.bestDelta)
    .slice(0, topN);

  return {
    enabled,
    generatedAt: new Date().toISOString(),
    range: { from: ctx.from ?? null, to: ctx.to ?? null },
    rowCount: allTrades.length,
    rawRowCount: rows.length,
    processedRowCount: allTrades.length,
    mfeAvailableCount,
    lowSampleWarning: mfeAvailableCount < LOW_SAMPLE_THRESHOLD,
    lowSampleThreshold: LOW_SAMPLE_THRESHOLD,
    totals: {
      actualPnl: round2(total.actualPnl),
      rule1Pnl: round2(total.rule1Pnl),
      rule2Pnl: round2(total.rule2Pnl),
      rule3Pnl: round2(total.rule3Pnl),
      rule4Pnl: round2(total.rule4Pnl),
      rule1Delta: round2(total.rule1Delta),
      rule2Delta: round2(total.rule2Delta),
      rule3Delta: round2(total.rule3Delta),
      rule4Delta: round2(total.rule4Delta),
      rule1Better: total.rule1Better,
      rule1Worse: total.rule1Worse,
      rule2Better: total.rule2Better,
      rule2Worse: total.rule2Worse,
      rule3Better: total.rule3Better,
      rule3Worse: total.rule3Worse,
      rule4Better: total.rule4Better,
      rule4Worse: total.rule4Worse,
      bestRule: bestRuleDelta > 0 ? bestRule : null,
      bestRuleDelta: round2(bestRuleDelta),
    },
    bySetup: Array.from(bySetup, ([k, v]) => finalizeGroup(k, v)).sort((a, b) => b.trades - a.trades),
    byIndex: Array.from(byIndex, ([k, v]) => finalizeGroup(k, v)).sort((a, b) => b.trades - a.trades),
    byTier: Array.from(byTier, ([k, v]) => finalizeGroup(k, v)).sort((a, b) => b.trades - a.trades),
    improvedTopN,
    reducedTopN,
    parameters: SHADOW_RULE_PARAMS,
    limitations: [
      "Per-tick intra-trade premium path is not stored. Simulator uses entry, exit, and observed MFE (max_runup) only.",
      "Rules 2/3 assume the partial-booking level was touched BEFORE the actual exit. Optimistic for OPEN→TARGET trades; safe for STOPPED / TIME_EXIT_1520 / EXPIRED where MFE necessarily preceded the close.",
      "Rules 2/3/4 trail-to-BE assumes BE holds — remaining size exits at MAX(entry, actual_exit_premium). Slightly optimistic.",
      "Trades closed before the P20 MFE/MAE-logging fix have mfeAvailable=false; their MFE is approximated by realised gain (a strict lower bound), so their shadow-rule P&L is conservative.",
    ],
  };
}
