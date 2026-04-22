import { Router, type IRouter } from "express";
import {
  GetGlobalIndicesResponse,
  GetMarketSummaryResponse,
  GetMarketTrendResponse,
  GetNewsResponse,
  GetOptionSignalsResponse,
  GetSectorResponse,
  GetStockDetailResponse,
  GetStockHistoryResponse,
  GetTopScansResponse,
  ListSectorsResponse,
  ListStocksResponse,
} from "@workspace/api-zod";
import { SECTORS, UNIVERSE, getEntry, INDEX_CONSTITUENTS } from "../lib/universe";
import { getStockHistoryWithSeries, scanAll } from "../lib/scanner";
import { fetchIndexChart, fetchFundamentals, fetchStatements } from "../lib/yahoo";
import { getFinancials, getHoldings, getMarketNews, getNewsForSymbol } from "../lib/financials";
import { getMarketEvents } from "../lib/marketEvents";
import { getMarketNewsLive } from "../lib/newsRss";
import { getOptionSignals } from "../lib/optionSignals";
import { getGlobalIndices } from "../lib/globalIndices";
import { getMarketTrend } from "../lib/marketTrend";
import { providerStatus } from "../lib/dataProvider";

const router: IRouter = Router();

const INDEX_SYMBOLS: Array<{ yahoo: string; name: string; display: string; slug?: string }> = [
  { yahoo: "^NSEI", name: "NIFTY 50", display: "NIFTY 50", slug: "NIFTY50" },
  { yahoo: "^NSEBANK", name: "NIFTY BANK", display: "BANK NIFTY", slug: "BANKNIFTY" },
  { yahoo: "^CNXIT", name: "NIFTY IT", display: "NIFTY IT", slug: "NIFTYIT" },
  { yahoo: "^CNXAUTO", name: "NIFTY AUTO", display: "NIFTY AUTO", slug: "NIFTYAUTO" },
  { yahoo: "^CNXPHARMA", name: "NIFTY PHARMA", display: "NIFTY PHARMA", slug: "NIFTYPHARMA" },
  { yahoo: "^CNXFMCG", name: "NIFTY FMCG", display: "NIFTY FMCG", slug: "NIFTYFMCG" },
  { yahoo: "^BSESN", name: "SENSEX", display: "SENSEX" },
  { yahoo: "NIFTY_FIN_SERVICE.NS", name: "FINNIFTY", display: "FINNIFTY" },
];

