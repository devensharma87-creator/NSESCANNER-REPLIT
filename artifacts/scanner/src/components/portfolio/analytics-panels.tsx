/**
 * Portfolio Analyser — Phase 2 analytics panels.
 *
 * Pure presentation over the tested pure libs (risk / allocation / holdingPeriod
 * / benchmark). Every panel renders an explicit "unavailable" message rather
 * than a fabricated figure when the underlying data is missing.
 */
import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { AlertTriangle } from "lucide-react";
import type { RiskAnalytics } from "@/lib/portfolio/risk";
import {
  computeAllocation,
  type AllocRow,
  type AllocationMode,
} from "@/lib/portfolio/allocation";
import type { HoldingPeriodView, DividendView } from "@/lib/portfolio/holdingPeriod";
import type {
  BenchmarkComparison,
  BenchmarkOption,
  BenchmarkSeriesPoint,
  SectorWeightComparison,
} from "@/lib/portfolio/benchmark";
import { fmtINR, fmtSignedINR, fmtPct, fmtNum, pnlClass } from "./format";

/**
 * Per-sector index return, keyed by canonical sector bucket. `returnPct` is the
 * real buy-and-hold return of that sector's own NSE index over the comparison
 * window, or null when no series is available (rendered honestly, never faked).
 */
