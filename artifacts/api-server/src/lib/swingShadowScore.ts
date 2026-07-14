/**
 * H10a — B1 / B3 pure shadow-scoring module (read-only, scratch foundation).
 *
 * Pure deterministic functions that compute B1 and B3 *shadow* scores from
 * an already-loaded `swing_scan_result` row. This module is NOT consumed by
 * any live scoring, recommendation, action-label, entry/stop/target/RR,
 * paper-equity, F&O, scheduler, route handler, or UI path. It exists only
 * so that a later (separately approved) diagnostic endpoint can transform
 * persisted rows into shadow-score diagnostics without touching the live
 * scoring path.
 *
 * Strict isolation contract (enforced by code review at any future
 * integration time, not by this module):
 *   - No DB / Kite / Yahoo / scheduler / fs imports.
 *   - No mutation of input rows.
 *   - Pure functions only — same input always returns the same output.
 *   - Live `score` and `action` are NEVER recomputed or overwritten.
 *
 * Formulas (H8-locked, deliberately NOT re-tuned):
 *
 *   b1_shadow_score = clamp(live_score - fundamental_score, 0, 100)
 *
 *   extension_penalty =
 *       (rsi14 > 70                                  ?  8 : 0)
 *     + (warnings ⊇ EXTENDED_FROM_EMA20_SUBSTRING    ?  6 : 0)
 *     + (warnings ⊇ RSI_OVEREXTENDED_SUBSTRING       ?  5 : 0)
 *     + (|pct_from_52w_high| ≤ 3                     ?  3 : 0)
 *
 *   rs_weak_penalty   = warnings ⊇ RS_WEAK_SUBSTRING ? 15 : 0
 *
 *   b3_shadow_score   = clamp(b1_shadow_score - extension_penalty - rs_weak_penalty, 0, 100)
 *
 * Conservatism choice (B1 ambiguity, H10a spec §B1):
 *   The H10a spec allows either "remove" or "heavily downweight"
 *   fundamental_score. We choose **full removal** (subtract the full
 *   stored fundamental_score from the live score) because:
 *     1. It exactly matches the B1 formula tested across H6 / H7 / H8.
 *     2. A partial downweight would introduce a new tunable parameter
 *        (the downweight ratio) that has zero offline evidence behind it
 *        — testing it later would require re-running H4-H8 with the new
 *        constant.
 *     3. Full removal is the most conservative interpretation of "remove
 *        or downweight": a partial downweight would be a NEW model that
 *        wasn't in H8's locked candidate set.
 *
 * Fail-open posture:
 *   - Any null / NaN / non-finite input that the formula needs is
 *     treated as "feature unavailable" — that piece contributes 0 to
 *     the penalty (or, for missing fundamental_score, 0 to the
 *     B1 subtraction). A reason code is always emitted explaining
 *     what was unavailable so the diagnostic surface can show data
 *     quality, not silent zeros.
 *
 * Warning-code verification (see `verifyWarningCodes` below):
 *   The scanner (`swingScanner.ts` ~L991/L1020/L1026) emits *English
 *   prose* into `warnings`, not short codes. The substring constants
 *   below are the verified spellings as of the H10a snapshot. If
 *   `swingScanner.ts` ever changes the prose, the B3 penalties will
 *   silently go to 0 — `verifyWarningCodes` is the lock-in helper that
 *   asserts each constant is still detectable in a sample of recent
 *   `warnings` arrays.
 */

/**
 * Persisted-row shape this module consumes.
 *
 * Numeric fields are typed `number | string | null | undefined` because
 * Drizzle's `numeric` column type deserializes to `string` at runtime
 * (Postgres `numeric` does not fit into JS `number` losslessly). The
 * runtime coercion below (`toNumOrNull`) accepts either form. Widening
 * the signature here lets callers pass a raw `swing_scan_result` row
 * without any cast.
 */
export interface SwingScanRowForShadow {
  symbol: string;
  scanDate: string;
  liveScore: number | string | null | undefined;
  liveAction: string | null | undefined;
  fundamentalScore: number | string | null | undefined;
  rsi14: number | string | null | undefined;
  pctFrom52wHigh: number | string | null | undefined;
  warnings: readonly unknown[] | null | undefined;
}

