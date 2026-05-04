import { Router, type IRouter } from "express";
import { fetchIntraday } from "../lib/yahoo";
import { fetchKiteIntraday, hasKiteIntradayCoverage } from "../lib/kiteIntraday";
import { ema, rsi, macd, adx, avgVolume } from "../lib/indicators";
import { fetchOptionChain } from "../lib/optionChain";
import { computeAnalytics } from "../lib/optionAnalytics";
import { logger } from "../lib/logger";

const router: IRouter = Router();

interface IndexEnrichment {
  key: string;
  sparkline: number[];
  rsi14: number | null;
  macdHist: number | null;
  adx14: number | null;
  volumeRatio: number | null;
  pcrOi: number | null;
  pcrVolume: number | null;
  maxPain: number | null;
  atmIv: number | null;
  optionsBias: string | null;
  topCeWalls: { strike: number; oi: number }[];
  topPeWalls: { strike: number; oi: number }[];
}

interface HomeEnrichmentResponse {
  indices: IndexEnrichment[];
  generatedAt: string;
}

const INDICES = [
  { key: "NIFTY50", yahoo: "^NSEI", underlying: "NIFTY" },
  { key: "BANKNIFTY", yahoo: "^NSEBANK", underlying: "BANKNIFTY" },
  { key: "FINNIFTY", yahoo: "NIFTY_FIN_SERVICE.NS", underlying: "FINNIFTY" },
  { key: "MIDCPNIFTY", yahoo: "NIFTY_MID_SELECT.NS", underlying: "MIDCPNIFTY" },
  { key: "SENSEX", yahoo: "^BSESN", underlying: "SENSEX" },
];

let cache: { ts: number; data: HomeEnrichmentResponse } | null = null;
const TTL = 30_000;

function lastVal(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i] as number;
  return null;
}

async function fetchIndexEnrichment(idx: typeof INDICES[number]): Promise<IndexEnrichment> {
  const result: IndexEnrichment = {
    key: idx.key,
    sparkline: [],
    rsi14: null,
    macdHist: null,
    adx14: null,
    volumeRatio: null,
    pcrOi: null,
    pcrVolume: null,
    maxPain: null,
    atmIv: null,
    optionsBias: null,
    topCeWalls: [],
    topPeWalls: [],
  };

  const [intraResult, optionsResult] = await Promise.allSettled([
    (async () => {
      let intra = hasKiteIntradayCoverage(idx.yahoo)
        ? await fetchKiteIntraday(idx.yahoo, "5minute", 1).catch(() => null)
        : null;
      if (!intra || intra.close.length < 10) {
        intra = await fetchIntraday(idx.yahoo, "5m", "1d").catch(() => null);
      }
      return intra;
    })(),
    (async () => {
      const chain = await fetchOptionChain(idx.underlying).catch(() => null);
      if (!chain) return null;
      const a = computeAnalytics(chain);
      try {
        const { enrichAnalyticsWithIv } = await import("../lib/ivHistory");
        const ivMetrics = await enrichAnalyticsWithIv(a);
        a.ivRank = ivMetrics.ivRank;
        a.ivPercentile = ivMetrics.ivPercentile;
      } catch { /* non-critical */ }
      return a;
    })(),
  ]);

  if (intraResult.status === "fulfilled" && intraResult.value) {
    const intra = intraResult.value;
    const closes = intra.close.filter((v): v is number => v != null);
    result.sparkline = closes;

    if (closes.length >= 15) {
      result.rsi14 = lastVal(rsi(closes, 14));
      if (result.rsi14 != null) result.rsi14 = +result.rsi14.toFixed(1);
    }

    if (closes.length >= 27) {
      const m = macd(closes);
      result.macdHist = lastVal(m.hist);
      if (result.macdHist != null) result.macdHist = +result.macdHist.toFixed(2);
    }

    if (intra.high.length >= 28 && intra.low.length >= 28) {
      const highs = intra.high.filter((v): v is number => v != null);
      const lows = intra.low.filter((v): v is number => v != null);
      if (highs.length >= 28 && lows.length >= 28) {
        result.adx14 = lastVal(adx(highs, lows, closes, 14));
        if (result.adx14 != null) result.adx14 = +result.adx14.toFixed(1);
      }
    }

    if (intra.volume && intra.volume.length >= 2) {
      const vols = intra.volume.filter((v): v is number => v != null && v > 0);
      if (vols.length >= 2) {
        const currentVol = vols.reduce((a, b) => a + b, 0);
        const avg = avgVolume(vols, 20);
        if (avg > 0) {
          result.volumeRatio = +(currentVol / (avg * vols.length)).toFixed(2);
        }
      }
    }
  }

  if (optionsResult.status === "fulfilled" && optionsResult.value) {
    const analytics = optionsResult.value;
    result.pcrOi = analytics.pcrOi;
    result.pcrVolume = analytics.pcrVolume;
    result.maxPain = analytics.maxPain;
    result.atmIv = analytics.atmIv;
    result.optionsBias = analytics.bias;
    result.topCeWalls = (analytics.topResistance ?? []).slice(0, 3).map(c => ({
      strike: c.strike,
      oi: c.oi,
    }));
    result.topPeWalls = (analytics.topSupport ?? []).slice(0, 3).map(c => ({
      strike: c.strike,
      oi: c.oi,
    }));
  }

  return result;
}

router.get("/home/enrichment", async (_req, res): Promise<void> => {
  if (cache && Date.now() - cache.ts < TTL) {
    res.json(cache.data);
    return;
  }

  try {
    const indices = await Promise.all(INDICES.map(fetchIndexEnrichment));
    const data: HomeEnrichmentResponse = {
      indices,
      generatedAt: new Date().toISOString(),
    };
    cache = { ts: Date.now(), data };
    res.json(data);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Home enrichment handler crashed");
    res.status(500).json({ error: "Internal error computing home enrichment" });
  }
});

export default router;
