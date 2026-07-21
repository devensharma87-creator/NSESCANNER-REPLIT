/**
 * Segment-aware paper-trade session-admission module (P0.2 corrections, 2026-07-21).
 *
 * Canonical entry point: `computeTradeAdmission(ctx: TradeAdmissionContext)`.
 * All durable paper-trade writers must call this function — never a local
 * calendar check or a direct call to getMarketStatusDetail.
 *
 * Design notes:
 *   - NSE equity session (equity_cash / nse_fo): 09:15–15:30 IST, Mon–Fri, non-holiday.
 *   - BSE F&O (SENSEX): `BSE_CALENDAR_VERIFIED = false` → always CALENDAR_UNAVAILABLE.
 *     NSE and BSE observe the same SEBI-mandated trading holidays in practice, but
 *     the current calendar source (`marketEvents.ts`) is labeled NSE_CURATED_2026.
 *     We cannot claim BSE-independence without an explicitly-sourced BSE list.
 *     Set BSE_CALENDAR_VERIFIED=true (and add getBseMarketStatusDetail) when a
 *     separately-verified BSE calendar is available.
 *   - Pre-open auction (09:00–09:15 IST) is NOT authorized for paper opens.
 *   - Equity has NO approved automatic-entry strategy cutoff configuration.
 *     `EQUITY_AUTO_ENTRY_CUTOFF = null` → AUTO and SWING_STAGED_APPROVAL fail
 *     closed with ENTRY_CUTOFF_CONFIG_UNAVAILABLE. Exchange session end (15:30)
 *     is NOT treated as an approved strategy cutoff and is NOT used as a fallback.
 *   - MANUAL source is not subject to the strategy entry cutoff (owner-directed).
 *     It must never fill outside the valid exchange session.
 *   - `computeEquitySessionAdmission(now)` is retained as a compatibility wrapper
 *     that delegates to `computeTradeAdmission` with equity-cash context and no
 *     cutoff requirement (exchange-session-only semantics).
 *   - `classifyStoredTimestamp` is pure read-only forensics. Exchange-session
 *     validity is classified; cutoffPolicyValidity is always UNKNOWN (the original
 *     cutoff policy at the time of the open cannot be proven from the stored
 *     timestamp). ABB (2026-06-29 15:12:03 IST): openedSessionValidity=VALID_SESSION,
 *     cutoffPolicyValidity=UNKNOWN.
 *   - Timestamp confidence proof: the `opened_at` column in `paper_trade_eq` is
 *     declared `timestamp("opened_at", { withTimezone: true })` (Drizzle ORM,
 *     lib/db/src/schema/paperTrading.ts:325). PostgreSQL stores this as `timestamptz`
 *     (UTC-anchored). The pg driver deserializes it as a JavaScript `Date` object
 *     which is definitively UTC. Calling `.toISOString()` on a valid `Date` is
 *     timezone-unambiguous. `timestampConfidence: "HIGH"` is provably correct for
 *     any value where `isFinite(d.getTime())` is true.
 */
import { getMarketStatusDetail } from "./marketEvents";
export { FNO_BASELINE_GUARDRAILS, FNO_STANDARD_LATE_ENTRY_CUTOFF_IST_MIN } from "./paperAccount";

// ─── Calendar version ────────────────────────────────────────────────────────

/**
 * Monotonic version tag for the NSE holiday calendar in `marketEvents.ts`.
 * Bump when the holiday list is updated.
 */
export const CALENDAR_VERSION = "NSE-2026-v1";

/**
 * Whether a separately-verified BSE holiday calendar is available.
 *
 * When false (default), BSE F&O (SENSEX) admission always fails closed with
 * CALENDAR_UNAVAILABLE. NSE and BSE observe the same SEBI-mandated trading
 * holidays in practice, but we cannot claim BSE-independence without an
 * explicitly-sourced BSE list.
 *
 * Set to true and add `getBseMarketStatusDetail` when a verified BSE calendar ships.
 */
export const BSE_CALENDAR_VERIFIED = false;

// ─── Entry cutoff configuration ───────────────────────────────────────────────

/**
 * A strategy-level automatic-entry cutoff policy.
 * Must be inside the authorized continuous session (09:15–15:30 IST).
 */
export interface EntryAdmissionCutoffPolicy {
  /** Minutes from midnight IST (e.g. 14 * 60 + 45 = 885 for 14:45 IST). */
  istMinOfDay: number;
  /** Human-readable label for diagnostic logging. */
  policySource: string;
}

/**
 * Equity automatic-entry cutoff policy for AUTO and SWING_STAGED_APPROVAL sources.
 *
 * null = not configured. AUTO and SWING_STAGED_APPROVAL opens fail closed with
 * ENTRY_CUTOFF_CONFIG_UNAVAILABLE when this is null. The exchange session end
 * (15:30 IST) is NOT an approved strategy cutoff and is NOT used as a fallback.
 * Set to an EntryAdmissionCutoffPolicy once a strategy cutoff is approved.
 */
export const EQUITY_AUTO_ENTRY_CUTOFF: EntryAdmissionCutoffPolicy | null = null;

// ─── Reason codes ─────────────────────────────────────────────────────────────

/**
 * Structured reason codes for paper-trade session admission decisions.
 * All 12 mandatory codes are wired through real decision branches in
 * `computeTradeAdmission`. See that function for generation locations.
 *
 * "MARKET_CLOSED" is a LEGACY ALIAS — it was written by the pre-P0.2 gate
 * and may appear in existing `paper_eq_audit` rows. New rows use one of the
 * 12 precise codes. The UI / audit SKIP_TONE map should fall through gracefully
 * for legacy rows.
 */
