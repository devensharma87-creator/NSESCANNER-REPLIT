/**
 * `/api/global/*` router — entirely independent from the NSE scanner.
 *
 * Mount order in `app.ts`:
 *   1. cookieParser, body parsers, CORS, helmet, rate limiter (shared).
 *   2. **This router**, before the legacy `requireAuth` middleware so
 *      that NSE auth never sees any /api/global/* request.
 *   3. Legacy /api/auth router + requireAuth for the NSE namespace.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  globalInstrumentsTable,
  globalWatchlistTable,
  globalScreenerPresetsTable,
} from "@workspace/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { logger } from "../../lib/logger";
import {
  requireGlobalAuth,
  isGloballyAuthenticated,
  isGlobalPasswordConfigured,
  verifyGlobalPassword,
  setGlobalSessionCookie,
  clearGlobalSessionCookie,
  sessionKeyFromCookie,
  getGlobalCookieValue,
} from "../../lib/global/auth";
import {
  CRYPTO,
  COMMODITIES,
  FOREX,
  EQUITIES,
  INDICES,
  UNIVERSE,
  findInstrument,
  type GlobalAssetClass,
  type GlobalTimeframe,
} from "../../lib/global/universe";
import {
  getCandlesFresh,
  getLivePrices,
  getSyncStatuses,
  buildDashboardRows,
} from "../../lib/global/dataLayer";
import {
  sma, ema, rsi, macd, bollinger, atr, vwap, supertrend,
  highestHigh, lowestLow, lastNonNull, type OHLCV,
} from "../../lib/global/indicators";

const router: IRouter = Router();

// ── Auth routes (public) ─────────────────────────────────────────────
router.get("/global/auth/status", (req, res) => {
  res.json({
    authenticated: isGloballyAuthenticated(req),
    passwordConfigured: isGlobalPasswordConfigured(),
  });
});

const LoginBody = z.object({ password: z.string().min(1) });
router.post("/global/auth/login", (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "password required" });
    return;
  }
  if (!isGlobalPasswordConfigured()) {
    logger.error("Global login attempted but GLOBAL_APP_ACCESS_PASSWORD is not configured");
    res.status(503).json({ error: "auth not configured on server", code: "GLOBAL_PASSWORD_NOT_SET" });
    return;
  }
  if (!verifyGlobalPassword(parsed.data.password)) {
    logger.warn({ ip: req.ip }, "Global login rejected (bad password)");
    res.status(401).json({ error: "invalid password" });
    return;
  }
  setGlobalSessionCookie(res);
  res.json({ ok: true });
});

router.post("/global/auth/logout", (_req, res) => {
  clearGlobalSessionCookie(res);
  res.json({ ok: true });
});

// ── Everything below requires the global gate ────────────────────────
router.use("/global", requireGlobalAuth);

// ── Universe ─────────────────────────────────────────────────────────
const InstrumentsQuery = z.object({
  assetClass: z.enum(["crypto", "commodity", "forex", "equity", "index"]).optional(),
});

router.get("/global/instruments", async (req, res) => {
  const parsed = InstrumentsQuery.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "invalid assetClass" }); return; }
  const rows = await db.select().from(globalInstrumentsTable);
  // Prefer the in-code universe order so the UI lists them deterministically.
  const order = new Map(UNIVERSE.map((u, i) => [u.symbol, i] as const));
  rows.sort((a, b) => (order.get(a.symbol) ?? 9999) - (order.get(b.symbol) ?? 9999));
  const filtered = parsed.data.assetClass
    ? rows.filter(r => r.assetClass === parsed.data.assetClass)
    : rows;
  // Spec is `type: array` — return an array, not a wrapper object.
  res.json(filtered.map(r => ({
    symbol: r.symbol,
    displayName: r.displayName,
    assetClass: r.assetClass,
    source: r.source,
    sourceSymbol: r.sourceSymbol,
    currency: r.currency ?? null,
    notes: r.notes ?? null,
    supportedTimeframes: findInstrument(r.symbol)?.supportedTimeframes ?? [],
  })));
});

// ── Dashboard ────────────────────────────────────────────────────────
const DashboardQuery = z.object({
  asset: z.enum(["crypto", "commodities", "forex", "equities", "indices", "watchlist"]),
});

type DashboardClassTab = "crypto" | "commodities" | "forex" | "equities" | "indices";

function classToList(cls: DashboardClassTab): GlobalAssetClass {
  switch (cls) {
    case "commodities": return "commodity";
    case "forex":       return "forex";
    case "equities":    return "equity";
    case "indices":     return "index";
    case "crypto":      return "crypto";
  }
}

router.get("/global/dashboard", async (req, res) => {
  const parsed = DashboardQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid asset" });
    return;
  }
  let symbols: string[];
  if (parsed.data.asset === "watchlist") {
    const cookie = getGlobalCookieValue(req);
    if (!cookie) { res.json({ rows: [] }); return; }
    const sk = sessionKeyFromCookie(cookie);
    const wl = await db.select({ symbol: globalWatchlistTable.symbol })
      .from(globalWatchlistTable).where(eq(globalWatchlistTable.sessionKey, sk));
    symbols = wl.map(w => w.symbol);
  } else {
    const cls = classToList(parsed.data.asset);
    symbols = UNIVERSE.filter(u => u.assetClass === cls).map(u => u.symbol);
  }
  // buildDashboardRows joins live prices with sync_logs health to compute
  // per-row `stale` against per-source freshness budgets — see dataLayer.ts.
  const rows = await buildDashboardRows(symbols);
  res.json({ rows });
});

// ── Instrument detail ───────────────────────────────────────────────
router.get("/global/instruments/:symbol", async (req, res) => {
  const symbol = String(req.params["symbol"] ?? "").toUpperCase();
  const inst = findInstrument(symbol);
  if (!inst) { res.status(404).json({ error: "unknown symbol" }); return; }
  const live = (await getLivePrices([symbol])).get(symbol);
  res.json({
    instrument: {
      symbol: inst.symbol,
      displayName: inst.displayName,
      assetClass: inst.assetClass,
      source: inst.source,
      sourceSymbol: inst.sourceSymbol,
      currency: inst.currency ?? null,
      notes: inst.notes ?? null,
      supportedTimeframes: inst.supportedTimeframes,
    },
    quote: live ? {
      price: live.price,
      prevClose: live.prevClose,
      changeAbs: live.changeAbs,
      changePct: live.changePct,
      dayHigh: live.dayHigh,
      dayLow: live.dayLow,
      volume: live.volume,
      updatedAt: live.updatedAt.toISOString(),
      lastError: live.lastError ?? null,
    } : null,
  });
});

// ── Candles ─────────────────────────────────────────────────────────
const CandlesQuery = z.object({
  timeframe: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]),
  limit: z.coerce.number().int().min(10).max(1000).optional(),
});

router.get("/global/instruments/:symbol/candles", async (req, res) => {
  const symbol = String(req.params["symbol"] ?? "").toUpperCase();
  const inst = findInstrument(symbol);
  if (!inst) { res.status(404).json({ error: "unknown symbol" }); return; }
  const parsed = CandlesQuery.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "invalid query" }); return; }
  const { timeframe, limit } = parsed.data;
  if (!inst.supportedTimeframes.includes(timeframe)) {
    res.status(400).json({ error: `timeframe ${timeframe} not supported for ${symbol}` });
    return;
  }
  try {
    const candles = await getCandlesFresh(symbol, timeframe, limit ?? 240);
    res.json({
      symbol, timeframe, source: inst.source,
      candles: candles.map(c => ({
        t: c.t, open: c.open, high: c.high, low: c.low, close: c.close,
        volume: c.volume,
      })),
    });
  } catch (err) {
    logger.warn({ err: (err as Error).message, symbol, timeframe }, "Candle fetch failed");
    res.status(502).json({ error: "upstream candle fetch failed", detail: (err as Error).message });
  }
});

// ── Indicators ──────────────────────────────────────────────────────
const IndicatorsQuery = z.object({
  timeframe: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]),
  list: z.string().optional(),
  limit: z.coerce.number().int().min(20).max(1000).optional(),
});

const KNOWN_INDICATORS = ["sma20","sma50","sma200","ema20","ema50","rsi14","macd","bb20","atr14","vwap","supertrend"] as const;
type KnownIndicator = typeof KNOWN_INDICATORS[number];

function asOhlcv(candles: Array<{ t: number; open: number; high: number; low: number; close: number; volume: number | null }>): OHLCV[] {
  return candles.map(c => ({ t: c.t, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
}

router.get("/global/instruments/:symbol/indicators", async (req, res) => {
  const symbol = String(req.params["symbol"] ?? "").toUpperCase();
  const inst = findInstrument(symbol);
  if (!inst) { res.status(404).json({ error: "unknown symbol" }); return; }
  const parsed = IndicatorsQuery.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "invalid query" }); return; }
  const { timeframe, limit } = parsed.data;
  const requested = (parsed.data.list ?? KNOWN_INDICATORS.join(","))
    .split(",").map(s => s.trim()).filter(s => (KNOWN_INDICATORS as readonly string[]).includes(s)) as KnownIndicator[];
  if (!inst.supportedTimeframes.includes(timeframe)) {
    res.status(400).json({ error: `timeframe ${timeframe} not supported for ${symbol}` }); return;
  }
  try {
    const candles = await getCandlesFresh(symbol, timeframe, limit ?? 300);
    const ohlcv = asOhlcv(candles);
    const closes = ohlcv.map(c => c.close);
    const ts = ohlcv.map(c => c.t);
    const series: Record<string, Array<{ t: number; v: number | null }>> = {};
    const pack = (key: string, vals: Array<number | null>) => {
      series[key] = ts.map((t, i) => ({ t, v: vals[i] ?? null }));
    };
    for (const id of requested) {
      switch (id) {
        case "sma20":  pack("sma20",  sma(closes, 20)); break;
        case "sma50":  pack("sma50",  sma(closes, 50)); break;
        case "sma200": pack("sma200", sma(closes, 200)); break;
        case "ema20":  pack("ema20",  ema(closes, 20)); break;
        case "ema50":  pack("ema50",  ema(closes, 50)); break;
        case "rsi14":  pack("rsi14",  rsi(closes, 14)); break;
        case "atr14":  pack("atr14",  atr(ohlcv, 14)); break;
        case "vwap":   pack("vwap",   vwap(ohlcv)); break;
        case "macd": {
          const m = macd(closes);
          pack("macd",       m.macd);
          pack("macdSignal", m.signal);
          pack("macdHist",   m.hist);
          break;
        }
        case "bb20": {
          const b = bollinger(closes, 20, 2);
          pack("bbUpper",  b.upper);
          pack("bbMiddle", b.middle);
          pack("bbLower",  b.lower);
          break;
        }
        case "supertrend": {
          const s = supertrend(ohlcv, 10, 3);
          pack("supertrend", s.values);
          series["supertrendDir"] = ts.map((t, i) => ({ t, v: s.direction[i] ?? null }));
          break;
        }
      }
    }
    res.json({ symbol, timeframe, indicators: series });
  } catch (err) {
    logger.warn({ err: (err as Error).message, symbol, timeframe }, "Indicators fetch failed");
    res.status(502).json({ error: "upstream candle fetch failed", detail: (err as Error).message });
  }
});

// ── Screener ────────────────────────────────────────────────────────
const ScreenerBody = z.object({
  assetClasses: z.array(z.enum(["crypto", "commodity", "forex", "equity", "index"])).min(1),
  timeframe: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]).default("1h"),
  filters: z.object({
    minChangePct: z.number().optional(),
    maxChangePct: z.number().optional(),
    minVolume: z.number().optional(),
    minRsi14: z.number().min(0).max(100).optional(),
    maxRsi14: z.number().min(0).max(100).optional(),
    breakoutLookback: z.number().int().min(2).max(500).optional(),  // close > highestHigh(N)
    breakdownLookback: z.number().int().min(2).max(500).optional(), // close < lowestLow(N)
    // Windowed % change filters — bar count derived from the chosen timeframe
    // (see barsForWindow). Useful for "give me crypto up >5% on the day" or
    // "FX pairs down >2% on the week" without restricting timeframe choice.
    min1dChangePct: z.number().optional(),
    min1wChangePct: z.number().optional(),
    // Price vs SMA50 / SMA200 — classic intermediate / long-term trend filters
    // (separate from the EMA20/50/200 cascade below).
    priceAboveSma50: z.boolean().optional(),
    priceBelowSma50: z.boolean().optional(),
    priceAboveSma200: z.boolean().optional(),
    priceBelowSma200: z.boolean().optional(),
    trendUp: z.boolean().optional(),                                 // EMA20>EMA50>EMA200
    trendDown: z.boolean().optional(),                               // EMA20<EMA50<EMA200
    requireSupertrendUp: z.boolean().optional(),
    requireSupertrendDown: z.boolean().optional(),
  }).default({}),
  limit: z.number().int().min(1).max(50).optional(),
});

/**
 * How many bars in `tf` represent a 1d / 1w lookback window. We assume
 * 24×7 markets (true for crypto; close enough for FX/commodity continuous
 * futures). Returns null if the requested window cannot be resolved in
 * the chosen timeframe (e.g. 1w on a 1m timeframe needs 10080 bars and
 * we only fetch up to 500 — the filter naturally rejects everything).
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

router.post("/global/screen", async (req, res) => {
  const parsed = ScreenerBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body", detail: parsed.error.flatten() });
    return;
  }
  const body = parsed.data;
  const candidates = UNIVERSE.filter(u => body.assetClasses.includes(u.assetClass))
    .filter(u => u.supportedTimeframes.includes(body.timeframe));

  const live = await getLivePrices(candidates.map(c => c.symbol));
  const limit = body.limit ?? 25;
  const f = body.filters;

  // Up-front prefilter using live prices (avoids fetching candles for every
  // single instrument on every screen request).
  const prefiltered = candidates.filter(c => {
    const p = live.get(c.symbol);
    if (!p || p.price == null) return false;
    if (f.minChangePct != null && (p.changePct == null || p.changePct < f.minChangePct)) return false;
    if (f.maxChangePct != null && (p.changePct == null || p.changePct > f.maxChangePct)) return false;
    if (f.minVolume != null && (p.volume == null || p.volume < f.minVolume)) return false;
    return true;
  });

  // Indicators only required if at least one indicator-driven filter is set.
  const needsCandles =
    f.minRsi14 != null || f.maxRsi14 != null ||
    f.breakoutLookback != null || f.breakdownLookback != null ||
    f.trendUp || f.trendDown ||
    f.requireSupertrendUp || f.requireSupertrendDown ||
    f.min1dChangePct != null || f.min1wChangePct != null ||
    f.priceAboveSma50 || f.priceBelowSma50 ||
    f.priceAboveSma200 || f.priceBelowSma200;

  const hits: Array<{
    symbol: string;
    displayName: string;
    assetClass: string;
    price: number | null;
    changePct: number | null;
    volume: number | null;
    rsi14: number | null;
    trend: "up" | "down" | "mixed" | null;
    matched: string[];
  }> = [];

  // Cap how many we evaluate for indicators on a single request to keep p95
  // bounded; the prefilter usually does most of the trimming already.
  const EVAL_BUDGET = 60;

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
        // 1d / 1w window % change — bar count derived from selected timeframe
        // (see barsForWindow). Filter is one-sided (>= threshold) so callers
        // pass a negative number to screen for sell-offs (e.g. -5 for "down ≥5%").
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
        // Price vs SMA50 / SMA200 — require sufficient history; otherwise reject
        // rather than silently passing an instrument that has no SMA200 yet.
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

  // Rank by absolute % change so the strongest movers float to the top.
  hits.sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0));
  res.json({ hits, evaluatedCandidates: prefiltered.length, indicatorEvaluated: needsCandles });
});

// ── Watchlist ───────────────────────────────────────────────────────
function requireSessionKey(req: Request, res: Response): string | null {
  const cookie = getGlobalCookieValue(req);
  if (!cookie) {
    res.status(401).json({ error: "unauthorized" });
    return null;
  }
  return sessionKeyFromCookie(cookie);
}

router.get("/global/watchlist", async (req, res) => {
  const sk = requireSessionKey(req, res); if (sk == null) return;
  const rows = await db.select().from(globalWatchlistTable).where(eq(globalWatchlistTable.sessionKey, sk));
  res.json({
    items: rows.map(r => ({
      symbol: r.symbol,
      displayName: findInstrument(r.symbol)?.displayName ?? r.symbol,
      addedAt: r.addedAt.toISOString(),
    })),
  });
});

const AddBody = z.object({ symbol: z.string().min(1) });
router.post("/global/watchlist", async (req, res) => {
  const sk = requireSessionKey(req, res); if (sk == null) return;
  const parsed = AddBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "symbol required" }); return; }
  const symbol = parsed.data.symbol.toUpperCase();
  if (!findInstrument(symbol)) { res.status(404).json({ error: "unknown symbol" }); return; }
  await db.insert(globalWatchlistTable).values({ sessionKey: sk, symbol })
    .onConflictDoNothing();
  res.json({ ok: true });
});

router.delete("/global/watchlist/:symbol", async (req, res) => {
  const sk = requireSessionKey(req, res); if (sk == null) return;
  const symbol = String(req.params["symbol"] ?? "").toUpperCase();
  await db.delete(globalWatchlistTable).where(
    and(eq(globalWatchlistTable.sessionKey, sk), eq(globalWatchlistTable.symbol, symbol)),
  );
  res.json({ ok: true });
});

// ── Screener presets ────────────────────────────────────────────────
// Persist named filter combinations per session so the user can re-run
// "Crypto oversold 1h" / "FX trend-up 4h" with one click. The stored
// `body` is exactly the payload accepted by POST /global/screen, so the
// frontend can hydrate UI state from a preset and POST it back unchanged.

const PresetCreateBody = z.object({
  name: z.string().trim().min(1).max(80),
  body: ScreenerBody,
});

const PresetUpdateBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  body: ScreenerBody.optional(),
}).refine((v) => v.name !== undefined || v.body !== undefined, {
  message: "must include `name` and/or `body`",
});

// uuid path param — keep validation strict so a stray watchlist symbol
// can never reach this handler by accident.
const UuidParam = z.string().uuid();

/**
 * Detect a Postgres unique-constraint violation regardless of whether the
 * error bubbles up as a raw `pg` error (with `.code === "23505"`) or wrapped
 * inside a drizzle `Failed query: …` error whose `.cause` carries the code.
 */
