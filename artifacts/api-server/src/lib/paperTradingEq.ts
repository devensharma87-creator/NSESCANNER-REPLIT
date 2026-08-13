/**
 * Equity (delivery) paper trading executor.
 *
 * Sits as a side-effect hook on top of the fullNseScanner. It does NOT
 * generate signals or fetch market data — it translates SwingSignal
 * events into virtual broker actions and re-evaluates OPEN positions
 * against the latest LTP from the scanner cache:
 *
 *   STRONG_BUY (in F&O 200) ⇒ open one paper buy at the locked LTP
 *   ltp ≥ T2                ⇒ close at T2  (TARGET2_HIT)
 *   ltp ≤ stop              ⇒ close at stop (STOPPED, or TRAIL_STOP_HIT
 *                              once the stop has been trailed up to T1)
 *   ltp ≥ T1 (first time)   ⇒ trail stop to T1, do NOT exit
 *   30 trading days held    ⇒ close at LTP (TIME_STOP)
 *   STRONG_SELL on symbol   ⇒ close at LTP (SIGNAL_FLIP)
 *
 * Position sizing: per_position = account_value / max(BASE_SLOTS,
 * open_count + 1); deploy = min(per_position, available_cash); qty =
 * floor(deploy / entryPrice). Hard caps: ≤ MAX_CONCURRENT open at a
 * time, ≤ MAX_NEW_PER_DAY new entries per IST day.
 *
 * Concurrency:
 *   - The unique index on (symbol, signalDate) in paper_trade_eq
 *     prevents the same scanner tick from opening two trades for the
 *     same stock on the same IST day, even under parallel calls.
 *   - The transaction starts with SELECT … FOR UPDATE on the EQUITY
 *     account row, so the day-cap and balance checks are serialised.
 *   - All exits run as CAS updates (status='OPEN' → status='CLOSED')
 *     so a re-evaluator firing twice cannot double-credit.
 */
import {
  db,
  paperAccountTable,
  paperTradeEqTable,
} from "@workspace/db";
import type { PaperTradeEqRow, PaperTradeEqSource } from "@workspace/db";
import type { SwingOrderStagingRow } from "@workspace/db/schema";
import { and, eq, ne, sql } from "drizzle-orm";
import { CURRENT_WRITER_VERSION } from "./paperTradeWriterVersion";
import { computeEquityCharges } from "./paperReportsEq";
import {
  ensureDailyReset,
  EQUITY_DD_CAPS,
  EQUITY_RISK,
  EQUITY_STOP_SANITY,
  PORTFOLIO_HEAT,
  SEED_CAPITAL,
  HEAT_SQL_EQ,
  parseHeatRow,
  getEqDailyRealizedDrawdown,
  getEqMonthlyRealizedDrawdown,
  getEqWeeklyRealizedDrawdown,
} from "./paperAccount";
import { logger } from "./logger";
import { normalizeCanonicalExchange } from "./canonicalInstrument";
import { isPaperAutoTradingEnabled } from "./paperAutoTradeFlag";
import { recordEqDecision, pushEqEvent, type EqEventType } from "./paperEqAudit";
import type { SwingSignal } from "./swingSignals";
import { computeSwingLevels } from "./swingSignals";
import type { StockRow } from "@workspace/api-zod";
import { checkLedgerReconciliationGate } from "./paperAccountReconciliation";
import { computePreliminaryAdmission, computeFinalExecutionAdmission, EQUITY_AUTO_ENTRY_CUTOFF } from "./sessionAdmission";
import { buildEquityFillEvidence, buildEquityInsertCore, buildEvidencePersistenceSnapshot, type EquityFillEvidence, type ValidatedFillEvidence } from "./equityFillEvidence";

function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : parseFloat(v);
}

function toDbNumeric(n: number, scale = 4): string {
  return Number.isFinite(n) ? n.toFixed(scale) : "0";
}

