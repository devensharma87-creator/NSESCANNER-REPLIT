/**
 * Paper-trading COMBO — unit tests for the tamper-resistance and
 * realised-P&L invariants. These are pure-helper tests; they do NOT
 * spin up Postgres. The DB-touching paths (`openCombo`, `closeCombo`,
 * `markComboToMarket`) are covered by the live-DB regression test
 * gated on `DATABASE_URL` (added separately).
 */
import { describe, it, expect } from "vitest";
import {
  computeRealizedPnl,
  sanitizeLegSpec,
} from "./paperTradingCombo";
import type { CustomLegSpec } from "./optionStrategies";

describe("paperTradingCombo / sanitizeLegSpec", () => {
  it("strips client-supplied premiumOverride and ivOverride", () => {
    const tampered = {
      strike: 25000,
      optionType: "CE" as const,
      action: "BUY" as const,
      lots: 1,
      // These are the tamper vectors we explicitly defend against.
      premiumOverride: 0.01, // pretend we paid ₹0.01 for a ₹200 option
      ivOverride: 9.99,
      // Stray garbage the open route should also ignore.
      extraField: "evil",
    } as unknown as CustomLegSpec & Record<string, unknown>;

    const clean = sanitizeLegSpec(tampered);

    expect(clean.strike).toBe(25000);
    expect(clean.optionType).toBe("CE");
    expect(clean.action).toBe("BUY");
    expect(clean.lots).toBe(1);
    expect(clean.premiumOverride).toBeNull();
    expect(clean.ivOverride).toBeNull();
    // No extra keys leaked.
    expect(Object.keys(clean).sort()).toEqual(
      ["action", "ivOverride", "lots", "optionType", "premiumOverride", "strike"].sort(),
    );
  });
});

describe("paperTradingCombo / computeRealizedPnl", () => {
  it("computes a long-call winning trade", () => {
    // 1 lot of NIFTY (qty=50) bought at ₹100, exited at ₹150 → +₹2,500.
    const pnl = computeRealizedPnl([
      { action: "BUY", qty: 50, entryPremium: 100, exitPremium: 150 },
    ]);
    expect(pnl).toBe(2500);
  });

  it("computes a short-call losing trade (sign flip)", () => {
    // SELL 50 @ ₹100, exit ₹150 → -₹2,500 for the seller.
    const pnl = computeRealizedPnl([
      { action: "SELL", qty: 50, entryPremium: 100, exitPremium: 150 },
    ]);
    expect(pnl).toBe(-2500);
  });

  it("computes a debit bull-call-spread net P&L", () => {
    // Long 25000C @ ₹120, Short 25200C @ ₹40 → net debit ₹80/share, 1 lot
    // (qty=50). Underlying expires above 25200 → both legs go to spread
    // width ₹200 intrinsic on the long, max profit per lot = (200-80)*50 = 6000.
    const pnl = computeRealizedPnl([
      { action: "BUY", qty: 50, entryPremium: 120, exitPremium: 200 },  // +4000
      { action: "SELL", qty: 50, entryPremium: 40, exitPremium: 0 },    // +2000
    ]);
    expect(pnl).toBe(6000);
  });

  it("computes a credit iron condor closed at zero credit", () => {
    // Sold for ₹50 net credit, bought back at ₹50 → realized = 0.
    // Two longs (wings) @ ₹10, two shorts (body) @ ₹35.
    const pnl = computeRealizedPnl([
      { action: "BUY",  qty: 50, entryPremium: 10, exitPremium: 10 }, //  0
      { action: "SELL", qty: 50, entryPremium: 35, exitPremium: 35 }, //  0
      { action: "SELL", qty: 50, entryPremium: 35, exitPremium: 35 }, //  0
      { action: "BUY",  qty: 50, entryPremium: 10, exitPremium: 10 }, //  0
    ]);
    expect(pnl).toBe(0);
  });

  it("rounds to 2 decimal places", () => {
    const pnl = computeRealizedPnl([
      { action: "BUY", qty: 1, entryPremium: 1.005, exitPremium: 1.015 },
    ]);
    expect(pnl).toBe(0.01);
  });

  it("returns 0 for an empty leg list", () => {
    expect(computeRealizedPnl([])).toBe(0);
  });
});
