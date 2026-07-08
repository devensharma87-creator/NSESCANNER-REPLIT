/**
 * Sprint 3 — Gamma Exposure (GEX) computation helpers.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * OI UNIT MODEL (verified 2026-06-12)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * RAW OI UNITS:
 *   • Kite `q.oi`            → number of CONTRACTS (lots)
 *   • NSE  `openInterest`    → number of CONTRACTS (lots)
 *   • Both sources use the SAME convention: 1 unit of OI = 1 contract = 1 lot
 *
 * CONVERSION:
 *   effectiveUnderlyingQuantity = rawOI_contracts × lotSize
 *   where lotSize = number of underlying shares per contract
 *
 * PROOF: oiLab.ts line 1746 computes rupee notional as:
 *   `notional = ltp * q.oi * lot_size`
 *   This is correct ONLY when q.oi is in contracts (lots), because:
 *   rupee_notional = option_ltp × contracts × shares_per_contract
 *
 * ═══════════════════════════════════════════════════════════════════════
 * GEX FORMULA
 * ═══════════════════════════════════════════════════════════════════════
 *
 * GEX per 1% move = gamma × effectiveUnderlyingQuantity × spot² × 0.01
 *                 = gamma × (rawOI_contracts × lotSize) × spot² × 0.01
 *
 * Where:
 *   - gamma: Black-Scholes gamma, per-option (per single underlying unit)
 *   - rawOI_contracts: number of open contracts (lots) from Kite/NSE
 *   - lotSize: contract multiplier (underlying shares per contract)
 *   - spot: underlying price
 *   - 0.01: converts to "per 1% move"
 *
 * SIGN CONVENTION:
 *   - Call GEX: positive (dealers are long gamma on calls)
 *   - Put GEX: negative (dealers are short gamma on puts)
 *   - Net GEX = Call GEX + Put GEX
 *
 * MODELLED VALUE — labelled "MODELLED GEX — not exchange provided" in UI.
 * NOT used for: paper-trade gate, F&O signal permission, risk sizing.
 *
 * When gamma, IV, spot, expiry, or OI is missing:
 *   - GEX = null (unavailable)
 *   - Never faked or estimated silently
 */

import type { OcRow, OcResponse } from "./optionChain";

// ─── OI Unit Normalization ────────────────────────────────────────────────────

/**
 * OI unit descriptor. Determines how raw OI from the data source maps to
 * underlying shares/units.
 *
 * "contracts" (default): raw OI is in number of contracts (lots).
 *   effectiveUnderlyingQuantity = rawOI × lotSize.
 *   This is the unit used by BOTH Kite (`q.oi`) and NSE (`openInterest`).
 *
 * "quantity": raw OI is already in underlying shares/units.
 *   effectiveUnderlyingQuantity = rawOI (no multiplication).
 *   Currently no data source uses this convention, but the helper supports
 *   it for future-proofing and testability.
 */
export type OpenInterestUnit = "contracts" | "quantity";

/**
 * Convert raw OI to underlying quantity (shares/units), accounting for the
 * unit convention of the data source.
 *
 * @param rawOI - Open interest value as received from the data source
 * @param openInterestUnit - How the source reports OI:
 *   - "contracts" (default): rawOI is number of contracts/lots → multiply by lotSize
 *   - "quantity": rawOI is already underlying shares → pass through
 * @param lotSize - Contract multiplier (shares per contract). Required when
 *   openInterestUnit = "contracts". If missing/invalid for contracts, returns null.
 * @returns Effective underlying quantity, or null if conversion is impossible
 */
export function normalizeOiToQuantity(
  rawOI: number,
  openInterestUnit: OpenInterestUnit = "contracts",
  lotSize?: number | null,
): number | null {
  if (!Number.isFinite(rawOI) || rawOI < 0) return null;

  if (openInterestUnit === "contracts") {
    if (lotSize == null || !Number.isFinite(lotSize) || lotSize <= 0) return null;
    return rawOI * lotSize;
  }

  // "quantity" — already in underlying units, no conversion needed
  return rawOI;
}

// ─── Per-Strike GEX ──────────────────────────────────────────────────────────

export interface StrikeGex {
  strike: number;
  /** Gamma exposure from the call side (always ≥ 0). */
  callGex: number;
  /** Gamma exposure from the put side (always ≤ 0). */
  putGex: number;
  /** Net GEX at this strike = callGex + putGex. */
  netGex: number;
}

export interface GexResult {
  /** Net GEX across all strikes (sum of per-strike netGex). */
  netGex: number;
  /** Strike where cumulative net GEX crosses zero. Null when no crossing
   *  exists (all positive or all negative) or when data is insufficient. */
  flipPoint: number | null;
  /** Per-strike breakdown. */
  perStrike: StrikeGex[];
  /** Always true — GEX is modelled from Black-Scholes gamma, never
   *  exchange-provided. */
  modelled: true;
  /** Human-readable label for the UI. */
  label: string;
}

