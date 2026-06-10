import { useGetMarketTrend, getGetMarketTrendQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Activity } from "lucide-react";
import { DataSourceBadge, type DataSource, type FeedStatus } from "@/components/ui/data-source-badge";

/** Client mirror of the server's `15m` candle freshness budget (45 min). */
const INDEX_INTRADAY_STALE_AFTER_MS = 2_700_000;

const BIAS_STYLES: Record<string, { color: string; label: string }> = {
  STRONG_BULLISH: { color: "text-signal-strong-buy", label: "STRONG BULLISH" },
  BULLISH: { color: "text-signal-buy", label: "BULLISH" },
  NEUTRAL: { color: "text-muted-foreground", label: "NEUTRAL" },
  BEARISH: { color: "text-signal-sell", label: "BEARISH" },
  STRONG_BEARISH: { color: "text-signal-strong-sell", label: "STRONG BEARISH" },
};

export default function TrendCard() {
  const { data, isLoading } = useGetMarketTrend({
    query: { refetchInterval: 30000, queryKey: getGetMarketTrendQueryKey() },
  });

  if (isLoading) {
    return (
      <Card><CardContent className="p-4"><Skeleton className="h-24 w-full" /></CardContent></Card>
    );
  }
  if (!data) return null;
  const style = BIAS_STYLES[data.bias] ?? BIAS_STYLES.NEUTRAL!;
  const cp = data.candleProvenance;
  const cpBadge = cp
    ? (() => {
        const source: DataSource =
          cp.source === "kite" ? "kite"
            : cp.source === "yahoo" ? "yahoo"
              : cp.source === "mixed" ? "mixed"
                : "unknown";
        const staleSuffix = cp.source !== "none" && !cp.fresh ? " · stale" : "";
        const note =
          cp.source === "kite" ? `index 15m candles · Kite${staleSuffix}`
            : cp.source === "yahoo" ? `index 15m candles · Yahoo fallback${staleSuffix}`
              : cp.source === "mixed" ? `index 15m candles · ${cp.kiteCount} Kite / ${cp.yahooCount} Yahoo${staleSuffix}`
                : "no index candles — index rules skipped";
        // Honest status: no candles → down; outside the 15m freshness budget →
        // stale; fresh Kite intraday → live; fresh Yahoo fallback → delayed.
        const status: FeedStatus =
          cp.source === "none" ? "down"
            : !cp.fresh ? "stale"
              : cp.source === "kite" ? "live"
                : "delayed";
        return {
          source,
          status,
          fallbackActive: cp.source === "yahoo" || cp.source === "mixed",
          note,
          asOf: cp.asOf ?? null,
        };
      })()
    : null;

  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-mono flex items-center justify-between">
          <span className="flex items-center gap-2"><Activity className="w-4 h-4" /> OVERALL MARKET TREND</span>
          <span className={`text-xs font-mono ${style.color}`}>{style.label} · score {data.score}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">{data.headline}</p>
        {cpBadge && (
          <DataSourceBadge
            source={cpBadge.source}
            status={cpBadge.status}
            lastUpdated={cpBadge.asOf}
            fallbackActive={cpBadge.fallbackActive}
            note={cpBadge.note}
            autoStaleAfterMs={INDEX_INTRADAY_STALE_AFTER_MS}
            compact
          />
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
          <Stat label="Advancers" value={data.breadth.advancers} cls="text-signal-strong-buy" />
          <Stat label="Decliners" value={data.breadth.decliners} cls="text-signal-strong-sell" />
          <Stat label="Unchanged" value={data.breadth.unchanged ?? 0} />
          <Stat label="A/D Ratio" value={(data.breadth.advanceDeclineRatio ?? 0).toFixed(2)} />
        </div>
        {data.drivers && data.drivers.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
            {data.drivers.slice(0, 6).map((d, i) => (
              <div key={i} className="flex items-start gap-2 text-xs border border-border/40 rounded px-2 py-1.5">
                {d.bullish ? <TrendingUp className="w-3 h-3 mt-0.5 text-signal-strong-buy shrink-0" /> : <TrendingDown className="w-3 h-3 mt-0.5 text-signal-strong-sell shrink-0" />}
                <div>
                  <div className="font-semibold">{d.label}</div>
                  {d.detail && <div className="text-muted-foreground text-[11px]">{d.detail}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
        {data.sectorLeaders && data.sectorLeaders.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1 border-t border-border/40">
            <span className="text-[10px] uppercase font-mono text-muted-foreground">Leaders:</span>
            {data.sectorLeaders.map(s => (
              <span key={`l-${s.sector}`} className="text-[11px] font-mono text-signal-strong-buy">
                {s.sector} {(s.avgChangePercent ?? 0) > 0 ? "+" : ""}{(s.avgChangePercent ?? 0).toFixed(2)}%
              </span>
            ))}
            <span className="text-[10px] uppercase font-mono text-muted-foreground ml-3">Laggards:</span>
            {data.sectorLaggards?.map(s => (
              <span key={`g-${s.sector}`} className="text-[11px] font-mono text-signal-strong-sell">
                {s.sector} {(s.avgChangePercent ?? 0) > 0 ? "+" : ""}{(s.avgChangePercent ?? 0).toFixed(2)}%
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, cls }: { label: string; value: string | number; cls?: string }) {
  return (
    <div className="rounded border border-border/40 px-2 py-1.5 bg-background/40">
      <div className="text-[10px] uppercase text-muted-foreground tracking-wider">{label}</div>
      <div className={`text-sm font-bold ${cls ?? ""}`}>{value}</div>
    </div>
  );
}
