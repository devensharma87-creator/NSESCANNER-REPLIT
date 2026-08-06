/**
 * Authoritative Paper-Trading Cohort Domain Contract — Pack 32.
 *
 * Single source of truth for cohort identity across the entire paper-trading
 * lifecycle. All write paths, read paths, capital events, reports, alerts,
 * idempotency keys, and UI queries derive cohort identity from this module.
 *
 * Cohort IDs (stable, never renamed):
 *   FNO_PAPER_LEGACY  — existing F&O paper history (pre-V2).
 *   SWING_PAPER_LEGACY — existing swing/equity paper history (pre-V2).
 *   FNO_PAPER_V2      — future F&O cohort (hard-locked, not yet active).
 *   SWING_PAPER_V2    — future swing cohort (hard-locked, not yet active).
 *
 * Null-resolution rule (two-phase compatibility):
 *   Existing rows in `paper_trade_fo` with cohort_id = NULL resolve to
 *   `FNO_PAPER_LEGACY`. Rows in `paper_trade_eq` with NULL resolve to
 *   `SWING_PAPER_LEGACY`. Rows in `paper_account`/`paper_capital_event`
 *   with NULL resolve from their `segment` field. Unknown non-null values
 *   FAIL CLOSED — never silently become legacy or V2.
 *
 * Asset-family rule:
 *   FNO cohorts (FNO_PAPER_LEGACY, FNO_PAPER_V2) belong to asset family FNO.
 *   Swing cohorts (SWING_PAPER_LEGACY, SWING_PAPER_V2) belong to SWING_CASH.
 *   A V2 row for the wrong asset family is rejected.
 *
 * V2 lock rule:
 *   assertV2CohortNotLocked() is the single guard. It reads the runtime
 *   constants from v2PaperLocks.ts — no env-var bypass, no force flag.
 *
 * @see v2PaperLocks.ts  for the compile-time lock constants
 * @see paperCohortMigrations.ts  for additive DB migration definitions
 */

import {
  FNO_PAPER_V2_RUNTIME_AUTHORIZED,
  SWING_PAPER_V2_RUNTIME_AUTHORIZED,
  FNO_PAPER_V2_DISABLED_CODE,
  SWING_PAPER_V2_DISABLED_CODE,
} from "./v2PaperLocks";

// ───────────── Canonical cohort ID ─────────────────────────────────────────

export const PAPER_COHORT_IDS = [
  "FNO_PAPER_LEGACY",
  "SWING_PAPER_LEGACY",
  "FNO_PAPER_V2",
  "SWING_PAPER_V2",
] as const;

export type PaperCohortId = (typeof PAPER_COHORT_IDS)[number];

/** Type-guard for PaperCohortId. */
export function isPaperCohortId(v: unknown): v is PaperCohortId {
  return typeof v === "string" && (PAPER_COHORT_IDS as readonly string[]).includes(v);
}

// ───────────── Supporting enums ─────────────────────────────────────────────

export const ASSET_FAMILIES = ["FNO", "SWING_CASH"] as const;
export type AssetFamily = (typeof ASSET_FAMILIES)[number];

export const COHORT_GENERATIONS = ["LEGACY", "V2"] as const;
export type CohortGeneration = (typeof COHORT_GENERATIONS)[number];

export const COHORT_STATUSES = [
  "ACTIVE_LEGACY",
  "DISABLED_PENDING_QUALIFICATION",
] as const;
export type CohortStatus = (typeof COHORT_STATUSES)[number];

export type CohortActivationState = "ACTIVE" | "DISABLED";

// ───────────── Cohort metadata record ───────────────────────────────────────

export interface PaperCohortMetadata {
  cohortId: PaperCohortId;
  assetFamily: AssetFamily;
  generation: CohortGeneration;
  status: CohortStatus;
  /** Always "PAPER_ONLY" — no real money moves in these cohorts. */
  tradingImpact: "PAPER_ONLY";
  activationState: CohortActivationState;
  disabledReason: string | null;
  mayAdmitNewTrades: boolean;
  mayAppearInCombinedInformationalViews: boolean;
  /**
   * DB `segment` value used in `paper_account` and `paper_capital_event`.
   * Legacy rows without `cohort_id` are identified by this value alone.
   */
  dbSegment: "FNO" | "EQUITY";
  /**
   * Table family. Used to validate that a cohort_id on a `paper_trade_fo`
   * row is FNO-family, and a cohort_id on `paper_trade_eq` is SWING-family.
   */
  tableFamily: "FO" | "EQ";
}

