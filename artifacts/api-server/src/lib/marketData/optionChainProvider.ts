/**
 * Central-layer option-chain facade (Task #124 Phase 1).
 *
 * The single trusted entry point for an F&O option chain. Kite (NFO) is the
 * authoritative source; the facade stamps every chain with a `DataMeta`
 * envelope, rejects expired-expiry chains, and flags missing open interest.
 *
 * Phase 1 only ADDS this facade — no consumer is migrated onto it yet. It NEVER
 * silently falls back to NSE/Yahoo for a trusted chain: when Kite is offline it
 * returns an explicit "unavailable" result with a reason.
 */

import { fetchKiteOptionChain } from "../kiteOptionChain";
import type { OcResponse } from "../optionChain";
import { buildMeta, unavailableMeta } from "./validator";
import type { DataMeta, MarketDataResult } from "./types";

export interface TrustedOptionChain {
  chain: OcResponse;
  meta: DataMeta;
}

export interface OptionChainEvaluation {
  ok: boolean;
  reason: string | null;
  warnings: string[];
  /** ms epoch of the chain's generation instant (or null when unknown). */
  asOfMs: number | null;
  complete: boolean;
  expired: boolean;
}

function isoToMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Pure evaluation of a raw Kite option chain — no network, fully unit-testable.
 * Decides whether the chain is fit to serve and what to warn about.
 */
export function evaluateOptionChain(
  oc: OcResponse | null,
  nowIso: string = new Date().toISOString(),
): OptionChainEvaluation {
  if (!oc) {
    return {
      ok: false,
      reason: "Kite session inactive — option chain unavailable.",
      warnings: [],
      asOfMs: null,
      complete: false,
      expired: false,
    };
  }
  const asOfMs = isoToMs(oc.generatedAt);
  // Expired-contract rejection — the active expiry must be today or later.
  const nowDay = nowIso.slice(0, 10);
  if (oc.expiry && oc.expiry < nowDay) {
    return {
      ok: false,
      reason: `Active expiry ${oc.expiry} is in the past.`,
      warnings: [],
      asOfMs,
      complete: false,
      expired: true,
    };
  }
  if (!Array.isArray(oc.rows) || oc.rows.length === 0) {
    return { ok: false, reason: "Option chain has no strikes.", warnings: [], asOfMs, complete: false, expired: false };
  }
  if (!(oc.spot > 0)) {
    return { ok: false, reason: "Option chain spot is non-positive.", warnings: [], asOfMs, complete: false, expired: false };
  }
  const warnings: string[] = [];
  const legs = oc.rows.reduce((n, r) => n + (r.ce ? 1 : 0) + (r.pe ? 1 : 0), 0);
  const oiLegs = oc.rows.reduce(
    (n, r) => n + ((r.ce?.oi ?? 0) > 0 ? 1 : 0) + ((r.pe?.oi ?? 0) > 0 ? 1 : 0),
    0,
  );
  if (legs > 0 && oiLegs === 0) {
    warnings.push("Option chain carries no open-interest data.");
  } else if (legs > 0 && oiLegs < legs / 2) {
    warnings.push("Open interest missing on more than half of the legs.");
  }
  return { ok: true, reason: null, warnings, asOfMs, complete: true, expired: false };
}

/**
 * Authoritative option chain for an F&O underlying (Kite NFO).
 * Returns an explicit unavailable result (never a silent fallback) when Kite is
 * offline, the fetch fails, or the chain fails evaluation.
 */
export async function getOptionChain(
  underlying: string,
  expiry?: string,
): Promise<MarketDataResult<TrustedOptionChain>> {
  let oc: OcResponse | null = null;
  try {
    oc = await fetchKiteOptionChain(underlying.toUpperCase(), expiry);
  } catch (e) {
    const reason = e instanceof Error ? e.message : "Option chain fetch failed.";
    return { ok: false, data: null, meta: unavailableMeta("kite", "authoritative", reason), reason };
  }
  const evaluation = evaluateOptionChain(oc);
  if (!evaluation.ok || !oc) {
    const reason = evaluation.reason ?? "Option chain unavailable.";
    return { ok: false, data: null, meta: unavailableMeta("kite", "authoritative", reason), reason };
  }
  const meta = buildMeta({
    source: "kite",
    trustTier: "authoritative",
    asOfMs: evaluation.asOfMs,
    delayed: false,
    notForSignals: false,
    complete: evaluation.complete,
    warnings: evaluation.warnings,
  });
  return { ok: true, data: { chain: oc, meta }, meta };
}
