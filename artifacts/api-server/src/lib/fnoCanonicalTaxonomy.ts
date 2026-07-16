/**
 * F&O Canonical Taxonomy (P0.4 Step 2 · Stage 1 · 2026-07-16).
 *
 * Doc §16 canonical vocabulary — types + pure mapping helper only.
 *
 * ─── Scope ────────────────────────────────────────────────────────────
 * This module is Stage 1 of the writer-extension work. It contains
 * ONLY types and pure functions:
 *   1. Closed TypeScript unions for every canonical enum (verdict,
 *      stage, trade_class, canonical_decision, canonical_reason,
 *      execution_blocked_reason).
 *   2. Pure precedence-based mapping helper `mapDecisionToCanonical`
 *      that translates the legacy (decision, reason_code) tuple into
 *      canonical §16 values.
 *   3. `banOtherReasonAssertion` — throws on `OTHER` per owner ruling.
 *
 * Zero writer code, zero call sites touched. Extending the writer to
 * call these helpers is Stage 2 (held pending owner checkpoint).
 *
 * ─── Design constraints (owner rulings, session 2026-07-16) ───────────
 *   - NO retro-mapping of historical rows. Canonical values are for
 *     NEW writes only; historical rows keep `canonical_* = NULL`.
 *   - Reason-based override beats decision-based mapping:
 *     `NO_LIVE_KITE_INTRADAY` → `DATA_BLOCKED` even when the decision
 *     was `PRE_EMISSION_REJECTED`. Data failures and strategy
 *     rejections must NEVER share a canonical bucket.
 *   - `SKIPPED + NO_LIVE_KITE_INTRADAY` → `DATA_BLOCKED`; any other
 *     `SKIPPED` → `REJECTED`.
 *   - `PRE_EMISSION_REJECTED` → `REJECTED` when not overridden by the
 *     data-block rule.
 *   - Legacy writer bugs: `reason_code in {DEMOTED, EMITTED}` are
 *     category violations from a pre-canonical writer. The helper
 *     throws `LegacyReasonCodeBugError` so the defect is loud and
 *     visible.
 *   - `OTHER` as `reason_code` is BANNED in new writes. The helper
 *     throws `OtherReasonBannedError`. Every gate must classify or
 *     the write is a defect.
 *   - `execution_blocked_reason` extensions require owner sign-off:
 *     the union below is closed at compile time; adding a value is a
 *     type-diff that must be reviewed.
 *
 * ─── Non-goals ────────────────────────────────────────────────────────
 *   - No DB reads. No DB writes. No I/O.
 *   - No taxonomy_mapping table interaction (that table is held; the
 *     mapping lives in code per owner directive 1b).
 *   - No engine, gate, sizing, execution, scheduler, Kite, swing,
 *     equity, or scanner behaviour is touched.
 *   - Does NOT decide what canonical_decision an EMISSION-stage write
 *     should carry. New writers set canonical fields directly; this
 *     helper exists only to interpret LEGACY (decision, reason_code)
 *     pairs from PRE_EMISSION_REJECTED / SKIPPED paths.
 */

/* ──────────────────────── Canonical unions ───────────────────────── */

/** Doc §16 canonical decision set. */
export type CanonicalDecision =
  | "EXECUTABLE"
  | "WATCH"
  | "DEMOTED"
  | "REJECTED"
  | "SHADOW_FAIL"
  | "DATA_BLOCKED"
  | "UNMAPPED";

/**
 * Doc §16 canonical reason bucket. Extended cautiously; every new
 * value requires owner sign-off (compile-time diff).
 */
export type CanonicalReason =
  // Data-block / infrastructure family
  | "DATA_BLOCKED_LIVE_FEED"
  // Setup / conditions family
  | "SETUP_CONDITIONS_UNMET"
  | "RR_INSUFFICIENT_POST_CLAMP"
  // Session-window family
  | "LATE_SESSION_ENTRY"
  | "TIMING_VWAP_RECLAIM_LATE"
  | "MARKET_CLOSED"
  // Broadcast class
  | "INFO_ONLY_BROADCAST"
  // Escape hatch for legacy decisions the helper does not classify —
  // caller writes UNMAPPED explicitly, `/audit` renders "unclassified"
  | "UNMAPPED";

/** Gate verdict (N/A removed per owner ruling — was a dumping ground). */
export type Verdict = "PASS" | "FAIL" | "DEMOTE" | "SKIP" | "NOT_EVALUATED";

