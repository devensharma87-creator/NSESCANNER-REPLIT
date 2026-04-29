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
import { useMemo, useState } from "react";
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
  unrealizedPnl: number;
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
        <CardHeader><CardTitle>Open positions</CardTitle></CardHeader>
        <CardContent><ErrorBlock message={error} /></CardContent>
      </Card>
    );
  }
  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle>Open positions</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-32 w-full" /></CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Open positions</CardTitle>
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
                  <th className="py-2 pr-3 text-right">Entry</th>
                  <th className="py-2 pr-3 text-right">SL</th>
                  <th className="py-2 pr-3 text-right">T1</th>
                  <th className="py-2 pr-3 text-right">T2</th>
                  <th className="py-2 pr-3 text-right">Last</th>
                  <th className="py-2 pr-3 text-right">Capital</th>
                  <th className="py-2 pr-3 text-right">U.P&amp;L</th>
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
      <td className="py-2 pr-3 text-right tabular-nums">{p.entryPrice.toFixed(2)}</td>
      <td className="py-2 pr-3 text-right tabular-nums text-rose-300">{p.stopPrice.toFixed(2)}</td>
      <td className="py-2 pr-3 text-right tabular-nums text-emerald-300">{p.target1Price.toFixed(2)}</td>
      <td className="py-2 pr-3 text-right tabular-nums text-emerald-300">{p.target2Price.toFixed(2)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{p.lastPrice.toFixed(2)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{inr(p.capitalDeployed)}</td>
      <td className={`py-2 pr-3 text-right tabular-nums font-medium ${upnlTone}`}>
        {inrDec(p.unrealizedPnl)}
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

function FOSegment() {
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

  return (
    <div className="space-y-6">
      <AccountCard
        data={account.data}
        loading={account.isLoading}
        error={account.error instanceof Error ? account.error.message : null}
      />
      <PositionsCard
        positions={positions.data?.positions ?? []}
        loading={positions.isLoading}
        error={positions.error instanceof Error ? positions.error.message : null}
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

function AccountCard({ data, loading, error }: {
  data?: PaperAccount;
  loading: boolean;
  error: string | null;
}) {
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
  const netVsSeed = data.balance + data.dayRealizedPnl - data.seedCapital;
  // Note: balance already reflects debits for OPEN positions, so the
  // "true" running equity line includes day P&L. We show both.
  return (
    <Card>
      <CardHeader>
        <CardTitle>F&amp;O Account</CardTitle>
        <CardDescription>
          Reset each IST trading day to {inr(data.seedCapital)} seed capital.
          Last reset: {data.lastResetDate}.
        </CardDescription>
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
          label="Net vs. seed (today)"
          value={inrDec(netVsSeed)}
          tone={netVsSeed > 0 ? "pos" : netVsSeed < 0 ? "neg" : undefined}
        />
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
        <CardHeader><CardTitle>Open positions</CardTitle></CardHeader>
        <CardContent><ErrorBlock message={error} /></CardContent>
      </Card>
    );
  }
  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle>Open positions</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-32 w-full" /></CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Open positions</CardTitle>
        <CardDescription>
          Live mark-to-market using the most recently observed option premium
          from the signal lifecycle. Use the close button to force-exit at the
          last known premium.
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
                  <th className="py-2 pr-3 text-right">Last</th>
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
