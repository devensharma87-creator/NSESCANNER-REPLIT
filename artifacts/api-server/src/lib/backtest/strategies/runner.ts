/**
 * Backtest Lab V2 — walk-forward strategy runner (NO look-ahead).
 *
 * For one (index context × strategy × filter config) it walks the candles
 * forward, opening at most one position per index at a time. Exits use a 50/50
 * scale-out: half at Target-1 (then the remainder trails to breakeven), the rest
 * at Target-2, with a conservative intrabar assumption (stop is checked before
 * target within the same bar). Option P&L is the clearly-labeled ATM delta proxy
 * on the REAL spot move — never a fabricated premium. trade.pnl is GROSS; charges
 * and slippage are modeled later in comparison.ts.
 */

import { randomUUID } from "node:crypto";
import { LOT_SIZES } from "../../optionChain";
import type { BacktestBlockedOut, BacktestTradeOut } from "../types";
import {
  ATM_DELTA,
  FORCE_EXIT_MIN,
  MARKET_OPEN_MIN,
  WARMUP_BARS,
  type FilterConfig,
  type FilterKey,
  type StrategyContext,
  type StrategyEntry,
  type StrategyModule,
} from "./base";
import { applyFilters } from "./filters";

export interface RunOptions {
  timeframe: string;
  maxTradesPerDay: number;
  includeCharges: boolean;
  includeSlippage: boolean;
}

export interface StrategyRunResult {
  trades: BacktestTradeOut[];
  blocked: BacktestBlockedOut[];
  autoDisabledFilters: FilterKey[];
  appliedFilters: string[];
}

