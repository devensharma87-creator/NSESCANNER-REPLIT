/**
 * Unified instrument registry + search for the read-only Charting tab.
 *
 * Three segments are charted:
 *   - index   → NSE/BSE indices (Kite intraday + Yahoo fallback)
 *   - equity  → NSE cash equities from the curated scanner UNIVERSE
 *   - global  → major world indices (Yahoo only; Kite has no coverage)
 *
 * This module is pure (no network, no DB) so it is cheap to unit-test and
 * safe to import from both the route handler and the datafeed resolver.
 * It NEVER touches signal generation, paper trading, or any schema.
 */
import { UNIVERSE, INACTIVE_SYMBOLS, YAHOO_TICKER_OVERRIDES } from "./universe";

export type ChartSegment = "index" | "equity" | "global";

export interface ChartInstrumentMeta {
  /** Canonical symbol used by the charting tab + candle endpoint. */
  symbol: string;
  name: string;
  segment: ChartSegment;
  exchange: string | null;
  /** Human display type label. */
  type: string;
  /** Yahoo Finance ticker used for the fallback feed (and the only feed for global). */
  yahoo: string;
}

/**
 * Curated NSE/BSE indices. `yahoo` keys mirror `INDEX_TABLE` in
 * kiteIntraday.ts so the Kite path resolves a token; absence of a token
 * just means we fall back to Yahoo for that index.
 */
export const CURATED_INDICES: ChartInstrumentMeta[] = [
  { symbol: "NIFTY",      name: "NIFTY 50",            segment: "index", exchange: "NSE", type: "Index", yahoo: "^NSEI" },
  { symbol: "NIFTY500",   name: "NIFTY 500",           segment: "index", exchange: "NSE", type: "Index", yahoo: "^CRSLDX" },
  { symbol: "BANKNIFTY",  name: "NIFTY BANK",          segment: "index", exchange: "NSE", type: "Index", yahoo: "^NSEBANK" },
  { symbol: "FINNIFTY",   name: "NIFTY FIN SERVICE",   segment: "index", exchange: "NSE", type: "Index", yahoo: "^CNXFIN" },
  { symbol: "MIDCPNIFTY", name: "NIFTY MIDCAP SELECT", segment: "index", exchange: "NSE", type: "Index", yahoo: "NIFTY_MID_SELECT.NS" },
  { symbol: "NIFTYNXT50", name: "NIFTY NEXT 50",       segment: "index", exchange: "NSE", type: "Index", yahoo: "NIFTY_NEXT_50.NS" },
  { symbol: "SENSEX",     name: "SENSEX",              segment: "index", exchange: "BSE", type: "Index", yahoo: "^BSESN" },
  { symbol: "BANKEX",     name: "BANKEX",              segment: "index", exchange: "BSE", type: "Index", yahoo: "BSE-BANK.BO" },
  { symbol: "INDIAVIX",   name: "INDIA VIX",           segment: "index", exchange: "NSE", type: "Index", yahoo: "^INDIAVIX" },
  // NSE sectoral indices. Kite has no historical token for these here, so the
  // daily series resolves via the Yahoo fallback (same pattern as NIFTY500).
  // Used by the Portfolio Analyser to show each held sector's own index return.
  { symbol: "NIFTYIT",     name: "NIFTY IT",        segment: "index", exchange: "NSE", type: "Sector Index", yahoo: "^CNXIT" },
  { symbol: "NIFTYAUTO",   name: "NIFTY AUTO",      segment: "index", exchange: "NSE", type: "Sector Index", yahoo: "^CNXAUTO" },
  { symbol: "NIFTYPHARMA", name: "NIFTY PHARMA",    segment: "index", exchange: "NSE", type: "Sector Index", yahoo: "^CNXPHARMA" },
  { symbol: "NIFTYFMCG",   name: "NIFTY FMCG",      segment: "index", exchange: "NSE", type: "Sector Index", yahoo: "^CNXFMCG" },
  { symbol: "NIFTYMETAL",  name: "NIFTY METAL",     segment: "index", exchange: "NSE", type: "Sector Index", yahoo: "^CNXMETAL" },
  { symbol: "NIFTYENERGY", name: "NIFTY ENERGY",    segment: "index", exchange: "NSE", type: "Sector Index", yahoo: "^CNXENERGY" },
  { symbol: "NIFTYREALTY", name: "NIFTY REALTY",    segment: "index", exchange: "NSE", type: "Sector Index", yahoo: "^CNXREALTY" },
  { symbol: "NIFTYMEDIA",  name: "NIFTY MEDIA",     segment: "index", exchange: "NSE", type: "Sector Index", yahoo: "^CNXMEDIA" },
];

/** Major global indices. Yahoo-only — Kite has no instrument for these. */
export const CURATED_GLOBAL: ChartInstrumentMeta[] = [
  { symbol: "^GSPC",     name: "S&P 500",        segment: "global", exchange: "US", type: "Global Index", yahoo: "^GSPC" },
  { symbol: "^IXIC",     name: "NASDAQ Composite", segment: "global", exchange: "US", type: "Global Index", yahoo: "^IXIC" },
  { symbol: "^DJI",      name: "Dow Jones",      segment: "global", exchange: "US", type: "Global Index", yahoo: "^DJI" },
  { symbol: "^FTSE",     name: "FTSE 100",       segment: "global", exchange: "UK", type: "Global Index", yahoo: "^FTSE" },
  { symbol: "^GDAXI",    name: "DAX 40",         segment: "global", exchange: "DE", type: "Global Index", yahoo: "^GDAXI" },
  { symbol: "^STOXX50E", name: "Euro Stoxx 50",  segment: "global", exchange: "EU", type: "Global Index", yahoo: "^STOXX50E" },
  { symbol: "^N225",     name: "Nikkei 225",     segment: "global", exchange: "JP", type: "Global Index", yahoo: "^N225" },
  { symbol: "^HSI",      name: "Hang Seng",      segment: "global", exchange: "HK", type: "Global Index", yahoo: "^HSI" },
];

