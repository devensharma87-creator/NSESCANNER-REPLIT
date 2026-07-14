/**
 * F&O Exit Monitoring Reliability — schema migration + scheduler health.
 *
 * Schema migration mirrors the proven pattern in `swingTtlSweep.ts`:
 * additive nullable columns applied via raw
 * `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (never `drizzle-kit push`,
 * which wants to drop out-of-schema tables in this DB). Idempotent and
 * safe on every call, but callers should use `ensureFnoExitMonitorSchemaColumns()`
 * to avoid re-issuing the ALTER on every tick.
 *
 * IMPORTANT ORDERING LESSON (from the swing TTL sweep incident — see
 * SWING_TTL_STAGED_ORDER_LIFECYCLE_REPORT.md): on a fresh deployment the
 * columns do not exist yet. If a write-path tick fires BEFORE the migration
 * completes, it fails with "column does not exist". Any caller that writes
 * the new `paper_trade_fo` audit columns (recordOrUpdate's exit branch,
 * `evaluateOrphanedOpenTrades`, `closePaperTradeForSignal`) MUST await
 * `ensureFnoExitMonitorSchemaColumns()` before its first write — the
 * exported promise is memoized so this costs one DB round-trip total per
 * process lifetime, not one per tick.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, paperTradeFoTable } from "@workspace/db";
import { logger } from "./logger";
import type { FnoExitBlockedReason, FnoExitDecision } from "./fnoExitDecision";

export async function applyFnoExitMonitorSchemaColumns(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE paper_trade_fo
      ADD COLUMN IF NOT EXISTS exit_detected_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS exit_quote_source TEXT,
      ADD COLUMN IF NOT EXISTS exit_quote_as_of TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS exit_quote_freshness_sec INTEGER,
      ADD COLUMN IF NOT EXISTS exit_trade_grade BOOLEAN,
      ADD COLUMN IF NOT EXISTS exit_monitor_status TEXT,
      ADD COLUMN IF NOT EXISTS last_exit_check_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS last_exit_check_error TEXT,
      ADD COLUMN IF NOT EXISTS exit_notification_status TEXT
  `);
}

let migrationPromise: Promise<void> | null = null;

/**
 * Memoized, idempotent schema-ready gate. First caller triggers the
 * migration; every subsequent caller (this process lifetime) awaits the
 * same resolved promise — effectively free after the first call. On
 * failure the promise is cleared so a later call can retry (transient DB
 * blip should not permanently wedge exit monitoring into a broken state).
 */
export function ensureFnoExitMonitorSchemaColumns(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = applyFnoExitMonitorSchemaColumns().catch((err: unknown) => {
      migrationPromise = null;
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "fno exit monitor: schema column migration failed, will retry on next check",
      );
      throw err;
    });
  }
  return migrationPromise;
}

/** @internal Reset the memoized migration promise for tests. */
export function __resetFnoExitMonitorSchemaGuardForTests(): void {
  migrationPromise = null;
}

/** Identify the paper_trade_fo row to audit-stamp either by its unique
 * (signalDate, indexSymbol, setupKey, direction) key (used by
 * `optionSignalLifecycle.recordOrUpdate`) or directly by row id (used by
 * `evaluateOrphanedOpenTrades`, which already has the id loaded). */
export type FnoExitTradeKey =
  | {
      signalDate: string;
      indexSymbol: string;
      setupKey: string;
      direction: "BULLISH" | "BEARISH";
    }
  | { id: string };

/**
 * Best-effort audit stamp for a single exit-monitor check on one
 * `paper_trade_fo` row. Never mutates trade status/closedAt/premium fields —
 * those are owned exclusively by the existing close/lifecycle-advance paths.
 * Caller MUST have already awaited `ensureFnoExitMonitorSchemaColumns()`
 * (or does so implicitly here) before the first call in a process lifetime.
 *
 * - BLOCKED: stamps `last_exit_check_at/last_exit_check_error/exit_monitor_status`
 *   only. When keyed by the 4-tuple, additionally requires `status='OPEN'` —
 *   a BLOCKED check is only meaningful while the paper trade is still open;
 *   0 rows affected (no open trade yet, e.g. pre-trigger) is a harmless no-op.
 *   When keyed by row id the caller already knows the row is OPEN.
 * - EXIT / HOLD: stamps the trade-grade quote fields
 *   (`exit_quote_source/exit_quote_as_of/exit_quote_freshness_sec/exit_trade_grade`)
 *   plus `exit_monitor_status='MONITORED'`. EXIT additionally stamps
 *   `exit_detected_at`. No status filter — for a committed EXIT the row may
 *   already be CLOSED by the time this runs (stamp happens AFTER the close),
 *   so filtering on status would silently drop the audit write.
 */
