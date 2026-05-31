/**
 * F&O cockpit safety / freshness banner (display-only).
 *
 * Renders fixed compliance lines, the P25 evidence-gate state, and a data
 * freshness verdict derived from the MTM-sweep diagnostics. This component
 * places NO orders, changes NO exit rule, and does not touch the P25 tracker
 * or its threshold — it only surfaces already-derived display state.
 */
import { Badge } from "@/components/ui/badge";
import {
  FO_SAFETY_STATIC_LINES,
  type P25Headline,
  type FoFreshnessState,
} from "@/lib/foCockpitView";

const fmtClock = (iso: string | null): string => {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  try {
    return new Date(ms).toLocaleTimeString("en-IN", {
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
  } catch {
    return "—";
  }
};

const FRESHNESS_TONE: Record<FoFreshnessState["level"], string> = {
  healthy: "bg-emerald-500/15 text-emerald-200 border-emerald-500/30",
  stale: "bg-amber-500/15 text-amber-200 border-amber-500/30",
  unknown: "bg-slate-500/15 text-slate-200 border-slate-500/30",
};

const FRESHNESS_LABEL: Record<FoFreshnessState["level"], string> = {
  healthy: "Data fresh",
  stale: "Data may be stale",
  unknown: "Freshness unknown",
};

export function FoCockpitSafetyBanner({
  p25,
  freshness,
}: {
  p25: P25Headline;
  freshness: FoFreshnessState;
}) {
  const lines = [
    ...FO_SAFETY_STATIC_LINES,
    p25.gateLabel,
    `P25 threshold unchanged at ${p25.threshold}`,
  ];

  return (
    <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
            F&amp;O Cockpit
          </span>
          <span className="text-[11px] text-muted-foreground">
            Evidence only — no live exit change approved
          </span>
        </div>
        <Badge variant="outline" className={FRESHNESS_TONE[freshness.level]}>
          {FRESHNESS_LABEL[freshness.level]}
        </Badge>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        {lines.map((line, i) => (
          <span key={line} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden className="text-slate-600">·</span>}
            <span className="text-[11px] text-muted-foreground">{line}</span>
          </span>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-1 gap-2 text-[11px] text-muted-foreground sm:grid-cols-3">
        <FreshnessStat label="Last MTM sweep" value={fmtClock(freshness.lastMtmSweepAt)} />
        <FreshnessStat label="Last open eval" value={fmtClock(freshness.lastOpenEvalAt)} />
        <FreshnessStat label="Last closed" value={fmtClock(freshness.lastClosedAt)} />
      </div>
    </div>
  );
}

function FreshnessStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-slate-800/40 px-2 py-1">
      <span className="uppercase tracking-wider text-slate-500">{label}</span>
      <span className="tabular-nums text-slate-300">{value}</span>
    </div>
  );
}
