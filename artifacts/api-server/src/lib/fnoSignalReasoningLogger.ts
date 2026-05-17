/**
 * F&O Signal Reasoning Logger (Priority P14 — 2026-05-15).
 *
 * **Diagnostics-only.** This module writes append-only rows to
 * `fno_signal_reasoning` describing every verdict the F&O paper-trade
 * decision pipeline emits. It does NOT alter any signal, gate, sizing,
 * execution, scheduler, or scanner decision.
 *
 * Safety contract:
 *
 *   1. Every public function is non-throwing. Any DB or shape error is
 *      caught, logged at WARN, and discarded. A reasoning-logger outage
 *      CANNOT block trading.
 *
 *   2. Callers should fire-and-forget. The intended idiom is:
 *
 *          void logFnoReasoning({...}); // sync call sites
 *          await logFnoReasoning({...}); // async call sites (still safe)
 *
 *      The function never rejects.
 *
 *   3. The writer does NOT validate that fields refer to real signals.
 *      That is intentional — the caller is the source of truth for the
 *      reasoning payload, and we'd rather record an imperfect row than
 *      drop a diagnostic event on a schema mismatch.
 *
 *   4. No secrets, tokens, API keys, or PII are accepted by the payload
 *      shape. The catch-all `snapshot` is opaque JSONB, but it is the
 *      caller's responsibility never to put credentials there. Reviewer
 *      check: search `fnoSignalReasoningLogger` call sites — none pass
 *      session/token/credential objects.
 *
 * The query helpers below back the owner-only diagnostic route in
 * `routes/paper.ts`. They are read-only.
 */

import { db, fnoSignalReasoningTable } from "@workspace/db";
import type {
  FnoSignalReasoningRow,
  NewFnoSignalReasoningRow,
} from "@workspace/db";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { logger } from "./logger";

/** Possible verdicts the paper-trade pipeline emits for a signal. */
export type FnoReasoningDecision =
  | "OPENED"
  | "SKIPPED"
  | "MISSED_WINDOW"
  | "CLOSED_STOPPED"
  | "CLOSED_TARGET1"
  | "CLOSED_TARGET2"
  | "CLOSED_EXPIRED"
  | "CLOSED_MANUAL"
  | "CLOSED_TIME_EXIT_1520";

/**
 * Shape accepted by `logFnoReasoning`. Every field except `decision`,
 * `signalDate`, and `indexSymbol` is optional — the writer fills in
 * what the caller knows at the decision point and leaves the rest NULL.
 *
 * `snapshot` is the forward-compat catch-all. Put gate-by-gate flags,
 * EMA stack, VWAP/VP relation, OI confluence inputs, etc. there
 * without requiring a schema migration to capture them.
 */
export interface FnoReasoningPayload {
  decision: FnoReasoningDecision;
  signalDate: string;
  indexSymbol: string;

  capturedAt?: Date;
  indexName?: string | null;
  setupKey?: string | null;
  direction?: "BULLISH" | "BEARISH" | string | null;
  optionType?: "CE" | "PE" | string | null;

  tier?: string | null;
  reasonCode?: string | null;

  confidence?: number | null;
  confluenceScore?: number | null;
  regime?: string | null;
  vix?: number | null;
  ivr?: number | null;
  ivp?: number | null;

  spot?: number | null;
  spotEntry?: number | null;
  spotStop?: number | null;
  spotTarget1?: number | null;
  spotTarget2?: number | null;

  selectedStrike?: number | null;
  optionEntry?: number | null;
  optionStop?: number | null;
  optionTarget1?: number | null;
  optionTarget2?: number | null;
  optionSpreadPct?: number | null;
  optionOi?: number | null;
  optionLtp?: number | null;
  optionExit?: number | null;
  realizedPnl?: number | null;

  lifecycleStatus?: string | null;
  exitReason?: string | null;
  dataQuality?: string | null;

  maxLossPct?: number | null;
  lots?: number | null;
  lotSize?: number | null;

  snapshot?: Record<string, unknown> | null;
  note?: string | null;
}

/** Numeric -> drizzle string with NaN/Inf guarding. */
function numOrNull(n: number | null | undefined, scale = 4): string | null {
  if (n == null) return null;
  if (!Number.isFinite(n)) return null;
  return n.toFixed(scale);
}

