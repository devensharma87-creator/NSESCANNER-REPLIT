import { cn } from "@/lib/utils";

export function ScoreBar({ score, className }: { score: number, className?: string }) {
  // Score is -100 to 100
  let color = "bg-signal-neutral";
  if (score >= 50) color = "bg-signal-strong-buy";
  else if (score >= 22) color = "bg-signal-buy";
  else if (score <= -50) color = "bg-signal-strong-sell";
  else if (score <= -22) color = "bg-signal-sell";

  const pctSigned = Math.max(-100, Math.min(100, score));
  const widthPct = Math.abs(pctSigned) / 2; // 0..50
  const leftPct = pctSigned >= 0 ? 50 : 50 - widthPct;
  const textColor = score > 0 ? "text-signal-strong-buy" : score < 0 ? "text-signal-strong-sell" : "text-signal-neutral";

  return (
    <div className={cn("flex items-center gap-2 w-full min-w-[90px]", className)}>
      <span className={cn("font-mono text-xs font-bold tabular-nums w-9 text-right", textColor)}>
        {score > 0 ? `+${score}` : score}
      </span>
      <div className="relative h-1.5 flex-1 bg-muted overflow-hidden rounded-full">
        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-border/70 z-10" />
        <div
          className={cn("absolute top-0 bottom-0 transition-all duration-500 rounded-full", color)}
          style={{ width: `${widthPct}%`, left: `${leftPct}%` }}
        />
      </div>
    </div>
  );
}
