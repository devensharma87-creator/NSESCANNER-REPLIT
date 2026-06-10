/**
 * W2A — pure view helpers for the `/stocks-to-watch` Technical Analysis section.
 *
 * STRICTLY presentation / filtering / grouping / explanation over the data the
 * page already fetches from `/api/stocks-to-watch/analysis`. Nothing here
 * computes or alters a score, action, entry, stop, target, R:R, trigger, or any
 * trading decision — it only reshapes and labels existing fields for display.
 *
 * All functions are pure and unit-tested. No owner-only diagnostic data is read
 * or produced here (the public freshness reuse goes through the leak-safe
 * `derivePublicFreshness`).
 */
import {
  derivePublicFreshness,
  deriveRsCoverage,
  deriveAgeSeverity,
  type PublicFreshness,
} from "./infraHealth";

// ── Row / payload types (mirror the existing analysis payload shape) ─────────

export interface SwingRow {
  symbol: string;
  scanDate: string;
  action: string;
  setup: string;
  qualityGrade: string;
  potential: string;
  score: string;
  technicalScore: string;
  smcScore: string;
  volumeScore: string;
  momentumScore: string;
  fundamentalScore: string;
  riskScore: string;
  contextScore: string;
  rsScore: string | null;
  closePrice: string;
  entry: string;
  stopLoss: string;
  target1: string;
  target2: string;
  rrToT1: string | null;
  buyZoneLower: string;
  buyZoneUpper: string;
  buyZoneBasis: string;
  triggerText: string;
  triggerPrice: string;
  stopBasis: string;
  targetBasis: string;
  rsi14: string | null;
  adx14: string | null;
  atr14: string | null;
  atrPct: string | null;
  volRatio: string | null;
  avgValueLakhs: string | null;
  pctFrom52wLow: string | null;
  pctFrom52wHigh: string | null;
  weeklyTrend: string;
  candleSignal: string;
  marketStructure: string;
  rs20: string | null;
  rs50: string | null;
  rs120: string | null;
  sector: string | null;
  industry: string | null;
  fundamentalStatus: string | null;
  reasons: string[];
  warnings: string[];
  intradayLast: string | null;
  intradayChangePct: string | null;
  triggerHit: boolean | null;
  intradayUpdatedAt: string | null;
}

export interface SwingRunMeta {
  scannedCount: number;
  errorCount: number;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
}

export interface CandleProvenance {
  scanDate: string;
  bySource: { kite: number; yahoo: number };
  noBarsCount: number;
  dominant: "kite" | "yahoo" | "mixed" | "none";
  asOf: string | null;
}

export interface AnalysisPayload {
  asOf: string;
  scanDate: string | null;
  runMeta: SwingRunMeta | null;
  scheduler: {
    lastDeepScanDate: string | null;
    lastDeepScanError: string | null;
    deepScanInflight: boolean;
  };
  rows: SwingRow[];
  /**
   * Honest provenance for the DAILY bars behind this scan, or null when
   * the serving process did not produce the latest scan (e.g. restarted
   * since) — the UI then shows "source unavailable" instead of guessing.
   */
  candleProvenance?: CandleProvenance | null;
}

/** View-model for the daily-bar source pill; null when no provenance. */
export interface CandleSourceBadgeView {
  source: "kite" | "yahoo" | "mixed" | "unknown";
  status: "delayed" | "down";
  fallbackActive: boolean;
  note: string;
  asOf: string | null;
}

/** Pure: map daily-bar provenance → DataSourceBadge props (testable). */
export function candleSourceBadge(
  cp: CandleProvenance | null | undefined,
): CandleSourceBadgeView | null {
  if (!cp) return null;
  const { dominant, bySource, asOf } = cp;
  switch (dominant) {
    case "kite":
      return { source: "kite", status: "delayed", fallbackActive: false, note: "daily bars · Kite", asOf };
    case "yahoo":
      return { source: "yahoo", status: "delayed", fallbackActive: true, note: "daily bars · Yahoo fallback", asOf };
    case "mixed":
      return { source: "mixed", status: "delayed", fallbackActive: true, note: `daily bars · ${bySource.kite} Kite / ${bySource.yahoo} Yahoo`, asOf };
    case "none":
    default:
      return { source: "unknown", status: "down", fallbackActive: false, note: "daily bars unavailable", asOf };
  }
}

