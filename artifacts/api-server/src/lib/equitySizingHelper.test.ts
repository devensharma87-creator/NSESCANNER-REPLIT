/**
 * Tests for the equity sizing helper. Pure-function — no DB,
 * no env, no time-of-day dependencies. Cases mirror the gate
 * order in the live `openPaperEquityTrade` so any drift between
 * helper and live path will fail one of these.
 */
import { describe, it, expect } from "vitest";
import { computeEquitySizingPreview, type EquitySizingInput } from "./equitySizingHelper";

const FRESH_ACCOUNT: Omit<EquitySizingInput, "symbol" | "entry" | "stop"> = {
  balance: 1_000_000,
  bookValue: 0,
  openCount: 0,
  dayTradeCount: 0,
  currentHeat: 0,
};

describe("computeEquitySizingPreview — happy path", () => {
  it("normal mid-cap entry produces sensible qty and reports all working numbers", () => {
    const r = computeEquitySizingPreview({
      ...FRESH_ACCOUNT,
      symbol: "RELIANCE",
      entry: 2500,
      stop: 2400, // 4% — well within 1-8% band
    });
    expect(r.verdict).toBe("ACCEPT");
    expect(r.reason).toBeNull();
    // accountValue 10L / 4 slots = 2.5L per position; 2.5L / 2500 = 100 shares.
    expect(r.qty).toBe(100);
    expect(r.capitalRequired).toBe(250_000);
    expect(r.perShareRisk).toBe(100);
    expect(r.totalRisk).toBe(10_000);
    expect(r.riskPct).toBeCloseTo(0.01, 6); // 1% of seed
    expect(r.slots).toBe(4);
    expect(r.perPosition).toBe(250_000);
    expect(r.deploy).toBe(250_000);
    expect(r.newHeat).toBe(10_000);
    expect(r.heatCap).toBe(60_000); // 6% of 10L
    expect(r.limits.seedCapital).toBe(1_000_000);
  });

  it("includes book value of open positions in account value", () => {
    const r = computeEquitySizingPreview({
      ...FRESH_ACCOUNT,
      symbol: "TCS",
      entry: 4000,
      stop: 3850,
      balance: 750_000,    // already deployed 250k of 10L
      bookValue: 250_000,
      openCount: 1,
      currentHeat: 5_000,
    });
    expect(r.verdict).toBe("ACCEPT");
    // accountValue = 1_000_000; slots = max(4, 1+1) = 4; perPos = 250_000;
    // deploy = min(250_000, 750_000) = 250_000; qty = floor(250_000/4000) = 62
    expect(r.qty).toBe(62);
    expect(r.capitalRequired).toBe(248_000);
    expect(r.accountValue).toBe(1_000_000);
  });
});

