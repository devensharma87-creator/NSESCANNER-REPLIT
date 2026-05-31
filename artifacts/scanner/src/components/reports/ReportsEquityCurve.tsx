/**
 * Equity-curve visualization for the owner-only `/paper-reports` page.
 *
 * Read-only, presentational. Renders a sanitised F&O paper-trading equity
 * curve (cumulative realised P&L) as an area chart with a drawdown overlay,
 * plus a compact recent-points table. All data is pre-shaped by the pure
 * helper `shapeEquityCurve`; this component only formats and draws it.
 *
 * Safe states: loading skeleton, error panel, and an explicit empty state.
 * Never crashes on an empty or malformed curve — every numeric value can be
 * null and is rendered as an em-dash, never fabricated.
 */
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart as LineChartIcon } from "lucide-react";
import type { ShapedEquityPoint } from "@/lib/reportsView";

export interface ReportsEquityCurveProps {
  points: ShapedEquityPoint[];
  loading?: boolean;
  error?: string | null;
}

const chartConfig = {
  cumulativePnl: { label: "Cumulative P&L", color: "hsl(199 89% 60%)" },
  drawdown: { label: "Drawdown", color: "hsl(351 95% 71%)" },
} satisfies ChartConfig;

const inr0 = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);

function moneyOrDash(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+ " : n < 0 ? "- " : "";
  return `${sign}${inr0(Math.abs(n))}`;
}

function shortDate(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  try {
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      timeZone: "Asia/Kolkata",
    }).format(new Date(ms));
  } catch {
    return iso;
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <LineChartIcon className="h-4 w-4 text-sky-300" />
          Equity curve
          <span className="ml-auto text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
            F&amp;O paper analytics
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function ReportsEquityCurve({
  points,
  loading,
  error,
}: ReportsEquityCurveProps) {
  if (loading) {
    return (
      <Shell>
        <div className="h-[260px] animate-pulse rounded-md border border-slate-800 bg-slate-900/40" />
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell>
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-6 text-sm text-rose-200">
          <div className="mb-1 font-semibold">Failed to load equity curve</div>
          <div className="text-rose-100/80">{error}</div>
        </div>
      </Shell>
    );
  }

  if (!Array.isArray(points) || points.length === 0) {
    return (
      <Shell>
        <div className="flex h-[200px] flex-col items-center justify-center gap-1 text-center">
          <span className="text-sm text-muted-foreground">
            No equity curve yet
          </span>
          <span className="max-w-sm text-xs text-slate-500">
            The curve appears once F&amp;O paper trades have closed and the
            analytics endpoint returns daily points.
          </span>
        </div>
      </Shell>
    );
  }

  const hasCumulative = points.some((p) => p.cumulativePnl != null);
  const hasDrawdown = points.some((p) => p.drawdown != null);
  const recent = points.slice(-8).reverse();

  return (
    <Shell>
      {hasCumulative ? (
        <ChartContainer config={chartConfig} className="aspect-auto h-[260px] w-full">
          <AreaChart data={points} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-cumulativePnl)" stopOpacity={0.35} />
                <stop offset="95%" stopColor="var(--color-cumulativePnl)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              tickLine={false}
              axisLine={false}
              minTickGap={24}
            />
            <YAxis
              width={56}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => moneyOrDash(typeof v === "number" ? v : null)}
            />
            <ReferenceLine y={0} stroke="hsl(215 16% 47%)" strokeDasharray="2 2" />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(label) => shortDate(String(label))}
                  formatter={(value, name) => [
                    moneyOrDash(typeof value === "number" ? value : null),
                    name === "cumulativePnl" ? " Cumulative P&L" : " Drawdown",
                  ]}
                />
              }
            />
            <Area
              type="monotone"
              dataKey="cumulativePnl"
              stroke="var(--color-cumulativePnl)"
              fill="url(#eqFill)"
              strokeWidth={2}
              connectNulls
              isAnimationActive={false}
            />
            {hasDrawdown && (
              <Line
                type="monotone"
                dataKey="drawdown"
                stroke="var(--color-drawdown)"
                strokeWidth={1.5}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            )}
          </AreaChart>
        </ChartContainer>
      ) : (
        <div className="mb-3 rounded-md border border-slate-800 bg-slate-900/40 px-4 py-3 text-xs text-muted-foreground">
          Cumulative P&amp;L values are unavailable for this period — showing the
          raw daily points below.
        </div>
      )}

      <div className="mt-4 overflow-x-auto">
        <div className="mb-1.5 text-[11px] uppercase tracking-wide text-slate-400">
          Recent points
        </div>
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase text-slate-400">
            <tr className="border-b border-slate-800">
              <th className="px-3 py-1.5 text-left font-medium">Date</th>
              <th className="px-3 py-1.5 text-right font-medium">Daily P&amp;L</th>
              <th className="px-3 py-1.5 text-right font-medium">Cumulative</th>
              <th className="px-3 py-1.5 text-right font-medium">Drawdown</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {recent.map((p) => (
              <tr key={p.date} className="border-t border-slate-800/60">
                <td className="px-3 py-1.5 text-muted-foreground">
                  {shortDate(p.date)}
                </td>
                <td
                  className={
                    "px-3 py-1.5 text-right " +
                    (p.dailyPnl != null && p.dailyPnl > 0
                      ? "text-emerald-400"
                      : p.dailyPnl != null && p.dailyPnl < 0
                        ? "text-rose-400"
                        : "")
                  }
                >
                  {moneyOrDash(p.dailyPnl)}
                </td>
                <td className="px-3 py-1.5 text-right">
                  {moneyOrDash(p.cumulativePnl)}
                </td>
                <td
                  className={
                    "px-3 py-1.5 text-right " +
                    (p.drawdown != null && p.drawdown < 0 ? "text-rose-400" : "")
                  }
                >
                  {moneyOrDash(p.drawdown)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
