import { describe, it, expect } from "vitest";
import {
  buildCanonicalFnoReadiness,
  deriveFnoReadinessLabel,
  deriveMarketSessionLabel,
  type CanonicalFnoReadinessInputs,
  type FnoCycleMetaLike,
} from "./canonicalFnoReadiness";

// Monday 2026-06-08 10:00 IST (04:30 UTC) — a normal trading-session instant.
const OPEN_NOW = new Date("2026-06-08T04:30:00.000Z");
// Saturday — always closed regardless of holiday calendar.
const WEEKEND_NOW = new Date("2026-06-13T04:30:00.000Z");

function cycle(over: Partial<FnoCycleMetaLike> = {}): FnoCycleMetaLike {
  return {
    ts: OPEN_NOW.getTime(),
    indicesWithBars: 3,
    suppressed: [],
    suppressedSummary: "",
    signalCount: 2,
    highConvictionCount: 1,
    baselineCount: 1,
    ...over,
  };
}

function inputs(over: Partial<CanonicalFnoReadinessInputs> = {}): CanonicalFnoReadinessInputs {
  return {
    now: OPEN_NOW,
    kite: {
      sessionValid: true,
      sessionPresent: true,
      feedConnected: true,
      feedRunning: true,
      marketSession: "open",
    },
    cycle: cycle(),
    optionSnapshot: {
      enabled: true,
      lastRun: { underlyingsAttempted: 3, underlyingsOk: 3, errors: [] },
    },
    totalIndices: 3,
    paperAutoTradingEnabled: true,
    ...over,
  };
}

