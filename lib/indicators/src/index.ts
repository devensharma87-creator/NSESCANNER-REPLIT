/**
 * Canonical pure technical-indicator primitives shared across the API server,
 * the NSE scanner charting tab, and the global scanner.
 *
 * SINGLE SOURCE OF TRUTH for EMA and the (series) Wilder RSI. These two were
 * previously copy-pasted — byte-for-byte identical — into the api-server,
 * scanner-charting, and global-scanner indicator modules. Divergence between
 * the live scanner and the charts/backtester is a real risk, so they live here
 * exactly once. The implementations are taken verbatim from the
 * trading-critical api-server copy; every consumer re-exports from here and is
 * therefore guaranteed identical output (locked by golden tests in
 * artifacts/api-server/src/lib/indicatorsShared.test.ts).
 *
 * DELIBERATELY NOT HERE: ATR, MACD signal handling, SMA (scalar), VWAP and the
 * portfolio scalar RSI. Those copies use genuinely DIFFERENT algorithms
 * (api-server ATR is EMA-smoothed vs global's Wilder RMA; api-server MACD seeds
 * the signal over zero-filled nulls vs global slicing from the first real
 * value; portfolio rsi14 returns 50 on a flat series vs the series RSI's 100;
 * VWAP has session-reset/fallback variants). Unifying them would SILENTLY
 * change output, so they intentionally remain local to each consumer.
 */

/**
 * Exponential Moving Average, seeded with the SMA of the first `period`
 * values (standard convention). Index-aligned with the input; `null` for
 * warm-up bars before index `period - 1`. Returns an all-null series when
 * `values.length < period`.
 */
export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i]!;
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/**
 * Wilder's RSI (default period 14). Index-aligned; `null` until `period`
 * deltas are available (first value at index `period`). A window whose
 * average loss is zero yields 100.
 */
export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period + 1) return out;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const ch = values[i]! - values[i - 1]!;
    if (ch >= 0) gains += ch;
    else losses -= ch;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const ch = values[i]! - values[i - 1]!;
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}
