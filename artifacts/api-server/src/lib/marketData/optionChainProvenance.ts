/**
 * Option-chain provenance (F&O signal-safety, 2026-06-10).
 *
 * A pure, network-free helper that turns a raw `OcResponse` (whatever the legacy
 * `fetchOptionChain` produced) into an honest provenance envelope so every
 * consumer can answer: which provider produced this chain, is it trusted enough
 * to power an OFFICIAL F&O signal / paper trade, and — if not — exactly why.
 *
 * Owner policy (2026-06-10):
 *   - Kite (NFO) is the ONLY source trusted to power signals / paper trades /
 *     stop-target premium / risk.
 *   - NSE-direct is a REAL exchange source and may be SHOWN on the option-chain
 *     display page, but it is a fallback: it must be clearly labelled and must
 *     NEVER silently feed a signal/trade decision.
 *   - Yahoo / synthetic / unknown never touch F&O at all.
 *
 * This module decides trust by SOURCE (Kite vs not). It does not fabricate
 * freshness: `OcResponse.generatedAt` is the chain's fetch instant, so freshness
 * here is fetch-age, surfaced honestly rather than presented as exchange time.
 */

import { computeFreshness } from "./freshness";
import type { OcResponse } from "../optionChain";

export type OcSourceProvider = "kite" | "nse" | "yahoo" | "unknown";

/** Lower = higher trust. Mirrors the central layer's trust ordering. */
export const OC_SOURCE_PRIORITY: Record<OcSourceProvider, number> = {
  kite: 1,
  nse: 2,
  yahoo: 3,
  unknown: 99,
};

/**
 * Normalise the free-form `OcResponse.source` string into a known provider.
 * The Kite path stamps "kite"; the NSE-direct path stamps "NSE"; anything else
 * (including a Yahoo-derived spot) is treated as untrusted.
 */
export function classifyOcSource(raw: string | null | undefined): OcSourceProvider {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return "unknown";
  if (s.includes("kite")) return "kite";
  if (s.includes("nse")) return "nse";
  if (s.includes("yahoo")) return "yahoo";
  return "unknown";
}

export interface OptionChainProvenance {
  /** Normalised provider that produced the chain. */
  sourceProvider: OcSourceProvider;
  /** Lower = higher trust (see OC_SOURCE_PRIORITY). */
  sourcePriority: number;
  /** Chain generation instant (ISO) or null when unknown. */
  asof: string | null;
  /** When this envelope was computed (ISO). */
  fetchedAt: string;
  /** Age in seconds (now − asof), or null when asof unknown. */
  freshnessSec: number | null;
  /** True when older than the freshness budget. */
  isStale: boolean;
  /** True whenever the chain did NOT come from the authoritative Kite source. */
  fallbackUsed: boolean;
  /** Derivatives exchange/segment for the chain (documentary). */
  exchange: string | null;
  segment: "OPT";
  expiry: string | null;
  lotSize: number | null;
  /** Count of legs and how many carry positive OI (honest OI coverage). */
  legCount: number;
  oiLegCount: number;
  /**
   * HARD trust verdict for signals/trades: only a complete, non-expired,
   * non-stale, Kite-sourced chain qualifies. NSE/Yahoo/unknown never do.
   */
  trustedForSignals: boolean;
  /** Always a concrete reason when the chain is missing/unavailable. */
  missingReason: string | null;
  /** Human-readable degradations / fallback notes. */
  warnings: string[];
}

export interface BuildOcProvenanceOpts {
  nowMs?: number;
  /** Concrete reason when `chain` is null (never silent). */
  missingReason?: string;
}

function isoToMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Build the provenance envelope for a (possibly null) option chain. Never
 * throws; always returns a concrete verdict + reason.
 */
