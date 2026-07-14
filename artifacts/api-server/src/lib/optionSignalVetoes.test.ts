/**
 * Directional-veto pure-function tests (2026-06-09 hygiene fix).
 *
 * Locks in:
 *   - RECOVERY_MODE_VETO trips on a genuine multi-factor V-recovery, but
 *     NOT on a real trend-down day (so legitimate PUTs still emit).
 *   - CHASE_RISK_VETO trips on a late, extended, overbought vertical run,
 *     and UN-trips after a pullback/retest (re-tradeable, no extra state).
 *   - deriveTradeClass / isAutoTradeableSizingTier mapping (incl. flag-off
 *     rollback behaviour).
 */
import { describe, expect, it } from "vitest";

import {
  evaluateDirectionalVetoes,
  deriveTradeClass,
  isAutoTradeableSizingTier,
  assertTradeableForOpen,
  VETO_TAGS,
  type VetoInputs,
  type TradeOpenSignalView,
} from "./optionSignalVetoes";

describe("evaluateDirectionalVetoes — RECOVERY_MODE_VETO (blocks fresh PUT)", () => {
  it("trips on a genuine V-recovery off the intraday low", () => {
    const v: VetoInputs = {
      spot: 110,
      vwap: 104,
      ema9: 105,
      atr15: 10,
      rsi14: 55,
      // day low 96; last-3 min (99) > prior-3 min (96) → higher lows
      lows: [100, 98, 96, 99, 101, 103],
      highs: [102, 100, 99, 103, 105, 111],
      closes: [101, 99, 97, 100, 104, 110],
      // rsiNow 55 > rsiPast@offset4 (38) → rising; rsi14 55 ≥ 42 → reclaim
      rsiSeries: [35, 38, 40, 45, 50, 55],
    };
    const r = evaluateDirectionalVetoes(v);
    expect(r.recovery).toBe(true);
    expect(r.recoveryReason).toBeTruthy();
    // chase must not also fire on this modest extension (0.6×ATR)
    expect(r.chase).toBe(false);
  });

  it("does NOT trip on a real trend-down day (lower-lows, weak RSI)", () => {
    const v: VetoInputs = {
      spot: 100,
      vwap: 104,
      ema9: 106,
      atr15: 10,
      rsi14: 30,
      // continuous lower lows
      lows: [110, 108, 106, 104, 102, 100],
      highs: [112, 110, 108, 106, 104, 102],
      closes: [111, 109, 107, 105, 103, 100],
      rsiSeries: [45, 42, 40, 36, 33, 30],
    };
    const r = evaluateDirectionalVetoes(v);
    expect(r.recovery).toBe(false);
  });

  it("does NOT trip when the bounce off the low is too shallow", () => {
    const v: VetoInputs = {
      spot: 100, // only 0.4×ATR above day low 96
      vwap: 99,
      ema9: 99,
      atr15: 10,
      rsi14: 55,
      lows: [100, 98, 96, 99, 101, 99],
      highs: [102, 100, 99, 101, 102, 101],
      closes: [101, 99, 97, 100, 101, 100],
      rsiSeries: [35, 38, 40, 45, 50, 55],
    };
    const r = evaluateDirectionalVetoes(v);
    expect(r.recovery).toBe(false);
  });
});

describe("evaluateDirectionalVetoes — CHASE_RISK_VETO (blocks fresh CALL)", () => {
  const chaseTripped: VetoInputs = {
    spot: 125, // 2.5×ATR above VWAP 100
    vwap: 100,
    ema9: 118,
    atr15: 10,
    rsi14: 72, // overbought
    lows: [101, 102], // <6 → recovery guard skipped
    highs: [120, 125],
    closes: [100, 105, 110, 118, 125], // vertical = (125-100)/10 = 2.5×ATR
    rsiSeries: [55, 60, 65, 70, 72],
  };

  it("trips on a late, extended, overbought vertical run", () => {
    const r = evaluateDirectionalVetoes(chaseTripped);
    expect(r.chase).toBe(true);
    expect(r.chaseReason).toBeTruthy();
    expect(r.recovery).toBe(false);
  });

  it("UN-trips after a pullback/retest (re-tradeable, no extra state)", () => {
    const pulledBack: VetoInputs = {
      ...chaseTripped,
      spot: 108, // extension now 0.8×ATR above VWAP
      rsi14: 60, // no longer overbought
      closes: [100, 105, 110, 118, 108],
    };
    const r = evaluateDirectionalVetoes(pulledBack);
    expect(r.chase).toBe(false);
  });

  it("does NOT trip when extended but not overbought", () => {
    const r = evaluateDirectionalVetoes({ ...chaseTripped, rsi14: 64 });
    expect(r.chase).toBe(false);
  });
});

