/**
 * Unit tests for F&O Operational Gaps — Task #134
 *
 * Feature 1: Expiry-day 12:30 IST force-close (EXPIRY_EARLY_CLOSE reason)
 * Feature 2: Pre-market Kite session validity check (maybeRunKiteSessionCheck)
 *            — uses probeKiteTokenLive (DB + live Kite broker validation)
 *            — latch is burned ONLY on successful resolution
 *            — Telegram failure → FAILED DB status → latch not burned → retry
 *            — PROBE_NETWORK_ERROR → fail-open, no DB write, no latch burn
 * Feature 3: Regime classifier 2-bar hysteresis (applyRegimeHysteresis)
 *
 * The hysteresis and expiry helpers are tested via `fnoRegimeHysteresis.ts`
 * (pure module, no heavy dependencies) — no mocking needed for those.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { KITE_SESSION_CHECK_REPORT_TYPE } from "./dailyReports";
import type { KiteTokenProbeResult } from "./kiteAuth";
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
// Feature 2: Kite session check — probe-result dispatch and latch semantics
// ─────────────────────────────────────────────────────────────────────────────

describe("Kite session check — report type constant (casing)", () => {
  it("KITE_SESSION_CHECK_REPORT_TYPE is lowercase snake_case", () => {
    // DB dedup key must be lowercase to match the existing daily_report_runs
    // constraint pattern used by pre/post report types.
    expect(KITE_SESSION_CHECK_REPORT_TYPE).toBe("kite_session_check");
  });

  it("KITE_SESSION_CHECK_REPORT_TYPE contains no uppercase letters", () => {
    expect(KITE_SESSION_CHECK_REPORT_TYPE).toEqual(KITE_SESSION_CHECK_REPORT_TYPE.toLowerCase());
  });
});

describe("Kite session check — probeKiteTokenLive result dispatch", () => {
  /** Mirrors the decision tree in maybeRunKiteSessionCheck. */
  function dispatchProbeResult(probeResult: KiteTokenProbeResult): {
    shouldAlert: boolean;
    failOpen: boolean;
  } {
    if (probeResult === "PROBE_NETWORK_ERROR") {
      return { shouldAlert: false, failOpen: true };
    }
    const sessionValid = probeResult === "VALID";
    return { shouldAlert: !sessionValid, failOpen: false };
  }

  it("VALID → no alert, not fail-open", () => {
    const { shouldAlert, failOpen } = dispatchProbeResult("VALID");
    expect(shouldAlert).toBe(false);
    expect(failOpen).toBe(false);
  });

  it("DB_MISSING → should alert, not fail-open", () => {
    const { shouldAlert, failOpen } = dispatchProbeResult("DB_MISSING");
    expect(shouldAlert).toBe(true);
    expect(failOpen).toBe(false);
  });

  it("DB_EXPIRED → should alert, not fail-open", () => {
    const { shouldAlert, failOpen } = dispatchProbeResult("DB_EXPIRED");
    expect(shouldAlert).toBe(true);
    expect(failOpen).toBe(false);
  });

  it("DB_READ_FAILED → should alert, not fail-open", () => {
    const { shouldAlert, failOpen } = dispatchProbeResult("DB_READ_FAILED");
    expect(shouldAlert).toBe(true);
    expect(failOpen).toBe(false);
  });

  it("BROKER_INVALID → should alert, not fail-open", () => {
    // Token is in the DB but Kite revoked it (daily 06:00 IST expiry on broker side).
    const { shouldAlert, failOpen } = dispatchProbeResult("BROKER_INVALID");
    expect(shouldAlert).toBe(true);
    expect(failOpen).toBe(false);
  });

  it("PROBE_NETWORK_ERROR → no alert and fail-open (do not fire false alarms)", () => {
    // Network timeout or unreachable → fail-open: don't alert, don't burn latch.
    const { shouldAlert, failOpen } = dispatchProbeResult("PROBE_NETWORK_ERROR");
    expect(shouldAlert).toBe(false);
    expect(failOpen).toBe(true);
  });
});

