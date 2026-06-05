import { describe, it, expect } from "vitest";
import {
  buildReplayTrades,
  buildBlockedSetups,
  buildReplayDataQuality,
  type OshRow,
  type FsrAggRow,
} from "./replay";

const LOTS = { NIFTY: 75, BANKNIFTY: 30, SENSEX: 10 };

function osh(p: Partial<OshRow>): OshRow {
  return {
    signal_date: "2026-05-01",
    index_symbol: "NIFTY",
    setup_key: "EMA_PULLBACK",
    setup_name: "EMA Pullback",
    direction: "BULLISH",
    strike: 24000,
    option_type: "CALL",
    confidence: 65,
    tier: "HIGH_CONVICTION",
    generated_at: "2026-05-01T04:00:00Z",
    status: null,
    triggered_at: "2026-05-01T04:05:00Z",
    exited_at: "2026-05-01T05:00:00Z",
    exit_reason: null,
    last_spot: 24010,
    option_entry: 100,
    option_stop_loss: 70,
    option_target1: 160,
    option_target2: 220,
    max_favorable_excursion: null,
    max_adverse_excursion: null,
    ...p,
  };
}

describe("buildReplayTrades (Mode A)", () => {
  it("uses the REAL captured stop premium for a STOPPED outcome", () => {
    const [t] = buildReplayTrades([osh({ status: "STOPPED" })], { lots: 1, lotSizes: LOTS });
    expect(t!.optionExit).toBe(70);
    // (70 − 100) × 75 × 1
    expect(t!.pnl).toBe(-2250);
    expect(t!.exitReason).toBe("STOPPED");
    expect(t!.modeled).toBe(false);
  });

  it("uses the REAL captured target premium for a TARGET1_HIT outcome and scales by lots", () => {
    const [t] = buildReplayTrades([osh({ status: "TARGET1_HIT" })], { lots: 2, lotSizes: LOTS });
    // (160 − 100) × 75 × 2
    expect(t!.pnl).toBe(9000);
    expect(t!.lots).toBe(2);
    expect(t!.qty).toBe(150);
  });

  it("NEVER fabricates a P&L when the option exit was not captured (expired/stale)", () => {
    const [t] = buildReplayTrades(
      [osh({ status: "EXPIRED", exit_reason: "EXPIRED_TRIGGERED" })],
      { lots: 1, lotSizes: LOTS },
    );
    expect(t!.pnl).toBeNull();
    expect(t!.optionExit).toBeNull();
    expect(t!.exitReason).toBe("EXPIRED_TRIGGERED");
  });

  it("excludes signals that were never triggered (no trade taken)", () => {
    const trades = buildReplayTrades(
      [osh({ triggered_at: null, status: "EXPIRED_PENDING" })],
      { lots: 1, lotSizes: LOTS },
    );
    expect(trades).toHaveLength(0);
  });
});

describe("buildBlockedSetups", () => {
  it("maps aggregated rows and sorts by count desc", () => {
    const rows: FsrAggRow[] = [
      { index_symbol: "NIFTY", setup_key: "A", direction: "BULLISH", decision: "PRE_EMISSION_REJECTED", reason_code: "LOW_WINRATE", regime: "RANGING", confidence: 60, confluence_score: 3, cnt: 5 },
      { index_symbol: "NIFTY", setup_key: "B", direction: "BEARISH", decision: "MISSED_WINDOW", reason_code: null, regime: null, confidence: null, confluence_score: null, cnt: 12 },
    ];
    const out = buildBlockedSetups(rows);
    expect(out[0]!.count).toBe(12);
    expect(out[1]!.count).toBe(5);
    expect(out[1]!.reasonCode).toBe("LOW_WINRATE");
  });
});

describe("buildReplayDataQuality", () => {
  it("flags small samples and undecided/expired signals honestly", () => {
    const trades = buildReplayTrades(
      [osh({ status: "STOPPED" }), osh({ status: "EXPIRED", exit_reason: "STALE_TRIGGER" })],
      { lots: 1, lotSizes: LOTS },
    );
    const dq = buildReplayDataQuality({
      trades,
      takenCount: trades.length,
      ivCount: 0,
      oiAvailable: false,
      blockedCount: 0,
      snapshotCoverage: null,
      lots: 1,
    });
    expect(dq.mode).toBe("REAL_REPLAY");
    expect(dq.optionDataAvailable).toBe(true); // one decided
    expect(dq.ivAvailable).toBe(false);
    expect(dq.warnings.some((w) => /expired or went stale/.test(w))).toBe(true);
    expect(dq.modeledFields).toHaveLength(0); // nothing modeled in Mode A
  });

  it("reports option data unavailable when nothing was decided", () => {
    const dq = buildReplayDataQuality({
      trades: [],
      takenCount: 0,
      ivCount: 0,
      oiAvailable: false,
      blockedCount: 0,
      snapshotCoverage: null,
      lots: 1,
    });
    expect(dq.optionDataAvailable).toBe(false);
    expect(dq.warnings.some((w) => /still small/.test(w))).toBe(true);
  });
});
