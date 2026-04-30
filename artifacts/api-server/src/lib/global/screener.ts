/**
 * Shared screener evaluation used by both the live `POST /global/screen`
 * route and the background `presetScheduler`. Keeping the implementation
 * in one place ensures that auto-runs and on-demand runs apply the
 * exact same filter semantics, ranking, and evaluation budget.
 */

import { z } from "zod";
import { logger } from "../logger";
import { UNIVERSE, type GlobalAssetClass, type GlobalTimeframe } from "./universe";
import { getCandlesFresh, getLivePrices } from "./dataLayer";
import {
  sma, ema, rsi, supertrend,
  highestHigh, lowestLow, lastNonNull, type OHLCV,
} from "./indicators";

export const ScreenerBody = z.object({
  assetClasses: z.array(z.enum(["crypto", "commodity", "forex", "equity", "index"])).min(1),
  timeframe: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]).default("1h"),
  filters: z.object({
    minChangePct: z.number().optional(),
    maxChangePct: z.number().optional(),
    minVolume: z.number().optional(),
    minRsi14: z.number().min(0).max(100).optional(),
    maxRsi14: z.number().min(0).max(100).optional(),
    breakoutLookback: z.number().int().min(2).max(500).optional(),
    breakdownLookback: z.number().int().min(2).max(500).optional(),
    min1dChangePct: z.number().optional(),
    min1wChangePct: z.number().optional(),
    priceAboveSma50: z.boolean().optional(),
    priceBelowSma50: z.boolean().optional(),
    priceAboveSma200: z.boolean().optional(),
    priceBelowSma200: z.boolean().optional(),
    trendUp: z.boolean().optional(),
    trendDown: z.boolean().optional(),
    requireSupertrendUp: z.boolean().optional(),
    requireSupertrendDown: z.boolean().optional(),
  }).default({}),
  limit: z.number().int().min(1).max(50).optional(),
});

export type ScreenerBodyInput = z.infer<typeof ScreenerBody>;

export type ScreenerHit = {
  symbol: string;
  displayName: string;
  assetClass: string;
  price: number | null;
  changePct: number | null;
  volume: number | null;
  rsi14: number | null;
  trend: "up" | "down" | "mixed" | null;
  matched: string[];
};

export type ScreenerResult = {
  hits: ScreenerHit[];
  evaluatedCandidates: number;
  indicatorEvaluated: boolean;
};

