import { Badge } from "@/components/ui/badge";
import { Signal, ListStocksSignal } from "@workspace/api-client-react";

type SignalType = Signal | ListStocksSignal;

export function SignalBadge({
  signal,
  className,
  reason,
}: {
  signal: SignalType;
  className?: string;
  /** Optional machine-readable reason (e.g. setupMessage) shown as tooltip on NOT_EVALUATED. */
  reason?: string | null;
}) {
  // Display labels intentionally avoid imperative "BUY"/"SELL" wording.
  // The internal enum (used by API, DB schema and paper-trading history)
  // remains STRONG_BUY/BUY/SELL/STRONG_SELL/NEUTRAL — only the user-facing
  // text is reframed as a SIGNAL classification, not an instruction.
  const getSignalConfig = (s: SignalType) => {
    switch (s) {
      case "STRONG_BUY": return { bg: "bg-signal-strong-buy", text: "text-white", label: "STRONG BULLISH" };
      case "BUY": return { bg: "bg-signal-buy", text: "text-white", label: "BULLISH" };
      case "SELL": return { bg: "bg-signal-sell", text: "text-white", label: "BEARISH" };
      case "STRONG_SELL": return { bg: "bg-signal-strong-sell", text: "text-white", label: "STRONG BEARISH" };
      case "NOT_EVALUATED":
        return { bg: "bg-muted", text: "text-muted-foreground", label: "NOT EVALUATED" };
      case "NEUTRAL":
      default: return { bg: "bg-signal-neutral", text: "text-secondary-foreground", label: "NEUTRAL" };
    }
  };

  const config = getSignalConfig(signal);
  // Show the machine-readable reason as a browser-native tooltip on NOT_EVALUATED rows.
  const title = signal === "NOT_EVALUATED" && reason ? reason : undefined;

  return (
    <Badge
      variant="outline"
      title={title}
      className={`${config.bg} ${config.text} border-transparent font-mono text-[10px] tracking-wide uppercase px-2 py-0.5 rounded ${className || ""}`}
    >
      {config.label}
    </Badge>
  );
}
