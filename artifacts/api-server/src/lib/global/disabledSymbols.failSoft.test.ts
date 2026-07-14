import { describe, it, expect, vi, beforeEach } from "vitest";

const dbState = vi.hoisted(() => ({ fail: false, selectValue: [] as Array<{ symbol: string }> }));

vi.mock("@workspace/db", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "from", "where"]) {
    chain[m] = () => chain;
  }
  (chain as { then: unknown }).then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    (dbState.fail ? Promise.reject(new Error("db down")) : Promise.resolve(dbState.selectValue)).then(res, rej);
  return { db: chain };
});

vi.mock("@workspace/db/schema", () => ({
  globalInstrumentOverridesTable: { symbol: { name: "symbol" }, disabled: { name: "disabled" } },
}));

vi.mock("drizzle-orm", () => ({
  eq: (...a: unknown[]) => ({ _eq: a }),
}));

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { loadDisabledSet } from "./disabledSymbols";
import { logger } from "../logger";

describe("loadDisabledSet fail-soft (W6-P5 Phase 1G)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.fail = false;
    dbState.selectValue = [];
  });

  it("returns the disabled set on success (uppercased)", async () => {
    dbState.selectValue = [{ symbol: "btcusdt" }, { symbol: "GC=F" }];
    const set = await loadDisabledSet();
    expect(set.has("BTCUSDT")).toBe(true);
    expect(set.has("GC=F")).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("returns an empty set (does NOT reject) on DB failure and logs a warning", async () => {
    dbState.fail = true;
    await expect(loadDisabledSet()).resolves.toBeInstanceOf(Set);
    const set = await loadDisabledSet();
    expect(set.size).toBe(0);
    expect(logger.warn).toHaveBeenCalled();
  });
});
