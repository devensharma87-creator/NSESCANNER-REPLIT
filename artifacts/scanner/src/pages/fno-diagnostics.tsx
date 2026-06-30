/**
 * Owner-only F&O Diagnostics cockpit.
 *
 * READ-ONLY observability surface. Consumes the existing owner-gated
 * `/api/fno/*` diagnostics endpoints only and triggers NO ingestion,
 * signal, paper-trader, scheduler or write path. Every value is rendered
 * honestly — missing data shows a labelled "n/a"/"unavailable", never a
 * fabricated zero or verdict.
 *
 * Endpoints consumed (all GET, all requireOwner):
 *   - /api/fno/data-health
 *   - /api/fno/diagnostics/today
 *   - /api/fno/diagnostics/gate-waterfall
 *   - /api/fno/diagnostics/no-trade-reasons
 *   - /api/fno/diagnostics/setup-performance
 *
 * Sections: A Data Health · B Signal Allowed/Blocked · C Kite/WS/Chain
 * status · D Today · E Gate Waterfall · F No-Trade Reasons · G Setup
 * Performance · H Dormant-Detector warning · I Gross-vs-Net note ·
 * J Premium-target informational note · K Signal Gap.
 */
import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity,
  AlertTriangle,
  Ban,
  CheckCircle2,
  Gauge,
  Info,
  PauseCircle,
  Radio,
  RefreshCw,
  Receipt,
  ShieldCheck,
  Signal,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { Seo } from "@/components/seo";
import {
  normalizeSeverity,
  rollUpSeverity,
  verdictSeverity,
  verdictLabel,
  providerLabel,
  formatAgeSec,
  numOrNa,
  pctOrNa,
  rateOrNa,
  formatExpectedMove,
  formatEnvLabel,
  summarizeReadiness,
  type Severity,
} from "@/lib/fno/diagnostics-format";
import {
  useFnoDataHealth,
  useFnoToday,
  useFnoGateWaterfall,
  useFnoNoTradeReasons,
  useFnoSetupPerformance,
  useFnoBlockedSignals,
  useFnoNoSignalGap,
  type PerIndexHealth,
  type NoSignalGapResponse,
} from "@/lib/fno/diagnostics-fetch";

const SEVERITY_LABEL: Record<Severity, string> = {
  ok: "OK",
  warn: "Warning",
  fail: "Critical",
  unavailable: "Unavailable",
};

function SeverityIcon({ s, className }: { s: Severity; className?: string }) {
  const cls = className ?? "h-4 w-4";
  if (s === "ok") return <CheckCircle2 className={`${cls} text-emerald-500`} aria-hidden />;
  if (s === "warn") return <AlertTriangle className={`${cls} text-amber-500`} aria-hidden />;
  if (s === "unavailable") return <PauseCircle className={`${cls} text-muted-foreground`} aria-hidden />;
  return <XCircle className={`${cls} text-rose-500`} aria-hidden />;
}

function SeverityBadge({ s }: { s: Severity }) {
  const cls: Record<Severity, string> = {
    ok: "border-emerald-600 text-emerald-600",
    warn: "border-amber-600 text-amber-600",
    fail: "border-rose-600 text-rose-600",
    unavailable: "border-muted-foreground text-muted-foreground",
  };
  return (
    <Badge variant="outline" className={cls[s]} data-testid={`badge-severity-${s}`}>
      {SEVERITY_LABEL[s]}
    </Badge>
  );
}

