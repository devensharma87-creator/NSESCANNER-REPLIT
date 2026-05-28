/**
 * Swing-scanner orchestrator + scheduler + read API.
 *
 * Cadence (mirrors the spec the owner approved):
 *
 *   • Deep scan — once per IST trading day, latched on `lastDeepScanDate`.
 *     Triggered ≥ 15:35 IST on a 60s setInterval. Iterates NIFTY 500,
 *     fetches daily bars (Kite-first, Yahoo fallback via swingScannerData),
 *     scores via swingScanner.scoreAndPlan, upserts into
 *     `swing_scan_result` keyed (symbol, scan_date). Parallel-bound to
 *     CONCURRENCY=6 so we play nice with the same Kite throttle queue
 *     OI back-fill uses (~2.5 req/s).
 *
 *   • Intraday refresh — every 15 min during market hours (09:15–15:30
 *     IST, weekdays). Batches LTPs via `loadKiteQuotes` (one ~480-symbol
 *     getQuote call per batch ≈ 2 calls for the whole NIFTY 500), then
 *     UPDATE-only (never INSERT — we never overwrite the locked plan)
 *     `intraday_last`, `intraday_change_pct`, `trigger_hit`. Runs on its
 *     own setInterval; safe to fire while a deep scan is in progress.
 *
 *   • Cold start — on boot, if `swing_scan_result` has zero rows for
 *     today's IST date, kick off a one-shot deep scan in the background
 *     so the UI isn't empty after a deploy.
 *
 * Single-replica assumption: the date latches live in process memory.
 * Multi-replica deployments would deep-scan once per replica per day —
 * no DB corruption (UPSERT dedups on PK), but wasted work. A pg
 * advisory lock would be the fix; not needed for the current single
 * replica.
 */
import { sql, eq, desc, and, gte } from "drizzle-orm";
import { db, swingScanResultTable, swingScanRunTable } from "@workspace/db";
import type { SwingScanResultRow } from "@workspace/db";
import { scoreAndPlan, type SwingScanResult } from "./swingScanner";
import { fetchDailyBars, fetchBenchmarkBarsResilient, fetchFundamentalsForSwing, type SwingBenchmarkSource } from "./swingScannerData";
import { NIFTY500_SYMBOLS } from "./watchlistLists";
import { loadKiteQuotes } from "./kiteScanner";
import { logger } from "./logger";
import { lookupSector } from "./sectorMap";

const CONCURRENCY = 6;
const DEEP_SCAN_HOUR_IST = 15;
const DEEP_SCAN_MIN_IST = 35;
const SCHEDULER_INTERVAL_MS = 60 * 1000;
const INTRADAY_INTERVAL_MS = 15 * 60 * 1000;

/* ─────────────────────────── IST helpers ─────────────────────────── */

function nowIst(): Date {
  return new Date(Date.now() + 5.5 * 3600 * 1000);
}

function istDateString(d: Date = nowIst()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function isWeekdayIst(d: Date = nowIst()): boolean {
  const dow = d.getUTCDay();
  return dow >= 1 && dow <= 5;
}

function isMarketHoursIst(d: Date = nowIst()): boolean {
  if (!isWeekdayIst(d)) return false;
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
}

function isAfterDeepScanCutoffIst(d: Date = nowIst()): boolean {
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  return mins >= DEEP_SCAN_HOUR_IST * 60 + DEEP_SCAN_MIN_IST;
}

/* ─────────────────────────── Concurrency ─────────────────────────── */

async function mapWithConcurrency<I, O>(items: I[], limit: number, fn: (item: I, idx: number) => Promise<O>): Promise<O[]> {
  const out: O[] = new Array(items.length);
  let next = 0;
  await Promise.all(new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try { out[i] = await fn(items[i]!, i); }
      catch (err) { out[i] = err as O; }
    }
  }));
  return out;
}

/* ─────────────────────────── Persistence ─────────────────────────── */

function numToStr(n: number): string | null {
  return Number.isFinite(n) ? String(+n.toFixed(4)) : null;
}

