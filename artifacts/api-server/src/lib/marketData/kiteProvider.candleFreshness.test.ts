/**
 * Candle-series freshness fix regression tests.
 *
 * Root cause (2026-07-02): `getIndexCandles / getEquityCandles /
 * getEquityCandlesByToken` used `lastTsSec * 1000` (last candle bar's open
 * timestamp) as `asOfMs` in `buildMeta`. For daily bars the last candle is
 * always 17-30 h old — far beyond the `staleBudgetSec=600s` policy — so
 * `isHardStale=true → validationStatus="stale" → isTradeableMeta=false →
 * router drops the series → centralIndexCandles returns null → warmup throws
 * "daily_history_unavailable_kite" → backbone marks dailyCandles UNKNOWN →
 * fno/swing BLOCKED in the backbone health report.
 *
 * Fix: use `Date.now()` (fetch time) as `asOfMs` for candle series.
 * Freshness for historical series means "when was this data fetched from
 * Kite", not "how old is the last data point". The 60-s in-process cache
 * means the answer is always ≤60 s, well within any freshness budget.
 *
 * These tests use `buildMeta` + `isTradeableMeta` directly (pure functions,
 * no network) to prove the before/after behaviour of the staleness gate.
 */

import { describe, it, expect, afterEach } from "vitest";
import { buildMeta } from "./validator";
import { isTradeableMeta } from "./guard";

const KITE_AUTHORITATIVE = {
  source: "kite" as const,
  trustTier: "authoritative" as const,
  delayed: false,
  notForSignals: false,
  complete: true,
};

afterEach(() => {
  delete process.env.MARKETDATA_STALE_BUDGET_SEC;
  delete process.env.MARKETDATA_FRESHNESS_BUDGET_SEC;
  delete process.env.MARKETDATA_STRICT_FRESHNESS;
});

describe("candle series freshness: fetch-time asOfMs (the fix)", () => {
  it("asOfMs=Date.now() is NOT hard-stale → validationStatus=validated → isTradeableMeta=true", () => {
    const now = Date.now();
    const meta = buildMeta({
      ...KITE_AUTHORITATIVE,
      asOfMs: now,
      nowMs: now,
    });
    expect(meta.validationStatus).toBe("validated");
    expect(meta.isStale).toBe(false);
    expect(isTradeableMeta(meta)).toBe(true);
  });

  it("asOfMs within the freshness budget (30 s) → not stale at all", () => {
    const now = Date.now();
    const meta = buildMeta({
      ...KITE_AUTHORITATIVE,
      asOfMs: now - 30 * 1000,
      nowMs: now,
    });
    expect(meta.validationStatus).toBe("validated");
    expect(meta.isStale).toBe(false);
    expect(isTradeableMeta(meta)).toBe(true);
  });

  it("asOfMs within the stale budget (60 s cache TTL) → soft-stale but not hard-stale → still tradeable without strictFreshness", () => {
    const now = Date.now();
    // 60-s cache TTL: data fetched up to 60 s ago is still in cache.
    // With default staleBudgetSec=600 s this is still fresh (ageSec=60 << 600).
    const meta = buildMeta({
      ...KITE_AUTHORITATIVE,
      asOfMs: now - 60 * 1000,
      nowMs: now,
    });
    expect(meta.validationStatus).toBe("validated");
    expect(isTradeableMeta(meta)).toBe(true);
  });
});

describe("candle series freshness: REGRESSION — old last-candle asOfMs was wrong", () => {
  it("yesterday's daily candle timestamp (27 h ago) is HARD-STALE → isTradeableMeta=false (old code was broken)", () => {
    const now = Date.now();
    const TWENTY_SEVEN_HOURS_AGO = now - 27 * 3600 * 1000;
    const meta = buildMeta({
      ...KITE_AUTHORITATIVE,
      asOfMs: TWENTY_SEVEN_HOURS_AGO,
      nowMs: now,
    });
    expect(meta.validationStatus).toBe("stale");
    expect(isTradeableMeta(meta)).toBe(false);
  });

  it("even yesterday's intraday candle (23 h ago) is HARD-STALE → would have been rejected by old code", () => {
    const now = Date.now();
    const TWENTY_THREE_HOURS_AGO = now - 23 * 3600 * 1000;
    const meta = buildMeta({
      ...KITE_AUTHORITATIVE,
      asOfMs: TWENTY_THREE_HOURS_AGO,
      nowMs: now,
    });
    expect(meta.validationStatus).toBe("stale");
    expect(isTradeableMeta(meta)).toBe(false);
  });

  it("even a relatively-recent daily candle (1 h ago) exceeds staleBudgetSec=600 s → hard-stale with old code", () => {
    const now = Date.now();
    const ONE_HOUR_AGO = now - 3600 * 1000;
    const meta = buildMeta({
      ...KITE_AUTHORITATIVE,
      asOfMs: ONE_HOUR_AGO,
      nowMs: now,
    });
    expect(meta.validationStatus).toBe("stale");
    expect(isTradeableMeta(meta)).toBe(false);
  });
});

describe("candle series freshness: isTradeableMeta invariants preserved by the fix", () => {
  it("non-authoritative tier still blocked even with fresh asOfMs", () => {
    const now = Date.now();
    const meta = buildMeta({
      source: "yahoo" as const,
      trustTier: "secondary_analytics" as const,
      asOfMs: now,
      nowMs: now,
      delayed: true,
      notForSignals: true,
      complete: true,
    });
    expect(isTradeableMeta(meta)).toBe(false);
  });

  it("complete=false → validationStatus=incomplete → not tradeable (fix does not bypass completeness)", () => {
    const now = Date.now();
    const meta = buildMeta({
      ...KITE_AUTHORITATIVE,
      asOfMs: now,
      nowMs: now,
      complete: false,
    });
    expect(meta.validationStatus).toBe("incomplete");
    expect(isTradeableMeta(meta)).toBe(false);
  });

  it("notForSignals=true → not tradeable even with fresh fetch-time asOfMs", () => {
    const now = Date.now();
    const meta = buildMeta({
      ...KITE_AUTHORITATIVE,
      asOfMs: now,
      nowMs: now,
      notForSignals: true,
    });
    expect(isTradeableMeta(meta)).toBe(false);
  });
});
