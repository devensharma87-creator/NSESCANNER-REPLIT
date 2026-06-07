/**
 * Portfolio Analyser — enrichment cascade.
 *
 * Resolves a user-supplied holding to live market data by composing three
 * EXISTING read-only endpoints, in order of richness:
 *
 *   1. getStockDetail(normalised)          → full enrichment (CMP + fundamentals + indicators)
 *   2. searchChartInstruments(normalised)  → resolve the canonical symbol + segment
 *   2b. getStockDetail(resolved)           → retry full enrichment with the resolved symbol
 *   3. getChartCandles(resolved, "1D")     → price-only CMP (+ DMA/RSI derived from real closes)
 *
 * If none yields a CMP the row is PRESERVED with a precise reason — never
 * dropped, never back-filled with fabricated numbers. Fetchers are injected so
 * the cascade is unit-testable without any network.
 */
import type { LiveMetrics, EnrichmentMeta, DataSource, UnavailableReason } from "./types";
import {
  normalizeSymbol,
  classifyInstrument,
  lookupAlias,
  isEtfClass,
  fundamentalsApplicable as classFundamentalsApplicable,
  type InstrumentClass,
} from "./symbol";
import { sma, rsi14 } from "./indicators";

export const EMPTY_LIVE: LiveMetrics = {
  available: false,
  sector: null,
  cmp: null,
  previousClose: null,
  rsi14: null,
  dma50: null,
  dma200: null,
  supportZone: null,
  resistanceZone: null,
  trendStrength: null,
  peRatio: null,
  pbRatio: null,
  roe: null,
  marketCapCr: null,
  beta: null,
  roce: null,
  debtToEquity: null,
  fiftyTwoWeekHigh: null,
  fiftyTwoWeekLow: null,
};

const num = (v: number | null | undefined): number | null =>
  v != null && Number.isFinite(v) ? v : null;

// ---------------------------------------------------------------------------
// Structural shapes (kept minimal so callers can pass generated DTOs as-is and
// tests can pass plain objects).
// ---------------------------------------------------------------------------

export interface DetailLike {
  quote?: {
    price?: number | null;
    previousClose?: number | null;
    fiftyTwoWeekHigh?: number | null;
    fiftyTwoWeekLow?: number | null;
  } | null;
  indicators?: {
    rsi14?: number | null;
    supportLevel?: number | null;
    resistanceLevel?: number | null;
    trendStrength?: number | null;
  } | null;
  profile?: {
    sector?: string | null;
    keyStats?: {
      fiftyDayAverage?: number | null;
      twoHundredDayAverage?: number | null;
      peRatio?: number | null;
      pbRatio?: number | null;
      roe?: number | null;
      marketCapCr?: number | null;
      beta?: number | null;
      roce?: number | null;
      debtToEquity?: number | null;
    } | null;
  } | null;
}

export interface InstrumentLike {
  symbol: string;
  name: string;
  segment: string;
  exchange?: string | null;
  type?: string;
}

export interface CandleLike {
  c: number;
}

/** Lightweight ETF quote (mirrors the EtfQuote DTO; only the fields we use). */
export interface EtfQuoteLike {
  price?: number | null;
  previousClose?: number | null;
}

export interface EnrichFetchers {
  stockDetail: (symbol: string) => Promise<DetailLike | null>;
  searchInstruments: (q: string) => Promise<InstrumentLike[]>;
  candles: (symbol: string, segment: string) => Promise<CandleLike[]>;
  /**
   * Optional lightweight Kite-quote branch for whitelisted ETFs (NIFTYBEES,
   * GOLDBEES, BANKBEES, …). ETFs are not in the curated/scored equity catalog,
   * so `stockDetail`/`searchInstruments` come back empty for them. Resolves a
   * real CMP without fundamentals (not applicable to ETFs); returns null when
   * the symbol is not a recognised ETF or the quote source is offline.
   */
  etfQuote?: (symbol: string) => Promise<EtfQuoteLike | null>;
}

export interface EnrichmentResult {
  live: LiveMetrics;
  meta: EnrichmentMeta;
}

/** Minimal holding shape the cascade needs (symbol/name/exchange). */
export interface HoldingInput {
  symbol: string;
  name?: string;
  exchange?: string;
}

// ---------------------------------------------------------------------------
// Pure mappers
// ---------------------------------------------------------------------------

