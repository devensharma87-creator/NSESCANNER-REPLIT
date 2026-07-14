/**
 * W1A — Swing B1/B3 Shadow Diagnostics panel (owner-only, read-only).
 *
 * Surfaces the H10b shadow-score diagnostic: how the candidate B1 / B3
 * scoring tweaks WOULD move scores vs the live scoring, without changing
 * any live score, action, or trade. Strictly a diagnostic mirror.
 */
import { useState } from "react";
import { Brain } from "lucide-react";
import type { Severity } from "@/lib/infraHealth";
import {
  PanelShell,
  StatCard,
  SafetyLabel,
  StateBody,
  num,
  useEndpoint,
} from "./primitives";

interface ShadowRowOut {
  symbol: string;
  liveScore: number | null;
  liveAction: string | null;
  b1ShadowScore: number | null;
  b3ShadowScore: number | null;
  b1Delta: number | null;
  b3Delta: number | null;
  dataQuality: "OK" | "PARTIAL" | "INSUFFICIENT";
}
interface ShadowPayload {
  scanDate: string | null;
  totalRows: number;
  topByLive?: ShadowRowOut[];
  topByB1?: ShadowRowOut[];
  topByB3?: ShadowRowOut[];
  promotedByB1?: ShadowRowOut[];
  demotedByB1?: ShadowRowOut[];
  promotedByB3?: ShadowRowOut[];
  demotedByB3?: ShadowRowOut[];
}

function fmtDelta(n: number | null): { text: string; cls: string } {
  if (n == null || !Number.isFinite(n)) return { text: "—", cls: "text-muted-foreground" };
  const sign = n > 0 ? "+" : "";
  const cls = n > 0 ? "text-emerald-500" : n < 0 ? "text-rose-500" : "text-muted-foreground";
  return { text: `${sign}${n.toFixed(1)}`, cls };
}

export function ShadowDiagnosticsPanel({
  nowMs: _nowMs,
  refreshTick,
}: {
  nowMs: number;
  refreshTick: number;
}) {
  const [localTick, setLocalTick] = useState(0);
  const state = useEndpoint<ShadowPayload>(
    "api/stocks-to-watch/diagnostics/swing-shadow-score",
    refreshTick + localTick,
  );
  const retry = () => setLocalTick((t) => t + 1);

  const severity: Severity = state.data ? "ok" : "disabled";

  return (
    <PanelShell
      title="Swing Shadow Diagnostics (B1 / B3)"
      icon={Brain}
      severity={severity}
      description="How candidate B1/B3 scoring tweaks would move scores vs live. Mirror only."
      testId="panel-shadow-diagnostics"
    >
      <div className="space-y-3">
        <SafetyLabel text="Diagnostic only — not live scoring." />
        <StateBody state={state} onRetry={retry} emptyMessage="No shadow rows for the latest scan">
          {(d) => {
            const rows = (d.topByLive ?? []).slice(0, 12);
            return (
              <div className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <StatCard label="Scan date" value={d.scanDate ?? "—"} />
                  <StatCard label="Total rows" value={num(d.totalRows)} />
                  <StatCard
                    label="B1 promoted / demoted"
                    value={`${num(d.promotedByB1?.length)} / ${num(d.demotedByB1?.length)}`}
                  />
                  <StatCard
                    label="B3 promoted / demoted"
                    value={`${num(d.promotedByB3?.length)} / ${num(d.demotedByB3?.length)}`}
                  />
                </div>

                {rows.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground">
                        <tr className="border-b border-border/50">
                          <th className="text-left py-1.5">Symbol</th>
                          <th className="text-right py-1.5">Live</th>
                          <th className="text-right py-1.5">B1</th>
                          <th className="text-right py-1.5">Δ B1</th>
                          <th className="text-right py-1.5">B3</th>
                          <th className="text-right py-1.5">Δ B3</th>
                          <th className="text-right py-1.5">Quality</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => {
                          const d1 = fmtDelta(r.b1Delta);
                          const d3 = fmtDelta(r.b3Delta);
                          return (
                            <tr key={r.symbol} className="border-b border-border/30 last:border-b-0">
                              <td className="py-1.5 font-mono">{r.symbol}</td>
                              <td className="text-right font-mono">{num(r.liveScore, 1)}</td>
                              <td className="text-right font-mono">{num(r.b1ShadowScore, 1)}</td>
                              <td className={`text-right font-mono ${d1.cls}`}>{d1.text}</td>
                              <td className="text-right font-mono">{num(r.b3ShadowScore, 1)}</td>
                              <td className={`text-right font-mono ${d3.cls}`}>{d3.text}</td>
                              <td className="text-right text-muted-foreground">{r.dataQuality}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground italic">
                    No top-by-live rows returned for the latest scan.
                  </div>
                )}
              </div>
            );
          }}
        </StateBody>
      </div>
    </PanelShell>
  );
}
