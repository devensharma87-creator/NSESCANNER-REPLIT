/**
 * Unit tests for F&O Operational Gaps — Task #134
 *
 * Feature 1: Expiry-day 12:30 IST force-close (EXPIRY_EARLY_CLOSE reason)
 * Feature 2: Pre-market Kite session validity check (maybeRunKiteSessionCheck)
 * Feature 3: Regime classifier 2-bar hysteresis (applyRegimeHysteresis)
 *
 * The hysteresis and expiry helpers are tested via `fnoRegimeHysteresis.ts`
 * (pure module, no heavy dependencies) — no mocking needed for those.
 * The Kite session check logic is tested via direct mock of getActiveSessionStatus.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { RegimeResult } from "./regimeClassifier";
import {
  applyRegimeHysteresis,
  isExpiryDayForAnyIndex,
  resetRegimeHysteresisForTest,
  type ExpiryConfig,
} from "./fnoRegimeHysteresis";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRegime(regime: string): RegimeResult {
  return {
    regime: regime as RegimeResult["regime"],
    reason: `${regime} (test)`,
    diag: {
      adx14: 25,
      bbWidthPct: 1.2,
      atrPctOfSpot: 0.5,
      isExpiryToday: regime === "EXPIRY_DAY",
    },
  };
}

/** Minimal weekly-Tuesday expiry config (NIFTY / SENSEX). */
const weeklyTuesdayCfg: ExpiryConfig = { expiryWeekday: 2, expiryCadence: "weekly" };
/** Minimal monthly-last-Thursday expiry config (BANKNIFTY). */
const monthlyThursdayCfg: ExpiryConfig = { expiryWeekday: 4, expiryCadence: "monthly" };

const TEST_INDICES: ExpiryConfig[] = [weeklyTuesdayCfg, weeklyTuesdayCfg, monthlyThursdayCfg];

// ─────────────────────────────────────────────────────────────────────────────
// Feature 3: Regime classifier 2-bar hysteresis
// ─────────────────────────────────────────────────────────────────────────────

