/**
 * F&O Exit Monitoring Reliability (T007) — owner-only observability + manual
 * control widget for `/paper/diagnostics/fo/exit-monitor/*`.
 *
 * Read-only aggregate health (cycle counters + sub-system statuses) plus a
 * manual "Run Dry" (zero side-effects) / "Run Now" (may close the selected
 * trade via the SAME evaluator + close path the scheduler uses) action on a
 * single open F&O paper trade picked from a dropdown. Purely presentational
 * — all fetching/mutating lives in the parent page; this component never
 * calls an endpoint itself.
 */
import { Button } from "@/components/ui/button";
import { fmtDateTime } from "./FoOpenTradeCard";

const DASH = "—";

export interface ExitMonitorCycleStatsLike {
  checkedAt: string;
  openTradesScanned: number;
  quotesFetched: number;
  exitedCount: number;
  blockedCount: number;
  skippedCount: number;
  duplicateSkippedCount: number;
  staleDataCount: number;
  kiteUnavailableCount: number;
  errors: number;
  durationMs: number;
  nextRunAt: string;
}

export interface ExitMonitorHealthLike {
  cyclesTotal: number;
  exitedTotal: number;
  blockedTotal: number;
  errorsTotal: number;
  lastCycle: ExitMonitorCycleStatsLike | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorClass: string | null;
  lastErrorMessage: string | null;
  bootedAt: string;
}

export interface SubsystemHealthLike {
  cyclesTotal?: number;
  runsTotal?: number;
  stoppedTotal?: number;
  closedTotal?: number;
  rowsClosedTotal?: number;
  lastSuccessAt?: string | null;
  lastRunAt?: string | null;
  lastErrorAt: string | null;
  lastErrorClass: string | null;
  lastErrorMessage: string | null;
}

export interface GlobalDataHealthLike {
  overallStatus: string;
  severity: "ok" | "info" | "warn" | "orange" | "red";
  badge: string;
  headline: string;
}

export interface ExitMonitorStatusResponse {
  generatedAt: string;
  exitMonitor: ExitMonitorHealthLike;
  premiumOverlay: SubsystemHealthLike;
  orphanExit: SubsystemHealthLike;
  mtmSweep: SubsystemHealthLike;
  timeExit1520: SubsystemHealthLike;
  globalDataHealth: GlobalDataHealthLike;
}

export interface ExitMonitorDecisionLike {
  kind: string;
  [key: string]: unknown;
}

export interface RunResultLike {
  action: "dry" | "now";
  at: number;
  status?: string;
  closed?: boolean;
  decision?: ExitMonitorDecisionLike | null;
  error?: string | null;
}

function severityTone(sev: string): string {
  if (sev === "ok") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (sev === "info") return "border-sky-500/30 bg-sky-500/10 text-sky-200";
  if (sev === "warn" || sev === "orange") return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  if (sev === "red") return "border-rose-500/30 bg-rose-500/10 text-rose-200";
  return "border-border bg-muted/30 text-muted-foreground";
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-sm tabular-nums font-medium">{value}</span>
    </div>
  );
}

