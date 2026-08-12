/**
 * Canonical GlobalDataHealth contract — "Kite Pre-Open Resilience + Global
 * Data Health Banner + No Silent Data Degradation".
 *
 * Thin orchestrator that unifies existing in-process state into a single
 * GlobalDataHealth object.  Calls:
 *   - collectBackboneState()  (MarketDataHealth + BackboneRuntimeFacts)
 *   - buildBackboneHealth()   (pure: facts → per-module ModuleDataHealth[])
 *   - buildBackbonePoints()   (pure: facts → point set)
 *   - getKiteReadiness()      (isPreOpenWindow)
 *   - getLastAlertRecord()    (last Telegram alert metadata, no secrets)
 *
 * SAFETY RULES (enforced by the pure derivers — all unit-tested):
 *   - No secrets, tokens, API keys, chat IDs, or user PII.
 *   - No trading mutations — purely reads existing in-process state.
 *   - Yahoo / DELAYED / BLOCKED data NEVER sets canDriveSignals = true.
 *   - All exported derivers are PURE so they can be tested without DB/network.
 *
 * Used by:
 *   - GET /api/data-health/global  (PUBLIC — safe by construction)
 *   - GlobalStatusBanner (DATA_DEGRADED chip via the endpoint above)
 *   - Infra Health page — GlobalHealthSection
 */

import { collectBackboneState, buildBackboneHealth, buildBackbonePoints } from "./backboneHealth";
import type { ModuleDataHealth, ModuleStatus } from "./backboneHealth";
import { getKiteReadiness } from "./kiteReadiness";
import { getLastAlertRecord } from "./alerting";
import type { QuoteStatus, FallbackLabel } from "./marketDataHealth";
import type { PublicAggregateCoverage } from "./marketData/aggregateCoverage";

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * Canonical status representing the global data health, derived from session,
 * feed, market session, and backbone module statuses.
 *
 * Precedence (first match wins):
 *   1. KITE_SESSION_MISSING        — no session configured
 *   2. KITE_SESSION_EXPIRED        — session present but expired
 *   3. SESSION_ACTIVE_MARKET_CLOSED — valid session, market closed (no ticks expected)
 *   4. KITE_FEED_DISCONNECTED      — valid session, market open, feed stopped
 *   5. TRADE_GRADE_LIVE            — live ticks flowing, no BLOCKED modules
 *   6. DEGRADED_DATA               — live ticks flowing but some modules BLOCKED
 *   7. KITE_PARTIAL                — connected/waiting or some modules DEGRADED
 *   8. UNAVAILABLE                 — fallthrough
 */
export type GlobalDataHealthStatus =
  | "TRADE_GRADE_LIVE"
  | "SESSION_ACTIVE_MARKET_CLOSED"
  | "KITE_PARTIAL"
  | "DEGRADED_DATA"
  | "KITE_SESSION_EXPIRED"
  | "KITE_SESSION_MISSING"
  | "KITE_FEED_DISCONNECTED"
  | "UNAVAILABLE";

export type GlobalDataHealthSeverity = "ok" | "info" | "warn" | "orange" | "red";

/** Per-module health entry, mapped from backbone's ModuleDataHealth. */
export interface ModuleHealth {
  /**
   * TRADE_GRADE = module can drive signals (Kite active, no failures).
   * DELAYED     = info-only / Yahoo fallback.
   * BLOCKED     = cannot operate (missing session, warmup failed, etc.).
   * UNAVAILABLE = no data at all.
   */
  status: "TRADE_GRADE" | "DELAYED" | "BLOCKED" | "UNAVAILABLE";
  source: "kite" | "yahoo" | "none";
  /** True ONLY when status=TRADE_GRADE AND Kite session is ACTIVE. */
  canDriveSignals: boolean;
  canDrivePaperTrading: boolean;
  canDriveTelegramTradeAlerts: boolean;
  /** First failure reason from the backbone, or null. */
  reason: string | null;
}

export interface GlobalDataHealth {
  overallStatus: GlobalDataHealthStatus;
  severity: GlobalDataHealthSeverity;
  /** Short uppercase label, e.g. "KITE LIVE" or "DATA DEGRADED". */
  badge: string;
  /** One-sentence headline explaining the status for display. */
  headline: string;

