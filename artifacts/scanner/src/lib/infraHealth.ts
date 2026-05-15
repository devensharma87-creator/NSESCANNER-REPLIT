/**
 * Pure severity-derivation helpers for the owner-only Data Infrastructure
 * Health dashboard (Priority 10).
 *
 * No fetch, no React, no DOM — every helper here is a synchronous pure
 * function over the diagnostic-endpoint response shapes we already
 * publish. This file exists primarily so the dashboard's status logic
 * is unit-testable without spinning up jsdom + a mocked fetch.
 *
 * The dashboard itself is read-only and consumes existing diagnostic
 * endpoints; nothing here triggers a write, ingestion, or trade path.
 */

export type Severity = "ok" | "warn" | "fail" | "disabled" | "stale";

export const SEVERITY_LABEL: Record<Severity, string> = {
  ok: "OK",
  warn: "WARN",
  fail: "FAIL",
  disabled: "DISABLED",
  stale: "STALE",
};

/**
 * Convert a known `latestAt` timestamp into a severity given a stale
 * threshold (in minutes). `null`/missing always returns "fail" — the
 * caller decides whether that's actually a problem (e.g. ingestion off
 * over a weekend should show "disabled" instead).
 *
 *  - age < threshold              → ok
 *  - threshold <= age < 2*thresh  → stale (amber)
 *  - age >= 2*threshold           → fail (red)
 *
 * Future-clock-skew (negative age) clamps to 0 so a slightly fast wall
 * clock never throws the dashboard into "fail".
 */
export function deriveAgeSeverity(
  latestAt: string | null | undefined,
  nowMs: number,
  thresholdMin: number,
): Severity {
  if (!latestAt) return "fail";
  const t = Date.parse(latestAt);
  if (!Number.isFinite(t)) return "fail";
  const ageMin = Math.max(0, (nowMs - t) / 60_000);
  if (ageMin < thresholdMin) return "ok";
  if (ageMin < thresholdMin * 2) return "stale";
  return "fail";
}

/**
 * Sector mapping coverage → severity.
 *  - 100 %         → ok
 *  - 95 %..<100 %  → warn
 *  - <95 %         → fail
 */
export function deriveCoverageSeverity(pct: number | null | undefined): Severity {
  if (pct == null || !Number.isFinite(pct)) return "fail";
  if (pct >= 100) return "ok";
  if (pct >= 95) return "warn";
  return "fail";
}

/**
 * Option snapshot diagnostics → severity.
 *
 *   { config: { enabled }, todayRowsTotal, coverage: [{ underlying, latest_snapshot, ... }] }
 *
 * - ingestion disabled              → "disabled" (amber/grey, not a failure)
 * - any underlying missing from coverage  → "fail"
 * - latest snapshot stale per `deriveAgeSeverity` (15 min default) → propagate
 * - everything fresh + all underlyings present → "ok"
 */
export interface SnapshotCoverageRow {
  underlying: string;
  latest_snapshot: string | null;
  total_rows?: number | null;
  distinct_expiries?: number | null;
  distinct_strikes?: number | null;
  rows_today?: number | null;
}
export interface SnapshotDiagnostics {
  config: { enabled: boolean; universe: string[] };
  todayRowsTotal: number;
  coverage: SnapshotCoverageRow[];
}
export function deriveSnapshotSeverity(
  d: SnapshotDiagnostics,
  nowMs: number,
  staleMin = 15,
): { severity: Severity; reasons: string[] } {
  const reasons: string[] = [];
  if (!d.config.enabled) {
    reasons.push("Ingestion disabled (env gate off — expected in dev workspace).");
    return { severity: "disabled", reasons };
  }
  const have = new Set(d.coverage.map((r) => r.underlying));
  const missing = d.config.universe.filter((u) => !have.has(u));
  if (missing.length > 0) {
    reasons.push(`No rows for: ${missing.join(", ")}`);
  }
  let worst: Severity = missing.length > 0 ? "fail" : "ok";
  for (const r of d.coverage) {
    const s = deriveAgeSeverity(r.latest_snapshot, nowMs, staleMin);
    if (s === "fail" && worst !== "fail") worst = "fail";
    else if (s === "stale" && worst === "ok") worst = "stale";
    if (s !== "ok") reasons.push(`${r.underlying}: latest snapshot ${r.latest_snapshot ?? "—"}`);
  }
  return { severity: worst, reasons };
}

