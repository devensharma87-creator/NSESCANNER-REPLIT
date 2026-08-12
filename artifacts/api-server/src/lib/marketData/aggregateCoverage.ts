/**
 * Phase 0.5B — truthful aggregate market-data status, freshness and coverage.
 *
 * THE DEFECT THIS REPLACES
 * -----------------------
 * `deriveQuoteStatus()` returns `LIVE_TICKS` when `liveQuotesCount > 0`. That
 * proves only that at least one quote exists somewhere in the store. It proves
 * nothing about required-universe coverage, subscription coverage, tick
 * coverage, per-instrument freshness, missing instruments, pending token
 * reconciliation, provider conflict, or market-open correctness.
 *
 * This module is the ONE place where aggregate live coverage is decided. No
 * page or route may reinterpret a quote count as live coverage.
 *
 * DESIGN RULES
 * ------------
 *   - Every exported deriver is PURE and synchronous. Inputs are supplied by
 *     the caller, so tests use deterministic fixtures and never touch a
 *     production store, a provider, a scheduler, or a database.
 *   - Fail-closed everywhere. An unknown market calendar, an impossible count
 *     set, or a disputed identity degrades the state; it never upgrades it.
 *   - NO threshold is defined here. The freshness budget is passed in from the
 *     existing approved policy (`getPolicy().freshnessBudgetSec`), and the
 *     clock-skew tolerance is imported from the existing freshness module.
 *     Phase 0.5B does not change any threshold or market-calendar rule.
 *
 * TWO DENOMINATORS
 * ----------------
 * Coverage is reported against two independent denominators, because they
 * answer different questions:
 *
 *   configured    — "of the instruments this deployment actually configured,
 *                    how many are healthy?"  Today that is the legacy ~58-token
 *                    feed. Useful operationally; NOT a claim about the market.
 *
 *   authoritative — "of the instruments the website claims to cover, how many
 *                    are healthy?"  This requires a versioned, reconciled
 *                    NSE/BSE/index manifest, which does not exist yet, so it
 *                    reports UNIVERSE_NOT_CONFIGURED and blocks LIVE_COMPLETE.
 *
 * The configured feed must never be presented as if it were the whole market.
 */

import { CLOCK_SKEW_TOLERANCE_SEC } from "./freshness";

// ---------------------------------------------------------------------------
// Contract types
// ---------------------------------------------------------------------------

/**
 * Where the coverage denominator comes from. Only an authoritative, reconciled
 * manifest can support a completeness claim.
 */
export type CoverageAuthority =
  | "AUTHORITATIVE_RECONCILED_UNIVERSE"
  | "LEGACY_PARTIAL_CONFIGURATION"
  | "UNIVERSE_NOT_CONFIGURED";

/** Closed set of aggregate states. */
export type AggregateMarketDataState =
  | "INITIALIZING"
  | "UNIVERSE_NOT_CONFIGURED"
  | "LIVE_COMPLETE"
  | "LIVE_PARTIAL"
  | "RECONCILIATION_PENDING"
  | "CONFLICTED"
  | "STALE"
  | "UNAVAILABLE"
  | "MARKET_CLOSED_CURRENT"
  | "MARKET_CLOSED_PARTIAL";

/** Closed set of per-instrument states. */
export type PerInstrumentStatus =
  | "LIVE"
  | "CURRENT_SNAPSHOT"
  | "LAST_KNOWN"
  | "STALE"
  | "UNAVAILABLE"
  | "CONFLICTED"
  | "MARKET_CLOSED_FINAL"
  | "TOKEN_RECONCILIATION_PENDING";

/** Machine-readable reasons the aggregate cannot claim complete live coverage. */
export type CoverageBlocker =
  | "AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED"
  /**
   * No cross-provider comparison has run, so provider agreement is UNKNOWN.
   * Emitted whenever conflictObservation is NOT_CHECKED, precisely so an empty
   * conflicted set can never be mistaken for verified agreement.
   */
  | "PROVIDER_CONFLICT_NOT_CHECKED"
  /**
   * An authoritative universe IS configured, but it is not fully fresh — or
   * the observed/configured denominator is not the authoritative one. Blocks
   * every completeness claim.
   */
  | "AUTHORITATIVE_COVERAGE_INCOMPLETE"
  | "UNIVERSE_RECONCILIATION_INVALID"
  | "REQUIRED_UNIVERSE_EMPTY"
  | "REGISTRATION_INCOMPLETE"
  | "SUBSCRIPTION_INCOMPLETE"
  | "TICK_COVERAGE_INCOMPLETE"
  | "STALE_INSTRUMENTS_PRESENT"
  | "UNAVAILABLE_INSTRUMENTS_PRESENT"
  | "CONFLICTED_INSTRUMENTS_PRESENT"
  | "TOKEN_RECONCILIATION_PENDING"
  | "MARKET_CALENDAR_UNKNOWN"
  | "MARKET_NOT_OPEN"
  | "PROVIDER_FEED_UNHEALTHY"
  | "IMPOSSIBLE_COUNTS";

