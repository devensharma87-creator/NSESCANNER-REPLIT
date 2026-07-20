/**
 * P0-G: Historical invalid-session detector.
 *
 * Read-only query that classifies every historical equity and F&O paper trade
 * open against canonical session/calendar rules, and emits structured reason
 * codes for each suspicious or invalid record.
 *
 * INVARIANTS:
 *  - This module NEVER modifies any row. All queries are SELECT-only.
 *  - It does NOT fix timestamps or delete rows. Preserve evidence first.
 *  - Missing provenance fields are reported as UNKNOWN, never fabricated.
 *  - A row that cannot be assessed is reported as CANNOT_ASSESS with an
 *    explanation — it is NOT silently omitted.
 *
 * REASON CODES:
 *  WEEKEND_OPEN           - Opened on Saturday or Sunday (IST)
 *  AFTER_HOURS_OPEN       - Opened after 15:30:00 IST on a trading day
 *  PRE_OPEN               - Opened before 09:15:00 IST on a trading day
 *  BOUNDARY_EDGE          - Opened between 15:30:00 and 15:30:59 IST (blocked by half-open rule)
 *  SUSPICIOUS_BATCH_TS    - Multiple distinct symbols opened at the identical millisecond
 *  FUTURE_OPEN            - created_at is in the future relative to detector run time
 *  CANNOT_ASSESS          - created_at is null or unparseable
 *  SESSION_LIKELY_VALID   - Time-of-day plausible; calendar not yet verified
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export type InvalidSessionReasonCode =
  | "WEEKEND_OPEN"
  | "AFTER_HOURS_OPEN"
  | "PRE_OPEN"
  | "BOUNDARY_EDGE"
  | "SUSPICIOUS_BATCH_TS"
  | "FUTURE_OPEN"
  | "CANNOT_ASSESS"
  | "SESSION_LIKELY_VALID";

export interface InvalidSessionTradeRow {
  tradeId: number | string;
  table: "paper_trade_eq" | "paper_trade_fo";
  symbol: string;
  createdAtUtc: string | null;
  createdAtIst: string | null;
  /** Weekday in IST: 0=Sun, 1=Mon … 6=Sat */
  weekdayIst: number | null;
  /** HH:MM:SS in IST */
  timeOfDayIst: string | null;
  reasonCodes: InvalidSessionReasonCode[];
  /** Additional context (source, writer version, signal_time, etc.) */
  provenanceFields: Record<string, string | number | null>;
}

export interface InvalidSessionReport {
  /** ISO timestamp when the detector ran. */
  detectorRunAt: string;
  /** Total rows inspected across both tables. */
  totalInspected: number;
  /** Rows classified as invalid or suspicious. */
  totalFlagged: number;
  /** Rows that could not be assessed (null/unparseable created_at). */
  totalCannotAssess: number;
  /** Rows that are time-of-day plausible (calendar not yet verified). */
  totalLikelyValid: number;
  rows: InvalidSessionTradeRow[];
  /** True when the detector successfully ran against both tables. */
  success: boolean;
  error?: string;
}

/** IST offset in milliseconds (+05:30). */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function toIst(d: Date): Date {
  return new Date(d.getTime() + IST_OFFSET_MS);
}

