import { describe, it, expect } from "vitest";
import { GetPaperReportFoMonthlyResponse } from "@workspace/api-zod";
import { rowToDetail } from "./paperReportsFO";
import type { PaperTradeFoRow } from "@workspace/db";

// ---------------------------------------------------------------------------
// W5-P2 regression: the FO monthly report (PaperReportFoMonthly → trades[] →
// PaperTradeFODetail) previously rejected closed rows whose exitReason was
// "TIME_EXIT_1520" (the 15:20 IST force-exit), throwing a ZodError at the route
// boundary and surfacing as a 500 on GET /api/paper/reports/fo/monthly. These
// tests pin the contract + serializer behaviour so the enum cannot silently
// regress. TIME_EXIT_1520 must be carried through truthfully — never remapped
// onto another reason.
// ---------------------------------------------------------------------------

function makeClosedRow(over: Partial<PaperTradeFoRow> = {}): PaperTradeFoRow {
  // rowToDetail only reads the fields below; we build exactly those and cast.
  const base = {
    id: "trade-1",
    signalDate: "2026-05-08",
    indexSymbol: "NIFTY",
    indexName: "Nifty 50",
    setupKey: "BASELINE",
    direction: "BULLISH",
    optionType: "CALL",
    strike: "24000.0000",
    lots: 10,
    lotSize: 75,
    entryPremium: "100.0000",
    exitPremium: "120.0000",
    stopPremium: "90.0000",
    target1Premium: "130.0000",
    target2Premium: "150.0000",
    capitalDeployed: "75000.00",
    realizedPnl: "15000.00",
    status: "CLOSED",
    exitReason: "TIME_EXIT_1520",
    openedAt: new Date("2026-05-08T04:00:00.000Z"),
    exitedAt: new Date("2026-05-08T09:50:00.000Z"),
  };
  return { ...base, ...over } as unknown as PaperTradeFoRow;
}

describe("rowToDetail — TIME_EXIT_1520 closed F&O rows", () => {
  it("preserves the TIME_EXIT_1520 exit reason verbatim (no fabricated remap)", () => {
    const detail = rowToDetail(makeClosedRow());
    expect(detail.exitReason).toBe("TIME_EXIT_1520");
    // gross P&L (15000) minus charges; net must be below gross and finite.
    expect(detail.realizedPnl).toBe(15000);
    expect(Number.isFinite(detail.netPnl)).toBe(true);
    expect(detail.netPnl).toBeLessThan(detail.realizedPnl);
  });

  it("does not mutate the input row", () => {
    const input = makeClosedRow();
    const snapshot = JSON.stringify(input);
    rowToDetail(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("still serializes the legacy exit reasons unchanged", () => {
    for (const reason of [
      "TARGET1_HIT",
      "TARGET2_HIT",
      "STOPPED",
      "EXPIRED",
      "MANUAL_OVERRIDE",
    ] as const) {
      const detail = rowToDetail(makeClosedRow({ exitReason: reason }));
      expect(detail.exitReason).toBe(reason);
    }
  });
});

describe("GetPaperReportFoMonthlyResponse contract — exitReason enum", () => {
  function makeReport(exitReason: string) {
    return {
      month: "2026-05",
      from: "2026-05-01",
      to: "2026-05-31",
      totals: {
        realizedPnl: 15000,
        netPnl: 14900,
        charges: 100,
        tradeCount: 1,
        wins: 1,
        losses: 0,
        winRatePct: 100,
        avgWin: 14900,
        avgLoss: 0,
        bestTrade: 14900,
        worstTrade: 14900,
        avgRMultiple: 1.5,
        profitFactor: 0,
        expectancy: 14900,
      },
      days: [],
      trades: [{ ...rowToDetail(makeClosedRow()), exitReason }],
      generatedAt: new Date("2026-05-31T10:00:00.000Z").toISOString(),
    };
  }

  it("accepts a monthly report whose trade closed via TIME_EXIT_1520 (the exact W5-P2 regression)", () => {
    expect(() =>
      GetPaperReportFoMonthlyResponse.parse(makeReport("TIME_EXIT_1520")),
    ).not.toThrow();
    const parsed = GetPaperReportFoMonthlyResponse.parse(
      makeReport("TIME_EXIT_1520"),
    );
    expect(parsed.trades[0]?.exitReason).toBe("TIME_EXIT_1520");
  });

  it("still accepts every legacy exit reason", () => {
    for (const reason of [
      "TARGET1_HIT",
      "TARGET2_HIT",
      "STOPPED",
      "EXPIRED",
      "MANUAL_OVERRIDE",
    ]) {
      expect(() =>
        GetPaperReportFoMonthlyResponse.parse(makeReport(reason)),
      ).not.toThrow();
    }
  });

  it("keeps the enum strict — rejects an unknown exit reason", () => {
    expect(() =>
      GetPaperReportFoMonthlyResponse.parse(makeReport("NOT_A_REAL_REASON")),
    ).toThrow();
  });
});
