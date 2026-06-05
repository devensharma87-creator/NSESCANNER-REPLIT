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
 * J Premium-target informational note.
 */
import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity,
  AlertTriangle,
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
  type PerIndexHealth,
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

  function refreshAll() {
    void health.refetch();
    void today.refetch();
    void waterfall.refetch();
    void noTrade.refetch();
    void setupPerf.refetch();
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
        severity={kiteSessionPresent ? "ok" : "fail"}
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
            <Info className="h-3 w-3" /> Without a live Kite session, F&O signals are not data-fresh; non-Kite
            option data is never treated as F&O-live.
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

      <p className="text-xs text-muted-foreground text-center">
        Read-only diagnostics · consumes existing owner-gated endpoints · no trade, gate, schedule or schema is
        affected by this page.
      </p>
    </div>
  );
}
