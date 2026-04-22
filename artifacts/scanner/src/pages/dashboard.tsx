import {
  useGetMarketSummary,
  useListStocks,
  useGetTopScans,
  getGetMarketSummaryQueryKey,
  getListStocksQueryKey,
  getGetTopScansQueryKey,
  ListStocksSignal,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SignalBadge } from "@/components/ui/signal-badge";
import { ScoreBar } from "@/components/ui/score-bar";
import { TrendingUp, TrendingDown, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import TrendCard from "@/components/trend-card";

export default function Dashboard() {
  const urlParams = new URLSearchParams(window.location.search);
  const initialSearch = urlParams.get('search') || "";

  const [sectorFilter, setSectorFilter] = useState<string>("all");
  const [signalFilter, setSignalFilter] = useState<string>("all");
  const [searchFilter, setSearchFilter] = useState<string>(initialSearch);

  const { data: marketSummary, isLoading: summaryLoading } = useGetMarketSummary({
    query: { refetchInterval: 30000, queryKey: getGetMarketSummaryQueryKey() },
  });

  const { data: topScans, isLoading: scansLoading } = useGetTopScans({
    query: { refetchInterval: 30000, queryKey: getGetTopScansQueryKey() },
  });

  const listParams = useMemo(() => ({
    ...(sectorFilter !== "all" && { sector: sectorFilter }),
    ...(signalFilter !== "all" && { signal: signalFilter as ListStocksSignal }),
    ...(searchFilter && { search: searchFilter }),
  }), [sectorFilter, signalFilter, searchFilter]);

  const { data: stocks, isLoading: stocksLoading } = useListStocks(listParams, {
    query: { refetchInterval: 30000, queryKey: getListStocksQueryKey(listParams) },
  });

  const formatPct = (p: number) => `${p > 0 ? '+' : ''}${p.toFixed(2)}%`;
  const fmt = (n: number | undefined | null, dp = 2) => n == null ? "—" : n.toFixed(dp);

  return (
    <div className="container max-w-screen-2xl py-6 space-y-6">
      {/* Indian Indices */}
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex flex-wrap gap-3">
          {summaryLoading ? (
            <>
              <Skeleton className="h-14 w-40" />
              <Skeleton className="h-14 w-40" />
              <Skeleton className="h-14 w-40" />
            </>
          ) : marketSummary?.indices?.map(idx => (
            <Card key={idx.symbol} className="bg-card border-border min-w-[150px]">
              <CardContent className="p-3 flex flex-col justify-center">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{idx.name}</span>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-base font-bold font-mono">{idx.price.toFixed(2)}</span>
                  <span className={`text-xs font-mono font-medium ${idx.change >= 0 ? 'text-signal-strong-buy' : 'text-signal-strong-sell'}`}>
                    {idx.change >= 0 ? <TrendingUp className="inline w-3 h-3 mr-0.5" /> : <TrendingDown className="inline w-3 h-3 mr-0.5" />}
                    {formatPct(idx.changePercent)}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        {marketSummary && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono bg-secondary/50 px-3 py-1.5 rounded-full border border-border">
            <Clock className="w-3.5 h-3.5" />
            <span>Updated {formatDistanceToNow(new Date(marketSummary.lastUpdated))} ago</span>
            <span className="ml-2 px-1.5 py-0.5 bg-background rounded text-[10px] uppercase border border-border">
              {marketSummary.marketStatus || 'UNKNOWN'}
            </span>
          </div>
        )}
      </div>

      {/* Overall Market Trend */}
      <TrendCard />

      {/* Top Ideas */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-signal-strong-buy/20 bg-gradient-to-b from-signal-strong-buy/5 to-transparent">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-signal-strong-buy" /> TOP BULLISH SETUPS
            </CardTitle>
          </CardHeader>
          <CardContent>
            {scansLoading ? <Skeleton className="h-32 w-full" /> : (
              <div className="space-y-2">
                {topScans?.topBuys?.slice(0, 5).map(stock => (
                  <Link key={stock.symbol} href={`/stock/${stock.symbol}`} className="flex items-center justify-between p-2 rounded hover:bg-white/5 cursor-pointer border border-transparent hover:border-border">
                    <div>
                      <div className="font-bold font-mono text-sm">{stock.symbol}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-[180px]">{stock.name}</div>
                    </div>
                    <div className="text-right">
                      <SignalBadge signal={stock.recommendation.signal} />
                      <div className="text-xs font-mono mt-1 text-signal-strong-buy">{stock.recommendation.score}/100 · RR {stock.recommendation.riskRewardRatio ?? "—"}</div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-signal-strong-sell/20 bg-gradient-to-b from-signal-strong-sell/5 to-transparent">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-signal-strong-sell" /> TOP BEARISH SETUPS
            </CardTitle>
          </CardHeader>
          <CardContent>
            {scansLoading ? <Skeleton className="h-32 w-full" /> : (
              <div className="space-y-2">
                {topScans?.topSells?.slice(0, 5).map(stock => (
                  <Link key={stock.symbol} href={`/stock/${stock.symbol}`} className="flex items-center justify-between p-2 rounded hover:bg-white/5 cursor-pointer border border-transparent hover:border-border">
                    <div>
                      <div className="font-bold font-mono text-sm">{stock.symbol}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-[180px]">{stock.name}</div>
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

      {/* Scanner Table */}
      <Card>
        <CardHeader className="border-b border-border pb-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <CardTitle className="text-lg font-mono">FULL SCANNER · {stocks?.length ?? 0} stocks</CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <Input
                placeholder="Search symbol..."
                className="w-[150px] font-mono text-sm h-8 bg-background"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
              />
              <Select value={sectorFilter} onValueChange={setSectorFilter}>
                <SelectTrigger className="w-[160px] h-8 bg-background"><SelectValue placeholder="Sector" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sectors</SelectItem>
                  <SelectItem value="Financial Services">Financials</SelectItem>
                  <SelectItem value="Information Technology">IT</SelectItem>
                  <SelectItem value="Automobile and Auto Components">Automobiles</SelectItem>
                  <SelectItem value="Fast Moving Consumer Goods">FMCG</SelectItem>
                </SelectContent>
              </Select>
              <Select value={signalFilter} onValueChange={setSignalFilter}>
                <SelectTrigger className="w-[150px] h-8 bg-background"><SelectValue placeholder="Signal" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Signals</SelectItem>
                  <SelectItem value="STRONG_BUY">Strong Buy</SelectItem>
                  <SelectItem value="BUY">Buy</SelectItem>
                  <SelectItem value="NEUTRAL">Neutral</SelectItem>
                  <SelectItem value="SELL">Sell</SelectItem>
                  <SelectItem value="STRONG_SELL">Strong Sell</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border">
                  <TableHead className="font-mono text-[10px] sticky left-0 bg-card z-10">SYMBOL</TableHead>
                  <TableHead className="font-mono text-[10px] text-right">CMP</TableHead>
                  <TableHead className="font-mono text-[10px] text-right">CHG</TableHead>
                  <TableHead className="font-mono text-[10px] text-right">%CHG</TableHead>
                  <TableHead className="font-mono text-[10px] text-right">OPEN</TableHead>
                  <TableHead className="font-mono text-[10px] text-right">HIGH</TableHead>
                  <TableHead className="font-mono text-[10px] text-right">LOW</TableHead>
                  <TableHead className="font-mono text-[10px] text-right">PREV</TableHead>
                  <TableHead className="font-mono text-[10px] text-right">VWAP</TableHead>
                  <TableHead className="font-mono text-[10px] text-right">EMA20</TableHead>
                  <TableHead className="font-mono text-[10px] text-right">EMA50</TableHead>
                  <TableHead className="font-mono text-[10px] text-right">EMA100</TableHead>
                  <TableHead className="font-mono text-[10px] text-right">EMA200</TableHead>
                  <TableHead className="font-mono text-[10px] text-right">RSI</TableHead>
                  <TableHead className="font-mono text-[10px] text-right">52W H</TableHead>
                  <TableHead className="font-mono text-[10px] text-right">52W L</TableHead>
                  <TableHead className="font-mono text-[10px] text-right">VOL×</TableHead>
                  <TableHead className="font-mono text-[10px] w-[110px]">SCORE</TableHead>
                  <TableHead className="font-mono text-[10px] text-right">SIGNAL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stocksLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={19} className="h-10"><Skeleton className="h-4 w-full" /></TableCell>
                    </TableRow>
                  ))
                ) : stocks?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={19} className="h-24 text-center text-muted-foreground font-mono text-sm">
                      NO MATCHING STOCKS FOUND
                    </TableCell>
                  </TableRow>
                ) : (
                  stocks?.map(stock => {
                    const q = stock.quote;
                    const ind = stock.indicators;
                    const chgClass = q.changePercent >= 0 ? 'text-signal-strong-buy' : 'text-signal-strong-sell';
                    const cmpVsVwap = ind?.vwap != null ? (q.price >= ind.vwap ? 'text-signal-strong-buy' : 'text-signal-strong-sell') : '';
                    return (
                      <TableRow key={stock.symbol} className="hover:bg-white/5 border-border/50 group">
                        <TableCell className="sticky left-0 bg-card group-hover:bg-card z-10 py-1.5">
                          <Link href={`/stock/${stock.symbol}`} className="font-mono font-bold hover:underline text-sm">
                            {stock.symbol}
                          </Link>
                          <div className="text-[10px] text-muted-foreground truncate max-w-[140px]">{stock.sector}</div>
                        </TableCell>
                        <TableCell className={`text-right font-mono text-sm font-bold ${cmpVsVwap}`}>{fmt(q.price)}</TableCell>
                        <TableCell className={`text-right font-mono text-xs ${chgClass}`}>{q.change >= 0 ? "+" : ""}{fmt(q.change)}</TableCell>
                        <TableCell className={`text-right font-mono text-xs font-medium ${chgClass}`}>{formatPct(q.changePercent)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{fmt(q.open)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{fmt(q.high)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{fmt(q.low)}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground">{fmt(q.previousClose)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{fmt(ind?.vwap)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{fmt(ind?.ema20)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{fmt(ind?.ema50)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{fmt(ind?.ema100)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{fmt(ind?.ema200)}</TableCell>
                        <TableCell className={`text-right font-mono text-xs ${ind?.rsi14 != null && ind.rsi14 > 70 ? 'text-signal-strong-sell' : ind?.rsi14 != null && ind.rsi14 < 30 ? 'text-signal-strong-buy' : ''}`}>{fmt(ind?.rsi14, 1)}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground">{fmt(q.fiftyTwoWeekHigh)}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground">{fmt(q.fiftyTwoWeekLow)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{ind?.volumeRatio != null ? `${ind.volumeRatio.toFixed(1)}x` : '—'}</TableCell>
                        <TableCell className="align-middle"><ScoreBar score={stock.recommendation.score} /></TableCell>
                        <TableCell className="text-right"><SignalBadge signal={stock.recommendation.signal} /></TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
