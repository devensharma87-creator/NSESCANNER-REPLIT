/**
 * Unified strategy catalog — the single source of truth that BOTH the live F&O
 * auto-engine selection list AND the Backtest Lab selectable list are derived
 * from. It merges three families into one surface-tagged list:
 *
 *   - BUILTIN_ENGINE   — the 5 live HC detectors (engine surface only).
 *   - BUILTIN_BACKTEST — the generic research strategies (backtest surface only).
 *   - CUSTOM           — owner-defined, config/parameter-driven strategies that
 *                        appear on BOTH surfaces.
 *
 * This module is pure: it takes the backtest metas + custom specs as inputs and
 * never touches the DB or the registry directly, so it stays trivially testable.
 */
import type { CustomStrategySpec } from "./customSpec";

export type CatalogSurface = "engine" | "backtest";
export type CatalogKind = "BUILTIN_ENGINE" | "BUILTIN_BACKTEST" | "CUSTOM";

export interface CatalogEntry {
  id: string;
  name: string;
  category: string;
  description: string;
  surfaces: CatalogSurface[];
  kind: CatalogKind;
}

/** Live-engine builtin HC detectors. `setupKey` matches `Detected.setupKey`. */
export interface EngineBuiltin {
  id: string;
  name: string;
  category: string;
  description: string;
  /** Whether this detector is a trend-following setup (vs mean-reverting). */
  trendClass: boolean;
}

/**
 * The 5 selectable live HC detectors. BASELINE is intentionally excluded — it is
 * the always-on fallback lane, not an opt-in HC setup, and must never be
 * disabled (doing so would silence the engine entirely).
 */
export const ENGINE_BUILTINS: EngineBuiltin[] = [
  {
    id: "TREND_CONTINUATION",
    name: "Trend Continuation",
    category: "Trend",
    description: "VWAP + EMA stack + RSI all aligned; enter on a break of the intraday swing.",
    trendClass: true,
  },
  {
    id: "VWAP_RECLAIM",
    name: "VWAP Reclaim / Reject",
    category: "Mean-Revert",
    description: "Fresh cross back through session VWAP with momentum confirmation.",
    trendClass: false,
  },
  {
    id: "VOLUME_BREAKOUT",
    name: "Volume Breakout",
    category: "Breakout",
    description: "Range break backed by an expansion in participation.",
    trendClass: true,
  },
  {
    id: "EMA_PULLBACK",
    name: "EMA Pullback",
    category: "Trend",
    description: "Pullback to the fast EMA inside an established trend, then resume.",
    trendClass: true,
  },
  {
    id: "MEAN_REVERSION",
    name: "Mean Reversion",
    category: "Mean-Revert",
    description: "Stretched away from value; fade back toward the mean.",
    trendClass: false,
  },
];

export const ENGINE_BUILTIN_IDS: ReadonlySet<string> = new Set(ENGINE_BUILTINS.map((e) => e.id));

/** Minimal meta shape consumed from the backtest registry (avoids a hard import). */
export interface BacktestMetaLike {
  id: string;
  name: string;
  category?: string | null;
  description?: string | null;
}

function engineEntry(b: EngineBuiltin): CatalogEntry {
  return {
    id: b.id,
    name: b.name,
    category: b.category,
    description: b.description,
    surfaces: ["engine"],
    kind: "BUILTIN_ENGINE",
  };
}

function backtestEntry(m: BacktestMetaLike): CatalogEntry {
  return {
    id: m.id,
    name: m.name,
    category: m.category ?? "Research",
    description: m.description ?? "",
    surfaces: ["backtest"],
    kind: "BUILTIN_BACKTEST",
  };
}

export function customEntry(spec: CustomStrategySpec): CatalogEntry {
  return {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    description: spec.description,
    surfaces: ["engine", "backtest"],
    kind: "CUSTOM",
  };
}

/**
 * Build the unified catalog. Custom entries appear on both surfaces. Ordering:
 * engine builtins, backtest builtins, then custom (stable, by insertion).
 */
export function buildCatalog(
  backtestMetas: BacktestMetaLike[],
  customSpecs: CustomStrategySpec[],
): CatalogEntry[] {
  return [
    ...ENGINE_BUILTINS.map(engineEntry),
    ...backtestMetas.map(backtestEntry),
    ...customSpecs.map(customEntry),
  ];
}

/** All ids valid on the backtest surface (builtin backtest + custom). */
export function backtestSelectableIds(
  backtestMetas: BacktestMetaLike[],
  customSpecs: CustomStrategySpec[],
): Set<string> {
  return new Set<string>([
    ...backtestMetas.map((m) => m.id),
    ...customSpecs.map((s) => s.id),
  ]);
}
