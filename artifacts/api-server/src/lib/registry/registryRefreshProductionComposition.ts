/**
 * PHASE 0.8D — REGISTRY REFRESH: PRODUCTION COMPOSITION
 *
 * Binds the abstract Phase 0.8D orchestrator to the accepted authority
 * pipeline. This file is wiring: every decision it defers to a module that has
 * already been reviewed and accepted.
 *
 *   retrieval    boundedSourceRetrieval (transport only)
 *   parsing      officialSources / exchangeCalendarSources  (pure parsers)
 *   completeness officialSources.isSourceAccepted
 *   calendar     exchangeCalendar.buildExchangeCalendar + latest completed session
 *   BSE policy   bseReferencePolicy.evaluateBseReferenceAuthority
 *   build        instrumentRegistry.buildRegistry
 *   manifest     universeManifest.buildUniverseManifest
 *   commit       manifestStore.saveRegistryGeneration
 *   cold load    manifestStore.loadLatestAcceptedGeneration
 *   promotion    manifestStore.getActiveGeneration + coverageBridge
 *
 * NO LOGIC IS REPRODUCED HERE. In particular the commit path is delegated
 * whole: `saveRegistryGeneration` owns pre-commit validation, the advisory
 * lock, `ON CONFLICT DO NOTHING` and retention-inside-the-transaction.
 * Re-implementing any of those outside the transaction would be fail-open.
 *
 * ORDER OF REFUSAL
 *
 * `createRegistryRefreshService` checks the authorization lock as its very
 * first act and returns before calling any port — including the clock. Every
 * port below is lazy, and building the ports object performs no IO. With the
 * lock false this file therefore reaches no exchange, no SDK and no database.
 *
 * NO EXECUTION SURFACE
 *
 * No route, scheduler, timer, boot hook or module-scope invocation. The only
 * exported way to run the operation is a factory a caller must deliberately
 * construct, and it refuses while the lock is false.
 */

import { createHash } from "node:crypto";

import {
  AUTHORITATIVE_REGISTRY_REFRESH_AUTHORIZED,
  REGISTRY_REFRESH_AUTHORIZATION_ID,
} from "./registryRefreshControl";
import {
  createRegistryRefreshService,
  REQUIRED_REFRESH_SOURCE_IDS,
  type BseAuthorityDecision,
  type ColdLoadVerification,
  type CalendarResolution,
  type FetchedOfficialSource,
  type GenerationBuildOutcome,
  type RegistryRefreshPorts,
  type RegistryRefreshService,
  type SourceValidationVerdict,
} from "./registryRefreshOrchestrator";
import {
  SOURCE_URLS,
  isSourceAccepted,
  parseBseListOfScrips,
  parseKiteInstrumentCsv,
  parseNseEquityCsv,
  parseNseEtfCsv,
  sha256Hex,
  type BseRawRow,
  type KiteMasterRow,
  type NseOfficialEquityRow,
  type NseOfficialEtfRow,
  type OfficialSourceId,
  type OfficialSourceProvenance,
  type ParsedSource,
} from "./officialSources";
import { buildRegistry } from "./instrumentRegistry";
import {
  CLASSIFICATION_POLICY_VERSION,
  MANIFEST_SCHEMA_VERSION,
  REQUIRED_SOURCE_IDS,
  buildUniverseManifest,
} from "./universeManifest";
import {
  getActiveGeneration,
  loadLatestAcceptedGeneration,
  saveRegistryGeneration,
  type RegistryGeneration,
} from "./manifestStore";
import { toAuthoritativeCoverageManifest } from "./coverageBridge";
import {
  evaluateBseReferenceAuthority,
  type BseListRetrieval,
  type BseUdiffDescriptor,
} from "./bseReferencePolicy";
import {
  buildExchangeCalendar,
  evaluateCalendarAuthorityNow,
  getLatestCompletedTradingSession,
  toCalendarCommitment,
  toTradingCalendarVerdict,
  validateBhavcopySession,
  type ExchangeCalendarGeneration,
} from "./exchangeCalendar";
import {
  BSE_EQUITY_SESSION_TIMINGS_PAGE,
  BSE_TRADING_HOLIDAYS_URL,
  NSE_HOLIDAY_MASTER_URL,
  NSE_MARKET_TIMINGS_URL,
  bseUdiffUrlFor,
  parseBseSessionTimings,
  parseBseTradingHolidayPage,
  parseBseUdiff,
  parseNseHolidayMaster,
  parseNseMarketTimings,
} from "./exchangeCalendarSources";
import {
  APPROVED_SOURCE_HOSTS,
  RETRIEVAL_MAX_BYTES,
  RETRIEVAL_TIMEOUT_MS,
  boundedFetchBytes,
  exchangeRequestHeaders,
} from "./boundedSourceRetrieval";
import { logger } from "../logger";

export const REGISTRY_REFRESH_COMPOSITION_ID = "REGISTRY_REFRESH_PRODUCTION_COMPOSITION_V1";

