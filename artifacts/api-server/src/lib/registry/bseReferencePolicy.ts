/**
 * PHASE 0.6 — OWNER-APPROVED BSE REFERENCE FRESHNESS POLICY.
 *
 * Supersedes the placeholder `OWNER_AUTHORIZATION_REQUIRED` stance. The owner
 * approved an event-based policy rather than an hour threshold, which is the
 * honest shape for BSE: its List of Scrips is a continuously-maintained
 * endpoint with no publication timestamp, so "how many hours old" is not a
 * question the source can answer. What CAN be answered is:
 *
 *   1. was the List retrieved during the current IST calendar day, and
 *   2. does the classification reconcile with the newest official BSE UDiFF
 *      representing the LATEST COMPLETED trading session?
 *
 * DELIBERATELY NO NEW HOUR THRESHOLD IS INTRODUCED. Authority is decided by
 * calendar-day identity and completed-session identity only.
 *
 * This module is PURE: no I/O, no clock, no provider call, no DB. Every input
 * — including "what day is it" and "what was the last completed session" — is
 * supplied by the caller, so an unknown trading calendar is representable and
 * therefore fails closed instead of being silently guessed.
 *
 * SCOPE: this policy authorizes REFERENCE IDENTITY AND CLASSIFICATION ONLY.
 * It never makes a quote LIVE and never implies a subscription exists.
 */

import type { SourceValidationResult } from "./officialSources";

/** IST is UTC+5:30 year-round; India observes no daylight saving. */
export const IST_OFFSET_MS = 5 * 3600_000 + 30 * 60_000;

/** Calendar date in IST as `YYYY-MM-DD`. */
export function istDateString(epochMs: number): string {
  if (!Number.isFinite(epochMs)) return "INVALID";
  return new Date(epochMs + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * A REAL calendar date in `YYYY-MM-DD` form.
 *
 * Shape validation alone is not enough: `2026-02-31` matches the pattern, is
 * lexically ordered like any other February date, and would therefore slide
 * through every `<`/`>` comparison in this module. Rule 6 requires an invalid
 * source date to fail closed, so the date must round-trip through the calendar.
 */
export function isRealIstDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(t)) return false;
  return new Date(t).toISOString().slice(0, 10) === value;
}

/** Reference-authority states required by the owner policy. */
export type BseReferenceAuthorityState =
  | "CURRENT_AUTHORITATIVE"
  | "LAST_KNOWN"
  | "STALE"
  | "INVALID"
  | "UNAVAILABLE";

export type TradingCalendarDayKind = "TRADING_DAY" | "WEEKEND" | "EXCHANGE_HOLIDAY";

/**
 * The trading calendar as known to the caller.
 *
 * `known: false` is a first-class state. The repo maintains no NSE/BSE holiday
 * list (`fnoTradingDays.ts` is Mon–Fri only and says so), so the calendar is
 * frequently NOT known. Representing that honestly is what makes rule 6's
 * "unknown trading calendar must fail closed" enforceable rather than
 * aspirational.
 */
export interface TradingCalendarVerdict {
  readonly known: boolean;
  readonly dayKind: TradingCalendarDayKind | null;
  /** IST `YYYY-MM-DD` of the most recent COMPLETED BSE session. */
  readonly latestCompletedSessionDate: string | null;
}

export const UNKNOWN_TRADING_CALENDAR: TradingCalendarVerdict = Object.freeze({
  known: false,
  dayKind: null,
  latestCompletedSessionDate: null,
});

/** Outcome of attempting to retrieve the current-day BSE List of Scrips. */
export type BseListRetrieval =
  | {
      readonly outcome: "RETRIEVED";
      readonly retrievedAtMs: number;
      readonly validationResult: SourceValidationResult;
      readonly contentHash: string;
    }
  | { readonly outcome: "RETRIEVAL_FAILED"; readonly failureReason: string };

/** The official BSE UDiFF / bhavcopy file for a completed session. */
export interface BseUdiffDescriptor {
  /** IST `YYYY-MM-DD` trading date the file represents. */
  readonly tradingDate: string;
  /** False for a partial/in-progress session file. */
  readonly sessionCompleted: boolean;
  readonly validationResult: SourceValidationResult;
  readonly contentHash: string;
  readonly retrievedAtMs: number;
}

export interface BseReferenceAuthorityInput {
  readonly nowMs: number;
  readonly list: BseListRetrieval;
  readonly udiff: BseUdiffDescriptor | null;
  readonly calendar: TradingCalendarVerdict;
  readonly hasPriorAcceptedGeneration: boolean;
  /** False when identity/classification reconciliation did not close. */
  readonly reconciliationClosed: boolean;
}

