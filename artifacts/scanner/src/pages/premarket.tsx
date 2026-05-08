import { useGetPreMarket, getGetPreMarketQueryKey } from "@workspace/api-client-react";
import { DataSourceBadge } from "@/components/ui/data-source-badge";
import type { PreMarketReport } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import {
  Sun, Moon, TrendingUp, TrendingDown, Globe2, Activity, AlertCircle, Calendar,
  ArrowUpRight, ArrowDownRight, Gauge, BarChart3, Layers, Target, Building2, Crosshair,
  ClipboardList, Shield, Package, Zap, Eye, Ban, ChevronDown, ChevronUp,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";

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
    <div className="w-full px-4 py-6">
      <div className="flex gap-6">
        {/* Main content */}
        <div className="flex-1 min-w-0 space-y-6">

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
              <DataSourceBadge
                source="mixed"
                status="delayed"
                lastUpdated={dataUpdatedAt}
                refreshMs={60_000}
                note="overnight cues · global proxies"
                compact
              />
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

      {/* Today's 3 scenarios — pre-planned trade book before the open */}
      {data.scenarios && data.scenarios.length > 0 && (
        <section>
          <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <Target className="w-4 h-4" /> Today's 3 Scenarios — Setup Plan
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {data.scenarios.map(s => (
              <ScenarioCard key={s.kind} scenario={s} />
            ))}
          </div>
          <p className="text-xs text-muted-foreground/70 mt-2 italic leading-snug">
            Pros prepare all three plans, then trade the one the market actually picks. Probability is a heuristic from overnight cues + CPR width — never a forecast.
          </p>
        </section>
      )}

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

      {/* Key index levels — CPR + classic pivots + prev/weekly/52w bands */}
      {data.indexLevels && data.indexLevels.length > 0 && (
        <section>
          <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <Layers className="w-4 h-4" /> Key Index Levels — CPR & Pivots
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
            {data.indexLevels.map(lv => <IndexLevelsCard key={lv.symbol} lv={lv} />)}
          </div>
          <p className="text-xs text-muted-foreground/70 mt-2 italic leading-snug">
            Pivots from previous-session OHLC. CPR width — narrow (&lt;0.4%) tends to precede a trending day, wide (&gt;1.0%) precedes range/chop.
          </p>
        </section>
      )}

      {/* Option chain morning snapshot — for the 3 main F&O indices */}
      {data.optionSnapshots && data.optionSnapshots.length > 0 && (
        <section>
          <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <Crosshair className="w-4 h-4" /> Option Chain Morning Snapshot
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.optionSnapshots.map(o => <OptionSnapshotCard key={o.underlying} snap={o} />)}
          </div>
          <p className="text-xs text-muted-foreground/70 mt-2 italic leading-snug">
            Expected move = ATM straddle ÷ spot. Max-pain = strike where option writers lose least. Highest CE-OI is intraday resistance, highest PE-OI is intraday support.
          </p>
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
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-border/40">
                <Stat label="52W Highs" value={String(data.postMarketDigest.new52wHigh ?? 0)}
                  tone={(data.postMarketDigest.new52wHigh ?? 0) > 0 ? "text-signal-strong-buy" : undefined} />
                <Stat label="52W Lows" value={String(data.postMarketDigest.new52wLow ?? 0)}
                  tone={(data.postMarketDigest.new52wLow ?? 0) > 0 ? "text-signal-strong-sell" : undefined} />
                <Stat label="Upper Circuits" value={String(data.postMarketDigest.upperCircuits ?? 0)}
                  tone={(data.postMarketDigest.upperCircuits ?? 0) > 0 ? "text-signal-strong-buy" : undefined} />
                <Stat label="Lower Circuits" value={String(data.postMarketDigest.lowerCircuits ?? 0)}
                  tone={(data.postMarketDigest.lowerCircuits ?? 0) > 0 ? "text-signal-strong-sell" : undefined} />
              </div>
              <p className="text-sm text-foreground/85 mt-4">{data.postMarketDigest.narrative ?? ""}</p>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Sector heatmap — full leader→laggard ranking */}
      {data.sectorHeatmap && data.sectorHeatmap.length > 0 && (
        <section>
          <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <BarChart3 className="w-4 h-4" /> Sector Heatmap — Leaders to Laggards
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
            {data.sectorHeatmap.map(s => <SectorTile key={s.sector} s={s} />)}
          </div>
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

      {/* Events / Earnings / FII-DII row */}
      {(data.eventsToday?.length || data.earningsToday?.length || data.fiiDii) ? (
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.fiiDii && <FiiDiiCard f={data.fiiDii} />}
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
                      <Link href={`/stock/${encodeURIComponent(e.symbol ?? "")}`} className="flex items-center justify-between hover-row px-2 py-1 rounded">
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

      <p className="text-xs text-muted-foreground/70 font-mono text-center pt-4">
        Data refreshes every 60s · Auto-detects pre/post mode by IST clock · Last updated {dataUpdatedAt ? formatDistanceToNow(dataUpdatedAt, { addSuffix: true }) : "—"}
      </p>

        </div>

        {/* Right sidebar — Setup for Tomorrow */}
        <div className="hidden xl:block w-[340px] shrink-0">
          <div className="sticky top-4">
            <SetupForTomorrow data={data} />
          </div>
        </div>
      </div>

      {/* Mobile: Setup for Tomorrow below main content */}
      <div className="xl:hidden mt-6">
        <SetupForTomorrow data={data} />
      </div>
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
                  <div className="flex items-center justify-between gap-3 px-2 py-1.5 rounded hover-row">
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
                  <div className="flex items-center justify-between gap-3 px-2 py-1.5 rounded hover-row">
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

// ───────── Today's 3 Scenarios ─────────
const SCENARIO_TONE: Record<string, { card: string; label: string; pill: string }> = {
  BULLISH: { card: "border-signal-strong-buy/40 bg-signal-strong-buy/[0.06]",  label: "text-signal-strong-buy",  pill: "bg-signal-strong-buy/20 text-signal-strong-buy border-signal-strong-buy/40" },
  BEARISH: { card: "border-signal-strong-sell/40 bg-signal-strong-sell/[0.06]", label: "text-signal-strong-sell", pill: "bg-signal-strong-sell/20 text-signal-strong-sell border-signal-strong-sell/40" },
  RANGE:   { card: "border-border/50 bg-secondary/30",                          label: "text-foreground/85",      pill: "bg-secondary/60 text-muted-foreground border-border/40" },
};
const PROB_TONE: Record<string, string> = {
  HIGH: "text-signal-strong-buy", MEDIUM: "text-foreground/80", LOW: "text-muted-foreground",
};
function ScenarioCard({ scenario }: { scenario: { kind: string; label: string; trigger: string; actions: string[]; invalidation?: string; probability: string } }) {
  const t = SCENARIO_TONE[scenario.kind] ?? SCENARIO_TONE["RANGE"]!;
  return (
    <Card className={`border ${t.card}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className={`text-xs font-mono uppercase tracking-wider font-bold ${t.label}`}>{scenario.kind}</div>
          <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${PROB_TONE[scenario.probability] ?? "text-muted-foreground"} border-current/30`}>
            {scenario.probability} prob
          </span>
        </div>
        <div className="text-sm font-bold mb-2">{scenario.label}</div>
        <div className="text-[11px] font-mono text-muted-foreground uppercase mb-1">Trigger</div>
        <p className="text-xs text-foreground/85 mb-3 leading-relaxed">{scenario.trigger}</p>
        <div className="text-[11px] font-mono text-muted-foreground uppercase mb-1">Actions</div>
        <ul className="space-y-1 text-xs mb-3">
          {scenario.actions.map((a, i) => (
            <li key={i} className="flex items-start gap-1.5"><span className="text-muted-foreground mt-0.5">·</span><span className="text-foreground/90 leading-snug">{a}</span></li>
          ))}
        </ul>
        {scenario.invalidation && (
          <>
            <div className="text-[11px] font-mono text-muted-foreground uppercase mb-1">Invalidation</div>
            <p className="text-xs text-foreground/75 leading-relaxed italic">{scenario.invalidation}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ───────── Key Index Levels (CPR + pivots) ─────────
type IxLv = {
  symbol: string; name: string; previousClose: number;
  prevHigh: number; prevLow: number; weekHigh: number; weekLow: number;
  monthHigh?: number | null; monthLow?: number | null;
  yearHigh: number; yearLow: number;
  pivot: number; r1: number; r2: number; s1: number; s2: number;
  cprTop: number; cprPivot: number; cprBottom: number; cprWidthPct: number; cprWidthLabel: string;
  positionInYearRangePct: number; todayOpen?: number | null;
};
const CPR_TONE: Record<string, string> = {
  NARROW: "bg-signal-strong-buy/15 text-signal-strong-buy border-signal-strong-buy/30",
  NORMAL: "bg-secondary/60 text-muted-foreground border-border/40",
  WIDE:   "bg-signal-strong-sell/10 text-signal-strong-sell border-signal-strong-sell/30",
};
function IndexLevelsCard({ lv }: { lv: IxLv }) {
  return (
    <Card className="border border-border/50">
      <CardContent className="p-4">
        <div className="flex items-baseline justify-between gap-2 mb-3">
          <div>
            <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">{lv.name}</div>
            <div className="text-lg font-bold tabular-nums mt-0.5">{fmt(lv.previousClose)}</div>
          </div>
          <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${CPR_TONE[lv.cprWidthLabel] ?? CPR_TONE["NORMAL"]}`}>
            CPR {lv.cprWidthLabel} · {lv.cprWidthPct.toFixed(2)}%
          </span>
        </div>

        <div className="space-y-0.5 text-xs font-mono tabular-nums">
          <LevelRow label="R2"     value={lv.r2}        tone="text-signal-strong-sell" />
          <LevelRow label="R1"     value={lv.r1}        tone="text-signal-strong-sell/80" />
          <LevelRow label="CPR-T"  value={lv.cprTop}    tone="text-foreground/70" />
          <LevelRow label="Pivot"  value={lv.pivot}     tone="text-foreground font-bold" />
          <LevelRow label="CPR-B"  value={lv.cprBottom} tone="text-foreground/70" />
          <LevelRow label="S1"     value={lv.s1}        tone="text-signal-strong-buy/80" />
          <LevelRow label="S2"     value={lv.s2}        tone="text-signal-strong-buy" />
        </div>

        <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-border/40 text-[11px]">
          <RangeStat label="Prev day" hi={lv.prevHigh} lo={lv.prevLow} />
          <RangeStat label="Week"     hi={lv.weekHigh} lo={lv.weekLow} />
          <RangeStat label="52-wk"    hi={lv.yearHigh} lo={lv.yearLow} />
        </div>

        <div className="mt-3">
          <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground mb-1">
            <span>52-wk position</span>
            <span className="tabular-nums">{lv.positionInYearRangePct.toFixed(0)}%</span>
          </div>
          <div className="h-1.5 bg-secondary/60 rounded-full overflow-hidden">
            <div
              className={lv.positionInYearRangePct > 70 ? "h-full bg-signal-strong-buy"
                : lv.positionInYearRangePct < 30 ? "h-full bg-signal-strong-sell"
                : "h-full bg-foreground/40"}
              style={{ width: `${Math.max(2, Math.min(100, lv.positionInYearRangePct))}%` }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
function LevelRow({ label, value, tone: t }: { label: string; value: number; tone: string }) {
  return (
    <div className={`flex items-center justify-between gap-2 ${t}`}>
      <span className="text-muted-foreground/90 w-12">{label}</span>
      <span className="tabular-nums">{fmt(value)}</span>
    </div>
  );
}
function RangeStat({ label, hi, lo }: { label: string; hi: number; lo: number }) {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase text-muted-foreground">{label}</div>
      <div className="font-mono tabular-nums text-signal-strong-buy text-[11px]">{fmt(hi)}</div>
      <div className="font-mono tabular-nums text-signal-strong-sell text-[11px]">{fmt(lo)}</div>
    </div>
  );
}

// ───────── Option Chain Snapshot ─────────
type OptSnap = {
  underlying: string; spot: number; expiry: string;
  daysToExpiry?: number; expiryContext?: string;
  atmStrike: number; atmStraddle: number; expectedMovePct: number;
  pcrOi: number; pcrVolume: number; atmIv?: number | null; maxPain: number;
  maxCallOiStrike?: number | null; maxPutOiStrike?: number | null;
  bias: string; interpretation: string;
};
const OPT_BIAS_TONE: Record<string, string> = {
  BULLISH: "bg-signal-strong-buy/15 text-signal-strong-buy border-signal-strong-buy/30",
  BEARISH: "bg-signal-strong-sell/15 text-signal-strong-sell border-signal-strong-sell/30",
  NEUTRAL: "bg-secondary/60 text-muted-foreground border-border/40",
};
const EXPIRY_TONE: Record<string, { tone: string; label: string }> = {
  EXPIRY_TODAY:     { tone: "bg-signal-strong-sell/20 text-signal-strong-sell border-signal-strong-sell/50",  label: "EXPIRY TODAY" },
  EXPIRY_TOMORROW:  { tone: "bg-amber-500/20 text-amber-400 border-amber-500/40",                              label: "EXPIRY TOMORROW" },
  EXPIRY_THIS_WEEK: { tone: "bg-amber-500/10 text-amber-300 border-amber-500/30",                              label: "EXPIRY THIS WEEK" },
  EXPIRY_NEXT_WEEK: { tone: "bg-secondary/60 text-muted-foreground border-border/40",                          label: "NEXT WEEK" },
  FAR:              { tone: "bg-secondary/40 text-muted-foreground border-border/30",                          label: "FAR" },
};
function OptionSnapshotCard({ snap }: { snap: OptSnap }) {
  const expCtx = snap.expiryContext ? EXPIRY_TONE[snap.expiryContext] : undefined;
  return (
    <Card className="border border-border/50">
      <CardContent className="p-4">
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <div className="text-sm font-bold font-mono">{snap.underlying}</div>
          <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${OPT_BIAS_TONE[snap.bias] ?? OPT_BIAS_TONE["NEUTRAL"]}`}>
            {snap.bias}
          </span>
        </div>
        <div className="text-[10px] font-mono text-muted-foreground mb-2 flex items-center flex-wrap gap-1.5">
          <span>spot {fmt(snap.spot)}</span>
          <span>·</span>
          <span>expiry {snap.expiry}</span>
          {snap.daysToExpiry != null && (
            <>
              <span>·</span>
              <span>{snap.daysToExpiry === 0 ? "0d" : `${snap.daysToExpiry}d`}</span>
            </>
          )}
          {expCtx && snap.expiryContext !== "FAR" && snap.expiryContext !== "EXPIRY_NEXT_WEEK" && (
            <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${expCtx.tone}`}>
              {expCtx.label}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <KV label="ATM Strike"   value={fmt(snap.atmStrike, 0)} />
          <KV label="ATM Straddle" value={fmt(snap.atmStraddle)} />
          <KV label="Exp. Move"    value={`±${snap.expectedMovePct.toFixed(2)}%`} tone="text-foreground font-bold" />
          <KV label="ATM IV"       value={snap.atmIv != null ? `${snap.atmIv.toFixed(1)}%` : "—"} />
          <KV label="PCR (OI)"     value={snap.pcrOi.toFixed(2)} tone={snap.pcrOi > 1.2 ? "text-signal-strong-buy" : snap.pcrOi < 0.8 ? "text-signal-strong-sell" : ""} />
          <KV label="PCR (Vol)"    value={snap.pcrVolume.toFixed(2)} />
          <KV label="Max Pain"     value={fmt(snap.maxPain, 0)} />
          <KV label="Resistance"   value={snap.maxCallOiStrike != null ? fmt(snap.maxCallOiStrike, 0) : "—"} tone="text-signal-strong-sell" />
          <KV label="Support"      value={snap.maxPutOiStrike  != null ? fmt(snap.maxPutOiStrike, 0)  : "—"} tone="text-signal-strong-buy" />
        </div>

        {snap.interpretation && (
          <p className="text-xs text-foreground/80 mt-3 pt-3 border-t border-border/40 leading-relaxed">
            {snap.interpretation}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
function KV({ label, value, tone: t }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase text-muted-foreground">{label}</div>
      <div className={`font-mono tabular-nums text-sm ${t ?? ""}`}>{value}</div>
    </div>
  );
}

// ───────── Sector Heatmap tile ─────────
function SectorTile({ s }: { s: { sector: string; avgChangePercent: number; gainers: number; losers: number; stockCount: number; topPickSymbol?: string } }) {
  const intensity = Math.min(1, Math.abs(s.avgChangePercent) / 2.5);
  const bg = s.avgChangePercent > 0
    ? `rgba(34,197,94,${0.08 + intensity * 0.22})`
    : s.avgChangePercent < 0
      ? `rgba(239,68,68,${0.08 + intensity * 0.22})`
      : "rgba(148,163,184,0.08)";
  return (
    <div
      className="rounded border border-border/40 p-2.5 transition-colors"
      style={{ backgroundColor: bg }}
      title={`${s.gainers} up · ${s.losers} down out of ${s.stockCount}${s.topPickSymbol ? ` · top: ${s.topPickSymbol}` : ""}`}
    >
      <div className="text-[11px] font-medium truncate">{s.sector}</div>
      <div className={`text-sm font-bold font-mono tabular-nums ${tone(s.avgChangePercent)}`}>
        {pct(s.avgChangePercent)}
      </div>
      <div className="text-[9px] font-mono text-muted-foreground mt-0.5">
        <span className="text-signal-strong-buy">{s.gainers}↑</span> · <span className="text-signal-strong-sell">{s.losers}↓</span> · {s.stockCount} stk
      </div>
    </div>
  );
}

// ───────── FII / DII snapshot ─────────
function FiiDiiCard({ f }: { f: { latestDate: string; fiiCashCr: number; diiCashCr: number; fiveDayFiiCr: number; fiveDayDiiCr: number } }) {
  return (
    <Card className="border border-border/50">
      <CardContent className="p-4">
        <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2">
          <Building2 className="w-3.5 h-3.5" /> FII / DII Cash · {f.latestDate}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FlowStat label="FII (latest)"  value={f.fiiCashCr}    />
          <FlowStat label="DII (latest)"  value={f.diiCashCr}    />
          <FlowStat label="FII (5-day)"   value={f.fiveDayFiiCr} />
          <FlowStat label="DII (5-day)"   value={f.fiveDayDiiCr} />
        </div>
        <div className="mt-3 pt-3 border-t border-border/40 text-[10px] font-mono text-muted-foreground leading-relaxed">
          {(f.diiCashCr > 0 && f.fiiCashCr < 0) ? "DII absorbing FII selling — typically supportive." :
           (f.diiCashCr < 0 && f.fiiCashCr < 0) ? "Both sides selling — caution; weak hands lifting bids." :
           (f.diiCashCr > 0 && f.fiiCashCr > 0) ? "Both sides buying — strong undertone." :
           "Mixed flows."}
        </div>
      </CardContent>
    </Card>
  );
}
function FlowStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase text-muted-foreground">{label}</div>
      <div className={`font-mono tabular-nums text-sm font-bold ${tone(value)}`}>
        {value >= 0 ? "+" : ""}{value.toLocaleString("en-IN", { maximumFractionDigits: 0 })} <span className="text-[9px] text-muted-foreground font-normal">Cr</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  Setup for Tomorrow — right-side panel (Moneycontrol-style
//  "15 things to know before the opening bell")
// ═══════════════════════════════════════════════════════════════

function SetupForTomorrow({ data }: { data: PreMarketReport }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setExpanded(p => ({ ...p, [k]: !p[k] }));

  const niftyLevels = data.indexLevels?.find((l: { symbol: string }) => l.symbol === "^NSEI");
  const bnLevels = data.indexLevels?.find((l: { symbol: string }) => l.symbol === "^NSEBANK");
  const niftyOpt = data.optionSnapshots?.find((o: { underlying: string }) => o.underlying === "NIFTY");
  const bnOpt = data.optionSnapshots?.find((o: { underlying: string }) => o.underlying === "BANKNIFTY");
  const vixCue = data.overnightCues?.find((c: { label?: string }) => c.label === "India VIX");
  const setup = data.tomorrowSetup;
  const oi = setup?.oiBuildupSummary;

  const items: Array<{
    num: number;
    icon: React.ReactNode;
    title: string;
    subtitle?: string;
    content: React.ReactNode;
    expandKey?: string;
    available: boolean;
  }> = [
    {
      num: 1,
      icon: <Target className="w-3.5 h-3.5 text-blue-400" />,
      title: "Nifty 50 Key Levels",
      subtitle: niftyLevels ? `Prev close ${fmt(niftyLevels.previousClose)}` : undefined,
      available: !!niftyLevels,
      content: niftyLevels ? <KeyLevelsBlock lv={niftyLevels} /> : null,
    },
    {
      num: 2,
      icon: <Target className="w-3.5 h-3.5 text-purple-400" />,
      title: "Bank Nifty Key Levels",
      subtitle: bnLevels ? `Prev close ${fmt(bnLevels.previousClose)}` : undefined,
      available: !!bnLevels,
      content: bnLevels ? <KeyLevelsBlock lv={bnLevels} /> : null,
    },
    {
      num: 3,
      icon: <Crosshair className="w-3.5 h-3.5 text-red-400" />,
      title: "Nifty Option Walls",
      subtitle: niftyOpt ? expiryTagText(niftyOpt) : undefined,
      available: !!niftyOpt && (!!niftyOpt.maxCallOiStrike || !!niftyOpt.maxPutOiStrike),
      content: niftyOpt ? <OptionWallsBlock opt={niftyOpt} /> : null,
    },
    {
      num: 4,
      icon: <Gauge className="w-3.5 h-3.5 text-green-400" />,
      title: "Nifty Option Snapshot",
      subtitle: niftyOpt ? `ATM ${fmt(niftyOpt.atmStrike, 0)}` : undefined,
      available: !!niftyOpt,
      content: niftyOpt ? <OptionSnapshotBlock opt={niftyOpt} /> : null,
    },
    {
      num: 5,
      icon: <Crosshair className="w-3.5 h-3.5 text-red-300" />,
      title: "Bank Nifty Option Walls",
      subtitle: bnOpt ? expiryTagText(bnOpt) : undefined,
      available: !!bnOpt && (!!bnOpt.maxCallOiStrike || !!bnOpt.maxPutOiStrike),
      content: bnOpt ? <OptionWallsBlock opt={bnOpt} /> : null,
    },
    {
      num: 6,
      icon: <Gauge className="w-3.5 h-3.5 text-green-300" />,
      title: "Bank Nifty Option Snapshot",
      subtitle: bnOpt ? `ATM ${fmt(bnOpt.atmStrike, 0)}` : undefined,
      available: !!bnOpt,
      content: bnOpt ? <OptionSnapshotBlock opt={bnOpt} /> : null,
    },
    {
      num: 7,
      icon: <Building2 className="w-3.5 h-3.5 text-amber-400" />,
      title: "FII / DII Flows",
      subtitle: data.fiiDii ? `as of ${data.fiiDii.latestDate}` : undefined,
      available: !!data.fiiDii,
      content: data.fiiDii ? <FiiDiiBlock f={data.fiiDii} /> : null,
    },
    {
      num: 8,
      icon: <Gauge className="w-3.5 h-3.5 text-cyan-400" />,
      title: "Put-Call Ratio",
      subtitle: niftyOpt ? "OI + Volume" : undefined,
      available: !!niftyOpt,
      content: niftyOpt ? <PcrBlock niftyOpt={niftyOpt} bnOpt={bnOpt} /> : null,
    },
    {
      num: 9,
      icon: <Zap className="w-3.5 h-3.5 text-yellow-400" />,
      title: "India VIX",
      subtitle: vixCue ? vixRegimeLabel(vixCue.value) : undefined,
      available: !!vixCue,
      content: vixCue ? <VixBlock cue={vixCue} /> : null,
    },
    {
      num: 10,
      icon: <TrendingUp className="w-3.5 h-3.5 text-signal-strong-buy" />,
      title: `Long Buildup (${oi?.longBuildup ?? 0})`,
      available: !!oi,
      expandKey: "longBuildup",
      content: oi ? (
        <div className="text-xs space-y-1">
          <div className="text-[10px] text-muted-foreground/80 mb-1">Price ↑ + OI ↑ — fresh longs being added</div>
          {expanded["longBuildup"] && oi.topLongBuildup && oi.topLongBuildup.length > 0 && (
            <div className="space-y-0.5">
              {oi.topLongBuildup.map(s => (
                <div key={s.symbol} className="flex justify-between">
                  <Link href={`/stock/${encodeURIComponent(s.symbol ?? "")}`} className="font-mono text-signal-strong-buy hover:underline">{s.symbol}</Link>
                  <span className="font-mono tabular-nums text-muted-foreground">OI {pct(s.oiChgPct)} · Price {pct(s.priceChgPct)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null,
    },
    {
      num: 11,
      icon: <TrendingDown className="w-3.5 h-3.5 text-muted-foreground" />,
      title: `Long Unwinding (${oi?.longUnwinding ?? 0})`,
      available: !!oi,
      expandKey: "longUnwinding",
      content: oi ? (
        <div className="text-xs space-y-1">
          <div className="text-[10px] text-muted-foreground/80 mb-1">Price ↓ + OI ↓ — longs exiting</div>
          {expanded["longUnwinding"] && oi.topLongUnwinding && oi.topLongUnwinding.length > 0 && (
            <div className="space-y-0.5">
              {oi.topLongUnwinding.map(s => (
                <div key={s.symbol} className="flex justify-between">
                  <Link href={`/stock/${encodeURIComponent(s.symbol ?? "")}`} className="font-mono text-muted-foreground hover:underline">{s.symbol}</Link>
                  <span className="font-mono tabular-nums text-muted-foreground">OI {pct(s.oiChgPct)} · Price {pct(s.priceChgPct)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null,
    },
    {
      num: 12,
      icon: <TrendingDown className="w-3.5 h-3.5 text-signal-strong-sell" />,
      title: `Short Buildup (${oi?.shortBuildup ?? 0})`,
      available: !!oi,
      expandKey: "shortBuildup",
      content: oi ? (
        <div className="text-xs space-y-1">
          <div className="text-[10px] text-muted-foreground/80 mb-1">Price ↓ + OI ↑ — fresh shorts being added</div>
          {expanded["shortBuildup"] && oi.topShortBuildup && oi.topShortBuildup.length > 0 && (
            <div className="space-y-0.5">
              {oi.topShortBuildup.map(s => (
                <div key={s.symbol} className="flex justify-between">
                  <Link href={`/stock/${encodeURIComponent(s.symbol ?? "")}`} className="font-mono text-signal-strong-sell hover:underline">{s.symbol}</Link>
                  <span className="font-mono tabular-nums text-muted-foreground">OI {pct(s.oiChgPct)} · Price {pct(s.priceChgPct)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null,
    },
    {
      num: 13,
      icon: <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />,
      title: `Short Covering (${oi?.shortCovering ?? 0})`,
      available: !!oi,
      expandKey: "shortCovering",
      content: oi ? (
        <div className="text-xs space-y-1">
          <div className="text-[10px] text-muted-foreground/80 mb-1">Price ↑ + OI ↓ — shorts exiting</div>
          {expanded["shortCovering"] && oi.topShortCovering && oi.topShortCovering.length > 0 && (
            <div className="space-y-0.5">
              {oi.topShortCovering.map(s => (
                <div key={s.symbol} className="flex justify-between">
                  <Link href={`/stock/${encodeURIComponent(s.symbol ?? "")}`} className="font-mono text-emerald-400 hover:underline">{s.symbol}</Link>
                  <span className="font-mono tabular-nums text-muted-foreground">OI {pct(s.oiChgPct)} · Price {pct(s.priceChgPct)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null,
    },
    {
      num: 14,
      icon: <Package className="w-3.5 h-3.5 text-sky-400" />,
      title: `High Delivery (${setup?.highDeliveryStocks?.length ?? 0})`,
      available: (setup?.highDeliveryStocks?.length ?? 0) > 0,
      expandKey: "delivery",
      content: setup?.highDeliveryStocks && setup.highDeliveryStocks.length > 0 ? (
        <div className="text-xs space-y-1">
          <div className="text-[10px] text-muted-foreground/80 mb-1">50%+ delivery — investing (not trading) interest</div>
          {expanded["delivery"] && (
            <div className="space-y-0.5">
              {setup.highDeliveryStocks.slice(0, 10).map(s => (
                <div key={s.symbol} className="flex justify-between">
                  <Link href={`/stock/${encodeURIComponent(s.symbol ?? "")}`} className="font-mono text-sky-400 hover:underline">{s.symbol}</Link>
                  <span className="font-mono tabular-nums text-muted-foreground">{s.deliveryPct?.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null,
    },
    {
      num: 15,
      icon: <Ban className="w-3.5 h-3.5 text-orange-400" />,
      title: "F&O Ban",
      available: !!setup,
      content: (
        <div className="text-xs">
          {!setup ? (
            <span className="text-muted-foreground/70">Ban data unavailable</span>
          ) : setup.foBanStocks && setup.foBanStocks.length > 0 ? (
            <div className="space-y-0.5">
              {setup.foBanStocks.map(s => (
                <Link key={s} href={`/stock/${encodeURIComponent(s)}`} className="font-mono text-orange-400 hover:underline block">{s}</Link>
              ))}
            </div>
          ) : (
            <span className="text-signal-strong-buy/70">No stocks under F&O ban</span>
          )}
        </div>
      ),
    },
  ];

  // Section grouping: 1-2 = key levels, 3-6 = option chain (Nifty + BN), 7-9 = macro, 10-15 = stock activity
  const sectionFor = (n: number): "LEVELS" | "OPTIONS" | "MACRO" | "STOCKS" =>
    n <= 2 ? "LEVELS" : n <= 6 ? "OPTIONS" : n <= 9 ? "MACRO" : "STOCKS";
  const sectionTitle: Record<string, string> = {
    LEVELS: "Key Levels",
    OPTIONS: "Option-Chain Setup",
    MACRO: "Macro & Sentiment",
    STOCKS: "F&O Stock Activity",
  };

  return (
    <Card className="border-2 border-border/70 bg-card/80 backdrop-blur-sm shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-4 pb-3 border-b-2 border-border/50">
          <ClipboardList className="w-4 h-4 text-amber-400" />
          <h2 className="text-sm font-bold tracking-tight">Setup for Tomorrow</h2>
          <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-400 ml-auto">
            15 pts
          </span>
        </div>

        <div className="space-y-2">
          {items.map((item, i) => {
            const sec = sectionFor(item.num);
            const prevSec = i > 0 ? sectionFor(items[i - 1]!.num) : null;
            const showHeader = sec !== prevSec;
            return (
              <div key={item.num}>
                {showHeader && (
                  <div className="flex items-center gap-2 mt-3 first:mt-0 mb-1.5">
                    <div className="h-px flex-1 bg-border/40" />
                    <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/60">
                      {sectionTitle[sec]}
                    </span>
                    <div className="h-px flex-1 bg-border/40" />
                  </div>
                )}
                <SetupItem
                  num={item.num}
                  icon={item.icon}
                  title={item.title}
                  subtitle={item.subtitle}
                  available={item.available}
                  expandable={!!item.expandKey}
                  isExpanded={!!item.expandKey && !!expanded[item.expandKey]}
                  onToggle={item.expandKey ? () => toggle(item.expandKey!) : undefined}
                >
                  {item.content}
                </SetupItem>
              </div>
            );
          })}
        </div>

        <div className="mt-4 pt-3 border-t-2 border-border/50">
          <div className="text-[10px] text-muted-foreground/70 font-mono text-center">
            Data populates post-market · Global cues update overnight
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Per-item subcard wrapper — bordered for ease of reading ───
function SetupItem({
  num, icon, title, subtitle, available, expandable, isExpanded, onToggle, children,
}: {
  num: number;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  available: boolean;
  expandable?: boolean;
  isExpanded?: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border border-border/60 bg-secondary/15 overflow-hidden transition-colors ${
        !available ? "opacity-40" : "hover:border-border/80"
      }`}
    >
      <button
        type="button"
        className={`flex items-center gap-2 w-full text-left px-2.5 py-2 ${
          expandable && available
            ? "cursor-pointer hover:bg-secondary/30"
            : "cursor-default"
        } ${available && children ? "border-b border-border/40" : ""}`}
        onClick={expandable && available ? onToggle : undefined}
        disabled={!expandable || !available}
      >
        <span className="text-[10px] font-mono font-bold text-muted-foreground/70 w-5 text-right shrink-0 tabular-nums">
          {num}
        </span>
        <span className="shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold truncate leading-tight">{title}</div>
          {subtitle && (
            <div className="text-[10px] text-muted-foreground/70 font-mono truncate leading-tight mt-0.5">
              {subtitle}
            </div>
          )}
        </div>
        {expandable && available && (
          isExpanded
            ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        )}
        {!available && (
          <span className="text-[9px] text-muted-foreground/50 font-mono shrink-0">no data</span>
        )}
      </button>
      {available && children && (
        <div className="px-3 py-2 bg-card/40">{children}</div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Per-item content blocks — each surfaces all available fields
// from the OpenAPI schema (KeyIndexLevels, OptionSnapshot,
// FiiDiiSnapshot, OvernightCue) instead of just one or two.
// ═══════════════════════════════════════════════════════════════

type LevelsLike = NonNullable<PreMarketReport["indexLevels"]>[number];
type OptLike    = NonNullable<PreMarketReport["optionSnapshots"]>[number];
type CueLike    = PreMarketReport["overnightCues"][number];
type FiiLike    = NonNullable<PreMarketReport["fiiDii"]>;

function KvRow({ label, value, valueClass }: { label: React.ReactNode; value: React.ReactNode; valueClass?: string }) {
  return (
    <div className="flex justify-between items-baseline gap-2 text-xs py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono tabular-nums ${valueClass ?? ""}`}>{value}</span>
    </div>
  );
}

function KeyLevelsBlock({ lv }: { lv: LevelsLike }) {
  // Position-in-52w bar — visual where price sits in the yearly range.
  const pos = Math.max(0, Math.min(100, lv.positionInYearRangePct));
  return (
    <div className="space-y-1.5">
      <KvRow label="Pivot" value={fmt(lv.pivot)} valueClass="font-bold" />
      <KvRow label="R1 / R2" value={`${fmt(lv.r1)} / ${fmt(lv.r2)}`} valueClass="text-signal-strong-sell/90" />
      <KvRow label="S1 / S2" value={`${fmt(lv.s1)} / ${fmt(lv.s2)}`} valueClass="text-signal-strong-buy/90" />
      <KvRow
        label="CPR"
        value={
          <>
            {fmt(lv.cprBottom)}–{fmt(lv.cprTop)}{" "}
            <span className={`text-[10px] ${
              lv.cprWidthLabel === "NARROW" ? "text-amber-400"
              : lv.cprWidthLabel === "WIDE" ? "text-cyan-400"
              : "text-muted-foreground/70"
            }`}>
              ({lv.cprWidthLabel} {lv.cprWidthPct.toFixed(2)}%)
            </span>
          </>
        }
        valueClass="text-[11px]"
      />
      <KvRow label="Prev H / L" value={`${fmt(lv.prevHigh)} / ${fmt(lv.prevLow)}`} />
      {lv.todayOpen != null && (
        <KvRow label="Today's Open" value={fmt(lv.todayOpen)} valueClass="text-foreground/90" />
      )}
      <KvRow label="52W H / L" value={`${fmt(lv.yearHigh)} / ${fmt(lv.yearLow)}`} valueClass="text-[11px]" />
      <div className="pt-1">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground/80 mb-1">
          <span>Position in 52W range</span>
          <span className="font-mono tabular-nums">{pos.toFixed(0)}%</span>
        </div>
        <div className="relative h-1.5 rounded-full bg-secondary/60 overflow-hidden">
          <div
            className="absolute top-0 h-full bg-gradient-to-r from-signal-strong-sell/70 via-amber-500/70 to-signal-strong-buy/70"
            style={{ width: `${pos}%` }}
          />
          <div
            className="absolute top-0 h-full w-0.5 bg-foreground"
            style={{ left: `${pos}%`, transform: "translateX(-50%)" }}
          />
        </div>
        <div className="flex justify-between text-[9px] font-mono text-muted-foreground/60 mt-0.5">
          <span>{fmt(lv.yearLow, 0)}</span>
          <span>{fmt(lv.yearHigh, 0)}</span>
        </div>
      </div>
      {lv.cprWidthLabel === "NARROW" && (
        <div className="text-[10px] text-amber-400/90 mt-1">
          Narrow CPR → trending day likely
        </div>
      )}
      {lv.cprWidthLabel === "WIDE" && (
        <div className="text-[10px] text-cyan-400/90 mt-1">
          Wide CPR → range / chop likely
        </div>
      )}
    </div>
  );
}

function expiryTagText(opt: OptLike): string {
  const tag =
    opt.expiryContext === "EXPIRY_TODAY" ? "Expires today"
    : opt.expiryContext === "EXPIRY_TOMORROW" ? "Expires tomorrow"
    : opt.expiryContext === "EXPIRY_THIS_WEEK" ? `Expires this week (${opt.daysToExpiry}d)`
    : opt.expiryContext === "EXPIRY_NEXT_WEEK" ? `Next week (${opt.daysToExpiry}d)`
    : `${opt.daysToExpiry}d to expiry`;
  return tag;
}

function OptionWallsBlock({ opt }: { opt: OptLike }) {
  const ceDist = opt.maxCallOiStrike != null && opt.spot > 0
    ? ((opt.maxCallOiStrike - opt.spot) / opt.spot) * 100
    : null;
  const peDist = opt.maxPutOiStrike != null && opt.spot > 0
    ? ((opt.maxPutOiStrike - opt.spot) / opt.spot) * 100
    : null;
  const mpDist = opt.maxPain != null && opt.spot > 0
    ? ((opt.maxPain - opt.spot) / opt.spot) * 100
    : null;
  return (
    <div className="space-y-1.5">
      {opt.maxCallOiStrike != null && (
        <KvRow
          label="Max CE OI (resistance)"
          value={
            <>
              <span className="text-signal-strong-sell font-bold">{fmt(opt.maxCallOiStrike, 0)}</span>
              {ceDist != null && (
                <span className="text-[10px] text-muted-foreground/70 ml-1">
                  ({ceDist >= 0 ? "+" : ""}{ceDist.toFixed(2)}%)
                </span>
              )}
            </>
          }
        />
      )}
      {opt.maxPutOiStrike != null && (
        <KvRow
          label="Max PE OI (support)"
          value={
            <>
              <span className="text-signal-strong-buy font-bold">{fmt(opt.maxPutOiStrike, 0)}</span>
              {peDist != null && (
                <span className="text-[10px] text-muted-foreground/70 ml-1">
                  ({peDist >= 0 ? "+" : ""}{peDist.toFixed(2)}%)
                </span>
              )}
            </>
          }
        />
      )}
      <KvRow
        label="Max Pain"
        value={
          <>
            <span className="text-amber-400 font-bold">{fmt(opt.maxPain, 0)}</span>
            {mpDist != null && (
              <span className="text-[10px] text-muted-foreground/70 ml-1">
                ({mpDist >= 0 ? "+" : ""}{mpDist.toFixed(2)}%)
              </span>
            )}
          </>
        }
      />
      <KvRow label="Spot" value={fmt(opt.spot)} valueClass="text-muted-foreground" />
      <div className="text-[10px] text-muted-foreground/80 mt-1.5 pt-1.5 border-t border-border/30">
        Walls = strikes with the largest open interest. Price tends to gravitate toward Max Pain into expiry.
      </div>
    </div>
  );
}

function OptionSnapshotBlock({ opt }: { opt: OptLike }) {
  const expectedMovePts = opt.atmStraddle;
  const biasTone = opt.bias === "BULLISH" ? "text-signal-strong-buy"
                 : opt.bias === "BEARISH" ? "text-signal-strong-sell"
                 : "text-muted-foreground";
  const biasBg = opt.bias === "BULLISH" ? "bg-signal-strong-buy/10 border-signal-strong-buy/30"
               : opt.bias === "BEARISH" ? "bg-signal-strong-sell/10 border-signal-strong-sell/30"
               : "bg-secondary/40 border-border/40";
  return (
    <div className="space-y-1.5">
      <KvRow label="ATM Strike" value={fmt(opt.atmStrike, 0)} valueClass="font-bold" />
      <KvRow
        label="ATM Straddle"
        value={
          <>
            ₹{fmt(opt.atmStraddle, 0)}
            <span className="text-[10px] text-muted-foreground/70 ml-1">pts</span>
          </>
        }
      />
      <KvRow
        label="Expected Move"
        value={
          <>
            ±{opt.expectedMovePct.toFixed(2)}%
            <span className="text-[10px] text-muted-foreground/70 ml-1">
              (±{fmt(expectedMovePts, 0)} pts)
            </span>
          </>
        }
        valueClass="font-bold"
      />
      {opt.atmIv != null && (
        <KvRow label="ATM IV" value={`${opt.atmIv.toFixed(1)}%`} />
      )}
      <KvRow
        label="Days to Expiry"
        value={`${opt.daysToExpiry}d`}
        valueClass={opt.daysToExpiry === 0 ? "text-amber-400 font-bold" : ""}
      />
      <div className={`mt-2 px-2 py-1.5 rounded border ${biasBg}`}>
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span className="text-[10px] font-mono uppercase text-muted-foreground/80">Bias</span>
          <span className={`text-xs font-bold ${biasTone}`}>{opt.bias}</span>
        </div>
        <div className="text-[10px] text-foreground/85 leading-snug">{opt.interpretation}</div>
      </div>
    </div>
  );
}

function FiiDiiBlock({ f }: { f: FiiLike }) {
  // Combined net = directional pressure on cash market.
  const combined = f.fiiCashCr + f.diiCashCr;
  return (
    <div className="space-y-1.5">
      <KvRow
        label="FII Net"
        value={
          <span className={`font-bold ${tone(f.fiiCashCr)}`}>
            {f.fiiCashCr >= 0 ? "+" : ""}
            {f.fiiCashCr.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr
          </span>
        }
      />
      <KvRow
        label="DII Net"
        value={
          <span className={`font-bold ${tone(f.diiCashCr)}`}>
            {f.diiCashCr >= 0 ? "+" : ""}
            {f.diiCashCr.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr
          </span>
        }
      />
      <KvRow
        label="Combined"
        value={
          <span className={`font-bold ${tone(combined)}`}>
            {combined >= 0 ? "+" : ""}
            {combined.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr
          </span>
        }
      />
      <div className="pt-1.5 mt-1 border-t border-border/30 space-y-0.5">
        <KvRow
          label="5d FII"
          value={
            <span className={tone(f.fiveDayFiiCr)}>
              {f.fiveDayFiiCr >= 0 ? "+" : ""}
              {f.fiveDayFiiCr.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr
            </span>
          }
          valueClass="text-[11px]"
        />
        <KvRow
          label="5d DII"
          value={
            <span className={tone(f.fiveDayDiiCr)}>
              {f.fiveDayDiiCr >= 0 ? "+" : ""}
              {f.fiveDayDiiCr.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr
            </span>
          }
          valueClass="text-[11px]"
        />
      </div>
      <div className="text-[10px] text-muted-foreground/80 mt-1.5">
        {Math.abs(f.fiiCashCr) > 1500 && f.fiiCashCr * f.diiCashCr < 0
          ? "FIIs and DIIs are tugging in opposite directions — choppy intraday tape likely."
          : combined > 1000
            ? "Net inflow — supports gap-ups and dip buys."
            : combined < -1000
              ? "Net outflow — caps rallies, supports breakdowns."
              : "Flows roughly balanced — direction set by global cues."}
      </div>
    </div>
  );
}

function PcrBlock({ niftyOpt, bnOpt }: { niftyOpt: OptLike; bnOpt?: OptLike }) {
  const pcrTone = (p: number) =>
    p >= 1.3 ? "text-signal-strong-buy"
    : p <= 0.7 ? "text-signal-strong-sell"
    : "text-foreground";
  // Confluence between OI PCR and Volume PCR is the strongest read.
  const niftyAligned = (niftyOpt.pcrOi >= 1.2 && niftyOpt.pcrVolume >= 1.2)
                    || (niftyOpt.pcrOi <= 0.8 && niftyOpt.pcrVolume <= 0.8);
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-3 gap-2 items-center text-xs">
        <span className="text-muted-foreground">Index</span>
        <span className="text-right text-[10px] font-mono uppercase text-muted-foreground/70">PCR (OI)</span>
        <span className="text-right text-[10px] font-mono uppercase text-muted-foreground/70">PCR (Vol)</span>
      </div>
      <div className="grid grid-cols-3 gap-2 items-center text-xs">
        <span className="font-medium">Nifty</span>
        <span className={`text-right font-mono tabular-nums font-bold ${pcrTone(niftyOpt.pcrOi)}`}>
          {niftyOpt.pcrOi.toFixed(2)}
        </span>
        <span className={`text-right font-mono tabular-nums ${pcrTone(niftyOpt.pcrVolume)}`}>
          {niftyOpt.pcrVolume.toFixed(2)}
        </span>
      </div>
      {bnOpt && (
        <div className="grid grid-cols-3 gap-2 items-center text-xs">
          <span className="font-medium">Bank Nifty</span>
          <span className={`text-right font-mono tabular-nums font-bold ${pcrTone(bnOpt.pcrOi)}`}>
            {bnOpt.pcrOi.toFixed(2)}
          </span>
          <span className={`text-right font-mono tabular-nums ${pcrTone(bnOpt.pcrVolume)}`}>
            {bnOpt.pcrVolume.toFixed(2)}
          </span>
        </div>
      )}
      <div className="text-[10px] text-muted-foreground/80 mt-1.5 pt-1.5 border-t border-border/30 leading-snug">
        {niftyOpt.pcrOi >= 1.3
          ? "Nifty PCR ≥ 1.3 → heavy put writing, bullish undertone."
          : niftyOpt.pcrOi <= 0.7
            ? "Nifty PCR ≤ 0.7 → call-heavy, bearish pressure."
            : niftyOpt.pcrOi >= 1.0
              ? "Nifty PCR mildly elevated → neutral-to-bullish positioning."
              : "Nifty PCR balanced → no clear directional bias."}
        {niftyAligned && (
          <span className="text-emerald-400/90"> OI + Volume PCR aligned (strong signal).</span>
        )}
      </div>
    </div>
  );
}

function vixRegimeLabel(v: number | null | undefined): string {
  if (v == null) return "";
  if (v >= 20) return "High volatility";
  if (v >= 15) return "Elevated";
  if (v >= 12) return "Moderate";
  return "Complacent";
}

function VixBlock({ cue }: { cue: CueLike }) {
  const v = cue.value ?? 0;
  const chg = cue.change ?? 0;
  const chgPct = cue.changePercent ?? 0;
  // VIX is inverted vs equities — rising VIX = bearish, falling = bullish.
  const equityImplication =
    chgPct > 5 ? "Sharp VIX spike → equities under stress."
    : chgPct > 0 ? "VIX up → equities biased weaker."
    : chgPct < -5 ? "Sharp VIX drop → risk appetite returning."
    : "VIX cooling → equity-positive."
  const regime =
    v >= 20 ? "High volatility — wider stops, smaller size, expect violent intraday swings."
    : v >= 15 ? "Elevated — option premiums richer than usual; favour debit-spreads over naked longs."
    : v >= 12 ? "Moderate — normal volatility environment."
    : "Complacent — surprise moves possible; avoid selling cheap volatility.";
  return (
    <div className="space-y-1.5">
      <KvRow label="Level" value={v.toFixed(2)} valueClass="font-bold text-base" />
      <KvRow
        label="Change"
        value={
          <span className={tone(-chgPct)}>
            {chg >= 0 ? "+" : ""}{chg.toFixed(2)} ({pct(chgPct)})
          </span>
        }
      />
      <div className="text-[10px] text-muted-foreground/85 mt-1.5 pt-1.5 border-t border-border/30 leading-snug">
        {regime}
      </div>
      <div className={`text-[10px] mt-0.5 ${chgPct > 0 ? "text-signal-strong-sell/90" : "text-signal-strong-buy/90"}`}>
        {equityImplication}
      </div>
    </div>
  );
}
