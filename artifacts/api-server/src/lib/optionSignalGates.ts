import { db, optionSignalHistoryTable } from "@workspace/db";
import { and, eq, sql, gte } from "drizzle-orm";
import { logger } from "./logger";
import { fetchKiteIntraday } from "./kiteIntraday";
import type { OptionSignal } from "@workspace/api-zod";

/**
 * Phase 1 quality gates for the F&O signal engine.
 *
 * The detector loop in optionSignals.ts is responsible for finding setups
 * from price-action / indicators. THIS module is responsible for the
 * session-wide rules that can SUPPRESS an otherwise-valid setup because
 * of context the detector cannot see (consecutive losses, correlated
 * exposure across indices, recent stop on the same index, OI mass on
 * the wrong side, VIX shock).
 *
 * The thresholds are deliberately conservative: on a bad tape we would
 * rather skip a marginal trade than keep adding to a losing day. They
 * were tuned to the empirical 14-day sample where 53 outcomes produced
 * 1 winner — every gate here addresses a specific failure pattern from
 * that sample.
 */

// --- thresholds (single source of truth, exported for tests / UI) ---

/** PENDING rows older than this are expired with reason `STALE_TRIGGER`.
 *  An intraday level priced at 09:30 has effectively no edge by 11:00 —
 *  the market context that drew it has already moved on. */
export const STALE_PENDING_MAX_MIN = 45;

/** Hard stop on the day after this many STOPPED outcomes. New
 *  high-conviction signals are suppressed for the rest of the session. */
export const DAILY_STOP_LIMIT = 2;

/** After a STOPPED outcome on an index, opposite-direction signals on
 *  the same index are suppressed for this many minutes. Stops a fresh
 *  loser from being chased by an immediate bias-flip. */
export const BIAS_FLIP_COOLDOWN_MIN = 45;

/** VWAP_RECLAIM specifically targets the move FROM reclaim TO pivot R1/R2,
 *  which empirically takes >2 hours. Firing one after 13:30 IST gives the
 *  trade <2 hours of session — every reclaim in the loss sample fired
 *  after 13:30 and timed out. */
export const VWAP_RECLAIM_LATE_CUTOFF_IST_MIN = 13 * 60 + 30;

/** Magnitude of |sentimentScore| (from oiLab) above which an OI conflict
 *  is treated as a hard veto rather than a confidence haircut. 30 was the
 *  median |score| of the conflicting sessions in the loss sample. */
export const OI_VETO_THRESHOLD = 30;

/** India VIX % move from session open above which we suppress all new
 *  high-conviction emission. Sharp intraday vol expansion typically means
 *  every directional plan is about to be overwhelmed by panic flow. */
export const VIX_INTRADAY_SPIKE_PCT = 5;

/** India VIX % move vs prior close (cross-session). Catches cases where
 *  the spike happened gap-up at the open and so the intraday-from-open
 *  metric reads ~0 even though the day is on fire. */
export const VIX_DAY_SPIKE_PCT = 7;

// --- bucket definitions for correlated-exposure suppression ---

/** Indices that move together. Exposure to more than one in the same
 *  direction is effectively the same trade — historically every
 *  multi-bucket loss day in the sample had 4-6 cards firing the same
 *  bias on this group. */
const BROAD_INDEX_BUCKET = new Set(["NIFTY", "SENSEX", "MIDCPNIFTY"]);
const BANK_INDEX_BUCKET = new Set(["BANKNIFTY", "BANKEX", "FINNIFTY"]);

function bucketOf(indexSymbol: string): "BROAD" | "BANK" | null {
  if (BROAD_INDEX_BUCKET.has(indexSymbol)) return "BROAD";
  if (BANK_INDEX_BUCKET.has(indexSymbol)) return "BANK";
  return null;
}

// --- types ---

export interface VixSnapshot {
  /** % change vs first bar of the current session (intraday move). */
  intradayPct: number | null;
  /** % change vs prior daily close (cross-session move). */
  dayPct: number | null;
  /** True if any threshold tripped. */
  spike: boolean;
  /** Human-readable reason describing which threshold tripped. */
  reason: string | null;
}

