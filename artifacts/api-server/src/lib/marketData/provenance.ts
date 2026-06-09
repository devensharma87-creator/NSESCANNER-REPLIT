/**
 * Data provenance — maps a trusted-layer `DataMeta` envelope onto the durable
 * provenance columns persisted with each warehouse candle (Task #124 Phase 1).
 *
 * The single field the write-guard depends on is `sourcePriority` (lower =
 * higher trust). Everything else is documentary: it lets a future audit answer
 * "where did this row come from, was it validated, did a failover happen" and
 * lets the write-guard refuse to let lower-trust data overwrite Kite rows.
 */

import type { DataMeta, ProviderName, TrustTier } from "./types";

/** Lower number = higher trust. The candle write-guard compares these. */
export const SOURCE_PRIORITY: Record<TrustTier, number> = {
  authoritative: 1,
  secondary_validation: 2,
  secondary_analytics: 3,
};

/** Priority for a source-less / unknown-tier row — the lowest possible trust. */
export const UNKNOWN_SOURCE_PRIORITY = 99;

export function sourcePriority(tier: TrustTier | null | undefined): number {
  if (tier == null) return UNKNOWN_SOURCE_PRIORITY;
  return SOURCE_PRIORITY[tier] ?? UNKNOWN_SOURCE_PRIORITY;
}

/** The provenance column subset written alongside each candle row. */
export interface CandleProvenance {
  sourceProvider: string;
  sourcePriority: number;
  validatedBy: string | null;
  validationStatus: string | null;
  providerConflictStatus: string | null;
  asof: Date | null;
  fetchedAt: Date | null;
  freshnessSec: number | null;
  isStale: boolean | null;
  tradingsymbol: string | null;
  kiteKey: string | null;
  kiteInstrumentToken: number | null;
  indstocksScripCode: string | null;
  fallbackUsed: boolean | null;
  dataQuality: string | null;
  warnings: string[];
}

export interface ProvenanceExtra {
  tradingsymbol?: string | null;
  kiteKey?: string | null;
  kiteInstrumentToken?: number | null;
  indstocksScripCode?: string | null;
  validatedBy?: ProviderName | null;
  providerConflictStatus?: string | null;
  fallbackUsed?: boolean | null;
}

/** Coarse quality bucket derived from the validation status / staleness. */
export function dataQualityFromMeta(meta: DataMeta): string {
  if (meta.validationStatus === "unavailable") return "UNAVAILABLE";
  if (meta.validationStatus === "incomplete") return "INCOMPLETE";
  if (meta.validationStatus === "mismatch") return "CONFLICT";
  if (meta.validationStatus === "stale" || meta.isStale) return "STALE";
  return "OK";
}

/** Build full provenance from a layer `DataMeta` envelope (the live path). */
export function candleProvenanceFromMeta(
  meta: DataMeta,
  extra: ProvenanceExtra = {},
): CandleProvenance {
  return {
    sourceProvider: meta.source,
    sourcePriority: sourcePriority(meta.trustTier),
    validatedBy: extra.validatedBy ?? null,
    validationStatus: meta.validationStatus,
    providerConflictStatus: extra.providerConflictStatus ?? null,
    asof: meta.asOf ? new Date(meta.asOf) : null,
    fetchedAt: meta.fetchedAt ? new Date(meta.fetchedAt) : null,
    freshnessSec: meta.freshnessSec,
    isStale: meta.isStale,
    tradingsymbol: extra.tradingsymbol ?? null,
    kiteKey: extra.kiteKey ?? null,
    kiteInstrumentToken: extra.kiteInstrumentToken ?? null,
    indstocksScripCode: extra.indstocksScripCode ?? null,
    fallbackUsed: extra.fallbackUsed ?? null,
    dataQuality: dataQualityFromMeta(meta),
    warnings: [...meta.warnings],
  };
}

/**
 * Build provenance for a warehouse historical candle row, which does not carry
 * a full live `DataMeta`. `asof` is the bar's own instant; `freshnessSec`/
 * `isStale` are intentionally not a live-quote freshness judgement here (a
 * definitive historical close is not a "stale" live tick), so freshness is left
 * null and isStale false — the row's age is recoverable from `asof` vs now.
 */
export function candleIngestProvenance(
  source: "kite" | "yahoo",
  opts: {
    tsMs: number;
    nowMs?: number;
    kiteInstrumentToken?: number | null;
    tradingsymbol?: string | null;
  },
): CandleProvenance {
  const trustTier: TrustTier =
    source === "kite" ? "authoritative" : "secondary_analytics";
  const now = opts.nowMs ?? Date.now();
  return {
    sourceProvider: source,
    sourcePriority: sourcePriority(trustTier),
    validatedBy: null,
    validationStatus: "validated",
    providerConflictStatus: null,
    asof: Number.isFinite(opts.tsMs) ? new Date(opts.tsMs) : null,
    fetchedAt: new Date(now),
    freshnessSec: null,
    isStale: false,
    tradingsymbol: opts.tradingsymbol ?? null,
    kiteKey: null,
    kiteInstrumentToken: opts.kiteInstrumentToken ?? null,
    indstocksScripCode: null,
    fallbackUsed: source !== "kite",
    dataQuality: "OK",
    warnings: [],
  };
}
