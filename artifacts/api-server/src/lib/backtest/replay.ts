/**
 * Backtest Lab — Mode A (REAL_REPLAY): 100% real, zero fabrication.
 *
 * Reads the engine's ACTUAL captured history:
 *   - option_signal_history : real emitted signals + their real outcomes.
 *   - fno_signal_reasoning  : the blocked/rejected-setup audit trail.
 *   - iv_history            : real ATM-IV record presence (data-quality flag).
 *
 * CRITICAL HONESTY NOTE (discovered from the live data):
 *   option_signal_history.exit_price stores the SPOT at exit, not the option
 *   premium, and is only meaningful for STOPPED/TARGET outcomes. A real option
 *   exit premium therefore exists ONLY when the signal was STOPPED (→
 *   option_stop_loss) or hit a TARGET (→ option_target1/2). Expired / stale
 *   triggers have NO captured option exit, so we surface them as taken-but-
 *   undecided (pnl = null) and never assign a fabricated P&L.
 */

import type {
  BacktestBlockedOut,
  BacktestDataQualityOut,
  BacktestSnapshotCoverageOut,
  BacktestTradeOut,
} from "./types";
import { computeBacktestTradeCost } from "./backtestCharges";

export interface OshRow {
  signal_date: string | Date | null;
  index_symbol: string;
  setup_key: string | null;
  setup_name: string | null;
  direction: string | null;
  strike: number | string | null;
  option_type: string | null;
  confidence: number | null;
  tier: string | null;
  generated_at: string | Date | null;
  status: string | null;
  triggered_at: string | Date | null;
  exited_at: string | Date | null;
  exit_reason: string | null;
  last_spot: number | string | null;
  option_entry: number | string | null;
  option_stop_loss: number | string | null;
  option_target1: number | string | null;
  option_target2: number | string | null;
  max_favorable_excursion: number | string | null;
  max_adverse_excursion: number | string | null;
}

/** Pre-aggregated blocked-setup row (GROUP BY done in SQL for efficiency). */
export interface FsrAggRow {
  index_symbol: string;
  setup_key: string | null;
  direction: string | null;
  decision: string | null;
  reason_code: string | null;
  regime: string | null;
  confidence: number | null;
  confluence_score: number | string | null;
  cnt: number | string;
}

export interface ReplayOptions {
  /** Position size applied to the REAL per-unit option move. Default 1. */
  lots: number;
  /** Lot size per index (real NSE constants). */
  lotSizes: Record<string, number>;
}

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

