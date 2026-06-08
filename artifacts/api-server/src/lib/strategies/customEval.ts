/**
 * THE single shared custom-strategy evaluator.
 *
 * `evaluateSpecAt(series, i, spec)` is the only place a v2 spec is interpreted.
 * The live F&O engine and the Backtest Lab both build a `FeatureSeries` and call
 * this at the bar under test, so a saved strategy behaves identically on both
 * surfaces (locked by a parity test). It reads only indices ≤ i (no look-ahead),
 * and any null/NaN/unavailable input makes the dependent block FAIL — nothing is
 * ever assumed favourable or fabricated.
 *
 * Returns a structured result with per-block / per-layer reasoning so the UI can
 * explain exactly why a signal did or did not fire, and so the live engine can
 * surface honest drivers.
 */
import {
  slopeDir,
  crossedUpAt,
  crossedDownAt,
  withinPct,
  distancePct,
  lastConfirmedSwings,
  fibRetracePrice,
} from "@workspace/indicators";
import type {
  CustomStrategySpec,
  RuleBlock,
  RuleGroup,
  SideRules,
  ConditionOperand,
  ConditionOp,
  EmaKey,
} from "./customSpec";
import {
  type FeatureSeries,
  closeAt,
  atrAt,
  vwapAt,
  emaAt,
  featureAt,
  istMinuteAt,
} from "./customFeatures";

export interface SpecReason {
  layer: "market" | "setup" | "execution";
  label: string;
  detail: string;
  passed: boolean;
}

export interface SpecEvalResult {
  fired: boolean;
  /** The firing (or candidate) side. */
  side: "BULL" | "BEAR" | null;
  entry: number | null;
  stop: number | null;
  target1: number | null;
  target2: number | null;
  riskPerUnit: number | null;
  /** Reward of target-1 in R (== execution.target1R when fired). */
  rr1: number | null;
  confidence: number | null;
  reasons: SpecReason[];
  /** Why it did NOT fire (null when it fired). */
  rejectCode: string | null;
  /** Short labels of the rules that passed on the firing side (for drivers). */
  passedLabels: string[];
}

// --- small local readers ---------------------------------------------------

function num(arr: readonly number[], i: number): number | null {
  if (i < 0 || i >= arr.length) return null;
  const v = arr[i];
  return v != null && Number.isFinite(v) ? v : null;
}
function emaSeries(s: FeatureSeries, k: EmaKey): readonly (number | null)[] {
  return k === "ema9" ? s.ema9 : k === "ema20" ? s.ema20 : s.ema50;
}
function fmt(n: number | null): string {
  return n == null ? "n/a" : n.toFixed(2);
}
const OP_SYMBOL: Record<ConditionOp, string> = { gt: ">", lt: "<", gte: ">=", lte: "<=" };

function compareOp(l: number, op: ConditionOp, r: number): boolean {
  switch (op) {
    case "gt":
      return l > r;
    case "lt":
      return l < r;
    case "gte":
      return l >= r;
    case "lte":
      return l <= r;
  }
}
function readOperand(s: FeatureSeries, i: number, op: ConditionOperand): number | null {
  if (op.type === "value") return Number.isFinite(op.value) ? op.value : null;
  return featureAt(s, op.feature, i);
}

interface BlockResult {
  passed: boolean;
  label: string;
  detail: string;
}
function r(passed: boolean, label: string, detail: string): BlockResult {
  return { passed, label, detail };
}

// --- per-block evaluation --------------------------------------------------

