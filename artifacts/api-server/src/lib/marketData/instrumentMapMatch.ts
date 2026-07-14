/**
 * Instrument-map matcher — PURE cross-provider identity check.
 *
 * Given the authoritative Kite identifiers for a canonical symbol and the
 * candidate INDstocks instrument-master row, decide:
 *   - the merged `instrument_map` row (both providers' ids + contract attrs), and
 *   - the `mappingStatus`: VERIFIED only when the two providers provably describe
 *     the SAME instrument (exchange/lot/strike/option-type agree) and — for
 *     derivatives — the contract has not expired. Otherwise CONFLICT / EXPIRED /
 *     UNVERIFIED with an explicit warning.
 *
 * No I/O, no globals — fully unit-testable. Nothing is fabricated: every field on
 * the row comes from one of the two providers.
 */

import type {
  InstrumentAssetClass,
  MappingStatus,
  NewInstrumentMapRow,
} from "@workspace/db";
import type { IndstocksInstrument } from "./indstocksInstruments";

export interface KiteInstrumentRef {
  canonicalSymbol: string;
  assetClass: InstrumentAssetClass;
  instrumentToken: number;
  tradingSymbol: string;
  exchange: string; // NSE | BSE | NFO | BFO
  lotSize?: number | null;
  tickSize?: number | null;
  expiryDate?: string | null; // YYYY-MM-DD
  strike?: number | null;
  optionType?: string | null; // CE | PE | null
}

export interface MatchResult {
  row: NewInstrumentMapRow;
  status: MappingStatus;
  warning: string | null;
}

/** Collapse derivative exchange codes to their cash exchange for comparison. */
function baseExch(e: string | null | undefined): string {
  const x = (e ?? "").toUpperCase();
  if (x === "NFO") return "NSE";
  if (x === "BFO") return "BSE";
  return x;
}

function approxEq(a: number | null | undefined, b: number | null | undefined, eps: number): boolean {
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= eps;
}

function isDerivative(ac: InstrumentAssetClass): boolean {
  return ac === "FUT" || ac === "OPT";
}

/** Normalise a published expiry (ISO or epoch-ms or dd-MMM-yyyy) to YYYY-MM-DD. */
export function normaliseExpiry(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const asNum = Number(s);
  if (Number.isFinite(asNum) && asNum > 1_000_000_000) {
    const ms = asNum < 1e12 ? asNum * 1000 : asNum;
    return new Date(ms).toISOString().slice(0, 10);
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function matchInstrument(
  kite: KiteInstrumentRef,
  ind: IndstocksInstrument,
  opts?: { todayIso?: string },
): MatchResult {
  const today = opts?.todayIso ?? new Date().toISOString().slice(0, 10);
  const expiry = normaliseExpiry(kite.expiryDate ?? ind.expiryDate);

  const row: NewInstrumentMapRow = {
    canonicalSymbol: kite.canonicalSymbol.toUpperCase(),
    assetClass: kite.assetClass,
    kiteInstrumentToken: kite.instrumentToken,
    kiteTradingSymbol: kite.tradingSymbol.toUpperCase(),
    kiteExchange: kite.exchange.toUpperCase(),
    indstocksSecurityId: ind.securityId,
    indstocksScripCode: ind.scripCode,
    indstocksTradingSymbol: ind.tradingSymbol,
    indstocksExchange: ind.exch,
    lotSize: kite.lotSize ?? ind.lotUnits ?? null,
    tickSize: kite.tickSize ?? ind.tickSize ?? null,
    expiryDate: expiry,
    strike: kite.strike ?? ind.strikePrice ?? null,
    optionType: (kite.optionType ?? ind.optionType ?? null) || null,
    mappingStatus: "UNVERIFIED",
    mappingWarning: null,
  };

  const conflicts: string[] = [];

  // Exchange identity.
  if (baseExch(kite.exchange) !== baseExch(ind.exch)) {
    conflicts.push(`exchange mismatch (kite=${kite.exchange} indstocks=${ind.exch})`);
  }

  // Asset-class consistency vs the INDstocks-derived class.
  if (kite.assetClass !== ind.assetClass) {
    conflicts.push(`asset-class mismatch (kite=${kite.assetClass} indstocks=${ind.assetClass})`);
  }

  if (isDerivative(kite.assetClass)) {
    // Lot size must agree exactly when both known.
    if (kite.lotSize != null && ind.lotUnits != null && kite.lotSize !== ind.lotUnits) {
      conflicts.push(`lot-size mismatch (kite=${kite.lotSize} indstocks=${ind.lotUnits})`);
    }
    if (kite.assetClass === "OPT") {
      if (kite.strike != null && ind.strikePrice != null && !approxEq(kite.strike, ind.strikePrice, 0.01)) {
        conflicts.push(`strike mismatch (kite=${kite.strike} indstocks=${ind.strikePrice})`);
      }
      const kOpt = (kite.optionType ?? "").toUpperCase();
      const iOpt = (ind.optionType ?? "").toUpperCase();
      if (kOpt && iOpt && kOpt !== iOpt) {
        conflicts.push(`option-type mismatch (kite=${kOpt} indstocks=${iOpt})`);
      }
    }
  }

  // Expired derivative — unusable regardless of identity agreement.
  if (isDerivative(kite.assetClass) && expiry && expiry < today) {
    row.mappingStatus = "EXPIRED";
    row.mappingWarning = `Derivative expired on ${expiry}.`;
    return { row, status: "EXPIRED", warning: row.mappingWarning };
  }

  if (conflicts.length > 0) {
    row.mappingStatus = "CONFLICT";
    row.mappingWarning = conflicts.join("; ");
    return { row, status: "CONFLICT", warning: row.mappingWarning };
  }

  // Completeness: both ids present.
  if (!row.indstocksScripCode || !row.indstocksSecurityId || !row.kiteInstrumentToken) {
    row.mappingStatus = "UNVERIFIED";
    row.mappingWarning = "Missing one provider's identifiers.";
    return { row, status: "UNVERIFIED", warning: row.mappingWarning };
  }

  row.mappingStatus = "VERIFIED";
  row.mappingWarning = null;
  return { row, status: "VERIFIED", warning: null };
}
