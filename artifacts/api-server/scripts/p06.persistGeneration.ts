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
import {
  evaluateBseReferenceAuthority,
  type BseListRetrieval,
} from "../src/lib/registry/bseReferencePolicy";
import {
  buildExchangeCalendar,
  evaluateCalendarAuthorityNow,
  getLatestCompletedTradingSession,
  toCalendarCommitment,
  toTradingCalendarVerdict,
  validateBhavcopySession,
  verifyCalendarCommitmentIntegrity,
} from "../src/lib/registry/exchangeCalendar";
import {
  bseUdiffUrlFor,
  parseBseSessionTimings,
  parseBseTradingHolidayPage,
  parseBseUdiff,
  parseNseHolidayMaster,
  parseNseMarketTimings,
  BSE_EQUITY_SESSION_TIMINGS_PAGE,
  NSE_MARKET_TIMINGS_URL,
} from "../src/lib/registry/exchangeCalendarSources";

const DIR = resolve(process.cwd(), "../../.cache/p06-sources");
const read = (f: string): string => readFileSync(resolve(DIR, f), "latin1");
const CAL_DIR = resolve(process.cwd(), "../../.cache/p06-calendar");
const readCal = (f: string): string => readFileSync(resolve(CAL_DIR, f), "utf8");
const TIMING_DIR = resolve(process.cwd(), "../../.cache/p06-timing");
const readTiming = (f: string): string => readFileSync(resolve(TIMING_DIR, f), "utf8");

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

  // OWNER-APPROVED BSE REFERENCE POLICY.
  //
  // Honest inputs only. This script replays CACHED source bytes, and Phase 0.6
  // never retrieved a BSE UDiFF and the repo carries no BSE trading calendar,
  // so both are reported as absent rather than assumed. The policy therefore
  // refuses to authorize a new generation, which is the correct outcome: the
  // universe cannot be declared authoritative until completed-session UDiFF
  // reconciliation and a real trading calendar exist. Supplying a fabricated
  // calendar or UDiFF here would manufacture authority that no source granted.
  const bseListSource = sources.find((s) => s.sourceId === "BSE_LIST_OF_SCRIPS_ACTIVE");
  const listRetrieval: BseListRetrieval = bseListSource
    ? {
        outcome: "RETRIEVED",
        retrievedAtMs: Date.parse(bseListSource.retrievedAt),
        validationResult: bseListSource.validationResult,
        contentHash: bseListSource.contentHash,
      }
    : { outcome: "RETRIEVAL_FAILED", failureReason: "BSE List of Scrips absent from this run" };

  // PHASE 0.6A — AUTHORITATIVE TRADING CALENDAR, from official sources only.
  //
  // NSE: the exchange's own trading-holiday master (segment CM).
  // BSE: the exchange's own equity-segment Trading Holidays page.
  // Both were retrieved once and cached; nothing here reaches the network, and
  // no holiday, session or timing is inferred.
  const calYear = Number(retrievedAt.slice(0, 4));
  const nseCal = parseNseHolidayMaster(readCal("nse_holiday_master_2026.json"), {
    retrievedAt,
    calendarYear: calYear,
  });
  const bseCal = parseBseTradingHolidayPage(readCal("bse_listholi_bundle_2026.js"), {
    retrievedAt,
    calendarYear: calYear,
  });
  // PHASE 0.6A — REGULAR-SESSION HOURS, from each exchange's OWN publication.
  //
  // NSE: nseindia.com/market-data/market-timings (server-rendered label/value
  // rows). BSE: the continuous-trading-session row in BSE's own application
  // bundle, the same artefact its trading-holidays page is read from. Both were
  // retrieved once and cached; the hours coincide, but neither exchange's times
  // are ever inherited from the other or from a constant in this codebase.
  const nseTiming = parseNseMarketTimings(readTiming("nse_market_timings.html"), {
    retrievedAt,
    effectiveYear: calYear,
    sourceUrl: NSE_MARKET_TIMINGS_URL,
  });
  const bseTiming = parseBseSessionTimings(readTiming("bse_main_bundle.js"), {
    retrievedAt,
    effectiveYear: calYear,
    sourceUrl: BSE_EQUITY_SESSION_TIMINGS_PAGE,
  });
  console.log("=== OFFICIAL SESSION TIMING SOURCES ===");
  for (const t of [nseTiming, bseTiming]) {
    const p = t.provenance;
    console.log(
      `  ${p.exchange} ${p.sourceId}  ${p.validationResult}  ${t.openIst ?? "?"}–${t.closeIst ?? "?"} IST` +
        `  bytes=${p.contentBytes}  sha256=${p.contentHash.slice(0, 16)}…  evidence=${t.evidence.length}` +
        `${p.rejectionDetail ? `  detail=${p.rejectionDetail}` : ""}`,
    );
    console.log(`    url ${p.sourceUrl}`);
    for (const row of t.evidence) console.log(`    evidence  "${row.label}" = "${row.value}"`);
  }

  const calendar = buildExchangeCalendar({
    sources: [nseCal, bseCal],
    timings: [nseTiming, bseTiming],
    exchanges: ["NSE", "BSE"],
    years: [calYear],
    generatedAt: retrievedAt,
  });
  console.log("=== TRADING CALENDAR ===");
  console.log(`  calendarGenerationId ${calendar.calendarGenerationId}`);
  console.log(`  valid                ${calendar.valid}`);
  console.log(`  blockers             ${calendar.blockers.length === 0 ? "(none)" : calendar.blockers.join("; ")}`);
  for (const s of calendar.sources) {
    console.log(`  source ${s.sourceId}  ${s.validationResult}  events=${s.eventCount}  sha256=${s.contentHash.slice(0, 16)}…`);
  }
  for (const ex of ["NSE", "BSE"] as const) {
    const l = getLatestCompletedTradingSession(calendar, ex, nowMs);
    const sample = calendar.sessions.find((s) => s.exchange === ex && s.sessionType === "REGULAR");
    console.log(`  latest completed ${ex}  ${l.ok ? l.session.tradingDate : `UNKNOWN — ${l.reason}`}`);
    console.log(
      `  regular hours ${ex}     ${sample?.scheduledOpenIst ?? "?"}–${sample?.scheduledCloseIst ?? "?"} IST ` +
        `from ${sample?.timingSourceId ?? "(none)"}`,
    );
  }

  // The UDiFF must be EXACTLY the latest completed BSE session — never merely
  // recent. The file is selected by that computed date, not the other way
  // round, so a missing file blocks instead of quietly reconciling to an older
  // session.
  const latestBse = getLatestCompletedTradingSession(calendar, "BSE", nowMs);
  let udiff: ReturnType<typeof parseBseUdiff>["descriptor"] | null = null;
  if (latestBse.ok) {
    const compact = latestBse.session.tradingDate.replace(/-/g, "");
    const parsedUdiff = parseBseUdiff(readCal(`bse_udiff_${compact}.csv`), {
      retrievedAtMs: nowMs,
      fileVariant: "F",
      sourceUrl: bseUdiffUrlFor(latestBse.session.tradingDate),
    });
    udiff = parsedUdiff.descriptor;
    const check = validateBhavcopySession(calendar, "BSE", parsedUdiff.descriptor.tradingDate, nowMs);
    console.log("=== BSE UDiFF ===");
    console.log(`  tradingDate ${parsedUdiff.descriptor.tradingDate}  rows ${parsedUdiff.rowCount}  sessions ${parsedUdiff.sessionIds.join(",")}`);
    console.log(`  validation  ${parsedUdiff.descriptor.validationResult}  sessionCompleted ${parsedUdiff.descriptor.sessionCompleted}`);
    console.log(`  sha256      ${parsedUdiff.descriptor.contentHash.slice(0, 16)}…`);
    console.log(`  session match ${check.code} — ${check.reason}`);
    if (!check.ok) {
      throw new Error(`UDiFF does not match the latest completed session: ${check.reason}`);
    }
  }

  const bseAuthority = evaluateBseReferenceAuthority({
    nowMs,
    list: listRetrieval,
    udiff,
    calendar: toTradingCalendarVerdict(calendar, "BSE", nowMs),
    hasPriorAcceptedGeneration: prior !== null,
    reconciliationClosed: built.nse.ok && built.bse.ok,
  });
  console.log(
    `=== BSE REFERENCE AUTHORITY ===\n  state ${bseAuthority.state}` +
      `  mayAuthorizeNewGeneration ${bseAuthority.mayAuthorizeNewGeneration}\n  ${bseAuthority.reasons.join("; ")}`,
  );

  const manifest = buildUniverseManifest({
    build: built,
    sources,
    manifestVersion: 1,
    registryGenerationId,
    generatedAt: retrievedAt,
    effectiveDate,
    requiredSourceIds: REQUIRED_SOURCE_IDS,
    bseAuthority,
    tradingCalendar: toCalendarCommitment(calendar, nowMs),
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
  const cov = toAuthoritativeCoverageManifest(loaded, nowMs);
  console.log(`  coverageAuthority        ${cov.coverageAuthority}`);
  console.log(`  requiredInstrumentIds    ${cov.requiredInstrumentIds.length}`);
  console.log(`  subscriptionRequested    ${cov.subscriptionRequestedCount}`);
  console.log(`  reconciliationValid      ${cov.universeReconciliationValid}`);
  if (loaded) {
    const restoredCal = loaded.manifest.tradingCalendar;
    console.log("\n=== RESTORED CALENDAR COMMITMENT ===");
    console.log(`  calendarGenerationId  ${restoredCal.calendarGenerationId}`);
    console.log(`  checksum              ${restoredCal.calendarChecksum.slice(0, 24)}…`);
    console.log(`  latest completed      ${JSON.stringify(restoredCal.latestCompletedSession)}`);
    console.log(`  integrity blockers    ${JSON.stringify(verifyCalendarCommitmentIntegrity(restoredCal))}`);
    console.log(
      `  bound to authority    ${loaded.manifest.bseReferenceAuthority.effectiveTradingDate === restoredCal.latestCompletedSession.BSE}`,
    );
    console.log(`  committed timings     ${restoredCal.timings.length}`);
    for (const t of restoredCal.timings) {
      console.log(
        `    ${t.provenance.exchange} ${t.provenance.sourceId}  ${t.openIst}–${t.closeIst}  ` +
          `sha256=${t.provenance.contentHash.slice(0, 16)}…  evidence=${t.evidence.length}`,
      );
    }

    // CURRENT AUTHORITY — asked now, and asked again at a future instant the
    // committed calendar cannot speak for. Nothing below mutates the stored
    // commitment; it only re-reads it against a different clock.
    console.log("\n=== CURRENT AUTHORITY ===");
    const now = evaluateCalendarAuthorityNow(restoredCal, nowMs);
    console.log(`  state now             ${now.state}`);
    console.log(`  reasons               ${now.reasons.length === 0 ? "(none)" : now.reasons.join("; ")}`);
    console.log(`  valid until           ${new Date(now.validUntilMs).toISOString()}`);
    console.log(`  required latest       ${JSON.stringify(now.requiredLatestCompletedSession)}`);

    const simulatedMs = Date.parse("2027-01-01T04:00:00.000Z");
    const future = evaluateCalendarAuthorityNow(restoredCal, simulatedMs);
    const futureCov = toAuthoritativeCoverageManifest(loaded, simulatedMs);
    console.log("\n=== SIMULATED 2027-01-01 (no data mutated) ===");
    console.log(`  state                 ${future.state}`);
    console.log(`  reasons               ${future.reasons.join("; ")}`);
    console.log(`  coverageAuthority     ${futureCov.coverageAuthority}`);
    console.log(`  requiredInstrumentIds ${futureCov.requiredInstrumentIds.length}`);
    console.log(
      `  commitment unchanged  ${verifyCalendarCommitmentIntegrity(restoredCal).length === 0 && restoredCal.calendarChecksum === loaded.manifest.tradingCalendar.calendarChecksum}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FAILED:", err);
    process.exit(1);
  });
