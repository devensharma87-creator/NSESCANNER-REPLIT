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

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// DB integration (skip when DATABASE_URL is absent) — MUST run before any
// vi.doMock call so it sees the real swingOrderStaging module.
// ---------------------------------------------------------------------------

const hasDb = !!process.env["DATABASE_URL"];

describe.skipIf(!hasDb)("DB integration", () => {
  const RUN_ID = `ttl-sweep-test-${Date.now()}`;

  // Captured once in beforeAll. No vi.doMock is registered at this point
  // because the DB block is placed first in the file.
  let db: Awaited<typeof import("@workspace/db")>["db"];
  let swingOrderStagingTable: Awaited<
    typeof import("@workspace/db/schema")
  >["swingOrderStagingTable"];
  let runSwingTtlSweepOnce: typeof import("./swingTtlSweep")["runSwingTtlSweepOnce"];
  let like: typeof import("drizzle-orm")["like"];

  beforeAll(async () => {
    const sweep = await import("./swingTtlSweep");
    await sweep.applySwingTtlSchemaColumns();
    runSwingTtlSweepOnce = sweep.runSwingTtlSweepOnce;

    const dbMod = await import("@workspace/db");
    db = dbMod.db;
    const schemaMod = await import("@workspace/db/schema");
    swingOrderStagingTable = schemaMod.swingOrderStagingTable;
    const orm = await import("drizzle-orm");
    like = orm.like;
  });

  afterAll(async () => {
    await db
      .delete(swingOrderStagingTable)
      .where(like(swingOrderStagingTable.ownerKey, `${RUN_ID}%`));
  });

  afterEach(async () => {
    await db
      .delete(swingOrderStagingTable)
      .where(like(swingOrderStagingTable.ownerKey, `${RUN_ID}%`));
  });

  it("runSwingTtlSweepOnce expires stale orders across all owners", async () => {
    const owner1 = `${RUN_ID}-owner1`;
    const owner2 = `${RUN_ID}-owner2`;
    const past = new Date(Date.now() - 9 * 60 * 60 * 1000);
    const now = new Date();

    const baseRow = {
      side: "BUY" as const,
      productType: "CNC",
      orderType: "LIMIT",
      entryPrice: 100,
      stopLoss: 95,
      target1: 110,
      quantity: 10,
      capitalRequired: 1000,
      maxRisk: 50,
      riskPercent: 5,
      dataSource: "test",
      candidateSnapshotJson: {} as Record<string, unknown>,
      riskDecisionJson: {} as Record<string, unknown>,
      executionMode: "paper_only" as const,
      brokerStatus: "BROKER_DISABLED" as const,
      manualReviewRequired: false,
      symbol: "TESTSWP",
      status: "STAGED" as const,
      approvalStatus: "PENDING" as const,
      expiresAt: past,
      createdAt: past,
      updatedAt: past,
    };

    await db.insert(swingOrderStagingTable).values([
      { ...baseRow, ownerKey: owner1 },
      { ...baseRow, ownerKey: owner2 },
    ]);

    const result = await runSwingTtlSweepOnce({ now });
    expect(result.expired).toBeGreaterThanOrEqual(2);
    expect(result.scanned).toBeGreaterThanOrEqual(2);

    const rows = await db
      .select()
      .from(swingOrderStagingTable)
      .where(like(swingOrderStagingTable.ownerKey, `${RUN_ID}%`));
    for (const r of rows) {
      expect(r.status).toBe("EXPIRED");
      expect(r.approvalStatus).toBe("EXPIRED");
      expect(r.expiryReason).toBe("TTL_EXPIRED");
    }
  });

  it("runSwingTtlSweepOnce is idempotent — second sweep finds 0 stale rows", async () => {
    const owner = `${RUN_ID}-idem`;
    const past = new Date(Date.now() - 9 * 60 * 60 * 1000);
    const now = new Date();

    await db.insert(swingOrderStagingTable).values({
      ownerKey: owner,
      side: "BUY" as const,
      productType: "CNC",
      orderType: "LIMIT",
      entryPrice: 200,
      stopLoss: 190,
      target1: 220,
      quantity: 5,
      capitalRequired: 1000,
      maxRisk: 50,
      riskPercent: 5,
      dataSource: "test",
      candidateSnapshotJson: {} as Record<string, unknown>,
      riskDecisionJson: {} as Record<string, unknown>,
      executionMode: "paper_only" as const,
      brokerStatus: "BROKER_DISABLED" as const,
      manualReviewRequired: false,
      symbol: "TESTSWP2",
      status: "STAGED" as const,
      approvalStatus: "PENDING" as const,
      expiresAt: past,
      createdAt: past,
      updatedAt: past,
    });

    const r1 = await runSwingTtlSweepOnce({ now });
    expect(r1.expired).toBeGreaterThanOrEqual(1);

    const r2 = await runSwingTtlSweepOnce({ now: new Date(now.getTime() + 1000) });
    expect(r2.expired).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Pure defaults (no DB, no mocks)
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
