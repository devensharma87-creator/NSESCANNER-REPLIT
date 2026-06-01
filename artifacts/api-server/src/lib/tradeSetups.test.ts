/**
 * Trade-setup derivation — pure-function tests.
 *
 * Locks in directional selection from bias score, entry/target/stop wiring to
 * pivots, R:R math, the null-RR degenerate guard, malformed-level skipping,
 * and determinism.
 *
 * REPORTING ONLY — no order placement / paper-trade / execution path consumes
 * this module.
 */
import { describe, expect, it } from "vitest";

import { deriveTradeSetups, type SetupLevels } from "./tradeSetups";

const NIFTY: SetupLevels = {
  symbol: "NIFTY 50",
  s2: 23300,
  s1: 23470,
  pivot: 23550,
  r1: 23720,
  r2: 23800,
};

describe("direction selection", () => {
  it("bullish bias → LONG setup", () => {
    const [s] = deriveTradeSetups({ biasScore: 4, levels: [NIFTY] });
    expect(s!.direction).toBe("LONG");
    expect(s!.entry).toBe(NIFTY.s1);
    expect(s!.target).toBe(NIFTY.r1);
    expect(s!.stop).toBe(NIFTY.s2);
  });

  it("bearish bias → SHORT setup", () => {
    const [s] = deriveTradeSetups({ biasScore: -4, levels: [NIFTY] });
    expect(s!.direction).toBe("SHORT");
    expect(s!.entry).toBe(NIFTY.r1);
    expect(s!.target).toBe(NIFTY.s1);
    expect(s!.stop).toBe(NIFTY.r2);
  });

  it("neutral bias → RANGE setup", () => {
    const [s] = deriveTradeSetups({ biasScore: 0, levels: [NIFTY] });
    expect(s!.direction).toBe("RANGE");
  });

  it("band edges: +2 long, -2 short", () => {
    expect(deriveTradeSetups({ biasScore: 2, levels: [NIFTY] })[0]!.direction).toBe("LONG");
    expect(deriveTradeSetups({ biasScore: -2, levels: [NIFTY] })[0]!.direction).toBe("SHORT");
    expect(deriveTradeSetups({ biasScore: 1.9, levels: [NIFTY] })[0]!.direction).toBe("RANGE");
  });
});

describe("risk-reward math", () => {
  it("short RR = reward/risk", () => {
    const [s] = deriveTradeSetups({ biasScore: -4, levels: [NIFTY] });
    // reward = |23720-23470| = 250, risk = |23720-23800| = 80 → 3.13
    expect(s!.riskReward).toBeCloseTo(250 / 80, 2);
  });

  it("long RR = reward/risk", () => {
    const [s] = deriveTradeSetups({ biasScore: 4, levels: [NIFTY] });
    // reward = |23470-23720| = 250, risk = |23470-23300| = 170 → 1.47
    expect(s!.riskReward).toBeCloseTo(250 / 170, 2);
  });

  it("zero-risk level sets are rejected by the validity guard (no setup emitted)", () => {
    // pivot == s1 would make a RANGE stop == entry (zero risk). The strict
    // ordering check in levelsValid rejects it up front, so no setup with a
    // null/degenerate R:R is ever surfaced. The internal rr() null-guard
    // remains as defence-in-depth but is unreachable via valid inputs.
    const bad: SetupLevels = { symbol: "X", s2: 90, s1: 100, pivot: 100, r1: 110, r2: 120 };
    expect(deriveTradeSetups({ biasScore: 0, levels: [bad] })).toHaveLength(0);
  });
});

describe("malformed levels", () => {
  it("skips out-of-order levels", () => {
    const broken: SetupLevels = { symbol: "BAD", s2: 200, s1: 100, pivot: 150, r1: 120, r2: 130 };
    expect(deriveTradeSetups({ biasScore: -4, levels: [broken] })).toHaveLength(0);
  });
  it("skips non-finite levels", () => {
    const broken: SetupLevels = { symbol: "BAD", s2: NaN, s1: 100, pivot: 150, r1: 200, r2: 250 };
    expect(deriveTradeSetups({ biasScore: -4, levels: [broken] })).toHaveLength(0);
  });
  it("keeps valid, drops invalid in a mixed batch", () => {
    const broken: SetupLevels = { symbol: "BAD", s2: 200, s1: 100, pivot: 150, r1: 120, r2: 130 };
    const out = deriveTradeSetups({ biasScore: -4, levels: [NIFTY, broken] });
    expect(out).toHaveLength(1);
    expect(out[0]!.symbol).toBe("NIFTY 50");
  });
});

describe("determinism", () => {
  it("identical inputs → identical output", () => {
    expect(deriveTradeSetups({ biasScore: -4, levels: [NIFTY] })).toEqual(
      deriveTradeSetups({ biasScore: -4, levels: [NIFTY] }),
    );
  });
});