function rowFromResult(scanDate: string, r: SwingScanResult): typeof swingScanResultTable.$inferInsert {
  return {
    symbol: r.symbol,
    scanDate,
    action: r.action,
    setup: r.setup,
    qualityGrade: r.qualityGrade,
    potential: r.potential,
    score: numToStr(r.score) ?? "0",
    technicalScore: numToStr(r.technicalScore) ?? "0",
    smcScore: numToStr(r.smcScore) ?? "0",
    volumeScore: numToStr(r.volumeScore) ?? "0",
    momentumScore: numToStr(r.momentumScore) ?? "0",
    fundamentalScore: numToStr(r.fundamentalScore) ?? "0",
    riskScore: numToStr(r.riskScore) ?? "0",
    contextScore: numToStr(r.contextScore) ?? "0",
    rsScore: numToStr(r.rsScore),
    closePrice: numToStr(r.close) ?? "0",
    entry: numToStr(r.entry) ?? "0",
    stopLoss: numToStr(r.stopLoss) ?? "0",
    target1: numToStr(r.target1) ?? "0",
    target2: numToStr(r.target2) ?? "0",
    rrToT1: numToStr(r.rrToT1),
    buyZoneLower: numToStr(r.buyZoneLower) ?? "0",
    buyZoneUpper: numToStr(r.buyZoneUpper) ?? "0",
    buyZoneBasis: r.buyZoneBasis,
    triggerText: r.triggerText,
    triggerPrice: numToStr(r.triggerPrice) ?? "0",
    stopBasis: r.stopBasis,
    targetBasis: r.targetBasis,
    rsi14: numToStr(r.rsi14),
    adx14: numToStr(r.adx14),
    atr14: numToStr(r.atr14),
    atrPct: numToStr(r.atrPct),
    volRatio: numToStr(r.volRatio),
    avgValueLakhs: numToStr(r.avgValueLakhs),
    pctFrom52wLow: numToStr(r.pctFrom52wLow),
    pctFrom52wHigh: numToStr(r.pctFrom52wHigh),
    weeklyTrend: r.weeklyTrend,
    candleSignal: r.candleSignal,
    marketStructure: r.marketStructure,
    rs20: numToStr(r.rs20),
    rs50: numToStr(r.rs50),
    rs120: numToStr(r.rs120),
    // Sector/industry: prefer fundamentals-provided values when present,
    // else fall back to the durable sector map (UNIVERSE + curated
    // extension). `lookupSector` always returns a value — for genuinely
    // unmapped symbols it returns the literal "Unmapped" sentinel which
    // surfaces in the diagnostic endpoint.
    sector: (r.sector ?? "").trim() || lookupSector(r.symbol).sector,
    industry: (r.industry ?? "").trim() || lookupSector(r.symbol).industry,
    fundamentalStatus: r.fundamentalStatus,
    reasons: r.reasons,
    warnings: r.warnings,
    intradayLast: null,
    intradayChangePct: null,
    triggerHit: null,
    intradayUpdatedAt: null,
    updatedAt: new Date(),
  };
}

async function upsertResult(row: typeof swingScanResultTable.$inferInsert): Promise<void> {
  await db
    .insert(swingScanResultTable)
    .values(row)
    .onConflictDoUpdate({
      target: [swingScanResultTable.symbol, swingScanResultTable.scanDate],
      set: { ...row, updatedAt: new Date() },
    });
}

/* ─────────────────────────── Deep scan ───────────────────────────── */

let deepScanInflight = false;
let lastDeepScanDate: string | null = null;
let lastDeepScanError: string | null = null;

/* ─────────────────── S3a benchmark health ──────────────────────────
 * Process-local observability for the swing benchmark loader. Reset
 * between tests via `__resetSwingBenchmarkHealthForTests()`. Read via
 * `getSwingBenchmarkHealth()`. No DB persistence, no effect on
 * scoring/recommendation/plan/paper/F&O.
 */
export interface SwingBenchmarkHealth {
  fetchesTotal: number;
  bySource: Record<SwingBenchmarkSource, number>;
  lastBenchmark: {
    scanDate: string;
    source: SwingBenchmarkSource;
    barCount: number;
    firstDate: string | null;
    lastDate: string | null;
    errors: { yahoo?: string; yahooRetry?: string; kite?: string };
    durationMs: number;
    rsEnabled: boolean;
    at: string;
  } | null;
  bootedAt: string;
}

