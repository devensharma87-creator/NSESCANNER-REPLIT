/**
 * Task #104 — REAL-DETECTOR REPLAY harness.
 *
 * Unlike `directional.ts` (a SIMPLIFIED regime+RSI proxy), this drives the
 * ACTUAL live engine `buildSignalsForIndex` bar-by-bar over the real 2-year
 * 15-min SPOT candles, with an injected `now` so all wall-clock time gates,
 * the regime classifier and session selection behave exactly as they do live.
 *
 * Two outputs:
 *   1. A SUPPRESS-REASON HISTOGRAM (which guard kills each detector, how often)
 *      — the data-driven root cause for "all 5 HC detectors report conditions
 *      not met". No fix is guessed; the histogram drives the fix.
 *   2. A FORWARD-TEST of every emitted DETECTOR signal (HC + demoted-BASELINE,
 *      excluding the always-on BASELINE_OUTLOOK) using the SAME modeled option
 *      proxy as `directional.ts` (ATM |delta| ≈ 0.5 on the real spot move) so
 *      BEFORE/AFTER numbers are produced on one consistent, honest yardstick.
 *
 * Honesty constraints (same as the rest of Backtest Lab):
 *   - Index candles carry NO volume. We NEVER fabricate volume; the engine's
 *     own volumeless degradation is exercised as-is.
 *   - Option P&L is a clearly-labeled directional DELTA PROXY, not money-accurate.
 *   - No look-ahead: daily series only ever contains COMPLETED prior days; an
 *     emitted plan is filled/managed only by bars at/after the signal bar; no
 *     position is held overnight (15:20 IST / session close force-exit).
 *   - gateCtx is undefined in replay — the live-only bias-flip / RS / win-rate
 *     gates need cross-index live state we don't reconstruct. They are
 *     demote-only safety gates, so omitting them makes the replay if anything
 *     MORE permissive (never hides a real suppression); this is stated in the
 *     report caveats.
 */

import { buildSignalsForIndex, OPTION_INDICES, type IndexCfg } from "../optionSignals";
import type { YahooChart } from "../yahoo";
import type { Candle } from "./directional";
import { IST_OFFSET_MS } from "./time";

const ATM_DELTA = 0.5; // matches directional.ts modeled proxy
const INTRA_WINDOW = 170; // ~7 sessions of 15-min bars: warms EMA21/RSI14/ATR14 + the 60m HTF stack
const FORCE_EXIT_MIN = 15 * 60 + 20; // 15:20 IST
const SESSION_OPEN_MIN = 9 * 60 + 15;
const DETECTOR_KEYS = new Set([
  "TREND_CONTINUATION",
  "VWAP_RECLAIM",
  "VOLUME_BREAKOUT",
  "EMA_PULLBACK",
  "MEAN_REVERSION",
]);