export type EqSessionAdmissionReason =
  // ── Mandatory structured codes (P0.2 correction, 2026-07-21) ──────────────
  /** Blocked — clock falls on Saturday or Sunday. */
  | "MARKET_CLOSED_WEEKEND"
  /** Blocked — date is a curated NSE/BSE trading holiday. */
  | "MARKET_CLOSED_HOLIDAY"
  /** Blocked — clock is before 09:00 IST (before pre-open). */
  | "BEFORE_MARKET_SESSION"
  /** Blocked — clock is after 15:30 IST (regular session close). */
  | "AFTER_MARKET_SESSION"
  /**
   * Blocked — server time is inside the session but at or past the configured
   * strategy entry cutoff (e.g. F&O BASELINE 14:45, F&O STANDARD 15:25).
   */
  | "ENTRY_CUTOFF_PASSED"
  /**
   * Blocked — the applicable automatic-entry cutoff policy is absent, null,
   * or not authoritative. AUTO and SWING_STAGED_APPROVAL fail closed here when
   * EQUITY_AUTO_ENTRY_CUTOFF = null.
   */
  | "ENTRY_CUTOFF_CONFIG_UNAVAILABLE"
  /**
   * Blocked — clock is in the pre-open auction window (09:00–09:15 IST).
   * Pre-open is a price-discovery session; paper opens are not authorized here.
   */
  | "SPECIAL_SESSION_NOT_AUTHORIZED"
  /**
   * Blocked — calendar data is unavailable, BSE calendar is not independently
   * verified (BSE_CALENDAR_VERIFIED=false), or market status is UNKNOWN.
   */
  | "CALENDAR_UNAVAILABLE"
  /** Blocked — server clock is not a valid finite instant (NaN / ±Infinity). */
  | "INVALID_SERVER_TIMESTAMP"
  /**
   * Blocked — the provided quote timestamp belongs to an unauthorized session/date
   * or is not a valid instant; cannot represent a current-session executable quote.
   */
  | "QUOTE_OUTSIDE_SESSION"
  /**
   * Blocked — quote age exceeds the trade-grade freshness threshold (TRADE_GRADE_MAX_AGE_SEC)
   * or the quote is explicitly not trade-grade (quoteIsTradeGrade === false).
   */
  | "QUOTE_STALE_OR_NOT_TRADE_GRADE"
  /**
   * Blocked — required admission context field is absent (lane, segment,
   * instrument, serverTime, or source). Fail-closed.
   */
  | "TRADE_ADMISSION_CONTEXT_INCOMPLETE"
  // ── Legacy alias (read-only for pre-P0.2 audit rows) ──────────────────────
  /** @deprecated Written by the pre-P0.2 gate only. Use structured codes. */
  | "MARKET_CLOSED";

// ─── Validity buckets ─────────────────────────────────────────────────────────

/** Derived exchange-session-validity bucket for an open or stored position. */
export type EqOpenedSessionValidity =
  | "VALID_SESSION"       // 09:15–15:30 IST, Mon–Fri, non-holiday, calendar verified
  | "OFF_SESSION"         // opened or classified outside the authorized window
  | "SESSION_UNKNOWN"     // status could not be determined (calendar unavailable)
  | "TIMESTAMP_AMBIGUOUS"; // stored timestamp is null, non-finite, or unparseable

/**
 * Strategy automatic-entry cutoff validity.
 *
 * VALID            → server time is inside the session AND before the cutoff.
 * PASSED           → server time is inside the session but past the cutoff.
 * POLICY_UNAVAILABLE → cutoff is required for this source but is null (fail-closed).
 * NOT_APPLICABLE   → cutoff check does not apply (e.g. session is not open, or
 *                    MANUAL source which is owner-directed).
 * UNKNOWN          → historical positions where the original cutoff policy
 *                    cannot be proven from the stored timestamp alone.
 */
export type CutoffPolicyValidity =
  | "VALID"
  | "PASSED"
  | "POLICY_UNAVAILABLE"
  | "NOT_APPLICABLE"
  | "UNKNOWN";

// ─── Segment-aware admission context ─────────────────────────────────────────

export interface TradeAdmissionContext {
  /** Trading lane — determines which calendar and session rules apply. */
  lane: "equity_cash" | "nse_fo" | "bse_fo";
  /** Exchange segment identifier (for diagnostics, e.g. "NSE_EQ", "NSE_FO", "BSE_FO"). */
  segment: string;
  /** Instrument symbol or index name (for diagnostics and context tracing). */
  instrument: string;
  /** Server clock at the time of the open attempt. */
  serverTime: Date;
  /** Source of the open request. MANUAL is owner-directed and not subject to strategy cutoff. */
  source: "AUTO" | "MANUAL" | "SWING_STAGED_APPROVAL";
  /**
   * Strategy automatic-entry cutoff policy.
   *
   * undefined → no cutoff check is required for this call path (exchange-session-only
   *             checks, MANUAL source wrappers, compatibility paths).
   * null      → a cutoff SHOULD be configured but is not → ENTRY_CUTOFF_CONFIG_UNAVAILABLE.
   *             Pass EQUITY_AUTO_ENTRY_CUTOFF (which is null) for equity AUTO/staged.
   * EntryAdmissionCutoffPolicy → check server IST time against the configured cutoff.
   *
   * Ignored when source === "MANUAL" (owner-directed; not subject to strategy cutoff).
   */
  entryCutoffPolicy?: EntryAdmissionCutoffPolicy | null;
  /**
   * The quote's own timestamp (ISO string). When provided, `computeTradeAdmission`
   * classifies it via `getMarketStatusDetail` and fires QUOTE_OUTSIDE_SESSION when
   * the quote is not from an authorized trading session.
   */
  quoteTimestamp?: string | null;
  /**
   * Whether the quote is authoritative / trade-grade.
   * Explicitly false → QUOTE_STALE_OR_NOT_TRADE_GRADE (regardless of age).
   */
  quoteIsTradeGrade?: boolean | null;
  /**
   * Age of the quote in seconds at the time of the open attempt.
   * When provided, `quoteMaxAgeSec` MUST also be supplied — no default is applied.
   * Fires QUOTE_STALE_OR_NOT_TRADE_GRADE when quoteAgeSec > quoteMaxAgeSec.
   */
  quoteAgeSec?: number | null;
  /**
   * Maximum acceptable quote age in seconds for this admission check.
   * REQUIRED when `quoteAgeSec` is supplied — omitting it when age is provided
   * causes `TRADE_ADMISSION_CONTEXT_INCOMPLETE` (fail-closed; no invented default).
   *
   * Use the authoritative per-lane/dataType values from `MODULE_REQUIREMENTS`
   * in `marketData/requirements.ts`:
   *   - fno.indexQuote: 120 s   (requirements.ts:177)
   *   - watchlist.quote: 120 s  (requirements.ts:189)
   *   - portfolio.quote: 120 s  (requirements.ts:192)
   *   - fno.intradayCandles: 900 s (requirements.ts:178)
   *   - fno.optionChain: 300 s  (requirements.ts:180)
   */
  quoteMaxAgeSec?: number | null;
  /**
   * Opt-in strict quote-context enforcement.
   *
   * When `true`, ALL of the following must be present for the gate to proceed:
   * either `quoteIsTradeGrade === true` OR (`quoteAgeSec` + `quoteMaxAgeSec` both finite
   * and age within threshold). If none of the three quote fields are supplied, the
   * gate fails closed with `TRADE_ADMISSION_CONTEXT_INCOMPLETE`.
   *
   * Default `false` (not set): quote fields are optional — the check is skipped when
   * none are supplied. Use `true` for callers whose fill depends on a market quote and
   * whose quote-freshness source is known at admission time.
   *
   * Architectural constraint: for F&O AUTO lanes the option-chain premium is fetched
   * AFTER admission, making pre-admission freshness enforcement structurally unavailable
   * at this gate. Those callers must NOT set `requireQuoteContext: true` until the
   * call-flow is restructured (remaining limitation, tracked separately).
   */
  requireQuoteContext?: boolean;
}

