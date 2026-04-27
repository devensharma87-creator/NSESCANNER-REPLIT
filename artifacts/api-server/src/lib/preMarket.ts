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

import { fetchIntraday, fetchIndexChart, fetchChart } from "./yahoo";
import { getGlobalIndices } from "./globalIndices";
import { scanAll, getCachedScanRows, refreshScanInBackground } from "./scanner";
import { getMarketEvents } from "./marketEvents";
import { INDEX_CONSTITUENTS, SECTORS } from "./universe";
import { logger } from "./logger";
import { pivots } from "./indicators";
import { fetchOptionChain } from "./optionChain";
import { computeAnalytics } from "./optionAnalytics";
import { getFiiDiiMonthly } from "./instFlows";

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
  // score domain is -100..+100 (see buildOvernightCues line ~163: avg cue % * 50,
  // clamped to ±100). Thresholds calibrated so a typical mixed overnight session
  // (avg ~0.1-0.3% on cues → ±5-15 score) lands in NEUTRAL/BULLISH, while a
  // strong global risk-on/off day (avg ~0.7%+ → ±35+) lands in STRONG_*.
  if (score >= 35) return "STRONG_BULLISH";
  if (score >= 12) return "BULLISH";
  if (score <= -35) return "STRONG_BEARISH";
  if (score <= -12) return "BEARISH";
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

// ─────────────────────────────────────────────────────────────────
// New: Key Index Levels (CPR + classic pivots + prev-day / weekly /
// monthly / 52-week H/L) for the 5 main F&O indices the user trades.
// ─────────────────────────────────────────────────────────────────

interface KeyIndexLevels {
  symbol: string;
  name: string;
  previousClose: number;
  prevHigh: number;
  prevLow: number;
  todayOpen: number | null;
  weekHigh: number;
  weekLow: number;
  monthHigh: number | null;
  monthLow: number | null;
  yearHigh: number;
  yearLow: number;
  pivot: number;
  r1: number;
  r2: number;
  s1: number;
  s2: number;
  cprTop: number;
  cprPivot: number;
  cprBottom: number;
  cprWidthPct: number;
  cprWidthLabel: "NARROW" | "NORMAL" | "WIDE";
  positionInYearRangePct: number;
}

// Five F&O indices that Indian intraday traders watch every morning. We pull
// 1y of daily bars (not 5d) because the page renders 52-week H/L bands and
// CPR / classic-pivot maths needs prior-session H/L/C — fetchIndexChart()
// is the older 5-day helper used elsewhere and is insufficient here.
// ^CNXNXT50 / NIFTYNXT50 has no working Yahoo symbol in 2026 and Next 50
// has no F&O lot anyway, so we substitute SENSEX (^BSESN) which is an
// active F&O index. ^NSEMDCP50 covers MIDCPNIFTY F&O (the F&O version
// of Nifty Midcap 50).
const INDEX_LEVELS_CONFIGS: Array<{ symbol: string; name: string }> = [
  { symbol: "^NSEI",                name: "NIFTY 50" },
  { symbol: "^NSEBANK",             name: "BANK NIFTY" },
  { symbol: "NIFTY_FIN_SERVICE.NS", name: "FINNIFTY" },
  { symbol: "^NSEMDCP50",           name: "NIFTY MIDCAP 50" },
  { symbol: "^BSESN",               name: "SENSEX" },
];

