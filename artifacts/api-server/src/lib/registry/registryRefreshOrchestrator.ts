/**
 * AUTHORITATIVE REGISTRY REFRESH ORCHESTRATOR — PHASE 0.8D
 *
 * Phase 0.6/0.6A built every piece needed to produce a new instrument universe
 * generation — parsers, calendar, BSE authority policy, Schema-5 builder,
 * reconciliation, the transactional store, the cold-load verifier and the
 * coverage bridge — and wired them together only inside offline evidence
 * scripts. There has never been a production path that runs them in order.
 *
 * This module is that path, and ONLY that path. It contributes no new domain
 * logic: every gate below delegates to an already-accepted contract through an
 * injected port. What it owns is ORDER, and order is the whole point. The same
 * eight components run in the wrong sequence would happily commit a generation
 * built from a truncated download, promote a universe that was never verified
 * from cold storage, or prune retained history in favour of a duplicate.
 *
 * IT IS DISABLED. `AUTHORITATIVE_REGISTRY_REFRESH_AUTHORIZED` is false, so a
 * call refuses at gate 1 before a single source is fetched. Nothing here has
 * ever contacted NSE, BSE or Kite, and nothing has ever written to the
 * database.
 *
 * THE ORDERING RULES THAT ARE EASY TO GET WRONG
 *
 *  - Validation precedes classification. A bot-block HTML page parses to zero
 *    rows perfectly happily; if classification runs first, the universe simply
 *    shrinks and every gate downstream is measuring a fiction.
 *  - Authority expiry is re-asked at COMMIT time against a freshly read clock,
 *    not carried forward from the start of the run. A refresh that begins at
 *    23:58 IST and finishes at 00:02 IST has crossed the BSE current-day
 *    boundary mid-flight, and the authority it validated at the start no longer
 *    exists. Reusing the opening timestamp would let a run authorize itself
 *    with a clock reading it knows is stale.
 *  - Promotion happens after cold-load verification, never after commit. A
 *    successful INSERT proves bytes reached a table; it does not prove those
 *    bytes read back as a coherent generation. Promoting on commit means the
 *    first time anyone discovers otherwise is the next restart.
 *  - A duplicate is a SUCCESS, not a failure, and it promotes nothing and
 *    prunes nothing. Re-running an identical refresh must be a no-op, which is
 *    what makes this operation safe to retry.
 */

import type { OfficialSourceId } from "./officialSources";
import { SOURCE_URLS } from "./officialSources";
import type { RegistryGeneration, RegistryPersistenceResult } from "./manifestStore";
import {
  AUTHORITATIVE_REGISTRY_REFRESH_AUTHORIZED,
  REGISTRY_REFRESH_AUTHORIZATION_ID,
} from "./registryRefreshControl";
import { SingleFlightGuard } from "../operationalSingleFlight";
import { redactForOwnerDiagnostics } from "../safeDiagnosticRedaction";
import type { CalendarSubBlocker } from "./calendarBlockerContract";
import { formatSubBlockers } from "./calendarBlockerContract";

/**
 * Every source a complete generation requires. A refresh is all-or-nothing:
 * there is no partial universe, because reconciliation is an equation over the
 * whole set and a missing source silently changes the denominator.
 */
export const REQUIRED_REFRESH_SOURCE_IDS = Object.freeze([
  "NSE_EQUITY_L",
  "NSE_SME_EQUITY_L",
  "NSE_ETF_LIST",
  "BSE_LIST_OF_SCRIPS_ACTIVE",
  "BSE_LIST_OF_SCRIPS_SUSPENDED",
  "KITE_INSTRUMENT_MASTER",
]) as readonly OfficialSourceId[];

// ── ports ────────────────────────────────────────────────────────────────────

export interface RefreshClockPort {
  nowMs(): number;
}

export type SourceCacheMode = "LIVE_RETRIEVAL" | "OWNER_APPROVED_CACHE";

/**
 * A retrieved source, carrying the identity that must survive into provenance.
 *
 * `contentHash` is computed by the fetching adapter over the RAW body before
 * any parsing, so the hash names the bytes the exchange actually served.
 */
export interface FetchedOfficialSource {
  readonly sourceId: OfficialSourceId;
  readonly url: string;
  readonly body: string;
  readonly retrievedAtMs: number;
  readonly contentHash: string;
  readonly cacheMode: SourceCacheMode;
}

