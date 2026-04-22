import { Badge } from "@/components/ui/badge";
import { Signal, ListStocksSignal } from "@workspace/api-client-react";

type SignalType = Signal | ListStocksSignal;

export function SignalBadge({ signal, className }: { signal: SignalType, className?: string }) {
  const getSignalConfig = (s: SignalType) => {
    switch (s) {
      case "STRONG_BUY": return { bg: "bg-signal-strong-buy", text: "text-white", label: "STRONG BUY" };
      case "BUY": return { bg: "bg-signal-buy", text: "text-white", label: "BUY" };
      case "SELL": return { bg: "bg-signal-sell", text: "text-white", label: "SELL" };
      case "STRONG_SELL": return { bg: "bg-signal-strong-sell", text: "text-white", label: "STRONG SELL" };
      case "NEUTRAL":
      default: return { bg: "bg-signal-neutral", text: "text-secondary-foreground", label: "NEUTRAL" };
    }
  };

  const config = getSignalConfig(signal);

  return (
    <Badge variant="outline" className={`${config.bg} ${config.text} border-transparent font-mono text-[10px] tracking-wide uppercase px-2 py-0.5 rounded ${className || ""}`}>
      {config.label}
    </Badge>
  );
}
