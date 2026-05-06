import { useGetMarketTrend, getGetMarketTrendQueryKey, useGetGlobalIndices, getGetGlobalIndicesQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Gauge } from "lucide-react";

interface Zone { from: number; to: number; label: string; color: string; }

const ZONES: Zone[] = [
  { from: 0, to: 20, label: "Extreme Fear", color: "#ef4444" },
  { from: 20, to: 40, label: "Fear", color: "#f59e0b" },
  { from: 40, to: 60, label: "Neutral", color: "#a3a3a3" },
  { from: 60, to: 80, label: "Greed", color: "#22c55e" },
  { from: 80, to: 100, label: "Extreme Greed", color: "#16a34a" },
];

function zoneFor(v: number): Zone {
  return ZONES.find(z => v >= z.from && v <= z.to) ?? ZONES[2]!;
}

/** Minimal horizontal gauge: 5 thin segments with a single marker showing the current value. */
function GaugeBar({ value }: { value: number }) {
  const z = zoneFor(value);
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="space-y-2">
      <div className="relative h-2 rounded-full overflow-hidden flex">
        {ZONES.map(zn => (
          <div
            key={zn.label}
            className="h-full"
            style={{
              width: `${zn.to - zn.from}%`,
              backgroundColor: zn.color,
              opacity: zn === z ? 0.95 : 0.25,
            }}
          />
        ))}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-background shadow"
          style={{ left: `calc(${pct}% - 6px)`, backgroundColor: z.color }}
        />
      </div>
      <div className="flex justify-between text-[9px] font-mono uppercase tracking-wider text-muted-foreground/60">
        <span>0</span><span>20</span><span>40</span><span>60</span><span>80</span><span>100</span>
      </div>
    </div>
  );
}

export default function MarketMoodGauge() {
  const { data: trend, isLoading: trendLoading } = useGetMarketTrend({ query: { refetchInterval: 30000, queryKey: getGetMarketTrendQueryKey() } });
  const { data: globals, isLoading: globalsLoading } = useGetGlobalIndices({ query: { refetchInterval: 30000, queryKey: getGetGlobalIndicesQueryKey() } });

  const vix = globals?.indices?.find(i => i.symbol === "^VIX");
  const dxy = globals?.indices?.find(i => i.symbol === "DX-Y.NYB");
  const crude = globals?.indices?.find(i => i.symbol === "CL=F");
  const indiavix = globals?.indices?.find(i => i.symbol === "^INDIAVIX");

  // Honesty guard — distinguish "feed loading" vs "feed returned but
  // every input is missing" vs "real readings". Without this, the gauge
  // proudly displayed "50 · NEUTRAL" with all sub-rows blank when the
  // entire backing trend / VIX feed had no data — an exact misleading
  // reading the audit flagged. Mirrors the same guard in market-mood.tsx.
  const isLoading = trendLoading || globalsLoading;
  const trendKnown = typeof trend?.score === "number" && Number.isFinite(trend.score);
  const vixKnown = vix != null && Number.isFinite(vix.changePercent);
  const breadthKnown = typeof trend?.breadth?.advanceDeclineRatio === "number" && Number.isFinite(trend!.breadth!.advanceDeclineRatio);
  const noData = !isLoading && !trendKnown && !vixKnown && !breadthKnown;

  // Composite mood (-100..+100) → 0..100
  const trendScore = trendKnown ? (trend!.score as number) : 0;
  const vixScore = vixKnown ? Math.max(-50, Math.min(50, -vix!.changePercent * 5)) : 0;
  const breadthRatio: number = breadthKnown ? (trend!.breadth!.advanceDeclineRatio as number) : 1;
  const breadthScore = Math.max(-40, Math.min(40, (breadthRatio - 1) * 30));
  const composite = Math.round((trendScore * 0.55) + (vixScore * 0.20) + (breadthScore * 0.25));
  const mmi = Math.round(Math.max(0, Math.min(100, (composite + 100) / 2)));
  const z = zoneFor(mmi);

  if (isLoading || noData) {
    return (
      <Card className="border-border bg-gradient-to-br from-card to-card/40">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <Gauge className="w-4 h-4" /> MARKET MOOD INDEX
            </div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              {isLoading ? "Loading…" : "No data"}
            </div>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {isLoading
              ? "Waiting for the market-trend and VIX feeds to return their first reading…"
              : "Mood readings are unavailable — the upstream trend feed and VIX both returned no data. This usually clears once the broker session reconnects or the cash market opens."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border bg-gradient-to-br from-card to-card/40">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <Gauge className="w-4 h-4" /> MARKET MOOD INDEX
          </div>
          <div className="text-[10px] font-mono text-muted-foreground">Composite of trend · breadth · vol</div>
        </div>

        <div className="flex items-baseline gap-3">
          <span className="font-mono font-bold text-4xl tabular-nums leading-none" style={{ color: z.color }}>{mmi}</span>
          <span className="font-mono uppercase tracking-widest text-xs font-semibold" style={{ color: z.color }}>{z.label}</span>
        </div>

        <GaugeBar value={mmi} />

        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/40">
          <Sub label="Trend" v={trendScore} />
          <Sub label="Breadth" v={Math.round(breadthScore)} />
          <Sub label="A/D Ratio" v={breadthRatio} fmt={n => n.toFixed(2)} />
          <Sub label="Vol (VIX)" v={Math.round(vixScore)} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] font-mono text-muted-foreground pt-2 border-t border-border/40">
          <Mini label="India VIX" v={indiavix?.price} pct={indiavix?.changePercent} invert />
          <Mini label="VIX" v={vix?.price} pct={vix?.changePercent} invert />
          <Mini label="DXY" v={dxy?.price} pct={dxy?.changePercent} invert />
          <Mini label="Crude" v={crude?.price} pct={crude?.changePercent} />
        </div>
      </CardContent>
    </Card>
  );
}

function Sub({ label, v, fmt }: { label: string; v: number; fmt?: (n: number) => string }) {
  return (
    <div className="flex items-center justify-between text-[11px] font-mono">
      <span className="uppercase text-muted-foreground tracking-wider">{label}</span>
      <span className="font-bold tabular-nums">{fmt ? fmt(v) : (v > 0 ? `+${v}` : v)}</span>
    </div>
  );
}

function Mini({ label, v, pct, invert }: { label: string; v?: number; pct?: number; invert?: boolean }) {
  if (v == null) return <div>{label} —</div>;
  const dir = (pct ?? 0) >= 0;
  const cls = invert
    ? (dir ? "text-signal-strong-sell" : "text-signal-strong-buy")
    : (dir ? "text-signal-strong-buy" : "text-signal-strong-sell");
  return (
    <div>
      {label} <span className={`${cls} tabular-nums`}>{v.toFixed(2)}{pct != null ? ` (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)` : ""}</span>
    </div>
  );
}