/**
 * The accepted content-derived identity scheme, prefix included.
 *
 * The prefix is part of the identity, NOT a claim about which code path built
 * the generation. Changing it would mean the same six source hashes under the
 * same schema and policy produce a different id, so an unchanged universe
 * would insert a duplicate row instead of taking the `ON CONFLICT` no-op path.
 */
const REGISTRY_GENERATION_ID_PREFIX = "P06-";

/**
 * Content types each source is permitted to arrive as.
 *
 * Exchanges are inconsistent about labelling CSV, so several spellings are
 * allowed — but `text/html` is not, because an HTML body where a CSV was
 * expected is the signature of a bot-block or an error page, and it must fail
 * retrieval rather than reach a parser that would report zero rows.
 */
const CSV_CONTENT_TYPES = Object.freeze([
  "text/csv",
  "application/csv",
  "text/plain",
  "application/octet-stream",
]);
const JSON_CONTENT_TYPES = Object.freeze([
  "application/json",
  "text/json",
  "text/plain",
  "application/octet-stream",
]);
const SCRIPT_CONTENT_TYPES = Object.freeze([
  "application/javascript",
  "text/javascript",
  "text/plain",
  "application/octet-stream",
]);
const HTML_CONTENT_TYPES = Object.freeze(["text/html", "application/xhtml+xml"]);

const SOURCE_CONTENT_TYPES: Readonly<Record<OfficialSourceId, readonly string[]>> = Object.freeze({
  NSE_EQUITY_L: CSV_CONTENT_TYPES,
  NSE_SME_EQUITY_L: CSV_CONTENT_TYPES,
  NSE_ETF_LIST: CSV_CONTENT_TYPES,
  BSE_LIST_OF_SCRIPS_ACTIVE: JSON_CONTENT_TYPES,
  BSE_LIST_OF_SCRIPS_SUSPENDED: JSON_CONTENT_TYPES,
  KITE_INSTRUMENT_MASTER: CSV_CONTENT_TYPES,
});

/**
 * All six official sources are decoded latin-1, matching the accepted Phase 0.6
 * composition exactly. NSE's listing CSVs carry latin-1 company names, and
 * decoding them as UTF-8 mangles the bytes before the parser ever sees them.
 *
 * latin-1 maps bytes 1:1 onto code points 0-255, so `sha256Hex(decoded)` is
 * still an injective function of the raw bytes — the same content hash the
 * accepted parsers compute for provenance.
 */
const SOURCE_ENCODING: BufferEncoding = "latin1";

export const REGISTRY_COMPOSITION_REASON = Object.freeze({
  CALENDAR_SOURCE_RETRIEVAL_FAILED: "CALENDAR_SOURCE_RETRIEVAL_FAILED",
  CALENDAR_INVALID: "EXCHANGE_CALENDAR_INVALID",
  LATEST_COMPLETED_SESSION_UNKNOWN: "LATEST_COMPLETED_SESSION_UNKNOWN",
  CALENDAR_NOT_RESOLVED: "CALENDAR_NOT_RESOLVED_BEFORE_BSE_AUTHORITY",
  UDIFF_RETRIEVAL_FAILED: "BSE_UDIFF_RETRIEVAL_FAILED",
  UDIFF_SESSION_MISMATCH: "BSE_UDIFF_IS_NOT_LATEST_COMPLETED_SESSION",
  PARSED_SOURCES_INCOMPLETE: "PARSED_SOURCES_INCOMPLETE",
  RECONCILIATION_FAILED: "EXCHANGE_RECONCILIATION_FAILED",
  MANIFEST_REJECTED: "UNIVERSE_MANIFEST_NOT_ACCEPTED",
  COLD_LOAD_NULL: "COLD_LOAD_RETURNED_NULL",
  COLD_LOAD_MISMATCH: "COLD_LOAD_GENERATION_ID_MISMATCH",
  NOT_ACTIVE: "COMMITTED_GENERATION_IS_NOT_ACTIVE",
  COVERAGE_NOT_AUTHORITATIVE: "COVERAGE_AUTHORITY_NOT_GRANTED",
} as const);

// ── dependency seam ──────────────────────────────────────────────────────────

/**
 * The accepted functions this composition binds to, held by object identity so
 * a test can prove production points at the real pipeline rather than at
 * look-alike helpers, and so the same wiring can be exercised against fakes.
 */
