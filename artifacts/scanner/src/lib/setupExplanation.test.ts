/**
 * Per-setup explanation pure-derivation tests (P3).
 *
 * Locks in: the paper-trade-allowed flag is server-authoritative (tradeClass),
 * and the human reason is labelled from existing veto/premium/tier fields in the
 * engine's priority order — never fabricated, never re-deriving a threshold.
 */
import { describe, expect, it } from "vitest";

import type { OptionSignal } from "@workspace/api-client-react";
import {
  deriveSetupExplanation,
  derivePaperTradeReason,
  VETO_TAG,
} from "./setupExplanation";

const sig = (over: Partial<OptionSignal> = {}): OptionSignal => ({
  index: "NIFTY",
  indexName: "NIFTY 50",
  spot: 23000,
  bias: "STRONG_BUY",
  confidence: 72,
  tier: "HIGH_CONVICTION",
  tradeClass: "TRADEABLE",
  premiumSource: "kite",
  premiumTrusted: true,
  dataQuality: "LIVE_KITE_FULL",
  regime: "TREND_UP",
  regimeReason: "EMA stack rising, spot above VWAP",
  entryTrigger: "Spot touches/crosses above ₹23,050",
  tags: [],
  leg: {
    type: "CALL",
    strike: 23000,
    action: "BUY",
    entry: 23050,
    stopLoss: 22950,
    target1: 23200,
    riskRewardRatio: 1.5,
  },
  drivers: [],
  generatedAt: new Date("2026-06-10T04:00:00.000Z"),
  ...over,
});

describe("derivePaperTradeReason — server-authoritative tradeClass + labelled reason", () => {
  it("TRADEABLE when tradeClass is TRADEABLE", () => {
    expect(derivePaperTradeReason(sig())).toBe("TRADEABLE");
  });

  it("RECOVERY_VETO wins for a recovery-tagged, info-only signal", () => {
    const r = derivePaperTradeReason(
      sig({ tradeClass: "INFO_ONLY", tags: [VETO_TAG.RECOVERY] }),
    );
    expect(r).toBe("RECOVERY_VETO");
  });

  it("CHASE_VETO for a chase-tagged, info-only signal", () => {
    const r = derivePaperTradeReason(
      sig({ tradeClass: "INFO_ONLY", tags: [VETO_TAG.CHASE] }),
    );
    expect(r).toBe("CHASE_VETO");
  });

  it("PREMIUM_UNTRUSTED when info-only with no veto and untrusted premium", () => {
    const r = derivePaperTradeReason(
      sig({ tradeClass: "INFO_ONLY", tags: [], premiumTrusted: false }),
    );
    expect(r).toBe("PREMIUM_UNTRUSTED");
  });

  it("INFO_ONLY_TIER for a BASELINE-tier, premium-trusted info-only signal", () => {
    const r = derivePaperTradeReason(
      sig({ tradeClass: "INFO_ONLY", tier: "BASELINE", premiumTrusted: true }),
    );
    expect(r).toBe("INFO_ONLY_TIER");
  });

  it("falls back to INFO_ONLY when tradeClass is undefined (fail-closed)", () => {
    const r = derivePaperTradeReason(
      sig({ tradeClass: undefined, tier: "HIGH_CONVICTION", premiumTrusted: true }),
    );
    expect(r).toBe("INFO_ONLY");
  });
});

describe("deriveSetupExplanation — surfaces existing fields only", () => {
  it("a clean TRADEABLE call setup is paper-trade allowed", () => {
    const e = deriveSetupExplanation(sig());
    expect(e.paperTradeAllowed).toBe(true);
    expect(e.paperTradeReason).toBe("TRADEABLE");
    expect(e.direction).toBe("BUY CALL (bullish)");
    expect(e.tier).toBe("HIGH_CONVICTION");
    expect(e.regime).toBe("TREND_UP");
    expect(e.trigger).toBe("Spot touches/crosses above ₹23,050");
    expect(e.premiumSource).toBe("kite");
    expect(e.premiumTrusted).toBe(true);
    expect(e.dataQuality).toBe("LIVE_KITE_FULL");
    expect(e.riskReward).toBe(1.5);
    expect(e.vetoStatus).toBeNull();
  });

  it("a put setup reports bearish direction", () => {
    const e = deriveSetupExplanation(
      sig({ leg: { type: "PUT", strike: 23000, action: "BUY", entry: 22950, stopLoss: 23050, target1: 22800 } }),
    );
    expect(e.direction).toBe("BUY PUT (bearish)");
    expect(e.riskReward).toBeNull();
  });

  it("a recovery-vetoed setup is NOT allowed and shows the veto label", () => {
    const e = deriveSetupExplanation(
      sig({ tradeClass: "INFO_ONLY", tags: [VETO_TAG.RECOVERY] }),
    );
    expect(e.paperTradeAllowed).toBe(false);
    expect(e.paperTradeReason).toBe("RECOVERY_VETO");
    expect(e.vetoStatus).toBe("Recovery-mode veto");
    expect(e.paperTradeReasonText).toMatch(/recovery/i);
  });

  it("an untrusted-premium setup surfaces the premium warning honestly", () => {
    const e = deriveSetupExplanation(
      sig({
        tradeClass: "INFO_ONLY",
        premiumTrusted: false,
        premiumSource: "nse",
        premiumWarning: "NSE fallback chain (not Kite)",
      }),
    );
    expect(e.paperTradeAllowed).toBe(false);
    expect(e.paperTradeReason).toBe("PREMIUM_UNTRUSTED");
    expect(e.premiumTrusted).toBe(false);
    expect(e.premiumWarning).toBe("NSE fallback chain (not Kite)");
  });

  it("absent optional fields degrade to null / placeholders, never throw", () => {
    const e = deriveSetupExplanation(
      sig({
        tier: undefined,
        regime: undefined,
        regimeReason: undefined,
        entryTrigger: undefined,
        dataQuality: undefined,
        premiumSource: undefined,
      }),
    );
    expect(e.tier).toBe("—");
    expect(e.regime).toBeNull();
    expect(e.regimeReason).toBeNull();
    expect(e.trigger).toBeNull();
    expect(e.dataQuality).toBeNull();
    expect(e.premiumSource).toBeNull();
  });
});
