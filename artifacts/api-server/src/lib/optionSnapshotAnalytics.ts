/**
 * Priority 9 — Read-Only Option Snapshot Analytics.
 *
 * Pure analytics over a single `option_chain_snapshot` window
 * (one underlying / one expiry / one capturedAt timestamp). All formulas
 * are deterministic and side-effect free; this module does NOT touch
 * the DB, the network, the Kite client, the paper-trader, the swing
 * scanner, or any signal-generation code path.
 *
 *   - Inputs: an array of per-leg rows (typed via `AnalyticsRowInput`).
 *   - Outputs: an `AnalyticsResult` aggregate (PCR, total OI, OI deltas,
 *     highest-OI strikes, approximate max pain, ATM strike, ATM
 *     straddle, ATM IV, average IV, bid/ask spread summary, sample
 *     counts).
 *   - Missing data (`null` OI, missing CE/PE side, no ATM context, no
 *     IV column) is propagated honestly — fields read `null` rather
 *     than synthesising zeros.
 *
 * **Not** wired into trading. The diagnostic route in
 * `routes/optionChainSnapshot.ts` is the only consumer.
 *
 * Max-pain method (standard, see Sheldon Natenberg / NSE pinning lit):
 * for every candidate strike S, the writer's pain at expiry is
 *   pain(S) = Σ_K max(S - K, 0) · OI_CE(K)  +  Σ_K max(K - S, 0) · OI_PE(K)
 * The strike that minimises pain(S) is the approximate max-pain
 * strike — i.e. the price at which option writers lose the least and
 * therefore the price spot is "pinned" toward in classical theory.
 * We evaluate it only over the strikes present in the snapshot
 * window; that's the same convention the rest of the app's OI
 * analytics already use.
 */

export interface AnalyticsRowInput {
  strike: number;
  /** Always "CE" or "PE". */
  optType: "CE" | "PE";
  oi: number | null;
  oiChange: number | null;
  ltp: number | null;
  iv: number | null;
  bid: number | null;
  ask: number | null;
  /** Per-row denormalised spot at capture time — may be null. */
  spot: number | null;
  /** Per-row denormalised ATM strike at capture time — may be null. */
  atmStrike: number | null;
}

export interface HighestOiStrike {
  strike: number;
  oi: number;
}
export interface HighestOiChangeStrike {
  strike: number;
  oiChange: number;
}
export interface AtmStraddle {
  strike: number;
  ce: number | null;
  pe: number | null;
  /** ce + pe when both legs present; null otherwise. */
  total: number | null;
}
export interface AtmIvSummary {
  ce: number | null;
  pe: number | null;
  /** Mean of (ce, pe) when both present; otherwise whichever is non-null; null if neither. */
  mean: number | null;
}
export interface IvAverage {
  ce: number | null;
  pe: number | null;
  overall: number | null;
}
export interface SpreadSummary {
  /** Median (bid/ask)/ltp · 100 across CE rows that have all three numbers. */
  ceMedianPct: number | null;
  peMedianPct: number | null;
  /** Count of rows where (ask-bid)/ltp · 100 > `WIDE_SPREAD_PCT`. */
  widePctCount: number;
  /** Total rows considered (i.e. had bid+ask+ltp populated). */
  sampleSize: number;
}

export interface AnalyticsResult {
  ceTotalOi: number | null;
  peTotalOi: number | null;
  ceOiChange: number | null;
  peOiChange: number | null;
  /** putOI / callOI. Null when callOI is 0 or unavailable. */
  pcr: number | null;
  highestCeOi: HighestOiStrike | null;
  highestPeOi: HighestOiStrike | null;
  highestCeOiChange: HighestOiChangeStrike | null;
  highestPeOiChange: HighestOiChangeStrike | null;
  /** Approximate max-pain strike across the strikes in this snapshot window. */
  maxPainStrike: number | null;
  /** ATM strike inferred from the rows: prefer denormalised `atm_strike`,
   *  fall back to "strike closest to spot present in the window". */
  atmStrike: number | null;
  spot: number | null;
  atmStraddle: AtmStraddle | null;
  atmIv: AtmIvSummary | null;
  ivAverage: IvAverage;
  spreadSummary: SpreadSummary;
  strikeCount: number;
  ceCount: number;
  peCount: number;
}

/** Spread-percent threshold above which a leg is flagged "wide" in the
 *  diagnostic summary. Mirrors the FNO_LIQUIDITY constant in
 *  `paperAccount.ts` so operators reading both surfaces see the same
 *  liquidity signal. Pure number — no behaviour change. */
export const WIDE_SPREAD_PCT = 1.5;

/** Default staleness threshold (minutes) used by the diagnostic route
 *  when the caller hasn't passed one. 30 min ≈ ~6 ingestion cycles
 *  at the default 5-min cadence. */
