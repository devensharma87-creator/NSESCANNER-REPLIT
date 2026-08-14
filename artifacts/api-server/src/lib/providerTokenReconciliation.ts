/**
 * Provider-token reconciliation — Data Foundation Phase 0.5A.
 *
 * A provider may reissue an instrument token (Kite does this for some
 * corporate actions). Re-pointing an identity at a new token is therefore
 * legitimate, but it MUST NOT leave the old token subscribed: an orphan
 * subscription consumes entitlement from the provider's hard token cap while
 * delivering ticks that resolve to nothing.
 *
 * CONTRACT
 * --------
 * The whole rotation is one transaction, and the replacement subscription is
 * INSIDE it — not left to a later batch call that could fail after the old
 * token is already gone. The order is deliberate:
 *
 *   1. unsubscribe the old token from the ticker
 *   2. remove it from the subscription set
 *   3. subscribe the replacement token
 *   4. re-point the registry (old token stops resolving, new token starts)
 *   5. mark the replacement subscribed and evict the quote sourced from the
 *      retired token
 *
 * Every failure unwinds to a state with exactly ONE active token:
 *
 *   - step 1 fails  → nothing has been mutated; the old token stays live
 *   - step 3 fails  → the old token is re-subscribed; the new one is not
 *                     installed anywhere
 *   - step 4 fails  → the replacement is unsubscribed and the old token is
 *                     re-subscribed
 *
 * In every failure case the caller is told
 * TOKEN_REBIND_REQUIRES_SUBSCRIPTION_RECONCILIATION (or REJECTED) and the
 * identity is queued for a controlled resubscription cycle. Nothing is
 * installed silently and no orphan is left behind.
 *
 * Invariants preserved: one provider token resolves to one identity, and one
 * identity has exactly one ACTIVE provider token — never two, never zero.
 *
 * This module owns no ticker of its own; the caller supplies a
 * SubscriptionPort so the policy is testable without a live socket.
 */
import { instrumentRegistry } from "./canonicalInstrument";
import { getQuoteByCanonicalId } from "./liveQuoteStore";
import { getPolicy } from "./marketData/policy";
import { redactForOwnerDiagnostics } from "./safeDiagnosticRedaction";

/** The subscription side-effects a rebind needs. Implemented by kiteFeed. */
export interface SubscriptionPort {
  isSubscribed(token: number): boolean;
  /** Must throw if the unsubscribe could not be issued. */
  unsubscribe(token: number): void;
  markUnsubscribed(token: number): void;
  /** Issue a subscribe for one token. Must throw if it could not be issued. */
  subscribeToken(token: number): void;
  markSubscribed(token: number): void;
  evictQuote(canonicalInstrumentId: string): void;
}

export type ReconcileOutcome =
  | { status: "NOT_REQUIRED" }
  /** The replacement token is already subscribed and marked — do not re-add it. */
  | { status: "REBOUND"; previousToken: number; newToken: number }
  | {
      status: "TOKEN_REBIND_REQUIRES_SUBSCRIPTION_RECONCILIATION";
      previousToken: number;
      desiredToken: number;
      detail: string;
    }
  | { status: "REJECTED"; reason: string; detail: string };

export interface PendingReconciliation {
  canonicalInstrumentId: string;
  /** The token that is still active and subscribed. */
  activeToken: number;
  /** The token the provider master now advertises. */
  desiredToken: number;
  detail: string;
  recordedAtMs: number;
}

/**
 * Identities whose provider token could not be safely rotated. They keep
 * working on their existing token; a later controlled resubscription cycle
 * can drain this.
 */
const pending = new Map<string, PendingReconciliation>();

export function listPendingSubscriptionReconciliations(): PendingReconciliation[] {
  return [...pending.values()];
}

export function pendingReconciliationCount(): number {
  return pending.size;
}

/**
 * Test-only reset, mirroring instrumentRegistry.clear() / clearQuotes().
 * Named with the _forTesting_ prefix so a production caller is grep-visible.
 * Production callers: zero.
 */
export function _forTesting_clearPendingReconciliations(): void {
  pending.clear();
}

/** Is this identity awaiting a controlled resubscription? */
export function isReconciliationPending(canonicalInstrumentId: string): boolean {
  return pending.has(canonicalInstrumentId);
}

// ---------------------------------------------------------------------------
// Diagnostics serialization
//
// Draining the queue is deliberately NOT implemented here — that belongs to
// the future controlled subscription-reconciliation phase. What IS required
// before then is that a deferred rotation can never hide: it must be visible
// in status output, and an affected identity must never be presented as a
// current, LIVE instrument.
//
// The derivers below are PURE so the safety rules are unit-testable without a
// socket, a clock, or a DB, matching the marketDataHealth.ts convention.
// ---------------------------------------------------------------------------

export type TokenReconciliationState = "NONE" | "TOKEN_RECONCILIATION_PENDING";

