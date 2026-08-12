/**
 * Shared inline fixtures for the Phase 0.6 universe-manifest / manifest-store
 * tests. NO network, NO database — every value here is synthetic and local.
 *
 * This is a test-support module (imported only by *.p06.test.ts). It does not
 * modify any module under test; it merely constructs valid inputs for them.
 */

import type {
  OfficialSourceProvenance,
  OfficialSourceId,
} from "./officialSources";
import { SOURCE_URLS, sha256Hex } from "./officialSources";
import type {
  ExchangeReconciliation,
  RegistryBuildResult,
  RegistryRecord,
} from "./instrumentRegistry";
import { REQUIRED_SOURCE_IDS } from "./universeManifest";

export const GEN_ID = "gen-p06-test-0001";
export const GENERATED_AT = "2026-08-12T09:30:00.000Z";
export const EFFECTIVE_DATE = "2026-08-12";

/** A single LIVE_REQUIRED, exactly-mapped NSE ordinary equity record. */
export function makeLiveRecord(
  overrides: Partial<RegistryRecord> = {},
): RegistryRecord {
  const symbol = overrides.tradingSymbol ?? "RELIANCE";
  const base: RegistryRecord = {
    canonicalInstrumentId: `NSE:EQUITY:${symbol}`,
    authoritativeSecurityId: `NSE:${symbol}:EQ`,
    exchange: "NSE",
    segment: "EQUITY",
    tradingSymbol: symbol,
    normalizedTradingSymbol: symbol.toUpperCase(),
    officialSymbol: symbol,
    seriesOrGroup: "EQ",
    isin: "INE002A01018",
    securityClass: "NSE_ORDINARY_EQUITY_EQ",
    listingStatus: "ACTIVE",
    eligibilityTier: "LIVE_REQUIRED",
    kiteInstrumentToken: 738561,
    kiteExchangeToken: 2885,
    kiteExchange: "NSE",
    kiteSegment: "NSE",
    upstoxInstrumentId: null,
    primaryQuoteProvider: "KITE",
    validationProviderStatus: "NOT_CHECKED",
    sourceProvenance: ["NSE_EQUITY_L"],
    effectiveDate: EFFECTIVE_DATE,
    registryGenerationId: GEN_ID,
    mappingStatus: "MAPPED_EXACT",
    mappingReason: "exact NSE series-qualified symbol match",
    conflictStatus: "NONE",
    aliases: [symbol],
    firstSeenAt: null,
    lastConfirmedAt: GENERATED_AT,
    classificationEvidence: "official NSE SERIES=EQ",
    tierReason: "owner-approved live class NSE_ORDINARY_EQUITY_EQ",
  };
  return { ...base, ...overrides };
}

/** Build `count` distinct LIVE_REQUIRED mapped records with unique tokens. */
export function makeLiveRecords(
  count: number,
  genId: string = GEN_ID,
): RegistryRecord[] {
  const records: RegistryRecord[] = [];
  for (let i = 0; i < count; i++) {
    const symbol = `SYM${String(i).padStart(6, "0")}`;
    records.push(
      makeLiveRecord({
        canonicalInstrumentId: `NSE:EQUITY:${symbol}`,
        authoritativeSecurityId: `NSE:${symbol}:EQ`,
        tradingSymbol: symbol,
        normalizedTradingSymbol: symbol,
        officialSymbol: symbol,
        isin: null,
        kiteInstrumentToken: 1000000 + i,
        kiteExchangeToken: 2000000 + i,
        aliases: [symbol],
        registryGenerationId: genId,
      }),
    );
  }
  return records;
}

function emptyReconciliation(
  exchange: "NSE" | "BSE",
  officialRecordCount: number,
  liveRequired: number,
): ExchangeReconciliation {
  return {
    exchange,
    officialRecordCount,
    liveRequired,
    snapshotOnly: 0,
    unavailable: 0,
    excludedNonStock: 0,
    unresolved: 0,
    remainder: 0,
    mappedLive: liveRequired,
    unmappedLive: 0,
    duplicateCanonicalIdentityCount: 0,
    duplicateActiveTokenCount: 0,
    duplicateTokenRejectedCount: 0,
    ambiguousMappingCount: 0,
    ok: true,
    failures: [],
  };
}

/**
 * A clean RegistryBuildResult carrying the supplied records (all treated as
 * NSE for the reconciliation summary — the manifest only reads counts/failures
 * from these summaries, so their internal exactness is not what is under test).
 */
export function makeBuildResult(
  records: readonly RegistryRecord[],
  overrides: Partial<RegistryBuildResult> = {},
): RegistryBuildResult {
  const liveRequired = records.filter(
    (r) => r.eligibilityTier === "LIVE_REQUIRED",
  ).length;
  const base: RegistryBuildResult = {
    records,
    indexRecords: [],
    nse: emptyReconciliation("NSE", records.length, liveRequired),
    bse: emptyReconciliation("BSE", 0, 0),
    bseTotalOfficialRecords: 0,
    bseSuspendedRecordCount: 0,
    bseTotalReconciles: true,
    ok: true,
    failures: [],
  };
  return { ...base, ...overrides };
}

function acceptedProvenance(sourceId: OfficialSourceId): OfficialSourceProvenance {
  return {
    sourceId,
    sourceName: `synthetic ${sourceId}`,
    sourceUrl: SOURCE_URLS[sourceId],
    retrievedAt: GENERATED_AT,
    effectiveDate: EFFECTIVE_DATE,
    effectiveDateBasis: "RETRIEVAL_DATE",
    contentHash: sha256Hex(`synthetic-${sourceId}`),
    rowCount: 5000,
    validationResult: "ACCEPTED",
    freshnessState: "CURRENT_AUTHORITATIVE",
    rejectionDetail: null,
  };
}

/** All required sources, each ACCEPTED. */
export function makeAcceptedSources(): OfficialSourceProvenance[] {
  return REQUIRED_SOURCE_IDS.map((id) => acceptedProvenance(id as OfficialSourceId));
}
