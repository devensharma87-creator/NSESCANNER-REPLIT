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

import { feedStatus } from "./kiteFeed";
import {
  publicTokenReconciliationStatus,
  type PublicTokenReconciliationStatus,
} from "./providerTokenReconciliation";
import { getKiteReadiness } from "./kiteReadiness";

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

export type OverallSeverity = "green" | "yellow" | "orange" | "red";

export interface MarketDataHealth {
  environment: "production" | "development";
  marketSession: "open" | "closed" | "pre_open";

  kite: {
    sessionStatus: "ACTIVE" | "EXPIRED" | "MISSING";
    websocketStatus: "CONNECTED" | "DISCONNECTED" | "STOPPED";
    subscribedTokens: number;
    liveQuotesCount: number;
    quoteStatus: QuoteStatus;
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
      return {
        badge: "KITE SESSION ACTIVE — MARKET CLOSED",
        severity: "green",
        userMessage:
          "Kite session is active. Market is closed — live ticks are not expected. Data shown is from the last market session.",
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
      return "Session active. Market is closed — ticks resume at the next trading session.";
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
      return "Scanner results are sourced from live Kite data — trade-grade.";
    case "KITE_MARKET_CLOSED":
      return "Market is closed. Scanner shows data from the last active session. Kite session is active and ready for the next open.";
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

  const scannerSourceStatus = deriveScannerSourceStatus(quoteStatus);
  const overall = deriveOverall(quoteStatus, readiness.sessionPresent);
  const tradeGrade = quoteStatus === "LIVE_TICKS";
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
    checkedAt: now.toISOString(),
  };
}
