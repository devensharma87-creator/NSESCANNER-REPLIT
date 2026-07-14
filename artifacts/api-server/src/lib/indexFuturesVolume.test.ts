import { describe, it, expect } from "vitest";
import { indexFutName } from "./indexFuturesVolume.js";

describe("indexFutName", () => {
  it("maps supported index charting symbols to their Kite F&O name", () => {
    expect(indexFutName("NIFTY")).toBe("NIFTY");
    expect(indexFutName("BANKNIFTY")).toBe("BANKNIFTY");
    expect(indexFutName("FINNIFTY")).toBe("FINNIFTY");
    expect(indexFutName("MIDCPNIFTY")).toBe("MIDCPNIFTY");
    expect(indexFutName("NIFTYNXT50")).toBe("NIFTYNXT50");
    expect(indexFutName("SENSEX")).toBe("SENSEX");
    expect(indexFutName("BANKEX")).toBe("BANKEX");
  });

  it("is case-insensitive on the input symbol", () => {
    expect(indexFutName("nifty")).toBe("NIFTY");
    expect(indexFutName("BankNifty")).toBe("BANKNIFTY");
  });

  it("returns null for indices with no listed futures", () => {
    expect(indexFutName("NIFTYIT")).toBeNull();
    expect(indexFutName("INDIAVIX")).toBeNull();
    expect(indexFutName("UNKNOWN")).toBeNull();
    expect(indexFutName("")).toBeNull();
  });
});
