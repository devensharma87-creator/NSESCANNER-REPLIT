import { db, optionSignalHistoryTable } from "@workspace/db";
import type { OptionSignalHistoryRow } from "@workspace/db";
import type { OptionSignal } from "@workspace/api-zod";
import { and, eq, gte, sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Signal lifecycle tracker.
 *
 * Persists every emitted option signal to `option_signal_history` keyed by
 * (signalDate, indexSymbol, setupKey, direction) — the same composite key as
 * the in-memory session lock store in optionSignals.ts. On every refresh the
 * row is re-evaluated against the latest spot/bar high/low so the card can
 * show whether the trade is still pending, has triggered, hit a target, or
 * was stopped out.
 *
 * Status machine:
 *   PENDING        → first emit, spot has not crossed entry yet
 *   TRIGGERED      → spot crossed entry (in trade direction)
 *   TARGET1_HIT    → spot reached T1 after triggering
 *   TARGET2_HIT    → spot reached T2 after triggering (terminal)
 *   STOPPED        → spot hit stop after triggering (terminal)
 *   EXPIRED        → 15:30 IST reached without resolution (terminal)
 *
 * Levels are FROZEN — never recomputed once the row exists. Only status,
 * MFE, MAE, lastSpot and timestamps update.
 */

export type LifecycleStatus =
  | "PENDING"
  | "TRIGGERED"
  | "TARGET1_HIT"
  | "TARGET2_HIT"
  | "STOPPED"
  | "EXPIRED";

export type LifecycleExitReason =
  | "TARGET1_HIT"
  | "TARGET2_HIT"
  | "STOPPED"
  | "EXPIRED_TRIGGERED"
  | "EXPIRED_PENDING";

export interface LifecycleFields {
  status: LifecycleStatus;
  firstSeenAt: Date;
  triggeredAt?: Date;
  exitedAt?: Date;
  exitReason?: LifecycleExitReason;
  exitPrice?: number;
  maxFavorableExcursionPts: number;
  maxAdverseExcursionPts: number;
  lastSpot: number;
  /**
   * The locked levels that are persisted in the DB row. After a server
   * restart the in-process lockStore is empty, so the caller must use
   * THESE values (not freshly recomputed ones) to render the signal —
   * otherwise entry/SL/T1/T2 would silently drift from the persisted
   * trade plan, breaking the “levels never mutate” guarantee.
   */
  lockedEntry: number;
  lockedStopLoss: number;
  lockedTarget1: number;
  lockedTarget2: number;
  lockedEntryTrigger: string | null;
}

export interface SpotSnapshot {
  /** Latest mid/last price */
  spot: number;
  /** Last bar high (so a wick that touched the level is captured) */
  high: number;
  /** Last bar low */
  low: number;
}

function istDateKey(d: Date = new Date()): string {
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function nowIstMinutes(d: Date = new Date()): number {
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

function isAfterClose(d: Date = new Date()): boolean {
  // NSE equity session ends 15:30 IST.
  return nowIstMinutes(d) >= 15 * 60 + 30;
}

const TERMINAL: LifecycleStatus[] = [
  "TARGET2_HIT",
  "STOPPED",
  "EXPIRED",
];
function isTerminal(s: LifecycleStatus): boolean {
  return TERMINAL.includes(s);
}

function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : parseFloat(v);
}

function toDbNumeric(n: number): string {
  return Number.isFinite(n) ? n.toString() : "0";
}

/**
 * Decide the next status given the current status, locked levels, trade
 * direction, and the latest bar's high/low + spot. Uses bar high/low so a
 * wick that touched a level still counts as a hit.
 */
function evaluateTransition(
  current: LifecycleStatus,
  direction: "BULLISH" | "BEARISH",
  entry: number,
  stop: number,
  target1: number,
  target2: number,
  snap: SpotSnapshot,
): {
  next: LifecycleStatus;
  triggered: boolean;
  exited: boolean;
  exitReason?: LifecycleExitReason;
  exitPrice?: number;
} {
  if (isTerminal(current)) {
    return { next: current, triggered: false, exited: false };
  }

  const hi = Math.max(snap.high, snap.spot);
  const lo = Math.min(snap.low, snap.spot);

  // Step 1: figure out whether we've triggered.
  let next: LifecycleStatus = current;
  let triggered = false;
  if (current === "PENDING") {
    const justTriggered =
      direction === "BULLISH" ? hi >= entry : lo <= entry;
    if (justTriggered) {
      next = "TRIGGERED";
      triggered = true;
    } else {
      return { next, triggered: false, exited: false };
    }
  }

  // Step 2: if triggered (just now or earlier), check for stop / target hits.
  // Order of evaluation is unavoidably ambiguous within a single bar — we
  // resolve conservatively: if a bar's range covers BOTH the stop and a
  // target, we count the STOP first (worst-case for the trader).
  const stopHit =
    direction === "BULLISH" ? lo <= stop : hi >= stop;
  const t1Hit =
    direction === "BULLISH" ? hi >= target1 : lo <= target1;
  const t2Hit =
    direction === "BULLISH" ? hi >= target2 : lo <= target2;

  if (stopHit && next !== "TARGET1_HIT" && next !== "TARGET2_HIT") {
    return {
      next: "STOPPED",
      triggered,
      exited: true,
      exitReason: "STOPPED",
      exitPrice: stop,
    };
  }
  if (t2Hit && (next === "TRIGGERED" || next === "TARGET1_HIT")) {
    return {
      next: "TARGET2_HIT",
      triggered,
      exited: true,
      exitReason: "TARGET2_HIT",
      exitPrice: target2,
    };
  }
  if (t1Hit && next === "TRIGGERED") {
    // T1 hit but T2 not yet — the trade is still alive (runner targeting T2).
    return { next: "TARGET1_HIT", triggered, exited: false };
  }
  return { next, triggered, exited: false };
}

/** Compute MFE/MAE deltas from this bar versus entry, in the trade direction. */
function bestExcursions(
  direction: "BULLISH" | "BEARISH",
  entry: number,
  snap: SpotSnapshot,
): { mfeBar: number; maeBar: number } {
  if (direction === "BULLISH") {
    return {
      mfeBar: Math.max(0, snap.high - entry),
      maeBar: Math.max(0, entry - snap.low),
    };
  }
  return {
    mfeBar: Math.max(0, entry - snap.low),
    maeBar: Math.max(0, snap.high - entry),
  };
}

interface RecordInput {
  signal: OptionSignal;
  snapshot: SpotSnapshot;
}

/**
 * Upsert this signal's lifecycle row and return the augmented fields the
 * card needs to render. Best-effort — DB failures are logged but never
 * crash signal generation.
 */
export async function recordOrUpdate(
  input: RecordInput,
): Promise<LifecycleFields | null> {
  const { signal, snapshot } = input;
  if (!signal.setupKey) return null;
  const direction = signal.bias === "BEARISH" ? "BEARISH" : "BULLISH";
  const date = istDateKey();
  const entry = signal.leg.entry;
  const stop = signal.leg.stopLoss;
  const t1 = signal.leg.target1;
  const t2 = signal.leg.target2 ?? signal.leg.target1;
  const now = new Date();

  try {
    const existing = await db
      .select()
      .from(optionSignalHistoryTable)
      .where(
        and(
          eq(optionSignalHistoryTable.signalDate, date),
          eq(optionSignalHistoryTable.indexSymbol, signal.index),
          eq(optionSignalHistoryTable.setupKey, signal.setupKey),
          eq(optionSignalHistoryTable.direction, direction),
        ),
      )
      .limit(1);

    if (existing.length === 0) {
      // First emission — try an atomic insert. If a concurrent request
      // beat us to it, ON CONFLICT DO NOTHING returns no row and we fall
      // through to the update branch below.
      const init = evaluateTransition(
        "PENDING",
        direction,
        entry,
        stop,
        t1,
        t2,
        snapshot,
      );
      const exc = init.next === "PENDING"
        ? { mfeBar: 0, maeBar: 0 }
        : bestExcursions(direction, entry, snapshot);
      const insertRow = {
        signalDate: date,
        indexSymbol: signal.index,
        setupKey: signal.setupKey,
        direction,
        indexName: signal.indexName,
        strike: toDbNumeric(signal.leg.strike),
        optionType: signal.leg.type,
        entry: toDbNumeric(entry),
        stopLoss: toDbNumeric(stop),
        target1: toDbNumeric(t1),
        target2: toDbNumeric(t2),
        entryTrigger: signal.entryTrigger ?? null,
        confidence: Math.round(signal.confidence ?? 0),
        tier: signal.tier ?? null,
        setupName: signal.setupName ?? null,
        generatedAt: now,
        status: init.next,
        triggeredAt: init.triggered ? now : null,
        exitedAt: init.exited ? now : null,
        exitReason: init.exitReason ?? null,
        exitPrice: init.exitPrice != null ? toDbNumeric(init.exitPrice) : null,
        maxFavorableExcursion: toDbNumeric(exc.mfeBar),
        maxAdverseExcursion: toDbNumeric(exc.maeBar),
        lastSpot: toDbNumeric(snapshot.spot),
        lastEvaluatedAt: now,
      } as const;
      const inserted = await db
        .insert(optionSignalHistoryTable)
        .values(insertRow)
        .onConflictDoNothing()
        .returning();

      if (inserted.length > 0) {
        return {
          status: init.next,
          firstSeenAt: now,
          triggeredAt: init.triggered ? now : undefined,
          exitedAt: init.exited ? now : undefined,
          exitReason: init.exitReason,
          exitPrice: init.exitPrice,
          maxFavorableExcursionPts: round2(exc.mfeBar),
          maxAdverseExcursionPts: round2(exc.maeBar),
          lastSpot: snapshot.spot,
          lockedEntry: entry,
          lockedStopLoss: stop,
          lockedTarget1: t1,
          lockedTarget2: t2,
          lockedEntryTrigger: signal.entryTrigger ?? null,
        };
      }
      // Fall through: a concurrent request inserted first. Re-read it.
      existing.push(
        ...(await db
          .select()
          .from(optionSignalHistoryTable)
          .where(
            and(
              eq(optionSignalHistoryTable.signalDate, date),
              eq(optionSignalHistoryTable.indexSymbol, signal.index),
              eq(optionSignalHistoryTable.setupKey, signal.setupKey),
              eq(optionSignalHistoryTable.direction, direction),
            ),
          )
          .limit(1)),
      );
      if (existing.length === 0) return null; // shouldn't happen
    }

    const row = existing[0]!;
    const currentStatus = (row.status as LifecycleStatus) ?? "PENDING";

    // Re-evaluate using the LOCKED levels stored on the row, never the new
    // levels coming from the live signal — those should already be locked
    // upstream, but we defensively use the row's values.
    const lockedEntry = num(row.entry);
    const lockedStop = num(row.stopLoss);
    const lockedT1 = num(row.target1);
    const lockedT2 = num(row.target2);

    // Once a row has an exitedAt set, it is IMMUTABLE — the trade is over.
    // This includes terminal statuses (STOPPED, TARGET2_HIT, EXPIRED) AND
    // TARGET1_HIT runners that the post-close sweep has already settled.
    // Without this guard, a late /options/signals call after market close
    // could re-advance a TARGET1_HIT row to TARGET2_HIT while keeping the
    // sweep-written exitReason/exitPrice — producing an internally
    // inconsistent terminal record.
    if (row.exitedAt) {
      return {
        status: currentStatus,
        firstSeenAt: row.generatedAt,
        triggeredAt: row.triggeredAt ?? undefined,
        exitedAt: row.exitedAt,
        exitReason: (row.exitReason as LifecycleExitReason | null) ?? undefined,
        exitPrice: row.exitPrice != null ? num(row.exitPrice) : undefined,
        maxFavorableExcursionPts: round2(num(row.maxFavorableExcursion)),
        maxAdverseExcursionPts: round2(num(row.maxAdverseExcursion)),
        lastSpot: num(row.lastSpot),
        lockedEntry,
        lockedStopLoss: lockedStop,
        lockedTarget1: lockedT1,
        lockedTarget2: lockedT2,
        lockedEntryTrigger: row.entryTrigger,
      };
    }
    const trans = evaluateTransition(
      currentStatus,
      direction,
      lockedEntry,
      lockedStop,
      lockedT1,
      lockedT2,
      snapshot,
    );
    const exc = bestExcursions(direction, lockedEntry, snapshot);
    const newMfe = Math.max(num(row.maxFavorableExcursion), exc.mfeBar);
    const newMae = Math.max(num(row.maxAdverseExcursion), exc.maeBar);

    const triggeredAt = row.triggeredAt ?? (trans.triggered ? now : null);
    const exitedAt = row.exitedAt ?? (trans.exited ? now : null);
    const exitReason = row.exitReason ?? trans.exitReason ?? null;
    const exitPrice =
      row.exitPrice ?? (trans.exitPrice != null ? toDbNumeric(trans.exitPrice) : null);

    // Race-safe (compare-and-swap) update: only apply our changes if the
    // row's status hasn't been moved by a concurrent evaluator since we
    // read it. Without this guard, a stale evaluator could regress a
    // newer terminal state (e.g. overwrite STOPPED with TRIGGERED).
    // If the conditional update touches 0 rows, that means another
    // evaluator already advanced the row — fine, the next refresh
    // (30s later) will re-read and reconcile.
    await db
      .update(optionSignalHistoryTable)
      .set({
        status: trans.next,
        triggeredAt,
        exitedAt,
        exitReason,
        exitPrice,
        maxFavorableExcursion: toDbNumeric(newMfe),
        maxAdverseExcursion: toDbNumeric(newMae),
        lastSpot: toDbNumeric(snapshot.spot),
        lastEvaluatedAt: now,
      })
      .where(
        and(
          eq(optionSignalHistoryTable.signalDate, date),
          eq(optionSignalHistoryTable.indexSymbol, signal.index),
          eq(optionSignalHistoryTable.setupKey, signal.setupKey),
          eq(optionSignalHistoryTable.direction, direction),
          eq(optionSignalHistoryTable.status, currentStatus),
          // exitedAt-immutability: the post-close sweep settles T1 runners
          // by setting exitedAt while keeping status=TARGET1_HIT. Pinning
          // exitedAt IS NULL here closes the last TOCTOU race — a stale
          // evaluator that read pre-sweep state cannot re-advance the row
          // (e.g. T1 → T2) and clobber sweep semantics.
          sql`${optionSignalHistoryTable.exitedAt} IS NULL`,
        ),
      );

    return {
      status: trans.next,
      firstSeenAt: row.generatedAt,
      triggeredAt: triggeredAt ?? undefined,
      exitedAt: exitedAt ?? undefined,
      exitReason: (exitReason as LifecycleExitReason | null) ?? undefined,
      exitPrice: exitPrice != null ? num(exitPrice) : undefined,
      maxFavorableExcursionPts: round2(newMfe),
      maxAdverseExcursionPts: round2(newMae),
      lastSpot: snapshot.spot,
      // Source of truth for locked levels — survives server restarts.
      lockedEntry: lockedEntry,
      lockedStopLoss: lockedStop,
      lockedTarget1: lockedT1,
      lockedTarget2: lockedT2,
      lockedEntryTrigger: row.entryTrigger,
    };
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, idx: signal.index, setup: signal.setupKey },
      "Lifecycle recordOrUpdate failed",
    );
    return null;
  }
}