/**
 * Market phase, derived from the EXISTING calendar (`getMarketStatusDetail`).
 * Phase 0.5B adds no calendar rule and changes no session boundary.
 */
export type MarketPhase =
  | "OPEN"
  | "PRE_OPEN"
  | "CLOSED_TRADING_DAY"
  | "WEEKEND"
  | "HOLIDAY"
  | "UNKNOWN";

/** One instrument's observable facts. Supplied by the caller; never fetched. */
export interface InstrumentObservation {
  canonicalInstrumentId: string;
  exchange: "NSE" | "BSE";
  provider: string | null;
  /** Exchange-supplied timestamp (ms) where the provider gives one. */
  exchangeTsMs: number | null;
  /** Timestamp (ms) at which this process received the value. */
  receivedTsMs: number | null;
  /** Is this instrument currently subscribed on the provider feed? */
  subscribed: boolean;
  /** Is a provider-token rotation deferred for this identity? */
  reconciliationPending: boolean;
  /** Do two sources disagree irreconcilably for this identity? */
  conflicted: boolean;
  /** Does the stored value carry a valid canonical close for its session? */
  sessionCloseVerified?: boolean;
  /** IST trading date (YYYY-MM-DD) the stored close belongs to. */
  sessionCloseTradingDate?: string | null;
}

export interface ClassificationContext {
  nowMs: number;
  /** From the existing approved policy. Never defined in this module. */
  freshnessBudgetSec: number;
  marketPhase: MarketPhase;
  /** Most recent completed IST trading date (YYYY-MM-DD), or null if unknown. */
  currentTradingDate: string | null;
}

export interface InstrumentClassification {
  canonicalInstrumentId: string;
  exchange: "NSE" | "BSE";
  provider: string | null;
  status: PerInstrumentStatus;
  ageSec: number | null;
  /** Did this instrument ever produce a value in this process? */
  ticked: boolean;
  subscribed: boolean;
  /** Which partition bucket this instrument occupies. Exactly one. */
  bucket: PartitionBucket;
}

/**
 * The partition is mutually exclusive and exhaustive: every required
 * instrument lands in exactly one bucket, so the counts always reconcile.
 *
 * "fresh" means "carries a trustworthy CURRENT value for the prevailing market
 * phase" — a live tick while the market is open, or a verified session close
 * while it is shut. It does not mean "recently received".
 */
export type PartitionBucket = "fresh" | "stale" | "unavailable" | "conflicted";

export interface CoverageCounts {
  requiredInstrumentCount: number;
  registeredInstrumentCount: number;
  subscriptionRequestedCount: number;
  subscribedInstrumentCount: number;
  tickedInstrumentCount: number;
  freshInstrumentCount: number;
  staleInstrumentCount: number;
  unavailableInstrumentCount: number;
  conflictedInstrumentCount: number;
  /**
   * OVERLAY, not a partition bucket. A pending instrument still occupies
   * exactly one bucket: `unavailable` in the normal case (a disputed token
   * mapping means the stored price may belong to a different instrument), or
   * `conflicted` when that same instrument is also conflicted, since conflict
   * is the more severe finding and wins the bucket.
   *
   * Because it cross-cuts buckets, this count is EXCLUDED from the partition
   * equation — including it would double-count.
   */
  pendingReconciliationCount: number;
}

/**
 * Did anyone actually CHECK for cross-provider disagreement?
 *
 * An empty conflicted set is not evidence of agreement. Without this field the
 * contract cannot distinguish "we compared providers and they agree" from
 * "no comparison has ever run", and the second would silently read as the
 * first. Today the production value is always NOT_CHECKED: the Upstox
 * comparison is not implemented, and integrating it is a separate phase.
 */
export type ConflictObservationStatus =
  | "NOT_CHECKED"
  | "CHECKED_NO_CONFLICT"
  | "CONFLICT_DETECTED";

/** Identity/version of a coverage denominator. */
export interface UniverseManifest {
  universeScopeId: string;
  universeGenerationId: string | null;
  universeGeneratedAt: string | null;
  coverageAuthority: CoverageAuthority;
  universeReconciliationValid: boolean;
  /** Canonical ids that this denominator requires. Index aliases collapse. */
  requiredInstrumentIds: string[];
  /** How many subscriptions this deployment asked the provider for. */
  subscriptionRequestedCount: number;
}

export interface CoverageView extends CoverageCounts {
  universeScopeId: string;
  universeGenerationId: string | null;
  universeGeneratedAt: string | null;
  coverageAuthority: CoverageAuthority;
  universeReconciliationValid: boolean;
  /** Fresh / required as a percentage, 0–100. 0 when required is 0. */
  coveragePct: number;
}

