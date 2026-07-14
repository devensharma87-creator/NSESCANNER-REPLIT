/**
 * Tamper-resistance unit tests for the combo confirm dialog payload.
 *
 * The whole point of these tests is to lock down what the CLIENT can
 * send to /api/paper/combos. The server treats every leg as untrusted
 * input (sanitizeLegSpec re-strips premium/iv) but the client must NOT
 * even try to send trusted fields — that's our defense-in-depth.
 */
import { describe, it, expect } from "vitest";
import { payloadFromLegs } from "./paper-combo-confirm-dialog";

describe("payloadFromLegs", () => {
  it("includes only the whitelisted leg fields", () => {
    const body = payloadFromLegs({
      underlying: "NIFTY",
      expiry: "2026-05-19",
      legs: [
        { action: "BUY", optionType: "CE", strike: 23400, lots: 1 },
        { action: "SELL", optionType: "CE", strike: 23500, lots: 1 },
      ],
    });
    expect(body.underlying).toBe("NIFTY");
    expect(body.expiry).toBe("2026-05-19");
    expect(body.legs).toHaveLength(2);
    for (const leg of body.legs) {
      // Whitelist of allowed leg keys — anything else is a tamper risk.
      expect(Object.keys(leg).sort()).toEqual(
        ["action", "lots", "optionType", "strike"].sort(),
      );
    }
  });

  it("never carries premium / iv / Greeks / margin / P&L even if smuggled in", () => {
    // Force-cast a polluted leg shape — simulates a future regression where
    // someone wires `LegDraft.premiumOverride` straight into the payload.
    const dirty = [
      {
        action: "BUY" as const,
        optionType: "CE" as const,
        strike: 23400,
        lots: 1,
        // Tamper-attempt fields:
        premium: 0.01,
        premiumOverride: 0.01,
        iv: 999,
        delta: 1,
        gamma: 0,
        vega: 0,
        theta: 0,
        marginRequired: 0,
        pnl: 9_999_999,
      },
    ];
    const body = payloadFromLegs({
      underlying: "NIFTY",
      expiry: "2026-05-19",
      legs: dirty as unknown as Array<{
        action: "BUY" | "SELL";
        optionType: "CE" | "PE";
        strike: number;
        lots: number;
      }>,
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/premium/i);
    expect(serialized).not.toMatch(/\biv\b/i);
    expect(serialized).not.toMatch(/delta|gamma|vega|theta/i);
    expect(serialized).not.toMatch(/margin/i);
    expect(serialized).not.toMatch(/pnl/i);
    // …but still kept the whitelisted fields
    expect(body.legs[0]).toEqual({
      action: "BUY",
      optionType: "CE",
      strike: 23400,
      lots: 1,
    });
  });

  it("normalises lots: floors floats and clamps to >= 1", () => {
    const body = payloadFromLegs({
      underlying: "NIFTY",
      expiry: "2026-05-19",
      legs: [
        { action: "BUY", optionType: "CE", strike: 23400, lots: 2.9 },
        { action: "SELL", optionType: "CE", strike: 23500, lots: 0 },
      ],
    });
    expect(body.legs[0]!.lots).toBe(2);
    expect(body.legs[1]!.lots).toBe(1);
  });

  it("only sends strategyName/journal when explicitly provided", () => {
    const bare = payloadFromLegs({
      underlying: "NIFTY",
      expiry: "2026-05-19",
      legs: [{ action: "BUY", optionType: "CE", strike: 23400, lots: 1 }],
    });
    expect("strategyName" in bare).toBe(false);
    expect("journal" in bare).toBe(false);

    const full = payloadFromLegs({
      underlying: "NIFTY",
      expiry: "2026-05-19",
      strategyName: "Bull Call Spread",
      journal: "smoke",
      legs: [{ action: "BUY", optionType: "CE", strike: 23400, lots: 1 }],
    });
    expect(full.strategyName).toBe("Bull Call Spread");
    expect(full.journal).toBe("smoke");
  });
});
