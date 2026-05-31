import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { scheduleBootJob, BOOT_STAGGER_MS } from "./bootScheduler";

describe("scheduleBootJob", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("does not run the job before its delay and runs it exactly once after (non-blocking + offset)", async () => {
    const fn = vi.fn();
    scheduleBootJob("t", 1_000, fn);
    // returns immediately without invoking fn -> server startup is never blocked
    expect(fn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(999);
    expect(fn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("catches a synchronous throw (fail-open, no crash)", async () => {
    const fn = vi.fn(() => {
      throw new Error("boom");
    });
    expect(() => scheduleBootJob("t", 10, fn)).not.toThrow();
    await vi.advanceTimersByTimeAsync(10);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("catches a rejected async job (fail-open, no unhandled rejection)", async () => {
    const fn = vi.fn(async () => {
      throw new Error("boom-async");
    });
    scheduleBootJob("t", 10, fn);
    await vi.advanceTimersByTimeAsync(10);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("returns a timer handle that can be cleared (no job dropped / leaked)", () => {
    const fn = vi.fn();
    const handle = scheduleBootJob("t", 10, fn);
    expect(handle).toBeDefined();
    clearTimeout(handle);
    // cleared before firing -> never runs
    void vi.advanceTimersByTimeAsync(10);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("BOOT_STAGGER_MS offsets", () => {
  it("are deterministic, strictly increasing, and within the approved windows", () => {
    // 10-20s: global data pump
    expect(BOOT_STAGGER_MS.globalDataPump).toBeGreaterThanOrEqual(10_000);
    expect(BOOT_STAGGER_MS.globalDataPump).toBeLessThanOrEqual(20_000);
    // 25-40s: preset scheduler (its internal first tick fires +5s after start)
    expect(BOOT_STAGGER_MS.presetScheduler).toBeGreaterThanOrEqual(25_000);
    expect(BOOT_STAGGER_MS.presetScheduler).toBeLessThanOrEqual(40_000);
    // 45-75s: participant OI / instFlows initial tick
    expect(BOOT_STAGGER_MS.instFlowsRefresher).toBeGreaterThanOrEqual(45_000);
    expect(BOOT_STAGGER_MS.instFlowsRefresher).toBeLessThanOrEqual(75_000);
    // strictly increasing -> jobs are spread, never collapsed into one window
    expect(BOOT_STAGGER_MS.globalDataPump).toBeLessThan(BOOT_STAGGER_MS.presetScheduler);
    expect(BOOT_STAGGER_MS.presetScheduler).toBeLessThan(BOOT_STAGGER_MS.instFlowsRefresher);
  });
});
