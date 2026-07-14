/**
 * G — F&O Cockpit reason category classifier tests.
 */
import { describe, it, expect } from "vitest";
import {
  classifyFnoReason,
  summarizeFnoReasons,
  FNO_REASON_CATEGORY_LABEL,
} from "./fnoReasonCategories";

describe("G classifyFnoReason", () => {
  it("routes Kite session expired → DATA_FAILURE", () => {
    expect(classifyFnoReason("Kite session expired")).toBe("DATA_FAILURE");
    expect(classifyFnoReason("option chain unavailable")).toBe("DATA_FAILURE");
    expect(classifyFnoReason("data warmup: insufficient bars")).toBe("DATA_FAILURE");
  });

  it("routes market gates → MARKET_CLOSED", () => {
    expect(classifyFnoReason("market is closed")).toBe("MARKET_CLOSED");
    expect(classifyFnoReason("opening-noise gate (before 09:30 IST)")).toBe(
      "MARKET_CLOSED",
    );
    expect(classifyFnoReason("late-session entry gate (after 14:30 IST)")).toBe(
      "MARKET_CLOSED",
    );
  });

  it("routes broker off → BROKER_DISABLED", () => {
    expect(classifyFnoReason("broker execution disabled")).toBe(
      "BROKER_DISABLED",
    );
    expect(classifyFnoReason("kill switch active")).toBe("BROKER_DISABLED");
  });

  it("routes free-cash gates → CAPITAL_BLOCK", () => {
    expect(classifyFnoReason("INSUFFICIENT_CAPITAL")).toBe("CAPITAL_BLOCK");
    expect(classifyFnoReason("concurrent cap reached")).toBe("CAPITAL_BLOCK");
    expect(classifyFnoReason("daily cap: MAX_TRADES_PER_DAY=4")).toBe(
      "CAPITAL_BLOCK",
    );
  });

  it("routes risk-management gates → RISK_VETO", () => {
    expect(classifyFnoReason("bias flip cooldown 45m")).toBe("RISK_VETO");
    expect(classifyFnoReason("post-stop cooldown active")).toBe("RISK_VETO");
    expect(classifyFnoReason("consecutive stops circuit breaker")).toBe(
      "RISK_VETO",
    );
    expect(
      classifyFnoReason(
        "expiry-day gate (BUG-80: MEAN_REVERSION only on expiry)",
      ),
    ).toBe("RISK_VETO");
    expect(classifyFnoReason("vol_regime: EXTREME haircut applied")).toBe(
      "RISK_VETO",
    );
  });

  it("routes confidence/demote → SIGNAL_QUALITY", () => {
    expect(classifyFnoReason("confidence below 60")).toBe("SIGNAL_QUALITY");
    expect(classifyFnoReason("iv clamp — demoted")).toBe("SIGNAL_QUALITY");
    expect(classifyFnoReason("rvol below floor")).toBe("SIGNAL_QUALITY");
  });

  it("routes no-fire → NO_SETUP", () => {
    expect(classifyFnoReason("no setup fired today")).toBe("NO_SETUP");
    expect(classifyFnoReason("all detectors silent")).toBe("NO_SETUP");
  });

  it("falls back to OTHER for unknown text", () => {
    expect(classifyFnoReason("some novel reason not in the rules")).toBe(
      "OTHER",
    );
    expect(classifyFnoReason("")).toBe("OTHER");
  });

  it("has a label for every category", () => {
    const cats: (keyof typeof FNO_REASON_CATEGORY_LABEL)[] = [
      "DATA_FAILURE",
      "MARKET_CLOSED",
      "BROKER_DISABLED",
      "CAPITAL_BLOCK",
      "RISK_VETO",
      "SIGNAL_QUALITY",
      "NO_SETUP",
      "OTHER",
    ];
    for (const c of cats) expect(FNO_REASON_CATEGORY_LABEL[c]).toBeTruthy();
  });
});

describe("G summarizeFnoReasons", () => {
  it("groups and counts by category, preserving stable order", () => {
    const out = summarizeFnoReasons([
      "Kite session expired",
      "option chain unavailable",
      "confidence below 60",
      "post-stop cooldown active",
      "concurrent cap reached",
      "some novel reason",
    ]);
    // DATA_FAILURE first (2), then CAPITAL_BLOCK, RISK_VETO, SIGNAL_QUALITY, OTHER.
    expect(out[0].category).toBe("DATA_FAILURE");
    expect(out[0].count).toBe(2);
    const cats = out.map((o) => o.category);
    expect(cats).toContain("CAPITAL_BLOCK");
    expect(cats).toContain("RISK_VETO");
    expect(cats).toContain("SIGNAL_QUALITY");
    expect(cats[cats.length - 1]).toBe("OTHER");
  });

  it("caps samples[] to 3", () => {
    const many = Array.from({ length: 10 }).map(
      (_, i) => `Kite session expired ${i}`,
    );
    const out = summarizeFnoReasons(many);
    expect(out[0].category).toBe("DATA_FAILURE");
    expect(out[0].count).toBe(10);
    expect(out[0].samples).toHaveLength(3);
  });

  it("returns empty array for empty input", () => {
    expect(summarizeFnoReasons([])).toEqual([]);
  });
});
