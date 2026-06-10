/**
 * Deep Scan — universal lookup + snapshot for any NSE stock or Indian index.
 *
 *  - `searchUniverse(q)`   — fuzzy match across UNIVERSE + Indian index list
 *  - `getDeepSnapshot()`    — chart + EMAs (20/50/100/200) + VWAP series + volume
 *                             + 52W high/low + multi-period returns + (for stocks)
 *                             attached fundamentals & profile
 *
 * Designed to be source-of-truth-agnostic: the chart/quote come from Yahoo
 * (works from any IP, ~15min delayed); fundamentals reuse fetchFundamentals().
 */

import { UNIVERSE, getEntry, INDEX_CONSTITUENTS, type UniverseEntry } from "./universe";
import { fetchChart, fetchIntraday, fetchFundamentals, yahooTickerFor, type YahooFundamentals } from "./yahoo";
import { ema } from "./indicators";
import { getAllSymbols } from "./nseBhavcopy";
import { buildSourceProvenance, type SourceProvenance } from "./scannerProvenance";
import type { ChartTimeframe } from "./chartDatafeed";

// Sync mirror of the bhavcopy symbol list. We refresh this in the background
// from getAllSymbols() (which is async) so that searchUniverse() can stay sync
// and respond instantly even while the bhavcopy is being downloaded for the
// first time. Survives one cold start because the bhavcopy itself is cached
// to disk by nseBhavcopy.ts.
let bhavcopySymbolsCache: { symbols: string[]; sourceDate: string } | null = null;
async function refreshBhavcopySymbolsCache(): Promise<void> {
  try {
    const r = await getAllSymbols();
    if (r) bhavcopySymbolsCache = r;
  } catch {
    // Keep last-known good cache; this just means the lookup is degraded
    // to the curated 280 names until the next refresh succeeds.
  }
}
// Kick off an initial refresh; nseBhavcopy.getDeliveryMap() handles caching
// and inflight de-dup, so this is cheap to call any number of times.
void refreshBhavcopySymbolsCache();
setInterval(() => { void refreshBhavcopySymbolsCache(); }, 15 * 60_000).unref();

/** Series version of rolling-VWAP (the indicator helper returns only the latest value). */
function rollingVwapSeries(
  high: number[], low: number[], close: number[], volume: number[], lookback = 20,
): (number | null)[] {
  const n = close.length;
  const out: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - lookback + 1);
    let pv = 0, v = 0;
    for (let j = start; j <= i; j++) {
      const typ = ((high[j] ?? 0) + (low[j] ?? 0) + (close[j] ?? 0)) / 3;
      const vol = volume[j] ?? 0;
      pv += typ * vol;
      v += vol;
    }
    out[i] = v > 0 ? pv / v : (close[i] ?? null);
  }
  return out;
}
import { logger } from "./logger";

// Indian indices that the user can deep-scan. yahoo: ticker for chart fetch.
export interface IndexDef {
  symbol: string;     // canonical (NIFTY, BANKNIFTY, …)
  name: string;       // display
  yahoo: string;      // Yahoo Finance ticker (^NSEI, ^NSEBANK, …)
  category: "Broad" | "Sector" | "Strategy";
}

