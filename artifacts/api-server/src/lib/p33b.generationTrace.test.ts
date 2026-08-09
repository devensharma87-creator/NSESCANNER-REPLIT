/**
 * p33b.generationTrace.test.ts — Blocker 4: Actual runtime generation lifecycle.
 *
 * Uses the real scanFullNse() / getFullNseStatus() pipeline with a
 * deterministic test pause and a controlled scan-result factory injected via
 * exported test hooks.  No regex or source-level proofs here — every assertion
 * calls getFullNseStatus() on the live module state.
 *
 * Traces produced:
 *
 *   T-COLD: First cold scan (cache starts null)
 *     Before:  displayedGenerationId=null   inProgressGenerationId=null
 *     During:  displayedGenerationId=null   inProgressGenerationId=gen-A
 *     After:   displayedGenerationId=gen-A  inProgressGenerationId=null
 *
 *   T-WARM: Warm refresh (cache already has gen-A)
 *     Before:  displayedGenerationId=gen-A  inProgressGenerationId=null
 *     During:  displayedGenerationId=gen-A  inProgressGenerationId=gen-B
 *     After:   displayedGenerationId=gen-B  inProgressGenerationId=null
 *
 *   T-RECON-FAIL: Reconciliation failure preserves last-good generation
 *     Before:  displayedGenerationId=gen-B  inProgressGenerationId=null
 *     During:  displayedGenerationId=gen-B  inProgressGenerationId=gen-C
 *     After:   displayedGenerationId=gen-B  inProgressGenerationId=null  (gen-C NOT published)
 *
 *   T-PROV-FAIL: Provider failure (rows.length===0) preserves last-good generation
 *     Before:  displayedGenerationId=gen-B  inProgressGenerationId=null
 *     During:  displayedGenerationId=gen-B  inProgressGenerationId=gen-D
 *     After:   displayedGenerationId=gen-B  inProgressGenerationId=null  (gen-D NOT published)
 *
 *   T-ATOMIC: Concurrent status reads observe either complete gen-B or gen-C;
 *             never a partial state.
 *
 * Proof of row/CSV/JSON preservation is embedded in T-WARM and T-RECON-FAIL:
 * getFullNseStatus().rows and getAllScannedRows() return gen-old's data during
 * gen-new construction and gen-new's data after successful swap.
 */

import { describe, it, expect, afterEach } from "vitest";
import type { ScanCountReconciliation } from "./fullNseScanner";
import {
  scanFullNse,
  getFullNseStatus,
  getAllScannedRows,
  _setTestScanResultFactory,
  _setTestPauseBeforeCommit,
  _clearTestFactories,
  _resetTestHooks,
} from "./fullNseScanner";

// ── helpers ───────────────────────────────────────────────────────────────────

/** Minimal valid ScanCountReconciliation that satisfies allValid=true. */
function makeReconciliation(rows: number): ScanCountReconciliation {
  return {
    rawKiteMaster: rows,
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
    eligibleOrdinaryEquities: rows,
    kiteQuoteRows: rows,
    yahooChartRows: 0,
    yahooBatchRows: 0,
    liveQuoteRows: rows,
    noQuoteRows: 0,
    evaluatedRows: 0,
    notEvaluatedRows: rows,
    apiRowCount: rows,
    timingMs: { instrumentMaster: 1, eligibilityFilter: 1, kiteQuoteFetch: 1, yahooBatchFetch: 0, deliveryMapFetch: 0, enrichmentPhase: 0, rowAssembly: 1, heatmapOverlay: 0, total: 5 },
    step1Valid: true,   // rawKiteMaster(rows) = sum of all classes (rows)
    step2Valid: true,   // eligibleOrdinaryEquities(rows) = liveQuoteRows(rows) + noQuoteRows(0)
    step3Valid: true,   // apiRowCount(rows) = evaluatedRows(0) + notEvaluatedRows(rows)
    allValid: true,
  };
}

/** Minimal valid Cache-compatible result for the test factory. */
function makeTestCache(generationId: string, label: string, rowCount = 3) {
  const rows = Array.from({ length: rowCount }, (_, i) => ({
    symbol: `SYM${label}${i + 1}`,
    name: `Test Stock ${label}${i + 1}`,
    sector: "TEST",
    quote: {
      symbol: `SYM${label}${i + 1}`,
      price: 100,
      previousClose: 99,
      updatedAt: new Date(),
      open: 99, high: 101, low: 98,
      change: 1, changePercent: 1.0,
      volume: 1000,
    },
    recommendation: { signal: "NOT_EVALUATED" as const, score: null, confidence: null, reasons: [], setupMessage: "phase-a" },
  }));
  return {
    rows,
    generationId,
    lastUpdated: Date.now(),
    sourceDate: new Date().toISOString().slice(0, 10),
    total: rowCount,
    scanMs: 5,
    failures: 0,
    liveQuoteCount: rowCount,
    rested: 0,
    enriched: 0,
    degraded: false,
    kiteOffline: false,
    eligibilityBreakdown: { ORDINARY_EQUITY: rowCount },
    phaseA: true,
    countReconciliation: makeReconciliation(rowCount),
  };
}

