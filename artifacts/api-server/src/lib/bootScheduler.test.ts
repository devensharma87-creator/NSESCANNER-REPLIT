import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  scheduleBootJob,
  BOOT_STAGGER_MS,
  logDbPoolStats,
  scheduleDbPoolStatsLog,
  POOL_STATS_LOG_DELAYS_MS,
} from "./bootScheduler";
import { getDbPoolStats } from "@workspace/db";
import { logger } from "./logger";

function findLogCall(msg: string): unknown[] | undefined {
  return (logger.info as unknown as { mock: { calls: unknown[][] } }).mock.calls.find(
    (c) => c[1] === msg,
  );
}

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

describe("getDbPoolStats (W6-P4B5 — read-only pool counters)", () => {
  it("returns only the four numeric counters from a pool-like source", () => {
    const stats = getDbPoolStats({
      totalCount: 3,
      idleCount: 2,
      waitingCount: 1,
      options: { max: 10 },
    });
    expect(stats).toEqual({ total: 3, idle: 2, waiting: 1, max: 10 });
  });

  it("never exposes secrets / connection string from the pool options", () => {
    const stats = getDbPoolStats({
      totalCount: 1,
      idleCount: 1,
      waitingCount: 0,
      // a real pg pool's options also carry the connection string — must be dropped
      options: { max: 10, connectionString: "postgres://user:secret@host:5432/db" } as never,
    });
    expect(stats).not.toBeNull();
    expect(Object.keys(stats!)).toEqual(["total", "idle", "waiting", "max"]);
    expect(stats).not.toHaveProperty("options");
    expect(stats).not.toHaveProperty("connectionString");
    expect(JSON.stringify(stats)).not.toContain("postgres://");
    expect(JSON.stringify(stats)).not.toContain("secret");
  });

  it("returns null (fail-open) when any counter is unavailable", () => {
    expect(getDbPoolStats({})).toBeNull();
    // missing max
    expect(getDbPoolStats({ totalCount: 1, idleCount: 1, waitingCount: 1 })).toBeNull();
    // missing waiting
    expect(
      getDbPoolStats({ totalCount: 1, idleCount: 1, options: { max: 10 } }),
    ).toBeNull();
  });
});

describe("logDbPoolStats (W6-P4B5)", () => {
  it("logs only the safe counters (+label/uptime), never secrets", () => {
    logDbPoolStats("post-boot+30s", () => ({ total: 4, idle: 1, waiting: 2, max: 10 }));
    const call = findLogCall("post-boot db pool stats");
    expect(call).toBeDefined();
    const payload = call![0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      label: "post-boot+30s",
      total: 4,
      idle: 1,
      waiting: 2,
      max: 10,
    });
    expect(typeof payload.uptimeSec).toBe("number");
    expect(JSON.stringify(payload)).not.toContain("postgres://");
  });

  it("logs an 'unavailable' line and does not throw when stats are null", () => {
    expect(() => logDbPoolStats("x", () => null)).not.toThrow();
    expect(findLogCall("post-boot db pool stats unavailable")).toBeDefined();
  });

  it("is fail-open: swallows a throw from the stats provider", () => {
    expect(() =>
      logDbPoolStats("x", () => {
        throw new Error("boom");
      }),
    ).not.toThrow();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("consults ONLY the injected provider (no DB query / connection acquisition)", () => {
    const getStats = vi.fn(() => ({ total: 0, idle: 0, waiting: 0, max: 10 }));
    logDbPoolStats("x", getStats);
    expect(getStats).toHaveBeenCalledTimes(1);
  });
});

describe("scheduleDbPoolStatsLog (W6-P4B5)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("is non-blocking and fires exactly once after the delay", async () => {
    const getStats = vi.fn(() => null);
    scheduleDbPoolStatsLog("post-boot+30s", 30_000, getStats);
    expect(getStats).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(getStats).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(getStats).toHaveBeenCalledTimes(1);
  });

  it("returns a clearable timer handle (snapshot can be cancelled)", () => {
    const getStats = vi.fn(() => null);
    const handle = scheduleDbPoolStatsLog("x", 10, getStats);
    expect(handle).toBeDefined();
    clearTimeout(handle);
    void vi.advanceTimersByTimeAsync(10);
    expect(getStats).not.toHaveBeenCalled();
  });
});

describe("POOL_STATS_LOG_DELAYS_MS bracket", () => {
  it("is the read-only [30s, 75s, 120s] bracket, strictly increasing", () => {
    expect([...POOL_STATS_LOG_DELAYS_MS]).toEqual([30_000, 75_000, 120_000]);
    for (let i = 1; i < POOL_STATS_LOG_DELAYS_MS.length; i++) {
      expect(POOL_STATS_LOG_DELAYS_MS[i]!).toBeGreaterThan(POOL_STATS_LOG_DELAYS_MS[i - 1]!);
    }
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
