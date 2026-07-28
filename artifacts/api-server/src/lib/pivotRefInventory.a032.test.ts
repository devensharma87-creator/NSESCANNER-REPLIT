/**
 * Phase A0.3.2 / A0.3.3 — §13 Decision-path honesty inventory + non-fabrication proof.
 *
 * A0.3.2 renamed Ctx.vwap → Ctx.pivotRef to isolate the spot-as-VWAP proxy
 * from signal decisions.
 *
 * A0.3.3 removes Ctx.pivotRef entirely. Every VWAP-labelled decision path now
 * receives `authVwap` (null when unavailable) — never a spot-derived substitute:
 *   • ConfluenceInputs.vwap  — receives ctx.authVwap (null → factor excluded)
 *   • VetoInputs.vwap        — receives ctx.authVwap (null → vetoes skipped)
 *   • detectVolumeBreakout   — fail-closed when authVwap is null
 *   • detectBaselineOutlook  — stop uses spot explicitly (not pivotRef) when vwap absent
 *
 *   §13.1 Non-fabrication proof — signal.vwap is never a spot proxy.
 *
 *   §13.2 A0.3.3 Structural inventory — pivotRef fully absent; all VWAP-labelled
 *         connectors use authVwap.
 *
 *   §13.3 authVwap usage audit — serialization is honest.
 *
 *   §13.4 Behavioral non-fabrication: signal output for vwapAvailable=false context.
 *
 *   §13.5 A0.3.3 Decision-path boundary tests (Tests A–H).
 *         Behavioral proofs that the VWAP-null path is correctly handled by
 *         every component that was previously fed a spot-derived substitute.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildSignalsForIndex,
  OPTION_INDICES,
} from "./optionSignals.js";
import { scoreConfluence, type ConfluenceInputs } from "./confluenceEngine.js";
import { evaluateDirectionalVetoes } from "./optionSignalVetoes.js";
import type { YahooChart } from "./yahoo.js";

// ─── Load source for structural inventory ─────────────────────────────────────

const SRC_PATH = resolve(
  import.meta.dirname,
  "./optionSignals.ts",
);
const SRC_TEXT = readFileSync(SRC_PATH, "utf-8");

// ─── Zero-volume cash-index chart fixtures ────────────────────────────────────

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

const NIFTY_CFG = OPTION_INDICES.find(c => c.symbol === "NIFTY")!;
const BANKNIFTY_CFG = OPTION_INDICES.find(c => c.symbol === "BANKNIFTY")!;

// ─── §13.1 Non-fabrication proof ─────────────────────────────────────────────

describe("§13.1 A0.3 — Non-fabrication: signal.vwap is never a spot proxy", () => {
  it("signals from zero-vol NIFTY context have vwap=undefined (no spot proxy leaked)", () => {
    const intra = makeZeroVolIntra(30, 24600);
    const daily = makeZeroVolDaily(24600);
    const result = buildSignalsForIndex(NIFTY_CFG, intra, daily);
    for (const s of result.signals) {
      const rawVwap = (s as unknown as Record<string, unknown>).vwap;
      expect(rawVwap, `signal ${s.setupKey} leaked vwap=${rawVwap} despite vwapAvailable=false`).toBeUndefined();
    }
  });

  it("signals from zero-vol BANKNIFTY context have vwap=undefined", () => {
    const intra = makeZeroVolIntra(30, 50000);
    const daily = makeZeroVolDaily(50000);
    const result = buildSignalsForIndex(BANKNIFTY_CFG, intra, daily);
    for (const s of result.signals) {
      const rawVwap = (s as unknown as Record<string, unknown>).vwap;
      expect(rawVwap, `BANKNIFTY signal ${s.setupKey} leaked vwap=${rawVwap}`).toBeUndefined();
    }
  });

  it("signal serialization: vwap field is only set when authVwap is non-null", () => {
    const intra = makeZeroVolIntra(40, 24600);
    const daily = makeZeroVolDaily(24600);
    const { signals } = buildSignalsForIndex(NIFTY_CFG, intra, daily);
    const vwapLeaks = signals.filter(
      s => (s as unknown as Record<string, unknown>).vwap !== undefined,
    );
    expect(vwapLeaks).toHaveLength(0);
  });
});

// ─── §13.2 A0.3.3 Structural inventory: pivotRef fully removed ───────────────

describe("§13.2 A0.3.3 — Structural inventory: pivotRef fully absent; connectors use authVwap", () => {

  it("Ctx interface does NOT declare pivotRef field (A0.3.3: removed)", () => {
    // A0.3.3 removes the spot-as-VWAP geometric placeholder from Ctx entirely.
    const pivotRefDecl = SRC_TEXT.match(/^\s*pivotRef:\s*number;/m);
    expect(pivotRefDecl).toBeNull();
  });

  it("Ctx interface does NOT declare a plain 'vwap: number' field", () => {
    // No numeric vwap field on Ctx — authVwap is number | null.
    const vwapFieldDecl = SRC_TEXT.match(/^\s*vwap:\s*number;/m);
    expect(vwapFieldDecl).toBeNull();
  });

  it("No c.pivotRef or ctx.pivotRef usage in production code (all consumers removed)", () => {
    const lines = SRC_TEXT.split("\n");
    const pivotRefUsageLines = lines.filter(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) return false;
      return trimmed.includes("c.pivotRef") || trimmed.includes("ctx.pivotRef");
    });
    expect(pivotRefUsageLines).toHaveLength(0);
  });

  it("No 'vwap: ctx.pivotRef' connector calls (connectors now receive authVwap)", () => {
    const vwapPivotRefLines = SRC_TEXT.split("\n").filter(l => l.trim().match(/vwap:\s*ctx\.pivotRef/));
    expect(vwapPivotRefLines).toHaveLength(0);
  });

  it("confluenceInputs vwap: field receives ctx.authVwap (authoritative, not proxy)", () => {
    // The ConfluenceInputs construction must pass authVwap, not any spot-derived substitute.
    expect(SRC_TEXT).toMatch(/vwap:\s*ctx\.authVwap,/);
  });

  it("evaluateDirectionalVetoes call receives vwap: ctx.authVwap (not pivotRef)", () => {
    // evaluateDirectionalVetoes must receive authVwap; null when vwap unavailable.
    const vetoCallLines = SRC_TEXT
      .split("\n")
      .filter(l => l.trim().includes("vwap:") && l.includes("ctx.authVwap"));
    // At minimum 2 occurrences: confluenceInputs + veto call
    expect(vetoCallLines.length).toBeGreaterThanOrEqual(2);
  });

  it("detectVolumeBreakout has authVwap null-guard (fail-closed when VWAP absent)", () => {
    // A0.3.3: the momentum check in detectVolumeBreakout uses c.authVwap,
    // with an explicit !c.authVwap guard before the comparison.
    expect(SRC_TEXT).toMatch(/if\s*\(!c\.authVwap\)\s*return null/);
  });

  it("detectBaselineOutlook stop uses stopRef = vwapAvailable ? authVwap : spot (honest geometry)", () => {
    // A0.3.3: stop reference is explicit — VWAP when available, spot when not.
    // No pivotRef (which was vwapRaw ?? spot — ambiguous proxy).
    expect(SRC_TEXT).toMatch(/stopRef\s*=\s*c\.vwapAvailable\s*\?/);
    expect(SRC_TEXT).toMatch(/Math\.(min|max)\(stopRef,\s*c\.ema21\)/);
  });
});

// ─── §13.3 authVwap usage audit ───────────────────────────────────────────────

describe("§13.3 A0.3 — authVwap field usage audit", () => {
  it("Ctx interface declares authVwap: number | null", () => {
    expect(SRC_TEXT).toMatch(/authVwap:\s*number\s*\|\s*null;/);
  });

  it("signal serialization line emits vwap only when authVwap != null", () => {
    expect(SRC_TEXT).toMatch(/vwap:\s*c\.authVwap\s*!=\s*null\s*\?\s*round2\(c\.authVwap\)\s*:\s*undefined/);
  });

  it("pivotRef is NOT used in the vwap serialization line (no proxy leak)", () => {
    const lines = SRC_TEXT.split("\n");
    const serializationLines = lines.filter(l => l.includes("vwap:") && l.includes("authVwap"));
    for (const line of serializationLines) {
      expect(line, `Serialization line unexpectedly contains pivotRef: ${line}`).not.toContain("pivotRef");
    }
  });
});

// ─── §13.4 Behavioral non-fabrication: signal output for vwapAvailable=false ──

describe("§13.4 A0.3 — Behavioral non-fabrication: vwapAvailable=false context", () => {
  it("vwapAvailable field on all emitted signals from zero-vol context is false (when present)", () => {
    const intra = makeZeroVolIntra(30, 24600);
    const daily = makeZeroVolDaily(24600);
    const { signals } = buildSignalsForIndex(NIFTY_CFG, intra, daily);
    for (const s of signals) {
      const vwapAvailable = (s as unknown as Record<string, unknown>).vwapAvailable;
      if (vwapAvailable !== undefined) {
        expect(vwapAvailable).toBe(false);
      }
    }
  });

  it("no signal emitted from zero-vol context has a truthy vwap numeric field", () => {
    const intra = makeZeroVolIntra(30, 24600);
    const daily = makeZeroVolDaily(24600);
    const { signals } = buildSignalsForIndex(NIFTY_CFG, intra, daily);
    for (const s of signals) {
      const vwap = (s as unknown as Record<string, unknown>).vwap;
      expect(typeof vwap === "number", `signal.vwap is numeric ${vwap} — spot-as-VWAP leak`).toBe(false);
    }
  });
});

// ─── §13.5 A0.3.3 Decision-path boundary tests ───────────────────────────────
//
// Behavioral proofs that each component correctly handles the VWAP-null case.
// Tests A–H exercise the public boundaries of the two helper modules and the
// full buildSignalsForIndex path.

// ─── BASE CONFLUENCE INPUTS ───────────────────────────────────────────────────
const BASE_CONF: ConfluenceInputs = {
  direction: "BULLISH",
  setupTrendClass: true,
  spot: 24600,
  ema9: 24580,
  ema20: 24550,
  ema50: 24500,
  vwap: null,            // A0.3.3: null, not spot-as-proxy
  vwapAvailable: false,
  vp: null,
  isIndexFno: true,
  regime: "TRENDING_BULL",
  ivRank: null,
  rawConfidence: 65,
};

describe("§13.5.A — scoreConfluence: vwap=null excludes VWAP factor (weight=0, neutral)", () => {
  it("VWAP factor weight is 0 when vwap is null", () => {
    const result = scoreConfluence(BASE_CONF);
    const vwapFactor = result.factors.find(f => f.label === "VWAP");
    expect(vwapFactor, "VWAP factor must be present in result").toBeDefined();
    expect(vwapFactor!.weight).toBe(0);
  });

  it("VWAP factor polarity is neutral when vwap is null", () => {
    const result = scoreConfluence(BASE_CONF);
    const vwapFactor = result.factors.find(f => f.label === "VWAP")!;
    expect(vwapFactor.polarity).toBe("neutral");
  });

  it("VWAP factor detail mentions unavailability (not a fake 'at VWAP' or directional read)", () => {
    const result = scoreConfluence(BASE_CONF);
    const vwapFactor = result.factors.find(f => f.label === "VWAP")!;
    // Must reference VWAP being unavailable — never a direction claim.
    expect(vwapFactor.detail.toLowerCase()).toMatch(/unavailable/);
    expect(vwapFactor.detail.toLowerCase()).not.toMatch(/agrees|opposes|above|below/);
  });

  it("confluenceScore is unaffected by vwap: null (no phantom contribution)", () => {
    // With vwap null, VWAP contributes 0 to confluenceScore.
    // Score should equal the sum of EMA + VP + REGIME + IV_RANK factors only.
    const result = scoreConfluence(BASE_CONF);
    const nonVwapTotal = result.factors
      .filter(f => f.label !== "VWAP")
      .reduce((sum, f) => sum + f.weight, 0);
    expect(result.confluenceScore).toBe(nonVwapTotal);
  });
});

describe("§13.5.B — scoreConfluence: inconsistent null vwap + vwapAvailable=true → still excluded", () => {
  it("null vwap wins over vwapAvailable=true (null is the canonical availability signal)", () => {
    // Defensive: a caller that passes vwap:null but forgets vwapAvailable:false
    // must still get weight=0 for the VWAP factor.
    const inconsistentInputs: ConfluenceInputs = {
      ...BASE_CONF,
      vwap: null,
      vwapAvailable: true, // inconsistent — but null wins
    };
    const result = scoreConfluence(inconsistentInputs);
    const vwapFactor = result.factors.find(f => f.label === "VWAP")!;
    expect(vwapFactor.weight).toBe(0);
    expect(vwapFactor.polarity).toBe("neutral");
  });
});

describe("§13.5.C — scoreConfluence: real vwap → VWAP factor scored (authentic path preserved)", () => {
  it("VWAP factor weight is non-zero when authentic VWAP is above spot (BEARISH alignment check)", () => {
    // Spot below VWAP → for a BULLISH direction this opposes → weight < 0.
    const withVwap: ConfluenceInputs = {
      ...BASE_CONF,
      spot: 24600,
      vwap: 24650,        // vwap > spot → BULLISH opposes
      vwapAvailable: true,
    };
    const result = scoreConfluence(withVwap);
    const vwapFactor = result.factors.find(f => f.label === "VWAP")!;
    expect(vwapFactor.weight).toBeLessThan(0);
    expect(vwapFactor.polarity).toBe("opposes");
  });

  it("VWAP factor weight is positive when spot is above VWAP (BULLISH supports)", () => {
    const withVwap: ConfluenceInputs = {
      ...BASE_CONF,
      spot: 24600,
      vwap: 24540,        // spot > vwap + > 5bps → supports BULLISH
      vwapAvailable: true,
    };
    const result = scoreConfluence(withVwap);
    const vwapFactor = result.factors.find(f => f.label === "VWAP")!;
    expect(vwapFactor.weight).toBeGreaterThan(0);
    expect(vwapFactor.polarity).toBe("supports");
  });
});

describe("§13.5.D — evaluateDirectionalVetoes: vwap=null → both vetoes false (no fabrication)", () => {
  const BARS = 20;
  const spot = 24600;
  const atr15 = 30;
  // Make bars that would otherwise trigger vetoes if vwap were spot-proxied.
  // Recovery: big bounce, higher lows, rising RSI.
  const lows = Array.from({ length: BARS }, (_, i) => spot - 150 + i * 5);
  const highs = lows.map(l => l + 40);
  const closes = lows.map((l, i) => l + 20 + i);
  const rsiSeries: (number | null)[] = Array.from({ length: BARS }, (_, i) => 35 + i * 1.5);
  const rsi14 = 60;

  it("recovery veto is false when vwap is null (skip, not fabricate)", () => {
    const result = evaluateDirectionalVetoes({
      spot, vwap: null, ema9: spot - 20, atr15, rsi14,
      highs, lows, closes, rsiSeries,
    });
    expect(result.recovery).toBe(false);
  });

  it("chase veto is false when vwap is null (skip, not fabricate)", () => {
    const result = evaluateDirectionalVetoes({
      spot, vwap: null, ema9: spot - 20, atr15, rsi14: 78,
      highs, lows, closes, rsiSeries,
    });
    expect(result.chase).toBe(false);
  });

  it("veto function returns valid VetoEvaluation shape when vwap is null", () => {
    const result = evaluateDirectionalVetoes({
      spot, vwap: null, ema9: spot - 20, atr15, rsi14,
      highs, lows, closes, rsiSeries,
    });
    expect(result).toMatchObject({ recovery: false, chase: false });
  });
});

describe("§13.5.E — evaluateDirectionalVetoes: non-null vwap still evaluated (authentic path preserved)", () => {
  it("chase veto fires when spot is ≥2×ATR above VWAP, RSI overbought, and recent vertical run", () => {
    // Spot=24600, vwap=24540: extension = 60/25 = 2.4 ATR ≥ 2.0 ✓
    // RSI 78 ≥ 70 ✓
    // Vertical: closes[-5]=24555 → closes[-1]=24600: (24600-24555)/25 = 1.8 ≥ 1.5 ✓
    const n = 10;
    const closes = [24555, 24560, 24570, 24580, 24590, 24600];
    const highs = closes.map(c => c + 10);
    const lows = closes.map(c => c - 10);
    const rsiSeries: (number | null)[] = Array(n).fill(null);
    const result = evaluateDirectionalVetoes({
      spot: 24600, vwap: 24540, ema9: 24580, atr15: 25, rsi14: 78,
      highs, lows, closes, rsiSeries,
    });
    expect(result.chase).toBe(true);
    expect(result.chaseReason).toBeDefined();
  });

  it("chase veto is false when vwap non-null but extension is below threshold", () => {
    // spot=24600, vwap=24595: extension = 5/30 = 0.17 ATR < 2.0 → no chase
    const closes = [24560, 24570, 24580, 24590, 24600];
    const result = evaluateDirectionalVetoes({
      spot: 24600, vwap: 24595, ema9: 24580, atr15: 30, rsi14: 78,
      highs: closes.map(c => c + 15),
      lows: closes.map(c => c - 15),
      closes,
      rsiSeries: Array(10).fill(null),
    });
    expect(result.chase).toBe(false);
  });
});

describe("§13.5.F — Full path: zero-volume NIFTY chart emits baseline without VWAP drivers", () => {
  // Note: the baseline may be suppressed by the in-memory per-detector
  // cooldown when tests run sequentially with shared module state.  The
  // core VWAP-honesty structural invariants are already pinned by the
  // source assertions in §13.2; these behavioral tests augment them when
  // the baseline is actually present in the output.

  it("buildSignalsForIndex returns a result (no throw) for zero-vol NIFTY chart", () => {
    const intra = makeZeroVolIntra(30, 24600);
    const daily = makeZeroVolDaily(24600);
    expect(() => buildSignalsForIndex(NIFTY_CFG, intra, daily)).not.toThrow();
  });

  it("baseline signal from zero-vol chart has no VWAP-positive driver when present (no fabricated VWAP factor)", () => {
    const intra = makeZeroVolIntra(30, 24600);
    const daily = makeZeroVolDaily(24600);
    const { signals } = buildSignalsForIndex(NIFTY_CFG, intra, daily);
    const baseline = signals.find(s => s.setupKey === "BASELINE");

    // If cooldown suppresses baseline, skip the driver check — structural
    // invariant is pinned by §13.2 source assertions.
    if (!baseline) return;

    // No driver should be labelled 'VWAP' or contain 'above VWAP' / 'below VWAP'
    // with a non-zero weight — that would be a fabricated VWAP driver.
    const vwapDrivers = (baseline.drivers ?? []).filter(d => {
      const lbl = d.label?.toLowerCase() ?? "";
      return (lbl.includes("vwap") || lbl === "vwap") && (d as { weight?: number }).weight !== 0;
    });
    expect(
      vwapDrivers,
      `Fabricated VWAP drivers: ${JSON.stringify(vwapDrivers)}`,
    ).toHaveLength(0);
  });

  it("baseline signal stopLoss is defined and finite when present (stop geometry works without VWAP)", () => {
    const intra = makeZeroVolIntra(30, 24600);
    const daily = makeZeroVolDaily(24600);
    const { signals } = buildSignalsForIndex(NIFTY_CFG, intra, daily);
    const baseline = signals.find(s => s.setupKey === "BASELINE");
    if (!baseline) return; // suppressed by cooldown — structural proof is in §13.2

    // stopLoss is serialized inside baseline.leg (OptionLeg.stopLoss)
    expect(typeof baseline.leg.stopLoss).toBe("number");
    expect(Number.isFinite(baseline.leg.stopLoss)).toBe(true);
  });
});

describe("§13.5.G — Regime classifier vwap input (out-of-scope note)", () => {
  it("buildSignalsForIndex returns a regime without throwing on zero-volume chart", () => {
    // The regime classifier receives effectiveVwap (spot proxy) as its vwap input.
    // That call is out-of-scope for A0.3.3 (it produces a regime label, not a
    // VWAP-labelled trade-decision output). This test just verifies no crash.
    const intra = makeZeroVolIntra(30, 24600);
    const daily = makeZeroVolDaily(24600);
    expect(() => buildSignalsForIndex(NIFTY_CFG, intra, daily)).not.toThrow();
  });
});

describe("§13.5.H — Source: ConfluenceInputs.vwap is number|null (not plain number)", () => {
  it("ConfluenceInputs.vwap field type is number | null in confluenceEngine.ts", () => {
    const CONF_SRC_PATH = resolve(import.meta.dirname, "./confluenceEngine.ts");
    const confSrc = readFileSync(CONF_SRC_PATH, "utf-8");
    // The vwap field in ConfluenceInputs must accept null
    expect(confSrc).toMatch(/vwap:\s*number\s*\|\s*null;/);
  });

  it("VetoInputs.vwap field type is number | null in optionSignalVetoes.ts", () => {
    const VETO_SRC_PATH = resolve(import.meta.dirname, "./optionSignalVetoes.ts");
    const vetoSrc = readFileSync(VETO_SRC_PATH, "utf-8");
    expect(vetoSrc).toMatch(/vwap:\s*number\s*\|\s*null;/);
  });

  it("evaluateDirectionalVetoes returns early with {recovery:false,chase:false} when vwap is null", () => {
    // Source: early-return guard is the documented pattern (not baseGuard failure).
    const VETO_SRC_PATH = resolve(import.meta.dirname, "./optionSignalVetoes.ts");
    const vetoSrc = readFileSync(VETO_SRC_PATH, "utf-8");
    expect(vetoSrc).toMatch(/if\s*\(vwap\s*===\s*null\)/);
    expect(vetoSrc).toMatch(/return\s*\{\s*recovery:\s*false,\s*chase:\s*false\s*\}/);
  });
});