function evalBlock(s: FeatureSeries, i: number, b: RuleBlock): BlockResult {
  switch (b.type) {
    case "price_vs_ema": {
      const c = closeAt(s, i);
      const e = emaAt(s, b.ema, i);
      const label = `price ${b.cmp} ${b.ema}`;
      if (c == null || e == null) return r(false, label, `close ${fmt(c)} / ${b.ema} ${fmt(e)} unavailable`);
      const ok = b.cmp === "above" ? c > e : c < e;
      return r(ok, label, `close ${fmt(c)} ${b.cmp} ${b.ema} ${fmt(e)}`);
    }
    case "ema_stack": {
      const a = emaAt(s, "ema9", i);
      const m = emaAt(s, "ema20", i);
      const z = emaAt(s, "ema50", i);
      const label = `EMA stack ${b.order}`;
      if (a == null || m == null || z == null)
        return r(false, label, `ema9 ${fmt(a)} / ema20 ${fmt(m)} / ema50 ${fmt(z)} unavailable`);
      const ok = b.order === "bull" ? a > m && m > z : a < m && m < z;
      return r(ok, label, `ema9 ${fmt(a)} / ema20 ${fmt(m)} / ema50 ${fmt(z)}`);
    }
    case "ema_cross": {
      const label = `${b.dir === "golden" ? "golden" : "death"} cross ${b.fast}/${b.slow}`;
      const fast = emaSeries(s, b.fast);
      const slow = emaSeries(s, b.slow);
      const ok = b.dir === "golden" ? crossedUpAt(fast, slow, i) : crossedDownAt(fast, slow, i);
      return r(ok, label, ok ? `${b.fast} crossed ${b.dir === "golden" ? "above" : "below"} ${b.slow} at this bar` : "no cross at this bar");
    }
    case "ema_slope": {
      const label = `${b.ema} ${b.dir} (${b.lookback})`;
      const dir = slopeDir(emaSeries(s, b.ema), i, b.lookback);
      if (dir == null) return r(false, label, "slope unavailable");
      return r(dir === b.dir, label, `${b.ema} slope ${dir}`);
    }
    case "ema_pullback": {
      const label = `pullback to ${b.ema} (${b.side})`;
      const e = emaAt(s, b.ema, i);
      const c = closeAt(s, i);
      const lo = num(s.low, i);
      const hi = num(s.high, i);
      if (e == null || c == null) return r(false, label, "close/ema unavailable");
      if (b.side === "bull") {
        const touched = withinPct(lo, e, b.tolPct);
        const ok = touched && c >= e;
        return r(ok, label, `low ${fmt(lo)} within ${b.tolPct}% of ${b.ema} ${fmt(e)} & close ${fmt(c)} >= ema`);
      }
      const touched = withinPct(hi, e, b.tolPct);
      const ok = touched && c <= e;
      return r(ok, label, `high ${fmt(hi)} within ${b.tolPct}% of ${b.ema} ${fmt(e)} & close ${fmt(c)} <= ema`);
    }
    case "ema_distance_max": {
      const label = `within ${b.maxPct}% of ${b.ema}`;
      const c = closeAt(s, i);
      const e = emaAt(s, b.ema, i);
      const d = distancePct(c, e);
      if (d == null) return r(false, label, "distance unavailable");
      return r(Math.abs(d) <= b.maxPct, label, `|close-${b.ema}| = ${Math.abs(d).toFixed(2)}%`);
    }
    case "price_vs_vwap": {
      const c = closeAt(s, i);
      const v = vwapAt(s, i);
      const label = `price ${b.cmp} VWAP`;
      if (c == null || v == null) return r(false, label, `close ${fmt(c)} / VWAP ${fmt(v)} unavailable`);
      const ok = b.cmp === "above" ? c > v : c < v;
      return r(ok, label, `close ${fmt(c)} ${b.cmp} VWAP ${fmt(v)}`);
    }
    case "vwap_cross": {
      const label = `VWAP ${b.dir}`;
      const ok = b.dir === "reclaim" ? crossedUpAt(s.close, s.vwap, i) : crossedDownAt(s.close, s.vwap, i);
      return r(ok, label, ok ? `price ${b.dir === "reclaim" ? "reclaimed" : "rejected"} VWAP at this bar` : "no VWAP cross at this bar");
    }
    case "vwap_distance_max": {
      const label = `within ${b.maxPct}% of VWAP`;
      const c = closeAt(s, i);
      const v = vwapAt(s, i);
      const d = distancePct(c, v);
      if (d == null) return r(false, label, "distance unavailable");
      return r(Math.abs(d) <= b.maxPct, label, `|close-VWAP| = ${Math.abs(d).toFixed(2)}%`);
    }
    case "fib_zone": {
      const label = `Fib zone ${b.lo}-${b.hi} (${b.side})`;
      const sw = lastConfirmedSwings(s.high, s.low, i, b.swingSpan);
      const c = closeAt(s, i);
      if (c == null) return r(false, label, "close unavailable");
      if (b.side === "bull") {
        // up-impulse: confirmed swing low BEFORE confirmed swing high
        if (sw.lowIdx == null || sw.highIdx == null || !(sw.lowIdx < sw.highIdx))
          return r(false, label, "no confirmed up-impulse swing");
        const pLo = fibRetracePrice(sw.highPrice, sw.lowPrice, b.lo, "up");
        const pHi = fibRetracePrice(sw.highPrice, sw.lowPrice, b.hi, "up");
        if (pLo == null || pHi == null) return r(false, label, "fib geometry unavailable");
        const top = Math.max(pLo, pHi);
        const bottom = Math.min(pLo, pHi);
        const ok = c >= bottom && c <= top;
        return r(ok, label, `close ${fmt(c)} vs zone [${fmt(bottom)}, ${fmt(top)}]`);
      }
      // down-impulse: confirmed swing high BEFORE confirmed swing low
      if (sw.highIdx == null || sw.lowIdx == null || !(sw.highIdx < sw.lowIdx))
        return r(false, label, "no confirmed down-impulse swing");
      const pLo = fibRetracePrice(sw.highPrice, sw.lowPrice, b.lo, "down");
      const pHi = fibRetracePrice(sw.highPrice, sw.lowPrice, b.hi, "down");
      if (pLo == null || pHi == null) return r(false, label, "fib geometry unavailable");
      const top = Math.max(pLo, pHi);
      const bottom = Math.min(pLo, pHi);
      const ok = c >= bottom && c <= top;
      return r(ok, label, `close ${fmt(c)} vs zone [${fmt(bottom)}, ${fmt(top)}]`);
    }
    case "compare": {
      const rightTxt = b.right.type === "feature" ? b.right.feature : String(b.right.value);
      const label = `${b.left} ${OP_SYMBOL[b.op]} ${rightTxt}`;
      const l = featureAt(s, b.left, i);
      const rv = readOperand(s, i, b.right);
      if (l == null || rv == null) return r(false, label, `${b.left} ${fmt(l)} ${OP_SYMBOL[b.op]} ${fmt(rv)} unavailable`);
      return r(compareOp(l, b.op, rv), label, `${b.left} ${fmt(l)} ${OP_SYMBOL[b.op]} ${fmt(rv)}`);
    }
  }
}

