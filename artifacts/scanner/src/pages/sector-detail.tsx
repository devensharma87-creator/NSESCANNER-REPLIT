import { useRoute, Link } from "wouter";
import { useGetSector, getGetSectorQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { SignalBadge } from "@/components/ui/signal-badge";
import { ScoreBar } from "@/components/ui/score-bar";
import { ArrowLeft, TrendingUp, TrendingDown } from "lucide-react";

export default function SectorDetail() {
  const [, params] = useRoute<{ sector: string }>("/sectors/:sector");
  const sectorName = params?.sector ? decodeURIComponent(params.sector) : "";
  const { data, isLoading } = useGetSector(sectorName, {
    query: { enabled: !!sectorName, refetchInterval: 30000, queryKey: getGetSectorQueryKey(sectorName) },
  });

  const fmtPct = (p: number) => `${p > 0 ? "+" : ""}${p.toFixed(2)}%`;

  return (
    <div className="container max-w-screen-2xl py-6 space-y-6">
      <div>
        <Link href="/sectors" className="inline-flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> ALL SECTORS
        </Link>
        <h1 className="text-2xl font-bold font-mono tracking-tight mt-2">{sectorName.toUpperCase()}</h1>
      </div>

      {isLoading || !data ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Stocks" value={String(data.summary.stockCount)} />
          <StatCard
            label="Avg Score"
            value={data.summary.avgScore > 0 ? `+${data.summary.avgScore}` : String(data.summary.avgScore)}
            tone={data.summary.avgScore > 0 ? "buy" : data.summary.avgScore < 0 ? "sell" : "neutral"}
          />
          <StatCard
            label="Avg Change"
            value={fmtPct(data.summary.avgChangePercent ?? 0)}
            tone={(data.summary.avgChangePercent ?? 0) >= 0 ? "buy" : "sell"}
          />
          <StatCard
            label="Breadth"
            value={
              <span className="flex items-baseline gap-1.5 font-mono text-xl font-bold">
                <span className="text-signal-strong-buy">{data.summary.gainers}</span>
                <span className="text-muted-foreground text-sm">/</span>
                <span className="text-signal-strong-sell">{data.summary.losers}</span>
              </span>
            }
          />
        </div>
      )}

      <Card>
        <CardHeader className="border-b border-border pb-3">
          <CardTitle className="text-sm font-mono">RANKED CONSTITUENTS</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border">
                  <TableHead className="font-mono text-xs w-[140px]">SYMBOL</TableHead>
                  <TableHead className="font-mono text-xs">NAME</TableHead>
                  <TableHead className="font-mono text-xs text-right">LTP</TableHead>
                  <TableHead className="font-mono text-xs text-right">CHG %</TableHead>
                  <TableHead className="font-mono text-xs text-right">RSI</TableHead>
                  <TableHead className="font-mono text-xs text-right">VOL×</TableHead>
                  <TableHead className="font-mono text-xs w-[160px]">SCORE</TableHead>
                  <TableHead className="font-mono text-xs text-right w-[110px]">SIGNAL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={8}><Skeleton className="h-5 w-full" /></TableCell>
                    </TableRow>
                  ))
                ) : (
                  data?.stocks.map(s => (
                    <TableRow key={s.symbol} className="hover:bg-white/5 border-border/50">
                      <TableCell>
                        <Link href={`/stock/${encodeURIComponent(s.symbol)}`} className="font-mono font-bold hover:underline">
                          {s.symbol}
                        </Link>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate max-w-[260px]">{s.name}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{s.quote.price.toFixed(2)}</TableCell>
                      <TableCell className={`text-right font-mono text-sm font-medium ${s.quote.changePercent >= 0 ? "text-signal-strong-buy" : "text-signal-strong-sell"}`}>
                        {s.quote.changePercent >= 0 ? <TrendingUp className="inline w-3 h-3 mr-0.5" /> : <TrendingDown className="inline w-3 h-3 mr-0.5" />}
                        {fmtPct(s.quote.changePercent)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">{s.indicators?.rsi14?.toFixed(1) ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{s.indicators?.volumeRatio?.toFixed(2) ?? "—"}×</TableCell>
                      <TableCell><ScoreBar score={s.recommendation.score} /></TableCell>
                      <TableCell className="text-right"><SignalBadge signal={s.recommendation.signal} /></TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "buy" | "sell" | "neutral" }) {
  const cls = tone === "buy" ? "text-signal-strong-buy" : tone === "sell" ? "text-signal-strong-sell" : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[10px] font-mono uppercase text-muted-foreground tracking-wider">{label}</div>
        <div className={`mt-1 font-mono text-xl font-bold ${cls}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