export async function recordFnoExitCheck(
  key: FnoExitTradeKey,
  decision: FnoExitDecision,
  checkedAt: Date = new Date(),
): Promise<void> {
  await ensureFnoExitMonitorSchemaColumns();
  const isIdKey = "id" in key;
  const idMatch = isIdKey ? eq(paperTradeFoTable.id, key.id) : null;
  const tupleMatch = !isIdKey
    ? and(
        eq(paperTradeFoTable.signalDate, key.signalDate),
        eq(paperTradeFoTable.indexSymbol, key.indexSymbol),
        eq(paperTradeFoTable.setupKey, key.setupKey),
        eq(paperTradeFoTable.direction, key.direction),
      )
    : null;

  if (decision.kind === "BLOCKED") {
    const whereClause = isIdKey
      ? idMatch!
      : and(tupleMatch!, eq(paperTradeFoTable.status, "OPEN"));
    await db
      .update(paperTradeFoTable)
      .set({
        lastExitCheckAt: checkedAt,
        lastExitCheckError: decision.blockedReason,
        exitMonitorStatus: "BLOCKED",
        exitTradeGrade: false,
      })
      .where(whereClause);
    return;
  }

  const whereClause = isIdKey ? idMatch! : tupleMatch!;
  await db
    .update(paperTradeFoTable)
    .set({
      lastExitCheckAt: checkedAt,
      lastExitCheckError: null,
      exitMonitorStatus: "MONITORED",
      exitTradeGrade: true,
      exitQuoteSource: decision.quoteSource,
      exitQuoteAsOf:
        decision.quoteAsOfMs != null ? new Date(decision.quoteAsOfMs) : null,
      exitQuoteFreshnessSec: decision.quoteFreshnessSec,
      ...(decision.kind === "EXIT" ? { exitDetectedAt: checkedAt } : {}),
    })
    .where(whereClause);
}

// ─────────────────────────────────────────────────────────────────────────
// Scheduler summary counters (T004, 2026-07-02) — mirrors the
// `getPremiumOverlayHealth()` pattern in `fnoPremiumExitOverlay.ts`, scoped
// ONLY to the trust-gate decisions recorded via `recordFnoExitCheck` above
// (call sites: `optionSignalLifecycle.recordOrUpdate`'s cohort-loop pass and
// `paperTradingFO.evaluateOrphanedOpenTrades`'s orphan sweep). Does NOT
// duplicate `getOrphanExitSweepHealth()` or `getPremiumOverlayHealth()` —
// those track their own, separate pipelines and are merged alongside this
// one in the owner-only status endpoint (T005), unmodified.
//
// Derived from the EXISTING 30s sweep in `optionSignals.ts`
// (`TRIGGER_SWEEP_INTERVAL_MS`) — no new interval/scheduler is created here.
// `getOptionSignals()` is also invoked on-demand (routes/scanner.ts) and has
// no in-flight dedup, so two cycles CAN legitimately overlap; per
// architect-reviewed design, the accumulator is an explicit object created
// and threaded per `getOptionSignals()` call (never a module-level "current
// cycle" singleton) so concurrent cycles can never cross-attribute counts.
// Under a rare overlap, `lastCycle`/`lastSuccessAt` is last-writer-wins,
// which is acceptable for an observability snapshot; the monotonic totals
// below stay correct regardless of overlap.
// ─────────────────────────────────────────────────────────────────────────

/** Mirrors `optionSignals.ts`'s `TRIGGER_SWEEP_INTERVAL_MS`. Not imported
 * directly — `optionSignals.ts` already imports THIS module, so importing
 * back would risk a circular import for a single numeric constant. Keep the
 * two values in lockstep by comment if the sweep cadence ever changes. */
const EXIT_MONITOR_SWEEP_INTERVAL_MS = 30_000;

/**
 * Mutable per-cycle accumulator. Created fresh by `beginFnoExitMonitorCycle`
 * at the top of one `getOptionSignals()` invocation, threaded as an optional
 * parameter through both trust-gate call sites, and consumed exactly once by
 * `finalizeFnoExitMonitorCycle` at the end of that same invocation. Plain
 * object (not exported mutable state) so it is trivially unit-testable in
 * isolation, including two-accumulator interleaving.
 */
