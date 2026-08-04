/**
 * IndianAPI read-only reference-data provider.
 *
 * Pack 5 governance:
 *   - Reference/fundamentals data only. Not used for live quotes, candles,
 *     signals, or F&O.
 *   - NOT_CONFIGURED when INDIANAPI_API_KEY is absent.
 *   - INVALID_PROVIDER_CONFIG when plan/host configuration is invalid.
 *   - All returned data carries notForSignals=true, notForTradeDecisions=true.
 *   - Confirmed domain coverage per contracted documentation:
 *       - Company profile + financial ratios (GET /stock?name={symbol})
 *   - Unconfirmed domains remain NOT_CONFIRMED until endpoint specs are proven.
 *
 * Gate A/B/C (23B): plan model, single-endpoint, fail-closed entitlement.
 */

import {
  createIndianApiClient,
  resolveIndianApiConfig,
  IndianApiError,
  type IndianApiClient,
  type IndianApiStockProfile,
  type IndianApiStockRatios,
  type IndianApiPlan,
} from "./indianApiClient";
import { buildMeta } from "./validator";
import type { DataMeta } from "./types";

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export interface IndianApiHealth {
  configured:  boolean;
  plan:        IndianApiPlan | null;
  configState: "VALID" | "INVALID_PROVIDER_CONFIG";
  lastProbeAt: string | null;
  lastError:   string | null;
}

let sharedClient: IndianApiClient | null = null;
let _lastProbeAt: string | null = null;
let _lastError:   string | null = null;

export function isIndianApiConfigured(): boolean {
  const cfg = resolveIndianApiConfig();
  return cfg.configState === "VALID" && cfg.apiKey !== null;
}

function client(): IndianApiClient {
  if (!sharedClient) sharedClient = createIndianApiClient();
  return sharedClient;
}

/** Test seam: inject a client built over a fake fetch. */
export function __setIndianApiClientForTests(c: IndianApiClient | null): void {
  sharedClient = c;
}

export function indianApiHealth(): IndianApiHealth {
  const cfg = resolveIndianApiConfig();
  return {
    configured:  isIndianApiConfigured(),
    plan:        cfg.configState === "VALID" ? cfg.plan : null,
    configState: cfg.configState,
    lastProbeAt: _lastProbeAt,
    lastError:   _lastError,
  };
}

// ---------------------------------------------------------------------------
// Reference-data result wrapper
// ---------------------------------------------------------------------------

/**
 * Common meta for all IndianAPI reference results.
 * Always notForSignals=true and notForTradeDecisions=true.
 */
function refMeta(warnings: string[] = []): DataMeta {
  return buildMeta({
    source:               "indianapi",
    trustTier:            "secondary_analytics",
    asOfMs:               null,  // reference data has no live timestamp
    delayed:              false,
    notForSignals:        true,
    notForTradeDecisions: true,
    nowMs:                Date.now(),
    warnings: [
      "IndianAPI reference data — never for trading decisions.",
      ...warnings,
    ],
  });
}

// ---------------------------------------------------------------------------
// Stock profile
// ---------------------------------------------------------------------------

export interface StockProfileResult {
  ok:      boolean;
  data:    IndianApiStockProfile | null;
  meta:    DataMeta;
  reason?: string;
}

export async function getStockProfile(symbol: string): Promise<StockProfileResult> {
  const cfg = resolveIndianApiConfig();

  if (cfg.configState === "INVALID_PROVIDER_CONFIG") {
    return {
      ok:     false,
      data:   null,
      meta:   refMeta(["INVALID_PROVIDER_CONFIG: provider configuration is invalid."]),
      reason: "INVALID_PROVIDER_CONFIG",
    };
  }
  if (!isIndianApiConfigured()) {
    return {
      ok:     false,
      data:   null,
      meta:   refMeta(["NOT_CONFIGURED: INDIANAPI_API_KEY absent."]),
      reason: "NOT_CONFIGURED",
    };
  }
  try {
    const stock = await client().getStock(symbol);
    _lastProbeAt = new Date().toISOString();
    return { ok: true, data: stock.profile, meta: refMeta() };
  } catch (err) {
    const msg = err instanceof IndianApiError ? `${err.kind}: ${err.message}` : String(err);
    _lastError = msg;
    return { ok: false, data: null, meta: refMeta([msg]), reason: msg };
  }
}

// ---------------------------------------------------------------------------
// Financial ratios
// ---------------------------------------------------------------------------

export interface StockRatiosResult {
  ok:      boolean;
  data:    IndianApiStockRatios | null;
  meta:    DataMeta;
  reason?: string;
}

