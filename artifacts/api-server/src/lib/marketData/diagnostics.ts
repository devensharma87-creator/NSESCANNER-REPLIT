/**
 * Provider diagnostics — the honest health/policy snapshot powering the
 * /api/data/diagnostics endpoints, the system/status page and the offline
 * banner. Single source of truth so every surface agrees on provider state.
 */

import { getPolicy } from "./policy";
import { kiteHealth, kiteSessionActive } from "./kiteProvider";
import { indstocksHealth } from "./indstocksProvider";
import { getEquityQuote } from "./router";
import type { MarketQuote } from "./types";

export type ProviderState = "active" | "degraded" | "inactive" | "disabled";

export interface ProviderDiagnostic {
  name: "kite" | "indstocks" | "yahoo";
  trustTier: string;
  role: string;
  state: ProviderState;
  detail: string;
  health: Record<string, unknown>;
}

export interface DataDiagnostics {
  generatedAt: string;
  policy: {
    strictFreshness: boolean;
    strictMismatch: boolean;
    freshnessBudgetSec: number;
    staleBudgetSec: number;
    indstocksEnabled: boolean;
  };
  /** The authoritative source for prices/signals/valuation/F&O. */
  authoritative: "kite";
  providers: ProviderDiagnostic[];
}

export function buildDataDiagnostics(): DataDiagnostics {
  const policy = getPolicy();
  const kh = kiteHealth();

  const kiteState: ProviderState = kiteSessionActive()
    ? "active"
    : kh.credsConfigured
      ? "degraded"
      : "inactive";
  const kiteDetail = kiteSessionActive()
    ? `Live: ${kh.liveQuotes} quotes streaming across ${kh.subscribed} subscriptions.`
    : kh.credsConfigured
      ? "Credentials present but session/WebSocket not live — owner must complete the daily Kite login."
      : "Kite credentials not configured.";

  const ih = indstocksHealth();
  const indState: ProviderState = ih.enabled ? "degraded" : "disabled";

  return {
    generatedAt: new Date().toISOString(),
    authoritative: "kite",
    policy: {
      strictFreshness: policy.strictFreshness,
      strictMismatch: policy.strictMismatch,
      freshnessBudgetSec: policy.freshnessBudgetSec,
      staleBudgetSec: policy.staleBudgetSec,
      indstocksEnabled: policy.indstocksEnabled,
    },
    providers: [
      {
        name: "kite",
        trustTier: policy.providers.kite.trustTier,
        role: policy.providers.kite.role,
        state: kiteState,
        detail: kiteDetail,
        health: { ...kh },
      },
      {
        name: "indstocks",
        trustTier: policy.providers.indstocks.trustTier,
        role: policy.providers.indstocks.role,
        state: indState,
        detail: ih.reason,
        health: { ...ih },
      },
      {
        name: "yahoo",
        trustTier: policy.providers.yahoo.trustTier,
        role: policy.providers.yahoo.role,
        // Yahoo is intentionally analytics-only; "active" here means "usable as
        // delayed analytics", NOT that it may power prices/signals.
        state: "active",
        detail:
          "Secondary delayed analytics only — never powers prices, signals, valuation or F&O.",
        health: { delayed: true, notForSignals: true },
      },
    ],
  };
}

export interface SymbolDiagnostic {
  symbol: string;
  generatedAt: string;
  tradeable: boolean;
  reason: string | null;
  quote: (MarketQuote & { tradeable: boolean }) | null;
}

/** Per-symbol diagnostic — shows exactly what the trusted layer would return. */
export async function buildSymbolDiagnostic(symbol: string): Promise<SymbolDiagnostic> {
  const sym = symbol.toUpperCase();
  const r = await getEquityQuote(sym);
  if (r.ok && r.data) {
    return {
      symbol: sym,
      generatedAt: new Date().toISOString(),
      tradeable: true,
      reason: null,
      quote: { ...(r.data as MarketQuote), tradeable: true },
    };
  }
  return {
    symbol: sym,
    generatedAt: new Date().toISOString(),
    tradeable: false,
    reason: r.reason ?? "Unavailable.",
    quote: null,
  };
}
