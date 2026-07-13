import { describe, it, expect } from "vitest";
import type { OptionSignalSet } from "@workspace/api-client-react";
import type { KiteReadiness } from "@/components/global-status-banner";
import { deriveFnoEmptyReason, buildFnoIndexRows, deriveSessionBannerState, FNO_TABLE_INDICES } from "./fnoEmptyState";

/**
 * Unit tests for the PURE F&O no-live-data helpers (PART C). Display-only:
 * they read marketState/marketStatus + diagnostics.suppressed + signals + owner readiness and
 * NEVER recompute a signal. Pins the cause-priority order and the honest "—".
 */

type MkMarketStatus = {
  marketOpen: boolean;
  reason?: "OPEN" | "BEFORE_OPEN" | "PRE_OPEN" | "AFTER_CLOSE" | "WEEKEND" | "HOLIDAY" | "UNKNOWN";
};

function mkSet(over: {
  marketState?: "open" | "closed" | "pre_open";
  marketStatus?: MkMarketStatus;
  signals?: { index: string }[];
  suppressed?: { index: string; reasons: string[] }[];
}): OptionSignalSet {
  const ms = over.marketStatus;
  return {
    signals: over.signals ?? [],
    marketState: over.marketState,
    ...(ms != null ? {
      marketStatus: {
        marketOpen: ms.marketOpen,
        reason: ms.reason ?? (ms.marketOpen ? "OPEN" : "AFTER_CLOSE"),
        isTradingDay: true,
        serverUtc: new Date(),
        serverIst: "10:00 13-Jul-2026",
        exchangeTimezone: "Asia/Kolkata",
        openTimeIst: "09:15",
        closeTimeIst: "15:30",
        calendarSource: "TEST",
        calendarAsOf: "2026-12-31",
      },
    } : {}),
    diagnostics: { suppressed: over.suppressed ?? [] },
  } as unknown as OptionSignalSet;
}

function mkReadiness(over: Partial<KiteReadiness>): KiteReadiness {
  return {
    state: "KITE_READY",
    severity: "ok",
    sessionPresent: true,
    sessionValid: true,
    loginTime: null,
    expiresAt: null,
    kiteOfflineSince: null,
    marketSession: "open",
    isPreOpenWindow: false,
    feedConnected: true,
    feedRunning: true,
    userActionRequired: false,
    checkedAt: new Date().toISOString(),
    ...over,
  };
}