// --- group / side evaluation ----------------------------------------------

interface GroupEval {
  passed: boolean;
  empty: boolean;
  reasons: BlockResult[];
}

function evalGroup(s: FeatureSeries, i: number, g: RuleGroup): GroupEval {
  const reasons: BlockResult[] = [];
  const children: { passed: boolean; empty: boolean }[] = [];
  for (const b of g.blocks) {
    const br = evalBlock(s, i, b);
    reasons.push(br);
    children.push({ passed: br.passed, empty: false });
  }
  for (const sub of g.groups ?? []) {
    const sr = evalGroup(s, i, sub);
    reasons.push(...sr.reasons);
    children.push({ passed: sr.passed, empty: sr.empty });
  }
  const nonEmpty = children.filter((c) => !c.empty);
  if (nonEmpty.length === 0) return { passed: false, empty: true, reasons };
  const passed = g.logic === "AND" ? nonEmpty.every((c) => c.passed) : nonEmpty.some((c) => c.passed);
  return { passed, empty: false, reasons };
}

interface SideEval {
  enabled: boolean;
  passed: boolean;
  reasons: SpecReason[];
  passedLabels: string[];
}

function evalSide(s: FeatureSeries, i: number, side: SideRules): SideEval {
  const m = evalGroup(s, i, side.market);
  const st = evalGroup(s, i, side.setup);
  const enabled = !(m.empty && st.empty);
  const passed = enabled && (m.empty || m.passed) && (st.empty || st.passed);
  const reasons: SpecReason[] = [
    ...m.reasons.map((x) => ({ layer: "market" as const, label: x.label, detail: x.detail, passed: x.passed })),
    ...st.reasons.map((x) => ({ layer: "setup" as const, label: x.label, detail: x.detail, passed: x.passed })),
  ];
  const passedLabels = reasons.filter((x) => x.passed).map((x) => x.label);
  return { enabled, passed, reasons, passedLabels };
}

// --- geometry + execution --------------------------------------------------

function isFinitePos(n: number | null): n is number {
  return n != null && Number.isFinite(n) && n > 0;
}

function emptyResult(): SpecEvalResult {
  return {
    fired: false,
    side: null,
    entry: null,
    stop: null,
    target1: null,
    target2: null,
    riskPerUnit: null,
    rr1: null,
    confidence: null,
    reasons: [],
    rejectCode: null,
    passedLabels: [],
  };
}

/**
 * Evaluate a v2 spec at bar `i`. Honours the direction mode, both gating layers
 * per side, ATR/swing geometry, the session window, and min-RR / max-stop
 * sanity. Returns `fired:true` only when a side's rules pass AND honest geometry
 * is derivable AND every execution gate clears.
 */
