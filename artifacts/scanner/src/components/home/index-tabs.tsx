import { useState, useMemo } from "react";
import {
  useGetIndicesBoard, getGetIndicesBoardQueryKey,
  useGetHomeEnrichment, getGetHomeEnrichmentQueryKey,
} from "@workspace/api-client-react";
import type { IndexBoardItem, HomeIndexEnrichment } from "@workspace/api-client-react";
import IndexExpandedPanel from "./index-expanded-panel";
import { Activity } from "lucide-react";
import { SectionSourceLabel } from "@/components/ui/section-source-label";

const INDIAN_KEYS = ["NIFTY50", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX"];

/** Format a signed percent honestly: "—" when the value is genuinely
 *  missing (null/NaN) rather than coercing it to a fake "+0.00%". */
export function formatSignedPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

/** Format a signed number honestly: "—" when genuinely missing. */
export function formatSignedNum(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
}

function Sparkline({ data, width = 80, height = 24, color }: { data: number[]; width?: number; height?: number; color: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg width={width} height={height} className="shrink-0">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function computeBiasScore(item: IndexBoardItem, enrichment?: HomeIndexEnrichment): { score: number; label: string; color: string } {
  let score = 0;
  let total = 0;

  if (item.ltp != null && item.vwap != null) {
    total++;
    if (item.ltp > item.vwap) score++;
  }

  const emas = [item.ema9, item.ema20, item.ema50, item.ema100, item.ema200].filter((v): v is number => v != null);
  if (emas.length >= 3 && item.ltp != null) {
    const aboveCount = emas.filter(e => item.ltp! >= e).length;
    total += emas.length;
    score += aboveCount;
  }

  if (item.pivot != null && item.ltp != null) {
    total++;
    if (item.ltp > item.pivot) score++;
  }

  if (enrichment?.rsi14 != null) {
    total++;
    if (enrichment.rsi14 >= 50) score++;
  }

  if (enrichment?.pcrOi != null) {
    total++;
    if (enrichment.pcrOi >= 1.0) score++;
  }

  const pct = total > 0 ? score / total : 0.5;
  const displayScore = Math.round(pct * 5);

  if (pct >= 0.8) return { score: displayScore, label: "STRONG BULL", color: "text-emerald-500 bg-emerald-500/15 border-emerald-500/30" };
  if (pct >= 0.6) return { score: displayScore, label: "BULL", color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" };
  if (pct >= 0.4) return { score: displayScore, label: "NEUTRAL", color: "text-muted-foreground bg-muted/50 border-border" };
  if (pct >= 0.2) return { score: displayScore, label: "BEAR", color: "text-rose-400 bg-rose-400/10 border-rose-400/20" };
  return { score: displayScore, label: "STRONG BEAR", color: "text-rose-500 bg-rose-500/15 border-rose-500/30" };
}

function MiniCard({
  item,
  enrichment,
  active,
  onClick,
}: {
  item: IndexBoardItem;
  enrichment?: HomeIndexEnrichment;
  active: boolean;
  onClick: () => void;
}) {
  const bias = computeBiasScore(item, enrichment);
  const changeColor = (item.change ?? 0) > 0 ? "text-emerald-500" : (item.change ?? 0) < 0 ? "text-rose-500" : "text-muted-foreground";
  const sparkColor = (item.change ?? 0) >= 0 ? "#22c55e" : "#ef4444";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 min-w-[180px] rounded-lg border px-3 py-2.5 text-left transition-all ${
        active
          ? "bg-card border-primary ring-1 ring-primary/30 shadow-sm"
          : "bg-card/50 border-border hover:border-foreground/30 hover:bg-card/80"
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-bold truncate">{item.name}</span>
        <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${bias.color}`}>
          {bias.label}
        </span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="text-lg font-mono font-bold tabular-nums leading-tight">
            {item.currency}{item.ltp?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? "—"}
          </div>
          <div className={`text-[11px] font-mono tabular-nums font-semibold ${changeColor}`}>
            {formatSignedPct(item.changePercent)}
            <span className="opacity-70 ml-1">
              ({formatSignedNum(item.change)})
            </span>
          </div>
        </div>
        {enrichment?.sparkline && enrichment.sparkline.length > 2 && (
          <Sparkline data={enrichment.sparkline} color={sparkColor} />
        )}
      </div>
    </button>
  );
}

export default function IndexTabs() {
  const [activeKey, setActiveKey] = useState("NIFTY50");

  const { data: boardData, isLoading } = useGetIndicesBoard({
    query: {
      queryKey: getGetIndicesBoardQueryKey(),
      refetchInterval: 5_000,
      staleTime: 5_000,
    },
  });

  const { data: enrichment } = useGetHomeEnrichment({
    query: {
      queryKey: getGetHomeEnrichmentQueryKey(),
      refetchInterval: 30_000,
      staleTime: 30_000,
    },
  });

  const indianIndices = useMemo(() => {
    const items = boardData?.items ?? [];
    return INDIAN_KEYS.map(k => items.find(i => i.key === k)).filter((i): i is IndexBoardItem => i != null);
  }, [boardData]);

  // Honest, row-aware source grade for the Indian-indices section: trade-grade
  // only when the broker session is live AND every displayed index is a Kite
  // tick. Aggregate "as of" is the oldest row so one fresh tick can't overstate
  // the whole section's freshness.
  const indicesRuntime = useMemo(() => {
    if (indianIndices.length === 0) return { hasData: false };
    const allKite = (boardData?.kiteAuthenticated ?? false) && indianIndices.every(i => i.source === "kite");
    let asOf: number | null = null;
    for (const i of indianIndices) {
      if (typeof i.asOf === "number" && Number.isFinite(i.asOf)) {
        asOf = asOf == null ? i.asOf : Math.min(asOf, i.asOf);
      }
    }
    return { hasData: true, fallbackUsed: !allKite, asOf: asOf ?? boardData?.lastUpdated ?? null };
  }, [indianIndices, boardData]);

  const enrichmentMap = useMemo(() => {
    const m = new Map<string, HomeIndexEnrichment>();
    for (const e of enrichment?.indices ?? []) m.set(e.key, e);
    return m;
  }, [enrichment]);

  const activeItem = indianIndices.find(i => i.key === activeKey);
  const activeEnrichment = enrichmentMap.get(activeKey);

  if (isLoading) {
    return (
      <div className="rounded-lg border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
        Loading indices...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Activity className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">Indian Indices</h2>
        <div className="flex-1 border-t border-border ml-2" />
        {boardData && (
          <SectionSourceLabel
            sectionId="home-indices"
            runtime={indicesRuntime}
            className="mr-1.5"
          />
        )}
        {boardData && (
          <span className="text-[10px] font-mono text-muted-foreground">
            {boardData.kiteAuthenticated ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500 border border-emerald-500/30">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/30">
                ~15min delayed
              </span>
            )}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        {indianIndices.map(item => (
          <MiniCard
            key={item.key}
            item={item}
            enrichment={enrichmentMap.get(item.key)}
            active={activeKey === item.key}
            onClick={() => setActiveKey(item.key)}
          />
        ))}
      </div>

      {activeItem && (
        <IndexExpandedPanel
          item={activeItem}
          enrichment={activeEnrichment}
          allIndices={indianIndices}
          enrichmentMap={enrichmentMap}
        />
      )}
    </div>
  );
}

export { Sparkline, computeBiasScore };
