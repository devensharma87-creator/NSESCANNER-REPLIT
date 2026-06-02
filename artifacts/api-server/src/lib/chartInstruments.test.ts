import { describe, it, expect } from "vitest";
import {
  searchInstruments,
  resolveInstrument,
  equityYahooTicker,
  equityInstruments,
  CURATED_INDICES,
  CURATED_GLOBAL,
} from "./chartInstruments";

describe("equityYahooTicker", () => {
  it("appends .NS and uppercases", () => {
    expect(equityYahooTicker("tcs")).toBe("TCS.NS");
  });
  it("applies rename overrides (e.g. ZOMATO → ETERNAL)", () => {
    // override map is uppercased; ZOMATO renamed to ETERNAL upstream.
    const t = equityYahooTicker("ZOMATO");
    expect(t.endsWith(".NS")).toBe(true);
    expect(t).not.toBe("ZOMATO.NS");
  });
});

describe("searchInstruments", () => {
  it("returns default indices+globals (no equities) for empty query", () => {
    const r = searchInstruments("");
    expect(r.length).toBeGreaterThan(0);
    expect(r.every(i => i.segment === "index" || i.segment === "global")).toBe(true);
  });

  it("matches an index by symbol prefix", () => {
    const r = searchInstruments("NIFT");
    expect(r.some(i => i.symbol === "NIFTY")).toBe(true);
  });

  it("ranks exact symbol match first", () => {
    const r = searchInstruments("NIFTY");
    expect(r[0]!.symbol).toBe("NIFTY");
  });

  it("honours segment filter", () => {
    const r = searchInstruments("S", "global");
    expect(r.length).toBeGreaterThan(0);
    expect(r.every(i => i.segment === "global")).toBe(true);
  });

  it("finds equities only when a query is present", () => {
    const empty = searchInstruments("");
    expect(empty.some(i => i.segment === "equity")).toBe(false);
    const eq = searchInstruments("REL", "equity");
    expect(eq.every(i => i.segment === "equity")).toBe(true);
  });

  it("never leaks the internal yahoo ticker", () => {
    const r = searchInstruments("NIFTY");
    expect(r[0]).not.toHaveProperty("yahoo");
  });
});

describe("resolveInstrument", () => {
  it("resolves a curated index", () => {
    const m = resolveInstrument("NIFTY", "index");
    expect(m?.yahoo).toBe("^NSEI");
  });
  it("resolves a curated global", () => {
    const m = resolveInstrument("^GSPC", "global");
    expect(m?.segment).toBe("global");
  });
  it("returns null when the symbol does not exist", () => {
    expect(resolveInstrument("NOTAREALSYM", "equity")).toBeNull();
  });
  it("does not cross segments (index symbol with equity hint)", () => {
    expect(resolveInstrument("NIFTY", "equity")).toBeNull();
  });
});

describe("registries", () => {
  it("curated indices and globals are non-empty and well-formed", () => {
    expect(CURATED_INDICES.length).toBeGreaterThan(0);
    expect(CURATED_GLOBAL.length).toBeGreaterThan(0);
    for (const i of [...CURATED_INDICES, ...CURATED_GLOBAL]) {
      expect(i.symbol).toBeTruthy();
      expect(i.name).toBeTruthy();
      expect(i.yahoo).toBeTruthy();
    }
  });
  it("equity instruments exclude inactive symbols", () => {
    const eq = equityInstruments();
    expect(eq.length).toBeGreaterThan(0);
    expect(eq.every(i => i.segment === "equity" && i.exchange === "NSE")).toBe(true);
  });
});