export interface BseReferenceAuthorityResult {
  readonly state: BseReferenceAuthorityState;
  /** ONLY true for CURRENT_AUTHORITATIVE. Rules 4 and 7 depend on this. */
  readonly mayAuthorizeNewGeneration: boolean;
  /** Completed session the classification is reconciled to (rule 8). */
  readonly effectiveTradingDate: string | null;
  readonly listRetrievedAt: string | null;
  readonly listContentHash: string | null;
  readonly udiffTradingDate: string | null;
  readonly udiffContentHash: string | null;
  readonly evaluatedIstDate: string;
  readonly calendarKnown: boolean;
  readonly dayKind: TradingCalendarDayKind | null;
  readonly reasons: readonly string[];
}

const POLICY_ID = "BSE_CURRENT_DAY_LIST_PLUS_LATEST_COMPLETED_SESSION_UDIFF";
export const BSE_REFERENCE_POLICY_ID = POLICY_ID;
export const BSE_REFERENCE_POLICY_APPROVAL = "OWNER_APPROVED" as const;

/**
 * Every result this module issues, by object identity.
 *
 * `mayAuthorizeNewGeneration` is a boolean on a plain object, so a caller could
 * hand-build `{ state: "CURRENT_AUTHORITATIVE", mayAuthorizeNewGeneration: true }`
 * and mint an accepted manifest without any source ever being evaluated.
 * `readonly` is a compile-time annotation and proves nothing at runtime, so the
 * only way to know a verdict came from the policy is to remember issuing it.
 *
 * A WeakSet is deliberate: it proves provenance IN-PROCESS, which is exactly
 * the scope of the build-time gate. It cannot survive serialization, and it is
 * not asked to — a manifest read back from storage is re-validated by binding
 * the recorded source hashes to the manifest's own source provenance.
 */
const ISSUED_AUTHORITIES = new WeakSet<BseReferenceAuthorityResult>();

/** True only for a verdict actually produced by `evaluateBseReferenceAuthority`. */
export function isPolicyIssuedAuthority(value: BseReferenceAuthorityResult): boolean {
  return ISSUED_AUTHORITIES.has(value);
}

function issue(result: BseReferenceAuthorityResult): BseReferenceAuthorityResult {
  const frozen = Object.freeze(result);
  ISSUED_AUTHORITIES.add(frozen);
  return frozen;
}

function deny(
  state: BseReferenceAuthorityState,
  reasons: readonly string[],
  input: BseReferenceAuthorityInput,
): BseReferenceAuthorityResult {
  const list = input.list;
  return issue({
    state,
    mayAuthorizeNewGeneration: false,
    effectiveTradingDate: null,
    listRetrievedAt: list.outcome === "RETRIEVED" ? new Date(list.retrievedAtMs).toISOString() : null,
    listContentHash: list.outcome === "RETRIEVED" ? list.contentHash : null,
    udiffTradingDate: input.udiff?.tradingDate ?? null,
    udiffContentHash: input.udiff?.contentHash ?? null,
    evaluatedIstDate: istDateString(input.nowMs),
    calendarKnown: input.calendar.known,
    dayKind: input.calendar.dayKind,
    reasons: Object.freeze([...reasons]),
  });
}

/**
 * Evaluate BSE reference authority. Fail-closed by construction: every exit
 * except the final one denies authorization.
 */
