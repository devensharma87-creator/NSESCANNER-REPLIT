/**
 * IndianAPI read-only reference-data provider.
 *
 * Pack 5 governance:
 *   - Reference/fundamentals data only. Not used for live quotes, candles, signals, or F&O.
 *   - NOT_CONFIGURED when INDIANAPI_API_KEY is absent.
 *   - All returned data carries notForSignals=true, notForTradeDecisions=true.
 *   - Confirmed domain coverage per contracted documentation:
 *     - Company profile (GET /stock)
 *     - Financial ratios (GET /stock_ratios)
 *   - Unconfirmed domains (financials, shareholding, news, corporate actions) are
 *     represented as NOT_ENTITLED until endpoint specs are confirmed.
 */

import {
  createIndianApiClient,
  resolveIndianApiConfig,
  IndianApiError,
  type IndianApiClient,
  type IndianApiStockProfile,
  type IndianApiStockRatios,
} from "./indianApiClient";
import { buildMeta } from "./validator";
import type { DataMeta } from "./types";

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export interface IndianApiHealth {
  configured:  boolean;
  lastProbeAt: string | null;
  lastError:   string | null;
}

let sharedClient: IndianApiClient | null = null;
let _lastProbeAt: string | null = null;
let _lastError:   string | null = null;

export function isIndianApiConfigured(): boolean {
  return resolveIndianApiConfig().apiKey !== null;
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
  return {
    configured:  isIndianApiConfigured(),
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
    source:        "indianapi",
    trustTier:     "secondary_analytics",
    asOfMs:        null,  // reference data has no live timestamp
    delayed:       false,
    notForSignals: true,
    notForTradeDecisions: true,
    nowMs:         Date.now(),
    warnings:      [
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
  if (!isIndianApiConfigured()) {
    return {
      ok:     false,
      data:   null,
      meta:   refMeta(["NOT_CONFIGURED: INDIANAPI_API_KEY absent."]),
      reason: "NOT_CONFIGURED",
    };
  }
  try {
    const data = await client().getStockProfile(symbol);
    _lastProbeAt = new Date().toISOString();
    return { ok: true, data, meta: refMeta() };
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
  if (!isIndianApiConfigured()) {
    return {
      ok:     false,
      data:   null,
      meta:   refMeta(["NOT_CONFIGURED: INDIANAPI_API_KEY absent."]),
      reason: "NOT_CONFIGURED",
    };
  }
  try {
    const data = await client().getStockRatios(symbol);
    return { ok: true, data, meta: refMeta() };
  } catch (err) {
    const msg = err instanceof IndianApiError ? `${err.kind}: ${err.message}` : String(err);
    _lastError = msg;
    return { ok: false, data: null, meta: refMeta([msg]), reason: msg };
  }
}

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

export async function probeIndianApiConnection(): Promise<{
  ok:     boolean;
  reason: string;
}> {
  if (!isIndianApiConfigured()) {
    return { ok: false, reason: "NOT_CONFIGURED: INDIANAPI_API_KEY absent." };
  }
  try {
    await client().getStockProfile("RELIANCE");
    _lastProbeAt = new Date().toISOString();
    return { ok: true, reason: "Auth probe succeeded." };
  } catch (err) {
    const msg = err instanceof IndianApiError ? `${err.kind}: ${err.message}` : String(err);
    _lastError  = msg;
    _lastProbeAt = new Date().toISOString();
    return { ok: false, reason: `UNREACHABLE: ${msg}` };
  }
}

// ---------------------------------------------------------------------------
// Capability manifest
// ---------------------------------------------------------------------------

export type IndianApiCapabilityState =
  | "CONFIRMED"     // endpoint confirmed by contracted docs + plan
  | "NOT_ENTITLED"  // endpoint exists but not on the owner's plan
  | "NOT_CONFIRMED" // endpoint not confirmed from docs/plan
  | "NOT_CONFIGURED"; // API key absent

export interface IndianApiCapabilityEntry {
  domain:    string;
  endpoint:  string;
  state:     IndianApiCapabilityState;
  notes:     string;
}

export function getIndianApiCapabilityManifest(): IndianApiCapabilityEntry[] {
  const configured = isIndianApiConfigured();
  const baseState = configured ? undefined : "NOT_CONFIGURED" as const;

  return [
    {
      domain:   "company_profile",
      endpoint: "GET /stock",
      state:    baseState ?? "CONFIRMED",
      notes:    "Company name, ISIN, sector, industry, market cap.",
    },
    {
      domain:   "financial_ratios",
      endpoint: "GET /stock_ratios",
      state:    baseState ?? "CONFIRMED",
      notes:    "PE, PB, EPS, dividend yield, ROE, debt/equity.",
    },
    {
      domain:   "financial_statements",
      endpoint: "GET /financials",
      state:    baseState ?? "NOT_CONFIRMED",
      notes:    "Balance sheet / P&L / cash flow — not confirmed on current plan.",
    },
    {
      domain:   "shareholding",
      endpoint: "GET /shareholding",
      state:    baseState ?? "NOT_CONFIRMED",
      notes:    "Shareholding pattern — not confirmed on current plan.",
    },
    {
      domain:   "corporate_actions",
      endpoint: "GET /corporate_actions",
      state:    baseState ?? "NOT_CONFIRMED",
      notes:    "Dividends, splits, bonuses — not confirmed on current plan.",
    },
    {
      domain:   "news",
      endpoint: "GET /news",
      state:    baseState ?? "NOT_CONFIRMED",
      notes:    "Company news — not confirmed on current plan.",
    },
  ];
}