export interface OfficialSourceFetchPort {
  fetchSource(request: {
    readonly sourceId: OfficialSourceId;
    readonly url: string;
  }): Promise<FetchedOfficialSource>;
}

export interface SourceValidationVerdict {
  readonly sourceId: OfficialSourceId;
  readonly accepted: boolean;
  readonly rowCount: number;
  /** Populated only when rejected: TRUNCATED, BOT_BLOCKED, BELOW_ROW_FLOOR, ... */
  readonly rejectionCode: string | null;
}

export interface SourceValidationPort {
  /** Completeness, truncation and bot-block detection. Runs before classification. */
  validate(source: FetchedOfficialSource, nowMs: number): SourceValidationVerdict;
}

export interface CalendarResolution {
  readonly ok: boolean;
  readonly reasonCode: string | null;
  readonly calendarGenerationId: string | null;
  /** YYYY-MM-DD of the latest COMPLETED trading session. */
  readonly latestCompletedSessionDate: string | null;
  /** When this calendar stops speaking for the present. */
  readonly calendarValidUntilMs: number | null;
  /**
   * PHASE 0.8E — every specific reason the calendar failed, not just the first.
   *
   * A run can fail on several sources at once for unrelated reasons. Reporting
   * one and discarding the rest turns a diagnosable outage into a sequence of
   * guesses, so the whole bounded, coded list is carried up.
   */
  readonly subBlockers: readonly CalendarSubBlocker[];
}

export interface ExchangeCalendarPort {
  buildAndResolveLatestCompletedSession(input: {
    readonly nowMs: number;
  }): Promise<CalendarResolution>;
}

export interface BseAuthorityDecision {
  readonly authorized: boolean;
  readonly reasonCode: string | null;
  /** IST-midnight boundary after which the current-day list is no longer authoritative. */
  readonly authorityExpiresAtMs: number | null;
}

export interface BseAuthorityPort {
  evaluate(input: {
    readonly nowMs: number;
    readonly latestCompletedSessionDate: string;
  }): Promise<BseAuthorityDecision>;
}

export interface GenerationBuildOutcome {
  readonly ok: boolean;
  readonly reasonCode: string | null;
  readonly generation: RegistryGeneration | null;
  /** Per-exchange unexplained remainder from the accepted reconciliation equation. */
  readonly unexplainedRemainderByExchange: Readonly<Record<string, number>>;
}

export interface GenerationBuilderPort {
  buildAndReconcile(input: {
    readonly sources: readonly FetchedOfficialSource[];
    readonly latestCompletedSessionDate: string;
    readonly nowMs: number;
  }): Promise<GenerationBuildOutcome>;
}

export interface GenerationPersistencePort {
  /** MUST be the accepted transactional store. No other write path is legal. */
  save(generation: RegistryGeneration): Promise<RegistryPersistenceResult>;
}

export interface ColdLoadVerification {
  readonly ok: boolean;
  readonly reasonCode: string | null;
  readonly loadedGenerationId: string | null;
}

export interface ColdLoadVerifierPort {
  /** Re-reads the generation from durable storage and re-verifies it independently. */
  loadAndVerify(input: {
    readonly expectedGenerationId: string;
    readonly nowMs: number;
  }): Promise<ColdLoadVerification>;
}

export interface AuthorityPromotionPort {
  promote(input: {
    readonly generationId: string;
    readonly nowMs: number;
  }): Promise<{ readonly promoted: boolean; readonly reasonCode: string | null }>;
}

export interface RefreshAuditEvent {
  readonly stage: RegistryRefreshStage;
  readonly outcome: RegistryRefreshOutcome;
  readonly reasonCode: string | null;
  readonly atMs: number;
}

export interface RefreshAuditPort {
  record(event: RefreshAuditEvent): void;
}

export interface RegistryRefreshPorts {
  readonly clock: RefreshClockPort;
  readonly sourceFetch: OfficialSourceFetchPort;
  readonly sourceValidation: SourceValidationPort;
  readonly calendar: ExchangeCalendarPort;
  readonly bseAuthority: BseAuthorityPort;
  readonly generationBuilder: GenerationBuilderPort;
  readonly persistence: GenerationPersistencePort;
  readonly coldLoadVerifier: ColdLoadVerifierPort;
  readonly authorityPromotion: AuthorityPromotionPort;
  readonly audit: RefreshAuditPort;
  /**
   * PHASE 0.8E — called once at the START of each actual refresh attempt.
   *
   * A service instance is reusable, so anything scoped to "a run" cannot be
   * scoped to construction. A per-run transport ceiling built at construction
   * time would let a failed first attempt spend the authorized retry's budget
   * and would merge two runs into one evidence ledger.
   *
   * Optional so existing compositions and test fakes remain valid: a
   * composition with nothing run-scoped simply has nothing to reset.
   */
  readonly runLifecycle?: RunLifecyclePort;
}

