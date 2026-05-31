/**
 * Drawdown summary cards for the owner-only `/paper-reports` page.
 *
 * Read-only, presentational. Renders the F&O paper-trading drawdown posture
 * (max drawdown, current drawdown, peak equity, max-drawdown %, and a derived
 * status) from a pre-computed `DrawdownSummary` (helper `deriveDrawdownSummary`).
 * Every value can be null and renders as an em-dash — never fabricated. The
 * max-drawdown percentage is shown only when the helper could derive it
 * (i.e. peak equity > 0).
 */
import { cn } from "@/lib/utils";
import type { DrawdownSummary } from "@/lib/reportsView";

export interface ReportsDrawdownCardsProps {
  summary: DrawdownSummary;
  loading?: boolean;
  error?: string | null;
}

const inr0 = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);

function moneyOrDash(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+ " : n < 0 ? "- " : "";
  return `${sign}${inr0(Math.abs(n))}`;
}

function pctOrDash(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

type Tone = "good" | "bad" | "neutral";

/** Plain-language status from the current vs max drawdown relationship. */
function drawdownStatus(s: DrawdownSummary): { label: string; tone: Tone } {
  const cur = s.currentDrawdown;
  const max = s.maxDrawdown;
  if (cur == null) return { label: "—", tone: "neutral" };
  if (cur >= 0) return { label: "At peak", tone: "good" };
  if (max != null && max < 0) {
    // Both negative; closer to max (more negative) = deeper drawdown.
    const ratio = Math.abs(cur) / Math.abs(max);
    if (ratio >= 0.95) return { label: "Near max drawdown", tone: "bad" };
    if (ratio >= 0.5) return { label: "In drawdown", tone: "bad" };
    return { label: "Recovering", tone: "neutral" };
  }
  return { label: "In drawdown", tone: "bad" };
}

function DrawdownCard({
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

export function ReportsDrawdownCards({
  summary,
  loading,
  error,
}: ReportsDrawdownCardsProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
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
        <div className="mb-1 font-semibold">Failed to load drawdown summary</div>
        <div className="text-rose-100/80">{error}</div>
      </div>
    );
  }

  const s = summary;
  const status = drawdownStatus(s);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <DrawdownCard
        label="Max drawdown"
        value={moneyOrDash(s.maxDrawdown)}
        tone={s.maxDrawdown != null && s.maxDrawdown < 0 ? "bad" : "neutral"}
        unavailable={s.maxDrawdown == null}
      />
      <DrawdownCard
        label="Current drawdown"
        value={moneyOrDash(s.currentDrawdown)}
        tone={
          s.currentDrawdown == null
            ? "neutral"
            : s.currentDrawdown < 0
              ? "bad"
              : "good"
        }
        unavailable={s.currentDrawdown == null}
      />
      <DrawdownCard
        label="Peak equity"
        value={moneyOrDash(s.peakEquity)}
        unavailable={s.peakEquity == null}
      />
      <DrawdownCard
        label="Max DD %"
        value={pctOrDash(s.maxDrawdownPct)}
        tone={s.maxDrawdownPct != null && s.maxDrawdownPct > 0 ? "bad" : "neutral"}
        hint={s.maxDrawdownPct == null ? "needs peak equity > 0" : undefined}
        unavailable={s.maxDrawdownPct == null}
      />
      <DrawdownCard
        label="Status"
        value={status.label}
        tone={status.tone}
        unavailable={status.label === "—"}
      />
    </div>
  );
}
