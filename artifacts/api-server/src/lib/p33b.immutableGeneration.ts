/**
 * Gate 8 — IMMUTABLE GENERATION RUNTIME EVIDENCE SCRIPT
 *
 * Proves that the displayed generation ID and row count are IMMUTABLE under failure:
 *   1. Establish a "last good" cache generation (generationId G0, rows=N).
 *   2. Trigger a scan that fails because rows=0 (the `rows.length > 0` guard fires).
 *   3. Confirm the displayed generation remains G0 (not replaced by the failed scan).
 *   4. Confirm row count remains N (not replaced by 0).
 *   5. Trigger a scan with reconciliation failure (allValid=false).
 *   6. Confirm the displayed generation still remains G0.
 *   7. Trigger a valid scan (G3) and confirm it DOES replace G0.
 *
 * Uses the fullNseScanner test hooks:
 *   - _setTestScanResultFactory() to inject a controlled scan result
 *   - _resetTestHooks() to start from a clean state
 *   - scanFullNse({ force: true }) to trigger the scan
 *
 * RUN: tsx src/lib/p33b.immutableGeneration.ts   (from artifacts/api-server)
 */

import {
  scanFullNse,
  _setTestScanResultFactory,
  _resetTestHooks,
  type ScanCountReconciliation,
} from "./fullNseScanner.js";

const GATE = "G8-IMMUTABLE-GENERATION";

type ScanCache = Awaited<ReturnType<typeof scanFullNse>>;

/** Build a minimal scan cache with the given generationId and row count. */
function buildMinimalCache(generationId: string, rowCount: number): ScanCache {
  const now = Date.now();
  const allValid = rowCount > 0;

  const reconciliation: ScanCountReconciliation = {
    rawKiteNseInstrumentCount: rowCount,
    kiteInstrumentTypeEqCount: rowCount,
    rawKiteMaster: rowCount,
    debtGovernmentSecurities: 0,
    sovereignGoldBonds: 0,
    etfOrFund: 0,
    smePolicyExclusions: 0,
    t2tPolicyExclusions: 0,
    inactiveOrDelisted: 0,
    otherUnsupported: 0,
    unresolvedSecurityType: 0,
    indexInstruments: 0,
    unknownClass: 0,
    eligibleOrdinaryEquities: rowCount,
    provisionallyClassifiedCount: 0,
    authoritativelyVerifiedOrdinaryEquityCount: rowCount,
    unresolvedSecurityCount: 0,
    excludedSecurityCount: 0,
    kiteQuoteRows: rowCount,
    yahooChartRows: 0,
    yahooBatchRows: 0,
    liveQuoteRows: rowCount,
    noQuoteRows: 0,
    evaluatedRows: rowCount,
    notEvaluatedRows: 0,
    apiRowCount: rowCount,
    timingMs: {
      instrumentMaster: 10,
      eligibilityFilter: 10,
      kiteQuoteFetch: 300,
      yahooBatchFetch: 0,
      deliveryMapFetch: 0,
      enrichmentPhase: 100,
      rowAssembly: 50,
      heatmapOverlay: 0,
      total: 500,
    },
    step1Valid: allValid,
    step2Valid: allValid,
    step3Valid: true,
    allValid,
  };

  return {
    rows: Array.from({ length: rowCount }, (_, i) => ({
      symbol: `SYM${i}`,
      name: `Company ${i}`,
      recommendation: { score: 50, label: "NEUTRAL" },
      ltp: 100,
      changePercent: 0,
      volume: 1_000_000,
      marketCap: null,
      sector: null,
      provenance: { source: "kite", quality: "authoritative" },
      meta: {},
    } as unknown as ScanCache["rows"][number])),
    lastUpdated: now,
    sourceDate: new Date().toISOString().slice(0, 10),
    total: rowCount,
    scanMs: 500,
    failures: 0,
    liveQuoteCount: rowCount,
    rested: 0,
    enriched: 0,
    degraded: false,
    kiteOffline: false,
    eligibilityBreakdown: { ORDINARY_COMPANY_EQUITY_ELIGIBLE: rowCount } as ScanCache["eligibilityBreakdown"],
    phaseA: true,
    generationId,
    countReconciliation: reconciliation,
  };
}