/** Verified warning-prose substrings emitted by `swingScanner.ts` (H10a snapshot). */
export const B3_WARNING_SUBSTRINGS = Object.freeze({
  /** scanner: `if (isNum(distEma20Atr) && distEma20Atr > 2.5) warnings.push("Price extended far above EMA20; wait for pullback")` */
  EXTENDED_FROM_EMA20: "Price extended far above EMA20",
  /** scanner: `else if (rsiNow > 75) warnings.push("RSI overextended")` */
  RSI_OVEREXTENDED: "RSI overextended",
  /** scanner: `if (isNum(rs.rs20) && rs.rs20 < -3) warnings.push("Short-term relative strength weak vs benchmark")` */
  RS_WEAK: "Short-term relative strength weak vs benchmark",
} as const);

/** Penalty constants (H8-locked, in score units; do NOT re-tune here). */
export const B3_PENALTY_CONSTANTS = Object.freeze({
  RSI_GT_70_PTS: 8,
  WARN_EXTENDED_PTS: 6,
  WARN_RSI_OVEREXTENDED_PTS: 5,
  NEAR_52W_HIGH_PTS: 3,
  NEAR_52W_HIGH_THRESHOLD_PCT: 3,
  RS_WEAK_PTS: 15,
  RSI_HOT_THRESHOLD: 70,
} as const);

export const SHADOW_SCORE_MIN = 0;
export const SHADOW_SCORE_MAX = 100;

/** Reason codes (machine-readable, stable across versions). */
export type ShadowReasonCode =
  | "B1_FUNDAMENTAL_REMOVED"
  | "B1_FUNDAMENTAL_MISSING_FAIL_OPEN"
  | "B1_LIVE_SCORE_MISSING_FAIL_OPEN"
  | "B1_CLAMPED_LOW"
  | "B1_CLAMPED_HIGH"
  | "B3_INHERITS_B1"
  | "B3_RSI_HOT"
  | "B3_RSI_MISSING_FAIL_OPEN"
  | "B3_WARN_EXTENDED"
  | "B3_WARN_RSI_OVEREXTENDED"
  | "B3_NEAR_52W_HIGH"
  | "B3_PCT_52W_HIGH_MISSING_FAIL_OPEN"
  | "B3_WARN_RS_WEAK"
  | "B3_WARNINGS_MISSING_FAIL_OPEN"
  | "B3_WARNINGS_NOT_ARRAY_FAIL_OPEN"
  | "B3_CLAMPED_LOW"
  | "B3_CLAMPED_HIGH";

export interface ShadowReason {
  code: ShadowReasonCode;
  /** Score-unit delta this reason contributed (signed; negative = penalty). */
  delta: number;
  /** Human-readable note for owner-only diagnostic display. */
  note: string;
}

/** Aggregate data-quality classification per row. */
export type ShadowDataQuality = "OK" | "PARTIAL" | "INSUFFICIENT";

export interface ShadowScoreResult {
  symbol: string;
  scanDate: string;
  liveScore: number | null;
  liveAction: string | null;
  /** B1 shadow score, clamped to [0, 100]; null if live score itself is null/NaN. */
  b1ShadowScore: number | null;
  /** B3 shadow score, clamped to [0, 100]; null iff b1ShadowScore is null. */
  b3ShadowScore: number | null;
  /** b1ShadowScore - liveScore (signed); null when either is null. */
  b1Delta: number | null;
  /** b3ShadowScore - liveScore (signed); null when either is null. */
  b3Delta: number | null;
  b1Reasons: ShadowReason[];
  b3Reasons: ShadowReason[];
  dataQuality: ShadowDataQuality;
  /** Names of inputs that were null/missing/invalid (drives dataQuality). */
  missingFields: string[];
}

/* ────────────────────────────── Helpers ────────────────────────────── */

