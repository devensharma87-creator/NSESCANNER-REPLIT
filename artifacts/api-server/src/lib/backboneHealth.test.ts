/**
 * Tests for the unified market data backbone health roll-up (Task #131).
 *
 * Verifies the pure facts→points→per-module-readiness pipeline, especially the
 * honesty invariants:
 *   - session invalid ⇒ every trade-grade module BLOCKED with a reconnect hint,
 *     while info/display modules only DEGRADE (never falsely BLOCK).
 *   - market CLOSED with a valid session is HEALTHY (not an alarm).
 *   - a live cycle that produced no bars, or a failed warmup, honestly degrades
 *     the trade-grade modules — Kite being "active" is not enough.
 */
import { describe, it, expect } from "vitest";
import {
  buildBackbonePoints,
  buildBackboneHealth,
  type BackboneRuntimeFacts,
} from "./backboneHealth";
import type { WarmupRunResult } from "./kiteWarmup";

function facts(o: Partial<BackboneRuntimeFacts> = {}): BackboneRuntimeFacts {
  return {
    now: Date.parse("2026-07-02T06:00:00.000Z"), // ~11:30 IST (mid-session)
    sessionValid: true,
    sessionPresent: true,
    marketSession: "open",
    liveTicks: true,
    quoteStatus: "LIVE" as BackboneRuntimeFacts["quoteStatus"],
    warmup: null,
    cycle: null,
    ...o,
  };
}

type StepSpec = { step: string; ok: boolean; code?: string | null; message?: string | null };

function warmup(indices: { index: string; steps: StepSpec[] }[]): WarmupRunResult {
  const idx = indices.map((i) => ({
    index: i.index,
    ok: i.steps.every((s) => s.ok),
    steps: i.steps.map((s) => ({
      step: s.step as WarmupRunResult["indices"][number]["steps"][number]["step"],
      ok: s.ok,
      code: (s.code ?? null) as WarmupRunResult["indices"][number]["steps"][number]["code"],
      message: s.message ?? null,
      ms: 1,
    })),
  }));
  const okCount = idx.filter((i) => i.ok).length;
  return {
    outcome: okCount === idx.length ? "OK" : okCount === 0 ? "FAILED" : "PARTIAL",
    trigger: "manual",
    startedAt: "2026-07-02T06:00:00.000Z",
    finishedAt: "2026-07-02T06:00:01.000Z",
    durationMs: 1000,
    sessionLoginTime: null,
    indices: idx,
    reason: null,
  };
}

function moduleOf(facts: BackboneRuntimeFacts, id: string) {
  const health = buildBackboneHealth(buildBackbonePoints(facts));
  const m = health.find((h) => h.module === id);
  if (!m) throw new Error(`module ${id} missing`);
  return m;
}

describe("buildBackbone* — healthy paths", () => {
  it("market OPEN, session valid, live ticks ⇒ fno OK", () => {
    expect(moduleOf(facts(), "fno").status).toBe("OK");
  });

  it("market CLOSED with a valid session is healthy (fno OK, not an alarm)", () => {
    const m = moduleOf(facts({ marketSession: "closed", liveTicks: false }), "fno");
    expect(m.status).toBe("OK");
  });

  it("emits exactly the nine tracked modules", () => {
    const health = buildBackboneHealth(buildBackbonePoints(facts()));
    expect(health.map((h) => h.module).sort()).toEqual(
      ["charting", "fno", "home", "optionChain", "portfolio", "prePost", "scanner", "swing", "watchlist"].sort(),
    );
  });

  it("rolls the strictest requirement level per module", () => {
    const health = buildBackboneHealth(buildBackbonePoints(facts()));
    expect(health.find((h) => h.module === "fno")?.requirement).toBe("TRADE_GRADE_REQUIRED");
    expect(health.find((h) => h.module === "scanner")?.requirement).toBe("INFO_ONLY_ACCEPTABLE");
    expect(health.find((h) => h.module === "charting")?.requirement).toBe("DISPLAY_ONLY");
  });
});

describe("buildBackbone* — session invalid", () => {
  const f = facts({ sessionValid: false, sessionPresent: false, liveTicks: false, marketSession: "open" });

  it("BLOCKS fno with a reconnect recovery hint", () => {
    const m = moduleOf(f, "fno");
    expect(m.status).toBe("BLOCKED");
    expect(m.failures.length).toBeGreaterThan(0);
    expect(m.recoveryAction).toMatch(/Reconnect/i);
  });

  it("BLOCKS swing and optionChain (trade-grade consumers)", () => {
    expect(moduleOf(f, "swing").status).toBe("BLOCKED");
    expect(moduleOf(f, "optionChain").status).toBe("BLOCKED");
  });

  it("BLOCKS portfolio (its price quote is trade-grade)", () => {
    expect(moduleOf(f, "portfolio").status).toBe("BLOCKED");
  });

  it("only DEGRADES scanner (info-only) — never falsely BLOCKED", () => {
    const m = moduleOf(f, "scanner");
    expect(m.status).toBe("DEGRADED");
  });

  it("never BLOCKS home (info-only index quote falls back to delayed)", () => {
    expect(moduleOf(f, "home").status).not.toBe("BLOCKED");
  });

  it("keeps charting OK (display-only accepts delayed data)", () => {
    expect(moduleOf(f, "charting").status).toBe("OK");
  });
});

describe("buildBackbone* — degraded live/warmup evidence", () => {
  it("BLOCKS fno.optionChain when the warmup option-chain step failed for all indices", () => {
    const w = warmup([
      { index: "NIFTY", steps: [{ step: "optionChain", ok: false, code: "EXCHANGE_ERROR", message: "chain unavailable" }] },
      { index: "BANKNIFTY", steps: [{ step: "optionChain", ok: false, code: "EXCHANGE_ERROR", message: "chain unavailable" }] },
    ]);
    const m = moduleOf(facts({ warmup: w }), "fno");
    expect(m.status).toBe("BLOCKED");
    expect(m.failures.some((x) => x.startsWith("optionChain"))).toBe(true);
    expect(moduleOf(facts({ warmup: w }), "optionChain").status).toBe("BLOCKED");
  });

  it("BLOCKS fno.intradayCandles when the warmup step failed for SOME indices (partial→stale)", () => {
    const w = warmup([
      { index: "NIFTY", steps: [{ step: "intradayBars", ok: false, code: "THROTTLED", message: "rate limited" }] },
      { index: "BANKNIFTY", steps: [{ step: "intradayBars", ok: true }] },
    ]);
    const m = moduleOf(facts({ warmup: w }), "fno");
    expect(m.status).toBe("BLOCKED");
    expect(m.failures.some((x) => x.startsWith("intradayCandles"))).toBe(true);
  });

  it("BLOCKS fno when the market is open but the last cycle produced zero bars", () => {
    const m = moduleOf(
      facts({
        cycle: { indicesWithBars: 0, suppressed: [{ index: "NIFTY", reasons: ["no_live_kite_intraday"] }] },
      }),
      "fno",
    );
    expect(m.status).toBe("BLOCKED");
    expect(m.failures.length).toBeGreaterThan(0);
  });

  it("DEGRADES portfolio (trade-grade price OK, Yahoo benchmark is info-only)", () => {
    const m = moduleOf(facts(), "portfolio");
    expect(m.status).toBe("DEGRADED");
    const benchmark = m.requirements.find((r) => r.dataType === "benchmark");
    expect(benchmark?.readiness.status).toBe("DEGRADED");
  });
});
