import { useListSectors, getListSectorsQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Activity } from "lucide-react";
import { SignalBadge } from "@/components/ui/signal-badge";

export default function Sectors() {
  const { data: sectors, isLoading } = useListSectors({
    query: {
      queryKey: getListSectorsQueryKey(),
      refetchInterval: 60_000,
      staleTime: 30_000,
    },
  });

  const formatPct = (p: number) => `${p > 0 ? '+' : ''}${p.toFixed(2)}%`;

  return (
    <div className="w-full max-w-none px-4 py-6 space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold font-mono tracking-tight flex items-center gap-2">
          <Layers className="w-6 h-6 text-primary" />
          SECTOR ROTATION
        </h1>
        <p className="text-muted-foreground text-sm max-w-2xl">
          Analyze money flow across industry groups. Sectors with higher average scores exhibit stronger collective technical momentum.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {isLoading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="h-[200px]"><Skeleton className="w-full h-full rounded-lg" /></Card>
          ))
        ) : (
          sectors?.sort((a, b) => b.avgScore - a.avgScore).map((sector) => (
            <Link key={sector.sector} href={`/sectors/${encodeURIComponent(sector.sector)}`}>
              <Card className="h-full border-border hover:border-primary/50 transition-colors cursor-pointer group bg-card hover:bg-card/80">
                <CardHeader className="pb-2 flex flex-row items-start justify-between">
                  <CardTitle className="text-sm font-bold truncate pr-2" title={sector.sector}>
                    {sector.sector}
                  </CardTitle>
                  <Badge variant="outline" className={`shrink-0 font-mono ${
                    (sector.avgChangePercent || 0) > 0 ? "text-signal-strong-buy border-signal-strong-buy/30 bg-signal-strong-buy/10" 
                    : "text-signal-strong-sell border-signal-strong-sell/30 bg-signal-strong-sell/10"
                  }`}>
                    {sector.avgChangePercent ? formatPct(sector.avgChangePercent) : "0.00%"}
                  </Badge>
                </CardHeader>
                <CardContent className="pb-2 space-y-4">
                  <div className="flex justify-between items-end">
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground font-mono">Avg Score</p>
                      <p className={`font-mono text-xl font-bold ${
                        sector.avgScore > 0 ? "text-signal-strong-buy" : sector.avgScore < 0 ? "text-signal-strong-sell" : "text-signal-neutral"
                      }`}>
                        {sector.avgScore > 0 ? `+${sector.avgScore.toFixed(0)}` : sector.avgScore.toFixed(0)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase text-muted-foreground font-mono">Breadth</p>
                      <div className="flex items-center gap-1.5 text-xs font-mono mt-1">
                        <span className="text-signal-strong-buy">{sector.gainers}</span>
                        <span className="text-muted-foreground">/</span>
                        <span className="text-signal-strong-sell">{sector.losers}</span>
                      </div>
                    </div>
                  </div>

                  {sector.topPick && (
                    <div className="pt-3 border-t border-border/50">
                      <p className="text-[10px] uppercase text-muted-foreground font-mono mb-1.5">Best Match</p>
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-sm">{sector.topPick.symbol}</span>
                        <SignalBadge signal={sector.topPick.recommendation.signal} />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

// Fix missing icon import
import { Layers } from "lucide-react";
