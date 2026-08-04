/**
 * Upstox read-only shadow provider.
 *
 * Pack 5 governance:
 *   - SHADOW_ONLY: Upstox results never replace, average, or influence canonical Kite data.
 *   - NOT_CONFIGURED when UPSTOX_ACCESS_TOKEN is absent.
 *   - All public functions return safe error results rather than throwing into callers.
 *   - No trading, order placement, or broker execution paths.
 *   - The router dispatches shadow calls via fireShadow() — zero impact on canonical latency.
 *
 * Instrument keys: Upstox uses "exchange_segment|ISIN" format, e.g. "NSE_EQ|INE009A01021".
 * The mapping from canonical symbol → instrument_key lives in upstoxInstrumentMap.ts
 * (not yet shipped; returns NOT_CONFIGURED_MAPPING when absent).
 */

import {
  createUpstoxClient,
  resolveUpstoxConfig,
  UpstoxError,
  type UpstoxClient,
  type UpstoxCandleInterval,
} from "./upstoxClient";
import {
  setShadowRoutingState,
  getShadowRoutingState,
  recordQuoteSample,
  recordCandleSample,
  LTP_RELATIVE_TOLERANCE,
  CANDLE_CLOSE_RELATIVE_TOLERANCE,
  SHADOW_MAX_AGE_SEC,
  type ShadowQuoteMetrics,
  type ShadowCandleMetrics,
} from "./shadowState";
import { buildMeta } from "./validator";
import type { MarketQuote, CandleSeries, Candle, DataMeta } from "./types";

// ---------------------------------------------------------------------------
// Health / readiness
// ---------------------------------------------------------------------------

export interface UpstoxHealth {
  configured: boolean;
  routingState: ReturnType<typeof getShadowRoutingState>;
  lastProbeAt: string | null;
  lastError: string | null;
  circuitState: string;
}

let sharedClient: UpstoxClient | null = null;
let _lastProbeAt: string | null = null;
let _lastError:   string | null = null;

export function isUpstoxConfigured(): boolean {
  return resolveUpstoxConfig().accessToken !== null;
}

function client(): UpstoxClient {
  if (!sharedClient) sharedClient = createUpstoxClient();
  return sharedClient;
}

/** Test seam: inject a client built over a fake fetch. */
export function __setUpstoxClientForTests(c: UpstoxClient | null): void {
  sharedClient = c;
}

/** Synchronous cached health (diagnostics reads this; never does I/O). */
export function upstoxHealth(): UpstoxHealth {
  const configured = isUpstoxConfigured();
  if (!configured) {
    setShadowRoutingState("upstox", "NOT_CONFIGURED");
  }
  return {
    configured,
    routingState: getShadowRoutingState("upstox"),
    lastProbeAt:  _lastProbeAt,
    lastError:    _lastError,
    circuitState: configured ? client().circuitState() : "n/a",
  };
}

// ---------------------------------------------------------------------------
// Shadow quote fetch + parity sample recording
// ---------------------------------------------------------------------------

/**
 * Shadow-fetch a quote for a symbol and record the parity sample.
 * Returns null when Upstox is not configured or the fetch fails.
 * NEVER throws into caller.
 */
export async function shadowFetchQuote(
  symbol:        string,
  instrumentKey: string,
  canonicalQuote: MarketQuote,
): Promise<MarketQuote | null> {
  if (!isUpstoxConfigured()) return null;

  const sampledAt = new Date().toISOString();
  const t0 = Date.now();

  let shadowLtp: number | null = null;
  let shadowAgeSec: number | null = null;
  let latencyMs: number | null = null;
  let errorReason: string | null = null;

  try {
    const quoteMap = await client().getQuotes([instrumentKey]);
    latencyMs = Date.now() - t0;
    const raw = quoteMap.get(instrumentKey);
    if (raw) {
      shadowLtp = raw.last_price;
      // Compute age from provider timestamp
      const ts = Date.parse(raw.timestamp);
      if (Number.isFinite(ts)) shadowAgeSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
    } else {
      errorReason = "No quote returned for instrument key.";
    }
  } catch (err) {
    latencyMs   = Date.now() - t0;
    errorReason = err instanceof UpstoxError ? `${err.kind}: ${err.message}` : String(err);
    _lastError  = errorReason;
  }

  const canonicalLtp = canonicalQuote.lastPrice;
  let ltpAbsDiff: number | null = null;
  let ltpRelDiff: number | null = null;
  let withinTolerance = false;

  if (shadowLtp !== null && Number.isFinite(shadowLtp) && Number.isFinite(canonicalLtp) && canonicalLtp > 0) {
    ltpAbsDiff = Math.abs(shadowLtp - canonicalLtp);
    ltpRelDiff = ltpAbsDiff / canonicalLtp;
    const ageOk = shadowAgeSec === null || shadowAgeSec <= SHADOW_MAX_AGE_SEC;
    withinTolerance = ltpRelDiff <= LTP_RELATIVE_TOLERANCE && ageOk && !errorReason;
  }

  const metrics: ShadowQuoteMetrics = {
    provider:       "upstox",
    symbol,
    sampledAt,
    canonicalLtp,
    shadowLtp,
    ltpAbsDiff,
    ltpRelDiff,
    shadowAgeSec,
    canonicalAgeSec: canonicalQuote.meta.freshnessSec,
    shadowLatencyMs: latencyMs,
    withinTolerance,
    reason: errorReason ?? (withinTolerance ? null : `LTP rel diff ${ltpRelDiff?.toFixed(4) ?? "n/a"} exceeds tolerance ${LTP_RELATIVE_TOLERANCE}`),
  };
  recordQuoteSample(metrics);

  if (shadowLtp === null || errorReason) return null;

  // Build an INFO_ONLY MarketQuote from the shadow data (never branded)
  const nowMs = Date.now();
  const meta: DataMeta = buildMeta({
    source:        "upstox",
    trustTier:     "secondary_analytics",
    asOfMs:        shadowLtp !== null ? nowMs : null,
    delayed:       false,
    notForSignals: true,
    notForTradeDecisions: true,
    nowMs,
    warnings:      ["SHADOW_ONLY: Upstox data — never for trading decisions."],
  });

  return {
    symbol,
    lastPrice: shadowLtp,
    meta,
  };
}

