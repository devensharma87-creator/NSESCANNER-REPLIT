/**
 * P0 Phase A — durable charges identity test.
 *
 * Locks in the invariant that the writer stamps the identity
 * `net_pnl = gross_pnl − charges_total` on every close path and that
 * `charges_status = 'CURRENT'` when durable, or `'LEGACY_NOT_STORED'`
 * when a row was rendered without stamped columns.
 *
 * The identity is checked at the reporting layer (`rowToDetail`
 * in `paperReportsFO.ts` / `paperReportsEq.ts`) — this is the
 * layer that both the API and the reconciliation snapshot consume,
 * so if the identity is preserved here it is preserved everywhere
 * downstream.
 *
 * These are pure fixture tests — no DB. Fixture rows shaped as
 * `PaperTradeFoRow` / `PaperTradeEqRow` are handed to `rowToDetail`
 * and the returned shape's identity is asserted.
 */
import { describe, it, expect } from "vitest";
import { rowToDetail as rowToDetailFo } from "./paperReportsFO";
import { rowToDetail as rowToDetailEq } from "./paperReportsEq";
import type { PaperTradeFoRow, PaperTradeEqRow } from "@workspace/db";

function makeFoCurrentRow(overrides: Partial<PaperTradeFoRow> = {}): PaperTradeFoRow {
  const now = new Date();
  const base = {
    id: "row-fo-current",
    signalDate: "2026-07-14",
    indexSymbol: "NIFTY",
    indexName: "NIFTY 50",
    setupKey: "trend_continuation",
    direction: "BULLISH",
    optionType: "CALL",
    strike: "24500" as unknown as string,
    lots: 1,
    lotSize: 25,
    tier: "HC" as const,
    entryPremium: "100.00" as unknown as string,
    stopPremium: "80.00" as unknown as string,
    target1Premium: "120.00" as unknown as string,
    target2Premium: "150.00" as unknown as string,
    capitalDeployed: "2500.00" as unknown as string,
    openedAt: new Date(now.getTime() - 60 * 60 * 1000),
    lastPremium: "125.00" as unknown as string,
    lastEvaluatedAt: now,
    status: "CLOSED",
    exitedAt: now,
    exitPremium: "125.00" as unknown as string,
    exitReason: "TARGET2_HIT",
    realizedPnl: "625.00" as unknown as string,
    maxRunup: null,
    maxDrawdown: null,
    journal: null,
    tags: null,
    source: null,
    stagedOrderId: null,
    writerVersion: "paper-writer-v1.1.0-charges",
    // Durable charges columns — CURRENT stamped by the writer.
    grossPnl: "625.00" as unknown as string,
    chargesTotal: "50.25" as unknown as string,
    chargesBreakdownJson: {
      brokerage: 40,
      stt: 4.6875,
      transactionCharges: 0.9,
      sebiCharges: 0.05,
      gst: 7.3,
      stampDuty: 0.075,
      spreadCost: 0,
      slippageCost: 0,
      total: 50.25,
      costModelSource: "fnoCostModel/computeFnoTradeCost",
      costModelAsOf: "2026-04-01",
    },
    chargesModelVersion: "FNO_V1_2026Q1",
    chargesCalculatedAt: now,
    netPnl: "574.75" as unknown as string,
    chargesStatus: "CURRENT",
    // Contract cols (nullable — not exercised here).
    contractSymbol: null,
    contractExpiry: null,
    contractLotSize: null,
    lotSizeSource: null,
    contractInstrumentToken: null,
    contractGrade: null,
    contractFallbackReason: null,
  } as unknown as PaperTradeFoRow;
  return { ...base, ...overrides };
}

function makeFoLegacyRow(): PaperTradeFoRow {
  return makeFoCurrentRow({
    // Legacy row → writer_version null AND charges columns null.
    writerVersion: null,
    grossPnl: null,
    chargesTotal: null,
    chargesBreakdownJson: null,
    chargesModelVersion: null,
    chargesCalculatedAt: null,
    netPnl: null,
    chargesStatus: null,
  } as unknown as Partial<PaperTradeFoRow>);
}

