import { cn } from "@/lib/utils";

export function ScoreBar({ score, className }: { score: number, className?: string }) {
  // Score is -100 to 100
  const normalized = (score + 100) / 200; // 0 to 1
  const percentage = Math.max(0, Math.min(100, normalized * 100));
  
  let color = "bg-signal-neutral";
  if (score >= 50) color = "bg-signal-strong-buy";
  else if (score > 10) color = "bg-signal-buy";
  else if (score <= -50) color = "bg-signal-strong-sell";
  else if (score < -10) color = "bg-signal-sell";

  return (
    <div className={cn("flex flex-col gap-1 w-full", className)}>
      <div className="flex justify-between items-center text-[10px] font-mono text-muted-foreground uppercase">
        <span>Sell</span>
        <span className={cn("font-bold text-xs", 
          score > 0 ? "text-signal-strong-buy" : score < 0 ? "text-signal-strong-sell" : "text-signal-neutral"
        )}>{score > 0 ? `+${score}` : score}</span>
        <span>Buy</span>
      </div>
      <div className="relative h-1.5 w-full bg-muted overflow-hidden rounded-full">
        <div className="absolute top-0 bottom-0 left-1/2 w-[1px] bg-border z-10" />
        <div 
          className={cn("absolute top-0 bottom-0 transition-all duration-500 rounded-full", color)} 
          style={{ 
            width: `${Math.abs(score) / 2}%`,
            left: score > 0 ? '50%' : `${50 - Math.abs(score) / 2}%`
          }} 
        />
      </div>
    </div>
  );
}
