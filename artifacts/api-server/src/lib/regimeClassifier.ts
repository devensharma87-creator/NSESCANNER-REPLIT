/**
 * Phase-1 regime classifier.
 *
 * Returns one of TRENDING_BULL | TRENDING_BEAR | RANGING | VOLATILE | EXPIRY_DAY
 * for an index, given its 15-min bars + daily bars + the configured expiry
 * weekday. Purely a label — does NOT block any signal on its own.
 *
 * Rule order (first match wins):
 *   1. EXPIRY_DAY — IST date matches the index's configured weekly/monthly
 *      expiry day. Theta-burn dynamics dominate; trend setups behave
 *      differently than on any other day.
 *   2. VOLATILE — Bollinger-band-width (20,2) on 15m closes ≥ 2 % of price,
 *      OR ATR15 / spot ≥ 0.6 %. Wide whipsaw range; directional setups
 *      get whipped out by single bars.
 *   3. TRENDING_BULL / TRENDING_BEAR — ADX(14) on 15m ≥ 22 and EMA9/EMA21
 *      stack aligns with spot vs VWAP. ADX ≥ 22 is the classical
 *      "trend exists" floor; below that range-bound chop dominates.
 *   4. RANGING — fallback.
 *
 * Thresholds are calibrated for Indian index intraday (NIFTY/BANKNIFTY
 * scale). They live here as named constants so they can be tuned from
 * the empirical journal in Phase-3.
 */
import { adx, bbWidth } from "./indicators";

export type Regime =
  | "TRENDING_BULL"
  | "TRENDING_BEAR"
  | "RANGING"
  | "VOLATILE"
  | "EXPIRY_DAY";

export interface RegimeContext {
  /** Session 15-min bars (already filtered to today). */
  bars: { h: number[]; l: number[]; c: number[] };
  /** Latest spot. */
  spot: number;
  /** Latest VWAP value. */
  vwap: number;
  /** Latest EMA9 / EMA21 values. */
  ema9: number;
  ema21: number;
  /** Latest ATR15 (used for VOLATILE check). */
  atr15: number;
  /** Index expiry weekday (0=Sun … 4=Thu). NSE convention. */
  expiryWeekday: number;
  /** Index expiry cadence — `weekly` runs every week, `monthly` only on the
   *  last `expiryWeekday` of the month. */
  expiryCadence: "weekly" | "monthly";
  /** Optional override for "now" (testing). */
  now?: Date;
}

export interface RegimeResult {
  regime: Regime;
  /** Plain-English single-line explanation. UI surfaces this verbatim. */
  reason: string;
  /** Diagnostics — never shipped to the API directly, useful for logs. */
  diag: {
    adx14: number | null;
    bbWidthPct: number | null;
    atrPctOfSpot: number | null;
    isExpiryToday: boolean;
  };
}

const ADX_TREND_FLOOR = 22;
const BB_WIDTH_VOLATILE_PCT = 2.0;     // (upper - lower) / middle as %
const ATR_VOLATILE_FRAC_OF_SPOT = 0.006; // ATR15 / spot

function istDate(d: Date): { day: number; weekday: number; year: number; month: number; date: number } {
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return {
    day: ist.getUTCDay(),
    weekday: ist.getUTCDay(),
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth(),
    date: ist.getUTCDate(),
  };
}

function isMonthlyExpiryToday(weekday: number, now: Date): boolean {
  const ist = istDate(now);
  if (ist.weekday !== weekday) return false;
  // Last occurrence in month: walk forward 7 days; if still same month, not last.
  const next = new Date(Date.UTC(ist.year, ist.month, ist.date + 7));
  return next.getUTCMonth() !== ist.month;
}