function isUniqueViolation(err: unknown): boolean {
  const candidates: unknown[] = [err];
  if (err && typeof err === "object" && "cause" in err) {
    candidates.push((err as { cause?: unknown }).cause);
  }
  for (const c of candidates) {
    if (c && typeof c === "object" && "code" in c) {
      const code = (c as { code?: unknown }).code;
      if (code === "23505") return true;
    }
  }
  return /unique|duplicate/i.test((err as Error)?.message ?? "");
}

function serializePreset(row: typeof globalScreenerPresetsTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    body: row.body as z.infer<typeof ScreenerBody>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get("/global/screener-presets", async (req, res) => {
  const sk = requireSessionKey(req, res); if (sk == null) return;
  const rows = await db.select().from(globalScreenerPresetsTable)
    .where(eq(globalScreenerPresetsTable.sessionKey, sk))
    .orderBy(asc(globalScreenerPresetsTable.name));
  res.json({ items: rows.map(serializePreset) });
});

router.post("/global/screener-presets", async (req, res) => {
  const sk = requireSessionKey(req, res); if (sk == null) return;
  const parsed = PresetCreateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body", detail: parsed.error.flatten() });
    return;
  }
  try {
    const [row] = await db.insert(globalScreenerPresetsTable).values({
      sessionKey: sk,
      name: parsed.data.name,
      body: parsed.data.body,
    }).returning();
    res.status(201).json(serializePreset(row!));
  } catch (err) {
    // Unique (session_key, name) collision — surface a 409 so the UI can
    // prompt the user to pick another name rather than silently overwriting.
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "preset name already exists" });
      return;
    }
    logger.warn({ err: (err as Error).message }, "failed to create screener preset");
    res.status(500).json({ error: "failed to create preset" });
  }
});

