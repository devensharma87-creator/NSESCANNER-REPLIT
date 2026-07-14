/**
 * Unified Market Data Backbone — health roll-up (Task #131).
 *
 * Answers, per consumer module, the question the topbar "KITE LIVE" badge
 * cannot: "given what each module REQUIRES, is its data actually good enough
 * right now?" It composes existing in-process state ONLY — no new network:
 *   - buildMarketDataHealth()  (session + feed + market session)
 *   - getLastFnoCycleState()   (last F&O cycle bar/suppression facts)
 *   - getLastWarmupResult()    (last Kite warmup per-index/per-step outcomes)
 *
 * Design (architect-approved):
 *   - `buildBackbonePoints(facts)` — PURE: runtime facts → MarketDataPoint set.
 *   - `buildBackboneHealth(points)` — PURE: points → per-module readiness via
 *     the requirement engine (`checkRequirement` / `MODULE_REQUIREMENTS`).
 *   - `collectBackboneState()` — thin async collector wiring the getters in.
 *
 * SAFETY: read-only. No trading, no orders, no signal/gate/threshold changes,
 * no secrets (no tokens/api keys/chat IDs). Honest by construction — Yahoo and
 * stale data can never satisfy a TRADE_GRADE_REQUIRED module.
 */

import type { MarketDataPoint, ProviderName, SourceStatus } from "./marketData";
import {
  checkRequirement,
  MODULE_REQUIREMENTS,
  strictestLevel,
  type DataReadiness,
  type ModuleId,
  type RequirementLevel,
} from "./marketData";
import { classifyDataFailure } from "./fnoFailureDiagnosis";
import { buildMarketDataHealth, type MarketDataHealth, type QuoteStatus } from "./marketDataHealth";
import { getLastFnoCycleState } from "./optionSignals";
import { getLastWarmupResult, type WarmupRunResult } from "./kiteWarmup";

const RECONNECT = "Reconnect Zerodha (Kite session expired or missing).";

// ── Output shape ────────────────────────────────────────────────────────────

export type ModuleStatus = "OK" | "DEGRADED" | "BLOCKED";

export interface ModuleRequirementReadiness {
  dataType: string;
  level: RequirementLevel;
  readiness: DataReadiness;
}

export interface ModuleDataHealth {
  module: ModuleId;
  /** Strictest requirement level the module declares. */
  requirement: RequirementLevel;
  status: ModuleStatus;
  requirements: ModuleRequirementReadiness[];
  /** Human-readable reasons for every unmet requirement. */
  failures: string[];
  /** First actionable recovery hint among the failures, or null. */
  recoveryAction: string | null;
}

/** A structured set of points keyed by module → dataType. */
export type BackbonePointSet = Partial<Record<ModuleId, Record<string, MarketDataPoint<unknown>>>>;

// ── Runtime facts (the collector fills these from existing state) ───────────

export interface BackboneRuntimeFacts {
  now: number;
  sessionValid: boolean;
  sessionPresent: boolean;
  marketSession: "open" | "closed" | "pre_open";
  /** True when live Kite ticks are flowing (health.kite.tradeGrade). */
  liveTicks: boolean;
  quoteStatus: QuoteStatus;
  warmup: WarmupRunResult | null;
  cycle: { indicesWithBars: number; suppressed: { index: string; reasons: string[] }[] } | null;
}

// ── Point factories (pure) ──────────────────────────────────────────────────

function makePoint(
  key: string,
  assetType: MarketDataPoint<unknown>["assetType"],
  symbol: string,
  source: ProviderName,
  sourceStatus: SourceStatus,
  opts: {
    value?: unknown;
    freshnessSec?: number | null;
    canDriveSignals?: boolean;
    fallbackUsed?: boolean;
    errorCode?: string | null;
    errorMessage?: string | null;
    recoveryAction?: string | null;
  } = {},
): MarketDataPoint<unknown> {
  const canDriveSignals = opts.canDriveSignals ?? sourceStatus === "TRADE_GRADE";
  return {
    key,
    assetType,
    symbol,
    exchange: null,
    value: sourceStatus === "UNAVAILABLE" ? null : (opts.value ?? { ok: true }),
    source,
    sourceStatus,
    asOf: null,
    freshnessSec: opts.freshnessSec ?? null,
    canDriveSignals,
    canDriveTradeAlerts: canDriveSignals,
    fallbackUsed: opts.fallbackUsed ?? false,
    errorCode: opts.errorCode ?? null,
    errorMessage: opts.errorMessage ?? null,
    recoveryAction: opts.recoveryAction ?? null,
  };
}