export interface ProductionRegistryRefreshDeps {
  readonly fetchBytes: typeof boundedFetchBytes;
  // build + manifest
  readonly buildRegistry: typeof buildRegistry;
  readonly buildUniverseManifest: typeof buildUniverseManifest;
  readonly evaluateBseReferenceAuthority: typeof evaluateBseReferenceAuthority;
  // calendar source parsers
  readonly parseNseHolidayMaster: typeof parseNseHolidayMaster;
  readonly parseBseTradingHolidayPage: typeof parseBseTradingHolidayPage;
  readonly parseNseMarketTimings: typeof parseNseMarketTimings;
  readonly parseBseSessionTimings: typeof parseBseSessionTimings;
  readonly parseBseUdiff: typeof parseBseUdiff;
  // calendar judgments
  readonly buildExchangeCalendar: typeof buildExchangeCalendar;
  readonly getLatestCompletedTradingSession: typeof getLatestCompletedTradingSession;
  readonly toCalendarCommitment: typeof toCalendarCommitment;
  readonly evaluateCalendarAuthorityNow: typeof evaluateCalendarAuthorityNow;
  readonly toTradingCalendarVerdict: typeof toTradingCalendarVerdict;
  readonly validateBhavcopySession: typeof validateBhavcopySession;
  // durable store + promotion
  readonly saveRegistryGeneration: typeof saveRegistryGeneration;
  readonly loadLatestAcceptedGeneration: typeof loadLatestAcceptedGeneration;
  readonly getActiveGeneration: typeof getActiveGeneration;
  readonly toAuthoritativeCoverageManifest: typeof toAuthoritativeCoverageManifest;
}

/**
 * EVERY accepted function this composition depends on, held by object identity.
 *
 * Complete on purpose. A dependency reached by direct call instead of through
 * this object would be invisible to the binding test AND unreplaceable in the
 * test composition, so the wiring around it could never be exercised.
 */
export const PRODUCTION_REGISTRY_REFRESH_DEPS: ProductionRegistryRefreshDeps = Object.freeze({
  fetchBytes: boundedFetchBytes,
  buildRegistry,
  buildUniverseManifest,
  evaluateBseReferenceAuthority,
  parseNseHolidayMaster,
  parseBseTradingHolidayPage,
  parseNseMarketTimings,
  parseBseSessionTimings,
  parseBseUdiff,
  buildExchangeCalendar,
  getLatestCompletedTradingSession,
  toCalendarCommitment,
  evaluateCalendarAuthorityNow,
  toTradingCalendarVerdict,
  validateBhavcopySession,
  saveRegistryGeneration,
  loadLatestAcceptedGeneration,
  getActiveGeneration,
  toAuthoritativeCoverageManifest,
});

// ── run-scoped state ─────────────────────────────────────────────────────────

/**
 * Carried between ports within a single refresh.
 *
 * The orchestrator retrieves each source exactly once and hands the same bytes
 * to every consumer, so the parsed form is kept here rather than re-parsed per
 * step: parsing twice would produce two row sets from one provenance hash.
 */
interface RunScratch {
  nseMain: ParsedSource<NseOfficialEquityRow> | null;
  nseSme: ParsedSource<NseOfficialEquityRow> | null;
  nseEtf: ParsedSource<NseOfficialEtfRow> | null;
  bseActive: ParsedSource<BseRawRow> | null;
  bseSuspended: ParsedSource<BseRawRow> | null;
  kite: ParsedSource<KiteMasterRow> | null;
  calendar: ExchangeCalendarGeneration | null;
  bseList: BseListRetrieval | null;
  udiff: BseUdiffDescriptor | null;
  priorLoaded: boolean;
  prior: RegistryGeneration | null;
}

function emptyScratch(): RunScratch {
  return {
    nseMain: null,
    nseSme: null,
    nseEtf: null,
    bseActive: null,
    bseSuspended: null,
    kite: null,
    calendar: null,
    bseList: null,
    udiff: null,
    priorLoaded: false,
    prior: null,
  };
}

/**
 * A port that THROWS has violated its own contract.
 *
 * The orchestrator guards the fetch port specifically and maps it to
 * FETCH_FAILED; every other port is declared to RETURN a decision, so it
 * catches nothing for them. Without the guards below, a malformed UDiFF that
 * makes a parser throw, or a database outage inside `saveRegistryGeneration`,
 * would escape `runRefreshNow()` as an unhandled rejection instead of a coded
 * refusal — and the caller would learn nothing about which stage failed.
 *
 * Fixed in the composition rather than the orchestrator: this is the adapter
 * boundary, and totality is exactly what an adapter owes the contract above it.
 */
const PORT_THREW = "PORT_IMPLEMENTATION_THREW";

/**
 * Only the error CLASS crosses the boundary.
 *
 * Messages from fetch, pg and the parsers routinely carry URLs, connection
 * strings and row payloads; a reason code that embedded them would leak source
 * material into logs and diagnostics.
 */
function failureLabel(err: unknown): string {
  return err instanceof Error && typeof err.name === "string" && err.name.length > 0
    ? err.name
    : "UNKNOWN_ERROR";
}

async function guarded<T>(fn: () => Promise<T>, onThrow: (reasonCode: string) => T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    return onThrow(`${PORT_THREW}:${failureLabel(err)}`);
  }
}

class OfficialSourceRetrievalError extends Error {
  constructor(sourceId: OfficialSourceId, reasonCode: string) {
    super(`${sourceId}:${reasonCode}`);
    this.name = "OfficialSourceRetrievalError";
  }
}

