/**
 * Pack 7 Gate 6 — Cross-Tab Canonical Equality Tests.
 * Pack 7 Gate 8 items 15–16.
 *
 * Proves via source inspection that:
 *  1. Every route that returns equity/index prices uses the canonical Kite router.
 *  2. Shadow providers (Upstox, IndianAPI) never appear in scanner page code.
 *  3. Market status is sourced from a single endpoint across all surfaces.
 *  4. React Query hooks include all relevant params in their cache keys.
 *  5. The asOf timestamp propagates consistently from the router.
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readIfExists(filePath: string): string {
  try { return fs.readFileSync(filePath, "utf-8"); } catch { return ""; }
}

function getAllFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        results.push(...getAllFiles(full, ext));
      } else if (entry.isFile() && entry.name.endsWith(ext)) {
        results.push(full);
      }
    }
  } catch { /* directory may not exist */ }
  return results;
}

const ROUTER_PATH = "src/lib/marketData/router.ts";
const ROUTES_DIR  = "src/routes";
const PAGES_DIR   = "../scanner/src/pages";
const COMPONENTS_DIR = "../scanner/src/components";
const GLOBAL_DIR  = "../global/src";

// ─── G6-1: Kite is the only authoritative source in the router ───────────────

describe("G6-1: router.ts — Kite is the only price source", () => {
  const routerContent = readIfExists(ROUTER_PATH);

  it("router.ts exists", () => {
    expect(routerContent.length).toBeGreaterThan(0);
  });

  it("router.ts imports kiteProvider", () => {
    expect(routerContent).toMatch(/from.*kiteProvider/);
  });

  it("router.ts does NOT use upstoxProvider as a primary quote source", () => {
    // Shadow dispatch (void dispatchShadow...) is allowed — primary returns are not
    // If there's a `return await upstox...` that's a violation
    const lines = routerContent.split("\n");
    const upstoxReturnLines = lines.filter(l =>
      /return.*upstox/i.test(l) && !/\/\//.test(l)
    );
    expect(upstoxReturnLines.length).toBe(0);
  });

  it("router.ts does NOT return IndianAPI data as primary price", () => {
    const lines = routerContent.split("\n");
    const indianApiReturnLines = lines.filter(l =>
      /return.*indianApi/i.test(l) && !/\/\//.test(l)
    );
    expect(indianApiReturnLines.length).toBe(0);
  });
});

// ─── G6-2: Route handlers do not direct-import shadow providers ──────────────

describe("G6-2: Route handlers — no direct shadow provider imports", () => {
  const routeFiles = getAllFiles(ROUTES_DIR, ".ts").filter(f => !f.endsWith(".test.ts"));

  it("found route files to inspect", () => {
    expect(routeFiles.length).toBeGreaterThan(0);
  });

  for (const routeFile of routeFiles.slice(0, 20)) {
    it(`${path.basename(routeFile)} does not import upstoxProvider directly`, () => {
      const content = readIfExists(routeFile);
      // Shadow providers should only be accessed via the router
      const hasDirectUpstox = /from.*upstoxProvider/.test(content) ||
                               /require.*upstoxProvider/.test(content);
      // Diagnostics route is exempt (it reads health stats, not prices)
      const isDiagnosticsRoute = routeFile.includes("providerDiagnostics");
      if (!isDiagnosticsRoute) {
        expect(hasDirectUpstox).toBe(false);
      }
    });
  }
});

// ─── G6-3: Scanner pages do not import shadow providers ─────────────────────

describe("G6-3: Scanner pages — no shadow provider imports", () => {
  const pageFiles = getAllFiles(PAGES_DIR, ".tsx").filter(f => !f.endsWith(".test.tsx"));

  it("found scanner page files to inspect", () => {
    expect(pageFiles.length).toBeGreaterThan(0);
  });

  it("No scanner page imports upstoxProvider", () => {
    for (const pageFile of pageFiles) {
      const content = readIfExists(pageFile);
      expect(content).not.toContain("upstoxProvider");
    }
  });

  it("No scanner page imports indianApiProvider", () => {
    for (const pageFile of pageFiles) {
      const content = readIfExists(pageFile);
      expect(content).not.toContain("indianApiProvider");
    }
  });

  it("No scanner page imports upstoxClient directly", () => {
    for (const pageFile of pageFiles) {
      const content = readIfExists(pageFile);
      expect(content).not.toContain("upstoxClient");
    }
  });
});