describe("computeEquitySizingPreview — rejections", () => {
  it("INVALID_STOP when stop is non-finite", () => {
    const r = computeEquitySizingPreview({
      ...FRESH_ACCOUNT, symbol: "X", entry: 100, stop: NaN,
    });
    expect(r.verdict).toBe("REJECT");
    expect(r.reason).toBe("INVALID_STOP");
    expect(r.qty).toBe(0);
  });

  it("INVALID_STOP when stop >= entry", () => {
    const r = computeEquitySizingPreview({
      ...FRESH_ACCOUNT, symbol: "X", entry: 100, stop: 100,
    });
    expect(r.reason).toBe("INVALID_STOP");
  });

  it("INVALID_STOP when entry is zero or negative", () => {
    const r = computeEquitySizingPreview({
      ...FRESH_ACCOUNT, symbol: "X", entry: 0, stop: -10,
    });
    expect(r.reason).toBe("INVALID_STOP");
  });

  it("STOP_SANITY_TIGHT when stop < 1% from entry", () => {
    const r = computeEquitySizingPreview({
      ...FRESH_ACCOUNT, symbol: "X", entry: 1000, stop: 995, // 0.5%
    });
    expect(r.verdict).toBe("REJECT");
    expect(r.reason).toBe("STOP_SANITY_TIGHT");
    expect(r.detail).toMatch(/0\.50%/);
    expect(r.perShareRisk).toBe(5);
  });

  it("STOP_SANITY_WIDE when stop > 8% from entry", () => {
    const r = computeEquitySizingPreview({
      ...FRESH_ACCOUNT, symbol: "X", entry: 1000, stop: 900, // 10%
    });
    expect(r.reason).toBe("STOP_SANITY_WIDE");
    expect(r.perShareRisk).toBe(100);
  });

  it("STOP_SANITY accepts exactly 1% and exactly 8% (boundary inclusive)", () => {
    const lo = computeEquitySizingPreview({
      ...FRESH_ACCOUNT, symbol: "X", entry: 1000, stop: 990, // exactly 1%
    });
    const hi = computeEquitySizingPreview({
      ...FRESH_ACCOUNT, symbol: "X", entry: 1000, stop: 920, // exactly 8%
    });
    expect(lo.verdict).toBe("ACCEPT");
    expect(hi.verdict).toBe("ACCEPT");
  });

  it("DD_DAILY when daily drawdown latch is sticky", () => {
    const r = computeEquitySizingPreview({
      ...FRESH_ACCOUNT, symbol: "X", entry: 1000, stop: 970,
      ddDailyCapReached: true, ddDailyPct: 0.025,
    });
    expect(r.reason).toBe("DD_DAILY");
    expect(r.detail).toMatch(/2\.50%/);
  });

  it("DD_WEEKLY when weekly drawdown latch is sticky", () => {
    const r = computeEquitySizingPreview({
      ...FRESH_ACCOUNT, symbol: "X", entry: 1000, stop: 970,
      ddWeeklyCapReached: true, ddWeeklyPct: 0.045,
    });
    expect(r.reason).toBe("DD_WEEKLY");
  });

  it("DD_MONTHLY when monthly drawdown latch is sticky", () => {
    const r = computeEquitySizingPreview({
      ...FRESH_ACCOUNT, symbol: "X", entry: 1000, stop: 970,
      ddMonthlyCapReached: true, ddMonthlyPct: 0.085,
    });
    expect(r.reason).toBe("DD_MONTHLY");
  });

  it("DD gates fire BEFORE DAILY_CAP / CONCURRENT_CAP (live-path order)", () => {
    const r = computeEquitySizingPreview({
      ...FRESH_ACCOUNT, symbol: "X", entry: 1000, stop: 970,
      dayTradeCount: 3, openCount: 10,
      ddDailyCapReached: true,
    });
    expect(r.reason).toBe("DD_DAILY");
  });

  it("DAILY_CAP when 3 trades already opened today", () => {
    const r = computeEquitySizingPreview({
      ...FRESH_ACCOUNT, symbol: "X", entry: 1000, stop: 970, dayTradeCount: 3,
    });
    expect(r.reason).toBe("DAILY_CAP");
    expect(r.detail).toMatch(/3 ≥ 3/);
  });

  it("CONCURRENT_CAP when 10 positions already open", () => {
    const r = computeEquitySizingPreview({
      ...FRESH_ACCOUNT, symbol: "X", entry: 1000, stop: 970,
      openCount: 10, balance: 100_000, bookValue: 900_000,
    });
    expect(r.reason).toBe("CONCURRENT_CAP");
  });

  it("DEPLOY_LE_0 when balance is zero", () => {
    const r = computeEquitySizingPreview({
      ...FRESH_ACCOUNT, symbol: "X", entry: 1000, stop: 970,
      balance: 0, bookValue: 1_000_000, openCount: 4,
    });
    expect(r.reason).toBe("DEPLOY_LE_0");
  });

  it("QTY_LT_1 for high-priced stock with depleted account", () => {
    // Per-position = 100k / 4 = 25k. Entry 50k → floor(25k/50k) = 0.
    const r = computeEquitySizingPreview({
      ...FRESH_ACCOUNT, symbol: "MRF", entry: 150_000, stop: 145_000,
      balance: 100_000, bookValue: 0,
    });
    expect(r.reason).toBe("QTY_LT_1");
    expect(r.qty).toBe(0);
    expect(r.detail).toMatch(/Account depleted/);
  });

  it("QTY_LT_1 with helpful 'per-slot too small' message when account is healthy", () => {
    // Account fine (10L) but slots high (4) and stock is super-pricey:
    // perPosition = 250k, entry 300k → floor(250k/300k) = 0.
    const r = computeEquitySizingPreview({
      ...FRESH_ACCOUNT, symbol: "MRF", entry: 300_000, stop: 290_000,
    });
    expect(r.reason).toBe("QTY_LT_1");
    expect(r.detail).toMatch(/Per-slot allocation < 1 share/);
  });

  it("HEAT_CAP when projected heat would exceed 6% of seed", () => {
    // Set existing heat near cap (60k - so newHeat must stay < 0)
    // Entry 1000 stop 920 = 8% → perShare 80. qty 100 = 8000 newHeat.
    // currentHeat 55_000 + 8_000 = 63_000 > 60_000 cap.
    const r = computeEquitySizingPreview({
      ...FRESH_ACCOUNT, symbol: "X", entry: 1000, stop: 920, currentHeat: 55_000,
    });
    expect(r.reason).toBe("HEAT_CAP");
    // perPos = 1M/4 = 250k; deploy = 250k; qty = floor(250k/1000) = 250.
    // newHeat = 250 * 80 = 20_000; projected = 55_000 + 20_000 = 75_000 > 60_000.
    expect(r.qty).toBe(250);
    expect(r.projectedHeat).toBe(75_000);
  });

  it("INSUFF_BAL is a defensive gate — proven unreachable through the math", () => {
    // Mathematical invariant: deploy = min(perPosition, balance), then
    // qty = floor(deploy/entry). Therefore:
    //
    //   capitalRequired = qty * entry
    //                   = floor(deploy/entry) * entry
    //                   <= deploy
    //                   <= balance
    //
    // So `capitalRequired > balance` (the INSUFF_BAL trigger) cannot
    // fire from any non-pathological input. The gate is intentionally
    // preserved in both helper and live `openPaperEquityTrade` as
    // defence-in-depth (FP rounding paranoia + future code drift).
    //
    // We assert the invariant across a stress sweep of entry prices,
    // balances, book values and open counts — every ACCEPT result
    // must have capitalRequired <= balance. If a future change makes
    // INSUFF_BAL reachable, this sweep will surface it.
    const entries = [1, 17, 99, 100, 537.85, 1000, 2473, 9999, 50_000];
    const balances = [10, 1_000, 50_000, 250_000, 999_999, 1_000_000];
    const bookValues = [0, 100_000, 500_000, 990_000];
    let acceptCount = 0;
    for (const entry of entries) {
      for (const balance of balances) {
        for (const bookValue of bookValues) {
          for (const openCount of [0, 3, 7]) {
            const r = computeEquitySizingPreview({
              symbol: "X", entry, stop: entry * 0.96,
              balance, bookValue, openCount, dayTradeCount: 0, currentHeat: 0,
            });
            if (r.verdict === "ACCEPT") {
              acceptCount++;
              expect(r.capitalRequired).toBeLessThanOrEqual(balance);
            }
            // The reason we want to verify never appeared:
            expect(r.reason).not.toBe("INSUFF_BAL");
          }
        }
      }
    }
    expect(acceptCount).toBeGreaterThan(0); // sanity: sweep wasn't all rejects
  });
});

