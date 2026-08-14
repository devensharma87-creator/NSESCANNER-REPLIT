/**
 * PHASE 0.8E — SPECIFIC, SAFE CALENDAR BLOCKERS
 *
 * The Phase 0.8E controlled proof refused with a single word:
 * `EXCHANGE_CALENDAR_INVALID`. Four calendar sources had been retrieved, at
 * least two of them had failed, each for a DIFFERENT and individually
 * actionable reason — and every one of those reasons was discarded at the port
 * boundary. The owner was told that the calendar was invalid and nothing else,
 * which is not a diagnosis, and which made the next attempt a guess.
 *
 * This module defines the contract that keeps those reasons. Two requirements
 * pull against each other and both are honoured here:
 *
 *   1. SPECIFIC ENOUGH TO ACT ON. Which source, which stage, what was
 *      observed, what was required.
 *
 *   2. SAFE. No raw HTML, no body fragment, no parser exception text, no
 *      payload, no credential. Only stable codes and bounded numbers.
 *
 * The way both hold at once is that nothing here is ever built from untrusted
 * text. Every code below is a closed enum, and the classifiers map only over
 * strings THIS CODEBASE authored (our own parsers' rejection details). An
 * unrecognised input degrades to a generic code — it never passes through.
 */

/**
 * Where in the calendar pipeline the refusal happened.
 *
 * Kept separate from the code: "truncated" means something very different at
 * asset-retrieval time than it does at parse time, and collapsing the two
 * loses the distinction between a bad download and a bad document.
 */
export type CalendarValidationStage =
  | "TRANSPORT"
  | "ARTEFACT_DISCOVERY"
  | "SOURCE_VALIDATION"
  | "CALENDAR_ASSEMBLY"
  | "SESSION_RESOLUTION";

/**
 * Closed set of specific calendar blockers.
 *
 * Every value distinguishes a failure the owner would respond to differently.
 */
export const CALENDAR_BLOCKER_CODE = Object.freeze({
  /** The request never produced usable bytes (network, timeout, status). */
  RETRIEVAL_FAILED: "RETRIEVAL_FAILED",
  /** A redirect broke policy: off-host, downgraded, looping, over the hop cap. */
  REDIRECT_POLICY_FAILED: "REDIRECT_POLICY_FAILED",
  /** The server answered with a media type this source may not be served as. */
  CONTENT_TYPE_REJECTED: "CONTENT_TYPE_REJECTED",
  /** The declared transport ceiling would have been exceeded. */
  TRANSPORT_BUDGET_EXCEEDED: "TRANSPORT_BUDGET_EXCEEDED",
  /** Bytes served are an application shell, not the artefact. */
  PAGE_SHELL_DETECTED: "PAGE_SHELL_DETECTED",
  /** The shell references no candidate authoritative asset. */
  BUNDLE_REFERENCE_ABSENT: "BUNDLE_REFERENCE_ABSENT",
  /** The shell references several; choosing one would be a guess. */
  BUNDLE_REFERENCE_AMBIGUOUS: "BUNDLE_REFERENCE_AMBIGUOUS",
  /** The discovered asset itself could not be retrieved. */
  BUNDLE_RETRIEVAL_FAILED: "BUNDLE_RETRIEVAL_FAILED",
  /** Retrieved artefact is below its size floor — truncated, not small. */
  ARTEFACT_TRUNCATED_BELOW_FLOOR: "ARTEFACT_TRUNCATED_BELOW_FLOOR",
  /** Retrieved artefact exceeded the evidence size bound. */
  ARTEFACT_EXCEEDS_SIZE_BOUND: "ARTEFACT_EXCEEDS_SIZE_BOUND",
  /** Intact bytes, but not the artefact the contract names. */
  ARTEFACT_IDENTITY_ANCHOR_ABSENT: "ARTEFACT_IDENTITY_ANCHOR_ABSENT",
  /** The required table, caption or section is not present in the document. */
  TABLE_OR_SECTION_MISSING: "TABLE_OR_SECTION_MISSING",
  /** The document contradicts itself (row numbering, weekday, duplicates). */
  PARSER_CONTRADICTION: "PARSER_CONTRADICTION",
  /** Session timings could not be established authoritatively. */
  TIMING_NOT_AUTHORITATIVE: "TIMING_NOT_AUTHORITATIVE",
  /** Two accepted sources disagree, or no accepted annual calendar exists. */
  CALENDAR_SOURCE_DISAGREEMENT: "CALENDAR_SOURCE_DISAGREEMENT",
  /** The calendar built, but the latest completed session is not derivable. */
  LATEST_SESSION_UNRESOLVED: "LATEST_SESSION_UNRESOLVED",
  /** Recognised failure with no more specific mapping. Never a default pass. */
  UNCLASSIFIED_CALENDAR_BLOCKER: "UNCLASSIFIED_CALENDAR_BLOCKER",
} as const);