/**
 * Compute Gamma Exposure per strike for all rows in a chain.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * FORMULA:
 *
 *   GEX_per_side = gamma × effectiveUnderlyingQty × spot² × 0.01
 *
 *   where effectiveUnderlyingQty = rawOI_contracts × lotSize
 *
 * Since Kite/NSE OI is in CONTRACTS (lots), and gamma is per-single-share,
 * we must multiply OI by lotSize to get the total underlying exposure.
 *
 * NUMERIC EXAMPLE A — OI in contracts (Kite/NSE, the actual case):
 *   NIFTY spot = 24,000 | lotSize = 25 | ATM CE gamma = 0.0005 | CE OI = 10,000 contracts
 *   effectiveQty = 10,000 × 25 = 250,000 shares
 *   spotSqPct    = 24,000² × 0.01 = 5,760,000
 *   callGex      = 0.0005 × 250,000 × 5,760,000 = 720,000,000,000 ✓
 *   (equivalently: 0.0005 × 10,000 × 25 × 5,760,000 = 720,000,000,000)
 *
 * NUMERIC EXAMPLE B — OI already in quantity (hypothetical source):
 *   Same scenario but OI = 250,000 shares (already underlying qty)
 *   No lotSize multiplication needed.
 *   callGex = 0.0005 × 250,000 × 5,760,000 = 720,000,000,000 ✓
 *   (same result, because 10,000 contracts × 25 = 250,000 shares)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * @param rows - Strike rows from the option chain
 * @param spot - Underlying spot price
 * @param lotSize - Contract multiplier (shares per contract). Required
 *   because Kite/NSE OI is in contracts.
 * @param openInterestUnit - How OI is reported in the rows:
 *   - "contracts" (default): multiply OI × lotSize for effective quantity
 *   - "quantity": OI already in underlying shares (no multiplication)
 *
 * Returns null when any required input is missing. Never returns fake values.
 */
export function computeGexPerStrike(
  rows: OcRow[],
  spot: number,
  lotSize: number | null | undefined,
  openInterestUnit: OpenInterestUnit = "contracts",
): GexResult | null {
  // Guard: no fake GEX when required inputs are missing
  if (!Number.isFinite(spot) || spot <= 0) return null;
  if (!rows || rows.length === 0) return null;

  // When OI is in contracts, lotSize is required to compute underlying quantity
  if (openInterestUnit === "contracts") {
    if (lotSize == null || !Number.isFinite(lotSize) || lotSize <= 0) return null;
  }

  const spotSqPct = spot * spot * 0.01;
  const perStrike: StrikeGex[] = [];
  let totalNetGex = 0;
  let hasAnyGamma = false;

  for (const row of rows) {
    let callGex = 0;
    let putGex = 0;

    // Call side: positive GEX (dealers long gamma)
    if (row.ce?.gamma != null && Number.isFinite(row.ce.gamma) && row.ce.gamma > 0) {
      const rawOI = row.ce.oi ?? 0;
      if (rawOI > 0) {
        const effectiveQty = normalizeOiToQuantity(rawOI, openInterestUnit, lotSize);
        if (effectiveQty != null && effectiveQty > 0) {
          callGex = row.ce.gamma * effectiveQty * spotSqPct;
          hasAnyGamma = true;
        }
      }
    }

    // Put side: negative GEX (dealers short gamma)
    if (row.pe?.gamma != null && Number.isFinite(row.pe.gamma) && row.pe.gamma > 0) {
      const rawOI = row.pe.oi ?? 0;
      if (rawOI > 0) {
        const effectiveQty = normalizeOiToQuantity(rawOI, openInterestUnit, lotSize);
        if (effectiveQty != null && effectiveQty > 0) {
          putGex = -(row.pe.gamma * effectiveQty * spotSqPct);
          hasAnyGamma = true;
        }
      }
    }

    const netGex = callGex + putGex;
    totalNetGex += netGex;
    perStrike.push({
      strike: row.strike,
      callGex: +callGex.toFixed(2),
      putGex: +putGex.toFixed(2),
      netGex: +netGex.toFixed(2),
    });
  }

  // If no strike had usable gamma, return null (GEX unavailable)
  if (!hasAnyGamma) return null;

  const flipPoint = computeGexFlipPoint(perStrike);

  return {
    netGex: +totalNetGex.toFixed(2),
    flipPoint,
    perStrike,
    modelled: true,
    label: "MODELLED GEX (Black-Scholes Gamma) — not exchange-verified",
  };
}

/**
 * Find the strike where cumulative net GEX crosses zero.
 *
 * Walk strikes from lowest to highest, accumulating net GEX. The flip
 * point is the strike between two consecutive strikes where the cumulative
 * sum changes sign. When the crossover happens between strike A and
 * strike B, we interpolate linearly.
 *
 * Returns null when:
 *   - No sign change exists (all positive or all negative)
 *   - Fewer than 2 strikes
 */
export function computeGexFlipPoint(perStrike: StrikeGex[]): number | null {
  if (perStrike.length < 2) return null;

  // Sort ascending by strike (should already be, but be safe)
  const sorted = [...perStrike].sort((a, b) => a.strike - b.strike);

  let cumGex = sorted[0]!.netGex;
  let prevStrike = sorted[0]!.strike;

  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i]!;
    const newCum = cumGex + s.netGex;

    // Check for sign change
    if ((cumGex > 0 && newCum <= 0) || (cumGex < 0 && newCum >= 0)) {
      // Linear interpolation between prevStrike and s.strike
      if (Math.abs(newCum - cumGex) > 1e-10) {
        const ratio = Math.abs(cumGex) / Math.abs(newCum - cumGex);
        const flip = prevStrike + ratio * (s.strike - prevStrike);
        return +flip.toFixed(2);
      }
      return s.strike;
    }

    prevStrike = s.strike;
    cumGex = newCum;
  }

  return null;
}

/**
 * Convenience: compute GEX from an OcResponse.
 *
 * Uses openInterestUnit = "contracts" because Kite/NSE OI is always in
 * contracts (lots). This is the ONLY unit convention in our data pipeline.
 * Returns null when the chain doesn't have the required data.
 */
export function computeChainGex(chain: OcResponse): GexResult | null {
  return computeGexPerStrike(chain.rows, chain.spot, chain.lotSize, "contracts");
}