describe("deriveFnoEmptyReason — cause priority", () => {
  it("market closed wins over everything (even when Kite is offline)", () => {
    const r = deriveFnoEmptyReason(
      mkSet({ marketState: "closed" }),
      mkReadiness({ sessionValid: false, feedConnected: false }),
    );
    expect(r).toBe("No setups because the market is closed.");
  });

  it("pre_open is also treated as market closed", () => {
    expect(deriveFnoEmptyReason(mkSet({ marketState: "pre_open" }), null)).toBe(
      "No setups because the market is closed.",
    );
  });

  it("market open + Kite session invalid → Kite offline message", () => {
    expect(
      deriveFnoEmptyReason(mkSet({ marketState: "open" }), mkReadiness({ sessionValid: false })),
    ).toBe("No setups because Kite live intraday data is unavailable. Reconnect Kite.");
  });

  it("market open + feed disconnected → Kite offline message", () => {
    expect(
      deriveFnoEmptyReason(mkSet({ marketState: "open" }), mkReadiness({ feedConnected: false })),
    ).toBe("No setups because Kite live intraday data is unavailable. Reconnect Kite.");
  });

  it("market open + Kite ok + option-chain suppression → option chain message", () => {
    const set = mkSet({
      marketState: "open",
      suppressed: [{ index: "NIFTY", reasons: ["NIFTY: option chain unavailable"] }],
    });
    expect(deriveFnoEmptyReason(set, mkReadiness({}))).toBe(
      "No setups because the option chain is unavailable.",
    );
  });

  it("market open + Kite ok + only floor/veto reasons → floor message", () => {
    const set = mkSet({
      marketState: "open",
      suppressed: [{ index: "NIFTY", reasons: ["TREND_CONTINUATION: confidence 58 < HC emission floor 60"] }],
    });
    expect(deriveFnoEmptyReason(set, mkReadiness({}))).toBe(
      "No setups because no candidate cleared the confidence floor or risk gates right now.",
    );
  });

  it("undefined data + null readiness → floor message (safe default)", () => {
    expect(deriveFnoEmptyReason(undefined, null)).toBe(
      "No setups because no candidate cleared the confidence floor or risk gates right now.",
    );
  });

  it("marketStatus.marketOpen=false wins over stale marketState (prefer new field)", () => {
    expect(deriveFnoEmptyReason(
      mkSet({ marketStatus: { marketOpen: false }, marketState: "open" }),
      null,
    )).toBe("No setups because the market is closed.");
  });

  it("marketStatus.marketOpen=true → does NOT say market is closed even when marketState=closed (stale cache fix)", () => {
    const r = deriveFnoEmptyReason(
      mkSet({ marketStatus: { marketOpen: true }, marketState: "closed" }),
      mkReadiness({}),
    );
    expect(r).not.toContain("market is closed");
    expect(r).toBe("No setups because no candidate cleared the confidence floor or risk gates right now.");
  });

  it("marketStatus.marketOpen=true + Kite offline → Kite message (not market closed)", () => {
    expect(deriveFnoEmptyReason(
      mkSet({ marketStatus: { marketOpen: true } }),
      mkReadiness({ sessionValid: false }),
    )).toBe("No setups because Kite live intraday data is unavailable. Reconnect Kite.");
  });

  it("no marketStatus and no marketState → floor message (safe when both absent)", () => {
    expect(deriveFnoEmptyReason(mkSet({}), null)).toBe(
      "No setups because no candidate cleared the confidence floor or risk gates right now.",
    );
  });
});

