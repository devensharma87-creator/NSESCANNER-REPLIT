import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Gauge, Clock, Loader2, ShieldAlert } from "lucide-react";

interface ModeSnapshot {
  derived: string;
  override: string | null;
  effective: string;
  drivers: string[];
  dbLatencyMs: number | null;
  checkedAt: string;
  autoOpensAllowed: boolean;
}
interface DriftSnapshot {
  status: string;
  driftMs: number | null;
  rttMs: number | null;
  source: string | null;
  checkedAt: string | null;
  failureReason: string | null;
  note: string;
}
interface Resp {
  mode: ModeSnapshot;
  clockDrift: DriftSnapshot;
  tokenStaleness?: {
    active: boolean;
    totalTracked: number;
    staleCount: number;
    stalePct: number;
    checkedAt: string | null;
  };
  instrumentsIntegrity?: {
    lastCheckedDate: string | null;
    lastResult: string | null;
    changesDetected: number;
    failedToday: boolean;
  };
}

const base = import.meta.env.BASE_URL;
const MODES = ["NORMAL", "DEGRADED", "READ_ONLY", "HALT"] as const;

function modeBadgeCls(mode: string): string {
  if (mode === "NORMAL") return "border-emerald-600 text-emerald-600";
  if (mode === "DEGRADED") return "border-orange-500 text-orange-500";
  if (mode === "READ_ONLY") return "border-amber-500 text-amber-500";
  return "border-rose-600 text-rose-600";
}

function driftBadgeCls(status: string): string {
  if (status === "OK") return "border-emerald-600 text-emerald-600";
  if (status === "UNKNOWN") return "border-muted-foreground text-muted-foreground";
  if (status === "WARN") return "border-amber-500 text-amber-500";
  return "border-rose-600 text-rose-600";
}

export function SystemModePanel({ refreshTick }: { refreshTick: number }): React.ReactElement {
  const [data, setData] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${base}api/system/mode`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData((await r.json()) as Resp);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "fetch failed");
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 60_000);
    return () => clearInterval(id);
  }, [load, refreshTick]);

  async function setOverride(mode: string | null) {
    if (mode !== null && !window.confirm(`Set manual SystemMode override to ${mode}? New auto-opens stop unless NORMAL.`)) return;
    setBusy(true);
    try {
      const r = await fetch(`${base}api/system/mode-override`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "override failed");
    } finally {
      setBusy(false);
    }
  }

  const m = data?.mode;
  const d = data?.clockDrift;

  return (
    <Card data-testid="section-system-mode">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <Gauge className="h-5 w-5" /> System Mode &amp; Clock Drift
          {m && (
            <Badge variant="outline" className={modeBadgeCls(m.effective)} data-testid="system-mode-badge">
              {m.effective}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          BUG-28/29 — global operating mode (gates new auto-opens) + hourly clock-drift detection (host NTP does the actual sync).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {err && <div className="text-rose-500 flex items-center gap-2"><ShieldAlert className="h-4 w-4" /> {err}</div>}
        {!data && !err && <div className="text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
        {m && (
          <>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <div><span className="text-muted-foreground">Derived</span><div className="font-mono">{m.derived}</div></div>
              <div><span className="text-muted-foreground">Override</span><div className="font-mono">{m.override ?? "—"}</div></div>
              <div><span className="text-muted-foreground">DB latency</span><div className="font-mono">{m.dbLatencyMs != null ? `${m.dbLatencyMs}ms` : "check failed"}</div></div>
              <div><span className="text-muted-foreground">Auto-opens</span><div className="font-mono">{m.autoOpensAllowed ? "ALLOWED" : "BLOCKED"}</div></div>
            </div>
            {m.drivers.length > 0 && (
              <div className="text-xs text-muted-foreground">Drivers: <span className="font-mono">{m.drivers.join(", ")}</span></div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Manual override:</span>
              {MODES.map((mode) => (
                <Button
                  key={mode}
                  size="sm"
                  variant={m.override === mode ? "default" : "outline"}
                  disabled={busy}
                  onClick={() => void setOverride(mode)}
                  data-testid={`mode-override-${mode.toLowerCase()}`}
                >
                  {mode}
                </Button>
              ))}
              <Button size="sm" variant="ghost" disabled={busy || m.override === null} onClick={() => void setOverride(null)} data-testid="mode-override-clear">
                Clear
              </Button>
            </div>
          </>
        )}
        {d && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <Badge variant="outline" className={driftBadgeCls(d.status)} data-testid="clock-drift-badge">
              DRIFT {d.status}
            </Badge>
            <span className="font-mono text-xs">
              {d.driftMs != null ? `${d.driftMs}ms` : "—"} vs {d.source ?? "—"}
              {d.rttMs != null ? ` (rtt ${d.rttMs}ms)` : ""}
            </span>
            {d.failureReason && <span className="text-xs text-rose-500">{d.failureReason}</span>}
            <span className="text-[11px] text-muted-foreground w-full">{d.note}</span>
          </div>
        )}
        {data && (
          <div className="grid grid-cols-2 gap-2 border-t pt-3 text-xs md:grid-cols-2" data-testid="watchdog-row">
            <div>
              <span className="text-muted-foreground">Token staleness (BUG-30): </span>
              {data.tokenStaleness?.active ? (
                <span className="font-mono">
                  {data.tokenStaleness.staleCount}/{data.tokenStaleness.totalTracked} stale ({Math.round((data.tokenStaleness.stalePct ?? 0) * 100)}%)
                </span>
              ) : (
                <span className="text-muted-foreground">inactive (market closed / feed down)</span>
              )}
            </div>
            <div>
              <span className="text-muted-foreground">Instruments check (BUG-35): </span>
              <span className={`font-mono ${data.instrumentsIntegrity?.failedToday ? "text-rose-500" : ""}`}>
                {data.instrumentsIntegrity?.lastResult ?? "not run yet"}
                {data.instrumentsIntegrity?.lastCheckedDate ? ` (${data.instrumentsIntegrity.lastCheckedDate})` : ""}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
