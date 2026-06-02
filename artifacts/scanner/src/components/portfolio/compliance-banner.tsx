import { Info } from "lucide-react";

/**
 * SEBI-neutral disclosure shown at the top of the Portfolio Analyser.
 * This surface presents analytics, never investment advice.
 */
export function ComplianceBanner() {
  return (
    <div
      className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground"
      data-testid="compliance-banner"
    >
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-400" />
      <p>
        <span className="font-semibold text-foreground">Analytics, not advice.</span> This tool
        provides read-only portfolio analytics for your own review. Nothing here is a
        recommendation to buy, sell, or hold. Structure scores and action views are objective,
        explainable observations; price levels are shown only as technical zones, never as targets
        or stop-losses. Live prices are sourced from Zerodha Kite where available, otherwise from
        delayed Yahoo Finance. Verify all figures independently before acting.
      </p>
    </div>
  );
}