// ── test fixtures ─────────────────────────────────────────────────────────────

afterEach(() => {
  _resetTestHooks();
});

// ── T-COLD ────────────────────────────────────────────────────────────────────

describe("T-COLD: First cold scan from empty cache", () => {
  it("traces before=null/null, during=null/gen-A, after=gen-A/null", async () => {
    // ── BEFORE ────────────────────────────────────────────────────────
    const before = getFullNseStatus();
    expect(before.displayedGenerationId,  "T-COLD before displayedGenerationId").toBeNull();
    expect(before.inProgressGenerationId, "T-COLD before inProgressGenerationId").toBeNull();
    expect(before.hasCache,               "T-COLD before hasCache").toBe(false);

    // ── DURING (pause before commit) ──────────────────────────────────
    let duringGenId: string | null = null;
    let duringDisplayed: string | null = "SENTINEL";

    // Resolve handle — pauses until test releases it.
    let resumeCommit: (() => void) | null = null;
    _setTestPauseBeforeCommit(() => new Promise<void>(resolve => { resumeCommit = resolve; }));

    // Scan result factory: returns controlled data with the generationId assigned
    // by performFullScan (so it matches inProgressGenerationId exactly).
    _setTestScanResultFactory(async (genId) => makeTestCache(genId, "A") as Parameters<typeof makeTestCache>[2] extends never ? never : ReturnType<typeof makeTestCache>);

    // Start scan — will pause before committing to cache.
    const scanPromise = scanFullNse({ force: true });

    // Spin-wait for inProgressGenerationId to be populated (fast — <5ms).
    for (let i = 0; i < 200; i++) {
      const mid = getFullNseStatus();
      if (mid.inProgressGenerationId !== null) {
        duringGenId = mid.inProgressGenerationId;
        duringDisplayed = mid.displayedGenerationId;
        break;
      }
      await new Promise(r => setTimeout(r, 1));
    }

    expect(duringGenId,     "T-COLD during inProgressGenerationId").toMatch(/^gen-\d{13}-\d+$/);
    expect(duringDisplayed, "T-COLD during displayedGenerationId (still null — cache not swapped yet)").toBeNull();

    // Rows and CSV during scan must still be the old (empty) set.
    const duringRows = getAllScannedRows();
    expect(duringRows.rows, "T-COLD during getAllScannedRows — old rows preserved").toHaveLength(0);

    // Resume commit.
    resumeCommit!();
    await scanPromise;

    // ── AFTER ─────────────────────────────────────────────────────────
    const after = getFullNseStatus();
    expect(after.displayedGenerationId,  "T-COLD after displayedGenerationId").toBe(duringGenId);
    expect(after.inProgressGenerationId, "T-COLD after inProgressGenerationId").toBeNull();
    expect(after.hasCache,               "T-COLD after hasCache").toBe(true);
    expect(after.rows,                   "T-COLD after rows count").toBe(3);

    const afterRows = getAllScannedRows();
    expect(afterRows.rows.every(r => r.symbol.startsWith("SYMA")), "T-COLD after rows are gen-A rows").toBe(true);
  });
});

// ── T-WARM ────────────────────────────────────────────────────────────────────

