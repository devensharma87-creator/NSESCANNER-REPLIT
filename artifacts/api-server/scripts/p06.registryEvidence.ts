/**
 * PHASE 0.6 EVIDENCE HARNESS — reconciliation over the REAL official sources.
 *
 * Reads bodies already retrieved to `.cache/p06-sources/` (retrieved once, on
 * purpose — this script performs NO network I/O), runs the real parsers and the
 * real registry builder, and prints the reconciliation. Numbers printed here
 * are derived, never asserted.
 *
 *   pnpm --filter @workspace/api-server exec tsx scripts/p06.registryEvidence.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseBseListOfScrips,
  parseKiteInstrumentCsv,
  parseNseEquityCsv,
  parseNseEtfCsv,
  type OfficialSourceProvenance,
} from "../src/lib/registry/officialSources";
import { buildRegistry } from "../src/lib/registry/instrumentRegistry";

const DIR = resolve(process.cwd(), "../../.cache/p06-sources");
/**
 * NSE publishes eq_etfseclist.csv with Windows-1252 bytes, so it is NOT valid
 * UTF-8 (VERIFIED 2026-08-12). Decoding it as UTF-8 silently corrupts security
 * names into replacement characters. latin1 round-trips every byte and leaves
 * the ASCII symbol/series/ISIN columns identical.
 */
const read = (f: string): string => readFileSync(resolve(DIR, f), "latin1");

const retrievedAt = new Date().toISOString();
const nowMs = Date.parse(retrievedAt);

const nseMain = parseNseEquityCsv(read("EQUITY_L.csv"), "NSE_EQUITY_L", retrievedAt, nowMs);
const nseSme = parseNseEquityCsv(read("SME_EQUITY_L.csv"), "NSE_SME_EQUITY_L", retrievedAt, nowMs);
const nseEtf = parseNseEtfCsv(read("eq_etfseclist.csv"), retrievedAt, nowMs);
const bseAct = parseBseListOfScrips(read("bse_active.json"), "BSE_LIST_OF_SCRIPS_ACTIVE", retrievedAt, nowMs);
const bseSus = parseBseListOfScrips(read("bse_susp.json"), "BSE_LIST_OF_SCRIPS_SUSPENDED", retrievedAt, nowMs);
const kite = parseKiteInstrumentCsv(read("kite_instruments.csv"), retrievedAt, nowMs);

const provs: OfficialSourceProvenance[] = [
  nseMain.provenance,
  nseSme.provenance,
  nseEtf.provenance,
  bseAct.provenance,
  bseSus.provenance,
  kite.provenance,
];

console.log("=== SOURCE PROVENANCE ===");
for (const p of provs) {
  console.log(
    `${p.sourceId.padEnd(28)} rows=${String(p.rowCount).padStart(6)} ${p.validationResult.padEnd(22)} ${p.freshnessState.padEnd(22)} sha=${p.contentHash.slice(0, 12)}${p.rejectionDetail ? ` :: ${p.rejectionDetail}` : ""}`,
  );
}

const built = buildRegistry({
  nseMain: nseMain.rows,
  nseSme: nseSme.rows,
  nseEtf: nseEtf.rows,
  bseActive: bseAct.rows,
  bseSuspended: bseSus.rows,
  kite: kite.rows,
  registryGenerationId: "EVIDENCE_RUN",
  effectiveDate: retrievedAt.slice(0, 10),
  generatedAt: retrievedAt,
});

for (const rec of [built.nse, built.bse]) {
  console.log(`\n=== ${rec.exchange} RECONCILIATION ===`);
  console.log(`  official records      ${rec.officialRecordCount}`);
  console.log(`    LIVE_REQUIRED       ${rec.liveRequired}  (mapped ${rec.mappedLive} + unmapped ${rec.unmappedLive})`);
  console.log(`    SNAPSHOT_ONLY       ${rec.snapshotOnly}`);
  console.log(`    UNAVAILABLE         ${rec.unavailable}`);
  console.log(`    EXCLUDED_NON_STOCK  ${rec.excludedNonStock}`);
  console.log(`    UNRESOLVED          ${rec.unresolved}`);
  console.log(`  REMAINDER             ${rec.remainder}   ok=${rec.ok}`);
  console.log(
    `  dup identities ${rec.duplicateCanonicalIdentityCount}  dup tokens retained ${rec.duplicateActiveTokenCount}` +
      `  dup-token claimants rejected ${rec.duplicateTokenRejectedCount}  ambiguous ${rec.ambiguousMappingCount}`,
  );
  if (rec.failures.length) console.log(`  FAILURES: ${rec.failures.join(" | ")}`);
}

console.log(`\n=== GLOBAL ===`);
console.log(`  indices                ${built.indexRecords.length}`);
console.log(`  BSE active+suspended   ${built.bseTotalOfficialRecords} reconciles=${built.bseTotalReconciles} (suspended ${built.bseSuspendedRecordCount})`);
console.log(`  build ok               ${built.ok}`);
if (built.failures.length) console.log(`  FAILURES:\n   - ${built.failures.slice(0, 15).join("\n   - ")}`);

// Distribution, to prove classification is exercised rather than defaulted.
const byClass = new Map<string, number>();
for (const r of [...built.records, ...built.indexRecords]) {
  byClass.set(r.securityClass, (byClass.get(r.securityClass) ?? 0) + 1);
}
console.log(`\n=== SECURITY CLASS DISTRIBUTION ===`);
for (const [k, v] of [...byClass.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(26)} ${v}`);
}

const unmappedLive = built.records.filter(
  (r) => r.eligibilityTier === "LIVE_REQUIRED" && r.mappingStatus !== "MAPPED_EXACT",
);
console.log(`\n=== UNMAPPED LIVE_REQUIRED (${unmappedLive.length}) ===`);
for (const r of unmappedLive.slice(0, 25)) {
  console.log(`  ${r.exchange} ${String(r.officialSymbol).padEnd(12)} ${r.seriesOrGroup.padEnd(4)} ${r.mappingStatus} :: ${r.mappingReason}`);
}

const unresolved = built.records.filter((r) => r.eligibilityTier === "UNRESOLVED");
console.log(`\n=== UNRESOLVED (${unresolved.length}) ===`);
for (const r of unresolved.slice(0, 15)) {
  console.log(`  ${r.exchange} ${String(r.officialSymbol).padEnd(12)} grp=${r.seriesOrGroup.padEnd(4)} :: ${r.classificationEvidence}`);
}
