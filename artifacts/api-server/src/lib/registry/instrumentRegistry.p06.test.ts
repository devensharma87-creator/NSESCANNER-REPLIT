/**
 * PHASE 0.6 — registry reconciliation and coverage-bridge invariants.
 *
 * Pure and fixture-driven: no network, no database, no clock dependence. Every
 * assertion below encodes a rule that, if broken, would let the platform claim
 * knowledge of a security it cannot actually price.
 */

import { describe, expect, it } from "vitest";
import {
  buildRegistry,
  expectedKiteNseTradingSymbol,
  type RegistryBuildInput,
  type RegistryRecord,
} from "./instrumentRegistry";
import type {
  BseRawRow,
  KiteMasterRow,
  NseOfficialEquityRow,
  NseOfficialEtfRow,
  OfficialSourceProvenance,
} from "./officialSources";
import {
  REQUIRED_SOURCE_IDS,
  buildUniverseManifest,
  computeEligibleLiveSetHash,
  computeManifestChecksum,
  verifyManifestChecksum,
} from "./universeManifest";
import { toAuthoritativeCoverageManifest } from "./coverageBridge";
import { makeCurrentAuthoritativeBse,
  makeCalendarCommitment } from "./p06TestFixtures";

/** The fixture calendar's own evaluation instant: 15:00 IST on 2026-08-12. */
const FIXTURE_NOW_MS = Date.parse("2026-08-12T09:30:00.000Z");

const GEN = "p06-test-generation";
const EFFECTIVE = "2026-08-12";
const GENERATED_AT = "2026-08-12T04:00:00.000Z";

function nse(symbol: string, series: string, isin: string | null = "INE000A01001"): NseOfficialEquityRow {
  return { symbol, nameOfCompany: `${symbol} Ltd`, series, isin, dateOfListing: "2020-01-01" };
}
function etf(symbol: string): NseOfficialEtfRow {
  return { symbol, securityName: `${symbol} ETF`, underlying: "NIFTY 50", isin: "INF204KB14I2" };
}
function bse(
  scripCode: string,
  group: string,
  segment: string,
  status: "Active" | "Suspended",
  isin: string | null = "INE000B01002",
): BseRawRow {
  return { scripCode, scripId: `ID${scripCode}`, scripName: `Name ${scripCode}`, group, segment, isin, status };
}
function kiteNse(tradingSymbol: string, instrumentToken: number): KiteMasterRow {
  return {
    instrumentToken,
    exchangeToken: Math.floor(instrumentToken / 256),
    tradingSymbol,
    name: tradingSymbol,
    exchange: "NSE",
    segment: "NSE",
    instrumentType: "EQ",
  };
}
function kiteBse(exchangeToken: number, instrumentToken: number, tradingSymbol: string): KiteMasterRow {
  return {
    instrumentToken,
    exchangeToken,
    tradingSymbol,
    name: tradingSymbol,
    exchange: "BSE",
    segment: "BSE",
    instrumentType: "EQ",
  };
}
function kiteIndex(tradingSymbol: string, exchange: "NSE" | "BSE", instrumentToken: number): KiteMasterRow {
  return {
    instrumentToken,
    exchangeToken: Math.floor(instrumentToken / 256),
    tradingSymbol,
    name: tradingSymbol,
    exchange,
    segment: "INDICES",
    instrumentType: "EQ",
  };
}

function build(partial: Partial<RegistryBuildInput> = {}) {
  const input: RegistryBuildInput = {
    nseMain: [],
    nseSme: [],
    nseEtf: [],
    bseActive: [],
    bseSuspended: [],
    kite: [],
    registryGenerationId: GEN,
    effectiveDate: EFFECTIVE,
    generatedAt: GENERATED_AT,
    ...partial,
  };
  return buildRegistry(input);
}