function makeEqCurrentRow(): PaperTradeEqRow {
  const now = new Date();
  const base = {
    id: "row-eq-current",
    signalDate: "2026-07-14",
    symbol: "RELIANCE",
    name: "Reliance Industries",
    exchange: "NSE",
    qty: 10,
    entryPrice: "2500.00" as unknown as string,
    stopPrice: "2400.00" as unknown as string,
    target1Price: "2600.00" as unknown as string,
    target2Price: "2700.00" as unknown as string,
    capitalDeployed: "25000.00" as unknown as string,
    openedAt: new Date(now.getTime() - 6 * 60 * 60 * 1000),
    lastPrice: "2650.00" as unknown as string,
    lastEvaluatedAt: now,
    status: "CLOSED",
    exitedAt: now,
    exitPrice: "2650.00" as unknown as string,
    exitReason: "TARGET2_HIT",
    realizedPnl: "1500.00" as unknown as string,
    trailedToT1: 0,
    journal: null,
    tags: null,
    source: "AUTO",
    stagedOrderId: null,
    writerVersion: "paper-writer-v1.1.0-charges",
    grossPnl: "1500.00" as unknown as string,
    chargesTotal: "72.00" as unknown as string,
    chargesBreakdownJson: {
      brokerage: 0,
      stt: 51.5,
      transactionCharges: 1.5,
      sebiCharges: 0.05,
      gst: 0.28,
      stampDuty: 3.75,
      dpCharges: 15.93,
      total: 72.00,
    },
    chargesModelVersion: "EQ_CNC_V1_2026Q1",
    chargesCalculatedAt: now,
    netPnl: "1428.00" as unknown as string,
    chargesStatus: "CURRENT",
  } as unknown as PaperTradeEqRow;
  return base;
}

describe("P0 Phase A — durable-charges identity", () => {
  it("FO CURRENT: gross - charges = net (exact via stored DB values)", () => {
    const detail = rowToDetailFo(makeFoCurrentRow());
    expect(detail.chargesStatus).toBe("CURRENT");
    expect(detail.realizedPnl).toBe(625);
    expect(detail.charges).toBe(50.25);
    expect(detail.netPnl).toBe(574.75);
    // Identity holds exactly since values come from the writer.
    expect(
      Number((detail.realizedPnl - detail.charges).toFixed(2)),
    ).toBe(detail.netPnl);
  });

  it("FO LEGACY: chargesStatus='LEGACY_NOT_STORED', identity still holds via recompute", () => {
    const detail = rowToDetailFo(makeFoLegacyRow());
    expect(detail.chargesStatus).toBe("LEGACY_NOT_STORED");
    // Recomputed on read — both non-null, identity still holds.
    expect(Number.isFinite(detail.charges)).toBe(true);
    expect(Number.isFinite(detail.netPnl)).toBe(true);
    expect(
      Number((detail.realizedPnl - detail.charges).toFixed(2)),
    ).toBe(Number(detail.netPnl.toFixed(2)));
  });

  it("EQ CURRENT: gross - charges = net (exact via stored DB values)", () => {
    const detail = rowToDetailEq(makeEqCurrentRow());
    expect(detail.chargesStatus).toBe("CURRENT");
    expect(detail.realizedPnl).toBe(1500);
    expect(detail.charges).toBe(72);
    expect(detail.netPnl).toBe(1428);
    expect(
      Number((detail.realizedPnl - detail.charges).toFixed(2)),
    ).toBe(detail.netPnl);
  });

  it("EQ LEGACY: chargesStatus='LEGACY_NOT_STORED', identity still holds via recompute", () => {
    // Legacy = same row but charges cols null.
    const base = makeEqCurrentRow();
    const legacy = {
      ...base,
      chargesStatus: null,
      chargesTotal: null,
      netPnl: null,
    } as unknown as PaperTradeEqRow;
    const detail = rowToDetailEq(legacy);
    expect(detail.chargesStatus).toBe("LEGACY_NOT_STORED");
    expect(
      Number((detail.realizedPnl - detail.charges).toFixed(2)),
    ).toBe(Number(detail.netPnl.toFixed(2)));
  });
});
