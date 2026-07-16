/**
 * fnoCanonicalTaxonomy.test.ts — P0.4 Step 2 · Stage 1 unit tests
 * (2026-07-16).
 *
 * Executable form of the taxonomy rulings agreed this session. Every
 * named case below corresponds to an explicit owner ruling — if
 * someone changes a mapping later, one of these tests should scream.
 *
 * Pure module under test. No DB, no I/O, no mocks.
 */
import { describe, it, expect, expectTypeOf } from "vitest";

import {
  banOtherReasonAssertion,
  CURRENT_WRITER_VERSION,
  isReasoningWriterV2Enabled,
  LegacyReasonCodeBugError,
  mapDecisionToCanonical,
  mapDemotionTagsToCanonicalReason,
  OtherReasonBannedError,
  writerCanEmit,
  type CanonicalDecision,
  type CanonicalReason,
  type ExecutionBlockedReason,
  type ExecutionStatus,
  type Stage,
  type TradeClass,
  type Verdict,
} from "./fnoCanonicalTaxonomy";

/* ────────────────────── Precedence-ruling tests ─────────────────── */

describe("mapDecisionToCanonical — precedence rulings (session 2026-07-16)", () => {
  /* Rule 2 — reason-based data-block override beats decision-based mapping */

  it("NO_LIVE_KITE_INTRADAY under PRE_EMISSION_REJECTED → DATA_BLOCKED (reason-based override wins)", () => {
    // Owner ruling: data failures and strategy rejections must NEVER
    // share a bucket. The 9 rows we saw in the DB under
    // PRE_EMISSION_REJECTED must NOT map to REJECTED.
    const out = mapDecisionToCanonical({
      decision: "PRE_EMISSION_REJECTED",
      reasonCode: "NO_LIVE_KITE_INTRADAY",
    });
    expect(out.canonicalDecision).toBe("DATA_BLOCKED");
    expect(out.canonicalReason).toBe("DATA_BLOCKED_LIVE_FEED");
  });

  it("NO_LIVE_KITE_INTRADAY under SKIPPED → DATA_BLOCKED (same reason-based override)", () => {
    const out = mapDecisionToCanonical({
      decision: "SKIPPED",
      reasonCode: "NO_LIVE_KITE_INTRADAY",
    });
    expect(out.canonicalDecision).toBe("DATA_BLOCKED");
    expect(out.canonicalReason).toBe("DATA_BLOCKED_LIVE_FEED");
  });

  it("NO_LIVE_KITE_INTRADAY under EMITTED → DATA_BLOCKED (rule wins regardless of decision)", () => {
    // Defensive: even if a future writer echoes the data-block reason
    // under a different decision, the reason-based override still
    // yields the correct canonical bucket.
    const out = mapDecisionToCanonical({
      decision: "EMITTED",
      reasonCode: "NO_LIVE_KITE_INTRADAY",
    });
    expect(out.canonicalDecision).toBe("DATA_BLOCKED");
    expect(out.canonicalReason).toBe("DATA_BLOCKED_LIVE_FEED");
  });

  /* Rule 3/4 — SKIPPED fork */

  it("SKIPPED + INFO_ONLY_NOT_TRADEABLE → REJECTED / INFO_ONLY_BROADCAST", () => {
    const out = mapDecisionToCanonical({
      decision: "SKIPPED",
      reasonCode: "INFO_ONLY_NOT_TRADEABLE",
    });
    expect(out.canonicalDecision).toBe("REJECTED");
    expect(out.canonicalReason).toBe("INFO_ONLY_BROADCAST");
  });

  it("SKIPPED + any other reason → REJECTED / UNMAPPED (defined, asserted)", () => {
    const out = mapDecisionToCanonical({
      decision: "SKIPPED",
      reasonCode: "SOME_FUTURE_LEGACY_REASON",
    });
    expect(out.canonicalDecision).toBe("REJECTED");
    expect(out.canonicalReason).toBe("UNMAPPED");
  });

  it("SKIPPED + null reason → REJECTED / UNMAPPED (defined, asserted)", () => {
    const out = mapDecisionToCanonical({
      decision: "SKIPPED",
      reasonCode: null,
    });
    expect(out.canonicalDecision).toBe("REJECTED");
    expect(out.canonicalReason).toBe("UNMAPPED");
  });

  it("SKIPPED + empty-string reason → REJECTED / UNMAPPED (defined, asserted)", () => {
    const out = mapDecisionToCanonical({
      decision: "SKIPPED",
      reasonCode: "",
    });
    expect(out.canonicalDecision).toBe("REJECTED");
    expect(out.canonicalReason).toBe("UNMAPPED");
  });

  /* Rule 5 — PRE_EMISSION_REJECTED family */

  it("PRE_EMISSION_REJECTED + CONDITIONS_NOT_MET → REJECTED / SETUP_CONDITIONS_UNMET", () => {
    const out = mapDecisionToCanonical({
      decision: "PRE_EMISSION_REJECTED",
      reasonCode: "CONDITIONS_NOT_MET",
    });
    expect(out.canonicalDecision).toBe("REJECTED");
    expect(out.canonicalReason).toBe("SETUP_CONDITIONS_UNMET");
  });

  it("PRE_EMISSION_REJECTED + POST_CLAMP_RR → REJECTED / RR_INSUFFICIENT_POST_CLAMP", () => {
    const out = mapDecisionToCanonical({
      decision: "PRE_EMISSION_REJECTED",
      reasonCode: "POST_CLAMP_RR",
    });
    expect(out.canonicalDecision).toBe("REJECTED");
    expect(out.canonicalReason).toBe("RR_INSUFFICIENT_POST_CLAMP");
  });

  it("PRE_EMISSION_REJECTED + LATE_SESSION_ENTRY → REJECTED / LATE_SESSION_ENTRY", () => {
    const out = mapDecisionToCanonical({
      decision: "PRE_EMISSION_REJECTED",
      reasonCode: "LATE_SESSION_ENTRY",
    });
    expect(out.canonicalDecision).toBe("REJECTED");
    expect(out.canonicalReason).toBe("LATE_SESSION_ENTRY");
  });

  it("PRE_EMISSION_REJECTED + VWAP_RECLAIM_LATE → REJECTED / TIMING_VWAP_RECLAIM_LATE", () => {
    const out = mapDecisionToCanonical({
      decision: "PRE_EMISSION_REJECTED",
      reasonCode: "VWAP_RECLAIM_LATE",
    });
    expect(out.canonicalDecision).toBe("REJECTED");
    expect(out.canonicalReason).toBe("TIMING_VWAP_RECLAIM_LATE");
  });

  it("PRE_EMISSION_REJECTED + MARKET_CLOSED → REJECTED / MARKET_CLOSED", () => {
    const out = mapDecisionToCanonical({
      decision: "PRE_EMISSION_REJECTED",
      reasonCode: "MARKET_CLOSED",
    });
    expect(out.canonicalDecision).toBe("REJECTED");
    expect(out.canonicalReason).toBe("MARKET_CLOSED");
  });

  it("PRE_EMISSION_REJECTED + unknown legacy reason → REJECTED / UNMAPPED (defined, asserted)", () => {
    const out = mapDecisionToCanonical({
      decision: "PRE_EMISSION_REJECTED",
      reasonCode: "UNSEEN_LEGACY_STRING",
    });
    expect(out.canonicalDecision).toBe("REJECTED");
    expect(out.canonicalReason).toBe("UNMAPPED");
  });

  it("PRE_EMISSION_REJECTED + null reason → REJECTED / UNMAPPED (defined, asserted)", () => {
    const out = mapDecisionToCanonical({
      decision: "PRE_EMISSION_REJECTED",
      reasonCode: null,
    });
    expect(out.canonicalDecision).toBe("REJECTED");
    expect(out.canonicalReason).toBe("UNMAPPED");
  });

  it("PRE_EMISSION_REJECTED + empty-string reason → REJECTED / UNMAPPED (defined, asserted)", () => {
    const out = mapDecisionToCanonical({
      decision: "PRE_EMISSION_REJECTED",
      reasonCode: "",
    });
    expect(out.canonicalDecision).toBe("REJECTED");
    expect(out.canonicalReason).toBe("UNMAPPED");
  });

  /* Rule 6 — decisions the helper does not classify */

  it("EMITTED with a non-data-block reason → UNMAPPED / UNMAPPED (new writers set canonical directly, not via helper)", () => {
    const out = mapDecisionToCanonical({
      decision: "EMITTED",
      reasonCode: "SOMETHING_ELSE",
    });
    expect(out.canonicalDecision).toBe("UNMAPPED");
    expect(out.canonicalReason).toBe("UNMAPPED");
  });

  it("Unknown legacy decision string → UNMAPPED / UNMAPPED (defined behaviour, not thrown)", () => {
    const out = mapDecisionToCanonical({
      decision: "SOMETHING_NEVER_SEEN_BEFORE",
      reasonCode: "ALSO_UNKNOWN",
    });
    expect(out.canonicalDecision).toBe("UNMAPPED");
    expect(out.canonicalReason).toBe("UNMAPPED");
  });

  it("case- and whitespace-insensitive: lowercased+padded values map the same as canonical strings", () => {
    const out = mapDecisionToCanonical({
      decision: "  pre_emission_rejected ",
      reasonCode: "  post_clamp_rr  ",
    });
    expect(out.canonicalDecision).toBe("REJECTED");
    expect(out.canonicalReason).toBe("RR_INSUFFICIENT_POST_CLAMP");
  });
});

