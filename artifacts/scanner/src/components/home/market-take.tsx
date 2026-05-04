import {
  useGetMarketTrend, getGetMarketTrendQueryKey,
  useGetHomeEnrichment, getGetHomeEnrichmentQueryKey,
} from "@workspace/api-client-react";
import { MessageSquare } from "lucide-react";

function generateNarrative(
  trend: { bias: string; score: number; headline: string; breadth: { advancers: number; decliners: number; advanceDeclineRatio?: number } },
  enrichment?: { indices: { key: string; pcrOi?: number | null; rsi14?: number | null; optionsBias?: string | null }[] },
): string {
  const parts: string[] = [];

  parts.push(trend.headline);

  const niftyE = enrichment?.indices?.find(e => e.key === "NIFTY50");
  if (niftyE) {
    const pcrParts: string[] = [];
    if (niftyE.pcrOi != null) {
      if (niftyE.pcrOi >= 1.3) pcrParts.push(`Nifty PCR at ${niftyE.pcrOi.toFixed(2)} signals put writers active (support building)`);
      else if (niftyE.pcrOi <= 0.7) pcrParts.push(`Nifty PCR at ${niftyE.pcrOi.toFixed(2)} indicates call-heavy positioning (resistance overhead)`);
    }
    if (niftyE.rsi14 != null) {
      if (niftyE.rsi14 >= 70) pcrParts.push(`RSI at ${niftyE.rsi14.toFixed(0)} is in overbought territory`);
      else if (niftyE.rsi14 <= 30) pcrParts.push(`RSI at ${niftyE.rsi14.toFixed(0)} is oversold — watch for reversal`);
    }
    if (pcrParts.length > 0) parts.push(pcrParts.join(". ") + ".");
  }

  const adRatio = trend.breadth.advanceDeclineRatio ?? 0;
  if (adRatio >= 2) parts.push("Broad-based participation with strong breadth.");
  else if (adRatio <= 0.5) parts.push("Breadth is weak — declines dominate across the board.");

  return parts.join(" ");
}

export default function MarketTake() {
  const { data: trend } = useGetMarketTrend({
    query: { refetchInterval: 30000, queryKey: getGetMarketTrendQueryKey() },
  });
  const { data: enrichment } = useGetHomeEnrichment({
    query: { refetchInterval: 30000, queryKey: getGetHomeEnrichmentQueryKey() },
  });

  if (!trend) return null;

  const narrative = generateNarrative(trend, enrichment ?? undefined);

  const biasColors: Record<string, string> = {
    STRONG_BULLISH: "border-emerald-500/40 bg-emerald-500/5",
    BULLISH: "border-emerald-400/30 bg-emerald-400/5",
    NEUTRAL: "border-border bg-muted/30",
    BEARISH: "border-rose-400/30 bg-rose-400/5",
    STRONG_BEARISH: "border-rose-500/40 bg-rose-500/5",
  };

  return (
    <div className={`rounded-lg border px-4 py-3 ${biasColors[trend.bias] ?? biasColors.NEUTRAL}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <MessageSquare className="h-3.5 w-3.5 text-primary" />
        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground font-semibold">
          Market Take
        </span>
        <span className="text-[10px] font-mono text-muted-foreground/50 ml-auto">
          Auto-generated from live data
        </span>
      </div>
      <p className="text-sm leading-relaxed">{narrative}</p>
    </div>
  );
}
