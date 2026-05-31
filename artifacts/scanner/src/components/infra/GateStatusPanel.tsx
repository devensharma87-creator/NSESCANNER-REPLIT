/**
 * W1A — Gate Status panel (owner-only, read-only).
 *
 * Combines the static human-sign-off verification ledger
 * (`VERIFICATION_STATUS`) with the LIVE P25 evidence gate derived from the
 * shadow-exit endpoint. The P25 row's count is always live (never the
 * static config) and uses the official `mfeAvailableCount` tracker via
 * `deriveP25Gate`. Display only — nothing here flips a runtime gate.
 */
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import {
  deriveP25Gate,
  gateStateToSeverity,
  rollUp,
  type Severity,
  type ShadowExitReportLite,
} from "@/lib/infraHealth";
import { VERIFICATION_STATUS } from "@/config/verificationStatus";
import { PanelShell, StatusBadge, StateBody, useEndpoint } from "./primitives";

export function GateStatusPanel({ nowMs: _nowMs, refreshTick }: { nowMs: number; refreshTick: number }) {
  const [localTick, setLocalTick] = useState(0);
  const state = useEndpoint<ShadowExitReportLite>(
    "api/paper/analytics/fo/shadow-exits",
    refreshTick + localTick,
  );
  const retry = () => setLocalTick((t) => t + 1);

  const p25 = deriveP25Gate(state.data);
  const staticSeverities = VERIFICATION_STATUS.map((e) => gateStateToSeverity(e.state));
  const severity: Severity = rollUp([...staticSeverities, p25.severity]);

  return (
    <PanelShell
      title="Gate Status"
      icon={ShieldCheck}
      severity={severity}
      description="Verification ledger + live P25 evidence gate. Display only — no runtime gate is changed here."
      testId="panel-gate-status"
    >
      <div className="space-y-4">
        {/* Live P25 evidence gate */}
        <div className="rounded-lg border border-border/60 bg-card/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">P25 · F&amp;O exit-evidence gate (live)</div>
            <StatusBadge
              s={p25.enabled ? p25.severity : "disabled"}
              label={!p25.enabled ? "DISABLED" : p25.gateOpen ? "OPEN" : "CLOSED"}
            />
          </div>
          {p25.enabled ? (
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div>
                <div className="text-muted-foreground text-[10px] uppercase tracking-wide">Official</div>
                <div className="font-mono text-base">
                  {p25.official}/{p25.threshold}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[10px] uppercase tracking-wide">Remaining</div>
                <div className="font-mono text-base">{p25.remaining}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-[10px] uppercase tracking-wide">
                  Excluded (pre-fix 0/0)
                </div>
                <div className="font-mono text-base">{p25.excludedPreFix ?? "—"}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-[10px] uppercase tracking-wide">Raw rows</div>
                <div className="font-mono text-base text-muted-foreground">{p25.rawRowCount ?? "—"}</div>
              </div>
            </div>
          ) : (
            <div className="mt-2 text-xs text-muted-foreground">
              Shadow-exit reporting is disabled in this environment ({"PAPER_FO_SHADOW_EXITS_ENABLED"} off).
            </div>
          )}
          <div className="mt-2 text-[10px] text-muted-foreground">
            Official tracker = <span className="font-mono">mfeAvailableCount</span> (predicate: NOT
            max_runup=0 AND max_drawdown=0). Raw rows are NOT the gate count.
          </div>
          {state.error && (state.status === 401 || state.status === 403) && (
            <div className="mt-2 text-[11px] text-muted-foreground">
              Owner payload pending — counts shown as defaults until an owner session loads.
            </div>
          )}
        </div>

        {/* Static verification ledger */}
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            Verification ledger (human sign-off)
          </div>
          <ul className="space-y-1">
            {VERIFICATION_STATUS.map((e) => (
              <li
                key={e.id}
                className="flex items-start justify-between gap-3 border-b border-border/30 py-1.5 last:border-b-0"
                data-testid={`gate-row-${e.id}`}
              >
                <div className="min-w-0">
                  <div className="text-xs font-medium">{e.label}</div>
                  {e.note && <div className="text-[10px] text-muted-foreground">{e.note}</div>}
                </div>
                <StatusBadge s={gateStateToSeverity(e.state)} label={e.status} />
              </li>
            ))}
          </ul>
        </div>

        {/* Keep retry reachable even though the panel renders without data */}
        {state.error && !(state.status === 401 || state.status === 403) && (
          <StateBody state={state} onRetry={retry}>
            {() => null}
          </StateBody>
        )}
      </div>
    </PanelShell>
  );
}
