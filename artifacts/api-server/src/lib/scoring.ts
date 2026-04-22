import type { Indicators, Quote, Recommendation, Signal, SignalReason } from "@workspace/api-zod";

export interface ScoreInput {
  quote: Quote;
  indicators: Indicators;
  closes: number[];
  ema20Series: (number | null)[];
  ema50Series: (number | null)[];
  rsiSeries: (number | null)[];
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
  const { quote, indicators, closes, ema20Series, ema50Series, rsiSeries } = input;
  const reasons: SignalReason[] = [];
  let score = 0;

  const price = quote.price;
  const ema20 = indicators.ema20;
  const ema50 = indicators.ema50;
  const rsi = indicators.rsi14;
  const volRatio = indicators.volumeRatio ?? 1;
  const deliveryPct = indicators.deliveryPct ?? 50;
  const support = indicators.supportLevel ?? Math.min(...closes.slice(-20));
  const resistance = indicators.resistanceLevel ?? Math.max(...closes.slice(-20));
  const poc = indicators.pointOfControl;
  const vaHigh = indicators.valueAreaHigh;
  const vaLow = indicators.valueAreaLow;

  // 1. EMA trend (weight 20)
  if (price > ema20 && ema20 > ema50) {
    const w = 20;
    score += w;
    reasons.push({ label: "Bullish EMA stack", detail: `Price ₹${price.toFixed(2)} > EMA20 ₹${ema20.toFixed(2)} > EMA50 ₹${ema50.toFixed(2)} confirming uptrend.`, weight: w, bullish: true });
  } else if (price < ema20 && ema20 < ema50) {
    const w = 20;
    score -= w;
    reasons.push({ label: "Bearish EMA stack", detail: `Price ₹${price.toFixed(2)} < EMA20 ₹${ema20.toFixed(2)} < EMA50 ₹${ema50.toFixed(2)} confirming downtrend.`, weight: w, bullish: false });
  } else {
    const w = 6;
    const bullish = price > ema50;
    score += bullish ? w : -w;
    reasons.push({ label: "Mixed EMA structure", detail: `EMAs not aligned — trend uncertain.`, weight: w, bullish });
  }

  // EMA cross detection (recent 5 bars)
  const ema20Now = lastNonNull(ema20Series);
  const ema20Prev = valueAtOffset(ema20Series, 5);
  const ema50Now = lastNonNull(ema50Series);
  const ema50Prev = valueAtOffset(ema50Series, 5);
  if (ema20Now != null && ema50Now != null && ema20Prev != null && ema50Prev != null) {
    if (ema20Prev <= ema50Prev && ema20Now > ema50Now) {
      const w = 8;
      score += w;
      reasons.push({ label: "Recent golden cross", detail: "EMA20 crossed above EMA50 in the last 5 sessions.", weight: w, bullish: true });
    } else if (ema20Prev >= ema50Prev && ema20Now < ema50Now) {
      const w = 8;
      score -= w;
      reasons.push({ label: "Recent death cross", detail: "EMA20 crossed below EMA50 in the last 5 sessions.", weight: w, bullish: false });
    }
  }

  // 2. RSI state (weight 10)
  if (rsi >= 55 && rsi <= 70) {
    const w = 10;
    score += w;
    reasons.push({ label: "RSI in bullish zone", detail: `RSI(14) at ${rsi.toFixed(1)} — strong momentum without being overbought.`, weight: w, bullish: true });
  } else if (rsi > 70) {
    const w = 6;
    score -= w;
    reasons.push({ label: "RSI overbought", detail: `RSI(14) at ${rsi.toFixed(1)} — risk of pullback.`, weight: w, bullish: false });
  } else if (rsi >= 45 && rsi < 55) {
    reasons.push({ label: "RSI neutral", detail: `RSI(14) at ${rsi.toFixed(1)} — no momentum bias.`, weight: 2, bullish: rsi >= 50 });
  } else if (rsi < 30) {
    const w = 8;
    score += w;
    reasons.push({ label: "RSI oversold", detail: `RSI(14) at ${rsi.toFixed(1)} — potential bounce zone.`, weight: w, bullish: true });
  } else {
    const w = 8;
    score -= w;
    reasons.push({ label: "RSI weak", detail: `RSI(14) at ${rsi.toFixed(1)} — weak momentum.`, weight: w, bullish: false });
  }

  // RSI divergence (last 10 bars)
  const closeNow = closes[closes.length - 1] ?? price;
  const closePrev10 = closes.length > 10 ? closes[closes.length - 11]! : null;
  const rsiNow = lastNonNull(rsiSeries);
  const rsiPrev10 = valueAtOffset(rsiSeries, 10);
  if (closePrev10 != null && rsiNow != null && rsiPrev10 != null) {
    if (closeNow > closePrev10 * 1.02 && rsiNow < rsiPrev10 - 3) {
      const w = 6;
      score -= w;
      reasons.push({ label: "Bearish RSI divergence", detail: "Price made a higher high while RSI made a lower high.", weight: w, bullish: false });
    } else if (closeNow < closePrev10 * 0.98 && rsiNow > rsiPrev10 + 3) {
      const w = 6;
      score += w;
      reasons.push({ label: "Bullish RSI divergence", detail: "Price made a lower low while RSI made a higher low.", weight: w, bullish: true });
    }
  }

