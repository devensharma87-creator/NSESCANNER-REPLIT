/**
 * Canonical MarketDataHealth contract.
 *
 * Single source of truth for the whole website's data-source status. Combines:
 *   - KiteReadiness (session validity + market session) from kiteReadiness.ts
 *   - feedStatus() (WebSocket state + live quotes) from kiteFeed.ts
 *   - environment detection (production vs development)
 *
 * SAFETY RULES (enforced by the pure derivers — unit-tested):
 *   - No secrets, API keys, tokens, chat IDs, or user PII are included.
 *   - No trading mutation — purely reads existing in-process state.
 *   - Every exported deriver is PURE and synchronous so it can be unit-tested
 *     without mocking DB or network.
 *
 * Used by:
 *   - GET /api/data-health/market (PUBLIC)
 *   - Frontend kite-offline-banner.tsx (switches from /api/provider/status)
 *   - Frontend global-status-banner.tsx (supplements /api/kite/status)
 */

import { feedStatus, subscribedTokenSnapshot } from "./kiteFeed";
import {
  publicTokenReconciliationStatus,
  type PublicTokenReconciliationStatus,
} from "./providerTokenReconciliation";
import { getKiteReadiness } from "./kiteReadiness";
import { buildLiveAggregateCoverage } from "./marketData/aggregateCoverageLive";
import {
  toPublicAggregateCoverage,
  type PublicAggregateCoverage,
} from "./marketData/aggregateCoverage";
import { toAuthoritativeCoverageManifest } from "./registry/coverageBridge";
import { getActiveGeneration } from "./registry/manifestStore";

/**
 * @deprecated Phase 0.5B — `LIVE_TICKS` is NOT a coverage claim.
 *
 * It means only "at least one quote exists in the store". It says nothing
 * about how much of the required universe is covered, whether any individual
 * quote is fresh, whether subscriptions succeeded, or whether a provider-token
 * reconciliation is outstanding.
 *
 * Its meaning is deliberately UNCHANGED here so existing consumers do not
 * silently shift underneath them. New consumers must read
 * `MarketDataHealth.coverage` instead, which carries the real per-instrument
 * freshness and coverage accounting.
 */
export type QuoteStatus =
  | "LIVE_TICKS"
  | "CONNECTED_WAITING"
  | "MARKET_CLOSED_SESSION_ACTIVE"
  | "STALE"
  | "UNAVAILABLE";

export type ScannerSourceStatus =
  | "KITE_LIVE"
  | "KITE_MARKET_CLOSED"
  | "KITE_WAITING"
  | "STALE_CACHE"
  | "YAHOO_DELAYED";

export type FallbackLabel = "NOT_USED" | "INFO_ONLY_DELAYED" | "STALE";

/**
 * `neutral` (Phase 0.5B final) is NOT a health claim. It means "no live claim
 * is being made" — used for the market-closed last-known presentation, which
 * must not render as a green all-good badge.
 */
export type OverallSeverity = "neutral" | "green" | "yellow" | "orange" | "red";

export interface MarketDataHealth {
  environment: "production" | "development";
  marketSession: "open" | "closed" | "pre_open";

  kite: {
    sessionStatus: "ACTIVE" | "EXPIRED" | "MISSING";
    websocketStatus: "CONNECTED" | "DISCONNECTED" | "STOPPED";
    subscribedTokens: number;
    liveQuotesCount: number;
    /**
     * @deprecated Phase 0.5B — see the `QuoteStatus` note. A `LIVE_TICKS` value
     * here does NOT mean the market is fully covered. Read `coverage` instead.
     */
    quoteStatus: QuoteStatus;
    /**
     * @deprecated Phase 0.5B — derived from the deprecated `quoteStatus`, so it
     * inherits the same blind spot. Use `coverage.overallState`.
     */
    tradeGrade: boolean;
    explanation: string;
    /**
     * Deferred provider-token rotations. PUBLIC surface, so this carries the
     * state and count ONLY — never canonical ids, provider tokens, failure
     * detail, or anything credential-bearing. Owner detail lives on
     * /api/kite/status (feedStatus().tokenReconciliation).
     */
    tokenReconciliation: PublicTokenReconciliationStatus;
  };

  scanner: {
    sourceStatus: ScannerSourceStatus;
    tradeGrade: boolean;
    explanation: string;
  };

