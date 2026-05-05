import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, TrendingUp, TrendingDown, RefreshCw, Calendar, Newspaper } from "lucide-react";
import { format, formatDistanceToNow, parseISO } from "date-fns";

interface WatchSignal {
  symbol: string;
  name?: string;
  sector?: string;
  side: "watch" | "avoid";
  catalyst: string;
  confidence: number;
  headline: string;
  summary?: string;
  source: string;
  url: string;
  publishedAt: string;
  evidence: { headline: string; source: string; url: string; publishedAt: string }[];
}

interface Payload {
  asOf: string;
  lookbackHours: number;
  watch: WatchSignal[];
  avoid: WatchSignal[];
  scanned: number;
  matched: number;
  sources: { source: string; count: number }[];
}

async function fetchPayload(): Promise<Payload> {
  const r = await fetch("/api/stocks-to-watch", { credentials: "include" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function ConfidenceDots({ confidence }: { confidence: number }) {
  const dots = Math.max(1, Math.min(3, Math.round(confidence * 3)));
  return (
    <span className="inline-flex gap-0.5 ml-1.5 align-middle">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${i < dots ? "bg-current" : "bg-current/20"}`}
        />
      ))}
    </span>
  );
}

function SignalCard({ s }: { s: WatchSignal }) {
  const isWatch = s.side === "watch";
  const accent = isWatch
    ? "border-l-4 border-l-signal-strong-buy"
    : "border-l-4 border-l-signal-strong-sell";
  const tickerColor = isWatch ? "text-signal-strong-buy" : "text-signal-strong-sell";

  return (
    <Card className={`${accent} bg-card hover:bg-accent/40 transition-colors shadow-sm`}>
      <CardContent className="p-4 space-y-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Link
              href={`/stock/${s.symbol}`}
              className={`font-mono font-semibold text-base tracking-tight ${tickerColor} hover:underline`}
            >
              {s.symbol}
            </Link>
            {s.name && (
              <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                {s.name}{s.sector ? ` · ${s.sector}` : ""}
              </div>
            )}
          </div>
          <Badge
            variant="outline"
            className={`shrink-0 font-mono text-[10px] uppercase tracking-wider ${tickerColor} border-current/40 bg-current/5`}
          >
            {s.catalyst}
            <ConfidenceDots confidence={s.confidence} />
          </Badge>
        </div>

        <div className="text-[14px] leading-relaxed text-foreground/90">
          {s.headline}
        </div>

        <div className="flex items-center justify-between gap-2 pt-1.5 text-[11px] text-muted-foreground font-mono border-t border-border/40">
          <span className="truncate">
            {s.source} · {formatDistanceToNow(parseISO(s.publishedAt), { addSuffix: true })}
          </span>
          <a
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-foreground shrink-0 uppercase tracking-wider"
          >
            Read <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        {s.evidence.length > 1 && (
          <details className="text-[11px] text-muted-foreground pt-1">
            <summary className="cursor-pointer hover:text-foreground font-mono uppercase tracking-wider">
              +{s.evidence.length - 1} more headline{s.evidence.length - 1 > 1 ? "s" : ""}
            </summary>
            <ul className="mt-2 space-y-1.5 pl-3 border-l border-border/60">
              {s.evidence.slice(1).map((e, i) => (
                <li key={i}>
                  <a href={e.url} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
                    <span className="text-foreground/80">{e.headline}</span>
                    <span className="ml-1 opacity-60">· {e.source}</span>
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function ColumnHeader({ side, count }: { side: "watch" | "avoid"; count: number }) {
  const isWatch = side === "watch";
  return (
    <div
      className={`flex items-center gap-2 px-4 py-2.5 rounded-md font-mono text-sm font-semibold uppercase tracking-wider ${
        isWatch
          ? "text-signal-strong-buy bg-signal-strong-buy/10 border border-signal-strong-buy/30"
          : "text-signal-strong-sell bg-signal-strong-sell/10 border border-signal-strong-sell/30"
      }`}
    >
      {isWatch ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
      {isWatch ? "Green — Stocks to Watch" : "Red — Negative Catalyst Watchlist"}
      <span className="ml-auto text-xs opacity-80 font-mono">{count}</span>
    </div>
  );
}

export default function StocksToWatchPage() {
  const { data, isLoading, isFetching, error, refetch } = useQuery<Payload>({
    queryKey: ["stocks-to-watch"],
    queryFn: fetchPayload,
    refetchInterval: 5 * 60 * 1000, // every 5 min — backend cache is 30 min
    staleTime: 60 * 1000,
  });

  const today = new Date();
  const dateLabel = format(today, "EEEE · d MMM yyyy").toUpperCase();

  return (
    <div className="w-full px-4 lg:px-6 py-6 space-y-6">
      {/* Header band */}
      <div className="flex items-start justify-between gap-4 flex-wrap pb-4 border-b border-border">
        <div className="space-y-1.5 min-w-0">
          <h1 className="text-2xl lg:text-3xl font-bold font-mono tracking-tight flex items-center gap-2.5">
            <Calendar className="h-6 w-6 text-primary" />
            Stocks To Watch
          </h1>
          <p className="text-sm text-muted-foreground max-w-3xl leading-relaxed">
            Daily catalyst deck — NSE stocks with positive (orders, projects, beats, approvals) or negative (probes, downgrades, misses, recalls) news from the last {data?.lookbackHours ?? 24}h.
            {data && (
              <>
                {" "}Scanned <span className="font-mono text-foreground">{data.scanned}</span> headlines, matched <span className="font-mono text-foreground">{data.matched}</span> · last refresh {formatDistanceToNow(parseISO(data.asOf), { addSuffix: true })}.
              </>
            )}
          </p>
          <p className="text-[11px] text-muted-foreground font-mono uppercase tracking-wider">{dateLabel}</p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md border border-border bg-card hover:bg-accent font-mono text-xs uppercase tracking-wider disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">
            Couldn't load the catalyst deck — {(error as Error).message}. The news feeds may be temporarily unavailable; click Refresh to retry.
          </CardContent>
        </Card>
      )}

      {/* Two-column full-width grid: Watch | Avoid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* GREEN column */}
        <div className="space-y-3">
          <ColumnHeader side="watch" count={data?.watch.length ?? 0} />
          {isLoading && (
            <div className="space-y-3">
              {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full" />)}
            </div>
          )}
          {!isLoading && data?.watch.length === 0 && (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground text-center">
                No clear positive catalysts in the last {data.lookbackHours}h. Check back later — feeds refresh every 5 minutes.
              </CardContent>
            </Card>
          )}
          {data?.watch.map(s => <SignalCard key={`w-${s.symbol}`} s={s} />)}
        </div>

        {/* RED column */}
        <div className="space-y-3">
          <ColumnHeader side="avoid" count={data?.avoid.length ?? 0} />
          {isLoading && (
            <div className="space-y-3">
              {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full" />)}
            </div>
          )}
          {!isLoading && data?.avoid.length === 0 && (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground text-center">
                No clear negative catalysts in the last {data.lookbackHours}h.
              </CardContent>
            </Card>
          )}
          {data?.avoid.map(s => <SignalCard key={`a-${s.symbol}`} s={s} />)}
        </div>
      </div>

      {/* Sources strip */}
      {data && data.sources.length > 0 && (
        <Card className="bg-card/60">
          <CardContent className="p-3.5 flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground font-mono">
            <Newspaper className="h-3.5 w-3.5" />
            <span className="uppercase tracking-wider">Sources:</span>
            {data.sources.map(s => (
              <Badge key={s.source} variant="outline" className="text-[10px]">
                {s.source} <span className="opacity-60 ml-1">{s.count}</span>
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
