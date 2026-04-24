import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ResponsiveContainer, ComposedChart, Line, Area, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, Legend,
} from "recharts";

type LookupKind = "stock" | "index";

interface LookupItem {
  kind: LookupKind;
  symbol: string;
  name: string;
  sector?: string;
  category?: string;
}

interface DeepSnapshot {
  kind: LookupKind;
  symbol: string;
  name: string;
  sector?: string;
  industry?: string;
  description?: string;
  range: Range;
  ticker: string;
  quote: {
    price: number;
    change: number;
    changePercent: number;
    open: number | null;
    high: number | null;
    low: number | null;
    previousClose: number | null;
    fiftyTwoWeekHigh: number | null;
    fiftyTwoWeekLow: number | null;
    volume: number | null;
    updatedAt: string;
  };
  candles: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>;
  series: {
    ema20: (number | null)[];
    ema50: (number | null)[];
    ema100: (number | null)[];
    ema200: (number | null)[];
    vwap20: (number | null)[];
  };
  returns: Record<"1mo" | "3mo" | "6mo" | "1y" | "3y" | "5y", number | null>;
  fundamentals?: Record<string, number | undefined>;
  profile?: { seasonality?: string; catalysts?: string[] };
  constituentCount?: number;
}

const RANGES = ["5d", "1mo", "3mo", "6mo", "1y", "3y", "5y"] as const;
type Range = typeof RANGES[number];

const RANGE_LABEL: Record<Range, string> = {
  "5d": "5D", "1mo": "1M", "3mo": "3M", "6mo": "6M", "1y": "1Y", "3y": "3Y", "5y": "5Y",
};

const API_BASE = `${import.meta.env.BASE_URL}api`.replace(/\/+$/, "").replace(/\/api$/, "/api");

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

const fmt = (n: number | null | undefined, d = 2) =>
  n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