function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Tolerant numeric coercion: accepts number or stringified numeric (drizzle numeric → string). */
function toNumOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function clamp01_100(v: number): { clamped: number; clampedLow: boolean; clampedHigh: boolean } {
  if (v < SHADOW_SCORE_MIN) return { clamped: SHADOW_SCORE_MIN, clampedLow: true, clampedHigh: false };
  if (v > SHADOW_SCORE_MAX) return { clamped: SHADOW_SCORE_MAX, clampedLow: false, clampedHigh: true };
  return { clamped: v, clampedLow: false, clampedHigh: false };
}

/** True iff `warnings` is a real array (jsonb can deserialize as anything). */
function isWarningArray(v: unknown): v is readonly unknown[] {
  return Array.isArray(v);
}

/** Case-sensitive substring match across any string element of a warnings array. */
function warningsInclude(warnings: readonly unknown[], substring: string): boolean {
  for (const w of warnings) {
    if (typeof w === "string" && w.includes(substring)) return true;
  }
  return false;
}

/* ────────────────────────────── B1 ────────────────────────────── */

/**
 * Compute B1 = live_score - fundamental_score (clamped to [0, 100]).
 *
 * Fail-open contract:
 *   - If `liveScore` is null/NaN → returns null and a fail-open reason.
 *   - If `fundamentalScore` is null/NaN → subtraction skipped (subtracts 0),
 *     fail-open reason emitted, B1 == live_score.
 */
export function computeShadowB1(row: SwingScanRowForShadow): {
  b1ShadowScore: number | null;
  reasons: ShadowReason[];
  missingFields: string[];
} {
  const reasons: ShadowReason[] = [];
  const missingFields: string[] = [];

  const live = toNumOrNull(row.liveScore);
  const fund = toNumOrNull(row.fundamentalScore);

  if (live === null) {
    missingFields.push("liveScore");
    reasons.push({
      code: "B1_LIVE_SCORE_MISSING_FAIL_OPEN",
      delta: 0,
      note: "live score is null/NaN; B1 cannot be computed (fail-open)",
    });
    return { b1ShadowScore: null, reasons, missingFields };
  }

  let subtracted = 0;
  if (fund === null) {
    missingFields.push("fundamentalScore");
    reasons.push({
      code: "B1_FUNDAMENTAL_MISSING_FAIL_OPEN",
      delta: 0,
      note: "fundamental_score is null/NaN; B1 falls open to live score (no subtraction)",
    });
  } else {
    subtracted = fund;
    reasons.push({
      code: "B1_FUNDAMENTAL_REMOVED",
      delta: -fund,
      note: `subtracted full fundamental_score (${fund.toFixed(2)}) per H8-locked B1 formula`,
    });
  }

  const raw = live - subtracted;
  const { clamped, clampedLow, clampedHigh } = clamp01_100(raw);
  if (clampedLow) {
    reasons.push({
      code: "B1_CLAMPED_LOW",
      delta: clamped - raw,
      note: `raw B1 (${raw.toFixed(2)}) clamped up to ${SHADOW_SCORE_MIN}`,
    });
  } else if (clampedHigh) {
    reasons.push({
      code: "B1_CLAMPED_HIGH",
      delta: clamped - raw,
      note: `raw B1 (${raw.toFixed(2)}) clamped down to ${SHADOW_SCORE_MAX}`,
    });
  }

  return { b1ShadowScore: clamped, reasons, missingFields };
}

/* ────────────────────────────── B3 ────────────────────────────── */

/**
 * Compute B3 = B1 - extension_penalty - rs_weak_penalty (clamped to [0, 100]).
 *
 * Each component contributes 0 (with a fail-open reason) when the
 * required input is null/NaN/missing. Unknown warning prose is silently
 * ignored — only the three verified substrings in `B3_WARNING_SUBSTRINGS`
 * count toward the penalty.
 */