router.patch("/global/screener-presets/:id", async (req, res) => {
  const sk = requireSessionKey(req, res); if (sk == null) return;
  const idParsed = UuidParam.safeParse(req.params["id"]);
  if (!idParsed.success) { res.status(400).json({ error: "invalid id" }); return; }
  const parsed = PresetUpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body", detail: parsed.error.flatten() });
    return;
  }
  const updates: Partial<typeof globalScreenerPresetsTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.body !== undefined) updates.body = parsed.data.body;
  try {
    const [row] = await db.update(globalScreenerPresetsTable)
      .set(updates)
      .where(and(
        eq(globalScreenerPresetsTable.id, idParsed.data),
        eq(globalScreenerPresetsTable.sessionKey, sk),
      ))
      .returning();
    if (!row) { res.status(404).json({ error: "preset not found" }); return; }
    res.json(serializePreset(row));
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "preset name already exists" });
      return;
    }
    logger.warn({ err: (err as Error).message }, "failed to update screener preset");
    res.status(500).json({ error: "failed to update preset" });
  }
});

router.delete("/global/screener-presets/:id", async (req, res) => {
  const sk = requireSessionKey(req, res); if (sk == null) return;
  const idParsed = UuidParam.safeParse(req.params["id"]);
  if (!idParsed.success) { res.status(400).json({ error: "invalid id" }); return; }
  const result = await db.delete(globalScreenerPresetsTable).where(and(
    eq(globalScreenerPresetsTable.id, idParsed.data),
    eq(globalScreenerPresetsTable.sessionKey, sk),
  )).returning({ id: globalScreenerPresetsTable.id });
  if (result.length === 0) { res.status(404).json({ error: "preset not found" }); return; }
  res.json({ ok: true });
});

