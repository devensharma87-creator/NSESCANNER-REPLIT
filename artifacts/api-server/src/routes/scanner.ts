import { Router, type IRouter } from "express";
import {
  GetGlobalIndicesResponse,
  GetMarketSummaryResponse,
  GetMarketTrendResponse,
  GetNewsResponse,
  GetOptionSignalHistoryResponse,
  GetOptionSignalReportResponse,
  GetOptionSignalsResponse,
  GetSectorResponse,
  GetStockDetailResponse,
  GetStockHistoryResponse,
  GetTopScansResponse,
  ListSectorsResponse,
  ListStocksResponse,
} from "@workspace/api-zod";
import { requireOwner, requireSubscriberOrOwner } from "../lib/userAuth";
import { SECTORS, UNIVERSE, getEntry, INDEX_CONSTITUENTS } from "../lib/universe";
import { getStockHistoryWithSeries, scanAll, getCachedScanRows, refreshScanInBackground } from "../lib/scanner";
import { getKiteIndexQuotes } from "../lib/kiteIndexQuotes";
import { scanFullNse, getFullNseStatus, startFullNseScannerBackground, getAllScannedRows } from "../lib/fullNseScanner";
import { fetchIndexChart, fetchFundamentals, fetchStatements } from "../lib/yahoo";
import { pivots } from "../lib/indicators";
import { getFinancials, getHoldings, getMarketNews, getNewsForSymbol } from "../lib/financials";
import { getMarketEvents, computeMarketStatus } from "../lib/marketEvents";
import { getPreMarketReport } from "../lib/preMarket";
import { getWatchlist } from "../lib/watchlist";
import { getMarketNewsLive } from "../lib/newsRss";
import { getOptionSignals } from "../lib/optionSignals";
import {
  getTodayHistory as getTodayOptionSignalHistory,
  getHistoryByDate,
  getHistoryByMonth,
  getAvailableSignalDates,
  expireOpenSignalsForToday,
} from "../lib/optionSignalLifecycle";
import { sendExport as sendCsvExport } from "../lib/csvExport";
import { getGlobalIndices } from "../lib/globalIndices";
import { getMarketTrend } from "../lib/marketTrend";
import { providerStatus } from "../lib/dataProvider";

const router: IRouter = Router();