  fallback: {
    yahooEnabled: boolean;
    yahooActive: boolean;
    label: FallbackLabel;
    explanation: string;
  };

  overall: {
    badge: string;
    severity: OverallSeverity;
    userMessage: string;
    actionRequired: boolean;
    action: string | null;
  };

  /**
   * Phase 0.5B — the TRUTHFUL aggregate status. Additive: it does not change
   * any existing field's meaning.
   *
   * This is the only field that carries real coverage and per-instrument
   * freshness accounting. It reports coverage against the configured feed and
   * against the (not-yet-configured) authoritative universe separately, so a
   * partial legacy feed can never be presented as complete market coverage.
   *
   * PUBLIC-SAFE: aggregate counts and states only — no canonical identities,
   * provider tokens, or credentials.
   */
  coverage: PublicAggregateCoverage;

  checkedAt: string;
}

export interface DeriveQuoteStatusInput {
  sessionValid: boolean;
  marketSession: "open" | "closed" | "pre_open";
  feedConnected: boolean;
  feedRunning: boolean;
  liveQuotesCount: number;
}

/**
 * PURE: derives the canonical quoteStatus from existing primitives.
 *
 * Key design: when market is closed OR pre_open, liveQuotesCount=0 is
 * EXPECTED — we return MARKET_CLOSED_SESSION_ACTIVE rather than UNAVAILABLE.
 * This is the root fix for the "Kite live" vs "Yahoo fallback" contradiction
 * that previously appeared after market hours when liveQuotes dropped to 0.
 */
export function deriveQuoteStatus(input: DeriveQuoteStatusInput): QuoteStatus {
  if (!input.sessionValid) return "UNAVAILABLE";
  if (input.marketSession === "open") {
    if (input.liveQuotesCount > 0) return "LIVE_TICKS";
    if (input.feedConnected || input.feedRunning) return "CONNECTED_WAITING";
    return "STALE";
  }
  // "closed" or "pre_open" — no ticks expected; session is active and ready
  return "MARKET_CLOSED_SESSION_ACTIVE";
}

/** PURE: maps quoteStatus → ScannerSourceStatus. */
export function deriveScannerSourceStatus(quoteStatus: QuoteStatus): ScannerSourceStatus {
  switch (quoteStatus) {
    case "LIVE_TICKS":                  return "KITE_LIVE";
    case "CONNECTED_WAITING":           return "KITE_WAITING";
    case "MARKET_CLOSED_SESSION_ACTIVE": return "KITE_MARKET_CLOSED";
    case "STALE":                       return "STALE_CACHE";
    case "UNAVAILABLE":                 return "YAHOO_DELAYED";
  }
}

/** PURE: maps quoteStatus + session presence → overall badge/severity/message. */
export function deriveOverall(
  quoteStatus: QuoteStatus,
  sessionPresent: boolean,
  lastKnownAsOf?: string | null,
): MarketDataHealth["overall"] {
  switch (quoteStatus) {
    case "LIVE_TICKS":
      return {
        badge: "KITE LIVE",
        severity: "green",
        userMessage: "Live Kite ticks streaming. Scanner and signals are trade-grade.",
        actionRequired: false,
        action: null,
      };
    case "CONNECTED_WAITING":
      return {
        badge: "KITE SESSION ACTIVE — WAITING FOR TICKS",
        severity: "yellow",
        userMessage:
          "Kite session and WebSocket are active but no live ticks have arrived yet. Scanner may show delayed data from the last cycle.",
        actionRequired: false,
        action: null,
      };
    case "MARKET_CLOSED_SESSION_ACTIVE":
      // Phase 0.5B final: NOT green. "Market is closed" is a statement about
      // the session, not a health claim about the data. This path has no
      // verified official session close available to it, so the only honest
      // presentation is neutral LAST KNOWN, stamped with the observation time.
      // A green badge here would assert current, complete, correct data at
      // exactly the moment the system can least support that claim.
      return {
        badge: "MARKET CLOSED — LAST KNOWN",
        severity: "neutral",
        userMessage:
          "Market is closed. Values shown are the last known observations" +
          (lastKnownAsOf ? ` (as of ${lastKnownAsOf})` : "") +
          ", not verified official session closes. Kite session is active and ready for the next open.",
        actionRequired: false,
        action: null,
      };
    case "STALE":
      return {
        badge: "KITE STALE — RECONNECTING",
        severity: "orange",
        userMessage:
          "Kite session is valid but the WebSocket feed has disconnected. Data may be stale until the feed reconnects.",
        actionRequired: false,
        action: null,
      };
    case "UNAVAILABLE":
      return {
        badge: sessionPresent ? "KITE LOGIN REQUIRED" : "NO LIVE DATA",
        severity: "red",
        userMessage: sessionPresent
          ? "Kite session has expired. Scanner is using delayed Yahoo Finance data (info-only, not trade-grade). Complete the Zerodha daily reconnect to restore live data."
          : "No Kite session configured. Scanner is using delayed Yahoo Finance data (info-only, not trade-grade).",
        actionRequired: true,
        action: "/kite",
      };
  }
}

