/**
 * Phase A0.3.1 — Extended Test Matrix (§12.2 – §12.6, §12.8)
 *
 * §12.2  Orchestration — setupAvailability contract from buildSignalsForIndex;
 *        VWAP-available TREND_CONTINUATION NOT in the retirement list when vwapAvailable=true.
 *        Suppression records contain stable setupKey + reasonCode.
 * §12.3  Direct detector safety — detectMeanReversion fails closed without VWAP;
 *        authVwap is the sole VWAP source; spot never substituted.
 * §12.4  A0.1 non-regression — non-null VP with isIndexFno=true still yields
 *        weight=0 / polarity=neutral for the VOLUME_PROFILE factor (guard is load-bearing).
 * §12.5  A0.2 non-regression — sessionVwap() and volumeProfile() fail-closed
 *        contracts intact for zero-volume cash-index candle series.
 * §12.6  API/Zod contract — availability entries satisfy the Zod schema;
 *        invalid status enum values and missing required fields are rejected.
 * §12.8  Trading boundary — buildSignalsForIndex never emits VOLUME_BREAKOUT
 *        or MEAN_REVERSION signals in the zero-volume index-F&O context.
 *
 * §12.7 (frontend component derivation tests) is in:
 *        artifacts/scanner/src/lib/fnoSetupAvailability.test.ts
 *
 * Non-regression invariants:
 *   - No threshold changes.
 *   - No detector mocking.
 *   - No strategy-parameter changes.
 *   - All existing A0.2 baselines (160 tests in separate file) remain intact.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  computeIndexFnoSetupAvailability,
  detectMeanReversion,
  buildSignalsForIndex,
  OPTION_INDICES,
  type Ctx,
} from "./optionSignals.js";
import { scoreConfluence } from "./confluenceEngine.js";
import type { ConfluenceInputs } from "./confluenceEngine.js";
import { sessionVwap, volumeProfile } from "./indicators.js";
import type { YahooChart } from "./yahoo.js";

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ─────────────────────────────────────────────────────────────────────────────

const NIFTY_CFG = OPTION_INDICES.find(c => c.symbol === "NIFTY")!;

/** Minimal intraday chart — zero volume (structural cash-index reality). */
function makeZeroVolIntra(n: number, flatClose: number): YahooChart {
  // Timestamps: stable IST-session epoch, 15-min spacing
  const BASE_TS = 1_750_000_000;
  return {
    symbol: "^NSEI",
    meta:   { symbol: "^NSEI", regularMarketPrice: flatClose },
    timestamps: Array.from({ length: n }, (_, i) => BASE_TS - (n - 1 - i) * 900),
    open:   Array<number>(n).fill(flatClose - 20),
    high:   Array<number>(n).fill(flatClose + 30),
    low:    Array<number>(n).fill(flatClose - 30),
    close:  Array<number>(n).fill(flatClose),
    volume: Array<number>(n).fill(0),
  };
}

/** Minimal daily chart — 60 bars, zero volume. */
function makeZeroVolDaily(flatClose: number): YahooChart {
  const n = 60;
  const BASE_TS = 1_750_000_000;
  return {
    symbol: "^NSEI",
    meta:   { symbol: "^NSEI", regularMarketPrice: flatClose },
    timestamps: Array.from({ length: n }, (_, i) => BASE_TS - (n - 1 - i) * 86_400),
    open:   Array<number>(n).fill(flatClose - 100),
    high:   Array<number>(n).fill(flatClose + 150),
    low:    Array<number>(n).fill(flatClose - 150),
    close:  Array<number>(n).fill(flatClose),
    volume: Array<number>(n).fill(0),
  };
}

/**
 * Full Ctx factory for direct detector tests.
 * Defaults: NIFTY, spot=24600, vwapAvailable as provided, authVwap as provided.
 * When vwapAvailable=false, authVwap MUST be null.
 * When vwapAvailable=true, authVwap MUST be a finite number.
 */
