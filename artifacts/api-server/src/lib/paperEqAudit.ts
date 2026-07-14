/**
 * Equity-side decision audit + live event ring buffer.
 *
 * Two surfaces, one writer:
 *
 *   1. recordEqDecision() — INSERTs to `paper_eq_audit` (durable history,
 *      queryable by GET /paper/audit/eq) AND pushes a live event to the
 *      in-process ring buffer.
 *
 *   2. pushEqEvent()      — events-only (used for OPEN / CLOSE / TRAIL
 *      lifecycle moments that are also in `paper_trade_eq` and don't need
 *      a second audit row, but still want a UI toast).
 *
 * The ring buffer is a simple in-memory array of the last EVENT_RING_SIZE
 * events tagged with monotonic `id` and unix-ms `ts`. The /paper/events/eq
 * route returns all events with `id > since` so the UI can long-poll for
 * just the new ones since its last read. Events are best-effort and lost
 * on process restart by design — they're toasts, not data of record.
 */
import { db, paperEqAuditTable } from "@workspace/db";
import { desc, gt, sql } from "drizzle-orm";
import { logger } from "./logger";

export type EqAuditReason =
  // SKIP reasons (one per skip site in paperTradingEq.ts)
  | "INVALID_ENTRY"
  | "INVALID_RISK"
  | "STOP_SANITY"
  | "DD_DAILY"
  | "DD_WEEKLY"
  | "DD_MONTHLY"
  | "NO_ACCT"
  | "DAILY_CAP"
  | "CONCURRENT_CAP"
  | "DEPLOY_LE_0"
  | "QTY_LT_1"
  | "INSUFF_BAL"
  | "HEAT_CAP"
  | "DUPLICATE"
  | "TXN_ABORT"
  // OPEN
  | "OPENED";

export type EqEventType =
  | "BUY_EXECUTED"
  | "BUY_SKIPPED"
  | "SL_HIT"
  | "TARGET2_HIT"
  | "TRAIL_TO_T1"
  | "TIME_STOP"
  | "SIGNAL_FLIP"
  | "MANUAL_BUY"
  | "MANUAL_CLOSE";

export interface EqEvent {
  id: number;
  ts: number; // unix ms
  type: EqEventType;
  symbol: string;
  /** Short headline (UI toast title). */
  title: string;
  /** Longer secondary line (UI toast description). */
  detail?: string;
  /** "auto" | "manual" — controls toast styling. */
  source: "auto" | "manual";
  /** "info" | "success" | "warn" | "error" — controls toast variant. */
  severity: "info" | "success" | "warn" | "error";
}

const EVENT_RING_SIZE = 200;
const events: EqEvent[] = [];
let nextEventId = 1;

/** Push to the in-memory ring buffer. Capped at EVENT_RING_SIZE. */
export function pushEqEvent(e: Omit<EqEvent, "id" | "ts">): void {
  const ev: EqEvent = { ...e, id: nextEventId++, ts: Date.now() };
  events.push(ev);
  if (events.length > EVENT_RING_SIZE) events.splice(0, events.length - EVENT_RING_SIZE);
}

/** Read every event with id > sinceId (or all if sinceId == 0). */
export function getEqEventsSince(sinceId: number): {
  events: EqEvent[];
  latestId: number;
} {
  const out = events.filter((e) => e.id > sinceId);
  const latestId = events.length > 0 ? events[events.length - 1]!.id : sinceId;
  return { events: out, latestId };
}

interface RecordCtx {
  symbol: string;
  reason: EqAuditReason;
  decision: "OPEN" | "SKIP";
  detail: string;
  signal?: string | null;
  score?: number | null;
  entry?: number | null;
  stop?: number | null;
  qty?: number | null;
  deploy?: number | null;
  balance?: number | null;
  accountValue?: number | null;
  source?: "AUTO" | "MANUAL" | "SWING_STAGED_APPROVAL";
  /**
   * The paper_trade_eq row id this OPEN decision produced (Checkpoint 2,
   * 2026-07-03). Only ever passed on decision="OPEN" — the trade insert
   * happens first, so the caller has a real id to hand in. Never set
   * retroactively; NULL means either a SKIP row or a pre-Checkpoint-2 row.
   */
  paperTradeId?: string | null;
  /** When set, ALSO push an EqEvent of this type to the live ring buffer. */
  emitEvent?: {
    type: EqEventType;
    title: string;
    severity: EqEvent["severity"];
  };
}

