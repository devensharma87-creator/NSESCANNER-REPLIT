import { describe, it, expect } from "vitest";
import {
  buildSourceProvenance,
  shouldDemoteSignal,
  isEodTimeframe,
} from "./scannerProvenance";

const NOW = Date.UTC(2026, 5, 10, 6, 0, 0); // 2026-06-10T06:00:00Z
const nowSec = Math.floor(NOW / 1000);

describe("buildSourceProvenance", () => {
  it("labels kite intraday as authoritative, fresh, and signal-eligible", () => {
    const p = buildSourceProvenance({
      provider: "kite",
      asOfSec: nowSec - 60, // 1 min old, within 15m budget (2700s)
      tf: "15m",
      now: NOW,
    });
    expect(p.sourceProvider).toBe("kite");
    expect(p.trustTier).toBe("authoritative");
    expect(p.sourcePriority).toBe(1);
    expect(p.delayed).toBe(false); // intraday kite is not delayed
    expect(p.notForSignals).toBe(false);
    expect(p.notForTradeDecisions).toBe(false);
    expect(p.isStale).toBe(false);
    expect(p.freshnessSec).toBe(60);
    expect(p.missingReason).toBeNull();
    expect(shouldDemoteSignal(p)).toBe(false);
  });

  it("flags a fresh kite DAILY bar as delayed (EOD is never live) but still authoritative", () => {
    const p = buildSourceProvenance({
      provider: "kite",
      asOfSec: nowSec - 3600, // 1h old, well within 1D budget
      tf: "1D",
      now: NOW,
    });
    expect(p.trustTier).toBe("authoritative");
    expect(p.delayed).toBe(true); // EOD timeframe
    expect(p.isStale).toBe(false);
    expect(p.notForSignals).toBe(false);
  });

  it("marks a stale kite point when older than the timeframe budget", () => {
    const p = buildSourceProvenance({
      provider: "kite",
      asOfSec: nowSec - 4000, // > 2700s (15m budget) → stale
      tf: "15m",
      now: NOW,
    });
    expect(p.isStale).toBe(true);
    // still authoritative source, but a stale signal must be demoted
    expect(p.trustTier).toBe("authoritative");
    expect(shouldDemoteSignal(p)).toBe(true);
  });

  it("labels yahoo as delayed secondary_analytics, never for signals or trades", () => {
    const p = buildSourceProvenance({
      provider: "yahoo",
      asOfSec: nowSec - 60,
      tf: "15m",
      now: NOW,
    });
    expect(p.sourceProvider).toBe("yahoo");
    expect(p.trustTier).toBe("secondary_analytics");
    expect(p.sourcePriority).toBe(3);
    expect(p.delayed).toBe(true);
    expect(p.notForSignals).toBe(true);
    expect(p.notForTradeDecisions).toBe(true);
    expect(shouldDemoteSignal(p)).toBe(true); // demote even when fresh
  });

  it("returns an unavailable envelope with a reason when no source resolved", () => {
    const p = buildSourceProvenance({
      provider: null,
      asOfSec: null,
      tf: "1D",
      now: NOW,
      missingReason: "Quote unavailable from Kite and no labelled fallback",
    });
    expect(p.sourceProvider).toBeNull();
    expect(p.trustTier).toBe("unavailable");
    expect(p.sourcePriority).toBe(99);
    expect(p.notForSignals).toBe(true);
    expect(p.notForTradeDecisions).toBe(true);
    expect(p.asOf).toBeNull();
    expect(p.freshnessSec).toBeNull();
    expect(p.isStale).toBeNull();
    expect(p.missingReason).toBe("Quote unavailable from Kite and no labelled fallback");
    expect(shouldDemoteSignal(p)).toBe(true);
  });

  it("uses a default reason when none supplied for an unavailable point", () => {
    const p = buildSourceProvenance({ provider: null, asOfSec: null, tf: "1D", now: NOW });
    expect(p.missingReason).toMatch(/no trusted source/i);
  });

  it("keeps asOf/freshness null when a present provider has no timestamp", () => {
    const p = buildSourceProvenance({ provider: "kite", asOfSec: null, tf: "15m", now: NOW });
    expect(p.asOf).toBeNull();
    expect(p.freshnessSec).toBeNull();
    expect(p.isStale).toBeNull();
  });

  it("passes through warnings", () => {
    const p = buildSourceProvenance({
      provider: "yahoo",
      asOfSec: nowSec,
      tf: "1D",
      now: NOW,
      warnings: ["Only 120 daily candles available"],
    });
    expect(p.warnings).toEqual(["Only 120 daily candles available"]);
  });
});

describe("isEodTimeframe", () => {
  it("treats daily/weekly/monthly as EOD and intraday as not", () => {
    expect(isEodTimeframe("1D")).toBe(true);
    expect(isEodTimeframe("1W")).toBe(true);
    expect(isEodTimeframe("1M")).toBe(true);
    expect(isEodTimeframe("15m")).toBe(false);
    expect(isEodTimeframe("1h")).toBe(false);
  });
});
