/**
 * `/api/global/*` router — entirely independent from the NSE scanner.
 *
 * Mount order in `app.ts`:
 *   1. cookieParser, body parsers, CORS, helmet, rate limiter (shared).
 *   2. **This router**, before the legacy `requireAuth` middleware so
 *      that NSE auth never sees any /api/global/* request.
 *   3. Legacy /api/auth router + requireAuth for the NSE namespace.
 */

import crypto from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  globalInstrumentsTable,
  globalWatchlistTable,
  globalScreenerPresetsTable,
} from "@workspace/db/schema";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
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
  getDeadCandidates,
  buildDashboardRows,
  DEAD_SYMBOL_STREAK_THRESHOLD,
} from "../../lib/global/dataLayer";
import {
  loadDisabledSet,
  listDisabled,
  setDisabled,
  clearDisabled,
} from "../../lib/global/disabledSymbols";
import {
  sma, ema, rsi, macd, bollinger, atr, vwap, supertrend,
  type OHLCV,
} from "../../lib/global/indicators";
import { runGlobalScreener, ScreenerBody } from "../../lib/global/screener";
import { runPresetNow } from "../../lib/global/presetScheduler";
import { CURATED_PRESETS } from "../../lib/global/curatedPresets";

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
  // Hide operator-muted instruments from the dashboard. They still exist
  // in `universe.ts` and the watchlist, but until they're re-enabled
  // the user shouldn't see (or be misled by) their last-known price.
  const disabled = await loadDisabledSet();
  symbols = symbols.filter(s => !disabled.has(s));
  // buildDashboardRows joins live prices with sync_logs health to compute
  // per-row `stale` against per-source freshness budgets — see dataLayer.ts.
  const rows = await buildDashboardRows(symbols);
  res.json({ rows });
});

// ── Instrument overrides (operator mute) ────────────────────────────
//
// Lets an on-call operator mute a candidate-dead symbol from the
// dashboard popover with one click — no code change to `universe.ts`,
// no redeploy. The override is DB-backed (`global_instrument_overrides`)
// so it survives server restarts; refreshers and the dashboard read
// from `loadDisabledSet()` each cycle / request.
//
// IMPORTANT: defined BEFORE `/global/instruments/:symbol` so the literal
// `disabled` path can't be swallowed by the symbol-detail route.

const DisableBody = z.object({
  note: z.string().trim().max(500).optional(),
});

router.get("/global/instruments/disabled", async (_req, res) => {
  res.json({ items: await listDisabled() });
});

router.post("/global/instruments/:symbol/disabled", async (req, res) => {
  const symbol = String(req.params["symbol"] ?? "").toUpperCase();
  if (!findInstrument(symbol)) { res.status(404).json({ error: "unknown symbol" }); return; }
  const parsed = DisableBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body", detail: parsed.error.flatten() });
    return;
  }
  const row = await setDisabled(symbol, parsed.data.note ?? null);
  logger.info({ symbol, note: parsed.data.note }, "operator muted global instrument");
  res.status(201).json(row);
});

router.delete("/global/instruments/:symbol/disabled", async (req, res) => {
  const symbol = String(req.params["symbol"] ?? "").toUpperCase();
  if (!findInstrument(symbol)) { res.status(404).json({ error: "unknown symbol" }); return; }
  const row = await clearDisabled(symbol);
  if (!row) { res.status(404).json({ error: "symbol was not disabled" }); return; }
  logger.info({ symbol }, "operator re-enabled global instrument");
  res.json(row);
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
// Body schema and evaluator live in `lib/global/screener.ts` so the
// background preset scheduler can run the exact same logic without
// re-implementing it here.

router.post("/global/screen", async (req, res) => {
  const parsed = ScreenerBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body", detail: parsed.error.flatten() });
    return;
  }
  const result = await runGlobalScreener(parsed.data);
  res.json(result);
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

// Auto-run interval is in minutes. Use `null` to disable scheduling for
// a preset (the legacy "manual only" behaviour). Capped at 24h since
// anything longer is meaningless next to the underlying live-price cycle.
const AutoRunIntervalSchema = z.number().int().min(1).max(1440).nullable();

const PresetCreateBody = z.object({
  name: z.string().trim().min(1).max(80),
  body: ScreenerBody,
  autoRunIntervalMin: AutoRunIntervalSchema.optional(),
});

const PresetUpdateBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  body: ScreenerBody.optional(),
  autoRunIntervalMin: AutoRunIntervalSchema.optional(),
}).refine(
  (v) => v.name !== undefined || v.body !== undefined || v.autoRunIntervalMin !== undefined,
  { message: "must include `name`, `body`, and/or `autoRunIntervalMin`" },
);

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

type PresetNewHit = {
  symbol: string;
  displayName: string;
  assetClass: string;
  price: number | null;
  changePct: number | null;
  matched: string[];
};

function serializePreset(row: typeof globalScreenerPresetsTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    body: row.body as z.infer<typeof ScreenerBody>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    autoRunIntervalMin: row.autoRunIntervalMin,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    lastRunError: row.lastRunError ?? null,
    lastNewHits: (row.lastNewHits as PresetNewHit[] | null) ?? [],
    lastNewHitsAt: row.lastNewHitsAt?.toISOString() ?? null,
    shareToken: row.shareToken ?? null,
  };
}

