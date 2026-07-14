import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const dbState = vi.hoisted(() => ({
  fail: false,
  selectValue: [] as unknown[],
  returningValue: [{ failureStreak: 1 }] as Array<{ failureStreak: number }>,
}));

vi.mock("@workspace/db", () => {
  const term = (getVal: () => unknown) => ({
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      (dbState.fail ? Promise.reject(new Error("db down")) : Promise.resolve(getVal())).then(res, rej),
  });
  const chain: Record<string, unknown> = {};
  for (const m of ["insert", "values", "onConflictDoUpdate", "update", "set", "where", "select", "from"]) {
    chain[m] = () => chain;
  }
  chain.returning = () => term(() => dbState.returningValue);
  (chain as { then: unknown }).then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    (dbState.fail ? Promise.reject(new Error("db down")) : Promise.resolve(dbState.selectValue)).then(res, rej);
  return { db: chain };
});

vi.mock("@workspace/db/schema", () => ({
  globalCandlesTable: {},
  globalInstrumentsTable: { symbol: { name: "symbol" } },
  globalLivePricesTable: { symbol: { name: "symbol" }, failureStreak: { name: "failure_streak" } },
  globalSyncLogsTable: { source: { name: "source" } },
}));

vi.mock("drizzle-orm", () => ({
  eq: (...a: unknown[]) => ({ _eq: a }),
  and: (...a: unknown[]) => ({ _and: a }),
  inArray: (...a: unknown[]) => ({ _in: a }),
  desc: (...a: unknown[]) => ({ _desc: a }),
  gte: (...a: unknown[]) => ({ _gte: a }),
  sql: (() => ({ _sql: true })) as unknown,
}));

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const universe = vi.hoisted(() => {
  const CRYPTO = [
    { symbol: "BTCUSDT", sourceSymbol: "BTCUSDT", displayName: "Bitcoin", assetClass: "crypto", source: "binance" },
  ];
  const COMMODITIES = [
    { symbol: "GOLD", sourceSymbol: "GC=F", displayName: "Gold", assetClass: "commodity", source: "yahoo" },
  ];
  const UNIVERSE = [...CRYPTO, ...COMMODITIES];
  return { CRYPTO, COMMODITIES, UNIVERSE };
});

vi.mock("./universe", () => ({
  CRYPTO: universe.CRYPTO,
  COMMODITIES: universe.COMMODITIES,
  FOREX: [],
  EQUITIES: [],
  INDICES: [],
  UNIVERSE: universe.UNIVERSE,
  findInstrument: (s: string) => universe.UNIVERSE.find((u) => u.symbol === s),
}));

vi.mock("./binance", () => ({
  fetchBinanceTickers: vi.fn(),
  fetchBinanceKlines: vi.fn(),
}));

vi.mock("./yahoo", () => ({
  fetchYahooCandles: vi.fn(),
  fetchYahooQuoteSnapshot: vi.fn(),
}));

vi.mock("./disabledSymbols", () => ({
  loadDisabledSet: vi.fn(async () => new Set<string>()),
}));

vi.mock("../notifications/deadSymbolNotifier", () => ({
  notifyDeadSymbol: vi.fn(async () => {}),
}));

import {
  refreshBinance,
  refreshCommodities,
  seedGlobalUniverse,
  startGlobalDataPump,
  stopGlobalDataPump,
} from "./dataLayer";
import { fetchBinanceTickers } from "./binance";
import { fetchYahooQuoteSnapshot } from "./yahoo";
import { notifyDeadSymbol } from "../notifications/deadSymbolNotifier";
import { logger } from "../logger";

const okTicker = {
  symbol: "BTCUSDT",
  lastPrice: 50000,
  prevClosePrice: 49000,
  priceChange: 1000,
  priceChangePercent: 2,
  highPrice: 51000,
  lowPrice: 48000,
  volume: 100,
};
const okQuote = {
  price: 2000,
  prevClose: 1990,
  changeAbs: 10,
  changePct: 0.5,
  dayHigh: 2010,
  dayLow: 1980,
  volume: 100,
};

