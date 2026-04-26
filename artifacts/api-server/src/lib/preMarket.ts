/**
 * Pre/Post-market deep analysis aggregator.
 *
 * Methodology references (industry standard pre-market checklist):
 *  - Moneycontrol pre-open report  → uses GIFT NIFTY + Asian markets + US prior close
 *  - NSE pre-open session 9:00-9:08 → indicative open from order matching
 *  - Bloomberg / Reuters morning notes → DXY, Crude, US 10Y, India VIX
 *  - Zerodha Varsity "Pre-market analysis" chapter → gap analysis vs ATR
 *
 * Composite sentiment score is built from weighted overnight cues:
 *    GIFT NIFTY proxy   ........ ×3.0   (most direct pre-open signal)
 *    Asian markets (avg) ....... ×1.5
 *    US prior close (S&P) ...... ×1.5
 *    DXY (inverted) ............ ×0.5
 *    Crude (sector-mixed)  ..... ×0.3
 *    India VIX (inverted)  ..... ×0.7
 */

import { fetchIntraday, fetchIndexChart } from "./yahoo";
import { getGlobalIndices } from "./globalIndices";
import { scanAll, getCachedScanRows, refreshScanInBackground } from "./scanner";
import { getMarketEvents } from "./marketEvents";
import { INDEX_CONSTITUENTS } from "./universe";
import { logger } from "./logger";

export type Mode = "PRE_MARKET" | "POST_MARKET" | "LIVE";
export type Sentiment = "STRONG_BULLISH" | "BULLISH" | "NEUTRAL" | "BEARISH" | "STRONG_BEARISH";

interface Cue {
  label: string;
  symbol?: string;
  category: "proxy" | "asia" | "us" | "europe" | "commodity" | "currency" | "vix";
  value: number;
  changePercent: number;
  change: number;
  sentiment: "bullish" | "bearish" | "neutral";
  note?: string;
  asOf: Date;
  weight: number;
  inverted?: boolean;
}

function classifySentiment(score: number): Sentiment {
  if (score >= 1.5) return "STRONG_BULLISH";
  if (score >= 0.4) return "BULLISH";
  if (score <= -1.5) return "STRONG_BEARISH";
  if (score <= -0.4) return "BEARISH";
  return "NEUTRAL";
}

function istParts(): { dayOfWeek: number; minutesOfDay: number; dateISO: string } {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return {
    dayOfWeek: ist.getUTCDay(),
    minutesOfDay: ist.getUTCHours() * 60 + ist.getUTCMinutes(),
    dateISO: ist.toISOString().slice(0, 10),
  };
}

function detectMode(): Mode {
  const { dayOfWeek, minutesOfDay } = istParts();
  if (dayOfWeek === 0 || dayOfWeek === 6) return "POST_MARKET";
  if (minutesOfDay < 9 * 60 + 15) return "PRE_MARKET";
  if (minutesOfDay <= 15 * 60 + 30) return "LIVE";
  return "POST_MARKET";
}

function bucket(p: number): "bullish" | "bearish" | "neutral" {
  if (p > 0.15) return "bullish";
  if (p < -0.15) return "bearish";
  return "neutral";
}