const bySymbol = (records: readonly RegistryRecord[], symbol: string): RegistryRecord => {
  const found = records.find((r) => r.officialSymbol === symbol);
  if (!found) throw new Error(`no record for ${symbol}`);
  return found;
};

describe("P0.6 expectedKiteNseTradingSymbol", () => {
  it("leaves the plain EQ series unsuffixed and suffixes every other series", () => {
    expect(expectedKiteNseTradingSymbol("RELIANCE", "EQ")).toBe("RELIANCE");
    expect(expectedKiteNseTradingSymbol("SOMESME", "SM")).toBe("SOMESME-SM");
    expect(expectedKiteNseTradingSymbol("SOMEBE", "BE")).toBe("SOMEBE-BE");
    expect(expectedKiteNseTradingSymbol("SOMEBZ", "BZ")).toBe("SOMEBZ-BZ");
  });
});

describe("P0.6 NSE reconciliation", () => {
  it("closes to a zero remainder and maps series-qualified symbols", () => {
    const r = build({
      nseMain: [nse("RELIANCE", "EQ"), nse("SOMEBE", "BE")],
      nseSme: [nse("SOMESME", "SM")],
      kite: [kiteNse("RELIANCE", 100), kiteNse("SOMEBE-BE", 200), kiteNse("SOMESME-SM", 300)],
    });

    expect(r.nse.officialRecordCount).toBe(3);
    expect(r.nse.remainder).toBe(0);
    expect(r.nse.ok).toBe(true);
    expect(r.nse.mappedLive).toBe(3);
    expect(r.nse.unmappedLive).toBe(0);
    expect(bySymbol(r.records, "SOMEBE").tradingSymbol).toBe("SOMEBE-BE");
    expect(bySymbol(r.records, "RELIANCE").kiteInstrumentToken).toBe(100);
  });

  it("keeps an unmapped LIVE_REQUIRED security in the LIVE_REQUIRED tier and counts it as unmapped", () => {
    // POLICY: the tier states what the platform MUST have, not what it managed
    // to obtain. Demoting an unmapped security would erase the gap instead of
    // reporting it.
    const r = build({ nseMain: [nse("SWARAJ", "EQ")], kite: [] });
    const rec = bySymbol(r.records, "SWARAJ");

    expect(rec.eligibilityTier).toBe("LIVE_REQUIRED");
    expect(rec.mappingStatus).toBe("UNMAPPED_NO_PROVIDER_RECORD");
    expect(rec.kiteInstrumentToken).toBeNull();
    expect(rec.primaryQuoteProvider).toBeNull();
    expect(rec.mappingReason.length).toBeGreaterThan(0);
    expect(r.nse.liveRequired).toBe(r.nse.mappedLive + r.nse.unmappedLive);
    expect(r.nse.unmappedLive).toBe(1);
    expect(r.nse.remainder).toBe(0);
  });

  it("never matches a bare provider symbol to a non-EQ official series", () => {
    // "SOMEBE" bare in Kite is a DIFFERENT instrument from the BE-series one.
    const r = build({ nseMain: [nse("SOMEBE", "BE")], kite: [kiteNse("SOMEBE", 500)] });
    expect(bySymbol(r.records, "SOMEBE").mappingStatus).toBe("UNMAPPED_NO_PROVIDER_RECORD");
  });
});

