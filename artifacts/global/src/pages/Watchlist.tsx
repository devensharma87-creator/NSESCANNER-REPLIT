import { Link } from "wouter";
import {
  useGetGlobalWatchlist,
  useGetGlobalDashboard,
  useDeleteGlobalWatchlist,
  getGetGlobalWatchlistQueryKey,
  getGetGlobalDashboardQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DataProvenanceBadge } from "@/components/ui/DataProvenanceBadge";
import { ArrowUpRight, ArrowDownRight, Star, Trash2, AlertTriangle } from "lucide-react";

export function WatchlistPage() {
  const qc = useQueryClient();
  const wl = useGetGlobalWatchlist({ query: { queryKey: getGetGlobalWatchlistQueryKey(), refetchOnWindowFocus: false } });
  const dash = useGetGlobalDashboard(
    { asset: "watchlist" },
    { query: { queryKey: getGetGlobalDashboardQueryKey({ asset: "watchlist" }), refetchInterval: 30_000, refetchOnWindowFocus: false } },
  );
  const del = useDeleteGlobalWatchlist({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetGlobalWatchlistQueryKey() });
        qc.invalidateQueries({ queryKey: getGetGlobalDashboardQueryKey({ asset: "watchlist" }) });
      },
    },
  });

  if (wl.isLoading || dash.isLoading) return <Skeleton className="h-72 w-full" />;

  // B2.1-D5: API error must be visible — not silently treated as an empty watchlist.
  if (wl.isError || dash.isError) {
    return (
      <Card className="p-8 text-center text-muted-foreground">
        <AlertTriangle className="h-5 w-5 mx-auto mb-2 text-amber-500" />
        <p className="text-sm">Could not load watchlist data. Please try again shortly.</p>
      </Card>
    );
  }

  const rows = dash.data?.rows ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Star className="h-5 w-5 text-amber-400 fill-amber-400" /> Watchlist
        </h1>
        <p className="text-sm text-muted-foreground">{rows.length} instrument{rows.length === 1 ? "" : "s"} tracked.</p>
      </div>
      {rows.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          Your watchlist is empty. Star instruments from the Dashboard to track them here.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Symbol</th>
                <th className="text-left px-3 py-2 font-medium">Name</th>
                <th className="text-right px-3 py-2 font-medium">Price</th>
                <th className="text-right px-3 py-2 font-medium">Δ%</th>
                <th className="text-right px-3 py-2 font-medium">Remove</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                // B2.1-D4: null changePct must render neutral — not green.
                const hasChange = r.changePct != null && Number.isFinite(r.changePct);
                const up = hasChange && r.changePct! >= 0;
                return (
                  <tr key={r.symbol} className="border-t hover:bg-accent/30" data-testid={`wl-row-${r.symbol}`}>
                    <td className="px-3 py-2 font-mono">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Link href={`/i/${r.symbol}`} className="text-primary hover:underline" data-testid={`link-symbol-${r.symbol}`}>{r.symbol}</Link>
                        {/* B2.1-D8: Yahoo-sourced rows in watchlist must show "delayed" label. */}
                        <DataProvenanceBadge source={r.source} stale={r.stale} sourceHealthy={r.sourceHealthy} ageMs={r.ageMs} />
                      </div>
                    </td>
                    <td className="px-3 py-2">{r.displayName}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {r.price?.toLocaleString(undefined, { maximumFractionDigits: 4 }) ?? "—"}
                    </td>
                    {/* B2.1-D4: neutral colour when changePct is null/missing. */}
                    <td className={`px-3 py-2 text-right font-mono tabular-nums ${!hasChange ? "text-muted-foreground" : up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                      <span className="inline-flex items-center gap-0.5 justify-end">
                        {hasChange && (up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />)}
                        {hasChange ? `${r.changePct! >= 0 ? "+" : ""}${r.changePct!.toFixed(2)}%` : "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => del.mutate({ symbol: r.symbol })}
                        data-testid={`button-remove-${r.symbol}`}
                      >
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