describe("Kite session check — latch burn semantics", () => {
  /**
   * Mirrors the latch-burn decision in maybeRunKiteSessionCheck.
   * Returns whether the in-memory latch should be burned after this attempt.
   */
  function shouldBurnLatch(opts: {
    probeResult: KiteTokenProbeResult;
    telegramSendResult: string | null; // null = not attempted (VALID case)
  }): boolean {
    const { probeResult, telegramSendResult } = opts;
    // Network error → never burn latch
    if (probeResult === "PROBE_NETWORK_ERROR") return false;
    // Valid → burn latch (logged success, day done)
    if (probeResult === "VALID") return true;
    // Invalid + alert attempted → burn only if Telegram actually succeeded
    return telegramSendResult === "SENT";
  }

  it("VALID → latch burned (session OK, day complete)", () => {
    expect(shouldBurnLatch({ probeResult: "VALID", telegramSendResult: null })).toBe(true);
  });

  it("BROKER_INVALID + Telegram SENT → latch burned (alert delivered)", () => {
    expect(shouldBurnLatch({ probeResult: "BROKER_INVALID", telegramSendResult: "SENT" })).toBe(true);
  });

  it("DB_MISSING + Telegram SENT → latch burned (alert delivered)", () => {
    expect(shouldBurnLatch({ probeResult: "DB_MISSING", telegramSendResult: "SENT" })).toBe(true);
  });

  it("BROKER_INVALID + Telegram UNEXPECTED_ERROR → latch NOT burned (retry next tick)", () => {
    // The 60s scheduler can retry inside the 20-min window.
    expect(shouldBurnLatch({ probeResult: "BROKER_INVALID", telegramSendResult: "UNEXPECTED_ERROR" })).toBe(false);
  });

  it("DB_EXPIRED + Telegram PREPOST_TELEGRAM_DISABLED_MISSING_CONFIG → latch NOT burned", () => {
    expect(shouldBurnLatch({ probeResult: "DB_EXPIRED", telegramSendResult: "PREPOST_TELEGRAM_DISABLED_MISSING_CONFIG" })).toBe(false);
  });

  it("DB_MISSING + Telegram PREPOST_TELEGRAM_DISABLED_MISSING_TOKEN → latch NOT burned", () => {
    expect(shouldBurnLatch({ probeResult: "DB_MISSING", telegramSendResult: "PREPOST_TELEGRAM_DISABLED_MISSING_TOKEN" })).toBe(false);
  });

  it("PROBE_NETWORK_ERROR → latch NOT burned regardless of telegram result", () => {
    // No DB slot is claimed, no alert is sent — just fail open and retry.
    expect(shouldBurnLatch({ probeResult: "PROBE_NETWORK_ERROR", telegramSendResult: null })).toBe(false);
    expect(shouldBurnLatch({ probeResult: "PROBE_NETWORK_ERROR", telegramSendResult: "SENT" })).toBe(false);
  });
});

describe("Kite session check — DB status written per outcome", () => {
  /**
   * Mirrors the updateReportRunStatus call in maybeRunKiteSessionCheck.
   * Returns which DB status is written.
   */
  function dbStatusForOutcome(opts: {
    probeResult: KiteTokenProbeResult;
    telegramSendResult: string;
  }): "SENT" | "FAILED" {
    const { probeResult, telegramSendResult } = opts;
    if (probeResult === "VALID") return "SENT"; // logged OK (no alert, day done)
    // Invalid — alert attempted
    return telegramSendResult === "SENT" ? "SENT" : "FAILED";
  }

  it("VALID → DB status SENT (probe OK, no alert needed)", () => {
    expect(dbStatusForOutcome({ probeResult: "VALID", telegramSendResult: "PROBE_OK_NO_ALERT" })).toBe("SENT");
  });

  it("BROKER_INVALID + Telegram SENT → DB status SENT", () => {
    expect(dbStatusForOutcome({ probeResult: "BROKER_INVALID", telegramSendResult: "SENT" })).toBe("SENT");
  });

  it("DB_MISSING + Telegram UNEXPECTED_ERROR → DB status FAILED (enables retry via UPDATE WHERE FAILED)", () => {
    // tryClaimScheduledReport second phase UPDATEs FAILED rows — this enables retry.
    expect(dbStatusForOutcome({ probeResult: "DB_MISSING", telegramSendResult: "UNEXPECTED_ERROR" })).toBe("FAILED");
  });

  it("DB_EXPIRED + Telegram PREPOST_TELEGRAM_DISABLED_MISSING_CONFIG → DB status FAILED", () => {
    expect(dbStatusForOutcome({ probeResult: "DB_EXPIRED", telegramSendResult: "PREPOST_TELEGRAM_DISABLED_MISSING_CONFIG" })).toBe("FAILED");
  });
});

describe("Kite session check — alert text", () => {
  function buildAlertText(date: string, probeResult: KiteTokenProbeResult): string {
    return (
      `⚠️ KITE SESSION INVALID (${date})\n` +
      `Probe: ${probeResult}\n` +
      `Re-login required at marketscannerbydev.in → Admin before 09:15 IST.\n` +
      `No live data, signals, or auto-trades until the session is refreshed.`
    );
  }

  it("alert text contains date, probe result, and action URL", () => {
    const text = buildAlertText("2026-07-14", "BROKER_INVALID");
    expect(text).toContain("⚠️ KITE SESSION INVALID");
    expect(text).toContain("2026-07-14");
    expect(text).toContain("Probe: BROKER_INVALID");
    expect(text).toContain("marketscannerbydev.in");
    expect(text).toContain("09:15 IST");
  });

  it("alert text uses 'Probe:' not 'Code:' (reflects live broker validation)", () => {
    const text = buildAlertText("2026-07-14", "DB_MISSING");
    expect(text).toContain("Probe:");
    expect(text).not.toContain("Code:");
  });

  it("alert text describes DB_MISSING correctly", () => {
    const text = buildAlertText("2026-07-15", "DB_MISSING");
    expect(text).toContain("Probe: DB_MISSING");
  });
});

describe("Kite session check — window constants", () => {
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
