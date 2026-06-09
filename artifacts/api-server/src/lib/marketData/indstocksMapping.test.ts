import { describe, it, expect, beforeEach } from "vitest";

import { matchInstrument, normaliseExpiry, type KiteInstrumentRef } from "./instrumentMapMatch";
import { evaluateRow, MAPPING_MAX_AGE_MS } from "./instrumentMapStore";
import type { InstrumentMapRow } from "@workspace/db";
import {
  parseInstrumentCsv,
  scripCodeFor,
  scripSegmentPrefix,
  indexEquityBySymbol,
  type IndstocksInstrument,
} from "./indstocksInstruments";
import { validateQuotePair } from "./sourceValidation";
import {
  recordValidation,
  recordFailover,
  getValidationStats,
  __resetValidationStatsForTests,
} from "./validationStats";
import type { QuoteCore } from "./types";

function indEquity(over: Partial<IndstocksInstrument> = {}): IndstocksInstrument {
  return {
    exch: "NSE",
    segment: "E",
    securityId: "1333",
    instrumentName: "EQUITY",
    expiryCode: "",
    tradingSymbol: "HDFCBANK",
    lotUnits: null,
    customSymbol: "HDFCBANK",
    expiryDate: null,
    strikePrice: null,
    optionType: null,
    tickSize: 0.05,
    expiryFlag: "",
    exchInstrumentType: "ES",
    series: "EQ",
    symbolName: "HDFCBANK",
    scripCode: "NSE_1333",
    assetClass: "EQUITY",
    ...over,
  };
}

function kiteEquity(over: Partial<KiteInstrumentRef> = {}): KiteInstrumentRef {
  return {
    canonicalSymbol: "HDFCBANK",
    assetClass: "EQUITY",
    instrumentToken: 341249,
    tradingSymbol: "HDFCBANK",
    exchange: "NSE",
    lotSize: null,
    tickSize: 0.05,
    expiryDate: null,
    strike: null,
    optionType: null,
    ...over,
  };
}

function quote(over: Partial<QuoteCore> = {}): QuoteCore {
  return {
    symbol: "HDFCBANK",
    lastPrice: 1500,
    open: 1490,
    high: 1510,
    low: 1485,
    previousClose: 1495,
    volume: 1_000_000,
    ...over,
  };
}

describe("INDstocks instrument parsing", () => {
  const CSV = [
    "EXCH,SEGMENT,SECURITY_ID,INSTRUMENT_NAME,EXPIRY_CODE,TRADING_SYMBOL,LOT_UNITS,CUSTOM_SYMBOL,EXPIRY_DATE,STRIKE_PRICE,OPTION_TYPE,TICK_SIZE,EXPIRY_FLAG,SEM_EXCH_INSTRUMENT_TYPE,SERIES,SYMBOL_NAME",
    "NSE,E,1333,EQUITY,,HDFCBANK,,HDFCBANK,,,,0.05,,ES,EQ,HDFCBANK",
    "BSE,E,500180,EQUITY,,HDFCBANK,,HDFCBANK,,,,0.05,,ES,A,HDFCBANK",
    "NSE,FNO,43210,OPTIDX,,NIFTY25JAN24000CE,75,NIFTY,2025-01-30,24000,CE,0.05,,OD,,NIFTY",
  ].join("\n");

  it("derives a SEGMENT_TOKEN scrip-code from (EXCH, source) — never hardcoded", () => {
    expect(scripSegmentPrefix("NSE", "equity")).toBe("NSE");
    expect(scripSegmentPrefix("BSE", "equity")).toBe("BSE");
    expect(scripSegmentPrefix("NSE", "fno")).toBe("NFO");
    expect(scripSegmentPrefix("BSE", "fno")).toBe("BFO");
    expect(scripCodeFor("NSE", "1333", "equity")).toBe("NSE_1333");
  });

  it("parses an equity master CSV into typed rows", () => {
    const rows = parseInstrumentCsv(CSV, "equity");
    expect(rows.length).toBe(3);
    const nse = rows.find((r) => r.exch === "NSE" && r.symbolName === "HDFCBANK")!;
    expect(nse.scripCode).toBe("NSE_1333");
    expect(nse.assetClass).toBe("EQUITY");
  });

  it("prefers NSE EQ over BSE for the canonical equity index", () => {
    const rows = parseInstrumentCsv(CSV, "equity");
    const map = indexEquityBySymbol(rows);
    expect(map.get("HDFCBANK")!.exch).toBe("NSE");
    expect(map.get("HDFCBANK")!.scripCode).toBe("NSE_1333");
  });

  it("skips rows missing the essential identifiers rather than fabricating", () => {
    const broken = "EXCH,SECURITY_ID,SYMBOL_NAME\nNSE,,FOO\n,123,BAR";
    expect(parseInstrumentCsv(broken, "equity").length).toBe(0);
  });
});

