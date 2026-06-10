import type { IndexQuote } from "@workspace/api-zod";
import { fetchIntraday, fetchIndexChart } from "./yahoo";
import type { YahooChart } from "./yahoo";
import { ema, rsi, sessionVwap } from "./indicators";
import { getGiftNifty } from "./giftNifty";
import { logger } from "./logger";

export interface GlobalCfg {
  yahoo: string;
  name: string;
  region: string;
  intraday?: boolean;
}

// Curated set of regional benchmarks. GIFT NIFTY is NOT in this Yahoo-backed
// list because Yahoo does not carry it — it is fetched from TradingView's
// NSEIX feed via giftNifty.ts and merged into the result below. Substituting
// ^NSEI (NIFTY cash spot) for GIFT NIFTY is forbidden — the two prints can
// have opposite signs on the same overnight session and that mis-attribution
// was the root cause of the "Pre-Market shows -0.74% but GIFT NIFTY is +0.34%"
// bug.
export const GLOBAL_INDICES: GlobalCfg[] = [
  { yahoo: "^GSPC", name: "S&P 500", region: "US" },
  { yahoo: "^DJI", name: "Dow Jones", region: "US" },
  { yahoo: "^IXIC", name: "Nasdaq", region: "US" },
  { yahoo: "^FTSE", name: "FTSE 100", region: "UK" },
  { yahoo: "^GDAXI", name: "DAX", region: "Germany" },
  { yahoo: "^N225", name: "Nikkei 225", region: "Japan" },
  { yahoo: "^HSI", name: "Hang Seng", region: "Hong Kong" },
  { yahoo: "000001.SS", name: "Shanghai", region: "China" },
  { yahoo: "^VIX", name: "VIX", region: "US" },
  { yahoo: "DX-Y.NYB", name: "Dollar Index", region: "Global" },
  { yahoo: "CL=F", name: "Crude Oil", region: "Global" },
  { yahoo: "BZ=F", name: "Brent Crude", region: "Global" },
  { yahoo: "GC=F", name: "Gold", region: "Global" },
  { yahoo: "INR=X", name: "USD/INR", region: "FX" },
  // US 10-Year Treasury yield (Yahoo ^TNX quotes yield ×10, e.g. 51.7 = 5.17%).
  // The macro-overlay builder divides by 10. India 10Y has no reliable free
  // live feed and is surfaced as null ("no live feed") in the macro builder.
  { yahoo: "^TNX", name: "US 10Y Yield", region: "US" },
];

let cache: { ts: number; data: IndexQuote[] } | null = null;
const TTL = 30 * 1000;

function lastVal(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i] as number;
  return null;
}

function round(n: number, p = 2): number {
  const m = Math.pow(10, p);
  return Math.round(n * m) / m;
}

/**
 * Build one global-cue quote from Yahoo intraday + daily series.
 *
 * Honesty contract: returns `null` when no REAL positive price AND previous
 * close can be resolved. A failed/empty Yahoo fetch (which frequently does NOT
 * throw — it just returns empty/zeroed data) must NEVER fabricate a 0.00 print.
 * The omitted entry renders as "—" / hidden in the UI, the same discipline used
 * for GIFT NIFTY. Yahoo is the only legitimate source for these global symbols
 * (Kite has no global coverage) and is treated as delayed/secondary analytics.
 */
