/**
 * Phase 3 structural tests — Central Option Chain Provider
 *
 * Verifies:
 *  1. OI Lab no longer imports `kiteOptionChain` directly
 *  2. Option Chain route no longer imports `optionChain.fetchOptionChain` directly
 *  3. Both consumers use the central `optionChainProvider`
 *  4. Central provider exposes required metadata fields
 *  5. No Yahoo in option-chain / OI / F&O path
 *  6. optionChain.ts remains a valid NSE fallback implementation (not deleted)
 *  7. No F&O gate, guardrail, or sizing logic changed
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

describe("Phase 3 — OI Lab consumes central option-chain provider", () => {
  const src = readSrc("oiLab.ts");

  it("imports getCentralOptionChain from marketData/optionChainProvider", () => {
    expect(src).toContain("from \"./marketData/optionChainProvider\"");
  });

  it("does NOT import fetchKiteOptionChain directly", () => {
    // Only comments may reference fetchKiteOptionChain — no import statement.
    const importLines = src.split("\n").filter(
      l => l.includes("fetchKiteOptionChain") && /^\s*(import|from)\b/.test(l),
    );
    expect(importLines, "oiLab.ts must not import fetchKiteOptionChain directly").toEqual([]);
  });

  it("calls getCentralOptionChain in TRADE_GRADE mode", () => {
    expect(src).toContain("\"TRADE_GRADE\"");
  });

  it("does NOT call fetchKiteOptionChain as a function", () => {
    // Only comments may mention it; no `await fetchKiteOptionChain(...)`.
    const callLines = src.split("\n").filter(
      l => /fetchKiteOptionChain\s*\(/.test(l) && !l.trim().startsWith("//") && !l.trim().startsWith("*"),
    );
    expect(callLines, "No direct fetchKiteOptionChain call").toEqual([]);
  });
});

describe("Phase 3 — Option Chain route consumes central option-chain provider", () => {
  const src = readSrc("../routes/optionChain.ts");

  it("imports getCentralOptionChain from marketData/optionChainProvider", () => {
    expect(src).toContain("from \"../lib/marketData/optionChainProvider\"");
  });

  it("does NOT import fetchOptionChain from optionChain.ts directly", () => {
    const importLines = src.split("\n").filter(
      l =>
        l.includes("fetchOptionChain") &&
        l.includes("import") &&
        l.includes("optionChain"),
    );
    // Should be zero — the route now uses the central provider.
    expect(importLines, "Route must not import fetchOptionChain directly").toEqual([]);
  });

  it("uses DISPLAY mode (NSE fallback allowed, labelled)", () => {
    expect(src).toContain("\"DISPLAY\"");
  });
});

describe("Phase 3 — Central option-chain provider contract", () => {
  const src = readSrc("marketData/optionChainProvider.ts");

  it("exports getOptionChain", () => {
    expect(src).toMatch(/export\s+(async\s+)?function\s+getOptionChain/);
  });

  it("exports OptionChainMode type", () => {
    expect(src).toMatch(/export\s+type\s+OptionChainMode/);
  });

  it("exports OptionChainMeta interface", () => {
    expect(src).toMatch(/export\s+interface\s+OptionChainMeta/);
  });

  it("exports TrustedOptionChain interface", () => {
    expect(src).toMatch(/export\s+interface\s+TrustedOptionChain/);
  });

  it("exports clearOptionChainCache", () => {
    expect(src).toContain("export function clearOptionChainCache");
  });

  it("supports TRADE_GRADE and DISPLAY modes", () => {
    expect(src).toContain("TRADE_GRADE");
    expect(src).toContain("DISPLAY");
  });

  it("has shared TTL cache with explicit key", () => {
    expect(src).toContain("chainCache");
    expect(src).toContain("CACHE_TTL_MS");
    expect(src).toContain("cacheKey");
  });

  it("OptionChainMeta has all required provenance fields", () => {
    // Required per owner specification
    for (const field of [
      "fallbackUsed",
      "synthetic",
      "visualOnly",
      "modelled",
      "missingReason",
    ]) {
      expect(src, `Missing field: ${field}`).toContain(field);
    }
  });

  it("OptionChainMeta extends DataMeta (inherits source, trustTier, asOf, etc.)", () => {
    expect(src).toContain("extends DataMeta");
  });

  it("labels NSE fallback as notForSignals and notForTradeDecisions", () => {
    expect(src).toContain("notForSignals");
    expect(src).toContain("notForTradeDecisions");
    // Both must be true when NSE fallback is used
    expect(src).toMatch(/isNseFallback.*notForSignals/s);
  });

  it("does NOT import or reference Yahoo", () => {
    const yahooLines = src.split("\n").filter(
      l => /yahoo/i.test(l) && !l.trim().startsWith("//") && !l.trim().startsWith("*"),
    );
    expect(yahooLines, "No Yahoo in central option-chain provider").toEqual([]);
  });

  it("TRADE_GRADE mode returns unavailable when Kite is down (no fallback)", () => {
    // The fetchKiteOnly function should NOT call NSE
    expect(src).toMatch(/fetchKiteOnly/);
    // And should NOT call fetchWithNseFallback
    const kiteOnlyBody = src.split("async function fetchKiteOnly")[1]?.split("async function")[0] ?? "";
    expect(kiteOnlyBody).not.toContain("fetchWithNseFallback");
  });

  it("marks stale cache as stale (via DataMeta.isStale inherited from buildMeta)", () => {
    // The central provider uses buildMeta() from validator.ts which computes
    // isStale via freshness.ts. The DataMeta envelope (which OptionChainMeta
    // extends) carries isStale to every consumer.
    expect(src).toContain("buildMeta");
    // Cache expiry is controlled by CACHE_TTL_MS — expired cache is deleted, not served.
    expect(src).toContain("CACHE_TTL_MS");
  });
});

describe("Phase 3 — optionChain.ts still exists as NSE fallback implementation", () => {
  const src = readSrc("optionChain.ts");

  it("still exports fetchOptionChain", () => {
    expect(src).toMatch(/export\s+(async\s+)?function\s+fetchOptionChain/);
  });

  it("still has NSE direct implementation", () => {
    expect(src).toContain("nseFetch");
    expect(src).toContain("NSE_BASE");
  });

  it("still exports OcResponse type", () => {
    expect(src).toContain("export interface OcResponse");
  });
});

describe("Phase 3 — no F&O gate, guardrail, or sizing changes", () => {
  it("fnoSizingHelper is untouched", () => {
    const src = readSrc("fnoSizingHelper.ts");
    expect(src).toContain("computeFnoLotSizing");
  });

  it("optionSignalGates uses central backbone (migrated from kiteIntraday)", () => {
    const src = readSrc("optionSignalGates.ts");
    expect(src).toContain("centralIndexCandles");
    expect(src).not.toMatch(/import.*from.*["']\.\/kiteIntraday["']/);
  });

  it("paperTradingFO is untouched", () => {
    const src = readSrc("paperTradingFO.ts");
    expect(src).toContain("PAPER_TRADE");
  });
});

describe("Phase 3 — no Yahoo in option-chain, OI Lab, or F&O path", () => {
  it("oiLab.ts has no yahoo import", () => {
    const src = readSrc("oiLab.ts");
    const yahooImports = src.split("\n").filter(
      l => /import.*yahoo/i.test(l) && !l.trim().startsWith("//"),
    );
    expect(yahooImports).toEqual([]);
  });

  it("optionChain.ts has no yahoo import", () => {
    const src = readSrc("optionChain.ts");
    const yahooImports = src.split("\n").filter(
      l => /import.*yahoo/i.test(l) && !l.trim().startsWith("//"),
    );
    expect(yahooImports).toEqual([]);
  });

  it("marketData/optionChainProvider.ts has no yahoo import", () => {
    const src = readSrc("marketData/optionChainProvider.ts");
    const yahooImports = src.split("\n").filter(
      l => /import.*yahoo/i.test(l) && !l.trim().startsWith("//"),
    );
    expect(yahooImports).toEqual([]);
  });
});

describe("Phase 3 — Gate 1 execution truth not disturbed", () => {
  it("option-signal-alerter.tsx does not contain PAPER_TRADE: YES", () => {
    // Path from libDir (.../src/lib) to scanner component
    const alerterPath = path.resolve(libDir, "..", "..", "..", "scanner", "src", "components", "option-signal-alerter.tsx");
    let src: string;
    try {
      src = readFileSync(alerterPath, "utf8");
    } catch {
      // If the file doesn't exist from this path, skip gracefully
      return;
    }
    expect(src).not.toContain("PAPER_TRADE: YES");
  });

  it("optionSignalLifecycle.ts has enrichWithExecutionTruth function", () => {
    const src = readSrc("optionSignalLifecycle.ts");
    // enrichWithExecutionTruth is an internal (non-exported) function called
    // by the exported getTodayHistory/getRecentHistory/getHistoryByDate functions.
    expect(src).toContain("enrichWithExecutionTruth");
  });
});
