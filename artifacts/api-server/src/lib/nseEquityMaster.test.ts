import { describe, it, expect } from "vitest";
import { loadNseEquityMaster } from "./nseEquityMaster";

describe("loadNseEquityMaster", () => {
  it("returns an array; entries are well-formed NSE equities when the cache is present", () => {
    const list = loadNseEquityMaster();
    expect(Array.isArray(list)).toBe(true);
    // When the disk cache exists (dev / warmed prod) we expect real symbols;
    // when it is absent the list is honestly empty (callers fall back to curated).
    for (const m of list.slice(0, 50)) {
      expect(m.symbol).toBeTruthy();
      expect(m.segment).toBe("equity");
      expect(m.exchange).toBe("NSE");
      expect(m.type).toBe("Equity");
      expect(m.yahoo.endsWith(".NS")).toBe(true);
    }
  });

  it("memoises within TTL (returns the same reference)", () => {
    expect(loadNseEquityMaster()).toBe(loadNseEquityMaster());
  });
});
