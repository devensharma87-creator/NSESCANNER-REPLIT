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
import { getShadowRoutingState } from "./shadowState";
import { isUpstoxConfigured } from "./upstoxProvider";
import { isIndianApiConfigured, getIndianApiCapabilityManifest } from "./indianApiProvider";

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
  const configured = isUpstoxConfigured();
  const routingState = getShadowRoutingState("upstox");

  let state: ProviderCapabilityState;
  let reason: string;

  if (!configured) {
    state  = "NOT_CONFIGURED";
    reason = "UPSTOX_ACCESS_TOKEN absent. Set to enable shadow-only read mode. " +
             "Pack 5: Upstox is shadow-only and will not affect trading decisions.";
  } else if (routingState === "DISABLED") {
    state  = "UNAVAILABLE";
    reason = "Upstox shadow is administratively disabled or auth expired.";
  } else {
    // Configured: shadow comparison active. NOT trade-available.
    state  = "AVAILABLE";
    reason = `SHADOW_ONLY (${routingState}): Upstox running shadow comparisons. ` +
             "Never trade-grade. Promotion requires separate owner action.";
  }

  // Upstox supports live quotes, candles, option chain, and instrument master.
  // Does NOT support market_status (not a direct Upstox domain).
  const SHADOW_DOMAINS: DataDomain[] = [
    "index_quote", "equity_quote", "intraday_candles", "daily_candles",
    "instrument_master", "option_chain",
  ];
  const unsupportedReason = "Upstox does not provide market session state in this integration.";

  return [
    ...SHADOW_DOMAINS.map((domain) => ({
      provider: "upstox" as const, domain, state, reason, evaluatedAt,
    })),
    {
      provider:  "upstox" as const,
      domain:    "market_status" as const,
      state:     "UNSUPPORTED" as const,
      reason:    unsupportedReason,
      evaluatedAt,
    },
  ];
}

// ── IndianAPI capability evaluation ──────────────────────────────────────────

function indianApiCapabilities(evaluatedAt: string): ProviderDomainCapability[] {
  const configured = isIndianApiConfigured();
  const manifest   = getIndianApiCapabilityManifest();

  // Trade-sensitive domains are always UNSUPPORTED for IndianAPI.
  const UNSUPPORTED_DOMAINS: DataDomain[] = [
    "index_quote", "equity_quote", "intraday_candles", "daily_candles",
    "option_chain", "market_status",
  ];
  const unsupportedReason =
    "IndianAPI is reference/fundamentals only. Not used for live quotes, candles, or F&O.";

  // instrument_master: partially confirmed (company profile / ISIN available).
  const instrumentMasterState: ProviderCapabilityState = configured ? "AVAILABLE" : "NOT_CONFIGURED";
  const instrumentMasterReason = configured
    ? `IndianAPI: company profile + ratios confirmed. ${manifest.length} capability entries.`
    : "INDIANAPI_API_KEY absent. Set to enable reference data.";

  return [
    ...UNSUPPORTED_DOMAINS.map((domain) => ({
      provider:  "indianapi" as const,
      domain,
      state:     "UNSUPPORTED" as const,
      reason:    unsupportedReason,
      evaluatedAt,
    })),
    {
      provider:  "indianapi" as const,
      domain:    "instrument_master" as const,
      state:     instrumentMasterState,
      reason:    instrumentMasterReason,
      evaluatedAt,
    },
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
