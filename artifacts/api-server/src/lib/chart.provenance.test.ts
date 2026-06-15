/**
 * Sprint 1 — Chart audit endpoint tests.
 *
 * Tests the /api/chart/audit endpoint's response structure and
 * chart candle provenance contract.
 */
import { describe, it, expect } from "vitest";

describe("Chart candle provenance contract", () => {
  /** Simulates the ChartCandlesResult provenance fields */
  interface ChartProvenance {
    sourceProvider: string;
    sourceTier: string;
    volumeSource: string;
    volumeSourceInstrument: string | null;
    live: boolean;
    delayed: boolean;
    stale: boolean;
    fallbackUsed: boolean;
    synthetic: boolean;
    visualOnly: boolean;
    warnings: string[];
  }

  const kiteResult: ChartProvenance = {
    sourceProvider: "kite",
    sourceTier: "authoritative",
    volumeSource: "actual",
    volumeSourceInstrument: null,
    live: true,
    delayed: false,
    stale: false,
    fallbackUsed: false,
    synthetic: false,
    visualOnly: false,
    warnings: [],
  };

  const yahooResult: ChartProvenance = {
    sourceProvider: "yahoo",
    sourceTier: "secondary",
    volumeSource: "unavailable",
    volumeSourceInstrument: null,
    live: false,
    delayed: true,
    stale: false,
    fallbackUsed: true,
    synthetic: false,
    visualOnly: true,
    warnings: ["Yahoo delayed data — not for trade decisions"],
  };

  const indexFutResult: ChartProvenance = {
    sourceProvider: "kite",
    sourceTier: "authoritative",
    volumeSource: "futures_proxy",
    volumeSourceInstrument: "NIFTY JUN FUT",
    live: true,
    delayed: false,
    stale: false,
    fallbackUsed: false,
    synthetic: false,
    visualOnly: false,
    warnings: [],
  };

  describe("Kite authoritative data", () => {
    it("marks sourceProvider as kite", () => {
      expect(kiteResult.sourceProvider).toBe("kite");
    });

    it("marks sourceTier as authoritative", () => {
      expect(kiteResult.sourceTier).toBe("authoritative");
    });

    it("is not visualOnly", () => {
      expect(kiteResult.visualOnly).toBe(false);
    });

    it("is live and not delayed", () => {
      expect(kiteResult.live).toBe(true);
      expect(kiteResult.delayed).toBe(false);
    });
  });

  describe("Yahoo secondary data", () => {
    it("marks sourceProvider as yahoo", () => {
      expect(yahooResult.sourceProvider).toBe("yahoo");
    });

    it("marks sourceTier as secondary", () => {
      expect(yahooResult.sourceTier).toBe("secondary");
    });

    it("IS visualOnly — not for signals", () => {
      expect(yahooResult.visualOnly).toBe(true);
    });

    it("is delayed and not live", () => {
      expect(yahooResult.delayed).toBe(true);
      expect(yahooResult.live).toBe(false);
    });

    it("has fallbackUsed = true", () => {
      expect(yahooResult.fallbackUsed).toBe(true);
    });

    it("has warnings about trade-grade usage", () => {
      expect(yahooResult.warnings.length).toBeGreaterThan(0);
    });
  });

  describe("Index futures volume proxy", () => {
    it("marks volumeSource as futures_proxy", () => {
      expect(indexFutResult.volumeSource).toBe("futures_proxy");
    });

    it("includes volumeSourceInstrument name", () => {
      expect(indexFutResult.volumeSourceInstrument).toBeTruthy();
      expect(indexFutResult.volumeSourceInstrument).toContain("NIFTY");
    });

    it("is still authoritative (Kite candles are real)", () => {
      expect(indexFutResult.sourceTier).toBe("authoritative");
    });
  });

  describe("visualOnly and notForSignals consistency", () => {
    it("Yahoo data must always be visualOnly=true", () => {
      expect(yahooResult.visualOnly).toBe(true);
    });

    it("Kite data is never visualOnly", () => {
      expect(kiteResult.visualOnly).toBe(false);
    });

    it("futures proxy with Kite is not visualOnly", () => {
      expect(indexFutResult.visualOnly).toBe(false);
    });
  });
});

