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

// ───────────────────────────────────────────────────────────────────────────
// W1A: Pro Operations Console pure helpers
//
// All read-only/display logic. None of these touch a fetch, a write, a
// trade path, scoring, gates, thresholds, or scheduler. They exist so the
// new owner-only panels (Gate Status, Swing Freshness, F&O Evidence) and
// the public freshness strip have unit-testable logic.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Human-accepted verification states for the static gate-status config,
 * plus the two live-derived P25 states. Mapped to a display Severity for
 * badge colouring only.
 */
export type GateState =
  | "verified"
  | "partial"
  | "pending"
  | "not_approved"
  | "live_open"
  | "live_closed";

export function gateStateToSeverity(g: GateState): Severity {
  switch (g) {
    case "verified":
    case "live_closed":
      return "ok";
    case "partial":
    case "live_open":
      return "warn";
    case "pending":
    case "not_approved":
      return "disabled";
  }
}

/**
 * Official P25 evidence gate, derived ONLY from the shadow-exit report's
 * official counter (`mfeAvailableCount`). NEVER from raw `rowCount` /
 * `rawRowCount` (those include pre-P20-fix 0/0 placeholder rows).
 *
 *   official     = mfeAvailableCount
 *   threshold    = lowSampleThreshold (fallback 20)
 *   remaining    = max(0, threshold - official)
 *   excludedPreFix = processedRowCount - official (rows passing entry/qty
 *                    but sitting at max_runup=0 AND max_drawdown=0)
 *   gateOpen     = lowSampleWarning (fallback official < threshold)
 *
 * `enabled === false` (feature flag off) → "disabled".
 */
export interface ShadowExitReportLite {
  enabled?: boolean | null;
  mfeAvailableCount?: number | null;
  lowSampleThreshold?: number | null;
  lowSampleWarning?: boolean | null;
  processedRowCount?: number | null;
  rawRowCount?: number | null;
  rowCount?: number | null;
}
export interface P25Gate {
  enabled: boolean;
  official: number;
  threshold: number;
  remaining: number;
  excludedPreFix: number | null;
  rawRowCount: number | null;
  gateOpen: boolean;
  severity: Severity;
}
export function deriveP25Gate(r: ShadowExitReportLite | null | undefined): P25Gate {
  const threshold =
    r?.lowSampleThreshold != null && Number.isFinite(r.lowSampleThreshold)
      ? (r.lowSampleThreshold as number)
      : 20;
  if (!r || r.enabled === false) {
    return {
      enabled: false,
      official: 0,
      threshold,
      remaining: threshold,
      excludedPreFix: null,
      rawRowCount: null,
      gateOpen: true,
      severity: "disabled",
    };
  }
  const official =
    r.mfeAvailableCount != null && Number.isFinite(r.mfeAvailableCount)
      ? (r.mfeAvailableCount as number)
      : 0;
  const remaining = Math.max(0, threshold - official);
  const gateOpen = r.lowSampleWarning != null ? !!r.lowSampleWarning : official < threshold;
  const processed =
    r.processedRowCount != null && Number.isFinite(r.processedRowCount)
      ? (r.processedRowCount as number)
      : null;
  const excludedPreFix = processed != null ? Math.max(0, processed - official) : null;
  const rawRowCount =
    r.rawRowCount != null && Number.isFinite(r.rawRowCount) ? (r.rawRowCount as number) : null;
  return {
    enabled: true,
    official,
    threshold,
    remaining,
    excludedPreFix,
    rawRowCount,
    gateOpen,
    severity: gateOpen ? "warn" : "ok",
  };
}

/**
 * Return the most-recent parseable timestamp from a list, or null. Used to
 * collapse per-row `intradayUpdatedAt` into a single "last refresh" time.
 */
export function latestTimestamp(values: Array<string | null | undefined>): string | null {
  let bestMs: number | null = null;
  let bestStr: string | null = null;
  for (const v of values) {
    if (!v) continue;
    const t = Date.parse(v);
    if (!Number.isFinite(t)) continue;
    if (bestMs === null || t > bestMs) {
      bestMs = t;
      bestStr = v;
    }
  }
  return bestStr;
}

/**
 * RS coverage over swing-scan rows. `rsScore` is persisted as a string
 * (numeric column) or number; null means RS was not computed for that row.
 */
export function deriveRsCoverage(
  rows: Array<{ rsScore: string | number | null | undefined }>,
): { total: number; withRs: number; coveragePct: number; avgRsScore: number | null } {
  let withRs = 0;
  let sum = 0;
  for (const row of rows) {
    const raw = row.rsScore;
    const v = raw == null ? null : typeof raw === "number" ? raw : parseFloat(raw);
    if (v != null && Number.isFinite(v)) {
      withRs += 1;
      sum += v;
    }
  }
  const total = rows.length;
  const coveragePct = total > 0 ? (withRs / total) * 100 : 0;
  const avgRsScore = withRs > 0 ? sum / withRs : null;
  return { total, withRs, coveragePct, avgRsScore };
}

