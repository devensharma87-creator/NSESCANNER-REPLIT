import type {
  EntryPlan,
  HorizonBias,
  HorizonName,
  Indicators,
  PriceZone,
  Quote,
  Recommendation,
  RecommendationEntryQuality,
  SetupStatus,
  Signal,
  SignalReason,
} from "@workspace/api-zod";

export interface ScoreInput {
  quote: Quote;
  indicators: Indicators;
  closes: number[];
  ema9Series: (number | null)[];
  ema21Series: (number | null)[];
  ema20Series: (number | null)[];
  ema50Series: (number | null)[];
  rsiSeries: (number | null)[];
  macdHistSeries: (number | null)[];
}

function lastNonNull(series: (number | null)[]): number | null {
  for (let i = series.length - 1; i >= 0; i--) if (series[i] != null) return series[i] as number;
  return null;
}

function valueAtOffset(series: (number | null)[], offset: number): number | null {
  const idx = series.length - 1 - offset;
  if (idx < 0) return null;
  const v = series[idx];
  return v == null ? null : (v as number);
}

// Internal-only: same shape as the API SignalReason, but tagged with the
// horizon(s) the rule informs. We strip `horizons` before returning the
// `Recommendation.reasons` array to keep the public schema unchanged.
type HorizonTag = "intraday" | "swing" | "longTerm";
type TaggedReason = SignalReason & { horizons: HorizonTag[] };

