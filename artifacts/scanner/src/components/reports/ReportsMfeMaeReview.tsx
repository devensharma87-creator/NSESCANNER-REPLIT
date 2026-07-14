/**
 * MFE / MAE review section for the owner-only `/paper-reports` page.
 *
 * Read-only, post-trade analytics. Renders the F&O shadow-exit excursion
 * review from a pre-computed `MfeMaeReview` (helper `deriveMfeMaeReview`).
 *
 * Truthfulness rules enforced here:
 *  - MAE is ALWAYS shown as unavailable — no current payload exposes it, and
 *    we never synthesise, infer, or show a fake zero.
 *  - Average MFE and give-back candidates come ONLY from the server-provided
 *    per-trade spotlight rows; absent data renders an explicit message, never
 *    a fabricated value.
 *
 * Safe states: loading skeleton, error panel, disabled-report notice, and an
 * explicit empty state. Never crashes on missing or malformed data.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Activity, AlertTriangle, Info } from "lucide-react";
import type { MfeMaeReview, ShadowExitTradeRowLike } from "@/lib/reportsView";

export interface ReportsMfeMaeReviewProps {
  review: MfeMaeReview;
  loading?: boolean;
  error?: string | null;
}

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

function intOrDash(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return String(Math.round(n));
}

function shortDate(iso?: string | null): string {
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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Activity className="h-4 w-4 text-sky-300" />
          MFE / MAE review
          <span className="ml-auto text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
            F&amp;O shadow-exit analytics
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function StatCard({
  label,
  value,
  tone = "neutral",
  hint,
  unavailable,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad" | "neutral";
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

function rowLabel(r: ShadowExitTradeRowLike): string {
  const parts = [r.indexSymbol, r.setupKey, r.direction].filter(
    (p): p is string => typeof p === "string" && p.trim() !== "",
  );
  return parts.length > 0 ? parts.join(" · ") : "—";
}

export function ReportsMfeMaeReview({
  review,
  loading,
  error,
}: ReportsMfeMaeReviewProps) {
  if (loading) {
    return (
      <Shell>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-[68px] animate-pulse rounded-lg border border-slate-800 bg-slate-900/40"
            />
          ))}
        </div>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell>
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-6 text-sm text-rose-200">
          <div className="mb-1 font-semibold">Failed to load MFE/MAE review</div>
          <div className="text-rose-100/80">{error}</div>
        </div>
      </Shell>
    );
  }

  const r = review;

  if (!r.available) {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center gap-1 py-8 text-center">
          <span className="text-sm text-muted-foreground">
            Shadow-exit review unavailable
          </span>
          <span className="max-w-md text-xs text-slate-500">
            The shadow-exits report is disabled or has not produced data yet.
            MFE/MAE review appears once F&amp;O paper trades have closed with the
            shadow-exit report enabled.
          </span>
        </div>
      </Shell>
    );
  }

  const giveBack = r.giveBackCandidates.slice(0, 5);

  return (
    <Shell>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Average MFE"
          value={moneyOrDash(r.avgMfe)}
          tone={r.avgMfe != null && r.avgMfe > 0 ? "good" : "neutral"}
          hint={
            r.avgMfe == null
              ? "no eligible MFE rows"
              : `over ${r.avgMfeSampleCount} trade${r.avgMfeSampleCount === 1 ? "" : "s"}`
          }
          unavailable={r.avgMfe == null}
        />
        <StatCard
          label="Average MAE"
          value="—"
          hint="not exposed by payload"
          unavailable
        />
        <StatCard
          label="Eligible sample"
          value={intOrDash(r.eligibleSampleCount)}
          hint={`${intOrDash(r.processedRowCount)} processed`}
          unavailable={r.eligibleSampleCount === 0}
        />
        <StatCard
          label="P25 evidence rows"
          value={intOrDash(r.rawRowCount)}
          hint="raw shadow-exit rows"
          unavailable={r.rawRowCount === 0}
        />
      </div>

      {r.lowSampleWarning && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/[0.08] px-3 py-2 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Low sample
            {r.lowSampleThreshold != null
              ? ` — fewer than ${r.lowSampleThreshold} eligible rows`
              : ""}
            . Treat these averages as indicative only.
          </span>
        </div>
      )}

      {/* MAE truthfulness notice */}
      <div className="mt-3 flex items-start gap-2 rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs text-slate-400">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
        <span>
          MAE unavailable — current shadow-exits payload does not expose MAE. It
          is never inferred or shown as a fake zero.
        </span>
      </div>

      {/* Give-back review */}
      <div className="mt-4">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-slate-400">
            Give-back candidates
          </span>
          {giveBack.length > 0 && (
            <Badge
              variant="outline"
              className="border-slate-700 text-[10px] text-slate-300"
            >
              MFE &gt; realised P&amp;L
            </Badge>
          )}
        </div>
        {giveBack.length === 0 ? (
          <div className="rounded-md border border-slate-800 bg-slate-900/40 px-3 py-3 text-xs text-slate-500">
            Give-back review unavailable from current payload.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase text-slate-400">
                <tr className="border-b border-slate-800">
                  <th className="px-3 py-1.5 text-left font-medium">Date</th>
                  <th className="px-3 py-1.5 text-left font-medium">Setup</th>
                  <th className="px-3 py-1.5 text-right font-medium">MFE</th>
                  <th className="px-3 py-1.5 text-right font-medium">Realised</th>
                  <th className="px-3 py-1.5 text-right font-medium">Give-back</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {giveBack.map((t, i) => {
                  const mfe = typeof t.mfeAbs === "number" ? t.mfeAbs : null;
                  const actual =
                    typeof t.actualPnl === "number" ? t.actualPnl : null;
                  const gap =
                    mfe != null && actual != null ? mfe - actual : null;
                  return (
                    <tr
                      key={t.id ?? `${i}`}
                      className="border-t border-slate-800/60"
                    >
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {shortDate(t.signalDate)}
                      </td>
                      <td className="px-3 py-1.5 text-slate-300">
                        {rowLabel(t)}
                      </td>
                      <td className="px-3 py-1.5 text-right text-emerald-400">
                        {moneyOrDash(mfe)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-1.5 text-right",
                          actual != null && actual > 0 && "text-emerald-400",
                          actual != null && actual < 0 && "text-rose-400",
                        )}
                      >
                        {moneyOrDash(actual)}
                      </td>
                      <td className="px-3 py-1.5 text-right text-amber-300">
                        {moneyOrDash(gap)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Glossary */}
      <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
        MFE = Maximum Favorable Excursion (best unrealised move in your favour
        before exit). MAE = Maximum Adverse Excursion (worst move against you
        before exit).
      </p>
    </Shell>
  );
}
