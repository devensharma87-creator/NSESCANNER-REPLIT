/**
 * Best / worst closed-trade review for the owner-only `/paper-reports` Overview.
 *
 * Read-only, post-trade analytics. Renders compact best/worst trade lists from
 * already-normalized closed-trade rows (helper `selectBestWorstTrades`). No
 * data fetching and no selection logic beyond the accepted pure helper.
 *
 * Truthfulness rules:
 *  - Only rows with a valid realised P&L are eligible (helper enforces this).
 *  - Missing per-row fields (symbol/setup/exit reason/R/tags) render as clean
 *    placeholders, never fabricated values. Malformed rows never crash.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";
import {
  selectBestWorstTrades,
  type NormalizedReportRow,
} from "@/lib/reportsView";

export interface ReportsBestWorstTradesProps {
  rows: NormalizedReportRow[];
  loading?: boolean;
  error?: string | null;
  limit?: number;
}

const inr0 = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);

function moneyOrDash(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+ " : n < 0 ? "- " : "";
  return `${sign}${inr0(Math.abs(n))}`;
}

function rOrDash(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}R`;
}

function textOrDash(s: unknown): string {
  if (typeof s !== "string" || s.trim() === "") return "—";
  return s.replace(/_/g, " ");
}

function shortDate(iso: unknown): string {
  if (typeof iso !== "string" || iso.trim() === "") return "—";
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

function TradeList({
  title,
  icon,
  trades,
  tone,
}: {
  title: string;
  icon: React.ReactNode;
  trades: NormalizedReportRow[];
  tone: "good" | "bad";
}) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {trades.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No eligible trades.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-mono">
              <thead>
                <tr className="border-b border-slate-700/60 text-[11px] uppercase text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-left font-medium">Seg</th>
                  <th className="px-3 py-2 text-left font-medium">Symbol</th>
                  <th className="px-3 py-2 text-left font-medium">Setup</th>
                  <th className="px-3 py-2 text-left font-medium">Exit</th>
                  <th className="px-3 py-2 text-right font-medium">R</th>
                  <th className="px-3 py-2 text-right font-medium">P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => (
                  <tr
                    key={t.id || `${i}`}
                    className="border-t border-slate-800/60 align-top"
                  >
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                      {shortDate(t.signalDate ?? t.exitedAt)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {t.segment ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-200">
                      <div>{textOrDash(t.index)}</div>
                      {Array.isArray(t.tags) && t.tags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {t.tags.slice(0, 3).map((tag, j) => (
                            <Badge
                              key={`${tag}-${j}`}
                              variant="outline"
                              className="border-slate-700 px-1 py-0 text-[9px] text-slate-400"
                            >
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-300">
                      {textOrDash(t.setupKey)}
                    </td>
                    <td className="px-3 py-2 text-slate-400">
                      {textOrDash(t.exitReason)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-300">
                      {rOrDash(typeof t.rMultiple === "number" ? t.rMultiple : null)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right tabular-nums font-semibold",
                        tone === "good" ? "text-emerald-400" : "text-rose-400",
                      )}
                    >
                      {moneyOrDash(
                        typeof t.realizedPnl === "number" ? t.realizedPnl : null,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ReportsBestWorstTrades({
  rows,
  loading,
  error,
  limit = 5,
}: ReportsBestWorstTradesProps) {
  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="h-44 animate-pulse rounded-lg border border-slate-800 bg-slate-900/40"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-4 text-sm text-rose-200">
        <div className="mb-1 font-semibold">Failed to load best/worst trades</div>
        <div className="text-rose-100/80">{error}</div>
      </div>
    );
  }

  const { best, worst } = selectBestWorstTrades(rows, limit);

  if (best.length === 0 && worst.length === 0) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="py-8 text-center text-muted-foreground">
          No closed trades with realised P&amp;L in the selected period.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <TradeList
        title="Best trades"
        icon={<TrendingUp className="h-4 w-4 text-emerald-400" />}
        trades={best}
        tone="good"
      />
      <TradeList
        title="Worst trades"
        icon={<TrendingDown className="h-4 w-4 text-rose-400" />}
        trades={worst}
        tone="bad"
      />
    </div>
  );
}
