import { describe, it, expect } from "vitest";
import {
  parseCsvRows,
  parseNumber,
  parseDate,
  parsePortfolioCsv,
  buildCsvTemplate,
  CSV_TEMPLATE_COLUMNS,
} from "./csv";

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
