/**
 * Ops summary widget — bucketed chart of `/api/observability/summary`.
 *
 * Purpose: eyeball chip-downgrade spikes without tailing pino. Reads
 * the public summary endpoint on a 30s cadence, renders:
 *
 *   • Top-line: total degradations vs recoveries in window.
 *   • Sparkline over minute buckets — degradations red, recoveries green.
 *   • Ranked list of the top-5 chipIds by degradation count.
 *
 * Zero dependencies beyond the existing scanner deps (react-query is
 * already the app's fetch layer). The panel is small enough to embed
 * in `/admin` or `/audit`; owner picks the mount point later.
 */
import { useQuery } from "@tanstack/react-query";

interface ClientEventBucket {
  bucketStart: string;
  total: number;
  degradations: number;
  recoveries: number;
}

interface ClientEventSummary {
  windowStart: string;
  windowEnd: string;
  bucketCount: number;
  totalEvents: number;
  totalDegradations: number;
  totalRecoveries: number;
  buckets: ClientEventBucket[];
  topDegradingChips: Array<{ chipId: string; degradations: number }>;
}

function useObservabilitySummary(windowMinutes: number = 60) {
  return useQuery<ClientEventSummary>({
    queryKey: ["observability-summary", windowMinutes],
    queryFn: async () => {
      const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
      const res = await fetch(
        `/api/observability/summary?since=${encodeURIComponent(since)}`,
      );
      if (!res.ok) throw new Error(`summary ${res.status}`);
      return res.json();
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

/** IST HH:mm from the bucketStart ISO string (which already carries +05:30). */
function bucketLabel(iso: string): string {
  const m = /T(\d{2}):(\d{2}):00/.exec(iso);
  return m ? `${m[1]}:${m[2]}` : "";
}

/** Renders one bucket as a two-tier stacked column: red top = degradations,
 *  green bottom = recoveries. Height scales to the max bucket in the window. */
function BucketColumn({ b, maxTotal }: { b: ClientEventBucket; maxTotal: number }) {
  const scale = maxTotal > 0 ? 40 / maxTotal : 0;
  const degH = Math.round(b.degradations * scale);
  const recH = Math.round(b.recoveries * scale);
  return (
    <div
      data-testid={`obs-summary-bucket-${b.bucketStart}`}
      className="flex flex-col items-center justify-end gap-0.5 w-4"
      title={`${bucketLabel(b.bucketStart)} IST — ${b.degradations} degradation(s), ${b.recoveries} recovery(ies)`}
    >
      <div className="w-full bg-rose-500/70" style={{ height: `${degH}px` }} />
      <div className="w-full bg-emerald-500/70" style={{ height: `${recH}px` }} />
    </div>
  );
}

export function ObservabilitySummaryCard({ windowMinutes = 60 }: { windowMinutes?: number }) {
  const { data, isLoading, error } = useObservabilitySummary(windowMinutes);

  return (
    <div
      data-testid="observability-summary-card"
      className="border border-border/70 rounded p-3 bg-secondary/10 font-mono text-xs space-y-2"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="font-bold uppercase tracking-wider text-[11px]">
          Chip Downgrade Volume · last {windowMinutes}m
        </div>
        {data && (
          <div className="flex items-center gap-3">
            <span data-testid="obs-summary-degradations" className="text-rose-300">
              {data.totalDegradations} DEG
            </span>
            <span data-testid="obs-summary-recoveries" className="text-emerald-300">
              {data.totalRecoveries} REC
            </span>
            <span className="text-muted-foreground">
              {data.totalEvents} total
            </span>
          </div>
        )}
      </div>

      {isLoading && (
        <div className="text-muted-foreground">Loading summary…</div>
      )}
      {error && (
        <div data-testid="obs-summary-error" className="text-rose-300">
          Summary query failed: {(error as Error).message}
        </div>
      )}

      {data && data.buckets.length === 0 && (
        <div data-testid="obs-summary-empty" className="text-muted-foreground">
          No chip transitions observed in this window.
        </div>
      )}

      {data && data.buckets.length > 0 && (
        <div className="flex items-end gap-0.5 h-12" data-testid="obs-summary-chart">
          {(() => {
            const maxTotal = data.buckets.reduce(
              (m, b) => Math.max(m, b.degradations + b.recoveries),
              0,
            );
            return data.buckets.map((b) => (
              <BucketColumn key={b.bucketStart} b={b} maxTotal={maxTotal} />
            ));
          })()}
        </div>
      )}

      {data && data.topDegradingChips.length > 0 && (
        <div className="pt-1 border-t border-border/40">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
            Top degrading chips
          </div>
          <ul className="space-y-0.5" data-testid="obs-summary-top-chips">
            {data.topDegradingChips.map((c) => (
              <li key={c.chipId} className="flex justify-between">
                <span>{c.chipId}</span>
                <span className="text-rose-300">{c.degradations}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default ObservabilitySummaryCard;