// ── numeric parsing ─────────────────────────────────────────────────────────

export const num = (s: string | null | undefined): number => (s == null ? NaN : Number(s));

// ── action display mapping (display-only — backend strings untouched) ────────

export const ACTION_DISPLAY_MAP: Array<{ test: (a: string) => boolean; label: string }> = [
  { test: (a) => a.includes("BUY ZONE"), label: "BUY ZONE" },
  { test: (a) => a.includes("BREAKOUT"), label: "BUY BREAKOUT" },
  { test: (a) => a.includes("PULLBACK") || a.includes("RECLAIM"), label: "RETEST ONLY" },
  { test: (a) => a.includes("CONFIRMATION"), label: "WAIT" },
  { test: (a) => a.includes("WATCH"), label: "WATCHLIST" },
  { test: (a) => a.includes("AVOID"), label: "AVOID" },
];

/**
 * Maps a backend `action` string to a clean display label. Unknown / empty
 * actions fall back to the raw string (never hidden, never crash). NOTE:
 * "NO TRADE" is intentionally NOT produced — no backend action maps to it
 * ("not available yet — do not implement").
 */
export function actionDisplayLabel(action: string | null | undefined): string {
  const a = (action ?? "").trim();
  if (!a) return "—";
  for (const m of ACTION_DISPLAY_MAP) if (m.test(a)) return m.label;
  return a;
}

/** Actionable = a buy-side setup that suggests a potential trade. */
export function isActionable(action: string | null | undefined): boolean {
  return /BUY ZONE|BREAKOUT|PULLBACK|RECLAIM/.test(action ?? "");
}

// ── action filter set (matches the RAW backend action) ───────────────────────

export const ACTION_FILTERS: Array<{ key: string; label: string; matches: (a: string) => boolean }> =
  [
    { key: "ALL", label: "All", matches: () => true },
    { key: "BUY_ZONE", label: "Buy Zone", matches: (a) => a.includes("BUY ZONE") },
    { key: "BREAKOUT", label: "Buy Breakout", matches: (a) => a.includes("BREAKOUT") },
    {
      key: "PULLBACK",
      label: "Retest Only",
      matches: (a) => a.includes("PULLBACK") || a.includes("RECLAIM"),
    },
    { key: "CONFIRM", label: "Wait", matches: (a) => a.includes("CONFIRMATION") },
    { key: "WATCH", label: "Watchlist", matches: (a) => a.includes("WATCH") },
    { key: "AVOID", label: "Avoid", matches: (a) => a.includes("AVOID") },
  ];

// ── summary aggregation (all derived from the existing payload) ───────────────

export interface SwingSummary {
  totalScanned: number | null;
  errorCount: number | null;
  rowCount: number;
  actionableCount: number;
  triggerHits: number;
  topSector: { sector: string; count: number } | null;
  avgRs: number | null;
  rsCoveragePct: number;
  freshness: PublicFreshness;
}