// ─── Admission result ─────────────────────────────────────────────────────────

/** Discriminated admission result returned by `computeTradeAdmission`. */
export type TradeAdmissionResult =
  | {
      allowed: true;
      openedSessionValidity: "VALID_SESSION";
      cutoffPolicyValidity: CutoffPolicyValidity;
      openedAtIst: string;
      calendarVersion: string;
      calendarScope: string;
      timestampConfidence: "HIGH";
    }
  | {
      allowed: false;
      reason: EqSessionAdmissionReason;
      detail: string;
      openedSessionValidity: EqOpenedSessionValidity;
      cutoffPolicyValidity: CutoffPolicyValidity;
      openedAtIst?: string;
      calendarVersion: string;
      calendarScope: string;
      timestampConfidence: "HIGH" | "LOW";
    };

/** @deprecated Use TradeAdmissionResult. Retained for compatibility. */
export type SessionAdmissionResult = TradeAdmissionResult;

// ─── Phase A — Preliminary admission ─────────────────────────────────────────

/**
 * Phase A admission context — session and policy fields only.
 *
 * May be checked before market data is fetched. A preliminary result
 * (PreliminaryAdmissionResult) must NOT authorize a durable insert or fill.
 * Phase B (computeFinalExecutionAdmission) must also pass before any
 * durable open may occur.
 */
export interface PreliminaryAdmissionContext {
  lane: "equity_cash" | "nse_fo" | "bse_fo";
  segment: string;
  instrument: string;
  serverTime: Date;
  source: "AUTO" | "MANUAL" | "SWING_STAGED_APPROVAL";
  entryCutoffPolicy?: EntryAdmissionCutoffPolicy | null;
}

/**
 * Phase A result — marked phase: "PRELIMINARY".
 * The phase discriminant prevents this result from being used where a
 * FinalExecutionAdmissionResult is required at the durable-insert boundary.
 */
export type PreliminaryAdmissionResult =
  | {
      phase: "PRELIMINARY";
      allowed: true;
      openedSessionValidity: "VALID_SESSION";
      cutoffPolicyValidity: CutoffPolicyValidity;
      openedAtIst: string;
      calendarVersion: string;
      calendarScope: string;
      timestampConfidence: "HIGH";
    }
  | {
      phase: "PRELIMINARY";
      allowed: false;
      reason: EqSessionAdmissionReason;
      detail: string;
      openedSessionValidity: EqOpenedSessionValidity;
      cutoffPolicyValidity: CutoffPolicyValidity;
      openedAtIst?: string;
      calendarVersion: string;
      calendarScope: string;
      timestampConfidence: "HIGH" | "LOW";
    };

/**
 * Phase A gate — preliminary session/policy check.
 *
 * May run before any market data is fetched. Checks exchange calendar,
 * server timestamp, entry cutoff policy, and instrument identity.
 *
 * A preliminary result (phase: "PRELIMINARY") must not authorize a durable
 * insert. After Phase A passes, callers should fetch the fill-price quote
 * and then call computeFinalExecutionAdmission (Phase B) immediately before
 * the durable insert.
 */
export function computePreliminaryAdmission(ctx: PreliminaryAdmissionContext): PreliminaryAdmissionResult {
  const base = computeTradeAdmission({ ...ctx });
  if (base.allowed) {
    return {
      phase: "PRELIMINARY",
      allowed: true,
      openedSessionValidity: base.openedSessionValidity,
      cutoffPolicyValidity: base.cutoffPolicyValidity,
      openedAtIst: base.openedAtIst,
      calendarVersion: base.calendarVersion,
      calendarScope: base.calendarScope,
      timestampConfidence: base.timestampConfidence,
    };
  }
  return {
    phase: "PRELIMINARY",
    allowed: false,
    reason: base.reason,
    detail: base.detail,
    openedSessionValidity: base.openedSessionValidity,
    cutoffPolicyValidity: base.cutoffPolicyValidity,
    openedAtIst: base.openedAtIst,
    calendarVersion: base.calendarVersion,
    calendarScope: base.calendarScope,
    timestampConfidence: base.timestampConfidence,
  };
}

// ─── Phase B — Final execution admission ─────────────────────────────────────

/**
 * Authoritative maximum acceptable quote age in seconds for NSE/BSE F&O
 * option-chain/premium fills.
 *
 * Source: MODULE_REQUIREMENTS.fno.optionChain.maxFreshnessSec (requirements.ts:180).
 * F&O Phase B callers must supply quoteMaxAgeSec >= this value — using the
 * more restrictive index-quote policy (120 s) for an option-chain fill is
 * a policy mismatch and causes TRADE_ADMISSION_CONTEXT_INCOMPLETE.
 */
export const FNO_OPTION_CHAIN_MAX_AGE_SEC = 300;

/**
 * Phase B final execution admission context.
 *
 * Must be evaluated after the actual fill-price quote has been fetched and
 * immediately before the durable insert / open callback. All quote fields
 * are required — an absent or invalid field causes TRADE_ADMISSION_CONTEXT_INCOMPLETE.
 *
 * No lane may proceed to a durable open solely on a PreliminaryAdmissionResult.
 */