function SectionShell({
  title,
  icon: Icon,
  severity,
  description,
  children,
  testId,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  severity: Severity;
  description?: string;
  children: React.ReactNode;
  testId?: string;
}) {
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

function Na({ reason }: { reason?: string }) {
  return (
    <span className="text-muted-foreground" title={reason ?? "not available from source"}>
      n/a
    </span>
  );
}

function ErrorNote({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="text-sm text-rose-500 flex items-center gap-2">
      <XCircle className="h-4 w-4" /> Failed to load: {msg}
    </div>
  );
}

export default function FnODiagnosticsPage() {
  const [auto, setAuto] = useState(true);
  const [tick, setTick] = useState(0);

  const health = useFnoDataHealth(auto);
  const today = useFnoToday(auto);
  const waterfall = useFnoGateWaterfall(auto);
  const noTrade = useFnoNoTradeReasons(auto);
  const setupPerf = useFnoSetupPerformance(auto);
  const blocked = useFnoBlockedSignals(auto);
  const gap = useFnoNoSignalGap(true);

  function refreshAll() {
    void health.refetch();
    void today.refetch();
    void waterfall.refetch();
    void noTrade.refetch();
    void setupPerf.refetch();
    void blocked.refetch();
    void gap.refetch();
    setTick((t) => t + 1);
  }

  const perIndex: PerIndexHealth[] = health.data?.perIndex ?? [];
  const envInfo = health.data ? formatEnvLabel(health.data.environment) : null;

  // ── A. Data Health roll-up severity ──
  const dataHealthSeverity: Severity = useMemo(() => {
    if (health.isError) return "fail";
    if (!health.data) return "unavailable";
    const sevs = perIndex.map((p) =>
      rollUpSeverity([
        normalizeSeverity((p.spot as { status?: string }).status?.toUpperCase()),
        normalizeSeverity((p.chain.status ?? "").toUpperCase()),
      ]),
    );
    return rollUpSeverity(sevs);
  }, [health.data, health.isError, perIndex]);

  // ── B. Signal-allowed roll-up severity ──
  const signalSeverity: Severity = useMemo(() => {
    if (health.isError) return "fail";
    if (!health.data) return "unavailable";
    return rollUpSeverity(perIndex.map((p) => verdictSeverity(p.dataSourceVerdict)));
  }, [health.data, health.isError, perIndex]);

  const kiteSessionPresent = Boolean(
    (health.data?.kite?.session as { present?: boolean } | undefined)?.present,
  );
  const kiteDbReadCode = (health.data?.kite?.session as { dbReadCode?: string } | undefined)?.dbReadCode;
  const kiteSessionDbFailed =
    kiteDbReadCode === "DB_POOL_CONNECTION_TERMINATED" || kiteDbReadCode === "DB_SESSION_READ_FAILED";

  // ── K. Signal-gap severity ──
  const gapSeverity: Severity = useMemo(() => {
    if (gap.isError) return "fail";
    if (!gap.data) return "unavailable";
    const g = gap.data as NoSignalGapResponse;
    if (g.isDataRelatedGap && (g.gapTradingDays ?? 0) > 5) return "fail";
    if (g.isDataRelatedGap && (g.gapTradingDays ?? 0) > 0) return "warn";
    return "ok";
  }, [gap.data, gap.isError]);

  return (
    <div className="container mx-auto px-4 py-6 space-y-6 max-w-6xl">
      <Seo title="F&O Diagnostics" description="Owner-only F&O execution & signal observability" noindex />

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Gauge className="h-6 w-6" /> F&O Diagnostics
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Owner-only, read-only observability for F&O data freshness, signal readiness and the
            execution funnel. Nothing here changes a trade, gate or schedule.
          </p>
          {health.data && (
            <p className="text-xs text-muted-foreground mt-1">
              Environment:{" "}
              <span className="font-mono" title={envInfo?.reason ?? undefined}>
                {envInfo?.label ?? "n/a"}
              </span>
              {envInfo?.autoTrading != null && (
                <> · Auto-trading {envInfo.autoTrading ? "on" : "off"}</>
              )}{" "}
              · Generated {new Date(health.data.generatedAt).toLocaleTimeString()}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={auto ? "default" : "outline"}
            size="sm"
            onClick={() => setAuto((a) => !a)}
            data-testid="button-toggle-auto"
          >
            <Radio className="h-4 w-4 mr-1" /> Auto {auto ? "on" : "off"}
          </Button>
          <Button variant="outline" size="sm" onClick={refreshAll} data-testid="button-refresh">
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>
      </div>

      {/* ── A. Data Health ───────────────────────────────────────────── */}
      <SectionShell
        title="A · Data Health"
        icon={Activity}
        severity={dataHealthSeverity}
        description="Per-index live spot + option-chain freshness and provenance."
        testId="section-data-health"
      >
        {health.isError ? (
          <ErrorNote error={health.error} />
        ) : health.isLoading && !health.data ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : perIndex.length === 0 ? (
          <div className="text-sm text-muted-foreground">No F&O universe data available.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-2 pr-3">Index</th>
                  <th className="py-2 pr-3">Spot</th>
                  <th className="py-2 pr-3">Spot age</th>
                  <th className="py-2 pr-3">Spot source</th>
                  <th className="py-2 pr-3">Chain source</th>
                  <th className="py-2 pr-3">Chain age</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {perIndex.map((p) => {
                  const spot = p.spot as {
                    status?: string;
                    price?: number;
                    ageSec?: number | null;
                    reason?: string;
                  };
                  const chain = p.chain as { ageSec?: number | null };
                  return (
                    <tr key={p.indexSymbol} className="border-b border-border/40">
                      <td className="py-2 pr-3 font-medium">{p.display}</td>
                      <td className="py-2 pr-3">
                        {spot.price != null ? numOrNa(spot.price, 2) : <Na reason={spot.reason} />}
                      </td>
                      <td className="py-2 pr-3">{formatAgeSec(spot.ageSec ?? null)}</td>
                      <td className="py-2 pr-3">{providerLabel(p.spotProvider)}</td>
                      <td className="py-2 pr-3">{providerLabel(p.optionChainProvider)}</td>
                      <td className="py-2 pr-3">{formatAgeSec(chain.ageSec ?? null)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionShell>

      {/* ── B. Signal Allowed / Blocked ──────────────────────────────── */}
      <SectionShell
        title="B · Signal Allowed / Blocked"
        icon={Signal}
        severity={signalSeverity}
        description="Read-only verdict: is there fresh, live Kite spot + Kite option data sufficient to TRUST an F&O signal right now? This view drives no trade — the binding gates run at execution time."
        testId="section-signal-readiness"
      >
        {health.isError ? (
          <ErrorNote error={health.error} />
        ) : perIndex.length === 0 ? (
          <div className="text-sm text-muted-foreground">No data.</div>
        ) : (
          <div className="space-y-3">
            {perIndex.map((p) => {
              const em = formatExpectedMove(p.expectedMove);
              return (
                <div key={p.indexSymbol} className="rounded border border-border/50 p-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{p.display}</span>
                      <Badge
                        variant="outline"
                        className={
                          p.signalAllowed
                            ? "border-emerald-600 text-emerald-600"
                            : "border-rose-600 text-rose-600"
                        }
                        data-testid={`badge-signal-${p.indexSymbol}`}
                      >
                        {p.signalAllowed ? "ALLOWED" : "BLOCKED"}
                      </Badge>
                      <SeverityBadge s={verdictSeverity(p.dataSourceVerdict)} />
                      <span className="text-xs text-muted-foreground">{verdictLabel(p.dataSourceVerdict)}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Expected move (±1σ):{" "}
                      {em.available ? (
                        <span title={em.formula ?? undefined}>
                          {em.points} pts ({em.percent})
                        </span>
                      ) : (
                        <Na reason={em.reason ?? undefined} />
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {summarizeReadiness({ signalAllowed: p.signalAllowed, blockingReasons: p.blockingReasons })}
                  </div>
                  {p.blockingReasons.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {p.blockingReasons.map((r, i) => (
                        <Badge
                          key={`${r.code}-${i}`}
                          variant="outline"
                          className={
                            r.severity === "FAIL"
                              ? "border-rose-600 text-rose-600"
                              : "border-amber-600 text-amber-600"
                          }
                          title={r.detail}
                        >
                          {r.code}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionShell>

      {/* ── C. Kite / WS / Chain status ──────────────────────────────── */}
      <SectionShell
        title="C · Kite / Feed / Chain Status"
        icon={Radio}
        severity={kiteSessionPresent ? "ok" : kiteSessionDbFailed ? "warn" : "fail"}
        description="Upstream data-source connectivity."
        testId="section-kite-status"
      >
        {health.isError ? (
          <ErrorNote error={health.error} />
        ) : !health.data ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Kite session</div>
              <div className="font-medium">
                {kiteSessionPresent ? (
                  <span className="text-emerald-500">Active</span>
                ) : kiteSessionDbFailed ? (
                  <span className="text-amber-500">DB read failed</span>
                ) : (
                  <span className="text-rose-500">Absent</span>
                )}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Universe</div>
              <div className="font-medium font-mono text-xs">{health.data.universe.join(", ")}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Reasoning logger</div>
              <div className="font-medium">
                {(() => {
                  const rl = health.data?.reasoningLogger as { healthy?: boolean; ok?: boolean } | undefined;
                  const ok = rl?.healthy ?? rl?.ok;
                  if (ok == null) return <Na />;
                  return ok ? (
                    <span className="text-emerald-500">Healthy</span>
                  ) : (
                    <span className="text-amber-500">Degraded</span>
                  );
                })()}
              </div>
            </div>
          </div>
        )}
        {!kiteSessionPresent && health.data && (
          <p className="text-xs text-amber-500 mt-3 flex items-center gap-1">
            <Info className="h-3 w-3" />
            {kiteSessionDbFailed
              ? `Kite session may be valid — DB pool read failed (${kiteDbReadCode}). F&O signals suppressed until the DB connection recovers.`
              : "Without a live Kite session, F&O signals are not data-fresh; non-Kite option data is never treated as F&O-live."}
          </p>
        )}
      </SectionShell>

      {/* ── D. Today ─────────────────────────────────────────────────── */}
      <SectionShell
        title="D · Today (IST)"
        icon={TrendingUp}
        severity={today.isError ? "fail" : today.data ? "ok" : "unavailable"}
        description="Today's decision funnel, demotions and open positions."
        testId="section-today"
      >
        {today.isError ? (
          <ErrorNote error={today.error} />
        ) : !today.data ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <div className="text-xs text-muted-foreground">Signal date</div>
                <div className="font-medium font-mono">{today.data.signalDate}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Open positions</div>
                <div className="font-medium">{today.data.openPositions.count}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Open rate</div>
                <div className="font-medium">{rateOrNa(today.data.conversion.openRate)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Decisive win rate</div>
                <div className="font-medium">{rateOrNa(today.data.conversion.decisiveWinRate)}</div>
              </div>
            </div>
            {today.data.openPositions.indices.length > 0 && (
              <div className="text-xs text-muted-foreground">
                Open: {today.data.openPositions.indices.join(", ")}
              </div>
            )}
            {today.data.decisions.length === 0 && (
              <div className="text-xs text-muted-foreground">No decisions logged today yet.</div>
            )}
          </div>
        )}
      </SectionShell>

      {/* ── E. Gate Waterfall ────────────────────────────────────────── */}
      <SectionShell
        title="E · Gate Waterfall"
        icon={Gauge}
        severity={waterfall.isError ? "fail" : waterfall.data ? "ok" : "unavailable"}
        description="Ordered decision funnel from emission to outcome (lifetime / filtered)."
        testId="section-gate-waterfall"
      >
        {waterfall.isError ? (
          <ErrorNote error={waterfall.error} />
        ) : !waterfall.data ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : waterfall.data.waterfall.funnel.length === 0 ? (
          <div className="text-sm text-muted-foreground">No funnel data.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-2 pr-3">Stage</th>
                  <th className="py-2 pr-3 text-right">Count</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {waterfall.data.waterfall.funnel.map((f) => (
                  <tr key={f.stage} className="border-b border-border/40">
                    <td className="py-2 pr-3">{f.stage}</td>
                    <td className="py-2 pr-3 text-right">{f.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-xs text-muted-foreground mt-2">
              Open rate {rateOrNa(waterfall.data.waterfall.conversion.openRate)} · Decisive win rate{" "}
              {rateOrNa(waterfall.data.waterfall.conversion.decisiveWinRate)}
            </div>
          </div>
        )}
      </SectionShell>

      {/* ── F. No-Trade Reasons ──────────────────────────────────────── */}
      <SectionShell
        title="F · No-Trade Reasons"
        icon={AlertTriangle}
        severity={noTrade.isError ? "fail" : noTrade.data ? "ok" : "unavailable"}
        description="Why setups did not become trades — durable (persisted) and ephemeral (process-local) with explicit provenance."
        testId="section-no-trade"
      >
        {noTrade.isError ? (
          <ErrorNote error={noTrade.error} />
        ) : !noTrade.data ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">
                Durable · {noTrade.data.noTradeReasons.durable.source}
              </div>
              {noTrade.data.noTradeReasons.durable.rejectionReasonsBySetup.length === 0 ? (
                <div className="text-xs text-muted-foreground">None recorded.</div>
              ) : (
                <ul className="space-y-1">
                  {noTrade.data.noTradeReasons.durable.rejectionReasonsBySetup.slice(0, 12).map((r, i) => (
                    <li key={`${r.setupKey}-${r.reasonCode}-${i}`} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">
                        {r.setupKey} · {r.reasonCode}
                      </span>
                      <span className="tabular-nums">{r.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">
                Ephemeral (process-local missed-signal ring) · total {noTrade.data.noTradeReasons.ephemeral.total}
              </div>
              {noTrade.data.noTradeReasons.ephemeral.byReason.length === 0 ? (
                <div className="text-xs text-muted-foreground">None this process lifetime.</div>
              ) : (
                <ul className="space-y-1">
                  {noTrade.data.noTradeReasons.ephemeral.byReason.slice(0, 12).map((r, i) => (
                    <li key={`${r.key}-${i}`} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{r.key}</span>
                      <span className="tabular-nums">{r.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </SectionShell>

      {/* ── G. Setup Performance ─────────────────────────────────────── */}
      <SectionShell
        title="G · Setup Performance"
        icon={TrendingUp}
        severity={setupPerf.isError ? "fail" : setupPerf.data ? "ok" : "unavailable"}
        description="Per-setup outcomes (emitted / opened / wins / stops / expiry + decisive win-rate). Realised P&L is intentionally not shown here."
        testId="section-setup-performance"
      >
        {setupPerf.isError ? (
          <ErrorNote error={setupPerf.error} />
        ) : !setupPerf.data ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : setupPerf.data.setupPerformance.rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">No setup outcomes recorded.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-2 pr-3">Setup</th>
                  <th className="py-2 pr-3 text-right">Emitted</th>
                  <th className="py-2 pr-3 text-right">Opened</th>
                  <th className="py-2 pr-3 text-right">T1</th>
                  <th className="py-2 pr-3 text-right">T2</th>
                  <th className="py-2 pr-3 text-right">Stopped</th>
                  <th className="py-2 pr-3 text-right">Expired</th>
                  <th className="py-2 pr-3 text-right">Win rate</th>
                  <th className="py-2 pr-3 text-right">Avg conf</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {setupPerf.data.setupPerformance.rows.map((r) => (
                  <tr key={r.setupKey} className="border-b border-border/40">
                    <td className="py-2 pr-3 font-medium">{r.setupKey}</td>
                    <td className="py-2 pr-3 text-right">{r.emitted}</td>
                    <td className="py-2 pr-3 text-right">{r.opened}</td>
                    <td className="py-2 pr-3 text-right">{r.target1}</td>
                    <td className="py-2 pr-3 text-right">{r.target2}</td>
                    <td className="py-2 pr-3 text-right">{r.stopped}</td>
                    <td className="py-2 pr-3 text-right">{r.expired}</td>
                    <td className="py-2 pr-3 text-right">{rateOrNa(r.decisiveWinRate)}</td>
                    <td className="py-2 pr-3 text-right">{numOrNa(r.avgConfidence, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionShell>

      {/* ── G2. Blocked / Demoted Signals (hygiene vetoes) ───────────── */}
      <SectionShell
        title="G2 · Blocked / Demoted Signals"
        icon={Ban}
        severity={blocked.isError ? "fail" : blocked.data ? "ok" : "unavailable"}
        description="Persistent, reviewable record of EMITTED signals carrying a 2026-06-09 hygiene veto (RECOVERY_MODE_VETO / CHASE_RISK_VETO) or demoted to INFO_ONLY — so you can judge across sessions whether the vetoes block bad trades or are too strict. Observability only; this view changes no trade or gate."
        testId="section-blocked-signals"
      >
        {blocked.isError ? (
          <ErrorNote error={blocked.error} />
        ) : !blocked.data ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          (() => {
            const b = blocked.data.blocked;
            return (
              <div className="space-y-4 text-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    Window{" "}
                    <span className="font-mono">{b.windowFrom ?? "—"}</span> →{" "}
                    <span className="font-mono">{b.windowTo ?? "—"}</span> ·{" "}
                    <span className="font-medium text-foreground">{b.total}</span> blocked/demoted
                  </span>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="outline" className="border-rose-600 text-rose-600">
                      Recovery veto {b.vetoTotals.recoveryModeVeto}
                    </Badge>
                    <Badge variant="outline" className="border-rose-600 text-rose-600">
                      Chase-risk veto {b.vetoTotals.chaseRiskVeto}
                    </Badge>
                    <Badge variant="outline" className="border-amber-600 text-amber-600">
                      INFO_ONLY {b.vetoTotals.infoOnly}
                    </Badge>
                  </div>
                </div>

                {b.total === 0 ? (
                  <div className="text-xs text-muted-foreground">
                    No blocked or demoted signals in this window.
                  </div>
                ) : (
                  <>
                    <div className="grid md:grid-cols-3 gap-4">
                      <div>
                        <div className="text-xs font-medium text-muted-foreground mb-1">By reason code</div>
                        <ul className="space-y-1">
                          {b.byReasonCode.map((r, i) => (
                            <li key={`${r.key}-${i}`} className="flex justify-between gap-2">
                              <span className="text-muted-foreground">{r.key}</span>
                              <span className="tabular-nums">{r.count}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <div className="text-xs font-medium text-muted-foreground mb-1">By index</div>
                        <ul className="space-y-1">
                          {b.byIndex.map((r, i) => (
                            <li key={`${r.key}-${i}`} className="flex justify-between gap-2">
                              <span className="text-muted-foreground">{r.key}</span>
                              <span className="tabular-nums">{r.count}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <div className="text-xs font-medium text-muted-foreground mb-1">By direction</div>
                        <ul className="space-y-1">
                          {b.byDirection.length === 0 ? (
                            <li className="text-xs text-muted-foreground">n/a</li>
                          ) : (
                            b.byDirection.map((r, i) => (
                              <li key={`${r.key}-${i}`} className="flex justify-between gap-2">
                                <span className="text-muted-foreground">{r.key}</span>
                                <span className="tabular-nums">{r.count}</span>
                              </li>
                            ))
                          )}
                        </ul>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <div className="text-xs font-medium text-muted-foreground mb-1">
                        Recent events {b.events.length < b.total && <>(latest {b.events.length} of {b.total})</>}
                      </div>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-muted-foreground border-b">
                            <th className="py-2 pr-3">Captured</th>
                            <th className="py-2 pr-3">Date</th>
                            <th className="py-2 pr-3">Index</th>
                            <th className="py-2 pr-3">Setup</th>
                            <th className="py-2 pr-3">Dir</th>
                            <th className="py-2 pr-3">Opt</th>
                            <th className="py-2 pr-3">Tier</th>
                            <th className="py-2 pr-3">Class</th>
                            <th className="py-2 pr-3 text-right">Spot</th>
                            <th className="py-2 pr-3 text-right">Conf</th>
                            <th className="py-2 pr-3">Reasons</th>
                          </tr>
                        </thead>
                        <tbody className="tabular-nums">
                          {b.events.map((e, i) => (
                            <tr key={`${e.capturedAt ?? ""}-${e.indexSymbol}-${i}`} className="border-b border-border/40">
                              <td className="py-2 pr-3 whitespace-nowrap">
                                {e.capturedAt ? new Date(e.capturedAt).toLocaleString() : <Na />}
                              </td>
                              <td className="py-2 pr-3 font-mono">{e.signalDate}</td>
                              <td className="py-2 pr-3">{e.indexSymbol}</td>
                              <td className="py-2 pr-3">{e.setupKey ?? <Na />}</td>
                              <td className="py-2 pr-3">{e.direction ?? <Na />}</td>
                              <td className="py-2 pr-3">{e.optionType ?? <Na />}</td>
                              <td className="py-2 pr-3">{e.tier ?? <Na />}</td>
                              <td className="py-2 pr-3">{e.tradeClass ?? <Na />}</td>
                              <td className="py-2 pr-3 text-right">{e.spot != null ? numOrNa(e.spot, 2) : <Na />}</td>
                              <td className="py-2 pr-3 text-right">{e.confidence ?? <Na />}</td>
                              <td className="py-2 pr-3">
                                <div className="flex flex-wrap gap-1">
                                  {e.reasonCodes.map((c, j) => (
                                    <Badge
                                      key={`${c}-${j}`}
                                      variant="outline"
                                      className={
                                        c === "INFO_ONLY"
                                          ? "border-amber-600 text-amber-600"
                                          : "border-rose-600 text-rose-600"
                                      }
                                    >
                                      {c}
                                    </Badge>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
                <p className="text-xs text-muted-foreground">
                  These rows are the persisted record (`fno_signal_reasoning`). They reflect what the live gates
                  already decided — nothing here re-runs or alters a gate.
                </p>
              </div>
            );
          })()
        )}
      </SectionShell>

      {/* ── H. Dormant-Detector warning ──────────────────────────────── */}
      <SectionShell
        title="H · Dormant Detectors"
        icon={PauseCircle}
        severity="warn"
        description="Detectors with zero emissions over the observed window — flagged for visibility, NOT auto-tuned."
        testId="section-dormant"
      >
        {(() => {
          const rows = setupPerf.data?.setupPerformance.rows ?? [];
          const dormant = rows.filter((r) => r.emitted === 0);
          if (setupPerf.isLoading && !setupPerf.data) {
            return <div className="text-sm text-muted-foreground">Loading…</div>;
          }
          if (rows.length === 0) {
            return (
              <div className="text-sm text-muted-foreground">
                No setup rows yet — dormancy cannot be assessed.
              </div>
            );
          }
          if (dormant.length === 0) {
            return <div className="text-sm text-muted-foreground">All observed detectors have emitted at least once.</div>;
          }
          return (
            <div className="text-sm">
              <p className="text-amber-500 mb-2 flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" /> {dormant.length} detector(s) with 0 emissions in the
                observed window:
              </p>
              <div className="flex flex-wrap gap-1">
                {dormant.map((r) => (
                  <Badge key={r.setupKey} variant="outline" className="border-amber-600 text-amber-600">
                    {r.setupKey}
                  </Badge>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                This is an observability flag only. Detector thresholds are NOT changed from this view.
              </p>
            </div>
          );
        })()}
      </SectionShell>

      {/* ── I. Gross-vs-Net note ─────────────────────────────────────── */}
      <SectionShell
        title="I · Gross vs Net (cost model)"
        icon={Receipt}
        severity="ok"
        description="How realised P&L relates to costs across the app."
        testId="section-gross-net"
      >
        <div className="text-sm text-muted-foreground space-y-2">
          <p>
            All headline F&O realised P&L figures (cockpit, reports) are <strong>gross / pre-cost</strong>.
            Brokerage, STT, exchange, SEBI, GST and stamp duty are computed as a <strong>shadow estimate</strong>{" "}
            and surfaced separately as "Estimated Costs" / "Estimated Net P&L".
          </p>
          <p className="flex items-center gap-1">
            <Info className="h-3 w-3" /> The shadow cost/net figures are reporting-only — they do NOT feed
            drawdown caps, portfolio-heat caps, sizing or any risk gate. Those gates all run on gross P&L.
          </p>
        </div>
      </SectionShell>

      {/* ── J. Premium-target informational note ─────────────────────── */}
      <SectionShell
        title="J · Premium Targets (informational)"
        icon={ShieldCheck}
        severity="ok"
        description="How premium target levels relate to exits."
        testId="section-premium-targets"
      >
        <div className="text-sm text-muted-foreground space-y-2">
          <p>
            Premium T1 / T2 levels shown on F&O surfaces are <strong>informational</strong>. The actual exit
            for an open F&O paper position is driven by its spot-lifecycle (stop / target / time / force-exit)
            logic, not by a premium tick crossing these display levels.
          </p>
          <p>The ATM straddle / expected-move figures above are a direct CE+PE LTP sum, never an approximation.</p>
        </div>
      </SectionShell>

      {/* ── K. Signal Gap ────────────────────────────────────── */}
      <SectionShell
        title="K · Signal Gap"
        icon={Signal}
        severity={gapSeverity}
        description="Last F&O signal dates + Mon–Fri trading-day gap. Identifies data-related outages vs normal market quiet. Trading-day count is Mon–Fri only — no NSE holiday list is maintained server-side."
        testId="section-signal-gap"
      >
        {gap.isError ? (
          <ErrorNote error={gap.error} />
        ) : gap.isLoading && !gap.data ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (() => {
          const g = gap.data as NoSignalGapResponse | undefined;
          if (!g) return <div className="text-sm text-muted-foreground">No gap data available.</div>;
          const lastAny = g.lastSignal?.any;
          const lastHc  = g.lastSignal?.highConviction;
          const dist    = g.suppressionReasonDistribution ?? [];
          return (
            <div className="space-y-4">
              {/* Gap summary banner */}
              {g.isDataRelatedGap && (g.gapTradingDays ?? 0) > 0 && (
                <div className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
                  <span>
                    <span className="font-semibold font-mono">{g.gapTradingDays}</span> trading day{g.gapTradingDays !== 1 ? "s" : ""} without a signal ·{" "}
                    <span className="font-mono">{g.gapReason}</span>
                  </span>
                  <span className="ml-auto text-[11px] font-mono text-muted-foreground shrink-0">
                    DATA ISSUE · NOT MARKET CONDITION
                  </span>
                </div>
              )}

              {/* Last signal table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b">
                      <th className="py-2 pr-4">Signal type</th>
                      <th className="py-2 pr-4">Last at (IST)</th>
                      <th className="py-2">Gap (Mon–Fri days)</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums text-sm">
                    {[
                      { label: "Any (HC or Baseline)", iso: lastAny, gap: g.gapTradingDays },
                      { label: "High-Conviction only",  iso: lastHc,  gap: null },
                      { label: "Paper trade opened",    iso: g.lastSignal?.paperTradeOpen, gap: null },
                    ].map(({ label, iso, gap: d }) => (
                      <tr key={label} className="border-b border-border/40">
                        <td className="py-1.5 pr-4 text-muted-foreground">{label}</td>
                        <td className="py-1.5 pr-4 font-mono">
                          {iso
                            ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
                            : <Na reason="no signal on record" />}
                        </td>
                        <td className="py-1.5">
                          {d != null ? (
                            <span className={d > 5 ? "text-rose-400 font-bold" : d > 1 ? "text-amber-400" : ""}>
                              {d} day{d !== 1 ? "s" : ""}
                            </span>
                          ) : <Na />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Dominant suppression reasons */}
              {dist.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Dominant suppression reasons (last 30 days):</p>
                  <div className="flex flex-wrap gap-1.5">
                    {dist.slice(0, 8).map(r => (
                      <Badge key={r.reasonCode} variant="outline" className="font-mono text-[11px]">
                        {r.reasonCode} <span className="ml-1 text-muted-foreground">×{r.count}</span>
                      </Badge>
                    ))}
                  </div>
                  {!g.isDataRelatedGap && (
                    <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                      <Info className="h-3 w-3" /> Reasons are engine/market-condition suppressions, not data infrastructure failures.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })()}
      </SectionShell>

      <p className="text-xs text-muted-foreground text-center">
        Read-only diagnostics · consumes existing owner-gated endpoints · no trade, gate, schedule or schema is
        affected by this page.
      </p>
    </div>
  );
}
