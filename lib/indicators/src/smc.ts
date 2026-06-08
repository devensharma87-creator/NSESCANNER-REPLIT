/**
 * Pure, CAUSAL Smart-Money-Concepts (SMC) / price-action engine shared by the
 * custom-strategy evaluator (live F&O engine + Backtest Lab) AND the scanner
 * charting tab, so there is exactly ONE implementation of the mitigation-aware
 * SMC math.
 *
 * Causality / no-repaint contract (mirrors `windowed.ts`):
 *   - Every per-bar value at index `i` is derived ONLY from bars with index ≤ i.
 *   - Fractal pivots are CONFIRMED with a `span`-bar lag: a pivot at index k is
 *     only eligible once bar `k + span` exists (`k <= i - span`). A fresh pivot
 *     therefore can never be claimed (and later repainted away) before the bars
 *     that confirm it actually exist.
 *   - A zone's "active as of bar i" predicate uses only whether it has been
 *     mitigated by a bar ≤ i — never future mitigation.
 *   - Missing / non-finite inputs yield a conservative `false`/`null` — NEVER an
 *     assumed-favourable value.
 *
 * Nothing here places orders or mutates state — it is detection math only. The
 * strategy-specific interpretation (which side a block favours, stop anchoring)
 * lives in the api-server evaluator; the chart formatting lives in the scanner.
 */

function fin(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n);
}

// ===========================================================================
// Fractal pivots (strict: a pivot is strictly beyond every bar in its window)
// ===========================================================================

/** True when `highs[k]` is strictly greater than the `span` bars on each side. */
export function isPivotHigh(highs: readonly number[], k: number, span: number): boolean {
  if (span < 1 || k - span < 0 || k + span >= highs.length) return false;
  const h = highs[k];
  if (!fin(h)) return false;
  for (let d = 1; d <= span; d++) {
    const a = highs[k - d];
    const b = highs[k + d];
    if (!fin(a) || !fin(b)) return false;
    if (a >= h || b >= h) return false;
  }
  return true;
}

/** True when `lows[k]` is strictly less than the `span` bars on each side. */
export function isPivotLow(lows: readonly number[], k: number, span: number): boolean {
  if (span < 1 || k - span < 0 || k + span >= lows.length) return false;
  const l = lows[k];
  if (!fin(l)) return false;
  for (let d = 1; d <= span; d++) {
    const a = lows[k - d];
    const b = lows[k + d];
    if (!fin(a) || !fin(b)) return false;
    if (a <= l || b <= l) return false;
  }
  return true;
}

// ===========================================================================
// Config
// ===========================================================================

export interface SmcInput {
  open: readonly number[];
  high: readonly number[];
  low: readonly number[];
  close: readonly number[];
  /** Wilder (or EMA-smoothed) ATR(14) aligned to the bars; null where unavailable. */
  atr14: readonly (number | null)[];
}

export interface SmcConfig {
  /** Swing span for BOS / CHoCH structure breaks. */
  structurePivot: number;
  /** Swing span for order-block (supply/demand) zones. */
  zonePivot: number;
  /** Keep at most this many untested order-block zones per side. */
  maxZones: number;
  /** Auto gap threshold = running mean of (high-low)/|low|; else `fvgThresholdPct`. */
  fvgAuto: boolean;
  /** Fixed minimum gap size as a PERCENT (e.g. 0.08 = 0.08%). */
  fvgThresholdPct: number;
  /** Keep at most this many active FVGs per side. */
  maxFvg: number;
  /** A displacement candle has |close-open| ≥ this multiple of ATR(14). */
  displacementAtrMult: number;
  /** Swing span for liquidity-sweep reference highs/lows. */
  sweepPivot: number;
}

/** Defaults aligned with the scanner charting indicator (`DEFAULT_FNO_SMC_PARAMS`). */
export const DEFAULT_SMC_CONFIG: SmcConfig = {
  structurePivot: 7,
  zonePivot: 10,
  maxZones: 5,
  fvgAuto: true,
  fvgThresholdPct: 0.08,
  maxFvg: 12,
  displacementAtrMult: 1.2,
  sweepPivot: 5,
};

// ===========================================================================
// Structure (BOS / CHoCH)
// ===========================================================================

export interface StructurePoint {
  /** Running structure direction after this bar: 1 up, -1 down, 0 unknown. */
  structDir: -1 | 0 | 1;
  /** A plain break of structure (continuation) printed this bar. */
  bosUp: boolean;
  bosDn: boolean;
  /** A change of character (break flipping prior structure) printed this bar. */
  chochUp: boolean;
  chochDn: boolean;
  /** Swing high broken on an up-break this bar (long-side invalidation ref). */
  breakHigh: number | null;
  /** Swing low broken on a down-break this bar (short-side invalidation ref). */
  breakLow: number | null;
}