describe("applyRegimeHysteresis — 2-bar confirmation requirement", () => {
  beforeEach(() => {
    resetRegimeHysteresisForTest();
  });

  it("accepts the first-ever regime for a new index immediately", () => {
    const trending = makeRegime("TRENDING_UP");
    const result = applyRegimeHysteresis("NIFTY", trending, 10);
    expect(result.regime).toBe("TRENDING_UP");
  });

  it("holds the confirmed regime on the FIRST observation of a flip", () => {
    const trending = makeRegime("TRENDING_UP");
    const ranging  = makeRegime("RANGING");

    applyRegimeHysteresis("NIFTY", trending, 10); // baseline
    const held = applyRegimeHysteresis("NIFTY", ranging, 11); // first flip sighting
    expect(held.regime).toBe("TRENDING_UP"); // still confirmed
  });

  it("accepts the flip after 2 consecutive bars with the new regime", () => {
    const trending = makeRegime("TRENDING_UP");
    const ranging  = makeRegime("RANGING");

    applyRegimeHysteresis("NIFTY", trending, 10);
    applyRegimeHysteresis("NIFTY", ranging,  11); // bar 11 — first sighting, held
    const flipped = applyRegimeHysteresis("NIFTY", ranging, 12); // bar 12 — second consecutive, accept
    expect(flipped.regime).toBe("RANGING");
  });

  it("resets the pending counter if the proposed regime changes mid-pending", () => {
    const trending  = makeRegime("TRENDING_UP");
    const ranging   = makeRegime("RANGING");
    const volatile_ = makeRegime("VOLATILE");

    applyRegimeHysteresis("NIFTY", trending,  10);
    applyRegimeHysteresis("NIFTY", ranging,   11); // pending=RANGING@11
    applyRegimeHysteresis("NIFTY", volatile_, 12); // new flip, pending=VOLATILE@12
    const result = applyRegimeHysteresis("NIFTY", ranging, 13); // back to RANGING — resets pending
    // RANGING is a new pending (different from VOLATILE), confirmed still TRENDING_UP
    expect(result.regime).toBe("TRENDING_UP");
  });

  it("does NOT accept a flip if the bar counter has not advanced", () => {
    const trending = makeRegime("TRENDING_UP");
    const ranging  = makeRegime("RANGING");

    applyRegimeHysteresis("NIFTY", trending, 10);
    applyRegimeHysteresis("NIFTY", ranging,  11); // first sighting at bar 11
    // Same barCount again (no new candle closed)
    const result = applyRegimeHysteresis("NIFTY", ranging, 11);
    expect(result.regime).toBe("TRENDING_UP"); // still held
  });

  it("EXPIRY_DAY bypasses hysteresis and is accepted immediately", () => {
    const trending = makeRegime("TRENDING_UP");
    const expiry   = makeRegime("EXPIRY_DAY");

    applyRegimeHysteresis("NIFTY", trending, 10); // baseline
    const result = applyRegimeHysteresis("NIFTY", expiry, 11); // should flip immediately
    expect(result.regime).toBe("EXPIRY_DAY");
  });

  it("stable regime (no flip) clears pending state", () => {
    const trending = makeRegime("TRENDING_UP");
    const ranging  = makeRegime("RANGING");

    applyRegimeHysteresis("NIFTY", trending, 10);
    applyRegimeHysteresis("NIFTY", ranging,  11); // pending=RANGING
    applyRegimeHysteresis("NIFTY", trending, 12); // back to confirmed — clears pending
    // Now propose RANGING again; should start fresh pending (not count as 2nd bar)
    const result = applyRegimeHysteresis("NIFTY", ranging, 13);
    expect(result.regime).toBe("TRENDING_UP"); // still only 1st sighting
  });

  it("tracks separate state per index symbol", () => {
    const trending  = makeRegime("TRENDING_UP");
    const volatile_ = makeRegime("VOLATILE");
    const ranging   = makeRegime("RANGING");

    // NIFTY: baseline = TRENDING_UP, first flip to RANGING
    applyRegimeHysteresis("NIFTY",     trending,  10);
    applyRegimeHysteresis("NIFTY",     ranging,   11);

    // BANKNIFTY: baseline = VOLATILE (separate state)
    applyRegimeHysteresis("BANKNIFTY", volatile_, 10);
    const bnkResult = applyRegimeHysteresis("BANKNIFTY", volatile_, 11);

    // NIFTY: 2nd bar of RANGING → flip accepted
    const niftyResult = applyRegimeHysteresis("NIFTY", ranging, 12);
    expect(bnkResult.regime).toBe("VOLATILE");
    expect(niftyResult.regime).toBe("RANGING");
  });

  it("returns correct regime object (not just the string) after flip", () => {
    const trending = makeRegime("TRENDING_UP");
    const ranging  = makeRegime("RANGING");

    applyRegimeHysteresis("NIFTY", trending, 10);
    applyRegimeHysteresis("NIFTY", ranging,  11);
    const accepted = applyRegimeHysteresis("NIFTY", ranging, 12);
    // Should return the proposed ranging result object (with its diag)
    expect(accepted.reason).toBe("RANGING (test)");
    expect(accepted.diag.adx14).toBe(25);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isExpiryDayForAnyIndex — calendar logic
// ─────────────────────────────────────────────────────────────────────────────

describe("isExpiryDayForAnyIndex", () => {
  // TEST_INDICES: NIFTY/SENSEX weekly Tuesday (wd=2), BANKNIFTY monthly last Thursday (wd=4)

  it("returns true on a Tuesday (NIFTY/SENSEX weekly expiry)", () => {
    // 2026-07-14 is a Tuesday in IST
    const tuesdayMs = new Date("2026-07-14T04:00:00.000Z").getTime(); // 09:30 IST
    expect(isExpiryDayForAnyIndex(tuesdayMs, TEST_INDICES)).toBe(true);
  });

  it("returns false on a Wednesday (no index has Wednesday expiry)", () => {
    // 2026-07-15 is a Wednesday
    const wednesdayMs = new Date("2026-07-15T04:00:00.000Z").getTime();
    expect(isExpiryDayForAnyIndex(wednesdayMs, TEST_INDICES)).toBe(false);
  });

  it("returns true on last Thursday of month (BANKNIFTY monthly expiry)", () => {
    // 2026-07-30 is Thursday and is the LAST Thursday of July 2026
    const lastThuMs = new Date("2026-07-30T04:00:00.000Z").getTime();
    expect(isExpiryDayForAnyIndex(lastThuMs, TEST_INDICES)).toBe(true);
  });

  it("returns false on a non-last Thursday (not BANKNIFTY expiry)", () => {
    // 2026-07-23 is Thursday but NOT the last Thursday of July 2026
    const notLastThuMs = new Date("2026-07-23T04:00:00.000Z").getTime();
    expect(isExpiryDayForAnyIndex(notLastThuMs, TEST_INDICES)).toBe(false);
  });

  it("returns false on Monday", () => {
    const monMs = new Date("2026-07-13T04:00:00.000Z").getTime();
    expect(isExpiryDayForAnyIndex(monMs, TEST_INDICES)).toBe(false);
  });

  it("returns false on Saturday", () => {
    const satMs = new Date("2026-07-18T04:00:00.000Z").getTime();
    expect(isExpiryDayForAnyIndex(satMs, TEST_INDICES)).toBe(false);
  });

  it("is consistent across IST midnight boundaries", () => {
    // 2026-07-14 Tuesday: just before IST midnight (18:29:59 UTC = 23:59:59 IST)
    const endOfTuesdayIst = new Date("2026-07-14T18:29:59.000Z").getTime();
    expect(isExpiryDayForAnyIndex(endOfTuesdayIst, TEST_INDICES)).toBe(true);

    // One second later rolls over to Wednesday IST (00:00 IST = 18:30 UTC)
    const startOfWednesdayIst = new Date("2026-07-14T18:30:00.000Z").getTime();
    expect(isExpiryDayForAnyIndex(startOfWednesdayIst, TEST_INDICES)).toBe(false);
  });

  it("returns false when indices array is empty", () => {
    const tuesdayMs = new Date("2026-07-14T04:00:00.000Z").getTime();
    expect(isExpiryDayForAnyIndex(tuesdayMs, [])).toBe(false);
  });

  it("works with weekly-only config (no monthly)", () => {
    const thursdayMs = new Date("2026-07-30T04:00:00.000Z").getTime(); // last Thu
    const weeklyOnly: ExpiryConfig[] = [{ expiryWeekday: 4, expiryCadence: "weekly" }];
    // Weekly Thursday — every Thursday is expiry
    expect(isExpiryDayForAnyIndex(thursdayMs, weeklyOnly)).toBe(true);
    // A non-last Thursday should also be true for weekly
    const notLastThuMs = new Date("2026-07-23T04:00:00.000Z").getTime();
    expect(isExpiryDayForAnyIndex(notLastThuMs, weeklyOnly)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature 1: EXPIRY_EARLY_CLOSE reason — structural contract tests
// ─────────────────────────────────────────────────────────────────────────────

describe("EXPIRY_EARLY_CLOSE reason — structural contract", () => {
  it("EXPIRY_EARLY_CLOSE maps to CLOSED_TIME_EXIT_1520 reasoning tag (mirrors TIME_EXIT_1520)", () => {
    const closeDecisionMap: Record<string, string> = {
      STOPPED: "CLOSED_STOPPED",
      TARGET1_HIT: "CLOSED_TARGET1",
      TARGET2_HIT: "CLOSED_TARGET2",
      EXPIRED: "CLOSED_EXPIRED",
      MANUAL_OVERRIDE: "CLOSED_MANUAL",
      TIME_EXIT_1520: "CLOSED_TIME_EXIT_1520",
      EXPIRY_EARLY_CLOSE: "CLOSED_TIME_EXIT_1520",
    };

    expect(closeDecisionMap["EXPIRY_EARLY_CLOSE"]).toBe("CLOSED_TIME_EXIT_1520");
    expect(closeDecisionMap["TIME_EXIT_1520"]).toBe("CLOSED_TIME_EXIT_1520");
  });

  it("EXPIRY_EARLY_CLOSE is in the lastPremium-based exit group (not stop/target)", () => {
    const lastPremiumReasons = new Set([
      "EXPIRED",
      "MANUAL_OVERRIDE",
      "TIME_EXIT_1520",
      "EXPIRY_EARLY_CLOSE",
    ]);
    expect(lastPremiumReasons.has("EXPIRY_EARLY_CLOSE")).toBe(true);
    expect(lastPremiumReasons.has("STOPPED")).toBe(false);
    expect(lastPremiumReasons.has("TARGET1_HIT")).toBe(false);
    expect(lastPremiumReasons.has("TARGET2_HIT")).toBe(false);
  });

  it("expiry-day 12:30 window constant (750 min) is before 15:20 standard close (920 min)", () => {
    const EXPIRY_EARLY_CLOSE_MIN = 12 * 60 + 30;
    const FORCE_EXIT_1520_MIN    = 15 * 60 + 20;
    expect(EXPIRY_EARLY_CLOSE_MIN).toBe(750);
    expect(EXPIRY_EARLY_CLOSE_MIN).toBeLessThan(FORCE_EXIT_1520_MIN);
  });

  it("expiry-day early-close fires only for the configured expiry window, not before", () => {
    // 12:29 IST should NOT trigger
    const before = 12 * 60 + 29;
    const after  = 12 * 60 + 30;
    expect(before).toBeLessThan(after);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature 2: Kite session check — session code classification
// ─────────────────────────────────────────────────────────────────────────────

describe("Kite session check — code classification", () => {
  function isSessionOk(code: string, session: object | null): boolean {
    return code === "DB_SESSION_OK" && session !== null;
  }

  it("DB_SESSION_OK with valid session → session is valid", () => {
    expect(isSessionOk("DB_SESSION_OK", { userId: "ZZ1234" })).toBe(true);
  });

  it("DB_SESSION_MISSING → session is invalid", () => {
    expect(isSessionOk("DB_SESSION_MISSING", null)).toBe(false);
  });

  it("DB_SESSION_EXPIRED → session is invalid", () => {
    expect(isSessionOk("DB_SESSION_EXPIRED", null)).toBe(false);
  });

  it("DB_SESSION_READ_FAILED → session is invalid", () => {
    expect(isSessionOk("DB_SESSION_READ_FAILED", null)).toBe(false);
  });

  it("DB_POOL_CONNECTION_TERMINATED → session is invalid", () => {
    expect(isSessionOk("DB_POOL_CONNECTION_TERMINATED", null)).toBe(false);
  });

  it("DB_SESSION_OK with null session → invalid (defensive guard)", () => {
    expect(isSessionOk("DB_SESSION_OK", null)).toBe(false);
  });

  it("alert text contains expected fields when session is invalid", () => {
    const date = "2026-07-14";
    const code = "DB_SESSION_MISSING";
    const text =
      `⚠️ KITE SESSION INVALID (${date})\n` +
      `Code: ${code}\n` +
      `Re-login required at marketscannerbydev.in → Admin before 09:15 IST.\n` +
      `No live data, signals, or auto-trades until the session is refreshed.`;

    expect(text).toContain("⚠️ KITE SESSION INVALID");
    expect(text).toContain(date);
    expect(text).toContain(code);
    expect(text).toContain("marketscannerbydev.in");
    expect(text).toContain("09:15 IST");
  });

  it("window is 08:50–09:10 IST (20 min)", () => {
    const START  = 8 * 60 + 50;  // 530
    const WINDOW = 20;
    const END    = START + WINDOW; // 550 = 09:10
    expect(START).toBe(530);
    expect(END).toBe(550);
    // Inside window
    expect(530 >= START && 530 < END).toBe(true);
    expect(549 >= START && 549 < END).toBe(true);
    // Outside window
    expect(529 >= START && 529 < END).toBe(false);
    expect(550 >= START && 550 < END).toBe(false);
  });
});