export interface RunLifecyclePort {
  beginRun(input: { readonly startedAtMs: number }): void;
}

// ── result contract ──────────────────────────────────────────────────────────

export type RegistryRefreshStage =
  | "AUTHORIZATION"
  | "SOURCE_RETRIEVAL"
  | "SOURCE_VALIDATION"
  | "CALENDAR_RESOLUTION"
  | "BSE_AUTHORITY"
  | "GENERATION_BUILD"
  | "RECONCILIATION"
  | "AUTHORITY_EXPIRY"
  | "PERSISTENCE"
  | "COLD_LOAD_VERIFICATION"
  | "AUTHORITY_PROMOTION"
  | "COMPLETE";

export type RegistryRefreshOutcome = "COMMITTED" | "DUPLICATE_NO_OP" | "REFUSED";

export const REGISTRY_REFRESH_REASON = Object.freeze({
  NOT_AUTHORIZED: "AUTHORITATIVE_REGISTRY_REFRESH_NOT_AUTHORIZED",
  FETCH_FAILED: "OFFICIAL_SOURCE_RETRIEVAL_FAILED",
  FETCH_IDENTITY_MISMATCH: "OFFICIAL_SOURCE_IDENTITY_MISMATCH",
  SOURCE_REJECTED: "OFFICIAL_SOURCE_VALIDATION_REJECTED",
  CALENDAR_UNRESOLVED: "EXCHANGE_CALENDAR_UNRESOLVED",
  BSE_AUTHORITY_REFUSED: "BSE_REFERENCE_AUTHORITY_REFUSED",
  BUILD_FAILED: "GENERATION_BUILD_FAILED",
  UNEXPLAINED_REMAINDER: "NON_ZERO_UNEXPLAINED_REMAINDER",
  AUTHORITY_EXPIRED_AT_COMMIT: "REFERENCE_AUTHORITY_EXPIRED_AT_COMMIT",
  PERSISTENCE_FAILED: "DURABLE_PERSISTENCE_FAILED",
  COLD_LOAD_FAILED: "COLD_LOAD_VERIFICATION_FAILED",
  PROMOTION_FAILED: "ACTIVE_AUTHORITY_PROMOTION_FAILED",
  COMMITTED: "GENERATION_COMMITTED_AND_PROMOTED",
  DUPLICATE: "GENERATION_ALREADY_PRESENT_NO_OP",
} as const);

export interface RegistryRefreshResult {
  readonly ok: boolean;
  readonly outcome: RegistryRefreshOutcome;
  readonly stage: RegistryRefreshStage;
  readonly reasonCode: string;
  readonly registryGenerationId: string | null;
  readonly sourcesFetched: number;
  readonly durablyCommitted: boolean;
  readonly promotedToActiveAuthority: boolean;
  readonly coalescedWithInFlight: boolean;
  readonly startedAtMs: number;
  readonly completedAtMs: number;
  /** Coded, secret-free strings only. Never a URL body, credential or raw error. */
  readonly detailsSafeForOwnerDiagnostics: readonly string[];
  /**
   * Specific calendar blockers, retained whenever the run failed on the
   * calendar. Empty for every other stage — never null, so a consumer cannot
   * mistake "this stage has no calendar blockers" for "we did not look".
   */
  readonly calendarSubBlockers: readonly CalendarSubBlocker[];
}

// ── diagnostics state ────────────────────────────────────────────────────────

export type RegistryRefreshRunState = "DISABLED" | "READY" | "RUNNING";

let _lastResult: RegistryRefreshResult | null = null;
const _guard = new SingleFlightGuard<RegistryRefreshResult>();

