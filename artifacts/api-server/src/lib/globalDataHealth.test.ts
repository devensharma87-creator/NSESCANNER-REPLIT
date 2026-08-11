/**
 * Unit tests for globalDataHealth.ts pure derivers.
 *
 * All tests are synchronous and free of DB / network I/O.
 * buildGlobalDataHealth() (async orchestrator) is NOT tested here —
 * its constituent parts are fully covered by the pure-deriver tests.
 */
import { describe, it, expect } from "vitest";
import {
  deriveModuleHealthStatus,
  deriveCanDriveSignals,
  buildModuleHealthMap,
  deriveGlobalDataHealthStatus,
  applyCoverageGate,
  deriveGlobalSeverity,
  deriveBadgeAndHeadline,
  type GlobalDataHealthStatus,
} from "./globalDataHealth";
import type { ModuleDataHealth } from "./backboneHealth";

// ── Helpers ──────────────────────────────────────────────────────────────────

function mkModule(
  module: string,
  status: "OK" | "DEGRADED" | "BLOCKED",
  failures: string[] = [],
): ModuleDataHealth {
  return {
    module: module as ModuleDataHealth["module"],
    requirement: "TRADE_GRADE_REQUIRED",
    status,
    requirements: [],
    failures,
    recoveryAction: failures[0] ? "Reconnect Kite" : null,
  };
}

// ── deriveModuleHealthStatus ─────────────────────────────────────────────────

describe("deriveModuleHealthStatus", () => {
  it("maps OK → TRADE_GRADE", () => {
    expect(deriveModuleHealthStatus("OK")).toBe("TRADE_GRADE");
  });
  it("maps DEGRADED → DELAYED", () => {
    expect(deriveModuleHealthStatus("DEGRADED")).toBe("DELAYED");
  });
  it("maps BLOCKED → BLOCKED", () => {
    expect(deriveModuleHealthStatus("BLOCKED")).toBe("BLOCKED");
  });
});

// ── deriveCanDriveSignals ─────────────────────────────────────────────────────

describe("deriveCanDriveSignals", () => {
  it("TRADE_GRADE + kiteActive=true → true", () => {
    expect(deriveCanDriveSignals("TRADE_GRADE", true)).toBe(true);
  });
  it("TRADE_GRADE + kiteActive=false → false (invariant: session must be active)", () => {
    expect(deriveCanDriveSignals("TRADE_GRADE", false)).toBe(false);
  });
  it("DELAYED + kiteActive=true → false", () => {
    expect(deriveCanDriveSignals("DELAYED", true)).toBe(false);
  });
  it("BLOCKED + kiteActive=true → false", () => {
    expect(deriveCanDriveSignals("BLOCKED", true)).toBe(false);
  });
  it("UNAVAILABLE + kiteActive=true → false", () => {
    expect(deriveCanDriveSignals("UNAVAILABLE", true)).toBe(false);
  });
});

// ── buildModuleHealthMap ──────────────────────────────────────────────────────