export async function getStockRatios(symbol: string): Promise<StockRatiosResult> {
  const cfg = resolveIndianApiConfig();

  if (cfg.configState === "INVALID_PROVIDER_CONFIG") {
    return {
      ok:     false,
      data:   null,
      meta:   refMeta(["INVALID_PROVIDER_CONFIG: provider configuration is invalid."]),
      reason: "INVALID_PROVIDER_CONFIG",
    };
  }
  if (!isIndianApiConfigured()) {
    return {
      ok:     false,
      data:   null,
      meta:   refMeta(["NOT_CONFIGURED: INDIANAPI_API_KEY absent."]),
      reason: "NOT_CONFIGURED",
    };
  }
  try {
    const stock = await client().getStock(symbol);
    return { ok: true, data: stock.ratios, meta: refMeta() };
  } catch (err) {
    const msg = err instanceof IndianApiError ? `${err.kind}: ${err.message}` : String(err);
    _lastError = msg;
    return { ok: false, data: null, meta: refMeta([msg]), reason: msg };
  }
}

// ---------------------------------------------------------------------------
// Combined fundamentals (single /stock call — use this from the route)
// ---------------------------------------------------------------------------

export interface FundamentalsResult {
  ok:          boolean;
  profile:     IndianApiStockProfile | null;
  ratios:      IndianApiStockRatios | null;
  providerAsOf: string | null;
  meta:        DataMeta;
  reason?:     string;
}

/**
 * Fetch all fundamentals in a single /stock call.
 * Preferred over calling getStockProfile + getStockRatios separately.
 */
export async function getFundamentals(symbol: string): Promise<FundamentalsResult> {
  const cfg = resolveIndianApiConfig();

  if (cfg.configState === "INVALID_PROVIDER_CONFIG") {
    return {
      ok:          false,
      profile:     null,
      ratios:      null,
      providerAsOf: null,
      meta:        refMeta(["INVALID_PROVIDER_CONFIG: provider configuration is invalid."]),
      reason:      "INVALID_PROVIDER_CONFIG",
    };
  }
  if (!isIndianApiConfigured()) {
    return {
      ok:          false,
      profile:     null,
      ratios:      null,
      providerAsOf: null,
      meta:        refMeta(["NOT_CONFIGURED: INDIANAPI_API_KEY absent."]),
      reason:      "NOT_CONFIGURED",
    };
  }
  try {
    const stock = await client().getStock(symbol);
    _lastProbeAt = new Date().toISOString();
    return {
      ok:          true,
      profile:     stock.profile,
      ratios:      stock.ratios,
      providerAsOf: stock.providerAsOf,
      meta:        refMeta(),
    };
  } catch (err) {
    const msg = err instanceof IndianApiError ? `${err.kind}: ${err.message}` : String(err);
    _lastError = msg;
    // Distinguish RATE_LIMITED from generic errors
    const reason = (err instanceof IndianApiError && err.kind === "rate_limit") ? "RATE_LIMITED" : msg;
    return { ok: false, profile: null, ratios: null, providerAsOf: null, meta: refMeta([msg]), reason };
  }
}

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

export async function probeIndianApiConnection(): Promise<{
  ok:     boolean;
  reason: string;
}> {
  const cfg = resolveIndianApiConfig();
  if (cfg.configState === "INVALID_PROVIDER_CONFIG") {
    return { ok: false, reason: "INVALID_PROVIDER_CONFIG: provider configuration is invalid." };
  }
  if (!isIndianApiConfigured()) {
    return { ok: false, reason: "NOT_CONFIGURED: INDIANAPI_API_KEY absent." };
  }
  try {
    await client().getStock("RELIANCE");
    _lastProbeAt = new Date().toISOString();
    return { ok: true, reason: "Auth probe succeeded." };
  } catch (err) {
    const msg = err instanceof IndianApiError ? `${err.kind}: ${err.message}` : String(err);
    _lastError   = msg;
    _lastProbeAt = new Date().toISOString();
    return { ok: false, reason: `UNREACHABLE: ${msg}` };
  }
}

// ---------------------------------------------------------------------------
// Capability manifest (Gate C, 23B)
// ---------------------------------------------------------------------------

export type IndianApiCapabilityState =
  | "AVAILABLE"           // endpoint confirmed, plan valid, credentials present, provider healthy
  | "NOT_CONFIGURED"      // API key absent
  | "INVALID_PROVIDER_CONFIG" // plan/host config invalid — zero calls
  | "NOT_ENTITLED"        // endpoint exists but not on the owner's plan
  | "NOT_CONFIRMED"       // endpoint not confirmed from docs/plan
  | "RATE_LIMITED"        // 429 / credit exhaustion (not AUTH_EXPIRED)
  | "UNSUPPORTED";        // endpoint not implemented

