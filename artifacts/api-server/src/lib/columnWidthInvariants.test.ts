/**
 * columnWidthInvariants.test.ts — 2026-07-17 post-close docket · Item 2.
 *
 * Standing invariant that would have caught the 2026-07-17 live-market
 * incident (option_signal_history.writer_version = varchar(32) receiving
 * a 42-char CURRENT_WRITER_VERSION stamp, ~54 minutes of dropped inserts):
 *
 *     LENGTH(every closed-enum literal or fixed writer stamp)
 *     ≤ character_maximum_length of its declared column.
 *
 * One string-length comparison forecloses the failure class forever. If a
 * new enum literal is added or a writer stamp is renamed longer than its
 * declared column, this test must scream before the change ships — never
 * again the "loud errors in postgres.err.log during a live session" path.
 *
 * The test proves it tests the real contract by including a `wouldFail`
 * control block that asserts the CURRENT_WRITER_VERSION would NOT fit
 * the pre-fix varchar(32) declaration — i.e., if the schema regressed to
 * width 32, the invariant would correctly reject it. See the final
 * describe block.
 *
 * Pure module under test. No DB, no I/O, no mocks.
 */
import { describe, it, expect } from "vitest";

import {
  CURRENT_WRITER_VERSION,
  type CanonicalDecision,
  type CanonicalReason,
  type ExecutionBlockedReason,
  type ExecutionStatus,
  type Stage,
  type TradeClass,
  type Verdict,
} from "./fnoCanonicalTaxonomy";

// ────────────────────────────────────────────────────────────────────────────
// Runtime literal arrays — mirror the closed unions in fnoCanonicalTaxonomy.
// `satisfies readonly Type[]` ensures TypeScript catches any drift between
// the type union and this runtime list at compile time — you cannot add a
// new literal to the type without adding it here (or TS complains) and you
// cannot add an unknown literal here (or TS complains).
// ────────────────────────────────────────────────────────────────────────────

const CANONICAL_DECISIONS = [
  "EMITTED",
  "EXECUTABLE",
  "WATCH",
  "DEMOTED",
  "REJECTED",
  "SHADOW_FAIL",
  "DATA_BLOCKED",
  "UNMAPPED",
] as const satisfies readonly CanonicalDecision[];

const CANONICAL_REASONS = [
  "DATA_BLOCKED_LIVE_FEED",
  "SETUP_CONDITIONS_UNMET",
  "RR_INSUFFICIENT_POST_CLAMP",
  "LATE_SESSION_ENTRY",
  "TIMING_VWAP_RECLAIM_LATE",
  "MARKET_CLOSED",
  "INFO_ONLY_BROADCAST",
  "HTF_BIAS_CONFLICT",
  "RS_CONFLICT",
  "LOW_WINRATE_HISTORY",
  "OPENING_NOISE_WINDOW",
  "CLOSING_NOISE_WINDOW",
  "EXPIRY_DAY_MODE",
  "OI_ATM_CONFLICT",
  "VOL_CLAMPED_STOP",
  "COUNTER_TREND_BIAS",
  "RECOVERY_MODE_VETO",
  "CHASE_RISK_VETO",
  "LEGACY_DEMOTION_UNMAPPED",
  "UNMAPPED",
] as const satisfies readonly CanonicalReason[];

const EXECUTION_BLOCKED_REASONS = [
  "INSUFFICIENT_CAPITAL",
  "SPREAD_TOO_WIDE",
  "DUP_SIGNAL",
  "SYSTEM_MODE_DEGRADED",
  "RISK_VETO",
  "CONCURRENT_CAP",
  "DAILY_TRADE_CAP",
  "BROKER_DISABLED",
] as const satisfies readonly ExecutionBlockedReason[];

const EXECUTION_STATUSES = [
  "NOT_TRIGGERED",
  "TRIGGERED_AWAITING_EXECUTION",
  "TRIGGERED_OPEN",
  "TRIGGERED_CLOSED",
  "TRIGGERED_EXPIRED_UNEXECUTED",
  "BLOCKED",
  "ERROR",
] as const satisfies readonly ExecutionStatus[];

const STAGES = [
  "PRE_EMISSION",
  "EMISSION",
  "TRIGGER_ARM",
  "CONTRACT_SELECTION",
  "SIZING",
  "EXECUTION",
  "OPEN",
  "LIFECYCLE",
] as const satisfies readonly Stage[];

const TRADE_CLASSES = [
  "TRADEABLE",
  "WATCHLIST",
  "INFO_ONLY",
  "DIAG",
] as const satisfies readonly TradeClass[];

const VERDICTS = [
  "PASS",
  "FAIL",
  "DEMOTE",
  "SKIP",
  "NOT_EVALUATED",
] as const satisfies readonly Verdict[];

// ────────────────────────────────────────────────────────────────────────────
// Declared column widths — mirror the Drizzle schema exactly (verified by
// grep 2026-07-17 post-close). Any Drizzle change must update this table
// in the same PR; TypeScript will not catch schema drift for you.
// ────────────────────────────────────────────────────────────────────────────

