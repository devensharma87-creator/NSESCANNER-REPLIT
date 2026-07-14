/**
 * Instrument-map store + resolver — the gate that makes INDstocks data safe.
 *
 * Persists merged cross-provider rows (built by the PURE `instrumentMapMatch`)
 * and answers the only question the router cares about:
 *   getVerifiedIndstocksScrip(canonical) → a scrip-code ONLY when the mapping is
 *   VERIFIED, complete and (for derivatives) not expired — otherwise an explicit
 *   reason. Unverified / conflicting / expired mappings are NEVER returned.
 *
 * All write paths are gated by `isIndstocksEnabled()` so nothing touches the
 * provider or persists mappings while INDstocks is disabled. Single-replica
 * in-memory caches (sync time + status counts) feed the sync diagnostics, mirror
 * of the swing-scanner store pattern.
 */

import { and, eq } from "drizzle-orm";
import {
  db,
  instrumentMapTable,
  type InstrumentAssetClass,
  type InstrumentMapRow,
  type MappingStatus,
  type NewInstrumentMapRow,
} from "@workspace/db";
import { isIndstocksEnabled } from "./indstocksProvider";
import { matchInstrument, type KiteInstrumentRef } from "./instrumentMapMatch";
import type { IndstocksInstrument } from "./indstocksInstruments";

export interface ResolveResult {
  ok: boolean;
  scripCode: string | null;
  securityId: string | null;
  status: MappingStatus | "MISSING";
  reason: string | null;
}

export interface MapSyncStats {
  lastSyncAt: string | null;
  lastSyncSource: string | null;
  counts: Record<MappingStatus, number>;
  total: number;
}

const EMPTY_COUNTS: Record<MappingStatus, number> = {
  VERIFIED: 0,
  UNVERIFIED: 0,
  CONFLICT: 0,
  EXPIRED: 0,
};

/**
 * Mapping-freshness TTL on `lastVerifiedAt`. A VERIFIED row is only trustworthy
 * for as long as it has been re-verified recently — a stale (or never-stamped)
 * verification is rejected with an explicit reason so INDstocks is never used
 * behind an old mapping. Cash instruments are remapped weekly, derivatives daily
 * pre-open; the grace windows below sit just beyond those cadences.
 */
export const MAPPING_MAX_AGE_MS = {
  derivative: 2 * 24 * 60 * 60 * 1000, // F&O: daily remap + 1-day grace
  cash: 8 * 24 * 60 * 60 * 1000, // equity/index: weekly remap + 1-day grace
} as const;

let syncCache: MapSyncStats = {
  lastSyncAt: null,
  lastSyncSource: null,
  counts: { ...EMPTY_COUNTS },
  total: 0,
};

/** Sync diagnostics snapshot (no I/O). */
export function getMapSyncStats(): MapSyncStats {
  return { ...syncCache, counts: { ...syncCache.counts } };
}

/**
 * Resolve a canonical symbol to a VERIFIED, usable INDstocks scrip-code.
 * Returns an honest reason whenever the mapping cannot be trusted.
 */
