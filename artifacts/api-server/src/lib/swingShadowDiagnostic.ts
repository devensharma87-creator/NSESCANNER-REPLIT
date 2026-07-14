/**
 * H10b — Pure aggregator for the owner-only swing-shadow-score diagnostic.
 *
 * Consumes already-loaded rows from `swing_scan_result` and produces the
 * response payload for `GET /api/stocks-to-watch/diagnostics/swing-shadow-score`.
 *
 * STRICT GUARANTEES (mirroring `swingShadowScore.ts`):
 *   - PURE FUNCTION. No DB, no Kite, no Yahoo, no fetch, no scheduler,
 *     no I/O, no fs, no clock side-effects beyond a string passed in.
 *   - READ-ONLY. Never mutates input rows.
 *   - SHADOW-ONLY. Returns derived scores alongside the live row's score /
 *     action verbatim. Does NOT recompute, replace, or "promote" the
 *     live action; promotion/demotion labels in the payload are
 *     observational only — they do not change anything.
 *   - BOUNDED. All lists are capped at `LIST_CAP = 25`.
 *
 * This module is the only consumer of `computeShadowScores` /
 * `verifyWarningCodes` in the runtime. It is itself only imported by
 * the owner-only route handler.
 *
 * Memoization: small process-local TTL cache (5 min) keyed by scan_date
 * + row-count. The route fills it; the pure function below does not
 * touch global state.
 */

import {
  computeShadowScores,
  verifyWarningCodes,
  type ShadowScoreResult,
  type ShadowDataQuality,
  type WarningCodeVerificationResult,
} from "./swingShadowScore";

/** Per-row DB shape this module consumes. */
export interface ShadowDiagnosticInputRow {
  symbol: string;
  scanDate: string;
  /** Live aggregate score; drizzle numeric arrives as string. */
  score: number | string | null | undefined;
  /** Live action label as persisted (verbatim). */
  action: string | null | undefined;
  sector: string | null | undefined;
  industry: string | null | undefined;
  /** Live fundamental sub-score (subtracted in B1). */
  fundamentalScore: number | string | null | undefined;
  rsi14: number | string | null | undefined;
  pctFrom52wHigh: number | string | null | undefined;
  warnings: readonly unknown[] | null | undefined;
}

/** Per-row payload row. */
export interface ShadowDiagnosticRowOut {
  symbol: string;
  sector: string | null;
  industry: string | null;
  liveScore: number | null;
  liveAction: string | null;
  b1ShadowScore: number | null;
  b3ShadowScore: number | null;
  b1Delta: number | null;
  b3Delta: number | null;
  b1Reasons: ShadowScoreResult["b1Reasons"];
  b3Reasons: ShadowScoreResult["b3Reasons"];
  dataQuality: ShadowDataQuality;
  missingFields: string[];
}

export interface ShadowScoreSummary {
  rowsScored: number;
  rowsNull: number;
  /** Average score across rows where it is non-null. */
  mean: number | null;
  /** Sample standard deviation across rows where it is non-null. */
  stddev: number | null;
  min: number | null;
  max: number | null;
}

export interface DeltaDistribution {
  bins: Array<{ rangeFromInclusive: number; rangeToExclusive: number; count: number }>;
  negativeCount: number;
  zeroCount: number;
  positiveCount: number;
}

export interface DataQualitySummary {
  ok: number;
  partial: number;
  insufficient: number;
}