/** Full enrichment from a stock-detail payload (mirrors the legacy toLive). */
export function liveFromDetail(detail: DetailLike | null | undefined): LiveMetrics {
  if (!detail) return EMPTY_LIVE;
  const ks = detail.profile?.keyStats;
  return {
    available: num(detail.quote?.price) != null,
    sector: detail.profile?.sector ?? null,
    cmp: num(detail.quote?.price),
    previousClose: num(detail.quote?.previousClose),
    rsi14: num(detail.indicators?.rsi14),
    dma50: num(ks?.fiftyDayAverage),
    dma200: num(ks?.twoHundredDayAverage),
    supportZone: num(detail.indicators?.supportLevel),
    resistanceZone: num(detail.indicators?.resistanceLevel),
    trendStrength: num(detail.indicators?.trendStrength),
    peRatio: num(ks?.peRatio),
    pbRatio: num(ks?.pbRatio),
    roe: num(ks?.roe),
    marketCapCr: num(ks?.marketCapCr),
    beta: num(ks?.beta),
    roce: num(ks?.roce),
    debtToEquity: num(ks?.debtToEquity),
    fiftyTwoWeekHigh: num(detail.quote?.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: num(detail.quote?.fiftyTwoWeekLow),
  };
}

/**
 * Price-only enrichment from real candle closes. CMP = last close, previous
 * close = second-to-last. DMA50/200 and RSI are computed from the closes when
 * there is enough history, else null. Fundamentals are intentionally absent.
 */
export function liveFromCandles(
  candles: CandleLike[],
  sector: string | null = null,
): LiveMetrics {
  const closes = candles.map(c => c.c).filter(c => Number.isFinite(c));
  if (closes.length === 0) return { ...EMPTY_LIVE, sector };
  const cmp = closes[closes.length - 1];
  const prev = closes.length >= 2 ? closes[closes.length - 2] : null;
  return {
    ...EMPTY_LIVE,
    available: num(cmp) != null,
    sector,
    cmp: num(cmp),
    previousClose: num(prev),
    rsi14: rsi14(closes),
    dma50: sma(closes, 50),
    dma200: sma(closes, 200),
  };
}

/**
 * Price-only enrichment from a lightweight ETF quote. CMP + previous close are
 * real (Kite); fundamentals/indicators are intentionally absent — they are not
 * applicable to an ETF, never "missing".
 */
export function liveFromEtfQuote(
  quote: EtfQuoteLike | null | undefined,
  sector: string | null = null,
): LiveMetrics {
  if (!quote) return { ...EMPTY_LIVE, sector };
  return {
    ...EMPTY_LIVE,
    available: num(quote.price) != null,
    sector,
    cmp: num(quote.price),
    previousClose: num(quote.previousClose),
  };
}

/**
 * Pick the best instrument from a search response for the requested symbol.
 *   1. exact symbol match (prefer equity segment)
 *   2. exact (normalised) name match
 *   3. first equity-segment instrument
 *   4. first instrument
 */
export function pickBestInstrument(
  instruments: InstrumentLike[],
  normalisedSymbol: string,
  name?: string,
): InstrumentLike | null {
  if (instruments.length === 0) return null;
  const target = normalisedSymbol.toUpperCase();
  const targetName = (name ?? "").trim().toUpperCase();

  const exact = instruments.filter(i => normalizeSymbol(i.symbol) === target);
  if (exact.length > 0) {
    return exact.find(i => i.segment === "equity") ?? exact[0];
  }
  if (targetName) {
    const byName = instruments.find(i => (i.name ?? "").trim().toUpperCase() === targetName);
    if (byName) return byName;
  }
  return instruments.find(i => i.segment === "equity") ?? instruments[0];
}

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

function meta(partial: Partial<EnrichmentMeta> & {
  originalSymbol: string;
  normalisedSymbol: string;
  instrumentType: InstrumentClass;
}): EnrichmentMeta {
  return {
    resolvedSymbol: null,
    displaySymbol: partial.resolvedSymbol ?? partial.originalSymbol,
    exchange: null,
    segment: null,
    fundamentalsApplicable: classFundamentalsApplicable(partial.instrumentType),
    dataSource: null,
    reason: null,
    ...partial,
  };
}

/**
 * Run the enrichment cascade for one holding. Never throws — every fetch is
 * wrapped, and a fully-unresolved holding returns EMPTY_LIVE plus a precise
 * reason so the UI can preserve the row and explain the gap.
 */
export async function resolveHolding(
  holding: HoldingInput,
  fx: EnrichFetchers,
): Promise<EnrichmentResult> {
  const originalSymbol = holding.symbol;
  const normalisedSymbol = normalizeSymbol(originalSymbol);
  const alias = lookupAlias(normalisedSymbol);
  const primarySymbol = alias?.canonical ?? normalisedSymbol;

  // --- Step 1: stock detail on the (aliased) normalised symbol ------------
  let detail = await safe(() => fx.stockDetail(primarySymbol));
  let live = liveFromDetail(detail);
  if (live.available) {
    const cls = alias?.instrumentType ?? classifyInstrument(primarySymbol, holding.name);
    return {
      live,
      meta: meta({
        originalSymbol,
        normalisedSymbol,
        resolvedSymbol: primarySymbol,
        displaySymbol: primarySymbol,
        exchange: alias?.exchange ?? holding.exchange ?? null,
        segment: "equity",
        instrumentType: cls,
        dataSource: "stock-detail",
        reason: null,
      }),
    };
  }

  // --- Step 1b: lightweight Kite-quote branch for whitelisted ETFs --------
  // ETFs (NIFTYBEES/GOLDBEES/BANKBEES, …) are not in the curated/scored equity
  // catalog, so stockDetail above 404s and the search below comes back empty.
  // The dedicated ETF quote endpoint resolves a real CMP for them. Gate on the
  // heuristic ETF classification so we never fire it for plain equities.
  const etfCls = alias?.instrumentType ?? classifyInstrument(primarySymbol, holding.name);
  if (fx.etfQuote && isEtfClass(etfCls)) {
    const quote = await safe(() => fx.etfQuote!(primarySymbol));
    const etfLive = liveFromEtfQuote(quote);
    if (etfLive.available) {
      return {
        live: etfLive,
        meta: meta({
          originalSymbol,
          normalisedSymbol,
          resolvedSymbol: primarySymbol,
          displaySymbol: primarySymbol,
          exchange: alias?.exchange ?? holding.exchange ?? "NSE",
          segment: "equity",
          instrumentType: etfCls,
          fundamentalsApplicable: false,
          dataSource: "etf-quote",
          reason: null,
        }),
      };
    }
  }

  // --- Step 2: resolve the canonical instrument via search ----------------
  const instruments = (await safe(() => fx.searchInstruments(primarySymbol))) ?? [];
  const match = pickBestInstrument(instruments, normalisedSymbol, holding.name);
  const resolvedSymbol = match?.symbol ?? null;
  const segment = match?.segment ?? null;
  const exchange = match?.exchange ?? holding.exchange ?? null;
  const instrumentType: InstrumentClass = match
    ? classifyInstrument(match.symbol, match.name)
    : alias?.instrumentType ?? classifyInstrument(primarySymbol, holding.name);

  // --- Step 2b: retry stock detail with the resolved symbol ---------------
  if (resolvedSymbol && normalizeSymbol(resolvedSymbol) !== primarySymbol) {
    detail = await safe(() => fx.stockDetail(resolvedSymbol));
    live = liveFromDetail(detail);
    if (live.available) {
      return {
        live,
        meta: meta({
          originalSymbol,
          normalisedSymbol,
          resolvedSymbol,
          displaySymbol: resolvedSymbol,
          exchange,
          segment: segment ?? "equity",
          instrumentType,
          dataSource: "stock-detail",
          reason: null,
        }),
      };
    }
  }

  // --- Step 3: candle fallback for CMP (price-only) -----------------------
  if (resolvedSymbol && segment) {
    const candles = (await safe(() => fx.candles(resolvedSymbol, segment))) ?? [];
    const candleLive = liveFromCandles(candles, detail?.profile?.sector ?? null);
    if (candleLive.available) {
      const fundsApplicable = classFundamentalsApplicable(instrumentType);
      return {
        live: candleLive,
        meta: meta({
          originalSymbol,
          normalisedSymbol,
          resolvedSymbol,
          displaySymbol: resolvedSymbol,
          exchange,
          segment,
          instrumentType,
          fundamentalsApplicable: fundsApplicable,
          dataSource: "chart-candles",
          reason: fundsApplicable ? null : "ETF fundamentals unavailable",
        }),
      };
    }
  }

  // --- Step 4: preserved but unresolved — precise reason ------------------
  const reason: UnavailableReason =
    instruments.length === 0
      ? "No instrument match"
      : !resolvedSymbol
        ? "Symbol not found"
        : "CMP unavailable";

  return {
    live: { ...EMPTY_LIVE, sector: holding.name ? null : null },
    meta: meta({
      originalSymbol,
      normalisedSymbol,
      resolvedSymbol,
      displaySymbol: resolvedSymbol ?? originalSymbol,
      exchange,
      segment,
      instrumentType,
      dataSource: null,
      reason,
    }),
  };
}

/** Default meta for a holding whose query has not produced data yet. */
export function pendingMeta(holding: HoldingInput): EnrichmentMeta {
  const normalisedSymbol = normalizeSymbol(holding.symbol);
  const instrumentType = classifyInstrument(normalisedSymbol, holding.name);
  return meta({
    originalSymbol: holding.symbol,
    normalisedSymbol,
    resolvedSymbol: null,
    displaySymbol: holding.symbol,
    exchange: holding.exchange ?? null,
    segment: null,
    instrumentType,
    dataSource: null,
    reason: "Awaiting data source",
  });
}
