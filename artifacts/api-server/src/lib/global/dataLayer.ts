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
import { eq, and, inArray, desc, gte, sql } from "drizzle-orm";
import { logger } from "../logger";
import {
  CRYPTO,
  COMMODITIES,
  FOREX,
  EQUITIES,
  INDICES,
  UNIVERSE,
  findInstrument,
  type GlobalDataSource,
  type GlobalInstrumentDef,
  type GlobalTimeframe,
} from "./universe";
import { fetchBinanceTickers, fetchBinanceKlines } from "./binance";
import { fetchYahooCandles, fetchYahooQuoteSnapshot, type YfCandle } from "./yahoo";
import { loadDisabledSet } from "./disabledSymbols";

let booted = false;

/**
 * Number of consecutive refresh-cycle failures after which a symbol is
 * flagged as a "candidate dead symbol" — i.e. likely delisted on the
 * upstream (Binance pair retired, Yahoo continuous-future code changed)
 * rather than experiencing a transient network blip.
 *
 * The crypto refresher runs every 30s and the Yahoo refreshers every
 * 60–90s, so 5 consecutive misses ≈ 2.5–7.5 minutes of sustained failure
 * before we surface the symbol — long enough to filter out normal
 * upstream hiccups but short enough to catch real delistings the same
 * trading session.
 */
export const DEAD_SYMBOL_STREAK_THRESHOLD = 5;

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

/**
 * Stamp an upstream error onto the row WITHOUT bumping the per-symbol
 * `failureStreak`. Used for upstream-wide failures (e.g. a Binance chunk
 * HTTP request throwing) where the *batch* is broken, not necessarily
 * any individual ticker — penalising every symbol in the chunk would
 * drown the dead-candidate signal in false positives whenever Binance
 * has a brief outage.
 *
 * If no row exists yet we no-op: a transient upstream blip on a brand-new
 * symbol shouldn't materialise a row that masquerades as something
 * "we know about".
 */
async function recordTransientUpstreamError(
  symbol: string,
  source: GlobalDataSource,
  message: string,
): Promise<void> {
  await db.update(globalLivePricesTable)
    .set({ lastError: message, source })
    .where(eq(globalLivePricesTable.symbol, symbol));
}

/**
 * Refresh failed for `symbol` because the upstream returned a definitive
 * per-symbol negative signal (missing from batch response, 404, "no quote",
 * etc.) — preserve the last-known price/quote (so the dashboard keeps
 * showing it) but stamp the upstream error onto the row for the UI
 * tooltip. Crucially we DO NOT touch `updatedAt`; the row's age grows
 * naturally and the per-source freshness budget marks it `stale`.
 *
 * Side effect: bump `failureStreak`. If no row exists yet (brand-new symbol
 * that has never had a successful refresh) we still insert one — with a
 * sentinel `updatedAt` of epoch 0 so `buildDashboardRows` continues to
 * mark it `stale` — so the streak counter starts from the very first miss.
 *
 * Logs a structured warning the *first* time a symbol crosses the
 * `DEAD_SYMBOL_STREAK_THRESHOLD` so ops dashboards can catch the
 * transition without spamming every cycle.
 */
