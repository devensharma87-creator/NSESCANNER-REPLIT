import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, TrendingUp, TrendingDown } from "lucide-react";
import { KiteOfflineBanner, KiteOfflineNote } from "@/components/kite-offline-banner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SignalBadge } from "@/components/ui/signal-badge";
import { ScoreBar } from "@/components/ui/score-bar";
import { DataSourceBadge } from "@/components/ui/data-source-badge";
import { TrendlyneInsights } from "@/components/trendlyne-widget";
import { QuickBuyEqDialog } from "@/components/quick-buy-eq-dialog";
import {
  useGetStockDetail,
  getGetStockDetailQueryKey,
} from "@workspace/api-client-react";
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
  provenance?: {
    sourceProvider: "kite" | "yahoo" | null;
    trustTier: "authoritative" | "secondary_analytics" | "unavailable";
    delayed: boolean;
    notForSignals: boolean;
    notForTradeDecisions: boolean;
    asOf: number | null;
    freshnessSec: number | null;
    isStale: boolean | null;
    missingReason: string | null;
    warnings: string[];
  };
  intradayFallback?: boolean;
}

const RANGES = ["1d", "1wk", "1mo", "3mo", "6mo", "1y", "3y", "5y"] as const;
type Range = typeof RANGES[number];

const RANGE_LABEL: Record<Range, string> = {
  "1d": "1D", "1wk": "1W", "1mo": "1M", "3mo": "3M", "6mo": "6M", "1y": "1Y", "3y": "3Y", "5y": "5Y",
};

