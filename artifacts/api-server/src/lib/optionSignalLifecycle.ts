import { db, optionSignalHistoryTable } from "@workspace/db";
import type { OptionSignalHistoryRow } from "@workspace/db";
import type { OptionSignal } from "@workspace/api-zod";
import { and, eq, gte, sql } from "drizzle-orm";
import { logger } from "./logger";
import {
  onLifecycleUpsert,
  closePaperTradeForSignal,
  reconcileOrphanedPaperTrades,
} from "./paperTradingFO";

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
  | "EXPIRED_PENDING"
  /**
   * Phase-1 quality gate: a PENDING row that has not been triggered
   * within `STALE_PENDING_MAX_MIN` minutes of generation is expired
   * intra-session. The level the trigger was drawn against is no
   * longer the level the market is trading around — keeping it open
   * just produces late entries that lose to drift.
   */
  | "STALE_TRIGGER";

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
   * Wall-clock time of the most recent lifecycle evaluation. Surfaced to
   * the UI so the user can see exactly when each plan was last checked
   * against live spot — trust signal that the trigger pipeline is alive.
   */
  lastEvaluatedAt: Date;
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
  /** Latest mid/last price (always present). */
  spot: number;
  /**
   * Last bar high — used to capture wick-based trigger / target hits when
   * the wick reached a level even if it didn't close there. OPTIONAL: when
   * the latest 15-min bar's high isn't available (e.g. the bar literally
   * just opened and Yahoo hasn't published an extreme yet), the lifecycle
   * conservatively falls back to `spot`. Falling back to spot is HONEST
   * (it's the price we know we observed) and SAFER than assuming a wick
   * that may not exist — trigger fires on real spot crossings, never on a
   * fabricated extreme.
   */
  high?: number;
  /** Last bar low — same semantics as `high` above. */
  low?: number;
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

  // When the bar's high/low are unknown, fall back to spot. This is NOT
  // synthetic data — it's the conservative envelope of what we actually
  // observed (`spot` itself is a real measurement). Trigger fires when
  // real spot reaches the level; we just don't claim a wick we can't see.
  const hi = Math.max(snap.high ?? snap.spot, snap.spot);
  const lo = Math.min(snap.low ?? snap.spot, snap.spot);

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
  // resolve conservatively WORST-CASE FOR THE TRADER: if a bar's range
  // covers BOTH the locked stop and a target, the stop wins. This rule
  // applies in BOTH the TRIGGERED and TARGET1_HIT states — a runner that
  // already hit T1 can still get stopped if price retraces to the locked
  // stop on the same or later bar (we do not auto-trail the stop on T1).
  const stopHit =
    direction === "BULLISH" ? lo <= stop : hi >= stop;
  const t1Hit =
    direction === "BULLISH" ? hi >= target1 : lo <= target1;
  const t2Hit =
    direction === "BULLISH" ? hi >= target2 : lo <= target2;

  if (stopHit) {
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
  // Same conservative envelope as evaluateTransition: when bar extremes
  // aren't known, the best we can claim is what spot has reached.
  const hi = snap.high ?? snap.spot;
  const lo = snap.low ?? snap.spot;
  if (direction === "BULLISH") {
    return {
      mfeBar: Math.max(0, hi - entry),
      maeBar: Math.max(0, entry - lo),
    };
  }
  return {
    mfeBar: Math.max(0, entry - lo),
    maeBar: Math.max(0, hi - entry),
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
        // Lock the option-premium plan AT GENERATION TIME so the alert
        // popup, the scoreboard and the paper-trade engine all see the
        // same numbers — the live option chain re-projects every poll
        // and would otherwise drift after the row was created.
        optionEntry: signal.optionEntry != null ? toDbNumeric(signal.optionEntry) : null,
        optionStopLoss: signal.optionStopLoss != null ? toDbNumeric(signal.optionStopLoss) : null,
        optionTarget1: signal.optionTarget1 != null ? toDbNumeric(signal.optionTarget1) : null,
        optionTarget2: signal.optionTarget2 != null ? toDbNumeric(signal.optionTarget2) : null,
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

      // Per-plan structured trace so the user can see exactly when each
      // setup was evaluated and why it did/didn't transition. Logged at
      // INFO so it's visible in deployment logs without bumping log level.
      logger.info(
        {
          phase: "lifecycle_insert",
          idx: signal.index,
          setup: signal.setupKey,
          dir: direction,
          entry,
          stop,
          t1,
          t2,
          spot: snapshot.spot,
          barHigh: snapshot.high ?? null,
          barLow: snapshot.low ?? null,
          before: "PENDING",
          after: init.next,
          triggered: init.triggered,
          exited: init.exited,
          exitReason: init.exitReason ?? null,
          inserted: inserted.length > 0,
          at: now.toISOString(),
        },
        "lifecycle insert",
      );

      if (inserted.length > 0) {
        // Paper trading hook — runs AFTER the lifecycle row is durably
        // persisted, so a hook crash can never leave a paper trade
        // referencing a signal that doesn't exist. `prev=null` because
        // this is the very first emission of this signal today.
        await onLifecycleUpsert({
          prev: null,
          next: init.next,
          exited: init.exited,
          signal,
          signalDate: date,
          direction,
        });
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
          lastEvaluatedAt: now,
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
        lastEvaluatedAt: row.lastEvaluatedAt,
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

    // Per-evaluation structured trace. Logged on every tick so we have a
    // complete audit trail of why a plan did or did not advance — the
    // missing diagnostic that made the "stuck on Waiting trigger" bug so
    // hard to chase down.
    logger.info(
      {
        phase: "lifecycle_eval",
        idx: signal.index,
        setup: signal.setupKey,
        dir: direction,
        entry: lockedEntry,
        stop: lockedStop,
        t1: lockedT1,
        t2: lockedT2,
        spot: snapshot.spot,
        barHigh: snapshot.high ?? null,
        barLow: snapshot.low ?? null,
        before: currentStatus,
        after: trans.next,
        triggered: trans.triggered,
        exited: trans.exited,
        exitReason: trans.exitReason ?? null,
        at: now.toISOString(),
      },
      "lifecycle eval",
    );
    // Local "best so far" view returned to *this* caller. Note the
    // value persisted to the DB below is computed atomically with
    // `GREATEST(...)`, not from this local snapshot — so two concurrent
    // evaluators can't clobber each other's high-water marks.
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
    //
    // Excursion fields use SQL `GREATEST` so two concurrent evaluators
    // racing on the same row can never lower the persisted MFE/MAE.
    // (Without this, a stale read of MFE=10 in caller A and MFE=10 in
    // caller B, where B observes a 15-pt favourable move and writes 15
    // and A then writes 12, would leave 12 in the DB and lose the peak.)
    //
    // Use `.returning()` so we can detect when the CAS guard rejected our
    // write (row count == 0). If that happens, a concurrent evaluator (or
    // the post-close sweep) already advanced the row — we MUST re-read
    // the persisted state and return THAT to the caller, otherwise the
    // card would render with our stale, locally computed `trans.next`
    // until the next 30s poll.
    // Refresh option-premium snapshot ONLY on PENDING → TRIGGERED transition.
    // Rationale: at first-emit (PENDING) we record a projection from the chain
    // at that moment, but spot can drift for hours before the trigger crosses
    // and the paper-trade engine enters at signal.optionEntry AS OF THE TRIGGER
    // tick. Re-snapping here keeps the popup, the lifecycle row and the paper
    // trade in lockstep — without this the alert popup would show stale prices
    // that don't match what the user actually paid.
    //
    // We do NOT refresh on any other transition (TRIGGERED → T1/T2/STOP/EXPIRED)
    // because once we're in the trade the locked entry/SL/T1/T2 plan is what
    // matters; recomputing would silently mutate the booked plan.
    const refreshOptionPremium =
      currentStatus === "PENDING" && trans.next === "TRIGGERED";
    const optionPremiumPatch = refreshOptionPremium
      ? {
          optionEntry:
            signal.optionEntry != null ? toDbNumeric(signal.optionEntry) : null,
          optionStopLoss:
            signal.optionStopLoss != null ? toDbNumeric(signal.optionStopLoss) : null,
          optionTarget1:
            signal.optionTarget1 != null ? toDbNumeric(signal.optionTarget1) : null,
          optionTarget2:
            signal.optionTarget2 != null ? toDbNumeric(signal.optionTarget2) : null,
        }
      : {};
    const updated = await db
      .update(optionSignalHistoryTable)
      .set({
        status: trans.next,
        triggeredAt,
        exitedAt,
        exitReason,
        exitPrice,
        maxFavorableExcursion: sql`GREATEST(${optionSignalHistoryTable.maxFavorableExcursion}, ${toDbNumeric(exc.mfeBar)}::numeric)`,
        maxAdverseExcursion: sql`GREATEST(${optionSignalHistoryTable.maxAdverseExcursion}, ${toDbNumeric(exc.maeBar)}::numeric)`,
        lastSpot: toDbNumeric(snapshot.spot),
        lastEvaluatedAt: now,
        ...optionPremiumPatch,
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
      )
      .returning();

    if (updated.length === 0) {
      // Concurrent writer (or sweep) advanced the row first. Re-read and
      // surface the persisted truth to the caller so the card never
      // reports a stale transition we computed locally.
      const fresh = await db
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
      const fr = fresh[0] ?? row;
      return {
        status: (fr.status as LifecycleStatus) ?? "PENDING",
        firstSeenAt: fr.generatedAt,
        triggeredAt: fr.triggeredAt ?? undefined,
        exitedAt: fr.exitedAt ?? undefined,
        exitReason: (fr.exitReason as LifecycleExitReason | null) ?? undefined,
        exitPrice: fr.exitPrice != null ? num(fr.exitPrice) : undefined,
        maxFavorableExcursionPts: round2(num(fr.maxFavorableExcursion)),
        maxAdverseExcursionPts: round2(num(fr.maxAdverseExcursion)),
        lastSpot: num(fr.lastSpot),
        lastEvaluatedAt: fr.lastEvaluatedAt,
        lockedEntry: num(fr.entry),
        lockedStopLoss: num(fr.stopLoss),
        lockedTarget1: num(fr.target1),
        lockedTarget2: num(fr.target2),
        lockedEntryTrigger: fr.entryTrigger,
      };
    }

    // Paper trading hook — only fired when WE successfully advanced
    // the row (CAS update returned a row above). The "fall-through to
    // re-read" branch intentionally does NOT call the hook because
    // the concurrent writer that won the CAS already invoked it.
    //
    // NOTE: the hook does MTM + close only.  Paper-trade OPENS are
    // handled by tryOpenPaperTrades() which runs AFTER option-premium
    // enrichment in the signal cycle (premiums are not yet available
    // at this point).
    await onLifecycleUpsert({
      prev: currentStatus,
      next: trans.next,
      exited: trans.exited,
      signal,
      signalDate: date,
      direction,
    });

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
      lastEvaluatedAt: now,
      lockedEntry,
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
 * Mark PENDING rows for today as EXPIRED with reason `STALE_TRIGGER` once
 * they have been waiting `maxAgeMin` minutes without a trigger fire.
 *
 * This runs intra-session (every signal cycle) and is the Phase-1 quality
 * gate against the dominant failure mode in the empirical loss sample:
 * a level drawn at 09:30 firing at 11:04 on a market that has long since
 * moved on. The trigger is "true" mechanically but no longer carries the
 * setup that justified it.
 *
 * Only PENDING rows are touched — anything that triggered already gets
 * resolved by the live spot evaluator and (eventually) the EOD sweep.
 */
export async function expireStalePendingSignals(
  maxAgeMin: number,
): Promise<number> {
  const date = istDateKey();
  const cutoff = new Date(Date.now() - maxAgeMin * 60 * 1000);
  try {
    const stale = await db
      .select()
      .from(optionSignalHistoryTable)
      .where(
        and(
          eq(optionSignalHistoryTable.signalDate, date),
          eq(optionSignalHistoryTable.status, "PENDING"),
          sql`${optionSignalHistoryTable.generatedAt} < ${cutoff}`,
        ),
      );
    if (stale.length === 0) return 0;
    const now = new Date();
    let settled = 0;
    for (const row of stale) {
      // Race-safe: only settle rows still PENDING with no exit recorded.
      // A trigger that fires between SELECT and UPDATE would change
      // status to TRIGGERED and the WHERE clause excludes it correctly.
      const updated = await db
        .update(optionSignalHistoryTable)
        .set({
          status: "EXPIRED",
          exitedAt: now,
          exitReason: "STALE_TRIGGER",
          // exitPrice intentionally null — no trade was opened.
          lastEvaluatedAt: now,
        })
        .where(
          and(
            eq(optionSignalHistoryTable.signalDate, row.signalDate),
            eq(optionSignalHistoryTable.indexSymbol, row.indexSymbol),
            eq(optionSignalHistoryTable.setupKey, row.setupKey),
            eq(optionSignalHistoryTable.direction, row.direction),
            eq(optionSignalHistoryTable.status, "PENDING"),
            sql`${optionSignalHistoryTable.exitedAt} IS NULL`,
          ),
        )
        .returning();
      if (updated.length > 0) settled++;
    }
    if (settled > 0) {
      logger.info(
        { settled, maxAgeMin },
        "expireStalePendingSignals: stale PENDING rows expired",
      );
    }
    return settled;
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "expireStalePendingSignals failed",
    );
    return 0;
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
      const settled = await db
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
        )
        .returning();

      // Mirror the lifecycle settlement into paper trading. Only fire
      // if WE actually owned the settlement write (settled.length > 0)
      // and only if the row had triggered (no paper trade exists for
      // PENDING-only signals). T1 runners settle at T1; full EXPIRED
      // close at lastPremium fallback.
      if (settled.length > 0 && row.triggeredAt) {
        const reasonForPaper = row.status === "TARGET1_HIT" ? "TARGET1_HIT" : "EXPIRED";
        const dir: "BULLISH" | "BEARISH" =
          row.direction === "BEARISH" ? "BEARISH" : "BULLISH";
        await closePaperTradeForSignal(
          row.signalDate,
          row.indexSymbol,
          row.setupKey,
          dir,
          reasonForPaper,
        );
      }
    }
    // Final safety net: any paper trade still OPEN whose lifecycle row
    // is now terminal (e.g. because a previous lifecycle hook fired
    // before we existed, or one crashed) — close it now using the
    // proper exit reason from the lifecycle, never lastPremium fallback.
    try {
      await reconcileOrphanedPaperTrades();
    } catch (err) {
      logger.warn(
        { err: (err as Error).message },
        "reconcileOrphanedPaperTrades after EOD sweep failed (continuing)",
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
  /** Locked option-premium plan (nullable when chain was unavailable). */
  optionEntry: number | null;
  optionStopLoss: number | null;
  optionTarget1: number | null;
  optionTarget2: number | null;
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
    optionEntry: r.optionEntry != null ? round2(num(r.optionEntry)) : null,
    optionStopLoss: r.optionStopLoss != null ? round2(num(r.optionStopLoss)) : null,
    optionTarget1: r.optionTarget1 != null ? round2(num(r.optionTarget1)) : null,
    optionTarget2: r.optionTarget2 != null ? round2(num(r.optionTarget2)) : null,
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

/** History for a specific IST trading date, sorted newest first. */
export async function getHistoryByDate(date: string): Promise<HistoryRow[]> {
  try {
    const rows = await db
      .select()
      .from(optionSignalHistoryTable)
      .where(eq(optionSignalHistoryTable.signalDate, date));
    return rows
      .map(toHistoryRow)
      .sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime());
  } catch (err) {
    logger.warn({ err: (err as Error).message, date }, "getHistoryByDate failed");
    return [];
  }
}

/** History for a month (YYYY-MM), sorted newest first. */
export async function getHistoryByMonth(month: string): Promise<HistoryRow[]> {
  const startDate = `${month}-01`;
  const [y, m] = month.split("-").map(Number) as [number, number];
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  const endDate = `${nextMonth}-01`;
  try {
    const rows = await db
      .select()
      .from(optionSignalHistoryTable)
      .where(
        and(
          gte(optionSignalHistoryTable.signalDate, startDate),
          sql`${optionSignalHistoryTable.signalDate} < ${endDate}`,
        ),
      );
    return rows
      .map(toHistoryRow)
      .sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime());
  } catch (err) {
    logger.warn({ err: (err as Error).message, month }, "getHistoryByMonth failed");
    return [];
  }
}

/** Get all distinct signal dates that have data, sorted descending. */
export async function getAvailableSignalDates(): Promise<string[]> {
  try {
    const rows = await db
      .selectDistinct({ signalDate: optionSignalHistoryTable.signalDate })
      .from(optionSignalHistoryTable)
      .orderBy(sql`${optionSignalHistoryTable.signalDate} DESC`)
      .limit(365);
    return rows.map((r) => r.signalDate);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "getAvailableSignalDates failed");
    return [];
  }
}

/**
 * Batch-update lifecycle rows with option premiums computed by
 * enrichBundlesWithOptionLevels().  The lifecycle INSERT and the
 * PENDING→TRIGGERED refresh both run BEFORE enrichment, so premiums
 * are always null at write time.  This back-fill runs AFTER enrichment
 * and patches every row that still has null optionEntry.
 *
 * Only updates rows for the current IST date (today's signals).
 */
export async function persistOptionPremiums(
  signals: OptionSignal[],
): Promise<void> {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const today = ist.toISOString().slice(0, 10);

  for (const s of signals) {
    if (s.optionEntry == null) continue;
    const direction: "BULLISH" | "BEARISH" =
      s.bias === "BEARISH" ? "BEARISH" : "BULLISH";
    try {
      await db
        .update(optionSignalHistoryTable)
        .set({
          optionEntry: toDbNumeric(s.optionEntry),
          optionStopLoss: s.optionStopLoss != null ? toDbNumeric(s.optionStopLoss) : null,
          optionTarget1: s.optionTarget1 != null ? toDbNumeric(s.optionTarget1) : null,
          optionTarget2: s.optionTarget2 != null ? toDbNumeric(s.optionTarget2) : null,
        })
        .where(
          and(
            eq(optionSignalHistoryTable.signalDate, today),
            eq(optionSignalHistoryTable.indexSymbol, s.index),
            eq(optionSignalHistoryTable.setupKey, s.setupKey ?? ""),
            eq(optionSignalHistoryTable.direction, direction),
            sql`${optionSignalHistoryTable.optionEntry} IS NULL`,
          ),
        );
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, idx: s.index, setup: s.setupKey },
        "persistOptionPremiums: failed for one row",
      );
    }
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