export interface FinalExecutionAdmissionContext {
  lane: "equity_cash" | "nse_fo" | "bse_fo";
  segment: string;
  instrument: string;
  serverTime: Date;
  source: "AUTO" | "MANUAL" | "SWING_STAGED_APPROVAL";
  entryCutoffPolicy?: EntryAdmissionCutoffPolicy | null;
  /**
   * Human-readable identity of the actual fill-price quote source.
   * Examples: "kite_option_chain", "kite_scanner_ltp", "scanner_kite".
   * Must be non-empty — absent provenance causes TRADE_ADMISSION_CONTEXT_INCOMPLETE.
   */
  quoteProvenance: string;
  /**
   * Whether the fill-price source is authoritative / trade-grade.
   * false → QUOTE_STALE_OR_NOT_TRADE_GRADE regardless of age.
   */
  quoteIsTradeGrade: boolean;
  /**
   * Age of the fill-price quote in seconds at the time of the open attempt.
   * Must be finite — NaN / ±Infinity → TRADE_ADMISSION_CONTEXT_INCOMPLETE.
   */
  quoteAgeSec: number;
  /**
   * Authoritative maximum acceptable age for this fill-price source.
   * Must be a positive finite number from MODULE_REQUIREMENTS.
   * Canonical values:
   *   fno.optionChain: 300 s  (requirements.ts:180) — use for F&O lanes
   *   watchlist.quote: 120 s  (requirements.ts:189) — use for equity MANUAL fills
   * For F&O lanes (nse_fo / bse_fo), must be >= FNO_OPTION_CHAIN_MAX_AGE_SEC (300).
   * Supplying the stricter index-quote policy (120 s) for an option-chain fill is
   * a policy mismatch and causes TRADE_ADMISSION_CONTEXT_INCOMPLETE.
   */
  quoteMaxAgeSec: number;
  /**
   * Optional quote timestamp for session validation.
   * When provided, QUOTE_OUTSIDE_SESSION is returned if the quote is from an
   * unauthorized session time.
   */
  quoteTimestamp?: string | null;
}

/**
 * Phase B result — marked phase: "FINAL_EXECUTION".
 * Only a FinalExecutionAdmissionResult with allowed: true may authorize a
 * durable insert. The phase discriminant prevents PreliminaryAdmissionResult
 * from being accepted at the durable-insert boundary.
 */
export type FinalExecutionAdmissionResult =
  | {
      phase: "FINAL_EXECUTION";
      allowed: true;
      openedSessionValidity: "VALID_SESSION";
      cutoffPolicyValidity: CutoffPolicyValidity;
      openedAtIst: string;
      calendarVersion: string;
      calendarScope: string;
      timestampConfidence: "HIGH";
      quoteProvenance: string;
    }
  | {
      phase: "FINAL_EXECUTION";
      allowed: false;
      reason: EqSessionAdmissionReason;
      detail: string;
      openedSessionValidity: EqOpenedSessionValidity;
      cutoffPolicyValidity: CutoffPolicyValidity;
      openedAtIst?: string;
      calendarVersion: string;
      calendarScope: string;
      timestampConfidence: "HIGH" | "LOW";
      quoteProvenance: string;
    };

/**
 * Phase B gate — final execution admission.
 *
 * Must be called after the actual fill-price quote has been fetched and
 * immediately before the durable insert / open callback. All quote fields
 * are mandatory — absent/invalid fields cause TRADE_ADMISSION_CONTEXT_INCOMPLETE.
 *
 * F&O lane enforcement: for nse_fo / bse_fo, quoteMaxAgeSec must be >=
 * FNO_OPTION_CHAIN_MAX_AGE_SEC (300 s). Using an index-quote policy (120 s)
 * for an option-chain fill is a policy mismatch → TRADE_ADMISSION_CONTEXT_INCOMPLETE.
 *
 * Session and policy are re-evaluated to defend against clock changes or time
 * elapsed since Phase A. Fail-closed on all ambiguous cases.
 *
 * Only a FinalExecutionAdmissionResult with allowed: true may authorize a
 * durable insert. Callers must NOT pass a PreliminaryAdmissionResult here.
 */