describe("computeEquitySizingPreview — rounding & sizing edge cases", () => {
  it("floors fractional shares (no fractional positions)", () => {
    // perPos=250k, entry=2473 → 250000/2473=101.09… → floor 101.
    const r = computeEquitySizingPreview({
      ...FRESH_ACCOUNT, symbol: "X", entry: 2473, stop: 2400,
    });
    expect(r.verdict).toBe("ACCEPT");
    expect(r.qty).toBe(101);
    expect(Number.isInteger(r.qty)).toBe(true);
  });

  it("scales perPosition down as more positions stack on top of base slots", () => {
    // openCount=5 → slots=max(4, 6)=6 → perPos=accountValue/6.
    const r = computeEquitySizingPreview({
      ...FRESH_ACCOUNT, symbol: "X", entry: 1000, stop: 970,
      openCount: 5, balance: 500_000, bookValue: 500_000,
    });
    expect(r.slots).toBe(6);
    expect(r.perPosition).toBeCloseTo(1_000_000 / 6, 2);
  });

  it("never returns negative or NaN qty / risk", () => {
    const r = computeEquitySizingPreview({
      ...FRESH_ACCOUNT, symbol: "X", entry: 100, stop: 99,
    });
    expect(r.qty).toBeGreaterThanOrEqual(0);
    expect(r.totalRisk).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(r.totalRisk)).toBe(true);
    expect(Number.isFinite(r.riskPct)).toBe(true);
  });

  it("limits block matches paperAccount constants (drift guard)", () => {
    const r = computeEquitySizingPreview({
      ...FRESH_ACCOUNT, symbol: "X", entry: 1000, stop: 970,
    });
    expect(r.limits).toEqual({
      seedCapital: 1_000_000,
      baseSlots: 4,
      maxConcurrent: 10,
      maxNewPerDay: 3,
      minStopPct: 0.01,
      maxStopPct: 0.08,
      maxEqHeatPct: 0.06,
    });
  });
});
