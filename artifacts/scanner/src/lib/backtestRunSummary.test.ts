import { describe, expect, it } from "vitest";
import {
  AUTO_DISABLED_FILTERS,
  DEFAULT_FILTERS,
  FILTER_ABBR,
  FILTER_LABELS,
  summarizeRunFilters,
  FILTER_PRESETS,
  FILTER_PRESET_ORDER,
  DEFAULT_PRESET_ID,
  matchPreset,
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

  it("a strategy's ignored filters are dropped from the active ON-list and listed as ignored", () => {
    // Range play: VWAP/EMA/Chop are ON in the run but ignored by this strategy.
    const { short } = summarizeRunFilters({ ...DEFAULT_FILTERS }, 5, [
      "vwapFilter",
      "emaTrendFilter",
      "avoidChopZone",
    ]);
    expect(short).toBe("Last15 · R:R 1.50 · ≤5/day · ignored VWAP·EMA·Chop");
  });

  it("ignored filters do not show in the ignored-tail when they were off in the run", () => {
    // EMA is OFF in the run, so although the strategy ignores it there is nothing to strike.
    const { short } = summarizeRunFilters(
      { emaTrendFilter: false },
      3,
      ["emaTrendFilter"],
    );
    expect(short).toBe("VWAP·Chop·Last15 · R:R 1.50 · ≤3/day");
    expect(short).not.toContain("ignored");
  });

  it("an ignored R:R is omitted from the active summary and flagged in the ignored-tail", () => {
    const { short } = summarizeRunFilters({ ...DEFAULT_FILTERS }, undefined, [
      "minimumRiskReward",
    ]);
    expect(short).toBe("VWAP·EMA·Chop·Last15 · ignored R:R");
    expect(short).not.toContain("R:R 1.50");
  });

  it("full tooltip annotates ignored toggles with '(ignored by this strategy)'", () => {
    const { full } = summarizeRunFilters({ ...DEFAULT_FILTERS }, 4, [
      "vwapFilter",
      "minimumRiskReward",
    ]);
    const lines = full.split("\n");
    expect(lines).toContain("VWAP Filter: on (ignored by this strategy)");
    expect(lines).toContain("EMA Trend Filter: on");
    expect(lines).toContain("Minimum Risk:Reward: 1.50 (ignored by this strategy)");
  });

  it("an empty or undefined ignored set leaves the summary unchanged", () => {
    const base = summarizeRunFilters({ ...DEFAULT_FILTERS }, 5);
    expect(summarizeRunFilters({ ...DEFAULT_FILTERS }, 5, []).short).toBe(base.short);
    expect(summarizeRunFilters({ ...DEFAULT_FILTERS }, 5, undefined).short).toBe(base.short);
    expect(summarizeRunFilters({ ...DEFAULT_FILTERS }, 5, null).short).toBe(base.short);
  });

  it("ignored filters never apply to engine-replay (null) rows", () => {
    const { short } = summarizeRunFilters(null, null, ["vwapFilter"]);
    expect(short).toBe("engine replay");
  });

  it("adds a 'Why ignored' line to the full tooltip when a rationale is supplied", () => {
    const { full } = summarizeRunFilters(
      { ...DEFAULT_FILTERS },
      4,
      ["vwapFilter", "emaTrendFilter"],
      "Range plays trade mean-reversion, not trend.",
    );
    const lines = full.split("\n");
    expect(lines).toContain("Why ignored: Range plays trade mean-reversion, not trend.");
    // The rationale sits beneath the filter lines but before the auto-disabled note.
    const whyIdx = lines.findIndex((l) => l.startsWith("Why ignored:"));
    const autoIdx = lines.findIndex((l) => l.startsWith("Auto-disabled"));
    expect(whyIdx).toBeGreaterThan(0);
    expect(whyIdx).toBeLessThan(autoIdx);
  });

  it("does not add a 'Why ignored' line when the strategy ignores nothing", () => {
    const { full } = summarizeRunFilters({ ...DEFAULT_FILTERS }, 4, [], "should not appear");
    expect(full).not.toContain("Why ignored:");
    expect(full).not.toContain("should not appear");
  });

  it("does not add a 'Why ignored' line when the rationale is blank even if filters are ignored", () => {
    const blank = summarizeRunFilters({ ...DEFAULT_FILTERS }, 4, ["vwapFilter"], "   ");
    expect(blank.full).not.toContain("Why ignored:");
    const missing = summarizeRunFilters({ ...DEFAULT_FILTERS }, 4, ["vwapFilter"]);
    expect(missing.full).not.toContain("Why ignored:");
  });

  it("never adds a rationale line to engine-replay rows", () => {
    const { full } = summarizeRunFilters(null, null, ["vwapFilter"], "irrelevant");
    expect(full).not.toContain("Why ignored:");
  });
});

describe("matchPreset", () => {
  it("each canonical preset round-trips to its own id", () => {
    for (const id of FILTER_PRESET_ORDER) {
      const p = FILTER_PRESETS[id];
      expect(matchPreset(p.filters, p.maxTradesPerDay)).toBe(id);
    }
  });

  it("default preset is Practical and is recognised", () => {
    expect(DEFAULT_PRESET_ID).toBe("PRACTICAL");
    const p = FILTER_PRESETS[DEFAULT_PRESET_ID];
    expect(matchPreset(p.filters, p.maxTradesPerDay)).toBe("PRACTICAL");
  });

  it("hand-tuned filters away from every preset return null (Custom)", () => {
    const p = FILTER_PRESETS.PRACTICAL;
    expect(matchPreset({ ...p.filters, vwapFilter: !p.filters.vwapFilter }, p.maxTradesPerDay)).toBeNull();
  });

  it("matching filters but a non-preset trade cap return null (Custom)", () => {
    const p = FILTER_PRESETS.PRACTICAL;
    expect(matchPreset(p.filters, 99)).toBeNull();
  });

  it("no preset sets minimumRiskReward above 1.5 (blended 1.5R reward must not starve strategies)", () => {
    for (const id of FILTER_PRESET_ORDER) {
      expect(FILTER_PRESETS[id].filters.minimumRiskReward).toBeLessThanOrEqual(1.5);
    }
  });
});
