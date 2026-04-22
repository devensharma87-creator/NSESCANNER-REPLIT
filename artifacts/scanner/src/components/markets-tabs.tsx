import {
  useGetGlobalIndices,
  getGetGlobalIndicesQueryKey,
  useGetMarketSummary,
  getGetMarketSummaryQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown } from "lucide-react";
import { Link } from "wouter";
import type { IndexQuote } from "@workspace/api-client-react";

const REGION_TABS: { key: string; label: string; match: (i: IndexQuote) => boolean }[] = [
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

function fmtIN(n: number) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
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

function GlobalCard({ idx }: { idx: IndexQuote }) {
  const up = idx.change >= 0;
  const tone = up ? "text-signal-strong-buy" : "text-signal-strong-sell";
  return (
    <Card className="bg-card border-border hover:border-foreground/30 transition-colors h-full">
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

function IndiaCard({ idx }: {
  idx: IndexQuote & {
    constituentSlug?: string;
    breadth?: { advancers: number; decliners: number; unchanged: number; adRatio: number | null };
  };
}) {
  const up = idx.change >= 0;
  const tone = up ? "text-signal-strong-buy" : "text-signal-strong-sell";
  const b = idx.breadth;
  const totalB = b ? b.advancers + b.decliners + b.unchanged : 0;
  const advPct = b && totalB > 0 ? (b.advancers / totalB) * 100 : 0;
  const decPct = b && totalB > 0 ? (b.decliners / totalB) * 100 : 0;
  const uncPct = b && totalB > 0 ? (b.unchanged / totalB) * 100 : 0;

  const inner = (
    <Card className="bg-card border-border hover:border-foreground/30 transition-colors h-full">
      <CardContent className="p-3 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground truncate" title={idx.name}>
              {idx.name}
            </div>
            <div className="font-bold font-mono text-base tabular-nums leading-tight">
              {fmtIN(idx.price)}
            </div>
          </div>
          <span className={`shrink-0 ${tone}`}>
            {up ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
          </span>
        </div>
        <div className={`text-[11px] font-mono tabular-nums font-semibold ${tone}`}>
          {up ? "+" : ""}{fmtIN(idx.change)} ({up ? "+" : ""}{idx.changePercent.toFixed(2)}%)
        </div>

        {(idx.open != null || idx.high != null || idx.low != null) && (
          <div className="grid grid-cols-3 gap-1 text-[10px] font-mono tabular-nums text-muted-foreground/80">
            <span title="Open">O {idx.open != null ? fmtIN(idx.open) : "—"}</span>
            <span title="High" className="text-signal-strong-buy/80">H {idx.high != null ? fmtIN(idx.high) : "—"}</span>
            <span title="Low" className="text-signal-strong-sell/80">L {idx.low != null ? fmtIN(idx.low) : "—"}</span>
          </div>
        )}

        {b && (
          <div className="pt-1 border-t border-border/40 space-y-1">
            <div className="flex h-1.5 rounded-sm overflow-hidden bg-muted">
              <div className="bg-signal-strong-buy" style={{ width: `${advPct}%` }} />
              <div className="bg-muted-foreground/40" style={{ width: `${uncPct}%` }} />
              <div className="bg-signal-strong-sell" style={{ width: `${decPct}%` }} />
            </div>
            <div className="flex justify-between text-[10px] font-mono">
              <span className="text-signal-strong-buy">▲{b.advancers}</span>
              <span className="text-muted-foreground">A/D {b.adRatio == null ? "∞" : b.adRatio.toFixed(2)}</span>
              <span className="text-signal-strong-sell">▼{b.decliners}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );

  return idx.constituentSlug ? (
    <Link href={`/index/${idx.constituentSlug}`} className="block">{inner}</Link>
  ) : inner;
}

export default function MarketsTabs() {
  const { data: globals, isLoading: gLoading } = useGetGlobalIndices({
    query: { refetchInterval: 30000, queryKey: getGetGlobalIndicesQueryKey() },
  });
  const { data: summary, isLoading: sLoading } = useGetMarketSummary({
    query: { refetchInterval: 30000, queryKey: getGetMarketSummaryQueryKey() },
  });

  const indianIndices = (summary?.indices ?? []) as Array<IndexQuote & {
    constituentSlug?: string;
    breadth?: { advancers: number; decliners: number; unchanged: number; adRatio: number | null };
  }>;

  return (
    <Card className="border-border">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-mono font-semibold uppercase tracking-widest text-muted-foreground">Markets</h3>
          <span className="text-[10px] font-mono text-muted-foreground/60">auto-refresh 30s · source: Yahoo</span>
        </div>
        <Tabs defaultValue={REGION_TABS[0]?.key ?? "asia"}>
          <TabsList className="bg-secondary/40">
            {REGION_TABS.map(t => (
              <TabsTrigger key={t.key} value={t.key} className="font-mono text-xs">{t.label}</TabsTrigger>
            ))}
          </TabsList>

          {/* Global region tabs */}
          {REGION_TABS.map(t => {
            const items = (globals?.indices ?? []).filter(t.match);
            return (
              <TabsContent key={t.key} value={t.key} className="mt-3">
                {gLoading ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[110px] w-full" />)}
                  </div>
                ) : items.length === 0 ? (
                  <div className="text-xs text-muted-foreground font-mono py-6 text-center">No instruments in this region.</div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    {items.map(idx => <GlobalCard key={idx.symbol} idx={idx} />)}
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
