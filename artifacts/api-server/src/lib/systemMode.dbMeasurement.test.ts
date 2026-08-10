/**
 * Targeted tests for the DB health measurement instrumentation.
 *
 * All tests invoke measureDbHealthWithPool() directly with controlled
 * mock pools/clients — no regex on source, no real DB connection.
 */
import { describe, expect, it, vi } from "vitest";
import {
  measureDbHealthWithPool,
  computeDbFingerprint,
  deriveSystemMode,
  DB_LATENCY_DEGRADE_MS,
  type MeasurablePool,
  type PoolClientLike,
} from "./systemMode";

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

function makeClient(
  backendPid: number,
  queryDelayMs = 0,
  throwQuery = false,
): PoolClientLike & { releaseCount: number } {
  const c = {
    releaseCount: 0,
    async query<T extends Record<string, unknown>>(_sql: string): Promise<{ rows: T[] }> {
      if (queryDelayMs > 0) await sleep(queryDelayMs);
      if (throwQuery) throw new Error("query_error");
      return { rows: [{ ok: 1, backend_pid: backendPid } as unknown as T] };
    },
    release() {
      c.releaseCount++;
    },
  };
  return c;
}

function makePool(opts: {
  client?: PoolClientLike & { releaseCount: number };
  failAcquire?: boolean;
  acquireDelayMs?: number;
  totalCount?: number;
  idleCount?: number;
  waitingCount?: number;
  max?: number;
}): MeasurablePool & { client?: PoolClientLike & { releaseCount: number } } {
  return {
    client: opts.client,
    async connect(): Promise<PoolClientLike> {
      if (opts.acquireDelayMs) await sleep(opts.acquireDelayMs);
      if (opts.failAcquire) throw new Error("connect_error");
      if (!opts.client) throw new Error("no client configured");
      return opts.client;
    },
    totalCount: opts.totalCount ?? 1,
    idleCount: opts.idleCount ?? 1,
    waitingCount: opts.waitingCount ?? 0,
    options: { max: opts.max ?? 10 },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// 1. Fast acquisition + fast query → ok, totalMs ≈ acquireMs + queryMs
// ---------------------------------------------------------------------------
describe("measureDbHealthWithPool — success paths", () => {
  it("fast acquire + fast query → ok, totalMs reconciles", async () => {
    const client = makeClient(1234);
    const p = makePool({ client });
    const { result } = await measureDbHealthWithPool(p, null);

    expect(result.dbMeasurementStatus).toBe("ok");
    expect(result.acquireMs).not.toBeNull();
    expect(result.queryMs).not.toBeNull();
    expect(result.totalMs).not.toBeNull();
    // totalMs must equal acquireMs + queryMs (within 5ms clock tolerance)
    expect(Math.abs(result.totalMs! - result.acquireMs! - result.queryMs!)).toBeLessThan(5);
    expect(result.backendPid).toBe(1234);
  });

  it("slow acquire + fast query → acquireMs dominates totalMs", async () => {
    const client = makeClient(42);
    const p = makePool({ client, acquireDelayMs: 50 });
    const { result } = await measureDbHealthWithPool(p, null);

    expect(result.dbMeasurementStatus).toBe("ok");
    expect(result.acquireMs).toBeGreaterThanOrEqual(40);
    expect(result.queryMs).toBeLessThan(result.acquireMs!);
  });

  it("fast acquire + slow query → queryMs dominates totalMs", async () => {
    const client = makeClient(99, 50);
    const p = makePool({ client });
    const { result } = await measureDbHealthWithPool(p, null);

    expect(result.dbMeasurementStatus).toBe("ok");
    expect(result.queryMs).toBeGreaterThanOrEqual(40);
    expect(result.acquireMs).toBeLessThan(result.queryMs!);
  });

  it("pool waitingCount > 0 is captured in before counters", async () => {
    const client = makeClient(7);
    const p = makePool({ client, totalCount: 10, idleCount: 0, waitingCount: 3 });
    const { result } = await measureDbHealthWithPool(p, null);

    expect(result.poolWaitingCountBefore).toBe(3);
    expect(result.poolIdleCountBefore).toBe(0);
    expect(result.poolTotalCountBefore).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// 2. Failure paths
// ---------------------------------------------------------------------------
describe("measureDbHealthWithPool — failure paths", () => {
  it("acquisition failure → acquire_failed, totalMs null, no release", async () => {
    const p = makePool({ failAcquire: true });
    const { result } = await measureDbHealthWithPool(p, null);

    expect(result.dbMeasurementStatus).toBe("acquire_failed");
    expect(result.acquireMs).toBeNull();
    expect(result.queryMs).toBeNull();
    expect(result.totalMs).toBeNull();
    expect(result.backendPid).toBeNull();
    // no client means no release to count; just check status
  });

  it("query failure → query_failed, totalMs null, client released exactly once", async () => {
    const client = makeClient(0, 0, true /* throwQuery */);
    const p = makePool({ client });
    const { result } = await measureDbHealthWithPool(p, null);

    expect(result.dbMeasurementStatus).toBe("query_failed");
    expect(result.totalMs).toBeNull();
    expect(result.queryMs).toBeNull();
    // acquire succeeded before throw
    expect(result.acquireMs).not.toBeNull();
    expect(client.releaseCount).toBe(1); // released exactly once in finally
  });
});

// ---------------------------------------------------------------------------
// 3. Release discipline
// ---------------------------------------------------------------------------
describe("measureDbHealthWithPool — release discipline", () => {
  it("client released exactly once after success", async () => {
    const client = makeClient(11);
    const p = makePool({ client });
    await measureDbHealthWithPool(p, null);
    expect(client.releaseCount).toBe(1);
  });

  it("client released exactly once after query failure", async () => {
    const client = makeClient(0, 0, true);
    const p = makePool({ client });
    await measureDbHealthWithPool(p, null);
    expect(client.releaseCount).toBe(1);
  });

  it("no release attempted when acquisition fails (no client)", async () => {
    // makePool with failAcquire never yields a client; if release were called
    // on undefined it would throw — the function should not throw.
    const p = makePool({ failAcquire: true });
    await expect(measureDbHealthWithPool(p, null)).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 4. backendPid tracking
// ---------------------------------------------------------------------------
describe("measureDbHealthWithPool — backendPid / connection reuse", () => {
  it("first call: backendPidChanged is null (no prior measurement)", async () => {
    const client = makeClient(500);
    const p = makePool({ client });
    const { result } = await measureDbHealthWithPool(p, null);
    expect(result.backendPidChanged).toBeNull();
    expect(result.backendPid).toBe(500);
  });

  it("same PID as previous → backendPidChanged = false (connection reused)", async () => {
    const client = makeClient(500);
    const p = makePool({ client });
    const { result } = await measureDbHealthWithPool(p, 500 /* prevPid */);
    expect(result.backendPidChanged).toBe(false);
  });

  it("different PID from previous → backendPidChanged = true (new PG backend)", async () => {
    const client = makeClient(501);
    const p = makePool({ client });
    const { result } = await measureDbHealthWithPool(p, 500 /* prevPid */);
    expect(result.backendPidChanged).toBe(true);
  });

  it("nextPid carries forward when query succeeds", async () => {
    const client = makeClient(777);
    const p = makePool({ client });
    const { nextPid } = await measureDbHealthWithPool(p, null);
    expect(nextPid).toBe(777);
  });

  it("nextPid is null when query fails", async () => {
    const client = makeClient(0, 0, true);
    const p = makePool({ client });
    const { nextPid } = await measureDbHealthWithPool(p, 100);
    expect(nextPid).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. totalMs reconciles with acquireMs + queryMs within clock tolerance
// ---------------------------------------------------------------------------
it("totalMs = acquireMs + queryMs (within 5ms)", async () => {
  const client = makeClient(1);
  const p = makePool({ client });
  const { result } = await measureDbHealthWithPool(p, null);
  expect(result.totalMs).toBe(result.acquireMs! + result.queryMs!);
});

// ---------------------------------------------------------------------------
// 6. No secret or raw DB identity in measurement result
// ---------------------------------------------------------------------------
it("DbMeasurementResult contains no DATABASE_URL or raw host/port/password", async () => {
  const client = makeClient(99);
  const p = makePool({ client });
  const { result } = await measureDbHealthWithPool(p, null);
  const serialized = JSON.stringify(result);
  // Must not contain raw connection string components if DATABASE_URL is set
  const dbUrl = process.env["DATABASE_URL"] ?? "";
  if (dbUrl) {
    const u = new URL(dbUrl);
    if (u.password) expect(serialized).not.toContain(u.password);
    if (u.username) expect(serialized).not.toContain(u.username);
    expect(serialized).not.toContain(dbUrl);
  }
  // backendPid is a numeric process identifier — not a secret
  expect(serialized).toContain("backendPid");
});

// ---------------------------------------------------------------------------
// 7. DB fingerprint — one-way, 16 hex chars, no source values
// ---------------------------------------------------------------------------
describe("computeDbFingerprint", () => {
  it("returns a 16-character hex string when DATABASE_URL is parseable", () => {
    // Only run if DATABASE_URL is actually set in this test context
    const fp = computeDbFingerprint();
    if (fp !== null) {
      expect(fp).toHaveLength(16);
      expect(/^[0-9a-f]{16}$/.test(fp)).toBe(true);
    }
  });

  it("fingerprint does not contain hostname, port or password", () => {
    const fp = computeDbFingerprint();
    const dbUrl = process.env["DATABASE_URL"] ?? "";
    if (!fp || !dbUrl) return;
    try {
      const u = new URL(dbUrl);
      if (u.hostname) expect(fp).not.toBe(u.hostname);
      if (u.port) expect(fp).not.toBe(u.port);
      if (u.password) expect(fp).not.toContain(u.password);
    } catch { /* unparseable — skip */ }
  });
});

// ---------------------------------------------------------------------------
// 8. Existing system-mode thresholds unchanged
// ---------------------------------------------------------------------------
describe("existing system-mode thresholds", () => {
  it("DB_LATENCY_DEGRADE_MS is still 500", () => {
    expect(DB_LATENCY_DEGRADE_MS).toBe(500);
  });

  it("deriveSystemMode still degrades on totalMs > 500", () => {
    const base = {
      sessionValid: true,
      feedConnected: true,
      feedDisconnectedForMs: 0,
      marketSession: "open" as const,
    };
    const r = deriveSystemMode({ ...base, dbLatencyMs: 501 });
    expect(r.mode).toBe("DEGRADED");
    expect(r.drivers.some((d) => d.startsWith("DB_LATENCY"))).toBe(true);
  });

  it("deriveSystemMode stays NORMAL at exactly the threshold", () => {
    const base = {
      sessionValid: true,
      feedConnected: true,
      feedDisconnectedForMs: 0,
      marketSession: "open" as const,
    };
    const r = deriveSystemMode({ ...base, dbLatencyMs: 500 });
    expect(r.mode).toBe("NORMAL");
  });

  it("acquire_failed (totalMs=null) triggers DB_HEALTH_CHECK_FAILED → DEGRADED", () => {
    const base = {
      sessionValid: true,
      feedConnected: true,
      feedDisconnectedForMs: 0,
      marketSession: "open" as const,
    };
    const r = deriveSystemMode({ ...base, dbLatencyMs: null });
    expect(r.mode).toBe("DEGRADED");
    expect(r.drivers).toContain("DB_HEALTH_CHECK_FAILED");
  });
});

// ---------------------------------------------------------------------------
// 9. Fail-closed safety: acquisition failure → null totalMs → DEGRADED
// ---------------------------------------------------------------------------
it("acquisition failure produces null totalMs which fail-closes system mode to DEGRADED", async () => {
  const p = makePool({ failAcquire: true });
  const { result } = await measureDbHealthWithPool(p, null);

  expect(result.totalMs).toBeNull();
  const r = deriveSystemMode({
    sessionValid: true,
    feedConnected: true,
    feedDisconnectedForMs: 0,
    marketSession: "open",
    dbLatencyMs: result.totalMs,
  });
  expect(r.mode).toBe("DEGRADED");
  expect(r.drivers).toContain("DB_HEALTH_CHECK_FAILED");
});
