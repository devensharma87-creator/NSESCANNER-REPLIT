/**
 * Orchestrates Binance + Yahoo into the global scanner's persistent store.
 *
 * Responsibilities:
 *  - One-shot universe seeding into `global_instruments`.
 *  - Periodic in-memory ticker refresh (Binance batch every 30s,
 *    Yahoo commodities every 60s, Yahoo FX every 90s) persisted into
 *    `global_live_prices` and `global_sync_logs`.
 *  - On-demand candle fetch + persist into `global_candles`.
 *
 * Concurrency: all refreshers are started by `startGlobalDataPump()` from
 * the Express bootstrap. They are best-effort — failures are logged into
 * `global_sync_logs` and surfaced via `/api/global/status`. Routes never
 * await the pump; they read whatever is fresh in DB / cache.
 */

import { db } from "@workspace/db";
import {
  globalCandlesTable,
  globalInstrumentsTable,
  globalLivePricesTable,
  globalSyncLogsTable,
} from "@workspace/db/schema";
import { eq, and, inArray, desc } from "drizzle-orm";
import { logger } from "../logger";
import {
  CRYPTO,
  COMMODITIES,
  FOREX,
  UNIVERSE,
  findInstrument,
  type GlobalDataSource,
  type GlobalInstrumentDef,
  type GlobalTimeframe,
} from "./universe";
import { fetchBinanceTickers, fetchBinanceKlines } from "./binance";
import { fetchYahooCandles, fetchYahooQuoteSnapshot, type YfCandle } from "./yahoo";

let booted = false;

export async function seedGlobalUniverse(): Promise<void> {
  // Insert any missing rows; never delete (a row removed from code shouldn't
  // wipe existing watchlist references). Update display fields if changed.
  for (const inst of UNIVERSE) {
    await db.insert(globalInstrumentsTable).values({
      symbol: inst.symbol,
      displayName: inst.displayName,
      assetClass: inst.assetClass,
      source: inst.source,
      sourceSymbol: inst.sourceSymbol,
      currency: inst.currency ?? null,
      notes: inst.notes ?? null,
    }).onConflictDoUpdate({
      target: globalInstrumentsTable.symbol,
      set: {
        displayName: inst.displayName,
        assetClass: inst.assetClass,
        source: inst.source,
        sourceSymbol: inst.sourceSymbol,
        currency: inst.currency ?? null,
        notes: inst.notes ?? null,
      },
    });
  }
  logger.info({ count: UNIVERSE.length }, "Seeded global scanner universe");
}

async function recordSyncOk(source: GlobalDataSource, notes?: string): Promise<void> {
  const now = new Date();
  await db.insert(globalSyncLogsTable).values({
    source, lastOkAt: now, okCount: 1, notes: notes ?? null, updatedAt: now,
  }).onConflictDoUpdate({
    target: globalSyncLogsTable.source,
    set: { lastOkAt: now, notes: notes ?? null, updatedAt: now },
  });
}

async function recordSyncErr(source: GlobalDataSource, err: unknown): Promise<void> {
  const now = new Date();
  const msg = err instanceof Error ? err.message : String(err);
  await db.insert(globalSyncLogsTable).values({
    source, lastErrorAt: now, lastError: msg, errCount: 1, updatedAt: now,
  }).onConflictDoUpdate({
    target: globalSyncLogsTable.source,
    set: { lastErrorAt: now, lastError: msg, updatedAt: now },
  });
}

