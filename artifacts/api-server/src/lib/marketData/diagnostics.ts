/**
 * Provider diagnostics — the honest health/policy snapshot powering the
 * /api/data/diagnostics endpoints, the system/status page and the offline
 * banner. Single source of truth so every surface agrees on provider state.
 */

import { getPolicy } from "./policy";
import { kiteHealth, kiteSessionActive } from "./kiteProvider";
import {
  indstocksHealth,
  isIndstocksEnabled,
  probeIndstocksHealth,
  type IndstocksHealth,
} from "./indstocksProvider";
import { getEquityQuoteResolved, validateAgainstIndstocks } from "./router";
import { getMapSyncStats, type MapSyncStats } from "./instrumentMapStore";
import { getValidationStats, type ValidationDayStats } from "./validationStats";
import type { ValidationResult } from "./sourceValidation";
import type { MarketQuote, ProviderName } from "./types";
import type { InstrumentAssetClass } from "@workspace/db";

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
  /** Secondary-provider (INDstocks) health, mapping sync + validation counters. */
  indstocks: {
    health: IndstocksHealth;
    mapSync: MapSyncStats;
    validation: ValidationDayStats;
  };
}

export async function buildDataDiagnostics(): Promise<DataDiagnostics> {
  const policy = getPolicy();
  const kh = kiteHealth();

  // Actively probe INDstocks connectivity/auth when (and only when) enabled, so
  // the owner-visible health reflects reality instead of a stale cache. When
  // disabled this is a no-op (no network) — `indstocksHealth()` reports disabled.
  if (isIndstocksEnabled()) {
    await probeIndstocksHealth().catch(() => undefined);
  }

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
    indstocks: {
      health: ih,
      mapSync: getMapSyncStats(),
      validation: getValidationStats(),
    },
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
  /** Which provider actually served the quote — "indstocks" only on failover. */
  source: ProviderName;
  /** True when Kite was unavailable and the quote came from INDstocks failover. */
  failover: boolean;
  quote: (MarketQuote & { tradeable: boolean }) | null;
  /** Secondary INDstocks cross-check (null when disabled / no mapping / no quote). */
  indstocks: {
    mappingOk: boolean;
    reason: string | null;
    quote: MarketQuote | null;
    validation: ValidationResult | null;
  } | null;
}

/**
 * Per-symbol diagnostic — shows exactly what the trusted layer would return,
 * including the actual failover behaviour. Routes through `getEquityQuoteResolved`
 * (Kite-first; INDstocks failover only when VERIFIED + fresh + complete) so the
 * owner sees the real served source, never a Kite-only view. A failover quote is
 * surfaced honestly: `source="indstocks"`, `failover=true`, and NEVER branded
 * `tradeable`.
 */
export async function buildSymbolDiagnostic(
  symbol: string,
  assetClass: InstrumentAssetClass = "EQUITY",
): Promise<SymbolDiagnostic> {
  const sym = symbol.toUpperCase();
  const r = await getEquityQuoteResolved(sym, assetClass);
  const servedByKite = r.ok && !!r.data && r.source === "kite";
  const quote = r.ok && r.data ? { ...r.data, tradeable: servedByKite } : null;

  let indstocks: SymbolDiagnostic["indstocks"] = null;
  if (getPolicy().indstocksEnabled) {
    if (r.failover && r.data) {
      // Failover: the served quote IS the INDstocks quote — there is no Kite
      // counterpart to cross-validate it against, so surface it as the secondary.
      indstocks = {
        mappingOk: true,
        reason: "Served via INDstocks failover (Kite unavailable).",
        quote: r.data,
        validation: null,
      };
    } else if (r.ok && r.data) {
      // getEquityQuoteResolved already cross-validated + recorded on the happy
      // path; this call is display-only, so record=false avoids double-counting
      // the validation stats for a single diagnostic request.
      const cv = await validateAgainstIndstocks(sym, r.data, assetClass, false).catch((e) => {
        void e;
        return null;
      });
      if (cv) {
        indstocks = {
          mappingOk: cv.mappingOk,
          reason: cv.reason,
          quote: cv.indstocks,
          validation: cv.result,
        };
      }
    }
  }

  return {
    symbol: sym,
    generatedAt: new Date().toISOString(),
    tradeable: servedByKite,
    reason: r.ok ? null : (r.reason ?? "Unavailable."),
    source: r.source,
    failover: r.failover,
    quote,
    indstocks,
  };
}
