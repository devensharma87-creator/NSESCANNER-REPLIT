import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SignalBadge } from "@/components/ui/signal-badge";
import { ArrowLeft, TrendingUp, TrendingDown } from "lucide-react";
import type { StockRow } from "@workspace/api-client-react";
import { TradingViewChart } from "@/components/tradingview-chart";

/** Map our internal index slug → TradingView symbol. Verified against
 * TradingView's public symbol search. */
function tradingViewSymbol(slug: string): string {
  switch (slug.toUpperCase()) {
    case "NIFTY50":      return "NSE:NIFTY";
    case "BANKNIFTY":    return "NSE:BANKNIFTY";
    case "NIFTYIT":      return "NSE:CNXIT";
    case "NIFTYAUTO":    return "NSE:CNXAUTO";
    case "NIFTYPHARMA":  return "NSE:CNXPHARMA";
    case "NIFTYFMCG":    return "NSE:CNXFMCG";
    case "FINNIFTY":     return "NSE:CNXFINANCE";
    case "MIDCPNIFTY":   return "NSE:NIFTY_MID_SELECT";
    case "SENSEX":       return "BSE:SENSEX";
    case "BANKEX":       return "BSE:BANKEX";
    default:             return `NSE:${slug.toUpperCase()}`;
  }
}

interface IndexDetail {
  slug: string;
  name: string;
  yahoo: string;
  price: number;
  change: number;
  changePercent: number;
  open?: number;
  high?: number;
  low?: number;
  previousClose: number;
  previousHigh?: number;
  previousLow?: number;
  pivots?: { pivot: number; r1: number; r2: number; s1: number; s2: number };
  breadth: { advancers: number; decliners: number; unchanged: number; adRatio: number | null };
  constituents: StockRow[];
}

function fmtIN(n: number) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