/** Build the weighted overnight cue list. Returns cues + composite score in -100..+100 range. */
async function buildOvernightCues(): Promise<{ cues: Cue[]; score: number }> {
  const cues: Cue[] = [];
  let weighted = 0;
  let totalWeight = 0;

  let global: Awaited<ReturnType<typeof getGlobalIndices>> = [];
  try { global = await getGlobalIndices(); } catch (e) { logger.warn({ e }, "preMarket: global feed failed"); }

  // Map global → cue with weight + category
  const cueMap: Record<string, { category: Cue["category"]; weight: number; inverted?: boolean; label?: string }> = {
    "GIFT NIFTY (proxy)": { category: "proxy", weight: 3.0 },
    "Nikkei 225":         { category: "asia",  weight: 1.0 },
    "Hang Seng":          { category: "asia",  weight: 1.0 },
    "Shanghai":           { category: "asia",  weight: 1.0 },
    "FTSE 100":           { category: "europe", weight: 0.6 },
    "DAX":                { category: "europe", weight: 0.6 },
    "S&P 500":            { category: "us",    weight: 1.5 },
    "Nasdaq":             { category: "us",    weight: 1.5 },
    "Dow Jones":          { category: "us",    weight: 1.5 },
    "Dollar Index":       { category: "currency", weight: 0.5, inverted: true, label: "DXY (Dollar Index)" },
    "Crude Oil":          { category: "commodity", weight: 0.3, label: "Crude (WTI)" },
    "Gold":               { category: "commodity", weight: 0.2 },
    "VIX":                { category: "vix",   weight: 0.7, inverted: true, label: "US VIX" },
  };

  for (const idx of global) {
    const map = cueMap[idx.name];
    if (!map) continue;
    const sentimentRaw = bucket(idx.changePercent);
    const sentiment = map.inverted
      ? sentimentRaw === "bullish" ? "bearish" : sentimentRaw === "bearish" ? "bullish" : "neutral"
      : sentimentRaw;
    const cue: Cue = {
      label: map.label ?? idx.name,
      symbol: idx.symbol,
      category: map.category,
      value: idx.price,
      changePercent: idx.changePercent,
      change: idx.change,
      sentiment,
      asOf: new Date((idx.asOf ?? Date.now() / 1000) * 1000),
      weight: map.weight,
      inverted: map.inverted,
    };
    if (map.inverted) cue.note = "Inverse correlation to Indian equities";
    cues.push(cue);

    // Score: inverted cues flip sign.
    const signed = (map.inverted ? -1 : 1) * idx.changePercent;
    weighted += signed * map.weight;
    totalWeight += map.weight;
  }

  // India VIX may not be in global feed → fetch separately.
  if (!cues.some(c => c.label === "India VIX")) {
    try {
      const vix = await fetchIndexChart("^INDIAVIX");
      if (vix?.meta.regularMarketPrice != null && vix.close.length >= 2) {
        const last = vix.meta.regularMarketPrice;
        const prev = vix.close[vix.close.length - 2] ?? last;
        const ch = last - prev;
        const pct = prev > 0 ? (ch / prev) * 100 : 0;
        const sRaw = bucket(pct);
        cues.push({
          label: "India VIX",
          symbol: "^INDIAVIX",
          category: "vix",
          value: last,
          change: ch,
          changePercent: pct,
          sentiment: sRaw === "bullish" ? "bearish" : sRaw === "bearish" ? "bullish" : "neutral",
          note: "Higher VIX → more fear → bearish for equities",
          asOf: new Date(),
          weight: 0.7,
          inverted: true,
        });
        weighted += -1 * pct * 0.7;
        totalWeight += 0.7;
      }
    } catch { /* ignore */ }
  }

  const score = totalWeight > 0 ? weighted / totalWeight : 0; // % avg
  // Score is currently in % units; clamp to -100..+100
  return { cues, score: Math.max(-100, Math.min(100, score * 50)) };
}

/** Indicative pre-open price for major Indian indices. Uses GIFT NIFTY proxy when available;
 *  otherwise falls back to last close (= flat indication). */
async function buildIndexPreviews() {
  const cfgs: Array<{ symbol: string; name: string; yahoo: string; proxyName?: string }> = [
    { symbol: "NIFTY 50", name: "NIFTY 50", yahoo: "^NSEI", proxyName: "NIFTY 50 (proxy)" },
    { symbol: "BANK NIFTY", name: "BANK NIFTY", yahoo: "^NSEBANK" },
    { symbol: "SENSEX", name: "SENSEX", yahoo: "^BSESN" },
    { symbol: "FINNIFTY", name: "FINNIFTY", yahoo: "NIFTY_FIN_SERVICE.NS" },
  ];
  let global: Awaited<ReturnType<typeof getGlobalIndices>> = [];
  try { global = await getGlobalIndices(); } catch { /* ignore */ }
  const giftPct = global.find(g => g.name === "GIFT NIFTY (proxy)")?.changePercent;

  const out = [];
  for (const cfg of cfgs) {
    try {
      const c = await fetchIndexChart(cfg.yahoo);
      const closes = c?.close ?? [];
      const prev = closes.length >= 2 ? closes[closes.length - 2]! : (c?.meta.chartPreviousClose ?? 0);
      const last = c?.meta.regularMarketPrice ?? prev;
      // For pre-open: indicative price = prev * (1 + giftPct/100) if available, else last
      const useProxy = cfg.proxyName != null && giftPct != null;
      const indicativePrice = useProxy ? prev * (1 + (giftPct ?? 0) / 100) : last;
      const indicativeChange = indicativePrice - prev;
      const indicativeChangePercent = prev > 0 ? (indicativeChange / prev) * 100 : 0;
      out.push({
        symbol: cfg.symbol,
        name: cfg.name,
        previousClose: prev,
        indicativePrice,
        indicativeChange,
        indicativeChangePercent,
        source: useProxy ? "GIFT NIFTY proxy" : "previous close (no pre-open data)",
      });
    } catch (e) {
      logger.warn({ e, sym: cfg.symbol }, "preMarket: index preview failed");
    }
  }
  return out;
}

