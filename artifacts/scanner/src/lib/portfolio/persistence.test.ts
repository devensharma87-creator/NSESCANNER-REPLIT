import { describe, it, expect } from "vitest";
import { rawToInput, holdingToRaw } from "./persistence";
import type { RawHolding } from "./types";
import type { PortfolioHolding } from "@workspace/api-client-react";

describe("rawToInput", () => {
  it("uppercases the symbol and preserves user book-keeping fields", () => {
    const raw: RawHolding = {
      symbol: "reliance",
      name: "Reliance",
      qty: 10,
      rate: 2450,
      purchaseDate: "2024-01-01",
      broker: "Zerodha",
      tag: "core",
      notes: "long term",
      isin: "INE002A01018",
      dividendReceived: 120,
      realisedPnl: 50,
    };
    const input = rawToInput(raw);
    expect(input.symbol).toBe("RELIANCE");
    expect(input.qty).toBe(10);
    expect(input.rate).toBe(2450);
    expect(input.broker).toBe("Zerodha");
    expect(input.dividendReceived).toBe(120);
    expect(input.realisedPnl).toBe(50);
  });

  it("normalises blank optional fields to null", () => {
    const input = rawToInput({ symbol: "TCS", name: "", qty: 1, rate: 1 });
    expect(input.name).toBeNull();
    expect(input.broker).toBeNull();
    expect(input.purchaseDate).toBeNull();
  });

  it("does not persist advisory fields (target/stop)", () => {
    const input = rawToInput({ symbol: "X", name: "X", qty: 1, rate: 1, targetPrice: 100, stopLoss: 50 });
    expect("targetPrice" in input).toBe(false);
    expect("stopLoss" in input).toBe(false);
  });
});

describe("holdingToRaw", () => {
  it("round-trips a holding back into the working model", () => {
    const h: PortfolioHolding = {
      id: "abc",
      symbol: "INFY",
      name: "Infosys",
      exchange: "NSE",
      sector: "IT",
      purchaseDate: "2024-02-02",
      qty: 5,
      rate: 1480,
      isin: null,
      broker: "Groww",
      tag: null,
      notes: null,
      dividendReceived: 30,
      realisedPnl: null,
      sortIndex: 0,
    };
    const raw = holdingToRaw(h);
    expect(raw.symbol).toBe("INFY");
    expect(raw.name).toBe("Infosys");
    expect(raw.broker).toBe("Groww");
    expect(raw.dividendReceived).toBe(30);
    expect(raw.tag).toBeUndefined();
    expect(raw.realisedPnl).toBeUndefined();
  });

  it("falls back to symbol when name is blank", () => {
    const h: PortfolioHolding = {
      id: "x",
      symbol: "ITC",
      name: "",
      qty: 1,
      rate: 1,
      sortIndex: 0,
    };
    expect(holdingToRaw(h).name).toBe("ITC");
  });
});
