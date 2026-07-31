/**
 * B1.1 — Provider Capability Registry.
 *
 * Machine-readable capability state per provider+domain combination.
 * This is the single source of truth for: is a given provider able to serve
 * a given data domain right now, and if not, why?
 *
 * Consumers: diagnostics route (/api/data/diagnostics), /system/mode.
 * Callers must never fabricate AVAILABLE or simulate success when the
 * underlying credential or session is genuinely absent.
 */

import { kiteHealth, kiteSessionActive } from "./kiteProvider";

// ── Capability state vocabulary ──────────────────────────────────────────────
// Maps precisely to Prompt 17 §7 capability states.

export type ProviderCapabilityState =
  | "AVAILABLE"        // Provider is configured, authenticated, and actively serving this domain.
  | "NOT_CONFIGURED"   // Required credentials/environment variables are absent.
  | "AUTH_EXPIRED"     // Credentials are present but the session has expired or is inactive.
  | "UNSUPPORTED"      // The provider does not support this data domain.
  | "DEGRADED"         // Provider is configured and authenticated but serving with degraded quality.
  | "RATE_LIMITED"     // Provider is rejecting requests due to rate limits.
  | "UNAVAILABLE";     // Provider is otherwise unreachable or returning errors.

// ── Data domains ─────────────────────────────────────────────────────────────

export type DataDomain =
  | "index_quote"        // Live NSE/BSE/BSE-SENSEX spot index
  | "equity_quote"       // Live NSE/BSE equity last-trade price
  | "intraday_candles"   // Intraday OHLCV candles (1m–60m)
  | "daily_candles"      // Daily/historical OHLCV candles
  | "instrument_master"  // NSE/BSE instrument/contract master
  | "option_chain"       // F&O option chain with OI/premiums
  | "market_status";     // Market open/close/session state

// ── Per-provider-domain capability record ─────────────────────────────────────

export interface ProviderDomainCapability {
  provider: "kite" | "upstox" | "indianapi" | "yahoo" | "nse" | "indstocks";
  domain: DataDomain;
  state: ProviderCapabilityState;
  /** Human-readable reason for any non-AVAILABLE state. */
  reason: string;
  /** When the capability was last evaluated (ISO). */
  evaluatedAt: string;
}

export interface ProviderCapabilitySnapshot {
  evaluatedAt: string;
  capabilities: ProviderDomainCapability[];
  /** Summary: which providers are fully AVAILABLE for any trade-sensitive domain. */
  tradeAvailableProviders: string[];
  /** The authoritative provider for trade-sensitive decisions in this deployment. */
  authoritative: "kite";
}

// ── Kite capability evaluation ────────────────────────────────────────────────

function kiteCapabilities(evaluatedAt: string): ProviderDomainCapability[] {
  const health = kiteHealth();
  const sessionActive = kiteSessionActive();

  let state: ProviderCapabilityState;
  let reason: string;

  if (!health.credsConfigured) {
    state = "NOT_CONFIGURED";
    reason = "KITE_API_KEY / KITE_API_SECRET / KITE_TOKEN_ENC_KEY not configured.";
  } else if (!sessionActive) {
    state = "AUTH_EXPIRED";
    reason =
      "Kite credentials present but daily session token is inactive or expired. " +
      "Owner must complete the Zerodha daily login to reactivate.";
  } else {
    state = "AVAILABLE";
    reason = `Live: ${health.liveQuotes} quotes streaming across ${health.subscribed} subscriptions.`;
  }

  const KITE_DOMAINS: DataDomain[] = [
    "index_quote",
    "equity_quote",
    "intraday_candles",
    "daily_candles",
    "instrument_master",
    "option_chain",
    "market_status",
  ];

  return KITE_DOMAINS.map((domain) => ({ provider: "kite", domain, state, reason, evaluatedAt }));
}

// ── Upstox capability evaluation ─────────────────────────────────────────────

