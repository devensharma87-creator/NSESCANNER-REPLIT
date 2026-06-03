import { Card } from "@/components/ui/card";
import type { PortfolioSummary } from "@/lib/portfolio/types";
import { returnLabel } from "@/lib/portfolio/returnLabel";
import { fmtINR, fmtSignedINR, fmtPct, pnlClass } from "./format";

function Kpi({
  label,
  value,
  sub,
  valueClass,
  testid,
  titleHint,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
  testid?: string;
  titleHint?: string;
}) {
  return (
    <Card className="p-3" data-testid={testid}>
      <div
        className="text-[11px] uppercase tracking-wide text-muted-foreground"
        title={titleHint}
      >
        {label}
        {titleHint && <span className="ml-0.5 cursor-help text-muted-foreground/60">ⓘ</span>}
      </div>
      <div className={`mt-1 font-mono text-lg font-semibold ${valueClass ?? ""}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </Card>
  );
}

export function KpiStrip({ summary }: { summary: PortfolioSummary }) {
  const ret = returnLabel({
    approxXirr: summary.approxXirr,
    xirrExcluded: summary.xirrExcluded,
    holdingsCount: summary.holdingsCount,
  });
  const retValue = ret.value == null ? ret.label : `${fmtPct(ret.value * 100, 1)}`;
  const retSub =
    ret.kind === "UNAVAILABLE"
      ? summary.xirrExcluded > 0
        ? `${summary.xirrExcluded} holding(s) lack dates`
        : "needs dated holdings"
      : ret.kind === "ESTIMATE"
        ? `estimate · excl. ${summary.xirrExcluded} undated`
        : "true XIRR · all dated";

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
        titleHint="Today's move = qty × (CMP − previous close), summed across holdings with a live price."
      />
      <Kpi
        label="Holdings"
        value={String(summary.holdingsCount)}
        sub={`${summary.winners} up · ${summary.losers} down`}
        testid="kpi-holdings"
      />
      <Kpi
        label={ret.label}
        value={retValue}
        sub={retSub}
        testid="kpi-xirr"
        titleHint={ret.tooltip}
      />
    </div>
  );
}