async function upsertLivePrice(
  symbol: string,
  source: GlobalDataSource,
  patch: {
    price: number | null;
    prevClose?: number | null;
    changeAbs?: number | null;
    changePct?: number | null;
    dayHigh?: number | null;
    dayLow?: number | null;
    volume?: number | null;
    lastError?: string | null;
  },
): Promise<void> {
  const now = new Date();
  await db.insert(globalLivePricesTable).values({
    symbol,
    source,
    price: patch.price,
    prevClose: patch.prevClose ?? null,
    changeAbs: patch.changeAbs ?? null,
    changePct: patch.changePct ?? null,
    dayHigh: patch.dayHigh ?? null,
    dayLow: patch.dayLow ?? null,
    volume: patch.volume ?? null,
    updatedAt: now,
    lastError: patch.lastError ?? null,
  }).onConflictDoUpdate({
    target: globalLivePricesTable.symbol,
    set: {
      price: patch.price,
      prevClose: patch.prevClose ?? null,
      changeAbs: patch.changeAbs ?? null,
      changePct: patch.changePct ?? null,
      dayHigh: patch.dayHigh ?? null,
      dayLow: patch.dayLow ?? null,
      volume: patch.volume ?? null,
      source,
      updatedAt: now,
      lastError: patch.lastError ?? null,
    },
  });
}

// ── Binance batch refresh ────────────────────────────────────────────
export async function refreshBinance(): Promise<void> {
  try {
    const tickers = await fetchBinanceTickers(CRYPTO.map(c => c.sourceSymbol));
    const bySymbol = new Map(tickers.map(t => [t.symbol, t] as const));
    for (const inst of CRYPTO) {
      const t = bySymbol.get(inst.sourceSymbol);
      if (!t) continue;
      await upsertLivePrice(inst.symbol, "binance", {
        price: t.lastPrice,
        prevClose: t.prevClosePrice,
        changeAbs: t.priceChange,
        changePct: t.priceChangePercent,
        dayHigh: t.highPrice,
        dayLow: t.lowPrice,
        volume: t.volume,
        lastError: null,
      });
    }
    await recordSyncOk("binance", `${tickers.length}/${CRYPTO.length} symbols`);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Binance refresh failed");
    await recordSyncErr("binance", err);
  }
}

// ── Yahoo per-symbol refresh (commodities + fx) ──────────────────────
async function refreshYahooBatch(
  defs: GlobalInstrumentDef[],
  source: GlobalDataSource,
): Promise<void> {
  let ok = 0; let fail = 0;
  for (const inst of defs) {
    try {
      const q = await fetchYahooQuoteSnapshot(inst.sourceSymbol);
      if (!q || !Number.isFinite(q.price)) {
        fail++;
        await upsertLivePrice(inst.symbol, source, { price: null, lastError: "no quote" });
        continue;
      }
      await upsertLivePrice(inst.symbol, source, {
        price: q.price,
        prevClose: q.prevClose,
        changeAbs: q.changeAbs,
        changePct: q.changePct,
        dayHigh: q.dayHigh,
        dayLow: q.dayLow,
        volume: q.volume,
        lastError: null,
      });
      ok++;
    } catch (err) {
      fail++;
      const msg = err instanceof Error ? err.message : String(err);
      await upsertLivePrice(inst.symbol, source, { price: null, lastError: msg });
    }
  }
  if (ok > 0) await recordSyncOk(source, `${ok} ok / ${fail} fail`);
  if (ok === 0 && fail > 0) await recordSyncErr(source, new Error(`${fail}/${defs.length} symbols failed`));
}

export async function refreshCommodities(): Promise<void> { await refreshYahooBatch(COMMODITIES, "yahoo"); }
export async function refreshForex(): Promise<void> { await refreshYahooBatch(FOREX, "yahoo-fx"); }

// ── Candle fetch / cache ─────────────────────────────────────────────

/**
 * Fetch candles, persist to DB, return them. If the upstream call fails we
 * fall back to whatever is in DB (so charts keep rendering across a flaky
 * upstream window) and re-throw the original error only if the DB is empty.
 */
