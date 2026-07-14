/**
 * INDstocks instrument master — pure CSV parsing + identifier derivation.
 *
 * The INDstocks `/market/instruments?source=equity|fno|index` endpoint returns a
 * raw CSV ("scrip master"). This module turns that CSV into typed rows and
 * derives the `SEGMENT_TOKEN` scrip-code used by the quote/historical endpoints.
 * It NEVER hardcodes a security id — the id always comes from the master row.
 *
 * 100% pure (no network) so it is fully unit-testable from a CSV fixture.
 *
 * Documented CSV columns:
 *   EXCH, SEGMENT, SECURITY_ID, INSTRUMENT_NAME, EXPIRY_CODE, TRADING_SYMBOL,
 *   LOT_UNITS, CUSTOM_SYMBOL, EXPIRY_DATE, STRIKE_PRICE, OPTION_TYPE, TICK_SIZE,
 *   EXPIRY_FLAG, SEM_EXCH_INSTRUMENT_TYPE, SERIES, SYMBOL_NAME
 */

import type { InstrumentAssetClass } from "@workspace/db";

export type IndstocksSource = "equity" | "fno" | "index";

export interface IndstocksInstrument {
  exch: string; // NSE | BSE
  segment: string; // E | FNO | ...
  securityId: string; // unique instrument id (token)
  instrumentName: string; // EQUITY | FUTIDX | OPTIDX | ...
  expiryCode: string;
  tradingSymbol: string;
  lotUnits: number | null;
  customSymbol: string;
  expiryDate: string | null; // raw as published
  strikePrice: number | null;
  optionType: string | null; // CE | PE | null
  tickSize: number | null;
  expiryFlag: string;
  exchInstrumentType: string;
  series: string; // EQ | ...
  symbolName: string; // base symbol e.g. HDFCBANK
  /** Derived `SEGMENT_TOKEN` scrip-code for quotes/historical. */
  scripCode: string;
  /** Derived asset class. */
  assetClass: InstrumentAssetClass;
}

/** Minimal RFC-4180-ish CSV line splitter (handles quoted fields + commas). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function toNum(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function nonEmpty(v: string | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t === "" || t === "0" ? null : t;
}

/**
 * The quote/historical scrip-code prefix. INDstocks uses the exchange-segment
 * (NSE/BSE for cash & index, NFO/BFO for derivatives) joined to the security id.
 * Derived from (EXCH, source) so it is never hardcoded per-symbol.
 */
export function scripSegmentPrefix(exch: string, source: IndstocksSource): string {
  const e = exch.toUpperCase();
  if (source === "fno") {
    if (e === "BSE") return "BFO";
    return "NFO"; // NSE F&O
  }
  // equity + index live on the cash exchange prefix.
  return e === "BSE" ? "BSE" : "NSE";
}

export function scripCodeFor(
  exch: string,
  securityId: string,
  source: IndstocksSource,
): string {
  return `${scripSegmentPrefix(exch, source)}_${securityId}`;
}

function assetClassFor(
  source: IndstocksSource,
  optionType: string | null,
): InstrumentAssetClass {
  if (source === "index") return "INDEX";
  if (source === "equity") return "EQUITY";
  return optionType === "CE" || optionType === "PE" ? "OPT" : "FUT";
}

/**
 * Parse an INDstocks instrument-master CSV for a given source into typed rows.
 * Rows missing the essential (EXCH, SECURITY_ID) are skipped rather than faked.
 */
export function parseInstrumentCsv(
  csv: string,
  source: IndstocksSource,
): IndstocksInstrument[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]!).map((h) => h.toUpperCase());
  const idx = (name: string): number => header.indexOf(name);

  const iExch = idx("EXCH");
  const iSeg = idx("SEGMENT");
  const iSec = idx("SECURITY_ID");
  const iInst = idx("INSTRUMENT_NAME");
  const iExpCode = idx("EXPIRY_CODE");
  const iTrad = idx("TRADING_SYMBOL");
  const iLot = idx("LOT_UNITS");
  const iCustom = idx("CUSTOM_SYMBOL");
  const iExpDate = idx("EXPIRY_DATE");
  const iStrike = idx("STRIKE_PRICE");
  const iOpt = idx("OPTION_TYPE");
  const iTick = idx("TICK_SIZE");
  const iExpFlag = idx("EXPIRY_FLAG");
  const iExchType = idx("SEM_EXCH_INSTRUMENT_TYPE");
  const iSeries = idx("SERIES");
  const iName = idx("SYMBOL_NAME");

  const at = (cols: string[], i: number): string | undefined =>
    i >= 0 ? cols[i] : undefined;

  const out: IndstocksInstrument[] = [];
  for (let r = 1; r < lines.length; r++) {
    const cols = splitCsvLine(lines[r]!);
    const exch = (at(cols, iExch) ?? "").toUpperCase();
    const securityId = (at(cols, iSec) ?? "").trim();
    if (!exch || !securityId) continue;
    const optionType = nonEmpty(at(cols, iOpt));
    out.push({
      exch,
      segment: (at(cols, iSeg) ?? "").toUpperCase(),
      securityId,
      instrumentName: (at(cols, iInst) ?? "").toUpperCase(),
      expiryCode: at(cols, iExpCode) ?? "",
      tradingSymbol: (at(cols, iTrad) ?? "").toUpperCase(),
      lotUnits: toNum(at(cols, iLot)),
      customSymbol: at(cols, iCustom) ?? "",
      expiryDate: nonEmpty(at(cols, iExpDate)),
      strikePrice: toNum(at(cols, iStrike)),
      optionType: optionType ? optionType.toUpperCase() : null,
      tickSize: toNum(at(cols, iTick)),
      expiryFlag: (at(cols, iExpFlag) ?? "").toUpperCase(),
      exchInstrumentType: (at(cols, iExchType) ?? "").toUpperCase(),
      series: (at(cols, iSeries) ?? "").toUpperCase(),
      symbolName: (at(cols, iName) ?? "").toUpperCase(),
      scripCode: scripCodeFor(exch, securityId, source),
      assetClass: assetClassFor(source, optionType ? optionType.toUpperCase() : null),
    });
  }
  return out;
}

/**
 * Index the equity/index master by canonical symbol (NSE cash, EQ series first).
 * Canonical = SYMBOL_NAME (falls back to TRADING_SYMBOL). NSE is preferred over
 * BSE for the same symbol so the canonical key matches the rest of the app.
 */
export function indexEquityBySymbol(
  rows: IndstocksInstrument[],
): Map<string, IndstocksInstrument> {
  const map = new Map<string, IndstocksInstrument>();
  for (const row of rows) {
    const key = (row.symbolName || row.tradingSymbol).toUpperCase();
    if (!key) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, row);
      continue;
    }
    // Prefer NSE EQ over anything else for the canonical equity row.
    const better =
      (row.exch === "NSE" && existing.exch !== "NSE") ||
      (row.exch === existing.exch && row.series === "EQ" && existing.series !== "EQ");
    if (better) map.set(key, row);
  }
  return map;
}