describe("buildModuleHealthMap", () => {
  it("OK module with active Kite → TRADE_GRADE, source=kite, canDriveSignals=true", () => {
    const map = buildModuleHealthMap([mkModule("fno", "OK")], true, false);
    expect(map["fno"]?.status).toBe("TRADE_GRADE");
    expect(map["fno"]?.source).toBe("kite");
    expect(map["fno"]?.canDriveSignals).toBe(true);
    expect(map["fno"]?.canDrivePaperTrading).toBe(true);
    expect(map["fno"]?.canDriveTelegramTradeAlerts).toBe(true);
    expect(map["fno"]?.reason).toBeNull();
  });

  it("BLOCKED module → BLOCKED, source=none, canDriveSignals=false, reason preserved", () => {
    const map = buildModuleHealthMap([mkModule("fno", "BLOCKED", ["Kite session expired"])], true, false);
    expect(map["fno"]?.status).toBe("BLOCKED");
    expect(map["fno"]?.source).toBe("none");
    expect(map["fno"]?.canDriveSignals).toBe(false);
    expect(map["fno"]?.canDrivePaperTrading).toBe(false);
    expect(map["fno"]?.reason).toBe("Kite session expired");
  });

  it("DEGRADED module with Yahoo fallback → DELAYED, source=yahoo, canDriveSignals=false", () => {
    const map = buildModuleHealthMap([mkModule("scanner", "DEGRADED")], false, true);
    expect(map["scanner"]?.status).toBe("DELAYED");
    expect(map["scanner"]?.source).toBe("yahoo");
    expect(map["scanner"]?.canDriveSignals).toBe(false);
  });

  it("DEGRADED module without Yahoo → DELAYED, source=none", () => {
    const map = buildModuleHealthMap([mkModule("scanner", "DEGRADED")], false, false);
    expect(map["scanner"]?.status).toBe("DELAYED");
    expect(map["scanner"]?.source).toBe("none");
  });

  it("Yahoo fallback NEVER drives signals even when module is OK", () => {
    // Yahoo active + OK module but kite NOT active → must still be false
    const map = buildModuleHealthMap([mkModule("fno", "OK")], false, true);
    expect(map["fno"]?.canDriveSignals).toBe(false);
  });

  it("handles multiple modules independently", () => {
    const map = buildModuleHealthMap(
      [mkModule("fno", "OK"), mkModule("swing", "BLOCKED"), mkModule("scanner", "DEGRADED")],
      true,
      true,
    );
    expect(map["fno"]?.canDriveSignals).toBe(true);
    expect(map["swing"]?.canDriveSignals).toBe(false);
    expect(map["scanner"]?.canDriveSignals).toBe(false);
  });

  it("produces an empty record for empty modules array", () => {
    expect(buildModuleHealthMap([], true, false)).toEqual({});
  });
});

// ── deriveGlobalDataHealthStatus ─────────────────────────────────────────────