  // 3. Price action vs swing levels (weight 15)
  const distFromRes = (resistance - price) / resistance;
  const distFromSup = (price - support) / support;
  if (price >= resistance * 0.999 && quote.changePercent > 0.5) {
    const w = 15;
    score += w;
    reasons.push({ label: "Breakout above resistance", detail: `Price clearing ₹${resistance.toFixed(2)} swing high on positive change.`, weight: w, bullish: true });
  } else if (price <= support * 1.001 && quote.changePercent < -0.5) {
    const w = 15;
    score -= w;
    reasons.push({ label: "Breakdown below support", detail: `Price losing ₹${support.toFixed(2)} swing low on negative change.`, weight: w, bullish: false });
  } else if (distFromSup < 0.03) {
    const w = 5;
    score += w;
    reasons.push({ label: "Trading near support", detail: `Within 3% of ₹${support.toFixed(2)} — risk-reward favourable for a long.`, weight: w, bullish: true });
  } else if (distFromRes < 0.03) {
    const w = 5;
    score -= w;
    reasons.push({ label: "Trading near resistance", detail: `Within 3% of ₹${resistance.toFixed(2)} — supply zone overhead.`, weight: w, bullish: false });
  }

  // Today's candle direction
  if (quote.changePercent > 1.5) {
    const w = 4;
    score += w;
    reasons.push({ label: "Strong bullish candle today", detail: `Up ${quote.changePercent.toFixed(2)}% intraday.`, weight: w, bullish: true });
  } else if (quote.changePercent < -1.5) {
    const w = 4;
    score -= w;
    reasons.push({ label: "Strong bearish candle today", detail: `Down ${quote.changePercent.toFixed(2)}% intraday.`, weight: w, bullish: false });
  }

  // 4. Volume (weight 10)
  if (volRatio >= 1.5 && quote.changePercent > 0) {
    const w = 10;
    score += w;
    reasons.push({ label: "Volume surge on advance", detail: `Volume ${volRatio.toFixed(2)}× the 20-day average on a positive close.`, weight: w, bullish: true });
  } else if (volRatio >= 1.5 && quote.changePercent < 0) {
    const w = 10;
    score -= w;
    reasons.push({ label: "Distribution on decline", detail: `Volume ${volRatio.toFixed(2)}× the 20-day average on a negative close.`, weight: w, bullish: false });
  } else if (volRatio < 0.6) {
    reasons.push({ label: "Low volume", detail: `Volume only ${volRatio.toFixed(2)}× average — conviction is weak.`, weight: 2, bullish: false });
  }

  // 5. Delivery % (weight 10)
  if (deliveryPct >= 60 && quote.changePercent > 0) {
    const w = 10;
    score += w;
    reasons.push({ label: "High delivery on advance", detail: `Estimated delivery ${deliveryPct.toFixed(1)}% — investor accumulation, not just traders.`, weight: w, bullish: true });
  } else if (deliveryPct >= 60 && quote.changePercent < 0) {
    const w = 8;
    score -= w;
    reasons.push({ label: "High delivery on decline", detail: `Estimated delivery ${deliveryPct.toFixed(1)}% on a down day signals genuine selling.`, weight: w, bullish: false });
  } else if (deliveryPct < 30) {
    reasons.push({ label: "Low delivery (speculative)", detail: `Estimated delivery only ${deliveryPct.toFixed(1)}% — moves likely intraday-driven.`, weight: 2, bullish: false });
  }

  // 6. Volume profile (weight 10)
  if (poc != null && vaHigh != null && vaLow != null) {
    if (price > vaHigh) {
      const w = 8;
      score += w;
      reasons.push({ label: "Trading above value area", detail: `Price ₹${price.toFixed(2)} > value-area high ₹${vaHigh.toFixed(2)} — buyers in control.`, weight: w, bullish: true });
    } else if (price < vaLow) {
      const w = 8;
      score -= w;
      reasons.push({ label: "Trading below value area", detail: `Price ₹${price.toFixed(2)} < value-area low ₹${vaLow.toFixed(2)} — sellers in control.`, weight: w, bullish: false });
    } else if (Math.abs(price - poc) / poc < 0.01) {
      reasons.push({ label: "Price at point of control", detail: `Price coiling near POC ₹${poc.toFixed(2)} — directional move likely.`, weight: 3, bullish: price > ema20 });
    }
  }

  // Clamp
  score = Math.max(-100, Math.min(100, score));

  let signal: Signal;
  if (score >= 50) signal = "STRONG_BUY";
  else if (score >= 20) signal = "BUY";
  else if (score >= -20) signal = "NEUTRAL";
  else if (score >= -50) signal = "SELL";
  else signal = "STRONG_SELL";

  // Confidence: based on how many reasons agree with the signal direction
  const directional = score >= 0;
  const aligned = reasons.filter(r => r.bullish === directional).reduce((a, b) => a + b.weight, 0);
  const total = reasons.reduce((a, b) => a + b.weight, 0);
  const confidence = total === 0 ? 0 : Math.round((aligned / total) * 100);

  // Target / SL based on ATR-equivalent: use range between support & resistance
  const range = Math.max(0, resistance - support);
  let target: number | undefined;
  let stopLoss: number | undefined;
  if (signal === "BUY" || signal === "STRONG_BUY") {
    target = +(price + range * 0.6).toFixed(2);
    stopLoss = +(Math.max(support, price - range * 0.3)).toFixed(2);
  } else if (signal === "SELL" || signal === "STRONG_SELL") {
    target = +(price - range * 0.6).toFixed(2);
    stopLoss = +(Math.min(resistance, price + range * 0.3)).toFixed(2);
  }

  return {
    signal,
    score: Math.round(score),
    confidence,
    target,
    stopLoss,
    reasons,
  };
}
