/**
 * W1A — Swing Freshness panel (owner-only, read-only).
 *
 * Surfaces the swing-scan operational health that previously lived only in
 * raw JSON diagnostics: last intraday refresh time + cycle stats
 * (intraday-refresh), RS coverage / average RS (computed from the analysis
 * rows), and the RS benchmark source + errors (swing-benchmark). Display
 * only — does not trigger a deep scan or refresh.
 */
import { useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import {
  deriveAgeSeverity,
  deriveRsCoverage,
  rollUp,
  type Severity,
} from "@/lib/infraHealth";
import {
  PanelShell,
  StatCard,
  FreshnessBadge,
  num,
  pctText,
  useEndpoint,
} from "./primitives";

interface IntradayRefreshHealth {
  cyclesTotal: number;
  rowsUpdatedTotal: number;
  triggerHitsLatchedTotal: number;
  lastCycle: {
    scanDate: string | null;
    considered: number;
    quotesReturned: number;
    updated: number;
    triggerHitsLatched: number;
    skippedNoQuote: number;
    skippedBadLtp: number;
    errors: number;
    durationMs: number;
  } | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
}
interface SwingBenchmarkHealth {
  fetchesTotal: number;
  lastBenchmark: {
    scanDate: string;
    source: string;
    barCount: number;
    errors: { yahoo?: string; yahooRetry?: string; kite?: string };
    rsEnabled: boolean;
    at: string;
  } | null;
}
interface AnalysisRow {
  rsScore: string | null;
}
interface AnalysisLite {
  scanDate: string | null;
  rows: AnalysisRow[];
}

export function SwingFreshnessPanel({ nowMs, refreshTick }: { nowMs: number; refreshTick: number }) {
  const [localTick, setLocalTick] = useState(0);
  const tick = refreshTick + localTick;
  const intraday = useEndpoint<IntradayRefreshHealth>(
    "api/stocks-to-watch/diagnostics/intraday-refresh",
    tick,
  );
  const benchmark = useEndpoint<SwingBenchmarkHealth>(
    "api/stocks-to-watch/diagnostics/swing-benchmark",
    tick,
  );
  const analysis = useEndpoint<AnalysisLite>("api/stocks-to-watch/analysis?limit=500", tick);
  const retry = () => setLocalTick((t) => t + 1);

  const lastRefreshAt = intraday.data?.lastSuccessAt ?? null;
  const rs = deriveRsCoverage(analysis.data?.rows ?? []);
  const bench = benchmark.data?.lastBenchmark ?? null;
  const benchErrors = bench
    ? [bench.errors.yahoo, bench.errors.yahooRetry, bench.errors.kite].filter(Boolean)
    : [];

  const freshnessSev = deriveAgeSeverity(lastRefreshAt, nowMs, 30);
  const benchSev: Severity = !benchmark.data
    ? "disabled"
    : bench
      ? bench.source === "none"
        ? "fail"
        : benchErrors.length > 0
          ? "warn"
          : "ok"
      : "disabled";
  const severity = rollUp([freshnessSev, benchSev]);

  return (
    <PanelShell
      title="Swing Freshness"
      icon={Activity}
      severity={severity}
      description="Intraday refresh health, RS coverage, and benchmark source for the NIFTY 500 swing scan."
      right={
        <button
          type="button"
          onClick={retry}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Refresh swing freshness"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      }
      testId="panel-swing-freshness"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatCard
            label="Last intraday refresh"
            value={<FreshnessBadge at={lastRefreshAt} nowMs={nowMs} thresholdMin={30} />}
            tone={freshnessSev}
          />
          <StatCard
            label="Scan date"
            value={analysis.data?.scanDate ?? intraday.data?.lastCycle?.scanDate ?? "—"}
          />
          <StatCard
            label="Rows updated (last)"
            value={num(intraday.data?.lastCycle?.updated)}
            hint={`${num(intraday.data?.rowsUpdatedTotal)} total`}
          />
          <StatCard
            label="Trigger hits latched"
            value={num(intraday.data?.lastCycle?.triggerHitsLatched)}
            hint={`${num(intraday.data?.triggerHitsLatchedTotal)} total`}
          />
          <StatCard
            label="Skipped (no quote)"
            value={num(intraday.data?.lastCycle?.skippedNoQuote)}
            tone={(intraday.data?.lastCycle?.skippedNoQuote ?? 0) > 0 ? "warn" : undefined}
          />
          <StatCard
            label="RS coverage"
            value={pctText(rs.coveragePct)}
            hint={`${num(rs.withRs)}/${num(rs.total)} rows`}
          />
          <StatCard label="Avg RS score" value={num(rs.avgRsScore, 1)} />
          <StatCard
            label="RS benchmark"
            value={bench?.source ?? "—"}
            hint={bench ? `${num(bench.barCount)} bars · RS ${bench.rsEnabled ? "on" : "off"}` : undefined}
            tone={benchSev}
          />
        </div>

        {benchErrors.length > 0 && (
          <div className="text-[11px] text-amber-600/90">
            Benchmark fallback errors: {benchErrors.join(" · ")}
          </div>
        )}

        {(() => {
          const sources = [intraday, benchmark, analysis];
          const ownerGated = sources.some((s) => s.status === 401 || s.status === 403);
          const anyError = sources.some((s) => s.error && !s.data);
          if (ownerGated) {
            return (
              <div className="text-[11px] text-muted-foreground">
                Owner payload pending / diagnostic unavailable — sign in as owner to populate
                refresh stats.
              </div>
            );
          }
          if (anyError) {
            return (
              <div className="text-[11px] text-amber-600/90 flex items-center gap-2">
                Some diagnostics failed to load — showing partial data.
                <button
                  type="button"
                  onClick={retry}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Retry
                </button>
              </div>
            );
          }
          return null;
        })()}
      </div>
    </PanelShell>
  );
}
