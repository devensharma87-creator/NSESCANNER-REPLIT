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
import { TrendlyneInsights } from "@/components/trendlyne-widget";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SignalBadge } from "@/components/ui/signal-badge";
import { ScoreBar } from "@/components/ui/score-bar";
import { ArrowLeft, TrendingUp, TrendingDown, Target, ShieldAlert, ExternalLink, Info, AlertTriangle, CheckCircle2, XCircle, Clock } from "lucide-react";
import { InAppCandleChart } from "@/components/in-app-candle-chart";
import StockStatements from "@/components/stock-statements";
import { formatDistanceToNow } from "date-fns";

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
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <SignalBadge signal={recommendation.signal} />
              <span className="font-mono text-xs text-muted-foreground">Confidence {recommendation.confidence}%</span>
            </div>
            {/* Display label resolves the 'Neutral when evidence is bearish' bug.
                Suppress only when the label simply restates the badge in human form
                (e.g. signal=BUY → label='Bullish'); show when it adds info like
                'Neutral-to-Bearish' or 'No Trade — Bearish Pressure'. */}
            {recommendation.displayLabel && recommendation.displayLabel !== humanizeSignal(recommendation.signal) && (
              <div
                className={`text-sm font-semibold font-mono ${labelTone(recommendation.displayLabel)}`}
                data-testid="text-display-label"
              >
                {recommendation.displayLabel}
              </div>
            )}
            <ScoreBar score={recommendation.score} />

            {/* Target / Stop — never blank: setupMessage replaces empty boxes */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="rounded border border-signal-strong-buy/30 bg-signal-strong-buy/5 p-2">
                <div className="text-[10px] font-mono uppercase text-muted-foreground flex items-center gap-1"><Target className="w-3 h-3" />Target</div>
                <div className="font-mono font-bold text-signal-strong-buy" data-testid="text-target">
                  {recommendation.target != null ? `₹${recommendation.target.toFixed(2)}` : "—"}
                </div>
              </div>
              <div className="rounded border border-signal-strong-sell/30 bg-signal-strong-sell/5 p-2">
                <div className="text-[10px] font-mono uppercase text-muted-foreground flex items-center gap-1"><ShieldAlert className="w-3 h-3" />Stop</div>
                <div className="font-mono font-bold text-signal-strong-sell" data-testid="text-stop">
                  {recommendation.stopLoss != null ? `₹${recommendation.stopLoss.toFixed(2)}` : "—"}
                </div>
              </div>
              {recommendation.riskRewardRatio != null && (
                <div className="col-span-2 text-[11px] font-mono text-muted-foreground">
                  R:R <span className="text-foreground font-semibold">{recommendation.riskRewardRatio.toFixed(2)}:1</span>
                </div>
              )}
            </div>

            {/* setupMessage explains WHY when target/stop are blank, or confirms when tradeable */}
            {recommendation.setupMessage && (
              <div
                className={`flex items-start gap-2 rounded border p-2 text-[11px] leading-snug ${setupTone(recommendation.setupStatus)}`}
                data-testid="text-setup-message"
              >
                {recommendation.setupStatus === "TRADEABLE"
                  ? <CheckCircle2 className="w-3.5 h-3.5 mt-px shrink-0" />
                  : <Info className="w-3.5 h-3.5 mt-px shrink-0" />}
                <span>{recommendation.setupMessage}</span>
              </div>
            )}

            {/* Top-level confirmation + invalidation */}
            {(recommendation.confirmation || recommendation.invalidation) && (
              <div className="space-y-1.5 pt-1 border-t border-border">
                {recommendation.confirmation && (
                  <div className="text-[11px] leading-snug">
                    <span className="text-[10px] font-mono uppercase text-emerald-400 mr-1">Confirms:</span>
                    <span className="text-foreground/80">{recommendation.confirmation}</span>
                  </div>
                )}
                {recommendation.invalidation && (
                  <div className="text-[11px] leading-snug">
                    <span className="text-[10px] font-mono uppercase text-rose-400 mr-1">Invalidates:</span>
                    <span className="text-foreground/80">{recommendation.invalidation}</span>
                  </div>
                )}
              </div>
            )}

            {/* Conflicts — opposing evidence summary */}
            {recommendation.conflicts && recommendation.conflicts.length > 0 && (
              <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 space-y-1">
                <div className="text-[10px] font-mono uppercase text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Conflicting evidence
                </div>
                <ul className="space-y-1">
                  {recommendation.conflicts.map((c, i) => (
                    <li key={i} className="text-[11px] text-amber-200/90 leading-snug">• {c}</li>
                  ))}
                </ul>
              </div>
            )}
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

      {/* 3-horizon bias panel — Intraday / Swing / Long-term */}
      {recommendation.horizons && recommendation.horizons.length > 0 && (
        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Clock className="w-3.5 h-3.5" /> Bias by horizon
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {recommendation.horizons.map(h => (
                <HorizonCard key={h.horizon} horizon={h} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="bg-card border border-border">
          <TabsTrigger value="overview" className="font-mono text-xs uppercase">Overview</TabsTrigger>
          <TabsTrigger value="chart" className="font-mono text-xs uppercase">Chart</TabsTrigger>
          <TabsTrigger value="insights" className="font-mono text-xs uppercase">Insights</TabsTrigger>
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

        <TabsContent value="insights" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                Trendlyne insights
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              SWOT, financial-health checklist, Quality / Valuation / Technicals score and analyst price-target consensus — sourced live from Trendlyne. If a card stays blank for a few seconds, Trendlyne does not currently track this symbol.
            </CardContent>
          </Card>
          <TrendlyneInsights symbol={profile.symbol} />
        </TabsContent>

        <TabsContent value="chart" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between border-b border-border pb-3 gap-2">
              <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                {profile.symbol} · Daily candles · EMA 20/50 · Volume
              </CardTitle>
              <div className="flex items-center gap-1">
                {RANGES.map(r => (
                  <Button key={r} size="sm" variant={r === range ? "default" : "outline"} onClick={() => setRange(r)} className="h-7 px-2 text-xs font-mono uppercase">
                    {r}
                  </Button>
                ))}
                <a
                  href={`https://www.tradingview.com/chart/?symbol=NSE%3A${encodeURIComponent(profile.symbol)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 inline-flex items-center gap-1 text-[10px] font-mono uppercase text-muted-foreground hover:text-foreground"
                  title="Open this symbol on TradingView in a new tab"
                >
                  TradingView <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </CardHeader>
            <CardContent className="pt-3 pb-2">
              {histLoading || !history ? (
                <Skeleton className="h-[460px] w-full" />
              ) : history.candles.length === 0 ? (
                <div className="h-[460px] flex items-center justify-center text-sm text-muted-foreground">
                  No price history available for this symbol.
                </div>
              ) : (
                <InAppCandleChart
                  candles={history.candles}
                  ema20Series={history.ema20Series ?? null}
                  ema50Series={history.ema50Series ?? null}
                  height={460}
                />
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

type HorizonBiasView = {
  horizon: "INTRADAY" | "SWING" | "LONG_TERM";
  bias: "BULLISH" | "BEARISH" | "NEUTRAL_BULLISH" | "NEUTRAL_BEARISH" | "RANGE_BOUND" | "INSUFFICIENT_DATA";
  label: string;
  confidence: number;
  timeframe: string;
  reason: string;
  conflicts?: string;
  confirmation?: string;
  invalidation?: string;
};

function HorizonCard({ horizon }: { horizon: HorizonBiasView }) {
  const tone = biasTone(horizon.bias);
  return (
    <div
      className={`rounded border p-3 space-y-2 ${tone.border} ${tone.bg}`}
      data-testid={`card-horizon-${horizon.horizon.toLowerCase()}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          {horizonLabel(horizon.horizon)}
          <span className="ml-1 text-foreground/60">· {horizon.timeframe}</span>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">{horizon.confidence}%</span>
      </div>
      <div className={`text-sm font-bold font-mono ${tone.text}`}>{horizon.label}</div>
      <div className="text-[11px] text-foreground/80 leading-snug">
        <span className="text-[10px] font-mono uppercase text-muted-foreground mr-1">Why:</span>
        {horizon.reason}
      </div>
      {horizon.conflicts && (
        <div className="text-[11px] text-amber-200/90 leading-snug flex items-start gap-1">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-amber-400" />
          <span><span className="text-[10px] font-mono uppercase text-amber-400 mr-1">Conflict:</span>{horizon.conflicts}</span>
        </div>
      )}
      {horizon.confirmation && (
        <div className="text-[11px] text-foreground/70 leading-snug flex items-start gap-1">
          <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0 text-emerald-400" />
          <span><span className="text-[10px] font-mono uppercase text-emerald-400 mr-1">Confirms:</span>{horizon.confirmation}</span>
        </div>
      )}
      {horizon.invalidation && (
        <div className="text-[11px] text-foreground/70 leading-snug flex items-start gap-1">
          <XCircle className="w-3 h-3 mt-0.5 shrink-0 text-rose-400" />
          <span><span className="text-[10px] font-mono uppercase text-rose-400 mr-1">Invalidates:</span>{horizon.invalidation}</span>
        </div>
      )}
    </div>
  );
}

function horizonLabel(h: HorizonBiasView["horizon"]): string {
  if (h === "INTRADAY") return "Intraday";
  if (h === "SWING") return "Swing";
  return "Long-term";
}

function biasTone(bias: HorizonBiasView["bias"]): { border: string; bg: string; text: string } {
  switch (bias) {
    case "BULLISH":
      return { border: "border-signal-strong-buy/40", bg: "bg-signal-strong-buy/5", text: "text-signal-strong-buy" };
    case "NEUTRAL_BULLISH":
      return { border: "border-emerald-500/30", bg: "bg-emerald-500/5", text: "text-emerald-400" };
    case "BEARISH":
      return { border: "border-signal-strong-sell/40", bg: "bg-signal-strong-sell/5", text: "text-signal-strong-sell" };
    case "NEUTRAL_BEARISH":
      return { border: "border-rose-500/30", bg: "bg-rose-500/5", text: "text-rose-400" };
    case "RANGE_BOUND":
      return { border: "border-amber-500/30", bg: "bg-amber-500/5", text: "text-amber-300" };
    default:
      return { border: "border-border", bg: "bg-muted/20", text: "text-muted-foreground" };
  }
}

function humanizeSignal(signal: string): string {
  switch (signal) {
    case "STRONG_BUY": return "Strong Bullish";
    case "BUY": return "Bullish";
    case "SELL": return "Bearish";
    case "STRONG_SELL": return "Strong Bearish";
    default: return signal;
  }
}

function labelTone(label: string): string {
  if (label.startsWith("Strong Bullish") || label === "Bullish") return "text-signal-strong-buy";
  if (label === "Neutral-to-Bullish" || label.includes("Bullish Pressure")) return "text-emerald-400";
  if (label.startsWith("Strong Bearish") || label === "Bearish") return "text-signal-strong-sell";
  if (label === "Neutral-to-Bearish" || label.includes("Bearish Pressure")) return "text-rose-400";
  if (label === "Range-bound") return "text-amber-300";
  return "text-muted-foreground";
}

function setupTone(status?: string): string {
  if (status === "TRADEABLE") return "border-emerald-500/30 bg-emerald-500/5 text-emerald-200";
  if (status === "NO_SETUP_RR") return "border-amber-500/30 bg-amber-500/5 text-amber-200";
  if (status === "NO_SETUP_NEUTRAL") return "border-slate-500/30 bg-slate-500/5 text-slate-200";
  if (status === "NO_SETUP_AWAITING_LEVELS" || status === "NO_SETUP_AWAITING_CONFIRMATION") return "border-blue-500/30 bg-blue-500/5 text-blue-200";
  return "border-border bg-muted/20 text-muted-foreground";
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