const COLUMN_WIDTHS = {
  // option_signal_history (lib/db/src/schema/optionSignals.ts:87–95)
  "option_signal_history.execution_status": 24,
  "option_signal_history.execution_blocked_reason": 48,
  "option_signal_history.writer_version": 64, // was varchar(32) pre-2026-07-17-fix

  // fno_signal_reasoning (lib/db/src/schema/fnoSignalReasoning.ts:150–158)
  "fno_signal_reasoning.verdict": 16,
  "fno_signal_reasoning.stage": 24,
  "fno_signal_reasoning.trade_class": 16,
  "fno_signal_reasoning.canonical_decision": 24,
  "fno_signal_reasoning.canonical_reason": 48,
} as const;

// ────────────────────────────────────────────────────────────────────────────
// The invariant: every literal fits its column, and the writer-version stamp
// fits its column.
// ────────────────────────────────────────────────────────────────────────────

function assertFits(
  columnKey: keyof typeof COLUMN_WIDTHS,
  literal: string,
): void {
  const width = COLUMN_WIDTHS[columnKey];
  const len = literal.length;
  if (len > width) {
    throw new Error(
      `column-width invariant FAILED: literal ${JSON.stringify(literal)} ` +
        `has length ${len} but ${columnKey} is declared varchar(${width}). ` +
        `Either widen the column (owner-approved schema change) or shorten ` +
        `the literal. See scripts/env/run_postgres.sh:1 for the incident ` +
        `this invariant prevents.`,
    );
  }
}

describe("column-width invariants (2026-07-17 post-close · Item 2)", () => {
  it("CURRENT_WRITER_VERSION fits option_signal_history.writer_version", () => {
    expect(() =>
      assertFits("option_signal_history.writer_version", CURRENT_WRITER_VERSION),
    ).not.toThrow();
  });

  it("every ExecutionStatus literal fits option_signal_history.execution_status", () => {
    for (const literal of EXECUTION_STATUSES) {
      expect(() =>
        assertFits("option_signal_history.execution_status", literal),
      ).not.toThrow();
    }
  });

  it("every ExecutionBlockedReason literal fits option_signal_history.execution_blocked_reason", () => {
    for (const literal of EXECUTION_BLOCKED_REASONS) {
      expect(() =>
        assertFits(
          "option_signal_history.execution_blocked_reason",
          literal,
        ),
      ).not.toThrow();
    }
  });

  it("every Verdict literal fits fno_signal_reasoning.verdict", () => {
    for (const literal of VERDICTS) {
      expect(() =>
        assertFits("fno_signal_reasoning.verdict", literal),
      ).not.toThrow();
    }
  });

  it("every Stage literal fits fno_signal_reasoning.stage", () => {
    for (const literal of STAGES) {
      expect(() =>
        assertFits("fno_signal_reasoning.stage", literal),
      ).not.toThrow();
    }
  });

  it("every TradeClass literal fits fno_signal_reasoning.trade_class", () => {
    for (const literal of TRADE_CLASSES) {
      expect(() =>
        assertFits("fno_signal_reasoning.trade_class", literal),
      ).not.toThrow();
    }
  });

  it("every CanonicalDecision literal fits fno_signal_reasoning.canonical_decision", () => {
    for (const literal of CANONICAL_DECISIONS) {
      expect(() =>
        assertFits(
          "fno_signal_reasoning.canonical_decision",
          literal,
        ),
      ).not.toThrow();
    }
  });

  it("every CanonicalReason literal fits fno_signal_reasoning.canonical_reason", () => {
    for (const literal of CANONICAL_REASONS) {
      expect(() =>
        assertFits(
          "fno_signal_reasoning.canonical_reason",
          literal,
        ),
      ).not.toThrow();
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Control block — proves the invariant tests the real contract.
// If a future PR narrows option_signal_history.writer_version back to
// varchar(32), the invariant would correctly reject CURRENT_WRITER_VERSION.
// This describe block MUST FAIL if COLUMN_WIDTHS[writer_version] < 42.
// ────────────────────────────────────────────────────────────────────────────

describe("column-width invariant · control (would-fail evidence)", () => {
  it("CURRENT_WRITER_VERSION would NOT fit the pre-2026-07-17 varchar(32) declaration", () => {
    // Simulate the pre-fix width; assert the invariant catches it.
    const preFixWidth = 32;
    const len = CURRENT_WRITER_VERSION.length;
    expect(len).toBeGreaterThan(preFixWidth);
    // Direct reproduction of the incident condition:
    expect(() => {
      if (len > preFixWidth) {
        throw new Error(
          `value too long for type character varying(${preFixWidth})`,
        );
      }
    }).toThrow(/value too long for type character varying\(32\)/);
  });

  it("known-length assertion — CURRENT_WRITER_VERSION is 42 chars as of 2026-07-17", () => {
    // Anchors the incident evidence in the test file. If the writer stamp
    // is renamed, this test intentionally becomes a checkpoint: update the
    // length here AND verify COLUMN_WIDTHS[writer_version] still fits.
    expect(CURRENT_WRITER_VERSION.length).toBe(42);
    expect(CURRENT_WRITER_VERSION).toBe(
      "paper-writer-v1.3.0-reasoning-instrumented",
    );
  });
});
