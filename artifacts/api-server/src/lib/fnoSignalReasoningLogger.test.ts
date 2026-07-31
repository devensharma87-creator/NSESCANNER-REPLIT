/**
 * P14 — F&O Signal Reasoning Logger tests.
 *
 * Pure-function tests on the payload builder and filter normaliser.
 * DB writes are exercised by an end-to-end smoke test that auto-skips
 * when DATABASE_URL is unset (mirrors candleWarehouseIngestor.test.ts).
 *
 * What this suite asserts (mapped to the P14 acceptance list):
 *   - reasoning record shape is built correctly for emitted/skipped/closed
 *   - demotion / rejection reasons land in reason_code
 *   - gate result lands in reason_code (matching SkipReason)
 *   - varchar limits and NaN/Inf are sanitised
 *   - filter normaliser rejects bad dates / caps limit / accepts aliases
 *   - logger never throws — even when the payload would explode the DB
 *   - no secret-shaped keys are accepted by the public shape
 *     (compile-time via type, runtime spot-check via snapshot opacity)
 */
import { describe, it, expect, vi } from "vitest";

/**
 * P0.1B tripwire guard: fnoSignalReasoningLogger makes DB calls via
 * db.insert AND db.select (deduplication). Mock @workspace/db so no
 * real pg.Pool connections are attempted in the normal test suite.
 * Individual tests that need specific db.insert behaviour use vi.spyOn
 * on top of this mock (spyOn overrides the factory mock per-test).
 */
vi.mock("@workspace/db", () => ({
  db: {
    execute: vi.fn().mockRejectedValue(new Error("DB mock")),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
        orderBy: vi.fn().mockResolvedValue([]),
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockRejectedValue(new Error("DB mock")),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
  },
  fnoSignalReasoningTable: {},
  kiteSessionTable: {},
}));

import {
  buildEmittedRow,
  buildPreEmissionRejectedRows,
  buildReasoningRow,
  buildUpstreamReasoningRows,
  classifySuppressionReason,
  logFnoReasoning,
  logUpstreamReasoningBatch,
  normaliseFilters,
  parseSuppressionReason,
  commitUpstreamDedupeState,
  reasoningDedupeIdentity,
  reasoningStateKey,
  selectUpstreamRowsToWrite,
  type FnoReasoningPayload,
} from "./fnoSignalReasoningLogger";

/** Simulate the writer: select, then commit each row as if the write
 *  succeeded. Mirrors `logUpstreamReasoningBatch`'s ok→commit loop. */
function selectAndCommit(
  rows: ReadonlyArray<FnoReasoningPayload>,
  state: Map<string, string>,
): FnoReasoningPayload[] {
  const toWrite = selectUpstreamRowsToWrite(rows, state);
  for (const r of toWrite) commitUpstreamDedupeState(r, state);
  return toWrite;
}

const SKIPPED_BASE: FnoReasoningPayload = {
  decision: "SKIPPED",
  signalDate: "2026-05-15",
  indexSymbol: "NIFTY",
  setupKey: "TREND_CONTINUATION",
  direction: "BULLISH",
  tier: "STANDARD",
  confidence: 72,
  reasonCode: "LIQUIDITY_OI",
};

