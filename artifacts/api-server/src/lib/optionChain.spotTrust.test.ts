/**
 * Sprint 2 — Option Chain Spot Trust tests.
 *
 * Verifies that:
 *   1. optionChain.ts does NOT import Yahoo (verified by providerImportGuard)
 *   2. getSpotForUnderlying() never returns Yahoo-sourced data
 *   3. OcResponse carries spotSource / spotTrusted fields
 *   4. F&O signal path remains unaffected (separate concern, verified here structurally)
 */
import { describe, it, expect } from "vitest";

// ── 1. optionChain.ts no longer imports Yahoo ───────────────────────
// The structural import guard is tested in providerImportGuard.test.ts.
// Here we verify the contract of getSpotForUnderlying and OcResponse.

describe("Option chain spot trust contract", () => {
  describe("getSpotForUnderlying return type", () => {
    // We cannot call the real function (needs Kite session), but we
    // can verify the CONTRACT by importing the type/module and checking
    // the source file does not reference yahoo at runtime.

    it("optionChain.ts does not import fetchChart from yahoo", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const file = path.resolve(__dirname, "optionChain.ts");
      const src = fs.readFileSync(file, "utf-8");

      // Must NOT have a runtime import of fetchChart from yahoo
      expect(src).not.toMatch(/import\s+\{[^}]*fetchChart[^}]*\}\s+from\s+["']\.\/yahoo["']/);
      // Must NOT have any import from "./yahoo" at all
      expect(src).not.toMatch(/import\s+.*\s+from\s+["']\.\/yahoo["']/);
    });

    it("optionChain.ts imports getLiveQuote from kiteFeed", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const file = path.resolve(__dirname, "optionChain.ts");
      const src = fs.readFileSync(file, "utf-8");

      expect(src).toMatch(/import\s+\{[^}]*getLiveQuote[^}]*\}\s+from\s+["']\.\/kiteFeed["']/);
    });
  });

  describe("OcResponse interface", () => {
    it("OcResponse exports spotSource type", async () => {
      // Verify by source code analysis (avoid dynamic import which triggers DB).
      const fs = await import("fs");
      const path = await import("path");
      const file = path.resolve(__dirname, "optionChain.ts");
      const src = fs.readFileSync(file, "utf-8");
      expect(src).toContain("spotSource: OcSpotSource;");
      expect(src).toContain("spotTrusted: boolean;");
      // Verify the type declaration exists
      expect(src).toContain('export type OcSpotSource = "kite" | "nse" | "unavailable"');
    });
  });

  describe("getSpotForUnderlying Yahoo elimination", () => {
    it("getSpotForUnderlying does NOT reference Yahoo ticker map", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const file = path.resolve(__dirname, "optionChain.ts");
      const src = fs.readFileSync(file, "utf-8");

      // The old code had a `const yahoo: Record<string, string> = { ... }` block
      // inside getSpotForUnderlying. Verify it's gone.
      const fnBody = extractFunctionBody(src, "getSpotForUnderlying");
      expect(fnBody).not.toContain("fetchChart");
      expect(fnBody).not.toContain("^CNXFIN");  // Old Yahoo FINNIFTY ticker
      expect(fnBody).not.toContain("fall through to Yahoo");
    });

    it("getSpotForUnderlying returns structured { price, source } or null", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const file = path.resolve(__dirname, "optionChain.ts");
      const src = fs.readFileSync(file, "utf-8");

      // Verify return type signature
      expect(src).toContain("Promise<{ price: number; source: OcSpotSource } | null>");
    });
  });

  describe("fetchOptionChain spot provenance", () => {
    it("Kite path stamps spotSource=kite, spotTrusted=true", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const file = path.resolve(__dirname, "optionChain.ts");
      const src = fs.readFileSync(file, "utf-8");

      // Check the Kite path sets spotSource
      expect(src).toContain('kiteResult.spotSource = "kite"');
      expect(src).toContain("kiteResult.spotTrusted = true");
    });

    it("NSE-direct path stamps spotSource=nse, spotTrusted=true", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const file = path.resolve(__dirname, "optionChain.ts");
      const src = fs.readFileSync(file, "utf-8");

      expect(src).toContain('spotSource: "nse"');
      expect(src).toContain("spotTrusted: true");
    });

    it("no path stamps spotSource=yahoo", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const file = path.resolve(__dirname, "optionChain.ts");
      const src = fs.readFileSync(file, "utf-8");

      // Yahoo must NEVER appear as a spot source
      expect(src).not.toContain('spotSource: "yahoo"');
      expect(src).not.toContain("spotSource = \"yahoo\"");
    });
  });

  describe("kiteOptionChain.ts also sets spotSource", () => {
    it("kiteOptionChain constructs OcResponse with spotSource=kite", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const file = path.resolve(__dirname, "kiteOptionChain.ts");
      const src = fs.readFileSync(file, "utf-8");

      expect(src).toContain('spotSource: "kite"');
      expect(src).toContain("spotTrusted: true");
    });
  });

  describe("F&O signal path independence", () => {
    it("optionSignals.ts does NOT import from ./yahoo at runtime", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const file = path.resolve(__dirname, "optionSignals.ts");
      const src = fs.readFileSync(file, "utf-8");

      // Runtime (non-type) imports from yahoo must be zero.
      // Type-only imports are allowed but not required.
      const runtimeImports = (src.match(/^import\s+\{[^}]+\}\s+from\s+["']\.\/(yahoo|yahoo-finance2)["']/gm) ?? [])
        .filter(line => !line.match(/^import\s+type\s/));
      expect(runtimeImports).toHaveLength(0);
    });

    it("optionSignalVetoes.ts does NOT import from ./yahoo", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const file = path.resolve(__dirname, "optionSignalVetoes.ts");
      const src = fs.readFileSync(file, "utf-8");

      expect(src).not.toMatch(/from\s+["']\.\/yahoo["']/);
    });
  });
});

// ── Helpers ───────────────────────────────────────────────────────────

/** Rough extraction of a function body by name (good enough for source analysis). */
function extractFunctionBody(src: string, fnName: string): string {
  const idx = src.indexOf(`function ${fnName}`);
  if (idx < 0) return "";
  let depth = 0;
  let start = -1;
  for (let i = idx; i < src.length; i++) {
    if (src[i] === "{") {
      if (start < 0) start = i;
      depth++;
    } else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return src.slice(start);
}