/** Pipeline stage the row belongs to. Enumerated here so the funnel
 *  is closed at compile time — new stages require a type diff. */
export type Stage =
  | "PRE_EMISSION"
  | "EMISSION"
  | "TRIGGER_ARM"
  | "CONTRACT_SELECTION"
  | "SIZING"
  | "EXECUTION"
  | "OPEN"
  | "LIFECYCLE";

/** Trade-class dimension — segments broadcasts from tradeable signals.
 *  `DIAG` is the permanent structural home for legitimate test /
 *  diagnostic writes; `/audit` filters it out of every funnel line. */
export type TradeClass = "TRADEABLE" | "WATCHLIST" | "INFO_ONLY" | "DIAG";

/** Closed enum of execution-blocked reasons. Extending this union
 *  requires owner sign-off — writers may NOT add values ad hoc. */
export type ExecutionBlockedReason =
  | "INSUFFICIENT_CAPITAL"
  | "SPREAD_TOO_WIDE"
  | "DUP_SIGNAL"
  | "SYSTEM_MODE_DEGRADED"
  | "RISK_VETO"
  | "CONCURRENT_CAP"
  | "DAILY_TRADE_CAP"
  | "BROKER_DISABLED";

/* ─────────────────── Legacy-shape input contract ─────────────────── */

/**
 * The pair of legacy strings a Stage-2 writer will hand to the mapping
 * helper. Kept loose (string) on purpose — the helper's job is to
 * classify unrecognised legacy prose into a canonical bucket, not to
 * refuse it at the type boundary.
 */
export interface LegacyDecisionReasonInput {
  /** The legacy `fno_signal_reasoning.decision` value at write time. */
  decision: string;
  /** The legacy `fno_signal_reasoning.reason_code` value at write time. */
  reasonCode: string | null | undefined;
}

/** The pair of canonical values produced by the mapping helper. */
export interface CanonicalPair {
  canonicalDecision: CanonicalDecision;
  canonicalReason: CanonicalReason;
}

/* ─────────────────────── Dedicated error classes ─────────────────── */

/** Thrown when `reason_code === "OTHER"` is passed to the helper.
 *  `OTHER` is banned in new writes per owner ruling — every gate must
 *  classify or the write is a defect. */
export class OtherReasonBannedError extends Error {
  readonly code = "OTHER_REASON_BANNED";
  constructor() {
    super(
      "OTHER is banned as a canonical_reason. Every gate must classify — writer must supply a specific taxonomy value or file a defect.",
    );
    this.name = "OtherReasonBannedError";
  }
}

/**
 * Thrown when a legacy writer bug is detected: `reason_code` carrying
 * a value that belongs to the `decision` dimension
 * (`DEMOTED` or `EMITTED`). The pre-canonical writer echoed the
 * decision label into the reason column; new writers must never do
 * this, so the helper fails loud instead of silently deriving a
 * misleading canonical value.
 */
export class LegacyReasonCodeBugError extends Error {
  readonly code = "LEGACY_REASON_CODE_BUG";
  constructor(public readonly reason: string) {
    super(
      `Legacy writer bug: reason_code="${reason}" carries a decision-family value. New writers must not echo decisions into reason. File writer-fix ticket.`,
    );
    this.name = "LegacyReasonCodeBugError";
  }
}

/* ────────────────────── Public helpers ───────────────────────────── */

/**
 * OTHER-ban assertion. Callers use this at the writer boundary before
 * accepting a canonical_reason — throwing loud makes drift visible in
 * the failure counters + `logger.warn` line the writer already emits.
 *
 * Pure. No I/O.
 */
export function banOtherReasonAssertion(reason: string | null | undefined): void {
  if (reason == null) return;
  if (String(reason).trim().toUpperCase() === "OTHER") {
    throw new OtherReasonBannedError();
  }
}