/* ────────────────────── Banned / defect assertions ─────────────── */

describe("mapDecisionToCanonical — banned reasons + legacy writer bugs (throw, not return)", () => {
  it("OTHER as reason_code → throws OtherReasonBannedError (helper path)", () => {
    expect(() =>
      mapDecisionToCanonical({
        decision: "PRE_EMISSION_REJECTED",
        reasonCode: "OTHER",
      }),
    ).toThrow(OtherReasonBannedError);
  });

  it("OTHER as reason_code → throws even under a non-rejection decision", () => {
    expect(() =>
      mapDecisionToCanonical({
        decision: "SKIPPED",
        reasonCode: "OTHER",
      }),
    ).toThrow(OtherReasonBannedError);
  });

  it("case-insensitive OTHER (lowercase 'other') still throws — no bypass via casing", () => {
    expect(() =>
      mapDecisionToCanonical({
        decision: "PRE_EMISSION_REJECTED",
        reasonCode: "other",
      }),
    ).toThrow(OtherReasonBannedError);
  });

  it("reason_code = 'DEMOTED' → throws LegacyReasonCodeBugError (writer bug — decision echoed into reason)", () => {
    expect(() =>
      mapDecisionToCanonical({
        decision: "EMITTED",
        reasonCode: "DEMOTED",
      }),
    ).toThrow(LegacyReasonCodeBugError);
  });

  it("reason_code = 'EMITTED' → throws LegacyReasonCodeBugError (same category violation)", () => {
    expect(() =>
      mapDecisionToCanonical({
        decision: "EMITTED",
        reasonCode: "EMITTED",
      }),
    ).toThrow(LegacyReasonCodeBugError);
  });

  it("legacy writer bugs carry the offending reason on the error for the writer-fix ticket", () => {
    try {
      mapDecisionToCanonical({ decision: "EMITTED", reasonCode: "DEMOTED" });
      throw new Error("expected mapDecisionToCanonical to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(LegacyReasonCodeBugError);
      const bug = err as LegacyReasonCodeBugError;
      expect(bug.code).toBe("LEGACY_REASON_CODE_BUG");
      expect(bug.reason).toBe("DEMOTED");
      expect(bug.message).toContain("DEMOTED");
    }
  });
});

describe("banOtherReasonAssertion — standalone banned assertion", () => {
  it("throws on 'OTHER'", () => {
    expect(() => banOtherReasonAssertion("OTHER")).toThrow(OtherReasonBannedError);
  });

  it("throws on lowercase 'other'", () => {
    expect(() => banOtherReasonAssertion("other")).toThrow(OtherReasonBannedError);
  });

  it("throws on whitespace-padded 'OTHER '", () => {
    expect(() => banOtherReasonAssertion(" OTHER ")).toThrow(OtherReasonBannedError);
  });

  it("does NOT throw on null", () => {
    expect(() => banOtherReasonAssertion(null)).not.toThrow();
  });

  it("does NOT throw on undefined", () => {
    expect(() => banOtherReasonAssertion(undefined)).not.toThrow();
  });

  it("does NOT throw on a valid canonical reason", () => {
    expect(() => banOtherReasonAssertion("SETUP_CONDITIONS_UNMET")).not.toThrow();
  });

  it("carries the OTHER_REASON_BANNED code + descriptive message", () => {
    try {
      banOtherReasonAssertion("OTHER");
      throw new Error("expected banOtherReasonAssertion to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OtherReasonBannedError);
      const banned = err as OtherReasonBannedError;
      expect(banned.code).toBe("OTHER_REASON_BANNED");
      expect(banned.message).toContain("banned");
    }
  });
});

/* ────────────────────── Closed-union compile-time guards ─────────── */

describe("canonical unions are closed at compile time (writer signatures cannot widen to string)", () => {
  it("Verdict includes NOT_EVALUATED, does NOT include N/A (owner amendment)", () => {
    // Compile-time: the assignment fails if NOT_EVALUATED leaves the
    // union. Runtime assertion is a safety net for accidental refactor.
    const v: Verdict = "NOT_EVALUATED";
    expect(v).toBe("NOT_EVALUATED");
    // TypeScript-level check: "N/A" is NOT assignable to Verdict.
    // We use expectTypeOf so a regression that widens the type would
    // fail typecheck as well as runtime.
    expectTypeOf<Verdict>().toEqualTypeOf<
      "PASS" | "FAIL" | "DEMOTE" | "SKIP" | "NOT_EVALUATED"
    >();
  });

  it("CanonicalDecision matches doc §16 canonical set + UNMAPPED", () => {
    expectTypeOf<CanonicalDecision>().toEqualTypeOf<
      | "EXECUTABLE"
      | "WATCH"
      | "DEMOTED"
      | "REJECTED"
      | "SHADOW_FAIL"
      | "DATA_BLOCKED"
      | "UNMAPPED"
    >();
  });

  it("TradeClass includes DIAG (structural home for legitimate test/diagnostic writes)", () => {
    const tc: TradeClass = "DIAG";
    expect(tc).toBe("DIAG");
    expectTypeOf<TradeClass>().toEqualTypeOf<
      "TRADEABLE" | "WATCHLIST" | "INFO_ONLY" | "DIAG"
    >();
  });

  it("Stage covers every funnel step from PRE_EMISSION through LIFECYCLE", () => {
    expectTypeOf<Stage>().toEqualTypeOf<
      | "PRE_EMISSION"
      | "EMISSION"
      | "TRIGGER_ARM"
      | "CONTRACT_SELECTION"
      | "SIZING"
      | "EXECUTION"
      | "OPEN"
      | "LIFECYCLE"
    >();
  });

  it("ExecutionBlockedReason is closed — extending it requires an owner-reviewable type diff", () => {
    // Snapshot the current locked set. Adding a value must touch this
    // test AND the union — no ad hoc writer additions.
    expectTypeOf<ExecutionBlockedReason>().toEqualTypeOf<
      | "INSUFFICIENT_CAPITAL"
      | "SPREAD_TOO_WIDE"
      | "DUP_SIGNAL"
      | "SYSTEM_MODE_DEGRADED"
      | "RISK_VETO"
      | "CONCURRENT_CAP"
      | "DAILY_TRADE_CAP"
      | "BROKER_DISABLED"
    >();
  });

  it("CanonicalReason set is closed and includes UNMAPPED for defined fallback + LEGACY_DEMOTION_UNMAPPED for tagged-demotion escape", () => {
    expectTypeOf<CanonicalReason>().toEqualTypeOf<
      | "DATA_BLOCKED_LIVE_FEED"
      | "SETUP_CONDITIONS_UNMET"
      | "RR_INSUFFICIENT_POST_CLAMP"
      | "LATE_SESSION_ENTRY"
      | "TIMING_VWAP_RECLAIM_LATE"
      | "MARKET_CLOSED"
      | "INFO_ONLY_BROADCAST"
      | "HTF_BIAS_CONFLICT"
      | "RS_CONFLICT"
      | "LOW_WINRATE_HISTORY"
      | "OPENING_NOISE_WINDOW"
      | "CLOSING_NOISE_WINDOW"
      | "EXPIRY_DAY_MODE"
      | "OI_ATM_CONFLICT"
      | "VOL_CLAMPED_STOP"
      | "COUNTER_TREND_BIAS"
      | "RECOVERY_MODE_VETO"
      | "CHASE_RISK_VETO"
      | "LEGACY_DEMOTION_UNMAPPED"
      | "UNMAPPED"
    >();
  });

  it("ExecutionStatus is closed and includes TRIGGERED_AWAITING_EXECUTION (honesty guard)", () => {
    expectTypeOf<ExecutionStatus>().toEqualTypeOf<
      | "NOT_TRIGGERED"
      | "TRIGGERED_AWAITING_EXECUTION"
      | "TRIGGERED_OPEN"
      | "TRIGGERED_CLOSED"
      | "BLOCKED"
      | "ERROR"
    >();
  });
});

/* ────────────────────── Demotion-tag → canonical mapping ────────── */

describe("mapDemotionTagsToCanonicalReason — Site D override taxonomy", () => {
  it("empty array → LEGACY_DEMOTION_UNMAPPED (defined, asserted)", () => {
    expect(mapDemotionTagsToCanonicalReason([])).toBe("LEGACY_DEMOTION_UNMAPPED");
  });

  it("null → LEGACY_DEMOTION_UNMAPPED", () => {
    expect(mapDemotionTagsToCanonicalReason(null)).toBe("LEGACY_DEMOTION_UNMAPPED");
  });

  it("undefined → LEGACY_DEMOTION_UNMAPPED", () => {
    expect(mapDemotionTagsToCanonicalReason(undefined)).toBe(
      "LEGACY_DEMOTION_UNMAPPED",
    );
  });

  it("single tag HTF_CONFLICT → HTF_BIAS_CONFLICT", () => {
    expect(mapDemotionTagsToCanonicalReason(["HTF_CONFLICT"])).toBe("HTF_BIAS_CONFLICT");
  });

  it("HTF1H_CONFLICT alias → HTF_BIAS_CONFLICT (same bucket)", () => {
    expect(mapDemotionTagsToCanonicalReason(["HTF1H_CONFLICT"])).toBe(
      "HTF_BIAS_CONFLICT",
    );
  });

  it("OI_ATM_CONFLICT → OI_ATM_CONFLICT", () => {
    expect(mapDemotionTagsToCanonicalReason(["OI_ATM_CONFLICT"])).toBe(
      "OI_ATM_CONFLICT",
    );
  });

  it("RS_CONFLICT → RS_CONFLICT", () => {
    expect(mapDemotionTagsToCanonicalReason(["RS_CONFLICT"])).toBe("RS_CONFLICT");
  });

  it("COUNTER_TREND → COUNTER_TREND_BIAS", () => {
    expect(mapDemotionTagsToCanonicalReason(["COUNTER_TREND"])).toBe(
      "COUNTER_TREND_BIAS",
    );
  });

  it("EXPIRY_DAY → EXPIRY_DAY_MODE", () => {
    expect(mapDemotionTagsToCanonicalReason(["EXPIRY_DAY"])).toBe("EXPIRY_DAY_MODE");
  });

  it("OPENING_NOISE → OPENING_NOISE_WINDOW", () => {
    expect(mapDemotionTagsToCanonicalReason(["OPENING_NOISE"])).toBe(
      "OPENING_NOISE_WINDOW",
    );
  });

  it("CLOSING_NOISE → CLOSING_NOISE_WINDOW", () => {
    expect(mapDemotionTagsToCanonicalReason(["CLOSING_NOISE"])).toBe(
      "CLOSING_NOISE_WINDOW",
    );
  });

  it("VOL_CLAMPED_STOP → VOL_CLAMPED_STOP", () => {
    expect(mapDemotionTagsToCanonicalReason(["VOL_CLAMPED_STOP"])).toBe(
      "VOL_CLAMPED_STOP",
    );
  });

  it("RECOVERY_MODE_VETO → RECOVERY_MODE_VETO", () => {
    expect(mapDemotionTagsToCanonicalReason(["RECOVERY_MODE_VETO"])).toBe(
      "RECOVERY_MODE_VETO",
    );
  });

  it("CHASE_RISK_VETO → CHASE_RISK_VETO", () => {
    expect(mapDemotionTagsToCanonicalReason(["CHASE_RISK_VETO"])).toBe(
      "CHASE_RISK_VETO",
    );
  });

  it("RR_LOW → RR_INSUFFICIENT_POST_CLAMP (shared bucket with PRE_EMISSION path)", () => {
    expect(mapDemotionTagsToCanonicalReason(["RR_LOW"])).toBe(
      "RR_INSUFFICIENT_POST_CLAMP",
    );
  });

  it("LOW_WINRATE → LOW_WINRATE_HISTORY", () => {
    expect(mapDemotionTagsToCanonicalReason(["LOW_WINRATE"])).toBe(
      "LOW_WINRATE_HISTORY",
    );
  });

  it("multi-tag precedence: HTF_CONFLICT wins over LOW_WINRATE", () => {
    // HTF_CONFLICT is a data/structural conflict, LOW_WINRATE is a
    // quality veto — the priority table above places structural
    // conflicts first.
    expect(
      mapDemotionTagsToCanonicalReason(["LOW_WINRATE", "HTF_CONFLICT"]),
    ).toBe("HTF_BIAS_CONFLICT");
  });

  it("multi-tag precedence: OI_ATM_CONFLICT wins over EXPIRY_DAY", () => {
    expect(
      mapDemotionTagsToCanonicalReason(["EXPIRY_DAY", "OI_ATM_CONFLICT"]),
    ).toBe("OI_ATM_CONFLICT");
  });

  it("unknown tag only → LEGACY_DEMOTION_UNMAPPED (defined escape)", () => {
    expect(
      mapDemotionTagsToCanonicalReason(["SOMETHING_NOT_MAPPED_YET"]),
    ).toBe("LEGACY_DEMOTION_UNMAPPED");
  });

  it("case-insensitive: lowercase tag still maps to the canonical value", () => {
    expect(mapDemotionTagsToCanonicalReason(["htf_conflict"])).toBe(
      "HTF_BIAS_CONFLICT",
    );
  });

  it("whitespace-padded tag still maps to canonical", () => {
    expect(mapDemotionTagsToCanonicalReason([" HTF_CONFLICT "])).toBe(
      "HTF_BIAS_CONFLICT",
    );
  });
});

/* ────────────────────── Writer permission matrix ─────────────────── */

describe("writerCanEmit — permission matrix (honesty guard)", () => {
  it("PAPER_WRITER may emit every ExecutionStatus (full visibility)", () => {
    const all: ExecutionStatus[] = [
      "NOT_TRIGGERED",
      "TRIGGERED_AWAITING_EXECUTION",
      "TRIGGERED_OPEN",
      "TRIGGERED_CLOSED",
      "BLOCKED",
      "ERROR",
    ];
    for (const s of all) {
      expect(writerCanEmit("PAPER_WRITER", s)).toBe(true);
    }
  });

  it("LIFECYCLE_SWEEP may emit NOT_TRIGGERED / AWAITING / CLOSED — but NOT TRIGGERED_OPEN", () => {
    expect(writerCanEmit("LIFECYCLE_SWEEP", "NOT_TRIGGERED")).toBe(true);
    expect(writerCanEmit("LIFECYCLE_SWEEP", "TRIGGERED_AWAITING_EXECUTION")).toBe(true);
    expect(writerCanEmit("LIFECYCLE_SWEEP", "TRIGGERED_CLOSED")).toBe(true);
    // The critical honesty guard: a sweep with no paper-open awareness
    // may NOT claim TRIGGERED_OPEN.
    expect(writerCanEmit("LIFECYCLE_SWEEP", "TRIGGERED_OPEN")).toBe(false);
    expect(writerCanEmit("LIFECYCLE_SWEEP", "BLOCKED")).toBe(false);
    expect(writerCanEmit("LIFECYCLE_SWEEP", "ERROR")).toBe(false);
  });

  it("KITE_TICK_SWEEP may only emit NOT_TRIGGERED and AWAITING_EXECUTION", () => {
    expect(writerCanEmit("KITE_TICK_SWEEP", "NOT_TRIGGERED")).toBe(true);
    expect(writerCanEmit("KITE_TICK_SWEEP", "TRIGGERED_AWAITING_EXECUTION")).toBe(true);
    expect(writerCanEmit("KITE_TICK_SWEEP", "TRIGGERED_OPEN")).toBe(false);
    expect(writerCanEmit("KITE_TICK_SWEEP", "TRIGGERED_CLOSED")).toBe(false);
    expect(writerCanEmit("KITE_TICK_SWEEP", "BLOCKED")).toBe(false);
    expect(writerCanEmit("KITE_TICK_SWEEP", "ERROR")).toBe(false);
  });

  it("ORCHESTRATOR_HOOK may ONLY emit NOT_TRIGGERED", () => {
    expect(writerCanEmit("ORCHESTRATOR_HOOK", "NOT_TRIGGERED")).toBe(true);
    expect(writerCanEmit("ORCHESTRATOR_HOOK", "TRIGGERED_AWAITING_EXECUTION")).toBe(false);
    expect(writerCanEmit("ORCHESTRATOR_HOOK", "TRIGGERED_OPEN")).toBe(false);
    expect(writerCanEmit("ORCHESTRATOR_HOOK", "TRIGGERED_CLOSED")).toBe(false);
    expect(writerCanEmit("ORCHESTRATOR_HOOK", "BLOCKED")).toBe(false);
    expect(writerCanEmit("ORCHESTRATOR_HOOK", "ERROR")).toBe(false);
  });

  it("fails closed: writerCanEmit returns false silently (policy check, not defect)", () => {
    // No throws. Silence is correct — the caller uses this to DECIDE
    // whether to write the column at all; a false return means leave
    // it NULL, not raise.
    expect(() => writerCanEmit("LIFECYCLE_SWEEP", "TRIGGERED_OPEN")).not.toThrow();
  });
});

/* ────────────────────── Feature flag & writer version ────────────── */

describe("isReasoningWriterV2Enabled — feature flag semantics", () => {
  it("returns false when env is unset (byte-identical current behaviour)", () => {
    const saved = process.env.REASONING_WRITER_V2_ENABLED;
    delete process.env.REASONING_WRITER_V2_ENABLED;
    try {
      expect(isReasoningWriterV2Enabled()).toBe(false);
    } finally {
      if (saved !== undefined) process.env.REASONING_WRITER_V2_ENABLED = saved;
    }
  });

  it("returns true when env is exactly '1'", () => {
    const saved = process.env.REASONING_WRITER_V2_ENABLED;
    process.env.REASONING_WRITER_V2_ENABLED = "1";
    try {
      expect(isReasoningWriterV2Enabled()).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.REASONING_WRITER_V2_ENABLED;
      else process.env.REASONING_WRITER_V2_ENABLED = saved;
    }
  });

  it("returns false for 'true', 'on', 'yes' — only literal '1' turns it on (no ambiguity)", () => {
    const saved = process.env.REASONING_WRITER_V2_ENABLED;
    for (const v of ["true", "on", "yes", "TRUE", "0", "false", ""]) {
      process.env.REASONING_WRITER_V2_ENABLED = v;
      expect(isReasoningWriterV2Enabled()).toBe(false);
    }
    if (saved === undefined) delete process.env.REASONING_WRITER_V2_ENABLED;
    else process.env.REASONING_WRITER_V2_ENABLED = saved;
  });

  it("CURRENT_WRITER_VERSION follows the paper-writer-v1.3.0 tag", () => {
    expect(CURRENT_WRITER_VERSION).toBe(
      "paper-writer-v1.3.0-reasoning-instrumented",
    );
  });
});