function warnedFor(op: string): boolean {
  return (logger.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls.some(
    (c) => (c[0] as { op?: string })?.op === op,
  );
}

describe("dataLayer failure isolation (W6-P5 Phase 1G)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.fail = false;
    dbState.selectValue = [];
    dbState.returningValue = [{ failureStreak: 1 }];
  });

  describe("refreshBinance", () => {
    it("resolves without warnings on the happy path (upstream OK + DB OK)", async () => {
      (fetchBinanceTickers as ReturnType<typeof vi.fn>).mockResolvedValue([okTicker]);
      await expect(refreshBinance()).resolves.toBeUndefined();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("does NOT reject when the DB is down — degrades and logs fail-soft", async () => {
      (fetchBinanceTickers as ReturnType<typeof vi.fn>).mockResolvedValue([okTicker]);
      dbState.fail = true;
      await expect(refreshBinance()).resolves.toBeUndefined();
      expect(warnedFor("upsertLivePrice")).toBe(true);
    });

    it("does NOT reject when the upstream fetch throws (transient upstream error path)", async () => {
      (fetchBinanceTickers as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("binance 503"));
      await expect(refreshBinance()).resolves.toBeUndefined();
    });

    it("does NOT reject when upstream throws AND the DB is down simultaneously", async () => {
      (fetchBinanceTickers as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("binance 503"));
      dbState.fail = true;
      await expect(refreshBinance()).resolves.toBeUndefined();
    });
  });

  describe("recordLivePriceError (via missing-from-batch)", () => {
    it("does not call the dead-symbol notifier when the DB write fails", async () => {
      // Empty batch response → BTCUSDT is 'not in batch response' → recordLivePriceError.
      (fetchBinanceTickers as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      dbState.fail = true;
      dbState.returningValue = [{ failureStreak: 5 }]; // would normally fire notify at threshold
      await expect(refreshBinance()).resolves.toBeUndefined();
      expect(notifyDeadSymbol).not.toHaveBeenCalled();
    });

    it("fires the notifier at the threshold when the DB write succeeds", async () => {
      (fetchBinanceTickers as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      dbState.returningValue = [{ failureStreak: 5 }];
      await refreshBinance();
      expect(notifyDeadSymbol).toHaveBeenCalledTimes(1);
    });
  });

  describe("refreshCommodities (Yahoo batch)", () => {
    it("resolves on the happy path", async () => {
      (fetchYahooQuoteSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue(okQuote);
      await expect(refreshCommodities()).resolves.toBeUndefined();
    });

    it("does NOT reject when the upstream quote throws", async () => {
      (fetchYahooQuoteSnapshot as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("yahoo timeout"));
      await expect(refreshCommodities()).resolves.toBeUndefined();
    });

    it("does NOT reject when the DB is down", async () => {
      (fetchYahooQuoteSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue(okQuote);
      dbState.fail = true;
      await expect(refreshCommodities()).resolves.toBeUndefined();
    });
  });

  describe("seedGlobalUniverse", () => {
    it("resolves on the happy path", async () => {
      await expect(seedGlobalUniverse()).resolves.toBeUndefined();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("does NOT reject when row inserts fail — per-row fail-soft", async () => {
      dbState.fail = true;
      await expect(seedGlobalUniverse()).resolves.toBeUndefined();
      expect(warnedFor("seedGlobalUniverse")).toBe(true);
    });
  });

  describe("startGlobalDataPump recurring-tick isolation (end-to-end)", () => {
    afterEach(() => {
      stopGlobalDataPump();
      vi.useRealTimers();
    });

    it("never lets a refresher rejection escape across boot + recurring ticks (no unhandled rejection, no crash)", async () => {
      // Worst case: every upstream throws AND the DB is down for the whole window.
      (fetchBinanceTickers as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("binance down"));
      (fetchYahooQuoteSnapshot as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("yahoo down"));
      dbState.fail = true;

      const unhandled: unknown[] = [];
      const onUnhandled = (e: unknown): void => { unhandled.push(e); };
      process.on("unhandledRejection", onUnhandled);
      try {
        vi.useFakeTimers();
        await startGlobalDataPump();
        // Boot kickoffs (binance immediate + staggered 0.5/3.5/7/11s) and the
        // first recurring binance interval (30s) + commodities interval (60s).
        await vi.advanceTimersByTimeAsync(11_000);
        await vi.advanceTimersByTimeAsync(30_000);
        await vi.advanceTimersByTimeAsync(30_000);
        // Let any pending microtask rejections surface to the process handler.
        vi.useRealTimers();
        await new Promise<void>((res) => setImmediate(res));
        expect(unhandled).toEqual([]);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
    });
  });
});
