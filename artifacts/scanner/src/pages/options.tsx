import { useGetOptionSignals, getGetOptionSignalsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { TradingViewAlerts } from "@/components/tradingview-alerts";
import {
  TrendingUp, TrendingDown, Target, ShieldAlert, Crosshair, Zap, Activity, Layers, Repeat, RotateCcw,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useMemo } from "react";
import type { OptionSignal } from "@workspace/api-client-react";

const SETUP_ICON: Record<string, React.ReactNode> = {
  TREND_CONTINUATION: <Zap className="w-4 h-4" />,
  VWAP_RECLAIM: <Repeat className="w-4 h-4" />,
  VOLUME_BREAKOUT: <Layers className="w-4 h-4" />,
  EMA_PULLBACK: <Activity className="w-4 h-4" />,
  MEAN_REVERSION: <RotateCcw className="w-4 h-4" />,
};

function fmt(n: number | undefined | null) {
  if (n == null) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function ConfidencePill({ confidence }: { confidence: number }) {
  const tone =
    confidence >= 80 ? "bg-signal-strong-buy/20 text-signal-strong-buy border-signal-strong-buy/40"
      : confidence >= 70 ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/40"
        : "bg-secondary/40 text-muted-foreground border-border/40";
  return <span className={`px-2 py-0.5 rounded border text-[10px] font-mono font-bold ${tone}`}>{confidence}% conf</span>;
}

function SetupCard({ sig, planNumber, totalPlans }: { sig: OptionSignal; planNumber: number; totalPlans: number }) {
  const isCall = sig.leg.type === "CALL";
  const tone = isCall ? "border-signal-strong-buy/30 bg-signal-strong-buy/[0.04]" : "border-signal-strong-sell/30 bg-signal-strong-sell/[0.04]";
  const accent = isCall ? "text-signal-strong-buy" : "text-signal-strong-sell";

  // Levels-on-bar: visualise stop / entry / spot / target1 / target2 on a horizontal scale
  const lvls = [sig.leg.stopLoss, sig.leg.entry, sig.spot, sig.leg.target1, sig.leg.target2].filter(
    (n): n is number => typeof n === "number",
  );
  const min = Math.min(...lvls);
  const max = Math.max(...lvls);
  const span = Math.max(1e-6, max - min);
  const pct = (v: number | undefined | null) => (v == null ? null : ((v - min) / span) * 100);

  const risk = sig.leg.stopLoss != null && sig.leg.entry != null ? Math.abs(sig.leg.entry - sig.leg.stopLoss) : null;
  const reward = sig.leg.target1 != null && sig.leg.entry != null ? Math.abs(sig.leg.target1 - sig.leg.entry) : null;

  return (
    <div className={`rounded-md border ${tone} p-3 space-y-3`}>
      {/* Header — setup is the primary identifier; strike is secondary because it's
          shared across every plan for this index. */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider">
            <span className="px-1.5 py-0.5 rounded bg-secondary/60 text-foreground border border-border/40">
              Plan {planNumber} of {totalPlans}
            </span>
            <span className="flex items-center gap-1 text-muted-foreground">
              {SETUP_ICON[sig.setupKey ?? ""] ?? <Crosshair className="w-3 h-3" />}
              {sig.setupName ?? "Setup"}
            </span>
          </div>
          <div className={`mt-1.5 font-bold font-mono text-base flex items-center gap-2 ${accent}`}>
            {isCall ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            <span>BUY {sig.leg.type} · {sig.index} {fmt(sig.leg.strike)}</span>
          </div>
          <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
            {sig.leg.expiry ? <>expiry {sig.leg.expiry} · </> : null}
            ATM strike (same across plans)
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <ConfidencePill confidence={sig.confidence} />
          {sig.leg.riskRewardRatio != null && (
            <span className="text-[10px] font-mono text-muted-foreground">RR {sig.leg.riskRewardRatio}:1</span>
          )}
        </div>
      </div>

      {/* Trade thesis */}
      {sig.setupSummary && (
        <p className="text-xs text-muted-foreground leading-relaxed">{sig.setupSummary}</p>
      )}

      {/* Entry trigger */}
      {sig.entryTrigger && (
        <div className="rounded bg-background/60 border border-border/40 px-2 py-1.5 text-[11px] font-mono">
          <span className="text-muted-foreground uppercase tracking-wider mr-1">Trigger:</span>
          <span className="text-foreground">{sig.entryTrigger}</span>
        </div>
      )}

      {/* Levels grid — labelled "SPOT …" so it's unmistakable these are index levels,
          not option premium. Each plan computes its own levels from a different formula
          (swing-high vs VWAP offset vs VAH vs EMA21), which is why two plans on the same
          strike show different numbers. */}
      <div>
        <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
          Underlying ({sig.index}) levels — manage by spot, not by option price
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
          <Cell label="Spot Entry" value={fmt(sig.leg.entry)} icon={<Crosshair className="w-3 h-3" />} bold />
          <Cell label="Spot Stop" value={fmt(sig.leg.stopLoss)} icon={<ShieldAlert className="w-3 h-3 text-signal-strong-sell" />} />
          <Cell label="Spot T1" value={fmt(sig.leg.target1)} icon={<Target className="w-3 h-3 text-signal-strong-buy" />} />
          <Cell label="Spot T2" value={fmt(sig.leg.target2)} icon={<Target className="w-3 h-3 text-signal-strong-buy/60" />} />
        </div>
      </div>

      {risk != null && reward != null && (
        <div className="text-[10px] font-mono text-muted-foreground -mt-1">
          Risk {fmt(risk)} pts · Reward {fmt(reward)} pts (T1)
        </div>
      )}

      {/* Levels-on-bar visualisation */}
      <div className="space-y-1">
        <div
          className="relative h-2 rounded-full bg-secondary/40 overflow-hidden"
          role="img"
          aria-label={`Spot levels for this plan. Stop ${fmt(sig.leg.stopLoss)}, Entry ${fmt(sig.leg.entry)}, current Spot ${fmt(sig.spot)}, Target 1 ${fmt(sig.leg.target1)}, Target 2 ${fmt(sig.leg.target2)}.`}
        >
          {sig.leg.stopLoss != null && (
            <div className="absolute top-0 bottom-0 w-1 bg-signal-strong-sell/80" style={{ left: `calc(${pct(sig.leg.stopLoss)}% - 2px)` }} title={`Stop ${fmt(sig.leg.stopLoss)}`} />
          )}
          {sig.leg.entry != null && (
            <div className="absolute top-0 bottom-0 w-1 bg-foreground" style={{ left: `calc(${pct(sig.leg.entry)}% - 2px)` }} title={`Entry ${fmt(sig.leg.entry)}`} />
          )}
          <div className="absolute -top-1 -bottom-1 w-2 rounded-full bg-primary border-2 border-background"
            style={{ left: `calc(${pct(sig.spot)}% - 4px)` }} title={`Spot ${fmt(sig.spot)}`} />
          {sig.leg.target1 != null && (
            <div className="absolute top-0 bottom-0 w-1 bg-signal-strong-buy" style={{ left: `calc(${pct(sig.leg.target1)}% - 2px)` }} title={`T1 ${fmt(sig.leg.target1)}`} />
          )}
          {sig.leg.target2 != null && (
            <div className="absolute top-0 bottom-0 w-1 bg-signal-strong-buy/60" style={{ left: `calc(${pct(sig.leg.target2)}% - 2px)` }} title={`T2 ${fmt(sig.leg.target2)}`} />
          )}
        </div>
        <div className="flex justify-between text-[9px] font-mono text-muted-foreground">
          <span>SL</span><span>Entry</span><span className="text-primary">Spot</span><span>T1</span><span>T2</span>
        </div>
      </div>

      {/* Confluences */}
      <div className="space-y-1 border-t border-border/40 pt-2">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Confluences</div>
        {sig.drivers.slice(0, 4).map((d, i) => (
          <div key={i} className="flex items-start gap-2 text-xs">
            {d.bullish ? <TrendingUp className="w-3 h-3 mt-0.5 text-signal-strong-buy shrink-0" /> : <TrendingDown className="w-3 h-3 mt-0.5 text-signal-strong-sell shrink-0" />}
            <div>
              <span className="font-semibold">{d.label}</span>
              {d.detail && <span className="text-muted-foreground"> — {d.detail}</span>}
            </div>
          </div>
        ))}
      </div>

      {sig.invalidation && (
        <div className="text-[11px] text-muted-foreground border-t border-border/40 pt-2">
          <span className="uppercase tracking-wider mr-1 font-mono text-signal-strong-sell">Invalidation:</span>{sig.invalidation}
        </div>
      )}
    </div>
  );
}

function Cell({ label, value, icon, bold }: { label: string; value?: string; icon?: React.ReactNode; bold?: boolean }) {
  return (
    <div className="rounded bg-background/60 border border-border/30 p-1.5">
      <div className="flex items-center gap-1 text-[10px] uppercase text-muted-foreground tracking-wider">{icon}{label}</div>
      <div className={`font-mono ${bold ? "text-base font-bold" : "text-sm"}`}>{value ?? "—"}</div>
    </div>
  );
}

export default function OptionsPage() {
  const { data, isLoading } = useGetOptionSignals({
    query: { refetchInterval: 30000, queryKey: getGetOptionSignalsQueryKey() },
  });

  const grouped = useMemo(() => {
    const groups = new Map<string, OptionSignal[]>();
    for (const s of data?.signals ?? []) {
      const arr = groups.get(s.index) ?? [];
      arr.push(s);
      groups.set(s.index, arr);
    }
    return Array.from(groups.entries()).map(([index, signals]) => ({
      index,
      indexName: signals[0]?.indexName ?? index,
      spot: signals[0]?.spot ?? 0,
      spotChangePercent: signals[0]?.spotChangePercent,
      vwap: signals[0]?.vwap,
      ema9: signals[0]?.ema9,
      ema21: signals[0]?.ema21,
      rsi: (signals[0] as { rsi?: number } | undefined)?.rsi,
      pointOfControl: signals[0]?.pointOfControl,
      valueAreaHigh: signals[0]?.valueAreaHigh,
      valueAreaLow: signals[0]?.valueAreaLow,
      signals,
    }));
  }, [data]);

  const totalSignals = data?.signals?.length ?? 0;
  const generatedAt = data?.generatedAt;

  return (
    <div className="w-full max-w-none px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-mono tracking-tight flex items-center gap-2">
          <Crosshair className="w-6 h-6 text-primary" />
          INTRADAY F&O TRADE
        </h1>
        <p className="text-muted-foreground text-sm max-w-3xl mt-1">
          Up to 3 high-conviction CALL/PUT setups per index — built from <span className="text-foreground">Price Action · RSI · Fixed Volume Profile · VWAP · EMA 9/21</span>.
          Higher-conviction setups (≥50% with multi-indicator confluence) appear first; an always-on baseline directional read is also shown for every index.
        </p>
        <p className="text-xs text-muted-foreground max-w-3xl mt-2 leading-relaxed border-l-2 border-primary/40 pl-3">
          <span className="text-foreground font-mono uppercase tracking-wider">How to read this:</span> the strike (e.g. NIFTY 25500 CE) is the same across every plan for an index because it's the nearest ATM. The Entry / Stop / Target numbers are <span className="text-foreground">underlying spot</span> levels (where NIFTY itself needs to trade), not option premium. Different plans show different spot levels because each one is a different technical setup with its own trigger formula — they are alternative ways to take the same directional view.
        </p>
        <div className="text-[11px] font-mono text-muted-foreground mt-2 flex items-center gap-3">
          <span>{totalSignals} live setups across {grouped.length} indices</span>
          <span>·</span>
          <span>auto-refresh 30s</span>
          {generatedAt && <><span>·</span><span>updated {formatDistanceToNow(new Date(generatedAt))} ago</span></>}
        </div>
      </div>

      <TradingViewAlerts />

      {isLoading ? (
        <div className="space-y-6">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-96 w-full" />)}
        </div>
      ) : grouped.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="text-muted-foreground font-mono text-sm">No high-conviction setups right now — all indices in chop / between confluences.</div>
            <div className="text-xs text-muted-foreground/70 mt-1">Check back as the session develops. (Filters: ≥60% confidence, multi-indicator alignment required.)</div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map(grp => {
            const up = (grp.spotChangePercent ?? 0) >= 0;
            return (
              <Card key={grp.index} className="border-border">
                <CardContent className="p-4 space-y-4">
                  {/* Index header */}
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="font-mono font-bold text-lg flex items-center gap-2">
                        {grp.indexName}
                        <Badge variant="outline" className="font-mono text-[10px] border-border">{grp.signals.length} setup{grp.signals.length === 1 ? "" : "s"}</Badge>
                      </div>
                      <div className="text-xs font-mono mt-0.5">
                        <span className="text-foreground tabular-nums">Spot {fmt(grp.spot)}</span>
                        {grp.spotChangePercent != null && (
                          <span className={`ml-2 ${up ? "text-signal-strong-buy" : "text-signal-strong-sell"}`}>
                            {up ? "+" : ""}{grp.spotChangePercent.toFixed(2)}%
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-3 gap-y-1 text-[11px] font-mono">
                      <Stat label="VWAP" value={fmt(grp.vwap)} />
                      <Stat label="EMA9" value={fmt(grp.ema9)} />
                      <Stat label="EMA21" value={fmt(grp.ema21)} />
                      <Stat label="RSI14" value={grp.rsi != null ? grp.rsi.toFixed(1) : "—"} />
                      <Stat label="VAH" value={fmt(grp.valueAreaHigh)} />
                      <Stat label="POC" value={fmt(grp.pointOfControl)} sub={`VAL ${fmt(grp.valueAreaLow)}`} />
                    </div>
                  </div>

                  {/* Disambiguation banner — explains why same-strike plans show
                      different entry/SL/target. The UNDERLYING is the same; each plan
                      is a different technical setup with its own trigger formula. */}
                  {grp.signals.length > 1 && (
                    <div className="rounded border border-border/40 bg-secondary/20 px-3 py-2 text-[11px] text-muted-foreground leading-relaxed">
                      <span className="text-foreground font-mono uppercase tracking-wider mr-1">Why {grp.signals.length} plans on the same strike?</span>
                      Each plan below is an <span className="text-foreground">independent intraday setup</span> (Trend Continuation, VWAP Reclaim, Volume Breakout, Baseline, etc.) with its own trigger condition. They all point at the same ATM strike because that's the natural directional play on {grp.indexName}. The Spot Entry / Stop / Target levels differ because each setup uses a different formula (swing high vs VWAP offset vs Value Area vs EMA21). Pick the plan whose trigger fires first or whose style suits you — don't trade more than one at a time on the same instrument.
                    </div>
                  )}

                  {/* Setups grid */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    {grp.signals.map((s, i) => (
                      <SetupCard
                        key={`${s.index}-${s.setupKey}-${i}`}
                        sig={s}
                        planNumber={i + 1}
                        totalPlans={grp.signals.length}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground border-t border-border/40 pt-3">
        Educational analysis only. Strikes are nearest ATM for the next weekly expiry. Entry / SL / Targets are spot levels — pick the corresponding ATM CE/PE on your broker terminal and manage by underlying. Always verify with the live option chain before trading.
      </p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-foreground tabular-nums">{value}</div>
      {sub && <div className="text-[9px] text-muted-foreground/70 tabular-nums">{sub}</div>}
    </div>
  );
}
