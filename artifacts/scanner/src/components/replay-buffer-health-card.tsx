/**
 * ReplayBufferHealthCard — tiny ops widget on /audit.
 *
 * Reads `GET /api/replay/record/stats` on a 15s cadence and renders a
 * compact strip showing tick / chain / board / event counts in the
 * in-memory recorder ring buffer plus the wall-clock age of the
 * oldest tick. Purpose: eyeball whether the tap is actually flowing
 * without opening DevTools or curl-ing the endpoint.
 */
import { useQuery } from "@tanstack/react-query";

interface TapStats {
  tickCount: number;
  chainCount: number;
  boardCount: number;
  eventCount: number;
  oldestTickMs: number | null;
  newestTickMs: number | null;
}

function useTapStats() {
  return useQuery<TapStats>({
    queryKey: ["replay-record-stats"],
    queryFn: async () => {
      const res = await fetch("/api/replay/record/stats");
      if (!res.ok) throw new Error(`stats ${res.status}`);
      return res.json();
    },
    refetchInterval: 15_000,
    staleTime: 8_000,
  });
}

function ageLabel(ms: number | null): string {
  if (ms == null) return "—";
  const age = Date.now() - ms;
  if (age < 0) return "0s";
  if (age < 60_000) return `${Math.round(age / 1000)}s`;
  if (age < 3_600_000) return `${Math.round(age / 60_000)}m`;
  return `${(age / 3_600_000).toFixed(1)}h`;
}

export function ReplayBufferHealthCard() {
  const { data, isLoading, error } = useTapStats();

  const isHealthy = data != null && data.tickCount > 0 && data.newestTickMs != null
    && Date.now() - data.newestTickMs < 5 * 60_000;

  return (
    <div
      data-testid="replay-buffer-health-card"
      className="border border-border/70 rounded p-3 bg-secondary/10 font-mono text-xs space-y-2"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="font-bold uppercase tracking-wider text-[11px]">
          Recorder Buffer Health
        </div>
        {data && (
          <div
            data-testid="replay-buffer-health-status"
            className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border ${
              isHealthy
                ? "text-emerald-300 border-emerald-500/40 bg-emerald-500/10"
                : "text-amber-300 border-amber-500/40 bg-amber-500/10"
            }`}
          >
            {isHealthy ? "FLOWING" : "IDLE"}
          </div>
        )}
      </div>

      {isLoading && (
        <div className="text-muted-foreground">Loading buffer stats…</div>
      )}
      {error && (
        <div data-testid="replay-buffer-health-error" className="text-rose-300">
          {(error as Error).message}
        </div>
      )}

      {data && (
        <div className="grid grid-cols-4 gap-2 text-center">
          <StatBlock testId="ticks" label="ticks" value={data.tickCount} />
          <StatBlock testId="chains" label="chains" value={data.chainCount} />
          <StatBlock testId="boards" label="boards" value={data.boardCount} />
          <StatBlock testId="events" label="events" value={data.eventCount} />
        </div>
      )}

      {data && data.tickCount > 0 && (
        <div className="text-[10px] text-muted-foreground/80 flex justify-between pt-1 border-t border-border/40">
          <span>oldest tick: {ageLabel(data.oldestTickMs)} ago</span>
          <span>newest tick: {ageLabel(data.newestTickMs)} ago</span>
        </div>
      )}
    </div>
  );
}

function StatBlock({ testId, label, value }: { testId: string; label: string; value: number }) {
  return (
    <div
      data-testid={`replay-buffer-stat-${testId}`}
      className="border border-border/40 rounded px-1.5 py-1 bg-background/40"
    >
      <div className="text-lg font-bold tabular-nums">{value.toLocaleString()}</div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

export default ReplayBufferHealthCard;
