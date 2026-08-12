import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  applyCoverageToOverall,
  coverageBacksLiveClaim,
  deriveTradeGrade,
  deriveQuoteStatus,
  deriveScannerSourceStatus,
  deriveOverall,
  deriveKiteExplanation,
  deriveScannerExplanation,
  type DeriveQuoteStatusInput,
} from "./marketDataHealth";

function mkInput(over: Partial<DeriveQuoteStatusInput> = {}): DeriveQuoteStatusInput {
  return {
    sessionValid: true,
    marketSession: "open",
    feedConnected: true,
    feedRunning: true,
    liveQuotesCount: 5,
    ...over,
  };
}

// ─────────────────────────────────────────────
// deriveQuoteStatus
// ─────────────────────────────────────────────

describe("deriveQuoteStatus", () => {
  it("session invalid → UNAVAILABLE regardless of market session or feed", () => {
    expect(deriveQuoteStatus(mkInput({ sessionValid: false, marketSession: "open", liveQuotesCount: 10, feedConnected: true }))).toBe("UNAVAILABLE");
    expect(deriveQuoteStatus(mkInput({ sessionValid: false, marketSession: "closed", liveQuotesCount: 0, feedConnected: false }))).toBe("UNAVAILABLE");
    expect(deriveQuoteStatus(mkInput({ sessionValid: false, marketSession: "pre_open" }))).toBe("UNAVAILABLE");
  });

  it("market open + liveQuotes > 0 → LIVE_TICKS", () => {
    expect(deriveQuoteStatus(mkInput({ marketSession: "open", liveQuotesCount: 3 }))).toBe("LIVE_TICKS");
    expect(deriveQuoteStatus(mkInput({ marketSession: "open", liveQuotesCount: 1 }))).toBe("LIVE_TICKS");
  });

  it("market open + liveQuotes = 0 + feedConnected → CONNECTED_WAITING", () => {
    expect(deriveQuoteStatus(mkInput({ marketSession: "open", liveQuotesCount: 0, feedConnected: true, feedRunning: true }))).toBe("CONNECTED_WAITING");
    expect(deriveQuoteStatus(mkInput({ marketSession: "open", liveQuotesCount: 0, feedConnected: false, feedRunning: true }))).toBe("CONNECTED_WAITING");
  });

  it("market open + liveQuotes = 0 + feed fully stopped → STALE", () => {
    expect(deriveQuoteStatus(mkInput({ marketSession: "open", liveQuotesCount: 0, feedConnected: false, feedRunning: false }))).toBe("STALE");
  });

  it("market closed + session valid → MARKET_CLOSED_SESSION_ACTIVE (regardless of liveQuotes)", () => {
    expect(deriveQuoteStatus(mkInput({ marketSession: "closed", liveQuotesCount: 0, feedConnected: false, feedRunning: false }))).toBe("MARKET_CLOSED_SESSION_ACTIVE");
    expect(deriveQuoteStatus(mkInput({ marketSession: "closed", liveQuotesCount: 0, feedConnected: true }))).toBe("MARKET_CLOSED_SESSION_ACTIVE");
    expect(deriveQuoteStatus(mkInput({ marketSession: "closed", liveQuotesCount: 5 }))).toBe("MARKET_CLOSED_SESSION_ACTIVE");
  });

  it("market pre_open + session valid → MARKET_CLOSED_SESSION_ACTIVE", () => {
    expect(deriveQuoteStatus(mkInput({ marketSession: "pre_open", liveQuotesCount: 0 }))).toBe("MARKET_CLOSED_SESSION_ACTIVE");
    expect(deriveQuoteStatus(mkInput({ marketSession: "pre_open", liveQuotesCount: 2 }))).toBe("MARKET_CLOSED_SESSION_ACTIVE");
  });
});

// ─────────────────────────────────────────────
// deriveScannerSourceStatus
// ─────────────────────────────────────────────