export interface ShadowDiagnosticPayload {
  generatedAt: string;
  featureFlagEnabled: true;
  scanDate: string | null;
  totalRows: number;
  /** Documented hard cap used for every list field below. */
  listCap: number;
  /** Threshold used to define "high score" rows considered for demotion. */
  highScoreThreshold: number;
  warningVerification: WarningCodeVerificationResult;
  b1Summary: ShadowScoreSummary;
  b3Summary: ShadowScoreSummary;
  /** Top N by live score (verbatim from DB; reference list). */
  topByLive: ShadowDiagnosticRowOut[];
  /** Top N by B1 shadow score. */
  topByB1: ShadowDiagnosticRowOut[];
  /** Top N by B3 shadow score. */
  topByB3: ShadowDiagnosticRowOut[];
  /** Rows whose B1 score is meaningfully higher than live (B1 delta > 0). */
  promotedByB1: ShadowDiagnosticRowOut[];
  /** Rows whose B1 score is meaningfully lower than live (B1 delta < 0). */
  demotedByB1: ShadowDiagnosticRowOut[];
  promotedByB3: ShadowDiagnosticRowOut[];
  demotedByB3: ShadowDiagnosticRowOut[];
  /** Live score ≥ threshold but B1 or B3 shadow demotes by a meaningful amount. */
  highScoreDemotedByShadow: ShadowDiagnosticRowOut[];
  /** Live action AVOID but B1 or B3 shadow promotes by a meaningful amount. */
  avoidPromotedByShadow: ShadowDiagnosticRowOut[];
  b1DeltaDistribution: DeltaDistribution;
  b3DeltaDistribution: DeltaDistribution;
  dataQuality: DataQualitySummary;
}

/* ────────────────────────── Constants ────────────────────────── */

/** Hard cap on every list in the payload. */
export const LIST_CAP = 25;
/** "High score" floor used for `highScoreDemotedByShadow`. */
export const HIGH_SCORE_THRESHOLD = 60;
/** Minimum |delta| to call a row "promoted" or "demoted" (avoids float noise). */
export const PROMOTION_DELTA_EPSILON = 1;
/** Live action labels treated as "avoid" for the avoid→promote bucket. */
const AVOID_ACTIONS = new Set<string>(["AVOID", "AVOID — RISK"]);
/** Memo TTL (ms). */
export const MEMO_TTL_MS = 5 * 60 * 1000;

/* ────────────────────────── Helpers ────────────────────────── */

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

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function summariseScores(values: ReadonlyArray<number | null>): ShadowScoreSummary {
  const present: number[] = [];
  let nulls = 0;
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) {
      nulls++;
      continue;
    }
    present.push(v);
  }
  if (present.length === 0) {
    return { rowsScored: 0, rowsNull: nulls, mean: null, stddev: null, min: null, max: null };
  }
  const sum = present.reduce((a, b) => a + b, 0);
  const mean = sum / present.length;
  const variance =
    present.length === 1
      ? 0
      : present.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (present.length - 1);
  return {
    rowsScored: present.length,
    rowsNull: nulls,
    mean: round2(mean),
    stddev: round2(Math.sqrt(variance)),
    min: round2(Math.min(...present)),
    max: round2(Math.max(...present)),
  };
}

const DELTA_BINS: ReadonlyArray<[number, number]> = [
  [-Infinity, -20],
  [-20, -10],
  [-10, -5],
  [-5, -1],
  [-1, 0],
  [0, 1],
  [1, 5],
  [5, 10],
  [10, 20],
  [20, Infinity],
];

function bucketDeltas(deltas: ReadonlyArray<number | null>): DeltaDistribution {
  const bins = DELTA_BINS.map(([lo, hi]) => ({
    rangeFromInclusive: lo,
    rangeToExclusive: hi,
    count: 0,
  }));
  let neg = 0;
  let zero = 0;
  let pos = 0;
  for (const d of deltas) {
    if (d == null || !Number.isFinite(d)) continue;
    if (d < 0) neg++;
    else if (d === 0) zero++;
    else pos++;
    for (let i = 0; i < DELTA_BINS.length; i++) {
      const [lo, hi] = DELTA_BINS[i]!;
      if (d >= lo && d < hi) {
        bins[i]!.count++;
        break;
      }
    }
  }
  return { bins, negativeCount: neg, zeroCount: zero, positiveCount: pos };
}

function projectRow(
  input: ShadowDiagnosticInputRow,
  scored: ShadowScoreResult,
): ShadowDiagnosticRowOut {
  return {
    symbol: input.symbol,
    sector: input.sector ?? null,
    industry: input.industry ?? null,
    liveScore: scored.liveScore,
    liveAction: scored.liveAction,
    b1ShadowScore: scored.b1ShadowScore,
    b3ShadowScore: scored.b3ShadowScore,
    b1Delta: scored.b1Delta,
    b3Delta: scored.b3Delta,
    b1Reasons: scored.b1Reasons,
    b3Reasons: scored.b3Reasons,
    dataQuality: scored.dataQuality,
    missingFields: scored.missingFields,
  };
}

