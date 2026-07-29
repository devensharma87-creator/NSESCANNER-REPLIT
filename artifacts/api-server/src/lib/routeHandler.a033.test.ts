/**
 * A0.3 Gate 2 — Executable production-handler proof
 *
 * Proves via actual invocation of getOptionSignals() — the production business
 * function called directly by the /api/options/signals route handler — that
 * indexFnoSetupAvailability carries exactly 9 records under five failure regimes:
 *
 *   1. Normal path: all three indices reach buildSignalsForIndex
 *      (minimal chart → insufficient bars → no signals emitted, handler completes).
 *   2. Partial failure — continue path: NIFTY suppressed at the intraday-candle
 *      check (centralHasIndexCoverage=false → no_live_kite_intraday continue branch);
 *      BANKNIFTY and SENSEX reach buildSignalsForIndex.
 *   3. All-index failure: every index suppressed at the intraday-candle check;
 *      bundles[] is empty for the entire post-loop pipeline.
 *   4. Exception-path partial failure: NIFTY's centralIndexCandles call throws;
 *      the per-index catch at line ~3012 pushes to suppressed[] and the loop
 *      continues — proving the catch-branch (not the continue-branch) also preserves
 *      indexFnoSetupAvailability.
 *   5. Shape guard: each availability entry carries the required contract fields.
 *
 * Design decisions:
 *   - Calls getOptionSignals() directly (the production function, no Express layer).
 *     The route handler is a thin wrapper: requireSubscriberOrOwner → getOptionSignals()
 *     → GetOptionSignalsResponse.parse() → res.json().  The invariant lives entirely
 *     in getOptionSignals() and is provable without running the HTTP layer.
 *   - All external I/O (Kite, DB, paper trader, Telegram) is replaced with
 *     deterministic vi.mock stubs.  No DB connection is established.
 *   - _resetOptionSignalsCacheForTest() follows the existing _resetDetectorCooldownForTest
 *     pattern — test-only helper, production default (30-second TTL cache) unchanged.
 *   - Minimal YahooChart (1 candle, past date) → lastSessionBars() returns 0–1 bars
 *     → buildContext() returns null (MIN_BARS_FOR_CONTEXT=2) → buildSignalsForIndex()
 *     hits the early exit and returns setupAvailability without any signal emission.
 *     This keeps the test fast and free of live-data dependency while still exercising
 *     the full outer orchestration of getOptionSignals().
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { YahooChart } from "./yahoo";
import type { GateContext } from "./optionSignalGates";

// ── Module-level stubs (vi.mock is hoisted before all imports) ─────────────────

vi.mock("./marketData/compat", () => ({
  centralHasIndexCoverage: vi.fn(),
  centralIndexCandles: vi.fn(),
  centralIndexQuotes: vi.fn().mockResolvedValue(null),
}));

vi.mock("./optionSignalGates", () => ({
  loadGateContext: vi.fn(),
  isBiasFlipSuppressed: vi.fn().mockReturnValue({ suppressed: false }),
  applyCorrelationCap: vi.fn().mockImplementation(
    (signals: unknown[]) => ({ kept: [...signals], dropped: [] }),
  ),
  STALE_PENDING_MAX_MIN: 45,
  VWAP_RECLAIM_LATE_CUTOFF_IST_MIN: 810,   // 13 * 60 + 30
  OI_VETO_THRESHOLD: 30,
  DAILY_STOP_LIMIT: 2,
  BIAS_FLIP_COOLDOWN_MIN: 45,
  VIX_INTRADAY_SPIKE_PCT: 5,
  VIX_DAY_SPIKE_PCT: 7,
}));

vi.mock("./optionSignalLifecycle", () => ({
  expireStalePendingSignals:  vi.fn().mockResolvedValue(0),
  recordOrUpdate:             vi.fn().mockResolvedValue(null),
  expireOpenSignalsForToday:  vi.fn().mockResolvedValue(0),
  persistOptionPremiums:      vi.fn().mockResolvedValue(undefined),
  getPlanRevisedKeys:         vi.fn().mockResolvedValue(new Set<string>()),
  getPaperFillsForDate:       vi.fn().mockResolvedValue(new Map<string, unknown>()),
}));

vi.mock("./kiteAuth", () => ({
  getActiveSessionStatus: vi.fn().mockResolvedValue({ session: null }),
}));

vi.mock("./alerting", () => ({
  alertOwner: vi.fn(),
}));

vi.mock("./fnoDataRecoveryTransition", () => ({
  handleFnoDataSuppressionTransition: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./fnoExitMonitorHealth", () => ({
  beginFnoExitMonitorCycle: vi.fn().mockReturnValue({}),
  finalizeFnoExitMonitorCycle: vi.fn(),
}));

vi.mock("./oiLab", () => ({
  fetchOiInsights: vi.fn().mockResolvedValue(null),
}));

vi.mock("./optionChain", () => ({
  fetchOptionChain: vi.fn().mockResolvedValue(null),
}));

vi.mock("./ivHistory", () => ({
  recordAtmIv: vi.fn().mockResolvedValue(undefined),
  computeIvMetrics: vi.fn().mockResolvedValue({ ivRank: null, ivPercentile: null }),
}));

vi.mock("./fnoSignalReasoningLogger", () => ({
  logUpstreamReasoningBatch: vi.fn(),
}));

// Dynamic imports inside getOptionSignals() — intercepted by vi.mock.
vi.mock("./paperTradingFO", () => ({
  tryOpenPaperTrades: vi.fn().mockResolvedValue(undefined),
  markOpenFnoTradesToMarket: vi.fn().mockResolvedValue(undefined),
  markAllOpenFnoTradesToMarket: vi.fn().mockResolvedValue(undefined),
  evaluateOrphanedOpenTrades: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./fnoPremiumExitOverlay", () => ({
  runPremiumHardStopSweep: vi.fn().mockResolvedValue(undefined),
}));

// ── Imports (after vi.mock hoisting) ───────────────────────────────────────────

import {
  getOptionSignals,
  OPTION_INDICES,
  _resetOptionSignalsCacheForTest,
} from "./optionSignals";
import {
  centralHasIndexCoverage,
  centralIndexCandles,
} from "./marketData/compat";
import { loadGateContext } from "./optionSignalGates";

// ── Shared fixtures ────────────────────────────────────────────────────────────

/**
 * Minimal YahooChart: 1 candle whose timestamp is 2020-01-01 09:30 UTC.
 * lastSessionBars() filters to "today's" IST session → 0 bars.
 * 0 < MIN_BARS_FOR_CONTEXT (2) → buildContext() returns null
 * → buildSignalsForIndex() returns the early-exit result (line ~1661):
 *   { signals: [], suppressed: ["NO_BARS_OR_INSUFFICIENT_DATA"],
 *     hasBars: false, setupAvailability: computeIndexFnoSetupAvailability(...) }
 * This exercises the full getOptionSignals() orchestration (gate context load,
 * per-index loop, post-loop pipeline, computeAllIndexFnoSetupAvailability()) while
 * keeping the test entirely free of live-data dependency.
 */