export type CalendarBlockerCode =
  (typeof CALENDAR_BLOCKER_CODE)[keyof typeof CALENDAR_BLOCKER_CODE];

export interface CalendarSubBlocker {
  readonly code: CalendarBlockerCode;
  /** Which source: e.g. `BSE_TRADING_HOLIDAYS`. Never a URL with a query. */
  readonly sourceId: string;
  readonly stage: CalendarValidationStage;
  /** The parser's own validation verdict, when one was reached. */
  readonly sourceValidationState: string | null;
  readonly observedBytes: number | null;
  readonly requiredBytes: number | null;
}

/** Bound the list: diagnostics must stay bounded even under a total outage. */
export const MAX_REPORTED_SUB_BLOCKERS = 24;

/**
 * Transport failure code → specific calendar blocker.
 *
 * Exhaustive over the transport enum by construction: anything unmapped lands
 * on RETRIEVAL_FAILED, which is the honest generalisation of "the bytes did
 * not arrive", never a pass.
 */
export function classifyTransportFailure(transportCode: string): CalendarBlockerCode {
  switch (transportCode) {
    case "REDIRECTED_OFF_APPROVED_HOST":
    case "REDIRECT_WITHOUT_LOCATION":
    case "REDIRECT_LIMIT_EXCEEDED":
    case "REDIRECT_LOOP":
    case "INSECURE_TRANSPORT":
    case "CREDENTIALS_IN_URL":
    case "MALFORMED_URL":
    case "HOST_NOT_APPROVED":
      return CALENDAR_BLOCKER_CODE.REDIRECT_POLICY_FAILED;
    case "CONTENT_TYPE_REJECTED":
      return CALENDAR_BLOCKER_CODE.CONTENT_TYPE_REJECTED;
    case "TRANSPORT_BUDGET_EXCEEDED":
      return CALENDAR_BLOCKER_CODE.TRANSPORT_BUDGET_EXCEEDED;
    case "RESPONSE_TOO_LARGE":
      return CALENDAR_BLOCKER_CODE.ARTEFACT_EXCEEDS_SIZE_BOUND;
    default:
      return CALENDAR_BLOCKER_CODE.RETRIEVAL_FAILED;
  }
}

/** Authoritative-retrieval failure code → specific calendar blocker. */
export function classifyRetrievalFailure(
  reasonCode: string,
  transportReasonCode: string | null,
): CalendarBlockerCode {
  switch (reasonCode) {
    case "DOCUMENT_RETRIEVAL_FAILED":
      return transportReasonCode === null
        ? CALENDAR_BLOCKER_CODE.RETRIEVAL_FAILED
        : classifyTransportFailure(transportReasonCode);
    case "PAGE_SHELL_DETECTED":
      return CALENDAR_BLOCKER_CODE.PAGE_SHELL_DETECTED;
    case "ASSET_REFERENCE_ABSENT":
      return CALENDAR_BLOCKER_CODE.BUNDLE_REFERENCE_ABSENT;
    case "ASSET_REFERENCE_AMBIGUOUS":
    case "ASSET_REFERENCE_MALFORMED":
      return CALENDAR_BLOCKER_CODE.BUNDLE_REFERENCE_AMBIGUOUS;
    case "ASSET_RETRIEVAL_FAILED":
      return transportReasonCode === "TRANSPORT_BUDGET_EXCEEDED"
        ? CALENDAR_BLOCKER_CODE.TRANSPORT_BUDGET_EXCEEDED
        : CALENDAR_BLOCKER_CODE.BUNDLE_RETRIEVAL_FAILED;
    case "ASSET_BELOW_SIZE_FLOOR":
      return CALENDAR_BLOCKER_CODE.ARTEFACT_TRUNCATED_BELOW_FLOOR;
    case "ASSET_IDENTITY_ANCHOR_ABSENT":
      return CALENDAR_BLOCKER_CODE.ARTEFACT_IDENTITY_ANCHOR_ABSENT;
    default:
      return CALENDAR_BLOCKER_CODE.UNCLASSIFIED_CALENDAR_BLOCKER;
  }
}