export const INDEX_LIST: IndexDef[] = [
  { symbol: "NIFTY",        name: "NIFTY 50",            yahoo: "^NSEI",                 category: "Broad" },
  { symbol: "BANKNIFTY",    name: "BANK NIFTY",          yahoo: "^NSEBANK",              category: "Broad" },
  { symbol: "FINNIFTY",     name: "NIFTY FINANCIAL",     yahoo: "NIFTY_FIN_SERVICE.NS",  category: "Broad" },
  { symbol: "MIDCPNIFTY",   name: "NIFTY MIDCAP SELECT", yahoo: "^NSEMDCP50",            category: "Broad" },
  { symbol: "NIFTYNXT50",   name: "NIFTY NEXT 50",       yahoo: "^NSMIDCP",              category: "Broad" },
  { symbol: "NIFTY100",     name: "NIFTY 100",           yahoo: "^CNX100",               category: "Broad" },
  { symbol: "NIFTY200",     name: "NIFTY 200",           yahoo: "^CNX200",               category: "Broad" },
  { symbol: "NIFTY500",     name: "NIFTY 500",           yahoo: "^CRSLDX",               category: "Broad" },
  { symbol: "NIFTYMIDCAP",  name: "NIFTY MIDCAP 100",    yahoo: "NIFTY_MIDCAP_100.NS",   category: "Broad" },
  { symbol: "NIFTYSMLCAP",  name: "NIFTY SMALLCAP 100",  yahoo: "^CRSMID",               category: "Broad" },
  { symbol: "SENSEX",       name: "BSE SENSEX",          yahoo: "^BSESN",                category: "Broad" },
  { symbol: "INDIAVIX",     name: "INDIA VIX",           yahoo: "^INDIAVIX",             category: "Strategy" },
  // Sector indices
  { symbol: "NIFTYIT",      name: "NIFTY IT",            yahoo: "^CNXIT",                category: "Sector" },
  { symbol: "NIFTYAUTO",    name: "NIFTY AUTO",          yahoo: "^CNXAUTO",              category: "Sector" },
  { symbol: "NIFTYPHARMA",  name: "NIFTY PHARMA",        yahoo: "^CNXPHARMA",            category: "Sector" },
  { symbol: "NIFTYFMCG",    name: "NIFTY FMCG",          yahoo: "^CNXFMCG",              category: "Sector" },
  { symbol: "NIFTYMETAL",   name: "NIFTY METAL",         yahoo: "^CNXMETAL",             category: "Sector" },
  { symbol: "NIFTYREALTY",  name: "NIFTY REALTY",        yahoo: "^CNXREALTY",            category: "Sector" },
  { symbol: "NIFTYENERGY",  name: "NIFTY ENERGY",        yahoo: "^CNXENERGY",            category: "Sector" },
  { symbol: "NIFTYINFRA",   name: "NIFTY INFRA",         yahoo: "^CNXINFRA",             category: "Sector" },
  { symbol: "NIFTYMEDIA",   name: "NIFTY MEDIA",         yahoo: "^CNXMEDIA",             category: "Sector" },
  { symbol: "NIFTYPSUBANK", name: "NIFTY PSU BANK",      yahoo: "^CNXPSUBANK",           category: "Sector" },
  { symbol: "NIFTYPVTBANK", name: "NIFTY PVT BANK",      yahoo: "NIFTY_PVT_BANK.NS",     category: "Sector" },
];

const INDEX_BY_SYMBOL = new Map(INDEX_LIST.map(i => [i.symbol.toUpperCase(), i]));

export type LookupKind = "stock" | "index";

export interface LookupItem {
  kind: LookupKind;
  symbol: string;
  name: string;
  sector?: string;
  category?: string;
}

/**
 * Fuzzy search (substring, case-insensitive) across:
 *   1. Indian indices (NIFTY, BANKNIFTY, sector indices, …)
 *   2. The curated UNIVERSE (~280 names with rich metadata: name, sector, …)
 *   3. The FULL NSE EQ universe (~2,486 symbols from the daily bhavcopy)
 *
 * Curated entries always win on collision because they carry the friendly
 * company name + sector. Symbols that exist only in the bhavcopy come back
 * with the symbol itself as the name and no sector tag, but they still
 * resolve correctly to a Yahoo ticker via yahooTickerFor() in the snapshot
 * endpoint — meaning users can deep-scan ANY listed NSE EQ stock by typing
 * its ticker (TATAMOTORS, RELIANCE, IRCTC, BHEL, etc.) and not just the
 * curated F&O names.
 */
