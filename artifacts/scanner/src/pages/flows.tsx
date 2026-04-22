import { Fragment, useMemo, useState } from "react";
import { useGetFiiDii, useGetParticipantOi, getGetFiiDiiQueryKey, getGetParticipantOiQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ChevronDown, ChevronRight, TrendingUp, TrendingDown, Layers, Users, Building2, RefreshCw } from "lucide-react";
import {
  ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis, Tooltip as RTooltip,
  CartesianGrid, ReferenceLine, Cell,
} from "recharts";

/* ───────────────────────── helpers ───────────────────────── */

function fmtCr(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(2)}K Cr`;
  return `${sign}₹${abs.toFixed(2)} Cr`;
}

function fmtInt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN");
}

function fmtSignedInt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const s = n.toLocaleString("en-IN");
  return n > 0 ? `+${s}` : s;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function netClass(n: number): string {
  if (n > 0) return "text-signal-strong-buy font-mono";
  if (n < 0) return "text-signal-strong-sell font-mono";
  return "text-muted-foreground font-mono";
}

/* ───────────────────────── FII/DII section ───────────────────────── */

/* ── StockMojo-style daily view: table left + chart right ── */
function FiiDiiCashMarketView({
  days, isLoading, refetch, isFetching,
}: {
  days: Array<{ date: string; fiiNet: number; diiNet: number; niftyClose?: number | null; niftyChangePct?: number | null }>;
  isLoading: boolean;
  refetch: () => void;
  isFetching: boolean;
}) {
  // Chart data: chronological (oldest → newest)
  const chartData = useMemo(
    () => [...days].sort((a, b) => (a.date < b.date ? -1 : 1)).map(d => ({
      date: d.date.slice(5), // MM-DD
      nifty: d.niftyClose ?? null,
      fii: d.fiiNet,
      dii: d.diiNet,
    })),
    [days],
  );

  return (
    <Card>
      <CardHeader className="pb-3 flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base font-mono uppercase tracking-wider">
            <Building2 className="h-4 w-4 text-signal-strong-buy" />
            FII / DII Cash Market — Daily
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1 font-mono">
            Daily net buy/sell (₹ Cr) with Nifty 50 close. Latest first in table; chart shows oldest → newest.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={refetch} disabled={isFetching} className="font-mono text-xs h-8">
          <RefreshCw className={`h-3 w-3 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-3">
            <Skeleton className="lg:col-span-4 h-[600px]" />
            <Skeleton className="lg:col-span-8 h-[600px]" />
          </div>
        ) : days.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground font-mono">No FII/DII data yet.</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 border-t border-border/40">
            {/* LEFT: scrollable table */}
            <div className="lg:col-span-4 border-r border-border/40 max-h-[640px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow className="border-border/40">
                    <TableHead className="font-mono text-[10px] uppercase">Date</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase text-right">FII Net Cr.</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase text-right">DII Net Cr.</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase text-right">Net (FII−DII)</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase text-right">Nifty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {days.map(d => {
                    const net = d.fiiNet - d.diiNet;
                    return (
                    <TableRow key={d.date} className="border-border/20 hover:bg-muted/20">
                      <TableCell className="font-mono text-[11px] py-1.5 whitespace-nowrap">
                        {new Date(d.date).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "2-digit" })}
                      </TableCell>
                      <TableCell className={`font-mono text-[11px] text-right py-1.5 tabular-nums ${netClass(d.fiiNet)}`}>
                        {d.fiiNet.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className={`font-mono text-[11px] text-right py-1.5 tabular-nums ${netClass(d.diiNet)}`}>
                        {d.diiNet.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className={`font-mono text-[11px] text-right py-1.5 tabular-nums font-semibold ${netClass(net)}`}>
                        {net >= 0 ? "+" : ""}{net.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-right py-1.5 tabular-nums">
                        {d.niftyClose != null ? d.niftyClose.toLocaleString("en-IN", { maximumFractionDigits: 1 }) : "—"}
                        {d.niftyChangePct != null && (
                          <span className={`ml-1 text-[9px] ${netClass(d.niftyChangePct)}`}>
                            ({d.niftyChangePct >= 0 ? "+" : ""}{d.niftyChangePct.toFixed(2)}%)
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* RIGHT: stacked charts (Nifty top, FII middle, DII bottom) */}
            <div className="lg:col-span-8 p-3 space-y-2">
              {/* NIFTY price */}
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground px-1 mb-0.5">
                  NIFTY 50 — Daily Close
                </div>
                <div style={{ height: 220 }}>
                  <ResponsiveContainer>
                    <ComposedChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }} interval="preserveStartEnd" minTickGap={28} />
                      <YAxis domain={["auto", "auto"]} tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }} width={52} tickFormatter={v => (v as number).toLocaleString("en-IN")} />
                      <RTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }} formatter={(v) => (v == null ? "—" : (v as number).toLocaleString("en-IN"))} />
                      <Line type="monotone" dataKey="nifty" stroke="hsl(45 93% 58%)" strokeWidth={1.5} dot={false} connectNulls />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* FII Net */}
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground px-1 mb-0.5">
                  FII Net (₹ Cr)
                </div>
                <div style={{ height: 160 }}>
                  <ResponsiveContainer>
                    <ComposedChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }} interval="preserveStartEnd" minTickGap={28} />
                      <YAxis tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }} width={52} tickFormatter={v => (v as number).toLocaleString("en-IN")} />
                      <RTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }} formatter={(v) => `₹${(v as number).toLocaleString("en-IN")} Cr`} />
                      <ReferenceLine y={0} stroke="hsl(var(--border))" />
                      <Bar dataKey="fii">
                        {chartData.map((d, i) => (
                          <Cell key={i} fill={d.fii >= 0 ? "hsl(var(--signal-strong-buy))" : "hsl(var(--signal-strong-sell))"} />
                        ))}
                      </Bar>
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* DII Net */}
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground px-1 mb-0.5">
                  DII Net (₹ Cr)
                </div>
                <div style={{ height: 160 }}>
                  <ResponsiveContainer>
                    <ComposedChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }} interval="preserveStartEnd" minTickGap={28} />
                      <YAxis tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }} width={52} tickFormatter={v => (v as number).toLocaleString("en-IN")} />
                      <RTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }} formatter={(v) => `₹${(v as number).toLocaleString("en-IN")} Cr`} />
                      <ReferenceLine y={0} stroke="hsl(var(--border))" />
                      <Bar dataKey="dii">
                        {chartData.map((d, i) => (
                          <Cell key={i} fill={d.dii >= 0 ? "hsl(var(--signal-strong-buy))" : "hsl(var(--signal-strong-sell))"} />
                        ))}
                      </Bar>
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FiiDiiSection() {
  const [view, setView] = useState<"chart" | "monthly">("chart");
  const { data, isLoading, refetch, isFetching } = useGetFiiDii(
    { months: 12 },
    { query: { refetchInterval: 5 * 60 * 1000, queryKey: getGetFiiDiiQueryKey({ months: 12 }) } },
  );
  const months = data?.months ?? [];
  const [openMonth, setOpenMonth] = useState<string | null>(months[0]?.month ?? null);

  // Default the first month open as soon as data arrives.
  if (!openMonth && months[0]) setOpenMonth(months[0].month);

  // Flat days array (latest first) for the cash-market chart view
  const allDays = useMemo(
    () => months.flatMap(m => m.days).sort((a, b) => (a.date < b.date ? 1 : -1)),
    [months],
  );

  if (view === "chart") {
    return (
      <div className="space-y-3">
        <div className="flex gap-2">
          <Button size="sm" variant="default" onClick={() => setView("chart")} className="font-mono text-xs h-8">FII/DII Cash Market</Button>
          <Button size="sm" variant="outline" onClick={() => setView("monthly")} className="font-mono text-xs h-8">Monthly Aggregates</Button>
        </div>
        <FiiDiiCashMarketView days={allDays} isLoading={isLoading} refetch={() => refetch()} isFetching={isFetching} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setView("chart")} className="font-mono text-xs h-8">FII/DII Cash Market</Button>
        <Button size="sm" variant="default" onClick={() => setView("monthly")} className="font-mono text-xs h-8">Monthly Aggregates</Button>
      </div>
      {(() => (
    <Card>
      <CardHeader className="pb-3 flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base font-mono uppercase tracking-wider">
            <Building2 className="h-4 w-4 text-signal-strong-buy" />
            FII / DII Cash — Monthly + Daily
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1 font-mono">
            Buy / Sell / Net values in ₹ crore. Click a month to expand the daily breakdown.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} className="font-mono text-xs h-8">
          <RefreshCw className={`h-3 w-3 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
          </div>
        ) : months.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground font-mono">
            No FII/DII data yet. Background fetch is running — try refreshing in a few seconds.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-border/40">
                <TableHead className="w-8" />
                <TableHead className="font-mono text-[10px] uppercase tracking-wider">Month</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-wider">Days</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-wider text-right">FII Buy</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-wider text-right">FII Sell</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-wider text-right">FII Net</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-wider text-right">DII Buy</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-wider text-right">DII Sell</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-wider text-right">DII Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {months.map(m => {
                const open = openMonth === m.month;
                return (
                  <Fragment key={m.month}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/30 border-border/40"
                      onClick={() => setOpenMonth(open ? null : m.month)}
                    >
                      <TableCell className="py-2">
                        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      </TableCell>
                      <TableCell className="font-mono font-semibold py-2">{m.label}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground py-2">{m.daysCount}d</TableCell>
                      <TableCell className="font-mono text-right py-2">{fmtCr(m.fiiBuy)}</TableCell>
                      <TableCell className="font-mono text-right py-2">{fmtCr(m.fiiSell)}</TableCell>
                      <TableCell className={`text-right py-2 font-semibold ${netClass(m.fiiNet)}`}>
                        <span className="inline-flex items-center gap-1 justify-end">
                          {m.fiiNet >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                          {fmtCr(m.fiiNet)}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-right py-2">{fmtCr(m.diiBuy)}</TableCell>
                      <TableCell className="font-mono text-right py-2">{fmtCr(m.diiSell)}</TableCell>
                      <TableCell className={`text-right py-2 font-semibold ${netClass(m.diiNet)}`}>
                        <span className="inline-flex items-center gap-1 justify-end">
                          {m.diiNet >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                          {fmtCr(m.diiNet)}
                        </span>
                      </TableCell>
                    </TableRow>
                    {open && (
                      <TableRow className="bg-muted/10">
                        <TableCell colSpan={9} className="p-0">
                          <div className="px-4 py-3">
                            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                              Daily breakdown · {m.label}
                            </div>
                            <Table>
                              <TableHeader>
                                <TableRow className="border-border/30">
                                  <TableHead className="font-mono text-[10px] uppercase">Date</TableHead>
                                  <TableHead className="font-mono text-[10px] uppercase text-right">FII Buy</TableHead>
                                  <TableHead className="font-mono text-[10px] uppercase text-right">FII Sell</TableHead>
                                  <TableHead className="font-mono text-[10px] uppercase text-right">FII Net</TableHead>
                                  <TableHead className="font-mono text-[10px] uppercase text-right">DII Buy</TableHead>
                                  <TableHead className="font-mono text-[10px] uppercase text-right">DII Sell</TableHead>
                                  <TableHead className="font-mono text-[10px] uppercase text-right">DII Net</TableHead>
                                  <TableHead className="font-mono text-[10px] uppercase text-right">Source</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {m.days.map(d => (
                                  <TableRow key={d.date} className="border-border/20">
                                    <TableCell className="font-mono text-xs py-1.5">{fmtDate(d.date)}</TableCell>
                                    <TableCell className="font-mono text-xs text-right py-1.5">{d.fiiBuy ? fmtCr(d.fiiBuy) : "—"}</TableCell>
                                    <TableCell className="font-mono text-xs text-right py-1.5">{d.fiiSell ? fmtCr(d.fiiSell) : "—"}</TableCell>
                                    <TableCell className={`text-xs text-right py-1.5 ${netClass(d.fiiNet)}`}>{fmtCr(d.fiiNet)}</TableCell>
                                    <TableCell className="font-mono text-xs text-right py-1.5">{d.diiBuy ? fmtCr(d.diiBuy) : "—"}</TableCell>
                                    <TableCell className="font-mono text-xs text-right py-1.5">{d.diiSell ? fmtCr(d.diiSell) : "—"}</TableCell>
                                    <TableCell className={`text-xs text-right py-1.5 ${netClass(d.diiNet)}`}>{fmtCr(d.diiNet)}</TableCell>
                                    <TableCell className="text-xs text-right py-1.5">
                                      <Badge variant="outline" className="font-mono text-[9px] uppercase">{d.source}</Badge>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
      ))()}
    </div>
  );
}

/* ───────────────────────── Participant OI section ───────────────────────── */

function ParticipantOiSection() {
  const [date, setDate] = useState<string | undefined>(undefined);
  const { data, isLoading, refetch, isFetching } = useGetParticipantOi(
    date ? { date } : {},
    { query: { refetchInterval: 5 * 60 * 1000, queryKey: getGetParticipantOiQueryKey(date ? { date } : {}) } },
  );

  const rows = data?.rows ?? [];
  const availableDates = data?.availableDates ?? [];
  const currentDate = data?.date ?? null;

  return (
    <Card>
      <CardHeader className="pb-3 flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-base font-mono uppercase tracking-wider">
            <Users className="h-4 w-4 text-signal-strong-buy" />
            Participant-wise Open Interest
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1 font-mono">
            Daily OI in number of contracts across Index / Stock Futures and Options for each participant category.
            {currentDate && <> · As of <span className="text-foreground">{fmtDate(currentDate)}</span></>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {availableDates.length > 0 && (
            <select
              value={date ?? availableDates[0]}
              onChange={e => setDate(e.target.value)}
              className="bg-card border border-border rounded px-2 py-1 text-xs font-mono"
            >
              {availableDates.map(d => (
                <option key={d} value={d}>{fmtDate(d)}</option>
              ))}
            </select>
          )}
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} className="font-mono text-xs h-8">
            <RefreshCw className={`h-3 w-3 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground font-mono">
            No participant OI data yet. Background fetch is running — try refreshing in a few seconds.
          </div>
        ) : (
          <Table className="min-w-[1200px]">
            <TableHeader>
              <TableRow className="border-border/40">
                <TableHead className="font-mono text-[10px] uppercase">Participant</TableHead>
                <TableHead className="font-mono text-[10px] uppercase text-right">Fut Idx Long</TableHead>
                <TableHead className="font-mono text-[10px] uppercase text-right">Fut Idx Short</TableHead>
                <TableHead className="font-mono text-[10px] uppercase text-right">Fut Idx Net</TableHead>
                <TableHead className="font-mono text-[10px] uppercase text-right">Fut Stk Net</TableHead>
                <TableHead className="font-mono text-[10px] uppercase text-right">Idx Call L/S</TableHead>
                <TableHead className="font-mono text-[10px] uppercase text-right">Idx Put L/S</TableHead>
                <TableHead className="font-mono text-[10px] uppercase text-right">Stk Call L/S</TableHead>
                <TableHead className="font-mono text-[10px] uppercase text-right">Stk Put L/S</TableHead>
                <TableHead className="font-mono text-[10px] uppercase text-right">Total Long</TableHead>
                <TableHead className="font-mono text-[10px] uppercase text-right">Total Short</TableHead>
                <TableHead className="font-mono text-[10px] uppercase text-right">Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.clientType} className="border-border/30 hover:bg-muted/30">
                  <TableCell className="font-mono font-semibold py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <Layers className="h-3 w-3 text-muted-foreground" />
                      {r.clientType}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-right py-2">{fmtInt(r.futureIndexLong)}</TableCell>
                  <TableCell className="font-mono text-xs text-right py-2">{fmtInt(r.futureIndexShort)}</TableCell>
                  <TableCell className={`text-xs text-right py-2 font-semibold ${netClass(r.futureIndexNet)}`}>{fmtSignedInt(r.futureIndexNet)}</TableCell>
                  <TableCell className={`text-xs text-right py-2 font-semibold ${netClass(r.futureStockNet)}`}>{fmtSignedInt(r.futureStockNet)}</TableCell>
                  <TableCell className="font-mono text-xs text-right py-2 text-muted-foreground">
                    {fmtInt(r.optionIndexCallLong)} / {fmtInt(r.optionIndexCallShort)}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-right py-2 text-muted-foreground">
                    {fmtInt(r.optionIndexPutLong)} / {fmtInt(r.optionIndexPutShort)}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-right py-2 text-muted-foreground">
                    {fmtInt(r.optionStockCallLong)} / {fmtInt(r.optionStockCallShort)}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-right py-2 text-muted-foreground">
                    {fmtInt(r.optionStockPutLong)} / {fmtInt(r.optionStockPutShort)}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-right py-2">{fmtInt(r.totalLongContracts)}</TableCell>
                  <TableCell className="font-mono text-xs text-right py-2">{fmtInt(r.totalShortContracts)}</TableCell>
                  <TableCell className={`text-xs text-right py-2 font-bold ${netClass(r.netContracts)}`}>{fmtSignedInt(r.netContracts)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* ───────────────────────── page ───────────────────────── */

export default function FlowsPage() {
  return (
    <div className="space-y-4 px-4 py-3">
      <div>
        <h1 className="text-lg font-bold font-mono uppercase tracking-wider flex items-center gap-2">
          <Building2 className="h-5 w-5 text-signal-strong-buy" />
          Institutional Flows
        </h1>
        <p className="text-xs text-muted-foreground mt-1 font-mono">
          FII / DII cash market activity (₹ Cr) and participant-wise derivative open interest. Sourced from NSE archives + niftytrader history; refreshed every 15 minutes.
        </p>
      </div>

      <FiiDiiSection />
      <ParticipantOiSection />

      <p className="text-xs text-muted-foreground border-t border-border/40 pt-3 font-mono">
        FII/DII values are provisional cash market figures published by NSE end-of-day. Participant OI is sourced from
        NSE's daily F&amp;O participant-wise OI archive. Older daily entries may show only Net values when sourced from history APIs.
      </p>
    </div>
  );
}