const benchmarkHealth: SwingBenchmarkHealth = {
  fetchesTotal: 0,
  bySource: { yahoo: 0, yahoo_retry: 0, kite: 0, none: 0 },
  lastBenchmark: null,
  bootedAt: new Date().toISOString(),
};

export function getSwingBenchmarkHealth(): SwingBenchmarkHealth {
  return {
    ...benchmarkHealth,
    bySource: { ...benchmarkHealth.bySource },
    lastBenchmark: benchmarkHealth.lastBenchmark ? { ...benchmarkHealth.lastBenchmark, errors: { ...benchmarkHealth.lastBenchmark.errors } } : null,
  };
}

export function __resetSwingBenchmarkHealthForTests(): void {
  benchmarkHealth.fetchesTotal = 0;
  benchmarkHealth.bySource = { yahoo: 0, yahoo_retry: 0, kite: 0, none: 0 };
  benchmarkHealth.lastBenchmark = null;
}

export async function runDeepScan(scanDate: string = istDateString()): Promise<{ scanned: number; errors: number; durationMs: number }> {
  if (deepScanInflight) {
    logger.warn({ scanDate }, "swing-scan deep-scan already in flight; skipping");
    return { scanned: 0, errors: 0, durationMs: 0 };
  }
  deepScanInflight = true;
  const startedAt = new Date();
  let scanned = 0;
  let errors = 0;
  try {
    logger.info({ scanDate, universe: NIFTY500_SYMBOLS.length }, "swing-scan deep scan starting");
    // S3a (2026-05-28): resilient benchmark loader. Order:
    //   Yahoo → Yahoo retry (750ms backoff) → Kite NIFTY 50 historical
    // → none. Returns a structured result so we can log/diagnose the
    // exact source. No change to the RS formula or weights.
    const benchmark = await fetchBenchmarkBarsResilient(365);
    benchmarkHealth.lastBenchmark = {
      scanDate,
      source: benchmark.source,
      barCount: benchmark.barCount,
      firstDate: benchmark.firstDate,
      lastDate: benchmark.lastDate,
      errors: benchmark.errors,
      durationMs: benchmark.durationMs,
      rsEnabled: benchmark.bars != null,
      at: new Date().toISOString(),
    };
    benchmarkHealth.fetchesTotal++;
    benchmarkHealth.bySource[benchmark.source]++;
    if (benchmark.bars) {
      logger.info(
        { scanDate, source: benchmark.source, barCount: benchmark.barCount, firstDate: benchmark.firstDate, lastDate: benchmark.lastDate, durationMs: benchmark.durationMs },
        "swing-scan benchmark loaded",
      );
    } else {
      logger.warn(
        { scanDate, errors: benchmark.errors, durationMs: benchmark.durationMs },
        "swing-scan benchmark fetch failed (all sources); RS scores will be neutral",
      );
    }
    const benchClose = benchmark.bars?.close ?? null;
    const benchTs = benchmark.bars?.ts ?? null;

    await mapWithConcurrency(NIFTY500_SYMBOLS, CONCURRENCY, async (symbol) => {
      try {
        const bars = await fetchDailyBars(symbol, 500);
        if (!bars) { errors++; return; }
        const fundamentals = await fetchFundamentalsForSwing(symbol).catch(() => null);
        const result = scoreAndPlan({
          symbol, bars,
          benchmarkClose: benchClose, benchmarkTs: benchTs,
          fundamentals: fundamentals ?? null,
        });
        if (result.status !== "OK") { errors++; return; }
        await upsertResult(rowFromResult(scanDate, result as SwingScanResult));
        scanned++;
      } catch (err) {
        errors++;
        const e = err as Error & { cause?: unknown };
        const cause = e.cause as { message?: string; code?: string; detail?: string; column?: string } | undefined;
        logger.warn({
          symbol,
          err: e.message?.slice(0, 200),
          causeMessage: cause?.message,
          causeCode: cause?.code,
          causeDetail: cause?.detail,
          causeColumn: cause?.column,
        }, "swing-scan symbol failed");
      }
    });

    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    await db.insert(swingScanRunTable).values({
      scanDate, scannedCount: scanned, errorCount: errors, durationMs,
      startedAt, finishedAt, kind: "DEEP_SCAN",
    }).onConflictDoUpdate({
      target: swingScanRunTable.scanDate,
      set: { scannedCount: scanned, errorCount: errors, durationMs, startedAt, finishedAt },
    });
    lastDeepScanDate = scanDate;
    lastDeepScanError = null;
    logger.info({ scanDate, scanned, errors, durationMs }, "swing-scan deep scan finished");
    return { scanned, errors, durationMs };
  } catch (err) {
    lastDeepScanError = (err as Error).message;
    logger.error({ err: lastDeepScanError, scanDate }, "swing-scan deep scan threw");
    throw err;
  } finally {
    deepScanInflight = false;
  }
}