/** Top gainers/losers from Nifty 100 universe — by % change vs prev close. */
async function buildMovers() {
  // Fast path — read whatever the background scanner has cached and kick a
  // refresh in the background. Only fall back to awaiting `scanAll()` on a
  // true cold start (cache never populated). This stops the pre-market
  // endpoint from hanging behind a slow Yahoo full-universe scan.
  const cached = getCachedScanRows();
  let allRows: Awaited<ReturnType<typeof scanAll>>;
  if (cached.rows.length > 0) {
    allRows = cached.rows;
    refreshScanInBackground();
  } else {
    allRows = await scanAll().catch(() => []);
  }
  const nifty100 = new Set<string>([
    ...(INDEX_CONSTITUENTS["NIFTY50"] ?? []),
    ...(INDEX_CONSTITUENTS["BANKNIFTY"] ?? []),
    ...(INDEX_CONSTITUENTS["FINNIFTY"] ?? []),
    ...(INDEX_CONSTITUENTS["NIFTYIT"] ?? []),
    ...(INDEX_CONSTITUENTS["NIFTYAUTO"] ?? []),
    ...(INDEX_CONSTITUENTS["NIFTYPHARMA"] ?? []),
    ...(INDEX_CONSTITUENTS["NIFTYFMCG"] ?? []),
    ...(INDEX_CONSTITUENTS["NIFTYMETAL"] ?? []),
    ...(INDEX_CONSTITUENTS["NIFTYREALTY"] ?? []),
    ...(INDEX_CONSTITUENTS["NIFTYENERGY"] ?? []),
  ].map(s => s.toUpperCase()));

  const filtered = allRows.filter(r => nifty100.has(r.symbol.toUpperCase()) || allRows.length < 100);
  const ranked = filtered.slice().sort((a, b) => b.quote.changePercent - a.quote.changePercent);
  const topGainers = ranked.slice(0, 10).map(r => ({
    symbol: r.symbol,
    name: r.name,
    sector: r.sector,
    price: r.quote.price,
    previousClose: r.quote.previousClose,
    change: r.quote.change,
    changePercent: r.quote.changePercent,
    volume: r.quote.volume,
  }));
  const topLosers = ranked.slice(-10).reverse().map(r => ({
    symbol: r.symbol,
    name: r.name,
    sector: r.sector,
    price: r.quote.price,
    previousClose: r.quote.previousClose,
    change: r.quote.change,
    changePercent: r.quote.changePercent,
    volume: r.quote.volume,
  }));

  // Gap analysis: compare today's open vs prev close, normalize by ATR%
  const gappers = filtered
    .map(r => {
      const atrPct = r.indicators?.atr14 != null && r.quote.price > 0
        ? (r.indicators.atr14 / r.quote.price) * 100
        : 1.0; // assume 1% if missing
      const gapPct = r.quote.previousClose > 0 ? ((r.quote.open - r.quote.previousClose) / r.quote.previousClose) * 100 : 0;
      return {
        symbol: r.symbol,
        name: r.name,
        sector: r.sector,
        previousClose: r.quote.previousClose,
        currentPrice: r.quote.price,
        gapPercent: gapPct,
        gapDirection: gapPct >= 0 ? "UP" as const : "DOWN" as const,
        atrPct,
        gapVsAtr: atrPct > 0 ? Math.abs(gapPct) / atrPct : 0,
        signal: r.recommendation.signal,
      };
    })
    .filter(g => Math.abs(g.gapPercent) >= 0.5); // only significant gaps

  const gapUps = gappers.filter(g => g.gapDirection === "UP").sort((a, b) => b.gapVsAtr - a.gapVsAtr).slice(0, 8);
  const gapDowns = gappers.filter(g => g.gapDirection === "DOWN").sort((a, b) => b.gapVsAtr - a.gapVsAtr).slice(0, 8);

  return { topGainers, topLosers, gapUps, gapDowns, allRows: filtered };
}

