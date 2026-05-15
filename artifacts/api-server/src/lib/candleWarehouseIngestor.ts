/**
 * Candle warehouse ingestor (Priority 4 — write-only data layer).
 *
 * Periodically pulls Kite historical candles for a controlled
 * universe of Indian market instruments and persists them to the
 * `candle` table. One bookkeeping row per cycle to `candle_sync_run`.
 *
 * **Strict scope guarantees:**
 *   - Read path only via `fetchKiteHistoricalByToken` (already
 *     throttled at ~2.5 req/sec with in-flight dedup) and
 *     `getInstrumentToken` / `getIndexTokenMap`. No new broker calls.
 *   - Write path inserts/upserts only into the two new tables.
 *   - Nothing in this module is consumed by the F&O signal pipeline,
 *     paper-trader, swing scorer, scanner, strategy builder, or
 *     order placement. Verified by callsite — see
 *     `swingScannerData.fetchDailyBars` which still calls Kite
 *     directly, NOT this warehouse.
 *
 * Universes (configurable via `CANDLE_WAREHOUSE_UNIVERSES`):
 *   - `indices` — NIFTY / BANKNIFTY / SENSEX (always available).
 *   - `fno-stocks` — `getDynamicFnoUniverse()` from oiLab. Only
 *     enabled when explicitly requested; ~199 names → meaningful
 *     Kite call volume.
 *   - `swing-500` — the NIFTY 500 universe used by the swing
 *     scanner. Heaviest set; off by default; hard-capped per cycle
 *     by `CANDLE_WAREHOUSE_MAX_SYMBOLS_PER_RUN` to spread the work
 *     across days.
 *
 * Intervals supported: `day`, `15minute`. (5-minute intentionally
 * excluded — too heavy for the controlled v1.)
 *
 * Cadence:
 *   - Daily candles: one INCREMENTAL sync after 15:40 IST per day,
 *     latched in-process. First-of-day sync auto-promotes to
 *     BACKFILL when the table is empty for the (instrument,
 *     interval) pair.
 *   - 15-minute candles: every 15 min during market hours.
 *   - Manual: `POST /api/candles/sync?...` (owner-only).
 *
 * Env (all optional, with safe defaults):
 *   - `CANDLE_WAREHOUSE_ENABLED`               — master gate (mirrors
 *                                                paper-trader pattern;
 *                                                fail-closed in dev).
 *   - `CANDLE_WAREHOUSE_UNIVERSES`             — CSV; default
 *                                                `indices`. Allowed:
 *                                                `indices,fno-stocks,swing-500`.
 *   - `CANDLE_WAREHOUSE_DAILY_BACKFILL_DAYS`   — default 400 (≈252
 *                                                trading days +
 *                                                weekends/holidays
 *                                                buffer).
 *   - `CANDLE_WAREHOUSE_INTRADAY_BACKFILL_DAYS`— default 30.
 *   - `CANDLE_WAREHOUSE_INCREMENTAL_DAYS`      — default 7 (top-up
 *                                                window; Kite returns
 *                                                fresh tail bars only,
 *                                                window is generous to
 *                                                cover weekends).
 *   - `CANDLE_WAREHOUSE_MAX_SYMBOLS_PER_RUN`   — default 60 (hard
 *                                                throttle to keep
 *                                                Kite-historical
 *                                                queue happy).
 *   - `CANDLE_WAREHOUSE_RETENTION_DAYS_INTRADAY` — default 60.
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  candleTable,
  candleSyncRunTable,
  type NewCandleRow,
} from "@workspace/db/schema";
import { logger } from "./logger";
import { fetchKiteHistoricalByToken } from "./kiteIntraday";
import { getInstrumentToken } from "./kiteFeed";
import { getIndexTokenMap } from "./kiteIntraday";
import { getDynamicFnoUniverse } from "./oiLab";
import { UNIVERSE } from "./universe";
import { computeMarketStatus } from "./marketEvents";

// ───────────── Universe definitions ─────────────

export type CandleInterval = "day" | "15minute";
export type CandleUniverse = "indices" | "fno-stocks" | "swing-500";
export type SyncKind = "BACKFILL" | "INCREMENTAL";

interface ResolvedSymbol {
  symbol: string;     // display tag (e.g. "RELIANCE", "NIFTY 50")
  exchange: "NSE" | "BSE";
  token: number;      // Kite instrument_token
  cacheLabel: string; // passed to fetchKiteHistoricalByToken
}

const INDEX_DEFINITIONS: Array<{ yahoo: string; symbol: string; exchange: "NSE" | "BSE" }> = [
  { yahoo: "^NSEI",    symbol: "NIFTY 50",   exchange: "NSE" },
  { yahoo: "^NSEBANK", symbol: "NIFTY BANK", exchange: "NSE" },
  { yahoo: "^BSESN",   symbol: "SENSEX",     exchange: "BSE" },
];

async function resolveIndices(): Promise<ResolvedSymbol[]> {
  const map = await getIndexTokenMap();
  if (!map) return [];
  const out: ResolvedSymbol[] = [];
  for (const def of INDEX_DEFINITIONS) {
    const t = map.get(def.yahoo);
    if (t && Number.isFinite(t) && t > 0) {
      out.push({
        symbol: def.symbol,
        exchange: def.exchange,
        token: t,
        cacheLabel: `warehouse:${def.yahoo}`,
      });
    }
  }
  return out;
}

async function resolveEquities(symbols: string[]): Promise<ResolvedSymbol[]> {
  const out: ResolvedSymbol[] = [];
  // Token resolution is local-cache-fronted (24h TTL inside kiteFeed),
  // so awaiting in series is fine — no broker fan-out.
  for (const sym of symbols) {
    try {
      const t = await getInstrumentToken(sym);
      if (t && Number.isFinite(t) && t > 0) {
        out.push({
          symbol: sym,
          exchange: "NSE",
          token: t,
          cacheLabel: `warehouse:${sym}`,
        });
      }
    } catch {
      // skip — token cache miss for this symbol; not an error condition
    }
  }
  return out;
}

async function resolveUniverse(u: CandleUniverse): Promise<ResolvedSymbol[]> {
  if (u === "indices") return resolveIndices();
  if (u === "fno-stocks") {
    const list = await getDynamicFnoUniverse();
    if (!list) return [];
    return resolveEquities(list);
  }
  if (u === "swing-500") {
    const symbols = UNIVERSE.filter((e) => !e.inactive).map((e) => e.symbol);
    return resolveEquities(symbols);
  }
  return [];
}

// ───────────── Config ─────────────

const TRUTHY = new Set(["1", "true", "yes", "on"]);
const FALSY = new Set(["0", "false", "no", "off"]);

export function isCandleWarehouseEnabled(): boolean {
  const raw = process.env["CANDLE_WAREHOUSE_ENABLED"];
  if (raw != null && raw.length > 0) {
    const v = raw.trim().toLowerCase();
    if (TRUTHY.has(v)) return true;
    if (FALSY.has(v)) return false;
    return false; // unrecognised → fail closed
  }
  return process.env["REPLIT_DEPLOYMENT"] === "1";
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

const ALLOWED_UNIVERSES = new Set<CandleUniverse>(["indices", "fno-stocks", "swing-500"]);

export function getEnabledUniverses(): CandleUniverse[] {
  const raw = process.env["CANDLE_WAREHOUSE_UNIVERSES"];
  if (!raw) return ["indices"];
  const parsed = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is CandleUniverse => ALLOWED_UNIVERSES.has(s as CandleUniverse));
  return parsed.length > 0 ? Array.from(new Set(parsed)) : ["indices"];
}

export function getWarehouseConfig(): {
  dailyBackfillDays: number;
  intradayBackfillDays: number;
  incrementalDays: number;
  maxSymbolsPerRun: number;
  retentionDaysIntraday: number;
} {
  return {
    dailyBackfillDays: intEnv("CANDLE_WAREHOUSE_DAILY_BACKFILL_DAYS", 400, 30, 2000),
    intradayBackfillDays: intEnv("CANDLE_WAREHOUSE_INTRADAY_BACKFILL_DAYS", 30, 1, 90),
    incrementalDays: intEnv("CANDLE_WAREHOUSE_INCREMENTAL_DAYS", 7, 1, 30),
    maxSymbolsPerRun: intEnv("CANDLE_WAREHOUSE_MAX_SYMBOLS_PER_RUN", 60, 1, 1000),
    retentionDaysIntraday: intEnv("CANDLE_WAREHOUSE_RETENTION_DAYS_INTRADAY", 60, 7, 365),
  };
}

// ───────────── Pure helpers (exported for tests) ─────────────

interface ChartLike {
  timestamps: number[]; // seconds
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

/**
 * Convert a YahooChart-shaped Kite response into rows ready for upsert.
 * Filters bars with non-finite/non-positive OHLC to match the rest of
 * the codebase's no-synthetic-data policy.
 */