/* ─────────────────────── Intraday refresh ────────────────────────── */

let intradayInflight = false;

/**
 * Process-local observability for the intraday refresh cycle.
 * Read-only via `getIntradayRefreshHealth()`. Reset between tests via
 * `__resetIntradayRefreshHealthForTests()`. No DB persistence, no
 * effect on scoring/recommendation/plan/paper/F&O.
 */
interface IntradayRefreshHealth {
  cyclesTotal: number;
  rowsUpdatedTotal: number;
  triggerHitsLatchedTotal: number;
  lastCycle: {
    scanDate: string | null;
    considered: number;
    symbolsRequested: number;
    quotesReturned: number;
    updated: number;
    triggerHitsLatched: number;
    skippedNoQuote: number;
    skippedBadLtp: number;
    errors: number;
    durationMs: number;
    reason?: string;
  } | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorClass: string | null;
  lastErrorMessage: string | null;
  bootedAt: string;
}

const intradayHealth: IntradayRefreshHealth = {
  cyclesTotal: 0,
  rowsUpdatedTotal: 0,
  triggerHitsLatchedTotal: 0,
  lastCycle: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastErrorClass: null,
  lastErrorMessage: null,
  bootedAt: new Date().toISOString(),
};

export function getIntradayRefreshHealth(): IntradayRefreshHealth {
  return { ...intradayHealth, lastCycle: intradayHealth.lastCycle ? { ...intradayHealth.lastCycle } : null };
}

export function __resetIntradayRefreshHealthForTests(): void {
  intradayHealth.cyclesTotal = 0;
  intradayHealth.rowsUpdatedTotal = 0;
  intradayHealth.triggerHitsLatchedTotal = 0;
  intradayHealth.lastCycle = null;
  intradayHealth.lastSuccessAt = null;
  intradayHealth.lastErrorAt = null;
  intradayHealth.lastErrorClass = null;
  intradayHealth.lastErrorMessage = null;
}

/**
 * S2 (2026-05-27): the original implementation queried
 * `WHERE scan_date = istDateString()`. But the deep scan only starts at
 * 15:35 IST and the intraday gate (`isMarketHoursIst`) closes at 15:30
 * IST, so there was NEVER a market-hours moment where today's rows
 * existed. Consequence: `intraday_last`, `intraday_change_pct`,
 * `intraday_updated_at`, `trigger_hit` were NULL on every historical
 * scan_date going back to 2026-05-11.
 *
 * Fix: refresh the latest available `scan_date` (mirrors
 * `getLatestSwingScan` — UI already shows yesterday's plan in pre-market).
 * On a normal trading day this is yesterday's plan during the session
 * and today's plan after 15:35. On the first trading day after a weekend
 * /holiday it's Friday's plan, etc.
 *
 * Strict scope: this function only mutates `intraday_last`,
 * `intraday_change_pct`, `trigger_hit`, `intraday_updated_at`. It does
 * NOT touch score, action, setup, entry, stop_loss, target1, target2,
 * rr_to_t1, or any other plan field, and it does NOT touch
 * paper_trade_eq, paper_trade_fo, or any F&O table.
 *
 * Quote loader (`loadKiteQuotes`) formats symbols as `NSE:<TRADINGSYMBOL>`
 * for Kite getQuote and consumes `q.ohlc.high` for the trigger latch
 * via the mapped `KiteScannerQuote.high` field.
 */
export interface IntradayRefreshResult {
  scanDate: string | null;
  considered: number;
  updated: number;
  triggerHitsLatched: number;
  skippedNoQuote: number;
  skippedBadLtp: number;
  reason?: string;
}