export function buildRecommendation(input: ScoreInput): Recommendation {
  const { quote, indicators, closes, ema9Series, ema21Series, ema20Series, ema50Series, rsiSeries, macdHistSeries } = input;
  const reasons: TaggedReason[] = [];
  let score = 0;

  const price = quote.price;
  const ema20 = indicators.ema20;
  const ema50 = indicators.ema50;
  const ema100 = indicators.ema100;
  const ema200 = indicators.ema200;
  const vwap = indicators.vwap ?? null;
  const rsi = indicators.rsi14;
  const adx = indicators.adx14 ?? null;
  const volRatio = indicators.volumeRatio ?? null;
  const deliveryPct = indicators.deliveryPct ?? null;
  const support = indicators.supportLevel ?? null;
  const resistance = indicators.resistanceLevel ?? null;
  const poc = indicators.pointOfControl;
  const vaHigh = indicators.valueAreaHigh;
  const vaLow = indicators.valueAreaLow;
  const macdHist = lastNonNull(macdHistSeries);
  const macdHistPrev = valueAtOffset(macdHistSeries, 2);
  const todayHigh = quote.high;
  const todayLow = quote.low;

  // Helper: push a reason tagged with the horizons it informs. Score
  // is mutated by the caller; the helper only handles the reasons array.
  const push = (r: SignalReason, horizons: HorizonTag[]) => reasons.push({ ...r, horizons });

  // ---------- Existing rule set (logic preserved verbatim, only horizon
  // tags + helper-call wrapping added) ----------

  // 1. Long-term EMA 50/100/200 trend (weight 18)
  if (ema50 != null && ema100 != null && ema200 != null) {
    if (price > ema50 && ema50 > ema100 && ema100 > ema200) {
      score += 18;
      push({ label: "Long-term uptrend (50>100>200)", detail: `Stacked EMAs confirm a primary uptrend.`, weight: 18, bullish: true }, ["longTerm", "swing"]);
    } else if (price < ema50 && ema50 < ema100 && ema100 < ema200) {
      score -= 18;
      push({ label: "Long-term downtrend (50<100<200)", detail: `Stacked EMAs confirm a primary downtrend.`, weight: 18, bullish: false }, ["longTerm", "swing"]);
    } else {
      const bullish = price > ema200;
      const w = 5;
      score += bullish ? w : -w;
      push({ label: bullish ? "Above 200 EMA" : "Below 200 EMA", detail: `Price ${bullish ? "above" : "below"} 200 EMA ₹${ema200.toFixed(2)}.`, weight: w, bullish }, ["longTerm"]);
    }
  }

  // 2. Short-term EMA 20/50 stack (weight 12)
  if (ema20 != null && ema50 != null) {
    if (price > ema20 && ema20 > ema50) {
      score += 12;
      push({ label: "Short-term EMA bullish", detail: `Price > EMA20 > EMA50 — momentum supportive.`, weight: 12, bullish: true }, ["swing"]);
    } else if (price < ema20 && ema20 < ema50) {
      score -= 12;
      push({ label: "Short-term EMA bearish", detail: `Price < EMA20 < EMA50.`, weight: 12, bullish: false }, ["swing"]);
    }
  }

  // EMA cross (golden/death) detection on 20/50 over last 5 bars
  const e20Now = lastNonNull(ema20Series);
  const e20Prev = valueAtOffset(ema20Series, 5);
  const e50Now = lastNonNull(ema50Series);
  const e50Prev = valueAtOffset(ema50Series, 5);
  if (e20Now != null && e50Now != null && e20Prev != null && e50Prev != null) {
    if (e20Prev <= e50Prev && e20Now > e50Now) { score += 8; push({ label: "Recent golden cross", detail: "EMA20 crossed above EMA50 in last 5 sessions.", weight: 8, bullish: true }, ["swing", "longTerm"]); }
    else if (e20Prev >= e50Prev && e20Now < e50Now) { score -= 8; push({ label: "Recent death cross", detail: "EMA20 crossed below EMA50 in last 5 sessions.", weight: 8, bullish: false }, ["swing", "longTerm"]); }
  }

  // 3. EMA 9/21 fast trigger (weight 8)
  const e9 = lastNonNull(ema9Series);
  const e21 = lastNonNull(ema21Series);
  if (e9 != null && e21 != null) {
    if (e9 > e21 && price > e9) { score += 8; push({ label: "Fast EMA bullish", detail: `EMA9 > EMA21 with price above — short-term momentum up.`, weight: 8, bullish: true }, ["intraday", "swing"]); }
    else if (e9 < e21 && price < e9) { score -= 8; push({ label: "Fast EMA bearish", detail: `EMA9 < EMA21 with price below.`, weight: 8, bullish: false }, ["intraday", "swing"]); }
  }

  // 4. VWAP (weight 10)
  if (vwap != null) {
    if (price > vwap * 1.001) { score += 10; push({ label: "Above VWAP", detail: `Price ₹${price.toFixed(2)} > VWAP ₹${vwap.toFixed(2)}.`, weight: 10, bullish: true }, ["intraday"]); }
    else if (price < vwap * 0.999) { score -= 10; push({ label: "Below VWAP", detail: `Price ₹${price.toFixed(2)} < VWAP ₹${vwap.toFixed(2)}.`, weight: 10, bullish: false }, ["intraday"]); }
  }

  // 5. ADX trend strength gate (weight 6)
  if (adx != null) {
    if (adx >= 25) {
      const w = 6;
      const bullish = ema20 != null ? price > ema20 : quote.changePercent > 0;
      score += bullish ? w : -w;
      push({ label: `Strong trend (ADX ${adx.toFixed(0)})`, detail: `ADX ≥ 25 — current move has conviction.`, weight: w, bullish }, ["intraday", "swing"]);
    } else if (adx < 18) {
      push({ label: `Choppy regime (ADX ${adx.toFixed(0)})`, detail: `ADX < 18 — range-bound; signals less reliable.`, weight: 3, bullish: false }, ["intraday", "swing"]);
    }
  }

  // 6. MACD histogram (weight 8)
  if (macdHist != null && macdHistPrev != null) {
    if (macdHist > 0 && macdHist > macdHistPrev) { score += 8; push({ label: "MACD bullish & rising", detail: `Histogram positive and expanding.`, weight: 8, bullish: true }, ["swing"]); }
    else if (macdHist < 0 && macdHist < macdHistPrev) { score -= 8; push({ label: "MACD bearish & falling", detail: `Histogram negative and expanding.`, weight: 8, bullish: false }, ["swing"]); }
  }

  // 7. RSI state (weight 10)
  if (rsi != null) {
    if (rsi >= 55 && rsi <= 70) { score += 10; push({ label: "RSI in bullish zone", detail: `RSI(14) ${rsi.toFixed(1)}.`, weight: 10, bullish: true }, ["swing", "intraday"]); }
    else if (rsi > 70) { score -= 6; push({ label: "RSI overbought", detail: `RSI(14) ${rsi.toFixed(1)} — pullback risk.`, weight: 6, bullish: false }, ["swing", "intraday"]); }
    else if (rsi >= 45 && rsi < 55) { push({ label: "RSI neutral", detail: `RSI(14) ${rsi.toFixed(1)}.`, weight: 2, bullish: rsi >= 50 }, ["swing"]); }
    else if (rsi < 30) { score += 8; push({ label: "RSI oversold", detail: `RSI(14) ${rsi.toFixed(1)} — bounce zone.`, weight: 8, bullish: true }, ["swing", "intraday"]); }
    else { score -= 8; push({ label: "RSI weak", detail: `RSI(14) ${rsi.toFixed(1)}.`, weight: 8, bullish: false }, ["swing"]); }
  }

  // RSI divergence
  const closeNow = closes[closes.length - 1];
  const closePrev10 = closes.length > 10 ? closes[closes.length - 11]! : null;
  const rsiNow = lastNonNull(rsiSeries);
  const rsiPrev10 = valueAtOffset(rsiSeries, 10);
  if (closeNow != null && closePrev10 != null && rsiNow != null && rsiPrev10 != null) {
    if (closeNow > closePrev10 * 1.02 && rsiNow < rsiPrev10 - 3) { score -= 6; push({ label: "Bearish RSI divergence", detail: "Higher high in price, lower high in RSI.", weight: 6, bullish: false }, ["swing"]); }
    else if (closeNow < closePrev10 * 0.98 && rsiNow > rsiPrev10 + 3) { score += 6; push({ label: "Bullish RSI divergence", detail: "Lower low in price, higher low in RSI.", weight: 6, bullish: true }, ["swing"]); }
  }

  // 8. Price action vs swing levels (weight 12)
  if (support != null && resistance != null && resistance > 0 && support > 0) {
    const distFromRes = (resistance - price) / resistance;
    const distFromSup = (price - support) / support;
    if (price >= resistance * 0.999 && quote.changePercent > 0.5) { score += 12; push({ label: "Breakout above resistance", detail: `Clearing swing high ₹${resistance.toFixed(2)}.`, weight: 12, bullish: true }, ["swing", "intraday"]); }
    else if (price <= support * 1.001 && quote.changePercent < -0.5) { score -= 12; push({ label: "Breakdown below support", detail: `Losing swing low ₹${support.toFixed(2)}.`, weight: 12, bullish: false }, ["swing", "intraday"]); }
    else if (distFromSup < 0.03) { score += 5; push({ label: "Trading near support", detail: `Within 3% of ₹${support.toFixed(2)}.`, weight: 5, bullish: true }, ["swing"]); }
    else if (distFromRes < 0.03) { score -= 5; push({ label: "Trading near resistance", detail: `Within 3% of ₹${resistance.toFixed(2)}.`, weight: 5, bullish: false }, ["swing"]); }
  }

  // 52-week proximity
  const yrHi = quote.fiftyTwoWeekHigh;
  const yrLo = quote.fiftyTwoWeekLow;
  if (yrHi && price >= yrHi * 0.98) { score += 5; push({ label: "Near 52-week high", detail: `Price within 2% of 52W high ₹${yrHi.toFixed(2)}.`, weight: 5, bullish: true }, ["longTerm"]); }
  else if (yrLo && price <= yrLo * 1.02) { score -= 5; push({ label: "Near 52-week low", detail: `Price within 2% of 52W low ₹${yrLo.toFixed(2)}.`, weight: 5, bullish: false }, ["longTerm"]); }

  // Today's candle direction
  if (quote.changePercent > 1.5) { score += 4; push({ label: "Strong bullish candle today", detail: `Up ${quote.changePercent.toFixed(2)}% intraday.`, weight: 4, bullish: true }, ["intraday"]); }
  else if (quote.changePercent < -1.5) { score -= 4; push({ label: "Strong bearish candle today", detail: `Down ${quote.changePercent.toFixed(2)}% intraday.`, weight: 4, bullish: false }, ["intraday"]); }

  // 9. Volume (weight 10)
  if (volRatio != null) {
    if (volRatio >= 1.5 && quote.changePercent > 0) { score += 10; push({ label: "Volume surge on advance", detail: `Volume ${volRatio.toFixed(2)}× the 20-day average on a positive close.`, weight: 10, bullish: true }, ["intraday", "swing"]); }
    else if (volRatio >= 1.5 && quote.changePercent < 0) { score -= 10; push({ label: "Distribution on decline", detail: `Volume ${volRatio.toFixed(2)}× the 20-day average on a negative close.`, weight: 10, bullish: false }, ["intraday", "swing"]); }
    else if (volRatio < 0.6) { push({ label: "Low volume", detail: `Volume only ${volRatio.toFixed(2)}× average.`, weight: 2, bullish: false }, ["intraday"]); }
  }

  // 10. Delivery % (weight 8)
  if (deliveryPct != null) {
    if (deliveryPct >= 60 && quote.changePercent > 0) { score += 8; push({ label: "High delivery on advance", detail: `Delivery ${deliveryPct.toFixed(1)}% — investor accumulation.`, weight: 8, bullish: true }, ["swing", "longTerm"]); }
    else if (deliveryPct >= 60 && quote.changePercent < 0) { score -= 8; push({ label: "High delivery on decline", detail: `Delivery ${deliveryPct.toFixed(1)}% on a down day — genuine selling.`, weight: 8, bullish: false }, ["swing", "longTerm"]); }
  }

  // 11. Volume profile (weight 8)
  if (poc != null && vaHigh != null && vaLow != null) {
    if (price > vaHigh) { score += 8; push({ label: "Trading above value area", detail: `Price > VAH ₹${vaHigh.toFixed(2)}.`, weight: 8, bullish: true }, ["swing"]); }
    else if (price < vaLow) { score -= 8; push({ label: "Trading below value area", detail: `Price < VAL ₹${vaLow.toFixed(2)}.`, weight: 8, bullish: false }, ["swing"]); }
    else if (Math.abs(price - poc) / poc < 0.01) { push({ label: "Price at point of control", detail: `Coiling near POC ₹${poc.toFixed(2)}.`, weight: 3, bullish: ema20 != null ? price > ema20 : quote.changePercent > 0 }, ["swing"]); }
  }

  // Clamp
  score = Math.max(-100, Math.min(100, score));

  // ---------- Master signal classification (UNCHANGED — paper-trading + scanner depend on this) ----------
  let signal: Signal;
  if (score >= 50) signal = "STRONG_BUY";
  else if (score >= 22) signal = "BUY";
  else if (score >= -22) signal = "NEUTRAL";
  else if (score >= -50) signal = "SELL";
  else signal = "STRONG_SELL";

  const directional = score >= 0;
  const aligned = reasons.filter(r => r.bullish === directional).reduce((a, b) => a + b.weight, 0);
  const total = reasons.reduce((a, b) => a + b.weight, 0);
  const confidence = total === 0 ? 0 : Math.round((aligned / total) * 100);

  // ---------- Equity Entry-Safety Gate (Pass-A demote + Pass-B entry plan) ----------
  // Trend can be Strong Bullish AND the entry can still be unsafe — when price
  // is extended into a major resistance after a strong same-day move, fresh
  // longs face high rejection risk even if the multi-week trend is intact.
  // We never flip direction; we only soften the headline tier (so users +
  // paper-trader treat fresh entries as risky) and surface an actionable plan.
  const entrySafety = computeEntrySafety({
    signal, price, quote, indicators, atr14: indicators.atr14 ?? null,
  });
  if (entrySafety.demoteTag) {
    // Two-step assignment widens TS narrowing — STRONG_SELL branch was
    // unreachable to the checker after the first comparison.
    const before: Signal = signal;
    if (before === "STRONG_BUY") signal = "BUY";
    else if (before === "STRONG_SELL") signal = "SELL";
    push({
      label: entrySafety.demoteTag,                              // LATE_ENTRY_AT_RESISTANCE / _AT_SUPPORT
      detail: entrySafety.plan?.reason ?? "Entry timing degraded; trend unchanged.",
      weight: 0,                                                  // audit-only — does not move score
      bullish: signal === "BUY" || signal === "STRONG_BUY",
    }, ["intraday", "swing"]);
  }

  // ---------- Targets / SL (UNCHANGED) ----------
  let target: number | undefined;
  let stopLoss: number | undefined;
  let rr: number | undefined;
  const atr14 = indicators.atr14;
  if (atr14 != null && atr14 > 0 && support != null && resistance != null) {
    const range = Math.max(0, resistance - support);
    if (signal === "BUY" || signal === "STRONG_BUY") {
      target = +(price + Math.max(range * 0.55, atr14 * 2.5)).toFixed(2);
      stopLoss = +Math.min(
        price * 0.999,
        Math.max(support, price - Math.max(range * 0.25, atr14 * 1.2)),
      ).toFixed(2);
      const reward = target - price;
      const risk = price - stopLoss;
      if (risk > 0) rr = +(reward / risk).toFixed(2);
    } else if (signal === "SELL" || signal === "STRONG_SELL") {
      target = +(price - Math.max(range * 0.55, atr14 * 2.5)).toFixed(2);
      stopLoss = +Math.max(
        price * 1.001,
        Math.min(resistance, price + Math.max(range * 0.25, atr14 * 1.2)),
      ).toFixed(2);
      const reward = price - target;
      const risk = stopLoss - price;
      if (risk > 0) rr = +(reward / risk).toFixed(2);
    }
  }

  // Timeframe heuristic (UNCHANGED)
  let timeframe: "intraday" | "swing" | "positional" = "swing";
  if (adx != null && adx >= 25 && Math.abs(quote.changePercent) > 1) timeframe = "intraday";
  else if (ema50 != null && ema100 != null && price > ema100 && ema50 > ema100) timeframe = "positional";

  // ---------- NEW: 3-horizon bias panel ----------
  const horizons: HorizonBias[] = [
    buildHorizon("INTRADAY", "Today / 1-3 days", reasons, {
      vwap, todayHigh, todayLow, e9, e21, price, quote,
    }),
    buildHorizon("SWING", "1-4 weeks", reasons, {
      ema20, ema50, support, resistance, atr14, price, quote,
    }),
    buildHorizon("LONG_TERM", "1+ months", reasons, {
      ema50, ema100, ema200, yrHi: yrHi ?? null, yrLo: yrLo ?? null, price, quote,
    }),
  ];

  // ---------- NEW: top-level conflicts (top opposing reasons against the dominant bias) ----------
  const dominantSide = score === 0 ? null : score > 0;
  const conflicts: string[] = [];
  if (dominantSide !== null) {
    const opposing = reasons
      .filter(r => r.bullish !== dominantSide && r.weight >= 5)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3);
    for (const r of opposing) {
      conflicts.push(`${r.label} (${r.bullish ? "bullish" : "bearish"}, w${r.weight}) — ${r.detail ?? ""}`.trim());
    }
  }

  // ---------- NEW: displayLabel + setupStatus + setupMessage ----------
  const bullishWeight = reasons.filter(r => r.bullish).reduce((a, b) => a + b.weight, 0);
  const bearishWeight = reasons.filter(r => !r.bullish).reduce((a, b) => a + b.weight, 0);
  const displayLabel = deriveDisplayLabel(signal, score, bullishWeight, bearishWeight);

  const { setupStatus, setupMessage } = deriveSetupStatus({
    signal, target, stopLoss, rr, atr14, support, resistance, price, displayLabel,
  });

  // ---------- NEW: top-level confirmation / invalidation (mirrors swing horizon when tradeable, else intraday) ----------
  const swingHorizon = horizons.find(h => h.horizon === "SWING")!;
  const intradayHorizon = horizons.find(h => h.horizon === "INTRADAY")!;
  const primary = setupStatus === "TRADEABLE" ? swingHorizon : (swingHorizon.bias !== "INSUFFICIENT_DATA" ? swingHorizon : intradayHorizon);
  const confirmation = primary.confirmation;
  const invalidation = primary.invalidation;

  // Strip internal `horizons` tag before returning to API
  const apiReasons: SignalReason[] = reasons.map(({ horizons: _h, ...r }) => r);

  return {
    signal,
    score: Math.round(score),
    confidence,
    timeframe,
    target,
    stopLoss,
    riskRewardRatio: rr,
    reasons: apiReasons,
    displayLabel,
    setupStatus,
    setupMessage,
    confirmation,
    invalidation,
    conflicts,
    horizons,
    entryQuality: entrySafety.quality,
    entryPlan: entrySafety.plan,
  };
}

