/**
 * Performance breakdown tables for the owner-only `/paper-reports` Overview.
 *
 * Read-only, post-trade analytics. Renders setup-wise, exit-reason-wise and
 * index/symbol-wise performance from already-normalized closed-trade rows
 * (helper `buildReportPerformanceRows`). No data fetching, no calculation that
 * isn't delegated to the accepted pure helpers — this component only formats.
 *
 * Truthfulness rules:
 *  - Grouping never fabricates a key; rows missing a dimension are dropped by
 *    the helper. When the index/symbol dimension is absent from every row the
 *    table renders an explicit "unavailable from current payload" message.
 *  - Missing numeric fields render as "—", never as a fabricated zero.
 */
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { BarChart3 } from "lucide-react";
import {
  buildReportPerformanceRows,
  type NormalizedReportRow,
  type ReportPerformanceRow,
  type ReportGroupBy,
} from "@/lib/reportsView";

export interface ReportsPerformanceTablesProps {
  rows: NormalizedReportRow[];
  loading?: boolean;
  error?: string | null;
}

const inr0 = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);

function moneyOrDash(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+ " : n < 0 ? "- " : "";
  return `${sign}${inr0(Math.abs(n))}`;
}

function pctOrDash(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(0)}%`;
}

function rOrDash(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}R`;
}

function moneyTone(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "text-slate-500";
  if (n > 0) return "text-emerald-400";
  if (n < 0) return "text-rose-400";
  return "text-slate-300";
}

function prettyKey(k: string): string {
  return k.replace(/_/g, " ");
}

function PerfTable({
  title,
  description,
  rows,
  keyLabel,
  showAvgR,
}: {
  title: string;
  description: string;
  rows: ReportPerformanceRow[];
  keyLabel: string;
  showAvgR?: boolean;
}) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-mono">
            <thead>
              <tr className="border-b border-slate-700/60 text-[11px] uppercase text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">{keyLabel}</th>
                <th className="px-3 py-2 text-right font-medium">Trades</th>
                <th className="px-3 py-2 text-right font-medium">W / L</th>
                <th className="px-3 py-2 text-right font-medium">Win %</th>
                <th className="px-3 py-2 text-right font-medium">Avg P&amp;L</th>
                <th className="px-3 py-2 text-right font-medium">Total P&amp;L</th>
                <th className="px-3 py-2 text-right font-medium">Best</th>
                <th className="px-3 py-2 text-right font-medium">Worst</th>
                {showAvgR && (
                  <th className="px-3 py-2 text-right font-medium">Avg R</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const a = r.aggregate;
                return (
                  <tr key={r.key} className="border-t border-slate-800/60">
                    <td className="px-3 py-2">
                      <span className="font-medium text-slate-200">
                        {prettyKey(r.key)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {a.tradeCount}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {a.wins} / {a.losses}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right tabular-nums",
                        a.winRatePct == null
                          ? "text-slate-500"
                          : a.winRatePct >= 50
                            ? "text-emerald-400"
                            : "text-rose-400",
                      )}
                    >
                      {pctOrDash(a.winRatePct)}
                    </td>
                    <td className={cn("px-3 py-2 text-right tabular-nums", moneyTone(a.avgPnl))}>
                      {moneyOrDash(a.avgPnl)}
                    </td>
                    <td className={cn("px-3 py-2 text-right tabular-nums", moneyTone(a.realizedPnl))}>
                      {moneyOrDash(a.realizedPnl)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-400/90">
                      {moneyOrDash(a.bestTrade)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-rose-400/90">
                      {moneyOrDash(a.worstTrade)}
                    </td>
                    {showAvgR && (
                      <td className={cn("px-3 py-2 text-right tabular-nums", moneyTone(r.avgRMultiple))}>
                        {rOrDash(r.avgRMultiple)}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function Unavailable({ title, message }: { title: string; message: string }) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border border-slate-800 bg-slate-900/40 px-3 py-4 text-xs text-slate-500">
          {message}
        </div>
      </CardContent>
    </Card>
  );
}

export function ReportsPerformanceTables({
  rows,
  loading,
  error,
}: ReportsPerformanceTablesProps) {
  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="h-40 animate-pulse rounded-lg border border-slate-800 bg-slate-900/40"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-4 text-sm text-rose-200">
        <div className="mb-1 font-semibold">Failed to load performance tables</div>
        <div className="text-rose-100/80">{error}</div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="py-8 text-center text-muted-foreground">
          No closed trades in the selected period.
        </CardContent>
      </Card>
    );
  }

  const bySetup = buildReportPerformanceRows(rows, "setup");
  const byExit = buildReportPerformanceRows(rows, "exitReason");
  const byIndex = buildReportPerformanceRows(rows, "index");

  const make = (
    by: ReportPerformanceRow[],
    cfg: { title: string; description: string; keyLabel: string; showAvgR?: boolean; missing: string; groupBy: ReportGroupBy },
  ) =>
    by.length > 0 ? (
      <PerfTable
        title={cfg.title}
        description={cfg.description}
        rows={by}
        keyLabel={cfg.keyLabel}
        showAvgR={cfg.showAvgR}
      />
    ) : (
      <Unavailable title={cfg.title} message={cfg.missing} />
    );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
        <BarChart3 className="h-4 w-4 text-sky-300" />
        Performance breakdown
      </div>

      {make(bySetup, {
        title: "Setup-wise performance",
        description: "Closed-trade P&L grouped by strategy setup",
        keyLabel: "Setup",
        showAvgR: true,
        missing: "Setup performance unavailable from current payload.",
        groupBy: "setup",
      })}

      {make(byExit, {
        title: "Exit-reason performance",
        description: "How closed trades ended",
        keyLabel: "Exit reason",
        missing: "Exit-reason performance unavailable from current payload.",
        groupBy: "exitReason",
      })}

      {make(byIndex, {
        title: "Index / symbol performance",
        description: "Closed-trade P&L grouped by index (F&O) or symbol (equity)",
        keyLabel: "Index / symbol",
        missing: "Index/symbol performance unavailable from current payload.",
        groupBy: "index",
      })}
    </div>
  );
}