/** Pure read. Describing the operation must never be a way to start it. */
export function getRegistryRefreshOperationDiagnostics(): {
  readonly state: RegistryRefreshRunState;
  readonly authorized: boolean;
  /**
   * Names the compile-time constant that governs this operation.
   *
   * Called `governingLockId`, not `authorizationId`: the owner readiness
   * payload is scanned for credential-shaped key names, and "authorization"
   * matches that scan. The value here is a lock constant's NAME, never a
   * credential, so the correct repair was to stop using credential vocabulary
   * for a lock rather than to add an exception to the scan — an allowlist
   * entry would have to be re-justified by every future reader, and each one
   * makes the guard a little more decorative.
   */
  readonly governingLockId: string;
  readonly requiredSourceCount: number;
  readonly lastOutcome: RegistryRefreshOutcome | null;
  readonly lastStage: RegistryRefreshStage | null;
  readonly lastReasonCode: string | null;
  readonly lastCompletedAtMs: number | null;
  readonly lastRegistryGenerationId: string | null;
} {
  const running = _guard.state === "RUNNING";
  return Object.freeze({
    state: running ? "RUNNING" : AUTHORITATIVE_REGISTRY_REFRESH_AUTHORIZED ? "READY" : "DISABLED",
    authorized: AUTHORITATIVE_REGISTRY_REFRESH_AUTHORIZED,
    governingLockId: REGISTRY_REFRESH_AUTHORIZATION_ID,
    requiredSourceCount: REQUIRED_REFRESH_SOURCE_IDS.length,
    lastOutcome: _lastResult?.outcome ?? null,
    lastStage: _lastResult?.stage ?? null,
    lastReasonCode: _lastResult?.reasonCode ?? null,
    lastCompletedAtMs: _lastResult?.completedAtMs ?? null,
    lastRegistryGenerationId: _lastResult?.registryGenerationId ?? null,
  });
}

/**
 * Owner refresh diagnostics as a REDACTED, emit-safe payload — Phase 0.8E.
 *
 * The typed `getRegistryRefreshOperationDiagnostics()` above is consumed by
 * callers that need the exact shape, so it is left untouched. This is the
 * boundary an owner-facing serializer should use before emitting: it routes the
 * payload through the structured, key-aware redactor. The diagnostics here are
 * already coded and secret-free by construction; the redactor is defense in
 * depth against a future `detail`/`reasonCode` string that accidentally carries
 * credential-shaped content. `governingLockId` (a lock constant NAME, not a
 * credential) survives because it is not an exact deny-set key.
 */
export function getRegistryRefreshOperationDiagnosticsRedacted(): unknown {
  return redactForOwnerDiagnostics(getRegistryRefreshOperationDiagnostics());
}

/** Test-only. Never called by production code. */
export function __resetRegistryRefreshDiagnosticsForTests(): void {
  _lastResult = null;
  _guard.__resetForTests();
}

// ── the orchestrator ─────────────────────────────────────────────────────────

export interface RegistryRefreshService {
  runRefreshNow(): Promise<RegistryRefreshResult>;
}

function refusal(
  stage: RegistryRefreshStage,
  reasonCode: string,
  startedAtMs: number,
  completedAtMs: number,
  details: readonly string[],
  sourcesFetched = 0,
  calendarSubBlockers: readonly CalendarSubBlocker[] = [],
): RegistryRefreshResult {
  return Object.freeze({
    ok: false,
    outcome: "REFUSED" as const,
    stage,
    reasonCode,
    registryGenerationId: null,
    sourcesFetched,
    durablyCommitted: false,
    promotedToActiveAuthority: false,
    coalescedWithInFlight: false,
    startedAtMs,
    completedAtMs,
    detailsSafeForOwnerDiagnostics: Object.freeze([...details]),
    calendarSubBlockers: Object.freeze([...calendarSubBlockers]),
  });
}

function createService(ports: RegistryRefreshPorts, authorized: boolean): RegistryRefreshService {
  return {
    async runRefreshNow(): Promise<RegistryRefreshResult> {
      // ── STEP 1: AUTHORIZATION — before any port, including the clock ─────
      //
      // A refusal must cost nothing. Fetching six exchange files and then
      // discarding them because the lock is off would still have hit NSE, BSE
      // and Kite, which is exactly the externally-visible effect the lock
      // exists to prevent.
      if (!authorized) {
        const r = refusal(
          "AUTHORIZATION",
          REGISTRY_REFRESH_REASON.NOT_AUTHORIZED,
          0,
          0,
          [`AUTHORIZATION=${REGISTRY_REFRESH_AUTHORIZATION_ID}`, "AUTHORIZED=false", "PORTS_CALLED=0"],
        );
        _lastResult = r;
        return r;
      }

      const startedAtMs = ports.clock.nowMs();

      // ── STEP 2: SINGLE-FLIGHT ────────────────────────────────────────────
      const outcome = await _guard.run(startedAtMs, () => runOnce(ports, startedAtMs));
      const finalResult = outcome.coalesced
        ? Object.freeze({ ...outcome.result, coalescedWithInFlight: true })
        : outcome.result;
      _lastResult = finalResult;
      return finalResult;
    },
  };
}