  kite: {
    sessionStatus: "ACTIVE" | "EXPIRED" | "MISSING";
    /** Boolean only — no token value exposed. */
    accessTokenPresent: boolean;
    websocketStatus: "CONNECTED" | "DISCONNECTED" | "STOPPED";
    liveQuotesCount: number;
    quoteStatus: QuoteStatus;
    tradeGrade: boolean;
    marketSession: "open" | "closed" | "pre_open";
    isPreOpenWindow: boolean;
  };

  /**
   * Per-module health keyed by ModuleId:
   * fno | swing | optionChain | watchlist | portfolio | scanner | charting | home | prePost
   */
  modules: Record<string, ModuleHealth>;

  /**
   * Phase 0.5B — truthful coverage accounting (public-safe aggregate counts
   * only). This is the field that says how much of the required universe is
   * actually fresh; `kite.quoteStatus` and `kite.tradeGrade` are deprecated
   * and cannot answer that.
   */
  coverage: PublicAggregateCoverage;

  fallback: {
    yahooActive: boolean;
    label: FallbackLabel;
  };

  userAction: {
    required: boolean;
    reason: string | null;
    /** Relative app path for the action (e.g. "/kite"), or null. */
    path: string | null;
  };

  preOpenAlert: {
    isPreOpenWindow: boolean;
    /** True if at least one pre-open alert fired in this process lifetime. */
    alertFired: boolean;
    lastAlertEvent: string | null;
    lastAlertAt: string | null;
  };

  warnings: string[];
  checkedAt: string;
}

// ── Pure derivers (all unit-tested, no I/O) ──────────────────────────────────

/**
 * PURE: maps backbone ModuleStatus → GlobalDataHealth ModuleHealth status tier.
 * BLOCKED from backbone stays BLOCKED; DEGRADED → DELAYED; OK → TRADE_GRADE.
 */
export function deriveModuleHealthStatus(status: ModuleStatus): ModuleHealth["status"] {
  switch (status) {
    case "OK": return "TRADE_GRADE";
    case "DEGRADED": return "DELAYED";
    case "BLOCKED": return "BLOCKED";
    default: return "UNAVAILABLE";
  }
}

/**
 * PURE: module health status → canDriveSignals.
 * Invariant: only TRADE_GRADE modules with an active Kite session can drive signals.
 * Yahoo / DELAYED / BLOCKED NEVER return true — this is an unconditional hard rule.
 */
export function deriveCanDriveSignals(
  status: ModuleHealth["status"],
  isKiteActive: boolean,
): boolean {
  return status === "TRADE_GRADE" && isKiteActive;
}

/**
 * PURE: maps a backbone ModuleDataHealth[] to the spec's ModuleHealth Record.
 * Source is "kite" when TRADE_GRADE, "yahoo" when yahoo fallback is active
 * and status is DELAYED, "none" otherwise.
 */
export function buildModuleHealthMap(
  modules: ModuleDataHealth[],
  isKiteActive: boolean,
  yahooFallbackActive: boolean,
): Record<string, ModuleHealth> {
  const out: Record<string, ModuleHealth> = {};
  for (const m of modules) {
    const status = deriveModuleHealthStatus(m.status);
    const canDrive = deriveCanDriveSignals(status, isKiteActive);
    const source: ModuleHealth["source"] =
      status === "TRADE_GRADE" ? "kite" :
      (yahooFallbackActive && status === "DELAYED") ? "yahoo" : "none";
    out[m.module] = {
      status,
      source,
      canDriveSignals: canDrive,
      canDrivePaperTrading: canDrive,
      canDriveTelegramTradeAlerts: canDrive,
      reason: m.failures[0] ?? null,
    };
  }
  return out;
}

/**
 * PURE: derives the GlobalDataHealthStatus from primitives.
 *
 * Precedence matters — see type-level docstring.  Session-level problems
 * always take priority over module-level problems.  Yahoo fallback NEVER
 * yields TRADE_GRADE_LIVE.
 */