describe("P0.6 NSE ETFs are official records in their own right", () => {
  it("ingests the separate ETF publication as SNAPSHOT_ONLY records", () => {
    // REGRESSION: the ETF list shares zero symbols with EQUITY_L, so treating
    // it purely as a reclassification overlay silently dropped every NSE ETF.
    const r = build({ nseEtf: [etf("NIFTYBEES")], kite: [kiteNse("NIFTYBEES", 900)] });
    const rec = bySymbol(r.records, "NIFTYBEES");

    expect(rec.securityClass).toBe("ETF_OR_FUND");
    expect(rec.eligibilityTier).toBe("SNAPSHOT_ONLY");
    expect(rec.sourceProvenance).toContain("NSE_ETF_LIST");
    expect(r.nse.snapshotOnly).toBe(1);
    expect(r.nse.remainder).toBe(0);
  });

  it("does not mint a second record when an ETF symbol also appears in EQUITY_L", () => {
    const r = build({ nseMain: [nse("NIFTYBEES", "EQ")], nseEtf: [etf("NIFTYBEES")] });
    expect(r.records.filter((x) => x.officialSymbol === "NIFTYBEES")).toHaveLength(1);
    expect(bySymbol(r.records, "NIFTYBEES").securityClass).toBe("ETF_OR_FUND");
    expect(r.nse.duplicateCanonicalIdentityCount).toBe(0);
  });
});

describe("P0.6 BSE reconciliation", () => {
  it("maps BSE scrips by exchange token and closes to zero", () => {
    const r = build({
      bseActive: [bse("500325", "A", "Equity", "Active")],
      kite: [kiteBse(500325, 128083204, "RELIANCE")],
    });
    const rec = bySymbol(r.records, "500325");

    expect(rec.kiteExchangeToken).toBe(500325);
    expect(rec.eligibilityTier).toBe("LIVE_REQUIRED");
    expect(r.bse.remainder).toBe(0);
    expect(r.bse.mappedLive).toBe(1);
  });

  it("classifies a suspended scrip as UNAVAILABLE regardless of its group", () => {
    const r = build({ bseSuspended: [bse("512345", "A", "Equity", "Suspended")] });
    const rec = bySymbol(r.records, "512345");
    expect(rec.listingStatus).toBe("SUSPENDED");
    expect(rec.eligibilityTier).toBe("UNAVAILABLE");
    expect(r.bse.unavailable).toBe(1);
  });

  it("treats a blank-segment group R scrip as a rights entitlement, never live", () => {
    const r = build({ bseActive: [bse("780014", "R", "", "Active")] });
    const rec = bySymbol(r.records, "780014");
    expect(rec.securityClass).toBe("RIGHTS_ENTITLEMENT");
    expect(rec.eligibilityTier).not.toBe("LIVE_REQUIRED");
  });

  it("uses the official Segment, not the group letter, to identify preference shares", () => {
    const r = build({
      bseSuspended: [bse("700004", "P", "PreferenceShares", "Suspended", "NA")],
      bseActive: [bse("500001", "P", "Equity", "Active")],
    });
    expect(bySymbol(r.records, "700004").securityClass).toBe("PREFERENCE_SHARE");
    expect(bySymbol(r.records, "500001").securityClass).toBe("BSE_EQUITY_SERIES_P");
    // 'NA' is not an identifier and must never be stored as one.
    expect(bySymbol(r.records, "700004").isin).toBeNull();
  });

  it("reconciles the BSE total against active plus suspended", () => {
    const r = build({
      bseActive: [bse("500325", "A", "Equity", "Active")],
      bseSuspended: [bse("512345", "B", "Equity", "Suspended")],
    });
    expect(r.bseTotalOfficialRecords).toBe(2);
    expect(r.bseSuspendedRecordCount).toBe(1);
    expect(r.bseTotalReconciles).toBe(true);
  });
});

