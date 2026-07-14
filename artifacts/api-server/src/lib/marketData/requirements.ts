/**
 * Module data-requirement engine (Task #131).
 *
 * Each consumer module declares, per data type, the trust level it REQUIRES.
 * `checkRequirement(point, req)` is the single pure gate that answers "is this
 * datum good enough for this consumer?" — and, crucially, auto-rejects
 * Yahoo/delayed/stale data for any `TRADE_GRADE_REQUIRED` consumer. That is the
 * missing invariant the backbone needs: Kite being "active" must NOT let a
 * delayed or stale datum silently power a trade signal.
 *
 * Fully pure, no IO — every branch is unit-testable.
 */

import type { MarketDataPoint, SourceStatus } from "./types";

// ── Requirement contract ───────────────────────────────────────────────────

/**
 * How strict a consumer is about the data it reads.
 *   TRADE_GRADE_REQUIRED  — only fresh, authoritative (Kite) data. Rejects
 *                           Yahoo/INDstocks/delayed/stale/unavailable.
 *   INFO_ONLY_ACCEPTABLE  — any present datum is usable for information; a
 *                           delayed/stale/info datum DEGRADES but still passes.
 *   DISPLAY_ONLY          — anything with a value is fine; only UNAVAILABLE fails.
 */
export type RequirementLevel =
  | "TRADE_GRADE_REQUIRED"
  | "INFO_ONLY_ACCEPTABLE"
  | "DISPLAY_ONLY";

export interface DataRequirement {
  /** Logical data type, e.g. "indexQuote", "intradayCandles", "optionChain". */
  dataType: string;
  level: RequirementLevel;
  /**
   * Max acceptable age in seconds for a TRADE_GRADE_REQUIRED consumer.
   * null → no explicit freshness ceiling beyond the point's own staleness flag.
   */
  maxFreshnessSec: number | null;
}

// ── Readiness result ───────────────────────────────────────────────────────

export type ReadinessStatus = "READY" | "DEGRADED" | "BLOCKED";

export interface DataReadiness {
  status: ReadinessStatus;
  /** True when the requirement is satisfied (READY or DEGRADED-but-usable). */
  met: boolean;
  /** Concrete, human-readable reason — never silent. */
  reason: string;
  /** The actual status the point carried. */
  pointStatus: SourceStatus;
  /** Recovery hint copied from the point when the requirement is not met. */
  recoveryAction: string | null;
}

// ── Pure gate ──────────────────────────────────────────────────────────────

/**
 * Decide whether `point` satisfies `req`. Pure.
 *
 * TRADE_GRADE_REQUIRED accepts a point ONLY when ALL hold:
 *   - sourceStatus === "TRADE_GRADE"
 *   - canDriveSignals === true
 *   - value present
 *   - freshnessSec within maxFreshnessSec (when a ceiling is set)
 * Anything else (Yahoo DELAYED, INFO_ONLY, STALE, COMPUTED, UNAVAILABLE, or
 * a TRADE_GRADE point that is too old for this consumer) → BLOCKED, met=false.
 *
 * INFO_ONLY_ACCEPTABLE: UNAVAILABLE → BLOCKED; TRADE_GRADE → READY; anything
 *   else present → DEGRADED but met=true.
 *
 * DISPLAY_ONLY: UNAVAILABLE → BLOCKED; anything present → READY.
 */
export function checkRequirement<T>(
  point: MarketDataPoint<T>,
  req: DataRequirement,
): DataReadiness {
  const base = {
    pointStatus: point.sourceStatus,
    recoveryAction: point.recoveryAction,
  };

  if (point.sourceStatus === "UNAVAILABLE" || point.value == null) {
    return {
      ...base,
      status: "BLOCKED",
      met: false,
      reason:
        point.errorMessage ??
        `No data available for ${req.dataType}${point.errorCode ? ` (${point.errorCode})` : ""}.`,
    };
  }

  if (req.level === "DISPLAY_ONLY") {
    return { ...base, status: "READY", met: true, reason: "Display-only requirement met." };
  }

  if (req.level === "INFO_ONLY_ACCEPTABLE") {
    if (point.sourceStatus === "TRADE_GRADE") {
      return { ...base, status: "READY", met: true, reason: "Trade-grade data available (info requirement)." };
    }
    return {
      ...base,
      status: "DEGRADED",
      met: true,
      reason: `Using ${point.sourceStatus} data for information; not trade-grade.`,
    };
  }

  // TRADE_GRADE_REQUIRED — the strict path.
  if (point.sourceStatus !== "TRADE_GRADE") {
    return {
      ...base,
      status: "BLOCKED",
      met: false,
      reason: `${req.dataType} requires trade-grade (Kite) data but source is ${point.sourceStatus} (${point.source}).`,
    };
  }
  if (!point.canDriveSignals) {
    return {
      ...base,
      status: "BLOCKED",
      met: false,
      reason: `${req.dataType} datum is not signal-eligible (canDriveSignals=false).`,
    };
  }
  if (
    req.maxFreshnessSec != null &&
    point.freshnessSec != null &&
    point.freshnessSec > req.maxFreshnessSec
  ) {
    return {
      ...base,
      status: "BLOCKED",
      met: false,
      reason: `${req.dataType} is ${point.freshnessSec}s old, exceeds the ${req.maxFreshnessSec}s trade-grade budget.`,
    };
  }
  return { ...base, status: "READY", met: true, reason: "Trade-grade requirement met." };
}