async function buildIndexLevels(): Promise<KeyIndexLevels[]> {
  const out: KeyIndexLevels[] = [];
  await Promise.all(INDEX_LEVELS_CONFIGS.map(async cfg => {
    try {
      const c = await fetchChart(cfg.symbol, "1y", "1d");
      if (!c) return;
      const closes = c.close.filter((x): x is number => x != null);
      const highs  = c.high.filter((x): x is number => x != null);
      const lows   = c.low.filter((x): x is number => x != null);
      if (closes.length < 2 || highs.length < 2 || lows.length < 2) return;

      // Previous SESSION = the bar at index length-2 (length-1 is today, possibly partial / unset).
      const n = closes.length;
      const prevClose = closes[n - 2]!;
      const prevHigh  = highs[n - 2]!;
      const prevLow   = lows[n - 2]!;
      const todayOpen = c.meta.regularMarketPrice != null && c.meta.regularMarketPrice !== prevClose
        ? (c.open?.[n - 1] ?? null)
        : null;

      // Rolling windows are computed over the bars *before* today so the figures
      // don't drift mid-session (price still ticks but the band stays stable).
      // True intraday H/L bands MUST come from the high/low arrays — using
      // close-only would systematically underestimate the highs and overstate
      // the lows (a 3% intraday spike that closes flat would not register).
      const slice = (arr: number[], k: number) => arr.slice(Math.max(0, n - 1 - k), n - 1);
      const weekHs = slice(highs, 5);
      const weekLs = slice(lows, 5);
      const weekHigh  = weekHs.length > 0 ? Math.max(...weekHs) : prevHigh;
      const weekLow   = weekLs.length > 0 ? Math.min(...weekLs) : prevLow;
      const monthHigh = closes.length >= 22 ? Math.max(...slice(highs, 22)) : null;
      const monthLow  = closes.length >= 22 ? Math.min(...slice(lows,  22)) : null;
      const yearHs = slice(highs, 252);
      const yearLs = slice(lows,  252);
      const yearHigh = yearHs.length > 0 ? Math.max(...yearHs) : prevHigh;
      const yearLow  = yearLs.length > 0 ? Math.min(...yearLs) : prevLow;

      const piv = pivots(prevHigh, prevLow, prevClose);

      // CPR (Central Pivot Range) — Frank Ochoa formula:
      //   pivot = (PH + PL + PC) / 3
      //   BC    = (PH + PL) / 2
      //   TC    = 2*pivot - BC
      const cprBottom = (prevHigh + prevLow) / 2;
      const cprTop    = 2 * piv.pivot - cprBottom;
      const cprWidthPct = prevClose > 0 ? (Math.abs(cprTop - cprBottom) / prevClose) * 100 : 0;
      const cprWidthLabel: KeyIndexLevels["cprWidthLabel"] =
        cprWidthPct < 0.4 ? "NARROW" : cprWidthPct > 1.0 ? "WIDE" : "NORMAL";

      const yrSpan = Math.max(1e-9, yearHigh - yearLow);
      const positionInYearRangePct = Math.max(0, Math.min(100, ((prevClose - yearLow) / yrSpan) * 100));

      out.push({
        symbol: cfg.symbol,
        name: cfg.name,
        previousClose: prevClose,
        prevHigh, prevLow,
        todayOpen,
        weekHigh, weekLow,
        monthHigh, monthLow,
        yearHigh, yearLow,
        pivot: piv.pivot,
        r1: piv.r1, r2: piv.r2, s1: piv.s1, s2: piv.s2,
        cprTop: Math.max(cprTop, cprBottom),
        cprPivot: piv.pivot,
        cprBottom: Math.min(cprTop, cprBottom),
        cprWidthPct,
        cprWidthLabel,
        positionInYearRangePct,
      });
    } catch (e) {
      logger.warn({ e, sym: cfg.symbol }, "preMarket: index levels failed");
    }
  }));
  return out;
}

// ─────────────────────────────────────────────────────────────────
// New: Option-chain morning snapshot. Per F&O index — ATM strike,
// expected move from ATM straddle, PCR (OI + volume), max-pain,
// max-call-OI strike (resistance) + max-put-OI strike (support).
// Best-effort; if the chain endpoint is geo-blocked and no Kite
// session is active, the section is simply omitted from the response.
// ─────────────────────────────────────────────────────────────────

interface OptionSnapshot {
  underlying: string;
  spot: number;
  expiry: string;
  atmStrike: number;
  atmStraddle: number;
  expectedMovePct: number;
  pcrOi: number;
  pcrVolume: number;
  atmIv: number | null;
  maxPain: number;
  maxCallOiStrike: number | null;
  maxPutOiStrike: number | null;
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  interpretation: string;
  generatedAt: string;
}

