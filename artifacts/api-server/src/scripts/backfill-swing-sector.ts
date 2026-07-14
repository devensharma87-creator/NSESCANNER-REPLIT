/**
 * One-shot backfill: populate `sector` + `industry` on existing
 * `swing_scan_result` rows that currently have NULL or empty values.
 *
 * Source of truth: `lookupSector` from `../lib/sectorMap.ts`
 * (UNIVERSE → curated EXTENSION → "Unmapped"). Idempotent — re-running
 * after a sectorMap update only touches rows whose mapped value differs
 * from what's stored.
 *
 * Usage (from repo root):
 *
 *   pnpm --filter @workspace/api-server run backfill:swing-sector
 *
 * or for a dry run that only prints stats without writing:
 *
 *   pnpm --filter @workspace/api-server run backfill:swing-sector -- --dry-run
 *
 * Required env: DATABASE_URL.
 */
import { sql, eq, and } from "drizzle-orm";
import { db, swingScanResultTable } from "@workspace/db";
import {
  lookupSector,
  computeSectorCoverage,
  UNMAPPED_SECTOR,
} from "../lib/sectorMap";

interface RowKey {
  symbol: string;
  scanDate: string;
  sector: string | null;
  industry: string | null;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`[backfill] mode: ${dryRun ? "DRY RUN" : "WRITE"}`);

  const rows = (await db
    .select({
      symbol: swingScanResultTable.symbol,
      scanDate: swingScanResultTable.scanDate,
      sector: swingScanResultTable.sector,
      industry: swingScanResultTable.industry,
    })
    .from(swingScanResultTable)) as RowKey[];

  console.log(`[backfill] total rows in swing_scan_result: ${rows.length}`);

  const distinctSymbols = new Set(rows.map((r) => r.symbol));
  const cov = computeSectorCoverage(distinctSymbols);
  console.log(`[backfill] coverage (deterministic from sectorMap):`);
  console.log(`  distinct symbols    : ${cov.total}`);
  console.log(`  mapped (universe)   : ${cov.bySource.universe}`);
  console.log(`  mapped (extension)  : ${cov.bySource.extension}`);
  console.log(`  unmapped            : ${cov.bySource.unknown}`);
  console.log(`  sector coverage %   : ${cov.sectorCoveragePct}`);
  console.log(`  industry coverage % : ${cov.industryCoveragePct}`);

  let updated = 0;
  let skippedUpToDate = 0;
  for (const r of rows) {
    const m = lookupSector(r.symbol);
    const currentSector = r.sector ?? "";
    const currentIndustry = r.industry ?? "";
    if (currentSector === m.sector && currentIndustry === m.industry) {
      skippedUpToDate += 1;
      continue;
    }
    if (!dryRun) {
      await db
        .update(swingScanResultTable)
        .set({ sector: m.sector, industry: m.industry, updatedAt: new Date() })
        .where(
          and(
            eq(swingScanResultTable.symbol, r.symbol),
            eq(swingScanResultTable.scanDate, r.scanDate),
          ),
        );
    }
    updated += 1;
  }

  console.log(
    `[backfill] rows ${dryRun ? "would update" : "updated"}: ${updated}`,
  );
  console.log(`[backfill] rows already up-to-date: ${skippedUpToDate}`);

  if (cov.unmapped.length > 0) {
    console.log(
      `[backfill] unmapped symbols (first 25): ${cov.unmapped.slice(0, 25).join(", ")}`,
    );
    console.log(
      `[backfill] note: unmapped rows are stored with sector="${UNMAPPED_SECTOR}" so the diagnostic endpoint can list them.`,
    );
  }

  const dbCounts = await db.execute(sql`
    SELECT
      COUNT(*)::int                                                    AS total,
      COUNT(*) FILTER (WHERE sector IS NOT NULL AND sector <> '')::int AS with_sector,
      COUNT(*) FILTER (WHERE industry IS NOT NULL AND industry <> '')::int AS with_industry,
      COUNT(*) FILTER (WHERE sector = ${UNMAPPED_SECTOR})::int         AS unmapped_rows
    FROM swing_scan_result;
  `);
  const out = (dbCounts as unknown as { rows: unknown[] }).rows[0];
  console.log(`[backfill] DB row-level counts AFTER:`, out);

  process.exit(0);
}

main().catch((err) => {
  console.error(`[backfill] ERROR:`, err);
  process.exit(1);
});
