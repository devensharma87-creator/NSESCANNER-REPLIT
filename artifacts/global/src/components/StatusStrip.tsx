import { useGetGlobalSourceStatus, getGetGlobalSourceStatusQueryKey } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

const SOURCE_LABEL: Record<string, string> = {
  binance: "Binance (Crypto)",
  yahoo: "Yahoo (Commodities)",
  "yahoo-fx": "Yahoo (Forex)",
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

export function StatusStrip() {
  const { data } = useGetGlobalSourceStatus({
    query: { queryKey: getGetGlobalSourceStatusQueryKey(), refetchInterval: 30_000, refetchOnWindowFocus: false },
  });

  if (!data) return null;

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
      <span className="text-muted-foreground ml-2">
        Universe: {data.universeCounts.crypto} crypto · {data.universeCounts.commodity} commodities · {data.universeCounts.forex} forex
      </span>
    </div>
  );
}