describe("deriveScannerSourceStatus", () => {
  it("LIVE_TICKS → KITE_LIVE", () => {
    expect(deriveScannerSourceStatus("LIVE_TICKS")).toBe("KITE_LIVE");
  });
  it("CONNECTED_WAITING → KITE_WAITING", () => {
    expect(deriveScannerSourceStatus("CONNECTED_WAITING")).toBe("KITE_WAITING");
  });
  it("MARKET_CLOSED_SESSION_ACTIVE → KITE_MARKET_CLOSED", () => {
    expect(deriveScannerSourceStatus("MARKET_CLOSED_SESSION_ACTIVE")).toBe("KITE_MARKET_CLOSED");
  });
  it("STALE → STALE_CACHE", () => {
    expect(deriveScannerSourceStatus("STALE")).toBe("STALE_CACHE");
  });
  it("UNAVAILABLE → YAHOO_DELAYED", () => {
    expect(deriveScannerSourceStatus("UNAVAILABLE")).toBe("YAHOO_DELAYED");
  });
});

// ─────────────────────────────────────────────
// deriveOverall
// ─────────────────────────────────────────────

describe("deriveOverall", () => {
  it("LIVE_TICKS → green, badge=KITE LIVE, no action", () => {
    const o = deriveOverall("LIVE_TICKS", true);
    expect(o.severity).toBe("green");
    expect(o.badge).toBe("KITE LIVE");
    expect(o.actionRequired).toBe(false);
    expect(o.action).toBeNull();
  });

  it("CONNECTED_WAITING → yellow, badge contains WAITING, no action", () => {
    const o = deriveOverall("CONNECTED_WAITING", true);
    expect(o.severity).toBe("yellow");
    expect(o.badge).toContain("WAITING");
    expect(o.actionRequired).toBe(false);
    expect(o.action).toBeNull();
  });

  // Phase 0.5B final: this case is deliberately NO LONGER green. "Market is
  // closed" describes the session, not the health of the data, and this path
  // has no verified official close behind it.
  it("MARKET_CLOSED_SESSION_ACTIVE → neutral LAST KNOWN, never green, no action", () => {
    const o = deriveOverall("MARKET_CLOSED_SESSION_ACTIVE", true);
    expect(o.severity).toBe("neutral");
    expect(o.severity).not.toBe("green");
    expect(o.badge).toContain("MARKET CLOSED");
    expect(o.badge).toContain("LAST KNOWN");
    expect(o.actionRequired).toBe(false);
    expect(o.action).toBeNull();
  });

  it("MARKET_CLOSED_SESSION_ACTIVE stamps the observation time when one exists", () => {
    const o = deriveOverall("MARKET_CLOSED_SESSION_ACTIVE", true, "2026-08-12T10:00:00.000Z");
    expect(o.userMessage).toContain("2026-08-12T10:00:00.000Z");
    // ...and must not claim it is an official close.
    expect(o.userMessage).toContain("not verified official session closes");
  });

  it("MARKET_CLOSED_SESSION_ACTIVE omits the timestamp rather than inventing one", () => {
    const o = deriveOverall("MARKET_CLOSED_SESSION_ACTIVE", true, null);
    expect(o.userMessage).not.toContain("as of");
  });

  it("STALE → orange, badge contains STALE, no action required", () => {
    const o = deriveOverall("STALE", true);
    expect(o.severity).toBe("orange");
    expect(o.badge).toContain("STALE");
    expect(o.actionRequired).toBe(false);
  });

  it("UNAVAILABLE + session present → red, LOGIN REQUIRED, action=/kite", () => {
    const o = deriveOverall("UNAVAILABLE", true);
    expect(o.severity).toBe("red");
    expect(o.badge).toContain("LOGIN REQUIRED");
    expect(o.actionRequired).toBe(true);
    expect(o.action).toBe("/kite");
  });

  it("UNAVAILABLE + no session → red, NO LIVE DATA, action=/kite", () => {
    const o = deriveOverall("UNAVAILABLE", false);
    expect(o.severity).toBe("red");
    expect(o.badge).toContain("NO LIVE DATA");
    expect(o.actionRequired).toBe(true);
    expect(o.action).toBe("/kite");
  });

  it("MARKET_CLOSED_SESSION_ACTIVE userMessage explains market closed state", () => {
    const o = deriveOverall("MARKET_CLOSED_SESSION_ACTIVE", true);
    expect(o.userMessage.toLowerCase()).toContain("closed");
    expect(o.userMessage.toLowerCase()).toContain("session");
  });

  it("UNAVAILABLE userMessage contains yahoo and explains not trade-grade", () => {
    const o = deriveOverall("UNAVAILABLE", true);
    expect(o.userMessage.toLowerCase()).toContain("yahoo");
    expect(o.userMessage.toLowerCase()).toContain("not trade-grade");
  });
});

