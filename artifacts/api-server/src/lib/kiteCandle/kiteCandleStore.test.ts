/**
 * Unit tests for the canonical Kite Candle Store.
 * All tests operate on the in-memory L1 cache — DB and Kite are not contacted.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  getKiteCandleSeries,
  getKiteCandleStoreMetrics,
  _testOnly,
  type KiteCandleEntry,
  type KiteCandleStatus,
} from "./kiteCandleStore";

const {
  setMemCacheEntry,
  clearMemCache,
  resetCounters,
  resetCircuitBreaker,
  resetSchedulerState,
  STALE_THRESHOLD_MS,
  MIN_DISPLAY_BARS,
  MIN_INDICATOR_BARS,
  chunk,
  isMarketHours,
  dbRowToEntry,
  cacheKey,
} = _testOnly;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEntry(
  symbol: string,
  overrides: Partial<KiteCandleEntry> = {},
): KiteCandleEntry {
  return {
    symbol,
    exchange: "NSE",
    timeframe: "day",
    sessionDate: "2026-08-07",
    barCount: overrides.barCount ?? 247,
    chart: overrides.chart !== undefined ? overrides.chart : ({
      meta: { currency: "INR", regularMarketPrice: 100, symbol } as never,
      timestamps: Array.from({ length: overrides.barCount ?? 247 }, (_, i) => 1700000000 + i * 86400),
      open:   new Array(overrides.barCount ?? 247).fill(100),
      high:   new Array(overrides.barCount ?? 247).fill(105),
      low:    new Array(overrides.barCount ?? 247).fill(95),
      close:  new Array(overrides.barCount ?? 247).fill(101),
      volume: new Array(overrides.barCount ?? 247).fill(1_000_000),
    } as never),
    fetchedAt: new Date(),
    status: overrides.status ?? "ok",
    errorCode: overrides.errorCode ?? null,
    ...overrides,
  };
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  clearMemCache();
  resetCounters();
  resetCircuitBreaker();
  resetSchedulerState();
});

// ─── Cache key ───────────────────────────────────────────────────────────────

describe("cacheKey", () => {
  it("formats NSE:day:SYMBOL", () => {
    expect(cacheKey("RELIANCE", "NSE", "day")).toBe("NSE:day:RELIANCE");
  });
  it("defaults to NSE and day", () => {
    expect(cacheKey("INFY")).toBe("NSE:day:INFY");
  });
});

// ─── getKiteCandleSeries ─────────────────────────────────────────────────────

describe("getKiteCandleSeries", () => {
  it("returns pending entry for unknown symbol", () => {
    const entry = getKiteCandleSeries("UNKNOWN_XYZ");
    expect(entry.status).toBe("pending");
    expect(entry.chart).toBeNull();
    expect(entry.errorCode).toBe("KITE_CANDLE_STORE_PENDING");
    expect(entry.barCount).toBe(0);
  });

  it("returns cached ok entry", () => {
    const stored = makeEntry("RELIANCE", { status: "ok", barCount: 247 });
    setMemCacheEntry(stored);
    const entry = getKiteCandleSeries("RELIANCE");
    expect(entry.status).toBe("ok");
    expect(entry.barCount).toBe(247);
    expect(entry.chart).not.toBeNull();
  });

  it("returns stale entry", () => {
    const stored = makeEntry("TCS", { status: "stale", barCount: 247 });
    setMemCacheEntry(stored);
    const entry = getKiteCandleSeries("TCS");
    expect(entry.status).toBe("stale");
  });

  it("returns unavailable entry with null chart", () => {
    const stored = makeEntry("BADSTOCK", {
      status: "unavailable",
      barCount: 0,
      chart: null,
      errorCode: "KITE_OFFLINE",
    });
    setMemCacheEntry(stored);
    const entry = getKiteCandleSeries("BADSTOCK");
    expect(entry.status).toBe("unavailable");
    expect(entry.chart).toBeNull();
    expect(entry.errorCode).toBe("KITE_OFFLINE");
  });

  it("increments cacheHits for known symbol", () => {
    setMemCacheEntry(makeEntry("HDFC"));
    getKiteCandleSeries("HDFC");
    getKiteCandleSeries("HDFC");
    const m = getKiteCandleStoreMetrics();
    expect(m.cacheHits).toBe(2);
    expect(m.cacheMisses).toBe(0);
  });

  it("increments cacheMisses for unknown symbol", () => {
    getKiteCandleSeries("NOTHERE");
    const m = getKiteCandleStoreMetrics();
    expect(m.cacheMisses).toBe(1);
    expect(m.cacheHits).toBe(0);
  });

  it("computes cacheHitRatio correctly", () => {
    setMemCacheEntry(makeEntry("WIPRO"));
    getKiteCandleSeries("WIPRO");  // hit
    getKiteCandleSeries("WIPRO");  // hit
    getKiteCandleSeries("MISSING"); // miss
    const m = getKiteCandleStoreMetrics();
    expect(m.cacheHitRatio).toBeCloseTo(2 / 3, 2);
  });

  it("returns null cacheHitRatio when no calls made", () => {
    const m = getKiteCandleStoreMetrics();
    expect(m.cacheHitRatio).toBeNull();
  });
});

// ─── getKiteCandleStoreMetrics ────────────────────────────────────────────────

describe("getKiteCandleStoreMetrics", () => {
  it("returns zero counts on empty cache", () => {
    const m = getKiteCandleStoreMetrics();
    expect(m.totalSymbols).toBe(0);
    expect(m.okCount).toBe(0);
    expect(m.staleCount).toBe(0);
    expect(m.unavailableCount).toBe(0);
    expect(m.insufficientCount).toBe(0);
    expect(m.pendingCount).toBe(0);
    expect(m.evaluatedReadyCount).toBe(0);
  });

  it("counts ok vs stale vs unavailable correctly", () => {
    setMemCacheEntry(makeEntry("A", { status: "ok", barCount: 247 }));
    setMemCacheEntry(makeEntry("B", { status: "ok", barCount: 247 }));
    setMemCacheEntry(makeEntry("C", { status: "stale", barCount: 247 }));
    setMemCacheEntry(makeEntry("D", { status: "unavailable", barCount: 0, chart: null, errorCode: "KITE_OFFLINE" }));
    setMemCacheEntry(makeEntry("E", { status: "insufficient", barCount: 50, chart: null, errorCode: "INSUFFICIENT_HISTORY" }));
    const m = getKiteCandleStoreMetrics();
    expect(m.totalSymbols).toBe(5);
    expect(m.okCount).toBe(2);
    expect(m.staleCount).toBe(1);
    expect(m.unavailableCount).toBe(1);
    expect(m.insufficientCount).toBe(1);
    expect(m.pendingCount).toBe(0);
  });

  it("evaluatedReadyCount = ok|stale with barCount >= MIN_INDICATOR_BARS", () => {
    setMemCacheEntry(makeEntry("FULL1",  { status: "ok",   barCount: 247 })); // ready
    setMemCacheEntry(makeEntry("FULL2",  { status: "stale", barCount: 200 })); // ready (exactly MIN)
    setMemCacheEntry(makeEntry("SHORT1", { status: "ok",   barCount: 199 })); // not ready
    setMemCacheEntry(makeEntry("SHORT2", { status: "stale", barCount: 100 })); // not ready
    setMemCacheEntry(makeEntry("UNAVAIL", { status: "unavailable", barCount: 0, chart: null, errorCode: "KITE_OFFLINE" }));
    const m = getKiteCandleStoreMetrics();
    expect(m.evaluatedReadyCount).toBe(2);
    expect(MIN_INDICATOR_BARS).toBe(200);
  });

  it("exposes advisory lock key", () => {
    const m = getKiteCandleStoreMetrics();
    expect(m.lockKey).toBe(88_274_615);
  });
});

// ─── chunk helper ────────────────────────────────────────────────────────────

describe("chunk", () => {
  it("splits array into batches of given size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("returns single batch when array fits", () => {
    expect(chunk([1, 2, 3], 6)).toEqual([[1, 2, 3]]);
  });
  it("returns empty array for empty input", () => {
    expect(chunk([], 3)).toEqual([]);
  });
  it("correctly partitions 194-stock universe into ceil(194/6)=33 batches", () => {
    const symbols = Array.from({ length: 194 }, (_, i) => `SYM${i}`);
    const batches = chunk(symbols, 6);
    expect(batches.length).toBe(33);
    expect(batches[0]).toHaveLength(6);
    expect(batches[32]).toHaveLength(2); // 194 - 32*6 = 2
  });
});

// ─── dbRowToEntry — stale promotion ──────────────────────────────────────────

describe("dbRowToEntry (stale promotion)", () => {
  it("promotes ok entry that is older than STALE_THRESHOLD to stale", () => {
    const oldFetchedAt = new Date(Date.now() - STALE_THRESHOLD_MS - 1000).toISOString();
    const row = {
      symbol: "X", exchange: "NSE", timeframe: "day",
      session_date: "2026-08-06", bar_count: 247, bars_json: { close: [] } as never,
      fetched_at: oldFetchedAt, status: "ok", error_code: null,
    };
    const entry = dbRowToEntry(row);
    expect(entry.status).toBe("stale");
  });

  it("keeps ok status for recently fetched entries", () => {
    const freshFetchedAt = new Date(Date.now() - 60_000).toISOString();
    const row = {
      symbol: "Y", exchange: "NSE", timeframe: "day",
      session_date: "2026-08-07", bar_count: 247, bars_json: { close: [] } as never,
      fetched_at: freshFetchedAt, status: "ok", error_code: null,
    };
    const entry = dbRowToEntry(row);
    expect(entry.status).toBe("ok");
  });

  it("does not promote unavailable to stale", () => {
    const oldFetchedAt = new Date(Date.now() - STALE_THRESHOLD_MS - 1000).toISOString();
    const row = {
      symbol: "Z", exchange: "NSE", timeframe: "day",
      session_date: null, bar_count: 0, bars_json: null,
      fetched_at: oldFetchedAt, status: "unavailable", error_code: "KITE_OFFLINE",
    };
    const entry = dbRowToEntry(row);
    expect(entry.status).toBe("unavailable");
  });
});

// ─── Constants sanity check ───────────────────────────────────────────────────

describe("Store constants", () => {
  it("MIN_DISPLAY_BARS is 30", () => expect(MIN_DISPLAY_BARS).toBe(30));
  it("MIN_INDICATOR_BARS is 200 (EMA200 warm-up)", () => expect(MIN_INDICATOR_BARS).toBe(200));
  it("STALE_THRESHOLD_MS is 18h", () => expect(STALE_THRESHOLD_MS).toBe(18 * 60 * 60 * 1000));
});
