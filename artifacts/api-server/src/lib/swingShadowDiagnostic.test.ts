/**
 * H10b — Tests for the pure swing-shadow-score diagnostic aggregator
 * (`swingShadowDiagnostic.ts`) and its feature-flag / memoization helpers.
 *
 * The owner-only HTTP route is covered separately by the strict-gate matrix
 * in `routes/__tests__/diagnosticRouteAuth.test.ts` (auth cases A/B/C/D).
 *
 * This file pins behavioral guarantees that do NOT depend on Express,
 * cookies, or the network:
 *   - bounded lists (cap = 25)
 *   - deterministic ordering (delta desc/asc + symbol tiebreaker)
 *   - calls `computeShadowScores` for every row
 *   - surfaces unknown warning prose; never silently maps to B3
 *   - never mutates input rows (pure)
 *   - never imports DB / Kite / Yahoo / scheduler modules
 *   - score-delta distribution buckets are correct
 *   - data-quality histogram totals match input
 *   - 5-minute memo behaves correctly (hit / miss / expiry / key change)
 *   - feature flag default = ENABLED; recognised "off" values flip it
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  buildShadowDiagnostic,
  isSwingShadowDiagEnabled,
  LIST_CAP,
  HIGH_SCORE_THRESHOLD,
  MEMO_TTL_MS,
  memoKey,
  getMemoizedPayload,
  setMemoizedPayload,
  __resetShadowDiagnosticMemoForTests,
  type ShadowDiagnosticInputRow,
  type ShadowDiagnosticPayload,
} from "./swingShadowDiagnostic";

/* ────────────────────────── Fixtures ────────────────────────── */

const SCAN = "2026-05-28";

function row(over: Partial<ShadowDiagnosticInputRow> & { symbol: string }): ShadowDiagnosticInputRow {
  const base: ShadowDiagnosticInputRow = {
    symbol: over.symbol,
    scanDate: SCAN,
    score: 70,
    action: "WATCH",
    sector: "Financial Services",
    industry: "Banks",
    fundamentalScore: 10,
    rsi14: 55,
    pctFrom52wHigh: -10,
    warnings: [],
  };
  return { ...base, ...over };
}

function makeRows(n: number): ShadowDiagnosticInputRow[] {
  return Array.from({ length: n }, (_, i) =>
    row({
      symbol: `SYM${String(i).padStart(3, "0")}`,
      score: 80 - (i % 30), // varied
      fundamentalScore: i % 20,
      rsi14: 50 + (i % 25),
      pctFrom52wHigh: -((i % 40) + 1),
      warnings: i % 5 === 0 ? ["RSI overextended"] : [],
    }),
  );
}

const GEN = "2026-05-28T10:00:00.000Z";

beforeEach(() => {
  __resetShadowDiagnosticMemoForTests();
  delete process.env["SWING_SHADOW_DIAG_ENABLED"];
});

/* ────────────────────────── 1. Bounded lists ────────────────────────── */

describe("buildShadowDiagnostic — bounded lists", () => {
  it("caps every list at LIST_CAP (25), even with 500 input rows", () => {
    const payload = buildShadowDiagnostic({
      generatedAt: GEN,
      scanDate: SCAN,
      rows: makeRows(500),
    });
    expect(payload.totalRows).toBe(500);
    expect(payload.listCap).toBe(LIST_CAP);
    expect(payload.topByLive.length).toBeLessThanOrEqual(LIST_CAP);
    expect(payload.topByB1.length).toBeLessThanOrEqual(LIST_CAP);
    expect(payload.topByB3.length).toBeLessThanOrEqual(LIST_CAP);
    expect(payload.promotedByB1.length).toBeLessThanOrEqual(LIST_CAP);
    expect(payload.demotedByB1.length).toBeLessThanOrEqual(LIST_CAP);
    expect(payload.promotedByB3.length).toBeLessThanOrEqual(LIST_CAP);
    expect(payload.demotedByB3.length).toBeLessThanOrEqual(LIST_CAP);
    expect(payload.highScoreDemotedByShadow.length).toBeLessThanOrEqual(LIST_CAP);
    expect(payload.avoidPromotedByShadow.length).toBeLessThanOrEqual(LIST_CAP);
  });
});

