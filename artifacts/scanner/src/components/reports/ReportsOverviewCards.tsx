/**
 * Overview summary cards for the owner-only `/paper-reports` page.
 *
 * Read-only, presentational. Renders compact metric cards plus an F&O vs
 * Equity comparison from a `ReportsOverviewSummary` (already derived by the
 * pure helper `summarizeReportsOverview`). Every value can be `null`:
 * unavailable metrics render as an explicit em-dash, never fabricated.
 * MFE/MAE are shown only when the shadow-exit payload supplies them.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type {
  ReportsOverviewSummary,
  ReportsOverviewAvailability,
} from "@/lib/reportsView";

export interface ReportsOverviewCardsProps {
  summary: ReportsOverviewSummary;
  loading?: boolean;
  error?: string | null;
}

const inr0 = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);

/** ₹ with a sign prefix, or em-dash when null. */
function moneyOrDash(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+ " : n < 0 ? "- " : "";
  return `${sign}${inr0(Math.abs(n))}`;
}

function pctOrDash(n: number | null, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

function numOrDash(n: number | null, digits = 2, suffix = ""): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}${suffix}`;
}

function intOrDash(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return String(Math.round(n));
}

type Tone = "good" | "bad" | "neutral";
function moneyTone(n: number | null): Tone {
  if (n == null || !Number.isFinite(n) || n === 0) return "neutral";
  return n > 0 ? "good" : "bad";
}

function MetricCard({
  label,
  value,
  tone = "neutral",
  hint,
  unavailable,
}: {
  label: string;
  value: string;
  tone?: Tone;
  hint?: string;
  unavailable?: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {unavailable && (
          <span className="text-[9px] uppercase tracking-wide text-slate-500">
            n/a
          </span>
        )}
      </div>
      <div
        className={cn(
          "mt-1 text-lg font-semibold tabular-nums",
          tone === "good" && "text-emerald-400",
          tone === "bad" && "text-rose-400",
          tone === "neutral" && "text-slate-100",
          unavailable && "text-slate-500",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[10px] text-slate-500">{hint}</div>}
    </div>
  );
}

function availabilityNote(a: ReportsOverviewAvailability): string {
  const parts: string[] = [];
  parts.push(a.foAnalytics ? "F&O analytics ✓" : "F&O analytics ✗");
  parts.push(a.foReport ? "F&O report ✓" : "F&O report ✗");
  parts.push(a.eqReport ? "Equity report ✓" : "Equity report ✗");
  parts.push(a.shadowExits ? "Shadow MFE ✓" : "Shadow MFE ✗");
  parts.push(a.foAccount ? "F&O acct ✓" : "F&O acct ✗");
  parts.push(a.eqAccount ? "Equity acct ✓" : "Equity acct ✗");
  return parts.join(" · ");
}

export function ReportsOverviewCards({
  summary,
  loading,
  error,
}: ReportsOverviewCardsProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-[68px] animate-pulse rounded-lg border border-slate-800 bg-slate-900/40"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
        <div className="mb-1 font-semibold">Failed to load overview</div>
        <div className="text-rose-100/80">{error}</div>
      </div>
    );
  }

  const s = summary;
  const a = s.availability;
  const maeUnavailable = s.avgMae == null;
  const mfeUnavailable = s.avgMfe == null;

  return (
    <div className="space-y-5">
      {/* Headline P&L */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard
          label="F&O realised P&L"
          value={moneyOrDash(s.foRealizedPnl)}
          tone={moneyTone(s.foRealizedPnl)}
          unavailable={s.foRealizedPnl == null}
        />
        <MetricCard
          label="Equity realised P&L"
          value={moneyOrDash(s.eqRealizedPnl)}
          tone={moneyTone(s.eqRealizedPnl)}
          unavailable={s.eqRealizedPnl == null}
        />
        <MetricCard
          label="Total realised P&L"
          value={moneyOrDash(s.totalRealizedPnl)}
          tone={moneyTone(s.totalRealizedPnl)}
          unavailable={s.totalRealizedPnl == null}
        />
      </div>

      {/* F&O performance metrics */}
      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
          F&O performance
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <MetricCard
            label="Win rate"
            value={pctOrDash(s.foWinRatePct)}
            tone={
              s.foWinRatePct == null
                ? "neutral"
                : s.foWinRatePct >= 50
                  ? "good"
                  : "bad"
            }
            unavailable={s.foWinRatePct == null}
          />
          <MetricCard
            label="Profit factor"
            value={numOrDash(s.foProfitFactor)}
            tone={
              s.foProfitFactor == null
                ? "neutral"
                : s.foProfitFactor >= 1
                  ? "good"
                  : "bad"
            }
            unavailable={s.foProfitFactor == null}
          />
          <MetricCard
            label="Expectancy"
            value={moneyOrDash(s.foExpectancy)}
            tone={moneyTone(s.foExpectancy)}
            unavailable={s.foExpectancy == null}
          />
          <MetricCard
            label="Avg R"
            value={numOrDash(s.foAvgRMultiple, 2, "R")}
            tone={moneyTone(s.foAvgRMultiple)}
            unavailable={s.foAvgRMultiple == null}
          />
          <MetricCard
            label="Best trade"
            value={moneyOrDash(s.foBestTrade)}
            tone={moneyTone(s.foBestTrade)}
            unavailable={s.foBestTrade == null}
          />
          <MetricCard
            label="Worst trade"
            value={moneyOrDash(s.foWorstTrade)}
            tone={moneyTone(s.foWorstTrade)}
            unavailable={s.foWorstTrade == null}
          />
          <MetricCard
            label="Trade count"
            value={intOrDash(s.foTradeCount)}
            unavailable={s.foTradeCount == null}
          />
          <MetricCard
            label="Scratches"
            value={intOrDash(s.foScratches)}
            unavailable={s.foScratches == null}
          />
        </div>
      </div>

      {/* Drawdown & excursion */}
      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
          Drawdown &amp; excursion
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <MetricCard
            label="Max drawdown"
            value={moneyOrDash(s.foMaxDrawdown)}
            tone={moneyTone(s.foMaxDrawdown)}
            unavailable={s.foMaxDrawdown == null}
          />
          <MetricCard
            label="Current drawdown"
            value={moneyOrDash(s.foCurrentDrawdown)}
            tone={moneyTone(s.foCurrentDrawdown)}
            unavailable={s.foCurrentDrawdown == null}
          />
          <MetricCard
            label="Peak equity"
            value={moneyOrDash(s.foPeakEquity)}
            unavailable={s.foPeakEquity == null}
          />
          <MetricCard
            label="Avg MFE"
            value={moneyOrDash(s.avgMfe)}
            tone={moneyTone(s.avgMfe)}
            hint={mfeUnavailable ? "no shadow-exit MFE data" : undefined}
            unavailable={mfeUnavailable}
          />
          <MetricCard
            label="Avg MAE"
            value="—"
            hint="not tracked by any payload"
            unavailable={maeUnavailable}
          />
        </div>
      </div>

      {/* F&O vs Equity comparison */}
      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
          F&O vs Equity
        </div>
        <Card className="bg-card border-border">
          <CardContent className="px-0 py-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase text-slate-400">
                  <tr className="border-b border-slate-800">
                    <th className="px-4 py-2 text-left font-medium">Metric</th>
                    <th className="px-4 py-2 text-right font-medium">F&amp;O</th>
                    <th className="px-4 py-2 text-right font-medium">Equity</th>
                    <th className="px-4 py-2 text-right font-medium">Combined</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  <tr className="border-t border-slate-800/60">
                    <td className="px-4 py-2 text-muted-foreground">
                      Realised P&amp;L
                    </td>
                    <td
                      className={cn(
                        "px-4 py-2 text-right",
                        moneyTone(s.foRealizedPnl) === "good" && "text-emerald-400",
                        moneyTone(s.foRealizedPnl) === "bad" && "text-rose-400",
                      )}
                    >
                      {moneyOrDash(s.foRealizedPnl)}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-2 text-right",
                        moneyTone(s.eqRealizedPnl) === "good" && "text-emerald-400",
                        moneyTone(s.eqRealizedPnl) === "bad" && "text-rose-400",
                      )}
                    >
                      {moneyOrDash(s.eqRealizedPnl)}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-2 text-right font-semibold",
                        moneyTone(s.totalRealizedPnl) === "good" &&
                          "text-emerald-400",
                        moneyTone(s.totalRealizedPnl) === "bad" && "text-rose-400",
                      )}
                    >
                      {moneyOrDash(s.totalRealizedPnl)}
                    </td>
                  </tr>
                  <tr className="border-t border-slate-800/60">
                    <td className="px-4 py-2 text-muted-foreground">
                      Trade count
                    </td>
                    <td className="px-4 py-2 text-right">
                      {intOrDash(s.foTradeCount)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {intOrDash(s.eqTradeCount)}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold">
                      {s.foTradeCount == null || s.eqTradeCount == null
                        ? "—"
                        : String(s.foTradeCount + s.eqTradeCount)}
                    </td>
                  </tr>
                  <tr className="border-t border-slate-800/60">
                    <td className="px-4 py-2 text-muted-foreground">Win rate</td>
                    <td className="px-4 py-2 text-right">
                      {pctOrDash(s.foWinRatePct)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {pctOrDash(s.eqWinRatePct)}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-500">—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Data availability */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs uppercase tracking-wide text-slate-400">
            Data availability
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-slate-400">{availabilityNote(a)}</p>
          <p className="mt-2 text-[10px] text-slate-500">
            Metrics shown as “—” are unavailable in the current payloads and are
            never estimated. Avg MAE is not tracked by any endpoint today.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