// ---------- Equity Entry-Safety Gate (Pass-A demote + Pass-B entry plan) ----------
//
// Hybrid resistance threshold (mirror for support):
//   1. Within 1.5% of (52W high OR R1 OR 20-day swing/intraday resistance), OR
//      within 1 ATR of R1 / swing resistance, AND
//   2. Today's high tagged the level (>= candidate * 0.995), AND
//   3. Today's move >= +2.5% (bullish; <= -2.5% bearish).
//
// When all three fire on a directional signal, demote STRONG_BUY -> BUY (or
// STRONG_SELL -> SELL) and emit a POOR-quality entry plan. Inside the
// proximity zone but missing one condition -> FAIR (advisory plan only,
// no demote). Otherwise GOOD (no plan). NEUTRAL signals get no plan.
export interface EntrySafetyInput {
  signal: Signal;
  price: number;
  quote: Quote;
  indicators: Indicators;
  atr14: number | null;
}
export interface EntrySafetyResult {
  quality?: RecommendationEntryQuality;
  plan?: EntryPlan;
  demoteTag?: "LATE_ENTRY_AT_RESISTANCE" | "LATE_ENTRY_AT_SUPPORT";
}

const NEAR_PCT = 0.015;          // 1.5% proximity to a major level
const FAIR_PCT = 0.030;          // 3.0% advisory zone
const STRONG_MOVE_PCT = 2.5;     // |today change %| threshold for "extended"
const TAG_TOL = 0.005;           // today's high/low tagged within 0.5%