// ── Module declarations ────────────────────────────────────────────────────

/**
 * The consumer modules the backbone tracks. Kept in sync with the diagnostics
 * surface (`buildBackboneHealth`) and the frontend nav grouping.
 */
export type ModuleId =
  | "fno"
  | "swing"
  | "scanner"
  | "watchlist"
  | "portfolio"
  | "charting"
  | "optionChain"
  | "home"
  | "prePost";

/**
 * Per-module data requirements. This is the single place that declares which
 * tier each module needs for each data type — the "Kite active does not equal
 * trade-safe" contract made explicit.
 *
 *   - F&O + swing + option-chain: TRADE_GRADE_REQUIRED (real trade decisions).
 *   - Portfolio valuation: prices trade-grade; benchmark is info-only (Yahoo).
 *   - Scanner: INFO_ONLY — Phase A signals are Yahoo-sourced enrichment, never
 *     branded trade-grade (preserves the scanner honesty model).
 *   - Watchlist: prices are trade-grade (priced via the trusted router).
 *   - Charting: display-only datafeed.
 *   - Home / pre-post: information + display; live cues stay INFO_ONLY until the
 *     external providers are integrated (honest, not fabricated).
 */
export const MODULE_REQUIREMENTS: Record<ModuleId, DataRequirement[]> = {
  fno: [
    { dataType: "indexQuote", level: "TRADE_GRADE_REQUIRED", maxFreshnessSec: 120 },
    { dataType: "intradayCandles", level: "TRADE_GRADE_REQUIRED", maxFreshnessSec: 900 },
    { dataType: "dailyCandles", level: "TRADE_GRADE_REQUIRED", maxFreshnessSec: 86_400 },
    { dataType: "optionChain", level: "TRADE_GRADE_REQUIRED", maxFreshnessSec: 300 },
  ],
  swing: [
    { dataType: "dailyCandles", level: "TRADE_GRADE_REQUIRED", maxFreshnessSec: 86_400 },
  ],
  optionChain: [
    { dataType: "optionChain", level: "TRADE_GRADE_REQUIRED", maxFreshnessSec: 300 },
  ],
  watchlist: [
    { dataType: "quote", level: "TRADE_GRADE_REQUIRED", maxFreshnessSec: 120 },
  ],
  portfolio: [
    { dataType: "quote", level: "TRADE_GRADE_REQUIRED", maxFreshnessSec: 120 },
    { dataType: "benchmark", level: "INFO_ONLY_ACCEPTABLE", maxFreshnessSec: null },
  ],
  scanner: [
    { dataType: "quote", level: "INFO_ONLY_ACCEPTABLE", maxFreshnessSec: null },
  ],
  charting: [
    { dataType: "candles", level: "DISPLAY_ONLY", maxFreshnessSec: null },
  ],
  home: [
    // Only data types the backbone actually sources are tracked here. Global
    // cues / GIFT Nifty / FII-DII remain SOURCE_NOT_INTEGRATED and are labelled
    // honestly by the Home per-section source-honesty layer + Daily Analysis
    // coverage matrix — the health board must not flag them as a fixable outage.
    { dataType: "indexQuote", level: "INFO_ONLY_ACCEPTABLE", maxFreshnessSec: null },
  ],
  prePost: [
    { dataType: "indexQuote", level: "INFO_ONLY_ACCEPTABLE", maxFreshnessSec: null },
    { dataType: "optionChain", level: "INFO_ONLY_ACCEPTABLE", maxFreshnessSec: null },
  ],
};

/** The strictest requirement level a module declares (for the roll-up badge). */
export function strictestLevel(reqs: DataRequirement[]): RequirementLevel {
  if (reqs.some((r) => r.level === "TRADE_GRADE_REQUIRED")) return "TRADE_GRADE_REQUIRED";
  if (reqs.some((r) => r.level === "INFO_ONLY_ACCEPTABLE")) return "INFO_ONLY_ACCEPTABLE";
  return "DISPLAY_ONLY";
}
