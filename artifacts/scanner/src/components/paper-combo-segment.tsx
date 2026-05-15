/**
 * Combo paper-trading section for /paper-trading.
 *
 * Strict isolation from EQ + single-leg F&O lanes:
 *   - Reads only `/api/paper/combos` (its own table).
 *   - Does not consume any F&O heat / DD stats.
 *   - No auto-trader entry — manual close via the combo close endpoint.
 *
 * UI shape:
 *   - Open combos table: legs collapsed; click a row to expand and see
 *     per-leg entry / current premiums + MTM source (chain / BS / WS).
 *   - Manual "Close" button per row → confirmation modal → server reprices
 *     and posts close, returns realised P&L which we toast.
 *   - Closed combos table below: per-leg entry/exit, realized P&L total.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPaperCombos,
  useClosePaperCombo,
  getListPaperCombosQueryKey,
  type PaperCombo,
  type PaperComboLeg,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";

const fmtR = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return "—";
  return (n >= 0 ? "+₹" : "−₹") + Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
};

const fmtPx = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n)
    ? "—"
    : n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return (
      d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) +
      " · " +
      d.toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
    );
  } catch {
    return iso;
  }
};

export function PaperComboSegment() {
  const openQ = useListPaperCombos(
    { status: "OPEN" },
    {
      query: {
        refetchInterval: 15_000,
        staleTime: 10_000,
        queryKey: getListPaperCombosQueryKey({ status: "OPEN" }),
      },
    },
  );
  const closedQ = useListPaperCombos(
    { status: "CLOSED" },
    {
      query: {
        refetchInterval: 60_000,
        staleTime: 30_000,
        queryKey: getListPaperCombosQueryKey({ status: "CLOSED" }),
      },
    },
  );

  const open = openQ.data?.combos ?? [];
  const closed = closedQ.data?.combos ?? [];

  return (
    <div className="space-y-6" data-testid="combo-segment">
      {/* Lane warning header */}
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="p-3 flex gap-2 items-start">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-[11px] font-mono text-amber-200/90 leading-relaxed">
            <strong>Manual combo lane.</strong> Multi-leg paper trades opened
            from the Strategy Builder. Isolated from the F&amp;O auto-trader —
            does <em>not</em> share heat budget, DD caps, or 15:20 force-exit.
            Capital is tracked per-combo (no combined account here yet).
          </div>
        </CardContent>
      </Card>

      <ComboTable
        title="Open combos"
        combos={open}
        loading={openQ.isLoading}
        empty="No open combos. Build one in the Strategy Builder and click 'Send to Combo Paper Trade'."
        showClose
      />
      <ComboTable
        title="Closed combos"
        combos={closed}
        loading={closedQ.isLoading}
        empty="No closed combos yet."
      />
    </div>
  );
}