// ─────────────────────────────────────────────
// deriveKiteExplanation — spot checks
// ─────────────────────────────────────────────

describe("deriveKiteExplanation", () => {
  it("LIVE_TICKS includes liveQuotesCount", () => {
    const s = deriveKiteExplanation("LIVE_TICKS", true, true, 42);
    expect(s).toContain("42");
  });

  it("UNAVAILABLE + session present → mentions session expired", () => {
    const s = deriveKiteExplanation("UNAVAILABLE", false, true, 0);
    expect(s.toLowerCase()).toContain("expired");
  });

  it("UNAVAILABLE + no session → mentions configure", () => {
    const s = deriveKiteExplanation("UNAVAILABLE", false, false, 0);
    expect(s.toLowerCase()).toContain("configure");
  });

  it("MARKET_CLOSED_SESSION_ACTIVE mentions market closed", () => {
    const s = deriveKiteExplanation("MARKET_CLOSED_SESSION_ACTIVE", true, true, 0);
    expect(s.toLowerCase()).toContain("closed");
  });
});

// ─────────────────────────────────────────────
// deriveScannerExplanation — spot checks
// ─────────────────────────────────────────────

describe("deriveScannerExplanation", () => {
  // Phase 0.5B final: the scanner explanation must NOT assert trade-grade off
  // the legacy source status. Trade-grade is a coverage-gated claim now.
  it("KITE_LIVE → names live Kite data but never claims trade-grade", () => {
    const s = deriveScannerExplanation("KITE_LIVE").toLowerCase();
    expect(s).toContain("live kite");
    expect(s).not.toContain("trade-grade");
  });

  it("KITE_MARKET_CLOSED → market is closed, session ready", () => {
    const s = deriveScannerExplanation("KITE_MARKET_CLOSED").toLowerCase();
    expect(s).toContain("closed");
    expect(s).toContain("session");
  });

  it("YAHOO_DELAYED → info-only, not trade-grade", () => {
    const s = deriveScannerExplanation("YAHOO_DELAYED").toLowerCase();
    expect(s).toContain("yahoo");
    expect(s).toContain("info-only");
  });
});

// ─────────────────────────────────────────────
// Secret-safety: no sensitive fields emitted
// ─────────────────────────────────────────────

describe("no secrets in pure deriver outputs", () => {
  it("deriveOverall never includes token-like patterns", () => {
    for (const qs of ["LIVE_TICKS", "UNAVAILABLE", "STALE", "MARKET_CLOSED_SESSION_ACTIVE", "CONNECTED_WAITING"] as const) {
      const o = deriveOverall(qs, true);
      const serialized = JSON.stringify(o);
      expect(serialized).not.toMatch(/api[_-]?key/i);
      expect(serialized).not.toMatch(/token/i);
      expect(serialized).not.toMatch(/secret/i);
      expect(serialized).not.toMatch(/chat_id/i);
    }
  });
});

// ---------------------------------------------------------------------------
// P0.5B-FINAL — legacy LIVE_TICKS can no longer create a live/trade-grade claim
// ---------------------------------------------------------------------------

/**
 * These are the regression tests required by the final correction round:
 * a stale or partial legacy quote population must not be able to produce ANY
 * internal live / green / trade-grade state.
 */
