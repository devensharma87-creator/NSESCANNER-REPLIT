/**
 * Provider-import regression guard (Task #124 Phase 1).
 *
 * Pure static scanner that finds every place a consumer imports a raw
 * market-data provider module DIRECTLY instead of going through the trusted
 * central layer (`marketData/`).
 *
 * It powers a burn-down / allowlist regression test: the CURRENT set of direct
 * imports is frozen into `providerImportAllowlist.json`. Any NEW direct import
 * in a non-allowlisted file fails the test (architecture cannot regress); any
 * allowlisted import that has been migrated away forces the list to shrink
 * (burn-down). The guard does NOT migrate consumers — it locks the boundary.
 *
 * Exemptions (legitimately allowed to touch providers):
 *   - the trusted layer itself (`lib/marketData/**`);
 *   - the provider wrapper modules themselves (a provider importing another
 *     provider is internal plumbing);
 *   - test files and `.d.ts` declarations.
 *
 * Type-only imports (`import type ... from "./yahoo"`) are NOT violations — they
 * carry no runtime data path.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** Relative provider wrapper modules (matched by file basename). */
export const PROVIDER_MODULES = [
  "yahoo",
  "kiteFeed",
  "kiteIntraday",
  "kiteScanner",
  "kiteOptionChain",
  "kiteIndexQuotes",
  "kiteAuth",
  "kiteFnoInstruments",
  "nseBhavcopy",
] as const;

/** npm packages that are raw providers and must only be used inside the layer. */
export const NPM_PROVIDER_PACKAGES = ["yahoo-finance2"] as const;

/** Directories (relative to the api-server `src` root) the guard scans. */
export const SCAN_ROOTS = ["lib", "routes"] as const;

const PROVIDER_SET = new Set<string>(PROVIDER_MODULES);
const NPM_SET = new Set<string>(NPM_PROVIDER_PACKAGES);

/** Strip a TS/JS module extension so `./yahoo.js` resolves like `./yahoo`. */
function stripModuleExt(base: string): string {
  return base.replace(/\.(?:m|c)?[jt]sx?$/, "");
}

/** Resolve an import specifier to the provider it points at, or null. */
export function providerForSpecifier(spec: string): string | null {
  if (NPM_SET.has(spec)) return spec;
  if (!spec.startsWith(".")) return null; // only our relative wrappers count
  const base = stripModuleExt(spec.split("/").pop() ?? spec);
  return PROVIDER_SET.has(base) ? base : null;
}

/** True for files exempt from the guard (the layer + provider wrappers + tests). */
export function isExemptFile(relPath: string): boolean {
  const norm = relPath.split(path.sep).join("/");
  if (norm.endsWith(".test.ts") || norm.endsWith(".d.ts")) return true;
  if (norm.startsWith("lib/marketData/")) return true; // the trusted layer
  const base = (norm.split("/").pop() ?? "").replace(/\.ts$/, "");
  if (PROVIDER_SET.has(base)) return true; // provider importing provider = plumbing
  return false;
}

// `import`/`export ... from "x"` — group1 is set for whole-statement type-only
// imports (no runtime binding); group2 is the specifier. Lazy body so each
// statement matches its own `from`.
const STATIC_IMPORT_RE =
  /(?:import|export)\s+(type\s+)?[\s\S]*?\s+from\s*["']([^"']+)["']/g;
// `import("x")` dynamic import.
const DYNAMIC_IMPORT_RE = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
// `import "x";` side-effect import (a quote directly after `import`, no binding
// list and no `from`). The negative class on the first char after the quote-open
// keeps this from matching the `import(` dynamic form.
const SIDE_EFFECT_IMPORT_RE = /import\s+["']([^"']+)["']/g;

/** Scan a single source string; return the sorted unique providers it imports. */
export function scanSource(source: string): string[] {
  const found = new Set<string>();
  for (const m of source.matchAll(STATIC_IMPORT_RE)) {
    if (m[1]) continue; // type-only — no runtime data path
    const p = providerForSpecifier(m[2] ?? "");
    if (p) found.add(p);
  }
  for (const m of source.matchAll(DYNAMIC_IMPORT_RE)) {
    const p = providerForSpecifier(m[1] ?? "");
    if (p) found.add(p);
  }
  for (const m of source.matchAll(SIDE_EFFECT_IMPORT_RE)) {
    const p = providerForSpecifier(m[1] ?? "");
    if (p) found.add(p);
  }
  return [...found].sort();
}

export type ScanResult = Record<string, string[]>;

function walkTsFiles(dir: string, acc: string[]): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkTsFiles(full, acc);
    else if (ent.isFile() && full.endsWith(".ts")) acc.push(full);
  }
  return acc;
}

/**
 * Scan the api-server `src` tree for direct provider imports.
 * @param srcRoot absolute path to `artifacts/api-server/src`.
 * @returns map of relPath → sorted providers (only files with ≥1 violation).
 */
export function scanProviderImports(srcRoot: string): ScanResult {
  const out: ScanResult = {};
  for (const root of SCAN_ROOTS) {
    const files = walkTsFiles(path.join(srcRoot, root), []);
    for (const file of files) {
      const rel = path.relative(srcRoot, file).split(path.sep).join("/");
      if (isExemptFile(rel)) continue;
      const providers = scanSource(readFileSync(file, "utf8"));
      if (providers.length > 0) out[rel] = providers;
    }
  }
  return out;
}

/** Flatten a scan result into a set of "relPath::provider" pairs. */
export function flattenViolations(result: ScanResult): Set<string> {
  const set = new Set<string>();
  for (const [file, providers] of Object.entries(result)) {
    for (const p of providers) set.add(`${file}::${p}`);
  }
  return set;
}