export function classifyRegime(ctx: RegimeContext): RegimeResult {
  const now = ctx.now ?? new Date();

  // ---- 1. EXPIRY_DAY check ----
  const istWd = istDate(now).weekday;
  let isExpiryToday = false;
  if (ctx.expiryCadence === "weekly") {
    isExpiryToday = istWd === ctx.expiryWeekday;
  } else {
    isExpiryToday = isMonthlyExpiryToday(ctx.expiryWeekday, now);
  }

  // Compute diagnostics up-front so they appear in the result regardless
  // of which branch wins.
  const adxSeries = adx(ctx.bars.h, ctx.bars.l, ctx.bars.c, 14);
  const adx14 = lastNumeric(adxSeries);
  const bbwSeries = bbWidth(ctx.bars.c, 20, 2);
  const bbWidthPct = lastNumeric(bbwSeries);
  const atrPctOfSpot = ctx.spot > 0 ? ctx.atr15 / ctx.spot : null;

  const diag = { adx14, bbWidthPct, atrPctOfSpot, isExpiryToday };

  if (isExpiryToday) {
    return {
      regime: "EXPIRY_DAY",
      reason: `Expiry day for this index — theta-burn dynamics; directional setups behave differently than other sessions.`,
      diag,
    };
  }

  // ---- 2. VOLATILE check ----
  const tripBb = bbWidthPct != null && bbWidthPct >= BB_WIDTH_VOLATILE_PCT;
  const tripAtr = atrPctOfSpot != null && atrPctOfSpot >= ATR_VOLATILE_FRAC_OF_SPOT;
  if (tripBb || tripAtr) {
    const parts: string[] = [];
    if (tripBb) parts.push(`BB-width ${bbWidthPct!.toFixed(2)}% ≥ ${BB_WIDTH_VOLATILE_PCT}%`);
    if (tripAtr) parts.push(`ATR15 ${(atrPctOfSpot! * 100).toFixed(2)}% of spot ≥ ${(ATR_VOLATILE_FRAC_OF_SPOT * 100).toFixed(2)}%`);
    return {
      regime: "VOLATILE",
      reason: `Volatile range (${parts.join(", ")}) — directional setups can be whipped out by single bars.`,
      diag,
    };
  }

  // ---- 3. TRENDING_BULL / TRENDING_BEAR ----
  if (adx14 != null && adx14 >= ADX_TREND_FLOOR) {
    const aboveVwap = ctx.spot > ctx.vwap;
    const stackBull = ctx.ema9 > ctx.ema21 && ctx.spot > ctx.ema9;
    const stackBear = ctx.ema9 < ctx.ema21 && ctx.spot < ctx.ema9;
    if (aboveVwap && stackBull) {
      return {
        regime: "TRENDING_BULL",
        reason: `Trending bull — ADX(14) ${adx14.toFixed(1)} ≥ ${ADX_TREND_FLOOR}, spot above VWAP with EMA9>EMA21 stack.`,
        diag,
      };
    }
    if (!aboveVwap && stackBear) {
      return {
        regime: "TRENDING_BEAR",
        reason: `Trending bear — ADX(14) ${adx14.toFixed(1)} ≥ ${ADX_TREND_FLOOR}, spot below VWAP with EMA9<EMA21 stack.`,
        diag,
      };
    }
    // ADX is high but stack is mixed — still ranging in practice.
  }

  // ---- 4. RANGING fallback ----
  return {
    regime: "RANGING",
    reason: adx14 == null
      ? `Ranging — insufficient bars for ADX read; treating as range-bound.`
      : `Ranging — ADX(14) ${adx14.toFixed(1)} below trend floor (${ADX_TREND_FLOOR}); range-fade setups preferred over breakout chases.`,
    diag,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// BUG-73 regime hysteresis
//
// The raw classifier is stateless — a single borderline bar can flip
// RANGING ↔ TRENDING_BULL on the 15-min tick, which downstream causes
// signal-cohort thrash (setups get demoted → un-demoted → demoted). We
// require N consecutive same-regime reads before the label "sticks".
// Until confirmation, the previous stable label is retained. EXPIRY_DAY
// is date-driven (never oscillates within a session) and bypasses
// hysteresis — it applies immediately.
//
// State is in-memory, per index-symbol, and resets on process restart.
// The classifier is called from a single 30s trigger sweep so the
// buffer effectively tracks the last N sweep observations, ≈ N × 30s
// of confirmation delay (default 3 → 90 s). Cheap and deterministic;
// no DB write required.
// ─────────────────────────────────────────────────────────────────────────

/** Minimum consecutive same-label reads required to flip regimes. */
export const REGIME_HYSTERESIS_N = 3;

interface RegimeHysteresisState {
  /** Currently reported "sticky" regime for this index. */
  stable: Regime;
  /** Raw regime observed on the most recent read (may not yet be stable). */
  pendingRaw: Regime;
  /** Consecutive count of `pendingRaw` observations. */
  pendingRun: number;
  /** Last raw RegimeResult (kept for diag surfacing when we override). */
  lastResult: RegimeResult;
}

const regimeHistoryByIndex = new Map<string, RegimeHysteresisState>();

/** Stateful wrapper around `classifyRegime`. First call for an index
 *  primes the state and returns the raw label immediately (there's no
 *  prior label to protect). Subsequent calls apply N-bar hysteresis:
 *  a new label must be observed `hysteresisN` times in a row before
 *  it replaces the stable label. EXPIRY_DAY bypasses hysteresis. */
export function classifyRegimeWithHysteresis(
  indexSymbol: string,
  ctx: RegimeContext,
  opts?: { hysteresisN?: number },
): RegimeResult {
  const n = Math.max(1, opts?.hysteresisN ?? REGIME_HYSTERESIS_N);
  const raw = classifyRegime(ctx);
  const prev = regimeHistoryByIndex.get(indexSymbol);

  // First observation for this index — no prior label to protect.
  if (!prev) {
    regimeHistoryByIndex.set(indexSymbol, {
      stable: raw.regime,
      pendingRaw: raw.regime,
      pendingRun: 1,
      lastResult: raw,
    });
    return raw;
  }

  // EXPIRY_DAY is a hard calendar fact — never damp it.
  if (raw.regime === "EXPIRY_DAY") {
    regimeHistoryByIndex.set(indexSymbol, {
      stable: "EXPIRY_DAY",
      pendingRaw: "EXPIRY_DAY",
      pendingRun: n,
      lastResult: raw,
    });
    return raw;
  }

  // Same label as the current stable → confirms, reset pending.
  if (raw.regime === prev.stable) {
    regimeHistoryByIndex.set(indexSymbol, {
      stable: prev.stable,
      pendingRaw: prev.stable,
      pendingRun: n,
      lastResult: raw,
    });
    return raw;
  }

  // Different label from stable — accumulate the pending run.
  const nextRun = raw.regime === prev.pendingRaw ? prev.pendingRun + 1 : 1;
  if (nextRun >= n) {
    // Hysteresis satisfied — the new label wins.
    regimeHistoryByIndex.set(indexSymbol, {
      stable: raw.regime,
      pendingRaw: raw.regime,
      pendingRun: nextRun,
      lastResult: raw,
    });
    return raw;
  }

  // Pending; keep the current stable label but surface the pending
  // read in the reason string so it's visible in diagnostics.
  regimeHistoryByIndex.set(indexSymbol, {
    stable: prev.stable,
    pendingRaw: raw.regime,
    pendingRun: nextRun,
    lastResult: raw,
  });
  return {
    regime: prev.stable,
    reason:
      `${prev.lastResult.reason} ` +
      `[hysteresis: pending ${raw.regime} (${nextRun}/${n}); ` +
      `regime flip requires ${n} consecutive same-label reads]`,
    diag: raw.diag,
  };
}

/** Test-only helper — clears the per-index hysteresis state. */
export function __resetRegimeHysteresisForTests(indexSymbol?: string): void {
  if (indexSymbol) regimeHistoryByIndex.delete(indexSymbol);
  else regimeHistoryByIndex.clear();
}

function lastNumeric(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
}
