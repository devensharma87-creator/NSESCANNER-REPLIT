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
import type { BseReferenceAuthorityResult } from "./bseReferencePolicy";
import { evaluateBseReferenceAuthority } from "./bseReferencePolicy";
import type {
  CalendarExchange,
  ExchangeCalendarGeneration,
  ParsedCalendarSource,
  SessionTimingSource,
  TradingCalendarCommitment,
} from "./exchangeCalendar";
import {
  buildExchangeCalendar,
  toCalendarCommitment,
  TIMING_EXTRACTION_VERSION,
} from "./exchangeCalendar";

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
/**
 * A CURRENT_AUTHORITATIVE BSE authority produced by the real policy function
 * rather than hand-written. If the policy stops accepting these inputs, every
 * fixture-based test fails loudly instead of quietly testing a stale shape.
 *
 * IST 2026-08-12 is a Wednesday; the latest completed session is Tuesday 08-11.
 */
export function makeCurrentAuthoritativeBse(
  listContentHash: string = sha256Hex("synthetic-BSE_LIST_OF_SCRIPS_ACTIVE"),
): BseReferenceAuthorityResult {
  const nowMs = Date.parse(GENERATED_AT);
  const result = evaluateBseReferenceAuthority({
    nowMs,
    list: {
      outcome: "RETRIEVED",
      retrievedAtMs: nowMs,
      validationResult: "ACCEPTED",
      // MUST match the BSE List provenance the manifest carries: acceptance
      // binds the authority verdict to the body it was computed over. Callers
      // using their own source fixtures must pass their own hash.
      contentHash: listContentHash,
    },
    udiff: {
      tradingDate: "2026-08-11",
      sessionCompleted: true,
      validationResult: "ACCEPTED",
      contentHash: "bse-udiff-hash-fixture",
      retrievedAtMs: nowMs,
    },
    calendar: { known: true, dayKind: "TRADING_DAY", latestCompletedSessionDate: "2026-08-11" },
    hasPriorAcceptedGeneration: false,
    reconciliationClosed: true,
  });
  if (result.state !== "CURRENT_AUTHORITATIVE") {
    throw new Error(`fixture expected CURRENT_AUTHORITATIVE, policy returned ${result.state}`);
  }
  return result;
}

/**
 * Eight real 2026 weekday exchange holidays — enough to clear the annual-source
 * floor, and deliberately none of them in August, so the fixture calendar's
 * August sessions are ordinary and predictable.
 */
export const FIXTURE_HOLIDAYS_2026: readonly string[] = [
  "2026-01-26",
  "2026-03-03",
  "2026-03-26",
  "2026-03-31",
  "2026-04-03",
  "2026-04-14",
  "2026-05-01",
  "2026-05-28",
];

export function makeAnnualCalendarSource(
  exchange: CalendarExchange,
  holidays: readonly string[] = FIXTURE_HOLIDAYS_2026,
): ParsedCalendarSource {
  return {
    provenance: {
      exchange,
      sourceId: `${exchange}_TRADING_HOLIDAYS_2026`,
      sourceName: `synthetic ${exchange} annual trading calendar 2026`,
      sourceUrl: `https://example.invalid/${exchange}/holidays/2026`,
      retrievedAt: GENERATED_AT,
      calendarYear: 2026,
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-12-31",
      contentHash: sha256Hex(`synthetic-${exchange}-calendar-${holidays.join(",")}`),
      eventCount: holidays.length,
      validationResult: "ACCEPTED",
      kind: "ANNUAL_CALENDAR",
      issuedAt: "2026-01-01",
      rejectionDetail: null,
    },
    events: holidays.map((tradingDate) => ({
      exchange,
      tradingDate,
      sessionType: "CLOSED" as const,
      description: "exchange holiday",
      scheduledOpenIst: null,
      scheduledCloseIst: null,
      sourceId: `${exchange}_TRADING_HOLIDAYS_2026`,
    })),
  };
}

/**
 * A synthetic stand-in for an exchange's OWN published session-timing document.
 *
 * Each exchange gets its own source id, its own content hash and its own
 * evidence rows even though the hours coincide — the fixture mirrors the real
 * rule that identical times still require independent provenance.
 */
export function makeSessionTimingSource(
  exchange: CalendarExchange,
  openIst = "09:15",
  closeIst = "15:30",
): SessionTimingSource {
  const body = `synthetic-${exchange}-session-timings-${openIst}-${closeIst}`;
  return {
    provenance: {
      exchange,
      sourceId: `${exchange}_SESSION_TIMINGS_2026`,
      sourceName: `synthetic ${exchange} official session timings 2026`,
      sourceUrl: `https://example.invalid/${exchange}/session-timings`,
      retrievedAt: GENERATED_AT,
      effectiveYear: 2026,
      effectiveFrom: "2026-01-01",
      contentHash: sha256Hex(body),
      contentBytes: body.length,
      extractionVersion: TIMING_EXTRACTION_VERSION,
      validationResult: "ACCEPTED",
      rejectionDetail: null,
    },
    openIst,
    closeIst,
    preOpenOpenIst: null,
    preOpenCloseIst: null,
    closingSessionOpenIst: null,
    closingSessionCloseIst: null,
    evidence: [
      { label: `${exchange} normal market open`, value: openIst },
      { label: `${exchange} normal market close`, value: closeIst },
    ],
  };
}

/** A valid two-exchange 2026 calendar built by the real builder. */
export function makeFixtureCalendar(): ExchangeCalendarGeneration {
  return buildExchangeCalendar({
    sources: [makeAnnualCalendarSource("NSE"), makeAnnualCalendarSource("BSE")],
    timings: [makeSessionTimingSource("NSE"), makeSessionTimingSource("BSE")],
    exchanges: ["NSE", "BSE"],
    years: [2026],
    generatedAt: GENERATED_AT,
  });
}

/**
 * The calendar commitment the manifest fixtures carry.
 *
 * GENERATED_AT is 15:00 IST on Wednesday 2026-08-12 — before the 15:30 close —
 * so the latest completed session is Tuesday 2026-08-11, which is exactly the
 * date `makeCurrentAuthoritativeBse` reconciles its UDiFF to.
 */
export function makeCalendarCommitment(): TradingCalendarCommitment {
  return toCalendarCommitment(makeFixtureCalendar(), Date.parse(GENERATED_AT));
}

export function makeAcceptedSources(): OfficialSourceProvenance[] {
  return REQUIRED_SOURCE_IDS.map((id) => acceptedProvenance(id as OfficialSourceId));
}