// ── Status (data freshness) ─────────────────────────────────────────
router.get("/global/status", async (_req, res) => {
  const rows = await getSyncStatuses();
  const now = Date.now();
  const sources: Array<"binance" | "yahoo" | "yahoo-fx" | "yahoo-equity" | "yahoo-index"> = [
    "binance", "yahoo", "yahoo-fx", "yahoo-equity", "yahoo-index",
  ];
  const out = sources.map(src => {
    const r = rows.find(x => x.source === src);
    const lastOk = r?.lastOkAt ? r.lastOkAt.getTime() : null;
    const lastErr = r?.lastErrorAt ? r.lastErrorAt.getTime() : null;
    return {
      source: src,
      lastOkAt: r?.lastOkAt?.toISOString() ?? null,
      lastErrorAt: r?.lastErrorAt?.toISOString() ?? null,
      lastError: r?.lastError ?? null,
      ageMs: lastOk == null ? null : now - lastOk,
      healthy: lastOk != null && (lastErr == null || lastOk > lastErr),
      notes: r?.notes ?? null,
    };
  });
  // Counts by asset class so the strip can show "15 / 14 / 15 / 50 / 15".
  const counts: Record<string, number> = {
    crypto:    CRYPTO.length,
    commodity: COMMODITIES.length,
    forex:     FOREX.length,
    equity:    EQUITIES.length,
    index:     INDICES.length,
  };
  res.json({ sources: out, universeCounts: counts });
});

export default router;