/**
 * PUBLIC shape. State and count ONLY — deliberately no canonical ids, no
 * provider tokens, no failure detail strings, and never any credential or
 * provider secret.
 */
export interface PublicTokenReconciliationStatus {
  state: TokenReconciliationState;
  pendingReconciliationCount: number;
}

/** OWNER shape. Adds the exact identity/token detail an operator needs. */
export interface OwnerReconciliationEntry {
  canonicalInstrumentId: string;
  /** The token still subscribed and serving ticks. */
  activeToken: number;
  /** The token the provider master now advertises. */
  desiredToken: number;
  detail: string;
  recordedAt: string;
  lastTickTs: number | null;
  lastTickAgeSec: number | null;
  /** True once the newest tick for this identity is older than the freshness budget. */
  tickFreshnessExpired: boolean;
  /** ALWAYS false — a pending identity is not a current provider mapping. */
  current: false;
  /** ALWAYS false — a pending identity is never presentable as LIVE. */
  liveLabelEligible: false;
  code: "TOKEN_RECONCILIATION_PENDING";
}

export interface OwnerTokenReconciliationDiagnostics extends PublicTokenReconciliationStatus {
  pending: OwnerReconciliationEntry[];
}

/** PURE. */
export function buildPublicTokenReconciliationStatus(
  pendingCount: number,
): PublicTokenReconciliationStatus {
  return {
    state: pendingCount > 0 ? "TOKEN_RECONCILIATION_PENDING" : "NONE",
    pendingReconciliationCount: pendingCount,
  };
}

/**
 * PURE. `freshnessBudgetSec` is supplied by the caller from the EXISTING
 * freshness policy — this module defines no threshold of its own.
 */
export function buildOwnerTokenReconciliationDiagnostics(input: {
  pending: PendingReconciliation[];
  lastTickTsById: Record<string, number | null>;
  nowMs: number;
  freshnessBudgetSec: number;
}): OwnerTokenReconciliationDiagnostics {
  const entries: OwnerReconciliationEntry[] = input.pending.map((p) => {
    const ts = input.lastTickTsById[p.canonicalInstrumentId] ?? null;
    const ageSec = ts == null ? null : Math.max(0, (input.nowMs - ts) / 1000);
    return {
      canonicalInstrumentId: p.canonicalInstrumentId,
      activeToken: p.activeToken,
      desiredToken: p.desiredToken,
      detail: p.detail,
      recordedAt: new Date(p.recordedAtMs).toISOString(),
      lastTickTs: ts,
      lastTickAgeSec: ageSec,
      // No tick at all is treated as expired, not as "fresh by default".
      tickFreshnessExpired: ageSec == null ? true : ageSec > input.freshnessBudgetSec,
      current: false,
      liveLabelEligible: false,
      code: "TOKEN_RECONCILIATION_PENDING",
    };
  });
  entries.sort((a, b) => a.canonicalInstrumentId.localeCompare(b.canonicalInstrumentId));
  return { ...buildPublicTokenReconciliationStatus(entries.length), pending: entries };
}

/** Owner diagnostics over live process state. */
export function tokenReconciliationDiagnostics(
  nowMs: number = Date.now(),
): OwnerTokenReconciliationDiagnostics {
  const list = listPendingSubscriptionReconciliations();
  const lastTickTsById: Record<string, number | null> = {};
  for (const p of list) {
    lastTickTsById[p.canonicalInstrumentId] =
      getQuoteByCanonicalId(p.canonicalInstrumentId)?.ts ?? null;
  }
  return buildOwnerTokenReconciliationDiagnostics({
    pending: list,
    lastTickTsById,
    nowMs,
    freshnessBudgetSec: getPolicy().freshnessBudgetSec,
  });
}

/**
 * Owner diagnostics as a REDACTED, emit-safe payload — Phase 0.8E.
 *
 * WHY a second serializer instead of changing `tokenReconciliationDiagnostics`:
 * the typed builder above is consumed by callers that need the exact
 * `OwnerTokenReconciliationDiagnostics` shape; changing its return type would
 * ripple. This wrapper is the boundary that OWNER-FACING serializers should use
 * when the payload is about to be emitted. It routes the payload through the
 * structured, key-aware redactor.
 *
 * The redactor is the reason the old substring rule was retired: the top-level
 * `tokenReconciliation` field name (and the safe count/state under it) is on the
 * ALLOW list, so it SURVIVES — whereas the previous `/token/i` blanking would
 * have destroyed it — while any credential-shaped key or value that ever leaked
 * into a `detail` string is still removed, fail-closed.
 */
export function tokenReconciliationOwnerDiagnosticsRedacted(
  nowMs: number = Date.now(),
): unknown {
  // Nest under `tokenReconciliation` so the allow-list survival is exercised at
  // the wire-in, not only in tests, and so the owner payload is self-describing.
  return redactForOwnerDiagnostics({
    tokenReconciliation: tokenReconciliationDiagnostics(nowMs),
  });
}