describe("deriveGlobalDataHealthStatus", () => {
  it("MISSING session → KITE_SESSION_MISSING regardless of quoteStatus", () => {
    expect(deriveGlobalDataHealthStatus("MISSING", "LIVE_TICKS", false, false)).toBe("KITE_SESSION_MISSING");
    expect(deriveGlobalDataHealthStatus("MISSING", "MARKET_CLOSED_SESSION_ACTIVE", false, false)).toBe("KITE_SESSION_MISSING");
    expect(deriveGlobalDataHealthStatus("MISSING", "UNAVAILABLE", false, false)).toBe("KITE_SESSION_MISSING");
  });

  it("EXPIRED session → KITE_SESSION_EXPIRED regardless of quoteStatus", () => {
    expect(deriveGlobalDataHealthStatus("EXPIRED", "UNAVAILABLE", false, false)).toBe("KITE_SESSION_EXPIRED");
    expect(deriveGlobalDataHealthStatus("EXPIRED", "LIVE_TICKS", true, false)).toBe("KITE_SESSION_EXPIRED");
  });

  it("ACTIVE + MARKET_CLOSED_SESSION_ACTIVE → SESSION_ACTIVE_MARKET_CLOSED", () => {
    expect(deriveGlobalDataHealthStatus("ACTIVE", "MARKET_CLOSED_SESSION_ACTIVE", false, false)).toBe("SESSION_ACTIVE_MARKET_CLOSED");
  });

  it("ACTIVE + MARKET_CLOSED_SESSION_ACTIVE ignores blocked modules (market closed — expected)", () => {
    expect(deriveGlobalDataHealthStatus("ACTIVE", "MARKET_CLOSED_SESSION_ACTIVE", true, true)).toBe("SESSION_ACTIVE_MARKET_CLOSED");
  });

  it("ACTIVE + STALE → KITE_FEED_DISCONNECTED", () => {
    expect(deriveGlobalDataHealthStatus("ACTIVE", "STALE", false, false)).toBe("KITE_FEED_DISCONNECTED");
  });

  it("ACTIVE + LIVE_TICKS + no blocked → TRADE_GRADE_LIVE", () => {
    expect(deriveGlobalDataHealthStatus("ACTIVE", "LIVE_TICKS", false, false)).toBe("TRADE_GRADE_LIVE");
    expect(deriveGlobalDataHealthStatus("ACTIVE", "LIVE_TICKS", false, true)).toBe("TRADE_GRADE_LIVE");
  });

  it("ACTIVE + LIVE_TICKS + anyBlocked=true → DEGRADED_DATA", () => {
    expect(deriveGlobalDataHealthStatus("ACTIVE", "LIVE_TICKS", true, false)).toBe("DEGRADED_DATA");
    expect(deriveGlobalDataHealthStatus("ACTIVE", "LIVE_TICKS", true, true)).toBe("DEGRADED_DATA");
  });

  it("ACTIVE + CONNECTED_WAITING → KITE_PARTIAL", () => {
    expect(deriveGlobalDataHealthStatus("ACTIVE", "CONNECTED_WAITING", false, false)).toBe("KITE_PARTIAL");
    expect(deriveGlobalDataHealthStatus("ACTIVE", "CONNECTED_WAITING", false, true)).toBe("KITE_PARTIAL");
  });

  it("ACTIVE + UNAVAILABLE + anyBlocked → DEGRADED_DATA (fallthrough path)", () => {
    expect(deriveGlobalDataHealthStatus("ACTIVE", "UNAVAILABLE", true, false)).toBe("DEGRADED_DATA");
  });

  it("ACTIVE + UNAVAILABLE + anyDegraded → KITE_PARTIAL (fallthrough path)", () => {
    expect(deriveGlobalDataHealthStatus("ACTIVE", "UNAVAILABLE", false, true)).toBe("KITE_PARTIAL");
  });

  it("ACTIVE + UNAVAILABLE + nothing degraded/blocked → UNAVAILABLE", () => {
    expect(deriveGlobalDataHealthStatus("ACTIVE", "UNAVAILABLE", false, false)).toBe("UNAVAILABLE");
  });
});

// ── deriveGlobalSeverity ──────────────────────────────────────────────────────

describe("deriveGlobalSeverity", () => {
  const cases: [GlobalDataHealthStatus, string][] = [
    ["TRADE_GRADE_LIVE",             "ok"],
    ["SESSION_ACTIVE_MARKET_CLOSED", "ok"],
    ["KITE_PARTIAL",                 "warn"],
    ["DEGRADED_DATA",                "orange"],
    ["KITE_FEED_DISCONNECTED",       "orange"],
    ["KITE_SESSION_EXPIRED",         "red"],
    ["KITE_SESSION_MISSING",         "red"],
    ["UNAVAILABLE",                  "red"],
  ];
  for (const [status, expectedSeverity] of cases) {
    it(`${status} → severity "${expectedSeverity}"`, () => {
      expect(deriveGlobalSeverity(status)).toBe(expectedSeverity);
    });
  }
});

// ── deriveBadgeAndHeadline ────────────────────────────────────────────────────

