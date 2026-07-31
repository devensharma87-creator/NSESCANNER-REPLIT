/**
 * B.1/B.2 — pure shape/behaviour checks for reconcilePaperAccount that
 * don't require a running DB. Failure paths return a well-formed snapshot
 * with `reconciled=false` and an explanatory note; happy paths are
 * exercised by the integration test that hits the actual `paper_account`
 * / `paper_trade_fo` tables (kept separate to preserve CI speed).
 */
/**
 * vi.mock guard (P0.1B tripwire): reconcilePaperAccount calls db.execute() in
 * multiple try/catch blocks and returns a well-formed fallback when every query
 * fails. Mock @workspace/db so no real pg.Pool connections are attempted — the
 * test verifies the fallback shape, NOT live DB behavior.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {
    execute: vi.fn().mockRejectedValue(new Error("DB mock — no real DB in unit tests")),
    select: vi.fn().mockReturnValue({ from: vi.fn().mockResolvedValue([]) }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockRejectedValue(new Error("DB mock")) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
  },
  // drizzle-orm re-exports from @workspace/db used by the module
  sql: Object.assign(
    (s: TemplateStringsArray, ...v: unknown[]) => ({ sql: String(s), values: v }),
    { raw: (s: string) => ({ sql: s, values: [] }) },
  ),
  kiteSessionTable: {},
}));

import { reconcilePaperAccount } from "./paperAccountReconciliation";

describe("B.1/B.2 reconcilePaperAccount — pure-shape checks", () => {
  it("returns a well-formed snapshot with numeric fields regardless of DB state", async () => {
    const out = await reconcilePaperAccount("FNO");
    expect(out.segment).toBe("FNO");
    // Every numeric field is finite (never NaN, never null).
    expect(Number.isFinite(out.seedCapital)).toBe(true);
    expect(Number.isFinite(out.actualBalance)).toBe(true);
    expect(Number.isFinite(out.driftAmount)).toBe(true);
    expect(Number.isFinite(out.expectedBalance)).toBe(true);
    // Notes is always an array.
    expect(Array.isArray(out.notes)).toBe(true);
    // istDate looks like YYYY-MM-DD.
    expect(out.istDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("accepts an explicit istDate override", async () => {
    const out = await reconcilePaperAccount("EQUITY", "2026-01-15");
    expect(out.istDate).toBe("2026-01-15");
    expect(out.segment).toBe("EQUITY");
  });

  it("returns a chargesEstimate block with schedule fingerprint (B.6/B.7)", async () => {
    const fno = await reconcilePaperAccount("FNO");
    expect(fno.chargesEstimate.estimated).toBe(true);
    expect(fno.chargesEstimate.schedule).toBe("FNO_V1_2026Q1");
    expect(Number.isFinite(fno.chargesEstimate.estimatedTotal)).toBe(true);
    expect(Number.isFinite(fno.grossRealizedPnl)).toBe(true);
    expect(Number.isFinite(fno.estimatedNetRealizedPnl)).toBe(true);

    const eq = await reconcilePaperAccount("EQUITY");
    expect(eq.chargesEstimate.schedule).toBe("EQ_CNC_V1_2026Q1");
  });
});
