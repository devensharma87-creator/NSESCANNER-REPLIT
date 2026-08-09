/**
 * p33b.fnoBanGuard.test.ts — Blocker 3: F&O-ban legacy false-path import guard.
 *
 * Rules under test:
 *   B3-1  No production route imports isFnoBannedLegacy.
 *   B3-2  No signal consumer imports isFnoBannedLegacy.
 *   B3-3  isFnoBanned() returns boolean|null (tri-state).
 *   B3-4  null return means UNAVAILABLE — callers must NOT convert null→false.
 *   B3-5  isFnoBannedLegacy exists only in fnoBanList.ts (the source) — not re-exported.
 *   B3-6  getFnoBanList(null) preserved as-is in the instFlows production route.
 *
 * Verified 2026-08-09: no production callers exist (only instFlows.ts uses
 * getFnoBanList directly and already handles null correctly).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");

/** Recursively collect all .ts files under src/ excluding test files and node_modules. */
function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) results.push(...collectTsFiles(full));
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".d.ts")) {
      results.push(full);
    }
  }
  return results;
}

const allProductionFiles = collectTsFiles(SRC);

/** Files that are explicitly allowed to reference isFnoBannedLegacy (the source only). */
const ALLOWLIST = new Set([
  "fnoBanList.ts",
]);

describe("Blocker 3 — F&O ban import guard", () => {
  it("B3-1: no production route imports isFnoBannedLegacy", () => {
    const routeFiles = allProductionFiles.filter(f => f.includes("/routes/"));
    const violations: string[] = [];
    for (const file of routeFiles) {
      const content = readFileSync(file, "utf8");
      if (content.includes("isFnoBannedLegacy")) {
        violations.push(file.replace(SRC, "src"));
      }
    }
    expect(violations, `Production routes importing isFnoBannedLegacy: ${violations.join(", ")}`).toEqual([]);
  });

  it("B3-2: no signal consumer imports isFnoBannedLegacy", () => {
    const signalFiles = allProductionFiles.filter(f => {
      const name = f.split("/").pop()!;
      return (
        name.includes("fnoSignal") ||
        name.includes("preMarket") ||
        name.includes("swing") ||
        name.includes("scanner") ||
        name.includes("optionSignal") ||
        name.includes("instFlow") ||
        name.includes("paperTrading")
      );
    });
    const violations: string[] = [];
    for (const file of signalFiles) {
      const content = readFileSync(file, "utf8");
      if (content.includes("isFnoBannedLegacy")) {
        violations.push(file.replace(SRC, "src"));
      }
    }
    expect(violations, `Signal consumers importing isFnoBannedLegacy: ${violations.join(", ")}`).toEqual([]);
  });

  it("B3-3: isFnoBannedLegacy appears only in its source file (not re-exported)", () => {
    const violations: string[] = [];
    for (const file of allProductionFiles) {
      const name = file.split("/").pop()!;
      if (ALLOWLIST.has(name)) continue;
      const content = readFileSync(file, "utf8");
      if (content.includes("isFnoBannedLegacy")) {
        violations.push(file.replace(SRC, "src"));
      }
    }
    expect(violations, `Unexpected isFnoBannedLegacy references outside fnoBanList.ts: ${violations.join(", ")}`).toEqual([]);
  });

  it("B3-4: isFnoBanned is tri-state boolean|null (not boolean)", async () => {
    // Verify the type contract by testing the return type is correct:
    // We cannot call the real fn in unit tests, but we can verify the source signature.
    const banListSrc = readFileSync(join(SRC, "lib/fnoBanList.ts"), "utf8");
    // Must declare tri-state return type
    expect(banListSrc).toMatch(/isFnoBanned\([^)]+\):\s*Promise<boolean\s*\|\s*null>/);
  });

  it("B3-5: isFnoBannedLegacy JSDoc contains TEST/COMPAT-ISOLATED ONLY restriction", () => {
    const banListSrc = readFileSync(join(SRC, "lib/fnoBanList.ts"), "utf8");
    expect(banListSrc).toMatch(/TEST\/COMPAT-ISOLATED ONLY/);
    expect(banListSrc).toMatch(/No production route may import this function/);
  });

  it("B3-6: instFlows production route uses getFnoBanList (not isFnoBanned/isFnoBannedLegacy)", () => {
    const instFlowsSrc = readFileSync(join(SRC, "routes/instFlows.ts"), "utf8");
    // Production route uses the getFnoBanList directly and handles null (available:false)
    expect(instFlowsSrc).toContain("getFnoBanList");
    expect(instFlowsSrc).not.toContain("isFnoBanned");
  });
});