describe("P0.5B-FINAL-K — LIVE_TICKS is non-authoritative", () => {
  /** Every coverage state that is NOT a complete-live claim. */
  const NON_LIVE_STATES = [
    "INITIALIZING",
    "UNIVERSE_NOT_CONFIGURED",
    "LIVE_PARTIAL",
    "RECONCILIATION_PENDING",
    "CONFLICTED",
    "STALE",
    "UNAVAILABLE",
    "MARKET_CLOSED_CURRENT",
    "MARKET_CLOSED_PARTIAL",
  ] as const;

  function cov(overallState: string, over: Record<string, unknown> = {}) {
    return {
      overallState,
      freshInstrumentCount: 1,
      requiredInstrumentCount: 58,
      ...over,
    } as unknown as Parameters<typeof applyCoverageToOverall>[2];
  }

  it("K01: coverageBacksLiveClaim is true ONLY for LIVE_COMPLETE", () => {
    expect(coverageBacksLiveClaim(cov("LIVE_COMPLETE"))).toBe(true);
    for (const s of NON_LIVE_STATES) {
      expect(coverageBacksLiveClaim(cov(s))).toBe(false);
    }
  });

  it("K02: LIVE_TICKS + any non-complete coverage is NOT trade-grade", () => {
    for (const s of NON_LIVE_STATES) {
      expect(deriveTradeGrade("LIVE_TICKS", cov(s))).toBe(false);
    }
  });

  it("K03: trade-grade requires BOTH live ticks and complete coverage", () => {
    expect(deriveTradeGrade("LIVE_TICKS", cov("LIVE_COMPLETE"))).toBe(true);
    // Complete coverage alone, without live ticks, is still not trade-grade.
    for (const q of ["CONNECTED_WAITING", "MARKET_CLOSED_SESSION_ACTIVE", "STALE", "UNAVAILABLE"] as const) {
      expect(deriveTradeGrade(q, cov("LIVE_COMPLETE"))).toBe(false);
    }
  });

  it("K04: a green KITE LIVE badge is downgraded when coverage cannot back it", () => {
    const green = deriveOverall("LIVE_TICKS", true);
    expect(green.severity).toBe("green");

    for (const s of NON_LIVE_STATES) {
      const gated = applyCoverageToOverall(green, "LIVE_TICKS", cov(s));
      expect(gated.severity).not.toBe("green");
      expect(gated.severity).toBe("yellow");
      expect(gated.badge).toContain("PARTIAL COVERAGE");
      // The downgrade must state the real numbers, not just hedge.
      expect(gated.userMessage).toContain("1 of 58");
      expect(gated.userMessage).toContain("not trade-grade");
    }
  });

  it("K05: a genuinely complete coverage state keeps the green badge", () => {
    const green = deriveOverall("LIVE_TICKS", true);
    const gated = applyCoverageToOverall(green, "LIVE_TICKS", cov("LIVE_COMPLETE"));
    expect(gated).toEqual(green);
  });

  it("K06: the gate does not touch non-LIVE_TICKS statuses", () => {
    for (const q of ["CONNECTED_WAITING", "MARKET_CLOSED_SESSION_ACTIVE", "STALE", "UNAVAILABLE"] as const) {
      const base = deriveOverall(q, true);
      expect(applyCoverageToOverall(base, q, cov("LIVE_PARTIAL"))).toEqual(base);
    }
  });

  it("K07: a stale legacy population (1 fresh of 58) never yields a green or trade-grade state", () => {
    const c = cov("STALE", { freshInstrumentCount: 0, requiredInstrumentCount: 58 });
    expect(deriveTradeGrade("LIVE_TICKS", c)).toBe(false);
    expect(applyCoverageToOverall(deriveOverall("LIVE_TICKS", true), "LIVE_TICKS", c).severity)
      .not.toBe("green");
  });

  it("K08: no code path in this module derives trade-grade from quoteStatus alone", () => {
    const src = readFileSync(join(__dirname, "marketDataHealth.ts"), "utf8");
    // The old composition was `const tradeGrade = quoteStatus === "LIVE_TICKS";`
    expect(src).not.toMatch(/tradeGrade\s*=\s*quoteStatus\s*===\s*"LIVE_TICKS"\s*;/);
    expect(src).toMatch(/deriveTradeGrade\(quoteStatus,\s*coverage\)/);
  });
});