export interface AggregateMarketDataHealth {
  universeScopeId: string;
  universeGenerationId: string | null;
  universeGeneratedAt: string | null;
  coverageAuthority: CoverageAuthority;
  universeReconciliationValid: boolean;

  requiredInstrumentCount: number;
  registeredInstrumentCount: number;
  subscriptionRequestedCount: number;
  subscribedInstrumentCount: number;
  tickedInstrumentCount: number;
  freshInstrumentCount: number;
  staleInstrumentCount: number;
  unavailableInstrumentCount: number;
  conflictedInstrumentCount: number;
  pendingReconciliationCount: number;

  marketState: MarketPhase;
  checkedAt: string;
  freshnessBudgetSec: number;
  overallState: AggregateMarketDataState;
  blockers: CoverageBlocker[];
  /**
   * Timestamp of the NEWEST observation behind these counts, or null when
   * nothing has been observed at all. This is what a "last known" presentation
   * must be stamped with: it is an observation time, NOT a verified official
   * session close, and it must never be labelled as one.
   */
  newestObservationAt: string | null;
  /**
   * Whether provider agreement was actually checked. NOT_CHECKED today.
   * `conflictedInstrumentCount === 0` means nothing unless this is
   * CHECKED_NO_CONFLICT.
   */
  conflictObservation: ConflictObservationStatus;

  /** Coverage against the currently configured subscription list. */
  configured: CoverageView;
  /** Coverage against the approved, reconciled universe manifest. */
  authoritative: CoverageView;
}

// ---------------------------------------------------------------------------
// Market phase
// ---------------------------------------------------------------------------

/**
 * PURE: maps the EXISTING calendar's reason code to a coverage market phase.
 * An unrecognised reason fails closed to UNKNOWN rather than assuming "open"
 * or "closed".
 */
export function deriveMarketPhase(input: {
  reason: string;
  marketOpen: boolean;
  isTradingDay: boolean;
}): MarketPhase {
  switch (input.reason) {
    case "OPEN":         return input.marketOpen ? "OPEN" : "CLOSED_TRADING_DAY";
    case "PRE_OPEN":     return "PRE_OPEN";
    case "BEFORE_OPEN":  return "CLOSED_TRADING_DAY";
    case "AFTER_CLOSE":  return "CLOSED_TRADING_DAY";
    case "WEEKEND":      return "WEEKEND";
    case "HOLIDAY":      return "HOLIDAY";
    default:             return "UNKNOWN";
  }
}

/** True when the market is shut but the calendar is known. */
function isKnownClosedPhase(p: MarketPhase): boolean {
  return p === "CLOSED_TRADING_DAY" || p === "WEEKEND" || p === "HOLIDAY" || p === "PRE_OPEN";
}

// ---------------------------------------------------------------------------
// Per-instrument classification
// ---------------------------------------------------------------------------

/** PURE: which partition bucket a per-instrument status occupies. */
export function partitionBucketFor(status: PerInstrumentStatus): PartitionBucket {
  switch (status) {
    case "LIVE":
    case "CURRENT_SNAPSHOT":
    case "MARKET_CLOSED_FINAL":
      return "fresh";
    case "STALE":
    case "LAST_KNOWN":
      return "stale";
    case "CONFLICTED":
      return "conflicted";
    case "UNAVAILABLE":
    case "TOKEN_RECONCILIATION_PENDING":
      return "unavailable";
  }
}

/**
 * PURE: derive one instrument's status.
 *
 * Precedence is deliberate and fail-closed:
 *   1. conflict          — two sources disagree; no value is trustworthy
 *   2. reconciliation    — the token→identity mapping is disputed, so the
 *                          stored price may belong to a different instrument
 *   3. unknown calendar  — we cannot say what "current" means
 *   4. market phase      — open vs shut have different notions of "current"
 *
 * An instrument with pending reconciliation is NEVER eligible for LIVE, even
 * with a zero-age tick.
 */