/**
 * Break-of-Structure / Change-of-Character from confirmed fractal swings. A
 * confirmed swing high becomes `lastSH`; a close crossing over it prints BOS
 * (or CHoCH when it flips a prior DOWN structure) and consumes the level.
 * Symmetric for swing lows. Up- and down-breaks are tracked independently so a
 * single bar can legitimately register both in choppy (inverted-swing) regimes.
 * One forward pass, fully causal.
 */
export function structurePass(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  pivot: number,
): StructurePoint[] {
  const n = close.length;
  const out: StructurePoint[] = new Array(n);
  let lastSH: number | null = null;
  let lastSL: number | null = null;
  let structDir: -1 | 0 | 1 = 0;
  for (let i = 0; i < n; i++) {
    const j = i - pivot;
    if (j >= 0) {
      if (isPivotHigh(high, j, pivot)) lastSH = high[j]!;
      if (isPivotLow(low, j, pivot)) lastSL = low[j]!;
    }
    let bosUp = false;
    let bosDn = false;
    let chochUp = false;
    let chochDn = false;
    let breakHigh: number | null = null;
    let breakLow: number | null = null;
    const c = close[i]!;
    const prev = i > 0 ? close[i - 1]! : null;
    if (lastSH != null && prev != null && prev <= lastSH && c > lastSH) {
      if (structDir === -1) chochUp = true;
      else bosUp = true;
      breakHigh = lastSH;
      structDir = 1;
      lastSH = null;
    }
    if (lastSL != null && prev != null && prev >= lastSL && c < lastSL) {
      if (structDir === 1) chochDn = true;
      else bosDn = true;
      breakLow = lastSL;
      structDir = -1;
      lastSL = null;
    }
    out[i] = { structDir, bosUp, bosDn, chochUp, chochDn, breakHigh, breakLow };
  }
  return out;
}

// ===========================================================================
// Fair Value Gaps (3-candle, threshold-gated, mitigation-aware)
// ===========================================================================

export interface RawFvg {
  formedIndex: number;
  top: number;
  bottom: number;
  type: "fvgBull" | "fvgBear";
  /** First bar (> formedIndex) that mitigated the gap, or null if still open. */
  mitigatedIndex: number | null;
}

export interface FvgBar {
  bullPresent: boolean;
  bearPresent: boolean;
  bullFormed: boolean;
  bearFormed: boolean;
  bullRetest: boolean;
  bearRetest: boolean;
  bullFilled: boolean;
  bearFilled: boolean;
  nearestBullTop: number | null;
  nearestBullBottom: number | null;
  nearestBearTop: number | null;
  nearestBearBottom: number | null;
}

interface ActiveFvg {
  top: number;
  bottom: number;
  type: "fvgBull" | "fvgBear";
  zone: RawFvg;
}

/**
 * One forward pass that emits BOTH the raw FVG zones (with first-mitigation
 * index, for chart rendering) and the per-bar FVG state the evaluator reads.
 *
 * A bull FVG is the gap [high[i-2], low[i]] left when bar i's low prints above
 * bar i-2's high; it sits BELOW price as support. Mitigation (fill) = a later
 * low trading to/through its bottom; a shallower dip into the zone is a retest.
 * Symmetric for bear gaps (resistance above price).
 */
