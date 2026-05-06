/**
 * Owner-only paper trading dashboard.
 *
 * F&O segment auto-trades qualifying option signals against a daily
 * bankroll. Equity segment auto-trades STRONG_BUY signals from the
 * fullNseScanner (filtered to F&O 200) on a multi-day swing book —
 * see paperTradingEq.ts on the server. Both segments expose the same
 * three sub-views: account state, open positions with live MTM, and
 * the day's closed trades.
 */
import { useCallback, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const body = await r.json();
      if (body?.error) msg = String(body.error);
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return (await r.json()) as T;
}

const QK_ACCOUNT = ["paper", "account", "FNO"] as const;
const QK_POSITIONS = ["paper", "positions", "FNO"] as const;
const QK_TRADES = ["paper", "trades", "FNO"] as const;

const QK_ACCOUNT_EQ = ["paper", "account", "EQUITY"] as const;
const QK_POSITIONS_EQ = ["paper", "positions", "EQUITY"] as const;
const QK_TRADES_EQ = ["paper", "trades", "EQUITY"] as const;

type Segment = "FNO" | "EQUITY";

interface PaperAccount {
  segment: Segment;
  seedCapital: number;
  balance: number;
  dayRealizedPnl: number;
  dayOpenCount: number;
  dayTradeCount: number;
  lastResetDate: string;
  dailyTradeCap: number;
  maxLossPctPerTrade: number;
}

interface OpenPosition {
  id: string;
  signalDate: string;
  indexSymbol: string;
  indexName: string;
  setupKey: string;
  direction: "BULLISH" | "BEARISH";
  optionType: "CALL" | "PUT";
  strike: number;
  lots: number;
  lotSize: number;
  entryPremium: number;
  stopPremium: number;
  target1Premium: number;
  target2Premium: number;
  capitalDeployed: number;
  lastPremium: number;
  unrealizedPnl: number;
  maxRunup?: number;
  maxDrawdown?: number;
  openedAt: string;
  lastEvaluatedAt: string;
}

interface ClosedTrade {
  id: string;
  signalDate: string;
  indexSymbol: string;
  indexName: string;
  setupKey: string;
  direction: "BULLISH" | "BEARISH";
  optionType: "CALL" | "PUT";
  strike: number;
  lots: number;
  lotSize: number;
  entryPremium: number;
  exitPremium: number;
  capitalDeployed: number;
  realizedPnl: number;
  exitReason: "TARGET1_HIT" | "TARGET2_HIT" | "STOPPED" | "EXPIRED" | "MANUAL_OVERRIDE";
  openedAt: string;
  exitedAt: string;
  journal?: string | null;
  tags?: string[];
}

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
const inrDec = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
const pct = (n: number) =>
  `${(n * 100).toFixed(1)}%`;
const fmtTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleTimeString("en-IN", {
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
  } catch { return iso; }
};

const REASON_TONE: Record<ClosedTrade["exitReason"], string> = {
  TARGET2_HIT: "bg-emerald-500/15 text-emerald-200 border-emerald-500/30",
  TARGET1_HIT: "bg-emerald-500/10 text-emerald-200 border-emerald-500/25",
  STOPPED:     "bg-rose-500/15 text-rose-200 border-rose-500/30",
  EXPIRED:     "bg-amber-500/10 text-amber-200 border-amber-500/30",
  MANUAL_OVERRIDE: "bg-slate-500/15 text-slate-200 border-slate-500/30",
};

type EqExitReason =
  | "TARGET2_HIT"
  | "STOPPED"
  | "TRAIL_STOP_HIT"
  | "TIME_STOP"
  | "SIGNAL_FLIP"
  | "MANUAL_OVERRIDE";

interface OpenEqPosition {
  id: string;
  symbol: string;
  name: string;
  exchange: string;
  signalDate: string;
  signalTriggeredAt: string;
  qty: number;
  entryPrice: number;
  stopPrice: number;
  target1Price: number;
  target2Price: number;
  trailedToT1: boolean;
  capitalDeployed: number;
  lastPrice: number;
  prevClose?: number;
  unrealizedPnl: number;
  unrealizedPnlPct?: number;
  dayPnl?: number;
  dayPnlPct?: number;
  maxRunup?: number;
  maxDrawdown?: number;
  openedAt: string;
  lastEvaluatedAt: string;
}

interface ClosedEqTrade {
  id: string;
  symbol: string;
  name: string;
  exchange: string;
  signalDate: string;
  qty: number;
  entryPrice: number;
  exitPrice: number;
  capitalDeployed: number;
  realizedPnl: number;
  exitReason: EqExitReason;
  openedAt: string;
  exitedAt: string;
  journal?: string | null;
  tags?: string[];
}

const EQ_REASON_TONE: Record<EqExitReason, string> = {
  TARGET2_HIT:     "bg-emerald-500/15 text-emerald-200 border-emerald-500/30",
  STOPPED:         "bg-rose-500/15 text-rose-200 border-rose-500/30",
  TRAIL_STOP_HIT:  "bg-amber-500/15 text-amber-200 border-amber-500/30",
  TIME_STOP:       "bg-sky-500/15 text-sky-200 border-sky-500/30",
  SIGNAL_FLIP:     "bg-fuchsia-500/15 text-fuchsia-200 border-fuchsia-500/30",
  MANUAL_OVERRIDE: "bg-slate-500/15 text-slate-200 border-slate-500/30",
};

const fmtDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit", month: "short",
    });
  } catch { return iso; }
};

