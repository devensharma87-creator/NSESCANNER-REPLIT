import { useGetMarketSummary, getGetMarketSummaryQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { TrendingUp, TrendingDown, Flag, Play, Pause, ExternalLink } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useMemo, useState } from "react";

function fmtIN(n: number) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function rangePct(v: number, lo: number, hi: number) {
  if (hi <= lo) return 50;
  return Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: "buy" | "sell" }) {
  const cls = tone === "buy" ? "text-signal-strong-buy" : tone === "sell" ? "text-signal-strong-sell" : "";
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60">{label}</div>
      <div className={`tabular-nums font-semibold ${cls}`}>{value}</div>
    </div>
  );
}

function RangeBar({ value, lo, hi, label }: { value: number; lo: number; hi: number; label: string }) {
  const pct = rangePct(value, lo, hi);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-[10px] font-mono uppercase text-muted-foreground/70 tracking-wider">
        <span>{label}</span>
        <span>{fmtIN(lo)} – {fmtIN(hi)}</span>
      </div>
      <div className="relative h-1.5 rounded-full bg-muted/40">
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-foreground border-2 border-background"
          style={{ left: `calc(${pct}% - 5px)` }}
        />
      </div>
    </div>
  );
}

interface IndianIdx {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  open?: number;
  high?: number;
  low?: number;
  previousClose?: number;
  trend?: "bullish" | "bearish" | "neutral";
  region?: string;
  constituentSlug?: string;
  breadth?: { advancers: number; decliners: number; unchanged?: number; adRatio?: number | null };
}