/** Stable sort: primary key (numeric, missing = -Infinity for desc); tiebreaker = symbol asc. */
function sortDescBy(
  rows: ShadowDiagnosticRowOut[],
  key: (r: ShadowDiagnosticRowOut) => number | null,
): ShadowDiagnosticRowOut[] {
  return rows.slice().sort((a, b) => {
    const ka = key(a) ?? -Infinity;
    const kb = key(b) ?? -Infinity;
    if (kb !== ka) return kb - ka;
    return a.symbol.localeCompare(b.symbol);
  });
}

function sortAscBy(
  rows: ShadowDiagnosticRowOut[],
  key: (r: ShadowDiagnosticRowOut) => number | null,
): ShadowDiagnosticRowOut[] {
  return rows.slice().sort((a, b) => {
    const ka = key(a) ?? Infinity;
    const kb = key(b) ?? Infinity;
    if (ka !== kb) return ka - kb;
    return a.symbol.localeCompare(b.symbol);
  });
}

/* ────────────────────────── Main builder ────────────────────────── */

/**
 * Build the diagnostic payload from already-loaded rows.
 *
 * The caller is responsible for filtering rows to the latest `scan_date`
 * before calling. `scanDate` is reported verbatim in the response.
 */
export function buildShadowDiagnostic(opts: {
  generatedAt: string;
  scanDate: string | null;
  rows: ReadonlyArray<ShadowDiagnosticInputRow>;
}): ShadowDiagnosticPayload {
  const { generatedAt, scanDate, rows } = opts;

  // 1. Score every row (pure).
  const scored = rows.map((r) => ({
    input: r,
    result: computeShadowScores({
      symbol: r.symbol,
      scanDate: r.scanDate,
      liveScore: r.score,
      liveAction: r.action,
      fundamentalScore: r.fundamentalScore,
      rsi14: r.rsi14,
      pctFrom52wHigh: r.pctFrom52wHigh,
      warnings: r.warnings,
    }),
  }));

  const projected = scored.map(({ input, result }) => projectRow(input, result));

  // 2. Warning verification (over the raw warnings arrays).
  const warningVerification = verifyWarningCodes(rows.map((r) => r.warnings));

  // 3. Per-score summaries.
  const b1Summary = summariseScores(projected.map((r) => r.b1ShadowScore));
  const b3Summary = summariseScores(projected.map((r) => r.b3ShadowScore));

  // 4. Top lists (descending; nulls sink).
  const topByLive = sortDescBy(projected, (r) => r.liveScore).slice(0, LIST_CAP);
  const topByB1 = sortDescBy(projected, (r) => r.b1ShadowScore).slice(0, LIST_CAP);
  const topByB3 = sortDescBy(projected, (r) => r.b3ShadowScore).slice(0, LIST_CAP);

  // 5. Promotion / demotion buckets.
  const meaningful = (d: number | null): boolean =>
    d != null && Number.isFinite(d) && Math.abs(d) >= PROMOTION_DELTA_EPSILON;

  const promotedByB1Pool = projected.filter((r) => meaningful(r.b1Delta) && (r.b1Delta ?? 0) > 0);
  const demotedByB1Pool = projected.filter((r) => meaningful(r.b1Delta) && (r.b1Delta ?? 0) < 0);
  const promotedByB3Pool = projected.filter((r) => meaningful(r.b3Delta) && (r.b3Delta ?? 0) > 0);
  const demotedByB3Pool = projected.filter((r) => meaningful(r.b3Delta) && (r.b3Delta ?? 0) < 0);

  const promotedByB1 = sortDescBy(promotedByB1Pool, (r) => r.b1Delta).slice(0, LIST_CAP);
  const demotedByB1 = sortAscBy(demotedByB1Pool, (r) => r.b1Delta).slice(0, LIST_CAP);
  const promotedByB3 = sortDescBy(promotedByB3Pool, (r) => r.b3Delta).slice(0, LIST_CAP);
  const demotedByB3 = sortAscBy(demotedByB3Pool, (r) => r.b3Delta).slice(0, LIST_CAP);

  // 6. High-score-demoted / AVOID-promoted cross-cuts.
  const highScoreDemotedByShadow = sortAscBy(
    projected.filter((r) => {
      if (r.liveScore == null || r.liveScore < HIGH_SCORE_THRESHOLD) return false;
      return (
        (meaningful(r.b1Delta) && (r.b1Delta ?? 0) < 0) ||
        (meaningful(r.b3Delta) && (r.b3Delta ?? 0) < 0)
      );
    }),
    (r) => Math.min(r.b1Delta ?? 0, r.b3Delta ?? 0),
  ).slice(0, LIST_CAP);

  const avoidPromotedByShadow = sortDescBy(
    projected.filter((r) => {
      if (!r.liveAction || !AVOID_ACTIONS.has(r.liveAction)) return false;
      return (
        (meaningful(r.b1Delta) && (r.b1Delta ?? 0) > 0) ||
        (meaningful(r.b3Delta) && (r.b3Delta ?? 0) > 0)
      );
    }),
    (r) => Math.max(r.b1Delta ?? 0, r.b3Delta ?? 0),
  ).slice(0, LIST_CAP);

  // 7. Delta distributions.
  const b1DeltaDistribution = bucketDeltas(projected.map((r) => r.b1Delta));
  const b3DeltaDistribution = bucketDeltas(projected.map((r) => r.b3Delta));

  // 8. Data quality histogram.
  const dataQuality: DataQualitySummary = { ok: 0, partial: 0, insufficient: 0 };
  for (const r of projected) {
    if (r.dataQuality === "OK") dataQuality.ok++;
    else if (r.dataQuality === "PARTIAL") dataQuality.partial++;
    else dataQuality.insufficient++;
  }

  return {
    generatedAt,
    featureFlagEnabled: true,
    scanDate,
    totalRows: rows.length,
    listCap: LIST_CAP,
    highScoreThreshold: HIGH_SCORE_THRESHOLD,
    warningVerification,
    b1Summary,
    b3Summary,
    topByLive,
    topByB1,
    topByB3,
    promotedByB1,
    demotedByB1,
    promotedByB3,
    demotedByB3,
    highScoreDemotedByShadow,
    avoidPromotedByShadow,
    b1DeltaDistribution,
    b3DeltaDistribution,
    dataQuality,
  };
}