/**
 * Public-safe freshness summary for the `/stocks-to-watch` strip.
 *
 * IMPORTANT: returns ONLY non-sensitive fields (scan date, last intraday
 * refresh time, a coarse severity + label). No evidence counts, shadow
 * scores, sector internals, or any owner-only diagnostic ever flows through
 * here — guaranteed by the return type. Unit-tested to enforce this.
 */
export interface PublicFreshness {
  scanDate: string | null;
  lastIntradayRefreshAt: string | null;
  severity: Severity;
  label: string;
}
// ───────────────────────────────────────────────────────────────────────────
// F&O Exit Monitoring Reliability (T007): pure severity for the
// `/paper/diagnostics/fo/exit-monitor/status` payload, consumed by both the
// paper-trading Exit Monitor panel's badge and the Infra Health rollup.
// Read-only — no fetch, no mutation, no trading-logic touch.
// ───────────────────────────────────────────────────────────────────────────

export interface ExitMonitorHealthLite {
  cyclesTotal: number;
  errorsTotal: number;
  lastCycle: { checkedAt: string } | null;
  lastErrorAt: string | null;
  bootedAt: string;
}

export interface SubsystemHealthLite {
  lastErrorAt: string | null;
}

/**
 * Severity for the exit-monitor's own cycle cadence + errors, plus the four
 * dependent sub-systems (premium overlay, orphan-exit sweep, MTM sweep,
 * 15:20 force-exit) whose health rides along in the same status payload.
 *
 *  - no `exitMonitor` object at all (endpoint failed/unreachable) → fail
 *  - never completed a cycle:
 *      - booted < `cycleStaleMin` ago → disabled (still warming up)
 *      - otherwise                    → fail (monitor never ran)
 *  - last cycle older than `cycleStaleMin` → propagate via deriveAgeSeverity
 *  - a monitor or sub-system error within the last `errorWindowMin` minutes
 *    → warn (does not escalate to fail on its own — errors are expected to
 *    be transient and the monitor's own fail-open design already protects
 *    trading; this is observability, not a trading gate)
 */
export function deriveExitMonitorSeverity(
  exitMonitor: ExitMonitorHealthLite | null | undefined,
  subsystems: SubsystemHealthLite[],
  nowMs: number,
  cycleStaleMin = 5,
  errorWindowMin = 30,
): { severity: Severity; reasons: string[] } {
  const reasons: string[] = [];
  if (!exitMonitor) {
    reasons.push("Exit monitor health unavailable (status endpoint unreachable).");
    return { severity: "fail", reasons };
  }

  let cycleSev: Severity;
  if (exitMonitor.lastCycle) {
    cycleSev = deriveAgeSeverity(exitMonitor.lastCycle.checkedAt, nowMs, cycleStaleMin);
    if (cycleSev !== "ok") {
      reasons.push(`Last exit-monitor cycle was at ${exitMonitor.lastCycle.checkedAt}.`);
    }
  } else {
    const bootedMs = Date.parse(exitMonitor.bootedAt);
    const bootAgeMin = Number.isFinite(bootedMs) ? (nowMs - bootedMs) / 60_000 : Infinity;
    if (exitMonitor.cyclesTotal === 0 && bootAgeMin < cycleStaleMin) {
      cycleSev = "disabled";
      reasons.push("No exit-monitor cycles yet (server recently restarted).");
    } else {
      cycleSev = "fail";
      reasons.push("Exit monitor has never completed a cycle.");
    }
  }

  const recentErrorAgeMin = (errAt: string | null): number => {
    if (!errAt) return Infinity;
    const t = Date.parse(errAt);
    return Number.isFinite(t) ? (nowMs - t) / 60_000 : Infinity;
  };

  let errSev: Severity = "ok";
  if (recentErrorAgeMin(exitMonitor.lastErrorAt) < errorWindowMin) {
    errSev = "warn";
    reasons.push(`Exit monitor recorded an error at ${exitMonitor.lastErrorAt}.`);
  }

  let subSev: Severity = "ok";
  if (subsystems.some((s) => recentErrorAgeMin(s.lastErrorAt) < errorWindowMin)) {
    subSev = "warn";
    reasons.push(
      "A dependent sub-system (premium overlay / orphan-exit sweep / MTM sweep / 15:20 force-exit) recently errored.",
    );
  }

  return { severity: rollUp([cycleSev, errSev, subSev]), reasons };
}

export function derivePublicFreshness(
  input: { scanDate: string | null; intradayTimestamps: Array<string | null | undefined> },
  nowMs: number,
  intradayThresholdMin = 30,
): PublicFreshness {
  const lastIntradayRefreshAt = latestTimestamp(input.intradayTimestamps);
  let severity: Severity;
  let label: string;
  if (lastIntradayRefreshAt) {
    severity = deriveAgeSeverity(lastIntradayRefreshAt, nowMs, intradayThresholdMin);
    label = severity === "ok" ? "Live" : severity === "stale" ? "Slightly stale" : "Stale";
  } else if (input.scanDate) {
    severity = "disabled";
    label = "Daily scan only";
  } else {
    severity = "fail";
    label = "No scan yet";
  }
  return { scanDate: input.scanDate, lastIntradayRefreshAt, severity, label };
}