describe("buildFnoIndexRows", () => {
  it("always returns exactly the 3 F&O indices in order", () => {
    const rows = buildFnoIndexRows(mkSet({}), null);
    expect(rows.map(r => r.index)).toEqual([...FNO_TABLE_INDICES]);
  });

  it("null readiness → liveKiteData is honest '—' (never a fake Live)", () => {
    const rows = buildFnoIndexRows(mkSet({ marketState: "open" }), null);
    expect(rows.every(r => r.liveKiteData === "—")).toBe(true);
  });

  it("ready readiness → Live; offline → Offline", () => {
    expect(buildFnoIndexRows(mkSet({}), mkReadiness({}))[0]!.liveKiteData).toBe("Live");
    expect(
      buildFnoIndexRows(mkSet({}), mkReadiness({ sessionValid: false }))[0]!.liveKiteData,
    ).toBe("Offline");
  });

  it("candidate count + Option Chain Available when signals exist for the index", () => {
    const rows = buildFnoIndexRows(
      mkSet({ signals: [{ index: "NIFTY" }, { index: "NIFTY" }, { index: "SENSEX" }] }),
      mkReadiness({}),
    );
    const nifty = rows.find(r => r.index === "NIFTY")!;
    expect(nifty.candidate).toBe("Yes (2)");
    expect(nifty.optionChain).toBe("Available");
    expect(rows.find(r => r.index === "BANKNIFTY")!.candidate).toBe("No");
  });

  it("Option Chain Unavailable when a suppression reason names the chain", () => {
    const rows = buildFnoIndexRows(
      mkSet({ suppressed: [{ index: "BANKNIFTY", reasons: ["option chain unavailable"] }] }),
      mkReadiness({}),
    );
    expect(rows.find(r => r.index === "BANKNIFTY")!.optionChain).toBe("Unavailable");
  });

  it("Option Chain '—' when neither signals nor a chain reason exist", () => {
    const rows = buildFnoIndexRows(mkSet({}), mkReadiness({}));
    expect(rows.every(r => r.optionChain === "—")).toBe(true);
  });

  it("reason joins suppressed reasons; '—' when none and no signals", () => {
    const rows = buildFnoIndexRows(
      mkSet({ suppressed: [{ index: "NIFTY", reasons: ["a", "b"] }] }),
      mkReadiness({}),
    );
    expect(rows.find(r => r.index === "NIFTY")!.reason).toBe("a; b");
    expect(rows.find(r => r.index === "SENSEX")!.reason).toBe("—");
  });

  it("reason is 'Setups live' when the index has signals but no suppression", () => {
    const rows = buildFnoIndexRows(mkSet({ signals: [{ index: "NIFTY" }] }), mkReadiness({}));
    expect(rows.find(r => r.index === "NIFTY")!.reason).toBe("Setups live");
  });

  it("state label reflects marketState", () => {
    expect(buildFnoIndexRows(mkSet({ marketState: "open" }), null)[0]!.state).toBe("Open");
    expect(buildFnoIndexRows(mkSet({ marketState: "closed" }), null)[0]!.state).toBe("Closed");
    expect(buildFnoIndexRows(mkSet({ marketState: "pre_open" }), null)[0]!.state).toBe("Pre-open");
    expect(buildFnoIndexRows(mkSet({}), null)[0]!.state).toBe("—");
  });

  it("state label prefers marketStatus.marketOpen=true over stale marketState=closed", () => {
    const rows = buildFnoIndexRows(
      mkSet({ marketStatus: { marketOpen: true }, marketState: "closed" }),
      null,
    );
    expect(rows[0]!.state).toBe("Open");
  });

  it("state label from marketStatus: closed→Closed, PRE_OPEN→Pre-open", () => {
    expect(buildFnoIndexRows(
      mkSet({ marketStatus: { marketOpen: false } }),
      null,
    )[0]!.state).toBe("Closed");
    expect(buildFnoIndexRows(
      mkSet({ marketStatus: { marketOpen: false, reason: "PRE_OPEN" } }),
      null,
    )[0]!.state).toBe("Pre-open");
  });
});

// ─── deriveSessionBannerState ──────────────────────────────────────────────

