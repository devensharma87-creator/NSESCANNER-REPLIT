/**
 * Phase 0.5B — SECTION J: the 30 required tests for truthful aggregate
 * market-data status, freshness and coverage.
 *
 * Every input here is a deterministic fixture built inside the test. No
 * fixture is written to a production store, no provider is called, no database
 * is touched, and no timer is registered. The clock is a fixed constant.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import {
  AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED,
  buildObservations,
  classifyInstrument,
  coveragePct,
  deriveAggregateCoverage,
  deriveMarketPhase,
  partitionBucketFor,
  toPublicAggregateCoverage,
  validateCoverageCounts,
  type AggregateMarketDataHealth,
  type ClassificationContext,
  type InstrumentObservation,
  type MarketPhase,
  type ObservationSourceIdentity,
  type ObservationTick,
  type UniverseManifest,
} from "./aggregateCoverage";
import { CLOCK_SKEW_TOLERANCE_SEC } from "./freshness";
import { getPolicy } from "./policy";

// ---------------------------------------------------------------------------
// Deterministic fixtures
// ---------------------------------------------------------------------------

/** Fixed clock: 2026-08-11T10:00:00.000Z == 15:30 IST. */
const NOW_MS = Date.UTC(2026, 7, 11, 10, 0, 0);
const BUDGET = 90; // mirrors the existing policy default; asserted in test 12

const SRC = join(__dirname, "..");

function ident(
  id: string,
  token: number,
  exchange: "NSE" | "BSE" = "NSE",
): ObservationSourceIdentity {
  return { canonicalInstrumentId: id, exchange, providerInstrumentToken: token };
}

function freshTick(ageSec = 1): ObservationTick {
  return { provider: "KITE", ts: NOW_MS - ageSec * 1000 };
}

function ctx(over: Partial<ClassificationContext> = {}): ClassificationContext {
  return {
    nowMs: NOW_MS,
    freshnessBudgetSec: BUDGET,
    marketPhase: "OPEN",
    currentTradingDate: "2026-08-11",
    ...over,
  };
}

function manifest(
  ids: string[],
  over: Partial<UniverseManifest> = {},
): UniverseManifest {
  return {
    universeScopeId: "FIXTURE_UNIVERSE",
    universeGenerationId: "gen-1",
    universeGeneratedAt: "2026-08-11T00:00:00.000Z",
    coverageAuthority: "AUTHORITATIVE_RECONCILED_UNIVERSE",
    universeReconciliationValid: true,
    requiredInstrumentIds: ids,
    subscriptionRequestedCount: ids.length,
    ...over,
  };
}

/** Build a complete, healthy authoritative universe of `n` NSE equities. */
function healthyUniverse(n: number, phase: MarketPhase = "OPEN"): AggregateMarketDataHealth {
  const identities = Array.from({ length: n }, (_, i) => ident(`NSE:EQUITY:SYM${i}`, 1000 + i));
  const quotes: Record<string, ObservationTick> = {};
  for (const idt of identities) quotes[idt.canonicalInstrumentId] = freshTick();

  return aggregate({
    identities,
    quotes,
    manifest: manifest(identities.map(i => i.canonicalInstrumentId)),
    phase,
  });
}

function aggregate(input: {
  identities: ObservationSourceIdentity[];
  quotes: Record<string, ObservationTick>;
  manifest: UniverseManifest;
  authoritativeManifest?: UniverseManifest;
  phase?: MarketPhase;
  pending?: Set<string>;
  conflicted?: Set<string>;
  unsubscribed?: Set<number>;
  registeredInstrumentCount?: number;
  providerFeedHealthy?: boolean;
  currentTradingDate?: string | null;
}): AggregateMarketDataHealth {
  const phase = input.phase ?? "OPEN";
  const subscribedTokens = new Set(
    input.identities
      .map(i => i.providerInstrumentToken)
      .filter(t => !(input.unsubscribed?.has(t) ?? false)),
  );
  const observations = buildObservations({
    identities: input.identities,
    quotesByCanonicalId: input.quotes,
    subscribedTokens,
    pendingInstrumentIds: input.pending ?? new Set(),
    conflictedInstrumentIds: input.conflicted ?? new Set(),
  });
  const c = ctx({
    marketPhase: phase,
    currentTradingDate:
      input.currentTradingDate === undefined ? "2026-08-11" : input.currentTradingDate,
  });
  return deriveAggregateCoverage({
    manifest: input.manifest,
    authoritativeManifest: input.authoritativeManifest ?? input.manifest,
    classifications: observations.map(o => classifyInstrument(o, c)),
    registeredInstrumentCount:
      input.registeredInstrumentCount ?? input.manifest.requiredInstrumentIds.length,
    pendingReconciliationCount: input.pending?.size ?? 0,
    marketPhase: phase,
    freshnessBudgetSec: BUDGET,
    nowMs: NOW_MS,
    providerFeedHealthy: input.providerFeedHealthy ?? true,
  });
}

// ---------------------------------------------------------------------------