export function computeShadowB3(
  row: SwingScanRowForShadow,
  b1: number,
): { b3ShadowScore: number; reasons: ShadowReason[]; missingFields: string[] } {
  const reasons: ShadowReason[] = [];
  const missingFields: string[] = [];

  reasons.push({
    code: "B3_INHERITS_B1",
    delta: 0,
    note: `B3 starts from B1 = ${b1.toFixed(2)}`,
  });

  let extPenalty = 0;

  // 1. RSI hot
  const rsi = toNumOrNull(row.rsi14);
  if (rsi === null) {
    missingFields.push("rsi14");
    reasons.push({
      code: "B3_RSI_MISSING_FAIL_OPEN",
      delta: 0,
      note: "rsi14 is null/NaN; RSI-hot extension contribution skipped (fail-open)",
    });
  } else if (rsi > B3_PENALTY_CONSTANTS.RSI_HOT_THRESHOLD) {
    extPenalty += B3_PENALTY_CONSTANTS.RSI_GT_70_PTS;
    reasons.push({
      code: "B3_RSI_HOT",
      delta: -B3_PENALTY_CONSTANTS.RSI_GT_70_PTS,
      note: `rsi14 (${rsi.toFixed(2)}) > ${B3_PENALTY_CONSTANTS.RSI_HOT_THRESHOLD} → −${B3_PENALTY_CONSTANTS.RSI_GT_70_PTS} pts`,
    });
  }

  // 2 + 3. Warning-driven sub-components (extended + rsi_overextended)
  const warnings = row.warnings;
  if (warnings == null) {
    missingFields.push("warnings");
    reasons.push({
      code: "B3_WARNINGS_MISSING_FAIL_OPEN",
      delta: 0,
      note: "warnings is null/undefined; warning-driven penalties skipped (fail-open)",
    });
  } else if (!isWarningArray(warnings)) {
    missingFields.push("warnings");
    reasons.push({
      code: "B3_WARNINGS_NOT_ARRAY_FAIL_OPEN",
      delta: 0,
      note: "warnings is not an array; warning-driven penalties skipped (fail-open)",
    });
  } else {
    if (warningsInclude(warnings, B3_WARNING_SUBSTRINGS.EXTENDED_FROM_EMA20)) {
      extPenalty += B3_PENALTY_CONSTANTS.WARN_EXTENDED_PTS;
      reasons.push({
        code: "B3_WARN_EXTENDED",
        delta: -B3_PENALTY_CONSTANTS.WARN_EXTENDED_PTS,
        note: `warning matched "${B3_WARNING_SUBSTRINGS.EXTENDED_FROM_EMA20}" → −${B3_PENALTY_CONSTANTS.WARN_EXTENDED_PTS} pts`,
      });
    }
    if (warningsInclude(warnings, B3_WARNING_SUBSTRINGS.RSI_OVEREXTENDED)) {
      extPenalty += B3_PENALTY_CONSTANTS.WARN_RSI_OVEREXTENDED_PTS;
      reasons.push({
        code: "B3_WARN_RSI_OVEREXTENDED",
        delta: -B3_PENALTY_CONSTANTS.WARN_RSI_OVEREXTENDED_PTS,
        note: `warning matched "${B3_WARNING_SUBSTRINGS.RSI_OVEREXTENDED}" → −${B3_PENALTY_CONSTANTS.WARN_RSI_OVEREXTENDED_PTS} pts`,
      });
    }
  }

  // 4. Near-52w-high
  const pct52h = toNumOrNull(row.pctFrom52wHigh);
  if (pct52h === null) {
    missingFields.push("pctFrom52wHigh");
    reasons.push({
      code: "B3_PCT_52W_HIGH_MISSING_FAIL_OPEN",
      delta: 0,
      note: "pctFrom52wHigh is null/NaN; near-52w-high contribution skipped (fail-open)",
    });
  } else if (Math.abs(pct52h) <= B3_PENALTY_CONSTANTS.NEAR_52W_HIGH_THRESHOLD_PCT) {
    extPenalty += B3_PENALTY_CONSTANTS.NEAR_52W_HIGH_PTS;
    reasons.push({
      code: "B3_NEAR_52W_HIGH",
      delta: -B3_PENALTY_CONSTANTS.NEAR_52W_HIGH_PTS,
      note: `|pctFrom52wHigh| (${Math.abs(pct52h).toFixed(2)}) ≤ ${B3_PENALTY_CONSTANTS.NEAR_52W_HIGH_THRESHOLD_PCT}% → −${B3_PENALTY_CONSTANTS.NEAR_52W_HIGH_PTS} pts`,
    });
  }

  // 5. RS-weak (only if warnings array is usable)
  let rsWeakPenalty = 0;
  if (isWarningArray(warnings) && warningsInclude(warnings, B3_WARNING_SUBSTRINGS.RS_WEAK)) {
    rsWeakPenalty = B3_PENALTY_CONSTANTS.RS_WEAK_PTS;
    reasons.push({
      code: "B3_WARN_RS_WEAK",
      delta: -B3_PENALTY_CONSTANTS.RS_WEAK_PTS,
      note: `warning matched "${B3_WARNING_SUBSTRINGS.RS_WEAK}" → −${B3_PENALTY_CONSTANTS.RS_WEAK_PTS} pts`,
    });
  }

  const raw = b1 - extPenalty - rsWeakPenalty;
  const { clamped, clampedLow, clampedHigh } = clamp01_100(raw);
  if (clampedLow) {
    reasons.push({
      code: "B3_CLAMPED_LOW",
      delta: clamped - raw,
      note: `raw B3 (${raw.toFixed(2)}) clamped up to ${SHADOW_SCORE_MIN}`,
    });
  } else if (clampedHigh) {
    reasons.push({
      code: "B3_CLAMPED_HIGH",
      delta: clamped - raw,
      note: `raw B3 (${raw.toFixed(2)}) clamped down to ${SHADOW_SCORE_MAX}`,
    });
  }

  return { b3ShadowScore: clamped, reasons, missingFields };
}

