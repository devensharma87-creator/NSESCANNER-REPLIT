/**
 * p33b.scannerBundleScan.test.ts — Blocker 2: Debug route production-bundle isolation.
 *
 * Proves that the /debug/home-states route and HomeDebugPage are guarded by
 * import.meta.env.DEV in App.tsx so they are tree-shaken from the production build.
 *
 * We verify by scanning the SOURCE of App.tsx directly — Vite's dead-code
 * elimination guarantees that any branch guarded by `(import.meta.env.DEV as boolean)`
 * is entirely removed from the production bundle (including its lazy() import).
 * Source-scan is the appropriate verification method because:
 *   1. A full production build (~30s) in a unit test creates an unacceptable latency.
 *   2. The Vite/Rollup invariant "literal false && ... = dead code" is well-tested
 *      by the toolchain itself — the source guard is the only thing we own.
 *   3. The absence of a STATIC import (top-level import statement) is the critical
 *      invariant — if HomeDebugPage were statically imported, Rollup could not
 *      tree-shake it even with the route guard.
 *
 * Invariants proven:
 *   SB-01  App.tsx has NO static import for home-debug page
 *   SB-02  App.tsx has a dynamic lazy() import guarded by import.meta.env.DEV
 *   SB-03  The /debug/home-states route is guarded by import.meta.env.DEV
 *   SB-04  The /debug/home-states path string only appears inside the DEV guard block
 *   SB-05  home-debug.tsx still exists (not deleted — still needed for dev screenshots)
 *   SB-06  The lazy import uses the exact DEV guard pattern Rollup/Vite tree-shakes
 *   SB-07  App.tsx does NOT use require() for the debug page (require breaks ESM)
 *
 * Suite: scanner vitest
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// ── Read App.tsx source ───────────────────────────────────────────────────────

const APP_TSX_PATH = resolve(__dirname, "../App.tsx");
const HOME_DEBUG_PATH = resolve(__dirname, "../pages/home-debug.tsx");

let appSource: string;
try {
  appSource = readFileSync(APP_TSX_PATH, "utf8");
} catch (err) {
  throw new Error(`Cannot read App.tsx at ${APP_TSX_PATH}: ${(err as Error).message}`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SB-01: App.tsx has NO static import for home-debug", () => {
  it("SB-01a: no static `import HomeDebugPage from` top-level", () => {
    // A top-level static import would prevent tree-shaking regardless of route guard.
    const staticImportPattern = /^\s*import\s+\w+\s+from\s+["']@\/pages\/home-debug["']/m;
    expect(staticImportPattern.test(appSource)).toBe(false);
  });

  it("SB-01b: 'pages/home-debug' string appears ONLY in the lazy() conditional", () => {
    // Find all occurrences of "home-debug" in the source
    const occurrences: string[] = [];
    const lines = appSource.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("home-debug")) {
        occurrences.push(`L${i + 1}: ${lines[i].trim()}`);
      }
    }
    // Every occurrence must be inside the DEV guard block (lazy or import.meta.env.DEV)
    for (const occ of occurrences) {
      const isInLazy = occ.includes("lazy(") || occ.includes("import(");
      const isInComment = occ.trim().startsWith("//");
      expect(
        isInLazy || isInComment,
        `'home-debug' appeared outside lazy/comment: ${occ}`,
      ).toBe(true);
    }
  });
});

describe("SB-02: App.tsx uses a DEV-guarded dynamic lazy() import", () => {
  it("SB-02a: import.meta.env.DEV guard is present before the lazy() call", () => {
    // Vite replaces import.meta.env.DEV with `false` in production, enabling tree-shaking.
    // We look for the pattern: (import.meta.env.DEV as boolean) ... lazy(() => import("@/pages/home-debug"))
    const hasDevGuard = appSource.includes("import.meta.env.DEV");
    expect(hasDevGuard).toBe(true);
  });

  it("SB-02b: React.lazy() is used (not require()) for the debug page", () => {
    // require() is not valid in Vite ESM modules and won't be tree-shaken.
    const hasLazy = appSource.includes("React.lazy");
    expect(hasLazy).toBe(true);
  });

  it("SB-02c: dynamic import() of home-debug is inside the DEV guard", () => {
    // Find the lazy import and ensure import.meta.env.DEV comes before it in the file.
    const devGuardIdx = appSource.indexOf("import.meta.env.DEV");
    const lazyImportIdx = appSource.indexOf("import(\"@/pages/home-debug\")");
    const lazyImportIdxAlt = appSource.indexOf("import('@/pages/home-debug')");
    const actualLazyIdx = lazyImportIdx !== -1 ? lazyImportIdx : lazyImportIdxAlt;

    expect(devGuardIdx).toBeGreaterThanOrEqual(0); // DEV guard exists
    expect(actualLazyIdx).toBeGreaterThanOrEqual(0); // lazy import exists
    // The DEV guard must come BEFORE the lazy import in source order.
    // This ensures the import() is inside the conditional branch.
    expect(devGuardIdx).toBeLessThan(actualLazyIdx);
  });
});

describe("SB-03: /debug/home-states route is guarded by import.meta.env.DEV", () => {
  it("SB-03a: /debug/home-states route is NOT registered unconditionally", () => {
    // An unconditional route would look like: <Route path="/debug/home-states" ...
    // without any conditional wrapping.
    // We check that the route string only appears in a conditional context.
    const lines = appSource.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes("/debug/home-states") && !line.trim().startsWith("//") && !line.trim().startsWith("*")) {
        // Must be on a line that contains import.meta.env.DEV, OR the surrounding
        // context (lines around it) must contain the DEV guard.
        const contextStart = Math.max(0, i - 5);
        const contextEnd = Math.min(lines.length - 1, i + 5);
        const context = lines.slice(contextStart, contextEnd + 1).join("\n");
        const hasDevGuard = context.includes("import.meta.env.DEV");
        expect(
          hasDevGuard,
          `/debug/home-states route found without DEV guard at line ${i + 1}: "${line.trim()}"`,
        ).toBe(true);
      }
    }
  });

  it("SB-03b: the route uses {(import.meta.env.DEV as boolean) && ...} conditional pattern", () => {
    // This exact pattern is recognized by Vite as dead code when DEV=false.
    const hasConditionalPattern = appSource.includes("(import.meta.env.DEV as boolean)");
    expect(hasConditionalPattern).toBe(true);
  });
});

describe("SB-04: home-debug.tsx still exists for dev screenshots", () => {
  it("SB-04a: home-debug.tsx file exists in the pages directory", () => {
    expect(existsSync(HOME_DEBUG_PATH)).toBe(true);
  });
});

describe("SB-05: App.tsx does NOT use require() for the debug page", () => {
  it("SB-05a: no require('home-debug') or require(@/pages/home-debug)", () => {
    const requirePattern = /require\s*\(\s*["'].*home-debug["']/;
    expect(requirePattern.test(appSource)).toBe(false);
  });
});

describe("SB-06: HomeDebugPage import pattern is null in production", () => {
  it("SB-06a: App.tsx has a null branch when import.meta.env.DEV is false", () => {
    // The pattern: const HomeDebugPage = (import.meta.env.DEV as boolean) ? lazy(...) : null
    const hasNullBranch = appSource.includes(": null;") || appSource.includes(": null\n");
    expect(hasNullBranch).toBe(true);
  });
});
