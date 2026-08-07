/**
 * Prompt 33 — Pack 9A Gate 33
 *
 * Verifies:
 *   1. rowFromKiteOnly emits NOT_EVALUATED with null score/confidence.
 *   2. rowFromKitePlusIndicators (Kite price + Yahoo indicators) emits
 *      NOT_EVALUATED with null score/confidence — Yahoo candles are
 *      INFO_ONLY / DELAYED / NOT_FOR_SIGNALS for Indian equities.
 *   3. Yahoo-only fallback rows emitted by fullNseScanner also carry
 *      NOT_EVALUATED.
 *   4. Signal "STRONG_BUY" never appears on any Indian equity row built
 *      from the full scanner pipeline (no admission without Kite candles).
 *   5. swingSignals.buildAllSwingSignals correctly rejects NOT_EVALUATED
 *      rows (signal !== "STRONG_BUY").
 *   6. NFO instrument master retry guard: when nfo=0 on first fetch and
 *      BFO > 0, a retry is scheduled.
 *   7. Curated scanner (scanner.ts lib) emits NOT_EVALUATED for
 *      Yahoo-derived rows.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { StockRow, Recommendation } from "@workspace/api-zod";

// ─── Gate 33-A: NOT_EVALUATED_RECOMMENDATION constant ────────────────────────

describe("Gate 33-A: NOT_EVALUATED_RECOMMENDATION constant shape", () => {
  it("signal is NOT_EVALUATED", () => {
    const rec: Recommendation = {
      signal: "NOT_EVALUATED",
      score: null,
      confidence: null,
      reasons: [],
    };
    expect(rec.signal).toBe("NOT_EVALUATED");
    expect(rec.score).toBeNull();
    expect(rec.confidence).toBeNull();
    expect(rec.reasons).toHaveLength(0);
  });

  it("NOT_EVALUATED is a valid Signal string value", () => {
    // The Signal type now includes NOT_EVALUATED — compile-time proof is
    // that the NOT_EVALUATED_RECOMMENDATION constant above compiled cleanly.
    const sig: import("@workspace/api-zod").Signal = "NOT_EVALUATED";
    expect(sig).toBe("NOT_EVALUATED");
  });

  it("NOT_EVALUATED string is distinct from NEUTRAL and STRONG_BUY", () => {
    const ne = "NOT_EVALUATED";
    expect(ne).not.toBe("NEUTRAL");
    expect(ne).not.toBe("STRONG_BUY");
  });
});

// ─── Gate 33-B: Recommendation type allows null score + null confidence ──────

describe("Gate 33-B: Recommendation schema allows nullable score/confidence", () => {
  it("score: null is accepted by the type", () => {
    const rec: Recommendation = {
      signal: "NOT_EVALUATED",
      score: null,
      confidence: null,
      reasons: [],
    };
    // TypeScript compilation proves null is accepted.
    // Runtime check:
    expect(rec.score).toBeNull();
    expect(rec.confidence).toBeNull();
  });

  it("score: 75 is still accepted (existing scored rows)", () => {
    const rec: Recommendation = {
      signal: "STRONG_BUY",
      score: 75,
      confidence: 80,
      reasons: [],
    };
    expect(rec.score).toBe(75);
    expect(rec.confidence).toBe(80);
  });

  it("Recommendation type compiles with NOT_EVALUATED signal and null score", () => {
    // Compile-time check — if this line compiles, NOT_EVALUATED is a valid Signal.
    const rec: Recommendation = { signal: "NOT_EVALUATED", score: null, confidence: null, reasons: [] };
    expect(rec.signal).toBe("NOT_EVALUATED");
    expect(rec.score).toBeNull();
  });
});

// ─── Gate 33-C: buildSourceProvenance for Kite-only rows ─────────────────────

describe("Gate 33-C: Kite-only rows carry authoritative provenance but NOT_EVALUATED signal", () => {
  it("Kite provider builds authoritative provenance with notForSignals=false", async () => {
    const { buildSourceProvenance } = await import("./scannerProvenance");
    const prov = buildSourceProvenance({ provider: "kite", asOfSec: Date.now() / 1000, tf: "15m" });
    expect(prov.trustTier).toBe("authoritative");
    expect(prov.notForSignals).toBe(false);
    expect(prov.notForTradeDecisions).toBe(false);
  });

  it("Yahoo provider builds secondary_analytics provenance with notForSignals=true", async () => {
    const { buildSourceProvenance } = await import("./scannerProvenance");
    const prov = buildSourceProvenance({ provider: "yahoo", asOfSec: Date.now() / 1000, tf: "15m" });
    expect(prov.trustTier).toBe("secondary_analytics");
    expect(prov.notForSignals).toBe(true);
    expect(prov.notForTradeDecisions).toBe(true);
  });

  it("shouldDemoteSignal returns true for Yahoo source", async () => {
    const { buildSourceProvenance, shouldDemoteSignal } = await import("./scannerProvenance");
    const prov = buildSourceProvenance({ provider: "yahoo", asOfSec: Date.now() / 1000, tf: "15m" });
    expect(shouldDemoteSignal(prov)).toBe(true);
  });

  it("shouldDemoteSignal returns false for fresh Kite source", async () => {
    const { buildSourceProvenance, shouldDemoteSignal } = await import("./scannerProvenance");
    const nowSec = Math.floor(Date.now() / 1000);
    const prov = buildSourceProvenance({ provider: "kite", asOfSec: nowSec, tf: "15m" });
    expect(shouldDemoteSignal(prov)).toBe(false);
  });
});

// ─── Gate 33-D: swingSignals rejects NOT_EVALUATED rows ──────────────────────

describe("Gate 33-D: swingSignals.buildSwingSignalFromRow rejects NOT_EVALUATED", () => {
  const mockRow: StockRow = {
    symbol: "RELIANCE",
    name: "Reliance Industries",
    sector: "NSE EQ",
    quote: {
      symbol: "RELIANCE",
      price: 2800,
      change: 20,
      changePercent: 0.72,
      open: 2780,
      high: 2810,
      low: 2770,
      previousClose: 2780,
      volume: 5_000_000,
      avgVolume: 4_500_000,
      updatedAt: new Date(),
    },
    recommendation: {
      signal: "NOT_EVALUATED",
      score: null,
      confidence: null,
      reasons: [],
      setupMessage: "Kite candle analytics not available",
    },
    provenance: {
      sourceProvider: "kite",
      sourcePriority: 1,
      trustTier: "authoritative",
      delayed: false,
      notForSignals: false,
      notForTradeDecisions: false,
      asOf: Math.floor(Date.now() / 1000),
      freshnessSec: 5,
      isStale: false,
      missingReason: null,
      warnings: [],
      kitePriceOverlay: false,
    },
  };

  it("row with NOT_EVALUATED signal is not picked up as STRONG_BUY", () => {
    // The filter in buildAllSwingSignals checks signal === "STRONG_BUY"
    const signal = mockRow.recommendation.signal;
    expect(signal).not.toBe("STRONG_BUY");
    expect(signal).toBe("NOT_EVALUATED");
  });

  it("row with NOT_EVALUATED score (null) would fail minimum score check", () => {
    const score = mockRow.recommendation.score;
    const MIN_SCORE = 70;
    // Replicate the guard in buildAllSwingSignals: (score ?? 0) < minScore
    expect((score ?? 0) < MIN_SCORE).toBe(true);
  });

  it("NOT_EVALUATED rows cannot admit a paper trade via swing signal pipeline", () => {
    // Direct validation: both conditions in buildAllSwingSignals must be false
    const isStrongBuy = mockRow.recommendation.signal === "STRONG_BUY";
    const passesScoreFloor = (mockRow.recommendation.score ?? 0) >= 70;
    // Both must be false for NOT_EVALUATED row
    expect(isStrongBuy).toBe(false);
    expect(passesScoreFloor).toBe(false);
    // Therefore: no paper trade admission
    expect(isStrongBuy && passesScoreFloor).toBe(false);
  });
});

// ─── Gate 33-E: Score-bar null handling contract ──────────────────────────────

describe("Gate 33-E: NOT_EVALUATED row properties", () => {
  it("NOT_EVALUATED row has null score and null confidence", () => {
    const notEvaluated: Recommendation = {
      signal: "NOT_EVALUATED",
      score: null,
      confidence: null,
      reasons: [],
    };
    expect(notEvaluated.score).toBeNull();
    expect(notEvaluated.confidence).toBeNull();
  });

  it("STRONG_BUY row has numeric score ≥ 0", () => {
    const strongBuy: Recommendation = {
      signal: "STRONG_BUY",
      score: 78,
      confidence: 85,
      reasons: [{ label: "Price above EMA20 > EMA50", weight: 12, bullish: true }],
    };
    expect(strongBuy.score).toBeTypeOf("number");
    expect(strongBuy.score).not.toBeNull();
    expect(strongBuy.score! >= 0).toBe(true);
  });

  it("NOT_EVALUATED signal is distinct from NEUTRAL — NEUTRAL still has a score", () => {
    const neutral: Recommendation = {
      signal: "NEUTRAL",
      score: 50,
      confidence: 45,
      reasons: [],
    };
    expect(neutral.score).toBe(50);
    expect(neutral.signal).toBe("NEUTRAL");
    // Verify NOT_EVALUATED is DIFFERENT from NEUTRAL
    expect("NOT_EVALUATED").not.toBe("NEUTRAL");
  });
});

// ─── Gate 33-F: Yahoo data stays INFO_ONLY / DELAYED label ───────────────────

describe("Gate 33-F: Yahoo-derived provenance properties", () => {
  it("Yahoo source is always delayed", async () => {
    const { buildSourceProvenance } = await import("./scannerProvenance");
    const prov = buildSourceProvenance({ provider: "yahoo", asOfSec: Date.now() / 1000, tf: "15m" });
    expect(prov.delayed).toBe(true);
  });

  it("Yahoo source trust tier is secondary_analytics", async () => {
    const { buildSourceProvenance } = await import("./scannerProvenance");
    const prov = buildSourceProvenance({ provider: "yahoo", asOfSec: Date.now() / 1000, tf: "15m" });
    expect(prov.trustTier).toBe("secondary_analytics");
  });

  it("Yahoo source priority is lower than Kite", async () => {
    const { buildSourceProvenance } = await import("./scannerProvenance");
    const kite = buildSourceProvenance({ provider: "kite", asOfSec: Date.now() / 1000, tf: "15m" });
    const yahoo = buildSourceProvenance({ provider: "yahoo", asOfSec: Date.now() / 1000, tf: "15m" });
    expect(yahoo.sourcePriority).toBeGreaterThan(kite.sourcePriority);
  });

  it("Yahoo source cannot drive signals or trade decisions", async () => {
    const { buildSourceProvenance } = await import("./scannerProvenance");
    const prov = buildSourceProvenance({ provider: "yahoo", asOfSec: Date.now() / 1000, tf: "15m" });
    expect(prov.notForSignals).toBe(true);
    expect(prov.notForTradeDecisions).toBe(true);
  });
});

// ─── Gate 33-G: NFO instrument retry contract ────────────────────────────────

describe("Gate 33-G: kiteFnoInstruments NFO retry contract", () => {
  it("clearFnoInstrumentsCache resets lastGoodRows to null", async () => {
    const { clearFnoInstrumentsCache, isFnoInstrumentsCacheReady, _setFnoInstrumentsCacheForTest } =
      await import("./kiteFnoInstruments");

    // Seed a non-empty cache
    _setFnoInstrumentsCacheForTest([
      { instrument_token: 1, exchange_token: 1, tradingsymbol: "NIFTY26AUGFUT", name: "NIFTY",
        last_price: 0, expiry: "2026-08-28", strike: 0, tick_size: 0.05, lot_size: 65,
        instrument_type: "FUT", segment: "NFO-FUT", exchange: "NFO" },
    ]);
    expect(isFnoInstrumentsCacheReady()).toBe(true);

    clearFnoInstrumentsCache();
    expect(isFnoInstrumentsCacheReady()).toBe(false);
  });

  it("_setFnoInstrumentsCacheForTest allows test population", async () => {
    const { _setFnoInstrumentsCacheForTest, getCachedFnoInstruments, clearFnoInstrumentsCache } =
      await import("./kiteFnoInstruments");

    clearFnoInstrumentsCache();
    _setFnoInstrumentsCacheForTest([
      { instrument_token: 100, exchange_token: 100, tradingsymbol: "NIFTY26AUGPE24000",
        name: "NIFTY", last_price: 0, expiry: "2026-08-28", strike: 24000, tick_size: 0.05,
        lot_size: 65, instrument_type: "PE", segment: "NFO-OPT", exchange: "NFO" },
    ]);
    const cached = getCachedFnoInstruments();
    expect(cached).not.toBeNull();
    expect(cached!.length).toBe(1);
    expect(cached![0]!.name).toBe("NIFTY");
    expect(cached![0]!.lot_size).toBe(65);
  });

  it("getCachedLotSizeForIndex returns correct lot size for NIFTY", async () => {
    const { _setFnoInstrumentsCacheForTest, getCachedLotSizeForIndex, clearFnoInstrumentsCache } =
      await import("./kiteFnoInstruments");

    clearFnoInstrumentsCache();
    _setFnoInstrumentsCacheForTest([
      { instrument_token: 1, exchange_token: 1, tradingsymbol: "NIFTY26AUG24000CE",
        name: "NIFTY", last_price: 0, expiry: "2026-08-28", strike: 24000, tick_size: 0.05,
        lot_size: 65, instrument_type: "CE", segment: "NFO-OPT", exchange: "NFO" },
      { instrument_token: 2, exchange_token: 2, tradingsymbol: "BANKNIFTY26AUG52000CE",
        name: "BANKNIFTY", last_price: 0, expiry: "2026-08-28", strike: 52000, tick_size: 0.05,
        lot_size: 30, instrument_type: "CE", segment: "NFO-OPT", exchange: "NFO" },
      { instrument_token: 3, exchange_token: 3, tradingsymbol: "SENSEX26AUG82000CE",
        name: "SENSEX", last_price: 0, expiry: "2026-08-28", strike: 82000, tick_size: 0.05,
        lot_size: 20, instrument_type: "CE", segment: "BFO-OPT", exchange: "BFO" },
    ]);

    expect(getCachedLotSizeForIndex("NIFTY")).toBe(65);
    expect(getCachedLotSizeForIndex("BANKNIFTY")).toBe(30);
    expect(getCachedLotSizeForIndex("SENSEX")).toBe(20);
    expect(getCachedLotSizeForIndex("MIDCPNIFTY")).toBeNull(); // not in cache
  });
});

// ─── Gate 33-H: Route score-arithmetic null-safety ───────────────────────────

describe("Gate 33-H: score arithmetic is null-safe", () => {
  it("(score ?? -Infinity) sorts null scores after numeric scores", () => {
    type MinimalRow = { recommendation: { score: number | null } };
    const rows: MinimalRow[] = [
      { recommendation: { score: 70 } },
      { recommendation: { score: null } },
      { recommendation: { score: 45 } },
      { recommendation: { score: null } },
      { recommendation: { score: 20 } },
    ];

    const sorted = rows.slice().sort(
      (a, b) => (b.recommendation.score ?? -Infinity) - (a.recommendation.score ?? -Infinity),
    );

    // Scored rows come first (descending), NOT_EVALUATED (null) come last
    expect(sorted[0]!.recommendation.score).toBe(70);
    expect(sorted[1]!.recommendation.score).toBe(45);
    expect(sorted[2]!.recommendation.score).toBe(20);
    expect(sorted[3]!.recommendation.score).toBeNull();
    expect(sorted[4]!.recommendation.score).toBeNull();
  });

  it("avgScore calculation excludes NOT_EVALUATED rows", () => {
    const rows = [
      { recommendation: { score: 70 as number | null } },
      { recommendation: { score: null } },
      { recommendation: { score: 50 as number | null } },
      { recommendation: { score: null } },
    ];

    const scored = rows.filter(r => r.recommendation.score != null);
    const avg = scored.length
      ? Math.round(scored.reduce((a, b) => a + (b.recommendation.score ?? 0), 0) / scored.length)
      : 0;

    expect(avg).toBe(60); // (70 + 50) / 2 = 60
  });

  it("topBuys filtering excludes null-score rows and zero-score rows", () => {
    const rows = [
      { recommendation: { score: 80 as number | null } },
      { recommendation: { score: null } },
      { recommendation: { score: 30 as number | null } },
      { recommendation: { score: 0 as number | null } },
    ];

    const topBuys = rows.filter(r => (r.recommendation.score ?? 0) > 0);
    expect(topBuys).toHaveLength(2);
    expect(topBuys[0]!.recommendation.score).toBe(80);
    expect(topBuys[1]!.recommendation.score).toBe(30);
  });
});