const OPTION_SNAPSHOT_UNDERLYINGS = ["NIFTY", "BANKNIFTY", "FINNIFTY"];

async function buildOptionSnapshots(): Promise<OptionSnapshot[]> {
  const settled = await Promise.allSettled(
    OPTION_SNAPSHOT_UNDERLYINGS.map(async (u): Promise<OptionSnapshot | null> => {
      const chain = await fetchOptionChain(u).catch(() => null);
      if (!chain || chain.rows.length === 0) return null;
      const a = computeAnalytics(chain);

      // ATM straddle = LTP(ATM CE) + LTP(ATM PE). Fall back to closest-to-ATM
      // row if the exact ATM strike is missing from the chain rows.
      const atmRow = chain.rows.find(r => r.strike === chain.atmStrike)
        ?? chain.rows.slice().sort((p, q) => Math.abs(p.strike - chain.spot) - Math.abs(q.strike - chain.spot))[0];
      const ceLtp = atmRow?.ce?.ltp ?? 0;
      const peLtp = atmRow?.pe?.ltp ?? 0;
      const atmStraddle = ceLtp + peLtp;
      const expectedMovePct = chain.spot > 0 ? (atmStraddle / chain.spot) * 100 : 0;

      return {
        underlying: u,
        spot: chain.spot,
        expiry: chain.expiry,
        atmStrike: chain.atmStrike,
        atmStraddle: +atmStraddle.toFixed(2),
        expectedMovePct: +expectedMovePct.toFixed(2),
        pcrOi: a.pcrOi,
        pcrVolume: a.pcrVolume,
        atmIv: a.atmIv,
        maxPain: a.maxPain,
        maxCallOiStrike: a.topResistance[0]?.strike ?? null,
        maxPutOiStrike: a.topSupport[0]?.strike ?? null,
        bias: a.bias,
        interpretation: a.interpretation,
        generatedAt: a.generatedAt,
      };
    }),
  );
  return settled
    .map(r => r.status === "fulfilled" ? r.value : null)
    .filter((x): x is OptionSnapshot => x != null);
}

// ─────────────────────────────────────────────────────────────────
// New: Full sector heatmap. /market/trend exposes only top-3
// leaders + bottom-3 laggards; the doc explicitly asks for the
// complete leader→laggard ranking, so we recompute it here from
// the same cached scan rows.
// ─────────────────────────────────────────────────────────────────

interface SectorHeatmapEntry {
  sector: string;
  avgChangePercent: number;
  gainers: number;
  losers: number;
  stockCount: number;
  topPickSymbol?: string;
}

function buildSectorHeatmap(rows: Awaited<ReturnType<typeof scanAll>>): SectorHeatmapEntry[] {
  const bySector = new Map<string, typeof rows>();
  for (const s of SECTORS) bySector.set(s, []);
  for (const r of rows) {
    const list = bySector.get(r.sector);
    if (list) list.push(r);
  }
  const entries: SectorHeatmapEntry[] = [];
  for (const [sec, list] of bySector.entries()) {
    if (list.length === 0) continue;
    const gainers = list.filter(r => r.quote.changePercent > 0).length;
    const losers  = list.filter(r => r.quote.changePercent < 0).length;
    const avgCh   = list.reduce((a, r) => a + r.quote.changePercent, 0) / list.length;
    const top     = list.slice().sort((a, b) => b.recommendation.score - a.recommendation.score)[0];
    entries.push({
      sector: sec,
      avgChangePercent: +avgCh.toFixed(2),
      gainers, losers,
      stockCount: list.length,
      topPickSymbol: top?.symbol,
    });
  }
  return entries.sort((a, b) => b.avgChangePercent - a.avgChangePercent);
}

// ─────────────────────────────────────────────────────────────────
// New: FII / DII cash snapshot — last published day + 5-day rolling
// totals. instFlows.ts already persists these, so this is a thin
// reformat of the existing monthly aggregation.
// ─────────────────────────────────────────────────────────────────

