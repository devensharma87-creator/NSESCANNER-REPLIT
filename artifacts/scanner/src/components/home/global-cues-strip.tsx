import { useGetGlobalIndices, getGetGlobalIndicesQueryKey, useGetMarketMacroHistory, getGetMarketMacroHistoryQueryKey } from "@workspace/api-client-react";
import { Globe2 } from "lucide-react";

const CUES = [
  { symbol: "GIFTNIFTY", label: "GIFT Nifty" },
  { symbol: "^DJI", label: "Dow" },
  { symbol: "^GSPC", label: "S&P 500" },
  { symbol: "^IXIC", label: "Nasdaq" },
  { symbol: "INR=X", label: "USD/INR", invertColor: true },
  { symbol: "BZ=F", label: "Brent" },
  { symbol: "GC=F", label: "Gold" },
  { symbol: "^VIX", label: "VIX", invertColor: true, macroSymbol: "^VIX" },
  { symbol: "DX-Y.NYB", label: "DXY", invertColor: true, macroSymbol: "DX-Y.NYB" },
  { symbol: "^TNX", label: "US 10Y" },
  { symbol: "^INDIAVIX", label: "India VIX", invertColor: true, macroSymbol: "^INDIAVIX" },
  { symbol: "CL=F", label: "WTI Crude", macroSymbol: "CL=F" },
] as const;

function fmt(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface SparkPoint { c: number }

function Sparkline({ points, invert }: { points: SparkPoint[]; invert: boolean }) {
  if (points.length < 2) return null;
  const W = 44;
  const H = 14;
  const closes = points.map(p => p.c);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const dx = W / (points.length - 1);
  const path = closes
    .map((c, i) => {
      const x = i * dx;
      const y = H - ((c - min) / range) * H;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const first = closes[0]!;
  const last = closes[closes.length - 1]!;
  const rising = last > first;
  // For invert series (VIX, DXY, India VIX) rising = bearish for equities.
  const stroke = invert
    ? (rising ? "rgb(244 63 94)" : "rgb(16 185 129)")
    : (rising ? "rgb(16 185 129)" : "rgb(244 63 94)");
  return (
    <svg width={W} height={H} className="opacity-80" aria-hidden>
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function GlobalCuesStrip() {
  const { data } = useGetGlobalIndices({
    query: { refetchInterval: 30000, queryKey: getGetGlobalIndicesQueryKey() },
  });
  const { data: macro } = useGetMarketMacroHistory({
    query: { refetchInterval: 5 * 60_000, queryKey: getGetMarketMacroHistoryQueryKey(), staleTime: 5 * 60_000 },
  });

  const indices = data?.indices ?? [];
  const macroBySymbol = new Map((macro?.series ?? []).map(s => [s.symbol, s]));

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
          const useInvert = "invertColor" in cue && cue.invertColor;
          const colorCls = useInvert
            ? (isUp ? "text-rose-500" : pct < 0 ? "text-emerald-500" : "text-muted-foreground")
            : (isUp ? "text-emerald-500" : pct < 0 ? "text-rose-500" : "text-muted-foreground");
          const macroSym = "macroSymbol" in cue ? cue.macroSymbol : undefined;
          const spark = macroSym ? macroBySymbol.get(macroSym) : undefined;

          return (
            <div key={cue.symbol} className="flex items-center gap-1">
              {i > 0 && <span className="text-border mx-0.5">·</span>}
              <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded whitespace-nowrap">
                <span className="text-[11px] text-muted-foreground font-medium">{cue.label}</span>
                <span className="text-[11px] font-mono tabular-nums font-semibold">{fmt(item.price)}</span>
                <span className={`text-[10px] font-mono tabular-nums font-bold ${colorCls}`}>
                  {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
                </span>
                {spark && (
                  <span title={`${cue.label} · 5-day daily close (Yahoo)`} className="ml-0.5">
                    <Sparkline points={spark.points} invert={!!useInvert} />
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