export function computeFinalExecutionAdmission(ctx: FinalExecutionAdmissionContext): FinalExecutionAdmissionResult {
  const provenance = ctx.quoteProvenance || "UNKNOWN";

  // ── 1. Mandatory quote field validation ───────────────────────────────────
  if (
    !ctx.quoteProvenance ||
    typeof ctx.quoteIsTradeGrade !== "boolean" ||
    typeof ctx.quoteAgeSec !== "number" || !isFinite(ctx.quoteAgeSec) ||
    typeof ctx.quoteMaxAgeSec !== "number" || !isFinite(ctx.quoteMaxAgeSec) || ctx.quoteMaxAgeSec <= 0
  ) {
    return {
      phase: "FINAL_EXECUTION",
      allowed: false,
      reason: "TRADE_ADMISSION_CONTEXT_INCOMPLETE",
      detail: `Phase B mandatory quote fields absent or invalid — quoteProvenance="${provenance}", quoteIsTradeGrade=${ctx.quoteIsTradeGrade}, quoteAgeSec=${ctx.quoteAgeSec}, quoteMaxAgeSec=${ctx.quoteMaxAgeSec}; instrument=${ctx.instrument}`,
      openedSessionValidity: "TIMESTAMP_AMBIGUOUS",
      cutoffPolicyValidity: "UNKNOWN",
      calendarVersion: CALENDAR_VERSION,
      calendarScope: "NONE",
      timestampConfidence: "LOW",
      quoteProvenance: provenance,
    };
  }

  // ── 2. F&O lane: enforce option-chain policy minimum ──────────────────────
  // Index-quote maxAge (120 s) cannot authorize option-chain/premium fills —
  // quoteMaxAgeSec must be >= FNO_OPTION_CHAIN_MAX_AGE_SEC (300 s).
  if ((ctx.lane === "nse_fo" || ctx.lane === "bse_fo") && ctx.quoteMaxAgeSec < FNO_OPTION_CHAIN_MAX_AGE_SEC) {
    return {
      phase: "FINAL_EXECUTION",
      allowed: false,
      reason: "TRADE_ADMISSION_CONTEXT_INCOMPLETE",
      detail: `F&O final admission requires quoteMaxAgeSec >= ${FNO_OPTION_CHAIN_MAX_AGE_SEC}s (authoritative: MODULE_REQUIREMENTS.fno.optionChain, requirements.ts:180); caller supplied ${ctx.quoteMaxAgeSec}s — this matches an index-quote policy and cannot authorize an option-premium fill; instrument=${ctx.instrument}, quoteProvenance=${provenance}`,
      openedSessionValidity: "TIMESTAMP_AMBIGUOUS",
      cutoffPolicyValidity: "UNKNOWN",
      calendarVersion: CALENDAR_VERSION,
      calendarScope: ctx.lane === "bse_fo" ? "BSE_FO_UNVERIFIED" : "NSE_CURATED_2026",
      timestampConfidence: "HIGH",
      quoteProvenance: provenance,
    };
  }

  // ── 3. Delegate session/policy + quote freshness to canonical gate ─────────
  const base = computeTradeAdmission({
    lane: ctx.lane,
    segment: ctx.segment,
    instrument: ctx.instrument,
    serverTime: ctx.serverTime,
    source: ctx.source,
    entryCutoffPolicy: ctx.entryCutoffPolicy,
    quoteTimestamp: ctx.quoteTimestamp,
    quoteIsTradeGrade: ctx.quoteIsTradeGrade,
    quoteAgeSec: ctx.quoteAgeSec,
    quoteMaxAgeSec: ctx.quoteMaxAgeSec,
  });

  if (base.allowed) {
    return {
      phase: "FINAL_EXECUTION",
      allowed: true,
      openedSessionValidity: base.openedSessionValidity,
      cutoffPolicyValidity: base.cutoffPolicyValidity,
      openedAtIst: base.openedAtIst,
      calendarVersion: base.calendarVersion,
      calendarScope: base.calendarScope,
      timestampConfidence: base.timestampConfidence,
      quoteProvenance: provenance,
    };
  }

  return {
    phase: "FINAL_EXECUTION",
    allowed: false,
    reason: base.reason,
    detail: base.detail,
    openedSessionValidity: base.openedSessionValidity,
    cutoffPolicyValidity: base.cutoffPolicyValidity,
    openedAtIst: base.openedAtIst,
    calendarVersion: base.calendarVersion,
    calendarScope: base.calendarScope,
    timestampConfidence: base.timestampConfidence,
    quoteProvenance: provenance,
  };
}

// ─── Canonical segment-aware admission gate ───────────────────────────────────

/**
 * Canonical segment-aware trade admission gate.
 *
 * All durable paper-trade writers (openPaperEquityTrade, openPaperTrade) MUST
 * call this function. `computeEquitySessionAdmission` is a compatibility wrapper
 * that delegates here for exchange-session-only checks.
 *
 * Every required reason code is wired through a real decision branch:
 *
 *   TRADE_ADMISSION_CONTEXT_INCOMPLETE → lane/segment/instrument/serverTime/source missing
 *   INVALID_SERVER_TIMESTAMP          → serverTime is NaN / ±Infinity
 *   CALENDAR_UNAVAILABLE              → bse_fo + !BSE_CALENDAR_VERIFIED, or msd.reason UNKNOWN
 *   MARKET_CLOSED_WEEKEND             → msd.reason === "WEEKEND"
 *   MARKET_CLOSED_HOLIDAY             → msd.reason === "HOLIDAY"
 *   BEFORE_MARKET_SESSION             → msd.reason === "BEFORE_OPEN"
 *   SPECIAL_SESSION_NOT_AUTHORIZED    → msd.reason === "PRE_OPEN"
 *   AFTER_MARKET_SESSION              → msd.reason === "AFTER_CLOSE"
 *   ENTRY_CUTOFF_CONFIG_UNAVAILABLE   → source !== MANUAL && entryCutoffPolicy === null
 *   ENTRY_CUTOFF_PASSED               → source !== MANUAL && policy set && istMin >= policy.istMinOfDay
 *   QUOTE_OUTSIDE_SESSION             → quoteTimestamp provided && quote session is not OPEN
 *   QUOTE_STALE_OR_NOT_TRADE_GRADE    → quoteIsTradeGrade===false || quoteAgeSec > threshold
 *
 * Unknown/default cases fail closed. MANUAL source skips the strategy cutoff check.
 */
