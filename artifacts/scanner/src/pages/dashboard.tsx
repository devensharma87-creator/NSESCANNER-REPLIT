import {
  useGetTopScans,
  useListStocks,
  getGetTopScansQueryKey,
  getListStocksQueryKey,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SignalBadge } from "@/components/ui/signal-badge";
import { Seo } from "@/components/seo";
import {
  TrendingUp, TrendingDown, ArrowRight, Flame, Snowflake,
  Home as HomeIcon, AlertTriangle,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionSourceLabel } from "@/components/ui/section-source-label";
import TrendCard from "@/components/trend-card";
import MarketMoodGauge from "@/components/mmi-gauge";
import IndicesBoard from "@/components/indices-board";
import GlobalCuesStrip from "@/components/home/global-cues-strip";
import SentimentBar from "@/components/home/sentiment-bar";
import SectoralHeatmap from "@/components/home/sectoral-heatmap";
import BreadthBar from "@/components/home/breadth-bar";
import IndexTabs from "@/components/home/index-tabs";
import MarketTake from "@/components/home/market-take";
import FnoBanWidget from "@/components/fno-ban-widget";
import { useMemo } from "react";
import type { StockRow } from "@workspace/api-client-react";

function fmtIN(n: number) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function buildReasonsTitle(s: StockRow): string {
  const top = (s.recommendation.reasons ?? [])
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);
  return top.map(r =>
    `${r.bullish ? "+" : "–"} ${r.label} (w${r.weight}): ${r.detail}`
  ).join("\n");
}

/**
 * Tiny pill flagging a stock that's within 1% of its 52W extremes — useful
 * context for the gainers / losers cards because near-extreme moves carry
 * very different conviction than mid-range moves of the same magnitude.
 * Rendered only when the underlying Quote actually has fiftyTwoWeekHigh /
 * Low populated and the price is within the threshold.
 */
function FiftyTwoWeekChip({ price, hi, lo }: { price: number; hi?: number | null; lo?: number | null }) {
  if (Number.isFinite(hi) && hi! > 0 && price >= hi! * 0.99) {
    return <span className="px-1 py-0 rounded text-[9px] font-mono font-bold tracking-wide bg-signal-strong-buy/15 text-signal-strong-buy border border-signal-strong-buy/30" title={`Within 1% of 52-week high (${hi!.toFixed(2)})`}>↑ 52W</span>;
  }
  if (Number.isFinite(lo) && lo! > 0 && price <= lo! * 1.01) {
    return <span className="px-1 py-0 rounded text-[9px] font-mono font-bold tracking-wide bg-signal-strong-sell/15 text-signal-strong-sell border border-signal-strong-sell/30" title={`Within 1% of 52-week low (${lo!.toFixed(2)})`}>↓ 52W</span>;
  }
  return null;
}

function MoverRow({ s, kind }: { s: StockRow; kind: "gain" | "loss" }) {
  const tone = kind === "gain" ? "text-signal-strong-buy" : "text-signal-strong-sell";
  return (
    <Link
      href={`/stock/${s.symbol}`}
      className="grid grid-cols-[1fr_auto_auto] items-center gap-3 p-2.5 rounded hover-row cursor-pointer border border-transparent hover:border-border"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-bold font-mono text-sm truncate">{s.symbol}</span>
          <FiftyTwoWeekChip price={s.quote.price} hi={s.quote.fiftyTwoWeekHigh} lo={s.quote.fiftyTwoWeekLow} />
        </div>
        <div className="text-[11px] text-muted-foreground truncate">{s.name}</div>
      </div>
      <div className="text-right font-mono tabular-nums">
        <div className="text-sm font-semibold">{fmtIN(s.quote.price)}</div>
        <div className={`text-[11px] ${tone}`}>
          {s.quote.change > 0 ? "+" : ""}{fmtIN(s.quote.change)}
        </div>
      </div>
      <div className={`text-right font-mono tabular-nums font-bold text-sm ${tone}`}>
        {s.quote.changePercent > 0 ? "+" : ""}{s.quote.changePercent.toFixed(2)}%
      </div>
    </Link>
  );
}

