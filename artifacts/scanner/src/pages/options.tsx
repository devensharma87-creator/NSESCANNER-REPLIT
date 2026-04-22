import { useGetOptionSignals, getGetOptionSignalsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Target, ShieldAlert, Crosshair } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const BIAS_COLOR: Record<string, string> = {
  BULLISH: "text-signal-strong-buy",
  BEARISH: "text-signal-strong-sell",
  NEUTRAL: "text-muted-foreground",
};

export default function OptionsPage() {
  const { data, isLoading } = useGetOptionSignals({
    query: { refetchInterval: 30000, queryKey: getGetOptionSignalsQueryKey() },
  });

  return (
    <div className="w-full max-w-none px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-mono tracking-tight flex items-center gap-2">
          <Crosshair className="w-6 h-6 text-primary" />
          INDEX OPTION SIGNALS
        </h1>
        <p className="text-muted-foreground text-sm max-w-3xl mt-1">
          CALL / PUT setups for NIFTY, BANK NIFTY, FIN NIFTY, MIDCAP NIFTY and SENSEX built from intraday VWAP, EMA 9/21 stack, volume profile, RSI and price action. Refreshes every 30 seconds.
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-64 w-full" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {data?.signals?.map(sig => {
            const biasColor = BIAS_COLOR[sig.bias] ?? "text-muted-foreground";
            const isBull = sig.bias === "BULLISH";
            const isBear = sig.bias === "BEARISH";
            return (
              <Card key={sig.index} className={`border ${isBull ? "border-signal-strong-buy/30" : isBear ? "border-signal-strong-sell/30" : "border-border"}`}>
                <CardHeader className="pb-2 border-b border-border/40">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base font-mono">{sig.indexName}</CardTitle>
                      <div className="text-xs text-muted-foreground font-mono mt-0.5">
                        Spot {sig.spot.toFixed(2)} · {sig.spotChangePercent != null && (
                          <span className={sig.spotChangePercent >= 0 ? "text-signal-strong-buy" : "text-signal-strong-sell"}>
                            {sig.spotChangePercent >= 0 ? "+" : ""}{sig.spotChangePercent.toFixed(2)}%
                          </span>
                        )} · VWAP {sig.vwap?.toFixed(2)}
                      </div>
                    </div>
                    <Badge variant="outline" className={`font-mono text-[10px] ${biasColor} border-current`}>
                      {sig.bias} · {sig.confidence}%
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 pt-3">
                  {/* Trade card */}
                  <div className={`rounded border p-3 ${sig.leg.type === "CALL" ? "bg-signal-strong-buy/5 border-signal-strong-buy/30" : "bg-signal-strong-sell/5 border-signal-strong-sell/30"}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 font-mono text-sm font-bold">
                        {sig.leg.type === "CALL" ? <TrendingUp className="w-4 h-4 text-signal-strong-buy" /> : <TrendingDown className="w-4 h-4 text-signal-strong-sell" />}
                        {sig.leg.action} {sig.leg.type} · {sig.index} {sig.leg.strike} {sig.leg.expiry && <span className="text-muted-foreground font-normal">({sig.leg.expiry})</span>}
                      </div>
                      {sig.leg.riskRewardRatio != null && (
                        <span className="text-xs font-mono text-muted-foreground">RR {sig.leg.riskRewardRatio}:1</span>
                      )}
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-xs font-mono">
                      <Cell label="Entry" value={sig.leg.entry?.toFixed(2)} icon={<Crosshair className="w-3 h-3" />} />
                      <Cell label="Stop" value={sig.leg.stopLoss?.toFixed(2)} icon={<ShieldAlert className="w-3 h-3 text-signal-strong-sell" />} />
                      <Cell label="Target 1" value={sig.leg.target1?.toFixed(2)} icon={<Target className="w-3 h-3 text-signal-strong-buy" />} />
                      <Cell label="Target 2" value={sig.leg.target2?.toFixed(2)} icon={<Target className="w-3 h-3 text-signal-strong-buy" />} />
                    </div>
                  </div>

                  {/* Levels */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-[11px] font-mono text-muted-foreground">
                    {sig.ema9 != null && <span>EMA9 {sig.ema9.toFixed(2)}</span>}
                    {sig.ema21 != null && <span>EMA21 {sig.ema21.toFixed(2)}</span>}
                    {sig.pointOfControl != null && <span>POC {sig.pointOfControl.toFixed(2)}</span>}
                    {sig.valueAreaHigh != null && <span>VAH {sig.valueAreaHigh.toFixed(2)}</span>}
                    {sig.valueAreaLow != null && <span>VAL {sig.valueAreaLow.toFixed(2)}</span>}
                  </div>

                  {/* Drivers */}
                  <div className="space-y-1">
                    {sig.drivers.slice(0, 5).map((d, i) => (
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
                      <span className="uppercase tracking-wider mr-1 font-mono">Invalidation:</span>{sig.invalidation}
                    </div>
                  )}

                  <div className="text-[10px] text-muted-foreground font-mono text-right">
                    Updated {formatDistanceToNow(new Date(sig.generatedAt))} ago · {sig.timeframe}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground border-t border-border/40 pt-3">
        Educational analysis only. Always verify with the live option chain before trading. Strikes shown are the at-the-money level for the next weekly expiry; entries reference the underlying spot.
      </p>
    </div>
  );
}

function Cell({ label, value, icon }: { label: string; value?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded bg-background/60 border border-border/30 p-1.5">
      <div className="flex items-center gap-1 text-[10px] uppercase text-muted-foreground tracking-wider">{icon}{label}</div>
      <div className="font-bold text-sm">{value ?? "—"}</div>
    </div>
  );
}
