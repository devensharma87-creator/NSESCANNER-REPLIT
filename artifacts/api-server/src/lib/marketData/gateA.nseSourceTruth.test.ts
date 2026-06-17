/**
 * Gate A — NSE Source Truth Tests
 *
 * Verifies that NSE fallback is honestly labelled as source = "nse" (not "none")
 * and that all trust/display/signal flags are correctly set.
 *
 * Owner requirement: "If NSE fallback is used, provenance must explicitly say NSE.
 * Do not hide NSE behind 'none'."
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

describe("Gate A — ProviderName includes 'nse'", () => {
  const types = readSrc("marketData/types.ts");

  it("ProviderName union includes 'nse'", () => {
    expect(types).toContain('"nse"');
    // Verify it's in the ProviderName line specifically
    const providerLine = types.split("\n").find(l => l.includes("ProviderName") && l.includes("="));
    expect(providerLine).toBeDefined();
    expect(providerLine).toContain('"nse"');
  });

  it("ProviderName still includes all existing members", () => {
    const providerLine = types.split("\n").find(l => l.includes("ProviderName") && l.includes("="));
    for (const member of ["kite", "indstocks", "yahoo", "nse", "cache", "none"]) {
      expect(providerLine, `Missing ProviderName member: ${member}`).toContain(`"${member}"`);
    }
  });
});

describe("Gate A — NSE fallback source honesty", () => {
  const provider = readSrc("marketData/optionChainProvider.ts");

  it("does NOT map NSE source to 'none' anywhere", () => {
    // The old mapping: source === "nse" ? "none" : opts.source
    expect(provider).not.toContain('"nse" ? "none"');
    expect(provider).not.toContain("'nse' ? 'none'");
  });

  it("buildOptionChainMeta passes source directly (no 'none' substitution)", () => {
    // Must not have any line that conditionally replaces nse with none
    const lines = provider.split("\n");
    const noneSubLines = lines.filter(
      l => l.includes("nse") && l.includes("none") && !l.trim().startsWith("//") && !l.trim().startsWith("*")
    );
    // Filter out type annotation lines (e.g., source: "kite" | "nse" | "none")
    const problematic = noneSubLines.filter(
      l => (l.includes("?") || (l.includes("source") && l.includes("="))) && !l.includes("|")
    );
    expect(
      problematic,
      "Found lines substituting NSE with 'none': " + problematic.join("\n")
    ).toEqual([]);
  });

  it("NSE fallback path passes source='nse' to meta builder", () => {
    // Find the NSE fallback meta builder call
    expect(provider).toContain('source: isNseFallback ? "nse" : "kite"');
  });

  it("NSE fallback sets trustTier = 'secondary_validation'", () => {
    expect(provider).toContain('trustTier: isNseFallback ? "secondary_validation" : "authoritative"');
  });

  it("NSE fallback sets notForSignals = true", () => {
    expect(provider).toContain("notForSignals");
    // isNseFallback || ... ensures NSE is always notForSignals
    expect(provider).toContain("isNseFallback || opts.trustTier !== \"authoritative\"");
  });

  it("NSE fallback sets notForTradeDecisions = true", () => {
    expect(provider).toContain("notForTradeDecisions");
  });

  it("NSE fallback sets visualOnly = true", () => {
    expect(provider).toContain("visualOnly: opts.isNseFallback");
  });

  it("NSE fallback sets fallbackUsed = true", () => {
    expect(provider).toContain("fallbackUsed: opts.isNseFallback");
  });

  it("NSE fallback includes honest warning message", () => {
    expect(provider).toContain("NSE fallback — display only, not for signals or trade decisions.");
  });
});

describe("Gate A — TRADE_GRADE mode never falls back to NSE", () => {
  const provider = readSrc("marketData/optionChainProvider.ts");

  it("fetchKiteOnly function exists and does NOT call NSE", () => {
    // Extract fetchKiteOnly body
    const kiteOnlyStart = provider.indexOf("async function fetchKiteOnly");
    const nextFunc = provider.indexOf("async function", kiteOnlyStart + 1);
    const kiteOnlyBody = provider.slice(kiteOnlyStart, nextFunc);
    
    expect(kiteOnlyBody).not.toContain("fetchWithNseFallback");
    expect(kiteOnlyBody).not.toContain("fetchOptionChain");
    // Only fetchKiteOptionChain
    expect(kiteOnlyBody).toContain("fetchKiteOptionChain");
  });

  it("TRADE_GRADE mode returns unavailable (not NSE) when Kite fails", () => {
    const kiteOnlyStart = provider.indexOf("async function fetchKiteOnly");
    const nextFunc = provider.indexOf("async function", kiteOnlyStart + 1);
    const kiteOnlyBody = provider.slice(kiteOnlyStart, nextFunc);

    expect(kiteOnlyBody).toContain("buildUnavailableMeta");
    expect(kiteOnlyBody).toContain("TRADE_GRADE");
  });
});

describe("Gate A — no Yahoo in option-chain/OI/F&O path", () => {
  it("optionChainProvider.ts has no yahoo import", () => {
    const src = readSrc("marketData/optionChainProvider.ts");
    const yahooImports = src.split("\n").filter(
      l => /import.*yahoo/i.test(l) && !l.trim().startsWith("//"),
    );
    expect(yahooImports).toEqual([]);
  });

  it("oiLab.ts has no yahoo import", () => {
    const src = readSrc("oiLab.ts");
    const yahooImports = src.split("\n").filter(
      l => /import.*yahoo/i.test(l) && !l.trim().startsWith("//"),
    );
    expect(yahooImports).toEqual([]);
  });

  it("optionChain.ts (NSE impl) has no yahoo import", () => {
    const src = readSrc("optionChain.ts");
    const yahooImports = src.split("\n").filter(
      l => /import.*yahoo/i.test(l) && !l.trim().startsWith("//"),
    );
    expect(yahooImports).toEqual([]);
  });
});

describe("Gate A — no source hidden as 'none' when real provider was used", () => {
  it("optionChainProvider uses 'none' only for unavailable/error meta", () => {
    const src = readSrc("marketData/optionChainProvider.ts");
    // Find all uses of source: "none" or source = "none"
    const noneSourceLines = src.split("\n").filter(
      l => l.includes('"none"') && !l.trim().startsWith("//") && !l.trim().startsWith("*"),
    );
    // The only valid use of "none" is in unavailableMeta for genuinely missing data
    // or in the ProviderName type import. Not in buildOptionChainMeta for NSE.
    for (const line of noneSourceLines) {
      // Skip type annotations and inline comments
      if (line.includes("|") || line.includes("//")) continue;
      // None of these lines should be in buildOptionChainMeta setting source to "none"
      expect(line).not.toMatch(/source.*=.*["']none["'].*nse/i);
      expect(line).not.toMatch(/nse.*["']none["']/i);
    }
  });
});

describe("Gate A — trust guard rejects NSE for trade-grade decisions", () => {
  const guard = readSrc("marketData/guard.ts");

  it("isTradeableMeta rejects secondary_validation tier", () => {
    // isTierTradeable only returns true for "authoritative"
    expect(guard).toContain("isTierTradeable(meta.trustTier)");
  });

  it("isTradeableMeta rejects notForSignals data", () => {
    expect(guard).toContain("meta.notForSignals");
  });

  const policy = readSrc("marketData/policy.ts");

  it("isTierTradeable only returns true for authoritative", () => {
    expect(policy).toContain('tier === "authoritative"');
  });
});
