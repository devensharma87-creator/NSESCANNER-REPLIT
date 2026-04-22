import { useGetGlobalIndices, getGetGlobalIndicesQueryKey } from "@workspace/api-client-react";
import { TrendingUp, TrendingDown, Globe, Play, Pause } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useMemo } from "react";
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
  const [playing, setPlaying] = useState(true);

  const blocks = useMemo(() => {
    return REGION_ORDER.flatMap((reg) => {
      const items = (data?.indices ?? []).filter(reg.match);
      if (items.length === 0) return [];
      return [
        <span
          key={`label-${reg.key}`}
          className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70 shrink-0 ml-2 font-semibold border-l border-border/40 pl-3"
        >
          {reg.label}
        </span>,
        ...items.map(idx => <Item key={`${reg.key}-${idx.symbol}`} idx={idx} />),
      ];
    });
  }, [data]);

  return (
    <div className="border-b border-border bg-card/40">
      <style>{`
        @keyframes global-strip-marquee {
          from { transform: translate3d(0, 0, 0); }
          to   { transform: translate3d(-50%, 0, 0); }
        }
        .global-strip-track {
          display: inline-flex;
          align-items: center;
          gap: 0.75rem;
          animation: global-strip-marquee 60s linear infinite;
          will-change: transform;
        }
        .global-strip-track[data-paused="true"] { animation-play-state: paused; }
        .global-strip-viewport:hover .global-strip-track { animation-play-state: paused; }
      `}</style>
      <div className="w-full px-4 py-2.5 flex items-center gap-3">
        <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1.5 shrink-0 font-semibold">
          <Globe className="w-3.5 h-3.5" /> GLOBAL
        </span>

        <button
          type="button"
          onClick={() => setPlaying(p => !p)}
          aria-label={playing ? "Pause global indices ticker" : "Play global indices ticker"}
          title={playing ? "Pause ticker" : "Play ticker"}
          className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded border border-border/60 bg-background/40 hover:bg-background/80 text-muted-foreground hover:text-foreground transition-colors"
        >
          {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        </button>

        <div className="global-strip-viewport flex-1 min-w-0 overflow-hidden whitespace-nowrap">
          {isLoading ? (
            <div className="flex items-center gap-3">
              <Skeleton className="h-7 w-36" />
              <Skeleton className="h-7 w-36" />
              <Skeleton className="h-7 w-36" />
            </div>
          ) : blocks.length === 0 ? (
            <span className="text-xs text-muted-foreground">No data</span>
          ) : (
            <div className="global-strip-track" data-paused={!playing}>
              <div className="flex items-center gap-3 shrink-0">{blocks}</div>
              <div className="flex items-center gap-3 shrink-0" aria-hidden="true">{blocks}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