describe("deriveBadgeAndHeadline", () => {
  const allStatuses: GlobalDataHealthStatus[] = [
    "TRADE_GRADE_LIVE",
    "SESSION_ACTIVE_MARKET_CLOSED",
    "KITE_PARTIAL",
    "DEGRADED_DATA",
    "KITE_FEED_DISCONNECTED",
    "KITE_SESSION_EXPIRED",
    "KITE_SESSION_MISSING",
    "UNAVAILABLE",
  ];

  it("every status produces a non-empty badge and headline", () => {
    for (const s of allStatuses) {
      const { badge, headline } = deriveBadgeAndHeadline(s);
      expect(badge.length, `badge empty for ${s}`).toBeGreaterThan(0);
      expect(headline.length, `headline empty for ${s}`).toBeGreaterThan(0);
    }
  });

  it("TRADE_GRADE_LIVE → badge 'KITE LIVE'", () => {
    expect(deriveBadgeAndHeadline("TRADE_GRADE_LIVE").badge).toBe("KITE LIVE");
  });

  it("KITE_SESSION_MISSING → badge 'NO LIVE DATA'", () => {
    expect(deriveBadgeAndHeadline("KITE_SESSION_MISSING").badge).toBe("NO LIVE DATA");
  });

  it("KITE_SESSION_EXPIRED → badge 'KITE LOGIN REQUIRED'", () => {
    expect(deriveBadgeAndHeadline("KITE_SESSION_EXPIRED").badge).toBe("KITE LOGIN REQUIRED");
  });

  it("DEGRADED_DATA → badge 'DATA DEGRADED'", () => {
    expect(deriveBadgeAndHeadline("DEGRADED_DATA").badge).toBe("DATA DEGRADED");
  });

  it("SESSION_ACTIVE_MARKET_CLOSED → badge contains 'MARKET CLOSED'", () => {
    expect(deriveBadgeAndHeadline("SESSION_ACTIVE_MARKET_CLOSED").badge).toContain("MARKET CLOSED");
  });

  it("KITE_PARTIAL → badge 'KITE PARTIAL'", () => {
    expect(deriveBadgeAndHeadline("KITE_PARTIAL").badge).toBe("KITE PARTIAL");
  });

  it("KITE_FEED_DISCONNECTED → badge contains 'DISCONNECTED'", () => {
    expect(deriveBadgeAndHeadline("KITE_FEED_DISCONNECTED").badge).toContain("DISCONNECTED");
  });
});

// ── Phase 0.5B: applyCoverageGate ────────────────────────────────────────────

describe("applyCoverageGate", () => {
  it("downgrades TRADE_GRADE_LIVE when coverage is not complete", () => {
    expect(applyCoverageGate("TRADE_GRADE_LIVE", false, "LIVE_PARTIAL")).toBe("KITE_PARTIAL");
    expect(applyCoverageGate("TRADE_GRADE_LIVE", false, "STALE")).toBe("KITE_PARTIAL");
  });

  it("leaves TRADE_GRADE_LIVE intact only when coverage is genuinely complete", () => {
    expect(applyCoverageGate("TRADE_GRADE_LIVE", true, "LIVE_COMPLETE")).toBe("TRADE_GRADE_LIVE");
  });

  it("downgrades the green market-closed status on an integrity fault", () => {
    // Market being shut does not make a conflicted or misattributed price ok.
    expect(applyCoverageGate("SESSION_ACTIVE_MARKET_CLOSED", false, "CONFLICTED")).toBe("DEGRADED_DATA");
    expect(applyCoverageGate("SESSION_ACTIVE_MARKET_CLOSED", false, "RECONCILIATION_PENDING")).toBe("DEGRADED_DATA");
  });

  it("keeps the green market-closed status for the expected after-hours stale case", () => {
    // No verified official close is available to this path yet, so every
    // instrument degrades to LAST_KNOWN after close. That known gap is
    // reported through coverage.overallState, not through a nightly amber badge.
    expect(applyCoverageGate("SESSION_ACTIVE_MARKET_CLOSED", false, "STALE")).toBe("SESSION_ACTIVE_MARKET_CLOSED");
    expect(applyCoverageGate("SESSION_ACTIVE_MARKET_CLOSED", false, "MARKET_CLOSED_PARTIAL")).toBe("SESSION_ACTIVE_MARKET_CLOSED");
  });

  it("never UPGRADES a status", () => {
    for (const s of ["KITE_PARTIAL", "DEGRADED_DATA", "KITE_SESSION_EXPIRED", "KITE_SESSION_MISSING", "KITE_FEED_DISCONNECTED", "UNAVAILABLE"] as const) {
      expect(applyCoverageGate(s, true, "LIVE_COMPLETE")).toBe(s);
    }
  });
});
