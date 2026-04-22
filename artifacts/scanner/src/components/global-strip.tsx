import { useGetGlobalIndices, getGetGlobalIndicesQueryKey } from "@workspace/api-client-react";
import { TrendingUp, TrendingDown, Globe } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function GlobalStrip() {
  const { data, isLoading } = useGetGlobalIndices({
    query: { refetchInterval: 30000, queryKey: getGetGlobalIndicesQueryKey() },
  });

  return (
    <div className="border-b border-border bg-card/40">
      <div className="container max-w-screen-2xl py-2">
        <div className="flex items-center gap-3 overflow-x-auto whitespace-nowrap">
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1 shrink-0">
            <Globe className="w-3 h-3" /> Global
          </span>
          {isLoading ? (
            <>
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-6 w-32" />
            </>
          ) : data?.indices?.map(idx => (
            <div key={idx.symbol} className="flex items-baseline gap-1 text-xs font-mono shrink-0 px-2 py-1 rounded border border-border/40 bg-background/40">
              <span className="text-muted-foreground">{idx.name}</span>
              <span className="font-bold">{idx.price.toFixed(idx.price < 100 ? 4 : 2)}</span>
              <span className={idx.change >= 0 ? "text-signal-strong-buy" : "text-signal-strong-sell"}>
                {idx.change >= 0 ? <TrendingUp className="inline w-3 h-3" /> : <TrendingDown className="inline w-3 h-3" />}
                {`${idx.changePercent > 0 ? "+" : ""}${idx.changePercent.toFixed(2)}%`}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
