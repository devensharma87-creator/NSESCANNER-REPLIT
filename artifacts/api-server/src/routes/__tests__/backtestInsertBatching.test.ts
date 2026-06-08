/**
 * Backtest Lab — child-row insert batching (regression).
 *
 * A 2yr × ALL-instruments × multi-strategy run emits several thousand
 * `backtest_trades` rows. Persisting them in ONE multi-row
 * `tx.insert(...).values([...])` builds a query whose bind-parameter count
 * (rows × columns) blows past Postgres's hard 65535-param ceiling AND is deep
 * enough to overflow Drizzle's query builder ("Maximum call stack size
 * exceeded") — which surfaced as the Strategy-Research HTTP 500 and the
 * Directional HTTP 502. The fix inserts in bounded batches via `chunk()`.
 *
 * This locks in two things cheaply and deterministically (no DB needed):
 *  1. `chunk()` partitions losslessly, in order, with a correct final remainder.
 *  2. The configured batch size keeps each statement's bind-parameter budget
 *     (`DB_INSERT_BATCH_SIZE × actual backtest_trades column count`) safely under
 *     the 65535 ceiling — so a future bump to the batch size can't silently
 *     reintroduce the overflow.
 */

import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { chunk, DB_INSERT_BATCH_SIZE } from "../backtest";
import { backtestTradesTable } from "@workspace/db";

const PG_MAX_BIND_PARAMS = 65535;

describe("backtest child-row insert batching", () => {
  it("chunk() partitions losslessly, preserving order, with a correct remainder", () => {
    const items = Array.from({ length: 1003 }, (_, i) => i);
    const batches = chunk(items, DB_INSERT_BATCH_SIZE);

    // 1003 / 500 → [500, 500, 3]
    expect(batches.length).toBe(3);
    expect(batches.slice(0, -1).every((b) => b.length === DB_INSERT_BATCH_SIZE)).toBe(true);
    expect(batches.at(-1)!.length).toBe(1003 % DB_INSERT_BATCH_SIZE);

    // Flattening reproduces the input exactly (no loss, no reorder, no dupes).
    expect(batches.flat()).toEqual(items);
  });

  it("chunk() handles empty input and exact multiples", () => {
    expect(chunk([], DB_INSERT_BATCH_SIZE)).toEqual([]);
    const exact = Array.from({ length: DB_INSERT_BATCH_SIZE * 2 }, (_, i) => i);
    const batches = chunk(exact, DB_INSERT_BATCH_SIZE);
    expect(batches.length).toBe(2);
    expect(batches.every((b) => b.length === DB_INSERT_BATCH_SIZE)).toBe(true);
  });

  it("batch size keeps each insert's bind-param count under the Postgres ceiling", () => {
    const columnCount = Object.keys(getTableColumns(backtestTradesTable)).length;
    expect(columnCount).toBeGreaterThan(0);
    // The widest child table; if THIS stays under the cap, blocked-setups does too.
    expect(DB_INSERT_BATCH_SIZE * columnCount).toBeLessThan(PG_MAX_BIND_PARAMS);
  });
});