export function searchUniverse(q: string, limit = 25): LookupItem[] {
  const term = q.trim().toUpperCase();
  if (!term) return [];

  const out: LookupItem[] = [];
  const seen = new Set<string>();

  // 1) Indices first — usually intent when typing NIFTY/BANK/SENSEX/…
  for (const idx of INDEX_LIST) {
    if (idx.symbol.toUpperCase().includes(term) || idx.name.toUpperCase().includes(term)) {
      out.push({ kind: "index", symbol: idx.symbol, name: idx.name, category: idx.category });
      seen.add(`index:${idx.symbol.toUpperCase()}`);
    }
  }

  // 2) Curated stocks (richer metadata wins on overlap with bhavcopy)
  for (const s of UNIVERSE) {
    if (out.length >= limit) break;
    const sym = s.symbol.toUpperCase();
    if (seen.has(`stock:${sym}`)) continue;
    if (sym.includes(term) || s.name.toUpperCase().includes(term)) {
      out.push({ kind: "stock", symbol: s.symbol, name: s.name, sector: s.sector });
      seen.add(`stock:${sym}`);
    }
  }

  // 3) Full NSE bhavcopy universe — symbols only (no friendly name in
  //    bhavcopy). Every symbol the broker actually trades is searchable.
  const bhav = bhavcopySymbolsCache;
  if (bhav) {
    for (const sym of bhav.symbols) {
      if (out.length >= limit) break;
      const u = sym.toUpperCase();
      if (seen.has(`stock:${u}`)) continue;
      if (u.includes(term)) {
        out.push({ kind: "stock", symbol: sym, name: sym });
        seen.add(`stock:${u}`);
      }
    }
  }

  return out.slice(0, limit);
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

export type Range = "1d" | "1wk" | "1mo" | "3mo" | "6mo" | "1y" | "3y" | "5y";
const ALL_RANGES: Range[] = ["1d", "1wk", "1mo", "3mo", "6mo", "1y", "3y", "5y"];

export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number; }

