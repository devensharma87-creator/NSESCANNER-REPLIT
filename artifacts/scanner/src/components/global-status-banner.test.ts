import { describe, it, expect } from "vitest";
import { deriveBannerView, type KiteReadiness, type KiteReadinessState } from "./global-status-banner";

/**
 * Unit tests for the PURE `deriveBannerView` deriver (PART B). Pins:
 *   1. null readiness → hidden (fail-open: non-owners / loading / error).
 *   2. ONLY the two critical offline states render the FULL banner; every other
 *      state is a severity-toned chip.
 *   3. Reconnect CTA shows exactly on the actionable states (offline + expired).
 *   4. EXPIRES_SOON is an info-tone chip (amber), never a full banner.
 *   5. KITE_READY chip label is nuanced by liveQuotes + marketSession (2026-07-01):
 *      - liveQuotes undefined   → legacy "Kite live" (ok) — backward compat
 *      - market closed + 0 quotes → "Kite — market closed" (ok, NOT warn)
 *      - market open + 0 quotes  → "Kite — waiting for ticks" (warn)
 *      - market open + >0 quotes → "Kite live" (ok)
 */

function mkReadiness(state: KiteReadinessState, over: Partial<KiteReadiness> = {}): KiteReadiness {
  return {
    state,
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

describe("deriveBannerView", () => {
  it("null/undefined readiness → hidden, no reconnect", () => {
    for (const r of [null, undefined]) {
      const v = deriveBannerView(r);
      expect(v.mode).toBe("hidden");
      expect(v.showReconnect).toBe(false);
    }
  });

  it("KITE_OFFLINE_PREOPEN → full / critical / reconnect", () => {
    const v = deriveBannerView(mkReadiness("KITE_OFFLINE_PREOPEN"));
    expect(v.mode).toBe("full");
    expect(v.tone).toBe("critical");
    expect(v.showReconnect).toBe(true);
    expect(v.impact.length).toBeGreaterThan(0);
  });

  it("KITE_OFFLINE_MARKET_HOURS → full / critical / reconnect", () => {
    const v = deriveBannerView(mkReadiness("KITE_OFFLINE_MARKET_HOURS"));
    expect(v.mode).toBe("full");
    expect(v.tone).toBe("critical");
    expect(v.showReconnect).toBe(true);
  });

  it("only the two critical offline states are FULL — every other state is a chip", () => {
    const states: KiteReadinessState[] = [
      "KITE_READY",
      "KITE_EXPIRES_SOON",
      "KITE_EXPIRED",
      "KITE_CONNECTED_BUT_FEED_STALE",
    ];
    for (const s of states) {
      expect(deriveBannerView(mkReadiness(s)).mode).toBe("chip");
    }
  });

  it("KITE_CONNECTED_BUT_FEED_STALE → warn chip, no reconnect", () => {
    const v = deriveBannerView(mkReadiness("KITE_CONNECTED_BUT_FEED_STALE"));
    expect(v.mode).toBe("chip");
    expect(v.tone).toBe("warn");
    expect(v.showReconnect).toBe(false);
  });

  it("KITE_EXPIRED → warn chip WITH reconnect", () => {
    const v = deriveBannerView(mkReadiness("KITE_EXPIRED"));
    expect(v.mode).toBe("chip");
    expect(v.tone).toBe("warn");
    expect(v.showReconnect).toBe(true);
  });

  it("KITE_EXPIRES_SOON → info chip (amber), no reconnect", () => {
    const v = deriveBannerView(mkReadiness("KITE_EXPIRES_SOON"));
    expect(v.mode).toBe("chip");
    expect(v.tone).toBe("info");
    expect(v.showReconnect).toBe(false);
  });

  it("KITE_READY → ok chip, no reconnect (legacy: liveQuotes omitted)", () => {
    const v = deriveBannerView(mkReadiness("KITE_READY"));
    expect(v.mode).toBe("chip");
    expect(v.tone).toBe("ok");
    expect(v.showReconnect).toBe(false);
  });

  // ── liveQuotes-aware chip labels (2026-07-01 contradiction fix) ────────────

  it("KITE_READY + market open + liveQuotes > 0 → ok chip 'Kite live'", () => {
    const v = deriveBannerView(mkReadiness("KITE_READY", { marketSession: "open" }), 5);
    expect(v.mode).toBe("chip");
    expect(v.tone).toBe("ok");
    expect(v.chipLabel).toBe("Kite live");
    expect(v.showReconnect).toBe(false);
  });

  it("KITE_READY + market open + liveQuotes = 0 → warn chip 'Kite — waiting for ticks'", () => {
    const v = deriveBannerView(mkReadiness("KITE_READY", { marketSession: "open" }), 0);
    expect(v.mode).toBe("chip");
    expect(v.tone).toBe("warn");
    expect(v.chipLabel).toBe("Kite — waiting for ticks");
    expect(v.showReconnect).toBe(false);
  });

  // Phase 0.5B final: the closed chip is NEUTRAL ("info"), not the green "ok"
  // tick. There is no verified official session close behind this path, so the
  // honest claim is "last known", not "all good".
  it("KITE_READY + market closed + liveQuotes = 0 → neutral chip 'Market closed — last known'", () => {
    const v = deriveBannerView(mkReadiness("KITE_READY", { marketSession: "closed" }), 0);
    expect(v.mode).toBe("chip");
    expect(v.tone).toBe("info");
    expect(v.tone).not.toBe("ok");
    expect(v.chipLabel).toBe("Market closed — last known");
    expect(v.showReconnect).toBe(false);
  });

  it("KITE_READY + market pre_open + liveQuotes = 0 → neutral chip 'Market closed — last known'", () => {
    const v = deriveBannerView(mkReadiness("KITE_READY", { marketSession: "pre_open" }), 0);
    expect(v.mode).toBe("chip");
    expect(v.tone).toBe("info");
    expect(v.chipLabel).toBe("Market closed — last known");
  });

  // Still not an alarm (the original contradiction this test guarded against),
  // but no longer a green all-good claim either.
  it("market-closed chip is neither an alarm nor a green all-good claim", () => {
    const v = deriveBannerView(mkReadiness("KITE_READY", { marketSession: "closed" }), 0);
    expect(v.tone).not.toBe("warn");
    expect(v.tone).not.toBe("critical");
    expect(v.tone).not.toBe("ok");
    expect(v.tone).toBe("info");
  });

  it("waiting-for-ticks chip IS warn (scanner may show delayed data)", () => {
    const v = deriveBannerView(mkReadiness("KITE_READY", { marketSession: "open" }), 0);
    expect(v.tone).toBe("warn");
  });
});
