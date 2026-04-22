import { useGetMarketSummary, getGetMarketSummaryQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { TrendingUp, TrendingDown, Flag } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useMemo } from "react";

function fmtIN(n: number) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

export default function IndianStrip() {
  const { data, isLoading } = useGetMarketSummary({
    query: { refetchInterval: 30000, queryKey: getGetMarketSummaryQueryKey() },
  });

  const items = useMemo(() => data?.indices ?? [], [data]);

  return (
    <div className="border-b border-border bg-card/60">
      <div className="w-full px-4 py-2 flex items-center gap-3">
        <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1.5 shrink-0 font-semibold">
          <Flag className="w-3.5 h-3.5 text-signal-strong-buy" /> INDIA
        </span>

        <div className="flex-1 min-w-0 overflow-x-auto whitespace-nowrap scrollbar-thin">
          {isLoading ? (
            <div className="flex items-center gap-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-7 w-32 shrink-0" />)}
            </div>
          ) : (
            <div className="inline-flex items-center gap-2">
              {items.map(idx => {
                const up = idx.change >= 0;
                const tone = up ? "text-signal-strong-buy" : "text-signal-strong-sell";
                const slug = (idx as unknown as { constituentSlug?: string }).constituentSlug;
                const breadth = (idx as unknown as { breadth?: { advancers: number; decliners: number } }).breadth;
                const inner = (
                  <span className="inline-flex items-baseline gap-1.5 px-2.5 py-1 rounded border border-border/50 bg-background/40 hover:bg-background/80 hover:border-border transition-colors text-sm font-mono shrink-0">
                    <span className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wide">{idx.name}</span>
                    <span className="font-bold tabular-nums text-[13px]">{fmtIN(idx.price)}</span>
                    <span className={`tabular-nums text-[11px] font-semibold ${tone}`}>
                      {up ? <TrendingUp className="inline w-3 h-3" /> : <TrendingDown className="inline w-3 h-3" />}
                      <span className="ml-0.5">{idx.changePercent > 0 ? "+" : ""}{idx.changePercent.toFixed(2)}%</span>
                    </span>
                    {breadth && (
                      <span className="text-[10px] font-mono text-muted-foreground/80 ml-1 border-l border-border/40 pl-1.5">
                        <span className="text-signal-strong-buy">▲{breadth.advancers}</span>
                        <span className="mx-0.5">/</span>
                        <span className="text-signal-strong-sell">▼{breadth.decliners}</span>
                      </span>
                    )}
                  </span>
                );
                return slug ? (
                  <Link key={idx.symbol} href={`/index/${slug}`} className="block shrink-0">{inner}</Link>
                ) : (
                  <span key={idx.symbol} className="block shrink-0">{inner}</span>
                );
              })}
              {data && (
                <span className="ml-2 px-2 py-0.5 bg-secondary/40 rounded text-[10px] font-mono uppercase border border-border font-semibold text-muted-foreground shrink-0">
                  {data.marketStatus || "—"}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
