/**
 * End-of-day reconciliation (fix-file BUG-31).
 *
 * Runs once per trading day after 15:35 IST: cross-checks the paper ledgers
 * against derivable invariants, persists a row in `reconciliation_report`
 * (raw CREATE TABLE IF NOT EXISTS — never drizzle push), and Telegrams the
 * owner (loud on MISMATCH, quiet single summary otherwise).
 *
 * Checks (paper lanes — live trading does not exist yet, noted as N/A):
 *   FO_OPEN_AFTER_CLOSE     — no F&O paper position may remain OPEN after the
 *                             15:20 force-exit + market close.
 *   FO_CLOSED_MISSING_PNL   — every CLOSED F&O trade must carry realized_pnl.
 *   EQ_CLOSED_MISSING_PNL   — every CLOSED equity trade must carry exit_price
 *                             and realized_pnl.
 *   ACCOUNT_DAY_PNL         — paper_account.day_realized_pnl (FNO) must equal
 *                             Σ realized_pnl of today's closed F&O trades
 *                             (only when the account was reset today).
 *   ACCOUNT_OPEN_COUNT      — paper_account.day_open_count must equal actual
 *                             OPEN row count per segment.
 *
 * B0: EOD_RECONCILIATION_OK is always sent at INFO priority (not WARN).
 * The message distinguishes "checked OK", "skipped — not applicable", and
 * never claims "all checks OK" using language that obscures skipped checks.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { getAppState, setAppState } from "./appStateStore";
import { alertOwner } from "./alerting";
import { logger } from "./logger";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const RUN_AFTER_MIN = 15 * 60 + 35; // 15:35 IST
const CLAIM_KEY_PREFIX = "eod_recon_";
const TICK_MS = 5 * 60_000;

export type CheckStatus = "OK" | "MISMATCH" | "SKIPPED";
export interface ReconCheck {
  id: string;
  status: CheckStatus;
  detail: string;
}
export interface ReconReport {
  istDate: string;
  status: "OK" | "MISMATCH";
  checks: ReconCheck[];
  liveNote: string;
  createdAt: string;
}

function istParts(now: Date = new Date()): { date: string; minutes: number; dow: number } {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return {
    date: ist.toISOString().slice(0, 10),
    minutes: ist.getUTCHours() * 60 + ist.getUTCMinutes(),
    dow: ist.getUTCDay(),
  };
}

let schemaEnsured: Promise<void> | null = null;
function ensureSchema(): Promise<void> {
  schemaEnsured ??= db
    .execute(
      sql`CREATE TABLE IF NOT EXISTS reconciliation_report (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        ist_date DATE NOT NULL UNIQUE,
        status TEXT NOT NULL,
        checks JSONB NOT NULL,
        live_note TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
    )
    .then(() => undefined);
  return schemaEnsured;
}

async function scalar(q: ReturnType<typeof sql>): Promise<number> {
  const r = (await db.execute(q)) as unknown as { rows?: Array<Record<string, unknown>> };
  const row = r.rows?.[0] ?? {};
  const v = Object.values(row)[0];
  return v == null ? 0 : Number(v);
}

export async function buildReconChecks(istDate: string): Promise<ReconCheck[]> {
  const checks: ReconCheck[] = [];

  const foOpen = await scalar(sql`SELECT count(*) FROM paper_trade_fo WHERE status = 'OPEN'`);
  checks.push({
    id: "FO_OPEN_AFTER_CLOSE",
    status: foOpen === 0 ? "OK" : "MISMATCH",
    detail: foOpen === 0 ? "no F&O positions open after close" : `${foOpen} F&O position(s) still OPEN after close (15:20 force-exit missed?)`,
  });

  const foNullPnl = await scalar(sql`SELECT count(*) FROM paper_trade_fo WHERE status = 'CLOSED' AND realized_pnl IS NULL`);
  checks.push({
    id: "FO_CLOSED_MISSING_PNL",
    status: foNullPnl === 0 ? "OK" : "MISMATCH",
    detail: foNullPnl === 0 ? "all closed F&O trades carry realized P&L" : `${foNullPnl} closed F&O trade(s) missing realized_pnl`,
  });

  const eqNull = await scalar(
    sql`SELECT count(*) FROM paper_trade_eq WHERE status = 'CLOSED' AND (realized_pnl IS NULL OR exit_price IS NULL)`,
  );
  checks.push({
    id: "EQ_CLOSED_MISSING_PNL",
    status: eqNull === 0 ? "OK" : "MISMATCH",
    detail: eqNull === 0 ? "all closed equity trades carry exit price + P&L" : `${eqNull} closed equity trade(s) missing exit_price/realized_pnl`,
  });

  // Day-P&L consistency — only meaningful when the FNO account was reset today.
  const acctRows = (await db.execute(
    sql`SELECT segment, day_realized_pnl, day_open_count, last_reset_date::text AS lrd FROM paper_account`,
  )) as unknown as { rows?: Array<{ segment: string; day_realized_pnl: string; day_open_count: number; lrd: string | null }> };
  const fnoAcct = acctRows.rows?.find((r) => r.segment === "FNO");
  if (fnoAcct && fnoAcct.lrd === istDate) {
    const sumToday = await scalar(
      sql`SELECT COALESCE(sum(realized_pnl), 0) FROM paper_trade_fo WHERE status = 'CLOSED' AND signal_date = ${istDate}`,
    );
    const ledger = Number(fnoAcct.day_realized_pnl);
    const diff = Math.abs(ledger - sumToday);
    checks.push({
      id: "ACCOUNT_DAY_PNL",
      status: diff <= 1 ? "OK" : "MISMATCH",
      detail: diff <= 1
        ? `FNO day P&L consistent (ledger ₹${ledger.toFixed(2)} vs trades ₹${sumToday.toFixed(2)})`
        : `FNO day P&L mismatch: ledger ₹${ledger.toFixed(2)} vs Σ trades ₹${sumToday.toFixed(2)} (Δ ₹${diff.toFixed(2)})`,
    });
  } else {
    checks.push({ id: "ACCOUNT_DAY_PNL", status: "SKIPPED", detail: "FNO account not reset today (no trading activity for this check)" });
  }

  for (const seg of ["FNO", "EQUITY"] as const) {
    const acct = acctRows.rows?.find((r) => r.segment === seg);
    if (!acct) {
      checks.push({ id: `ACCOUNT_OPEN_COUNT_${seg}`, status: "SKIPPED", detail: "account row absent" });
      continue;
    }
    const actual = seg === "FNO"
      ? await scalar(sql`SELECT count(*) FROM paper_trade_fo WHERE status = 'OPEN'`)
      : await scalar(sql`SELECT count(*) FROM paper_trade_eq WHERE status = 'OPEN'`);
    checks.push({
      id: `ACCOUNT_OPEN_COUNT_${seg}`,
      status: acct.day_open_count === actual ? "OK" : "MISMATCH",
      detail: acct.day_open_count === actual
        ? `open-count ledger matches (${actual})`
        : `ledger day_open_count=${acct.day_open_count} but ${actual} row(s) actually OPEN`,
    });
  }
  return checks;
}

/**
 * PURE — build the EOD reconciliation success message.
 *
 * Exported for unit testing. Deliberately avoids "all checks OK" phrasing
 * when skipped checks exist, so the summary is always honest about coverage.
 */
