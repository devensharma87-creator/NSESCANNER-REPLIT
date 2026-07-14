/**
 * P20 — Unit tests for the shadow F&O exit-rule simulator.
 *
 * Pure-function tests on `simulateRule`. No DB I/O. No live trading
 * behaviour is exercised — the simulator is reporting-only.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  simulateRule,
  SHADOW_RULE_PARAMS,
  isShadowExitsEnabled,
  type ShadowRuleId,
} from "./fnoShadowExits";

const ENTRY = 100;
const QTY = 75; // 1 lot NIFTY
const baseTrade = (over: Partial<{ exit: number; mfeAbs: number; mfeAvailable: boolean }> = {}) => ({
  entry: ENTRY,
  exit: over.exit ?? ENTRY,
  qty: QTY,
  mfeAbs: over.mfeAbs ?? 0,
  mfeAvailable: over.mfeAvailable ?? true,
});

const round = (x: number) => Math.round(x * 100) / 100;

describe("simulateRule — Rule 1 (T1=+30% / T2=+60% caps)", () => {
  it("books at T2 when MFE crossed +60%", () => {
    // MFE corresponds to peak premium gain of +75% (75 * 75 = 5625 rupees).
    const t = baseTrade({ exit: 130, mfeAbs: 0.75 * ENTRY * QTY });
    expect(round(simulateRule("RULE_1", t))).toBe(round(0.6 * ENTRY * QTY)); // 4500
  });

  it("books at T1 when MFE crossed +30% but not +60%", () => {
    const t = baseTrade({ exit: 110, mfeAbs: 0.4 * ENTRY * QTY });
    expect(round(simulateRule("RULE_1", t))).toBe(round(0.3 * ENTRY * QTY)); // 2250
  });

  it("falls through to actual exit when MFE < +30%", () => {
    const t = baseTrade({ exit: 95, mfeAbs: 0.1 * ENTRY * QTY });
    expect(round(simulateRule("RULE_1", t))).toBe(round((95 - 100) * QTY)); // -375
  });

  it("falls through to actual exit (loss) when MFE never positive", () => {
    const t = baseTrade({ exit: 70, mfeAbs: 0 });
    expect(round(simulateRule("RULE_1", t))).toBe(round((70 - 100) * QTY)); // -2250
  });
});

describe("simulateRule — Rule 2 (book 50% @+30%, trail to BE)", () => {
  it("books partial then trails to BE when MFE crossed +30% but trade ended below entry", () => {
    const t = baseTrade({ exit: 60, mfeAbs: 0.35 * ENTRY * QTY });
    // partial: 0.3 * 100 * 75 * 0.5 = 1125. remainder trails to BE → 0.
    const expected = 0.3 * ENTRY * QTY * 0.5 + 0; // 1125
    expect(round(simulateRule("RULE_2", t))).toBe(round(expected));
  });

  it("books partial + lets winner run when exit exceeds entry", () => {
    const t = baseTrade({ exit: 140, mfeAbs: 0.5 * ENTRY * QTY });
    // partial 1125 + remainder (140-100)*75*0.5 = 1500 → 2625.
    const expected = 0.3 * ENTRY * QTY * 0.5 + (140 - ENTRY) * QTY * 0.5;
    expect(round(simulateRule("RULE_2", t))).toBe(round(expected));
  });

  it("falls through to actual exit when MFE never crossed +30%", () => {
    const t = baseTrade({ exit: 105, mfeAbs: 0.1 * ENTRY * QTY });
    expect(round(simulateRule("RULE_2", t))).toBe(round((105 - 100) * QTY));
  });
});

describe("simulateRule — Rule 3 (book 50% @+50%, trail to BE)", () => {
  it("requires MFE ≥ +50% to trigger the partial", () => {
    const tNo = baseTrade({ exit: 120, mfeAbs: 0.45 * ENTRY * QTY });
    expect(round(simulateRule("RULE_3", tNo))).toBe(round((120 - 100) * QTY));

    const tYes = baseTrade({ exit: 30, mfeAbs: 0.7 * ENTRY * QTY });
    // partial 0.5*100*75*0.5 = 1875. remainder trail-to-BE → 0.
    expect(round(simulateRule("RULE_3", tYes))).toBe(round(0.5 * ENTRY * QTY * 0.5));
  });
});

describe("simulateRule — Rule 4 (trail-to-BE armed after MFE ≥ +50%, no partial)", () => {
  it("armed → exits at MAX(entry, actual). Big winner kept big.", () => {
    const t = baseTrade({ exit: 200, mfeAbs: 1.0 * ENTRY * QTY });
    expect(round(simulateRule("RULE_4", t))).toBe(round((200 - 100) * QTY)); // 7500
  });

  it("armed but trade reversed → BE rescues a stopped-out trade.", () => {
    const t = baseTrade({ exit: 50, mfeAbs: 0.6 * ENTRY * QTY });
    expect(round(simulateRule("RULE_4", t))).toBe(0); // BE
  });

  it("not armed → falls through to actual exit (loss).", () => {
    const t = baseTrade({ exit: 50, mfeAbs: 0.3 * ENTRY * QTY });
    expect(round(simulateRule("RULE_4", t))).toBe(round((50 - 100) * QTY)); // -3750
  });
});

describe("simulateRule — edge cases", () => {
  it("returns 0 when entry is non-positive", () => {
    const ids: ShadowRuleId[] = ["RULE_1", "RULE_2", "RULE_3", "RULE_4"];
    for (const r of ids) {
      expect(simulateRule(r, { entry: 0, exit: 100, qty: 75, mfeAbs: 0, mfeAvailable: true })).toBe(0);
    }
  });

  it("returns 0 when qty is non-positive", () => {
    const ids: ShadowRuleId[] = ["RULE_1", "RULE_2", "RULE_3", "RULE_4"];
    for (const r of ids) {
      expect(simulateRule(r, { entry: 100, exit: 130, qty: 0, mfeAbs: 1000, mfeAvailable: true })).toBe(0);
    }
  });

  it("matches the actual exit P&L when no shadow rule is triggered (Rule 1 below T1)", () => {
    const t = baseTrade({ exit: 102, mfeAbs: 0.02 * ENTRY * QTY });
    const actual = (102 - 100) * QTY;
    expect(round(simulateRule("RULE_1", t))).toBe(round(actual));
  });

  it("uses configured params (custom params override)", () => {
    const t = baseTrade({ exit: 200, mfeAbs: 0.25 * ENTRY * QTY });
    // With default Rule 1 params, MFE < t1Pct=0.3 → falls through to actual exit.
    expect(round(simulateRule("RULE_1", t))).toBe(round((200 - 100) * QTY));
    // With tighter custom params (t1Pct=0.2, t2Pct=0.4), MFE>=0.2 → books at T1.
    const tight = {
      ...SHADOW_RULE_PARAMS,
      rule1: { t1Pct: 0.2, t2Pct: 0.4 },
    };
    expect(round(simulateRule("RULE_1", t, tight))).toBe(round(0.2 * ENTRY * QTY));
  });
});

describe("MFE/MAE behavior — observability acceptance criteria", () => {
  // These tests document the GREATEST/LEAST semantics that the production
  // SQL applies to paper_trade_fo.max_runup / max_drawdown. The simulator
  // consumes those values; here we assert the SQL contract those values
  // satisfy. Pure JS reproduction — no DB.
  const greatest = (a: number, b: number) => Math.max(a, b);
  const least = (a: number, b: number) => Math.min(a, b);
  const qty = 75;
  const entry = 100;
  // Simulate a sequence of ltp ticks through the running MTM loop.
  const reduceMfeMae = (ticks: number[]) => {
    let mfe = 0;
    let mae = 0;
    for (const ltp of ticks) {
      const upnl = (ltp - entry) * qty;
      mfe = greatest(mfe, upnl);
      mae = least(mae, upnl);
    }
    return { mfe, mae };
  };

  it("ltp visits +20%, +85%, +57% → max_runup is the +85% peak", () => {
    const { mfe } = reduceMfeMae([120, 185, 157]);
    expect(mfe).toBe(0.85 * entry * qty); // 6375
  });

  it("ltp visits +20%, +5%, -30% → max_drawdown is the -30% trough", () => {
    const { mae } = reduceMfeMae([120, 105, 70]);
    expect(mae).toBe(-0.3 * entry * qty); // -2250
  });

  it("max_runup never resets downward when later ticks are smaller positive moves", () => {
    const { mfe } = reduceMfeMae([200, 110, 105]);
    expect(mfe).toBe(entry * qty); // peak +100% pinned
  });

  it("max_drawdown never resets upward when later ticks are smaller negative moves", () => {
    const { mae } = reduceMfeMae([50, 80, 95]);
    expect(mae).toBe(-0.5 * entry * qty); // trough -50% pinned
  });

  it("a closed trade with realised exit -30% but observed peak +85% retains peak in MFE", () => {
    const { mfe, mae } = reduceMfeMae([185, 70]);
    expect(mfe).toBe(0.85 * entry * qty);
    expect(mae).toBe(-0.3 * entry * qty);
  });
});

describe("Shadow vs actual — invariants on a stopped-out trade with big MFE", () => {
  it("Rule 1 books T1 instead of letting the trade go to stop-loss", () => {
    // Real scenario from prod analysis: trade peaked at +106% then was
    // force-exited at +106% (TIME_EXIT_1520). Here we model the opposite:
    // peaked at +40% then got stopped out at -50%.
    const t = baseTrade({ exit: 50, mfeAbs: 0.4 * ENTRY * QTY });
    const actual = (50 - 100) * QTY; // -3750
    expect(actual).toBeLessThan(0);
    const rule1 = simulateRule("RULE_1", t);
    expect(rule1).toBeGreaterThan(actual);
    expect(round(rule1)).toBe(round(0.3 * ENTRY * QTY)); // booked at +30%
  });

  it("Rule 4 trail-to-BE turns a stopped-out trade into a flat outcome", () => {
    const t = baseTrade({ exit: 50, mfeAbs: 0.55 * ENTRY * QTY });
    const actual = (50 - 100) * QTY;
    const rule4 = simulateRule("RULE_4", t);
    expect(rule4).toBe(0);
    expect(rule4 - actual).toBe(3750);
  });

  it("low-MFE trades that legitimately failed are NOT rescued by any rule", () => {
    // MFE < all rule thresholds (30%, 30%, 50%, 50%) → every rule falls
    // through to actual.
    const t = baseTrade({ exit: 50, mfeAbs: 0.1 * ENTRY * QTY });
    const actual = (50 - 100) * QTY;
    for (const r of ["RULE_1", "RULE_2", "RULE_3", "RULE_4"] as ShadowRuleId[]) {
      expect(simulateRule(r, t)).toBe(actual);
    }
  });
});

describe("isShadowExitsEnabled feature flag", () => {
  const KEY = "PAPER_FO_SHADOW_EXITS_ENABLED";
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[KEY];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  it("defaults to true when unset", () => {
    delete process.env[KEY];
    expect(isShadowExitsEnabled()).toBe(true);
  });

  it("is false for 0/false/no/off (case-insensitive)", () => {
    for (const v of ["0", "false", "FALSE", "no", "off"]) {
      process.env[KEY] = v;
      expect(isShadowExitsEnabled()).toBe(false);
    }
  });

  it("is true for any truthy-looking value", () => {
    for (const v of ["1", "true", "yes", "on", "anything"]) {
      process.env[KEY] = v;
      expect(isShadowExitsEnabled()).toBe(true);
    }
  });
});

describe("aggregateShadowExits (pure, no DB)", () => {
  const baseRow = {
    signal_date: "2026-05-18",
    index_symbol: "NIFTY",
    setup_key: "TREND_CONTINUATION",
    direction: "BULLISH",
    lots: 1,
    lot_size: 75,
    exit_reason: "STOPPED" as string | null,
    tier: "STANDARD" as string | null,
  };

  it("distinguishes rawRowCount from processedRowCount (invalid rows excluded)", async () => {
    const mod = await import("./fnoShadowExits");
    const rows = [
      // valid
      { id: "a", ...baseRow, entry_premium: "100", exit_premium: "120",
        max_runup: "1500", max_drawdown: "-200" },
      // invalid: entry<=0
      { id: "b", ...baseRow, entry_premium: "0", exit_premium: "10",
        max_runup: "0", max_drawdown: "0" },
      // invalid: qty=0 (lots=0)
      { id: "c", ...baseRow, lots: 0, entry_premium: "100", exit_premium: "120",
        max_runup: "0", max_drawdown: "0" },
    ];
    const r = mod.aggregateShadowExits(rows, { topN: 5 });
    expect(r.rawRowCount).toBe(3);
    expect(r.processedRowCount).toBe(1);
    expect(r.rowCount).toBe(1); // alias of processed
    expect(r.totals.actualPnl).toBeCloseTo(1500, 2); // (120-100)*75
  });

  it("flags pre-fix rows (max_runup==0 && max_drawdown==0) as mfeAvailable=false", async () => {
    const mod = await import("./fnoShadowExits");
    const rows = [
      { id: "pre", ...baseRow, entry_premium: "100", exit_premium: "150",
        max_runup: "0", max_drawdown: "0" }, // pre-fix
      { id: "post", ...baseRow, entry_premium: "100", exit_premium: "150",
        max_runup: "4000", max_drawdown: "-300" }, // post-fix
    ];
    const r = mod.aggregateShadowExits(rows, { topN: 5 });
    expect(r.processedRowCount).toBe(2);
    expect(r.mfeAvailableCount).toBe(1);
    expect(r.lowSampleWarning).toBe(true); // 1 < threshold (20)
  });

  it("reducedTopN only contains negative-delta trades", async () => {
    const mod = await import("./fnoShadowExits");
    // Trade that already won big: every shadow rule will under-perform
    // because BE trail caps the upside.
    const rows = [
      { id: "big-win", ...baseRow, entry_premium: "100", exit_premium: "200",
        max_runup: "8000", max_drawdown: "-100" },
    ];
    const r = mod.aggregateShadowExits(rows, { topN: 5 });
    expect(r.reducedTopN.every(t => t.bestDelta < 0)).toBe(true);
    expect(r.improvedTopN.every(t => t.bestDelta > 0)).toBe(true);
  });

  it("groups by setup / index / tier and sums actualPnl correctly", async () => {
    const mod = await import("./fnoShadowExits");
    const rows = [
      { id: "1", ...baseRow, entry_premium: "100", exit_premium: "120",
        max_runup: "2000", max_drawdown: "-100" }, // +1500
      { id: "2", ...baseRow, index_symbol: "BANKNIFTY", lot_size: 30,
        entry_premium: "100", exit_premium: "80",
        max_runup: "200", max_drawdown: "-700" }, // -600
    ];
    const r = mod.aggregateShadowExits(rows, { topN: 5 });
    expect(r.bySetup).toHaveLength(1);
    expect(r.byIndex).toHaveLength(2);
    expect(r.bySetup[0]!.actualPnl).toBeCloseTo(900, 2); // 1500 - 600
    expect(r.totals.actualPnl).toBeCloseTo(900, 2);
  });

  it("respects enabled flag without altering counts", async () => {
    const mod = await import("./fnoShadowExits");
    const rows = [
      { id: "1", ...baseRow, entry_premium: "100", exit_premium: "120",
        max_runup: "2000", max_drawdown: "-100" },
    ];
    const r = mod.aggregateShadowExits(rows, { topN: 5, enabled: false });
    expect(r.enabled).toBe(false);
    expect(r.processedRowCount).toBe(1);
  });
});