// Active-subscription floor (pending/suspended/expired subscriber blocked)
// is enforced GLOBALLY by `requireAuth` in lib/auth.ts — putting it here
// would also fire for every sibling route mounted on the same parent.

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
    // FAST PATH — never block this endpoint on a fresh Yahoo full-universe
    // scan. The homepage strip needs to render in well under a second even
    // when Yahoo is degraded. Two changes vs the old behaviour:
    //   1. Read whatever rows the background scanner has cached for breadth.
    //      Kick a background refresh if they're stale, but don't await it.
    //   2. Prefer Kite's live spot quote for each Indian index when the
    //      Kite session is active. Only fall back to Yahoo's index chart
    //      for the indices Kite didn't supply (or all of them when no
    //      Kite session exists). This means the strip stays live during
    //      Yahoo regional outages, and even the cold path returns within
    //      a few seconds rather than the full Yahoo scan timeout.
    const { rows: allRows, fetchedAt } = getCachedScanRows();
    const SCAN_FRESH_MS = 60_000;
    if (!fetchedAt || Date.now() - fetchedAt > SCAN_FRESH_MS) {
      refreshScanInBackground();
    }
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

    // Try Kite first for the Indian indices. This call is bounded by the
    // 10s in-module cache and a single Kite getQuote batch — typically
    // returns in under 300ms even on a cold cache.
    const kiteQuotes = await getKiteIndexQuotes().catch(() => null);

    const indices = await Promise.all(INDEX_SYMBOLS.map(async i => {
      const slug = i.slug;
      const breadth = slug ? breadthFor(INDEX_CONSTITUENTS[slug]) : undefined;
      const kq = kiteQuotes?.get(i.yahoo);
      if (kq && kq.price > 0) {
        // Kite path — live spot, OHLC, prev close, computed change/pct.
        return {
          symbol: i.yahoo,
          name: i.display,
          region: "India",
          price: round2(kq.price),
          change: round2(kq.change),
          changePercent: round2(kq.changePercent),
          open: kq.open != null ? round2(kq.open) : undefined,
          high: kq.high != null ? round2(kq.high) : undefined,
          low: kq.low != null ? round2(kq.low) : undefined,
          previousClose: round2(kq.previousClose),
          trend: kq.change > 0 ? "bullish" as const : kq.change < 0 ? "bearish" as const : "neutral" as const,
          breadth,
          constituentSlug: slug,
        };
      }
      // Yahoo fallback — same logic as before. Wrapped so a single index
      // failure doesn't tank the whole strip.
      let c: Awaited<ReturnType<typeof fetchIndexChart>> = null;
      try { c = await fetchIndexChart(i.yahoo); } catch { c = null; }
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
      // Prefer last daily bar OHLC over meta — Yahoo's meta.regularMarketDayHigh/Low is
      // unreliable for some indices (e.g. ^BSESN often returns price for both).
      const barHigh = lastIdx >= 0 ? highs[lastIdx] : undefined;
      const barLow = lastIdx >= 0 ? lows[lastIdx] : undefined;
      const metaHigh = c?.meta.regularMarketDayHigh;
      const metaLow = c?.meta.regularMarketDayLow;
      const metaLooksBroken = metaHigh != null && metaLow != null && metaHigh === metaLow;
      const high = (!metaLooksBroken && metaHigh != null) ? metaHigh : (barHigh ?? metaHigh);
      const low = (!metaLooksBroken && metaLow != null) ? metaLow : (barLow ?? metaLow);
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
    const FLAT = 0.05;
    let advancers = 0, decliners = 0, unchanged = 0;
    for (const r of allRows) {
      if (r.quote.changePercent > FLAT) advancers++;
      else if (r.quote.changePercent < -FLAT) decliners++;
      else unchanged++;
    }

    const marketStatus = computeMarketStatus(new Date());

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

router.get("/options/signals", requireSubscriberOrOwner("FNO"), async (_req, res, next) => {
  try {
    const { signals, diagnostics } = await getOptionSignals();
    const now = new Date();
    const data = GetOptionSignalsResponse.parse({
      signals,
      generatedAt: now,
      lastUpdated: now,
      marketState: computeMarketStatus(now),
      diagnostics,
    });
    res.json(data);
  } catch (err) { next(err); }
});

router.get("/options/signal-history", requireSubscriberOrOwner("FNO"), async (_req, res, next) => {
  try {
    // Best-effort sweep so the scoreboard reflects after-close expirations
    // even if no live request hit /options/signals after 15:30 IST.
    await expireOpenSignalsForToday().catch(() => 0);
    const rows = await getTodayOptionSignalHistory();
    const now = new Date();
    const signalDate =
      rows[0]?.signalDate ??
      new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const data = GetOptionSignalHistoryResponse.parse({
      signalDate,
      generatedAt: now,
      signals: rows,
    });
    res.json(data);
  } catch (err) { next(err); }
});

router.get("/options/signal-report", requireSubscriberOrOwner("FNO"), async (req, res, next) => {
  try {
    const dateParam = req.query.date as string | undefined;
    const monthParam = req.query.month as string | undefined;
    let rows;
    let mode: "daily" | "monthly";
    let label: string;
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      rows = await getHistoryByMonth(monthParam);
      mode = "monthly";
      const [y, m] = monthParam.split("-");
      const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      label = `${monthNames[parseInt(m!, 10) - 1]} ${y}`;
    } else {
      const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
        ? dateParam
        : new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
      rows = await getHistoryByDate(date);
      mode = "daily";
      label = date;
    }
    const data = GetOptionSignalReportResponse.parse({
      mode,
      label,
      generatedAt: new Date(),
      signals: rows,
    });
    res.json(data);
  } catch (err) { next(err); }
});

router.get("/options/signal-report/dates", requireSubscriberOrOwner("FNO"), async (_req, res, next) => {
  try {
    const dates = await getAvailableSignalDates();
    res.json({ dates });
  } catch (err) { next(err); }
});

router.get("/options/signal-report/export", requireSubscriberOrOwner("FNO"), async (req, res, next) => {
  try {
    const dateParam = req.query.date as string | undefined;
    const monthParam = req.query.month as string | undefined;
    let rows;
    let filenameBase: string;
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      rows = await getHistoryByMonth(monthParam);
      filenameBase = `fno-signal-report-${monthParam}`;
    } else {
      const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
        ? dateParam
        : new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
      rows = await getHistoryByDate(date);
      filenameBase = `fno-signal-report-${date}`;
    }
    const flat = rows.map((r) => ({
      Date: r.signalDate,
      Index: r.indexName,
      Setup: r.setupName ?? r.setupKey,
      Direction: r.direction,
      "Option Type": r.optionType,
      Strike: r.strike,
      "Spot Entry": r.entry,
      "Spot SL": r.stopLoss,
      "Spot T1": r.target1,
      "Spot T2": r.target2,
      "Opt Entry": r.optionEntry ?? "",
      "Opt SL": r.optionStopLoss ?? "",
      "Opt T1": r.optionTarget1 ?? "",
      "Opt T2": r.optionTarget2 ?? "",
      Confidence: r.confidence,
      Status: r.status,
      "Generated At": r.generatedAt.toISOString(),
      "Triggered At": r.triggeredAt?.toISOString() ?? "",
      "Exited At": r.exitedAt?.toISOString() ?? "",
      "Exit Reason": r.exitReason ?? "",
      "Exit Price": r.exitPrice ?? "",
      "MFE (pts)": r.maxFavorableExcursionPts,
      "MAE (pts)": r.maxAdverseExcursionPts,
      "Last Spot": r.lastSpot,
    }));
    sendCsvExport(res, filenameBase, "csv", flat);
  } catch (err) { next(err); }
});

router.get("/sectors", requireSubscriberOrOwner("SECTORS"), async (_req, res, next) => {
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

router.get("/sectors/:sector", requireSubscriberOrOwner("SECTORS"), async (req, res, next) => {
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

    const [financials, holdings, news] = await Promise.all([
      getFinancials(symbol),
      getHoldings(symbol),
      getNewsForSymbol(symbol, 6),
    ]);

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
      financials,
      holdings,
      news,
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
    // Previous-session H/L are needed for classical floor pivots (R1/R2/S1/S2).
    // The 5d daily chart's last bar is today (or last trading session if
    // closed), so the prior session's H/L sits at index `len - 2`. Guard
    // strictly: if either is missing or non-finite we omit `pivots` rather
    // than emit a degenerate pivot at today's price.
    const dn = c?.high?.length ?? 0;
    const prevHigh = dn >= 2 ? c!.high[dn - 2] : undefined;
    const prevLow  = dn >= 2 ? c!.low[dn - 2]  : undefined;
    let pivotBlock: { pivot: number; r1: number; r2: number; s1: number; s2: number } | undefined;
    if (
      prevHigh != null && prevLow != null &&
      Number.isFinite(prevHigh) && Number.isFinite(prevLow) &&
      Number.isFinite(prev) && prev > 0
    ) {
      const p = pivots(prevHigh, prevLow, prev);
      pivotBlock = {
        pivot: round2(p.pivot),
        r1: round2(p.r1), r2: round2(p.r2),
        s1: round2(p.s1), s2: round2(p.s2),
      };
    }
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
      previousHigh: prevHigh != null ? round2(prevHigh) : undefined,
      previousLow:  prevLow  != null ? round2(prevLow)  : undefined,
      pivots: pivotBlock,
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
      // Per-symbol: filter the live RSS aggregate by symbol/name keyword. If
      // nothing matches we deliberately return [] (no fabricated headlines).
      items = await getNewsForSymbol(symbol, 8);
    } else {
      // Market: live RSS aggregate. Returns [] if all upstreams fail rather
      // than substituting templated headlines.
      items = await getMarketNewsLive(40);
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

router.get("/market/premarket", async (_req, res, next) => {
  try {
    const data = await getPreMarketReport();
    res.json(data);
  } catch (err) { next(err); }
});

router.get("/watchlist/:key", async (req, res, next) => {
  try {
    const key = String(req.params.key).toUpperCase();
    const allowed = ["SENSEX","BANKNIFTY","NIFTY50","NIFTY100","NIFTYMIDCAP100","NIFTYSMALLCAP100","NIFTY500"] as const;
    if (!(allowed as readonly string[]).includes(key)) {
      res.status(400).json({ error: `Unknown watchlist key. Allowed: ${allowed.join(", ")}` });
      return;
    }
    const data = await getWatchlist(key as typeof allowed[number]);
    res.json(data);
  } catch (err) { next(err); }
});

function round2(n: number): number { return Math.round(n * 100) / 100; }

void scanAll().catch(() => undefined);
setInterval(() => { void scanAll().catch(() => undefined); }, 60 * 1000);

// Full NSE EQ scanner — covers ~2,400+ symbols from the daily NSE bhavcopy
// (live, not synthetic). Refresh cadence is 5 min so we don't crush Yahoo.
startFullNseScannerBackground();

/** GET /api/scan/full-nse — full NSE EQ scan, optional sort/filter/paginate.
 *  Query params: sortBy (changePct|score|volume|rsi|symbol|price), order (asc|desc),
 *                signal (BUY|WEAK_BUY|HOLD|WEAK_SELL|SELL), search (substring),
 *                limit (default 200, max 2500), offset (default 0). */
router.get("/scan/full-nse", async (req, res, next) => {
  try {
    const data = await scanFullNse();
    let rows = data.rows.slice();

    const search = String(req.query["search"] ?? "").trim().toUpperCase();
    if (search) rows = rows.filter(r => r.symbol.includes(search) || (r.name ?? "").toUpperCase().includes(search));

    // Signal filter — must match the actual emitted enum (Signal type from
    // api-zod): STRONG_BUY | BUY | NEUTRAL | SELL | STRONG_SELL.
    const signal = String(req.query["signal"] ?? "").trim().toUpperCase();
    const allowedSigs = new Set(["STRONG_BUY","BUY","NEUTRAL","SELL","STRONG_SELL"]);
    if (signal && allowedSigs.has(signal)) {
      rows = rows.filter(r => r.recommendation.signal === signal);
    }

    const sortBy = String(req.query["sortBy"] ?? "changePct");
    const order = String(req.query["order"] ?? "desc") === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const get = (r: typeof a): number | string => {
        switch (sortBy) {
          case "symbol": return r.symbol;
          case "price": return r.quote.price;
          case "changePct": return r.quote.changePercent;
          case "volume": return r.quote.volume;
          case "rsi": return r.indicators?.rsi14 ?? 0;
          case "score": return r.recommendation.score;
          case "deliveryPct": return r.indicators?.deliveryPct ?? 0;
          default: return r.quote.changePercent;
        }
      };
      const va = get(a); const vb = get(b);
      if (typeof va === "string" && typeof vb === "string") return order * va.localeCompare(vb);
      return order * (((va as number) ?? 0) - ((vb as number) ?? 0));
    });

    const total = rows.length;
    const offset = Math.max(0, parseInt(String(req.query["offset"] ?? "0"), 10) || 0);
    // Default limit raised from 200 → 5000 because the Scanner UI is built
    // around showing the entire universe (sortable, filterable, downloadable).
    // 5000 comfortably covers every NSE EQ name; smaller pagers can still
    // pass an explicit limit. Hard cap stays at 5000.
    const limit = Math.max(1, Math.min(5000, parseInt(String(req.query["limit"] ?? "5000"), 10) || 5000));
    const paged = rows.slice(offset, offset + limit);

    res.json({
      rows: paged,
      total,
      shown: paged.length,
      offset,
      limit,
      lastUpdated: new Date(data.lastUpdated).toISOString(),
      sourceDate: data.sourceDate,
      universeSize: data.total,
      scanMs: data.scanMs,
      failures: data.failures,
      rested: data.rested,
      kiteOffline: !!data.kiteOffline,
      source: "yahoo-intraday + nse-bhavcopy",
    });
  } catch (err) { next(err); }
});

/** GET /api/scan/full-nse/status — lightweight status (no row payload). */
router.get("/scan/full-nse/status", (_req, res) => {
  res.json(getFullNseStatus());
});

/**
 * GET /api/scan/full-nse/export?format=csv|json
 *
 * Streams every currently-cached row as a downloadable file. Triggers a
 * scan first if the cache is cold so the user always gets a non-empty file.
 * No filter parameters — the whole universe is exported deliberately so
 * downloads are deterministic. Re-filter offline if needed.
 */
router.get("/scan/full-nse/export", async (req, res, next) => {
  try {
    let { rows, sourceDate, lastUpdated } = getAllScannedRows();
    if (rows.length === 0) {
      // Cold cache — kick a fetch and re-read.
      const fresh = await scanFullNse();
      rows = fresh.rows;
      sourceDate = fresh.sourceDate;
      lastUpdated = fresh.lastUpdated;
    }
    const format = String(req.query["format"] ?? "csv").toLowerCase();
    // Flatten StockRow → wide spreadsheet row (one row per symbol with the
    // most useful indicator columns broken out side-by-side).
    const flat = rows.map(r => ({
      symbol: r.symbol,
      name: r.name,
      sector: r.sector,
      price: r.quote.price,
      change: r.quote.change,
      changePct: r.quote.changePercent,
      open: r.quote.open,
      high: r.quote.high,
      low: r.quote.low,
      previousClose: r.quote.previousClose,
      volume: r.quote.volume,
      avgVolume: r.quote.avgVolume,
      fiftyTwoWeekHigh: r.quote.fiftyTwoWeekHigh ?? "",
      fiftyTwoWeekLow:  r.quote.fiftyTwoWeekLow ?? "",
      vwap:    r.indicators?.vwap ?? "",
      ema20:   r.indicators?.ema20 ?? "",
      ema50:   r.indicators?.ema50 ?? "",
      ema100:  r.indicators?.ema100 ?? "",
      ema200:  r.indicators?.ema200 ?? "",
      rsi14:   r.indicators?.rsi14 ?? "",
      atr14:   r.indicators?.atr14 ?? "",
      volumeRatio: r.indicators?.volumeRatio ?? "",
      deliveryPct: r.indicators?.deliveryPct ?? "",
      score: r.recommendation.score,
      signal: r.recommendation.signal,
      sourceDate: sourceDate ?? "",
      asOf: lastUpdated ? new Date(lastUpdated).toISOString() : "",
    }));
    sendCsvExport(res, "nse-scan", format, flat);
  } catch (err) { next(err); }
});

export default router;

void UNIVERSE;