export function computeEntrySafety(inp: EntrySafetyInput): EntrySafetyResult {
  const { signal, price, quote, indicators, atr14 } = inp;
  if (signal === "NEUTRAL") return {};

  const bullish = signal === "BUY" || signal === "STRONG_BUY";
  const change = quote.changePercent ?? 0;
  const todayHigh = quote.high ?? price;
  const todayLow = quote.low ?? price;
  const vwap = indicators.vwap ?? null;
  const ema20 = indicators.ema20 ?? null;
  const ema50 = indicators.ema50 ?? null;

  // Candidate major levels.
  // Strict pre-filter: only consider levels on the correct side of price
  // (>= price for bullish, <= price for bearish). Materially crossed levels
  // are no longer "resistance"/"support" — they're either failed levels
  // (small overshoot) or new support/resistance (clean break + retest), and
  // either way the late-entry-at-level thesis no longer applies.
  // `useAtr` flags candidates eligible for the 1-ATR proximity check.
  // Per spec the ATR threshold applies to R1 / swing resistance only —
  // 52W high/low get the % proximity check exclusively (1 ATR is a rounding
  // error against a yearly extreme).
  type Cand = { level: number; src: string; useAtr: boolean };
  const rawCandidates: Cand[] = bullish
    ? [
        indicators.resistanceLevel != null ? { level: indicators.resistanceLevel, src: "20D high",  useAtr: true  } : null,
        indicators.r1              != null ? { level: indicators.r1,              src: "R1 pivot",  useAtr: true  } : null,
        quote.fiftyTwoWeekHigh     != null ? { level: quote.fiftyTwoWeekHigh,     src: "52W high",  useAtr: false } : null,
      ].filter((c): c is Cand => c != null && c.level >= price)
    : [
        indicators.supportLevel != null ? { level: indicators.supportLevel, src: "20D low",  useAtr: true  } : null,
        indicators.s1           != null ? { level: indicators.s1,           src: "S1 pivot", useAtr: true  } : null,
        quote.fiftyTwoWeekLow   != null ? { level: quote.fiftyTwoWeekLow,   src: "52W low",  useAtr: false } : null,
      ].filter((c): c is Cand => c != null && c.level <= price);

  if (rawCandidates.length === 0) return { quality: "GOOD" };

  // For bullish: "near" = level within 1.5% above price (always) OR within
  // 1 ATR above (R1 / swing res only). "Tagged" = today's high reached at
  // least (level * (1 - TAG_TOL)). Mirror for bearish.
  // Distance is non-negative by construction (strict pre-filter above), so we
  // never accept a crossed level just because it's close in ATR units.
  const evaluated = rawCandidates.map(c => {
    const dist = bullish ? c.level - price : price - c.level;     // >= 0
    const distPct = dist / price;
    const nearByPct = distPct <= NEAR_PCT;
    const nearByAtr = c.useAtr && atr14 != null && atr14 > 0 && dist <= atr14;
    const tagged   = bullish
      ? todayHigh >= c.level * (1 - TAG_TOL)
      : todayLow  <= c.level * (1 + TAG_TOL);
    return { ...c, dist, distPct, near: nearByPct || nearByAtr, tagged };
  });

  const blockers = evaluated.filter(e => e.near && e.tagged);
  const strongMove = bullish ? change >= STRONG_MOVE_PCT : change <= -STRONG_MOVE_PCT;

  // POOR (Pass-A demote): proximity + tag + strong same-day push.
  if (blockers.length > 0 && strongMove) {
    // Pick the tightest (smallest absolute distance) blocking level.
    const nearest = blockers.reduce((best, e) =>
      Math.abs(e.dist) < Math.abs(best.dist) ? e : best,
    blockers[0]);
    return {
      quality: "POOR",
      demoteTag: bullish ? "LATE_ENTRY_AT_RESISTANCE" : "LATE_ENTRY_AT_SUPPORT",
      plan: buildEntryPlan({
        bullish, price, level: nearest.level, levelSrc: nearest.src,
        change, vwap, ema20, ema50, atr14,
      }),
    };
  }

  // FAIR (advisory): inside the 3% proximity ring but didn't trigger POOR.
  const insideAdvisory = evaluated.some(e => Math.abs(e.distPct) <= FAIR_PCT);
  if (insideAdvisory) {
    const nearest = evaluated.reduce((best, e) =>
      Math.abs(e.dist) < Math.abs(best.dist) ? e : best,
    evaluated[0]);
    return {
      quality: "FAIR",
      plan: buildEntryPlan({
        bullish, price, level: nearest.level, levelSrc: nearest.src,
        change, vwap, ema20, ema50, atr14, advisory: true,
      }),
    };
  }
  return { quality: "GOOD" };
}

