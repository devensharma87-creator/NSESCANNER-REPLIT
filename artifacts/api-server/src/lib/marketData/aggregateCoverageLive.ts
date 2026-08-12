/**
 * Phase 0.5B — live assembly of the aggregate coverage contract.
 *
 * This is the thin, impure edge that reads real in-process state and hands it
 * to the PURE derivers in `aggregateCoverage.ts`. It:
 *
 *   - makes NO provider calls (Kite / Upstox / IndianAPI / Yahoo)
 *   - performs NO database reads or writes
 *   - registers NO scheduler, timer, or interval
 *   - changes NO subscription
 *   - defines NO threshold (freshness comes from the existing policy, the
 *     market calendar from the existing marketEvents module)
 *
 * It only observes state that other code has already produced.
 */

import { instrumentRegistry } from "../canonicalInstrument";
import { allQuotesByCanonicalId } from "../liveQuoteStore";
import { getMarketStatusDetail, isNseHoliday } from "../marketEvents";
import { listPendingSubscriptionReconciliations } from "../providerTokenReconciliation";
import { getPolicy } from "./policy";
import {
  AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED,
  buildObservations,
  classifyInstrument,
  deriveAggregateCoverage,
  deriveMarketPhase,
  type AggregateMarketDataHealth,
  type InstrumentObservation,
  type MarketPhase,
  type UniverseManifest,
} from "./aggregateCoverage";

/**
 * The denominator this deployment has actually configured.
 *
 * IMPORTANT: this is the legacy partial feed (~50 NSE equities + 8 distinct
 * index tokens), NOT the website's claimed universe. Its authority is
 * therefore LEGACY_PARTIAL_CONFIGURATION and its reconciliation is invalid,
 * so it can never satisfy a completeness claim.
 */
export const CONFIGURED_UNIVERSE_SCOPE_ID = "LEGACY_CONFIGURED_FEED";

/**
 * PURE-ish: the most recently completed IST trading date (YYYY-MM-DD), or null
 * when the market is currently open (there is no completed session yet today).
 *
 * Derived entirely from the EXISTING calendar primitives — no new holiday
 * data, no new session boundary. Walks back at most a bounded number of days
 * so a calendar gap can never spin.
 */
export function lastCompletedTradingDateIst(now: Date): string | null {
  const MAX_LOOKBACK_DAYS = 10;
  const detail = getMarketStatusDetail(now);
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;

  // Today counts as a completed session only once the regular session is over.
  const todayIsComplete = detail.isTradingDay && detail.reason === "AFTER_CLOSE";
  let cursor = new Date(istMs);
  if (!todayIsComplete) cursor = new Date(istMs - 24 * 60 * 60 * 1000);

  for (let i = 0; i < MAX_LOOKBACK_DAYS; i++) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6 && !isNseHoliday(cursor)) {
      return cursor.toISOString().slice(0, 10);
    }
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  }
  return null; // calendar cannot resolve a recent session — fail closed
}

export interface LiveFeedFacts {
  /** Provider tokens currently subscribed. */
  subscribedTokens: number[];
  /** Is the provider socket healthy? */
  connected: boolean;
  running: boolean;
}

/**
 * Assemble the aggregate coverage contract from live in-process state.
 *
 * `nowMs` is injectable so callers and tests share one clock.
 */
export function buildLiveAggregateCoverage(
  feed: LiveFeedFacts,
  nowMs: number = Date.now(),
): AggregateMarketDataHealth {
  const now = new Date(nowMs);
  const detail = getMarketStatusDetail(now);
  const marketPhase: MarketPhase = deriveMarketPhase(detail);
  const freshnessBudgetSec = getPolicy().freshnessBudgetSec;

  const identities = instrumentRegistry.listAll();
  const quotes = allQuotesByCanonicalId();
  const subscribed = new Set(feed.subscribedTokens);

  const pendingIds = new Set(
    listPendingSubscriptionReconciliations().map(p => p.canonicalInstrumentId),
  );

  const currentTradingDate = lastCompletedTradingDateIst(now);

  /**
   * OPEN GAP (reported, not fabricated): the live quote store holds last
   * TRADED ticks, not a verified canonical session close. `sessionCloseVerified`
   * therefore stays false for every instrument, so nothing can be asserted as
   * MARKET_CLOSED_FINAL and everything degrades honestly to LAST_KNOWN once the
   * market shuts. Populating it requires a verified official-close source,
   * which is a separate authorized phase.
   *
   * Likewise, no cross-provider comparison runs on this path, so no instrument
   * can be PROVEN conflicted here. "Not conflicted" means unmeasured, not
   * verified-agreeing.
   */
  const observations: InstrumentObservation[] = buildObservations({
    identities,
    quotesByCanonicalId: Object.fromEntries(
      Object.entries(quotes).map(([id, t]) => [id, { provider: t.provider, ts: t.ts }]),
    ),
    subscribedTokens: subscribed,
    pendingInstrumentIds: pendingIds,
    conflictedInstrumentIds: new Set<string>(),
  });

  const requiredInstrumentIds = observations.map(o => o.canonicalInstrumentId);

  const configuredManifest: UniverseManifest = {
    universeScopeId: CONFIGURED_UNIVERSE_SCOPE_ID,
    // The configured feed is a hardcoded legacy list, not a generated,
    // versioned artefact — so it has no generation identity to report.
    universeGenerationId: null,
    universeGeneratedAt: null,
    coverageAuthority:
      requiredInstrumentIds.length === 0
        ? "UNIVERSE_NOT_CONFIGURED"
        : "LEGACY_PARTIAL_CONFIGURATION",
    universeReconciliationValid: false,
    requiredInstrumentIds,
    subscriptionRequestedCount: requiredInstrumentIds.length,
  };

  const ctx = { nowMs, freshnessBudgetSec, marketPhase, currentTradingDate };
  const classifications = observations.map(o => classifyInstrument(o, ctx));

  return deriveAggregateCoverage({
    manifest: configuredManifest,
    authoritativeManifest: AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED,
    classifications,
    registeredInstrumentCount: identities.length,
    pendingReconciliationCount: pendingIds.size,
    marketPhase,
    freshnessBudgetSec,
    nowMs,
    // CONNECTED, not merely running. The feed supervisor can be "running"
    // while the socket is down, in which case recent cached ticks would still
    // satisfy every freshness check and a completeness claim could be made
    // over a dead connection. Live completeness requires a live socket.
    providerFeedHealthy: feed.connected === true,
    // NOT_CHECKED, and it must stay that way until a real cross-provider
    // comparison exists. The Upstox comparison is not implemented, so the
    // conflicted set above is empty because NOBODY LOOKED — never because
    // providers were observed to agree.
    conflictObservation: "NOT_CHECKED",
  });
}
