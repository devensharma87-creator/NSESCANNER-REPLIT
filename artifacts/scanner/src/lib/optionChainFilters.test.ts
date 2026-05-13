import { describe, expect, it } from "vitest";
import {
  applyStrikeFilter,
  OI_SPIKE_MIN_OI,
  OI_SPIKE_MIN_RATIO,
  UNUSUAL_VOL_OI_RATIO,
} from "./optionChainFilters";
import type { OptionChainStrikeRow } from "@workspace/api-client-react";

/**
 * Tier-A unit tests for the option-chain strike-filter helpers.
 *
 * Why pin all six branches:
 *  - "Unusual Volume" (Vol/OI ≥ 1.5) and "OI Spike" (|ΔOI/OI| ≥ 15% AND
 *    OI ≥ 5000) are *different* signals. The OI-Spike filter was added
 *    after we noticed the existing "Unusual" filter was actually a
 *    volume-anomaly filter, mislabelled as OI-buildup. Tests here lock
 *    each criterion to its documented constants so a future edit can't
 *    silently drift them apart.
 *  - ATM windows must clamp at array boundaries; we also test the
 *    "ATM strike not in rows" fallback (returns the full row set, not []).
 */

function side(overrides: Partial<NonNullable<OptionChainStrikeRow["ce"]>> = {}): NonNullable<OptionChainStrikeRow["ce"]> {
  return {
    oi: 0,
    chgOi: 0,
    iv: 0,
    ltp: 0,
    bid: 0,
    ask: 0,
    volume: 0,
    volOiRatio: 0,
    pctOiChg: 0,
    delta: 0,
    gamma: 0,
    theta: 0,
    vega: 0,
    rho: 0,
    intrinsic: 0,
    timeValue: 0,
    moneyness: "ATM",
    ...overrides,
  } as NonNullable<OptionChainStrikeRow["ce"]>;
}

function row(strike: number, ce?: Partial<NonNullable<OptionChainStrikeRow["ce"]>>, pe?: Partial<NonNullable<OptionChainStrikeRow["pe"]>>): OptionChainStrikeRow {
  return {
    strike,
    ce: ce ? side(ce) : null,
    pe: pe ? side(pe) : null,
  } as OptionChainStrikeRow;
}

const rows: OptionChainStrikeRow[] = [
  row(24600, { oi: 100_000 }, { oi: 80_000 }),
  row(24700, { oi: 200_000 }, { oi: 150_000 }),
  row(24800, { oi: 50_000 }, { oi: 50_000 }),  // ATM
  row(24900, { oi: 150_000 }, { oi: 200_000 }),
  row(25000, { oi: 80_000 }, { oi: 100_000 }),
];

describe("applyStrikeFilter — windowing", () => {
  it("returns full set for 'all'", () => {
    const out = applyStrikeFilter({ rows, filter: "all", atmStrike: 24800, maxOi: 200_000 });
    expect(out).toHaveLength(5);
    expect(out).not.toBe(rows); // copies, doesn't expose the input array
  });

  it("clamps atm5 at array boundaries", () => {
    const out = applyStrikeFilter({ rows, filter: "atm5", atmStrike: 24600, maxOi: 200_000 });
    // ATM is at index 0, so window is [0, 6) → all 5 rows
    expect(out).toHaveLength(5);
  });

  it("returns full set when ATM strike isn't found (defensive)", () => {
    const out = applyStrikeFilter({ rows, filter: "atm5", atmStrike: 99999, maxOi: 200_000 });
    expect(out).toHaveLength(5);
  });

  it("returns [] for empty input regardless of filter", () => {
    expect(applyStrikeFilter({ rows: [], filter: "oiSpike", atmStrike: 0, maxOi: 0 })).toEqual([]);
  });
});

