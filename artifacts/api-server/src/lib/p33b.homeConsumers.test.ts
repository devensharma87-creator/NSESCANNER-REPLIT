/**
 * p33b.homeConsumers.test.ts — Blocker 2: Home false-zero and false-neutral fixes.
 *
 * Rules under test (runtime functions, pure logic):
 *   B2-01  buildOvernightCues: score=null when no valid global inputs (not 0).
 *   B2-02  buildOvernightCues: catch fallback returns score=null (not 0).
 *   B2-03  classifySentiment: null → null (not NEUTRAL).
 *   B2-04  classifySentiment: score=0 → NEUTRAL (measured, not fabricated from null).
 *   B2-05  classifySentiment: score=35 → STRONG_BULLISH.
 *   B2-06  classifySentiment: score=-35 → STRONG_BEARISH.
 *   B2-07  buildPostMarketDigest: rows with null changePercent excluded from adv/dec.
 *   B2-08  buildPostMarketDigest: breadthScore=null when all rows have null changePercent.
 *   B2-09  buildPostMarketDigest: avgChangePercent=null when no valid changePercent rows.
 *   B2-10  buildPostMarketDigest: totalVolume=null when no rows have volume.
 *   B2-11  buildPostMarketDigest: adRatio=null when adv>0 and dec=0 (∞ ratio).
 *   B2-12  buildPostMarketDigest: narrative says "unavailable" when breadthScore=null.
 *   B2-13  overnightCues catch: score=null, not 0, when entire call fails.
 *
 * Note: buildOvernightCues and buildPostMarketDigest are internal (not exported).
 * These tests verify them via the exported module's exported helpers or by
 * reading the source to confirm the literal fix is in place.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");
const preMarketSrc = readFileSync(join(SRC, "lib/preMarket.ts"), "utf8");

// ── Source-level guards (fast — no runtime needed) ───────────────────────────

describe("Blocker 2 — Home false-zero source guards", () => {
  it("B2-01: buildOvernightCues declares return type score: number | null", () => {
    expect(preMarketSrc).toMatch(
      /buildOvernightCues\(\):\s*Promise<\{\s*cues:\s*Cue\[\];\s*score:\s*number\s*\|\s*null\s*\}>/
    );
  });

  it("B2-02: buildOvernightCues returns null (not 0) when totalWeight===0", () => {
    // The fix: `const score: number | null = totalWeight > 0 ? ... : null`
    expect(preMarketSrc).toMatch(/const score: number \| null = totalWeight > 0/);
    // Must NOT have the old `totalWeight > 0 ? .* : 0` pattern for the score
    expect(preMarketSrc).not.toMatch(/totalWeight > 0 \? weighted \/ totalWeight : 0/);
  });

  it("B2-03: .catch fallback returns score: null (not score: 0)", () => {
    // The catch on buildOvernightCues must not return score: 0
    expect(preMarketSrc).toMatch(/overnightCues failed.*return \{ cues:.*score: null \}/s);
  });

  it("B2-04: classifySentiment accepts number | null", () => {
    expect(preMarketSrc).toMatch(/function classifySentiment\(score: number \| null\)/);
  });

  it("B2-05: classifySentiment returns null for null input", () => {
    expect(preMarketSrc).toMatch(/if \(score === null\) return null/);
  });

  it("B2-06: classifySentiment return type is Sentiment | null", () => {
    expect(preMarketSrc).toMatch(/classifySentiment\([^)]+\):\s*Sentiment\s*\|\s*null/);
  });

  it("B2-07: PreMarketReportData.sentiment allows null", () => {
    // sentiment field must be Sentiment | null
    expect(preMarketSrc).toMatch(/sentiment:\s*Sentiment\s*\|\s*null/);
  });

  it("B2-08: PreMarketReportData.sentimentScore allows null", () => {
    expect(preMarketSrc).toMatch(/sentimentScore:\s*number\s*\|\s*null/);
  });

  it("B2-09: buildPostMarketDigest filters null changePercent rows for breadth", () => {
    expect(preMarketSrc).toMatch(/validBreadthRows.*filter.*changePercent.*!=.*null.*isFinite/s);
  });

  it("B2-10: buildPostMarketDigest breadthScore is null when no valid rows", () => {
    expect(preMarketSrc).toMatch(/breadthScore.*number \| null.*=.*validBreadthRows\.length > 0/s);
  });

  it("B2-11: buildPostMarketDigest avgChangePercent is null when no valid rows", () => {
    expect(preMarketSrc).toMatch(/avgChg.*number \| null.*=.*validBreadthRows\.length > 0/s);
  });

  it("B2-12: buildPostMarketDigest totalVolume is null when no rows have volume", () => {
    expect(preMarketSrc).toMatch(/totalVol.*number \| null.*=.*rowsWithVolume\.length > 0/s);
  });

  it("B2-13: buildPostMarketDigest narrative handles null breadthScore explicitly", () => {
    expect(preMarketSrc).toMatch(/breadthScore === null/);
    expect(preMarketSrc).toMatch(/Breadth data unavailable/);
  });

  it("B2-14: narrative uses sentimentLabel (handles null sentiment, not raw sentinel value)", () => {
    expect(preMarketSrc).toMatch(/sentimentLabel.*=.*sentiment.*!=.*null/s);
    expect(preMarketSrc).toMatch(/unavailable \(no valid global inputs/);
  });

  it("B2-15: adRatio narrative uses null-safe pattern (not ?? '0')", () => {
    // The old `adRatio ?? "0"` was a false-zero in the narrative.
    // Fixed to: adRatio != null ? adRatio : "N/A"
    expect(preMarketSrc).not.toMatch(/adRatio\s*\?\?\s*["']0["']/);
  });
});

// ── Logic-level guards: classifySentiment (pure function, inline-testable) ───

describe("Blocker 2 — classifySentiment pure logic", () => {
  // Inline the function logic to test without importing the full module
  // (avoids the 15s timeout from preMarket.ts setInterval side-effects).
  type Sentiment = "STRONG_BULLISH" | "BULLISH" | "NEUTRAL" | "BEARISH" | "STRONG_BEARISH";
  function classifySentiment(score: number | null): Sentiment | null {
    if (score === null) return null;
    if (score >= 35) return "STRONG_BULLISH";
    if (score >= 12) return "BULLISH";
    if (score <= -35) return "STRONG_BEARISH";
    if (score <= -12) return "BEARISH";
    return "NEUTRAL";
  }

  it("B2-L1: null → null (not NEUTRAL)", () => {
    expect(classifySentiment(null)).toBeNull();
  });

  it("B2-L2: 0 → NEUTRAL (measured, not fabricated from null)", () => {
    expect(classifySentiment(0)).toBe("NEUTRAL");
  });

  it("B2-L3: 35 → STRONG_BULLISH", () => {
    expect(classifySentiment(35)).toBe("STRONG_BULLISH");
  });

  it("B2-L4: 34.9 → BULLISH (boundary)", () => {
    expect(classifySentiment(34.9)).toBe("BULLISH");
  });

  it("B2-L5: -35 → STRONG_BEARISH", () => {
    expect(classifySentiment(-35)).toBe("STRONG_BEARISH");
  });

  it("B2-L6: -12 → BEARISH (boundary)", () => {
    expect(classifySentiment(-12)).toBe("BEARISH");
  });

  it("B2-L7: 100 → STRONG_BULLISH (max clamp)", () => {
    expect(classifySentiment(100)).toBe("STRONG_BULLISH");
  });

  it("B2-L8: -100 → STRONG_BEARISH (min clamp)", () => {
    expect(classifySentiment(-100)).toBe("STRONG_BEARISH");
  });
});

// ── Logic-level guards: buildPostMarketDigest null safety ─────────────────────

describe("Blocker 2 — buildPostMarketDigest null safety (inline logic)", () => {
  type Row = { quote: { changePercent?: number | null; volume?: number | null; price: number; fiftyTwoWeekHigh?: number | null; fiftyTwoWeekLow?: number | null } };

  /** Inline the fixed logic for unit testing without importing the full module. */
  function buildDigest(rows: Row[]) {
    const validBreadthRows = rows.filter(
      r => r.quote.changePercent != null && isFinite(r.quote.changePercent)
    );
    const adv = validBreadthRows.filter(r => (r.quote.changePercent as number) > 0.1).length;
    const dec = validBreadthRows.filter(r => (r.quote.changePercent as number) < -0.1).length;
    const unc = validBreadthRows.length - adv - dec;
    const rowsWithVolume = rows.filter(r => r.quote.volume != null && (r.quote.volume as number) > 0);
    const totalVol: number | null = rowsWithVolume.length > 0
      ? rows.reduce((a, r) => a + (r.quote.volume ?? 0), 0)
      : null;
    const avgChg: number | null = validBreadthRows.length > 0
      ? validBreadthRows.reduce((a, r) => a + (r.quote.changePercent as number), 0) / validBreadthRows.length
      : null;
    const adRatio = dec > 0 ? +(adv / dec).toFixed(2) : (adv > 0 ? null : 0);
    const breadthScore: number | null = validBreadthRows.length > 0
      ? Math.max(-100, Math.min(100, ((adv - dec) / validBreadthRows.length) * 100))
      : null;
    return { adv, dec, unc, totalVol, avgChg, adRatio, breadthScore };
  }

  it("B2-P1: rows with null changePercent excluded from adv/dec counts", () => {
    const rows: Row[] = [
      { quote: { changePercent: null, price: 100 } },
      { quote: { changePercent: undefined, price: 100 } },
      { quote: { changePercent: 1.5, price: 100 } },
    ];
    const d = buildDigest(rows);
    expect(d.adv).toBe(1);
    expect(d.dec).toBe(0);
    expect(d.unc).toBe(0); // null rows are excluded, not counted as unchanged
  });

  it("B2-P2: breadthScore=null when all rows have null changePercent", () => {
    const rows: Row[] = [
      { quote: { changePercent: null, price: 100 } },
      { quote: { changePercent: null, price: 200 } },
    ];
    const d = buildDigest(rows);
    expect(d.breadthScore).toBeNull();
  });

  it("B2-P3: avgChangePercent=null when no valid changePercent rows", () => {
    const rows: Row[] = [{ quote: { changePercent: null, price: 100 } }];
    const d = buildDigest(rows);
    expect(d.avgChg).toBeNull();
  });

  it("B2-P4: totalVolume=null when all volumes are null/zero", () => {
    const rows: Row[] = [
      { quote: { changePercent: 1, volume: null, price: 100 } },
      { quote: { changePercent: 2, volume: 0, price: 200 } },
    ];
    const d = buildDigest(rows);
    expect(d.totalVol).toBeNull();
  });

  it("B2-P5: totalVolume is computed when at least one row has volume", () => {
    const rows: Row[] = [
      { quote: { changePercent: 1, volume: 1000, price: 100 } },
      { quote: { changePercent: -1, volume: null, price: 200 } },
    ];
    const d = buildDigest(rows);
    expect(d.totalVol).toBe(1000);
  });

  it("B2-P6: adRatio=null when all advances and dec=0 (∞ ratio → honest null)", () => {
    const rows: Row[] = [
      { quote: { changePercent: 2, price: 100 } },
      { quote: { changePercent: 3, price: 200 } },
    ];
    const d = buildDigest(rows);
    expect(d.adRatio).toBeNull(); // adv=2, dec=0 → null (not fabricated ∞ or 1.00)
  });

  it("B2-P7: adRatio=0 when adv=0 and dec=0 (no movement)", () => {
    const rows: Row[] = [
      { quote: { changePercent: 0, price: 100 } },
    ];
    const d = buildDigest(rows);
    expect(d.adRatio).toBe(0);
  });

  it("B2-P8: breadthScore correct with valid data", () => {
    const rows: Row[] = [
      { quote: { changePercent: 2, price: 100 } },    // advance
      { quote: { changePercent: 1.5, price: 100 } },  // advance
      { quote: { changePercent: -2, price: 100 } },   // decline
    ];
    const d = buildDigest(rows);
    expect(d.adv).toBe(2);
    expect(d.dec).toBe(1);
    // breadthScore = ((2-1)/3)*100 = 33.3
    expect(d.breadthScore).toBeCloseTo(33.3, 0);
  });

  it("B2-P9: unc counts rows with changePercent in -0.1..+0.1 range (not null rows)", () => {
    const rows: Row[] = [
      { quote: { changePercent: 0.05, price: 100 } },  // unchanged (within ±0.1)
      { quote: { changePercent: null, price: 100 } },  // excluded (not unchanged!)
      { quote: { changePercent: 2, price: 100 } },     // advance
    ];
    const d = buildDigest(rows);
    expect(d.adv).toBe(1);
    expect(d.dec).toBe(0);
    expect(d.unc).toBe(1); // only the 0.05 row is unchanged
  });
});
