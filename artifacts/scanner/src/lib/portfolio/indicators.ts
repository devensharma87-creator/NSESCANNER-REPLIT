/**
 * Portfolio Analyser — pure price-derived indicators.
 *
 * Used only as a fallback when getStockDetail does not supply DMA/RSI (e.g. for
 * ETFs resolved via the chart-candles path). Everything is computed from REAL
 * candle closes; when there is insufficient history the function returns null
 * (never a fabricated value).
 */

/** Simple moving average of the last `period` closes. Null if too few closes. */
export function sma(closes: number[], period: number): number | null {
  if (period <= 0 || closes.length < period) return null;
  const slice = closes.slice(-period);
  let sum = 0;
  for (const c of slice) {
    if (!Number.isFinite(c)) return null;
    sum += c;
  }
  return sum / period;
}

/**
 * Wilder's RSI over `period` closes. Needs at least period+1 closes.
 * Returns 0..100, or null when there is insufficient data.
 */
export function rsi14(closes: number[], period = 14): number | null {
  if (period <= 0 || closes.length < period + 1) return null;
  for (const c of closes) {
    if (!Number.isFinite(c)) return null;
  }

  let gain = 0;
  let loss = 0;
  // Seed averages over the first `period` deltas.
  for (let i = 1; i <= period; i += 1) {
    const delta = closes[i] - closes[i - 1];
    if (delta >= 0) gain += delta;
    else loss -= delta;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;

  // Wilder smoothing over the remainder.
  for (let i = period + 1; i < closes.length; i += 1) {
    const delta = closes[i] - closes[i - 1];
    const up = delta > 0 ? delta : 0;
    const down = delta < 0 ? -delta : 0;
    avgGain = (avgGain * (period - 1) + up) / period;
    avgLoss = (avgLoss * (period - 1) + down) / period;
  }

  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
