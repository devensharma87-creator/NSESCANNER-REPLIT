/**
 * BUG-73 regime hysteresis — the raw classifier is stateless and can
 * flip labels on a single borderline bar. `classifyRegimeWithHysteresis`
 * requires N=3 consecutive same reads before a NEW regime sticks;
 * EXPIRY_DAY (calendar-driven) bypasses hysteresis.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  classifyRegimeWithHysteresis,
  __resetRegimeHysteresisForTests,
  REGIME_HYSTERESIS_N,
  type RegimeContext,
} from "./regimeClassifier";

// A trending-bull-ish context (ADX ≥ 22 through EMA/VWAP stack) —
// drift is small enough to keep BB-width below the VOLATILE trip.
function trendingBullCtx(): RegimeContext {
  const closes: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  let px = 1000;
  for (let i = 0; i < 40; i++) {
    px += 0.3;
    closes.push(px);
    highs.push(px + 0.05);
    lows.push(px - 0.05);
  }
  return {
    bars: { h: highs, l: lows, c: closes },
    spot: closes[closes.length - 1] + 0.1,
    vwap: closes[closes.length - 1] - 3,
    ema9: closes[closes.length - 1] - 0.5,
    ema21: closes[closes.length - 1] - 2,
    atr15: 0.15, // tiny — atr%/spot below VOLATILE trip
    expiryWeekday: 4, // Thu — will not match "today" on most run dates
    expiryCadence: "monthly",
    // Force a Wednesday NOT-last-of-month so isExpiryToday is definitely false.
    now: new Date("2026-02-04T05:00:00Z"),
  };
}

// A ranging context — flat closes, ADX will read low.
function rangingCtx(): RegimeContext {
  const closes: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const px = 100;
  for (let i = 0; i < 40; i++) {
    // tiny up-and-down oscillation
    const delta = i % 2 === 0 ? 0.1 : -0.1;
    closes.push(px + delta);
    highs.push(px + delta + 0.05);
    lows.push(px + delta - 0.05);
  }
  return {
    bars: { h: highs, l: lows, c: closes },
    spot: closes[closes.length - 1],
    vwap: 100,
    ema9: 100,
    ema21: 100,
    atr15: 0.05, // tiny — atr%/spot below VOLATILE trip
    expiryWeekday: 4,
    expiryCadence: "monthly",
    now: new Date("2026-02-04T05:00:00Z"),
  };
}

describe("BUG-73 classifyRegimeWithHysteresis", () => {
  beforeEach(() => __resetRegimeHysteresisForTests());

  it("REGIME_HYSTERESIS_N defaults to 3", () => {
    expect(REGIME_HYSTERESIS_N).toBe(3);
  });

  it("first observation is returned as-is (no prior label to protect)", () => {
    const r = classifyRegimeWithHysteresis("NIFTY", trendingBullCtx());
    expect(r.regime).toBe("TRENDING_BULL");
  });

  it("single flip does NOT change the stable label (hysteresis kicks in)", () => {
    const bull = trendingBullCtx();
    const range = rangingCtx();

    const r1 = classifyRegimeWithHysteresis("NIFTY", bull); // primes -> TRENDING_BULL
    expect(r1.regime).toBe("TRENDING_BULL");

    const r2 = classifyRegimeWithHysteresis("NIFTY", range); // 1/3 pending
    expect(r2.regime).toBe("TRENDING_BULL");
    expect(r2.reason).toContain("hysteresis: pending RANGING (1/3)");
  });

  it("flip sticks only after N consecutive same-label reads", () => {
    classifyRegimeWithHysteresis("NIFTY", trendingBullCtx()); // prime -> TRENDING_BULL
    for (let i = 0; i < REGIME_HYSTERESIS_N - 1; i++) {
      const r = classifyRegimeWithHysteresis("NIFTY", rangingCtx());
      expect(r.regime).toBe("TRENDING_BULL"); // still pending
    }
    const rN = classifyRegimeWithHysteresis("NIFTY", rangingCtx());
    expect(rN.regime).toBe("RANGING"); // Nth confirmation flips
  });

  it("interrupted run resets pending counter", () => {
    classifyRegimeWithHysteresis("NIFTY", trendingBullCtx()); // prime
    classifyRegimeWithHysteresis("NIFTY", rangingCtx());     // 1/3 pending RANGING
    classifyRegimeWithHysteresis("NIFTY", trendingBullCtx()); // confirms stable
    const r = classifyRegimeWithHysteresis("NIFTY", rangingCtx());
    // Pending counter should be back to 1/3 after the confirming bar.
    expect(r.regime).toBe("TRENDING_BULL");
    expect(r.reason).toContain("(1/3)");
  });

  it("per-index isolation — NIFTY buffer does not affect BANKNIFTY", () => {
    classifyRegimeWithHysteresis("NIFTY", trendingBullCtx());
    // BANKNIFTY's first read of RANGING should return RANGING as its own
    // first observation, unaffected by NIFTY's TRENDING_BULL state.
    const r = classifyRegimeWithHysteresis("BANKNIFTY", rangingCtx());
    expect(r.regime).toBe("RANGING");
  });

  it("hysteresisN=1 disables hysteresis (immediate flip)", () => {
    classifyRegimeWithHysteresis("NIFTY", trendingBullCtx());
    const r = classifyRegimeWithHysteresis("NIFTY", rangingCtx(), { hysteresisN: 1 });
    expect(r.regime).toBe("RANGING");
  });
});
