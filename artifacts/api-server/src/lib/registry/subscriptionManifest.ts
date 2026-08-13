/**
 * PHASE 0.8A — AUTHORITATIVE SUBSCRIPTION ADMISSION MANIFEST
 *
 * The deterministic, fail-closed answer to one question: *which instruments
 * would a live feed be allowed to subscribe to, and is it allowed to act on
 * that answer right now?*
 *
 * This module opens no socket, contacts no provider, touches no database and
 * reads no clock of its own. It is a pure function of (registry generation,
 * instant). Phase 0.8A is admission ONLY: nothing here subscribes, and the
 * manifest deliberately reports `activationAuthorized: false` in every case
 * where the universe cannot speak for the present instant.
 *
 * TWO OUTPUTS, NEVER CONFLATED
 * ----------------------------
 *   CANDIDATE_LAST_KNOWN  — the stored generation is intact and completely
 *                           classified, but its authority has expired. It is
 *                           usable for inspection and planning; it may NOT
 *                           authorize activation.
 *   ACTIVATABLE_CURRENT   — every integrity gate AND every current-authority
 *                           gate passes at the supplied instant.
 *
 * An intact 12-Aug generation read on 13-Aug is a CANDIDATE. That is the whole
 * point: "the bytes are fine" and "this describes today" are different facts,
 * and only the second one may open a feed.
 *
 * FAIL-CLOSED
 * -----------
 * Anything structurally wrong — an unknown schema, a broken checksum, a record
 * set that does not match its commitment, a non-zero classification remainder,
 * a duplicate provider token, an unqualified exchange — yields
 * `AUTHORITATIVE_SUBSCRIPTION_MANIFEST_INVALID` and NO admitted set. A partial
 * subscription set is never emitted: subscribing to "most of" a universe while
 * reporting success is exactly the silent-understatement failure the coverage
 * contract exists to prevent.
 */

import { createHash } from "node:crypto";
import type { RegistryRecord } from "./instrumentRegistry";
import {
  CLASSIFICATION_POLICY_VERSION,
  MANIFEST_SCHEMA_VERSION,
  computeClassificationPolicyHash,
  computeEligibleLiveSetHash,
  computeRecordSetHash,
  isManifestAccepted,
  verifyManifestChecksum,
} from "./universeManifest";
import { verifyCalendarCommitmentIntegrity } from "./exchangeCalendar";
import {
  MIN_RECORDS_FOR_COMMIT,
  evaluateRegistryAuthorityNow,
  getSettledActiveGeneration,
  isRegistryRestorationSettled,
  type RegistryGeneration,
} from "./manifestStore";

/**
 * Version of the ADMISSION policy expressed by this file — the classification
 * precedence, the token invariants and the equation below. Bump it whenever any
 * of those change, because a shard plan hashed under one policy must never be
 * mistaken for the same plan under another.
 */
export const SUBSCRIPTION_POLICY_VERSION = 1;

/** The blocker string the phase directive reserves for a structurally invalid manifest. */
export const SUBSCRIPTION_MANIFEST_INVALID_BLOCKER =
  "PHASE_0_8A_BLOCKED — AUTHORITATIVE_SUBSCRIPTION_MANIFEST_INVALID";

// ───────────────────────────────────────────────────────────────────────────
// SECTION F — CLASSIFICATION
// ───────────────────────────────────────────────────────────────────────────

/**
 * Eight mutually exclusive, collectively exhaustive buckets. Every registry
 * record lands in exactly one; the remainder is zero BY CONSTRUCTION (the
 * classifier is total) and is asserted anyway, because a silent remainder is
 * how a denominator shrinks without anyone noticing.
 */