describe("buildCanonicalFnoReadiness", () => {
  it("returns READY end-to-end when every source is fully ready (test 7)", () => {
    const r = buildCanonicalFnoReadiness(inputs());
    expect(r.kiteSession).toBe("ACTIVE");
    expect(r.feedStatus).toBe("CONNECTED");
    expect(r.marketSession).toBe("open");
    expect(r.dailyBars.status).toBe("READY");
    expect(r.intradayBars.status).toBe("READY");
    expect(r.optionChain.status).toBe("READY");
    expect(r.signalCycle.status).toBe("READY");
    expect(r.tradeGrade).toBe(true);
    expect(r.canGenerateSignals).toBe(true);
    expect(r.canOpenPaperTrades).toBe(true);
    expect(deriveFnoReadinessLabel(r)).toBe("READY");
  });

  it("returns DATA_BLOCKED and never says 'not tracked yet' when intraday bars are missing (test 8)", () => {
    const r = buildCanonicalFnoReadiness(
      inputs({
        cycle: cycle({
          signalCount: 0,
          highConvictionCount: 0,
          baselineCount: 0,
          suppressed: [
            { index: "NIFTY", reasons: ["no_live_kite_intraday (Kite session expired / throttled / index uncovered)"] },
            { index: "BANKNIFTY", reasons: ["no_live_kite_intraday (Kite session expired / throttled / index uncovered)"] },
            { index: "SENSEX", reasons: ["no_live_kite_intraday (Kite session expired / throttled / index uncovered)"] },
          ],
        }),
      }),
    );
    expect(r.intradayBars.status).toBe("MISSING");
    expect(r.intradayBars.readyCount).toBe(0);
    expect(r.signalCycle.status).toBe("DATA_BLOCKED");
    expect(r.tradeGrade).toBe(false);
    expect(r.canGenerateSignals).toBe(false);
    expect(r.canOpenPaperTrades).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/not tracked yet/i);
    expect(r.intradayBars.reason).not.toBeNull();
    expect(r.intradayBars.reason).not.toMatch(/^UNKNOWN$/);
  });

  it("classifies a partial intraday failure (1 of 3 indices) as PARTIAL, not MISSING", () => {
    const r = buildCanonicalFnoReadiness(
      inputs({
        cycle: cycle({
          suppressed: [{ index: "SENSEX", reasons: ["no_live_kite_intraday (throttled)"] }],
        }),
      }),
    );
    expect(r.intradayBars.status).toBe("PARTIAL");
    expect(r.intradayBars.readyCount).toBe(2);
    expect(r.intradayBars.totalCount).toBe(3);
    expect(deriveFnoReadinessLabel(r)).toBe("PARTIAL");
  });

  it("attributes a daily-history-only failure to dailyBars, leaving intradayBars ready", () => {
    const r = buildCanonicalFnoReadiness(
      inputs({
        cycle: cycle({
          suppressed: [{ index: "NIFTY", reasons: ["daily_history_unavailable_kite (Yahoo fallback disabled)"] }],
        }),
      }),
    );
    expect(r.intradayBars.status).toBe("READY");
    expect(r.dailyBars.status).toBe("PARTIAL");
    expect(r.dailyBars.readyCount).toBe(2);
  });

  it("returns MARKET_CLOSED on a weekend regardless of data readiness (test 9)", () => {
    const r = buildCanonicalFnoReadiness(inputs({ now: WEEKEND_NOW, kite: { ...inputs().kite, marketSession: "closed" } }));
    expect(r.marketSession).toBe("closed");
    expect(r.signalCycle.status).toBe("MARKET_CLOSED");
    expect(deriveFnoReadinessLabel(r)).toBe("MARKET_CLOSED");
  });

  it("returns UNKNOWN when no cycle has ever run, and never fabricates readiness", () => {
    const r = buildCanonicalFnoReadiness(inputs({ cycle: null }));
    expect(r.dailyBars.status).toBe("UNKNOWN");
    expect(r.intradayBars.status).toBe("UNKNOWN");
    expect(r.signalCycle.status).toBe("UNKNOWN");
    expect(r.signalCycle.lastCycleAt).toBeNull();
    expect(r.tradeGrade).toBe(false);
    expect(r.canOpenPaperTrades).toBe(false);
  });

  it("returns NO_SETUP when data is fully ready but zero signals were generated", () => {
    const r = buildCanonicalFnoReadiness(
      inputs({ cycle: cycle({ signalCount: 0, highConvictionCount: 0, baselineCount: 0 }) }),
    );
    expect(r.signalCycle.status).toBe("NO_SETUP");
    expect(deriveFnoReadinessLabel(r)).toBe("NO_SETUP");
    expect(r.tradeGrade).toBe(true);
    expect(r.canOpenPaperTrades).toBe(false);
  });

  it("never marks Yahoo/cache/display-only paths as trade-grade: expired session forces tradeGrade false", () => {
    const r = buildCanonicalFnoReadiness(
      inputs({ kite: { sessionValid: false, sessionPresent: true, feedConnected: false, feedRunning: false, marketSession: "open" } }),
    );
    expect(r.kiteSession).toBe("EXPIRED");
    expect(r.tradeGrade).toBe(false);
    expect(r.canGenerateSignals).toBe(false);
  });

  it("marks kiteSession MISSING when no session was ever present", () => {
    const r = buildCanonicalFnoReadiness(
      inputs({ kite: { sessionValid: false, sessionPresent: false, feedConnected: false, feedRunning: false, marketSession: "closed" } }),
    );
    expect(r.kiteSession).toBe("MISSING");
  });

  it("marks feedStatus STALE when the ticker is running but not currently connected", () => {
    const r = buildCanonicalFnoReadiness(
      inputs({ kite: { sessionValid: true, sessionPresent: true, feedConnected: false, feedRunning: true, marketSession: "open" } }),
    );
    expect(r.feedStatus).toBe("STALE");
  });

  it("respects the dev/prod paper-trading gate: canOpenPaperTrades is false when disabled even if HC signals exist", () => {
    const r = buildCanonicalFnoReadiness(inputs({ paperAutoTradingEnabled: false }));
    expect(r.signalCycle.tradeableSignals).toBeGreaterThan(0);
    expect(r.canOpenPaperTrades).toBe(false);
  });

  it("reports option-chain MISSING with a reason when every underlying capture failed", () => {
    const r = buildCanonicalFnoReadiness(
      inputs({
        optionSnapshot: {
          enabled: true,
          lastRun: { underlyingsAttempted: 3, underlyingsOk: 0, errors: [{ underlying: "NIFTY", message: "timeout" }] },
        },
      }),
    );
    expect(r.optionChain.status).toBe("MISSING");
    expect(r.optionChain.reason).toContain("NIFTY");
  });

  it("reports option-chain UNKNOWN (not fabricated READY) when snapshot ingestion is disabled", () => {
    const r = buildCanonicalFnoReadiness(inputs({ optionSnapshot: { enabled: false, lastRun: null } }));
    expect(r.optionChain.status).toBe("UNKNOWN");
    expect(r.optionChain.reason).toBeTruthy();
  });

  it("populates a non-empty telegramSummary that includes the signal counts", () => {
    const r = buildCanonicalFnoReadiness(inputs());
    expect(r.telegramSummary).toContain("Signals: generated 2");
    expect(r.telegramSummary.length).toBeGreaterThan(0);
  });

  // ── GAP 4+5: per-index diagnostics + one-index failure isolation ─────────

  it("GAP4: indexDiagnostics is populated for all 3 indices when nothing is suppressed", () => {
    const r = buildCanonicalFnoReadiness(inputs({ cycle: cycle({ suppressed: [] }) }));
    expect(Object.keys(r.indexDiagnostics)).toHaveLength(3);
    for (const sym of ["NIFTY", "BANKNIFTY", "SENSEX"]) {
      const d = r.indexDiagnostics[sym];
      expect(d, `${sym} missing from indexDiagnostics`).toBeDefined();
      expect(d!.blocked).toBe(false);
      expect(d!.intradayBarsOk).toBe(true);
      expect(d!.dailyBarsOk).toBe(true);
      expect(d!.exactBlockReason).toBeNull();
    }
  });

  it("GAP4: SENSEX intraday fail marks SENSEX blocked; NIFTY and BANKNIFTY remain unblocked", () => {
    const r = buildCanonicalFnoReadiness(
      inputs({
        cycle: cycle({
          suppressed: [{ index: "SENSEX", reasons: ["no_live_kite_intraday: SENSEX bars unavailable"] }],
        }),
      }),
    );
    const sensex = r.indexDiagnostics["SENSEX"]!;
    expect(sensex.blocked).toBe(true);
    expect(sensex.intradayBarsOk).toBe(false);
    expect(sensex.dailyBarsOk).toBe(true); // daily never ran for this index
    expect(sensex.exactBlockReason).toBeTruthy();

    expect(r.indexDiagnostics["NIFTY"]!.blocked).toBe(false);
    expect(r.indexDiagnostics["BANKNIFTY"]!.blocked).toBe(false);
  });

  it("GAP4: BANKNIFTY daily fail → dailyBarsOk=false, intradayBarsOk=true", () => {
    const r = buildCanonicalFnoReadiness(
      inputs({
        cycle: cycle({
          suppressed: [{ index: "BANKNIFTY", reasons: ["daily_history_missing: no bars"] }],
        }),
      }),
    );
    const bk = r.indexDiagnostics["BANKNIFTY"]!;
    expect(bk.blocked).toBe(true);
    expect(bk.dailyBarsOk).toBe(false);
    expect(bk.intradayBarsOk).toBe(true); // intraday succeeded before daily failed
    expect(r.indexDiagnostics["NIFTY"]!.blocked).toBe(false);
    expect(r.indexDiagnostics["SENSEX"]!.blocked).toBe(false);
  });

  it("GAP5: telegramSummary includes per-index reason when an index is suppressed", () => {
    const r = buildCanonicalFnoReadiness(
      inputs({
        cycle: cycle({
          suppressed: [{ index: "SENSEX", reasons: ["no_live_kite_intraday: bars missing"] }],
        }),
      }),
    );
    expect(r.telegramSummary).toContain("Suppressed: SENSEX");
    expect(r.telegramSummary).toContain("SENSEX:");
  });

  it("GAP5: one-index fail isolates signals — NIFTY and BANKNIFTY diagnostics are unblocked", () => {
    const r = buildCanonicalFnoReadiness(
      inputs({
        cycle: cycle({
          signalCount: 3,
          highConvictionCount: 2,
          suppressed: [{ index: "SENSEX", reasons: ["no_live_kite_intraday: SENSEX only"] }],
        }),
      }),
    );
    // Signal counts are per-index signals not blocked by the failed index
    expect(r.signalCycle.generatedSignals).toBe(3);
    expect(r.signalCycle.tradeableSignals).toBe(2);
    expect(r.signalCycle.suppressedSignals).toBe(1);
    // The non-failing indices remain clean
    expect(r.indexDiagnostics["NIFTY"]!.blocked).toBe(false);
    expect(r.indexDiagnostics["BANKNIFTY"]!.blocked).toBe(false);
    // Only SENSEX is marked
    expect(r.indexDiagnostics["SENSEX"]!.blocked).toBe(true);
  });
});

describe("deriveMarketSessionLabel", () => {
  it("labels a weekday trading window as open", () => {
    expect(deriveMarketSessionLabel(OPEN_NOW, "open")).toBe("open");
  });

  it("labels a weekend as closed, not holiday", () => {
    expect(deriveMarketSessionLabel(WEEKEND_NOW, "closed")).toBe("closed");
  });

  it("maps the raw pre_open phase to preopen", () => {
    expect(deriveMarketSessionLabel(OPEN_NOW, "pre_open")).toBe("preopen");
  });
});
