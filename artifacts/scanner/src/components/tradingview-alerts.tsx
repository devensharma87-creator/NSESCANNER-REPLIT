import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Radio, Copy, Check } from "lucide-react";
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
  price?: number;
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
  return { cls: "bg-secondary/40 text-muted-foreground border-border/50", label: s || "ALERT" };
}

function getWebhookUrl(): string {
  // Build absolute URL the user must paste into TradingView's webhook field.
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${import.meta.env.BASE_URL}api/webhooks/tradingview`;
}

const PINE_TEMPLATE = `//@version=5
strategy("My Intraday Setup", overlay=true)
emaFast = ta.ema(close, 9)
emaSlow = ta.ema(close, 21)
longCond  = ta.crossover(emaFast, emaSlow)
shortCond = ta.crossunder(emaFast, emaSlow)
if longCond
    strategy.entry("L", strategy.long,  alert_message='{"side":"BUY","symbol":"{{ticker}}","price":{{close}},"strategy":"EMA Cross","interval":"{{interval}}","message":"Long entry"}')
if shortCond
    strategy.entry("S", strategy.short, alert_message='{"side":"SELL","symbol":"{{ticker}}","price":{{close}},"strategy":"EMA Cross","interval":"{{interval}}","message":"Short entry"}')
`;

export function TradingViewAlerts() {
  const [setupOpen, setSetupOpen] = useState(false);
  const [copied, setCopied] = useState<"url" | "pine" | null>(null);

  const { data } = useQuery<AlertsResponse>({
    queryKey: ["tv-alerts"],
    queryFn: async () => {
      const r = await fetch(`${import.meta.env.BASE_URL}api/webhooks/tradingview?limit=15`);
      if (!r.ok) throw new Error("Failed to load alerts");
      return r.json();
    },
    refetchInterval: 10_000,
  });

  const alerts = data?.alerts ?? [];
  const webhookUrl = getWebhookUrl();

  const copy = async (text: string, kind: "url" | "pine") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* noop */
    }
  };

  return (
    <Card className="border-primary/20 bg-primary/[0.02]">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-primary" />
            <h2 className="font-mono font-bold text-sm uppercase tracking-wider">TradingView Alerts</h2>
            <Badge variant="outline" className="font-mono text-[10px] border-border">
              {alerts.length} live
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
              <p className="text-[10px] text-muted-foreground mt-1">
                Webhook alerts require TradingView <span className="text-foreground">Premium / Pro+</span>. Set Alert
                Message to a JSON object — the engine extracts <code className="font-mono">side</code>,
                <code className="font-mono"> symbol</code>, <code className="font-mono">price</code>, <code className="font-mono">strategy</code>.
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
                  2. Sample Pine Script (paste in TradingView Pine Editor)
                </div>
                <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => copy(PINE_TEMPLATE, "pine")}>
                  {copied === "pine" ? <Check className="w-3 h-3 text-signal-strong-buy" /> : <Copy className="w-3 h-3" />}
                </Button>
              </div>
              <pre className="rounded border border-border/40 bg-background p-2 overflow-x-auto text-[10.5px] font-mono leading-relaxed">{PINE_TEMPLATE}</pre>
            </div>

            <p className="text-[10px] text-muted-foreground">
              Once an alert fires, it appears here within ~10 seconds. Last 100 alerts are kept in memory.
            </p>
          </div>
        )}

        {alerts.length === 0 ? (
          <div className="text-xs font-mono text-muted-foreground py-4 text-center border border-dashed border-border/50 rounded">
            No alerts received yet — set up the webhook above to start streaming TradingView signals here.
          </div>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {alerts.map(a => {
              const tone = sideTone(a.side);
              return (
                <div
                  key={a.id}
                  className="grid grid-cols-[auto_1fr_auto] items-center gap-2 px-2 py-1.5 rounded border border-border/40 bg-background/50 text-xs"
                >
                  <span className={`px-1.5 py-0.5 rounded border font-mono text-[10px] font-bold ${tone.cls}`}>
                    {tone.label}
                  </span>
                  <div className="min-w-0">
                    <div className="font-mono truncate">
                      <span className="font-bold text-foreground">{a.symbol ?? a.ticker ?? "—"}</span>
                      {a.price != null && (
                        <span className="ml-2 tabular-nums text-muted-foreground">@ {a.price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
                      )}
                      {a.interval && (
                        <span className="ml-2 text-[10px] text-muted-foreground">{a.interval}m</span>
                      )}
                      {a.strategy && (
                        <span className="ml-2 text-[10px] text-muted-foreground">· {a.strategy}</span>
                      )}
                    </div>
                    {a.message && (
                      <div className="text-[11px] text-muted-foreground truncate">{a.message}</div>
                    )}
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                    {formatDistanceToNow(new Date(a.receivedAt), { addSuffix: true })}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