export function buildEodOkMessage(
  istDate: string,
  checks: ReconCheck[],
): string {
  const okCount = checks.filter((c) => c.status === "OK").length;
  const skipCount = checks.filter((c) => c.status === "SKIPPED").length;
  const totalCount = checks.length;

  if (skipCount === 0) {
    return `EOD reconciliation ${istDate}: all ${okCount} checks passed. Paper ledgers are consistent.`;
  }
  return (
    `EOD reconciliation ${istDate}: ${okCount} of ${totalCount} checks passed; ` +
    `${skipCount} skipped (not applicable — no trading activity for those checks). ` +
    `Paper ledgers are consistent for active checks.`
  );
}

export async function runEodReconciliation(now: Date = new Date(), force = false): Promise<ReconReport | null> {
  const { date, minutes, dow } = istParts(now);
  if (!force) {
    if (dow === 0 || dow === 6) return null;
    if (minutes < RUN_AFTER_MIN) return null;
    if ((await getAppState(`${CLAIM_KEY_PREFIX}${date}`)) !== null) return null;
  }
  await ensureSchema();
  const checks = await buildReconChecks(date);
  const mismatches = checks.filter((c) => c.status === "MISMATCH");
  const report: ReconReport = {
    istDate: date,
    status: mismatches.length > 0 ? "MISMATCH" : "OK",
    checks,
    liveNote: "Live broker reconciliation N/A — live auto-trading not enabled yet (Section G pending).",
    createdAt: new Date().toISOString(),
  };
  await db.execute(
    sql`INSERT INTO reconciliation_report (ist_date, status, checks, live_note)
        VALUES (${date}, ${report.status}, ${JSON.stringify(checks)}::jsonb, ${report.liveNote})
        ON CONFLICT (ist_date) DO UPDATE SET status = EXCLUDED.status, checks = EXCLUDED.checks, created_at = now()`,
  );
  if (!force) await setAppState(`${CLAIM_KEY_PREFIX}${date}`, report.status);

  if (report.status === "MISMATCH") {
    alertOwner(
      "EOD_RECONCILIATION_MISMATCH",
      `EOD reconciliation ${date}: ${mismatches.length} MISMATCH —\n` +
        mismatches.map((m) => `• ${m.id}: ${m.detail}`).join("\n"),
      undefined,
      60 * 60_000,
      `EOD_RECON::${date}`,
      "WARN",
    );
  } else {
    // B0: EOD OK is INFO, not WARN. An OK reconciliation is not an emergency.
    alertOwner(
      "EOD_RECONCILIATION_OK",
      buildEodOkMessage(date, checks),
      undefined,
      60 * 60_000,
      `EOD_RECON::${date}`,
      "INFO", // ← explicit INFO — never WARN for a successful reconciliation
    );
  }
  logger.info({ date, status: report.status, mismatches: mismatches.length }, "EOD reconciliation complete (BUG-31)");
  return report;
}

export async function listReconReports(limit = 14): Promise<Array<Record<string, unknown>>> {
  await ensureSchema();
  const r = (await db.execute(
    sql`SELECT ist_date::text AS ist_date, status, checks, live_note, created_at
        FROM reconciliation_report ORDER BY ist_date DESC LIMIT ${limit}`,
  )) as unknown as { rows?: Array<Record<string, unknown>> };
  return r.rows ?? [];
}

let timer: NodeJS.Timeout | null = null;
export function startEodReconciliationScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    void runEodReconciliation().catch((err) =>
      logger.warn({ err: (err as Error).message }, "EOD reconciliation tick failed"),
    );
  }, TICK_MS);
  timer.unref?.();
  logger.info({ tickMs: TICK_MS }, "EOD reconciliation scheduler started (BUG-31, runs ≥15:35 IST)");
}
