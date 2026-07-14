/**
 * W2A — top summary cards for the `/stocks-to-watch` Technical Analysis section.
 * Pure display of `summarize()` output (all derived from the existing payload).
 * No owner-only diagnostics.
 */
import { Layers, Target, Activity, TrendingUp, Gauge, Clock } from "lucide-react";
import { formatAge, type Severity } from "@/lib/infraHealth";
import type { SwingSummary } from "@/lib/stocksToWatchView";

const DOT: Record<Severity, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  stale: "bg-amber-500",
  fail: "bg-rose-500",
  disabled: "bg-muted-foreground",
};

function Card({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Layers;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="mt-1 text-lg font-mono tabular-nums leading-none">{value}</div>
      {hint != null && <div className="mt-1 text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function SummaryCards({ summary, nowMs }: { summary: SwingSummary; nowMs: number }) {
  const f = summary.freshness;
  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2"
      data-testid="swing-summary-cards"
    >
      <Card
        icon={Layers}
        label="Scanned"
        value={summary.totalScanned ?? summary.rowCount}
        hint={
          summary.errorCount != null && summary.errorCount > 0
            ? `${summary.errorCount} errors`
            : `${summary.rowCount} rows shown`
        }
      />
      <Card
        icon={Target}
        label="Actionable"
        value={summary.actionableCount}
        hint="buy-side setups"
      />
      <Card icon={Activity} label="Trigger hits" value={summary.triggerHits} hint="latched today" />
      <Card
        icon={TrendingUp}
        label="Top sector"
        value={summary.topSector?.sector ?? "—"}
        hint={summary.topSector ? `${summary.topSector.count} names` : undefined}
      />
      <Card
        icon={Gauge}
        label="Avg RS"
        value={summary.avgRs != null ? summary.avgRs.toFixed(1) : "—"}
        hint={`${summary.rsCoveragePct.toFixed(0)}% coverage`}
      />
      <Card
        icon={Clock}
        label="Freshness"
        value={
          <span className="inline-flex items-center gap-1.5 text-sm">
            <span className={`h-2 w-2 rounded-full ${DOT[f.severity]}`} />
            {f.label}
          </span>
        }
        hint={
          f.lastIntradayRefreshAt
            ? `updated ${formatAge(f.lastIntradayRefreshAt, nowMs)}`
            : f.scanDate
              ? `scan ${f.scanDate}`
              : "no scan"
        }
      />
    </div>
  );
}
