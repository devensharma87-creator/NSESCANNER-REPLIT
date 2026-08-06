/**
 * CohortStatusPanel — Pack 32 V2 Cohort Isolation Foundation.
 *
 * Displays:
 *   - A cohort selector (Legacy / V2) within a paper-trading segment.
 *   - A "Not Activated" banner for disabled V2 cohorts.
 *   - A legacy badge for the LEGACY cohort.
 *
 * Rules:
 *   - Defaults existing users to the LEGACY view.
 *   - Never shows a disabled V2 cohort as live, active, profitable, or
 *     initialized with ₹0. The "not started" state is explicit.
 *   - No Kite, Upstox, IndianAPI, Yahoo, DB, or server-secret import.
 *   - Cohort switching clears any previously loaded data so stale data
 *     from one cohort cannot appear under another.
 */

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, Clock, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export type CohortFamily = "FNO" | "SWING";

export type CohortChoice = "LEGACY" | "V2";

export interface CohortSelectorProps {
  /** Which asset family this selector belongs to. */
  family: CohortFamily;
  /** Currently selected generation. */
  value: CohortChoice;
  /** Called when the user switches cohort. */
  onChange: (value: CohortChoice) => void;
  className?: string;
}

const V2_LABELS: Record<CohortFamily, string> = {
  FNO: "F&O V2",
  SWING: "Swing V2",
};

const LEGACY_LABELS: Record<CohortFamily, string> = {
  FNO: "F&O Legacy",
  SWING: "Swing Legacy",
};

/**
 * Tab-style cohort selector. Placed inside the F&O or Equity segment tabs
 * to let the owner switch between LEGACY history and the V2 cohort.
 */
export function CohortSelector({ family, value, onChange, className }: CohortSelectorProps) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <Tabs value={value} onValueChange={(v) => onChange(v as CohortChoice)}>
        <TabsList className="h-8">
          <TabsTrigger value="LEGACY" className="text-xs px-3 h-7">
            {LEGACY_LABELS[family]}
          </TabsTrigger>
          <TabsTrigger value="V2" className="text-xs px-3 h-7 gap-1.5">
            <Lock className="h-3 w-3 opacity-60" />
            {V2_LABELS[family]}
            <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 ml-0.5">
              Pending
            </Badge>
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}

// ─── V2 Not-Activated Panel ────────────────────────────────────────────────

export interface V2NotActivatedPanelProps {
  family: CohortFamily;
  className?: string;
}

const V2_ACTIVATION_MESSAGES: Record<CohortFamily, { title: string; reason: string; prereqs: string[] }> = {
  FNO: {
    title: "F&O V2 Cohort — Not Activated",
    reason:
      "This cohort has not started. It requires ≥130 trading days (≈26 weeks) " +
      "of real option-premium capture data and a frozen-protocol F&O requalification " +
      "before it may admit any paper trades.",
    prereqs: [
      "Pack 9A live canary confirmed during market hours",
      "Option-premium warehouse active in production (OPTION_SNAPSHOT_ENABLED=1)",
      "≥130 trading days of real per-contract option data accumulated",
      "Frozen-protocol F&O requalification completed (Pack 9 Gate 6)",
      "Separate FNO_PAPER_V2 owner activation decision",
    ],
  },
  SWING: {
    title: "Swing V2 Cohort — Not Activated",
    reason:
      "This cohort has not started. It requires swing qualification and a " +
      "separate owner activation decision.",
    prereqs: [
      "Swing qualification completed",
      "Separate SWING_PAPER_V2 owner activation decision",
    ],
  },
};

/**
 * Displayed when the user selects a V2 cohort that is still disabled.
 * Clearly states the cohort has NOT started — never shows ₹0 balance,
 * empty success, or fabricated performance.
 */
export function V2NotActivatedPanel({ family, className }: V2NotActivatedPanelProps) {
  const msg = V2_ACTIVATION_MESSAGES[family];
  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-amber-300 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-700 p-6",
        className,
      )}
      data-testid={`v2-not-activated-${family.toLowerCase()}`}
    >
      <div className="flex gap-3">
        <Lock className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        <div className="space-y-3 min-w-0">
          <div>
            <h3 className="font-semibold text-amber-900 dark:text-amber-200 text-sm">
              {msg.title}
            </h3>
            <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-1 leading-relaxed">
              {msg.reason}
            </p>
          </div>

          <div>
            <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-2">
              Prerequisites remaining
            </p>
            <ul className="space-y-1">
              {msg.prereqs.map((prereq) => (
                <li key={prereq} className="flex items-start gap-2 text-xs text-amber-800/70 dark:text-amber-300/70">
                  <Clock className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                  {prereq}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80 italic">
              No trades, balance, P&amp;L, or charges exist for this cohort.
              Performance statistics will appear here only after activation.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Legacy cohort label ──────────────────────────────────────────────────

export interface CohortLabelProps {
  cohortId: "FNO_PAPER_LEGACY" | "SWING_PAPER_LEGACY" | "FNO_PAPER_V2" | "SWING_PAPER_V2";
  className?: string;
}

/**
 * Compact inline badge for labelling a cohort on trade tables, P&L summaries,
 * exports, and detail drawers where ambiguity is possible.
 */
export function CohortLabel({ cohortId, className }: CohortLabelProps) {
  const isLegacy = cohortId.endsWith("_LEGACY");
  const isV2 = cohortId.endsWith("_V2");
  const isFno = cohortId.startsWith("FNO_");

  return (
    <Badge
      variant={isLegacy ? "outline" : "secondary"}
      className={cn(
        "text-[10px] px-1.5 py-0 h-4 font-mono tracking-tight",
        isV2 && "opacity-60",
        isFno ? "border-blue-400 text-blue-700 dark:text-blue-400" : "border-green-400 text-green-700 dark:text-green-400",
        className,
      )}
      title={cohortId}
    >
      {isLegacy ? (isFno ? "F&O" : "EQ") : (isFno ? "F&O·V2" : "EQ·V2")}
      {isLegacy ? " Legacy" : " V2"}
    </Badge>
  );
}