export interface IndianApiCapabilityEntry {
  domain:    string;
  endpoint:  string;
  state:     IndianApiCapabilityState;
  notes:     string;
}

/**
 * Gate C: capability state transitions.
 *
 *  - A marketing-page feature is not automatically AVAILABLE.
 *  - AVAILABLE only when: endpoint implemented, schema validated, plan entitlement,
 *    credentials configured.
 *  - NOT_CONFIGURED when key absent (regardless of plan).
 *  - INVALID_PROVIDER_CONFIG when plan/host config is invalid.
 *  - NOT_ENTITLED for plan exclusions.
 *  - UNSUPPORTED for unimplemented domains.
 *  - Diagnostics never claim live verification when only mocked contract tests ran.
 */
export function getIndianApiCapabilityManifest(): IndianApiCapabilityEntry[] {
  const cfg = resolveIndianApiConfig();

  if (cfg.configState === "INVALID_PROVIDER_CONFIG") {
    // Override all states — zero calls, invalid config
    return CAPABILITY_DOMAINS.map(d => ({ ...d, state: "INVALID_PROVIDER_CONFIG" as const }));
  }

  const configured = cfg.apiKey !== null;
  const plan       = cfg.plan;

  function resolveState(
    implemented:    boolean,
    planEntitled:   boolean,
    baseStateIfOk:  IndianApiCapabilityState,
  ): IndianApiCapabilityState {
    if (!configured)  return "NOT_CONFIGURED";
    if (!implemented) return baseStateIfOk;  // NOT_CONFIRMED for unverified endpoints
    if (!planEntitled) return "NOT_ENTITLED";
    return baseStateIfOk;
  }

  return CAPABILITY_DOMAINS.map(d => ({
    ...d,
    state: resolveState(d.implemented, isEntitled(d.domain, plan), d.confirmedState),
  }));
}

const CAPABILITY_DOMAINS: Array<{
  domain:         string;
  endpoint:       string;
  implemented:    boolean;
  confirmedState: IndianApiCapabilityState;
  notes:          string;
}> = [
  {
    domain:         "company_profile",
    endpoint:       "GET /stock?name={symbol}",
    implemented:    true,
    confirmedState: "AVAILABLE",
    notes:          "Company name, ISIN, sector, industry, market cap. Extracted from /stock response.",
  },
  {
    domain:         "financial_ratios",
    endpoint:       "GET /stock?name={symbol}",
    implemented:    true,
    confirmedState: "AVAILABLE",
    notes:          "PE, PB, EPS, dividend yield, ROE, debt/equity. Extracted from /stock response.",
  },
  {
    domain:         "financial_statements",
    endpoint:       "GET /stock",
    implemented:    false,
    confirmedState: "NOT_CONFIRMED",
    notes:          "Balance sheet / P&L / cash flow — endpoint contract not confirmed on current plan.",
  },
  {
    domain:         "shareholding",
    endpoint:       "GET /stock",
    implemented:    false,
    confirmedState: "NOT_CONFIRMED",
    notes:          "Shareholding pattern — endpoint contract not confirmed on current plan.",
  },
  {
    domain:         "corporate_actions",
    endpoint:       "GET /stock",
    implemented:    false,
    confirmedState: "NOT_CONFIRMED",
    notes:          "Dividends, splits, bonuses — endpoint contract not confirmed on current plan.",
  },
  {
    domain:         "news",
    endpoint:       "GET /stock",
    implemented:    false,
    confirmedState: "NOT_CONFIRMED",
    notes:          "Company news — endpoint contract not confirmed on current plan.",
  },
];

/**
 * Plan entitlement check.
 * All plans that have access to the /stock endpoint can use profile + ratios.
 * Marketing-page features that are not implemented are NOT automatically entitled.
 */
function isEntitled(domain: string, plan: IndianApiPlan): boolean {
  // All plans documented to have /stock access get the confirmed domains
  const stockPlans: IndianApiPlan[] = ["FREE", "HOBBY", "DEVELOPER", "GROWTH_ANALYST", "PRO"];
  if (domain === "company_profile" || domain === "financial_ratios") {
    return stockPlans.includes(plan);
  }
  // Unconfirmed domains: only GROWTH_ANALYST and PRO are likely to have extended access
  // but we cannot claim entitlement without confirmed documentation
  return false;
}