interface FiiDiiSnapshot {
  latestDate: string;
  fiiCashCr: number;
  diiCashCr: number;
  fiveDayFiiCr: number;
  fiveDayDiiCr: number;
}

async function buildFiiDiiSnapshot(): Promise<FiiDiiSnapshot | null> {
  try {
    // Pull last two months → flatten days → take most recent 5 trading days.
    const months = await getFiiDiiMonthly(2);
    const days = months.flatMap(m => m.days).sort((a, b) => a.date.localeCompare(b.date));
    if (days.length === 0) return null;
    const latest = days[days.length - 1]!;
    const lastFive = days.slice(-5);
    const fiveDayFii = lastFive.reduce((a, d) => a + d.fiiNet, 0);
    const fiveDayDii = lastFive.reduce((a, d) => a + d.diiNet, 0);
    return {
      latestDate: latest.date,
      fiiCashCr: +latest.fiiNet.toFixed(2),
      diiCashCr: +latest.diiNet.toFixed(2),
      fiveDayFiiCr: +fiveDayFii.toFixed(2),
      fiveDayDiiCr: +fiveDayDii.toFixed(2),
    };
  } catch (e) {
    logger.warn({ e }, "preMarket: FII/DII snapshot failed");
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// New: 3 trading scenarios for the day. Pure derivation — anchors
// on Nifty 50 levels (CPR + R1/S1) and the composite sentiment so
// each scenario has a concrete trigger and action plan rather than
// a vague "be cautious" disclaimer.
// ─────────────────────────────────────────────────────────────────

interface TradingScenario {
  kind: "BULLISH" | "BEARISH" | "RANGE";
  label: string;
  trigger: string;
  actions: string[];
  invalidation: string;
  probability: "HIGH" | "MEDIUM" | "LOW";
}

function buildScenarios(args: {
  sentimentScore: number;
  giftPct: number | null;
  vix: number | null;
  niftyLevels: KeyIndexLevels | undefined;
}): TradingScenario[] {
  const { sentimentScore, giftPct, vix, niftyLevels } = args;
  const fmt = (n: number | undefined | null) => n == null ? "—" : n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

  // Probability heuristic: bias-aligned scenarios get HIGH when sentiment is
  // strong + GIFT confirms + India VIX cooperates. Counter-trend scenarios
  // get LOW. Range gets HIGH when CPR is wide, sentiment is flat, or VIX
  // is elevated (risk-off mornings often whip before trending).
  //
  // Sentiment is on the cues "score" scale (clamped -100..+100 in
  // buildOvernightCues — see the * 50 scaling at line 163), so the
  // thresholds below are in the same units.
  const cprIsWide = niftyLevels?.cprWidthLabel === "WIDE";
  const cprIsNarrow = niftyLevels?.cprWidthLabel === "NARROW";
  const giftBull = (giftPct ?? 0) > 0.2;
  const giftBear = (giftPct ?? 0) < -0.2;
  const vixCalm     = vix != null && vix < 13;     // complacent — favors trend
  const vixElevated = vix != null && vix > 18;     // risk-off — favors range/whip + bear
  const vixVeryHigh = vix != null && vix > 22;     // panic — strong tailwind for bear
  const sentStrong  = Math.abs(sentimentScore) > 25;
  const sentFlat    = Math.abs(sentimentScore) < 10;

  const bullProb: TradingScenario["probability"] =
    sentimentScore > 25 && giftBull && !vixElevated ? "HIGH"
    : (sentimentScore > 5 || giftBull) && !vixVeryHigh ? "MEDIUM"
    : "LOW";
  const bearProb: TradingScenario["probability"] =
    (sentimentScore < -25 && giftBear) || (vixVeryHigh && sentimentScore < 0) ? "HIGH"
    : sentimentScore < -5 || giftBear || vixElevated ? "MEDIUM"
    : "LOW";
  const rangeProb: TradingScenario["probability"] =
    sentFlat || cprIsWide || vixElevated ? "HIGH"
    : cprIsNarrow && vixCalm && sentStrong ? "LOW"
    : "MEDIUM";

  const vixHigh = vixElevated;

  const r1 = niftyLevels?.r1, r2 = niftyLevels?.r2;
  const s1 = niftyLevels?.s1, s2 = niftyLevels?.s2;
  const cprTop = niftyLevels?.cprTop, cprBot = niftyLevels?.cprBottom;

  return [
    {
      kind: "BULLISH",
      label: r1 != null ? `Bullish — sustained move above R1 ${fmt(r1)}` : "Bullish breakout",
      trigger: r1 != null
        ? `NIFTY 50 sustains 15-min close above R1 ${fmt(r1)} with Bank Nifty confirming and breadth positive (A/D > 1.5).`
        : `NIFTY 50 trades above day-1 high with broad sectoral participation and rising A/D ratio.`,
      actions: [
        `Look for VWAP / opening-range pullback longs in leading sectors (IT, Banks, Auto).`,
        r2 != null ? `First target ${fmt(r2)} (R2); trail stop below day-low or VWAP.` : `Trail stop below VWAP or 15-min swing low.`,
        `On the option side: prefer ATM/slightly ITM CE buying or bull-call spreads. Avoid far-OTM lottery strikes.`,
        vixHigh ? `India VIX is elevated — trim option-buying size; premiums are inflated.` : `India VIX is calm — option premiums are reasonable for directional buys.`,
      ],
      invalidation: s1 != null
        ? `15-min close back below pivot ${fmt(niftyLevels?.pivot)} or below S1 ${fmt(s1)} — the breakout failed; cut all longs.`
        : `15-min close back below VWAP and below the opening-range low — the breakout failed; cut all longs.`,
      probability: bullProb,
    },
    {
      kind: "BEARISH",
      label: s1 != null ? `Bearish — breakdown below S1 ${fmt(s1)}` : "Bearish breakdown",
      trigger: s1 != null
        ? `NIFTY 50 sustains 15-min close below S1 ${fmt(s1)} with Bank Nifty leading lower and breadth negative (A/D < 0.7).`
        : `NIFTY 50 breaks day-1 low with weakness in heavyweights and rising VIX.`,
      actions: [
        `Look for VWAP-rejection shorts in laggard sectors (Realty, Metals if commodities are weak).`,
        s2 != null ? `First target ${fmt(s2)} (S2); trail stop above day-high or VWAP.` : `Trail stop above VWAP or 15-min swing high.`,
        `On the option side: ATM/ITM PE buying or bear-put spreads. Prefer defined-risk over naked option selling.`,
        `Avoid catching the falling knife — wait for a 5-min lower-high before adding short side risk.`,
      ],
      invalidation: r1 != null
        ? `15-min close back above pivot ${fmt(niftyLevels?.pivot)} or above R1 ${fmt(r1)} — short thesis is wrong; cover and step aside.`
        : `15-min close back above VWAP and above the opening-range high — short thesis is wrong; cover and step aside.`,
      probability: bearProb,
    },
    {
      kind: "RANGE",
      label: cprBot != null && cprTop != null
        ? `Range — chop between ${fmt(cprBot)} (BC) and ${fmt(cprTop)} (TC)`
        : "Range / chop day",
      trigger: cprBot != null && cprTop != null
        ? `NIFTY 50 oscillates inside CPR (${fmt(cprBot)}–${fmt(cprTop)}) with no sectoral leadership and India VIX cooling.`
        : `Index opens inside previous-day range with mixed breadth and no clear sector leadership.`,
      actions: [
        cprIsWide
          ? `Wide CPR (${niftyLevels?.cprWidthPct.toFixed(2)}%) — favours range/chop; expect rotation, not a trend.`
          : cprIsNarrow
            ? `Narrow CPR (${niftyLevels?.cprWidthPct.toFixed(2)}%) — be ready, today often turns into a trend day if CPR is broken decisively.`
            : `Normal CPR width — read the first 15-min candle for direction.`,
        `Avoid directional option-buying — theta will eat premium. Prefer defined-risk neutral structures (iron fly / iron condor) only if skilled with margins.`,
        `Scalp inside-bar reversals at CPR extremes; cut size in half versus a trend day.`,
        `If max loss for the day is hit, stop trading. Do not revenge-trade a chop session.`,
      ],
      invalidation: r1 != null && s1 != null
        ? `Decisive 15-min close above R1 ${fmt(r1)} or below S1 ${fmt(s1)} — switch to the BULL or BEAR plan respectively; no longer a range day.`
        : `Decisive 15-min close outside the previous-day range — switch to the BULL or BEAR plan respectively; no longer a range day.`,
      probability: rangeProb,
    },
  ];
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
  scenarios: TradingScenario[];
  indexLevels: KeyIndexLevels[];
  optionSnapshots: OptionSnapshot[];
  sectorHeatmap: SectorHeatmapEntry[];
  fiiDii?: FiiDiiSnapshot;
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
  // All sections fetched in parallel. Each one is independently failure-isolated
  // so a slow upstream (option chain when Kite token expired, NSE FII/DII when
  // they shuffle a CSV path, etc.) never takes down the whole report.
  // Every builder gets its own .catch so a single upstream failure (Yahoo
  // rate-limit, NSE CSV path change, Kite session expired, geo-block, ...)
  // can never short-circuit Promise.all and 500 the whole report. Each
  // fallback returns a shape compatible with the destination field so
  // downstream code (narrative, scenarios, sectorHeatmap) keeps working.
  const [
    cuesResult,
    indexPreviews,
    movers,
    eventsResp,
    indexLevels,
    optionSnapshots,
    fiiDii,
  ] = await Promise.all([
    buildOvernightCues().catch(e => { logger.warn({ e }, "preMarket: overnightCues failed"); return { cues: [] as Cue[], score: 0 }; }),
    buildIndexPreviews().catch(e => { logger.warn({ e }, "preMarket: indexPreviews failed"); return [] as Awaited<ReturnType<typeof buildIndexPreviews>>; }),
    buildMovers().catch(e => { logger.warn({ e }, "preMarket: movers failed"); return { topGainers: [], topLosers: [], gapUps: [], gapDowns: [], allRows: [] } as Awaited<ReturnType<typeof buildMovers>>; }),
    getMarketEvents().catch(() => null),
    buildIndexLevels().catch(e => { logger.warn({ e }, "preMarket: indexLevels failed"); return [] as KeyIndexLevels[]; }),
    buildOptionSnapshots().catch(e => { logger.warn({ e }, "preMarket: optionSnapshots failed"); return [] as OptionSnapshot[]; }),
    buildFiiDiiSnapshot().catch(e => { logger.warn({ e }, "preMarket: fiiDii failed"); return null; }),
  ]);
  const { cues, score } = cuesResult;

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

  // Sector heatmap derives from the same scan rows we already pulled for movers.
  const sectorHeatmap = movers.allRows.length > 0 ? buildSectorHeatmap(movers.allRows) : [];

  // Scenarios anchor on the Nifty 50 levels so triggers reference real numbers.
  const niftyLevels = indexLevels.find(l => l.symbol === "^NSEI");
  // Scenario probabilities are calibrated against India VIX (NSE volatility),
  // not US VIX. Pick India VIX explicitly; only fall back to any vix-category
  // cue if India VIX is unavailable, so we never silently feed a US-VIX number
  // into the bull/bear/range probability logic.
  const vixForScenarios = cues.find(c => c.label === "India VIX")
    ?? cues.find(c => c.category === "vix");
  const scenarios = buildScenarios({
    sentimentScore: score,
    giftPct: giftCue?.changePercent ?? null,
    vix: vixForScenarios?.value ?? null,
    niftyLevels,
  });

  const data: PreMarketReportData = {
    mode,
    sentiment,
    sentimentScore: +score.toFixed(2),
    narrative,
    keyTakeaways: takeaways,
    overnightCues: cues,
    indexPreviews,
    scenarios,
    indexLevels,
    optionSnapshots,
    sectorHeatmap,
    fiiDii: fiiDii ?? undefined,
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