async function recordLivePriceError(
  symbol: string,
  source: GlobalDataSource,
  message: string,
): Promise<void> {
  // Sentinel for "never had a successful refresh" — far in the past so the
  // freshness budget always marks it stale and `buildDashboardRows` shows
  // nulls for the price columns.
  const NEVER_OK = new Date(0);
  const result = await db
    .insert(globalLivePricesTable)
    .values({
      symbol,
      source,
      price: null,
      lastError: message,
      failureStreak: 1,
      lastFailureAt: new Date(),
      updatedAt: NEVER_OK,
    })
    .onConflictDoUpdate({
      target: globalLivePricesTable.symbol,
      set: {
        lastError: message,
        source,
        lastFailureAt: new Date(),
        // Increment atomically so concurrent chunks/workers don't race.
        failureStreak: sql`${globalLivePricesTable.failureStreak} + 1`,
        // DO NOT touch updatedAt — the freshness budget needs the existing
        // (possibly old) value to compute `ageMs` / `stale` correctly.
      },
    })
    .returning({ failureStreak: globalLivePricesTable.failureStreak });

  const newStreak = result[0]?.failureStreak ?? 0;
  if (newStreak === DEAD_SYMBOL_STREAK_THRESHOLD) {
    logger.warn(
      { symbol, source, failureStreak: newStreak, message, threshold: DEAD_SYMBOL_STREAK_THRESHOLD },
      "global instrument crossed dead-symbol threshold — candidate for pruning from universe.ts",
    );
  }
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
    failureStreak: 0,
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
      // Reset the failure streak — a successful refresh ends any prior run
      // of misses. `lastFailureAt` is preserved as historical context.
      failureStreak: 0,
    },
  });
}

// ── Binance batch refresh ────────────────────────────────────────────
//
// Binance's `/api/v3/ticker/24hr` accepts a JSON-array `symbols=` query, but
// (a) the URL gets long and (b) ANY invalid symbol in the list fails the
// whole call. We chunk into 40-symbol batches so a single bad ticker only
// blanks its own chunk, and the rest of the universe still refreshes.
const BINANCE_CHUNK_SIZE = 40;

export async function refreshBinance(): Promise<void> {
  let ok = 0;
  let fail = 0;
  let lastErr: Error | null = null;
  // Operator-muted symbols are skipped entirely — we don't fetch them, don't
  // bump their failure streak, and don't surface them as `stale` since the
  // operator has explicitly told us they should be ignored. See
  // `disabledSymbols.ts`.
  const disabled = await loadDisabledSet();
  const active = CRYPTO.filter(c => !disabled.has(c.symbol));
  const chunks: GlobalInstrumentDef[][] = [];
  for (let i = 0; i < active.length; i += BINANCE_CHUNK_SIZE) {
    chunks.push(active.slice(i, i + BINANCE_CHUNK_SIZE));
  }
  for (const chunk of chunks) {
    try {
      const tickers = await fetchBinanceTickers(chunk.map(c => c.sourceSymbol));
      const bySymbol = new Map(tickers.map(t => [t.symbol, t] as const));
      for (const inst of chunk) {
        const t = bySymbol.get(inst.sourceSymbol);
        if (!t) {
          // Symbol missing from a successful batch response — almost always a
          // delisted ticker. Preserve the last-known row but flag the error;
          // the freshness budget will eventually mark it stale.
          fail++;
          await recordLivePriceError(inst.symbol, "binance", "not in batch response");
          continue;
        }
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
        ok++;
      }
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      fail += chunk.length;
      logger.warn({ err: lastErr.message, chunkSize: chunk.length }, "Binance chunk refresh failed");
      // The whole HTTP request threw — we cannot tell which (if any) symbol
      // is at fault, so stamp the upstream error onto each row WITHOUT
      // bumping `failureStreak`. The per-source freshness budget will still
      // surface the rows as `stale`; we just refuse to flag healthy symbols
      // in the same chunk as "dead candidates" because Binance had a
      // transient blip.
      for (const inst of chunk) {
        await recordTransientUpstreamError(inst.symbol, "binance", lastErr.message);
      }
    }
  }
  if (ok > 0) {
    await recordSyncOk("binance", `${ok}/${active.length} symbols (${fail} fail)`);
  } else if (lastErr) {
    await recordSyncErr("binance", lastErr);
  } else if (fail > 0) {
    await recordSyncErr("binance", new Error(`${fail}/${active.length} symbols failed`));
  }
}