export const DEFAULT_STALE_THRESHOLD_MINUTES = 30;

// ---------------------------------------------------------------------------
// Internal helpers (pure).
// ---------------------------------------------------------------------------

function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1]! + s[m]!) / 2 : s[m]!;
}

function sumOi(rows: readonly AnalyticsRowInput[], side: "CE" | "PE"): number | null {
  let total = 0;
  let saw = false;
  for (const r of rows) {
    if (r.optType !== side) continue;
    if (r.oi == null) continue;
    total += r.oi;
    saw = true;
  }
  return saw ? total : null;
}

function sumOiChange(rows: readonly AnalyticsRowInput[], side: "CE" | "PE"): number | null {
  let total = 0;
  let saw = false;
  for (const r of rows) {
    if (r.optType !== side) continue;
    if (r.oiChange == null) continue;
    total += r.oiChange;
    saw = true;
  }
  return saw ? total : null;
}

function highestOi(rows: readonly AnalyticsRowInput[], side: "CE" | "PE"): HighestOiStrike | null {
  let best: HighestOiStrike | null = null;
  for (const r of rows) {
    if (r.optType !== side) continue;
    if (r.oi == null) continue;
    if (!best || r.oi > best.oi) best = { strike: r.strike, oi: r.oi };
  }
  return best;
}

function highestOiChange(
  rows: readonly AnalyticsRowInput[],
  side: "CE" | "PE",
): HighestOiChangeStrike | null {
  // "Highest OI-change" = maximum POSITIVE build-up only. Negative
  // deltas (unwinding) and zeros are not surfaced — the operator can
  // read raw OI deltas elsewhere. Returns null when no positive
  // build-up exists on this side; this avoids reporting a "highest"
  // that's actually the least-bad unwind, which would be misleading.
  let best: HighestOiChangeStrike | null = null;
  for (const r of rows) {
    if (r.optType !== side) continue;
    if (r.oiChange == null) continue;
    if (r.oiChange <= 0) continue;
    if (!best || r.oiChange > best.oiChange) {
      best = { strike: r.strike, oiChange: r.oiChange };
    }
  }
  return best;
}

/** Sum of writer pain at candidate-spot S (see file header). */
function painAtStrike(rows: readonly AnalyticsRowInput[], S: number): number {
  let pain = 0;
  for (const r of rows) {
    if (r.oi == null) continue;
    if (r.optType === "CE") {
      const itm = S - r.strike;
      if (itm > 0) pain += itm * r.oi;
    } else {
      const itm = r.strike - S;
      if (itm > 0) pain += itm * r.oi;
    }
  }
  return pain;
}

function approxMaxPain(rows: readonly AnalyticsRowInput[]): number | null {
  // Build the candidate strike set from the data itself. We need at
  // least one CE and one PE row with non-null OI to make max-pain
  // meaningful — otherwise the answer is degenerate (0 pain at the
  // extremes).
  const strikeSet = new Set<number>();
  let sawCeOi = false;
  let sawPeOi = false;
  for (const r of rows) {
    if (r.oi == null) continue;
    strikeSet.add(r.strike);
    if (r.optType === "CE") sawCeOi = true;
    else sawPeOi = true;
  }
  if (!sawCeOi || !sawPeOi || strikeSet.size === 0) return null;
  const strikes = [...strikeSet].sort((a, b) => a - b);
  let best: { strike: number; pain: number } | null = null;
  for (const S of strikes) {
    const p = painAtStrike(rows, S);
    if (!best || p < best.pain) best = { strike: S, pain: p };
  }
  return best ? best.strike : null;
}

function inferAtmStrike(rows: readonly AnalyticsRowInput[]): { atm: number | null; spot: number | null } {
  // Prefer the per-row denormalised `atm_strike` (set by the ingestor
  // at capture time — that's the broker-truth value).
  let atm: number | null = null;
  let spot: number | null = null;
  for (const r of rows) {
    if (atm == null && r.atmStrike != null) atm = r.atmStrike;
    if (spot == null && r.spot != null) spot = r.spot;
    if (atm != null && spot != null) break;
  }
  // Fallback: if no atm denormalised but spot is known, find the
  // nearest strike present in the window.
  if (atm == null && spot != null) {
    let bestK: number | null = null;
    let bestDist = Infinity;
    const seen = new Set<number>();
    for (const r of rows) {
      if (seen.has(r.strike)) continue;
      seen.add(r.strike);
      const d = Math.abs(r.strike - spot);
      if (d < bestDist) {
        bestDist = d;
        bestK = r.strike;
      }
    }
    atm = bestK;
  }
  return { atm, spot };
}