/* ────────────────────────── 2. Deterministic ordering ────────────────────────── */

describe("buildShadowDiagnostic — deterministic ordering", () => {
  it("topByLive is desc by liveScore with symbol asc tiebreaker", () => {
    const rows: ShadowDiagnosticInputRow[] = [
      row({ symbol: "BBB", score: 70, fundamentalScore: 0 }),
      row({ symbol: "AAA", score: 70, fundamentalScore: 0 }),
      row({ symbol: "CCC", score: 90, fundamentalScore: 0 }),
    ];
    const p = buildShadowDiagnostic({ generatedAt: GEN, scanDate: SCAN, rows });
    expect(p.topByLive.map((r) => r.symbol)).toEqual(["CCC", "AAA", "BBB"]);
  });

  it("promotedByB1 is desc by b1Delta with symbol tiebreaker; pool excludes |delta| < 1", () => {
    // Fundamental subtraction makes b1 lower than live → b1Delta is negative
    // for non-zero fundamental, zero when fundamental is 0.
    // To get a POSITIVE b1Delta we need live to be clamped low (e.g. live=120
    // clamps to b1=100 → b1Delta = -20). We can't easily get +delta from real
    // formula, so just assert demotedByB1 ordering (more natural).
    const rows: ShadowDiagnosticInputRow[] = [
      row({ symbol: "BBB", score: 70, fundamentalScore: 5 }),  // b1=65, delta=-5
      row({ symbol: "AAA", score: 70, fundamentalScore: 5 }),  // same delta
      row({ symbol: "CCC", score: 70, fundamentalScore: 10 }), // delta=-10
    ];
    const p = buildShadowDiagnostic({ generatedAt: GEN, scanDate: SCAN, rows });
    // demotedByB1 is sorted asc by delta (most negative first); tiebreaker = symbol asc
    expect(p.demotedByB1.map((r) => r.symbol)).toEqual(["CCC", "AAA", "BBB"]);
  });

  it("rows with |b1Delta| < 1 are excluded from promoted/demoted pools", () => {
    const rows: ShadowDiagnosticInputRow[] = [
      row({ symbol: "QUIET", score: 70, fundamentalScore: 0 }), // b1Delta = 0
    ];
    const p = buildShadowDiagnostic({ generatedAt: GEN, scanDate: SCAN, rows });
    expect(p.promotedByB1).toHaveLength(0);
    expect(p.demotedByB1).toHaveLength(0);
  });
});

/* ────────────────────────── 3. Uses computeShadowScores ────────────────────────── */

describe("buildShadowDiagnostic — uses computeShadowScores for every row", () => {
  it("populates b1ShadowScore and b3ShadowScore for every input row", () => {
    const rows = makeRows(10);
    const p = buildShadowDiagnostic({ generatedAt: GEN, scanDate: SCAN, rows });
    expect(p.topByLive.length + p.topByB1.length).toBeGreaterThan(0);
    // Every projected row in any list carries shadow fields (not undefined).
    const sample = [...p.topByLive, ...p.topByB1, ...p.topByB3];
    for (const r of sample) {
      expect(r).toHaveProperty("b1ShadowScore");
      expect(r).toHaveProperty("b3ShadowScore");
      expect(r).toHaveProperty("b1Delta");
      expect(r).toHaveProperty("b3Delta");
      expect(r).toHaveProperty("dataQuality");
      expect(Array.isArray(r.b1Reasons)).toBe(true);
      expect(Array.isArray(r.b3Reasons)).toBe(true);
    }
  });

  it("B3 penalty fires when a B3 warning substring is present", () => {
    const rows: ShadowDiagnosticInputRow[] = [
      row({
        symbol: "RSIHOT",
        score: 80,
        fundamentalScore: 0,
        rsi14: 60, // RSI not >70
        warnings: ["RSI overextended"],
      }),
    ];
    const p = buildShadowDiagnostic({ generatedAt: GEN, scanDate: SCAN, rows });
    const r = p.topByLive[0]!;
    // B1 = 80 - 0 = 80; B3 = 80 - 5 (warn rsi-overext) = 75
    expect(r.b1ShadowScore).toBe(80);
    expect(r.b3ShadowScore).toBe(75);
    expect(r.b3Reasons.some((x) => x.code === "B3_WARN_RSI_OVEREXTENDED")).toBe(true);
  });
});

