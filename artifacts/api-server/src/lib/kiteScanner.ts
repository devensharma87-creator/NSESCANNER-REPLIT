/**
 * Kite-first universe and quote loader for the full NSE EQ scanner.
 *
 * Why this exists: the previous full-NSE scanner pulled every price through
 * Yahoo Finance. Yahoo's intraday endpoint is geo-blocked from many cloud
 * hosting regions (including the one this app runs in), so production was
 * stuck at "0 stocks shown" indefinitely while the locally-developed code
 * looked fine. Kite is authenticated, never geo-blocked, and supports
 * batched quote calls of up to 500 instruments — enough to cover the
 * entire ~2,500-symbol NSE EQ universe in a handful of requests.
 *
 * This module:
 *   - Loads the NSE EQ instrument list from `kc.getInstruments("NSE")`
 *     once per 24h.
 *   - Pulls live quotes for every requested symbol via batched
 *     `kc.getQuote(["NSE:SYMBOL", ...])` calls.
 *   - Returns plain-shaped quote rows (price, OHLC, volume, change). No
 *     synthetic numbers — if Kite is logged out we return `null` and the
 *     caller falls back to its existing path.
 */

import { logger } from "./logger";
import { getRestClient } from "./kiteAuth";

export interface KiteScannerInstrument {
  tradingsymbol: string;
  instrumentToken: number;
  name: string;
}

export interface KiteScannerQuote {
  symbol: string;
  name: string;
  lastPrice: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number;
  changePercent: number;
  averagePrice?: number;
  buyQty?: number;
  sellQty?: number;
  ts: number;
}

interface KiteRawInstrument {
  instrument_token: number;
  exchange_token: number;
  tradingsymbol: string;
  name?: string;
  exchange: string;
  segment: string;
  instrument_type: string;
}

interface KiteRawQuote {
  instrument_token: number;
  last_price?: number;
  net_change?: number;
  volume?: number;
  average_price?: number;
  buy_quantity?: number;
  sell_quantity?: number;
  ohlc?: { open?: number; high?: number; low?: number; close?: number };
}

const INSTRUMENTS_TTL_MS = 24 * 3600 * 1000;
// Kite's documented per-call quote limit is 500 symbols. Stay safely under.
const QUOTE_BATCH = 480;

interface InstrumentCache {
  fetchedAt: number;
  bySymbol: Map<string, KiteScannerInstrument>;
  list: KiteScannerInstrument[];
}

let instrumentsCache: InstrumentCache | null = null;
let instrumentsInflight: Promise<InstrumentCache | null> | null = null;

/**
 * Load (or return cached) NSE EQ instrument list from Kite.
 * Returns null if Kite isn't logged in or the call fails — caller decides
 * how to fall back.
 */
export async function loadKiteNseEqInstruments(): Promise<InstrumentCache | null> {
  if (instrumentsCache && Date.now() - instrumentsCache.fetchedAt < INSTRUMENTS_TTL_MS) {
    return instrumentsCache;
  }
  if (instrumentsInflight) return instrumentsInflight;

  instrumentsInflight = (async () => {
    const ctx = await getRestClient();
    if (!ctx) {
      logger.debug("Kite scanner: no active session, skipping instrument load");
      return null;
    }
    try {
      const raw = (await ctx.kc.getInstruments("NSE")) as KiteRawInstrument[];
      const bySymbol = new Map<string, KiteScannerInstrument>();
      const list: KiteScannerInstrument[] = [];
      for (const ins of raw) {
        // Only cash-segment EQ — exclude indices, ETFs handled separately, BE-series etc.
        if (ins.segment !== "NSE" || ins.instrument_type !== "EQ") continue;
        if (!ins.tradingsymbol) continue;
        const item: KiteScannerInstrument = {
          tradingsymbol: ins.tradingsymbol,
          instrumentToken: ins.instrument_token,
          name: (ins.name || ins.tradingsymbol).trim(),
        };
        bySymbol.set(ins.tradingsymbol, item);
        list.push(item);
      }
      list.sort((a, b) => a.tradingsymbol.localeCompare(b.tradingsymbol));
      instrumentsCache = { fetchedAt: Date.now(), bySymbol, list };
      logger.info({ count: list.length }, "Kite NSE EQ instruments loaded");
      return instrumentsCache;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "Kite NSE EQ instruments fetch failed");
      return null;
    }
  })();

  try {
    return await instrumentsInflight;
  } finally {
    instrumentsInflight = null;
  }
}

/**
 * Batched quote loader. Returns a Map<symbol, KiteScannerQuote> for every
 * symbol Kite returned a usable LTP for. Symbols that fail (delisted,
 * suspended, no trades today) are simply omitted from the map — never
 * faked. Returns null if Kite isn't reachable at all.
 */
export async function loadKiteQuotes(symbols: string[]): Promise<Map<string, KiteScannerQuote> | null> {
  if (symbols.length === 0) return new Map();
  const ctx = await getRestClient();
  if (!ctx) return null;

  const out = new Map<string, KiteScannerQuote>();
  const ts = Date.now();
  const inst = await loadKiteNseEqInstruments();
  const nameLookup = inst?.bySymbol ?? new Map<string, KiteScannerInstrument>();

  for (let i = 0; i < symbols.length; i += QUOTE_BATCH) {
    const slice = symbols.slice(i, i + QUOTE_BATCH);
    const keys = slice.map(s => `NSE:${s}`);
    let raw: Record<string, KiteRawQuote>;
    try {
      raw = (await ctx.kc.getQuote(keys)) as Record<string, KiteRawQuote>;
    } catch (err) {
      // A single batch failing shouldn't abort the whole scan — log and
      // continue. Subsequent batches may still succeed.
      logger.warn(
        { err: (err as Error).message, batchStart: i, batchSize: slice.length },
        "Kite scanner: getQuote batch failed",
      );
      continue;
    }
    for (const sym of slice) {
      const q = raw[`NSE:${sym}`];
      if (!q) continue;
      const lp = q.last_price;
      const close = q.ohlc?.close;
      if (lp == null || !Number.isFinite(lp) || lp <= 0) continue;
      const open = q.ohlc?.open ?? lp;
      const high = q.ohlc?.high ?? lp;
      const low = q.ohlc?.low ?? lp;
      const prev = (close != null && Number.isFinite(close) && close > 0) ? close : open;
      const change = lp - prev;
      const changePct = prev > 0 ? (change / prev) * 100 : 0;
      // Sanity guard: anything beyond ±35% is almost always a corp-action
      // glitch (split/bonus not reflected in prev close yet). Drop rather
      // than ship a fake 80,000% gainer.
      if (!Number.isFinite(changePct) || Math.abs(changePct) > 35) continue;
      out.set(sym, {
        symbol: sym,
        name: nameLookup.get(sym)?.name ?? sym,
        lastPrice: lp,
        open,
        high,
        low,
        close: prev,
        volume: q.volume ?? 0,
        change,
        changePercent: changePct,
        averagePrice: q.average_price,
        buyQty: q.buy_quantity,
        sellQty: q.sell_quantity,
        ts,
      });
    }
  }

  return out;
}
