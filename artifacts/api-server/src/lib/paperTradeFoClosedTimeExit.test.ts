import { describe, it, expect } from "vitest";
import {
  GetPaperTradesFOResponse,
  ClosePaperPositionFOResponse,
} from "@workspace/api-zod";

// ---------------------------------------------------------------------------
// W5-P3 regression: the LIVE closed F&O paper-trade contract path
// (PaperTradeFOClosed) previously omitted "TIME_EXIT_1520" (the 15:20 IST
// force-exit) from its exitReason enum. The backend validates both responses
// with the generated zod schemas:
//   - GET  /paper/positions/fo            -> GetPaperTradesFOResponse.parse(...)
//   - POST /paper/positions/fo/:id/close  -> ClosePaperPositionFOResponse.parse(...)
// so a closed row carrying TIME_EXIT_1520 would throw a ZodError -> 500 on
// either path. These tests pin the corrected contract. TIME_EXIT_1520 must be
// accepted verbatim (never remapped), legacy reasons must still pass, and the
// enum must stay strict (unknown reasons rejected).
// ---------------------------------------------------------------------------

function makeClosedTrade(exitReason: string) {
  return {
    id: "trade-1",
    signalDate: "2026-05-08",
    indexSymbol: "NIFTY",
    indexName: "Nifty 50",
    setupKey: "BASELINE",
    direction: "BULLISH",
    optionType: "CALL",
    strike: 24000,
    lots: 10,
    lotSize: 75,
    entryPremium: 100,
    exitPremium: 120,
    capitalDeployed: 75000,
    realizedPnl: 15000,
    exitReason,
    openedAt: new Date("2026-05-08T04:00:00.000Z").toISOString(),
    exitedAt: new Date("2026-05-08T09:50:00.000Z").toISOString(),
    journal: null,
    tags: null,
  };
}

function makeTradesResponse(exitReason: string) {
  return {
    date: "2026-05-08",
    trades: [makeClosedTrade(exitReason)],
    generatedAt: new Date("2026-05-31T10:00:00.000Z").toISOString(),
  };
}

const LEGACY_REASONS = [
  "TARGET1_HIT",
  "TARGET2_HIT",
  "STOPPED",
  "EXPIRED",
  "MANUAL_OVERRIDE",
] as const;

describe("GetPaperTradesFOResponse contract — closed-trades exitReason enum", () => {
  it("accepts a closed-trades list whose trade exited via TIME_EXIT_1520 (the W5-P3 regression)", () => {
    expect(() =>
      GetPaperTradesFOResponse.parse(makeTradesResponse("TIME_EXIT_1520")),
    ).not.toThrow();
    const parsed = GetPaperTradesFOResponse.parse(
      makeTradesResponse("TIME_EXIT_1520"),
    );
    expect(parsed.trades[0]?.exitReason).toBe("TIME_EXIT_1520");
  });

  it("still accepts every legacy exit reason", () => {
    for (const reason of LEGACY_REASONS) {
      expect(() =>
        GetPaperTradesFOResponse.parse(makeTradesResponse(reason)),
      ).not.toThrow();
    }
  });

  it("keeps the enum strict — rejects an unknown exit reason", () => {
    expect(() =>
      GetPaperTradesFOResponse.parse(makeTradesResponse("NOT_A_REAL_REASON")),
    ).toThrow();
  });
});

describe("ClosePaperPositionFOResponse contract — close-position exitReason enum", () => {
  it("accepts a close-position response with TIME_EXIT_1520", () => {
    expect(() =>
      ClosePaperPositionFOResponse.parse(makeClosedTrade("TIME_EXIT_1520")),
    ).not.toThrow();
    const parsed = ClosePaperPositionFOResponse.parse(
      makeClosedTrade("TIME_EXIT_1520"),
    );
    expect(parsed.exitReason).toBe("TIME_EXIT_1520");
  });

  it("still accepts every legacy exit reason", () => {
    for (const reason of LEGACY_REASONS) {
      expect(() =>
        ClosePaperPositionFOResponse.parse(makeClosedTrade(reason)),
      ).not.toThrow();
    }
  });

  it("keeps the enum strict — rejects an unknown exit reason", () => {
    expect(() =>
      ClosePaperPositionFOResponse.parse(makeClosedTrade("NOT_A_REAL_REASON")),
    ).toThrow();
  });
});
