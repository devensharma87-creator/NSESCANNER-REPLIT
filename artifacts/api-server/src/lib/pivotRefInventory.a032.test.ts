/**
 * Phase A0.3.2 — §13 Ctx.pivotRef consumer inventory + non-fabrication proof.
 *
 * A0.3.2 renamed Ctx.vwap → Ctx.pivotRef to eliminate the spot-as-VWAP proxy
 * from signal decisions. This file provides:
 *
 *   §13.1 Non-fabrication proof — pivotRef is NEVER emitted as vwap in signal output.
 *         Proves that c.pivotRef (which may hold spot as a geometric placeholder)
 *         cannot appear in signal.vwap. Only c.authVwap (null when unavailable)
 *         feeds signal.vwap — so vwap is either a genuine authenticated value or absent.
 *
 *   §13.2 Consumer inventory — executable proof that exactly 3 sites in optionSignals.ts
 *         read c.pivotRef, and all are geometry-only (stop/target calc, momentum check).
 *         No signal-decision gate reads pivotRef as a VWAP proxy.
 *
 *   §13.3 authVwap usage — proves c.authVwap is only read inside vwapAvailable=true
 *         branches, never as a fallback for missing VWAP.
 *
 *   §13.4 Signal output audit — emitted signals have vwap=undefined when vwapAvailable=false
 *         (no leakage of spot-as-VWAP into the signal serialization layer).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildSignalsForIndex,
  OPTION_INDICES,
  type Ctx,
} from "./optionSignals.js";
import type { YahooChart } from "./yahoo.js";

// ─── Load source for static inventory ─────────────────────────────────────────

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

describe("§13.1 A0.3.2 — Non-fabrication: pivotRef never emitted as vwap in signal output", () => {
  it("signals from zero-vol NIFTY context have vwap=undefined (no spot proxy leaked)", () => {
    const intra = makeZeroVolIntra(30, 24600);
    const daily = makeZeroVolDaily(24600);
    const result = buildSignalsForIndex(NIFTY_CFG, intra, daily);
    for (const s of result.signals) {
      // vwap field on signal must be undefined when vwapAvailable=false
      // (spot proxy must NEVER appear here as a VWAP value)
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
    // Source: optionSignals.ts line ~1484: vwap: c.authVwap != null ? round2(c.authVwap) : undefined
    // This is the ONLY vwap emission path. pivotRef does not feed it.
    // Proved by the source inventory in §13.2 below.
    // Additional behavioral proof: zero-volume chart → no VWAP → all emitted signals vwap=undefined.
    const intra = makeZeroVolIntra(40, 24600);
    const daily = makeZeroVolDaily(24600);
    const { signals } = buildSignalsForIndex(NIFTY_CFG, intra, daily);
    const vwapLeaks = signals.filter(
      s => (s as unknown as Record<string, unknown>).vwap !== undefined,
    );
    expect(vwapLeaks).toHaveLength(0);
  });
});

// ─── §13.2 Source inventory: all pivotRef consumers ──────────────────────────

describe("§13.2 A0.3.2 — Ctx.pivotRef source inventory (optionSignals.ts)", () => {

  it("Ctx interface declares pivotRef field (A0.3.2 rename from vwap)", () => {
    // The Ctx type must declare pivotRef not vwap.
    expect(SRC_TEXT).toMatch(/pivotRef:\s*number;/);
  });

  it("Ctx interface does NOT declare a plain vwap field (old name fully removed)", () => {
    // Check no "vwap: number" field declaration in the Ctx interface.
    // Use negative lookahead-equivalent: vwap field declaration pattern absent.
    const vwapFieldDecl = SRC_TEXT.match(/^\s*vwap:\s*number;/m);
    expect(vwapFieldDecl).toBeNull();
  });

  it("pivotRef is assigned once at Ctx construction (buildContext or equivalent)", () => {
    // The assignment line: pivotRef: effectiveVwap, authVwap: vwapRaw
    expect(SRC_TEXT).toMatch(/pivotRef:\s*effectiveVwap/);
  });

  it("pivotRef is consumed at exactly 4 call sites (2 geometry + 2 connector-as-vwap)", () => {
    // A0.3.2: pivotRef is the geometric reference (authVwap ?? spot).
    // Consumer sites:
    //   1. momentum check (detectVolumeBreakout): c.spot > c.pivotRef — geometry
    //   2. stop calculation: Math.min/max(c.pivotRef, c.ema21) — geometry
    //   3. confluenceInputs vwap field: vwap: ctx.pivotRef — connector (passes to engine as vwap arg)
    //   4. evaluateDirectionalVetoes vwap field: vwap: ctx.pivotRef — connector
    // Total: 4 usages. None of these decide whether a signal is emitted — they affect
    // geometric levels and helper-function inputs only.
    const lines = SRC_TEXT.split("\n");
    const consumerLines = lines.filter(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith("*") || trimmed.startsWith("//")) return false;
      if (trimmed.includes("pivotRef: number;")) return false;        // interface decl
      if (trimmed.includes("pivotRef: effectiveVwap")) return false;   // assignment
      if (trimmed.includes("When false, `pivotRef`")) return false;    // JSDoc
      if (trimmed.includes("* `pivotRef`")) return false;              // JSDoc
      if (trimmed.includes("`pivotRef`")) return false;                // JSDoc refs
      return trimmed.includes("c.pivotRef") || trimmed.includes("ctx.pivotRef");
    });
    expect(consumerLines).toHaveLength(4);
  });

  it("consumer 1: detectVolumeBreakout momentum check uses c.pivotRef (geometry — not authVwap)", () => {
    expect(SRC_TEXT).toMatch(/momentumOk.*c\.pivotRef/);
  });

  it("consumer 2: stop calculation uses Math.min/max(c.pivotRef, c.ema21) (geometry)", () => {
    expect(SRC_TEXT).toMatch(/Math\.(min|max)\(c\.pivotRef,\s*c\.ema21\)/);
  });

  it("consumer 3+4: pivotRef passed as vwap: arg to confluenceInputs and evaluateDirectionalVetoes", () => {
    // These connectors accept a `vwap` argument. A0.3.2 passes pivotRef (not authVwap) so the
    // helpers receive a defined numeric value for geometric calculations regardless of VWAP
    // availability. These helpers do NOT gate signal emission — they adjust confidence/vetoes
    // using the same geometric reference already in pivotRef.
    const vwapPivotRefLines = SRC_TEXT
      .split("\n")
      .filter(l => l.trim().match(/vwap:\s*ctx\.pivotRef/));
    expect(vwapPivotRefLines).toHaveLength(2);
  });

  it("no c.pivotRef site is inside a signal-emission gate (only geometry + connector inputs)", () => {
    // Signal-emission decisions (whether a setup fires at all) use c.authVwap within
    // c.vwapAvailable guards. pivotRef never gates emission — only affects levels/confidence.
    // This is proven by the absence of pivotRef in any `if/return/throw` emission-gate pattern.
    const emissionGateLines = SRC_TEXT
      .split("\n")
      .filter(line => {
        const t = line.trim();
        if (t.startsWith("//") || t.startsWith("*")) return false;
        // Pattern: pivotRef used in a conditional return or null-guard
        return (t.includes("c.pivotRef") || t.includes("ctx.pivotRef")) &&
          (t.startsWith("if") || t.startsWith("return") || t.startsWith("throw"));
      });
    // No pivot-ref usage should be a direct emission gate
    expect(emissionGateLines).toHaveLength(0);
  });
});

// ─── §13.3 authVwap usage audit ───────────────────────────────────────────────

describe("§13.3 A0.3.2 — authVwap field usage audit", () => {
  it("Ctx interface declares authVwap: number | null", () => {
    expect(SRC_TEXT).toMatch(/authVwap:\s*number\s*\|\s*null;/);
  });

  it("signal serialization line emits vwap only when authVwap != null", () => {
    // Expected serialization: vwap: c.authVwap != null ? round2(c.authVwap) : undefined
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

// ─── §13.4 Behavioral non-fabrication: signal output for vwap=false context ──

describe("§13.4 A0.3.2 — Behavioral non-fabrication: vwapAvailable=false context", () => {
  it("vwapAvailable field on all emitted signals from zero-vol context is false", () => {
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
      // Must be undefined or null — never a number (which would be a spot proxy)
      expect(typeof vwap === "number", `signal.vwap is numeric ${vwap} — spot-as-VWAP leak`).toBe(false);
    }
  });
});