function istDateKey(d: Date = new Date()): string {
  return new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export type EquityExitReason =
  | "TARGET2_HIT"
  | "STOPPED"
  | "TRAIL_STOP_HIT"
  | "TIME_STOP"
  | "SIGNAL_FLIP"
  | "MANUAL_OVERRIDE";

// ---------------------------------------------------------------------------
// Lifecycle provenance schema migration (Checkpoint 2, 2026-07-03, additive)
// ---------------------------------------------------------------------------

/**
 * Maps the write-path `opts.source` to the richer stored provenance.
 * `SWING_STAGED_APPROVAL` maps to the same-named DB enum value, representing
 * a paper trade opened from the swing staging queue after owner approval.
 */
export function mapWriteSourceToProvenance(source: "AUTO" | "MANUAL" | "SWING_STAGED_APPROVAL" | undefined): PaperTradeEqSource {
  if (source === "MANUAL") return "MANUAL_BUY";
  if (source === "SWING_STAGED_APPROVAL") return "SWING_STAGED_APPROVAL";
  return "AUTO_STRONG_BUY";
}

/**
 * Add the lifecycle-provenance columns to `paper_trade_eq` / `paper_eq_audit`
 * if they do not already exist, then run a one-time idempotent backfill for
 * rows written before these columns existed. Mirrors the proven
 * `swingTtlSweep.ts` / `fnoExitMonitorHealth.ts` pattern: raw
 * `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — NEVER `drizzle-kit push`,
 * which wants to drop out-of-schema tables in this DB.
 *
 * Backfill steps (each idempotent, safe to re-run):
 *   1. Correlate `paper_eq_audit` OPENED rows to `paper_trade_eq` by
 *      (symbol, IST-calendar-day(ts) == signal_date) — the two writes
 *      happen seconds apart in the same request, and the trade table's
 *      (symbol, signal_date) uniqueness makes this a safe join key.
 *      AUTO -> AUTO_STRONG_BUY, MANUAL -> MANUAL_BUY.
 *   2. Any trade row still without a source after that correlation is
 *      honestly labelled LEGACY_UNKNOWN — never fabricated as AUTO/MANUAL.
 *   3. Symmetrically back-link `paper_eq_audit.paper_trade_id` for any
 *      OPENED row that matches an existing trade row (best-effort; new
 *      rows are linked directly at write time instead, see
 *      `openPaperEquityTrade`).
 */
export async function applyPaperEqProvenanceColumns(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE paper_trade_eq
      ADD COLUMN IF NOT EXISTS source TEXT,
      ADD COLUMN IF NOT EXISTS staged_order_id TEXT
  `);
  await db.execute(sql`
    ALTER TABLE paper_eq_audit
      ADD COLUMN IF NOT EXISTS paper_trade_id TEXT
  `);
  await db.execute(sql`
    UPDATE paper_trade_eq t
       SET source = CASE a.source WHEN 'MANUAL' THEN 'MANUAL_BUY' ELSE 'AUTO_STRONG_BUY' END
      FROM paper_eq_audit a
     WHERE t.source IS NULL
       AND a.decision = 'OPEN'
       AND a.symbol = t.symbol
       AND (a.ts AT TIME ZONE 'Asia/Kolkata')::date = t.signal_date
  `);
  await db.execute(sql`
    UPDATE paper_trade_eq
       SET source = 'LEGACY_UNKNOWN'
     WHERE source IS NULL
  `);
  await db.execute(sql`
    UPDATE paper_eq_audit a
       SET paper_trade_id = t.id
      FROM paper_trade_eq t
     WHERE a.paper_trade_id IS NULL
       AND a.decision = 'OPEN'
       AND a.symbol = t.symbol
       AND (a.ts AT TIME ZONE 'Asia/Kolkata')::date = t.signal_date
  `);
}

let paperEqProvenanceMigrationPromise: Promise<void> | null = null;

/**
 * Memoized, idempotent schema-ready gate — first caller triggers the
 * migration + backfill; every subsequent caller (this process lifetime)
 * awaits the same resolved promise. On failure the promise is cleared so a
 * later call can retry (a transient DB blip should not permanently wedge
 * equity paper trading).
 */
export function ensurePaperEqProvenanceColumns(): Promise<void> {
  if (!paperEqProvenanceMigrationPromise) {
    paperEqProvenanceMigrationPromise = applyPaperEqProvenanceColumns().catch((err: unknown) => {
      paperEqProvenanceMigrationPromise = null;
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "paper eq provenance: schema column migration failed, will retry on next check",
      );
      throw err;
    });
  }
  return paperEqProvenanceMigrationPromise;
}

// ---------------------------------------------------------------------------
// P0.3 fill-evidence schema-readiness check (2026-07-23)
// ---------------------------------------------------------------------------
//
// The seven fill-evidence columns must be present BEFORE the application
// starts serving trade requests. They are NOT created by the application at
// runtime. To add them, run the controlled owner-run migration:
//
//   docs/migrations/paper_trade_eq_fill_evidence.sql
//
// The INSERT in openPaperEquityTrade() references all seven columns via the
// Drizzle schema. If any column is absent the INSERT fails with a PostgreSQL
// "column does not exist" error (fail closed). For an earlier, diagnostic-
// rich failure, call assertPaperEqEvidenceColumnsPresent() at start-up.

/**
 * One row returned by the preflight metadata query.
 * Exported so the pure verifyEvidenceColumnDefs() function can be tested
 * without a real database connection.
 */
export interface EvidenceSchemaRow {
  [key: string]: unknown;
  column_name: string;
  data_type: string;
  is_nullable: string;
  numeric_precision: number | null;
  numeric_scale: number | null;
  column_default: string | null;
  table_schema: string;
}

/** Per-column type + precision contract for the seven P0.3 evidence fields. */
interface EvidenceColSpec {
  dataType: string;
  numericPrecision: number | null;
  numericScale: number | null;
}

/**
 * Authoritative type/constraint specification for all seven P0.3 evidence
 * columns on `public.paper_trade_eq`. Used by `verifyEvidenceColumnDefs()`
 * and exported so pure tests can build conforming and non-conforming rows.
 *
 *   fill_provider          TEXT      nullable  no default
 *   fill_provider_ts       TIMESTAMPTZ nullable no default
 *   fill_decision_time     TIMESTAMPTZ nullable no default
 *   fill_computed_age_sec  NUMERIC(10,3) nullable no default
 *   fill_policy_id         TEXT      nullable  no default
 *   fill_policy_max_age_sec NUMERIC(10,3) nullable no default
 *   fill_evidence_version  TEXT      nullable  no default
 */
export const EVIDENCE_COLUMN_SPECS: Record<string, EvidenceColSpec> = {
  fill_provider:           { dataType: "text",                     numericPrecision: null, numericScale: null },
  fill_provider_ts:        { dataType: "timestamp with time zone", numericPrecision: null, numericScale: null },
  fill_decision_time:      { dataType: "timestamp with time zone", numericPrecision: null, numericScale: null },
  fill_computed_age_sec:   { dataType: "numeric",                  numericPrecision: 10,   numericScale: 3   },
  fill_policy_id:          { dataType: "text",                     numericPrecision: null, numericScale: null },
  fill_policy_max_age_sec: { dataType: "numeric",                  numericPrecision: 10,   numericScale: 3   },
  fill_evidence_version:   { dataType: "text",                     numericPrecision: null, numericScale: null },
};

/**
 * Pure verification — no DB access, no side effects.
 *
 * Accepts rows from an `information_schema.columns` query for
 * `public.paper_trade_eq` and checks that every P0.3 evidence column:
 *   - is present in schema 'public' (rejects same-named table in another schema)
 *   - has the exact expected data_type
 *   - is nullable (is_nullable = 'YES')
 *   - has the correct numeric_precision and numeric_scale
 *   - has no column_default
 *
 * Returns { ok: true } on success.
 * Returns { ok: false; errors: string[] } on any mismatch — never throws,
 * never repairs, never issues DDL.
 */
export function verifyEvidenceColumnDefs(
  rows: EvidenceSchemaRow[],
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const byName = new Map(rows.map((r) => [r.column_name, r]));

  for (const [colName, spec] of Object.entries(EVIDENCE_COLUMN_SPECS)) {
    const row = byName.get(colName);
    if (!row) {
      errors.push(`[MISSING] '${colName}' absent from public.paper_trade_eq`);
      continue;
    }
    if (row.table_schema !== "public") {
      errors.push(`[WRONG_SCHEMA] '${colName}': expected table_schema='public', got '${row.table_schema}'`);
    }
    if (row.data_type !== spec.dataType) {
      errors.push(`[WRONG_TYPE] '${colName}': expected '${spec.dataType}', got '${row.data_type}'`);
    }
    if (row.is_nullable !== "YES") {
      errors.push(`[NOT_NULLABLE] '${colName}': expected is_nullable='YES', got '${row.is_nullable}'`);
    }
    if (spec.numericPrecision !== null && row.numeric_precision !== spec.numericPrecision) {
      errors.push(`[WRONG_PRECISION] '${colName}': expected numeric_precision=${spec.numericPrecision}, got ${String(row.numeric_precision)}`);
    }
    if (spec.numericScale !== null && row.numeric_scale !== spec.numericScale) {
      errors.push(`[WRONG_SCALE] '${colName}': expected numeric_scale=${spec.numericScale}, got ${String(row.numeric_scale)}`);
    }
    if (row.column_default !== null) {
      errors.push(`[UNEXPECTED_DEFAULT] '${colName}': has default='${row.column_default}', expected null`);
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

let evidenceColumnsVerified = false;

/**
 * Read-only preflight: queries information_schema.columns in schema 'public'
 * and verifies all seven P0.3 evidence columns have the exact expected type,
 * nullability, precision/scale, and no default. Fails closed with a precise
 * diagnostic if any definition is absent or mismatched. Never creates, alters,
 * or drops columns.
 *
 * Caches success for the process lifetime (one DB round-trip total).
 * On failure the cache is not set so the next call re-checks.
 */
export async function assertPaperEqEvidenceColumnsPresent(): Promise<void> {
  if (evidenceColumnsVerified) return;
  const result = await db.execute<EvidenceSchemaRow>(sql`
    SELECT
      column_name,
      data_type,
      is_nullable,
      numeric_precision,
      numeric_scale,
      column_default,
      table_schema
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'paper_trade_eq'
      AND column_name IN (
        'fill_provider', 'fill_provider_ts', 'fill_decision_time',
        'fill_computed_age_sec', 'fill_policy_id', 'fill_policy_max_age_sec',
        'fill_evidence_version'
      )
  `);
  const verification = verifyEvidenceColumnDefs(result.rows);
  if (!verification.ok) {
    throw new Error(
      `P0.3 schema mismatch — public.paper_trade_eq evidence columns have incorrect definitions:\n` +
        verification.errors.map((e) => `  · ${e}`).join("\n") + "\n" +
        `Run the controlled migration at docs/migrations/paper_trade_eq_fill_evidence.sql ` +
        `using the owner-run procedure documented in that file.`,
    );
  }
  evidenceColumnsVerified = true;
}

/**
 * Try to open a paper equity trade for the given SwingSignal. Returns
 * the inserted row on success, or null with a logged reason on every
 * kind of skip (cap, sizing, balance, duplicate).
 *
 * Single transaction:
 *   SELECT FOR UPDATE on the EQUITY account row
 *   → re-check day-trade cap and concurrent-open cap
 *   → INSERT (with ON CONFLICT DO NOTHING on the symbol+day index)
 *   → conditional UPDATE that debits cash and bumps day counters,
 *     re-asserting cap predicates as defence-in-depth.
 *
 * Idempotent on (symbol, signalDate) — a second call short-circuits
 * to the existing row without re-debiting.
 */
export async function openPaperEquityTrade(
  signal: SwingSignal,
  opts?: {
    qtyOverride?: number;
    source?: "AUTO" | "MANUAL" | "SWING_STAGED_APPROVAL";
    signalLabel?: string;
    stagedOrderId?: string | null;
    /**
     * Phase B final execution quote context (P0.2 Corrections 1–4).
     * Required for MANUAL opens. Absent or invalid context fails closed with
     * TRADE_ADMISSION_CONTEXT_INCOMPLETE. AUTO/STAGED lanes never reach Phase B
     * today (EQUITY_AUTO_ENTRY_CUTOFF=null fires first), but Phase B is wired
     * so that configuring a cutoff later cannot silently bypass quote validation.
     *
     * Build with: `buildEquityFillEvidence(row)` — price and timestamp are taken
     * from the same row.quote object so they are inseparably from the same
     * upstream Kite event. `decisionTime` is the captured clock reading at the
     * moment of the open attempt; Phase B derives quote age from
     * (decisionTime − equityFillEvidence.providerQuoteTimestamp) internally.
     */
    finalExecutionQuoteContext?: {
      decisionTime: Date;
      equityFillEvidence: EquityFillEvidence | null;
    } | null;
  },
): Promise<PaperTradeEqRow | null> {
  const sigLabel = opts?.signalLabel ?? "STRONG_BUY";
  const today = signal.signalDate;

  // C0 — P0-02: Non-MANUAL equity auto-open hard-blocked.
  // This in-function gate catches SWING_STAGED_APPROVAL and any future caller
  // that bypasses the outer check in runEquityPaperTradingTick. It executes
  // before ensurePaperEqProvenanceColumns — the first DB access — so the
  // block is provably independent of DB state, session, cutoff, or evidence.
  // MANUAL opens are intentionally exempt: the owner may place override trades
  // from the UI at any time. There is no broker execution path to block here.
  if ((opts?.source ?? "AUTO") !== "MANUAL" && EQUITY_AUTO_OPEN_C0_BLOCKED) {
    logger.info(
      { source: opts?.source ?? "AUTO", symbol: signal.symbol },
      "openPaperEquityTrade: C0 hard-block — non-MANUAL open rejected before any DB access",
    );
    return null;
  }

  // Phase 0.7A — writer-level exchange-identity gate.
  // Every caller (AUTO tick, MANUAL override, staged approval, and any future
  // one) funnels through this function, and `signal.exchange` is persisted
  // verbatim into paper_trade_eq.exchange. A gate placed only in a caller can
  // be bypassed; this one cannot. It runs before any DB access, so the refusal
  // is independent of DB state.
  const signalExchange = normalizeCanonicalExchange(signal.exchange);
  if (signalExchange == null) {
    logger.warn(
      {
        symbol: signal.symbol,
        source: opts?.source ?? "AUTO",
        signalExchange: signal.exchange,
        code: signal.exchange == null || signal.exchange === ""
          ? "CANONICAL_IDENTITY_REQUIRED"
          : "INVALID_EXCHANGE",
      },
      "openPaperEquityTrade: signal is not exchange-qualified — refusing to open before any DB access",
    );
    return null;
  }

  await ensurePaperEqProvenanceColumns();
  await assertPaperEqEvidenceColumnsPresent();

  // Pre-check (lock-free): if a row already exists for this symbol+day,
  // bail out before grabbing the account lock.
  const existing = await db
    .select()
    .from(paperTradeEqTable)
    .where(
      and(
        eq(paperTradeEqTable.symbol, signal.symbol),
        eq(paperTradeEqTable.signalDate, today),
      ),
    )
    .limit(1);
  if (existing.length > 0) return existing[0]!;

  // ─── Market session gate ─────────────────────────────────────────────────
  // Block AUTO and SWING_STAGED_APPROVAL opens outside the NSE equity session
  // (09:15–15:30 IST, Mon–Fri, non-holiday). MANUAL opens bypass this check
  // so the owner can place override trades at any time (e.g. pre-market
  // corrections, after-hours entry from a staged plan).
  // Root-cause fix for invalid-session positions observed in production
  // (2026-05-14 06:13, 2026-05-15 19:34, 2026-07-09 23:41, 2026-07-18 Sat…)
  // — the scanner fires every 60s around the clock; without this gate every
  // overnight tick that found STRONG_BUY candidates opened live positions.
  const openSource = opts?.source ?? "AUTO";
  // P0.2-correction-1: ALL sources (AUTO, MANUAL, SWING_STAGED_APPROVAL) are
  // subject to the session gate. The previous `if (openSource !== "MANUAL")`
  // bypass that allowed after-hours/weekend MANUAL opens has been removed.
  // Manual closes (forceClosePaperEquityTrade) are unaffected — they have no
  // session gate. The route layer also pre-checks the session for MANUAL buys
  // and returns a structured 422 before this writer is even called.
  {
    const phaseA = computePreliminaryAdmission({
      lane: "equity_cash",
      segment: "NSE_EQ",
      instrument: signal.symbol,
      serverTime: new Date(),
      source: openSource as "AUTO" | "MANUAL" | "SWING_STAGED_APPROVAL",
      // EQUITY_AUTO_ENTRY_CUTOFF = null → AUTO/SWING_STAGED_APPROVAL fail closed with
      // ENTRY_CUTOFF_CONFIG_UNAVAILABLE. MANUAL source skips the cutoff check.
      entryCutoffPolicy: EQUITY_AUTO_ENTRY_CUTOFF,
    });
    if (!phaseA.allowed) {
      logger.info(
        { symbol: signal.symbol, reason: phaseA.reason, detail: phaseA.detail, source: openSource },
        "Paper EQ skip: Phase A session admission rejected",
      );
      await recordEqDecision({
        symbol: signal.symbol,
        decision: "SKIP",
        reason: phaseA.reason,
        detail: phaseA.detail,
        signal: sigLabel,
        score: signal.score,
        entry: signal.entryPrice,
        source: openSource,
      });
      return null;
    }
  }

  if (!(signal.entryPrice > 0)) {
    logger.info({ symbol: signal.symbol, entry: signal.entryPrice }, "Paper EQ skip: invalid entry");
    await recordEqDecision({
      symbol: signal.symbol, decision: "SKIP", reason: "INVALID_ENTRY",
      detail: `Invalid entry price ${signal.entryPrice}`, signal: sigLabel, score: signal.score,
      entry: signal.entryPrice, source: opts?.source ?? "AUTO",
    });
    return null;
  }
  if (!(signal.perShareRisk > 0)) {
    logger.info({ symbol: signal.symbol, risk: signal.perShareRisk }, "Paper EQ skip: invalid risk");
    await recordEqDecision({
      symbol: signal.symbol, decision: "SKIP", reason: "INVALID_RISK",
      detail: `Invalid per-share risk ${signal.perShareRisk}`, signal: sigLabel, score: signal.score,
      entry: signal.entryPrice, stop: signal.stopPrice, source: opts?.source ?? "AUTO",
    });
    return null;
  }

  // ─── Pass-1 stop-loss sanity gate ──────────────────────────────────
  // perShareRisk = entryPrice - stopPrice for LONG swings. Reject if
  // the implied stop-distance pct is absurdly tight (noise zone) or
  // absurdly wide (scanner geometry bug — risk per share is unbounded).
  const stopPct = signal.perShareRisk / signal.entryPrice;
  if (stopPct < EQUITY_STOP_SANITY.MIN_STOP_PCT || stopPct > EQUITY_STOP_SANITY.MAX_STOP_PCT) {
    logger.info(
      {
        symbol: signal.symbol,
        entry: signal.entryPrice,
        stop: signal.stopPrice,
        stopPct: +stopPct.toFixed(4),
        floor: EQUITY_STOP_SANITY.MIN_STOP_PCT,
        ceiling: EQUITY_STOP_SANITY.MAX_STOP_PCT,
      },
      "Paper EQ skip: stop-loss outside sanity bounds (1%–8%)",
    );
    await recordEqDecision({
      symbol: signal.symbol, decision: "SKIP", reason: "STOP_SANITY",
      detail: `Stop ${(stopPct * 100).toFixed(2)}% outside sanity bounds (${(EQUITY_STOP_SANITY.MIN_STOP_PCT * 100).toFixed(0)}–${(EQUITY_STOP_SANITY.MAX_STOP_PCT * 100).toFixed(0)}%)`,
      signal: sigLabel, score: signal.score,
      entry: signal.entryPrice, stop: signal.stopPrice, source: opts?.source ?? "AUTO",
      emitEvent: opts?.source === "MANUAL" ? {
        type: "BUY_SKIPPED", title: `${signal.symbol} buy rejected`, severity: "warn",
      } : undefined,
    });
    return null;
  }

  // ─── Pass-1 portfolio drawdown caps (D / W / M) ────────────────────
  // Sticky-once-hit. Daily 2% / Weekly 4% / Monthly 8% of seed.
  const [eqDaily, eqWeekly, eqMonthly] = await Promise.all([
    getEqDailyRealizedDrawdown(),
    getEqWeeklyRealizedDrawdown(),
    getEqMonthlyRealizedDrawdown(),
  ]);
  if (eqDaily.capReached) {
    logger.info(
      { symbol: signal.symbol, drawdownPct: +eqDaily.drawdownPct.toFixed(4),
        capPct: EQUITY_DD_CAPS.MAX_DAILY_LOSS_PCT },
      "Paper EQ skip: daily DD cap reached (sticky)",
    );
    await recordEqDecision({
      symbol: signal.symbol, decision: "SKIP", reason: "DD_DAILY",
      detail: `Daily DD cap reached: ${(eqDaily.drawdownPct * 100).toFixed(2)}% > ${(EQUITY_DD_CAPS.MAX_DAILY_LOSS_PCT * 100).toFixed(2)}%`,
      signal: sigLabel, score: signal.score, source: opts?.source ?? "AUTO",
    });
    return null;
  }
  if (eqWeekly.capReached) {
    logger.info(
      { symbol: signal.symbol, drawdownPct: +eqWeekly.drawdownPct.toFixed(4),
        capPct: EQUITY_DD_CAPS.MAX_WEEKLY_LOSS_PCT },
      "Paper EQ skip: weekly DD cap reached (sticky)",
    );
    await recordEqDecision({
      symbol: signal.symbol, decision: "SKIP", reason: "DD_WEEKLY",
      detail: `Weekly DD cap reached: ${(eqWeekly.drawdownPct * 100).toFixed(2)}% > ${(EQUITY_DD_CAPS.MAX_WEEKLY_LOSS_PCT * 100).toFixed(2)}%`,
      signal: sigLabel, score: signal.score, source: opts?.source ?? "AUTO",
    });
    return null;
  }
  if (eqMonthly.capReached) {
    logger.info(
      { symbol: signal.symbol, drawdownPct: +eqMonthly.drawdownPct.toFixed(4),
        capPct: EQUITY_DD_CAPS.MAX_MONTHLY_LOSS_PCT },
      "Paper EQ skip: monthly DD cap reached (sticky)",
    );
    await recordEqDecision({
      symbol: signal.symbol, decision: "SKIP", reason: "DD_MONTHLY",
      detail: `Monthly DD cap reached: ${(eqMonthly.drawdownPct * 100).toFixed(2)}% > ${(EQUITY_DD_CAPS.MAX_MONTHLY_LOSS_PCT * 100).toFixed(2)}%`,
      signal: sigLabel, score: signal.score, source: opts?.source ?? "AUTO",
    });
    return null;
  }

  await ensureDailyReset("EQUITY");

  // Ledger reconciliation gate — fail-closed. Sits AFTER the C0 hard-block
  // (EQUITY_AUTO_OPEN_C0_BLOCKED) and BEFORE the account lock transaction
  // so it never holds a DB row lock unnecessarily.
  {
    const reconcGate = await checkLedgerReconciliationGate("EQUITY");
    if (reconcGate.blocked) {
      logger.warn(
        { symbol: signal.symbol, reason: reconcGate.reason, driftAmount: reconcGate.driftAmount },
        "openPaperEquityTrade: ledger reconciliation gate blocked open (fail-closed)",
      );
      await recordEqDecision({
        symbol: signal.symbol,
        decision: "SKIP",
        reason: "LEDGER_RECONCILIATION_FAILED",
        detail: `Ledger gate: ${reconcGate.reason}`,
        signal: sigLabel,
        score: signal.score,
        source: opts?.source ?? "AUTO",
      });
      return null;
    }
  }
  let openedRow: PaperTradeEqRow | null = null;
  try {
    openedRow = await db.transaction(async (tx) => {
      // Lock the EQUITY account row — every concurrent equity open
      // queues here.
      const acctRows = await tx.execute(sql`
        SELECT segment, balance, day_trade_count, day_open_count
          FROM paper_account
         WHERE segment = 'EQUITY'
         FOR UPDATE
      `);
      const rs = (acctRows as unknown as {
        rows: Array<{
          balance: string | number;
          day_trade_count: number;
          day_open_count: number;
        }>;
      }).rows;
      if (rs.length === 0) {
        logger.warn({ symbol: signal.symbol }, "Paper EQ skip: no EQUITY account row (seed missing)");
        await recordEqDecision({
          symbol: signal.symbol, decision: "SKIP", reason: "NO_ACCT",
          detail: "No EQUITY account row (seed missing)",
          signal: sigLabel, score: signal.score, source: opts?.source ?? "AUTO",
        });
        return null;
      }
      const balance = num(rs[0]!.balance);
      const dayCount = rs[0]!.day_trade_count;
      const openCount = rs[0]!.day_open_count;

      if (dayCount >= EQUITY_RISK.MAX_NEW_PER_DAY) {
        logger.info(
          { symbol: signal.symbol, dayCount },
          "Paper EQ skip: daily new-entry cap reached",
        );
        await recordEqDecision({
          symbol: signal.symbol, decision: "SKIP", reason: "DAILY_CAP",
          detail: `Daily new-entry cap reached: ${dayCount} ≥ ${EQUITY_RISK.MAX_NEW_PER_DAY}`,
          signal: sigLabel, score: signal.score, balance, source: opts?.source ?? "AUTO",
        });
        return null;
      }
      if (openCount >= EQUITY_RISK.MAX_CONCURRENT) {
        logger.info(
          { symbol: signal.symbol, openCount },
          "Paper EQ skip: concurrent-open cap reached",
        );
        await recordEqDecision({
          symbol: signal.symbol, decision: "SKIP", reason: "CONCURRENT_CAP",
          detail: `Concurrent-open cap reached: ${openCount} ≥ ${EQUITY_RISK.MAX_CONCURRENT}`,
          signal: sigLabel, score: signal.score, balance, source: opts?.source ?? "AUTO",
        });
        return null;
      }

      // Account value = cash balance + book value of OPEN positions.
      // We compute book value as Σ(qty × entryPrice) — i.e. capital
      // deployed at entry, which is also exactly what was debited from
      // balance. This means (balance + bookValue) is invariant of
      // unrealised P&L, so position sizing is always reproducible
      // from cash alone and never grows just because open positions
      // happened to run up.
      const bookRows = await tx.execute(sql`
        SELECT COALESCE(SUM(capital_deployed), 0) AS book_value
          FROM paper_trade_eq
         WHERE status = 'OPEN'
      `);
      const bookValue = num(
        (bookRows as unknown as { rows: Array<{ book_value: string | number }> }).rows[0]
          ?.book_value,
      );
      const accountValue = balance + bookValue;

      // per_position = account_value / max(BASE_SLOTS, open_count + 1)
      // — reserves room for the position we're about to open.
      const slots = Math.max(EQUITY_RISK.BASE_SLOTS, openCount + 1);
      const perPosition = accountValue / slots;
      const deploy = Math.min(perPosition, balance);
      if (!(deploy > 0)) {
        logger.info(
          { symbol: signal.symbol, accountValue, balance, slots },
          "Paper EQ skip: deploy <= 0 (no capital available)",
        );
        await recordEqDecision({
          symbol: signal.symbol, decision: "SKIP", reason: "DEPLOY_LE_0",
          detail: `No deployable capital — balance ₹${balance.toFixed(2)}, accountValue ₹${accountValue.toFixed(2)}`,
          signal: sigLabel, score: signal.score,
          entry: signal.entryPrice, balance, accountValue, source: opts?.source ?? "AUTO",
        });
        return null;
      }
      const autoQty = Math.floor(deploy / signal.entryPrice);
      const qty = opts?.qtyOverride && opts.qtyOverride > 0
        ? Math.floor(opts.qtyOverride)
        : autoQty;
      if (qty < 1) {
        // Surface the depleted-account case explicitly. When deploy is
        // tiny (a few rupees) the issue is almost never "price too high"
        // — it's that the EQ account balance was drained by losing
        // trades / never seeded. Logging accountValue + balance here
        // makes that obvious without having to query the DB.
        const accountDepleted = accountValue < signal.entryPrice;
        logger.info(
          {
            symbol: signal.symbol,
            deploy: +deploy.toFixed(2),
            entry: signal.entryPrice,
            balance: +balance.toFixed(2),
            accountValue: +accountValue.toFixed(2),
            slots,
            hint: accountDepleted
              ? "EQ account is depleted relative to entry price — top up via /api/paper/topup or wait for daily reset"
              : "perPosition allocation < 1 share at this entry; consider widening BASE_SLOTS or trimming open count",
          },
          "Paper EQ skip: qty < 1 (capital per slot insufficient for entry price)",
        );
        await recordEqDecision({
          symbol: signal.symbol, decision: "SKIP", reason: "QTY_LT_1",
          detail: accountDepleted
            ? `Account depleted: deploy ₹${deploy.toFixed(2)} < entry ₹${signal.entryPrice.toFixed(2)} (balance ₹${balance.toFixed(2)})`
            : `Per-slot allocation < 1 share: deploy ₹${deploy.toFixed(2)} / entry ₹${signal.entryPrice.toFixed(2)} (slots ${slots})`,
          signal: sigLabel, score: signal.score,
          entry: signal.entryPrice, deploy, balance, accountValue, source: opts?.source ?? "AUTO",
          emitEvent: opts?.source === "MANUAL" ? {
            type: "BUY_SKIPPED", title: `${signal.symbol} buy rejected`, severity: "warn",
          } : undefined,
        });
        return null;
      }
      const capitalDeployed = qty * signal.entryPrice;
      if (balance < capitalDeployed) {
        logger.info(
          { symbol: signal.symbol, capitalDeployed, balance },
          "Paper EQ skip: insufficient balance after rounding",
        );
        await recordEqDecision({
          symbol: signal.symbol, decision: "SKIP", reason: "INSUFF_BAL",
          detail: `Insufficient balance after rounding: needed ₹${capitalDeployed.toFixed(2)}, have ₹${balance.toFixed(2)}`,
          signal: sigLabel, score: signal.score,
          entry: signal.entryPrice, qty, deploy: capitalDeployed, balance, source: opts?.source ?? "AUTO",
        });
        return null;
      }

      // ─── Pass-2B portfolio heat cap (EQUITY-segment) ───────────────
      // Sum of ₹-at-risk across every OPEN equity position must stay
      // below MAX_EQ_HEAT_PCT × seed. New trade's risk = qty × per-share
      // risk (entry - stop). Computed inside the txn so concurrent
      // closes that just freed up heat are honoured. FAIL CLOSED — we
      // do NOT silently shrink (would invalidate the planned RR).
      // Reads via tx.execute so the snapshot honours the account-row
      // FOR UPDATE lock — concurrent opens can't both pass the cap and
      // then collectively breach it on commit.
      const currentEqHeat = parseHeatRow(await tx.execute(HEAT_SQL_EQ));
      const newTradeHeat = qty * signal.perShareRisk;
      const projectedHeat = currentEqHeat + newTradeHeat;
      const heatCap = SEED_CAPITAL.EQUITY * PORTFOLIO_HEAT.MAX_EQ_HEAT_PCT;
      if (projectedHeat > heatCap) {
        logger.info(
          {
            symbol: signal.symbol,
            currentHeat: +currentEqHeat.toFixed(2),
            newTradeHeat: +newTradeHeat.toFixed(2),
            projectedHeat: +projectedHeat.toFixed(2),
            heatCap: +heatCap.toFixed(2),
            maxHeatPct: PORTFOLIO_HEAT.MAX_EQ_HEAT_PCT,
          },
          `Paper EQ skip: portfolio heat cap would be breached (${(projectedHeat / SEED_CAPITAL.EQUITY * 100).toFixed(2)}% > ${(PORTFOLIO_HEAT.MAX_EQ_HEAT_PCT * 100).toFixed(2)}%)`,
        );
        await recordEqDecision({
          symbol: signal.symbol, decision: "SKIP", reason: "HEAT_CAP",
          detail: `Heat cap would be breached: ${(projectedHeat / SEED_CAPITAL.EQUITY * 100).toFixed(2)}% > ${(PORTFOLIO_HEAT.MAX_EQ_HEAT_PCT * 100).toFixed(2)}%`,
          signal: sigLabel, score: signal.score,
          entry: signal.entryPrice, stop: signal.stopPrice, qty, source: opts?.source ?? "AUTO",
        });
        return null;
      }

      // ── Phase B — Final execution admission ─────────────────────────────
      // Must pass immediately before the durable insert. All quote fields are
      // mandatory — absent/invalid context fails closed with
      // TRADE_ADMISSION_CONTEXT_INCOMPLETE. AUTO/STAGED lanes are currently
      // blocked earlier by ENTRY_CUTOFF_CONFIG_UNAVAILABLE (Phase A), but
      // Phase B is wired here so configuring a cutoff later cannot silently
      // bypass quote-context validation.
      //
      // P0.2 Corrections 1–4: Phase B now requires a canonical EquityFillEvidence
      // object. Quote age is derived internally from (decisionTime − ev.providerQuoteTimestamp)
      // — the caller no longer supplies a pre-computed age. On success, validatedFill.price
      // is the Phase-B-approved fill price and must be used for entryPrice/lastPrice below.
      let validatedFill: ValidatedFillEvidence | null = null;
      {
        const fxCtx = opts?.finalExecutionQuoteContext;
        const fxAdmission = computeFinalExecutionAdmission({
          lane: "equity_cash",
          segment: "NSE_EQ",
          instrument: signal.symbol,
          decisionTime: fxCtx?.decisionTime ?? new Date(),
          source: openSource as "AUTO" | "MANUAL" | "SWING_STAGED_APPROVAL",
          entryCutoffPolicy: EQUITY_AUTO_ENTRY_CUTOFF,
          equityFillEvidence: fxCtx?.equityFillEvidence ?? null,
        });
        if (!fxAdmission.allowed) {
          logger.info(
            {
              symbol: signal.symbol,
              reason: fxAdmission.reason,
              detail: fxAdmission.detail,
              source: openSource,
              quoteProvenance: fxAdmission.quoteProvenance,
            },
            "Paper EQ skip: Phase B final execution admission rejected",
          );
          await recordEqDecision({
            symbol: signal.symbol,
            decision: "SKIP",
            reason: fxAdmission.reason,
            detail: fxAdmission.detail,
            signal: sigLabel,
            score: signal.score,
            entry: signal.entryPrice,
            source: opts?.source ?? "AUTO",
          });
          return null;
        }
        validatedFill = fxAdmission.validatedFill;
      }

      // Phase B must have passed above; validatedFill is non-null here.
      // The guard below is unreachable in normal execution but narrows the type.
      if (!validatedFill) return null;

      // P0.2 Corrections 3+4 (integration): buildEquityInsertCore is the single
      // mapping seam for the five validated-fill fields. W-1, W-2, W-6 exercise
      // this same function — not a parallel copy — so writer and tests share one
      // code path.
      const insertCore = buildEquityInsertCore(validatedFill);
      // P0.3 — snapshot all seven evidence fields from the same validatedFill
      // object; they are written atomically in the INSERT below. There is no
      // separate UPDATE after commit — a rollback removes both the trade row
      // and its evidence in a single operation.
      const evidenceSnapshot = buildEvidencePersistenceSnapshot(validatedFill);

      const now = signal.triggeredAt;
      const inserted = await tx
        .insert(paperTradeEqTable)
        .values({
          symbol: insertCore.symbol,                          // validatedFill.instrument (Phase-B verified)
          name: signal.name,
          // Phase 0.7A: persist the value the gate validated, not the raw field —
          // " nse " passes normalisation but must never be stored as its own
          // representation of the same order book.
          exchange: signalExchange,
          signalDate: today,
          signalTriggeredAt: now,
          qty,
          entryPrice: toDbNumeric(insertCore.entryPrice, 4), // validatedFill.price
          stopPrice: toDbNumeric(signal.stopPrice, 4),
          target1Price: toDbNumeric(signal.target1Price, 4),
          target2Price: toDbNumeric(signal.target2Price, 4),
          trailedToT1: 0,
          capitalDeployed: toDbNumeric(capitalDeployed, 2),
          lastPrice: toDbNumeric(insertCore.lastPrice, 4),   // validatedFill.price
          lastEvaluatedAt: insertCore.lastEvaluatedAt,       // validatedFill.decisionTime
          openedAt: insertCore.openedAt,                     // validatedFill.decisionTime
          status: "OPEN",
          source: mapWriteSourceToProvenance(opts?.source),
          // B.8 provenance tag — stamped on every new row so consumers
          // can distinguish pre-B.8 legacy rows (NULL).
          writerVersion: CURRENT_WRITER_VERSION,
          // P0.3 fill evidence — all 7 fields committed atomically in this
          // INSERT; they are null on every pre-P0.3 legacy row (no backfill).
          fillProvider: evidenceSnapshot.fillProvider,
          fillProviderTs: evidenceSnapshot.fillProviderTs,
          fillDecisionTime: evidenceSnapshot.fillDecisionTime,
          fillComputedAgeSec: toDbNumeric(evidenceSnapshot.fillComputedAgeSec, 3),
          fillPolicyId: evidenceSnapshot.fillPolicyId,
          fillPolicyMaxAgeSec: toDbNumeric(evidenceSnapshot.fillPolicyMaxAgeSec, 3),
          fillEvidenceVersion: evidenceSnapshot.fillEvidenceVersion,
        })
        .onConflictDoNothing()
        .returning();
      if (inserted.length === 0) {
        logger.info({ symbol: signal.symbol }, "Paper EQ skip: trade row already exists for symbol+day");
        await recordEqDecision({
          symbol: signal.symbol, decision: "SKIP", reason: "DUPLICATE",
          detail: "Already opened today (symbol+day unique constraint)",
          signal: sigLabel, score: signal.score, source: opts?.source ?? "AUTO",
        });
        return null;
      }

      // Link to the originating staging order when opened from the swing queue.
      // staged_order_id is an out-of-schema column (added via ALTER TABLE in
      // applyPaperEqProvenanceColumns) — set it via raw SQL, never drizzle insert.
      if (opts?.stagedOrderId != null) {
        await tx.execute(
          sql`UPDATE paper_trade_eq SET staged_order_id = ${opts.stagedOrderId} WHERE id = ${inserted[0]!.id}`,
        );
      }

      // Atomic debit + counter bumps. Cap predicates repeated as
      // defence-in-depth even though the FOR UPDATE above already
      // serialised us — keeps the invariants enforced even if a
      // future caller bypasses the lock.
      const debited = await tx
        .update(paperAccountTable)
        .set({
          balance: sql`${paperAccountTable.balance} - ${toDbNumeric(capitalDeployed, 2)}::numeric`,
          dayTradeCount: sql`${paperAccountTable.dayTradeCount} + 1`,
          dayOpenCount: sql`${paperAccountTable.dayOpenCount} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(paperAccountTable.segment, "EQUITY"),
            sql`${paperAccountTable.balance} >= ${toDbNumeric(capitalDeployed, 2)}::numeric`,
            sql`${paperAccountTable.dayTradeCount} < ${EQUITY_RISK.MAX_NEW_PER_DAY}`,
            sql`${paperAccountTable.dayOpenCount} < ${EQUITY_RISK.MAX_CONCURRENT}`,
          ),
        )
        .returning();
      if (debited.length === 0) {
        throw new Error("paper_eq_open_aborted_cap_or_balance");
      }

      logger.info(
        {
          symbol: signal.symbol,
          qty,
          entry: signal.entryPrice,
          stop: signal.stopPrice,
          t1: signal.target1Price,
          t2: signal.target2Price,
          capitalDeployed: capitalDeployed.toFixed(2),
          newBalance: num(debited[0]!.balance),
          score: signal.score,
        },
        "Paper EQ OPENED",
      );
      const isManual = opts?.source === "MANUAL";
      const isSwingApproval = opts?.source === "SWING_STAGED_APPROVAL";
      const actionLabel = isManual ? "Manual" : isSwingApproval ? "Swing queue" : "Auto";
      await recordEqDecision({
        symbol: signal.symbol, decision: "OPEN", reason: "OPENED",
        detail: `${actionLabel} buy filled: ${qty} × ₹${signal.entryPrice.toFixed(2)} (stop ₹${signal.stopPrice.toFixed(2)}, T1 ₹${signal.target1Price.toFixed(2)}, T2 ₹${signal.target2Price.toFixed(2)})`,
        signal: sigLabel, score: signal.score,
        entry: signal.entryPrice, stop: signal.stopPrice, qty,
        deploy: capitalDeployed, balance: num(debited[0]!.balance),
        source: opts?.source ?? "AUTO",
        paperTradeId: inserted[0]!.id,
        emitEvent: {
          type: isManual || isSwingApproval ? "MANUAL_BUY" : "BUY_EXECUTED",
          title: `${isManual ? "Manual buy" : isSwingApproval ? "Swing queue buy" : "Buy filled"}: ${signal.symbol}`,
          severity: "success",
        },
      });
      return inserted[0]!;
    });
  } catch (err) {
    if ((err as Error).message === "paper_eq_open_aborted_cap_or_balance") {
      logger.info(
        { symbol: signal.symbol },
        "Paper EQ skip: txn aborted (cap/balance lost the race)",
      );
      await recordEqDecision({
        symbol: signal.symbol, decision: "SKIP", reason: "TXN_ABORT",
        detail: "Transaction aborted — concurrent open won the cap/balance race",
        signal: sigLabel, score: signal.score, source: opts?.source ?? "AUTO",
      });
      return null;
    }
    throw err;
  }
  return openedRow;
}