export function fvgPass(
  open: readonly number[],
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  cfg: SmcConfig,
): { zones: RawFvg[]; perBar: FvgBar[] } {
  void open;
  const n = close.length;
  const zones: RawFvg[] = [];
  const perBar: FvgBar[] = new Array(n);
  const activeBull: ActiveFvg[] = [];
  const activeBear: ActiveFvg[] = [];
  let cum = 0;

  for (let i = 0; i < n; i++) {
    const lo = low[i]!;
    const hi = high[i]!;
    if (fin(lo) && lo !== 0) cum += (hi - lo) / Math.abs(lo);
    const thr = cfg.fvgAuto ? cum / (i + 1) : cfg.fvgThresholdPct / 100;

    let bullRetest = false;
    let bearRetest = false;
    let bullFilled = false;
    let bearFilled = false;

    // 1) Test EXISTING active gaps against this bar (a gap formed this bar
    //    cannot be retested on the same bar).
    for (let k = activeBull.length - 1; k >= 0; k--) {
      const z = activeBull[k]!;
      if (fin(lo) && lo <= z.bottom) {
        z.zone.mitigatedIndex = i;
        bullFilled = true;
        activeBull.splice(k, 1);
      } else if (fin(lo) && lo <= z.top) {
        bullRetest = true;
      }
    }
    for (let k = activeBear.length - 1; k >= 0; k--) {
      const z = activeBear[k]!;
      if (fin(hi) && hi >= z.top) {
        z.zone.mitigatedIndex = i;
        bearFilled = true;
        activeBear.splice(k, 1);
      } else if (fin(hi) && hi >= z.bottom) {
        bearRetest = true;
      }
    }

    // 2) Form a new gap completing at this bar.
    let bullFormed = false;
    let bearFormed = false;
    if (i >= 2) {
      const c0Low = low[i]!;
      const c0High = high[i]!;
      const c2High = high[i - 2]!;
      const c2Low = low[i - 2]!;
      if (
        fin(c0Low) &&
        fin(c2High) &&
        c2High !== 0 &&
        c0Low > c2High &&
        (c0Low - c2High) / Math.abs(c2High) > thr
      ) {
        const zone: RawFvg = { formedIndex: i, top: c0Low, bottom: c2High, type: "fvgBull", mitigatedIndex: null };
        zones.push(zone);
        activeBull.push({ top: c0Low, bottom: c2High, type: "fvgBull", zone });
        if (activeBull.length > cfg.maxFvg) activeBull.shift();
        bullFormed = true;
      } else if (
        fin(c0High) &&
        fin(c2Low) &&
        c0High !== 0 &&
        c0High < c2Low &&
        (c2Low - c0High) / Math.abs(c0High) > thr
      ) {
        const zone: RawFvg = { formedIndex: i, top: c2Low, bottom: c0High, type: "fvgBear", mitigatedIndex: null };
        zones.push(zone);
        activeBear.push({ top: c2Low, bottom: c0High, type: "fvgBear", zone });
        if (activeBear.length > cfg.maxFvg) activeBear.shift();
        bearFormed = true;
      }
    }

    // 3) Present + nearest-active (by distance from close to zone midpoint).
    const c = close[i]!;
    const nb = nearestZone(activeBull, c);
    const ns = nearestZone(activeBear, c);
    perBar[i] = {
      bullPresent: activeBull.length > 0,
      bearPresent: activeBear.length > 0,
      bullFormed,
      bearFormed,
      bullRetest,
      bearRetest,
      bullFilled,
      bearFilled,
      nearestBullTop: nb?.top ?? null,
      nearestBullBottom: nb?.bottom ?? null,
      nearestBearTop: ns?.top ?? null,
      nearestBearBottom: ns?.bottom ?? null,
    };
  }

  return { zones, perBar };
}

function nearestZone(
  active: readonly { top: number; bottom: number }[],
  close: number,
): { top: number; bottom: number } | null {
  if (active.length === 0 || !fin(close)) return null;
  let best: { top: number; bottom: number } | null = null;
  let bestDist = Infinity;
  for (const z of active) {
    const mid = (z.top + z.bottom) / 2;
    const d = Math.abs(close - mid);
    if (d < bestDist) {
      bestDist = d;
      best = z;
    }
  }
  return best;
}

// ===========================================================================
// Order-block (fractal supply / demand) zones
// ===========================================================================

export interface RawZone {
  formedIndex: number;
  top: number;
  bottom: number;
  type: "demand" | "supply";
  /** First bar that traded back into the zone, or null if untested. */
  firstTestIndex: number | null;
}

export interface ZoneBar {
  demandPresent: boolean;
  supplyPresent: boolean;
  demandTest: boolean;
  supplyTest: boolean;
  nearestDemandTop: number | null;
  nearestDemandBottom: number | null;
  nearestSupplyTop: number | null;
  nearestSupplyBottom: number | null;
}

interface ActiveZone {
  top: number;
  bottom: number;
  zone: RawZone;
}

/**
 * Tight fractal supply/demand (order-block) zones. A confirmed swing low seeds
 * a demand zone; a swing high a supply zone. With `useBody` the zone is the
 * candle body (pure price, parity-stable); otherwise the wick is ATR-padded
 * (chart-only). A zone becomes "tested" the first bar price trades back into it.
 * Only the newest `maxZones` UNTESTED zones per side survive.
 */
