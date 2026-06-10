/**
 * W1A — Sector Strength panel (owner-only, read-only).
 *
 * Aggregates the latest swing-scan cohort by sector (member count, average
 * score / RS, action histogram, rank). This is the S4b diagnostic surface;
 * sector activation (S4c–S4f) remains NOT approved, so nothing here feeds
 * scoring, action, or trade selection.
 */
import { useState } from "react";
import { Layers } from "lucide-react";
import type { Severity } from "@/lib/infraHealth";
import {
  PanelShell,
  StatCard,
  SafetyLabel,
  StateBody,
  num,
  useEndpoint,
} from "./primitives";

interface SectorRow {
  sector: string;
  memberCount: number;
  confident: boolean;
  rank: number | null;
  avgScore: number;
  avgRsScore: number | null;
  actionCounts: Record<string, number>;
  topByScore: Array<{ symbol: string; score: number }>;
}
interface SectorSummary {
  scanDate: string | null;
  totalRows: number;
  totalSectors: number;
  confidentSectors: number;
  minMembers: number;
  excludedNoSector?: number;
  unavailableMetrics: Array<{ metric: string; reason: string }>;
  sectors: SectorRow[];
}

export function SectorStrengthPanel({
  nowMs: _nowMs,
  refreshTick,
}: {
  nowMs: number;
  refreshTick: number;
}) {
  const [localTick, setLocalTick] = useState(0);
  const state = useEndpoint<SectorSummary>(
    "api/stocks-to-watch/diagnostics/sector-strength",
    refreshTick + localTick,
  );
  const retry = () => setLocalTick((t) => t + 1);

  const severity: Severity = state.data ? "ok" : "disabled";

  return (
    <PanelShell
      title="Sector Strength (S4b)"
      icon={Layers}
      severity={severity}
      description="Latest swing cohort aggregated by sector. Sector activation (S4c–S4f) remains not approved."
      testId="panel-sector-strength"
    >
      <div className="space-y-3">
        <SafetyLabel text="Diagnostic only — not live scoring." />
        <StateBody state={state} onRetry={retry} emptyMessage="No sector rows for the latest scan">
          {(d) => {
            const ranked = [...d.sectors].sort((a, b) => {
              const ra = a.rank ?? Number.POSITIVE_INFINITY;
              const rb = b.rank ?? Number.POSITIVE_INFINITY;
              if (ra !== rb) return ra - rb;
              return b.avgScore - a.avgScore;
            });
            return (
              <div className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <StatCard label="Scan date" value={d.scanDate ?? "—"} />
                  <StatCard label="Rows" value={num(d.totalRows)} />
                  <StatCard
                    label="Sectors"
                    value={num(d.totalSectors)}
                    hint={`${num(d.confidentSectors)} confident`}
                  />
                  <StatCard
                    label="Min members"
                    value={num(d.minMembers)}
                    hint={d.excludedNoSector ? `${num(d.excludedNoSector)} excl. (no sector)` : undefined}
                  />
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground">
                      <tr className="border-b border-border/50">
                        <th className="text-left py-1.5">#</th>
                        <th className="text-left py-1.5">Sector</th>
                        <th className="text-right py-1.5">Members</th>
                        <th className="text-right py-1.5">Avg score</th>
                        <th className="text-right py-1.5">Avg RS</th>
                        <th className="text-left py-1.5 pl-3">Top names</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ranked.map((s) => (
                        <tr
                          key={s.sector}
                          className={`border-b border-border/30 last:border-b-0 ${
                            s.confident ? "" : "opacity-60"
                          }`}
                        >
                          <td className="py-1.5 font-mono text-muted-foreground">{s.rank ?? "—"}</td>
                          <td className="py-1.5">{s.sector}</td>
                          <td className="text-right font-mono">{num(s.memberCount)}</td>
                          <td className="text-right font-mono">{num(s.avgScore, 1)}</td>
                          <td className="text-right font-mono">{num(s.avgRsScore, 1)}</td>
                          <td className="pl-3 text-muted-foreground font-mono text-[11px]">
                            {s.topByScore
                              .slice(0, 3)
                              .map((t) => t.symbol)
                              .join(", ") || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {d.unavailableMetrics.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                      Unavailable metrics ({d.unavailableMetrics.length})
                    </summary>
                    <ul className="mt-1.5 space-y-1">
                      {d.unavailableMetrics.map((m) => (
                        <li key={m.metric} className="text-[11px] text-muted-foreground">
                          <span className="font-mono">{m.metric}</span> — {m.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {d.sectors.some((s) => !s.confident) && (
                  <div className="text-[10px] text-muted-foreground">
                    Dimmed rows are low-confidence (member count &lt; {num(d.minMembers)}).
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