function formatTimeOfDay(d: Date): string {
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function classifyRow(createdAt: Date | null): {
  weekdayIst: number | null;
  timeOfDayIst: string | null;
  createdAtIst: string | null;
  reasons: InvalidSessionReasonCode[];
} {
  if (!createdAt || isNaN(createdAt.getTime())) {
    return { weekdayIst: null, timeOfDayIst: null, createdAtIst: null, reasons: ["CANNOT_ASSESS"] };
  }

  const now = new Date();
  if (createdAt > now) {
    return { weekdayIst: null, timeOfDayIst: null, createdAtIst: createdAt.toISOString(), reasons: ["FUTURE_OPEN"] };
  }

  const ist = toIst(createdAt);
  const weekday = ist.getUTCDay(); // 0=Sun … 6=Sat
  const h = ist.getUTCHours();
  const m = ist.getUTCMinutes();
  const s = ist.getUTCSeconds();
  const timeMs = h * 3600 + m * 60 + s;
  const timeStr = formatTimeOfDay(ist);
  // YYYY-MM-DD HH:MM:SS IST
  const istIso = ist.toISOString().replace("T", " ").slice(0, 19) + " IST";

  const reasons: InvalidSessionReasonCode[] = [];

  // Weekend (Sat=6, Sun=0)
  if (weekday === 0 || weekday === 6) {
    reasons.push("WEEKEND_OPEN");
    return { weekdayIst: weekday, timeOfDayIst: timeStr, createdAtIst: istIso, reasons };
  }

  // Boundary edge: 15:30:00 – 15:30:59 IST (half-open, blocked per §6.2)
  const T1530 = 15 * 3600 + 30 * 60; // 55800 seconds
  if (timeMs >= T1530 && timeMs < T1530 + 60) {
    reasons.push("BOUNDARY_EDGE");
  }

  // After hours: >= 15:31:00 IST (also captures boundary edge already caught)
  if (timeMs >= T1530 + 60) {
    reasons.push("AFTER_HOURS_OPEN");
  }

  // Pre-open: before 09:15:00 IST
  const T0915 = 9 * 3600 + 15 * 60; // 33300 seconds
  if (timeMs < T0915) {
    reasons.push("PRE_OPEN");
  }

  if (reasons.length === 0) {
    reasons.push("SESSION_LIKELY_VALID");
  }

  return { weekdayIst: weekday, timeOfDayIst: timeStr, createdAtIst: istIso, reasons };
}

/**
 * Row shapes returned by our raw SQL queries.
 * The index signature satisfies the drizzle db.execute<T> constraint.
 */
interface EqRawRow extends Record<string, unknown> {
  id: number;
  symbol: string;
  created_at: Date | null;
  status: string;
  source: string | null;
  writer_version: string | null;
  signal_triggered_at: Date | null;
}

interface FoRawRow extends Record<string, unknown> {
  id: number;
  index_symbol: string;
  created_at: Date | null;
  status: string;
  signal_date: string | null;
  option_type: string | null;
  direction: string | null;
  contract_grade: string | null;
}

/**
 * Run the historical invalid-session detector.
 *
 * Accepts an optional limit per table (default 500) to keep queries bounded.
 * Uses the shared Drizzle db instance — SELECT-only, never mutates rows.
 */
export async function detectInvalidSessionTrades(
  limitPerTable = 500,
): Promise<InvalidSessionReport> {
  const detectorRunAt = new Date().toISOString();
  const rows: InvalidSessionTradeRow[] = [];
  let totalInspected = 0;

  try {
    // Detect batch-timestamp rows (same millisecond, multiple symbols) across both tables
    const batchTsEqResult = await db.execute<{ created_at: Date; cnt: string }>(
      sql`SELECT created_at, COUNT(*) AS cnt
            FROM paper_trade_eq
           GROUP BY created_at
          HAVING COUNT(*) > 1`,
    );
    const batchTsFoResult = await db.execute<{ created_at: Date; cnt: string }>(
      sql`SELECT created_at, COUNT(*) AS cnt
            FROM paper_trade_fo
           GROUP BY created_at
          HAVING COUNT(*) > 1`,
    );
    const batchTs = new Set<number>([
      ...batchTsEqResult.rows.map((r) => r.created_at?.getTime()).filter((t): t is number => t != null),
      ...batchTsFoResult.rows.map((r) => r.created_at?.getTime()).filter((t): t is number => t != null),
    ]);

    // Query paper_trade_eq
    const eqResult = await db.execute<EqRawRow>(
      sql`SELECT id, symbol, created_at, status,
                 source, writer_version, signal_triggered_at
            FROM paper_trade_eq
           ORDER BY created_at DESC NULLS LAST
           LIMIT ${limitPerTable}`,
    );
    totalInspected += eqResult.rows.length;

    for (const r of eqResult.rows) {
      const { weekdayIst, timeOfDayIst, createdAtIst, reasons } = classifyRow(r.created_at);
      if (r.created_at && batchTs.has(r.created_at.getTime())) {
        if (!reasons.includes("SUSPICIOUS_BATCH_TS")) reasons.push("SUSPICIOUS_BATCH_TS");
      }
      rows.push({
        tradeId: r.id,
        table: "paper_trade_eq",
        symbol: r.symbol,
        createdAtUtc: r.created_at?.toISOString() ?? null,
        createdAtIst,
        weekdayIst,
        timeOfDayIst,
        reasonCodes: reasons,
        provenanceFields: {
          status: r.status,
          source: r.source ?? "UNKNOWN",
          writer_version: r.writer_version ?? "UNKNOWN",
          signal_triggered_at: r.signal_triggered_at?.toISOString() ?? null,
        },
      });
    }

    // Query paper_trade_fo
    const foResult = await db.execute<FoRawRow>(
      sql`SELECT id, index_symbol, created_at, status,
                 signal_date, option_type, direction,
                 contract_grade
            FROM paper_trade_fo
           ORDER BY created_at DESC NULLS LAST
           LIMIT ${limitPerTable}`,
    );
    totalInspected += foResult.rows.length;

    for (const r of foResult.rows) {
      const { weekdayIst, timeOfDayIst, createdAtIst, reasons } = classifyRow(r.created_at);
      if (r.created_at && batchTs.has(r.created_at.getTime())) {
        if (!reasons.includes("SUSPICIOUS_BATCH_TS")) reasons.push("SUSPICIOUS_BATCH_TS");
      }
      rows.push({
        tradeId: r.id,
        table: "paper_trade_fo",
        symbol: r.index_symbol,
        createdAtUtc: r.created_at?.toISOString() ?? null,
        createdAtIst,
        weekdayIst,
        timeOfDayIst,
        reasonCodes: reasons,
        provenanceFields: {
          status: r.status,
          signal_date: r.signal_date ?? "UNKNOWN",
          option_type: r.option_type ?? "UNKNOWN",
          direction: r.direction ?? "UNKNOWN",
          contract_grade: r.contract_grade ?? "UNKNOWN",
        },
      });
    }
  } catch (err) {
    return {
      detectorRunAt,
      totalInspected,
      totalFlagged: 0,
      totalCannotAssess: 0,
      totalLikelyValid: 0,
      rows,
      success: false,
      error: (err as Error).message,
    };
  }

  const flagged = rows.filter(
    (r) => r.reasonCodes.some((c) => c !== "SESSION_LIKELY_VALID"),
  );
  const cannotAssess = rows.filter((r) => r.reasonCodes.includes("CANNOT_ASSESS"));
  const likelyValid = rows.filter(
    (r) => r.reasonCodes.length === 1 && r.reasonCodes[0] === "SESSION_LIKELY_VALID",
  );

  return {
    detectorRunAt,
    totalInspected,
    totalFlagged: flagged.length,
    totalCannotAssess: cannotAssess.length,
    totalLikelyValid: likelyValid.length,
    rows,
    success: true,
  };
}
