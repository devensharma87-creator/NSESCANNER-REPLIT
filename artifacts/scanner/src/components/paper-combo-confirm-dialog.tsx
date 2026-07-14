/**
 * Owner-only "Send to Combo Paper Trade" confirmation modal.
 *
 * What this does:
 *   1. Renders the SAME server-repriced snapshot the Strategy Builder
 *      already has (debounced 300ms, refreshed on every leg change), so
 *      the user always sees the live entry premiums + risk envelope they
 *      are about to commit to.
 *   2. On Confirm, posts ONLY leg specs (underlying / expiry / strike /
 *      type / side / lots / strategy name / journal). No premium, no
 *      Greeks, no margin, no P&L is sent — the server reprices from the
 *      live chain at open.
 *   3. Loud warning that the combo lane is manual-only and bypasses the
 *      single-leg F&O auto-trader guardrails (heat budget, DD caps,
 *      15:20 force-exit etc.).
 *
 * Tamper resistance: `payloadFromLegs` is a pure helper exported for
 * unit testing — it is the single source of truth for what the client
 * sends, and it cannot include trusted fields by construction (the
 * input type only carries leg shape).
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useOpenPaperCombo,
  getListPaperCombosQueryKey,
  type CustomStrategyResponse,
  type PaperComboOpenRequest,
  type PaperComboLegSpec,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle } from "lucide-react";

/**
 * Pure helper: turn the builder's leg drafts + metadata into the
 * sanitized open-request body. **Never** includes premium / iv /
 * Greeks / margin / P&L. Exported for tests.
 */
export function payloadFromLegs(args: {
  underlying: string;
  expiry: string;
  strategyName?: string | null;
  journal?: string | null;
  legs: ReadonlyArray<{
    action: "BUY" | "SELL";
    optionType: "CE" | "PE";
    strike: number;
    lots: number;
  }>;
}): PaperComboOpenRequest {
  const legs: PaperComboLegSpec[] = args.legs.map((l) => ({
    strike: l.strike,
    optionType: l.optionType,
    action: l.action,
    lots: Math.max(1, Math.floor(l.lots)),
  }));
  return {
    underlying: args.underlying,
    expiry: args.expiry,
    ...(args.strategyName ? { strategyName: args.strategyName } : {}),
    ...(args.journal ? { journal: args.journal } : {}),
    legs,
  };
}

const fmtR = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n)
    ? "—"
    : (n >= 0 ? "+₹" : "−₹") +
      Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });

const fmtPx = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n)
    ? "—"
    : n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface PaperComboConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  underlying: string;
  expiry: string;
  /** Server-repriced snapshot from `usePostOptionStrategyCustom`. */
  snapshot: CustomStrategyResponse;
  /** The leg drafts the user typed, in display order. */
  legs: ReadonlyArray<{
    action: "BUY" | "SELL";
    optionType: "CE" | "PE";
    strike: number;
    lots: number;
  }>;
  onSuccess?: (comboId: string) => void;
}

