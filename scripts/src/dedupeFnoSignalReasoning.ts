/**
 * One-time migration: archive the raw, pre-dedupe `fno_signal_reasoning`
 * history, then collapse the live table to a clean once-per-transition log.
 *
 * Background (Signal Logging Fix — 2026-06-05)
 * --------------------------------------------
 * The old writer logged a reasoning row on every ~30s poll. Over 16 trading
 * days that produced ~44,625 rows representing only ~83 unique signals
 * (~88 duplicate rows/signal, worst case 307×), which broke every count and
 * win-rate derived from the table.
 *
 * This script implements §5 of `signal_logging_fix_spec.md`:
 *
 *   1. SNAPSHOT  — copy every live row into
 *      `fno_signal_reasoning_archive_pre_dedupe` (never delete raw history).
 *   2. BACKFILL  — rebuild the live table as a collapsed transition log:
 *      group by (signal_fingerprint-or-proxy, decision, reason_code) and
 *      keep the FIRST occurrence (earliest captured_at) of each group.
 *
 * Safety properties:
 *   - DRY-RUN BY DEFAULT. Pass `--write` to actually mutate.
 *   - IDEMPOTENT. The archive copy is skipped when the archive already holds
 *     the live rows; the collapse is a no-op once the table is already
 *     collapsed (rows == distinct transition groups).
 *   - Never deletes from the archive. The live-table rewrite happens inside a
 *     single transaction: archive-completeness is re-checked, the collapsed
 *     set is computed, the live table is truncated, and the kept rows are
 *     re-inserted — all-or-nothing.
 *   - Diagnostics-only table; touches NO signal, gate, sizing, execution,
 *     scheduler, scanner, or P&L path.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run dedupe-fno-reasoning            # dry-run
 *   pnpm --filter @workspace/scripts run dedupe-fno-reasoning -- --write # apply
 */

import {
  db,
  pool,
  fnoSignalReasoningTable,
  fnoSignalReasoningArchivePreDedupeTable,
  type FnoSignalReasoningRow,
  type NewFnoSignalReasoningArchiveRow,
} from "@workspace/db";
import { asc, sql } from "drizzle-orm";
import { createHash } from "node:crypto";

interface CliArgs {
  write: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { write: false };
  for (const a of argv) {
    if (a === "--write") args.write = true;
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
      "dedupeFnoSignalReasoning — archive + collapse fno_signal_reasoning",
      "",
      "  --write     Apply the migration (default is dry-run, no mutation).",
      "  --dry-run   Explicitly request a dry-run (the default).",
      "  --help      Show this help.",
    ].join("\n"),
  );
}

/**
 * Deterministic collapse key for a raw row. Mirrors the live writer's dedupe
 * identity: the stored SHA-256 fingerprint when present, otherwise a proxy
 * over the stable identity fields (rows without a leg, e.g.
 * PRE_EMISSION_REJECTED / SKIPPED, have no fingerprint). Combined with the
 * (decision, reason_code) state so a genuine reason-change is preserved.
 */
function collapseKey(row: FnoSignalReasoningRow): string {
  const fp =
    typeof row.signalFingerprint === "string" && /^[0-9a-f]{16}$/.test(row.signalFingerprint)
      ? row.signalFingerprint
      : null;
  const identity =
    fp ??
    "px:" +
      createHash("sha256")
        .update(
          [row.signalDate, row.indexSymbol, row.setupKey ?? "", row.direction ?? ""]
            .map((x) => String(x ?? "").trim().toUpperCase())
            .join("|"),
        )
        .digest("hex")
        .slice(0, 16);
  const state = `${String(row.decision).trim().toUpperCase()}|${String(row.reasonCode ?? "").trim().toUpperCase()}`;
  return `${identity}::${state}`;
}

/** Strip the live-row shape to the archive-insert shape (archivedAt defaulted). */
function toArchiveRow(row: FnoSignalReasoningRow): NewFnoSignalReasoningArchiveRow {
  const { id: _id, ...rest } = row;
  void _id;
  return rest;
}

/** Collapse rows to the FIRST occurrence per transition key (input must be
 *  ordered by captured_at ASC so "first" == earliest). Pure + exported for tests. */
