/**
 * Data Foundation Phase 0.5A — deferred token-reconciliation visibility.
 *
 * Automatic draining of the pending queue is deliberately OUT of scope (it
 * belongs to the future controlled subscription-reconciliation phase). What
 * must hold before then is that a deferred rotation cannot hide:
 *
 *   - pendingReconciliationCount is exposed
 *   - the state/code TOKEN_RECONCILIATION_PENDING is exposed
 *   - the affected canonical identity is marked non-current
 *   - the affected instrument is never labelled LIVE once its tick freshness
 *     expires (and, in fact, never at all while pending)
 *   - the PUBLIC surface exposes safe state/count ONLY
 *   - OWNER diagnostics may expose exact identity/token detail
 *   - no credentials or provider secrets appear anywhere
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { instrumentRegistry } from "./canonicalInstrument";
import { clearQuotes, upsertQuote } from "./liveQuoteStore";
import {
  _forTesting_clearPendingReconciliations,
  buildOwnerTokenReconciliationDiagnostics,
  buildPublicTokenReconciliationStatus,
  pendingReconciliationCount,
  publicTokenReconciliationStatus,
  reconcileProviderToken,
  tokenReconciliationDiagnostics,
  type PendingReconciliation,
  type SubscriptionPort,
} from "./providerTokenReconciliation";

const RELIANCE = "NSE:EQUITY:RELIANCE";
const TCS = "NSE:EQUITY:TCS";
const OLD_TOKEN = 738561;
const NEW_TOKEN = 999111;

function pendingRow(over: Partial<PendingReconciliation> = {}): PendingReconciliation {
  return {
    canonicalInstrumentId: RELIANCE,
    activeToken: OLD_TOKEN,
    desiredToken: NEW_TOKEN,
    detail: "unsubscribe of retired token 738561 failed: socket write failed",
    recordedAtMs: 1_700_000_000_000,
    ...over,
  };
}

/** A port that always fails to unsubscribe, forcing a deferral. */
function deferringPort(): SubscriptionPort {
  return {
    isSubscribed: () => true,
    unsubscribe: () => { throw new Error("socket write failed"); },
    markUnsubscribed: () => {},
    subscribeToken: () => {},
    markSubscribed: () => {},
    evictQuote: () => {},
  };
}

