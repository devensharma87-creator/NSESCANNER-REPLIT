import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  scanSource,
  scanProviderImports,
  flattenViolations,
  providerForSpecifier,
  isExemptFile,
  type ScanResult,
} from "./providerImportGuard";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, "..", ".."); // .../artifacts/api-server/src
const allowlistPath = path.join(here, "providerImportAllowlist.json");

describe("providerImportGuard — specifier resolution", () => {
  it("flags relative provider wrappers", () => {
    expect(providerForSpecifier("./yahoo")).toBe("yahoo");
    expect(providerForSpecifier("../lib/kiteIndexQuotes")).toBe("kiteIndexQuotes");
    expect(providerForSpecifier("./global/yahoo")).toBe("yahoo");
  });
  it("flags the npm yahoo package", () => {
    expect(providerForSpecifier("yahoo-finance2")).toBe("yahoo-finance2");
  });
  it("ignores non-provider and bare-package imports", () => {
    expect(providerForSpecifier("./logger")).toBeNull();
    expect(providerForSpecifier("drizzle-orm")).toBeNull();
    expect(providerForSpecifier("kiteAuth")).toBeNull(); // bare pkg, not relative
  });
});

describe("providerImportGuard — source scanning", () => {
  it("treats type-only imports as non-violations", () => {
    expect(scanSource(`import type { YahooChart } from "./yahoo";`)).toEqual([]);
  });
  it("flags mixed value+inline-type imports (runtime binding present)", () => {
    expect(
      scanSource(`import { fetchChart, type YahooChart } from "./yahoo";`),
    ).toEqual(["yahoo"]);
  });
  it("flags runtime + dynamic + re-export imports", () => {
    expect(scanSource(`import { feedStatus } from "./kiteFeed";`)).toEqual(["kiteFeed"]);
    expect(scanSource(`const m = await import("./kiteAuth");`)).toEqual(["kiteAuth"]);
    expect(scanSource(`export { x } from "./nseBhavcopy";`)).toEqual(["nseBhavcopy"]);
  });
  it("flags side-effect imports (no binding, no from)", () => {
    expect(scanSource(`import "./kiteFeed";`)).toEqual(["kiteFeed"]);
    expect(scanSource(`import '../lib/yahoo';`)).toEqual(["yahoo"]);
  });
  it("flags extension-suffixed specifiers", () => {
    expect(scanSource(`import { x } from "./yahoo.js";`)).toEqual(["yahoo"]);
    expect(providerForSpecifier("./kiteIntraday.ts")).toBe("kiteIntraday");
    expect(providerForSpecifier("../lib/kiteAuth.mjs")).toBe("kiteAuth");
  });
  it("de-dupes and sorts multiple providers in one file", () => {
    const src = `
      import { a } from "./kiteIntraday";
      import { b } from "./yahoo";
      import { c } from "./kiteIntraday";
    `;
    expect(scanSource(src)).toEqual(["kiteIntraday", "yahoo"]);
  });
});

describe("providerImportGuard — exemptions", () => {
  it("exempts the trusted layer, provider wrappers, and tests", () => {
    expect(isExemptFile("lib/marketData/router.ts")).toBe(true);
    expect(isExemptFile("lib/yahoo.ts")).toBe(true);
    expect(isExemptFile("lib/global/yahoo.ts")).toBe(true);
    expect(isExemptFile("lib/foo.test.ts")).toBe(true);
  });
  it("does NOT exempt ordinary consumers", () => {
    expect(isExemptFile("lib/watchlist.ts")).toBe(false);
    expect(isExemptFile("routes/scanner.ts")).toBe(false);
  });
});

describe("providerImportGuard — burn-down allowlist (regression guard)", () => {
  const current: ScanResult = scanProviderImports(srcRoot);

  // Seed/refresh the allowlist deliberately with UPDATE_IMPORT_ALLOWLIST=1.
  if (process.env.UPDATE_IMPORT_ALLOWLIST === "1") {
    const sorted: ScanResult = {};
    for (const k of Object.keys(current).sort()) sorted[k] = current[k]!;
    writeFileSync(allowlistPath, JSON.stringify(sorted, null, 2) + "\n");
  }

  it("has a committed allowlist", () => {
    expect(existsSync(allowlistPath)).toBe(true);
  });

  const allowlist: ScanResult = existsSync(allowlistPath)
    ? JSON.parse(readFileSync(allowlistPath, "utf8"))
    : {};
  const cur = flattenViolations(current);
  const allowed = flattenViolations(allowlist);

  it("has NO new direct-provider imports outside the allowlist (no regression)", () => {
    const added = [...cur].filter((x) => !allowed.has(x)).sort();
    expect(
      added,
      `New direct provider imports detected. Route them through the marketData layer ` +
        `(or, if intentional, run UPDATE_IMPORT_ALLOWLIST=1 to record them):\n${added.join("\n")}`,
    ).toEqual([]);
  });

  it("has no stale allowlist entries (forces burn-down)", () => {
    const removed = [...allowed].filter((x) => !cur.has(x)).sort();
    expect(
      removed,
      `These allowlisted imports are gone — shrink the allowlist by running ` +
        `UPDATE_IMPORT_ALLOWLIST=1:\n${removed.join("\n")}`,
    ).toEqual([]);
  });

  it("documents the remaining migration backlog", () => {
    // Informational: the count only ever goes down as consumers are migrated.
    expect(allowed.size).toBeGreaterThan(0);
  });
});
