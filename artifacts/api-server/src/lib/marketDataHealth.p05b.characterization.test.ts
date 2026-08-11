/**
 * Phase 0.5B — SECTION A: characterization of the CURRENT aggregate status.
 *
 * EVIDENCE LABEL AND SCOPE — read before citing these results
 * -----------------------------------------------------------
 * These are TESTED characterizations of the current `deriveQuoteStatus`
 * implementation as it exists in this development workspace on this branch.
 *
 * They are NOT a reproduction against untouched production. Production has not
 * been called, queried, or observed for this evidence. No provider request, no
 * database read, and no deployed endpoint was involved. Every input below is a
 * deterministic fixture.
 *
 * What they DO establish: the shipped deriver is structurally incapable of
 * distinguishing complete live coverage from a single fresh quote, because the
 * information required to make that distinction is not present in its input
 * type at all.
 *
 * These tests assert the DEFECTIVE behaviour on purpose. They are the "before"
 * half of the record and must keep passing while the legacy field survives in
 * its deprecated form. When `LIVE_TICKS` is finally removed in a later
 * authorized phase, this file is deleted with it.
 */

import { describe, it, expect } from "vitest";
import { deriveQuoteStatus, deriveOverall, deriveScannerSourceStatus, type DeriveQuoteStatusInput } from "./marketDataHealth";

/** Every field the current deriver can see. Nothing else reaches it. */
function baseInput(over: Partial<DeriveQuoteStatusInput> = {}): DeriveQuoteStatusInput {
  return {
    sessionValid: true,
    marketSession: "open",
    feedConnected: true,
    feedRunning: true,
    liveQuotesCount: 1,
    ...over,
  };
}

describe("P0.5B-A — characterization of the current aggregate LIVE status", () => {
  it("A1: ONE quote out of a large required universe still reports LIVE_TICKS", () => {
    // The deriver sees a count of 1. It cannot see that (say) 7,889 other
    // required instruments produced nothing at all, because the required
    // universe is not an input.
    const status = deriveQuoteStatus(baseInput({ liveQuotesCount: 1 }));
    expect(status).toBe("LIVE_TICKS");

    // ...and that single quote is enough to paint the whole platform green.
    const overall = deriveOverall(status, true);
    expect(overall.badge).toBe("KITE LIVE");
    expect(overall.severity).toBe("green");
    expect(overall.userMessage).toContain("trade-grade");
    expect(overall.actionRequired).toBe(false);
  });

  it("A2: a STALE quote still reports LIVE_TICKS — no timestamp is ever consulted", () => {
    // Structural proof: the input contract has no timestamp, no age, and no
    // freshness budget. A quote last updated days ago is indistinguishable
    // from one that arrived this millisecond.
    const input = baseInput({ liveQuotesCount: 1 });
    const keys = Object.keys(input).sort();
    expect(keys).toEqual([
      "feedConnected",
      "feedRunning",
      "liveQuotesCount",
      "marketSession",
      "sessionValid",
    ]);
    // No field can convey WHEN any quote was last updated.
    for (const forbidden of [
      "ts", "tsMs", "asOf", "asOfMs", "updatedAt", "lastTickMs",
      "ageSec", "maxAgeSec", "oldestQuoteAgeSec",
      "freshInstrumentCount", "freshnessBudgetSec",
      "staleInstrumentCount", "staleQuotesCount",
    ]) {
      expect(keys).not.toContain(forbidden);
    }

    expect(deriveQuoteStatus(input)).toBe("LIVE_TICKS");
    expect(deriveScannerSourceStatus(deriveQuoteStatus(input))).toBe("KITE_LIVE");
  });

  it("A3: pending token reconciliation cannot block the live label", () => {
    // Pending reconciliation means an instrument's token→identity mapping is
    // disputed, so its stored price may belong to a DIFFERENT instrument.
    // That fact has no channel into this deriver: the input carries no
    // reconciliation field, so the result is identical either way.
    const input = baseInput({ liveQuotesCount: 5 });
    expect(deriveQuoteStatus(input)).toBe("LIVE_TICKS");
    expect(Object.keys(input)).not.toContain("pendingReconciliationCount");
    expect(Object.keys(input)).not.toContain("reconciliationPending");
  });

  it("A4: a non-zero count proves neither subscription coverage nor tick coverage", () => {
    // Subscription coverage and tick coverage are different quantities, and
    // neither is an input. Identical LIVE_TICKS for 1 quote and 5,000 quotes.
    for (const n of [1, 2, 50, 5000]) {
      expect(deriveQuoteStatus(baseInput({ liveQuotesCount: n }))).toBe("LIVE_TICKS");
    }
    const input = baseInput();
    expect(Object.keys(input)).not.toContain("subscribedInstrumentCount");
    expect(Object.keys(input)).not.toContain("requiredInstrumentCount");
    expect(Object.keys(input)).not.toContain("tickedInstrumentCount");
  });

  it("A5: market-closed is a single flat state — completeness is not distinguished", () => {
    // Whether every required instrument carries a verified official close, or
    // none of them do, the answer is the same string.
    const noQuotes  = deriveQuoteStatus(baseInput({ marketSession: "closed", liveQuotesCount: 0 }));
    const someQuotes = deriveQuoteStatus(baseInput({ marketSession: "closed", liveQuotesCount: 3 }));
    const manyQuotes = deriveQuoteStatus(baseInput({ marketSession: "closed", liveQuotesCount: 5000 }));

    expect(noQuotes).toBe("MARKET_CLOSED_SESSION_ACTIVE");
    expect(someQuotes).toBe("MARKET_CLOSED_SESSION_ACTIVE");
    expect(manyQuotes).toBe("MARKET_CLOSED_SESSION_ACTIVE");
    expect(new Set([noQuotes, someQuotes, manyQuotes]).size).toBe(1);
  });

  it("A6: the ONLY thing separating LIVE_TICKS from CONNECTED_WAITING is count > 0", () => {
    // This is the literal defect: a boolean test on a bare cardinality.
    const open = { sessionValid: true, marketSession: "open" as const, feedConnected: true, feedRunning: true };
    expect(deriveQuoteStatus({ ...open, liveQuotesCount: 0 })).toBe("CONNECTED_WAITING");
    expect(deriveQuoteStatus({ ...open, liveQuotesCount: 1 })).toBe("LIVE_TICKS");
  });
});