export function deriveGlobalDataHealthStatus(
  sessionStatus: "ACTIVE" | "EXPIRED" | "MISSING",
  quoteStatus: QuoteStatus,
  anyBlocked: boolean,
  anyDegraded: boolean,
): GlobalDataHealthStatus {
  if (sessionStatus === "MISSING") return "KITE_SESSION_MISSING";
  if (sessionStatus === "EXPIRED") return "KITE_SESSION_EXPIRED";
  // Session is ACTIVE from here.
  if (quoteStatus === "MARKET_CLOSED_SESSION_ACTIVE") return "SESSION_ACTIVE_MARKET_CLOSED";
  if (quoteStatus === "STALE") return "KITE_FEED_DISCONNECTED";
  if (quoteStatus === "LIVE_TICKS") {
    if (anyBlocked) return "DEGRADED_DATA";
    return "TRADE_GRADE_LIVE";
  }
  if (quoteStatus === "CONNECTED_WAITING") return "KITE_PARTIAL";
  // Fallback: session active but unexpected state.
  if (anyBlocked) return "DEGRADED_DATA";
  if (anyDegraded) return "KITE_PARTIAL";
  return "UNAVAILABLE";
}

/**
 * PURE (Phase 0.5B): downgrade a completeness claim that coverage cannot back.
 *
 * `deriveGlobalDataHealthStatus` reaches TRADE_GRADE_LIVE off the deprecated
 * `LIVE_TICKS` quote status, which only proves that at least one quote exists.
 * TRADE_GRADE_LIVE renders as a green "all good" banner, so leaving it
 * ungated would describe a partial legacy feed as complete live coverage.
 *
 * The legacy deriver's own contract is deliberately left untouched; this gate
 * is applied on top of it at the composition site.
 */
export function applyCoverageGate(
  status: GlobalDataHealthStatus,
  coverageComplete: boolean,
  coverageState?: string,
): GlobalDataHealthStatus {
  if (status === "TRADE_GRADE_LIVE" && !coverageComplete) return "KITE_PARTIAL";

  // SESSION_ACTIVE_MARKET_CLOSED also renders green. That label is a claim
  // about the SESSION, not the data, and after close it is normally accurate.
  // But an integrity fault does not become acceptable because the market shut:
  // a conflicted quote or an unresolved token rotation means stored prices may
  // be wrong or misattributed, and that must never sit behind a green badge.
  //
  // Deliberately NOT downgraded on coverage STALE: after close, every
  // instrument degrades to LAST_KNOWN because no verified official close is
  // available to this path yet. That is a known, separately-reported gap, and
  // firing an amber badge every single evening for an expected condition would
  // train the owner to ignore the badge.
  if (
    status === "SESSION_ACTIVE_MARKET_CLOSED" &&
    (coverageState === "CONFLICTED" || coverageState === "RECONCILIATION_PENDING")
  ) {
    return "DEGRADED_DATA";
  }
  return status;
}

/** PURE: maps GlobalDataHealthStatus → severity tier. */
export function deriveGlobalSeverity(status: GlobalDataHealthStatus): GlobalDataHealthSeverity {
  switch (status) {
    case "TRADE_GRADE_LIVE":              return "ok";
    // Phase 0.5B final: NEUTRAL, not "ok". "Market closed" describes the
    // session, not the health of the data. With no verified official close
    // available to this path, the only supportable claim is "last known".
    case "SESSION_ACTIVE_MARKET_CLOSED":  return "info";
    case "KITE_PARTIAL":                  return "warn";
    case "DEGRADED_DATA":                 return "orange";
    case "KITE_FEED_DISCONNECTED":        return "orange";
    case "KITE_SESSION_EXPIRED":          return "red";
    case "KITE_SESSION_MISSING":          return "red";
    case "UNAVAILABLE":                   return "red";
  }
}