/* ────────────────────────────── Combined ────────────────────────────── */

/**
 * Compute B1 and B3 shadow scores for a single row. Never throws.
 * Never mutates `row`. Never reads I/O.
 */
export function computeShadowScores(row: SwingScanRowForShadow): ShadowScoreResult {
  const liveScoreNum = toNumOrNull(row.liveScore);
  const liveActionStr = typeof row.liveAction === "string" ? row.liveAction : null;

  const b1Out = computeShadowB1(row);

  if (b1Out.b1ShadowScore === null) {
    // Live score is missing → B1 and B3 both undefined.
    return {
      symbol: row.symbol,
      scanDate: row.scanDate,
      liveScore: liveScoreNum,
      liveAction: liveActionStr,
      b1ShadowScore: null,
      b3ShadowScore: null,
      b1Delta: null,
      b3Delta: null,
      b1Reasons: b1Out.reasons,
      b3Reasons: [],
      dataQuality: "INSUFFICIENT",
      missingFields: b1Out.missingFields,
    };
  }

  const b3Out = computeShadowB3(row, b1Out.b1ShadowScore);

  const missingFields = Array.from(new Set([...b1Out.missingFields, ...b3Out.missingFields]));
  let dataQuality: ShadowDataQuality;
  if (missingFields.length === 0) dataQuality = "OK";
  else if (missingFields.includes("liveScore")) dataQuality = "INSUFFICIENT";
  else dataQuality = "PARTIAL";

  return {
    symbol: row.symbol,
    scanDate: row.scanDate,
    liveScore: liveScoreNum,
    liveAction: liveActionStr,
    b1ShadowScore: b1Out.b1ShadowScore,
    b3ShadowScore: b3Out.b3ShadowScore,
    b1Delta: liveScoreNum !== null ? b1Out.b1ShadowScore - liveScoreNum : null,
    b3Delta: liveScoreNum !== null ? b3Out.b3ShadowScore - liveScoreNum : null,
    b1Reasons: b1Out.reasons,
    b3Reasons: b3Out.reasons,
    dataQuality,
    missingFields,
  };
}

/* ────────────────────────────── Warning-code verification ────────────────────────────── */

export interface WarningCodeVerificationResult {
  /** Total `warnings` arrays inspected. */
  rowsInspected: number;
  /** Distinct prose strings seen across all inspected rows. */
  distinctStrings: string[];
  /** Substring → count of rows that contained at least one matching string. */
  matchCounts: Record<keyof typeof B3_WARNING_SUBSTRINGS, number>;
  /**
   * Strings seen at least once that did NOT match any B3 substring AND
   * did not match any of the known non-B3 prose. Future-proof: surfaces
   * scanner-emitted strings the module is unaware of so a human can
   * decide whether they should map to a B3 component.
   */
  unrecognizedStrings: string[];
  /**
   * Convenience verdict: TRUE iff at least one row matched each of the
   * three B3 substrings (proving the prose has not silently drifted).
   * The caller should treat FALSE as "B3 penalties may be silently 0".
   */
  allSubstringsObserved: boolean;
}