// ── Yahoo per-symbol refresh (commodities + fx + equities + indices) ─
//
// Yahoo's chart() endpoint is per-symbol, so the Phase-2 Yahoo universe
// (30 commodities + 35 FX + 206 equities + 30 indices = 301 symbols)
// would take that many sequential round-trips per cycle. We use a bounded
// worker pool (small concurrency to stay well under per-IP throttling)
// so a full refresh comfortably finishes inside the 90s cycle budget while
// still being gentle on the upstream. Sizing math: at 206 equities / 4
// workers ≈ 52 sequential calls per worker; at ~500 ms per call that's
// ~26 s — well below the 90 s refresh interval.
//
// All four Yahoo refreshers (commodities/FX/equities/indices) share the
// upstream IP budget; they run on staggered intervals (60 s / 90 s / 90 s
// / 90 s) and the boot kickoffs are also staggered (see
// `startGlobalDataPump`) so the larger Phase-2 universe doesn't slam
// Yahoo at startup. After boot they can still briefly peak at 4×4=16
// in-flight requests when intervals align. Empirically that stays under
// Yahoo's per-IP throttle for the global pump in isolation; bump this
// down (not up) if the sync logs ever show 429 floods directly caused by
// these refreshers (i.e. tripping mid-cycle, not from another caller
// such as the full NSE Yahoo fallback).
const YAHOO_REFRESH_CONCURRENCY = 4;

async function refreshYahooBatch(
  defs: GlobalInstrumentDef[],
  source: GlobalDataSource,
): Promise<void> {
  if (defs.length === 0) return;
  // See `refreshBinance`: operator-muted symbols are dropped from this
  // cycle's worker pool entirely.
  const disabled = await loadDisabledSet();
  const active = defs.filter(d => !disabled.has(d.symbol));
  if (active.length === 0) return;
  let ok = 0;
  let fail = 0;
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < active.length) {
      const idx = cursor++;
      const inst = active[idx]!;
      try {
        const q = await fetchYahooQuoteSnapshot(inst.sourceSymbol);
        if (!q || !Number.isFinite(q.price)) {
          // Upstream answered but with no usable quote — keep last-known price
          // visible and let the freshness budget age it into `stale`.
          fail++;
          await recordLivePriceError(inst.symbol, source, "no quote");
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
        // Same intent as the Binance path: preserve last-known price; the
        // freshness budget surfaces multi-cycle failures as `stale`.
        await recordLivePriceError(inst.symbol, source, msg);
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(YAHOO_REFRESH_CONCURRENCY, active.length) },
    () => worker(),
  );
  await Promise.all(workers);

  if (ok > 0) await recordSyncOk(source, `${ok} ok / ${fail} fail`);
  if (ok === 0 && fail > 0) await recordSyncErr(source, new Error(`${fail}/${active.length} symbols failed`));
}

export async function refreshCommodities(): Promise<void> { await refreshYahooBatch(COMMODITIES, "yahoo"); }
export async function refreshForex(): Promise<void> { await refreshYahooBatch(FOREX, "yahoo-fx"); }
export async function refreshEquities(): Promise<void> { await refreshYahooBatch(EQUITIES, "yahoo-equity"); }
export async function refreshIndices(): Promise<void> { await refreshYahooBatch(INDICES, "yahoo-index"); }

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

export interface DeadCandidate {
  symbol: string;
  displayName: string;
  assetClass: GlobalInstrumentDef["assetClass"];
  source: GlobalDataSource;
  failureStreak: number;
  lastFailureAt: string | null;
  lastError: string | null;
}

/**
 * List candidate dead symbols — instruments whose `failureStreak` has
 * reached `DEAD_SYMBOL_STREAK_THRESHOLD`. The result is enriched with
 * universe metadata (display name, asset class) so the UI can render
 * a copy-pasteable list directly.
 *
 * Sorted by `failureStreak` desc so the worst offenders surface first.
 */