function provenanceOf(scratch: RunScratch, sourceId: OfficialSourceId): OfficialSourceProvenance | null {
  switch (sourceId) {
    case "NSE_EQUITY_L":
      return scratch.nseMain?.provenance ?? null;
    case "NSE_SME_EQUITY_L":
      return scratch.nseSme?.provenance ?? null;
    case "NSE_ETF_LIST":
      return scratch.nseEtf?.provenance ?? null;
    case "BSE_LIST_OF_SCRIPS_ACTIVE":
      return scratch.bseActive?.provenance ?? null;
    case "BSE_LIST_OF_SCRIPS_SUSPENDED":
      return scratch.bseSuspended?.provenance ?? null;
    case "KITE_INSTRUMENT_MASTER":
      return scratch.kite?.provenance ?? null;
    default:
      return null;
  }
}

// ── ports ────────────────────────────────────────────────────────────────────

export function buildProductionRegistryRefreshPorts(
  deps: ProductionRegistryRefreshDeps,
): RegistryRefreshPorts {
  const scratch = emptyScratch();

  const getPrior = async (): Promise<RegistryGeneration | null> => {
    if (!scratch.priorLoaded) {
      scratch.prior = await deps.loadLatestAcceptedGeneration("PRIOR_FIRST_SEEN_CARRY_FORWARD");
      scratch.priorLoaded = true;
    }
    return scratch.prior;
  };

  const retrieveText = async (
    url: string,
    allowedContentTypePrefixes: readonly string[],
  ): Promise<{ ok: true; text: string } | { ok: false; reasonCode: string }> => {
    const res = await deps.fetchBytes({
      url,
      allowedContentTypePrefixes,
      headers: exchangeRequestHeaders(url),
    });
    if (!res.ok) return { ok: false, reasonCode: res.reasonCode };
    return { ok: true, text: res.bytes.toString(SOURCE_ENCODING) };
  };

  return {
    clock: { nowMs: () => Date.now() },

    // ── official source retrieval ────────────────────────────────────────
    sourceFetch: {
      async fetchSource({ sourceId, url }): Promise<FetchedOfficialSource> {
        const res = await deps.fetchBytes({
          url,
          allowedContentTypePrefixes: SOURCE_CONTENT_TYPES[sourceId],
          headers: exchangeRequestHeaders(url),
        });
        if (!res.ok) throw new OfficialSourceRetrievalError(sourceId, res.reasonCode);

        const body = res.bytes.toString(SOURCE_ENCODING);
        return {
          sourceId,
          url,
          body,
          retrievedAtMs: res.retrievedAtMs,
          // The accepted provenance hash: the parsers compute the same value
          // over the same decoded body, so retrieval evidence and manifest
          // provenance name one artefact rather than two.
          contentHash: sha256Hex(body),
          cacheMode: "LIVE_RETRIEVAL",
        };
      },
    },

    // ── completeness, via the accepted parsers ───────────────────────────
    sourceValidation: {
      validate(source: FetchedOfficialSource, nowMs: number): SourceValidationVerdict {
        try {
          return validateSource(source, nowMs);
        } catch (err) {
          // A parser that throws is a rejected source, never an accepted one.
          return {
            sourceId: source.sourceId,
            accepted: false,
            rowCount: 0,
            rejectionCode: `${PORT_THREW}:${failureLabel(err)}`,
          };
        }
      },
    },

    // ── calendar + latest completed session ──────────────────────────────
    calendar: {
      async buildAndResolveLatestCompletedSession({ nowMs }): Promise<CalendarResolution> {
        const unresolved = (
          reasonCode: string,
          calendarGenerationId: string | null = null,
        ): CalendarResolution => ({
          ok: false,
          reasonCode,
          calendarGenerationId,
          latestCompletedSessionDate: null,
          calendarValidUntilMs: null,
        });
        return guarded(async () => {
          const retrievedAt = new Date(nowMs).toISOString();
          const calendarYear = Number(retrievedAt.slice(0, 4));

          const [nseHoliday, bseHoliday, nseTimings, bseTimings] = await Promise.all([
            retrieveText(NSE_HOLIDAY_MASTER_URL, JSON_CONTENT_TYPES),
            retrieveText(BSE_TRADING_HOLIDAYS_URL, [...SCRIPT_CONTENT_TYPES, ...HTML_CONTENT_TYPES]),
            retrieveText(NSE_MARKET_TIMINGS_URL, [...HTML_CONTENT_TYPES, "text/plain"]),
            retrieveText(BSE_EQUITY_SESSION_TIMINGS_PAGE, [
              ...SCRIPT_CONTENT_TYPES,
              ...HTML_CONTENT_TYPES,
            ]),
          ]);

          for (const [label, r] of [
            ["NSE_HOLIDAY_MASTER", nseHoliday],
            ["BSE_TRADING_HOLIDAYS", bseHoliday],
            ["NSE_MARKET_TIMINGS", nseTimings],
            ["BSE_SESSION_TIMINGS", bseTimings],
          ] as const) {
            if (!r.ok) {
              return unresolved(
                `${REGISTRY_COMPOSITION_REASON.CALENDAR_SOURCE_RETRIEVAL_FAILED}:${label}:${r.reasonCode}`,
              );
            }
          }
          if (!nseHoliday.ok || !bseHoliday.ok || !nseTimings.ok || !bseTimings.ok) {
            return unresolved(REGISTRY_COMPOSITION_REASON.CALENDAR_SOURCE_RETRIEVAL_FAILED);
          }

          const calendar = deps.buildExchangeCalendar({
            sources: [
              deps.parseNseHolidayMaster(nseHoliday.text, { retrievedAt, calendarYear }),
              deps.parseBseTradingHolidayPage(bseHoliday.text, { retrievedAt, calendarYear }),
            ],
            timings: [
              deps.parseNseMarketTimings(nseTimings.text, {
                retrievedAt,
                effectiveYear: calendarYear,
                sourceUrl: NSE_MARKET_TIMINGS_URL,
              }),
              deps.parseBseSessionTimings(bseTimings.text, {
                retrievedAt,
                effectiveYear: calendarYear,
                sourceUrl: BSE_EQUITY_SESSION_TIMINGS_PAGE,
              }),
            ],
            exchanges: ["NSE", "BSE"],
            years: [calendarYear],
            generatedAt: retrievedAt,
          });
          scratch.calendar = calendar;

          if (!calendar.valid) {
            return unresolved(
              REGISTRY_COMPOSITION_REASON.CALENDAR_INVALID,
              calendar.calendarGenerationId,
            );
          }

          // BSE governs: the reference policy reconciles to the latest COMPLETED
          // BSE session, so that is the session the whole refresh is pinned to.
          const latest = deps.getLatestCompletedTradingSession(calendar, "BSE", nowMs);
          if (!latest.ok) {
            return unresolved(
              `${REGISTRY_COMPOSITION_REASON.LATEST_COMPLETED_SESSION_UNKNOWN}:${latest.reason}`,
              calendar.calendarGenerationId,
            );
          }

          const authority = deps.evaluateCalendarAuthorityNow(
            deps.toCalendarCommitment(calendar, nowMs),
            nowMs,
          );
          return {
            ok: true,
            reasonCode: null,
            calendarGenerationId: calendar.calendarGenerationId,
            latestCompletedSessionDate: latest.session.tradingDate,
            calendarValidUntilMs: authority.validUntilMs,
          };
        }, unresolved);
      },
    },

    // ── BSE reference authority (pre-flight) ─────────────────────────────
    bseAuthority: {
      async evaluate({ nowMs, latestCompletedSessionDate }): Promise<BseAuthorityDecision> {
        return guarded(
          async () => bseAuthorityImpl(nowMs, latestCompletedSessionDate),
          (reasonCode) => ({ authorized: false, reasonCode, authorityExpiresAtMs: null }),
        );
      },
    },

    // ── build + manifest ─────────────────────────────────────────────────
    generationBuilder: {
      async buildAndReconcile({ nowMs }): Promise<GenerationBuildOutcome> {
        return guarded(
          async () => buildGenerationImpl(nowMs),
          (reasonCode) => ({
            ok: false,
            reasonCode,
            generation: null,
            unexplainedRemainderByExchange: {},
          }),
        );
      },
    },

    // ── commit (delegated whole) ─────────────────────────────────────────
    persistence: {
      save: (generation) =>
        guarded(
          () => deps.saveRegistryGeneration(generation),
          (reasonCode) => ({
            ok: false as const,
            durablyCommitted: false as const,
            reasonCode,
            detail: "The accepted transactional store threw; nothing was committed.",
          }),
        ),
    },

    // ── cold load ────────────────────────────────────────────────────────
    coldLoadVerifier: {
      async loadAndVerify({ expectedGenerationId }) {
        return guarded(
          async () => coldLoadImpl(expectedGenerationId),
          (reasonCode) => ({ ok: false, reasonCode, loadedGenerationId: null }),
        );
      },
    },

    // ── promotion ────────────────────────────────────────────────────────
    authorityPromotion: {
      async promote({ generationId, nowMs }) {
        return guarded(
          async () => promoteImpl(generationId, nowMs),
          (reasonCode) => ({ promoted: false, reasonCode }),
        );
      },
    },

    audit: {
      record(event): void {
        try {
          logger.info(
            {
              diagnosticEvent: "REGISTRY_REFRESH_OPERATION",
              compositionId: REGISTRY_REFRESH_COMPOSITION_ID,
              stage: event.stage,
              outcome: event.outcome,
              reasonCode: event.reasonCode,
              atMs: event.atMs,
            },
            "Authoritative registry refresh",
          );
        } catch {
          // An audit sink must never be able to fail the operation it observes.
        }
      },
    },
  };

  // ── port implementations ─────────────────────────────────────────────────
  // Kept as named functions so each is wrapped by exactly one guard above.

  function validateSource(source: FetchedOfficialSource, nowMs: number): SourceValidationVerdict {
        const retrievedAt = new Date(source.retrievedAtMs).toISOString();
        let provenance: OfficialSourceProvenance;

        switch (source.sourceId) {
          case "NSE_EQUITY_L": {
            const p = parseNseEquityCsv(source.body, "NSE_EQUITY_L", retrievedAt, nowMs);
            scratch.nseMain = p;
            provenance = p.provenance;
            break;
          }
          case "NSE_SME_EQUITY_L": {
            const p = parseNseEquityCsv(source.body, "NSE_SME_EQUITY_L", retrievedAt, nowMs);
            scratch.nseSme = p;
            provenance = p.provenance;
            break;
          }
          case "NSE_ETF_LIST": {
            const p = parseNseEtfCsv(source.body, retrievedAt, nowMs);
            scratch.nseEtf = p;
            provenance = p.provenance;
            break;
          }
          case "BSE_LIST_OF_SCRIPS_ACTIVE": {
            const p = parseBseListOfScrips(
              source.body,
              "BSE_LIST_OF_SCRIPS_ACTIVE",
              retrievedAt,
              nowMs,
            );
            scratch.bseActive = p;
            provenance = p.provenance;
            break;
          }
          case "BSE_LIST_OF_SCRIPS_SUSPENDED": {
            const p = parseBseListOfScrips(
              source.body,
              "BSE_LIST_OF_SCRIPS_SUSPENDED",
              retrievedAt,
              nowMs,
            );
            scratch.bseSuspended = p;
            provenance = p.provenance;
            break;
          }
          case "KITE_INSTRUMENT_MASTER": {
            const p = parseKiteInstrumentCsv(source.body, retrievedAt, nowMs);
            scratch.kite = p;
            provenance = p.provenance;
            break;
          }
          default:
            return {
              sourceId: source.sourceId,
              accepted: false,
              rowCount: 0,
              rejectionCode: "UNKNOWN_SOURCE_ID",
            };
        }

        const accepted = isSourceAccepted(provenance);
        return {
          sourceId: source.sourceId,
          accepted,
          rowCount: provenance.rowCount,
          rejectionCode: accepted ? null : provenance.validationResult,
        };
  }

  async function bseAuthorityImpl(
    nowMs: number,
    latestCompletedSessionDate: string,
  ): Promise<BseAuthorityDecision> {
        const calendar = scratch.calendar;
        if (calendar === null) {
          return {
            authorized: false,
            reasonCode: REGISTRY_COMPOSITION_REASON.CALENDAR_NOT_RESOLVED,
            authorityExpiresAtMs: null,
          };
        }

        const listProvenance = provenanceOf(scratch, "BSE_LIST_OF_SCRIPS_ACTIVE");
        const list: BseListRetrieval =
          listProvenance !== null
            ? {
                outcome: "RETRIEVED",
                retrievedAtMs: Date.parse(listProvenance.retrievedAt),
                validationResult: listProvenance.validationResult,
                contentHash: listProvenance.contentHash,
              }
            : { outcome: "RETRIEVAL_FAILED", failureReason: "BSE_LIST_NOT_RETRIEVED" };
        scratch.bseList = list;

        // The UDiFF is selected BY the computed session date, never the other
        // way round. Picking a recent file and then asking which session it
        // belongs to would quietly reconcile to a stale session.
        const udiffUrl = bseUdiffUrlFor(latestCompletedSessionDate);
        const retrieved = await retrieveText(udiffUrl, CSV_CONTENT_TYPES);
        if (!retrieved.ok) {
          return {
            authorized: false,
            reasonCode: `${REGISTRY_COMPOSITION_REASON.UDIFF_RETRIEVAL_FAILED}:${retrieved.reasonCode}`,
            authorityExpiresAtMs: null,
          };
        }

        const parsed = deps.parseBseUdiff(retrieved.text, {
          retrievedAtMs: nowMs,
          fileVariant: "F",
          sourceUrl: udiffUrl,
        });
        const sessionCheck = deps.validateBhavcopySession(
          calendar,
          "BSE",
          parsed.descriptor.tradingDate,
          nowMs,
        );
        if (!sessionCheck.ok) {
          return {
            authorized: false,
            reasonCode: `${REGISTRY_COMPOSITION_REASON.UDIFF_SESSION_MISMATCH}:${sessionCheck.code}`,
            authorityExpiresAtMs: null,
          };
        }
        scratch.udiff = parsed.descriptor;

        const prior = await getPrior();

        // PRE-FLIGHT ONLY. `reconciliationClosed` cannot be known before the
        // build, so it is assumed here purely to decide whether the build is
        // worth attempting. The authority object that actually reaches the
        // manifest is re-evaluated in the builder with the real reconciliation
        // outcome, and `saveRegistryGeneration` refuses anything not ACCEPTED —
        // so this optimistic input can never grant authority on its own.
        const preflight = deps.evaluateBseReferenceAuthority({
          nowMs,
          list,
          udiff: parsed.descriptor,
          calendar: deps.toTradingCalendarVerdict(calendar, "BSE", nowMs),
          hasPriorAcceptedGeneration: prior !== null,
          reconciliationClosed: true,
        });

        return {
          authorized: preflight.mayAuthorizeNewGeneration,
          reasonCode: preflight.mayAuthorizeNewGeneration ? null : preflight.state,
          // BSE current-day list authority lapses at the next IST midnight,
          // the same boundary the stored-authority evaluation uses.
          authorityExpiresAtMs: nextIstMidnightMs(nowMs),
        };
  }

  async function buildGenerationImpl(nowMs: number): Promise<GenerationBuildOutcome> {
        const { nseMain, nseSme, nseEtf, bseActive, bseSuspended, kite, calendar } = scratch;
        if (
          nseMain === null ||
          nseSme === null ||
          nseEtf === null ||
          bseActive === null ||
          bseSuspended === null ||
          kite === null ||
          calendar === null
        ) {
          return {
            ok: false,
            reasonCode: REGISTRY_COMPOSITION_REASON.PARSED_SOURCES_INCOMPLETE,
            generation: null,
            unexplainedRemainderByExchange: {},
          };
        }

        const generatedAt = new Date(nowMs).toISOString();
        const effectiveDate = generatedAt.slice(0, 10);
        const sources: OfficialSourceProvenance[] = [
          nseMain.provenance,
          nseSme.provenance,
          nseEtf.provenance,
          bseActive.provenance,
          bseSuspended.provenance,
          kite.provenance,
        ];

        // Content-derived identity, including schema and policy: the same bytes
        // read under a different classification policy describe a DIFFERENT
        // universe and must not collide with the older row.
        const registryGenerationId =
          REGISTRY_GENERATION_ID_PREFIX +
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

        // Carry instrument history forward on the stable official identity, not
        // the canonical id: the canonical id embeds the trading symbol, so a
        // rename would reset every affected instrument's first-seen date.
        const prior = await getPrior();
        const priorFirstSeen = new Map<string, string>();
        if (prior !== null) {
          for (const r of prior.records) {
            priorFirstSeen.set(r.authoritativeSecurityId, r.firstSeenAt ?? prior.manifest.generatedAt);
          }
        }

        const built = deps.buildRegistry({
          nseMain: nseMain.rows,
          nseSme: nseSme.rows,
          nseEtf: nseEtf.rows,
          bseActive: bseActive.rows,
          bseSuspended: bseSuspended.rows,
          kite: kite.rows,
          registryGenerationId,
          effectiveDate,
          generatedAt,
          priorFirstSeen,
        });

        const unexplainedRemainderByExchange = Object.freeze({
          NSE: built.nse.remainder,
          BSE: built.bse.remainder,
        });

        if (!built.ok) {
          return {
            ok: false,
            reasonCode: REGISTRY_COMPOSITION_REASON.RECONCILIATION_FAILED,
            generation: null,
            unexplainedRemainderByExchange,
          };
        }

        // The binding evaluation: same accepted function, now with the real
        // reconciliation outcome instead of the pre-flight assumption.
        const bseAuthority = deps.evaluateBseReferenceAuthority({
          nowMs,
          list: scratch.bseList ?? {
            outcome: "RETRIEVAL_FAILED",
            failureReason: "BSE_LIST_NOT_RETRIEVED",
          },
          udiff: scratch.udiff,
          calendar: deps.toTradingCalendarVerdict(calendar, "BSE", nowMs),
          hasPriorAcceptedGeneration: prior !== null,
          reconciliationClosed: built.nse.ok && built.bse.ok,
        });

        const manifest = deps.buildUniverseManifest({
          build: built,
          sources,
          manifestVersion: 1,
          registryGenerationId,
          generatedAt,
          effectiveDate,
          requiredSourceIds: REQUIRED_SOURCE_IDS,
          bseAuthority,
          tradingCalendar: deps.toCalendarCommitment(calendar, nowMs),
        });

        if (manifest.acceptanceStatus !== "ACCEPTED") {
          return {
            ok: false,
            reasonCode: `${REGISTRY_COMPOSITION_REASON.MANIFEST_REJECTED}:${manifest.acceptanceStatus}`,
            generation: null,
            unexplainedRemainderByExchange,
          };
        }

        return {
          ok: true,
          reasonCode: null,
          generation: { manifest, records: [...built.records, ...built.indexRecords] },
          unexplainedRemainderByExchange,
        };
  }

  async function coldLoadImpl(expectedGenerationId: string): Promise<ColdLoadVerification> {
        // Integrity re-verification is NOT re-implemented here:
        // `loadLatestAcceptedGeneration` re-reads from durable storage and runs
        // the accepted `evaluateLoadedGeneration` gate internally. This step
        // only confirms that what came back is the generation just committed.
        const loaded = await deps.loadLatestAcceptedGeneration(
          "PHASE_0_8D_REFRESH_COLD_LOAD_VERIFICATION",
        );
        if (loaded === null) {
          return {
            ok: false,
            reasonCode: REGISTRY_COMPOSITION_REASON.COLD_LOAD_NULL,
            loadedGenerationId: null,
          };
        }
        const loadedGenerationId = loaded.manifest.registryGenerationId;
        if (loadedGenerationId !== expectedGenerationId) {
          return {
            ok: false,
            reasonCode: REGISTRY_COMPOSITION_REASON.COLD_LOAD_MISMATCH,
            loadedGenerationId,
          };
        }
        return { ok: true, reasonCode: null, loadedGenerationId };
  }

  async function promoteImpl(
    generationId: string,
    nowMs: number,
  ): Promise<{ readonly promoted: boolean; readonly reasonCode: string | null }> {
        const active = deps.getActiveGeneration();
        if (active === null || active.manifest.registryGenerationId !== generationId) {
          return { promoted: false, reasonCode: REGISTRY_COMPOSITION_REASON.NOT_ACTIVE };
        }
        // Being the active generation is not the same as being allowed to serve
        // as coverage authority. The coverage bridge re-applies the full gate
        // set — checksum, record-set hash, calendar and BSE authority as of NOW.
        const coverage = deps.toAuthoritativeCoverageManifest(active, nowMs);
        if (coverage.coverageAuthority !== "AUTHORITATIVE_RECONCILED_UNIVERSE") {
          return {
            promoted: false,
            reasonCode: `${REGISTRY_COMPOSITION_REASON.COVERAGE_NOT_AUTHORITATIVE}:${coverage.coverageAuthority}`,
          };
        }
        return { promoted: true, reasonCode: null };
  }
}