/**
 * PURE (Phase 0.5B final): does real coverage back a LIVE / trade-grade claim?
 *
 * `LIVE_TICKS` proves only that at least one quote exists in the store. It is
 * therefore never sufficient on its own. Every green / live / trade-grade
 * surface must pass through this gate.
 */
export function coverageBacksLiveClaim(
  coverage: Pick<PublicAggregateCoverage, "overallState">,
): boolean {
  return coverage.overallState === "LIVE_COMPLETE";
}

/**
 * PURE (Phase 0.5B final): downgrade a green LIVE badge that coverage cannot
 * support. Applied at the composition site so the legacy deriver's own
 * contract stays untouched for existing callers.
 */
export function applyCoverageToOverall(
  overall: MarketDataHealth["overall"],
  quoteStatus: QuoteStatus,
  coverage: PublicAggregateCoverage,
): MarketDataHealth["overall"] {
  if (quoteStatus !== "LIVE_TICKS") return overall;
  if (coverageBacksLiveClaim(coverage)) return overall;
  return {
    badge: "KITE LIVE — PARTIAL COVERAGE",
    severity: "yellow",
    userMessage:
      `Live Kite ticks are arriving, but only ${coverage.freshInstrumentCount} of ` +
      `${coverage.requiredInstrumentCount} configured instruments carry a current value ` +
      `(coverage state ${coverage.overallState}). This is not whole-market coverage and ` +
      `is not trade-grade.`,
    actionRequired: false,
    action: null,
  };
}

/**
 * PURE (Phase 0.5B final): a trade-grade claim requires BOTH a live quote
 * status and coverage that can back it. Legacy `LIVE_TICKS` alone cannot.
 */
export function deriveTradeGrade(
  quoteStatus: QuoteStatus,
  coverage: Pick<PublicAggregateCoverage, "overallState">,
): boolean {
  return quoteStatus === "LIVE_TICKS" && coverageBacksLiveClaim(coverage);
}

/** PURE: derives the kite.explanation string. */
export function deriveKiteExplanation(
  quoteStatus: QuoteStatus,
  sessionValid: boolean,
  sessionPresent: boolean,
  liveQuotesCount: number,
): string {
  if (!sessionValid) {
    return sessionPresent
      ? "Kite session has expired — complete the Zerodha daily login to restore live data."
      : "No Kite session. Configure Kite API credentials to enable live data.";
  }
  switch (quoteStatus) {
    case "LIVE_TICKS":
      return `Live Kite ticks streaming (${liveQuotesCount} symbol${liveQuotesCount !== 1 ? "s" : ""}).`;
    case "CONNECTED_WAITING":
      return "Session active, WebSocket connected — waiting for the first tick of the session.";
    case "MARKET_CLOSED_SESSION_ACTIVE":
      return "Session active. Market is closed — last known values only, not verified official closes. Ticks resume at the next trading session.";
    case "STALE":
      return "Session active but WebSocket feed has stopped. Feed will attempt to reconnect.";
    default:
      return "";
  }
}

/** PURE: derives the scanner.explanation string. */
export function deriveScannerExplanation(sourceStatus: ScannerSourceStatus): string {
  switch (sourceStatus) {
    case "KITE_LIVE":
      return "Scanner results are sourced from live Kite data.";
    case "KITE_MARKET_CLOSED":
      return "Market is closed. Scanner shows the last known values from the previous session — not verified official closes. Kite session is active and ready for the next open.";
    case "KITE_WAITING":
      return "Kite session is connected but ticks have not arrived yet. Scanner may show cached data from the previous cycle.";
    case "STALE_CACHE":
      return "Scanner data may be stale — Kite WebSocket is reconnecting.";
    case "YAHOO_DELAYED":
      return "Scanner is using delayed Yahoo Finance data (~15 min delayed). Info-only — signals and paper trading are blocked.";
  }
}