/** Integer-or-null with NaN/Inf guarding. */
function intOrNull(n: number | null | undefined): number | null {
  if (n == null) return null;
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

/* ─── snapshot sanitiser ────────────────────────────────────────────────
 * Defence-in-depth for the JSONB catch-all. Current call sites pass NO
 * snapshot, so this is purely preventive: if a future caller ever
 * forwards a header/cookie/session object by mistake, the sanitiser
 * drops anything whose key matches a credential pattern AND caps the
 * total serialised payload so a runaway object cannot bloat the table.
 * Both rules are conservative — we'd rather drop a legitimate field
 * than persist a leaked secret. */
const SECRET_KEY_RE =
  /(token|secret|password|passwd|cookie|session|auth|bearer|api[_-]?key|access[_-]?key)/i;
const MAX_SNAPSHOT_BYTES = 16 * 1024; // 16 KB serialised — generous for gate/feature flags

function sanitiseSnapshot(
  raw: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (raw == null || typeof raw !== "object") return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (SECRET_KEY_RE.test(k)) continue; // drop credential-shaped keys
    out[k] = v;
  }
  // Cap serialised size — Postgres jsonb can hold much more but we don't
  // want diagnostics to grow without bound. Stringify failures (e.g.
  // circular refs) collapse the whole snapshot to null rather than throw.
  try {
    const s = JSON.stringify(out);
    if (s.length > MAX_SNAPSHOT_BYTES) {
      return { __truncated: true, __bytes: s.length };
    }
  } catch {
    return null;
  }
  return out;
}

/** String trim/cap helper (avoid blowing varchar limits silently). */
function strOrNull(s: string | null | undefined, max: number): string | null {
  if (s == null) return null;
  const t = String(s).trim();
  if (t.length === 0) return null;
  return t.length > max ? t.slice(0, max) : t;
}

/**
 * Pure helper exposed for tests — converts the public payload to the
 * exact row shape we hand to drizzle. No DB I/O.
 */
export function buildReasoningRow(p: FnoReasoningPayload): NewFnoSignalReasoningRow {
  return {
    capturedAt: p.capturedAt ?? new Date(),
    signalDate: p.signalDate,
    indexSymbol: strOrNull(p.indexSymbol, 32) ?? p.indexSymbol,
    indexName: strOrNull(p.indexName, 64),
    setupKey: strOrNull(p.setupKey, 64),
    direction: strOrNull(p.direction ?? null, 16),
    optionType: strOrNull(p.optionType ?? null, 4),
    tier: strOrNull(p.tier, 16),
    decision: strOrNull(p.decision, 32) ?? p.decision,
    reasonCode: strOrNull(p.reasonCode, 64),
    confidence: intOrNull(p.confidence),
    confluenceScore: numOrNull(p.confluenceScore, 2),
    regime: strOrNull(p.regime, 24),
    vix: numOrNull(p.vix, 2),
    ivr: numOrNull(p.ivr, 2),
    ivp: numOrNull(p.ivp, 2),
    spot: numOrNull(p.spot, 2),
    spotEntry: numOrNull(p.spotEntry, 2),
    spotStop: numOrNull(p.spotStop, 2),
    spotTarget1: numOrNull(p.spotTarget1, 2),
    spotTarget2: numOrNull(p.spotTarget2, 2),
    selectedStrike: numOrNull(p.selectedStrike, 2),
    optionEntry: numOrNull(p.optionEntry, 4),
    optionStop: numOrNull(p.optionStop, 4),
    optionTarget1: numOrNull(p.optionTarget1, 4),
    optionTarget2: numOrNull(p.optionTarget2, 4),
    optionSpreadPct: numOrNull(p.optionSpreadPct, 4),
    optionOi: intOrNull(p.optionOi),
    optionLtp: numOrNull(p.optionLtp, 4),
    optionExit: numOrNull(p.optionExit, 4),
    realizedPnl: numOrNull(p.realizedPnl, 2),
    lifecycleStatus: strOrNull(p.lifecycleStatus, 24),
    exitReason: strOrNull(p.exitReason, 32),
    dataQuality: strOrNull(p.dataQuality, 32),
    maxLossPct: numOrNull(p.maxLossPct, 4),
    lots: intOrNull(p.lots),
    lotSize: intOrNull(p.lotSize),
    snapshot: sanitiseSnapshot(p.snapshot ?? null),
    note: p.note ?? null,
  };
}

