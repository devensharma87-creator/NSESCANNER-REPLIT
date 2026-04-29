/**
 * Owner-only F&O paper trading P&L analytics report.
 *
 * Console-style calendar that mirrors the screenshots the user shared:
 *   - Top tabs: Intraday / Equity / F&O. Only F&O is wired to live data;
 *     the other two render an explicit "no data — Phase 3" placeholder
 *     so we never imply we have intraday-equity or swing-equity ledgers
 *     that don't exist yet.
 *   - Period toggle: Monthly / Yearly.
 *   - Date navigator (a strip of recent months, or recent FYs).
 *   - Headline: Total Realized P&L + Net Realized P&L + Taxes & Charges.
 *   - Calendar grid (monthly) or 12-month grid (yearly) with green/red
 *     P&L pills.
 *   - Per-trade detail table with strike, entry, exit, planned R, achieved
 *     R, P&L, exit reason and duration — exactly the columns the user
 *     asked for.
 *
 * All numbers come from `paper_trade_fo` (status=CLOSED) via the report
 * endpoints. Charges are computed on the backend using the standard NSE
 * F&O option fee schedule. No mocks, no synthetic days, no silent empty
 * fallbacks — failures render as a visible red error block.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Info } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL;

async function api<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
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

// ---------- types (mirror server PaperReport* schemas) ----------
interface ReportTotals {
  realizedPnl: number;
  netPnl: number;
  charges: number;
  tradeCount: number;
  wins: number;
  losses: number;
  winRatePct: number;
  avgWin: number;
  avgLoss: number;
  bestTrade: number;
  worstTrade: number;
  avgRMultiple: number;
  profitFactor: number;
}
interface DayBucket {
  date: string;
  realizedPnl: number;
  netPnl: number;
  charges: number;
  tradeCount: number;
  wins: number;
  losses: number;
}
interface MonthBucket {
  month: string;
  realizedPnl: number;
  netPnl: number;
  charges: number;
  tradeCount: number;
  wins: number;
  losses: number;
}
interface TradeDetailRow {
  id: string;
  signalDate: string;
  exitedAt: string;
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
  stopPremium: number;
  target1Premium: number;
  target2Premium: number;
  capitalDeployed: number;
  realizedPnl: number;
  charges: number;
  netPnl: number;
  plannedRiskPerShare: number;
  achievedPerShare: number;
  rMultiple: number;
  exitReason: "TARGET1_HIT" | "TARGET2_HIT" | "STOPPED" | "EXPIRED" | "MANUAL_OVERRIDE";
  durationSec: number;
}
interface MonthlyReport {
  month: string;
  from: string;
  to: string;
  totals: ReportTotals;
  days: DayBucket[];
  trades: TradeDetailRow[];
  generatedAt: string;
}
interface YearlyReport {
  fy: string;
  from: string;
  to: string;
  totals: ReportTotals;
  months: MonthBucket[];
  generatedAt: string;
}

// ---------- formatters ----------
const inrFull = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
const inr0 = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

/** Compact ₹ in K / L / Cr that matches the screenshots ("2.7L", "88.7K", "1.3L"). */
function inrShort(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}${(abs / 1e7).toFixed(2).replace(/\.?0+$/, "")}Cr`;
  if (abs >= 1e5) return `${sign}${(abs / 1e5).toFixed(1).replace(/\.0$/, "")}L`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return `${sign}${abs.toFixed(0)}`;
}

const ymd = (d: Date) => {
  // ISO YYYY-MM-DD in IST.
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
};

const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y!, (m! - 1), 1)).toLocaleDateString("en-IN", {
    month: "short", year: "numeric", timeZone: "UTC",
  });
};

const monthLong = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y!, (m! - 1), 1)).toLocaleDateString("en-IN", {
    month: "long", year: "numeric", timeZone: "UTC",
  });
};

/** Today's IST month YYYY-MM. */
function currentIstMonth(): string {
  return ymd(new Date()).slice(0, 7);
}

/** Today's IST FY in YYYY-YYYY form. April starts the FY. */
function currentIstFY(): string {
  const today = new Date(Date.now() + 5.5 * 3600 * 1000);
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth(); // 0=Jan
  const start = m >= 3 ? y : y - 1;
  return `${start}-${start + 1}`;
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function shiftFY(fy: string, delta: number): string {
  const start = Number(fy.split("-")[0]) + delta;
  return `${start}-${start + 1}`;
}

// ---------- main ----------
export default function PaperReports() {
  const [tab, setTab] = useState<"INTRADAY" | "EQUITY" | "FNO">("FNO");
  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">P&amp;L Reports</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Console-style realized profit and loss, taxes &amp; charges, win
          rate and per-trade detail across the paper book.
        </p>
      </div>
      <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
        <TabsList className="mb-4 grid grid-cols-3 max-w-lg">
          <TabsTrigger value="INTRADAY">Intraday</TabsTrigger>
          <TabsTrigger value="EQUITY">Equity</TabsTrigger>
          <TabsTrigger value="FNO">F&amp;O</TabsTrigger>
        </TabsList>
        <TabsContent value="INTRADAY">
          <ComingSoon
            title="Intraday equity — coming next"
            body="Intraday cash-segment paper trading is part of Phase 3. Once that ledger lands here, this tab will show the same calendar, monthly / yearly toggle and per-trade detail for cash intraday trades."
          />
        </TabsContent>
        <TabsContent value="EQUITY">
          <ComingSoon
            title="Equity (swing) — coming next"
            body="Multi-day equity positions from STRONG_BUY signals. The equity paper book is also Phase 3; this tab will populate automatically the moment closed equity trades exist."
          />
        </TabsContent>
        <TabsContent value="FNO">
          <FOReport />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ComingSoon({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{body}</CardDescription>
      </CardHeader>
    </Card>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
      <div className="font-semibold mb-1">Failed to load report</div>
      <div className="text-rose-100/80">{message}</div>
    </div>
  );
}

// ---------- F&O report ----------
function FOReport() {
  const [period, setPeriod] = useState<"MONTHLY" | "YEARLY">("MONTHLY");
  const [month, setMonth] = useState<string>(currentIstMonth());
  const [fy, setFy] = useState<string>(currentIstFY());

  const months = useMemo(() => {
    // most recent on the left, then 5 older, matching the screenshot strip
    return Array.from({ length: 6 }, (_, i) => shiftMonth(currentIstMonth(), -i));
  }, []);
  const fys = useMemo(() => {
    return Array.from({ length: 4 }, (_, i) => shiftFY(currentIstFY(), -i));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={period} onValueChange={v => setPeriod(v as typeof period)}>
          <SelectTrigger className="w-[140px] border-sky-500/60 text-sky-300 hover:text-sky-200">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="MONTHLY">Monthly</SelectItem>
            <SelectItem value="YEARLY">Yearly</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2 overflow-x-auto">
          {period === "MONTHLY"
            ? months.map(m => (
                <PeriodChip
                  key={m}
                  label={monthLabel(m)}
                  active={m === month}
                  onClick={() => setMonth(m)}
                />
              ))
            : fys.map(f => (
                <PeriodChip
                  key={f}
                  label={`FY ${f}`}
                  active={f === fy}
                  onClick={() => setFy(f)}
                />
              ))}
        </div>
      </div>
      {period === "MONTHLY"
        ? <MonthlyView month={month} onChangeMonth={setMonth} />
        : <YearlyView fy={fy} onChangeFy={setFy} />}
    </div>
  );
}

function PeriodChip({ label, active, onClick }: {
  label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full px-4 py-1.5 text-sm whitespace-nowrap border transition-colors",
        active
          ? "border-sky-500 text-sky-300 bg-sky-500/10"
          : "border-slate-700 text-slate-300 bg-slate-800/40 hover:bg-slate-800",
      )}
    >
      {label}
    </button>
  );
}

// ---------- Monthly view ----------
function MonthlyView({ month, onChangeMonth }: {
  month: string; onChangeMonth: (m: string) => void;
}) {
  const q = useQuery({
    queryKey: ["paper", "report", "fo", "monthly", month],
    queryFn: () => api<MonthlyReport>(`/paper/reports/fo/monthly?month=${month}`),
  });

  if (q.isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }
  if (q.error) {
    return <ErrorBlock message={q.error instanceof Error ? q.error.message : "Unknown error"} />;
  }
  const r = q.data!;
  return (
    <div className="space-y-6">
      <TotalsCard totals={r.totals} />
      <CalendarCard
        month={r.month}
        days={r.days}
        onPrev={() => onChangeMonth(shiftMonth(month, -1))}
        onNext={() => onChangeMonth(shiftMonth(month, 1))}
      />
      <TradeDetailTable trades={r.trades} />
    </div>
  );
}

// ---------- Yearly view ----------
function YearlyView({ fy, onChangeFy }: {
  fy: string; onChangeFy: (f: string) => void;
}) {
  const q = useQuery({
    queryKey: ["paper", "report", "fo", "yearly", fy],
    queryFn: () => api<YearlyReport>(`/paper/reports/fo/yearly?fy=${fy}`),
  });
  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (q.error) return <ErrorBlock message={q.error instanceof Error ? q.error.message : "Unknown error"} />;
  const r = q.data!;
  return (
    <div className="space-y-6">
      <TotalsCard totals={r.totals} />
      <YearlyGridCard
        fy={r.fy}
        months={r.months}
        onPrev={() => onChangeFy(shiftFY(fy, -1))}
        onNext={() => onChangeFy(shiftFY(fy, 1))}
      />
    </div>
  );
}

// ---------- shared cards ----------
function TotalsCard({ totals }: { totals: ReportTotals }) {
  const realizedTone = totals.realizedPnl > 0 ? "text-emerald-400" : totals.realizedPnl < 0 ? "text-rose-400" : "text-slate-200";
  const netTone = totals.netPnl > 0 ? "text-emerald-400" : totals.netPnl < 0 ? "text-rose-400" : "text-slate-200";
  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Total Realized P&amp;L</div>
          <div className={cn("text-3xl font-semibold mt-1", realizedTone)}>
            {totals.realizedPnl >= 0 ? "+ " : "- "}
            {inrFull(Math.abs(totals.realizedPnl))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-6 pt-2 border-t border-slate-800">
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Net Realised P&amp;L</div>
            <div className={cn("text-lg font-semibold mt-1", netTone)}>
              {totals.netPnl >= 0 ? "+ " : "- "}
              {inrFull(Math.abs(totals.netPnl))}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              Taxes &amp; Charges
              <Info
                className="h-3 w-3 text-slate-400"
                aria-label="STT, exchange transaction, SEBI, GST and stamp duty using the standard NSE F&O option fee schedule"
              />
            </div>
            <div className="text-lg font-semibold mt-1 text-slate-100">
              + {inrFull(totals.charges)}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-slate-800 text-sm">
          <Stat label="Trades" value={String(totals.tradeCount)} />
          <Stat label="Win rate" value={`${totals.winRatePct.toFixed(1)}%`} />
          <Stat
            label="Avg R achieved"
            value={totals.avgRMultiple.toFixed(2) + "R"}
            tone={totals.avgRMultiple > 0 ? "good" : totals.avgRMultiple < 0 ? "bad" : undefined}
          />
          <Stat
            label="Profit factor"
            value={Number.isFinite(totals.profitFactor) ? totals.profitFactor.toFixed(2) : "∞"}
            tone={totals.profitFactor >= 1 ? "good" : totals.profitFactor > 0 ? "bad" : undefined}
          />
          <Stat label="Best trade" value={inr0(totals.bestTrade)} tone="good" />
          <Stat label="Worst trade" value={inr0(totals.worstTrade)} tone="bad" />
          <Stat label="Avg win" value={inr0(totals.avgWin)} tone="good" />
          <Stat label="Avg loss" value={inr0(totals.avgLoss > 0 ? -totals.avgLoss : totals.avgLoss)} tone="bad" />
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn(
        "font-semibold mt-0.5",
        tone === "good" && "text-emerald-400",
        tone === "bad" && "text-rose-400",
      )}>
        {value}
      </div>
    </div>
  );
}

// ---------- monthly calendar ----------
function CalendarCard({ month, days, onPrev, onNext }: {
  month: string; days: DayBucket[]; onPrev: () => void; onNext: () => void;
}) {
  const byDate = useMemo(() => {
    const m = new Map<string, DayBucket>();
    for (const d of days) m.set(d.date, d);
    return m;
  }, [days]);

  // Build calendar: Sunday-first weeks covering the month.
  const cells = useMemo(() => buildCalendarCells(month), [month]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-center gap-3">
          <Button size="icon" variant="ghost" onClick={onPrev} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <CardTitle className="text-base">{monthLong(month)}</CardTitle>
          <Button size="icon" variant="ghost" onClick={onNext} aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 text-xs uppercase text-slate-400 mb-2">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
            <div key={d} className="px-2 py-1 text-center">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((c, i) => {
            if (!c.inMonth) {
              return <div key={i} className="h-16 rounded-md text-slate-600 px-2 py-1 text-xs">{c.day}</div>;
            }
            const bucket = byDate.get(c.iso!);
            return <DayCell key={i} day={c.day} bucket={bucket} />;
          })}
        </div>
        <p className="text-xs text-slate-500 mt-3">
          P&amp;L pill values are net of estimated taxes &amp; charges. Days
          without trades show no pill.
        </p>
      </CardContent>
    </Card>
  );
}

function DayCell({ day, bucket }: { day: number; bucket?: DayBucket }) {
  const hasData = !!bucket && bucket.tradeCount > 0;
  const positive = !!bucket && bucket.netPnl > 0;
  const negative = !!bucket && bucket.netPnl < 0;
  const pillTone = positive
    ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
    : negative
    ? "bg-rose-500/15 text-rose-300 border-rose-500/40"
    : "bg-slate-700/40 text-slate-200 border-slate-600";
  return (
    <div
      className={cn(
        "h-16 rounded-md px-2 py-1 text-center flex flex-col items-center justify-start",
        hasData ? "bg-slate-900/40" : "",
      )}
      title={
        hasData
          ? `${bucket!.tradeCount} trade${bucket!.tradeCount > 1 ? "s" : ""}, net ${inrFull(bucket!.netPnl)} (gross ${inrFull(bucket!.realizedPnl)}, charges ${inrFull(bucket!.charges)})`
          : undefined
      }
    >
      <div className="text-sm font-semibold text-slate-200">{day}</div>
      {hasData && (
        <div className={cn(
          "mt-1 inline-flex items-center justify-center text-[11px] font-semibold rounded-full border px-2 py-0.5 leading-none",
          pillTone,
        )}>
          {(bucket!.netPnl >= 0 ? "" : "-") + inrShort(Math.abs(bucket!.netPnl))}
        </div>
      )}
    </div>
  );
}

interface CalendarCell { day: number; inMonth: boolean; iso: string | null }
function buildCalendarCells(month: string): CalendarCell[] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y!, m! - 1, 1));
  const startWeekday = first.getUTCDay(); // 0 = Sunday
  const lastDay = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  const cells: CalendarCell[] = [];
  // Trailing days of previous month
  const prevLastDay = new Date(Date.UTC(y!, m! - 1, 0)).getUTCDate();
  for (let i = startWeekday - 1; i >= 0; i--) {
    cells.push({ day: prevLastDay - i, inMonth: false, iso: null });
  }
  for (let d = 1; d <= lastDay; d++) {
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ day: d, inMonth: true, iso });
  }
  // Pad to 6 weeks (42 cells) with leading days of next month so the
  // grid height never jumps between months.
  let nextDay = 1;
  while (cells.length % 7 !== 0 || cells.length < 42) {
    cells.push({ day: nextDay++, inMonth: false, iso: null });
    if (cells.length >= 42) break;
  }
  return cells;
}

// ---------- yearly grid ----------
function YearlyGridCard({ fy, months, onPrev, onNext }: {
  fy: string; months: MonthBucket[]; onPrev: () => void; onNext: () => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-center gap-3">
          <Button size="icon" variant="ghost" onClick={onPrev} aria-label="Previous FY">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <CardTitle className="text-base">FY {fy}</CardTitle>
          <Button size="icon" variant="ghost" onClick={onNext} aria-label="Next FY">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <CardDescription className="text-center">
          April {fy.split("-")[0]} → March {fy.split("-")[1]}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {months.map(b => <MonthCell key={b.month} bucket={b} />)}
        </div>
        <p className="text-xs text-slate-500 mt-3">
          Each pill is the month's net realized P&amp;L. Click a month to drill
          in by switching the period selector to Monthly.
        </p>
      </CardContent>
    </Card>
  );
}

function MonthCell({ bucket }: { bucket: MonthBucket }) {
  const has = bucket.tradeCount > 0;
  const positive = bucket.netPnl > 0;
  const negative = bucket.netPnl < 0;
  const pillTone = positive
    ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
    : negative
    ? "bg-rose-500/15 text-rose-300 border-rose-500/40"
    : "bg-slate-700/40 text-slate-300 border-slate-600";
  return (
    <div className="rounded-md border border-slate-800 px-3 py-3 flex flex-col items-center gap-1">
      <div className="text-sm font-semibold text-slate-200">{monthLabel(bucket.month)}</div>
      {has ? (
        <>
          <div className={cn("text-xs font-semibold rounded-full border px-2 py-0.5", pillTone)}>
            {(bucket.netPnl >= 0 ? "" : "-") + inrShort(Math.abs(bucket.netPnl))}
          </div>
          <div className="text-[11px] text-slate-500">
            {bucket.tradeCount} {bucket.tradeCount === 1 ? "trade" : "trades"} · {bucket.wins}W / {bucket.losses}L
          </div>
        </>
      ) : (
        <div className="text-[11px] text-slate-600">no trades</div>
      )}
    </div>
  );
}

// ---------- per-trade detail table ----------
const REASON_TONE: Record<TradeDetailRow["exitReason"], string> = {
  TARGET2_HIT: "bg-emerald-500/15 text-emerald-200 border-emerald-500/30",
  TARGET1_HIT: "bg-emerald-500/10 text-emerald-200 border-emerald-500/25",
  STOPPED:     "bg-rose-500/15 text-rose-200 border-rose-500/30",
  EXPIRED:     "bg-amber-500/10 text-amber-200 border-amber-500/30",
  MANUAL_OVERRIDE: "bg-slate-500/15 text-slate-200 border-slate-500/30",
};

function TradeDetailTable({ trades }: { trades: TradeDetailRow[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Trade detail</CardTitle>
        <CardDescription>
          Every closed paper trade in this month. R achieved =
          (exit − entry) ÷ |entry − stop| per share.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {trades.length === 0 ? (
          <div className="px-6 py-8 text-sm text-muted-foreground text-center">
            No closed trades in this month yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-400 bg-slate-900/40">
                <tr>
                  <Th>Date</Th>
                  <Th>Index</Th>
                  <Th>Setup</Th>
                  <Th>Side</Th>
                  <Th>Strike</Th>
                  <Th align="right">Lots</Th>
                  <Th align="right">Entry</Th>
                  <Th align="right">Exit</Th>
                  <Th align="right">Stop</Th>
                  <Th align="right">R achieved</Th>
                  <Th align="right">Gross P&amp;L</Th>
                  <Th align="right">Charges</Th>
                  <Th align="right">Net P&amp;L</Th>
                  <Th>Reason</Th>
                  <Th align="right">Held</Th>
                </tr>
              </thead>
              <tbody>
                {trades.map(t => <TradeRow key={t.id} t={t} />)}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th className={cn("px-3 py-2 font-medium", align === "right" && "text-right")}>{children}</th>;
}
function Td({ children, align = "left", tone }: {
  children: React.ReactNode; align?: "left" | "right"; tone?: "good" | "bad";
}) {
  return (
    <td className={cn(
      "px-3 py-2 whitespace-nowrap",
      align === "right" && "text-right tabular-nums",
      tone === "good" && "text-emerald-400",
      tone === "bad" && "text-rose-400",
    )}>{children}</td>
  );
}

function TradeRow({ t }: { t: TradeDetailRow }) {
  const dur = formatDuration(t.durationSec);
  const rTone = t.rMultiple > 0 ? "good" : t.rMultiple < 0 ? "bad" : undefined;
  const pnlTone = t.netPnl > 0 ? "good" : t.netPnl < 0 ? "bad" : undefined;
  return (
    <tr className="border-t border-slate-800/60">
      <Td>{t.signalDate}</Td>
      <Td>{t.indexSymbol}</Td>
      <Td>{t.setupKey}</Td>
      <Td>
        <Badge
          variant="outline"
          className={cn(
            "border",
            t.optionType === "CALL"
              ? "border-emerald-500/40 text-emerald-300"
              : "border-rose-500/40 text-rose-300",
          )}
        >
          {t.optionType}
        </Badge>
      </Td>
      <Td>{t.strike.toLocaleString("en-IN")}</Td>
      <Td align="right">{t.lots}</Td>
      <Td align="right">{t.entryPremium.toFixed(2)}</Td>
      <Td align="right">{t.exitPremium.toFixed(2)}</Td>
      <Td align="right">{t.stopPremium.toFixed(2)}</Td>
      <Td align="right" tone={rTone}>{t.rMultiple.toFixed(2)}R</Td>
      <Td align="right" tone={t.realizedPnl > 0 ? "good" : t.realizedPnl < 0 ? "bad" : undefined}>
        {inr0(t.realizedPnl)}
      </Td>
      <Td align="right" tone="bad">- {inr0(t.charges)}</Td>
      <Td align="right" tone={pnlTone}>{inr0(t.netPnl)}</Td>
      <Td>
        <span className={cn(
          "text-xs px-2 py-0.5 rounded-full border",
          REASON_TONE[t.exitReason],
        )}>
          {t.exitReason.replace("_HIT", "").replace("_OVERRIDE", "").replace("_", " ")}
        </span>
      </Td>
      <Td align="right" tone={undefined}>{dur}</Td>
    </tr>
  );
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm === 0 ? `${h}h` : `${h}h ${rm}m`;
}