function unavailablePoint(
  key: string,
  assetType: MarketDataPoint<unknown>["assetType"],
  symbol: string,
  code: string,
  message: string,
  recovery: string | null,
): MarketDataPoint<unknown> {
  return makePoint(key, assetType, symbol, "none", "UNAVAILABLE", {
    canDriveSignals: false,
    errorCode: code,
    errorMessage: message,
    recoveryAction: recovery,
  });
}

/** Seconds since 09:15 IST for `now`, or null when it can't be derived. */
function istSecondsSinceOpen(now: number): number | null {
  const ist = new Date(now + 5.5 * 3600 * 1000);
  const secOfDay = ist.getUTCHours() * 3600 + ist.getUTCMinutes() * 60 + ist.getUTCSeconds();
  return secOfDay - (9 * 3600 + 15 * 60);
}

/**
 * Aggregate the last warmup's outcome for a single step across all indices.
 *   allOk    — every index succeeded that step (or no warmup step failed).
 *   someFail — at least one but not all indices failed.
 *   allFail  — every index failed the step.
 * Returns the worst failing step's classified failure for messaging.
 */
function warmupStepStatus(
  warmup: WarmupRunResult | null,
  step: string,
): { kind: "none" | "allOk" | "someFail" | "allFail"; code: string | null; message: string | null; recovery: string | null } {
  if (!warmup || warmup.indices.length === 0) {
    return { kind: "none", code: null, message: null, recovery: null };
  }
  let ok = 0;
  let fail = 0;
  let firstFail: { code: string | null; message: string | null } | null = null;
  for (const idx of warmup.indices) {
    const s = idx.steps.find((st) => st.step === step);
    if (!s) continue;
    if (s.ok) ok += 1;
    else {
      fail += 1;
      if (!firstFail) firstFail = { code: s.code, message: s.message };
    }
  }
  if (fail === 0) return { kind: "allOk", code: null, message: null, recovery: null };
  const recovery =
    firstFail?.code === "SESSION_MISSING" || firstFail?.code === "TOKEN_MISSING" ? RECONNECT : null;
  const kind = ok === 0 ? "allFail" : "someFail";
  return { kind, code: firstFail?.code ?? null, message: firstFail?.message ?? null, recovery };
}

/**
 * Build a trade-grade-capable point from evidence. Priority:
 *   1. session invalid           → UNAVAILABLE (reconnect)   [BLOCKED]
 *   2. warmup step failed all     → UNAVAILABLE (classified)  [BLOCKED]
 *   3. warmup step failed some    → STALE (partial)           [→ blocked for trade-grade, honest]
 *   4. market open, all suppressed→ STALE (classified live-path degradation)
 *   5. otherwise                  → TRADE_GRADE               [OK]
 */