export async function getVerifiedIndstocksScrip(
  canonicalSymbol: string,
  assetClass: InstrumentAssetClass = "EQUITY",
): Promise<ResolveResult> {
  if (!isIndstocksEnabled()) {
    return {
      ok: false,
      scripCode: null,
      securityId: null,
      status: "MISSING",
      reason: "INDstocks is disabled.",
    };
  }
  const rows = await db
    .select()
    .from(instrumentMapTable)
    .where(
      and(
        eq(instrumentMapTable.canonicalSymbol, canonicalSymbol.toUpperCase()),
        eq(instrumentMapTable.assetClass, assetClass),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    return {
      ok: false,
      scripCode: null,
      securityId: null,
      status: "MISSING",
      reason: `No instrument mapping for ${canonicalSymbol} (${assetClass}).`,
    };
  }
  return evaluateRow(row);
}

/** Pure-ish evaluation of a persisted row for usability (today- + now-aware). */
export function evaluateRow(
  row: InstrumentMapRow,
  todayIso?: string,
  nowMs?: number,
): ResolveResult {
  const status = row.mappingStatus as MappingStatus;
  if (status !== "VERIFIED") {
    return {
      ok: false,
      scripCode: row.indstocksScripCode,
      securityId: row.indstocksSecurityId,
      status,
      reason: row.mappingWarning ?? `Mapping status is ${status}, not VERIFIED.`,
    };
  }
  const today = todayIso ?? new Date().toISOString().slice(0, 10);
  if ((row.assetClass === "FUT" || row.assetClass === "OPT") && row.expiryDate && row.expiryDate < today) {
    return {
      ok: false,
      scripCode: row.indstocksScripCode,
      securityId: row.indstocksSecurityId,
      status: "EXPIRED",
      reason: `Derivative expired on ${row.expiryDate}.`,
    };
  }
  if (!row.indstocksScripCode || !row.indstocksSecurityId) {
    return {
      ok: false,
      scripCode: row.indstocksScripCode,
      securityId: row.indstocksSecurityId,
      status: "UNVERIFIED",
      reason: "Verified row is missing INDstocks identifiers.",
    };
  }
  // Freshness: a VERIFIED row must have been re-verified within its TTL. A
  // never-stamped or stale verification is rejected (cannot prove the mapping is
  // still correct), so INDstocks is never used behind an old mapping.
  const isDeriv = row.assetClass === "FUT" || row.assetClass === "OPT";
  const maxAge = isDeriv ? MAPPING_MAX_AGE_MS.derivative : MAPPING_MAX_AGE_MS.cash;
  const verifiedMs = row.lastVerifiedAt ? row.lastVerifiedAt.getTime() : null;
  const now = nowMs ?? Date.now();
  if (verifiedMs == null || now - verifiedMs > maxAge) {
    return {
      ok: false,
      scripCode: row.indstocksScripCode,
      securityId: row.indstocksSecurityId,
      status: "VERIFIED",
      reason:
        verifiedMs == null
          ? "Verified mapping has no lastVerifiedAt timestamp; cannot prove freshness."
          : `Mapping verification is stale (last verified ${row.lastVerifiedAt!.toISOString().slice(0, 10)}); re-verify before use.`,
    };
  }
  return {
    ok: true,
    scripCode: row.indstocksScripCode,
    securityId: row.indstocksSecurityId,
    status: "VERIFIED",
    reason: null,
  };
}

/** Upsert merged mapping rows, keyed by (canonicalSymbol, assetClass). */
async function upsertRows(rows: NewInstrumentMapRow[]): Promise<void> {
  for (const row of rows) {
    await db
      .insert(instrumentMapTable)
      .values(row)
      .onConflictDoUpdate({
        target: [instrumentMapTable.canonicalSymbol, instrumentMapTable.assetClass],
        set: {
          kiteInstrumentToken: row.kiteInstrumentToken,
          kiteTradingSymbol: row.kiteTradingSymbol,
          kiteExchange: row.kiteExchange,
          indstocksSecurityId: row.indstocksSecurityId,
          indstocksScripCode: row.indstocksScripCode,
          indstocksTradingSymbol: row.indstocksTradingSymbol,
          indstocksExchange: row.indstocksExchange,
          lotSize: row.lotSize,
          tickSize: row.tickSize,
          expiryDate: row.expiryDate,
          strike: row.strike,
          optionType: row.optionType,
          mappingStatus: row.mappingStatus,
          mappingWarning: row.mappingWarning,
          lastVerifiedAt: row.mappingStatus === "VERIFIED" ? new Date() : null,
          updatedAt: new Date(),
        },
      });
  }
}

/**
 * Build + persist mappings from the two providers' instrument masters.
 * Pure matching is delegated to `matchInstrument`; only VERIFIED-eligible rows
 * are even attempted (a row is created only when BOTH providers describe it).
 * Gated by `isIndstocksEnabled()`.
 *
 * @param indBySymbol  INDstocks rows indexed by the SAME canonical key as Kite.
 */
export async function refreshMappings(
  kiteRefs: KiteInstrumentRef[],
  indBySymbol: Map<string, IndstocksInstrument>,
  source: string,
  opts?: { todayIso?: string },
): Promise<MapSyncStats> {
  if (!isIndstocksEnabled()) return getMapSyncStats();

  const rows: NewInstrumentMapRow[] = [];
  const counts: Record<MappingStatus, number> = { ...EMPTY_COUNTS };
  for (const kite of kiteRefs) {
    const ind = indBySymbol.get(kite.canonicalSymbol.toUpperCase());
    if (!ind) continue; // never fabricate a one-sided mapping
    const { row, status } = matchInstrument(kite, ind, opts);
    rows.push(row);
    counts[status] += 1;
  }
  if (rows.length > 0) await upsertRows(rows);

  syncCache = {
    lastSyncAt: new Date().toISOString(),
    lastSyncSource: source,
    counts,
    total: rows.length,
  };
  return getMapSyncStats();
}

/** Live status counts straight from the DB (async; for the compare endpoint). */
export async function getMappingCountsLive(): Promise<MapSyncStats> {
  if (!isIndstocksEnabled()) return getMapSyncStats();
  const rows = await db
    .select({ status: instrumentMapTable.mappingStatus })
    .from(instrumentMapTable);
  const counts: Record<MappingStatus, number> = { ...EMPTY_COUNTS };
  for (const r of rows) {
    const s = r.status as MappingStatus;
    if (s in counts) counts[s] += 1;
  }
  return {
    lastSyncAt: syncCache.lastSyncAt,
    lastSyncSource: syncCache.lastSyncSource,
    counts,
    total: rows.length,
  };
}