export interface RecentStop {
  indexSymbol: string;
  direction: "BULLISH" | "BEARISH";
  exitedAt: Date;
  /** Minutes since the stop, computed at GateContext load time. */
  minutesAgo: number;
}

export interface GateContext {
  /** Total STOPPED rows for today's IST date across all indices. */
  stoppedToday: number;
  /** True when stoppedToday >= DAILY_STOP_LIMIT — kills new HC emission. */
  circuitBreakerActive: boolean;
  /** Most recent stop per index symbol, regardless of how long ago.
   *  Callers compare `minutesAgo` to BIAS_FLIP_COOLDOWN_MIN themselves. */
  recentStopsByIndex: Map<string, RecentStop>;
  vix: VixSnapshot;
  /** True iff any global suppression (circuit breaker OR VIX spike) is on.
   *  Per-index gates (bias flip) are NOT folded into this. */
  globalSuppress: boolean;
  /** Human-readable lines describing every active gate. UI banner reads
   *  these verbatim, so they should be plain English. */
  notes: string[];
}

export interface CorrelationResult {
  kept: OptionSignal[];
  dropped: Array<{ signal: OptionSignal; reason: string }>;
}

// --- helpers ---

function istDateKey(d: Date = new Date()): string {
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function minutesBetween(a: Date, b: Date): number {
  return Math.max(0, (b.getTime() - a.getTime()) / 60000);
}

// --- DB queries ---

async function loadStoppedTodayCount(): Promise<number> {
  const date = istDateKey();
  try {
    const rows = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(optionSignalHistoryTable)
      .where(
        and(
          eq(optionSignalHistoryTable.signalDate, date),
          eq(optionSignalHistoryTable.status, "STOPPED"),
        ),
      );
    const n = rows[0]?.n;
    // drizzle returns COUNT as string in some drivers; coerce defensively.
    return typeof n === "number" ? n : Number(n ?? 0);
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "loadStoppedTodayCount: query failed; circuit breaker disarmed",
    );
    return 0;
  }
}

async function loadRecentStopsByIndex(
  withinMin: number,
): Promise<Map<string, RecentStop>> {
  const date = istDateKey();
  const cutoff = new Date(Date.now() - withinMin * 60 * 1000);
  const out = new Map<string, RecentStop>();
  try {
    // Pull every stop for today, then filter / pick newest per index in
    // memory. The history table is small per-day (<200 rows) so a SELECT *
    // is cheaper than a window function and keeps the query portable.
    const rows = await db
      .select()
      .from(optionSignalHistoryTable)
      .where(
        and(
          eq(optionSignalHistoryTable.signalDate, date),
          eq(optionSignalHistoryTable.status, "STOPPED"),
          gte(optionSignalHistoryTable.exitedAt, cutoff),
        ),
      );
    for (const r of rows) {
      if (!r.exitedAt) continue;
      const dir: "BULLISH" | "BEARISH" =
        r.direction === "BEARISH" ? "BEARISH" : "BULLISH";
      const prev = out.get(r.indexSymbol);
      if (!prev || r.exitedAt.getTime() > prev.exitedAt.getTime()) {
        out.set(r.indexSymbol, {
          indexSymbol: r.indexSymbol,
          direction: dir,
          exitedAt: r.exitedAt,
          minutesAgo: minutesBetween(r.exitedAt, new Date()),
        });
      }
    }
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "loadRecentStopsByIndex: query failed; bias-flip cooldown disabled",
    );
  }
  return out;
}

// --- VIX ---

