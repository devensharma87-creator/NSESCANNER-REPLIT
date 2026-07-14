/**
 * Display-only risk/status badges for F&O trades.
 *
 * Pure presentational: it renders the `FoBadge[]` produced by the accepted pure
 * helper `deriveFoRiskBadges` (in `foCockpitView.ts`). It derives NOTHING itself
 * — no trading logic, no signal inference, no strategy recompute.
 */
import type { FoBadge, FoBadgeTone } from "@/lib/foCockpitView";

const TONE_CLASS: Record<FoBadgeTone, string> = {
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  danger: "border-rose-500/30 bg-rose-500/10 text-rose-200",
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  info: "border-sky-500/30 bg-sky-500/10 text-sky-200",
  muted: "border-slate-600/50 bg-slate-700/30 text-slate-300",
};

export function FoRiskBadges({
  badges,
  className,
}: {
  badges: FoBadge[];
  className?: string;
}) {
  if (badges.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-1 ${className ?? ""}`}>
      {badges.map((b) => (
        <span
          key={`${b.kind}:${b.label}`}
          className={`rounded-full border px-2 py-0.5 text-[10px] font-medium leading-tight ${TONE_CLASS[b.tone]}`}
        >
          {b.label}
        </span>
      ))}
    </div>
  );
}