export type SubscriptionClassification =
  /** LIVE_REQUIRED and mapped to a valid, exchange-qualified provider token. */
  | "LIVE_MAPPED"
  /** LIVE_REQUIRED but no usable provider token. Required, therefore uncovered. */
  | "LIVE_UNMAPPED"
  /** Reference/periodic tier — never eligible for a live socket slot. */
  | "SNAPSHOT_ONLY"
  /** Officially not a stock (debt, G-sec, SGB, fund/ETF, preference, RE). */
  | "EXCLUDED"
  /** No canonical instrument identity could be minted; cannot be named or keyed. */
  | "IDENTITY_INVALID"
  /** Provider mapping was ambiguous or two identities claimed one token. */
  | "PROVIDER_TOKEN_CONFLICT"
  /** Official evidence does not determine a supported security class. */
  | "UNSUPPORTED_SECURITY_CLASS"
  /** The exchange does not currently list it as active (suspended/delisted/unknown). */
  | "LISTING_NOT_ACTIVE";

export const ALL_SUBSCRIPTION_CLASSIFICATIONS: readonly SubscriptionClassification[] = [
  "LIVE_MAPPED",
  "LIVE_UNMAPPED",
  "SNAPSHOT_ONLY",
  "EXCLUDED",
  "IDENTITY_INVALID",
  "PROVIDER_TOKEN_CONFLICT",
  "UNSUPPORTED_SECURITY_CLASS",
  "LISTING_NOT_ACTIVE",
] as const;

export type ClassificationCounts = Readonly<Record<SubscriptionClassification, number>>;

/** A provider token is usable only as a positive, exactly representable integer. */
export function isUsableProviderToken(token: unknown): token is number {
  return typeof token === "number" && Number.isSafeInteger(token) && token > 0;
}

/**
 * Is this record's provider mapping exchange-qualified?
 *
 * A bare token is not an identity. The same numeric token space is reused
 * across provider exchanges, so a mapping that does not name the exchange it
 * came from — or names a different one than the record's own exchange — cannot
 * be trusted to point at this instrument.
 */
export function isExchangeQualifiedMapping(r: RegistryRecord): boolean {
  return typeof r.kiteExchange === "string" && r.kiteExchange.trim().toUpperCase() === r.exchange;
}

/**
 * TOTAL classifier. Precedence is fixed and deliberate:
 *
 *   1. identity     — a record we cannot name cannot be reasoned about at all
 *   2. conflict     — a disputed token must never be silently downgraded into a
 *                     benign bucket; it is a reconciliation defect, not a tier
 *   3. class        — "we do not know what this security is" outranks any
 *                     downstream judgement about it
 *   4. excluded     — an official non-stock class, independent of listing state
 *   5. listing      — not currently active; also the defensive catch for a
 *                     LIVE_REQUIRED row that should never have been tiered live
 *   6/7. tier       — the ordinary snapshot / live split
 *
 * Nothing here reads a symbol pattern or `instrument_type = EQ`; every input is
 * an already-accepted registry field.
 */
export function classifyRecord(r: RegistryRecord): SubscriptionClassification {
  if (r.canonicalInstrumentId === null || r.canonicalInstrumentId.trim() === "") {
    return "IDENTITY_INVALID";
  }
  if (r.conflictStatus !== "NONE") return "PROVIDER_TOKEN_CONFLICT";
  if (r.mappingStatus === "REJECTED_AMBIGUOUS_MATCH" || r.mappingStatus === "REJECTED_DUPLICATE_TOKEN") {
    return "PROVIDER_TOKEN_CONFLICT";
  }
  if (r.securityClass === "UNRESOLVED" || r.eligibilityTier === "UNRESOLVED") {
    return "UNSUPPORTED_SECURITY_CLASS";
  }
  if (r.eligibilityTier === "EXCLUDED_NON_STOCK") return "EXCLUDED";
  if (r.listingStatus !== "ACTIVE") return "LISTING_NOT_ACTIVE";

  switch (r.eligibilityTier) {
    case "SNAPSHOT_ONLY":
      return "SNAPSHOT_ONLY";
    case "LIVE_REQUIRED":
      return isUsableProviderToken(r.kiteInstrumentToken) &&
        isExchangeQualifiedMapping(r) &&
        r.mappingStatus === "MAPPED_EXACT" &&
        r.primaryQuoteProvider === "KITE"
        ? "LIVE_MAPPED"
        : "LIVE_UNMAPPED";
    default:
      // UNAVAILABLE with an ACTIVE listing: the exchange lists it, but no
      // supported class covers it. Explicit, never a remainder bucket.
      return "UNSUPPORTED_SECURITY_CLASS";
  }
}

