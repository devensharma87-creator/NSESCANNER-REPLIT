/**
 * StatusChip — shared visual atom for OWNER-FACING execution / health chips.
 *
 * P1 unification: both the Portfolio LedgerHealth row and the Signals
 * paper-execution status pill lived in separate JSX with their own colour
 * choices (LedgerHealth used emerald/amber/rose; StatusPill used
 * signal-strong-buy / cyan / signal-strong-sell / secondary). This atom
 * collapses them onto ONE visual grammar so the trader reads the same chip
 * shape in both places.
 *
 * Variants map to owner intent, NOT to a specific data source:
 *   ok      — a positive/healthy state (ledger reconciled, target hit)
 *   pending — waiting for an event that hasn't happened yet
 *   active  — an intermediate live state (signal triggered)
 *   warn    — degraded but not fatal (ledger drift, delayed data)
 *   err     — hard failure (stopped out, reconciliation query failed)
 *   info    — informational, neutral (expired without triggering, etc.)
 *
 * All variants share the same border + bg-tint + monospace label pattern —
 * different callers only vary the icon, label and testid. This keeps
 * refactoring safe: swapping in <StatusChip> at a call site never changes
 * layout, only harmonises tone tokens.
 */
import { type ReactNode } from "react";

export type StatusChipVariant =
  | "ok"
  | "pending"
  | "active"
  | "warn"
  | "err"
  | "info";

const TONE: Record<StatusChipVariant, string> = {
  ok:      "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  pending: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  active:  "bg-cyan-500/20 text-cyan-300 border-cyan-500/40",
  warn:    "bg-amber-500/15 text-amber-300 border-amber-500/40",
  err:     "bg-rose-500/20 text-rose-300 border-rose-500/40",
  info:    "bg-secondary/40 text-muted-foreground border-border/40",
};

export interface StatusChipProps {
  variant: StatusChipVariant;
  label: string;
  icon?: ReactNode;
  /** Stable id used for `data-testid`; auto-prefixed with `status-chip-`. */
  testId?: string;
  /** Optional tooltip. */
  title?: string;
  /** Optional extra className for the outer span. */
  className?: string;
  /** Optional muted secondary text rendered after the label. */
  hint?: ReactNode;
}

export function StatusChip({
  variant,
  label,
  icon,
  testId,
  title,
  className = "",
  hint,
}: StatusChipProps) {
  return (
    <span
      data-testid={testId ? `status-chip-${testId}` : undefined}
      data-variant={variant}
      title={title}
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-mono font-bold leading-none ${TONE[variant]} ${className}`}
    >
      {icon}
      <span>{label}</span>
      {hint && <span className="opacity-70 font-normal">{hint}</span>}
    </span>
  );
}

export default StatusChip;
