/**
 * Phase A0.3.2 — §9 Paper admission exclusion tests.
 *
 * Proves that signals attributable to the three retired/unavailable setups
 * (VOLUME_BREAKOUT, MEAN_REVERSION without authVwap, TREND_CONTINUATION_NO_VWAP)
 * cannot reach openPaperTrade() in paperTradingFO.ts.
 *
 * Two-layer proof:
 *   Layer 1 (signal-emission gate): buildSignalsForIndex never emits those
 *     setupKeys from a cash-index zero-volume context.
 *   Layer 2 (paper-admission gate): openPaperTrade returns null immediately
 *     due to FNO_AUTO_OPEN_C0_BLOCKED=true — the absolute first statement.
 *
 * Separate from c0Enforcement.test.ts (which proves the general C0 gate).
 * This file proves the gate is specifically correct for the A0.3.2 retired setups.
 */

import { describe, it, expect } from "vitest";
import {
  buildSignalsForIndex,
  computeAllIndexFnoSetupAvailability,
  OPTION_INDICES,
  type Ctx,
} from "./optionSignals.js";
import { FNO_AUTO_OPEN_C0_BLOCKED, openPaperTrade } from "./paperTradingFO.js";
import type { LifecycleHookInput } from "./paperTradingFO.js";
import type { YahooChart } from "./yahoo.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NIFTY_CFG = OPTION_INDICES.find(c => c.symbol === "NIFTY")!;
const BANKNIFTY_CFG = OPTION_INDICES.find(c => c.symbol === "BANKNIFTY")!;
const SENSEX_CFG = OPTION_INDICES.find(c => c.symbol === "SENSEX")!;

/** Zero-volume intraday chart — cash-index structural reality. */
function makeZeroVolIntra(n: number, flat: number, sym = "NIFTY"): YahooChart {
  const ts = Array.from({ length: n }, (_, i) => 1_700_000_000 + i * 900);
  return {
    symbol: sym,
    meta: { symbol: sym, regularMarketPrice: flat },
    timestamps: ts,
    open: Array(n).fill(flat),
    high: Array(n).fill(flat * 1.002),
    low: Array(n).fill(flat * 0.998),
    close: Array(n).fill(flat),
    volume: Array(n).fill(0),
  };
}

/** Zero-volume daily chart. */
function makeZeroVolDaily(flat: number, sym = "NIFTY"): YahooChart {
  const n = 60;
  const ts = Array.from({ length: n }, (_, i) => 1_690_000_000 + i * 86_400);
  return {
    symbol: sym,
    meta: { symbol: sym, regularMarketPrice: flat },
    timestamps: ts,
    open: Array(n).fill(flat),
    high: Array(n).fill(flat * 1.005),
    low: Array(n).fill(flat * 0.995),
    close: Array(n).fill(flat),
    volume: Array(n).fill(0),
  };
}

/** Minimal LifecycleHookInput for testing — C0 fires before any field is read. */
function makeFnoInput(index: string, setupKey: string): LifecycleHookInput {
  return {
    prev: null,
    next: "TRIGGERED",
    exited: false,
    signal: { index, setupKey } as unknown,
    signalDate: "2026-07-28",
    direction: "BULLISH",
  } as unknown as LifecycleHookInput;
}

// ─── Layer 1: Signal-emission gate ───────────────────────────────────────────

