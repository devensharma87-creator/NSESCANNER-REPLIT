import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Scale, Loader2, Play } from "lucide-react";

interface ReconCheck {
  id: string;
  status: "OK" | "MISMATCH" | "SKIPPED";
  detail: string;
}
interface ReconRow {
  ist_date: string;
  status: string;
  checks: ReconCheck[];
  live_note: string;
  created_at: string;
}

const base = import.meta.env.BASE_URL;

export function ReconciliationPanel({ refreshTick }: { refreshTick: number }): React.ReactElement {
  const [reports, setReports] = useState<ReconRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${base}api/system/reconciliation?limit=7`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setReports(((await r.json()) as { reports: ReconRow[] }).reports);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "fetch failed");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshTick]);

  async function runNow() {
    setBusy(true);
    try {
      const r = await fetch(`${base}api/system/reconciliation/run`, { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "run failed");
    } finally {
      setBusy(false);
    }
  }

  const latest = reports[0];

  return (
    <Card data-testid="section-eod-reconciliation">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <Scale className="h-5 w-5" /> EOD Reconciliation
          {latest && (
            <Badge
              variant="outline"
              className={latest.status === "OK" ? "border-emerald-600 text-emerald-600" : "border-rose-600 text-rose-600"}
              data-testid="recon-status-badge"
            >
              {latest.ist_date} · {latest.status}
            </Badge>
          )}
          <Button size="sm" variant="outline" className="ml-auto" disabled={busy} onClick={() => void runNow()} data-testid="recon-run-btn">
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />} Run now
          </Button>
        </CardTitle>
        <CardDescription>BUG-31 — daily ≥15:35 IST: paper ledgers vs derivable invariants. Live broker recon lands with Section G.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {err && <div className="text-rose-500 text-xs">{err}</div>}
        {!latest && !err && <div className="text-muted-foreground text-xs">No report yet — first run happens after 15:35 IST (or click Run now).</div>}
        {latest && (
          <ul className="space-y-1">
            {latest.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-2 text-xs" data-testid={`recon-check-${c.id}`}>
                <span
                  className={`mt-0.5 inline-block h-2 w-2 rounded-full ${
                    c.status === "OK" ? "bg-emerald-500" : c.status === "MISMATCH" ? "bg-rose-500" : "bg-muted-foreground/40"
                  }`}
                />
                <span className="font-mono">{c.id}</span>
                <span className="text-muted-foreground">{c.detail}</span>
              </li>
            ))}
          </ul>
        )}
        {reports.length > 1 && (
          <div className="flex flex-wrap gap-1 border-t pt-2">
            {reports.slice(1).map((r) => (
              <Badge key={r.ist_date} variant="outline" className={r.status === "OK" ? "border-emerald-700/50 text-emerald-600" : "border-rose-700/50 text-rose-500"}>
                {r.ist_date.slice(5)} {r.status === "OK" ? "✓" : "✗"}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
