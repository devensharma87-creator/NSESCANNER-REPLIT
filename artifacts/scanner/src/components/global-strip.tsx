import { useGetGlobalIndices, getGetGlobalIndicesQueryKey } from "@workspace/api-client-react";
import { TrendingUp, TrendingDown, Globe, Play, Pause, ExternalLink } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useState, useMemo } from "react";
import type { IndexQuote } from "@workspace/api-client-react";

const REGION_ORDER: { key: string; label: string; match: (i: IndexQuote) => boolean }[] = [
  { key: "asia", label: "ASIA", match: i => ["India / SGX", "Japan", "Hong Kong", "China"].includes(i.region ?? "") },
  { key: "europe", label: "EUROPE", match: i => ["UK", "Germany"].includes(i.region ?? "") },
  { key: "us", label: "US", match: i => i.region === "US" },
  { key: "commod", label: "COMMOD", match: i => i.region === "Global" },
  { key: "fx", label: "FX", match: i => i.region === "FX" },
];

function fmtPrice(p: number) {
  if (p < 5) return p.toFixed(4);
  if (p < 100) return p.toFixed(2);
  return p.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function fmtVolume(v?: number) {
  if (v == null) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(v);
}

function fmtTime(ts?: number) {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function rangePct(v: number, lo: number, hi: number) {
  if (hi <= lo) return 50;
  return Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
}

function Sparkline({ data, up }: { data: number[]; up: boolean }) {
  if (!data || data.length < 2) return null;
  const w = 220;
  const h = 56;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = Math.max(1e-9, max - min);
  const stepX = w / (data.length - 1);
  const pts = data.map((v, i) => `${(i * stepX).toFixed(2)},${(h - ((v - min) / span) * h).toFixed(2)}`).join(" ");
  const stroke = up ? "hsl(var(--signal-strong-buy, 142 76% 45%))" : "hsl(var(--signal-strong-sell, 0 78% 58%))";
  const fill = up ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)";
  const area = `0,${h} ${pts} ${w},${h}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-14">
      <polygon points={area} fill={fill} />
      <polyline points={pts} fill="none" stroke={up ? "rgb(34,197,94)" : "rgb(239,68,68)"} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" style={{ stroke }} />
    </svg>
  );
}

function RangeBar({ value, lo, hi, label }: { value: number; lo: number; hi: number; label: string }) {
  const pct = rangePct(value, lo, hi);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-[10px] font-mono uppercase text-muted-foreground/70 tracking-wider">
        <span>{label}</span>
        <span>{fmtPrice(lo)} – {fmtPrice(hi)}</span>
      </div>
      <div className="relative h-1.5 rounded-full bg-muted/40">
        <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-foreground border-2 border-background" style={{ left: `calc(${pct}% - 5px)` }} />
      </div>
    </div>
  );
}

function ItemPopover({ idx }: { idx: IndexQuote }) {
  const up = idx.change >= 0;
  const tone = up ? "text-signal-strong-buy" : "text-signal-strong-sell";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-baseline gap-2 text-sm font-mono shrink-0 px-3 py-1.5 rounded border border-border/50 bg-background/40 hover:bg-background/80 hover:border-border transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
          aria-label={`Open details for ${idx.name}`}
        >
          <span className="text-muted-foreground text-[12px] font-medium">{idx.name}</span>
          <span className="font-bold tabular-nums text-[14px]">{fmtPrice(idx.price)}</span>
          <span className={`tabular-nums text-[12px] font-semibold ${tone}`}>
            {up ? <TrendingUp className="inline w-3.5 h-3.5" /> : <TrendingDown className="inline w-3.5 h-3.5" />}
            <span className="opacity-90 ml-1">{`${idx.changePercent > 0 ? "+" : ""}${idx.changePercent.toFixed(2)}%`}</span>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0" sideOffset={6}>
        <div className="p-4 space-y-3">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">{idx.region ?? "—"} · {idx.symbol}</div>
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
            <span className="font-mono font-bold text-2xl tabular-nums">{fmtPrice(idx.price)}</span>
            <span className={`font-mono text-sm tabular-nums font-semibold ${tone}`}>
              {idx.change > 0 ? "+" : ""}{fmtPrice(idx.change)} ({idx.changePercent > 0 ? "+" : ""}{idx.changePercent.toFixed(2)}%)
            </span>
          </div>

          {/* Sparkline */}
          {idx.sparkline && idx.sparkline.length > 1 && (
            <div className="-mx-1">
              <Sparkline data={idx.sparkline} up={up} />
              <div className="text-[10px] font-mono text-muted-foreground/60 text-right pr-1">
                last {idx.sparkline.length} sessions
              </div>
            </div>
          )}

          {/* OHLC grid */}
          <div className="grid grid-cols-4 gap-2 text-[11px] font-mono pt-1 border-t border-border/40">
            <Cell label="Open" value={idx.open != null ? fmtPrice(idx.open) : "—"} />
            <Cell label="High" value={idx.high != null ? fmtPrice(idx.high) : "—"} tone="buy" />
            <Cell label="Low" value={idx.low != null ? fmtPrice(idx.low) : "—"} tone="sell" />
            <Cell label="Prev" value={idx.previousClose != null ? fmtPrice(idx.previousClose) : "—"} />
          </div>

          {/* Day range bar */}
          {idx.high != null && idx.low != null && (
            <RangeBar value={idx.price} lo={idx.low} hi={idx.high} label="Day Range" />
          )}

          {/* 52w range bar */}
          {idx.fiftyTwoWeekHigh != null && idx.fiftyTwoWeekLow != null && (
            <RangeBar value={idx.price} lo={idx.fiftyTwoWeekLow} hi={idx.fiftyTwoWeekHigh} label="52-Week Range" />
          )}

          {/* Indicators */}
          {(idx.vwap != null || idx.ema9 != null || idx.ema21 != null || idx.rsi14 != null) && (
            <div className="grid grid-cols-4 gap-2 text-[11px] font-mono pt-1 border-t border-border/40">
              {idx.vwap != null && <Cell label="VWAP" value={fmtPrice(idx.vwap)} />}
              {idx.ema9 != null && <Cell label="EMA 9" value={fmtPrice(idx.ema9)} />}
              {idx.ema21 != null && <Cell label="EMA 21" value={fmtPrice(idx.ema21)} />}
              {idx.rsi14 != null && (
                <Cell label="RSI 14" value={idx.rsi14.toFixed(1)} tone={idx.rsi14 >= 70 ? "sell" : idx.rsi14 <= 30 ? "buy" : undefined} />
              )}
            </div>
          )}

          {/* Volume + as-of */}
          <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground/70 pt-1 border-t border-border/40">
            <span>Vol {fmtVolume(idx.volume)}</span>
            <span>as of {fmtTime(idx.asOf)}</span>
          </div>

          {/* External link to Yahoo */}
          <a
            href={`https://finance.yahoo.com/quote/${encodeURIComponent(idx.symbol)}`}
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground font-mono"
          >
            View on Yahoo Finance <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </PopoverContent>
    </Popover>
  );
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

export default function GlobalStrip() {
  const { data, isLoading } = useGetGlobalIndices({
    query: { refetchInterval: 30000, queryKey: getGetGlobalIndicesQueryKey() },
  });
  const [playing, setPlaying] = useState(true);

  const blocks = useMemo(() => {
    return REGION_ORDER.flatMap((reg) => {
      const items = (data?.indices ?? []).filter(reg.match);
      if (items.length === 0) return [];
      return [
        <span
          key={`label-${reg.key}`}
          className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70 shrink-0 ml-2 font-semibold border-l border-border/40 pl-3"
        >
          {reg.label}
        </span>,
        ...items.map(idx => <ItemPopover key={`${reg.key}-${idx.symbol}`} idx={idx} />),
      ];
    });
  }, [data]);

  return (
    <div className="border-b border-border bg-card/40">
      <style>{`
        @keyframes global-strip-marquee {
          from { transform: translate3d(0, 0, 0); }
          to   { transform: translate3d(-50%, 0, 0); }
        }
        .global-strip-track {
          display: inline-flex;
          align-items: center;
          gap: 0.75rem;
          animation: global-strip-marquee 60s linear infinite;
          will-change: transform;
        }
        .global-strip-track[data-paused="true"] { animation-play-state: paused; }
        .global-strip-viewport:hover .global-strip-track { animation-play-state: paused; }
      `}</style>
      <div className="w-full px-4 py-2.5 flex items-center gap-3">
        <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1.5 shrink-0 font-semibold">
          <Globe className="w-3.5 h-3.5" /> GLOBAL
        </span>

        <button
          type="button"
          onClick={() => setPlaying(p => !p)}
          aria-label={playing ? "Pause global indices ticker" : "Play global indices ticker"}
          title={playing ? "Pause ticker" : "Play ticker"}
          className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded border border-border/60 bg-background/40 hover:bg-background/80 text-muted-foreground hover:text-foreground transition-colors"
        >
          {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        </button>

        <div className="global-strip-viewport flex-1 min-w-0 overflow-hidden whitespace-nowrap">
          {isLoading ? (
            <div className="flex items-center gap-3">
              <Skeleton className="h-7 w-36" />
              <Skeleton className="h-7 w-36" />
              <Skeleton className="h-7 w-36" />
            </div>
          ) : blocks.length === 0 ? (
            <span className="text-xs text-muted-foreground">No data</span>
          ) : (
            <div className="global-strip-track" data-paused={!playing}>
              <div className="flex items-center gap-3 shrink-0">{blocks}</div>
              <div className="flex items-center gap-3 shrink-0" aria-hidden="true">{blocks}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