interface PlanCtx {
  bullish: boolean;
  price: number;
  level: number;
  levelSrc: string;
  change: number;
  vwap: number | null;
  ema20: number | null;
  ema50: number | null;
  atr14: number | null;
  advisory?: boolean;
}
function buildEntryPlan(p: PlanCtx): EntryPlan {
  const { bullish, price, level, levelSrc, change, vwap, ema20, ema50, atr14 } = p;
  const r2 = (n: number) => Math.round(n * 100) / 100;

  // Avoid zone: the danger band where rejection wicks tend to print.
  // Sized off ATR when available (≈0.5 ATR beyond the level) so volatile
  // names get a wider zone; otherwise a fixed 0.8% band.
  const danger = atr14 != null && atr14 > 0 ? Math.max(atr14 * 0.5, level * 0.005) : level * 0.008;
  const avoidZone: PriceZone = bullish
    ? { low: r2(level * 0.995), high: r2(level + danger) }
    : { low: r2(level - danger), high: r2(level * 1.005) };

  // Breakout trigger: ALWAYS above (bullish) / below (bearish) the avoid
  // zone — a clean clear, not a tag. Adds a small confirmation buffer
  // (≈0.2 ATR or 0.2%) on top of the avoid-zone edge.
  const confirm = atr14 != null && atr14 > 0 ? Math.max(atr14 * 0.2, level * 0.002) : level * 0.003;
  const breakoutTrigger = bullish
    ? r2(avoidZone.high + confirm)
    : r2(avoidZone.low  - confirm);

  // Pullback zone: VWAP ↔ EMA20 (or EMA50 fallback). Always returned with low <= high.
  let pullbackZone: PriceZone | undefined;
  const pbAnchors = [vwap, ema20].filter((n): n is number => n != null && n > 0);
  if (pbAnchors.length === 0 && ema50 != null) pbAnchors.push(ema50);
  if (pbAnchors.length >= 1) {
    const pbLow  = Math.min(...pbAnchors);
    const pbHigh = pbAnchors.length === 1 ? pbAnchors[0]! * 1.005 : Math.max(...pbAnchors);
    // Only meaningful when the zone is actually a pullback from current price.
    if (bullish ? pbHigh < price : pbLow > price) {
      pullbackZone = { low: r2(Math.min(pbLow, pbHigh)), high: r2(Math.max(pbLow, pbHigh)) };
    }
  }

  const moveTxt = `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
  const reason = p.advisory
    ? `Trend is ${bullish ? "bullish" : "bearish"} but price is approaching ${levelSrc} ₹${level.toFixed(2)}. Sizing down or waiting for confirmation reduces rejection risk.`
    : `${bullish ? "Bullish" : "Bearish"} trend, but price is extended into ${levelSrc} ₹${level.toFixed(2)} after a strong same-day move (${moveTxt}). High rejection risk on a fresh entry — wait for a clean ${bullish ? "breakout" : "breakdown"} or a pullback.`;

  return { reason, avoidZone, breakoutTrigger, pullbackZone };
}

// ---------- Per-horizon bias builder ----------

interface HorizonCtx {
  vwap?: number | null;
  todayHigh?: number;
  todayLow?: number;
  e9?: number | null;
  e21?: number | null;
  ema20?: number | null;
  ema50?: number | null;
  ema100?: number | null;
  ema200?: number | null;
  support?: number | null;
  resistance?: number | null;
  atr14?: number | null;
  yrHi?: number | null;
  yrLo?: number | null;
  price: number;
  quote: Quote;
}

function buildHorizon(
  horizon: HorizonName,
  timeframe: string,
  allReasons: TaggedReason[],
  ctx: HorizonCtx,
): HorizonBias {
  const tag: HorizonTag = horizon === "INTRADAY" ? "intraday" : horizon === "SWING" ? "swing" : "longTerm";
  const relevant = allReasons.filter(r => r.horizons.includes(tag));

  if (relevant.length === 0) {
    return {
      horizon,
      bias: "INSUFFICIENT_DATA",
      label: "Insufficient data",
      confidence: 0,
      timeframe,
      reason: insufficientDataReason(horizon),
      confirmation: confirmationLine(horizon, "neutral", ctx),
      invalidation: invalidationLine(horizon, "neutral", ctx),
    };
  }

  const bullW = relevant.filter(r => r.bullish).reduce((a, b) => a + b.weight, 0);
  const bearW = relevant.filter(r => !r.bullish).reduce((a, b) => a + b.weight, 0);
  const totalW = bullW + bearW;
  const netW = bullW - bearW;

  // Bias classification per horizon. Architect feedback: a single weak reason
  // (e.g. only "Above 200 EMA" w=5 firing on the long-term horizon) was being
  // classified as NEUTRAL_BULLISH, overstating conviction on thin evidence.
  // Fix: require a minimum total weight floor before allowing ANY directional
  // (or skewed) classification. Below the floor we honestly report
  // INSUFFICIENT_DATA.
  const HORIZON_MIN_TOTAL_W = 8;   // need at least one meaningful rule (w>=8) or two weak ones
  const HORIZON_NEUTRAL_MIN_W = 8; // skewed-side weight must clear this to be called NEUTRAL_*
  const HORIZON_DIRECTIONAL_MIN_W = 12; // dominant-side weight must clear this for full BULLISH/BEARISH

  let bias: HorizonBias["bias"];
  let label: string;
  if (totalW < HORIZON_MIN_TOTAL_W) {
    bias = "INSUFFICIENT_DATA";
    label = "Insufficient data";
  } else if (bullW > bearW * 2 && bullW >= HORIZON_DIRECTIONAL_MIN_W) {
    bias = "BULLISH";
    label = "Bullish";
  } else if (bearW > bullW * 2 && bearW >= HORIZON_DIRECTIONAL_MIN_W) {
    bias = "BEARISH";
    label = "Bearish";
  } else if (netW > 0 && bullW >= HORIZON_NEUTRAL_MIN_W) {
    bias = "NEUTRAL_BULLISH";
    label = "Neutral-to-Bullish";
  } else if (netW < 0 && bearW >= HORIZON_NEUTRAL_MIN_W) {
    bias = "NEUTRAL_BEARISH";
    label = "Neutral-to-Bearish";
  } else {
    bias = "RANGE_BOUND";
    label = "Range-bound";
  }

  // Confidence = aligned-with-bias weight share. For RANGE_BOUND we now
  // report the LARGER-side share (≈50% when truly balanced) so the user reads
  // "55% bull / 45% bear → range-bound at 55%" — matches intuition. Earlier
  // formula (1 - |netW|/totalW) reported 100% when perfectly balanced, which
  // read as "high certainty range-bound" and confused readers.
  let confidence: number;
  if (bias === "BULLISH" || bias === "NEUTRAL_BULLISH") confidence = Math.round((bullW / totalW) * 100);
  else if (bias === "BEARISH" || bias === "NEUTRAL_BEARISH") confidence = Math.round((bearW / totalW) * 100);
  else if (bias === "RANGE_BOUND") confidence = Math.round((Math.max(bullW, bearW) / totalW) * 100);
  else confidence = 0;

  // Reason: top 1-2 supporting items
  const dominantSide = bias === "BULLISH" || bias === "NEUTRAL_BULLISH"
    ? true
    : bias === "BEARISH" || bias === "NEUTRAL_BEARISH"
      ? false
      : bullW >= bearW;
  const supporting = relevant.filter(r => r.bullish === dominantSide).sort((a, b) => b.weight - a.weight).slice(0, 2);
  const reasonText = supporting.length === 0
    ? "Mixed signals on this horizon."
    : supporting.map(r => r.label).join("; ");

  // Conflicts: opposing items with weight >= 4
  const opposing = relevant.filter(r => r.bullish !== dominantSide && r.weight >= 4).sort((a, b) => b.weight - a.weight).slice(0, 2);
  const conflicts = opposing.length === 0
    ? undefined
    : opposing.map(r => r.label).join("; ");

  const sideKey: "bull" | "bear" | "neutral" =
    bias === "BULLISH" || bias === "NEUTRAL_BULLISH" ? "bull"
      : bias === "BEARISH" || bias === "NEUTRAL_BEARISH" ? "bear"
        : "neutral";

  return {
    horizon,
    bias,
    label,
    confidence,
    timeframe,
    reason: reasonText,
    conflicts,
    confirmation: confirmationLine(horizon, sideKey, ctx),
    invalidation: invalidationLine(horizon, sideKey, ctx),
  };
}

function fmt(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? "—" : `₹${n.toFixed(2)}`;
}

function insufficientDataReason(h: HorizonName): string {
  if (h === "INTRADAY") return "Intraday indicators (VWAP, fast EMA, today's range) not yet established.";
  if (h === "SWING") return "Swing indicators (EMA20/50, MACD, RSI, S/R) not yet established.";
  return "Long-term EMAs (50/100/200) require ≥200 trading sessions of history.";
}

function confirmationLine(h: HorizonName, side: "bull" | "bear" | "neutral", ctx: HorizonCtx): string {
  if (h === "INTRADAY") {
    const ref = ctx.vwap ?? ctx.todayHigh;
    const refLow = ctx.vwap ?? ctx.todayLow;
    if (side === "bull") return `Sustained close above ${fmt(ctx.todayHigh)} with volume > 1.5× average.`;
    if (side === "bear") return `Sustained close below ${fmt(ctx.todayLow)} with volume > 1.5× average.`;
    return `Wait for break above ${fmt(ref)} (long) or below ${fmt(refLow)} (short).`;
  }
  if (h === "SWING") {
    if (side === "bull") return `Daily close above resistance ${fmt(ctx.resistance)} on rising volume; EMA20 ${fmt(ctx.ema20)} holds as support.`;
    if (side === "bear") return `Daily close below support ${fmt(ctx.support)} with EMA20 ${fmt(ctx.ema20)} acting as resistance.`;
    return `Wait for daily close above ${fmt(ctx.resistance)} or below ${fmt(ctx.support)} for direction.`;
  }
  if (side === "bull") return `Weekly close above 200-EMA ${fmt(ctx.ema200)} and higher highs; preferably near 52W high ${fmt(ctx.yrHi)}.`;
  if (side === "bear") return `Weekly close below 200-EMA ${fmt(ctx.ema200)} with lower lows; near 52W low ${fmt(ctx.yrLo)} adds conviction.`;
  return `Long-term direction unclear — wait for monthly close above/below 200-EMA ${fmt(ctx.ema200)}.`;
}

function invalidationLine(h: HorizonName, side: "bull" | "bear" | "neutral", ctx: HorizonCtx): string {
  if (h === "INTRADAY") {
    if (side === "bull") return `Long invalidates below VWAP ${fmt(ctx.vwap)} or today's low ${fmt(ctx.todayLow)}.`;
    if (side === "bear") return `Short invalidates above VWAP ${fmt(ctx.vwap)} or today's high ${fmt(ctx.todayHigh)}.`;
    return `Bias invalidates outside today's range (${fmt(ctx.todayLow)} – ${fmt(ctx.todayHigh)}).`;
  }
  if (h === "SWING") {
    if (side === "bull") return `Long invalidates on close below support ${fmt(ctx.support)} or EMA50 ${fmt(ctx.ema50)}.`;
    if (side === "bear") return `Short invalidates on close above resistance ${fmt(ctx.resistance)} or EMA50 ${fmt(ctx.ema50)}.`;
    return `Range fails on a daily close outside ${fmt(ctx.support)} – ${fmt(ctx.resistance)}.`;
  }
  if (side === "bull") return `Long-term bull invalidates on monthly close below 200-EMA ${fmt(ctx.ema200)}.`;
  if (side === "bear") return `Long-term bear invalidates on monthly close above 200-EMA ${fmt(ctx.ema200)}.`;
  return `Trend remains undefined while price oscillates around 200-EMA ${fmt(ctx.ema200)}.`;
}