const fmtVol = (n: number | null | undefined) => {
  if (n == null) return "—";
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(2)} L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} K`;
  return n.toString();
};

export default function DeepScan() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<LookupItem | null>(null);
  const [range, setRange] = useState<Range>("6mo");
  const containerRef = useRef<HTMLDivElement>(null);

  // Default symbol on first load
  useEffect(() => {
    if (!active) {
      setActive({ kind: "index", symbol: "NIFTY", name: "NIFTY 50", category: "Broad" });
    }
  }, [active]);

  // Click-outside to close dropdown
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  const lookupQ = useQuery({
    queryKey: ["deepscan-lookup", query],
    queryFn: () => apiGet<{ items: LookupItem[] }>(`/deepscan/lookup?q=${encodeURIComponent(query)}`),
    enabled: query.trim().length > 0,
    staleTime: 60_000,
  });

  const snapQ = useQuery<DeepSnapshot>({
    queryKey: ["deepscan-snapshot", active?.symbol, active?.kind, range],
    queryFn: () =>
      apiGet<DeepSnapshot>(
        `/deepscan/snapshot/${encodeURIComponent(active!.symbol)}?range=${range}&kind=${active!.kind}`,
      ),
    enabled: !!active,
    refetchInterval: 30_000,
  });

  const select = (item: LookupItem) => {
    setActive(item);
    setQuery("");
    setOpen(false);
  };

  // Chart data
  const chartData = useMemo(() => {
    if (!snapQ.data) return [];
    const { candles, series } = snapQ.data;
    return candles.map((c, i) => ({
      label: new Date(c.t).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: range === "5y" || range === "3y" ? "2-digit" : undefined }),
      close: c.c,
      vol: c.v,
      ema20:  series.ema20[i]  ?? null,
      ema50:  series.ema50[i]  ?? null,
      ema100: series.ema100[i] ?? null,
      ema200: series.ema200[i] ?? null,
      vwap:   series.vwap20[i] ?? null,
    }));
  }, [snapQ.data, range]);

  const snap = snapQ.data;
  const up = (snap?.quote.changePercent ?? 0) >= 0;

  return (
    <div className="w-full max-w-none px-4 py-6 space-y-6">
      {/* Header / search */}
      <div className="flex flex-col items-center gap-3">
        <div className="text-center">
          <h1 className="text-2xl font-bold font-mono tracking-tight">DEEP SCAN</h1>
          <p className="text-xs text-muted-foreground font-mono">Search any NSE stock or Indian index — full chart, EMAs, VWAP, returns, fundamentals.</p>
        </div>

        <div ref={containerRef} className="relative w-full max-w-2xl">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search… NIFTY, BANKNIFTY, RELIANCE, HDFC, TATA…"
              value={query}
              onFocus={() => setOpen(true)}
              onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
              className="pl-9 h-11 text-base bg-card border-border"
            />
          </div>
          {open && query.trim() && (
            <div className="absolute left-0 right-0 mt-1 rounded-md border border-border bg-card shadow-2xl max-h-[420px] overflow-auto z-50">
              {lookupQ.isLoading ? (
                <div className="p-3 text-xs font-mono text-muted-foreground">Searching…</div>
              ) : (lookupQ.data?.items.length ?? 0) === 0 ? (
                <div className="p-3 text-xs font-mono text-muted-foreground">No matches. Tip: type a full NSE ticker (e.g. TATAELXSI) to scan it directly.</div>
              ) : (
                lookupQ.data!.items.map((it) => (
                  <button
                    key={`${it.kind}-${it.symbol}`}
                    onClick={() => select(it)}
                    className="w-full text-left flex items-center justify-between gap-3 px-3 py-2 hover:bg-white/5 border-b border-border/50 last:border-0"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant="outline" className={`font-mono text-[9px] uppercase ${it.kind === "index" ? "text-amber-400 border-amber-500/40" : "text-foreground/80"}`}>
                        {it.kind}
                      </Badge>
                      <div className="min-w-0">
                        <div className="font-mono font-bold text-sm truncate">{it.symbol}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{it.name} · {it.sector ?? it.category ?? ""}</div>
                      </div>
                    </div>
                  </button>
                ))
              )}
              {/* Free-text scan even if no match */}
              {(lookupQ.data?.items.length ?? 0) === 0 && query.trim().length >= 2 && (
                <button
                  onClick={() => select({ kind: "stock", symbol: query.trim().toUpperCase(), name: query.trim().toUpperCase() })}
                  className="w-full text-left px-3 py-2 hover:bg-white/5 border-t border-border/50"
                >
                  <span className="font-mono text-xs">Scan <b>{query.trim().toUpperCase()}.NS</b> directly →</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {!active ? null : snapQ.isLoading && !snap ? (
        <Skeleton className="h-[600px] w-full" />
      ) : snapQ.error || !snap ? (
        <Card className="border-signal-strong-sell/30">
          <CardContent className="p-4 text-sm font-mono text-signal-strong-sell">
            Could not load snapshot for <b>{active.symbol}</b>. {(snapQ.error as Error | undefined)?.message ?? ""}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Header card with quote + range buttons */}
          <Card className="border-border">
            <CardContent className="p-4 space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <Badge variant="outline" className={`font-mono text-[10px] uppercase ${snap.kind === "index" ? "text-amber-400 border-amber-500/40" : ""}`}>{snap.kind}</Badge>
                    <h2 className="text-2xl font-bold font-mono tracking-tight">{snap.symbol}</h2>
                    <span className="text-muted-foreground">{snap.name}</span>
                    {snap.sector && <Badge variant="outline" className="font-mono text-[10px] uppercase">{snap.sector}</Badge>}
                    {snap.industry && <Badge variant="outline" className="font-mono text-[10px] uppercase">{snap.industry}</Badge>}
                    {snap.constituentCount != null && <Badge variant="outline" className="font-mono text-[10px] uppercase">{snap.constituentCount} constituents</Badge>}
                  </div>
                  <div className="text-[11px] text-muted-foreground font-mono">
                    Yahoo: {snap.ticker} · Updated {new Date(snap.quote.updatedAt).toLocaleTimeString("en-IN")}
                  </div>
                </div>
                <div className="text-right space-y-1">
                  <div className="flex items-baseline justify-end gap-3">
                    <span className="text-3xl font-mono font-bold tabular-nums">{snap.kind === "stock" ? "₹" : ""}{fmt(snap.quote.price)}</span>
                    <span className={`font-mono text-sm font-semibold inline-flex items-center gap-1 ${up ? "text-signal-strong-buy" : "text-signal-strong-sell"}`}>
                      {up ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                      {fmtPct(snap.quote.changePercent)}
                      <span className="text-xs text-muted-foreground ml-1">({snap.quote.change >= 0 ? "+" : ""}{fmt(snap.quote.change)})</span>
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-1">
                {RANGES.map(r => (
                  <Button key={r} size="sm" variant={r === range ? "default" : "outline"} onClick={() => setRange(r)} className="h-7 px-3 text-xs font-mono uppercase">
                    {RANGE_LABEL[r]}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Quick stats grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-px bg-border rounded-md overflow-hidden border border-border">
            <Stat label="Open" value={fmt(snap.quote.open)} />
            <Stat label="High" value={fmt(snap.quote.high)} tone="buy" />
            <Stat label="Low" value={fmt(snap.quote.low)} tone="sell" />
            <Stat label="Prev Close" value={fmt(snap.quote.previousClose)} />
            <Stat label="52W High" value={fmt(snap.quote.fiftyTwoWeekHigh)} tone="buy" />
            <Stat label="52W Low" value={fmt(snap.quote.fiftyTwoWeekLow)} tone="sell" />
            <Stat label="Volume" value={fmtVol(snap.quote.volume)} />
            <Stat label="Day Change" value={fmtPct(snap.quote.changePercent)} tone={up ? "buy" : "sell"} />
          </div>

          {/* Chart: Price + EMAs + VWAP */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                {snap.symbol} · {RANGE_LABEL[range]} · Price + EMA 20/50/100/200 + VWAP
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2 pt-1">
              <div className="h-[420px]">
                <ResponsiveContainer>
                  <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }} minTickGap={50} />
                    <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }} width={64} />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
                      formatter={(value: number | string, name: string) => [typeof value === "number" ? value.toFixed(2) : value, name]}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, fontFamily: "monospace" }} />
                    <Area type="monotone" dataKey="close" stroke="hsl(var(--signal-strong-buy))" strokeWidth={1.8} fill="hsl(var(--signal-strong-buy))" fillOpacity={0.05} dot={false} name="Price" />
                    <Line type="monotone" dataKey="vwap"   stroke="hsl(195 90% 60%)" strokeWidth={1.2} dot={false} name="VWAP(20)" strokeDasharray="3 3" />
                    <Line type="monotone" dataKey="ema20"  stroke="hsl(45 95% 60%)"  strokeWidth={1.1} dot={false} name="EMA 20" />
                    <Line type="monotone" dataKey="ema50"  stroke="hsl(280 80% 65%)" strokeWidth={1.1} dot={false} name="EMA 50" />
                    <Line type="monotone" dataKey="ema100" stroke="hsl(20 90% 60%)"  strokeWidth={1.1} dot={false} name="EMA 100" />
                    <Line type="monotone" dataKey="ema200" stroke="hsl(0 80% 65%)"   strokeWidth={1.3} dot={false} name="EMA 200" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Volume bars */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Volume</CardTitle>
            </CardHeader>
            <CardContent className="p-2 pt-1">
              <div className="h-[160px]">
                <ResponsiveContainer>
                  <ComposedChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }} minTickGap={50} />
                    <YAxis tickFormatter={fmtVol} tick={{ fontSize: 10, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }} width={64} />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
                      formatter={(v: number) => [fmtVol(v), "Volume"]}
                    />
                    <Bar dataKey="vol" fill="hsl(210 60% 55%)" opacity={0.7} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Returns */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Period Returns</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px bg-border rounded overflow-hidden border border-border">
                <Stat label="1 Month"  value={fmtPct(snap.returns["1mo"])} tone={(snap.returns["1mo"] ?? 0) >= 0 ? "buy" : "sell"} />
                <Stat label="3 Months" value={fmtPct(snap.returns["3mo"])} tone={(snap.returns["3mo"] ?? 0) >= 0 ? "buy" : "sell"} />
                <Stat label="6 Months" value={fmtPct(snap.returns["6mo"])} tone={(snap.returns["6mo"] ?? 0) >= 0 ? "buy" : "sell"} />
                <Stat label="1 Year"   value={fmtPct(snap.returns["1y"])}  tone={(snap.returns["1y"]  ?? 0) >= 0 ? "buy" : "sell"} />
                <Stat label="3 Years"  value={fmtPct(snap.returns["3y"])}  tone={(snap.returns["3y"]  ?? 0) >= 0 ? "buy" : "sell"} />
                <Stat label="5 Years"  value={fmtPct(snap.returns["5y"])}  tone={(snap.returns["5y"]  ?? 0) >= 0 ? "buy" : "sell"} />
              </div>
            </CardContent>
          </Card>

          {/* Fundamentals (stocks only) */}
          {snap.kind === "stock" && snap.fundamentals && Object.keys(snap.fundamentals).length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Key statistics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-px bg-border rounded overflow-hidden border border-border">
                  {snap.fundamentals.marketCapCr        != null && <Stat label="Market Cap"  value={`₹${(snap.fundamentals.marketCapCr).toLocaleString("en-IN")} Cr`} />}
                  {snap.fundamentals.peRatio            != null && <Stat label="P/E (TTM)"   value={snap.fundamentals.peRatio.toFixed(2)} />}
                  {snap.fundamentals.forwardPe          != null && <Stat label="Fwd P/E"     value={snap.fundamentals.forwardPe.toFixed(2)} />}
                  {snap.fundamentals.pbRatio            != null && <Stat label="P/B"         value={snap.fundamentals.pbRatio.toFixed(2)} />}
                  {snap.fundamentals.priceToSales       != null && <Stat label="P/S"         value={snap.fundamentals.priceToSales.toFixed(2)} />}
                  {snap.fundamentals.dividendYield      != null && <Stat label="Div Yield"   value={`${snap.fundamentals.dividendYield.toFixed(2)}%`} tone={snap.fundamentals.dividendYield > 2 ? "buy" : undefined} />}
                  {snap.fundamentals.eps                != null && <Stat label="EPS"         value={`₹${snap.fundamentals.eps.toFixed(2)}`} />}
                  {snap.fundamentals.bookValue          != null && <Stat label="Book Value"  value={`₹${snap.fundamentals.bookValue.toFixed(2)}`} />}
                  {snap.fundamentals.roe                != null && <Stat label="ROE"         value={`${snap.fundamentals.roe.toFixed(1)}%`}  tone={snap.fundamentals.roe > 15 ? "buy" : snap.fundamentals.roe < 5 ? "sell" : undefined} />}
                  {snap.fundamentals.debtToEquity       != null && <Stat label="Debt/Equity" value={snap.fundamentals.debtToEquity.toFixed(2)} tone={snap.fundamentals.debtToEquity > 100 ? "sell" : snap.fundamentals.debtToEquity < 50 ? "buy" : undefined} />}
                  {snap.fundamentals.profitMargin       != null && <Stat label="Profit Margin"  value={`${snap.fundamentals.profitMargin.toFixed(1)}%`} />}
                  {snap.fundamentals.operatingMargin    != null && <Stat label="Op Margin"      value={`${snap.fundamentals.operatingMargin.toFixed(1)}%`} />}
                  {snap.fundamentals.revenueGrowthYoy   != null && <Stat label="Rev Growth"     value={`${snap.fundamentals.revenueGrowthYoy.toFixed(1)}%`}  tone={snap.fundamentals.revenueGrowthYoy > 0 ? "buy" : "sell"} />}
                  {snap.fundamentals.earningsGrowthYoy  != null && <Stat label="EPS Growth"     value={`${snap.fundamentals.earningsGrowthYoy.toFixed(1)}%`} tone={snap.fundamentals.earningsGrowthYoy > 0 ? "buy" : "sell"} />}
                  {snap.fundamentals.beta               != null && <Stat label="Beta"           value={snap.fundamentals.beta.toFixed(2)} />}
                  {snap.fundamentals.fiftyDayAverage    != null && <Stat label="50D Avg"        value={`₹${snap.fundamentals.fiftyDayAverage.toFixed(2)}`}    tone={snap.quote.price > snap.fundamentals.fiftyDayAverage ? "buy" : "sell"} />}
                  {snap.fundamentals.twoHundredDayAverage != null && <Stat label="200D Avg"    value={`₹${snap.fundamentals.twoHundredDayAverage.toFixed(2)}`} tone={snap.quote.price > snap.fundamentals.twoHundredDayAverage ? "buy" : "sell"} />}
                  {snap.fundamentals.sharesOutstandingCr != null && <Stat label="Shares"       value={`${snap.fundamentals.sharesOutstandingCr.toFixed(2)} Cr`} />}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Profile / catalysts */}
          {snap.description && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Profile</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground leading-relaxed space-y-2">
                <p>{snap.description}</p>
                {snap.profile?.catalysts && snap.profile.catalysts.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {snap.profile.catalysts.map((c, i) => (
                      <Badge key={i} variant="outline" className="font-normal">{c}</Badge>
                    ))}
                  </div>
                )}
                {snap.profile?.seasonality && (
                  <div className="text-xs"><span className="font-mono uppercase">Seasonality:</span> {snap.profile.seasonality}</div>
                )}
              </CardContent>
            </Card>
          )}

          {snap.kind === "stock" && (
            <div className="text-center text-xs text-muted-foreground font-mono">
              Want full financials, holdings, news? <a href={`${import.meta.env.BASE_URL}stock/${snap.symbol}`} className="text-foreground underline">Open the dedicated stock page →</a>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "buy" | "sell" }) {
  const cls = tone === "buy" ? "text-signal-strong-buy" : tone === "sell" ? "text-signal-strong-sell" : "text-foreground";
  return (
    <div className="bg-card p-2.5">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-mono text-sm font-bold tabular-nums mt-0.5 ${cls}`}>{value}</div>
    </div>
  );
}
