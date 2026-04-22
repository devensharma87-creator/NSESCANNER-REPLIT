import { useGetNews, getGetNewsQueryKey, useGetMarketEvents, getGetMarketEventsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Newspaper, ExternalLink, CalendarDays, CalendarClock, Briefcase, Landmark, Flag, Globe } from "lucide-react";
import { formatDistanceToNow, format, parseISO, isToday, isTomorrow, differenceInCalendarDays } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const sentimentBadge: Record<string, string> = {
  positive: "text-signal-strong-buy border-signal-strong-buy/40 bg-signal-strong-buy/10",
  negative: "text-signal-strong-sell border-signal-strong-sell/40 bg-signal-strong-sell/10",
  neutral: "text-muted-foreground border-border bg-secondary/40",
};

const regionEmoji: Record<string, string> = {
  IN: "🇮🇳", US: "🇺🇸", UK: "🇬🇧", EU: "🇪🇺", JP: "🇯🇵", HK: "🇭🇰", CN: "🇨🇳", GLOBAL: "🌐",
};

const impactClass: Record<string, string> = {
  high:   "text-signal-strong-sell border-signal-strong-sell/50 bg-signal-strong-sell/10",
  medium: "text-amber-400 border-amber-500/40 bg-amber-500/10",
  low:    "text-muted-foreground border-border bg-secondary/40",
};

function fmtRel(dateStr: string) {
  const d = parseISO(dateStr);
  if (isToday(d)) return "Today";
  if (isTomorrow(d)) return "Tomorrow";
  const diff = differenceInCalendarDays(d, new Date());
  if (diff > 0 && diff <= 14) return `In ${diff} days`;
  if (diff < 0 && diff >= -3) return `${-diff}d ago`;
  return format(d, "EEE, dd MMM");
}

function fmtDayLabel(dateStr: string) {
  return format(parseISO(dateStr), "EEE, dd MMM yyyy");
}