export function chartToCandleRows(
  chart: ChartLike,
  meta: { instrumentToken: number; interval: CandleInterval; symbol: string; exchange: "NSE" | "BSE"; source: "kite" | "yahoo" },
): NewCandleRow[] {
  const out: NewCandleRow[] = [];
  for (let i = 0; i < chart.timestamps.length; i++) {
    const tsSec = chart.timestamps[i];
    const o = chart.open[i], h = chart.high[i], l = chart.low[i], c = chart.close[i];
    const v = chart.volume[i];
    if (!Number.isFinite(tsSec)) continue;
    if (![o, h, l, c].every((x) => Number.isFinite(x) && (x as number) > 0)) continue;
    out.push({
      instrumentToken: meta.instrumentToken,
      interval: meta.interval,
      ts: new Date((tsSec as number) * 1000),
      symbol: meta.symbol,
      exchange: meta.exchange,
      open: (o as number).toFixed(4),
      high: (h as number).toFixed(4),
      low: (l as number).toFixed(4),
      close: (c as number).toFixed(4),
      volume: Number.isFinite(v) && (v as number) > 0 ? Math.trunc(v as number) : 0,
      oi: null,
      source: meta.source,
    });
  }
  return out;
}

/** Given a sorted bar list, decide whether the gap between the latest
 *  stored ts (or null = empty) and the most recent bar implies we
 *  should run a BACKFILL or just an INCREMENTAL top-up. */
