import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetGlobalSourceStatus,
  getGetGlobalSourceStatusQueryKey,
  useDisableGlobalInstrument,
  useEnableGlobalInstrument,
  getGetGlobalDashboardQueryKey,
} from "@workspace/api-client-react";
import type {
  GlobalDeadCandidate,
  GlobalInstrumentOverride,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CheckCircle2, AlertTriangle, XCircle, Skull, EyeOff, RotateCcw } from "lucide-react";

const SOURCE_LABEL: Record<string, string> = {
  binance: "Binance (Crypto)",
  yahoo: "Yahoo (Commodities)",
  "yahoo-fx": "Yahoo (Forex)",
  "yahoo-equity": "Yahoo (Equities)",
  "yahoo-index": "Yahoo (Indices)",
};

function fmtAge(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

/**
 * Refresh both the status response (so the row leaves the dead-candidates
 * list and shows up under "Disabled") and any dashboard query (so the
 * disabled symbol's row disappears from whichever asset tab the user is
 * looking at). The dashboard cache key is parameterised by `?asset=`,
 * so we invalidate the prefix.
 */
function useInvalidateAfterMute() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: getGetGlobalSourceStatusQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetGlobalDashboardQueryKey().slice(0, 1) });
  };
}

function DisableButton({ symbol }: { symbol: string }) {
  const invalidate = useInvalidateAfterMute();
  const [pending, setPending] = useState(false);
  const { mutateAsync } = useDisableGlobalInstrument();
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs"
      disabled={pending}
      data-testid={`disable-${symbol}`}
      onClick={async (e) => {
        e.stopPropagation();
        setPending(true);
        try {
          await mutateAsync({ symbol, data: {} });
          invalidate();
        } finally {
          setPending(false);
        }
      }}
    >
      <EyeOff className="h-3 w-3 mr-1" />
      Disable
    </Button>
  );
}

function EnableButton({ symbol }: { symbol: string }) {
  const invalidate = useInvalidateAfterMute();
  const [pending, setPending] = useState(false);
  const { mutateAsync } = useEnableGlobalInstrument();
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs"
      disabled={pending}
      data-testid={`enable-${symbol}`}
      onClick={async (e) => {
        e.stopPropagation();
        setPending(true);
        try {
          await mutateAsync({ symbol });
          invalidate();
        } finally {
          setPending(false);
        }
      }}
    >
      <RotateCcw className="h-3 w-3 mr-1" />
      Re-enable
    </Button>
  );
}

/**
 * Pop-out panel listing per-instrument failure streaks for symbols that
 * have crossed `deadCandidateThreshold`, plus a "Disabled symbols"
 * section listing operator-muted instruments with a re-enable action.
 */