export default function Home() {
  const { data: topScans, isLoading: scansLoading } = useGetTopScans({
    query: { refetchInterval: 30000, queryKey: getGetTopScansQueryKey() },
  });
  const { data: allStocks, isLoading: stocksLoading, isError: stocksError } = useListStocks(undefined, {
    query: { refetchInterval: 30000, queryKey: getListStocksQueryKey() },
  });

  const { topGainers, topLosers, universeCount } = useMemo(() => {
    const list = (allStocks ?? []).filter(s => Number.isFinite(s.quote.changePercent));
    const sortedDesc = list.slice().sort((a, b) => b.quote.changePercent - a.quote.changePercent);
    const sortedAsc = list.slice().sort((a, b) => a.quote.changePercent - b.quote.changePercent);
    return {
      topGainers: sortedDesc.slice(0, 10),
      topLosers: sortedAsc.slice(0, 10),
      universeCount: list.length,
    };
  }, [allStocks]);

  // Honest source roll-up for the movers cards: aggregated from each row's
  // provenance so a Kite tick never silently promotes a Yahoo/stale row.
  const moversRuntime = useMemo(() => {
    const rows = [...topGainers, ...topLosers];
    if (rows.length === 0) return { hasData: false };
    let fallbackUsed = false;
    let isStale = false;
    let asOf: number | null = null;
    for (const r of rows) {
      const p = r.provenance;
      // Missing provenance can't be confirmed authoritative — downgrade rather
      // than let an unlabelled row silently pass as trade-grade.
      if (!p) { fallbackUsed = true; continue; }
      if (p.sourceProvider === "yahoo" || p.delayed === true) fallbackUsed = true;
      if (p.isStale === true) isStale = true;
      // Aggregate "as of" = OLDEST row time, so a single fresh row never
      // overstates the freshness of the whole card.
      if (typeof p.asOf === "number" && Number.isFinite(p.asOf)) {
        asOf = asOf == null ? p.asOf : Math.min(asOf, p.asOf);
      }
    }
    return { hasData: true, fallbackUsed, isStale, asOf };
  }, [topGainers, topLosers]);

  // Honest source roll-up for the setups cards (cached scanner picks).
  const setupsRuntime = useMemo(() => {
    const count = (topScans?.topBuys?.length ?? 0) + (topScans?.topSells?.length ?? 0);
    return {
      hasData: count > 0,
      asOf: topScans?.generatedAt ?? null,
      fallbackUsed: (topScans?.nonAuthoritativeCount ?? 0) > 0,
    };
  }, [topScans]);

  return (
    <div className="w-full max-w-none px-4 lg:px-6 2xl:px-8 py-6 space-y-8">
      <Seo path="/" />
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <HomeIcon className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Home</h1>
            <p className="text-sm text-muted-foreground">Live market overview, indices fact-pack, top movers and setups.</p>
          </div>
        </div>
        <div className="max-w-xs text-right text-[10px] font-mono leading-snug text-muted-foreground">
          Every section below is labelled with its data source &amp; trust grade.
          <span className="block mt-0.5">
            <span className="text-emerald-500 font-semibold">Trade-grade</span> = live Kite ·{" "}
            <span className="text-amber-500 font-semibold">Delayed</span> = Yahoo ~15m ·{" "}
            <span className="text-sky-500 font-semibold">Info/Computed</span> = context only, never a live signal.
          </span>
        </div>
      </header>

      <section className="space-y-2">
        <GlobalCuesStrip />
        <SentimentBar />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        <SectoralHeatmap />
        <BreadthBar />
      </section>

      <section data-testid="home-indices">
        <IndexTabs />
      </section>

      <section data-testid="home-markets">
        <IndicesBoard embedded />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2"><TrendCard /></div>
        <MarketMoodGauge />
      </section>

      <MarketTake />

      <FnoBanWidget />

      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-signal-strong-buy/20 bg-gradient-to-b from-signal-strong-buy/5 to-transparent">
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-base font-mono flex items-center gap-2">
              <Flame className="w-5 h-5 text-signal-strong-buy" /> TOP GAINERS — TODAY
            </CardTitle>
            <div className="flex items-center gap-2">
              <SectionSourceLabel sectionId="top-movers" runtime={moversRuntime} />
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                by % · full Nifty universe ({universeCount})
              </span>
            </div>
          </CardHeader>
          <CardContent>
            {stocksLoading ? <Skeleton className="h-72 w-full" /> : stocksError ? (
              <p className="text-xs text-signal-strong-sell font-mono">Couldn't load market data — retrying.</p>
            ) : topGainers.length === 0 ? (
              <p className="text-xs text-muted-foreground font-mono">No data yet.</p>
            ) : (
              <div className="space-y-1">
                {topGainers.map(s => <MoverRow key={s.symbol} s={s} kind="gain" />)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-signal-strong-sell/20 bg-gradient-to-b from-signal-strong-sell/5 to-transparent">
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-base font-mono flex items-center gap-2">
              <Snowflake className="w-5 h-5 text-signal-strong-sell" /> TOP LOSERS — TODAY
            </CardTitle>
            <div className="flex items-center gap-2">
              <SectionSourceLabel sectionId="top-movers" runtime={moversRuntime} />
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                by % · full Nifty universe ({universeCount})
              </span>
            </div>
          </CardHeader>
          <CardContent>
            {stocksLoading ? <Skeleton className="h-72 w-full" /> : stocksError ? (
              <p className="text-xs text-signal-strong-sell font-mono">Couldn't load market data — retrying.</p>
            ) : topLosers.length === 0 ? (
              <p className="text-xs text-muted-foreground font-mono">No data yet.</p>
            ) : (
              <div className="space-y-1">
                {topLosers.map(s => <MoverRow key={s.symbol} s={s} kind="loss" />)}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {(topScans?.warnings?.length ?? 0) > 0 && (
        <div
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-mono text-amber-500 flex items-start gap-2"
          data-testid="top-scans-warning"
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
          <span>{topScans?.warnings?.join(" ")}</span>
        </div>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-signal-strong-buy/20 bg-gradient-to-b from-signal-strong-buy/5 to-transparent">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-mono flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-signal-strong-buy" /> TOP BULLISH SETUPS
            </CardTitle>
            <div className="pt-1">
              <SectionSourceLabel sectionId="top-setups" runtime={setupsRuntime} />
            </div>
          </CardHeader>
          <CardContent>
            {scansLoading ? <Skeleton className="h-32 w-full" /> : (
              <div className="space-y-2">
                {topScans?.topBuys?.slice(0, 8).map(stock => (
                  <Link key={stock.symbol} href={`/stock/${stock.symbol}`} className="flex items-center justify-between p-2.5 rounded hover-row cursor-pointer border border-transparent hover:border-border" title={buildReasonsTitle(stock)}>
                    <div>
                      <div className="font-bold font-mono text-sm">{stock.symbol}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-[200px]">{stock.name}</div>
                    </div>
                    <div className="text-right">
                      <SignalBadge signal={stock.recommendation.signal} />
                      <div className="text-xs font-mono mt-1 text-signal-strong-buy">+{stock.recommendation.score}/100 · RR {stock.recommendation.riskRewardRatio ?? "—"}</div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-signal-strong-sell/20 bg-gradient-to-b from-signal-strong-sell/5 to-transparent">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-mono flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-signal-strong-sell" /> TOP BEARISH SETUPS
            </CardTitle>
            <div className="pt-1">
              <SectionSourceLabel sectionId="top-setups" runtime={setupsRuntime} />
            </div>
          </CardHeader>
          <CardContent>
            {scansLoading ? <Skeleton className="h-32 w-full" /> : (
              <div className="space-y-2">
                {topScans?.topSells?.slice(0, 8).map(stock => (
                  <Link key={stock.symbol} href={`/stock/${stock.symbol}`} className="flex items-center justify-between p-2.5 rounded hover-row cursor-pointer border border-transparent hover:border-border" title={buildReasonsTitle(stock)}>
                    <div>
                      <div className="font-bold font-mono text-sm">{stock.symbol}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-[200px]">{stock.name}</div>
                    </div>
                    <div className="text-right">
                      <SignalBadge signal={stock.recommendation.signal} />
                      <div className="text-xs font-mono mt-1 text-signal-strong-sell">{stock.recommendation.score}/100 · RR {stock.recommendation.riskRewardRatio ?? "—"}</div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <div className="text-center pt-2">
        <Link href="/scanner" className="inline-flex items-center gap-2 text-sm font-mono font-semibold text-primary hover:underline">
          Browse the full scanner with all {topScans ? '~280' : ''} stocks · sortable &amp; filterable <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
