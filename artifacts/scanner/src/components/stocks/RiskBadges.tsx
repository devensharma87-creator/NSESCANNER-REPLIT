/**
 * W2A — risk / status badge renderer for `/stocks-to-watch`.
 * Pure display of badges produced by `deriveRowBadges` (warnings[] +
 * purely-derived freshness/quote/trigger flags). No scoring logic.
 */
import type { RowBadge, BadgeTone } from "@/lib/stocksToWatchView";

const TONE_CLS: Record<BadgeTone, string> = {
  danger: "text-rose-500 border-rose-500/40 bg-rose-500/10",
  warn: "text-amber-500 border-amber-500/40 bg-amber-500/10",
  info: "text-sky-500 border-sky-500/40 bg-sky-500/10",
  muted: "text-muted-foreground border-border bg-muted/30",
  success: "text-emerald-500 border-emerald-500/40 bg-emerald-500/10",
};

export function RiskBadges({
  badges,
  max,
  className,
}: {
  badges: RowBadge[];
  max?: number;
  className?: string;
}) {
  if (!badges.length) return null;
  const shown = max != null ? badges.slice(0, max) : badges;
  const overflow = max != null ? badges.length - shown.length : 0;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className ?? ""}`}>
      {shown.map((b, i) => (
        <span
          key={`${b.label}-${i}`}
          className={`inline-flex px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-wide ${TONE_CLS[b.tone]}`}
          title={b.kind === "warning" ? "Backend warning" : "Derived status"}
        >
          {b.label}
        </span>
      ))}
      {overflow > 0 && (
        <span className="text-[10px] text-muted-foreground" title={badges.slice(max).map((b) => b.label).join(", ")}>
          +{overflow}
        </span>
      )}
    </span>
  );
}