router.get("/market/summary", async (_req, res, next) => {
  try {
    // Pre-compute per-index breadth from full universe scan once.
    const allRows = await scanAll().catch(() => []);
    const bySymbol = new Map(allRows.map(r => [r.symbol.toUpperCase(), r]));
    const breadthFor = (symbols?: string[]) => {
      if (!symbols || symbols.length === 0) return undefined;
      let a = 0, d = 0, u = 0;
      for (const s of symbols) {
        const r = bySymbol.get(s.toUpperCase());
        if (!r) continue;
        if (r.quote.changePercent > 0.1) a++;
        else if (r.quote.changePercent < -0.1) d++;
        else u++;
      }
      if (a + d + u === 0) return undefined;
      return { advancers: a, decliners: d, unchanged: u, adRatio: d === 0 ? (a > 0 ? null : 0) : +(a / d).toFixed(2) };
    };

    const indices = await Promise.all(INDEX_SYMBOLS.map(async i => {
      const c = await fetchIndexChart(i.yahoo);
      const price = c?.meta.regularMarketPrice ?? 0;
      const closes = c?.close ?? [];
      const opens = c?.open ?? [];
      const highs = c?.high ?? [];
      const lows = c?.low ?? [];
      const lastIdx = closes.length - 1;
      const prev = closes.length >= 2
        ? closes[closes.length - 2]!
        : (c?.meta.chartPreviousClose ?? price);
      const change = price - prev;
      const pct = prev > 0 ? (change / prev) * 100 : 0;
      const open = lastIdx >= 0 ? opens[lastIdx] : undefined;
      const high = c?.meta.regularMarketDayHigh ?? (lastIdx >= 0 ? highs[lastIdx] : undefined);
      const low = c?.meta.regularMarketDayLow ?? (lastIdx >= 0 ? lows[lastIdx] : undefined);
      const slug = i.slug;
      const breadth = slug ? breadthFor(INDEX_CONSTITUENTS[slug]) : undefined;
      return {
        symbol: i.yahoo,
        name: i.display,
        region: "India",
        price: round2(price),
        change: round2(change),
        changePercent: round2(pct),
        open: open != null ? round2(open) : undefined,
        high: high != null ? round2(high) : undefined,
        low: low != null ? round2(low) : undefined,
        previousClose: round2(prev),
        trend: change > 0 ? "bullish" as const : change < 0 ? "bearish" as const : "neutral" as const,
        breadth,
        constituentSlug: slug,
      };
    }));
    let advancers = 0, decliners = 0, unchanged = 0;
    for (const r of allRows) {
      if (r.quote.changePercent > 0.1) advancers++;
      else if (r.quote.changePercent < -0.1) decliners++;
      else unchanged++;
    }

    const now = new Date();
    const istHour = (now.getUTCHours() + 5) % 24;
    const istMin = now.getUTCMinutes() + 30;
    const totalMin = istHour * 60 + istMin;
    const day = (now.getUTCDay() + (istHour < 18 ? 0 : 1)) % 7;
    let marketStatus: "open" | "closed" | "pre_open" = "closed";
    if (day >= 1 && day <= 5) {
      if (totalMin >= 9 * 60 + 15 && totalMin <= 15 * 60 + 30) marketStatus = "open";
      else if (totalMin >= 9 * 60 && totalMin < 9 * 60 + 15) marketStatus = "pre_open";
    }

    const data = GetMarketSummaryResponse.parse({
      indices,
      advancers,
      decliners,
      unchanged,
      marketStatus,
      lastUpdated: new Date(),
    });
    res.json(data);
  } catch (err) { next(err); }
});

router.get("/market/global", async (_req, res, next) => {
  try {
    const indices = await getGlobalIndices();
    const data = GetGlobalIndicesResponse.parse({
      indices,
      lastUpdated: new Date(),
    });
    res.json(data);
  } catch (err) { next(err); }
});

router.get("/market/trend", async (_req, res, next) => {
  try {
    const trend = await getMarketTrend();
    const data = GetMarketTrendResponse.parse(trend);
    res.json(data);
  } catch (err) { next(err); }
});

router.get("/options/signals", async (_req, res, next) => {
  try {
    const signals = await getOptionSignals();
    const data = GetOptionSignalsResponse.parse({
      signals,
      generatedAt: new Date(),
    });
    res.json(data);
  } catch (err) { next(err); }
});

router.get("/sectors", async (_req, res, next) => {
  try {
    const rows = await scanAll();
    const grouped = new Map<string, typeof rows>();
    for (const sec of SECTORS) grouped.set(sec, []);
    for (const r of rows) grouped.get(r.sector)?.push(r);
    const out = SECTORS.map(sec => {
      const list = grouped.get(sec) ?? [];
      const avgScore = list.length
        ? Math.round(list.reduce((a, b) => a + b.recommendation.score, 0) / list.length)
        : 0;
      const avgChange = list.length
        ? round2(list.reduce((a, b) => a + b.quote.changePercent, 0) / list.length)
        : 0;
      const gainers = list.filter(r => r.quote.changePercent > 0).length;
      const losers = list.filter(r => r.quote.changePercent < 0).length;
      const topPick = list.slice().sort((a, b) => b.recommendation.score - a.recommendation.score)[0]
        ?? list[0];
      return {
        sector: sec,
        stockCount: list.length,
        avgScore,
        avgChangePercent: avgChange,
        gainers,
        losers,
        topPick,
      };
    }).filter(s => s.topPick != null);
    const data = ListSectorsResponse.parse(out);
    res.json(data);
  } catch (err) { next(err); }
});

