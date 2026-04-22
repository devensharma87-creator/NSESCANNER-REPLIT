import { Link } from "wouter";
import { Briefcase, CalendarDays, Landmark, Play, Pause } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useMemo, type ReactNode } from "react";
import { useGetMarketEvents, getGetMarketEventsQueryKey } from "@workspace/api-client-react";
import { format, parseISO, isToday, isTomorrow, differenceInCalendarDays } from "date-fns";

const regionEmoji: Record<string, string> = {
  india: "🇮🇳", us: "🇺🇸", uk: "🇬🇧", eu: "🇪🇺", japan: "🇯🇵",
  china: "🇨🇳", hongkong: "🇭🇰", singapore: "🇸🇬", australia: "🇦🇺", global: "🌐",
};

const impactTone: Record<string, string> = {
  high: "text-signal-strong-sell",
  medium: "text-amber-400",
  low: "text-muted-foreground",
};

function relLabel(d: string) {
  try {
    const date = parseISO(d);
    if (isToday(date)) return "TODAY";
    if (isTomorrow(date)) return "TOMORROW";
    const diff = differenceInCalendarDays(date, new Date());
    if (diff > 0 && diff < 7) return `IN ${diff}D`;
    return format(date, "dd MMM").toUpperCase();
  } catch {
    return d;
  }
}

function MarqueeBar({
  label, icon: Icon, accent, items, isLoading, durationSec, hrefAll,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  items: ReactNode[];
  isLoading: boolean;
  durationSec: number;
  hrefAll: string;
}) {
  const [playing, setPlaying] = useState(true);
  const animName = `marquee-${label.toLowerCase()}`;
  return (
    <div className="border-b border-border bg-card/40">
      <style>{`
        @keyframes ${animName} {
          from { transform: translate3d(0, 0, 0); }
          to   { transform: translate3d(-50%, 0, 0); }
        }
        .${animName}-track {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          animation: ${animName} ${durationSec}s linear infinite;
          will-change: transform;
        }
        .${animName}-track[data-paused="true"] { animation-play-state: paused; }
        .${animName}-viewport:hover .${animName}-track { animation-play-state: paused; }
      `}</style>
      <div className="w-full px-4 py-3 flex items-center gap-3">
        <Link
          href={hrefAll}
          className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground flex items-center gap-1.5 shrink-0 font-semibold"
          title={`View all ${label.toLowerCase()}`}
        >
          <Icon className={`w-3.5 h-3.5 ${accent}`} /> {label}
        </Link>

        <button
          type="button"
          onClick={() => setPlaying(p => !p)}
          aria-label={playing ? `Pause ${label} ticker` : `Play ${label} ticker`}
          title={playing ? "Pause ticker" : "Play ticker"}
          className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded border border-border/60 bg-background/40 hover:bg-background/80 text-muted-foreground hover:text-foreground transition-colors"
        >
          {playing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
        </button>

        <div className={`${animName}-viewport flex-1 min-w-0 overflow-hidden whitespace-nowrap`}>
          {isLoading ? (
            <div className="flex items-center gap-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-6 w-40 shrink-0" />)}
            </div>
          ) : items.length === 0 ? (
            <span className="text-xs text-muted-foreground font-mono">No upcoming {label.toLowerCase()}</span>
          ) : (
            <div className={`${animName}-track`} data-paused={!playing}>
              <div className="flex items-center gap-2 shrink-0">{items}</div>
              <div className="flex items-center gap-2 shrink-0" aria-hidden="true">{items}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function EventsMarquee() {
  const { data, isLoading } = useGetMarketEvents({
    query: { refetchInterval: 60 * 60 * 1000, queryKey: getGetMarketEventsQueryKey() },
  });

  const earningsItems = useMemo(() => {
    const arr = (data?.earnings ?? []).slice(0, 24);
    return arr.map((e, i) => (
      <span key={`er-${e.symbol}-${i}`} className="inline-flex items-baseline gap-1.5 px-3 py-1.5 rounded border border-border/50 bg-background/40 text-sm font-mono shrink-0">
        <span className="text-[10px] font-mono uppercase tracking-wider text-signal-strong-buy font-semibold">{relLabel(e.date)}</span>
        <span className="font-bold tabular-nums text-[12px]">{e.symbol}</span>
        <span className="text-muted-foreground text-[11px] truncate max-w-[160px]">{e.name}</span>
        {e.estimateEPS != null && (
          <span className="text-[10px] font-mono text-muted-foreground/80 border-l border-border/40 pl-1.5">
            est <span className="text-foreground tabular-nums">{e.estimateEPS.toFixed(2)}</span>
          </span>
        )}
      </span>
    ));
  }, [data]);

  const holidayItems = useMemo(() => {
    const arr = (data?.holidays.upcoming ?? []).slice(0, 24);
    return arr.map((h, i) => (
      <span key={`hd-${h.exchange}-${i}`} className="inline-flex items-baseline gap-1.5 px-3 py-1.5 rounded border border-border/50 bg-background/40 text-sm font-mono shrink-0">
        <span className="text-[10px] font-mono uppercase tracking-wider text-amber-400 font-semibold">{relLabel(h.date)}</span>
        <span className="text-base leading-none translate-y-[1px]">{regionEmoji[h.region] ?? "🏳️"}</span>
        <span className="font-bold text-[11px] uppercase tracking-wider text-muted-foreground">{h.exchange}</span>
        <span className="text-foreground text-[12px] truncate max-w-[200px]">{h.name}</span>
      </span>
    ));
  }, [data]);

  const eventItems = useMemo(() => {
    const arr = (data?.events ?? []).slice(0, 24);
    return arr.map((e, i) => (
      <span key={`ev-${e.date}-${i}`} className="inline-flex items-baseline gap-1.5 px-3 py-1.5 rounded border border-border/50 bg-background/40 text-sm font-mono shrink-0">
        <span className="text-[10px] font-mono uppercase tracking-wider text-blue-400 font-semibold">{relLabel(e.date)}</span>
        <span className="text-base leading-none translate-y-[1px]">{regionEmoji[e.region] ?? "🌐"}</span>
        <span className="font-bold text-[12px] truncate max-w-[260px]">{e.name}</span>
        <span className={`text-[10px] font-mono uppercase tracking-wider ${impactTone[e.impact] ?? "text-muted-foreground"}`}>
          ● {e.impact}
        </span>
      </span>
    ));
  }, [data]);

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <MarqueeBar
        label="EARNINGS"
        icon={Briefcase}
        accent="text-signal-strong-buy"
        items={earningsItems}
        isLoading={isLoading}
        durationSec={120}
        hrefAll="/news"
      />
      <MarqueeBar
        label="HOLIDAY"
        icon={CalendarDays}
        accent="text-amber-400"
        items={holidayItems}
        isLoading={isLoading}
        durationSec={110}
        hrefAll="/news"
      />
      <MarqueeBar
        label="EVENTS"
        icon={Landmark}
        accent="text-blue-400"
        items={eventItems}
        isLoading={isLoading}
        durationSec={130}
        hrefAll="/news"
      />
    </div>
  );
}