/** PURE: maps GlobalDataHealthStatus → { badge, headline } pair. */
export function deriveBadgeAndHeadline(status: GlobalDataHealthStatus): { badge: string; headline: string } {
  switch (status) {
    case "TRADE_GRADE_LIVE":
      return {
        badge: "KITE LIVE",
        headline: "Live Kite data streaming — scanner, signals, and paper trading are trade-grade.",
      };
    case "SESSION_ACTIVE_MARKET_CLOSED":
      return {
        badge: "MARKET CLOSED — LAST KNOWN",
        headline:
          "Market is closed. Values shown are the last known observations, not verified official session closes. Kite session is active and ready for the next open.",
      };
    case "KITE_PARTIAL":
      return {
        badge: "KITE PARTIAL",
        headline: "Session active but one or more modules are warming up or have partial data.",
      };
    case "DEGRADED_DATA":
      return {
        badge: "DATA DEGRADED",
        headline: "Kite session is active but some modules are blocked — certain pages may show delayed or cached data.",
      };
    case "KITE_FEED_DISCONNECTED":
      return {
        badge: "KITE FEED DISCONNECTED",
        headline: "Session valid but WebSocket feed has stopped. Data may be stale until the feed reconnects.",
      };
    case "KITE_SESSION_EXPIRED":
      return {
        badge: "KITE LOGIN REQUIRED",
        headline: "Kite session expired. Complete the Zerodha daily reconnect to restore live data.",
      };
    case "KITE_SESSION_MISSING":
      return {
        badge: "NO LIVE DATA",
        headline: "No Kite session configured. Scanner uses delayed Yahoo Finance data — not trade-grade.",
      };
    case "UNAVAILABLE":
      return {
        badge: "DATA UNAVAILABLE",
        headline: "Live data unavailable. Check Kite connection and session status.",
      };
  }
}

// ── Async orchestrator ────────────────────────────────────────────────────────

/**
 * Builds the canonical GlobalDataHealth from existing in-process state.
 *
 * Calls collectBackboneState() + getKiteReadiness() in parallel, then
 * runs the pure derivers synchronously.  getLastAlertRecord() is synchronous
 * (no I/O) so it doesn't need awaiting.
 *
 * SAFE: no secrets, no mutations, no new network beyond what
 * getKiteReadiness() / getActiveSession() already do in the call chain.
 */
export async function buildGlobalDataHealth(): Promise<GlobalDataHealth> {
  const [{ health, facts }, readiness] = await Promise.all([
    collectBackboneState(),
    getKiteReadiness(),
  ]);

  const lastAlert = getLastAlertRecord();

  const modules = buildBackboneHealth(buildBackbonePoints(facts));
  const anyBlocked = modules.some((m) => m.status === "BLOCKED");
  const anyDegraded = modules.some((m) => m.status === "DEGRADED");

  // Phase 0.5B: a green "trade-grade live" claim now requires real coverage,
  // not merely a non-zero quote count.
  const overallStatus = applyCoverageGate(
    deriveGlobalDataHealthStatus(
      health.kite.sessionStatus,
      health.kite.quoteStatus,
      anyBlocked,
      anyDegraded,
    ),
    health.coverage.overallState === "LIVE_COMPLETE",
    health.coverage.overallState,
  );
  const severity = deriveGlobalSeverity(overallStatus);
  const { badge, headline } = deriveBadgeAndHeadline(overallStatus);

  const isKiteActive = health.kite.sessionStatus === "ACTIVE";
  const moduleHealthMap = buildModuleHealthMap(modules, isKiteActive, health.fallback.yahooActive);

  const warnings: string[] = [];
  if (isKiteActive && anyBlocked) {
    warnings.push(
      "One or more modules are BLOCKED despite a valid Kite session. Check /infra-health for backbone diagnostics.",
    );
  }
  if (health.fallback.yahooActive) {
    warnings.push(
      "Yahoo Finance fallback is active (~15 min delayed). Not trade-grade — signals and paper trading are blocked.",
    );
  }

  return {
    overallStatus,
    severity,
    badge,
    headline,

    kite: {
      sessionStatus: health.kite.sessionStatus,
      accessTokenPresent: isKiteActive,
      websocketStatus: health.kite.websocketStatus,
      liveQuotesCount: health.kite.liveQuotesCount,
      quoteStatus: health.kite.quoteStatus,
      tradeGrade: health.kite.tradeGrade,
      marketSession: health.marketSession,
      isPreOpenWindow: readiness.isPreOpenWindow,
    },

    modules: moduleHealthMap,

    coverage: health.coverage,

    fallback: {
      yahooActive: health.fallback.yahooActive,
      label: health.fallback.label,
    },

    userAction: {
      required: health.overall.actionRequired,
      reason: health.overall.actionRequired ? health.overall.userMessage : null,
      path: health.overall.action,
    },

    preOpenAlert: {
      isPreOpenWindow: readiness.isPreOpenWindow,
      alertFired: lastAlert !== null,
      lastAlertEvent: lastAlert?.event ?? null,
      lastAlertAt: lastAlert ? new Date(lastAlert.at).toISOString() : null,
    },

    warnings,
    checkedAt: new Date().toISOString(),
  };
}
