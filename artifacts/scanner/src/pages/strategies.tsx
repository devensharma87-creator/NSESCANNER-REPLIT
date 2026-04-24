import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, TrendingUp, TrendingDown, Sparkles, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis, Tooltip,
  CartesianGrid, ReferenceLine, ReferenceDot,
} from "recharts";
import { FNO_ALL, QUICK_PRESETS } from "@/data/fnoUniverse";

const API_BASE = `${import.meta.env.BASE_URL}api`.replace(/\/+$/, "").replace(/\/api$/, "/api");

interface StrategyLeg {
  action: "BUY" | "SELL";
  optionType: "CE" | "PE";
  strike: number;
  premium: number;
  iv: number;
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
  qty: number;
  source: "chain" | "bs";
}

type StrategyKind =
  | "LONG_CALL" | "LONG_PUT"
  | "LONG_STRADDLE" | "SHORT_STRADDLE"
  | "LONG_STRANGLE" | "SHORT_STRANGLE"
  | "BULL_CALL_SPREAD" | "BEAR_PUT_SPREAD"
  | "BULL_PUT_SPREAD"  | "BEAR_CALL_SPREAD"
  | "IRON_CONDOR" | "IRON_BUTTERFLY" | "COVERED_CALL";

interface StrategySnapshot {
  kind: StrategyKind;
  name: string;
  category: "DEBIT" | "CREDIT" | "STOCK_PLUS";
  outlook: string;
  description: string;
  legs: StrategyLeg[];
  netDebit: number;
  netGreeks: { delta: number; gamma: number; vega: number; theta: number };
  maxProfit: number | null;
  maxLoss: number | null;
  breakevens: number[];
  payoff: { spot: number; pnl: number }[];
  pop: number | null;
  rrRatio: number | null;
  lotSize: number;
  perLot: { maxProfit: number | null; maxLoss: number | null; netDebit: number };
  suitability: { ivContext: "LOW" | "HIGH" | "ANY"; biasFit: ("BULLISH" | "BEARISH" | "NEUTRAL")[] };
  recommended: boolean;
  rationale?: string;
}

interface StrategyBundle {
  underlying: string;
  spot: number;
  expiry: string;
  daysToExpiry: number;
  ivContext: "LOW" | "HIGH" | "UNKNOWN";
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  strategies: StrategySnapshot[];
  unavailable: { kind: StrategyKind; reason: string }[];
  generatedAt: string;
  analytics?: {
    pcrOi: number; maxPain: number; atmIv: number | null; ivPercentile: number | null;
    interpretation: string;
  };
}

interface ApiError { error: string; detail?: string; kiteAuthenticated?: boolean }

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body?.error ?? `HTTP ${res.status}`), { body });
  return body as T;
}

const fmt = (n: number | null | undefined, d = 2) =>
  n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtSigned = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : (n >= 0 ? "+" : "") + fmt(n);
const fmtRupees = (n: number | null | undefined) => n == null ? "—" : (n >= 0 ? "+₹" : "−₹") + fmt(Math.abs(n), 0);
const fmtPctRaw = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : `${(n * 100).toFixed(1)}%`;

const KIND_BADGE: Record<StrategySnapshot["category"], string> = {
  DEBIT:      "bg-blue-500/10 text-blue-300 border-blue-500/30",
  CREDIT:     "bg-amber-500/10 text-amber-300 border-amber-500/30",
  STOCK_PLUS: "bg-purple-500/10 text-purple-300 border-purple-500/30",
};

