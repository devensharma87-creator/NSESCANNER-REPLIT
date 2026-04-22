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

/** Draw a half-donut gauge with 5 colored arcs and a needle pointing to `value` (0..100). */
function GaugeSvg({ value }: { value: number }) {
  const W = 360, H = 200;
  const cx = W / 2, cy = H - 10;
  const rOuter = 150, rInner = 110;

  const polar = (angDeg: number, r: number) => {
    const a = (Math.PI * (180 - angDeg)) / 180; // 180° at left, 0° at right
    return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
  };

  const arcPath = (fromVal: number, toVal: number) => {
    const a1 = 180 - (fromVal / 100) * 180;
    const a2 = 180 - (toVal / 100) * 180;
    const p1 = polar(a1, rOuter);
    const p2 = polar(a2, rOuter);
    const p3 = polar(a2, rInner);
    const p4 = polar(a1, rInner);
    const large = Math.abs(a2 - a1) > 180 ? 1 : 0;
    return [
      `M ${p1.x} ${p1.y}`,
      `A ${rOuter} ${rOuter} 0 ${large} 1 ${p2.x} ${p2.y}`,
      `L ${p3.x} ${p3.y}`,
      `A ${rInner} ${rInner} 0 ${large} 0 ${p4.x} ${p4.y}`,
      "Z",
    ].join(" ");
  };

  // Needle
  const ang = 180 - (value / 100) * 180;
  const needleEnd = polar(ang, rOuter - 8);
  const z = zoneFor(value);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Market mood gauge">
      {ZONES.map(z => (
        <path key={z.label} d={arcPath(z.from, z.to)} fill={z.color} opacity={0.85} />
      ))}
      {/* Tick labels */}
      {[0, 20, 40, 60, 80, 100].map(t => {
        const p = polar(180 - (t / 100) * 180, rOuter + 14);
        return (
          <text key={t} x={p.x} y={p.y} textAnchor="middle" fontSize="10" fontFamily="ui-monospace, monospace" fill="hsl(var(--muted-foreground))">{t}</text>
        );
      })}
      {/* Needle */}
      <line x1={cx} y1={cy} x2={needleEnd.x} y2={needleEnd.y} stroke="hsl(var(--foreground))" strokeWidth="3" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="8" fill="hsl(var(--foreground))" />
      <circle cx={cx} cy={cy} r="4" fill={z.color} />
      {/* Value */}
      <text x={cx} y={cy - 28} textAnchor="middle" fontSize="38" fontWeight="700" fontFamily="ui-monospace, monospace" fill="hsl(var(--foreground))">
        {value.toFixed(0)}
      </text>
      <text x={cx} y={cy - 8} textAnchor="middle" fontSize="11" fontWeight="600" fontFamily="ui-monospace, monospace" fill={z.color}>
        {z.label.toUpperCase()}
      </text>
    </svg>
  );
}

export default function MarketMoodGauge() {
  const { data: trend } = useGetMarketTrend({ query: { refetchInterval: 30000, queryKey: getGetMarketTrendQueryKey() } });
  const { data: globals } = useGetGlobalIndices({ query: { refetchInterval: 30000, queryKey: getGetGlobalIndicesQueryKey() } });

  const vix = globals?.indices?.find(i => i.symbol === "^VIX");
  const dxy = globals?.indices?.find(i => i.symbol === "DX-Y.NYB");
  const crude = globals?.indices?.find(i => i.symbol === "CL=F");
  const indiavix = globals?.indices?.find(i => i.symbol === "^INDIAVIX");

  // Composite mood (-100..+100) → 0..100
  const trendScore = trend?.score ?? 0;
  const vixScore = vix ? Math.max(-50, Math.min(50, -vix.changePercent * 5)) : 0;
  const breadthRatio = trend?.breadth?.advanceDeclineRatio ?? 1;
  const breadthScore = Math.max(-40, Math.min(40, (breadthRatio - 1) * 30));
  const composite = Math.round((trendScore * 0.55) + (vixScore * 0.20) + (breadthScore * 0.25));
  const mmi = Math.round(Math.max(0, Math.min(100, (composite + 100) / 2)));

  return (
    <Card className="border-border bg-gradient-to-br from-card to-card/40">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <Gauge className="w-4 h-4" /> MARKET MOOD INDEX
          </div>
          <div className="text-[10px] font-mono text-muted-foreground">Composite of trend · breadth · vol</div>
        </div>
        <GaugeSvg value={mmi} />
        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/40">
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
