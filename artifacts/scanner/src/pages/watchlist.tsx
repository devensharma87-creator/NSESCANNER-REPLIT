import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useGetWatchlistBasket, getGetWatchlistBasketQueryKey, useListStocks, getListStocksQueryKey, type DataProviderName } from "@workspace/api-client-react";
import { DataSourceBadge, type DataSource } from "@/components/ui/data-source-badge";
import { Link } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Minus, Search, Star, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SignalBadge } from "@/components/ui/signal-badge";
import {
  getPersonalWatchlist,
  addToPersonalWatchlist,
  removeFromPersonalWatchlist,
  type PersonalWatchlistItem,
} from "@/lib/auth-api";

type WatchlistKey =
  | "MY_LIST"
  | "SENSEX"
  | "BANKNIFTY"
  | "NIFTY50"
  | "NIFTY100"
  | "NIFTYMIDCAP100"
  | "NIFTYSMALLCAP100"
  | "NIFTY500";

type IndexKey = Exclude<WatchlistKey, "MY_LIST">;

const TABS: Array<{ key: WatchlistKey; label: string; sub: string }> = [
  { key: "MY_LIST",          label: "My List",           sub: "Your personal watchlist — symbols you saved" },
  { key: "SENSEX",           label: "Sensex 30",         sub: "BSE 30 — bellwether large-caps" },
  { key: "BANKNIFTY",        label: "Bank Nifty",        sub: "12 most liquid Indian banks" },
  { key: "NIFTY50",          label: "Nifty 50",          sub: "Top 50 by free-float mcap" },
  { key: "NIFTY100",         label: "Nifty 100",         sub: "Nifty 50 + Next 50 — large-caps" },
  { key: "NIFTYMIDCAP100",   label: "Nifty Midcap 100",  sub: "101–250 by full market cap" },
  { key: "NIFTYSMALLCAP100", label: "Nifty Smallcap 100",sub: "251–500 by full market cap" },
  { key: "NIFTY500",         label: "Nifty 500",         sub: "Broad market — ~96% of mcap" },
];

