import { useGetMarketSummary, getGetMarketSummaryQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { IndexQuote } from "@workspace/api-client-react";

const TARGETS: Array<{ match: (s: string, n: string) => boolean; label: string }> = [
  { match: (s) => s === "^NSEI", label: "NIFTY 50" },
  { match: (s) => s === "^NSEBANK", label: "BANK NIFTY" },
  { match: (s) => s === "^BSESN", label: "SENSEX" },
  { match: (s, n) => s.startsWith("NIFTY_FIN") || n === "FINNIFTY", label: "FINNIFTY" },
];

function fmt(n?: number) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function sentiment(idx: IndexQuote): { label: "Bullish" | "Bearish" | "Neutral"; tone: string; bg: string; icon: typeof TrendingUp } {
  // Pre-defined parameters: % change + intraday position vs day range
  const pct = idx.changePercent ?? 0;
  const price = idx.price ?? 0;
  const high = idx.high;
  const low = idx.low;
  let posScore = 0;
  if (high != null && low != null && high > low) {
    const rangePos = (price - low) / (high - low); // 0 = at day low, 1 = at day high
    posScore = (rangePos - 0.5) * 2; // -1..+1
  }
  const score = pct + posScore * 0.4; // % change dominates; intraday range adds nuance
  if (score > 0.35) return { label: "Bullish", tone: "text-signal-strong-buy", bg: "bg-signal-strong-buy/15 border-signal-strong-buy/40", icon: TrendingUp };
  if (score < -0.35) return { label: "Bearish", tone: "text-signal-strong-sell", bg: "bg-signal-strong-sell/15 border-signal-strong-sell/40", icon: TrendingDown };
  return { label: "Neutral", tone: "text-muted-foreground", bg: "bg-muted/30 border-border", icon: Minus };
}

export default function KeyIndicesCards() {
  const { data, isLoading } = useGetMarketSummary({
    query: { refetchInterval: 30_000, queryKey: getGetMarketSummaryQueryKey() },
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[140px] w-full" />)}
      </div>
    );
  }

  const all = data?.indices ?? [];
  const cards = TARGETS.map(t => ({
    label: t.label,
    idx: all.find(i => t.match(i.symbol, i.name)),
  })).filter(c => c.idx);

  if (cards.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map(({ label, idx }) => {
        const i = idx!;
        const up = i.change >= 0;
        const tone = up ? "text-signal-strong-buy" : "text-signal-strong-sell";
        const sent = sentiment(i);
        const SentIcon = sent.icon;
        return (
          <Card key={label} className="border-border hover:border-signal-strong-buy/40 transition-colors">
            <CardContent className="p-3 space-y-2">
              {/* Header: name + sentiment */}
              <div className="flex items-start justify-between gap-2">
                <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground font-bold">{label}</div>
                <Badge variant="outline" className={`font-mono text-[9px] uppercase ${sent.bg} ${sent.tone} border`}>
                  <SentIcon className="h-2.5 w-2.5 mr-0.5" />{sent.label}
                </Badge>
              </div>

              {/* LIVE price + change */}
              <div className="flex items-baseline justify-between gap-2">
                <div className="font-mono text-2xl font-bold tabular-nums">{fmt(i.price)}</div>
                <div className={`text-right font-mono ${tone}`}>
                  <div className="text-xs font-bold tabular-nums">{up ? "+" : ""}{fmt(i.change)}</div>
                  <div className="text-[11px] tabular-nums">{up ? "+" : ""}{i.changePercent.toFixed(2)}%</div>
                </div>
              </div>

              {/* OHL row */}
              <div className="grid grid-cols-3 gap-1 pt-1.5 border-t border-border/40">
                <div className="text-center">
                  <div className="font-mono text-[9px] uppercase text-muted-foreground">Open</div>
                  <div className="font-mono text-[11px] tabular-nums">{fmt(i.open)}</div>
                </div>
                <div className="text-center border-l border-r border-border/40">
                  <div className="font-mono text-[9px] uppercase text-muted-foreground">High</div>
                  <div className="font-mono text-[11px] tabular-nums text-signal-strong-buy">{fmt(i.high)}</div>
                </div>
                <div className="text-center">
                  <div className="font-mono text-[9px] uppercase text-muted-foreground">Low</div>
                  <div className="font-mono text-[11px] tabular-nums text-signal-strong-sell">{fmt(i.low)}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
