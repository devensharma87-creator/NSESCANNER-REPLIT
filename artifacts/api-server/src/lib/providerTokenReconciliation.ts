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

/** Test-only reset, mirroring instrumentRegistry.clear() / clearQuotes(). */
export function clearPendingReconciliations(): void {
  pending.clear();
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
