import {
  useGetTopScans,
  useListStocks,
  getGetTopScansQueryKey,
  getListStocksQueryKey,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SignalBadge } from "@/components/ui/signal-badge";
import { TrendingUp, TrendingDown, ArrowRight, Flame, Snowflake } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import TrendCard from "@/components/trend-card";
import MarketMoodGauge from "@/components/mmi-gauge";
import MarketsTabs from "@/components/markets-tabs";
import KeyIndicesCards from "@/components/key-indices-cards";
import { useMemo } from "react";
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

function MoverRow({ s, kind }: { s: StockRow; kind: "gain" | "loss" }) {
  const tone = kind === "gain" ? "text-signal-strong-buy" : "text-signal-strong-sell";
  return (
    <Link
      href={`/stock/${s.symbol}`}
      className="grid grid-cols-[1fr_auto_auto] items-center gap-3 p-2.5 rounded hover-row cursor-pointer border border-transparent hover:border-border"
    >
      <div className="min-w-0">
        <div className="font-bold font-mono text-sm truncate">{s.symbol}</div>
        <div className="text-[11px] text-muted-foreground truncate">{s.name}</div>
      </div>
      <div className="text-right font-mono tabular-nums">
        <div className="text-sm font-semibold">{fmtIN(s.quote.price)}</div>
        <div className={`text-[11px] ${tone}`}>
          {s.quote.change > 0 ? "+" : ""}{fmtIN(s.quote.change)}
        </div>
      </div>
      <div className={`text-right font-mono tabular-nums font-bold text-sm ${tone}`}>
        {s.quote.changePercent > 0 ? "+" : ""}{s.quote.changePercent.toFixed(2)}%
      </div>
    </Link>
  );
}

export default function Dashboard() {
  const { data: topScans, isLoading: scansLoading } = useGetTopScans({
    query: { refetchInterval: 30000, queryKey: getGetTopScansQueryKey() },
  });
  const { data: allStocks, isLoading: stocksLoading } = useListStocks(undefined, {
    query: { refetchInterval: 30000, queryKey: getListStocksQueryKey() },
  });

  const { topGainers, topLosers, universeCount } = useMemo(() => {
    const list = (allStocks ?? []).filter(s => Number.isFinite(s.quote.changePercent));
    const sortedDesc = list.slice().sort((a, b) => b.quote.changePercent - a.quote.changePercent);
    const sortedAsc = list.slice().sort((a, b) => a.quote.changePercent - b.quote.changePercent);
    return {
      topGainers: sortedDesc.slice(0, 10),
      topLosers: sortedAsc.slice(0, 10),
      universeCount: list.length,
    };
  }, [allStocks]);

  return (
    <div className="w-full max-w-none px-4 py-6 space-y-6">
      {/* Key Indices — Nifty50, BankNifty, Sensex, FinNifty (live) */}
      <KeyIndicesCards />

      {/* Trend + Mood */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2"><TrendCard /></div>
        <MarketMoodGauge />
      </div>

      {/* Top Gainers / Losers (intraday, by % change) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-signal-strong-buy/20 bg-gradient-to-b from-signal-strong-buy/5 to-transparent">
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-base font-mono flex items-center gap-2">
              <Flame className="w-5 h-5 text-signal-strong-buy" /> TOP GAINERS — TODAY
            </CardTitle>
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              by % · full Nifty universe ({universeCount})
            </span>
          </CardHeader>
          <CardContent>
            {stocksLoading ? <Skeleton className="h-72 w-full" /> : topGainers.length === 0 ? (
              <p className="text-xs text-muted-foreground font-mono">No data yet.</p>
            ) : (
              <div className="space-y-1">
                {topGainers.map(s => <MoverRow key={s.symbol} s={s} kind="gain" />)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-signal-strong-sell/20 bg-gradient-to-b from-signal-strong-sell/5 to-transparent">
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-base font-mono flex items-center gap-2">
              <Snowflake className="w-5 h-5 text-signal-strong-sell" /> TOP LOSERS — TODAY
            </CardTitle>
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              by % · full Nifty universe ({universeCount})
            </span>
          </CardHeader>
          <CardContent>
            {stocksLoading ? <Skeleton className="h-72 w-full" /> : topLosers.length === 0 ? (
              <p className="text-xs text-muted-foreground font-mono">No data yet.</p>
            ) : (
              <div className="space-y-1">
                {topLosers.map(s => <MoverRow key={s.symbol} s={s} kind="loss" />)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Global Markets — tabbed by region (Google-Finance-style) */}
      <MarketsTabs />

      {/* Top Setups */}
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
                  <Link key={stock.symbol} href={`/stock/${stock.symbol}`} className="flex items-center justify-between p-2.5 rounded hover-row cursor-pointer border border-transparent hover:border-border" title={buildReasonsTitle(stock)}>
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
                  <Link key={stock.symbol} href={`/stock/${stock.symbol}`} className="flex items-center justify-between p-2.5 rounded hover-row cursor-pointer border border-transparent hover:border-border" title={buildReasonsTitle(stock)}>
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