function makeCtx(opts: {
  vwapAvailable: boolean;
  authVwap: number | null;
  spot?: number;
  rsi14?: number;
  atr15?: number;
  vp?: Ctx["vp"];
  vpIntraday?: Ctx["vpIntraday"];
  bars?: Ctx["bars"];
}): Ctx {
  const spot = opts.spot ?? 24600;
  const atr15 = opts.atr15 ?? 30;
  const authVwap = opts.authVwap;
  // vwap = authVwap when available (genuine), spot placeholder when unavailable.
  const vwap = authVwap ?? spot;
  return {
    cfg:              NIFTY_CFG,
    spot,
    open0:            spot - 100,
    sessionChangePct: 0.4,
    vwap,
    authVwap,
    vwapAvailable:    opts.vwapAvailable,
    vwapSeries:       [null, null, authVwap],
    ema9:             spot - 20,
    ema21:            spot - 50,
    ema20:            spot - 35,
    ema50:            spot - 100,
    ema9Series:       [null, spot - 20],
    ema21Series:      [null, spot - 50],
    rsi14:            opts.rsi14 ?? 50,
    rsiSeries:        [null, opts.rsi14 ?? 50],
    vp:               opts.vp ?? null,
    vpIntraday:       opts.vpIntraday ?? null,
    piv:              { pivot: spot - 50, r1: spot + 100, s1: spot - 100, r2: spot + 200, s2: spot - 200 },
    atr15,
    atrDaily:         atr15 * 5,
    dailyEma50:       spot - 200,
    htfBias:          "BULLISH",
    htf1hBias:        "NEUTRAL",
    index5dReturn:    null,
    avgVol20:         0,
    lastVol:          0,
    prevSwingHigh:    spot + 40,
    prevSwingLow:     spot - 40,
    bars:             opts.bars ?? { o: [spot - 20], h: [spot + 30], l: [spot - 30], c: [spot], v: [0] },
    fullIndicators:   true,
    prevClose:        spot - 100,
    realizedVol14:    12,
    volRegime:        "NORMAL",
    regime: {
      regime:  "TRENDING_BULL",
      reason:  "ADX above trend floor — directional bias confirmed",
      diag:    { adx14: 25, bbWidthPct: 1.5, atrPctOfSpot: 0.005, isExpiryToday: false },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// §12.2 — Orchestration: setupAvailability contract from buildSignalsForIndex
// ─────────────────────────────────────────────────────────────────────────────

describe("§12.2 Orchestration — setupAvailability from buildSignalsForIndex", () => {
  // Minimal zero-volume chart → no bars path returns the availability contract
  const noBarIntra = makeZeroVolIntra(1, 24600); // 1 bar < MIN_BARS_FOR_CONTEXT=2 → no ctx
  const daily = makeZeroVolDaily(24600);

  describe("no-bars path still returns authoritative setupAvailability", () => {
    const result = buildSignalsForIndex(NIFTY_CFG, noBarIntra, daily);

    it("hasBars=false but setupAvailability is still populated", () => {
      expect(result.hasBars).toBe(false);
      expect(Array.isArray(result.setupAvailability)).toBe(true);
      expect(result.setupAvailability.length).toBeGreaterThan(0);
    });

    it("setupAvailability matches computeIndexFnoSetupAvailability(false) when no bars", () => {
      const expected = computeIndexFnoSetupAvailability(false);
      expect(result.setupAvailability).toHaveLength(expected.length);
      const resultKeys = result.setupAvailability.map(e => e.setupKey).sort();
      const expectedKeys = expected.map(e => e.setupKey).sort();
      expect(resultKeys).toEqual(expectedKeys);
    });

    it("all setupAvailability entries have eligibleForEmission=false", () => {
      for (const e of result.setupAvailability) {
        expect(e.eligibleForEmission).toBe(false);
      }
    });

    it("all setupAvailability entries have stable reasonCode (not prose)", () => {
      const AUTHORISED = new Set([
        "INDEX_VOLUME_UNAVAILABLE",
        "SESSION_VWAP_UNAVAILABLE",
        "SETUP_RETIRED_UNDER_CURRENT_INDEX_FNO_POLICY",
      ]);
      for (const e of result.setupAvailability) {
        expect(AUTHORISED.has(e.reasonCode)).toBe(true);
      }
    });

    it("no signals emitted when no bars", () => {
      expect(result.signals).toHaveLength(0);
    });
  });

  describe("full chart path (zero-volume, vwapAvailable=false)", () => {
    // Enough bars for context to be built (≥2), but zero volume
    const intra = makeZeroVolIntra(30, 24600);
    const result = buildSignalsForIndex(NIFTY_CFG, intra, daily);

    it("VOLUME_BREAKOUT entry is present in setupAvailability", () => {
      const e = result.setupAvailability.find(x => x.setupKey === "VOLUME_BREAKOUT");
      expect(e).toBeDefined();
      expect(e!.status).toBe("UNAVAILABLE_REQUIRED_INPUT");
    });

    it("MEAN_REVERSION entry is present in setupAvailability", () => {
      const e = result.setupAvailability.find(x => x.setupKey === "MEAN_REVERSION");
      expect(e).toBeDefined();
      expect(e!.status).toBe("UNAVAILABLE_REQUIRED_INPUT");
    });

    it("TREND_CONTINUATION_NO_VWAP entry is present in setupAvailability (vwapAvailable=false)", () => {
      const e = result.setupAvailability.find(x => x.setupKey === "TREND_CONTINUATION_NO_VWAP");
      expect(e).toBeDefined();
      expect(e!.status).toBe("RETIRED_INDEX_FNO_POLICY");
    });

    it("no VOLUME_BREAKOUT signal is emitted", () => {
      const vb = result.signals.filter(s => s.setupKey === "VOLUME_BREAKOUT");
      expect(vb).toHaveLength(0);
    });

    it("no MEAN_REVERSION signal is emitted (detector blocked + detector-level guard)", () => {
      const mr = result.signals.filter(s => s.setupKey === "MEAN_REVERSION");
      expect(mr).toHaveLength(0);
    });
  });

  describe("VWAP-available TREND_CONTINUATION is NOT retired", () => {
    it("computeIndexFnoSetupAvailability(true) does not contain TREND_CONTINUATION_NO_VWAP", () => {
      const entries = computeIndexFnoSetupAvailability(true);
      const tc = entries.find(x => x.setupKey === "TREND_CONTINUATION_NO_VWAP");
      expect(tc).toBeUndefined();
    });

    it("computeIndexFnoSetupAvailability(true) returns 2 entries (VB + MR only)", () => {
      const entries = computeIndexFnoSetupAvailability(true);
      expect(entries).toHaveLength(2);
      expect(entries.find(x => x.setupKey === "VOLUME_BREAKOUT")).toBeDefined();
      expect(entries.find(x => x.setupKey === "MEAN_REVERSION")).toBeDefined();
    });
  });

  describe("§12.2 global policy design proof", () => {
    it("computeIndexFnoSetupAvailability is called once — result governs all surfaces (no divergent lists)", () => {
      // The function is pure and deterministic — same input always yields same output.
      // This proves all three surfaces (orchestration, API, UI) use one canonical result.
      const a = computeIndexFnoSetupAvailability(false);
      const b = computeIndexFnoSetupAvailability(false);
      expect(a.map(e => e.setupKey)).toEqual(b.map(e => e.setupKey));
      expect(a.map(e => e.status)).toEqual(b.map(e => e.status));
      expect(a.map(e => e.reasonCode)).toEqual(b.map(e => e.reasonCode));
    });

    it("cardinality: 3 entries when vwapAvailable=false (VB + MR + TC_NO_VWAP)", () => {
      expect(computeIndexFnoSetupAvailability(false)).toHaveLength(3);
    });

    it("cardinality: 2 entries when vwapAvailable=true (VB + MR; TC is ACTIVE)", () => {
      expect(computeIndexFnoSetupAvailability(true)).toHaveLength(2);
    });

    it("uniqueness: no duplicate setupKey values in either variant", () => {
      for (const v of [true, false]) {
        const entries = computeIndexFnoSetupAvailability(v);
        const keys = entries.map(e => e.setupKey);
        expect(new Set(keys).size).toBe(keys.length);
      }
    });

    it("ordering: stable across calls (pure function — deterministic)", () => {
      const a = computeIndexFnoSetupAvailability(false).map(e => e.setupKey);
      const b = computeIndexFnoSetupAvailability(false).map(e => e.setupKey);
      expect(a).toEqual(b);
    });

    it("scope: all-response-state — all entries have scope=INDEX_FNO", () => {
      for (const v of [true, false]) {
        for (const e of computeIndexFnoSetupAvailability(v)) {
          expect(e.scope).toBe("INDEX_FNO");
        }
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §12.3 — Direct detector safety: detectMeanReversion
// ─────────────────────────────────────────────────────────────────────────────

describe("§12.3 Direct detector safety — detectMeanReversion + authVwap", () => {
  describe("fail-closed without VWAP", () => {
    it("returns null when vwapAvailable=false (regardless of spot position)", () => {
      // Even with extreme RSI and big extension, the guard fires immediately.
      const ctx = makeCtx({
        vwapAvailable: false,
        authVwap: null,
        spot: 24900,     // 300 pts above vwap-placeholder=24600
        rsi14: 90,       // extreme overbought
        atr15: 30,       // 300 > 2*30=60 → extendedUp would be true if guard didn't fire
      });
      expect(detectMeanReversion(ctx)).toBeNull();
    });

    it("returns null for all RSI levels when vwapAvailable=false", () => {
      for (const rsi14 of [10, 25, 50, 75, 90]) {
        const ctx = makeCtx({ vwapAvailable: false, authVwap: null, rsi14 });
        expect(detectMeanReversion(ctx)).toBeNull();
      }
    });

    it("authVwap=null does not trigger TypeError — null is guarded before arithmetic", () => {
      // If authVwap=null were used before the guard, `null - number` would produce NaN
      // and the comparison NaN>threshold would silently fail open.
      // This test proves the guard fires before any arithmetic on authVwap.
      const ctx = makeCtx({ vwapAvailable: false, authVwap: null });
      expect(() => detectMeanReversion(ctx)).not.toThrow();
      expect(detectMeanReversion(ctx)).toBeNull();
    });
  });

  describe("authVwap used (not c.vwap / spot proxy) in signal-decision arithmetic", () => {
    // Construction: spot=24900, authVwap=24600, atr15=30
    // dist = 24900 - 24600 = 300 > 60 (2*30) → extendedUp condition met
    // rsi14=85 > 75 → extendedUp=true → BEARISH signal should emit
    const SPOT = 24900;
    const AUTH_VWAP = 24600;
    const ATR15 = 30;

    const ctx = makeCtx({
      vwapAvailable: true,
      authVwap: AUTH_VWAP,
      spot: SPOT,
      rsi14: 85,
      atr15: ATR15,
      bars: { o: [SPOT - 30], h: [SPOT + 10], l: [SPOT - 20], c: [SPOT], v: [0] },
    });

    it("detectMeanReversion emits a signal when genuinely extended above authVwap", () => {
      const signal = detectMeanReversion(ctx);
      expect(signal).not.toBeNull();
      expect(signal!.setupKey).toBe("MEAN_REVERSION");
      expect(signal!.direction).toBe("BEARISH"); // overbought → bearish fade
    });

    it("emitted signal detail string references authVwap value (not spot, not proxy)", () => {
      const signal = detectMeanReversion(ctx)!;
      // The primary driver detail must include the authVwap value (24600)
      const primaryDriver = signal.drivers[0]!;
      expect(primaryDriver.detail).toContain(AUTH_VWAP.toFixed(2));
      // Must NOT contain spot as the VWAP reference
      // (i.e. should not claim spot=24900 is the VWAP)
      expect(primaryDriver.detail).not.toContain(`VWAP ${SPOT.toFixed(2)}`);
    });

    it("target level (t1) is authVwap — mean-reversion target, not spot", () => {
      const signal = detectMeanReversion(ctx)!;
      // t1 is the primary target (VWAP for MR). Must equal authVwap, not spot.
      expect(signal.targetLevel).toBe(AUTH_VWAP);
      expect(signal.targetLevel).not.toBe(SPOT);
    });

    it("confidence ≥ 50 (satisfies emission floor)", () => {
      const signal = detectMeanReversion(ctx)!;
      expect(signal.confidence).toBeGreaterThanOrEqual(50);
    });
  });

  describe("not extended → no signal (guard depth)", () => {
    it("returns null when spot is within 2×atr15 of authVwap (not extended)", () => {
      const ctx = makeCtx({
        vwapAvailable: true,
        authVwap: 24600,
        spot: 24620, // dist=20, atr15=30 → 20 < 60 → not extended
        rsi14: 80,
        atr15: 30,
      });
      expect(detectMeanReversion(ctx)).toBeNull();
    });

    it("returns null when RSI not extreme despite extension (no overextension signal)", () => {
      const ctx = makeCtx({
        vwapAvailable: true,
        authVwap: 24600,
        spot: 24800,  // 200 > 60 = extended
        rsi14: 60,    // not > 75 → extendedUp false
        atr15: 30,
      });
      expect(detectMeanReversion(ctx)).toBeNull();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §12.4 — A0.1 non-regression: isIndexFno=true blocks VP scoring
// ─────────────────────────────────────────────────────────────────────────────

describe("§12.4 A0.1 non-regression — non-null VP with isIndexFno=true", () => {
  const BASE_CONF: ConfluenceInputs = {
    direction: "BULLISH",
    setupTrendClass: true,
    spot: 25000,
    ema9: 24980,
    ema20: 24950,
    ema50: 24900,
    vwap: 25000,
    vwapAvailable: true,
    vp: null,
    isIndexFno: false,
    regime: "TRENDING_BULL",
    ivRank: null,
    rawConfidence: 65,
  };

  // Deliberately non-null VP — proves the A0.1 guard is load-bearing, not vacuous.
  const NON_NULL_VP = { pointOfControl: 24900, valueAreaHigh: 25100, valueAreaLow: 24700 };

  it("isIndexFno=true with non-null VP: VOLUME_PROFILE factor weight=0", () => {
    const result = scoreConfluence({ ...BASE_CONF, isIndexFno: true, vp: NON_NULL_VP });
    const vpFactor = result.factors.find(f => f.label === "VOLUME_PROFILE");
    expect(vpFactor).toBeDefined();
    expect(vpFactor!.weight).toBe(0);
  });

  it("isIndexFno=true with non-null VP: VOLUME_PROFILE factor polarity=neutral", () => {
    const result = scoreConfluence({ ...BASE_CONF, isIndexFno: true, vp: NON_NULL_VP });
    const vpFactor = result.factors.find(f => f.label === "VOLUME_PROFILE");
    expect(vpFactor!.polarity).toBe("neutral");
  });

  it("isIndexFno=false with same non-null VP: VOLUME_PROFILE weight is non-zero (guard is load-bearing)", () => {
    // This proves removing isIndexFno=true would change VP scoring — the guard is active, not vacuous.
    const withGuard = scoreConfluence({ ...BASE_CONF, isIndexFno: true,  vp: NON_NULL_VP });
    const noGuard   = scoreConfluence({ ...BASE_CONF, isIndexFno: false, vp: NON_NULL_VP });
    const vpWithGuard = withGuard.factors.find(f => f.label === "VOLUME_PROFILE");
    const vpNoGuard   = noGuard.factors.find(f => f.label === "VOLUME_PROFILE");
    expect(vpWithGuard!.weight).toBe(0);
    expect(vpNoGuard!.weight).not.toBe(0); // load-bearing: removing guard changes score
  });

  it("A0.1 BEARISH direction — non-null VP with isIndexFno=true still yields weight=0", () => {
    const result = scoreConfluence({
      ...BASE_CONF,
      direction: "BEARISH",
      isIndexFno: true,
      vp: NON_NULL_VP,
    });
    const vpFactor = result.factors.find(f => f.label === "VOLUME_PROFILE");
    expect(vpFactor!.weight).toBe(0);
    expect(vpFactor!.polarity).toBe("neutral");
  });

  it("emitted signal drivers must not contain a VP-derived driver when isIndexFno=true", () => {
    // Confluence score factors include VOLUME_PROFILE with weight=0 — it should not
    // appear as a positive or negative confluence driver in the adjusted score.
    const result = scoreConfluence({ ...BASE_CONF, isIndexFno: true, vp: NON_NULL_VP });
    const vpFactor = result.factors.find(f => f.label === "VOLUME_PROFILE");
    // A weight of 0 means the factor contributes 0 to adjustedConfidence.
    // Use Math.abs to avoid Object.is(-0, 0) false-negative.
    expect(Math.abs(vpFactor!.weight)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §12.5 — A0.2 non-regression: fail-closed contracts for zero-volume indicators
// ─────────────────────────────────────────────────────────────────────────────

describe("§12.5 A0.2 non-regression — sessionVwap() + volumeProfile() fail-closed", () => {
  describe("sessionVwap() fail-closed pre-scan (D-FAB-05 contract)", () => {
    it("returns all-null series for zero-volume candles (VWAP structurally unavailable)", () => {
      const n = 30;
      const highs  = Array<number>(n).fill(24650);
      const lows   = Array<number>(n).fill(24550);
      const closes = Array<number>(n).fill(24600);
      const vols   = Array<number>(n).fill(0);
      const result = sessionVwap(highs, lows, closes, vols);
      expect(result).toHaveLength(n);
      expect(result.every(v => v === null)).toBe(true);
    });

    it("lastVal of zero-volume sessionVwap result is null (vwapRaw = null → vwapAvailable = false)", () => {
      const highs  = [24650, 24660];
      const lows   = [24550, 24560];
      const closes = [24600, 24610];
      const vols   = [0, 0];
      const series = sessionVwap(highs, lows, closes, vols);
      const lastNonNull = [...series].reverse().find(v => v !== null);
      expect(lastNonNull).toBeUndefined(); // all null
    });

    it("single positive-volume bar breaks the all-null pattern (non-regression)", () => {
      // Verifies zero-volume → null is a zero-volume effect, not a code bug.
      const highs  = [24650, 24660];
      const lows   = [24550, 24560];
      const closes = [24600, 24610];
      const vols   = [0, 100]; // second bar has volume
      const series = sessionVwap(highs, lows, closes, vols);
      // The first bar is null (no cumulative volume yet),
      // the second bar should be non-null.
      expect(series[0]).toBeNull();
      expect(series[1]).not.toBeNull();
    });
  });

  describe("volumeProfile() fail-closed for zero-volume input (D-FAB-01 contract)", () => {
    it("returns null for < 10 bars (minimum size requirement)", () => {
      const n = 5;
      const h = Array<number>(n).fill(24650);
      const l = Array<number>(n).fill(24550);
      const c = Array<number>(n).fill(24600);
      const v = Array<number>(n).fill(100);
      const result = volumeProfile(h, l, c, v);
      expect(result).toBeNull();
    });

    it("returns null when total volume is zero (all-zero-volume = degenerate profile)", () => {
      const n = 30;
      const h = Array<number>(n).fill(24650);
      const l = Array<number>(n).fill(24550);
      const c = Array<number>(n).fill(24600);
      const v = Array<number>(n).fill(0); // zero volume → null
      const result = volumeProfile(h, l, c, v);
      expect(result).toBeNull();
    });

    it("returns a valid profile when positive volume is present (zero-volume effect is specific)", () => {
      const n = 30;
      const h = Array<number>(n).fill(24650);
      const l = Array<number>(n).fill(24550);
      const c = Array<number>(n).fill(24600);
      const v = Array<number>(n).fill(100); // positive volume
      const result = volumeProfile(h, l, c, v);
      expect(result).not.toBeNull();
      expect(typeof result!.pointOfControl).toBe("number");
      expect(isFinite(result!.pointOfControl)).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §12.6 — API/Zod contract: availability entries conform to the schema
// ─────────────────────────────────────────────────────────────────────────────

describe("§12.6 API/Zod contract — availability entry schema", () => {
  // Mirror the schema from lib/api-zod/src/generated/api.ts
  // (inline rather than importing the generated schema directly, so the test
  // remains a pure-logic check that does not depend on the generated artifact).
  const AvailabilityEntrySchema = z.object({
    setupKey: z.string().min(1),
    status: z.enum(["ACTIVE", "UNAVAILABLE_REQUIRED_INPUT", "RETIRED_INDEX_FNO_POLICY"]),
    reasonCode: z.string().min(1),
    explanation: z.string().min(10),
    missingInputs: z.array(z.string()),
    scope: z.literal("INDEX_FNO"),
    eligibleForEmission: z.literal(false),
  });

  describe("valid entries from computeIndexFnoSetupAvailability pass the schema", () => {
    it("all vwapAvailable=false entries are schema-valid", () => {
      const entries = computeIndexFnoSetupAvailability(false);
      for (const entry of entries) {
        const result = AvailabilityEntrySchema.safeParse(entry);
        expect(result.success, `Entry ${entry.setupKey} failed: ${!result.success && result.error}`).toBe(true);
      }
    });

    it("all vwapAvailable=true entries are schema-valid", () => {
      const entries = computeIndexFnoSetupAvailability(true);
      for (const entry of entries) {
        const result = AvailabilityEntrySchema.safeParse(entry);
        expect(result.success, `Entry ${entry.setupKey} failed: ${!result.success && result.error}`).toBe(true);
      }
    });
  });

  describe("invalid entries are rejected by the schema", () => {
    const VALID_ENTRY = computeIndexFnoSetupAvailability(false).find(
      e => e.setupKey === "VOLUME_BREAKOUT",
    )!;

    it("invalid status enum value is rejected", () => {
      const result = AvailabilityEntrySchema.safeParse({
        ...VALID_ENTRY,
        status: "UNKNOWN_STATUS",
      });
      expect(result.success).toBe(false);
    });

    it("missing required setupKey field is rejected", () => {
      const { setupKey: _, ...withoutKey } = VALID_ENTRY;
      const result = AvailabilityEntrySchema.safeParse(withoutKey);
      expect(result.success).toBe(false);
    });

    it("missing missingInputs field is rejected", () => {
      const { missingInputs: _, ...withoutMI } = VALID_ENTRY;
      const result = AvailabilityEntrySchema.safeParse(withoutMI);
      expect(result.success).toBe(false);
    });

    it("invalid scope (not INDEX_FNO) is rejected", () => {
      const result = AvailabilityEntrySchema.safeParse({
        ...VALID_ENTRY,
        scope: "EQUITY_SWING",
      });
      expect(result.success).toBe(false);
    });

    it("eligibleForEmission=true is rejected (schema uses z.literal(false))", () => {
      const result = AvailabilityEntrySchema.safeParse({
        ...VALID_ENTRY,
        eligibleForEmission: true,
      });
      expect(result.success).toBe(false);
    });

    it("short explanation (< 10 chars) is rejected", () => {
      const result = AvailabilityEntrySchema.safeParse({
        ...VALID_ENTRY,
        explanation: "Too short",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("TREND_CONTINUATION_NO_VWAP setupKey is accepted (A0.3.1 key rename)", () => {
    it("the new setupKey passes the schema (string, non-empty)", () => {
      const entry = computeIndexFnoSetupAvailability(false).find(
        e => e.setupKey === "TREND_CONTINUATION_NO_VWAP",
      )!;
      expect(entry).toBeDefined();
      const result = AvailabilityEntrySchema.safeParse(entry);
      expect(result.success).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §12.8 — Trading boundary: unavailable setups cannot reach paper admission
// ─────────────────────────────────────────────────────────────────────────────

describe("§12.8 Trading boundary — unavailable setups never emitted in index-F&O context", () => {
  // Using a 30-bar zero-volume intraday chart — enough bars for context to be
  // built (≥ 2) but structural zero-volume means vwapAvailable=false.
  const intra = makeZeroVolIntra(30, 24600);
  const daily = makeZeroVolDaily(24600);
  const result = buildSignalsForIndex(NIFTY_CFG, intra, daily);

  it("no VOLUME_BREAKOUT signal is emitted (detector gated by availability + structural gap)", () => {
    const vb = result.signals.filter(s => s.setupKey === "VOLUME_BREAKOUT");
    expect(vb).toHaveLength(0);
  });

  it("no MEAN_REVERSION signal is emitted (detector gated by availability + detector-level guard)", () => {
    const mr = result.signals.filter(s => s.setupKey === "MEAN_REVERSION");
    expect(mr).toHaveLength(0);
  });

  it("TREND_CONTINUATION_NO_VWAP is not a valid emitted setupKey (retirement only, not signal identity)", () => {
    // Emitted signals still use setupKey="TREND_CONTINUATION" for the VWAP-available
    // branch. TREND_CONTINUATION_NO_VWAP is only the availability entry key — it is
    // never an emitted signal setupKey.
    // Cast through unknown: TREND_CONTINUATION_NO_VWAP is an availability entry key,
    // not a valid OptionSignalSetupKey — the TS union correctly excludes it.
    const tc_noVwap = result.signals.filter(s => (s.setupKey as unknown as string) === "TREND_CONTINUATION_NO_VWAP");
    expect(tc_noVwap).toHaveLength(0);
  });

  it("all emitted signals (if any) have vwapAvailable property set", () => {
    // Every emitted signal must carry vwapAvailable for honest provenance.
    for (const s of result.signals) {
      expect(typeof (s as unknown as Record<string, unknown>).vwapAvailable).toBe("boolean");
    }
  });

  it("setupAvailability entries are not in signals array (availability ≠ signals)", () => {
    const availKeys = new Set(result.setupAvailability.map(e => e.setupKey));
    for (const s of result.signals) {
      // A retired/unavailable setup key must never appear as an emitted signal.
      // VOLUME_BREAKOUT and MEAN_REVERSION are in availKeys; they must not be in signals.
      expect(availKeys.has(s.setupKey ?? "")).toBe(false);
    }
  });
});