async function runOnce(
  ports: RegistryRefreshPorts,
  startedAtMs: number,
): Promise<RegistryRefreshResult> {
  // Before ANY port can issue an external request, hand the composition a
  // clean run scope. Placed first so no work can be charged to a stale one.
  ports.runLifecycle?.beginRun({ startedAtMs });

  const emit = (r: RegistryRefreshResult): RegistryRefreshResult => {
    ports.audit.record({
      stage: r.stage,
      outcome: r.outcome,
      reasonCode: r.reasonCode,
      atMs: r.completedAtMs,
    });
    return r;
  };
  const refuse = (
    stage: RegistryRefreshStage,
    reasonCode: string,
    details: readonly string[],
    sourcesFetched = 0,
    calendarSubBlockers: readonly CalendarSubBlocker[] = [],
  ) =>
    emit(
      refusal(
        stage,
        reasonCode,
        startedAtMs,
        ports.clock.nowMs(),
        details,
        sourcesFetched,
        calendarSubBlockers,
      ),
    );

  // ── STEP 3: RETRIEVE EACH REQUIRED SOURCE EXACTLY ONCE ─────────────────
  //
  // Once per source, not once per use. Several downstream steps need the Kite
  // master; fetching it per consumer would produce two different byte streams
  // for one generation and make the provenance hash meaningless.
  const fetched: FetchedOfficialSource[] = [];
  for (const sourceId of REQUIRED_REFRESH_SOURCE_IDS) {
    const url = SOURCE_URLS[sourceId];
    let source: FetchedOfficialSource;
    try {
      source = await ports.sourceFetch.fetchSource({ sourceId, url });
    } catch {
      return refuse(
        "SOURCE_RETRIEVAL",
        REGISTRY_REFRESH_REASON.FETCH_FAILED,
        [`SOURCE=${sourceId}`],
        fetched.length,
      );
    }

    // ── STEP 4: RETAIN SOURCE IDENTITY ────────────────────────────────────
    //
    // The adapter must return the source it was asked for, hashed. A port that
    // silently substitutes a different file (a cached neighbour, a redirect
    // target) would poison provenance while every later gate still passed.
    if (
      source.sourceId !== sourceId ||
      typeof source.contentHash !== "string" ||
      source.contentHash.length === 0 ||
      typeof source.retrievedAtMs !== "number" ||
      !Number.isFinite(source.retrievedAtMs)
    ) {
      return refuse(
        "SOURCE_RETRIEVAL",
        REGISTRY_REFRESH_REASON.FETCH_IDENTITY_MISMATCH,
        [`SOURCE=${sourceId}`],
        fetched.length,
      );
    }
    fetched.push(source);
  }

  // ── STEP 5: VALIDATE COMPLETENESS BEFORE ANY CLASSIFICATION ────────────
  //
  // Truncation and bot-blocks are indistinguishable from a genuinely smaller
  // universe once the rows have been classified, because both produce a
  // perfectly coherent — and wrong — smaller set.
  for (const source of fetched) {
    const verdict = ports.sourceValidation.validate(source, startedAtMs);
    if (!verdict.accepted) {
      return refuse(
        "SOURCE_VALIDATION",
        REGISTRY_REFRESH_REASON.SOURCE_REJECTED,
        [`SOURCE=${source.sourceId}`, `REJECTION=${verdict.rejectionCode ?? "UNSPECIFIED"}`],
        fetched.length,
      );
    }
  }

  // ── STEP 6: CALENDAR + LATEST COMPLETED SESSION ────────────────────────
  const calendar = await ports.calendar.buildAndResolveLatestCompletedSession({ nowMs: startedAtMs });
  if (!calendar.ok || calendar.latestCompletedSessionDate === null) {
    // The top-level reason stays STABLE (`EXCHANGE_CALENDAR_UNRESOLVED`) so
    // every existing consumer and gate keeps working, while the specific,
    // per-source blockers travel alongside it instead of being discarded.
    const subBlockers = calendar.subBlockers ?? [];
    return refuse(
      "CALENDAR_RESOLUTION",
      REGISTRY_REFRESH_REASON.CALENDAR_UNRESOLVED,
      [`CALENDAR=${calendar.reasonCode ?? "UNRESOLVED"}`, ...formatSubBlockers(subBlockers)],
      fetched.length,
      subBlockers,
    );
  }

  // ── STEP 7: BSE REFERENCE AUTHORITY (owner-approved policy) ────────────
  const bse = await ports.bseAuthority.evaluate({
    nowMs: startedAtMs,
    latestCompletedSessionDate: calendar.latestCompletedSessionDate,
  });
  if (!bse.authorized) {
    return refuse(
      "BSE_AUTHORITY",
      REGISTRY_REFRESH_REASON.BSE_AUTHORITY_REFUSED,
      [`BSE_AUTHORITY=${bse.reasonCode ?? "REFUSED"}`],
      fetched.length,
    );
  }

  // ── STEP 8: BUILD + RECONCILE THE SCHEMA-5 GENERATION ──────────────────
  const built = await ports.generationBuilder.buildAndReconcile({
    sources: fetched,
    latestCompletedSessionDate: calendar.latestCompletedSessionDate,
    nowMs: startedAtMs,
  });
  if (!built.ok || built.generation === null) {
    return refuse(
      "GENERATION_BUILD",
      REGISTRY_REFRESH_REASON.BUILD_FAILED,
      [`BUILD=${built.reasonCode ?? "FAILED"}`],
      fetched.length,
    );
  }

  // ── STEP 9: ZERO UNEXPLAINED REMAINDER, PER EXCHANGE ───────────────────
  //
  // Checked here rather than trusted from `built.ok`, because "the build
  // succeeded" and "every official row is accounted for" are different claims
  // and only the second one licenses a commit.
  const remainders = Object.entries(built.unexplainedRemainderByExchange).filter(
    ([, n]) => !Number.isFinite(n) || n !== 0,
  );
  if (remainders.length > 0) {
    return refuse(
      "RECONCILIATION",
      REGISTRY_REFRESH_REASON.UNEXPLAINED_REMAINDER,
      remainders.map(([exchange, n]) => `REMAINDER_${exchange}=${String(n)}`),
      fetched.length,
    );
  }

  const generationId = built.generation.manifest.registryGenerationId;

  // ── STEP 10: RE-ASK AUTHORITY EXPIRY AT COMMIT TIME ────────────────────
  //
  // A FRESH clock reading. The run may have crossed the IST-midnight BSE
  // boundary or the calendar's validity edge while fetching and building. The
  // opening timestamp is known to be old by now, and authorizing a commit with
  // it would be self-certification against a clock we already distrust.
  const commitNowMs = ports.clock.nowMs();
  const expiredDetails: string[] = [];
  if (bse.authorityExpiresAtMs !== null && commitNowMs >= bse.authorityExpiresAtMs) {
    expiredDetails.push("EXPIRED=BSE_REFERENCE_AUTHORITY");
  }
  if (calendar.calendarValidUntilMs !== null && commitNowMs >= calendar.calendarValidUntilMs) {
    expiredDetails.push("EXPIRED=EXCHANGE_CALENDAR");
  }
  if (expiredDetails.length > 0) {
    return refuse(
      "AUTHORITY_EXPIRY",
      REGISTRY_REFRESH_REASON.AUTHORITY_EXPIRED_AT_COMMIT,
      expiredDetails,
      fetched.length,
    );
  }

  // ── STEP 11: PERSIST VIA THE ACCEPTED TRANSACTIONAL STORE ──────────────
  //
  // The store owns pre-commit gates, the advisory lock, ON CONFLICT DO NOTHING
  // and insert-paid retention. None of that is re-implemented here; duplicating
  // those gates outside the transaction would be fail-open, because the copy
  // would run against a different snapshot than the write.
  const persisted = await ports.persistence.save(built.generation);

  // ── STEP 12: DISTINGUISH A REAL INSERT FROM A DUPLICATE NO-OP ──────────
  if (!persisted.ok) {
    return refuse(
      "PERSISTENCE",
      REGISTRY_REFRESH_REASON.PERSISTENCE_FAILED,
      [`PERSISTENCE=${persisted.reasonCode}`],
      fetched.length,
    );
  }

  if (!persisted.durablyCommitted) {
    // ── STEP 13: RETENTION IS NOT PAID FOR BY A DUPLICATE ────────────────
    //
    // Enforced by the store inside the transaction, which returns before its
    // DELETE when ON CONFLICT suppressed the insert. This branch therefore
    // prunes nothing and promotes nothing: an identical re-run changes no
    // state at all, which is what makes the operation safely idempotent.
    const r = Object.freeze({
      ok: true,
      outcome: "DUPLICATE_NO_OP" as const,
      stage: "COMPLETE" as const,
      reasonCode: REGISTRY_REFRESH_REASON.DUPLICATE,
      registryGenerationId: generationId,
      sourcesFetched: fetched.length,
      durablyCommitted: false,
      promotedToActiveAuthority: false,
      coalescedWithInFlight: false,
      startedAtMs,
      completedAtMs: ports.clock.nowMs(),
      detailsSafeForOwnerDiagnostics: Object.freeze([
        `SKIPPED=${persisted.skippedReason}`,
        "RETENTION_APPLIED=false",
      ]),
      calendarSubBlockers: Object.freeze([]),
    });
    return emit(r);
  }

  // ── STEP 14: COLD-LOAD AND INDEPENDENTLY VERIFY ────────────────────────
  //
  // A committed INSERT proves bytes reached a table. It does not prove they
  // read back as a coherent generation with matching checksums and hashes.
  const verification = await ports.coldLoadVerifier.loadAndVerify({
    expectedGenerationId: generationId,
    nowMs: commitNowMs,
  });
  if (!verification.ok || verification.loadedGenerationId !== generationId) {
    // The row stays: it is committed history and deleting it here would be an
    // untransacted repair. What we refuse to do is PROMOTE it, so the previous
    // active authority continues to serve.
    return refuse(
      "COLD_LOAD_VERIFICATION",
      REGISTRY_REFRESH_REASON.COLD_LOAD_FAILED,
      [
        `VERIFICATION=${verification.reasonCode ?? "FAILED"}`,
        "COMMITTED=true",
        "PROMOTED=false",
      ],
      fetched.length,
    );
  }

  // ── STEP 15: PROMOTE ACTIVE AUTHORITY — ONLY NOW ───────────────────────
  const promotion = await ports.authorityPromotion.promote({
    generationId,
    nowMs: commitNowMs,
  });
  if (!promotion.promoted) {
    return refuse(
      "AUTHORITY_PROMOTION",
      REGISTRY_REFRESH_REASON.PROMOTION_FAILED,
      [`PROMOTION=${promotion.reasonCode ?? "REFUSED"}`, "COMMITTED=true", "PROMOTED=false"],
      fetched.length,
    );
  }

  // ── STEP 16: RETURN A SAFE, STRUCTURED RESULT ──────────────────────────
  return emit(
    Object.freeze({
      ok: true,
      outcome: "COMMITTED" as const,
      stage: "COMPLETE" as const,
      reasonCode: REGISTRY_REFRESH_REASON.COMMITTED,
      registryGenerationId: generationId,
      sourcesFetched: fetched.length,
      durablyCommitted: true,
      promotedToActiveAuthority: true,
      coalescedWithInFlight: false,
      startedAtMs,
      completedAtMs: ports.clock.nowMs(),
      detailsSafeForOwnerDiagnostics: Object.freeze([
        `SNAPSHOT=${persisted.snapshotId}`,
        "RETENTION_APPLIED=true",
        "COLD_LOAD_VERIFIED=true",
      ]),
      calendarSubBlockers: Object.freeze([]),
    }),
  );
}

/**
 * The production service. Reads the compile-time authorization, which is false,
 * so this refuses at step 1 without calling a single port.
 */
export function createRegistryRefreshService(
  ports: RegistryRefreshPorts,
): RegistryRefreshService {
  return createService(ports, AUTHORITATIVE_REGISTRY_REFRESH_AUTHORIZED);
}

/**
 * TEST-ONLY authorization override. Zero production callers — asserted by
 * `p08d.guards.test.ts`, which greps the source tree rather than trusting this
 * comment. Without it, steps 2-16 would be permanently unreachable and
 * therefore untested.
 */
export function __TEST_ONLY_createAuthorizedRegistryRefreshService(
  ports: RegistryRefreshPorts,
): RegistryRefreshService {
  return createService(ports, true);
}
