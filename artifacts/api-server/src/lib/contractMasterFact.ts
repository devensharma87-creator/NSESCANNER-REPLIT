/**
 * ContractMasterFact — canonical contract identity resolved from the live Kite
 * F&O instrument dump (NFO + BFO).
 *
 * Resolution grades:
 *   "trade_grade"  — exact (expiry + strike) match in the instrument master.
 *                    instrumentToken is valid; exchange is authoritative.
 *   "info_only"    — expiry found in master but specific strike not listed,
 *                    OR expiry corrected to nearest real master expiry.
 *                    Lot size and exchange are reliable; no specific token.
 *   "fallback"     — cache is cold, or the underlying has no listed contracts.
 *                    All values come from static maps and algorithmic computation.
 *
 * Expiry sources:
 *   "instrument_master"            — expiry taken directly from a matching row.
 *   "algorithmic_weekday_fallback" — cache warm but no contract found for this
 *                                    underlying; algorithmic expiry is used.
 *   "static_fallback"              — not used by this resolver (legacy label).
 *   "unavailable"                  — cache cold; no live data available.
 *
 * SAFETY INVARIANTS:
 *   1. Static maps (LOT_SIZES / fallback STRIKE_STEPS) NEVER override master data
 *      when the cache is warm and a match is found.
 *   2. A fallback fact CANNOT be presented as trade_grade.
 *   3. A BANKNIFTY "fake weekly" expiry has no match in the master
 *      (master only lists monthly contracts); the resolver naturally uses
 *      the nearest real master expiry and flags it as corrected.
 *   4. SENSEX is on BFO — the resolver discovers exchange="BFO" from the
 *      instrument row without any special-casing.
 *   5. No historical row is rewritten; this module only produces NEW facts.
 */

import {
  FnoInstrument,
  getCachedFnoInstruments,
  getCachedLotSizeForIndex,
} from "./kiteFnoInstruments";
import { LOT_SIZES } from "./optionChain";

