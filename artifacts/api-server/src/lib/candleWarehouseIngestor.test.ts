/**
 * Pure-function tests for the candle warehouse ingestor.
 *
 * Live-DB / live-Kite paths are exercised via the manual sync endpoint
 * in production. These tests cover only the configuration parsing and
 * chart→row transformation, which are the parts that MUST be right
 * before any ingest cycle can be trusted.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  isCandleWarehouseEnabled,
  getEnabledUniverses,
  getWarehouseConfig,
  chartToCandleRows,
  decideKindFromGap,
} from "./candleWarehouseIngestor";

describe("isCandleWarehouseEnabled", () => {
  const orig = { ...process.env };
  afterEach(() => { process.env = { ...orig }; });

  it("respects explicit truthy/falsy override", () => {
    process.env["CANDLE_WAREHOUSE_ENABLED"] = "true";
    process.env["REPLIT_DEPLOYMENT"] = "0";
    expect(isCandleWarehouseEnabled()).toBe(true);
    process.env["CANDLE_WAREHOUSE_ENABLED"] = "0";
    process.env["REPLIT_DEPLOYMENT"] = "1";
    expect(isCandleWarehouseEnabled()).toBe(false);
  });

  it("fails closed on unrecognised override", () => {
    process.env["CANDLE_WAREHOUSE_ENABLED"] = "perhaps";
    process.env["REPLIT_DEPLOYMENT"] = "1";
    expect(isCandleWarehouseEnabled()).toBe(false);
  });

  it("auto-detects from REPLIT_DEPLOYMENT when override absent", () => {
    delete process.env["CANDLE_WAREHOUSE_ENABLED"];
    process.env["REPLIT_DEPLOYMENT"] = "1";
    expect(isCandleWarehouseEnabled()).toBe(true);
    process.env["REPLIT_DEPLOYMENT"] = "";
    expect(isCandleWarehouseEnabled()).toBe(false);
  });
});

describe("getEnabledUniverses", () => {
  const orig = { ...process.env };
  afterEach(() => { process.env = { ...orig }; });

  it("defaults to indices only", () => {
    delete process.env["CANDLE_WAREHOUSE_UNIVERSES"];
    expect(getEnabledUniverses()).toEqual(["indices"]);
  });

  it("parses CSV and dedupes", () => {
    process.env["CANDLE_WAREHOUSE_UNIVERSES"] = "indices, fno-stocks ,indices";
    expect(getEnabledUniverses()).toEqual(["indices", "fno-stocks"]);
  });

  it("drops unknown values", () => {
    process.env["CANDLE_WAREHOUSE_UNIVERSES"] = "indices,bogus,swing-500";
    expect(getEnabledUniverses()).toEqual(["indices", "swing-500"]);
  });

  it("falls back to indices when nothing valid is provided", () => {
    process.env["CANDLE_WAREHOUSE_UNIVERSES"] = "garbage,more-garbage";
    expect(getEnabledUniverses()).toEqual(["indices"]);
  });
});

describe("getWarehouseConfig", () => {
  const orig = { ...process.env };
  afterEach(() => { process.env = { ...orig }; });

  it("provides safe defaults", () => {
    delete process.env["CANDLE_WAREHOUSE_DAILY_BACKFILL_DAYS"];
    delete process.env["CANDLE_WAREHOUSE_INTRADAY_BACKFILL_DAYS"];
    delete process.env["CANDLE_WAREHOUSE_INCREMENTAL_DAYS"];
    delete process.env["CANDLE_WAREHOUSE_MAX_SYMBOLS_PER_RUN"];
    delete process.env["CANDLE_WAREHOUSE_RETENTION_DAYS_INTRADAY"];
    const cfg = getWarehouseConfig();
    expect(cfg.dailyBackfillDays).toBe(400);
    expect(cfg.intradayBackfillDays).toBe(30);
    expect(cfg.incrementalDays).toBe(7);
    expect(cfg.maxSymbolsPerRun).toBe(60);
    expect(cfg.retentionDaysIntraday).toBe(60);
  });

  it("clamps values to safe ranges", () => {
    process.env["CANDLE_WAREHOUSE_DAILY_BACKFILL_DAYS"] = "999999";
    process.env["CANDLE_WAREHOUSE_INTRADAY_BACKFILL_DAYS"] = "0";
    process.env["CANDLE_WAREHOUSE_INCREMENTAL_DAYS"] = "abc";
    process.env["CANDLE_WAREHOUSE_MAX_SYMBOLS_PER_RUN"] = "-5";
    process.env["CANDLE_WAREHOUSE_RETENTION_DAYS_INTRADAY"] = "9999";
    const cfg = getWarehouseConfig();
    expect(cfg.dailyBackfillDays).toBe(2000); // clamped to max
    expect(cfg.intradayBackfillDays).toBe(1); // clamped to min
    expect(cfg.incrementalDays).toBe(7); // NaN → fallback
    expect(cfg.maxSymbolsPerRun).toBe(1); // clamped to min
    expect(cfg.retentionDaysIntraday).toBe(365); // clamped to max
  });
});

describe("chartToCandleRows", () => {
  const meta = {
    instrumentToken: 738561,
    interval: "day" as const,
    symbol: "RELIANCE",
    exchange: "NSE" as const,
    source: "kite" as const,
  };

  const goodChart = {
    timestamps: [1747267200, 1747353600], // 2025-05-15, 2025-05-16
    open:   [2900,   2920],
    high:   [2950,   2940],
    low:    [2880,   2900],
    close:  [2935,   2925],
    volume: [1234567, 2345678],
  };

  it("emits one row per bar with formatted numerics", () => {
    const out = chartToCandleRows(goodChart, meta);
    expect(out).toHaveLength(2);
    expect(out[0]!.instrumentToken).toBe(738561);
    expect(out[0]!.interval).toBe("day");
    expect(out[0]!.open).toBe("2900.0000");
    expect(out[0]!.close).toBe("2935.0000");
    expect(out[0]!.volume).toBe(1234567);
    expect(out[0]!.source).toBe("kite");
    expect(out[0]!.symbol).toBe("RELIANCE");
    expect(out[0]!.oi).toBeNull();
  });

  it("converts seconds → Date and preserves order", () => {
    const out = chartToCandleRows(goodChart, meta);
    expect((out[0]!.ts as Date).getTime()).toBe(1747267200 * 1000);
    expect((out[1]!.ts as Date).getTime()).toBe(1747353600 * 1000);
  });

  it("filters bars with non-finite OHLC", () => {
    const dirty = {
      timestamps: [1, 2, 3],
      open:   [100, NaN, 102],
      high:   [110, 115, 112],
      low:    [95,  98,  100],
      close:  [105, 110, 108],
      volume: [1000, 2000, 3000],
    };
    const out = chartToCandleRows(dirty, meta);
    expect(out).toHaveLength(2); // bar with NaN open dropped
    expect(out.map((r) => Math.trunc(((r.ts as Date).getTime()) / 1000))).toEqual([1, 3]);
  });

  it("filters bars with non-positive close (e.g. corp-action gap)", () => {
    const dirty = {
      timestamps: [1, 2],
      open:   [100, 101],
      high:   [110, 102],
      low:    [95, -1],
      close:  [105, 0],
      volume: [1000, 2000],
    };
    const out = chartToCandleRows(dirty, meta);
    expect(out).toHaveLength(1);
  });

  it("normalises missing/negative volume to 0 (no fabrication)", () => {
    const dirty = {
      timestamps: [1, 2],
      open:   [100, 100],
      high:   [110, 110],
      low:    [95, 95],
      close:  [105, 105],
      volume: [NaN, -100],
    };
    const out = chartToCandleRows(dirty, meta);
    expect(out).toHaveLength(2);
    expect(out[0]!.volume).toBe(0);
    expect(out[1]!.volume).toBe(0);
  });

  it("returns empty array when chart has no bars", () => {
    expect(chartToCandleRows({ timestamps: [], open: [], high: [], low: [], close: [], volume: [] }, meta)).toEqual([]);
  });
});

describe("decideKindFromGap", () => {
  it("returns BACKFILL when no prior data", () => {
    expect(decideKindFromGap(null, 5)).toBe("BACKFILL");
  });

  it("returns INCREMENTAL when gap is within threshold", () => {
    const tenHoursAgo = Date.now() - 10 * 3600_000;
    expect(decideKindFromGap(tenHoursAgo, 5)).toBe("INCREMENTAL");
  });

  it("returns BACKFILL when gap exceeds threshold", () => {
    const eightDaysAgo = Date.now() - 8 * 86_400_000;
    expect(decideKindFromGap(eightDaysAgo, 5)).toBe("BACKFILL");
  });

  it("uses exclusive comparison so threshold-equal stays INCREMENTAL", () => {
    const exactlyThreshold = Date.now() - 5 * 86_400_000;
    expect(decideKindFromGap(exactlyThreshold, 5)).toBe("INCREMENTAL");
  });
});
