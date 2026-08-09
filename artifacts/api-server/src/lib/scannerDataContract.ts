/**
 * Scanner Data Contract — Three independent quality dimensions.
 *
 * ADDENDUM_33B Section 1: Separate data freshness from evaluation authorization.
 *
 * These three dimensions are INDEPENDENT. They must never overwrite each other:
 *
 *   dataState      — How fresh and complete is the price/OHLC data?
 *   evaluationState — Is the evaluation authorized? If so, what is the result?
 *   actionability  — What can a user (or system) do with this data?
 *
 * Canonical example — Phase A with a fresh Kite intraday quote:
 *   dataState:       READY_LIVE     (Kite session, market open, <2min old)
 *   evaluationState: PHASE_A_POPULATION_ONLY (compile-time lock=false)
 *   actionability:   NOT_ACTIONABLE (lock prevents signals/paper/alerts)
 *
 * This is DIFFERENT from a Yahoo-fallback row:
 *   dataState:       READY_STALE    (Yahoo delayed, 15+ min old)
 *   evaluationState: SOURCE_NOT_TRADE_GRADE (Yahoo is info-only)
 *   actionability:   INFO_ONLY      (display only, no trading admission)
 *
 * INVARIANT: The combination (READY_LIVE, AUTHORIZED, TRADE_GRADE) is only
 * possible when SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED=true (Phase B).
 * In Phase A, actionability is always NOT_ACTIONABLE regardless of dataState.
 */

// ── Data State ─────────────────────────────────────────────────────────────
/**
 * How fresh and complete is the price/OHLC data for this scanner generation?
 * Reflects the DATA LAYER only — independent of evaluation authorization.
 */
export type DataState =
  /** Kite intraday quotes, market currently open, data < 2 minutes old. */
  | "READY_LIVE"
  /** Kite EOD/closing quotes, market closed (post-market or pre-market). */
  | "READY_CLOSED"
  /** Last-good cache served while background refresh is in progress.
   *  Age exceeds REFRESH_MS but is below DISK_CACHE_MAX_AGE_MS. */
  | "READY_STALE"
  /** Some eligible symbols have quotes, some have no quote this cycle.
   *  Coverage is ≥1 row but < universeSize rows. */
  | "READY_PARTIAL"
  /** No quotes available for any eligible symbol. */
  | "UNAVAILABLE"
  /** Scan failed; neither fresh data nor last-good generation could be served. */
  | "ERROR";

// ── Evaluation State ────────────────────────────────────────────────────────
/**
 * Is evaluation authorized? And if so, what is the result quality?
 * Reflects the EVALUATION LAYER only — independent of data freshness.
 */
export type EvaluationState =
  /** Phase B: SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED=true.
   *  Scores and signals are produced from Kite candle analytics. */
  | "AUTHORIZED"
  /** Phase A: SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED=false.
   *  Compile-time lock prevents evaluation regardless of data availability.
   *  Rows carry NOT_EVALUATED with PHASE_A_POPULATION_ONLY reason code. */
  | "PHASE_A_POPULATION_ONLY"
  /** Not enough historical bars to compute a reliable signal.
   *  Data is present but history is too short (<252 bars for full evaluation). */
  | "INSUFFICIENT_HISTORY"
  /** Data source is not trade-grade (Yahoo delayed, bhavcopy only).
   *  Signals from this source are info-only and cannot drive paper/live trades. */
  | "SOURCE_NOT_TRADE_GRADE"
  /** Inputs exist but are too old to evaluate (stale candle data). */
  | "STALE_INPUT"
  /** Fallback: evaluation was not performed for an unlisted reason. */
  | "NOT_EVALUATED";

// ── Actionability ────────────────────────────────────────────────────────────
/**
 * What can a user (or system) do with this scanner data?
 * Derived from BOTH dataState AND evaluationState — but neither alone.
 * Must be computed by computeActionability(), never hard-coded at a call site.
 */