export interface FnoExitMonitorCycleAccumulator {
  openTradesScanned: number;
  quotesFetched: number;
  exitedCount: number;
  blockedCount: number;
  skippedCount: number;
  duplicateSkippedCount: number;
  staleDataCount: number;
  kiteUnavailableCount: number;
  blockedByReason: Record<FnoExitBlockedReason, number>;
  errors: number;
  startedAtMs: number;
  /** @internal dedup guard — same trade key checked twice in one cycle. */
  seenKeys: Set<string>;
}

export function beginFnoExitMonitorCycle(
  nowMs: number = Date.now(),
): FnoExitMonitorCycleAccumulator {
  return {
    openTradesScanned: 0,
    quotesFetched: 0,
    exitedCount: 0,
    blockedCount: 0,
    skippedCount: 0,
    duplicateSkippedCount: 0,
    staleDataCount: 0,
    kiteUnavailableCount: 0,
    blockedByReason: {
      CONTRACT_INVALID: 0,
      KITE_UNAVAILABLE: 0,
      SOURCE_NOT_TRADE_GRADE: 0,
      STALE_QUOTE: 0,
    },
    errors: 0,
    startedAtMs: nowMs,
    seenKeys: new Set(),
  };
}

function fnoExitTradeKeyString(key: FnoExitTradeKey): string {
  return "id" in key
    ? `id:${key.id}`
    : `${key.signalDate}|${key.indexSymbol}|${key.setupKey}|${key.direction}`;
}

/**
 * Call once per OPEN trade / signal actually EXAMINED for a potential exit
 * this cycle — regardless of whether the trust gate below fires. The gate
 * (`noteFnoExitMonitorDecision`) only runs when the underlying transition is
 * already an exit candidate, so most scanned rows never reach it; feeding
 * `openTradesScanned` from gate-only calls would badly undercount and
 * mislabel the field (this codebase's data-authenticity doctrine: never
 * name a counter as if it covers a wider population than it actually does).
 * No-op if `acc` is undefined (legacy/test call sites that don't pass one).
 */
export function noteFnoExitMonitorScan(
  acc: FnoExitMonitorCycleAccumulator | undefined,
  count = 1,
): void {
  if (!acc) return;
  acc.openTradesScanned += count;
}

/**
 * Record one trust-gate decision (BLOCKED / EXIT / HOLD) into the current
 * cycle's accumulator. Call this immediately beside every `recordFnoExitCheck`
 * call, with the SAME key/decision — never inferred independently, so the
 * counters can never drift from what was actually DB-stamped.
 *
 * HOLD is expected to be near-zero: both call sites only invoke the gate
 * when the underlying transition is already an exit candidate, so HOLD here
 * means the two `evaluateTransition` calls disagreed — pure defense-in-depth,
 * kept observable rather than silently dropped.
 */
export function noteFnoExitMonitorDecision(
  acc: FnoExitMonitorCycleAccumulator | undefined,
  key: FnoExitTradeKey,
  decision: FnoExitDecision,
): void {
  if (!acc) return;
  const k = fnoExitTradeKeyString(key);
  if (acc.seenKeys.has(k)) {
    acc.duplicateSkippedCount += 1;
    return;
  }
  acc.seenKeys.add(k);
  if (decision.quoteAsOfMs != null) acc.quotesFetched += 1;
  if (decision.kind === "EXIT") {
    acc.exitedCount += 1;
  } else if (decision.kind === "HOLD") {
    acc.skippedCount += 1;
  } else {
    acc.blockedCount += 1;
    acc.blockedByReason[decision.blockedReason] += 1;
    if (decision.blockedReason === "STALE_QUOTE") acc.staleDataCount += 1;
    if (decision.blockedReason === "KITE_UNAVAILABLE") acc.kiteUnavailableCount += 1;
  }
}

/** Record a row/cycle-level failure (e.g. the per-row try/catch in
 * `evaluateOrphanedOpenTrades`, or a `recordFnoExitCheck` stamp failure). */
export function noteFnoExitMonitorError(
  acc: FnoExitMonitorCycleAccumulator | undefined,
): void {
  if (!acc) return;
  acc.errors += 1;
}

export interface FnoExitMonitorCycleStats {
  checkedAt: string;
  openTradesScanned: number;
  quotesFetched: number;
  exitedCount: number;
  blockedCount: number;
  skippedCount: number;
  duplicateSkippedCount: number;
  staleDataCount: number;
  kiteUnavailableCount: number;
  blockedByReason: Record<FnoExitBlockedReason, number>;
  errors: number;
  durationMs: number;
  /** Scheduled next-sweep hint (`checkedAt + 30s`) — reflects the existing
   * cadence, NOT a guarantee (the next tick may be a cache hit, skipped
   * outside market hours, or delayed by a slow prior cycle). */
  nextRunAt: string;
}

