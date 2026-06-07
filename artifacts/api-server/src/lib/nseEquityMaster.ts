/**
 * Full NSE cash-equity master for the read-only instrument SEARCH.
 *
 * The Charting picker and the Portfolio Analyser need to resolve the full
 * ~5,000-name NSE universe, not just the ~280 curated scanner names. The live
 * Kite instrument master (`loadKiteNseEqInstruments` in kiteScanner.ts) only
 * works when a Kite session is connected; this module instead reads the
 * on-disk snapshot that the scanner persists (`.cache/kite_instruments_NSE.json`,
 * written via diskCache whenever Kite instruments are loaded), so search works
 * even when no live session is available.
 *
 * Pure-ish + cheap: it parses the (large) blob once and memoises the mapped
 * list for 24h. Returns [] when the cache is absent — callers fall back to the
 * curated catalog. This module NEVER touches signal generation, paper trading,
 * the scheduler, or any schema; it is a read-only search substrate.
 */
import { loadBlob } from "./diskCache";
import { equityYahooTicker, type ChartInstrumentMeta } from "./chartInstruments";
import { isLikelyTradeableEquity } from "./kiteScanner";

/** Subset of a Kite instrument row we care about (matches the cached dump). */
interface RawKiteInstrument {
  tradingsymbol?: string;
  name?: string;
  instrument_type?: string;
  segment?: string;
}

/** Same blob name + version the scanner writes through diskCache. */
const BLOB_NAME = "kite_instruments_NSE";
const BLOB_VERSION = 1;
const MASTER_TTL_MS = 24 * 60 * 60 * 1000;

let cache: { ts: number; list: ChartInstrumentMeta[] } | null = null;

/**
 * Load (or return cached) the full tradeable NSE cash-equity master mapped to
 * ChartInstrumentMeta. Reuses the scanner's `isLikelyTradeableEquity` filter so
 * the universe matches the live path (drops NAV trackers, SGBs, g-secs, etc.).
 */
export function loadNseEquityMaster(): ChartInstrumentMeta[] {
  if (cache && Date.now() - cache.ts < MASTER_TTL_MS) return cache.list;

  const blob = loadBlob<RawKiteInstrument[]>(BLOB_NAME, BLOB_VERSION);
  if (!blob || !Array.isArray(blob.payload)) {
    cache = { ts: Date.now(), list: [] };
    return cache.list;
  }

  const seen = new Set<string>();
  const list: ChartInstrumentMeta[] = [];
  for (const ins of blob.payload) {
    if (ins.segment !== "NSE" || ins.instrument_type !== "EQ") continue;
    const sym = ins.tradingsymbol?.trim();
    if (!sym) continue;
    if (!isLikelyTradeableEquity(sym, ins.name)) continue;
    const key = sym.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({
      symbol: sym,
      name: (ins.name || sym).trim(),
      segment: "equity",
      exchange: "NSE",
      type: "Equity",
      yahoo: equityYahooTicker(sym),
    });
  }
  list.sort((a, b) => a.symbol.localeCompare(b.symbol));
  cache = { ts: Date.now(), list };
  return list;
}
