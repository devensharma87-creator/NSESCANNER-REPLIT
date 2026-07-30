import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TransactionRollbackError } from "drizzle-orm/errors";
import type { PaperTradeFoRow } from "@workspace/db";
import { checkDbTestIsolation } from "../test-infra/dbTestGuard.js";

// ── dynamic module handles (loaded after isolation check) ──────────────────
let db: Awaited<typeof import("@workspace/db")>["db"];
let pool: Awaited<typeof import("@workspace/db")>["pool"];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let paperTradeFoTable: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let and: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let eq: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let runPremiumHardStopSweep: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let getPremiumOverlayHealth: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let __resetPremiumOverlayHealthForTests: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let PREMIUM_OVERLAY_FRESHNESS_WINDOW_MS: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ensureFoMarketShadowColumns: any;

let _loaded = false;
async function loadDbModules(): Promise<void> {
  if (_loaded) return;
  _loaded = true;
  checkDbTestIsolation();
  const [dbMod, ormMod, overlayMod, shadowMod] = await Promise.all([
    import("@workspace/db"),
    import("drizzle-orm"),
    import("./fnoPremiumExitOverlay.js"),
    import("./fnoMarketShadowCapture.js"),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _db = dbMod as any;
  db = _db.db;
  pool = _db.pool;
  paperTradeFoTable = _db.paperTradeFoTable;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _orm = ormMod as any;
  and = _orm.and;
  eq = _orm.eq;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _ov = overlayMod as any;
  runPremiumHardStopSweep = _ov.runPremiumHardStopSweep;
  getPremiumOverlayHealth = _ov.getPremiumOverlayHealth;
  __resetPremiumOverlayHealthForTests = _ov.__resetPremiumOverlayHealthForTests;
  PREMIUM_OVERLAY_FRESHNESS_WINDOW_MS = _ov.PREMIUM_OVERLAY_FRESHNESS_WINDOW_MS;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _sh = shadowMod as any;
  ensureFoMarketShadowColumns = _sh.ensureFoMarketShadowColumns;
}

function swallowIntentionalRollback(err: unknown): void {
  if (err instanceof TransactionRollbackError) return;
  throw err;
}

const TEST_DATE = "2099-12-30";
const NOW_MS = Date.UTC(2099, 11, 30, 6, 0, 0);

type SeedSpec = {
  indexSymbol?: string;
  setupKey?: string;
  direction?: "BULLISH" | "BEARISH";
  optionType?: "CE" | "PE";
  entryPremium: number;
  stopPremium: number;
  lastPremium: number;
  lastEvaluatedAt: Date;
  status?: "OPEN" | "CLOSED";
  tags?: string[] | null;
  journal?: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function seedPaper(tx: any, s: SeedSpec): Promise<string> {
  const inserted = await tx
    .insert(paperTradeFoTable)
    .values({
      signalDate: TEST_DATE,
      indexSymbol: s.indexSymbol ?? "NIFTY",
      setupKey: s.setupKey ?? "EMA_PULLBACK",
      direction: s.direction ?? "BULLISH",
      indexName: s.indexSymbol ?? "NIFTY",
      optionType: s.optionType ?? "CE",
      strike: "24000.0000",
      lots: 1,
      lotSize: 50,
      entryPremium: s.entryPremium.toFixed(4),
      stopPremium: s.stopPremium.toFixed(4),
      target1Premium: "130.0000",
      target2Premium: "160.0000",
      capitalDeployed: "5000.00",
      lastPremium: s.lastPremium.toFixed(4),
      lastEvaluatedAt: s.lastEvaluatedAt,
      status: s.status ?? "OPEN",
      tags: s.tags ?? null,
      journal: s.journal ?? null,
    })
    .returning({ id: paperTradeFoTable.id });
  return inserted[0]!.id;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeTxCloser(tx: any) {
  const calls: Array<{ direction: string; reason: string }> = [];
  const closer = async (
    signalDate: string,
    indexSymbol: string,
    setupKey: string,
    direction: "BULLISH" | "BEARISH",
    reason: string,
  ): Promise<PaperTradeFoRow | null> => {
    calls.push({ direction, reason });
    const updated = await tx
      .update(paperTradeFoTable)
      .set({ status: "CLOSED", exitedAt: new Date(), exitReason: reason })
      .where(
        and(
          eq(paperTradeFoTable.signalDate, signalDate),
          eq(paperTradeFoTable.indexSymbol, indexSymbol),
          eq(paperTradeFoTable.setupKey, setupKey),
          eq(paperTradeFoTable.direction, direction),
          eq(paperTradeFoTable.status, "OPEN"),
        ),
      )
      .returning();
    return (updated[0] as PaperTradeFoRow | undefined) ?? null;
  };
  return { closer, calls };
}

// ─────────────────────────────────────────────────────────────────────────
// Sweep — DB integration (rolled back)
// ─────────────────────────────────────────────────────────────────────────

describe("runPremiumHardStopSweep — DB integration (rolled back)", () => {
  beforeAll(async () => {
    await loadDbModules();
    await ensureFoMarketShadowColumns();
  });

  afterAll(async () => {
    if (pool) await pool.end().catch(() => {});
  });

  beforeEach(() => __resetPremiumOverlayHealthForTests());

  it("fresh CE long with premium below stop → STOPPED close + tags/journal", async () => {
    await db
      .transaction(async (tx: any) => {
        const id = await seedPaper(tx, {
          optionType: "CE",
          entryPremium: 100,
          stopPremium: 70,
          lastPremium: 65,
          lastEvaluatedAt: new Date(NOW_MS),
        });
        const { closer, calls } = makeTxCloser(tx);
        const stats = await runPremiumHardStopSweep(TEST_DATE, tx, closer, NOW_MS);

        expect(stats.considered).toBe(1);
        expect(stats.stopped).toBe(1);
        expect(stats.tagWriteFailures).toBe(0);
        expect(calls).toEqual([{ direction: "BULLISH", reason: "STOPPED" }]);
        expect(getPremiumOverlayHealth().stoppedTotal).toBe(1);

        const row = await tx
          .select()
          .from(paperTradeFoTable)
          .where(eq(paperTradeFoTable.id, id));
        expect(row[0]!.status).toBe("CLOSED");
        expect(row[0]!.exitReason).toBe("STOPPED");
        expect(row[0]!.tags).toEqual(
          expect.arrayContaining(["PREMIUM_STOP_HIT", "PREMIUM_BACKSTOP"]),
        );
        expect(row[0]!.journal).toContain("premium hard-stop backstop");

        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  it("fresh PE long with premium below stop → STOPPED close (long-side identical)", async () => {
    await db
      .transaction(async (tx: any) => {
        await seedPaper(tx, {
          setupKey: "VWAP_RECLAIM",
          direction: "BEARISH",
          optionType: "PE",
          entryPremium: 120,
          stopPremium: 84,
          lastPremium: 80,
          lastEvaluatedAt: new Date(NOW_MS),
        });
        const { closer, calls } = makeTxCloser(tx);
        const stats = await runPremiumHardStopSweep(TEST_DATE, tx, closer, NOW_MS);
        expect(stats.stopped).toBe(1);
        expect(calls).toEqual([{ direction: "BEARISH", reason: "STOPPED" }]);
        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  it("premium still above stop → no close", async () => {
    await db
      .transaction(async (tx: any) => {
        const id = await seedPaper(tx, {
          entryPremium: 100,
          stopPremium: 70,
          lastPremium: 85,
          lastEvaluatedAt: new Date(NOW_MS),
        });
        const { closer, calls } = makeTxCloser(tx);
        const stats = await runPremiumHardStopSweep(TEST_DATE, tx, closer, NOW_MS);
        expect(stats.stopped).toBe(0);
        expect(stats.skippedAboveStop).toBe(1);
        expect(calls.length).toBe(0);

        const row = await tx
          .select()
          .from(paperTradeFoTable)
          .where(eq(paperTradeFoTable.id, id));
        expect(row[0]!.status).toBe("OPEN");
        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  it("stale MTM with premium below stop → no close, wouldStopButStale counted", async () => {
    await db
      .transaction(async (tx: any) => {
        const id = await seedPaper(tx, {
          entryPremium: 100,
          stopPremium: 70,
          lastPremium: 60,
          lastEvaluatedAt: new Date(
            NOW_MS - PREMIUM_OVERLAY_FRESHNESS_WINDOW_MS - 60_000,
          ),
        });
        const { closer, calls } = makeTxCloser(tx);
        const stats = await runPremiumHardStopSweep(TEST_DATE, tx, closer, NOW_MS);
        expect(stats.stopped).toBe(0);
        expect(stats.skippedStaleMtm).toBe(1);
        expect(stats.wouldStopButStale).toBe(1);
        expect(calls.length).toBe(0);

        const row = await tx
          .select()
          .from(paperTradeFoTable)
          .where(eq(paperTradeFoTable.id, id));
        expect(row[0]!.status).toBe("OPEN");
        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  it("CLOSED rows are never considered", async () => {
    await db
      .transaction(async (tx: any) => {
        await seedPaper(tx, {
          entryPremium: 100,
          stopPremium: 70,
          lastPremium: 50,
          lastEvaluatedAt: new Date(NOW_MS),
          status: "CLOSED",
        });
        const { closer, calls } = makeTxCloser(tx);
        const stats = await runPremiumHardStopSweep(TEST_DATE, tx, closer, NOW_MS);
        expect(stats.considered).toBe(0);
        expect(stats.stopped).toBe(0);
        expect(calls.length).toBe(0);
        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  it("CAS race: closer returns null (already closed) → no double count, no tag write", async () => {
    await db
      .transaction(async (tx: any) => {
        await seedPaper(tx, {
          entryPremium: 100,
          stopPremium: 70,
          lastPremium: 60,
          lastEvaluatedAt: new Date(NOW_MS),
        });
        const calls: number[] = [];
        const nullCloser = async () => {
          calls.push(1);
          return null;
        };
        const stats = await runPremiumHardStopSweep(TEST_DATE, tx, nullCloser, NOW_MS);
        expect(calls.length).toBe(1);
        expect(stats.stopped).toBe(0);
        expect(stats.tagWriteFailures).toBe(0);
        expect(getPremiumOverlayHealth().stoppedTotal).toBe(0);
        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  it("appends to existing tags/journal without dropping them", async () => {
    await db
      .transaction(async (tx: any) => {
        const id = await seedPaper(tx, {
          entryPremium: 100,
          stopPremium: 70,
          lastPremium: 65,
          lastEvaluatedAt: new Date(NOW_MS),
          tags: ["HC"],
          journal: "opened high-conviction",
        });
        const { closer } = makeTxCloser(tx);
        await runPremiumHardStopSweep(TEST_DATE, tx, closer, NOW_MS);
        const row = await tx
          .select()
          .from(paperTradeFoTable)
          .where(eq(paperTradeFoTable.id, id));
        expect(row[0]!.tags).toEqual(
          expect.arrayContaining(["HC", "PREMIUM_STOP_HIT", "PREMIUM_BACKSTOP"]),
        );
        expect(row[0]!.journal).toContain("opened high-conviction");
        expect(row[0]!.journal).toContain("premium hard-stop backstop");
        tx.rollback();
      })
      .catch(swallowIntentionalRollback);
  });

  it("zero OPEN rows for an unused date → clean no-op", async () => {
    const stats = await runPremiumHardStopSweep("1999-01-01");
    expect(stats.considered).toBe(0);
    expect(stats.stopped).toBe(0);
    expect(stats.errors).toBe(0);
  });
});
