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
  bid: number | null;
  ask: number | null;
  spreadPct: number | null;
  oi: number | null;
  volume: number | null;
  quoted: boolean;
}

type StrategyKind =
  | "LONG_CALL" | "LONG_PUT"
  | "LONG_STRADDLE" | "SHORT_STRADDLE"
  | "LONG_STRANGLE" | "SHORT_STRANGLE"
  | "BULL_CALL_SPREAD" | "BEAR_PUT_SPREAD"
  | "BULL_PUT_SPREAD"  | "BEAR_CALL_SPREAD"
  | "IRON_CONDOR" | "IRON_BUTTERFLY" | "COVERED_CALL";

interface LegEdge {
  strike: number;
  type: "CE" | "PE";
  action: "BUY" | "SELL";
  mid: number;
  theoretical: number;
  edge: number;
}

interface DistMetrics {
  expectedValue: number;
  stdDev: number;
  pop: number;
  avgWin: number;
  avgLoss: number;
  probabilisticRr: number | null;
  expectedMove1Sigma: number;
  expectedMove2Sigma: number;
}

interface StrategySnapshot {
  kind: StrategyKind;
  name: string;
  category: "DEBIT" | "CREDIT" | "STOCK_PLUS";
  outlook: string;
  description: string;
  legs: StrategyLeg[];
  netDebit: number;
  netGreeks: { delta: number; gamma: number; vega: number; theta: number };
  maxProfit: number | null;       // theoretical (S=0 / S→∞)
  maxLoss: number | null;
  breakevens: number[];
  payoff: { spot: number; pnl: number }[];
  pop: number | null;
  rrRatio: number | null;          // theoretical
  // Chart-range extrema — what the user actually sees on the curve.
  // Card headlines use these so a Long Put no longer claims "Max Profit ₹15L"
  // (the math at S=0) when the chart only goes down to spot*0.9.
  displayMaxProfit: number;
  displayMaxLoss: number;
  displayRrRatio: number | null;
  // Distributional analytics from a single risk-neutral lognormal integration.
  dist: DistMetrics;
  legEdges: LegEdge[];
  netEdge: number;
  marginRequired: number;
  returnOnCapital: number | null;
  lotSize: number;
  perLot: {
    maxProfit: number | null;
    maxLoss: number | null;
    netDebit: number;
    displayMaxProfit: number;
    displayMaxLoss: number;
  };
  suitability: { ivContext: "LOW" | "HIGH" | "ANY"; biasFit: ("BULLISH" | "BEARISH" | "NEUTRAL")[] };
  recommended: boolean;
  rationale?: string;
  legQuality: "TIGHT" | "WIDE" | "POOR";
  avgLegIv: number;
  shortLegOi: number | null;
}

interface LiveBiasSnapshot {
  source: "kite" | "yahoo";
  fetchedAt: string;
  last: number;
  vwap: number;
  ema9: number;
  ema21: number;
  rsi14: number;
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  ageMin: number;
  reason: string;
}

