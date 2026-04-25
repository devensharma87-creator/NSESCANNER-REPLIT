import {
  useListStocks,
  getListStocksQueryKey,
  ListStocksSignal,
} from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SignalBadge } from "@/components/ui/signal-badge";
import { ScoreBar } from "@/components/ui/score-bar";
import { ArrowUp, ArrowDown, ArrowUpDown, RefreshCw } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useMemo, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { StockRow } from "@workspace/api-client-react";

type Universe = "curated" | "full";

interface FullNseResponse {
  rows: StockRow[];
  total: number;
  universeSize: number;
  sourceDate: string;
  scanMs: number;
  failures: number;
  rested: number;
}

/**
 * Hook for the Full NSE EQ universe (~2486 symbols, lighter scanner).
 * Mirrors the shape returned by useListStocks (StockRow[]) so the rest of
 * the page renders identically. Server already supports search/signal —
 * sector and screen presets are applied client-side after fetch (same as
 * curated).
 */
function useFullNseStocks(params: { search?: string; signal?: string }, enabled: boolean) {
  const [data, setData] = useState<StockRow[] | undefined>(undefined);
  const [meta, setMeta] = useState<{ universeSize: number; sourceDate: string; scanMs: number; failures: number; rested: number } | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(enabled);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set("limit", "5000");
    p.set("sortBy", "changePct");
    p.set("order", "desc");
    if (params.signal && params.signal !== "all") p.set("signal", params.signal);
    if (params.search?.trim()) p.set("search", params.search.trim());
    return p.toString();
  }, [params.search, params.signal]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setIsLoading(true);
    fetch(`/api/scan/full-nse?${qs}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((j: FullNseResponse) => {
        if (cancelled) return;
        setData(j.rows);
        setMeta({ universeSize: j.universeSize, sourceDate: j.sourceDate, scanMs: j.scanMs, failures: j.failures, rested: j.rested });
      })
      .catch(() => { if (!cancelled) setData([]); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    const t = setInterval(() => {
      fetch(`/api/scan/full-nse?${qs}`, { credentials: "include" })
        .then(r => r.ok ? r.json() : null)
        .then((j: FullNseResponse | null) => {
          if (cancelled || !j) return;
          setData(j.rows);
          setMeta({ universeSize: j.universeSize, sourceDate: j.sourceDate, scanMs: j.scanMs, failures: j.failures, rested: j.rested });
        })
        .catch(() => {});
    }, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [qs, enabled]);

  return { data, isLoading, meta };
}

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
      className={`inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider hover:text-foreground transition-colors ${active ? "text-foreground" : "text-muted-foreground"} ${align === "right" ? "ml-auto" : ""}`}
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

const SCREENS = [
  { id: "none", label: "All" },
  { id: "rsiOversold", label: "RSI < 30" },
  { id: "rsiOverbought", label: "RSI > 70" },
  { id: "aboveVwap", label: "Above VWAP" },
  { id: "belowVwap", label: "Below VWAP" },
  { id: "volSpike", label: "Vol > 2×" },
  { id: "near52wHigh", label: "Near 52W High" },
  { id: "near52wLow", label: "Near 52W Low" },
  { id: "goldenCross", label: "Golden Stack" },
  { id: "deathCross", label: "Death Stack" },
  { id: "topBuys", label: "Strong Buy" },
  { id: "topSells", label: "Strong Sell" },
];

export default function ScannerPage() {
  const [location] = useLocation();

  const initialSearch = useMemo(() => {
    const idx = location.indexOf("?");
    return idx >= 0 ? new URLSearchParams(location.slice(idx + 1)).get("search") || "" : "";
  }, [location]);
  const initialSector = useMemo(() => {
    const idx = location.indexOf("?");
    return idx >= 0 ? new URLSearchParams(location.slice(idx + 1)).get("sector") || "all" : "all";
  }, [location]);

  const [universe, setUniverse] = useState<Universe>(() => {
    if (typeof window === "undefined") return "curated";
    return (localStorage.getItem("scanner.universe") as Universe) || "curated";
  });
  useEffect(() => { try { localStorage.setItem("scanner.universe", universe); } catch {} }, [universe]);

  const [sectorFilter, setSectorFilter] = useState<string>(initialSector);
  const [signalFilter, setSignalFilter] = useState<string>("all");
  const [searchFilter, setSearchFilter] = useState<string>(initialSearch);
  // Debounce the search input. Without this, every keystroke fires a fresh
  // /api/scan/full-nse request on the Full NSE universe path.
  const [debouncedSearch, setDebouncedSearch] = useState<string>(initialSearch);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchFilter.trim()), 250);
    return () => clearTimeout(t);
  }, [searchFilter]);

  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "score", dir: "desc" });
  const [screen, setScreen] = useState<string>("none");

  useEffect(() => { setSearchFilter(initialSearch); }, [initialSearch]);
  useEffect(() => { setSectorFilter(initialSector); }, [initialSector]);

  // ---- Curated F&O universe (~280) — orval-generated hook ----
  const listParams = useMemo(() => {
    const p = {
      ...(sectorFilter !== "all" && { sector: sectorFilter }),
      ...(signalFilter !== "all" && { signal: signalFilter as ListStocksSignal }),
      ...(debouncedSearch && { search: debouncedSearch }),
    };
    return Object.keys(p).length === 0 ? undefined : p;
  }, [sectorFilter, signalFilter, debouncedSearch]);

  const { data: curatedStocks, isLoading: curatedLoading } = useListStocks(listParams, {
    query: { refetchInterval: 30000, queryKey: getListStocksQueryKey(listParams), enabled: universe === "curated" },
  });

  // ---- Full NSE EQ universe (~2486) — lightweight bhavcopy-driven scan ----
  const { data: fullStocks, isLoading: fullLoading, meta: fullMeta } = useFullNseStocks(
    { search: debouncedSearch, signal: signalFilter },
    universe === "full",
  );

  const stocks = universe === "full" ? fullStocks : curatedStocks;
  const stocksLoading = universe === "full" ? fullLoading : curatedLoading;

  // Sectors auto-derived from data so dropdown stays accurate as universe grows
  const sectors = useMemo(() => {
    const set = new Set<string>();
    (stocks ?? []).forEach(s => set.add(s.sector));
    return Array.from(set).sort();
  }, [stocks]);

  const sortedStocks = useMemo(() => {
    if (!stocks) return undefined;
    let arr = [...stocks];
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
        case "topBuys": return s.recommendation.signal === "STRONG_BUY";
        case "topSells": return s.recommendation.signal === "STRONG_SELL";
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
    <div className="w-full max-w-none px-4 py-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold font-mono tracking-tight">FULL SCANNER</h1>
          <p className="text-sm text-muted-foreground">
            {universe === "curated"
              ? "All NSE F&O / index constituents tracked live · click any column header to sort · use screen presets to narrow · hover any row for the top reasons behind its signal."
              : <>Live scan across <span className="font-mono text-foreground">{fullMeta?.universeSize ?? "…"}</span> active NSE EQ symbols (driven by the official NSE bhavcopy, refreshed every 5 min). {fullMeta && <>Last scan: <span className="font-mono">{(fullMeta.scanMs / 1000).toFixed(1)}s</span> · {fullMeta.failures} no-feed · {fullMeta.rested} rested · source {fullMeta.sourceDate}.</>}</>}
          </p>
        </div>
        {/* Universe toggle: curated F&O (~280, deep indicators) vs full NSE EQ (~2486, lightweight). */}
        <div className="inline-flex items-center rounded-md border border-border bg-card p-0.5 font-mono text-[11px]">
          <button
            onClick={() => setUniverse("curated")}
            className={`px-3 py-1.5 rounded-sm transition-colors ${universe === "curated" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            data-testid="universe-curated"
          >
            F&amp;O CURATED <span className="opacity-60">(~280)</span>
          </button>
          <button
            onClick={() => setUniverse("full")}
            className={`px-3 py-1.5 rounded-sm transition-colors ${universe === "full" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            data-testid="universe-full"
          >
            FULL NSE EQ <span className="opacity-60">(~2486)</span>
          </button>
          {universe === "full" && stocksLoading && (
            <RefreshCw className="ml-2 mr-2 h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="border-b border-border pb-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base font-mono">{sortedStocks?.length ?? 0} stocks shown · universe = {stocks?.length ?? 0}{universe === "full" && fullMeta ? ` of ${fullMeta.universeSize}` : ""}</CardTitle>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {SCREENS.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setScreen(p.id)}
                    className={`text-[11px] font-mono px-2.5 py-1 rounded border transition-colors ${screen === p.id ? "bg-primary/15 border-primary/60 text-primary" : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Input
                placeholder="Filter symbol/name..."
                className="w-[180px] font-mono text-sm h-9 bg-background"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
              />
              <Select value={sectorFilter} onValueChange={setSectorFilter}>
                <SelectTrigger className="w-[170px] h-9 bg-background"><SelectValue placeholder="Sector" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sectors</SelectItem>
                  {sectors.map(sec => (
                    <SelectItem key={sec} value={sec}>{sec}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={signalFilter} onValueChange={setSignalFilter}>
                <SelectTrigger className="w-[150px] h-9 bg-background"><SelectValue placeholder="Signal" /></SelectTrigger>
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
          <Table containerClassName="max-h-[calc(100vh-220px)]">
              <TableHeader className="sticky top-0 z-20 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                <TableRow className="hover:bg-transparent border-border">
                  <TableHead className="font-mono text-[11px] sticky left-0 bg-card z-10"><SortHead k="symbol" label="SYMBOL" sort={sort} setSort={setSort} align="left" /></TableHead>
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
                  <TableHead className="font-mono text-[11px] text-right">SIGNAL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stocksLoading ? (
                  Array.from({ length: 12 }).map((_, i) => (
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
                        <TableCell className={`text-right font-mono text-sm font-bold tabular-nums ${cmpVsVwap}`}>{fmtIN(q.price)}</TableCell>
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
                        <TableCell className="text-right font-mono text-xs tabular-nums">{ind?.volumeRatio != null ? `${ind.volumeRatio.toFixed(1)}×` : '—'}</TableCell>
                        <TableCell className="align-middle"><ScoreBar score={stock.recommendation.score} /></TableCell>
                        <TableCell className="text-right"><SignalBadge signal={stock.recommendation.signal} /></TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
        </CardContent>
      </Card>
    </div>
  );
}