export function swingZonePass(
  open: readonly number[],
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  atr14: readonly (number | null)[],
  cfg: SmcConfig,
  useBody: boolean,
): { zones: RawZone[]; perBar: ZoneBar[] } {
  const n = close.length;
  const zones: RawZone[] = [];
  const perBar: ZoneBar[] = new Array(n);
  const activeDemand: ActiveZone[] = [];
  const activeSupply: ActiveZone[] = [];

  for (let i = 0; i < n; i++) {
    const j = i - cfg.zonePivot;
    if (j >= 0) {
      const a = atr14[i] ?? 0;
      const o = open[j]!;
      const c = close[j]!;
      if (isPivotLow(low, j, cfg.zonePivot)) {
        const bottom = low[j]!;
        const top = useBody ? Math.max(o, c) : low[j]! + a * 0.15;
        const zone: RawZone = { formedIndex: j, top, bottom, type: "demand", firstTestIndex: null };
        zones.push(zone);
        activeDemand.push({ top, bottom, zone });
        if (activeDemand.length > cfg.maxZones) activeDemand.shift();
      }
      if (isPivotHigh(high, j, cfg.zonePivot)) {
        const top = high[j]!;
        const bottom = useBody ? Math.min(o, c) : high[j]! - a * 0.15;
        const zone: RawZone = { formedIndex: j, top, bottom, type: "supply", firstTestIndex: null };
        zones.push(zone);
        activeSupply.push({ top, bottom, zone });
        if (activeSupply.length > cfg.maxZones) activeSupply.shift();
      }
    }

    const lo = low[i]!;
    const hi = high[i]!;
    let demandTest = false;
    let supplyTest = false;
    for (let k = activeDemand.length - 1; k >= 0; k--) {
      const z = activeDemand[k]!;
      if (fin(lo) && lo <= z.top && lo >= z.bottom) {
        if (z.zone.firstTestIndex == null) z.zone.firstTestIndex = i;
        demandTest = true;
        activeDemand.splice(k, 1); // consumed: an untested zone fires its test once
      }
    }
    for (let k = activeSupply.length - 1; k >= 0; k--) {
      const z = activeSupply[k]!;
      if (fin(hi) && hi >= z.bottom && hi <= z.top) {
        if (z.zone.firstTestIndex == null) z.zone.firstTestIndex = i;
        supplyTest = true;
        activeSupply.splice(k, 1);
      }
    }

    const c = close[i]!;
    const nd = nearestZone(activeDemand, c);
    const nsup = nearestZone(activeSupply, c);
    perBar[i] = {
      demandPresent: activeDemand.length > 0,
      supplyPresent: activeSupply.length > 0,
      demandTest,
      supplyTest,
      nearestDemandTop: nd?.top ?? null,
      nearestDemandBottom: nd?.bottom ?? null,
      nearestSupplyTop: nsup?.top ?? null,
      nearestSupplyBottom: nsup?.bottom ?? null,
    };
  }

  return { zones, perBar };
}

// ===========================================================================
// Liquidity sweeps (stop-hunt of buy-side / sell-side liquidity)
// ===========================================================================

export interface SweepPoint {
  /** Took out a swing high then closed back below it ⇒ bearish stop-hunt. */
  buySide: boolean;
  /** Took out a swing low then closed back above it ⇒ bullish stop-hunt. */
  sellSide: boolean;
  /** The swept swing level, or null when no sweep this bar. */
  level: number | null;
}

/**
 * Buy-side liquidity sweep: the bar's high pierces the most recent CONFIRMED
 * swing high but the close falls back below it (a failed breakout / stop-hunt,
 * read as bearish). Symmetric sell-side sweep below a confirmed swing low is
 * read as bullish. The swept level is consumed so the same level only fires
 * once until a fresh swing forms. Causal: swings confirmed with `pivot` lag.
 */
export function sweepPass(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  pivot: number,
): SweepPoint[] {
  const n = close.length;
  const out: SweepPoint[] = new Array(n);
  let lastSH: number | null = null;
  let lastSL: number | null = null;
  for (let i = 0; i < n; i++) {
    const j = i - pivot;
    if (j >= 0) {
      if (isPivotHigh(high, j, pivot)) lastSH = high[j]!;
      if (isPivotLow(low, j, pivot)) lastSL = low[j]!;
    }
    const hi = high[i]!;
    const lo = low[i]!;
    const c = close[i]!;
    let buySide = false;
    let sellSide = false;
    let level: number | null = null;
    if (lastSH != null && fin(hi) && fin(c) && hi > lastSH && c < lastSH) {
      buySide = true;
      level = lastSH;
      lastSH = null;
    }
    if (lastSL != null && fin(lo) && fin(c) && lo < lastSL && c > lastSL) {
      sellSide = true;
      level = lastSL;
      lastSL = null;
    }
    out[i] = { buySide, sellSide, level };
  }
  return out;
}

// ===========================================================================
// Displacement candles
// ===========================================================================

export interface DisplacementBar {
  up: boolean;
  down: boolean;
}