export function computeTradeAdmission(ctx: TradeAdmissionContext): TradeAdmissionResult {
  // ── 1. Context completeness ─────────────────────────────────────────────────
  // All mandatory fields must be present and non-empty. An empty string lane/
  // segment/instrument or a missing source is an incomplete context.
  if (!ctx.lane || !ctx.segment || !ctx.instrument || !ctx.serverTime || !ctx.source) {
    return {
      allowed: false,
      reason: "TRADE_ADMISSION_CONTEXT_INCOMPLETE",
      detail: "One or more mandatory context fields are absent (lane/segment/instrument/serverTime/source)",
      openedSessionValidity: "TIMESTAMP_AMBIGUOUS",
      cutoffPolicyValidity: "UNKNOWN",
      calendarVersion: CALENDAR_VERSION,
      calendarScope: "NONE",
      timestampConfidence: "LOW",
    };
  }

  // ── 2. Server timestamp sanity ──────────────────────────────────────────────
  if (!isFinite(ctx.serverTime.getTime())) {
    return {
      allowed: false,
      reason: "INVALID_SERVER_TIMESTAMP",
      detail: "Server clock returned a non-finite timestamp (NaN or ±Infinity) — cannot admit",
      openedSessionValidity: "TIMESTAMP_AMBIGUOUS",
      cutoffPolicyValidity: "UNKNOWN",
      calendarVersion: CALENDAR_VERSION,
      calendarScope: ctx.lane === "bse_fo" ? "BSE_FO_UNVERIFIED" : "NSE_CURATED_2026",
      timestampConfidence: "LOW",
    };
  }

  // ── 3. BSE F&O calendar guard ───────────────────────────────────────────────
  // The current calendar source (NSE_CURATED_2026) is explicitly NSE-labeled.
  // We cannot apply it to BSE instruments without independent BSE verification.
  // When BSE_CALENDAR_VERIFIED is false, fail closed for all bse_fo instruments.
  if (ctx.lane === "bse_fo" && !BSE_CALENDAR_VERIFIED) {
    return {
      allowed: false,
      reason: "CALENDAR_UNAVAILABLE",
      detail: `BSE F&O calendar not independently verified (BSE_CALENDAR_VERIFIED=false); segment=${ctx.segment} instrument=${ctx.instrument}. Set BSE_CALENDAR_VERIFIED=true when a separately-sourced BSE holiday list is added.`,
      openedSessionValidity: "SESSION_UNKNOWN",
      cutoffPolicyValidity: "UNKNOWN",
      calendarVersion: CALENDAR_VERSION,
      calendarScope: "BSE_FO_UNVERIFIED",
      timestampConfidence: "HIGH",
    };
  }

  // ── 4. Exchange session check (NSE calendar for equity_cash and nse_fo) ─────
  const calendarScope = "NSE_CURATED_2026";
  const msd = getMarketStatusDetail(ctx.serverTime);

  let openedSessionValidity: EqOpenedSessionValidity;
  let sessionRejectReason: EqSessionAdmissionReason | null = null;
  let sessionRejectDetail = "";
  const exchange = ctx.lane === "bse_fo" ? "BSE" : "NSE";

  switch (msd.reason) {
    case "OPEN":
      openedSessionValidity = "VALID_SESSION";
      break;
    case "WEEKEND":
      openedSessionValidity = "OFF_SESSION";
      sessionRejectReason = "MARKET_CLOSED_WEEKEND";
      sessionRejectDetail = `Market closed — weekend (server IST: ${msd.serverIst})`;
      break;
    case "HOLIDAY":
      openedSessionValidity = "OFF_SESSION";
      sessionRejectReason = "MARKET_CLOSED_HOLIDAY";
      sessionRejectDetail = `Market closed — ${exchange} trading holiday (server IST: ${msd.serverIst})`;
      break;
    case "BEFORE_OPEN":
      openedSessionValidity = "OFF_SESSION";
      sessionRejectReason = "BEFORE_MARKET_SESSION";
      sessionRejectDetail = `Before ${exchange} session — market opens at 09:15 IST (server IST: ${msd.serverIst})`;
      break;
    case "PRE_OPEN":
      openedSessionValidity = "OFF_SESSION";
      sessionRejectReason = "SPECIAL_SESSION_NOT_AUTHORIZED";
      sessionRejectDetail = `${exchange} pre-open auction (09:00–09:15 IST) — paper opens not authorized (server IST: ${msd.serverIst})`;
      break;
    case "AFTER_CLOSE":
      openedSessionValidity = "OFF_SESSION";
      sessionRejectReason = "AFTER_MARKET_SESSION";
      sessionRejectDetail = `${exchange} session closed at 15:30 IST (server IST: ${msd.serverIst})`;
      break;
    case "UNKNOWN":
    default:
      return {
        allowed: false,
        reason: "CALENDAR_UNAVAILABLE",
        detail: `Market session status could not be determined (server IST: ${msd.serverIst})`,
        openedSessionValidity: "SESSION_UNKNOWN",
        cutoffPolicyValidity: "UNKNOWN",
        openedAtIst: msd.serverIst,
        calendarVersion: CALENDAR_VERSION,
        calendarScope,
        timestampConfidence: "LOW",
      };
  }

  // If exchange session is not open, reject immediately. Cutoff check is not
  // applicable when the exchange itself is closed.
  if (openedSessionValidity !== "VALID_SESSION") {
    return {
      allowed: false,
      reason: sessionRejectReason!,
      detail: sessionRejectDetail,
      openedSessionValidity,
      cutoffPolicyValidity: "NOT_APPLICABLE",
      openedAtIst: msd.serverIst,
      calendarVersion: CALENDAR_VERSION,
      calendarScope,
      timestampConfidence: "HIGH",
    };
  }

  // ── 5. Strategy entry cutoff check ─────────────────────────────────────────
  // Applies only to non-MANUAL sources (AUTO, SWING_STAGED_APPROVAL).
  // MANUAL source is owner-directed and not subject to a strategy entry cutoff,
  // though it must still fill within a valid exchange session (enforced above).
  let cutoffPolicyValidity: CutoffPolicyValidity = "NOT_APPLICABLE";

  if (ctx.source !== "MANUAL") {
    if (ctx.entryCutoffPolicy === null) {
      // Explicitly required but not configured — fail closed.
      // This fires for all equity AUTO/SWING_STAGED_APPROVAL opens because
      // EQUITY_AUTO_ENTRY_CUTOFF is null (no approved strategy cutoff exists yet).
      return {
        allowed: false,
        reason: "ENTRY_CUTOFF_CONFIG_UNAVAILABLE",
        detail: `Automatic-entry cutoff policy is required for source=${ctx.source} but is not configured; instrument=${ctx.instrument}. Set EQUITY_AUTO_ENTRY_CUTOFF or pass an explicit EntryAdmissionCutoffPolicy.`,
        openedSessionValidity: "VALID_SESSION",
        cutoffPolicyValidity: "POLICY_UNAVAILABLE",
        openedAtIst: msd.serverIst,
        calendarVersion: CALENDAR_VERSION,
        calendarScope,
        timestampConfidence: "HIGH",
      };
    }

    if (ctx.entryCutoffPolicy !== undefined) {
      // Check against the configured cutoff. Blocked when server IST time is at
      // or past the cutoff's istMinOfDay (same semantics as the F&O BASELINE gate).
      const ist = new Date(ctx.serverTime.getTime() + 5.5 * 60 * 60 * 1000);
      const istMin = ist.getUTCHours() * 60 + ist.getUTCMinutes();
      if (istMin >= ctx.entryCutoffPolicy.istMinOfDay) {
        return {
          allowed: false,
          reason: "ENTRY_CUTOFF_PASSED",
          detail: `Strategy entry cutoff passed — server IST ${msd.serverIst} is at or past ${ctx.entryCutoffPolicy.policySource} cutoff (${ctx.entryCutoffPolicy.istMinOfDay} min from midnight IST = ${Math.floor(ctx.entryCutoffPolicy.istMinOfDay / 60)}:${String(ctx.entryCutoffPolicy.istMinOfDay % 60).padStart(2, "0")} IST)`,
          openedSessionValidity: "VALID_SESSION",
          cutoffPolicyValidity: "PASSED",
          openedAtIst: msd.serverIst,
          calendarVersion: CALENDAR_VERSION,
          calendarScope,
          timestampConfidence: "HIGH",
        };
      }
      cutoffPolicyValidity = "VALID";
    }
    // entryCutoffPolicy === undefined → no cutoff check required for this call
    // (exchange-session-only paths, compatibility wrappers).
  }
  // MANUAL: cutoff check skipped. cutoffPolicyValidity remains "NOT_APPLICABLE".

  // ── 6. Quote session check ──────────────────────────────────────────────────
  // When a quote timestamp is provided, verify it belongs to an authorized session.
  // Prevents stale pre-market or after-hours quotes from appearing as current.
  if (ctx.quoteTimestamp != null) {
    const qd = new Date(ctx.quoteTimestamp);
    if (!isFinite(qd.getTime())) {
      return {
        allowed: false,
        reason: "QUOTE_OUTSIDE_SESSION",
        detail: `Quote timestamp is not a valid instant: "${ctx.quoteTimestamp}"`,
        openedSessionValidity: "VALID_SESSION",
        cutoffPolicyValidity,
        openedAtIst: msd.serverIst,
        calendarVersion: CALENDAR_VERSION,
        calendarScope,
        timestampConfidence: "HIGH",
      };
    }
    const qMsd = getMarketStatusDetail(qd);
    if (qMsd.reason !== "OPEN") {
      return {
        allowed: false,
        reason: "QUOTE_OUTSIDE_SESSION",
        detail: `Quote timestamp (${ctx.quoteTimestamp}) maps to a closed session (${qMsd.reason}; quote IST: ${qMsd.serverIst}); this quote cannot represent a current-session executable price`,
        openedSessionValidity: "VALID_SESSION",
        cutoffPolicyValidity,
        openedAtIst: msd.serverIst,
        calendarVersion: CALENDAR_VERSION,
        calendarScope,
        timestampConfidence: "HIGH",
      };
    }
  }

  // ── 7. Quote freshness / trade-grade check ──────────────────────────────────
  // No default threshold is applied here. The caller MUST supply quoteMaxAgeSec
  // from the authoritative per-lane values in MODULE_REQUIREMENTS
  // (marketData/requirements.ts). Providing quoteAgeSec without quoteMaxAgeSec
  // fails closed with TRADE_ADMISSION_CONTEXT_INCOMPLETE — an undecidable
  // freshness check is treated as a mandatory context gap.

  // ── 7a. Opt-in strict quote-context enforcement (requireQuoteContext) ────────
  // When ctx.requireQuoteContext === true, at least one of the three quote fields
  // must be present for the gate to proceed. If none are supplied, fail closed.
  // This prevents a silent bypass for callers that explicitly declare their fill
  // depends on a market quote (and whose quote source is known at admission time).
  //
  // Architectural note: F&O AUTO callers do NOT set requireQuoteContext=true because
  // the option-chain premium is fetched AFTER admission; restructuring that call-flow
  // is a remaining limitation. See TradeAdmissionContext.requireQuoteContext JSDoc.
  if (ctx.requireQuoteContext === true) {
    const hasAnyQuoteEvidence =
      ctx.quoteIsTradeGrade != null ||
      (ctx.quoteAgeSec != null && isFinite(ctx.quoteAgeSec)) ||
      (ctx.quoteMaxAgeSec != null && isFinite(ctx.quoteMaxAgeSec) && ctx.quoteMaxAgeSec > 0);
    if (!hasAnyQuoteEvidence) {
      return {
        allowed: false,
        reason: "TRADE_ADMISSION_CONTEXT_INCOMPLETE",
        detail: `requireQuoteContext=true but no quote evidence supplied (quoteIsTradeGrade, quoteAgeSec, quoteMaxAgeSec are all absent) — caller must provide quote freshness/trade-grade evidence from MODULE_REQUIREMENTS (marketData/requirements.ts); instrument=${ctx.instrument}`,
        openedSessionValidity: "VALID_SESSION",
        cutoffPolicyValidity,
        openedAtIst: msd.serverIst,
        calendarVersion: CALENDAR_VERSION,
        calendarScope,
        timestampConfidence: "HIGH",
      };
    }
  }

  const quoteAgeProvided = ctx.quoteAgeSec != null && isFinite(ctx.quoteAgeSec);
  const maxAgeProvided =
    ctx.quoteMaxAgeSec != null && isFinite(ctx.quoteMaxAgeSec) && ctx.quoteMaxAgeSec > 0;

  if (quoteAgeProvided && !maxAgeProvided) {
    return {
      allowed: false,
      reason: "TRADE_ADMISSION_CONTEXT_INCOMPLETE",
      detail: `quoteAgeSec (${ctx.quoteAgeSec}s) supplied without a valid quoteMaxAgeSec — caller must provide the authoritative freshness threshold from MODULE_REQUIREMENTS (marketData/requirements.ts); instrument=${ctx.instrument}`,
      openedSessionValidity: "VALID_SESSION",
      cutoffPolicyValidity,
      openedAtIst: msd.serverIst,
      calendarVersion: CALENDAR_VERSION,
      calendarScope,
      timestampConfidence: "HIGH",
    };
  }

  const quoteNotGrade = ctx.quoteIsTradeGrade === false;
  const quoteAgeStale =
    quoteAgeProvided &&
    maxAgeProvided &&
    ctx.quoteAgeSec! > ctx.quoteMaxAgeSec!;

  if (quoteNotGrade || quoteAgeStale) {
    const why = quoteNotGrade
      ? "quote is not trade-grade (quoteIsTradeGrade=false)"
      : `quote is stale (${ctx.quoteAgeSec}s > ${ctx.quoteMaxAgeSec}s threshold from MODULE_REQUIREMENTS)`;
    return {
      allowed: false,
      reason: "QUOTE_STALE_OR_NOT_TRADE_GRADE",
      detail: `Quote rejected — ${why}; instrument=${ctx.instrument}`,
      openedSessionValidity: "VALID_SESSION",
      cutoffPolicyValidity,
      openedAtIst: msd.serverIst,
      calendarVersion: CALENDAR_VERSION,
      calendarScope,
      timestampConfidence: "HIGH",
    };
  }

  // ── 8. Allowed ──────────────────────────────────────────────────────────────
  return {
    allowed: true,
    openedSessionValidity: "VALID_SESSION",
    cutoffPolicyValidity,
    openedAtIst: msd.serverIst,
    calendarVersion: CALENDAR_VERSION,
    calendarScope,
    timestampConfidence: "HIGH",
  };
}

