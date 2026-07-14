/**
 * Owner-only Data Infrastructure Health Dashboard (Priority 10).
 *
 * READ-ONLY surface. Consumes existing diagnostic + analytics endpoints
 * only. Does NOT trigger ingestion, signals, paper-trader, scanner, or
 * any write path. Safe to refresh at any cadence.
 *
 * Endpoints consumed:
 *   - GET /api/security/audit                                  (Security)
 *   - GET /api/stocks-to-watch/diagnostics/sector-coverage     (Sector map)
 *   - GET /api/option-snapshots/diagnostics                    (Snapshot ingestor)
 *   - GET /api/option-snapshots/analytics                      (Snapshot analytics, P9)
 *   - GET /api/candles/diagnostics                             (Candle warehouse)
 *   - GET /api/paper/eq/candidates-diagnostic                  (Equity sizing summary)
 *   - GET /api/paper/eq/sizing-preview?symbol=&entry=&stop=    (on-demand, owner-form)
 *
 * Layout:
 *   A. Security Status
 *   B. Indian Market Data Coverage (sector map + candle warehouse)
 *   C. F&O Data Infrastructure (snapshot diagnostics + analytics)
 *   D. Equity Risk Diagnostics (candidate histogram + on-demand sizing form)
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  Layers,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  TrendingUp,
  XCircle,
  Info,
  PauseCircle,
  Brain,
  Radio,
  Receipt,
  KeyRound,
  Signal,
} from "lucide-react";
import { Seo } from "@/components/seo";
import {
  deriveCandleSeverity,
  deriveCoverageSeverity,
  deriveExitMonitorSeverity,
  deriveSnapshotSectionSeverity,
  deriveSnapshotSeverity,
  deriveSystemAlertHealthSeverity,
  formatAge,
  rollUp,
  SEVERITY_LABEL,
  type Severity,
  type SnapshotDiagnostics,
  type CandleIntervalRow,
  type ExitMonitorHealthLite,
  type SubsystemHealthLite,
  type SystemAlertHealthDiag,
  dataParitySeverityForOverall,
  deriveDataParitySectionSeverity,
  type DataParityOverallSeverity,
  type DataParityResultLite,
} from "@/lib/infraHealth";
import { GateStatusPanel } from "@/components/infra/GateStatusPanel";
import { SwingFreshnessPanel } from "@/components/infra/SwingFreshnessPanel";
import { FoEvidencePanel } from "@/components/infra/FoEvidencePanel";
import { ShadowDiagnosticsPanel } from "@/components/infra/ShadowDiagnosticsPanel";
import { SectorStrengthPanel } from "@/components/infra/SectorStrengthPanel";
import { SystemModePanel } from "@/components/infra/system-mode-panel";
import { ReconciliationPanel } from "@/components/infra/reconciliation-panel";

const REFRESH_MS = 60_000;

// ── shared visual primitives ────────────────────────────────────────────────

function SeverityIcon({ s, className }: { s: Severity; className?: string }) {
  const cls = className ?? "h-4 w-4";
  if (s === "ok") return <CheckCircle2 className={`${cls} text-emerald-500`} aria-hidden />;
  if (s === "warn") return <AlertTriangle className={`${cls} text-amber-500`} aria-hidden />;
  if (s === "stale") return <AlertTriangle className={`${cls} text-amber-500`} aria-hidden />;
  if (s === "disabled") return <PauseCircle className={`${cls} text-muted-foreground`} aria-hidden />;
  return <XCircle className={`${cls} text-rose-500`} aria-hidden />;
}

function SeverityBadge({ s }: { s: Severity }) {
  const cls: Record<Severity, string> = {
    ok: "border-emerald-600 text-emerald-600",
    warn: "border-amber-600 text-amber-600",
    stale: "border-amber-600 text-amber-600",
    fail: "border-rose-600 text-rose-600",
    disabled: "border-muted-foreground text-muted-foreground",
  };
  return (
    <Badge variant="outline" className={cls[s]} data-testid={`badge-severity-${s}`}>
      {SEVERITY_LABEL[s]}
    </Badge>
  );
}

interface SectionShellProps {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  severity: Severity;
  description?: string;
  children: React.ReactNode;
  testId?: string;
}
function SectionShell({ title, icon: Icon, severity, description, children, testId }: SectionShellProps) {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Icon className="h-5 w-5" />
              {title}
            </CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </div>
          <div className="flex items-center gap-2">
            <SeverityIcon s={severity} />
            <SeverityBadge s={severity} />
          </div>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// ── async data hook (plain fetch, mirrors audit/status pages) ──────────────

interface FetchState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

function useEndpoint<T>(path: string, auto: boolean, refreshTick: number): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({ data: null, error: null, loading: true });
  const base = import.meta.env.BASE_URL;
  const url = `${base}${path.replace(/^\//, "")}`;

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as T;
      setState({ data: j, error: null, loading: false });
    } catch (e) {
      setState({ data: null, error: e instanceof Error ? e.message : "fetch failed", loading: false });
    }
  }, [url]);

  useEffect(() => { void load(); }, [load, refreshTick]);
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [auto, load]);

  return state;
}

// ── endpoint response shapes (loose — only what the dashboard renders) ─────

interface SecurityAuditCheck { id: string; status: "ok" | "warn" | "fail"; title: string; detail: string; category: string }
interface SecurityAudit {
  generatedAt: string;
  score: number;
  summary: { ok: number; warn: number; fail: number; total: number };
  checks: SecurityAuditCheck[];
}
interface SectorCoverage {
  generatedAt: string;
  lookup: { totalDistinctSymbols: number; sectorCoveragePct: number; industryCoveragePct: number; unmapped: number; unmappedSymbols: string[] };
  db: { totalRows: number; rowsWithSector: number; rowsWithIndustry: number; rowsMarkedUnmapped: number; sectorCoveragePct: number };
}
interface CandleDiag {
  generatedAt: string;
  config: { enabled: boolean; universes: string[]; intervals: string[] };
  byInterval: CandleIntervalRow[];
  perSymbolStaleTop100: Array<{ symbol: string; interval: string; latest_ts: string | null; rows: number }>;
}
interface AnalyticsGroup {
  underlying: string;
  expiry: string;
  capturedAt: string;
  staleness: { ageMinutes: number; isStale: boolean; thresholdMinutes: number };
  analytics: {
    pcr: number | null;
    ceTotalOi: number | null;
    peTotalOi: number | null;
    maxPainStrike: number | null;
    atmStrike: number | null;
    atmStraddle: { total: number | null } | null;
    highestCeOi: { strike: number; oi: number } | null;
    highestPeOi: { strike: number; oi: number } | null;
  };
}
interface AnalyticsResp {
  generatedAt: string;
  groupCount: number;
  groups: AnalyticsGroup[];
  universe: string[];
}
interface CandidatesDiag {
  generatedAt: string;
  candidatesEvaluated: number;
  acceptedCount: number;
  reasonHistogram: Record<string, number>;
  accountSnapshot: { balance: number; bookValue: number; openCount: number; ddDailyPct: number; ddWeeklyPct: number; ddMonthlyPct: number };
}
interface SizingPreviewResp {
  preview: { verdict: "ACCEPT" | "REJECT"; reason: string | null; qty?: number | null; capitalDeployed?: number | null; risk?: number | null };
  input: { symbol: string; entry: number; stop: number };
}
interface FnoSignalGapResp {
  generatedAt: string;
  lastSignal: {
    any: string | null;
    highConviction: string | null;
    baseline: string | null;
    paperTradeOpen: string | null;
  };
  gapTradingDays: number | null;
  gapReason: string;
  isDataRelatedGap: boolean;
  suppressionReasonDistribution: Array<{ reasonCode: string; count: number }>;
  diagnostics?: {
    environment: string;
    recentSignalCount: number;
    notificationStats: {
      sentLast7d: number;
      blockedLast7d: number;
      duplicateLast7d: number;
      failedLast7d: number;
      lastSentAt: string | null;
    };
  };
}

interface ParityLogRecord {
  id: string;
  eventId: string;
  domain: string;
  eventType: string;
  symbol: string;
  exchange: string;
  orderId: string | null;
  signalId: string | null;
  paperTradeId: string | null;
  messageHash: string;
  status: string;
  environment: string;
  destination: string;
  sentAt: string | null;
  createdAt: string;
}

interface ParityStatusResp {
  ok: boolean;
  summary: {
    tableReady: boolean;
    latestLogRecords: ParityLogRecord[];
    sentCount: number;
    blockedCount: number;
    duplicateCount: number;
    failedCount: number;
    blocksByReason: Record<string, number>;
    lastSwingEntry: ParityLogRecord | null;
    lastFnoEntry: ParityLogRecord | null;
    lastExit: ParityLogRecord | null;
    retrievedAt: string;
  };
}

interface SubsystemHealthResp {
  cyclesTotal?: number;
  runsTotal?: number;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorClass: string | null;
  lastErrorMessage: string | null;
}

interface ExitMonitorCycleStatsResp {
  checkedAt: string;
  openTradesScanned: number;
  quotesFetched: number;
  exitedCount: number;
  blockedCount: number;
  skippedCount: number;
  duplicateSkippedCount: number;
  staleDataCount: number;
  kiteUnavailableCount: number;
  blockedByReason: Record<string, number>;
  errors: number;
  durationMs: number;
  nextRunAt: string;
}

interface ExitMonitorStatusResp {
  generatedAt: string;
  exitMonitor: {
    cyclesTotal: number;
    exitedTotal: number;
    blockedTotal: number;
    errorsTotal: number;
    lastCycle: ExitMonitorCycleStatsResp | null;
    lastSuccessAt: string | null;
    lastErrorAt: string | null;
    lastErrorClass: string | null;
    lastErrorMessage: string | null;
    bootedAt: string;
  };
  premiumOverlay: SubsystemHealthResp & { stoppedTotal: number };
  orphanExit: SubsystemHealthResp & { closedTotal: number; lifecycleAdvanceFailures: number };
  mtmSweep: SubsystemHealthResp & { rowsUpdatedTotal: number };
  timeExit1520: SubsystemHealthResp & { rowsClosedTotal: number; lastRunAt: string | null };
  globalDataHealth: { gate: string; reason?: string | null } | Record<string, unknown>;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function num(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: digits });
}
function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

// ── section renderers ──────────────────────────────────────────────────────

function SecuritySection({ data, error, loading }: FetchState<SecurityAudit>): React.ReactElement {
  let severity: Severity = "ok";
  if (loading && !data) severity = "disabled";
  else if (error || !data) severity = "fail";
  else if (data.summary.fail > 0) severity = "fail";
  else if (data.summary.warn > 0) severity = "warn";

  // Surface the kite-token / secret-related checks specifically — that's
  // what this dashboard cares about. The full audit lives at /audit.
  const focused = (data?.checks ?? []).filter(
    (c) => c.category === "secrets" || /kite/i.test(c.id) || /kite/i.test(c.title) || /encrypt/i.test(c.title),
  );
  return (
    <SectionShell
      title="Security Status"
      icon={ShieldCheck}
      severity={severity}
      description="Kite token encryption-at-rest, secret presence, and export safety."
      testId="section-security"
    >
      {error && <div className="text-sm text-rose-500">Failed: {error}</div>}
      {loading && !data && <div className="text-sm text-muted-foreground">Loading…</div>}
      {data && (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            <Stat label="Score" value={`${data.score}/100`} tone={data.score >= 90 ? "ok" : data.score >= 75 ? "warn" : "fail"} />
            <Stat label="Pass" value={data.summary.ok} tone="ok" />
            <Stat label="Warn" value={data.summary.warn} tone={data.summary.warn ? "warn" : "ok"} />
            <Stat label="Fail" value={data.summary.fail} tone={data.summary.fail ? "fail" : "ok"} />
          </div>
          {focused.length > 0 ? (
            <ul className="space-y-1.5">
              {focused.map((c) => (
                <li key={c.id} className="flex items-start gap-2 text-xs">
                  <SeverityIcon s={c.status} className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <div>
                    <div className="font-medium">{c.title}</div>
                    <div className="text-muted-foreground">{c.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-muted-foreground">No Kite/secret-specific checks reported. See full audit.</div>
          )}
        </div>
      )}
    </SectionShell>
  );
}

function SectorSection({ data, error, loading }: FetchState<SectorCoverage>): React.ReactElement {
  const severity: Severity = error || (!data && !loading)
    ? "fail"
    : data ? deriveCoverageSeverity(data.lookup.sectorCoveragePct) : "disabled";
  return (
    <SectionShell
      title="Sector / Industry Mapping"
      icon={Layers}
      severity={severity}
      description="Symbol → {sector, industry} coverage for the swing-scan universe."
      testId="section-sector"
    >
      {error && <div className="text-sm text-rose-500">Failed: {error}</div>}
      {loading && !data && <div className="text-sm text-muted-foreground">Loading…</div>}
      {data && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <Kv label="Distinct symbols" value={num(data.lookup.totalDistinctSymbols)} />
            <Kv label="Sector coverage" value={pct(data.lookup.sectorCoveragePct)} />
            <Kv label="Industry coverage" value={pct(data.lookup.industryCoveragePct)} />
            <Kv label="Unmapped" value={num(data.lookup.unmapped)} tone={data.lookup.unmapped > 0 ? "warn" : "ok"} />
          </div>
          {data.lookup.unmappedSymbols.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Unmapped symbols ({data.lookup.unmappedSymbols.length})
              </summary>
              <div className="mt-2 font-mono text-[11px] text-muted-foreground break-words">
                {data.lookup.unmappedSymbols.join(", ")}
              </div>
            </details>
          )}
        </div>
      )}
    </SectionShell>
  );
}

function CandleSection({ data, error, loading, nowMs }: FetchState<CandleDiag> & { nowMs: number }): React.ReactElement {
  const result = data ? deriveCandleSeverity(data.byInterval, nowMs) : null;
  let severity: Severity = "disabled";
  if (error || (!data && !loading)) severity = "fail";
  else if (data) {
    if (!data.config.enabled) severity = "disabled";
    else severity = result?.severity ?? "fail";
  }
  return (
    <SectionShell
      title="Candle Warehouse"
      icon={Database}
      severity={severity}
      description={`Universes: ${data?.config.universes.join(", ") ?? "—"} · Intervals: ${data?.config.intervals.join(", ") ?? "—"}`}
      testId="section-candle"
    >
      {error && <div className="text-sm text-rose-500">Failed: {error}</div>}
      {loading && !data && <div className="text-sm text-muted-foreground">Loading…</div>}
      {data && (
        <div className="space-y-3">
          {!data.config.enabled && (
            <div className="text-xs text-muted-foreground">
              Ingestion env-gate is OFF in this environment. Read-only counts below reflect last-stored data.
            </div>
          )}
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border/50">
                <th className="text-left py-1.5">Interval</th>
                <th className="text-right py-1.5">Rows</th>
                <th className="text-right py-1.5">Symbols</th>
                <th className="text-right py-1.5">Latest</th>
                <th className="text-right py-1.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.byInterval.length === 0 && (
                <tr><td colSpan={5} className="py-2 text-muted-foreground italic">No candle rows present.</td></tr>
              )}
              {data.byInterval.map((row) => {
                const sev = result?.perInterval.find((p) => p.interval === row.interval)?.severity ?? "fail";
                return (
                  <tr key={row.interval} className="border-b border-border/30 last:border-b-0">
                    <td className="py-1.5 font-mono">{row.interval}</td>
                    <td className="text-right">{num(row.rows)}</td>
                    <td className="text-right">{num(row.distinct_symbols ?? null)}</td>
                    <td className="text-right text-muted-foreground">{formatAge(row.latest_ts, nowMs)}</td>
                    <td className="text-right"><SeverityBadge s={sev} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data.perSymbolStaleTop100.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Most-stale symbols ({Math.min(10, data.perSymbolStaleTop100.length)} of {data.perSymbolStaleTop100.length})
              </summary>
              <ul className="mt-2 space-y-1 font-mono text-[11px]">
                {data.perSymbolStaleTop100.slice(0, 10).map((p) => (
                  <li key={`${p.symbol}-${p.interval}`} className="flex justify-between">
                    <span>{p.symbol} <span className="text-muted-foreground">({p.interval})</span></span>
                    <span className="text-muted-foreground">{formatAge(p.latest_ts, nowMs)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </SectionShell>
  );
}

function SnapshotSection({
  diag, analytics, nowMs,
}: {
  diag: FetchState<SnapshotDiagnostics & { todayRowsWritten: number; recentRuns: Array<Record<string, unknown>> }>;
  analytics: FetchState<AnalyticsResp>;
  nowMs: number;
}): React.ReactElement {
  // Section badge rolls together both data planes — diagnostics AND
  // the Priority 9 analytics endpoint. If analytics is down, the
  // section must visibly reflect that even when diagnostics are green.
  const severity: Severity = deriveSnapshotSectionSeverity(diag, analytics, nowMs, 15);
  const reasons: string[] = diag.data ? deriveSnapshotSeverity(diag.data, nowMs, 15).reasons : [];
  return (
    <SectionShell
      title="F&amp;O Option-Chain Snapshots"
      icon={TrendingUp}
      severity={severity}
      description="Per-underlying coverage + Priority 9 read-only analytics (PCR, max pain, ATM straddle, top-OI strikes)."
      testId="section-snapshot"
    >
      {diag.error && <div className="text-sm text-rose-500">Diagnostics failed: {diag.error}</div>}
      {diag.loading && !diag.data && <div className="text-sm text-muted-foreground">Loading…</div>}
      {diag.data && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <Stat label="Today (rows)" value={num(diag.data.todayRowsTotal)} tone={diag.data.todayRowsTotal > 0 ? "ok" : "warn"} />
            <Stat label="Today (written)" value={num(diag.data.todayRowsWritten)} tone="info" />
            <Stat label="Underlyings" value={diag.data.coverage.length} tone={diag.data.coverage.length === diag.data.config.universe.length ? "ok" : "warn"} />
          </div>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border/50">
                <th className="text-left py-1.5">Underlying</th>
                <th className="text-right py-1.5">Expiries</th>
                <th className="text-right py-1.5">Strikes</th>
                <th className="text-right py-1.5">Rows today</th>
                <th className="text-right py-1.5">Latest</th>
              </tr>
            </thead>
            <tbody>
              {diag.data.coverage.map((c) => (
                <tr key={c.underlying} className="border-b border-border/30 last:border-b-0">
                  <td className="py-1.5 font-mono">{c.underlying}</td>
                  <td className="text-right">{num(c.distinct_expiries ?? null)}</td>
                  <td className="text-right">{num(c.distinct_strikes ?? null)}</td>
                  <td className="text-right">{num(c.rows_today ?? null)}</td>
                  <td className="text-right text-muted-foreground">{formatAge(c.latest_snapshot, nowMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {reasons.length > 0 && (
            <ul className="text-[11px] text-amber-600 space-y-0.5">
              {reasons.map((r, i) => <li key={i}>· {r}</li>)}
            </ul>
          )}

          {/* Analytics summary (Priority 9 endpoint) */}
          <div className="border-t border-border/50 pt-3">
            <div className="text-xs font-semibold mb-2 flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" /> Analytics summary (latest per expiry)
            </div>
            {analytics.error && <div className="text-xs text-rose-500">Analytics failed: {analytics.error}</div>}
            {analytics.loading && !analytics.data && <div className="text-xs text-muted-foreground">Loading…</div>}
            {analytics.data && analytics.data.groups.length === 0 && (
              <div className="text-xs text-muted-foreground italic">No analytics groups available.</div>
            )}
            {analytics.data && analytics.data.groups.length > 0 && (
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border/50">
                    <th className="text-left py-1.5">Underlying / Expiry</th>
                    <th className="text-right py-1.5">PCR</th>
                    <th className="text-right py-1.5">Max pain</th>
                    <th className="text-right py-1.5">ATM</th>
                    <th className="text-right py-1.5">Straddle</th>
                    <th className="text-right py-1.5">Top OI (CE/PE)</th>
                    <th className="text-right py-1.5">Captured</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.data.groups.map((g, i) => (
                    <tr key={`${g.underlying}-${g.expiry}-${i}`} className="border-b border-border/30 last:border-b-0">
                      <td className="py-1.5 font-mono">
                        {g.underlying} <span className="text-muted-foreground">{g.expiry}</span>
                      </td>
                      <td className="text-right">{g.analytics.pcr != null ? g.analytics.pcr.toFixed(2) : "—"}</td>
                      <td className="text-right">{num(g.analytics.maxPainStrike)}</td>
                      <td className="text-right">{num(g.analytics.atmStrike)}</td>
                      <td className="text-right">{num(g.analytics.atmStraddle?.total ?? null, 1)}</td>
                      <td className="text-right text-muted-foreground">
                        {g.analytics.highestCeOi ? num(g.analytics.highestCeOi.strike) : "—"} /{" "}
                        {g.analytics.highestPeOi ? num(g.analytics.highestPeOi.strike) : "—"}
                      </td>
                      <td className="text-right text-muted-foreground">
                        {g.staleness.isStale ? <span className="text-amber-500">{formatAge(g.capturedAt, nowMs)}</span> : formatAge(g.capturedAt, nowMs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </SectionShell>
  );
}

function EquitySection({
  cand, nowMs, refresh,
}: {
  cand: FetchState<CandidatesDiag>;
  nowMs: number;
  refresh: () => void;
}): React.ReactElement {
  // A green section here means the candidates endpoint loaded — it's
  // diagnostic, not a trading-state alarm. Empty histogram is fine.
  let severity: Severity = "ok";
  if (cand.loading && !cand.data) severity = "disabled";
  else if (cand.error || !cand.data) severity = "fail";

  // On-demand sizing-preview form
  const [symbol, setSymbol] = useState("");
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [previewState, setPreviewState] = useState<FetchState<SizingPreviewResp>>({ data: null, error: null, loading: false });
  const base = import.meta.env.BASE_URL;

  async function runPreview() {
    if (!symbol || !entry || !stop) {
      setPreviewState({ data: null, error: "Fill symbol, entry, and stop.", loading: false });
      return;
    }
    setPreviewState({ data: null, error: null, loading: true });
    try {
      const url = `${base}api/paper/eq/sizing-preview?symbol=${encodeURIComponent(symbol.toUpperCase())}&entry=${entry}&stop=${stop}`;
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as SizingPreviewResp;
      setPreviewState({ data: j, error: null, loading: false });
    } catch (e) {
      setPreviewState({ data: null, error: e instanceof Error ? e.message : "fetch failed", loading: false });
    }
  }

  return (
    <SectionShell
      title="Equity Risk Diagnostics"
      icon={Activity}
      severity={severity}
      description="Read-only mirror of openPaperEquityTrade gates. Does not place orders."
      testId="section-equity"
    >
      {cand.error && <div className="text-sm text-rose-500">Candidates failed: {cand.error}</div>}
      {cand.loading && !cand.data && <div className="text-sm text-muted-foreground">Loading…</div>}
      {cand.data && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <Stat label="Evaluated" value={cand.data.candidatesEvaluated} tone="info" />
            <Stat label="Would accept" value={cand.data.acceptedCount} tone={cand.data.acceptedCount > 0 ? "ok" : "warn"} />
            <Stat label="Open count" value={cand.data.accountSnapshot.openCount} tone="info" />
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <Stat label="DD daily" value={pct(cand.data.accountSnapshot.ddDailyPct)} tone={cand.data.accountSnapshot.ddDailyPct >= 2 ? "warn" : "ok"} />
            <Stat label="DD weekly" value={pct(cand.data.accountSnapshot.ddWeeklyPct)} tone={cand.data.accountSnapshot.ddWeeklyPct >= 4 ? "warn" : "ok"} />
            <Stat label="DD monthly" value={pct(cand.data.accountSnapshot.ddMonthlyPct)} tone={cand.data.accountSnapshot.ddMonthlyPct >= 8 ? "warn" : "ok"} />
          </div>
          {Object.keys(cand.data.reasonHistogram).length > 0 && (
            <div>
              <div className="text-xs font-semibold mb-1.5">Rejection histogram</div>
              <ul className="text-xs space-y-0.5">
                {Object.entries(cand.data.reasonHistogram)
                  .sort(([, a], [, b]) => b - a)
                  .map(([reason, count]) => (
                    <li key={reason} className="flex justify-between gap-2 border-b border-border/30 py-1 last:border-b-0">
                      <span className="font-mono text-[11px]">{reason}</span>
                      <span className="text-muted-foreground">{count}</span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* On-demand sizing preview — owner-only, read-only, no order placed */}
      <div className="border-t border-border/50 pt-3 mt-3">
        <div className="text-xs font-semibold mb-2">Run sizing preview (read-only)</div>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[110px]">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Symbol</label>
            <Input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="RELIANCE" className="h-8 text-xs" data-testid="input-sizing-symbol" />
          </div>
          <div className="w-24">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Entry</label>
            <Input value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="2500" className="h-8 text-xs" data-testid="input-sizing-entry" />
          </div>
          <div className="w-24">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Stop</label>
            <Input value={stop} onChange={(e) => setStop(e.target.value)} placeholder="2400" className="h-8 text-xs" data-testid="input-sizing-stop" />
          </div>
          <Button size="sm" variant="outline" onClick={() => void runPreview()} disabled={previewState.loading} data-testid="button-sizing-preview">
            {previewState.loading ? "Running…" : "Preview"}
          </Button>
          <Button size="sm" variant="ghost" onClick={refresh} title="Refresh dashboard">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
        {previewState.error && <div className="text-xs text-rose-500 mt-2">{previewState.error}</div>}
        {previewState.data && (
          <div className="mt-2 text-xs border border-border/50 rounded p-2" data-testid="preview-result">
            <div className="flex items-center gap-2">
              <SeverityIcon s={previewState.data.preview.verdict === "ACCEPT" ? "ok" : "warn"} className="h-3.5 w-3.5" />
              <span className="font-medium">
                {previewState.data.preview.verdict} {previewState.data.preview.reason ? `· ${previewState.data.preview.reason}` : ""}
              </span>
            </div>
            {previewState.data.preview.verdict === "ACCEPT" && (
              <div className="mt-1 text-muted-foreground">
                Qty {num(previewState.data.preview.qty ?? null)} · Capital ₹{num(previewState.data.preview.capitalDeployed ?? null)} · Risk ₹{num(previewState.data.preview.risk ?? null)}
              </div>
            )}
          </div>
        )}
      </div>
    </SectionShell>
  );
}

// ── ETF recognition diagnostic (data-driven priceability) ──────────────────

type EtfRecognitionSource = "seed" | "master" | "not_etf" | "kite_offline";
interface EtfSymbolRecognition {
  symbol: string;
  recognised: boolean;
  source: EtfRecognitionSource;
  kiteInstrumentsLoaded: boolean;
  instrumentsFetchedAt: string | null;
}
interface EtfDiagnosticsResp {
  seedCount: number;
  detectedCount: number | null;
  instrumentsFetchedAt: string | null;
  kiteInstrumentsLoaded: boolean;
  check: EtfSymbolRecognition | null;
}

const ETF_SOURCE_LABEL: Record<EtfRecognitionSource, string> = {
  seed: "Recognised via curated seed",
  master: "Recognised via live Kite master",
  not_etf: "Not a recognised ETF",
  kite_offline: "Kite offline — heuristic fallback",
};

function EtfRecognitionSection({
  diag, nowMs,
}: {
  diag: FetchState<EtfDiagnosticsResp>;
  nowMs: number;
}): React.ReactElement {
  // A green section means the live Kite master loaded and ETF detection ran.
  // Kite logged out → "disabled" (expected outside market hours / dev), not a
  // failure. A hard fetch error → "fail".
  let severity: Severity = "ok";
  if (diag.loading && !diag.data) severity = "disabled";
  else if (diag.error) severity = "fail";
  else if (diag.data && !diag.data.kiteInstrumentsLoaded) severity = "disabled";

  // On-demand single-symbol recognition check (read-only).
  const [symbol, setSymbol] = useState("");
  const [checkState, setCheckState] = useState<FetchState<EtfDiagnosticsResp>>({ data: null, error: null, loading: false });
  const base = import.meta.env.BASE_URL;

  async function runCheck() {
    const sym = symbol.trim().toUpperCase();
    if (!sym) {
      setCheckState({ data: null, error: "Enter a symbol to check.", loading: false });
      return;
    }
    setCheckState({ data: null, error: null, loading: true });
    try {
      const url = `${base}api/etf/diagnostics?symbol=${encodeURIComponent(sym)}`;
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as EtfDiagnosticsResp;
      setCheckState({ data: j, error: null, loading: false });
    } catch (e) {
      setCheckState({ data: null, error: e instanceof Error ? e.message : "fetch failed", loading: false });
    }
  }

  const check = checkState.data?.check ?? null;

  return (
    <SectionShell
      title="ETF Priceability"
      icon={Layers}
      severity={severity}
      description="Which NSE ETFs the app can price live. Detection is data-driven off the live Kite instrument master (no hardcoded list). Read-only; reuses the 24h instrument cache."
      testId="section-etf"
    >
      {diag.error && <div className="text-sm text-rose-500">Diagnostics failed: {diag.error}</div>}
      {diag.loading && !diag.data && <div className="text-sm text-muted-foreground">Loading…</div>}
      {diag.data && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <Stat
              label="Detected (live master)"
              value={diag.data.detectedCount == null ? "—" : diag.data.detectedCount}
              tone={diag.data.detectedCount == null ? "warn" : diag.data.detectedCount > 0 ? "ok" : "warn"}
            />
            <Stat label="Curated seed" value={diag.data.seedCount} tone="info" />
            <Stat label="Master age" value={formatAge(diag.data.instrumentsFetchedAt, nowMs)} tone="info" />
          </div>
          {!diag.data.kiteInstrumentsLoaded && (
            <div className="text-xs text-muted-foreground">
              <Info className="inline h-3 w-3 mr-1 align-middle" />
              Kite logged out — the live instrument master can't be loaded, so only the curated
              seed of {diag.data.seedCount} ETFs is recognised right now. Count refreshes once Kite reconnects.
            </div>
          )}
        </div>
      )}

      {/* On-demand single-symbol recognition check — read-only */}
      <div className="border-t border-border/50 pt-3 mt-3">
        <div className="text-xs font-semibold mb-2">Check a symbol (read-only)</div>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[120px]">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">ETF symbol</label>
            <Input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void runCheck(); }}
              placeholder="NIFTYBEES"
              className="h-8 text-xs"
              data-testid="input-etf-symbol"
            />
          </div>
          <Button size="sm" variant="outline" onClick={() => void runCheck()} disabled={checkState.loading} data-testid="button-etf-check">
            {checkState.loading ? "Checking…" : "Check"}
          </Button>
        </div>
        {checkState.error && <div className="text-xs text-rose-500 mt-2">{checkState.error}</div>}
        {check && (
          <div className="mt-2 text-xs border border-border/50 rounded p-2" data-testid="etf-check-result">
            <div className="flex items-center gap-2">
              <SeverityIcon s={check.recognised ? "ok" : "warn"} className="h-3.5 w-3.5" />
              <span className="font-medium font-mono">{check.symbol}</span>
              <span className="text-muted-foreground">·</span>
              <span className="font-medium">{check.recognised ? "Priceable" : "Not priceable"}</span>
            </div>
            <div className="mt-1 text-muted-foreground">{ETF_SOURCE_LABEL[check.source]}</div>
          </div>
        )}
      </div>
    </SectionShell>
  );
}

// ── Data Parity (Checkpoint 3) — cross-module symbol/index observation diff ─

const DATA_PARITY_SYMBOLS: ReadonlyArray<{ symbol: string; assetType: "index" | "equity" }> = [
  { symbol: "INDUSINDBK", assetType: "equity" },
  { symbol: "RELIANCE", assetType: "equity" },
  { symbol: "NIFTY", assetType: "index" },
  { symbol: "BANKNIFTY", assetType: "index" },
  { symbol: "SENSEX", assetType: "index" },
];

interface DataParityObservationResp {
  moduleId: string;
  moduleLabel: string;
  symbol: string;
  assetType: "index" | "equity";
  status: "OK" | "UNAVAILABLE";
  reason: string | null;
  kind: string;
  freshnessClass: "trade_grade" | "report_grade" | "cache" | "frozen" | "not_applicable";
  price: number | null;
  asOf: string | null;
  freshnessSec: number | null;
  source: string;
  trustTier: string | null;
  tradeGrade: boolean | null;
  capturedAt: string;
}
interface DataParityMismatchResp {
  severity: DataParityOverallSeverity;
  kind: string;
  moduleA: string;
  moduleB: string;
  valueA: number | string | boolean | null;
  valueB: number | string | boolean | null;
  description: string;
}
interface DataParityResultResp {
  symbol: string;
  assetType: "index" | "equity";
  capturedAt: string;
  observations: DataParityObservationResp[];
  mismatches: DataParityMismatchResp[];
  overallSeverity: DataParityOverallSeverity;
}
interface DataParityCheckResp {
  ok: boolean;
  capturedAt?: string;
  results?: DataParityResultResp[];
  error?: string;
  message?: string;
}

const PARITY_SEVERITY_BADGE: Record<DataParityOverallSeverity, string> = {
  OK: "border-emerald-600 text-emerald-600",
  INFO: "border-sky-600 text-sky-600",
  P2: "border-amber-600 text-amber-600",
  P1: "border-amber-600 text-amber-600",
  P0: "border-rose-600 text-rose-600",
};

function DataParitySection(): React.ReactElement {
  const base = import.meta.env.BASE_URL;
  const [selected, setSelected] = useState<Set<string>>(new Set(DATA_PARITY_SYMBOLS.map((s) => s.symbol)));
  const [state, setState] = useState<{ results: DataParityResultResp[] | null; error: string | null; loading: boolean }>({
    results: null,
    error: null,
    loading: false,
  });

  const severity = useMemo(
    () =>
      deriveDataParitySectionSeverity({
        results: state.results as DataParityResultLite[] | null,
        error: state.error,
        loading: state.loading,
      }),
    [state],
  );

  function toggle(symbol: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  }

  async function runCheck() {
    const symbols = Array.from(selected);
    if (symbols.length === 0) {
      setState({ results: null, error: "Select at least one symbol.", loading: false });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const r = await fetch(`${base}api/data-parity/check`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbols }),
      });
      const j = (await r.json()) as DataParityCheckResp;
      if (!r.ok || !j.ok) {
        setState({ results: null, error: j.message ?? j.error ?? `HTTP ${r.status}`, loading: false });
        return;
      }
      setState({ results: j.results ?? [], error: null, loading: false });
    } catch (e) {
      setState({ results: null, error: e instanceof Error ? e.message : "fetch failed", loading: false });
    }
  }

  return (
    <SectionShell
      title="Data Parity"
      icon={Signal}
      severity={severity}
      description="Checkpoint 3: compares how 13 read-only modules currently see the same symbol/index. Diagnostic-only, on-demand — does not run automatically and does not touch any trading, signal, or broker path."
      testId="section-data-parity"
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {DATA_PARITY_SYMBOLS.map(({ symbol }) => (
            <label key={symbol} className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={selected.has(symbol)}
                onChange={() => toggle(symbol)}
                data-testid={`checkbox-parity-${symbol}`}
              />
              <span className="font-mono">{symbol}</span>
            </label>
          ))}
          <Button size="sm" variant="outline" onClick={() => void runCheck()} disabled={state.loading} data-testid="button-run-parity-check">
            {state.loading ? "Checking…" : "Run parity check"}
          </Button>
        </div>

        {state.error && <div className="text-xs text-rose-500">{state.error}</div>}
        {!state.results && !state.loading && !state.error && (
          <div className="text-xs text-muted-foreground">
            <Info className="inline h-3 w-3 mr-1 align-middle" />
            Not yet run — this section stays idle until you trigger a check (it reads live Kite/F&O
            data per symbol, so it does not auto-refresh with the rest of the dashboard).
          </div>
        )}

        {state.results && (
          <div className="space-y-4" data-testid="parity-results">
            {state.results.map((result) => (
              <div key={result.symbol} className="border border-border/50 rounded p-2">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium text-sm">{result.symbol}</span>
                    <span className="text-xs text-muted-foreground">({result.assetType})</span>
                  </div>
                  <Badge
                    variant="outline"
                    className={PARITY_SEVERITY_BADGE[result.overallSeverity]}
                    data-testid={`badge-parity-${result.symbol}`}
                  >
                    {result.overallSeverity}
                  </Badge>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b border-border/30">
                        <th className="py-1 pr-2">Module</th>
                        <th className="py-1 pr-2">Status</th>
                        <th className="py-1 pr-2">Price</th>
                        <th className="py-1 pr-2">As of</th>
                        <th className="py-1 pr-2">Source</th>
                        <th className="py-1 pr-2">Trade-grade</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.observations.map((obs) => (
                        <tr key={obs.moduleId} className="border-b border-border/20 last:border-b-0">
                          <td className="py-1 pr-2">{obs.moduleLabel}</td>
                          <td className="py-1 pr-2">
                            {obs.status === "OK" ? (
                              <span className="text-emerald-600">OK</span>
                            ) : (
                              <span className="text-muted-foreground" title={obs.reason ?? undefined}>
                                UNAVAILABLE
                              </span>
                            )}
                          </td>
                          <td className="py-1 pr-2 font-mono">{obs.price != null ? num(obs.price) : "—"}</td>
                          <td className="py-1 pr-2">{formatAge(obs.asOf, Date.now())}</td>
                          <td className="py-1 pr-2">{obs.source}</td>
                          <td className="py-1 pr-2">
                            {obs.tradeGrade === null ? "—" : obs.tradeGrade ? "Yes" : "No"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {result.mismatches.length > 0 ? (
                  <div className="mt-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                      Mismatches
                    </div>
                    <ul className="space-y-1">
                      {result.mismatches.map((m, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-[11px]">
                          <SeverityIcon s={dataParitySeverityForOverall(m.severity)} className="h-3 w-3 mt-0.5 shrink-0" />
                          <span>
                            <span className="font-mono">{m.severity}</span> · {m.description}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="mt-2 text-[11px] text-emerald-600">No mismatches detected.</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </SectionShell>
  );
}

// ── P15: F&O Reasoning Analytics section ───────────────────────────────────

interface KeyCountRow { key: string; count: number }
interface SetupBreakdownRow {
  setupKey: string;
  total: number; emitted: number; preEmissionRejected: number; opened: number;
  skipped: number; stopped: number; target1: number; target2: number;
  expired: number; forceExit: number; manualClose: number; demoted: number;
  avgConfidence: number | null; avgConfluence: number | null;
}
interface IndexBreakdownRow {
  indexSymbol: string; total: number; emitted: number; opened: number;
  stopped: number; targetHit: number; expired: number;
}
interface ReasoningAnalyticsResp {
  filters: { latestN: number; from?: string; to?: string };
  analytics: {
    generatedAt: string;
    rowCount: number;
    windowFrom: string | null;
    windowTo: string | null;
    bySetup: SetupBreakdownRow[];
    byIndex: IndexBreakdownRow[];
    byDemotionTag: KeyCountRow[];
    byMissingData: KeyCountRow[];
    byDecision: KeyCountRow[];
    byReasonCode: KeyCountRow[];
    stoppedBySetup: KeyCountRow[];
    stoppedByIndex: KeyCountRow[];
    stoppedByConfidenceBucket: KeyCountRow[];
    rejectedReasonBySetup: Array<{ setupKey: string; reasonCode: string; count: number }>;
    t1ThenStoppedGroups: number;
    t1ThenStopped: {
      exact: number; proxy: number;
      mode: "exact" | "proxy" | "hybrid";
      rowsWithFingerprint: number; rowsWithoutFingerprint: number;
      proxyMethod: string; limitation: string;
    };
    lowWinRateDemotions: number;
    rowSampleType: string;
  };
}

function MiniHist({ rows, max = 6 }: { rows: KeyCountRow[]; max?: number }) {
  if (rows.length === 0) return <div className="text-xs text-muted-foreground">no data yet</div>;
  const top = Math.max(...rows.slice(0, max).map(r => r.count), 1);
  return (
    <div className="space-y-1">
      {rows.slice(0, max).map(r => (
        <div key={r.key} className="flex items-center gap-2 text-xs">
          <div className="w-32 truncate font-mono" title={r.key}>{r.key}</div>
          <div className="flex-1 h-2 bg-muted rounded overflow-hidden">
            <div className="h-full bg-primary/60" style={{ width: `${(r.count / top) * 100}%` }} />
          </div>
          <div className="w-8 text-right font-mono">{r.count}</div>
        </div>
      ))}
    </div>
  );
}

function ReasoningSection({ data, error, loading }: FetchState<ReasoningAnalyticsResp>): React.ReactElement {
  let severity: Severity = "ok";
  if (loading && !data) severity = "disabled";
  else if (error) severity = "warn";
  else if (!data || data.analytics.rowCount === 0) severity = "disabled";
  else if (data.analytics.lowWinRateDemotions > 0 || data.analytics.byMissingData.length > 0) severity = "warn";

  const a = data?.analytics;
  const topFailingSetups = useMemo(() => {
    if (!a) return [] as KeyCountRow[];
    return a.bySetup
      .filter(s => s.stopped + s.expired + s.demoted > 0)
      .map(s => ({ key: s.setupKey, count: s.stopped + s.expired + s.demoted }))
      .sort((x, y) => y.count - x.count)
      .slice(0, 6);
  }, [a]);

  const topRejectedReasons = useMemo(() => {
    if (!a) return [] as KeyCountRow[];
    const m = new Map<string, number>();
    for (const r of a.rejectedReasonBySetup) m.set(r.reasonCode, (m.get(r.reasonCode) ?? 0) + r.count);
    return Array.from(m, ([key, count]) => ({ key, count })).sort((x, y) => y.count - x.count);
  }, [a]);

  return (
    <SectionShell
      title="F&O Reasoning Analytics"
      icon={Brain}
      severity={severity}
      description="Read-only roll-up over the fno_signal_reasoning substrate (P14 + P14b + P15b fingerprint). Counts are event-rows, not unique signals. T1→stop shows `exact+proxyP` where exact uses signal_fingerprint and proxy is the legacy 4-tuple fallback. No trade or signal effect."
      testId="section-reasoning"
    >
      {error && <div className="text-xs text-rose-500 mb-2" data-testid="reasoning-error">{error}</div>}
      {!a && !error && <div className="text-xs text-muted-foreground">Loading…</div>}
      {a && a.rowCount === 0 && (
        <div className="text-xs text-muted-foreground">
          No reasoning rows yet — once P14 / P14b loggers have captured data this panel will populate.
        </div>
      )}
      {a && a.rowCount > 0 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <Stat label="Rows analysed" value={num(a.rowCount)} tone="info" />
            <Stat label="Window" value={a.windowFrom && a.windowTo ? `${a.windowFrom} → ${a.windowTo}` : "—"} tone="info" />
            <div title={`mode=${a.t1ThenStopped.mode} · exact=${a.t1ThenStopped.exact} · proxy=${a.t1ThenStopped.proxy} · ${a.t1ThenStopped.limitation}`}>
              <Stat
                label={`T1 → stop (${a.t1ThenStopped.mode})`}
                value={`${a.t1ThenStopped.exact}+${a.t1ThenStopped.proxy}p`}
                tone={a.t1ThenStoppedGroups > 0 ? "warn" : "ok"}
              />
            </div>
            <Stat label="Low-WR demotions" value={a.lowWinRateDemotions} tone={a.lowWinRateDemotions > 0 ? "warn" : "ok"} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Top failing setups (stop+expire+demote)</div>
              <MiniHist rows={topFailingSetups} />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Top rejected reasons</div>
              <MiniHist rows={topRejectedReasons} />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Stop-loss by setup</div>
              <MiniHist rows={a.stoppedBySetup} />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Stop-loss by index</div>
              <MiniHist rows={a.stoppedByIndex} />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Demotion tags</div>
              <MiniHist rows={a.byDemotionTag} />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Missing-data warnings</div>
              {a.byMissingData.length === 0
                ? <div className="text-xs text-emerald-500">No missing-data flags raised.</div>
                : <MiniHist rows={a.byMissingData} />}
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Decision histogram</div>
              <MiniHist rows={a.byDecision} max={8} />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Stopped by confidence bucket</div>
              <MiniHist rows={a.stoppedByConfidenceBucket} />
            </div>
          </div>

          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Setup detail (top 8 by volume)</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border/50">
                    <th className="text-left py-1 pr-2">Setup</th>
                    <th className="text-right px-2">Total</th>
                    <th className="text-right px-2">Emit</th>
                    <th className="text-right px-2">Open</th>
                    <th className="text-right px-2">Stop</th>
                    <th className="text-right px-2">T1</th>
                    <th className="text-right px-2">T2</th>
                    <th className="text-right px-2">Exp</th>
                    <th className="text-right px-2">Demote</th>
                    <th className="text-right px-2">Avg Conf</th>
                  </tr>
                </thead>
                <tbody>
                  {a.bySetup.slice(0, 8).map(s => (
                    <tr key={s.setupKey} className="border-b border-border/30">
                      <td className="text-left py-1 pr-2 truncate" title={s.setupKey}>{s.setupKey}</td>
                      <td className="text-right px-2">{s.total}</td>
                      <td className="text-right px-2">{s.emitted}</td>
                      <td className="text-right px-2">{s.opened}</td>
                      <td className={`text-right px-2 ${s.stopped > 0 ? "text-rose-500" : ""}`}>{s.stopped}</td>
                      <td className={`text-right px-2 ${s.target1 > 0 ? "text-emerald-500" : ""}`}>{s.target1}</td>
                      <td className={`text-right px-2 ${s.target2 > 0 ? "text-emerald-500" : ""}`}>{s.target2}</td>
                      <td className="text-right px-2">{s.expired}</td>
                      <td className="text-right px-2">{s.demoted}</td>
                      <td className="text-right px-2">{s.avgConfidence ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </SectionShell>
  );
}

// ── P16: F&O Failure Diagnosis Report ──────────────────────────────────────

interface FailureHypothesis {
  id: string;
  label: string;
  status: "proven" | "likely" | "insufficient_data" | "undetermined";
  sampleSize: number;
  evidence: string;
}
interface FailureRecommendation {
  priority: number;
  label: string;
  rationale: string;
  sampleBacking: number;
}
interface FailureDiagnosisResp {
  filters: { exactOnly?: boolean; latestN: number; from?: string; to?: string };
  report: {
    generatedAt: string;
    rowCount: number;
    windowFrom: string | null;
    windowTo: string | null;
    setupAnalysis: Array<{
      setupKey: string; total: number; emitted: number; opened: number;
      stopped: number; target1: number; target2: number; expired: number;
      demoted: number; stopRate: number | null; targetHitRate: number | null;
    }>;
    indexAnalysis: Array<{
      indexSymbol: string; total: number; opened: number; stopped: number;
      targetHit: number; expired: number; realizedPnl: number;
      stopRate: number | null; targetHitRate: number | null;
    }>;
    tierAnalysis: Array<{
      tier: string; total: number; opened: number; stopped: number;
      target1: number; target2: number; expired: number; realizedPnl: number;
      stopRate: number | null; targetHitRate: number | null;
    }>;
    tierVerdict: {
      hcOutperformsBaseline: boolean | null;
      hcStopRate: number | null; baselineStopRate: number | null;
      hcSampleSize: number; baselineSampleSize: number;
    };
    lifecycleFunnel: {
      mode: "exact" | "proxy" | "hybrid";
      rowsWithFingerprint: number; rowsWithoutFingerprint: number;
      emitted: number; opened: number; target1: number; target2: number;
      stopped: number; expired: number; preEmissionRejected: number;
      demoted: number; emittedNeverOpenedExact: number;
      target1ThenStoppedExact: number; target1ToTarget2Exact: number;
      conversion: {
        emittedToOpened: number | null;
        openedToTarget1: number | null;
        openedToStopped: number | null;
        target1ToTarget2: number | null;
        target1ToStopped: number | null;
      };
    };
    stopLossDeepDive: {
      totalStops: number; afterT1Stops: number;
      bySetup: KeyCountRow[]; byIndex: KeyCountRow[];
      byConfidenceBucket: KeyCountRow[]; byRegime: KeyCountRow[];
      concentration: {
        topSetup: { key: string; share: number } | null;
        topIndex: { key: string; share: number } | null;
        topRegime: { key: string; share: number } | null;
      };
    };
    untriggeredAnalysis: {
      expired: number; emittedNeverOpenedExact: number; skipped: number;
      lateSessionEmissions: number; lateSessionShare: number | null;
      bySkipReason: KeyCountRow[]; expiredBySetup: KeyCountRow[];
    };
    missingDataAnalysis: {
      byMissingField: KeyCountRow[]; byDemotionTag: KeyCountRow[];
      demotedThenOpenedExact: number; demotedThenOpenedAndStoppedExact: number;
      lowWinRateDemotions: number;
      missingFieldStopCorrelation: Array<{
        field: string; emittedSample: number; openedSample: number;
        stopped: number; stopRate: number | null;
      }>;
    };
    hypotheses: FailureHypothesis[];
    recommendedNextSteps: FailureRecommendation[];
    notes: string[];
  };
}

function StatusPill({ s }: { s: FailureHypothesis["status"] }) {
  const cls: Record<typeof s, string> = {
    proven: "bg-rose-500/20 text-rose-300 border-rose-500/40",
    likely: "bg-amber-500/20 text-amber-300 border-amber-500/40",
    insufficient_data: "bg-muted text-muted-foreground border-border/50",
    undetermined: "bg-muted text-muted-foreground border-border/50",
  };
  return (
    <span className={`text-[10px] uppercase tracking-wide font-mono px-1.5 py-0.5 rounded border ${cls[s]}`}>
      {s.replace("_", " ")}
    </span>
  );
}

interface ObservabilityResp {
  verdict: "OK" | "WARN" | "FAIL";
  reasons: string[];
  today: string;
  autoTradingEnabled: boolean;
  loggerHealth: {
    writesAttempted: number;
    writesSucceeded: number;
    writesFailed: number;
    lastSuccessAt: string | null;
    lastErrorAt: string | null;
    lastErrorClass: string | null;
    lastErrorMessage: string | null;
    bootedAt: string;
  };
  durable: {
    totalRows: number;
    lastCapturedAt: string | null;
    rowsToday: number;
    decisionsToday: Record<string, number>;
    upstreamToday: number;
    downstreamToday: number;
    fingerprintedToday: number;
    fingerprintCoveragePctToday: number | null;
    skippedReasonsDurableToday: number;
  };
  missedRing: { bufferSize: number; rowsForToday: number };
  setupKey: {
    knownValidKeys: string[];
    distribution: Array<{ setupKey: string; count: number; looksValid: boolean; looksTierLike: boolean }>;
    anyUnknown: boolean;
    baselineDetectorCount: number;
  };
  generatedAt: string;
}

function ObservabilitySection({ data, error, loading }: FetchState<ObservabilityResp>): React.ReactElement {
  let severity: Severity = "ok";
  if (loading && !data) severity = "disabled";
  else if (error) severity = "fail";
  else if (data?.verdict === "FAIL") severity = "fail";
  else if (data?.verdict === "WARN") severity = "warn";

  const d = data;
  return (
    <SectionShell
      title="F&O Observability Substrate (P17a)"
      icon={Radio}
      severity={severity}
      description="Verifies the reasoning logger is actually writing rows. Surfaces process-local logger counters, today's decision histogram from fno_signal_reasoning, fingerprint coverage, durable skip-reason count, and setup_key validity. Read-only; no signal/exec/scheduler changes."
      testId="section-observability"
    >
      {error && <div className="text-xs text-rose-500 mb-2" data-testid="observability-error">{error}</div>}
      {!d && !error && <div className="text-xs text-muted-foreground">Loading…</div>}
      {d && (
        <div className="space-y-4">
          {d.reasons.length > 0 && (
            <ul className="text-xs space-y-1">
              {d.reasons.map((r, i) => (
                <li key={i} className="flex items-start gap-2">
                  <SeverityIcon s={d.verdict === "FAIL" ? "fail" : "warn"} className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span className="text-muted-foreground">{r}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <Stat label="Rows today" value={num(d.durable.rowsToday)} tone={d.durable.rowsToday > 0 ? "ok" : "warn"} />
            <Stat label="Rows total" value={num(d.durable.totalRows)} tone={d.durable.totalRows > 0 ? "ok" : "warn"} />
            <Stat label="Upstream today" value={num(d.durable.upstreamToday)} tone="info" />
            <Stat label="Downstream today" value={num(d.durable.downstreamToday)} tone="info" />
            <Stat label="Skips persisted today" value={num(d.durable.skippedReasonsDurableToday)} tone="info" />
            <Stat
              label="Fingerprint coverage"
              value={d.durable.fingerprintCoveragePctToday == null ? "—" : `${d.durable.fingerprintCoveragePctToday.toFixed(1)}%`}
              tone={d.durable.fingerprintCoveragePctToday == null ? "info" : d.durable.fingerprintCoveragePctToday >= 90 ? "ok" : "warn"}
            />
            <Stat label="Ring buffer (process)" value={`${d.missedRing.rowsForToday} / ${d.missedRing.bufferSize}`} tone="info" />
            <Stat label="Auto-trader" value={d.autoTradingEnabled ? "ON" : "OFF"} tone={d.autoTradingEnabled ? "ok" : "warn"} />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Logger health (process-local)</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 text-xs">
              <Kv label="Writes attempted" value={num(d.loggerHealth.writesAttempted)} />
              <Kv label="Writes succeeded" value={num(d.loggerHealth.writesSucceeded)} tone="ok" />
              <Kv label="Writes failed" value={num(d.loggerHealth.writesFailed)} tone={d.loggerHealth.writesFailed ? "fail" : "ok"} />
              <Kv label="Booted" value={d.loggerHealth.bootedAt ? new Date(d.loggerHealth.bootedAt).toLocaleString() : "—"} />
              <Kv label="Last success" value={d.loggerHealth.lastSuccessAt ? new Date(d.loggerHealth.lastSuccessAt).toLocaleString() : "—"} />
              <Kv label="Last error" value={d.loggerHealth.lastErrorAt ? `${d.loggerHealth.lastErrorClass}: ${d.loggerHealth.lastErrorMessage}` : "—"} tone={d.loggerHealth.lastErrorAt ? "fail" : "ok"} />
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
              Today decisions ({d.today})
            </div>
            {Object.keys(d.durable.decisionsToday).length === 0 ? (
              <div className="text-xs text-muted-foreground">No reasoning rows captured for today yet.</div>
            ) : (
              <div className="flex flex-wrap gap-2 text-[10px] font-mono">
                {Object.entries(d.durable.decisionsToday).sort((a,b) => b[1] - a[1]).map(([k, v]) => (
                  <span key={k} className="px-1.5 py-0.5 rounded border border-border/40">{k}: {v}</span>
                ))}
              </div>
            )}
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
              paper_trade_fo.setup_key distribution (sanity check)
            </div>
            <div className="text-[11px] text-muted-foreground mb-1">
              "BASELINE" is a legitimate always-on directional detector in optionSignals.ts (not a tier conflation).
            </div>
            <div className="space-y-1 text-xs">
              {d.setupKey.distribution.length === 0 && (
                <div className="text-muted-foreground">No paper_trade_fo rows yet.</div>
              )}
              {d.setupKey.distribution.map(s => (
                <div key={s.setupKey} className="flex items-center gap-2 border-b border-border/30 py-0.5">
                  <span className="font-mono text-xs flex-1">{s.setupKey}</span>
                  <span className="font-mono text-xs text-muted-foreground w-12 text-right">{s.count}</span>
                  <span className={`text-[10px] font-mono px-1 rounded border ${s.looksValid ? "border-emerald-600 text-emerald-600" : "border-rose-600 text-rose-600"}`}>
                    {s.looksValid ? "valid" : "unknown"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </SectionShell>
  );
}

interface ShadowCostsGroup {
  key: string;
  trades: number;
  computable: number;
  grossPnl: number;
  totalCost: number;
  netPnl: number;
  grossWinRate: number | null;
  netWinRate: number | null;
  avgCost: number;
  flippedToLoss: number;
}
interface ShadowCostsResp {
  enabled: boolean;
  generatedAt: string;
  rowCount: number;
  computableCount: number;
  totals: {
    grossPnl: number;
    totalCost: number;
    netPnl: number;
    avgCostPerTrade: number;
    avgCostPctOfPremium: number | null;
    grossWins: number;
    grossLosses: number;
    netWins: number;
    netLosses: number;
    flippedToLossCount: number;
  };
  bySetup: ShadowCostsGroup[];
  byIndex: ShadowCostsGroup[];
  byTier: ShadowCostsGroup[];
  byExitReason: ShadowCostsGroup[];
  flippedToLossTopN: Array<{
    id: string; signalDate: string; indexSymbol: string; setupKey: string;
    tier: string | null; direction: string; exitReason: string | null;
    grossPnl: number; totalCost: number; netPnl: number; costPctOfPremium: number | null;
  }>;
  parameters: Record<string, number> | null;
  note?: string;
}

function inr(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v < 0 ? "-" : "";
  return `${sign}₹${Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function ShadowCostsSection({ data, error, loading }: FetchState<ShadowCostsResp>): React.ReactElement {
  let severity: Severity = "ok";
  if (loading && !data) severity = "disabled";
  else if (error) severity = "fail";
  else if (data && !data.enabled) severity = "disabled";
  else if (data && data.computableCount === 0) severity = "disabled";
  else if (data && data.totals.flippedToLossCount > 0) severity = "warn";

  const d = data;
  return (
    <SectionShell
      title="F&O Shadow Costs (P17b — reporting only)"
      icon={Receipt}
      severity={severity}
      description="Brokerage + STT + exchange + SEBI + GST + stamp duty + spread + slippage estimates applied to every CLOSED paper_trade_fo row. SHADOW-ONLY: never feeds realised P&L, DD caps, heat caps, gates, or any trading decision. Toggle via PAPER_FO_COSTS_SHADOW_ENABLED."
      testId="section-shadow-costs"
    >
      {error && <div className="text-xs text-rose-500 mb-2" data-testid="shadow-costs-error">{error}</div>}
      {!d && !error && <div className="text-xs text-muted-foreground">Loading…</div>}
      {d && !d.enabled && (
        <div className="text-xs text-muted-foreground" data-testid="shadow-costs-disabled">
          {d.note ?? "Disabled by feature flag."}
        </div>
      )}
      {d && d.enabled && d.computableCount === 0 && (
        <div className="text-xs text-muted-foreground">
          No CLOSED paper_trade_fo rows in range — once trades close this report will populate.
        </div>
      )}
      {d && d.enabled && d.computableCount > 0 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <Stat label="Trades (closed)" value={num(d.computableCount)} tone="info" />
            <Stat label="Gross P&L" value={inr(d.totals.grossPnl)} tone={d.totals.grossPnl >= 0 ? "ok" : "fail"} />
            <Stat label="Estimated costs" value={inr(d.totals.totalCost)} tone="warn" />
            <Stat label="Shadow net P&L" value={inr(d.totals.netPnl)} tone={d.totals.netPnl >= 0 ? "ok" : "fail"} />
            <Stat label="Avg cost / trade" value={inr(d.totals.avgCostPerTrade)} tone="info" />
            <Stat
              label="Avg cost % of premium"
              value={d.totals.avgCostPctOfPremium == null ? "—" : `${d.totals.avgCostPctOfPremium.toFixed(2)}%`}
              tone="info"
            />
            <Stat
              label="Gross win-rate"
              value={
                d.totals.grossWins + d.totals.grossLosses === 0
                  ? "—"
                  : `${((d.totals.grossWins / (d.totals.grossWins + d.totals.grossLosses)) * 100).toFixed(1)}%`
              }
              tone="ok"
            />
            <Stat
              label="Net win-rate (after costs)"
              value={
                d.totals.netWins + d.totals.netLosses === 0
                  ? "—"
                  : `${((d.totals.netWins / (d.totals.netWins + d.totals.netLosses)) * 100).toFixed(1)}%`
              }
              tone={d.totals.netWins >= d.totals.grossWins ? "ok" : "warn"}
            />
            <Stat
              label="Flipped to net loss"
              value={num(d.totals.flippedToLossCount)}
              tone={d.totals.flippedToLossCount > 0 ? "warn" : "ok"}
            />
          </div>

          <ShadowGrid title="By setup" rows={d.bySetup} />
          <ShadowGrid title="By index" rows={d.byIndex} />
          <ShadowGrid title="By tier" rows={d.byTier} />
          <ShadowGrid title="By exit reason" rows={d.byExitReason} />{/* /shadow-costs */}

          {d.flippedToLossTopN.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                Apparent winners that flip to net loss after costs (top {d.flippedToLossTopN.length})
              </div>
              <div className="space-y-1 text-xs">
                {d.flippedToLossTopN.map(t => (
                  <div key={t.id} className="flex flex-wrap items-center gap-2 border-b border-border/30 py-1">
                    <span className="font-mono text-[10px] text-muted-foreground">{t.signalDate}</span>
                    <span className="font-mono text-xs">{t.indexSymbol}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{t.setupKey}/{t.tier ?? "—"}/{t.direction}</span>
                    <span className="ml-auto font-mono text-emerald-500">+{inr(t.grossPnl)}</span>
                    <span className="font-mono text-amber-500">−{inr(t.totalCost)}</span>
                    <span className="font-mono text-rose-500">= {inr(t.netPnl)}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {t.costPctOfPremium == null ? "—" : `${t.costPctOfPremium.toFixed(2)}%`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <details className="text-[11px] text-muted-foreground">
            <summary className="cursor-pointer">Cost model parameters (read-only)</summary>
            {d.parameters && (
              <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[10px]">
                {JSON.stringify(d.parameters, null, 2)}
              </pre>
            )}
          </details>
        </div>
      )}
    </SectionShell>
  );
}

function ShadowGrid({ title, rows }: { title: string; rows: ShadowCostsGroup[] }): React.ReactElement | null {
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase text-muted-foreground">
            <tr className="border-b border-border/40">
              <th className="text-left py-1 pr-2">Key</th>
              <th className="text-right py-1 px-2">N</th>
              <th className="text-right py-1 px-2">Gross</th>
              <th className="text-right py-1 px-2">Cost</th>
              <th className="text-right py-1 px-2">Net</th>
              <th className="text-right py-1 px-2">Avg cost</th>
              <th className="text-right py-1 px-2">Gross WR</th>
              <th className="text-right py-1 px-2">Net WR</th>
              <th className="text-right py-1 pl-2">Flipped</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} className="border-b border-border/20">
                <td className="py-0.5 pr-2 font-mono">{r.key}</td>
                <td className="py-0.5 px-2 text-right font-mono">{r.computable}</td>
                <td className={`py-0.5 px-2 text-right font-mono ${r.grossPnl >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{inr(r.grossPnl)}</td>
                <td className="py-0.5 px-2 text-right font-mono text-amber-500">{inr(r.totalCost)}</td>
                <td className={`py-0.5 px-2 text-right font-mono ${r.netPnl >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{inr(r.netPnl)}</td>
                <td className="py-0.5 px-2 text-right font-mono">{inr(r.avgCost)}</td>
                <td className="py-0.5 px-2 text-right font-mono">{r.grossWinRate == null ? "—" : `${(r.grossWinRate * 100).toFixed(0)}%`}</td>
                <td className="py-0.5 px-2 text-right font-mono">{r.netWinRate == null ? "—" : `${(r.netWinRate * 100).toFixed(0)}%`}</td>
                <td className={`py-0.5 pl-2 text-right font-mono ${r.flippedToLoss > 0 ? "text-amber-500" : ""}`}>{r.flippedToLoss}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ───────────────── P20: Shadow Exits ───────────────────────────────── */

interface ShadowExitsGroupRow {
  key: string;
  trades: number;
  mfeAvailableCount: number;
  actualPnl: number;
  rule1Pnl: number; rule2Pnl: number; rule3Pnl: number; rule4Pnl: number;
  rule1Delta: number; rule2Delta: number; rule3Delta: number; rule4Delta: number;
  rule1Better: number; rule1Worse: number;
  rule2Better: number; rule2Worse: number;
  rule3Better: number; rule3Worse: number;
  rule4Better: number; rule4Worse: number;
}
interface ShadowExitsTradeRow {
  id: string; signalDate: string; indexSymbol: string; setupKey: string;
  tier: string | null; direction: string; exitReason: string | null;
  entryPremium: number; exitPremium: number;
  mfeAbs: number; mfeAvailable: boolean;
  actualPnl: number;
  rule1Pnl: number; rule2Pnl: number; rule3Pnl: number; rule4Pnl: number;
  bestRule: "RULE_1" | "RULE_2" | "RULE_3" | "RULE_4";
  bestDelta: number;
}
interface ShadowExitsResp {
  enabled: boolean;
  generatedAt: string;
  rowCount: number;
  mfeAvailableCount: number;
  lowSampleWarning: boolean;
  lowSampleThreshold: number;
  totals: {
    actualPnl: number;
    rule1Pnl: number; rule2Pnl: number; rule3Pnl: number; rule4Pnl: number;
    rule1Delta: number; rule2Delta: number; rule3Delta: number; rule4Delta: number;
    rule1Better: number; rule1Worse: number;
    rule2Better: number; rule2Worse: number;
    rule3Better: number; rule3Worse: number;
    rule4Better: number; rule4Worse: number;
    bestRule: "RULE_1" | "RULE_2" | "RULE_3" | "RULE_4" | null;
    bestRuleDelta: number;
  };
  bySetup: ShadowExitsGroupRow[];
  byIndex: ShadowExitsGroupRow[];
  byTier: ShadowExitsGroupRow[];
  improvedTopN: ShadowExitsTradeRow[];
  reducedTopN: ShadowExitsTradeRow[];
  parameters: unknown;
  limitations: string[];
  note?: string;
}

const RULE_LABELS: Record<"RULE_1" | "RULE_2" | "RULE_3" | "RULE_4", string> = {
  RULE_1: "R1 (T1+30/T2+60)",
  RULE_2: "R2 (50%@+30 → BE)",
  RULE_3: "R3 (50%@+50 → BE)",
  RULE_4: "R4 (BE after +50%)",
};

function ShadowExitsGrid({ title, rows }: { title: string; rows: ShadowExitsGroupRow[] }): React.ReactElement | null {
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase text-muted-foreground">
            <tr className="border-b border-border/40">
              <th className="text-left py-1 pr-2">Key</th>
              <th className="text-right py-1 px-2">N</th>
              <th className="text-right py-1 px-2">MFE OK</th>
              <th className="text-right py-1 px-2">Actual</th>
              <th className="text-right py-1 px-2">R1 Δ</th>
              <th className="text-right py-1 px-2">R2 Δ</th>
              <th className="text-right py-1 px-2">R3 Δ</th>
              <th className="text-right py-1 px-2">R4 Δ</th>
              <th className="text-right py-1 pl-2">R1/R2/R3/R4 better</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const tone = (d: number) =>
                d > 0 ? "text-emerald-500" : d < 0 ? "text-rose-500" : "";
              return (
                <tr key={r.key} className="border-b border-border/20">
                  <td className="py-0.5 pr-2 font-mono">{r.key}</td>
                  <td className="py-0.5 px-2 text-right font-mono">{r.trades}</td>
                  <td className="py-0.5 px-2 text-right font-mono">{r.mfeAvailableCount}</td>
                  <td className={`py-0.5 px-2 text-right font-mono ${r.actualPnl >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{inr(r.actualPnl)}</td>
                  <td className={`py-0.5 px-2 text-right font-mono ${tone(r.rule1Delta)}`}>{inr(r.rule1Delta)}</td>
                  <td className={`py-0.5 px-2 text-right font-mono ${tone(r.rule2Delta)}`}>{inr(r.rule2Delta)}</td>
                  <td className={`py-0.5 px-2 text-right font-mono ${tone(r.rule3Delta)}`}>{inr(r.rule3Delta)}</td>
                  <td className={`py-0.5 px-2 text-right font-mono ${tone(r.rule4Delta)}`}>{inr(r.rule4Delta)}</td>
                  <td className="py-0.5 pl-2 text-right font-mono text-[10px]">
                    {r.rule1Better}/{r.rule2Better}/{r.rule3Better}/{r.rule4Better}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ShadowExitsSection({ data, error }: FetchState<ShadowExitsResp>): React.ReactElement {
  let severity: Severity = "ok";
  if (error) severity = "fail";
  else if (data && !data.enabled) severity = "disabled";
  else if (data && data.rowCount === 0) severity = "disabled";
  else if (data && data.lowSampleWarning) severity = "warn";

  const d = data;
  return (
    <SectionShell
      title="F&O Shadow Exits (P20 — reporting only)"
      icon={TrendingUp}
      severity={severity}
      description="Compares each CLOSED paper_trade_fo row to four hypothetical exit rules (T1+30/T2+60; book 50%@+30 → trail BE; book 50%@+50 → trail BE; trail BE after MFE+50%). Uses max_runup observability fix from P20-A. SHADOW-ONLY — never feeds live exits, stops, targets, partials, sizing, P&L, DD caps, gates, or any trading decision. Toggle via PAPER_FO_SHADOW_EXITS_ENABLED."
      testId="section-shadow-exits"
    >
      {error && <div className="text-xs text-rose-500 mb-2" data-testid="shadow-exits-error">{error}</div>}
      {!d && !error && <div className="text-xs text-muted-foreground">Loading…</div>}
      {d && !d.enabled && (
        <div className="text-xs text-muted-foreground" data-testid="shadow-exits-disabled">
          {d.note ?? "Disabled by feature flag."}
        </div>
      )}
      {d && d.enabled && d.rowCount === 0 && (
        <div className="text-xs text-muted-foreground">
          No CLOSED paper_trade_fo rows in range — once trades close this report will populate.
        </div>
      )}
      {d && d.enabled && d.rowCount > 0 && (
        <div className="space-y-4">
          {d.lowSampleWarning && (
            <div className="text-xs rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-amber-600" data-testid="shadow-exits-low-sample">
              Low-sample warning: only {d.mfeAvailableCount} of {d.rowCount} trades have post-P20 MFE data
              (threshold = {d.lowSampleThreshold}). Pre-P20 rows use realised gain as a strict lower bound on
              MFE, so their shadow P&L is conservative. Treat aggregates as directional, not decisional.
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
            <Stat label="Trades (closed)" value={num(d.rowCount)} tone="info" />
            <Stat label="MFE-fix coverage" value={`${d.mfeAvailableCount}/${d.rowCount}`} tone={d.mfeAvailableCount === d.rowCount ? "ok" : "warn"} />
            <Stat label="Best rule (Σ Δ)" value={d.totals.bestRule ? RULE_LABELS[d.totals.bestRule] : "—"} tone={d.totals.bestRuleDelta > 0 ? "ok" : "warn"} />
            <Stat label="Actual P&L" value={inr(d.totals.actualPnl)} tone={d.totals.actualPnl >= 0 ? "ok" : "fail"} />
            <Stat label="R1 P&L (Δ)" value={`${inr(d.totals.rule1Pnl)} (${d.totals.rule1Delta >= 0 ? "+" : ""}${inr(d.totals.rule1Delta)})`} tone={d.totals.rule1Delta >= 0 ? "ok" : "warn"} />
            <Stat label="R2 P&L (Δ)" value={`${inr(d.totals.rule2Pnl)} (${d.totals.rule2Delta >= 0 ? "+" : ""}${inr(d.totals.rule2Delta)})`} tone={d.totals.rule2Delta >= 0 ? "ok" : "warn"} />
            <Stat label="R3 P&L (Δ)" value={`${inr(d.totals.rule3Pnl)} (${d.totals.rule3Delta >= 0 ? "+" : ""}${inr(d.totals.rule3Delta)})`} tone={d.totals.rule3Delta >= 0 ? "ok" : "warn"} />
            <Stat label="R4 P&L (Δ)" value={`${inr(d.totals.rule4Pnl)} (${d.totals.rule4Delta >= 0 ? "+" : ""}${inr(d.totals.rule4Delta)})`} tone={d.totals.rule4Delta >= 0 ? "ok" : "warn"} />
            <Stat label="Better/Worse (R1)" value={`${d.totals.rule1Better} / ${d.totals.rule1Worse}`} tone="info" />
            <Stat label="Better/Worse (R2)" value={`${d.totals.rule2Better} / ${d.totals.rule2Worse}`} tone="info" />
            <Stat label="Better/Worse (R3)" value={`${d.totals.rule3Better} / ${d.totals.rule3Worse}`} tone="info" />
            <Stat label="Better/Worse (R4)" value={`${d.totals.rule4Better} / ${d.totals.rule4Worse}`} tone="info" />
          </div>

          <ShadowExitsGrid title="By setup" rows={d.bySetup} />
          <ShadowExitsGrid title="By index" rows={d.byIndex} />
          <ShadowExitsGrid title="By tier"  rows={d.byTier} />

          {d.improvedTopN.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                Trades a shadow rule would have improved (top {d.improvedTopN.length})
              </div>
              <div className="space-y-1 text-xs">
                {d.improvedTopN.map(t => (
                  <div key={t.id} className="flex flex-wrap items-center gap-2 border-b border-border/30 py-1">
                    <span className="font-mono text-[10px] text-muted-foreground">{t.signalDate}</span>
                    <span className="font-mono text-xs">{t.indexSymbol}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{t.setupKey}/{t.tier ?? "—"}/{t.direction}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{t.exitReason ?? "—"}</span>
                    <span className={`ml-auto font-mono ${t.actualPnl >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{inr(t.actualPnl)}</span>
                    <span className="font-mono text-emerald-500">→ {RULE_LABELS[t.bestRule]} +{inr(t.bestDelta)}</span>
                    {!t.mfeAvailable && <span className="text-[9px] uppercase tracking-wide text-amber-500">approx</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {d.reducedTopN.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                Trades a shadow rule would have hurt (top {d.reducedTopN.length})
              </div>
              <div className="space-y-1 text-xs">
                {d.reducedTopN.filter(t => t.bestDelta < 0).map(t => (
                  <div key={t.id} className="flex flex-wrap items-center gap-2 border-b border-border/30 py-1">
                    <span className="font-mono text-[10px] text-muted-foreground">{t.signalDate}</span>
                    <span className="font-mono text-xs">{t.indexSymbol}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{t.setupKey}/{t.tier ?? "—"}/{t.direction}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{t.exitReason ?? "—"}</span>
                    <span className={`ml-auto font-mono ${t.actualPnl >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{inr(t.actualPnl)}</span>
                    <span className="font-mono text-rose-500">best Δ {inr(t.bestDelta)}</span>
                    {!t.mfeAvailable && <span className="text-[9px] uppercase tracking-wide text-amber-500">approx</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {d.limitations.length > 0 && (
            <details className="text-[11px] text-muted-foreground">
              <summary className="cursor-pointer">Simulation limitations & rule parameters</summary>
              <ul className="mt-1 list-disc pl-4 space-y-0.5">
                {d.limitations.map((l, i) => <li key={i}>{l}</li>)}
              </ul>
              <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-[10px]">
                {JSON.stringify(d.parameters, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </SectionShell>
  );
}

function FailureDiagnosisSection(
  { data, error, loading, exactOnly, onToggleExact }:
  FetchState<FailureDiagnosisResp> & { exactOnly: boolean; onToggleExact: () => void },
): React.ReactElement {
  let severity: Severity = "ok";
  if (loading && !data) severity = "disabled";
  else if (error) severity = "warn";
  else if (!data || data.report.rowCount === 0) severity = "disabled";
  else {
    const proven = data.report.hypotheses.filter(h => h.status === "proven").length;
    if (proven > 0) severity = "fail";
    else if (data.report.hypotheses.some(h => h.status === "likely")) severity = "warn";
  }

  const r = data?.report;

  return (
    <SectionShell
      title="F&O Failure Diagnosis (P16)"
      icon={Brain}
      severity={severity}
      description="Evidence-based, read-only failure diagnosis over fno_signal_reasoning. Eight sections (setup / index / tier / lifecycle / stops / untriggered / missing-data / hypotheses) — every conclusion carries a sample size and a status (proven / likely / insufficient_data / undetermined). No strategy, sizing, gate, signal, execution, or scheduler behaviour changed."
      testId="section-failure-diagnosis"
    >
      <div className="flex items-center gap-2 mb-3">
        <Button variant="outline" size="sm" onClick={onToggleExact} data-testid="button-toggle-exact">
          Exact-only: {exactOnly ? "ON" : "OFF"}
        </Button>
        <span className="text-[10px] text-muted-foreground">
          When ON, restricts to rows carrying signal_fingerprint.
        </span>
      </div>
      {error && <div className="text-xs text-rose-500 mb-2" data-testid="failure-diagnosis-error">{error}</div>}
      {!r && !error && <div className="text-xs text-muted-foreground">Loading…</div>}
      {r && r.rowCount === 0 && (
        <div className="text-xs text-muted-foreground">
          No reasoning rows in the current window — once the P14 / P14b loggers have captured data this report will populate.
        </div>
      )}
      {r && r.rowCount > 0 && (
        <div className="space-y-5">
          {/* Top stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
            <Stat label="Rows analysed" value={num(r.rowCount)} tone="info" />
            <Stat
              label="Window"
              value={r.windowFrom && r.windowTo ? `${r.windowFrom} → ${r.windowTo}` : "—"}
              tone="info"
            />
            <Stat
              label={`Funnel mode (${r.lifecycleFunnel.mode})`}
              value={`${r.lifecycleFunnel.rowsWithFingerprint}/${r.lifecycleFunnel.rowsWithFingerprint + r.lifecycleFunnel.rowsWithoutFingerprint} fp`}
              tone={r.lifecycleFunnel.mode === "exact" ? "ok" : r.lifecycleFunnel.mode === "hybrid" ? "warn" : "warn"}
            />
            <Stat
              label="Stops after T1 (exact)"
              value={r.lifecycleFunnel.target1ThenStoppedExact}
              tone={r.lifecycleFunnel.target1ThenStoppedExact > 0 ? "warn" : "ok"}
            />
            <Stat
              label="Late-session emissions"
              value={`${r.untriggeredAnalysis.lateSessionEmissions} (${pct(r.untriggeredAnalysis.lateSessionShare)})`}
              tone={(r.untriggeredAnalysis.lateSessionShare ?? 0) >= 0.25 ? "warn" : "ok"}
            />
          </div>

          {/* H — Hypothesis ranking */}
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              H. Hypothesis ranking (H1–H10)
            </div>
            <div className="space-y-1">
              {r.hypotheses.map(h => (
                <div
                  key={h.id}
                  className="flex flex-col md:flex-row md:items-start md:gap-3 border-b border-border/30 py-1.5"
                  data-testid={`hypothesis-${h.id}`}
                >
                  <div className="flex items-center gap-2 md:w-44 shrink-0">
                    <span className="font-mono text-xs text-muted-foreground">{h.id}</span>
                    <StatusPill s={h.status} />
                    <span className="font-mono text-[10px] text-muted-foreground">n={h.sampleSize}</span>
                  </div>
                  <div className="text-xs flex-1">
                    <div className="font-medium">{h.label}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{h.evidence}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recommendations */}
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              Recommended next strategy priorities (evidence-backed only)
            </div>
            <ol className="space-y-1 text-xs">
              {r.recommendedNextSteps.map(s => (
                <li key={s.priority} className="flex gap-2 border-b border-border/30 py-1">
                  <span className="font-mono text-muted-foreground w-6">#{s.priority}</span>
                  <div className="flex-1">
                    <div className="font-medium">{s.label}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {s.rationale} · backing n={s.sampleBacking}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* D. Lifecycle funnel */}
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">D. Lifecycle funnel</div>
              <div className="text-xs space-y-0.5">
                <Kv label="EMITTED" value={r.lifecycleFunnel.emitted} />
                <Kv label="OPENED" value={r.lifecycleFunnel.opened} />
                <Kv label="TARGET1" value={r.lifecycleFunnel.target1} />
                <Kv label="TARGET2" value={r.lifecycleFunnel.target2} />
                <Kv label="STOPPED" value={r.lifecycleFunnel.stopped} />
                <Kv label="EXPIRED" value={r.lifecycleFunnel.expired} />
                <Kv label="PRE_EMISSION_REJECTED" value={r.lifecycleFunnel.preEmissionRejected} />
                <Kv label="Demoted (EMITTED)" value={r.lifecycleFunnel.demoted} />
                <Kv
                  label="EMITTED → OPENED (exact)"
                  value={pct(r.lifecycleFunnel.conversion.emittedToOpened)}
                />
                <Kv
                  label="OPENED → TARGET1 (exact)"
                  value={pct(r.lifecycleFunnel.conversion.openedToTarget1)}
                  tone={(r.lifecycleFunnel.conversion.openedToTarget1 ?? 0) < 0.3 ? "warn" : "ok"}
                />
                <Kv
                  label="OPENED → STOPPED (exact)"
                  value={pct(r.lifecycleFunnel.conversion.openedToStopped)}
                  tone={(r.lifecycleFunnel.conversion.openedToStopped ?? 0) > 0.5 ? "fail" : "ok"}
                />
                <Kv
                  label="T1 → STOPPED (exact)"
                  value={pct(r.lifecycleFunnel.conversion.target1ToStopped)}
                  tone={(r.lifecycleFunnel.conversion.target1ToStopped ?? 0) > 0.25 ? "warn" : "ok"}
                />
                <Kv
                  label="T1 → T2 (exact)"
                  value={pct(r.lifecycleFunnel.conversion.target1ToTarget2)}
                />
                <Kv
                  label="EMITTED never OPENED (exact)"
                  value={r.lifecycleFunnel.emittedNeverOpenedExact}
                />
              </div>
            </div>

            {/* C. Tier verdict */}
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">C. Tier verdict</div>
              <div className="text-xs space-y-0.5">
                <Kv
                  label="HC outperforms BASELINE?"
                  value={r.tierVerdict.hcOutperformsBaseline == null ? "insufficient sample" : (r.tierVerdict.hcOutperformsBaseline ? "YES" : "NO")}
                  tone={r.tierVerdict.hcOutperformsBaseline === false ? "fail" : r.tierVerdict.hcOutperformsBaseline ? "ok" : undefined}
                />
                <Kv label="HC stopRate" value={pct(r.tierVerdict.hcStopRate)} />
                <Kv label="BASELINE stopRate" value={pct(r.tierVerdict.baselineStopRate)} />
                <Kv label="HC sample (opened)" value={r.tierVerdict.hcSampleSize} />
                <Kv label="BASELINE sample (opened)" value={r.tierVerdict.baselineSampleSize} />
              </div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mt-3 mb-1">
                E. Stops by index / regime
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] text-muted-foreground mb-1">by index</div>
                  <MiniHist rows={r.stopLossDeepDive.byIndex} max={4} />
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground mb-1">by regime</div>
                  <MiniHist rows={r.stopLossDeepDive.byRegime} max={4} />
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground mb-1">by confidence</div>
                  <MiniHist rows={r.stopLossDeepDive.byConfidenceBucket} max={4} />
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground mb-1">by setup</div>
                  <MiniHist rows={r.stopLossDeepDive.bySetup} max={4} />
                </div>
              </div>
            </div>
          </div>

          {/* A — Setup table */}
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">A. Setup failure table</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border/50">
                    <th className="text-left py-1 pr-2">Setup</th>
                    <th className="text-right px-2">Tot</th>
                    <th className="text-right px-2">Emit</th>
                    <th className="text-right px-2">Open</th>
                    <th className="text-right px-2">Stop</th>
                    <th className="text-right px-2">T1</th>
                    <th className="text-right px-2">T2</th>
                    <th className="text-right px-2">Exp</th>
                    <th className="text-right px-2">Demote</th>
                    <th className="text-right px-2">StopRt</th>
                    <th className="text-right px-2">HitRt</th>
                  </tr>
                </thead>
                <tbody>
                  {r.setupAnalysis.slice(0, 12).map(s => (
                    <tr key={s.setupKey} className="border-b border-border/30">
                      <td className="text-left py-1 pr-2 truncate" title={s.setupKey}>{s.setupKey}</td>
                      <td className="text-right px-2">{s.total}</td>
                      <td className="text-right px-2">{s.emitted}</td>
                      <td className="text-right px-2">{s.opened}</td>
                      <td className={`text-right px-2 ${s.stopped > 0 ? "text-rose-500" : ""}`}>{s.stopped}</td>
                      <td className={`text-right px-2 ${s.target1 > 0 ? "text-emerald-500" : ""}`}>{s.target1}</td>
                      <td className={`text-right px-2 ${s.target2 > 0 ? "text-emerald-500" : ""}`}>{s.target2}</td>
                      <td className="text-right px-2">{s.expired}</td>
                      <td className="text-right px-2">{s.demoted}</td>
                      <td className={`text-right px-2 ${(s.stopRate ?? 0) >= 0.5 ? "text-rose-500" : ""}`}>{pct(s.stopRate)}</td>
                      <td className={`text-right px-2 ${(s.targetHitRate ?? 0) >= 0.4 ? "text-emerald-500" : ""}`}>{pct(s.targetHitRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* B + C — Index + Tier table */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">B. Index failure table</div>
              <table className="w-full text-xs font-mono">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border/50">
                    <th className="text-left py-1 pr-2">Index</th>
                    <th className="text-right px-2">Open</th>
                    <th className="text-right px-2">Stop</th>
                    <th className="text-right px-2">Hit</th>
                    <th className="text-right px-2">Exp</th>
                    <th className="text-right px-2">StopRt</th>
                    <th className="text-right px-2">PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {r.indexAnalysis.map(i => (
                    <tr key={i.indexSymbol} className="border-b border-border/30">
                      <td className="text-left py-1 pr-2">{i.indexSymbol}</td>
                      <td className="text-right px-2">{i.opened}</td>
                      <td className={`text-right px-2 ${i.stopped > 0 ? "text-rose-500" : ""}`}>{i.stopped}</td>
                      <td className={`text-right px-2 ${i.targetHit > 0 ? "text-emerald-500" : ""}`}>{i.targetHit}</td>
                      <td className="text-right px-2">{i.expired}</td>
                      <td className={`text-right px-2 ${(i.stopRate ?? 0) >= 0.5 ? "text-rose-500" : ""}`}>{pct(i.stopRate)}</td>
                      <td className={`text-right px-2 ${i.realizedPnl < 0 ? "text-rose-500" : i.realizedPnl > 0 ? "text-emerald-500" : ""}`}>{num(i.realizedPnl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">C. Tier failure table</div>
              <table className="w-full text-xs font-mono">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border/50">
                    <th className="text-left py-1 pr-2">Tier</th>
                    <th className="text-right px-2">Open</th>
                    <th className="text-right px-2">Stop</th>
                    <th className="text-right px-2">T1</th>
                    <th className="text-right px-2">T2</th>
                    <th className="text-right px-2">StopRt</th>
                    <th className="text-right px-2">HitRt</th>
                  </tr>
                </thead>
                <tbody>
                  {r.tierAnalysis.map(t => (
                    <tr key={t.tier} className="border-b border-border/30">
                      <td className="text-left py-1 pr-2">{t.tier}</td>
                      <td className="text-right px-2">{t.opened}</td>
                      <td className={`text-right px-2 ${t.stopped > 0 ? "text-rose-500" : ""}`}>{t.stopped}</td>
                      <td className="text-right px-2">{t.target1}</td>
                      <td className="text-right px-2">{t.target2}</td>
                      <td className={`text-right px-2 ${(t.stopRate ?? 0) >= 0.5 ? "text-rose-500" : ""}`}>{pct(t.stopRate)}</td>
                      <td className={`text-right px-2 ${(t.targetHitRate ?? 0) >= 0.4 ? "text-emerald-500" : ""}`}>{pct(t.targetHitRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* F + G */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">F. Untriggered / expired</div>
              <div className="text-xs space-y-0.5">
                <Kv label="EXPIRED" value={r.untriggeredAnalysis.expired} />
                <Kv label="EMITTED never OPENED (exact)" value={r.untriggeredAnalysis.emittedNeverOpenedExact} />
                <Kv label="SKIPPED rows" value={r.untriggeredAnalysis.skipped} />
                <Kv
                  label="Late-session share (≥14:00 IST)"
                  value={pct(r.untriggeredAnalysis.lateSessionShare)}
                  tone={(r.untriggeredAnalysis.lateSessionShare ?? 0) >= 0.25 ? "warn" : undefined}
                />
              </div>
              <div className="text-[10px] text-muted-foreground mt-2 mb-1">Top skip reasons</div>
              <MiniHist rows={r.untriggeredAnalysis.bySkipReason} max={6} />
              <div className="text-[10px] text-muted-foreground mt-2 mb-1">Expired by setup</div>
              <MiniHist rows={r.untriggeredAnalysis.expiredBySetup} max={6} />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">G. Missing data / demotion</div>
              <div className="text-xs space-y-0.5">
                <Kv label="Demoted → opened (exact)" value={r.missingDataAnalysis.demotedThenOpenedExact} />
                <Kv
                  label="Demoted → opened → stopped (exact)"
                  value={r.missingDataAnalysis.demotedThenOpenedAndStoppedExact}
                  tone={r.missingDataAnalysis.demotedThenOpenedAndStoppedExact > 0 ? "warn" : undefined}
                />
                <Kv label="LOW_WINRATE demotions" value={r.missingDataAnalysis.lowWinRateDemotions} />
              </div>
              <div className="text-[10px] text-muted-foreground mt-2 mb-1">Missing fields</div>
              <MiniHist rows={r.missingDataAnalysis.byMissingField} max={6} />
              <div className="text-[10px] text-muted-foreground mt-2 mb-1">Demotion tags</div>
              <MiniHist rows={r.missingDataAnalysis.byDemotionTag} max={6} />
              {r.missingDataAnalysis.missingFieldStopCorrelation.length > 0 && (
                <>
                  <div className="text-[10px] text-muted-foreground mt-2 mb-1">Missing-field → stop rate</div>
                  <div className="text-xs space-y-0.5">
                    {r.missingDataAnalysis.missingFieldStopCorrelation.slice(0, 6).map(c => (
                      <div key={c.field} className="flex justify-between border-b border-border/30 py-0.5">
                        <span className="font-mono">{c.field}</span>
                        <span className="font-mono text-muted-foreground">
                          {c.stopped}/{c.openedSample} opens · {pct(c.stopRate)}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="text-[10px] text-muted-foreground">
            {r.notes.map((n, i) => <div key={i}>• {n}</div>)}
          </div>
        </div>
      )}
    </SectionShell>
  );
}

// ── tiny atoms ─────────────────────────────────────────────────────────────

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone: "ok" | "warn" | "fail" | "info" }) {
  const cls = { ok: "text-emerald-500", warn: "text-amber-500", fail: "text-rose-500", info: "text-foreground" }[tone];
  return (
    <div className="border border-border/50 rounded p-2">
      <div className={`text-base font-semibold ${cls}`}>{value}</div>
      <div className="text-[10px] uppercase text-muted-foreground tracking-wide">{label}</div>
    </div>
  );
}

function Kv({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "ok" | "warn" | "fail" }) {
  const cls = tone ? { ok: "text-emerald-500", warn: "text-amber-500", fail: "text-rose-500" }[tone] : "";
  return (
    <div className="flex justify-between border-b border-border/30 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono ${cls}`}>{value}</span>
    </div>
  );
}

// ── page ────────────────────────────────────────────────────────────────────

// ── INDstocks daily API token updater (owner-only hot-swap) ─────────────────

interface IndstocksTokenStatusResp {
  present: boolean;
  source: "db" | "env" | "none";
  updatedAt: string | null;
  expiresAt: string | null;
  expired: boolean;
  updatedBy: string | null;
}

// ── F&O Signal Gap section ────────────────────────────────────────────────

function FnoSignalGapSection({ data, error, loading }: FetchState<FnoSignalGapResp>): React.ReactElement {
  let severity: Severity = "ok";
  if (loading && !data) severity = "disabled";
  else if (error) severity = "warn";
  else if (data) {
    if (data.isDataRelatedGap && (data.gapTradingDays ?? 0) > 5) severity = "fail";
    else if (data.isDataRelatedGap && (data.gapTradingDays ?? 0) > 0) severity = "warn";
    else severity = "ok";
  }

  function fmtIst(iso: string | null | undefined): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  const gapReasonLabel: Record<string, string> = {
    WITHIN_NORMAL_RANGE:               "FNO_TRADE_READY",
    NO_SIGNALS_KITE_SESSION_EXPIRED:   "FNO_DISABLED_KITE_SESSION",
    NO_SIGNALS_DAILY_HISTORY_GAP:      "FNO_DISABLED_DAILY_HISTORY_GAP",
    NO_SIGNALS_ENGINE_SUPPRESSED:      "FNO_ENGINE_SUPPRESSED",
    NO_SIGNALS_MARKET_CLOSED:          "FNO_MARKET_CLOSED",
    NO_SIGNALS_REASON_UNKNOWN:         "FNO_REASON_UNKNOWN",
    NO_SIGNALS_EVER:                   "FNO_NO_SIGNALS_EVER",
  };

  return (
    <SectionShell
      title="F&O Signal Gap"
      icon={Signal}
      severity={severity}
      description="Last F&O signal dates + Mon–Fri trading-day gap. Identifies data-related outages vs normal market quiet. Trading-day count is Mon–Fri only — no NSE holiday list is maintained server-side."
      testId="section-fno-signal-gap"
    >
      {error && <div className="text-sm text-rose-500">Failed: {error}</div>}
      {loading && !data && <div className="text-sm text-muted-foreground">Loading…</div>}
      {data && (() => {
        const tradeReady = !data.isDataRelatedGap || (data.gapTradingDays ?? 0) === 0;
        const statusLabel = gapReasonLabel[data.gapReason] ?? data.gapReason;
        return (
          <div className="space-y-4">
            {/* Status row */}
            <div className="flex items-center gap-3">
              <SeverityIcon s={severity} />
              <span className={`font-mono text-sm ${severity === "fail" ? "text-rose-400" : severity === "warn" ? "text-amber-400" : "text-emerald-400"}`}>
                {statusLabel}
              </span>
              {!tradeReady && data.isDataRelatedGap && (
                <span className="ml-auto text-[11px] font-mono text-rose-400 shrink-0">DATA ISSUE · NOT MARKET CONDITION</span>
              )}
            </div>

            {/* Alert banner if data gap */}
            {data.isDataRelatedGap && (data.gapTradingDays ?? 0) > 0 && (
              <div className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
                <span>
                  <span className="font-semibold font-mono">{data.gapTradingDays}</span> trading day{data.gapTradingDays !== 1 ? "s" : ""} without a signal ·{" "}
                  <span className="font-mono text-xs">{data.gapReason}</span>
                </span>
              </div>
            )}

            {/* Last signal table */}
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-1.5 pr-4">Signal type</th>
                  <th className="py-1.5">Last at (IST)</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {([
                  { label: "Any (HC or Baseline)", iso: data.lastSignal.any },
                  { label: "High-Conviction only",  iso: data.lastSignal.highConviction },
                  { label: "Paper trade opened",    iso: data.lastSignal.paperTradeOpen },
                ] as Array<{ label: string; iso: string | null }>).map(({ label, iso }) => (
                  <tr key={label} className="border-b border-border/40">
                    <td className="py-1.5 pr-4 text-muted-foreground">{label}</td>
                    <td className="py-1.5 font-mono text-xs">{fmtIst(iso)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Gap + top suppression reason */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>Mon–Fri gap: <span className={`font-mono font-semibold ${(data.gapTradingDays ?? 0) > 5 ? "text-rose-400" : (data.gapTradingDays ?? 0) > 1 ? "text-amber-400" : "text-foreground"}`}>{data.gapTradingDays ?? "—"} day{data.gapTradingDays !== 1 ? "s" : ""}</span></span>
              {data.suppressionReasonDistribution[0] && (
                <span>Top reason: <span className="font-mono text-foreground">{data.suppressionReasonDistribution[0].reasonCode}</span> ({data.suppressionReasonDistribution[0].count})</span>
              )}
            </div>
          </div>
        );
      })()}
    </SectionShell>
  );
}

function IndstocksTokenSection({
  auto,
  tick,
  refresh,
}: {
  auto: boolean;
  tick: number;
  refresh: () => void;
}): React.ReactElement {
  const status = useEndpoint<IndstocksTokenStatusResp>(
    "api/data/indstocks/token/status",
    auto,
    tick,
  );
  const [tokenInput, setTokenInput] = useState("");
  const [expiresInput, setExpiresInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const base = import.meta.env.BASE_URL;
  const url = `${base}api/data/indstocks/token`;
  const d = status.data;

  const severity: Severity = useMemo(() => {
    if (status.error) return "fail";
    if (!d) return "warn";
    if (!d.present) return "fail";
    if (d.expired) return "warn";
    if (d.source === "env") return "warn";
    return "ok";
  }, [d, status.error]);

  async function save(): Promise<void> {
    const token = tokenInput.trim();
    if (token.length < 8) {
      setMsg({ kind: "err", text: "Token looks too short." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const body: Record<string, string> = { token };
      if (expiresInput.trim()) {
        const d2 = new Date(expiresInput.trim());
        if (!Number.isNaN(d2.getTime())) body["expiresAt"] = d2.toISOString();
      }
      const r = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setTokenInput("");
      setExpiresInput("");
      setMsg({ kind: "ok", text: "Token saved — takes effect within ~30s, no restart needed." });
      refresh();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Save failed" });
    } finally {
      setBusy(false);
    }
  }

  async function clearToken(): Promise<void> {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(url, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setMsg({ kind: "ok", text: "DB token cleared — reads fall back to the INDSTOCKS_API_TOKEN secret." });
      refresh();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Clear failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionShell
      title="INDstocks API Token"
      icon={KeyRound}
      severity={severity}
      description="Owner-only. Hot-swap the daily INDstocks REST token — stored encrypted in the DB, no restart or redeploy needed."
      testId="section-indstocks-token"
    >
      {status.error && <div className="text-sm text-rose-500">Status failed: {status.error}</div>}
      {status.loading && !d && <div className="text-sm text-muted-foreground">Loading…</div>}
      {d && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <div>
              <div className="text-muted-foreground">Token present</div>
              <div className="font-medium" data-testid="indstocks-token-present">
                {d.present ? "Yes" : "No"}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Source</div>
              <div className="font-medium uppercase" data-testid="indstocks-token-source">
                {d.source}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Updated</div>
              <div className="font-medium">
                {d.updatedAt ? new Date(d.updatedAt).toLocaleString() : "—"}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Expires</div>
              <div className={`font-medium ${d.expired ? "text-amber-600" : ""}`}>
                {d.expiresAt ? new Date(d.expiresAt).toLocaleString() : "—"}
                {d.expired ? " (expired)" : ""}
              </div>
            </div>
          </div>
          {d.source === "env" && (
            <div className="text-xs text-amber-600">
              Currently using the INDSTOCKS_API_TOKEN secret. Paste a fresh token below to take over
              without a restart.
            </div>
          )}
          <div className="border-t border-border/50 pt-3 space-y-2">
            <div className="text-xs font-semibold">Paste a fresh token</div>
            <div className="flex flex-wrap gap-2 items-end">
              <div className="flex-1 min-w-[200px]">
                <label className="text-xs text-muted-foreground">Token</label>
                <Input
                  type="password"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="paste INDstocks token"
                  autoComplete="off"
                  data-testid="input-indstocks-token"
                />
              </div>
              <div className="w-52">
                <label className="text-xs text-muted-foreground">Expires (optional)</label>
                <Input
                  type="datetime-local"
                  value={expiresInput}
                  onChange={(e) => setExpiresInput(e.target.value)}
                  data-testid="input-indstocks-expires"
                />
              </div>
              <Button
                size="sm"
                onClick={() => void save()}
                disabled={busy || !tokenInput.trim()}
                data-testid="button-save-indstocks-token"
              >
                Save token
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void clearToken()}
                disabled={busy || !d.present || d.source !== "db"}
                data-testid="button-clear-indstocks-token"
              >
                Clear DB token
              </Button>
            </div>
            <div className="text-[11px] text-muted-foreground">
              Stored encrypted and never displayed again. Feeds only INDstocks secondary
              validation/failover — never a trade or signal decision.
            </div>
            {msg && (
              <div
                className={`text-xs ${msg.kind === "ok" ? "text-emerald-600" : "text-rose-500"}`}
                data-testid="indstocks-token-msg"
              >
                {msg.text}
              </div>
            )}
          </div>
        </div>
      )}
    </SectionShell>
  );
}

// ── Part H: Signal / Telegram Parity Section ─────────────────────────────────

function ParitySection({ data, error, loading }: FetchState<ParityStatusResp>): React.ReactElement {
  const s = data?.summary;
  let severity: Severity = "ok";
  if (loading && !data) severity = "disabled";
  else if (error) severity = "warn";
  else if (s) {
    if (!s.tableReady) severity = "warn";
    else if (s.failedCount > 0) severity = "warn";
    else severity = "ok";
  }

  function fmtIst(iso: string | null | undefined): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  function statusColor(st: string): string {
    if (st === "SENT") return "text-emerald-400";
    if (st === "BLOCKED") return "text-amber-400";
    if (st === "DUPLICATE") return "text-blue-400";
    if (st === "FAILED") return "text-rose-400";
    return "text-muted-foreground";
  }

  function eventLabel(domain: string, eventType: string): string {
    if (domain === "SWING_CASH" && eventType === "ENTRY_READY") return "Swing Entry";
    if (domain === "FNO_INTRADAY" && eventType === "ENTRY_OPENED") return "F&O Entry";
    if (eventType.startsWith("EXIT_")) return `Exit ${eventType.replace("EXIT_", "").toLowerCase()}`;
    return eventType;
  }

  return (
    <SectionShell
      title="Signal / Telegram Parity"
      icon={Signal}
      severity={severity}
      description="Notification delivery log — tracks every trade alert dispatched (or blocked) across the Telegram pipeline. BROKER EXECUTION DISABLED. No Telegram send happens from this panel."
      testId="section-parity-status"
    >
      {error && <div className="text-sm text-rose-500">Failed to load: {error}</div>}
      {loading && !data && <div className="text-sm text-muted-foreground">Loading…</div>}
      {s && (
        <div className="space-y-4">
          {/* Table ready + broker execution badge */}
          <div className="flex items-center gap-2 flex-wrap">
            <SeverityIcon s={s.tableReady ? "ok" : "warn"} />
            <span className="text-xs font-mono text-muted-foreground">
              {s.tableReady ? "notification_delivery_log ready" : "table not yet created"}
            </span>
            <span className="ml-auto px-2 py-0.5 rounded text-[10px] font-mono bg-rose-950 text-rose-300 border border-rose-700">
              BROKER EXEC DISABLED
            </span>
          </div>

          {/* Counts */}
          <div className="grid grid-cols-4 gap-2 text-center">
            {([
              ["SENT",      s.sentCount,      "bg-emerald-950 border-emerald-700 text-emerald-300"],
              ["BLOCKED",   s.blockedCount,   "bg-amber-950 border-amber-700 text-amber-300"],
              ["DUPLICATE", s.duplicateCount, "bg-blue-950 border-blue-700 text-blue-300"],
              ["FAILED",    s.failedCount,    "bg-rose-950 border-rose-700 text-rose-300"],
            ] as const).map(([label, count, cls]) => (
              <div key={label} className={`rounded border px-2 py-1.5 ${cls}`}>
                <div className="text-lg font-bold">{count}</div>
                <div className="text-[10px] font-mono">{label}</div>
              </div>
            ))}
          </div>

          {/* Block reasons */}
          {Object.keys(s.blocksByReason).length > 0 && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">Block reasons (last 30 days)</div>
              <div className="space-y-0.5">
                {Object.entries(s.blocksByReason).map(([code, cnt]) => (
                  <div key={code} className="flex justify-between text-xs font-mono">
                    <span className="text-amber-300">{code}</span>
                    <span className="text-muted-foreground">{cnt}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Last events */}
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Last events</div>
            {([
              ["Last Swing Entry", s.lastSwingEntry],
              ["Last F&O Entry",   s.lastFnoEntry],
              ["Last Exit",        s.lastExit],
            ] as const).map(([label, rec]) => (
              <div key={label} className="flex justify-between text-xs">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-mono">
                  {rec ? (
                    <span>
                      <span className="text-foreground">{rec.symbol}</span>
                      <span className="text-muted-foreground mx-1">·</span>
                      <span className={statusColor(rec.status)}>{rec.status}</span>
                      <span className="text-muted-foreground mx-1">·</span>
                      <span className="text-muted-foreground">{fmtIst(rec.sentAt ?? rec.createdAt)}</span>
                    </span>
                  ) : "—"}
                </span>
              </div>
            ))}
          </div>

          {/* Latest 10 log records */}
          {s.latestLogRecords.length > 0 && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">Latest delivery log (last 10)</div>
              <div className="space-y-0.5 max-h-48 overflow-y-auto">
                {s.latestLogRecords.map((rec) => (
                  <div key={rec.id} className="flex items-center gap-2 text-[11px] font-mono">
                    <span className={`w-16 shrink-0 ${statusColor(rec.status)}`}>{rec.status}</span>
                    <span className="text-foreground shrink-0">{rec.symbol}</span>
                    <span className="text-muted-foreground shrink-0 text-[10px]">
                      {eventLabel(rec.domain, rec.eventType)}
                    </span>
                    <span className="ml-auto text-muted-foreground text-[10px] shrink-0">
                      {fmtIst(rec.sentAt ?? rec.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="text-[10px] text-muted-foreground">
            Retrieved at: {fmtIst(s.retrievedAt)} IST
            · Use <span className="font-mono">POST /api/parity/trade-event/verify</span> to run fixture parity checks
          </div>
        </div>
      )}
    </SectionShell>
  );
}

// ── Part I: F&O Exit Monitoring Reliability Section ──────────────────────────

function ExitMonitorSection({ data, error, loading, nowMs }: FetchState<ExitMonitorStatusResp> & { nowMs: number }): React.ReactElement {
  function fmtIst(iso: string | null | undefined): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }
  const derived = data
    ? deriveExitMonitorSeverity(
        data.exitMonitor,
        [data.premiumOverlay, data.orphanExit, data.mtmSweep, data.timeExit1520] as SubsystemHealthLite[],
        nowMs,
      )
    : null;
  let severity: Severity = "disabled";
  if (error || (!data && !loading)) severity = "fail";
  else if (derived) severity = derived.severity;

  const subsystems = data
    ? ([
        ["Premium Overlay (hard-stop backstop)", data.premiumOverlay, data.premiumOverlay.cyclesTotal, "stoppedTotal" in data.premiumOverlay ? data.premiumOverlay.stoppedTotal : null],
        ["Orphan-Exit Sweep (P0 orphaned-OPEN)", data.orphanExit, data.orphanExit.cyclesTotal, "closedTotal" in data.orphanExit ? data.orphanExit.closedTotal : null],
        ["MTM Sweep (all-open refresh)", data.mtmSweep, data.mtmSweep.cyclesTotal, "rowsUpdatedTotal" in data.mtmSweep ? data.mtmSweep.rowsUpdatedTotal : null],
        ["15:20 IST Force-Exit", data.timeExit1520, data.timeExit1520.runsTotal, "rowsClosedTotal" in data.timeExit1520 ? data.timeExit1520.rowsClosedTotal : null],
      ] as const)
    : [];

  return (
    <SectionShell
      title="F&O Exit Monitoring Reliability"
      icon={ShieldAlert}
      severity={severity}
      description="Owner-only roll-up of the exit-monitor scheduler + its 4 dependent sub-systems. Read-only — no sweep, no order, no Telegram send happens from this panel."
      testId="section-exit-monitor"
    >
      {error && <div className="text-sm text-rose-500">Failed to load: {error}</div>}
      {loading && !data && <div className="text-sm text-muted-foreground">Loading…</div>}
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-2 text-center">
            {([
              ["Cycles", data.exitMonitor.cyclesTotal],
              ["Exited", data.exitMonitor.exitedTotal],
              ["Blocked", data.exitMonitor.blockedTotal],
              ["Errors", data.exitMonitor.errorsTotal],
            ] as const).map(([label, n]) => (
              <div key={label} className="rounded border border-border/50 px-2 py-1.5">
                <div className="text-lg font-bold">{num(n)}</div>
                <div className="text-[10px] font-mono text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>

          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Last cycle</span>
            <span className="font-mono">
              {data.exitMonitor.lastCycle ? formatAge(data.exitMonitor.lastCycle.checkedAt, nowMs) : "never"}
            </span>
          </div>
          {data.exitMonitor.lastCycle && (
            <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-[11px] font-mono text-muted-foreground">
              <span>Scanned: {num(data.exitMonitor.lastCycle.openTradesScanned)}</span>
              <span>Quotes: {num(data.exitMonitor.lastCycle.quotesFetched)}</span>
              <span>Stale: {num(data.exitMonitor.lastCycle.staleDataCount)}</span>
              <span>Kite down: {num(data.exitMonitor.lastCycle.kiteUnavailableCount)}</span>
              <span>Duplicate: {num(data.exitMonitor.lastCycle.duplicateSkippedCount)}</span>
              <span>Duration: {num(data.exitMonitor.lastCycle.durationMs)}ms</span>
            </div>
          )}
          {data.exitMonitor.lastErrorAt && (
            <div className="text-xs text-amber-500">
              Last error {formatAge(data.exitMonitor.lastErrorAt, nowMs)}: {data.exitMonitor.lastErrorMessage ?? data.exitMonitor.lastErrorClass ?? "—"}
            </div>
          )}

          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border/50">
                <th className="text-left py-1.5">Sub-system</th>
                <th className="text-right py-1.5">Runs</th>
                <th className="text-right py-1.5">Actions</th>
                <th className="text-right py-1.5">Last success</th>
                <th className="text-right py-1.5">Last error</th>
              </tr>
            </thead>
            <tbody>
              {subsystems.map(([label, sub, runs, actions]) => (
                <tr key={label} className="border-b border-border/30 last:border-b-0">
                  <td className="py-1.5">{label}</td>
                  <td className="text-right font-mono">{num(runs ?? null)}</td>
                  <td className="text-right font-mono">{num(actions)}</td>
                  <td className="text-right text-muted-foreground">{formatAge(sub.lastSuccessAt, nowMs)}</td>
                  <td className="text-right">
                    {sub.lastErrorAt ? (
                      <span className="text-amber-500">{formatAge(sub.lastErrorAt, nowMs)}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {derived && derived.reasons.length > 0 && (
            <div className="text-xs text-muted-foreground">
              {derived.reasons.map((r, i) => <div key={i}>{r}</div>)}
            </div>
          )}

          <div className="text-[10px] text-muted-foreground">
            Generated at: {fmtIst(data.generatedAt)} IST · Live control (Run Dry / Run Now per open trade) lives on the
            F&amp;O Paper Trading page's Exit Monitor panel, not here.
          </div>
        </div>
      )}
    </SectionShell>
  );
}

// ── GlobalHealthSection ───────────────────────────────────────────────────────

interface GlobalDataHealthModuleH {
  status: string;
  source: string;
  canDriveSignals: boolean;
  reason: string | null;
}

interface GlobalDataHealthResp {
  overallStatus: string;
  severity: string;
  badge: string;
  headline: string;
  kite: {
    sessionStatus: string;
    websocketStatus: string;
    liveQuotesCount: number;
    quoteStatus: string;
    tradeGrade: boolean;
    marketSession: string;
    isPreOpenWindow: boolean;
  };
  modules: Record<string, GlobalDataHealthModuleH>;
  fallback: { yahooActive: boolean; label: string };
  userAction: { required: boolean; reason: string | null; path: string | null };
  preOpenAlert: { isPreOpenWindow: boolean; alertFired: boolean; lastAlertEvent: string | null };
  warnings: string[];
  checkedAt: string;
}

function globalHealthSeverity(s: string): Severity {
  if (s === "ok" || s === "info") return "ok";
  if (s === "warn" || s === "orange") return "warn";
  return "fail";
}

function GlobalHealthSection({ data, error, loading }: FetchState<GlobalDataHealthResp>): React.ReactElement {
  const sev: Severity = data ? globalHealthSeverity(data.severity) : error ? "fail" : "ok";
  return (
    <SectionShell
      title="Global Data Health"
      icon={ShieldAlert}
      severity={sev}
      description="Unified Kite session + feed + backbone module readiness. Feeds the app-wide status banner and GET /api/data-health/global (public-safe)."
      testId="section-global-health"
    >
      {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
      {error && <p className="text-xs text-destructive">Error: {error}</p>}
      {data && (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className={`rounded-md border px-2 py-1 font-mono text-xs font-bold uppercase tracking-wider shrink-0 ${
              sev === "ok"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : sev === "warn"
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                  : "border-red-500/40 bg-red-500/10 text-red-300"
            }`}>
              {data.badge}
            </div>
            <p className="text-xs text-muted-foreground leading-snug pt-0.5">{data.headline}</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            {(
              [
                { label: "Session", value: data.kite.sessionStatus, green: data.kite.sessionStatus === "ACTIVE" },
                { label: "WebSocket", value: data.kite.websocketStatus, green: data.kite.websocketStatus === "CONNECTED" },
                { label: "Market", value: data.kite.marketSession.replace("_", " "), green: data.kite.marketSession === "open" },
                { label: "Live Quotes", value: String(data.kite.liveQuotesCount), green: data.kite.liveQuotesCount > 0 },
              ] as const
            ).map((r) => (
              <div key={r.label} className="rounded border border-border bg-muted/20 p-2">
                <div className="font-mono text-[10px] uppercase text-muted-foreground mb-1">{r.label}</div>
                <div className={`font-semibold capitalize ${r.green ? "text-emerald-400" : "text-amber-400"}`}>{r.value}</div>
              </div>
            ))}
          </div>

          {Object.keys(data.modules).length > 0 && (
            <div>
              <div className="font-mono text-[10px] uppercase text-muted-foreground mb-2">Module Readiness</div>
              <div className="divide-y divide-border border border-border rounded text-xs overflow-hidden">
                {Object.entries(data.modules).map(([mod, mh]) => (
                  <div key={mod} className="flex items-center gap-2 px-3 py-1.5 bg-card">
                    <div className={`shrink-0 rounded-full w-2 h-2 ${
                      mh.status === "TRADE_GRADE" ? "bg-emerald-500" :
                      mh.status === "DELAYED" ? "bg-amber-500" : "bg-red-500"
                    }`} />
                    <span className="font-mono uppercase text-[10px] tracking-wide w-24 shrink-0">{mod}</span>
                    <span className={`font-mono text-[10px] uppercase shrink-0 ${
                      mh.status === "TRADE_GRADE" ? "text-emerald-400" :
                      mh.status === "DELAYED" ? "text-amber-400" : "text-red-400"
                    }`}>{mh.status}</span>
                    {mh.reason && <span className="text-muted-foreground truncate text-[10px]">{mh.reason}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.warnings.length > 0 && (
            <div className="space-y-1">
              {data.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-amber-400">
                  <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {data.userAction.required && (
            <div className="flex items-start gap-2 rounded border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">Action Required</div>
                {data.userAction.reason && <div className="opacity-80 mt-0.5 text-[11px]">{data.userAction.reason}</div>}
              </div>
            </div>
          )}

          {data.preOpenAlert.isPreOpenWindow && (
            <div className="flex items-center gap-2 text-xs text-amber-400">
              <Signal className="h-3 w-3" />
              Pre-open window active
              {data.preOpenAlert.alertFired && data.preOpenAlert.lastAlertEvent && (
                <span className="text-muted-foreground">— last alert: {data.preOpenAlert.lastAlertEvent}</span>
              )}
            </div>
          )}

          <div className="text-[10px] text-muted-foreground font-mono">
            Checked: {new Date(data.checkedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST
          </div>
        </div>
      )}
    </SectionShell>
  );
}

// ── T005 (2026-07-03): System Alert Health ──────────────────────────────────
// Read-only diagnostics for the DB-backed alert-dedup/claim layer
// (systemAlertDedup.ts, wired via alerting.ts). Shows per-family CAS state,
// the most recent windowed-dedup claims, and this process's in-memory
// skipped-as-duplicate counter. Purely observational — no button here
// triggers a Telegram send, ingestion, or trading action.
function SystemAlertHealthSection({ data, error, loading }: FetchState<SystemAlertHealthDiag>): React.ReactElement {
  const { severity, reasons } = deriveSystemAlertHealthSeverity(error ? null : data ?? null);
  return (
    <SectionShell
      title="System Alert Health"
      icon={Signal}
      severity={severity}
      description="DB-backed Telegram alert dedup/state (warmup digest, data-recovery CAS transitions)."
      testId="section-system-alert-health"
    >
      {error && <div className="text-sm text-rose-500">Failed: {error}</div>}
      {loading && !data && <div className="text-sm text-muted-foreground">Loading…</div>}
      {data && (
        <div className="space-y-3">
          {reasons.length > 0 && (
            <ul className="space-y-1 text-xs text-amber-500">
              {reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
          )}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <Kv label="Tracked families" value={num(data.states.length)} />
            <Kv label="Recent claims (DB)" value={num(data.recentClaims.length)} />
            <Kv label="Skipped as duplicate (this process)" value={num(data.skipped.totalSkipped)} tone={data.skipped.totalSkipped > 0 ? "warn" : "ok"} />
            <Kv
              label="Last skipped"
              value={data.skipped.lastSkipped ? `${data.skipped.lastSkipped.family} · ${formatAge(new Date(data.skipped.lastSkipped.at).toISOString(), Date.now())}` : "—"}
            />
          </div>
          {data.states.length > 0 && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">Per-family state</div>
              <ul className="space-y-1">
                {data.states.map((s) => (
                  <li key={s.family} className="flex items-center justify-between text-xs border-b border-border/30 py-1">
                    <span className="font-mono">{s.family}</span>
                    <span className={s.state === "DEGRADED" ? "text-amber-500" : "text-emerald-500"}>
                      {s.state}
                      {s.incidentId ? ` (${s.incidentId.slice(0, 8)})` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.recentClaims.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Recent claims ({data.recentClaims.length})
              </summary>
              <ul className="mt-2 space-y-1 font-mono text-[11px]">
                {data.recentClaims.slice(0, 20).map((c, i) => (
                  <li key={`${c.dedupKey}-${i}`} className="text-muted-foreground break-words">
                    {c.family} · {c.dedupKey} · sent {c.sentAt}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {data.states.length === 0 && data.recentClaims.length === 0 && (
            <div className="text-xs text-muted-foreground">No system alerts claimed yet.</div>
          )}
        </div>
      )}
    </SectionShell>
  );
}

export default function InfraHealthPage(): React.ReactElement {
  const [auto, setAuto] = useState(true);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  // Wall-clock state — independent of the fetch tick. We tick it every
  // 30s so age/severity formatting tracks real time even between fetches
  // (and even when auto-refresh is OFF). Without this, the dashboard's
  // staleness badges would freeze at the last manual-refresh moment.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const security = useEndpoint<SecurityAudit>("api/security/audit", auto, tick);
  const sector = useEndpoint<SectorCoverage>("api/stocks-to-watch/diagnostics/sector-coverage", auto, tick);
  const candle = useEndpoint<CandleDiag>("api/candles/diagnostics", auto, tick);
  const snapshot = useEndpoint<SnapshotDiagnostics & { todayRowsWritten: number; recentRuns: Array<Record<string, unknown>> }>(
    "api/option-snapshots/diagnostics", auto, tick,
  );
  const analytics = useEndpoint<AnalyticsResp>("api/option-snapshots/analytics", auto, tick);
  const candidates = useEndpoint<CandidatesDiag>("api/paper/eq/candidates-diagnostic", auto, tick);
  const etf = useEndpoint<EtfDiagnosticsResp>("api/etf/diagnostics", auto, tick);
  const reasoning = useEndpoint<ReasoningAnalyticsResp>("api/paper/diagnostics/fno-reasoning/analytics", auto, tick);
  const observability = useEndpoint<ObservabilityResp>("api/paper/diagnostics/fno-observability", auto, tick);
  const shadowCosts = useEndpoint<ShadowCostsResp>("api/paper/analytics/fo/shadow-costs", auto, tick);
  const shadowExits = useEndpoint<ShadowExitsResp>("api/paper/analytics/fo/shadow-exits", auto, tick);
  const fnoGap = useEndpoint<FnoSignalGapResp>("api/fno/no-signal-gap", auto, tick);
  const parityStatus = useEndpoint<ParityStatusResp>("api/parity/status", auto, tick);
  const globalHealth = useEndpoint<GlobalDataHealthResp>("api/data-health/global", auto, tick);
  const exitMonitor = useEndpoint<ExitMonitorStatusResp>("api/paper/diagnostics/fo/exit-monitor/status", auto, tick);
  const systemAlertHealth = useEndpoint<SystemAlertHealthDiag>("api/alerts/system-health", auto, tick);

  // P16: failure-diagnosis endpoint with an exact-only toggle. The URL changes
  // when the toggle flips, which invalidates the SWR/useEndpoint cache key.
  const [exactOnly, setExactOnly] = useState(false);
  const failureDiagnosis = useEndpoint<FailureDiagnosisResp>(
    `api/paper/analytics/fo/failure-diagnosis${exactOnly ? "?exactOnly=1" : ""}`,
    auto,
    tick,
  );

  // Roll-up for the header banner.
  const headerSeverity: Severity = useMemo(() => {
    const severities: Severity[] = [];
    if (security.data) {
      if (security.data.summary.fail > 0) severities.push("fail");
      else if (security.data.summary.warn > 0) severities.push("warn");
      else severities.push("ok");
    } else if (security.error) severities.push("fail");
    if (sector.data) severities.push(deriveCoverageSeverity(sector.data.lookup.sectorCoveragePct));
    else if (sector.error) severities.push("fail");
    severities.push(deriveSnapshotSectionSeverity(snapshot, analytics, nowMs, 15));
    if (candle.data) severities.push(deriveCandleSeverity(candle.data.byInterval, nowMs).severity);
    else if (candle.error) severities.push("fail");
    if (fnoGap.data) {
      const { isDataRelatedGap, gapTradingDays } = fnoGap.data;
      if (isDataRelatedGap && (gapTradingDays ?? 0) > 5) severities.push("fail");
      else if (isDataRelatedGap && (gapTradingDays ?? 0) > 0) severities.push("warn");
      else severities.push("ok");
    } else if (fnoGap.error) severities.push("warn");
    if (exitMonitor.data) {
      severities.push(
        deriveExitMonitorSeverity(
          exitMonitor.data.exitMonitor,
          [exitMonitor.data.premiumOverlay, exitMonitor.data.orphanExit, exitMonitor.data.mtmSweep, exitMonitor.data.timeExit1520] as SubsystemHealthLite[],
          nowMs,
        ).severity,
      );
    } else if (exitMonitor.error) severities.push("fail");
    if (systemAlertHealth.data || systemAlertHealth.error) {
      severities.push(deriveSystemAlertHealthSeverity(systemAlertHealth.error ? null : systemAlertHealth.data).severity);
    }
    return rollUp(severities);
  }, [security, sector, snapshot, analytics, candle, fnoGap, exitMonitor, systemAlertHealth, nowMs]);

  const anyLoading = security.loading || sector.loading || snapshot.loading || analytics.loading || candle.loading || candidates.loading;

  return (
    <div className="space-y-6" data-testid="page-infra-health">
      <Seo path="/infra-health" title="Data Infrastructure Health" noindex />
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="h-7 w-7" /> Data Infrastructure Health
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Owner-only, read-only roll-up of every diagnostic surface added so far. Auto-refreshes every 60 s.
            <br />
            <Info className="inline h-3 w-3 mr-1 align-middle" />
            <span className="text-xs">No buttons here trigger trades, signals, ingestion, or order placement.</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SeverityBadge s={headerSeverity} />
          <Button variant="outline" size="sm" onClick={() => setAuto((a) => !a)} data-testid="button-toggle-auto">
            Auto-refresh: {auto ? "ON" : "OFF"}
          </Button>
          <Button variant="outline" size="sm" onClick={refresh} disabled={anyLoading} data-testid="button-refresh">
            <RefreshCw className={`h-4 w-4 mr-2 ${anyLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* W1A: Pro Operations Console — owner-only, read-only panels */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <SystemModePanel refreshTick={tick} />
        </div>
        <div className="md:col-span-2">
          <ReconciliationPanel refreshTick={tick} />
        </div>
        <GateStatusPanel nowMs={nowMs} refreshTick={tick} />
        <SwingFreshnessPanel nowMs={nowMs} refreshTick={tick} />
        <FoEvidencePanel nowMs={nowMs} refreshTick={tick} />
        <div className="md:col-span-2">
          <ShadowDiagnosticsPanel nowMs={nowMs} refreshTick={tick} />
        </div>
        <div className="md:col-span-2">
          <SectorStrengthPanel nowMs={nowMs} refreshTick={tick} />
        </div>
      </div>

      {/* Section grid — 2 columns on md+, single column on mobile */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <GlobalHealthSection {...globalHealth} />
        </div>
        <SecuritySection {...security} />
        <SectorSection {...sector} />
        <CandleSection {...candle} nowMs={nowMs} />
        <SnapshotSection diag={snapshot} analytics={analytics} nowMs={nowMs} />
        <div className="md:col-span-2">
          <IndstocksTokenSection auto={auto} tick={tick} refresh={refresh} />
        </div>
        <div className="md:col-span-2">
          <EquitySection cand={candidates} nowMs={nowMs} refresh={refresh} />
        </div>
        <div className="md:col-span-2">
          <EtfRecognitionSection diag={etf} nowMs={nowMs} />
        </div>
        <div className="md:col-span-2">
          <DataParitySection />
        </div>
        <div className="md:col-span-2">
          <ObservabilitySection {...observability} />
        </div>
        <div className="md:col-span-2">
          <ShadowCostsSection {...shadowCosts} />
        </div>
        <div className="md:col-span-2">
          <ShadowExitsSection {...shadowExits} />
        </div>
        <div className="md:col-span-2">
          <ReasoningSection {...reasoning} />
        </div>
        <div className="md:col-span-2">
          <FailureDiagnosisSection
            {...failureDiagnosis}
            exactOnly={exactOnly}
            onToggleExact={() => setExactOnly(v => !v)}
          />
        </div>
        <div className="md:col-span-2">
          <FnoSignalGapSection {...fnoGap} />
        </div>
        <div className="md:col-span-2">
          <ParitySection {...parityStatus} />
        </div>
        <div className="md:col-span-2">
          <ExitMonitorSection {...exitMonitor} nowMs={nowMs} />
        </div>
        <div className="md:col-span-2">
          <SystemAlertHealthSection {...systemAlertHealth} />
        </div>
      </div>
    </div>
  );
}
