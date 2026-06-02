import { Card } from "@/components/ui/card";
import type { PortfolioSummary } from "@/lib/portfolio/types";
import { fmtINR, fmtSignedINR, fmtPct, pnlClass } from "./format";

function Kpi({
  label,
  value,
  sub,
  valueClass,
  testid,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
  testid?: string;
}) {
  return (
    <Card className="p-3" data-testid={testid}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-lg font-semibold ${valueClass ?? ""}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </Card>
  );
}

export function KpiStrip({ summary }: { summary: PortfolioSummary }) {
  const xirrLabel =
    summary.approxXirr == null
      ? "XIRR unavailable"
      : `${fmtPct(summary.approxXirr * 100, 1)} approx`;
  const xirrSub =
    summary.approxXirr == null
      ? summary.xirrExcluded > 0
        ? `${summary.xirrExcluded} holding(s) lack dates`
        : "needs dated holdings"
      : summary.xirrExcluded > 0
        ? `excl. ${summary.xirrExcluded} undated`
        : "annualised, approx";

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="kpi-strip">
      <Kpi label="Invested" value={fmtINR(summary.totalInvested)} testid="kpi-invested" />
      <Kpi
        label="Current Value"
        value={fmtINR(summary.totalCurrent)}
        sub={summary.totalCurrent == null ? "live data pending" : undefined}
        testid="kpi-current"
      />
      <Kpi
        label="Total P&L"
        value={fmtSignedINR(summary.totalReturn)}
        sub={summary.totalReturnPct != null ? fmtPct(summary.totalReturnPct) : undefined}
        valueClass={pnlClass(summary.totalReturn)}
        testid="kpi-total-pnl"
      />
      <Kpi
        label="Day P&L"
        value={fmtSignedINR(summary.dayChange)}
        sub={summary.dayChangePct != null ? fmtPct(summary.dayChangePct) : undefined}
        valueClass={pnlClass(summary.dayChange)}
        testid="kpi-day-pnl"
      />
      <Kpi
        label="Holdings"
        value={String(summary.holdingsCount)}
        sub={`${summary.winners} up · ${summary.losers} down`}
        testid="kpi-holdings"
      />
      <Kpi label="Approx XIRR" value={xirrLabel} sub={xirrSub} testid="kpi-xirr" />
    </div>
  );
}
