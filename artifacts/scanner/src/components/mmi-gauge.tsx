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

/** Simple half-donut gauge: thin colored arcs, slim needle, value + label below. */
function GaugeSvg({ value }: { value: number }) {
  const W = 320, H = 180;
  const cx = W / 2, cy = H - 14;
  const rOuter = 130, rInner = 110;

  const polar = (angDeg: number, r: number) => {
    const a = (Math.PI * (180 - angDeg)) / 180;
    return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
  };

  const arcPath = (fromVal: number, toVal: number) => {
    const a1 = 180 - (fromVal / 100) * 180;
    const a2 = 180 - (toVal / 100) * 180;
    const p1 = polar(a1, rOuter);
    const p2 = polar(a2, rOuter);
    const p3 = polar(a2, rInner);
    const p4 = polar(a1, rInner);
    return [
      `M ${p1.x} ${p1.y}`,
      `A ${rOuter} ${rOuter} 0 0 1 ${p2.x} ${p2.y}`,
      `L ${p3.x} ${p3.y}`,
      `A ${rInner} ${rInner} 0 0 0 ${p4.x} ${p4.y}`,
      "Z",
    ].join(" ");
  };

  const ang = 180 - (value / 100) * 180;
  const needleEnd = polar(ang, rOuter - 4);
  const z = zoneFor(value);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Market mood gauge">
      {ZONES.map(zn => (
        <path key={zn.label} d={arcPath(zn.from, zn.to)} fill={zn.color} opacity={zn === z ? 0.95 : 0.35} />
      ))}
      {/* Needle */}
      <line x1={cx} y1={cy} x2={needleEnd.x} y2={needleEnd.y} stroke="hsl(var(--foreground))" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="5" fill="hsl(var(--foreground))" />
    </svg>
  );
}

export default function MarketMoodGauge() {
  const { data: trend } = useGetMarketTrend({ query: { refetchInterval: 30000, queryKey: getGetMarketTrendQueryKey() } });
  const { data: globals } = useGetGlobalIndices({ query: { refetchInterval: 30000, queryKey: getGetGlobalIndicesQueryKey() } });

  const vix = globals?.indices?.find(i => i.symbol === "^VIX");

  // Composite mood (-100..+100) → 0..100
  const trendScore = trend?.score ?? 0;
  const vixScore = vix ? Math.max(-50, Math.min(50, -vix.changePercent * 5)) : 0;
  const breadthRatio = trend?.breadth?.advanceDeclineRatio ?? 1;
  const breadthScore = Math.max(-40, Math.min(40, (breadthRatio - 1) * 30));
  const composite = Math.round((trendScore * 0.55) + (vixScore * 0.20) + (breadthScore * 0.25));
  const mmi = Math.round(Math.max(0, Math.min(100, (composite + 100) / 2)));
  const z = zoneFor(mmi);

  return (
    <Card className="border-border bg-gradient-to-br from-card to-card/40">
      <CardContent className="p-5 flex flex-col items-center text-center">
        <div className="w-full flex items-center justify-between text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">
          <span className="flex items-center gap-1.5">
            <Gauge className="w-4 h-4" /> Market Mood
          </span>
          <span className="text-[10px]">0 – 100</span>
        </div>

        <GaugeSvg value={mmi} />

        <div className="mt-1 font-mono font-bold text-5xl tabular-nums leading-none" style={{ color: z.color }}>
          {mmi}
        </div>
        <div className="mt-2 text-sm font-mono uppercase tracking-widest font-semibold" style={{ color: z.color }}>
          {z.label}
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground font-mono">
          Composite of trend, breadth and volatility
        </div>
      </CardContent>
    </Card>
  );
}
