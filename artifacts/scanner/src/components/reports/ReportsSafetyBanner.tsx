/**
 * Reports safety banner for the owner-only `/paper-reports` page.
 *
 * Read-only, presentational. Makes the compliance posture of this surface
 * unmistakable: these reports are paper-trading analytics only and never
 * place orders or mutate any strategy / threshold. Optional metadata
 * (period, freshness, segment availability, privacy) degrades to safe
 * placeholders — the banner never crashes on missing data.
 */
import { ShieldCheck, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ReportsOverviewAvailability } from "@/lib/reportsView";

const SAFETY_POINTS = [
  "Paper trading analytics only",
  "No live order placement",
  "No strategy change",
  "No P25 threshold change",
  "Reports are review/support tools only",
] as const;

export interface ReportsSafetyBannerProps {
  /** Human-readable selected period, e.g. "May 2026" or "FY 2026-2027". */
  periodLabel?: string | null;
  /** ISO timestamp of when the underlying report was generated. */
  generatedAt?: string | null;
  /** Per-source availability flags from `summarizeReportsOverview`. */
  availability?: ReportsOverviewAvailability | null;
  /** True while the overview data is still loading. */
  loading?: boolean;
  /** True when the overview data failed to load. */
  error?: boolean;
}

function formatGeneratedAt(iso?: string | null): string | null {
  if (typeof iso !== "string" || iso.trim() === "") return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  try {
    return new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kolkata",
    }).format(new Date(ms));
  } catch {
    return null;
  }
}

function availableSegments(
  availability?: ReportsOverviewAvailability | null,
): string[] {
  if (!availability) return [];
  const segs: string[] = [];
  if (availability.foReport || availability.foAnalytics || availability.foAccount) {
    segs.push("F&O");
  }
  if (availability.eqReport || availability.eqAccount) {
    segs.push("Equity");
  }
  return segs;
}

export function ReportsSafetyBanner({
  periodLabel,
  generatedAt,
  availability,
  loading,
  error,
}: ReportsSafetyBannerProps) {
  const freshness = formatGeneratedAt(generatedAt);
  const segments = availableSegments(availability);

  return (
    <div className="rounded-lg border border-sky-500/30 bg-sky-500/[0.06] px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-sky-100">
                Paper trading analytics only
              </span>
              <Badge
                variant="outline"
                className="border-sky-500/40 text-[10px] uppercase tracking-wide text-sky-300"
              >
                <Lock className="mr-1 h-3 w-3" /> Owner-only · private
              </Badge>
            </div>
            <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-sky-200/80">
              {SAFETY_POINTS.slice(1).map((p) => (
                <li key={p} className="flex items-center gap-1.5">
                  <span className="h-1 w-1 rounded-full bg-sky-400/70" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="text-right text-[11px] text-sky-200/70">
          <div>
            <span className="text-sky-200/50">Period: </span>
            <span className="font-medium text-sky-100">
              {periodLabel && periodLabel.trim() !== "" ? periodLabel : "—"}
            </span>
          </div>
          <div className="mt-0.5">
            <span className="text-sky-200/50">Data freshness: </span>
            <span className="font-medium text-sky-100">
              {loading
                ? "loading…"
                : error
                  ? "unavailable"
                  : (freshness ?? "—")}
            </span>
          </div>
          <div className="mt-0.5">
            <span className="text-sky-200/50">Segments: </span>
            <span
              className={cn(
                "font-medium",
                segments.length > 0 ? "text-sky-100" : "text-sky-200/60",
              )}
            >
              {loading
                ? "…"
                : segments.length > 0
                  ? segments.join(" · ")
                  : "none available"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
