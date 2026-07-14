/**
 * One-off backfill: correct pre-fix backtest trade times that were persisted
 * +5:30 ahead of the true instant.
 *
 * Background (Backtest trade-time timezone fix — 2026-06-05)
 * ---------------------------------------------------------
 * Backtest candle `t` Dates encode the IST WALL CLOCK in their UTC fields
 * (09:15 IST is the instant `09:15:00Z`). The pre-fix emission sites
 * (`directional.ts`, `strategies/runner.ts`) persisted `entryAt`/`exitAt` via a
 * raw `.toISOString()` of that wall-clock-in-UTC Date — stamping `...Z` onto a
 * value that is really IST. A consumer formatting in `Asia/Kolkata` then
 * double-applies +05:30, so a real 13:30 IST exit rendered as "07:00 pm".
 *
 * The code fix (commit "Fix issue with incorrect trade times…") switched those
 * sites to `candleUtcIso()` (= `t.getTime() - IST_OFFSET_MS`), so NEW runs are
 * correct. We deliberately did not migrate old rows in that task. This script
 * is that migration.
 *
 * The error is a deterministic, lossless +05:30 offset, so the correction is a
 * single −05:30 shift on the affected timestamps:
 *   - `backtest_trades.entry_at` / `exit_at`  (DB columns), and
 *   - `backtest_runs.summary->equityCurve[].t` (JSONB; sourced from the same
 *     buggy `exitAt`, so it carries the identical +05:30 error).
 *
 * SCOPE / WHAT IS LEFT ALONE
 *   - Only `modeled = true` trades are candle-derived and therefore buggy
 *     (DIRECTIONAL + STRATEGY_RESEARCH). REAL_REPLAY trades (`modeled = false`)
 *     carry genuine `triggered_at` / `exited_at` timestamps from captured signal
 *     history — these are CORRECT (some legitimately fall outside 09:15–15:30)
 *     and are NEVER touched.
 *   - `dataQuality` / `params` / `strategy_comparison` carry no time-of-day
 *     timestamps (only calendar YYYY-MM-DD windows), so they are untouched.
 *
 * BUGGY-RUN DETECTION (structural, not a date guess)
 *   A run is treated as pre-fix/buggy iff it has at least one `modeled` trade
 *   whose entry or exit falls OUTSIDE the NSE session [09:15, 15:30] IST. A
 *   correct DIRECTIONAL run never produces an off-session modeled trade (entries
 *   ≤15:20 force-exit, exits ≤15:30), so:
 *     - a fully-correct (post-fix) run is never detected and never touched, and
 *     - after the shift no modeled trade is off-session, so a second run is a
 *       no-op. The migration is therefore IDEMPOTENT and FUTURE-SAFE without
 *       relying on `created_at` cutoffs or a schema marker.
 *
 * Safety properties:
 *   - DRY-RUN BY DEFAULT. Pass `--write` to actually mutate.
 *   - All mutations run inside a single transaction (all-or-nothing).
 *   - Per-run trade + summary corrections are applied together, so trades and
 *     their equity curve can never drift out of sync.
 *   - Read-only analytics surface — touches NO signal, gate, sizing, execution,
 *     scheduler, scanner, paper-trade, or P&L path.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run fix-backtest-trade-times            # dry-run
 *   pnpm --filter @workspace/scripts run fix-backtest-trade-times -- --write # apply
 */

