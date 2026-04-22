import {
  useGetMarketSummary,
  useListStocks,
  useGetTopScans,
  getGetMarketSummaryQueryKey,
  getListStocksQueryKey,
  getGetTopScansQueryKey,
  ListStocksSignal,
} from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SignalBadge } from "@/components/ui/signal-badge";
import { ScoreBar } from "@/components/ui/score-bar";
import { TrendingUp, TrendingDown, Clock, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useMemo, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import TrendCard from "@/components/trend-card";
import MarketMood from "@/components/market-mood";
import type { StockRow } from "@workspace/api-client-react";

type SortKey = "symbol" | "price" | "change" | "changePct" | "open" | "high" | "low" | "prev" | "vwap" | "ema20" | "ema50" | "ema100" | "ema200" | "rsi" | "yrHi" | "yrLo" | "vol" | "score";
type SortDir = "asc" | "desc";

function getSortValue(s: StockRow, key: SortKey): number | string {
  switch (key) {
    case "symbol": return s.symbol;
    case "price": return s.quote.price;
    case "change": return s.quote.change;
    case "changePct": return s.quote.changePercent;
    case "open": return s.quote.open;
    case "high": return s.quote.high;
    case "low": return s.quote.low;
    case "prev": return s.quote.previousClose;
    case "vwap": return s.indicators?.vwap ?? -Infinity;
    case "ema20": return s.indicators?.ema20 ?? -Infinity;
    case "ema50": return s.indicators?.ema50 ?? -Infinity;
    case "ema100": return s.indicators?.ema100 ?? -Infinity;
    case "ema200": return s.indicators?.ema200 ?? -Infinity;
    case "rsi": return s.indicators?.rsi14 ?? -Infinity;
    case "yrHi": return s.quote.fiftyTwoWeekHigh ?? -Infinity;
    case "yrLo": return s.quote.fiftyTwoWeekLow ?? -Infinity;
    case "vol": return s.indicators?.volumeRatio ?? -Infinity;
    case "score": return s.recommendation.score;
  }
}

function SortHead({ k, label, sort, setSort, align = "right" }: { k: SortKey; label: string; sort: { key: SortKey; dir: SortDir }; setSort: (s: { key: SortKey; dir: SortDir }) => void; align?: "left" | "right"; }) {
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.dir === "desc" ? ArrowDown : ArrowUp;
  const click = () => setSort({ key: k, dir: active && sort.dir === "desc" ? "asc" : "desc" });
  return (
    <button
      onClick={click}
      className={`inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider hover:text-foreground transition-colors ${active ? "text-foreground" : "text-muted-foreground"} ${align === "right" ? "ml-auto" : ""}`}
    >
      {label} <Icon className="w-3 h-3 opacity-70" />
    </button>
  );
}

function fmtIN(n: number) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function buildReasonsTitle(s: StockRow): string {
  const top = (s.recommendation.reasons ?? [])
    .slice()
    .sort((a: { weight: number }, b: { weight: number }) => b.weight - a.weight)
    .slice(0, 5);
  return top.map((r: { bullish: boolean; label: string; weight: number; detail: string }) =>
    `${r.bullish ? "+" : "–"} ${r.label} (w${r.weight}): ${r.detail}`
  ).join("\n");
}

export default function Dashboard() {
  const [location] = useLocation();

  // Reactive search query string from URL (works with wouter location updates)
  const initialSearch = useMemo(() => {
    const idx = location.indexOf("?");
    return idx >= 0 ? new URLSearchParams(location.slice(idx + 1)).get("search") || "" : "";
  }, [location]);

  const [sectorFilter, setSectorFilter] = useState<string>("all");
  const [signalFilter, setSignalFilter] = useState<string>("all");
  const [searchFilter, setSearchFilter] = useState<string>(initialSearch);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "score", dir: "desc" });
  const [screen, setScreen] = useState<string>("none");

  // Re-sync search when URL changes (e.g. user types in header search)
  useEffect(() => { setSearchFilter(initialSearch); }, [initialSearch]);

  const { data: marketSummary, isLoading: summaryLoading } = useGetMarketSummary({
    query: { refetchInterval: 30000, queryKey: getGetMarketSummaryQueryKey() },
  });

  const { data: topScans, isLoading: scansLoading } = useGetTopScans({
    query: { refetchInterval: 30000, queryKey: getGetTopScansQueryKey() },
  });

  const listParams = useMemo(() => {
    const p = {
      ...(sectorFilter !== "all" && { sector: sectorFilter }),
      ...(signalFilter !== "all" && { signal: signalFilter as ListStocksSignal }),
      ...(searchFilter && { search: searchFilter }),
    };
    return Object.keys(p).length === 0 ? undefined : p;
  }, [sectorFilter, signalFilter, searchFilter]);

  const { data: stocks, isLoading: stocksLoading } = useListStocks(listParams, {
    query: { refetchInterval: 30000, queryKey: getListStocksQueryKey(listParams) },
  });

  const sortedStocks = useMemo(() => {
    if (!stocks) return undefined;
    let arr = [...stocks];
    // Apply screen preset
    arr = arr.filter(s => {
      const ind = s.indicators;
      const q = s.quote;
      switch (screen) {
        case "rsiOversold": return ind?.rsi14 != null && ind.rsi14 < 30;
        case "rsiOverbought": return ind?.rsi14 != null && ind.rsi14 > 70;
        case "aboveVwap": return ind?.vwap != null && q.price > ind.vwap;
        case "belowVwap": return ind?.vwap != null && q.price < ind.vwap;
        case "volSpike": return ind?.volumeRatio != null && ind.volumeRatio > 2;
        case "near52wHigh": return q.fiftyTwoWeekHigh != null && q.price >= q.fiftyTwoWeekHigh * 0.95;
        case "near52wLow": return q.fiftyTwoWeekLow != null && q.price <= q.fiftyTwoWeekLow * 1.05;
        case "goldenCross": return ind?.ema20 != null && ind?.ema50 != null && ind?.ema200 != null && ind.ema20 > ind.ema50 && ind.ema50 > ind.ema200;
        case "deathCross": return ind?.ema20 != null && ind?.ema50 != null && ind?.ema200 != null && ind.ema20 < ind.ema50 && ind.ema50 < ind.ema200;
        default: return true;
      }
    });
    arr.sort((a, b) => {
      const av = getSortValue(a, sort.key);
      const bv = getSortValue(b, sort.key);
      let cmp = 0;
      if (typeof av === "string" && typeof bv === "string") cmp = av.localeCompare(bv);
      else cmp = (av as number) - (bv as number);
      return sort.dir === "desc" ? -cmp : cmp;
    });
    return arr;
  }, [stocks, sort, screen]);

  const formatPct = (p: number) => `${p > 0 ? '+' : ''}${p.toFixed(2)}%`;
  const fmt = (n: number | undefined | null, dp = 2) => n == null ? "—" : n.toFixed(dp);

  return (
    <div className="w-full max-w-none px-4 py-6 space-y-6">
      {/* Indian Indices */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {summaryLoading ? (
          Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-[88px] w-full" />)
        ) : marketSummary?.indices?.map(idx => {
          const up = idx.change >= 0;
          return (
            <Card key={idx.symbol} className="bg-card border-border hover:border-foreground/20 transition-colors">
              <CardContent className="p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono font-medium text-muted-foreground uppercase tracking-wider">{idx.name}</span>
                  <span className={`text-[10px] font-mono ${up ? 'text-signal-strong-buy' : 'text-signal-strong-sell'}`}>
                    {up ? <TrendingUp className="inline w-3 h-3" /> : <TrendingDown className="inline w-3 h-3" />}
                  </span>
                </div>
                <div className="font-bold font-mono text-base tabular-nums">{fmtIN(idx.price)}</div>
                <div className={`font-mono text-xs tabular-nums ${up ? 'text-signal-strong-buy' : 'text-signal-strong-sell'}`}>
                  {up ? "+" : ""}{fmtIN(idx.change)} ({formatPct(idx.changePercent)})
                </div>
                {(idx.high != null || idx.low != null || idx.open != null) && (
                  <div className="text-[9px] font-mono text-muted-foreground/80 pt-0.5 border-t border-border/40 grid grid-cols-3 gap-1 tabular-nums">
                    <span title="Open">O {idx.open != null ? fmtIN(idx.open) : "—"}</span>
                    <span title="High" className="text-signal-strong-buy/70">H {idx.high != null ? fmtIN(idx.high) : "—"}</span>
                    <span title="Low" className="text-signal-strong-sell/70">L {idx.low != null ? fmtIN(idx.low) : "—"}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {marketSummary && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
          <Clock className="w-3.5 h-3.5" />
          <span>Updated {formatDistanceToNow(new Date(marketSummary.lastUpdated))} ago</span>
          <span className="ml-2 px-1.5 py-0.5 bg-secondary/40 rounded text-[10px] uppercase border border-border">
            {marketSummary.marketStatus || 'UNKNOWN'}
          </span>
          <span className="text-muted-foreground/60">· auto-refresh 30s</span>
        </div>
      )}

      {/* Trend + Mood */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2"><TrendCard /></div>
        <MarketMood />
      </div>

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
                  <Link key={stock.symbol} href={`/stock/${stock.symbol}`} className="flex items-center justify-between p-2 rounded hover:bg-white/5 cursor-pointer border border-transparent hover:border-border" title={buildReasonsTitle(stock)}>
                    <div>
                      <div className="font-bold font-mono text-sm">{stock.symbol}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-[180px]">{stock.name}</div>
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
            <CardTitle className="text-sm font-mono flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-signal-strong-sell" /> TOP BEARISH SETUPS
            </CardTitle>
          </CardHeader>
          <CardContent>
            {scansLoading ? <Skeleton className="h-32 w-full" /> : (
              <div className="space-y-2">
                {topScans?.topSells?.slice(0, 5).map(stock => (
                  <Link key={stock.symbol} href={`/stock/${stock.symbol}`} className="flex items-center justify-between p-2 rounded hover:bg-white/5 cursor-pointer border border-transparent hover:border-border" title={buildReasonsTitle(stock)}>
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
            <div>
              <CardTitle className="text-lg font-mono">FULL SCANNER · {sortedStocks?.length ?? 0} stocks</CardTitle>
              <p className="text-[11px] text-muted-foreground mt-1">Hover any row for the top reasons behind its signal · click headers to sort · pick a screen to narrow</p>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {[
                  { id: "none", label: "All" },
                  { id: "rsiOversold", label: "RSI < 30" },
                  { id: "rsiOverbought", label: "RSI > 70" },
                  { id: "aboveVwap", label: "Above VWAP" },
                  { id: "belowVwap", label: "Below VWAP" },
                  { id: "volSpike", label: "Vol > 2x" },
                  { id: "near52wHigh", label: "Near 52W High" },
                  { id: "near52wLow", label: "Near 52W Low" },
                  { id: "goldenCross", label: "Golden Stack" },
                  { id: "deathCross", label: "Death Stack" },
                ].map(p => (
                  <button
                    key={p.id}
                    onClick={() => setScreen(p.id)}
                    className={`text-[10px] font-mono px-2 py-1 rounded border transition-colors ${screen === p.id ? "bg-primary/15 border-primary/60 text-primary" : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Input
                placeholder="Filter symbol/name..."
                className="w-[160px] font-mono text-sm h-8 bg-background"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
              />
              <Select value={sectorFilter} onValueChange={setSectorFilter}>
                <SelectTrigger className="w-[160px] h-8 bg-background"><SelectValue placeholder="Sector" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sectors</SelectItem>
                  <SelectItem value="Banking">Banking</SelectItem>
                  <SelectItem value="Financials">Financials</SelectItem>
                  <SelectItem value="IT">IT</SelectItem>
                  <SelectItem value="Auto">Auto</SelectItem>
                  <SelectItem value="Pharma">Pharma</SelectItem>
                  <SelectItem value="FMCG">FMCG</SelectItem>
                  <SelectItem value="Energy">Energy</SelectItem>
                  <SelectItem value="Metals">Metals</SelectItem>
                  <SelectItem value="Cement">Cement</SelectItem>
                  <SelectItem value="Capital Goods">Capital Goods</SelectItem>
                  <SelectItem value="Defence">Defence</SelectItem>
                  <SelectItem value="Construction">Construction</SelectItem>
                  <SelectItem value="Real Estate">Real Estate</SelectItem>
                  <SelectItem value="Telecom">Telecom</SelectItem>
                  <SelectItem value="Logistics">Logistics</SelectItem>
                  <SelectItem value="Aviation">Aviation</SelectItem>
                  <SelectItem value="Chemicals">Chemicals</SelectItem>
                  <SelectItem value="Consumer Discretionary">Consumer Disc.</SelectItem>
                  <SelectItem value="Media">Media</SelectItem>
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
                  <TableHead className="font-mono text-[10px] sticky left-0 bg-card z-10"><SortHead k="symbol" label="SYMBOL" sort={sort} setSort={setSort} align="left" /></TableHead>
                  <TableHead className="text-right"><SortHead k="price" label="CMP" sort={sort} setSort={setSort} /></TableHead>
                  <TableHead className="text-right"><SortHead k="change" label="CHG" sort={sort} setSort={setSort} /></TableHead>
                  <TableHead className="text-right"><SortHead k="changePct" label="%CHG" sort={sort} setSort={setSort} /></TableHead>
                  <TableHead className="text-right"><SortHead k="open" label="OPEN" sort={sort} setSort={setSort} /></TableHead>
                  <TableHead className="text-right"><SortHead k="high" label="HIGH" sort={sort} setSort={setSort} /></TableHead>
                  <TableHead className="text-right"><SortHead k="low" label="LOW" sort={sort} setSort={setSort} /></TableHead>
                  <TableHead className="text-right"><SortHead k="prev" label="PREV" sort={sort} setSort={setSort} /></TableHead>
                  <TableHead className="text-right"><SortHead k="vwap" label="VWAP" sort={sort} setSort={setSort} /></TableHead>
                  <TableHead className="text-right"><SortHead k="ema20" label="EMA20" sort={sort} setSort={setSort} /></TableHead>
                  <TableHead className="text-right"><SortHead k="ema50" label="EMA50" sort={sort} setSort={setSort} /></TableHead>
                  <TableHead className="text-right"><SortHead k="ema100" label="EMA100" sort={sort} setSort={setSort} /></TableHead>
                  <TableHead className="text-right"><SortHead k="ema200" label="EMA200" sort={sort} setSort={setSort} /></TableHead>
                  <TableHead className="text-right"><SortHead k="rsi" label="RSI" sort={sort} setSort={setSort} /></TableHead>
                  <TableHead className="text-right"><SortHead k="yrHi" label="52W H" sort={sort} setSort={setSort} /></TableHead>
                  <TableHead className="text-right"><SortHead k="yrLo" label="52W L" sort={sort} setSort={setSort} /></TableHead>
                  <TableHead className="text-right"><SortHead k="vol" label="VOL×" sort={sort} setSort={setSort} /></TableHead>
                  <TableHead className="w-[120px]"><SortHead k="score" label="SCORE" sort={sort} setSort={setSort} align="left" /></TableHead>
                  <TableHead className="font-mono text-[10px] text-right">SIGNAL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stocksLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={19} className="h-10"><Skeleton className="h-4 w-full" /></TableCell>
                    </TableRow>
                  ))
                ) : sortedStocks?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={19} className="h-24 text-center text-muted-foreground font-mono text-sm">
                      NO MATCHING STOCKS FOUND
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedStocks?.map(stock => {
                    const q = stock.quote;
                    const ind = stock.indicators;
                    const chgClass = q.changePercent >= 0 ? 'text-signal-strong-buy' : 'text-signal-strong-sell';
                    const cmpVsVwap = ind?.vwap != null ? (q.price >= ind.vwap ? 'text-signal-strong-buy' : 'text-signal-strong-sell') : '';
                    return (
                      <TableRow key={stock.symbol} className="hover:bg-white/5 border-border/50 group" title={buildReasonsTitle(stock)}>
                        <TableCell className="sticky left-0 bg-card group-hover:bg-card z-10 py-1.5">
                          <Link href={`/stock/${stock.symbol}`} className="font-mono font-bold hover:underline text-sm">
                            {stock.symbol}
                          </Link>
                          <div className="text-[10px] text-muted-foreground truncate max-w-[140px]">{stock.sector}</div>
                        </TableCell>
                        <TableCell className={`text-right font-mono text-sm font-bold tabular-nums ${cmpVsVwap}`}>{fmt(q.price)}</TableCell>
                        <TableCell className={`text-right font-mono text-xs tabular-nums ${chgClass}`}>{q.change >= 0 ? "+" : ""}{fmt(q.change)}</TableCell>
                        <TableCell className={`text-right font-mono text-xs font-medium tabular-nums ${chgClass}`}>{formatPct(q.changePercent)}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(q.open)}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(q.high)}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(q.low)}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground tabular-nums">{fmt(q.previousClose)}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(ind?.vwap)}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(ind?.ema20)}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(ind?.ema50)}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(ind?.ema100)}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(ind?.ema200)}</TableCell>
                        <TableCell className={`text-right font-mono text-xs tabular-nums ${ind?.rsi14 != null && ind.rsi14 > 70 ? 'text-signal-strong-sell' : ind?.rsi14 != null && ind.rsi14 < 30 ? 'text-signal-strong-buy' : ''}`}>{fmt(ind?.rsi14, 1)}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground tabular-nums">{fmt(q.fiftyTwoWeekHigh)}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground tabular-nums">{fmt(q.fiftyTwoWeekLow)}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{ind?.volumeRatio != null ? `${ind.volumeRatio.toFixed(1)}x` : '—'}</TableCell>
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