/**
 * Close a paper equity trade. CAS on status='OPEN' protects against
 * a second evaluator firing on the same row. Inside one transaction:
 *   - flip the row to CLOSED with exit fields populated
 *   - credit the proceeds back to the EQUITY balance
 *   - decrement day_open_count (clamped at 0)
 *   - accumulate day_realized_pnl
 */
async function closePaperEquityTradeRow(
  row: PaperTradeEqRow,
  exitPrice: number,
  reason: EquityExitReason,
  now: Date,
): Promise<PaperTradeEqRow | null> {
  if (!(exitPrice > 0)) {
    logger.warn({ id: row.id, exitPrice, reason }, "Paper EQ close: refusing non-positive exit price");
    return null;
  }
  const proceeds = exitPrice * row.qty;
  const realizedPnl = (exitPrice - num(row.entryPrice)) * row.qty;

  // P0 Phase A — durable charges for equity delivery. Compute once at
  // close and freeze into the row. Phase B (2026-07-15, owner-approved):
  // balance writer path ALSO subtracts _chargesTotal. Reconciliation
  // identity keys on charges_status so LEGACY rows (which had no such
  // deduction historically) don't produce false drift.
  const _buyTurnover = num(row.entryPrice) * row.qty;
  const _sellTurnover = exitPrice * row.qty;
  const _chargesBreakdown = computeEquityCharges(_buyTurnover, _sellTurnover, 1);
  const _chargesTotal = _chargesBreakdown.total;
  const _grossPnl = realizedPnl;
  const _netPnl = _grossPnl - _chargesTotal;

  return await db.transaction(async (tx) => {
    const updated = await tx
      .update(paperTradeEqTable)
      .set({
        status: "CLOSED",
        exitedAt: now,
        exitPrice: toDbNumeric(exitPrice, 4),
        exitReason: reason,
        realizedPnl: toDbNumeric(realizedPnl, 2),
        lastPrice: toDbNumeric(exitPrice, 4),
        lastEvaluatedAt: now,
        // P0 Phase A — durable charges columns.
        grossPnl: toDbNumeric(_grossPnl, 2),
        chargesTotal: toDbNumeric(_chargesTotal, 2),
        chargesBreakdownJson: _chargesBreakdown as unknown as Record<string, unknown>,
        chargesModelVersion: "EQ_CNC_V1_2026Q1",
        chargesCalculatedAt: now,
        netPnl: toDbNumeric(_netPnl, 2),
        chargesStatus: "CURRENT",
      })
      .where(and(eq(paperTradeEqTable.id, row.id), eq(paperTradeEqTable.status, "OPEN")))
      .returning();
    if (updated.length === 0) return null;
    await tx
      .update(paperAccountTable)
      .set({
        // P0 Phase B — net credit: proceeds − chargesTotal. Balance now
        // reflects cash after brokerage(0 for CNC delivery), STT, exchange,
        // SEBI, GST, stamp, DP charges. dayRealizedPnl stays GROSS for
        // report continuity; per-row net_pnl carries the charges-adjusted P&L.
        balance: sql`${paperAccountTable.balance} + ${toDbNumeric(proceeds - _chargesTotal, 2)}::numeric`,
        dayRealizedPnl: sql`${paperAccountTable.dayRealizedPnl} + ${toDbNumeric(realizedPnl, 2)}::numeric`,
        dayOpenCount: sql`GREATEST(${paperAccountTable.dayOpenCount} - 1, 0)`,
        updatedAt: now,
      })
      .where(eq(paperAccountTable.segment, "EQUITY"));
    logger.info(
      {
        id: row.id,
        symbol: row.symbol,
        reason,
        qty: row.qty,
        entry: num(row.entryPrice),
        exit: exitPrice,
        realizedPnl: realizedPnl.toFixed(2),
      },
      "Paper EQ CLOSED",
    );
    const sevMap: Record<EquityExitReason, "success" | "warn" | "error" | "info"> = {
      TARGET2_HIT: "success",
      TRAIL_STOP_HIT: "success",
      STOPPED: "error",
      SIGNAL_FLIP: "warn",
      TIME_STOP: "info",
      MANUAL_OVERRIDE: "info",
    };
    const typeMap: Record<EquityExitReason, EqEventType> = {
      TARGET2_HIT: "TARGET2_HIT",
      TRAIL_STOP_HIT: "SL_HIT",
      STOPPED: "SL_HIT",
      SIGNAL_FLIP: "SIGNAL_FLIP",
      TIME_STOP: "TIME_STOP",
      MANUAL_OVERRIDE: "MANUAL_CLOSE",
    };
    const titleMap: Record<EquityExitReason, string> = {
      TARGET2_HIT: `Target 2 hit: ${row.symbol}`,
      TRAIL_STOP_HIT: `Trailed stop hit: ${row.symbol}`,
      STOPPED: `Stop loss hit: ${row.symbol}`,
      SIGNAL_FLIP: `Signal flipped — exit: ${row.symbol}`,
      TIME_STOP: `Time stop: ${row.symbol}`,
      MANUAL_OVERRIDE: `Manual close: ${row.symbol}`,
    };
    pushEqEvent({
      type: typeMap[reason],
      symbol: row.symbol,
      title: titleMap[reason],
      detail: `${row.qty} × ₹${num(row.entryPrice).toFixed(2)} → ₹${exitPrice.toFixed(2)} · P&L ₹${realizedPnl.toFixed(0)}`,
      source: reason === "MANUAL_OVERRIDE" ? "manual" : "auto",
      severity: sevMap[reason],
    });
    return updated[0]!;
  });
}