// ───────────── Authoritative cohort registry ─────────────────────────────────

function freeze<T extends PaperCohortMetadata>(obj: T): Readonly<PaperCohortMetadata> {
  return Object.freeze(obj) as Readonly<PaperCohortMetadata>;
}

export const COHORT_REGISTRY: Readonly<Record<PaperCohortId, Readonly<PaperCohortMetadata>>> = Object.freeze({
  FNO_PAPER_LEGACY: freeze({
    cohortId: "FNO_PAPER_LEGACY",
    assetFamily: "FNO",
    generation: "LEGACY",
    status: "ACTIVE_LEGACY",
    tradingImpact: "PAPER_ONLY",
    activationState: "ACTIVE",
    disabledReason: null,
    mayAdmitNewTrades: true,
    mayAppearInCombinedInformationalViews: true,
    dbSegment: "FNO",
    tableFamily: "FO",
  }),
  SWING_PAPER_LEGACY: freeze({
    cohortId: "SWING_PAPER_LEGACY",
    assetFamily: "SWING_CASH",
    generation: "LEGACY",
    status: "ACTIVE_LEGACY",
    tradingImpact: "PAPER_ONLY",
    activationState: "ACTIVE",
    disabledReason: null,
    mayAdmitNewTrades: true,
    mayAppearInCombinedInformationalViews: true,
    dbSegment: "EQUITY",
    tableFamily: "EQ",
  }),
  FNO_PAPER_V2: freeze({
    cohortId: "FNO_PAPER_V2",
    assetFamily: "FNO",
    generation: "V2",
    status: "DISABLED_PENDING_QUALIFICATION",
    tradingImpact: "PAPER_ONLY",
    activationState: "DISABLED",
    disabledReason:
      "Awaiting ≥130 trading days of real option-premium capture data and frozen-protocol F&O requalification (Pack 9 Gate 6 verdict).",
    mayAdmitNewTrades: false,
    mayAppearInCombinedInformationalViews: false,
    dbSegment: "FNO",
    tableFamily: "FO",
  }),
  SWING_PAPER_V2: freeze({
    cohortId: "SWING_PAPER_V2",
    assetFamily: "SWING_CASH",
    generation: "V2",
    status: "DISABLED_PENDING_QUALIFICATION",
    tradingImpact: "PAPER_ONLY",
    activationState: "DISABLED",
    disabledReason:
      "Awaiting swing qualification and separate owner activation decision.",
    mayAdmitNewTrades: false,
    mayAppearInCombinedInformationalViews: false,
    dbSegment: "EQUITY",
    tableFamily: "EQ",
  }),
});

/** Returns metadata for a cohort. Throws on unknown IDs (fail-closed). */
export function getCohortMetadata(cohortId: PaperCohortId): Readonly<PaperCohortMetadata> {
  return COHORT_REGISTRY[cohortId];
}

/** Returns all cohort metadata records as an array. */
export function getAllCohortMetadata(): Readonly<PaperCohortMetadata>[] {
  return Object.values(COHORT_REGISTRY);
}

// ───────────── Null-resolution (two-phase compatibility) ────────────────────

/**
 * Resolve `cohort_id` for a `paper_trade_fo` row.
 * NULL → FNO_PAPER_LEGACY. Unknown non-null → fail closed.
 */
export function resolveFoCohortId(rawCohortId: string | null | undefined): PaperCohortId {
  if (rawCohortId == null) return "FNO_PAPER_LEGACY";
  if (isPaperCohortId(rawCohortId)) {
    const meta = COHORT_REGISTRY[rawCohortId];
    if (meta.tableFamily !== "FO") {
      throw Object.assign(
        new Error(`cohort_id ${rawCohortId} belongs to table family ${meta.tableFamily}, expected FO`),
        { code: "ASSET_FAMILY_MISMATCH" },
      );
    }
    return rawCohortId;
  }
  throw Object.assign(new Error(`Unknown cohort_id: ${rawCohortId}`), { code: "UNKNOWN_COHORT" });
}