async function loadVixSnapshot(): Promise<VixSnapshot> {
  // KITE-ONLY (2026-05-06): Yahoo no longer permitted anywhere in F&O.
  // Try Kite intraday first (15-min real-time) for the intraday move,
  // and Kite daily for the cross-session move. If Kite cannot serve VIX
  // we return spike:false — the gate becomes a no-op rather than a
  // false trip; never fabricate.
  const empty: VixSnapshot = {
    intradayPct: null,
    dayPct: null,
    spike: false,
    reason: null,
  };

  let intradayPct: number | null = null;
  try {
    const bars = await fetchKiteIntraday("^INDIAVIX", "15minute", 2);
    if (bars && bars.timestamps.length >= 2) {
      // Restrict to the most recent IST trading day's bars. The "5d"
      // Yahoo response stitches ~125 bars across 5 sessions, so a naive
      // "first vs last close" or "midpoint vs last" would compare bars
      // separated by 1-3 calendar days — that is exactly what produced
      // false-positive / missed VIX-spike triggers in the prior pass.
      // We tag each bar with its IST yyyy-mm-dd date and keep only the
      // latest date's bars; the session-open is then bars[0].close (or
      // .open if available) of that filtered slice.
      const istDate = (sec: number): string =>
        new Date(sec * 1000 + 5.5 * 3600 * 1000)
          .toISOString()
          .slice(0, 10);
      let latestDate = "";
      for (const ts of bars.timestamps) {
        const d = istDate(ts);
        if (d > latestDate) latestDate = d;
      }
      const idx: number[] = [];
      for (let i = 0; i < bars.timestamps.length; i++) {
        if (
          istDate(bars.timestamps[i]!) === latestDate &&
          bars.close[i] != null
        ) {
          idx.push(i);
        }
      }
      if (idx.length >= 2) {
        const firstI = idx[0]!;
        const lastI = idx[idx.length - 1]!;
        // Prefer the actual open of the first bar; fall back to its
        // close if the open column is missing (some Yahoo responses
        // omit the very first bar's open at session start).
        const open = bars.open[firstI] ?? bars.close[firstI]!;
        const last = bars.close[lastI]!;
        if (open > 0) intradayPct = ((last - open) / open) * 100;
      }
    }
  } catch (err) {
    logger.info(
      { err: (err as Error).message },
      "VIX intraday fetch failed; falling back to daily",
    );
  }

  let dayPct: number | null = null;
  try {
    const vixDaily = await fetchKiteIntraday("^INDIAVIX", "day", 5);
    if (vixDaily && vixDaily.close.length >= 2) {
      const c = vixDaily.meta.regularMarketPrice ?? vixDaily.close[vixDaily.close.length - 1]!;
      const p = vixDaily.close[vixDaily.close.length - 2]!;
      if (p > 0) dayPct = ((c - p) / p) * 100;
    }
  } catch (err) {
    logger.info(
      { err: (err as Error).message },
      "VIX daily fetch failed (Kite); day-spike gate disabled",
    );
  }

  if (intradayPct == null && dayPct == null) return empty;

  const tripIntra =
    intradayPct != null && intradayPct >= VIX_INTRADAY_SPIKE_PCT;
  const tripDay = dayPct != null && dayPct >= VIX_DAY_SPIKE_PCT;
  const spike = tripIntra || tripDay;
  let reason: string | null = null;
  if (spike) {
    const parts: string[] = [];
    if (tripIntra)
      parts.push(`intraday +${intradayPct!.toFixed(1)}% from open`);
    if (tripDay) parts.push(`day +${dayPct!.toFixed(1)}% vs prior close`);
    reason = `India VIX spike (${parts.join(", ")}) — fear bid; suppressing new directional plans`;
  }
  return { intradayPct, dayPct, spike, reason };
}

// --- public API ---

/**
 * Load all session-wide gate state once per signal cycle.  Keeping this
 * in a single function means the detector loop touches the DB / VIX
 * exactly once per cycle and every per-index decision is made against
 * a consistent snapshot.
 */
