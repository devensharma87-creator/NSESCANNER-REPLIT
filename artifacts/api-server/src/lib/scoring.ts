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
  const ema20 = indicators.ema20;
  const ema50 = indicators.ema50;
  const ema100 = indicators.ema100 ?? ema50;
  const ema200 = indicators.ema200 ?? ema50;
  const vwap = indicators.vwap ?? price;
  const rsi = indicators.rsi14;
  const adx = indicators.adx14 ?? 20;
  const volRatio = indicators.volumeRatio ?? 1;
  const deliveryPct = indicators.deliveryPct ?? 50;
  const support = indicators.supportLevel ?? Math.min(...closes.slice(-20));
  const resistance = indicators.resistanceLevel ?? Math.max(...closes.slice(-20));
  const poc = indicators.pointOfControl;
  const vaHigh = indicators.valueAreaHigh;
  const vaLow = indicators.valueAreaLow;
  const macdHist = lastNonNull(macdHistSeries);
  const macdHistPrev = valueAtOffset(macdHistSeries, 2);

  // 1. Long-term EMA 50/100/200 trend (weight 18)
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

  // 2. Short-term EMA 20/50 stack (weight 12)
  if (price > ema20 && ema20 > ema50) {
    score += 12;
    reasons.push({ label: "Short-term EMA bullish", detail: `Price > EMA20 > EMA50 — momentum supportive.`, weight: 12, bullish: true });
  } else if (price < ema20 && ema20 < ema50) {
    score -= 12;
    reasons.push({ label: "Short-term EMA bearish", detail: `Price < EMA20 < EMA50.`, weight: 12, bullish: false });
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

  // 4. VWAP (weight 10)
  if (price > vwap * 1.001) { score += 10; reasons.push({ label: "Above VWAP", detail: `Price ₹${price.toFixed(2)} > VWAP ₹${vwap.toFixed(2)}.`, weight: 10, bullish: true }); }
  else if (price < vwap * 0.999) { score -= 10; reasons.push({ label: "Below VWAP", detail: `Price ₹${price.toFixed(2)} < VWAP ₹${vwap.toFixed(2)}.`, weight: 10, bullish: false }); }

  // 5. ADX trend strength gate (weight 6)
  if (adx >= 25) {
    const w = 6;
    const bullish = price > ema20;
    score += bullish ? w : -w;
    reasons.push({ label: `Strong trend (ADX ${adx.toFixed(0)})`, detail: `ADX ≥ 25 — current move has conviction.`, weight: w, bullish });
  } else if (adx < 18) {
    reasons.push({ label: `Choppy regime (ADX ${adx.toFixed(0)})`, detail: `ADX < 18 — range-bound; signals less reliable.`, weight: 3, bullish: false });
  }

  // 6. MACD histogram (weight 8)
  if (macdHist != null && macdHistPrev != null) {
    if (macdHist > 0 && macdHist > macdHistPrev) { score += 8; reasons.push({ label: "MACD bullish & rising", detail: `Histogram positive and expanding.`, weight: 8, bullish: true }); }
    else if (macdHist < 0 && macdHist < macdHistPrev) { score -= 8; reasons.push({ label: "MACD bearish & falling", detail: `Histogram negative and expanding.`, weight: 8, bullish: false }); }
  }

  // 7. RSI state (weight 10)
  if (rsi >= 55 && rsi <= 70) { score += 10; reasons.push({ label: "RSI in bullish zone", detail: `RSI(14) ${rsi.toFixed(1)}.`, weight: 10, bullish: true }); }
  else if (rsi > 70) { score -= 6; reasons.push({ label: "RSI overbought", detail: `RSI(14) ${rsi.toFixed(1)} — pullback risk.`, weight: 6, bullish: false }); }
  else if (rsi >= 45 && rsi < 55) { reasons.push({ label: "RSI neutral", detail: `RSI(14) ${rsi.toFixed(1)}.`, weight: 2, bullish: rsi >= 50 }); }
  else if (rsi < 30) { score += 8; reasons.push({ label: "RSI oversold", detail: `RSI(14) ${rsi.toFixed(1)} — bounce zone.`, weight: 8, bullish: true }); }
  else { score -= 8; reasons.push({ label: "RSI weak", detail: `RSI(14) ${rsi.toFixed(1)}.`, weight: 8, bullish: false }); }

  // RSI divergence
  const closeNow = closes[closes.length - 1] ?? price;
  const closePrev10 = closes.length > 10 ? closes[closes.length - 11]! : null;
  const rsiNow = lastNonNull(rsiSeries);
  const rsiPrev10 = valueAtOffset(rsiSeries, 10);
  if (closePrev10 != null && rsiNow != null && rsiPrev10 != null) {
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

  // 9. Volume (weight 10)
  if (volRatio >= 1.5 && quote.changePercent > 0) { score += 10; reasons.push({ label: "Volume surge on advance", detail: `Volume ${volRatio.toFixed(2)}× the 20-day average on a positive close.`, weight: 10, bullish: true }); }
  else if (volRatio >= 1.5 && quote.changePercent < 0) { score -= 10; reasons.push({ label: "Distribution on decline", detail: `Volume ${volRatio.toFixed(2)}× the 20-day average on a negative close.`, weight: 10, bullish: false }); }
  else if (volRatio < 0.6) { reasons.push({ label: "Low volume", detail: `Volume only ${volRatio.toFixed(2)}× average.`, weight: 2, bullish: false }); }

  // 10. Delivery % (weight 8)
  if (deliveryPct >= 60 && quote.changePercent > 0) { score += 8; reasons.push({ label: "High delivery on advance", detail: `Delivery ${deliveryPct.toFixed(1)}% — investor accumulation.`, weight: 8, bullish: true }); }
  else if (deliveryPct >= 60 && quote.changePercent < 0) { score -= 8; reasons.push({ label: "High delivery on decline", detail: `Delivery ${deliveryPct.toFixed(1)}% on a down day — genuine selling.`, weight: 8, bullish: false }); }

  // 11. Volume profile (weight 8)
  if (poc != null && vaHigh != null && vaLow != null) {
    if (price > vaHigh) { score += 8; reasons.push({ label: "Trading above value area", detail: `Price > VAH ₹${vaHigh.toFixed(2)}.`, weight: 8, bullish: true }); }
    else if (price < vaLow) { score -= 8; reasons.push({ label: "Trading below value area", detail: `Price < VAL ₹${vaLow.toFixed(2)}.`, weight: 8, bullish: false }); }
    else if (Math.abs(price - poc) / poc < 0.01) { reasons.push({ label: "Price at point of control", detail: `Coiling near POC ₹${poc.toFixed(2)}.`, weight: 3, bullish: price > ema20 }); }
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

  // Targets / SL
  const range = Math.max(0, resistance - support);
  let target: number | undefined;
  let stopLoss: number | undefined;
  let rr: number | undefined;
  const atrLike = (indicators.atr14 ?? range / 6) || range / 6;
  if (signal === "BUY" || signal === "STRONG_BUY") {
    target = +(price + Math.max(range * 0.55, atrLike * 2.5)).toFixed(2);
    stopLoss = +(Math.max(support, price - Math.max(range * 0.25, atrLike * 1.2))).toFixed(2);
    const reward = target - price;
    const risk = price - stopLoss;
    if (risk > 0) rr = +(reward / risk).toFixed(2);
  } else if (signal === "SELL" || signal === "STRONG_SELL") {
    target = +(price - Math.max(range * 0.55, atrLike * 2.5)).toFixed(2);
    stopLoss = +(Math.min(resistance, price + Math.max(range * 0.25, atrLike * 1.2))).toFixed(2);
    const reward = price - target;
    const risk = stopLoss - price;
    if (risk > 0) rr = +(reward / risk).toFixed(2);
  }

  // Timeframe heuristic
  let timeframe: "intraday" | "swing" | "positional" = "swing";
  if (adx >= 25 && Math.abs(quote.changePercent) > 1) timeframe = "intraday";
  else if (price > ema100 && ema50 > ema100) timeframe = "positional";

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