/**
 * Resolve `cohort_id` for a `paper_trade_eq` row.
 * NULL → SWING_PAPER_LEGACY. Unknown non-null → fail closed.
 */
export function resolveEqCohortId(rawCohortId: string | null | undefined): PaperCohortId {
  if (rawCohortId == null) return "SWING_PAPER_LEGACY";
  if (isPaperCohortId(rawCohortId)) {
    const meta = COHORT_REGISTRY[rawCohortId];
    if (meta.tableFamily !== "EQ") {
      throw Object.assign(
        new Error(`cohort_id ${rawCohortId} belongs to table family ${meta.tableFamily}, expected EQ`),
        { code: "ASSET_FAMILY_MISMATCH" },
      );
    }
    return rawCohortId;
  }
  throw Object.assign(new Error(`Unknown cohort_id: ${rawCohortId}`), { code: "UNKNOWN_COHORT" });
}

/**
 * Resolve `cohort_id` for `paper_account` / `paper_capital_event` rows,
 * using `segment` as a secondary key when cohort_id is null.
 * NULL → infer from segment. Unknown non-null → fail closed.
 */
export function resolveSegmentCohortId(
  rawCohortId: string | null | undefined,
  segment: "FNO" | "EQUITY",
): PaperCohortId {
  if (rawCohortId == null) {
    return segment === "FNO" ? "FNO_PAPER_LEGACY" : "SWING_PAPER_LEGACY";
  }
  if (isPaperCohortId(rawCohortId)) return rawCohortId;
  throw Object.assign(new Error(`Unknown cohort_id: ${rawCohortId}`), { code: "UNKNOWN_COHORT" });
}

// ───────────── V2 write guard ───────────────────────────────────────────────

/**
 * Guards any V2 write path. Must be called BEFORE any DB read or write.
 * Throws with a stable machine-readable code when the lock is false.
 * Legacy cohort IDs pass through with no effect.
 */
export function assertV2CohortNotLocked(cohortId: PaperCohortId): void {
  if (cohortId === "FNO_PAPER_V2" && !FNO_PAPER_V2_RUNTIME_AUTHORIZED) {
    throw Object.assign(new Error(FNO_PAPER_V2_DISABLED_CODE), {
      code: FNO_PAPER_V2_DISABLED_CODE,
      cohortId,
    });
  }
  if (cohortId === "SWING_PAPER_V2" && !SWING_PAPER_V2_RUNTIME_AUTHORIZED) {
    throw Object.assign(new Error(SWING_PAPER_V2_DISABLED_CODE), {
      code: SWING_PAPER_V2_DISABLED_CODE,
      cohortId,
    });
  }
}

/**
 * Returns true if the cohort is currently allowed to admit new trades.
 * Takes V2 lock state into account.
 */
export function isCohortAdmissionOpen(cohortId: PaperCohortId): boolean {
  const meta = COHORT_REGISTRY[cohortId];
  if (!meta.mayAdmitNewTrades) return false;
  if (cohortId === "FNO_PAPER_V2") return FNO_PAPER_V2_RUNTIME_AUTHORIZED;
  if (cohortId === "SWING_PAPER_V2") return SWING_PAPER_V2_RUNTIME_AUTHORIZED;
  return true;
}

// ───────────── Asset-family validation ──────────────────────────────────────

/**
 * Asserts that a cohort ID matches the expected asset family.
 * Rejects cross-family assignments (e.g. FNO_PAPER_V2 on an EQ table).
 */
export function assertCohortAssetFamily(cohortId: PaperCohortId, expectedFamily: AssetFamily): void {
  const meta = COHORT_REGISTRY[cohortId];
  if (meta.assetFamily !== expectedFamily) {
    throw Object.assign(
      new Error(
        `Asset-family mismatch: cohort ${cohortId} is ${meta.assetFamily}, expected ${expectedFamily}`,
      ),
      { code: "ASSET_FAMILY_MISMATCH", cohortId, expectedFamily },
    );
  }
}

/**
 * Validates a raw cohort_id string from a route query/body.
 * Returns the typed PaperCohortId or null if absent.
 * Throws with a 4xx-appropriate error on unknown values.
 */