export async function loadGateContext(): Promise<GateContext> {
  const [stoppedToday, recentStops, vix] = await Promise.all([
    loadStoppedTodayCount(),
    loadRecentStopsByIndex(BIAS_FLIP_COOLDOWN_MIN),
    loadVixSnapshot(),
  ]);

  const circuitBreakerActive = stoppedToday >= DAILY_STOP_LIMIT;
  const globalSuppress = circuitBreakerActive || vix.spike;

  const notes: string[] = [];
  if (circuitBreakerActive) {
    notes.push(
      `Daily circuit breaker ON — ${stoppedToday} stops today (limit ${DAILY_STOP_LIMIT}). New high-conviction emission suspended for the rest of the session.`,
    );
  }
  if (vix.spike && vix.reason) notes.push(vix.reason);
  if (recentStops.size > 0) {
    const stoppedIndexCount = [...recentStops.values()].filter(
      (s) => s.minutesAgo <= BIAS_FLIP_COOLDOWN_MIN,
    ).length;
    if (stoppedIndexCount > 0) {
      notes.push(
        `Bias-flip cooldown active on ${stoppedIndexCount} index(es) (${BIAS_FLIP_COOLDOWN_MIN}-min lockout after a stop).`,
      );
    }
  }

  return {
    stoppedToday,
    circuitBreakerActive,
    recentStopsByIndex: recentStops,
    vix,
    globalSuppress,
    notes,
  };
}

/**
 * True iff a fresh signal in `direction` on `indexSymbol` would be a
 * direction-flip relative to a STOPPED row on the same index within the
 * cooldown window.  Caller should record the suppression reason.
 */
export function isBiasFlipSuppressed(
  ctx: GateContext,
  indexSymbol: string,
  direction: "BULLISH" | "BEARISH",
): { suppressed: boolean; reason?: string } {
  const recent = ctx.recentStopsByIndex.get(indexSymbol);
  if (!recent) return { suppressed: false };
  if (recent.minutesAgo > BIAS_FLIP_COOLDOWN_MIN) return { suppressed: false };
  if (recent.direction === direction) return { suppressed: false };
  return {
    suppressed: true,
    reason: `bias-flip cooldown: ${indexSymbol} stopped ${Math.round(recent.minutesAgo)}m ago on ${recent.direction}; ${direction} blocked for ${BIAS_FLIP_COOLDOWN_MIN}m`,
  };
}

/**
 * Apply correlated-exposure suppression: within each (bucket × direction),
 * keep only the highest-confidence HIGH_CONVICTION signal.  BASELINE
 * signals are never affected (they are an "outlook", not a trade plan).
 *
 * Returns the surviving signals plus the dropped list (for diagnostics).
 */
export function applyCorrelationCap(
  signals: OptionSignal[],
): CorrelationResult {
  const dropped: Array<{ signal: OptionSignal; reason: string }> = [];
  // Bucket key = "BROAD:BULLISH" | "BROAD:BEARISH" | "BANK:BULLISH" | ...
  const winners = new Map<string, OptionSignal>();

  // First pass: pick the top HC per (bucket, direction).
  for (const s of signals) {
    if (s.tier !== "HIGH_CONVICTION") continue;
    const bucket = bucketOf(s.index);
    if (!bucket) continue;
    if (s.bias !== "BULLISH" && s.bias !== "BEARISH") continue;
    const key = `${bucket}:${s.bias}`;
    const cur = winners.get(key);
    if (!cur || (s.confidence ?? 0) > (cur.confidence ?? 0)) {
      winners.set(key, s);
    }
  }

  const keptIds = new Set<OptionSignal>();
  for (const w of winners.values()) keptIds.add(w);

  const kept: OptionSignal[] = [];
  for (const s of signals) {
    // Always keep BASELINE and any HC outside the buckets / not in conflict.
    if (s.tier !== "HIGH_CONVICTION") {
      kept.push(s);
      continue;
    }
    const bucket = bucketOf(s.index);
    if (!bucket || (s.bias !== "BULLISH" && s.bias !== "BEARISH")) {
      kept.push(s);
      continue;
    }
    const key = `${bucket}:${s.bias}`;
    const winner = winners.get(key);
    if (winner === s) {
      kept.push(s);
    } else if (winner) {
      dropped.push({
        signal: s,
        reason: `correlated-exposure cap: ${bucket} bucket ${s.bias} already represented by ${winner.index} @ ${winner.confidence}% conf (this card ${s.confidence}% conf)`,
      });
    } else {
      kept.push(s);
    }
  }

  return { kept, dropped };
}
