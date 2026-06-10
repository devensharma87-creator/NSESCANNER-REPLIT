import type { MarketTrend, SignalReason, SectorSummary, StockRow } from "@workspace/api-zod";
import { scanAll, getCachedScanRows, refreshScanInBackground } from "./scanner";
import { fetchIntraday, fetchIndexChart } from "./yahoo";
import { fetchKiteIntraday } from "./kiteIntraday";
import { ema, rsi, sessionVwap } from "./indicators";
import { isFreshFor } from "./chartDatafeed";
import { SECTORS } from "./universe";

let cache: { ts: number; data: MarketTrend } | null = null;
const TTL = 30 * 1000;

function lastVal(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i] as number;
  return null;
}

export async function getMarketTrend(): Promise<MarketTrend> {
  if (cache && Date.now() - cache.ts < TTL) return cache.data;

  // Prefer the synchronous cached scan rows so a slow Yahoo refresh never
  // blocks this endpoint. Only await `scanAll()` on a true cold start
  // when the cache has never been populated. This keeps /market/trend
  // responsive (sub-second) during Yahoo regional outages while still
  // recomputing breadth/sector leaders the moment the scanner is warm.
  const cached = getCachedScanRows();
  let rows: StockRow[];
  if (cached.rows.length > 0) {
    rows = cached.rows;
    refreshScanInBackground();
  } else {
    rows = await scanAll();
  }
  // Threshold of ±0.05% so trivial intraday flicker is counted as unchanged
  // (matches the watchlist UI). Using exactly 0 over-counts noise.
  const FLAT = 0.05;
  let advancers = 0, decliners = 0, unchanged = 0;
  for (const r of rows) {
    if (r.quote.changePercent > FLAT) advancers++;
    else if (r.quote.changePercent < -FLAT) decliners++;
    else unchanged++;
  }
  const adRatio = decliners === 0 ? advancers : advancers / Math.max(1, decliners);

  const drivers: SignalReason[] = [];
  let score = 0;

  // 1. Breadth (weight 25)
  if (adRatio >= 1.5) { score += 25; drivers.push({ label: "Strong breadth", detail: `Advancers/Decliners ratio ${adRatio.toFixed(2)} — broad participation in the rally.`, weight: 25, bullish: true }); }
  else if (adRatio <= 0.66) { score -= 25; drivers.push({ label: "Weak breadth", detail: `Advancers/Decliners ratio ${adRatio.toFixed(2)} — declines outweigh advances.`, weight: 25, bullish: false }); }
  else { drivers.push({ label: "Mixed breadth", detail: `Advancers/Decliners ratio ${adRatio.toFixed(2)} — no clear leadership.`, weight: 5, bullish: adRatio > 1 }); }

  // 2. NIFTY intraday vs VWAP and EMAs (weight 35)
  // Track which source actually fed the index candles so the trend can
  // be HONEST about Kite-vs-Yahoo provenance (no silent fallback). The
  // fallback below is intentional and explicit — we just surface it.
  let idxKiteCount = 0, idxYahooCount = 0, idxFreshestMs = 0;
  for (const idx of [
    { sym: "^NSEI", name: "NIFTY 50", w: 20 },
    { sym: "^NSEBANK", name: "BANK NIFTY", w: 15 },
  ]) {
    try {
      // Kite-first for live 15-min index candles (no Yahoo 15-min delay).
      let intra = await fetchKiteIntraday(idx.sym, "15minute", 5);
      let intraSource: "kite" | "yahoo" | null =
        intra && intra.close.length >= 6 ? "kite" : null;
      if (!intra || intra.close.length < 6) {
        intra = await fetchIntraday(idx.sym, "15m", "5d");
        if (intra && intra.close.length >= 6) intraSource = "yahoo";
      }
      if (!intra || intra.close.length < 6 || intraSource == null) continue;
      // Candles were consumed for this index rule — record provenance.
      if (intraSource === "kite") idxKiteCount++; else idxYahooCount++;
      const lastTsSec = intra.timestamps[intra.timestamps.length - 1];
      if (typeof lastTsSec === "number" && Number.isFinite(lastTsSec) && lastTsSec * 1000 > idxFreshestMs) {
        idxFreshestMs = lastTsSec * 1000;
      }
      const last = intra.close[intra.close.length - 1]!;
      // VWAP / EMA9 / EMA21 / RSI must NOT silently fall back to `last` or 50.
      // Substituting `last` makes `last > vwap` always false (last == last)
      // and silently fabricates a "no bias" verdict; substituting RSI=50
      // wedges the rule into the neutral arm. Skip the entire index rule
      // when any of the four inputs is missing — honest absence beats a
      // mechanically-neutral verdict that looks measured.
      const vwap = lastVal(sessionVwap(intra.high, intra.low, intra.close, intra.volume));
      const e9 = lastVal(ema(intra.close, 9));
      const e21 = lastVal(ema(intra.close, 21));
      const r14 = lastVal(rsi(intra.close, 14));
      if (vwap == null || e9 == null || e21 == null || r14 == null) continue;
      const above = last > vwap && e9 > e21;
      const below = last < vwap && e9 < e21;
      if (above && r14 >= 50) { score += idx.w; drivers.push({ label: `${idx.name} bullish intraday`, detail: `Above VWAP ${vwap.toFixed(2)} with EMA9>EMA21, RSI ${r14.toFixed(0)}.`, weight: idx.w, bullish: true }); }
      else if (below && r14 <= 50) { score -= idx.w; drivers.push({ label: `${idx.name} bearish intraday`, detail: `Below VWAP ${vwap.toFixed(2)} with EMA9<EMA21, RSI ${r14.toFixed(0)}.`, weight: idx.w, bullish: false }); }
      else { drivers.push({ label: `${idx.name} mixed`, detail: `Spot ${last.toFixed(2)}, VWAP ${vwap.toFixed(2)}, RSI ${r14.toFixed(0)} — no clear bias.`, weight: 4, bullish: last > vwap }); }
    } catch { /* ignore */ }
  }

  // 3. India VIX direction (weight 10)
  try {
    const vix = await fetchIndexChart("^INDIAVIX");
    if (vix && vix.close.length >= 2) {
      const c = vix.meta.regularMarketPrice ?? vix.close[vix.close.length - 1]!;
      const p = vix.close[vix.close.length - 2]!;
      const ch = ((c - p) / p) * 100;
      if (ch <= -3) { score += 8; drivers.push({ label: "VIX cooling", detail: `India VIX down ${ch.toFixed(2)}% — risk appetite improving.`, weight: 8, bullish: true }); }
      else if (ch >= 5) { score -= 10; drivers.push({ label: "VIX spiking", detail: `India VIX up ${ch.toFixed(2)}% — fear bid.`, weight: 10, bullish: false }); }
    }
  } catch { /* ignore */ }

  // Sector leadership
  const sectorMap = new Map<string, StockRow[]>();
  for (const s of SECTORS) sectorMap.set(s, []);
  for (const r of rows) sectorMap.get(r.sector)?.push(r);
  const sectorSums: SectorSummary[] = [];
  for (const [sec, list] of sectorMap.entries()) {
    if (list.length === 0) continue;
    const avgScore = Math.round(list.reduce((a, b) => a + b.recommendation.score, 0) / list.length);
    const avgChange = +(list.reduce((a, b) => a + b.quote.changePercent, 0) / list.length).toFixed(2);
    const gainers = list.filter(r => r.quote.changePercent > 0).length;
    const losers = list.filter(r => r.quote.changePercent < 0).length;
    const topPick = list.slice().sort((a, b) => b.recommendation.score - a.recommendation.score)[0]!;
    sectorSums.push({ sector: sec, stockCount: list.length, avgScore, avgChangePercent: avgChange, gainers, losers, topPick });
  }
  const leaders = sectorSums.slice().sort((a, b) => (b.avgChangePercent ?? 0) - (a.avgChangePercent ?? 0)).slice(0, 3);
  const laggards = sectorSums.slice().sort((a, b) => (a.avgChangePercent ?? 0) - (b.avgChangePercent ?? 0)).slice(0, 3);

  score = Math.max(-100, Math.min(100, score));
  let bias: MarketTrend["bias"] = "NEUTRAL";
  if (score >= 50) bias = "STRONG_BULLISH";
  else if (score >= 20) bias = "BULLISH";
  else if (score <= -50) bias = "STRONG_BEARISH";
  else if (score <= -20) bias = "BEARISH";

  const headline = (() => {
    switch (bias) {
      case "STRONG_BULLISH": return "Markets are in risk-on mode — strong breadth and indices above key intraday levels.";
      case "BULLISH": return "Trend is mildly bullish. Buy dips into VWAP / EMA21 favoured.";
      case "BEARISH": return "Trend is mildly bearish. Sell rallies into resistance.";
      case "STRONG_BEARISH": return "Heavy distribution and broad weakness — defensive stance recommended.";
      default: return "Markets are choppy. Stay nimble and wait for a directional close.";
    }
  })();

  const data: MarketTrend = {
    bias,
    score: Math.round(score),
    headline,
    breadth: { advancers, decliners, unchanged, advanceDeclineRatio: +adRatio.toFixed(2) },
    drivers,
    sectorLeaders: leaders,
    sectorLaggards: laggards,
    lastUpdated: new Date(),
    candleProvenance: {
      source:
        idxKiteCount > 0 && idxYahooCount > 0 ? "mixed"
          : idxKiteCount > 0 ? "kite"
            : idxYahooCount > 0 ? "yahoo"
              : "none",
      asOf: idxFreshestMs > 0 ? new Date(idxFreshestMs) : null,
      fresh: isFreshFor(idxFreshestMs > 0 ? idxFreshestMs / 1000 : null, "15m"),
      indicesUsed: idxKiteCount + idxYahooCount,
      kiteCount: idxKiteCount,
      yahooCount: idxYahooCount,
    },
  };
  cache = { ts: Date.now(), data };
  return data;
}