describe("normaliseExpiry", () => {
  it("normalises ISO, epoch-ms and human dates to YYYY-MM-DD", () => {
    expect(normaliseExpiry("2025-01-30T00:00:00Z")).toBe("2025-01-30");
    expect(normaliseExpiry("30-Jan-2025")).toBe("2025-01-30");
    expect(normaliseExpiry(null)).toBeNull();
    expect(normaliseExpiry("not-a-date")).toBeNull();
  });
});

describe("matchInstrument", () => {
  it("VERIFIES when both providers describe the same equity", () => {
    const m = matchInstrument(kiteEquity(), indEquity());
    expect(m.status).toBe("VERIFIED");
    expect(m.warning).toBeNull();
    expect(m.row.indstocksScripCode).toBe("NSE_1333");
    expect(m.row.kiteInstrumentToken).toBe(341249);
  });

  it("flags CONFLICT on an exchange mismatch", () => {
    const m = matchInstrument(kiteEquity({ exchange: "NSE" }), indEquity({ exch: "BSE" }));
    expect(m.status).toBe("CONFLICT");
    expect(m.warning).toMatch(/exchange mismatch/);
  });

  it("flags CONFLICT on an option strike mismatch", () => {
    const kite = kiteEquity({
      canonicalSymbol: "NIFTY25JAN24000CE",
      assetClass: "OPT",
      exchange: "NFO",
      lotSize: 75,
      expiryDate: "2025-01-30",
      strike: 24000,
      optionType: "CE",
    });
    const ind = indEquity({
      exch: "NSE",
      segment: "FNO",
      instrumentName: "OPTIDX",
      tradingSymbol: "NIFTY25JAN24000CE",
      symbolName: "NIFTY",
      lotUnits: 75,
      expiryDate: "2025-01-30",
      strikePrice: 24500,
      optionType: "CE",
      assetClass: "OPT",
      scripCode: "NFO_43210",
      securityId: "43210",
    });
    const m = matchInstrument(kite, ind, { todayIso: "2025-01-01" });
    expect(m.status).toBe("CONFLICT");
    expect(m.warning).toMatch(/strike mismatch/);
  });

  it("rejects an EXPIRED derivative regardless of identity agreement", () => {
    const kite = kiteEquity({
      canonicalSymbol: "NIFTY25JAN24000CE",
      assetClass: "OPT",
      exchange: "NFO",
      lotSize: 75,
      expiryDate: "2025-01-30",
      strike: 24000,
      optionType: "CE",
    });
    const ind = indEquity({
      exch: "NSE",
      segment: "FNO",
      instrumentName: "OPTIDX",
      tradingSymbol: "NIFTY25JAN24000CE",
      symbolName: "NIFTY",
      lotUnits: 75,
      expiryDate: "2025-01-30",
      strikePrice: 24000,
      optionType: "CE",
      assetClass: "OPT",
      scripCode: "NFO_43210",
      securityId: "43210",
    });
    const m = matchInstrument(kite, ind, { todayIso: "2025-02-01" });
    expect(m.status).toBe("EXPIRED");
    expect(m.warning).toMatch(/expired/i);
  });
});

