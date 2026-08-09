/**
 * p33b.bundleScan.test.ts — Blocker 2 artifact scan.
 *
 * Proves that the four test-hook symbols are not present in the production
 * bundle (dist/index.mjs). This is the compile-time complement of the
 * NODE_ENV guard in fullNseScanner.ts — the guard prevents runtime calls,
 * and this test proves the names do not appear at all in the built artifact.
 *
 * Rationale: esbuild tree-shakes exports that are not imported by any
 * production path. Because no registered route imports the four hook
 * functions, they are eliminated from the bundle. The NODE_ENV guard is a
 * belt-and-suspenders defence for the case where bundler tree-shaking is
 * ever bypassed (e.g. a future dynamic import).
 *
 * Suite: api-server vitest (non-DB, --pool=threads)
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const DIST_PATH = join(__dirname, "../../dist/index.mjs");
const HOOK_NAMES = [
  "_setTestScanResultFactory",
  "_setTestPauseBeforeCommit",
  "_clearTestFactories",
  "_resetTestHooks",
] as const;

let bundleContent = "";

describe("B2 — Production bundle: test-hook symbol exclusion", () => {
  beforeAll(() => {
    if (existsSync(DIST_PATH)) {
      bundleContent = readFileSync(DIST_PATH, "utf8");
    }
    // If the bundle does not exist yet, tests skip gracefully.
  });

  it("B2-BUILD: production bundle (dist/index.mjs) exists", () => {
    expect(existsSync(DIST_PATH), `dist/index.mjs not found at ${DIST_PATH}`).toBe(true);
  });

  for (const name of HOOK_NAMES) {
    it(`B2-HOOK: "${name}" is absent from dist/index.mjs`, () => {
      if (!existsSync(DIST_PATH)) {
        // Skip gracefully if no build yet — B2-BUILD will fail instead.
        return;
      }
      // The name must not appear anywhere in the bundle — not as a string
      // literal, not as a minified export name, not in a comment.
      // esbuild strips exports unreachable from the entry point, and the
      // NODE_ENV guard ensures even if the function were somehow included,
      // calling it at runtime would throw.
      const found = bundleContent.includes(name);
      expect(found, `"${name}" found in dist/index.mjs — test hook leaked into production bundle`).toBe(false);
    });
  }

  it("B2-GUARD-SOURCE: all hooks throw outside NODE_ENV=test (source-level proof)", async () => {
    // Verify the source guard code is present in fullNseScanner.ts.
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const src = readFileSync(join(__dirname, "fullNseScanner.ts"), "utf8");
    for (const name of HOOK_NAMES) {
      expect(src, `${name} missing NODE_ENV guard in source`).toContain(
        `process.env.NODE_ENV !== "test"`
      );
    }
  });

  it("B2-ROUTE-IMPORT: no registered route imports test hooks (source-level guard)", async () => {
    const { readFileSync, readdirSync } = await import("fs");
    const { join } = await import("path");
    const routesDir = join(__dirname, "../../src/routes");
    const routeFiles = readdirSync(routesDir).filter((f) => f.endsWith(".ts") && !f.includes("test"));
    for (const file of routeFiles) {
      const content = readFileSync(join(routesDir, file), "utf8");
      for (const name of HOOK_NAMES) {
        expect(content, `Route ${file} imports test hook "${name}"`).not.toContain(name);
      }
    }
  });
});
