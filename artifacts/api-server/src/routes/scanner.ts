import { Router, type IRouter } from "express";
import {
  GetMarketSummaryResponse,
  GetNewsResponse,
  GetSectorResponse,
  GetStockDetailResponse,
  GetStockHistoryResponse,
  GetTopScansResponse,
  ListSectorsResponse,
  ListStocksResponse,
} from "@workspace/api-zod";
import { SECTORS, UNIVERSE, getEntry } from "../lib/universe";
import { getStockHistoryWithSeries, scanAll } from "../lib/scanner";
import { fetchIndexChart } from "../lib/yahoo";
import { getFinancials, getHoldings, getMarketNews, getNewsForSymbol } from "../lib/financials";

const router: IRouter = Router();

const INDEX_SYMBOLS: Array<{ yahoo: string; name: string; display: string }> = [
  { yahoo: "^NSEI", name: "NIFTY 50", display: "NIFTY 50" },
  { yahoo: "^NSEBANK", name: "NIFTY BANK", display: "BANK NIFTY" },
  { yahoo: "^CNXIT", name: "NIFTY IT", display: "NIFTY IT" },
  { yahoo: "^CNXAUTO", name: "NIFTY AUTO", display: "NIFTY AUTO" },
  { yahoo: "^CNXPHARMA", name: "NIFTY PHARMA", display: "NIFTY PHARMA" },
  { yahoo: "^CNXFMCG", name: "NIFTY FMCG", display: "NIFTY FMCG" },
];

router.get("/market/summary", async (_req, res, next) => {
  try {
    const indices = await Promise.all(INDEX_SYMBOLS.map(async i => {
      const c = await fetchIndexChart(i.yahoo);
      const price = c?.meta.regularMarketPrice ?? 0;
      const closes = c?.close ?? [];
      const prev = closes.length >= 2
        ? closes[closes.length - 2]!
        : (c?.meta.chartPreviousClose ?? price);
      const change = price - prev;
      const pct = prev > 0 ? (change / prev) * 100 : 0;
      return {
        symbol: i.yahoo,
        name: i.display,
        price: round2(price),
        change: round2(change),
        changePercent: round2(pct),
      };
    }));
    let advancers = 0, decliners = 0, unchanged = 0;
    try {
      const rows = await scanAll();
      for (const r of rows) {
        if (r.quote.changePercent > 0.1) advancers++;
        else if (r.quote.changePercent < -0.1) decliners++;
        else unchanged++;
      }
    } catch { /* ignore */ }

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
      lastUpdated: new Date().toISOString(),
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
    const data = GetStockDetailResponse.parse({
      profile: {
        symbol: entry.symbol,
        name: entry.name,
        sector: entry.sector,
        industry: entry.industry,
        description: entry.description,
        seasonality: entry.seasonality,
        catalysts: entry.catalysts ?? [],
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
      generatedAt: new Date().toISOString(),
    });
    res.json(data);
  } catch (err) { next(err); }
});

router.get("/news", (req, res, next) => {
  try {
    const symbol = req.query["symbol"] ? String(req.query["symbol"]).toUpperCase() : null;
    const items = symbol ? getNewsForSymbol(symbol, 8) : getMarketNews(15);
    const data = GetNewsResponse.parse(items);
    res.json(data);
  } catch (err) { next(err); }
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Warm cache on boot so first request is snappy.
void scanAll().catch(() => undefined);
// Refresh cache periodically.
setInterval(() => { void scanAll().catch(() => undefined); }, 60 * 1000);

export default router;

// Also tell UNIVERSE imports they're used somewhere (safety).
void UNIVERSE;