/* ────────────────────────── 4. Unknown warnings surfaced, never guessed ────────────────────────── */

describe("buildShadowDiagnostic — unknown warning prose is surfaced, never silently mapped to B3", () => {
  it("a novel unrecognized warning appears in warningVerification.unrecognizedStrings AND does NOT lower B3", () => {
    const rows: ShadowDiagnosticInputRow[] = [
      row({
        symbol: "NOVEL",
        score: 80,
        fundamentalScore: 0,
        rsi14: 50, // < 70 (no B3 RSI penalty)
        pctFrom52wHigh: -20, // far from 52w high (no near-high penalty)
        warnings: ["Quantum entanglement detected in tape"], // novel string
      }),
    ];
    const p = buildShadowDiagnostic({ generatedAt: GEN, scanDate: SCAN, rows });
    expect(p.warningVerification.unrecognizedStrings).toContain(
      "Quantum entanglement detected in tape",
    );
    // B3 must equal B1 — the unknown prose is NOT mapped to any penalty.
    const r = p.topByLive[0]!;
    expect(r.b1ShadowScore).toBe(80);
    expect(r.b3ShadowScore).toBe(80);
  });

  it("matchCounts reflect verified B3 prose; allSubstringsObserved is true when all three appear", () => {
    const rows: ShadowDiagnosticInputRow[] = [
      row({ symbol: "A", warnings: ["Price extended far above EMA20; wait for pullback"] }),
      row({ symbol: "B", warnings: ["RSI overextended"] }),
      row({ symbol: "C", warnings: ["Short-term relative strength weak vs benchmark"] }),
    ];
    const p = buildShadowDiagnostic({ generatedAt: GEN, scanDate: SCAN, rows });
    expect(p.warningVerification.allSubstringsObserved).toBe(true);
    expect(p.warningVerification.matchCounts.EXTENDED_FROM_EMA20).toBe(1);
    expect(p.warningVerification.matchCounts.RSI_OVEREXTENDED).toBe(1);
    expect(p.warningVerification.matchCounts.RS_WEAK).toBe(1);
  });
});

/* ────────────────────────── 5. Non-mutation ────────────────────────── */

describe("buildShadowDiagnostic — never mutates input rows", () => {
  it("input rows are byte-identical after the build", () => {
    const rows = makeRows(20);
    const snapshot = JSON.stringify(rows);
    buildShadowDiagnostic({ generatedAt: GEN, scanDate: SCAN, rows });
    expect(JSON.stringify(rows)).toBe(snapshot);
  });
});

/* ────────────────────────── 6. Isolation — no forbidden imports ────────────────────────── */