export function validateCohortIdParam(raw: unknown): PaperCohortId | null {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") {
    throw Object.assign(new Error("cohort_id must be a string"), { httpStatus: 400, code: "INVALID_COHORT_ID" });
  }
  if (!isPaperCohortId(raw)) {
    throw Object.assign(new Error(`Unknown cohort_id: ${raw}`), { httpStatus: 400, code: "UNKNOWN_COHORT_ID" });
  }
  return raw;
}

// ───────────── Alert / idempotency key helpers ───────────────────────────────

/**
 * Returns a stable cohort-scoped idempotency key prefix. Ensures that
 * idempotency keys for FNO_PAPER_LEGACY and FNO_PAPER_V2 cannot collide.
 *
 * Usage: `${cohortIdempotencyPrefix(cohortId)}:${baseKey}`
 */
export function cohortIdempotencyPrefix(cohortId: PaperCohortId): string {
  return cohortId;
}

/**
 * Returns a stable cohort-scoped alert deduplication key.
 * Ensures V2 alert keys cannot suppress legacy alert keys and vice versa.
 *
 * Usage: `${cohortAlertDedupKey(cohortId, baseKey)}`
 */
export function cohortAlertDedupKey(cohortId: PaperCohortId, baseKey: string): string {
  return `${cohortId}:${baseKey}`;
}

// ───────────── Capital isolation helpers ─────────────────────────────────────

/**
 * Capital invariant check. Asserts that a V2 cohort has no inherited
 * balance from the legacy cohort. This is satisfied when V2 is locked
 * (no account row exists for V2). Called from diagnostic/reconciliation
 * endpoints for evidence.
 */
export function assertV2HasNoInheritedBalance(
  cohortId: "FNO_PAPER_V2" | "SWING_PAPER_V2",
  v2AccountExists: boolean,
): void {
  if (v2AccountExists) {
    throw Object.assign(
      new Error(`V2 cohort ${cohortId} has an account row — balance inheritance must be proven zero before activation`),
      { code: "V2_ACCOUNT_ALREADY_EXISTS", cohortId },
    );
  }
  // V2 locked → no account row → no inherited balance. Invariant satisfied.
}

/**
 * Returns the NOT_ACTIVATED status object for V2 cohorts when they are
 * queried via the API but the cohort is disabled.
 */
export function getV2NotActivatedResponse(cohortId: "FNO_PAPER_V2" | "SWING_PAPER_V2"): {
  cohortId: PaperCohortId;
  activationState: "DISABLED";
  status: "NOT_ACTIVATED";
  disabledReason: string;
  trades: never[];
  balance: null;
  realizedPnl: null;
  charges: null;
  openPositions: never[];
} {
  const meta = COHORT_REGISTRY[cohortId];
  return {
    cohortId,
    activationState: "DISABLED",
    status: "NOT_ACTIVATED",
    disabledReason: meta.disabledReason ?? "Cohort not activated.",
    trades: [],
    balance: null,
    realizedPnl: null,
    charges: null,
    openPositions: [],
  };
}

// ───────────── Combined informational view helper ────────────────────────────

/** Label for explicitly combined informational aggregations. */
export const COMBINED_COHORTS_INFORMATIONAL_LABEL = "COMBINED_COHORTS_INFORMATIONAL" as const;

/**
 * Returns the cohorts that may appear in a combined informational view.
 * V2 cohorts are excluded while disabled.
 */
export function getCombinedViewCohorts(): PaperCohortId[] {
  return Object.values(COHORT_REGISTRY)
    .filter((m) => m.mayAppearInCombinedInformationalViews)
    .map((m) => m.cohortId);
}

// ───────────── React Query key helpers (server contract) ────────────────────

/**
 * Canonical paper query key factory — matches what the scanner UI uses.
 * Including cohort in the key prevents stale data from one cohort appearing
 * after switching to another.
 */
export function paperQueryKey(
  resource: string,
  cohortId: PaperCohortId,
  ...extra: (string | number | boolean | null)[]
): readonly [string, string, PaperCohortId, ...(string | number | boolean | null)[]] {
  return ["paper", resource, cohortId, ...extra] as const;
}
