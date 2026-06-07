/** Portfolio-level action summary — counts by verdict + grouped symbols. */
import type { AdviceSummary } from "@/lib/portfolio/advice";
import type { Verdict } from "@/lib/portfolio/types";
import { verdictClass, verdictLabel } from "./format";

const ORDER: Verdict[] = [
  "EXIT",
  "TRIM",
  "AVOID",
  "ACCUMULATE",
  "HOLD",
  "WATCHLIST",
  "DATA_INCOMPLETE",
];

export function ActionSummary({
  summary,
  onSelect,
}: {
  summary: AdviceSummary;
  onSelect: (symbol: string) => void;
}) {
  return (
    <div
      className="rounded-md border border-border bg-card p-3"
      data-testid="action-summary"
    >
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Portfolio Action Summary
      </h3>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {ORDER.filter(v => summary.counts[v] > 0).map(v => (
          <span
            key={v}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${verdictClass(
              v,
            )}`}
          >
            {verdictLabel(v)}
            <span className="rounded bg-black/20 px-1 text-[10px]">{summary.counts[v]}</span>
          </span>
        ))}
      </div>

      <div className="space-y-2">
        {summary.groups.map(g => (
          <div key={g.verdict} className="flex flex-wrap items-start gap-1.5 text-xs">
            <span
              className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${verdictClass(
                g.verdict,
              )}`}
            >
              {verdictLabel(g.verdict)}
            </span>
            <div className="flex flex-wrap gap-1">
              {g.symbols.map(s => (
                <button
                  key={s}
                  onClick={() => onSelect(s)}
                  className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] hover:bg-muted"
                  data-testid={`action-symbol-${s}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 border-t border-border pt-2 text-[10px] leading-relaxed text-muted-foreground">
        Personal educational analysis only. Not public investment advice, not SEBI-registered, and
        not a recommendation for third parties. Decisions are the user's own responsibility.
      </p>
    </div>
  );
}