function NewsList() {
  const { data, isLoading } = useGetNews(undefined, {
    query: { refetchInterval: 60_000, queryKey: getGetNewsQueryKey() },
  });
  return (
    <div className="space-y-3">
      {isLoading ? (
        Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-muted-foreground font-mono">No headlines yet.</p>
      ) : (
        data.map(item => (
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
  );
}

function HolidaysList() {
  const { data, isLoading } = useGetMarketEvents({
    query: { refetchInterval: 60 * 60 * 1000, queryKey: getGetMarketEventsQueryKey() },
  });
  if (isLoading) return <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>;
  const holidays = data?.holidays.upcoming ?? [];
  // Group by date
  const byDate = new Map<string, typeof holidays>();
  for (const h of holidays) {
    const arr = byDate.get(h.date) ?? [];
    arr.push(h);
    byDate.set(h.date, arr);
  }
  if (byDate.size === 0) return <p className="text-sm text-muted-foreground font-mono">No upcoming holidays in the next 90 days.</p>;
  return (
    <div className="space-y-3">
      {Array.from(byDate.entries()).map(([date, items]) => (
        <Card key={date}>
          <CardContent className="p-4">
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="font-mono font-bold text-sm">{fmtDayLabel(date)}</h3>
              <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">{fmtRel(date)}</span>
            </div>
            <div className="space-y-1.5">
              {items.map((h, i) => (
                <div key={`${h.exchange}-${i}`} className="flex items-center gap-2 text-sm">
                  <span className="text-base leading-none">{regionEmoji[h.region] ?? "🏳️"}</span>
                  <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/80 w-28 shrink-0">{h.exchange}</span>
                  <span className="text-foreground">{h.name}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function EarningsList() {
  const { data, isLoading } = useGetMarketEvents({
    query: { refetchInterval: 60 * 60 * 1000, queryKey: getGetMarketEventsQueryKey() },
  });
  if (isLoading) return <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>;
  const earnings = data?.earnings ?? [];
  if (earnings.length === 0) return <p className="text-sm text-muted-foreground font-mono">No upcoming earnings in the next 30 days. (Yahoo data may be warming up — refresh in a moment.)</p>;
  // Group by date
  const byDate = new Map<string, typeof earnings>();
  for (const e of earnings) {
    const arr = byDate.get(e.date) ?? [];
    arr.push(e);
    byDate.set(e.date, arr);
  }
  return (
    <div className="space-y-3">
      {Array.from(byDate.entries()).map(([date, items]) => (
        <Card key={date}>
          <CardContent className="p-4">
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="font-mono font-bold text-sm">{fmtDayLabel(date)}</h3>
              <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">{fmtRel(date)} · {items.length} {items.length === 1 ? "report" : "reports"}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
              {items.map((e) => (
                <div key={e.symbol} className="flex items-center justify-between gap-2 text-sm border border-border/50 rounded px-2.5 py-1.5 bg-background/40">
                  <div className="min-w-0">
                    <div className="font-bold font-mono text-[13px]">{e.symbol}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{e.name}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{e.source}</span>
                    {e.estimateEPS != null && (
                      <div className="text-[11px] font-mono tabular-nums text-foreground">est EPS {e.estimateEPS.toFixed(2)}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function EventsList() {
  const { data, isLoading } = useGetMarketEvents({
    query: { refetchInterval: 60 * 60 * 1000, queryKey: getGetMarketEventsQueryKey() },
  });
  if (isLoading) return <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>;
  const events = data?.events ?? [];
  if (events.length === 0) return <p className="text-sm text-muted-foreground font-mono">No upcoming central-bank or macro events in the next 90 days.</p>;
  return (
    <div className="space-y-2">
      {events.map((e, i) => (
        <Card key={`${e.date}-${i}`}>
          <CardContent className="p-3 flex items-center gap-3">
            <div className="text-2xl leading-none">{regionEmoji[e.region] ?? "🌐"}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="font-mono font-semibold text-sm">{e.name}</span>
                <Badge variant="outline" className={`text-[10px] uppercase font-mono ${impactClass[e.impact]}`}>{e.impact}</Badge>
                <Badge variant="outline" className="text-[10px] uppercase font-mono text-muted-foreground border-border bg-secondary/40">{e.category}</Badge>
              </div>
              {e.description && <div className="text-[11px] text-muted-foreground mt-0.5">{e.description}</div>}
            </div>
            <div className="text-right shrink-0">
              <div className="font-mono text-sm">{fmtDayLabel(e.date)}</div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{fmtRel(e.date)}</div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function MarketInfo() {
  return (
    <div className="container max-w-4xl py-6 space-y-6">
      <div className="flex items-center gap-2">
        <Newspaper className="w-5 h-5 text-signal-strong-buy" />
        <h1 className="text-2xl font-bold font-mono tracking-tight">MARKET INFO</h1>
      </div>
      <p className="text-sm text-muted-foreground -mt-2">
        Headlines, exchange holidays, earnings calendar, and central-bank &amp; macro events — domestic and global.
      </p>

      <Tabs defaultValue="news" className="w-full">
        <TabsList className="grid grid-cols-2 w-full max-w-md">
          <TabsTrigger value="news" className="font-mono text-xs uppercase gap-1.5">
            <Newspaper className="w-3.5 h-3.5" /> News Feed
          </TabsTrigger>
          <TabsTrigger value="calendar" className="font-mono text-xs uppercase gap-1.5">
            <CalendarClock className="w-3.5 h-3.5" /> Calendar
          </TabsTrigger>
        </TabsList>

        <TabsContent value="news" className="mt-5">
          <NewsList />
        </TabsContent>

        <TabsContent value="calendar" className="mt-5">
          <Tabs defaultValue="earnings" className="w-full">
            <TabsList className="grid grid-cols-3 w-full max-w-xl">
              <TabsTrigger value="earnings" className="font-mono text-xs uppercase gap-1.5">
                <Briefcase className="w-3.5 h-3.5" /> Earnings
              </TabsTrigger>
              <TabsTrigger value="holidays" className="font-mono text-xs uppercase gap-1.5">
                <CalendarDays className="w-3.5 h-3.5" /> Holidays
              </TabsTrigger>
              <TabsTrigger value="events" className="font-mono text-xs uppercase gap-1.5">
                <Landmark className="w-3.5 h-3.5" /> Events
              </TabsTrigger>
            </TabsList>

            <TabsContent value="earnings" className="mt-5 space-y-4">
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Flag className="w-3 h-3 text-signal-strong-buy" /> Indian + global mega-cap reports · next 30 days
              </div>
              <EarningsList />
            </TabsContent>

            <TabsContent value="holidays" className="mt-5 space-y-4">
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Globe className="w-3 h-3" /> NSE/BSE + global exchanges · next 90 days
              </div>
              <HolidaysList />
            </TabsContent>

            <TabsContent value="events" className="mt-5 space-y-4">
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Landmark className="w-3 h-3" /> RBI, Fed, ECB, BoE, BoJ + macro releases · next 90 days
              </div>
              <EventsList />
            </TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>
    </div>
  );
}