export function evaluateBseReferenceAuthority(
  input: BseReferenceAuthorityInput,
): BseReferenceAuthorityResult {
  const { list, udiff, calendar, hasPriorAcceptedGeneration: hasPrior } = input;
  const today = istDateString(input.nowMs);

  if (today === "INVALID") {
    return deny("INVALID", ["evaluation clock is not a finite instant"], input);
  }

  // RULE 4 — current List could not be retrieved. The previous accepted
  // registry may still be SERVED, but it can never authorize a new universe.
  if (list.outcome === "RETRIEVAL_FAILED") {
    return deny(
      hasPrior ? "LAST_KNOWN" : "UNAVAILABLE",
      [`current-day BSE List of Scrips retrieval failed: ${list.failureReason}`],
      input,
    );
  }

  // RULE 6 — malformed body / row floor breach / empty response.
  if (list.validationResult !== "ACCEPTED") {
    return deny("INVALID", [`BSE List of Scrips is ${list.validationResult}`], input);
  }

  // RULE 1 — must have been retrieved during the CURRENT IST calendar day.
  const listDay = istDateString(list.retrievedAtMs);
  if (listDay !== today) {
    return deny(
      hasPrior ? "LAST_KNOWN" : "STALE",
      [`BSE List of Scrips was retrieved on IST ${listDay}, not the current IST day ${today}`],
      input,
    );
  }

  // RULE 6 — an unknown trading calendar cannot be guessed. Without it there is
  // no way to know which session is the latest completed one, so rule 2 is
  // unevaluable and the only honest answer is to refuse.
  if (!calendar.known || calendar.latestCompletedSessionDate === null) {
    return deny("INVALID", ["trading calendar unknown: latest completed BSE session cannot be determined"], input);
  }
  const latest = calendar.latestCompletedSessionDate;
  // RULE 6 — an unreal completed-session date (e.g. 2026-02-31) would compare
  // lexically like a real one and silently anchor every later check.
  if (!isRealIstDate(latest)) {
    return deny("INVALID", [`latest completed session date "${latest}" is not a real calendar date`], input);
  }
  if (latest > today) {
    return deny("INVALID", [`latest completed session ${latest} is in the future (IST today ${today})`], input);
  }

  // RULE 2 — classification must reconcile against the official UDiFF.
  if (udiff === null) {
    return deny(
      hasPrior ? "LAST_KNOWN" : "UNAVAILABLE",
      ["no official BSE UDiFF available for the latest completed session"],
      input,
    );
  }
  if (udiff.validationResult !== "ACCEPTED") {
    return deny("INVALID", [`BSE UDiFF is ${udiff.validationResult}`], input);
  }
  if (!udiff.sessionCompleted) {
    return deny("INVALID", [`BSE UDiFF for ${udiff.tradingDate} does not represent a completed session`], input);
  }
  // Validated BEFORE any ordering comparison: an impossible-but-well-formed
  // date sorts normally, so checking it later would let it reach authority.
  if (!isRealIstDate(udiff.tradingDate)) {
    return deny("INVALID", [`BSE UDiFF trading date "${udiff.tradingDate}" is not a real calendar date`], input);
  }
  // RULE 6 — a file dated in the future is invalid, never merely stale.
  if (udiff.tradingDate > today) {
    return deny("INVALID", [`BSE UDiFF trading date ${udiff.tradingDate} is in the future (IST today ${today})`], input);
  }
  if (udiff.tradingDate > latest) {
    return deny(
      "INVALID",
      [`BSE UDiFF trading date ${udiff.tradingDate} post-dates the latest completed session ${latest}`],
      input,
    );
  }
  // RULE 5 — the latest completed-session file stays valid through pre-open and
  // market hours; it only goes STALE once a NEWER completed session exists.
  if (udiff.tradingDate < latest) {
    return deny(
      "STALE",
      [`a newer completed BSE session (${latest}) exists than the UDiFF held (${udiff.tradingDate})`],
      input,
    );
  }

  // RULE 6 — reconciliation must have closed.
  if (!input.reconciliationClosed) {
    return deny("INVALID", ["BSE identity/classification reconciliation did not close"], input);
  }

  // RULES 1+2+3 satisfied. Note rule 3 needs no branch: a weekend or holiday is
  // authoritative on exactly the same terms, because `latestCompletedSessionDate`
  // already points at the last real session.
  return issue({
    state: "CURRENT_AUTHORITATIVE" as const,
    mayAuthorizeNewGeneration: true,
    effectiveTradingDate: udiff.tradingDate,
    listRetrievedAt: new Date(list.retrievedAtMs).toISOString(),
    listContentHash: list.contentHash,
    udiffTradingDate: udiff.tradingDate,
    udiffContentHash: udiff.contentHash,
    evaluatedIstDate: today,
    calendarKnown: true,
    dayKind: calendar.dayKind,
    reasons: Object.freeze([
      `${POLICY_ID}: current-day List (IST ${today}) reconciled to completed session ${udiff.tradingDate}`,
    ]),
  });
}

/**
 * RULE 7 — a LAST_KNOWN registry may be SERVED but must not add, remove or
 * reclassify securities. Returns the violations; empty means compliant.
 *
 * Not merely advisory: continuity is the whole justification for serving stale
 * reference data, and continuity is exactly what silently mutating membership
 * would destroy.
 */
export function detectLastKnownMutation(
  state: BseReferenceAuthorityState,
  prior: readonly LastKnownMembershipRow[],
  next: readonly LastKnownMembershipRow[],
): readonly string[] {
  if (state !== "LAST_KNOWN") return [];

  const priorById = new Map(prior.map((r) => [r.authoritativeSecurityId, r]));
  const nextById = new Map(next.map((r) => [r.authoritativeSecurityId, r]));
  const violations: string[] = [];

  for (const id of nextById.keys()) {
    if (!priorById.has(id)) violations.push(`LAST_KNOWN registry added security ${id}`);
  }
  for (const [id, p] of priorById) {
    const n = nextById.get(id);
    if (!n) {
      violations.push(`LAST_KNOWN registry removed security ${id}`);
      continue;
    }
    if (n.securityClass !== p.securityClass) {
      violations.push(`LAST_KNOWN registry reclassified ${id}: ${p.securityClass} → ${n.securityClass}`);
    }
    if (n.eligibilityTier !== p.eligibilityTier) {
      violations.push(`LAST_KNOWN registry re-tiered ${id}: ${p.eligibilityTier} → ${n.eligibilityTier}`);
    }
  }
  return violations.sort();
}

export interface LastKnownMembershipRow {
  readonly authoritativeSecurityId: string;
  readonly securityClass: string;
  readonly eligibilityTier: string;
}