describe("P0.6 provider ambiguity is never resolved by guessing", () => {
  it("rejects ALL claimants of a duplicated provider token rather than picking a winner", () => {
    const r = build({
      bseActive: [bse("500325", "A", "Equity", "Active"), bse("500326", "A", "Equity", "Active")],
      // Both official scrips resolve to the same provider token.
      kite: [kiteBse(500325, 777, "DUPA"), kiteBse(500326, 777, "DUPB")],
    });

    for (const code of ["500325", "500326"]) {
      const rec = bySymbol(r.records, code);
      expect(rec.kiteInstrumentToken).toBeNull();
      expect(rec.conflictStatus).toBe("DUPLICATE_PROVIDER_TOKEN");
      expect(rec.mappingStatus).toBe("REJECTED_DUPLICATE_TOKEN");
    }
    // The rejection must remain VISIBLE. duplicateActiveTokenCount is an
    // invariant check over RETAINED tokens, so a successful rejection drives it
    // to zero — which is exactly why a separate rejected-claimant count exists.
    expect(r.bse.duplicateActiveTokenCount).toBe(0);
    expect(r.bse.duplicateTokenRejectedCount).toBe(2);
    expect(r.bse.ok).toBe(true);
  });

  it("refuses an ambiguous NSE symbol match", () => {
    const r = build({
      nseMain: [nse("AMBIG", "EQ")],
      kite: [kiteNse("AMBIG", 11), kiteNse("AMBIG", 12)],
    });
    const rec = bySymbol(r.records, "AMBIG");
    expect(rec.conflictStatus).toBe("AMBIGUOUS_PROVIDER_MATCH");
    expect(rec.kiteInstrumentToken).toBeNull();
    expect(r.nse.ambiguousMappingCount).toBe(1);
  });
});

describe("P0.6 indices", () => {
  it("classifies provider-declared indices and keeps them out of the official equations", () => {
    const r = build({
      nseMain: [nse("RELIANCE", "EQ")],
      kite: [kiteNse("RELIANCE", 100), kiteIndex("NIFTY 50", "NSE", 256265), kiteIndex("SENSEX", "BSE", 265)],
    });

    expect(r.indexRecords).toHaveLength(2);
    for (const idx of r.indexRecords) {
      expect(idx.securityClass).toBe("INDEX");
      expect(idx.segment).toBe("INDEX");
    }
    // Indices are not official NSE/BSE equity records and must not inflate them.
    expect(r.nse.officialRecordCount).toBe(1);
    expect(r.bse.officialRecordCount).toBe(0);
  });
});

describe("P0.6 record identity", () => {
  it("preserves a prior first-seen timestamp instead of resetting instrument history", () => {
    const first = build({ nseMain: [nse("RELIANCE", "EQ")], kite: [kiteNse("RELIANCE", 100)] });
    const id = bySymbol(first.records, "RELIANCE").authoritativeSecurityId;

    const second = build({
      nseMain: [nse("RELIANCE", "EQ")],
      kite: [kiteNse("RELIANCE", 100)],
      priorFirstSeen: new Map([[id, "2019-01-01T00:00:00.000Z"]]),
    });
    expect(bySymbol(second.records, "RELIANCE").firstSeenAt).toBe("2019-01-01T00:00:00.000Z");
  });

  it("stamps every record with the generation that produced it and explains its tier", () => {
    const r = build({ nseMain: [nse("RELIANCE", "EQ")], kite: [kiteNse("RELIANCE", 100)] });
    const rec = bySymbol(r.records, "RELIANCE");
    expect(rec.registryGenerationId).toBe(GEN);
    expect(rec.effectiveDate).toBe(EFFECTIVE);
    expect(rec.classificationEvidence.length).toBeGreaterThan(0);
    expect(rec.tierReason.length).toBeGreaterThan(0);
  });
});

// ── Coverage bridge ─────────────────────────────────────────────────────────

function acceptedSources(): OfficialSourceProvenance[] {
  return REQUIRED_SOURCE_IDS.map((sourceId) => ({
    sourceId: sourceId as OfficialSourceProvenance["sourceId"],
    sourceName: sourceId,
    sourceUrl: `https://example.invalid/${sourceId}`,
    retrievedAt: GENERATED_AT,
    effectiveDate: EFFECTIVE,
    effectiveDateBasis: "RETRIEVAL_DATE",
    contentHash: "0".repeat(64),
    rowCount: 1,
    validationResult: "ACCEPTED",
    freshnessState: "CURRENT_AUTHORITATIVE",
    rejectionDetail: null,
  }));
}