// Colors must match the Recharts <Line>/<Area> stroke colors below so the
// sidebar dots line up visually with the curves on the chart.
const SERIES_COLOR: Record<string, string> = {
  Price:      "hsl(var(--signal-strong-buy))",
  "VWAP(20)": "hsl(195 90% 60%)",
  "EMA 20":   "hsl(45 95% 60%)",
  "EMA 50":   "hsl(280 80% 65%)",
  "EMA 100":  "hsl(20 90% 60%)",
  "EMA 200":  "hsl(0 80% 65%)",
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
  const [buyOpen, setBuyOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Default symbol on first load — honor `?sym=...&kind=...` if present so peer
  // cards / external links can deep-link straight into a stock.
  useEffect(() => {
    if (active) return;
    const params = new URLSearchParams(window.location.search);
    const sym = params.get("sym");
    const rawKind = params.get("kind");
    // Validate `kind` against LookupKind union — an unchecked cast would let
    // garbage values slip through and silently disable the stock-detail query
    // (which is gated on `kind === "stock"`).
    const kindParam: LookupKind | null =
      rawKind === "stock" || rawKind === "index" ? rawKind : null;
    if (sym) {
      setActive({ kind: kindParam ?? "stock", symbol: sym.toUpperCase(), name: sym.toUpperCase() });
    } else {
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

  // Pull the same Scanner-grade row (recommendation signal+score+reasons,
  // VWAP/EMA9/EMA21/RSI/MACD/ATR/ADX, support/resistance, pivots, value area,
  // peers, news) for stocks. Indices are skipped because the endpoint is
  // equity-only.
  const stockSym = active?.kind === "stock" ? active.symbol : "";
  const detailQ = useGetStockDetail(stockSym, {
    query: {
      enabled: !!stockSym,
      refetchInterval: 30_000,
      queryKey: getGetStockDetailQueryKey(stockSym),
    },
  });

  const select = (item: LookupItem) => {
    setActive(item);
    setQuery("");
    setOpen(false);
  };

  // Chart data — intraday ranges (1D/1W) get a HH:MM label, daily ranges get day-month.
  const chartData = useMemo(() => {
    if (!snapQ.data) return [];
    const { candles, series } = snapQ.data;
    const isIntraday = range === "1d" || range === "1wk";
    return candles.map((c, i) => {
      const d = new Date(c.t);
      const label = isIntraday
        ? (range === "1d"
            ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })
            : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) + " " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }))
        : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: range === "5y" || range === "3y" ? "2-digit" : undefined });
      return {
        label,
        close: c.c,
        vol: c.v,
        ema20:  series.ema20[i]  ?? null,
        ema50:  series.ema50[i]  ?? null,
        ema100: series.ema100[i] ?? null,
        ema200: series.ema200[i] ?? null,
        vwap:   series.vwap20[i] ?? null,
      };
    });
  }, [snapQ.data, range]);

  const snap = snapQ.data;
  const up = (snap?.quote.changePercent ?? 0) >= 0;

  return (
    <div className="w-full max-w-none px-4 py-6 space-y-6">
      <KiteOfflineBanner />
      {/* Header / search */}
      <div className="flex flex-col items-center gap-3">
        <div className="text-center">
          <h1 className="text-2xl font-bold font-mono tracking-tight">DEEP SCAN</h1>
          <p className="text-xs text-muted-foreground font-mono">Search any NSE stock or Indian index — full chart, EMAs, VWAP, returns, fundamentals.</p>
          <div className="mt-2 flex justify-center">
            <DataSourceBadge source="mixed" status="delayed" refreshMs={30_000} note="Live Kite price quote · Yahoo daily history for indicators (delayed ~15 min) · server-computed signals" />
          </div>
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
                    className="w-full text-left flex items-center justify-between gap-3 px-3 py-2 hover-row border-b border-border/50 last:border-0"
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
                  className="w-full text-left px-3 py-2 hover-row border-t border-border/50"
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
          <CardContent className="p-4 space-y-2 text-sm font-mono text-signal-strong-sell">
            <div>Could not load snapshot for <b>{active.symbol}</b>. {(snapQ.error as Error | undefined)?.message ?? ""}</div>
            <KiteOfflineNote area="Deep Scan snapshot" />
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
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground font-mono">
                    <span>
                      {(snap.provenance?.sourceProvider ?? "yahoo") === "kite" ? "Kite" : "Yahoo"}: {snap.ticker} · Updated {new Date(snap.quote.updatedAt).toLocaleTimeString("en-IN")}
                    </span>
                    {(snap.provenance?.trustTier ?? "secondary_analytics") === "secondary_analytics" && (
                      <Badge
                        variant="outline"
                        className="font-mono text-[9px] uppercase border-amber-500/40 text-amber-400"
                        title="Delayed reference data (Yahoo, ~15min). Analytics only — never used for scanner signals or trade decisions."
                      >
                        Delayed · analytics only
                      </Badge>
                    )}
                    {snap.provenance?.isStale && (
                      <Badge
                        variant="outline"
                        className="font-mono text-[9px] uppercase border-signal-strong-sell/40 text-signal-strong-sell"
                        title="Data is older than the freshness window for this timeframe."
                      >
                        Stale
                      </Badge>
                    )}
                    {snap.intradayFallback && (
                      <Badge
                        variant="outline"
                        className="font-mono text-[9px] uppercase border-amber-500/40 text-amber-400"
                        title="Intraday data was unavailable; showing the last daily bars instead."
                      >
                        Daily fallback
                      </Badge>
                    )}
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
                  {snap.kind === "stock" && (
                    <div className="flex justify-end pt-1">
                      <Button
                        size="sm"
                        onClick={() => setBuyOpen(true)}
                        className="h-7 px-3 text-xs font-mono uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white"
                        data-testid="button-deepscan-buy"
                        title={`Paper-buy ${snap.symbol}. Capital safety gates still apply.`}
                      >
                        Buy {snap.symbol}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
              <QuickBuyEqDialog
                open={buyOpen}
                onClose={() => setBuyOpen(false)}
                defaultSymbol={snap.kind === "stock" ? snap.symbol : ""}
              />

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

          {/* Chart: Price + EMAs + VWAP — with right-side ladder of latest values */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                {snap.symbol} · {RANGE_LABEL[range]} · Price + EMA 20/50/100/200 + VWAP
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2 pt-1">
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-3 items-start">
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
                      <Area type="monotone" dataKey="close" stroke={SERIES_COLOR.Price}      strokeWidth={1.8} fill={SERIES_COLOR.Price} fillOpacity={0.05} dot={false} name="Price" />
                      <Line type="monotone" dataKey="vwap"  stroke={SERIES_COLOR["VWAP(20)"]} strokeWidth={1.2} dot={false} name="VWAP(20)" strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="ema20"  stroke={SERIES_COLOR["EMA 20"]}  strokeWidth={1.1} dot={false} name="EMA 20" />
                      <Line type="monotone" dataKey="ema50"  stroke={SERIES_COLOR["EMA 50"]}  strokeWidth={1.1} dot={false} name="EMA 50" />
                      <Line type="monotone" dataKey="ema100" stroke={SERIES_COLOR["EMA 100"]} strokeWidth={1.1} dot={false} name="EMA 100" />
                      <Line type="monotone" dataKey="ema200" stroke={SERIES_COLOR["EMA 200"]} strokeWidth={1.3} dot={false} name="EMA 200" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <LevelsLadder data={chartData} kind={snap.kind} />
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

          {/* Live Scanner snapshot — same data the /scanner table shows for this stock:
              recommendation, technicals, support/resistance, value area, peers. Stocks only. */}
          {snap.kind === "stock" && detailQ.data && (
            <ScannerSnapshot detail={detailQ.data} />
          )}

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
            <>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                    Trendlyne insights
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  SWOT, checklist, QVT score and analyst forecaster — live from Trendlyne. Blank cards mean the symbol is not tracked there.
                </CardContent>
              </Card>
              <TrendlyneInsights symbol={snap.symbol} />
              <div className="text-center text-xs text-muted-foreground font-mono">
                Want full financials, holdings, news? <a href={`${import.meta.env.BASE_URL}stock/${snap.symbol}`} className="text-foreground underline">Open the dedicated stock page →</a>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Right-side ladder showing the most-recent values of Price + VWAP + each EMA,
 * sorted high → low so the user can see relative ordering at a glance. The
 * coloured dot before each label matches the corresponding line on the chart.
 */
function LevelsLadder({
  data, kind,
}: {
  data: Array<{ label: string; close: number; vwap: number | null; ema20: number | null; ema50: number | null; ema100: number | null; ema200: number | null }>;
  kind: LookupKind;
}) {
  if (!data.length) return null;
  const last = data[data.length - 1];
  const rows: { name: keyof typeof SERIES_COLOR; value: number }[] = [];
  if (Number.isFinite(last.close))   rows.push({ name: "Price",     value: last.close });
  if (last.vwap   != null && kind === "stock") rows.push({ name: "VWAP(20)",  value: last.vwap   });
  if (last.ema20  != null) rows.push({ name: "EMA 20",   value: last.ema20  });
  if (last.ema50  != null) rows.push({ name: "EMA 50",   value: last.ema50  });
  if (last.ema100 != null) rows.push({ name: "EMA 100",  value: last.ema100 });
  if (last.ema200 != null) rows.push({ name: "EMA 200",  value: last.ema200 });
  rows.sort((a, b) => b.value - a.value);

  const prefix = kind === "stock" ? "₹" : "";

  return (
    <div className="rounded-md border border-border bg-card/60 p-3 lg:sticky lg:top-2">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
        {last.label}
      </div>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.name} className="flex items-center justify-between gap-3 font-mono">
            <span className="inline-flex items-center gap-2 text-[12px]" style={{ color: SERIES_COLOR[r.name] }}>
              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: SERIES_COLOR[r.name] }} />
              {r.name}
            </span>
            <span className="text-[12px] font-bold tabular-nums" style={{ color: SERIES_COLOR[r.name] }}>
              {prefix}{fmt(r.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Renders the same Scanner-grade payload (recommendation + technicals +
 * support/resistance + value-area + reasons + peers) that the /scanner table
 * shows for a single stock — but as a richer, vertically-stacked view that
 * fits inside Deep Scan. We only render this when the active symbol is a
 * stock (the stock-detail endpoint is equity-only).
 */
function ScannerSnapshot({
  detail,
}: {
  detail: {
    quote: { price: number; volume?: number | null; avgVolume?: number | null };
    indicators?: {
      ema9?: number | null; ema21?: number | null;
      ema20?: number | null; ema50?: number | null; ema100?: number | null; ema200?: number | null;
      vwap?: number | null;
      rsi14?: number | null;
      macd?: number | null; macdSignal?: number | null; macdHist?: number | null;
      atr14?: number | null; adx14?: number | null;
      volumeRatio?: number | null; deliveryPct?: number | null; trendStrength?: number | null;
      supportLevel?: number | null; resistanceLevel?: number | null;
      pivot?: number | null; r1?: number | null; s1?: number | null;
      valueAreaHigh?: number | null; valueAreaLow?: number | null; pointOfControl?: number | null;
    };
    recommendation: {
      signal: "STRONG_BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG_SELL";
      score: number;
      confidence?: number;
      timeframe?: string;
      target?: number; stopLoss?: number; riskRewardRatio?: number;
      reasons?: Array<{ label: string; detail?: string; weight: number; bullish: boolean }>;
    };
    profile?: {
      peers?: Array<{ symbol: string; name: string; price?: number; changePercent?: number }>;
    };
  };
}) {
  const ind = detail.indicators ?? {};
  const rec = detail.recommendation;
  const peers = detail.profile?.peers ?? [];
  const reasons = (rec.reasons ?? []).slice().sort((a, b) => b.weight - a.weight);
  const fmtRs = (n: number | null | undefined) => n == null ? "—" : `₹${n.toFixed(2)}`;
  const fmtN  = (n: number | null | undefined, dp = 2) => n == null ? "—" : n.toFixed(dp);

  return (
    <>
      {/* Recommendation header — signal badge, score bar, target/SL/RR */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Live Scanner Signal
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <SignalBadge signal={rec.signal} />
            <div className="flex-1 min-w-[180px] max-w-[360px]">
              <ScoreBar score={rec.score} />
            </div>
            {rec.confidence != null && (
              <div className="font-mono text-[11px] text-muted-foreground">
                Confidence <span className="text-foreground font-bold">{rec.confidence}</span>
              </div>
            )}
            {rec.timeframe && (
              <Badge variant="outline" className="font-mono text-[10px] uppercase">{rec.timeframe}</Badge>
            )}
          </div>
          <div className="grid grid-cols-3 gap-px bg-border rounded overflow-hidden border border-border">
            <Stat label="Target"  value={fmtRs(rec.target)}   tone="buy"  />
            <Stat label="Stoploss" value={fmtRs(rec.stopLoss)} tone="sell" />
            <Stat label="R : R"   value={rec.riskRewardRatio != null ? `${rec.riskRewardRatio.toFixed(2)} : 1` : "—"} />
          </div>
        </CardContent>
      </Card>

      {/* Technical indicators — same fields the /scanner table sorts by */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Technicals
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-px bg-border rounded overflow-hidden border border-border">
            <Stat label="VWAP"   value={fmtRs(ind.vwap)}   tone={ind.vwap   != null ? (detail.quote.price >= ind.vwap   ? "buy" : "sell") : undefined} />
            <Stat label="EMA 9"  value={fmtRs(ind.ema9)}   tone={ind.ema9   != null ? (detail.quote.price >= ind.ema9   ? "buy" : "sell") : undefined} />
            <Stat label="EMA 21" value={fmtRs(ind.ema21)}  tone={ind.ema21  != null ? (detail.quote.price >= ind.ema21  ? "buy" : "sell") : undefined} />
            <Stat label="EMA 20" value={fmtRs(ind.ema20)}  tone={ind.ema20  != null ? (detail.quote.price >= ind.ema20  ? "buy" : "sell") : undefined} />
            <Stat label="EMA 50" value={fmtRs(ind.ema50)}  tone={ind.ema50  != null ? (detail.quote.price >= ind.ema50  ? "buy" : "sell") : undefined} />
            <Stat label="EMA 100" value={fmtRs(ind.ema100)} tone={ind.ema100 != null ? (detail.quote.price >= ind.ema100 ? "buy" : "sell") : undefined} />
            <Stat label="EMA 200" value={fmtRs(ind.ema200)} tone={ind.ema200 != null ? (detail.quote.price >= ind.ema200 ? "buy" : "sell") : undefined} />
            <Stat label="RSI(14)" value={fmtN(ind.rsi14, 1)} tone={ind.rsi14 != null && ind.rsi14 > 70 ? "sell" : ind.rsi14 != null && ind.rsi14 < 30 ? "buy" : undefined} />
            <Stat label="MACD"      value={fmtN(ind.macd)} />
            <Stat label="MACD Sig"  value={fmtN(ind.macdSignal)} />
            <Stat label="MACD Hist" value={fmtN(ind.macdHist)} tone={ind.macdHist != null ? (ind.macdHist >= 0 ? "buy" : "sell") : undefined} />
            <Stat label="ATR(14)"   value={fmtN(ind.atr14)} />
            <Stat label="ADX(14)"   value={fmtN(ind.adx14, 1)} tone={ind.adx14 != null && ind.adx14 > 25 ? "buy" : undefined} />
            <Stat label="Vol ×"     value={ind.volumeRatio != null ? `${ind.volumeRatio.toFixed(2)}×` : "—"} tone={ind.volumeRatio != null && ind.volumeRatio > 2 ? "buy" : undefined} />
            <Stat label="Delivery"  value={ind.deliveryPct != null ? `${ind.deliveryPct.toFixed(1)}%` : "—"} tone={ind.deliveryPct != null && ind.deliveryPct > 60 ? "buy" : undefined} />
            <Stat label="Trend Str" value={ind.trendStrength != null ? `${ind.trendStrength}` : "—"} />
          </div>
        </CardContent>
      </Card>

      {/* Levels — support/resistance, classical pivots, value area / POC */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Levels &amp; Value Area
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-px bg-border rounded overflow-hidden border border-border">
            <Stat label="Support"      value={fmtRs(ind.supportLevel)}    tone="buy"  />
            <Stat label="Resistance"   value={fmtRs(ind.resistanceLevel)} tone="sell" />
            <Stat label="Pivot"        value={fmtRs(ind.pivot)} />
            <Stat label="R1"           value={fmtRs(ind.r1)} tone="sell" />
            <Stat label="S1"           value={fmtRs(ind.s1)} tone="buy"  />
            <Stat label="VAH"          value={fmtRs(ind.valueAreaHigh)} />
            <Stat label="VAL"          value={fmtRs(ind.valueAreaLow)} />
            <Stat label="POC"          value={fmtRs(ind.pointOfControl)} />
          </div>
        </CardContent>
      </Card>

      {/* Why this signal — same reasons surfaced in the Scanner row tooltip */}
      {reasons.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              Why this signal
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {reasons.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className={`font-mono font-bold w-5 shrink-0 ${r.bullish ? "text-signal-strong-buy" : "text-signal-strong-sell"}`}>
                    {r.bullish ? "+" : "−"}
                  </span>
                  <span className="font-mono text-xs uppercase tracking-wider w-44 shrink-0 text-foreground/90">
                    {r.label}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground w-12 shrink-0 text-right">
                    w{r.weight}
                  </span>
                  <span className="text-xs text-muted-foreground flex-1">{r.detail}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Sector peers — clickable, top 6 by score */}
      {peers.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              Sector peers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
              {peers.map((p) => {
                const up = (p.changePercent ?? 0) >= 0;
                return (
                  <a
                    key={p.symbol}
                    href={`${import.meta.env.BASE_URL}deep-scan?sym=${encodeURIComponent(p.symbol)}`}
                    className="block rounded border border-border bg-card/60 hover:border-foreground/40 hover-row p-2 transition-colors"
                  >
                    <div className="font-mono font-bold text-sm">{p.symbol}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{p.name}</div>
                    <div className="flex items-baseline justify-between gap-1 mt-1">
                      <span className="font-mono text-xs tabular-nums">{p.price != null ? `₹${p.price.toFixed(2)}` : "—"}</span>
                      <span className={`font-mono text-[11px] font-semibold ${up ? "text-signal-strong-buy" : "text-signal-strong-sell"}`}>
                        {p.changePercent != null ? `${up ? "+" : ""}${p.changePercent.toFixed(2)}%` : "—"}
                      </span>
                    </div>
                  </a>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </>
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