describe("veto base guards", () => {
  it("returns no vetoes when ATR is non-positive", () => {
    const r = evaluateDirectionalVetoes({
      spot: 110,
      vwap: 100,
      ema9: 105,
      atr15: 0,
      rsi14: 75,
      lows: [100, 98, 96, 99, 101, 103],
      highs: [102, 100, 99, 103, 105, 111],
      closes: [100, 105, 110, 118, 125],
      rsiSeries: [35, 38, 40, 45, 50, 55],
    });
    expect(r.recovery).toBe(false);
    expect(r.chase).toBe(false);
  });
});

describe("deriveTradeClass / isAutoTradeableSizingTier", () => {
  it("under hygiene v2 only HIGH_CONVICTION is TRADEABLE", () => {
    expect(deriveTradeClass("HIGH_CONVICTION", true)).toBe("TRADEABLE");
    expect(deriveTradeClass("BASELINE", true)).toBe("INFO_ONLY");
  });

  it("flag OFF reports TRADEABLE for both tiers (legacy lane restored)", () => {
    expect(deriveTradeClass("HIGH_CONVICTION", false)).toBe("TRADEABLE");
    expect(deriveTradeClass("BASELINE", false)).toBe("TRADEABLE");
  });

  it("a HIGH_CONVICTION signal demoted to BASELINE re-derives to INFO_ONLY", () => {
    // mirrors the post-OI tier mutation in applyOiConfirmation
    let tradeClass = deriveTradeClass("HIGH_CONVICTION", true);
    expect(tradeClass).toBe("TRADEABLE");
    const demotedTier = "BASELINE" as const;
    tradeClass = deriveTradeClass(demotedTier, true);
    expect(tradeClass).toBe("INFO_ONLY");
  });

  it("under hygiene v2 only STANDARD sizing tier is auto-tradeable", () => {
    expect(isAutoTradeableSizingTier("STANDARD", true)).toBe(true);
    expect(isAutoTradeableSizingTier("BASELINE", true)).toBe(false);
    expect(isAutoTradeableSizingTier("MICRO", true)).toBe(false);
  });

  it("flag OFF restores the legacy lane (all tiers tradeable)", () => {
    expect(isAutoTradeableSizingTier("BASELINE", false)).toBe(true);
    expect(isAutoTradeableSizingTier("MICRO", false)).toBe(true);
    expect(isAutoTradeableSizingTier("STANDARD", false)).toBe(true);
  });
});