/**
 * Known prose emitted by `swingScanner.ts` that is NOT consumed by B3
 * (verified L978-L1068 snapshot, extended 2026-05-28 after H10b production
 * sample verification across 10 scan dates / ~4,765 rows).
 *
 * Additions on 2026-05-28:
 *   - "Large opening gap"      — dynamic emission from candle / risk helper
 *   - "Upper-wick rejection"   — dynamic emission from candle helper
 *
 * Both were observed in every production scan date sampled but had no
 * static literal in `swingScanner.ts` to grep for. They are NOT B3
 * penalties — B3 stays scoped to the three substrings in
 * `B3_WARNING_SUBSTRINGS`. Cataloguing them here keeps `verifyWarningCodes`
 * able to flag genuinely-novel future drift without false alarms.
 */
export const KNOWN_NON_B3_WARNING_SUBSTRINGS = Object.freeze([
  "Below EMA200",
  "Bearish structure",
  "ADX low",
  "Weekly trend weak",
  "Price is inside supply",
  "Liquidity low",
  "Market index context weak",
  "R:R moderate",
  "R:R weak",
  "Stop distance wide versus ATR",
  "Large opening gap",
  "Upper-wick rejection",
] as const);

/**
 * Inspect a sample of `warnings` arrays and report which of the three
 * B3 substrings are present (proving the prose has not drifted) and
 * which novel strings have appeared that the module is unaware of.
 *
 * Pure / read-only. Does NOT touch the DB. The caller is responsible
 * for selecting the sample (e.g. `SELECT warnings FROM swing_scan_result
 * WHERE scan_date > now() - interval '30 days'`).
 */
export function verifyWarningCodes(
  sample: ReadonlyArray<readonly unknown[] | null | undefined>,
): WarningCodeVerificationResult {
  const distinct = new Set<string>();
  const matchCounts = {
    EXTENDED_FROM_EMA20: 0,
    RSI_OVEREXTENDED: 0,
    RS_WEAK: 0,
  } as Record<keyof typeof B3_WARNING_SUBSTRINGS, number>;

  let inspected = 0;
  for (const arr of sample) {
    if (!isWarningArray(arr)) continue;
    inspected++;
    let hitExt = false;
    let hitRsi = false;
    let hitRs = false;
    for (const w of arr) {
      if (typeof w !== "string") continue;
      distinct.add(w);
      if (!hitExt && w.includes(B3_WARNING_SUBSTRINGS.EXTENDED_FROM_EMA20)) hitExt = true;
      if (!hitRsi && w.includes(B3_WARNING_SUBSTRINGS.RSI_OVEREXTENDED)) hitRsi = true;
      if (!hitRs && w.includes(B3_WARNING_SUBSTRINGS.RS_WEAK)) hitRs = true;
    }
    if (hitExt) matchCounts.EXTENDED_FROM_EMA20++;
    if (hitRsi) matchCounts.RSI_OVEREXTENDED++;
    if (hitRs) matchCounts.RS_WEAK++;
  }

  const allKnown = [
    ...Object.values(B3_WARNING_SUBSTRINGS),
    ...KNOWN_NON_B3_WARNING_SUBSTRINGS,
  ];
  const unrecognized = [...distinct]
    .filter((s) => !allKnown.some((k) => s.includes(k)))
    .sort();

  return {
    rowsInspected: inspected,
    distinctStrings: [...distinct].sort(),
    matchCounts,
    unrecognizedStrings: unrecognized,
    allSubstringsObserved:
      matchCounts.EXTENDED_FROM_EMA20 > 0 &&
      matchCounts.RSI_OVEREXTENDED > 0 &&
      matchCounts.RS_WEAK > 0,
  };
}
