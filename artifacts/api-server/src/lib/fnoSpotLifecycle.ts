/**
 * READ-ONLY spot-underlying lifecycle enrichment for F&O paper trades.
 *
 * Joins `paper_trade_fo` rows to their originating `option_signal_history` row
 * by the 4-tuple PRIMARY KEY (signalDate, indexSymbol, setupKey, direction) and
 * exposes the SPOT-side levels (entry / stop / target1 / target2 / lastSpot /
 * max-favourable-excursion) plus the signal lifecycle `status`.
 *
 * STRICTLY reporting-only. This module performs a single SELECT and computes
 * nothing that feeds a trading decision: no entry, exit, target, stop, sizing,
 * gate, or tracker mutation. It is FAIL-OPEN — any query/parse failure yields an
 * empty map so the caller's positions/trades endpoint still serves, and missing
 * joins simply surface as `null` ("spot lifecycle unavailable") in the UI.
 */
import { db, optionSignalHistoryTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { logger } from "./logger";

export interface FnoSpotLifecycle {
  status: string | null;
  spotEntry: number | null;
  spotStop: number | null;
  spotTarget1: number | null;
  spotTarget2: number | null;
  lastSpot: number | null;
  maxFavorableExcursionPts: number | null;
}

export interface LifecycleKeyParts {
  signalDate: string;
  indexSymbol: string;
  setupKey: string;
  direction: string;
}

/** Parse a numeric|string|null DB value to a finite number, else null. */
function numOrNull(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** Stable composite key for the 4-tuple PK. Trimmed; \u0001-joined (never collides). */
export function lifecycleKeyOf(parts: LifecycleKeyParts): string {
  return [parts.signalDate, parts.indexSymbol, parts.setupKey, parts.direction]
    .map((s) => String(s ?? "").trim())
    .join("\u0001");
}

/** Shape we read off an option_signal_history row (subset). */
export interface LifecycleSourceRow {
  status?: string | null;
  entry?: string | number | null;
  stopLoss?: string | number | null;
  target1?: string | number | null;
  target2?: string | number | null;
  lastSpot?: string | number | null;
  maxFavorableExcursion?: string | number | null;
}

/** Pure mapper from a signal-history row to the read-only spot-lifecycle DTO. */
export function mapLifecycleRow(row: LifecycleSourceRow): FnoSpotLifecycle {
  const status =
    row.status == null || String(row.status).trim() === ""
      ? null
      : String(row.status).trim();
  return {
    status,
    spotEntry: numOrNull(row.entry),
    spotStop: numOrNull(row.stopLoss),
    spotTarget1: numOrNull(row.target1),
    spotTarget2: numOrNull(row.target2),
    lastSpot: numOrNull(row.lastSpot),
    maxFavorableExcursionPts: numOrNull(row.maxFavorableExcursion),
  };
}

/**
 * Bulk-load spot lifecycles for the given trade keys. Queries by the distinct
 * set of signal dates (indexed) then matches the full 4-tuple in JS, returning a
 * `Map<lifecycleKey, FnoSpotLifecycle>`. FAIL-OPEN: returns an empty map on any
 * error. Read-only.
 */
export async function loadSpotLifecycleByKey(
  rows: LifecycleKeyParts[],
): Promise<Map<string, FnoSpotLifecycle>> {
  const out = new Map<string, FnoSpotLifecycle>();
  if (rows.length === 0) return out;

  const dates = Array.from(
    new Set(rows.map((r) => r.signalDate).filter((d): d is string => !!d)),
  );
  if (dates.length === 0) return out;

  const wanted = new Set(rows.map(lifecycleKeyOf));

  try {
    const found = await db
      .select()
      .from(optionSignalHistoryTable)
      .where(inArray(optionSignalHistoryTable.signalDate, dates));
    for (const r of found) {
      const key = lifecycleKeyOf({
        signalDate: r.signalDate,
        indexSymbol: r.indexSymbol,
        setupKey: r.setupKey,
        direction: r.direction,
      });
      if (!wanted.has(key)) continue;
      out.set(key, mapLifecycleRow(r));
    }
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, dates: dates.length },
      "Spot-lifecycle enrichment failed; serving without it (fail-open)",
    );
    return new Map();
  }
  return out;
}