describe("buildReasoningRow — pure shape mapping", () => {
  it("maps a SKIPPED row with the SkipReason into reason_code", () => {
    const row = buildReasoningRow(SKIPPED_BASE);
    expect(row.decision).toBe("SKIPPED");
    expect(row.reasonCode).toBe("LIQUIDITY_OI");
    expect(row.signalDate).toBe("2026-05-15");
    expect(row.indexSymbol).toBe("NIFTY");
    expect(row.setupKey).toBe("TREND_CONTINUATION");
    expect(row.direction).toBe("BULLISH");
    expect(row.tier).toBe("STANDARD");
    expect(row.confidence).toBe(72);
  });

  it("maps an OPENED row with full sizing/strike/premium context", () => {
    const row = buildReasoningRow({
      decision: "OPENED",
      signalDate: "2026-05-15",
      indexSymbol: "BANKNIFTY",
      indexName: "BANKNIFTY",
      setupKey: "VWAP_RECLAIM",
      direction: "BEARISH",
      optionType: "PE",
      tier: "STANDARD",
      reasonCode: "OPENED",
      confidence: 78,
      selectedStrike: 48500,
      optionEntry: 142.55,
      optionStop: 113.5,
      optionTarget1: 171.6,
      optionTarget2: 200.5,
      optionLtp: 142.55,
      spotEntry: 48473.2,
      spotStop: 48650,
      maxLossPct: 0.02,
      lots: 30,
      lotSize: 15,
    });
    expect(row.decision).toBe("OPENED");
    expect(row.reasonCode).toBe("OPENED");
    expect(row.optionType).toBe("PE");
    expect(row.selectedStrike).toBe("48500.00");
    expect(row.optionEntry).toBe("142.5500");
    expect(row.lots).toBe(30);
    expect(row.lotSize).toBe(15);
    expect(row.maxLossPct).toBe("0.0200");
  });

  it("maps a CLOSED_STOPPED row with realized P&L and exit premium", () => {
    const row = buildReasoningRow({
      decision: "CLOSED_STOPPED",
      signalDate: "2026-05-15",
      indexSymbol: "NIFTY",
      setupKey: "EMA_PULLBACK",
      direction: "BULLISH",
      optionType: "CE",
      reasonCode: "STOPPED",
      exitReason: "STOPPED",
      lifecycleStatus: "STOPPED",
      optionEntry: 95.0,
      optionStop: 76.0,
      optionExit: 76.0,
      realizedPnl: -14250,
      lots: 30,
      lotSize: 25,
    });
    expect(row.decision).toBe("CLOSED_STOPPED");
    expect(row.exitReason).toBe("STOPPED");
    expect(row.lifecycleStatus).toBe("STOPPED");
    expect(row.optionExit).toBe("76.0000");
    expect(row.realizedPnl).toBe("-14250.00");
  });

  it("sanitises NaN, Infinity and -Infinity to NULL across all numeric fields", () => {
    const row = buildReasoningRow({
      ...SKIPPED_BASE,
      confidence: NaN,
      confluenceScore: Infinity,
      vix: -Infinity,
      spot: NaN,
      optionEntry: NaN,
      optionStop: Infinity,
      maxLossPct: NaN,
      lots: NaN,
    });
    expect(row.confidence).toBeNull();
    expect(row.confluenceScore).toBeNull();
    expect(row.vix).toBeNull();
    expect(row.spot).toBeNull();
    expect(row.optionEntry).toBeNull();
    expect(row.optionStop).toBeNull();
    expect(row.maxLossPct).toBeNull();
    expect(row.lots).toBeNull();
  });

  it("caps overlong varchar inputs at the column max instead of dropping them", () => {
    const longReason = "X".repeat(200);
    const row = buildReasoningRow({ ...SKIPPED_BASE, reasonCode: longReason });
    expect(row.reasonCode).not.toBeNull();
    expect(row.reasonCode!.length).toBe(64);
  });

  it("trims empty strings to NULL so the DB stays honest about 'unknown'", () => {
    const row = buildReasoningRow({
      ...SKIPPED_BASE,
      indexName: "   ",
      setupKey: "",
      direction: "  ",
    });
    expect(row.indexName).toBeNull();
    expect(row.setupKey).toBeNull();
    expect(row.direction).toBeNull();
  });

  it("forwards a clean snapshot JSONB catch-all verbatim", () => {
    const snap = {
      gateFlags: { liquidity: "PASS", spread: "PASS", oi: "FAIL" },
      emaStack: { ema9: 24500, ema20: 24480, ema50: 24410 },
      vwapRel: "ABOVE",
    };
    const row = buildReasoningRow({ ...SKIPPED_BASE, snapshot: snap });
    expect(row.snapshot).toEqual(snap);
  });

  it("drops credential-shaped keys from snapshot (defence-in-depth)", () => {
    const snap = {
      gateFlags: { liquidity: "PASS" },
      access_token: "sk-live-DO-NOT-LEAK",
      sessionCookie: "abc123",
      apiKey: "leak-me",
      kiteApiSecret: "secret-secret",
      Authorization: "Bearer xyz",
      regime: "TRENDING",
    };
    const row = buildReasoningRow({ ...SKIPPED_BASE, snapshot: snap });
    expect(row.snapshot).toEqual({
      gateFlags: { liquidity: "PASS" },
      regime: "TRENDING",
    });
  });

  it("collapses oversized snapshot payloads to a truncation marker", () => {
    const huge: Record<string, unknown> = {};
    for (let i = 0; i < 5000; i++) huge[`k${i}`] = "x".repeat(50);
    const row = buildReasoningRow({ ...SKIPPED_BASE, snapshot: huge });
    expect(row.snapshot).toMatchObject({ __truncated: true });
  });


  it("uses a default capturedAt of 'now' when caller omits it", () => {
    const before = Date.now();
    const row = buildReasoningRow(SKIPPED_BASE);
    const after = Date.now();
    expect(row.capturedAt).toBeInstanceOf(Date);
    const t = (row.capturedAt as Date).getTime();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
  });
});

