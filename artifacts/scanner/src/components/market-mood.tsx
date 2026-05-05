import { useGetMarketTrend, getGetMarketTrendQueryKey, useGetGlobalIndices, getGetGlobalIndicesQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Gauge } from "lucide-react";

/**
 * Render one macro instrument readout (VIX / DXY / Crude). Defensive — if
 * either `price` or `changePercent` is missing/non-finite we render "—"
 * rather than calling `.toFixed` on a non-number (which throws). The
 * `inverse` flag flips the colour: for VIX/DXY rising = bearish; for
 * Crude rising = bullish (commodity demand proxy).
 */
function MacroPill({ label, item, inverse = false }: {
  label: string;
  item: { price?: number | null; changePercent?: number | null } | undefined;
  inverse?: boolean;
}) {
  const price = item?.price;
  const cp = item?.changePercent;
  const priceOk = typeof price === "number" && Number.isFinite(price);
  const cpOk = typeof cp === "number" && Number.isFinite(cp);
  if (!priceOk || !cpOk) {
    return <div>{label} <span className="text-muted-foreground">—</span></div>;
  }
  const positive = cp >= 0;
  const tone = inverse
    ? (positive ? "text-signal-strong-sell" : "text-signal-strong-buy")
    : (positive ? "text-signal-strong-buy" : "text-signal-strong-sell");
  return (
    <div>{label} <span className={tone}>{price.toFixed(2)} ({positive ? "+" : ""}{cp.toFixed(2)}%)</span></div>
  );
}

function MoodMeter({ score, label }: { score: number; label: string }) {
  // -100..+100 → 0..100 percentage on bar
  const pct = Math.max(0, Math.min(100, (score + 100) / 2));
  const color =
    score >= 50 ? "bg-signal-strong-buy" :
    score >= 22 ? "bg-signal-buy" :
    score <= -50 ? "bg-signal-strong-sell" :
    score <= -22 ? "bg-signal-sell" :
    "bg-signal-neutral";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] font-mono uppercase text-muted-foreground tracking-wider">
        <span>{label}</span>
        <span className="font-bold text-foreground">{score > 0 ? `+${score}` : score}</span>
      </div>
      <div className="relative h-1.5 bg-muted rounded-full overflow-hidden">
        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-border z-10" />
        <div className={`absolute top-0 bottom-0 ${color}`} style={{ width: `${Math.abs(pct - 50) * 2}%`, left: score >= 0 ? "50%" : `${pct}%` }} />
      </div>
    </div>
  );
}

export default function MarketMood() {
  const { data: trend, isLoading: trendLoading } = useGetMarketTrend({ query: { refetchInterval: 30000, queryKey: getGetMarketTrendQueryKey() } });
  const { data: globals, isLoading: globalsLoading } = useGetGlobalIndices({ query: { refetchInterval: 30000, queryKey: getGetGlobalIndicesQueryKey() } });

  const vix = globals?.indices?.find(i => i.symbol === "^VIX");
  const dxy = globals?.indices?.find(i => i.symbol === "DX-Y.NYB");
  const crude = globals?.indices?.find(i => i.symbol === "CL=F");

  // Honesty guard — distinguish between "feed is loading" (show placeholder),
  // "feed returned but every input is missing" (show explicit no-data
  // panel) and "real readings" (compute composite). Without this guard
  // the panel proudly displayed `0 · 0 · 0 · NEUTRAL` even when the
  // entire backing trend / VIX feed had no data, which the audit
  // flagged as misleading because zero is itself a meaningful reading.
  const isLoading = trendLoading || globalsLoading;
  const trendKnown = typeof trend?.score === "number" && Number.isFinite(trend.score);
  const vixKnown = vix != null && Number.isFinite(vix.changePercent);
  const breadthKnown = typeof trend?.breadth?.advanceDeclineRatio === "number" && Number.isFinite(trend!.breadth!.advanceDeclineRatio);
  const noData = !isLoading && !trendKnown && !vixKnown && !breadthKnown;

  // Composite mood — heavier weight on the trend score, plus VIX direction (inverse)
  const trendScore = trendKnown ? (trend!.score as number) : 0;
  const vixScore = vixKnown ? Math.max(-50, Math.min(50, -vix!.changePercent * 5)) : 0;
  const breadthRatio: number = breadthKnown ? (trend!.breadth!.advanceDeclineRatio as number) : 1;
  const breadthScore = Math.max(-40, Math.min(40, (breadthRatio - 1) * 30));
  const composite = Math.round((trendScore * 0.55) + (vixScore * 0.20) + (breadthScore * 0.25));

  let mood = "NEUTRAL";
  let moodColor = "text-signal-neutral";
  if (composite >= 50) { mood = "EUPHORIC"; moodColor = "text-signal-strong-buy"; }
  else if (composite >= 22) { mood = "GREEDY"; moodColor = "text-signal-buy"; }
  else if (composite <= -50) { mood = "PANIC"; moodColor = "text-signal-strong-sell"; }
  else if (composite <= -22) { mood = "FEARFUL"; moodColor = "text-signal-sell"; }

  if (isLoading || noData) {
    return (
      <Card className="border-border bg-gradient-to-br from-card to-card/40">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <Gauge className="w-3.5 h-3.5" /> MARKET MOOD
            </div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              {isLoading ? "Loading…" : "No data"}
            </div>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {isLoading
              ? "Waiting for the market-trend and VIX feeds to return their first reading…"
              : "Mood readings are unavailable — the upstream trend feed and VIX both returned no data. This usually clears once the broker session reconnects or the cash market opens."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border bg-gradient-to-br from-card to-card/40">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <Gauge className="w-3.5 h-3.5" /> MARKET MOOD
          </div>
          <div className={`text-sm font-mono font-bold tracking-wider ${moodColor}`}>{mood} · {composite > 0 ? `+${composite}` : composite}</div>
        </div>
        <MoodMeter score={composite} label="Composite Mood" />
        <div className="grid grid-cols-3 gap-3 pt-1">
          <MoodMeter score={trendScore} label="Trend" />
          <MoodMeter score={Math.round(breadthScore)} label="Breadth" />
          <MoodMeter score={Math.round(vixScore)} label="Vol (VIX)" />
        </div>
        <div className="grid grid-cols-3 gap-2 text-[10px] font-mono text-muted-foreground pt-1 border-t border-border/40">
          <MacroPill label="VIX" item={vix} inverse />
          <MacroPill label="DXY" item={dxy} inverse />
          <MacroPill label="Crude" item={crude} />
        </div>
      </CardContent>
    </Card>
  );
}