export function decideKindFromGap(
  latestStoredTsMs: number | null,
  thresholdDays: number,
): SyncKind {
  if (latestStoredTsMs == null) return "BACKFILL";
  const gapDays = (Date.now() - latestStoredTsMs) / 86_400_000;
  return gapDays > thresholdDays ? "BACKFILL" : "INCREMENTAL";
}

// ───────────── DB writes ─────────────

async function upsertCandles(rows: NewCandleRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const BATCH = 500;
  let total = 0;
  const now = new Date();
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH).map((r) => ({ ...r, updatedAt: now }));
    await db
      .insert(candleTable)
      .values(slice)
      .onConflictDoUpdate({
        target: [candleTable.instrumentToken, candleTable.interval, candleTable.ts],
        set: {
          open: sql`excluded.open`,
          high: sql`excluded.high`,
          low: sql`excluded.low`,
          close: sql`excluded.close`,
          volume: sql`excluded.volume`,
          oi: sql`excluded.oi`,
          source: sql`excluded.source`,
          symbol: sql`excluded.symbol`,
          exchange: sql`excluded.exchange`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    total += slice.length;
  }
  return total;
}

// ───────────── Run loop ─────────────

export interface SyncResult {
  kind: SyncKind;
  interval: CandleInterval;
  universe: CandleUniverse;
  symbolsAttempted: number;
  symbolsOk: number;
  rowsWritten: number;
  errors: Array<{ symbol: string; message: string }>;
  startedAt: Date;
  finishedAt: Date;
}

interface SyncOpts {
  interval: CandleInterval;
  universe: CandleUniverse;
  kind?: SyncKind;
  /** If true, ignore the per-cycle symbol cap (manual backfills only). */
  ignoreSymbolCap?: boolean;
}

/**
 * One sync cycle. Public so the diagnostic endpoint and the manual
 * trigger can both invoke it. Always writes a `candle_sync_run` row,
 * even on universe-resolution failure (so the failure is visible).
 */
export async function syncCandles(opts: SyncOpts): Promise<SyncResult> {
  const startedAt = new Date();
  const cfg = getWarehouseConfig();
  const { interval, universe } = opts;

  let resolved: ResolvedSymbol[];
  try {
    resolved = await resolveUniverse(universe);
  } catch (err) {
    return await finaliseRun({
      kind: opts.kind ?? "INCREMENTAL",
      interval,
      universe,
      symbolsAttempted: 0,
      symbolsOk: 0,
      rowsWritten: 0,
      errors: [{ symbol: "*", message: `universe_resolve_failed: ${(err as Error).message}` }],
      startedAt,
      finishedAt: new Date(),
    });
  }

  if (resolved.length === 0) {
    return await finaliseRun({
      kind: opts.kind ?? "INCREMENTAL",
      interval,
      universe,
      symbolsAttempted: 0,
      symbolsOk: 0,
      rowsWritten: 0,
      errors: [{ symbol: "*", message: "universe_empty (kite session inactive or universe not configured)" }],
      startedAt,
      finishedAt: new Date(),
    });
  }

  // Honour the per-cycle cap unless caller explicitly opts out (manual
  // BACKFILL trigger). Spreads heavy universes across many cycles.
  const cap = opts.ignoreSymbolCap ? resolved.length : Math.min(resolved.length, cfg.maxSymbolsPerRun);
  const slice = resolved.slice(0, cap);

  // For mixed-mode (auto-detect kind), look up latest stored ts per
  // (token, interval) in one query so we don't fan-out N selects.
  const tokens = slice.map((s) => s.token);
  const latestByToken = new Map<number, number>();
  if (opts.kind == null && tokens.length > 0) {
    const rows = (await db.execute(sql`
      SELECT instrument_token, EXTRACT(EPOCH FROM MAX(ts)) * 1000 AS latest_ms
      FROM candle
      WHERE interval = ${interval}
        AND instrument_token = ANY(${tokens}::bigint[])
      GROUP BY instrument_token;
    `)) as unknown as { rows: Array<{ instrument_token: number; latest_ms: string | number }> };
    for (const r of rows.rows) {
      const ms = typeof r.latest_ms === "string" ? parseFloat(r.latest_ms) : r.latest_ms;
      if (Number.isFinite(ms)) latestByToken.set(Number(r.instrument_token), ms);
    }
  }

  const errors: SyncResult["errors"] = [];
  let okCount = 0;
  let rowsWritten = 0;
  let runKind: SyncKind = opts.kind ?? "INCREMENTAL";

  for (const r of slice) {
    let perSymbolKind: SyncKind = opts.kind ?? "INCREMENTAL";
    if (opts.kind == null) {
      const latestMs = latestByToken.get(r.token) ?? null;
      const threshold = interval === "day" ? 5 : 1;
      perSymbolKind = decideKindFromGap(latestMs, threshold);
      if (perSymbolKind === "BACKFILL") runKind = "BACKFILL";
    }

    const daysBack =
      perSymbolKind === "BACKFILL"
        ? interval === "day"
          ? cfg.dailyBackfillDays
          : cfg.intradayBackfillDays
        : cfg.incrementalDays;

    try {
      const chart = await fetchKiteHistoricalByToken(r.token, r.cacheLabel, interval, daysBack);
      if (!chart) {
        errors.push({ symbol: r.symbol, message: "kite_returned_null" });
        continue;
      }
      const rows = chartToCandleRows(chart, {
        instrumentToken: r.token,
        interval,
        symbol: r.symbol,
        exchange: r.exchange,
        source: "kite",
      });
      const n = await upsertCandles(rows);
      rowsWritten += n;
      okCount += 1;
    } catch (err) {
      errors.push({ symbol: r.symbol, message: (err as Error).message });
    }
  }

  return await finaliseRun({
    kind: runKind,
    interval,
    universe,
    symbolsAttempted: slice.length,
    symbolsOk: okCount,
    rowsWritten,
    errors,
    startedAt,
    finishedAt: new Date(),
  });
}

async function finaliseRun(r: SyncResult): Promise<SyncResult> {
  try {
    await db.insert(candleSyncRunTable).values({
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      durationMs: r.finishedAt.getTime() - r.startedAt.getTime(),
      kind: r.kind,
      interval: r.interval,
      universe: r.universe,
      symbolsAttempted: r.symbolsAttempted,
      symbolsOk: r.symbolsOk,
      rowsWritten: r.rowsWritten,
      errors: r.errors.slice(0, 20),
    });
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "candle-warehouse: failed to persist run row (continuing)",
    );
  }
  return r;
}