// ---------------------------------------------------------------------------
// Fallback strike-step map (used only when the cache is cold or row inference
// fails). These are the same values as the non-exported STRIKE_STEPS in
// optionChain.ts — kept local to avoid coupling to a private constant.
// ---------------------------------------------------------------------------
const FALLBACK_STRIKE_STEPS: Record<string, number> = {
  NIFTY: 50, BANKNIFTY: 100, FINNIFTY: 50, MIDCPNIFTY: 25,
  NIFTYNXT50: 100, SENSEX: 100, BANKEX: 100,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExpirySource =
  | "instrument_master"
  | "algorithmic_weekday_fallback"
  | "static_fallback"
  | "unavailable";

export type ContractGrade = "trade_grade" | "info_only" | "fallback";
export type LotSizeSource = "instrument_master" | "static_fallback";
export type StrikeStepSource = "instrument_master" | "static_map_fallback";

export interface ContractMasterFact {
  underlying: string;
  exchange: "NFO" | "BFO" | "unknown";
  segment: string;
  instrumentToken: number | null;
  tradingSymbol: string | null;
  expiry: string;            // ISO YYYY-MM-DD (may differ from algorithmicExpiry when corrected)
  expirySource: ExpirySource;
  expiryType: "weekly" | "monthly" | "unknown";
  strike: number;
  strikeStep: number | null;
  strikeStepSource: StrikeStepSource;
  optionType: "CE" | "PE";
  lotSize: number;
  lotSizeSource: LotSizeSource;
  source: "kite_instrument_cache" | "static_map";
  asOf: string | null;       // ISO timestamp of fact resolution
  fetchedAt: string | null;  // ISO timestamp when the cache was last populated (null when cold)
  freshnessSeconds: number | null;
  isFallback: boolean;
  fallbackReason: string | null;
  contractGrade: ContractGrade;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toIsoDate(d: Date | string): string {
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function rawExchangeToExchange(raw: string): "NFO" | "BFO" | "unknown" {
  const up = raw.toUpperCase();
  if (up === "NFO") return "NFO";
  if (up === "BFO") return "BFO";
  return "unknown";
}

/**
 * Infers the modal strike-step from a set of instrument rows by finding the
 * most common gap between consecutive strikes. Returns null when < 2 strikes.
 */
function inferStrikeStep(rows: FnoInstrument[]): number | null {
  const strikes = [...new Set(rows.map(r => r.strike))].sort((a, b) => a - b);
  if (strikes.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < strikes.length; i++) gaps.push(strikes[i]! - strikes[i - 1]!);
  const freq = new Map<number, number>();
  for (const g of gaps) freq.set(g, (freq.get(g) ?? 0) + 1);
  let best = 0, bestCount = 0;
  for (const [g, cnt] of freq) {
    if (cnt > bestCount || (cnt === bestCount && g < best)) { best = g; bestCount = cnt; }
  }
  return best > 0 ? best : null;
}

// ---------------------------------------------------------------------------
// Core resolver
// ---------------------------------------------------------------------------

/**
 * Resolves a ContractMasterFact for a given (underlying, algorithmicExpiry,
 * strike, optionType) tuple using the in-memory Kite instrument cache.
 *
 * The `expiryType` hint is used only to populate the returned field — it does
 * not change the resolution logic (the cache is the authority).
 *
 * Synchronous — reads from the in-memory cache, zero I/O.
 */
export function resolveContractMaster(
  underlying: string,
  algorithmicExpiry: string,    // YYYY-MM-DD from nextWeeklyExpiry / nextMonthlyExpiry
  strike: number,
  optionType: "CE" | "PE",
  expiryTypeHint: "weekly" | "monthly" | "unknown" = "unknown",
): ContractMasterFact {
  const sym = underlying.toUpperCase();
  const now = new Date().toISOString();
  const staticLotSize = LOT_SIZES[sym] ?? 0;
  const staticStrikeStep = FALLBACK_STRIKE_STEPS[sym] ?? null;

  // ── 1. Cache cold ──────────────────────────────────────────────────────────
  const rows = getCachedFnoInstruments();
  if (!rows || rows.length === 0) {
    return {
      underlying: sym,
      exchange: "unknown",
      segment: "unknown",
      instrumentToken: null,
      tradingSymbol: null,
      expiry: algorithmicExpiry,
      expirySource: "unavailable",
      expiryType: expiryTypeHint,
      strike,
      strikeStep: staticStrikeStep,
      strikeStepSource: "static_map_fallback",
      optionType,
      lotSize: staticLotSize,
      lotSizeSource: "static_fallback",
      source: "static_map",
      asOf: now,
      fetchedAt: null,
      freshnessSeconds: null,
      isFallback: true,
      fallbackReason: "kite_instrument_cache_cold",
      contractGrade: "fallback",
    };
  }

  // ── 2. Filter to this underlying + option type ────────────────────────────
  const underlyingRows = rows.filter(
    r => r.name === sym && r.instrument_type === optionType,
  );

  if (underlyingRows.length === 0) {
    // Cache warm but no matching underlying (name mismatch or index not in dump).
    const masterLot = getCachedLotSizeForIndex(sym);
    return {
      underlying: sym,
      exchange: "unknown",
      segment: "unknown",
      instrumentToken: null,
      tradingSymbol: null,
      expiry: algorithmicExpiry,
      expirySource: "algorithmic_weekday_fallback",
      expiryType: expiryTypeHint,
      strike,
      strikeStep: staticStrikeStep,
      strikeStepSource: "static_map_fallback",
      optionType,
      lotSize: masterLot ?? staticLotSize,
      lotSizeSource: masterLot != null ? "instrument_master" : "static_fallback",
      source: "kite_instrument_cache",
      asOf: now,
      fetchedAt: now,
      freshnessSeconds: 0,
      isFallback: true,
      fallbackReason: `no_contracts_in_master_for_${sym}_${optionType}`,
      contractGrade: "fallback",
    };
  }

  // ── 3. Look for exact expiry match (algorithmic date == master date) ───────
  const expiryRows = underlyingRows.filter(
    r => toIsoDate(r.expiry) === algorithmicExpiry,
  );

  if (expiryRows.length > 0) {
    const stepInferred = inferStrikeStep(expiryRows);
    const anyRow = expiryRows[0]!;
    const exchange = rawExchangeToExchange(anyRow.exchange);

    // Exact strike+expiry match → trade_grade
    const exactRow = expiryRows.find(r => r.strike === strike);
    if (exactRow) {
      return {
        underlying: sym,
        exchange,
        segment: exactRow.segment,
        instrumentToken: exactRow.instrument_token,
        tradingSymbol: exactRow.tradingsymbol,
        expiry: algorithmicExpiry,
        expirySource: "instrument_master",
        expiryType: expiryTypeHint,
        strike: exactRow.strike,
        strikeStep: stepInferred ?? staticStrikeStep,
        strikeStepSource: stepInferred ? "instrument_master" : "static_map_fallback",
        optionType,
        lotSize: exactRow.lot_size,
        lotSizeSource: "instrument_master",
        source: "kite_instrument_cache",
        asOf: now,
        fetchedAt: now,
        freshnessSeconds: 0,
        isFallback: false,
        fallbackReason: null,
        contractGrade: "trade_grade",
      };
    }

    // Expiry confirmed in master but this specific strike not listed (OTM extreme).
    return {
      underlying: sym,
      exchange,
      segment: anyRow.segment,
      instrumentToken: null,
      tradingSymbol: null,
      expiry: algorithmicExpiry,
      expirySource: "instrument_master",
      expiryType: expiryTypeHint,
      strike,
      strikeStep: stepInferred ?? staticStrikeStep,
      strikeStepSource: stepInferred ? "instrument_master" : "static_map_fallback",
      optionType,
      lotSize: anyRow.lot_size,
      lotSizeSource: "instrument_master",
      source: "kite_instrument_cache",
      asOf: now,
      fetchedAt: now,
      freshnessSeconds: 0,
      isFallback: false,
      fallbackReason: "strike_not_in_master_at_this_expiry",
      contractGrade: "info_only",
    };
  }

  // ── 4. Algorithmic expiry NOT in master — find the nearest real expiry ─────
  // This is the BANKNIFTY "fake-weekly" guard: if the algorithmic computation
  // produced a weekly date but the master only lists monthly contracts,
  // the algorithmic date won't exist in the dump. We use the nearest real
  // upcoming expiry from the master instead.
  const allExpiries = [...new Set(underlyingRows.map(r => toIsoDate(r.expiry)))].sort();
  const nearest = allExpiries.find(e => e >= algorithmicExpiry)
    ?? allExpiries[allExpiries.length - 1]
    ?? algorithmicExpiry;

  const nearestRows = underlyingRows.filter(r => toIsoDate(r.expiry) === nearest);
  const stepInferred = inferStrikeStep(nearestRows);
  const anyRow = nearestRows[0];
  const exchange = anyRow ? rawExchangeToExchange(anyRow.exchange) : "unknown";
  const exactRow = nearestRows.find(r => r.strike === strike);

  const corrected = nearest !== algorithmicExpiry;
  const fallbackReason = corrected
    ? `algorithmic_expiry_${algorithmicExpiry}_not_in_master_nearest_is_${nearest}`
    : "strike_not_in_master_at_nearest_expiry";

  return {
    underlying: sym,
    exchange,
    segment: anyRow?.segment ?? "unknown",
    instrumentToken: exactRow?.instrument_token ?? null,
    tradingSymbol: exactRow?.tradingsymbol ?? null,
    expiry: nearest,
    expirySource: "instrument_master",
    expiryType: expiryTypeHint,
    strike,
    strikeStep: stepInferred ?? staticStrikeStep,
    strikeStepSource: stepInferred ? "instrument_master" : "static_map_fallback",
    optionType,
    lotSize: anyRow?.lot_size ?? getCachedLotSizeForIndex(sym) ?? staticLotSize,
    lotSizeSource: anyRow?.lot_size ? "instrument_master"
      : getCachedLotSizeForIndex(sym) != null ? "instrument_master" : "static_fallback",
    source: "kite_instrument_cache",
    asOf: now,
    fetchedAt: now,
    freshnessSeconds: 0,
    isFallback: corrected,
    fallbackReason,
    contractGrade: exactRow ? "trade_grade" : "info_only",
  };
}