/* ────────────────────────── Feature flag ────────────────────────── */

/**
 * Reads `SWING_SHADOW_DIAG_ENABLED`. Default: ENABLED.
 *
 * Recognised "off": `"0" | "false" | "no" | "off"` (case-insensitive,
 * trimmed). Anything else → enabled. Owner-only gate on the route is
 * the actual safety boundary; this flag is the operator kill switch.
 */
export function isSwingShadowDiagEnabled(): boolean {
  const raw = process.env["SWING_SHADOW_DIAG_ENABLED"];
  if (raw == null) return true;
  const v = String(raw).trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return true;
}

/* ────────────────────────── Memoization ────────────────────────── */

interface MemoEntry {
  key: string;
  payload: ShadowDiagnosticPayload;
  expiresAt: number;
}

let memo: MemoEntry | null = null;

/** Construct a stable cache key from inputs. */
export function memoKey(scanDate: string | null, totalRows: number): string {
  return `${scanDate ?? "NULL"}|${totalRows}`;
}

/** Return cached payload if not expired and key matches. */
export function getMemoizedPayload(now: number, key: string): ShadowDiagnosticPayload | null {
  if (memo == null) return null;
  if (memo.key !== key) return null;
  if (memo.expiresAt <= now) return null;
  return memo.payload;
}

/** Write payload to the memo with TTL. */
export function setMemoizedPayload(
  now: number,
  key: string,
  payload: ShadowDiagnosticPayload,
): void {
  memo = { key, payload, expiresAt: now + MEMO_TTL_MS };
}

/** Test-only reset. */
export function __resetShadowDiagnosticMemoForTests(): void {
  memo = null;
}
