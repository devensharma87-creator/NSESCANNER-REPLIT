import { describe, it, expect } from "vitest";
import type { OptionSignalSet } from "@workspace/api-client-react";
import type { KiteReadiness } from "@/components/global-status-banner";
import { deriveFnoEmptyReason, buildFnoIndexRows, FNO_TABLE_INDICES } from "./fnoEmptyState";

/**
 * Unit tests for the PURE F&O no-live-data helpers (PART C). Display-only:
 * they read marketState + diagnostics.suppressed + signals + owner readiness and
 * NEVER recompute a signal. Pins the cause-priority order and the honest "—".
 */

function mkSet(over: {
  marketState?: "open" | "closed" | "pre_open";
  signals?: { index: string }[];
  suppressed?: { index: string; reasons: string[] }[];
}): OptionSignalSet {
  return {
    signals: over.signals ?? [],
    marketState: over.marketState,
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
});
