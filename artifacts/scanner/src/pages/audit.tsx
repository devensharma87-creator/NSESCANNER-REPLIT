import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Shield, ShieldAlert, ShieldCheck, RefreshCw, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

type Severity = "ok" | "warn" | "fail";
interface AuditCheck {
  id: string;
  category: "auth" | "transport" | "secrets" | "headers" | "data" | "dependencies" | "rate_limit";
  title: string;
  status: Severity;
  detail: string;
  remediation?: string;
}
interface AuditReport {
  generatedAt: string;
  environment: "development" | "production" | "unknown";
  summary: { ok: number; warn: number; fail: number; total: number };
  score: number;
  checks: AuditCheck[];
}

const REFRESH_MS = 60_000;
const CATEGORY_LABEL: Record<AuditCheck["category"], string> = {
  auth: "Authentication",
  transport: "Transport / Cookies",
  secrets: "Secrets",
  headers: "HTTP Headers",
  data: "Data Handling",
  dependencies: "Dependencies",
  rate_limit: "Rate Limiting",
};

function StatusIcon({ status }: { status: Severity }) {
  if (status === "ok") return <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />;
  if (status === "warn") return <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden />;
  return <XCircle className="h-4 w-4 text-rose-500" aria-hidden />;
}

function statusBadge(s: Severity) {
  if (s === "ok") return <Badge variant="outline" className="border-emerald-600 text-emerald-600">PASS</Badge>;
  if (s === "warn") return <Badge variant="outline" className="border-amber-600 text-amber-600">WARN</Badge>;
  return <Badge variant="outline" className="border-rose-600 text-rose-600">FAIL</Badge>;
}

function scoreColor(score: number): string {
  if (score >= 90) return "text-emerald-500";
  if (score >= 75) return "text-amber-500";
  return "text-rose-500";
}

function ScoreIcon({ score }: { score: number }) {
  if (score >= 90) return <ShieldCheck className="h-12 w-12 text-emerald-500" aria-hidden />;
  if (score >= 75) return <Shield className="h-12 w-12 text-amber-500" aria-hidden />;
  return <ShieldAlert className="h-12 w-12 text-rose-500" aria-hidden />;
}

export default function AuditPage() {
  const [report, setReport] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);

  const base = import.meta.env.BASE_URL;

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`${base}api/security/audit`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as AuditReport;
      setReport(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "fetch failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [auto]);

  const groups: Record<string, AuditCheck[]> = {};
  if (report) {
    for (const c of report.checks) {
      const key = CATEGORY_LABEL[c.category];
      (groups[key] ??= []).push(c);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Security Audit</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Live audit of authentication, secrets, transport, headers, data handling, and dependencies.
            Re-runs automatically every 60 s.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setAuto((a) => !a)}>
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
          <CardContent className="pt-6 text-sm text-rose-500">Failed to load audit: {err}</CardContent>
        </Card>
      )}

      {report && (
        <>
          {/* Score header */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-6 flex-wrap">
                <ScoreIcon score={report.score} />
                <div>
                  <div className={`text-5xl font-bold ${scoreColor(report.score)}`}>{report.score}<span className="text-2xl text-muted-foreground">/100</span></div>
                  <div className="text-sm text-muted-foreground mt-1">
                    Environment: <span className="font-mono">{report.environment}</span> · Generated {new Date(report.generatedAt).toLocaleTimeString()}
                  </div>
                </div>
                <div className="ml-auto flex gap-3">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-emerald-500">{report.summary.ok}</div>
                    <div className="text-xs uppercase text-muted-foreground tracking-wide">Pass</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-amber-500">{report.summary.warn}</div>
                    <div className="text-xs uppercase text-muted-foreground tracking-wide">Warn</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-rose-500">{report.summary.fail}</div>
                    <div className="text-xs uppercase text-muted-foreground tracking-wide">Fail</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Failures first */}
          {report.summary.fail > 0 && (
            <Card className="border-rose-600/40">
              <CardHeader>
                <CardTitle className="text-rose-500">Action Required</CardTitle>
                <CardDescription>These failures must be fixed before going live.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {report.checks.filter(c => c.status === "fail").map(c => (
                  <div key={c.id} className="border border-rose-600/30 rounded-md p-3">
                    <div className="flex items-center gap-2 font-medium">
                      <StatusIcon status={c.status} /> {c.title}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">{c.detail}</div>
                    {c.remediation && (
                      <div className="text-sm mt-2"><span className="font-medium">Fix:</span> {c.remediation}</div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Grouped detail */}
          <div className="grid gap-4 md:grid-cols-2">
            {Object.entries(groups).map(([cat, items]) => (
              <Card key={cat}>
                <CardHeader>
                  <CardTitle className="text-lg">{cat}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {items.map(c => (
                    <div key={c.id} className="border-b border-border/50 last:border-b-0 pb-3 last:pb-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 font-medium text-sm">
                          <StatusIcon status={c.status} />
                          {c.title}
                        </div>
                        {statusBadge(c.status)}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{c.detail}</div>
                      {c.remediation && (
                        <div className="text-xs mt-1.5"><span className="font-medium">Fix:</span> {c.remediation}</div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