export function PaperComboConfirmDialog({
  open,
  onClose,
  underlying,
  expiry,
  snapshot,
  legs,
  onSuccess,
}: PaperComboConfirmDialogProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [strategyName, setStrategyName] = useState("");
  const [journal, setJournal] = useState("");

  const mut = useOpenPaperCombo({
    mutation: {
      onSuccess: (resp) => {
        toast({
          title: "Combo paper trade opened",
          description: `${resp.combo.underlying} ${resp.combo.expiry} · ${resp.combo.legs.length} legs · cap ₹${Math.round(resp.combo.capitalDeployed).toLocaleString("en-IN")}`,
        });
        // Refresh the combo list everywhere.
        void qc.invalidateQueries({ queryKey: getListPaperCombosQueryKey() });
        void qc.invalidateQueries({ queryKey: ["paper", "combos"] });
        onSuccess?.(resp.combo.id);
        setStrategyName("");
        setJournal("");
        onClose();
      },
      onError: (err) => {
        toast({
          title: "Open rejected",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      },
    },
  });

  if (!open) return null;
  const snap = snapshot.snapshot;
  // If the snapshot somehow couldn't build, refuse to render the modal —
  // the builder already shows an error in this case.
  if (!snap) return null;

  const totalLots = legs.reduce((sum, l) => sum + Math.max(1, Math.floor(l.lots)), 0);
  const isCredit = snap.netDebit < 0;
  // We deliberately don't compute total capital client-side — the server's
  // returned `capitalDeployed` (max(netDebit×qty, marginRequired)) is the
  // single source of truth. This preview only shows per-lot risk numbers.

  const handleConfirm = () => {
    const body = payloadFromLegs({
      underlying,
      expiry,
      strategyName: strategyName.trim() || null,
      journal: journal.trim() || null,
      legs,
    });
    mut.mutate({ data: body });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={() => !mut.isPending && onClose()}
      role="presentation"
    >
      <div
        className="w-full max-w-2xl rounded-lg border border-border bg-background p-6 shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Confirm combo paper trade"
        data-testid="dialog-paper-combo-confirm"
      >
        <h2 className="text-lg font-semibold mb-1">Open combo paper trade</h2>
        <p className="text-xs text-muted-foreground mb-3 font-mono">
          {underlying} · {expiry} · {legs.length} legs · {totalLots} total lots
        </p>

        {/* LOUD warning: combo lane bypasses single-leg auto-trader guardrails */}
        <div
          className="rounded border border-amber-500/40 bg-amber-500/10 p-3 mb-4 flex gap-2 items-start"
          data-testid="warning-combo-bypass"
        >
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-[11px] font-mono text-amber-200/90 leading-relaxed">
            <strong>Manual combo paper trade.</strong> This bypasses the F&amp;O
            single-leg auto-trader guardrails (Pass-1/2/3 gates, daily/weekly DD
            caps, portfolio heat budget, 15:20 force-exit). Realised P&amp;L
            stays in its own bucket and does not feed the F&amp;O account stats.
            Defined-risk combos only — naked shorts/ratios are rejected.
          </div>
        </div>

        {/* Server-repriced legs */}
        <div className="border border-border rounded mb-4 overflow-hidden">
          <div className="bg-muted/40 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Legs (server-repriced)
          </div>
          <table className="w-full text-[11px] font-mono" data-testid="table-combo-legs">
            <thead className="bg-muted/20 text-muted-foreground">
              <tr>
                <th className="px-2 py-1 text-left">#</th>
                <th className="px-2 py-1 text-left">Side</th>
                <th className="px-2 py-1 text-right">Strike</th>
                <th className="px-2 py-1 text-right">Lots</th>
                <th className="px-2 py-1 text-right">Entry ₹</th>
                <th className="px-2 py-1 text-right">IV</th>
                <th className="px-2 py-1 text-right">Src</th>
              </tr>
            </thead>
            <tbody>
              {snap.legs.map((leg, i) => {
                const reqLots = legs[i]?.lots ?? 1;
                const sideTone =
                  leg.action === "BUY"
                    ? "text-signal-strong-buy"
                    : "text-signal-strong-sell";
                return (
                  <tr key={i} className="border-t border-border/60" data-testid={`row-leg-${i}`}>
                    <td className="px-2 py-1 text-muted-foreground">{i + 1}</td>
                    <td className={`px-2 py-1 font-bold ${sideTone}`}>
                      {leg.action} {leg.optionType}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{leg.strike}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{reqLots}</td>
                    <td
                      className="px-2 py-1 text-right tabular-nums font-bold"
                      data-testid={`leg-entry-${i}`}
                    >
                      {fmtPx(leg.premium)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                      {leg.iv != null ? `${(leg.iv * 100).toFixed(1)}%` : "—"}
                    </td>
                    <td className="px-2 py-1 text-right text-[10px] uppercase text-muted-foreground/70">
                      {leg.source}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Risk envelope */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          <Stat
            label={isCredit ? "Net Credit" : "Net Debit"}
            value={fmtR(snap.perLot.netDebit)}
            sub="per lot"
            tone={isCredit ? "buy" : undefined}
          />
          <Stat
            label="Max Profit"
            value={snap.maxProfit == null ? "Unlimited" : fmtR(snap.maxProfit)}
            sub="per lot"
            tone="buy"
          />
          <Stat
            label="Max Loss"
            value={snap.maxLoss == null ? "Unlimited" : fmtR(snap.maxLoss)}
            sub="per lot"
            tone="sell"
          />
          <Stat
            label="Margin"
            value={`₹${Math.round(snap.marginRequired).toLocaleString("en-IN")}`}
            sub="server est."
          />
          {snap.breakevens.length > 0 && (
            <div className="col-span-2 sm:col-span-4 bg-card p-2 rounded">
              <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                Breakeven{snap.breakevens.length > 1 ? "s" : ""}
              </div>
              <div className="text-[12px] font-mono font-bold tabular-nums mt-0.5">
                {snap.breakevens.map((b) => `₹${b.toFixed(2)}`).join("  ·  ")}
              </div>
            </div>
          )}
        </div>

        {/* Optional metadata */}
        <div className="space-y-2 mb-4">
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
              Strategy name (optional)
            </label>
            <input
              type="text"
              value={strategyName}
              onChange={(e) => setStrategyName(e.target.value)}
              placeholder="e.g. Bull Call Spread"
              className="w-full rounded border border-input bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
              data-testid="input-combo-strategy-name"
              maxLength={120}
            />
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
              Journal note (optional)
            </label>
            <textarea
              value={journal}
              onChange={(e) => setJournal(e.target.value)}
              placeholder="Why this trade?"
              rows={2}
              className="w-full rounded border border-input bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              data-testid="input-combo-journal"
              maxLength={1000}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={mut.isPending}
            data-testid="button-combo-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={mut.isPending || legs.length === 0}
            data-testid="button-combo-confirm"
          >
            {mut.isPending ? "Opening…" : "Confirm & Open"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: "buy" | "sell";
}) {
  const cls =
    tone === "buy"
      ? "text-signal-strong-buy"
      : tone === "sell"
        ? "text-signal-strong-sell"
        : "text-foreground";
  return (
    <div className="bg-card p-2 rounded">
      <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`text-[13px] font-mono font-bold tabular-nums mt-0.5 ${cls}`}>{value}</div>
      {sub && (
        <div className="text-[9px] font-mono text-muted-foreground/70 mt-0.5">{sub}</div>
      )}
    </div>
  );
}