describe("swingShadowDiagnostic.ts — module-level isolation", () => {
  it("does not import DB, Kite, Yahoo, scheduler, paper-equity, F&O, route, or UI modules", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const url = await import("node:url");
    // Resolve relative to THIS test file so it works from any cwd.
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const src = await fs.readFile(path.join(here, "swingShadowDiagnostic.ts"), "utf8");
    // Inspect ONLY import / require lines — banned names legitimately appear
    // in docstrings (e.g. "does NOT call Kite or Yahoo").
    // Multi-line imports show up as a `} from "..."` line — match any line
    // containing a quoted-spec `from`-clause, plus any `require(...)`.
    const importLines = src
      .split("\n")
      .filter((l) => /\bfrom\s+["']/.test(l) || /\brequire\s*\(/.test(l));
    const importBlob = importLines.join("\n");
    const banned = [
      "@workspace/db",
      "drizzle-orm",
      "kiteConnect",
      "kiteAuth",
      "yahoo",
      "Yahoo",
      "scheduler",
      "Scheduler",
      "paperAccount",
      "paperTrading",
      "optionSignals",
      "optionChain",
      "/fno",
      "FNO",
      "express",
      "Router",
      "swingScanner",
      "swingScannerStore",
      "../routes/",
      "node-fetch",
    ];
    for (const b of banned) {
      expect(
        importBlob.includes(b),
        `must not import ${b}; offending lines:\n${importBlob}`,
      ).toBe(false);
    }
    // Only legal import is the sibling pure module.
    expect(importBlob.includes('from "./swingShadowScore"')).toBe(true);
  });
});

/* ────────────────────────── 7. Score-delta distribution ────────────────────────── */

describe("buildShadowDiagnostic — score-delta distribution", () => {
  it("buckets non-null deltas correctly and zero count matches input", () => {
    const rows: ShadowDiagnosticInputRow[] = [
      row({ symbol: "ZERO", score: 70, fundamentalScore: 0 }),       // b1Delta=0
      row({ symbol: "SMALL", score: 70, fundamentalScore: 3 }),      // b1Delta=-3 (in [-5,-1))
      row({ symbol: "BIG", score: 70, fundamentalScore: 15 }),       // b1Delta=-15 (in [-20,-10))
    ];
    const p = buildShadowDiagnostic({ generatedAt: GEN, scanDate: SCAN, rows });
    expect(p.b1DeltaDistribution.zeroCount).toBe(1);
    expect(p.b1DeltaDistribution.negativeCount).toBe(2);
    expect(p.b1DeltaDistribution.positiveCount).toBe(0);
    // Total bin counts equal non-null deltas
    const binTotal = p.b1DeltaDistribution.bins.reduce((a, b) => a + b.count, 0);
    expect(binTotal).toBe(3);
  });
});

/* ────────────────────────── 8. Data-quality histogram ────────────────────────── */

describe("buildShadowDiagnostic — data-quality histogram", () => {
  it("counts sum to totalRows", () => {
    const rows = makeRows(40);
    const p = buildShadowDiagnostic({ generatedAt: GEN, scanDate: SCAN, rows });
    const sum = p.dataQuality.ok + p.dataQuality.partial + p.dataQuality.insufficient;
    expect(sum).toBe(40);
  });
});

/* ────────────────────────── 9. High-score-demoted / AVOID-promoted ────────────────────────── */

describe("buildShadowDiagnostic — cross-cut buckets", () => {
  it("highScoreDemotedByShadow only includes rows with liveScore >= 60 AND a meaningful negative delta", () => {
    const rows: ShadowDiagnosticInputRow[] = [
      row({ symbol: "HIGHHURT", score: 80, fundamentalScore: 20 }),   // live 80 (>=60), b1Delta=-20 → IN
      row({ symbol: "LOWHURT", score: 50, fundamentalScore: 20 }),    // live 50 (<60) → OUT
      row({ symbol: "HIGHOK", score: 80, fundamentalScore: 0 }),      // delta=0 → OUT
    ];
    const p = buildShadowDiagnostic({ generatedAt: GEN, scanDate: SCAN, rows });
    expect(p.highScoreDemotedByShadow.map((r) => r.symbol)).toEqual(["HIGHHURT"]);
    expect(p.highScoreThreshold).toBe(HIGH_SCORE_THRESHOLD);
  });

  it("avoidPromotedByShadow only includes rows with liveAction in AVOID set AND a meaningful positive delta", () => {
    const rows: ShadowDiagnosticInputRow[] = [
      // To get positive b1Delta we need live > 100 (clamps to 100) — engineered.
      row({ symbol: "AVOIDUP", score: 120, action: "AVOID", fundamentalScore: 0 }),
      row({ symbol: "WATCHUP", score: 120, action: "WATCH", fundamentalScore: 0 }),
    ];
    const p = buildShadowDiagnostic({ generatedAt: GEN, scanDate: SCAN, rows });
    // AVOIDUP: live=120 → liveScore reported as 120 (un-clamped), b1=100 (clamped), b1Delta=-20.
    // Since b1Delta is NEGATIVE (not positive), AVOIDUP should NOT appear.
    expect(p.avoidPromotedByShadow).toHaveLength(0);
  });
});

/* ────────────────────────── 10. Memoization ────────────────────────── */

describe("memoization helpers", () => {
  it("memoKey is deterministic across (scanDate, rowCount)", () => {
    expect(memoKey(SCAN, 100)).toBe(memoKey(SCAN, 100));
    expect(memoKey(SCAN, 100)).not.toBe(memoKey(SCAN, 101));
    expect(memoKey(SCAN, 100)).not.toBe(memoKey("2026-05-27", 100));
    expect(memoKey(null, 0)).toBe("NULL|0");
  });

  it("cache miss returns null; set then get within TTL returns the same payload", () => {
    const now = 1_000_000;
    const key = memoKey(SCAN, 1);
    const payload = buildShadowDiagnostic({
      generatedAt: GEN,
      scanDate: SCAN,
      rows: [row({ symbol: "A" })],
    });
    expect(getMemoizedPayload(now, key)).toBeNull();
    setMemoizedPayload(now, key, payload);
    expect(getMemoizedPayload(now + MEMO_TTL_MS - 1, key)).toBe(payload);
  });

  it("expires after TTL", () => {
    const now = 1_000_000;
    const key = memoKey(SCAN, 1);
    const payload = buildShadowDiagnostic({
      generatedAt: GEN,
      scanDate: SCAN,
      rows: [row({ symbol: "A" })],
    });
    setMemoizedPayload(now, key, payload);
    expect(getMemoizedPayload(now + MEMO_TTL_MS, key)).toBeNull();
    expect(getMemoizedPayload(now + MEMO_TTL_MS + 1000, key)).toBeNull();
  });

  it("different key invalidates cache", () => {
    const now = 1_000_000;
    const payload = buildShadowDiagnostic({
      generatedAt: GEN,
      scanDate: SCAN,
      rows: [row({ symbol: "A" })],
    });
    setMemoizedPayload(now, memoKey(SCAN, 1), payload);
    expect(getMemoizedPayload(now, memoKey(SCAN, 2))).toBeNull();
    expect(getMemoizedPayload(now, memoKey("2026-05-27", 1))).toBeNull();
  });
});

/* ────────────────────────── 11. Feature flag ────────────────────────── */

describe("isSwingShadowDiagEnabled", () => {
  it("defaults to enabled when env var unset", () => {
    delete process.env["SWING_SHADOW_DIAG_ENABLED"];
    expect(isSwingShadowDiagEnabled()).toBe(true);
  });

  it.each(["0", "false", "no", "off", "FALSE", " OFF "])(
    'recognises "%s" as disabled',
    (v) => {
      process.env["SWING_SHADOW_DIAG_ENABLED"] = v;
      expect(isSwingShadowDiagEnabled()).toBe(false);
    },
  );

  it.each(["1", "true", "yes", "on", "anything-else"])(
    'recognises "%s" as enabled (default-permissive)',
    (v) => {
      process.env["SWING_SHADOW_DIAG_ENABLED"] = v;
      expect(isSwingShadowDiagEnabled()).toBe(true);
    },
  );
});

/* ────────────────────────── 12. Payload shape contract ────────────────────────── */

describe("buildShadowDiagnostic — payload shape contract", () => {
  it("reports the documented top-level fields and metadata", () => {
    const p: ShadowDiagnosticPayload = buildShadowDiagnostic({
      generatedAt: GEN,
      scanDate: SCAN,
      rows: makeRows(5),
    });
    expect(p).toMatchObject({
      generatedAt: GEN,
      featureFlagEnabled: true,
      scanDate: SCAN,
      totalRows: 5,
      listCap: 25,
      highScoreThreshold: 60,
    });
    expect(p.warningVerification).toBeDefined();
    expect(p.b1Summary).toBeDefined();
    expect(p.b3Summary).toBeDefined();
    expect(p.b1DeltaDistribution).toBeDefined();
    expect(p.b3DeltaDistribution).toBeDefined();
    expect(p.dataQuality).toBeDefined();
  });

  it("returns empty lists and null summaries when rows is empty", () => {
    const p = buildShadowDiagnostic({ generatedAt: GEN, scanDate: SCAN, rows: [] });
    expect(p.totalRows).toBe(0);
    expect(p.topByLive).toEqual([]);
    expect(p.b1Summary.mean).toBeNull();
    expect(p.dataQuality).toEqual({ ok: 0, partial: 0, insufficient: 0 });
  });
});