describe("applyStrikeFilter — highOi", () => {
  it("keeps strikes with OI ≥ 30% of max on either side", () => {
    const out = applyStrikeFilter({ rows, filter: "highOi", atmStrike: 24800, maxOi: 200_000 });
    // threshold = 60_000 → 24600 (CE 100k), 24700, 24800 (50k each → out!), 24900, 25000
    expect(out.map(r => r.strike)).toEqual([24600, 24700, 24900, 25000]);
  });
});

describe("applyStrikeFilter — unusual (volume-based)", () => {
  it("keeps strikes with Vol/OI ≥ 1.5 on either side", () => {
    const r: OptionChainStrikeRow[] = [
      row(100, { oi: 1000, volume: 2000, volOiRatio: 2.0 }, undefined),    // CE qualifies
      row(200, { oi: 1000, volume: 1000, volOiRatio: 1.0 }, undefined),    // out
      row(300, undefined, { oi: 500, volume: 800, volOiRatio: 1.6 }),       // PE qualifies
      row(400, { oi: 5000, volume: 7000, volOiRatio: UNUSUAL_VOL_OI_RATIO - 0.001 }, undefined), // just under
    ];
    const out = applyStrikeFilter({ rows: r, filter: "unusual", atmStrike: 100, maxOi: 5000 });
    expect(out.map(x => x.strike)).toEqual([100, 300]);
  });
});

describe("applyStrikeFilter — oiSpike (Unusual OI Buildup)", () => {
  it("requires BOTH OI ≥ 5000 AND |ΔOI/OI| ≥ 15%", () => {
    const r: OptionChainStrikeRow[] = [
      // CE: OI 4_999 — fails the OI floor even though ratio is huge
      row(100, { oi: OI_SPIKE_MIN_OI - 1, chgOi: 5_000 }, undefined),
      // CE: OI 10k, ΔOI +1500 → ratio 0.15 exactly → qualifies (≥ 15%)
      row(200, { oi: 10_000, chgOi: 1_500 }, undefined),
      // CE: OI 10k, ΔOI +1499 → ratio 0.1499 → OUT
      row(300, { oi: 10_000, chgOi: 1_499 }, undefined),
      // PE: OI 20k, ΔOI -10k → ratio 0.5 → qualifies (negative chgOi counted via abs)
      row(400, undefined, { oi: 20_000, chgOi: -10_000 }),
      // Both sides quiet — out
      row(500, { oi: 100_000, chgOi: 100 }, { oi: 100_000, chgOi: -200 }),
    ];
    const out = applyStrikeFilter({ rows: r, filter: "oiSpike", atmStrike: 200, maxOi: 100_000 });
    expect(out.map(x => x.strike)).toEqual([200, 400]);
  });

  it("does not divide by zero when OI is 0", () => {
    const r: OptionChainStrikeRow[] = [
      row(100, { oi: 0, chgOi: 5_000 }, { oi: 0, chgOi: -5_000 }),
    ];
    const out = applyStrikeFilter({ rows: r, filter: "oiSpike", atmStrike: 100, maxOi: 0 });
    expect(out).toEqual([]);
  });

  it("treats null oi/chgOi as 0 (no false positives on missing data)", () => {
    const r: OptionChainStrikeRow[] = [
      { strike: 100, ce: null, pe: null } as OptionChainStrikeRow,
    ];
    const out = applyStrikeFilter({ rows: r, filter: "oiSpike", atmStrike: 100, maxOi: 0 });
    expect(out).toEqual([]);
  });

  it("OR-combines CE and PE — either side spiking is enough", () => {
    const r: OptionChainStrikeRow[] = [
      // CE quiet, PE spiking
      row(100, { oi: 100_000, chgOi: 100 }, { oi: 10_000, chgOi: 5_000 }),
    ];
    const out = applyStrikeFilter({ rows: r, filter: "oiSpike", atmStrike: 100, maxOi: 100_000 });
    expect(out.map(x => x.strike)).toEqual([100]);
  });
});
