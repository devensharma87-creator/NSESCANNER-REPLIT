/**
 * reportsView.ts — pure, deterministic view-helper layer for the future
 * `/paper-reports` pro-analytics upgrade (W4).
 *
 * STRICT CONTRACT (W4-P1):
 *   - No React, no fetch, no DB, no route calls, no I/O of any kind.
 *   - Every function is deterministic and side-effect free.
 *   - Inputs are NEVER mutated (arrays are copied before sort, objects are
 *     read-only).
 *   - We model ONLY fields that already exist on the live payloads from:
 *       /api/paper/reports/fo/(monthly|yearly)
 *       /api/paper/reports/eq/(monthly|yearly)
 *       /api/paper/trades/(fo|eq)
 *       /api/paper/analytics/fo
 *       /api/paper/journal-analytics
 *       /api/paper/analytics/fo/shadow-exits
 *       /api/paper/account
 *   - When a field is absent we surface `null`, `"—"`, or an empty
 *     collection — we NEVER fabricate a value (e.g. no synthetic index for
 *     equity rows, no MFE/MAE computed from closed-trade payloads, no
 *     made-up averages).
 *
 * This module renders nothing and wires nothing — it is the helper/test
 * substrate only. UI wiring lands in later W4 phases.
 */

// ---------------------------------------------------------------------------
// 1. Safe numeric / date primitives
// ---------------------------------------------------------------------------

/**
 * Coerce an unknown value into a finite number, or `null` when it is missing
 * or malformed. Accepts numbers and numeric strings; trims whitespace; never
 * throws; never mutates.
 */