export interface SectorIndexReturn {
  /** Sector index label, e.g. "NIFTY IT". */
  name: string;
  /** Buy-and-hold return over the window (%), null when unavailable. */
  returnPct: number | null;
  /** True while the series is still loading. */
  loading: boolean;
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono ${valueClass ?? ""}`}>{value}</span>
    </div>
  );
}

export function RiskPanel({ risk }: { risk: RiskAnalytics }) {
  return (
    <Card className="p-3" data-testid="risk-panel">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Portfolio Risk Analytics</h3>
        <span
          className="text-[10px] text-muted-foreground"
          title="Herfindahl-Hirschman Index on current-value weights. 0–10000; higher = more concentrated."
        >
          HHI {risk.hhi == null ? "n/a" : risk.hhi} · {risk.hhiLabel}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        <Row
          label="Top holding"
          value={
            risk.topHoldingSymbol
              ? `${risk.topHoldingSymbol} ${fmtPct(risk.topHoldingWeightPct, 1)}`
              : "unavailable"
          }
        />
        <Row
          label="Top-3 holdings"
          value={risk.top3WeightPct == null ? "unavailable" : `${fmtNum(risk.top3WeightPct, 1)}%`}
          valueClass={
            risk.top3WeightPct != null && risk.top3WeightPct > 60 ? "text-amber-400" : undefined
          }
        />
        <Row
          label="Top sector"
          value={
            risk.topSectorName
              ? `${risk.topSectorName} ${fmtNum(risk.topSectorWeightPct, 1)}% (${risk.sectorCoveragePct.toFixed(0)}% cov.)`
              : "unavailable"
          }
          valueClass={
            risk.topSectorWeightPct != null && risk.topSectorWeightPct > 35
              ? "text-amber-400"
              : undefined
          }
        />
        <Row
          label="Weighted beta"
          value={
            risk.weightedBeta == null
              ? "unavailable"
              : `${fmtNum(risk.weightedBeta, 2)} (${risk.betaCoveragePct.toFixed(0)}% cov.)`
          }
        />
        <Row
          label="Top contributor"
          value={
            risk.topContributor
              ? `${risk.topContributor.symbol} ${fmtSignedINR(risk.topContributor.pnl)}`
              : "unavailable"
          }
          valueClass={risk.topContributor ? pnlClass(risk.topContributor.pnl) : undefined}
        />
        <Row
          label="Worst drag"
          value={
            risk.worstDrag
              ? `${risk.worstDrag.symbol} ${fmtSignedINR(risk.worstDrag.pnl)}`
              : "unavailable"
          }
          valueClass={risk.worstDrag ? pnlClass(risk.worstDrag.pnl) : undefined}
        />
        <Row label="Unrealised gain" value={fmtSignedINR(risk.unrealisedGain)} valueClass={pnlClass(risk.unrealisedGain)} />
        <Row label="Unrealised loss" value={fmtSignedINR(risk.unrealisedLoss)} valueClass={pnlClass(risk.unrealisedLoss)} />
        <Row label="Winners / losers" value={`${risk.winners} / ${risk.losers}`} />
        <Row
          label="Data availability"
          value={`${risk.dataAvailabilityPct.toFixed(0)}%`}
          valueClass={risk.dataAvailabilityPct < 70 ? "text-amber-400" : undefined}
        />
      </div>
      {risk.flags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 border-t border-border pt-2">
          {risk.flags.map(f => (
            <span
              key={f.code}
              className={`rounded-full border px-2 py-0.5 text-[10px] ${
                f.severity === "high"
                  ? "border-red-500/30 bg-red-500/15 text-red-400"
                  : f.severity === "warn"
                    ? "border-amber-500/30 bg-amber-500/15 text-amber-400"
                    : "border-border bg-muted text-muted-foreground"
              }`}
            >
              {f.message}
            </span>
          ))}
        </div>
      )}
      <p className="mt-2 text-[10px] text-muted-foreground">
        Correlation clustering is <span className="text-amber-500">not shown</span> — clean per-holding
        daily-return series are not wired in this build, so it would be fabricated.
      </p>
    </Card>
  );
}

const ALLOC_MODES: { mode: AllocationMode; label: string }[] = [
  { mode: "sector", label: "Sector" },
  { mode: "stock", label: "Stock" },
  { mode: "marketcap", label: "Market-cap" },
  { mode: "pnl", label: "P&L" },
  { mode: "winloss", label: "Win/Loss" },
];

export function AllocationPanel({ rows }: { rows: AllocRow[] }) {
  const [mode, setMode] = useState<AllocationMode>("sector");
  const view = computeAllocation(rows, mode);
  return (
    <Card className="p-3" data-testid="allocation-panel">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Allocation</h3>
        <div className="flex flex-wrap gap-1">
          {ALLOC_MODES.map(m => (
            <button
              key={m.mode}
              onClick={() => setMode(m.mode)}
              className={`rounded px-2 py-0.5 text-[10px] ${
                mode === m.mode
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`alloc-mode-${m.mode}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {view.slices.length === 0 ? (
        <div className="py-6 text-center text-xs text-amber-400">
          {view.unavailable ?? "No data."}
        </div>
      ) : (
        <div className="space-y-1">
          {view.slices.map(s => (
            <div key={s.label} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate">
                {s.label}
                {s.meta && <span className="ml-1 text-[10px] text-muted-foreground">· {s.meta}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2 font-mono">
                <span className="text-muted-foreground">{fmtPct(s.weightPct, 1)}</span>
                <span className={s.sign === "neg" ? "text-red-500" : s.sign === "pos" ? "text-emerald-500" : ""}>
                  {mode === "pnl" ? fmtSignedINR(s.value) : fmtINR(s.value)}
                </span>
              </span>
            </div>
          ))}
          {view.unavailable && (
            <p className="mt-2 border-t border-border pt-2 text-[10px] text-amber-400">{view.unavailable}</p>
          )}
        </div>
      )}
    </Card>
  );
}

export function CostBasisPanel({
  holdingPeriod,
  dividends,
}: {
  holdingPeriod: HoldingPeriodView;
  dividends: DividendView;
}) {
  return (
    <Card className="p-3" data-testid="cost-basis-panel">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Cost Basis &amp; Income</h3>
        <span className="text-[10px] text-muted-foreground" title="Configurable long-term threshold (days).">
          LT ≥ {holdingPeriod.thresholdDays}d
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-md border border-border bg-muted/20 px-2 py-1.5">
          <div className="text-[10px] uppercase text-muted-foreground">Long-term</div>
          <div className="font-mono text-sm">{fmtINR(holdingPeriod.longTermInvested)}</div>
          <div className="text-[10px] text-muted-foreground">{holdingPeriod.longTermCount} holding(s)</div>
        </div>
        <div className="rounded-md border border-border bg-muted/20 px-2 py-1.5">
          <div className="text-[10px] uppercase text-muted-foreground">Short-term</div>
          <div className="font-mono text-sm">{fmtINR(holdingPeriod.shortTermInvested)}</div>
          <div className="text-[10px] text-muted-foreground">{holdingPeriod.shortTermCount} holding(s)</div>
        </div>
        <div className="rounded-md border border-border bg-muted/20 px-2 py-1.5">
          <div className="text-[10px] uppercase text-muted-foreground">Undated</div>
          <div className="font-mono text-sm">{fmtINR(holdingPeriod.unknownInvested)}</div>
          <div className="text-[10px] text-muted-foreground">{holdingPeriod.unknownCount} holding(s)</div>
        </div>
      </div>
      <div className="mt-3 space-y-1.5 border-t border-border pt-2">
        {dividends.hasData ? (
          <>
            <Row label="Dividends received" value={fmtINR(dividends.totalDividends)} />
            <Row label="Yield on cost" value={fmtPct(dividends.yieldOnCostPct, 2)} />
            <Row
              label="Total return incl. dividends"
              value={fmtSignedINR(dividends.totalReturnInclDiv)}
              valueClass={pnlClass(dividends.totalReturnInclDiv)}
            />
          </>
        ) : (
          <p className="text-[10px] text-muted-foreground">
            No dividend amounts entered. Add a "dividendReceived" value per holding to see yield-on-cost
            and total return including dividends — nothing is estimated.
          </p>
        )}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        Holding-period buckets are factual classifications only — <strong>not tax advice</strong> and no
        tax-payable figure is computed.
      </p>
    </Card>
  );
}

function diffClass(stance: "overweight" | "underweight" | "in line"): string {
  if (stance === "overweight") return "text-emerald-400";
  if (stance === "underweight") return "text-amber-400";
  return "text-muted-foreground";
}

function fmtSignedPP(diff: number): string {
  const sign = diff > 0 ? "+" : "";
  return `${sign}${fmtNum(diff, 1)} pp`;
}

/**
 * Per-sector index return cell. Honest states: a dash with a reason title when
 * the sector has no mapped NSE index, "…" while the series loads, or "n/a" when
 * the series yielded no closes for the window — the figure is never fabricated.
 */
function SectorIndexCell({ info }: { info: SectorIndexReturn | undefined }) {
  if (!info) {
    return (
      <span
        className="text-right font-mono text-muted-foreground/60"
        title="No published NSE sector index for this sector"
      >
        —
      </span>
    );
  }
  if (info.loading) {
    return (
      <span className="text-right font-mono text-muted-foreground/60" title={`${info.name} loading`}>
        …
      </span>
    );
  }
  if (info.returnPct == null) {
    return (
      <span
        className="text-right font-mono text-muted-foreground/60"
        title={`${info.name} series unavailable for this window`}
      >
        n/a
      </span>
    );
  }
  const sign = info.returnPct > 0 ? "+" : "";
  return (
    <span className={`text-right font-mono ${pnlClass(info.returnPct)}`} title={info.name}>
      {sign}
      {fmtNum(info.returnPct, 1)}%
    </span>
  );
}

const benchmarkChartConfig = {
  indexPct: { label: "Index", color: "hsl(199 89% 60%)" },
} satisfies ChartConfig;

function shortDate(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  try {
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      timeZone: "Asia/Kolkata",
    }).format(new Date(ms));
  } catch {
    return iso;
  }
}

/**
 * Small line chart of the selected index rebased to % from the window start.
 * The portfolio's own path is NOT reconstructable from a single live CMP per
 * holding, so we draw its known total return over the same window as a labelled
 * horizontal reference — honest about what is a real time-series (the index)
 * versus a single endpoint figure (the portfolio).
 */
function BenchmarkChart({
  series,
  loading,
  benchmarkName,
  portfolioReturnPct,
}: {
  series: BenchmarkSeriesPoint[];
  loading: boolean;
  benchmarkName: string;
  portfolioReturnPct: number | null;
}) {
  if (loading && series.length === 0) {
    return (
      <div
        className="h-[140px] animate-pulse rounded-md border border-border bg-muted/30"
        data-testid="benchmark-chart-loading"
      />
    );
  }
  if (series.length === 0) {
    return (
      <div
        className="flex h-[140px] items-center justify-center rounded-md border border-dashed border-border px-3 text-center text-[11px] text-muted-foreground"
        data-testid="benchmark-chart-empty"
      >
        No index series available for this window — chart hidden rather than
        fabricated.
      </div>
    );
  }
  const hasPortfolio = portfolioReturnPct != null && Number.isFinite(portfolioReturnPct);
  return (
    <ChartContainer
      config={benchmarkChartConfig}
      className="aspect-auto h-[140px] w-full"
      data-testid="benchmark-chart"
    >
      <LineChart data={series} margin={{ left: 4, right: 8, top: 6, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickFormatter={shortDate}
          tickLine={false}
          axisLine={false}
          minTickGap={28}
          tick={{ fontSize: 10 }}
        />
        <YAxis
          width={40}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10 }}
          tickFormatter={(v) => `${typeof v === "number" ? v.toFixed(0) : v}%`}
        />
        <ReferenceLine y={0} stroke="hsl(215 16% 47%)" strokeDasharray="2 2" />
        {hasPortfolio && (
          <ReferenceLine
            y={portfolioReturnPct as number}
            stroke="hsl(152 60% 52%)"
            strokeDasharray="4 2"
            label={{
              value: `Portfolio ${(portfolioReturnPct as number) > 0 ? "+" : ""}${fmtNum(portfolioReturnPct, 1)}%`,
              position: "insideTopLeft",
              fontSize: 10,
              fill: "hsl(152 60% 52%)",
            }}
          />
        )}
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(label) => shortDate(String(label))}
              formatter={(value) => [
                `${typeof value === "number" && value > 0 ? "+" : ""}${fmtNum(
                  typeof value === "number" ? value : null,
                  2,
                )}%`,
                ` ${benchmarkName}`,
              ]}
            />
          }
        />
        <Line
          type="monotone"
          dataKey="indexPct"
          stroke="var(--color-indexPct)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  );
}

export function BenchmarkPanel({
  comparison,
  sectorComparison,
  sectorIndexReturns,
  series,
  seriesLoading,
  options,
  selectedKey,
  onSelect,
}: {
  comparison: BenchmarkComparison;
  sectorComparison: SectorWeightComparison;
  /** Per-sector index return keyed by canonical sector bucket. */
  sectorIndexReturns: Map<string, SectorIndexReturn>;
  series: BenchmarkSeriesPoint[];
  seriesLoading: boolean;
  options: readonly BenchmarkOption[];
  selectedKey: BenchmarkOption["key"];
  onSelect: (key: BenchmarkOption["key"]) => void;
}) {
  return (
    <Card className="p-3" data-testid="benchmark-panel">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Benchmark</h3>
        <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5" role="group" aria-label="Benchmark index">
          {options.map(o => (
            <button
              key={o.key}
              type="button"
              onClick={() => onSelect(o.key)}
              aria-pressed={o.key === selectedKey}
              data-testid={`benchmark-select-${o.key}`}
              className={
                "rounded px-1.5 py-0.5 text-[10px] transition-colors " +
                (o.key === selectedKey
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {o.name}
            </button>
          ))}
        </div>
      </div>
      {comparison.returnUnavailable ? (
        <div className="flex items-start gap-1.5 text-xs text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{comparison.returnUnavailable}</span>
        </div>
      ) : (
        <div className="space-y-1.5">
          {comparison.windowLabel && (
            <div className="text-[10px] text-muted-foreground">Window: {comparison.windowLabel}</div>
          )}
          <Row label="Portfolio return" value={fmtPct(comparison.portfolioReturnPct, 2)} valueClass={pnlClass(comparison.portfolioReturnPct)} />
          <Row label={`${comparison.benchmarkName} return`} value={fmtPct(comparison.benchmarkReturnPct, 2)} valueClass={pnlClass(comparison.benchmarkReturnPct)} />
          <Row
            label="Relative"
            value={`${comparison.relativePct != null && comparison.relativePct > 0 ? "+" : ""}${fmtNum(comparison.relativePct, 2)} pp · ${comparison.verdict ?? ""}`}
            valueClass={pnlClass(comparison.relativePct)}
          />
        </div>
      )}
      <div className="mt-2">
        <BenchmarkChart
          series={series}
          loading={seriesLoading}
          benchmarkName={comparison.benchmarkName}
          portfolioReturnPct={comparison.portfolioReturnPct}
        />
      </div>
      <div className="mt-2 border-t border-border pt-2">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-xs font-semibold">Sector over/under-weight vs NIFTY 500</span>
          <span
            className="text-[10px] text-muted-foreground"
            title={sectorComparison.source}
          >
            ref {sectorComparison.asOf}
          </span>
        </div>
        {sectorComparison.unavailable ? (
          <div className="flex items-start gap-1.5 text-xs text-amber-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{sectorComparison.unavailable}</span>
          </div>
        ) : (
          <>
            <div className="mb-1 grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 text-[10px] text-muted-foreground">
              <span>Sector</span>
              <span className="text-right">Port.</span>
              <span className="text-right">N500</span>
              <span className="text-right">+/−</span>
              <span className="text-right" title="Return of this sector's own NSE index over the comparison window">
                Idx ret.
              </span>
            </div>
            <div className="space-y-0.5">
              {sectorComparison.rows
                .filter(r => r.portfolioPct > 0 || r.stance !== "in line")
                .slice(0, 8)
                .map(r => {
                  const sectorIdx = sectorIndexReturns.get(r.sector);
                  return (
                    <div
                      key={r.sector}
                      className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 text-[11px]"
                      data-testid={`sector-weight-${r.sector}`}
                    >
                      <span className="truncate text-muted-foreground" title={r.sector}>
                        {r.sector}
                      </span>
                      <span className="text-right font-mono">{fmtNum(r.portfolioPct, 1)}%</span>
                      <span className="text-right font-mono text-muted-foreground">
                        {fmtNum(r.benchmarkPct, 1)}%
                      </span>
                      <span className={`text-right font-mono ${diffClass(r.stance)}`}>
                        {fmtSignedPP(r.diffPct)}
                      </span>
                      <SectorIndexCell info={sectorIdx} />
                    </div>
                  );
                })}
            </div>
            {sectorComparison.coveragePct < 99.5 && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                {fmtNum(sectorComparison.coveragePct, 0)}% of portfolio value mapped to the reference
                taxonomy
                {sectorComparison.unmapped.length > 0 &&
                  ` · not benchmarked: ${sectorComparison.unmapped
                    .map(u => u.sector)
                    .join(", ")}`}
                .
              </p>
            )}
          </>
        )}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        Return uses the real {comparison.benchmarkName} daily series. Sector weights are a dated,
        published NIFTY 500 reference ({sectorComparison.asOf}) rolled up to this app's sector
        taxonomy — never fabricated; sectors outside that reference are listed as not benchmarked.
        "Idx ret." is each sector's own NSE index return over the same window (real series, Kite→Yahoo);
        sectors with no published sector index show "—".
      </p>
    </Card>
  );
}
