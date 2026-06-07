import { describe, it, expect, vi } from "vitest";
import { selectScanRows } from "./scanner";

type ScanRows = Parameters<typeof selectScanRows>[0];
type StockRow = ScanRows[number];

/**
 * Regression test for the cache-first scan fast-path branch logic.
 *
 * Locks the two guarantees that make the dashboard endpoints fast without
 * sacrificing cold-boot correctness:
 *  - warm cache: return the cached rows instantly, schedule a background
 *    refresh, and NEVER block on the full scan;
 *  - cold cache: await the full scan and return its rows (and do not schedule
 *    a redundant background refresh).
 */
const row = (symbol: string): StockRow => ({ symbol }) as unknown as StockRow;

describe("selectScanRows — cache-first fast path", () => {
  it("warm cache returns cached rows instantly and refreshes in the background", async () => {
    const refresh = vi.fn();
    const full = vi.fn(async () => [row("FRESH")]);
    const cached = [row("AAA"), row("BBB")];

    const out = await selectScanRows(cached, refresh, full);

    expect(out).toBe(cached);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(full).not.toHaveBeenCalled();
  });

  it("cold cache blocks on the full scan and does not schedule a refresh", async () => {
    const refresh = vi.fn();
    const scanned = [row("AAA")];
    const full = vi.fn(async () => scanned);

    const out = await selectScanRows([], refresh, full);

    expect(out).toBe(scanned);
    expect(full).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });
});