/**
 * Optional test-injection seam: production call sites pass nothing and
 * the function uses the singleton `db`. Tests can pass a transaction
 * handle so seeded rows and the refresh run on the same connection
 * (P22 pattern, used by the F&O MTM sweep's `dbHandle` parameter).
 *
 * Also accepts an optional `quotesLoader` so unit tests can stub Kite
 * without spinning up `vi.mock`. Production passes nothing → uses
 * `loadKiteQuotes`.
 */
export type DbHandle = Pick<typeof db, "select" | "update">;
export type QuotesLoader = (symbols: string[]) => Promise<Map<string, import("./kiteScanner").KiteScannerQuote> | null>;

export async function runIntradayRefresh(
  dbHandle?: DbHandle,
  quotesLoader?: QuotesLoader,
): Promise<IntradayRefreshResult> {
  if (intradayInflight) {
    return { scanDate: null, considered: 0, updated: 0, triggerHitsLatched: 0, skippedNoQuote: 0, skippedBadLtp: 0, reason: "ALREADY_INFLIGHT" };
  }
  intradayInflight = true;
  const startedMs = Date.now();
  intradayHealth.cyclesTotal++;
  const dbh: DbHandle = dbHandle ?? db;
  const loader: QuotesLoader = quotesLoader ?? loadKiteQuotes;
  try {
    // Latest available scan_date (NOT strictly today — see S2 note above).
    const latest = await dbh
      .select({ d: swingScanResultTable.scanDate })
      .from(swingScanResultTable)
      .orderBy(desc(swingScanResultTable.scanDate))
      .limit(1);
    const scanDate = latest[0]?.d ?? null;
    if (!scanDate) {
      const result: IntradayRefreshResult = { scanDate: null, considered: 0, updated: 0, triggerHitsLatched: 0, skippedNoQuote: 0, skippedBadLtp: 0, reason: "NO_SCAN_ROWS_YET" };
      intradayHealth.lastCycle = { scanDate: null, considered: 0, symbolsRequested: 0, quotesReturned: 0, updated: 0, triggerHitsLatched: 0, skippedNoQuote: 0, skippedBadLtp: 0, errors: 0, durationMs: Date.now() - startedMs, reason: result.reason };
      return result;
    }

    const rows = await dbh
      .select({
        symbol: swingScanResultTable.symbol,
        triggerPrice: swingScanResultTable.triggerPrice,
        closePrice: swingScanResultTable.closePrice,
        triggerHit: swingScanResultTable.triggerHit,
      })
      .from(swingScanResultTable)
      .where(eq(swingScanResultTable.scanDate, scanDate));

    if (rows.length === 0) {
      const result: IntradayRefreshResult = { scanDate, considered: 0, updated: 0, triggerHitsLatched: 0, skippedNoQuote: 0, skippedBadLtp: 0, reason: "NO_ROWS_FOR_SCAN_DATE" };
      intradayHealth.lastCycle = { scanDate, considered: 0, symbolsRequested: 0, quotesReturned: 0, updated: 0, triggerHitsLatched: 0, skippedNoQuote: 0, skippedBadLtp: 0, errors: 0, durationMs: Date.now() - startedMs, reason: result.reason };
      return result;
    }

    const symbols = rows.map(r => r.symbol);
    const quotes = await loader(symbols);
    if (!quotes) {
      logger.warn({ scanDate }, "swing-scan intraday refresh: Kite session unavailable");
      const result: IntradayRefreshResult = { scanDate, considered: rows.length, updated: 0, triggerHitsLatched: 0, skippedNoQuote: rows.length, skippedBadLtp: 0, reason: "KITE_UNAVAILABLE" };
      intradayHealth.lastCycle = { scanDate, considered: rows.length, symbolsRequested: symbols.length, quotesReturned: 0, updated: 0, triggerHitsLatched: 0, skippedNoQuote: rows.length, skippedBadLtp: 0, errors: 0, durationMs: Date.now() - startedMs, reason: result.reason };
      return result;
    }

    const now = new Date();
    let updated = 0;
    let triggerHitsLatched = 0;
    let skippedNoQuote = 0;
    let skippedBadLtp = 0;
    let errors = 0;

    for (const r of rows) {
      const q = quotes.get(r.symbol);
      if (!q) { skippedNoQuote++; continue; }
      const lp = q.lastPrice;
      if (!Number.isFinite(lp) || lp <= 0) { skippedBadLtp++; continue; }
      const baseClose = Number(r.closePrice);
      const trigger = Number(r.triggerPrice);
      const changePct = baseClose > 0 ? ((lp - baseClose) / baseClose) * 100 : NaN;
      // Trigger latch: high of session >= triggerPrice. If we already
      // latched true earlier in the day, keep it latched (defensive — a
      // late-session pullback below trigger shouldn't unlatch).
      const wasLatched = r.triggerHit === true;
      const hitNow = Number.isFinite(trigger) && trigger > 0 ? (q.high ?? lp) >= trigger : null;
      const triggerHit = wasLatched ? true : hitNow;
      if (!wasLatched && hitNow === true) triggerHitsLatched++;
      try {
        await dbh.update(swingScanResultTable).set({
          intradayLast: numToStr(lp),
          intradayChangePct: Number.isFinite(changePct) ? numToStr(changePct) : null,
          triggerHit,
          intradayUpdatedAt: now,
        }).where(and(eq(swingScanResultTable.symbol, r.symbol), eq(swingScanResultTable.scanDate, scanDate)));
        updated++;
      } catch (err) {
        errors++;
        logger.warn({ symbol: r.symbol, scanDate, err: (err as Error).message?.slice(0, 200) }, "swing-scan intraday row update failed");
      }
    }

    intradayHealth.rowsUpdatedTotal += updated;
    intradayHealth.triggerHitsLatchedTotal += triggerHitsLatched;
    intradayHealth.lastSuccessAt = new Date().toISOString();
    intradayHealth.lastCycle = {
      scanDate, considered: rows.length, symbolsRequested: symbols.length, quotesReturned: quotes.size,
      updated, triggerHitsLatched, skippedNoQuote, skippedBadLtp, errors,
      durationMs: Date.now() - startedMs,
    };
    logger.info(
      { scanDate, considered: rows.length, quotesReturned: quotes.size, updated, triggerHitsLatched, skippedNoQuote, skippedBadLtp, errors },
      "swing-scan intraday refresh complete",
    );
    return { scanDate, considered: rows.length, updated, triggerHitsLatched, skippedNoQuote, skippedBadLtp };
  } catch (err) {
    const e = err as Error;
    intradayHealth.lastErrorAt = new Date().toISOString();
    intradayHealth.lastErrorClass = e.constructor?.name ?? "Error";
    intradayHealth.lastErrorMessage = (e.message ?? "").slice(0, 200);
    intradayHealth.lastCycle = { scanDate: null, considered: 0, symbolsRequested: 0, quotesReturned: 0, updated: 0, triggerHitsLatched: 0, skippedNoQuote: 0, skippedBadLtp: 0, errors: 1, durationMs: Date.now() - startedMs, reason: "THREW" };
    logger.warn({ err: e.message }, "swing-scan intraday refresh failed");
    return { scanDate: null, considered: 0, updated: 0, triggerHitsLatched: 0, skippedNoQuote: 0, skippedBadLtp: 0, reason: "THREW" };
  } finally {
    intradayInflight = false;
  }
}