/**
 * SECTION F — the separate LIVE_REQUIRED equation.
 *
 * The classification buckets answer "what may be subscribed". This answers the
 * different question "what did the registry say was REQUIRED, and where did all
 * of it go" — because a required instrument diverted into IDENTITY_INVALID or
 * PROVIDER_TOKEN_CONFLICT is still required. Reporting only mapped+unmapped
 * would silently drop it from the requirement.
 */
export interface LiveRequiredEquation {
  readonly total: number;
  readonly mapped: number;
  readonly unmapped: number;
  /** LIVE_REQUIRED records that fell into a defect bucket instead. */
  readonly divertedIdentityInvalid: number;
  readonly divertedTokenConflict: number;
  readonly divertedListingNotActive: number;
  readonly divertedUnsupportedClass: number;
  /** total === mapped + unmapped + every diverted count. */
  readonly balances: boolean;
}

export interface AdmittedInstrument {
  readonly canonicalInstrumentId: string;
  readonly exchange: "NSE" | "BSE";
  readonly segment: "EQUITY" | "INDEX";
  readonly providerExchange: string;
  readonly providerToken: number;
}

export type SubscriptionManifestState =
  | "ACTIVATABLE_CURRENT"
  | "CANDIDATE_LAST_KNOWN"
  | "UNAVAILABLE";

export interface SubscriptionAdmissionManifest {
  readonly state: SubscriptionManifestState;
  /** TRUE only for ACTIVATABLE_CURRENT. Never inferred from any other field. */
  readonly activationAuthorized: boolean;
  readonly policyVersion: number;
  readonly evaluatedAt: string;

  readonly registryGenerationId: string | null;
  readonly registryGeneratedAt: string | null;
  readonly schemaVersion: number | null;
  readonly manifestPolicyVersion: number | null;

  readonly authorityState: string | null;
  readonly authorityReasons: readonly string[];

  readonly totalRecords: number;
  readonly classificationCounts: ClassificationCounts;
  /** totalRecords minus the sum of every bucket. MUST be 0. */
  readonly remainder: number;
  readonly liveRequired: LiveRequiredEquation;

  /** The admitted live set, ordered by canonical instrument id. Empty when invalid. */
  readonly admitted: readonly AdmittedInstrument[];
  /** sha256 over the ordered `identity|token` pairs, plus the count. */
  readonly subscriptionSetHash: string | null;

  /** Machine-readable refusal codes; empty only for ACTIVATABLE_CURRENT. */
  readonly blockers: readonly string[];
  /** Set only when the manifest is structurally invalid. */
  readonly blockerCode: string | null;
}

const EMPTY_COUNTS: ClassificationCounts = Object.freeze({
  LIVE_MAPPED: 0,
  LIVE_UNMAPPED: 0,
  SNAPSHOT_ONLY: 0,
  EXCLUDED: 0,
  IDENTITY_INVALID: 0,
  PROVIDER_TOKEN_CONFLICT: 0,
  UNSUPPORTED_SECURITY_CLASS: 0,
  LISTING_NOT_ACTIVE: 0,
});

const EMPTY_EQUATION: LiveRequiredEquation = Object.freeze({
  total: 0,
  mapped: 0,
  unmapped: 0,
  divertedIdentityInvalid: 0,
  divertedTokenConflict: 0,
  divertedListingNotActive: 0,
  divertedUnsupportedClass: 0,
  balances: true,
});

