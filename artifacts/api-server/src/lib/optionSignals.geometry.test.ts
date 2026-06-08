import { describe, expect, it } from "vitest";
import {
  applyTriggerRealism,
  clampPlanForIntraday,
  type Ctx,
  type Detected,
} from "./optionSignals.js";

// Task #104 geometry-repair invariants. applyTriggerRealism + clampPlanForIntraday
// only read c.spot / c.atr15 / c.cfg.symbol, so a minimal Ctx is sufficient.
function ctx(spot: number, atr15: number): Ctx {
  return { spot, atr15, cfg: { symbol: "NIFTY" } } as unknown as Ctx;
}

function det(partial: Partial<Detected> & Pick<Detected, "direction" | "entryLevel" | "stopLevel" | "targetLevel" | "target2Level">): Detected {
  return {
    setupKey: "TREND_CONTINUATION",
    setupName: "Trend",
    setupSummary: "",
    confidence: 70,
    drivers: [],
    entryTrigger: "",
    invalidation: "",
    ...partial,
  } as Detected;
}

describe("applyTriggerRealism re-anchor invariants", () => {
  it("pushes a BEARISH stale trigger (entry above spot) FORWARD below spot", () => {
    const c = ctx(24798, 50);
    // Structural bearish breakdown entry sits ABOVE spot -> already-past.
    const d = det({ direction: "BEARISH", entryLevel: 24858, stopLevel: 24908, targetLevel: 24758, target2Level: 24700 });
    const out = applyTriggerRealism(d, c);
    expect(out.entryAnchor).toBe("REANCHORED_TRIGGER");
    // Re-anchored bearish entry must sit BELOW spot (a genuine forward move).
    expect(out.entryLevel).toBeLessThan(c.spot);
    // Side preserved: bearish stop ABOVE entry, target BELOW entry.
    expect(out.stopLevel).toBeGreaterThan(out.entryLevel);
    expect(out.targetLevel).toBeLessThan(out.entryLevel);
    // Translation invariant: stop & target distances preserved pre-clamp.
    expect(Math.abs(out.stopLevel - out.entryLevel)).toBeCloseTo(Math.abs(d.stopLevel - d.entryLevel), 6);
    expect(Math.abs(out.targetLevel - out.entryLevel)).toBeCloseTo(Math.abs(d.targetLevel - d.entryLevel), 6);
  });

  it("pulls a too-far BULLISH trigger IN toward spot, preserving side & widths", () => {
    const c = ctx(20000, 30);
    // Entry 2% above spot -> beyond maxGap = max(0.5%*spot, 1.2*atr) = 100.
    const d = det({ direction: "BULLISH", entryLevel: 20400, stopLevel: 20300, targetLevel: 20600, target2Level: 20800 });
    const out = applyTriggerRealism(d, c);
    expect(out.entryAnchor).toBe("REANCHORED_TRIGGER");
    expect(out.entryLevel).toBeGreaterThan(c.spot);
    expect(out.entryLevel).toBeLessThan(d.entryLevel); // pulled inward
    expect(out.stopLevel).toBeLessThan(out.entryLevel); // bullish stop below
    expect(out.targetLevel).toBeGreaterThan(out.entryLevel);
    expect(Math.abs(out.targetLevel - out.entryLevel)).toBeCloseTo(Math.abs(d.targetLevel - d.entryLevel), 6);
  });

  it("leaves an already-reachable trigger untouched and tags it FRESH_TRIGGER", () => {
    const c = ctx(20000, 30);
    // Entry sits a small reachable gap (~40pts) ahead of spot, inside the band.
    const d = det({ direction: "BULLISH", entryLevel: 20040, stopLevel: 19990, targetLevel: 20120, target2Level: 20200 });
    const out = applyTriggerRealism(d, c);
    expect(out.entryAnchor).toBe("FRESH_TRIGGER");
    expect(out.entryLevel).toBe(d.entryLevel);
  });

  it("never re-anchors MEAN_REVERSION (by-design counter-trend)", () => {
    const c = ctx(20000, 30);
    const d = det({ setupKey: "MEAN_REVERSION", direction: "BEARISH", entryLevel: 20100, stopLevel: 20200, targetLevel: 19900, target2Level: 19800 });
    const out = applyTriggerRealism(d, c);
    expect(out.entryAnchor).toBeUndefined();
    expect(out.entryLevel).toBe(d.entryLevel);
  });
});

describe("clampPlanForIntraday reachability cap", () => {
  // Bullish plan with a far structural T1 so the reachability cap (not the
  // structural distance) is the binding constraint.
  const c = ctx(20000, 40);
  const base = det({ direction: "BULLISH", entryLevel: 20000, stopLevel: 19960, targetLevel: 20800, target2Level: 21200 });

  it("T1 distance is monotonic non-increasing as barsLeft shrinks (later in session)", () => {
    // minRr 0 so the RR gate never rejects — we isolate the cap's geometry.
    const early = clampPlanForIntraday(base, c, 0, 600); // ~10:00 IST, many bars left
    const late = clampPlanForIntraday(base, c, 0, 900); // ~15:00 IST, few bars left
    expect(early).not.toBeNull();
    expect(late).not.toBeNull();
    const earlyT1 = Math.abs(early!.targetLevel - base.entryLevel);
    const lateT1 = Math.abs(late!.targetLevel - base.entryLevel);
    expect(lateT1).toBeLessThanOrEqual(earlyT1);
  });

  it("rejects the plan when the reachability cap tightens T1 below the RR floor", () => {
    // Very late session (few bars left) -> tiny reachable T1; with a normal RR
    // floor the plan can no longer clear it and must be rejected (null), never
    // shipped as an unreachable target.
    const rejected = clampPlanForIntraday(base, c, 1.4, 905); // 15:05 IST, 1 bar left
    expect(rejected).toBeNull();
  });
});