function tradeGradeEvidencePoint(
  key: string,
  assetType: MarketDataPoint<unknown>["assetType"],
  symbol: string,
  warmupStep: string,
  f: BackboneRuntimeFacts,
): MarketDataPoint<unknown> {
  if (!f.sessionValid) {
    return unavailablePoint(key, assetType, symbol, "SESSION_MISSING", "Kite session expired or missing.", RECONNECT);
  }

  const ws = warmupStepStatus(f.warmup, warmupStep);
  if (ws.kind === "allFail") {
    return unavailablePoint(key, assetType, symbol, ws.code ?? "UNKNOWN", ws.message ?? "Warmup failed for all indices.", ws.recovery);
  }
  if (ws.kind === "someFail") {
    return makePoint(key, assetType, symbol, "kite", "STALE", {
      canDriveSignals: false,
      errorCode: ws.code ?? "PARTIAL",
      errorMessage: ws.message ?? "Warmup failed for some indices.",
      recoveryAction: ws.recovery,
    });
  }

  // Live F&O path degradation (session says live, but the last cycle got no bars).
  if (f.marketSession === "open" && f.cycle && f.cycle.indicesWithBars === 0) {
    const reasons = f.cycle.suppressed.flatMap((s) => s.reasons);
    const diag = classifyDataFailure(reasons[0] ?? "no_live_kite_intraday", {
      sessionValid: f.sessionValid,
      marketSession: f.marketSession,
      secondsSinceOpen: istSecondsSinceOpen(f.now),
    });
    return makePoint(key, assetType, symbol, "kite", "STALE", {
      canDriveSignals: false,
      errorCode: diag.code,
      errorMessage: diag.message,
      recoveryAction: diag.recoveryAction,
    });
  }

  // Healthy Kite path. When the market is closed the last close is still a valid
  // Kite datum — no live-freshness ceiling applies, so freshnessSec stays null.
  //
  // Boot-window caveat: this resolves TRADE_GRADE on ABSENCE of negative evidence
  // (session valid, no warmup failure recorded, no zero-bar cycle). Right after
  // boot — before the staggered warmup fires and before the first F&O cycle runs —
  // both `warmup` and `cycle` are null, so an open market with no live ticks yet
  // still reads TRADE_GRADE with freshnessSec=null. This is acceptable ONLY because
  // the backbone report is a read-only diagnostics surface that drives NOTHING; no
  // trading/gate/sizing path consumes it. If a consumer ever does, add a
  // WARMUP_PENDING state instead of trusting absence-of-evidence here.
  return makePoint(key, assetType, symbol, "kite", "TRADE_GRADE", {
    canDriveSignals: true,
    freshnessSec: f.marketSession === "open" && f.liveTicks ? 0 : null,
  });
}

/** Build an info/display point (Yahoo/delayed is acceptable for these consumers). */
function infoEvidencePoint(
  key: string,
  assetType: MarketDataPoint<unknown>["assetType"],
  symbol: string,
  f: BackboneRuntimeFacts,
): MarketDataPoint<unknown> {
  if (f.liveTicks) {
    return makePoint(key, assetType, symbol, "kite", "TRADE_GRADE", { canDriveSignals: true, freshnessSec: 0 });
  }
  if (f.sessionValid) {
    // Session active, no live ticks (closed/waiting) — last Kite close is fine for info.
    return makePoint(key, assetType, symbol, "kite", "INFO_ONLY", { canDriveSignals: false });
  }
  // No session — delayed Yahoo fallback (info-only, never trade-grade).
  return makePoint(key, assetType, symbol, "yahoo", "DELAYED", { canDriveSignals: false, fallbackUsed: true });
}

// ── Pure: facts → point set ─────────────────────────────────────────────────

export function buildBackbonePoints(f: BackboneRuntimeFacts): BackbonePointSet {
  const indexQuote = tradeGradeEvidencePoint("quote:index", "index", "INDEX", "quote", f);
  const intraday = tradeGradeEvidencePoint("candle:index:15m", "index", "INDEX", "intradayBars", f);
  const daily = tradeGradeEvidencePoint("candle:index:day", "index", "INDEX", "dailyBars", f);
  const optionChain = tradeGradeEvidencePoint("optionchain:index", "option_chain", "INDEX", "optionChain", f);
  const eqQuote = tradeGradeEvidencePoint("quote:equity", "equity", "EQUITY", "quote", f);

  return {
    fno: {
      indexQuote,
      intradayCandles: intraday,
      dailyCandles: daily,
      optionChain,
    },
    swing: {
      dailyCandles: daily,
    },
    optionChain: {
      optionChain,
    },
    watchlist: {
      quote: eqQuote,
    },
    portfolio: {
      quote: eqQuote,
      benchmark: makePoint("benchmark:nifty500", "index", "NIFTY500", "yahoo", "DELAYED", {
        canDriveSignals: false,
        fallbackUsed: true,
      }),
    },
    scanner: {
      quote: infoEvidencePoint("quote:scanner", "equity", "EQUITY", f),
    },
    charting: {
      candles: infoEvidencePoint("candle:charting", "equity", "EQUITY", f),
    },
    home: {
      indexQuote: infoEvidencePoint("quote:home-index", "index", "INDEX", f),
    },
    prePost: {
      indexQuote: infoEvidencePoint("quote:prepost-index", "index", "INDEX", f),
      optionChain:
        optionChain.sourceStatus === "TRADE_GRADE"
          ? optionChain
          : infoEvidencePoint("optionchain:prepost", "option_chain", "INDEX", f),
    },
  };
}

