/**
 * Live Indian-index quotes via Zerodha Kite getQuote.
 *
 * Why this exists: the homepage strip (NIFTY 50 / BANK NIFTY / SENSEX / etc.)
 * was sourced from Yahoo's index chart endpoint inside scanner.ts. During
 * Yahoo regional outages those quotes go blank for several minutes at a
 * time even though Kite — which the user is already authenticated against
 * for option-chain work — keeps streaming live spot prices. This helper
 * batches a single `kc.getQuote([...])` call covering every index we
 * surface and caches the result for 10s so the strip refreshes smoothly
 * without hammering Kite's quote API.
 *
 * NOT MOCKED: returns null when no Kite session is active so the caller
 * can fall back to Yahoo. Never fabricates prices.
 */

import { getRestClient } from "./kiteAuth";
import { logger } from "./logger";

export interface KiteIndexQuote {
  /** Yahoo-style key the rest of the app uses (e.g. "^NSEI"). */
  yahooSymbol: string;
  /** Display name (e.g. "NIFTY 50"). */
  name: string;
  price: number;
  open: number | undefined;
  high: number | undefined;
  low: number | undefined;
  previousClose: number;
  change: number;
  changePercent: number;
  asOf: number;
}

interface RawKiteQuote {
  last_price: number;
  net_change?: number;
  ohlc?: { open?: number; high?: number; low?: number; close?: number };
  timestamp?: string;
}

// Yahoo-symbol → Kite tradingsymbol mapping for every index the homepage
// strip and pre-market preview surface. The Kite key MUST be the exact
// string Kite accepts for `getQuote` (verified against the option-chain
// spotKey() table).
const INDEX_MAP: Array<{ yahoo: string; kite: string; name: string }> = [
  { yahoo: "^NSEI",                 kite: "NSE:NIFTY 50",          name: "NIFTY 50" },
  { yahoo: "^NSEBANK",              kite: "NSE:NIFTY BANK",        name: "NIFTY BANK" },
  { yahoo: "^CNXIT",                kite: "NSE:NIFTY IT",          name: "NIFTY IT" },
  { yahoo: "^CNXAUTO",              kite: "NSE:NIFTY AUTO",        name: "NIFTY AUTO" },
  { yahoo: "^CNXPHARMA",            kite: "NSE:NIFTY PHARMA",      name: "NIFTY PHARMA" },
  { yahoo: "^CNXFMCG",              kite: "NSE:NIFTY FMCG",        name: "NIFTY FMCG" },
  { yahoo: "^BSESN",                kite: "BSE:SENSEX",            name: "SENSEX" },
  { yahoo: "NIFTY_FIN_SERVICE.NS",  kite: "NSE:NIFTY FIN SERVICE", name: "FINNIFTY" },
  { yahoo: "^INDIAVIX",             kite: "NSE:INDIA VIX",         name: "INDIA VIX" },
];

interface CacheEntry { ts: number; data: Map<string, KiteIndexQuote> }
let cache: CacheEntry | null = null;
const TTL_MS = 10_000; // 10s — strip refresh cadence

/**
 * Fetch live quotes for every supported Indian index in a single Kite
 * batch. Returns a map keyed by yahoo-symbol so callers can swap in for
 * existing Yahoo-keyed code paths without restructuring. Returns null
 * when no Kite session is active (caller should fall back to Yahoo).
 */
export async function getKiteIndexQuotes(): Promise<Map<string, KiteIndexQuote> | null> {
  if (cache && Date.now() - cache.ts < TTL_MS) return cache.data;

  const client = await getRestClient();
  if (!client) return null;
  const { kc } = client;

  const kiteKeys = INDEX_MAP.map(i => i.kite);
  let raw: Record<string, RawKiteQuote>;
  try {
    raw = (await kc.getQuote(kiteKeys)) as Record<string, RawKiteQuote>;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Kite index quote batch failed");
    // Serve stale cache (≤10x TTL) rather than going blank during a
    // transient Kite hiccup. Never fake the data.
    if (cache && Date.now() - cache.ts < TTL_MS * 10) return cache.data;
    return null;
  }

  const out = new Map<string, KiteIndexQuote>();
  for (const m of INDEX_MAP) {
    const q = raw[m.kite];
    if (!q || typeof q.last_price !== "number" || !(q.last_price > 0)) continue;
    const price = q.last_price;
    const prev = q.ohlc?.close ?? price;
    const change = q.net_change ?? (price - prev);
    const pct = prev > 0 ? (change / prev) * 100 : 0;
    const ts = q.timestamp ? new Date(q.timestamp).getTime() : Date.now();
    out.set(m.yahoo, {
      yahooSymbol: m.yahoo,
      name: m.name,
      price,
      open: q.ohlc?.open,
      high: q.ohlc?.high,
      low: q.ohlc?.low,
      previousClose: prev,
      change,
      changePercent: pct,
      asOf: ts,
    });
  }

  if (out.size > 0) {
    cache = { ts: Date.now(), data: out };
    logger.info({ count: out.size }, "Kite index quote batch refreshed");
    return out;
  }
  // All quotes empty — return whatever stale cache we have.
  if (cache) return cache.data;
  return null;
}