// ---------- displayLabel: resolves the "Neutral when evidence is one-sided" bug ----------

function deriveDisplayLabel(
  signal: Signal,
  score: number,
  bullishWeight: number,
  bearishWeight: number,
): string {
  if (signal === "STRONG_BUY") return "Strong Bullish";
  if (signal === "BUY") return "Bullish";
  if (signal === "STRONG_SELL") return "Strong Bearish";
  if (signal === "SELL") return "Bearish";
  // signal === "NEUTRAL" — refine using weight skew
  const total = bullishWeight + bearishWeight;
  if (total === 0) return "Insufficient Data";
  const bearShare = bearishWeight / total;
  const bullShare = bullishWeight / total;
  // Strong one-sided bias inside the NEUTRAL band → "No Trade — Pressure"
  if (bearShare >= 0.65 && score <= -8) return "No Trade — Bearish Pressure";
  if (bullShare >= 0.65 && score >= 8) return "No Trade — Bullish Pressure";
  // Mild skew → "Neutral-to-X"
  if (bearShare > bullShare && score < 0) return "Neutral-to-Bearish";
  if (bullShare > bearShare && score > 0) return "Neutral-to-Bullish";
  return "Range-bound";
}

// ---------- setupStatus + setupMessage: target/stop boxes are NEVER blank ----------