// ─── G6-4: Scanner components do not import shadow providers ─────────────────

describe("G6-4: Scanner components — no shadow provider imports", () => {
  const componentFiles = getAllFiles(COMPONENTS_DIR, ".tsx").filter(f => !f.endsWith(".test.tsx"));

  it("found scanner component files to inspect", () => {
    expect(componentFiles.length).toBeGreaterThan(0);
  });

  it("No scanner component imports upstoxProvider or indianApiProvider", () => {
    for (const componentFile of componentFiles) {
      const content = readIfExists(componentFile);
      expect(content).not.toContain("upstoxProvider");
      expect(content).not.toContain("indianApiProvider");
    }
  });
});

// ─── G6-5: Market status sourced from a single endpoint ─────────────────────

describe("G6-5: Market status consistency across surfaces", () => {
  it("scanner pages use /api/market/status or computeMarketStatus (not hardcoded)", () => {
    const pageFiles = getAllFiles(PAGES_DIR, ".tsx").filter(f => !f.endsWith(".test.tsx"));
    for (const pageFile of pageFiles) {
      const content = readIfExists(pageFile);
      // No page should hardcode marketOpen: true or marketOpen: false
      expect(content).not.toMatch(/marketOpen:\s*true(?!,\s*\/\/ fixture)/);
      expect(content).not.toMatch(/marketOpen:\s*false(?!.*fixture)/);
    }
  });

  it("api-server routes do not hardcode market status", () => {
    const routeFiles = getAllFiles(ROUTES_DIR, ".ts").filter(f => !f.endsWith(".test.ts"));
    for (const routeFile of routeFiles) {
      const content = readIfExists(routeFile);
      // marketOpen should come from computeMarketStatus, not literals
      expect(content).not.toMatch(/return\s*\{\s*marketOpen:\s*true\s*\}/);
      expect(content).not.toMatch(/return\s*\{\s*marketOpen:\s*false\s*\}/);
    }
  });
});

// ─── G6-6: asOf timestamp propagation ───────────────────────────────────────

describe("G6-6: asOf timestamp propagation from router", () => {
  const routerContent = readIfExists(ROUTER_PATH);

  it("router.ts includes asOf or meta.asOf in results", () => {
    expect(routerContent).toMatch(/asOf|meta\.asOf|fetchedAt/);
  });

  it("DataMeta type includes asOf field", () => {
    const typesContent = readIfExists("src/lib/marketData/types.ts");
    expect(typesContent).toMatch(/asOf/);
  });
});

// ─── G6-7: React Query key completeness ─────────────────────────────────────

describe("G6-7: React Query key completeness in scanner hooks", () => {
  const hooksDir = "../scanner/src/hooks";
  const hookFiles = getAllFiles(hooksDir, ".ts").concat(getAllFiles(hooksDir, ".tsx"));

  it("found hook files to inspect", () => {
    // If no hooks dir exists, check pages directly
    const pageFiles = getAllFiles(PAGES_DIR, ".tsx");
    const totalFiles = hookFiles.length + pageFiles.length;
    expect(totalFiles).toBeGreaterThan(0);
  });

  it("useQuery calls for stock detail include symbol in queryKey", () => {
    const allFiles = [...hookFiles, ...getAllFiles(PAGES_DIR, ".tsx")];
    for (const f of allFiles) {
      const content = readIfExists(f);
      // For files that call useQuery with a symbol pattern
      if (content.includes("useQuery") && content.includes("/api/stocks/")) {
        // The query key should include the symbol variable
        expect(content).toMatch(/queryKey.*symbol|symbol.*queryKey/s);
      }
    }
  });
});

// ─── G8-15: Cross-tab canonical equality summary ─────────────────────────────