describe("P0.5B-J — required tests 1–30", () => {
  // -- 1 -------------------------------------------------------------------
  it("J01: one fresh quote out of 1,000 required cannot produce LIVE_COMPLETE", () => {
    const identities = Array.from({ length: 1000 }, (_, i) => ident(`NSE:EQUITY:S${i}`, 5000 + i));
    const h = aggregate({
      identities,
      quotes: { "NSE:EQUITY:S0": freshTick() },
      manifest: manifest(identities.map(i => i.canonicalInstrumentId)),
    });

    expect(h.overallState).not.toBe("LIVE_COMPLETE");
    expect(h.overallState).toBe("LIVE_PARTIAL");
    expect(h.requiredInstrumentCount).toBe(1000);
    expect(h.freshInstrumentCount).toBe(1);
    expect(h.unavailableInstrumentCount).toBe(999);
    expect(h.blockers).toContain("TICK_COVERAGE_INCOMPLETE");
    expect(h.blockers).toContain("UNAVAILABLE_INSTRUMENTS_PRESENT");
  });

  // -- 2 -------------------------------------------------------------------
  it("J02: all legacy tokens fresh still cannot produce LIVE_COMPLETE without authority", () => {
    const identities = Array.from({ length: 58 }, (_, i) => ident(`NSE:EQUITY:L${i}`, 100 + i));
    const quotes: Record<string, ObservationTick> = {};
    for (const i of identities) quotes[i.canonicalInstrumentId] = freshTick();

    const legacy = manifest(identities.map(i => i.canonicalInstrumentId), {
      universeScopeId: "LEGACY_CONFIGURED_FEED",
      universeGenerationId: null,
      universeGeneratedAt: null,
      coverageAuthority: "LEGACY_PARTIAL_CONFIGURATION",
      universeReconciliationValid: false,
    });

    const h = aggregate({
      identities,
      quotes,
      manifest: legacy,
      authoritativeManifest: AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED,
    });

    // 100% of the CONFIGURED feed is fresh...
    expect(h.configured.coveragePct).toBe(100);
    // ...and it still may not claim completeness.
    expect(h.overallState).toBe("LIVE_PARTIAL");
    expect(h.blockers).toContain("AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED");
    expect(h.blockers).toContain("UNIVERSE_RECONCILIATION_INVALID");
    expect(h.authoritative.coverageAuthority).toBe("UNIVERSE_NOT_CONFIGURED");
    expect(h.authoritative.coveragePct).toBe(0);
  });

  // -- 3 -------------------------------------------------------------------
  it("J03: complete authoritative coverage produces LIVE_COMPLETE", () => {
    const h = healthyUniverse(25);
    expect(h.overallState).toBe("LIVE_COMPLETE");
    expect(h.freshInstrumentCount).toBe(25);
    expect(h.requiredInstrumentCount).toBe(25);
    expect(h.configured.coveragePct).toBe(100);
    expect(h.blockers).not.toContain("AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED");
    expect(h.blockers).not.toContain("STALE_INSTRUMENTS_PRESENT");
  });

  // -- 4 -------------------------------------------------------------------
  it("J04: one stale required instrument prevents LIVE_COMPLETE", () => {
    const identities = Array.from({ length: 10 }, (_, i) => ident(`NSE:EQUITY:S${i}`, 200 + i));
    const quotes: Record<string, ObservationTick> = {};
    for (const i of identities) quotes[i.canonicalInstrumentId] = freshTick();
    quotes["NSE:EQUITY:S3"] = freshTick(BUDGET + 1); // one second past budget

    const h = aggregate({
      identities, quotes,
      manifest: manifest(identities.map(i => i.canonicalInstrumentId)),
    });

    expect(h.overallState).toBe("LIVE_PARTIAL");
    expect(h.staleInstrumentCount).toBe(1);
    expect(h.freshInstrumentCount).toBe(9);
    expect(h.blockers).toContain("STALE_INSTRUMENTS_PRESENT");
  });

  // -- 5 -------------------------------------------------------------------
  it("J05: one unavailable required instrument prevents LIVE_COMPLETE", () => {
    const identities = Array.from({ length: 10 }, (_, i) => ident(`NSE:EQUITY:U${i}`, 300 + i));
    const quotes: Record<string, ObservationTick> = {};
    for (const i of identities) quotes[i.canonicalInstrumentId] = freshTick();
    delete quotes["NSE:EQUITY:U7"]; // never ticked

    const h = aggregate({
      identities, quotes,
      manifest: manifest(identities.map(i => i.canonicalInstrumentId)),
    });

    expect(h.overallState).toBe("LIVE_PARTIAL");
    expect(h.unavailableInstrumentCount).toBe(1);
    expect(h.blockers).toContain("UNAVAILABLE_INSTRUMENTS_PRESENT");
    expect(h.blockers).toContain("TICK_COVERAGE_INCOMPLETE");
  });

  // -- 6 -------------------------------------------------------------------
  it("J06: one conflicted required instrument prevents LIVE_COMPLETE", () => {
    const identities = Array.from({ length: 10 }, (_, i) => ident(`NSE:EQUITY:C${i}`, 400 + i));
    const quotes: Record<string, ObservationTick> = {};
    for (const i of identities) quotes[i.canonicalInstrumentId] = freshTick();

    const h = aggregate({
      identities, quotes,
      manifest: manifest(identities.map(i => i.canonicalInstrumentId)),
      conflicted: new Set(["NSE:EQUITY:C4"]),
    });

    expect(h.overallState).toBe("CONFLICTED");
    expect(h.conflictedInstrumentCount).toBe(1);
    expect(h.blockers).toContain("CONFLICTED_INSTRUMENTS_PRESENT");
  });

  // -- 7 -------------------------------------------------------------------
  it("J07: one pending reconciliation prevents LIVE_COMPLETE, even with a zero-age tick", () => {
    const identities = Array.from({ length: 10 }, (_, i) => ident(`NSE:EQUITY:P${i}`, 500 + i));
    const quotes: Record<string, ObservationTick> = {};
    for (const i of identities) quotes[i.canonicalInstrumentId] = freshTick(0);

    const h = aggregate({
      identities, quotes,
      manifest: manifest(identities.map(i => i.canonicalInstrumentId)),
      pending: new Set(["NSE:EQUITY:P2"]),
    });

    expect(h.overallState).toBe("RECONCILIATION_PENDING");
    expect(h.pendingReconciliationCount).toBe(1);
    expect(h.blockers).toContain("TOKEN_RECONCILIATION_PENDING");

    // The pending instrument is never LIVE despite a perfectly fresh tick.
    const cls = classifyInstrument(
      {
        canonicalInstrumentId: "NSE:EQUITY:P2", exchange: "NSE", provider: "KITE",
        exchangeTsMs: null, receivedTsMs: NOW_MS, subscribed: true,
        reconciliationPending: true, conflicted: false,
      },
      ctx(),
    );
    expect(cls.status).toBe("TOKEN_RECONCILIATION_PENDING");
    expect(cls.bucket).toBe("unavailable");
  });

  // -- 8 -------------------------------------------------------------------
  it("J08: identity-less ticks do not count", () => {
    const identities = [ident("NSE:EQUITY:REAL", 111)];
    const obs = buildObservations({
      identities,
      quotesByCanonicalId: {
        "NSE:EQUITY:REAL": freshTick(),
        // Neither of these is a registered canonical identity.
        "RELIANCE": freshTick(),
        "": freshTick(),
        "12345": freshTick(),
      },
      subscribedTokens: new Set([111]),
      pendingInstrumentIds: new Set(),
    });

    expect(obs).toHaveLength(1);
    expect(obs[0]!.canonicalInstrumentId).toBe("NSE:EQUITY:REAL");

    // A blank identity in the registry itself is also discarded.
    const obs2 = buildObservations({
      identities: [...identities, ident("   ", 222)],
      quotesByCanonicalId: { "NSE:EQUITY:REAL": freshTick() },
      subscribedTokens: new Set([111, 222]),
      pendingInstrumentIds: new Set(),
    });
    expect(obs2).toHaveLength(1);
  });

  // -- 9 -------------------------------------------------------------------
  it("J09: index aliases count once", () => {
    // Nine alias rows resolve to eight distinct index identities; the two
    // FINNIFTY aliases share one token and one canonical id.
    const identities: ObservationSourceIdentity[] = [
      ident("NSE:INDEX:NIFTY 50", 256265),
      ident("NSE:INDEX:NIFTY BANK", 260105),
      ident("NSE:INDEX:NIFTY FIN SERVICE", 257801),
      ident("NSE:INDEX:NIFTY FIN SERVICE", 257801), // same identity, second alias
    ];
    const obs = buildObservations({
      identities,
      quotesByCanonicalId: {
        "NSE:INDEX:NIFTY 50": freshTick(),
        "NSE:INDEX:NIFTY BANK": freshTick(),
        "NSE:INDEX:NIFTY FIN SERVICE": freshTick(),
      },
      subscribedTokens: new Set([256265, 260105, 257801]),
      pendingInstrumentIds: new Set(),
    });

    expect(obs).toHaveLength(3);
    expect(new Set(obs.map(o => o.canonicalInstrumentId)).size).toBe(3);
  });

  // -- 10 ------------------------------------------------------------------
  it("J10: NSE and BSE listings of one symbol count separately", () => {
    const identities = [
      ident("NSE:EQUITY:RELIANCE", 738561, "NSE"),
      ident("BSE:EQUITY:RELIANCE", 128083204, "BSE"),
    ];
    const obs = buildObservations({
      identities,
      quotesByCanonicalId: { "NSE:EQUITY:RELIANCE": freshTick() },
      subscribedTokens: new Set([738561, 128083204]),
      pendingInstrumentIds: new Set(),
    });

    expect(obs).toHaveLength(2);
    expect(obs.map(o => o.exchange).sort()).toEqual(["BSE", "NSE"]);

    // The BSE listing is unavailable; the NSE one is fresh. They never merge.
    const h = aggregate({
      identities,
      quotes: { "NSE:EQUITY:RELIANCE": freshTick() },
      manifest: manifest(["NSE:EQUITY:RELIANCE", "BSE:EQUITY:RELIANCE"]),
    });
    expect(h.requiredInstrumentCount).toBe(2);
    expect(h.freshInstrumentCount).toBe(1);
    expect(h.unavailableInstrumentCount).toBe(1);
    expect(h.overallState).toBe("LIVE_PARTIAL");
  });

  // -- 11 ------------------------------------------------------------------
  it("J11: freshness expiry changes the aggregate state", () => {
    const identities = [ident("NSE:EQUITY:ONE", 1)];
    const build = (ageSec: number) =>
      aggregate({
        identities,
        quotes: { "NSE:EQUITY:ONE": freshTick(ageSec) },
        manifest: manifest(["NSE:EQUITY:ONE"]),
      });

    const atBudget = build(BUDGET);       // exactly at the budget — still fresh
    const pastBudget = build(BUDGET + 1); // one second later — stale

    expect(atBudget.overallState).toBe("LIVE_COMPLETE");
    expect(atBudget.freshInstrumentCount).toBe(1);

    expect(pastBudget.overallState).toBe("STALE");
    expect(pastBudget.staleInstrumentCount).toBe(1);
    expect(pastBudget.freshInstrumentCount).toBe(0);
  });

  // -- 12 ------------------------------------------------------------------
  it("J12: the existing freshness threshold is reused unchanged", () => {
    // The budget comes from the existing approved policy, not from this module.
    expect(getPolicy().freshnessBudgetSec).toBe(BUDGET);

    const src = readFileSync(join(SRC, "marketData/aggregateCoverage.ts"), "utf8");
    // No threshold literal may be defined in the contract module.
    expect(src).not.toMatch(/freshnessBudgetSec\s*[:=]\s*\d+/);
    expect(src).not.toMatch(/FRESHNESS_BUDGET_SEC\s*=/);
    expect(src).not.toMatch(/STALE_BUDGET_SEC\s*=/);
    // Clock-skew tolerance is imported, never redefined.
    expect(src).toContain('import { CLOCK_SKEW_TOLERANCE_SEC } from "./freshness"');
    expect(src).not.toMatch(/CLOCK_SKEW_TOLERANCE_SEC\s*=/);
    expect(CLOCK_SKEW_TOLERANCE_SEC).toBe(5);

    const live = readFileSync(join(SRC, "marketData/aggregateCoverageLive.ts"), "utf8");
    expect(live).toContain("getPolicy().freshnessBudgetSec");
  });

  // -- 13 ------------------------------------------------------------------
  it("J13: market-open fresh state", () => {
    const h = healthyUniverse(5, "OPEN");
    expect(h.marketState).toBe("OPEN");
    expect(h.overallState).toBe("LIVE_COMPLETE");
    expect(h.blockers).not.toContain("MARKET_NOT_OPEN");

    const cls = classifyInstrument(
      {
        canonicalInstrumentId: "NSE:EQUITY:X", exchange: "NSE", provider: "KITE",
        exchangeTsMs: null, receivedTsMs: NOW_MS - 10_000, subscribed: true,
        reconciliationPending: false, conflicted: false,
      },
      ctx({ marketPhase: "OPEN" }),
    );
    expect(cls.status).toBe("LIVE");
  });

  // -- 14 ------------------------------------------------------------------
  it("J14: market-open stale state", () => {
    const identities = [ident("NSE:EQUITY:A", 1), ident("NSE:EQUITY:B", 2)];
    const h = aggregate({
      identities,
      quotes: {
        "NSE:EQUITY:A": freshTick(BUDGET + 60),
        "NSE:EQUITY:B": freshTick(BUDGET + 600),
      },
      manifest: manifest(["NSE:EQUITY:A", "NSE:EQUITY:B"]),
      phase: "OPEN",
    });

    expect(h.overallState).toBe("STALE");
    expect(h.staleInstrumentCount).toBe(2);
    expect(h.freshInstrumentCount).toBe(0);
  });

  // -- 15 ------------------------------------------------------------------
  it("J15: market-closed with a verified current-session close is CURRENT, not stale", () => {
    // A quote 6 hours old would be wildly stale during the session; after the
    // close, a VERIFIED official close for today's session is current.
    const identities = [ident("NSE:EQUITY:A", 1), ident("NSE:EQUITY:B", 2)];
    const closed: ObservationTick = {
      provider: "KITE",
      ts: NOW_MS - 6 * 3600 * 1000,
      sessionCloseVerified: true,
      sessionCloseTradingDate: "2026-08-11",
    };
    const h = aggregate({
      identities,
      quotes: { "NSE:EQUITY:A": closed, "NSE:EQUITY:B": closed },
      manifest: manifest(["NSE:EQUITY:A", "NSE:EQUITY:B"]),
      phase: "CLOSED_TRADING_DAY",
    });

    expect(h.overallState).toBe("MARKET_CLOSED_CURRENT");
    expect(h.freshInstrumentCount).toBe(2);
    expect(h.staleInstrumentCount).toBe(0);
    expect(h.blockers).toContain("MARKET_NOT_OPEN");
    expect(h.blockers).not.toContain("STALE_INSTRUMENTS_PRESENT");

    const cls = classifyInstrument(
      {
        canonicalInstrumentId: "NSE:EQUITY:A", exchange: "NSE", provider: "KITE",
        exchangeTsMs: null, receivedTsMs: closed.ts, subscribed: true,
        reconciliationPending: false, conflicted: false,
        sessionCloseVerified: true, sessionCloseTradingDate: "2026-08-11",
      },
      ctx({ marketPhase: "CLOSED_TRADING_DAY" }),
    );
    expect(cls.status).toBe("MARKET_CLOSED_FINAL");
  });

  // -- 16 ------------------------------------------------------------------
  it("J16: market-closed partial state when only some closes are verified", () => {
    const identities = [ident("NSE:EQUITY:A", 1), ident("NSE:EQUITY:B", 2), ident("NSE:EQUITY:C", 3)];
    const h = aggregate({
      identities,
      quotes: {
        "NSE:EQUITY:A": {
          provider: "KITE", ts: NOW_MS - 6 * 3600 * 1000,
          sessionCloseVerified: true, sessionCloseTradingDate: "2026-08-11",
        },
        // Unverified: a last traded tick, not a canonical close.
        "NSE:EQUITY:B": { provider: "KITE", ts: NOW_MS - 6 * 3600 * 1000 },
        // Verified, but for a PREVIOUS session.
        "NSE:EQUITY:C": {
          provider: "KITE", ts: NOW_MS - 30 * 3600 * 1000,
          sessionCloseVerified: true, sessionCloseTradingDate: "2026-08-10",
        },
      },
      manifest: manifest(["NSE:EQUITY:A", "NSE:EQUITY:B", "NSE:EQUITY:C"]),
      phase: "CLOSED_TRADING_DAY",
    });

    expect(h.overallState).toBe("MARKET_CLOSED_PARTIAL");
    expect(h.freshInstrumentCount).toBe(1);
    expect(h.staleInstrumentCount).toBe(2); // both are LAST_KNOWN
  });

  // -- 17 ------------------------------------------------------------------
  it("J17: holiday and weekend reuse latest-close handling", () => {
    const identities = [ident("NSE:EQUITY:A", 1)];
    const verified: ObservationTick = {
      provider: "KITE", ts: NOW_MS - 48 * 3600 * 1000,
      sessionCloseVerified: true, sessionCloseTradingDate: "2026-08-07",
    };

    for (const phase of ["WEEKEND", "HOLIDAY"] as const) {
      const h = aggregate({
        identities,
        quotes: { "NSE:EQUITY:A": verified },
        manifest: manifest(["NSE:EQUITY:A"]),
        phase,
        currentTradingDate: "2026-08-07",
      });
      expect(h.marketState).toBe(phase);
      expect(h.overallState).toBe("MARKET_CLOSED_CURRENT");
      expect(h.freshInstrumentCount).toBe(1);
    }

    // The calendar mapping itself is derived from the existing reason codes.
    expect(deriveMarketPhase({ reason: "WEEKEND", marketOpen: false, isTradingDay: false })).toBe("WEEKEND");
    expect(deriveMarketPhase({ reason: "HOLIDAY", marketOpen: false, isTradingDay: false })).toBe("HOLIDAY");
    expect(deriveMarketPhase({ reason: "AFTER_CLOSE", marketOpen: false, isTradingDay: true })).toBe("CLOSED_TRADING_DAY");
    expect(deriveMarketPhase({ reason: "OPEN", marketOpen: true, isTradingDay: true })).toBe("OPEN");
  });

  // -- 18 ------------------------------------------------------------------
  it("J18: an unknown market calendar fails closed", () => {
    expect(deriveMarketPhase({ reason: "GARBAGE", marketOpen: true, isTradingDay: true })).toBe("UNKNOWN");
    expect(deriveMarketPhase({ reason: "", marketOpen: true, isTradingDay: true })).toBe("UNKNOWN");
    // A reason of OPEN that disagrees with marketOpen is not trusted as open.
    expect(deriveMarketPhase({ reason: "OPEN", marketOpen: false, isTradingDay: true })).toBe("CLOSED_TRADING_DAY");

    const identities = [ident("NSE:EQUITY:A", 1)];
    const h = aggregate({
      identities,
      quotes: { "NSE:EQUITY:A": freshTick(0) },
      manifest: manifest(["NSE:EQUITY:A"]),
      phase: "UNKNOWN",
    });

    // A zero-age tick still cannot be called live when we don't know the phase.
    expect(h.overallState).toBe("UNAVAILABLE");
    expect(h.blockers).toContain("MARKET_CALENDAR_UNKNOWN");
    expect(h.freshInstrumentCount).toBe(0);
  });

  // -- 19 ------------------------------------------------------------------
  it("J19: the partition equation reconciles, with pending as an excluded overlay", () => {
    const identities = Array.from({ length: 20 }, (_, i) => ident(`NSE:EQUITY:Q${i}`, 700 + i));
    const quotes: Record<string, ObservationTick> = {};
    for (let i = 0; i < 20; i++) {
      const id = `NSE:EQUITY:Q${i}`;
      if (i < 8) quotes[id] = freshTick();
      else if (i < 14) quotes[id] = freshTick(BUDGET + 10);
      // 14..19 never ticked
    }
    const h = aggregate({
      identities, quotes,
      manifest: manifest(identities.map(i => i.canonicalInstrumentId)),
      pending: new Set(["NSE:EQUITY:Q0", "NSE:EQUITY:Q1"]),
      conflicted: new Set(["NSE:EQUITY:Q2"]),
    });

    const partition =
      h.freshInstrumentCount + h.staleInstrumentCount +
      h.unavailableInstrumentCount + h.conflictedInstrumentCount;

    expect(partition).toBe(h.requiredInstrumentCount);
    expect(partition).toBe(20);

    // Pending is an OVERLAY: excluded from the partition, but still reported.
    expect(h.pendingReconciliationCount).toBe(2);
    expect(partition + h.pendingReconciliationCount).not.toBe(h.requiredInstrumentCount);
    // Each pending instrument occupies exactly one bucket (unavailable).
    expect(h.conflictedInstrumentCount).toBe(1);
    expect(h.freshInstrumentCount).toBe(5); // 8 fresh minus 2 pending minus 1 conflicted

    // Monotonic ordering holds.
    expect(h.freshInstrumentCount).toBeLessThanOrEqual(h.tickedInstrumentCount);
    expect(h.tickedInstrumentCount).toBeLessThanOrEqual(h.subscribedInstrumentCount);
    expect(h.subscribedInstrumentCount).toBeLessThanOrEqual(h.subscriptionRequestedCount);
    expect(h.configured.coveragePct).toBeLessThanOrEqual(100);
  });

  // -- 20 ------------------------------------------------------------------
  it("J20: impossible counts are rejected", () => {
    const base = {
      requiredInstrumentCount: 10, registeredInstrumentCount: 10,
      subscriptionRequestedCount: 10, subscribedInstrumentCount: 10,
      tickedInstrumentCount: 10, freshInstrumentCount: 10,
      staleInstrumentCount: 0, unavailableInstrumentCount: 0,
      conflictedInstrumentCount: 0, pendingReconciliationCount: 0,
    };
    expect(validateCoverageCounts(base, { authoritative: true })).toEqual([]);

    expect(validateCoverageCounts({ ...base, freshInstrumentCount: 11, requiredInstrumentCount: 11 }, { authoritative: true }))
      .toContain("freshInstrumentCount > tickedInstrumentCount");
    expect(validateCoverageCounts({ ...base, staleInstrumentCount: 5 }, { authoritative: true }).join())
      .toContain("partition");
    expect(validateCoverageCounts({ ...base, freshInstrumentCount: -1 }, { authoritative: true }))
      .toContain("freshInstrumentCount is negative");
    expect(validateCoverageCounts({ ...base, tickedInstrumentCount: Number.NaN }, { authoritative: true }))
      .toContain("tickedInstrumentCount is not finite");
    expect(validateCoverageCounts({ ...base, subscribedInstrumentCount: 99 }, { authoritative: true }))
      .toContain("subscribedInstrumentCount > subscriptionRequestedCount");
    expect(validateCoverageCounts({ ...base, registeredInstrumentCount: 99 }, { authoritative: true }))
      .toContain("registeredInstrumentCount > requiredInstrumentCount");

    // A violating count set degrades the aggregate rather than reporting green.
    const h = deriveAggregateCoverage({
      manifest: manifest(["NSE:EQUITY:A"]),
      authoritativeManifest: manifest(["NSE:EQUITY:A"]),
      classifications: [], // zero classifications against a required count of 1
      registeredInstrumentCount: 1,
      pendingReconciliationCount: 0,
      marketPhase: "OPEN",
      freshnessBudgetSec: BUDGET,
      nowMs: NOW_MS,
      providerFeedHealthy: true,
    });
    expect(h.overallState).toBe("UNAVAILABLE");
    expect(h.blockers).toContain("IMPOSSIBLE_COUNTS");

    expect(coveragePct(5, 0)).toBe(0);
    expect(coveragePct(50, 100)).toBe(50);
    expect(coveragePct(999, 10)).toBe(100); // bounded
  });

  // -- 21 ------------------------------------------------------------------
  it("J21: public diagnostics expose no sensitive details", () => {
    const identities = [ident("NSE:EQUITY:RELIANCE", 738561), ident("BSE:EQUITY:RELIANCE", 128083204, "BSE")];
    const h = aggregate({
      identities,
      quotes: { "NSE:EQUITY:RELIANCE": freshTick() },
      manifest: manifest(["NSE:EQUITY:RELIANCE", "BSE:EQUITY:RELIANCE"], {
        universeScopeId: "LEGACY_CONFIGURED_FEED",
        coverageAuthority: "LEGACY_PARTIAL_CONFIGURATION",
        universeReconciliationValid: false,
      }),
      authoritativeManifest: AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED,
      pending: new Set(["BSE:EQUITY:RELIANCE"]),
    });

    const pub = toPublicAggregateCoverage(h);
    const json = JSON.stringify(pub);

    // No canonical identities, symbols, or provider tokens leak.
    expect(json).not.toContain("RELIANCE");
    expect(json).not.toContain("NSE:EQUITY");
    expect(json).not.toContain("BSE:EQUITY");
    expect(json).not.toContain("738561");
    expect(json).not.toContain("128083204");

    // No credential-bearing or raw-connection field may appear. The word
    // "token" is checked against KEYS only, because TOKEN_RECONCILIATION_PENDING
    // is a legitimate, non-sensitive blocker VALUE.
    const keys = new Set<string>();
    JSON.stringify(pub, (k, v) => { if (k) keys.add(k.toLowerCase()); return v; });
    for (const banned of ["token", "accesstoken", "apikey", "secret", "credential", "password", "session", "cookie"]) {
      for (const k of keys) expect(k).not.toContain(banned);
    }
    // Every string value must be a known-safe SHAPE: an enum-style
    // SCREAMING_SNAKE code or an ISO timestamp. Nothing free-form, so no
    // symbol, identity, or opaque credential can ride along.
    const ENUM = /^[A-Z][A-Z0-9_]*$/;
    const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    JSON.stringify(pub, (_k, v) => {
      if (typeof v === "string") expect(ENUM.test(v) || ISO.test(v)).toBe(true);
      return v;
    });

    // But the counts the user needs ARE present.
    expect(pub.requiredInstrumentCount).toBe(2);
    expect(pub.freshInstrumentCount).toBe(1);
    expect(pub.pendingReconciliationCount).toBe(1);
    expect(pub.blockers.length).toBeGreaterThan(0);
    expect(pub.authoritative.coverageAuthority).toBe("UNIVERSE_NOT_CONFIGURED");
  });

  // -- 22 ------------------------------------------------------------------
  it("J22: owner diagnostics remain strictly authenticated", () => {
    const routes = readFileSync(join(SRC, "../routes/kite.ts"), "utf8");
    // /kite/* is gated by a router-level middleware. /status and /login-url
    // take the STRICT gate, which (unlike requireOwner) does not let an
    // anonymous GET through on a public shared link. Phase 0.5B did not
    // downgrade it and did not add an exemption.
    expect(routes).toMatch(
      /if\s*\(\s*p === "\/status" \|\| p === "\/login-url"\s*\)\s*\{\s*return requireOwnerStrict\(req, res, next\);/,
    );
    const exemptions = routes.match(/if \(p === "\/callback"[^)]*\)/);
    expect(exemptions).not.toBeNull();
    expect(exemptions![0]).not.toContain("/status");
    expect(exemptions![0]).not.toContain("coverage");
  });

  // -- 23 ------------------------------------------------------------------
  it("J23: pending token details remain owner-only", () => {
    const h = healthyUniverse(3);
    const pub = toPublicAggregateCoverage(h);

    // The public projection carries a COUNT, never a per-instrument detail list.
    expect(typeof pub.pendingReconciliationCount).toBe("number");
    expect(Object.keys(pub)).not.toContain("pendingReconciliations");
    expect(Object.keys(pub)).not.toContain("classifications");
    expect(Object.keys(pub)).not.toContain("instruments");
    expect(Object.keys(pub)).not.toContain("configured");

    const health = readFileSync(join(SRC, "marketDataHealth.ts"), "utf8");
    expect(health).toContain("toPublicAggregateCoverage");
  });

  // -- 24 ------------------------------------------------------------------
  it("J24: the ~58-token legacy configuration reports partial, non-authoritative coverage", () => {
    const identities = Array.from({ length: 58 }, (_, i) => ident(`NSE:EQUITY:N${i}`, 900 + i));
    const quotes: Record<string, ObservationTick> = {};
    for (const i of identities) quotes[i.canonicalInstrumentId] = freshTick();

    const h = aggregate({
      identities, quotes,
      manifest: manifest(identities.map(i => i.canonicalInstrumentId), {
        universeScopeId: "LEGACY_CONFIGURED_FEED",
        universeGenerationId: null,
        universeGeneratedAt: null,
        coverageAuthority: "LEGACY_PARTIAL_CONFIGURATION",
        universeReconciliationValid: false,
      }),
      authoritativeManifest: AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED,
    });

    expect(h.coverageAuthority).toBe("LEGACY_PARTIAL_CONFIGURATION");
    expect(h.universeReconciliationValid).toBe(false);
    expect(h.overallState).toBe("LIVE_PARTIAL");
    expect(h.overallState).not.toBe("LIVE_COMPLETE");
    expect(h.configured.requiredInstrumentCount).toBe(58);
    expect(h.authoritative.requiredInstrumentCount).toBe(0);
    expect(h.blockers).toContain("AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED");
  });

  // -- 25 ------------------------------------------------------------------
  it("J25: no safety lock was changed", () => {
    const locks = readFileSync(join(SRC, "v2PaperLocks.ts"), "utf8");
    expect(locks).toMatch(/FNO_PAPER_V2_RUNTIME_AUTHORIZED\s*(?::\s*boolean\s*)?=\s*false/);
    expect(locks).toMatch(/SWING_PAPER_V2_RUNTIME_AUTHORIZED\s*(?::\s*boolean\s*)?=\s*false/);

    const candle = readFileSync(join(SRC, "candleEvaluationControl.ts"), "utf8");
    expect(candle).toMatch(/SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED\s*(?::\s*boolean\s*)?=\s*false/);
    expect(candle).toMatch(/FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED\s*(?::\s*boolean\s*)?=\s*false/);
  });

  // -- 26 ------------------------------------------------------------------
  it("J26: no subscription-count change was introduced", () => {
    const lists = readFileSync(join(SRC, "watchlistLists.ts"), "utf8");
    const m = lists.match(/NIFTY50_SYMBOLS[^=]*=\s*\[([\s\S]*?)\];/);
    expect(m).not.toBeNull();
    const symbols = [...m![1]!.matchAll(/"([^"]+)"/g)].map(x => x[1]!);
    expect(symbols).toHaveLength(50);

    // Neither new module subscribes, unsubscribes, or expands any universe.
    for (const f of ["marketData/aggregateCoverage.ts", "marketData/aggregateCoverageLive.ts"]) {
      const src = readFileSync(join(SRC, f), "utf8");
      expect(src).not.toMatch(/\bsubscribe\s*\(/);
      expect(src).not.toMatch(/\bunsubscribe\s*\(/);
      expect(src).not.toContain("subscribeIndices");
      expect(src).not.toContain("ticker.");
    }
  });

  // -- 27 ------------------------------------------------------------------
  it("J27: no provider call was introduced", () => {
    for (const f of ["marketData/aggregateCoverage.ts", "marketData/aggregateCoverageLive.ts"]) {
      const src = readFileSync(join(SRC, f), "utf8");
      expect(src).not.toMatch(/\bfetch\s*\(/);
      expect(src).not.toContain("axios");
      expect(src).not.toContain("KiteConnect");
      expect(src).not.toContain("kiteClient");
      expect(src).not.toContain("yahoo");
      expect(src).not.toContain("upstox");
      expect(src).not.toContain("indianapi");
      expect(src).not.toContain("https://");
    }
  });

  // -- 28 ------------------------------------------------------------------
  it("J28: no scheduler was introduced", () => {
    for (const f of ["marketData/aggregateCoverage.ts", "marketData/aggregateCoverageLive.ts"]) {
      const src = readFileSync(join(SRC, f), "utf8");
      expect(src).not.toContain("setInterval");
      expect(src).not.toContain("setTimeout");
      expect(src).not.toContain("setImmediate");
      expect(src).not.toContain("cron");
      expect(src).not.toContain("node-schedule");
    }
  });

  // -- 29 ------------------------------------------------------------------
  it("J29: no per-tick database write was introduced", () => {
    for (const f of ["marketData/aggregateCoverage.ts", "marketData/aggregateCoverageLive.ts"]) {
      const src = readFileSync(join(SRC, f), "utf8");
      expect(src).not.toContain("drizzle");
      expect(src).not.toContain("@workspace/db");
      expect(src).not.toMatch(/\bdb\.(insert|update|delete|execute)\b/);
      // No tick-rate hook is registered. Word-boundary matched, because the
      // identifier `ObservationTick` legitimately contains the substring.
      expect(src).not.toMatch(/\baddTickListener\b/);
      expect(src).not.toMatch(/\bonTick\b/);
    }
  });

  // -- 30 ------------------------------------------------------------------
  it("J30: LIVE_COMPLETE is unreachable for legacy partial coverage (badge input)", () => {
    // The frontend renders whatever overallState it is given, so the binding
    // guarantee is that this state can never be produced from the legacy
    // configuration — under ANY market phase, and even at 100% configured
    // freshness. The scanner-side render assertion lives in the scanner suite.
    const identities = Array.from({ length: 58 }, (_, i) => ident(`NSE:EQUITY:B${i}`, 800 + i));
    const quotes: Record<string, ObservationTick> = {};
    for (const i of identities) {
      quotes[i.canonicalInstrumentId] = {
        provider: "KITE", ts: NOW_MS,
        sessionCloseVerified: true, sessionCloseTradingDate: "2026-08-11",
      };
    }
    const legacy = manifest(identities.map(i => i.canonicalInstrumentId), {
      universeScopeId: "LEGACY_CONFIGURED_FEED",
      coverageAuthority: "LEGACY_PARTIAL_CONFIGURATION",
      universeReconciliationValid: false,
    });

    const phases: MarketPhase[] = [
      "OPEN", "PRE_OPEN", "CLOSED_TRADING_DAY", "WEEKEND", "HOLIDAY", "UNKNOWN",
    ];
    for (const phase of phases) {
      const h = aggregate({
        identities, quotes, manifest: legacy,
        authoritativeManifest: AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED,
        phase,
      });
      expect(h.overallState).not.toBe("LIVE_COMPLETE");
      expect(h.overallState).not.toBe("MARKET_CLOSED_CURRENT");
      expect(h.blockers).toContain("AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED");
    }
  });
});

describe("P0.5B — supporting invariants", () => {
  it("every per-instrument status maps to exactly one partition bucket", () => {
    const all = [
      "LIVE", "CURRENT_SNAPSHOT", "LAST_KNOWN", "STALE",
      "UNAVAILABLE", "CONFLICTED", "MARKET_CLOSED_FINAL",
      "TOKEN_RECONCILIATION_PENDING",
    ] as const;
    for (const s of all) {
      expect(["fresh", "stale", "unavailable", "conflicted"]).toContain(partitionBucketFor(s));
    }
  });

  it("a future-dated timestamp beyond clock-skew tolerance is unavailable, never fresh", () => {
    const base: InstrumentObservation = {
      canonicalInstrumentId: "NSE:EQUITY:F", exchange: "NSE", provider: "KITE",
      exchangeTsMs: null, receivedTsMs: NOW_MS + (CLOCK_SKEW_TOLERANCE_SEC + 10) * 1000,
      subscribed: true, reconciliationPending: false, conflicted: false,
    };
    expect(classifyInstrument(base, ctx()).status).toBe("UNAVAILABLE");

    // Just inside tolerance is still accepted as live.
    const inTolerance = { ...base, receivedTsMs: NOW_MS + 1000 };
    expect(classifyInstrument(inTolerance, ctx()).status).toBe("LIVE");
  });

  it("conflict outranks pending reconciliation", () => {
    const cls = classifyInstrument(
      {
        canonicalInstrumentId: "NSE:EQUITY:Z", exchange: "NSE", provider: "KITE",
        exchangeTsMs: null, receivedTsMs: NOW_MS, subscribed: true,
        reconciliationPending: true, conflicted: true,
      },
      ctx(),
    );
    expect(cls.status).toBe("CONFLICTED");
  });

  it("an empty required universe reports UNIVERSE_NOT_CONFIGURED, not LIVE", () => {
    const h = deriveAggregateCoverage({
      manifest: manifest([], { coverageAuthority: "UNIVERSE_NOT_CONFIGURED", universeReconciliationValid: false }),
      authoritativeManifest: AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED,
      classifications: [],
      registeredInstrumentCount: 0,
      pendingReconciliationCount: 0,
      marketPhase: "OPEN",
      freshnessBudgetSec: BUDGET,
      nowMs: NOW_MS,
      providerFeedHealthy: true,
    });
    expect(h.overallState).toBe("UNIVERSE_NOT_CONFIGURED");
    expect(h.blockers).toContain("REQUIRED_UNIVERSE_EMPTY");
  });

  it("subscribed but not yet ticked reports INITIALIZING, not LIVE and not STALE", () => {
    const identities = [ident("NSE:EQUITY:A", 1), ident("NSE:EQUITY:B", 2)];
    const h = aggregate({
      identities, quotes: {},
      manifest: manifest(["NSE:EQUITY:A", "NSE:EQUITY:B"]),
    });
    expect(h.overallState).toBe("INITIALIZING");
    expect(h.tickedInstrumentCount).toBe(0);
    expect(h.subscribedInstrumentCount).toBe(2);
  });

  it("an unhealthy provider feed blocks LIVE_COMPLETE", () => {
    const identities = [ident("NSE:EQUITY:A", 1)];
    const h = aggregate({
      identities,
      quotes: { "NSE:EQUITY:A": freshTick() },
      manifest: manifest(["NSE:EQUITY:A"]),
      providerFeedHealthy: false,
    });
    expect(h.overallState).toBe("LIVE_PARTIAL");
    expect(h.blockers).toContain("PROVIDER_FEED_UNHEALTHY");
  });

  it("an unsubscribed required instrument is reported as such", () => {
    const identities = [ident("NSE:EQUITY:A", 1), ident("NSE:EQUITY:B", 2)];
    const h = aggregate({
      identities,
      quotes: { "NSE:EQUITY:A": freshTick() },
      manifest: manifest(["NSE:EQUITY:A", "NSE:EQUITY:B"]),
      unsubscribed: new Set([2]),
    });
    expect(h.subscribedInstrumentCount).toBe(1);
    expect(h.blockers).toContain("SUBSCRIPTION_INCOMPLETE");
    expect(h.overallState).toBe("LIVE_PARTIAL");
  });
});

// ---------------------------------------------------------------------------
// SECTION J (addendum) — regression tests for the bypasses found in review.
//
// Each test below corresponds to a concrete way the contract could have been
// made to assert a completeness or health claim it could not support.
// ---------------------------------------------------------------------------

describe("R: authoritative coverage is computed, never inherited", () => {
  it("R1: a fully-fresh SMALLER configured feed cannot claim LIVE_COMPLETE against a larger authoritative universe", () => {
    // Configured feed: 2 instruments, both fresh, internally perfect.
    const identities = [ident("NSE:EQUITY:A", 1), ident("NSE:EQUITY:B", 2)];
    const quotes = {
      "NSE:EQUITY:A": freshTick(),
      "NSE:EQUITY:B": freshTick(),
    };
    // Authoritative universe genuinely contains a third instrument.
    const authoritative = manifest(["NSE:EQUITY:A", "NSE:EQUITY:B", "NSE:EQUITY:C"], {
      universeScopeId: "AUTHORITATIVE_FIXTURE",
    });

    const h = aggregate({
      identities,
      quotes,
      manifest: manifest(["NSE:EQUITY:A", "NSE:EQUITY:B"]),
      authoritativeManifest: authoritative,
    });

    expect(h.overallState).not.toBe("LIVE_COMPLETE");
    expect(h.overallState).toBe("LIVE_PARTIAL");
    expect(h.blockers).toContain("AUTHORITATIVE_COVERAGE_INCOMPLETE");
    // The authoritative view must show the REAL denominator, not the small one.
    expect(h.authoritative.requiredInstrumentCount).toBe(3);
    expect(h.authoritative.freshInstrumentCount).toBe(2);
    expect(h.authoritative.coveragePct).toBeLessThan(100);
    // And it must NOT have inherited the configured 100%.
    expect(h.configured.coveragePct).toBe(100);
  });

  it("R2: an authoritative manifest whose members were never observed reports them as missing", () => {
    const identities = [ident("NSE:EQUITY:A", 1)];
    const h = aggregate({
      identities,
      quotes: { "NSE:EQUITY:A": freshTick() },
      manifest: manifest(["NSE:EQUITY:A"]),
      authoritativeManifest: manifest(["NSE:EQUITY:X", "NSE:EQUITY:Y"], {
        universeScopeId: "AUTHORITATIVE_FIXTURE",
      }),
    });
    expect(h.authoritative.requiredInstrumentCount).toBe(2);
    expect(h.authoritative.freshInstrumentCount).toBe(0);
    expect(h.authoritative.coveragePct).toBe(0);
    expect(h.overallState).not.toBe("LIVE_COMPLETE");
  });

  it("R3: flipping the authority enum without valid reconciliation metadata does not grant authority", () => {
    const ids = ["NSE:EQUITY:A"];
    const identities = [ident("NSE:EQUITY:A", 1)];
    const quotes = { "NSE:EQUITY:A": freshTick() };

    // Enum says authoritative, but reconciliation is invalid.
    const invalidRecon = manifest(ids, { universeReconciliationValid: false });
    const h1 = aggregate({
      identities, quotes,
      manifest: invalidRecon,
      authoritativeManifest: invalidRecon,
    });
    expect(h1.overallState).not.toBe("LIVE_COMPLETE");
    expect(h1.blockers).toContain("AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED");

    // Enum says authoritative, but there is no generation identity.
    const noGeneration = manifest(ids, { universeGenerationId: null });
    const h2 = aggregate({
      identities, quotes,
      manifest: noGeneration,
      authoritativeManifest: noGeneration,
    });
    expect(h2.overallState).not.toBe("LIVE_COMPLETE");
    expect(h2.blockers).toContain("AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED");
  });
});

describe("R: the observation set itself must have integrity", () => {
  it("R4: a duplicated identity cannot fill the quota left by a missing one", () => {
    // Required A and B. Observations are A and A — the counts would otherwise
    // add up to a perfect 2/2 while B was never seen at all.
    const c = ctx();
    const dup = buildObservations({
      identities: [ident("NSE:EQUITY:A", 1), ident("NSE:EQUITY:A", 1)],
      quotesByCanonicalId: { "NSE:EQUITY:A": freshTick() },
      subscribedTokens: new Set([1]),
      pendingInstrumentIds: new Set(),
      conflictedInstrumentIds: new Set(),
    }).map(o => classifyInstrument(o, c));

    const m = manifest(["NSE:EQUITY:A", "NSE:EQUITY:B"]);
    const h = deriveAggregateCoverage({
      manifest: m,
      authoritativeManifest: m,
      classifications: dup,
      registeredInstrumentCount: 2,
      pendingReconciliationCount: 0,
      marketPhase: "OPEN",
      freshnessBudgetSec: BUDGET,
      nowMs: NOW_MS,
      providerFeedHealthy: true,
    });

    expect(h.overallState).toBe("UNAVAILABLE");
    expect(h.blockers).toContain("IMPOSSIBLE_COUNTS");
  });

  it("R5: an observation outside the required universe invalidates the set", () => {
    const c = ctx();
    const foreign = buildObservations({
      identities: [ident("NSE:EQUITY:A", 1), ident("NSE:EQUITY:ZZZ", 9)],
      quotesByCanonicalId: {
        "NSE:EQUITY:A": freshTick(),
        "NSE:EQUITY:ZZZ": freshTick(),
      },
      subscribedTokens: new Set([1, 9]),
      pendingInstrumentIds: new Set(),
      conflictedInstrumentIds: new Set(),
    }).map(o => classifyInstrument(o, c));

    const m = manifest(["NSE:EQUITY:A", "NSE:EQUITY:B"]);
    const h = deriveAggregateCoverage({
      manifest: m,
      authoritativeManifest: m,
      classifications: foreign,
      registeredInstrumentCount: 2,
      pendingReconciliationCount: 0,
      marketPhase: "OPEN",
      freshnessBudgetSec: BUDGET,
      nowMs: NOW_MS,
      providerFeedHealthy: true,
    });

    expect(h.overallState).toBe("UNAVAILABLE");
    expect(h.blockers).toContain("IMPOSSIBLE_COUNTS");
  });
});

describe("R: liveness requires a live connection, not merely recent cache", () => {
  it("R6: an otherwise-perfect universe is not LIVE_COMPLETE when the feed is unhealthy", () => {
    const identities = [ident("NSE:EQUITY:A", 1)];
    const m = manifest(["NSE:EQUITY:A"]);
    const h = aggregate({
      identities,
      quotes: { "NSE:EQUITY:A": freshTick() },
      manifest: m,
      authoritativeManifest: m,
      providerFeedHealthy: false,
    });
    expect(h.overallState).not.toBe("LIVE_COMPLETE");
    expect(h.blockers).toContain("PROVIDER_FEED_UNHEALTHY");
  });

  it("R7: the live builder requires a CONNECTED socket, not a merely running supervisor", () => {
    const src = readFileSync(join(SRC, "marketData/aggregateCoverageLive.ts"), "utf8");
    // `connected || running` would accept a dead socket behind a live process.
    expect(src).not.toMatch(/providerFeedHealthy:\s*[^,]*\|\|/);
    expect(src).toMatch(/providerFeedHealthy:\s*feed\.connected === true/);
  });
});

describe("R: the pending overlay states its bucket rule truthfully", () => {
  it("R8: a pending AND conflicted instrument occupies the conflicted bucket, not unavailable", () => {
    const identities = [ident("NSE:EQUITY:A", 1), ident("NSE:EQUITY:B", 2)];
    const h = aggregate({
      identities,
      quotes: { "NSE:EQUITY:A": freshTick(), "NSE:EQUITY:B": freshTick() },
      manifest: manifest(["NSE:EQUITY:A", "NSE:EQUITY:B"]),
      pending: new Set(["NSE:EQUITY:A"]),
      conflicted: new Set(["NSE:EQUITY:A"]),
    });

    // Conflict is the more severe finding and wins the single bucket.
    expect(h.conflictedInstrumentCount).toBe(1);
    expect(h.unavailableInstrumentCount).toBe(0);
    // The overlay count still reports the pending rotation.
    expect(h.pendingReconciliationCount).toBe(1);
    // Partition still balances (overlay excluded, so no double count).
    expect(
      h.freshInstrumentCount + h.staleInstrumentCount +
      h.unavailableInstrumentCount + h.conflictedInstrumentCount,
    ).toBe(h.requiredInstrumentCount);
    // Both facts are surfaced as blockers — neither is hidden by the other.
    expect(h.blockers).toContain("CONFLICTED_INSTRUMENTS_PRESENT");
    expect(h.blockers).toContain("TOKEN_RECONCILIATION_PENDING");
  });

  it("R9: the documented overlay rule matches the implemented behaviour", () => {
    const src = readFileSync(join(SRC, "marketData/aggregateCoverage.ts"), "utf8");
    // The old comment claimed pending is ALWAYS unavailable, which is false
    // when the instrument is also conflicted. Pin the corrected wording.
    expect(src).toContain("`conflicted` when that same instrument is also conflicted");
    expect(src).not.toMatch(/exactly one bucket \(always `unavailable`/);
  });
});