const num = (n: number | null | undefined): string | null =>
  n != null && Number.isFinite(n) ? n.toString() : null;

/**
 * Persist a SKIP / OPEN audit row. Best-effort: if the DB insert fails we
 * log + swallow rather than poisoning the caller's path. The live event
 * (if requested) is still pushed even if the DB write fails — the UI
 * toast is more important than the durable audit row in the failure case.
 */
export async function recordEqDecision(ctx: RecordCtx): Promise<void> {
  if (ctx.emitEvent) {
    pushEqEvent({
      type: ctx.emitEvent.type,
      symbol: ctx.symbol,
      title: ctx.emitEvent.title,
      detail: ctx.detail,
      source: (ctx.source === "SWING_STAGED_APPROVAL" ? "manual" : (ctx.source ?? "AUTO").toLowerCase()) as "auto" | "manual",
      severity: ctx.emitEvent.severity,
    });
  }
  try {
    await db.insert(paperEqAuditTable).values({
      symbol: ctx.symbol,
      signal: ctx.signal ?? null,
      score: num(ctx.score ?? null),
      decision: ctx.decision,
      reason: ctx.reason,
      detail: ctx.detail,
      entry: num(ctx.entry ?? null),
      stop: num(ctx.stop ?? null),
      qty: ctx.qty ?? null,
      deploy: num(ctx.deploy ?? null),
      balance: num(ctx.balance ?? null),
      accountValue: num(ctx.accountValue ?? null),
      source: ctx.source ?? "AUTO",
      paperTradeId: ctx.paperTradeId ?? null,
    });
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, symbol: ctx.symbol, reason: ctx.reason },
      "paper_eq_audit insert failed (non-fatal)",
    );
  }
}

/**
 * Owner-only: read the most-recent N audit rows for the equity book.
 * Default 100 rows; capped at 500.
 */
export async function listEqAudit(limit = 100): Promise<
  Array<{
    id: string;
    ts: string;
    symbol: string;
    signal: string | null;
    score: number | null;
    decision: string;
    reason: string;
    detail: string | null;
    entry: number | null;
    stop: number | null;
    qty: number | null;
    deploy: number | null;
    balance: number | null;
    accountValue: number | null;
    source: string;
  }>
> {
  const cap = Math.max(1, Math.min(500, Math.floor(limit)));
  const rows = await db
    .select()
    .from(paperEqAuditTable)
    .orderBy(desc(paperEqAuditTable.ts))
    .limit(cap);
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts.toISOString(),
    symbol: r.symbol,
    signal: r.signal ?? null,
    score: r.score == null ? null : Number(r.score),
    decision: r.decision,
    reason: r.reason,
    detail: r.detail ?? null,
    entry: r.entry == null ? null : Number(r.entry),
    stop: r.stop == null ? null : Number(r.stop),
    qty: r.qty ?? null,
    deploy: r.deploy == null ? null : Number(r.deploy),
    balance: r.balance == null ? null : Number(r.balance),
    accountValue: r.accountValue == null ? null : Number(r.accountValue),
    source: r.source,
  }));
}

/** Aggregate skip-reason counts over the last `hours` hours. */
export async function summarizeEqAudit(hours = 24): Promise<
  Array<{ reason: string; count: number }>
> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const rows = await db.execute(sql`
    SELECT reason, COUNT(*)::int AS count
      FROM paper_eq_audit
     WHERE ts >= ${since.toISOString()}
     GROUP BY reason
     ORDER BY count DESC
  `);
  return (rows as unknown as { rows: Array<{ reason: string; count: number }> }).rows ?? [];
}
