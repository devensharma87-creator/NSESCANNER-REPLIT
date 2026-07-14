import { describe, it, expect } from "vitest";
import {
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

  it("MARKET_CLOSED_SESSION_ACTIVE → green, badge contains MARKET CLOSED, no action", () => {
    const o = deriveOverall("MARKET_CLOSED_SESSION_ACTIVE", true);
    expect(o.severity).toBe("green");
    expect(o.badge).toContain("MARKET CLOSED");
    expect(o.actionRequired).toBe(false);
    expect(o.action).toBeNull();
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
  it("KITE_LIVE → trade-grade", () => {
    expect(deriveScannerExplanation("KITE_LIVE").toLowerCase()).toContain("trade-grade");
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
