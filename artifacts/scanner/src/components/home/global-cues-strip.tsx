import { useGetGlobalIndices, getGetGlobalIndicesQueryKey } from "@workspace/api-client-react";
import { Globe2 } from "lucide-react";

const CUES = [
  { symbol: "GIFTNIFTY", label: "GIFT Nifty" },
  { symbol: "^DJI", label: "Dow" },
  { symbol: "^GSPC", label: "S&P 500" },
  { symbol: "^IXIC", label: "Nasdaq" },
  { symbol: "INR=X", label: "USD/INR", invert: true },
  { symbol: "BZ=F", label: "Brent" },
  { symbol: "GC=F", label: "Gold" },
  { symbol: "^VIX", label: "VIX", invertColor: true },
  { symbol: "DX-Y.NYB", label: "DXY", invertColor: true },
  { symbol: "^TNX", label: "US 10Y" },
];

function fmt(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function GlobalCuesStrip() {
  const { data } = useGetGlobalIndices({
    query: { refetchInterval: 30000, queryKey: getGetGlobalIndicesQueryKey() },
  });

  const indices = data?.indices ?? [];

  return (
    <div className="rounded-lg border border-border bg-card/50 px-3 py-2">
      <div className="flex items-center gap-2 mb-1.5">
        <Globe2 className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground font-semibold">
          Global Cues
        </span>
      </div>
      <div className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-thin">
        {CUES.map((cue, i) => {
          const item = indices.find(ix => ix.symbol === cue.symbol);
          if (!item) return null;
          const pct = item.changePercent ?? 0;
          const isUp = pct > 0;
          const useInvert = cue.invertColor;
          const colorCls = useInvert
            ? (isUp ? "text-rose-500" : pct < 0 ? "text-emerald-500" : "text-muted-foreground")
            : (isUp ? "text-emerald-500" : pct < 0 ? "text-rose-500" : "text-muted-foreground");

          return (
            <div key={cue.symbol} className="flex items-center gap-1">
              {i > 0 && <span className="text-border mx-0.5">·</span>}
              <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded whitespace-nowrap">
                <span className="text-[11px] text-muted-foreground font-medium">{cue.label}</span>
                <span className="text-[11px] font-mono tabular-nums font-semibold">{fmt(item.price)}</span>
                <span className={`text-[10px] font-mono tabular-nums font-bold ${colorCls}`}>
                  {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
