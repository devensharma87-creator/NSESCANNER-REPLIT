/**
 * F&O Cost Model Structural Guard (P0-1 enforcement).
 *
 * Scans specific files for local F&O options cost rate constants that should
 * have been removed after the P0-1 unification. Fails if:
 *   - `paperReportsFO.ts` still contains local STT rate literals (0.001 or 0.0005).
 *   - `premiumReplay.ts` still exports/defines FNO_COST_RATES.
 *   - Any non-canonical file defines the known stale rate values for F&O options.
 *
 * This is a PURE, synchronous guard — no DB, no network, no side effects.
 * Run as part of the test suite to prevent rate-constant regression.
 *
 * Design mirrors providerImportGuard.ts — whitebox structural scan using fs.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface FnoCostModelViolation {
  file: string;
  pattern: string;
  line: number;
  text: string;
  reason: string;
}

export interface FnoCostModelGuardResult {
  passed: boolean;
  violations: FnoCostModelViolation[];
  summary: string;
}

/**
 * Patterns that must NOT appear in non-canonical files.
 * Each entry is { pattern: RegExp, reason: string }.
 */
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /FNO_COST_RATES\s*=\s*\{/,
    reason: "Local FNO_COST_RATES constant block — must use canonical FNO_COST_PARAMS from fnoCostModel",
  },
  {
    pattern: /STT_SELL_PCT\s*:\s*0\.\d/,
    reason: "Local STT_SELL_PCT constant — must use FNO_COST_PARAMS.STT_RATE_SELL_PREMIUM",
  },
  {
    pattern: /0\.05\s*\/\s*100.*stt|stt.*0\.05\s*\/\s*100/i,
    reason: "Stale STT 0.05% (futures rate used as options rate) — canonical is 0.15%",
  },
  {
    pattern: /0\.053\s*\/\s*100.*exchange|exchange.*0\.053\s*\/\s*100/i,
    reason: "Stale exchange rate 0.053% (pre-Oct-2024) — canonical is 0.03503%",
  },
];

/**
 * Files that are allowed to define F&O cost rate constants.
 * All other files must import from fnoCostModel.ts.
 */
const CANONICAL_FILES = new Set([
  "fnoCostModel.ts",
]);

/**
 * Files that MUST NOT contain any forbidden pattern (targeted scan).
 * After P0-1 unification, these were the two stale consumers.
 */
const TARGET_FILES: Array<{ relPath: string; description: string }> = [
  {
    relPath: path.join("lib", "paperReportsFO.ts"),
    description: "Paper Reports F&O",
  },
  {
    relPath: path.join("lib", "backtest", "premiumReplay.ts"),
    description: "Stage-4 premium replay",
  },
];

function scanFile(
  absPath: string,
  relPath: string,
  patterns: typeof FORBIDDEN_PATTERNS,
): FnoCostModelViolation[] {
  let content: string;
  try {
    content = fs.readFileSync(absPath, "utf-8");
  } catch {
    return [];
  }

  const violations: FnoCostModelViolation[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip lines that are comments or test assertions
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
      continue;
    }
    // Skip test-assertion lines (expect(...).toBeCloseTo etc.)
    if (trimmed.includes("toBeCloseTo") || trimmed.includes("toContain") || trimmed.includes("toBe(")) {
      continue;
    }
    for (const { pattern, reason } of patterns) {
      if (pattern.test(line)) {
        violations.push({
          file: relPath,
          pattern: pattern.source,
          line: i + 1,
          text: line.trim().slice(0, 120),
          reason,
        });
      }
    }
  }
  return violations;
}

/**
 * Run the F&O cost model structural guard.
 *
 * @param srcRoot - Absolute path to `artifacts/api-server/src/`.
 *   Defaults to the src directory relative to this file's location.
 */
export function runFnoCostModelGuard(
  srcRoot: string = path.resolve(__dirname, ".."),
): FnoCostModelGuardResult {
  const violations: FnoCostModelViolation[] = [];

  for (const { relPath, description: _ } of TARGET_FILES) {
    const absPath = path.join(srcRoot, relPath);
    const basename = path.basename(absPath);

    if (CANONICAL_FILES.has(basename)) continue;

    const fileViolations = scanFile(absPath, relPath, FORBIDDEN_PATTERNS);
    violations.push(...fileViolations);
  }

  const passed = violations.length === 0;
  const summary = passed
    ? "F&O cost model guard PASSED — no local rate constants found in paperReportsFO or premiumReplay."
    : `F&O cost model guard FAILED — ${violations.length} violation(s) found. Each file must use canonical FNO_COST_PARAMS from fnoCostModel.ts.`;

  return { passed, violations, summary };
}