function iso(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Real captured option exit premium, or null when none was captured. */
function capturedExit(row: OshRow): { premium: number; reason: string } | null {
  const status = (row.status ?? "").toUpperCase();
  if (status === "STOPPED") {
    const p = num(row.option_stop_loss);
    return p === null ? null : { premium: p, reason: "STOPPED" };
  }
  if (status === "TARGET2_HIT") {
    const p = num(row.option_target2);
    return p === null ? null : { premium: p, reason: "TARGET2_HIT" };
  }
  if (status === "TARGET1_HIT") {
    const p = num(row.option_target1);
    return p === null ? null : { premium: p, reason: "TARGET1_HIT" };
  }
  return null;
}

/**
 * Build Mode-A trades from option_signal_history. Only TRIGGERED signals count
 * as taken trades; among those only STOPPED/TARGET outcomes carry a real exit
 * premium (and thus a P&L). The rest are taken-but-undecided (pnl = null).
 */
export function buildReplayTrades(rows: OshRow[], opts: ReplayOptions): BacktestTradeOut[] {
  const lots = opts.lots > 0 ? opts.lots : 1;
  const out: BacktestTradeOut[] = [];
  for (const row of rows) {
    const taken = !!row.triggered_at;
    if (!taken) continue; // never entered → not a trade

    const lotSize = opts.lotSizes[row.index_symbol] ?? null;
    const entry = num(row.option_entry);
    const exit = capturedExit(row);

    let pnl: number | null = null;
    let optionExit: number | null = null;
    if (exit && entry !== null && lotSize !== null) {
      optionExit = exit.premium;
      // Long-premium P&L (CALL or PUT, both bought): per-unit move × size.
      pnl = (exit.premium - entry) * lotSize * lots;
      pnl = Math.round(pnl * 100) / 100;
    }

    // Compute charges using real captured premiums (Mode A).
    // Only for decided trades (pnl !== null) — undecided trades get null breakdown.
    const chargesBreakdown =
      pnl !== null && entry !== null && lotSize !== null
        ? computeBacktestTradeCost({
            pnl,
            lots,
            lotSize,
            optionEntry: entry,
            optionExit: optionExit,
          })
        : null;

    out.push({
      id: `osh:${iso(row.generated_at) ?? ""}:${row.index_symbol}:${row.setup_key ?? ""}:${row.strike ?? ""}`,
      indexSymbol: row.index_symbol,
      setupKey: row.setup_key,
      setupName: row.setup_name,
      direction: row.direction ?? (row.option_type ?? ""),
      optionType: row.option_type,
      strike: num(row.strike),
      entryAt: iso(row.triggered_at) ?? iso(row.generated_at),
      exitAt: iso(row.exited_at),
      entrySpot: null, // not separately captured by the engine
      exitSpot: num(row.last_spot),
      optionEntry: entry,
      optionExit,
      optionStop: num(row.option_stop_loss),
      optionTarget1: num(row.option_target1),
      optionTarget2: num(row.option_target2),
      lots,
      lotSize,
      qty: lotSize !== null ? lotSize * lots : null,
      pnl,
      exitReason: exit ? exit.reason : row.exit_reason,
      confidence: row.confidence,
      tier: row.tier,
      regime: null, // option_signal_history does not persist regime
      modeled: false,
      maxFavorableExcursion: num(row.max_favorable_excursion),
      maxAdverseExcursion: num(row.max_adverse_excursion),
      grossPnl: chargesBreakdown?.grossPnl ?? null,
      chargesBreakdown: chargesBreakdown?.computable ? chargesBreakdown : null,
      netPnl: chargesBreakdown?.netPnl ?? null,
    });
  }
  return out;
}

/** Map the pre-aggregated blocked-setup rows into DTOs (counts already summed). */
export function buildBlockedSetups(rows: FsrAggRow[]): BacktestBlockedOut[] {
  return rows
    .map((r) => ({
      id: `fsr:${r.index_symbol}:${r.setup_key ?? ""}:${r.decision ?? ""}:${r.reason_code ?? ""}:${r.direction ?? ""}`,
      indexSymbol: r.index_symbol,
      setupKey: r.setup_key,
      direction: r.direction,
      decision: r.decision,
      reasonCode: r.reason_code,
      confidence: r.confidence,
      confluenceScore: num(r.confluence_score),
      regime: r.regime,
      count: Number(r.cnt) || 0,
      note: null,
    }))
    .sort((a, b) => b.count - a.count);
}

export function buildReplayDataQuality(params: {
  trades: BacktestTradeOut[];
  takenCount: number;
  ivCount: number;
  oiAvailable: boolean;
  blockedCount: number;
  snapshotCoverage: BacktestSnapshotCoverageOut | null;
  lots: number;
}): BacktestDataQualityOut {
  const decided = params.trades.filter((t) => t.pnl !== null).length;
  const undecided = params.takenCount - decided;

  const warnings: string[] = [];
  if (decided === 0) {
    warnings.push(
      "No trades with a captured option exit yet — the real-replay window is still small and grows every trading day.",
    );
  } else if (decided < 30) {
    warnings.push(
      `Small real sample (${decided} decided trade${decided === 1 ? "" : "s"}). Treat the stats as indicative; the window grows daily.`,
    );
  }
  if (undecided > 0) {
    warnings.push(
      `${undecided} taken signal${undecided === 1 ? "" : "s"} expired or went stale with no captured option exit — excluded from P&L (no fabricated outcome).`,
    );
  }

  const notes: string[] = [
    `P&L = (real captured exit premium − real entry premium) × lot size × ${params.lots} lot${params.lots === 1 ? "" : "s"}. Per-unit option moves are the engine's REAL captured fills; only the position size is your chosen lot count.`,
    "Mode A reads exactly what the live engine recorded — no look-ahead, no synthetic option data.",
  ];
  if (!params.oiAvailable) {
    notes.push("Option OI not present in the audit window for this selection.");
  }

  return {
    mode: "REAL_REPLAY",
    candleCoverage: null,
    optionDataAvailable: decided > 0,
    ivAvailable: params.ivCount > 0,
    oiAvailable: params.oiAvailable,
    snapshotCoverage: params.snapshotCoverage,
    modeledFields: [],
    warnings,
    notes,
  };
}