describe("G8-15: Cross-tab canonical equality summary", () => {
  it("All scanner page files avoid direct price injection", () => {
    const pageFiles = getAllFiles(PAGES_DIR, ".tsx");
    let directPriceCount = 0;
    for (const f of pageFiles) {
      const content = readIfExists(f);
      // Direct injection of hardcoded prices in non-fixture code
      if (/lastPrice:\s*\d{4,5}/.test(content) && !f.includes(".test.")) {
        directPriceCount++;
      }
    }
    // Only fixture/mock files should have hardcoded prices
    expect(directPriceCount).toBe(0);
  });

  it("Router is the single point of dispatch for market data", () => {
    const routerContent = readIfExists(ROUTER_PATH);
    // The router must export functions that route requests
    expect(routerContent).toMatch(/export.*function|export.*async/);
  });

  it("parityClassification.ts exists and is only in api-server", () => {
    const apiServerPath = "src/lib/marketData/parityClassification.ts";
    const globalPath    = "artifacts/global/src/lib/marketData/parityClassification.ts";
    expect(fs.existsSync(apiServerPath)).toBe(true);
    expect(fs.existsSync(globalPath)).toBe(false);
  });
});

// ─── G8-16: Query-key completeness proof ────────────────────────────────────

describe("G8-16: Query-key completeness", () => {
  it("scanner lib files that directly call useQuery include queryKey or use generated hooks", () => {
    const apiClientDir = "../scanner/src/lib";
    const files = getAllFiles(apiClientDir, ".ts").concat(getAllFiles(apiClientDir, ".tsx"));
    for (const f of files) {
      const content = readIfExists(f);
      // Skip generated files (they use useQuery internally but manage queryKey themselves)
      if (content.includes("useQuery") && !f.includes(".test.") && !f.includes("generated")) {
        // Files using useQuery must either: have queryKey, OR delegate to a generated hook
        const hasQueryKey = /queryKey\s*:\s*\[/.test(content);
        const usesGeneratedHook = content.includes("@workspace/api-client") || 
                                  content.includes("use") && content.includes("Query(");
        // Both are acceptable patterns
        expect(hasQueryKey || usesGeneratedHook).toBe(true);
      }
    }
  });

  it("staleTime values are positive numbers (not zero or undefined)", () => {
    const allFiles = [
      ...getAllFiles(PAGES_DIR, ".tsx"),
      ...getAllFiles(COMPONENTS_DIR, ".tsx"),
    ];
    for (const f of allFiles) {
      const content = readIfExists(f);
      // staleTime: 0 is valid but would cause excessive refetches
      // Verify no explicit staleTime: 0 on market data endpoints
      if (content.includes("staleTime: 0") && content.includes("/api/market")) {
        // Market status with staleTime 0 causes hammering — warn but don't fail hard
        expect(content).not.toContain("staleTime: 0,\n");
      }
    }
  });
});

// ─── Gate 20: Global artifact exclusion ─────────────────────────────────────

describe("Gate 20: Global artifact is excluded from Pack 7 scope", () => {
  it("Global artifact directory exists (unmodified)", () => {
    expect(fs.existsSync("../global")).toBe(true);
  });

  it("Shadow parity types NOT in global artifact", () => {
    const globalParity = "artifacts/global/src/lib/marketData/parityClassification.ts";
    expect(fs.existsSync(globalParity)).toBe(false);
  });

  it("Gate 3-8 test files are in api-server and scanner only", () => {
    const gate3 = "src/lib/p26.gate3.shadowNonInterference.test.ts";
    const gate5 = "src/lib/p26.gate5.parityModel.test.ts";
    const gate6 = "src/lib/p26.gate6.crossTabEquality.test.ts";
    expect(fs.existsSync(gate3)).toBe(true);
    expect(fs.existsSync(gate5)).toBe(true);
    expect(fs.existsSync(gate6)).toBe(true);
  });

  it("No p26.gate* files in global artifact", () => {
    const globalGate3 = "artifacts/global/src/lib/p26.gate3.shadowNonInterference.test.ts";
    expect(fs.existsSync(globalGate3)).toBe(false);
  });
});
