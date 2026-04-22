import { useGetGlobalIndices, getGetGlobalIndicesQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown } from "lucide-react";
import type { IndexQuote } from "@workspace/api-client-react";

const TABS: { key: string; label: string; match: (i: IndexQuote) => boolean }[] = [
  { key: "asia", label: "Asia", match: i => ["India / SGX", "Japan", "Hong Kong", "China"].includes(i.region ?? "") },
  { key: "europe", label: "Europe", match: i => ["UK", "Germany"].includes(i.region ?? "") },
  { key: "us", label: "US", match: i => i.region === "US" },
  { key: "fx", label: "Currencies", match: i => i.region === "FX" },
  { key: "commod", label: "Commodities", match: i => i.region === "Global" },
];

function fmtPrice(p: number) {
  if (p < 5) return p.toFixed(4);
  if (p < 100) return p.toFixed(2);
  return p.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function Sparkline({ data, up }: { data: number[]; up: boolean }) {
  if (!data || data.length < 2) return <div className="h-10" />;
  const w = 200, h = 40;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = Math.max(1e-9, max - min);
  const stepX = w / (data.length - 1);
  const pts = data.map((v, i) => `${(i * stepX).toFixed(2)},${(h - ((v - min) / span) * h).toFixed(2)}`).join(" ");
  const stroke = up ? "rgb(34,197,94)" : "rgb(239,68,68)";
  const fill = up ? "rgba(34,197,94,0.14)" : "rgba(239,68,68,0.14)";
  const area = `0,${h} ${pts} ${w},${h}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-10" preserveAspectRatio="none">
      <polygon points={area} fill={fill} />
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function MiniCard({ idx }: { idx: IndexQuote }) {
  const up = idx.change >= 0;
  const tone = up ? "text-signal-strong-buy" : "text-signal-strong-sell";
  return (
    <Card className="bg-card border-border hover:border-foreground/30 transition-colors">
      <CardContent className="p-3 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground truncate" title={idx.name}>
              {idx.name}
            </div>
            <div className="font-bold font-mono text-base tabular-nums leading-tight">
              {fmtPrice(idx.price)}
            </div>
          </div>
          <span className={`shrink-0 ${tone}`}>
            {up ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
          </span>
        </div>
        <div className={`text-[11px] font-mono tabular-nums font-semibold ${tone}`}>
          {up ? "+" : ""}{fmtPrice(idx.change)} ({up ? "+" : ""}{idx.changePercent.toFixed(2)}%)
        </div>
        <Sparkline data={idx.sparkline ?? []} up={up} />
      </CardContent>
    </Card>
  );
}

export default function MarketsTabs() {
  const { data, isLoading } = useGetGlobalIndices({
    query: { refetchInterval: 30000, queryKey: getGetGlobalIndicesQueryKey() },
  });

  return (
    <Card className="border-border">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-mono font-semibold uppercase tracking-widest text-muted-foreground">Markets</h3>
          <span className="text-[10px] font-mono text-muted-foreground/60">auto-refresh 30s · source: Yahoo</span>
        </div>
        <Tabs defaultValue="asia">
          <TabsList className="bg-secondary/40">
            {TABS.map(t => (
              <TabsTrigger key={t.key} value={t.key} className="font-mono text-xs">{t.label}</TabsTrigger>
            ))}
          </TabsList>
          {TABS.map(t => {
            const items = (data?.indices ?? []).filter(t.match);
            return (
              <TabsContent key={t.key} value={t.key} className="mt-3">
                {isLoading ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[110px] w-full" />)}
                  </div>
                ) : items.length === 0 ? (
                  <div className="text-xs text-muted-foreground font-mono py-6 text-center">No instruments in this region.</div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    {items.map(idx => <MiniCard key={idx.symbol} idx={idx} />)}
                  </div>
                )}
              </TabsContent>
            );
          })}
        </Tabs>
      </CardContent>
    </Card>
  );
}