async function runImmutableGenerationTest(): Promise<void> {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${GATE}: Immutable generation proof under scan failure`);
  console.log(`${"=".repeat(70)}\n`);

  let passed = 0;
  let failed = 0;

  function check(label: string, actual: unknown, expected: unknown): void {
    if (actual === expected) {
      console.log(`  ✔ ${label}: ${JSON.stringify(actual)}`);
      passed++;
    } else {
      console.error(`  ✘ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      failed++;
    }
  }

  // ── Step 1: Reset and establish G0 (last-good generation) ─────────────────
  console.log("Step 1: Reset scanner and establish G0 (last-good generation)...");
  _resetTestHooks();

  const G0_ID = "G0-TEST-IMMUTABLE-GENERATION";
  const G0_ROWS = 42;

  _setTestScanResultFactory(async (_genId: string) => buildMinimalCache(G0_ID, G0_ROWS));
  const g0Cache = await scanFullNse({ force: true });

  check("G0 generationId", g0Cache.generationId, G0_ID);
  check("G0 rows.length", g0Cache.rows.length, G0_ROWS);
  check("G0 total", g0Cache.total, G0_ROWS);
  check("G0 countReconciliation.allValid", g0Cache.countReconciliation.allValid, true);

  // ── Step 2: Trigger a scan with rows=0 (should NOT replace G0) ────────────
  console.log("\nStep 2: Trigger scan with rows=0 (should NOT replace G0)...");
  const G1_ID = "G1-TEST-FAILED-ZERO-ROWS";

  _setTestScanResultFactory(async (_genId: string) => buildMinimalCache(G1_ID, 0));
  const g1Cache = await scanFullNse({ force: true });

  // The scanner guard `if (next.rows.length > 0)` prevents publishing a zero-row result.
  check("After 0-row scan: generationId still G0", g1Cache.generationId, G0_ID);
  check("After 0-row scan: rows.length still G0 rows", g1Cache.rows.length, G0_ROWS);

  // ── Step 3: Trigger a scan with reconciliation failure ───────────────────
  console.log("\nStep 3: Trigger scan with reconciliation failure (allValid=false)...");
  const G2_ID = "G2-TEST-RECONCILIATION-FAIL";

  _setTestScanResultFactory(async (_genId: string) => {
    const c = buildMinimalCache(G2_ID, 10);
    // Force reconciliation to fail — the scanner gate `if (reconciliationFailed)` fires
    c.countReconciliation = {
      ...c.countReconciliation,
      allValid: false,
      step1Valid: false,
    };
    return c;
  });
  const g2Cache = await scanFullNse({ force: true });

  // Reconciliation failure prevents generation publish — G0 preserved.
  check("After reconciliation-fail: generationId still G0", g2Cache.generationId, G0_ID);
  check("After reconciliation-fail: rows.length still G0", g2Cache.rows.length, G0_ROWS);

  // ── Step 4: Valid scan DOES replace G0 (sanity check) ─────────────────────
  console.log("\nStep 4: Trigger valid scan → should replace G0 with G3...");
  const G3_ID = "G3-TEST-VALID-GENERATION";
  const G3_ROWS = 99;

  _setTestScanResultFactory(async (_genId: string) => buildMinimalCache(G3_ID, G3_ROWS));
  const g3Cache = await scanFullNse({ force: true });

  check("After valid scan: generationId is G3", g3Cache.generationId, G3_ID);
  check("After valid scan: rows.length is G3 rows", g3Cache.rows.length, G3_ROWS);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  _resetTestHooks();

  // ── Summary ───────────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${GATE} SUMMARY: ${passed}/${total} checks PASS, ${failed} FAIL`);

  if (failed > 0) {
    console.error(`${GATE}: VERDICT ✘ FAIL`);
    process.exit(1);
  }

  console.log(`${GATE}: VERDICT ✔ PASS`);
  console.log(`  Proven: 0-row scan result is NOT published (last-good generation preserved)`);
  console.log(`  Proven: reconciliation-fail scan result is NOT published`);
  console.log(`  Proven: valid scan IS published (generation advances correctly)`);
  console.log(`  Proven: generationId is immutable under scan/reconciliation failure`);
  console.log(`${"=".repeat(70)}\n`);
  process.exit(0);
}

runImmutableGenerationTest().catch((err) => {
  console.error(`${GATE}: Fatal error`, err);
  process.exit(1);
});