/**
 * Next 00:00 IST strictly after `nowMs`.
 *
 * This is a calendar-DAY boundary, not a trading-hours constant: BSE's
 * current-day List of Scrips stops being current-day at IST midnight
 * regardless of session times, which remain per-exchange source material.
 */
export function nextIstMidnightMs(nowMs: number): number {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const istNow = nowMs + IST_OFFSET_MS;
  const dayMs = 24 * 60 * 60 * 1000;
  const nextIstDayStart = (Math.floor(istNow / dayMs) + 1) * dayMs;
  return nextIstDayStart - IST_OFFSET_MS;
}

// ── factories ────────────────────────────────────────────────────────────────

/**
 * The production entry point. Takes no arguments ON PURPOSE — an override
 * parameter would be a supported way to swap the authorization-bearing
 * orchestrator or the persistence port in a running deployment.
 */
export function createProductionRegistryRefreshService(): RegistryRefreshService {
  return createRegistryRefreshService(
    buildProductionRegistryRefreshPorts(PRODUCTION_REGISTRY_REFRESH_DEPS),
  );
}

/*
 * There is deliberately NO authorized factory in this module.
 *
 * `buildProductionRegistryRefreshPorts` is exported so a test can wire the real
 * ports over fake deps and hand them to the orchestrator's own test-only
 * authorized factory. Keeping that last step in the test file means no
 * production module — not even behind a `__TEST_ONLY_` name — holds a reference
 * to an authorization bypass.
 */