/** Post-market digest — internal breadth, summary narrative. */
function buildPostMarketDigest(rows: Awaited<ReturnType<typeof scanAll>>) {
  const adv = rows.filter(r => r.quote.changePercent > 0.1).length;
  const dec = rows.filter(r => r.quote.changePercent < -0.1).length;
  const unc = rows.length - adv - dec;
  const totalVol = rows.reduce((a, r) => a + (r.quote.volume ?? 0), 0);
  const avgChg = rows.length > 0 ? rows.reduce((a, r) => a + r.quote.changePercent, 0) / rows.length : 0;
  const adRatio = dec > 0 ? +(adv / dec).toFixed(2) : (adv > 0 ? null : 0);
  const breadthScore = Math.max(-100, Math.min(100, ((adv - dec) / Math.max(1, rows.length)) * 100));

  let narrative: string;
  if (breadthScore > 30) narrative = `Broad-based rally — ${adv} advances vs ${dec} declines (A/D ${adRatio ?? "∞"}). Buyers in control across the board.`;
  else if (breadthScore > 10) narrative = `Mildly positive close — ${adv} advances vs ${dec} declines. Selective buying.`;
  else if (breadthScore < -30) narrative = `Broad-based selling — ${dec} declines vs ${adv} advances (A/D ${adRatio ?? "0"}). Risk-off across the tape.`;
  else if (breadthScore < -10) narrative = `Mildly negative close — ${dec} declines vs ${adv} advances. Selective selling.`;
  else narrative = `Indecisive close — ${adv} advances vs ${dec} declines roughly balanced. Direction unclear.`;

  return {
    advancers: adv,
    decliners: dec,
    unchanged: unc,
    adRatio,
    totalVolume: totalVol,
    avgChangePercent: +avgChg.toFixed(2),
    marketBreadthScore: +breadthScore.toFixed(1),
    narrative,
  };
}

function todayISO(): string { return istParts().dateISO; }

interface Cached { ts: number; data: PreMarketReportData; }
let cache: Cached | null = null;
const TTL = 60 * 1000; // 1 min

export interface PreMarketReportData {
  mode: Mode;
  sentiment: Sentiment;
  sentimentScore: number;
  narrative: string;
  keyTakeaways: string[];
  overnightCues: Cue[];
  indexPreviews: Awaited<ReturnType<typeof buildIndexPreviews>>;
  topGainers: Awaited<ReturnType<typeof buildMovers>>["topGainers"];
  topLosers: Awaited<ReturnType<typeof buildMovers>>["topLosers"];
  gapUps: Awaited<ReturnType<typeof buildMovers>>["gapUps"];
  gapDowns: Awaited<ReturnType<typeof buildMovers>>["gapDowns"];
  eventsToday: Array<{ date: string; name: string; region?: string; category?: string; impact?: string; description?: string }>;
  earningsToday: Array<{ symbol: string; name: string; date: string }>;
  postMarketDigest?: ReturnType<typeof buildPostMarketDigest>;
  generatedAt: Date;
}

