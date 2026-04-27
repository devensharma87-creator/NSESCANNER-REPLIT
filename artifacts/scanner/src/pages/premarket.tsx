import { useGetPreMarket, getGetPreMarketQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import {
  Sun, Moon, TrendingUp, TrendingDown, Globe2, Activity, AlertCircle, Calendar,
  ArrowUpRight, ArrowDownRight, Gauge, BarChart3, Layers, Target, Building2, Crosshair,
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

      {/* Today's 3 scenarios — pre-planned trade book before the open */}
      {data.scenarios && data.scenarios.length > 0 && (
        <section>
          <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <Target className="w-4 h-4" /> Today's 3 Scenarios — Trade Plan
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {data.scenarios.map(s => (
              <ScenarioCard key={s.kind} scenario={s} />
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground/70 mt-2 italic">
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
          <p className="text-[10px] text-muted-foreground/70 mt-2 italic">
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
          <p className="text-[10px] text-muted-foreground/70 mt-2 italic">
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
          <p className="text-[11px] text-foreground/80 mt-3 pt-3 border-t border-border/40 leading-relaxed">
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
