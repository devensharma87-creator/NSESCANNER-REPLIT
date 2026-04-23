import { useState, useMemo } from "react";
import { useGetWatchlist, getGetWatchlistQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Minus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

type WatchlistKey =
  | "SENSEX"
  | "BANKNIFTY"
  | "NIFTY50"
  | "NIFTY100"
  | "NIFTYMIDCAP100"
  | "NIFTYSMALLCAP100"
  | "NIFTY500";

const TABS: Array<{ key: WatchlistKey; label: string; sub: string }> = [
  { key: "SENSEX",           label: "Sensex 30",         sub: "BSE 30 — bellwether large-caps" },
  { key: "BANKNIFTY",        label: "Bank Nifty",        sub: "12 most liquid Indian banks" },
  { key: "NIFTY50",          label: "Nifty 50",          sub: "Top 50 by free-float mcap" },
  { key: "NIFTY100",         label: "Nifty 100",         sub: "Nifty 50 + Next 50 — large-caps" },
  { key: "NIFTYMIDCAP100",   label: "Nifty Midcap 100",  sub: "101–250 by full market cap" },
  { key: "NIFTYSMALLCAP100", label: "Nifty Smallcap 100",sub: "251–500 by full market cap" },
  { key: "NIFTY500",         label: "Nifty 500",         sub: "Broad market — ~96% of mcap" },
];

function trendBadge(t: string) {
  const map: Record<string, string> = {
    "Very Bullish": "text-signal-strong-buy bg-signal-strong-buy/10 border-signal-strong-buy/30",
    "Bullish":      "text-signal-buy bg-signal-buy/10 border-signal-buy/30",
    "Neutral":      "text-muted-foreground bg-muted/40 border-border",
    "Bearish":      "text-signal-sell bg-signal-sell/10 border-signal-sell/30",
    "Very Bearish": "text-signal-strong-sell bg-signal-strong-sell/10 border-signal-strong-sell/30",
  };
  const Icon = t.includes("Bullish") ? TrendingUp : t.includes("Bearish") ? TrendingDown : Minus;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${map[t] ?? map.Neutral}`}>
      <Icon className="h-3 w-3" />
      {t}
    </span>
  );
}

function formatVolume(v: number): string {
  if (v >= 1e7) return `${(v / 1e7).toFixed(2)}Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(2)}L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(v);
}