/** Safe status for public surfaces. */
export function publicTokenReconciliationStatus(): PublicTokenReconciliationStatus {
  return buildPublicTokenReconciliationStatus(pendingReconciliationCount());
}

/**
 * Bring `canonicalInstrumentId`'s provider token in line with `desiredToken`,
 * without ever leaving an orphan subscription behind and without ever leaving
 * the instrument with no active token.
 */
export function reconcileProviderToken(args: {
  canonicalInstrumentId: string;
  desiredToken: number;
  port: SubscriptionPort;
  nowMs: number;
}): ReconcileOutcome {
  const { canonicalInstrumentId, desiredToken, port, nowMs } = args;

  const prep = instrumentRegistry.prepareTokenRebind(canonicalInstrumentId, desiredToken);

  switch (prep.status) {
    case "NOT_REQUIRED":
      // Already correct — clear any stale pending record for this identity.
      pending.delete(canonicalInstrumentId);
      return { status: "NOT_REQUIRED" };
    case "UNKNOWN_IDENTITY":
      // Nothing to reconcile; the caller will register it fresh.
      return { status: "NOT_REQUIRED" };
    case "INVALID_PROVIDER_TOKEN":
      return { status: "REJECTED", reason: "INVALID_PROVIDER_TOKEN", detail: String(desiredToken) };
    case "TOKEN_OWNED_BY_OTHER_IDENTITY":
      return {
        status: "REJECTED",
        reason: "DUPLICATE_TOKEN_CONFLICT",
        detail: `token ${desiredToken} already resolves to ${prep.owner}`,
      };
    case "REBIND_REQUIRED":
      break;
  }

  const previousToken = prep.previousToken;

  const wasSubscribed = port.isSubscribed(previousToken);

  const defer = (detail: string): ReconcileOutcome => {
    pending.set(canonicalInstrumentId, {
      canonicalInstrumentId,
      activeToken: previousToken,
      desiredToken,
      detail,
      recordedAtMs: nowMs,
    });
    return {
      status: "TOKEN_REBIND_REQUIRES_SUBSCRIPTION_RECONCILIATION",
      previousToken,
      desiredToken,
      detail,
    };
  };

  /**
   * Put the old token back on the wire after a mid-rotation failure.
   * Returns false if even that failed — the caller must surface that, because
   * it is the one case where the instrument is left without an active token.
   */
  const restorePrevious = (): boolean => {
    if (!wasSubscribed) return true;
    try {
      port.subscribeToken(previousToken);
      port.markSubscribed(previousToken);
      return true;
    } catch {
      return false;
    }
  };

  // 1. Retire the old subscription FIRST. Nothing else has been mutated yet,
  //    so a failure here is completely inert.
  if (wasSubscribed) {
    try {
      port.unsubscribe(previousToken);
    } catch (err) {
      return defer(`unsubscribe of retired token ${previousToken} failed: ${(err as Error).message}`);
    }
    // 2. Only now is it off the wire.
    port.markUnsubscribed(previousToken);
  }

  // 3. Bring the replacement online BEFORE committing, so that a subscribe
  //    failure can still be unwound. Deferring this to the caller's batch
  //    subscribe would risk retiring the old token and never subscribing the
  //    new one, leaving the instrument dark.
  try {
    port.subscribeToken(desiredToken);
  } catch (err) {
    const why = `subscribe of replacement token ${desiredToken} failed: ${(err as Error).message}`;
    // Escalate when the old token could not be put back: that is the only
    // path that leaves the instrument with no active token at all.
    return defer(restorePrevious() ? why : `${why}; the previous token could not be restored`);
  }

  // 4. Re-point identity resolution.
  const commit = instrumentRegistry.commitTokenRebind(canonicalInstrumentId, desiredToken);
  if (!commit.ok) {
    // Unwind the replacement subscription so it cannot become an orphan of
    // its own, then restore the previous token.
    try {
      port.unsubscribe(desiredToken);
    } catch { /* best effort — it was never marked subscribed */ }
    if (!restorePrevious()) {
      pending.set(canonicalInstrumentId, {
        canonicalInstrumentId,
        activeToken: previousToken,
        desiredToken,
        detail: `commit failed (${commit.reason}); the previous token could not be restored`,
        recordedAtMs: nowMs,
      });
    }
    return { status: "REJECTED", reason: commit.reason, detail: commit.detail };
  }

  // 5. The replacement is live and owns the identity.
  port.markSubscribed(desiredToken);
  // The cached quote was priced off a token that no longer identifies this
  // instrument, so it is not attributable.
  port.evictQuote(canonicalInstrumentId);
  pending.delete(canonicalInstrumentId);

  return { status: "REBOUND", previousToken, newToken: desiredToken };
}
