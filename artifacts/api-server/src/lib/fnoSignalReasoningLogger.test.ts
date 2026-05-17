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

import {
  buildReasoningRow,
  logFnoReasoning,
  normaliseFilters,
  type FnoReasoningPayload,
} from "./fnoSignalReasoningLogger";

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
    ).resolves.toBeUndefined();

    spy.mockRestore();
  });

  it("never throws on malformed payload (e.g. all NaN numerics)", async () => {
    const dbModule = await import("@workspace/db");
    const spy = vi.spyOn(dbModule.db, "insert").mockImplementation(() => {
      return {
        values: () => Promise.resolve([]),
      } as unknown as ReturnType<typeof dbModule.db.insert>;
    });

    await expect(
      logFnoReasoning({
        decision: "OPENED",
        signalDate: "2026-05-15",
        indexSymbol: "NIFTY",
        confidence: NaN,
        optionEntry: Infinity,
        spotStop: -Infinity,
      }),
    ).resolves.toBeUndefined();

    spy.mockRestore();
  });
});