/** Yahoo ticker for an NSE equity symbol, applying rename overrides. */
export function equityYahooTicker(symbol: string): string {
  const base = YAHOO_TICKER_OVERRIDES[symbol.toUpperCase()] ?? symbol.toUpperCase();
  return `${base}.NS`;
}

/** Equity instruments derived from the scanner universe (active only). */
export function equityInstruments(): ChartInstrumentMeta[] {
  return UNIVERSE
    .filter(u => !u.inactive && !INACTIVE_SYMBOLS.has(u.symbol.toUpperCase()))
    .map(u => ({
      symbol: u.symbol,
      name: u.name,
      segment: "equity" as const,
      exchange: "NSE",
      type: "Equity",
      yahoo: equityYahooTicker(u.symbol),
    }));
}

/** Resolve a single instrument by symbol (+ optional segment hint). */
export function resolveInstrument(symbol: string, segment?: ChartSegment): ChartInstrumentMeta | null {
  const sym = symbol.toUpperCase();
  if (!segment || segment === "index") {
    const idx = CURATED_INDICES.find(i => i.symbol === sym);
    if (idx) return idx;
  }
  if (!segment || segment === "global") {
    const g = CURATED_GLOBAL.find(i => i.symbol.toUpperCase() === sym);
    if (g) return g;
  }
  if (!segment || segment === "equity") {
    const eq = equityInstruments().find(i => i.symbol.toUpperCase() === sym);
    if (eq) return eq;
  }
  return null;
}

/** Public-facing instrument shape (no internal yahoo ticker leaked). */
export interface ChartInstrumentDto {
  symbol: string;
  name: string;
  segment: ChartSegment;
  exchange: string | null;
  type: string;
  /**
   * Provenance of the row so the UI can tell the operator where a suggestion
   * came from: `curated` = the hand-maintained indices/global/equity catalog,
   * `kite_master` = the full on-disk Kite instrument master (long-tail NSE/BSE).
   */
  source: "curated" | "kite_master";
}

function toDto(m: ChartInstrumentMeta): ChartInstrumentDto {
  return {
    symbol: m.symbol,
    name: m.name,
    segment: m.segment,
    exchange: m.exchange,
    type: m.type,
    source: "curated",
  };
}

const SEARCH_LIMIT = 40;

/**
 * Search across all segments. Empty query returns a sensible default
 * (all indices + globals, no equities) so the picker is never blank.
 */
export function searchInstruments(query: string, segment?: ChartSegment): ChartInstrumentDto[] {
  const q = query.trim().toUpperCase();
  const pools: ChartInstrumentMeta[] = [];
  if (!segment || segment === "index") pools.push(...CURATED_INDICES);
  if (!segment || segment === "global") pools.push(...CURATED_GLOBAL);
  if ((!segment || segment === "equity") && q.length > 0) pools.push(...equityInstruments());

  if (q.length === 0) {
    return pools.slice(0, SEARCH_LIMIT).map(toDto);
  }

  const scored = pools
    .map(m => {
      const sym = m.symbol.toUpperCase();
      const name = m.name.toUpperCase();
      let score = -1;
      if (sym === q) score = 0;
      else if (sym.startsWith(q)) score = 1;
      else if (name.startsWith(q)) score = 2;
      else if (sym.includes(q)) score = 3;
      else if (name.includes(q)) score = 4;
      return { m, score };
    })
    .filter(s => s.score >= 0)
    .sort((a, b) => a.score - b.score);

  return scored.slice(0, SEARCH_LIMIT).map(s => toDto(s.m));
}

/** Raw Kite-master hit shape consumed by {@link mergeMasterHits}. */
export interface MasterHit {
  symbol: string;
  name: string;
  exchange: string | null;
  type: string;
}

/**
 * Merge full Kite-master hits behind the curated results, deduped by symbol so
 * a ticker listed on more than one exchange (e.g. TRIDENT/BDL/ARE&M on both NSE
 * and BSE) never appears twice. Curated rows rank first and win ties; among
 * master hits the caller passes them already NSE-ranked, so the first listing
 * for a symbol wins. BSE-only names (e.g. NSDL) survive because no curated/NSE
 * row shadows them. Pure — safe to unit-test.
 */
export function mergeMasterHits(
  curated: ChartInstrumentDto[],
  masterHits: MasterHit[],
  limit = 30,
): ChartInstrumentDto[] {
  const seen = new Set(curated.map(i => i.symbol.toUpperCase()));
  const extra: ChartInstrumentDto[] = [];
  for (const h of masterHits) {
    const key = h.symbol.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    extra.push({
      symbol: h.symbol,
      name: h.name,
      segment: "equity",
      exchange: h.exchange,
      type: h.type,
      source: "kite_master",
    });
    if (extra.length >= limit) break;
  }
  return [...curated, ...extra];
}