describe("normaliseFilters — owner-facing filter shape", () => {
  it("accepts the documented filter keys", () => {
    const f = normaliseFilters({
      index: "NIFTY",
      setup: "TREND_CONTINUATION",
      side: "BULLISH",
      tier: "STANDARD",
      status: "SKIPPED",
      reason: "LIQUIDITY_OI",
      from: "2026-05-01",
      to: "2026-05-15",
      limit: "50",
    });
    expect(f.indexSymbol).toBe("NIFTY");
    expect(f.setupKey).toBe("TREND_CONTINUATION");
    expect(f.direction).toBe("BULLISH");
    expect(f.tier).toBe("STANDARD");
    expect(f.decision).toBe("SKIPPED");
    expect(f.reasonCode).toBe("LIQUIDITY_OI");
    expect(f.from).toBe("2026-05-01");
    expect(f.to).toBe("2026-05-15");
    expect(f.limit).toBe(50);
  });

  it("accepts the canonical *Key aliases", () => {
    const f = normaliseFilters({
      indexSymbol: "BANKNIFTY",
      setupKey: "VWAP_RECLAIM",
      direction: "BEARISH",
      decision: "CLOSED_STOPPED",
      reasonCode: "STOPPED",
    });
    expect(f.indexSymbol).toBe("BANKNIFTY");
    expect(f.setupKey).toBe("VWAP_RECLAIM");
    expect(f.direction).toBe("BEARISH");
    expect(f.decision).toBe("CLOSED_STOPPED");
    expect(f.reasonCode).toBe("STOPPED");
  });

  it("rejects impossible dates like 2026-99-99", () => {
    const f = normaliseFilters({ from: "2026-99-99", to: "not-a-date" });
    expect(f.from).toBeUndefined();
    expect(f.to).toBeUndefined();
  });

  it("rejects malformed YYYY-MM-DD strings", () => {
    expect(normaliseFilters({ from: "2026-5-1" }).from).toBeUndefined();
    expect(normaliseFilters({ from: "20260501" }).from).toBeUndefined();
  });

  it("caps limit at 500 and floors at default when missing/garbage", () => {
    expect(normaliseFilters({ limit: "999999" }).limit).toBe(500);
    expect(normaliseFilters({ limit: "abc" }).limit).toBe(100);
    expect(normaliseFilters({ limit: "-1" }).limit).toBe(100);
    expect(normaliseFilters({}).limit).toBe(100);
    expect(normaliseFilters({ limit: 25 }).limit).toBe(25);
  });

  it("drops blank string filters so '?index=' does not filter", () => {
    const f = normaliseFilters({ index: "", setup: "   ", tier: "" });
    expect(f.indexSymbol).toBeUndefined();
    expect(f.setupKey).toBeUndefined();
    expect(f.tier).toBeUndefined();
  });
});