describe("deriveSessionBannerState", () => {
  /** All 3 F&O indices suppressed with a specific reason on each. */
  function mkAllSuppressed(reason: string): OptionSignalSet {
    return mkSet({
      marketState: "open",
      suppressed: FNO_TABLE_INDICES.map((index) => ({ index, reasons: [reason] })),
    });
  }

  it("returns show:false when readiness is null (non-owner)", () => {
    const state = deriveSessionBannerState(mkAllSuppressed("no_live_kite_intraday"), null, null, null);
    expect(state.show).toBe(false);
  });

  it("returns show:false when market is closed", () => {
    const data = mkSet({ marketState: "closed" });
    const state = deriveSessionBannerState(data, mkReadiness({}), null, null);
    expect(state.show).toBe(false);
  });

  it("returns show:false when data is undefined/null", () => {
    const state = deriveSessionBannerState(undefined as unknown as OptionSignalSet, mkReadiness({}), null, null);
    expect(state.show).toBe(false);
  });

  it("returns show:false when fewer than 3 indices are suppressed", () => {
    const data = mkSet({
      marketState: "open",
      suppressed: [{ index: "NIFTY", reasons: ["no_live_kite_intraday"] }],
    });
    const state = deriveSessionBannerState(data, mkReadiness({}), null, null);
    expect(state.show).toBe(false);
  });

  it("returns show:false when at least one index has a live signal", () => {
    const data = mkSet({
      marketState: "open",
      signals: [{ index: "NIFTY" }],
      suppressed: [
        { index: "BANKNIFTY", reasons: ["no_live_kite_intraday"] },
        { index: "SENSEX",    reasons: ["no_live_kite_intraday"] },
      ],
    });
    const state = deriveSessionBannerState(data, mkReadiness({}), null, null);
    expect(state.show).toBe(false);
  });

  it("classifies KITE_SESSION_EXPIRED when all 3 suppressed with no_live_kite_intraday", () => {
    const state = deriveSessionBannerState(
      mkAllSuppressed("no_live_kite_intraday (session expired)"),
      mkReadiness({}), 8, "2026-06-20T09:00:00Z",
    );
    expect(state.show).toBe(true);
    if (!state.show) return;
    expect(state.kind).toBe("KITE_SESSION_EXPIRED");
    expect(state.isDataIssue).toBe(true);
    expect(state.gapTradingDays).toBe(8);
    expect(state.lastSignalAt).toBe("2026-06-20T09:00:00Z");
  });

  it("classifies FNO_DATA_WARMING_UP when all 3 suppressed with daily_history_warmup", () => {
    const state = deriveSessionBannerState(
      mkAllSuppressed("daily_history_warmup_kite (session 45s old — history API warming up)"),
      mkReadiness({}), 0, null,
    );
    expect(state.show).toBe(true);
    if (!state.show) return;
    expect(state.kind).toBe("FNO_DATA_WARMING_UP");
    expect(state.isDataIssue).toBe(true);
  });

  it("classifies FNO_ALL_SUPPRESSED for non-data reasons (not marked isDataIssue)", () => {
    const state = deriveSessionBannerState(
      mkAllSuppressed("circuit-breaker veto: 2 stops today"),
      mkReadiness({}), null, null,
    );
    expect(state.show).toBe(true);
    if (!state.show) return;
    expect(state.kind).toBe("FNO_ALL_SUPPRESSED");
    expect(state.isDataIssue).toBe(false);
  });

  it("KITE_SESSION_EXPIRED takes precedence over DAILY_HISTORY_WARMUP in mixed reasons", () => {
    const data = mkSet({
      marketState: "open",
      suppressed: [
        { index: "NIFTY",     reasons: ["no_live_kite_intraday (session expired)"] },
        { index: "BANKNIFTY", reasons: ["daily_history_warmup_kite (session 10s)"] },
        { index: "SENSEX",    reasons: ["no_live_kite_intraday (session expired)"] },
      ],
    });
    const state = deriveSessionBannerState(data, mkReadiness({}), 3, null);
    expect(state.show).toBe(true);
    if (!state.show) return;
    expect(state.kind).toBe("KITE_SESSION_EXPIRED");
  });

  it("passes through gapTradingDays=null when not provided", () => {
    const state = deriveSessionBannerState(
      mkAllSuppressed("no_live_kite_intraday (session expired)"),
      mkReadiness({}), null, null,
    );
    expect(state.show).toBe(true);
    if (!state.show) return;
    expect(state.gapTradingDays).toBeNull();
  });

  it("returns show:false when marketStatus.marketOpen=false (prefers new field over marketState)", () => {
    const data = mkSet({
      marketStatus: { marketOpen: false },
      marketState: "open",
      suppressed: FNO_TABLE_INDICES.map(index => ({ index, reasons: ["no_live_kite_intraday"] })),
    });
    const state = deriveSessionBannerState(data, mkReadiness({}), null, null);
    expect(state.show).toBe(false);
  });

  it("shows banner when marketStatus.marketOpen=true even if marketState=closed (stale cache fix)", () => {
    const data = mkSet({
      marketStatus: { marketOpen: true },
      marketState: "closed",
      suppressed: FNO_TABLE_INDICES.map(index => ({ index, reasons: ["no_live_kite_intraday (session expired)"] })),
    });
    const state = deriveSessionBannerState(data, mkReadiness({}), null, null);
    expect(state.show).toBe(true);
    if (!state.show) return;
    expect(state.kind).toBe("KITE_SESSION_EXPIRED");
  });
});