function verifiedRow(over: Partial<InstrumentMapRow> = {}): InstrumentMapRow {
  const now = new Date();
  return {
    id: "00000000-0000-0000-0000-000000000000",
    canonicalSymbol: "HDFCBANK",
    assetClass: "EQUITY",
    kiteInstrumentToken: 341249,
    kiteTradingSymbol: "HDFCBANK",
    kiteExchange: "NSE",
    indstocksSecurityId: "1333",
    indstocksScripCode: "NSE_1333",
    indstocksTradingSymbol: "HDFCBANK",
    indstocksExchange: "NSE",
    lotSize: null,
    tickSize: 0.05,
    expiryDate: null,
    strike: null,
    optionType: null,
    mappingStatus: "VERIFIED",
    lastVerifiedAt: now,
    mappingWarning: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

describe("evaluateRow mapping-freshness TTL", () => {
  const now = Date.UTC(2026, 5, 9, 6, 0, 0);

  it("accepts a recently-verified equity mapping", () => {
    const row = verifiedRow({ lastVerifiedAt: new Date(now - 60_000) });
    const r = evaluateRow(row, "2026-06-09", now);
    expect(r.ok).toBe(true);
    expect(r.scripCode).toBe("NSE_1333");
  });

  it("rejects a VERIFIED equity mapping whose verification is stale (> cash TTL)", () => {
    const row = verifiedRow({ lastVerifiedAt: new Date(now - MAPPING_MAX_AGE_MS.cash - 60_000) });
    const r = evaluateRow(row, "2026-06-09", now);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/stale/i);
  });

  it("rejects a VERIFIED mapping with no lastVerifiedAt (cannot prove freshness)", () => {
    const row = verifiedRow({ lastVerifiedAt: null });
    const r = evaluateRow(row, "2026-06-09", now);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no lastVerifiedAt|cannot prove/i);
  });

  it("applies the tighter derivative TTL to F&O mappings", () => {
    const base = {
      assetClass: "OPT" as const,
      expiryDate: "2026-06-26",
      optionType: "CE",
      strike: 24000,
      lotSize: 75,
    };
    const fresh = evaluateRow(
      verifiedRow({ ...base, lastVerifiedAt: new Date(now - 60_000) }),
      "2026-06-09",
      now,
    );
    expect(fresh.ok).toBe(true);
    // Older than the derivative TTL but well within the cash TTL ⇒ rejected for F&O.
    const stale = evaluateRow(
      verifiedRow({ ...base, lastVerifiedAt: new Date(now - MAPPING_MAX_AGE_MS.derivative - 60_000) }),
      "2026-06-09",
      now,
    );
    expect(stale.ok).toBe(false);
    expect(stale.reason).toMatch(/stale/i);
  });
});

describe("validateQuotePair", () => {
  it("MATCHED when both providers agree within tolerance", () => {
    const r = validateQuotePair(quote(), quote({ lastPrice: 1500.1 }));
    expect(r.verdict).toBe("MATCHED");
    expect(r.blockSignal).toBe(false);
  });

  it("WARNING on a small last-price drift above warn but below conflict", () => {
    const r = validateQuotePair(quote(), quote({ lastPrice: 1515 })); // +1.0%
    expect(r.verdict).toBe("WARNING");
    expect(r.blockSignal).toBe(false);
  });

  it("DATA_CONFLICT on a large last-price divergence (and blocks signal)", () => {
    const r = validateQuotePair(quote(), quote({ lastPrice: 1560 })); // +4.0%
    expect(r.verdict).toBe("DATA_CONFLICT");
    expect(r.blockSignal).toBe(true);
    expect(r.mismatchPct).not.toBeNull();
  });

  it("never escalates the verdict on volume divergence alone", () => {
    const r = validateQuotePair(quote(), quote({ volume: 100 }));
    expect(r.verdict).toBe("MATCHED");
    const vol = r.fields.find((f) => f.field === "volume");
    expect(vol?.informationalOnly).toBe(true);
  });
});

describe("validationStats (IST daily counters)", () => {
  beforeEach(() => __resetValidationStatsForTests());

  it("accumulates verdict + failover counters for the day", () => {
    recordValidation("MATCHED");
    recordValidation("WARNING");
    recordValidation("DATA_CONFLICT");
    recordFailover();
    const s = getValidationStats();
    expect(s.matched).toBe(1);
    expect(s.warning).toBe(1);
    expect(s.conflict).toBe(1);
    expect(s.validations).toBe(3);
    expect(s.failovers).toBe(1);
    expect(s.lastValidationAt).not.toBeNull();
    expect(s.lastFailoverAt).not.toBeNull();
  });
});
