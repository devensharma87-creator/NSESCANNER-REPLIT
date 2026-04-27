import { useRoute, Link } from "wouter";
import { useState } from "react";
import {
  useGetStockDetail,
  getGetStockDetailQueryKey,
  useGetStockHistory,
  getGetStockHistoryQueryKey,
  useGetNews,
  getGetNewsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SignalBadge } from "@/components/ui/signal-badge";
import { ScoreBar } from "@/components/ui/score-bar";
import { ArrowLeft, TrendingUp, TrendingDown, Target, ShieldAlert, ExternalLink } from "lucide-react";
import { TradingViewChart } from "@/components/tradingview-chart";
import StockStatements from "@/components/stock-statements";
import { formatDistanceToNow } from "date-fns";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Legend,
  Area,
  ComposedChart,
} from "recharts";

const RANGES = ["1mo", "3mo", "6mo", "1y", "2y"] as const;
type Range = typeof RANGES[number];

export default function StockDetail() {
  const [, params] = useRoute<{ symbol: string }>("/stock/:symbol");
  const symbol = params?.symbol ? decodeURIComponent(params.symbol).toUpperCase() : "";
  const [range, setRange] = useState<Range>("6mo");

  const { data: detail, isLoading } = useGetStockDetail(symbol, {
    query: { enabled: !!symbol, refetchInterval: 30_000, queryKey: getGetStockDetailQueryKey(symbol) },
  });
  const { data: history, isLoading: histLoading } = useGetStockHistory(symbol, { range }, {
    query: { enabled: !!symbol, queryKey: getGetStockHistoryQueryKey(symbol, { range }) },
  });
  const { data: news } = useGetNews({ symbol }, {
    query: { enabled: !!symbol, queryKey: getGetNewsQueryKey({ symbol }) },
  });

  const fmtPct = (p: number) => `${p > 0 ? "+" : ""}${p.toFixed(2)}%`;
  const fmtPrice = (p: number) => p.toFixed(2);

  if (isLoading || !detail) {
    return (
      <div className="w-full max-w-none px-4 py-6 space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const { profile, quote, indicators, recommendation, financials, holdings } = detail;
  const upDay = quote.changePercent >= 0;

  const chartData = history?.candles.map((c, i) => ({
    t: new Date(c.t).getTime(),
    label: new Date(c.t).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
    close: c.c,
    ema20: history.ema20Series?.[i] ?? null,
    ema50: history.ema50Series?.[i] ?? null,
    rsi: history.rsiSeries?.[i] ?? null,
  })) ?? [];

  return (
    <div className="w-full max-w-none px-4 py-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <Link href="/" className="inline-flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" /> SCANNER
          </Link>
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1 className="text-3xl font-bold font-mono tracking-tight">{profile.symbol}</h1>
            <span className="text-muted-foreground">{profile.name}</span>
            <Badge variant="outline" className="font-mono text-[10px] uppercase">{profile.sector}</Badge>
            <Badge variant="outline" className="font-mono text-[10px] uppercase">{profile.industry}</Badge>
          </div>
        </div>
        <div className="text-right space-y-1">
          <div className="flex items-baseline gap-3 justify-end">
            <span className="text-3xl font-mono font-bold tabular-nums">₹{fmtPrice(quote.price)}</span>
            <span className={`font-mono text-sm font-semibold inline-flex items-center gap-1 ${upDay ? "text-signal-strong-buy" : "text-signal-strong-sell"}`}>
              {upDay ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              {fmtPct(quote.changePercent)}
              <span className="text-xs text-muted-foreground ml-1">({quote.change >= 0 ? "+" : ""}{quote.change.toFixed(2)})</span>
            </span>
          </div>
          <div className="text-xs text-muted-foreground font-mono">
            Updated {formatDistanceToNow(new Date(quote.updatedAt))} ago
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-px bg-border rounded-md overflow-hidden border border-border">
        <Stat label="Open" value={fmtPrice(quote.open)} />
        <Stat label="High" value={fmtPrice(quote.high)} tone="buy" />
        <Stat label="Low" value={fmtPrice(quote.low)} tone="sell" />
        <Stat label="Prev Close" value={fmtPrice(quote.previousClose)} />
        <Stat label="Day Range" value={quote.dayRange ?? "—"} />
        <Stat label="52W Range" value={quote.yearRange ?? "—"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1 border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Recommendation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <SignalBadge signal={recommendation.signal} />
              <span className="font-mono text-xs text-muted-foreground">Confidence {recommendation.confidence}%</span>
            </div>
            <ScoreBar score={recommendation.score} />
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="rounded border border-signal-strong-buy/30 bg-signal-strong-buy/5 p-2">
                <div className="text-[10px] font-mono uppercase text-muted-foreground flex items-center gap-1"><Target className="w-3 h-3" />Target</div>
                <div className="font-mono font-bold text-signal-strong-buy">{recommendation.target ? `₹${recommendation.target.toFixed(2)}` : "—"}</div>
              </div>
              <div className="rounded border border-signal-strong-sell/30 bg-signal-strong-sell/5 p-2">
                <div className="text-[10px] font-mono uppercase text-muted-foreground flex items-center gap-1"><ShieldAlert className="w-3 h-3" />Stop</div>
                <div className="font-mono font-bold text-signal-strong-sell">{recommendation.stopLoss ? `₹${recommendation.stopLoss.toFixed(2)}` : "—"}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Why this signal</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {recommendation.reasons.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className={`mt-1 inline-block w-1.5 h-1.5 rounded-full shrink-0 ${r.bullish ? "bg-signal-strong-buy" : "bg-signal-strong-sell"}`} />
                  <div>
                    <div className="font-medium">{r.label} <span className="text-[10px] font-mono text-muted-foreground ml-1">w{r.weight}</span></div>
                    <div className="text-muted-foreground text-xs">{r.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="bg-card border border-border">
          <TabsTrigger value="overview" className="font-mono text-xs uppercase">Overview</TabsTrigger>
          <TabsTrigger value="chart" className="font-mono text-xs uppercase">Chart</TabsTrigger>
          <TabsTrigger value="financials" className="font-mono text-xs uppercase">Financials</TabsTrigger>
          <TabsTrigger value="holdings" className="font-mono text-xs uppercase">Holdings</TabsTrigger>
          <TabsTrigger value="news" className="font-mono text-xs uppercase">News</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Indicators</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-px bg-border rounded overflow-hidden border border-border">
                <Stat label="EMA 20" value={indicators.ema20 != null ? `₹${indicators.ema20.toFixed(2)}` : "—"} tone={indicators.ema20 != null ? (quote.price > indicators.ema20 ? "buy" : "sell") : undefined} />
                <Stat label="EMA 50" value={indicators.ema50 != null ? `₹${indicators.ema50.toFixed(2)}` : "—"} tone={indicators.ema50 != null ? (quote.price > indicators.ema50 ? "buy" : "sell") : undefined} />
                <Stat label="RSI 14" value={indicators.rsi14 != null ? indicators.rsi14.toFixed(1) : "—"} tone={indicators.rsi14 != null ? (indicators.rsi14 > 70 ? "sell" : indicators.rsi14 < 30 ? "buy" : undefined) : undefined} />
                <Stat label="ATR 14" value={indicators.atr14?.toFixed(2) ?? "—"} />
                <Stat label="Vol Ratio" value={`${indicators.volumeRatio?.toFixed(2) ?? "—"}×`} tone={(indicators.volumeRatio ?? 1) >= 1.5 ? "buy" : undefined} />
                <Stat label="Delivery %" value={`${indicators.deliveryPct?.toFixed(1) ?? "—"}%`} />
                <Stat label="Support" value={`₹${indicators.supportLevel?.toFixed(2) ?? "—"}`} tone="sell" />
                <Stat label="Resistance" value={`₹${indicators.resistanceLevel?.toFixed(2) ?? "—"}`} tone="buy" />
                <Stat label="POC" value={indicators.pointOfControl ? `₹${indicators.pointOfControl.toFixed(2)}` : "—"} />
                <Stat label="VAL" value={indicators.valueAreaLow ? `₹${indicators.valueAreaLow.toFixed(2)}` : "—"} />
                <Stat label="VAH" value={indicators.valueAreaHigh ? `₹${indicators.valueAreaHigh.toFixed(2)}` : "—"} />
                <Stat label="Trend" value={`${indicators.trendStrength ?? "—"}/100`} tone={(indicators.trendStrength ?? 50) > 60 ? "buy" : (indicators.trendStrength ?? 50) < 40 ? "sell" : undefined} />
              </div>
            </CardContent>
          </Card>

          {/* Key Stats / Fundamentals */}
          {profile.keyStats && Object.keys(profile.keyStats).length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Key statistics</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-px bg-border rounded overflow-hidden border border-border">
                  {profile.keyStats.marketCapCr != null && <Stat label="Market Cap" value={`₹${formatCr(profile.keyStats.marketCapCr)} Cr`} />}
                  {profile.keyStats.peRatio != null && <Stat label="P/E (TTM)" value={profile.keyStats.peRatio.toFixed(2)} />}
                  {profile.keyStats.forwardPe != null && <Stat label="Fwd P/E" value={profile.keyStats.forwardPe.toFixed(2)} />}
                  {profile.keyStats.pbRatio != null && <Stat label="P/B" value={profile.keyStats.pbRatio.toFixed(2)} />}
                  {profile.keyStats.priceToSales != null && <Stat label="P/S" value={profile.keyStats.priceToSales.toFixed(2)} />}
                  {profile.keyStats.dividendYield != null && <Stat label="Div Yield" value={`${profile.keyStats.dividendYield.toFixed(2)}%`} tone={profile.keyStats.dividendYield > 2 ? "buy" : undefined} />}
                  {profile.keyStats.eps != null && <Stat label="EPS" value={`₹${profile.keyStats.eps.toFixed(2)}`} />}
                  {profile.keyStats.bookValue != null && <Stat label="Book Value" value={`₹${profile.keyStats.bookValue.toFixed(2)}`} />}
                  {profile.keyStats.roe != null && <Stat label="ROE" value={`${profile.keyStats.roe.toFixed(1)}%`} tone={profile.keyStats.roe > 15 ? "buy" : profile.keyStats.roe < 5 ? "sell" : undefined} />}
                  {profile.keyStats.debtToEquity != null && <Stat label="Debt/Equity" value={profile.keyStats.debtToEquity.toFixed(2)} tone={profile.keyStats.debtToEquity > 100 ? "sell" : profile.keyStats.debtToEquity < 50 ? "buy" : undefined} />}
                  {profile.keyStats.profitMargin != null && <Stat label="Profit Margin" value={`${profile.keyStats.profitMargin.toFixed(1)}%`} />}
                  {profile.keyStats.operatingMargin != null && <Stat label="Op Margin" value={`${profile.keyStats.operatingMargin.toFixed(1)}%`} />}
                  {profile.keyStats.revenueGrowthYoy != null && <Stat label="Rev Growth" value={`${profile.keyStats.revenueGrowthYoy.toFixed(1)}%`} tone={profile.keyStats.revenueGrowthYoy > 0 ? "buy" : "sell"} />}
                  {profile.keyStats.earningsGrowthYoy != null && <Stat label="EPS Growth" value={`${profile.keyStats.earningsGrowthYoy.toFixed(1)}%`} tone={profile.keyStats.earningsGrowthYoy > 0 ? "buy" : "sell"} />}
                  {profile.keyStats.beta != null && <Stat label="Beta" value={profile.keyStats.beta.toFixed(2)} />}
                  {profile.keyStats.fiftyDayAverage != null && <Stat label="50D Avg" value={`₹${profile.keyStats.fiftyDayAverage.toFixed(2)}`} tone={quote.price > profile.keyStats.fiftyDayAverage ? "buy" : "sell"} />}
                  {profile.keyStats.twoHundredDayAverage != null && <Stat label="200D Avg" value={`₹${profile.keyStats.twoHundredDayAverage.toFixed(2)}`} tone={quote.price > profile.keyStats.twoHundredDayAverage ? "buy" : "sell"} />}
                  {profile.keyStats.sharesOutstandingCr != null && <Stat label="Shares" value={`${profile.keyStats.sharesOutstandingCr.toFixed(2)} Cr`} />}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Peers */}
          {profile.peers && profile.peers.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Sector peers</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                  {profile.peers.map(p => {
                    const up = (p.changePercent ?? 0) >= 0;
                    return (
                      <Link key={p.symbol} href={`/stock/${p.symbol}`} className="border border-border rounded p-2 hover:border-foreground/40 transition-colors">
                        <div className="font-mono font-bold text-sm">{p.symbol}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{p.name}</div>
                        <div className="flex justify-between mt-1 text-xs font-mono">
                          {p.price != null && <span className="tabular-nums">₹{p.price.toFixed(2)}</span>}
                          {p.changePercent != null && (
                            <span className={`tabular-nums font-semibold ${up ? "text-signal-strong-buy" : "text-signal-strong-sell"}`}>
                              {up ? "+" : ""}{p.changePercent.toFixed(2)}%
                            </span>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Profile & catalysts</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground leading-relaxed">{profile.description}</p>
              {profile.catalysts && profile.catalysts.length > 0 && (
                <div>
                  <div className="text-[11px] font-mono uppercase text-muted-foreground mb-1">Key catalysts</div>
                  <div className="flex flex-wrap gap-1.5">
                    {profile.catalysts.map((c, i) => (
                      <Badge key={i} variant="outline" className="font-normal">{c}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {profile.seasonality && (
                <div className="text-xs text-muted-foreground"><span className="font-mono uppercase">Seasonality:</span> {profile.seasonality}</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="chart" className="space-y-4">
          <Card>
            <CardHeader className="border-b border-border pb-3">
              <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                TradingView · Live Chart
                <span className="text-[10px] text-muted-foreground/70 normal-case tracking-normal">(EMA 9/21 · RSI · VWAP preloaded · sign in to TV for your own templates)</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <TradingViewChart symbol={`NSE:${profile.symbol}`} interval="15" height={560} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between border-b border-border pb-3">
              <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Daily Price · EMA 20 · EMA 50 (in-app)</CardTitle>
              <div className="flex gap-1">
                {RANGES.map(r => (
                  <Button key={r} size="sm" variant={r === range ? "default" : "outline"} onClick={() => setRange(r)} className="h-7 px-2 text-xs font-mono uppercase">
                    {r}
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {histLoading || !history ? <Skeleton className="h-[340px] w-full" /> : (
                <div className="h-[340px]">
                  <ResponsiveContainer>
                    <ComposedChart data={chartData} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }} minTickGap={32} />
                      <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }} width={56} />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 11, fontFamily: "monospace" }} />
                      <Area type="monotone" dataKey="close" stroke="hsl(var(--signal-strong-buy))" strokeWidth={1.6} fill="hsl(var(--signal-strong-buy))" fillOpacity={0.06} dot={false} name="Price" />
                      <Line type="monotone" dataKey="ema20" stroke="hsl(45 93% 58%)" strokeWidth={1.2} dot={false} name="EMA 20" />
                      <Line type="monotone" dataKey="ema50" stroke="hsl(280 80% 65%)" strokeWidth={1.2} dot={false} name="EMA 50" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b border-border pb-3">
              <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">RSI 14</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              {histLoading || !history ? <Skeleton className="h-[180px] w-full" /> : (
                <div className="h-[180px]">
                  <ResponsiveContainer>
                    <LineChart data={chartData} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }} minTickGap={32} />
                      <YAxis domain={[0, 100]} ticks={[0, 30, 50, 70, 100]} tick={{ fontSize: 10, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }} width={36} />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                      <ReferenceLine y={70} stroke="hsl(var(--signal-strong-sell))" strokeDasharray="3 3" />
                      <ReferenceLine y={30} stroke="hsl(var(--signal-strong-buy))" strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="rsi" stroke="hsl(210 80% 65%)" strokeWidth={1.4} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="financials" className="space-y-4">
          <StockStatements symbol={symbol} />
        </TabsContent>

        <TabsContent value="holdings">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Shareholding pattern (%)</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-border">
                      <TableHead className="font-mono text-xs">PERIOD</TableHead>
                      <TableHead className="font-mono text-xs text-right">PROMOTER</TableHead>
                      <TableHead className="font-mono text-xs text-right">FII</TableHead>
                      <TableHead className="font-mono text-xs text-right">DII</TableHead>
                      <TableHead className="font-mono text-xs text-right">PUBLIC</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {holdings.slice().reverse().map((h, i) => (
                      <TableRow key={i} className="border-border/50">
                        <TableCell className="font-mono text-sm">{h.period}</TableCell>
                        <TableCell className="text-right font-mono text-sm tabular-nums">{h.promoter?.toFixed(1) ?? "—"}</TableCell>
                        <TableCell className="text-right font-mono text-sm tabular-nums">{h.fii?.toFixed(1) ?? "—"}</TableCell>
                        <TableCell className="text-right font-mono text-sm tabular-nums">{h.dii?.toFixed(1) ?? "—"}</TableCell>
                        <TableCell className="text-right font-mono text-sm tabular-nums">{h.public?.toFixed(1) ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="news" className="space-y-3">
          {(news ?? []).map(item => (
            <Card key={item.id}>
              <CardContent className="p-4 space-y-1">
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline inline-flex items-start gap-1.5">
                  {item.title} <ExternalLink className="w-3.5 h-3.5 mt-1 text-muted-foreground" />
                </a>
                {item.summary && <p className="text-sm text-muted-foreground">{item.summary}</p>}
                <div className="text-[11px] font-mono text-muted-foreground uppercase">{item.source} · {formatDistanceToNow(new Date(item.publishedAt))} ago</div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "buy" | "sell" }) {
  const cls = tone === "buy" ? "text-signal-strong-buy" : tone === "sell" ? "text-signal-strong-sell" : "text-foreground";
  return (
    <div className="bg-card p-3">
      <div className="text-[10px] font-mono uppercase text-muted-foreground tracking-wider">{label}</div>
      <div className={`mt-1 font-mono text-sm font-semibold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}

function formatCr(n: number): string {
  // n is in crore. Above 1 lakh crore → show in lakh-crore.
  if (n >= 100000) return `${(n / 100000).toFixed(2)} L`;
  if (n >= 1000) return `${(n / 1000).toFixed(2)}k`;
  return n.toFixed(0);
}