/* ─────────────────────────── Read API ────────────────────────────── */

export interface SwingScanQuery {
  limit?: number;
  action?: string;       // exact-match, e.g. "BUY ZONE - WAIT TRIGGER"
  setup?: string;
  minScore?: number;
  qualityGrade?: string;
}

export interface SwingScanReadResult {
  asOf: string;
  scanDate: string | null;
  runMeta: {
    scannedCount: number;
    errorCount: number;
    durationMs: number;
    startedAt: string;
    finishedAt: string;
  } | null;
  rows: SwingScanResultRow[];
}

export async function getLatestSwingScan(q: SwingScanQuery = {}): Promise<SwingScanReadResult> {
  // Pick the most recent scan_date that has any rows. Lets the UI keep
  // showing yesterday's plan in pre-market on the next trading day
  // until the post-close deep scan rewrites the cache.
  const latestDateRow = await db
    .select({ d: swingScanResultTable.scanDate })
    .from(swingScanResultTable)
    .orderBy(desc(swingScanResultTable.scanDate))
    .limit(1);
  const scanDate = latestDateRow[0]?.d ?? null;
  if (!scanDate) {
    return { asOf: new Date().toISOString(), scanDate: null, runMeta: null, rows: [] };
  }
  const conditions = [eq(swingScanResultTable.scanDate, scanDate)];
  if (q.action) conditions.push(eq(swingScanResultTable.action, q.action));
  if (q.setup) conditions.push(eq(swingScanResultTable.setup, q.setup));
  if (q.qualityGrade) conditions.push(eq(swingScanResultTable.qualityGrade, q.qualityGrade));
  if (typeof q.minScore === "number") conditions.push(gte(swingScanResultTable.score, String(q.minScore)));
  const limit = Math.max(1, Math.min(600, q.limit ?? 500));

  const rows = await db
    .select()
    .from(swingScanResultTable)
    .where(and(...conditions))
    .orderBy(desc(swingScanResultTable.score))
    .limit(limit);

  const meta = await db
    .select()
    .from(swingScanRunTable)
    .where(eq(swingScanRunTable.scanDate, scanDate))
    .limit(1);

  const m = meta[0] ?? null;
  return {
    asOf: new Date().toISOString(),
    scanDate,
    runMeta: m ? {
      scannedCount: m.scannedCount,
      errorCount: m.errorCount,
      durationMs: m.durationMs,
      startedAt: m.startedAt.toISOString(),
      finishedAt: m.finishedAt.toISOString(),
    } : null,
    rows,
  };
}

