import { describe, it, expect } from "vitest";
import {
  HOME_MARKET_PULSE_SECTIONS,
  getHomeSectionDescriptor,
  resolveHomeSectionSource,
  resolveHomeSectionSourceById,
  type HomeSectionDescriptor,
  type HomeSectionRuntime,
} from "./homeMarketPulseSourceMap";

/** The exact set of ids the Home page wires up. Kept in lockstep with the
 *  components so a rename on either side fails loudly here. */
const WIRED_IDS = [
  "global-cues",
  "sentiment-vix",
  "sentiment-fii-dii",
  "sentiment-expiry",
  "sectoral-heatmap",
  "market-breadth",
  "home-indices",
  "home-markets",
  "market-trend",
  "market-mood",
  "market-take",
  "fno-ban",
  "top-movers",
  "top-setups",
] as const;

const withData = (extra: Partial<HomeSectionRuntime> = {}): HomeSectionRuntime => ({
  hasData: true,
  ...extra,
});

describe("HOME_MARKET_PULSE_SECTIONS descriptor table", () => {
  it("covers every id the Home page wires up (and no strays)", () => {
    const ids = HOME_MARKET_PULSE_SECTIONS.map((s) => s.sectionId).sort();
    expect(ids).toEqual([...WIRED_IDS].sort());
  });

  it("has unique section ids", () => {
    const ids = HOME_MARKET_PULSE_SECTIONS.map((s) => s.sectionId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only lets kite-backed sections ever be signal-eligible", () => {
    for (const s of HOME_MARKET_PULSE_SECTIONS) {
      if (s.canDriveSignals) {
        expect(s.source).toBe("kite");
        expect(s.baselineStatus).toBe("TRADE_GRADE");
      }
    }
  });

  it("gives every section a non-empty honest note", () => {
    for (const s of HOME_MARKET_PULSE_SECTIONS) {
      expect(s.note.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("resolveHomeSectionSource — missing data", () => {
  it("returns UNAVAILABLE and never drives signals when hasData is false", () => {
    for (const descriptor of HOME_MARKET_PULSE_SECTIONS) {
      const r = resolveHomeSectionSource(descriptor, { hasData: false });
      expect(r.sourceStatus).toBe("UNAVAILABLE");
      expect(r.canDriveSignals).toBe(false);
      expect(r.asOf).toBeNull();
      expect(r.warning).toMatch(/No data received/i);
    }
  });

  it("returns SOURCE_NOT_INTEGRATED when the descriptor baseline says so", () => {
    const notIntegrated: HomeSectionDescriptor = {
      sectionId: "x-not-integrated",
      label: "X",
      source: "missing",
      baselineStatus: "SOURCE_NOT_INTEGRATED",
      canDriveSignals: false,
      note: "not wired up",
    };
    const r = resolveHomeSectionSource(notIntegrated, { hasData: false });
    expect(r.sourceStatus).toBe("SOURCE_NOT_INTEGRATED");
    expect(r.canDriveSignals).toBe(false);
  });
});

describe("resolveHomeSectionSource — kite trust ladder", () => {
  const kite = getHomeSectionDescriptor("home-indices")!;

  it("is TRADE_GRADE + signal-eligible when live and fresh", () => {
    const r = resolveHomeSectionSource(kite, withData({ asOf: 1_700_000_000 }));
    expect(r.sourceStatus).toBe("TRADE_GRADE");
    expect(r.canDriveSignals).toBe(true);
    expect(r.asOf).toBe(1_700_000_000);
  });

  it("downgrades to DELAYED and blocks signals on fallback", () => {
    const r = resolveHomeSectionSource(kite, withData({ fallbackUsed: true }));
    expect(r.sourceStatus).toBe("DELAYED");
    expect(r.canDriveSignals).toBe(false);
    expect(r.warning).toMatch(/delayed|fallback/i);
  });

  it("downgrades to STALE and blocks signals when past freshness", () => {
    const r = resolveHomeSectionSource(kite, withData({ isStale: true }));
    expect(r.sourceStatus).toBe("STALE");
    expect(r.canDriveSignals).toBe(false);
  });

  it("treats fallback as higher priority than stale", () => {
    const r = resolveHomeSectionSource(kite, withData({ fallbackUsed: true, isStale: true }));
    expect(r.sourceStatus).toBe("DELAYED");
    expect(r.canDriveSignals).toBe(false);
  });
});

describe("resolveHomeSectionSource — non-kite categories never drive signals", () => {
  it("yahoo is always DELAYED", () => {
    const r = resolveHomeSectionSource(getHomeSectionDescriptor("global-cues")!, withData());
    expect(r.sourceStatus).toBe("DELAYED");
    expect(r.canDriveSignals).toBe(false);
  });

  it("db (FII/DII) is INFO_ONLY", () => {
    const r = resolveHomeSectionSource(getHomeSectionDescriptor("sentiment-fii-dii")!, withData({ asOf: "2026-06-30" }));
    expect(r.sourceStatus).toBe("INFO_ONLY");
    expect(r.canDriveSignals).toBe(false);
    expect(r.asOf).toBe("2026-06-30");
  });

  it("nse_archive (F&O ban) is INFO_ONLY", () => {
    const r = resolveHomeSectionSource(getHomeSectionDescriptor("fno-ban")!, withData());
    expect(r.sourceStatus).toBe("INFO_ONLY");
    expect(r.canDriveSignals).toBe(false);
  });

  it("computed sections are COMPUTED", () => {
    for (const id of ["sentiment-expiry", "market-breadth", "market-trend", "market-mood", "market-take"]) {
      const r = resolveHomeSectionSource(getHomeSectionDescriptor(id)!, withData());
      expect(r.sourceStatus, id).toBe("COMPUTED");
      expect(r.canDriveSignals, id).toBe(false);
    }
  });

  it("scanner_cache warns when any row fell back to Yahoo", () => {
    const clean = resolveHomeSectionSource(getHomeSectionDescriptor("top-setups")!, withData());
    expect(clean.sourceStatus).toBe("INFO_ONLY");
    expect(clean.warning).toBeNull();

    const degraded = resolveHomeSectionSource(getHomeSectionDescriptor("top-setups")!, withData({ fallbackUsed: true }));
    expect(degraded.sourceStatus).toBe("INFO_ONLY");
    expect(degraded.warning).toMatch(/Yahoo|delayed/i);
    expect(degraded.canDriveSignals).toBe(false);
  });
});

describe("resolveHomeSectionSourceById", () => {
  it("resolves every wired id", () => {
    for (const id of WIRED_IDS) {
      expect(resolveHomeSectionSourceById(id, withData())).not.toBeNull();
    }
  });

  it("returns null for an unknown id", () => {
    expect(resolveHomeSectionSourceById("does-not-exist", withData())).toBeNull();
  });
});
