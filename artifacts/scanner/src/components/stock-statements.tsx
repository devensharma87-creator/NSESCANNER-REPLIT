import { useGetStockStatements, getGetStockStatementsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid, Cell,
  LineChart, Line, Legend, PieChart, Pie,
} from "recharts";
import { KiteOfflineNote } from "@/components/kite-offline-banner";

function fmtCr(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 100000) return `${(n / 100000).toFixed(2)} L`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(2)}k`;
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
function fmtPct(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}%`;
}
function fmtNum(n?: number | null, d = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(d);
}
function tone(n?: number) {
  if (n == null) return "";
  return n >= 0 ? "text-signal-strong-buy" : "text-signal-strong-sell";
}

/* Generic table-with-bar-chart pivot: rows = metrics, cols = periods */
function PivotTable({
  rows, periods, fmt = fmtCr,
}: {
  rows: Array<{ label: string; values: Array<number | undefined>; bold?: boolean }>;
  periods: string[];
  fmt?: (n?: number) => string;
}) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent border-border">
            <TableHead className="font-mono text-[11px] uppercase sticky left-0 bg-card z-10">Metric</TableHead>
            {periods.map(p => (
              <TableHead key={p} className="font-mono text-[11px] uppercase text-right whitespace-nowrap">{p}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(row => (
            <TableRow key={row.label} className="border-border/50">
              <TableCell className={`font-mono text-xs sticky left-0 bg-card/95 z-10 ${row.bold ? "font-bold" : ""}`}>{row.label}</TableCell>
              {row.values.map((v, i) => (
                <TableCell key={i} className={`text-right font-mono text-xs tabular-nums whitespace-nowrap ${row.bold ? "font-bold" : ""}`}>
                  {fmt(v)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function MiniBarChart({ data, dataKey, color = "hsl(var(--signal-strong-buy))", height = 180 }: {
  data: Array<Record<string, string | number | undefined>>;
  dataKey: string;
  color?: string;
  height?: number;
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="period" tick={{ fontSize: 10, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }} />
          <YAxis tick={{ fontSize: 10, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }} width={48}
                 tickFormatter={(v) => fmtCr(v as number)} />
          <RTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
                    formatter={(v) => fmtCr(v as number)} />
          <Bar dataKey={dataKey} fill={color}>
            {data.map((d, i) => (
              <Cell key={i} fill={(d[dataKey] as number ?? 0) >= 0 ? color : "hsl(var(--signal-strong-sell))"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function StockStatements({ symbol }: { symbol: string }) {
  const { data, isLoading } = useGetStockStatements(symbol, {
    query: { enabled: !!symbol, queryKey: getGetStockStatementsQueryKey(symbol) },
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-[280px] w-full" />
        <Skeleton className="h-[280px] w-full" />
      </div>
    );
  }

  const annualPL = data?.annualPL ?? [];
  const quarterlyPL = data?.quarterlyPL ?? [];
  const balanceSheet = data?.balanceSheet ?? [];
  const cashFlow = data?.cashFlow ?? [];
  const ratios = data?.ratios ?? [];
  const sh = data?.shareholding;

  const hasAnyData = annualPL.length || quarterlyPL.length || balanceSheet.length || cashFlow.length;
  if (!hasAnyData) {
    return (
      <Card>
        <CardContent className="p-6 text-center space-y-3">
          <p className="text-sm font-mono text-muted-foreground">
            Detailed statements not available for this symbol from Yahoo Finance.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            (Coverage may be limited for SME/newly-listed/low-volume stocks.)
          </p>
          <div className="max-w-md mx-auto"><KiteOfflineNote area="fundamentals" /></div>
        </CardContent>
      </Card>
    );
  }

  const annualPeriods = annualPL.map(r => r.period);
  const quarterlyPeriods = quarterlyPL.map(r => r.period);
  const bsPeriods = balanceSheet.map(r => r.period);
  const cfPeriods = cashFlow.map(r => r.period);
  const ratioPeriods = ratios.map(r => r.period);

  // Donut data for shareholding %
  const shPie = sh && (sh.insidersPct != null || sh.institutionsPct != null) ? [
    { name: "Promoters / Insiders", value: sh.insidersPct ?? 0, color: "hsl(var(--signal-strong-buy))" },
    { name: "Institutions (FII+DII)", value: sh.institutionsPct ?? 0, color: "hsl(210 80% 65%)" },
    { name: "Public", value: sh.publicPct ?? 0, color: "hsl(45 93% 58%)" },
  ] : [];

  return (
    <Tabs defaultValue="quarterly" className="w-full">
      <KiteOfflineNote area="fundamentals" />
      <TabsList className="bg-card border border-border flex flex-wrap h-auto">
        <TabsTrigger value="quarterly" className="font-mono text-[11px] uppercase">Quarterly</TabsTrigger>
        <TabsTrigger value="annual" className="font-mono text-[11px] uppercase">Annual P&amp;L</TabsTrigger>
        <TabsTrigger value="balance" className="font-mono text-[11px] uppercase">Balance Sheet</TabsTrigger>
        <TabsTrigger value="cashflow" className="font-mono text-[11px] uppercase">Cash Flow</TabsTrigger>
        <TabsTrigger value="ratios" className="font-mono text-[11px] uppercase">Ratios</TabsTrigger>
        <TabsTrigger value="shareholding" className="font-mono text-[11px] uppercase">Shareholding</TabsTrigger>
      </TabsList>

      {/* ── QUARTERLY RESULTS ── */}
      <TabsContent value="quarterly" className="space-y-4">
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Quarterly Results (₹ crore)</CardTitle>
            <Badge variant="outline" className="font-mono text-[10px]">YAHOO FINANCE · UPDATED 6H</Badge>
          </CardHeader>
          <CardContent className="p-0">
            <PivotTable
              periods={quarterlyPeriods}
              rows={[
                { label: "Revenue", values: quarterlyPL.map(r => r.revenue), bold: true },
                { label: "Cost of Revenue", values: quarterlyPL.map(r => r.costOfRevenue) },
                { label: "Gross Profit", values: quarterlyPL.map(r => r.grossProfit) },
                { label: "EBITDA", values: quarterlyPL.map(r => r.ebitda) },
                { label: "Operating Income", values: quarterlyPL.map(r => r.ebit) },
                { label: "Interest Expense", values: quarterlyPL.map(r => r.interestExpense) },
                { label: "Net Profit", values: quarterlyPL.map(r => r.netProfit), bold: true },
                { label: "EPS (₹)", values: quarterlyPL.map(r => r.eps), bold: true },
                { label: "Operating Margin %", values: quarterlyPL.map(r => r.operatingMargin) },
                { label: "Net Margin %", values: quarterlyPL.map(r => r.netMargin) },
              ]}
            />
          </CardContent>
        </Card>
        {quarterlyPL.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-1"><CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Quarterly Revenue Trend</CardTitle></CardHeader>
              <CardContent><MiniBarChart data={quarterlyPL as never} dataKey="revenue" /></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1"><CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Quarterly Net Profit</CardTitle></CardHeader>
              <CardContent><MiniBarChart data={quarterlyPL as never} dataKey="netProfit" /></CardContent>
            </Card>
          </div>
        )}
      </TabsContent>

      {/* ── ANNUAL P&L ── */}
      <TabsContent value="annual" className="space-y-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Annual Profit &amp; Loss (₹ crore)</CardTitle></CardHeader>
          <CardContent className="p-0">
            <PivotTable
              periods={annualPeriods}
              rows={[
                { label: "Revenue", values: annualPL.map(r => r.revenue), bold: true },
                { label: "Cost of Revenue", values: annualPL.map(r => r.costOfRevenue) },
                { label: "Gross Profit", values: annualPL.map(r => r.grossProfit) },
                { label: "EBITDA", values: annualPL.map(r => r.ebitda) },
                { label: "Operating Income (EBIT)", values: annualPL.map(r => r.ebit) },
                { label: "Interest Expense", values: annualPL.map(r => r.interestExpense) },
                { label: "Tax Provision", values: annualPL.map(r => r.taxProvision) },
                { label: "Net Profit", values: annualPL.map(r => r.netProfit), bold: true },
                { label: "EPS (₹)", values: annualPL.map(r => r.eps), bold: true },
                { label: "Operating Margin %", values: annualPL.map(r => r.operatingMargin) },
                { label: "Net Margin %", values: annualPL.map(r => r.netMargin) },
              ]}
            />
          </CardContent>
        </Card>
        {annualPL.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-1"><CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Annual Revenue</CardTitle></CardHeader>
              <CardContent><MiniBarChart data={annualPL as never} dataKey="revenue" /></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1"><CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Annual Net Profit</CardTitle></CardHeader>
              <CardContent><MiniBarChart data={annualPL as never} dataKey="netProfit" /></CardContent>
            </Card>
          </div>
        )}
      </TabsContent>

      {/* ── BALANCE SHEET ── */}
      <TabsContent value="balance" className="space-y-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Balance Sheet (₹ crore)</CardTitle></CardHeader>
          <CardContent className="p-0">
            <PivotTable
              periods={bsPeriods}
              rows={[
                { label: "Total Assets", values: balanceSheet.map(r => r.totalAssets), bold: true },
                { label: "Current Assets", values: balanceSheet.map(r => r.currentAssets) },
                { label: "Cash & Equivalents", values: balanceSheet.map(r => r.cashAndEquivalents) },
                { label: "Receivables", values: balanceSheet.map(r => r.receivables) },
                { label: "Inventory", values: balanceSheet.map(r => r.inventory) },
                { label: "Fixed Assets (PPE)", values: balanceSheet.map(r => r.fixedAssets) },
                { label: "Total Liabilities", values: balanceSheet.map(r => r.totalLiabilities), bold: true },
                { label: "Current Liabilities", values: balanceSheet.map(r => r.currentLiabilities) },
                { label: "Total Debt", values: balanceSheet.map(r => r.totalDebt) },
                { label: "Total Equity", values: balanceSheet.map(r => r.totalEquity), bold: true },
                { label: "Working Capital", values: balanceSheet.map(r => r.workingCapital) },
                { label: "Book Value / Share (₹)", values: balanceSheet.map(r => r.bookValuePerShare) },
              ]}
            />
          </CardContent>
        </Card>
      </TabsContent>

      {/* ── CASH FLOW ── */}
      <TabsContent value="cashflow" className="space-y-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Cash Flow Statement (₹ crore)</CardTitle></CardHeader>
          <CardContent className="p-0">
            <PivotTable
              periods={cfPeriods}
              rows={[
                { label: "Operating Cash Flow", values: cashFlow.map(r => r.operatingCashFlow), bold: true },
                { label: "Investing Cash Flow", values: cashFlow.map(r => r.investingCashFlow) },
                { label: "Financing Cash Flow", values: cashFlow.map(r => r.financingCashFlow) },
                { label: "Capital Expenditure", values: cashFlow.map(r => r.capex) },
                { label: "Free Cash Flow", values: cashFlow.map(r => r.freeCashFlow), bold: true },
                { label: "Dividends Paid", values: cashFlow.map(r => r.dividendsPaid) },
                { label: "Net Change in Cash", values: cashFlow.map(r => r.netChangeInCash) },
              ]}
            />
          </CardContent>
        </Card>
        {cashFlow.length > 0 && (
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Operating Cash Flow Trend</CardTitle></CardHeader>
            <CardContent><MiniBarChart data={cashFlow as never} dataKey="operatingCashFlow" height={220} /></CardContent>
          </Card>
        )}
      </TabsContent>

      {/* ── RATIOS ── */}
      <TabsContent value="ratios" className="space-y-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Key Ratios</CardTitle></CardHeader>
          <CardContent className="p-0">
            <PivotTable
              periods={ratioPeriods}
              fmt={(v) => fmtNum(v)}
              rows={[
                { label: "ROE %", values: ratios.map(r => r.roe), bold: true },
                { label: "ROA %", values: ratios.map(r => r.roa) },
                { label: "ROCE %", values: ratios.map(r => r.roce), bold: true },
                { label: "Debt / Equity", values: ratios.map(r => r.debtToEquity) },
                { label: "Current Ratio", values: ratios.map(r => r.currentRatio) },
                { label: "Quick Ratio", values: ratios.map(r => r.quickRatio) },
                { label: "Asset Turnover", values: ratios.map(r => r.assetTurnover) },
                { label: "Interest Coverage", values: ratios.map(r => r.interestCoverage) },
                { label: "Operating Margin %", values: ratios.map(r => r.operatingMargin) },
                { label: "Net Margin %", values: ratios.map(r => r.netMargin) },
              ]}
            />
          </CardContent>
        </Card>
        {ratios.length > 0 && (
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Profitability Trend (%)</CardTitle></CardHeader>
            <CardContent>
              <div style={{ height: 240 }}>
                <ResponsiveContainer>
                  <LineChart data={ratios as never} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
                    <XAxis dataKey="period" tick={{ fontSize: 10, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 10, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }} width={40} tickFormatter={(v) => `${v}%`} />
                    <RTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} formatter={(v) => `${(v as number).toFixed(2)}%`} />
                    <Legend wrapperStyle={{ fontSize: 11, fontFamily: "monospace" }} />
                    <Line type="monotone" dataKey="roe" name="ROE" stroke="hsl(var(--signal-strong-buy))" strokeWidth={2} dot />
                    <Line type="monotone" dataKey="roce" name="ROCE" stroke="hsl(45 93% 58%)" strokeWidth={2} dot />
                    <Line type="monotone" dataKey="netMargin" name="Net Margin" stroke="hsl(210 80% 65%)" strokeWidth={2} dot />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}
      </TabsContent>

      {/* ── SHAREHOLDING ── */}
      <TabsContent value="shareholding" className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Ownership Breakdown</CardTitle></CardHeader>
            <CardContent>
              {shPie.length === 0 ? <p className="text-xs text-muted-foreground font-mono">No breakdown available.</p> : (
                <div className="grid grid-cols-2 items-center gap-3">
                  <div style={{ height: 180 }}>
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie data={shPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} innerRadius={40} strokeWidth={1}>
                          {shPie.map((d, i) => <Cell key={i} fill={d.color} />)}
                        </Pie>
                        <RTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} formatter={(v) => `${(v as number).toFixed(2)}%`} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-1.5 text-xs font-mono">
                    {shPie.map(d => (
                      <div key={d.name} className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ background: d.color }} /> {d.name}
                        </span>
                        <span className="font-bold tabular-nums">{d.value.toFixed(2)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Top Institutional Holders</CardTitle></CardHeader>
            <CardContent className="p-0">
              {(sh?.topInstitutions ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground font-mono p-4">Not disclosed.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-border">
                      <TableHead className="font-mono text-[11px] uppercase">Holder</TableHead>
                      <TableHead className="font-mono text-[11px] uppercase text-right">% Held</TableHead>
                      <TableHead className="font-mono text-[11px] uppercase text-right">Value (₹ cr)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(sh?.topInstitutions ?? []).slice(0, 8).map((h, i) => (
                      <TableRow key={i} className="border-border/50">
                        <TableCell className="font-mono text-xs">{h.name}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{fmtPct(h.percentHeld)}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{fmtCr(h.valueCr)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
        {(sh?.topInsiders ?? []).length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Insider / Promoter Holders</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-border">
                    <TableHead className="font-mono text-[11px] uppercase">Insider</TableHead>
                    <TableHead className="font-mono text-[11px] uppercase text-right">% Held</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(sh?.topInsiders ?? []).slice(0, 8).map((h, i) => (
                    <TableRow key={i} className="border-border/50">
                      <TableCell className="font-mono text-xs">{h.name}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">{fmtPct(h.percentHeld)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </TabsContent>
    </Tabs>
  );
}

// silence eslint unused
export const _t = tone;