export interface FnoExitMonitorHealth {
  cyclesTotal: number;
  exitedTotal: number;
  blockedTotal: number;
  errorsTotal: number;
  lastCycle: FnoExitMonitorCycleStats | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorClass: string | null;
  lastErrorMessage: string | null;
  bootedAt: string;
}

let exitMonitorCyclesTotal = 0;
let exitMonitorExitedTotal = 0;
let exitMonitorBlockedTotal = 0;
let exitMonitorErrorsTotal = 0;
let exitMonitorLastCycle: FnoExitMonitorCycleStats | null = null;
let exitMonitorLastSuccessAt: Date | null = null;
let exitMonitorLastErrorAt: Date | null = null;
let exitMonitorLastErrorClass: string | null = null;
let exitMonitorLastErrorMessage: string | null = null;
const exitMonitorBootedAt = new Date();

/**
 * Finalize one cycle's accumulator into the process-local health snapshot.
 * Call exactly once per `getOptionSignals()` invocation, after both
 * trust-gate call sites have run. `durationMs` is measured from the
 * accumulator's `startedAtMs` (set by `beginFnoExitMonitorCycle`) to `nowMs`.
 */
export function finalizeFnoExitMonitorCycle(
  acc: FnoExitMonitorCycleAccumulator,
  nowMs: number = Date.now(),
): FnoExitMonitorCycleStats {
  const stats: FnoExitMonitorCycleStats = {
    checkedAt: new Date(nowMs).toISOString(),
    openTradesScanned: acc.openTradesScanned,
    quotesFetched: acc.quotesFetched,
    exitedCount: acc.exitedCount,
    blockedCount: acc.blockedCount,
    skippedCount: acc.skippedCount,
    duplicateSkippedCount: acc.duplicateSkippedCount,
    staleDataCount: acc.staleDataCount,
    kiteUnavailableCount: acc.kiteUnavailableCount,
    blockedByReason: { ...acc.blockedByReason },
    errors: acc.errors,
    durationMs: Math.max(0, nowMs - acc.startedAtMs),
    nextRunAt: new Date(nowMs + EXIT_MONITOR_SWEEP_INTERVAL_MS).toISOString(),
  };
  exitMonitorCyclesTotal += 1;
  exitMonitorExitedTotal += stats.exitedCount;
  exitMonitorBlockedTotal += stats.blockedCount;
  exitMonitorErrorsTotal += stats.errors;
  exitMonitorLastCycle = stats;
  if (stats.errors > 0) {
    exitMonitorLastErrorAt = new Date(nowMs);
    exitMonitorLastErrorClass = "CycleError";
    exitMonitorLastErrorMessage = `${stats.errors} exit-monitor stamp/evaluation failure(s) this cycle`;
  }
  // The cycle itself completed even when some per-row stamps failed
  // (best-effort audit writes never abort the sweep) — mirrors
  // `getOrphanExitSweepHealth`'s "success" semantics.
  exitMonitorLastSuccessAt = new Date(nowMs);
  return stats;
}

export function getFnoExitMonitorHealth(): FnoExitMonitorHealth {
  return {
    cyclesTotal: exitMonitorCyclesTotal,
    exitedTotal: exitMonitorExitedTotal,
    blockedTotal: exitMonitorBlockedTotal,
    errorsTotal: exitMonitorErrorsTotal,
    lastCycle: exitMonitorLastCycle,
    lastSuccessAt: exitMonitorLastSuccessAt ? exitMonitorLastSuccessAt.toISOString() : null,
    lastErrorAt: exitMonitorLastErrorAt ? exitMonitorLastErrorAt.toISOString() : null,
    lastErrorClass: exitMonitorLastErrorClass,
    lastErrorMessage: exitMonitorLastErrorMessage,
    bootedAt: exitMonitorBootedAt.toISOString(),
  };
}

/** @internal Reset the process-local health counters for tests. */
export function __resetFnoExitMonitorHealthForTests(): void {
  exitMonitorCyclesTotal = 0;
  exitMonitorExitedTotal = 0;
  exitMonitorBlockedTotal = 0;
  exitMonitorErrorsTotal = 0;
  exitMonitorLastCycle = null;
  exitMonitorLastSuccessAt = null;
  exitMonitorLastErrorAt = null;
  exitMonitorLastErrorClass = null;
  exitMonitorLastErrorMessage = null;
}