// ─── Compatibility wrapper ────────────────────────────────────────────────────

/**
 * Compatibility wrapper — exchange-session-only check.
 *
 * Delegates to `computeTradeAdmission` with `lane: "equity_cash"`, `source: "MANUAL"`
 * (which skips the strategy cutoff check), and `entryCutoffPolicy: undefined`
 * (no cutoff requirement). Use this ONLY for exchange-session-only checks where
 * no source context or cutoff policy is relevant (e.g. tick belt-and-braces
 * guard that sits outside the per-signal path).
 *
 * @deprecated Prefer `computeTradeAdmission(ctx)` with explicit source and
 * cutoff context wherever the source is known.
 */
export function computeEquitySessionAdmission(now: Date): TradeAdmissionResult {
  return computeTradeAdmission({
    lane: "equity_cash",
    segment: "NSE_EQ",
    instrument: "EQUITY_SESSION_CHECK",
    serverTime: now,
    source: "MANUAL",           // MANUAL: skips strategy cutoff check
    entryCutoffPolicy: undefined, // exchange-session-only; no cutoff requirement
  });
}

// ─── Stored position session info ─────────────────────────────────────────────

/**
 * Backend-derived session provenance augmented onto each open position by
 * `GET /paper/positions/eq`. Consumed by the frontend for badge rendering.
 */
