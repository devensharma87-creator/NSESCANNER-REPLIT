import {
  useGetMarketSummary,
  useGetTopScans,
  getGetMarketSummaryQueryKey,
  getGetTopScansQueryKey,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SignalBadge } from "@/components/ui/signal-badge";
import { TrendingUp, TrendingDown, Clock, ArrowRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import TrendCard from "@/components/trend-card";
import MarketMoodGauge from "@/components/mmi-gauge";
import type { StockRow } from "@workspace/api-client-react";

function fmtIN(n: number) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function buildReasonsTitle(s: StockRow): string {
  const top = (s.recommendation.reasons ?? [])
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);
  return top.map(r =>
    `${r.bullish ? "+" : "–"} ${r.label} (w${r.weight}): ${r.detail}`
  ).join("\n");
}

export default function Dashboard() {
  const { data: marketSummary, isLoading: summaryLoading } = useGetMarketSummary({
    query: { refetchInterval: 30000, queryKey: getGetMarketSummaryQueryKey() },
  });

  const { data: topScans, isLoading: scansLoading } = useGetTopScans({
    query: { refetchInterval: 30000, queryKey: getGetTopScansQueryKey() },
  });

  const formatPct = (p: number) => `${p > 0 ? '+' : ''}${p.toFixed(2)}%`;

  return (
    <div className="w-full max-w-none px-4 py-6 space-y-6">
      {/* Indian Indices — clickable, with per-index breadth */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {summaryLoading ? (
          Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-[120px] w-full" />)
        ) : marketSummary?.indices?.map(idx => {
          const up = idx.change >= 0;
          const slug = (idx as unknown as { constituentSlug?: string }).constituentSlug;
          const breadth = (idx as unknown as { breadth?: { advancers: number; decliners: number; unchanged: number; adRatio: number | null } }).breadth;
          const totalB = breadth ? breadth.advancers + breadth.decliners + breadth.unchanged : 0;
          const advPct = totalB > 0 ? (breadth!.advancers / totalB) * 100 : 0;
          const decPct = totalB > 0 ? (breadth!.decliners / totalB) * 100 : 0;
          const uncPct = totalB > 0 ? (breadth!.unchanged / totalB) * 100 : 0;
          const inner = (
            <Card className="bg-card border-border hover:border-foreground/30 transition-colors h-full">
              <CardContent className="p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono font-semibold text-muted-foreground uppercase tracking-wider">{idx.name}</span>
                  <span className={`text-[10px] font-mono ${up ? 'text-signal-strong-buy' : 'text-signal-strong-sell'}`}>
                    {up ? <TrendingUp className="inline w-3.5 h-3.5" /> : <TrendingDown className="inline w-3.5 h-3.5" />}
                  </span>
                </div>
                <div className="font-bold font-mono text-lg tabular-nums">{fmtIN(idx.price)}</div>
                <div className={`font-mono text-xs tabular-nums font-semibold ${up ? 'text-signal-strong-buy' : 'text-signal-strong-sell'}`}>
                  {up ? "+" : ""}{fmtIN(idx.change)} ({formatPct(idx.changePercent)})
                </div>
                {(idx.high != null || idx.low != null || idx.open != null) && (
                  <div className="text-[10px] font-mono text-muted-foreground/80 grid grid-cols-3 gap-1 tabular-nums">
                    <span title="Open">O {idx.open != null ? fmtIN(idx.open) : "—"}</span>
                    <span title="High" className="text-signal-strong-buy/80">H {idx.high != null ? fmtIN(idx.high) : "—"}</span>
                    <span title="Low" className="text-signal-strong-sell/80">L {idx.low != null ? fmtIN(idx.low) : "—"}</span>
                  </div>
                )}
                {breadth && (
                  <div className="pt-1 border-t border-border/40 space-y-1">
                    <div className="flex h-1.5 rounded-sm overflow-hidden bg-muted">
                      <div className="bg-signal-strong-buy" style={{ width: `${advPct}%` }} />
                      <div className="bg-muted-foreground/40" style={{ width: `${uncPct}%` }} />
                      <div className="bg-signal-strong-sell" style={{ width: `${decPct}%` }} />
                    </div>
                    <div className="flex justify-between text-[10px] font-mono">
                      <span className="text-signal-strong-buy">▲{breadth.advancers}</span>
                      <span className="text-muted-foreground">A/D {breadth.adRatio == null ? "∞" : breadth.adRatio.toFixed(2)}</span>
                      <span className="text-signal-strong-sell">▼{breadth.decliners}</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
          return slug ? (
            <Link key={idx.symbol} href={`/index/${slug}`} className="block">{inner}</Link>
          ) : (
            <div key={idx.symbol}>{inner}</div>
          );
        })}
      </div>

      {marketSummary && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
          <Clock className="w-3.5 h-3.5" />
          <span>Updated {formatDistanceToNow(new Date(marketSummary.lastUpdated))} ago</span>
          <span className="ml-2 px-2 py-0.5 bg-secondary/40 rounded text-[11px] uppercase border border-border font-semibold">
            {marketSummary.marketStatus || 'UNKNOWN'}
          </span>
          <span className="text-muted-foreground/60">· auto-refresh 30s</span>
          <Link href="/scanner" className="ml-auto inline-flex items-center gap-1 text-foreground hover:underline font-semibold">
            Open full scanner <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}

      {/* Trend + Mood */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2"><TrendCard /></div>
        <MarketMoodGauge />
      </div>

      {/* Top Ideas */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-signal-strong-buy/20 bg-gradient-to-b from-signal-strong-buy/5 to-transparent">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-mono flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-signal-strong-buy" /> TOP BULLISH SETUPS
            </CardTitle>
          </CardHeader>
          <CardContent>
            {scansLoading ? <Skeleton className="h-32 w-full" /> : (
              <div className="space-y-2">
                {topScans?.topBuys?.slice(0, 8).map(stock => (
                  <Link key={stock.symbol} href={`/stock/${stock.symbol}`} className="flex items-center justify-between p-2.5 rounded hover:bg-white/5 cursor-pointer border border-transparent hover:border-border" title={buildReasonsTitle(stock)}>
                    <div>
                      <div className="font-bold font-mono text-sm">{stock.symbol}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-[200px]">{stock.name}</div>
                    </div>
                    <div className="text-right">
                      <SignalBadge signal={stock.recommendation.signal} />
                      <div className="text-xs font-mono mt-1 text-signal-strong-buy">+{stock.recommendation.score}/100 · RR {stock.recommendation.riskRewardRatio ?? "—"}</div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-signal-strong-sell/20 bg-gradient-to-b from-signal-strong-sell/5 to-transparent">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-mono flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-signal-strong-sell" /> TOP BEARISH SETUPS
            </CardTitle>
          </CardHeader>
          <CardContent>
            {scansLoading ? <Skeleton className="h-32 w-full" /> : (
              <div className="space-y-2">
                {topScans?.topSells?.slice(0, 8).map(stock => (
                  <Link key={stock.symbol} href={`/stock/${stock.symbol}`} className="flex items-center justify-between p-2.5 rounded hover:bg-white/5 cursor-pointer border border-transparent hover:border-border" title={buildReasonsTitle(stock)}>
                    <div>
                      <div className="font-bold font-mono text-sm">{stock.symbol}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-[200px]">{stock.name}</div>
                    </div>
                    <div className="text-right">
                      <SignalBadge signal={stock.recommendation.signal} />
                      <div className="text-xs font-mono mt-1 text-signal-strong-sell">{stock.recommendation.score}/100 · RR {stock.recommendation.riskRewardRatio ?? "—"}</div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="text-center pt-2">
        <Link href="/scanner" className="inline-flex items-center gap-2 text-sm font-mono font-semibold text-primary hover:underline">
          Browse the full scanner with all {topScans ? '~280' : ''} stocks · sortable & filterable <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