/**
 * Mark all non-terminal rows for today as EXPIRED. Should be called once
 * after market close. Cheap to call repeatedly — the WHERE clause filters
 * out terminal rows so subsequent calls are no-ops.
 */
export async function expireOpenSignalsForToday(): Promise<number> {
  if (!isAfterClose()) return 0;
  const date = istDateKey();
  try {
    // Open = no terminal status AND no recorded exit. T1_HIT runners that
    // already had their settlement written by a previous sweep have an
    // exitedAt set, so this filter naturally excludes them on subsequent
    // calls — making this method idempotent.
    const open = await db
      .select()
      .from(optionSignalHistoryTable)
      .where(
        and(
          eq(optionSignalHistoryTable.signalDate, date),
          sql`${optionSignalHistoryTable.status} NOT IN ('TARGET2_HIT','STOPPED','EXPIRED')`,
          sql`${optionSignalHistoryTable.exitedAt} IS NULL`,
        ),
      );
    if (open.length === 0) return 0;
    const now = new Date();
    for (const row of open) {
      const reason: LifecycleExitReason = row.triggeredAt
        ? "EXPIRED_TRIGGERED"
        : "EXPIRED_PENDING";
      // T1_HIT runners that didn't reach T2 settle at T1 (locked partial win).
      const exitPriceForT1 = row.status === "TARGET1_HIT" ? row.target1 : row.lastSpot;
      // Race-safe: only settle if no one else has settled this row in
      // the meantime. Pinning both `status` and `exitedAt IS NULL`
      // prevents the sweep from clobbering a fresh terminal outcome
      // (e.g. a TARGET2_HIT or STOPPED that landed on the very last bar).
      await db
        .update(optionSignalHistoryTable)
        .set({
          status: row.status === "TARGET1_HIT" ? "TARGET1_HIT" : "EXPIRED",
          exitedAt: now,
          exitReason: reason,
          exitPrice: exitPriceForT1,
          lastEvaluatedAt: now,
        })
        .where(
          and(
            eq(optionSignalHistoryTable.signalDate, row.signalDate),
            eq(optionSignalHistoryTable.indexSymbol, row.indexSymbol),
            eq(optionSignalHistoryTable.setupKey, row.setupKey),
            eq(optionSignalHistoryTable.direction, row.direction),
            eq(optionSignalHistoryTable.status, row.status),
            sql`${optionSignalHistoryTable.exitedAt} IS NULL`,
          ),
        );
    }
    return open.length;
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "expireOpenSignalsForToday failed",
    );
    return 0;
  }
}