export interface StoredPositionSessionInfo {
  /** Exchange-session validity of the stored position's openedAt timestamp. */
  openedSessionValidity: EqOpenedSessionValidity;
  /** Structured reason code when openedSessionValidity is not VALID_SESSION. Null for VALID_SESSION. */
  openedSessionReason: EqSessionAdmissionReason | null;
  /** Human-readable IST string (HH:MM DD-Mon-YYYY). Null when timestamp is ambiguous. */
  openedAtIst: string | null;
  /** Version of the NSE holiday calendar used for classification. */
  calendarVersion: string;
  /** Calendar scope used (e.g. "NSE_CURATED_2026"). */
  calendarScope: string;
  /**
   * Timestamp confidence level.
   * HIGH — column is timestamptz; driver deserializes as UTC-anchored Date; semantics are unambiguous.
   * LOW  — timestamp is null, non-finite, or unparseable.
   */
  timestampConfidence: "HIGH" | "LOW";
  /**
   * Strategy automatic-entry cutoff policy validity for this stored position.
   * Always UNKNOWN for historical positions — the original cutoff policy applicable
   * at the time of the open cannot be proven from the stored timestamp alone.
   *
   * Two separate facts for ABB (2026-06-29 15:12:03 IST, Mon):
   *   openedSessionValidity  = VALID_SESSION (15:12 is within 09:15–15:30 IST)
   *   cutoffPolicyValidity   = UNKNOWN       (no historical cutoff policy to verify against)
   */
  cutoffPolicyValidity: CutoffPolicyValidity;
}

/**
 * Classify a stored position's `openedAt` ISO timestamp for display.
 *
 * Pure read-only forensics — never blocks or alters any open.
 *
 * Timestamp confidence proof:
 *   `paper_trade_eq.opened_at` is `timestamptz` (Drizzle `timestamp(..., { withTimezone: true })`,
 *   lib/db/src/schema/paperTrading.ts:325). PostgreSQL stores this as UTC-anchored.
 *   The pg driver deserializes it as a `Date`. `.toISOString()` on a valid `Date` is
 *   timezone-unambiguous. `timestampConfidence: "HIGH"` is provably correct for
 *   values where `isFinite(d.getTime())` is true.
 *
 * cutoffPolicyValidity:
 *   Always UNKNOWN — the original cutoff policy cannot be proven from the stored timestamp.
 *   ABB (2026-06-29 15:12:03 IST): openedSessionValidity=VALID_SESSION, cutoffPolicyValidity=UNKNOWN.
 */
export function classifyStoredTimestamp(
  iso: string | null | undefined,
): StoredPositionSessionInfo {
  if (!iso) {
    return {
      openedSessionValidity: "TIMESTAMP_AMBIGUOUS",
      openedSessionReason: "INVALID_SERVER_TIMESTAMP",
      openedAtIst: null,
      calendarVersion: CALENDAR_VERSION,
      calendarScope: "NONE",
      timestampConfidence: "LOW",
      cutoffPolicyValidity: "UNKNOWN",
    };
  }
  const d = new Date(iso);
  if (!isFinite(d.getTime())) {
    return {
      openedSessionValidity: "TIMESTAMP_AMBIGUOUS",
      openedSessionReason: "INVALID_SERVER_TIMESTAMP",
      openedAtIst: null,
      calendarVersion: CALENDAR_VERSION,
      calendarScope: "NONE",
      timestampConfidence: "LOW",
      cutoffPolicyValidity: "UNKNOWN",
    };
  }

  // Exchange-session classification only. Source is irrelevant for forensics.
  // cutoffPolicyValidity is always UNKNOWN (historical policy not provable).
  const result = computeTradeAdmission({
    lane: "equity_cash",
    segment: "NSE_EQ",
    instrument: "STORED_POSITION",
    serverTime: d,
    source: "MANUAL",           // skips cutoff check
    entryCutoffPolicy: undefined, // no cutoff requirement
  });

  if (result.allowed) {
    return {
      openedSessionValidity: "VALID_SESSION",
      openedSessionReason: null,
      openedAtIst: result.openedAtIst,
      calendarVersion: result.calendarVersion,
      calendarScope: result.calendarScope,
      timestampConfidence: "HIGH",
      cutoffPolicyValidity: "UNKNOWN",
    };
  }

  return {
    openedSessionValidity: result.openedSessionValidity,
    openedSessionReason: result.reason,
    openedAtIst: result.openedAtIst ?? null,
    calendarVersion: result.calendarVersion,
    calendarScope: result.calendarScope,
    timestampConfidence: result.timestampConfidence,
    cutoffPolicyValidity: "UNKNOWN",
  };
}
