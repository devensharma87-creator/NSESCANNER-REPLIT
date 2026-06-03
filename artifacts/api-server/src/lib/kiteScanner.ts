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
 * Decide whether a Kite NSE-segment EQ instrument is a real, tradeable
 * equity (or ETF) — versus a mutual-fund NAV tracker, sovereign gold bond,
 * govt-security, T-bill, or other listed-but-not-actively-traded scrip.
 *
 * Kite's `kc.getInstruments("NSE")` returns ~9,600 rows where
 * `instrument_type === "EQ"`, but only ~2,500 of those are actually
 * traded equities. The rest are funds & bonds whose `getQuote` always
 * returns zeros (no LTP, no volume, no OHLC) — they pollute the scanner
 * with thousands of useless rows. We filter using both tradingsymbol
 * patterns and the descriptive `name` field.
 *
 * Whitelist note: real ETFs that traders use (NIFTYBEES, BANKBEES,
 * GOLDBEES, JUNIORBEES, etc.) are kept — they have proper trading
 * volume and belong in the scanner.
 */
function isLikelyTradeableEquity(sym: string, name?: string): boolean {
  // Mutual-fund / NAV tracker tradingsymbol patterns
  if (/INAV$/.test(sym)) return false;          // direct/regular NAV trackers
  if (/IETF$/.test(sym)) return false;          // international ETF NAV trackers
  if (/LIQUID(CASE|BEES|ADD|FUND)?$/.test(sym)) return false; // liquid funds

  // Sovereign Gold Bonds — symbol always starts with "SGB"
  if (/^SGB/.test(sym)) return false;

  // Govt-securities (e.g. "GS28", "GS720729") and T-Bills
  if (/^GS\d/.test(sym)) return false;
  if (/^TB\d/.test(sym)) return false;
  if (/^\d{2}[A-Z]{2,4}\d/.test(sym)) return false; // year-prefixed g-sec/T-bill codes

  // Name-based filter — Kite's `name` field is descriptive for fund products.
  // Plain equities have company names ("RELIANCE INDUSTRIES LIMITED") which
  // never match these tokens.
  const n = (name || "").toUpperCase();
  if (
    /MUTUAL FUND/.test(n) ||
    /LIQUID FUND/.test(n) ||
    /INDEX FUND/.test(n) ||
    /GILT FUND/.test(n) ||
    /OVERNIGHT FUND/.test(n) ||
    /ARBITRAGE FUND/.test(n) ||
    /MONEY MARKET FUND/.test(n) ||
    /CORPORATE BOND FUND/.test(n) ||
    /SOVEREIGN GOLD/.test(n) ||
    /GOVT SECURIT/.test(n) ||
    /TREASURY BILL/.test(n) ||
    /STATE DEVELOPMENT LOAN/.test(n)
  ) {
    return false;
  }

  return true;
}

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
      let dropped = 0;
      for (const ins of raw) {
        // Only cash-segment EQ — exclude indices, ETFs handled separately, BE-series etc.
        if (ins.segment !== "NSE" || ins.instrument_type !== "EQ") continue;
        if (!ins.tradingsymbol) continue;
        // Kite's "NSE EQ" bucket includes ~7000 non-tradeable instruments —
        // mutual-fund NAV trackers (HDF100INAV, HDFCLIQUID, *INAV/*IETF),
        // Sovereign Gold Bonds (SGBxxx), Govt-securities (GS*), T-Bills (TB*),
        // and other listed-but-not-actively-traded scrips. They all return
        // 0/zero-OHLC quotes and pollute the scanner with thousands of
        // useless rows. Filter them out so the universe is the ~2,500 real
        // tradeable equities + bona-fide ETFs (NIFTYBEES, BANKBEES, etc).
        if (!isLikelyTradeableEquity(ins.tradingsymbol, ins.name)) {
          dropped++;
          continue;
        }
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
      logger.info({ count: list.length, dropped }, "Kite NSE EQ instruments loaded (post-filter)");
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
 * Whitelist of well-known, liquid NSE ETFs the portfolio analyser can resolve
 * a live CMP for. These ETFs are present in Kite's NSE instrument master (and
 * pass `isLikelyTradeableEquity`), so `getQuote` returns a real LTP — but they
 * are NOT in the curated/scored equity catalog, so the `/stocks/:symbol`
 * detail endpoint 404s on them. This list powers the lightweight Kite-quote
 * branch (`GET /etf/:symbol/quote`).
 *
 * Keep this to genuinely liquid, actively-traded ETFs. Never widen it to thin
 * scrips whose `getQuote` returns zeros — those would surface as faked rows.
 */
export const ETF_WHITELIST: ReadonlySet<string> = new Set<string>([
  // Nippon (Benchmark) "BeES" family
  "NIFTYBEES", "BANKBEES", "GOLDBEES", "JUNIORBEES", "LIQUIDBEES",
  "PSUBNKBEES", "SILVERBEES", "ITBEES", "PHARMABEES", "CPSEETF",
  // Other large, liquid index/sector/gold ETFs
  "SETFNIF50", "SETFNIFBK", "SETFGOLD", "ICICIB22",
  "MON100", "MAFANG", "MASPTOP50",
  "NIFTYIETF", "BANKIETF", "GOLDIETF", "SILVERIETF",
]);

/** True when `symbol` is a recognised, whitelisted liquid NSE ETF. */
export function isWhitelistedEtf(symbol: string): boolean {
  return ETF_WHITELIST.has(symbol.trim().toUpperCase());
}

/**
 * Fetch a single live ETF quote from Kite. Returns the quote, or `null` when
 * Kite is logged out / unreachable (caller should surface "live quote
 * unavailable" rather than fake a price). A logged-in Kite that simply has no
 * quote for the symbol resolves to `undefined` inside the map — the caller
 * distinguishes the two via the outer `null`.
 */
export async function loadKiteEtfQuote(symbol: string): Promise<KiteScannerQuote | null> {
  const sym = symbol.trim().toUpperCase();
  const quotes = await loadKiteQuotes([sym]);
  if (!quotes) return null; // Kite offline — never fabricate
  return quotes.get(sym) ?? null;
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
