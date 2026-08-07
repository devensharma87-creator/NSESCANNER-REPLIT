/**
 * Gate 9 — Compile-time evaluation lock tests.
 *
 * Proves that SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED=false enforces:
 *   - constant is literally false (Phase A)
 *   - `as boolean` cast is present (no dead-code elimination)
 *   - no env-var or process.env path exists in the module
 *   - getCandleEvaluationStatus() reports Phase A / not authorized
 *   - stable error code PHASE_A_POPULATION_ONLY is exported
 *   - scanner.ts gates evaluation on this constant
 *
 * These tests MUST remain green in Phase A. If they turn red, it means
 * someone changed the constant without Phase B authorization.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED,
  CANDLE_EVALUATION_LOCKED_CODE,
  getCandleEvaluationStatus,
} from "./candleEvaluationControl";

const here = path.dirname(fileURLToPath(import.meta.url));
const controlSrc = readFileSync(path.join(here, "candleEvaluationControl.ts"), "utf8");
const scannerSrc = readFileSync(path.join(here, "scanner.ts"), "utf8");

// ─── Phase A lock value ──────────────────────────────────────────────────────

describe("Phase A compile-time lock — SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED", () => {
  it("is false (Phase A — do not change without Phase B authorization)", () => {
    // This test MUST remain green throughout Phase A.
    // If it fails, someone changed the constant without authorization — STOP.
    expect(SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED).toBe(false);
  });

  it("uses `as boolean` cast (prevents TypeScript dead-code elimination of guard)", () => {
    // The source must contain `false as boolean` — the cast prevents TS from narrowing
    // to literal `false` and eliminating the if(!SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED)
    // guard at compile time. Without the cast, the gate could be optimised away.
    expect(controlSrc).toContain("false as boolean");
  });

  it("contains no runtime process.env read — only documents the prohibition", () => {
    // The module may MENTION process.env in doc comments (as a prohibition), but must
    // never READ it. Check that no `process.env.` property access appears in code.
    // Regex: process.env.SOMETHING — a real read (not just "process.env" as doc text).
    expect(controlSrc).not.toMatch(/process\.env\.\w/);
    expect(controlSrc).not.toContain("env[");
    expect(controlSrc).not.toContain("getenv(");
  });

  it("contains no dotenv or feature-flag imports that could load a runtime value", () => {
    expect(controlSrc).not.toContain("dotenv");
    expect(controlSrc).not.toContain("featureFlag");
    // The module must not dynamically import a config loader.
    // Static doc comments about prohibition are fine.
    expect(controlSrc).not.toMatch(/import.*dotenv/);
  });
});

// ─── Phase A status helper ───────────────────────────────────────────────────

describe("getCandleEvaluationStatus()", () => {
  it("returns authorized=false in Phase A", () => {
    const status = getCandleEvaluationStatus();
    expect(status.authorized).toBe(false);
  });

  it("returns phase='A' when constant is false", () => {
    const status = getCandleEvaluationStatus();
    expect(status.phase).toBe("A");
  });

  it("returns a non-empty reason string", () => {
    const status = getCandleEvaluationStatus();
    expect(status.reason).toBeTruthy();
    expect(status.reason.length).toBeGreaterThan(20);
    expect(status.reason).toContain("SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED");
  });

  it("reason references Phase B authorization requirement", () => {
    const status = getCandleEvaluationStatus();
    expect(status.reason).toContain("Phase B");
  });
});

// ─── Stable error code ───────────────────────────────────────────────────────

describe("CANDLE_EVALUATION_LOCKED_CODE", () => {
  it("is PHASE_A_POPULATION_ONLY", () => {
    expect(CANDLE_EVALUATION_LOCKED_CODE).toBe("PHASE_A_POPULATION_ONLY");
  });

  it("is a const string (not an enum or symbol)", () => {
    expect(typeof CANDLE_EVALUATION_LOCKED_CODE).toBe("string");
  });

  it("appears in scanner.ts setupMessage (via constant reference) when the lock fires", () => {
    // The scanner uses `${CANDLE_EVALUATION_LOCKED_CODE}` in the template literal
    // setupMessage — the constant name is present; the literal string value is embedded
    // at runtime. Both the constant name and the import must be in the source.
    expect(scannerSrc).toContain("CANDLE_EVALUATION_LOCKED_CODE");
    // The import of the constant from candleEvaluationControl must be present.
    expect(scannerSrc).toContain("candleEvaluationControl");
    // The setupMessage template literal must reference the locked code constant.
    expect(scannerSrc).toMatch(/setupMessage.*CANDLE_EVALUATION_LOCKED_CODE/s);
  });
});

// ─── Scanner integration guard ───────────────────────────────────────────────

describe("scanner.ts lock gate integration", () => {
  it("imports SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED from candleEvaluationControl", () => {
    expect(scannerSrc).toContain("candleEvaluationControl");
    expect(scannerSrc).toContain("SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED");
  });

  it("uses the constant in an if-check before buildRecommendation", () => {
    // Must gate before buildRecommendation is called — ensures the full
    // indicator stack is computed (for display) but evaluation is blocked.
    const lockIdx = scannerSrc.indexOf("SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED");
    const buildRecIdx = scannerSrc.indexOf("buildRecommendation");
    expect(lockIdx).toBeGreaterThan(-1);
    expect(buildRecIdx).toBeGreaterThan(-1);
    // The lock check must appear before buildRecommendation in the file.
    expect(lockIdx).toBeLessThan(buildRecIdx);
  });

  it("lock gate is an if(!...) pattern (not an assertion or env check)", () => {
    expect(scannerSrc).toMatch(/if\s*\(!SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED\)/);
  });

  it("lock gate returns signal='NOT_EVALUATED' with score=null", () => {
    // Verify the locked return path has the correct NOT_EVALUATED shape.
    const lockGateSection = scannerSrc.slice(
      scannerSrc.indexOf("if (!SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED)"),
      scannerSrc.indexOf("// Full Kite-candle recommendation"),
    );
    expect(lockGateSection).toContain("NOT_EVALUATED");
    expect(lockGateSection).toContain("score: null");
    expect(lockGateSection).toContain("confidence: null");
  });

  it("indicators are still computed even when lock is active (display-only mode)", () => {
    // When locked, the row must still have indicators: computed.indicators
    // (the store is populated; indicators are available for display).
    const lockGateSection = scannerSrc.slice(
      scannerSrc.indexOf("if (!SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED)"),
      scannerSrc.indexOf("// Full Kite-candle recommendation"),
    );
    // indicators must come from computed (not null/empty)
    expect(lockGateSection).toContain("computed.indicators");
  });

  it("buildRecommendation is NOT called when lock is false", () => {
    // The if(!SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED) block must return
    // early (before buildRecommendation). The test above confirms index order.
    // This test confirms the pattern has a return statement in the locked block.
    const lockGateSection = scannerSrc.slice(
      scannerSrc.indexOf("if (!SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED)"),
      scannerSrc.indexOf("// Full Kite-candle recommendation"),
    );
    expect(lockGateSection).toContain("return {");
  });
});

// ─── Advisory lock + V2 lock consistency ─────────────────────────────────────

describe("Lock consistency — evaluation lock is independent of V2 locks", () => {
  it("SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED is false (Phase A)", () => {
    expect(SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED).toBe(false);
  });

  it("v2PaperLocks.ts exports remain unaffected by this new lock", async () => {
    const { FNO_PAPER_V2_RUNTIME_AUTHORIZED, SWING_PAPER_V2_RUNTIME_AUTHORIZED } =
      await import("./v2PaperLocks");
    expect(FNO_PAPER_V2_RUNTIME_AUTHORIZED).toBe(false);
    expect(SWING_PAPER_V2_RUNTIME_AUTHORIZED).toBe(false);
  });
});

// ─── Full-NSE warehouse lock key ─────────────────────────────────────────────

describe("Warehouse advisory lock key", () => {
  it("FULL_NSE_WAREHOUSE_LOCK_KEY is 88_274_616 (distinct from curated 88_274_615)", async () => {
    const { FULL_NSE_WAREHOUSE_LOCK_KEY } = await import("./kiteCandle/fullNseWarehouse");
    expect(FULL_NSE_WAREHOUSE_LOCK_KEY).toBe(88_274_616);
    // Must be distinct from the curated refresh key.
    const { ADVISORY_LOCK_KEY } = await import("./kiteCandle/kiteCandleStore");
    expect(FULL_NSE_WAREHOUSE_LOCK_KEY).not.toBe(ADVISORY_LOCK_KEY);
  });

  it("both lock keys are safe integers (fit in PostgreSQL bigint)", async () => {
    const { FULL_NSE_WAREHOUSE_LOCK_KEY } = await import("./kiteCandle/fullNseWarehouse");
    const { ADVISORY_LOCK_KEY } = await import("./kiteCandle/kiteCandleStore");
    expect(Number.isSafeInteger(FULL_NSE_WAREHOUSE_LOCK_KEY)).toBe(true);
    expect(Number.isSafeInteger(ADVISORY_LOCK_KEY)).toBe(true);
  });
});
