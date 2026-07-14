/**
 * Gate B/C/D structural migration tests.
 *
 * Verifies that consumer files have been migrated to import through the
 * central marketData backbone rather than importing raw providers directly.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const libDir = path.resolve(here, "..");

function readSrc(relPath: string): string {
  return readFileSync(path.join(libDir, relPath), "utf8");
}

// ─── Gate B: F&O signal engine migrated ────────────────────────────────

describe("Gate B — F&O signal engine uses central backbone", () => {
  it("optionSignals.ts imports from marketData/compat, not kiteIntraday", () => {
    const src = readSrc("optionSignals.ts");
    expect(src).toContain("centralIndexCandles");
    expect(src).toContain("centralHasIndexCoverage");
    expect(src).toContain("centralIndexQuotes");
    expect(src).not.toMatch(/import.*from.*["']\.\/kiteIntraday["']/);
    expect(src).not.toMatch(/import.*from.*["']\.\/kiteIndexQuotes["']/);
  });

  it("optionSignalGates.ts imports from marketData/compat, not kiteIntraday", () => {
    const src = readSrc("optionSignalGates.ts");
    expect(src).toContain("centralIndexCandles");
    expect(src).not.toMatch(/import.*from.*["']\.\/kiteIntraday["']/);
  });

  it("liveBias.ts imports from marketData/compat, not kiteIntraday", () => {
    const src = readSrc("liveBias.ts");
    expect(src).toContain("centralIndexCandles");
    expect(src).toContain("centralEquityCandles");
    expect(src).not.toMatch(/import.*from.*["']\.\/kiteIntraday["']/);
  });
});

// ─── Gate D: display-only Yahoo consumers migrated ─────────────────────

describe("Gate D — display-only Yahoo consumers use central analytics adapter", () => {
  it("financials.ts imports from marketData/analyticsYahoo, not ./yahoo", () => {
    const src = readSrc("financials.ts");
    expect(src).toContain("marketData/analyticsYahoo");
    expect(src).not.toMatch(/import.*from.*["']\.\/yahoo["']/);
  });

  it("macroHistory.ts imports from marketData/analyticsYahoo, not ./yahoo", () => {
    const src = readSrc("macroHistory.ts");
    expect(src).toContain("marketData/analyticsYahoo");
    expect(src).not.toMatch(/import.*from.*["']\.\/yahoo["']/);
  });

  it("globalIndices.ts imports from marketData/analyticsYahoo, not ./yahoo", () => {
    const src = readSrc("globalIndices.ts");
    expect(src).toContain("marketData/analyticsYahoo");
    expect(src).not.toMatch(/import.*from.*["']\.\/yahoo["']/);
  });

  it("global/dataLayer.ts imports from marketData/analyticsYahoo, not ./yahoo", () => {
    const src = readSrc("global/dataLayer.ts");
    expect(src).toContain("marketData/analyticsYahoo");
    expect(src).not.toMatch(/import.*from.*["']\.\/yahoo["']/);
  });

  it("swingSignals.ts imports from marketData/analyticsYahoo, not ./yahoo", () => {
    const src = readSrc("swingSignals.ts");
    expect(src).toContain("marketData/analyticsYahoo");
    expect(src).not.toMatch(/import.*from.*["']\.\/yahoo["']/);
  });

  it("preMarket.ts imports from marketData/analyticsYahoo, not ./yahoo", () => {
    const src = readSrc("preMarket.ts");
    expect(src).toContain("marketData/analyticsYahoo");
    expect(src).not.toMatch(/import.*from.*["']\.\/yahoo["']/);
  });

  it("marketEvents.ts imports from marketData/analyticsYahoo, not yahoo-finance2", () => {
    const src = readSrc("marketEvents.ts");
    expect(src).toContain("marketData/analyticsYahoo");
    expect(src).not.toMatch(/import.*from.*["']yahoo-finance2["']/);
  });
});

// ─── Central compat adapter exists and is well-formed ──────────────────

describe("Central compat adapter contract", () => {
  const src = readSrc("marketData/compat.ts");

  it("exports centralIndexCandles", () => {
    expect(src).toMatch(/export\s+async\s+function\s+centralIndexCandles/);
  });

  it("exports centralHasIndexCoverage", () => {
    expect(src).toMatch(/export\s+function\s+centralHasIndexCoverage/);
  });

  it("exports centralEquityCandles", () => {
    expect(src).toMatch(/export\s+async\s+function\s+centralEquityCandles/);
  });

  it("exports centralIndexQuotes", () => {
    expect(src).toMatch(/export\s+async\s+function\s+centralIndexQuotes/);
  });

  it("routes through the central router, not raw providers", () => {
    expect(src).toContain("router.getIndexCandles");
    expect(src).toContain("router.hasIndexCoverage");
    expect(src).toContain("router.getEquityCandles");
    expect(src).toContain("router.getIndexQuotes");
    // Must NOT import raw providers
    expect(src).not.toMatch(/import.*from.*["']\.\.\/kiteIntraday["']/);
    expect(src).not.toMatch(/import.*from.*["']\.\.\/kiteIndexQuotes["']/);
  });
});

// ─── Analytics Yahoo adapter extends correctly ─────────────────────────

describe("Analytics Yahoo adapter contract", () => {
  const src = readSrc("marketData/analyticsYahoo.ts");

  it("re-exports display-only Yahoo functions", () => {
    expect(src).toContain("fetchStatements");
    expect(src).toContain("fetchIntraday");
    expect(src).toContain("fetchIndexChart");
    expect(src).toContain("fetchChart");
    expect(src).toContain("fetchChartRaw");
  });

  it("re-exports global Yahoo functions", () => {
    expect(src).toContain("fetchYahooCandles");
    expect(src).toContain("fetchYahooQuoteSnapshot");
  });

  it("re-exports YahooFinance SDK for earnings calendar", () => {
    expect(src).toContain("YahooFinance");
  });

  it("all re-exports are sourced from ../yahoo or ../global/yahoo", () => {
    // Verify the re-exports point to the correct internal modules
    expect(src).toContain('from "../yahoo"');
    expect(src).toContain('from "../global/yahoo"');
  });
});

// ─── Barrel exports include compat ─────────────────────────────────────

describe("Central barrel includes compat exports", () => {
  const src = readSrc("marketData/index.ts");

  it("exports compat functions", () => {
    expect(src).toContain("centralIndexCandles");
    expect(src).toContain("centralHasIndexCoverage");
    expect(src).toContain("centralEquityCandles");
    expect(src).toContain("centralIndexQuotes");
  });
});
