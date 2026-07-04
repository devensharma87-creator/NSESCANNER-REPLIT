/**
 * Checkpoint 3 — Data Parity mismatch classification rules.
 *
 * Pure, side-effect-free, unit-testable. Takes a set of already-collected
 * `DataParityObservation`s for one symbol and derives `DataParityMismatch`es
 * + an overall severity. Never fetches data, never mutates anything.
 *
 * Tolerances (deliberately conservative to avoid false-positive P0s across
 * modules with legitimately different freshness policies — e.g. a
 * report-grade same-day quote vs. a router quote inside the 10-min
 * trade-grade budget are NOT the same freshness class and must not be
 * compared as if they were):
 *
 *   PRICE_DIVERGENCE
 *     <= 0.1%                          -> no mismatch (within float/tick noise)
 *     0.1% - 0.5%                      -> P1
 *     > 0.5% AND both trade_grade+fresh -> P0
 *     > 0.5% otherwise (cross-class)   -> P1 (capped — different freshness
 *                                        policies are expected to diverge)
 *
 *   STALENESS_DIVERGENCE (only compared when BOTH observations claim to be
 *   fresh, i.e. freshnessSec <= TRADE_GRADE_FRESH_BUDGET_SEC; a stale/frozen
 *   observation's asOf lag is already implied by its own freshness, not a
 *   cross-module mismatch)
 *     asOf drift <= 5 min -> no mismatch
 *     asOf drift > 5 min  -> P1
 *
 *   SOURCE_DIVERGENCE (provider differs but prices agree within tolerance)
 *     -> P2
 *
 *   TRADE_GRADE_DIVERGENCE (tradeGrade flag differs — often BY DESIGN, e.g.
 *   the report-grade facade is always tradeGrade:false)
 *     -> INFO
 *
 *   MODULE_UNAVAILABLE
 *     router unavailable -> P1 (the canonical source itself should basically
 *     always be readable when Kite is online)
 *     any other module unavailable -> INFO
 */

import type {
  DataParityMismatch,
  DataParityModuleId,
  DataParityObservation,
  DataParityOverallSeverity,
  DataParityResult,
  DataParitySeverity,
} from "./types";

export const TRADE_GRADE_FRESH_BUDGET_SEC = 600; // 10 minutes — matches the router's trade-grade freshness budget.
export const PRICE_DIVERGENCE_P0_PCT = 0.5;
export const PRICE_DIVERGENCE_P1_PCT = 0.1;
export const STALENESS_DIVERGENCE_P1_MIN = 5;

function isTradeGradeFresh(obs: DataParityObservation): boolean {
  return (
    obs.freshnessClass === "trade_grade" &&
    obs.freshnessSec != null &&
    Number.isFinite(obs.freshnessSec) &&
    obs.freshnessSec <= TRADE_GRADE_FRESH_BUDGET_SEC
  );
}

function pctDiff(a: number, b: number): number {
  const denom = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return (Math.abs(a - b) / denom) * 100;
}

function mismatch(
  severity: DataParitySeverity,
  kind: DataParityMismatch["kind"],
  moduleA: DataParityModuleId,
  moduleB: DataParityModuleId,
  valueA: DataParityMismatch["valueA"],
  valueB: DataParityMismatch["valueB"],
  description: string,
): DataParityMismatch {
  return { severity, kind, moduleA, moduleB, valueA, valueB, description };
}

export function classifyPriceDivergence(
  a: DataParityObservation,
  b: DataParityObservation,
): DataParityMismatch | null {
  if (a.price == null || b.price == null) return null;
  const pct = pctDiff(a.price, b.price);
  if (pct <= PRICE_DIVERGENCE_P1_PCT) return null;

  const bothTradeGradeFresh = isTradeGradeFresh(a) && isTradeGradeFresh(b);
  const severity: DataParitySeverity = pct > PRICE_DIVERGENCE_P0_PCT && bothTradeGradeFresh ? "P0" : "P1";

  return mismatch(
    severity,
    "PRICE_DIVERGENCE",
    a.moduleId,
    b.moduleId,
    a.price,
    b.price,
    `${a.moduleLabel} price ${a.price} vs ${b.moduleLabel} price ${b.price} (${pct.toFixed(3)}% diff)`,
  );
}