/**
 * Precedence-based mapping from legacy `(decision, reason_code)` to
 * canonical §16 values. Rules (order matters):
 *
 *   0. `OTHER` reason → throws `OtherReasonBannedError`.
 *   1. Legacy writer-bug reasons `DEMOTED` / `EMITTED` → throws
 *      `LegacyReasonCodeBugError` (loud; call sites must be cleaned up
 *      in the separate writer-fix ticket).
 *   2. Reason-based override: `NO_LIVE_KITE_INTRADAY` (anywhere it
 *      appears — including under `decision='PRE_EMISSION_REJECTED'`) →
 *      `{DATA_BLOCKED, DATA_BLOCKED_LIVE_FEED}`. Data failures NEVER
 *      share a bucket with strategy rejections.
 *   3. `decision='SKIPPED'` + `reason='INFO_ONLY_NOT_TRADEABLE'` →
 *      `{REJECTED, INFO_ONLY_BROADCAST}`.
 *   4. `decision='SKIPPED'` + any other reason (including null/empty)
 *      → `{REJECTED, UNMAPPED}` (defined, asserted).
 *   5. `decision='PRE_EMISSION_REJECTED'` → `REJECTED`, with reason
 *      lookup table below:
 *        - `CONDITIONS_NOT_MET`   → `SETUP_CONDITIONS_UNMET`
 *        - `POST_CLAMP_RR`        → `RR_INSUFFICIENT_POST_CLAMP`
 *        - `LATE_SESSION_ENTRY`   → `LATE_SESSION_ENTRY`
 *        - `VWAP_RECLAIM_LATE`    → `TIMING_VWAP_RECLAIM_LATE`
 *        - `MARKET_CLOSED`        → `MARKET_CLOSED`
 *        - unknown/null/empty     → `UNMAPPED` (defined, asserted)
 *   6. Any decision the helper does not classify → `{UNMAPPED, UNMAPPED}`.
 *      New writers using EMISSION-stage canonical values set the
 *      canonical fields directly and never route through this helper.
 *
 * Pure. No I/O. Called only by Stage-2 writers on NEW writes.
 */
export function mapDecisionToCanonical(input: LegacyDecisionReasonInput): CanonicalPair {
  const decision = String(input.decision ?? "").trim().toUpperCase();
  const rawReason = input.reasonCode == null ? "" : String(input.reasonCode).trim();
  const reason = rawReason.toUpperCase();

  // Rule 0 — OTHER is banned.
  banOtherReasonAssertion(reason);

  // Rule 1 — legacy writer-bug detection (reason echoing decision).
  if (reason === "DEMOTED" || reason === "EMITTED") {
    throw new LegacyReasonCodeBugError(reason);
  }

  // Rule 2 — reason-based data-block override wins over decision.
  if (reason === "NO_LIVE_KITE_INTRADAY") {
    return {
      canonicalDecision: "DATA_BLOCKED",
      canonicalReason: "DATA_BLOCKED_LIVE_FEED",
    };
  }

  // Rule 3 — SKIPPED + INFO_ONLY_NOT_TRADEABLE (baseline broadcast skip).
  if (decision === "SKIPPED" && reason === "INFO_ONLY_NOT_TRADEABLE") {
    return {
      canonicalDecision: "REJECTED",
      canonicalReason: "INFO_ONLY_BROADCAST",
    };
  }

  // Rule 4 — SKIPPED with any other reason (including null/empty).
  if (decision === "SKIPPED") {
    return {
      canonicalDecision: "REJECTED",
      canonicalReason: "UNMAPPED",
    };
  }

  // Rule 5 — PRE_EMISSION_REJECTED family.
  if (decision === "PRE_EMISSION_REJECTED") {
    const canonicalReason = mapPreEmissionReason(reason);
    return {
      canonicalDecision: "REJECTED",
      canonicalReason,
    };
  }

  // Rule 6 — anything else this helper does not classify. New writers
  // that carry canonical values directly never route through here.
  return {
    canonicalDecision: "UNMAPPED",
    canonicalReason: "UNMAPPED",
  };
}

/** Internal reason-only lookup for PRE_EMISSION_REJECTED rows.
 *  Kept as a small pure function so the mapping table is one place
 *  and the test file can drive named cases against it. */
function mapPreEmissionReason(reason: string): CanonicalReason {
  switch (reason) {
    case "CONDITIONS_NOT_MET":
      return "SETUP_CONDITIONS_UNMET";
    case "POST_CLAMP_RR":
      return "RR_INSUFFICIENT_POST_CLAMP";
    case "LATE_SESSION_ENTRY":
      return "LATE_SESSION_ENTRY";
    case "VWAP_RECLAIM_LATE":
      return "TIMING_VWAP_RECLAIM_LATE";
    case "MARKET_CLOSED":
      return "MARKET_CLOSED";
    case "":
    default:
      // Defined behaviour: unknown / null / empty legacy reason maps
      // to UNMAPPED. Test-asserted, not undefined.
      return "UNMAPPED";
  }
}