function pickLeg(
  rows: readonly AnalyticsRowInput[],
  strike: number,
  side: "CE" | "PE",
): AnalyticsRowInput | null {
  for (const r of rows) {
    if (r.strike === strike && r.optType === side) return r;
  }
  return null;
}

function avgIv(rows: readonly AnalyticsRowInput[], side: "CE" | "PE" | "ALL"): number | null {
  let sum = 0;
  let n = 0;
  for (const r of rows) {
    if (side !== "ALL" && r.optType !== side) continue;
    if (r.iv == null) continue;
    // Drop obviously bogus entries (Kite occasionally returns 0 or > 500).
    if (!(r.iv > 0 && r.iv < 500)) continue;
    sum += r.iv;
    n += 1;
  }
  return n > 0 ? sum / n : null;
}

function spreadPct(r: AnalyticsRowInput): number | null {
  if (r.bid == null || r.ask == null || r.ltp == null) return null;
  if (r.ltp <= 0) return null;
  if (r.ask < r.bid) return null;
  return ((r.ask - r.bid) / r.ltp) * 100;
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

export function computeAnalytics(rows: readonly AnalyticsRowInput[]): AnalyticsResult {
  const ceCount = rows.filter((r) => r.optType === "CE").length;
  const peCount = rows.filter((r) => r.optType === "PE").length;
  const strikeSet = new Set<number>();
  for (const r of rows) strikeSet.add(r.strike);

  const ceTotalOi = sumOi(rows, "CE");
  const peTotalOi = sumOi(rows, "PE");
  const ceOiChange = sumOiChange(rows, "CE");
  const peOiChange = sumOiChange(rows, "PE");

  const pcr =
    ceTotalOi != null && peTotalOi != null && ceTotalOi > 0 ? peTotalOi / ceTotalOi : null;

  const { atm, spot } = inferAtmStrike(rows);

  let atmStraddle: AtmStraddle | null = null;
  let atmIv: AtmIvSummary | null = null;
  if (atm != null) {
    const ceLeg = pickLeg(rows, atm, "CE");
    const peLeg = pickLeg(rows, atm, "PE");
    if (ceLeg || peLeg) {
      const ce = ceLeg?.ltp ?? null;
      const pe = peLeg?.ltp ?? null;
      atmStraddle = {
        strike: atm,
        ce,
        pe,
        total: ce != null && pe != null ? ce + pe : null,
      };
      const ceIv = ceLeg?.iv ?? null;
      const peIv = peLeg?.iv ?? null;
      const validCe = ceIv != null && ceIv > 0 && ceIv < 500 ? ceIv : null;
      const validPe = peIv != null && peIv > 0 && peIv < 500 ? peIv : null;
      let mean: number | null = null;
      if (validCe != null && validPe != null) mean = (validCe + validPe) / 2;
      else mean = validCe ?? validPe;
      atmIv = { ce: validCe, pe: validPe, mean };
    }
  }

  // Spread summary (CE / PE separately).
  const cePcts: number[] = [];
  const pePcts: number[] = [];
  let widePctCount = 0;
  let spreadSampleSize = 0;
  for (const r of rows) {
    const p = spreadPct(r);
    if (p == null) continue;
    spreadSampleSize += 1;
    if (p > WIDE_SPREAD_PCT) widePctCount += 1;
    if (r.optType === "CE") cePcts.push(p);
    else pePcts.push(p);
  }

  return {
    ceTotalOi,
    peTotalOi,
    ceOiChange,
    peOiChange,
    pcr,
    highestCeOi: highestOi(rows, "CE"),
    highestPeOi: highestOi(rows, "PE"),
    highestCeOiChange: highestOiChange(rows, "CE"),
    highestPeOiChange: highestOiChange(rows, "PE"),
    maxPainStrike: approxMaxPain(rows),
    atmStrike: atm,
    spot,
    atmStraddle,
    atmIv,
    ivAverage: {
      ce: avgIv(rows, "CE"),
      pe: avgIv(rows, "PE"),
      overall: avgIv(rows, "ALL"),
    },
    spreadSummary: {
      ceMedianPct: median(cePcts),
      peMedianPct: median(pePcts),
      widePctCount,
      sampleSize: spreadSampleSize,
    },
    strikeCount: strikeSet.size,
    ceCount,
    peCount,
  };
}

/** Stale = capturedAt is older than the threshold. Used by the route to
 *  attach a `staleness` block to every group; pure here so it tests
 *  the same way the route consumes it. */
export function computeStaleness(
  capturedAt: Date,
  now: Date,
  thresholdMinutes: number,
): { ageMinutes: number; isStale: boolean; thresholdMinutes: number } {
  const ageMinutes = Math.max(0, (now.getTime() - capturedAt.getTime()) / 60_000);
  return {
    ageMinutes,
    isStale: ageMinutes > thresholdMinutes,
    thresholdMinutes,
  };
}