function trendBadge(t: string | null) {
  if (t == null) {
    return (
      <span
        title="Trend bias unavailable — symbol not in the live scanner universe right now."
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold border text-muted-foreground bg-muted/30 border-border"
      >
        n/a
      </span>
    );
  }
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

/** Map the trusted-layer provider name onto the DataSourceBadge vocabulary. */
function toBadgeSource(s: DataProviderName | undefined): DataSource {
  switch (s) {
    case "kite":      return "kite";
    case "yahoo":     return "yahoo";
    case "cache":     return "cache";
    case "indstocks": return "mixed";
    default:          return "unknown";
  }
}

function formatVolume(v: number): string {
  if (v >= 1e7) return `${(v / 1e7).toFixed(2)}Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(2)}L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(v);
}

export default function Watchlist() {
  const [tab, setTab] = useState<WatchlistKey>("MY_LIST");
  const [filter, setFilter] = useState("");
  const [trendFilter, setTrendFilter] = useState<"ALL" | "BULL" | "BEAR">("ALL");

  // We always have to call the same hooks every render — but when on the
  // MY_LIST tab we render a different component below and ignore this data.
  // Pass a fallback index key so the codegen call is well-formed; React Query
  // dedupes and is harmless when we don't read the result.
  const indexKey: IndexKey = tab === "MY_LIST" ? "SENSEX" : tab;
  const { data, isLoading, isError, error } = useGetWatchlistBasket(indexKey, {
    query: {
      staleTime: 30_000, refetchInterval: 60_000,
      queryKey: getGetWatchlistBasketQueryKey(indexKey),
      enabled: tab !== "MY_LIST",
    },
  });

  const rows = data?.rows ?? [];
  const filtered = useMemo(() => {
    const q = filter.trim().toUpperCase();
    return rows.filter(r => {
      if (q && !r.symbol.toUpperCase().includes(q) && !r.name.toUpperCase().includes(q)) return false;
      if (trendFilter === "BULL" && !(r.trend?.includes("Bullish"))) return false;
      if (trendFilter === "BEAR" && !(r.trend?.includes("Bearish"))) return false;
      return true;
    });
  }, [rows, filter, trendFilter]);

  // Use the same ±0.05% "flat" threshold as the rest of the app
  // so summary counts are consistent everywhere.
  const advancers = rows.filter(r => (r.changePercent ?? 0) > 0.05).length;
  const decliners = rows.filter(r => (r.changePercent ?? 0) < -0.05).length;
  const unchanged = rows.length - advancers - decliners;
  const bullCount = rows.filter(r => r.trend?.includes("Bullish")).length;
  const bearCount = rows.filter(r => r.trend?.includes("Bearish")).length;

  // The MY_LIST tab uses a completely different data source (personal-watchlist
  // API + cross-joined with the live universe), so render a separate component.
  if (tab === "MY_LIST") {
    return <PersonalWatchlistView tabs={TABS} currentTab={tab} onChangeTab={setTab} />;
  }

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
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {!isLoading && data && data.missing.length > 0 && (
                <span
                  title={data.missing.map(m => `${m.symbol}: ${m.reason}`).join("\n")}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold border border-amber-500/40 text-amber-500 bg-amber-500/10"
                >
                  Partial: {data.missing.length} of {data.requested} unavailable
                </span>
              )}
              {data?.meta && (
                <DataSourceBadge
                  source={toBadgeSource(data.meta.source)}
                  status={data.meta.isStale ? "stale" : data.meta.delayed ? "delayed" : "live"}
                  lastUpdated={data.meta.fetchedAt}
                  refreshMs={60_000}
                  compact
                />
              )}
            </div>
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
                    <TableHead className="font-mono text-[11px] text-center">Trend</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 14 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={10} className="h-10"><Skeleton className="h-4 w-full" /></TableCell>
                      </TableRow>
                    ))
                  ) : rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-8">
                        <div className="font-semibold text-foreground">No live data available for this basket yet</div>
                        <p className="mt-1 max-w-md mx-auto">
                          Quotes are served from the live scanner. If it is still warming up
                          or the data provider is briefly unreachable, this fills in on the
                          next auto-refresh (every 60s).
                        </p>
                      </TableCell>
                    </TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-8">
                        No stocks match the current filter.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map(r => {
                      const cp = r.changePercent;
                      const up = (cp ?? 0) >= 0;
                      const chgColor = cp == null ? "text-muted-foreground" : up ? "text-signal-strong-buy" : "text-signal-strong-sell";
                      return (
                        <TableRow key={r.symbol} className="hover-row border-border">
                          <TableCell className="sticky left-0 bg-card z-10">
                            <Link href={`/stock/${encodeURIComponent(r.symbol)}`} className="block group">
                              <div className="font-mono font-bold text-sm group-hover:text-primary">{r.symbol}</div>
                              <div className="text-[10px] text-muted-foreground truncate max-w-[200px]">{r.name}</div>
                            </Link>
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{r.lastPrice.toFixed(2)}</TableCell>
                          <TableCell className={`text-right font-mono tabular-nums ${chgColor}`}>
                            {r.change == null ? "n/a" : `${up ? "▲" : "▼"} ${Math.abs(r.change).toFixed(2)}`}
                          </TableCell>
                          <TableCell className={`text-right font-mono tabular-nums font-semibold ${chgColor}`}>
                            {cp == null ? "n/a" : `${up ? "+" : ""}${cp.toFixed(2)}%`}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums text-xs">{r.volume == null ? "n/a" : formatVolume(r.volume)}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{r.high == null ? "n/a" : r.high.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{r.low == null ? "n/a" : r.low.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums text-muted-foreground">{r.previousClose == null ? "n/a" : r.previousClose.toFixed(2)}</TableCell>
                          <TableCell className={`text-right font-mono tabular-nums ${
                            r.rsi != null && r.rsi > 70 ? "text-signal-strong-sell" :
                            r.rsi != null && r.rsi < 30 ? "text-signal-strong-buy" : ""
                          }`}>
                            {r.rsi != null ? r.rsi.toFixed(0) : "—"}
                          </TableCell>
                          <TableCell className="text-center">{trendBadge(r.trend)}</TableCell>
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

// ───────────────────────────────────────────────────────────────────────────
// Personal Watchlist View
// ───────────────────────────────────────────────────────────────────────────
//
// Renders the MY_LIST tab. Two data sources joined client-side:
//   1. /api/personal-watchlist  → { items: [{ symbol, addedAt, notes }, ...] }
//   2. /api/stocks (codegen)    → full universe with live quote + signal
//
// We left-join personal items against the live universe so symbols that aren't
// currently in the universe (e.g. illiquid F&O underlyings) still show up in
// the table — just without quote data.

interface PersonalViewProps {
  tabs: Array<{ key: WatchlistKey; label: string; sub: string }>;
  currentTab: WatchlistKey;
  onChangeTab: (k: WatchlistKey) => void;
}

function PersonalWatchlistView({ tabs, currentTab, onChangeTab }: PersonalViewProps) {
  const qc = useQueryClient();
  const [addInput, setAddInput] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: personal, isLoading: personalLoading } = useQuery({
    queryKey: ["personal-watchlist"],
    queryFn: getPersonalWatchlist,
    staleTime: 30_000,
  });

  // Universe — used to pull live quote/signal data for each personal symbol
  const { data: universe } = useListStocks(undefined, {
    query: { staleTime: 30_000, queryKey: getListStocksQueryKey() },
  });

  const universeBySymbol = useMemo(() => {
    const m = new Map<string, NonNullable<typeof universe>[number]>();
    for (const s of universe ?? []) m.set(s.symbol.toUpperCase(), s);
    return m;
  }, [universe]);

  const items: PersonalWatchlistItem[] = personal?.items ?? [];

  const filtered = useMemo(() => {
    const q = filter.trim().toUpperCase();
    if (!q) return items;
    return items.filter(it => it.symbol.includes(q));
  }, [items, filter]);

  const addMutation = useMutation({
    mutationFn: (symbol: string) => addToPersonalWatchlist(symbol, null),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["personal-watchlist"] }),
  });
  const removeMutation = useMutation({
    mutationFn: (symbol: string) => removeFromPersonalWatchlist(symbol),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["personal-watchlist"] }),
  });

  // Universe-aware suggestions for the add box
  const suggestions = useMemo(() => {
    const q = addInput.trim().toUpperCase();
    if (q.length < 1) return [];
    const have = new Set(items.map(it => it.symbol));
    return (universe ?? [])
      .filter(s =>
        !have.has(s.symbol) &&
        (s.symbol.toUpperCase().includes(q) || s.name.toUpperCase().includes(q)),
      )
      .slice(0, 6);
  }, [addInput, universe, items]);

  async function handleAdd(symbol: string) {
    setBusy(true);
    setError(null);
    try {
      await addMutation.mutateAsync(symbol.trim().toUpperCase());
      setAddInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "add failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(symbol: string) {
    if (!confirm(`Remove ${symbol} from your personal watchlist?`)) return;
    setBusy(true);
    setError(null);
    try { await removeMutation.mutateAsync(symbol); }
    catch (err) { setError(err instanceof Error ? err.message : "remove failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="w-full px-4 py-4 space-y-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Star className="h-6 w-6 text-amber-500" /> Watchlist
        </h1>
        <p className="text-sm text-muted-foreground">Pre-loaded NSE index baskets — live quotes and short-term trend bias.</p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-border">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => onChangeTab(t.key)}
            data-testid={`tab-${t.key.toLowerCase()}`}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              currentTab === t.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <div className="text-left">
              <div className="flex items-center gap-1.5">
                {t.key === "MY_LIST" && <Star className="h-3.5 w-3.5 text-amber-500" />}
                {t.label}
              </div>
              <div className="text-[10px] font-mono font-normal text-muted-foreground">{t.sub}</div>
            </div>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            <div className="flex-1 max-w-md space-y-1">
              <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Add a symbol to your list</label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={addInput}
                  onChange={e => setAddInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && addInput.trim()) void handleAdd(addInput); }}
                  placeholder="Type a symbol e.g. RELIANCE, INFY, TATAMOTORS…"
                  className="pl-8"
                  data-testid="input-add-symbol"
                />
                {addInput && suggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 z-30 rounded-md border border-border bg-card shadow-xl max-h-72 overflow-auto">
                    {suggestions.map(s => (
                      <button
                        key={s.symbol}
                        type="button"
                        onClick={() => void handleAdd(s.symbol)}
                        className="w-full text-left px-3 py-2 hover:bg-muted/40 border-b border-border/50 last:border-0 flex items-center justify-between gap-3"
                        data-testid={`suggest-${s.symbol}`}
                      >
                        <div>
                          <div className="font-mono font-bold text-sm">{s.symbol}</div>
                          <div className="text-[11px] text-muted-foreground truncate">{s.name}</div>
                        </div>
                        <Plus className="h-4 w-4 text-primary" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {error && <div className="text-xs text-red-500">{error}</div>}
            </div>
            <div className="flex items-end gap-3">
              <div className="space-y-1">
                <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Filter</label>
                <Input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter your list…" className="w-[200px]" />
              </div>
              <div className="text-xs text-muted-foreground font-mono pb-2">{items.length} saved</div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {personalLoading ? (
            <div className="p-6 space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : items.length === 0 ? (
            <div className="p-10 text-center">
              <Star className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
              <div className="text-base font-semibold">Your personal watchlist is empty</div>
              <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                Use the search box above to add the symbols you want to track. Live quotes and signals update automatically.
              </p>
            </div>
          ) : (
            <div className="overflow-auto max-h-[calc(100vh-360px)]">
              <Table>
                <TableHeader className="sticky top-0 z-20 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                  <TableRow className="hover:bg-transparent border-border">
                    <TableHead className="font-mono text-[11px] sticky left-0 bg-card z-10">Symbol</TableHead>
                    <TableHead className="font-mono text-[11px]">Name</TableHead>
                    <TableHead className="font-mono text-[11px] text-right">Live Price</TableHead>
                    <TableHead className="font-mono text-[11px] text-right">Change %</TableHead>
                    <TableHead className="font-mono text-[11px] text-right">Volume</TableHead>
                    <TableHead className="font-mono text-[11px]">Signal</TableHead>
                    <TableHead className="font-mono text-[11px]">Added</TableHead>
                    <TableHead className="font-mono text-[11px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(it => {
                    const live = universeBySymbol.get(it.symbol);
                    const up = (live?.quote.changePercent ?? 0) >= 0;
                    const chgColor = !live ? "text-muted-foreground" : up ? "text-signal-strong-buy" : "text-signal-strong-sell";
                    return (
                      <TableRow key={it.symbol} className="hover-row border-border" data-testid={`personal-row-${it.symbol}`}>
                        <TableCell className="font-mono font-bold sticky left-0 bg-card z-10">
                          <Link href={`/stock/${it.symbol}`} className="hover:underline">{it.symbol}</Link>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground truncate max-w-[200px]">{live?.name ?? "—"}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{live?.quote.price.toFixed(2) ?? "—"}</TableCell>
                        <TableCell className={`text-right font-mono tabular-nums ${chgColor}`}>
                          {live ? `${up ? "+" : ""}${live.quote.changePercent.toFixed(2)}%` : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-xs">{live ? formatVolume(live.quote.volume) : "—"}</TableCell>
                        <TableCell>
                          {live ? (
                            <SignalBadge signal={live.recommendation.signal} />
                          ) : (
                            <span className="text-[10px] text-muted-foreground">not in current universe</span>
                          )}
                        </TableCell>
                        <TableCell className="text-[11px] font-mono text-muted-foreground">
                          {new Date(it.addedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost" size="icon"
                            className="h-7 w-7 text-red-500 hover:text-red-500 hover:bg-red-500/10"
                            onClick={() => void handleRemove(it.symbol)}
                            disabled={busy}
                            data-testid={`button-remove-${it.symbol}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