export function buildOptionChainProvenance(
  chain: OcResponse | null,
  opts: BuildOcProvenanceOpts = {},
): OptionChainProvenance {
  const now = opts.nowMs ?? Date.now();
  const fetchedAt = new Date(now).toISOString();

  if (!chain) {
    return {
      sourceProvider: "unknown",
      sourcePriority: OC_SOURCE_PRIORITY.unknown,
      asof: null,
      fetchedAt,
      freshnessSec: null,
      isStale: true,
      fallbackUsed: true,
      exchange: null,
      segment: "OPT",
      expiry: null,
      lotSize: null,
      legCount: 0,
      oiLegCount: 0,
      trustedForSignals: false,
      missingReason: opts.missingReason ?? "Option chain unavailable.",
      warnings: [opts.missingReason ?? "Option chain unavailable."],
    };
  }

  const sourceProvider = classifyOcSource(chain.source);
  const sourcePriority = OC_SOURCE_PRIORITY[sourceProvider];
  const asOfMs = isoToMs(chain.generatedAt);
  const fresh = computeFreshness(asOfMs, now);

  const rows = Array.isArray(chain.rows) ? chain.rows : [];
  const legCount = rows.reduce((n, r) => n + (r.ce ? 1 : 0) + (r.pe ? 1 : 0), 0);
  const oiLegCount = rows.reduce(
    (n, r) => n + ((r.ce?.oi ?? 0) > 0 ? 1 : 0) + ((r.pe?.oi ?? 0) > 0 ? 1 : 0),
    0,
  );

  const nowDay = fetchedAt.slice(0, 10);
  const expired = !!chain.expiry && chain.expiry < nowDay;
  const fallbackUsed = sourceProvider !== "kite";

  const warnings: string[] = [];
  if (fallbackUsed) {
    warnings.push(
      sourceProvider === "nse"
        ? "Kite unavailable; showing NSE fallback data (display only; not used for official signals)."
        : `Untrusted option-chain source "${sourceProvider}" — display only; not used for official signals.`,
    );
  }
  if (expired) warnings.push(`Active expiry ${chain.expiry} is in the past.`);
  if (legCount > 0 && oiLegCount === 0) {
    warnings.push("Option chain carries no open-interest data.");
  } else if (legCount > 0 && oiLegCount < legCount / 2) {
    warnings.push("Open interest missing on more than half of the legs.");
  }
  if (fresh.isStale) warnings.push("Option chain older than the freshness budget.");

  const trustedForSignals =
    sourceProvider === "kite" &&
    !fallbackUsed &&
    !expired &&
    !fresh.isStale &&
    legCount > 0 &&
    chain.spot > 0;

  return {
    sourceProvider,
    sourcePriority,
    asof: asOfMs != null ? new Date(asOfMs).toISOString() : null,
    fetchedAt,
    freshnessSec: fresh.freshnessSec,
    isStale: fresh.isStale,
    fallbackUsed,
    exchange: sourceProvider === "kite" ? "NFO" : sourceProvider === "nse" ? "NSE" : null,
    segment: "OPT",
    expiry: chain.expiry ?? null,
    lotSize: chain.lotSize ?? null,
    legCount,
    oiLegCount,
    trustedForSignals,
    missingReason: null,
    warnings,
  };
}

/**
 * The single predicate signal/paper-trade code must consult before treating an
 * option premium/OI as decision-grade. Returns a concrete reason when untrusted.
 */
export function premiumTrustVerdict(
  prov: OptionChainProvenance,
): { trusted: boolean; reason: string | null } {
  if (prov.trustedForSignals) return { trusted: true, reason: null };
  if (prov.missingReason) return { trusted: false, reason: prov.missingReason };
  if (prov.sourceProvider !== "kite") {
    return {
      trusted: false,
      reason: `Option premium from "${prov.sourceProvider}" fallback — not Kite-trusted.`,
    };
  }
  if (prov.isStale) return { trusted: false, reason: "Option premium stale." };
  if (prov.legCount === 0) return { trusted: false, reason: "Option chain has no strikes." };
  return { trusted: false, reason: "Option premium source not trusted." };
}