/**
 * Append one reasoning row. **Never throws.** Safe to call from any
 * decision point in the F&O pipeline — including inside transactions
 * (this opens its own connection via the singleton `db`), inside
 * setInterval ticks, and inside synchronous helpers (via `void`).
 *
 * On failure, emits one `logger.warn` so the operator sees substrate
 * outages explicitly without spamming the request log.
 */
export async function logFnoReasoning(payload: FnoReasoningPayload): Promise<void> {
  try {
    const row = buildReasoningRow(payload);
    await db.insert(fnoSignalReasoningTable).values(row);
  } catch (err) {
    // Swallowed — diagnostics MUST NOT influence trading. One WARN per
    // failure keeps the issue visible in logs without crashing the
    // pipeline. We intentionally do NOT re-throw, retry, or back off.
    logger.warn(
      {
        err: (err as Error).message,
        decision: payload.decision,
        indexSymbol: payload.indexSymbol,
        setupKey: payload.setupKey,
      },
      "fno_signal_reasoning write failed (diagnostics-only; trading unaffected)",
    );
  }
}

/* ─────────────────────── Query side (route helpers) ────────────────────── */

export interface ReasoningQueryFilters {
  indexSymbol?: string;
  setupKey?: string;
  direction?: string;
  tier?: string;
  decision?: string;
  reasonCode?: string;
  from?: string; // YYYY-MM-DD inclusive (signal_date)
  to?: string;   // YYYY-MM-DD inclusive
  limit?: number;
}

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

/** Trims, caps, and validates the public filter shape. */
export function normaliseFilters(raw: Record<string, unknown>): ReasoningQueryFilters {
  const isValidDate = (s: unknown): s is string => {
    if (typeof s !== "string") return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const t = Date.parse(`${s}T00:00:00Z`);
    if (Number.isNaN(t)) return false;
    return new Date(t).toISOString().slice(0, 10) === s;
  };
  const pickStr = (k: string, max: number): string | undefined => {
    const v = raw[k];
    if (typeof v !== "string") return undefined;
    const t = v.trim();
    if (!t) return undefined;
    return t.length > max ? t.slice(0, max) : t;
  };
  const limitRaw = raw.limit;
  let limit = DEFAULT_LIMIT;
  if (typeof limitRaw === "string" || typeof limitRaw === "number") {
    const n = Number(limitRaw);
    if (Number.isFinite(n) && n > 0) limit = Math.min(Math.floor(n), MAX_LIMIT);
  }
  return {
    indexSymbol: pickStr("index", 32) ?? pickStr("indexSymbol", 32),
    setupKey: pickStr("setup", 64) ?? pickStr("setupKey", 64),
    direction: pickStr("direction", 16) ?? pickStr("side", 16),
    tier: pickStr("tier", 16),
    decision: pickStr("decision", 32) ?? pickStr("status", 32),
    reasonCode: pickStr("reason", 64) ?? pickStr("reasonCode", 64),
    from: isValidDate(raw.from) ? raw.from : undefined,
    to: isValidDate(raw.to) ? raw.to : undefined,
    limit,
  };
}

function whereFromFilters(f: ReasoningQueryFilters) {
  const conds = [] as ReturnType<typeof eq>[];
  if (f.indexSymbol) conds.push(eq(fnoSignalReasoningTable.indexSymbol, f.indexSymbol));
  if (f.setupKey) conds.push(eq(fnoSignalReasoningTable.setupKey, f.setupKey));
  if (f.direction) conds.push(eq(fnoSignalReasoningTable.direction, f.direction));
  if (f.tier) conds.push(eq(fnoSignalReasoningTable.tier, f.tier));
  if (f.decision) conds.push(eq(fnoSignalReasoningTable.decision, f.decision));
  if (f.reasonCode) conds.push(eq(fnoSignalReasoningTable.reasonCode, f.reasonCode));
  if (f.from) conds.push(gte(fnoSignalReasoningTable.signalDate, f.from));
  if (f.to) conds.push(lte(fnoSignalReasoningTable.signalDate, f.to));
  return conds.length === 0 ? undefined : and(...conds);
}

