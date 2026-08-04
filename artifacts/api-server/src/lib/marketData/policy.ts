/**
 * Market-data policy — the single source of truth for which provider may do
 * what. This is read by the guard, the router, the diagnostics endpoints and
 * the analytics gateway so the rules live in exactly one place.
 *
 * STANDING RULES (do not relax without an explicit task):
 *   - Kite is the ONLY authoritative provider (prices/signals/valuation/F&O).
 *   - INDstocks is secondary validation/failover, DISABLED until its adapter
 *     task ships (env `INDSTOCKS_ENABLED` default off).
 *   - Yahoo is secondary analytics ONLY — never prices/signals/valuation/F&O.
 */

import type { ProviderName, TrustTier } from "./types";

export type ProviderRole =
  | "primary"
  | "secondary_validation"
  | "shadow"       // Pack 5: read-only shadow comparison only
  | "analytics"
  | "disabled";

export interface ProviderPolicy {
  name: ProviderName;
  enabled: boolean;
  trustTier: TrustTier;
  role: ProviderRole;
  /** May this provider's data power trading/F&O/simulation? */
  allowedForTrading: boolean;
  /** May this provider's data power signal generation / scanner scoring? */
  allowedForSignals: boolean;
  /** May this provider's data power portfolio valuation? */
  allowedForValuation: boolean;
  notes: string;
}

export interface MarketDataPolicy {
  providers: Record<"kite" | "indstocks" | "yahoo" | "upstox" | "indianapi", ProviderPolicy>;
  /** When true, stale data is rejected from trusted paths (not just flagged). */
  strictFreshness: boolean;
  /** When true, cross-provider mismatches hard-fail (INDstocks task). */
  strictMismatch: boolean;
  /** Freshness budget (seconds) before a quote is considered stale. */
  freshnessBudgetSec: number;
  /** Hard-stale budget (seconds) — beyond this, validation = "stale". */
  staleBudgetSec: number;
  indstocksEnabled: boolean;
  /** Upstox shadow is active only when token is present. Never auto-promoted. */
  upstoxShadowEnabled: boolean;
  /** IndianAPI reference data enabled when key is present. */
  indianApiEnabled: boolean;
}

function envFlag(name: string, def: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === "") return def;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  // Fail-closed on an unrecognised value — never silently enable.
  return def;
}

function envInt(name: string, def: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return def;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : def;
}

/** Resolve the active policy from environment + standing rules. */
export function getPolicy(): MarketDataPolicy {
  const indstocksEnabled    = envFlag("INDSTOCKS_ENABLED", false);
  const upstoxShadowEnabled = (process.env["UPSTOX_ACCESS_TOKEN"]?.trim() || "") !== "";
  const indianApiEnabled    = (process.env["INDIANAPI_API_KEY"]?.trim() || "") !== "";

  return {
    strictFreshness:    envFlag("MARKETDATA_STRICT_FRESHNESS", false),
    strictMismatch:     envFlag("MARKETDATA_STRICT_MISMATCH",  false),
    freshnessBudgetSec: envInt("MARKETDATA_FRESHNESS_BUDGET_SEC", 90),
    staleBudgetSec:     envInt("MARKETDATA_STALE_BUDGET_SEC", 600),
    indstocksEnabled,
    upstoxShadowEnabled,
    indianApiEnabled,
    providers: {
      kite: {
        name: "kite",
        enabled: true,
        trustTier: "authoritative",
        role: "primary",
        allowedForTrading: true,
        allowedForSignals: true,
        allowedForValuation: true,
        notes:
          "Zerodha Kite Connect — authoritative real-time source for all Indian equity/F&O prices and candles.",
      },
      indstocks: {
        name: "indstocks",
        enabled: indstocksEnabled,
        trustTier: "secondary_validation",
        role: indstocksEnabled ? "secondary_validation" : "disabled",
        allowedForTrading: false,
        allowedForSignals: false,
        allowedForValuation: false,
        notes: indstocksEnabled
          ? "INDstocks — secondary validation/failover."
          : "INDstocks — DISABLED. Enable via INDSTOCKS_ENABLED.",
      },
      upstox: {
        name: "upstox",
        enabled: upstoxShadowEnabled,
        trustTier: "secondary_analytics",
        // PACK 5 HARD RULE: shadow only, never primary/secondary_validation.
        // Cannot be promoted to APPROVED_SECONDARY without explicit owner action.
        role: upstoxShadowEnabled ? "shadow" : "disabled",
        allowedForTrading:  false, // NEVER
        allowedForSignals:  false, // NEVER
        allowedForValuation: false, // NEVER
        notes: upstoxShadowEnabled
          ? "Upstox — SHADOW_ONLY. Read-only parity comparison; never affects canonical data or trading decisions. Pack 5: promotion requires separate owner action."
          : "Upstox — NOT_CONFIGURED. Set UPSTOX_ACCESS_TOKEN to enable shadow mode.",
      },
      indianapi: {
        name: "indianapi",
        enabled: indianApiEnabled,
        trustTier: "secondary_analytics",
        role: indianApiEnabled ? "analytics" : "disabled",
        allowedForTrading:  false,
        allowedForSignals:  false,
        allowedForValuation: false,
        notes: indianApiEnabled
          ? "IndianAPI — reference/fundamentals data. Confirmed: company profile, ratios. NOT for signals or trade decisions."
          : "IndianAPI — NOT_CONFIGURED. Set INDIANAPI_API_KEY to enable reference data.",
      },
      yahoo: {
        name: "yahoo",
        enabled: true,
        trustTier: "secondary_analytics",
        role: "analytics",
        allowedForTrading: false,
        allowedForSignals: false,
        allowedForValuation: false,
        notes:
          "Yahoo Finance — delayed secondary ANALYTICS only (global assets, India VIX fallback, portfolio benchmarks). Never prices/signals/valuation/F&O.",
      },
    },
  };
}

/** A trust tier is tradeable iff it is the authoritative tier. */
export function isTierTradeable(tier: TrustTier): boolean {
  return tier === "authoritative";
}