function istMinuteOfDay(t: Date): number {
  return t.getUTCHours() * 60 + t.getUTCMinutes();
}
function dayKey(t: Date): string {
  return `${t.getUTCFullYear()}-${t.getUTCMonth()}-${t.getUTCDate()}`;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Suppress-reason normalisation ─────────────────────────────────────────
// The emission loop pushes free-text "<detector>: <reason>" strings. Collapse
// the reason to a stable CATEGORY so we can count them.
export function categorizeSuppression(raw: string): { detector: string; category: string } {
  const idx = raw.indexOf(": ");
  const detector = idx > 0 ? raw.slice(0, idx) : "_global";
  const rest = idx > 0 ? raw.slice(idx + 2) : raw;
  let category: string;
  if (/^conditions not met/.test(rest)) category = "conditions_not_met";
  else if (/HC emission floor/.test(rest)) category = "below_hc_floor";
  else if (/post-clamp RR/.test(rest)) category = "post_clamp_rr_reject";
  else if (/opening-noise gate/.test(rest)) category = "opening_noise_gate";
  else if (/late-session VWAP-reclaim gate/.test(rest)) category = "vwap_reclaim_late_gate";
  else if (/late-session entry gate/.test(rest)) category = "late_entry_gate";
  else if (/^market_closed/.test(raw)) category = "market_closed";
  else if (/^partial_indicators/.test(raw)) category = "partial_indicators";
  else if (/^vol_regime/.test(raw)) category = "vol_regime_haircut";
  else if (/bias[- ]flip/i.test(rest)) category = "bias_flip";
  else if (/error$/.test(rest)) category = "detector_error";
  else category = "other";
  return { detector, category };
}

export type ExitReason = "STOP" | "TARGET" | "TIME_EXIT_1520" | "EOD" | "NO_FILL";

export interface ForwardTrade {
  index: string;
  setupKey: string;
  tier: "HIGH_CONVICTION" | "BASELINE";
  direction: "BULLISH" | "BEARISH";
  confidence: number;
  regime: string;
  signalAtIso: string;
  entryAtIso: string | null;
  exitAtIso: string | null;
  entryLevel: number;
  stopLevel: number;
  targetLevel: number;
  plannedRR: number | null;
  /** Spot (signal-bar close) at emission — for entry-distance diagnostics. */
  signalSpot: number;
  entrySpot: number | null;
  exitSpot: number | null;
  exitReason: ExitReason;
  /** Modeled per-unit option points = ATM_DELTA · sign · (exit − entry). null on NO_FILL. */
  proxyPoints: number | null;
}

export interface SuppressBucket {
  detector: string;
  category: string;
  count: number;
}

export interface ReplayResult {
  index: string;
  barsEvaluated: number;
  detectorSignalsEmitted: number; // HC + demoted BASELINE detector signals (excl. baseline outlook)
  hcEmitted: number;
  baselineOutlookEmitted: number;
  suppress: SuppressBucket[];
  trades: ForwardTrade[];
}

// ── Daily resample (no look-ahead): one OHLC bar per IST trading day ───────
interface DailyBar { key: string; o: number; h: number; l: number; c: number; tsSec: number }

function resampleDaily(candles: Candle[]): DailyBar[] {
  const out: DailyBar[] = [];
  let cur: DailyBar | null = null;
  for (const cd of candles) {
    const k = dayKey(cd.t);
    if (!cur || cur.key !== k) {
      if (cur) out.push(cur);
      cur = { key: k, o: cd.o, h: cd.h, l: cd.l, c: cd.c, tsSec: Math.floor(cd.t.getTime() / 1000) - IST_OFFSET_MS / 1000 };
    } else {
      cur.h = Math.max(cur.h, cd.h);
      cur.l = Math.min(cur.l, cd.l);
      cur.c = cd.c;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function dailyChartUpTo(days: DailyBar[], completedCount: number, symbol: string): YahooChart {
  const slice = days.slice(0, completedCount);
  return {
    symbol,
    meta: { symbol } as YahooChart["meta"],
    timestamps: slice.map((d) => d.tsSec),
    open: slice.map((d) => d.o),
    high: slice.map((d) => d.h),
    low: slice.map((d) => d.l),
    close: slice.map((d) => d.c),
    volume: slice.map(() => 0),
  };
}

function intraChart(candles: Candle[], lo: number, hi: number, symbol: string): YahooChart {
  const ts: number[] = [];
  const open: number[] = [];
  const high: number[] = [];
  const low: number[] = [];
  const close: number[] = [];
  const volume: number[] = [];
  for (let i = lo; i <= hi; i++) {
    const cd = candles[i]!;
    ts.push(Math.floor(cd.t.getTime() / 1000) - IST_OFFSET_MS / 1000);
    open.push(cd.o);
    high.push(cd.h);
    low.push(cd.l);
    close.push(cd.c);
    volume.push(0);
  }
  return { symbol, meta: { symbol } as YahooChart["meta"], timestamps: ts, open, high, low, close, volume };
}

/**
 * Forward-simulate one emitted plan from `signalIdx` over same-session bars.
 * Entry: marketable-at-signal if spot already beyond trigger, else first later
 * bar whose CLOSE crosses the trigger in-direction (filled at the trigger).
 * Manage: intrabar STOP/TARGET (stop checked first), force-exit at 15:20 / EOD.
 * Returns the fill+exit, or NO_FILL when the trigger never trips before close.
 */
function forwardTest(
  candles: Candle[],
  signalIdx: number,
  direction: "BULLISH" | "BEARISH",
  entryLevel: number,
  stopLevel: number,
  targetLevel: number,
): { entryIdx: number | null; entryPrice: number | null; exitIdx: number | null; exitSpot: number | null; reason: ExitReason } {
  const sigDay = dayKey(candles[signalIdx]!.t);
  const bull = direction === "BULLISH";
  const NO_FILL = { entryIdx: null, entryPrice: null, exitIdx: null, exitSpot: null, reason: "NO_FILL" as const };

  // ── Honest entry fill (mirrors the live PENDING→TRIGGERED lifecycle) ─────
  // The live lifecycle (optionSignalLifecycle.evaluateTransition) triggers when
  // a bar's HIGH/LOW TOUCHES the entry level in the trade direction
  // (BULLISH: high ≥ entryLevel; BEARISH: low ≤ entryLevel) — NOT a close-cross.
  // If spot is ALREADY past the trigger at signal time the very next bar
  // satisfies the condition and it fills immediately. The fill PRICE is the
  // plan's entryLevel, because the live book LOCKS the option premium at the
  // plan entry (the locked stop/target premiums are entryLevel-relative); P&L
  // is therefore measured in spot-proxy from entryLevel to the exit level.
  // No fill on the signal bar itself (no look-ahead) and none after 15:20.
  const sig = candles[signalIdx]!;
  if (istMinuteOfDay(sig.t) >= FORCE_EXIT_MIN) return NO_FILL;
  let entryIdx: number | null = null;
  for (let j = signalIdx + 1; j < candles.length; j++) {
    const cd = candles[j]!;
    if (dayKey(cd.t) !== sigDay) break;
    if (istMinuteOfDay(cd.t) >= FORCE_EXIT_MIN) break;
    if (bull ? cd.h >= entryLevel : cd.l <= entryLevel) { entryIdx = j; break; }
  }
  if (entryIdx == null) return NO_FILL;
  const entryPrice = entryLevel;

  // ── Manage from the TRIGGERING bar onward ──────────────────────────────
  // The live lifecycle checks stop/target on the SAME snapshot that triggers,
  // so a bar that triggers can also exit on the same bar. (Intrabar
  // STOP-then-TARGET order within one OHLC bar is unknowable, so stop is
  // checked FIRST — the conservative assumption, matching live ordering.)
  for (let j = entryIdx; j < candles.length; j++) {
    const cd = candles[j]!;
    if (dayKey(cd.t) !== sigDay) {
      const prev = candles[j - 1]!;
      return { entryIdx, entryPrice, exitIdx: j - 1, exitSpot: prev.c, reason: "EOD" };
    }
    if (bull) {
      if (cd.l <= stopLevel) return { entryIdx, entryPrice, exitIdx: j, exitSpot: stopLevel, reason: "STOP" };
      if (cd.h >= targetLevel) return { entryIdx, entryPrice, exitIdx: j, exitSpot: targetLevel, reason: "TARGET" };
    } else {
      if (cd.h >= stopLevel) return { entryIdx, entryPrice, exitIdx: j, exitSpot: stopLevel, reason: "STOP" };
      if (cd.l <= targetLevel) return { entryIdx, entryPrice, exitIdx: j, exitSpot: targetLevel, reason: "TARGET" };
    }
    if (istMinuteOfDay(cd.t) >= FORCE_EXIT_MIN) {
      return { entryIdx, entryPrice, exitIdx: j, exitSpot: cd.c, reason: "TIME_EXIT_1520" };
    }
  }
  const last = candles[candles.length - 1]!;
  return { entryIdx, entryPrice, exitIdx: candles.length - 1, exitSpot: last.c, reason: "EOD" };
}

/**
 * Replay the live engine over one index's candles. `cfg` MUST match the index.
 */
export function replayIndex(candles: Candle[], cfg: IndexCfg): ReplayResult {
  const days = resampleDaily(candles);
  // Map each dayKey → number of COMPLETED days strictly before it.
  const completedBefore = new Map<string, number>();
  for (let i = 0; i < days.length; i++) completedBefore.set(days[i]!.key, i);
  // Cache one daily chart per day (changes only when the day rolls).
  const dailyCache = new Map<string, YahooChart>();

  const suppressCounts = new Map<string, number>(); // "detector|category" → n
  const trades: ForwardTrade[] = [];
  let detectorSignalsEmitted = 0;
  let hcEmitted = 0;
  let baselineOutlookEmitted = 0;
  let barsEvaluated = 0;

  // One position per index at a time (mirrors live single-lane behaviour and
  // avoids double-counting overlapping windows).
  let openUntilIdx = -1;

  for (let i = INTRA_WINDOW; i < candles.length; i++) {
    const cd = candles[i]!;
    const minute = istMinuteOfDay(cd.t);
    if (minute < SESSION_OPEN_MIN || minute > FORCE_EXIT_MIN) continue; // session bars only
    const k = dayKey(cd.t);
    const completed = completedBefore.get(k) ?? 0;
    if (completed < 50) continue; // need ≥50 daily bars for EMA50 / fullIndicators

    let daily = dailyCache.get(k);
    if (!daily) { daily = dailyChartUpTo(days, completed, cfg.symbol); dailyCache.set(k, daily); }
    const lo = Math.max(0, i - INTRA_WINDOW + 1);
    const intra = intraChart(candles, lo, i, cfg.symbol);
    const now = new Date(cd.t.getTime() - IST_OFFSET_MS);

    barsEvaluated++;
    const res = buildSignalsForIndex(cfg, intra, daily, undefined, now);

    for (const s of res.suppressed) {
      const { detector, category } = categorizeSuppression(s);
      const key = `${detector}|${category}`;
      suppressCounts.set(key, (suppressCounts.get(key) ?? 0) + 1);
    }

    // Detector signals only (exclude always-on BASELINE outlook).
    const detSignals = res.signals.filter((s) => s.setupKey != null && DETECTOR_KEYS.has(s.setupKey));
    baselineOutlookEmitted += res.signals.length - detSignals.length;
    for (const s of res.signals) if (s.tier === "HIGH_CONVICTION") hcEmitted++;
    if (detSignals.length === 0) continue;
    detectorSignalsEmitted += detSignals.length;

    if (i <= openUntilIdx) continue; // a prior trade is still open — skip new entries

    // Pick the highest-confidence detector signal at this bar.
    const best = detSignals.reduce((a, b) => (b.confidence > a.confidence ? b : a));
    if (best.bias !== "BULLISH" && best.bias !== "BEARISH") continue; // detectors are never NEUTRAL
    const bias: "BULLISH" | "BEARISH" = best.bias;
    const entryLevel = best.leg.entry;
    const stopLevel = best.leg.stopLoss;
    const targetLevel = best.leg.target1 ?? best.leg.entry;
    if (entryLevel == null || stopLevel == null) continue;

    const sim = forwardTest(
      candles, i, bias, entryLevel, stopLevel, targetLevel,
    );
    const sign = bias === "BULLISH" ? 1 : -1;
    const entrySpot = sim.entryPrice;
    const proxyPoints =
      sim.exitSpot != null && entrySpot != null
        ? round2(ATM_DELTA * sign * (sim.exitSpot - entrySpot))
        : null;
    const risk = Math.abs(entryLevel - stopLevel);
    trades.push({
      index: cfg.symbol,
      setupKey: best.setupKey ?? "UNKNOWN",
      tier: best.tier as "HIGH_CONVICTION" | "BASELINE",
      direction: bias,
      confidence: best.confidence,
      regime: best.regime ?? "UNKNOWN",
      signalAtIso: cd.t.toISOString(),
      entryAtIso: sim.entryIdx != null ? candles[sim.entryIdx]!.t.toISOString() : null,
      exitAtIso: sim.exitIdx != null ? candles[sim.exitIdx]!.t.toISOString() : null,
      entryLevel: round2(entryLevel),
      stopLevel: round2(stopLevel),
      targetLevel: round2(targetLevel),
      plannedRR: risk > 0 ? round2(Math.abs(targetLevel - entryLevel) / risk) : null,
      signalSpot: round2(cd.c),
      entrySpot: entrySpot != null ? round2(entrySpot) : null,
      exitSpot: sim.exitSpot != null ? round2(sim.exitSpot) : null,
      exitReason: sim.reason,
      proxyPoints,
    });
    if (sim.exitIdx != null && sim.reason !== "NO_FILL") openUntilIdx = sim.exitIdx;
  }

  const suppress: SuppressBucket[] = [...suppressCounts.entries()]
    .map(([key, count]) => {
      const [detector, category] = key.split("|");
      return { detector: detector!, category: category!, count };
    })
    .sort((a, b) => b.count - a.count);

  return {
    index: cfg.symbol,
    barsEvaluated,
    detectorSignalsEmitted,
    hcEmitted,
    baselineOutlookEmitted,
    suppress,
    trades,
  };
}

// ── Metrics ───────────────────────────────────────────────────────────────
export interface TradeMetrics {
  scope: string;
  signals: number;
  filled: number;
  noFill: number;
  winRatePct: number | null;
  stopOutPct: number | null;
  targetHitPct: number | null;
  timeExitPct: number | null;
  expectancyPts: number | null; // mean proxyPoints over filled trades
  profitFactor: number | null;
  avgPlannedRR: number | null;
  maxDrawdownPts: number | null;
}

export function computeMetrics(scope: string, trades: ForwardTrade[]): TradeMetrics {
  const filled = trades.filter((t) => t.proxyPoints != null);
  const noFill = trades.length - filled.length;
  if (filled.length === 0) {
    return {
      scope, signals: trades.length, filled: 0, noFill,
      winRatePct: null, stopOutPct: null, targetHitPct: null, timeExitPct: null,
      expectancyPts: null, profitFactor: null,
      avgPlannedRR: avg(trades.map((t) => t.plannedRR).filter((x): x is number => x != null)),
      maxDrawdownPts: null,
    };
  }
  const pts = filled.map((t) => t.proxyPoints!);
  const wins = pts.filter((p) => p > 0);
  const losses = pts.filter((p) => p <= 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const p of pts) {
    equity += p;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }
  const stopOut = filled.filter((t) => t.exitReason === "STOP").length;
  const target = filled.filter((t) => t.exitReason === "TARGET").length;
  const timeExit = filled.filter((t) => t.exitReason === "TIME_EXIT_1520" || t.exitReason === "EOD").length;
  return {
    scope,
    signals: trades.length,
    filled: filled.length,
    noFill,
    winRatePct: round2((wins.length / filled.length) * 100),
    stopOutPct: round2((stopOut / filled.length) * 100),
    targetHitPct: round2((target / filled.length) * 100),
    timeExitPct: round2((timeExit / filled.length) * 100),
    expectancyPts: round2(pts.reduce((a, b) => a + b, 0) / filled.length),
    profitFactor: grossLoss > 0 ? round2(grossWin / grossLoss) : (grossWin > 0 ? Infinity : 0),
    avgPlannedRR: avg(filled.map((t) => t.plannedRR).filter((x): x is number => x != null)),
    maxDrawdownPts: round2(maxDd),
  };
}

function avg(xs: number[]): number | null {
  return xs.length > 0 ? round2(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
}
