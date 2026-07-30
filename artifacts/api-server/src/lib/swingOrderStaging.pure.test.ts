/**
 * Swing staging — pure/static tests (no DB required).
 *
 * PURE TEST FILE (.pure.test.ts)
 * ----------------------------------------
 * These tests exercise pure logic and static source-code invariants.
 * They DO NOT require a database. They run in the normal non-DB test suite
 * via `pnpm run test:full` / `vitest run` (vitest.config.ts).
 *
 * Note: The `deriveStageStatus` tests import `./swingOrderStaging` which
 * transitively imports `@workspace/db`. The Pool created is lazy (no TCP
 * connection). DATABASE_URL must be present in the process environment —
 * this is always true in the Replit dev environment.
 *
 * Source: extracted from swingOrderStaging.db.test.ts (P0.1B refactor).
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Pure deriveStageStatus mapping (no DB required, no queries).
// ---------------------------------------------------------------------------

describe("deriveStageStatus", () => {
  // deriveStageStatus is a pure synchronous function; it touches no DB.
  // We import it lazily inside `it()` callbacks to defer the transitive
  // @workspace/db module evaluation until the test actually runs.
  // The lazy import is cached by Node.js, so cost is O(1) after first call.
  const load = () =>
    import("./swingOrderStaging.js").then((m) => m.deriveStageStatus);

  const base = (over: Record<string, unknown>) =>
    ({
      allowed: false,
      reviewRequired: false,
      gates: { entry: { watchOnly: false } },
      ...over,
    }) as never;

  it("maps a clean allowed decision to STAGED", async () => {
    const deriveStageStatus = await load();
    expect(deriveStageStatus(base({ allowed: true })).status).toBe("STAGED");
  });

  it("maps review-required to APPROVAL_REQUIRED (stageable)", async () => {
    const deriveStageStatus = await load();
    const d = deriveStageStatus(base({ reviewRequired: true }));
    expect(d.status).toBe("APPROVAL_REQUIRED");
    expect(d.stageable).toBe(true);
  });

  it("maps waiting-for-trigger to WATCH_ONLY", async () => {
    const deriveStageStatus = await load();
    expect(
      deriveStageStatus(base({ gates: { entry: { watchOnly: true } } })).status,
    ).toBe("WATCH_ONLY");
  });

  it("maps an un-reviewable hard block to REJECTED (not stored)", async () => {
    const deriveStageStatus = await load();
    const d = deriveStageStatus(base({}));
    expect(d.status).toBe("REJECTED");
    expect(d.stageable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Static source-code guards (Cases 19/20) — no DB, filesystem reads only.
// ---------------------------------------------------------------------------

describe("Phase-2 static safety guards", () => {
  const swingSourceFiles = (): string[] =>
    readdirSync(__dirname)
      .filter((f) => f.startsWith("swing") && f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => join(__dirname, f));

  // Strip block + line comments so cautionary docs (e.g. "NEVER drizzle-kit
  // push") are not mistaken for destructive CODE.
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  // Case 19 -----------------------------------------------------------------
  it("Case 19: no destructive schema change in Phase-2 sources", () => {
    const schemaPath = join(
      __dirname,
      "../../../../lib/db/src/schema/swingOrderStaging.ts",
    );
    const files = [...swingSourceFiles()];
    if (existsSync(schemaPath)) files.push(schemaPath);

    const destructive = [
      /\bDROP\s+TABLE\b/i,
      /\bDROP\s+COLUMN\b/i,
      /\bALTER\s+TABLE\b[\s\S]*\bDROP\b/i,
      /\bTRUNCATE\b/i,
      /drizzle-kit\s+push/i,
    ];
    for (const f of files) {
      const src = stripComments(readFileSync(f, "utf8"));
      for (const re of destructive) {
        expect(re.test(src), `${f} must not contain executable ${re}`).toBe(false);
      }
    }
    // The migration approach is additive: non-destructive CREATE TABLE.
    if (existsSync(schemaPath)) {
      expect(readFileSync(schemaPath, "utf8")).toContain("pgTable");
    }
  });

  // Case 20 -----------------------------------------------------------------
  it("Case 20: no F&O / option-chain / paper-trade / capital-ledger imports", () => {
    const forbidden = [
      /optionSignals/i,
      /optionChain/i,
      /\boiLab/i,
      /fnoPaper/i,
      /fnoCost/i,
      /fnoSignal/i,
      /paperAccount/i,
      /paperTrade/i,
      /capitalLedger/i,
      /kiteOptionChain/i,
      /kiteFno/i,
      /kiteIndexQuotes/i,
    ];
    const importRe = /(?:from|import)\s*["']([^"']+)["']/g;
    for (const f of swingSourceFiles()) {
      const src = readFileSync(f, "utf8");
      let m: RegExpExecArray | null;
      while ((m = importRe.exec(src)) !== null) {
        const source = m[1];
        for (const re of forbidden) {
          expect(re.test(source), `${f} imports forbidden module ${source}`).toBe(false);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Case 26: static wiring check — swingOrderStaging.ts calls
// openPaperEquityTradeFromStagedOrder.
// ---------------------------------------------------------------------------

describe("swingOrderStaging wiring (static source check)", () => {
  it("Case 26: swingOrderStaging.ts imports and calls openPaperEquityTradeFromStagedOrder", () => {
    const stagingFile = join(__dirname, "swingOrderStaging.ts");
    if (!existsSync(stagingFile)) return;
    const src = readFileSync(stagingFile, "utf8");
    expect(src).toMatch(
      /import.*openPaperEquityTradeFromStagedOrder.*from\s*["']\.\/paperTradingEq["']/,
    );
    expect(src).toMatch(/openPaperEquityTradeFromStagedOrder\s*\(/);
    // Null-safe result is used to derive opened boolean (never assumed truthy without check)
    expect(src).toMatch(/ptRow\s*!=\s*null|ptRow\s*!==\s*null/);
  });
});