// ── readiness (pure) ─────────────────────────────────────────────────────────

export interface RegistryRefreshCompositionReadiness {
  readonly compositionId: string;
  readonly state: "DISABLED" | "READY";
  readonly governingLockId: string;
  readonly authorized: boolean;
  readonly requiredSourceIds: readonly OfficialSourceId[];
  readonly approvedHosts: readonly string[];
  readonly retrievalTimeoutMs: number;
  readonly retrievalMaxBytes: number;
  readonly executionRouteExposed: false;
  readonly schedulerRegistered: false;
  readonly blockers: readonly string[];
}

/** Pure description. Describing an operation must never be a way to start it. */
export function describeProductionRegistryRefreshReadiness(): RegistryRefreshCompositionReadiness {
  return Object.freeze({
    compositionId: REGISTRY_REFRESH_COMPOSITION_ID,
    state: AUTHORITATIVE_REGISTRY_REFRESH_AUTHORIZED ? "READY" : "DISABLED",
    governingLockId: REGISTRY_REFRESH_AUTHORIZATION_ID,
    authorized: AUTHORITATIVE_REGISTRY_REFRESH_AUTHORIZED,
    requiredSourceIds: REQUIRED_REFRESH_SOURCE_IDS,
    approvedHosts: APPROVED_SOURCE_HOSTS,
    retrievalTimeoutMs: RETRIEVAL_TIMEOUT_MS,
    retrievalMaxBytes: RETRIEVAL_MAX_BYTES,
    executionRouteExposed: false,
    schedulerRegistered: false,
    blockers: AUTHORITATIVE_REGISTRY_REFRESH_AUTHORIZED
      ? Object.freeze([])
      : Object.freeze(["AUTHORITATIVE_REGISTRY_REFRESH_NOT_AUTHORIZED"]),
  });
}

/** Re-exported so callers never hand-write the approved URL set. */
export const REGISTRY_REFRESH_SOURCE_URLS = SOURCE_URLS;
