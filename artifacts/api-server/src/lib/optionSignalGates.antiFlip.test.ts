/**
 * Anti-flip (bias-flip cooldown) + circuit-breaker invariant tests.
 *
 * isBiasFlipSuppressed is pure (reads only recentStopsByIndex), so it is
 * unit-testable without a DB. We also lock DAILY_STOP_LIMIT so the circuit
 * breaker threshold cannot silently drift.
 */
import { describe, expect, it } from "vitest";

import {
  isBiasFlipSuppressed,
  DAILY_STOP_LIMIT,
  BIAS_FLIP_COOLDOWN_MIN,
  type GateContext,
  type RecentStop,
} from "./optionSignalGates";

function ctxWith(stops: RecentStop[]): GateContext {
  const recentStopsByIndex = new Map<string, RecentStop>();
  for (const s of stops) recentStopsByIndex.set(s.indexSymbol, s);
  // Only recentStopsByIndex is read by isBiasFlipSuppressed; the rest is
  // filler so the object satisfies the type.
  return {
    stoppedToday: 0,
    paperStoppedToday: 0,
    modeledStoppedToday: 0,
    circuitBreakerActive: false,
    recentStopsByIndex,
    vix: { intradayPct: null, dayPct: null, spike: false, reason: null },
    globalSuppress: false,
    setupWinRates: new Map(),
    nifty5dReturn: null,
    notes: [],
  } as unknown as GateContext;
}

describe("isBiasFlipSuppressed", () => {
  it("suppresses a fresh signal that flips a recent stop's direction", () => {
    const ctx = ctxWith([
      {
        indexSymbol: "NIFTY",
        direction: "BEARISH",
        exitedAt: new Date(),
        minutesAgo: 10,
      },
    ]);
    const r = isBiasFlipSuppressed(ctx, "NIFTY", "BULLISH");
    expect(r.suppressed).toBe(true);
    expect(r.reason).toContain("bias-flip");
  });

  it("allows a same-direction signal after a stop (re-entry, not a flip)", () => {
    const ctx = ctxWith([
      {
        indexSymbol: "NIFTY",
        direction: "BEARISH",
        exitedAt: new Date(),
        minutesAgo: 10,
      },
    ]);
    expect(isBiasFlipSuppressed(ctx, "NIFTY", "BEARISH").suppressed).toBe(false);
  });

  it("allows a flip once the cooldown window has elapsed", () => {
    const ctx = ctxWith([
      {
        indexSymbol: "BANKNIFTY",
        direction: "BULLISH",
        exitedAt: new Date(),
        minutesAgo: BIAS_FLIP_COOLDOWN_MIN + 1,
      },
    ]);
    expect(isBiasFlipSuppressed(ctx, "BANKNIFTY", "BEARISH").suppressed).toBe(false);
  });

  it("does not suppress an index with no recent stop", () => {
    const ctx = ctxWith([]);
    expect(isBiasFlipSuppressed(ctx, "SENSEX", "BULLISH").suppressed).toBe(false);
  });
});

describe("circuit-breaker invariant", () => {
  it("daily stop limit is 2 (paper-trade stops arm the breaker under hygiene v2)", () => {
    expect(DAILY_STOP_LIMIT).toBe(2);
  });

  it("breaker semantics: effective stops >= limit ⇒ active", () => {
    // Mirrors loadGateContext's pure decision so the threshold is documented.
    const active = (effective: number) => effective >= DAILY_STOP_LIMIT;
    expect(active(0)).toBe(false);
    expect(active(1)).toBe(false);
    expect(active(2)).toBe(true);
    expect(active(3)).toBe(true);
  });
});