export default function PaperTrading() {
  const [segment, setSegment] = useState<Segment>("FNO");
  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Paper Trading</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Owner-only virtual broker. Auto-trades qualifying signals against a
          fresh daily bankroll so you can audit the strategy without real money.
        </p>
      </div>
      <Tabs value={segment} onValueChange={v => setSegment(v as Segment)}>
        <TabsList className="mb-4">
          <TabsTrigger value="FNO">F&amp;O</TabsTrigger>
          <TabsTrigger value="EQUITY">Equity</TabsTrigger>
        </TabsList>
        <TabsContent value="FNO" className="space-y-6">
          <FOSegment />
        </TabsContent>
        <TabsContent value="EQUITY" className="space-y-6">
          <EquitySegment />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EquitySegment() {
  const account = useQuery({
    queryKey: QK_ACCOUNT_EQ,
    queryFn: () => api<PaperAccount>(`/paper/account?segment=EQUITY`),
    refetchInterval: 15_000,
  });
  const positions = useQuery({
    queryKey: QK_POSITIONS_EQ,
    queryFn: () => api<{ positions: OpenEqPosition[]; generatedAt: string }>(`/paper/positions/eq`),
    refetchInterval: 15_000,
  });
  const trades = useQuery({
    queryKey: QK_TRADES_EQ,
    queryFn: () => api<{ date: string; trades: ClosedEqTrade[]; generatedAt: string }>(`/paper/trades/eq`),
    refetchInterval: 30_000,
  });
  return (
    <div className="space-y-6">
      <EqAccountCard
        data={account.data}
        openPositions={positions.data?.positions ?? []}
        loading={account.isLoading}
        error={account.error instanceof Error ? account.error.message : null}
      />
      <EqPositionsCard
        positions={positions.data?.positions ?? []}
        loading={positions.isLoading}
        error={positions.error instanceof Error ? positions.error.message : null}
      />
      <EqTradesCard
        trades={trades.data?.trades ?? []}
        loading={trades.isLoading}
        error={trades.error instanceof Error ? trades.error.message : null}
      />
    </div>
  );
}

function EqAccountCard({ data, openPositions, loading, error }: {
  data?: PaperAccount;
  openPositions: OpenEqPosition[];
  loading: boolean;
  error: string | null;
}) {
  if (error) {
    return (
      <Card>
        <CardHeader><CardTitle>Equity Account</CardTitle></CardHeader>
        <CardContent><ErrorBlock message={error} /></CardContent>
      </Card>
    );
  }
  if (loading || !data) {
    return (
      <Card>
        <CardHeader><CardTitle>Equity Account</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-24 w-full" /></CardContent>
      </Card>
    );
  }
  // Account value = cash balance + book value of OPEN positions
  // (entry × qty). Cash balance already reflects every debit/credit
  // for closed trades; OPEN positions are still tying up capital.
  const bookValue = openPositions.reduce((s, p) => s + p.capitalDeployed, 0);
  const accountValue = data.balance + bookValue;
  const lifetimePnl = accountValue - data.seedCapital;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Equity Account</CardTitle>
        <CardDescription>
          Multi-day swing book. Capital stays locked across days — only
          closed trades release cash. Day counters reset each IST day.
          Last day reset: {data.lastResetDate}.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Stat label="Cash balance" value={inr(data.balance)} />
        <Stat label="Capital in open positions" value={inr(bookValue)} />
        <Stat label="Account value" value={inr(accountValue)} />
        <Stat
          label="Lifetime net P&L"
          value={inrDec(lifetimePnl)}
          tone={lifetimePnl > 0 ? "pos" : lifetimePnl < 0 ? "neg" : undefined}
        />
        <Stat
          label="Realized P&L (today)"
          value={inrDec(data.dayRealizedPnl)}
          tone={data.dayRealizedPnl > 0 ? "pos" : data.dayRealizedPnl < 0 ? "neg" : undefined}
        />
        <Stat
          label="Open positions"
          value={`${openPositions.length}`}
        />
        <Stat
          label="New entries today"
          value={`${data.dayTradeCount} / ${data.dailyTradeCap}`}
          tone={data.dayTradeCount >= data.dailyTradeCap ? "neg" : undefined}
        />
        <Stat label="Seed capital" value={inr(data.seedCapital)} />
        <HeatIndicator deployed={bookValue} total={accountValue > 0 ? accountValue : data.seedCapital} />
      </CardContent>
    </Card>
  );
}

