import { describe, it, expect } from "vitest";
import { deriveTvFreshness, TV_ALERT_FRESH_MINUTES } from "./tradingview-alerts";

/**
 * Unit tests for the PURE TradingView freshness classifier (PART D). Pins the
 * priority order and the core guarantee: a 2-month-old alert is NEVER LIVE.
 */

const NOW = new Date("2026-06-23T10:00:00.000Z");

function minsAgo(min: number): string {
  return new Date(NOW.getTime() - min * 60_000).toISOString();
}

describe("deriveTvFreshness", () => {
  it("no webhook secret → WEBHOOK_NOT_CONFIGURED (wins even when alerts exist)", () => {
    const f = deriveTvFreshness({
      alerts: [{ receivedAt: minsAgo(1) }],
      secretConfigured: false,
      now: NOW,
    });
    expect(f.state).toBe("WEBHOOK_NOT_CONFIGURED");
    expect(f.newestReceivedAt).toBeNull();
    expect(f.newestAgeMinutes).toBeNull();
  });

  it("secret configured but no alerts → NO_ALERTS_RECEIVED", () => {
    const f = deriveTvFreshness({ alerts: [], secretConfigured: true, now: NOW });
    expect(f.state).toBe("NO_ALERTS_RECEIVED");
    expect(f.newestReceivedAt).toBeNull();
  });

  it("newest within window → LIVE, with age + newest timestamp", () => {
    const ts = minsAgo(30);
    const f = deriveTvFreshness({
      alerts: [{ receivedAt: minsAgo(200) }, { receivedAt: ts }],
      secretConfigured: true,
      now: NOW,
    });
    expect(f.state).toBe("LIVE");
    expect(f.newestReceivedAt).toBe(ts);
    expect(f.newestAgeMinutes).toBeCloseTo(30, 5);
  });

  it("newest older than window → STALE (2-month-old never renders LIVE)", () => {
    const f = deriveTvFreshness({
      alerts: [{ receivedAt: minsAgo(60 * 24 * 60) }],
      secretConfigured: true,
      now: NOW,
    });
    expect(f.state).toBe("STALE");
    expect(f.newestAgeMinutes).toBeGreaterThan(TV_ALERT_FRESH_MINUTES);
  });

  it("exactly at the window boundary is still LIVE (<=)", () => {
    const f = deriveTvFreshness({
      alerts: [{ receivedAt: minsAgo(TV_ALERT_FRESH_MINUTES) }],
      secretConfigured: true,
      now: NOW,
    });
    expect(f.state).toBe("LIVE");
  });

  it("custom windowMinutes is honoured", () => {
    const f = deriveTvFreshness({
      alerts: [{ receivedAt: minsAgo(45) }],
      secretConfigured: true,
      now: NOW,
      windowMinutes: 30,
    });
    expect(f.state).toBe("STALE");
  });

  it("picks the newest among unsorted alerts", () => {
    const newest = minsAgo(5);
    const f = deriveTvFreshness({
      alerts: [{ receivedAt: minsAgo(500) }, { receivedAt: newest }, { receivedAt: minsAgo(90) }],
      secretConfigured: true,
      now: NOW,
    });
    expect(f.newestReceivedAt).toBe(newest);
    expect(f.state).toBe("LIVE");
  });
});
