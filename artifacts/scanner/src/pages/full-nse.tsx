import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowUp, ArrowDown, ArrowUpDown, RefreshCw } from "lucide-react";
import type { StockRow } from "@workspace/api-client-react";

type SortKey = "symbol" | "price" | "changePct" | "rsi" | "volume" | "score" | "deliveryPct";
type SignalFilter = "ALL" | "STRONG_BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG_SELL";

interface FullNseResponse {
  rows: StockRow[];
  total: number;
  shown: number;
  offset: number;
  limit: number;
  lastUpdated: string;
  sourceDate: string;
  universeSize: number;
  scanMs: number;
  failures: number;
  rested: number;
  source: string;
}

const SIGNAL_TONE: Record<string, string> = {
  STRONG_BUY: "bg-emerald-600/20 text-emerald-400 border-emerald-500/40",
  BUY: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  NEUTRAL: "bg-zinc-700/20 text-zinc-400 border-zinc-600/40",
  SELL: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  STRONG_SELL: "bg-rose-600/20 text-rose-400 border-rose-500/40",
};

function fmtN(n: number, d = 2): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtVol(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(2)}L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toString();
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

export default function FullNsePage() {
  const [data, setData] = useState<FullNseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [signal, setSignal] = useState<SignalFilter>("ALL");
  const [sortBy, setSortBy] = useState<SortKey>("changePct");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [limit, setLimit] = useState<number>(200);
  const [refreshTick, setRefreshTick] = useState(0);

  // Debounce the search input so each keystroke doesn't fire a fresh /scan
  // request. Without this, typing "RELIANCE" queues 8 in-flight requests and
  // the table races between them.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    p.set("sortBy", sortBy);
    p.set("order", order);
    p.set("limit", String(limit));
    if (signal !== "ALL") p.set("signal", signal);
    if (debouncedSearch) p.set("search", debouncedSearch);
    return p.toString();
  }, [sortBy, order, limit, signal, debouncedSearch]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/scan/full-nse?${queryString}`, { credentials: "include" })
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j: FullNseResponse) => { if (!cancelled) setData(j); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [queryString, refreshTick]);

  // Auto-refresh every 60s
  useEffect(() => {
    const t = setInterval(() => setRefreshTick(x => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  function toggleSort(k: SortKey) {
    if (sortBy === k) setOrder(o => o === "asc" ? "desc" : "asc");
    else { setSortBy(k); setOrder(k === "symbol" ? "asc" : "desc"); }
  }
  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortBy !== k) return <ArrowUpDown className="inline h-3 w-3 ml-1 opacity-50" />;
    return order === "asc" ? <ArrowUp className="inline h-3 w-3 ml-1" /> : <ArrowDown className="inline h-3 w-3 ml-1" />;
  };

  return (
    <div className="container mx-auto px-4 py-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Full NSE Market Scanner</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live scan across <span className="font-mono text-foreground">{data?.universeSize ?? "…"}</span> active NSE EQ symbols
            (driven by the official NSE bhavcopy, refreshed every 5 min).
            {data && <> Last scan: <span className="font-mono">{fmtN(data.scanMs / 1000, 1)}s</span> · {data.failures} no-feed · {data.rested} rested.</>}
          </p>
        </div>
        <button
          onClick={() => setRefreshTick(x => x + 1)}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-card hover:bg-card/80 text-sm"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap gap-3 items-center">
            <Input
              placeholder="Search symbol or name…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Select value={signal} onValueChange={v => setSignal(v as SignalFilter)}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All signals</SelectItem>
                <SelectItem value="STRONG_BUY">Strong Buy</SelectItem>
                <SelectItem value="BUY">Buy</SelectItem>
                <SelectItem value="NEUTRAL">Neutral</SelectItem>
                <SelectItem value="SELL">Sell</SelectItem>
                <SelectItem value="STRONG_SELL">Strong Sell</SelectItem>
              </SelectContent>
            </Select>
            <Select value={String(limit)} onValueChange={v => setLimit(parseInt(v, 10))}>
              <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="50">Top 50</SelectItem>
                <SelectItem value="200">Top 200</SelectItem>
                <SelectItem value="500">Top 500</SelectItem>
                <SelectItem value="1000">Top 1000</SelectItem>
                <SelectItem value="2500">All rows</SelectItem>
              </SelectContent>
            </Select>
            {data && (
              <div className="ml-auto flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="font-mono">Showing {data.shown.toLocaleString()} of {data.total.toLocaleString()}</Badge>
                <Badge variant="outline" className="font-mono">Bhav {data.sourceDate}</Badge>
                <Badge variant="outline" className="font-mono">Updated {timeAgo(data.lastUpdated)}</Badge>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-md p-3 mb-3">
              Failed to load: {error}
            </div>
          )}
          {loading && !data ? (
            <div className="space-y-2">
              {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
            </div>
          ) : (
            <div className="overflow-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="cursor-pointer" onClick={() => toggleSort("symbol")}>Symbol<SortIcon k="symbol"/></TableHead>
                    <TableHead className="text-right cursor-pointer" onClick={() => toggleSort("price")}>Price<SortIcon k="price"/></TableHead>
                    <TableHead className="text-right cursor-pointer" onClick={() => toggleSort("changePct")}>Change %<SortIcon k="changePct"/></TableHead>
                    <TableHead className="text-right cursor-pointer" onClick={() => toggleSort("rsi")}>RSI<SortIcon k="rsi"/></TableHead>
                    <TableHead className="text-right">EMA20</TableHead>
                    <TableHead className="text-right">EMA50</TableHead>
                    <TableHead className="text-right">VWAP</TableHead>
                    <TableHead className="text-right cursor-pointer" onClick={() => toggleSort("volume")}>Volume<SortIcon k="volume"/></TableHead>
                    <TableHead className="text-right cursor-pointer" onClick={() => toggleSort("deliveryPct")}>Deliv %<SortIcon k="deliveryPct"/></TableHead>
                    <TableHead className="text-center">Signal</TableHead>
                    <TableHead className="text-right cursor-pointer" onClick={() => toggleSort("score")}>Score<SortIcon k="score"/></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.rows.length === 0 && (
                    <TableRow><TableCell colSpan={11} className="text-center text-sm text-muted-foreground py-8">No rows match current filters.</TableCell></TableRow>
                  )}
                  {data?.rows.map(r => {
                    const cp = r.quote.changePercent;
                    const cpTone = cp > 0 ? "text-emerald-400" : cp < 0 ? "text-rose-400" : "text-muted-foreground";
                    return (
                      <TableRow key={r.symbol} className="hover:bg-muted/30">
                        <TableCell className="font-mono">
                          <Link href={`/stock/${r.symbol}`} className="hover:underline font-semibold">{r.symbol}</Link>
                          {r.quote.name && <div className="text-[11px] text-muted-foreground truncate max-w-[200px]">{r.quote.name}</div>}
                        </TableCell>
                        <TableCell className="text-right font-mono">{fmtN(r.quote.price)}</TableCell>
                        <TableCell className={`text-right font-mono ${cpTone}`}>{cp > 0 ? "+" : ""}{fmtN(cp)}%</TableCell>
                        <TableCell className="text-right font-mono">{fmtN(r.indicators?.rsi14 ?? 0, 0)}</TableCell>
                        <TableCell className="text-right font-mono">{fmtN(r.indicators?.ema20 ?? 0)}</TableCell>
                        <TableCell className="text-right font-mono">{fmtN(r.indicators?.ema50 ?? 0)}</TableCell>
                        <TableCell className="text-right font-mono">{r.indicators?.vwap ? fmtN(r.indicators.vwap) : "—"}</TableCell>
                        <TableCell className="text-right font-mono">{fmtVol(r.quote.volume)}</TableCell>
                        <TableCell className="text-right font-mono">{r.indicators?.deliveryPct ? fmtN(r.indicators.deliveryPct, 1) + "%" : "—"}</TableCell>
                        <TableCell className="text-center">
                          <Badge className={`${SIGNAL_TONE[r.recommendation.signal] ?? ""} border font-mono text-[10px]`} variant="outline">
                            {r.recommendation.signal.replace("_", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">{fmtN(r.recommendation.score, 0)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">About this scan</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Driven by the official daily NSE security-wise bhavcopy ({data?.universeSize ?? "…"} symbols).
            Each symbol is scanned with a single Yahoo intraday call (15-min bars, current session); price, change %, RSI, EMA20/50,
            ATR, VWAP, volume vs avg, and delivery % are all derived from live data. Signal is composed from trend (EMA cross),
            momentum (RSI), volume confirmation, and VWAP position.
          </p>
          <p>
            Symbols that consistently return no Yahoo feed (3 fails) are rested for an hour to keep scan latency low. Refresh
            cycle: 5 min in the background; this page also auto-refreshes every 60 s.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