function IndianHoverCard({ idx }: { idx: IndianIdx }) {
  const up = idx.change >= 0;
  const tone = up ? "text-signal-strong-buy" : "text-signal-strong-sell";
  const slug = idx.constituentSlug;

  const innerContent = (
    <>
      <span className="text-muted-foreground text-[12px] font-semibold uppercase tracking-wide">{idx.name}</span>
      <span className="font-bold tabular-nums text-[14px]">{fmtIN(idx.price)}</span>
      <span className={`tabular-nums text-[12px] font-semibold ${tone}`}>
        {up ? <TrendingUp className="inline w-3 h-3" /> : <TrendingDown className="inline w-3 h-3" />}
        <span className="ml-0.5">{idx.changePercent > 0 ? "+" : ""}{idx.changePercent.toFixed(2)}%</span>
      </span>
      {idx.breadth && (
        <span className="text-[10px] font-mono text-muted-foreground/80 ml-1 border-l border-border/40 pl-1.5">
          <span className="text-signal-strong-buy">▲{idx.breadth.advancers}</span>
          <span className="mx-0.5">/</span>
          <span className="text-signal-strong-sell">▼{idx.breadth.decliners}</span>
        </span>
      )}
    </>
  );

  const triggerClass = "inline-flex items-baseline gap-1.5 px-3 py-1.5 rounded border border-border/50 bg-background/40 hover:bg-background/80 hover:border-border transition-colors text-sm font-mono shrink-0 focus:outline-none focus:ring-1 focus:ring-ring";

  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        {slug ? (
          <Link href={`/index/${slug}`} className={triggerClass} aria-label={`Open ${idx.name} constituents`}>
            {innerContent}
          </Link>
        ) : (
          <button type="button" className={triggerClass} aria-label={`${idx.name} details`}>
            {innerContent}
          </button>
        )}
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-80 p-0" sideOffset={6}>
        <div className="p-4 space-y-3">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
                {idx.region ?? "India"} · {idx.symbol}
              </div>
              <div className="text-base font-mono font-bold leading-tight">{idx.name}</div>
            </div>
            {idx.trend && (
              <span className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded border ${
                idx.trend === "bullish" ? "border-signal-strong-buy/40 text-signal-strong-buy bg-signal-strong-buy/10" :
                idx.trend === "bearish" ? "border-signal-strong-sell/40 text-signal-strong-sell bg-signal-strong-sell/10" :
                "border-border text-muted-foreground"
              }`}>{idx.trend}</span>
            )}
          </div>

          {/* Price */}
          <div className="flex items-baseline gap-3">
            <span className="font-mono font-bold text-2xl tabular-nums">{fmtIN(idx.price)}</span>
            <span className={`font-mono text-sm tabular-nums font-semibold ${tone}`}>
              {idx.change > 0 ? "+" : ""}{fmtIN(idx.change)} ({idx.changePercent > 0 ? "+" : ""}{idx.changePercent.toFixed(2)}%)
            </span>
          </div>

          {/* OHLC grid */}
          <div className="grid grid-cols-4 gap-2 text-[11px] font-mono pt-1 border-t border-border/40">
            <Cell label="Open" value={idx.open != null ? fmtIN(idx.open) : "—"} />
            <Cell label="High" value={idx.high != null ? fmtIN(idx.high) : "—"} tone="buy" />
            <Cell label="Low" value={idx.low != null ? fmtIN(idx.low) : "—"} tone="sell" />
            <Cell label="Prev" value={idx.previousClose != null ? fmtIN(idx.previousClose) : "—"} />
          </div>

          {/* Day range bar */}
          {idx.high != null && idx.low != null && idx.high > idx.low && (
            <RangeBar value={idx.price} lo={idx.low} hi={idx.high} label="Day Range" />
          )}

          {/* Breadth */}
          {idx.breadth && (idx.breadth.advancers + idx.breadth.decliners > 0) && (
            <div className="pt-1 border-t border-border/40">
              <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70 mb-1.5">
                <span>Constituent Breadth</span>
                {idx.breadth.adRatio != null && (
                  <span>A/D {idx.breadth.adRatio.toFixed(2)}</span>
                )}
              </div>
              <BreadthBar a={idx.breadth.advancers} d={idx.breadth.decliners} u={idx.breadth.unchanged ?? 0} />
              <div className="flex items-center justify-between text-[10px] font-mono mt-1">
                <span className="text-signal-strong-buy">▲ {idx.breadth.advancers} adv</span>
                <span className="text-muted-foreground/70">● {idx.breadth.unchanged ?? 0} unch</span>
                <span className="text-signal-strong-sell">▼ {idx.breadth.decliners} dec</span>
              </div>
            </div>
          )}

          {/* Action row */}
          <div className="flex items-center justify-between text-[11px] font-mono pt-1 border-t border-border/40">
            {slug ? (
              <Link
                href={`/index/${slug}`}
                className="inline-flex items-center gap-1 text-primary hover:text-foreground"
              >
                Open constituents <ExternalLink className="w-3 h-3" />
              </Link>
            ) : <span />}
            <a
              href={`https://finance.yahoo.com/quote/${encodeURIComponent(idx.symbol)}`}
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              Yahoo Finance <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function BreadthBar({ a, d, u }: { a: number; d: number; u: number }) {
  const total = Math.max(1, a + d + u);
  const aPct = (a / total) * 100;
  const uPct = (u / total) * 100;
  const dPct = (d / total) * 100;
  return (
    <div className="flex h-1.5 rounded-full overflow-hidden bg-muted/40">
      <div className="bg-signal-strong-buy" style={{ width: `${aPct}%` }} />
      <div className="bg-muted-foreground/40" style={{ width: `${uPct}%` }} />
      <div className="bg-signal-strong-sell" style={{ width: `${dPct}%` }} />
    </div>
  );
}

export default function IndianStrip() {
  const { data, isLoading } = useGetMarketSummary({
    query: { refetchInterval: 30000, queryKey: getGetMarketSummaryQueryKey() },
  });
  const [playing, setPlaying] = useState(true);

  const items = useMemo(() => (data?.indices ?? []) as unknown as IndianIdx[], [data]);

  const blocks = items.map(idx => <IndianHoverCard key={idx.symbol} idx={idx} />);
  const statusBadge = data ? (
    <span key="status" className="ml-2 px-2 py-0.5 bg-secondary/40 rounded text-[10px] font-mono uppercase border border-border font-semibold text-muted-foreground shrink-0">
      {data.marketStatus || "—"}
    </span>
  ) : null;
  const trackChildren = statusBadge ? [...blocks, statusBadge] : blocks;

  return (
    <div className="border-b border-border bg-card/60">
      <style>{`
        @keyframes india-strip-marquee {
          from { transform: translate3d(0, 0, 0); }
          to   { transform: translate3d(-50%, 0, 0); }
        }
        .india-strip-track {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          animation: india-strip-marquee 90s linear infinite;
          will-change: transform;
        }
        .india-strip-track[data-paused="true"] { animation-play-state: paused; }
        .india-strip-viewport:hover .india-strip-track { animation-play-state: paused; }
      `}</style>
      <div className="w-full px-4 py-3 flex items-center gap-3">
        <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1.5 shrink-0 font-semibold">
          <Flag className="w-3.5 h-3.5 text-signal-strong-buy" /> INDIA
        </span>

        <button
          type="button"
          onClick={() => setPlaying(p => !p)}
          aria-label={playing ? "Pause India indices ticker" : "Play India indices ticker"}
          title={playing ? "Pause ticker" : "Play ticker"}
          className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded border border-border/60 bg-background/40 hover:bg-background/80 text-muted-foreground hover:text-foreground transition-colors"
        >
          {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        </button>

        <div className="india-strip-viewport flex-1 min-w-0 overflow-hidden whitespace-nowrap">
          {isLoading ? (
            <div className="flex items-center gap-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-7 w-32 shrink-0" />)}
            </div>
          ) : blocks.length === 0 ? (
            <span className="text-xs text-muted-foreground">No data</span>
          ) : (
            <div className="india-strip-track" data-paused={!playing}>
              <div className="flex items-center gap-2 shrink-0">{trackChildren}</div>
              <div className="flex items-center gap-2 shrink-0" aria-hidden="true">{trackChildren}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