function EqPositionsCard({ positions, loading, error }: {
  positions: OpenEqPosition[];
  loading: boolean;
  error: string | null;
}) {
  if (error) {
    return (
      <Card>
        <CardHeader><CardTitle>Portfolio</CardTitle></CardHeader>
        <CardContent><ErrorBlock message={error} /></CardContent>
      </Card>
    );
  }
  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle>Portfolio</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-32 w-full" /></CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Portfolio</CardTitle>
        <CardDescription>
          Live mark-to-market using the most recent LTP from the scanner
          cache. Stop trails up to T1 once price prints T1. Use Close to
          force-exit at the last observed LTP.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {positions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No open equity positions right now. Auto-opens on the next
            qualifying STRONG_BUY signal in the F&amp;O 200 universe.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <tr>
                  <th className="py-2 pr-3">Symbol</th>
                  <th className="py-2 pr-3 text-right">Qty</th>
                  <th className="py-2 pr-3 text-right">LTP</th>
                  <th className="py-2 pr-3 text-right">Entry</th>
                  <th className="py-2 pr-3 text-right">SL</th>
                  <th className="py-2 pr-3 text-right">T1</th>
                  <th className="py-2 pr-3 text-right">T2</th>
                  <th className="py-2 pr-3 text-right">Capital</th>
                  <th className="py-2 pr-3 text-right">U.P&amp;L</th>
                  <th className="py-2 pr-3 text-right">U.P&amp;L %</th>
                  <th className="py-2 pr-3 text-right">Day P&amp;L</th>
                  <th className="py-2 pr-3 text-right">Day %</th>
                  <th className="py-2 pr-3">Opened</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {positions.map(p => <EqPositionRow key={p.id} p={p} />)}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EqPositionRow({ p }: { p: OpenEqPosition }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const closeMut = useMutation({
    mutationFn: () =>
      api<ClosedEqTrade>(`/paper/positions/eq/${encodeURIComponent(p.id)}/close`, {
        method: "POST",
      }),
    onSuccess: () => {
      toast({ title: "Position closed", description: `${p.symbol} × ${p.qty}` });
      void qc.invalidateQueries({ queryKey: QK_POSITIONS_EQ });
      void qc.invalidateQueries({ queryKey: QK_ACCOUNT_EQ });
      void qc.invalidateQueries({ queryKey: QK_TRADES_EQ });
    },
    onError: (err: Error) => {
      toast({ title: "Close failed", description: err.message, variant: "destructive" });
    },
  });
  const upnlTone =
    p.unrealizedPnl > 0 ? "text-emerald-300" :
    p.unrealizedPnl < 0 ? "text-rose-300" : "text-foreground";
  const upnlPct = p.unrealizedPnlPct ?? (p.capitalDeployed > 0 ? (p.unrealizedPnl / p.capitalDeployed) * 100 : 0);
  const dayPnl = p.dayPnl ?? 0;
  const dayPnlPct = p.dayPnlPct ?? 0;
  const dayTone =
    dayPnl > 0 ? "text-emerald-300" :
    dayPnl < 0 ? "text-rose-300" : "text-foreground";
  return (
    <tr className="border-b border-border/40">
      <td className="py-2 pr-3">
        <div className="font-medium">{p.symbol}</div>
        <div className="text-[11px] text-muted-foreground">
          {p.name}
          {p.trailedToT1 && (
            <span className="ml-2 text-amber-300">stop trailed to T1</span>
          )}
        </div>
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">{p.qty}</td>
      <td className="py-2 pr-3 text-right tabular-nums font-medium">{p.lastPrice.toFixed(2)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{p.entryPrice.toFixed(2)}</td>
      <td className="py-2 pr-3 text-right tabular-nums text-rose-300">{p.stopPrice.toFixed(2)}</td>
      <td className="py-2 pr-3 text-right tabular-nums text-emerald-300">{p.target1Price.toFixed(2)}</td>
      <td className="py-2 pr-3 text-right tabular-nums text-emerald-300">{p.target2Price.toFixed(2)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{inr(p.capitalDeployed)}</td>
      <td className={`py-2 pr-3 text-right tabular-nums font-medium ${upnlTone}`}>
        {inrDec(p.unrealizedPnl)}
      </td>
      <td className={`py-2 pr-3 text-right tabular-nums ${upnlTone}`}>
        {upnlPct >= 0 ? "+" : ""}{upnlPct.toFixed(2)}%
      </td>
      <td className={`py-2 pr-3 text-right tabular-nums font-medium ${dayTone}`}>
        {inrDec(dayPnl)}
      </td>
      <td className={`py-2 pr-3 text-right tabular-nums ${dayTone}`}>
        {dayPnlPct >= 0 ? "+" : ""}{dayPnlPct.toFixed(2)}%
      </td>
      <td className="py-2 pr-3 text-[12px] text-muted-foreground">{fmtDate(p.openedAt)}</td>
      <td className="py-2 pr-3 text-right">
        <Button
          size="sm"
          variant="outline"
          disabled={closeMut.isPending}
          onClick={() => closeMut.mutate()}
        >
          {closeMut.isPending ? "Closing…" : "Close"}
        </Button>
      </td>
    </tr>
  );
}

function EqTradesCard({ trades, loading, error }: {
  trades: ClosedEqTrade[];
  loading: boolean;
  error: string | null;
}) {
  const totals = useMemo(() => {
    let realized = 0, wins = 0;
    for (const t of trades) {
      realized += t.realizedPnl;
      if (t.realizedPnl > 0) wins++;
    }
    return {
      count: trades.length,
      realized,
      wins,
      winPct: trades.length === 0 ? 0 : wins / trades.length,
    };
  }, [trades]);
  if (error) {
    return (
      <Card>
        <CardHeader><CardTitle>Today's closed trades</CardTitle></CardHeader>
        <CardContent><ErrorBlock message={error} /></CardContent>
      </Card>
    );
  }
  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle>Today's closed trades</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-32 w-full" /></CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Today's closed trades</CardTitle>
        <CardDescription>
          {totals.count === 0
            ? "Nothing closed yet today."
            : `${totals.count} closed · realized ${inrDec(totals.realized)} · win-rate ${pct(totals.winPct)}`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {trades.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No closed equity paper trades today yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <tr>
                  <th className="py-2 pr-3">Symbol</th>
                  <th className="py-2 pr-3 text-right">Qty</th>
                  <th className="py-2 pr-3 text-right">Entry</th>
                  <th className="py-2 pr-3 text-right">Exit</th>
                  <th className="py-2 pr-3 text-right">Capital</th>
                  <th className="py-2 pr-3 text-right">P&amp;L</th>
                  <th className="py-2 pr-3">Reason</th>
                  <th className="py-2 pr-3">Opened</th>
                  <th className="py-2 pr-3">Closed</th>
                  <th className="py-2 pr-3">Journal</th>
                </tr>
              </thead>
              <tbody>
                {trades.map(t => {
                  const tone =
                    t.realizedPnl > 0 ? "text-emerald-300" :
                    t.realizedPnl < 0 ? "text-rose-300" : "";
                  return (
                    <tr key={t.id} className="border-b border-border/40">
                      <td className="py-2 pr-3">
                        <div className="font-medium">{t.symbol}</div>
                        <div className="text-[11px] text-muted-foreground">{t.name}</div>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{t.qty}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{t.entryPrice.toFixed(2)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{t.exitPrice.toFixed(2)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{inr(t.capitalDeployed)}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums font-medium ${tone}`}>
                        {inrDec(t.realizedPnl)}
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`px-2 py-0.5 rounded border text-[11px] ${EQ_REASON_TONE[t.exitReason]}`}>
                          {t.exitReason}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-[12px] text-muted-foreground">{fmtDate(t.openedAt)}</td>
                      <td className="py-2 pr-3 text-[12px] text-muted-foreground">{fmtTime(t.exitedAt)}</td>
                      <td className="py-2 pr-3">
                        <JournalPanel tradeId={t.id} segment="eq" initial={{ journal: t.journal, tags: t.tags }} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type SkipReason =
  | "MISSED_WINDOW"
  | "DATA_QUALITY_DELAYED"
  | "DATA_QUALITY_STALE"
  | "CONFIDENCE_FLOOR";

interface MissedSignalRow {
  signalDate: string;
  indexSymbol: string;
  indexName: string;
  setupKey: string;
  direction: "BULLISH" | "BEARISH";
  confidence: number;
  tier: "BASELINE" | "STANDARD";
  status: string;
  reason: "TARGET2_HIT" | "TARGET1_HIT" | "STOPPED" | "EXPIRED" | "MANUAL_OVERRIDE" | null;
  skipReason: SkipReason;
  dataQuality: string;
  optionEntry: number | null;
  optionStop: number | null;
  optionTarget1: number | null;
  optionTarget2: number | null;
  observedAt: string;
}

const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  MISSED_WINDOW: "Missed window",
  DATA_QUALITY_DELAYED: "Yahoo-delayed (Kite off)",
  DATA_QUALITY_STALE: "Stale data",
  CONFIDENCE_FLOOR: "Below conf. floor",
};

const SKIP_REASON_TONE: Record<SkipReason, string> = {
  MISSED_WINDOW: "bg-amber-500/15 text-amber-200 border-amber-500/30",
  DATA_QUALITY_DELAYED: "bg-sky-500/15 text-sky-200 border-sky-500/30",
  DATA_QUALITY_STALE: "bg-slate-500/15 text-slate-200 border-slate-500/30",
  CONFIDENCE_FLOOR: "bg-violet-500/15 text-violet-200 border-violet-500/30",
};

interface FoAnalytics {
  totalTrades: number;
  wins: number;
  losses: number;
  scratches: number;
  winRate: number;
  totalRealizedPnl: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  profitFactor: number;
  expectancy: number;
  avgRMultiple: number | null;
  rMultipleSamples: number;
  maxDrawdown: number;
  currentDrawdown: number;
  peakEquity: number;
  exitReasonCounts: Record<string, number>;
  bySetup: Array<{
    setupKey: string;
    trades: number;
    wins: number;
    losses: number;
    winRate: number;
    totalPnl: number;
    avgPnl: number;
    bestTrade: number;
    worstTrade: number;
  }>;
  equityCurve: Array<{
    date: string;
    dailyPnl: number;
    cumulativePnl: number;
    drawdown: number;
  }>;
  generatedAt: string;
}

function FOSegment() {
  const qc = useQueryClient();
  const account = useQuery({
    queryKey: QK_ACCOUNT,
    queryFn: () => api<PaperAccount>(`/paper/account?segment=FNO`),
    refetchInterval: 10_000,
  });
  const positions = useQuery({
    queryKey: QK_POSITIONS,
    queryFn: () => api<{ positions: OpenPosition[]; generatedAt: string }>(`/paper/positions/fo`),
    refetchInterval: 10_000,
  });
  const trades = useQuery({
    queryKey: QK_TRADES,
    queryFn: () => api<{ date: string; trades: ClosedTrade[]; generatedAt: string }>(`/paper/trades/fo`),
    refetchInterval: 30_000,
  });
  const missed = useQuery({
    queryKey: ["paper", "missed", "FNO"] as const,
    queryFn: () => api<{ missed: MissedSignalRow[]; generatedAt: string }>(`/paper/missed/fo`),
    refetchInterval: 30_000,
  });
  const analytics = useQuery({
    queryKey: ["paper", "analytics", "FNO"] as const,
    queryFn: () => api<FoAnalytics>(`/paper/analytics/fo`),
    refetchInterval: 60_000,
  });

  const handleTopupSuccess = useCallback(() => {
    void qc.invalidateQueries({ queryKey: QK_ACCOUNT });
  }, [qc]);

  return (
    <div className="space-y-6">
      <AccountCard
        data={account.data}
        loading={account.isLoading}
        error={account.error instanceof Error ? account.error.message : null}
        onTopupSuccess={handleTopupSuccess}
      />
      <AnalyticsCard
        data={analytics.data}
        loading={analytics.isLoading}
        error={analytics.error instanceof Error ? analytics.error.message : null}
      />
      <PositionsCard
        positions={positions.data?.positions ?? []}
        loading={positions.isLoading}
        error={positions.error instanceof Error ? positions.error.message : null}
      />
      <MissedSignalsCard
        missed={missed.data?.missed ?? []}
        loading={missed.isLoading}
        error={missed.error instanceof Error ? missed.error.message : null}
      />
      <TradesCard
        trades={trades.data?.trades ?? []}
        loading={trades.isLoading}
        error={trades.error instanceof Error ? trades.error.message : null}
      />
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
      <div className="font-semibold mb-1">Failed to load</div>
      <div className="text-rose-100/80">{message}</div>
    </div>
  );
}

function AccountCard({ data, loading, error, onTopupSuccess }: {
  data?: PaperAccount;
  loading: boolean;
  error: string | null;
  onTopupSuccess: () => void;
}) {
  const [topupOpen, setTopupOpen] = useState(false);
  if (error) {
    return (
      <Card>
        <CardHeader><CardTitle>F&amp;O Account</CardTitle></CardHeader>
        <CardContent><ErrorBlock message={error} /></CardContent>
      </Card>
    );
  }
  if (loading || !data) {
    return (
      <Card>
        <CardHeader><CardTitle>F&amp;O Account</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-24 w-full" /></CardContent>
      </Card>
    );
  }
  // Persistent bankroll: cumulative running equity = balance + day P&L
  // (the day's realised P&L hasn't been folded into balance yet for any
  // still-OPEN positions). "Net vs seed" is now the lifetime delta from
  // the original starting bankroll — meaningful again now that the
  // daily auto-refill is gone.
  const netVsSeed = data.balance + data.dayRealizedPnl - data.seedCapital;
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>F&amp;O Account</CardTitle>
          <CardDescription>
            Persistent bankroll — losses and gains carry over across days.
            Day counters last rolled over: {data.lastResetDate}. Use Add capital
            to top up.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setTopupOpen(true)}
          data-testid="button-topup-fno"
        >
          Add capital
        </Button>
      </CardHeader>
      <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Stat label="Cash balance" value={inr(data.balance)} />
        <Stat
          label="Realized P&L (today)"
          value={inrDec(data.dayRealizedPnl)}
          tone={data.dayRealizedPnl > 0 ? "pos" : data.dayRealizedPnl < 0 ? "neg" : undefined}
        />
        <Stat
          label="Open positions"
          value={`${data.dayOpenCount}`}
        />
        <Stat
          label="Trades opened today"
          value={`${data.dayTradeCount} / ${data.dailyTradeCap}`}
          tone={data.dayTradeCount >= data.dailyTradeCap ? "neg" : undefined}
        />
        <Stat
          label="Risk per trade"
          value={pct(data.maxLossPctPerTrade)}
        />
        <Stat
          label="Net vs. seed (lifetime)"
          value={inrDec(netVsSeed)}
          tone={netVsSeed > 0 ? "pos" : netVsSeed < 0 ? "neg" : undefined}
        />
        <Stat label="Seed capital" value={inr(data.seedCapital)} />
      </CardContent>
      <TopupDialog
        open={topupOpen}
        onClose={() => setTopupOpen(false)}
        onSuccess={onTopupSuccess}
        segment="FNO"
        currentBalance={data.balance}
      />
    </Card>
  );
}

function TopupDialog({
  open, onClose, onSuccess, segment, currentBalance,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  segment: Segment;
  currentBalance: number;
}) {
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const mutation = useMutation({
    mutationFn: async (amt: number) => {
      return api<{ segment: string; amount: number; newBalance: number }>(
        `/paper/account/topup`,
        { method: "POST", body: JSON.stringify({ segment, amount: amt }) },
      );
    },
    onSuccess: (result) => {
      toast({
        title: "Capital added",
        description: `+${inr(result.amount)} → new balance ${inr(result.newBalance)}`,
      });
      setAmount("");
      onSuccess();
      onClose();
    },
    onError: (err: unknown) => {
      toast({
        title: "Top-up failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });
  if (!open) return null;
  const parsed = Number(amount);
  const valid = Number.isFinite(parsed) && parsed > 0;
  const presets = segment === "FNO" ? [50_000, 100_000, 200_000, 500_000] : [200_000, 500_000, 1_000_000, 2_000_000];
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-xl"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="Add capital"
      >
        <h2 className="text-lg font-semibold mb-1">Add capital ({segment})</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Current balance: <span className="font-medium text-foreground">{inr(currentBalance)}</span>.
          The amount you enter is added to the running cash balance — seed capital stays unchanged.
        </p>
        <div className="space-y-3">
          <input
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="Amount in ₹"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="input-topup-amount"
            min="1"
            step="1"
          />
          <div className="flex flex-wrap gap-2">
            {presets.map(p => (
              <Button
                key={p}
                variant="secondary"
                size="sm"
                onClick={() => setAmount(String(p))}
                type="button"
              >
                +{inr(p)}
              </Button>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => valid && mutation.mutate(parsed)}
              disabled={!valid || mutation.isPending}
              data-testid="button-topup-confirm"
            >
              {mutation.isPending ? "Adding…" : `Add ${valid ? inr(parsed) : "capital"}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AnalyticsCard({ data, loading, error }: {
  data?: FoAnalytics;
  loading: boolean;
  error: string | null;
}) {
  if (error) {
    return (
      <Card>
        <CardHeader><CardTitle>Strategy analytics</CardTitle></CardHeader>
        <CardContent><ErrorBlock message={error} /></CardContent>
      </Card>
    );
  }
  if (loading || !data) {
    return (
      <Card>
        <CardHeader><CardTitle>Strategy analytics</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-32 w-full" /></CardContent>
      </Card>
    );
  }
  if (data.totalTrades === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Strategy analytics</CardTitle>
          <CardDescription>
            P&L, win-rate, expectancy and drawdown computed from every closed
            paper trade.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground py-6 text-center">
            No closed paper trades yet. Once trades start closing this section
            will fill with cumulative P&L, win-rate, expectancy and an equity
            curve.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Strategy analytics</CardTitle>
        <CardDescription>
          Computed from {data.totalTrades} closed trade{data.totalTrades === 1 ? "" : "s"}.
          Updated {fmtTime(data.generatedAt)}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <Stat
            label="Cumulative P&L"
            value={inrDec(data.totalRealizedPnl)}
            tone={data.totalRealizedPnl > 0 ? "pos" : data.totalRealizedPnl < 0 ? "neg" : undefined}
          />
          <Stat
            label="Win rate"
            value={`${(data.winRate * 100).toFixed(1)}%`}
            tone={data.winRate >= 0.5 ? "pos" : data.winRate > 0 ? "neg" : undefined}
          />
          <Stat
            label="Expectancy / trade"
            value={inrDec(data.expectancy)}
            tone={data.expectancy > 0 ? "pos" : data.expectancy < 0 ? "neg" : undefined}
          />
          <Stat
            label="Profit factor"
            value={data.profitFactor >= 99 ? "∞" : data.profitFactor.toFixed(2)}
            tone={data.profitFactor >= 1.5 ? "pos" : data.profitFactor < 1 ? "neg" : undefined}
          />
          <Stat
            label="Avg R-multiple"
            value={data.avgRMultiple == null ? "—" : `${data.avgRMultiple.toFixed(2)}R`}
            tone={data.avgRMultiple != null && data.avgRMultiple > 0 ? "pos" : data.avgRMultiple != null && data.avgRMultiple < 0 ? "neg" : undefined}
          />
          <Stat
            label="Max drawdown"
            value={inrDec(data.maxDrawdown)}
            tone={data.maxDrawdown < 0 ? "neg" : undefined}
          />
          <Stat label="Wins / Losses" value={`${data.wins} / ${data.losses}`} />
          <Stat
            label="Avg win"
            value={inrDec(data.avgWin)}
            tone={data.avgWin > 0 ? "pos" : undefined}
          />
          <Stat
            label="Avg loss"
            value={inrDec(data.avgLoss)}
            tone={data.avgLoss < 0 ? "neg" : undefined}
          />
          <Stat
            label="Largest win"
            value={inrDec(data.largestWin)}
            tone={data.largestWin > 0 ? "pos" : undefined}
          />
          <Stat
            label="Largest loss"
            value={inrDec(data.largestLoss)}
            tone={data.largestLoss < 0 ? "neg" : undefined}
          />
          <Stat
            label="Current drawdown"
            value={inrDec(data.currentDrawdown)}
            tone={data.currentDrawdown < 0 ? "neg" : undefined}
          />
        </div>
        <EquityCurveSparkline points={data.equityCurve} />
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
            By setup
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <tr>
                  <th className="py-2 pr-3">Setup</th>
                  <th className="py-2 pr-3 text-right">Trades</th>
                  <th className="py-2 pr-3 text-right">Win rate</th>
                  <th className="py-2 pr-3 text-right">Total P&amp;L</th>
                  <th className="py-2 pr-3 text-right">Avg P&amp;L</th>
                  <th className="py-2 pr-3 text-right">Best</th>
                  <th className="py-2 pr-3 text-right">Worst</th>
                </tr>
              </thead>
              <tbody>
                {data.bySetup.map(s => (
                  <tr key={s.setupKey} className="border-b border-border/40">
                    <td className="py-2 pr-3 font-medium">{s.setupKey}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{s.trades}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{(s.winRate * 100).toFixed(1)}%</td>
                    <td className={`py-2 pr-3 text-right tabular-nums font-medium ${s.totalPnl > 0 ? "text-emerald-300" : s.totalPnl < 0 ? "text-rose-300" : ""}`}>
                      {inrDec(s.totalPnl)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{inrDec(s.avgPnl)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-emerald-300/80">{inrDec(s.bestTrade)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-rose-300/80">{inrDec(s.worstTrade)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EquityCurveSparkline({ points }: {
  points: FoAnalytics["equityCurve"];
}) {
  if (points.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        Equity curve will appear after the first closed paper trade.
      </p>
    );
  }
  const W = 800;
  const H = 160;
  const PAD = 8;
  const xs = points.map((_, i) => i);
  const ys = points.map(p => p.cumulativePnl);
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(0, ...ys);
  const xRange = Math.max(1, xs.length - 1);
  const yRange = Math.max(1, maxY - minY);
  const sx = (i: number) => PAD + (i / xRange) * (W - 2 * PAD);
  const sy = (v: number) => H - PAD - ((v - minY) / yRange) * (H - 2 * PAD);
  const baselineY = sy(0);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${sx(i).toFixed(1)},${sy(p.cumulativePnl).toFixed(1)}`)
    .join(" ");
  const last = points[points.length - 1]!;
  const lastTone = last.cumulativePnl >= 0 ? "stroke-emerald-400" : "stroke-rose-400";
  const fillTone = last.cumulativePnl >= 0 ? "fill-emerald-400/20" : "fill-rose-400/20";
  const areaPath =
    `${path} L${sx(points.length - 1).toFixed(1)},${baselineY.toFixed(1)} ` +
    `L${sx(0).toFixed(1)},${baselineY.toFixed(1)} Z`;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Equity curve · {points.length} trading day{points.length === 1 ? "" : "s"}
        </div>
        <div className="text-xs text-muted-foreground">
          Peak {inrDec(Math.max(...ys))} · Trough {inrDec(Math.min(...ys))}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full h-40 rounded border border-border bg-muted/20"
        role="img"
        aria-label="Cumulative P&L equity curve"
      >
        <line x1={PAD} y1={baselineY} x2={W - PAD} y2={baselineY} className="stroke-border" strokeDasharray="2 4" />
        <path d={areaPath} className={fillTone} />
        <path d={path} fill="none" strokeWidth="1.5" className={lastTone} />
      </svg>
    </div>
  );
}

function MissedSignalsCard({ missed, loading, error }: {
  missed: MissedSignalRow[];
  loading: boolean;
  error: string | null;
}) {
  if (error) {
    return (
      <Card>
        <CardHeader><CardTitle>Missed signals</CardTitle></CardHeader>
        <CardContent><ErrorBlock message={error} /></CardContent>
      </Card>
    );
  }
  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle>Missed signals</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-20 w-full" /></CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Skipped &amp; missed signals</CardTitle>
        <CardDescription>
          Every trigger the F&amp;O paper-trade engine declined this session,
          with the precise reason. Use this to understand the gap between
          what the scanner shows and what the engine actually executed:
          <br />
          <span className="text-amber-300">Missed window</span> — signal
          triggered &amp; hit T1/T2/SL inside one polling cycle (anti-phantom
          rule prevents same-cycle open+close).{" "}
          <span className="text-sky-300">Yahoo-delayed (Kite off)</span> — Kite
          live feed unavailable; rejected only when{" "}
          <code>PAPER_TRADE_KITE_ONLY=1</code> is set.{" "}
          <span className="text-violet-300">Below conf. floor</span> —
          STANDARD &lt; 70 / BASELINE &lt; 55.{" "}
          <span className="text-slate-300">Stale data</span> — bars older
          than the Yahoo 15-min floor.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {missed.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No skipped signals tracked since server start.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <tr>
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Index</th>
                  <th className="py-2 pr-3">Setup</th>
                  <th className="py-2 pr-3">Side</th>
                  <th className="py-2 pr-3">Why skipped</th>
                  <th className="py-2 pr-3">Outcome</th>
                  <th className="py-2 pr-3 text-right">Conf</th>
                  <th className="py-2 pr-3 text-right">Entry</th>
                  <th className="py-2 pr-3 text-right">Would-be exit</th>
                </tr>
              </thead>
              <tbody>
                {missed.map((m, idx) => {
                  const wouldBeExit =
                    m.reason === "TARGET2_HIT" ? m.optionTarget2 :
                    m.reason === "TARGET1_HIT" ? m.optionTarget1 :
                    m.reason === "STOPPED" ? m.optionStop :
                    null;
                  const outcomeTone = m.reason ? REASON_TONE[m.reason] ?? "bg-slate-500/15 text-slate-200 border-slate-500/30" : "bg-slate-500/15 text-slate-200 border-slate-500/30";
                  const skipTone = SKIP_REASON_TONE[m.skipReason] ?? "bg-slate-500/15 text-slate-200 border-slate-500/30";
                  const skipLabel = SKIP_REASON_LABEL[m.skipReason] ?? m.skipReason;
                  return (
                    <tr key={`${m.signalDate}-${m.indexSymbol}-${m.setupKey}-${m.direction}-${m.skipReason}-${idx}`} className="border-b border-border/40">
                      <td className="py-2 pr-3 text-[12px] text-muted-foreground">{fmtTime(m.observedAt)}</td>
                      <td className="py-2 pr-3 font-medium">{m.indexName || m.indexSymbol}</td>
                      <td className="py-2 pr-3 text-[12px]">{m.setupKey}</td>
                      <td className="py-2 pr-3">
                        <span className={m.direction === "BULLISH" ? "text-emerald-300" : "text-rose-300"}>
                          {m.direction === "BULLISH" ? "Bullish" : "Bearish"}
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`px-2 py-0.5 rounded border text-[11px] ${skipTone}`} title={`dataQuality=${m.dataQuality}`}>{skipLabel}</span>
                      </td>
                      <td className="py-2 pr-3">
                        {m.reason ? (
                          <span className={`px-2 py-0.5 rounded border text-[11px] ${outcomeTone}`}>{m.reason}</span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{m.confidence}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {m.optionEntry != null ? `₹${m.optionEntry.toFixed(2)}` : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {wouldBeExit != null ? `₹${wouldBeExit.toFixed(2)}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  label, value, tone,
}: { label: string; value: string; tone?: "pos" | "neg" }) {
  const color =
    tone === "pos" ? "text-emerald-300" :
    tone === "neg" ? "text-rose-300" :
    "text-foreground";
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`text-lg font-semibold tabular-nums ${color}`}>{value}</span>
    </div>
  );
}

function HeatIndicator({ deployed, total }: { deployed: number; total: number }) {
  const pctVal = total > 0 ? (deployed / total) * 100 : 0;
  const clamped = Math.min(100, Math.max(0, pctVal));
  const heatColor =
    clamped >= 80 ? "bg-rose-500" :
    clamped >= 60 ? "bg-amber-500" :
    clamped >= 40 ? "bg-yellow-500" :
    "bg-emerald-500";
  const textColor =
    clamped >= 80 ? "text-rose-300" :
    clamped >= 60 ? "text-amber-300" :
    clamped >= 40 ? "text-yellow-300" :
    "text-emerald-300";
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Portfolio Heat</span>
      <div className="flex items-center gap-2">
        <span className={`text-lg font-semibold tabular-nums ${textColor}`}>
          {clamped.toFixed(1)}%
        </span>
      </div>
      <div className="w-full h-1.5 rounded-full bg-muted/40 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${heatColor}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

function PositionsCard({
  positions, loading, error,
}: {
  positions: OpenPosition[];
  loading: boolean;
  error: string | null;
}) {
  if (error) {
    return (
      <Card>
        <CardHeader><CardTitle>Portfolio</CardTitle></CardHeader>
        <CardContent><ErrorBlock message={error} /></CardContent>
      </Card>
    );
  }
  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle>Portfolio</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-32 w-full" /></CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Portfolio</CardTitle>
        <CardDescription>
          Live mark-to-market. LTP is pulled fresh from the option chain on
          every refresh (every 10s), independent of the signal cycle. Use the
          close button to force-exit at the latest LTP.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {positions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No open paper positions right now. Auto-opens on the next qualifying signal trigger.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <tr>
                  <th className="py-2 pr-3">Symbol</th>
                  <th className="py-2 pr-3">Side</th>
                  <th className="py-2 pr-3">Lots</th>
                  <th className="py-2 pr-3 text-right">Entry</th>
                  <th className="py-2 pr-3 text-right">SL</th>
                  <th className="py-2 pr-3 text-right">T1</th>
                  <th className="py-2 pr-3 text-right">T2</th>
                  <th className="py-2 pr-3 text-right" title="Last Traded Price — refreshed live from the option chain on every poll (10s)">LTP</th>
                  <th className="py-2 pr-3 text-right">Capital</th>
                  <th className="py-2 pr-3 text-right">U.P&amp;L</th>
                  <th className="py-2 pr-3">Opened</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {positions.map(p => <PositionRow key={p.id} p={p} />)}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PositionRow({ p }: { p: OpenPosition }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const closeMut = useMutation({
    mutationFn: () =>
      api<ClosedTrade>(`/paper/positions/fo/${encodeURIComponent(p.id)}/close`, {
        method: "POST",
      }),
    onSuccess: () => {
      toast({ title: "Position closed", description: `${p.indexSymbol} ${p.optionType} ${p.strike}` });
      void qc.invalidateQueries({ queryKey: QK_POSITIONS });
      void qc.invalidateQueries({ queryKey: QK_ACCOUNT });
      void qc.invalidateQueries({ queryKey: QK_TRADES });
    },
    onError: (err: Error) => {
      toast({ title: "Close failed", description: err.message, variant: "destructive" });
    },
  });
  const upnlTone =
    p.unrealizedPnl > 0 ? "text-emerald-300" :
    p.unrealizedPnl < 0 ? "text-rose-300" : "text-foreground";
  return (
    <tr className="border-b border-border/40">
      <td className="py-2 pr-3">
        <div className="font-medium">{p.indexSymbol}</div>
        <div className="text-[11px] text-muted-foreground">
          {p.optionType} {p.strike} · {p.setupKey}
        </div>
      </td>
      <td className="py-2 pr-3">
        <Badge variant={p.direction === "BULLISH" ? "default" : "destructive"}>
          {p.direction}
        </Badge>
      </td>
      <td className="py-2 pr-3 tabular-nums">{p.lots} × {p.lotSize}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{p.entryPremium.toFixed(2)}</td>
      <td className="py-2 pr-3 text-right tabular-nums text-rose-300">{p.stopPremium.toFixed(2)}</td>
      <td className="py-2 pr-3 text-right tabular-nums text-emerald-300">{p.target1Premium.toFixed(2)}</td>
      <td className="py-2 pr-3 text-right tabular-nums text-emerald-300">{p.target2Premium.toFixed(2)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{p.lastPremium.toFixed(2)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{inr(p.capitalDeployed)}</td>
      <td className={`py-2 pr-3 text-right tabular-nums font-medium ${upnlTone}`}>
        {inrDec(p.unrealizedPnl)}
      </td>
      <td className="py-2 pr-3 text-[12px] text-muted-foreground">{fmtTime(p.openedAt)}</td>
      <td className="py-2 pr-3 text-right">
        <Button
          size="sm"
          variant="outline"
          disabled={closeMut.isPending}
          onClick={() => closeMut.mutate()}
        >
          {closeMut.isPending ? "Closing…" : "Close"}
        </Button>
      </td>
    </tr>
  );
}

const JOURNAL_TAGS = [
  "FOLLOWED_PLAN", "DEVIATED", "EARLY_EXIT", "LATE_ENTRY",
  "SIZE_TOO_BIG", "SIZE_TOO_SMALL", "GOOD_RR", "BAD_RR",
  "MOMENTUM_TRADE", "MEAN_REVERSION", "NEWS_DRIVEN",
] as const;

function JournalPanel({ tradeId, segment, initial }: {
  tradeId: string;
  segment: "fo" | "eq";
  initial: { journal?: string | null; tags?: string[] };
}) {
  const [text, setText] = useState(initial.journal ?? "");
  const [tags, setTags] = useState<string[]>(initial.tags ?? []);
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const save = useMutation({
    mutationFn: () =>
      api<{ id: string }>(`/paper/trades/${segment}/${encodeURIComponent(tradeId)}/journal`, {
        method: "PATCH",
        body: JSON.stringify({ journal: text || null, tags }),
      }),
    onSuccess: () => {
      toast({ title: "Journal saved" });
      if (segment === "fo") {
        void qc.invalidateQueries({ queryKey: QK_TRADES });
      } else {
        void qc.invalidateQueries({ queryKey: QK_TRADES_EQ });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const toggleTag = useCallback((tag: string) => {
    setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  }, []);

  const hasContent = !!(initial.journal || (initial.tags && initial.tags.length > 0));

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`text-[11px] ${hasContent ? "text-sky-400 hover:text-sky-300" : "text-muted-foreground hover:text-foreground"} transition-colors`}
      >
        {hasContent ? "Edit journal" : "Add journal"}
      </button>
    );
  }

  return (
    <div className="mt-2 p-3 rounded-md border border-border/60 bg-card/50 space-y-2">
      <textarea
        className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm resize-y min-h-[60px] focus:outline-none focus:ring-1 focus:ring-ring"
        placeholder="What did you learn from this trade?"
        value={text}
        onChange={e => setText(e.target.value)}
        rows={3}
      />
      <div className="flex flex-wrap gap-1.5">
        {JOURNAL_TAGS.map(tag => (
          <button
            key={tag}
            onClick={() => toggleTag(tag)}
            className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
              tags.includes(tag)
                ? "bg-sky-500/20 text-sky-200 border-sky-500/40"
                : "bg-muted/30 text-muted-foreground border-border/40 hover:border-border"
            }`}
          >
            {tag.replace(/_/g, " ")}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function TradesCard({ trades, loading, error }: {
  trades: ClosedTrade[];
  loading: boolean;
  error: string | null;
}) {
  const totals = useMemo(() => {
    let realized = 0, wins = 0;
    for (const t of trades) {
      realized += t.realizedPnl;
      if (t.realizedPnl > 0) wins++;
    }
    return {
      count: trades.length,
      realized,
      wins,
      winPct: trades.length === 0 ? 0 : wins / trades.length,
    };
  }, [trades]);
  if (error) {
    return (
      <Card>
        <CardHeader><CardTitle>Today's closed trades</CardTitle></CardHeader>
        <CardContent><ErrorBlock message={error} /></CardContent>
      </Card>
    );
  }
  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle>Today's closed trades</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-32 w-full" /></CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Today's closed trades</CardTitle>
        <CardDescription>
          {totals.count === 0
            ? "Nothing closed yet today."
            : `${totals.count} closed · realized ${inrDec(totals.realized)} · win-rate ${pct(totals.winPct)}`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {trades.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No closed paper trades today yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <tr>
                  <th className="py-2 pr-3">Symbol</th>
                  <th className="py-2 pr-3">Side</th>
                  <th className="py-2 pr-3">Lots</th>
                  <th className="py-2 pr-3 text-right">Entry</th>
                  <th className="py-2 pr-3 text-right">Exit</th>
                  <th className="py-2 pr-3 text-right">Capital</th>
                  <th className="py-2 pr-3 text-right">P&amp;L</th>
                  <th className="py-2 pr-3">Reason</th>
                  <th className="py-2 pr-3">Opened</th>
                  <th className="py-2 pr-3">Closed</th>
                  <th className="py-2 pr-3">Journal</th>
                </tr>
              </thead>
              <tbody>
                {trades.map(t => {
                  const tone =
                    t.realizedPnl > 0 ? "text-emerald-300" :
                    t.realizedPnl < 0 ? "text-rose-300" : "";
                  return (
                    <tr key={t.id} className="border-b border-border/40">
                      <td className="py-2 pr-3">
                        <div className="font-medium">{t.indexSymbol}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {t.optionType} {t.strike} · {t.setupKey}
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        <Badge variant={t.direction === "BULLISH" ? "default" : "destructive"}>
                          {t.direction}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{t.lots} × {t.lotSize}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{t.entryPremium.toFixed(2)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{t.exitPremium.toFixed(2)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{inr(t.capitalDeployed)}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums font-medium ${tone}`}>
                        {inrDec(t.realizedPnl)}
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`px-2 py-0.5 rounded border text-[11px] ${REASON_TONE[t.exitReason]}`}>
                          {t.exitReason}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-[12px] text-muted-foreground">{fmtTime(t.openedAt)}</td>
                      <td className="py-2 pr-3 text-[12px] text-muted-foreground">{fmtTime(t.exitedAt)}</td>
                      <td className="py-2 pr-3">
                        <JournalPanel tradeId={t.id} segment="fo" initial={{ journal: t.journal, tags: t.tags }} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