/**
 * Our OWN parser rejection details → a stable code.
 *
 * The detail strings matched here are authored in `exchangeCalendarSources.ts`
 * by this project. They are matched by fixed prefix/phrase and then DISCARDED:
 * the detail itself can interpolate a date, a cell value or a caption from the
 * document, so it must never travel into diagnostics.
 */
export function classifyParserRejection(
  validationResult: string,
  detail: string | null,
): CalendarBlockerCode {
  const d = (detail ?? "").toLowerCase();

  if (validationResult === "REJECTED_EMPTY") return CALENDAR_BLOCKER_CODE.RETRIEVAL_FAILED;
  if (validationResult === "REJECTED_TOO_LARGE") {
    return CALENDAR_BLOCKER_CODE.ARTEFACT_EXCEEDS_SIZE_BOUND;
  }
  if (validationResult === "REJECTED_BELOW_FLOOR") {
    return CALENDAR_BLOCKER_CODE.ARTEFACT_TRUNCATED_BELOW_FLOOR;
  }
  if (validationResult === "REJECTED_AMBIGUOUS") {
    return CALENDAR_BLOCKER_CODE.PARSER_CONTRADICTION;
  }

  // Truncation and shell-shaped refusals.
  if (
    d.includes("too small to be") ||
    d.includes("no end boundary") ||
    d.includes("did not arrive complete") ||
    d.includes("truncated")
  ) {
    return CALENDAR_BLOCKER_CODE.ARTEFACT_TRUNCATED_BELOW_FLOOR;
  }
  // Artefact identity.
  if (d.includes("is not bse's application bundle") || d.includes("published equity trading-holidays caption")) {
    return CALENDAR_BLOCKER_CODE.ARTEFACT_IDENTITY_ANCHOR_ABSENT;
  }
  // Self-contradiction inside an otherwise complete document.
  if (
    d.includes("row numbering broke") ||
    d.includes("is printed as") ||
    d.includes("duplicate holiday date") ||
    d.includes("closes") ||
    d.includes("conflicting")
  ) {
    return CALENDAR_BLOCKER_CODE.PARSER_CONTRADICTION;
  }
  // Missing structure.
  if (
    d.includes("not found in the document") ||
    d.includes("header row not found") ||
    d.includes("does not publish") ||
    d.includes("no label") ||
    d.includes("missing")
  ) {
    return CALENDAR_BLOCKER_CODE.TABLE_OR_SECTION_MISSING;
  }
  return CALENDAR_BLOCKER_CODE.UNCLASSIFIED_CALENDAR_BLOCKER;
}

/** `buildExchangeCalendar` assembly blocker text → a stable code. */
export function classifyAssemblyBlocker(text: string): CalendarBlockerCode {
  const t = text.toLowerCase();
  if (t.includes("timing") || t.includes("close time") || t.includes("open time")) {
    return CALENDAR_BLOCKER_CODE.TIMING_NOT_AUTHORITATIVE;
  }
  if (t.includes("no accepted") || t.includes("disagree") || t.includes("effective")) {
    return CALENDAR_BLOCKER_CODE.CALENDAR_SOURCE_DISAGREEMENT;
  }
  if (t.includes("rejected") || t.includes("not accepted")) {
    return CALENDAR_BLOCKER_CODE.CALENDAR_SOURCE_DISAGREEMENT;
  }
  return CALENDAR_BLOCKER_CODE.UNCLASSIFIED_CALENDAR_BLOCKER;
}

/**
 * Render sub-blockers as coded, secret-free diagnostic lines.
 *
 * Deterministically ordered and bounded so two runs with the same failures
 * produce byte-identical diagnostics.
 */
export function formatSubBlockers(subBlockers: readonly CalendarSubBlocker[]): readonly string[] {
  return subBlockers
    .slice(0, MAX_REPORTED_SUB_BLOCKERS)
    .map((b) => {
      const parts = [`CALENDAR_BLOCKER=${b.code}`, `SOURCE=${b.sourceId}`, `STAGE=${b.stage}`];
      if (b.sourceValidationState !== null) parts.push(`VALIDATION=${b.sourceValidationState}`);
      if (b.observedBytes !== null) parts.push(`OBSERVED_BYTES=${b.observedBytes}`);
      if (b.requiredBytes !== null) parts.push(`REQUIRED_BYTES=${b.requiredBytes}`);
      return parts.join(" ");
    });
}