function DeadCandidatesPopover({
  candidates,
  threshold,
  disabled,
}: {
  candidates: GlobalDeadCandidate[];
  threshold: number;
  disabled: GlobalInstrumentOverride[];
}) {
  const total = candidates.length + disabled.length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Badge
          variant="destructive"
          className="gap-1.5 cursor-pointer font-mono"
          data-testid="dead-candidates-trigger"
        >
          <Skull className="h-3 w-3" />
          <span>
            {candidates.length} dead
            {disabled.length > 0 ? ` · ${disabled.length} muted` : ""}
          </span>
        </Badge>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[28rem] p-3 text-xs">
        {candidates.length > 0 && (
          <>
            <div className="font-semibold mb-1">Candidate dead symbols</div>
            <div className="text-muted-foreground mb-2">
              Failed ≥ {threshold} consecutive refresh cycles. Click{" "}
              <b>Disable</b> to mute them — refreshers skip them and the
              dashboard hides them until re-enabled.
            </div>
            <ul
              className="space-y-1 max-h-72 overflow-auto pr-1 mb-3"
              data-testid="dead-candidates-list"
            >
              {candidates.map((c) => (
                <li
                  key={c.symbol}
                  className="flex items-center justify-between gap-2 py-1 border-b border-border last:border-0"
                  data-testid={`dead-candidate-${c.symbol}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-mono font-medium truncate">{c.symbol}</div>
                    <div className="text-muted-foreground truncate">
                      {c.displayName} · {c.assetClass} · {c.source}
                    </div>
                    {c.lastError && (
                      <div className="text-destructive truncate" title={c.lastError}>
                        {c.lastError.slice(0, 120)}
                      </div>
                    )}
                  </div>
                  <Badge variant="outline" className="font-mono shrink-0">
                    ×{c.failureStreak}
                  </Badge>
                  <DisableButton symbol={c.symbol} />
                </li>
              ))}
            </ul>
          </>
        )}
        {disabled.length > 0 && (
          <>
            <div className="font-semibold mb-1">Disabled symbols</div>
            <div className="text-muted-foreground mb-2">
              Muted by an operator. Refreshers skip them and the dashboard
              hides them. Re-enable to bring them back into the rotation.
            </div>
            <ul
              className="space-y-1 max-h-72 overflow-auto pr-1"
              data-testid="disabled-instruments-list"
            >
              {disabled.map((d) => (
                <li
                  key={d.symbol}
                  className="flex items-center justify-between gap-2 py-1 border-b border-border last:border-0"
                  data-testid={`disabled-instrument-${d.symbol}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-mono font-medium truncate">{d.symbol}</div>
                    <div className="text-muted-foreground truncate">
                      Disabled{" "}
                      {d.disabledAt
                        ? new Date(d.disabledAt).toLocaleString()
                        : "—"}
                    </div>
                    {d.note && (
                      <div className="text-muted-foreground italic truncate" title={d.note}>
                        {d.note}
                      </div>
                    )}
                  </div>
                  <EnableButton symbol={d.symbol} />
                </li>
              ))}
            </ul>
          </>
        )}
        {total === 0 && (
          <div className="text-muted-foreground">No dead candidates or disabled symbols.</div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function StatusStrip() {
  const { data, isLoading } = useGetGlobalSourceStatus({
    query: { queryKey: getGetGlobalSourceStatusQueryKey(), refetchInterval: 30_000, refetchOnWindowFocus: false },
  });

  // B2.1-D7: Distinguish loading from error/empty — don't silently hide both.
  if (isLoading) {
    return (
      <span className="text-xs text-muted-foreground animate-pulse">Connecting to data sources…</span>
    );
  }
  if (!data) return null;

  const deadCandidates = data.deadCandidates ?? [];
  const disabledInstruments = data.disabledInstruments ?? [];
  const threshold = data.deadCandidateThreshold ?? 0;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {data.sources.map((s) => {
        const Icon = s.healthy ? CheckCircle2 : (s.lastOkAt ? AlertTriangle : XCircle);
        const color = s.healthy ? "text-emerald-600 dark:text-emerald-400"
                                : s.lastOkAt ? "text-amber-600 dark:text-amber-400"
                                : "text-destructive";
        return (
          <Tooltip key={s.source}>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="gap-1.5 cursor-help font-mono">
                <Icon className={`h-3 w-3 ${color}`} />
                <span>{SOURCE_LABEL[s.source] ?? s.source}</span>
                <span className="text-muted-foreground">{fmtAge(s.ageMs ?? null)}</span>
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <div className="text-xs space-y-1">
                <div><b>Last OK:</b> {s.lastOkAt ?? "never"}</div>
                <div><b>Last error:</b> {s.lastErrorAt ?? "—"}</div>
                {s.lastError && <div className="text-destructive">{s.lastError.slice(0, 200)}</div>}
                {s.notes && <div className="text-muted-foreground">{s.notes}</div>}
              </div>
            </TooltipContent>
          </Tooltip>
        );
      })}
      {(deadCandidates.length > 0 || disabledInstruments.length > 0) && (
        <DeadCandidatesPopover
          candidates={deadCandidates}
          threshold={threshold}
          disabled={disabledInstruments}
        />
      )}
      {/* B2.1-D6: null counts must show "?" — not 0 (which implies zero instruments). */}
      <span className="text-muted-foreground ml-2">
        Universe: {data.universeCounts.crypto ?? "?"} crypto · {data.universeCounts.commodity ?? "?"} commodities · {data.universeCounts.forex ?? "?"} forex · {data.universeCounts.equity ?? "?"} equities · {data.universeCounts.index ?? "?"} indices
      </span>
    </div>
  );
}