/** A displacement candle has a body ≥ `mult`×ATR(14); direction from open→close. */
export function displacementPass(
  open: readonly number[],
  close: readonly number[],
  atr14: readonly (number | null)[],
  mult: number,
): DisplacementBar[] {
  const n = close.length;
  const out: DisplacementBar[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = open[i]!;
    const c = close[i]!;
    const a = atr14[i];
    let up = false;
    let down = false;
    if (fin(o) && fin(c) && fin(a) && a > 0) {
      const body = Math.abs(c - o);
      if (body >= mult * a) {
        if (c > o) up = true;
        else if (c < o) down = true;
      }
    }
    out[i] = { up, down };
  }
  return out;
}

// ===========================================================================
// Aggregate per-bar SMC series (what the evaluator reads)
// ===========================================================================

export interface SmcBar {
  structDir: -1 | 0 | 1;
  bosUp: boolean;
  bosDn: boolean;
  chochUp: boolean;
  chochDn: boolean;
  breakHigh: number | null;
  breakLow: number | null;

  fvgBullPresent: boolean;
  fvgBearPresent: boolean;
  fvgBullFormed: boolean;
  fvgBearFormed: boolean;
  fvgBullRetest: boolean;
  fvgBearRetest: boolean;
  fvgBullFilled: boolean;
  fvgBearFilled: boolean;
  nearestBullFvgTop: number | null;
  nearestBullFvgBottom: number | null;
  nearestBearFvgTop: number | null;
  nearestBearFvgBottom: number | null;

  demandPresent: boolean;
  supplyPresent: boolean;
  demandTest: boolean;
  supplyTest: boolean;
  nearestDemandTop: number | null;
  nearestDemandBottom: number | null;
  nearestSupplyTop: number | null;
  nearestSupplyBottom: number | null;

  sweepBuySide: boolean;
  sweepSellSide: boolean;
  sweptHigh: number | null;
  sweptLow: number | null;

  displacementUp: boolean;
  displacementDown: boolean;
}

export type SmcSeries = SmcBar[];

/**
 * Compute the full per-bar SMC series ONCE for a bar window. Order-block zones
 * use BODY bounds (pure price) so they are byte-identical across the live and
 * backtest surfaces given identical OHLC.
 */
export function computeSmcSeries(input: SmcInput, cfg: SmcConfig = DEFAULT_SMC_CONFIG): SmcSeries {
  const { open, high, low, close, atr14 } = input;
  const n = close.length;
  const struct = structurePass(high, low, close, cfg.structurePivot);
  const fvg = fvgPass(open, high, low, close, cfg);
  const zone = swingZonePass(open, high, low, close, atr14, cfg, true);
  const sweep = sweepPass(high, low, close, cfg.sweepPivot);
  const disp = displacementPass(open, close, atr14, cfg.displacementAtrMult);

  const out: SmcSeries = new Array(n);
  for (let i = 0; i < n; i++) {
    const s = struct[i]!;
    const f = fvg.perBar[i]!;
    const z = zone.perBar[i]!;
    const w = sweep[i]!;
    const d = disp[i]!;
    out[i] = {
      structDir: s.structDir,
      bosUp: s.bosUp,
      bosDn: s.bosDn,
      chochUp: s.chochUp,
      chochDn: s.chochDn,
      breakHigh: s.breakHigh,
      breakLow: s.breakLow,
      fvgBullPresent: f.bullPresent,
      fvgBearPresent: f.bearPresent,
      fvgBullFormed: f.bullFormed,
      fvgBearFormed: f.bearFormed,
      fvgBullRetest: f.bullRetest,
      fvgBearRetest: f.bearRetest,
      fvgBullFilled: f.bullFilled,
      fvgBearFilled: f.bearFilled,
      nearestBullFvgTop: f.nearestBullTop,
      nearestBullFvgBottom: f.nearestBullBottom,
      nearestBearFvgTop: f.nearestBearTop,
      nearestBearFvgBottom: f.nearestBearBottom,
      demandPresent: z.demandPresent,
      supplyPresent: z.supplyPresent,
      demandTest: z.demandTest,
      supplyTest: z.supplyTest,
      nearestDemandTop: z.nearestDemandTop,
      nearestDemandBottom: z.nearestDemandBottom,
      nearestSupplyTop: z.nearestSupplyTop,
      nearestSupplyBottom: z.nearestSupplyBottom,
      sweepBuySide: w.buySide,
      sweepSellSide: w.sellSide,
      sweptHigh: w.buySide ? w.level : null,
      sweptLow: w.sellSide ? w.level : null,
      displacementUp: d.up,
      displacementDown: d.down,
    };
  }
  return out;
}