describe("assertTradeableForOpen — paper-open tradeability gate (P1)", () => {
  const tradeable: TradeOpenSignalView = {
    sizingTier: "STANDARD",
    tradeClass: "TRADEABLE",
    premiumTrusted: true,
    tags: [],
    hygieneEnabled: true,
  };

  it("allows a STANDARD, TRADEABLE, Kite-trusted, veto-free signal", () => {
    const d = assertTradeableForOpen(tradeable);
    expect(d.trade_open_allowed).toBe(true);
    expect(d.reason).toBeNull();
    expect(d.detail).toBeNull();
  });

  it("blocks a BASELINE sizing tier as INFO_ONLY (cannot open)", () => {
    const d = assertTradeableForOpen({ ...tradeable, sizingTier: "BASELINE" });
    expect(d.trade_open_allowed).toBe(false);
    expect(d.reason).toBe("INFO_ONLY_NOT_TRADEABLE");
  });

  it("blocks an INFO_ONLY tradeClass even when sizing tier reads STANDARD", () => {
    const d = assertTradeableForOpen({ ...tradeable, tradeClass: "INFO_ONLY" });
    expect(d.trade_open_allowed).toBe(false);
    expect(d.reason).toBe("INFO_ONLY_NOT_TRADEABLE");
  });

  it("blocks a recovery-vetoed setup with the specific RECOVERY_VETO reason", () => {
    const d = assertTradeableForOpen({ ...tradeable, tags: [VETO_TAGS.RECOVERY] });
    expect(d.trade_open_allowed).toBe(false);
    expect(d.reason).toBe("RECOVERY_VETO");
    expect(d.detail).toMatch(/recovery/i);
  });

  it("blocks a chase-vetoed setup with the specific CHASE_VETO reason", () => {
    const d = assertTradeableForOpen({ ...tradeable, tags: [VETO_TAGS.CHASE] });
    expect(d.trade_open_allowed).toBe(false);
    expect(d.reason).toBe("CHASE_VETO");
    expect(d.detail).toMatch(/chase/i);
  });

  it("reports the veto reason ahead of a generic INFO_ONLY when both apply", () => {
    // A vetoed setup is also demoted to INFO_ONLY upstream; the precise veto
    // reason must still win for diagnostics.
    const d = assertTradeableForOpen({
      ...tradeable,
      tradeClass: "INFO_ONLY",
      sizingTier: "BASELINE",
      tags: [VETO_TAGS.RECOVERY],
    });
    expect(d.reason).toBe("RECOVERY_VETO");
  });

  it("blocks when premium is not Kite-trusted (undefined → fail-closed)", () => {
    const d = assertTradeableForOpen({ ...tradeable, premiumTrusted: undefined });
    expect(d.trade_open_allowed).toBe(false);
    expect(d.reason).toBe("PREMIUM_UNTRUSTED");
  });

  it("blocks when premium is explicitly untrusted", () => {
    const d = assertTradeableForOpen({ ...tradeable, premiumTrusted: false });
    expect(d.trade_open_allowed).toBe(false);
    expect(d.reason).toBe("PREMIUM_UNTRUSTED");
  });

  it("flag OFF: BASELINE may open again (legacy rollback) when premium trusted", () => {
    const d = assertTradeableForOpen({
      sizingTier: "BASELINE",
      tradeClass: "TRADEABLE",
      premiumTrusted: true,
      tags: [],
      hygieneEnabled: false,
    });
    expect(d.trade_open_allowed).toBe(true);
  });
});

describe("assertTradeableForOpen — reconcile-shaped synthetic view (regression)", () => {
  // reconcileMissingPaperTrades re-opens still-live triggers after a restart by
  // building a synthetic signal. It MUST stamp the same tradeClass the in-cycle
  // path derives from the resolved tier (deriveTradeClass) and empty tags — else
  // the P1 first gate (tradeClass undefined ≠ "TRADEABLE") refuses EVERY
  // reconciled open, silently killing mid-day-restart backfill for legit
  // Kite-trusted STANDARD rows. This locks the exact shape the reconcile path
  // now constructs.
  const reconcileView = (
    tier: "STANDARD" | "BASELINE",
    premiumTrusted: boolean,
    hygieneEnabled: boolean,
  ): TradeOpenSignalView => ({
    sizingTier: tier,
    tradeClass: deriveTradeClass(
      tier === "BASELINE" ? "BASELINE" : "HIGH_CONVICTION",
      hygieneEnabled,
    ),
    premiumTrusted,
    tags: [],
    hygieneEnabled,
  });

  it("hygiene ON: a Kite-trusted STANDARD reconcile row opens", () => {
    const d = assertTradeableForOpen(reconcileView("STANDARD", true, true));
    expect(d.trade_open_allowed).toBe(true);
    expect(d.reason).toBeNull();
  });

  it("hygiene ON: a BASELINE reconcile row stays INFO_ONLY (cannot open)", () => {
    const d = assertTradeableForOpen(reconcileView("BASELINE", true, true));
    expect(d.trade_open_allowed).toBe(false);
    expect(d.reason).toBe("INFO_ONLY_NOT_TRADEABLE");
  });

  it("an untrusted-premium reconcile row is refused regardless of tier", () => {
    const d = assertTradeableForOpen(reconcileView("STANDARD", false, true));
    expect(d.trade_open_allowed).toBe(false);
    expect(d.reason).toBe("PREMIUM_UNTRUSTED");
  });
});