interface SetupCtx {
  signal: Signal;
  target?: number;
  stopLoss?: number;
  rr?: number;
  atr14?: number;
  support: number | null;
  resistance: number | null;
  price: number;
  displayLabel: string;
}

function deriveSetupStatus(c: SetupCtx): { setupStatus: SetupStatus; setupMessage: string } {
  // Case 1 — full setup computed
  if (c.target != null && c.stopLoss != null && c.rr != null) {
    if (c.rr >= 1) {
      return {
        setupStatus: "TRADEABLE",
        setupMessage: `Setup ready. Risk/reward ${c.rr.toFixed(2)}:1. Size by your per-trade risk; respect the stop.`,
      };
    }
    return {
      setupStatus: "NO_SETUP_RR",
      setupMessage: `No valid trade setup generated because risk/reward (${c.rr.toFixed(2)}:1) is not favorable. Wait for a better entry.`,
    };
  }
  // Case 2 — signal is NEUTRAL → no directional setup
  if (c.signal === "NEUTRAL") {
    if (c.support != null && c.resistance != null) {
      return {
        setupStatus: "NO_SETUP_NEUTRAL",
        setupMessage: `No valid trade setup — bias is ${c.displayLabel}. Target and stop-loss will appear after breakout above ₹${c.resistance.toFixed(2)} or breakdown below ₹${c.support.toFixed(2)}.`,
      };
    }
    return {
      setupStatus: "NO_SETUP_NEUTRAL",
      setupMessage: `No valid trade setup — bias is ${c.displayLabel}. Wait for a confirmed breakout or breakdown before sizing a trade.`,
    };
  }
  // Case 3 — directional signal but ATR / S-R missing (insufficient session data)
  const missing: string[] = [];
  if (c.atr14 == null || c.atr14 <= 0) missing.push("volatility (ATR-14)");
  if (c.support == null || c.resistance == null) missing.push("intraday support/resistance");
  return {
    setupStatus: "NO_SETUP_AWAITING_LEVELS",
    setupMessage: `Target and stop-loss will appear once ${missing.join(" and ")} are established. Need more session data — re-check after the next candle.`,
  };
}
