/**
 * Shadow dispatch helpers — integrate shadow providers into the canonical router
 * without any risk of affecting canonical results.
 *
 * Pack 5 rules enforced here:
 *   1. Shadow is dispatched fire-and-forget via fireShadow().
 *   2. Canonical result is immutable before and after shadow dispatch.
 *   3. Shadow timeout (5s) is enforced — slow shadow never blocks caller.
 *   4. Any shadow error is swallowed — caller always gets the Kite result.
 *   5. No averaging, no substitution, no silent fallback.
 */

import { fireShadow, assertCanonicalUnchanged } from "./shadowState";
import { shadowFetchQuote, shadowFetchCandles, isUpstoxConfigured } from "./upstoxProvider";
import { getPolicy } from "./policy";
import type { MarketQuote, CandleSeries, TrustedQuote, TrustedCandleSeries } from "./types";

// ---------------------------------------------------------------------------
// Instrument key resolution (stub — no mapping file in Pack 5)
// ---------------------------------------------------------------------------

/**
 * Resolve canonical symbol → Upstox instrument_key.
 * Pack 5: static lookup for well-known indices and equities.
 * Full CSV-based mapping is a follow-on pack.
 */
function resolveUpstoxKey(symbol: string): string | null {
  // Index instrument keys (Upstox V2 format)
  const STATIC_INDEX_MAP: Record<string, string> = {
    "^NSEI":        "NSE_INDEX|Nifty 50",
    "^NSEBANK":     "NSE_INDEX|Nifty Bank",
    "NIFTY":        "NSE_INDEX|Nifty 50",
    "BANKNIFTY":    "NSE_INDEX|Nifty Bank",
    "SENSEX":       "BSE_INDEX|SENSEX",
  };
  const upper = symbol.toUpperCase();
  return STATIC_INDEX_MAP[upper] ?? null;
  // Equity mapping requires ISIN lookup — deferred to mapping pack.
}

// ---------------------------------------------------------------------------
// Shadow dispatch for quotes
// ---------------------------------------------------------------------------

/**
 * Dispatch a fire-and-forget shadow quote comparison for a canonical Kite quote.
 * Returns the canonical quote unchanged. Shadow errors and timeouts are silently
 * swallowed — this is a pure side-effect dispatch.
 */
export function dispatchShadowQuote(
  symbol:        string,
  canonicalQuote: MarketQuote,
): void {
  const policy = getPolicy();
  if (!policy.upstoxShadowEnabled || !isUpstoxConfigured()) return;

  const instrumentKey = resolveUpstoxKey(symbol);
  if (!instrumentKey) return; // No static mapping for this symbol; skip

  fireShadow(async () => {
    // Shadow fetch — result discarded; only parity sample is stored
    await shadowFetchQuote(symbol, instrumentKey, canonicalQuote);
  });
}

/**
 * Dispatch a fire-and-forget shadow candle comparison.
 * canonicalSeries is returned unchanged regardless of shadow outcome.
 */
export function dispatchShadowCandles(
  symbol:          string,
  canonicalSeries: CandleSeries,
  interval:        string,
  from:            string,
  to:              string,
): void {
  const policy = getPolicy();
  if (!policy.upstoxShadowEnabled || !isUpstoxConfigured()) return;

  const instrumentKey = resolveUpstoxKey(symbol);
  if (!instrumentKey) return;

  // Map canonical interval names to Upstox interval names
  const INTERVAL_MAP: Record<string, string> = {
    "minute":   "1minute",
    "3minute":  "3minute",
    "5minute":  "5minute",
    "10minute": "10minute",
    "15minute": "15minute",
    "30minute": "30minute",
    "60minute": "60minute",
    "day":      "day",
  };
  const upstoxInterval = INTERVAL_MAP[interval];
  if (!upstoxInterval) return;

  fireShadow(async () => {
    await shadowFetchCandles(
      symbol,
      instrumentKey,
      upstoxInterval as import("./upstoxClient").UpstoxCandleInterval,
      from,
      to,
      canonicalSeries,
    );
  });
}

// ---------------------------------------------------------------------------
// Non-interference assertion helper (used in tests)
// ---------------------------------------------------------------------------

export { assertCanonicalUnchanged };
