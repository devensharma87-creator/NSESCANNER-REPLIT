import { useGetNews, getGetNewsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Newspaper, ExternalLink } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";

const sentimentBadge: Record<string, string> = {
  positive: "text-signal-strong-buy border-signal-strong-buy/40 bg-signal-strong-buy/10",
  negative: "text-signal-strong-sell border-signal-strong-sell/40 bg-signal-strong-sell/10",
  neutral: "text-muted-foreground border-border bg-secondary/40",
};

export default function News() {
  const { data, isLoading } = useGetNews(undefined, {
    query: { refetchInterval: 60_000, queryKey: getGetNewsQueryKey() },
  });

  return (
    <div className="container max-w-3xl py-6 space-y-6">
      <div className="flex items-center gap-2">
        <Newspaper className="w-5 h-5 text-signal-strong-buy" />
        <h1 className="text-2xl font-bold font-mono tracking-tight">MARKET NEWS</h1>
      </div>
      <p className="text-sm text-muted-foreground -mt-2">
        A curated stream of market-moving headlines and sector commentary.
      </p>

      <div className="space-y-3">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)
        ) : (
          data?.map(item => (
            <Card key={item.id} className="hover:border-primary/30 transition-colors">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline inline-flex items-start gap-1.5">
                    <span>{item.title}</span>
                    <ExternalLink className="w-3.5 h-3.5 mt-1 shrink-0 text-muted-foreground" />
                  </a>
                  <Badge variant="outline" className={`shrink-0 font-mono text-[10px] uppercase ${sentimentBadge[item.sentiment ?? "neutral"]}`}>
                    {item.sentiment ?? "neutral"}
                  </Badge>
                </div>
                {item.summary && <p className="text-sm text-muted-foreground">{item.summary}</p>}
                <div className="flex items-center gap-3 text-[11px] font-mono text-muted-foreground uppercase tracking-wide">
                  <span>{item.source}</span>
                  <span>·</span>
                  <span>{formatDistanceToNow(new Date(item.publishedAt))} ago</span>
                  {item.symbol && <span className="px-1.5 py-0.5 bg-secondary/50 rounded border border-border text-foreground">{item.symbol}</span>}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
