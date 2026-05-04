import { useListSectors, getListSectorsQueryKey } from "@workspace/api-client-react";
import { LayoutGrid } from "lucide-react";

function getBgColor(pct: number): string {
  if (pct >= 2) return "bg-emerald-600/90";
  if (pct >= 1) return "bg-emerald-500/70";
  if (pct >= 0.3) return "bg-emerald-500/40";
  if (pct > -0.3) return "bg-muted/60";
  if (pct > -1) return "bg-rose-500/40";
  if (pct > -2) return "bg-rose-500/70";
  return "bg-rose-600/90";
}

function getTextColor(pct: number): string {
  if (Math.abs(pct) >= 1) return "text-white";
  return "text-foreground";
}

export default function SectoralHeatmap() {
  const { data: sectors } = useListSectors({
    query: { refetchInterval: 30000, queryKey: getListSectorsQueryKey() },
  });

  if (!sectors || sectors.length === 0) return null;

  const sorted = [...sectors].sort((a, b) => (b.avgChangePercent ?? 0) - (a.avgChangePercent ?? 0));

  return (
    <div className="rounded-lg border border-border bg-card/50 px-3 py-2">
      <div className="flex items-center gap-2 mb-2">
        <LayoutGrid className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground font-semibold">
          Sectoral Heatmap
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground/50">
          <span className="w-2 h-2 rounded-sm bg-emerald-500/70" /> bullish
          <span className="w-2 h-2 rounded-sm bg-muted/60 ml-1" /> flat
          <span className="w-2 h-2 rounded-sm bg-rose-500/70 ml-1" /> bearish
        </div>
      </div>
      <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-1">
        {sorted.map(sec => {
          const pct = sec.avgChangePercent ?? 0;
          return (
            <div
              key={sec.sector}
              className={`rounded px-2 py-1.5 text-center transition-colors ${getBgColor(pct)} ${getTextColor(pct)}`}
              title={`${sec.sector}: ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}% | ${sec.gainers}↑ ${sec.losers}↓ | Top: ${sec.topPick?.symbol ?? "—"}`}
            >
              <div className="text-[10px] font-semibold truncate leading-tight">
                {sec.sector.replace(/_/g, " ")}
              </div>
              <div className="text-[11px] font-mono font-bold tabular-nums mt-0.5">
                {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
              </div>
              <div className="text-[9px] opacity-70 font-mono">
                {sec.gainers}↑ {sec.losers}↓
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