router.get("/global/screener-presets", async (req, res) => {
  const sk = requireSessionKey(req, res); if (sk == null) return;
  const rows = await db.select().from(globalScreenerPresetsTable)
    .where(eq(globalScreenerPresetsTable.sessionKey, sk))
    .orderBy(asc(globalScreenerPresetsTable.name));
  res.json({ items: rows.map(serializePreset) });
});

/**
 * Curated, read-only starter library. Source of truth lives in
 * `lib/global/curatedPresets.ts`. The UI Fork action POSTs the body back
 * to /global/screener-presets to create a personal copy.
 */
router.get("/global/screener-presets/library", (_req, res) => {
  res.json({ items: CURATED_PRESETS });
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
      autoRunIntervalMin: parsed.data.autoRunIntervalMin ?? null,
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
  if (parsed.data.body !== undefined) {
    updates.body = parsed.data.body;
    // The filter body changed — reset dedup state so the next scheduled
    // run treats every hit as new (otherwise old "lastHitSymbols" from a
    // different filter set would silently mask hits the user is now
    // looking for).
    updates.lastHitSymbols = [];
    updates.lastNewHits = [];
    updates.lastNewHitsAt = null;
  }
  if (parsed.data.autoRunIntervalMin !== undefined) {
    updates.autoRunIntervalMin = parsed.data.autoRunIntervalMin;
  }
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

/**
 * Clear pending alert hits once the user has seen them in the UI. The
 * dedup baseline (`lastHitSymbols`) is intentionally NOT touched here,
 * so a symbol that is still matching the filter does NOT re-alert on
 * the next cycle until it actually drops out and reappears.
 */
router.post("/global/screener-presets/:id/acknowledge", async (req, res) => {
  const sk = requireSessionKey(req, res); if (sk == null) return;
  const idParsed = UuidParam.safeParse(req.params["id"]);
  if (!idParsed.success) { res.status(400).json({ error: "invalid id" }); return; }
  const [row] = await db.update(globalScreenerPresetsTable)
    .set({ lastNewHits: [], lastNewHitsAt: null })
    .where(and(
      eq(globalScreenerPresetsTable.id, idParsed.data),
      eq(globalScreenerPresetsTable.sessionKey, sk),
    ))
    .returning();
  if (!row) { res.status(404).json({ error: "preset not found" }); return; }
  res.json(serializePreset(row));
});

/**
 * Manually trigger a scheduler-style run for the preset (without waiting
 * for the next 30s tick). Useful for "test alert" / "force refresh now"
 * UX flows.
 */
router.post("/global/screener-presets/:id/run-now", async (req, res) => {
  const sk = requireSessionKey(req, res); if (sk == null) return;
  const idParsed = UuidParam.safeParse(req.params["id"]);
  if (!idParsed.success) { res.status(400).json({ error: "invalid id" }); return; }
  // Verify ownership before kicking off the run so a session can't probe
  // for other users' preset ids.
  const [exists] = await db.select({ id: globalScreenerPresetsTable.id })
    .from(globalScreenerPresetsTable)
    .where(and(
      eq(globalScreenerPresetsTable.id, idParsed.data),
      eq(globalScreenerPresetsTable.sessionKey, sk),
    ));
  if (!exists) { res.status(404).json({ error: "preset not found" }); return; }
  const result = await runPresetNow(idParsed.data);
  if (!result.ok) { res.status(500).json({ error: result.error }); return; }
  const [row] = await db.select().from(globalScreenerPresetsTable)
    .where(eq(globalScreenerPresetsTable.id, idParsed.data));
  res.json(serializePreset(row!));
});

// ── Preset sharing ──────────────────────────────────────────────────
// Share tokens are opaque, base64url-encoded random bytes (24 bytes →
// 32 chars). They are minted lazily on the owner's first "Copy share
// link" click and reused thereafter so the same URL keeps resolving
// across page reloads. The owner can revoke at any time, which sets the
// column back to null and immediately invalidates outstanding URLs.
//
// IMPORTANT: the public preview/import endpoints intentionally never
// echo the original owner's session key, ids, timestamps, or alert
// state — only the preset's `name` and `body`. This keeps the share
// payload free of any identifying information about the original author.

const SHARE_TOKEN_BYTES = 24;

function generateShareToken(): string {
  return crypto.randomBytes(SHARE_TOKEN_BYTES).toString("base64url");
}

// Path-segment-safe token: base64url alphabet, length tied to 24-byte
// payload (32 chars). Keep validation strict so a stray UUID or random
// junk can never accidentally hit the public lookup handler.
const ShareTokenParam = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);

router.post("/global/screener-presets/:id/share", async (req, res) => {
  const sk = requireSessionKey(req, res); if (sk == null) return;
  const idParsed = UuidParam.safeParse(req.params["id"]);
  if (!idParsed.success) { res.status(400).json({ error: "invalid id" }); return; }
  const [existing] = await db.select({
    id: globalScreenerPresetsTable.id,
    shareToken: globalScreenerPresetsTable.shareToken,
  }).from(globalScreenerPresetsTable).where(and(
    eq(globalScreenerPresetsTable.id, idParsed.data),
    eq(globalScreenerPresetsTable.sessionKey, sk),
  ));
  if (!existing) { res.status(404).json({ error: "preset not found" }); return; }
  let token = existing.shareToken ?? null;
  if (!token) {
    // Atomic: only the request that flips share_token from NULL→candidate
    // wins, so two concurrent first-time mints can't overwrite each other
    // and invalidate an already-copied URL. Retry on the (vanishingly
    // unlikely) collision with another preset's existing token.
    for (let attempt = 0; attempt < 4 && !token; attempt++) {
      const candidate = generateShareToken();
      try {
        const updated = await db.update(globalScreenerPresetsTable)
          .set({ shareToken: candidate, updatedAt: new Date() })
          .where(and(
            eq(globalScreenerPresetsTable.id, idParsed.data),
            eq(globalScreenerPresetsTable.sessionKey, sk),
            isNull(globalScreenerPresetsTable.shareToken),
          ))
          .returning({ shareToken: globalScreenerPresetsTable.shareToken });
        if (updated.length > 0 && updated[0]?.shareToken) {
          token = updated[0].shareToken;
        } else {
          // Another concurrent request beat us to it — adopt the token it
          // wrote so both clients see the same URL.
          const [refetched] = await db.select({
            shareToken: globalScreenerPresetsTable.shareToken,
          }).from(globalScreenerPresetsTable).where(and(
            eq(globalScreenerPresetsTable.id, idParsed.data),
            eq(globalScreenerPresetsTable.sessionKey, sk),
          ));
          if (refetched?.shareToken) { token = refetched.shareToken; break; }
          // Row vanished (deleted between the read and the update). Bail.
          res.status(404).json({ error: "preset not found" });
          return;
        }
      } catch (err) {
        if (!isUniqueViolation(err)) {
          logger.warn({ err: (err as Error).message }, "failed to mint share token");
          res.status(500).json({ error: "failed to mint share token" });
          return;
        }
      }
    }
    if (!token) {
      res.status(500).json({ error: "failed to mint share token" });
      return;
    }
  }
  // Path is relative to the global artifact's origin so the client can
  // resolve it against `window.location.origin` and copy to clipboard.
  res.json({ token, shareUrl: `/global/screener?share=${encodeURIComponent(token)}` });
});

router.delete("/global/screener-presets/:id/share", async (req, res) => {
  const sk = requireSessionKey(req, res); if (sk == null) return;
  const idParsed = UuidParam.safeParse(req.params["id"]);
  if (!idParsed.success) { res.status(400).json({ error: "invalid id" }); return; }
  const result = await db.update(globalScreenerPresetsTable)
    .set({ shareToken: null, updatedAt: new Date() })
    .where(and(
      eq(globalScreenerPresetsTable.id, idParsed.data),
      eq(globalScreenerPresetsTable.sessionKey, sk),
    ))
    .returning({ id: globalScreenerPresetsTable.id });
  if (result.length === 0) { res.status(404).json({ error: "preset not found" }); return; }
  res.json({ ok: true });
});

router.get("/global/screener-presets/share/:token", async (req, res) => {
  const tokParsed = ShareTokenParam.safeParse(req.params["token"]);
  if (!tokParsed.success) { res.status(404).json({ error: "share link not found" }); return; }
  const [row] = await db.select({
    name: globalScreenerPresetsTable.name,
    body: globalScreenerPresetsTable.body,
  })
    .from(globalScreenerPresetsTable)
    .where(and(
      eq(globalScreenerPresetsTable.shareToken, tokParsed.data),
      isNotNull(globalScreenerPresetsTable.shareToken),
    ));
  if (!row) { res.status(404).json({ error: "share link not found" }); return; }
  // Deliberately strip everything except name + filter body so nothing
  // identifying about the original author leaks through the link.
  res.json({
    name: row.name,
    body: row.body as z.infer<typeof ScreenerBody>,
  });
});

router.post("/global/screener-presets/import/:token", async (req, res) => {
  const sk = requireSessionKey(req, res); if (sk == null) return;
  const tokParsed = ShareTokenParam.safeParse(req.params["token"]);
  if (!tokParsed.success) { res.status(404).json({ error: "share link not found" }); return; }
  const [src] = await db.select({
    name: globalScreenerPresetsTable.name,
    body: globalScreenerPresetsTable.body,
  })
    .from(globalScreenerPresetsTable)
    .where(and(
      eq(globalScreenerPresetsTable.shareToken, tokParsed.data),
      isNotNull(globalScreenerPresetsTable.shareToken),
    ));
  if (!src) { res.status(404).json({ error: "share link not found" }); return; }
  // Collide-safe insert: if the recipient already has a preset with the
  // same name, append " (2)", " (3)", … until the unique-name invariant
  // holds. Capped to keep us from spinning forever in pathological cases.
  const baseName = src.name.slice(0, 70);
  for (let attempt = 1; attempt <= 50; attempt++) {
    const candidate = attempt === 1 ? baseName : `${baseName} (${attempt})`;
    try {
      const [row] = await db.insert(globalScreenerPresetsTable).values({
        sessionKey: sk,
        name: candidate.slice(0, 80),
        body: src.body as z.infer<typeof ScreenerBody>,
        autoRunIntervalMin: null,
      }).returning();
      res.status(201).json(serializePreset(row!));
      return;
    } catch (err) {
      if (!isUniqueViolation(err)) {
        logger.warn({ err: (err as Error).message }, "failed to import shared preset");
        res.status(500).json({ error: "failed to import preset" });
        return;
      }
      // try next suffix
    }
  }
  res.status(409).json({ error: "could not find a free name to import the preset under" });
});

// ── Status (data freshness) ─────────────────────────────────────────
router.get("/global/status", async (_req, res) => {
  const [rows, deadCandidates, disabled] = await Promise.all([
    getSyncStatuses(),
    getDeadCandidates(),
    listDisabled(),
  ]);
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
  res.json({
    sources: out,
    universeCounts: counts,
    // `deadCandidates` are symbols that have failed >= threshold consecutive
    // refresh cycles and are likely delisted upstream — see
    // DEAD_SYMBOL_STREAK_THRESHOLD in dataLayer.ts. The UI surfaces these
    // so an operator knows what to prune from `universe.ts`.
    deadCandidates,
    deadCandidateThreshold: DEAD_SYMBOL_STREAK_THRESHOLD,
    // Currently-muted instruments (operator-set via
    // POST /global/instruments/:symbol/disabled). The dashboard popover
    // shows these in a "Disabled" section with a re-enable action so
    // muting can be undone in one click when the symbol comes back.
    disabledInstruments: disabled,
  });
});

export default router;