export function classifyInstrument(
  obs: InstrumentObservation,
  ctx: ClassificationContext,
): InstrumentClassification {
  const tsMs = obs.exchangeTsMs ?? obs.receivedTsMs;
  const ticked = tsMs != null;

  let ageSec: number | null = null;
  if (tsMs != null) ageSec = Math.floor((ctx.nowMs - tsMs) / 1000);

  const status = ((): PerInstrumentStatus => {
    if (obs.conflicted) return "CONFLICTED";
    if (obs.reconciliationPending) return "TOKEN_RECONCILIATION_PENDING";

    // An unknown market calendar means we cannot classify "current" at all.
    if (ctx.marketPhase === "UNKNOWN") return "UNAVAILABLE";

    if (tsMs == null || ageSec == null) return "UNAVAILABLE";

    // A timestamp meaningfully in the future is unverifiable, not fresh.
    if (ageSec < -CLOCK_SKEW_TOLERANCE_SEC) return "UNAVAILABLE";

    const withinBudget = ageSec <= ctx.freshnessBudgetSec;

    if (ctx.marketPhase === "OPEN") {
      return withinBudget ? "LIVE" : "STALE";
    }

    // Market is shut. A valid official close is CURRENT, not stale — but only
    // when it demonstrably belongs to the current/most-recent trading session.
    const closeIsCurrent =
      obs.sessionCloseVerified === true &&
      ctx.currentTradingDate != null &&
      obs.sessionCloseTradingDate === ctx.currentTradingDate;

    if (closeIsCurrent) {
      return ctx.marketPhase === "PRE_OPEN" ? "CURRENT_SNAPSHOT" : "MARKET_CLOSED_FINAL";
    }

    // A value exists but is from an older session, or was never verified as a
    // canonical close. Honest label: last known, not current.
    return "LAST_KNOWN";
  })();

  return {
    canonicalInstrumentId: obs.canonicalInstrumentId,
    exchange: obs.exchange,
    provider: obs.provider,
    status,
    ageSec,
    ticked,
    subscribed: obs.subscribed,
    bucket: partitionBucketFor(status),
  };
}

// ---------------------------------------------------------------------------
// Observation assembly
// ---------------------------------------------------------------------------

export interface ObservationSourceIdentity {
  canonicalInstrumentId: string;
  exchange: "NSE" | "BSE";
  providerInstrumentToken: number;
}

export interface ObservationTick {
  provider: string | null;
  /** Received timestamp (ms), or null when never ticked. */
  ts: number | null;
  sessionCloseVerified?: boolean;
  sessionCloseTradingDate?: string | null;
}

/**
 * PURE: turn a registry + a quote map into one observation per REQUIRED
 * instrument.
 *
 * Three identity guarantees fall out of driving the loop from the registry
 * rather than from the quote map:
 *
 *   - Identity-less ticks cannot count. A quote whose key is not a registered
 *     canonical id is never read, so an unidentified tick can never inflate
 *     coverage.
 *   - Index aliases count once. The registry holds one identity per
 *     instrument, so N aliases pointing at one token yield one observation.
 *   - NSE and BSE listings of the same trading symbol stay separate, because
 *     the canonical id is exchange-qualified.
 */
