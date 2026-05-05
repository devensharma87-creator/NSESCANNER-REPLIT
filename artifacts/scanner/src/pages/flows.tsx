import { Fragment, useMemo, useState } from "react";
import { useGetFiiDii, useGetParticipantOi, getGetFiiDiiQueryKey, getGetParticipantOiQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ChevronDown, ChevronRight, TrendingUp, TrendingDown, Layers, Users, Building2, RefreshCw, Minus } from "lucide-react";
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

  // 5-day moving averages of the daily net flows. Trader rule of thumb:
  // a single day's print is noise — direction is set by the 5D average.
  // The `days` array arrives latest-first, so the 5-day window for index i
  // is `days[i .. i+4]` (today + previous 4 sessions). When fewer than 5
  // sessions are available (start of the dataset, weekends, holidays) we
  // return null so the UI renders an em-dash instead of a partial average
  // that would understate the smoothing.
  const ma5 = useMemo(() => {
    const out = new Map<string, { fii: number | null; dii: number | null }>();
    for (let i = 0; i < days.length; i++) {
      if (i + 5 > days.length) {
        out.set(days[i].date, { fii: null, dii: null });
        continue;
      }
      let f = 0, d = 0;
      for (let k = 0; k < 5; k++) {
        f += days[i + k].fiiNet;
        d += days[i + k].diiNet;
      }
      out.set(days[i].date, { fii: f / 5, dii: d / 5 });
    }
    return out;
  }, [days]);

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
                    <TableHead className="font-mono text-xs uppercase">Date</TableHead>
                    <TableHead className="font-mono text-xs uppercase text-right">FII Net Cr.</TableHead>
                    <TableHead
                      className="font-mono text-xs uppercase text-right"
                      title="FII 5-day moving average (₹ Cr) — smooths daily noise to reveal underlying foreign-flow direction. Sustained negative = persistent FII selling pressure."
                    >FII 5D MA</TableHead>
                    <TableHead className="font-mono text-xs uppercase text-right">DII Net Cr.</TableHead>
                    <TableHead
                      className="font-mono text-xs uppercase text-right"
                      title="DII 5-day moving average (₹ Cr) — domestic mutual-fund + insurance flows smoothed over a week."
                    >DII 5D MA</TableHead>
                    <TableHead className="font-mono text-xs uppercase text-right">Net (FII+DII)</TableHead>
                    <TableHead className="font-mono text-xs uppercase text-right">Nifty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {days.map(d => {
                    const net = d.fiiNet + d.diiNet;
                    const m = ma5.get(d.date);
                    return (
                    <TableRow key={d.date} className="border-border/20 hover:bg-muted/20">
                      <TableCell className="font-mono text-[11px] py-1.5 whitespace-nowrap">
                        {new Date(d.date).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "2-digit" })}
                      </TableCell>
                      <TableCell className={`font-mono text-[11px] text-right py-1.5 tabular-nums ${netClass(d.fiiNet)}`}>
                        {d.fiiNet.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className={`font-mono text-[11px] text-right py-1.5 tabular-nums italic ${m?.fii != null ? netClass(m.fii) : "text-muted-foreground/50"}`}>
                        {m?.fii != null ? m.fii.toLocaleString("en-IN", { maximumFractionDigits: 0 }) : "—"}
                      </TableCell>
                      <TableCell className={`font-mono text-[11px] text-right py-1.5 tabular-nums ${netClass(d.diiNet)}`}>
                        {d.diiNet.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className={`font-mono text-[11px] text-right py-1.5 tabular-nums italic ${m?.dii != null ? netClass(m.dii) : "text-muted-foreground/50"}`}>
                        {m?.dii != null ? m.dii.toLocaleString("en-IN", { maximumFractionDigits: 0 }) : "—"}
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
            <div className="lg:col-span-8 p-4 space-y-4">
              {/* NIFTY price */}
              <div>
                <div className="text-sm font-semibold font-mono uppercase tracking-wider px-1 mb-1" style={{ color: "#e2e8f0" }}>
                  NIFTY 50 — Daily Close
                </div>
                <div style={{ height: 220 }}>
                  <ResponsiveContainer>
                    <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                      <CartesianGrid stroke="#334155" strokeDasharray="2 4" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 12, fontFamily: "monospace", fill: "#cbd5e1" }} interval="preserveStartEnd" minTickGap={36} />
                      <YAxis domain={["auto", "auto"]} tick={{ fontSize: 12, fontFamily: "monospace", fill: "#cbd5e1" }} width={62} tickFormatter={v => (v as number).toLocaleString("en-IN")} />
                      <RTooltip contentStyle={{ background: "#0f172a", border: "1px solid #64748b", fontSize: 14, color: "#ffffff", fontFamily: "monospace", padding: "8px 12px", borderRadius: 6 }} labelStyle={{ color: "#e2e8f0", fontWeight: 600, fontSize: 14, marginBottom: 4 }} itemStyle={{ color: "#ffffff", fontSize: 14 }} formatter={(v) => (v == null ? "—" : (v as number).toLocaleString("en-IN"))} />
                      <Line type="monotone" dataKey="nifty" stroke="hsl(45 93% 58%)" strokeWidth={1.5} dot={false} connectNulls />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* FII Net */}
              <div>
                <div className="text-sm font-semibold font-mono uppercase tracking-wider px-1 mb-1" style={{ color: "#e2e8f0" }}>
                  FII Net (₹ Cr)
                </div>
                <div style={{ height: 180 }}>
                  <ResponsiveContainer>
                    <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                      <CartesianGrid stroke="#334155" strokeDasharray="2 4" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 12, fontFamily: "monospace", fill: "#cbd5e1" }} interval="preserveStartEnd" minTickGap={36} />
                      <YAxis tick={{ fontSize: 12, fontFamily: "monospace", fill: "#cbd5e1" }} width={62} tickFormatter={v => (v as number).toLocaleString("en-IN")} />
                      <RTooltip contentStyle={{ background: "#0f172a", border: "1px solid #64748b", fontSize: 14, color: "#ffffff", fontFamily: "monospace", padding: "8px 12px", borderRadius: 6 }} labelStyle={{ color: "#e2e8f0", fontWeight: 600, fontSize: 14, marginBottom: 4 }} itemStyle={{ color: "#ffffff", fontSize: 14 }} formatter={(v) => `₹${(v as number).toLocaleString("en-IN")} Cr`} />
                      <ReferenceLine y={0} stroke="#475569" />
                      <Bar dataKey="fii" name="FII">
                        {chartData.map((d, i) => (
                          <Cell key={i} fill={d.fii >= 0 ? "#22c55e" : "#ef4444"} />
                        ))}
                      </Bar>
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* DII Net */}
              <div>
                <div className="text-sm font-semibold font-mono uppercase tracking-wider px-1 mb-1" style={{ color: "#e2e8f0" }}>
                  DII Net (₹ Cr)
                </div>
                <div style={{ height: 180 }}>
                  <ResponsiveContainer>
                    <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                      <CartesianGrid stroke="#334155" strokeDasharray="2 4" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 12, fontFamily: "monospace", fill: "#cbd5e1" }} interval="preserveStartEnd" minTickGap={36} />
                      <YAxis tick={{ fontSize: 12, fontFamily: "monospace", fill: "#cbd5e1" }} width={62} tickFormatter={v => (v as number).toLocaleString("en-IN")} />
                      <RTooltip contentStyle={{ background: "#0f172a", border: "1px solid #64748b", fontSize: 14, color: "#ffffff", fontFamily: "monospace", padding: "8px 12px", borderRadius: 6 }} labelStyle={{ color: "#e2e8f0", fontWeight: 600, fontSize: 14, marginBottom: 4 }} itemStyle={{ color: "#ffffff", fontSize: 14 }} formatter={(v) => `₹${(v as number).toLocaleString("en-IN")} Cr`} />
                      <ReferenceLine y={0} stroke="#475569" />
                      <Bar dataKey="dii" name="DII">
                        {chartData.map((d, i) => (
                          <Cell key={i} fill={d.dii >= 0 ? "#22c55e" : "#ef4444"} />
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

/** Format a contract count with the Indian Lakh (L) / Crore (Cr) shorthand
 *  used by NSE-style trading dashboards. ≥1 Cr → "1.23 Cr", ≥1 L → "1.71 L",
 *  smaller values render with a thousands separator. Returns "—" for null. */
function fmtLakh(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}${(abs / 1e5).toFixed(2)} L`;
  return n.toLocaleString("en-IN");
}
/** Same as fmtLakh but with explicit "+" prefix for positive — used in the
 *  Change-OI column so direction is unambiguous at a glance. */
function fmtLakhSigned(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = fmtLakh(n);
  return n > 0 ? `+${s}` : s;
}

/* ── Per-segment Net OI: futures use long-short directly; options sum
   (CallLong + PutLong) - (CallShort + PutShort). Lifted out so both
   "today" and "previous day" rows go through the identical formula. */
type ParticipantRow = {
  clientType: string;
  futureIndexLong: number; futureIndexShort: number;
  futureStockLong: number; futureStockShort: number;
  optionIndexCallLong: number; optionIndexCallShort: number;
  optionIndexPutLong: number; optionIndexPutShort: number;
  optionStockCallLong: number; optionStockCallShort: number;
  optionStockPutLong: number; optionStockPutShort: number;
};
type SegmentKey = "indexFut" | "indexOpt" | "stockFut" | "stockOpt";

const SEGMENTS: { key: SegmentKey; label: string }[] = [
  { key: "indexFut", label: "Index Futures" },
  { key: "indexOpt", label: "Index Options" },
  { key: "stockFut", label: "Stock Futures" },
  { key: "stockOpt", label: "Stock Options" },
];
// Display order matches this tab's name (FII / DII first), then Pro, Client.
// FII = foreign institutional (smart money, the most-watched), DII = domestic
// institutional (counter-flow), Pro = proprietary brokers, Client = retail.
// Excludes the synthetic "TOTAL" row from the segment view since each cell is
// already a per-participant net.
const PARTICIPANT_DISPLAY: { key: string; label: string }[] = [
  { key: "FII", label: "FII" },
  { key: "DII", label: "DII" },
  { key: "Pro", label: "Pro" },
  { key: "Client", label: "Client" },
];

function netForSegment(r: ParticipantRow, seg: SegmentKey): number {
  switch (seg) {
    case "indexFut": return r.futureIndexLong - r.futureIndexShort;
    case "stockFut": return r.futureStockLong - r.futureStockShort;
    case "indexOpt":
      return (r.optionIndexCallLong + r.optionIndexPutLong)
           - (r.optionIndexCallShort + r.optionIndexPutShort);
    case "stockOpt":
      return (r.optionStockCallLong + r.optionStockPutLong)
           - (r.optionStockCallShort + r.optionStockPutShort);
  }
}

/* ── Stance classification: turns (net, change) into a human-readable
   tag + tone. The tone drives color so a trader can scan the whole grid
   at a glance and pick out where smart money is leaning vs unwinding.

   Convention used by NSE-style desks:
     • Net Long + adding         → bullish (trend strengthening)
     • Net Long + reducing       → neutral (profit-taking, not yet flipped)
     • Net Short + adding        → bearish
     • Net Short + covering      → neutral (relief, not yet bullish)
   Steady = |change| < 0.5% of |net|, so noise from rounding doesn't get
   labelled as momentum. Returns "unknown" tone when net itself is null. */
type StanceTone = "bull" | "bear" | "neutral" | "unknown";
type StanceInfo = { stance: string; momentum: string | null; tone: StanceTone };

function describeStance(net: number | null, change: number | null): StanceInfo {
  if (net == null) return { stance: "No data", momentum: null, tone: "unknown" };
  if (net === 0 && (change == null || change === 0)) {
    return { stance: "Flat", momentum: null, tone: "neutral" };
  }
  const stance = net > 0 ? "Net Long" : net < 0 ? "Net Short" : "Flat";
  const baseTone: StanceTone = net > 0 ? "bull" : net < 0 ? "bear" : "neutral";
  if (change == null) return { stance, momentum: null, tone: baseTone };
  const isSteady = Math.abs(change) < Math.max(1, Math.abs(net) * 0.005);
  if (isSteady) return { stance, momentum: "steady", tone: baseTone };
  if (net > 0 && change > 0) return { stance, momentum: "longs added", tone: "bull" };
  if (net > 0 && change < 0) return { stance, momentum: "longs trimmed", tone: "neutral" };
  if (net < 0 && change < 0) return { stance, momentum: "shorts added", tone: "bear" };
  if (net < 0 && change > 0) return { stance, momentum: "shorts covered", tone: "neutral" };
  if (net === 0 && change > 0) return { stance: "Building Long", momentum: null, tone: "bull" };
  if (net === 0 && change < 0) return { stance: "Building Short", momentum: null, tone: "bear" };
  return { stance, momentum: null, tone: baseTone };
}

const TONE_CLASSES: Record<StanceTone, { text: string; bg: string; border: string; dot: string }> = {
  bull:    { text: "text-signal-strong-buy",  bg: "bg-signal-strong-buy/10",  border: "border-signal-strong-buy/30",  dot: "bg-signal-strong-buy" },
  bear:    { text: "text-signal-strong-sell", bg: "bg-signal-strong-sell/10", border: "border-signal-strong-sell/30", dot: "bg-signal-strong-sell" },
  neutral: { text: "text-amber-400",          bg: "bg-amber-400/10",          border: "border-amber-400/30",          dot: "bg-amber-400" },
  unknown: { text: "text-muted-foreground",   bg: "bg-muted/20",              border: "border-border/40",             dot: "bg-muted-foreground" },
};

/* ── Per-participant overall MARKET STANCE.
   The single most-watched directional signal on Indian institutional desks
   is the Index-Futures Long/Short ratio: a participant who is heavily
   net-long Nifty/BankNifty futures is unambiguously betting on the market
   to go up; net-short means betting on a fall. Stock futures are
   bottom-up (stock-specific) so they say less about the overall market
   view, and options are often hedges, not directional bets — so we lean
   primarily on Index Futures and use Index Options as a confirmation.

   Score construction (range -100 … +100):
     • Index Futures: long%  (longs / (longs+shorts)) re-centered around
       50 and amplified ×2  →  contributes up to ±100, weight 0.7
     • Index Options: net delta-ish bias —
         (CallLong + PutShort) − (CallShort + PutLong)
       normalised by total option leg count ×100, weight 0.3
     • Combined score = 0.7 × futures + 0.3 × options
   Tags:
     score ≥ +35 → "Bullish"
     score ≥ +12 → "Mildly Bullish"
     score ≤ -35 → "Bearish"
     score ≤ -12 → "Mildly Bearish"
     otherwise   → "Neutral"
   When we have no Index Futures activity at all (e.g. Pro / Client edge
   cases) we return tone="unknown" rather than a fabricated zero. Day-over-
   day delta of the score is shown so a flip from bearish→bullish is
   immediately visible. */
type MarketStance = {
  tag: string;
  tone: StanceTone;
  score: number | null;
  scoreDelta: number | null;
  futLongPct: number | null;
  futNet: number;
  optBias: number | null;
  rationale: string;
};

function computeStanceScore(r: ParticipantRow): {
  score: number | null;
  futLongPct: number | null;
  futNet: number;
  optBias: number | null;
} {
  const fL = r.futureIndexLong;
  const fS = r.futureIndexShort;
  const futTotal = fL + fS;
  const futNet = fL - fS;
  const futLongPct = futTotal > 0 ? (fL / futTotal) * 100 : null;
  // Re-center around 50, amplify so ±50 → ±100 (a 0% or 100% long ratio
  // saturates at the extreme).
  const futScore = futLongPct != null ? Math.max(-100, Math.min(100, (futLongPct - 50) * 2)) : null;

  const cL = r.optionIndexCallLong;
  const cS = r.optionIndexCallShort;
  const pL = r.optionIndexPutLong;
  const pS = r.optionIndexPutShort;
  const optTotal = cL + cS + pL + pS;
  // Long calls and short puts are bullish exposure; short calls and long
  // puts are bearish exposure. The asymmetry vs total legs gives a
  // -100 … +100 reading.
  const optBias = optTotal > 0
    ? (((cL + pS) - (cS + pL)) / optTotal) * 100
    : null;

  let score: number | null = null;
  if (futScore != null && optBias != null) {
    score = 0.7 * futScore + 0.3 * optBias;
  } else if (futScore != null) {
    score = futScore;
  } else if (optBias != null) {
    score = optBias;
  }
  return { score, futLongPct, futNet, optBias };
}

function participantMarketStance(today: ParticipantRow | undefined, prev: ParticipantRow | undefined): MarketStance {
  if (!today) return { tag: "No data", tone: "unknown", score: null, scoreDelta: null, futLongPct: null, futNet: 0, optBias: null, rationale: "No participant data for this date." };
  const cur = computeStanceScore(today);
  const pr = prev ? computeStanceScore(prev) : null;
  const score = cur.score;
  if (score == null) {
    return { tag: "No data", tone: "unknown", score: null, scoreDelta: null, futLongPct: null, futNet: 0, optBias: null, rationale: "No index futures or options activity on this date." };
  }
  const scoreDelta = (pr && pr.score != null) ? score - pr.score : null;

  let tag: string;
  let tone: StanceTone;
  if (score >= 35)        { tag = "Bullish";         tone = "bull"; }
  else if (score >= 12)   { tag = "Mildly Bullish";  tone = "bull"; }
  else if (score <= -35)  { tag = "Bearish";         tone = "bear"; }
  else if (score <= -12)  { tag = "Mildly Bearish";  tone = "bear"; }
  else                    { tag = "Neutral";         tone = "neutral"; }

  const futStr = cur.futLongPct != null
    ? `Index Futures ${cur.futLongPct.toFixed(0)}% long (net ${cur.futNet >= 0 ? "+" : ""}${fmtLakh(cur.futNet)})`
    : "No index-futures activity";
  const optStr = cur.optBias != null
    ? `Index Options bias ${cur.optBias >= 0 ? "+" : ""}${cur.optBias.toFixed(0)}`
    : "No index-options activity";
  const trendStr = scoreDelta == null
    ? ""
    : Math.abs(scoreDelta) < 3
      ? " · stance unchanged from prev day"
      : ` · ${scoreDelta > 0 ? "shifting more bullish" : "shifting more bearish"} vs prev day`;
  const rationale = `${futStr}; ${optStr}${trendStr}.`;

  return { tag, tone, score, scoreDelta, futLongPct: cur.futLongPct, futNet: cur.futNet, optBias: cur.optBias, rationale };
}

/* ── Centered diverging bar — left half fills red for shorts, right half
   fills green for longs. Width is proportional to |value| / max so all
   four participants in a card are visually comparable to each other but
   not across cards (each card normalizes to its own segment max). */
function BarVis({ value, max }: { value: number | null; max: number }) {
  const halfPct = (value != null && max > 0)
    ? Math.min(100, (Math.abs(value) / max) * 100) / 2
    : 0;
  return (
    <div className="h-1.5 w-full bg-muted/15 rounded relative overflow-hidden">
      <div className="absolute top-0 bottom-0 w-px bg-border/60 z-[1]" style={{ left: "50%" }} />
      {value != null && value > 0 && (
        <div className="absolute top-0 bottom-0 bg-signal-strong-buy/70" style={{ left: "50%", width: `${halfPct}%` }} />
      )}
      {value != null && value < 0 && (
        <div className="absolute top-0 bottom-0 bg-signal-strong-sell/70" style={{ right: "50%", width: `${halfPct}%` }} />
      )}
    </div>
  );
}

/* ── Top-of-section MARKET STANCE strip: 4 large tiles, one per
   participant (FII / DII / Pro / Client). Each tile shows the
   participant's overall directional view of the market — Bullish /
   Mildly Bullish / Neutral / Mildly Bearish / Bearish — derived primarily
   from the Index Futures Long/Short ratio (the textbook directional
   signal on Indian desks) and confirmed by Index Options bias. Day-over-
   day delta of the stance score is shown when previous-day data exists
   so a regime flip is immediately visible. Below the tag we surface the
   key supporting numbers (Index Futures long%, net contracts) and a
   plain-English rationale so the trader doesn't have to reverse-engineer
   the verdict. */
function ParticipantStanceStrip({
  todayByParticipant,
  prevByParticipant,
  hasPrev,
}: {
  todayByParticipant: Map<string, ParticipantRow>;
  prevByParticipant: Map<string, ParticipantRow>;
  hasPrev: boolean;
}) {
  return (
    <div className="px-4 pt-3 pb-1">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
        <TrendingUp className="h-3 w-3" />
        Market stance by participant {hasPrev ? "· change vs prev day" : "(no comparison — oldest record)"}
      </div>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
        {PARTICIPANT_DISPLAY.map(p => {
          const today = todayByParticipant.get(p.key);
          const prev = prevByParticipant.get(p.key);
          const stance = participantMarketStance(today, prev);
          const tone = TONE_CLASSES[stance.tone];
          const Icon = stance.tone === "bull" ? TrendingUp : stance.tone === "bear" ? TrendingDown : Minus;
          return (
            <div key={p.key} className={`border ${tone.border} ${tone.bg} rounded px-3 py-2`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-bold uppercase tracking-wider">{p.label}</span>
                <span className={`inline-flex items-center gap-1 text-[10px] font-mono font-semibold ${tone.text} shrink-0`}>
                  <Icon className="h-3 w-3" />
                  {stance.tag}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2 mt-1.5">
                <span className={`font-mono text-lg font-bold ${tone.text}`}>
                  {stance.futLongPct != null ? `${stance.futLongPct.toFixed(0)}%` : "—"}
                </span>
                <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">
                  IdxFut Long
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-0.5">
                <span className="text-[9px] font-mono text-muted-foreground">
                  Score {stance.score != null ? `${stance.score >= 0 ? "+" : ""}${stance.score.toFixed(0)}` : "—"}
                </span>
                <span className={`text-[9px] font-mono ${stance.scoreDelta == null ? "text-muted-foreground/60" : netClass(stance.scoreDelta)}`}>
                  {stance.scoreDelta == null
                    ? "—"
                    : `${stance.scoreDelta >= 0 ? "+" : ""}${stance.scoreDelta.toFixed(0)} d/d`}
                </span>
              </div>
              <div className="text-[9px] font-mono text-muted-foreground/80 mt-1.5 leading-snug" title={stance.rationale}>
                {stance.rationale}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Per-segment card: 4 participants with name, net contracts, day-over-day
   change, and a centered diverging bar showing relative position size within
   the segment. Footer shows Σ across participants — should be ~0 since every
   long has a short, so a non-zero Σ is a data-integrity yellow flag and is
   colored amber when it deviates noticeably from balance. */
function SegmentCard({
  segment,
  todayByParticipant,
  prevByParticipant,
}: {
  segment: { key: SegmentKey; label: string };
  todayByParticipant: Map<string, ParticipantRow>;
  prevByParticipant: Map<string, ParticipantRow>;
}) {
  const parts = PARTICIPANT_DISPLAY.map(p => {
    const today = todayByParticipant.get(p.key);
    const prev = prevByParticipant.get(p.key);
    const net = today ? netForSegment(today, segment.key) : null;
    const netPrev = prev ? netForSegment(prev, segment.key) : null;
    const change = (net != null && netPrev != null) ? net - netPrev : null;
    return { ...p, net, change, info: describeStance(net, change) };
  });
  const maxAbsNet = Math.max(0, ...parts.map(p => p.net != null ? Math.abs(p.net) : 0));
  // Σ across all 4 — in healthy NSE participant data this nets to ~0 because
  // every long contract has a corresponding short contract somewhere in the
  // FII/Pro/Client/DII universe. Treat |Σ| > 0.5% of segment activity as a
  // data-integrity yellow flag.
  const knownNets = parts.filter(p => p.net != null).map(p => p.net as number);
  const sigma = knownNets.length === parts.length ? knownNets.reduce((s, n) => s + n, 0) : null;
  const totalActivity = knownNets.reduce((s, n) => s + Math.abs(n), 0);
  const sigmaImbalanced = sigma != null && totalActivity > 0 && Math.abs(sigma) > totalActivity * 0.005;

  return (
    <div className="border border-border/40 rounded-md bg-muted/[0.04] p-3 hover:bg-muted/[0.08] transition-colors">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Layers className="h-3.5 w-3.5 text-signal-strong-buy" />
          <span className="font-mono text-xs uppercase tracking-wider font-semibold">{segment.label}</span>
        </div>
        <span
          className={`text-[9px] font-mono ${sigmaImbalanced ? "text-amber-400" : "text-muted-foreground/70"}`}
          title="Σ Net OI across FII + Pro + Client + DII. In a balanced market this is ≈ 0 because every long has a matching short. A non-zero value here is a data-integrity hint."
        >
          Σ {fmtLakhSigned(sigma)}
        </span>
      </div>
      <div className="space-y-2.5">
        {parts.map(p => {
          const tone = TONE_CLASSES[p.info.tone];
          return (
            <div key={p.key} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-xs font-mono">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span className={`h-1.5 w-1.5 rounded-full ${tone.dot} shrink-0`} />
                  <span className="font-semibold w-12 shrink-0">{p.label}</span>
                  <span className={`${tone.text} truncate`}>{fmtLakh(p.net)}</span>
                </div>
                <div className="flex items-baseline gap-2 shrink-0">
                  {p.info.momentum && (
                    <span className={`text-[9px] uppercase tracking-wider ${tone.text} opacity-80 hidden sm:inline`}>
                      {p.info.momentum}
                    </span>
                  )}
                  <span className={`text-[10px] ${p.change == null ? "text-muted-foreground" : netClass(p.change)}`}>
                    {fmtLakhSigned(p.change)}
                  </span>
                </div>
              </div>
              <BarVis value={p.net} max={maxAbsNet} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ParticipantOiSection() {
  const [date, setDate] = useState<string | undefined>(undefined);
  const [view, setView] = useState<"segment" | "detail">("segment");
  const { data, isLoading, refetch, isFetching } = useGetParticipantOi(
    date ? { date } : {},
    { query: { refetchInterval: 5 * 60 * 1000, queryKey: getGetParticipantOiQueryKey(date ? { date } : {}) } },
  );

  const rows = data?.rows ?? [];
  const previousRows = data?.previousRows ?? [];
  const availableDates = data?.availableDates ?? [];
  const currentDate = data?.date ?? null;
  const previousDate = data?.previousDate ?? null;

  // Index by participant name for O(1) lookup in the segment grid. Both today
  // and previous-day are indexed the same way — the segment view tolerates a
  // missing previous row (renders Prev/Change as "—") rather than fabricating.
  const todayByParticipant = useMemo(() => {
    const m = new Map<string, ParticipantRow>();
    for (const r of rows) m.set(r.clientType, r as ParticipantRow);
    return m;
  }, [rows]);
  const prevByParticipant = useMemo(() => {
    const m = new Map<string, ParticipantRow>();
    for (const r of previousRows) m.set(r.clientType, r as ParticipantRow);
    return m;
  }, [previousRows]);

  return (
    <Card>
      <CardHeader className="pb-3 flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-base font-mono uppercase tracking-wider">
            <Users className="h-4 w-4 text-signal-strong-buy" />
            Participant-wise Open Interest
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1 font-mono">
            Net OI by segment and participant. Source: NSE F&amp;O participant-wise OI archive.
            {currentDate && <> · As of <span className="text-foreground">{fmtDate(currentDate)}</span></>}
            {previousDate && view === "segment" && <> · Prev <span className="text-foreground">{fmtDate(previousDate)}</span></>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* Analysis / Detail view switch — Analysis is the default rich
              card layout (insight strip + per-segment cards with magnitude
              bars), Detail keeps the wide per-leg long/short table for
              power users who want raw call/put breakdowns. */}
          <div className="inline-flex border border-border rounded overflow-hidden">
            <button
              type="button"
              onClick={() => setView("segment")}
              className={`px-2 py-1 text-[10px] font-mono uppercase tracking-wider ${view === "segment" ? "bg-signal-strong-buy/20 text-signal-strong-buy" : "text-muted-foreground hover:bg-muted/40"}`}
            >Analysis</button>
            <button
              type="button"
              onClick={() => setView("detail")}
              className={`px-2 py-1 text-[10px] font-mono uppercase tracking-wider border-l border-border ${view === "detail" ? "bg-signal-strong-buy/20 text-signal-strong-buy" : "text-muted-foreground hover:bg-muted/40"}`}
            >Long/Short Detail</button>
          </div>
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
      <CardContent className={`p-0 ${view === "detail" ? "overflow-x-auto" : ""}`}>
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground font-mono">
            No participant OI data yet. Background fetch is running — try refreshing in a few seconds.
          </div>
        ) : view === "segment" ? (
          /* ── Analysis View — insight strip + 2×2 segment cards ──────────
             Top: FII positioning across all four segments, the most-watched
             smart-money signal, with stance + day-over-day change + a
             one-word momentum tag. Below: per-segment cards with all four
             participants, each with a centered diverging bar (red-left for
             shorts, green-right for longs) sized relative to the segment's
             largest position. Footer per card shows Σ Net across all four —
             a sanity check that should net to ~0 in healthy data, since
             every long must have a matching short. */
          <div>
            <ParticipantStanceStrip
              todayByParticipant={todayByParticipant}
              prevByParticipant={prevByParticipant}
              hasPrev={previousDate != null}
            />
            <div className="px-4 pt-3 pb-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {SEGMENTS.map(seg => (
                  <SegmentCard
                    key={seg.key}
                    segment={seg}
                    todayByParticipant={todayByParticipant}
                    prevByParticipant={prevByParticipant}
                  />
                ))}
              </div>
              <div className="text-[9px] font-mono text-muted-foreground/70 mt-3 leading-relaxed">
                <strong className="text-muted-foreground">How to read:</strong> Top strip = each participant's overall market stance, derived from Index Futures Long% (primary signal) + Index Options bias.
                Bullish ≥ 35 score, Bearish ≤ −35, in-between is mildly directional or neutral. Cards below = position breakdown by segment ·
                Bar = relative size within segment · Green right = net long, red left = net short · Σ row = sum across FII + Pro + Client + DII (≈ 0 in balanced data).
              </div>
            </div>
          </div>
        ) : (
          <Table className="min-w-[1320px]">
            <TableHeader>
              <TableRow className="border-border/40">
                <TableHead className="font-mono text-[10px] uppercase">Participant</TableHead>
                <TableHead className="font-mono text-[10px] uppercase">Market Stance</TableHead>
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
              {rows.map(r => {
                const stance = participantMarketStance(
                  todayByParticipant.get(r.clientType),
                  prevByParticipant.get(r.clientType),
                );
                const stanceTone = TONE_CLASSES[stance.tone];
                return (
                <TableRow key={r.clientType} className="border-border/30 hover:bg-muted/30">
                  <TableCell className="font-mono font-semibold py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <Layers className="h-3 w-3 text-muted-foreground" />
                      {r.clientType}
                    </span>
                  </TableCell>
                  <TableCell className="py-2">
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${stanceTone.border} ${stanceTone.bg} ${stanceTone.text} font-mono text-[10px] font-semibold`}
                      title={stance.rationale}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${stanceTone.dot}`} />
                      {stance.tag}
                      {stance.futLongPct != null && (
                        <span className="text-muted-foreground/80 font-normal ml-1">
                          ({stance.futLongPct.toFixed(0)}% long)
                        </span>
                      )}
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
                );
              })}
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