/**
 * Manual paper-buy from the UI. Bypasses the STRONG_BUY / score / sector
 * / volume filters that gate the auto-swing tick, but keeps every
 * capital / risk safety net (stop-sanity 1-8%, daily/weekly/monthly DD
 * caps, MAX_NEW_PER_DAY, MAX_CONCURRENT, balance check, heat cap, and
 * (symbol, signal_date) idempotency).
 *
 * Stop & targets are still derived from `computeSwingLevels` so the
 * lifecycle evaluator (trail-to-T1 / TARGET2_HIT / STOPPED / TIME_STOP)
 * works identically to an auto-opened trade.
 *
 * Caller supplies the `StockRow` from the scanner cache (so this
 * function stays free of any fullNseScanner import — the route handler
 * does the lookup). Returns `{ row, reason }` so the API can surface a
 * meaningful error to the user when a gate rejects the trade.
 */
export async function openManualPaperEquityTrade(
  row: StockRow,
  opts?: { qty?: number },
): Promise<{ row: PaperTradeEqRow | null; reason: string | null }> {
  const today = istDateKey();
  await ensurePaperEqProvenanceColumns();
  await assertPaperEqEvidenceColumnsPresent();
  // Same-day duplicate guard. The DB has a UNIQUE (symbol, signalDate)
  // index and openPaperEquityTrade short-circuits to the existing row
  // on a hit — but it returns that row regardless of status, which the
  // manual route would otherwise mis-report as "Buy filled". Surface
  // the duplicate explicitly here so the UI can show "already traded
  // this symbol today" instead.
  const existing = await db
    .select()
    .from(paperTradeEqTable)
    .where(
      and(
        eq(paperTradeEqTable.symbol, row.symbol),
        eq(paperTradeEqTable.signalDate, today),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    const status = existing[0]!.status;
    return {
      row: null,
      reason: status === "OPEN"
        ? `${row.symbol} already has an OPEN paper position from earlier today — close it before re-entering.`
        : `${row.symbol} was already traded today (status: ${status}). Same-symbol re-entry is blocked until tomorrow.`,
    };
  }
  const ltp = row.quote.price;
  if (!(ltp > 0)) {
    return { row: null, reason: "Invalid LTP for symbol — scanner has no price." };
  }
  const levels = await computeSwingLevels(row.symbol);
  if (!levels) {
    return { row: null, reason: "Insufficient price history to compute ATR/swing-low stop." };
  }
  const entryPrice = ltp;
  const { atr14, swing20Low } = levels;
  const atrStop = entryPrice - 1.5 * atr14;
  const stopPrice = Math.max(atrStop, swing20Low);
  if (!(stopPrice > 0) || stopPrice >= entryPrice) {
    return { row: null, reason: "Computed stop is at or above entry — degenerate setup." };
  }
  const r = entryPrice - stopPrice;
  const target1Price = entryPrice + 2 * r;
  const target2Price = entryPrice + 3 * r;
  // Phase 0.7A: the manual lane must not fabricate an identity for the writer
  // gate to rubber-stamp. The exchange comes from the scanner row's own quote —
  // the listing that was actually priced — and an unqualified row is refused
  // with a reason the UI can show.
  const rowExchange = normalizeCanonicalExchange(row.quote.exchange);
  if (rowExchange == null) {
    return {
      row: null,
      reason: `${row.symbol}: the scanner row does not name a recognised exchange (NSE or BSE), so the position cannot be tied to an exact listing.`,
    };
  }

  const now = new Date();
  const signal: SwingSignal = {
    symbol: row.symbol,
    name: row.name,
    exchange: rowExchange,
    triggeredAt: now,
    signalDate: istDateKey(now),
    score: row.recommendation.score,
    entryPrice,
    stopPrice,
    target1Price,
    target2Price,
    perShareRisk: r,
    atr14,
    swing20Low,
    // ATR and swing-low on this path always come from Yahoo daily bars (delayed).
    levelsSource: "yahoo",
    levelsWarnings: [],
  };
  // ── Phase B quote context (P0.2 Corrections 1–4) ─────────────────────────
  // Build canonical EquityFillEvidence from the scanner row. This bundles
  // fill price (kq.last_price) and provider quote timestamp (new Date(kq.ts))
  // from the same row.quote object so they are inseparably from the same
  // upstream Kite event. Phase B derives quote age internally from
  // (decisionTime − ev.providerQuoteTimestamp); no pre-computed age needed.
  //
  // SOURCE: MODULE_REQUIREMENTS.watchlist.quote.maxFreshnessSec = 120 (requirements.ts:189)
  const decisionTime = new Date();
  const equityFillEvidence = buildEquityFillEvidence(row);
  if (!equityFillEvidence) {
    return {
      row: null,
      reason: "Cannot build fill evidence from scanner row — price must be a positive number and quote timestamp (row.quote.updatedAt) must be a valid finite Date. Ensure the scanner row has Kite provenance with a valid kq.ts event timestamp.",
    };
  }
  const finalExecutionQuoteContext = {
    decisionTime,
    equityFillEvidence,
  };

  logger.info(
    { symbol: row.symbol, entry: entryPrice, stop: stopPrice, t1: target1Price, t2: target2Price, qtyOverride: opts?.qty ?? null, provider: equityFillEvidence.providerIdentity, priceSourceKind: equityFillEvidence.priceSourceKind },
    "Paper EQ manual buy: attempting open",
  );
  const opened = await openPaperEquityTrade(signal, {
    qtyOverride: opts?.qty,
    source: "MANUAL",
    signalLabel: row.recommendation.signal,
    finalExecutionQuoteContext,
  });
  if (!opened) {
    return {
      row: null,
      reason: "Trade rejected by a safety gate (cap, balance, drawdown, heat, or duplicate). See server logs for the specific reason.",
    };
  }
  return { row: opened, reason: null };
}

/**
 * Manual exit from the UI. Closes at the row's lastPrice (the most
 * recent LTP we marked the row to), so the trader sees the same number
 * shown in their open-positions view at the moment they clicked.
 */
export async function forceClosePaperEquityTrade(id: string): Promise<PaperTradeEqRow | null> {
  const rows = await db
    .select()
    .from(paperTradeEqTable)
    .where(and(eq(paperTradeEqTable.id, id), eq(paperTradeEqTable.status, "OPEN")))
    .limit(1);
  if (rows.length === 0) return null;
  const row = rows[0]!;
  return await closePaperEquityTradeRow(
    row,
    num(row.lastPrice) || num(row.entryPrice),
    "MANUAL_OVERRIDE",
    new Date(),
  );
}

/**
 * Count IST trading days (Mon–Fri) STRICTLY BETWEEN the open date and
 * the now date, exclusive of the open date itself, inclusive of the
 * now date if it is a weekday. Ignores exchange holidays — the user's
 * 30-day time-stop is loose enough that a 1–2 day drift never changes
 * the decision in practice.
 *
 * Implementation walks IST CALENDAR DAY KEYS (not 24h epoch buckets),
 * so a position opened at 09:30 IST and evaluated at 10:00 IST the
 * next weekday counts as exactly 1 trading day held — never 2 — even
 * after the 24h boundary trips. This was an off-by-one in the prior
 * implementation that could prematurely fire TIME_STOP.
 */
function tradingDaysBetween(open: Date, now: Date): number {
  const istKey = (d: Date) =>
    new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const openKey = istKey(open);
  const nowKey = istKey(now);
  if (nowKey <= openKey) return 0;
  // Walk IST calendar days from openKey+1 up to and including nowKey.
  let count = 0;
  // Anchor at noon UTC on the open IST day to avoid DST/midnight edge
  // cases when stepping in 24h increments.
  const [oy, om, od] = openKey.split("-").map(Number);
  let cursor = Date.UTC(oy!, om! - 1, od!, 12, 0, 0);
  // Step day-by-day, stopping once we've passed nowKey.
  while (true) {
    cursor += 24 * 60 * 60 * 1000;
    const cursorKey = new Date(cursor).toISOString().slice(0, 10);
    if (cursorKey > nowKey) break;
    // Mon–Fri only. UTC day on a noon-anchored cursor matches IST day.
    const dow = new Date(cursor).getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

/**
 * Mark-to-market and apply exit rules for one open row against the
 * latest scanner snapshot for its symbol. Returns the row's terminal
 * state (or the unchanged row when nothing happens).
 */
async function evaluateOne(
  row: PaperTradeEqRow,
  scannerRow: StockRow | null,
  now: Date,
): Promise<void> {
  // No fresh price → fall back to time-stop check only. Refuse to
  // invent a price.
  const ltp = scannerRow?.quote?.price;
  const stop = num(row.stopPrice);
  const t1 = num(row.target1Price);
  const t2 = num(row.target2Price);
  const entry = num(row.entryPrice);
  const trailedToT1 = (row.trailedToT1 ?? 0) > 0;

  // ── 1. SIGNAL_FLIP exit (works even if LTP is missing — the scanner
  //       at least gave us a recommendation).
  if (scannerRow && scannerRow.recommendation.signal === "STRONG_SELL") {
    const exit = ltp != null && ltp > 0 ? ltp : num(row.lastPrice) || entry;
    await closePaperEquityTradeRow(row, exit, "SIGNAL_FLIP", now);
    return;
  }

  if (ltp != null && ltp > 0) {
    // Update MTM + max runup/drawdown FIRST so the close path always
    // reads from the freshest stored levels. CAS on status='OPEN'
    // means a concurrent close still wins cleanly.
    const upnl = (ltp - entry) * row.qty;
    await db
      .update(paperTradeEqTable)
      .set({
        lastPrice: toDbNumeric(ltp, 4),
        lastEvaluatedAt: now,
        maxRunup: sql`GREATEST(${paperTradeEqTable.maxRunup}, ${toDbNumeric(upnl, 2)}::numeric)`,
        maxDrawdown: sql`LEAST(${paperTradeEqTable.maxDrawdown}, ${toDbNumeric(upnl, 2)}::numeric)`,
      })
      .where(and(eq(paperTradeEqTable.id, row.id), eq(paperTradeEqTable.status, "OPEN")));

    // ── 2. T2 hit — full exit.
    if (ltp >= t2) {
      await closePaperEquityTradeRow(row, t2, "TARGET2_HIT", now);
      return;
    }
    // ── 3. Stop hit (use the trailed stop if applicable).
    if (ltp <= stop) {
      const reason: EquityExitReason = trailedToT1 ? "TRAIL_STOP_HIT" : "STOPPED";
      await closePaperEquityTradeRow(row, stop, reason, now);
      return;
    }
    // ── 4. T1 hit and not yet trailed — trail the stop UP to T1.
    //       No partial exit per user spec; ride the rest for T2.
    if (!trailedToT1 && ltp >= t1) {
      const trailRes = await db
        .update(paperTradeEqTable)
        .set({
          trailedToT1: 1,
          stopPrice: toDbNumeric(t1, 4),
          lastEvaluatedAt: now,
        })
        .where(
          and(
            eq(paperTradeEqTable.id, row.id),
            eq(paperTradeEqTable.status, "OPEN"),
            eq(paperTradeEqTable.trailedToT1, 0),
          ),
        )
        .returning();
      if (trailRes.length > 0) {
        logger.info(
          { id: row.id, symbol: row.symbol, ltp, t1, newStop: t1 },
          "Paper EQ trailed stop to T1",
        );
        pushEqEvent({
          type: "TRAIL_TO_T1",
          symbol: row.symbol,
          title: `Stop trailed to T1: ${row.symbol}`,
          detail: `LTP ₹${ltp.toFixed(2)} ≥ T1 ₹${t1.toFixed(2)} — new stop ₹${t1.toFixed(2)}`,
          source: "auto",
          severity: "success",
        });
      }
    }
  }

  // ── 5. Time stop — close at the freshest price we have.
  const days = tradingDaysBetween(row.openedAt, now);
  if (days >= EQUITY_RISK.MAX_HOLD_TRADING_DAYS) {
    const exit = ltp != null && ltp > 0 ? ltp : num(row.lastPrice) || entry;
    await closePaperEquityTradeRow(row, exit, "TIME_STOP", now);
  }
}

/**
 * Re-evaluate every OPEN equity paper trade against the latest
 * scanner snapshot. Called after each fullNseScanner refresh by the
 * background loop.
 */
export async function evaluatePaperEquityTrades(
  scannerRows: readonly StockRow[],
): Promise<void> {
  const open = await db
    .select()
    .from(paperTradeEqTable)
    .where(eq(paperTradeEqTable.status, "OPEN"));
  if (open.length === 0) return;
  const bySymbol = new Map<string, StockRow>();
  for (const r of scannerRows) bySymbol.set(r.symbol, r);
  const now = new Date();
  for (const row of open) {
    try {
      await evaluateOne(row, bySymbol.get(row.symbol) ?? null, now);
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, id: row.id, symbol: row.symbol },
        "Paper EQ evaluator failed for one row, continuing",
      );
    }
  }
}

/**
 * Full per-tick lifecycle: open new positions for fresh STRONG_BUY
 * SwingSignals, then mark-to-market and apply exit rules across every
 * existing OPEN position. Both phases are quiet on per-row failure so
 * one bad symbol never poisons the cycle.
 */
// C0 — P0-02: Equity swing auto-open hard-blocked.
// Root causes: indicators sourced from Yahoo Finance (declared unsuitable for
// signals in source), fill price uses historical-open not trigger-time price.
// Lift ONLY after M2b provenance + fill-price audit passes and sector-gate is
// wired to authoritative symbol-sector mapping.
export const EQUITY_AUTO_OPEN_C0_BLOCKED = true;

export async function runEquityPaperTradingTick(
  scannerRows: readonly StockRow[],
  signals: readonly SwingSignal[],
): Promise<void> {
  // Read-only-mode short-circuit on auto opens. Mark-to-market
  // (`evaluatePaperEquityTrades`) still runs so existing OPEN
  // positions move as expected — we only suppress the auto opener.
  const autoOpensEnabled = isPaperAutoTradingEnabled() && !EQUITY_AUTO_OPEN_C0_BLOCKED;

  // Open new trades first so they participate in this same tick's
  // evaluator pass (cheap because the new row's LTP is by definition
  // its entry → no immediate exit unless ATR was zero, which we
  // already rejected upstream).
  if (autoOpensEnabled) {
    // Belt-and-braces session gate: openPaperEquityTrade also enforces this
    // for ALL sources, but checking here too avoids one DB audit-row write per
    // signal on closed sessions — overnight ticks, weekends, and holidays all
    // become a single log line instead. This path is AUTO-only; MANUAL opens
    // go through the route handler which pre-checks the session before calling
    // openManualPaperEquityTrade → openPaperEquityTrade.
    const tickAdmission = computePreliminaryAdmission({
      lane: "equity_cash",
      segment: "NSE_EQ",
      instrument: "EQUITY_TICK_BELT_BRACES",
      serverTime: new Date(),
      source: "AUTO",
      // Belt-and-braces for the AUTO path. EQUITY_AUTO_ENTRY_CUTOFF = null →
      // fires ENTRY_CUTOFF_CONFIG_UNAVAILABLE during market hours, which correctly
      // suppresses bulk auto-opens until a strategy cutoff is configured.
      entryCutoffPolicy: EQUITY_AUTO_ENTRY_CUTOFF,
    });
    if (!tickAdmission.allowed) {
      logger.info(
        { reason: tickAdmission.reason, signalCount: signals.length },
        "Equity tick: session admission rejected — skipping auto-opens (mark-to-market still runs)",
      );
    } else {
      for (const s of signals) {
        try {
          await openPaperEquityTrade(s);
        } catch (err) {
          logger.warn(
            { err: (err as Error).message, symbol: s.symbol },
            "Paper EQ open failed for one signal, continuing",
          );
        }
      }
    }
  }
  await evaluatePaperEquityTrades(scannerRows);
}

/** True when the symbol currently has an OPEN equity paper trade. */
export async function hasOpenEquityTrade(symbol: string): Promise<boolean> {
  const rows = await db
    .select({ id: paperTradeEqTable.id })
    .from(paperTradeEqTable)
    .where(
      and(
        eq(paperTradeEqTable.symbol, symbol),
        eq(paperTradeEqTable.status, "OPEN"),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Open a paper equity trade from an already-approved swing staging order.
 *
 * Builds the minimum-viable `SwingSignal` from the staging row's frozen plan
 * and delegates to `openPaperEquityTrade`. All safety gates (DD caps, heat
 * cap, stop-sanity, daily limits) still apply — an approved staging row is
 * NOT guaranteed to open if a cap was hit after approval.
 *
 * The staging row's `quantity` is used as `qtyOverride` so the pre-computed
 * sizing (set at stage time with full risk calculations) is stable across the
 * approval delay. The `atr14` is back-derived from the stop distance using
 * the standard 1.5× multiplier — it is only used for audit logging, never
 * for sizing.
 *
 * Returns the opened `PaperTradeEqRow`, or `null` if any gate blocked the
 * open. Never places real broker orders — paper only.
 */
export async function openPaperEquityTradeFromStagedOrder(
  stagingRow: SwingOrderStagingRow,
): Promise<PaperTradeEqRow | null> {
  // Phase 0.7A: the staged row must name the exchange it was staged on. It
  // used to fall back to "NSE", so an order staged without an exchange — or
  // staged on BSE with a malformed value — opened an NSE position under a
  // symbol that may trade on both. A paper position is a persisted financial
  // record: no exact instrument, no trade. This is the FIRST check in the
  // function, before any other work.
  const stagedExchange = normalizeCanonicalExchange(stagingRow.exchange);
  if (stagedExchange == null) {
    logger.warn(
      {
        stagingId: stagingRow.id,
        symbol: stagingRow.symbol,
        stagedExchange: stagingRow.exchange,
        code: stagingRow.exchange == null ? "CANONICAL_IDENTITY_REQUIRED" : "INVALID_EXCHANGE",
      },
      "openPaperEquityTradeFromStagedOrder: staged order is not exchange-qualified — refusing to open",
    );
    return null;
  }

  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const signalDate = ist.toISOString().slice(0, 10);

  const perShareRisk = stagingRow.entryPrice - stagingRow.stopLoss;
  if (!(perShareRisk > 0)) {
    logger.warn(
      { stagingId: stagingRow.id, entry: stagingRow.entryPrice, stop: stagingRow.stopLoss },
      "openPaperEquityTradeFromStagedOrder: invalid per-share risk (entry ≤ stop) — skip",
    );
    return null;
  }
  // ATR(14) is not stored in the staging snapshot; approximate from the stop
  // formula (stop ≈ entry − 1.5 × ATR) so the SwingSignal type contract is
  // satisfied. The value only appears in audit log fields — it does not affect
  // sizing because qtyOverride overrides the quantity calculation entirely.
  const atr14Approx = perShareRisk / 1.5;

  const signal: SwingSignal = {
    symbol: stagingRow.symbol,
    name: stagingRow.symbol,              // no dedicated name column in staging
    exchange: stagedExchange,
    triggeredAt: now,
    signalDate,
    score: 0,                             // score not persisted in staging row
    entryPrice: stagingRow.entryPrice,
    stopPrice: stagingRow.stopLoss,
    target1Price: stagingRow.target1,
    target2Price: stagingRow.target2 ?? stagingRow.target1,
    perShareRisk,
    atr14: atr14Approx,
    swing20Low: stagingRow.stopLoss,      // conservative: swing low ≤ stop level
    levelsSource: "yahoo",                // conservative — original calc was Yahoo-based
    levelsWarnings: ["levels restored from staged snapshot; not re-computed at approval"],
  };

  return openPaperEquityTrade(signal, {
    qtyOverride: stagingRow.quantity,
    source: "SWING_STAGED_APPROVAL",
    stagedOrderId: stagingRow.id,
    signalLabel: "SWING_QUEUE_APPROVED",
  });
}

// `ne`/`istDateKey` re-exported for the routes layer's manual exits.
export { ne, istDateKey };