export function summarize(
  payload: Pick<AnalysisPayload, "rows" | "runMeta" | "scanDate"> | null | undefined,
  nowMs: number,
  intradayThresholdMin = 30,
): SwingSummary {
  const rows = payload?.rows ?? [];
  const actionableCount = rows.filter((r) => isActionable(r.action)).length;
  const triggerHits = rows.filter((r) => r.triggerHit === true).length;

  // Top sector = highest member count; ties broken by higher average score.
  const sectorAgg = new Map<string, { count: number; scoreSum: number; scoreN: number }>();
  for (const r of rows) {
    const sec = (r.sector ?? "").trim();
    if (!sec) continue;
    const e = sectorAgg.get(sec) ?? { count: 0, scoreSum: 0, scoreN: 0 };
    e.count += 1;
    const sc = num(r.score);
    if (Number.isFinite(sc)) {
      e.scoreSum += sc;
      e.scoreN += 1;
    }
    sectorAgg.set(sec, e);
  }
  let topSector: { sector: string; count: number } | null = null;
  let bestAvg = -Infinity;
  for (const [sector, e] of sectorAgg) {
    const avg = e.scoreN > 0 ? e.scoreSum / e.scoreN : -Infinity;
    if (
      topSector == null ||
      e.count > topSector.count ||
      (e.count === topSector.count && avg > bestAvg)
    ) {
      topSector = { sector, count: e.count };
      bestAvg = avg;
    }
  }

  const rs = deriveRsCoverage(rows);
  const freshness = derivePublicFreshness(
    { scanDate: payload?.scanDate ?? null, intradayTimestamps: rows.map((r) => r.intradayUpdatedAt) },
    nowMs,
    intradayThresholdMin,
  );

  return {
    totalScanned: payload?.runMeta?.scannedCount ?? null,
    errorCount: payload?.runMeta?.errorCount ?? null,
    rowCount: rows.length,
    actionableCount,
    triggerHits,
    topSector,
    avgRs: rs.avgRsScore,
    rsCoveragePct: rs.coveragePct,
    freshness,
  };
}

// ── risk / status badges (warnings first, then purely-derived) ───────────────

export type BadgeTone = "danger" | "warn" | "info" | "muted" | "success";
export interface RowBadge {
  label: string;
  tone: BadgeTone;
  kind: "warning" | "derived";
}

export function isIntradayQuoteMissing(row: Pick<SwingRow, "intradayLast">): boolean {
  return row.intradayLast == null || !Number.isFinite(num(row.intradayLast));
}

export function isStaleRow(
  row: Pick<SwingRow, "intradayLast" | "intradayUpdatedAt">,
  nowMs: number,
  staleMin = 30,
): boolean {
  if (isIntradayQuoteMissing(row)) return false; // "no quote" is reported separately
  const sev = deriveAgeSeverity(row.intradayUpdatedAt, nowMs, staleMin);
  return sev === "stale" || sev === "fail";
}

export function deriveRowBadges(
  row: Pick<SwingRow, "warnings" | "triggerHit" | "intradayLast" | "intradayUpdatedAt">,
  nowMs: number,
  staleMin = 30,
): RowBadge[] {
  const out: RowBadge[] = [];
  for (const w of row.warnings ?? []) {
    if (w && w.trim()) out.push({ label: w.trim(), tone: "warn", kind: "warning" });
  }
  if (row.triggerHit === true) out.push({ label: "trigger hit", tone: "success", kind: "derived" });
  else if (row.triggerHit === false)
    out.push({ label: "trigger pending", tone: "info", kind: "derived" });

  if (isIntradayQuoteMissing(row)) {
    out.push({ label: "no intraday quote", tone: "muted", kind: "derived" });
  } else if (isStaleRow(row, nowMs, staleMin)) {
    out.push({ label: "stale data", tone: "warn", kind: "derived" });
  }
  return out;
}

// ── filtering ────────────────────────────────────────────────────────────────

export interface SwingFilters {
  action: string; // ACTION_FILTERS key
  sector: string; // "ALL" or exact sector name
  scoreMin: number | null;
  scoreMax: number | null;
  rsMin: number | null;
  rsMax: number | null;
  triggerHitOnly: boolean;
  freshOnly: boolean;
  actionableOnly: boolean;
}

export const DEFAULT_FILTERS: SwingFilters = {
  action: "ALL",
  sector: "ALL",
  scoreMin: null,
  scoreMax: null,
  rsMin: null,
  rsMax: null,
  triggerHitOnly: false,
  freshOnly: false,
  actionableOnly: false,
};