export function buildObservations(input: {
  identities: ObservationSourceIdentity[];
  quotesByCanonicalId: Record<string, ObservationTick>;
  subscribedTokens: ReadonlySet<number>;
  pendingInstrumentIds: ReadonlySet<string>;
  conflictedInstrumentIds?: ReadonlySet<string>;
}): InstrumentObservation[] {
  const conflicted = input.conflictedInstrumentIds ?? new Set<string>();
  const seen = new Set<string>();
  const out: InstrumentObservation[] = [];

  for (const ident of input.identities) {
    const id = ident.canonicalInstrumentId;
    if (typeof id !== "string" || id.trim().length === 0) continue; // identity-less
    if (seen.has(id)) continue; // aliases collapse to one instrument
    seen.add(id);

    const tick = Object.prototype.hasOwnProperty.call(input.quotesByCanonicalId, id)
      ? input.quotesByCanonicalId[id]!
      : null;

    out.push({
      canonicalInstrumentId: id,
      exchange: ident.exchange,
      provider: tick?.provider ?? null,
      exchangeTsMs: null,
      receivedTsMs: tick?.ts ?? null,
      subscribed: input.subscribedTokens.has(ident.providerInstrumentToken),
      reconciliationPending: input.pendingInstrumentIds.has(id),
      conflicted: conflicted.has(id),
      sessionCloseVerified: tick?.sessionCloseVerified ?? false,
      sessionCloseTradingDate: tick?.sessionCloseTradingDate ?? null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Count validation
// ---------------------------------------------------------------------------

/**
 * PURE: reject impossible count sets. Returns the list of violations; empty
 * means the counts are internally consistent.
 *
 * `authoritative` enables the `registered <= required` rule, which only holds
 * for a manifest that actually enumerates a required universe.
 */
export function validateCoverageCounts(
  c: CoverageCounts,
  opts: { authoritative: boolean },
): string[] {
  const v: string[] = [];
  const entries = Object.entries(c) as Array<[keyof CoverageCounts, number]>;

  for (const [k, n] of entries) {
    if (!Number.isFinite(n)) v.push(`${k} is not finite`);
    else if (n < 0) v.push(`${k} is negative`);
    else if (!Number.isInteger(n)) v.push(`${k} is not an integer`);
  }
  if (v.length > 0) return v;

  const partition =
    c.freshInstrumentCount +
    c.staleInstrumentCount +
    c.unavailableInstrumentCount +
    c.conflictedInstrumentCount;

  if (partition !== c.requiredInstrumentCount) {
    v.push(
      `partition ${partition} != requiredInstrumentCount ${c.requiredInstrumentCount}`,
    );
  }
  if (c.freshInstrumentCount > c.tickedInstrumentCount) {
    v.push("freshInstrumentCount > tickedInstrumentCount");
  }
  if (c.tickedInstrumentCount > c.subscribedInstrumentCount) {
    v.push("tickedInstrumentCount > subscribedInstrumentCount");
  }
  if (c.subscribedInstrumentCount > c.subscriptionRequestedCount) {
    v.push("subscribedInstrumentCount > subscriptionRequestedCount");
  }
  if (opts.authoritative && c.registeredInstrumentCount > c.requiredInstrumentCount) {
    v.push("registeredInstrumentCount > requiredInstrumentCount");
  }
  if (c.pendingReconciliationCount > c.requiredInstrumentCount) {
    v.push("pendingReconciliationCount > requiredInstrumentCount");
  }
  return v;
}

/** PURE: fresh/required as a bounded percentage. Never exceeds 100. */
export function coveragePct(fresh: number, required: number): number {
  if (required <= 0) return 0;
  const pct = (fresh / required) * 100;
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, Math.round(pct * 100) / 100));
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export interface DeriveAggregateInput {
  /** The denominator that governs the headline state (today: configured). */
  manifest: UniverseManifest;
  /** The approved reconciled manifest. Today: UNIVERSE_NOT_CONFIGURED. */
  authoritativeManifest: UniverseManifest;
  /** One observation per required instrument. */
  classifications: InstrumentClassification[];
  registeredInstrumentCount: number;
  /**
   * Overlay count of deferred token rotations.
   *
   * OVERLAY SEMANTICS (deliberate, and excluded from the partition equation):
   * a pending instrument still occupies exactly ONE partition bucket. It is
   * `unavailable` in the normal case — a disputed token mapping means the
   * stored price may belong to a different instrument — but if that same
   * instrument is ALSO conflicted, conflict is more severe and takes the
   * bucket. So "pending" does not imply "counted in unavailable"; it implies
   * "counted in unavailable OR conflicted". The count is kept out of the
   * partition sum precisely because it cross-cuts buckets.
   */
  pendingReconciliationCount: number;
  marketPhase: MarketPhase;
  freshnessBudgetSec: number;
  nowMs: number;
  /** Is the provider feed itself healthy (connected / running)? */
  providerFeedHealthy: boolean;
  /**
   * Has a cross-provider comparison actually RUN? An empty conflicted set is
   * meaningless without this: "no conflicts found" and "nobody looked" are
   * completely different claims and must never render identically.
   */
  conflictObservation: ConflictObservationStatus;
}

function countsFrom(
  manifest: UniverseManifest,
  cls: InstrumentClassification[],
  registeredInstrumentCount: number,
  pendingReconciliationCount: number,
): CoverageCounts {
  let fresh = 0, stale = 0, unavailable = 0, conflicted = 0, ticked = 0, subscribed = 0;
  for (const c of cls) {
    if (c.ticked) ticked++;
    if (c.subscribed) subscribed++;
    switch (c.bucket) {
      case "fresh":       fresh++; break;
      case "stale":       stale++; break;
      case "unavailable": unavailable++; break;
      case "conflicted":  conflicted++; break;
    }
  }
  return {
    requiredInstrumentCount: manifest.requiredInstrumentIds.length,
    registeredInstrumentCount,
    subscriptionRequestedCount: manifest.subscriptionRequestedCount,
    subscribedInstrumentCount: subscribed,
    tickedInstrumentCount: ticked,
    freshInstrumentCount: fresh,
    staleInstrumentCount: stale,
    unavailableInstrumentCount: unavailable,
    conflictedInstrumentCount: conflicted,
    pendingReconciliationCount,
  };
}

function viewFrom(manifest: UniverseManifest, counts: CoverageCounts): CoverageView {
  return {
    ...counts,
    universeScopeId: manifest.universeScopeId,
    universeGenerationId: manifest.universeGenerationId,
    universeGeneratedAt: manifest.universeGeneratedAt,
    coverageAuthority: manifest.coverageAuthority,
    universeReconciliationValid: manifest.universeReconciliationValid,
    coveragePct: coveragePct(counts.freshInstrumentCount, counts.requiredInstrumentCount),
  };
}

/**
 * PURE: the single aggregate decision.
 *
 * STATE PRECEDENCE (first match wins, most severe first):
 *   1.  IMPOSSIBLE_COUNTS      → UNAVAILABLE
 *   2.  unknown calendar       → UNAVAILABLE
 *   3.  required universe = 0  → UNIVERSE_NOT_CONFIGURED
 *   4.  authority not configured → UNIVERSE_NOT_CONFIGURED
 *   5.  any conflict           → CONFLICTED
 *   6.  any pending rotation   → RECONCILIATION_PENDING
 *   7.  nothing observed yet   → INITIALIZING
 *   8.  market open            → LIVE_COMPLETE | LIVE_PARTIAL | STALE | UNAVAILABLE
 *   9.  market shut            → MARKET_CLOSED_CURRENT | MARKET_CLOSED_PARTIAL
 *                                | STALE | UNAVAILABLE
 *
 * A non-zero quote count is never sufficient for LIVE_COMPLETE. Neither
 * LIVE_COMPLETE nor MARKET_CLOSED_CURRENT may be claimed without an
 * AUTHORITATIVE_RECONCILED_UNIVERSE, because a completeness claim against a
 * partial denominator would describe the legacy feed as the whole market.
 */
export function deriveAggregateCoverage(
  input: DeriveAggregateInput,
): AggregateMarketDataHealth {
  const {
    manifest, authoritativeManifest, classifications,
    registeredInstrumentCount, pendingReconciliationCount,
    marketPhase, freshnessBudgetSec, nowMs, providerFeedHealthy, conflictObservation,
  } = input;

  const counts = countsFrom(
    manifest, classifications, registeredInstrumentCount, pendingReconciliationCount,
  );

  // ---------------------------------------------------------------------
  // Identity integrity of the observation set itself.
  //
  // Every count above is only meaningful if each classification is a UNIQUE
  // member of the denominator it is being counted against. Without this, a
  // duplicated identity can fill the quota left by a missing one and a
  // "complete" claim becomes arithmetically true but factually false.
  // ---------------------------------------------------------------------
  const seen = new Set<string>();
  let duplicateIds = 0;
  for (const c of classifications) {
    if (seen.has(c.canonicalInstrumentId)) duplicateIds++;
    seen.add(c.canonicalInstrumentId);
  }
  const requiredIds = new Set(manifest.requiredInstrumentIds);
  let foreignIds = 0;
  for (const id of seen) if (!requiredIds.has(id)) foreignIds++;
  const observationSetValid = duplicateIds === 0 && foreignIds === 0;

  // ---------------------------------------------------------------------
  // Authoritative coverage is computed INDEPENDENTLY, never inherited.
  //
  // Reusing the configured counts here would let a partial observation set
  // be reported as full-universe coverage the moment somebody flips the
  // authority enum. The authoritative numerator counts only classifications
  // that are unique members of the AUTHORITATIVE required-id set.
  // ---------------------------------------------------------------------
  const authoritativeRequiredIds = new Set(authoritativeManifest.requiredInstrumentIds);
  const authoritativeSeen = new Set<string>();
  const authoritativeClassifications = classifications.filter((c) => {
    if (!authoritativeRequiredIds.has(c.canonicalInstrumentId)) return false;
    if (authoritativeSeen.has(c.canonicalInstrumentId)) return false;
    authoritativeSeen.add(c.canonicalInstrumentId);
    return true;
  });

  // The authority claim is only real if the manifest ALSO carries valid
  // reconciliation metadata and a non-empty required set. An enum value on
  // its own proves nothing.
  const authoritativeIsReal =
    authoritativeManifest.coverageAuthority === "AUTHORITATIVE_RECONCILED_UNIVERSE" &&
    authoritativeManifest.universeReconciliationValid === true &&
    authoritativeManifest.universeGenerationId !== null &&
    authoritativeManifest.requiredInstrumentIds.length > 0 &&
    observationSetValid;

  // Always computed from the authoritative manifest's OWN required-id set and
  // its own matched observations — never inherited from `counts`. Computed
  // BEFORE the state decision, because a completeness claim has to be checked
  // against this denominator, not merely against the configured one.
  const authoritativeCounts: CoverageCounts = countsFrom(
    authoritativeManifest,
    authoritativeClassifications,
    // Registration is only claimable for instruments the authoritative set
    // actually matched; an unmatched required id is not registered.
    Math.min(registeredInstrumentCount, authoritativeClassifications.length),
    pendingReconciliationCount,
  );

  /**
   * Is the FULL authoritative universe fresh right now?
   *
   * This is the only question a completeness claim is allowed to answer. It is
   * evaluated against the authoritative required-id set, so a smaller
   * configured feed can never satisfy it by being internally consistent.
   */
  const authoritativeFullyCovered =
    authoritativeIsReal &&
    authoritativeCounts.requiredInstrumentCount ===
      authoritativeManifest.requiredInstrumentIds.length &&
    authoritativeCounts.freshInstrumentCount ===
      authoritativeCounts.requiredInstrumentCount &&
    authoritativeCounts.subscribedInstrumentCount ===
      authoritativeCounts.requiredInstrumentCount &&
    authoritativeCounts.staleInstrumentCount === 0 &&
    authoritativeCounts.unavailableInstrumentCount === 0 &&
    authoritativeCounts.conflictedInstrumentCount === 0;

  const violations = validateCoverageCounts(counts, {
    authoritative: manifest.coverageAuthority === "AUTHORITATIVE_RECONCILED_UNIVERSE",
  });

  const blockers = new Set<CoverageBlocker>();

  if (violations.length > 0 || !observationSetValid) blockers.add("IMPOSSIBLE_COUNTS");
  if (marketPhase === "UNKNOWN") blockers.add("MARKET_CALENDAR_UNKNOWN");
  if (!authoritativeIsReal) blockers.add("AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED");
  if (
    authoritativeIsReal &&
    (!authoritativeFullyCovered ||
      counts.requiredInstrumentCount !== authoritativeCounts.requiredInstrumentCount)
  ) {
    blockers.add("AUTHORITATIVE_COVERAGE_INCOMPLETE");
  }
  if (!manifest.universeReconciliationValid) blockers.add("UNIVERSE_RECONCILIATION_INVALID");
  if (counts.requiredInstrumentCount === 0) blockers.add("REQUIRED_UNIVERSE_EMPTY");
  if (counts.registeredInstrumentCount < counts.requiredInstrumentCount) {
    blockers.add("REGISTRATION_INCOMPLETE");
  }
  if (counts.subscribedInstrumentCount < counts.requiredInstrumentCount) {
    blockers.add("SUBSCRIPTION_INCOMPLETE");
  }
  if (counts.tickedInstrumentCount < counts.requiredInstrumentCount) {
    blockers.add("TICK_COVERAGE_INCOMPLETE");
  }
  if (counts.staleInstrumentCount > 0) blockers.add("STALE_INSTRUMENTS_PRESENT");
  if (counts.unavailableInstrumentCount > 0) blockers.add("UNAVAILABLE_INSTRUMENTS_PRESENT");
  if (counts.conflictedInstrumentCount > 0) blockers.add("CONFLICTED_INSTRUMENTS_PRESENT");
  if (counts.pendingReconciliationCount > 0) blockers.add("TOKEN_RECONCILIATION_PENDING");
  if (marketPhase !== "OPEN") blockers.add("MARKET_NOT_OPEN");
  if (!providerFeedHealthy) blockers.add("PROVIDER_FEED_UNHEALTHY");
  // Unconditional: emitted even when conflictedInstrumentCount is 0, because
  // that zero is exactly what NOT_CHECKED makes meaningless.
  if (conflictObservation === "NOT_CHECKED") blockers.add("PROVIDER_CONFLICT_NOT_CHECKED");
  if (conflictObservation === "CONFLICT_DETECTED") blockers.add("CONFLICTED_INSTRUMENTS_PRESENT");

  const overallState = ((): AggregateMarketDataState => {
    // A corrupted observation set cannot support ANY positive claim.
    if (violations.length > 0 || !observationSetValid) return "UNAVAILABLE";
    if (marketPhase === "UNKNOWN") return "UNAVAILABLE";
    if (counts.requiredInstrumentCount === 0) return "UNIVERSE_NOT_CONFIGURED";
    if (manifest.coverageAuthority === "UNIVERSE_NOT_CONFIGURED") {
      return "UNIVERSE_NOT_CONFIGURED";
    }
    if (counts.conflictedInstrumentCount > 0) return "CONFLICTED";
    if (counts.pendingReconciliationCount > 0) return "RECONCILIATION_PENDING";

    // Nothing has been observed yet and nothing has gone wrong: still warming.
    if (
      counts.tickedInstrumentCount === 0 &&
      counts.staleInstrumentCount === 0 &&
      counts.subscribedInstrumentCount > 0
    ) {
      return "INITIALIZING";
    }

    const complete =
      authoritativeIsReal &&
      manifest.coverageAuthority === "AUTHORITATIVE_RECONCILED_UNIVERSE" &&
      manifest.universeReconciliationValid &&
      counts.requiredInstrumentCount > 0 &&
      counts.registeredInstrumentCount === counts.requiredInstrumentCount &&
      counts.subscribedInstrumentCount === counts.requiredInstrumentCount &&
      counts.freshInstrumentCount === counts.requiredInstrumentCount &&
      counts.staleInstrumentCount === 0 &&
      counts.unavailableInstrumentCount === 0 &&
      counts.conflictedInstrumentCount === 0 &&
      counts.pendingReconciliationCount === 0 &&
      providerFeedHealthy &&
      // The configured denominator must BE the authoritative one, and that
      // authoritative universe must itself be fully fresh. Without this, a
      // small configured feed that is internally consistent could be reported
      // as complete market coverage.
      authoritativeFullyCovered &&
      counts.requiredInstrumentCount === authoritativeCounts.requiredInstrumentCount &&
      // Provider agreement must have been CHECKED, not merely un-contradicted.
      // NOT_CHECKED means nobody looked, which cannot support a complete claim.
      conflictObservation === "CHECKED_NO_CONFLICT";

    if (marketPhase === "OPEN") {
      if (complete) return "LIVE_COMPLETE";
      if (counts.freshInstrumentCount > 0) return "LIVE_PARTIAL";
      if (counts.staleInstrumentCount > 0) return "STALE";
      return "UNAVAILABLE";
    }

    if (isKnownClosedPhase(marketPhase)) {
      if (complete) return "MARKET_CLOSED_CURRENT";
      if (counts.freshInstrumentCount > 0) return "MARKET_CLOSED_PARTIAL";
      if (counts.staleInstrumentCount > 0) return "STALE";
      return "UNAVAILABLE";
    }

    return "UNAVAILABLE";
  })();

  return {
    universeScopeId: manifest.universeScopeId,
    universeGenerationId: manifest.universeGenerationId,
    universeGeneratedAt: manifest.universeGeneratedAt,
    coverageAuthority: manifest.coverageAuthority,
    universeReconciliationValid: manifest.universeReconciliationValid,

    ...counts,

    marketState: marketPhase,
    checkedAt: new Date(nowMs).toISOString(),
    freshnessBudgetSec,
    overallState,
    blockers: [...blockers].sort(),
    newestObservationAt: ((): string | null => {
      const ages = classifications
        .map((c) => c.ageSec)
        .filter((a): a is number => a != null && Number.isFinite(a) && a >= 0);
      if (ages.length === 0) return null;
      return new Date(nowMs - Math.min(...ages) * 1000).toISOString();
    })(),
    conflictObservation,

    configured: viewFrom(manifest, counts),
    authoritative: viewFrom(authoritativeManifest, authoritativeCounts),
  };
}

// ---------------------------------------------------------------------------
// Public (safe) projection
// ---------------------------------------------------------------------------

/**
 * The PUBLIC shape. Safe aggregate counts and states only — no canonical
 * identities, no provider tokens, no credentials, no raw connection data.
 */
export interface PublicAggregateCoverage {
  overallState: AggregateMarketDataState;
  coverageAuthority: CoverageAuthority;
  universeReconciliationValid: boolean;
  universeScopeId: string;
  marketState: MarketPhase;
  freshnessBudgetSec: number;
  checkedAt: string;
  requiredInstrumentCount: number;
  subscribedInstrumentCount: number;
  freshInstrumentCount: number;
  staleInstrumentCount: number;
  unavailableInstrumentCount: number;
  conflictedInstrumentCount: number;
  pendingReconciliationCount: number;
  coveragePct: number;
  blockers: CoverageBlocker[];
  /**
   * Newest observation time behind these counts. An observation timestamp,
   * NOT a verified official close. Null when nothing has been observed.
   */
  newestObservationAt: string | null;
  /**
   * Whether provider agreement was actually checked. Public because
   * `conflictedInstrumentCount: 0` is misleading without it.
   */
  conflictObservation: ConflictObservationStatus;
  authoritative: {
    coverageAuthority: CoverageAuthority;
    universeReconciliationValid: boolean;
    requiredInstrumentCount: number;
    freshInstrumentCount: number;
    coveragePct: number;
  };
}

/** PURE: project the full contract down to the public-safe shape. */
export function toPublicAggregateCoverage(
  h: AggregateMarketDataHealth,
): PublicAggregateCoverage {
  return {
    overallState: h.overallState,
    coverageAuthority: h.coverageAuthority,
    universeReconciliationValid: h.universeReconciliationValid,
    universeScopeId: h.universeScopeId,
    marketState: h.marketState,
    freshnessBudgetSec: h.freshnessBudgetSec,
    checkedAt: h.checkedAt,
    requiredInstrumentCount: h.requiredInstrumentCount,
    subscribedInstrumentCount: h.subscribedInstrumentCount,
    freshInstrumentCount: h.freshInstrumentCount,
    staleInstrumentCount: h.staleInstrumentCount,
    unavailableInstrumentCount: h.unavailableInstrumentCount,
    conflictedInstrumentCount: h.conflictedInstrumentCount,
    pendingReconciliationCount: h.pendingReconciliationCount,
    coveragePct: h.configured.coveragePct,
    blockers: h.blockers,
    newestObservationAt: h.newestObservationAt,
    conflictObservation: h.conflictObservation,
    authoritative: {
      coverageAuthority: h.authoritative.coverageAuthority,
      universeReconciliationValid: h.authoritative.universeReconciliationValid,
      requiredInstrumentCount: h.authoritative.requiredInstrumentCount,
      freshInstrumentCount: h.authoritative.freshInstrumentCount,
      coveragePct: h.authoritative.coveragePct,
    },
  };
}

/**
 * The authoritative manifest does not exist yet. Phase 0.5B deliberately does
 * NOT fabricate one: integrating and reconciling the official NSE/BSE master
 * is a separate authorized phase.
 */
export const AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED: UniverseManifest = {
  universeScopeId: "AUTHORITATIVE_NSE_BSE_INDEX_UNIVERSE",
  universeGenerationId: null,
  universeGeneratedAt: null,
  coverageAuthority: "UNIVERSE_NOT_CONFIGURED",
  universeReconciliationValid: false,
  requiredInstrumentIds: [],
  subscriptionRequestedCount: 0,
};
