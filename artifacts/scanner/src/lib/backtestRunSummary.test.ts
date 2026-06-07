import { describe, expect, it } from "vitest";
import {
  AUTO_DISABLED_FILTERS,
  DEFAULT_FILTERS,
  FILTER_ABBR,
  FILTER_LABELS,
  summarizeRunFilters,
} from "./backtestRunSummary";

describe("summarizeRunFilters", () => {
  it("null filters → engine-replay short label and engine-replay full tooltip", () => {
    const { short, full } = summarizeRunFilters(null, null);
    expect(short).toBe("engine replay");
    expect(full).toBe(
      "Engine replay — this run used the official engine, not custom confirmation filters.",
    );
    // The engine-replay tooltip must NOT fabricate default filter rows.
    expect(full).not.toContain("VWAP");
    expect(full).not.toContain("R:R");
  });

  it("undefined filters are also treated as engine replay", () => {
    expect(summarizeRunFilters(undefined, 3).short).toBe("engine replay");
  });

  it("default filters → abbreviated ON-list, R:R and ≤N/day in the short summary", () => {
    // DEFAULT_FILTERS has vwap/ema/chop/last15 ON; R:R 1.5.
    const { short } = summarizeRunFilters({ ...DEFAULT_FILTERS }, 5);
    expect(short).toBe("VWAP·EMA·Chop·Last15 · R:R 1.50 · ≤5/day");
  });

  it("a partial config merged over defaults yields the expected abbreviated ON-list", () => {
    // Turn EMA and Last15 off; bump R:R. The rest fall back to defaults (VWAP/Chop ON).
    const { short } = summarizeRunFilters(
      { emaTrendFilter: false, avoidLast15Minutes: false, minimumRiskReward: 2.25 },
      2,
    );
    expect(short).toBe("VWAP·Chop · R:R 2.25 · ≤2/day");
  });

  it("omits the ≤N/day part when maxTradesPerDay is not a number", () => {
    const { short } = summarizeRunFilters({ ...DEFAULT_FILTERS }, null);
    expect(short).toBe("VWAP·EMA·Chop·Last15 · R:R 1.50");
    expect(short).not.toContain("/day");
  });

  it("shows 'no filters' when every abbreviated toggle is off", () => {
    const { short } = summarizeRunFilters(
      {
        vwapFilter: false,
        emaTrendFilter: false,
        avoidChopZone: false,
        avoidLast15Minutes: false,
        minimumRiskReward: 1,
      },
      undefined,
    );
    expect(short).toBe("no filters · R:R 1.00");
  });

  it("renders n/a when minimumRiskReward is not finite", () => {
    const { short } = summarizeRunFilters(
      { ...DEFAULT_FILTERS, minimumRiskReward: Number.NaN },
      undefined,
    );
    expect(short).toContain("R:R n/a");
  });

  it("auto-disabled filters appear only in the full tooltip, never the short summary", () => {
    const { short, full } = summarizeRunFilters({ ...DEFAULT_FILTERS }, 4);
    for (const key of AUTO_DISABLED_FILTERS) {
      // Auto-disabled toggles are absent from the abbreviation map and the short label.
      expect(FILTER_ABBR[key]).toBeUndefined();
      expect(short).not.toContain(FILTER_LABELS[key]);
    }
    expect(full).toContain("Auto-disabled (no historical data):");
    expect(full).toContain(FILTER_LABELS.optionChainConfirmation);
    expect(full).toContain(FILTER_LABELS.avoidWideSpread);
    expect(full).toContain(FILTER_LABELS.avoidLowVolume);
  });

  it("full tooltip lists each abbreviated toggle's on/off state plus R:R and max trades", () => {
    const { full } = summarizeRunFilters(
      { emaTrendFilter: false, minimumRiskReward: 1.5 },
      6,
    );
    const lines = full.split("\n");
    expect(lines).toContain("VWAP Filter: on");
    expect(lines).toContain("EMA Trend Filter: off");
    expect(lines).toContain("Avoid Chop Zone: on");
    expect(lines).toContain("Avoid Last 15 Minutes: on");
    expect(lines).toContain("Minimum Risk:Reward: 1.50");
    expect(lines).toContain("Max trades/day: 6");
  });
});