const MINIMAL_CHART: YahooChart = {
  symbol: "^TEST",
  meta: { symbol: "^TEST", regularMarketPrice: 22000 },
  timestamps: [Math.floor(Date.UTC(2020, 0, 1, 9, 30) / 1000)], // 2020-01-01 IST — never "today"
  open:   [21950],
  high:   [22100],
  low:    [21900],
  close:  [22000],
  volume: [0],
};

/** Minimal GateContext with all gates inactive. */
const MINIMAL_GATE_CTX: GateContext = {
  stoppedToday: 0,
  paperStoppedToday: 0,
  modeledStoppedToday: 0,
  circuitBreakerActive: false,
  recentStopsByIndex: new Map(),
  vix: { intradayPct: null, dayPct: null, spike: false, reason: null },
  globalSuppress: false,
  setupWinRates: new Map(),
  nifty5dReturn: null,
  notes: [],
};

// ── Test suite ─────────────────────────────────────────────────────────────────

describe("Gate 2 — getOptionSignals() production-handler execution: indexFnoSetupAvailability invariant", () => {

  beforeEach(() => {
    // vi.clearAllMocks() clears call counts and results but PRESERVES factory-level
    // .mockResolvedValue / .mockImplementation, so every vi.fn().mockResolvedValue(...)
    // defined in the vi.mock factories above continues to return its stub Promise
    // across tests. vi.resetAllMocks() would zero out those implementations and cause
    // `.catch()` calls on the undefined return to throw.
    vi.clearAllMocks();
    // Reset the 30-second TTL result cache so each test performs a fresh full cycle,
    // not a cache hit from the previous test.
    _resetOptionSignalsCacheForTest();
    // loadGateContext is called WITHOUT try/catch in getOptionSignals() and must return
    // a valid GateContext object. It cannot be set to MINIMAL_GATE_CTX in the vi.mock
    // factory (factories are hoisted before variable definitions), so it is the single
    // necessary re-apply in beforeEach.
    vi.mocked(loadGateContext).mockResolvedValue(MINIMAL_GATE_CTX);
  });

  // ── 1. Normal path ─────────────────────────────────────────────────────────────

  it("normal path: all three indices reach buildSignalsForIndex — indexFnoSetupAvailability has exactly 9 records", async () => {
    // All indices have intraday coverage → per-index try block reaches buildSignalsForIndex.
    // MINIMAL_CHART (1 old candle) → buildContext() returns null (0 session bars < 2)
    // → buildSignalsForIndex returns early-exit result; no signal emission.
    vi.mocked(centralHasIndexCoverage).mockReturnValue(true);
    vi.mocked(centralIndexCandles).mockResolvedValue(MINIMAL_CHART);

    const result = await getOptionSignals();

    // ─ Core invariant ─
    expect(result.indexFnoSetupAvailability).toHaveLength(9);

    // ─ Structural integrity ─
    expect(Array.isArray(result.signals)).toBe(true);
    expect(result.diagnostics).toBeDefined();
    expect(result.diagnostics.indicesConfigured).toBe(OPTION_INDICES.length);
    expect(result.diagnostics.indicesConfigured).toBe(3);
  });

  // ── 2. Partial failure — continue branch ───────────────────────────────────────

  it("partial failure (continue path): NIFTY suppressed at intraday-candle check — indexFnoSetupAvailability still has 9 records", async () => {
    // NIFTY (yahoo symbol ^NSEI): no intraday coverage → intra stays null
    // → suppressed via the "no_live_kite_intraday" continue at line ~2929.
    // This is the CONTINUE branch (not the exception catch branch).
    // BANKNIFTY (^NSEBANK) + SENSEX (^BSESN): coverage present → MINIMAL_CHART
    // → buildSignalsForIndex early-exits (insufficient bars, no signal emission).
    vi.mocked(centralHasIndexCoverage).mockImplementation(
      (symbol: string) => symbol !== "^NSEI",
    );
    vi.mocked(centralIndexCandles).mockResolvedValue(MINIMAL_CHART);

    const result = await getOptionSignals();

    // ─ Core invariant: partial suppression must not reduce availability records ─
    expect(result.indexFnoSetupAvailability).toHaveLength(9);

    // ─ NIFTY must appear in suppressed with the correct reason prefix ─
    const suppressedForNifty = result.diagnostics.suppressed.filter(
      (s) => s.index === "NIFTY",
    );
    expect(suppressedForNifty.length).toBeGreaterThan(0);
    const niftyReason = suppressedForNifty[0]!.reasons.join("|");
    expect(niftyReason).toContain("no_live_kite_intraday");

    // ─ BANKNIFTY and SENSEX were processed (not suppressed via continue) ─
    const suppressedIndices = result.diagnostics.suppressed.map((s) => s.index);
    // They may appear in suppressed[] due to "NO_BARS" reason from buildSignalsForIndex,
    // but MUST NOT appear with "no_live_kite_intraday" — they got past the intra check.
    const bankNiftyIntraSuppressed = result.diagnostics.suppressed.some(
      (s) => s.index === "BANKNIFTY" &&
             s.reasons.some((r) => r.includes("no_live_kite_intraday")),
    );
    const sensexIntraSuppressed = result.diagnostics.suppressed.some(
      (s) => s.index === "SENSEX" &&
             s.reasons.some((r) => r.includes("no_live_kite_intraday")),
    );
    expect(bankNiftyIntraSuppressed).toBe(false);
    expect(sensexIntraSuppressed).toBe(false);
    void suppressedIndices; // used for debugging; not asserted further
  });

  // ── 3. All-index failure — continue branch for every index ─────────────────────

  it("all-index failure (continue path): all three indices suppressed — bundles[] empty — indexFnoSetupAvailability still has 9 records", async () => {
    // Every index: centralHasIndexCoverage=false → intra stays null for all three
    // → every index is pushed to suppressed[] via the continue branch.
    // bundles[] is empty for the ENTIRE post-loop pipeline.
    vi.mocked(centralHasIndexCoverage).mockReturnValue(false);
    // Defensive: centralIndexCandles should not be called at all.
    vi.mocked(centralIndexCandles).mockResolvedValue(null);

    const result = await getOptionSignals();

    // ─ Core invariant: all-index suppression must not destroy availability ─
    expect(result.indexFnoSetupAvailability).toHaveLength(9);

    // ─ All signals suppressed ─
    expect(result.signals).toHaveLength(0);

    // ─ All three configured indices appear in suppressed ─
    const suppressedIndices = new Set(
      result.diagnostics.suppressed.map((s) => s.index),
    );
    expect(suppressedIndices.has("NIFTY")).toBe(true);
    expect(suppressedIndices.has("BANKNIFTY")).toBe(true);
    expect(suppressedIndices.has("SENSEX")).toBe(true);

    // ─ No candle fetch attempted when all indices lack coverage ─
    // (centralHasIndexCoverage returns false → early continue before any await centralIndexCandles call)
    expect(vi.mocked(centralIndexCandles)).not.toHaveBeenCalled();
  });

  // ── 4. Exception-path partial failure (catch branch, not continue branch) ────────

  it("exception path partial failure: NIFTY throws inside per-index try block — indexFnoSetupAvailability still has 9 records", async () => {
    // All indices: coverage present (centralHasIndexCoverage=true).
    // NIFTY: centralIndexCandles("^NSEI", ...) throws → caught by the per-index
    //        catch at line ~3012 → pushed to suppressed[] with "exception:" prefix.
    //        This is the EXCEPTION CATCH branch (not the continue branch).
    // BANKNIFTY + SENSEX: MINIMAL_CHART → buildSignalsForIndex early-exits.
    vi.mocked(centralHasIndexCoverage).mockReturnValue(true);
    vi.mocked(centralIndexCandles).mockImplementation(
      async (symbol: string) => {
        if (symbol === "^NSEI") {
          throw new Error("Kite timeout simulated for NIFTY (Gate 2 injection)");
        }
        return MINIMAL_CHART;
      },
    );

    const result = await getOptionSignals();

    // ─ Core invariant survives the exception catch path ─
    expect(result.indexFnoSetupAvailability).toHaveLength(9);

    // ─ NIFTY appears in suppressed with the exception: prefix ─
    const niftySuppression = result.diagnostics.suppressed.find(
      (s) => s.index === "NIFTY" &&
             s.reasons.some((r) => r.startsWith("exception:")),
    );
    expect(niftySuppression).toBeDefined();
    expect(niftySuppression!.reasons[0]).toContain("Kite timeout simulated");
  });

  // ── 5. Availability entry shape contract ─────────────────────────────────────────

  it("all-index failure: each availability entry carries required contract fields and all 9 setupKeys are distinct", async () => {
    vi.mocked(centralHasIndexCoverage).mockReturnValue(false);
    vi.mocked(centralIndexCandles).mockResolvedValue(null);

    const result = await getOptionSignals();

    expect(result.indexFnoSetupAvailability).toHaveLength(9);

    for (const entry of result.indexFnoSetupAvailability) {
      // setupKey: non-empty string
      expect(typeof entry.setupKey).toBe("string");
      expect(entry.setupKey.length).toBeGreaterThan(0);
      // status: one of the three canonical values
      expect(["ACTIVE", "UNAVAILABLE_REQUIRED_INPUT", "RETIRED_INDEX_FNO_POLICY"]).toContain(entry.status);
      // explanation: non-empty string (user-facing reason)
      expect(typeof entry.explanation).toBe("string");
      expect(entry.explanation.length).toBeGreaterThan(0);
      // scope: always INDEX_FNO
      expect(entry.scope).toBe("INDEX_FNO");
      // eligibleForEmission: always false for non-ACTIVE entries; boolean-like
      expect(typeof entry.eligibleForEmission).toBe("boolean");
    }

    // Each (indexSymbol, setupKey) pair must be distinct — 3 indices × 3 setups = 9 unique pairs.
    // setupKey alone repeats 3 times (once per index), so we composite the pair.
    const pairs = result.indexFnoSetupAvailability.map((e) => `${e.indexSymbol}::${e.setupKey}`);
    expect(new Set(pairs).size).toBe(9);
  });

  // ── 6. Normal-path preservation: computeAllIndexFnoSetupAvailability() is
  //       unconditional — same result regardless of how many indices succeed ──────

  it("availability count is identical (9) across normal, partial, and all-index failure without rebuilding mocks", async () => {
    // All-index failure
    vi.mocked(centralHasIndexCoverage).mockReturnValue(false);
    vi.mocked(centralIndexCandles).mockResolvedValue(null);
    const allFail = await getOptionSignals();
    expect(allFail.indexFnoSetupAvailability).toHaveLength(9);

    // Reset cache for next call
    _resetOptionSignalsCacheForTest();

    // Normal path
    vi.mocked(centralHasIndexCoverage).mockReturnValue(true);
    vi.mocked(centralIndexCandles).mockResolvedValue(MINIMAL_CHART);
    const normal = await getOptionSignals();
    expect(normal.indexFnoSetupAvailability).toHaveLength(9);

    // Reset cache for next call
    _resetOptionSignalsCacheForTest();

    // Partial failure
    vi.mocked(centralHasIndexCoverage).mockImplementation(
      (symbol: string) => symbol !== "^NSEI",
    );
    const partial = await getOptionSignals();
    expect(partial.indexFnoSetupAvailability).toHaveLength(9);

    // All three variants produce identical availability counts
    expect(allFail.indexFnoSetupAvailability.length)
      .toBe(normal.indexFnoSetupAvailability.length);
    expect(normal.indexFnoSetupAvailability.length)
      .toBe(partial.indexFnoSetupAvailability.length);
  });
});
