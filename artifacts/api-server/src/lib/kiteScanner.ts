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
  /**
   * Set of tradingsymbols (upper-case) recognised as ETFs in the live Kite NSE
   * instrument master. Built data-driven from `looksLikeEtf` over the RAW rows
   * (i.e. BEFORE the `isLikelyTradeableEquity` filter, so ETFs the equity
   * scanner intentionally drops — IETF-suffixed, LIQUIDBEES, etc. — are still
   * captured here). Powers `isRecognisedEtf` so the portfolio analyser can
   * quote any genuine NSE ETF without hand-maintaining a whitelist.
   */
  etfSymbols: Set<string>;
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
export function isLikelyTradeableEquity(sym: string, name?: string): boolean {
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
 * Pure heuristic: does this NSE instrument look like a tradeable ETF unit?
 *
 * Detects ETFs data-driven from a Kite instrument row (tradingsymbol + the
 * descriptive `name` field) so we don't have to hand-maintain a per-symbol
 * whitelist. Recognises:
 *   - Nippon "BeES" family               → `*BEES`        (NIFTYBEES, GOLDBEES, LIQUIDBEES …)
 *   - issuer ETF naming                   → `*ETF`/`*IETF` (CPSEETF, NIFTYIETF, SETFGOLD …)
 *   - anything whose name says "ETF" / "EXCHANGE TRADED" (covers MON100, ICICIB22, …)
 *
 * Explicitly EXCLUDES `*INAV` rows — those are indicative-NAV feed
 * instruments, not tradeable units, and would never return a real quote.
 */
export function looksLikeEtf(symbol: string, name?: string): boolean {
  const s = (symbol ?? "").trim().toUpperCase();
  if (!s) return false;
  const n = (name ?? "").toUpperCase();
  if (/INAV$/.test(s)) return false;     // indicative-NAV feed, not a tradeable unit
  if (/BEES$/.test(s)) return true;      // Nippon BeES family
  if (/I?ETF$/.test(s)) return true;     // ...ETF or ...IETF issuer naming
  if (/\bETF\b/.test(n)) return true;    // descriptive name says ETF
  if (/EXCHANGE\s+TRADED/.test(n)) return true;
  return false;
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
      const etfSymbols = new Set<string>();
      let dropped = 0;
      for (const ins of raw) {
        // Only cash-segment EQ — exclude indices, ETFs handled separately, BE-series etc.
        if (ins.segment !== "NSE" || ins.instrument_type !== "EQ") continue;
        if (!ins.tradingsymbol) continue;
        // Data-driven ETF capture: detect ETFs from the RAW row BEFORE the
        // tradeable-equity filter below (which intentionally drops *IETF,
        // LIQUIDBEES, etc.). This powers the portfolio analyser's ETF quote
        // path without a hand-maintained whitelist.
        if (looksLikeEtf(ins.tradingsymbol, ins.name)) {
          etfSymbols.add(ins.tradingsymbol.toUpperCase());
        }
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
      instrumentsCache = { fetchedAt: Date.now(), bySymbol, list, etfSymbols };
      logger.info(
        { count: list.length, dropped, etfs: etfSymbols.size },
        "Kite NSE EQ instruments loaded (post-filter)",
      );
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
 * Curated SEED of well-known, liquid NSE ETFs the portfolio analyser can
 * resolve a live CMP for. The primary recognition path is now data-driven
 * (`isRecognisedEtf` validates against the live Kite instrument master via
 * `InstrumentCache.etfSymbols`); this seed is the OFFLINE fallback — when Kite
 * is logged out the master can't be loaded, so we still recognise these
 * household-name ETFs (and then 503 because the quote source itself is down).
 *
 * These ETFs are NOT in the curated/scored equity catalog, so `/stocks/:symbol`
 * 404s on them — that's why the lightweight `GET /etf/:symbol/quote` branch
 * exists.
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

/** True when `symbol` is in the curated offline seed of liquid NSE ETFs. */
export function isWhitelistedEtf(symbol: string): boolean {
  return ETF_WHITELIST.has(symbol.trim().toUpperCase());
}

/**
 * Decide whether `symbol` is a recognised NSE ETF the portfolio analyser may
 * resolve a live CMP for. Data-driven by default, with an honest offline
 * fallback:
 *
 *   1. Curated seed (`ETF_WHITELIST`) → always recognised.
 *   2. Otherwise validate against the live Kite instrument master — recognised
 *      iff the symbol is in `InstrumentCache.etfSymbols` (built via
 *      `looksLikeEtf`). This is the data-driven expansion: ANY genuine NSE ETF
 *      in Kite's dump is recognised, no per-symbol maintenance.
 *   3. If the master can't be loaded (Kite logged out), fall back to the pure
 *      `looksLikeEtf` symbol heuristic so genuinely-unknown non-ETF symbols
 *      still 404, while plausible ETFs proceed (and then 503 from the quote
 *      step because Kite is offline). We never fabricate a price either way.
 */
export async function isRecognisedEtf(symbol: string): Promise<boolean> {
  return (await checkEtfRecognition(symbol)).recognised;
}

/**
 * How a symbol came to be recognised (or not) as an NSE ETF. Mirrors the
 * decision tree in {@link checkEtfRecognition} so the owner-only diagnostic
 * can explain exactly why a given symbol prices (or doesn't).
 *
 *   - "seed"              → in the curated offline `ETF_WHITELIST`
 *   - "master"            → found in the live Kite instrument master
 *   - "not_etf"           → master loaded, symbol absent (genuinely not an ETF)
 *   - "kite_offline"      → master unavailable; result is the pure-heuristic
 *                           fallback (recognised iff `looksLikeEtf` matches)
 */
export type EtfRecognitionSource = "seed" | "master" | "not_etf" | "kite_offline";

export interface EtfSymbolRecognition {
  symbol: string;
  recognised: boolean;
  source: EtfRecognitionSource;
  kiteInstrumentsLoaded: boolean;
  instrumentsFetchedAt: string | null;
}

/**
 * Resolve a single symbol's ETF-recognition outcome, reusing the live Kite
 * instrument cache (no extra Kite calls beyond the 24h instrument load). This
 * is the single source of truth for {@link isRecognisedEtf}; the owner-only
 * diagnostic uses it to answer "why is my ETF showing unavailable?".
 */
export async function checkEtfRecognition(symbol: string): Promise<EtfSymbolRecognition> {
  const sym = symbol.trim().toUpperCase();
  // Seed short-circuit FIRST — matches the original `isRecognisedEtf` and
  // avoids triggering an instrument load just to recognise a household-name
  // ETF. Report the cache freshness only if the master is already warm.
  if (sym && ETF_WHITELIST.has(sym)) {
    return {
      symbol: sym,
      recognised: true,
      source: "seed",
      kiteInstrumentsLoaded: instrumentsCache != null,
      instrumentsFetchedAt: instrumentsCache ? new Date(instrumentsCache.fetchedAt).toISOString() : null,
    };
  }
  const inst = await loadKiteNseEqInstruments();
  const kiteInstrumentsLoaded = inst != null;
  const instrumentsFetchedAt = inst ? new Date(inst.fetchedAt).toISOString() : null;
  if (inst) {
    const inMaster = sym ? inst.etfSymbols.has(sym) : false;
    return { symbol: sym, recognised: inMaster, source: inMaster ? "master" : "not_etf", kiteInstrumentsLoaded, instrumentsFetchedAt };
  }
  // Kite offline — can't validate against the master; use the pure heuristic.
  return { symbol: sym, recognised: sym ? looksLikeEtf(sym) : false, source: "kite_offline", kiteInstrumentsLoaded: false, instrumentsFetchedAt: null };
}

/**
 * Read-only snapshot of the ETF-recognition data plane for the owner-only
 * Infra Health dashboard: how many NSE ETFs the live Kite master currently
 * recognises, the curated offline seed size, and the instrument-cache
 * freshness. Reuses the existing 24h instrument cache — no extra Kite calls.
 *
 * `detectedCount`/`instrumentsFetchedAt` are null when Kite is logged out
 * (the master can't be loaded) — never faked.
 */
export interface EtfRecognitionDiagnostics {
  seedCount: number;
  detectedCount: number | null;
  instrumentsFetchedAt: string | null;
  kiteInstrumentsLoaded: boolean;
}

export async function getEtfRecognitionDiagnostics(): Promise<EtfRecognitionDiagnostics> {
  const inst = await loadKiteNseEqInstruments();
  return {
    seedCount: ETF_WHITELIST.size,
    detectedCount: inst ? inst.etfSymbols.size : null,
    instrumentsFetchedAt: inst ? new Date(inst.fetchedAt).toISOString() : null,
    kiteInstrumentsLoaded: inst != null,
  };
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