// ───────────── Retention sweep (intraday only) ─────────────

export async function runRetentionSweep(): Promise<{ candleRowsDeleted: number; runRowsDeleted: number }> {
  const cfg = getWarehouseConfig();
  const cutoff = new Date(Date.now() - cfg.retentionDaysIntraday * 86_400_000);
  // Daily candles are kept indefinitely — backfill takes hours and we
  // need the runway. Only sweep intraday intervals.
  const candleDel = await db.execute(sql`
    DELETE FROM candle
    WHERE interval <> 'day' AND ts < ${cutoff.toISOString()};
  `);
  const runDel = await db.execute(sql`
    DELETE FROM candle_sync_run WHERE started_at < ${cutoff.toISOString()};
  `);
  const c = (candleDel as unknown as { rowCount?: number }).rowCount ?? 0;
  const r = (runDel as unknown as { rowCount?: number }).rowCount ?? 0;
  return { candleRowsDeleted: c, runRowsDeleted: r };
}

// ───────────── Scheduler ─────────────

let dailyTimer: NodeJS.Timeout | null = null;
let intradayTimer: NodeJS.Timeout | null = null;
let retentionTimer: NodeJS.Timeout | null = null;
let lastDailyDateIst: string | null = null;
let inFlightDaily = false;
let inFlightIntraday = false;
const lastResults: SyncResult[] = []; // ring buffer (16 most recent)

