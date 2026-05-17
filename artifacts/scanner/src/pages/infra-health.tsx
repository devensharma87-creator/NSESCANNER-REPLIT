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
  TrendingUp,
  XCircle,
  Info,
  PauseCircle,
  Brain,
  Radio,
} from "lucide-react";
import { Seo } from "@/components/seo";
import {
  deriveCandleSeverity,
  deriveCoverageSeverity,
  deriveSnapshotSectionSeverity,
  deriveSnapshotSeverity,
  formatAge,
  rollUp,
  SEVERITY_LABEL,
  type Severity,
  type SnapshotDiagnostics,
  type CandleIntervalRow,
} from "@/lib/infraHealth";

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
  const reasoning = useEndpoint<ReasoningAnalyticsResp>("api/paper/diagnostics/fno-reasoning/analytics", auto, tick);
  const observability = useEndpoint<ObservabilityResp>("api/paper/diagnostics/fno-observability", auto, tick);

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
    return rollUp(severities);
  }, [security, sector, snapshot, analytics, candle, nowMs]);

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

      {/* Section grid — 2 columns on md+, single column on mobile */}
      <div className="grid gap-4 md:grid-cols-2">
        <SecuritySection {...security} />
        <SectorSection {...sector} />
        <CandleSection {...candle} nowMs={nowMs} />
        <SnapshotSection diag={snapshot} analytics={analytics} nowMs={nowMs} />
        <div className="md:col-span-2">
          <EquitySection cand={candidates} nowMs={nowMs} refresh={refresh} />
        </div>
        <div className="md:col-span-2">
          <ObservabilitySection {...observability} />
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
      </div>
    </div>
  );
}