export default function IndexDetail() {
  const [, params] = useRoute<{ slug: string }>("/index/:slug");
  const slug = params?.slug?.toUpperCase() ?? "";

  const { data, isLoading, isError, error } = useQuery<IndexDetail>({
    queryKey: ["index-detail", slug],
    queryFn: async () => {
      const r = await fetch(`${import.meta.env.BASE_URL}api/index/${slug}`);
      if (!r.ok) throw new Error("Failed to load index");
      return r.json();
    },
    enabled: !!slug,
    refetchInterval: 30_000,
    retry: 1,
  });

  if (isError) {
    return (
      <div className="w-full max-w-none px-4 py-6 space-y-3">
        <Link href="/" className="text-xs text-muted-foreground hover:text-foreground">← DASHBOARD</Link>
        <h1 className="text-2xl font-mono font-bold">Index not found</h1>
        <p className="text-sm text-muted-foreground">
          We could not load <span className="font-mono">{slug}</span>. {(error as Error)?.message ?? ""}
        </p>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="w-full max-w-none px-4 py-6 space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const up = data.changePercent >= 0;
  const total = data.breadth.advancers + data.breadth.decliners + data.breadth.unchanged;
  const advPct = total > 0 ? (data.breadth.advancers / total) * 100 : 0;
  const decPct = total > 0 ? (data.breadth.decliners / total) * 100 : 0;
  const uncPct = total > 0 ? (data.breadth.unchanged / total) * 100 : 0;

  // Top movers (10 each direction)
  const topGainers = data.constituents.slice(0, 10);
  const topLosers = data.constituents.slice().reverse().slice(0, 10);

  return (
    <div className="w-full max-w-none px-4 py-6 space-y-6">
      <div>
        <Link href="/" className="inline-flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> DASHBOARD
        </Link>
        <div className="mt-1 flex flex-wrap items-baseline gap-3">
          <h1 className="text-3xl font-bold font-mono tracking-tight">{data.name}</h1>
          <span className="text-2xl font-mono font-bold tabular-nums">{fmtIN(data.price)}</span>
          <span className={`text-base font-mono font-semibold inline-flex items-center gap-1 ${up ? "text-signal-strong-buy" : "text-signal-strong-sell"}`}>
            {up ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            {data.change >= 0 ? "+" : ""}{fmtIN(data.change)} ({data.changePercent >= 0 ? "+" : ""}{data.changePercent.toFixed(2)}%)
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-px bg-border rounded-md overflow-hidden border border-border">
        <Stat label="Open" value={data.open != null ? fmtIN(data.open) : "—"} />
        <Stat label="High" value={data.high != null ? fmtIN(data.high) : "—"} tone="buy" />
        <Stat label="Low" value={data.low != null ? fmtIN(data.low) : "—"} tone="sell" />
        <Stat label="Prev Close" value={fmtIN(data.previousClose)} />
        <Stat label="Constituents" value={`${data.constituents.length}`} />
        <Stat label="A/D Ratio" value={data.breadth.adRatio == null ? "∞" : data.breadth.adRatio.toFixed(2)} tone={data.breadth.adRatio == null || data.breadth.adRatio >= 1 ? "buy" : "sell"} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Breadth</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex h-3 rounded overflow-hidden border border-border bg-muted">
            <div style={{ width: `${advPct}%` }} className="bg-signal-strong-buy" title={`Advancers ${data.breadth.advancers}`} />
            <div style={{ width: `${uncPct}%` }} className="bg-muted-foreground/40" title={`Unchanged ${data.breadth.unchanged}`} />
            <div style={{ width: `${decPct}%` }} className="bg-signal-strong-sell" title={`Decliners ${data.breadth.decliners}`} />
          </div>
          <div className="flex justify-between text-[12px] font-mono">
            <span className="text-signal-strong-buy">▲ Adv {data.breadth.advancers} ({advPct.toFixed(0)}%)</span>
            <span className="text-muted-foreground">— Unch {data.breadth.unchanged} ({uncPct.toFixed(0)}%)</span>
            <span className="text-signal-strong-sell">▼ Dec {data.breadth.decliners} ({decPct.toFixed(0)}%)</span>
          </div>
        </CardContent>
      </Card>

      {data.pivots && (
        <PivotLadder ltp={data.price} piv={data.pivots} />
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            TradingView · Live Chart
            <span className="text-[10px] text-muted-foreground/70 normal-case tracking-normal">(EMA 9/21 · RSI · VWAP preloaded)</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <TradingViewChart symbol={tradingViewSymbol(slug)} interval="15" height={560} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ConstituentTable title="Top Gainers" rows={topGainers} />
        <ConstituentTable title="Top Losers" rows={topLosers} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-mono">All constituents</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border">
                  <TableHead className="font-mono text-[11px]">SYMBOL</TableHead>
                  <TableHead className="text-right font-mono text-[11px]">CMP</TableHead>
                  <TableHead className="text-right font-mono text-[11px]">%CHG</TableHead>
                  <TableHead className="text-right font-mono text-[11px]">RSI</TableHead>
                  <TableHead className="text-right font-mono text-[11px]">VOL×</TableHead>
                  <TableHead className="text-right font-mono text-[11px]">SCORE</TableHead>
                  <TableHead className="text-right font-mono text-[11px]">SIGNAL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.constituents.map(s => (
                  <TableRow key={s.symbol} className="hover-row border-border/50">
                    <TableCell className="py-1.5">
                      <Link href={`/stock/${s.symbol}`} className="font-mono font-bold hover:underline text-sm">{s.symbol}</Link>
                      <div className="text-[10px] text-muted-foreground truncate max-w-[180px]">{s.name}</div>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{fmtIN(s.quote.price)}</TableCell>
                    <TableCell className={`text-right font-mono tabular-nums ${s.quote.changePercent >= 0 ? "text-signal-strong-buy" : "text-signal-strong-sell"}`}>
                      {s.quote.changePercent >= 0 ? "+" : ""}{s.quote.changePercent.toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{s.indicators?.rsi14?.toFixed(1) ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{s.indicators?.volumeRatio != null ? `${s.indicators.volumeRatio.toFixed(1)}×` : "—"}</TableCell>
                    <TableCell className={`text-right font-mono tabular-nums ${s.recommendation.score > 0 ? "text-signal-strong-buy" : s.recommendation.score < 0 ? "text-signal-strong-sell" : ""}`}>
                      {s.recommendation.score > 0 ? "+" : ""}{s.recommendation.score}
                    </TableCell>
                    <TableCell className="text-right"><SignalBadge signal={s.recommendation.signal} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ConstituentTable({ title, rows }: { title: string; rows: StockRow[] }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm font-mono">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-1">
        {rows.map(s => (
          <Link key={s.symbol} href={`/stock/${s.symbol}`} className="flex items-center justify-between p-2 rounded hover-row border border-transparent hover:border-border">
            <div className="min-w-0">
              <div className="font-mono font-bold text-sm">{s.symbol}</div>
              <div className="text-[11px] text-muted-foreground truncate">{s.name}</div>
            </div>
            <div className="text-right">
              <div className="font-mono tabular-nums text-sm">{fmtIN(s.quote.price)}</div>
              <div className={`font-mono text-[11px] ${s.quote.changePercent >= 0 ? "text-signal-strong-buy" : "text-signal-strong-sell"}`}>
                {s.quote.changePercent >= 0 ? "+" : ""}{s.quote.changePercent.toFixed(2)}%
              </div>
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * Classical floor pivots (R2 · R1 · Pivot · S1 · S2) rendered as a horizontal
 * ladder. The LTP marker is positioned proportionally inside the S2..R2 band
 * and **clamped to the band edges** when price has broken out — in that case
 * the marker pins to 0 % or 100 % and traders should rely on the
 * "nearest level · signed distance" line below the bar (which always reports
 * the true gap to the closest level) rather than the marker's visual offset.
 */
function PivotLadder({
  ltp,
  piv,
}: {
  ltp: number;
  piv: { pivot: number; r1: number; r2: number; s1: number; s2: number };
}) {
  const levels: { label: string; value: number; tone: "sell" | "neutral" | "buy" }[] = [
    { label: "S2",    value: piv.s2,    tone: "buy"     },
    { label: "S1",    value: piv.s1,    tone: "buy"     },
    { label: "Pivot", value: piv.pivot, tone: "neutral" },
    { label: "R1",    value: piv.r1,    tone: "sell"    },
    { label: "R2",    value: piv.r2,    tone: "sell"    },
  ];
  const lo = piv.s2;
  const hi = piv.r2;
  const span = hi - lo;
  const ltpPct = span > 0
    ? Math.max(0, Math.min(100, ((ltp - lo) / span) * 100))
    : 50;
  // Nearest level + signed % distance (negative = below LTP / would need to drop).
  let nearest = levels[0];
  let nearestAbs = Math.abs(ltp - levels[0].value);
  for (const l of levels) {
    const d = Math.abs(ltp - l.value);
    if (d < nearestAbs) { nearest = l; nearestAbs = d; }
  }
  const nearestSignedPct = ((nearest.value - ltp) / ltp) * 100;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          Pivot Levels
          <span className="text-[10px] text-muted-foreground/70 normal-case tracking-normal">
            (classical · prev session H/L/C)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-5 gap-px bg-border rounded overflow-hidden border border-border">
          {levels.map(l => {
            const cls =
              l.tone === "buy"  ? "text-signal-strong-buy"  :
              l.tone === "sell" ? "text-signal-strong-sell" :
              "text-foreground";
            return (
              <div key={l.label} className="bg-card p-2 text-center">
                <div className="text-[10px] font-mono uppercase text-muted-foreground tracking-wider">{l.label}</div>
                <div className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${cls}`}>{fmtIN(l.value)}</div>
              </div>
            );
          })}
        </div>
        <div className="relative h-2 rounded bg-muted overflow-visible">
          <div className="absolute inset-y-0 left-0 right-0 flex">
            <div className="flex-1 bg-signal-strong-buy/20 rounded-l" />
            <div className="flex-1 bg-signal-strong-buy/10" />
            <div className="flex-1 bg-signal-strong-sell/10" />
            <div className="flex-1 bg-signal-strong-sell/20 rounded-r" />
          </div>
          <div
            className="absolute -top-1 h-4 w-0.5 bg-foreground shadow-md"
            style={{ left: `${ltpPct}%` }}
            title={`LTP ${fmtIN(ltp)}`}
          />
        </div>
        <div className="flex justify-between text-[10px] font-mono text-muted-foreground tabular-nums">
          <span>{fmtIN(lo)}</span>
          <span className="text-foreground">
            LTP {fmtIN(ltp)} · nearest <span className="text-foreground/90 font-semibold">{nearest.label}</span> @ {fmtIN(nearest.value)} ({nearestSignedPct >= 0 ? "+" : ""}{nearestSignedPct.toFixed(2)}%)
          </span>
          <span>{fmtIN(hi)}</span>
        </div>
        <p className="text-[10.5px] text-muted-foreground/70 italic leading-snug">
          Floor pivots derive from the prior session's H/L/C and hold for the entire trading day. Reference levels only — confirm with intraday structure before acting.
        </p>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "buy" | "sell" }) {
  const cls = tone === "buy" ? "text-signal-strong-buy" : tone === "sell" ? "text-signal-strong-sell" : "text-foreground";
  return (
    <div className="bg-card p-3">
      <div className="text-[10px] font-mono uppercase text-muted-foreground tracking-wider">{label}</div>
      <div className={`mt-1 font-mono text-base font-semibold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}
