import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useGetGlobalDashboard,
  useGetGlobalWatchlist,
  useAddGlobalWatchlist,
  useDeleteGlobalWatchlist,
  getGetGlobalWatchlistQueryKey,
  getGetGlobalDashboardQueryKey,
  type GlobalDashboardRow,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { StatusStrip } from "@/components/StatusStrip";
import {
  Star, StarOff, ArrowUpRight, ArrowDownRight, Loader2,
  ArrowUp, ArrowDown, AlertTriangle, Search, X,
} from "lucide-react";

type AssetTab = "crypto" | "commodities" | "forex" | "equities" | "indices" | "watchlist";

const TABS: { value: AssetTab; label: string }[] = [
  { value: "crypto",      label: "Crypto" },
  { value: "commodities", label: "Commodities" },
  { value: "forex",       label: "Forex" },
  { value: "equities",    label: "Equities" },
  { value: "indices",     label: "Indices" },
  { value: "watchlist",   label: "Watchlist" },
];

function fmtPrice(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (Math.abs(v) >= 1) return v.toFixed(4);
  return v.toFixed(6);
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function fmtVol(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v === 0) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

function fmtAge(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return "now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

type SortKey = "symbol" | "changePct" | "volume" | "updatedAt" | "price";
type SortDir = "asc" | "desc";

const EMPTY_FILTERS: Record<AssetTab, string> = {
  crypto: "",
  commodities: "",
  forex: "",
  equities: "",
  indices: "",
  watchlist: "",
};

export function DashboardPage() {
  const [tab, setTab] = useState<AssetTab>("crypto");
  const [filters, setFilters] = useState<Record<AssetTab, string>>(EMPTY_FILTERS);
  const setFilterFor = (asset: AssetTab) => (value: string) =>
    setFilters((prev) => ({ ...prev, [asset]: value }));
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Live cross-asset snapshot. Click any row for chart + indicators.
            Rows tagged <span className="font-medium">stale</span> are showing the last-known
            value because the upstream feed is overdue or failing.
          </p>
        </div>
        <StatusStrip />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as AssetTab)}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} data-testid={`tab-${t.value}`}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((t) => (
          <TabsContent key={t.value} value={t.value} className="mt-4">
            <DashboardTable
              asset={t.value}
              filter={filters[t.value]}
              onFilterChange={setFilterFor(t.value)}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function compareRows(a: GlobalDashboardRow, b: GlobalDashboardRow, key: SortKey, dir: SortDir): number {
  const mul = dir === "asc" ? 1 : -1;
  const get = (r: GlobalDashboardRow): number | string => {
    switch (key) {
      case "symbol":     return r.symbol;
      case "changePct":  return r.changePct ?? Number.NEGATIVE_INFINITY;
      case "volume":     return r.volume ?? Number.NEGATIVE_INFINITY;
      case "price":      return r.price ?? Number.NEGATIVE_INFINITY;
      case "updatedAt":  return r.updatedAt ? Date.parse(r.updatedAt) : Number.NEGATIVE_INFINITY;
    }
  };
  const va = get(a), vb = get(b);
  if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb) * mul;
  return ((va as number) - (vb as number)) * mul;
}

function SortHeader(props: {
  label: string;
  k: SortKey;
  current: { key: SortKey; dir: SortDir };
  onChange: (k: SortKey) => void;
  align?: "left" | "right";
  className?: string;
  testid?: string;
}) {
  const active = props.current.key === props.k;
  const Icon = active ? (props.current.dir === "asc" ? ArrowUp : ArrowDown) : null;
  return (
    <th className={`px-3 py-2 font-medium ${props.align === "right" ? "text-right" : "text-left"} ${props.className ?? ""}`}>
      <button
        type="button"
        onClick={() => props.onChange(props.k)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground" : ""}`}
        data-testid={props.testid ?? `sort-${props.k}`}
      >
        {props.label}
        {Icon && <Icon className="h-3 w-3" />}
      </button>
    </th>
  );
}

function DashboardTable({
  asset,
  filter,
  onFilterChange,
}: {
  asset: AssetTab;
  filter: string;
  onFilterChange: (value: string) => void;
}) {
  const qc = useQueryClient();
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "changePct", dir: "desc" });
  const { data, isLoading } = useGetGlobalDashboard(
    { asset },
    { query: { queryKey: getGetGlobalDashboardQueryKey({ asset }), refetchInterval: 30_000, refetchOnWindowFocus: false } },
  );
  const wl = useGetGlobalWatchlist({ query: { queryKey: getGetGlobalWatchlistQueryKey(), refetchOnWindowFocus: false } });
  const watched = new Set((wl.data?.items ?? []).map((i) => i.symbol));

  const addWl = useAddGlobalWatchlist({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetGlobalWatchlistQueryKey() });
        qc.invalidateQueries({ queryKey: getGetGlobalDashboardQueryKey({ asset: "watchlist" }) });
      },
    },
  });
  const delWl = useDeleteGlobalWatchlist({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetGlobalWatchlistQueryKey() });
        qc.invalidateQueries({ queryKey: getGetGlobalDashboardQueryKey({ asset: "watchlist" }) });
      },
    },
  });

  const sorted = useMemo(() => {
    const rows = (data?.rows ?? []).slice();
    rows.sort((a, b) => compareRows(a, b, sort.key, sort.dir));
    return rows;
  }, [data, sort]);

  const trimmedFilter = filter.trim();
  const visible = useMemo(() => {
    if (!trimmedFilter) return sorted;
    const needle = trimmedFilter.toLowerCase();
    return sorted.filter(
      (r) =>
        r.symbol.toLowerCase().includes(needle) ||
        (r.displayName ?? "").toLowerCase().includes(needle),
    );
  }, [sorted, trimmedFilter]);

  function onSort(k: SortKey) {
    setSort(prev => prev.key === k ? { key: k, dir: prev.dir === "asc" ? "desc" : "asc" } : { key: k, dir: k === "symbol" ? "asc" : "desc" });
  }

  const filterInput = (
    <div className="relative w-full max-w-sm">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={filter}
        onChange={(e) => onFilterChange(e.target.value)}
        placeholder="Filter by symbol or name…"
        className="pl-8 pr-8"
        data-testid={`filter-${asset}`}
        aria-label="Filter instruments"
      />
      {filter && (
        <button
          type="button"
          onClick={() => onFilterChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
          data-testid={`filter-clear-${asset}`}
          aria-label="Clear filter"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        {filterInput}
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div className="space-y-3">
        {filterInput}
        <Card className="p-8 text-center text-muted-foreground">
          {asset === "watchlist"
            ? "Your watchlist is empty. Star instruments from any asset tab to track them here."
            : "No data yet — the live feed is warming up. Refresh in a few seconds."}
        </Card>
      </div>
    );
  }

  if (visible.length === 0) {
    return (
      <div className="space-y-3">
        {filterInput}
        <Card
          className="p-8 text-center text-muted-foreground"
          data-testid={`empty-filter-${asset}`}
        >
          No instruments match “{trimmedFilter}”.
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {filterInput}
      <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <SortHeader label="Symbol" k="symbol" current={sort} onChange={onSort} />
              <th className="text-left px-3 py-2 font-medium">Name</th>
              <SortHeader label="Price" k="price" current={sort} onChange={onSort} align="right" />
              <SortHeader label="Δ%" k="changePct" current={sort} onChange={onSort} align="right" />
              <th className="text-right px-3 py-2 font-medium hidden md:table-cell">Day H/L</th>
              <SortHeader label="Volume" k="volume" current={sort} onChange={onSort} align="right" className="hidden lg:table-cell" />
              <SortHeader label="Updated" k="updatedAt" current={sort} onChange={onSort} align="right" />
              <th className="text-right px-3 py-2 font-medium">Watch</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const up = (r.changePct ?? 0) >= 0;
              const isWatched = watched.has(r.symbol);
              const isStale = r.stale === true;
              return (
                <tr
                  key={r.symbol}
                  className={`border-t hover:bg-accent/30 ${isStale ? "bg-amber-50/40 dark:bg-amber-950/10" : ""}`}
                  data-testid={`row-${r.symbol}`}
                  data-stale={isStale ? "true" : "false"}
                >
                  <td className="px-3 py-2 font-mono">
                    <div className="flex items-center gap-1.5">
                      <Link
                        href={`/i/${r.symbol}`}
                        className="text-primary hover:underline"
                        data-testid={`link-symbol-${r.symbol}`}
                      >
                        {r.symbol}
                      </Link>
                      {isStale && (
                        <Badge
                          variant="outline"
                          className="h-4 px-1 text-[10px] text-amber-700 border-amber-400 dark:text-amber-300 dark:border-amber-700"
                          title={r.lastError ?? "Upstream feed overdue or failing — value is last-known."}
                          data-testid={`badge-stale-${r.symbol}`}
                        >
                          <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                          stale
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">{r.displayName}</td>
                  <td className={`px-3 py-2 text-right font-mono tabular-nums ${isStale ? "text-muted-foreground" : ""}`}>
                    {fmtPrice(r.price ?? null)}
                    {r.currency && <span className="text-xs text-muted-foreground ml-1">{r.currency}</span>}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono tabular-nums ${isStale ? "text-muted-foreground" : up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                    <span className="inline-flex items-center gap-0.5 justify-end">
                      {!isStale && r.changePct != null && (up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />)}
                      {fmtPct(r.changePct ?? null)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-muted-foreground hidden md:table-cell">
                    {fmtPrice(r.dayHigh ?? null)} / {fmtPrice(r.dayLow ?? null)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-muted-foreground hidden lg:table-cell">
                    {fmtVol(r.volume ?? null)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right text-xs ${isStale ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}
                    data-testid={`updated-${r.symbol}`}
                  >
                    {fmtAge(r.ageMs ?? null)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        isWatched
                          ? delWl.mutate({ symbol: r.symbol })
                          : addWl.mutate({ data: { symbol: r.symbol } })
                      }
                      data-testid={`button-watch-${r.symbol}`}
                    >
                      {(addWl.isPending || delWl.isPending) ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : isWatched ? (
                        <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                      ) : (
                        <StarOff className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </Card>
    </div>
  );
}
