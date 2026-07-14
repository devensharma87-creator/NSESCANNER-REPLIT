/**
 * Backtest Lab — deterministic run-idempotency key.
 *
 * Two runs with byte-identical inputs should reuse the same persisted run row
 * instead of inflating the history with duplicates (the audit's "duplicate
 * runs" finding). The key is a sha256 over a canonical, key-sorted projection
 * of every input that affects the output, INCLUDING a `dataVersion` fingerprint
 * of the candle CSVs — so a candle refresh correctly invalidates the cache
 * rather than serving a stale run.
 *
 * Honest by construction:
 *  - REAL_REPLAY replays live, continuously-growing DB history, so its output
 *    depends on WHEN it runs, not just its inputs. It returns `null` here →
 *    never deduped, always fresh.
 *  - Over-specificity is safe: extra fields can only MISS a dedup (a harmless
 *    fresh run), never reuse a row that does not truly match.
 */

import { createHash } from "node:crypto";

/**
 * Salt folded into every run key. BUMP THIS whenever the backtest/strategy
 * compute logic changes in a way that would alter results for identical inputs
 * (e.g. directional engine, strategy evaluation, summary math). Bumping it makes
 * all previously-cached modeled runs miss the cache and recompute, so a logic
 * change can never silently serve a result produced by the OLD engine.
 */
export const BACKTEST_ENGINE_VERSION = "1";

/** Recursive, key-sorted JSON so object key order never changes the hash. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export interface RunKeyInputs {
  /** body.mode — REAL_REPLAY | DIRECTIONAL. */
  mode: string;
  /** V2 selector — OFFICIAL_ENGINE | STRATEGY_RESEARCH | COMPARE_OFFICIAL_VS_STRATEGIES. */
  backtestMode: string;
  instrument: string;
  timeframe: string;
  fromDate: string | null;
  toDate: string | null;
  startingCapital: number;
  riskPerTradePct: number;
  maxTradesPerDay: number;
  includeCharges: boolean;
  includeSlippage: boolean;
  strategyIds: string[];
  filters: unknown;
  strategyParams: unknown;
  /** Fingerprint of the candle source actually used (see candleDataVersion). */
  dataVersion: string;
}

/**
 * Returns a stable sha256 key for modeled runs, or `null` for REAL_REPLAY
 * and SNAPSHOT_PREMIUM_REPLAY (both depend on live/captured data that may
 * evolve — must never be deduped).
 */
export function computeBacktestRunKey(i: RunKeyInputs): string | null {
  if (i.mode === "REAL_REPLAY" || i.backtestMode === "SNAPSHOT_PREMIUM_REPLAY") return null;
  const canonical = stableStringify({
    engineVersion: BACKTEST_ENGINE_VERSION,
    mode: i.mode,
    backtestMode: i.backtestMode,
    instrument: i.instrument,
    timeframe: i.timeframe,
    fromDate: i.fromDate ?? null,
    toDate: i.toDate ?? null,
    startingCapital: i.startingCapital,
    riskPerTradePct: i.riskPerTradePct,
    maxTradesPerDay: i.maxTradesPerDay,
    includeCharges: i.includeCharges,
    includeSlippage: i.includeSlippage,
    // Order-independent: the engine treats the selection as a set.
    strategyIds: [...i.strategyIds].sort(),
    filters: i.filters ?? null,
    strategyParams: i.strategyParams ?? null,
    dataVersion: i.dataVersion,
  });
  return createHash("sha256").update(canonical).digest("hex");
}
