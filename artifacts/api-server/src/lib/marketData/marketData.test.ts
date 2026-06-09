import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { getPolicy, isTierTradeable } from "./policy";
import { computeFreshness } from "./freshness";
import { isQuoteComplete, buildMeta, unavailableMeta } from "./validator";
import {
  isTradeableMeta,
  assertTradeable,
  tryTradeable,
  TrustTierViolation,
} from "./guard";
import { buildDataDiagnostics } from "./diagnostics";
import type { DataMeta, MarketQuote } from "./types";

function quoteWith(meta: DataMeta): MarketQuote {
  return { symbol: "TEST", lastPrice: 100, previousClose: 99, meta };
}

describe("policy", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("makes Kite the only authoritative, tradeable provider", () => {
    const p = getPolicy();
    expect(p.providers.kite.trustTier).toBe("authoritative");
    expect(p.providers.kite.allowedForTrading).toBe(true);
    expect(p.providers.kite.allowedForSignals).toBe(true);
    expect(p.providers.kite.allowedForValuation).toBe(true);
    expect(p.providers.kite.role).toBe("primary");
  });

  it("bans Yahoo from trading/signals/valuation (analytics only)", () => {
    const p = getPolicy();
    expect(p.providers.yahoo.trustTier).toBe("secondary_analytics");
    expect(p.providers.yahoo.role).toBe("analytics");
    expect(p.providers.yahoo.allowedForTrading).toBe(false);
    expect(p.providers.yahoo.allowedForSignals).toBe(false);
    expect(p.providers.yahoo.allowedForValuation).toBe(false);
  });

  it("keeps INDstocks disabled by default and never tradeable", () => {
    delete process.env.INDSTOCKS_ENABLED;
    const p = getPolicy();
    expect(p.indstocksEnabled).toBe(false);
    expect(p.providers.indstocks.enabled).toBe(false);
    expect(p.providers.indstocks.role).toBe("disabled");
    expect(p.providers.indstocks.allowedForTrading).toBe(false);
  });

  it("fails closed on an unrecognised INDSTOCKS_ENABLED value", () => {
    process.env.INDSTOCKS_ENABLED = "maybe";
    expect(getPolicy().indstocksEnabled).toBe(false);
  });

  it("treats only the authoritative tier as tradeable", () => {
    expect(isTierTradeable("authoritative")).toBe(true);
    expect(isTierTradeable("secondary_validation")).toBe(false);
    expect(isTierTradeable("secondary_analytics")).toBe(false);
  });
});

describe("computeFreshness", () => {
  const budget = { freshnessBudgetSec: 90, staleBudgetSec: 600 };

  it("reports a fresh datum within budget", () => {
    const now = 1_000_000_000_000;
    const f = computeFreshness(now - 30_000, now, budget);
    expect(f.freshnessSec).toBe(30);
    expect(f.isStale).toBe(false);
    expect(f.isHardStale).toBe(false);
  });

  it("flags stale beyond the freshness budget", () => {
    const now = 1_000_000_000_000;
    const f = computeFreshness(now - 120_000, now, budget);
    expect(f.isStale).toBe(true);
    expect(f.isHardStale).toBe(false);
  });

  it("flags hard-stale beyond the stale budget", () => {
    const now = 1_000_000_000_000;
    const f = computeFreshness(now - 700_000, now, budget);
    expect(f.isStale).toBe(true);
    expect(f.isHardStale).toBe(true);
  });

  it("treats an unknown timestamp as stale (cannot prove freshness)", () => {
    const f = computeFreshness(null, 1_000_000_000_000, budget);
    expect(f.freshnessSec).toBeNull();
    expect(f.isStale).toBe(true);
    expect(f.isHardStale).toBe(false);
  });
});

