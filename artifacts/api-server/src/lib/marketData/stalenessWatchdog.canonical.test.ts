/**
 * Phase 0.5A follow-up: the staleness watchdog must nudge a resubscribe using
 * canonical NSE equity trading symbols, never the compatibility snapshot keys.
 *
 * Snapshot keys can be Yahoo index aliases ("^NSEI") or exchange-qualified
 * canonical ids ("BSE:EQUITY:RELIANCE") for symbols listed on both exchanges.
 * subscribe() resolves neither, so passing keys through would silently break
 * freshness recovery. Thresholds are untouched by this test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const subscribeMock = vi.fn(async (_symbols: string[]) => 0);
const quotesRef: { value: Record<string, unknown> } = { value: {} };

vi.mock("../kiteFeed", () => ({
  getAllLiveQuotes: () => quotesRef.value,
  subscribe: (syms: string[]) => subscribeMock(syms),
  feedStatus: () => ({ connected: true, running: true, subscribed: 4, liveQuotes: 4 }),
}));

vi.mock("../marketEvents", () => ({ computeMarketStatus: () => "open" }));
vi.mock("../alerting", () => ({ alertOwner: vi.fn() }));

const STALE_TS = 1_000_000;

function quote(over: Record<string, unknown>) {
  return {
    canonicalInstrumentId: "NSE:EQUITY:X",
    exchange: "NSE",
    segment: "EQUITY",
    tradingSymbol: "X",
    symbol: "X",
    instrumentToken: 1,
    provider: "KITE",
    ltp: 1,
    ts: STALE_TS,
    ...over,
  };
}

describe("stalenessWatchdog — canonical resubscribe keys", () => {
  beforeEach(() => {
    subscribeMock.mockClear();
    vi.resetModules();
  });

  it("nudges with NSE equity trading symbols and never with alias or canonical-id keys", async () => {
    quotesRef.value = {
      // Unambiguous NSE equity — key already equals the trading symbol.
      RELIANCE: quote({
        canonicalInstrumentId: "NSE:EQUITY:RELIANCE",
        tradingSymbol: "RELIANCE", symbol: "RELIANCE", instrumentToken: 738561,
      }),
      // Index, keyed by its Yahoo alias. subscribe() cannot resolve this.
      "^NSEI": quote({
        canonicalInstrumentId: "NSE:INDEX:NIFTY 50", segment: "INDEX",
        tradingSymbol: "NIFTY 50", symbol: "^NSEI", instrumentToken: 256265,
      }),
      // Cross-listed symbol, keyed by canonical id because it is ambiguous.
      "BSE:EQUITY:INFY": quote({
        canonicalInstrumentId: "BSE:EQUITY:INFY", exchange: "BSE",
        tradingSymbol: "INFY", symbol: "INFY", instrumentToken: 128053508,
      }),
      "NSE:EQUITY:INFY": quote({
        canonicalInstrumentId: "NSE:EQUITY:INFY",
        tradingSymbol: "INFY", symbol: "INFY", instrumentToken: 408065,
      }),
    };

    const { runStalenessCheck } = await import("./stalenessWatchdog");
    // Every quote is far older than the stale threshold.
    const snap = runStalenessCheck(new Date(STALE_TS + 60 * 60 * 1000));

    expect(snap.active).toBe(true);
    expect(snap.staleCount).toBe(4);
    expect(subscribeMock).toHaveBeenCalledTimes(1);

    const nudged = subscribeMock.mock.calls[0]![0];
    // Only resolvable NSE equity trading symbols.
    expect([...nudged].sort()).toEqual(["INFY", "RELIANCE"]);
    expect(nudged).not.toContain("^NSEI");
    expect(nudged.some(s => s.includes(":"))).toBe(false);
  });
});