export interface DeepSnapshot {
  kind: LookupKind;
  symbol: string;
  name: string;
  sector?: string;
  industry?: string;
  description?: string;
  range: Range;
  ticker: string;                // Yahoo ticker actually used
  quote: {
    price: number;
    change: number;
    changePercent: number;
    open: number | null;
    high: number | null;
    low: number | null;
    previousClose: number | null;
    fiftyTwoWeekHigh: number | null;
    fiftyTwoWeekLow: number | null;
    volume: number | null;
    updatedAt: string;           // ISO
  };
  candles: Candle[];
  series: {
    ema20: (number | null)[];
    ema50: (number | null)[];
    ema100: (number | null)[];
    ema200: (number | null)[];
    vwap20: (number | null)[];
  };
  /** Period returns expressed as percent change vs price N trading days ago. null when not enough history. */
  returns: Record<"1mo" | "3mo" | "6mo" | "1y" | "3y" | "5y", number | null>;
  fundamentals?: YahooFundamentals;
  profile?: {
    seasonality?: string;
    catalysts?: string[];
  };
  /** Optional (index only): number of constituents in the in-app universe for that index. */
  constituentCount?: number;
  /**
   * Honest source label for this snapshot. Deep Scan is sourced entirely from
   * Yahoo (works from any IP, ~15min delayed), so this is always
   * `secondary_analytics` / delayed / not-for-signals / not-for-trade-decisions
   * — it must never be mistaken for an authoritative Kite trade input.
   */
  provenance: SourceProvenance;
  /**
   * True when an intraday range (1D/1W) was requested but intraday bars were
   * unavailable, so the chart fell back to the last few DAILY bars. Lets the UI
   * say so instead of silently mislabelling daily data as intraday.
   */
  intradayFallback?: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Compute % change over the last N trading days, given full close series. */
function pctChange(closes: number[], days: number): number | null {
  if (closes.length < days + 1) return null;
  const past = closes[closes.length - 1 - days];
  const last = closes[closes.length - 1];
  if (past == null || last == null || past <= 0) return null;
  return round2(((last - past) / past) * 100);
}

/** Trading-day approximation: ~252 days per year, ~21 per month, ~5 per week. */
const RETURN_LOOKBACK: Record<keyof DeepSnapshot["returns"], number> = {
  "1mo": 21, "3mo": 63, "6mo": 126, "1y": 252, "3y": 756, "5y": 1260,
};

/**
 * Build a Deep Snapshot for either a stock symbol or an index symbol.
 * Pulls a *long* (5y) history once for accurate multi-period returns, then
 * trims candles + series to the requested chart range.
 */
export async function getDeepSnapshot(
  rawSym: string,
  range: Range,
  hintKind?: LookupKind,
): Promise<DeepSnapshot | null> {
  const sym = rawSym.toUpperCase();
  const idx = INDEX_BY_SYMBOL.get(sym);
  const stockEntry: UniverseEntry | undefined = !idx ? getEntry(sym) : undefined;

  let kind: LookupKind;
  let displayName: string;
  let yahooTicker: string;
  let sector: string | undefined;
  let industry: string | undefined;
  let description: string | undefined;
  let seasonality: string | undefined;
  let catalysts: string[] | undefined;

  if (idx && hintKind !== "stock") {
    kind = "index";
    displayName = idx.name;
    yahooTicker = idx.yahoo;
  } else if (stockEntry) {
    kind = "stock";
    displayName = stockEntry.name;
    // Use the canonical resolver so renamed NSE symbols (ZOMATO→ETERNAL,
    // MCDOWELL-N→UNITDSPR, NIPPONLIFE→NAM-INDIA, GMRINFRA→GMRAIRPORT, etc.)
    // share the same ticker mapping as the rest of the system.
    yahooTicker = stockEntry.yahooSymbol ?? yahooTickerFor(sym);
    sector = stockEntry.sector;
    industry = stockEntry.industry;
    description = stockEntry.description;
    seasonality = stockEntry.seasonality;
    catalysts = stockEntry.catalysts;
  } else {
    // Unknown symbol — assume it's a raw NSE ticker the user typed.
    kind = "stock";
    displayName = sym;
    yahooTicker = yahooTickerFor(sym);
  }

  // Fetch a long history once (5y) so we can compute long-period returns accurately,
  // then trim to the requested chart `range` for display.
  const long = await fetchChart(yahooTicker, "5y", "1d");
  if (!long || long.close.length < 5) {
    logger.warn({ sym, yahooTicker }, "Deep snapshot: no chart data");
    return null;
  }

  // Compute returns from the long series.
  const returns: DeepSnapshot["returns"] = {
    "1mo": pctChange(long.close, RETURN_LOOKBACK["1mo"]),
    "3mo": pctChange(long.close, RETURN_LOOKBACK["3mo"]),
    "6mo": pctChange(long.close, RETURN_LOOKBACK["6mo"]),
    "1y":  pctChange(long.close, RETURN_LOOKBACK["1y"]),
    "3y":  pctChange(long.close, RETURN_LOOKBACK["3y"]),
    "5y":  pctChange(long.close, RETURN_LOOKBACK["5y"]),
  };

  // For intraday ranges (1D, 1W) we fetch a separate, finer-grained series
  // and compute period-N EMAs / VWAP on the *intraday* bars themselves so that
  // indicators are meaningful at that timeframe (a 20-period EMA on 5-minute
  // bars ≠ a 20-day EMA). For daily ranges (1M+) we keep the full daily-bar
  // logic so that EMA200 stays correct even on a 1-month view.
  const isIntraday = range === "1d" || range === "1wk";
  let displaySeries: { timestamps: number[]; open: number[]; high: number[]; low: number[]; close: number[]; volume: number[] };
  // Track the ACTUAL granularity served (drives the freshness budget + honest
  // labelling) and whether an intraday request silently fell back to daily bars.
  let displayTf: ChartTimeframe = "1D";
  let intradayFallback = false;
  const provenanceWarnings: string[] = [];

  if (isIntraday) {
    const intradayInterval = range === "1d" ? "5m" : "30m";
    const intradayRange = range === "1d" ? "1d" : "5d";
    const intra = await fetchIntraday(yahooTicker, intradayInterval, intradayRange);
    if (!intra || intra.close.length < 5) {
      logger.warn({ sym, yahooTicker, range }, "Deep snapshot: intraday data unavailable, falling back to daily");
      // Graceful fallback: use the last 5 daily bars instead of erroring out —
      // but LABEL it so the chart is never silently mislabelled as intraday.
      intradayFallback = true;
      displayTf = "1D";
      provenanceWarnings.push("Intraday data unavailable — showing last daily bars instead");
      const fb = Math.min(long.close.length, 5);
      const fbStart = long.close.length - fb;
      displaySeries = {
        timestamps: long.timestamps.slice(fbStart),
        open: long.open.slice(fbStart),
        high: long.high.slice(fbStart),
        low: long.low.slice(fbStart),
        close: long.close.slice(fbStart),
        volume: long.volume.slice(fbStart),
      };
    } else {
      displayTf = range === "1d" ? "5m" : "30m";
      displaySeries = {
        timestamps: intra.timestamps,
        open: intra.open,
        high: intra.high,
        low: intra.low,
        close: intra.close,
        volume: intra.volume,
      };
    }
  } else {
    displayTf = "1D";
    const RANGE_BARS: Record<Range, number> = {
      "1d": 1, "1wk": 5, "1mo": 22, "3mo": 66, "6mo": 130, "1y": 252, "3y": 756, "5y": 1260,
    };
    const bars = Math.min(long.close.length, RANGE_BARS[range]);
    const dStart = long.close.length - bars;
    displaySeries = {
      timestamps: long.timestamps.slice(dStart),
      open: long.open.slice(dStart),
      high: long.high.slice(dStart),
      low: long.low.slice(dStart),
      close: long.close.slice(dStart),
      volume: long.volume.slice(dStart),
    };
  }

  // Compute indicator series:
  //  • Daily ranges → EMAs on the FULL 5y daily series, then slice (so EMA200
  //    is meaningful even on a 1-month chart).
  //  • Intraday ranges → EMAs on the intraday closes themselves (period-N is
  //    in *bars* of the chosen interval, which is the standard convention).
  const indicatorSrc = isIntraday ? displaySeries.close : long.close;
  const ema20Full  = ema(indicatorSrc, 20);
  const ema50Full  = ema(indicatorSrc, 50);
  const ema100Full = ema(indicatorSrc, 100);
  const ema200Full = ema(indicatorSrc, 200);

  // VWAP is volume-weighted; for indices Yahoo reports 0 volume, which would
  // collapse the indicator into the price line and mislead traders. Suppress it
  // on indices and on stocks where every bar has zero volume.
  const vwapSrcVol = isIntraday ? displaySeries.volume : long.volume;
  const hasVolume = kind === "stock" && vwapSrcVol.some(v => v > 0);
  const vwap20Full: (number | null)[] = hasVolume
    ? rollingVwapSeries(
        isIntraday ? displaySeries.high  : long.high,
        isIntraday ? displaySeries.low   : long.low,
        isIntraday ? displaySeries.close : long.close,
        vwapSrcVol,
        20,
      )
    : new Array(indicatorSrc.length).fill(null);

  const r2 = (v: number | null | undefined) => v == null ? null : round2(v);
  // For intraday, indicators are already aligned 1:1 with displaySeries.
  // For daily, indicators are aligned with `long.*`, so slice from the same offset.
  const start = isIntraday ? 0 : long.close.length - displaySeries.close.length;
  const sliceR = (arr: (number | null)[]) => arr.slice(start).map(r2);

  // Slice indicators to the displayed window (aligned 1:1 with displaySeries).
  const ema20S  = sliceR(ema20Full);
  const ema50S  = sliceR(ema50Full);
  const ema100S = sliceR(ema100Full);
  const ema200S = sliceR(ema200Full);
  const vwap20S = sliceR(vwap20Full);

  // Build candles, DROPPING any bar with a missing OHLC value instead of
  // fabricating a 0 (which would render as a fake crash-to-zero spike). The
  // indicator series are filtered with the SAME predicate so they stay aligned
  // 1:1 with the candle array on the frontend.
  const candles: Candle[] = [];
  const series = {
    ema20: [] as (number | null)[],
    ema50: [] as (number | null)[],
    ema100: [] as (number | null)[],
    ema200: [] as (number | null)[],
    vwap20: [] as (number | null)[],
  };
  let droppedBars = 0;
  const fin = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
  for (let i = 0; i < displaySeries.close.length; i++) {
    const t = displaySeries.timestamps[i];
    const o = displaySeries.open[i];
    const h = displaySeries.high[i];
    const l = displaySeries.low[i];
    const c = displaySeries.close[i];
    if (!fin(t) || !fin(o) || !fin(h) || !fin(l) || !fin(c)) {
      droppedBars++;
      continue; // never fabricate a 0 OHLC bar
    }
    // Volume legitimately 0 for indices — that is real, not fabricated.
    const v = fin(displaySeries.volume[i]) ? (displaySeries.volume[i] as number) : 0;
    candles.push({ t: t * 1000, o: round2(o), h: round2(h), l: round2(l), c: round2(c), v });
    series.ema20.push(ema20S[i] ?? null);
    series.ema50.push(ema50S[i] ?? null);
    series.ema100.push(ema100S[i] ?? null);
    series.ema200.push(ema200S[i] ?? null);
    series.vwap20.push(vwap20S[i] ?? null);
  }
  if (droppedBars > 0) {
    provenanceWarnings.push(`${droppedBars} incomplete bar(s) dropped (missing OHLC from source)`);
  }

  const last = long.close.length - 1;
  const lastClose = long.close[last] ?? 0;
  // Use the previous trading day's close for day change. `chartPreviousClose` from
  // Yahoo represents the close *before the entire chart started*, which is wrong
  // when we requested a 5y range (it would give us the price 5 years ago).
  const prevClose = long.close[last - 1] ?? long.meta.chartPreviousClose ?? lastClose;
  const change = lastClose - prevClose;
  const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

  let fundamentals: YahooFundamentals | undefined;
  if (kind === "stock") {
    const f = await fetchFundamentals(sym).catch(() => null);
    if (f) fundamentals = f;
  }

  let constituentCount: number | undefined;
  if (kind === "index") {
    constituentCount = INDEX_CONSTITUENTS[sym]?.length;
  }

  // Honest source label: Deep Scan is Yahoo-only (delayed secondary_analytics).
  // asOf prefers the live quote instant, falling back to the newest kept bar.
  const lastCandleTs = candles.length > 0 ? Math.floor(candles[candles.length - 1]!.t / 1000) : null;
  const asOfSec = long.meta.regularMarketTime ?? lastCandleTs ?? null;
  const provenance = buildSourceProvenance({
    provider: "yahoo",
    asOfSec,
    tf: displayTf,
    warnings: provenanceWarnings,
  });

  return {
    kind,
    symbol: sym,
    name: displayName,
    sector,
    industry,
    description,
    range,
    ticker: yahooTicker,
    quote: {
      price: round2(lastClose),
      change: round2(change),
      changePercent: round2(changePercent),
      open: long.open[last] != null ? round2(long.open[last]!) : null,
      high: long.meta.regularMarketDayHigh != null ? round2(long.meta.regularMarketDayHigh) : (long.high[last] != null ? round2(long.high[last]!) : null),
      low: long.meta.regularMarketDayLow != null ? round2(long.meta.regularMarketDayLow) : (long.low[last] != null ? round2(long.low[last]!) : null),
      previousClose: round2(prevClose),
      fiftyTwoWeekHigh: long.meta.fiftyTwoWeekHigh != null ? round2(long.meta.fiftyTwoWeekHigh) : null,
      fiftyTwoWeekLow: long.meta.fiftyTwoWeekLow != null ? round2(long.meta.fiftyTwoWeekLow) : null,
      // Indices report 0 volume (Yahoo doesn't track it); surface as null so UI shows "—".
      volume: kind === "index" ? null : (long.volume[last] || null),
      updatedAt: new Date((long.meta.regularMarketTime ?? long.timestamps[last] ?? Date.now() / 1000) * 1000).toISOString(),
    },
    candles,
    series,
    returns,
    provenance,
    ...(intradayFallback ? { intradayFallback } : {}),
    ...(fundamentals ? { fundamentals } : {}),
    ...(seasonality || (catalysts && catalysts.length) ? { profile: { seasonality, catalysts } } : {}),
    ...(constituentCount != null ? { constituentCount } : {}),
  };
}

export const RANGES_FOR_DEEPSCAN = ALL_RANGES;