function asOhlcv(
  candles: Array<{ t: number; open: number; high: number; low: number; close: number; volume: number | null }>,
): OHLCV[] {
  return candles.map(c => ({ t: c.t, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
}

/**
 * How many bars in `tf` represent a 1d / 1w lookback window. Assumes
 * 24×7 markets (true for crypto; close enough for FX/commodity continuous
 * futures).
 */
function barsForWindow(tf: GlobalTimeframe, win: "1d" | "1w"): number {
  const map: Record<GlobalTimeframe, [number, number]> = {
    "1m":  [1440, 10080],
    "5m":  [288,  2016],
    "15m": [96,   672],
    "1h":  [24,   168],
    "4h":  [6,    42],
    "1d":  [1,    5],
  };
  const [d, w] = map[tf];
  return win === "1d" ? d : w;
}

const EVAL_BUDGET = 60;

export async function runGlobalScreener(body: ScreenerBodyInput): Promise<ScreenerResult> {
  const candidates = UNIVERSE.filter(u => body.assetClasses.includes(u.assetClass as GlobalAssetClass))
    .filter(u => u.supportedTimeframes.includes(body.timeframe));

  const live = await getLivePrices(candidates.map(c => c.symbol));
  const limit = body.limit ?? 25;
  const f = body.filters;

  const prefiltered = candidates.filter(c => {
    const p = live.get(c.symbol);
    if (!p || p.price == null) return false;
    if (f.minChangePct != null && (p.changePct == null || p.changePct < f.minChangePct)) return false;
    if (f.maxChangePct != null && (p.changePct == null || p.changePct > f.maxChangePct)) return false;
    if (f.minVolume != null && (p.volume == null || p.volume < f.minVolume)) return false;
    return true;
  });

  const needsCandles =
    f.minRsi14 != null || f.maxRsi14 != null ||
    f.breakoutLookback != null || f.breakdownLookback != null ||
    f.trendUp || f.trendDown ||
    f.requireSupertrendUp || f.requireSupertrendDown ||
    f.min1dChangePct != null || f.min1wChangePct != null ||
    f.priceAboveSma50 || f.priceBelowSma50 ||
    f.priceAboveSma200 || f.priceBelowSma200;

  const hits: ScreenerHit[] = [];

  for (const inst of prefiltered.slice(0, needsCandles ? EVAL_BUDGET : prefiltered.length)) {
    const p = live.get(inst.symbol)!;
    const matched: string[] = [];
    let rsi14: number | null = null;
    let trend: "up" | "down" | "mixed" | null = null;

    if (f.minChangePct != null) matched.push(`Δ% ≥ ${f.minChangePct}`);
    if (f.maxChangePct != null) matched.push(`Δ% ≤ ${f.maxChangePct}`);
    if (f.minVolume != null) matched.push(`vol ≥ ${f.minVolume}`);

    if (needsCandles) {
      try {
        const candles = await getCandlesFresh(inst.symbol, body.timeframe, 250);
        if (candles.length < 30) continue;
        const ohlcv = asOhlcv(candles);
        const closes = ohlcv.map(c => c.close);
        const last = closes[closes.length - 1]!;

        if (f.minRsi14 != null || f.maxRsi14 != null) {
          rsi14 = lastNonNull(rsi(closes, 14));
          if (rsi14 == null) continue;
          if (f.minRsi14 != null && rsi14 < f.minRsi14) continue;
          if (f.maxRsi14 != null && rsi14 > f.maxRsi14) continue;
          matched.push(`RSI14 ${rsi14.toFixed(1)}`);
        }
        if (f.breakoutLookback) {
          const hh = highestHigh(ohlcv.slice(0, -1), f.breakoutLookback);
          if (hh == null || last <= hh) continue;
          matched.push(`breakout/${f.breakoutLookback}`);
        }
        if (f.breakdownLookback) {
          const ll = lowestLow(ohlcv.slice(0, -1), f.breakdownLookback);
          if (ll == null || last >= ll) continue;
          matched.push(`breakdown/${f.breakdownLookback}`);
        }
        if (f.trendUp || f.trendDown) {
          const e20 = lastNonNull(ema(closes, 20));
          const e50 = lastNonNull(ema(closes, 50));
          const e200 = lastNonNull(ema(closes, 200));
          if (e20 == null || e50 == null || e200 == null) continue;
          if (e20 > e50 && e50 > e200) trend = "up";
          else if (e20 < e50 && e50 < e200) trend = "down";
          else trend = "mixed";
          if (f.trendUp && trend !== "up") continue;
          if (f.trendDown && trend !== "down") continue;
          matched.push(`trend ${trend}`);
        }
        if (f.requireSupertrendUp || f.requireSupertrendDown) {
          const st = supertrend(ohlcv, 10, 3);
          const dir = lastNonNull(st.direction as Array<-1 | 1 | null>);
          if (dir == null) continue;
          if (f.requireSupertrendUp && dir !== 1) continue;
          if (f.requireSupertrendDown && dir !== -1) continue;
          matched.push(`supertrend ${dir === 1 ? "up" : "down"}`);
        }
        if (f.min1dChangePct != null) {
          const bars = barsForWindow(body.timeframe, "1d");
          if (closes.length <= bars) continue;
          const ref = closes[closes.length - 1 - bars]!;
          const chg = ((last - ref) / ref) * 100;
          if (chg < f.min1dChangePct) continue;
          matched.push(`1d ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%`);
        }
        if (f.min1wChangePct != null) {
          const bars = barsForWindow(body.timeframe, "1w");
          if (closes.length <= bars) continue;
          const ref = closes[closes.length - 1 - bars]!;
          const chg = ((last - ref) / ref) * 100;
          if (chg < f.min1wChangePct) continue;
          matched.push(`1w ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%`);
        }
        if (f.priceAboveSma50 || f.priceBelowSma50) {
          const s50 = lastNonNull(sma(closes, 50));
          if (s50 == null) continue;
          if (f.priceAboveSma50 && !(last > s50)) continue;
          if (f.priceBelowSma50 && !(last < s50)) continue;
          matched.push(`px ${last > s50 ? ">" : "<"} SMA50`);
        }
        if (f.priceAboveSma200 || f.priceBelowSma200) {
          const s200 = lastNonNull(sma(closes, 200));
          if (s200 == null) continue;
          if (f.priceAboveSma200 && !(last > s200)) continue;
          if (f.priceBelowSma200 && !(last < s200)) continue;
          matched.push(`px ${last > s200 ? ">" : "<"} SMA200`);
        }
      } catch (err) {
        logger.debug({ err: (err as Error).message, symbol: inst.symbol }, "screener candle fetch failed");
        continue;
      }
    }

    hits.push({
      symbol: inst.symbol,
      displayName: inst.displayName,
      assetClass: inst.assetClass,
      price: p.price,
      changePct: p.changePct,
      volume: p.volume,
      rsi14,
      trend,
      matched,
    });
    if (hits.length >= limit) break;
  }

  hits.sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0));
  return { hits, evaluatedCandidates: prefiltered.length, indicatorEvaluated: !!needsCandles };
}