export async function getCandlesFresh(
  symbol: string,
  timeframe: GlobalTimeframe,
  limit?: number,
): Promise<Array<{ t: number; open: number; high: number; low: number; close: number; volume: number | null; source: GlobalDataSource }>> {
  const inst = findInstrument(symbol);
  if (!inst) throw new Error(`unknown symbol: ${symbol}`);
  let raw: Array<{ t: number; open: number; high: number; low: number; close: number; volume: number | null }>;
  try {
    if (inst.source === "binance") {
      const klines = await fetchBinanceKlines(inst.sourceSymbol, timeframe, limit);
      raw = klines.map(k => ({ t: k.t, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume }));
    } else {
      const candles: YfCandle[] = await fetchYahooCandles(inst.sourceSymbol, timeframe);
      raw = candles.map(c => ({ t: c.t, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
      if (limit && raw.length > limit) raw = raw.slice(-limit);
    }
    if (raw.length > 0) {
      // Bulk upsert (chunked) — keep recent 5x the requested window so
      // indicators have warm-up room.
      const chunkSize = 200;
      for (let i = 0; i < raw.length; i += chunkSize) {
        const chunk = raw.slice(i, i + chunkSize);
        await db.insert(globalCandlesTable).values(
          chunk.map(c => ({
            symbol: inst.symbol,
            timeframe,
            ts: new Date(c.t),
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume ?? null,
            source: inst.source,
          })),
        ).onConflictDoUpdate({
          target: [globalCandlesTable.symbol, globalCandlesTable.timeframe, globalCandlesTable.ts],
          set: {
            open: globalCandlesTable.open,
            high: globalCandlesTable.high,
            low: globalCandlesTable.low,
            close: globalCandlesTable.close,
            volume: globalCandlesTable.volume,
          },
        });
      }
    }
    return raw.map(c => ({ ...c, source: inst.source }));
  } catch (err) {
    logger.warn({ err: (err as Error).message, symbol, timeframe }, "Live candle fetch failed; falling back to cached");
    const rows = await db.select().from(globalCandlesTable)
      .where(and(eq(globalCandlesTable.symbol, inst.symbol), eq(globalCandlesTable.timeframe, timeframe)))
      .orderBy(desc(globalCandlesTable.ts))
      .limit(limit ?? 500);
    if (rows.length === 0) throw err;
    return rows.reverse().map(r => ({
      t: r.ts.getTime(), open: r.open, high: r.high, low: r.low, close: r.close,
      volume: r.volume, source: inst.source,
    }));
  }
}

// ── Public read helpers used by routes ──────────────────────────────

export async function getLivePrices(symbols: string[]): Promise<Map<string, typeof globalLivePricesTable.$inferSelect>> {
  if (symbols.length === 0) return new Map();
  const rows = await db.select().from(globalLivePricesTable).where(inArray(globalLivePricesTable.symbol, symbols));
  return new Map(rows.map(r => [r.symbol, r] as const));
}

export async function getSyncStatuses(): Promise<typeof globalSyncLogsTable.$inferSelect[]> {
  return db.select().from(globalSyncLogsTable);
}

/**
 * Per-source freshness budget: a row is considered `stale` if its
 * `updatedAt` is older than this AND no successful refresh has happened
 * within the budget. Budgets are deliberately ~2x the refresh interval so
 * a single missed cycle does not flag rows; multiple consecutive misses
 * do. Centralised here so UI never has to guess.
 */
export const FRESHNESS_BUDGET_MS: Record<GlobalDataSource, number> = {
  binance:    90_000,   // refresh 30s, budget 90s
  yahoo:      180_000,  // refresh 60s, budget 180s
  "yahoo-fx": 240_000,  // refresh 90s, budget 240s
};

export interface SourceHealth {
  healthy: boolean;
  lastOkMs: number | null;
  lastErrorMs: number | null;
}

/**
 * Roll-up health per data source. A source is `healthy` when the last
 * successful refresh is more recent than the last error.
 */
export async function getSourceHealthMap(): Promise<Map<GlobalDataSource, SourceHealth>> {
  const rows = await getSyncStatuses();
  const out = new Map<GlobalDataSource, SourceHealth>();
  for (const r of rows) {
    const lastOkMs = r.lastOkAt ? r.lastOkAt.getTime() : null;
    const lastErrorMs = r.lastErrorAt ? r.lastErrorAt.getTime() : null;
    out.set(r.source as GlobalDataSource, {
      lastOkMs,
      lastErrorMs,
      healthy: lastOkMs != null && (lastErrorMs == null || lastOkMs > lastErrorMs),
    });
  }
  return out;
}

export interface DashboardRow {
  symbol: string;
  displayName: string;
  assetClass: GlobalInstrumentDef["assetClass"];
  source: GlobalDataSource;
  currency: string | null;
  price: number | null;
  prevClose: number | null;
  changeAbs: number | null;
  changePct: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  updatedAt: string | null;
  ageMs: number | null;
  stale: boolean;
  sourceHealthy: boolean;
  lastError: string | null;
}

/**
 * Compose a dashboard row from a live-price row + source health, computing
 * `stale` against the per-source freshness budget. A row is stale if:
 *   - the upstream source is currently failing (sourceHealthy=false), OR
 *   - its `updatedAt` is older than FRESHNESS_BUDGET_MS for its source.
 *
 * The price itself is preserved (last-known) so charts/lists do not blank
 * out across a brief upstream hiccup; the `stale` flag is the user's
 * signal that the value may not reflect the current market.
 */
export async function buildDashboardRows(symbols: string[]): Promise<DashboardRow[]> {
  if (symbols.length === 0) return [];
  const [live, health] = await Promise.all([
    getLivePrices(symbols),
    getSourceHealthMap(),
  ]);
  const now = Date.now();
  return symbols.map((sym): DashboardRow => {
    const inst = findInstrument(sym);
    const p = live.get(sym);
    const source = (inst?.source ?? "binance") as GlobalDataSource;
    const updatedAtMs = p?.updatedAt ? p.updatedAt.getTime() : null;
    const ageMs = updatedAtMs != null ? now - updatedAtMs : null;
    const sourceHealthy = health.get(source)?.healthy ?? (updatedAtMs != null);
    const budget = FRESHNESS_BUDGET_MS[source];
    const stale =
      !sourceHealthy ||
      updatedAtMs == null ||
      (ageMs != null && ageMs > budget);
    return {
      symbol: sym,
      displayName: inst?.displayName ?? sym,
      assetClass: inst?.assetClass ?? "crypto",
      source,
      currency: inst?.currency ?? null,
      price: p?.price ?? null,
      prevClose: p?.prevClose ?? null,
      changeAbs: p?.changeAbs ?? null,
      changePct: p?.changePct ?? null,
      dayHigh: p?.dayHigh ?? null,
      dayLow: p?.dayLow ?? null,
      volume: p?.volume ?? null,
      updatedAt: p?.updatedAt ? p.updatedAt.toISOString() : null,
      ageMs,
      stale,
      sourceHealthy,
      lastError: p?.lastError ?? null,
    };
  });
}

// ── Background pump ──────────────────────────────────────────────────
const TIMERS: NodeJS.Timeout[] = [];

export function stopGlobalDataPump(): void {
  for (const t of TIMERS) clearInterval(t);
  TIMERS.length = 0;
  booted = false;
}

export async function startGlobalDataPump(): Promise<void> {
  if (booted) return;
  booted = true;
  await seedGlobalUniverse();

  // Kick off an immediate refresh (don't await — keep boot fast).
  void refreshBinance();
  void refreshCommodities();
  void refreshForex();

  TIMERS.push(setInterval(() => { void refreshBinance(); },     30_000));
  TIMERS.push(setInterval(() => { void refreshCommodities(); }, 60_000));
  TIMERS.push(setInterval(() => { void refreshForex(); },       90_000));

  logger.info("Global scanner data pump started (binance 30s, commodities 60s, forex 90s)");
}