export function getRecentResults(): SyncResult[] {
  return [...lastResults];
}

function recordResult(r: SyncResult): void {
  lastResults.unshift(r);
  if (lastResults.length > 16) lastResults.length = 16;
}

function istDayKey(now: Date): string {
  return new Date(now.getTime() + 5.5 * 60 * 60_000).toISOString().slice(0, 10);
}

function istHourMinute(now: Date): { h: number; m: number } {
  const d = new Date(now.getTime() + 5.5 * 60 * 60_000);
  return { h: d.getUTCHours(), m: d.getUTCMinutes() };
}

async function dailyTick(): Promise<void> {
  if (inFlightDaily) return;
  const now = new Date();
  const today = istDayKey(now);
  if (lastDailyDateIst === today) return;
  const { h, m } = istHourMinute(now);
  // Run after 15:40 IST (post-close + a buffer for Kite to refresh).
  if (h < 15 || (h === 15 && m < 40)) return;
  inFlightDaily = true;
  try {
    for (const u of getEnabledUniverses()) {
      const r = await syncCandles({ interval: "day", universe: u });
      recordResult(r);
      logger.info(
        { universe: u, kind: r.kind, ok: r.symbolsOk, attempted: r.symbolsAttempted, rows: r.rowsWritten, err: r.errors.length },
        "candle-warehouse: daily tick complete",
      );
    }
    lastDailyDateIst = today;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "candle-warehouse: daily tick failed");
  } finally {
    inFlightDaily = false;
  }
}

async function intradayTick(): Promise<void> {
  if (inFlightIntraday) return;
  if (computeMarketStatus(new Date()) !== "open") return;
  inFlightIntraday = true;
  try {
    for (const u of getEnabledUniverses()) {
      const r = await syncCandles({ interval: "15minute", universe: u });
      recordResult(r);
      if (r.rowsWritten > 0 || r.errors.length > 0) {
        logger.info(
          { universe: u, kind: r.kind, ok: r.symbolsOk, rows: r.rowsWritten, err: r.errors.length },
          "candle-warehouse: 15m tick complete",
        );
      }
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "candle-warehouse: 15m tick failed");
  } finally {
    inFlightIntraday = false;
  }
}

/**
 * Start the long-running schedulers. Idempotent. No-ops when:
 *   1. `CANDLE_WAREHOUSE_ENABLED` resolves false (dev / preview default).
 *   2. Timers already running.
 *   3. `DATABASE_URL` is unset (test environments).
 */
export function startCandleWarehouse(): void {
  if (dailyTimer != null || intradayTimer != null) return;
  if (!process.env["DATABASE_URL"]) {
    logger.info("candle-warehouse: DATABASE_URL not set, skipping");
    return;
  }
  if (!isCandleWarehouseEnabled()) {
    logger.info(
      { reason: "CANDLE_WAREHOUSE_ENABLED is off (auto-detected dev or explicit override)" },
      "candle-warehouse: disabled",
    );
    return;
  }
  const cfg = getWarehouseConfig();
  logger.info(
    {
      universes: getEnabledUniverses(),
      dailyBackfillDays: cfg.dailyBackfillDays,
      intradayBackfillDays: cfg.intradayBackfillDays,
      incrementalDays: cfg.incrementalDays,
      maxSymbolsPerRun: cfg.maxSymbolsPerRun,
      retentionDaysIntraday: cfg.retentionDaysIntraday,
    },
    "candle-warehouse: starting",
  );

  // Daily latch checked every 5 min; cheap, so don't over-engineer cron.
  dailyTimer = setInterval(() => void dailyTick(), 5 * 60_000);
  // 15-minute candles — match the bar size.
  intradayTimer = setInterval(() => void intradayTick(), 15 * 60_000);
  // Retention sweep daily.
  void runRetentionSweep().catch((err) =>
    logger.warn({ err: (err as Error).message }, "candle-warehouse: retention sweep failed"),
  );
  retentionTimer = setInterval(
    () =>
      void runRetentionSweep().catch((err) =>
        logger.warn({ err: (err as Error).message }, "candle-warehouse: retention sweep failed"),
      ),
    24 * 60 * 60_000,
  );
}

export function stopCandleWarehouse(): void {
  if (dailyTimer) { clearInterval(dailyTimer); dailyTimer = null; }
  if (intradayTimer) { clearInterval(intradayTimer); intradayTimer = null; }
  if (retentionTimer) { clearInterval(retentionTimer); retentionTimer = null; }
}
