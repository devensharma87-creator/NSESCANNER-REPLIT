/**
 * B.1/B.2 — Ledger Health Card.
 *
 * One-line reconciliation status for a paper-trading segment: fetches the
 * `/paper/account?segment=X&reconcile=1` snapshot every 60 s and shows one
 * of:
 *
 *   ✅ Reconciled   — actual balance matches the identity (drift within tolerance)
 *   ⚠  Drift ₹X    — actual balance is off by a material amount, click for detail
 *   ⌛ Loading…    — first fetch in flight
 *   ❌ Failed      — the reconciliation query itself errored (notes[] carries reason)
 *
 * Compact by default — a single row of chips. Click to expand into the full
 * snapshot (seed, expected, drift, open MTM, charges estimate, gross/net).
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, Loader2, XCircle, ChevronDown } from "lucide-react";
import { StatusChip } from "@/components/ui/status-chip";

const BASE = import.meta.env.BASE_URL;

async function fetchReconcile(segment: "FNO" | "EQUITY"): Promise<ReconciliationSnapshot> {
  const r = await fetch(`${BASE}api/paper/account?segment=${segment}&reconcile=1`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const body = await r.json();
      if (body?.error) msg = String(body.error);
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return (await r.json()) as ReconciliationSnapshot;
}

export interface ReconciliationSnapshot {
  segment: "FNO" | "EQUITY";
  istDate: string;
  computedAt: string;
  seedCapital: number;
  actualBalance: number;
  recordedDayRealizedPnl: number;
  capitalDeployedTodayOpen: number;
  closedTodayCount: number;
  closedTodayCapitalReturned: number;
  closedTodayRealizedPnl: number;
  carryOverOpenCount: number;
  carryOverCapitalDeployed: number;
  openMarkToMarketPnl: number;
  expectedBalance: number;
  driftAmount: number;
  reconciled: boolean;
  notes: string[];
  chargesEstimate: {
    estimatedTotal: number;
    estimatedToday: number;
    estimated: true;
    schedule: string;
  };
  grossRealizedPnl: number;
  estimatedNetRealizedPnl: number;
}

function fmtInr(n: number | null | undefined, opts?: { sign?: boolean }): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (opts?.sign) {
    const s = n === 0 ? "±" : n > 0 ? "+" : "−";
    return `${s}₹${abs}`;
  }
  return n < 0 ? `−₹${abs}` : `₹${abs}`;
}

export function LedgerHealthCard({ segment }: { segment: "FNO" | "EQUITY" }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["paper-reconcile", segment],
    queryFn: () => fetchReconcile(segment),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const state = useMemo<
    | { kind: "loading" }
    | { kind: "error"; msg: string }
    | { kind: "reconciled"; snap: ReconciliationSnapshot }
    | { kind: "drift"; snap: ReconciliationSnapshot }
  >(() => {
    if (q.isLoading) return { kind: "loading" };
    if (q.error) return { kind: "error", msg: (q.error as Error).message ?? "fetch failed" };
    const snap = q.data;
    if (!snap) return { kind: "error", msg: "no snapshot" };
    return { kind: snap.reconciled ? "reconciled" : "drift", snap };
  }, [q.isLoading, q.error, q.data]);

  return (
    <div
      className="rounded border border-border bg-secondary/20 text-xs font-mono"
      data-testid={`ledger-health-card-${segment}`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2 flex items-center gap-3 text-left"
        aria-expanded={open}
        data-testid={`ledger-health-toggle-${segment}`}
      >
        {state.kind === "loading" && (
          <StatusChip
            variant="info"
            testId={`ledger-health-${segment}-loading`}
            icon={<Loader2 className="w-3 h-3 animate-spin" />}
            label="Ledger health: checking…"
          />
        )}
        {state.kind === "error" && (
          <>
            <StatusChip
              variant="err"
              testId={`ledger-health-${segment}-error`}
              icon={<XCircle className="w-3 h-3" />}
              label="Reconciliation query failed"
            />
            <span className="text-muted-foreground truncate">— {state.msg}</span>
          </>
        )}
        {state.kind === "reconciled" && (
          <>
            <StatusChip
              variant="ok"
              testId={`ledger-health-${segment}-reconciled`}
              icon={<CheckCircle2 className="w-3 h-3" />}
              label="Ledger reconciled"
            />
            <span className="text-muted-foreground">
              balance {fmtInr(state.snap.actualBalance)} · seed {fmtInr(state.snap.seedCapital)}
            </span>
          </>
        )}
        {state.kind === "drift" && (
          <>
            <StatusChip
              variant="warn"
              testId={`ledger-health-${segment}-drift`}
              icon={<AlertTriangle className="w-3 h-3" />}
              label={`Ledger drift ${fmtInr(state.snap.driftAmount, { sign: true })}`}
            />
            <span className="text-muted-foreground truncate">
              — click for detail
            </span>
          </>
        )}
        <ChevronDown
          className={`w-3.5 h-3.5 text-muted-foreground ml-auto transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (state.kind === "reconciled" || state.kind === "drift") && (
        <div className="border-t border-border/60 px-3 py-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
          <span className="text-muted-foreground">Seed capital</span>
          <span className="text-right">{fmtInr(state.snap.seedCapital)}</span>

          <span className="text-muted-foreground">Actual balance</span>
          <span className="text-right">{fmtInr(state.snap.actualBalance)}</span>

          <span className="text-muted-foreground">Expected balance</span>
          <span className="text-right">{fmtInr(state.snap.expectedBalance)}</span>

          <span className="text-muted-foreground">Drift</span>
          <span
            className={`text-right ${
              state.snap.reconciled ? "text-emerald-300" : "text-amber-300"
            }`}
          >
            {fmtInr(state.snap.driftAmount, { sign: true })}
          </span>

          <span className="text-muted-foreground">Open MTM (info-only)</span>
          <span className="text-right">
            {fmtInr(state.snap.openMarkToMarketPnl, { sign: true })}
          </span>

          <span className="text-muted-foreground">Gross realized P&amp;L</span>
          <span className="text-right">
            {fmtInr(state.snap.grossRealizedPnl, { sign: true })}
          </span>

          <span className="text-muted-foreground">Est. charges (lifetime)</span>
          <span className="text-right">
            −{fmtInr(state.snap.chargesEstimate.estimatedTotal)}
          </span>

          <span className="text-muted-foreground">Est. NET realized P&amp;L</span>
          <span className="text-right">
            {fmtInr(state.snap.estimatedNetRealizedPnl, { sign: true })}
          </span>

          <span className="col-span-2 text-[10px] text-muted-foreground/70 pt-1">
            Charges are an estimate (schedule {state.snap.chargesEstimate.schedule}) — ledger records gross P&amp;L only.
          </span>

          {state.snap.notes.length > 0 && (
            <div className="col-span-2 pt-1 space-y-0.5">
              {state.snap.notes.map((n, i) => (
                <div key={i} className="text-amber-300/90 text-[10px]">• {n}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