export interface HistoryRow {
  signalDate: string;
  indexSymbol: string;
  indexName: string;
  setupKey: string;
  setupName: string | null;
  direction: "BULLISH" | "BEARISH";
  optionType: string;
  strike: number;
  entry: number;
  stopLoss: number;
  target1: number;
  target2: number;
  entryTrigger: string | null;
  confidence: number;
  tier: string | null;
  status: LifecycleStatus;
  generatedAt: Date;
  triggeredAt: Date | null;
  exitedAt: Date | null;
  exitReason: LifecycleExitReason | null;
  exitPrice: number | null;
  maxFavorableExcursionPts: number;
  maxAdverseExcursionPts: number;
  lastSpot: number;
  lastEvaluatedAt: Date;
}

function toHistoryRow(r: OptionSignalHistoryRow): HistoryRow {
  return {
    signalDate: r.signalDate,
    indexSymbol: r.indexSymbol,
    indexName: r.indexName,
    setupKey: r.setupKey,
    setupName: r.setupName,
    direction: (r.direction === "BEARISH" ? "BEARISH" : "BULLISH"),
    optionType: r.optionType,
    strike: num(r.strike),
    entry: num(r.entry),
    stopLoss: num(r.stopLoss),
    target1: num(r.target1),
    target2: num(r.target2),
    entryTrigger: r.entryTrigger,
    confidence: r.confidence,
    tier: r.tier,
    status: (r.status as LifecycleStatus) ?? "PENDING",
    generatedAt: r.generatedAt,
    triggeredAt: r.triggeredAt,
    exitedAt: r.exitedAt,
    exitReason: r.exitReason as LifecycleExitReason | null,
    exitPrice: r.exitPrice != null ? num(r.exitPrice) : null,
    maxFavorableExcursionPts: round2(num(r.maxFavorableExcursion)),
    maxAdverseExcursionPts: round2(num(r.maxAdverseExcursion)),
    lastSpot: num(r.lastSpot),
    lastEvaluatedAt: r.lastEvaluatedAt,
  };
}

/** All rows for today's IST trading date, sorted newest first. */
export async function getTodayHistory(): Promise<HistoryRow[]> {
  const date = istDateKey();
  try {
    const rows = await db
      .select()
      .from(optionSignalHistoryTable)
      .where(eq(optionSignalHistoryTable.signalDate, date));
    return rows
      .map(toHistoryRow)
      .sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime());
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "getTodayHistory failed");
    return [];
  }
}

/** Last N days (default 7) of history, sorted newest first. */
export async function getRecentHistory(days = 7): Promise<HistoryRow[]> {
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);
  const cutoffKey = istDateKey(cutoff);
  try {
    const rows = await db
      .select()
      .from(optionSignalHistoryTable)
      .where(gte(optionSignalHistoryTable.signalDate, cutoffKey));
    return rows
      .map(toHistoryRow)
      .sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime());
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "getRecentHistory failed");
    return [];
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
