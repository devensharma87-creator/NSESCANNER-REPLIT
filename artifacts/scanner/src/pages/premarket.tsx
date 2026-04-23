import { useGetPreMarket, getGetPreMarketQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import {
  Sun, Moon, TrendingUp, TrendingDown, Globe2, Activity, AlertCircle, Calendar,
  ArrowUpRight, ArrowDownRight, Gauge, BarChart3,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

function pct(n: number | null | undefined, dp = 2) {
  if (n == null) return "—";
  const s = n >= 0 ? "+" : "";
  return `${s}${n.toFixed(dp)}%`;
}
function fmt(n: number | null | undefined, dp = 2) {
  if (n == null) return "—";
  return n.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function tone(n: number | null | undefined) {
  if (n == null || n === 0) return "text-muted-foreground";
  return n > 0 ? "text-signal-strong-buy" : "text-signal-strong-sell";
}
function bgTone(n: number | null | undefined) {
  if (n == null) return "border-border/40 bg-secondary/40";
  if (n > 0.3) return "border-signal-strong-buy/40 bg-signal-strong-buy/[0.06]";
  if (n < -0.3) return "border-signal-strong-sell/40 bg-signal-strong-sell/[0.06]";
  return "border-border/40 bg-secondary/40";
}

const SENTIMENT_TONE: Record<string, string> = {
  STRONG_BULLISH: "bg-signal-strong-buy/20 text-signal-strong-buy border-signal-strong-buy/40",
  BULLISH: "bg-signal-strong-buy/10 text-signal-strong-buy border-signal-strong-buy/30",
  NEUTRAL: "bg-secondary/40 text-muted-foreground border-border/40",
  BEARISH: "bg-signal-strong-sell/10 text-signal-strong-sell border-signal-strong-sell/30",
  STRONG_BEARISH: "bg-signal-strong-sell/20 text-signal-strong-sell border-signal-strong-sell/40",
};

export default function PreMarket() {
  const { data, isLoading, error, dataUpdatedAt } = useGetPreMarket({
    query: { staleTime: 30_000, refetchInterval: 60_000, queryKey: getGetPreMarketQueryKey() },
  });

  if (isLoading) {
    return (
      <div className="w-full px-4 py-6 space-y-4">
        <Skeleton className="h-32 w-full" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-64" /><Skeleton className="h-64" />
        </div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="w-full px-4 py-12 text-center">
        <AlertCircle className="w-10 h-10 mx-auto mb-3 text-signal-strong-sell" />
        <p className="font-mono text-sm text-muted-foreground">Failed to load pre-market data. Please retry shortly.</p>
      </div>
    );
  }

  const isPre = data.mode === "PRE_MARKET";
  const isPost = data.mode === "POST_MARKET";
  const ModeIcon = isPre ? Sun : isPost ? Moon : Activity;
  const modeLabel = isPre ? "Pre-Market Setup" : isPost ? "Post-Market Wrap" : "Live Session — Setup Recap";

  // Group cues by category
  const cueByCat: Record<string, typeof data.overnightCues> = {};
  for (const c of data.overnightCues) {
    const cat = c.category ?? "proxy";
    cueByCat[cat] ??= [];
    cueByCat[cat]!.push(c);
  }

  return (
    <div className="w-full px-4 py-6 space-y-6">
      {/* Hero */}
      <Card className={`border ${bgTone(data.sentimentScore)}`}>
        <CardContent className="p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono uppercase tracking-wider">
                <ModeIcon className="w-4 h-4" />
                <span>{modeLabel}</span>
                <span>·</span>
                <span>updated {formatDistanceToNow(new Date(data.generatedAt), { addSuffix: true })}</span>
              </div>
              <h1 className="text-2xl font-bold mt-2 tracking-tight">{modeLabel}</h1>
              <p className="text-sm text-foreground/80 mt-1 max-w-3xl">{data.narrative}</p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <span className={`px-3 py-1.5 rounded border text-xs font-mono font-bold ${SENTIMENT_TONE[data.sentiment] ?? SENTIMENT_TONE["NEUTRAL"]}`}>
                {data.sentiment.replace("_", " ")}
              </span>
              <div className="flex items-center gap-1.5 text-xs font-mono">
                <Gauge className="w-3 h-3 text-muted-foreground" />
                <span className={tone(data.sentimentScore)}>Score {data.sentimentScore >= 0 ? "+" : ""}{data.sentimentScore.toFixed(1)}</span>
              </div>
            </div>
          </div>

          {data.keyTakeaways && data.keyTakeaways.length > 0 && (
            <ul className="mt-4 space-y-1 text-sm">
              {data.keyTakeaways.map((t, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-muted-foreground mt-0.5">▸</span>
                  <span className="text-foreground/90">{t}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Index previews */}
      {data.indexPreviews && data.indexPreviews.length > 0 && (
        <section>
          <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground mb-3">
            {isPre ? "Indicative Open" : "Index Snapshot"}
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {data.indexPreviews.map(ix => (
              <Card key={ix.symbol} className={`border ${bgTone(ix.indicativeChangePercent)}`}>
                <CardContent className="p-4">
                  <div className="text-xs font-mono text-muted-foreground uppercase">{ix.name}</div>
                  <div className="text-xl font-bold tabular-nums mt-1">{fmt(ix.indicativePrice)}</div>
                  <div className={`text-xs font-mono mt-0.5 ${tone(ix.indicativeChangePercent)}`}>
                    {ix.indicativeChange != null && (ix.indicativeChange >= 0 ? "+" : "")}{fmt(ix.indicativeChange)} ({pct(ix.indicativeChangePercent)})
                  </div>
                  <div className="text-[10px] font-mono text-muted-foreground mt-2">vs prev close {fmt(ix.previousClose)}</div>
                  {ix.source && <div className="text-[10px] text-muted-foreground/70 mt-0.5 italic">{ix.source}</div>}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Overnight cues, grouped */}
      <section>
        <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Globe2 className="w-4 h-4" /> Overnight & Global Cues
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {(["proxy", "us", "asia", "europe", "currency", "commodity", "vix"] as const).map(cat => {
            const cues = cueByCat[cat];
            if (!cues || cues.length === 0) return null;
            const label = ({ proxy: "Pre-Open Proxy (GIFT NIFTY)", us: "United States", asia: "Asia",
              europe: "Europe", currency: "Currency / Dollar Index", commodity: "Commodities", vix: "Volatility (India VIX)" } as const)[cat];
            return (
              <Card key={cat} className="border border-border/50">
                <CardContent className="p-4">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-2">{label}</div>
                  <ul className="space-y-1.5">
                    {cues.map(c => (
                      <li key={c.label} className="flex items-center justify-between text-sm">
                        <span className="font-medium truncate" title={c.note ?? ""}>{c.label}{c.inverted && <span className="text-[9px] text-muted-foreground ml-1">(inv)</span>}</span>
                        <span className="flex items-center gap-2 shrink-0">
                          <span className="font-mono tabular-nums text-xs text-muted-foreground">{fmt(c.value)}</span>
                          <span className={`font-mono tabular-nums text-xs font-bold ${tone(c.changePercent)}`}>
                            {pct(c.changePercent)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Post-market digest */}
      {data.postMarketDigest && (
        <section>
          <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <BarChart3 className="w-4 h-4" /> Market Internals
          </h2>
          <Card className={`border ${bgTone((data.postMarketDigest.marketBreadthScore ?? 0) / 30)}`}>
            <CardContent className="p-5">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <Stat label="Advancers" value={String(data.postMarketDigest.advancers)} tone="text-signal-strong-buy" />
                <Stat label="Decliners" value={String(data.postMarketDigest.decliners)} tone="text-signal-strong-sell" />
                <Stat label="Unchanged" value={String(data.postMarketDigest.unchanged)} />
                <Stat label="A/D Ratio" value={data.postMarketDigest.adRatio == null ? "∞" : data.postMarketDigest.adRatio.toFixed(2)} />
                <Stat label="Breadth Score" value={`${(data.postMarketDigest.marketBreadthScore ?? 0) >= 0 ? "+" : ""}${(data.postMarketDigest.marketBreadthScore ?? 0).toFixed(0)}`}
                  tone={tone(data.postMarketDigest.marketBreadthScore ?? 0)} />
              </div>
              <p className="text-sm text-foreground/85 mt-4">{data.postMarketDigest.narrative ?? ""}</p>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Movers */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MoverList title="Top Gainers" icon={<TrendingUp className="w-4 h-4 text-signal-strong-buy" />} items={data.topGainers ?? []} positive />
        <MoverList title="Top Losers" icon={<TrendingDown className="w-4 h-4 text-signal-strong-sell" />} items={data.topLosers ?? []} positive={false} />
      </section>

      {/* Gappers */}
      {(data.gapUps?.length || data.gapDowns?.length) ? (
        <section>
          <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground mb-3">
            Gap Analysis (gap vs ATR)
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <GapList title="Gap Ups" icon={<ArrowUpRight className="w-4 h-4 text-signal-strong-buy" />} items={data.gapUps ?? []} />
            <GapList title="Gap Downs" icon={<ArrowDownRight className="w-4 h-4 text-signal-strong-sell" />} items={data.gapDowns ?? []} />
          </div>
        </section>
      ) : null}

      {/* Events / Earnings today */}
      {(data.eventsToday?.length || data.earningsToday?.length) ? (
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.eventsToday && data.eventsToday.length > 0 && (
            <Card className="border border-border/50">
              <CardContent className="p-4">
                <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5" /> Macro Events Today
                </div>
                <ul className="space-y-1.5 text-sm">
                  {data.eventsToday.map((e, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Badge variant="outline" className="text-[9px] mt-0.5">{e.region ?? "—"}</Badge>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{e.name}</div>
                        {e.description && <div className="text-[11px] text-muted-foreground truncate">{e.description}</div>}
                      </div>
                      {e.impact && <span className="text-[9px] font-mono uppercase text-muted-foreground">{e.impact}</span>}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          {data.earningsToday && data.earningsToday.length > 0 && (
            <Card className="border border-border/50">
              <CardContent className="p-4">
                <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5" /> Earnings Today
                </div>
                <ul className="space-y-1 text-sm">
                  {data.earningsToday.map((e) => (
                    <li key={e.symbol}>
                      <Link href={`/stock/${encodeURIComponent(e.symbol ?? "")}`} className="flex items-center justify-between hover:bg-white/5 px-2 py-1 rounded">
                        <span className="font-mono font-bold">{e.symbol}</span>
                        <span className="text-xs text-muted-foreground truncate ml-3">{e.name}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </section>
      ) : null}

      <p className="text-[10px] text-muted-foreground/70 font-mono text-center pt-4">
        Data refreshes every 60s · Auto-detects pre/post mode by IST clock · Last updated {dataUpdatedAt ? formatDistanceToNow(dataUpdatedAt, { addSuffix: true }) : "—"}
      </p>
    </div>
  );
}

function Stat({ label, value, tone: t }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${t ?? "text-foreground"}`}>{value}</div>
    </div>
  );
}

interface MoverItem { symbol: string; name: string; sector?: string; price: number; change: number; changePercent: number; previousClose?: number; volume?: number }
function MoverList({ title, icon, items, positive }: { title: string; icon: React.ReactNode; items: ReadonlyArray<MoverItem>; positive: boolean }) {
  return (
    <Card className="border border-border/50">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">{icon}<span className="text-sm font-bold">{title}</span></div>
        {items.length === 0 ? (
          <div className="text-xs text-muted-foreground font-mono py-4 text-center">No qualifying movers.</div>
        ) : (
          <ul className="space-y-1">
            {items.map(s => (
              <li key={s.symbol}>
                <Link href={`/stock/${encodeURIComponent(s.symbol)}`}>
                  <div className="flex items-center justify-between gap-3 px-2 py-1.5 rounded hover:bg-white/5">
                    <div className="min-w-0">
                      <div className="font-mono font-bold text-sm">{s.symbol}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{s.name}{s.sector ? ` · ${s.sector}` : ""}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm tabular-nums">{fmt(s.price)}</div>
                      <div className={`font-mono text-[10px] font-bold ${positive ? "text-signal-strong-buy" : "text-signal-strong-sell"}`}>
                        {pct(s.changePercent)}
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function GapList({ title, icon, items }: { title: string; icon: React.ReactNode; items: ReadonlyArray<{ symbol: string; name: string; sector?: string; gapPercent: number; atrPct: number; gapVsAtr?: number; signal?: string; previousClose?: number; currentPrice?: number; gapDirection?: string }> }) {
  return (
    <Card className="border border-border/50">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">{icon}<span className="text-sm font-bold">{title}</span></div>
        {items.length === 0 ? (
          <div className="text-xs text-muted-foreground font-mono py-4 text-center">No significant gaps.</div>
        ) : (
          <ul className="space-y-1">
            {items.map(g => (
              <li key={g.symbol}>
                <Link href={`/stock/${encodeURIComponent(g.symbol)}`}>
                  <div className="flex items-center justify-between gap-3 px-2 py-1.5 rounded hover:bg-white/5">
                    <div className="min-w-0">
                      <div className="font-mono font-bold text-sm">{g.symbol}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{g.name}</div>
                    </div>
                    <div className="text-right">
                      <div className={`font-mono text-sm tabular-nums font-bold ${tone(g.gapPercent)}`}>{pct(g.gapPercent)}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {g.gapVsAtr ? `${g.gapVsAtr.toFixed(2)}× ATR` : "—"}
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
