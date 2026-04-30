import { useGetGlobalSourceStatus, getGetGlobalSourceStatusQueryKey } from "@workspace/api-client-react";
import type { GlobalDeadCandidate } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CheckCircle2, AlertTriangle, XCircle, Skull } from "lucide-react";

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
 * Pop-out panel listing per-instrument failure streaks for symbols that
 * have crossed `deadCandidateThreshold`. The list mirrors the
 * `/global/status` server payload and is intended to be copy-pasteable
 * directly into the operator's review of `universe.ts`.
 */
function DeadCandidatesPopover({
  candidates,
  threshold,
}: {
  candidates: GlobalDeadCandidate[];
  threshold: number;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Badge
          variant="destructive"
          className="gap-1.5 cursor-pointer font-mono"
          data-testid="dead-candidates-trigger"
        >
          <Skull className="h-3 w-3" />
          <span>{candidates.length} dead</span>
        </Badge>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-3 text-xs">
        <div className="font-semibold mb-1">Candidate dead symbols</div>
        <div className="text-muted-foreground mb-2">
          Failed ≥ {threshold} consecutive refresh cycles. Likely delisted upstream — review and prune from{" "}
          <code className="font-mono">universe.ts</code>.
        </div>
        <ul
          className="space-y-1 max-h-80 overflow-auto pr-1"
          data-testid="dead-candidates-list"
        >
          {candidates.map((c) => (
            <li
              key={c.symbol}
              className="flex items-center justify-between gap-2 py-1 border-b border-border last:border-0"
              data-testid={`dead-candidate-${c.symbol}`}
            >
              <div className="min-w-0">
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
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export function StatusStrip() {
  const { data } = useGetGlobalSourceStatus({
    query: { queryKey: getGetGlobalSourceStatusQueryKey(), refetchInterval: 30_000, refetchOnWindowFocus: false },
  });

  if (!data) return null;

  const deadCandidates = data.deadCandidates ?? [];
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
      {deadCandidates.length > 0 && (
        <DeadCandidatesPopover candidates={deadCandidates} threshold={threshold} />
      )}
      <span className="text-muted-foreground ml-2">
        Universe: {data.universeCounts.crypto} crypto · {data.universeCounts.commodity} commodities · {data.universeCounts.forex} forex · {data.universeCounts.equity ?? 0} equities · {data.universeCounts.index ?? 0} indices
      </span>
    </div>
  );
}