export type Actionability =
  /** Data is fresh (READY_LIVE or READY_CLOSED) AND evaluation is AUTHORIZED.
   *  Can drive live signals, paper trade admission, alerts, ranking, breadth. */
  | "TRADE_GRADE"
  /** Data is present (any READY_* state) but evaluation is locked, source is
   *  not trade-grade, or history is insufficient. Display only.
   *  Cannot drive paper/live trades, alerts, or automated decisions. */
  | "INFO_ONLY"
  /** Data is unavailable or scan failed. Cannot be used for any purpose. */
  | "NOT_ACTIONABLE";

// ── Computed Scanner Grade ──────────────────────────────────────────────────
export interface ScannerGrade {
  dataState: DataState;
  evaluationState: EvaluationState;
  actionability: Actionability;
  /** ISO timestamp of when the displayed generation completed. */
  generationCompletedAt: string | null;
  /** Explanation visible in UI and logs. */
  rationale: string;
}

// ── Computation ──────────────────────────────────────────────────────────────

interface ComputeInput {
  /** Does a live Kite session provide the quotes? */
  kiteOnline: boolean;
  /** Is the SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED constant true? */
  evaluationAuthorized: boolean;
  /** Is the market currently open (intraday session)? */
  marketOpen: boolean;
  /** Age of the cache in ms (null = no cache). */
  cacheAgeMs: number | null;
  /** Total eligible symbols in the universe. */
  universeSize: number;
  /** Rows that produced a quote. */
  rowCount: number;
  /** REFRESH_MS threshold for "stale" label. */
  refreshMs: number;
  /** Max age before cache is considered UNAVAILABLE. */
  maxAgeMs: number;
  /** ISO timestamp of when the generation completed (null = no generation). */
  generationCompletedAt: string | null;
}

/**
 * Compute the three independent quality dimensions from scanner state.
 *
 * INVARIANT PROOFS (enforced in scannerDataContract.test.ts):
 *  1. evaluationState=AUTHORIZED requires evaluationAuthorized=true (cannot be true otherwise)
 *  2. actionability=TRADE_GRADE requires BOTH kiteOnline=true AND evaluationAuthorized=true
 *  3. phaseA (evaluationAuthorized=false) always produces NOT_ACTIONABLE regardless of dataState
 *  4. dataState=READY_LIVE does NOT imply evaluationState=AUTHORIZED (Phase A disproves it)
 *  5. Yahoo-offline (kiteOnline=false) always produces INFO_ONLY or NOT_ACTIONABLE, never TRADE_GRADE
 */