describe("P14b — upstream emission helpers", () => {
  const EMITTED_SIG = {
    index: "BANKNIFTY",
    indexName: "BANKNIFTY",
    setupKey: "TREND_CONTINUATION",
    setupName: "Trend Continuation",
    bias: "BULLISH",
    tier: "STANDARD",
    confidence: 72,
    confluenceScore: 8.5,
    regime: "TRENDING",
    spot: 48500.25,
    vwap: 48420.1,
    ema9: 48490,
    ema20: 48470,
    ema21: 48468,
    ema50: 48400,
    dailyEma50: 47800,
    htfBias: "BULLISH",
    htfConflict: false,
    ivRank: 42.5,
    ivPercentile: 38.2,
    dataQuality: "OK",
    tags: ["OI_CONFIRMED"],
    drivers: [
      { label: "EMA_STACK", weight: 6, detail: "Above 9/20/50", bullish: true },
      { label: "VWAP", weight: 4, detail: "Above VWAP", bullish: true },
    ],
    leg: { type: "CALL", strike: 48500, entry: 142.5, stopLoss: 113.5, target1: 171.6, target2: 200.5 },
  };

  it("buildEmittedRow captures the full upstream-reasoning field set", () => {
    const row = buildEmittedRow(
      EMITTED_SIG, "2026-05-15", 13.2,
    );
    expect(row.decision).toBe("EMITTED");
    expect(row.reasonCode).toBe("EMITTED"); // no demotion tags → EMITTED
    expect(row.setupKey).toBe("TREND_CONTINUATION");
    expect(row.direction).toBe("BULLISH");
    expect(row.optionType).toBe("CE");
    expect(row.tier).toBe("STANDARD");
    expect(row.confidence).toBe(72);
    expect(row.confluenceScore).toBe(8.5);
    expect(row.regime).toBe("TRENDING");
    expect(row.ivr).toBe(42.5);
    expect(row.ivp).toBe(38.2);
    expect(row.vix).toBe(13.2);
    expect(row.selectedStrike).toBe(48500);
    expect(row.spotEntry).toBe(142.5);
    expect(row.snapshot).toMatchObject({
      tags: ["OI_CONFIRMED"],
      demotionTags: [],
      vwapRel: "ABOVE",
      htfBias: "BULLISH",
      htfConflict: false,
      missing: [],
      emaStack: { ema9: 48490, ema20: 48470, ema50: 48400 },
    });
    expect((row.snapshot as { drivers: unknown[] }).drivers).toHaveLength(2);
  });

  it("buildEmittedRow flags demotion tags and switches reasonCode to DEMOTED", () => {
    const sig = { ...EMITTED_SIG, tier: "BASELINE", tags: ["LOW_WINRATE", "RS_CONFLICT", "OI_CONFIRMED"] };
    const row = buildEmittedRow(sig, "2026-05-15", null);
    expect(row.reasonCode).toBe("DEMOTED");
    expect((row.snapshot as { demotionTags: string[] }).demotionTags).toEqual(["LOW_WINRATE", "RS_CONFLICT"]);
    expect(row.tier).toBe("BASELINE");
  });

  it("buildEmittedRow surfaces the 2026-06-09 hygiene vetoes as first-class demotion tags", () => {
    const sig = {
      ...EMITTED_SIG,
      tags: ["RECOVERY_MODE_VETO", "CHASE_RISK_VETO", "OI_CONFIRMED"],
    };
    const row = buildEmittedRow(sig, "2026-06-09", null);
    expect(row.reasonCode).toBe("DEMOTED");
    expect((row.snapshot as { demotionTags: string[] }).demotionTags).toEqual([
      "RECOVERY_MODE_VETO",
      "CHASE_RISK_VETO",
    ]);
  });

  it("buildEmittedRow persists tradeClass (e.g. INFO_ONLY) into the snapshot", () => {
    const info = { ...EMITTED_SIG, tradeClass: "INFO_ONLY" };
    const infoRow = buildEmittedRow(info, "2026-06-09", null);
    expect((infoRow.snapshot as { tradeClass: string | null }).tradeClass).toBe("INFO_ONLY");

    const tradeable = { ...EMITTED_SIG, tradeClass: "TRADEABLE" };
    const tradeableRow = buildEmittedRow(tradeable, "2026-06-09", null);
    expect((tradeableRow.snapshot as { tradeClass: string | null }).tradeClass).toBe("TRADEABLE");

    // absent tradeClass → null, never undefined/omitted
    const plainRow = buildEmittedRow(EMITTED_SIG, "2026-06-09", null);
    expect((plainRow.snapshot as { tradeClass: string | null }).tradeClass).toBeNull();
  });

  it("buildEmittedRow records missing-data flags for null ivr/ivp/vix", () => {
    const sig = { ...EMITTED_SIG, ivRank: undefined, ivPercentile: undefined };
    const row = buildEmittedRow(sig, "2026-05-15", null);
    const missing = (row.snapshot as { missing: string[] }).missing;
    expect(missing).toContain("ivRank");
    expect(missing).toContain("ivPercentile");
    expect(missing).toContain("vix");
  });

  it("parseSuppressionReason splits the leading 'setup:' prefix", () => {
    // imported at top: parseSuppressionReason
    expect(parseSuppressionReason("trend_continuation: conditions not met"))
      .toEqual({ setupKey: "TREND_CONTINUATION", reason: "conditions not met" });
    expect(parseSuppressionReason("VWAP_RECLAIM: post-clamp RR < 1.4"))
      .toEqual({ setupKey: "VWAP_RECLAIM", reason: "post-clamp RR < 1.4" });
    expect(parseSuppressionReason("NO_BARS_OR_INSUFFICIENT_DATA"))
      .toEqual({ setupKey: null, reason: "NO_BARS_OR_INSUFFICIENT_DATA" });
    expect(parseSuppressionReason("")).toEqual({ setupKey: null, reason: "" });
  });

  it("classifySuppressionReason maps free-text to stable reason_code buckets", () => {
    // imported at top: classifySuppressionReason
    expect(classifySuppressionReason("opening-noise gate before 09:30 IST")).toBe("OPENING_NOISE");
    expect(classifySuppressionReason("late-session entry gate after 14:30 IST")).toBe("LATE_SESSION_ENTRY");
    expect(classifySuppressionReason("confidence 58 < HC emission floor 65 — demoted")).toBe("HC_FLOOR");
    expect(classifySuppressionReason("post-clamp RR < 1.4 — plan rejected")).toBe("POST_CLAMP_RR");
    expect(classifySuppressionReason("OI hard-veto on BULLISH bias")).toBe("OI_VETO");
    expect(classifySuppressionReason("post-OI confidence 60 < HC emission floor — OI conflict")).toBe("OI_CONFLICT");
    expect(classifySuppressionReason("conditions not met")).toBe("CONDITIONS_NOT_MET");
    expect(classifySuppressionReason("circuit-breaker veto: 2 stops today")).toBe("CIRCUIT_BREAKER");
    expect(classifySuppressionReason("correlation cap: redundant NIFTY signal")).toBe("CORRELATION_CAP");
    expect(classifySuppressionReason("flip cooldown")).toBe("BIAS_FLIP");
    expect(classifySuppressionReason("market_closed: post-market")).toBe("MARKET_CLOSED");
    expect(classifySuppressionReason("partial_indicators: not enough bars")).toBe("PARTIAL_INDICATORS");
    expect(classifySuppressionReason("no_live_kite_intraday (Kite session expired / throttled / index uncovered) — Yahoo fallback disabled to prevent stale-data signals")).toBe("NO_LIVE_KITE_INTRADAY");
    expect(classifySuppressionReason("daily_history_unavailable_kite (Yahoo fallback disabled — F&O is Kite-only)")).toBe("DAILY_HISTORY_UNAVAILABLE");
    expect(classifySuppressionReason("daily_history_warmup_kite (session 45s old — history API warming up, will retry)")).toBe("DAILY_HISTORY_WARMUP");
    expect(classifySuppressionReason("daily_history_warmup_kite (session 120s old)")).toBe("DAILY_HISTORY_WARMUP");
    expect(classifySuppressionReason("something else entirely")).toBe("OTHER");
  });

  it("buildPreEmissionRejectedRows produces one row per (index, reason)", () => {
    // imported at top: buildPreEmissionRejectedRows
    const rows = buildPreEmissionRejectedRows([
      { index: "NIFTY", reasons: ["trend_continuation: conditions not met", "VWAP_RECLAIM: post-clamp RR < 1.4"] },
      { index: "BANKNIFTY", reasons: ["TREND_CONTINUATION: OI hard-veto on BULLISH bias"] },
    ], "2026-05-15");
    expect(rows).toHaveLength(3);
    expect(rows.every((r: { decision: string }) => r.decision === "PRE_EMISSION_REJECTED")).toBe(true);
    expect(rows[0].indexSymbol).toBe("NIFTY");
    expect(rows[0].setupKey).toBe("TREND_CONTINUATION");
    expect(rows[0].reasonCode).toBe("CONDITIONS_NOT_MET");
    expect(rows[1].reasonCode).toBe("POST_CLAMP_RR");
    expect(rows[2].indexSymbol).toBe("BANKNIFTY");
    expect(rows[2].reasonCode).toBe("OI_VETO");
  });

  it("buildUpstreamReasoningRows combines emitted + rejected and tolerates empty inputs", () => {
    // imported at top: buildUpstreamReasoningRows
    const rows = buildUpstreamReasoningRows({
      signals: [EMITTED_SIG],
      suppressed: [{ index: "SENSEX", reasons: ["mean_reversion: conditions not met"] }],
      signalDate: "2026-05-15",
      vix: 13.0,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].decision).toBe("EMITTED");
    expect(rows[1].decision).toBe("PRE_EMISSION_REJECTED");
    expect(buildUpstreamReasoningRows({ signals: [], suppressed: [], signalDate: "2026-05-15" })).toEqual([]);
  });

  it("logUpstreamReasoningBatch never throws even when every write fails", async () => {
    const dbModule = await import("@workspace/db");
    const spy = vi.spyOn(dbModule.db, "insert").mockImplementation(() => ({
      values: () => Promise.reject(new Error("simulated outage")),
    } as unknown as ReturnType<typeof dbModule.db.insert>));
    const { logUpstreamReasoningBatch } = await import("./fnoSignalReasoningLogger");
    await expect(logUpstreamReasoningBatch({
      signals: [EMITTED_SIG],
      suppressed: [{ index: "NIFTY", reasons: ["trend_continuation: conditions not met"] }],
      signalDate: "2026-05-15",
      vix: 13,
    })).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it("no secret-shaped keys are leaked into EMITTED snapshot (no header/cookie/token in shape)", () => {
    const row = buildEmittedRow(EMITTED_SIG, "2026-05-15", 13);
    const json = JSON.stringify(row);
    expect(/token|secret|password|cookie|authorization/i.test(json)).toBe(false);
  });
});

describe("logFnoReasoning — non-blocking safety contract", () => {
  it("never throws even if the underlying DB insert rejects", async () => {
    // Hot-swap the @workspace/db `db` module's `insert` to a rejecting
    // spy. The logger must swallow the rejection via its internal
    // try/catch and a logger.warn. We assert no throw.
    const dbModule = await import("@workspace/db");
    const originalInsert = dbModule.db.insert.bind(dbModule.db);
    const spy = vi.spyOn(dbModule.db, "insert").mockImplementation(() => {
      return {
        values: () => Promise.reject(new Error("simulated db outage")),
      } as unknown as ReturnType<typeof originalInsert>;
    });

    await expect(
      logFnoReasoning({
        decision: "SKIPPED",
        signalDate: "2026-05-15",
        indexSymbol: "NIFTY",
        reasonCode: "LIQUIDITY_OI",
      }),
    ).resolves.toBe(false);

    spy.mockRestore();
  });

  it("never throws on malformed payload (e.g. all NaN numerics)", async () => {
    // This test spies on the underlying db.insert to prove logFnoReasoning
    // still returns true when malformed numerics reach the writer. Since
    // the writer-boundary guard (2026-07-16) refuses to write from a test
    // process by default, opt in with ALLOW_TEST_DB_WRITES=1 for this
    // specific case where the db is already spied — the guard's purpose
    // is to block accidental leaks into a real DB, and the spy proves
    // no real DB is touched here.
    const dbModule = await import("@workspace/db");
    const spy = vi.spyOn(dbModule.db, "insert").mockImplementation(() => {
      return {
        values: () => Promise.resolve([]),
      } as unknown as ReturnType<typeof dbModule.db.insert>;
    });

    const savedAllow = process.env.ALLOW_TEST_DB_WRITES;
    process.env.ALLOW_TEST_DB_WRITES = "1";
    try {
      await expect(
        logFnoReasoning({
          decision: "OPENED",
          signalDate: "2026-05-15",
          indexSymbol: "NIFTY",
          confidence: NaN,
          optionEntry: Infinity,
          spotStop: -Infinity,
        }),
      ).resolves.toBe(true);
    } finally {
      if (savedAllow === undefined) {
        delete process.env.ALLOW_TEST_DB_WRITES;
      } else {
        process.env.ALLOW_TEST_DB_WRITES = savedAllow;
      }
      spy.mockRestore();
    }
  });
});

describe("upstream reasoning dedupe — pure identity / state / selection", () => {
  const baseEmitted = (over: Partial<FnoReasoningPayload> = {}): FnoReasoningPayload => ({
    decision: "EMITTED",
    signalDate: "2026-05-15",
    indexSymbol: "NIFTY",
    setupKey: "TREND_CONTINUATION",
    direction: "BULLISH",
    optionType: "CE",
    selectedStrike: 23000,
    tier: "STANDARD",
    confidence: 72,
    ...over,
  });

  it("identity is stable across repeated identical payloads and differs by leg", () => {
    const a = reasoningDedupeIdentity(baseEmitted());
    const b = reasoningDedupeIdentity(baseEmitted());
    expect(a).toBe(b);
    const otherStrike = reasoningDedupeIdentity(baseEmitted({ selectedStrike: 23100 }));
    expect(otherStrike).not.toBe(a);
    const otherSide = reasoningDedupeIdentity(baseEmitted({ optionType: "PE" }));
    expect(otherSide).not.toBe(a);
  });

  it("a pre-supplied valid fingerprint is trusted; leg-less rows fall back to a px: proxy", () => {
    const withFp = reasoningDedupeIdentity({ signalFingerprint: "0123456789abcdef" });
    expect(withFp).toBe("fp:0123456789abcdef");
    const legless = reasoningDedupeIdentity({
      decision: "PRE_EMISSION_REJECTED",
      signalDate: "2026-05-15",
      indexSymbol: "BANKNIFTY",
      setupKey: "VWAP_REVERSION",
      direction: "BEARISH",
    } as FnoReasoningPayload);
    expect(legless.startsWith("px:")).toBe(true);
    expect(legless).toContain("BANKNIFTY");
  });

  it("state key normalises decision + reason_code and is case/whitespace stable", () => {
    expect(reasoningStateKey({ decision: "emitted", reasonCode: " ok " })).toBe("EMITTED|OK");
    expect(reasoningStateKey({ decision: "EMITTED" })).toBe("EMITTED|");
    expect(reasoningStateKey({ decision: "EMITTED", reasonCode: null })).toBe("EMITTED|");
  });

  it("repeated (identity, state) is written once; a changed reason writes a new row", () => {
    const state = new Map<string, string>();
    // First sighting → written (and committed as if the write succeeded).
    expect(selectAndCommit([baseEmitted()], state)).toHaveLength(1);
    // Same identity + same state on the next tick → suppressed (the 88x killer).
    expect(selectAndCommit([baseEmitted()], state)).toHaveLength(0);
    // Same identity, NEW reason_code → a fresh transition row is written.
    expect(
      selectAndCommit([baseEmitted({ decision: "PRE_EMISSION_REJECTED", reasonCode: "HEAT_CAP" })], state),
    ).toHaveLength(1);
    // ...and that new state is now itself deduped.
    expect(
      selectAndCommit([baseEmitted({ decision: "PRE_EMISSION_REJECTED", reasonCode: "HEAT_CAP" })], state),
    ).toHaveLength(0);
  });

  it("does NOT advance state when the write is not committed (fail-open retry)", () => {
    const state = new Map<string, string>();
    // Selection alone (a write that then FAILS → no commit) must leave the
    // map untouched so the very next cycle retries the same transition.
    expect(selectUpstreamRowsToWrite([baseEmitted()], state)).toHaveLength(1);
    expect(state.size).toBe(0);
    expect(selectUpstreamRowsToWrite([baseEmitted()], state)).toHaveLength(1);
  });

  it("collapses duplicates WITHIN a single batch", () => {
    const state = new Map<string, string>();
    const batch = [baseEmitted(), baseEmitted(), baseEmitted({ selectedStrike: 23100 })];
    const written = selectUpstreamRowsToWrite(batch, state);
    expect(written).toHaveLength(2); // two distinct legs, the dup is dropped
  });

  it("a realistic multi-leg signal day lands within the 2-6 rows/signal target", () => {
    const state = new Map<string, string>();
    // One signal that transitions through a few distinct states across ticks,
    // each tick re-sending the prior states (which must be suppressed).
    let total = 0;
    total += selectAndCommit([baseEmitted({ reasonCode: "NEW" })], state).length;
    total += selectAndCommit([baseEmitted({ reasonCode: "NEW" })], state).length;
    total += selectAndCommit([baseEmitted({ decision: "PRE_EMISSION_REJECTED", reasonCode: "HTF1H_CONFLICT" })], state).length;
    total += selectAndCommit([baseEmitted({ decision: "PRE_EMISSION_REJECTED", reasonCode: "HTF1H_CONFLICT" })], state).length;
    total += selectAndCommit([baseEmitted({ reasonCode: "NEW" })], state).length;
    expect(total).toBeGreaterThanOrEqual(2);
    expect(total).toBeLessThanOrEqual(6);
  });
});