// ── Pure: point set → per-module health ─────────────────────────────────────

export function buildBackboneHealth(points: BackbonePointSet): ModuleDataHealth[] {
  const out: ModuleDataHealth[] = [];
  for (const module of Object.keys(MODULE_REQUIREMENTS) as ModuleId[]) {
    const reqs = MODULE_REQUIREMENTS[module];
    const modulePoints = points[module] ?? {};
    const requirements: ModuleRequirementReadiness[] = [];
    const failures: string[] = [];
    let recoveryAction: string | null = null;
    let status: ModuleStatus = "OK";

    for (const req of reqs) {
      const point =
        modulePoints[req.dataType] ??
        unavailablePoint(`missing:${req.dataType}`, "index", req.dataType, "UNAVAILABLE", `No point collected for ${req.dataType}.`, null);
      const readiness = checkRequirement(point, req);
      requirements.push({ dataType: req.dataType, level: req.level, readiness });

      if (readiness.status === "BLOCKED") {
        status = "BLOCKED";
        failures.push(`${req.dataType}: ${readiness.reason}`);
        if (!recoveryAction && readiness.recoveryAction) recoveryAction = readiness.recoveryAction;
      } else if (readiness.status === "DEGRADED" && status !== "BLOCKED") {
        status = "DEGRADED";
      }
    }

    out.push({
      module,
      requirement: strictestLevel(reqs),
      status,
      requirements,
      failures,
      recoveryAction,
    });
  }
  return out;
}

// ── Thin async collector + full report ──────────────────────────────────────

export interface BackboneReport {
  environment: MarketDataHealth["environment"];
  marketSession: MarketDataHealth["marketSession"];
  kite: {
    sessionStatus: MarketDataHealth["kite"]["sessionStatus"];
    quoteStatus: QuoteStatus;
    tradeGrade: boolean;
    badge: string;
    severity: MarketDataHealth["overall"]["severity"];
  };
  warmup: {
    outcome: WarmupRunResult["outcome"];
    trigger: WarmupRunResult["trigger"];
    startedAt: string;
    finishedAt: string | null;
    durationMs: number;
    indices: { index: string; ok: boolean; steps: WarmupRunResult["indices"][number]["steps"] }[];
    reason: string | null;
  } | null;
  modules: ModuleDataHealth[];
  checkedAt: string;
}

/** Collect existing in-process state into runtime facts (no new network). */
export async function collectBackboneState(): Promise<{ health: MarketDataHealth; warmup: WarmupRunResult | null; facts: BackboneRuntimeFacts }> {
  const health = await buildMarketDataHealth();
  const cycle = getLastFnoCycleState();
  const warmup = getLastWarmupResult();

  const facts: BackboneRuntimeFacts = {
    now: Date.now(),
    sessionValid: health.kite.sessionStatus === "ACTIVE",
    sessionPresent: health.kite.sessionStatus !== "MISSING",
    marketSession: health.marketSession,
    liveTicks: health.kite.tradeGrade,
    quoteStatus: health.kite.quoteStatus,
    warmup,
    cycle: cycle ? { indicesWithBars: cycle.indicesWithBars, suppressed: cycle.suppressed } : null,
  };
  return { health, warmup, facts };
}

/** Full owner-facing backbone report. Thin async orchestrator. */
export async function buildBackboneReport(): Promise<BackboneReport> {
  const { health, warmup, facts } = await collectBackboneState();
  const modules = buildBackboneHealth(buildBackbonePoints(facts));

  return {
    environment: health.environment,
    marketSession: health.marketSession,
    kite: {
      sessionStatus: health.kite.sessionStatus,
      quoteStatus: health.kite.quoteStatus,
      tradeGrade: health.kite.tradeGrade,
      badge: health.overall.badge,
      severity: health.overall.severity,
    },
    warmup: warmup
      ? {
          outcome: warmup.outcome,
          trigger: warmup.trigger,
          startedAt: warmup.startedAt,
          finishedAt: warmup.finishedAt,
          durationMs: warmup.durationMs,
          indices: warmup.indices.map((i) => ({ index: i.index, ok: i.ok, steps: i.steps })),
          reason: warmup.reason,
        }
      : null,
    modules,
    checkedAt: new Date().toISOString(),
  };
}
