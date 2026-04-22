import type { IndexQuote } from "@workspace/api-zod";
import { fetchIntraday, fetchIndexChart } from "./yahoo";
import { ema, rsi, sessionVwap } from "./indicators";
import { logger } from "./logger";

export interface GlobalCfg {
  yahoo: string;
  name: string;
  region: string;
  intraday?: boolean;
}

// GIFT NIFTY trades on NSE-IX nearly 24/5 — Yahoo carries the Nifty futures
// continuous contract under "NIFTY_F1.NS" / index proxy "^NSEI". We surface
// a curated set of regional benchmarks plus the GIFT-NIFTY proxy.
export const GLOBAL_INDICES: GlobalCfg[] = [
  { yahoo: "^NSEI", name: "GIFT NIFTY (proxy)", region: "India / SGX" },
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
  { yahoo: "GC=F", name: "Gold", region: "Global" },
  { yahoo: "INR=X", name: "USD/INR", region: "FX" },
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

export async function getGlobalIndices(): Promise<IndexQuote[]> {
  if (cache && Date.now() - cache.ts < TTL) return cache.data;
  const results: IndexQuote[] = [];
  await Promise.all(
    GLOBAL_INDICES.map(async cfg => {
      try {
        const intra = await fetchIntraday(cfg.yahoo, "15m", "5d");
        const daily = await fetchIndexChart(cfg.yahoo);
        const price = intra?.meta.regularMarketPrice ?? daily?.meta.regularMarketPrice ?? 0;
        const dn = daily?.close.length ?? 0;
        const prev = dn >= 2 ? daily!.close[dn - 2]! : (daily?.meta.chartPreviousClose ?? price);
        const change = price - prev;
        const pct = prev > 0 ? (change / prev) * 100 : 0;
        let vwap: number | undefined;
        let ema9v: number | undefined;
        let ema21v: number | undefined;
        let rsi14: number | undefined;
        if (intra && intra.close.length > 6) {
          vwap = round(lastVal(sessionVwap(intra.high, intra.low, intra.close, intra.volume)) ?? price);
          ema9v = round(lastVal(ema(intra.close, 9)) ?? price);
          ema21v = round(lastVal(ema(intra.close, 21)) ?? price);
          rsi14 = round(lastVal(rsi(intra.close, 14)) ?? 50);
        }
        let trend: "bullish" | "bearish" | "neutral" = "neutral";
        if (change > 0 && (vwap == null || price > vwap)) trend = "bullish";
        else if (change < 0 && (vwap == null || price < vwap)) trend = "bearish";
        results.push({
          symbol: cfg.yahoo,
          name: cfg.name,
          region: cfg.region,
          price: round(price, 4),
          change: round(change, 4),
          changePercent: round(pct, 3),
          trend,
          vwap,
          ema9: ema9v,
          ema21: ema21v,
          rsi14,
        });
      } catch (err) {
        logger.warn({ err: (err as Error).message, sym: cfg.yahoo }, "Global index failed");
      }
    }),
  );
  // Preserve declared order
  results.sort((a, b) => GLOBAL_INDICES.findIndex(x => x.yahoo === a.symbol) - GLOBAL_INDICES.findIndex(x => x.yahoo === b.symbol));
  cache = { ts: Date.now(), data: results };
  return results;
}