describe("validator", () => {
  it("requires a positive last price AND previous close for completeness", () => {
    expect(isQuoteComplete({ lastPrice: 100, previousClose: 99 })).toBe(true);
    expect(isQuoteComplete({ lastPrice: 0, previousClose: 99 })).toBe(false);
    expect(isQuoteComplete({ lastPrice: 100, previousClose: undefined })).toBe(false);
  });

  it("builds a validated meta for fresh Kite data", () => {
    const now = 1_000_000_000_000;
    const m = buildMeta({
      source: "kite",
      trustTier: "authoritative",
      asOfMs: now - 10_000,
      delayed: false,
      notForSignals: false,
      nowMs: now,
    });
    expect(m.validationStatus).toBe("validated");
    expect(m.isStale).toBe(false);
    expect(m.asOf).not.toBeNull();
  });

  it("marks incomplete data honestly", () => {
    const m = buildMeta({
      source: "kite",
      trustTier: "authoritative",
      asOfMs: Date.now(),
      delayed: false,
      notForSignals: false,
      complete: false,
    });
    expect(m.validationStatus).toBe("incomplete");
  });

  it("marks analytics (not-for-signals) data unvalidated by design", () => {
    const m = buildMeta({
      source: "yahoo",
      trustTier: "secondary_analytics",
      asOfMs: Date.now(),
      delayed: true,
      notForSignals: true,
    });
    expect(m.validationStatus).toBe("unvalidated");
    expect(m.notForSignals).toBe(true);
  });

  it("unavailableMeta always carries a reason and is stale", () => {
    const m = unavailableMeta("kite", "authoritative", "No session");
    expect(m.validationStatus).toBe("unavailable");
    expect(m.isStale).toBe(true);
    expect(m.warnings).toContain("No session");
  });
});

describe("guard", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env = { ...saved };
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  const freshKiteMeta = (): DataMeta => ({
    source: "kite",
    trustTier: "authoritative",
    asOf: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    freshnessSec: 5,
    isStale: false,
    delayed: false,
    notForSignals: false,
    validationStatus: "validated",
    warnings: [],
  });

  it("accepts fresh authoritative Kite data", () => {
    const meta = freshKiteMeta();
    expect(isTradeableMeta(meta)).toBe(true);
    expect(() => assertTradeable(quoteWith(meta))).not.toThrow();
    expect(tryTradeable(quoteWith(meta))).not.toBeNull();
  });

  it("BLOCKS Yahoo analytics data from trading/signals", () => {
    const meta: DataMeta = {
      ...freshKiteMeta(),
      source: "yahoo",
      trustTier: "secondary_analytics",
      notForSignals: true,
      validationStatus: "unvalidated",
    };
    expect(isTradeableMeta(meta)).toBe(false);
    expect(() => assertTradeable(quoteWith(meta))).toThrow(TrustTierViolation);
    expect(tryTradeable(quoteWith(meta))).toBeNull();
  });

  it("blocks incomplete / unavailable / mismatch data", () => {
    for (const status of ["incomplete", "unavailable", "mismatch"] as const) {
      const meta: DataMeta = { ...freshKiteMeta(), validationStatus: status };
      expect(isTradeableMeta(meta)).toBe(false);
    }
  });

  it("rejects soft-stale (freshness-budget breach) only under strict freshness", () => {
    const staleMeta: DataMeta = { ...freshKiteMeta(), isStale: true };
    process.env.MARKETDATA_STRICT_FRESHNESS = "0";
    expect(isTradeableMeta(staleMeta)).toBe(true);
    process.env.MARKETDATA_STRICT_FRESHNESS = "1";
    expect(isTradeableMeta(staleMeta)).toBe(false);
  });

  it("rejects HARD-stale data regardless of strict-freshness (no-compromise)", () => {
    const hardStale: DataMeta = { ...freshKiteMeta(), isStale: true, validationStatus: "stale" };
    process.env.MARKETDATA_STRICT_FRESHNESS = "0";
    expect(isTradeableMeta(hardStale)).toBe(false);
    expect(() => assertTradeable(quoteWith(hardStale))).toThrow(TrustTierViolation);
    process.env.MARKETDATA_STRICT_FRESHNESS = "1";
    expect(isTradeableMeta(hardStale)).toBe(false);
  });
});

describe("buildDataDiagnostics", () => {
  it("returns the honest policy + three providers with Kite authoritative", async () => {
    const d = await buildDataDiagnostics();
    expect(d.authoritative).toBe("kite");
    expect(typeof d.generatedAt).toBe("string");
    expect(d.policy.freshnessBudgetSec).toBeGreaterThan(0);
    const names = d.providers.map((p) => p.name).sort();
    expect(names).toEqual(["indstocks", "kite", "yahoo"]);
    const yahoo = d.providers.find((p) => p.name === "yahoo")!;
    expect(yahoo.trustTier).toBe("secondary_analytics");
    const indstocks = d.providers.find((p) => p.name === "indstocks")!;
    expect(["disabled", "degraded"]).toContain(indstocks.state);
  });
});
