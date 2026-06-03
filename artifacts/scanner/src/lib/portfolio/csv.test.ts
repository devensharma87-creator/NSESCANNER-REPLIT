import { describe, it, expect } from "vitest";
import {
  parseCsvRows,
  parseNumber,
  parseDate,
  parsePortfolioCsv,
  buildCsvTemplate,
  buildPortfolioCsv,
  CSV_TEMPLATE_COLUMNS,
} from "./csv";
import type { RawHolding } from "./types";

describe("parseCsvRows", () => {
  it("handles quoted fields with embedded commas and escaped quotes", () => {
    const rows = parseCsvRows('a,"b,c","he said ""hi"""\n1,2,3');
    expect(rows[0]).toEqual(["a", "b,c", 'he said "hi"']);
    expect(rows[1]).toEqual(["1", "2", "3"]);
  });
  it("handles CRLF and trailing newline", () => {
    const rows = parseCsvRows("a,b\r\n1,2\r\n");
    expect(rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseNumber", () => {
  it("strips rupee symbol, commas, spaces", () => {
    expect(parseNumber("₹1,23,456.50")).toBeCloseTo(123456.5);
    expect(parseNumber(" 100 ")).toBe(100);
  });
  it("returns null for blanks and garbage", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber(undefined)).toBeNull();
  });
});

describe("parseDate", () => {
  it("accepts yyyy-mm-dd, dd-mm-yyyy, dd/mm/yyyy", () => {
    expect(parseDate("2024-01-15")).toBe("2024-01-15");
    expect(parseDate("15-01-2024")).toBe("2024-01-15");
    expect(parseDate("15/01/2024")).toBe("2024-01-15");
  });
  it("rejects impossible and unparseable dates", () => {
    expect(parseDate("2024-13-01")).toBeUndefined();
    expect(parseDate("2024-02-30")).toBeUndefined();
    expect(parseDate("not a date")).toBeUndefined();
    expect(parseDate("")).toBeUndefined();
  });
});

describe("buildCsvTemplate", () => {
  it("emits the full column header", () => {
    const t = buildCsvTemplate();
    expect(t.split("\n")[0]).toBe(CSV_TEMPLATE_COLUMNS.join(","));
  });
});

describe("parsePortfolioCsv", () => {
  const header = "Symbol,Stock Name,Exchange,Sector,Date of Purchase,Qty,Rate";

  it("parses a clean file", () => {
    const r = parsePortfolioCsv(`${header}\nRELIANCE,Reliance,NSE,Energy,2024-01-15,50,2450.50`);
    expect(r.errors).toHaveLength(0);
    expect(r.holdings).toHaveLength(1);
    expect(r.holdings[0]).toMatchObject({
      symbol: "RELIANCE",
      qty: 50,
      rate: 2450.5,
      purchaseDate: "2024-01-15",
      sector: "Energy",
    });
  });

  it("uppercases symbols and defaults name to symbol", () => {
    const r = parsePortfolioCsv(`${header}\ntcs,,NSE,IT,2024-01-15,10,3000`);
    expect(r.holdings[0].symbol).toBe("TCS");
    expect(r.holdings[0].name).toBe("TCS");
  });

  it("flags invalid qty/rate as hard row errors and skips the row", () => {
    const r = parsePortfolioCsv(`${header}\nA,A,NSE,IT,2024-01-15,abc,100\nB,B,NSE,IT,2024-01-15,10,xyz`);
    expect(r.holdings).toHaveLength(0);
    expect(r.errors.some(e => e.field === "Qty")).toBe(true);
    expect(r.errors.some(e => e.field === "Rate")).toBe(true);
  });

  it("keeps rows with missing/invalid date but flags them", () => {
    const r = parsePortfolioCsv(`${header}\nA,A,NSE,IT,,10,100\nB,B,NSE,IT,garbage,10,100`);
    expect(r.holdings).toHaveLength(2);
    expect(r.holdings[0].purchaseDate).toBeUndefined();
    expect(r.errors.filter(e => e.field === "Date of Purchase")).toHaveLength(2);
  });

  it("detects duplicate symbols", () => {
    const r = parsePortfolioCsv(`${header}\nA,A,NSE,IT,2024-01-15,10,100\nA,A,NSE,IT,2024-02-15,5,110`);
    expect(r.duplicateSymbols).toEqual(["A"]);
    expect(r.holdings).toHaveLength(2);
  });

  it("errors on missing required columns", () => {
    const r = parsePortfolioCsv("Symbol,Qty\nA,10");
    expect(r.holdings).toHaveLength(0);
    expect(r.errors[0].message).toMatch(/Missing required column/);
  });

  it("errors on an empty file", () => {
    const r = parsePortfolioCsv("");
    expect(r.errors[0].message).toMatch(/empty/i);
  });
});

describe("buildPortfolioCsv", () => {
  it("writes the template header and only user-entered fields", () => {
    const holdings: RawHolding[] = [
      {
        symbol: "TCS",
        name: "Tata Consultancy",
        exchange: "NSE",
        sector: "IT",
        purchaseDate: "2024-01-15",
        qty: 10,
        rate: 3000,
        isin: "INE467B01029",
        broker: "Zerodha",
        tag: "core",
        notes: "long term",
        // Derived/advisory fields must NOT appear in the export.
        targetPrice: 4000,
        stopLoss: 2500,
        dividendReceived: 500,
        realisedPnl: 1200,
      },
    ];
    const csv = buildPortfolioCsv(holdings);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe(CSV_TEMPLATE_COLUMNS.join(","));
    expect(csv).toContain("TCS");
    expect(csv).toContain("INE467B01029");
    // Advisory / derived fields must NOT be exported.
    expect(csv).not.toContain("4000"); // targetPrice
    expect(csv).not.toContain("2500"); // stopLoss
    expect(csv).not.toContain("1200"); // realisedPnl
  });

  it("round-trips cleanly through parsePortfolioCsv", () => {
    const holdings: RawHolding[] = [
      { symbol: "INFY", name: "Infosys", exchange: "NSE", sector: "IT", purchaseDate: "2023-06-01", qty: 5, rate: 1400 },
      { symbol: "HDFCBANK", name: "HDFC Bank", exchange: "NSE", sector: "Banking", purchaseDate: "2022-11-20", qty: 8, rate: 1500 },
    ];
    const parsed = parsePortfolioCsv(buildPortfolioCsv(holdings));
    expect(parsed.errors.filter(e => e.field === "Qty" || e.field === "Rate")).toHaveLength(0);
    expect(parsed.holdings).toHaveLength(2);
    expect(parsed.holdings[0]).toMatchObject({ symbol: "INFY", qty: 5, rate: 1400, sector: "IT" });
    expect(parsed.holdings[1]).toMatchObject({ symbol: "HDFCBANK", qty: 8, rate: 1500 });
  });

  it("quotes fields containing commas so notes survive the round-trip", () => {
    const holdings: RawHolding[] = [
      { symbol: "RELI", name: "Reliance", qty: 1, rate: 2500, notes: "buy more, on dips" },
    ];
    const parsed = parsePortfolioCsv(buildPortfolioCsv(holdings));
    expect(parsed.holdings[0].notes).toBe("buy more, on dips");
  });

  it("produces a header-only file for an empty portfolio", () => {
    const csv = buildPortfolioCsv([]);
    expect(csv.trim()).toBe(CSV_TEMPLATE_COLUMNS.join(","));
  });
});