interface OpenPosition {
  entry: StrategyEntry;
  entryIndex: number;
  entryTimeIso: string;
  lots: number;
  lotSize: number;
  qty: number;
  qtyHalf: number; // first half (exits at T1)
  qtyRest: number; // remainder (exits at T2 / trail / time)
  reachedT1: boolean;
  realizedHalfPnl: number; // booked P&L from the T1 half
  trailStop: number; // moves to breakeven after T1
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/** ATM delta-proxy option P&L for a spot move over `qty` units. */
function proxyPnl(dir: "BULL" | "BEAR", entrySpot: number, exitSpot: number, qty: number): number {
  const sign = dir === "BULL" ? 1 : -1;
  return ATM_DELTA * sign * (exitSpot - entrySpot) * qty;
}

export function runStrategy(
  ctx: StrategyContext,
  module: StrategyModule,
  filters: FilterConfig,
  opts: RunOptions,
): StrategyRunResult {
  const trades: BacktestTradeOut[] = [];
  const blockedByRule = new Map<string, BacktestBlockedOut>();
  const autoDisabled = new Set<FilterKey>();
  const appliedSet = new Set<string>();
  const lotSize = LOT_SIZES[ctx.indexSymbol] ?? 1;
  const ignored = module.meta.ignoredFilters as FilterKey[];

  const n = ctx.candles.length;
  let open: OpenPosition | null = null;
  let curDay = "";
  let tradesToday = 0;

  const closePosition = (
    pos: OpenPosition,
    exitIndex: number,
    exitSpot: number,
    exitReason: string,
  ): void => {
    const restPnl = proxyPnl(pos.entry.direction, pos.entry.entrySpot, exitSpot, pos.qtyRest);
    const totalPnl = pos.realizedHalfPnl + restPnl;
    const riskUnit = Math.abs(pos.entry.entrySpot - pos.entry.stop);
    const riskAmount = ATM_DELTA * riskUnit * pos.qty;
    const rMultiple = riskAmount > 0 ? totalPnl / riskAmount : null;
    trades.push({
      id: randomUUID(),
      indexSymbol: ctx.indexSymbol,
      setupKey: module.meta.id,
      setupName: module.meta.name,
      direction: pos.entry.direction === "BULL" ? "LONG" : "SHORT",
      optionType: pos.entry.optionType,
      strike: null,
      entryAt: pos.entryTimeIso,
      exitAt: ctx.candles[exitIndex]!.t.toISOString(),
      entrySpot: pos.entry.entrySpot,
      exitSpot,
      optionEntry: null,
      optionExit: null,
      optionStop: null,
      optionTarget1: null,
      optionTarget2: null,
      lots: pos.lots,
      lotSize: pos.lotSize,
      qty: pos.qty,
      pnl: totalPnl,
      exitReason,
      confidence: pos.entry.confidence,
      tier: "STRATEGY",
      regime: null,
      modeled: true,
      maxFavorableExcursion: null,
      maxAdverseExcursion: null,
      backtestMode: "STRATEGY_RESEARCH",
      strategyId: module.meta.id,
      strategyName: module.meta.name,
      strategyCategory: module.meta.category,
      signalSource: "STRATEGY",
      strategyParams: {
        stop: pos.entry.stop,
        target1: pos.entry.target1,
        target2: pos.entry.target2,
        rMultiple,
        reachedT1: pos.reachedT1,
        timeframe: opts.timeframe,
      },
      confirmationFilters: Array.from(appliedSet),
      strategyConfidence: pos.entry.confidence,
      historicalSetupMatch: null,
      passedConditions: pos.entry.passedConditions,
      failedConditions: pos.entry.failedConditions,
    });
  };

  for (let i = 0; i < n; i++) {
    const iso = ctx.candles[i]!.t.toISOString();
    const day = dayKey(iso);
    if (day !== curDay) {
      curDay = day;
      tradesToday = 0;
    }

    const h = ctx.highs[i]!;
    const l = ctx.lows[i]!;
    const c = ctx.closes[i]!;
    const minute = ctx.istMinute[i]!;
    const forceExit = minute >= FORCE_EXIT_MIN;
    const lastBar = ctx.isLastBarOfDay[i]!;

    // ---- manage an open position on this bar (entry bar excluded) -----------
    if (open && i > open.entryIndex) {
      const dir = open.entry.direction;
      const isBull = dir === "BULL";

      if (!open.reachedT1) {
        const stopHit = isBull ? l <= open.entry.stop : h >= open.entry.stop;
        const t1Hit = isBull ? h >= open.entry.target1 : l <= open.entry.target1;
        if (stopHit) {
          // Conservative: stop before target. Whole position out at stop.
          open.realizedHalfPnl = proxyPnl(dir, open.entry.entrySpot, open.entry.stop, open.qtyHalf);
          closePosition(open, i, open.entry.stop, "STOP");
          open = null;
        } else if (t1Hit) {
          // Book the first half at T1, trail the remainder to breakeven.
          open.realizedHalfPnl = proxyPnl(dir, open.entry.entrySpot, open.entry.target1, open.qtyHalf);
          open.reachedT1 = true;
          open.trailStop = open.entry.entrySpot;
          // Do NOT also take T2 on the same bar (conservative).
          if (forceExit || lastBar) {
            closePosition(open, i, c, forceExit ? "TIME_EXIT_1520" : "EOD_EXIT");
            open = null;
          }
        } else if (forceExit || lastBar) {
          open.realizedHalfPnl = proxyPnl(dir, open.entry.entrySpot, c, open.qtyHalf);
          // remainder also exits at close; qtyRest handled in closePosition
          closePosition(open, i, c, forceExit ? "TIME_EXIT_1520" : "EOD_EXIT");
          open = null;
        }
      } else {
        // Remainder running with breakeven trail.
        const trailHit = isBull ? l <= open.trailStop : h >= open.trailStop;
        const t2Hit = isBull ? h >= open.entry.target2 : l <= open.entry.target2;
        if (trailHit) {
          closePosition(open, i, open.trailStop, "TRAIL_STOP");
          open = null;
        } else if (t2Hit) {
          closePosition(open, i, open.entry.target2, "TARGET2");
          open = null;
        } else if (forceExit || lastBar) {
          closePosition(open, i, c, forceExit ? "TIME_EXIT_1520" : "EOD_EXIT");
          open = null;
        }
      }
    }

    // ---- look for a new entry on this bar -----------------------------------
    if (
      !open &&
      i >= WARMUP_BARS &&
      minute >= MARKET_OPEN_MIN &&
      !forceExit &&
      !lastBar &&
      tradesToday < opts.maxTradesPerDay
    ) {
      const entry = module.evaluate(ctx, i);
      if (entry) {
        const fr = applyFilters(ctx, i, entry, filters, ignored);
        for (const k of fr.autoDisabled) autoDisabled.add(k);
        for (const f of fr.appliedFilters) appliedSet.add(f);
        if (!fr.ok) {
          const rej = fr.rejections[0]!;
          const key = rej.blockedRule;
          const existing = blockedByRule.get(key);
          if (existing) {
            existing.count += 1;
          } else {
            blockedByRule.set(key, {
              id: randomUUID(),
              indexSymbol: ctx.indexSymbol,
              setupKey: module.meta.id,
              direction: entry.direction === "BULL" ? "LONG" : "SHORT",
              decision: "BLOCKED",
              reasonCode: rej.key,
              confidence: entry.confidence,
              confluenceScore: null,
              regime: null,
              count: 1,
              note: rej.failedCondition,
              strategyId: module.meta.id,
              strategyName: module.meta.name,
              signalSource: "STRATEGY",
              failedCondition: rej.failedCondition,
              blockedRule: rej.blockedRule,
              category: "FILTER",
            });
          }
        } else {
          const lots = 1;
          const qty = lots * lotSize;
          const qtyHalf = Math.floor(qty / 2) || qty; // keep ≥1 leg if odd/small
          open = {
            entry,
            entryIndex: i,
            entryTimeIso: iso,
            lots,
            lotSize,
            qty,
            qtyHalf,
            qtyRest: qty - qtyHalf,
            reachedT1: false,
            realizedHalfPnl: 0,
            trailStop: entry.stop,
          };
          tradesToday += 1;
        }
      }
    }
  }

  // Any still-open position at the very end exits at the last close (EOD).
  if (open) {
    const lastIdx = n - 1;
    const c = ctx.closes[lastIdx]!;
    if (!open.reachedT1) {
      open.realizedHalfPnl = proxyPnl(open.entry.direction, open.entry.entrySpot, c, open.qtyHalf);
    }
    closePosition(open, lastIdx, c, "EOD_EXIT");
    open = null;
  }

  return {
    trades,
    blocked: Array.from(blockedByRule.values()),
    autoDisabledFilters: Array.from(autoDisabled),
    appliedFilters: Array.from(appliedSet),
  };
}