export function computeScannerGrade(input: ComputeInput): ScannerGrade {
  const {
    kiteOnline,
    evaluationAuthorized,
    marketOpen,
    cacheAgeMs,
    universeSize,
    rowCount,
    refreshMs,
    maxAgeMs,
    generationCompletedAt,
  } = input;

  // ── 1. Compute dataState independently ─────────────────────────────────────
  let dataState: DataState;
  if (cacheAgeMs === null || rowCount === 0) {
    dataState = "UNAVAILABLE";
  } else if (cacheAgeMs > maxAgeMs) {
    dataState = "ERROR"; // hard-stale past disk cache max-age
  } else if (cacheAgeMs > refreshMs && marketOpen) {
    dataState = "READY_STALE"; // behind schedule during open-market window
  } else if (rowCount < universeSize * 0.5) {
    dataState = "READY_PARTIAL"; // < 50% coverage
  } else if (!kiteOnline) {
    // Yahoo batch: market may be open but data is delayed ~15min
    dataState = marketOpen ? "READY_STALE" : "READY_CLOSED";
  } else if (marketOpen) {
    dataState = "READY_LIVE";
  } else {
    dataState = "READY_CLOSED";
  }

  // ── 2. Compute evaluationState independently ────────────────────────────────
  // This depends ONLY on whether evaluation is authorized and the source type.
  // It does NOT depend on dataState — Phase A with READY_LIVE data is valid.
  let evaluationState: EvaluationState;
  if (!evaluationAuthorized) {
    evaluationState = "PHASE_A_POPULATION_ONLY";
  } else if (!kiteOnline) {
    evaluationState = "SOURCE_NOT_TRADE_GRADE";
  } else if (dataState === "UNAVAILABLE" || dataState === "ERROR") {
    evaluationState = "NOT_EVALUATED";
  } else if (dataState === "READY_STALE") {
    evaluationState = "STALE_INPUT";
  } else {
    evaluationState = "AUTHORIZED";
  }

  // ── 3. Compute actionability independently ──────────────────────────────────
  // Derived from BOTH dimensions but computed fresh — neither dimension sets
  // actionability directly. This ensures the three are always independent.
  let actionability: Actionability;
  if (dataState === "UNAVAILABLE" || dataState === "ERROR") {
    actionability = "NOT_ACTIONABLE";
  } else if (evaluationState === "AUTHORIZED" && kiteOnline) {
    // Only AUTHORIZED + Kite online = TRADE_GRADE.
    // Phase A cannot reach TRADE_GRADE even with READY_LIVE data.
    actionability = "TRADE_GRADE";
  } else if (evaluationState === "PHASE_A_POPULATION_ONLY") {
    // Phase A: data may be live and fresh, but evaluation is compile-time locked.
    // NOT_ACTIONABLE (not INFO_ONLY) because the lock is binary — no signals,
    // no paper trade, no alerts, no ranking by score.
    actionability = "NOT_ACTIONABLE";
  } else {
    actionability = "INFO_ONLY";
  }

  // ── 4. Build rationale ──────────────────────────────────────────────────────
  const parts: string[] = [];
  parts.push(`Data: ${dataState}`);
  parts.push(`Evaluation: ${evaluationState}`);
  parts.push(`Action: ${actionability}`);
  if (!evaluationAuthorized) parts.push("SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED=false");
  if (!kiteOnline) parts.push("Kite session offline");
  if (dataState === "READY_PARTIAL") parts.push(`Coverage ${rowCount}/${universeSize} (${Math.round(rowCount / Math.max(1, universeSize) * 100)}%)`);

  return {
    dataState,
    evaluationState,
    actionability,
    generationCompletedAt,
    rationale: parts.join(" | "),
  };
}

/**
 * Maps the three-dimension grade to the legacy FeedStatus string for backward
 * compatibility with DataSourceBadge until it is updated to consume the full grade.
 *
 * Mapping rules:
 *   TRADE_GRADE + READY_LIVE       → "live"
 *   TRADE_GRADE + READY_CLOSED     → "delayed"   (EOD, market closed)
 *   INFO_ONLY (any data state)     → "delayed"
 *   NOT_ACTIONABLE (Phase A)       → "delayed"   (data present but locked)
 *   NOT_ACTIONABLE (UNAVAILABLE)   → "stale"
 *
 * CRITICAL: "live" is ONLY possible when actionability=TRADE_GRADE AND dataState=READY_LIVE.
 * Phase A with fresh Kite data maps to "delayed", NOT "live".
 */
export function gradeToFeedStatus(grade: ScannerGrade): "live" | "delayed" | "stale" | "down" {
  if (grade.dataState === "ERROR") return "down";
  if (grade.dataState === "UNAVAILABLE") return "stale";
  if (grade.actionability === "TRADE_GRADE" && grade.dataState === "READY_LIVE") return "live";
  return "delayed";
}

/**
 * Maps the evaluation state to a human-readable label for display in the UI.
 */
export function evaluationStateLabel(state: EvaluationState): string {
  switch (state) {
    case "AUTHORIZED":              return "PHASE B — EVALUATED";
    case "PHASE_A_POPULATION_ONLY": return "PHASE A — NOT EVALUATED";
    case "INSUFFICIENT_HISTORY":    return "INSUFFICIENT HISTORY";
    case "SOURCE_NOT_TRADE_GRADE":  return "INFO ONLY (Yahoo delayed)";
    case "STALE_INPUT":             return "STALE INPUT";
    case "NOT_EVALUATED":           return "NOT EVALUATED";
  }
}