export interface ReasoningHistogram {
  byDecision: Array<{ key: string; count: number }>;
  byReason: Array<{ key: string; count: number }>;
  byIndex: Array<{ key: string; count: number }>;
  bySetup: Array<{ key: string; count: number }>;
  byTier: Array<{ key: string; count: number }>;
  byStopReason: Array<{ key: string; count: number }>; // setup-by-setup count of CLOSED_STOPPED rows
  total: number;
}

export interface ReasoningQueryResult {
  rows: FnoSignalReasoningRow[];
  histogram: ReasoningHistogram;
  filters: ReasoningQueryFilters;
}

/**
 * Returns the most-recent matching reasoning rows plus histograms.
 * Histograms are computed over the same filter set (NOT the whole table)
 * so the owner sees breakdowns that match what they're looking at.
 *
 * Caps at `limit` rows (default 100, max 500) to keep the response cheap.
 */
export async function queryReasoning(
  filters: ReasoningQueryFilters,
): Promise<ReasoningQueryResult> {
  const where = whereFromFilters(filters);
  const limit = filters.limit ?? DEFAULT_LIMIT;

  const rowsQ = db
    .select()
    .from(fnoSignalReasoningTable)
    .orderBy(desc(fnoSignalReasoningTable.capturedAt))
    .limit(limit);
  const rows = where ? await rowsQ.where(where) : await rowsQ;

  // Histograms via SQL count(*) GROUP BY — runs independently of the
  // limited `rows` fetch so the buckets reflect ALL matching rows, not
  // just the 100 we surface.
  const groupBy = async (col: ReturnType<typeof sql>): Promise<Array<{ key: string; count: number }>> => {
    const q = db
      .select({ key: col, count: sql<number>`count(*)::int` })
      .from(fnoSignalReasoningTable);
    const rows = where
      ? await q.where(where).groupBy(col).orderBy(desc(sql<number>`count(*)`))
      : await q.groupBy(col).orderBy(desc(sql<number>`count(*)`));
    return rows.map(r => ({ key: r.key == null ? "UNKNOWN" : String(r.key), count: Number(r.count) }));
  };

  // For "stop reason by setup" we filter to CLOSED_STOPPED and group by
  // setup_key. Combined with the standard filters via AND.
  const stopReasonWhere = (() => {
    const stopCond = eq(fnoSignalReasoningTable.decision, "CLOSED_STOPPED");
    return where ? and(where, stopCond) : stopCond;
  })();
  const stopQ = db
    .select({
      key: sql<string>`coalesce(${fnoSignalReasoningTable.setupKey}, 'UNKNOWN')`,
      count: sql<number>`count(*)::int`,
    })
    .from(fnoSignalReasoningTable)
    .where(stopReasonWhere)
    .groupBy(fnoSignalReasoningTable.setupKey)
    .orderBy(desc(sql<number>`count(*)`));
  const stopRows = await stopQ;

  const totalQ = db
    .select({ n: sql<number>`count(*)::int` })
    .from(fnoSignalReasoningTable);
  const totalRow = where ? await totalQ.where(where) : await totalQ;
  const total = Number(totalRow[0]?.n ?? 0);

  const [byDecision, byReason, byIndex, bySetup, byTier] = await Promise.all([
    groupBy(sql`${fnoSignalReasoningTable.decision}`),
    groupBy(sql`${fnoSignalReasoningTable.reasonCode}`),
    groupBy(sql`${fnoSignalReasoningTable.indexSymbol}`),
    groupBy(sql`${fnoSignalReasoningTable.setupKey}`),
    groupBy(sql`${fnoSignalReasoningTable.tier}`),
  ]);

  return {
    rows,
    histogram: {
      byDecision,
      byReason,
      byIndex,
      bySetup,
      byTier,
      byStopReason: stopRows.map(r => ({ key: String(r.key), count: Number(r.count) })),
      total,
    },
    filters,
  };
}

/* keep ascending exported for possible future "oldest-first" route option */
export { asc };
