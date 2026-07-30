import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { checkDbTestIsolation } from "../test-infra/dbTestGuard.js";

/**
 * Swing TTL Sweep Scheduler — DB integration tests.
 * Isolated from the normal suite via .db.test.ts taxonomy.
 * Guard: checkDbTestIsolation() in beforeAll ensures isolated test DB is used.
 */

describe("DB integration", () => {
  const RUN_ID = `ttl-sweep-test-${Date.now()}`;

  let db: Awaited<typeof import("@workspace/db")>["db"];
  let swingOrderStagingTable: Awaited<
    typeof import("@workspace/db/schema")
  >["swingOrderStagingTable"];
  let runSwingTtlSweepOnce: typeof import("./swingTtlSweep")["runSwingTtlSweepOnce"];
  let like: typeof import("drizzle-orm")["like"];

  beforeAll(async () => {
    checkDbTestIsolation();
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
