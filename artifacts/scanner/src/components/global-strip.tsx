import { useGetGlobalIndices, getGetGlobalIndicesQueryKey } from "@workspace/api-client-react";
import { TrendingUp, TrendingDown, Globe } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { IndexQuote } from "@workspace/api-client-react";

const REGION_ORDER: { key: string; label: string; match: (i: IndexQuote) => boolean }[] = [
  { key: "asia", label: "ASIA", match: i => ["India / SGX", "Japan", "Hong Kong", "China"].includes(i.region ?? "") },
  { key: "europe", label: "EUROPE", match: i => ["UK", "Germany"].includes(i.region ?? "") },
  { key: "us", label: "US", match: i => i.region === "US" },
  { key: "commod", label: "COMMOD", match: i => i.region === "Global" },
  { key: "fx", label: "FX", match: i => i.region === "FX" },
];

function fmtPrice(p: number) {
  if (p < 5) return p.toFixed(4);
  if (p < 100) return p.toFixed(2);
  return p.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function Item({ idx }: { idx: IndexQuote }) {
  const up = idx.change >= 0;
  return (
    <div className="flex items-baseline gap-2 text-sm font-mono shrink-0 px-3 py-1.5 rounded border border-border/50 bg-background/40 hover:bg-background/80 transition-colors">
      <span className="text-muted-foreground text-[12px] font-medium">{idx.name}</span>
      <span className="font-bold tabular-nums text-[14px]">{fmtPrice(idx.price)}</span>
      <span className={`tabular-nums text-[12px] font-semibold ${up ? "text-signal-strong-buy" : "text-signal-strong-sell"}`}>
        {up ? <TrendingUp className="inline w-3.5 h-3.5" /> : <TrendingDown className="inline w-3.5 h-3.5" />}
        <span className="opacity-90 ml-1">{`${idx.changePercent > 0 ? "+" : ""}${idx.changePercent.toFixed(2)}%`}</span>
      </span>
    </div>
  );
}

export default function GlobalStrip() {
  const { data, isLoading } = useGetGlobalIndices({
    query: { refetchInterval: 30000, queryKey: getGetGlobalIndicesQueryKey() },
  });

  return (
    <div className="border-b border-border bg-card/40">
      <div className="w-full px-4 py-2.5">
        <div className="flex items-center gap-3 overflow-x-auto whitespace-nowrap">
          <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1.5 shrink-0 font-semibold">
            <Globe className="w-3.5 h-3.5" /> GLOBAL
          </span>
          {isLoading ? (
            <>
              <Skeleton className="h-7 w-36" />
              <Skeleton className="h-7 w-36" />
              <Skeleton className="h-7 w-36" />
            </>
          ) : (
            REGION_ORDER.flatMap((reg) => {
              const items = (data?.indices ?? []).filter(reg.match);
              if (items.length === 0) return [];
              return [
                <span
                  key={`label-${reg.key}`}
                  className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70 shrink-0 ml-2 font-semibold border-l border-border/40 pl-3"
                >
                  {reg.label}
                </span>,
                ...items.map(idx => <Item key={idx.symbol} idx={idx} />),
              ];
            })
          )}
        </div>
      </div>
    </div>
  );
}