function unavailable(
  evaluatedAtMs: number,
  blockers: readonly string[],
  invalid: boolean,
  generation?: RegistryGeneration | null,
): SubscriptionAdmissionManifest {
  const m = generation?.manifest ?? null;
  return Object.freeze({
    state: "UNAVAILABLE" as const,
    activationAuthorized: false,
    policyVersion: SUBSCRIPTION_POLICY_VERSION,
    evaluatedAt: new Date(evaluatedAtMs).toISOString(),
    registryGenerationId: m?.registryGenerationId ?? null,
    registryGeneratedAt: m?.generatedAt ?? null,
    schemaVersion: m?.schemaVersion ?? null,
    manifestPolicyVersion: m?.policyVersion ?? null,
    authorityState: null,
    authorityReasons: Object.freeze([]),
    totalRecords: generation?.records.length ?? 0,
    classificationCounts: EMPTY_COUNTS,
    remainder: 0,
    liveRequired: EMPTY_EQUATION,
    admitted: Object.freeze([]),
    subscriptionSetHash: null,
    blockers: Object.freeze([...blockers]),
    blockerCode: invalid ? SUBSCRIPTION_MANIFEST_INVALID_BLOCKER : null,
  });
}

/**
 * Hash of the admitted subscription set. Count is included in the preimage so
 * that a truncated set can never collide with the full one.
 */
export function computeSubscriptionSetHash(admitted: readonly AdmittedInstrument[]): string {
  const body = admitted
    .map((a) => `${a.canonicalInstrumentId}|${a.providerExchange}|${a.providerToken}`)
    .join("\n");
  return createHash("sha256")
    .update(`policy=${SUBSCRIPTION_POLICY_VERSION}\ncount=${admitted.length}\n${body}`, "utf8")
    .digest("hex");
}

export interface BuildSubscriptionManifestInput {
  readonly generation: RegistryGeneration | null | undefined;
  /** REQUIRED. Authority is a claim about an instant; it is never defaulted here. */
  readonly nowMs: number;
  /**
   * Whether boot restoration has settled. A caller reading the live store must
   * pass the real value; an unsettled store means "unanswered", not "empty".
   */
  readonly restorationSettled: boolean;
}

/**
 * SECTIONS D/E/F/G — the whole admission decision, as one pure function.
 */
