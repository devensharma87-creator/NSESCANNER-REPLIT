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
import { resolveInstrumentKey } from "./upstoxInstrumentMap";
import { getPolicy } from "./policy";
import type { MarketQuote, CandleSeries, TrustedQuote, TrustedCandleSeries } from "./types";

// ---------------------------------------------------------------------------
// Shadow dispatch for quotes
// ---------------------------------------------------------------------------

/**
 * Dispatch a fire-and-forget shadow quote comparison for a canonical Kite quote.
 * Returns the canonical quote unchanged. Shadow errors and timeouts are silently
 * swallowed — this is a pure side-effect dispatch.
 */
// ---------------------------------------------------------------------------
// Single-flight deduplication (prevents duplicate shadow calls per snapshot)
// ---------------------------------------------------------------------------

const _inflightQuotes = new Map<string, number>(); // symbol → last dispatch epochMs
const DEDUP_WINDOW_MS = 15_000; // suppress duplicate shadow calls within 15s

function shouldDispatch(symbol: string): boolean {
  const now  = Date.now();
  const last = _inflightQuotes.get(symbol);
  if (last !== undefined && now - last < DEDUP_WINDOW_MS) return false;
  _inflightQuotes.set(symbol, now);
  return true;
}

/** Reset dedup state — for tests only. */
export function __resetShadowDispatchForTests(): void {
  _inflightQuotes.clear();
}

// ---------------------------------------------------------------------------
// Quote dispatch
// ---------------------------------------------------------------------------

export function dispatchShadowQuote(
  symbol:        string,
  canonicalQuote: MarketQuote,
  opts?: { isin?: string; exchange?: string },
): void {
  const policy = getPolicy();
  if (!policy.upstoxShadowEnabled || !isUpstoxConfigured()) return;
  if (!shouldDispatch(symbol)) return; // deduplicated

  // Resolve via canonical instrument mapper (indices via static bootstrap;
  // equities via ISIN from BOD cache).
  const diagnostic = resolveInstrumentKey(symbol, { isin: opts?.isin, exchange: opts?.exchange });
  if (!diagnostic.ok || !diagnostic.upstoxKey) return; // no mapping — suppress silently

  const instrumentKey = diagnostic.upstoxKey;
  fireShadow(async () => {
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
  opts?: { isin?: string; exchange?: string },
): void {
  const policy = getPolicy();
  if (!policy.upstoxShadowEnabled || !isUpstoxConfigured()) return;

  const diagnostic = resolveInstrumentKey(symbol, { isin: opts?.isin, exchange: opts?.exchange });
  if (!diagnostic.ok || !diagnostic.upstoxKey) return;

  const instrumentKey = diagnostic.upstoxKey;

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
