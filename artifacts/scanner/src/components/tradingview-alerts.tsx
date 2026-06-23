import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Radio, Copy, Check, Filter, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface TVAlert {
  id: string;
  receivedAt: string;
  symbol?: string;
  ticker?: string;
  exchange?: string;
  interval?: string;
  side?: string;
  strategy?: string;
  setupKey?: string;
  timeframe?: string;
  price?: number;
  stopLoss?: number;
  target1?: number;
  target2?: number;
  riskRewardRatio?: number;
  urgency?: string;
  rationale?: string;
  tags?: string[];
  note?: string;
  message?: string;
}

interface AlertsResponse {
  alerts: TVAlert[];
  count: number;
  secretConfigured: boolean;
  serverTime: string;
}

function sideTone(side?: string): { cls: string; label: string } {
  const s = (side ?? "").toUpperCase();
  if (s === "BUY" || s === "LONG") return { cls: "bg-signal-strong-buy/15 text-signal-strong-buy border-signal-strong-buy/40", label: s };
  if (s === "SELL" || s === "SHORT") return { cls: "bg-signal-strong-sell/15 text-signal-strong-sell border-signal-strong-sell/40", label: s };
  if (s === "EXIT") return { cls: "bg-yellow-500/15 text-yellow-400 border-yellow-500/40", label: s };
  if (s === "STOP") return { cls: "bg-red-500/15 text-red-400 border-red-500/40", label: s };
  if (s === "TARGET") return { cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40", label: s };
  if (s === "INFO") return { cls: "bg-blue-500/15 text-blue-400 border-blue-500/40", label: s };
  if (s === "WARN") return { cls: "bg-orange-500/15 text-orange-400 border-orange-500/40", label: s };
  return { cls: "bg-secondary/40 text-muted-foreground border-border/50", label: s || "ALERT" };
}

function urgencyTone(u?: string): string {
  switch ((u ?? "").toLowerCase()) {
    case "critical": return "bg-red-500/15 text-red-400 border-red-500/40 animate-pulse";
    case "high":     return "bg-orange-500/15 text-orange-400 border-orange-500/40";
    case "medium":   return "bg-yellow-500/15 text-yellow-400 border-yellow-500/40";
    case "low":      return "bg-blue-500/15 text-blue-400 border-blue-500/40";
    default:         return "";
  }
}

function getWebhookUrl(): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${import.meta.env.BASE_URL}api/webhooks/tradingview`;
}

const PINE_TEMPLATES: Record<string, { label: string; code: string }> = {
  ema_cross: {
    label: "EMA 9/21 Cross (Trend)",
    code: `//@version=5
strategy("EMA 9/21 Cross", overlay=true)
emaFast = ta.ema(close, 9)
emaSlow = ta.ema(close, 21)
atr14   = ta.atr(14)
longCond  = ta.crossover(emaFast, emaSlow)
shortCond = ta.crossunder(emaFast, emaSlow)
if longCond
    sl = close - 1.5 * atr14
    t1 = close + 2.0 * atr14
    t2 = close + 3.5 * atr14
    strategy.entry("L", strategy.long, alert_message='{"side":"BUY","symbol":"{{ticker}}","price":{{close}},"sl":'+str.tostring(sl)+',"t1":'+str.tostring(t1)+',"t2":'+str.tostring(t2)+',"strategy":"EMA Cross","setupKey":"TREND_CONTINUATION","timeframe":"{{interval}}","urgency":"medium","tags":["TREND","ENTRY"],"rationale":"Fast EMA crossed above slow EMA"}')
if shortCond
    sl = close + 1.5 * atr14
    t1 = close - 2.0 * atr14
    t2 = close - 3.5 * atr14
    strategy.entry("S", strategy.short, alert_message='{"side":"SELL","symbol":"{{ticker}}","price":{{close}},"sl":'+str.tostring(sl)+',"t1":'+str.tostring(t1)+',"t2":'+str.tostring(t2)+',"strategy":"EMA Cross","setupKey":"TREND_CONTINUATION","timeframe":"{{interval}}","urgency":"medium","tags":["TREND","ENTRY"],"rationale":"Fast EMA crossed below slow EMA"}')`,
  },
  rsi_div: {
    label: "RSI Divergence (Reversal)",
    code: `//@version=5
indicator("RSI Divergence Alert", overlay=false)
src   = close
rsi   = ta.rsi(src, 14)
plot(rsi, "RSI", color=color.purple)
hline(70); hline(30)
// crude bullish/bearish divergence over last 5 bars
bullDiv = ta.lowest(src, 5) < ta.lowest(src, 5)[5] and ta.lowest(rsi, 5) > ta.lowest(rsi, 5)[5] and rsi < 35
bearDiv = ta.highest(src, 5) > ta.highest(src, 5)[5] and ta.highest(rsi, 5) < ta.highest(rsi, 5)[5] and rsi > 65
alertcondition(bullDiv, "Bull Div", message='{"side":"BUY","symbol":"{{ticker}}","price":{{close}},"strategy":"RSI Divergence","setupKey":"MEAN_REVERSION","urgency":"high","tags":["REVERSAL","DIVERGENCE"],"rationale":"Bullish RSI divergence at oversold"}')
alertcondition(bearDiv, "Bear Div", message='{"side":"SELL","symbol":"{{ticker}}","price":{{close}},"strategy":"RSI Divergence","setupKey":"MEAN_REVERSION","urgency":"high","tags":["REVERSAL","DIVERGENCE"],"rationale":"Bearish RSI divergence at overbought"}')`,
  },
  orb: {
    label: "Opening Range Breakout (Intraday)",
    code: `//@version=5
indicator("Opening Range Breakout", overlay=true)
isOR     = time("0915-0930","Asia/Kolkata")
var float orHigh = na
var float orLow  = na
if isOR
    orHigh := math.max(nz(orHigh, high), high)
    orLow  := math.min(nz(orLow, low),   low)
plot(orHigh, "OR High", color=color.green)
plot(orLow,  "OR Low",  color=color.red)
brkUp   = ta.crossover(close, orHigh) and not isOR
brkDown = ta.crossunder(close, orLow) and not isOR
alertcondition(brkUp,   "ORB Up",   message='{"side":"BUY","symbol":"{{ticker}}","price":{{close}},"sl":' + str.tostring(orLow) + ',"t1":' + str.tostring(close + (orHigh - orLow)) + ',"strategy":"ORB","setupKey":"VOLUME_BREAKOUT","urgency":"high","tags":["BREAKOUT","INTRADAY"],"rationale":"Close broke opening-range high"}')
alertcondition(brkDown, "ORB Down", message='{"side":"SELL","symbol":"{{ticker}}","price":{{close}},"sl":' + str.tostring(orHigh) + ',"t1":' + str.tostring(close - (orHigh - orLow)) + ',"strategy":"ORB","setupKey":"VOLUME_BREAKOUT","urgency":"high","tags":["BREAKDOWN","INTRADAY"],"rationale":"Close broke opening-range low"}')`,
  },
};

function fmtNum(n?: number): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
}

/** Alerts within this many minutes of "now" are considered LIVE. */
export const TV_ALERT_FRESH_MINUTES = 120;

export type TvFreshnessState = "LIVE" | "STALE" | "NO_ALERTS_RECEIVED" | "WEBHOOK_NOT_CONFIGURED";

export interface TvFreshness {
  state: TvFreshnessState;
  newestReceivedAt: string | null;
  newestAgeMinutes: number | null;
}

/**
 * PURE freshness classifier (unit-tested). Priority: no webhook secret →
 * WEBHOOK_NOT_CONFIGURED; no alerts → NO_ALERTS_RECEIVED; newest within the
 * window → LIVE; else STALE. Prevents 2-month-old rows from rendering as live.
 */
export function deriveTvFreshness(input: {
  alerts: { receivedAt: string }[];
  secretConfigured: boolean;
  now?: Date;
  windowMinutes?: number;
}): TvFreshness {
  const now = input.now ?? new Date();
  const windowMinutes = input.windowMinutes ?? TV_ALERT_FRESH_MINUTES;
  if (!input.secretConfigured) {
    return { state: "WEBHOOK_NOT_CONFIGURED", newestReceivedAt: null, newestAgeMinutes: null };
  }
  let newestMs = -Infinity;
  let newestIso: string | null = null;
  for (const a of input.alerts ?? []) {
    const t = new Date(a.receivedAt).getTime();
    if (Number.isFinite(t) && t > newestMs) {
      newestMs = t;
      newestIso = a.receivedAt;
    }
  }
  if (newestIso === null) {
    return { state: "NO_ALERTS_RECEIVED", newestReceivedAt: null, newestAgeMinutes: null };
  }
  const ageMin = (now.getTime() - newestMs) / 60_000;
  return {
    state: ageMin <= windowMinutes ? "LIVE" : "STALE",
    newestReceivedAt: newestIso,
    newestAgeMinutes: ageMin,
  };
}

function isAlertStale(receivedAt: string, now: Date, windowMinutes: number): boolean {
  const t = new Date(receivedAt).getTime();
  if (!Number.isFinite(t)) return true;
  return (now.getTime() - t) / 60_000 > windowMinutes;
}

function freshnessBadge(state: TvFreshnessState): { label: string; cls: string } {
  switch (state) {
    case "LIVE": return { label: "LIVE", cls: "border-signal-strong-buy/40 text-signal-strong-buy" };
    case "STALE": return { label: "STALE", cls: "border-amber-500/40 text-amber-400" };
    case "NO_ALERTS_RECEIVED": return { label: "NO ALERTS", cls: "border-border text-muted-foreground" };
    case "WEBHOOK_NOT_CONFIGURED": return { label: "WEBHOOK OFF", cls: "border-red-500/40 text-red-400" };
  }
}

export function TradingViewAlerts() {
  const [setupOpen, setSetupOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [tplKey, setTplKey] = useState<keyof typeof PINE_TEMPLATES>("ema_cross");
  const [sideF, setSideF] = useState<string>("ALL");
  const [symbolF, setSymbolF] = useState<string>("");
  const [strategyF, setStrategyF] = useState<string>("ALL");
  const [showStale, setShowStale] = useState(false);

  const { data } = useQuery<AlertsResponse>({
    queryKey: ["tv-alerts"],
    queryFn: async () => {
      const r = await fetch(`${import.meta.env.BASE_URL}api/webhooks/tradingview?limit=50`);
      if (!r.ok) throw new Error("Failed to load alerts");
      return r.json();
    },
    refetchInterval: 10_000,
  });

  const alerts = data?.alerts ?? [];
  const secretConfigured = data?.secretConfigured ?? false;
  const now = new Date();
  const freshness = deriveTvFreshness({ alerts, secretConfigured, now });

  const { strategies, filtered } = useMemo(() => {
    const stratSet = new Set<string>();
    for (const a of alerts) if (a.strategy) stratSet.add(a.strategy);
    const sym = symbolF.trim().toUpperCase();
    const out = alerts.filter(a => {
      if (sideF !== "ALL" && (a.side ?? "").toUpperCase() !== sideF) return false;
      if (strategyF !== "ALL" && a.strategy !== strategyF) return false;
      if (sym) {
        const s = `${a.symbol ?? ""} ${a.ticker ?? ""}`.toUpperCase();
        if (!s.includes(sym)) return false;
      }
      return true;
    });
    return { strategies: [...stratSet].sort(), filtered: out };
  }, [alerts, sideF, strategyF, symbolF]);

  const webhookUrl = getWebhookUrl();
  const filtersActive = sideF !== "ALL" || strategyF !== "ALL" || symbolF.trim() !== "";

  const copy = async (text: string, kind: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* noop */ }
  };

  const tpl = PINE_TEMPLATES[tplKey]!;

  return (
    <Card className="border-primary/20 bg-primary/[0.02]">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-primary" />
            <h2 className="font-mono font-bold text-sm uppercase tracking-wider">TradingView Alerts</h2>
            <Badge variant="outline" className="font-mono text-[10px] border-border">
              {filtered.length}/{alerts.length} shown
            </Badge>
            <Badge variant="outline" className={`font-mono text-[10px] ${freshnessBadge(freshness.state).cls}`} data-testid="tv-freshness-badge">
              {freshnessBadge(freshness.state).label}
            </Badge>
            {data?.secretConfigured && (
              <Badge variant="outline" className="font-mono text-[10px] border-signal-strong-buy/40 text-signal-strong-buy">
                secret on
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSetupOpen(o => !o)}
            className="font-mono text-[11px] uppercase tracking-wider h-7"
          >
            How to connect {setupOpen ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
          </Button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap text-[11px] font-mono">
          <Filter className="w-3 h-3 text-muted-foreground" />
          <select
            value={sideF}
            onChange={e => setSideF(e.target.value)}
            className="bg-background border border-border/50 rounded px-2 py-1 text-[11px] uppercase tracking-wider"
          >
            <option value="ALL">All sides</option>
            <option value="BUY">Buy</option>
            <option value="LONG">Long</option>
            <option value="SELL">Sell</option>
            <option value="SHORT">Short</option>
            <option value="EXIT">Exit</option>
            <option value="STOP">Stop</option>
            <option value="TARGET">Target</option>
            <option value="INFO">Info</option>
            <option value="WARN">Warn</option>
          </select>
          <select
            value={strategyF}
            onChange={e => setStrategyF(e.target.value)}
            className="bg-background border border-border/50 rounded px-2 py-1 text-[11px]"
          >
            <option value="ALL">All strategies</option>
            {strategies.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input
            type="text"
            placeholder="Symbol filter…"
            value={symbolF}
            onChange={e => setSymbolF(e.target.value)}
            className="bg-background border border-border/50 rounded px-2 py-1 text-[11px] w-32"
          />
          {filtersActive && (
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => { setSideF("ALL"); setStrategyF("ALL"); setSymbolF(""); }}>
              <X className="w-3 h-3 mr-1" /> Reset
            </Button>
          )}
        </div>

        {setupOpen && (
          <div className="rounded border border-border/60 bg-background/40 p-3 space-y-3 text-xs">
            <div>
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
                1. In TradingView → Alert → Webhook URL
              </div>
              <div className="flex items-center gap-2 rounded border border-border/40 bg-background px-2 py-1.5">
                <code className="font-mono text-[11px] flex-1 break-all">{webhookUrl}</code>
                <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => copy(webhookUrl, "url")}>
                  {copied === "url" ? <Check className="w-3 h-3 text-signal-strong-buy" /> : <Copy className="w-3 h-3" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1 leading-snug">
                Webhook alerts require TradingView <span className="text-foreground">Premium / Pro+</span>. The engine accepts the canonical fields plus extended ones —
                <code className="font-mono"> side, symbol, price, sl, t1, t2, rr, urgency, tags, rationale, setupKey, strategy, timeframe, note</code>.
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  2. Sample Pine Script — pick a template
                </div>
                <select
                  value={tplKey}
                  onChange={e => setTplKey(e.target.value as keyof typeof PINE_TEMPLATES)}
                  className="bg-background border border-border/50 rounded px-2 py-1 text-[11px]"
                >
                  {Object.entries(PINE_TEMPLATES).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-start gap-2">
                <pre className="rounded border border-border/40 bg-background p-2 overflow-x-auto text-[10.5px] font-mono leading-relaxed flex-1 max-h-64">{tpl.code}</pre>
                <Button size="sm" variant="ghost" className="h-6 px-2 shrink-0" onClick={() => copy(tpl.code, `pine-${tplKey}`)}>
                  {copied === `pine-${tplKey}` ? <Check className="w-3 h-3 text-signal-strong-buy" /> : <Copy className="w-3 h-3" />}
                </Button>
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-snug">
              Alerts appear here within ~10 seconds. Last 100 alerts kept in memory; older ones live in the database.
            </p>
          </div>
        )}

        {freshness.state === "WEBHOOK_NOT_CONFIGURED" ? (
          <div className="text-xs font-mono text-amber-300/90 py-4 text-center border border-dashed border-amber-500/40 rounded" data-testid="tv-webhook-not-configured">
            TradingView webhook not configured — set the webhook secret to start receiving alerts.
          </div>
        ) : freshness.state === "NO_ALERTS_RECEIVED" ? (
          <div className="text-xs font-mono text-muted-foreground py-4 text-center border border-dashed border-border/50 rounded" data-testid="tv-no-alerts">
            No alerts received yet — set up the webhook above to start streaming TradingView signals here.
          </div>
        ) : (
          <div className="space-y-1.5">
            {freshness.state === "STALE" && (
              <div className="flex items-center justify-between gap-2 flex-wrap rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-mono text-amber-200" data-testid="tv-stale-note">
                <span>
                  TradingView alerts stale — latest received {freshness.newestReceivedAt ? fmtDate(freshness.newestReceivedAt) : "—"}. Check webhook configuration.
                </span>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] shrink-0" onClick={() => setShowStale(s => !s)} data-testid="tv-toggle-stale">
                  {showStale ? "Hide stale alerts" : "Show stale alerts"}
                </Button>
              </div>
            )}
            {freshness.state === "LIVE" || showStale ? (
              filtered.length === 0 ? (
                <div className="text-xs font-mono text-muted-foreground py-4 text-center border border-dashed border-border/50 rounded">
                  No alerts match the current filters.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
                  {filtered.map(a => {
                    const tone = sideTone(a.side);
                    const uTone = urgencyTone(a.urgency);
                    const hasLevels = a.stopLoss != null || a.target1 != null || a.target2 != null;
                    const rowStale = isAlertStale(a.receivedAt, now, TV_ALERT_FRESH_MINUTES);
              return (
                <div
                  key={a.id}
                  className="rounded border border-border/40 bg-background/50 text-xs p-2 space-y-1"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-1.5 py-0.5 rounded border font-mono text-[10px] font-bold ${tone.cls}`}>
                      {tone.label}
                    </span>
                    <span className="font-mono font-bold text-foreground">{a.symbol ?? a.ticker ?? "—"}</span>
                    {a.price != null && (
                      <span className="font-mono tabular-nums text-muted-foreground">@ {fmtNum(a.price)}</span>
                    )}
                    {(a.timeframe ?? a.interval) && (
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {(a.timeframe ?? a.interval) + ((a.interval && /^\d+$/.test(a.interval)) ? "m" : "")}
                      </span>
                    )}
                    {a.strategy && (
                      <span className="text-[10px] font-mono text-muted-foreground">· {a.strategy}</span>
                    )}
                    {a.urgency && (
                      <span className={`px-1.5 py-0.5 rounded border font-mono text-[9px] uppercase tracking-wider ${uTone}`}>
                        {a.urgency}
                      </span>
                    )}
                    {a.setupKey && (
                      <span className="px-1.5 py-0.5 rounded border border-border/50 bg-secondary/30 font-mono text-[9px]">
                        {a.setupKey}
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-1 text-[10px] font-mono text-muted-foreground shrink-0">
                      {rowStale && (
                        <span className="px-1 py-0.5 rounded border border-amber-500/40 text-amber-400 text-[9px] font-bold" data-testid="tv-row-stale">STALE</span>
                      )}
                      <span title={fmtDate(a.receivedAt)}>
                        {rowStale ? fmtDate(a.receivedAt) : formatDistanceToNow(new Date(a.receivedAt), { addSuffix: true })}
                      </span>
                    </span>
                  </div>

                  {hasLevels && (
                    <div className="flex items-center gap-3 text-[10px] font-mono tabular-nums pl-1">
                      {a.stopLoss != null && (
                        <span><span className="text-muted-foreground">SL </span><span className="text-red-400">{fmtNum(a.stopLoss)}</span></span>
                      )}
                      {a.target1 != null && (
                        <span><span className="text-muted-foreground">T1 </span><span className="text-emerald-400">{fmtNum(a.target1)}</span></span>
                      )}
                      {a.target2 != null && (
                        <span><span className="text-muted-foreground">T2 </span><span className="text-emerald-400">{fmtNum(a.target2)}</span></span>
                      )}
                      {a.riskRewardRatio != null && (
                        <span>
                          <span className="text-muted-foreground">RR </span>
                          <span className={a.riskRewardRatio >= 1.5 ? "text-emerald-400" : a.riskRewardRatio >= 1 ? "text-yellow-400" : "text-red-400"}>
                            {a.riskRewardRatio.toFixed(2)}
                          </span>
                        </span>
                      )}
                    </div>
                  )}

                  {a.tags && a.tags.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap pl-1">
                      {a.tags.map(t => (
                        <span key={t} className="px-1.5 py-0 rounded border border-border/40 bg-secondary/20 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}

                  {(a.rationale ?? a.note ?? a.message) && (
                    <div className="text-[11px] text-muted-foreground pl-1 line-clamp-2">
                      {a.rationale ?? a.note ?? a.message}
                    </div>
                  )}
                </div>
              );
                  })}
                </div>
              )
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