function upstoxCapabilities(evaluatedAt: string): ProviderDomainCapability[] {
  // No Upstox env vars are configured in this deployment.
  // Do not fabricate endpoints, sessions, or successful fixtures.
  const state: ProviderCapabilityState = "NOT_CONFIGURED";
  const reason =
    "UPSTOX_API_KEY / UPSTOX_API_SECRET / UPSTOX_ACCESS_TOKEN absent. " +
    "Upstox is not an active secondary source in this deployment. " +
    "Prerequisite to activate: configure credentials and implement the Upstox adapter.";

  const UPSTOX_DOMAINS: DataDomain[] = [
    "index_quote",
    "equity_quote",
    "intraday_candles",
    "daily_candles",
    "instrument_master",
    "option_chain",
    "market_status",
  ];

  return UPSTOX_DOMAINS.map((domain) => ({ provider: "upstox", domain, state, reason, evaluatedAt }));
}

// ── IndianAPI capability evaluation ──────────────────────────────────────────

function indianApiCapabilities(evaluatedAt: string): ProviderDomainCapability[] {
  // No IndianAPI credentials are configured in this deployment.
  // B1.1 defers fundamentals/news/FII-DII to B1.2; only note as NOT_CONFIGURED.
  const state: ProviderCapabilityState = "NOT_CONFIGURED";
  const reason =
    "INDIANAPI_KEY / INDIAN_API_KEY absent. " +
    "IndianAPI is not an active source in this deployment. " +
    "Prerequisite to activate: obtain API key and verified contracted endpoint specification. " +
    "Fundamentals / news / FII-DII deferred to B1.2.";

  // IndianAPI does NOT support live trade-sensitive domains in B1.1.
  const NOT_SUPPORTED: DataDomain[] = [
    "index_quote", "equity_quote", "intraday_candles", "daily_candles", "option_chain",
  ];
  const DEFERRED: DataDomain[] = ["instrument_master", "market_status"];

  return [
    ...NOT_SUPPORTED.map((domain) => ({
      provider: "indianapi" as const, domain,
      state: "NOT_CONFIGURED" as const, reason, evaluatedAt,
    })),
    ...DEFERRED.map((domain) => ({
      provider: "indianapi" as const, domain,
      state: "NOT_CONFIGURED" as const, reason, evaluatedAt,
    })),
  ];
}

// ── Yahoo capability evaluation ───────────────────────────────────────────────

function yahooCapabilities(evaluatedAt: string): ProviderDomainCapability[] {
  // Yahoo is intentionally analytics-only — delayed, never trade-sensitive.
  // It requires no credentials (public API) so it is AVAILABLE for its permitted domains
  // but UNSUPPORTED for any trade-sensitive domain.

  const UNSUPPORTED_REASON =
    "Yahoo is delayed analytics only. " +
    "It must never power trade decisions, signals, valuation or F&O paths. " +
    "Owner policy: UNSUPPORTED for all trade-sensitive domains.";

  const ANALYTICS_REASON =
    "Yahoo Finance — delayed secondary analytics. " +
    "Available for informational display only (benchmarks, global assets). " +
    "Always labelled delayed; never promoted to trade-grade.";

  return [
    // Trade-sensitive domains — explicitly UNSUPPORTED
    { provider: "yahoo" as const, domain: "index_quote" as DataDomain, state: "UNSUPPORTED" as const, reason: UNSUPPORTED_REASON, evaluatedAt },
    { provider: "yahoo" as const, domain: "equity_quote" as DataDomain, state: "UNSUPPORTED" as const, reason: UNSUPPORTED_REASON, evaluatedAt },
    { provider: "yahoo" as const, domain: "intraday_candles" as DataDomain, state: "UNSUPPORTED" as const, reason: UNSUPPORTED_REASON, evaluatedAt },
    { provider: "yahoo" as const, domain: "option_chain" as DataDomain, state: "UNSUPPORTED" as const, reason: UNSUPPORTED_REASON, evaluatedAt },
    // Analytics-only domains — AVAILABLE with honesty
    { provider: "yahoo" as const, domain: "daily_candles" as DataDomain, state: "AVAILABLE" as const, reason: ANALYTICS_REASON, evaluatedAt },
    { provider: "yahoo" as const, domain: "instrument_master" as DataDomain, state: "UNSUPPORTED" as const, reason: UNSUPPORTED_REASON, evaluatedAt },
    { provider: "yahoo" as const, domain: "market_status" as DataDomain, state: "UNSUPPORTED" as const, reason: UNSUPPORTED_REASON, evaluatedAt },
  ];
}

