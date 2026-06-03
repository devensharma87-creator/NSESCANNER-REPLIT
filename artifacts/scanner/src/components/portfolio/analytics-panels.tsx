/**
 * Portfolio Analyser — Phase 2 analytics panels.
 *
 * Pure presentation over the tested pure libs (risk / allocation / holdingPeriod
 * / benchmark). Every panel renders an explicit "unavailable" message rather
 * than a fabricated figure when the underlying data is missing.
 */
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";
import type { RiskAnalytics } from "@/lib/portfolio/risk";
import {
  computeAllocation,
  type AllocRow,
  type AllocationMode,
} from "@/lib/portfolio/allocation";
import type { HoldingPeriodView, DividendView } from "@/lib/portfolio/holdingPeriod";
import type { BenchmarkComparison, BenchmarkOption } from "@/lib/portfolio/benchmark";
import { fmtINR, fmtSignedINR, fmtPct, fmtNum, pnlClass } from "./format";

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

export function BenchmarkPanel({
  comparison,
  options,
  selectedKey,
  onSelect,
}: {
  comparison: BenchmarkComparison;
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
      <p className="mt-2 border-t border-border pt-2 text-[10px] text-muted-foreground">
        Benchmark uses the real {comparison.benchmarkName} daily series. NIFTY 500 and sector-index
        comparisons are <span className="text-amber-400">unavailable</span> — those index series are not
        wired in this build and would require a new data source.
      </p>
      <p className="mt-1 text-[10px] text-amber-400">{comparison.sectorWeightUnavailable}</p>
    </Card>
  );
}