/**
 * Candle warehouse diagnostics → severity.
 *
 *   byInterval: [{ interval, rows, latest_ts, ... }]
 *
 * Each interval has its own freshness expectation:
 *   - "day"       — stale after 36 h (handles weekends/holidays loosely)
 *   - "15minute"  — stale after 60 min (expected to refresh during market hours)
 */
export interface CandleIntervalRow {
  interval: string;
  rows: number;
  latest_ts: string | null;
  distinct_symbols?: number;
}
export function deriveCandleSeverity(
  byInterval: CandleIntervalRow[],
  nowMs: number,
): { severity: Severity; perInterval: Array<{ interval: string; severity: Severity }> } {
  if (byInterval.length === 0) {
    return { severity: "fail", perInterval: [] };
  }
  const perInterval = byInterval.map((row) => {
    const threshold = row.interval === "15minute" ? 60 : row.interval === "day" ? 36 * 60 : 24 * 60;
    return { interval: row.interval, severity: deriveAgeSeverity(row.latest_ts, nowMs, threshold) };
  });
  let worst: Severity = "ok";
  for (const p of perInterval) {
    if (p.severity === "fail") worst = "fail";
    else if (p.severity === "stale" && worst === "ok") worst = "stale";
  }
  return { severity: worst, perInterval };
}

/**
 * Format an ISO timestamp as "Xm ago" / "Xh ago" / "—" for compact
 * display in the dashboard. Pure, no Intl — the audit/status pages
 * use the same minimal style.
 */
export function formatAge(latestAt: string | null | undefined, nowMs: number): string {
  if (!latestAt) return "—";
  const t = Date.parse(latestAt);
  if (!Number.isFinite(t)) return "—";
  const ageSec = Math.max(0, (nowMs - t) / 1000);
  if (ageSec < 60) return `${Math.round(ageSec)}s ago`;
  const m = Math.floor(ageSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m ago`;
  const days = Math.floor(h / 24);
  return `${days}d ${h % 24}h ago`;
}

/**
 * Derive an overall dashboard severity from N section severities.
 * fail beats stale beats warn beats disabled beats ok.
 */
const RANK: Record<Severity, number> = { ok: 0, disabled: 1, warn: 2, stale: 3, fail: 4 };
export function rollUp(severities: Severity[]): Severity {
  let worst: Severity = "ok";
  for (const s of severities) {
    if (RANK[s] > RANK[worst]) worst = s;
  }
  return worst;
}

/**
 * Combined snapshot section severity: rolls together the diagnostics
 * health (ingestion / coverage / freshness) AND the Priority 9
 * analytics endpoint health. If analytics fails, the section badge
 * must reflect that — diagnostics being green while analytics is
 * down would be misleading.
 *
 * Mirrors the React page's intent: one section, two data planes,
 * one badge. Pulled out as a pure function so the integration is
 * unit-testable without rendering the page.
 */
export function deriveSnapshotSectionSeverity(
  diag: { data: SnapshotDiagnostics | null; error: string | null; loading: boolean },
  analytics: { error: string | null; loading: boolean; data: unknown },
  nowMs: number,
  staleMin = 15,
): Severity {
  let diagSev: Severity;
  if (diag.error) diagSev = "fail";
  else if (!diag.data) diagSev = diag.loading ? "disabled" : "fail";
  else diagSev = deriveSnapshotSeverity(diag.data, nowMs, staleMin).severity;

  // Analytics-only failures stay at "warn" — they don't necessarily mean
  // the underlying data plane is broken (could be a downstream pure-math
  // bug), but the operator must see something.
  let analyticsSev: Severity = "ok";
  if (analytics.error) analyticsSev = "warn";
  else if (!analytics.data && !analytics.loading) analyticsSev = "warn";

  return rollUp([diagSev, analyticsSev]);
}