router.get("/sectors/:sector", async (req, res, next) => {
  try {
    const sectorParam = String(req.params["sector"] ?? "");
    const rows = await scanAll();
    const list = rows.filter(r => r.sector.toLowerCase() === sectorParam.toLowerCase());
    if (list.length === 0) {
      res.status(404).json({ error: "Sector not found" });
      return;
    }
    const avgScore = Math.round(list.reduce((a, b) => a + b.recommendation.score, 0) / list.length);
    const avgChange = round2(list.reduce((a, b) => a + b.quote.changePercent, 0) / list.length);
    const gainers = list.filter(r => r.quote.changePercent > 0).length;
    const losers = list.filter(r => r.quote.changePercent < 0).length;
    const topPick = list.slice().sort((a, b) => b.recommendation.score - a.recommendation.score)[0]!;
    const summary = {
      sector: list[0]!.sector,
      stockCount: list.length,
      avgScore,
      avgChangePercent: avgChange,
      gainers,
      losers,
      topPick,
    };
    const data = GetSectorResponse.parse({
      sector: list[0]!.sector,
      summary,
      stocks: list.sort((a, b) => b.recommendation.score - a.recommendation.score),
    });
    res.json(data);
  } catch (err) { next(err); }
});

router.get("/stocks", async (req, res, next) => {
  try {
    const rows = await scanAll();
    const sector = req.query["sector"] ? String(req.query["sector"]).toLowerCase() : null;
    const signal = req.query["signal"] ? String(req.query["signal"]).toUpperCase() : null;
    const search = req.query["search"] ? String(req.query["search"]).toLowerCase() : null;
    let filtered = rows;
    if (sector) filtered = filtered.filter(r => r.sector.toLowerCase() === sector);
    if (signal) filtered = filtered.filter(r => r.recommendation.signal === signal);
    if (search) filtered = filtered.filter(r =>
      r.symbol.toLowerCase().includes(search) || r.name.toLowerCase().includes(search),
    );
    filtered = filtered.slice().sort((a, b) => b.recommendation.score - a.recommendation.score);
    const data = ListStocksResponse.parse(filtered);
    res.json(data);
  } catch (err) { next(err); }
});

router.get("/stocks/:symbol", async (req, res, next) => {
  try {
    const symbol = String(req.params["symbol"] ?? "").toUpperCase();
    const entry = getEntry(symbol);
    if (!entry) { res.status(404).json({ error: "Symbol not found" }); return; }
    const rows = await scanAll();
    const row = rows.find(r => r.symbol === symbol);
    if (!row) { res.status(404).json({ error: "No data available for symbol" }); return; }

    // Fundamentals (cached per symbol for 1h)
    const keyStats = await fetchFundamentals(symbol).catch(() => null);

    // Peers — same sector, top 6 by score, excluding self
    const peerCandidates = rows
      .filter(r => r.sector === entry.sector && r.symbol !== entry.symbol)
      .slice()
      .sort((a, b) => b.recommendation.score - a.recommendation.score)
      .slice(0, 6)
      .map(p => ({ symbol: p.symbol, name: p.name, changePercent: p.quote.changePercent, price: p.quote.price }));

    const data = GetStockDetailResponse.parse({
      profile: {
        symbol: entry.symbol,
        name: entry.name,
        sector: entry.sector,
        industry: entry.industry,
        description: entry.description,
        seasonality: entry.seasonality,
        catalysts: entry.catalysts ?? [],
        keyStats: keyStats ?? undefined,
        peers: peerCandidates,
      },
      quote: row.quote,
      indicators: row.indicators,
      recommendation: row.recommendation,
      financials: getFinancials(symbol),
      holdings: getHoldings(symbol),
      news: getNewsForSymbol(symbol, 6),
    });
    res.json(data);
  } catch (err) { next(err); }
});