// ── NSE / INDstocks capability evaluation ─────────────────────────────────────

function nseCapabilities(evaluatedAt: string): ProviderDomainCapability[] {
  // NSE public scrape is used as DISPLAY-only fallback for the option chain
  // when Kite is unavailable. It is never authoritative for trade-sensitive paths.
  const DISPLAY_ONLY =
    "NSE public scrape — DISPLAY fallback only for option chain (notForSignals=true). " +
    "Used only when Kite is unavailable. Never trade-grade.";
  const UNSUPPORTED = "NSE public scrape not used for this domain.";

  return [
    { provider: "nse" as const, domain: "option_chain" as DataDomain, state: "AVAILABLE" as const, reason: DISPLAY_ONLY, evaluatedAt },
    { provider: "nse" as const, domain: "index_quote" as DataDomain, state: "UNSUPPORTED" as const, reason: UNSUPPORTED, evaluatedAt },
    { provider: "nse" as const, domain: "equity_quote" as DataDomain, state: "UNSUPPORTED" as const, reason: UNSUPPORTED, evaluatedAt },
    { provider: "nse" as const, domain: "intraday_candles" as DataDomain, state: "UNSUPPORTED" as const, reason: UNSUPPORTED, evaluatedAt },
    { provider: "nse" as const, domain: "daily_candles" as DataDomain, state: "UNSUPPORTED" as const, reason: UNSUPPORTED, evaluatedAt },
    { provider: "nse" as const, domain: "instrument_master" as DataDomain, state: "UNSUPPORTED" as const, reason: UNSUPPORTED, evaluatedAt },
    { provider: "nse" as const, domain: "market_status" as DataDomain, state: "UNSUPPORTED" as const, reason: UNSUPPORTED, evaluatedAt },
  ];
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Return the current capability snapshot for all providers and data domains.
 * Pure read — never modifies state. Safe to call from any diagnostic handler.
 * Does NOT expose credentials: only state names and human-readable reasons.
 */
export function getProviderCapabilities(): ProviderCapabilitySnapshot {
  const evaluatedAt = new Date().toISOString();
  const capabilities: ProviderDomainCapability[] = [
    ...kiteCapabilities(evaluatedAt),
    ...upstoxCapabilities(evaluatedAt),
    ...indianApiCapabilities(evaluatedAt),
    ...yahooCapabilities(evaluatedAt),
    ...nseCapabilities(evaluatedAt),
  ];

  const tradeAvailableProviders = [
    ...new Set(
      capabilities
        .filter((c) => c.state === "AVAILABLE" && TRADE_SENSITIVE_DOMAINS.includes(c.domain))
        .map((c) => c.provider),
    ),
  ].filter((p) => p === "kite"); // Only Kite may be trade-available per policy

  return { evaluatedAt, capabilities, tradeAvailableProviders, authoritative: "kite" };
}

/** Domains that affect trade/signal decisions and must use authoritative sources. */
export const TRADE_SENSITIVE_DOMAINS: DataDomain[] = [
  "index_quote",
  "equity_quote",
  "intraday_candles",
  "daily_candles",
  "option_chain",
];

/**
 * Lookup capability for a specific provider+domain combination.
 * Returns UNAVAILABLE if the combination is not in the registry.
 */
export function getCapabilityFor(
  provider: ProviderDomainCapability["provider"],
  domain: DataDomain,
  snapshot?: ProviderCapabilitySnapshot,
): ProviderDomainCapability {
  const snap = snapshot ?? getProviderCapabilities();
  const found = snap.capabilities.find((c) => c.provider === provider && c.domain === domain);
  return (
    found ?? {
      provider,
      domain,
      state: "UNAVAILABLE",
      reason: `No capability record for ${provider}/${domain}.`,
      evaluatedAt: snap.evaluatedAt,
    }
  );
}
