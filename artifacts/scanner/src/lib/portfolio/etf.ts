/**
 * Portfolio Analyser — ETF reference & ETF-relevant context helpers.
 *
 * Pure, dependency-free, SEBI-neutral. ETFs are baskets, so equity fundamentals
 * (P/E, RoE, D/E …) are not applicable to them. Instead of leaving the deep-dive
 * blank, this module supplies ETF-appropriate context:
 *
 *   - the index/benchmark the ETF tracks (its published mandate)
 *   - the asset class & a short category label
 *   - a factual trend read derived from the ETF's OWN real candle closes
 *
 * Nothing here fabricates market data. The tracked-index table is a STATIC,
 * dated snapshot of each ETF's publicly-stated mandate (the same kind of curated
 * reference as the NIFTY 500 sector table). Any datum we cannot stand behind
 * (NAV, expense ratio) is intentionally omitted and surfaced as "not tracked"
 * by the UI rather than guessed.
 */
import type { InstrumentClass } from "./symbol";
import { normalizeSymbol } from "./symbol";

/** Date the tracked-index reference table was last verified (display in UI). */
export const ETF_REFERENCE_AS_OF = "2026-06-03";

export type EtfAssetClass =
  | "Equity"
  | "Gold"
  | "Silver"
  | "Debt"
  | "International Equity";

export interface EtfReference {
  /** Normalised NSE symbol (output of normalizeSymbol). */
  symbol: string;
  /** The index / benchmark the ETF is mandated to track. */
  trackedIndex: string;
  assetClass: EtfAssetClass;
  /** Short, human category descriptor. */
  category: string;
}

/**
 * Curated map of liquid NSE ETF → its published tracked index. Mirrors the
 * backend `ETF_WHITELIST`. These are factual mandates (an ETF's reason for
 * existing), not market quotes. Symbols absent here resolve to null and the UI
 * shows "not identified" rather than a guess.
 */
export const ETF_REFERENCE: readonly EtfReference[] = [
  // Nippon (Benchmark) "BeES" family
  { symbol: "NIFTYBEES", trackedIndex: "NIFTY 50", assetClass: "Equity", category: "Large-cap index" },
  { symbol: "BANKBEES", trackedIndex: "NIFTY Bank", assetClass: "Equity", category: "Banking sector index" },
  { symbol: "GOLDBEES", trackedIndex: "Domestic gold price", assetClass: "Gold", category: "Gold" },
  { symbol: "JUNIORBEES", trackedIndex: "NIFTY Next 50", assetClass: "Equity", category: "Large-cap index" },
  { symbol: "LIQUIDBEES", trackedIndex: "Overnight / liquid money market", assetClass: "Debt", category: "Liquid (cash equivalent)" },
  { symbol: "PSUBNKBEES", trackedIndex: "NIFTY PSU Bank", assetClass: "Equity", category: "PSU banking sector index" },
  { symbol: "SILVERBEES", trackedIndex: "Domestic silver price", assetClass: "Silver", category: "Silver" },
  { symbol: "ITBEES", trackedIndex: "NIFTY IT", assetClass: "Equity", category: "IT sector index" },
  { symbol: "PHARMABEES", trackedIndex: "NIFTY Pharma", assetClass: "Equity", category: "Pharma sector index" },
  { symbol: "CPSEETF", trackedIndex: "NIFTY CPSE", assetClass: "Equity", category: "Central PSU index" },
  // Other large, liquid index / sector / gold ETFs
  { symbol: "SETFNIF50", trackedIndex: "NIFTY 50", assetClass: "Equity", category: "Large-cap index" },
  { symbol: "SETFNIFBK", trackedIndex: "NIFTY Bank", assetClass: "Equity", category: "Banking sector index" },
  { symbol: "SETFGOLD", trackedIndex: "Domestic gold price", assetClass: "Gold", category: "Gold" },
  { symbol: "ICICIB22", trackedIndex: "S&P BSE Bharat 22", assetClass: "Equity", category: "PSU / disinvestment index" },
  { symbol: "MON100", trackedIndex: "NASDAQ-100", assetClass: "International Equity", category: "US tech index" },
  { symbol: "MAFANG", trackedIndex: "NYSE FANG+", assetClass: "International Equity", category: "US mega-cap tech" },
  { symbol: "MASPTOP50", trackedIndex: "S&P 500 Top 50", assetClass: "International Equity", category: "US large-cap index" },
  { symbol: "NIFTYIETF", trackedIndex: "NIFTY 50", assetClass: "Equity", category: "Large-cap index" },
  { symbol: "BANKIETF", trackedIndex: "NIFTY Bank", assetClass: "Equity", category: "Banking sector index" },
  { symbol: "GOLDIETF", trackedIndex: "Domestic gold price", assetClass: "Gold", category: "Gold" },
  { symbol: "SILVERIETF", trackedIndex: "Domestic silver price", assetClass: "Silver", category: "Silver" },
];

const REFERENCE_BY_SYMBOL: ReadonlyMap<string, EtfReference> = new Map(
  ETF_REFERENCE.map(r => [r.symbol, r]),
);

/** Look up the tracked-index reference for a symbol, or null if not curated. */
export function lookupEtfReference(symbol: string): EtfReference | null {
  return REFERENCE_BY_SYMBOL.get(normalizeSymbol(symbol)) ?? null;
}

/**
 * Resolve a human category for an ETF, preferring the curated reference and
 * falling back to the heuristic instrument class (always non-null for an ETF).
 */
export function etfCategory(symbol: string, instrumentType: InstrumentClass): string {
  const ref = lookupEtfReference(symbol);
  if (ref) return ref.category;
  // Fallback to the heuristic class label (e.g. "Gold ETF", "Index ETF").
  return instrumentType === "ETF" ? "Exchange-traded fund" : instrumentType;
}

export type TrendTone = "pos" | "neg" | "neutral";

export interface EtfTrend {
  /** Short factual sentence, e.g. "Above both 50 & 200-DMA". */
  text: string;
  tone: TrendTone;
}

/**
 * Factual trend read for an ETF from its OWN daily closes (CMP vs 50/200-DMA).
 * Returns null when neither average is available — never invents a verdict.
 * This is descriptive structure context, NOT advice or a target/stop.
 */
export function describeEtfTrend(
  cmp: number | null,
  dma50: number | null,
  dma200: number | null,
): EtfTrend | null {
  if (cmp == null || !Number.isFinite(cmp)) return null;
  const has50 = dma50 != null && Number.isFinite(dma50);
  const has200 = dma200 != null && Number.isFinite(dma200);
  if (!has50 && !has200) return null;

  const above50 = has50 ? cmp >= (dma50 as number) : null;
  const above200 = has200 ? cmp >= (dma200 as number) : null;

  if (has50 && has200) {
    if (above50 && above200) return { text: "Above both 50 & 200-DMA", tone: "pos" };
    if (!above50 && !above200) return { text: "Below both 50 & 200-DMA", tone: "neg" };
    return { text: "Between 50 & 200-DMA", tone: "neutral" };
  }
  // Only one average available.
  const label = has50 ? "50-DMA" : "200-DMA";
  const above = has50 ? above50 : above200;
  return above
    ? { text: `Above ${label}`, tone: "pos" }
    : { text: `Below ${label}`, tone: "neg" };
}