export function classifyStalenessDivergence(
  a: DataParityObservation,
  b: DataParityObservation,
): DataParityMismatch | null {
  if (a.asOf == null || b.asOf == null) return null;
  if (a.kind === "frozen_plan" || b.kind === "frozen_plan") return null;
  if (a.kind === "health" || b.kind === "health") return null;
  if (!isTradeGradeFresh(a) && a.freshnessClass !== "report_grade") return null;
  if (!isTradeGradeFresh(b) && b.freshnessClass !== "report_grade") return null;
  if (a.freshnessSec == null || b.freshnessSec == null) return null;
  if (a.freshnessSec > TRADE_GRADE_FRESH_BUDGET_SEC || b.freshnessSec > TRADE_GRADE_FRESH_BUDGET_SEC) return null;

  const aMs = Date.parse(a.asOf);
  const bMs = Date.parse(b.asOf);
  if (!Number.isFinite(aMs) || !Number.isFinite(bMs)) return null;

  const driftMin = Math.abs(aMs - bMs) / 60000;
  if (driftMin <= STALENESS_DIVERGENCE_P1_MIN) return null;

  return mismatch(
    "P1",
    "STALENESS_DIVERGENCE",
    a.moduleId,
    b.moduleId,
    a.asOf,
    b.asOf,
    `${a.moduleLabel} asOf ${a.asOf} vs ${b.moduleLabel} asOf ${b.asOf} (${driftMin.toFixed(1)} min drift)`,
  );
}

export function classifySourceDivergence(
  a: DataParityObservation,
  b: DataParityObservation,
): DataParityMismatch | null {
  if (a.source === b.source) return null;
  if (a.price == null || b.price == null) return null;
  const pct = pctDiff(a.price, b.price);
  if (pct > PRICE_DIVERGENCE_P1_PCT) return null; // already surfaced via PRICE_DIVERGENCE

  return mismatch(
    "P2",
    "SOURCE_DIVERGENCE",
    a.moduleId,
    b.moduleId,
    a.source,
    b.source,
    `${a.moduleLabel} sourced from ${a.source}, ${b.moduleLabel} from ${b.source}, prices agree`,
  );
}

export function classifyTradeGradeDivergence(
  a: DataParityObservation,
  b: DataParityObservation,
): DataParityMismatch | null {
  if (a.tradeGrade == null || b.tradeGrade == null) return null;
  if (a.tradeGrade === b.tradeGrade) return null;

  return mismatch(
    "INFO",
    "TRADE_GRADE_DIVERGENCE",
    a.moduleId,
    b.moduleId,
    a.tradeGrade,
    b.tradeGrade,
    `${a.moduleLabel} tradeGrade=${a.tradeGrade}, ${b.moduleLabel} tradeGrade=${b.tradeGrade} — often by design`,
  );
}

export function classifyModuleUnavailable(obs: DataParityObservation): DataParityMismatch | null {
  if (obs.status !== "UNAVAILABLE") return null;
  const severity: DataParitySeverity = obs.moduleId === "router" ? "P1" : "INFO";
  return mismatch(
    severity,
    "MODULE_UNAVAILABLE",
    obs.moduleId,
    obs.moduleId,
    obs.reason,
    null,
    `${obs.moduleLabel} unavailable: ${obs.reason ?? "no reason given"}`,
  );
}

/**
 * Compare every unordered pair of OK observations + flag each UNAVAILABLE
 * observation on its own. Pure — deterministic given the same input list.
 */
export function buildDataParityMismatches(observations: DataParityObservation[]): DataParityMismatch[] {
  const out: DataParityMismatch[] = [];

  for (const obs of observations) {
    const unavailable = classifyModuleUnavailable(obs);
    if (unavailable) out.push(unavailable);
  }

  const ok = observations.filter((o) => o.status === "OK");
  for (let i = 0; i < ok.length; i++) {
    for (let j = i + 1; j < ok.length; j++) {
      const a = ok[i]!;
      const b = ok[j]!;
      const price = classifyPriceDivergence(a, b);
      if (price) out.push(price);
      const staleness = classifyStalenessDivergence(a, b);
      if (staleness) out.push(staleness);
      const source = classifySourceDivergence(a, b);
      if (source) out.push(source);
      const tradeGrade = classifyTradeGradeDivergence(a, b);
      if (tradeGrade) out.push(tradeGrade);
    }
  }

  return out;
}

export function deriveOverallSeverity(mismatches: DataParityMismatch[]): DataParityOverallSeverity {
  if (mismatches.some((m) => m.severity === "P0")) return "P0";
  if (mismatches.some((m) => m.severity === "P1")) return "P1";
  if (mismatches.some((m) => m.severity === "P2")) return "P2";
  if (mismatches.length > 0) return "INFO";
  return "OK";
}

export function buildDataParityResult(
  symbol: string,
  assetType: DataParityResult["assetType"],
  observations: DataParityObservation[],
  capturedAt: string = new Date().toISOString(),
): DataParityResult {
  const mismatches = buildDataParityMismatches(observations);
  return {
    symbol,
    assetType,
    capturedAt,
    observations,
    mismatches,
    overallSeverity: deriveOverallSeverity(mismatches),
  };
}