function ComboTable({
  title,
  combos,
  loading,
  empty,
  showClose = false,
}: {
  title: string;
  combos: PaperCombo[];
  loading: boolean;
  empty: string;
  showClose?: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <Card>
      <CardContent className="p-0">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-mono font-semibold uppercase tracking-wider">
            {title}{" "}
            <span className="text-muted-foreground/70 font-normal">({combos.length})</span>
          </h3>
        </div>
        {loading ? (
          <div className="p-3 space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : combos.length === 0 ? (
          <div className="p-6 text-center text-xs font-mono text-muted-foreground" data-testid="combo-empty">
            {empty}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] font-mono">
              <thead className="bg-muted/30 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 w-6"></th>
                  <th className="px-2 py-1.5 text-left">Underlying</th>
                  <th className="px-2 py-1.5 text-left">Strategy</th>
                  <th className="px-2 py-1.5 text-left">Expiry</th>
                  <th className="px-2 py-1.5 text-right">Legs</th>
                  <th className="px-2 py-1.5 text-right">Capital</th>
                  <th className="px-2 py-1.5 text-right">P&amp;L</th>
                  <th className="px-2 py-1.5 text-left">{showClose ? "Opened" : "Closed"}</th>
                  {showClose && <th className="px-2 py-1.5 text-right pr-3"></th>}
                </tr>
              </thead>
              <tbody>
                {combos.map((c) => (
                  <ComboRow
                    key={c.id}
                    combo={c}
                    expanded={expanded.has(c.id)}
                    onToggle={() => toggle(c.id)}
                    showClose={showClose}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ComboRow({
  combo,
  expanded,
  onToggle,
  showClose,
}: {
  combo: PaperCombo;
  expanded: boolean;
  onToggle: () => void;
  showClose: boolean;
}) {
  const pnl = combo.status === "OPEN" ? combo.netMtm : combo.realizedPnl;
  const pnlTone = pnl == null ? "" : pnl > 0 ? "text-signal-strong-buy" : pnl < 0 ? "text-signal-strong-sell" : "";
  const [closeOpen, setCloseOpen] = useState(false);

  return (
    <>
      <tr
        className="border-t border-border/60 hover:bg-muted/20 cursor-pointer"
        onClick={onToggle}
        data-testid={`combo-row-${combo.id}`}
      >
        <td className="px-2 py-1.5">
          {expanded ? (
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3 h-3 text-muted-foreground" />
          )}
        </td>
        <td className="px-2 py-1.5 font-bold">{combo.underlying}</td>
        <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[160px]" title={combo.strategyName ?? ""}>
          {combo.strategyName ?? "—"}
        </td>
        <td className="px-2 py-1.5 text-muted-foreground tabular-nums">
          {combo.expiry}{" "}
          <span className="text-[9px] text-muted-foreground/60">({combo.daysToExpiry}d)</span>
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums">{combo.legs.length}</td>
        <td className="px-2 py-1.5 text-right tabular-nums">
          ₹{Math.round(combo.capitalDeployed).toLocaleString("en-IN")}
        </td>
        <td className={`px-2 py-1.5 text-right tabular-nums font-bold ${pnlTone}`} data-testid={`combo-pnl-${combo.id}`}>
          {fmtR(pnl)}
        </td>
        <td className="px-2 py-1.5 text-muted-foreground text-[10px]">
          {showClose ? fmtDateTime(combo.openedAt) : fmtDateTime(combo.closedAt)}
          {!showClose && combo.closeReason ? (
            <Badge variant="outline" className="ml-1 text-[8px] px-1 py-0">
              {combo.closeReason}
            </Badge>
          ) : null}
        </td>
        {showClose && (
          <td className="px-2 py-1.5 text-right pr-3" onClick={(e) => e.stopPropagation()}>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px] px-2"
              onClick={() => setCloseOpen(true)}
              data-testid={`button-close-combo-${combo.id}`}
            >
              Close
            </Button>
          </td>
        )}
      </tr>
      {expanded && (
        <tr data-testid={`combo-legs-${combo.id}`}>
          <td colSpan={showClose ? 9 : 8} className="bg-muted/10 px-3 py-2">
            <ComboLegsDetail combo={combo} />
          </td>
        </tr>
      )}
      {showClose && closeOpen && (
        <tr>
          <td colSpan={9} className="p-0">
            <CloseComboDialog
              combo={combo}
              onClose={() => setCloseOpen(false)}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function ComboLegsDetail({ combo }: { combo: PaperCombo }) {
  const isOpen = combo.status === "OPEN";
  return (
    <div className="border border-border/60 rounded overflow-hidden">
      <table className="w-full text-[10px] font-mono">
        <thead className="bg-muted/30 text-muted-foreground">
          <tr>
            <th className="px-2 py-1 text-left">#</th>
            <th className="px-2 py-1 text-left">Side</th>
            <th className="px-2 py-1 text-right">Strike</th>
            <th className="px-2 py-1 text-right">Lots</th>
            <th className="px-2 py-1 text-right">Qty</th>
            <th className="px-2 py-1 text-right">Entry</th>
            <th className="px-2 py-1 text-right">{isOpen ? "Current" : "Exit"}</th>
            <th className="px-2 py-1 text-right">{isOpen ? "uPnL" : "P&L"}</th>
            <th className="px-2 py-1 text-left">Src</th>
          </tr>
        </thead>
        <tbody>
          {combo.legs.map((leg) => (
            <LegDetailRow key={leg.id} leg={leg} isOpen={isOpen} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LegDetailRow({ leg, isOpen }: { leg: PaperComboLeg; isOpen: boolean }) {
  const sideTone =
    leg.action === "BUY" ? "text-signal-strong-buy" : "text-signal-strong-sell";
  const exitOrLast = isOpen ? leg.lastPremium : leg.exitPremium;
  const sign = leg.action === "BUY" ? 1 : -1;
  const entry = leg.entryPremium;
  const cur = exitOrLast ?? null;
  const pnl = cur != null && entry != null ? sign * (cur - entry) * leg.qty : null;
  const pnlTone = pnl == null ? "" : pnl > 0 ? "text-signal-strong-buy" : pnl < 0 ? "text-signal-strong-sell" : "";
  const src = isOpen ? leg.lastSource ?? leg.entrySource : leg.entrySource;
  return (
    <tr className="border-t border-border/40" data-testid={`leg-row-${leg.id}`}>
      <td className="px-2 py-1 text-muted-foreground">{leg.legIndex + 1}</td>
      <td className={`px-2 py-1 font-bold ${sideTone}`}>
        {leg.action} {leg.optionType}
      </td>
      <td className="px-2 py-1 text-right tabular-nums">{leg.strike}</td>
      <td className="px-2 py-1 text-right tabular-nums">{leg.lots}</td>
      <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{leg.qty}</td>
      <td className="px-2 py-1 text-right tabular-nums">{fmtPx(entry)}</td>
      <td className="px-2 py-1 text-right tabular-nums">{fmtPx(cur)}</td>
      <td className={`px-2 py-1 text-right tabular-nums font-bold ${pnlTone}`}>{fmtR(pnl)}</td>
      <td className="px-2 py-1 text-left text-[9px] uppercase text-muted-foreground/70" data-testid={`leg-src-${leg.id}`}>
        {src ?? "—"}
      </td>
    </tr>
  );
}

function CloseComboDialog({ combo, onClose }: { combo: PaperCombo; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [journal, setJournal] = useState("");
  const mut = useClosePaperCombo({
    mutation: {
      onSuccess: (resp) => {
        toast({
          title: "Combo closed",
          description: `${resp.combo.underlying} · realized ${fmtR(resp.combo.realizedPnl)}`,
        });
        void qc.invalidateQueries({ queryKey: getListPaperCombosQueryKey() });
        void qc.invalidateQueries({ queryKey: ["paper", "combos"] });
        onClose();
      },
      onError: (err) => {
        toast({
          title: "Close failed",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      },
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={() => !mut.isPending && onClose()}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Close combo paper trade"
        data-testid="dialog-close-combo"
      >
        <h3 className="text-base font-semibold mb-1">Close this combo?</h3>
        <p className="text-xs text-muted-foreground font-mono mb-3">
          {combo.underlying} · {combo.expiry} · {combo.legs.length} legs · current MTM{" "}
          <span className="font-bold">{fmtR(combo.netMtm)}</span>
        </p>
        <p className="text-[11px] text-muted-foreground mb-3">
          Server reprices each leg from the live chain at close. Realised P&amp;L
          is whatever those marks produce — it is not editable here.
        </p>
        <label className="block text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
          Journal note (optional)
        </label>
        <textarea
          value={journal}
          onChange={(e) => setJournal(e.target.value)}
          rows={2}
          className="w-full rounded border border-input bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring resize-none mb-3"
          maxLength={1000}
          data-testid="input-close-journal"
        />
        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="ghost" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              mut.mutate({ id: combo.id, data: journal.trim() ? { journal: journal.trim() } : {} })
            }
            disabled={mut.isPending}
            data-testid="button-confirm-close-combo"
          >
            {mut.isPending ? "Closing…" : "Confirm close"}
          </Button>
        </div>
      </div>
    </div>
  );
}
