/**
 * Regime-change → liveTapRing tap test.
 *
 * Verifies the fire-and-forget dynamic-import path in
 * `classifyRegimeWithHysteresis` emits a `REGIME_CHANGE` event only on
 * a STABLE regime edge (post-hysteresis) and never during the pending
 * accumulation phase. Also covers the EXPIRY_DAY bypass branch.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  classifyRegimeWithHysteresis,
  __resetRegimeHysteresisForTests,
  type RegimeContext,
} from "./regimeClassifier";
import { _resetLiveTapRing, drainSince } from "./liveTapRing";

const IDX = "NIFTY";

// Real RegimeContext factories tuned so each preset lands on a
// specific stable regime after enough consecutive reads.
function mkBars(n: number, base: number, drift: number, range: number): { h: number[]; l: number[]; c: number[] } {
  const h: number[] = [];
  const l: number[] = [];
  const c: number[] = [];
  for (let i = 0; i < n; i++) {
    const mid = base + drift * i;
    h.push(mid + range);
    l.push(mid - range);
    c.push(mid);
  }
  return { h, l, c };
}
function ctxTrending(): RegimeContext {
  // Strong up-trend: 40 bars drifting up, tight range → high ADX.
  return {
    bars: mkBars(40, 22_000, 25, 15),
    spot: 22_000 + 25 * 39,
    vwap: 22_400,
    ema9: 22_950,
    ema21: 22_450,
    atr15: 60,
    expiryWeekday: 4,
    expiryCadence: "weekly",
    now: new Date("2026-07-15T04:00:00Z"), // Wed — not expiry
  };
}
function ctxSideways(): RegimeContext {
  // Flat: base ±10 → low ADX, narrow BB → RANGING.
  const bars = mkBars(40, 22_000, 0, 10);
  return {
    bars,
    spot: 22_000,
    vwap: 22_000,
    ema9: 22_000,
    ema21: 22_000,
    atr15: 20,
    expiryWeekday: 4,
    expiryCadence: "weekly",
    now: new Date("2026-07-15T04:00:00Z"),
  };
}
function ctxExpiry(): RegimeContext {
  return {
    bars: mkBars(40, 22_000, 5, 15),
    spot: 22_050,
    vwap: 22_040,
    ema9: 22_020,
    ema21: 21_995,
    atr15: 40,
    expiryWeekday: 4,
    expiryCadence: "weekly",
    // 2026-07-16 is a Thursday — matches weekly expiry.
    now: new Date("2026-07-16T05:00:00Z"),
  };
}

// Give the fire-and-forget import.then() a moment to run.
const flushMicrotasks = () => new Promise((r) => setTimeout(r, 30));

beforeEach(() => {
  __resetRegimeHysteresisForTests(IDX);
  _resetLiveTapRing();
});

afterEach(() => {
  __resetRegimeHysteresisForTests(IDX);
});

describe("regimeClassifier → liveTapRing tap", () => {
  it("first-observation call emits NO regime-change event (no prior label)", async () => {
    classifyRegimeWithHysteresis(IDX, ctxTrending(), { hysteresisN: 3 });
    await flushMicrotasks();
    const drained = drainSince({ sinceMs: 0 });
    const regimeEvents = drained.systemEvents.filter((e) => e.kind === "REGIME_CHANGE");
    expect(regimeEvents).toHaveLength(0);
  });

  it("EXPIRY_DAY on a prior non-expiry stable label emits a REGIME_CHANGE with bypass flag", async () => {
    // Prime with trending.
    classifyRegimeWithHysteresis(IDX, ctxTrending(), { hysteresisN: 3 });
    await flushMicrotasks();
    _resetLiveTapRing(); // clear the priming step
    // Now expiry.
    classifyRegimeWithHysteresis(IDX, ctxExpiry(), { hysteresisN: 3 });
    await flushMicrotasks();
    const drained = drainSince({ sinceMs: 0 });
    const regimeEvents = drained.systemEvents.filter((e) => e.kind === "REGIME_CHANGE");
    expect(regimeEvents).toHaveLength(1);
    expect(regimeEvents[0]!.detail).toMatchObject({
      indexSymbol: IDX,
      to: "EXPIRY_DAY",
      bypassedHysteresis: true,
    });
  });

  it("EXPIRY_DAY → EXPIRY_DAY is not an edge (no event)", async () => {
    classifyRegimeWithHysteresis(IDX, ctxExpiry(), { hysteresisN: 3 });
    await flushMicrotasks();
    _resetLiveTapRing();
    classifyRegimeWithHysteresis(IDX, ctxExpiry(), { hysteresisN: 3 });
    await flushMicrotasks();
    const drained = drainSince({ sinceMs: 0 });
    expect(drained.systemEvents.filter((e) => e.kind === "REGIME_CHANGE")).toHaveLength(0);
  });

  it("pending accumulation (below hysteresis N) does NOT emit an event", async () => {
    // Prime trending stable.
    classifyRegimeWithHysteresis(IDX, ctxTrending(), { hysteresisN: 3 });
    await flushMicrotasks();
    _resetLiveTapRing();
    // Feed sideways once — pending starts at 1, below N=3, so stable
    // is still trending → no event.
    classifyRegimeWithHysteresis(IDX, ctxSideways(), { hysteresisN: 3 });
    await flushMicrotasks();
    const drained = drainSince({ sinceMs: 0 });
    expect(drained.systemEvents.filter((e) => e.kind === "REGIME_CHANGE")).toHaveLength(0);
  });
});
