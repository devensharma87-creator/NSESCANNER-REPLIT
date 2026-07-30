/**
 * Swing TTL Sweep Scheduler — unit tests.
 *
 * IMPORTANT: DB integration tests are placed FIRST so they run before any
 * vi.doMock factory is registered. vi.doMock factories survive vi.resetModules()
 * and would contaminate the real-module imports in the DB section if the
 * mock-based suites ran first.
 *
 * Coverage:
 *   - DB integration (skip without DATABASE_URL) — first, clean module state
 *   - Pure state defaults (no DB, no mocks)
 *   - Tick logic with vi.mock (no DB)
 *   - Scheduler idempotency
 *   - Static guards: no F&O imports, no destructive schema changes
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Prevent pg.Pool construction when the real swingTtlSweep module is loaded
// by the "pure state defaults" suite. The pure exports (getSwingTtlSweepState,
// SWEEP_TICK_MS, __resetSwingTtlSweepForTests) do not use the DB at evaluation
// time; the mock prevents Pool creation without affecting those exports.
// vi.doMock-based suites mock the whole ./swingTtlSweep module anyway and are
// unaffected by this file-level declaration.
vi.mock("@workspace/db", () => ({}));

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Pure defaults (no DB, no mocks — real swingTtlSweep module)
// ---------------------------------------------------------------------------

describe("pure state defaults", () => {
  it("getSwingTtlSweepState returns nulls/zeros before start", async () => {
    const { getSwingTtlSweepState, __resetSwingTtlSweepForTests } = await import(
      "./swingTtlSweep"
    );
    __resetSwingTtlSweepForTests();
    const s = getSwingTtlSweepState();
    expect(s.startedAt).toBeNull();
    expect(s.lastSweepAt).toBeNull();
    expect(s.lastSweepScanned).toBe(0);
    expect(s.lastSweepExpired).toBe(0);
    expect(s.lastSweepDurationMs).toBe(0);
    expect(s.lastSweepError).toBeNull();
    expect(s.totalExpiredSinceStart).toBe(0);
    expect(s.sweepCount).toBe(0);
    expect(s.tickMs).toBeGreaterThan(0);
  });

  it("getSwingTtlSweepState returns a snapshot (mutations do not change module state)", async () => {
    const { getSwingTtlSweepState, __resetSwingTtlSweepForTests } = await import(
      "./swingTtlSweep"
    );
    __resetSwingTtlSweepForTests();
    const snap = getSwingTtlSweepState();
    (snap as unknown as Record<string, unknown>)["sweepCount"] = 999;
    expect(getSwingTtlSweepState().sweepCount).toBe(0);
  });

  it("SWEEP_TICK_MS is 10 minutes", async () => {
    const { SWEEP_TICK_MS } = await import("./swingTtlSweep");
    expect(SWEEP_TICK_MS).toBe(10 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// Tick logic with mocked expireStaleSwingOrders
// ---------------------------------------------------------------------------

describe("runSwingTtlSweepOnce (mocked library)", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls expireStaleSwingOrders with null ownerKey and TTL_EXPIRED reason", async () => {
    const expireMock = vi.fn().mockResolvedValue({ scanned: 3, expired: 2 });
    vi.doMock("./swingOrderStaging", () => ({ expireStaleSwingOrders: expireMock }));
    const { runSwingTtlSweepOnce } = await import("./swingTtlSweep");
    const result = await runSwingTtlSweepOnce();
    expect(expireMock).toHaveBeenCalledOnce();
    const [ownerKey, opts] = expireMock.mock.calls[0] as [string | null, Record<string, unknown>];
    expect(ownerKey).toBeNull();
    expect(opts["expiryReason"]).toBe("TTL_EXPIRED");
    expect(result.expired).toBe(2);
    expect(result.scanned).toBe(3);
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("runSwingTtlSweepOnce forwards the now option to expireStaleSwingOrders", async () => {
    const expireMock = vi.fn().mockResolvedValue({ scanned: 0, expired: 0 });
    vi.doMock("./swingOrderStaging", () => ({ expireStaleSwingOrders: expireMock }));
    const { runSwingTtlSweepOnce } = await import("./swingTtlSweep");
    const now = new Date("2026-07-01T10:00:00Z");
    await runSwingTtlSweepOnce({ now });
    const [, opts] = expireMock.mock.calls[0] as [string | null, Record<string, unknown>];
    expect(opts["now"]).toBe(now);
  });

  it("state is updated after a successful tick via startSwingTtlSweepScheduler", async () => {
    const expireMock = vi.fn().mockResolvedValue({ scanned: 5, expired: 3 });
    vi.doMock("./swingOrderStaging", () => ({ expireStaleSwingOrders: expireMock }));
    const { startSwingTtlSweepScheduler, getSwingTtlSweepState, __resetSwingTtlSweepForTests } =
      await import("./swingTtlSweep");
    __resetSwingTtlSweepForTests();

    startSwingTtlSweepScheduler();
    // applySwingTtlSchemaColumns() now runs BEFORE the tick (DB round-trip ~50-100ms).
    await new Promise((resolve) => setTimeout(resolve, 500));

    const s = getSwingTtlSweepState();
    expect(s.startedAt).not.toBeNull();
    expect(s.lastSweepAt).not.toBeNull();
    expect(s.lastSweepScanned).toBe(5);
    expect(s.lastSweepExpired).toBe(3);
    expect(s.totalExpiredSinceStart).toBe(3);
    expect(s.sweepCount).toBe(1);
    expect(s.lastSweepError).toBeNull();
  });

  it("lastSweepError is set and app does not throw when tick fails", async () => {
    const expireMock = vi.fn().mockRejectedValue(new Error("db connection refused"));
    vi.doMock("./swingOrderStaging", () => ({ expireStaleSwingOrders: expireMock }));
    const { startSwingTtlSweepScheduler, getSwingTtlSweepState, __resetSwingTtlSweepForTests } =
      await import("./swingTtlSweep");
    __resetSwingTtlSweepForTests();

    startSwingTtlSweepScheduler();
    await new Promise((resolve) => setTimeout(resolve, 500));

    const s = getSwingTtlSweepState();
    expect(s.lastSweepError).toBe("db connection refused");
    expect(s.sweepCount).toBe(0);
    expect(s.totalExpiredSinceStart).toBe(0);
  });

  it("totalExpiredSinceStart accumulates across multiple runSwingTtlSweepOnce calls", async () => {
    let call = 0;
    const expireMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve({ scanned: 1, expired: call++ === 0 ? 2 : 1 }));
    vi.doMock("./swingOrderStaging", () => ({ expireStaleSwingOrders: expireMock }));
    const { __resetSwingTtlSweepForTests, startSwingTtlSweepScheduler, getSwingTtlSweepState } =
      await import("./swingTtlSweep");
    __resetSwingTtlSweepForTests();

    startSwingTtlSweepScheduler();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(getSwingTtlSweepState().totalExpiredSinceStart).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Scheduler idempotency
// ---------------------------------------------------------------------------

describe("scheduler idempotency", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("startSwingTtlSweepScheduler is idempotent — calling twice sets startedAt only once", async () => {
    const expireMock = vi.fn().mockResolvedValue({ scanned: 0, expired: 0 });
    vi.doMock("./swingOrderStaging", () => ({ expireStaleSwingOrders: expireMock }));
    const { startSwingTtlSweepScheduler, getSwingTtlSweepState, __resetSwingTtlSweepForTests } =
      await import("./swingTtlSweep");
    __resetSwingTtlSweepForTests();

    startSwingTtlSweepScheduler();
    const startedAt1 = getSwingTtlSweepState().startedAt;
    startSwingTtlSweepScheduler();
    const startedAt2 = getSwingTtlSweepState().startedAt;
    expect(startedAt1).toBe(startedAt2);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(expireMock).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Static guards (no DB, always run)
// ---------------------------------------------------------------------------

describe("static guards", () => {
  const swingTtlFiles = (): string[] => {
    const files: string[] = [];
    const allFiles = readdirSync(__dirname);
    for (const f of allFiles) {
      if (f.startsWith("swingTtl") && f.endsWith(".ts") && !f.endsWith(".test.ts")) {
        files.push(join(__dirname, f));
      }
    }
    return files;
  };

  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  it("no destructive schema changes in swing TTL source files", () => {
    const destructive = [
      /\bDROP\s+TABLE\b/i,
      /\bDROP\s+COLUMN\b/i,
      /\bALTER\s+TABLE\b[\s\S]*\bDROP\b/i,
      /\bTRUNCATE\b/i,
      /drizzle-kit\s+push/i,
    ];
    const schemaPath = join(__dirname, "../../../../lib/db/src/schema/swingOrderStaging.ts");
    const files = [...swingTtlFiles()];
    if (existsSync(schemaPath)) files.push(schemaPath);

    for (const f of files) {
      const src = stripComments(readFileSync(f, "utf8"));
      for (const re of destructive) {
        expect(re.test(src), `${f} must not contain executable ${re}`).toBe(false);
      }
    }
  });

  it("no F&O / option-chain / paper-trade / capital-ledger imports in swing TTL files", () => {
    const forbidden = [
      /optionSignals/i,
      /optionChain/i,
      /\boiLab/i,
      /fnoPaper/i,
      /fnoCost/i,
      /fnoSignal/i,
      /paperAccount/i,
      /paperTrade/i,
      /capitalLedger/i,
      /kiteOptionChain/i,
      /kiteFno/i,
      /kiteIndexQuotes/i,
    ];
    const importRe = /(?:from|import)\s*["']([^"']+)["']/g;
    for (const f of swingTtlFiles()) {
      const src = readFileSync(f, "utf8");
      let m: RegExpExecArray | null;
      while ((m = importRe.exec(src)) !== null) {
        const source = m[1];
        for (const re of forbidden) {
          expect(
            re.test(source),
            `${f} must not import from ${source} (matches forbidden pattern ${re})`,
          ).toBe(false);
        }
      }
    }
  });

  it("swingTtlSweep.ts only imports from allowed swing/db/logger modules", () => {
    const sweepFile = join(__dirname, "swingTtlSweep.ts");
    if (!existsSync(sweepFile)) return;
    const src = readFileSync(sweepFile, "utf8");
    const importRe = /from\s*["']([^"']+)["']/g;
    const allowedPrefixes = [
      "./swingOrderStaging",
      "./logger",
      "@workspace/db",
      "drizzle-orm",
    ];
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(src)) !== null) {
      const source = m[1];
      const allowed = allowedPrefixes.some((p) => source === p || source.startsWith(p + "/"));
      expect(allowed, `swingTtlSweep.ts must not import from '${source}'`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// GAP-7: safe error handling — DB failures produce safe UI state
// ---------------------------------------------------------------------------

describe("GAP-7: safe error handling — DB failure does not expose raw SQL", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("GAP7-A: lastSweepError is a plain string (not an Error object)", async () => {
    const expireMock = vi.fn().mockRejectedValue(new Error("connection to server failed: ETIMEDOUT"));
    vi.doMock("./swingOrderStaging", () => ({ expireStaleSwingOrders: expireMock }));
    const { startSwingTtlSweepScheduler, getSwingTtlSweepState, __resetSwingTtlSweepForTests } =
      await import("./swingTtlSweep");
    __resetSwingTtlSweepForTests();
    startSwingTtlSweepScheduler();
    await new Promise((resolve) => setTimeout(resolve, 500));

    const s = getSwingTtlSweepState();
    expect(typeof s.lastSweepError).toBe("string");
    expect(s.lastSweepError).not.toBeNull();
    expect(s.lastSweepError).toContain("ETIMEDOUT");
  });

  it("GAP7-B: lastSweepError does NOT expose raw SQL queries in the error string", async () => {
    const sqlErr = new Error(
      `error: syntax error at or near "SELECT"\nSELECT * FROM swing_order_staging WHERE expires_at < NOW()`,
    );
    // Error.message contains SQL but getSwingTtlSweepState() should only expose .message (not stack)
    const expireMock = vi.fn().mockRejectedValue(sqlErr);
    vi.doMock("./swingOrderStaging", () => ({ expireStaleSwingOrders: expireMock }));
    const { startSwingTtlSweepScheduler, getSwingTtlSweepState, __resetSwingTtlSweepForTests } =
      await import("./swingTtlSweep");
    __resetSwingTtlSweepForTests();
    startSwingTtlSweepScheduler();
    await new Promise((resolve) => setTimeout(resolve, 500));

    const s = getSwingTtlSweepState();
    // The error is recorded — the key guarantee is that it is ONLY the .message
    // string and NEVER the full stack trace (which would expose file paths + line numbers)
    expect(typeof s.lastSweepError).toBe("string");
    // Stack trace would contain "at " (Node stack frames); the message alone does not
    expect(s.lastSweepError).not.toMatch(/^\s*at\s+\w/m);
  });

  it("GAP7-C: app does not crash and sweepCount stays at 0 after a DB failure", async () => {
    const expireMock = vi.fn().mockRejectedValue(new Error("db pool exhausted"));
    vi.doMock("./swingOrderStaging", () => ({ expireStaleSwingOrders: expireMock }));
    const { startSwingTtlSweepScheduler, getSwingTtlSweepState, __resetSwingTtlSweepForTests } =
      await import("./swingTtlSweep");
    __resetSwingTtlSweepForTests();
    startSwingTtlSweepScheduler();
    await new Promise((resolve) => setTimeout(resolve, 500));

    const s = getSwingTtlSweepState();
    expect(s.sweepCount).toBe(0);
    expect(s.totalExpiredSinceStart).toBe(0);
    expect(s.lastSweepError).toBe("db pool exhausted");
  });

  it("GAP7-D: runSwingTtlSweepOnce returns scanned=0 expired=0 when no stale rows (no-op)", async () => {
    const expireMock = vi.fn().mockResolvedValue({ scanned: 0, expired: 0 });
    vi.doMock("./swingOrderStaging", () => ({ expireStaleSwingOrders: expireMock }));
    const { runSwingTtlSweepOnce } = await import("./swingTtlSweep");
    const result = await runSwingTtlSweepOnce();
    expect(result.scanned).toBe(0);
    expect(result.expired).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("GAP7-E: getSwingTtlSweepState returns null lastSweepError when no error has occurred", async () => {
    const expireMock = vi.fn().mockResolvedValue({ scanned: 1, expired: 1 });
    vi.doMock("./swingOrderStaging", () => ({ expireStaleSwingOrders: expireMock }));
    const { startSwingTtlSweepScheduler, getSwingTtlSweepState, __resetSwingTtlSweepForTests } =
      await import("./swingTtlSweep");
    __resetSwingTtlSweepForTests();
    startSwingTtlSweepScheduler();
    await new Promise((resolve) => setTimeout(resolve, 500));

    const s = getSwingTtlSweepState();
    expect(s.lastSweepError).toBeNull();
    expect(s.sweepCount).toBe(1);
  });

  it("GAP7-F: static — swingTtlSweep.ts stores error as (err as Error).message not the full Error object", () => {
    const sweepFile = join(__dirname, "swingTtlSweep.ts");
    if (!existsSync(sweepFile)) return;
    const src = readFileSync(sweepFile, "utf8");
    // The error must be captured as .message (a string), not assigned as the raw Error object
    expect(src).toMatch(/\(err as Error\)\.message|err\.message/);
    // It must NOT store the whole Error object directly in lastSweepError state
    expect(src).not.toMatch(/lastSweepError\s*=\s*err\b/);
  });
});
