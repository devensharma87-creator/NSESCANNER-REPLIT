/**
 * Data-authenticity guard for the index-board ANALYTICS provenance (T003).
 *
 * Invariants:
 *  - Yahoo-derived daily analytics are labelled `secondary_analytics` /
 *    delayed / not-for-signals — never silently authoritative.
 *  - Missing daily history yields an honest `unavailable` provenance with a
 *    user-facing `missingReason`, not a fabricated trust level.
 *  - Diagnostic NOTES never leak a raw provider name ("…from Yahoo").
 *  - The fake-zero guard is unaffected: no fabricated change/changePercent
 *    when there is no real previous close.
 */
import { describe, it, expect } from "vitest";
import {
  buildAnalyticsProvenance,
  buildItem,
  type InstrumentCfg,
} from "./indicesBoard";
import type { YahooChart } from "./yahoo";

const cfg: InstrumentCfg = {
  key: "NIFTY50",
  name: "NIFTY 50",
  category: "INDIA",
  yahoo: "NIFTY 50",
  currency: "₹",
};

const NOW = Date.UTC(2026, 5, 9, 6, 0, 0); // 2026-06-09T06:00:00Z

function chart(over: Partial<Omit<YahooChart, "meta">> & { meta?: Partial<YahooChart["meta"]> }): YahooChart {
  return {
    symbol: "NIFTY 50",
    meta: { symbol: "NIFTY 50", regularMarketPrice: 0, ...(over.meta ?? {}) },
    timestamps: over.timestamps ?? [],
    open: over.open ?? [],
    high: over.high ?? [],
    low: over.low ?? [],
    close: over.close ?? [],
    volume: over.volume ?? [],
  };
}

/** Build a daily chart with `n` consecutive trading days ending `lastTs` (sec). */
function dailyOf(n: number, lastTs: number): YahooChart {
  const ts: number[] = [];
  const px: number[] = [];
  for (let i = n - 1; i >= 0; i--) {
    ts.push(lastTs - i * 24 * 3600);
    px.push(20000 + i);
  }
  return chart({
    meta: { regularMarketPrice: px[px.length - 1]!, regularMarketTime: lastTs },
    timestamps: ts,
    open: px,
    high: px.map(v => v + 50),
    low: px.map(v => v - 50),
    close: px,
    volume: px.map(() => 1000),
  });
}

describe("buildAnalyticsProvenance", () => {
  it("labels available daily history as delayed secondary_analytics, never authoritative", () => {
    const lastTs = Math.floor(NOW / 1000) - 12 * 3600; // ~today, fresh
    const p = buildAnalyticsProvenance(cfg, dailyOf(250, lastTs), "kite", NOW);
    expect(p.trustTier).toBe("secondary_analytics");
    expect(p.sourceProvider).toBe("yahoo");
    expect(p.sourcePriority).toBe(3);
    expect(p.delayed).toBe(true);
    expect(p.notForSignals).toBe(true);
    expect(p.notForTradeDecisions).toBe(true);
    expect(p.intradaySourceProvider).toBe("kite");
    expect(p.asOf).toBe(lastTs);
    expect(p.missingReason).toBeNull();
    expect(p.isStale).toBe(false);
  });

  it("returns an honest unavailable provenance with a reason when daily is null", () => {
    const p = buildAnalyticsProvenance(cfg, null, null, NOW);
    expect(p.trustTier).toBe("unavailable");
    expect(p.sourceProvider).toBeNull();
    expect(p.sourcePriority).toBe(99);
    expect(p.asOf).toBeNull();
    expect(p.freshnessSec).toBeNull();
    expect(p.isStale).toBeNull();
    expect(p.missingReason).toMatch(/no trusted daily candles/i);
    // Even when unavailable, policy flags must stay protective.
    expect(p.notForSignals).toBe(true);
    expect(p.notForTradeDecisions).toBe(true);
  });

  it("flags stale when the last daily bar is older than the staleness window", () => {
    const oldTs = Math.floor(NOW / 1000) - 10 * 24 * 3600; // 10 days old
    const p = buildAnalyticsProvenance(cfg, dailyOf(250, oldTs), "yahoo", NOW);
    expect(p.isStale).toBe(true);
  });

  it("warns (does not fail) when fewer than 200 daily candles for EMA200", () => {
    const lastTs = Math.floor(NOW / 1000) - 12 * 3600;
    const p = buildAnalyticsProvenance(cfg, dailyOf(60, lastTs), "kite", NOW);
    expect(p.trustTier).toBe("secondary_analytics");
    expect(p.warnings.join(" ")).toMatch(/EMA200/);
  });

  it("surfaces the proxyNote as a warning when configured", () => {
    const lastTs = Math.floor(NOW / 1000) - 12 * 3600;
    const proxyCfg: InstrumentCfg = { ...cfg, proxyNote: "Uses a daily proxy series" };
    const p = buildAnalyticsProvenance(proxyCfg, dailyOf(250, lastTs), "kite", NOW);
    expect(p.warnings.some(w => /proxy/i.test(w))).toBe(true);
  });

  it("never reports null as freshness when asOf is present", () => {
    const lastTs = Math.floor(NOW / 1000) - 3600;
    const p = buildAnalyticsProvenance(cfg, dailyOf(250, lastTs), "kite", NOW);
    expect(p.freshnessSec).not.toBeNull();
    expect(p.freshnessSec).toBeGreaterThanOrEqual(0);
  });
});

describe("buildItem — analytics + honest notes", () => {
  it("attaches secondary_analytics provenance and leaks no provider name in notes", () => {
    const lastTs = Math.floor(NOW / 1000) - 12 * 3600;
    const daily = dailyOf(250, lastTs);
    const item = buildItem(cfg, daily, null, undefined, undefined, "yahoo", NOW);
    expect(item.analytics?.trustTier).toBe("secondary_analytics");
    for (const n of item.notes) {
      expect(n).not.toMatch(/yahoo/i);
    }
  });

  it("emits an honest unavailable analytics note (no raw provider name) when daily is null", () => {
    const item = buildItem(cfg, null, null, undefined, undefined, null, NOW);
    expect(item.analytics?.trustTier).toBe("unavailable");
    const joined = item.notes.join(" · ");
    expect(joined).not.toMatch(/yahoo/i);
    expect(joined).toMatch(/analytics unavailable/i);
  });

  it("does not fabricate change/changePercent when there is no real previous close", () => {
    // Daily with a single bar → no prior close to derive change against.
    const lastTs = Math.floor(NOW / 1000) - 12 * 3600;
    const oneBar = chart({
      meta: { regularMarketPrice: 20000, regularMarketTime: lastTs },
      timestamps: [lastTs],
      open: [20000], high: [20100], low: [19900], close: [20000], volume: [1000],
    });
    const item = buildItem(cfg, oneBar, null, undefined, undefined, null, NOW);
    expect(item.change == null || Number.isFinite(item.change)).toBe(true);
    // The fake-zero failure mode is a 0 change with no prevClose; assert we
    // never emit a 0 change unless a real prevClose backs it.
    if (item.change === 0) {
      expect(item.prevClose).not.toBeNull();
    }
  });
});
