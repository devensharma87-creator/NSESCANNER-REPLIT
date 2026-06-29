/**
 * Real Replay Diagnostics panel — read-only analytics for SNAPSHOT_PREMIUM_REPLAY runs.
 *
 * Parts A–I from the F&O Diagnostic Pack spec. All simulation outputs are
 * clearly labelled SIMULATION ONLY. No live trading rule is changed here.
 *
 * Data comes from GET /api/backtest/fno/runs/:runId/diagnostics.
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  BarChart2,
  ChevronDown,
  ChevronRight,
  Clock,
  Info,
  RefreshCw,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  useReplayDiagnostics,
  type DiagGroup,
  type DiagStats,
  type DiagSetupGroup,
  type SimulationResult,
  type DiagDayCluster,
} from "@/lib/backtest/useReplayDiagnostics";

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function money(v: number | null, fallback = "n/a"): string {
  if (v === null || v === undefined) return fallback;
  const sign = v < 0 ? "−" : v > 0 ? "+" : "";
  return `${sign}₹${Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function pct(v: number | null, fallback = "n/a"): string {
  if (v === null || v === undefined) return fallback;
  return `${(v * 100).toFixed(1)}%`;
}

function pfFmt(v: number | null, fallback = "n/a"): string {
  if (v === null || v === undefined) return fallback;
  if (v >= 9999) return "∞";
  return v.toFixed(2);
}

function netColor(v: number): string {
  if (v > 0) return "text-emerald-400";
  if (v < 0) return "text-rose-400";
  return "text-muted-foreground";
}

// ---------------------------------------------------------------------------
// Micro-components
// ---------------------------------------------------------------------------

function SimOnly() {
  return (
    <span className="ml-1 rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-400">
      simulation only
    </span>
  );
}

function StatsRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border/40 py-1 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-medium tabular-nums">{children}</span>
    </div>
  );
}

function StatsMini({ s }: { s: DiagStats }) {
  return (
    <div className="space-y-0.5">
      <StatsRow label="Priced / Unavail">
        {s.pricedTrades} / {s.unavailableTrades}
      </StatsRow>
      <StatsRow label="Win rate">{pct(s.winRate)}</StatsRow>
      <StatsRow label="Gross P&L">
        <span className={netColor(s.grossPnl)}>{money(s.grossPnl)}</span>
      </StatsRow>
      <StatsRow label="Costs">{money(-s.totalCosts).replace("−", "")}</StatsRow>
      <StatsRow label="Net P&L">
        <span className={netColor(s.netPnl)}>{money(s.netPnl)}</span>
      </StatsRow>
      <StatsRow label="Profit factor">{pfFmt(s.profitFactor)}</StatsRow>
      <StatsRow label="Max drawdown">
        <span className="text-rose-400">{money(s.maxDrawdown).replace("+", "")}</span>
      </StatsRow>
      {s.avgEntryPremium !== null && (
        <StatsRow label="Avg entry premium">₹{s.avgEntryPremium.toFixed(0)}</StatsRow>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group table — renders a DiagGroup[] as a sortable summary table
// ---------------------------------------------------------------------------

function GroupTable({
  rows,
  title,
  orderKeys,
}: {
  rows: DiagGroup[];
  title: string;
  orderKeys?: string[];
}) {
  const sorted = orderKeys
    ? [...rows].sort(
        (a, b) =>
          (orderKeys.indexOf(a.key) === -1 ? 99 : orderKeys.indexOf(a.key)) -
          (orderKeys.indexOf(b.key) === -1 ? 99 : orderKeys.indexOf(b.key)),
      )
    : rows;

  if (sorted.length === 0) {
    return (
      <div className="rounded border border-border/40 bg-card/40 p-3 text-xs text-muted-foreground">
        No data for {title}.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-1 pr-3 font-normal">Group</th>
              <th className="py-1 pr-2 text-right font-normal">Priced</th>
              <th className="py-1 pr-2 text-right font-normal">Win%</th>
              <th className="py-1 pr-2 text-right font-normal">Gross</th>
              <th className="py-1 pr-2 text-right font-normal">Costs</th>
              <th className="py-1 pr-2 text-right font-normal">Net</th>
              <th className="py-1 pr-2 text-right font-normal">PF</th>
              <th className="py-1 text-right font-normal">Avg prem</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((g) => (
              <tr key={g.key} className="border-b border-border/30 last:border-0">
                <td className="py-1 pr-3 font-medium">{g.label || g.key}</td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {g.pricedTrades}
                  {g.unavailableTrades > 0 && (
                    <span className="text-muted-foreground"> +{g.unavailableTrades}n/a</span>
                  )}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{pct(g.winRate)}</td>
                <td className={`py-1 pr-2 text-right tabular-nums ${netColor(g.grossPnl)}`}>
                  {money(g.grossPnl)}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums text-muted-foreground">
                  {money(-g.totalCosts).replace("−", "−")}
                </td>
                <td className={`py-1 pr-2 text-right tabular-nums font-semibold ${netColor(g.netPnl)}`}>
                  {money(g.netPnl)}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{pfFmt(g.profitFactor)}</td>
                <td className="py-1 text-right tabular-nums text-muted-foreground">
                  {g.avgEntryPremium !== null ? `₹${g.avgEntryPremium.toFixed(0)}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Simulation result card
// ---------------------------------------------------------------------------

function SimCard({ sim, label }: { sim: SimulationResult; label?: string }) {
  return (
    <div className="rounded border border-amber-500/20 bg-amber-500/5 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400">
        <ShieldAlert className="h-3 w-3" />
        {label ?? sim.label}
        <SimOnly />
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-4">
        <div>
          <span className="text-muted-foreground">Trades: </span>
          <span className="tabular-nums">{sim.trades}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Win rate: </span>
          <span className="tabular-nums">{pct(sim.winRate)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Net P&L: </span>
          <span className={`tabular-nums font-semibold ${netColor(sim.netPnl)}`}>
            {money(sim.netPnl)}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">PF: </span>
          <span className="tabular-nums">{pfFmt(sim.profitFactor)}</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsible section
// ---------------------------------------------------------------------------

function Section({
  title,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-border bg-card/40">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        {icon}
        <span className="flex-1 text-sm font-semibold">{title}</span>
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {open && <div className="space-y-4 border-t border-border/50 px-4 pb-4 pt-3">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Day clusters
// ---------------------------------------------------------------------------

function DayClusterTable({
  rows,
  title,
  worst,
}: {
  rows: DiagDayCluster[];
  title: string;
  worst: boolean;
}) {
  const top = rows.slice(0, 5);
  if (top.length === 0) return null;
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-1 pr-2 font-normal">Date</th>
              <th className="py-1 pr-2 font-normal">Underlying</th>
              <th className="py-1 pr-2 text-right font-normal">Trades</th>
              <th className="py-1 pr-2 text-right font-normal">Win%</th>
              <th className="py-1 text-right font-normal">Net P&L</th>
            </tr>
          </thead>
          <tbody>
            {top.map((c, i) => (
              <tr key={i} className="border-b border-border/30 last:border-0">
                <td className="py-1 pr-2">{c.date}</td>
                <td className="py-1 pr-2">{c.underlying}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{c.pricedTrades}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{pct(c.winRate)}</td>
                <td
                  className={`py-1 text-right tabular-nums font-semibold ${worst ? "text-rose-400" : "text-emerald-400"}`}
                >
                  {money(c.netPnl)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setup group table (underlying-aware)
// ---------------------------------------------------------------------------

function SetupTable({ rows }: { rows: DiagSetupGroup[] }) {
  if (rows.length === 0)
    return (
      <div className="text-xs text-muted-foreground">No setup-level data available.</div>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-1 pr-2 font-normal">Underlying</th>
            <th className="py-1 pr-2 font-normal">Setup</th>
            <th className="py-1 pr-2 font-normal">Dir</th>
            <th className="py-1 pr-2 text-right font-normal">Priced</th>
            <th className="py-1 pr-2 text-right font-normal">Win%</th>
            <th className="py-1 pr-2 text-right font-normal">Net P&L</th>
            <th className="py-1 text-right font-normal">PF</th>
          </tr>
        </thead>
        <tbody>
          {rows
            .sort((a, b) => a.netPnl - b.netPnl)
            .map((g) => (
              <tr key={g.key} className="border-b border-border/30 last:border-0">
                <td className="py-1 pr-2">{g.underlying}</td>
                <td className="py-1 pr-2 font-medium">{g.key.split("::")[1] ?? g.key}</td>
                <td className="py-1 pr-2">{g.direction ?? "—"}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{g.pricedTrades}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{pct(g.winRate)}</td>
                <td className={`py-1 pr-2 text-right tabular-nums font-semibold ${netColor(g.netPnl)}`}>
                  {money(g.netPnl)}
                </td>
                <td className="py-1 text-right tabular-nums">{pfFmt(g.profitFactor)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function ReplayDiagnosticsPanel({ runId }: { runId: string }) {
  const { data, isLoading, isError, error, refetch, isFetching } = useReplayDiagnostics(runId);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-center text-xs text-muted-foreground">
        <RefreshCw className="h-4 w-4 animate-spin" />
        Computing diagnostics…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex items-center gap-2 rounded border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-400">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          Failed to load diagnostics: {(error as Error)?.message ?? "unknown error"}.{" "}
          <Button variant="ghost" size="sm" className="ml-1 h-auto px-1 py-0 text-xs" onClick={() => refetch()}>
            Retry
          </Button>
        </span>
      </div>
    );
  }

  const d = data;

  return (
    <div className="space-y-3">
      {/* Header notice */}
      <div className="flex items-start gap-2 rounded border border-sky-500/20 bg-sky-500/5 p-3 text-xs text-sky-300">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-0.5">
          <div className="font-semibold">Real Replay Diagnostics — Evidence layer only</div>
          <div className="text-muted-foreground">
            Based on <code className="text-sky-300">SNAPSHOT_PREMIUM_REPLAY</code> ({d.instrument},{" "}
            {d.fromDate} → {d.toDate}). UNAVAILABLE trades are excluded from P&amp;L.
            Simulation-only rules are <strong>not active in live trading</strong>. No signal
            logic has been changed.
          </div>
        </div>
      </div>

      {/* 1. Underlying comparison */}
      <Section
        title="1 · Underlying Comparison"
        icon={<BarChart2 className="h-4 w-4 text-sky-400" />}
        defaultOpen
      >
        <GroupTable rows={d.byUnderlying} title="By underlying" />
        <div className="grid gap-4 md:grid-cols-3">
          {d.byUnderlying.map((g) => (
            <div key={g.key}>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {g.key} detail
              </div>
              <StatsMini s={g} />
            </div>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <DayClusterTable rows={d.worstLossClusters} title="Worst loss days (top 5)" worst />
          <DayClusterTable rows={d.bestProfitClusters} title="Best profit days (top 5)" worst={false} />
        </div>
      </Section>

      {/* 2. Setup performance */}
      <Section title="2 · Setup Performance" icon={<TrendingUp className="h-4 w-4 text-violet-400" />}>
        <SetupTable rows={d.bySetup} />
        <div className="grid gap-4 md:grid-cols-2">
          <GroupTable rows={d.byDirection} title="By direction" />
          <GroupTable rows={d.byOptionType} title="By option type (CALL/PUT)" />
        </div>
        <GroupTable rows={d.byExitReason} title="By exit reason" />
      </Section>

      {/* 3. Cost drag */}
      <Section title="3 · Cost Drag" icon={<TrendingDown className="h-4 w-4 text-amber-400" />}>
        <GroupTable rows={d.byPremiumBucket} title="By entry premium bucket" />
        <GroupTable rows={d.byCostBucket} title="By total cost bucket" />
        {d.simulationOnlyRecommendations
          .filter((r) => r.label.includes("Premium"))
          .map((rec) => (
            <div key={rec.label} className="space-y-2">
              <div className="flex items-center gap-1 text-xs font-semibold text-amber-300">
                {rec.label} <SimOnly />
              </div>
              <div className="text-xs text-muted-foreground">{rec.description}</div>
              {rec.value && (
                <div className="rounded bg-card/60 px-2 py-1 font-mono text-xs text-amber-400">
                  {rec.value}
                </div>
              )}
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {rec.results.map((r) => (
                  <SimCard
                    key={r.label}
                    sim={r}
                    label={
                      "minPremiumThreshold" in r
                        ? `Min premium ₹${"minPremiumThreshold" in r ? (r as { minPremiumThreshold: number }).minPremiumThreshold : "?"}`
                        : r.label
                    }
                  />
                ))}
              </div>
            </div>
          ))}
      </Section>

      {/* 4. Expiry / Theta risk */}
      <Section title="4 · Expiry / Theta Risk" icon={<Clock className="h-4 w-4 text-orange-400" />}>
        <GroupTable
          rows={d.byExpiryDistance}
          title="By days-to-expiry at entry"
          orderKeys={["0DTE", "1DTE", "2DTE", "3–5DTE", ">5DTE", "Unknown"]}
        />
        <div className="rounded border border-border/40 bg-card/40 p-3 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Note: </span>
          Expiry data resolved from option_chain_snapshot via entry timestamp join.
          "Unknown" = no matching snapshot record (typically UNAVAILABLE trades).
          Near-expiry (0–1DTE) trades carry elevated theta risk — see BANKNIFTY May-26 55100PUT.
        </div>
      </Section>

      {/* 5. Time-of-day */}
      <Section title="5 · Time-of-Day" icon={<Clock className="h-4 w-4 text-teal-400" />}>
        <GroupTable
          rows={d.byTimeOfDay}
          title="By entry time (IST)"
          orderKeys={["09:15–09:30", "09:30–10:00", "10:00–11:00", "11:00–12:30", "12:30–14:00", "14:00–15:00", "15:00–15:20"]}
        />
        <GroupTable rows={d.byDayOfWeek} title="By day of week" />
      </Section>

      {/* 6. Snapshot availability */}
      <Section title="6 · Snapshot Availability" icon={<Info className="h-4 w-4 text-blue-400" />}>
        <GroupTable rows={d.bySnapshotAvailability} title="By pricing mode" />
        {d.unavailableReasons.length > 0 && (
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Unavailable root causes
            </div>
            <div className="space-y-1.5">
              {d.unavailableReasons.map((r) => (
                <div
                  key={r.reason}
                  className="flex items-start justify-between gap-2 rounded border border-border/40 bg-card/40 p-2"
                >
                  <div>
                    <div className="text-xs font-medium">{r.reason}</div>
                    <div className="text-[10px] text-muted-foreground">
                      Underlyings: {r.underlyings.join(", ")} · Example dates:{" "}
                      {r.exampleDates.join(", ")}
                    </div>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-xs">
                    {r.count}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}
        {d.unavailableByDate.length > 0 && (
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Top dates with unavailable signals
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-1 pr-3 font-normal">Date</th>
                    <th className="py-1 pr-3 font-normal">Underlying</th>
                    <th className="py-1 text-right font-normal">Unavailable</th>
                  </tr>
                </thead>
                <tbody>
                  {d.unavailableByDate.slice(0, 10).map((r, i) => (
                    <tr key={i} className="border-b border-border/30 last:border-0">
                      <td className="py-1 pr-3">{r.date}</td>
                      <td className="py-1 pr-3">{r.underlying}</td>
                      <td className="py-1 text-right tabular-nums">{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Section>

      {/* 7. SENSEX audit */}
      <Section title="7 · SENSEX Weakness Audit" icon={<TrendingDown className="h-4 w-4 text-rose-400" />}>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              All SENSEX trades
            </div>
            <StatsMini s={d.sensexAudit.all} />
          </div>
          <div>
            <SimCard sim={d.sensexAudit.excludingJun11to17} label="Excluding Jun 11–17 cluster" />
            <div className="mt-2 text-[10px] text-muted-foreground">
              Jun 11–17 was a reversal cluster with 5 consecutive SENSEX losses.
              Simulation shows whether weakness persists outside this window.
            </div>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <GroupTable rows={d.sensexAudit.byDirection} title="SENSEX by direction" />
          <GroupTable rows={d.sensexAudit.byExitReason} title="SENSEX by exit reason" />
        </div>
        <GroupTable rows={d.sensexAudit.byTimeOfDay} title="SENSEX by time of day" />
        <div className="grid gap-4 md:grid-cols-2">
          <GroupTable rows={d.sensexAudit.byPremiumBucket} title="SENSEX by premium bucket" />
          <GroupTable
            rows={d.sensexAudit.byExpiryDistance}
            title="SENSEX by expiry distance"
            orderKeys={["0DTE", "1DTE", "2DTE", "3–5DTE", ">5DTE", "Unknown"]}
          />
        </div>
      </Section>

      {/* 8. BANKNIFTY preservation */}
      <Section title="8 · BANKNIFTY Robustness" icon={<TrendingUp className="h-4 w-4 text-emerald-400" />}>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              All BANKNIFTY trades
            </div>
            <StatsMini s={d.bankniftyAudit.all} />
          </div>
          <div className="flex items-center justify-center">
            <div
              className={`rounded-lg border px-4 py-3 text-center ${
                d.bankniftyAudit.robustnessVerdict === "BANKNIFTY_EDGE_APPEARS_ROBUST_EARLY_SAMPLE"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-400"
              }`}
            >
              <div className="text-xs font-bold">{d.bankniftyAudit.robustnessVerdict}</div>
            </div>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <SimCard sim={d.bankniftyAudit.excludingBestTrade} label="Excluding best trade" />
          <SimCard sim={d.bankniftyAudit.excludingWorstTrade} label="Excluding worst trade" />
          <SimCard sim={d.bankniftyAudit.excludingBothBestAndWorst} label="Excl. best + worst" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <GroupTable rows={d.bankniftyAudit.bySetup} title="BANKNIFTY by setup" />
          <GroupTable rows={d.bankniftyAudit.byDirection} title="BANKNIFTY by direction" />
        </div>
        <GroupTable
          rows={d.bankniftyAudit.byExpiryDistance}
          title="BANKNIFTY by expiry distance"
          orderKeys={["0DTE", "1DTE", "2DTE", "3–5DTE", ">5DTE", "Unknown"]}
        />
      </Section>

      {/* 9. Re-entry audit */}
      {d.reentryClusters.length > 0 && (
        <Section title="9 · Re-entry / Same-Day Duplicate Audit" icon={<RefreshCw className="h-4 w-4 text-purple-400" />}>
          {d.simulationOnlyRecommendations
            .filter((r) => r.label.includes("Re-entry"))
            .map((rec) => (
              <div key={rec.label} className="space-y-2">
                <div className="text-xs text-muted-foreground">{rec.description}</div>
                {rec.results.map((r) => (
                  <SimCard key={r.label} sim={r} />
                ))}
              </div>
            ))}
          <div className="space-y-2">
            {d.reentryClusters.map((c, i) => (
              <div key={i} className="rounded border border-border/40 bg-card/40 p-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">
                    {c.underlying} · {c.date} · {c.strike} {c.optionType} · {c.direction}
                  </span>
                  <Badge variant="outline">{c.numEntries} entries</Badge>
                </div>
                <div className="mt-1 flex gap-4 text-muted-foreground">
                  <span>Gap: {c.timeGapMinutes !== null ? `${c.timeGapMinutes}m` : "—"}</span>
                  <span>Net: <span className={netColor(c.totalNetPnl)}>{money(c.totalNetPnl)}</span></span>
                  <span>Exits: {c.exitReasons.join(", ")}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 10. Simulation-only recommendations */}
      <Section
        title="10 · Simulation-Only Rules"
        icon={<ShieldAlert className="h-4 w-4 text-amber-400" />}
      >
        <div className="rounded border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-300">
          <strong>These rules are NOT active in live trading.</strong> They are evidence-building
          simulations only. No guardrail, sizing rule, or signal logic has been changed.
        </div>
        {d.simulationOnlyRecommendations.map((rec) => (
          <div key={rec.label} className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{rec.label}</span>
              <SimOnly />
            </div>
            <div className="text-xs text-muted-foreground">{rec.description}</div>
            {rec.value && (
              <div className="rounded bg-card/60 px-2 py-1 font-mono text-xs text-amber-400">
                {rec.value}
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {rec.results.map((r) => (
                <SimCard key={r.label} sim={r} />
              ))}
            </div>
          </div>
        ))}
      </Section>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border/40 pt-2 text-[10px] text-muted-foreground">
        <span>Generated at {new Date(d.generatedAt).toLocaleString("en-IN")}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-auto gap-1 px-2 py-1 text-[10px]"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>
    </div>
  );
}