describe("T-WARM: Warm refresh — gen-B replaces gen-A", () => {
  it("traces before=gen-A/null, during=gen-A/gen-B, after=gen-B/null", async () => {
    // Seed cache with gen-A via a quick first scan (no pause).
    _setTestScanResultFactory(async (genId) => makeTestCache(genId, "A") as ReturnType<typeof makeTestCache>);
    const firstScan = await scanFullNse({ force: true });
    const genA = firstScan.generationId;
    _clearTestFactories(); // clear only hook functions; keep cache (gen-A stays displayed)

    // ── BEFORE ────────────────────────────────────────────────────────
    const before = getFullNseStatus();
    expect(before.displayedGenerationId,  "T-WARM before displayedGenerationId").toBe(genA);
    expect(before.inProgressGenerationId, "T-WARM before inProgressGenerationId").toBeNull();

    // ── DURING ────────────────────────────────────────────────────────
    let duringGenId: string | null = null;
    let duringDisplayed: string | null = "SENTINEL";
    let duringRowSymbol = "SENTINEL";

    let resumeCommit: (() => void) | null = null;
    _setTestPauseBeforeCommit(() => new Promise<void>(resolve => { resumeCommit = resolve; }));
    _setTestScanResultFactory(async (genId) => makeTestCache(genId, "B") as ReturnType<typeof makeTestCache>);

    const scanPromise = scanFullNse({ force: true });

    for (let i = 0; i < 200; i++) {
      const mid = getFullNseStatus();
      if (mid.inProgressGenerationId !== null) {
        duringGenId = mid.inProgressGenerationId;
        duringDisplayed = mid.displayedGenerationId;
        // Rows during construction must still be gen-A's rows.
        const midRows = getAllScannedRows();
        duringRowSymbol = midRows.rows[0]?.symbol ?? "EMPTY";
        break;
      }
      await new Promise(r => setTimeout(r, 1));
    }

    expect(duringGenId,      "T-WARM during inProgressGenerationId").toMatch(/^gen-\d{13}-\d+$/);
    expect(duringGenId,      "T-WARM during gen-B ≠ gen-A").not.toBe(genA);
    expect(duringDisplayed,  "T-WARM during displayedGenerationId still gen-A").toBe(genA);
    expect(duringRowSymbol,  "T-WARM during rows still show gen-A symbols").toMatch(/^SYMA/);

    resumeCommit!();
    await scanPromise;

    // ── AFTER ─────────────────────────────────────────────────────────
    const after = getFullNseStatus();
    expect(after.displayedGenerationId,  "T-WARM after displayedGenerationId").toBe(duringGenId);
    expect(after.inProgressGenerationId, "T-WARM after inProgressGenerationId").toBeNull();

    const afterRows = getAllScannedRows();
    expect(afterRows.rows[0]?.symbol, "T-WARM after rows now show gen-B symbols").toMatch(/^SYMB/);
  });
});

// ── T-RECON-FAIL ──────────────────────────────────────────────────────────────

describe("T-RECON-FAIL: Reconciliation failure preserves last-good generation", () => {
  it("traces before=gen-B/null, during=gen-B/gen-C, after=gen-B/null (gen-C suppressed)", async () => {
    // Seed gen-B
    _setTestScanResultFactory(async (genId) => makeTestCache(genId, "B") as ReturnType<typeof makeTestCache>);
    const seedB = await scanFullNse({ force: true });
    const genB = seedB.generationId;
    _clearTestFactories(); // keep cache; only clear factories for next arm

    // ── BEFORE ────────────────────────────────────────────────────────
    const before = getFullNseStatus();
    expect(before.displayedGenerationId, "T-RECON before").toBe(genB);

    // ── Gen-C has a broken reconciliation ─────────────────────────────
    let duringGenC: string | null = null;
    let resumeCommit: (() => void) | null = null;
    _setTestPauseBeforeCommit(() => new Promise<void>(resolve => { resumeCommit = resolve; }));
    _setTestScanResultFactory(async (genId) => {
      const c = makeTestCache(genId, "C") as ReturnType<typeof makeTestCache>;
      // Break reconciliation: apiRowCount doesn't equal evaluatedRows + notEvaluatedRows
      c.countReconciliation.apiRowCount = 999; // wrong
      c.countReconciliation.step3Valid = false;
      c.countReconciliation.allValid = false;
      return c;
    });

    const scanPromise = scanFullNse({ force: true });

    for (let i = 0; i < 200; i++) {
      const mid = getFullNseStatus();
      if (mid.inProgressGenerationId !== null) {
        duringGenC = mid.inProgressGenerationId;
        break;
      }
      await new Promise(r => setTimeout(r, 1));
    }

    expect(duringGenC, "T-RECON during inProgressGenerationId set").toMatch(/^gen-\d{13}-\d+$/);

    resumeCommit!();
    await scanPromise;

    // ── AFTER: gen-B must still be displayed; gen-C must NOT be published ──
    const after = getFullNseStatus();
    expect(after.displayedGenerationId,  "T-RECON after — last-good gen-B preserved").toBe(genB);
    expect(after.inProgressGenerationId, "T-RECON after — in-progress cleared").toBeNull();
    expect(after.displayedGenerationId,  "T-RECON after — gen-C not published").not.toBe(duringGenC);

    // Rows must still be gen-B's
    const afterRows = getAllScannedRows();
    expect(afterRows.rows.every(r => r.symbol.startsWith("SYMB")), "T-RECON after rows still gen-B").toBe(true);
  });
});