/**
 * Async entry-point — reads live in-process state from feedStatus() +
 * getKiteReadiness(), then calls the pure derivers.
 */
export async function buildMarketDataHealth(): Promise<MarketDataHealth> {
  const now = new Date();
  const feed = feedStatus();
  const readiness = await getKiteReadiness();

  const environment: "production" | "development" =
    process.env["REPLIT_DEPLOYMENT"] === "1" ? "production" : "development";

  const liveQuotesCount = feed.liveQuotes;

  const quoteStatus = deriveQuoteStatus({
    sessionValid: readiness.sessionValid,
    marketSession: readiness.marketSession,
    feedConnected: readiness.feedConnected,
    feedRunning: readiness.feedRunning,
    liveQuotesCount,
  });

  // Phase 0.5B: real coverage accounting. Reads in-process state only — no
  // provider call, no DB access, no timer.
  const coverage = toPublicAggregateCoverage(
    buildLiveAggregateCoverage(
      {
        subscribedTokens: subscribedTokenSnapshot(),
        connected: readiness.feedConnected,
        running: readiness.feedRunning,
      },
      now.getTime(),
      // Phase 0.6: the reconciled authoritative denominator, if one has been
      // durably accepted. `getActiveGeneration()` is an in-memory read of a
      // generation that was already loaded/committed elsewhere — it performs no
      // DB access on this path. With no accepted generation the bridge returns
      // the not-configured manifest, so behaviour is unchanged until a registry
      // generation actually exists.
      toAuthoritativeCoverageManifest(getActiveGeneration(), now.getTime()),
    ),
  );

  const scannerSourceStatus = deriveScannerSourceStatus(quoteStatus);

  // Phase 0.5B final: every LIVE / green / trade-grade claim below is gated on
  // real coverage. The deprecated LIVE_TICKS status can no longer, on its own,
  // produce a green badge or a trade-grade flag anywhere in this payload.
  const overall = applyCoverageToOverall(
    deriveOverall(quoteStatus, readiness.sessionPresent, coverage.newestObservationAt),
    quoteStatus,
    coverage,
  );
  const tradeGrade = deriveTradeGrade(quoteStatus, coverage);
  const yahooActive = quoteStatus === "UNAVAILABLE";

  const kiteSessionStatus: "ACTIVE" | "EXPIRED" | "MISSING" = readiness.sessionValid
    ? "ACTIVE"
    : readiness.sessionPresent
      ? "EXPIRED"
      : "MISSING";

  const kiteWebsocketStatus: "CONNECTED" | "DISCONNECTED" | "STOPPED" = readiness.feedConnected
    ? "CONNECTED"
    : readiness.feedRunning
      ? "DISCONNECTED"
      : "STOPPED";

  return {
    environment,
    marketSession: readiness.marketSession,

    kite: {
      sessionStatus: kiteSessionStatus,
      websocketStatus: kiteWebsocketStatus,
      subscribedTokens: feed.subscribed,
      liveQuotesCount,
      quoteStatus,
      tradeGrade,
      explanation: deriveKiteExplanation(
        quoteStatus,
        readiness.sessionValid,
        readiness.sessionPresent,
        liveQuotesCount,
      ),
      tokenReconciliation: publicTokenReconciliationStatus(),
    },

    scanner: {
      sourceStatus: scannerSourceStatus,
      tradeGrade,
      explanation: deriveScannerExplanation(scannerSourceStatus),
    },

    fallback: {
      yahooEnabled: true,
      yahooActive,
      label: yahooActive ? "INFO_ONLY_DELAYED" : "NOT_USED",
      explanation: yahooActive
        ? "Yahoo Finance fallback is active (~15 min delayed). Not trade-grade — signals and paper trading are blocked."
        : "Yahoo Finance is available as fallback but Kite is currently active.",
    },

    overall,
    coverage,
    checkedAt: now.toISOString(),
  };
}
