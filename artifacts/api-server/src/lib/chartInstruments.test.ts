import { describe, it, expect } from "vitest";
import {
  searchInstruments,
  resolveInstrument,
  equityYahooTicker,
  equityInstruments,
  mergeMasterHits,
  CURATED_INDICES,
  CURATED_GLOBAL,
  type ChartInstrumentDto,
  type MasterHit,
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

describe("searchInstruments tags curated provenance", () => {
  it("every curated result carries source='curated'", () => {
    const r = searchInstruments("NIFTY");
    expect(r.length).toBeGreaterThan(0);
    expect(r.every(i => i.source === "curated")).toBe(true);
  });
});

describe("mergeMasterHits (autocomplete dedupe + provenance)", () => {
  const curated: ChartInstrumentDto[] = [
    { symbol: "RELIANCE", name: "Reliance", segment: "equity", exchange: "NSE", type: "Equity", source: "curated" },
  ];

  it("drops a master hit whose symbol already appears in curated", () => {
    const hits: MasterHit[] = [{ symbol: "RELIANCE", name: "Reliance Industries", exchange: "BSE", type: "Equity" }];
    const out = mergeMasterHits(curated, hits);
    expect(out.filter(i => i.symbol === "RELIANCE")).toHaveLength(1);
    expect(out[0]!.source).toBe("curated");
  });

  it("collapses the same symbol listed on NSE and BSE to a single (first/NSE) row", () => {
    // searchMaster ranks NSE first, so the NSE listing wins the dedupe.
    const hits: MasterHit[] = [
      { symbol: "TRIDENT", name: "Trident Ltd", exchange: "NSE", type: "Equity" },
      { symbol: "TRIDENT", name: "Trident Ltd", exchange: "BSE", type: "Equity" },
    ];
    const out = mergeMasterHits([], hits);
    expect(out).toHaveLength(1);
    expect(out[0]!.exchange).toBe("NSE");
    expect(out[0]!.source).toBe("kite_master");
  });

  it("keeps a BSE-only symbol that no curated/NSE row shadows", () => {
    const hits: MasterHit[] = [{ symbol: "NSDL", name: "NSDL", exchange: "BSE", type: "Equity" }];
    const out = mergeMasterHits(curated, hits);
    expect(out.some(i => i.symbol === "NSDL" && i.exchange === "BSE")).toBe(true);
  });

  it("tags master rows with source='kite_master' and curated stays first", () => {
    const hits: MasterHit[] = [{ symbol: "TMPV", name: "Tata Motors PV", exchange: "NSE", type: "Equity" }];
    const out = mergeMasterHits(curated, hits);
    expect(out[0]!.symbol).toBe("RELIANCE");
    const tmpv = out.find(i => i.symbol === "TMPV");
    expect(tmpv?.source).toBe("kite_master");
  });

  it("never emits duplicate symbols and respects the limit", () => {
    const hits: MasterHit[] = Array.from({ length: 50 }, (_, i) => ({
      symbol: `SYM${i % 10}`, // only 10 distinct symbols across 50 hits
      name: `Name ${i}`,
      exchange: i % 2 === 0 ? "NSE" : "BSE",
      type: "Equity",
    }));
    const out = mergeMasterHits([], hits, 5);
    const syms = out.map(i => i.symbol);
    expect(new Set(syms).size).toBe(syms.length); // no duplicates
    expect(out.length).toBeLessThanOrEqual(5); // limit honoured
  });
});
