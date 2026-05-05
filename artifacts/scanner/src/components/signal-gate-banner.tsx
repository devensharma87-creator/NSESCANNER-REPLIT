import { AlertTriangle, ShieldAlert, Activity, Layers } from "lucide-react";

/**
 * Phase-1 quality-gate status banner for the F&O signal page.
 *
 * Mirrors the `diagnostics.gates` block returned by the option-signals
 * endpoint so the user sees an honest, plain-English explanation when
 * the live tab is empty (or thinned out).  Without this, a session
 * with the circuit breaker tripped would just show "no signals" and
 * the user would assume the engine was broken instead of correctly
 * sitting on its hands after consecutive losses.
 *
 * Hidden entirely when no gate is active — keeps the dashboard quiet
 * on a normal day.
 */
export interface GateState {
  circuitBreakerActive?: boolean;
  stoppedToday?: number;
  stopLimit?: number;
  vixSpike?: boolean;
  vixIntradayPct?: number | null;
  vixDayPct?: number | null;
  vixSpikeReason?: string | null;
  correlationDroppedCount?: number;
  oiVetoCount?: number;
  staleExpiredCount?: number;
  notes?: string[];
}

export function SignalGateBanner({ gates }: { gates: GateState }) {
  const circuit = gates.circuitBreakerActive === true;
  const vix = gates.vixSpike === true;
  const corr = (gates.correlationDroppedCount ?? 0) > 0;
  const oi = (gates.oiVetoCount ?? 0) > 0;
  const stale = (gates.staleExpiredCount ?? 0) > 0;
  const hasNotes = (gates.notes?.length ?? 0) > 0;

  // Hide when nothing material is active. `staleExpiredCount` alone is
  // routine housekeeping and not worth a banner — only show it when
  // bundled with something more interesting.
  const anyMajor = circuit || vix || corr || oi || hasNotes;
  if (!anyMajor) return null;

  // Tone: red for any HARD suppression of new HC emission (circuit breaker
  // or VIX spike); amber otherwise.  Picks the most-severe palette so the
  // visual weight matches the actual session risk.
  const severe = circuit || vix;
  const palette = severe
    ? {
        border: "border-rose-500/40",
        bg: "bg-rose-500/10",
        text: "text-rose-300",
        chip: "bg-rose-500/20 text-rose-200 border-rose-500/40",
        title: "text-rose-200",
        Icon: ShieldAlert,
      }
    : {
        border: "border-amber-500/40",
        bg: "bg-amber-500/10",
        text: "text-amber-200",
        chip: "bg-amber-500/20 text-amber-100 border-amber-500/40",
        title: "text-amber-100",
        Icon: AlertTriangle,
      };

  const { Icon } = palette;

  return (
    <div
      className={`rounded-md border ${palette.border} ${palette.bg} px-3 py-2.5 text-xs font-mono`}
      data-testid="signal-gate-banner"
    >
      <div className="flex items-start gap-2.5">
        <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${palette.title}`} />
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className={`font-semibold ${palette.title}`}>
            {severe
              ? "Signal engine: hard suppression active"
              : "Signal engine: quality gates filtering this cycle"}
          </div>

          {/* Headline notes (verbatim from server). */}
          {hasNotes && (
            <ul className={`space-y-0.5 ${palette.text}`}>
              {gates.notes!.map((n, i) => (
                <li key={i} className="leading-snug">
                  · {n}
                </li>
              ))}
            </ul>
          )}

          {/* Compact chips for cycle-level counters. Only render the ones
              that actually fired so the row stays readable. */}
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {circuit && (
              <Chip className={palette.chip} icon={<ShieldAlert className="h-3 w-3" />}>
                circuit-breaker · {gates.stoppedToday ?? 0}/{gates.stopLimit ?? 2} stops today
              </Chip>
            )}
            {vix && (
              <Chip className={palette.chip} icon={<Activity className="h-3 w-3" />}>
                VIX spike
                {gates.vixIntradayPct != null && ` · intraday +${gates.vixIntradayPct.toFixed(1)}%`}
                {gates.vixDayPct != null && ` · day +${gates.vixDayPct.toFixed(1)}%`}
              </Chip>
            )}
            {corr && (
              <Chip className={palette.chip} icon={<Layers className="h-3 w-3" />}>
                correlated-cap dropped {gates.correlationDroppedCount}
              </Chip>
            )}
            {oi && (
              <Chip className={palette.chip} icon={<ShieldAlert className="h-3 w-3" />}>
                OI hard-veto · {gates.oiVetoCount} card(s)
              </Chip>
            )}
            {stale && (
              <Chip className={palette.chip} icon={<AlertTriangle className="h-3 w-3" />}>
                stale-trigger swept {gates.staleExpiredCount}
              </Chip>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Chip({
  children,
  icon,
  className = "",
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${className}`}
    >
      {icon}
      {children}
    </span>
  );
}
