/**
 * PHASE 0.6 DURABILITY PROOF — build a real generation from the cached official
 * sources, commit it to PostgreSQL, then read it back through the normal load
 * path and re-verify the checksum.
 *
 * Performs NO network I/O. Writes to the DEVELOPMENT database only.
 *
 *   pnpm --filter @workspace/api-server exec tsx scripts/p06.persistGeneration.ts
 */

import { createHash } from "node:crypto";
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
import {
  CLASSIFICATION_POLICY_VERSION,
  MANIFEST_SCHEMA_VERSION,
  REQUIRED_SOURCE_IDS,
  buildUniverseManifest,
  computeRecordSetHash,
  verifyManifestChecksum,
} from "../src/lib/registry/universeManifest";
import {
  _setActiveGenerationForTest,
  loadLatestAcceptedGeneration,
  saveRegistryGeneration,
} from "../src/lib/registry/manifestStore";
import { toAuthoritativeCoverageManifest } from "../src/lib/registry/coverageBridge";

const DIR = resolve(process.cwd(), "../../.cache/p06-sources");
const read = (f: string): string => readFileSync(resolve(DIR, f), "latin1");

async function main(): Promise<void> {
  const retrievedAt = new Date().toISOString();
  const nowMs = Date.parse(retrievedAt);

  const nseMain = parseNseEquityCsv(read("EQUITY_L.csv"), "NSE_EQUITY_L", retrievedAt, nowMs);
  const nseSme = parseNseEquityCsv(read("SME_EQUITY_L.csv"), "NSE_SME_EQUITY_L", retrievedAt, nowMs);
  const nseEtf = parseNseEtfCsv(read("eq_etfseclist.csv"), retrievedAt, nowMs);
  const bseAct = parseBseListOfScrips(read("bse_active.json"), "BSE_LIST_OF_SCRIPS_ACTIVE", retrievedAt, nowMs);
  const bseSus = parseBseListOfScrips(read("bse_susp.json"), "BSE_LIST_OF_SCRIPS_SUSPENDED", retrievedAt, nowMs);
  const kite = parseKiteInstrumentCsv(read("kite_instruments.csv"), retrievedAt, nowMs);

  const sources: OfficialSourceProvenance[] = [
    nseMain.provenance, nseSme.provenance, nseEtf.provenance,
    bseAct.provenance, bseSus.provenance, kite.provenance,
  ];

  // Content-derived id: re-running over identical sources yields the same
  // generation, so the ON CONFLICT path is exercised instead of piling up rows.
  //
  // The schema and policy versions are part of the identity ON PURPOSE. The
  // same bytes interpreted under a different classification policy describe a
  // DIFFERENT universe. Deriving the id from source content alone means that
  // after a version bump the new generation collides with the stale row,
  // ON CONFLICT DO NOTHING silently skips the write, and the loader then
  // rejects the stale row for version mismatch — leaving the universe
  // permanently unconfigured while the write still reports ok.
  const registryGenerationId =
    "P06-" +
    createHash("sha256")
      .update(
        [
          `schema=${MANIFEST_SCHEMA_VERSION}`,
          `policy=${CLASSIFICATION_POLICY_VERSION}`,
          ...sources.map((s) => `${s.sourceId}:${s.contentHash}`).sort(),
        ].join("|"),
        "utf8",
      )
      .digest("hex")
      .slice(0, 16);

  const effectiveDate = retrievedAt.slice(0, 10);

  // Carry instrument history forward. Keyed on authoritativeSecurityId (the
  // stable official identity), NOT the canonical id, which embeds the trading
  // symbol and would reset history on any symbol or series change. Without
  // this, every build stamps firstSeenAt=null and every instrument looks new.
  const prior = await loadLatestAcceptedGeneration("PRIOR_FIRST_SEEN_CARRY_FORWARD");
  const priorFirstSeen = new Map<string, string>();
  if (prior) {
    for (const r of prior.records) {
      priorFirstSeen.set(r.authoritativeSecurityId, r.firstSeenAt ?? prior.manifest.generatedAt);
    }
  }
  console.log(
    `=== PRIOR HISTORY ===\n  prior generation ${prior?.manifest.registryGenerationId ?? "(none)"}` +
      `  firstSeen entries carried ${priorFirstSeen.size}`,
  );

  const built = buildRegistry({
    nseMain: nseMain.rows, nseSme: nseSme.rows, nseEtf: nseEtf.rows,
    bseActive: bseAct.rows, bseSuspended: bseSus.rows, kite: kite.rows,
    registryGenerationId, effectiveDate, generatedAt: retrievedAt,
    priorFirstSeen,
  });

  const manifest = buildUniverseManifest({
    build: built,
    sources,
    manifestVersion: 1,
    registryGenerationId,
    generatedAt: retrievedAt,
    effectiveDate,
    requiredSourceIds: REQUIRED_SOURCE_IDS,
  });

  console.log("=== MANIFEST ===");
  console.log(`  generationId       ${manifest.registryGenerationId}`);
  console.log(`  acceptanceStatus   ${manifest.acceptanceStatus}`);
  console.log(`  blockers           ${manifest.blockers.length === 0 ? "(none)" : manifest.blockers.join("; ")}`);
  console.log(`  checksum           ${manifest.manifestChecksum.slice(0, 24)}…`);
  console.log(`  eligibleLiveSet    ${manifest.eligibleLiveSetHash.slice(0, 24)}…`);
  console.log(`  policyHash         ${manifest.classificationPolicyHash.slice(0, 24)}…`);
  console.log(`  totalOfficial      ${manifest.totalOfficialRecords}  indices ${manifest.indexCount}`);
  console.log(`  tiers              ${JSON.stringify(manifest.tierCounts)}`);
  console.log(`  recordSetHash      ${manifest.recordSetHash.slice(0, 24)}…`);
  console.log(`  frozen             ${Object.isFrozen(manifest)}`);
  const withHistory = built.records.filter((r) => r.firstSeenAt !== null).length;
  console.log(`  firstSeenAt set    ${withHistory} / ${built.records.length}`);

  const records = [...built.records, ...built.indexRecords];

  console.log("\n=== DURABLE WRITE (PostgreSQL) ===");
  const saved = await saveRegistryGeneration({ manifest, records });
  console.log(`  ${JSON.stringify(saved)}`);

  console.log("\n=== COLD-START RELOAD ===");
  // Clear the in-memory layer so the reload genuinely comes from durable storage.
  _setActiveGenerationForTest(null);
  const loaded = await loadLatestAcceptedGeneration("DURABILITY_PROOF");
  if (!loaded) {
    console.log("  LOADED: null — durable restore FAILED");
  } else {
    console.log(`  generationId       ${loaded.manifest.registryGenerationId}`);
    console.log(`  records restored   ${loaded.records.length}`);
    // Verify the RESTORED manifest against itself. Comparing it to the manifest
    // just built in this process would be misleading: generatedAt differs on
    // every run, so the checksums legitimately differ for the same universe.
    console.log(`  checksum self-verifies ${verifyManifestChecksum(loaded.manifest)}`);
    console.log(`  recordSet intact       ${computeRecordSetHash(loaded.records) === loaded.manifest.recordSetHash}`);
    console.log(`  same universe as built ${loaded.manifest.recordSetHash === manifest.recordSetHash}`);
  }

  console.log("\n=== COVERAGE BRIDGE ===");
  const cov = toAuthoritativeCoverageManifest(loaded);
  console.log(`  coverageAuthority        ${cov.coverageAuthority}`);
  console.log(`  requiredInstrumentIds    ${cov.requiredInstrumentIds.length}`);
  console.log(`  subscriptionRequested    ${cov.subscriptionRequestedCount}`);
  console.log(`  reconciliationValid      ${cov.universeReconciliationValid}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FAILED:", err);
    process.exit(1);
  });