/* ──────────────────────── Scheduler bootstrap ────────────────────── */

let schedulerStarted = false;

function maybeRunDeepScanLatched(): void {
  const ist = nowIst();
  if (!isWeekdayIst(ist)) return;
  const today = istDateString(ist);
  if (lastDeepScanDate === today) return;
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  if (mins < DEEP_SCAN_HOUR_IST * 60 + DEEP_SCAN_MIN_IST) return;
  void runDeepScan(today).catch(err => {
    logger.error({ err: (err as Error).message }, "swing-scan scheduled deep scan failed");
  });
}

function maybeRunIntradayLatched(): void {
  if (!isMarketHoursIst()) return;
  void runIntradayRefresh().catch(err => {
    logger.warn({ err: (err as Error).message }, "swing-scan scheduled intraday refresh failed");
  });
}

export function startSwingScanScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  setInterval(maybeRunDeepScanLatched, SCHEDULER_INTERVAL_MS);
  setInterval(maybeRunIntradayLatched, INTRADAY_INTERVAL_MS);
  logger.info({}, "swing-scan scheduler started (60s deep-scan latch + 15min intraday refresh)");
  // Cold start: only auto-run a deep scan when (a) it's a weekday in IST,
  // (b) we're past the 15:35 IST cutoff (otherwise the official scheduled
  // run would be suppressed by the latch we'd burn here), AND (c) no
  // *completed* swing_scan_run row exists for today. We latch on the run
  // row — NOT raw result rows — so a partially-written deep scan from a
  // crashed prior process does not permanently suppress today's rerun.
  // (Architect 2026-05-11: avoids pre-15:35 latch + partial-row latch bugs.)
  void (async () => {
    try {
      const today = istDateString();
      if (!isWeekdayIst()) return;
      const finishedRun = await db
        .select({ d: swingScanRunTable.scanDate })
        .from(swingScanRunTable)
        .where(eq(swingScanRunTable.scanDate, today))
        .limit(1);
      if (finishedRun.length > 0) {
        lastDeepScanDate = today;
        return;
      }
      if (!isAfterDeepScanCutoffIst()) {
        logger.info({ today }, "swing-scan cold start: pre-15:35 IST, deferring to scheduled run");
        return;
      }
      logger.info({ today }, "swing-scan cold start: post-15:35 IST and no finished run, running deep scan");
      await runDeepScan(today);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "swing-scan cold-start probe failed");
    }
  })();
}

export function getSchedulerState(): { lastDeepScanDate: string | null; lastDeepScanError: string | null; deepScanInflight: boolean } {
  return { lastDeepScanDate, lastDeepScanError, deepScanInflight };
}