function SubsystemRow({
  name,
  h,
  primaryLabel,
  primaryValue,
}: {
  name: string;
  h: SubsystemHealthLike;
  primaryLabel: string;
  primaryValue: number;
}) {
  const hasError = !!h.lastErrorAt;
  return (
    <div className="flex items-center justify-between gap-2 border-t border-border/50 py-1.5 text-[12px]">
      <span className="font-medium">{name}</span>
      <span className="text-muted-foreground">
        {primaryLabel} {primaryValue}
        {" · last ok "}
        {fmtDateTime(h.lastSuccessAt ?? h.lastRunAt ?? null)}
      </span>
      <span
        title={hasError ? `${h.lastErrorClass ?? "error"}: ${h.lastErrorMessage ?? ""}` : "no recorded errors"}
        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
          hasError
            ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
            : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
        }`}
      >
        {hasError ? "Error" : "OK"}
      </span>
    </div>
  );
}

export function FoExitMonitorPanel({
  data,
  loading,
  error,
  openPositions,
  selectedId,
  onSelectedIdChange,
  onRunDry,
  onRunNow,
  runDryPending,
  runNowPending,
  runResult,
}: {
  data: ExitMonitorStatusResponse | null;
  loading: boolean;
  error: string | null;
  openPositions: Array<{ id: string; label: string }>;
  selectedId: string;
  onSelectedIdChange: (id: string) => void;
  onRunDry: () => void;
  onRunNow: () => void;
  runDryPending: boolean;
  runNowPending: boolean;
  runResult: RunResultLike | null;
}) {
  const em = data?.exitMonitor ?? null;
  const cycle = em?.lastCycle ?? null;
  const gdh = data?.globalDataHealth ?? null;

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Exit Monitor Reliability</h3>
        {gdh && (
          <span
            title={gdh.headline}
            className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${severityTone(gdh.severity)}`}
          >
            {gdh.badge}
          </span>
        )}
      </div>

      {loading && <p className="text-xs text-muted-foreground">Loading exit-monitor status…</p>}
      {error && <p className="text-xs text-rose-400">Failed to load: {error}</p>}

      {em && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Cycles" value={em.cyclesTotal} />
            <Stat label="Exited" value={em.exitedTotal} />
            <Stat label="Blocked" value={em.blockedTotal} />
            <Stat label="Errors" value={em.errorsTotal} />
          </div>
          <div className="grid grid-cols-2 gap-3 text-[12px] text-muted-foreground sm:grid-cols-3">
            <span>Last success: {fmtDateTime(em.lastSuccessAt)}</span>
            <span>Last error: {fmtDateTime(em.lastErrorAt)}</span>
            <span>Booted: {fmtDateTime(em.bootedAt)}</span>
          </div>
          {em.lastErrorAt && (
            <p className="text-[11px] text-rose-300">
              {em.lastErrorClass ?? "Error"}: {em.lastErrorMessage ?? DASH}
            </p>
          )}
          {cycle && (
            <div className="rounded-md border border-border/60 bg-muted/20 p-2 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">Last cycle</span> ({fmtDateTime(cycle.checkedAt)}):
              scanned {cycle.openTradesScanned}, quotes {cycle.quotesFetched}, exited {cycle.exitedCount}, blocked{" "}
              {cycle.blockedCount}, skipped {cycle.skippedCount} (dup {cycle.duplicateSkippedCount}), stale{" "}
              {cycle.staleDataCount}, kite-down {cycle.kiteUnavailableCount}, errors {cycle.errors}, took{" "}
              {cycle.durationMs}ms, next ~{fmtDateTime(cycle.nextRunAt)}
            </div>
          )}

          <div className="space-y-0.5">
            {data?.premiumOverlay && (
              <SubsystemRow
                name="Premium overlay"
                h={data.premiumOverlay}
                primaryLabel="stopped"
                primaryValue={data.premiumOverlay.stoppedTotal ?? 0}
              />
            )}
            {data?.orphanExit && (
              <SubsystemRow
                name="Orphan exit sweep"
                h={data.orphanExit}
                primaryLabel="closed"
                primaryValue={data.orphanExit.closedTotal ?? 0}
              />
            )}
            {data?.mtmSweep && (
              <SubsystemRow
                name="MTM sweep"
                h={data.mtmSweep}
                primaryLabel="cycles"
                primaryValue={data.mtmSweep.cyclesTotal ?? 0}
              />
            )}
            {data?.timeExit1520 && (
              <SubsystemRow
                name="15:20 force-exit"
                h={data.timeExit1520}
                primaryLabel="closed"
                primaryValue={data.timeExit1520.rowsClosedTotal ?? 0}
              />
            )}
          </div>
        </>
      )}

      <div className="border-t border-border/60 pt-3 space-y-2">
        <p className="text-[11px] font-medium text-muted-foreground">
          Manually check a single open trade against the same evaluator the scheduler uses
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedId}
            onChange={(e) => onSelectedIdChange(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-[12px]"
          >
            <option value="">Select an open trade…</option>
            {openPositions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={!selectedId || runDryPending}
            onClick={onRunDry}
            title="Evaluates exit eligibility with ZERO DB writes and ZERO Telegram — pure read"
          >
            {runDryPending ? "Running…" : "Run Dry"}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={!selectedId || runNowPending}
            onClick={onRunNow}
            title="Re-evaluates and closes the trade ONLY on a trade-grade EXIT decision — same gate + close path as the live scheduler"
          >
            {runNowPending ? "Running…" : "Run Now"}
          </Button>
        </div>
        {runResult && (
          <div className="rounded-md border border-border/60 bg-muted/20 p-2 text-[11px]">
            <span className="font-medium text-foreground">
              {runResult.action === "dry" ? "Dry-run" : "Manual run"} result:
            </span>{" "}
            {runResult.error ? (
              <span className="text-rose-300">{runResult.error}</span>
            ) : (
              <>
                status={runResult.status ?? DASH}
                {runResult.action === "now" && <> · closed={runResult.closed ? "yes" : "no"}</>}
                {runResult.decision && <> · decision={JSON.stringify(runResult.decision)}</>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