export function collapseRows(rowsAsc: FnoSignalReasoningRow[]): FnoSignalReasoningRow[] {
  const seen = new Set<string>();
  const kept: FnoSignalReasoningRow[] = [];
  for (const r of rowsAsc) {
    const k = collapseKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    kept.push(r);
  }
  return kept;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.write ? "WRITE" : "DRY-RUN";
  console.log(`\n[dedupe-fno-reasoning] mode=${mode}\n`);

  const liveRows = await db
    .select()
    .from(fnoSignalReasoningTable)
    .orderBy(asc(fnoSignalReasoningTable.capturedAt), asc(fnoSignalReasoningTable.id));

  const liveCount = liveRows.length;
  const collapsed = collapseRows(liveRows);
  const collapsedCount = collapsed.length;
  const distinctFingerprints = new Set(
    liveRows
      .map((r) => r.signalFingerprint)
      .filter((f): f is string => typeof f === "string" && f.length > 0),
  ).size;

  const archiveCountRow = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(fnoSignalReasoningArchivePreDedupeTable);
  const archiveCount = Number(archiveCountRow[0]?.n ?? 0);

  console.log("  Live rows (current):           ", liveCount);
  console.log("  Distinct fingerprints:         ", distinctFingerprints);
  console.log("  Collapsed transition rows:     ", collapsedCount);
  console.log(
    "  Rows that would be removed:    ",
    liveCount - collapsedCount,
    liveCount > 0 ? `(${(((liveCount - collapsedCount) / liveCount) * 100).toFixed(1)}% reduction)` : "",
  );
  console.log("  Archive rows (existing):       ", archiveCount);
  if (collapsedCount > 0) {
    console.log(
      "  Rows-per-transition-group avg: ",
      (liveCount / collapsedCount).toFixed(2),
    );
  }

  if (liveCount === 0) {
    console.log("\n  Live table is empty — nothing to archive or collapse.\n");
    return;
  }

  const alreadyCollapsed = liveCount === collapsedCount;
  if (alreadyCollapsed) {
    console.log(
      "\n  Live table already collapsed (no duplicate transition groups).",
    );
  }

  if (!args.write) {
    console.log(
      "\n  DRY-RUN: no changes written. Re-run with --write to apply.\n",
    );
    return;
  }

  // ── WRITE path ────────────────────────────────────────────────────────
  // 1) Snapshot to archive (idempotent: only when the archive doesn't already
  //    hold at least the current live rows). The archive is never deleted.
  if (archiveCount >= liveCount && archiveCount > 0) {
    console.log(
      `\n  Archive already holds ${archiveCount} rows (>= ${liveCount} live) — skipping snapshot.`,
    );
  } else {
    const archiveRows = liveRows.map(toArchiveRow);
    const CHUNK = 1000;
    let inserted = 0;
    for (let i = 0; i < archiveRows.length; i += CHUNK) {
      const chunk = archiveRows.slice(i, i + CHUNK);
      await db.insert(fnoSignalReasoningArchivePreDedupeTable).values(chunk);
      inserted += chunk.length;
    }
    console.log(`\n  Snapshotted ${inserted} rows into the archive.`);
  }

  // 2) Collapse the live table inside a single transaction (all-or-nothing).
  if (alreadyCollapsed) {
    console.log("  Collapse: live table already collapsed — no-op.\n");
    return;
  }

  await db.transaction(async (tx) => {
    // Re-verify the archive holds at least the current live rows before we
    // touch the live table — never collapse without a safe snapshot.
    const archNow = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(fnoSignalReasoningArchivePreDedupeTable);
    const archN = Number(archNow[0]?.n ?? 0);
    if (archN < liveCount) {
      throw new Error(
        `Archive holds ${archN} rows but live has ${liveCount}; refusing to collapse without a complete snapshot.`,
      );
    }

    await tx.delete(fnoSignalReasoningTable);

    const keepRows = collapsed.map((r) => ({ ...r }));
    const CHUNK = 1000;
    let reinserted = 0;
    for (let i = 0; i < keepRows.length; i += CHUNK) {
      const chunk = keepRows.slice(i, i + CHUNK);
      await tx.insert(fnoSignalReasoningTable).values(chunk);
      reinserted += chunk.length;
    }
    console.log(`  Collapsed live table: re-inserted ${reinserted} transition rows.`);
  });

  console.log("\n  Done.\n");
}

const isMain =
  process.argv[1] != null &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  main()
    .then(async () => {
      await pool.end();
    })
    .catch(async (err) => {
      console.error("[dedupe-fno-reasoning] FAILED:", err);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}