describe("§9 A0.3.2 — Layer 1: No retired/unavailable setup signals emitted from cash indices", () => {
  describe("NIFTY — zero-volume structural context", () => {
    const intra = makeZeroVolIntra(30, 24600);
    const daily = makeZeroVolDaily(24600);
    const result = buildSignalsForIndex(NIFTY_CFG, intra, daily);

    it("setupAvailability has exactly 3 records for NIFTY", () => {
      expect(result.setupAvailability).toHaveLength(3);
    });

    it("all 3 NIFTY availability records have indexSymbol=NIFTY", () => {
      for (const e of result.setupAvailability) {
        expect(e.indexSymbol).toBe("NIFTY");
      }
    });

    it("VOLUME_BREAKOUT is UNAVAILABLE_REQUIRED_INPUT for NIFTY", () => {
      const e = result.setupAvailability.find(e => e.setupKey === "VOLUME_BREAKOUT");
      expect(e).toBeDefined();
      expect(e!.status).toBe("UNAVAILABLE_REQUIRED_INPUT");
    });

    it("MEAN_REVERSION is UNAVAILABLE_REQUIRED_INPUT for NIFTY", () => {
      const e = result.setupAvailability.find(e => e.setupKey === "MEAN_REVERSION");
      expect(e).toBeDefined();
      expect(e!.status).toBe("UNAVAILABLE_REQUIRED_INPUT");
    });

    it("TREND_CONTINUATION_NO_VWAP is RETIRED_INDEX_FNO_POLICY for NIFTY", () => {
      const e = result.setupAvailability.find(e => e.setupKey === "TREND_CONTINUATION_NO_VWAP");
      expect(e).toBeDefined();
      expect(e!.status).toBe("RETIRED_INDEX_FNO_POLICY");
    });

    it("no VOLUME_BREAKOUT signal emitted for NIFTY", () => {
      expect(result.signals.filter(s => s.setupKey === "VOLUME_BREAKOUT")).toHaveLength(0);
    });

    it("no MEAN_REVERSION signal emitted for NIFTY", () => {
      expect(result.signals.filter(s => s.setupKey === "MEAN_REVERSION")).toHaveLength(0);
    });

    it("no TREND_CONTINUATION_NO_VWAP signal emitted (not a valid emittable setupKey)", () => {
      expect(
        result.signals.filter(s => (s.setupKey as unknown as string) === "TREND_CONTINUATION_NO_VWAP"),
      ).toHaveLength(0);
    });
  });

  describe("BANKNIFTY — zero-volume structural context", () => {
    const intra = makeZeroVolIntra(30, 50000);
    const daily = makeZeroVolDaily(50000);
    const result = buildSignalsForIndex(BANKNIFTY_CFG, intra, daily);

    it("no VOLUME_BREAKOUT signal emitted for BANKNIFTY", () => {
      expect(result.signals.filter(s => s.setupKey === "VOLUME_BREAKOUT")).toHaveLength(0);
    });

    it("no MEAN_REVERSION signal emitted for BANKNIFTY", () => {
      expect(result.signals.filter(s => s.setupKey === "MEAN_REVERSION")).toHaveLength(0);
    });

    it("BANKNIFTY setupAvailability has 3 records with indexSymbol=BANKNIFTY", () => {
      expect(result.setupAvailability).toHaveLength(3);
      for (const e of result.setupAvailability) {
        expect(e.indexSymbol).toBe("BANKNIFTY");
      }
    });
  });

  describe("SENSEX — zero-volume structural context", () => {
    const intra = makeZeroVolIntra(30, 73000);
    const daily = makeZeroVolDaily(73000);
    const result = buildSignalsForIndex(SENSEX_CFG, intra, daily);

    it("no VOLUME_BREAKOUT signal emitted for SENSEX", () => {
      expect(result.signals.filter(s => s.setupKey === "VOLUME_BREAKOUT")).toHaveLength(0);
    });

    it("no MEAN_REVERSION signal emitted for SENSEX", () => {
      expect(result.signals.filter(s => s.setupKey === "MEAN_REVERSION")).toHaveLength(0);
    });

    it("SENSEX setupAvailability has 3 records with indexSymbol=SENSEX", () => {
      expect(result.setupAvailability).toHaveLength(3);
      for (const e of result.setupAvailability) {
        expect(e.indexSymbol).toBe("SENSEX");
      }
    });
  });

  describe("full 9-record computeAllIndexFnoSetupAvailability() — data-independent", () => {
    const entries = computeAllIndexFnoSetupAvailability();

    it("always returns exactly 9 records regardless of runtime state", () => {
      expect(entries).toHaveLength(9);
    });

    it("retired/unavailable setupKeys are never emittable signal setupKeys", () => {
      const retiredKeys = new Set(
        entries
          .filter(e => e.status !== "ACTIVE")
          .map(e => e.setupKey),
      );
      // The above set = {"VOLUME_BREAKOUT", "MEAN_REVERSION", "TREND_CONTINUATION_NO_VWAP"}
      // These must never appear as OptionSignal.setupKey values.
      // (TREND_CONTINUATION is emittable — TREND_CONTINUATION_NO_VWAP is not.)
      expect(retiredKeys).toContain("VOLUME_BREAKOUT");
      expect(retiredKeys).toContain("MEAN_REVERSION");
      expect(retiredKeys).toContain("TREND_CONTINUATION_NO_VWAP");
      expect(retiredKeys.has("TREND_CONTINUATION")).toBe(false);
      expect(retiredKeys.has("VWAP_RECLAIM")).toBe(false);
      expect(retiredKeys.has("BASELINE")).toBe(false);
    });
  });
});

// ─── Layer 2: Paper-admission gate ───────────────────────────────────────────

describe("§9 A0.3.2 — Layer 2: openPaperTrade rejects all inputs (FNO_AUTO_OPEN_C0_BLOCKED=true)", () => {
  it("FNO_AUTO_OPEN_C0_BLOCKED is true — F&O paper admission universally blocked", () => {
    expect(FNO_AUTO_OPEN_C0_BLOCKED).toBe(true);
  });

  it("VOLUME_BREAKOUT signal → openPaperTrade returns null (C0 gate before any field read)", async () => {
    const input = makeFnoInput("NIFTY", "VOLUME_BREAKOUT");
    const result = await openPaperTrade(input);
    expect(result).toBeNull();
  });

  it("MEAN_REVERSION signal (no authVwap) → openPaperTrade returns null (C0 gate)", async () => {
    const input = makeFnoInput("NIFTY", "MEAN_REVERSION");
    const result = await openPaperTrade(input);
    expect(result).toBeNull();
  });

  it("TREND_CONTINUATION_NO_VWAP signal → openPaperTrade returns null (C0 gate)", async () => {
    const input = makeFnoInput("NIFTY", "TREND_CONTINUATION_NO_VWAP");
    const result = await openPaperTrade(input);
    expect(result).toBeNull();
  });

  it("all three retired setups across all three indices → always null", async () => {
    const retired = [
      ["NIFTY", "VOLUME_BREAKOUT"],
      ["NIFTY", "MEAN_REVERSION"],
      ["NIFTY", "TREND_CONTINUATION_NO_VWAP"],
      ["BANKNIFTY", "VOLUME_BREAKOUT"],
      ["BANKNIFTY", "MEAN_REVERSION"],
      ["BANKNIFTY", "TREND_CONTINUATION_NO_VWAP"],
      ["SENSEX", "VOLUME_BREAKOUT"],
      ["SENSEX", "MEAN_REVERSION"],
      ["SENSEX", "TREND_CONTINUATION_NO_VWAP"],
    ] as const;

    for (const [index, setupKey] of retired) {
      const result = await openPaperTrade(makeFnoInput(index, setupKey));
      expect(result, `${index}:${setupKey} must return null`).toBeNull();
    }
  });
});