export async function getPreMarketReport(): Promise<PreMarketReportData> {
  if (cache && Date.now() - cache.ts < TTL) return cache.data;

  const mode = detectMode();
  const [{ cues, score }, indexPreviews, movers, eventsResp] = await Promise.all([
    buildOvernightCues(),
    buildIndexPreviews(),
    buildMovers(),
    getMarketEvents().catch(() => null),
  ]);

  const sentiment = classifySentiment(score);
  const today = todayISO();
  const eventsToday = (eventsResp?.events ?? []).filter(e => e.date.startsWith(today)).map(e => ({
    date: e.date,
    name: e.name,
    region: e.region,
    category: e.category,
    impact: e.impact,
    description: e.description,
  }));
  const earningsToday = (eventsResp?.earnings ?? []).filter(e => e.date === today).map(e => ({
    symbol: e.symbol,
    name: e.name ?? e.symbol,
    date: e.date,
  }));

  // Build narrative & takeaways
  const giftCue = cues.find(c => c.label === "GIFT NIFTY (proxy)");
  const usCue = cues.find(c => c.label === "S&P 500");
  const asiaCues = cues.filter(c => c.category === "asia");
  const asiaAvg = asiaCues.length > 0 ? asiaCues.reduce((a, c) => a + c.changePercent, 0) / asiaCues.length : 0;
  const vixCue = cues.find(c => c.label === "India VIX");

  const takeaways: string[] = [];
  if (giftCue) takeaways.push(`GIFT NIFTY ${giftCue.changePercent >= 0 ? "+" : ""}${giftCue.changePercent.toFixed(2)}% — indicates a ${giftCue.changePercent > 0.3 ? "gap-up" : giftCue.changePercent < -0.3 ? "gap-down" : "flat"} opening for Nifty 50.`);
  if (usCue) takeaways.push(`Wall Street closed ${usCue.changePercent >= 0 ? "higher" : "lower"} (S&P ${usCue.changePercent >= 0 ? "+" : ""}${usCue.changePercent.toFixed(2)}%) — ${usCue.changePercent >= 0 ? "supportive" : "negative"} cue overnight.`);
  if (asiaCues.length > 0) takeaways.push(`Asian markets average ${asiaAvg >= 0 ? "+" : ""}${asiaAvg.toFixed(2)}% — ${asiaAvg > 0.3 ? "broadly positive" : asiaAvg < -0.3 ? "broadly weak" : "mixed"}.`);
  if (vixCue) takeaways.push(`India VIX ${vixCue.value.toFixed(2)} (${vixCue.changePercent >= 0 ? "+" : ""}${vixCue.changePercent.toFixed(2)}%) — ${vixCue.value > 18 ? "elevated; expect volatility" : vixCue.value < 12 ? "complacent; risk of surprise moves" : "moderate"}.`);
  if (eventsToday.length > 0) takeaways.push(`Today's macro events: ${eventsToday.slice(0, 3).map(e => e.name).join(", ")}.`);
  if (earningsToday.length > 0) takeaways.push(`Earnings today: ${earningsToday.slice(0, 5).map(e => e.symbol).join(", ")}${earningsToday.length > 5 ? "…" : ""}.`);

  let narrative: string;
  if (mode === "PRE_MARKET") {
    narrative = `Pre-market read is ${sentiment.toLowerCase().replace("_", " ")}. ${
      giftCue ? `GIFT NIFTY ${giftCue.changePercent >= 0 ? "+" : ""}${giftCue.changePercent.toFixed(2)}% suggests a ${giftCue.changePercent > 0.3 ? "gap-up" : giftCue.changePercent < -0.3 ? "gap-down" : "flat"} open. ` : ""
    }${
      usCue && asiaCues.length > 0
        ? `Overnight cues: US ${usCue.changePercent >= 0 ? "+" : ""}${usCue.changePercent.toFixed(2)}%, Asia avg ${asiaAvg >= 0 ? "+" : ""}${asiaAvg.toFixed(2)}%.`
        : ""
    }`;
  } else if (mode === "POST_MARKET") {
    narrative = `Markets have closed for the day. Composite overnight setup is ${sentiment.toLowerCase().replace("_", " ")} for the next session.`;
  } else {
    narrative = `Markets are live. This view shows the overnight setup that established today's open. Sentiment going into the session was ${sentiment.toLowerCase().replace("_", " ")}.`;
  }

  const data: PreMarketReportData = {
    mode,
    sentiment,
    sentimentScore: +score.toFixed(2),
    narrative,
    keyTakeaways: takeaways,
    overnightCues: cues,
    indexPreviews,
    topGainers: movers.topGainers,
    topLosers: movers.topLosers,
    gapUps: movers.gapUps,
    gapDowns: movers.gapDowns,
    eventsToday,
    earningsToday,
    postMarketDigest: movers.allRows.length > 0 ? buildPostMarketDigest(movers.allRows) : undefined,
    generatedAt: new Date(),
  };

  cache = { ts: Date.now(), data };
  return data;
}
