import { useGetNews, getGetNewsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ExternalLink, Newspaper } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Link } from "wouter";
import type { NewsItem } from "@workspace/api-client-react";

const SENT_CLASS: Record<string, string> = {
  positive: "bg-signal-strong-buy/10 text-signal-strong-buy border-signal-strong-buy/30",
  negative: "bg-signal-strong-sell/10 text-signal-strong-sell border-signal-strong-sell/30",
  neutral: "bg-secondary/40 text-muted-foreground border-border/40",
};

function NewsRow({ item, defaultOpen = false }: { item: NewsItem; defaultOpen?: boolean }) {
  const sentiment = (item as unknown as { sentiment?: string }).sentiment ?? "neutral";
  const cls = SENT_CLASS[sentiment] ?? SENT_CLASS.neutral;
  return (
    <Collapsible defaultOpen={defaultOpen} className="border-b border-border/40 last:border-b-0">
      <CollapsibleTrigger className="group w-full flex items-start justify-between gap-3 py-3 text-left hover:bg-white/[0.02] px-1 -mx-1 rounded transition-colors">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70 mb-1">
            <span>{item.source}</span>
            <span aria-hidden="true">·</span>
            <span>{formatDistanceToNow(new Date(item.publishedAt))} ago</span>
            <span className={`ml-1 px-1.5 py-0.5 rounded border text-[9px] font-semibold ${cls}`}>{sentiment}</span>
          </div>
          <div className="text-sm font-semibold leading-snug text-foreground">{item.title}</div>
        </div>
        <ChevronDown className="w-4 h-4 mt-1 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="pb-3 pl-1 pr-1">
        {item.summary && <p className="text-sm text-muted-foreground leading-relaxed">{item.summary}</p>}
        <div className="flex items-center gap-3 mt-2 text-[11px] font-mono">
          {item.symbol && (
            <Link href={`/stock/${item.symbol}`} className="text-foreground hover:underline">
              View {item.symbol}
            </Link>
          )}
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              Read at {item.source} <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function MarketsNewsCard() {
  const { data, isLoading } = useGetNews(undefined, {
    query: { refetchInterval: 60_000, queryKey: getGetNewsQueryKey() },
  });
  const items: NewsItem[] = (data ?? []) as unknown as NewsItem[];
  const lead = items[0];
  const rest = items.slice(1, 8);

  return (
    <Card className="border-border">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-mono font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <Newspaper className="w-4 h-4" /> Markets News
          </h3>
          <Link href="/news" className="text-[11px] font-mono text-muted-foreground hover:text-foreground">
            All news →
          </Link>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-xs text-muted-foreground font-mono py-6 text-center">No news right now.</div>
        ) : (
          <>
            {lead && (
              <div className="mb-2">
                <NewsRow item={lead} defaultOpen />
              </div>
            )}
            {rest.map(it => <NewsRow key={it.id} item={it} />)}
          </>
        )}
      </CardContent>
    </Card>
  );
}