// New: index detail endpoint (constituents + aggregated breadth + top movers)
router.get("/index/:slug", async (req, res, next) => {
  try {
    const slug = String(req.params["slug"] ?? "").toUpperCase();
    const cfg = INDEX_SYMBOLS.find(i => i.slug === slug);
    const symbols = INDEX_CONSTITUENTS[slug];
    if (!cfg || !symbols) { res.status(404).json({ error: "Index not found" }); return; }
    const rows = await scanAll();
    const set = new Set(symbols.map(s => s.toUpperCase()));
    const constituents = rows.filter(r => set.has(r.symbol.toUpperCase()));
    const a = constituents.filter(r => r.quote.changePercent > 0.1).length;
    const d = constituents.filter(r => r.quote.changePercent < -0.1).length;
    const u = constituents.length - a - d;
    const c = await fetchIndexChart(cfg.yahoo);
    const price = c?.meta.regularMarketPrice ?? 0;
    const prev = c?.meta.chartPreviousClose ?? price;
    const change = price - prev;
    const pct = prev > 0 ? (change / prev) * 100 : 0;
    res.json({
      slug,
      name: cfg.display,
      yahoo: cfg.yahoo,
      price: round2(price),
      change: round2(change),
      changePercent: round2(pct),
      open: c?.open?.[c.open.length - 1] != null ? round2(c.open[c.open.length - 1]!) : undefined,
      high: c?.meta.regularMarketDayHigh != null ? round2(c.meta.regularMarketDayHigh) : undefined,
      low: c?.meta.regularMarketDayLow != null ? round2(c.meta.regularMarketDayLow) : undefined,
      previousClose: round2(prev),
      breadth: { advancers: a, decliners: d, unchanged: u, adRatio: d === 0 ? (a > 0 ? null : 0) : +(a / d).toFixed(2) },
      constituents: constituents.slice().sort((x, y) => y.quote.changePercent - x.quote.changePercent),
    });
  } catch (err) { next(err); }
});

router.get("/provider/status", (_req, res) => {
  res.json(providerStatus());
});

router.get("/stocks/:symbol/statements", async (req, res, next) => {
  try {
    const symbol = String(req.params["symbol"] ?? "").toUpperCase();
    const stmts = await fetchStatements(symbol).catch(() => null);
    res.json(stmts ?? {
      annualPL: [], quarterlyPL: [], balanceSheet: [], cashFlow: [], ratios: [],
      shareholding: { topInstitutions: [], topInsiders: [] },
    });
  } catch (err) { next(err); }
});

router.get("/stocks/:symbol/history", async (req, res, next) => {
  try {
    const symbol = String(req.params["symbol"] ?? "").toUpperCase();
    const rangeRaw = String(req.query["range"] ?? "6mo");
    const range = (["1mo", "3mo", "6mo", "1y", "2y"].includes(rangeRaw) ? rangeRaw : "6mo") as
      "1mo" | "3mo" | "6mo" | "1y" | "2y";
    const hist = await getStockHistoryWithSeries(symbol, range);
    if (!hist) { res.status(404).json({ error: "No history available" }); return; }
    const data = GetStockHistoryResponse.parse(hist);
    res.json(data);
  } catch (err) { next(err); }
});

router.get("/scan/top", async (_req, res, next) => {
  try {
    const rows = await scanAll();
    const sorted = rows.slice().sort((a, b) => b.recommendation.score - a.recommendation.score);
    const topBuys = sorted.filter(r => r.recommendation.score > 0).slice(0, 10);
    const topSells = sorted.slice().reverse().filter(r => r.recommendation.score < 0).slice(0, 10);
    const data = GetTopScansResponse.parse({
      topBuys,
      topSells,
      generatedAt: new Date(),
    });
    res.json(data);
  } catch (err) { next(err); }
});

router.get("/news", async (req, res, next) => {
  try {
    const symbol = req.query["symbol"] ? String(req.query["symbol"]).toUpperCase() : null;
    let items;
    if (symbol) {
      items = getNewsForSymbol(symbol, 8);
    } else {
      const live = await getMarketNewsLive(40);
      items = live.length > 0 ? live : getMarketNews(15);
    }
    const data = GetNewsResponse.parse(items);
    res.json(data);
  } catch (err) { next(err); }
});

router.get("/market/events", async (_req, res, next) => {
  try {
    const data = await getMarketEvents();
    res.json(data);
  } catch (err) { next(err); }
});

function round2(n: number): number { return Math.round(n * 100) / 100; }

void scanAll().catch(() => undefined);
setInterval(() => { void scanAll().catch(() => undefined); }, 60 * 1000);

export default router;

void UNIVERSE;
