import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const dbState = vi.hoisted(() => ({ fail: false, selectValue: [] as unknown[] }));

vi.mock("@workspace/db", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "update", "set"]) {
    chain[m] = () => chain;
  }
  (chain as { then: unknown }).then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    (dbState.fail ? Promise.reject(new Error("db down")) : Promise.resolve(dbState.selectValue)).then(res, rej);
  return { db: chain };
});

vi.mock("@workspace/db/schema", () => ({
  globalScreenerPresetsTable: { id: { name: "id" }, autoRunIntervalMin: { name: "auto_run_interval_min" } },
}));

vi.mock("drizzle-orm", () => ({
  eq: (...a: unknown[]) => ({ _eq: a }),
  isNotNull: (...a: unknown[]) => ({ _isNotNull: a }),
}));

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("./screener", () => ({
  ScreenerBody: { safeParse: () => ({ success: true, data: {} }) },
  runGlobalScreener: vi.fn(async () => ({ hits: [] })),
}));

import {
  startScreenerPresetScheduler,
  stopScreenerPresetScheduler,
  runPresetNow,
} from "./presetScheduler";
import { runGlobalScreener } from "./screener";

describe("presetScheduler failure isolation + cadence (W6-P5 Phase 1G)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.fail = false;
    dbState.selectValue = [];
    stopScreenerPresetScheduler();
  });
  afterEach(() => {
    stopScreenerPresetScheduler();
    vi.useRealTimers();
  });

  it("preserves cadence: 30s interval tick + 5s boot kickoff (UNCHANGED)", () => {
    vi.useFakeTimers();
    const setInt = vi.spyOn(global, "setInterval");
    const setTo = vi.spyOn(global, "setTimeout");
    startScreenerPresetScheduler();
    expect(setInt).toHaveBeenCalledWith(expect.any(Function), 30_000);
    expect(setTo).toHaveBeenCalledWith(expect.any(Function), 5_000);
  });

  it("does not crash when the tick's DB load fails (boundary is isolated)", async () => {
    vi.useFakeTimers();
    dbState.fail = true;
    startScreenerPresetScheduler();
    // Advance past the 5s boot kickoff and one 30s interval — neither should throw.
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(true).toBe(true); // reaching here means no unhandled rejection escaped
  });

  it("runPresetNow does not reject even when the screener throws (runOne is guarded)", async () => {
    dbState.selectValue = [{ id: "p1", body: {}, lastHitSymbols: [], lastNewHits: [] }];
    (runGlobalScreener as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("screener boom"));
    await expect(runPresetNow("p1")).resolves.toEqual({ ok: true });
  });
});
