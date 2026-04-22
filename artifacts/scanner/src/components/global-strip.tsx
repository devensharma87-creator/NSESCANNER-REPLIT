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
    <div className="flex items-baseline gap-1.5 text-xs font-mono shrink-0 px-2.5 py-1 rounded border border-border/40 bg-background/40 hover:bg-background/80 transition-colors">
      <span className="text-muted-foreground text-[11px]">{idx.name}</span>
      <span className="font-bold tabular-nums">{fmtPrice(idx.price)}</span>
      <span className={`tabular-nums text-[11px] ${up ? "text-signal-strong-buy" : "text-signal-strong-sell"}`}>
        {up ? <TrendingUp className="inline w-3 h-3" /> : <TrendingDown className="inline w-3 h-3" />}
        {`${idx.change >= 0 ? "+" : ""}${Math.abs(idx.change) < 1 ? idx.change.toFixed(3) : idx.change.toFixed(2)}`}
        <span className="opacity-80 ml-1">({`${idx.changePercent > 0 ? "+" : ""}${idx.changePercent.toFixed(2)}%`})</span>
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
      <div className="w-full px-4 py-2">
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
          ) : (
            REGION_ORDER.flatMap((reg, regIdx) => {
              const items = (data?.indices ?? []).filter(reg.match);
              if (items.length === 0) return [];
              return [
                <span
                  key={`label-${reg.key}`}
                  className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/60 shrink-0 ml-1"
                >
                  {regIdx > 0 ? "·" : ""} {reg.label}
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
