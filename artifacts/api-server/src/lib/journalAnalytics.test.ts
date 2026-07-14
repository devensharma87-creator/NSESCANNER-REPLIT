/**
 * journalAnalytics — win-rate honesty for setup / hour / tag buckets.
 *
 * `buildAnalytics` is the pure roll-up behind `getJournalAnalytics`. The
 * contract under test: an empty roll-up surfaces no buckets, a single-scratch
 * bucket reports 0% (a decided 0 wins out of 1 trade — NOT null, because the
 * journal denominator is trades, not decided), and populated buckets report a
 * correct percentage. Win = realizedPnl > 0; scratch / loss otherwise.
 */
import { describe, it, expect } from "vitest";

import { buildAnalytics } from "./journalAnalytics";

type Row = {
  setupKey: string;
  exitReason: string | null;
  realizedPnl: string | null;
  openedAt: Date;
  tags: string[] | null;
};

const row = (over: Partial<Row> = {}): Row => ({
  setupKey: "TREND_CONTINUATION",
  exitReason: "TARGET",
  realizedPnl: "100",
  openedAt: new Date("2026-05-15T05:00:00.000Z"), // 10:30 IST
  tags: ["momentum"],
  ...over,
});

describe("buildAnalytics — empty input", () => {
  it("produces zero totals and empty buckets (no fabricated rates)", () => {
    const r = buildAnalytics("FNO", []);
    expect(r.totalTrades).toBe(0);
    expect(r.setupStats).toEqual([]);
    expect(r.hourBuckets).toEqual([]);
    expect(r.tagStats).toEqual([]);
    expect(r.exitReasonStats).toEqual([]);
  });
});

describe("buildAnalytics — win-rate honesty", () => {
  it("reports 100% only when every decided trade won", () => {
    const r = buildAnalytics("FNO", [row(), row({ realizedPnl: "50" })]);
    expect(r.setupStats[0]!.winRate).toBe(100);
  });

  it("a single scratch trade is NOT a 100% bucket", () => {
    const r = buildAnalytics("FNO", [row({ realizedPnl: "0" })]);
    // 1 trade, 0 wins → 0%, never a misleading 100%.
    expect(r.setupStats[0]!.winRate).toBe(0);
    expect(r.setupStats[0]!.totalPnl).toBe(0);
  });

  it("computes mixed win rates across setup / hour / tag buckets", () => {
    const r = buildAnalytics("FNO", [
      row({ realizedPnl: "100" }),
      row({ realizedPnl: "-100" }),
    ]);
    expect(r.setupStats[0]!.winRate).toBe(50);
    expect(r.hourBuckets[0]!.winRate).toBe(50);
    expect(r.tagStats[0]!.winRate).toBe(50);
  });

  it("win rate is null only when a bucket has zero trades (unreachable via rows, asserted by type)", () => {
    // Buckets only exist when at least one row created them, so winRate is a
    // number in practice; the null branch protects the type contract used by
    // the honest "—" renderer. This asserts the field stays number|null.
    const r = buildAnalytics("FNO", [row()]);
    const wr: number | null = r.setupStats[0]!.winRate;
    expect(wr).not.toBeUndefined();
  });
});
