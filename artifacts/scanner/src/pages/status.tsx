import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, RefreshCw, CheckCircle2, AlertTriangle, XCircle, Info, Server, Database, Radio, Globe, Bell } from "lucide-react";

type Severity = "ok" | "warn" | "fail" | "info";

interface StatusItem {
  id: string;
  group: "core" | "data" | "feed" | "upstream" | "scheduled" | "alerts";
  title: string;
  status: Severity;
  detail: string;
  lastUpdated?: string | null;
  latencyMs?: number;
}

interface StatusReport {
  generatedAt: string;
  uptimeSec: number;
  marketState: "open" | "closed" | "pre_open";
  summary: { ok: number; warn: number; fail: number; info: number; total: number };
  items: StatusItem[];
}

const REFRESH_MS = 30_000;

const GROUP_META: Record<StatusItem["group"], { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  core: { label: "Core Server", icon: Server },
  data: { label: "Database", icon: Database },
  feed: { label: "Live Market Feed", icon: Radio },
  upstream: { label: "Upstream Data Sources", icon: Globe },
  alerts: { label: "TradingView Alerts", icon: Bell },
  scheduled: { label: "Scheduled Jobs", icon: Activity },
};

function StatusIcon({ status }: { status: Severity }) {
  if (status === "ok") return <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />;
  if (status === "warn") return <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden />;
  if (status === "fail") return <XCircle className="h-4 w-4 text-rose-500" aria-hidden />;
  return <Info className="h-4 w-4 text-sky-500" aria-hidden />;
}

function statusBadge(s: Severity) {
  const cls = {
    ok: "border-emerald-600 text-emerald-600",
    warn: "border-amber-600 text-amber-600",
    fail: "border-rose-600 text-rose-600",
    info: "border-sky-600 text-sky-600",
  }[s];
  return <Badge variant="outline" className={cls}>{s.toUpperCase()}</Badge>;
}

function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 48) return `${h}h ${remM}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function marketBadge(s: StatusReport["marketState"]) {
  if (s === "open") return <Badge className="bg-emerald-600 hover:bg-emerald-700">Market Open</Badge>;
  if (s === "pre_open") return <Badge className="bg-amber-600 hover:bg-amber-700">Pre-Open</Badge>;
  return <Badge variant="secondary">Market Closed</Badge>;
}

export default function StatusPage() {
  const [report, setReport] = useState<StatusReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);

  const base = import.meta.env.BASE_URL;

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`${base}api/system/status`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as StatusReport;
      setReport(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "fetch failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [auto]);

  const groups: Record<string, StatusItem[]> = {};
  if (report) {
    for (const it of report.items) (groups[it.group] ??= []).push(it);
  }

  // Derive overall health
  const overall: Severity = report
    ? report.summary.fail > 0 ? "fail" : report.summary.warn > 0 ? "warn" : "ok"
    : "info";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="h-7 w-7" /> System Status
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Real-time health of every subsystem, integration, and upstream feed. Auto-refreshes every 30 s.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setAuto(a => !a)}>
            Auto-refresh: {auto ? "ON" : "OFF"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {err && (
        <Card className="border-rose-600/40">
          <CardContent className="pt-6 text-sm text-rose-500">Failed to load status: {err}</CardContent>
        </Card>
      )}

      {report && (
        <>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-6 flex-wrap">
                <div className="flex items-center gap-3">
                  <StatusIcon status={overall} />
                  <div>
                    <div className="text-2xl font-bold">
                      {overall === "ok" ? "All Systems Operational"
                        : overall === "warn" ? "Degraded — investigate warnings"
                        : "Outage — failures present"}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Uptime {formatUptime(report.uptimeSec)} · Last check {new Date(report.generatedAt).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
                <div className="ml-auto flex items-center gap-4">
                  {marketBadge(report.marketState)}
                  <div className="text-center">
                    <div className="text-xl font-bold text-emerald-500">{report.summary.ok}</div>
                    <div className="text-[10px] uppercase text-muted-foreground tracking-wide">OK</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-bold text-amber-500">{report.summary.warn}</div>
                    <div className="text-[10px] uppercase text-muted-foreground tracking-wide">Warn</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-bold text-rose-500">{report.summary.fail}</div>
                    <div className="text-[10px] uppercase text-muted-foreground tracking-wide">Fail</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-bold text-sky-500">{report.summary.info}</div>
                    <div className="text-[10px] uppercase text-muted-foreground tracking-wide">Info</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            {(Object.keys(GROUP_META) as Array<keyof typeof GROUP_META>).map(g => {
              const items = groups[g];
              if (!items || items.length === 0) return null;
              const meta = GROUP_META[g];
              const Icon = meta.icon;
              return (
                <Card key={g}>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Icon className="h-5 w-5" />
                      {meta.label}
                    </CardTitle>
                    <CardDescription>{items.length} {items.length === 1 ? "check" : "checks"}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {items.map(it => (
                      <div key={it.id} className="border-b border-border/50 last:border-b-0 pb-3 last:pb-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 font-medium text-sm">
                            <StatusIcon status={it.status} />
                            {it.title}
                          </div>
                          <div className="flex items-center gap-2">
                            {typeof it.latencyMs === "number" && (
                              <span className="text-[10px] text-muted-foreground font-mono">{it.latencyMs} ms</span>
                            )}
                            {statusBadge(it.status)}
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{it.detail}</div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
