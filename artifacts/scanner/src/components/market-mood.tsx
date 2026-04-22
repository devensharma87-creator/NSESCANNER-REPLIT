import { useGetMarketTrend, getGetMarketTrendQueryKey, useGetGlobalIndices, getGetGlobalIndicesQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Gauge } from "lucide-react";

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
  const { data: trend } = useGetMarketTrend({ query: { refetchInterval: 30000, queryKey: getGetMarketTrendQueryKey() } });
  const { data: globals } = useGetGlobalIndices({ query: { refetchInterval: 30000, queryKey: getGetGlobalIndicesQueryKey() } });

  const vix = globals?.indices?.find(i => i.symbol === "^VIX");
  const dxy = globals?.indices?.find(i => i.symbol === "DX-Y.NYB");
  const crude = globals?.indices?.find(i => i.symbol === "CL=F");

  // Composite mood — heavier weight on the trend score, plus VIX direction (inverse)
  const trendScore = trend?.score ?? 0;
  const vixScore = vix ? Math.max(-50, Math.min(50, -vix.changePercent * 5)) : 0;
  const breadthRatio = trend?.breadth?.advanceDeclineRatio ?? 1;
  const breadthScore = Math.max(-40, Math.min(40, (breadthRatio - 1) * 30));
  const composite = Math.round((trendScore * 0.55) + (vixScore * 0.20) + (breadthScore * 0.25));

  let mood = "NEUTRAL";
  let moodColor = "text-signal-neutral";
  if (composite >= 50) { mood = "EUPHORIC"; moodColor = "text-signal-strong-buy"; }
  else if (composite >= 22) { mood = "GREEDY"; moodColor = "text-signal-buy"; }
  else if (composite <= -50) { mood = "PANIC"; moodColor = "text-signal-strong-sell"; }
  else if (composite <= -22) { mood = "FEARFUL"; moodColor = "text-signal-sell"; }

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
          <div>VIX <span className={vix && vix.changePercent >= 0 ? "text-signal-strong-sell" : "text-signal-strong-buy"}>{vix ? `${vix.price.toFixed(2)} (${vix.changePercent >= 0 ? "+" : ""}${vix.changePercent.toFixed(2)}%)` : "—"}</span></div>
          <div>DXY <span className={dxy && dxy.changePercent >= 0 ? "text-signal-strong-sell" : "text-signal-strong-buy"}>{dxy ? `${dxy.price.toFixed(2)} (${dxy.changePercent >= 0 ? "+" : ""}${dxy.changePercent.toFixed(2)}%)` : "—"}</span></div>
          <div>Crude <span className={crude && crude.changePercent >= 0 ? "text-signal-strong-buy" : "text-signal-strong-sell"}>{crude ? `${crude.price.toFixed(2)} (${crude.changePercent >= 0 ? "+" : ""}${crude.changePercent.toFixed(2)}%)` : "—"}</span></div>
        </div>
      </CardContent>
    </Card>
  );
}