// ---------------------------------------------------------------------------
// Shadow candle fetch + parity sample
// ---------------------------------------------------------------------------

/**
 * Shadow-fetch candles for a symbol and record the parity sample.
 * NEVER throws into caller.
 */
export async function shadowFetchCandles(
  symbol:        string,
  instrumentKey: string,
  interval:      UpstoxCandleInterval,
  from:          string,
  to:            string,
  canonicalSeries: CandleSeries,
): Promise<CandleSeries | null> {
  if (!isUpstoxConfigured()) return null;

  const sampledAt = new Date().toISOString();

  let shadowCandles: Candle[] = [];
  let errorReason: string | null = null;

  try {
    const raw = await client().getCandles(instrumentKey, interval, from, to);
    shadowCandles = raw.map((c) => ({
      t:      c.timestamp,
      open:   c.open,
      high:   c.high,
      low:    c.low,
      close:  c.close,
      volume: c.volume,
    }));
  } catch (err) {
    errorReason = err instanceof UpstoxError ? `${err.kind}: ${err.message}` : String(err);
    _lastError  = errorReason;
  }

  const canonicalCount = canonicalSeries.candles.length;
  const shadowCount    = shadowCandles.length;
  const canonicalLastClose = canonicalSeries.candles.at(-1)?.close ?? null;
  const shadowLastClose    = shadowCandles.at(-1)?.close ?? null;

  let closeAbsDiff: number | null = null;
  let closeRelDiff: number | null = null;
  let withinTolerance = false;

  if (
    canonicalLastClose !== null &&
    shadowLastClose !== null &&
    Number.isFinite(canonicalLastClose) &&
    Number.isFinite(shadowLastClose) &&
    canonicalLastClose > 0
  ) {
    closeAbsDiff = Math.abs(shadowLastClose - canonicalLastClose);
    closeRelDiff = closeAbsDiff / canonicalLastClose;
    withinTolerance = closeRelDiff <= CANDLE_CLOSE_RELATIVE_TOLERANCE && !errorReason;
  }

  const metrics: ShadowCandleMetrics = {
    provider:    "upstox",
    symbol,
    interval,
    sampledAt,
    canonicalCount,
    shadowCount: errorReason ? null : shadowCount,
    countMatch:  !errorReason && shadowCount === canonicalCount,
    canonicalLastClose,
    shadowLastClose,
    closeAbsDiff,
    closeRelDiff,
    withinTolerance,
    reason: errorReason ?? (withinTolerance ? null : `close rel diff ${closeRelDiff?.toFixed(4) ?? "n/a"}`),
  };
  recordCandleSample(metrics);

  if (errorReason || shadowCandles.length === 0) return null;

  const nowMs = Date.now();
  const meta: DataMeta = buildMeta({
    source:        "upstox",
    trustTier:     "secondary_analytics",
    asOfMs:        Date.parse(shadowCandles.at(-1)?.t ?? "") || null,
    delayed:       false,
    notForSignals: true,
    notForTradeDecisions: true,
    nowMs,
    warnings:      ["SHADOW_ONLY: Upstox candles — never for trading decisions."],
  });

  return { symbol, interval, candles: shadowCandles, meta };
}

// ---------------------------------------------------------------------------
// Probe (auth check without exposing credentials)
// ---------------------------------------------------------------------------

export async function probeUpstoxConnection(): Promise<{
  ok: boolean;
  reason: string;
}> {
  if (!isUpstoxConfigured()) {
    return { ok: false, reason: "NOT_CONFIGURED: UPSTOX_ACCESS_TOKEN absent." };
  }
  try {
    // Minimal probe: fetch quote for NIFTY 50 index (always listed)
    await client().getQuotes(["NSE_INDEX|Nifty 50"]);
    _lastProbeAt = new Date().toISOString();
    setShadowRoutingState("upstox", "SHADOW_ONLY");
    return { ok: true, reason: "Auth probe succeeded." };
  } catch (err) {
    const msg = err instanceof UpstoxError ? `${err.kind}: ${err.message}` : String(err);
    _lastError = msg;
    _lastProbeAt = new Date().toISOString();
    if (err instanceof UpstoxError && (err.kind === "auth")) {
      setShadowRoutingState("upstox", "DISABLED");
      return { ok: false, reason: `AUTH_EXPIRED: ${msg}` };
    }
    return { ok: false, reason: `UNREACHABLE: ${msg}` };
  }
}