function generation() {
  const build_ = build({
    nseMain: [nse("RELIANCE", "EQ")],
    bseActive: [bse("500325", "A", "Equity", "Active")],
    kite: [kiteNse("RELIANCE", 100), kiteBse(500325, 128083204, "RELIANCE")],
  });
  const manifest = buildUniverseManifest({
    build: build_,
    sources: acceptedSources(),
    bseAuthority: makeCurrentAuthoritativeBse("0".repeat(64)),
    manifestVersion: 1,
    registryGenerationId: GEN,
    generatedAt: GENERATED_AT,
    effectiveDate: EFFECTIVE,
    requiredSourceIds: REQUIRED_SOURCE_IDS,
    tradingCalendar: makeCalendarCommitment(),
  });
  return { manifest, records: build_.records };
}

/** A generation containing BOTH a mapped and an UNMAPPED LIVE_REQUIRED record. */
function unmappedLiveGeneration() {
  const built = build({
    nseMain: [nse("RELIANCE", "EQ"), nse("SWARAJ", "EQ")],
    kite: [kiteNse("RELIANCE", 100)], // SWARAJ has no provider record.
  });
  const manifest = buildUniverseManifest({
    build: built,
    sources: acceptedSources(),
    bseAuthority: makeCurrentAuthoritativeBse("0".repeat(64)),
    manifestVersion: 1,
    registryGenerationId: GEN,
    generatedAt: GENERATED_AT,
    effectiveDate: EFFECTIVE,
    requiredSourceIds: REQUIRED_SOURCE_IDS,
    tradingCalendar: makeCalendarCommitment(),
  });
  return { manifest, records: built.records };
}

