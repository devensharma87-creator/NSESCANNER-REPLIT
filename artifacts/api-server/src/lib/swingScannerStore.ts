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
import { fetchDailyBars, fetchBenchmarkBars, fetchFundamentalsForSwing } from "./swingScannerData";
import { NIFTY500_SYMBOLS } from "./watchlistLists";
import { loadKiteQuotes } from "./kiteScanner";
import { logger } from "./logger";

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
    sector: r.sector || null,
    industry: r.industry || null,
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
    const benchmark = await fetchBenchmarkBars(365);
    if (!benchmark) logger.warn({ scanDate }, "swing-scan benchmark fetch failed; RS scores will be neutral");
    const benchClose = benchmark?.close ?? null;
    const benchTs = benchmark?.ts ?? null;

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

export async function runIntradayRefresh(): Promise<{ updated: number }> {
  if (intradayInflight) return { updated: 0 };
  intradayInflight = true;
  try {
    const scanDate = istDateString();
    // Only refresh today's locked plans. Skip if there are none yet
    // (e.g. cold-start before the first deep scan).
    const todays = await db
      .select({
        symbol: swingScanResultTable.symbol,
        triggerPrice: swingScanResultTable.triggerPrice,
        closePrice: swingScanResultTable.closePrice,
      })
      .from(swingScanResultTable)
      .where(eq(swingScanResultTable.scanDate, scanDate));
    if (todays.length === 0) return { updated: 0 };
    const symbols = todays.map(t => t.symbol);
    const quotes = await loadKiteQuotes(symbols);
    if (!quotes) {
      logger.warn({ scanDate }, "swing-scan intraday refresh: Kite session unavailable");
      return { updated: 0 };
    }
    const now = new Date();
    let updated = 0;
    for (const t of todays) {
      const q = quotes.get(t.symbol);
      if (!q) continue;
      const lp = q.lastPrice;
      const baseClose = Number(t.closePrice);
      const trigger = Number(t.triggerPrice);
      if (!Number.isFinite(lp) || lp <= 0) continue;
      const changePct = baseClose > 0 ? ((lp - baseClose) / baseClose) * 100 : NaN;
      const triggerHit = Number.isFinite(trigger) && trigger > 0 ? (q.high ?? lp) >= trigger : null;
      await db.update(swingScanResultTable).set({
        intradayLast: numToStr(lp),
        intradayChangePct: numToStr(changePct),
        triggerHit,
        intradayUpdatedAt: now,
      }).where(and(eq(swingScanResultTable.symbol, t.symbol), eq(swingScanResultTable.scanDate, scanDate)));
      updated++;
    }
    logger.info({ scanDate, updated, total: todays.length }, "swing-scan intraday refresh complete");
    return { updated };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "swing-scan intraday refresh failed");
    return { updated: 0 };
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
