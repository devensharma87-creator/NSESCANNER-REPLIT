/**
 * W1A — F&O Evidence panel (owner-only, read-only).
 *
 * Visualises the P25 shadow-exit evidence accumulation: official count vs
 * threshold, remaining, pre-fix excluded rows, raw row count, and the
 * best-performing shadow rule so far. Strictly evidence display — no live
 * exit rule is changed by anything here.
 */
import { useState } from "react";
import { Receipt } from "lucide-react";
import { deriveP25Gate, latestTimestamp, type ShadowExitReportLite } from "@/lib/infraHealth";
import {
  PanelShell,
  StatCard,
  SafetyLabel,
  StateBody,
  money,
  num,
  useEndpoint,
} from "./primitives";

interface ShadowTradeRowLite {
  signalDate?: string | null;
  date?: string | null;
}
interface ShadowExitReport extends ShadowExitReportLite {
  generatedAt?: string;
  range?: { from: string | null; to: string | null };
  totals?: {
    actualPnl?: number;
    bestRule?: string | null;
    bestRuleDelta?: number;
  };
  improvedTopN?: ShadowTradeRowLite[];
  reducedTopN?: ShadowTradeRowLite[];
}

export function FoEvidencePanel({ nowMs: _nowMs, refreshTick }: { nowMs: number; refreshTick: number }) {
  const [localTick, setLocalTick] = useState(0);
  const state = useEndpoint<ShadowExitReport>(
    "api/paper/analytics/fo/shadow-exits",
    refreshTick + localTick,
  );
  const retry = () => setLocalTick((t) => t + 1);

  const p25 = deriveP25Gate(state.data);

  return (
    <PanelShell
      title="F&O Exit Evidence (P25)"
      icon={Receipt}
      severity={p25.enabled ? p25.severity : "disabled"}
      description="Shadow-exit evidence accumulation toward the P25 sample threshold."
      testId="panel-fo-evidence"
    >
      <div className="space-y-3">
        <SafetyLabel text="Evidence only — no live exit change approved." />
        <StateBody state={state} onRetry={retry}>
          {(d) => {
            const lastEvidenceDate = latestTimestamp([
              ...(d.improvedTopN ?? []).flatMap((r) => [r.signalDate, r.date]),
              ...(d.reducedTopN ?? []).flatMap((r) => [r.signalDate, r.date]),
            ]);
            return (
              <div className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <StatCard
                    label="Official / threshold"
                    value={`${p25.official}/${p25.threshold}`}
                    tone={p25.severity}
                  />
                  <StatCard label="Remaining" value={p25.remaining} />
                  <StatCard
                    label="Eligible trades"
                    value={p25.official}
                    hint="MFE-available rows"
                  />
                  <StatCard
                    label="Excluded (pre-fix 0/0)"
                    value={p25.excludedPreFix ?? "—"}
                    tone={(p25.excludedPreFix ?? 0) > 0 ? "warn" : undefined}
                  />
                  <StatCard
                    label="Raw rows"
                    value={num(p25.rawRowCount)}
                    hint="not the gate count"
                  />
                  <StatCard label="Gate" value={p25.gateOpen ? "OPEN" : "CLOSED"} tone={p25.severity} />
                  <StatCard label="Last evidence date" value={lastEvidenceDate ?? "—"} />
                  <StatCard
                    label="Best shadow rule"
                    value={d.totals?.bestRule ?? "—"}
                    hint={
                      d.totals?.bestRuleDelta != null ? `Δ ${money(d.totals.bestRuleDelta)}` : undefined
                    }
                  />
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Official tracker = <span className="font-mono">mfeAvailableCount</span>. Raw rows
                  include pre-P20-fix 0/0 placeholders and are shown for context only — they never
                  count toward the gate.
                </div>
              </div>
            );
          }}
        </StateBody>
      </div>
    </PanelShell>
  );
}