describe("P0.6 coverage bridge is fail-closed", () => {
  it("claims authority only for an accepted, checksum-valid, reconciled generation", () => {
    const g = generation();
    expect(g.manifest.acceptanceStatus).toBe("ACCEPTED");

    const cov = toAuthoritativeCoverageManifest(g, FIXTURE_NOW_MS);
    expect(cov.coverageAuthority).toBe("AUTHORITATIVE_RECONCILED_UNIVERSE");
    expect(cov.universeGenerationId).toBe(GEN);
    expect(cov.universeReconciliationValid).toBe(true);
    expect(cov.requiredInstrumentIds.length).toBe(2);
    // Phase 0.6 expands no subscription, so none may be reported.
    expect(cov.subscriptionRequestedCount).toBe(0);
  });

  it("degrades to UNIVERSE_NOT_CONFIGURED when there is no generation", () => {
    expect(toAuthoritativeCoverageManifest(null, FIXTURE_NOW_MS).coverageAuthority).toBe("UNIVERSE_NOT_CONFIGURED");
    expect(toAuthoritativeCoverageManifest(undefined, FIXTURE_NOW_MS).coverageAuthority).toBe("UNIVERSE_NOT_CONFIGURED");
  });

  it("refuses authority for a REJECTED manifest", () => {
    const g = generation();
    const rejected = { ...g.manifest, acceptanceStatus: "REJECTED" as const, blockers: ["forced"] };
    expect(toAuthoritativeCoverageManifest({ manifest: rejected, records: g.records }, FIXTURE_NOW_MS).coverageAuthority).toBe(
      "UNIVERSE_NOT_CONFIGURED",
    );
  });

  it("refuses authority when the manifest checksum does not match its content", () => {
    const g = generation();
    const tampered = { ...g.manifest, totalOfficialRecords: g.manifest.totalOfficialRecords + 1 };
    expect(toAuthoritativeCoverageManifest({ manifest: tampered, records: g.records }, FIXTURE_NOW_MS).coverageAuthority).toBe(
      "UNIVERSE_NOT_CONFIGURED",
    );
  });

  it("refuses authority when a required instrument has no canonical identity", () => {
    // A denominator that silently omits a required instrument would overstate
    // coverage, so the whole authority claim is withdrawn instead.
    const g = generation();
    const damaged = g.records.map((r, i) =>
      i === 0 && r.eligibilityTier === "LIVE_REQUIRED" ? { ...r, canonicalInstrumentId: null } : r,
    );
    expect(toAuthoritativeCoverageManifest({ manifest: g.manifest, records: damaged }, FIXTURE_NOW_MS).coverageAuthority).toBe(
      "UNIVERSE_NOT_CONFIGURED",
    );
  });

  it("refuses authority when an UNMAPPED live record is demoted out of the denominator", () => {
    // THE critical tamper case. An unmapped LIVE_REQUIRED record contributes to
    // the denominator but NOT to eligibleLiveSetHash (which covers mapped rows
    // only). Demoting it therefore leaves the checksum, the live-set hash and
    // the tier-count arithmetic all self-consistent, while silently shrinking
    // the denominator. Only the full record-set commitment catches this.
    const g = unmappedLiveGeneration();
    const target = g.records.findIndex(
      (r) => r.eligibilityTier === "LIVE_REQUIRED" && r.mappingStatus !== "MAPPED_EXACT",
    );
    expect(target).toBeGreaterThanOrEqual(0);

    const demoted = g.records.map((r, i) =>
      i === target ? { ...r, eligibilityTier: "EXCLUDED_NON_STOCK" as const } : r,
    );
    expect(computeEligibleLiveSetHash(demoted)).toBe(g.manifest.eligibleLiveSetHash);
    expect(verifyManifestChecksum(g.manifest)).toBe(true);

    expect(toAuthoritativeCoverageManifest({ manifest: g.manifest, records: demoted }, FIXTURE_NOW_MS).coverageAuthority).toBe(
      "UNIVERSE_NOT_CONFIGURED",
    );
  });

  it("refuses authority when a record is removed outright", () => {
    const g = unmappedLiveGeneration();
    const fewer = g.records.slice(1);
    expect(toAuthoritativeCoverageManifest({ manifest: g.manifest, records: fewer }, FIXTURE_NOW_MS).coverageAuthority).toBe(
      "UNIVERSE_NOT_CONFIGURED",
    );
  });

  it("refuses authority for a manifest written under a different schema or policy version", () => {
    // The bridge is the authority boundary: it cannot assume the loader ran.
    const g = generation();
    for (const drift of [{ schemaVersion: 999 }, { policyVersion: 999 }]) {
      const shifted = { ...g.manifest, ...drift };
      const rechecksummed = { ...shifted, manifestChecksum: computeManifestChecksum(shifted) };
      // Self-consistent, so only an explicit version gate can reject it.
      expect(verifyManifestChecksum(rechecksummed)).toBe(true);
      expect(toAuthoritativeCoverageManifest({ manifest: rechecksummed, records: g.records }, FIXTURE_NOW_MS).coverageAuthority).toBe(
        "UNIVERSE_NOT_CONFIGURED",
      );
    }
  });

  it("refuses authority when the required live set is empty", () => {
    const only = build({ nseEtf: [etf("NIFTYBEES")], kite: [kiteNse("NIFTYBEES", 900)] });
    const manifest = buildUniverseManifest({
      build: only,
      sources: acceptedSources(),
      bseAuthority: makeCurrentAuthoritativeBse("0".repeat(64)),
      manifestVersion: 1,
      registryGenerationId: GEN,
      generatedAt: GENERATED_AT,
      effectiveDate: EFFECTIVE,
      requiredSourceIds: REQUIRED_SOURCE_IDS,
    tradingCalendar: makeCalendarCommitment(),
    });
    expect(toAuthoritativeCoverageManifest({ manifest, records: only.records }, FIXTURE_NOW_MS).coverageAuthority).toBe(
      "UNIVERSE_NOT_CONFIGURED",
    );
  });
});
