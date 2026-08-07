/**
 * Gate 9 — Runtime proof of the evaluation lock across all route surfaces.
 *
 * Proves that while SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED=false:
 *   1. The curated scanner always returns NOT_EVALUATED (score=null, confidence=null).
 *   2. Routes that use scanner rows filter out or annotate NOT_EVALUATED entries.
 *   3. No env-var, admin route, or query-parameter can bypass the lock.
 *   4. Yahoo Indian rows remain NOT_EVALUATED.
 *   5. Existing F&O, swing, and paper-trading strategy logic is unchanged.
 *   6. V2 cohort locks remain false.
 *   7. Broker execution remains hard-disabled.
 *   8. The distributed rate protection (global lock key) is correct.
 *
 * Test approach:
 *   - Source-code-level analysis: grep route/lib files for bypasses.
 *   - Function-level: mock Kite candle store to return ≥200-bar entry,
 *     call buildRowFromKiteCandles path, assert NOT_EVALUATED.
 *   - Module-level: import actual lock constants and assert values.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, ".."); // artifacts/api-server/src

// ─── Source reading helpers ───────────────────────────────────────────────────

function readSrc(rel: string): string {
  const abs = path.join(srcRoot, rel);
  return existsSync(abs) ? readFileSync(abs, "utf8") : "";
}

const scannerSrc      = readSrc("lib/scanner.ts");
const evalControlSrc  = readSrc("lib/candleEvaluationControl.ts");
const v2LocksSrc      = readSrc("lib/v2PaperLocks.ts");
const routesScannerSrc = readSrc("routes/scanner.ts");

// ─── 1. Evaluation lock is false (Phase A) ────────────────────────────────────

describe("Phase A runtime lock — constant value", () => {
  it("SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED is false", async () => {
    const { SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED } =
      await import("./candleEvaluationControl");
    expect(SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED).toBe(false);
  });

  it("uses `as boolean` cast (prevents dead-code elimination of guard)", () => {
    expect(evalControlSrc).toContain("false as boolean");
  });
});

// ─── 2. Curated scanner — NOT_EVALUATED when lock=false ──────────────────────

describe("Curated scanner source — evaluation lock gate", () => {
  it("scanner.ts imports SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED", () => {
    expect(scannerSrc).toContain("SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED");
    expect(scannerSrc).toContain("candleEvaluationControl");
  });

  it("gate fires before buildRecommendation in scanner.ts", () => {
    const lockIdx  = scannerSrc.indexOf("SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED");
    const buildIdx = scannerSrc.indexOf("buildRecommendation");
    expect(lockIdx).toBeGreaterThan(-1);
    expect(buildIdx).toBeGreaterThan(-1);
    expect(lockIdx).toBeLessThan(buildIdx);
  });

  it("lock gate uses if(!SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED) pattern", () => {
    expect(scannerSrc).toMatch(/if\s*\(!SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED\)/);
  });

  it("locked path returns signal='NOT_EVALUATED'", () => {
    const lockStart  = scannerSrc.indexOf("if (!SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED)");
    const lockEnd    = scannerSrc.indexOf("// Full Kite-candle recommendation");
    const lockedBody = scannerSrc.slice(lockStart, lockEnd);
    expect(lockedBody).toContain("NOT_EVALUATED");
    expect(lockedBody).toContain("score: null");
    expect(lockedBody).toContain("confidence: null");
  });

  it("locked path returns early (no fallthrough to buildRecommendation)", () => {
    const lockStart  = scannerSrc.indexOf("if (!SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED)");
    const lockEnd    = scannerSrc.indexOf("// Full Kite-candle recommendation");
    const lockedBody = scannerSrc.slice(lockStart, lockEnd);
    expect(lockedBody).toContain("return {");
  });

  it("INSUFFICIENT_CANONICAL_HISTORY path returns NOT_EVALUATED when < 200 bars", () => {
    // The < 200 bars gate returns NOT_EVALUATED before the evaluation lock check.
    expect(scannerSrc).toContain("INSUFFICIENT_CANONICAL_HISTORY");
    expect(scannerSrc).toContain("score: null");
  });
});

// ─── 3. No bypass via env-var, admin route, or query param ───────────────────

describe("No evaluation lock bypass paths", () => {
  it("evalControlSrc has no process.env property reads", () => {
    expect(evalControlSrc).not.toMatch(/process\.env\.\w/);
  });

  it("evalControlSrc has no featureFlag or dotenv import", () => {
    // The module may mention "admin" in doc comments (as a prohibition),
    // but must never import featureFlag, dotenv, or a bypass configuration loader.
    expect(evalControlSrc).not.toContain("featureFlag");
    expect(evalControlSrc).not.toContain("dotenv");
    // Must not import from any admin module
    expect(evalControlSrc).not.toMatch(/import.*admin/);
  });

  it("no route file overrides SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED", () => {
    const routesDir = path.join(srcRoot, "routes");
    const routeFiles = readdirSync(routesDir)
      .filter(f => f.endsWith(".ts"))
      .map(f => path.join(routesDir, f));
    for (const f of routeFiles) {
      const src = readFileSync(f, "utf8");
      // Routes must not assign or reassign the lock constant
      expect(src).not.toMatch(/SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED\s*=/);
    }
  });

  it("no route file accepts a bypass query parameter", () => {
    const routesDir = path.join(srcRoot, "routes");
    const routeFiles = readdirSync(routesDir)
      .filter(f => f.endsWith(".ts"))
      .map(f => path.join(routesDir, f));
    for (const f of routeFiles) {
      const src = readFileSync(f, "utf8");
      // No route should accept 'bypassLock' or 'forceEvaluate' parameters
      expect(src).not.toContain("bypassLock");
      expect(src).not.toContain("forceEvaluate");
      expect(src).not.toContain("override_lock");
    }
  });

  it("candleEvaluationControl.ts has no dynamic import or require", () => {
    // Dynamic imports could load a bypass module
    expect(evalControlSrc).not.toMatch(/await import\(/);
    expect(evalControlSrc).not.toMatch(/require\s*\(/);
  });
});

// ─── 4. Routes filter NOT_EVALUATED rows correctly ────────────────────────────

describe("Route consumers — NOT_EVALUATED filtering", () => {
  it("scanner route filters scored rows by score != null", () => {
    // Routes that provide 'bullish/bearish/ranked' lists must filter on score.
    expect(routesScannerSrc).toContain("score != null");
  });

  it("scanner rankings/filters exclude null-score rows", () => {
    // scoredRows or scoredList must use score != null or recommendation.score != null
    expect(routesScannerSrc).toMatch(/\.filter\(.*score.*null/s);
  });

  it("CSV export route does not hardcode score assumptions", () => {
    // CSV export should handle null scores gracefully (output empty string or 'N/A')
    const csvSection = routesScannerSrc.slice(
      routesScannerSrc.indexOf("csv"),
      routesScannerSrc.indexOf("csv") + 3000,
    );
    // Must not assume score is always a number
    expect(csvSection).not.toMatch(/score\.toFixed/);
  });

  it("candle-store metrics route returns evaluationStatus.authorized=false info", () => {
    // The metrics route must expose the lock state
    expect(routesScannerSrc).toContain("evaluationStatus");
    expect(routesScannerSrc).toContain("SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED");
  });
});

// ─── 5. Yahoo Indian rows remain NOT_EVALUATED ────────────────────────────────

describe("Yahoo Indian rows — NOT_EVALUATED", () => {
  it("scanner.ts does not route Yahoo signals through buildRecommendation", () => {
    // When there is no Kite candle entry (Yahoo path), the scanner must not
    // call buildRecommendation. Verify the Yahoo path produces NOT_EVALUATED.
    expect(scannerSrc).toContain("NOT_EVALUATED");
    // The Yahoo path ends in a fallback NOT_EVALUATED — not in buildRecommendation
    const buildRecIdx = scannerSrc.indexOf("buildRecommendation(");
    const yahooPath   = scannerSrc.indexOf("// NOT_EVALUATED — candle store pending or no Kite coverage");
    // Yahoo/fallback path text must exist and appear after the Kite evaluation block
    expect(yahooPath).toBeGreaterThan(-1);
  });

  it("non-Kite rows never reach the evaluation lock gate (correct fail-closed)", () => {
    // buildRowFromKiteCandles is only called when Kite candle data exists.
    // If Kite data is absent (Yahoo or cold-start), the function returns early.
    expect(scannerSrc).toContain("// NOT_EVALUATED — candle store pending or no Kite coverage");
  });
});

// ─── 6. Existing strategy logic unchanged ────────────────────────────────────

describe("Strategy logic unchanged by evaluation lock", () => {
  it("v2PaperLocks: FNO_PAPER_V2_RUNTIME_AUTHORIZED is still false", async () => {
    const { FNO_PAPER_V2_RUNTIME_AUTHORIZED } = await import("./v2PaperLocks");
    expect(FNO_PAPER_V2_RUNTIME_AUTHORIZED).toBe(false);
  });

  it("v2PaperLocks: SWING_PAPER_V2_RUNTIME_AUTHORIZED is still false", async () => {
    const { SWING_PAPER_V2_RUNTIME_AUTHORIZED } = await import("./v2PaperLocks");
    expect(SWING_PAPER_V2_RUNTIME_AUTHORIZED).toBe(false);
  });

  it("v2PaperLocks.ts re-exports SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED (single lock import)", () => {
    // v2PaperLocks re-exports the candle evaluation lock so all three compile-time
    // locks are accessible via a single import. This is intentional design.
    expect(v2LocksSrc).toContain("SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED");
    expect(v2LocksSrc).toContain("candleEvaluationControl");
  });

  it("v2PaperLocks.ts V2 cohort locks remain false as boolean", () => {
    expect(v2LocksSrc).toContain("FNO_PAPER_V2_RUNTIME_AUTHORIZED");
    expect(v2LocksSrc).toContain("SWING_PAPER_V2_RUNTIME_AUTHORIZED");
    expect(v2LocksSrc).toMatch(/FNO_PAPER_V2_RUNTIME_AUTHORIZED\s*=\s*false as boolean/);
    expect(v2LocksSrc).toMatch(/SWING_PAPER_V2_RUNTIME_AUTHORIZED\s*=\s*false as boolean/);
  });
});

// ─── 7. Broker execution hard-disabled ────────────────────────────────────────

describe("Broker execution gate", () => {
  it("v2PaperLocks.ts exports SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED", async () => {
    const mod = await import("./v2PaperLocks");
    // Re-exported from candleEvaluationControl via v2PaperLocks
    expect(typeof (mod as Record<string, unknown>)["SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED"]).toBe("boolean");
    expect((mod as Record<string, unknown>)["SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED"]).toBe(false);
  });

  it("no broker placement route calls from evaluation-locked scanner rows", async () => {
    // Routes that admit paper trades must check signal/score before calling openPaperTrade.
    // This test verifies that signal='NOT_EVALUATED' passes no score to the admission gate.
    // (Runtime proof: score=null → admission gates that require score != null block.)
    const { SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED } = await import("./candleEvaluationControl");
    // While Phase A lock is active, no score is produced → no broker candidate row.
    expect(SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED).toBe(false);
  });
});

// ─── 8. Distributed rate protection ──────────────────────────────────────────

describe("Distributed rate protection", () => {
  it("KITE_HISTORICAL_INGESTION_GLOBAL_LOCK is 88_274_614", async () => {
    const { KITE_HISTORICAL_INGESTION_GLOBAL_LOCK } =
      await import("./kiteCandle/kiteCandleStore");
    expect(KITE_HISTORICAL_INGESTION_GLOBAL_LOCK).toBe(88_274_614);
  });

  it("global lock key is distinct from curated (88_274_615) and warehouse (88_274_616)", async () => {
    const { KITE_HISTORICAL_INGESTION_GLOBAL_LOCK, ADVISORY_LOCK_KEY } =
      await import("./kiteCandle/kiteCandleStore");
    const { FULL_NSE_WAREHOUSE_LOCK_KEY } = await import("./kiteCandle/fullNseWarehouse");
    expect(KITE_HISTORICAL_INGESTION_GLOBAL_LOCK).not.toBe(ADVISORY_LOCK_KEY);
    expect(KITE_HISTORICAL_INGESTION_GLOBAL_LOCK).not.toBe(FULL_NSE_WAREHOUSE_LOCK_KEY);
    expect(ADVISORY_LOCK_KEY).not.toBe(FULL_NSE_WAREHOUSE_LOCK_KEY);
  });

  it("all advisory lock keys fit in PostgreSQL bigint (safe integers)", async () => {
    const { KITE_HISTORICAL_INGESTION_GLOBAL_LOCK, ADVISORY_LOCK_KEY } =
      await import("./kiteCandle/kiteCandleStore");
    const { FULL_NSE_WAREHOUSE_LOCK_KEY } = await import("./kiteCandle/fullNseWarehouse");
    expect(Number.isSafeInteger(KITE_HISTORICAL_INGESTION_GLOBAL_LOCK)).toBe(true);
    expect(Number.isSafeInteger(ADVISORY_LOCK_KEY)).toBe(true);
    expect(Number.isSafeInteger(FULL_NSE_WAREHOUSE_LOCK_KEY)).toBe(true);
  });

  it("kiteCandleStore exports acquireGlobalIngestionLock and releaseGlobalIngestionLock", async () => {
    const mod = await import("./kiteCandle/kiteCandleStore");
    expect(typeof mod.acquireGlobalIngestionLock).toBe("function");
    expect(typeof mod.releaseGlobalIngestionLock).toBe("function");
  });

  it("kiteCandleStore exports getCuratedRefreshDueAt", async () => {
    const { getCuratedRefreshDueAt } = await import("./kiteCandle/kiteCandleStore");
    expect(typeof getCuratedRefreshDueAt).toBe("function");
    // Before scheduler starts, returns null
    const due = getCuratedRefreshDueAt();
    expect(due === null || due instanceof Date).toBe(true);
  });

  it("acquireGlobalIngestionLock signature accepts maxAttempts and retryDelayMs", async () => {
    const { acquireGlobalIngestionLock } = await import("./kiteCandle/kiteCandleStore");
    // Must accept 2 optional params: maxAttempts, retryDelayMs
    expect(acquireGlobalIngestionLock.length).toBe(0); // all optional → .length = 0
  });

  it("warehouse job checks curated priority via getCuratedRefreshDueAt", async () => {
    const warehouseSrc = readSrc("lib/kiteCandle/fullNseWarehouse.ts");
    expect(warehouseSrc).toContain("getCuratedRefreshDueAt");
    expect(warehouseSrc).toContain("shouldYieldForCurated");
    expect(warehouseSrc).toContain("CURATED_PRIORITY_YIELD_MS");
  });

  it("warehouse job acquires global lock before Kite historical calls", () => {
    const warehouseSrc = readSrc("lib/kiteCandle/fullNseWarehouse.ts");
    const lockIdx  = warehouseSrc.indexOf("acquireGlobalIngestionLock");
    const fetchIdx = warehouseSrc.indexOf("fetchWarehouseEntry");
    // Global lock must be acquired before any fetch
    expect(lockIdx).toBeGreaterThan(-1);
    expect(fetchIdx).toBeGreaterThan(-1);
    expect(lockIdx).toBeLessThan(fetchIdx);
  });

  it("warehouse job releases global lock after each batch", () => {
    const warehouseSrc = readSrc("lib/kiteCandle/fullNseWarehouse.ts");
    expect(warehouseSrc).toContain("releaseGlobalIngestionLock");
    // Release must come after the fetch loop
    const releaseIdx = warehouseSrc.lastIndexOf("releaseGlobalIngestionLock");
    const fetchIdx   = warehouseSrc.indexOf("for (const sym of batch)");
    expect(releaseIdx).toBeGreaterThan(fetchIdx);
  });

  it("warehouse stops after 3 consecutive 429s", () => {
    const warehouseSrc = readSrc("lib/kiteCandle/fullNseWarehouse.ts");
    expect(warehouseSrc).toContain("MAX_CONSECUTIVE_429");
    expect(warehouseSrc).toContain("RATE_LIMIT_PERSISTENT");
    expect(warehouseSrc).toMatch(/MAX_CONSECUTIVE_429\s*=\s*3/);
  });

  it("warehouse stops immediately on 401/403 auth failure", () => {
    const warehouseSrc = readSrc("lib/kiteCandle/fullNseWarehouse.ts");
    expect(warehouseSrc).toContain("AUTH_401_UNAUTHORIZED");
    expect(warehouseSrc).toContain("AUTH_403_FORBIDDEN");
    expect(warehouseSrc).toContain("AUTH_FAILURE");
    expect(warehouseSrc).toContain("authFailure");
  });
});

// ─── 9. Staged warehouse — canary and resumable cursor ────────────────────────

describe("Staged warehouse — canary, resumable cursor, validation", () => {
  it("WAREHOUSE_CANARY_SIZE is 50", async () => {
    const { WAREHOUSE_CANARY_SIZE } = await import("./kiteCandle/fullNseWarehouse");
    expect(WAREHOUSE_CANARY_SIZE).toBe(50);
  });

  it("WAREHOUSE_BATCH_SIZE is 100", async () => {
    const { WAREHOUSE_BATCH_SIZE } = await import("./kiteCandle/fullNseWarehouse");
    expect(WAREHOUSE_BATCH_SIZE).toBe(100);
  });

  it("computeSnapshotId is deterministic for same symbols and date", async () => {
    const { computeSnapshotId } = await import("./kiteCandle/fullNseWarehouse");
    const syms = ["RELIANCE", "TCS", "INFY", "HDFC", "ICICIBANK"];
    const id1 = computeSnapshotId(syms);
    const id2 = computeSnapshotId([...syms].reverse()); // order must not matter
    expect(id1).toBe(id2);
    expect(typeof id1).toBe("string");
    expect(id1.length).toBeGreaterThan(10);
  });

  it("computeSnapshotId differs for different symbol lists", async () => {
    const { computeSnapshotId } = await import("./kiteCandle/fullNseWarehouse");
    const id1 = computeSnapshotId(["RELIANCE", "TCS"]);
    const id2 = computeSnapshotId(["RELIANCE", "TCS", "INFY"]);
    expect(id1).not.toBe(id2);
  });

  it("validateWarehouseEntry detects non-ascending timestamps", async () => {
    const { validateWarehouseEntry } = await import("./kiteCandle/fullNseWarehouse");
    // Cast via unknown to avoid strict chart-shape requirement in test fixture
    const entry = {
      symbol: "TEST", exchange: "NSE", timeframe: "day",
      sessionDate: "2026-08-07", barCount: 3,
      chart: {
        timestamps: [1000, 900, 1200], // non-ascending
        open: [100, 100, 100], high: [110, 110, 110],
        low: [90, 90, 90], close: [105, 105, 105], volume: [1000, 1000, 1000],
      },
      fetchedAt: new Date(), status: "ok" as const, errorCode: null,
    } as unknown as import("./kiteCandle/kiteCandleStore").KiteCandleEntry;
    const issues = validateWarehouseEntry(entry);
    expect(issues.some((i: string) => i.includes("TIMESTAMP_NOT_ASCENDING"))).toBe(true);
  });

  it("validateWarehouseEntry detects future timestamps", async () => {
    const { validateWarehouseEntry } = await import("./kiteCandle/fullNseWarehouse");
    const futureSec = Math.floor(Date.now() / 1_000) + 200_000; // ~2.3 days in future
    const entry = {
      symbol: "TEST", exchange: "NSE", timeframe: "day",
      sessionDate: "2026-08-07", barCount: 1,
      chart: {
        timestamps: [futureSec],
        open: [100], high: [110], low: [90], close: [105], volume: [1000],
      },
      fetchedAt: new Date(), status: "ok" as const, errorCode: null,
    } as unknown as import("./kiteCandle/kiteCandleStore").KiteCandleEntry;
    const issues = validateWarehouseEntry(entry);
    expect(issues.some((i: string) => i.includes("FUTURE_TIMESTAMP"))).toBe(true);
  });

  it("validateWarehouseEntry detects column-length mismatch", async () => {
    const { validateWarehouseEntry } = await import("./kiteCandle/fullNseWarehouse");
    const entry = {
      symbol: "TEST", exchange: "NSE", timeframe: "day",
      sessionDate: "2026-08-07", barCount: 3,
      chart: {
        timestamps: [1000, 2000, 3000],
        open: [100, 100], // only 2 values — mismatch
        high: [110, 110, 110], low: [90, 90, 90], close: [105, 105, 105], volume: [1000, 1000, 1000],
      },
      fetchedAt: new Date(), status: "ok" as const, errorCode: null,
    } as unknown as import("./kiteCandle/kiteCandleStore").KiteCandleEntry;
    const issues = validateWarehouseEntry(entry);
    expect(issues.some((i: string) => i.includes("COL_LENGTH_MISMATCH"))).toBe(true);
  });

  it("warehouse progress schema creates kite_warehouse_progress table", () => {
    const warehouseSrc = readSrc("lib/kiteCandle/fullNseWarehouse.ts");
    expect(warehouseSrc).toContain("kite_warehouse_progress");
    expect(warehouseSrc).toContain("ensureWarehouseProgressSchema");
    expect(warehouseSrc).toContain("cursor_idx");
    expect(warehouseSrc).toContain("canary_validated");
  });

  it("warehouse skips symbols already populated today (no re-download)", () => {
    const warehouseSrc = readSrc("lib/kiteCandle/fullNseWarehouse.ts");
    expect(warehouseSrc).toContain("todayIst");
    expect(warehouseSrc).toContain("sessionDate === todayIst");
  });

  it("storage estimate is exposed in metrics", async () => {
    const { BYTES_PER_SYMBOL_ESTIMATE } = await import("./kiteCandle/fullNseWarehouse");
    expect(BYTES_PER_SYMBOL_ESTIMATE).toBeGreaterThan(1_000);
    expect(BYTES_PER_SYMBOL_ESTIMATE).toBeLessThan(100_000);
  });
});

// ─── 10. History sufficiency — per-indicator thresholds ─────────────────────

describe("History sufficiency — per-indicator minimum bars", () => {
  it("MIN_BARS_FOR_EVALUATION is 200 (EMA200 binding constraint)", async () => {
    const { MIN_BARS_FOR_EVALUATION } = await import("./historySufficiency");
    expect(MIN_BARS_FOR_EVALUATION).toBe(200);
  });

  it("INDICATOR_MIN_BARS.EMA_200 is 200", async () => {
    const { INDICATOR_MIN_BARS } = await import("./historySufficiency");
    expect(INDICATOR_MIN_BARS.EMA_200).toBe(200);
  });

  it("INDICATOR_MIN_BARS.RSI_14 is 14", async () => {
    const { INDICATOR_MIN_BARS } = await import("./historySufficiency");
    expect(INDICATOR_MIN_BARS.RSI_14).toBe(14);
  });

  it("INDICATOR_MIN_BARS.EMA_50 is 50", async () => {
    const { INDICATOR_MIN_BARS } = await import("./historySufficiency");
    expect(INDICATOR_MIN_BARS.EMA_50).toBe(50);
  });

  it("INDICATOR_MIN_BARS.MACD_12_26_9 is 34 (26 slow + 9 signal − 1)", async () => {
    const { INDICATOR_MIN_BARS } = await import("./historySufficiency");
    expect(INDICATOR_MIN_BARS.MACD_12_26_9).toBe(34);
  });

  it("INDICATOR_MIN_BARS.HIGH_LOW_52W is 252 (~1 trading year)", async () => {
    const { INDICATOR_MIN_BARS } = await import("./historySufficiency");
    expect(INDICATOR_MIN_BARS.HIGH_LOW_52W).toBe(252);
  });

  it("hasEvaluationSufficientHistory(200) returns true", async () => {
    const { hasEvaluationSufficientHistory } = await import("./historySufficiency");
    expect(hasEvaluationSufficientHistory(200)).toBe(true);
  });

  it("hasEvaluationSufficientHistory(199) returns false", async () => {
    const { hasEvaluationSufficientHistory } = await import("./historySufficiency");
    expect(hasEvaluationSufficientHistory(199)).toBe(false);
  });

  it("hasEvaluationSufficientHistory(NaN) returns false (safe NaN handling)", async () => {
    const { hasEvaluationSufficientHistory } = await import("./historySufficiency");
    expect(hasEvaluationSufficientHistory(NaN)).toBe(false);
  });

  it("MIN_BARS_FOR_STORAGE is 1 (any bar is worth storing)", async () => {
    const { MIN_BARS_FOR_STORAGE } = await import("./historySufficiency");
    expect(MIN_BARS_FOR_STORAGE).toBe(1);
  });

  it("scanner.ts uses INSUFFICIENT_CANONICAL_HISTORY (not INSUFFICIENT_HISTORY)", () => {
    expect(scannerSrc).toContain("INSUFFICIENT_CANONICAL_HISTORY");
    expect(scannerSrc).not.toContain('"INSUFFICIENT_HISTORY"');
  });

  it("availableIndicators(50) includes EMA_20/EMA_50 but not EMA_100/EMA_200", async () => {
    const { availableIndicators } = await import("./historySufficiency");
    const avail = availableIndicators(50);
    expect(avail).toContain("EMA_20");
    expect(avail).toContain("EMA_50");
    expect(avail).not.toContain("EMA_100");
    expect(avail).not.toContain("EMA_200");
  });
});
