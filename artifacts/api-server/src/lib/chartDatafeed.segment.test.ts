/**
 * Sprint 2 — Chart Datafeed Indian segment Yahoo gate tests.
 *
 * Verifies that:
 *   1. Indian equity/index charts NEVER return sourceProvider="yahoo"
 *   2. Global charts MAY return Yahoo (correct usage)
 *   3. Unavailable Indian charts return source="none" with correct message
 *   4. No fake candle values (candles=[] when unavailable)
 *   5. Scanner provenance labels Yahoo-derived signals correctly
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Chart datafeed Indian segment Yahoo gate", () => {
  const chartSrc = fs.readFileSync(
    path.resolve(__dirname, "chartDatafeed.ts"),
    "utf-8",
  );

  it("Indian equity/index segment does NOT fall through to Yahoo", () => {
    // The Yahoo try/catch block should be inside a segment === "global" guard
    expect(chartSrc).toContain('if (segment === "global")');
    expect(chartSrc).toContain("tryYahoo(meta, cfg)");

    // The tryYahoo call must be inside the global branch, not unconditional.
    // Verify by checking the else branch explicitly logs the Indian miss.
    expect(chartSrc).toContain(
      "Kite candles unavailable for Indian instrument",
    );
  });

  it("global segment allows Yahoo fallback", () => {
    // The global path should call tryYahoo and finalize with "yahoo"
    expect(chartSrc).toContain('if (segment === "global")');
    expect(chartSrc).toContain("tryYahoo(meta, cfg)");
  });

  it("Indian unavailable chart returns correct message", () => {
    expect(chartSrc).toContain(
      "Trusted candles (Kite) unavailable",
    );
    expect(chartSrc).toContain(
      "connect a live Kite session for Indian instrument data",
    );
  });

  it("unavailable chart returns source=none with empty candles", () => {
    // The finalize call for unavailable charts passes [] for candles
    expect(chartSrc).toContain(
      'meta.symbol, segment, tf, "none", []',
    );
  });

  it("Indian unavailable chart carries Kite-required warning", () => {
    expect(chartSrc).toContain(
      "No trusted candle source available. Kite session required for Indian instruments.",
    );
  });

  it("none-path provenance fields are complete (Sprint 1 fix)", () => {
    // The none early-return path must include all provenance fields
    expect(chartSrc).toContain('sourceProvider: "none"');
    expect(chartSrc).toContain('sourceTier: "unavailable"');
    expect(chartSrc).toContain("live: false");
    expect(chartSrc).toContain("delayed: false");
    expect(chartSrc).toContain("visualOnly: false");
  });
});

describe("Scanner provenance honesty", () => {
  it("scanner.ts buildRow sets provider to yahoo", () => {
    const scannerSrc = fs.readFileSync(
      path.resolve(__dirname, "scanner.ts"),
      "utf-8",
    );

    // buildRow must call buildSourceProvenance with provider: "yahoo"
    expect(scannerSrc).toContain('provider: "yahoo"');
    // Must have warnings about Yahoo-derived indicators
    expect(scannerSrc).toContain("Yahoo daily candles");
  });

  it("scannerProvenance shouldDemoteSignal demotes Yahoo", () => {
    const provenanceSrc = fs.readFileSync(
      path.resolve(__dirname, "scannerProvenance.ts"),
      "utf-8",
    );

    // shouldDemoteSignal must check notForSignals and trustTier
    expect(provenanceSrc).toContain("notForSignals");
    expect(provenanceSrc).toContain('trustTier !== "authoritative"');
  });

  it("swingSignals carries levelsSource field", () => {
    const swingSrc = fs.readFileSync(
      path.resolve(__dirname, "swingSignals.ts"),
      "utf-8",
    );

    expect(swingSrc).toContain("levelsSource:");
    expect(swingSrc).toContain('levelsSource: "yahoo"');
    expect(swingSrc).toContain("levelsWarnings:");
    expect(swingSrc).toContain("delayed Yahoo daily candles");
  });
});

describe("Provider guard structural checks", () => {
  it("optionChain.ts does not import from ./yahoo", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "optionChain.ts"),
      "utf-8",
    );
    expect(src).not.toMatch(/import\s+.*\s+from\s+["']\.\/yahoo["']/);
  });

  it("F&O trade paths do not import Yahoo runtime", () => {
    const files = [
      "optionSignalVetoes.ts",
      "optionSignalGates.ts",
      "paperTradingFO.ts",
    ];
    for (const f of files) {
      const filePath = path.resolve(__dirname, f);
      if (!fs.existsSync(filePath)) continue; // skip if not present
      const src = fs.readFileSync(filePath, "utf-8");
      // Runtime Yahoo imports (not type-only)
      const imports = (src.match(/^import\s+\{[^}]+\}\s+from\s+["'].*yahoo.*["']/gm) ?? [] as string[])
        .filter(line => !line.startsWith("import type"));
      expect(imports).toHaveLength(0);
    }
  });

  it("chart Indian official mode blocks Yahoo", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "chartDatafeed.ts"),
      "utf-8",
    );
    // Yahoo path must be inside segment === "global" guard
    const yahooBlock = src.indexOf("tryYahoo(meta, cfg)");
    const globalGuard = src.lastIndexOf('if (segment === "global")', yahooBlock);
    expect(globalGuard).toBeGreaterThan(-1);
    expect(globalGuard).toBeLessThan(yahooBlock);
  });

  it("missing data never becomes fake 0", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "chartDatafeed.ts"),
      "utf-8",
    );
    // The none-path must return candles: [] not candles with fake data
    expect(src).toContain("candles: []");
    // And warnings about unavailability
    expect(src).toContain("No data source available for this instrument");
  });
});