import {
  db,
  pool,
  backtestRunsTable,
  backtestTradesTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

/** IST is UTC+05:30 — no DST. Mirrors lib/backtest/time.ts (kept inline so this
 *  leaf script needs no cross-artifact import). */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const SESSION_OPEN_MIN = 9 * 60 + 15; // 09:15 IST
const SESSION_CLOSE_MIN = 15 * 60 + 30; // 15:30 IST

interface CliArgs {
  write: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { write: false };
  for (const a of argv) {
    if (a === "--") continue;
    else if (a === "--write") args.write = true;
    else if (a === "--dry-run") args.write = false;
    else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      printHelp();
      process.exit(1);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(
    [
      "fixBacktestTradeTimes — shift pre-fix backtest trade times back by 05:30",
      "",
      "  --write     Apply the migration (default is dry-run, no mutation).",
      "  --dry-run   Explicitly request a dry-run (the default).",
      "  --help      Show this help.",
    ].join("\n"),
  );
}

/** IST minute-of-day for a true instant. */
function istMinuteOfDay(d: Date): number {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

/** True iff the instant's IST clock is inside the regular NSE session. */
export function inSession(d: Date): boolean {
  const m = istMinuteOfDay(d);
  return m >= SESSION_OPEN_MIN && m <= SESSION_CLOSE_MIN;
}

/** Subtract the IST offset from a true instant (the deterministic correction). */
export function correctInstant(d: Date): Date {
  return new Date(d.getTime() - IST_OFFSET_MS);
}

interface EquityPoint {
  t: string;
  equity: number;
  drawdown: number | null;
}

/**
 * Shift every `equityCurve[].t` ISO string back by 05:30. Pure + exported for
 * tests. Returns a NEW summary object (and a `changed` flag) — non-curve fields
 * are passed through untouched; unparseable `t` values are left as-is.
 */
export function correctSummaryEquityCurve(
  summary: unknown,
): { summary: unknown; changed: boolean } {
  if (summary == null || typeof summary !== "object") {
    return { summary, changed: false };
  }
  const s = summary as { equityCurve?: unknown };
  if (!Array.isArray(s.equityCurve)) return { summary, changed: false };

  let changed = false;
  const curve = (s.equityCurve as EquityPoint[]).map((pt) => {
    if (pt == null || typeof pt.t !== "string" || pt.t === "") return pt;
    const ms = Date.parse(pt.t);
    if (Number.isNaN(ms)) return pt;
    changed = true;
    return { ...pt, t: new Date(ms - IST_OFFSET_MS).toISOString() };
  });
  if (!changed) return { summary, changed: false };
  return { summary: { ...s, equityCurve: curve }, changed: true };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.write ? "WRITE" : "DRY-RUN";
  console.log(`\n[fix-backtest-trade-times] mode=${mode}\n`);

  const runs = await db
    .select({ id: backtestRunsTable.id, mode: backtestRunsTable.mode, summary: backtestRunsTable.summary })
    .from(backtestRunsTable);

  const plans: {
    runId: string;
    mode: string;
    tradesToShift: number;
    summaryChanged: boolean;
    newSummary: unknown;
  }[] = [];

  for (const run of runs) {
    const modeledTrades = await db
      .select({ entryAt: backtestTradesTable.entryAt, exitAt: backtestTradesTable.exitAt })
      .from(backtestTradesTable)
      .where(and(eq(backtestTradesTable.runId, run.id), eq(backtestTradesTable.modeled, true)));

    if (modeledTrades.length === 0) continue;

    const isBuggy = modeledTrades.some(
      (t) =>
        (t.entryAt != null && !inSession(t.entryAt)) ||
        (t.exitAt != null && !inSession(t.exitAt)),
    );
    if (!isBuggy) continue;

    const tradesToShift = modeledTrades.filter(
      (t) => t.entryAt != null || t.exitAt != null,
    ).length;
    const { summary: newSummary, changed: summaryChanged } =
      correctSummaryEquityCurve(run.summary);

    plans.push({
      runId: run.id,
      mode: run.mode,
      tradesToShift,
      summaryChanged,
      newSummary,
    });
  }

  const totalRuns = plans.length;
  const totalTrades = plans.reduce((acc, p) => acc + p.tradesToShift, 0);
  const totalSummaries = plans.filter((p) => p.summaryChanged).length;

  console.log("  Buggy runs detected:           ", totalRuns);
  console.log("  Modeled trades to shift −05:30:", totalTrades);
  console.log("  Summary equity-curves to fix:  ", totalSummaries);

  if (totalRuns === 0) {
    console.log("\n  Nothing to correct — no pre-fix runs found.\n");
    return;
  }

  for (const p of plans) {
    console.log(
      `    run ${p.runId} [${p.mode}] — ${p.tradesToShift} trades` +
        (p.summaryChanged ? " + equity curve" : ""),
    );
  }

  if (!args.write) {
    console.log("\n  DRY-RUN: no changes written. Re-run with --write to apply.\n");
    return;
  }

  await db.transaction(async (tx) => {
    for (const p of plans) {
      await tx
        .update(backtestTradesTable)
        .set({
          entryAt: sql`${backtestTradesTable.entryAt} - interval '5 hours 30 minutes'`,
          exitAt: sql`${backtestTradesTable.exitAt} - interval '5 hours 30 minutes'`,
        })
        .where(
          and(eq(backtestTradesTable.runId, p.runId), eq(backtestTradesTable.modeled, true)),
        );

      if (p.summaryChanged) {
        await tx
          .update(backtestRunsTable)
          .set({ summary: p.newSummary })
          .where(eq(backtestRunsTable.id, p.runId));
      }
    }
  });

  // ── Verify: no modeled trade may remain off-session ──────────────────────
  const remaining = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(backtestTradesTable)
    .where(
      and(
        eq(backtestTradesTable.modeled, true),
        sql`(
          (${backtestTradesTable.entryAt} is not null and (
            extract(hour from (${backtestTradesTable.entryAt} at time zone 'Asia/Kolkata')) * 60
            + extract(minute from (${backtestTradesTable.entryAt} at time zone 'Asia/Kolkata'))
          ) not between ${SESSION_OPEN_MIN} and ${SESSION_CLOSE_MIN})
          or
          (${backtestTradesTable.exitAt} is not null and (
            extract(hour from (${backtestTradesTable.exitAt} at time zone 'Asia/Kolkata')) * 60
            + extract(minute from (${backtestTradesTable.exitAt} at time zone 'Asia/Kolkata'))
          ) not between ${SESSION_OPEN_MIN} and ${SESSION_CLOSE_MIN})
        )`,
      ),
    );
  const stillOff = Number(remaining[0]?.n ?? 0);
  console.log(`\n  Applied. Modeled trades still off-session: ${stillOff}`);
  if (stillOff > 0) {
    throw new Error(
      `Expected 0 off-session modeled trades after backfill, found ${stillOff}.`,
    );
  }
  console.log("  Done.\n");
}

const isMain =
  process.argv[1] != null && import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  main()
    .then(async () => {
      await pool.end();
    })
    .catch(async (err) => {
      console.error("[fix-backtest-trade-times] FAILED:", err);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}