export function evaluateSpecAt(s: FeatureSeries, i: number, spec: CustomStrategySpec): SpecEvalResult {
  const allowBull = spec.direction !== "PUT_ONLY";
  const allowBear = spec.direction !== "CALL_ONLY";

  const bullEval = allowBull ? evalSide(s, i, spec.bull) : null;
  const bearEval = allowBear && !(bullEval?.passed) ? evalSide(s, i, spec.bear) : null;

  // Pick the firing side (bull priority), else surface the best candidate's reasons.
  let side: "BULL" | "BEAR" | null = null;
  let chosen: SideEval | null = null;
  if (bullEval?.passed) {
    side = "BULL";
    chosen = bullEval;
  } else if (bearEval?.passed) {
    side = "BEAR";
    chosen = bearEval;
  }

  if (!side || !chosen) {
    const res = emptyResult();
    // Surface reasoning for the enabled side(s) so the UI can explain the miss.
    const candidate = bullEval?.enabled ? bullEval : bearEval?.enabled ? bearEval : null;
    res.reasons = candidate ? candidate.reasons : [];
    res.rejectCode = candidate ? "RULES_NOT_MET" : "NO_ENABLED_SIDE";
    return res;
  }

  const reasons = [...chosen.reasons];
  const sign = side === "BULL" ? 1 : -1;

  // Session window (execution gate).
  if (spec.execution.sessionWindow) {
    const min = istMinuteAt(s, i);
    const { startMin, endMin } = spec.execution.sessionWindow;
    if (min == null) {
      reasons.push({ layer: "execution", label: "session window", detail: "bar time unavailable", passed: false });
      return { ...emptyResult(), side, reasons, rejectCode: "NO_SESSION_DATA" };
    }
    const inWindow = min >= startMin && min <= endMin;
    reasons.push({
      layer: "execution",
      label: "session window",
      detail: `${min} in [${startMin}, ${endMin}]`,
      passed: inWindow,
    });
    if (!inWindow) return { ...emptyResult(), side, reasons, rejectCode: "OUTSIDE_SESSION" };
  }

  const entry = closeAt(s, i);
  const atr = atrAt(s, i);
  if (entry == null) {
    reasons.push({ layer: "execution", label: "entry price", detail: "close unavailable", passed: false });
    return { ...emptyResult(), side, reasons, rejectCode: "NO_ENTRY_PRICE" };
  }
  if (!isFinitePos(atr)) {
    reasons.push({ layer: "execution", label: "ATR", detail: "ATR unavailable / non-positive", passed: false });
    return { ...emptyResult(), side, entry, reasons, rejectCode: "NO_ATR" };
  }

  // Stop.
  let stop: number | null = null;
  if (spec.execution.stop.type === "atr") {
    stop = entry - sign * spec.execution.stop.atrMult * atr;
  } else {
    const sw = lastConfirmedSwings(s.high, s.low, i, spec.execution.stop.swingSpan);
    const anchor = side === "BULL" ? sw.lowPrice : sw.highPrice;
    if (anchor == null) {
      reasons.push({ layer: "execution", label: "swing stop", detail: "no confirmed swing for stop", passed: false });
      return { ...emptyResult(), side, entry, reasons, rejectCode: "NO_SWING_FOR_STOP" };
    }
    stop = anchor - sign * spec.execution.stop.bufferAtrMult * atr;
  }

  const risk = Math.abs(entry - stop);
  if (!isFinitePos(risk)) {
    reasons.push({ layer: "execution", label: "risk", detail: "non-positive stop distance", passed: false });
    return { ...emptyResult(), side, entry, stop, reasons, rejectCode: "BAD_GEOMETRY" };
  }

  // Max stop width sanity (mostly for swing stops).
  if (spec.execution.maxStopAtrMult != null && risk > spec.execution.maxStopAtrMult * atr) {
    reasons.push({
      layer: "execution",
      label: "max stop width",
      detail: `stop ${(risk / atr).toFixed(2)}xATR > ${spec.execution.maxStopAtrMult}xATR`,
      passed: false,
    });
    return { ...emptyResult(), side, entry, stop, riskPerUnit: risk, reasons, rejectCode: "STOP_TOO_WIDE" };
  }

  // Min reward (target-1 in R).
  const rr1 = spec.execution.target1R;
  if (spec.execution.minRR != null && rr1 < spec.execution.minRR) {
    reasons.push({
      layer: "execution",
      label: "min RR",
      detail: `target1 ${rr1}R < min ${spec.execution.minRR}R`,
      passed: false,
    });
    return { ...emptyResult(), side, entry, stop, riskPerUnit: risk, rr1, reasons, rejectCode: "BELOW_MIN_RR" };
  }

  const target1 = entry + sign * spec.execution.target1R * risk;
  const target2 = entry + sign * spec.execution.target2R * risk;
  reasons.push({
    layer: "execution",
    label: "geometry",
    detail: `entry ${fmt(entry)} stop ${fmt(stop)} t1 ${fmt(target1)} t2 ${fmt(target2)} (${(risk / atr).toFixed(2)}xATR)`,
    passed: true,
  });

  return {
    fired: true,
    side,
    entry,
    stop,
    target1,
    target2,
    riskPerUnit: risk,
    rr1,
    confidence: Math.max(0, Math.min(100, spec.baseConfidence)),
    reasons,
    rejectCode: null,
    passedLabels: chosen.passedLabels,
  };
}
