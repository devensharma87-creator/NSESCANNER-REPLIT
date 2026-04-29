import type { Indicators, Quote, Recommendation, Signal, SignalReason } from "@workspace/api-zod";

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

export function buildRecommendation(input: ScoreInput): Recommendation {
  const { quote, indicators, closes, ema9Series, ema21Series, ema20Series, ema50Series, rsiSeries, macdHistSeries } = input;
  const reasons: SignalReason[] = [];
  let score = 0;

  const price = quote.price;
  // After the OpenAPI schema relaxed all Indicator fields to optional (so
  // Kite-only rows can ship `undefined` instead of fake zeros), every
  // consumer here has to gate on presence. We keep the local variable types
  // narrow but skip rules whose inputs are missing.
  const ema20 = indicators.ema20;
  const ema50 = indicators.ema50;
  // Long EMAs are OPTIONAL — only used when we genuinely have ≥100 / ≥200 bars
  // of history. Substituting ema50 here would produce false "long-term trend"
  // reasons that label ema50 as the 200 EMA in the UI.
  const ema100 = indicators.ema100;
  const ema200 = indicators.ema200;
  // VWAP rule must NOT silently fall back to price — that turns the
  // price-vs-VWAP comparison into price-vs-price (always neutral) and
  // hides the fact that VWAP is missing. Pass null through and gate
  // the rule below.
  const vwap = indicators.vwap ?? null;
  const rsi = indicators.rsi14;
  // Honest missing-indicator handling: when ADX / volumeRatio / deliveryPct are
  // not computed for a symbol (e.g. newly-listed names with thin history, or
  // bhavcopy-only rows that have no delivery split), we used to substitute fake
  // "neutral" defaults (20 / 1 / 50) which silently biased every score toward
  // zero. Instead, pass null through and gate every rule that consumes them.
  // The score then reflects only the rules that have real evidence behind them.
  const adx = indicators.adx14 ?? null;
  const volRatio = indicators.volumeRatio ?? null;
  const deliveryPct = indicators.deliveryPct ?? null;
  const support = indicators.supportLevel ?? Math.min(...closes.slice(-20));
  const resistance = indicators.resistanceLevel ?? Math.max(...closes.slice(-20));
  const poc = indicators.pointOfControl;
  const vaHigh = indicators.valueAreaHigh;
  const vaLow = indicators.valueAreaLow;
  const macdHist = lastNonNull(macdHistSeries);
  const macdHistPrev = valueAtOffset(macdHistSeries, 2);

  // 1. Long-term EMA 50/100/200 trend (weight 18) — only when we actually have
  // 100 + 200 bars of history AND a real ema50. For newly-listed symbols
  // (or 6mo-only history) we skip this rule rather than silently substitute.
  if (ema50 != null && ema100 != null && ema200 != null) {
    if (price > ema50 && ema50 > ema100 && ema100 > ema200) {
      score += 18;
      reasons.push({ label: "Long-term uptrend (50>100>200)", detail: `Stacked EMAs confirm a primary uptrend.`, weight: 18, bullish: true });
    } else if (price < ema50 && ema50 < ema100 && ema100 < ema200) {
      score -= 18;
      reasons.push({ label: "Long-term downtrend (50<100<200)", detail: `Stacked EMAs confirm a primary downtrend.`, weight: 18, bullish: false });
    } else {
      const bullish = price > ema200;
      const w = 5;
      score += bullish ? w : -w;
      reasons.push({ label: bullish ? "Above 200 EMA" : "Below 200 EMA", detail: `Price ${bullish ? "above" : "below"} 200 EMA ₹${ema200.toFixed(2)}.`, weight: w, bullish });
    }
  }

  // 2. Short-term EMA 20/50 stack (weight 12) — needs both EMAs.
  if (ema20 != null && ema50 != null) {
    if (price > ema20 && ema20 > ema50) {
      score += 12;
      reasons.push({ label: "Short-term EMA bullish", detail: `Price > EMA20 > EMA50 — momentum supportive.`, weight: 12, bullish: true });
    } else if (price < ema20 && ema20 < ema50) {
      score -= 12;
      reasons.push({ label: "Short-term EMA bearish", detail: `Price < EMA20 < EMA50.`, weight: 12, bullish: false });
    }
  }

  // EMA cross (golden/death) detection on 20/50 over last 5 bars
  const e20Now = lastNonNull(ema20Series);
  const e20Prev = valueAtOffset(ema20Series, 5);
  const e50Now = lastNonNull(ema50Series);
  const e50Prev = valueAtOffset(ema50Series, 5);
  if (e20Now != null && e50Now != null && e20Prev != null && e50Prev != null) {
    if (e20Prev <= e50Prev && e20Now > e50Now) { score += 8; reasons.push({ label: "Recent golden cross", detail: "EMA20 crossed above EMA50 in last 5 sessions.", weight: 8, bullish: true }); }
    else if (e20Prev >= e50Prev && e20Now < e50Now) { score -= 8; reasons.push({ label: "Recent death cross", detail: "EMA20 crossed below EMA50 in last 5 sessions.", weight: 8, bullish: false }); }
  }

  // 3. EMA 9/21 fast trigger (weight 8)
  const e9 = lastNonNull(ema9Series);
  const e21 = lastNonNull(ema21Series);
  if (e9 != null && e21 != null) {
    if (e9 > e21 && price > e9) { score += 8; reasons.push({ label: "Fast EMA bullish", detail: `EMA9 > EMA21 with price above — short-term momentum up.`, weight: 8, bullish: true }); }
    else if (e9 < e21 && price < e9) { score -= 8; reasons.push({ label: "Fast EMA bearish", detail: `EMA9 < EMA21 with price below.`, weight: 8, bullish: false }); }
  }

  // 4. VWAP (weight 10) — gated; we never invent a VWAP.
  if (vwap != null) {
    if (price > vwap * 1.001) { score += 10; reasons.push({ label: "Above VWAP", detail: `Price ₹${price.toFixed(2)} > VWAP ₹${vwap.toFixed(2)}.`, weight: 10, bullish: true }); }
    else if (price < vwap * 0.999) { score -= 10; reasons.push({ label: "Below VWAP", detail: `Price ₹${price.toFixed(2)} < VWAP ₹${vwap.toFixed(2)}.`, weight: 10, bullish: false }); }
  }

  // 5. ADX trend strength gate (weight 6) — skip entirely when adx is unknown.
  if (adx != null) {
    if (adx >= 25) {
      const w = 6;
      // Without ema20 we fall back to today's intraday change to decide
      // bull/bear bias for the ADX-strong rule. Better than skipping the
      // rule entirely (ADX still says the move has conviction).
      const bullish = ema20 != null ? price > ema20 : quote.changePercent > 0;
      score += bullish ? w : -w;
      reasons.push({ label: `Strong trend (ADX ${adx.toFixed(0)})`, detail: `ADX ≥ 25 — current move has conviction.`, weight: w, bullish });
    } else if (adx < 18) {
      reasons.push({ label: `Choppy regime (ADX ${adx.toFixed(0)})`, detail: `ADX < 18 — range-bound; signals less reliable.`, weight: 3, bullish: false });
    }
  }

  // 6. MACD histogram (weight 8)
  if (macdHist != null && macdHistPrev != null) {
    if (macdHist > 0 && macdHist > macdHistPrev) { score += 8; reasons.push({ label: "MACD bullish & rising", detail: `Histogram positive and expanding.`, weight: 8, bullish: true }); }
    else if (macdHist < 0 && macdHist < macdHistPrev) { score -= 8; reasons.push({ label: "MACD bearish & falling", detail: `Histogram negative and expanding.`, weight: 8, bullish: false }); }
  }

  // 7. RSI state (weight 10) — gated on RSI being computed.
  if (rsi != null) {
    if (rsi >= 55 && rsi <= 70) { score += 10; reasons.push({ label: "RSI in bullish zone", detail: `RSI(14) ${rsi.toFixed(1)}.`, weight: 10, bullish: true }); }
    else if (rsi > 70) { score -= 6; reasons.push({ label: "RSI overbought", detail: `RSI(14) ${rsi.toFixed(1)} — pullback risk.`, weight: 6, bullish: false }); }
    else if (rsi >= 45 && rsi < 55) { reasons.push({ label: "RSI neutral", detail: `RSI(14) ${rsi.toFixed(1)}.`, weight: 2, bullish: rsi >= 50 }); }
    else if (rsi < 30) { score += 8; reasons.push({ label: "RSI oversold", detail: `RSI(14) ${rsi.toFixed(1)} — bounce zone.`, weight: 8, bullish: true }); }
    else { score -= 8; reasons.push({ label: "RSI weak", detail: `RSI(14) ${rsi.toFixed(1)}.`, weight: 8, bullish: false }); }
  }

  // RSI divergence — gated on REAL last close. We will not fall back to
  // the live quote price (different timeframe / timing) and call that a
  // valid divergence comparison.
  const closeNow = closes[closes.length - 1];
  const closePrev10 = closes.length > 10 ? closes[closes.length - 11]! : null;
  const rsiNow = lastNonNull(rsiSeries);
  const rsiPrev10 = valueAtOffset(rsiSeries, 10);
  if (closeNow != null && closePrev10 != null && rsiNow != null && rsiPrev10 != null) {
    if (closeNow > closePrev10 * 1.02 && rsiNow < rsiPrev10 - 3) { score -= 6; reasons.push({ label: "Bearish RSI divergence", detail: "Higher high in price, lower high in RSI.", weight: 6, bullish: false }); }
    else if (closeNow < closePrev10 * 0.98 && rsiNow > rsiPrev10 + 3) { score += 6; reasons.push({ label: "Bullish RSI divergence", detail: "Lower low in price, higher low in RSI.", weight: 6, bullish: true }); }
  }

  // 8. Price action vs swing levels (weight 12)
  const distFromRes = (resistance - price) / resistance;
  const distFromSup = (price - support) / support;
  if (price >= resistance * 0.999 && quote.changePercent > 0.5) { score += 12; reasons.push({ label: "Breakout above resistance", detail: `Clearing swing high ₹${resistance.toFixed(2)}.`, weight: 12, bullish: true }); }
  else if (price <= support * 1.001 && quote.changePercent < -0.5) { score -= 12; reasons.push({ label: "Breakdown below support", detail: `Losing swing low ₹${support.toFixed(2)}.`, weight: 12, bullish: false }); }
  else if (distFromSup < 0.03) { score += 5; reasons.push({ label: "Trading near support", detail: `Within 3% of ₹${support.toFixed(2)}.`, weight: 5, bullish: true }); }
  else if (distFromRes < 0.03) { score -= 5; reasons.push({ label: "Trading near resistance", detail: `Within 3% of ₹${resistance.toFixed(2)}.`, weight: 5, bullish: false }); }

  // 52-week proximity
  const yrHi = quote.fiftyTwoWeekHigh;
  const yrLo = quote.fiftyTwoWeekLow;
  if (yrHi && price >= yrHi * 0.98) { score += 5; reasons.push({ label: "Near 52-week high", detail: `Price within 2% of 52W high ₹${yrHi.toFixed(2)}.`, weight: 5, bullish: true }); }
  else if (yrLo && price <= yrLo * 1.02) { score -= 5; reasons.push({ label: "Near 52-week low", detail: `Price within 2% of 52W low ₹${yrLo.toFixed(2)}.`, weight: 5, bullish: false }); }

  // Today's candle direction
  if (quote.changePercent > 1.5) { score += 4; reasons.push({ label: "Strong bullish candle today", detail: `Up ${quote.changePercent.toFixed(2)}% intraday.`, weight: 4, bullish: true }); }
  else if (quote.changePercent < -1.5) { score -= 4; reasons.push({ label: "Strong bearish candle today", detail: `Down ${quote.changePercent.toFixed(2)}% intraday.`, weight: 4, bullish: false }); }

  // 9. Volume (weight 10) — skip when volume ratio is unknown.
  if (volRatio != null) {
    if (volRatio >= 1.5 && quote.changePercent > 0) { score += 10; reasons.push({ label: "Volume surge on advance", detail: `Volume ${volRatio.toFixed(2)}× the 20-day average on a positive close.`, weight: 10, bullish: true }); }
    else if (volRatio >= 1.5 && quote.changePercent < 0) { score -= 10; reasons.push({ label: "Distribution on decline", detail: `Volume ${volRatio.toFixed(2)}× the 20-day average on a negative close.`, weight: 10, bullish: false }); }
    else if (volRatio < 0.6) { reasons.push({ label: "Low volume", detail: `Volume only ${volRatio.toFixed(2)}× average.`, weight: 2, bullish: false }); }
  }

  // 10. Delivery % (weight 8) — skip when delivery split is unknown.
  if (deliveryPct != null) {
    if (deliveryPct >= 60 && quote.changePercent > 0) { score += 8; reasons.push({ label: "High delivery on advance", detail: `Delivery ${deliveryPct.toFixed(1)}% — investor accumulation.`, weight: 8, bullish: true }); }
    else if (deliveryPct >= 60 && quote.changePercent < 0) { score -= 8; reasons.push({ label: "High delivery on decline", detail: `Delivery ${deliveryPct.toFixed(1)}% on a down day — genuine selling.`, weight: 8, bullish: false }); }
  }

  // 11. Volume profile (weight 8)
  if (poc != null && vaHigh != null && vaLow != null) {
    if (price > vaHigh) { score += 8; reasons.push({ label: "Trading above value area", detail: `Price > VAH ₹${vaHigh.toFixed(2)}.`, weight: 8, bullish: true }); }
    else if (price < vaLow) { score -= 8; reasons.push({ label: "Trading below value area", detail: `Price < VAL ₹${vaLow.toFixed(2)}.`, weight: 8, bullish: false }); }
    else if (Math.abs(price - poc) / poc < 0.01) { reasons.push({ label: "Price at point of control", detail: `Coiling near POC ₹${poc.toFixed(2)}.`, weight: 3, bullish: ema20 != null ? price > ema20 : quote.changePercent > 0 }); }
  }

  // Clamp
  score = Math.max(-100, Math.min(100, score));

  let signal: Signal;
  if (score >= 50) signal = "STRONG_BUY";
  else if (score >= 22) signal = "BUY";
  else if (score >= -22) signal = "NEUTRAL";
  else if (score >= -50) signal = "SELL";
  else signal = "STRONG_SELL";

  // Confidence
  const directional = score >= 0;
  const aligned = reasons.filter(r => r.bullish === directional).reduce((a, b) => a + b.weight, 0);
  const total = reasons.reduce((a, b) => a + b.weight, 0);
  const confidence = total === 0 ? 0 : Math.round((aligned / total) * 100);

  // Targets / SL — gated on a REAL ATR(14). Previously we fell back to
  // `range / 6` (a heuristic from the 20-day support/resistance band) when
  // ATR was missing, then published target/stopLoss/RR as if they were
  // real volatility-derived levels. They were not. A scanner subscriber
  // sizing a trade off those numbers would be sizing off invented data.
  // If ATR is unknown, we leave target/SL/RR undefined and the UI shows
  // "—" — honest absence of data, not a fabricated level.
  const range = Math.max(0, resistance - support);
  let target: number | undefined;
  let stopLoss: number | undefined;
  let rr: number | undefined;
  const atr14 = indicators.atr14;
  if (atr14 != null && atr14 > 0) {
    if (signal === "BUY" || signal === "STRONG_BUY") {
      target = +(price + Math.max(range * 0.55, atr14 * 2.5)).toFixed(2);
      // Stop-loss must always sit BELOW entry for a long. Old code did
      // `Math.max(support, price - …)` which inverted the trade when a fast
      // breakdown left the 20-day support ABOVE the live price (support > price
      // → returned support → stopLoss > price → negative risk → bogus RR).
      // Cap at price * 0.999 so the stop is always at least 0.1% below entry.
      stopLoss = +Math.min(
        price * 0.999,
        Math.max(support, price - Math.max(range * 0.25, atr14 * 1.2)),
      ).toFixed(2);
      const reward = target - price;
      const risk = price - stopLoss;
      if (risk > 0) rr = +(reward / risk).toFixed(2);
    } else if (signal === "SELL" || signal === "STRONG_SELL") {
      target = +(price - Math.max(range * 0.55, atr14 * 2.5)).toFixed(2);
      // Mirror of the long case: stop must always sit ABOVE entry for a short.
      // Old `Math.min(resistance, price + …)` inverted when resistance < price.
      stopLoss = +Math.max(
        price * 1.001,
        Math.min(resistance, price + Math.max(range * 0.25, atr14 * 1.2)),
      ).toFixed(2);
      const reward = price - target;
      const risk = stopLoss - price;
      if (risk > 0) rr = +(reward / risk).toFixed(2);
    }
  }

  // Timeframe heuristic
  let timeframe: "intraday" | "swing" | "positional" = "swing";
  if (adx != null && adx >= 25 && Math.abs(quote.changePercent) > 1) timeframe = "intraday";
  else if (ema50 != null && ema100 != null && price > ema100 && ema50 > ema100) timeframe = "positional";

  return {
    signal,
    score: Math.round(score),
    confidence,
    timeframe,
    target,
    stopLoss,
    riskRewardRatio: rr,
    reasons,
  };
}
