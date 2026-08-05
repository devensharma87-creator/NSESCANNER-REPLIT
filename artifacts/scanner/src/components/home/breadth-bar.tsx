import { useGetMarketTrend, getGetMarketTrendQueryKey } from "@workspace/api-client-react";
import { BarChart3 } from "lucide-react";
import { SectionSourceLabel } from "@/components/ui/section-source-label";

export default function BreadthBar() {
  const { data } = useGetMarketTrend({
    query: { refetchInterval: 30000, queryKey: getGetMarketTrendQueryKey() },
  });

  if (!data || !data.breadth) return null;

  const { advancers, decliners, unchanged } = data.breadth;
  const total = advancers + decliners + (unchanged ?? 0);
  const hasBreadth = total > 0;
  const advPct = total > 0 ? (advancers / total) * 100 : 0;
  const decPct = total > 0 ? (decliners / total) * 100 : 0;
  const unchPct = total > 0 ? ((unchanged ?? 0) / total) * 100 : 0;
  // Honesty: only show an A/D ratio when one is genuinely reported — never a
  // fabricated "0.00" that would read as extreme weakness.
  const adRatioRaw = data.breadth.advanceDeclineRatio;
  const adRatioVal =
    adRatioRaw != null && Number.isFinite(adRatioRaw) ? adRatioRaw : null;

  return (
    <div className="rounded-lg border border-border bg-card/50 px-3 py-2">
      <div className="flex items-center gap-2 mb-1.5">
        <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground font-semibold">
          Market Breadth
        </span>
        <SectionSourceLabel sectionId="market-breadth" runtime={{ hasData: hasBreadth }} />
        <div className="flex-1" />
        <span className="text-[10px] font-mono text-muted-foreground">
          A/D Ratio:{" "}
          <span
            className={`font-bold ${
              adRatioVal != null
                ? adRatioVal >= 1.5
                  ? "text-emerald-500"
                  : adRatioVal <= 0.66
                    ? "text-rose-500"
                    : "text-foreground"
                : "text-muted-foreground"
            }`}
          >
            {adRatioVal != null ? adRatioVal.toFixed(2) : "—"}
          </span>
        </span>
      </div>

      {hasBreadth ? (
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <div className="flex rounded-full overflow-hidden h-3">
              <div
                className="bg-emerald-500 transition-all"
                style={{ width: `${advPct}%` }}
                title={`Advancers: ${advancers}`}
              />
              <div
                className="bg-muted-foreground/30 transition-all"
                style={{ width: `${unchPct}%` }}
                title={`Unchanged: ${unchanged ?? 0}`}
              />
              <div
                className="bg-rose-500 transition-all"
                style={{ width: `${decPct}%` }}
                title={`Decliners: ${decliners}`}
              />
            </div>
          </div>
          <div className="flex items-center gap-3 text-[11px] font-mono tabular-nums shrink-0">
            <span className="text-emerald-500 font-bold">{advancers}↑</span>
            <span className="text-muted-foreground">{unchanged ?? 0}—</span>
            <span className="text-rose-500 font-bold">{decliners}↓</span>
          </div>
        </div>
      ) : (
        <div className="text-[11px] font-mono text-muted-foreground py-1">
          Breadth unavailable — no advance/decline counts reported yet.
        </div>
      )}
    </div>
  );
}