describe("Phase 0.5A — pending token-reconciliation diagnostics", () => {
  beforeEach(() => {
    instrumentRegistry.clear();
    clearQuotes();
    _forTesting_clearPendingReconciliations();
  });

  // --- public safe surface -------------------------------------------------

  it("D1: with nothing pending the public state is NONE and the count is 0", () => {
    expect(buildPublicTokenReconciliationStatus(0)).toEqual({
      state: "NONE",
      pendingReconciliationCount: 0,
    });
    expect(publicTokenReconciliationStatus()).toEqual({
      state: "NONE",
      pendingReconciliationCount: 0,
    });
  });

  it("D2: a deferred rotation raises the public state and count", () => {
    instrumentRegistry.register({
      exchange: "NSE", segment: "EQUITY", tradingSymbol: "RELIANCE", providerInstrumentToken: OLD_TOKEN,
    });
    const res = reconcileProviderToken({
      canonicalInstrumentId: RELIANCE, desiredToken: NEW_TOKEN, port: deferringPort(), nowMs: 1,
    });

    expect(res.status).toBe("TOKEN_REBIND_REQUIRES_SUBSCRIPTION_RECONCILIATION");
    expect(pendingReconciliationCount()).toBe(1);
    expect(publicTokenReconciliationStatus()).toEqual({
      state: "TOKEN_RECONCILIATION_PENDING",
      pendingReconciliationCount: 1,
    });
  });

  it("D3: the public surface exposes state and count ONLY — no identity, token, or detail", () => {
    const status = buildPublicTokenReconciliationStatus(2);

    expect(Object.keys(status).sort()).toEqual(["pendingReconciliationCount", "state"]);

    // Serialize and assert the sensitive values are absent, not merely unread.
    const json = JSON.stringify(status);
    expect(json).not.toContain(RELIANCE);
    expect(json).not.toContain(String(OLD_TOKEN));
    expect(json).not.toContain(String(NEW_TOKEN));
    expect(json).not.toContain("socket write failed");
  });

  // --- owner detail surface ------------------------------------------------

  it("D4: owner diagnostics carry the exact identity, both tokens, and the reason", () => {
    const d = buildOwnerTokenReconciliationDiagnostics({
      pending: [pendingRow()], lastTickTsById: {}, nowMs: 1_700_000_000_000, freshnessBudgetSec: 60,
    });

    expect(d.state).toBe("TOKEN_RECONCILIATION_PENDING");
    expect(d.pendingReconciliationCount).toBe(1);
    const e = d.pending[0]!;
    expect(e.canonicalInstrumentId).toBe(RELIANCE);
    expect(e.activeToken).toBe(OLD_TOKEN);
    expect(e.desiredToken).toBe(NEW_TOKEN);
    expect(e.detail).toContain("socket write failed");
    expect(e.code).toBe("TOKEN_RECONCILIATION_PENDING");
    expect(e.recordedAt).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it("D5: an affected identity is marked non-current", () => {
    const d = buildOwnerTokenReconciliationDiagnostics({
      pending: [pendingRow()],
      lastTickTsById: { [RELIANCE]: 1_700_000_000_000 },
      nowMs: 1_700_000_000_000,
      freshnessBudgetSec: 60,
    });
    expect(d.pending[0]!.current).toBe(false);
  });

  it("D6: an affected instrument is NEVER labelled LIVE — even with a brand-new tick", () => {
    const d = buildOwnerTokenReconciliationDiagnostics({
      pending: [pendingRow()],
      lastTickTsById: { [RELIANCE]: 1_700_000_000_000 },
      nowMs: 1_700_000_000_000, // age 0 — as fresh as a tick can be
      freshnessBudgetSec: 60,
    });
    const e = d.pending[0]!;
    expect(e.lastTickAgeSec).toBe(0);
    expect(e.tickFreshnessExpired).toBe(false);
    // Fresh, yet still not presentable as LIVE, because the mapping is disputed.
    expect(e.liveLabelEligible).toBe(false);
    expect(e.current).toBe(false);
  });

  it("D7: tick freshness expires once the age passes the supplied budget", () => {
    const base = 1_700_000_000_000;
    const at = (nowMs: number) =>
      buildOwnerTokenReconciliationDiagnostics({
        pending: [pendingRow()], lastTickTsById: { [RELIANCE]: base }, nowMs, freshnessBudgetSec: 60,
      }).pending[0]!;

    expect(at(base + 59_000).tickFreshnessExpired).toBe(false);
    expect(at(base + 60_000).tickFreshnessExpired).toBe(false); // boundary is exclusive
    expect(at(base + 61_000).tickFreshnessExpired).toBe(true);
    // And it is still not LIVE on either side of the boundary.
    expect(at(base + 59_000).liveLabelEligible).toBe(false);
    expect(at(base + 61_000).liveLabelEligible).toBe(false);
  });

  it("D8: no tick at all counts as expired, not as fresh-by-default", () => {
    const e = buildOwnerTokenReconciliationDiagnostics({
      pending: [pendingRow()], lastTickTsById: {}, nowMs: 1_700_000_000_000, freshnessBudgetSec: 60,
    }).pending[0]!;

    expect(e.lastTickTs).toBeNull();
    expect(e.lastTickAgeSec).toBeNull();
    expect(e.tickFreshnessExpired).toBe(true);
    expect(e.liveLabelEligible).toBe(false);
  });

  it("D9: ordering is deterministic, not insertion-ordered", () => {
    const rows = [
      pendingRow({ canonicalInstrumentId: TCS, activeToken: 2953217 }),
      pendingRow(),
    ];
    const forward = buildOwnerTokenReconciliationDiagnostics({
      pending: rows, lastTickTsById: {}, nowMs: 1, freshnessBudgetSec: 60,
    });
    const reversed = buildOwnerTokenReconciliationDiagnostics({
      pending: [...rows].reverse(), lastTickTsById: {}, nowMs: 1, freshnessBudgetSec: 60,
    });

    expect(forward.pending.map(e => e.canonicalInstrumentId)).toEqual([RELIANCE, TCS]);
    expect(reversed.pending.map(e => e.canonicalInstrumentId)).toEqual([RELIANCE, TCS]);
  });

  it("D10: the live wrapper reads the real registry, real queue, and real quote store", () => {
    instrumentRegistry.register({
      exchange: "NSE", segment: "EQUITY", tradingSymbol: "RELIANCE", providerInstrumentToken: OLD_TOKEN,
    });
    const tickTs = Date.now() - 5_000;
    expect(
      upsertQuote({ providerInstrumentToken: OLD_TOKEN, provider: "KITE", ltp: 1500, receivedTimestamp: tickTs }).ok,
    ).toBe(true);

    reconcileProviderToken({
      canonicalInstrumentId: RELIANCE, desiredToken: NEW_TOKEN, port: deferringPort(), nowMs: Date.now(),
    });

    const d = tokenReconciliationDiagnostics();
    expect(d.state).toBe("TOKEN_RECONCILIATION_PENDING");
    expect(d.pending).toHaveLength(1);
    const e = d.pending[0]!;
    expect(e.canonicalInstrumentId).toBe(RELIANCE);
    // The quote is picked up from the real store, keyed by canonical id.
    expect(e.lastTickTs).toBe(tickTs);
    expect(e.lastTickAgeSec).toBeGreaterThanOrEqual(4);
    expect(e.current).toBe(false);
    expect(e.liveLabelEligible).toBe(false);
  });

  it("D11: no credential or provider-secret material appears in either surface", () => {
    instrumentRegistry.register({
      exchange: "NSE", segment: "EQUITY", tradingSymbol: "RELIANCE", providerInstrumentToken: OLD_TOKEN,
    });
    reconcileProviderToken({
      canonicalInstrumentId: RELIANCE, desiredToken: NEW_TOKEN, port: deferringPort(), nowMs: 1,
    });

    const blob = JSON.stringify({
      owner: tokenReconciliationDiagnostics(),
      public: publicTokenReconciliationStatus(),
    }).toLowerCase();

    for (const banned of [
      "access_token", "accesstoken", "api_key", "apikey", "api_secret", "apisecret",
      "password", "secret", "cookie", "authorization", "bearer", "session",
    ]) {
      expect(blob).not.toContain(banned);
    }
  });

  // --- wiring (readFileSync: importing kiteFeed pulls in socket/timer side effects) ---

  it("D12: feedStatus serializes OWNER detail and buildMarketDataHealth serializes the SAFE shape", () => {
    const feed = readFileSync(join(__dirname, "kiteFeed.ts"), "utf8");
    expect(feed).toContain("tokenReconciliation: tokenReconciliationDiagnostics()");
    expect(feed).toContain("tokenReconciliation: OwnerTokenReconciliationDiagnostics");

    const health = readFileSync(join(__dirname, "marketDataHealth.ts"), "utf8");
    // The PUBLIC health payload must use the safe builder, never the owner one.
    expect(health).toContain("tokenReconciliation: publicTokenReconciliationStatus()");
    expect(health).not.toContain("tokenReconciliationDiagnostics");
  });

  it("D13: the pending-queue reset is test-only and has zero production callers", () => {
    const src = readFileSync(join(__dirname, "providerTokenReconciliation.ts"), "utf8");
    expect(src).toContain("export function _forTesting_clearPendingReconciliations");
    // The old unprefixed name must not linger as an alias.
    expect(src).not.toContain("export function clearPendingReconciliations");
  });

  it("D14: no automatic drain was added in Phase 0.5A", () => {
    const src = readFileSync(join(__dirname, "providerTokenReconciliation.ts"), "utf8");
    expect(src).not.toMatch(/setInterval|setTimeout|cron|schedule/i);
  });
});