export default function Watchlist() {
  const [tab, setTab] = useState<WatchlistKey>("SENSEX");
  const [filter, setFilter] = useState("");
  const [trendFilter, setTrendFilter] = useState<"ALL" | "BULL" | "BEAR">("ALL");

  const { data, isLoading, isError, error } = useGetWatchlist(tab, {
    query: { staleTime: 30_000, refetchInterval: 60_000, queryKey: getGetWatchlistQueryKey(tab) },
  });

  const rows = data?.rows ?? [];
  const filtered = useMemo(() => {
    const q = filter.trim().toUpperCase();
    return rows.filter(r => {
      if (q && !r.symbol.toUpperCase().includes(q) && !r.name.toUpperCase().includes(q)) return false;
      if (trendFilter === "BULL" && !r.mcTrend.includes("Bullish")) return false;
      if (trendFilter === "BEAR" && !r.mcTrend.includes("Bearish")) return false;
      return true;
    });
  }, [rows, filter, trendFilter]);

  const advancers = rows.filter(r => r.changePercent > 0).length;
  const decliners = rows.filter(r => r.changePercent < 0).length;
  const unchanged = rows.length - advancers - decliners;
  const bullCount = rows.filter(r => r.mcTrend.includes("Bullish")).length;
  const bearCount = rows.filter(r => r.mcTrend.includes("Bearish")).length;

  return (
    <div className="w-full px-4 py-4 space-y-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Watchlist</h1>
        <p className="text-sm text-muted-foreground">Pre-loaded NSE index baskets — live quotes and short-term trend bias.</p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-border">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <div className="text-left">
              <div>{t.label}</div>
              <div className="text-[10px] font-mono font-normal text-muted-foreground">{t.sub}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card><CardContent className="p-3">
          <div className="text-[10px] uppercase text-muted-foreground font-mono">Stocks</div>
          <div className="text-xl font-bold font-mono tabular-nums">{rows.length}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[10px] uppercase text-muted-foreground font-mono">Advancers</div>
          <div className="text-xl font-bold font-mono tabular-nums text-signal-strong-buy">{advancers}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[10px] uppercase text-muted-foreground font-mono">Decliners</div>
          <div className="text-xl font-bold font-mono tabular-nums text-signal-strong-sell">{decliners}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[10px] uppercase text-muted-foreground font-mono">Unchanged</div>
          <div className="text-xl font-bold font-mono tabular-nums text-muted-foreground">{unchanged}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[10px] uppercase text-muted-foreground font-mono">Trend Bias</div>
          <div className="text-sm font-bold font-mono tabular-nums">
            <span className="text-signal-strong-buy">{bullCount}</span>
            <span className="text-muted-foreground"> / </span>
            <span className="text-signal-strong-sell">{bearCount}</span>
          </div>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Filter by symbol or name…"
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  className="pl-8 w-[260px] bg-background border-border"
                />
              </div>
              <div className="flex gap-1 border border-border rounded-md p-0.5">
                {(["ALL","BULL","BEAR"] as const).map(k => (
                  <button
                    key={k}
                    onClick={() => setTrendFilter(k)}
                    className={`px-3 py-1 text-[11px] font-mono font-semibold rounded ${
                      trendFilter === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {k === "ALL" ? "All" : k === "BULL" ? "Bullish" : "Bearish"}
                  </button>
                ))}
              </div>
              <span className="text-xs text-muted-foreground font-mono">
                Showing {filtered.length} of {rows.length}
              </span>
            </div>
            {data?.asOf && (
              <div className="text-[10px] font-mono text-muted-foreground">
                Updated {new Date(data.asOf).toLocaleTimeString()} · auto-refresh 60s
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isError ? (
            <div className="p-6 text-sm text-signal-sell">
              Failed to load watchlist. {(error as Error)?.message ?? ""}
            </div>
          ) : (
            <div className="overflow-auto max-h-[calc(100vh-360px)]">
              <Table>
                <TableHeader className="sticky top-0 z-20 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                  <TableRow className="hover:bg-transparent border-border">
                    <TableHead className="font-mono text-[11px] sticky left-0 bg-card z-10">Stock</TableHead>
                    <TableHead className="font-mono text-[11px] text-right">Live Price</TableHead>
                    <TableHead className="font-mono text-[11px] text-right">Change</TableHead>
                    <TableHead className="font-mono text-[11px] text-right">Change %</TableHead>
                    <TableHead className="font-mono text-[11px] text-right">Volume</TableHead>
                    <TableHead className="font-mono text-[11px] text-right">Today's High</TableHead>
                    <TableHead className="font-mono text-[11px] text-right">Today's Low</TableHead>
                    <TableHead className="font-mono text-[11px] text-right">Prev Close</TableHead>
                    <TableHead className="font-mono text-[11px] text-right">RSI</TableHead>
                    <TableHead className="font-mono text-[11px] text-center">MC Trend Short Term</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 14 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={10} className="h-10"><Skeleton className="h-4 w-full" /></TableCell>
                      </TableRow>
                    ))
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-8">
                        No stocks match the current filter.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map(r => {
                      const up = r.changePercent >= 0;
                      const chgColor = up ? "text-signal-strong-buy" : "text-signal-strong-sell";
                      return (
                        <TableRow key={r.symbol} className="hover:bg-white/5 border-border">
                          <TableCell className="sticky left-0 bg-card z-10">
                            <Link href={`/stock/${encodeURIComponent(r.symbol)}`} className="block group">
                              <div className="font-mono font-bold text-sm group-hover:text-primary">{r.symbol}</div>
                              <div className="text-[10px] text-muted-foreground truncate max-w-[200px]">{r.name}</div>
                            </Link>
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{r.livePrice.toFixed(2)}</TableCell>
                          <TableCell className={`text-right font-mono tabular-nums ${chgColor}`}>
                            {up ? "▲" : "▼"} {Math.abs(r.change).toFixed(2)}
                          </TableCell>
                          <TableCell className={`text-right font-mono tabular-nums font-semibold ${chgColor}`}>
                            {up ? "+" : ""}{r.changePercent.toFixed(2)}%
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums text-xs">{formatVolume(r.volume)}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{r.todayHigh.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{r.todayLow.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums text-muted-foreground">{r.previousClose.toFixed(2)}</TableCell>
                          <TableCell className={`text-right font-mono tabular-nums ${
                            r.rsi != null && r.rsi > 70 ? "text-signal-strong-sell" :
                            r.rsi != null && r.rsi < 30 ? "text-signal-strong-buy" : ""
                          }`}>
                            {r.rsi != null ? r.rsi.toFixed(0) : "—"}
                          </TableCell>
                          <TableCell className="text-center">{trendBadge(r.mcTrend)}</TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