export function uniqueSectors(rows: SwingRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const s = (r.sector ?? "").trim();
    if (s) set.add(s);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function applyFilters(
  rows: SwingRow[],
  filters: SwingFilters,
  nowMs: number,
  staleMin = 30,
): SwingRow[] {
  const af = ACTION_FILTERS.find((f) => f.key === filters.action) ?? ACTION_FILTERS[0]!;
  return rows.filter((r) => {
    if (!af.matches(r.action)) return false;
    if (filters.sector !== "ALL" && (r.sector ?? "").trim() !== filters.sector) return false;
    if (filters.actionableOnly && !isActionable(r.action)) return false;
    if (filters.triggerHitOnly && r.triggerHit !== true) return false;
    if (filters.freshOnly) {
      if (isIntradayQuoteMissing(r) || isStaleRow(r, nowMs, staleMin)) return false;
    }
    const score = num(r.score);
    if (filters.scoreMin != null && (!Number.isFinite(score) || score < filters.scoreMin))
      return false;
    if (filters.scoreMax != null && (!Number.isFinite(score) || score > filters.scoreMax))
      return false;
    const rs = num(r.rsScore);
    if (filters.rsMin != null && (!Number.isFinite(rs) || rs < filters.rsMin)) return false;
    if (filters.rsMax != null && (!Number.isFinite(rs) || rs > filters.rsMax)) return false;
    return true;
  });
}

// ── sorting ──────────────────────────────────────────────────────────────────

export type SortKey = "score" | "symbol" | "rrToT1" | "rsi14" | "atrPct" | "rsScore";
export type SortDir = "asc" | "desc";

export function sortRows(rows: SwingRow[], key: SortKey, dir: SortDir): SwingRow[] {
  const out = [...rows];
  out.sort((a, b) => {
    if (key === "symbol") {
      const cmp = a.symbol.localeCompare(b.symbol);
      return dir === "asc" ? cmp : -cmp;
    }
    const av = num(a[key] as string | null);
    const bv = num(b[key] as string | null);
    const aN = Number.isFinite(av) ? av : -Infinity;
    const bN = Number.isFinite(bv) ? bv : -Infinity;
    return dir === "desc" ? bN - aN : aN - bN;
  });
  return out;
}

// ── grouping ─────────────────────────────────────────────────────────────────

export type GroupBy = "none" | "action" | "sector" | "scoreBucket" | "rsStrength" | "trigger";

export function scoreBucket(score: number): string {
  if (!Number.isFinite(score)) return "No score";
  if (score >= 75) return "75+";
  if (score >= 60) return "60–74";
  if (score >= 50) return "50–59";
  return "<50";
}

export function rsStrengthBucket(rs: number): string {
  if (!Number.isFinite(rs)) return "No RS";
  if (rs >= 80) return "Strong (80+)";
  if (rs >= 60) return "Firm (60–79)";
  return "Weak (<60)";
}

export interface RowGroup {
  key: string;
  rows: SwingRow[];
}

export function groupRows(rows: SwingRow[], by: GroupBy): RowGroup[] {
  if (by === "none") return [{ key: "All", rows }];
  const map = new Map<string, SwingRow[]>();
  const keyOf = (r: SwingRow): string => {
    switch (by) {
      case "action":
        return actionDisplayLabel(r.action);
      case "sector":
        return (r.sector ?? "").trim() || "Unclassified";
      case "scoreBucket":
        return scoreBucket(num(r.score));
      case "rsStrength":
        return rsStrengthBucket(num(r.rsScore));
      case "trigger":
        return r.triggerHit === true
          ? "Trigger hit"
          : r.triggerHit === false
            ? "Trigger pending"
            : "No trigger data";
      default:
        return "All";
    }
  };
  for (const r of rows) {
    const k = keyOf(r);
    const arr = map.get(k) ?? [];
    arr.push(r);
    map.set(k, arr);
  }
  return [...map.entries()]
    .map(([key, rs]) => ({ key, rows: rs }))
    .sort((a, b) => b.rows.length - a.rows.length || a.key.localeCompare(b.key));
}