interface StrategyBundle {
  underlying: string;
  spot: number;
  expiry: string;
  daysToExpiry: number;
  ivContext: "LOW" | "HIGH" | "UNKNOWN";
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  structuralBias: "BULLISH" | "BEARISH" | "NEUTRAL";
  liveBias: LiveBiasSnapshot | null;
  blendedBias: "BULLISH" | "BEARISH" | "NEUTRAL";
  biasReason: string;
  ivRegimeReason: string;
  marketStatus: "open" | "pre_open" | "closed";
  strategies: StrategySnapshot[];
  unavailable: { kind: StrategyKind; reason: string }[];
  generatedAt: string;
  analytics?: {
    pcrOi: number; maxPain: number; atmIv: number | null; ivPercentile: number | null; ivRank: number | null;
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
                  className="w-full text-left flex items-center justify-between gap-3 px-3 py-2 hover-row border-b border-border/50 last:border-0"
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

          <StrategyAssumptionsCard />

          {recommended.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-mono uppercase tracking-wider text-amber-300">
                <Sparkles className="w-4 h-4" />
                Matching Current Regime ({recommended.length})
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

/**
 * Per-page disclosure of every assumption baked into the payoff numbers.
 * Surfaced once at the top of the strategy list (not per card) so the
 * caveat reads like a methodology note rather than a scary warning. Audit
 * AUD-009: real broker fills will diverge from these numbers because of
 * slippage, taxes and intraday IV moves — be explicit, not legalistic.
 */
function StrategyAssumptionsCard() {
  return (
    <Card className="border-amber-500/25 bg-amber-500/[0.03]">
      <CardContent className="p-3 text-[11px] leading-relaxed text-muted-foreground space-y-1">
        <div className="flex items-center gap-1.5 text-amber-400 font-mono uppercase tracking-wider text-[10px] font-semibold mb-1">
          <Sparkles className="w-3 h-3" />
          Strategy assumptions &amp; what these payoffs do (and don't) include
        </div>
        <ul className="grid sm:grid-cols-2 gap-x-4 gap-y-0.5 list-disc pl-4">
          <li><strong className="text-foreground/80">Fill price:</strong> mid of latest quoted bid/ask. Real fills will skew toward the side you're crossing.</li>
          <li><strong className="text-foreground/80">Slippage:</strong> not modelled. Wider spreads on far-OTM legs can erode 5-15 % of net credit.</li>
          <li><strong className="text-foreground/80">Brokerage / STT / GST:</strong> not deducted. Multi-leg trades incur 4 charges per leg, both ways.</li>
          <li><strong className="text-foreground/80">IV model:</strong> Black-Scholes-Merton with the chain's quoted IVs. Held-to-expiry payoffs assume IV → 0 at expiry.</li>
          <li><strong className="text-foreground/80">Payoff curves:</strong> are <em>expiry</em> diagrams. Mark-to-market intraday differs because time-value &amp; vega are still in play.</li>
          <li><strong className="text-foreground/80">Probability of profit:</strong> derived from the option-implied terminal distribution, not a directional forecast.</li>
        </ul>
        <p className="pt-1 text-[10.5px] text-muted-foreground/80 italic">
          Educational only — not a recommendation. Always confirm strikes, premiums and margin requirements on your broker terminal before placing an order.
        </p>
      </CardContent>
    </Card>
  );
}

function MarketStatusBanner({ bundle }: { bundle: StrategyBundle }) {
  const status = bundle.marketStatus;
  // Banner colour reflects whether the data is live-tradeable or historical.
  const cls =
    status === "open"     ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-200"
    : status === "pre_open" ? "bg-amber-500/10 border-amber-500/40 text-amber-200"
    :                         "bg-slate-500/10 border-slate-500/40 text-slate-300";
  const label =
    status === "open"     ? "MARKET OPEN"
    : status === "pre_open" ? "PRE-OPEN SESSION"
    :                         "MARKET CLOSED";
  const message =
    status === "open"
      ? "Live data, recommendations actionable now."
      : status === "pre_open"
      ? "Pre-open auction in progress — entries will execute at the 09:15 IST opening print."
      : "Recommendations reflect last available data; entry deferred to next session open. Naked-credit unbounded plays are suppressed.";
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-[11px] font-mono ${cls}`}>
      <span className="font-bold uppercase tracking-wider">{label}</span>
      <span className="opacity-90">{message}</span>
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
  const liveBiasColor = (b: "BULLISH" | "BEARISH" | "NEUTRAL") =>
    b === "BULLISH" ? "text-signal-strong-buy"
    : b === "BEARISH" ? "text-signal-strong-sell"
    : "text-muted-foreground";

  // Steal the expected-move bands from the first strategy that has them — they
  // depend only on (spot, T, ATM IV) so they're identical across strategies.
  // Showing them in the chrome contextualises every R:R / breakeven below.
  const sampleDist = bundle.strategies.find(s => s.dist?.expectedMove1Sigma > 0)?.dist;

  return (
    <div className="space-y-3">
      <MarketStatusBanner bundle={bundle} />
      <Card className="border-border">
        <CardContent className="p-4 space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <h2 className="text-xl font-bold font-mono">{bundle.underlying}</h2>
              <Badge variant="outline" className="font-mono text-[10px]">EXP {bundle.expiry}</Badge>
              <Badge variant="outline" className="font-mono text-[10px]">{bundle.daysToExpiry} days to expiry</Badge>
            </div>
            {bundle.analytics?.interpretation && (
              <p className="text-xs text-muted-foreground font-mono max-w-3xl leading-snug">{bundle.analytics.interpretation}</p>
            )}
          </div>
          <div className="text-right space-y-1">
            <div className="text-2xl font-mono font-bold tabular-nums">{fmt(bundle.spot)}</div>
            <div className="flex items-center justify-end gap-3 text-[11px] font-mono uppercase flex-wrap">
              <span><span className="text-muted-foreground">Blended bias</span> <span className={`font-bold ${biasColor}`}>{bundle.bias}</span></span>
              <span>
                <span className="text-muted-foreground">IV RANK</span>{" "}
                <span className={`font-bold ${ivColor}`}>
                  {bundle.analytics?.ivRank != null ? bundle.analytics.ivRank : bundle.ivContext === "UNKNOWN" ? "n/a" : bundle.ivContext}
                </span>
              </span>
              {bundle.analytics?.ivPercentile != null && (
                <span><span className="text-muted-foreground">IV%ile</span> <span className="font-bold text-foreground">{bundle.analytics.ivPercentile}</span></span>
              )}
              {bundle.analytics?.atmIv != null && (
                <span><span className="text-muted-foreground">ATM IV</span> <span className="font-bold text-foreground">{bundle.analytics.atmIv.toFixed(1)}%</span></span>
              )}
            </div>
          </div>
        </div>

        {/* ── Bias breakdown: structural vs live ──────────────────────── */}
        {/* Surfaces *why* the recommendation engine landed on this bias.
            When live and structural disagree, the user sees both reads
            and knows the engine is treating this as a transition zone. */}
        <div className="border-t border-border/50 pt-2 grid sm:grid-cols-2 gap-2 text-[10px] font-mono">
          <div className="space-y-0.5">
            <div className="uppercase tracking-wider text-muted-foreground">Live price action</div>
            {bundle.liveBias ? (
              <>
                <div>
                  <span className={`font-bold uppercase ${liveBiasColor(bundle.liveBias.bias)}`}>{bundle.liveBias.bias}</span>
                  <span className="text-muted-foreground"> · {bundle.liveBias.source.toUpperCase()} · {bundle.liveBias.ageMin}m old</span>
                </div>
                <div className="text-muted-foreground">{bundle.liveBias.reason}</div>
              </>
            ) : (
              <div className="text-muted-foreground">Intraday data unavailable — using positioning only.</div>
            )}
          </div>
          <div className="space-y-0.5">
            <div className="uppercase tracking-wider text-muted-foreground">Option positioning</div>
            <div>
              <span className={`font-bold uppercase ${liveBiasColor(bundle.structuralBias)}`}>{bundle.structuralBias}</span>
              <span className="text-muted-foreground"> · PCR + max-pain</span>
            </div>
            <div className="text-muted-foreground">{bundle.biasReason}</div>
          </div>
        </div>

        {/* IV regime explanation — the user sees exactly why HIGH/LOW/UNKNOWN. */}
        <div className="text-[10px] font-mono text-muted-foreground border-t border-border/50 pt-2">
          <span className="uppercase tracking-wider">IV regime</span> · {bundle.ivRegimeReason}
        </div>
        {sampleDist && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-mono uppercase border-t border-border/50 pt-2">
            <span className="text-muted-foreground">Implied move at expiry</span>
            <span><span className="text-muted-foreground">±1σ</span>{" "}
              <span className="font-bold text-foreground">
                {fmt(bundle.spot - sampleDist.expectedMove1Sigma, 0)} – {fmt(bundle.spot + sampleDist.expectedMove1Sigma, 0)}
              </span>
              <span className="text-muted-foreground"> · ±{fmt(sampleDist.expectedMove1Sigma, 0)} pts (~68%)</span>
            </span>
            <span><span className="text-muted-foreground">±2σ</span>{" "}
              <span className="font-bold text-foreground">
                {fmt(bundle.spot - sampleDist.expectedMove2Sigma, 0)} – {fmt(bundle.spot + sampleDist.expectedMove2Sigma, 0)}
              </span>
              <span className="text-muted-foreground"> · ±{fmt(sampleDist.expectedMove2Sigma, 0)} pts (~95%)</span>
            </span>
          </div>
        )}
      </CardContent>
    </Card>
    </div>
  );
}

function StrategyCard({
  s, spot, expanded, onToggle, highlight,
}: { s: StrategySnapshot; spot: number; expanded: boolean; onToggle: () => void; highlight?: boolean }) {
  const isCredit = s.netDebit < 0;
  // Per-lot magnitude — debits and credits are BOTH positive numbers when
  // shown in the card. Old behaviour rendered debits as "-₹6,866" with a
  // minus sign, which made it look like a loss instead of a cost. The
  // label ("Net Cost" / "Net Credit") + colour already encode the
  // direction of the cashflow.
  const cashflowMagnitude = Math.abs(s.netDebit * s.lotSize);

  // Headline Max Profit/Loss = realistic value within the ±2σ expected-move
  // window by expiry. For a Long Put on NIFTY this gives a tradeable ~₹10K
  // figure instead of the chart-range ₹135K (arbitrary visualization edge)
  // or the theoretical ₹18L+ (at S=0, economically unreachable). For bounded
  // strategies (verticals, condors) the 2σ window envelops every kink so
  // the realistic value equals the theoretical max — both correct.
  // We surface the theoretical absolute extreme as a sub-line ONLY when it
  // sits within ~10× of the realistic value; beyond that it's so far from
  // anything tradeable that quoting it confuses more than it informs.
  const headlineMaxProfit: number | null =
    s.perLot.maxProfit == null ? null : s.perLot.displayMaxProfit;
  const headlineMaxLoss: number | null =
    s.perLot.maxLoss == null ? null : s.perLot.displayMaxLoss;
  const profitDiverges = (theo: number | null, disp: number) =>
    theo != null
    && Math.abs(theo - disp) > Math.max(1, Math.abs(disp) * 0.05)
    && Math.abs(theo) <= Math.max(Math.abs(disp) * 10, 1);
  const showTheoreticalProfit = profitDiverges(s.perLot.maxProfit, s.perLot.displayMaxProfit);
  const showTheoreticalLoss   = profitDiverges(s.perLot.maxLoss,   s.perLot.displayMaxLoss);

  // R:R reform — the old "headline R:R" used chart-range max profit / max loss.
  // Those are arbitrary (chart range is ±10% of spot, picked for readability),
  // so the resulting "1 : 21.55" was a UI artefact, not a tradeable number.
  // Replace it with **Probabilistic R:R = E[win] / E[loss]** — a real
  // statistical quantity defined even when payoff is unbounded. Theoretical
  // R:R (cap-to-cap) and chart-range R:R are still surfaced as supporting
  // context but no longer headline.
  const probRr = s.dist?.probabilisticRr ?? null;
  const ev = s.dist?.expectedValue ?? 0;

  // Compact strike summary so the user sees what's actually being traded
  // without expanding. Format: "−24,300P / +24,200P / −24,800C / +24,900C"
  // (sign = action, letter = side). Skips the synthetic stock leg used for
  // Covered Call (strike=0).
  const strikeSummary = s.legs
    .filter(l => l.strike > 0)
    .map(l => `${l.action === "BUY" ? "+" : "−"}${fmt(l.strike, 0)}${l.optionType === "CE" ? "C" : "P"}`)
    .join(" / ");

  // Execution-quality badge styling. TIGHT = green (every leg has tight
  // bid/ask), WIDE = amber (workable but expect slip), POOR = red (one or
  // more legs have no real quote OR spread > 15% — sized down or skipped).
  const QUALITY_BADGE = {
    TIGHT: { cls: "bg-signal-strong-buy/15 text-signal-strong-buy border-signal-strong-buy/30",
             label: "Tight quotes" },
    WIDE:  { cls: "bg-amber-500/10 text-amber-300 border-amber-500/30",
             label: "Wide spread" },
    POOR:  { cls: "bg-signal-strong-sell/15 text-signal-strong-sell border-signal-strong-sell/30",
             label: "Poor liquidity" },
  } as const;
  const qb = QUALITY_BADGE[s.legQuality];

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
              <Badge variant="outline" className={`font-mono text-[9px] uppercase ${qb.cls}`} title={qb.label}>
                {qb.label}
              </Badge>
              {s.avgLegIv > 0 && (
                <Badge variant="outline" className="font-mono text-[9px] uppercase bg-card text-muted-foreground border-border">
                  IV {(s.avgLegIv * 100).toFixed(1)}%
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground leading-snug">{s.outlook}</p>
            {strikeSummary && (
              <p className="text-[11px] font-mono text-foreground/90 truncate" title={strikeSummary}>
                <span className="text-muted-foreground uppercase mr-1">Legs:</span>{strikeSummary}
              </p>
            )}
            {s.rationale && (
              <p className="text-xs font-mono text-amber-300/90 leading-snug">↳ {s.rationale}</p>
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
            label={isCredit ? "Net Credit" : "Net Cost"}
            value={`₹${fmt(cashflowMagnitude, 0)}`}
            sub="per lot"
            tone={isCredit ? "buy" : "sell"}
          />
          <Stat
            label="Max Profit"
            value={headlineMaxProfit == null ? "Unbounded" : fmtRupees(headlineMaxProfit)}
            sub={showTheoreticalProfit && s.perLot.maxProfit != null
              ? `theoretical ${fmtRupees(s.perLot.maxProfit)}`
              : "in chart range"}
            tone={headlineMaxProfit == null || headlineMaxProfit > 0 ? "buy" : undefined}
          />
          <Stat
            label="Max Loss"
            value={headlineMaxLoss == null ? "Unbounded" : fmtRupees(headlineMaxLoss)}
            sub={showTheoreticalLoss && s.perLot.maxLoss != null
              ? `theoretical ${fmtRupees(s.perLot.maxLoss)}`
              : "in chart range"}
            tone="sell"
          />
          <Stat label="POP" value={fmtPctRaw(s.pop)} sub="lognormal model" />
        </div>

        {/* Payoff chart */}
        <PayoffChart s={s} spot={spot} />

        {/* Breakevens · R:R · Lot. R:R now headlines the **probabilistic**
            ratio (E[win]/E[loss]) — that's a real statistical quantity even
            when payoff is unbounded. The old chart-range R:R is shown as
            secondary text only when it differs materially. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono">
          <span><span className="text-muted-foreground uppercase">Breakeven{s.breakevens.length === 1 ? "" : "s"}:</span> {s.breakevens.length ? s.breakevens.map(b => fmt(b)).join(" / ") : "—"}</span>
          <span>
            <span className="text-muted-foreground uppercase">R:R (prob)</span>{" "}
            {probRr == null ? "—" : `1 : ${probRr.toFixed(2)}`}
            {s.displayRrRatio != null && (
              <span className="text-muted-foreground/70"> · realistic 1 : {s.displayRrRatio.toFixed(2)}</span>
            )}
          </span>
          <span><span className="text-muted-foreground uppercase">Lot</span> {s.lotSize}</span>
        </div>

        {/* Distributional metrics — the four numbers that actually drive a
            sizing decision: expected value, capital required, expected
            return on that capital, and net pricing edge vs the ATM-IV
            curve (positive = favourable skew capture). */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border rounded overflow-hidden border border-border">
          <Stat
            label="Expected Value"
            value={s.dist ? fmtRupees(s.dist.expectedValue) : "—"}
            sub="per lot, lognormal"
            tone={ev > 0 ? "buy" : ev < 0 ? "sell" : undefined}
          />
          <Stat
            label="Capital Req."
            value={s.marginRequired > 0 ? `₹${fmt(s.marginRequired, 0)}` : "—"}
            sub="margin proxy"
          />
          <Stat
            label="Return on Cap."
            value={s.returnOnCapital == null ? "—" : `${(s.returnOnCapital * 100).toFixed(2)}%`}
            sub="EV ÷ capital"
            tone={s.returnOnCapital != null && s.returnOnCapital > 0 ? "buy" : s.returnOnCapital != null && s.returnOnCapital < 0 ? "sell" : undefined}
          />
          <Stat
            label="Skew Edge"
            value={fmtRupees(s.netEdge)}
            sub="vs ATM-IV fair"
            tone={s.netEdge > 0 ? "buy" : s.netEdge < 0 ? "sell" : undefined}
          />
        </div>

        {/* Net Greeks — gamma scaled ×1000 so "0.00146" renders as a clean
            "+1.46" instead of leading-zero confusion in mono fonts. */}
        <div className="grid grid-cols-4 gap-px bg-border rounded overflow-hidden border border-border">
          <Stat label="Δ Delta" value={fmtSigned(s.netGreeks.delta)} small />
          <Stat label="Γ × 10³" value={fmtSigned(s.netGreeks.gamma * 1000)} small />
          <Stat label="ν Vega"   value={fmtSigned(s.netGreeks.vega)} small />
          <Stat label="Θ Theta" value={fmtSigned(s.netGreeks.theta)} tone={s.netGreeks.theta > 0 ? "buy" : "sell"} small />
        </div>

        {expanded && (
          <>
            <div className="text-[11px] text-muted-foreground italic">{s.description}</div>
            {s.dist && (
              <div className="text-[10px] font-mono text-muted-foreground border-l-2 border-border/60 pl-2 space-y-0.5">
                <div>
                  <span className="uppercase">Avg win</span>{" "}
                  <span className="text-signal-strong-buy font-bold">{fmtRupees(s.dist.avgWin)}</span>
                  {" · "}
                  <span className="uppercase">Avg loss</span>{" "}
                  <span className="text-signal-strong-sell font-bold">{fmtRupees(s.dist.avgLoss)}</span>
                  {" · "}
                  <span className="uppercase">σ of P/L</span>{" "}
                  <span className="text-foreground font-bold">{fmtRupees(s.dist.stdDev)}</span>
                </div>
                <div className="text-muted-foreground/80">
                  Probabilistic R:R = E[win] ÷ E[loss]. Capital is a SPAN+exposure proxy,
                  not your broker's actual block. ROC and Skew Edge are computed on the same lognormal grid.
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] font-mono">
                <thead className="text-muted-foreground uppercase text-[10px]">
                  <tr className="border-b border-border">
                    <th className="text-left py-1">Action</th>
                    <th className="text-left py-1">Type</th>
                    <th className="text-right py-1">Strike</th>
                    <th className="text-right py-1">Premium</th>
                    <th className="text-right py-1" title="(ask−bid)/mid — wider = harder to fill at the listed price.">Spr%</th>
                    <th className="text-right py-1">OI</th>
                    <th className="text-right py-1">Theo</th>
                    <th className="text-right py-1">Edge</th>
                    <th className="text-right py-1">IV</th>
                    <th className="text-right py-1">Δ</th>
                    <th className="text-right py-1">Θ/day</th>
                  </tr>
                </thead>
                <tbody>
                  {s.legs.map((l, i) => {
                    // Per-leg edge is keyed by (strike, type, action). Skip
                    // the synthetic stock leg (strike=0) which has no edge.
                    const edge = l.strike === 0 ? null : s.legEdges.find(
                      e => e.strike === l.strike && e.type === l.optionType && e.action === l.action,
                    );
                    return (
                      <tr key={i} className="border-b border-border/30">
                        <td className={`py-1 font-bold ${l.action === "BUY" ? "text-signal-strong-buy" : "text-signal-strong-sell"}`}>{l.action}</td>
                        <td className="py-1">{l.optionType === "CE" ? "CALL" : "PUT"}</td>
                        <td className="text-right py-1 tabular-nums">{l.strike === 0 ? "Stock" : fmt(l.strike, 0)}</td>
                        <td className="text-right py-1 tabular-nums">₹{fmt(l.premium)}</td>
                        <td
                          className={`text-right py-1 tabular-nums ${
                            l.spreadPct == null ? "text-muted-foreground/60"
                            : l.spreadPct > 0.15 ? "text-signal-strong-sell"
                            : l.spreadPct > 0.04 ? "text-amber-300"
                            : "text-muted-foreground"
                          }`}
                          title={l.bid != null && l.ask != null ? `bid ₹${fmt(l.bid)} / ask ₹${fmt(l.ask)}` : "no two-sided quote — fell back to LTP"}
                        >
                          {l.spreadPct == null ? (l.quoted ? "—" : "LTP") : `${(l.spreadPct * 100).toFixed(1)}%`}
                        </td>
                        <td className="text-right py-1 tabular-nums text-muted-foreground">{l.oi == null ? "—" : l.oi.toLocaleString("en-IN")}</td>
                        <td className="text-right py-1 tabular-nums text-muted-foreground">{edge ? `₹${fmt(edge.theoretical)}` : "—"}</td>
                        <td className={`text-right py-1 tabular-nums font-bold ${edge ? (edge.edge > 0 ? "text-signal-strong-buy" : edge.edge < 0 ? "text-signal-strong-sell" : "") : ""}`}>
                          {edge ? `${edge.edge >= 0 ? "+" : ""}₹${fmt(edge.edge)}` : "—"}
                        </td>
                        <td className="text-right py-1 tabular-nums">{(l.iv * 100).toFixed(1)}%</td>
                        <td className="text-right py-1 tabular-nums">{l.delta.toFixed(3)}</td>
                        <td className="text-right py-1 tabular-nums">{l.theta.toFixed(2)}</td>
                      </tr>
                    );
                  })}
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
      const denom = b.spot - a.spot;
      const t = denom === 0 ? 0 : (spot - a.spot) / denom;
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
          <Area type="linear" dataKey="pnl" stroke="hsl(var(--signal-strong-buy))" strokeWidth={1.5}
                fill="url(#pnlGradient)" baseValue={0} dot={false} isAnimationActive={false} />
          <defs>
            <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="hsl(var(--signal-strong-buy))"  stopOpacity={0.4} />
              <stop offset="50%" stopColor="hsl(var(--signal-strong-buy))"  stopOpacity={0.0} />
              <stop offset="50%" stopColor="hsl(var(--signal-strong-sell))" stopOpacity={0.0} />
              <stop offset="100%" stopColor="hsl(var(--signal-strong-sell))" stopOpacity={0.4} />
            </linearGradient>
          </defs>
          <Line type="linear" dataKey="pnl" stroke="hsl(var(--signal-strong-buy))" strokeWidth={1.8} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function Stat({ label, value, tone, small, sub }: { label: string; value: React.ReactNode; tone?: "buy" | "sell"; small?: boolean; sub?: string }) {
  const cls = tone === "buy" ? "text-signal-strong-buy" : tone === "sell" ? "text-signal-strong-sell" : "text-foreground";
  return (
    <div className="bg-card p-2">
      <div className={`${small ? "text-[9px]" : "text-[10px]"} font-mono uppercase tracking-wider text-muted-foreground`}>{label}</div>
      <div className={`font-mono ${small ? "text-[12px]" : "text-sm"} font-bold tabular-nums mt-0.5 ${cls}`}>{value}</div>
      {sub && <div className="text-[9px] font-mono text-muted-foreground/70 mt-0.5 truncate" title={sub}>{sub}</div>}
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