// ── T-PROV-FAIL ───────────────────────────────────────────────────────────────

describe("T-PROV-FAIL: Provider failure (rows.length===0) preserves last-good generation", () => {
  it("traces before=gen-B/null, during=gen-B/gen-D, after=gen-B/null (gen-D suppressed)", async () => {
    // Seed gen-B
    _setTestScanResultFactory(async (genId) => makeTestCache(genId, "B") as ReturnType<typeof makeTestCache>);
    const seedB = await scanFullNse({ force: true });
    const genB = seedB.generationId;
    _clearTestFactories(); // keep gen-B cache; only clear factories

    // Gen-D returns 0 rows — provider failure.
    let duringGenD: string | null = null;
    let resumeCommit: (() => void) | null = null;
    _setTestPauseBeforeCommit(() => new Promise<void>(resolve => { resumeCommit = resolve; }));
    _setTestScanResultFactory(async (genId) => {
      const d = makeTestCache(genId, "D", 0) as ReturnType<typeof makeTestCache>;
      d.countReconciliation.allValid = false; // 0 rows always fails reconciliation too
      return d;
    });

    const scanPromise = scanFullNse({ force: true });

    for (let i = 0; i < 200; i++) {
      const mid = getFullNseStatus();
      if (mid.inProgressGenerationId !== null) {
        duringGenD = mid.inProgressGenerationId;
        break;
      }
      await new Promise(r => setTimeout(r, 1));
    }

    expect(duringGenD, "T-PROV during inProgressGenerationId set").toMatch(/^gen-\d{13}-\d+$/);

    resumeCommit!();
    await scanPromise;

    const after = getFullNseStatus();
    expect(after.displayedGenerationId,  "T-PROV after — gen-B preserved").toBe(genB);
    expect(after.inProgressGenerationId, "T-PROV after — in-progress cleared").toBeNull();
  });
});

// ── T-ATOMIC ──────────────────────────────────────────────────────────────────

describe("T-ATOMIC: Concurrent status reads observe only complete generations", () => {
  it("all concurrent reads during pause observe old-complete or new-complete, never partial", async () => {
    // Seed gen-E
    _setTestScanResultFactory(async (genId) => makeTestCache(genId, "E") as ReturnType<typeof makeTestCache>);
    const seedE = await scanFullNse({ force: true });
    const genE = seedE.generationId;
    _clearTestFactories(); // keep gen-E cache; only clear factories

    let resumeCommit: (() => void) | null = null;
    let genF: string | null = null;
    const duringSnapshots: Array<{ displayedGenerationId: string | null; inProgressGenerationId: string | null }> = [];

    _setTestPauseBeforeCommit(async () => {
      // Take 10 snapshots while paused — all must show old complete gen-E + gen-F in progress.
      for (let i = 0; i < 10; i++) {
        const s = getFullNseStatus();
        duringSnapshots.push({ displayedGenerationId: s.displayedGenerationId, inProgressGenerationId: s.inProgressGenerationId });
      }
      await new Promise<void>(resolve => { resumeCommit = resolve; });
    });
    _setTestScanResultFactory(async (genId) => {
      genF = genId;
      return makeTestCache(genId, "F") as ReturnType<typeof makeTestCache>;
    });

    const scanPromise = scanFullNse({ force: true });

    // Wait for pause to capture snapshots.
    for (let i = 0; i < 500; i++) {
      if (duringSnapshots.length >= 10) break;
      await new Promise(r => setTimeout(r, 1));
    }
    resumeCommit!();
    // scanPromise resolves to the OLD cache (warm-start returns immediately);
    // the background gen-F commit runs after unblocking. Wait for it to settle.
    await scanPromise;
    for (let i = 0; i < 100; i++) {
      const s = getFullNseStatus();
      if (s.displayedGenerationId === genF) break;
      await new Promise(r => setTimeout(r, 2));
    }

    // Every during-snapshot must show gen-E (complete), not gen-F (incomplete).
    for (const snap of duringSnapshots) {
      expect(snap.displayedGenerationId,  "T-ATOMIC during snapshot — complete gen-E only").toBe(genE);
      expect(snap.inProgressGenerationId, "T-ATOMIC during snapshot — gen-F in progress").toBe(genF);
    }

    // After commit: gen-F is displayed, in-progress null.
    const after = getFullNseStatus();
    expect(after.displayedGenerationId,  "T-ATOMIC after — gen-F published").toBe(genF);
    expect(after.inProgressGenerationId, "T-ATOMIC after — in-progress null").toBeNull();
  });
});