export function buildGlobalIndexQuote(
  cfg: GlobalCfg,
  intra: YahooChart | null,
  daily: YahooChart | null,
): IndexQuote | null {
  const rawPrice = intra?.meta.regularMarketPrice ?? daily?.meta.regularMarketPrice ?? null;
  const dn = daily?.close.length ?? 0;
  const prevRaw = dn >= 2 ? daily!.close[dn - 2]! : (daily?.meta.chartPreviousClose ?? null);
  // Require a real positive price AND previous close — without both we cannot
  // report a non-fabricated change/percent, so omit rather than emit a fake 0.
  if (rawPrice == null || !Number.isFinite(rawPrice) || rawPrice <= 0) return null;
  if (prevRaw == null || !Number.isFinite(prevRaw) || prevRaw <= 0) return null;
  const price = rawPrice;
  const prev = prevRaw;
  const change = price - prev;
  const pct = (change / prev) * 100;

  // Intraday indicators are derived analytics. When the underlying series is
  // too short or a value cannot be computed, leave the field UNDEFINED — never
  // substitute the spot price (VWAP/EMA) or a neutral 50 (RSI), which would
  // fabricate a "neutral/normal" reading from missing data. The fields are
  // optional on the wire and the UI omits them when absent.
  let vwap: number | undefined;
  let ema9v: number | undefined;
  let ema21v: number | undefined;
  let rsi14: number | undefined;
  if (intra && intra.close.length > 6) {
    const vwapRaw = lastVal(sessionVwap(intra.high, intra.low, intra.close, intra.volume));
    const ema9Raw = lastVal(ema(intra.close, 9));
    const ema21Raw = lastVal(ema(intra.close, 21));
    const rsiRaw = lastVal(rsi(intra.close, 14));
    vwap = vwapRaw != null ? round(vwapRaw) : undefined;
    ema9v = ema9Raw != null ? round(ema9Raw) : undefined;
    ema21v = ema21Raw != null ? round(ema21Raw) : undefined;
    rsi14 = rsiRaw != null ? round(rsiRaw) : undefined;
  }
  let trend: "bullish" | "bearish" | "neutral" = "neutral";
  if (change > 0 && (vwap == null || price > vwap)) trend = "bullish";
  else if (change < 0 && (vwap == null || price < vwap)) trend = "bearish";

  // Build a compact sparkline from the most recent ~48 daily closes (or intraday closes if daily missing)
  const sparkSrc = (daily?.close.length ?? 0) >= 10 ? daily!.close : (intra?.close ?? []);
  const sparkline = sparkSrc
    .slice(-48)
    .filter((v): v is number => v != null)
    .map(v => round(v, 4));
  const dayHigh = daily?.meta.regularMarketDayHigh ?? intra?.meta.regularMarketDayHigh;
  const dayLow = daily?.meta.regularMarketDayLow ?? intra?.meta.regularMarketDayLow;
  const opn = dn >= 1 ? daily!.open[dn - 1] : undefined;

  return {
    symbol: cfg.yahoo,
    name: cfg.name,
    region: cfg.region,
    price: round(price, 4),
    change: round(change, 4),
    changePercent: round(pct, 3),
    open: opn != null ? round(opn, 4) : undefined,
    high: dayHigh != null ? round(dayHigh, 4) : undefined,
    low: dayLow != null ? round(dayLow, 4) : undefined,
    previousClose: round(prev, 4),
    fiftyTwoWeekHigh: daily?.meta.fiftyTwoWeekHigh != null ? round(daily.meta.fiftyTwoWeekHigh, 4) : undefined,
    fiftyTwoWeekLow: daily?.meta.fiftyTwoWeekLow != null ? round(daily.meta.fiftyTwoWeekLow, 4) : undefined,
    volume: daily?.meta.regularMarketVolume,
    asOf: daily?.meta.regularMarketTime ?? intra?.meta.regularMarketTime,
    sparkline,
    trend,
    vwap,
    ema9: ema9v,
    ema21: ema21v,
    rsi14,
  };
}

export async function getGlobalIndices(): Promise<IndexQuote[]> {
  if (cache && Date.now() - cache.ts < TTL) return cache.data;
  const results: IndexQuote[] = [];

  // GIFT NIFTY — fetched from TradingView (NSEIX:NIFTY1!), in parallel with
  // the Yahoo benchmarks below. Returns null if the source is unavailable;
  // in that case we OMIT the entry rather than fall back to ^NSEI cash spot.
  const giftPromise = getGiftNifty().then(g => {
    if (!g) return;
    const trend: "bullish" | "bearish" | "neutral" =
      g.changePercent > 0.05 ? "bullish" : g.changePercent < -0.05 ? "bearish" : "neutral";
    results.push({
      symbol: "NSEIX:NIFTY1!",
      name: "GIFT NIFTY",
      region: "India / NSE-IX",
      price: g.price,
      change: g.change,
      changePercent: g.changePercent,
      previousClose: g.previousClose,
      volume: g.volume ?? undefined,
      asOf: g.asOf,
      sparkline: [],
      trend,
    });
  }).catch(err => {
    logger.warn({ err: (err as Error).message }, "GIFT NIFTY fetch failed");
  });

  await Promise.all([giftPromise, ...GLOBAL_INDICES.map(async cfg => {
      try {
        const intra = await fetchIntraday(cfg.yahoo, "15m", "5d");
        const daily = await fetchIndexChart(cfg.yahoo);
        const quote = buildGlobalIndexQuote(cfg, intra, daily);
        // A failed/empty Yahoo fetch yields no usable quote — OMIT the entry
        // rather than fabricate a 0.00 print.
        if (quote) results.push(quote);
      } catch (err) {
        logger.warn({ err: (err as Error).message, sym: cfg.yahoo }, "Global index failed");
      }
    })]);
  // Preserve declared order — GIFT NIFTY first (most direct pre-open signal),
  // then the Yahoo benchmarks in their original list order.
  const cfgIdx = (sym: string) => {
    if (sym === "NSEIX:NIFTY1!") return -1;
    return GLOBAL_INDICES.findIndex(x => x.yahoo === sym);
  };
  results.sort((a, b) => cfgIdx(a.symbol) - cfgIdx(b.symbol));
  cache = { ts: Date.now(), data: results };
  return results;
}