export function buildSubscriptionAdmissionManifest(
  input: BuildSubscriptionManifestInput,
): SubscriptionAdmissionManifest {
  const { generation, nowMs, restorationSettled } = input;

  if (!restorationSettled) {
    return unavailable(nowMs, ["REGISTRY_RESTORATION_NOT_SETTLED"], false, null);
  }
  if (!generation) {
    return unavailable(nowMs, ["REGISTRY_NOT_CONFIGURED"], false, null);
  }

  const { manifest, records } = generation;

  // ── INTEGRITY (immutable, payload-only). Re-applied here in full: this is an
  // authority boundary, and a caller can hand us a hand-built generation. ────
  const integrity: string[] = [];
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) integrity.push("SCHEMA_VERSION_UNSUPPORTED");
  if (manifest.policyVersion !== CLASSIFICATION_POLICY_VERSION) integrity.push("POLICY_VERSION_UNSUPPORTED");
  if (manifest.classificationPolicyHash !== computeClassificationPolicyHash()) {
    integrity.push("CLASSIFICATION_POLICY_HASH_MISMATCH");
  }
  if (!isManifestAccepted(manifest)) integrity.push("MANIFEST_NOT_ACCEPTED");
  if (!verifyManifestChecksum(manifest)) integrity.push("MANIFEST_CHECKSUM_MISMATCH");
  if (records.length !== manifest.totalOfficialRecords + manifest.indexCount) {
    integrity.push("RECORD_COUNT_MISMATCH");
  }
  if (computeRecordSetHash(records) !== manifest.recordSetHash) integrity.push("RECORD_SET_HASH_MISMATCH");
  // The eligible-live commitment is the one the registry's own commit gate
  // binds a generation by. Re-deriving the record-set hash alone would leave a
  // manifest whose live commitment describes a DIFFERENT set — recomputed
  // checksum and all — able to reach this boundary intact.
  if (computeEligibleLiveSetHash(records) !== manifest.eligibleLiveSetHash) {
    integrity.push("ELIGIBLE_LIVE_SET_HASH_MISMATCH");
  }
  // Records must belong to THIS generation. Otherwise a set spliced from an
  // older, differently-classified universe could be subscribed under today's id.
  if (records.some((r) => r.registryGenerationId !== manifest.registryGenerationId)) {
    integrity.push("FOREIGN_REGISTRY_GENERATION_ID_IN_RECORDS");
  }
  // A universe below the durability floor was never commit-eligible; admitting
  // it would let a truncated restore speak for the whole market.
  if (records.length < MIN_RECORDS_FOR_COMMIT) {
    integrity.push("RECORD_COUNT_BELOW_DURABILITY_FLOOR");
  }
  if (manifest.nse.remainder !== 0 || manifest.bse.remainder !== 0) {
    integrity.push("EXCHANGE_RECONCILIATION_REMAINDER_NON_ZERO");
  }
  if (verifyCalendarCommitmentIntegrity(manifest.tradingCalendar).length > 0) {
    integrity.push("CALENDAR_COMMITMENT_UNVERIFIABLE");
  }
  if (integrity.length > 0) return unavailable(nowMs, integrity, true, generation);

  // ── CLASSIFICATION (Section F) ────────────────────────────────────────────
  const counts: Record<SubscriptionClassification, number> = { ...EMPTY_COUNTS };
  const equation = {
    total: 0,
    mapped: 0,
    unmapped: 0,
    divertedIdentityInvalid: 0,
    divertedTokenConflict: 0,
    divertedListingNotActive: 0,
    divertedUnsupportedClass: 0,
  };
  const admitted: AdmittedInstrument[] = [];

  for (const r of records) {
    const c = classifyRecord(r);
    counts[c]++;
    if (r.eligibilityTier === "LIVE_REQUIRED") {
      equation.total++;
      switch (c) {
        case "LIVE_MAPPED":
          equation.mapped++;
          break;
        case "LIVE_UNMAPPED":
          equation.unmapped++;
          break;
        case "IDENTITY_INVALID":
          equation.divertedIdentityInvalid++;
          break;
        case "PROVIDER_TOKEN_CONFLICT":
          equation.divertedTokenConflict++;
          break;
        case "LISTING_NOT_ACTIVE":
          equation.divertedListingNotActive++;
          break;
        default:
          equation.divertedUnsupportedClass++;
          break;
      }
    }
    if (c === "LIVE_MAPPED") {
      admitted.push({
        canonicalInstrumentId: r.canonicalInstrumentId as string,
        exchange: r.exchange,
        segment: r.segment,
        providerExchange: (r.kiteExchange as string).trim().toUpperCase(),
        providerToken: r.kiteInstrumentToken as number,
      });
    }
  }

  const bucketSum = ALL_SUBSCRIPTION_CLASSIFICATIONS.reduce((n, k) => n + counts[k], 0);
  const remainder = records.length - bucketSum;
  const balances =
    equation.total ===
    equation.mapped +
      equation.unmapped +
      equation.divertedIdentityInvalid +
      equation.divertedTokenConflict +
      equation.divertedListingNotActive +
      equation.divertedUnsupportedClass;

  const structural: string[] = [];
  if (remainder !== 0) structural.push("CLASSIFICATION_REMAINDER_NON_ZERO");
  if (!balances) structural.push("LIVE_REQUIRED_EQUATION_DOES_NOT_BALANCE");
  if (counts.LIVE_MAPPED !== admitted.length) structural.push("ADMITTED_SET_COUNT_MISMATCH");

  // ── SECTION G — TOKEN INVARIANTS over the admitted set ────────────────────
  // 1:1 in BOTH directions. Two identities on one token means the provider
  // mapping is disputed; one identity twice means the record set is not a set.
  // Either way there is no safe subscription list, so the manifest is invalid —
  // it is NOT quietly deduplicated.
  const byToken = new Map<number, string>();
  const seenIdentities = new Set<string>();
  for (const a of admitted) {
    if (seenIdentities.has(a.canonicalInstrumentId)) {
      structural.push("DUPLICATE_CANONICAL_IDENTITY_IN_ADMITTED_SET");
      break;
    }
    seenIdentities.add(a.canonicalInstrumentId);
  }
  for (const a of admitted) {
    const prior = byToken.get(a.providerToken);
    if (prior !== undefined && prior !== a.canonicalInstrumentId) {
      structural.push("DUPLICATE_PROVIDER_TOKEN_IN_ADMITTED_SET");
      break;
    }
    byToken.set(a.providerToken, a.canonicalInstrumentId);
  }
  if (admitted.some((a) => !isUsableProviderToken(a.providerToken))) {
    structural.push("PROVIDER_TOKEN_NOT_POSITIVE_SAFE_INTEGER");
  }
  if (admitted.some((a) => a.providerExchange !== a.exchange)) {
    structural.push("PROVIDER_MAPPING_NOT_EXCHANGE_QUALIFIED");
  }
  if (admitted.length === 0) structural.push("NO_ADMITTED_LIVE_INSTRUMENTS");

  if (structural.length > 0) return unavailable(nowMs, structural, true, generation);

  // Deterministic order: canonical identity, ascending, code-point ordering.
  admitted.sort((a, b) => (a.canonicalInstrumentId < b.canonicalInstrumentId ? -1 : 1));

  // ── AUTHORITY AT `nowMs` (Section D/E) ────────────────────────────────────
  const authority = evaluateRegistryAuthorityNow(manifest, nowMs).combined;
  const current = authority.state === "CURRENT_AUTHORITATIVE";

  return Object.freeze({
    state: current ? ("ACTIVATABLE_CURRENT" as const) : ("CANDIDATE_LAST_KNOWN" as const),
    activationAuthorized: current,
    policyVersion: SUBSCRIPTION_POLICY_VERSION,
    evaluatedAt: new Date(nowMs).toISOString(),
    registryGenerationId: manifest.registryGenerationId,
    registryGeneratedAt: manifest.generatedAt,
    schemaVersion: manifest.schemaVersion,
    manifestPolicyVersion: manifest.policyVersion,
    authorityState: authority.state,
    authorityReasons: Object.freeze([...authority.reasons]),
    totalRecords: records.length,
    classificationCounts: Object.freeze({ ...counts }),
    remainder,
    liveRequired: Object.freeze({ ...equation, balances }),
    admitted: Object.freeze([...admitted]),
    subscriptionSetHash: computeSubscriptionSetHash(admitted),
    blockers: current ? Object.freeze([]) : Object.freeze(["REGISTRY_AUTHORITY_NOT_CURRENT"]),
    blockerCode: null,
  });
}

/**
 * Read the admission manifest from the in-process registry store.
 *
 * Deliberately goes through `getSettledActiveGeneration`, never
 * `getActiveGeneration`: before restoration settles there is no answer, and an
 * unanswered question must not be served as an empty universe.
 */
export function getSubscriptionAdmissionManifestNow(nowMs: number): SubscriptionAdmissionManifest {
  return buildSubscriptionAdmissionManifest({
    generation: getSettledActiveGeneration(),
    nowMs,
    restorationSettled: isRegistryRestorationSettled(),
  });
}