export default function Strategies() {
  const [picker, setPicker] = useState<typeof FNO_ALL[number] | null>(QUICK_PRESETS[0]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<StrategyKind>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return FNO_ALL.slice(0, 30);
    return FNO_ALL.filter(e => e.sym.includes(q) || e.label.toUpperCase().includes(q)).slice(0, 50);
  }, [query]);

  const bundleQ = useQuery<StrategyBundle, Error & { body?: ApiError }>({
    queryKey: ["strategies", picker?.sym],
    queryFn: () => apiGet<StrategyBundle>(`/options/strategies/${encodeURIComponent(picker!.sym)}`),
    enabled: !!picker,
    refetchInterval: 30_000,
    retry: false,
  });

  const recommended = useMemo(() => bundleQ.data?.strategies.filter(s => s.recommended) ?? [], [bundleQ.data]);
  const others      = useMemo(() => bundleQ.data?.strategies.filter(s => !s.recommended) ?? [], [bundleQ.data]);

  const toggle = (k: StrategyKind) => {
    setExpanded(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  };

  return (
    <div className="w-full max-w-none px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col items-center gap-3">
        <div className="text-center">
          <h1 className="text-2xl font-bold font-mono tracking-tight">OPTION STRATEGIES</h1>
          <p className="text-xs text-muted-foreground font-mono">
            13 multi-leg strategies built from live option chains. Greeks via Black-Scholes.
            Recommendations filter by current bias + IV regime.
          </p>
        </div>

        <div ref={containerRef} className="relative w-full max-w-2xl">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={picker ? `${picker.sym} — ${picker.label}` : "Pick an underlying…"}
              value={query}
              onFocus={() => setOpen(true)}
              onChange={e => { setQuery(e.target.value); setOpen(true); }}
              className="pl-9 h-11 text-base bg-card border-border"
            />
          </div>
          {open && (
            <div className="absolute left-0 right-0 mt-1 rounded-md border border-border bg-card shadow-2xl max-h-[420px] overflow-auto z-50">
              {filtered.map(it => (
                <button
                  key={it.sym}
                  onClick={() => { setPicker(it); setQuery(""); setOpen(false); }}
                  className="w-full text-left flex items-center justify-between gap-3 px-3 py-2 hover:bg-white/5 border-b border-border/50 last:border-0"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className={`font-mono text-[9px] uppercase ${it.kind === "INDEX" ? "text-amber-400 border-amber-500/40" : ""}`}>
                      {it.kind}
                    </Badge>
                    <div className="min-w-0">
                      <div className="font-mono font-bold text-sm truncate">{it.sym}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{it.label} · {it.sector}</div>
                    </div>
                  </div>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="p-3 text-xs font-mono text-muted-foreground">No matches.</div>
              )}
            </div>
          )}
        </div>

        {/* Quick preset buttons */}
        <div className="flex flex-wrap gap-1.5 justify-center">
          {QUICK_PRESETS.map(p => (
            <Button
              key={p.sym}
              size="sm"
              variant={picker?.sym === p.sym ? "default" : "outline"}
              onClick={() => setPicker(p)}
              className="h-7 px-2.5 text-[11px] font-mono uppercase"
            >
              {p.sym}
            </Button>
          ))}
        </div>
      </div>

      {!picker ? null : bundleQ.isLoading && !bundleQ.data ? (
        <div className="grid md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[420px]" />)}
        </div>
      ) : bundleQ.error ? (
        <ErrorBlock error={bundleQ.error.body ?? { error: bundleQ.error.message }} underlying={picker.sym} />
      ) : bundleQ.data && (
        <>
          <ContextHeader bundle={bundleQ.data} />

          {recommended.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-mono uppercase tracking-wider text-amber-300">
                <Sparkles className="w-4 h-4" />
                Recommended for current regime ({recommended.length})
              </div>
              <div className="grid lg:grid-cols-2 gap-4">
                {recommended.map(s => (
                  <StrategyCard key={s.kind} s={s} spot={bundleQ.data!.spot} expanded={expanded.has(s.kind)} onToggle={() => toggle(s.kind)} highlight />
                ))}
              </div>
            </div>
          )}

          {others.length > 0 && (
            <div className="space-y-3">
              <div className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
                All strategies ({others.length})
              </div>
              <div className="grid lg:grid-cols-2 gap-4">
                {others.map(s => (
                  <StrategyCard key={s.kind} s={s} spot={bundleQ.data!.spot} expanded={expanded.has(s.kind)} onToggle={() => toggle(s.kind)} />
                ))}
              </div>
            </div>
          )}

          {bundleQ.data.unavailable.length > 0 && (
            <Card className="border-border/40 bg-card/60">
              <CardContent className="p-3 text-[11px] font-mono text-muted-foreground space-y-0.5">
                <div className="uppercase tracking-wider">Unavailable strategies (chain gaps):</div>
                {bundleQ.data.unavailable.map(u => (
                  <div key={u.kind}>· <span className="text-foreground/70">{u.kind}</span> — {u.reason}</div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function ContextHeader({ bundle }: { bundle: StrategyBundle }) {
  const biasColor =
    bundle.bias === "BULLISH" ? "text-signal-strong-buy"
    : bundle.bias === "BEARISH" ? "text-signal-strong-sell"
    : "text-foreground";
  const ivColor =
    bundle.ivContext === "HIGH" ? "text-amber-300"
    : bundle.ivContext === "LOW" ? "text-blue-300"
    : "text-muted-foreground";

  return (
    <Card className="border-border">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <h2 className="text-xl font-bold font-mono">{bundle.underlying}</h2>
              <Badge variant="outline" className="font-mono text-[10px]">EXP {bundle.expiry}</Badge>
              <Badge variant="outline" className="font-mono text-[10px]">{bundle.daysToExpiry}D to expiry</Badge>
            </div>
            {bundle.analytics?.interpretation && (
              <p className="text-[11px] text-muted-foreground font-mono max-w-3xl">{bundle.analytics.interpretation}</p>
            )}
          </div>
          <div className="text-right space-y-1">
            <div className="text-2xl font-mono font-bold tabular-nums">{fmt(bundle.spot)}</div>
            <div className="flex items-center justify-end gap-3 text-[11px] font-mono uppercase">
              <span><span className="text-muted-foreground">Bias</span> <span className={`font-bold ${biasColor}`}>{bundle.bias}</span></span>
              <span><span className="text-muted-foreground">IV</span> <span className={`font-bold ${ivColor}`}>{bundle.ivContext}</span></span>
              {bundle.analytics?.atmIv != null && (
                <span><span className="text-muted-foreground">ATM IV</span> <span className="font-bold text-foreground">{bundle.analytics.atmIv.toFixed(1)}%</span></span>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StrategyCard({
  s, spot, expanded, onToggle, highlight,
}: { s: StrategySnapshot; spot: number; expanded: boolean; onToggle: () => void; highlight?: boolean }) {
  const isCredit = s.netDebit < 0;
  const credit = Math.abs(s.netDebit * s.lotSize);
  const debit  = s.netDebit * s.lotSize;

  return (
    <Card className={`border-border ${highlight ? "ring-1 ring-amber-500/30" : ""}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-base font-mono">{s.name}</CardTitle>
              <Badge variant="outline" className={`font-mono text-[9px] uppercase ${KIND_BADGE[s.category]}`}>
                {s.category}
              </Badge>
              {highlight && <Badge variant="outline" className="font-mono text-[9px] uppercase bg-amber-500/10 text-amber-300 border-amber-500/30">Suggested</Badge>}
            </div>
            <p className="text-[11px] text-muted-foreground">{s.outlook}</p>
            {s.rationale && (
              <p className="text-[11px] font-mono text-amber-300/90">↳ {s.rationale}</p>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={onToggle} className="h-7 px-2 -mr-2 -mt-1">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Key stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border rounded overflow-hidden border border-border">
          <Stat
            label={isCredit ? "Net Credit" : "Net Debit"}
            value={fmtRupees(isCredit ? credit : -debit)}
            tone={isCredit ? "buy" : "sell"}
          />
          <Stat
            label="Max Profit"
            value={s.perLot.maxProfit == null ? "Unbounded" : fmtRupees(s.perLot.maxProfit)}
            tone={s.perLot.maxProfit == null || s.perLot.maxProfit > 0 ? "buy" : undefined}
          />
          <Stat
            label="Max Loss"
            value={s.perLot.maxLoss == null ? "Unbounded" : fmtRupees(s.perLot.maxLoss)}
            tone="sell"
          />
          <Stat label="POP" value={fmtPctRaw(s.pop)} />
        </div>

        {/* Payoff chart */}
        <PayoffChart s={s} spot={spot} />

        {/* Breakevens row */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono">
          <span><span className="text-muted-foreground uppercase">Breakeven{s.breakevens.length === 1 ? "" : "s"}:</span> {s.breakevens.length ? s.breakevens.map(b => fmt(b)).join(" / ") : "—"}</span>
          <span><span className="text-muted-foreground uppercase">R:R</span> {s.rrRatio == null ? "—" : `1 : ${(1 / s.rrRatio).toFixed(2)}`}</span>
          <span><span className="text-muted-foreground uppercase">Lot</span> {s.lotSize}</span>
        </div>

        {/* Net Greeks */}
        <div className="grid grid-cols-4 gap-px bg-border rounded overflow-hidden border border-border">
          <Stat label="Δ Delta" value={fmtSigned(s.netGreeks.delta)} small />
          <Stat label="Γ Gamma" value={s.netGreeks.gamma.toFixed(5)} small />
          <Stat label="Vega"   value={fmtSigned(s.netGreeks.vega)} small />
          <Stat label="Θ Theta" value={fmtSigned(s.netGreeks.theta)} tone={s.netGreeks.theta > 0 ? "buy" : "sell"} small />
        </div>

        {expanded && (
          <>
            <div className="text-[11px] text-muted-foreground italic">{s.description}</div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] font-mono">
                <thead className="text-muted-foreground uppercase text-[10px]">
                  <tr className="border-b border-border">
                    <th className="text-left py-1">Action</th>
                    <th className="text-left py-1">Type</th>
                    <th className="text-right py-1">Strike</th>
                    <th className="text-right py-1">Premium</th>
                    <th className="text-right py-1">IV</th>
                    <th className="text-right py-1">Δ</th>
                    <th className="text-right py-1">Θ/day</th>
                  </tr>
                </thead>
                <tbody>
                  {s.legs.map((l, i) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className={`py-1 font-bold ${l.action === "BUY" ? "text-signal-strong-buy" : "text-signal-strong-sell"}`}>{l.action}</td>
                      <td className="py-1">{l.optionType === "CE" ? "CALL" : "PUT"}</td>
                      <td className="text-right py-1 tabular-nums">{l.strike === 0 ? "Stock" : fmt(l.strike, 0)}</td>
                      <td className="text-right py-1 tabular-nums">₹{fmt(l.premium)}</td>
                      <td className="text-right py-1 tabular-nums">{(l.iv * 100).toFixed(1)}%</td>
                      <td className="text-right py-1 tabular-nums">{l.delta.toFixed(3)}</td>
                      <td className="text-right py-1 tabular-nums">{l.theta.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PayoffChart({ s, spot }: { s: StrategySnapshot; spot: number }) {
  const data = s.payoff;
  // Place the "you-are-here" dot at the live spot, with PnL linearly
  // interpolated between adjacent samples so the marker sits exactly on
  // the curve (no snap-to-grid drift).
  let spotPnl = 0;
  if (data.length) {
    if (spot <= data[0].spot)                         spotPnl = data[0].pnl;
    else if (spot >= data[data.length - 1].spot)      spotPnl = data[data.length - 1].pnl;
    else {
      let i = 1;
      while (i < data.length && data[i].spot < spot) i++;
      const a = data[i - 1], b = data[i];
      const t = (spot - a.spot) / (b.spot - a.spot);
      spotPnl = a.pnl + t * (b.pnl - a.pnl);
    }
  }

  return (
    <div className="h-[180px]">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="spot" tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }}
                 minTickGap={50} type="number" domain={["dataMin", "dataMax"]} />
          <YAxis tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }} width={56}
                 tickFormatter={v => `₹${v >= 0 ? "+" : ""}${(v / 1000).toFixed(1)}k`} />
          <Tooltip
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11, fontFamily: "monospace" }}
            formatter={(v: number) => [fmtRupees(v), "P&L at expiry"]}
            labelFormatter={(label: number) => `Spot ₹${fmt(label)}`}
          />
          <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 2" />
          {s.breakevens.map((b, i) => (
            <ReferenceLine key={i} x={b} stroke="hsl(45 95% 55%)" strokeDasharray="3 3" label={{ value: "BE", position: "top", fontSize: 9, fill: "hsl(45 95% 55%)" }} />
          ))}
          <ReferenceDot x={spot} y={spotPnl} r={3} fill="hsl(var(--foreground))" stroke="hsl(var(--foreground))" />
          <ReferenceLine x={spot} stroke="hsl(var(--foreground))" strokeOpacity={0.3} strokeDasharray="2 2" />
          <Area type="monotone" dataKey="pnl" stroke="hsl(var(--signal-strong-buy))" strokeWidth={1.5}
                fill="url(#pnlGradient)" baseValue={0} />
          <defs>
            <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="hsl(var(--signal-strong-buy))"  stopOpacity={0.4} />
              <stop offset="50%" stopColor="hsl(var(--signal-strong-buy))"  stopOpacity={0.0} />
              <stop offset="50%" stopColor="hsl(var(--signal-strong-sell))" stopOpacity={0.0} />
              <stop offset="100%" stopColor="hsl(var(--signal-strong-sell))" stopOpacity={0.4} />
            </linearGradient>
          </defs>
          <Line type="monotone" dataKey="pnl" stroke="hsl(var(--signal-strong-buy))" strokeWidth={1.8} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function Stat({ label, value, tone, small }: { label: string; value: React.ReactNode; tone?: "buy" | "sell"; small?: boolean }) {
  const cls = tone === "buy" ? "text-signal-strong-buy" : tone === "sell" ? "text-signal-strong-sell" : "text-foreground";
  return (
    <div className="bg-card p-2">
      <div className={`${small ? "text-[9px]" : "text-[10px]"} font-mono uppercase tracking-wider text-muted-foreground`}>{label}</div>
      <div className={`font-mono ${small ? "text-[12px]" : "text-sm"} font-bold tabular-nums mt-0.5 ${cls}`}>{value}</div>
    </div>
  );
}

function ErrorBlock({ error, underlying }: { error: ApiError; underlying: string }) {
  return (
    <Card className="border-signal-strong-sell/30">
      <CardContent className="p-4 space-y-2 text-sm font-mono">
        <div className="flex items-center gap-2 text-signal-strong-sell">
          <AlertCircle className="w-4 h-4" />
          <span className="font-bold uppercase">Strategies unavailable for {underlying}</span>
        </div>
        {error.detail && <p className="text-muted-foreground text-[12px] leading-relaxed">{error.detail}</p>}
        {!error.detail && error.error && <p className="text-muted-foreground text-[12px]">{error.error}</p>}
        {error.kiteAuthenticated != null && (
          <Badge variant="outline" className={`font-mono text-[10px] ${error.kiteAuthenticated ? "border-signal-strong-buy/40 text-signal-strong-buy" : "border-signal-strong-sell/40 text-signal-strong-sell"}`}>
            Kite session: {error.kiteAuthenticated ? "Active" : "Not authenticated"}
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}