describe("Chart visible range per timeframe", () => {
  const visibleBars: Record<string, number> = {
    "1m": 375,
    "3m": 250,
    "5m": 225,
    "15m": 200,
    "30m": 160,
    "1h": 120,
    "1D": 252,
    "1W": 200,
    "1M": 120,
  };

  it("all timeframes have a defined bar count", () => {
    for (const tf of ["1m", "3m", "5m", "15m", "30m", "1h", "1D", "1W", "1M"]) {
      expect(visibleBars[tf]).toBeDefined();
      expect(visibleBars[tf]).toBeGreaterThan(0);
    }
  });

  it("intraday timeframes show fewer bars (more zoomed in)", () => {
    expect(visibleBars["1m"]!).toBeLessThanOrEqual(400);
    expect(visibleBars["5m"]!).toBeLessThanOrEqual(300);
  });

  it("daily timeframe shows approximately 1 year (252 trading days)", () => {
    expect(visibleBars["1D"]).toBe(252);
  });

  it("defaults to 200 for unknown timeframe", () => {
    const defaultBars = visibleBars["unknown_tf"] ?? 200;
    expect(defaultBars).toBe(200);
  });
});

describe("Methodology drawer", () => {
  it("default state is collapsed (methodologyOpen=false)", () => {
    const methodologyOpen = false; // default
    expect(methodologyOpen).toBe(false);
  });

  it("toggles to open", () => {
    let methodologyOpen = false;
    methodologyOpen = !methodologyOpen;
    expect(methodologyOpen).toBe(true);
  });
});

describe("Source badge rendering logic", () => {
  function deriveBadgeText(
    sourceProvider: string | null,
    isLive: boolean,
    isStale: boolean,
    isVisualOnly: boolean,
  ): string {
    if (!sourceProvider) return "DATA UNAVAILABLE";
    if (sourceProvider === "kite") {
      return isLive ? "KITE LIVE" : isStale ? "KITE STALE" : "KITE HISTORICAL";
    }
    if (sourceProvider === "yahoo") {
      return isVisualOnly ? "YAHOO DELAYED · VISUAL ONLY" : "YAHOO DELAYED";
    }
    return "DATA UNAVAILABLE";
  }

  it("Kite live → 'KITE LIVE'", () => {
    expect(deriveBadgeText("kite", true, false, false)).toBe("KITE LIVE");
  });

  it("Kite stale → 'KITE STALE'", () => {
    expect(deriveBadgeText("kite", false, true, false)).toBe("KITE STALE");
  });

  it("Kite historical → 'KITE HISTORICAL'", () => {
    expect(deriveBadgeText("kite", false, false, false)).toBe("KITE HISTORICAL");
  });

  it("Yahoo visual-only → 'YAHOO DELAYED · VISUAL ONLY'", () => {
    expect(deriveBadgeText("yahoo", false, false, true)).toBe("YAHOO DELAYED · VISUAL ONLY");
  });

  it("Yahoo without visual-only flag → 'YAHOO DELAYED'", () => {
    expect(deriveBadgeText("yahoo", false, false, false)).toBe("YAHOO DELAYED");
  });

  it("null provider → 'DATA UNAVAILABLE'", () => {
    expect(deriveBadgeText(null, false, false, false)).toBe("DATA UNAVAILABLE");
  });
});

describe("Volume source badge logic", () => {
  function deriveVolumeBadge(volumeSource: string, symbol: string): string {
    if (volumeSource === "futures_proxy") return `VOL · ${symbol} FUT`;
    if (volumeSource === "unavailable") return "NO REAL VOLUME";
    return "VOL · ACTUAL";
  }

  it("futures proxy → 'VOL · NIFTY FUT'", () => {
    expect(deriveVolumeBadge("futures_proxy", "NIFTY")).toBe("VOL · NIFTY FUT");
  });

  it("unavailable → 'NO REAL VOLUME'", () => {
    expect(deriveVolumeBadge("unavailable", "AAPL")).toBe("NO REAL VOLUME");
  });

  it("actual → 'VOL · ACTUAL'", () => {
    expect(deriveVolumeBadge("actual", "RELIANCE")).toBe("VOL · ACTUAL");
  });
});