export async function getDeadCandidates(
  threshold: number = DEAD_SYMBOL_STREAK_THRESHOLD,
): Promise<DeadCandidate[]> {
  // Operator-muted symbols are excluded from this list. Once muted the
  // refreshers stop fetching them, so their `failureStreak` would otherwise
  // remain above the threshold forever — which would defeat the whole
  // point of the "Disable" button (the row would never leave the dead
  // candidates list). They reappear in the popover under "Disabled
  // symbols" with a re-enable action instead.
  const disabled = await loadDisabledSet();
  const rows = await db
    .select({
      symbol: globalLivePricesTable.symbol,
      source: globalLivePricesTable.source,
      failureStreak: globalLivePricesTable.failureStreak,
      lastFailureAt: globalLivePricesTable.lastFailureAt,
      lastError: globalLivePricesTable.lastError,
    })
    .from(globalLivePricesTable)
    .where(gte(globalLivePricesTable.failureStreak, threshold));
  return rows
    .filter(r => !disabled.has(r.symbol.toUpperCase()))
    .map((r): DeadCandidate => {
      const inst = findInstrument(r.symbol);
      return {
        symbol: r.symbol,
        displayName: inst?.displayName ?? r.symbol,
        assetClass: inst?.assetClass ?? "crypto",
        source: r.source as GlobalDataSource,
        failureStreak: r.failureStreak,
        lastFailureAt: r.lastFailureAt ? r.lastFailureAt.toISOString() : null,
        lastError: r.lastError,
      };
    })
    .sort((a, b) => b.failureStreak - a.failureStreak);
}

/**
 * Per-source freshness budget: a row is considered `stale` if its
 * `updatedAt` is older than this AND no successful refresh has happened
 * within the budget. Budgets are deliberately ~2x the refresh interval so
 * a single missed cycle does not flag rows; multiple consecutive misses
 * do. Centralised here so UI never has to guess.
 */
export const FRESHNESS_BUDGET_MS: Record<GlobalDataSource, number> = {
  binance:        90_000,   // refresh 30s, budget 90s
  yahoo:          180_000,  // refresh 60s, budget 180s
  "yahoo-fx":     240_000,  // refresh 90s, budget 240s
  "yahoo-equity": 240_000,  // refresh 90s, budget 240s — session-bound; we never blank the row
  "yahoo-index":  240_000,  // refresh 90s, budget 240s
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
  /**
   * Exchange code for equity / index rows (e.g. "NYSE", "TSE"); null for
   * crypto / commodity / FX rows. Drives the client-side market-session
   * badge — see `artifacts/global/src/lib/marketSessions.ts`.
   */
  exchange: string | null;
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
      exchange: inst?.exchange ?? null,
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
  // Binance fires immediately; the four Yahoo refreshers are staggered
  // (~0.5s / 3.5s / 7s / 11s) so the larger Phase-2 universe (301
  // Yahoo symbols total: 30 commodities + 35 FX + 206 equities + 30
  // indices) doesn't slam Yahoo's per-IP throttle in a single boot
  // burst — that tripped the shared rate-limit breaker in `yahoo.ts`
  // reliably when they all fired simultaneously.
  void refreshBinance();
  TIMERS.push(setInterval(() => { void refreshBinance(); }, 30_000));

  // Each Yahoo refresher's recurring interval is started from inside its
  // staggered boot kickoff, so the steady-state cycles stay phase-shifted
  // (not just the first one) and never all align on the same 90s tick.
  const startStaggered = (
    boot: number,
    intervalMs: number,
    fn: () => Promise<void>,
  ): void => {
    setTimeout(() => {
      void fn();
      TIMERS.push(setInterval(() => { void fn(); }, intervalMs));
    }, boot);
  };
  startStaggered(   500, 60_000, refreshCommodities);
  startStaggered( 3_500, 90_000, refreshForex);
  startStaggered( 7_000, 90_000, refreshEquities);
  startStaggered(11_000, 90_000, refreshIndices);

  logger.info(
    "Global scanner data pump started (binance 30s, commodities 60s, forex/equities/indices 90s; Yahoo cycles permanently staggered)",
  );
}