export function toNum(v: unknown): number | null {
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

/** Coerce to a number with an explicit fallback when missing/malformed. */
export function toNumOr(v: unknown, fallback: number): number {
  const n = toNum(v);
  return n == null ? fallback : n;
}

/**
 * Parse a timestamp (ISO string, epoch number, or Date) into epoch
 * milliseconds, or `null` when missing/unparseable. Never throws.
 */
export function parseTs(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v instanceof Date) {
    const ms = v.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    const ms = Date.parse(t);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

/**
 * Percentage of `part` over `whole`, in the 0..100 domain. Returns `null`
 * when either side is missing/malformed or when `whole` is zero (no divide
 * by zero, no Infinity leak).
 */
export function safePct(part: unknown, whole: unknown): number | null {
  const p = toNum(part);
  const w = toNum(whole);
  if (p == null || w == null || w === 0) return null;
  return (p / w) * 100;
}

/** Sum the finite numbers in a list, ignoring null/undefined/malformed. */
export function sumNums(values: readonly unknown[]): number {
  let acc = 0;
  for (const v of values) {
    const n = toNum(v);
    if (n != null) acc += n;
  }
  return acc;
}

/** Mean of the finite numbers in a list, or `null` when none are valid. */
export function avgNums(values: readonly unknown[]): number | null {
  let acc = 0;
  let count = 0;
  for (const v of values) {
    const n = toNum(v);
    if (n != null) {
      acc += n;
      count += 1;
    }
  }
  return count > 0 ? acc / count : null;
}

/**
 * Clamp a value into `[min, max]`. Either bound may be omitted. Returns
 * `null` when the value is missing/malformed.
 */
export function clampNumber(
  value: unknown,
  min?: number | null,
  max?: number | null,
): number | null {
  let n = toNum(value);
  if (n == null) return null;
  if (min != null && n < min) n = min;
  if (max != null && n > max) n = max;
  return n;
}

// ---------------------------------------------------------------------------
// Internal string/date helpers
// ---------------------------------------------------------------------------

/** Non-empty trimmed string, or `null`. */
function strOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Extract a `YYYY-MM-DD` day key from a date-like value, or `null`.
 * Pure `YYYY-MM-DD` strings are taken verbatim (no timezone shift); full
 * ISO timestamps are normalised to their UTC day deterministically.
 */
export function dateKeyOf(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(t);
    if (m) return m[1] as string;
    const ms = Date.parse(t);
    return Number.isNaN(ms) ? null : isoDay(ms);
  }
  if (typeof v === "number" && Number.isFinite(v)) return isoDay(v);
  if (v instanceof Date) {
    const ms = v.getTime();
    return Number.isNaN(ms) ? null : isoDay(ms);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Structural payload mirrors (read-only subsets of the live responses).
// These are intentionally loose: only the fields the helpers consume.
// ---------------------------------------------------------------------------

export interface ReportTotalsLike {
  realizedPnl?: number | null;
  netPnl?: number | null;
  charges?: number | null;
  tradeCount?: number | null;
  wins?: number | null;
  losses?: number | null;
  winRatePct?: number | null;
  avgWin?: number | null;
  avgLoss?: number | null;
  bestTrade?: number | null;
  worstTrade?: number | null;
  avgRMultiple?: number | null;
  profitFactor?: number | null;
  expectancy?: number | null;
}

export interface ReportWithTotalsLike {
  totals?: ReportTotalsLike | null;
}

export interface EquityCurvePointLike {
  date?: string | null;
  dailyPnl?: number | null;
  cumulativePnl?: number | null;
  drawdown?: number | null;
}

export interface FoAnalyticsLike {
  totalTrades?: number | null;
  wins?: number | null;
  losses?: number | null;
  scratches?: number | null;
  winRate?: number | null; // 0..1
  totalRealizedPnl?: number | null;
  avgWin?: number | null;
  avgLoss?: number | null;
  largestWin?: number | null;
  largestLoss?: number | null;
  profitFactor?: number | null;
  expectancy?: number | null;
  avgRMultiple?: number | null;
  maxDrawdown?: number | null;
  currentDrawdown?: number | null;
  peakEquity?: number | null;
  equityCurve?: EquityCurvePointLike[] | null;
}

export interface AccountLike {
  realizedPnl?: number | null;
  lifetimeRealizedPnl?: number | null;
}

export interface ShadowExitTradeRowLike {
  id?: string;
  signalDate?: string | null;
  indexSymbol?: string | null;
  setupKey?: string | null;
  tier?: string | null;
  direction?: string | null;
  exitReason?: string | null;
  lots?: number | null;
  lotSize?: number | null;
  entryPremium?: number | null;
  exitPremium?: number | null;
  mfeAbs?: number | null;
  mfeAvailable?: boolean | null;
  actualPnl?: number | null;
  bestDelta?: number | null;
}

export interface ShadowExitReportLike {
  enabled?: boolean | null;
  mfeAvailableCount?: number | null;
  rawRowCount?: number | null;
  processedRowCount?: number | null;
  lowSampleWarning?: boolean | null;
  lowSampleThreshold?: number | null;
  improvedTopN?: ShadowExitTradeRowLike[] | null;
  reducedTopN?: ShadowExitTradeRowLike[] | null;
}

// ---------------------------------------------------------------------------
// Normalised report row — the common shape filters/sort/group/CSV consume.
// "Variable" fields are optional so a missing field is genuinely absent
// (used to enforce the no-fabrication rule, e.g. equity rows have no index).
// ---------------------------------------------------------------------------

export type ReportSegment = "FNO" | "EQUITY";

export interface NormalizedReportRow {
  id: string;
  segment?: ReportSegment;
  signalDate?: string | null;
  exitedAt?: string | null;
  setupKey?: string | null;
  /** indexSymbol for F&O, symbol for equity. Absent when neither exists. */
  index?: string | null;
  indexName?: string | null;
  direction?: string | null;
  exitReason?: string | null;
  realizedPnl?: number | null;
  netPnl?: number | null;
  charges?: number | null;
  rMultiple?: number | null;
  /** Seconds in trade (F&O). */
  durationSec?: number | null;
  /** Calendar days held (equity). */
  daysHeld?: number | null;
  /** Maximum favourable excursion — ONLY ever set from shadow-exit rows. */
  mfe?: number | null;
  /** Maximum adverse excursion — not tracked by any current payload. */
  mae?: number | null;
  tags?: string[] | null;
  journal?: string | null;
  [key: string]: unknown;
}

/** F&O trade-detail row subset (from /paper/trades/fo & report `trades[]`). */
export interface FoTradeRowLike {
  id?: string;
  signalDate?: string | null;
  exitedAt?: string | null;
  indexSymbol?: string | null;
  indexName?: string | null;
  setupKey?: string | null;
  direction?: string | null;
  exitReason?: string | null;
  realizedPnl?: number | null;
  netPnl?: number | null;
  charges?: number | null;
  rMultiple?: number | null;
  durationSec?: number | null;
  tags?: string[] | null;
  journal?: string | null;
}

/** Equity trade-detail row subset (from /paper/trades/eq & report `trades[]`). */
export interface EqTradeRowLike {
  id?: string;
  signalDate?: string | null;
  exitedAt?: string | null;
  symbol?: string | null;
  name?: string | null;
  exchange?: string | null;
  setupKey?: string | null;
  exitReason?: string | null;
  realizedPnl?: number | null;
  netPnl?: number | null;
  charges?: number | null;
  rMultiple?: number | null;
  daysHeld?: number | null;
  tags?: string[] | null;
  journal?: string | null;
}

/** Normalise an F&O trade-detail row. `index` ← indexSymbol. No fabrication. */
export function normalizeFoTradeRow(r: FoTradeRowLike): NormalizedReportRow {
  const out: NormalizedReportRow = {
    id: r.id ?? "",
    segment: "FNO",
    signalDate: r.signalDate ?? null,
    exitedAt: r.exitedAt ?? null,
    setupKey: r.setupKey ?? null,
    index: r.indexSymbol ?? null,
    indexName: r.indexName ?? null,
    direction: r.direction ?? null,
    exitReason: r.exitReason ?? null,
    realizedPnl: toNum(r.realizedPnl),
    netPnl: toNum(r.netPnl),
    charges: toNum(r.charges),
    rMultiple: toNum(r.rMultiple),
    durationSec: toNum(r.durationSec),
  };
  if (Array.isArray(r.tags)) out.tags = r.tags.slice();
  if (r.journal != null) out.journal = r.journal;
  return out;
}

/** Normalise an equity trade-detail row. `index` ← symbol. No fabrication. */
export function normalizeEqTradeRow(r: EqTradeRowLike): NormalizedReportRow {
  const out: NormalizedReportRow = {
    id: r.id ?? "",
    segment: "EQUITY",
    signalDate: r.signalDate ?? null,
    exitedAt: r.exitedAt ?? null,
    setupKey: r.setupKey ?? null,
    index: r.symbol ?? null,
    indexName: r.name ?? null,
    exitReason: r.exitReason ?? null,
    realizedPnl: toNum(r.realizedPnl),
    netPnl: toNum(r.netPnl),
    charges: toNum(r.charges),
    rMultiple: toNum(r.rMultiple),
    daysHeld: toNum(r.daysHeld),
  };
  if (Array.isArray(r.tags)) out.tags = r.tags.slice();
  if (r.journal != null) out.journal = r.journal;
  return out;
}

// ---------------------------------------------------------------------------
// 2. Report summary helpers
// ---------------------------------------------------------------------------

export interface ReportsOverviewAvailability {
  foAnalytics: boolean;
  foReport: boolean;
  eqReport: boolean;
  eqAnalytics: boolean;
  shadowExits: boolean;
  foAccount: boolean;
  eqAccount: boolean;
}

export interface ReportsOverviewSummary {
  foRealizedPnl: number | null;
  eqRealizedPnl: number | null;
  totalRealizedPnl: number | null;
  foWinRatePct: number | null; // 0..100
  foProfitFactor: number | null;
  foExpectancy: number | null;
  foAvgRMultiple: number | null;
  foBestTrade: number | null;
  foWorstTrade: number | null;
  foMaxDrawdown: number | null;
  foCurrentDrawdown: number | null;
  foPeakEquity: number | null;
  avgMfe: number | null;
  avgMae: number | null;
  foTradeCount: number | null;
  foScratches: number | null;
  availability: ReportsOverviewAvailability;
}

export interface SummarizeReportsOverviewInput {
  foAnalytics?: FoAnalyticsLike | null;
  eqAnalytics?: FoAnalyticsLike | null;
  foReport?: ReportWithTotalsLike | null;
  eqReport?: ReportWithTotalsLike | null;
  foAccount?: AccountLike | null;
  eqAccount?: AccountLike | null;
  shadowExits?: ShadowExitReportLike | null;
}

/** First non-null result of the supplied accessors. */
function firstNum(...vals: unknown[]): number | null {
  for (const v of vals) {
    const n = toNum(v);
    if (n != null) return n;
  }
  return null;
}

/**
 * Derive the overview summary-card values from whatever payloads are
 * available. Missing inputs degrade to `null` fields and `false`
 * availability flags — nothing is fabricated.
 */
export function summarizeReportsOverview(
  input: SummarizeReportsOverviewInput,
): ReportsOverviewSummary {
  const {
    foAnalytics,
    eqAnalytics,
    foReport,
    eqReport,
    foAccount,
    eqAccount,
    shadowExits,
  } = input ?? {};

  const foRealizedPnl = firstNum(
    foAnalytics?.totalRealizedPnl,
    foReport?.totals?.realizedPnl,
  );
  const eqRealizedPnl = firstNum(
    eqReport?.totals?.realizedPnl,
    eqAnalytics?.totalRealizedPnl,
    eqAccount?.lifetimeRealizedPnl,
    eqAccount?.realizedPnl,
  );
  const totalRealizedPnl =
    foRealizedPnl == null && eqRealizedPnl == null
      ? null
      : (foRealizedPnl ?? 0) + (eqRealizedPnl ?? 0);

  // win rate: analytics is a 0..1 ratio; report totals already a percent.
  const foWinRatePct = (() => {
    const ratio = toNum(foAnalytics?.winRate);
    if (ratio != null) return ratio * 100;
    return toNum(foReport?.totals?.winRatePct);
  })();

  const review = deriveMfeMaeReview(shadowExits);

  return {
    foRealizedPnl,
    eqRealizedPnl,
    totalRealizedPnl,
    foWinRatePct,
    foProfitFactor: firstNum(
      foAnalytics?.profitFactor,
      foReport?.totals?.profitFactor,
    ),
    foExpectancy: firstNum(foAnalytics?.expectancy, foReport?.totals?.expectancy),
    foAvgRMultiple: firstNum(
      foAnalytics?.avgRMultiple,
      foReport?.totals?.avgRMultiple,
    ),
    foBestTrade: firstNum(foReport?.totals?.bestTrade, foAnalytics?.largestWin),
    foWorstTrade: firstNum(
      foReport?.totals?.worstTrade,
      foAnalytics?.largestLoss,
    ),
    foMaxDrawdown: toNum(foAnalytics?.maxDrawdown),
    foCurrentDrawdown: toNum(foAnalytics?.currentDrawdown),
    foPeakEquity: toNum(foAnalytics?.peakEquity),
    avgMfe: review.avgMfe,
    avgMae: review.avgMae,
    foTradeCount: firstNum(
      foAnalytics?.totalTrades,
      foReport?.totals?.tradeCount,
    ),
    foScratches: toNum(foAnalytics?.scratches),
    availability: {
      foAnalytics: foAnalytics != null,
      foReport: foReport?.totals != null,
      eqReport: eqReport?.totals != null,
      eqAnalytics: eqAnalytics != null,
      shadowExits: review.available,
      foAccount: foAccount != null,
      eqAccount: eqAccount != null,
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Date-range narrowing
// ---------------------------------------------------------------------------

export interface DateRange {
  from?: string | null; // YYYY-MM-DD inclusive
  to?: string | null; // YYYY-MM-DD inclusive
  dateField?: string; // defaults to "signalDate"
}

/**
 * Inclusive client-side date filter. When neither bound is set, returns a
 * shallow copy of all rows. When a bound is set, rows whose date is missing
 * or malformed are dropped (only valid in-range rows survive). Never mutates.
 */
export function filterReportRowsByDate<T extends Record<string, unknown>>(
  rows: readonly T[],
  range: DateRange = {},
): T[] {
  const from = strOrNull(range.from ?? null);
  const to = strOrNull(range.to ?? null);
  const field = range.dateField ?? "signalDate";
  if (from == null && to == null) return rows.slice();
  return rows.filter((r) => {
    const key = dateKeyOf(r[field]);
    if (key == null) return false;
    if (from != null && key < from) return false;
    if (to != null && key > to) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// 4. Trade filters
// ---------------------------------------------------------------------------

export type PnlSignFilter = "ALL" | "POSITIVE" | "NEGATIVE" | "FLAT";
export type JournalFilter = "ALL" | "PRESENT" | "MISSING";
export type SegmentFilter = "ALL" | ReportSegment;

export interface ReportFilters {
  segment: SegmentFilter;
  setup: string | null;
  index: string | null;
  exitReason: string | null;
  tag: string | null;
  pnlSign: PnlSignFilter;
  journal: JournalFilter;
  from: string | null;
  to: string | null;
  dateField: string;
}

export const DEFAULT_REPORT_FILTERS: ReportFilters = {
  segment: "ALL",
  setup: null,
  index: null,
  exitReason: null,
  tag: null,
  pnlSign: "ALL",
  journal: "ALL",
  from: null,
  to: null,
  dateField: "signalDate",
};

function hasJournal(row: NormalizedReportRow): boolean {
  return strOrNull(row.journal) != null;
}

/**
 * Apply the active subset of filters to the rows. Inactive predicates
 * (default values) are skipped. Rows missing the field a predicate targets
 * are excluded by that predicate (we never invent a value to keep them).
 * Pure — returns a new array.
 */
export function applyReportFilters(
  rows: readonly NormalizedReportRow[],
  filters: ReportFilters,
): NormalizedReportRow[] {
  let out = rows.slice();

  if (filters.segment !== "ALL") {
    out = out.filter((r) => r.segment === filters.segment);
  }
  if (filters.setup != null) {
    out = out.filter((r) => strOrNull(r.setupKey) === filters.setup);
  }
  if (filters.index != null) {
    out = out.filter((r) => strOrNull(r.index) === filters.index);
  }
  if (filters.exitReason != null) {
    out = out.filter((r) => strOrNull(r.exitReason) === filters.exitReason);
  }
  if (filters.tag != null) {
    const tag = filters.tag;
    out = out.filter((r) => Array.isArray(r.tags) && r.tags.includes(tag));
  }
  if (filters.pnlSign !== "ALL") {
    out = out.filter((r) => {
      const p = toNum(r.realizedPnl);
      if (p == null) return false;
      if (filters.pnlSign === "POSITIVE") return p > 0;
      if (filters.pnlSign === "NEGATIVE") return p < 0;
      return p === 0; // FLAT
    });
  }
  if (filters.journal !== "ALL") {
    out = out.filter((r) =>
      filters.journal === "PRESENT" ? hasJournal(r) : !hasJournal(r),
    );
  }
  if (filters.from != null || filters.to != null) {
    out = filterReportRowsByDate(out, {
      from: filters.from,
      to: filters.to,
      dateField: filters.dateField,
    });
  }
  return out;
}

/** Count how many filter predicates differ from the defaults. */
export function countActiveReportFilters(filters: ReportFilters): number {
  let n = 0;
  if (filters.segment !== "ALL") n += 1;
  if (filters.setup != null) n += 1;
  if (filters.index != null) n += 1;
  if (filters.exitReason != null) n += 1;
  if (filters.tag != null) n += 1;
  if (filters.pnlSign !== "ALL") n += 1;
  if (filters.journal !== "ALL") n += 1;
  if (filters.from != null || filters.to != null) n += 1;
  return n;
}

// ---------------------------------------------------------------------------
// 5. Sorting
// ---------------------------------------------------------------------------

export type ReportSortKey =
  | "date"
  | "pnl"
  | "rMultiple"
  | "setup"
  | "exitReason"
  | "symbol"
  | "duration"
  | "mfe"
  | "mae";

export type SortDir = "asc" | "desc";

function sortValue(
  row: NormalizedReportRow,
  key: ReportSortKey,
): number | string | null {
  switch (key) {
    case "date":
      return parseTs(row.signalDate ?? row.exitedAt ?? null);
    case "pnl":
      return toNum(row.realizedPnl);
    case "rMultiple":
      return toNum(row.rMultiple);
    case "setup":
      return strOrNull(row.setupKey);
    case "exitReason":
      return strOrNull(row.exitReason);
    case "symbol":
      return strOrNull(row.index);
    case "duration": {
      const d = toNum(row.durationSec);
      return d != null ? d : toNum(row.daysHeld);
    }
    case "mfe":
      return toNum(row.mfe);
    case "mae":
      return toNum(row.mae);
    default:
      return null;
  }
}

/**
 * Stable sort over a copy of the rows. `null`/`NaN`/empty keys always sort
 * last regardless of direction. Never mutates the input.
 */
export function sortReportRows(
  rows: readonly NormalizedReportRow[],
  sortKey: ReportSortKey,
  sortDir: SortDir = "desc",
): NormalizedReportRow[] {
  const copy = rows.slice();
  copy.sort((a, b) => {
    const av = sortValue(a, sortKey);
    const bv = sortValue(b, sortKey);
    const aNull = av == null;
    const bNull = bv == null;
    if (aNull && bNull) return 0;
    if (aNull) return 1; // nulls last (direction-independent)
    if (bNull) return -1;
    let c: number;
    if (typeof av === "number" && typeof bv === "number") {
      c = av - bv;
    } else {
      c = String(av).localeCompare(String(bv));
    }
    return sortDir === "asc" ? c : -c;
  });
  return copy;
}

// ---------------------------------------------------------------------------
// 6. Grouping / aggregation
// ---------------------------------------------------------------------------

export type ReportGroupBy =
  | "setup"
  | "index"
  | "exitReason"
  | "tag"
  | "pnlSign"
  | "month"
  | "segment";

export interface ReportGroup {
  key: string;
  rows: NormalizedReportRow[];
}

function pnlSignKey(row: NormalizedReportRow): string | null {
  const p = toNum(row.realizedPnl);
  if (p == null) return null;
  if (p > 0) return "POSITIVE";
  if (p < 0) return "NEGATIVE";
  return "FLAT";
}

/**
 * Group rows by a dimension, preserving first-seen key order (deterministic).
 * Rows missing the grouping field are skipped — never bucketed under a
 * fabricated key. For `tag`, a row appears once per tag it carries. If no row
 * supplies the dimension (e.g. equity rows for `index`), the result is empty.
 */
export function groupReportRows(
  rows: readonly NormalizedReportRow[],
  groupBy: ReportGroupBy,
): ReportGroup[] {
  const order: string[] = [];
  const map = new Map<string, NormalizedReportRow[]>();

  const push = (key: string, row: NormalizedReportRow) => {
    let bucket = map.get(key);
    if (!bucket) {
      bucket = [];
      map.set(key, bucket);
      order.push(key);
    }
    bucket.push(row);
  };

  for (const row of rows) {
    if (groupBy === "tag") {
      if (Array.isArray(row.tags)) {
        for (const t of row.tags) {
          const key = strOrNull(t);
          if (key != null) push(key, row);
        }
      }
      continue;
    }

    let key: string | null;
    switch (groupBy) {
      case "setup":
        key = strOrNull(row.setupKey);
        break;
      case "index":
        key = strOrNull(row.index);
        break;
      case "exitReason":
        key = strOrNull(row.exitReason);
        break;
      case "pnlSign":
        key = pnlSignKey(row);
        break;
      case "segment":
        key = row.segment ?? null;
        break;
      case "month": {
        const day = dateKeyOf(row.signalDate ?? row.exitedAt ?? null);
        key = day == null ? null : day.slice(0, 7);
        break;
      }
      default:
        key = null;
    }
    if (key != null) push(key, row);
  }

  return order.map((key) => ({ key, rows: map.get(key) as NormalizedReportRow[] }));
}

export interface ReportGroupAggregate {
  tradeCount: number;
  realizedPnl: number | null;
  wins: number;
  losses: number;
  scratches: number;
  winRatePct: number | null;
  avgPnl: number | null;
  bestTrade: number | null;
  worstTrade: number | null;
  avgMfe: number | null;
  avgMae: number | null;
}

/**
 * Aggregate a set of rows. P&L stats consider only rows with a valid
 * `realizedPnl`; win-rate is over decided (win+loss) rows and is `null` when
 * none are decided. MFE/MAE averages are `null` unless the rows actually
 * carry those fields (no fabrication from closed-trade data).
 */
export function aggregateReportGroup(
  rows: readonly NormalizedReportRow[],
): ReportGroupAggregate {
  const pnls: number[] = [];
  let wins = 0;
  let losses = 0;
  let scratches = 0;
  let best: number | null = null;
  let worst: number | null = null;
  const mfes: unknown[] = [];
  const maes: unknown[] = [];

  for (const r of rows) {
    const p = toNum(r.realizedPnl);
    if (p != null) {
      pnls.push(p);
      if (p > 0) wins += 1;
      else if (p < 0) losses += 1;
      else scratches += 1;
      best = best == null ? p : Math.max(best, p);
      worst = worst == null ? p : Math.min(worst, p);
    }
    mfes.push(r.mfe);
    maes.push(r.mae);
  }

  const decided = wins + losses;
  return {
    tradeCount: rows.length,
    realizedPnl: pnls.length > 0 ? sumNums(pnls) : null,
    wins,
    losses,
    scratches,
    winRatePct: decided > 0 ? (wins / decided) * 100 : null,
    avgPnl: avgNums(pnls),
    bestTrade: best,
    worstTrade: worst,
    avgMfe: avgNums(mfes),
    avgMae: avgNums(maes),
  };
}

// ---------------------------------------------------------------------------
// 7. MFE/MAE review (shadow-exits ONLY)
// ---------------------------------------------------------------------------

export interface MfeMaeReview {
  available: boolean;
  /** Server-reported count of rows with post-fix MFE data. */
  eligibleSampleCount: number;
  rawRowCount: number;
  processedRowCount: number;
  lowSampleWarning: boolean;
  lowSampleThreshold: number | null;
  /** Mean mfeAbs over the per-trade spotlight rows with mfeAvailable=true. */
  avgMfe: number | null;
  /** Number of per-trade rows the avgMfe was computed over. */
  avgMfeSampleCount: number;
  /** Always null: MAE is not present in any current payload. */
  avgMae: number | null;
  /** Spotlight rows where realised P&L lagged the favourable excursion. */
  giveBackCandidates: ShadowExitTradeRowLike[];
}

const EMPTY_MFE_MAE_REVIEW: MfeMaeReview = {
  available: false,
  eligibleSampleCount: 0,
  rawRowCount: 0,
  processedRowCount: 0,
  lowSampleWarning: true,
  lowSampleThreshold: null,
  avgMfe: null,
  avgMfeSampleCount: 0,
  avgMae: null,
  giveBackCandidates: [],
};

/**
 * Derive the MFE/MAE review purely from the shadow-exits report. When the
 * report is missing or disabled, returns a safe empty model. Averages and
 * give-back candidates use ONLY the server-provided per-trade spotlight rows
 * (improvedTopN ∪ reducedTopN); we never compute MFE/MAE from closed-trade
 * payloads, and MAE is always `null` because no payload tracks it.
 */
export function deriveMfeMaeReview(
  shadowExits?: ShadowExitReportLike | null,
): MfeMaeReview {
  if (shadowExits == null || shadowExits.enabled === false) {
    return { ...EMPTY_MFE_MAE_REVIEW, giveBackCandidates: [] };
  }

  const improved = Array.isArray(shadowExits.improvedTopN)
    ? shadowExits.improvedTopN
    : [];
  const reduced = Array.isArray(shadowExits.reducedTopN)
    ? shadowExits.reducedTopN
    : [];

  // Union the spotlight rows, de-duplicating by id.
  const seen = new Set<string>();
  const spotlight: ShadowExitTradeRowLike[] = [];
  for (const r of [...improved, ...reduced]) {
    const id = typeof r.id === "string" ? r.id : "";
    if (id !== "" && seen.has(id)) continue;
    if (id !== "") seen.add(id);
    spotlight.push(r);
  }

  const mfeValues: number[] = [];
  for (const r of spotlight) {
    if (r.mfeAvailable === true) {
      const m = toNum(r.mfeAbs);
      if (m != null) mfeValues.push(m);
    }
  }

  // Give-back candidates: favourable excursion was meaningfully above the
  // realised P&L (a tighter exit rule would have captured more).
  const giveBackCandidates = spotlight.filter((r) => {
    if (r.mfeAvailable !== true) return false;
    const mfe = toNum(r.mfeAbs);
    const actual = toNum(r.actualPnl);
    if (mfe == null || actual == null) return false;
    return mfe > 0 && mfe > actual;
  });

  return {
    available: true,
    eligibleSampleCount: toNumOr(shadowExits.mfeAvailableCount, 0),
    rawRowCount: toNumOr(shadowExits.rawRowCount, 0),
    processedRowCount: toNumOr(shadowExits.processedRowCount, 0),
    lowSampleWarning: shadowExits.lowSampleWarning === true,
    lowSampleThreshold: toNum(shadowExits.lowSampleThreshold),
    avgMfe: avgNums(mfeValues),
    avgMfeSampleCount: mfeValues.length,
    avgMae: null,
    giveBackCandidates,
  };
}

// ---------------------------------------------------------------------------
// 8. Equity curve / drawdown shaping (analytics/fo ONLY)
// ---------------------------------------------------------------------------

export interface ShapedEquityPoint {
  date: string;
  dailyPnl: number | null;
  cumulativePnl: number | null;
  drawdown: number | null;
}

/**
 * Shape the analytics equity curve into a render-ready, sanitised series.
 * Points missing a usable date are dropped; numeric fields degrade to `null`.
 * Returns an empty array when the curve is missing. Never mutates.
 */
export function shapeEquityCurve(
  analytics?: FoAnalyticsLike | null,
): ShapedEquityPoint[] {
  const curve = analytics?.equityCurve;
  if (!Array.isArray(curve)) return [];
  const out: ShapedEquityPoint[] = [];
  for (const p of curve) {
    const date = strOrNull(p?.date ?? null);
    if (date == null) continue;
    out.push({
      date,
      dailyPnl: toNum(p?.dailyPnl),
      cumulativePnl: toNum(p?.cumulativePnl),
      drawdown: toNum(p?.drawdown),
    });
  }
  return out;
}

export interface DrawdownSummary {
  maxDrawdown: number | null;
  currentDrawdown: number | null;
  peakEquity: number | null;
  /** maxDrawdown as a % of peak equity; null unless peak > 0. */
  maxDrawdownPct: number | null;
}

/** Extract the drawdown summary from analytics. Safe empty model when absent. */
export function deriveDrawdownSummary(
  analytics?: FoAnalyticsLike | null,
): DrawdownSummary {
  const maxDrawdown = toNum(analytics?.maxDrawdown);
  const currentDrawdown = toNum(analytics?.currentDrawdown);
  const peakEquity = toNum(analytics?.peakEquity);
  const maxDrawdownPct =
    maxDrawdown != null && peakEquity != null && peakEquity > 0
      ? (Math.abs(maxDrawdown) / peakEquity) * 100
      : null;
  return { maxDrawdown, currentDrawdown, peakEquity, maxDrawdownPct };
}

// ---------------------------------------------------------------------------
// 9. CSV export serializer
// ---------------------------------------------------------------------------

export interface CsvColumn {
  key: string;
  header?: string;
}

export type CsvColumnSpec = string | CsvColumn;

function normalizeColumn(c: CsvColumnSpec): CsvColumn {
  return typeof c === "string" ? { key: c } : c;
}

function csvCell(value: unknown): string {
  let s: string;
  if (value == null) s = "";
  else if (Array.isArray(value)) s = value.map((v) => (v == null ? "" : String(v))).join("; ");
  else if (typeof value === "boolean") s = value ? "true" : "false";
  else s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Serialise already-fetched rows to CSV. Deterministic column order (the
 * order of `columns`); RFC-4180 quoting for quotes/commas/newlines; missing
 * fields become empty cells. Pure — no I/O, no file write, no mutation.
 */
export function serializeReportRowsToCsv(
  rows: readonly Record<string, unknown>[],
  columns: readonly CsvColumnSpec[],
): string {
  const cols = columns.map(normalizeColumn);
  const headerLine = cols.map((c) => csvCell(c.header ?? c.key)).join(",");
  const lines = [headerLine];
  for (const row of rows) {
    lines.push(cols.map((c) => csvCell(row[c.key])).join(","));
  }
  return lines.join("\r\n");
}

// ---------------------------------------------------------------------------
// 10. Empty-state helper
// ---------------------------------------------------------------------------

export type ReportsEmptyStateKind =
  | "loading"
  | "error"
  | "empty"
  | "no-match"
  | "ready";

export interface DeriveReportsEmptyStateInput {
  loading?: boolean;
  error?: unknown;
  rows?: readonly unknown[] | null;
  /** Active-filter signal — a boolean or a count. */
  filtersActive?: boolean | number;
}

export interface ReportsEmptyState {
  kind: ReportsEmptyStateKind;
}

/**
 * Resolve the report panel state. Precedence: loading → error → (no rows:
 * filtered-empty when filters are active, otherwise empty) → ready.
 */
export function deriveReportsEmptyState(
  input: DeriveReportsEmptyStateInput,
): ReportsEmptyState {
  const { loading, error, rows, filtersActive } = input ?? {};
  if (loading) return { kind: "loading" };
  if (error != null && error !== false) return { kind: "error" };
  const count = Array.isArray(rows) ? rows.length : 0;
  if (count === 0) {
    const active =
      typeof filtersActive === "number" ? filtersActive > 0 : !!filtersActive;
    return { kind: active ? "no-match" : "empty" };
  }
  return { kind: "ready" };
}
