/**
 * W1A — Shared visual + data primitives for the Pro Operations Console
 * panels on /infra-health (and the public freshness strip).
 *
 * READ-ONLY surface. `useEndpoint` issues credentialed GETs only; nothing
 * here writes, mutates, or triggers a trade/signal/ingestion path. This
 * module is intentionally self-contained (its own `useEndpoint`) so it
 * does NOT refactor the existing infra-health.tsx primitives.
 */
import { useCallback, useEffect, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, PauseCircle, XCircle, RefreshCw, Inbox } from "lucide-react";
import { SEVERITY_LABEL, formatAge, deriveAgeSeverity, type Severity } from "@/lib/infraHealth";

const REFRESH_MS = 60_000;

// ── data hook (credentialed GET, mirrors infra-health.tsx) ─────────────────

export interface FetchState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  status: number | null;
}

export function useEndpoint<T>(path: string, refreshTick: number, auto = true): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    error: null,
    loading: true,
    status: null,
  });
  const base = import.meta.env.BASE_URL;
  const url = `${base}${path.replace(/^\//, "")}`;

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) {
        setState({ data: null, error: `HTTP ${r.status}`, loading: false, status: r.status });
        return;
      }
      const j = (await r.json()) as T;
      setState({ data: j, error: null, loading: false, status: r.status });
    } catch (e) {
      setState({
        data: null,
        error: e instanceof Error ? e.message : "network error",
        loading: false,
        status: null,
      });
    }
  }, [url]);

  useEffect(() => {
    void load();
  }, [load, refreshTick]);
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [auto, load]);

  return state;
}

// ── formatting ─────────────────────────────────────────────────────────────

export function num(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: digits });
}
export function pctText(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}
export function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}₹${Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

// ── severity atoms ───────────────────────────────────────────────────────────

export function SeverityIcon({ s, className }: { s: Severity; className?: string }) {
  const cls = className ?? "h-4 w-4";
  if (s === "ok") return <CheckCircle2 className={`${cls} text-emerald-500`} aria-hidden />;
  if (s === "warn" || s === "stale")
    return <AlertTriangle className={`${cls} text-amber-500`} aria-hidden />;
  if (s === "disabled") return <PauseCircle className={`${cls} text-muted-foreground`} aria-hidden />;
  return <XCircle className={`${cls} text-rose-500`} aria-hidden />;
}

const SEV_CLS: Record<Severity, string> = {
  ok: "border-emerald-600 text-emerald-600",
  warn: "border-amber-600 text-amber-600",
  stale: "border-amber-600 text-amber-600",
  fail: "border-rose-600 text-rose-600",
  disabled: "border-muted-foreground text-muted-foreground",
};
export function StatusBadge({ s, label }: { s: Severity; label?: string }) {
  return (
    <Badge variant="outline" className={SEV_CLS[s]} data-testid={`badge-status-${s}`}>
      {label ?? SEVERITY_LABEL[s]}
    </Badge>
  );
}

export function FreshnessBadge({
  at,
  nowMs,
  thresholdMin = 30,
}: {
  at: string | null | undefined;
  nowMs: number;
  thresholdMin?: number;
}) {
  const s = deriveAgeSeverity(at ?? null, nowMs, thresholdMin);
  return (
    <span className="inline-flex items-center gap-1.5">
      <SeverityIcon s={s} className="h-3.5 w-3.5" />
      <span className="font-mono text-[11px] text-muted-foreground">{formatAge(at ?? null, nowMs)}</span>
    </span>
  );
}

export function SafetyLabel({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-amber-600/40 bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-amber-600/90 flex items-center gap-1.5">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {text}
    </div>
  );
}

// ── layout ───────────────────────────────────────────────────────────────────

export function StatCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: Severity;
  hint?: string;
}) {
  const toneCls =
    tone === "ok"
      ? "text-emerald-500"
      : tone === "warn" || tone === "stale"
        ? "text-amber-500"
        : tone === "fail"
          ? "text-rose-500"
          : "text-foreground";
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-mono text-lg leading-tight ${toneCls}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

export function PanelShell({
  title,
  icon: Icon,
  severity,
  description,
  right,
  children,
  testId,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  severity: Severity;
  description?: string;
  right?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Icon className="h-5 w-5" />
              {title}
            </CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </div>
          <div className="flex items-center gap-2">
            {right}
            <SeverityIcon s={severity} />
            <StatusBadge s={severity} />
          </div>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function EmptyState({
  message,
  detail,
  onRetry,
}: {
  message: string;
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
      <Inbox className="h-6 w-6 text-muted-foreground" aria-hidden />
      <div className="text-sm text-muted-foreground">{message}</div>
      {detail && <div className="text-xs text-muted-foreground/80 max-w-md">{detail}</div>}
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-1">
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Retry
        </Button>
      )}
    </div>
  );
}

/**
 * Uniform loading / error / empty / 401-403 handling. On an owner-only
 * gate (401/403) it shows a calm "Owner payload pending / diagnostic
 * unavailable" message rather than a raw HTTP error or a stack trace.
 */
export function StateBody<T>({
  state,
  onRetry,
  emptyMessage,
  isEmpty,
  children,
}: {
  state: FetchState<T>;
  onRetry?: () => void;
  emptyMessage?: string;
  isEmpty?: (d: T) => boolean;
  children: (d: T) => ReactNode;
}) {
  if (state.loading && !state.data) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-8 rounded bg-muted/40 animate-pulse" />
        ))}
      </div>
    );
  }
  if (state.error || !state.data) {
    const owner = state.status === 401 || state.status === 403;
    return (
      <EmptyState
        message={owner ? "Owner payload pending / diagnostic unavailable" : "No live data"}
        detail={
          owner
            ? "This diagnostic needs an owner session, or the feature is disabled in this environment."
            : `Last attempt failed${state.error ? `: ${state.error}` : ""}.`
        }
        onRetry={onRetry}
      />
    );
  }
  if (isEmpty && isEmpty(state.data)) {
    return (
      <EmptyState
        message={emptyMessage ?? "No data yet"}
        detail="The diagnostic returned no rows for this window."
        onRetry={onRetry}
      />
    );
  }
  return <>{children(state.data)}</>;
}
