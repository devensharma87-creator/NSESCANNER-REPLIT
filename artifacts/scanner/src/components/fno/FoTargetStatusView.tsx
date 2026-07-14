/**
 * Read-only presentation of F&O target status (spot + premium) and any
 * spot↔premium divergence. Pure presentational — all classification is done
 * upstream by the accepted pure helpers in `@/lib/fno/targetStatus`. Renders
 * NOTHING that implies a trading action; "unknown" data shows an honest "?".
 */
import type {
  FoTargetStatus,
  TouchState,
} from "@/lib/fno/targetStatus";

const DASH = "—";

const TOUCH_CLASS: Record<TouchState, string> = {
  touched: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  not_touched: "border-slate-600/50 bg-slate-700/20 text-slate-400",
  unknown: "border-slate-600/40 bg-slate-700/10 text-slate-500",
};

const TOUCH_TEXT: Record<TouchState, string> = {
  touched: "✓",
  not_touched: "—",
  unknown: "?",
};

const TOUCH_TITLE: Record<TouchState, string> = {
  touched: "Reached",
  not_touched: "Not reached",
  unknown: "Unknown from available data",
};

function TouchChip({ label, state }: { label: string; state: TouchState }) {
  return (
    <span
      title={`${label}: ${TOUCH_TITLE[state]}`}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium leading-tight ${TOUCH_CLASS[state]}`}
    >
      {label} {TOUCH_TEXT[state]}
    </span>
  );
}

function fmt2(n: number | null): string {
  return n != null && Number.isFinite(n) ? n.toFixed(2) : DASH;
}

export function FoTargetStatusView({ status }: { status: FoTargetStatus }) {
  const { spot, premium, divergence } = status;
  const spotAvailable = spot.available;
  const premAvailable = premium.available;

  return (
    <div className="space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Target status
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Spot
        </span>
        {spotAvailable ? (
          <>
            <TouchChip label="T1" state={spot.target1} />
            <TouchChip label="T2" state={spot.target2} />
            {spot.peakSpot != null && (
              <span className="text-[10px] text-muted-foreground tabular-nums">
                peak {fmt2(spot.peakSpot)}
                {spot.peakSource === "last_spot" ? " (last)" : ""}
              </span>
            )}
          </>
        ) : (
          <span className="text-[10px] text-muted-foreground">
            spot lifecycle unavailable
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Premium
        </span>
        {premAvailable ? (
          <>
            <TouchChip label="T1" state={premium.target1} />
            <TouchChip label="T2" state={premium.target2} />
            <TouchChip label="Stop" state={premium.stop} />
            {premium.peakPremium != null && (
              <span className="text-[10px] text-muted-foreground tabular-nums">
                peak {fmt2(premium.peakPremium)}
              </span>
            )}
            {premium.givebackPremium != null && premium.givebackPremium > 0 && (
              <span
                className="text-[10px] text-amber-300/90 tabular-nums"
                title="Premium given back from peak to the current/exit mark"
              >
                giveback {fmt2(premium.givebackPremium)}
              </span>
            )}
          </>
        ) : (
          <span className="text-[10px] text-muted-foreground">
            premium plan unavailable
          </span>
        )}
      </div>

      {divergence.warn && divergence.message && (
        <p className="rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-[10px] leading-relaxed text-amber-200">
          ⚠ {divergence.message}
        </p>
      )}
    </div>
  );
}
