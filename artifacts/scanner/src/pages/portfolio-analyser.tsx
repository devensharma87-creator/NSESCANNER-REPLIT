import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  getStockDetail,
  searchChartInstruments,
  getChartCandles,
  getEtfQuote,
} from "@workspace/api-client-react";
import { Plus, RefreshCw, FlaskConical, X, FolderOpen, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ComplianceBanner } from "@/components/portfolio/compliance-banner";
import { KpiStrip } from "@/components/portfolio/kpi-strip";
import { HoldingsTable } from "@/components/portfolio/holdings-table";
import { SectorAllocationPanel } from "@/components/portfolio/sector-allocation";
import { StockDeepDive } from "@/components/portfolio/stock-deepdive";
import { UploadModal } from "@/components/portfolio/upload-modal";
import { PortfolioToolbar } from "@/components/portfolio/portfolio-toolbar";
import { RiskPanel, AllocationPanel, CostBasisPanel, BenchmarkPanel } from "@/components/portfolio/analytics-panels";
import { Methodology } from "@/components/portfolio/methodology";
import { fmtAge, fmtINR } from "@/components/portfolio/format";
import type { RawHolding, LiveMetrics, EnrichedRow, EnrichmentMeta } from "@/lib/portfolio/types";
import {
  computeHoldingMetrics,
  computeSummary,
  computeSectorAllocation,
  totalCurrentValue,
} from "@/lib/portfolio/calc";
import { computeAnalytics } from "@/lib/portfolio/score";
import { computeRiskAnalytics } from "@/lib/portfolio/risk";
import { computeHoldingPeriods, computeDividends, LONG_TERM_THRESHOLD_DAYS } from "@/lib/portfolio/holdingPeriod";
import {
  compareToBenchmark,
  benchmarkReturnFromCloses,
  buildBenchmarkSeries,
  compareSectorWeights,
  BENCHMARK_OPTIONS,
} from "@/lib/portfolio/benchmark";
import { buildPortfolioCsv } from "@/lib/portfolio/csv";
import {
  resolveBenchmarkPref,
  saveBenchmarkPref,
  type BenchmarkKey,
} from "@/lib/portfolio/benchmarkPref";
import { usePortfolios, rawToInput, holdingToRaw } from "@/lib/portfolio/persistence";
import {
  resolveHolding,
  pendingMeta,
  EMPTY_LIVE,
  type EnrichFetchers,
  type EnrichmentResult,
} from "@/lib/portfolio/enrich";

type ChartSegment = "index" | "equity" | "global";

/**
 * Live read-only fetchers composing the three existing endpoints. Module-level
 * so the reference is stable across renders.
 */
const FETCHERS: EnrichFetchers = {
  stockDetail: symbol => getStockDetail(symbol),
  searchInstruments: async q => (await searchChartInstruments({ q })).instruments,
  candles: async (symbol, segment) =>
    (await getChartCandles({ symbol, segment: segment as ChartSegment, tf: "1D" })).candles,
  etfQuote: symbol => getEtfQuote(symbol),
};

/** Real, well-known NSE tickers — only qty/rate/date are sample values for preview. */
const SAMPLE_HOLDINGS: RawHolding[] = [
  { symbol: "RELIANCE", name: "Reliance Industries", sector: "Energy", qty: 25, rate: 2450, purchaseDate: "2024-03-12" },
  { symbol: "TCS", name: "Tata Consultancy Services", sector: "IT", qty: 15, rate: 3650, purchaseDate: "2024-06-01" },
  { symbol: "HDFCBANK", name: "HDFC Bank", sector: "Banking", qty: 40, rate: 1520, purchaseDate: "2023-11-20" },
  { symbol: "INFY", name: "Infosys", sector: "IT", qty: 30, rate: 1480, purchaseDate: "2024-01-15" },
  { symbol: "ITC", name: "ITC", sector: "FMCG", qty: 120, rate: 410, purchaseDate: "2023-08-05" },
];

/** Stable signature of the holdings working-set for dirty tracking. */
function signature(holdings: RawHolding[]): string {
  return JSON.stringify(holdings.map(rawToInput));
}

export default function PortfolioAnalyser() {
  const [holdings, setHoldings] = useState<RawHolding[]>([]);
  const [isSample, setIsSample] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [benchmarkKey, setBenchmarkKey] = useState<BenchmarkKey>(() => resolveBenchmarkPref(null));

  const [currentId, setCurrentId] = useState<string | null>(null);
  const [currentName, setCurrentName] = useState<string | null>(null);
  const [savedSig, setSavedSig] = useState<string>(signature([]));
  const autoLoadedRef = useRef(false);

  const pf = usePortfolios();
  const currentSummary = pf.list.find(p => p.id === currentId) ?? null;
  const isDefault = currentSummary?.isDefault ?? false;
  const dirty = !isSample && signature(holdings) !== savedSig;

  // Load the default portfolio once on first successful list fetch.
  useEffect(() => {
    if (autoLoadedRef.current || !pf.listReady) return;
    autoLoadedRef.current = true;
    if (!pf.defaultId) return;
    void (async () => {
      try {
        const full = await pf.loadPortfolio(pf.defaultId!);
        const raws = full.holdings.map(holdingToRaw);
        setHoldings(raws);
        setCurrentId(full.id);
        setCurrentName(full.name);
        setSavedSig(signature(raws));
        setIsSample(false);
        setBenchmarkKey(resolveBenchmarkPref(full.id));
      } catch {
        /* honest no-op: a failed auto-load leaves the empty state visible */
      }
    })();
  }, [pf.listReady, pf.defaultId, pf]);

  const results = useQueries({
    queries: holdings.map(h => ({
      queryKey: ["portfolio-enrich", h.symbol.toUpperCase()],
      queryFn: () => resolveHolding(h, FETCHERS),
      staleTime: 60_000,
    })),
  });

  const enriched = useMemo<EnrichedRow[]>(() => {
    const lives: LiveMetrics[] = holdings.map((_, i) => results[i]?.data?.live ?? EMPTY_LIVE);
    const metas: EnrichmentMeta[] = holdings.map(
      (h, i) => (results[i]?.data as EnrichmentResult | undefined)?.meta ?? pendingMeta(h),
    );
    const rows = holdings.map((raw, i) => ({ raw, live: lives[i] }));
    const totalCurrent = totalCurrentValue(rows);
    const allocation = computeSectorAllocation(rows);
    const sectorWeight = new Map(allocation.map(a => [a.sector, a.weightPct]));
    return holdings.map((raw, i) => {
      const live = lives[i];
      const metrics = computeHoldingMetrics(raw, live, totalCurrent);
      const sector = (live.sector || raw.sector || "Unknown").trim() || "Unknown";
      const analytics = computeAnalytics({
        raw,
        live,
        metrics,
        sectorWeightPct: sectorWeight.get(sector) ?? null,
      });
      return {
        raw,
        live,
        metrics,
        analytics,
        resolution: metas[i],
        loading: results[i]?.isLoading ?? false,
        errored: results[i]?.isError ?? false,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdings, results.map(r => r.dataUpdatedAt).join(","), results.map(r => r.status).join(",")]);

  const summary = useMemo(
    () => computeSummary(enriched.map(r => ({ raw: r.raw, live: r.live }))),
    [enriched],
  );

  const allocation = useMemo(
    () => computeSectorAllocation(enriched.map(r => ({ raw: r.raw, live: r.live }))),
    [enriched],
  );

  const analyticsRows = useMemo(
    () => enriched.map(r => ({ raw: r.raw, live: r.live, metrics: r.metrics })),
    [enriched],
  );
  const risk = useMemo(() => computeRiskAnalytics(analyticsRows), [analyticsRows]);
  const holdingPeriod = useMemo(
    () => computeHoldingPeriods(analyticsRows, LONG_TERM_THRESHOLD_DAYS),
    [analyticsRows],
  );
  const dividends = useMemo(() => computeDividends(analyticsRows), [analyticsRows]);

  // Earliest purchase date across holdings → benchmark comparison window.
  const earliestPurchase = useMemo(() => {
    const ts = holdings
      .map(h => h.purchaseDate)
      .filter((d): d is string => !!d)
      .map(d => new Date(d).getTime())
      .filter(t => Number.isFinite(t));
    return ts.length ? new Date(Math.min(...ts)) : null;
  }, [holdings]);

  // Real index daily series via the existing chart endpoint (Kite→Yahoo) for the
  // user-selected benchmark (NIFTY 50 / Bank Nifty / Sensex). Never fabricated:
  // if the fetch yields no closes, the comparison falls back to an explicit
  // per-index "unavailable" state inside compareToBenchmark.
  const benchmarkOption =
    BENCHMARK_OPTIONS.find(o => o.key === benchmarkKey) ?? BENCHMARK_OPTIONS[0];
  const benchmarkQ = useQuery({
    queryKey: ["portfolio-benchmark", benchmarkOption.symbol, "1D"],
    enabled: holdings.length > 0,
    staleTime: 5 * 60_000,
    queryFn: () => getChartCandles({ symbol: benchmarkOption.symbol, segment: "index", tf: "1D" }),
  });

  // Index candles windowed to the comparison period (earliest purchase → now).
  // Shared by both the headline return and the line chart so they always agree.
  const benchmarkWindowed = useMemo(() => {
    const all = benchmarkQ.data?.candles ?? [];
    if (!earliestPurchase) return all;
    const cutoff = Math.floor(earliestPurchase.getTime() / 1000);
    return all.filter(c => c.t >= cutoff);
  }, [benchmarkQ.data, earliestPurchase]);

  // Rebased (% from window start) index series for the small line chart. Empty
  // (honest) when fewer than two covered closes exist — never fabricated.
  const benchmarkSeries = useMemo(
    () => buildBenchmarkSeries(benchmarkWindowed.map(c => ({ t: c.t, c: c.c }))),
    [benchmarkWindowed],
  );

  const benchmark = useMemo(() => {
    const windowed = benchmarkWindowed;
    const closes = windowed.map(c => c.c).filter((c): c is number => Number.isFinite(c));
    const benchmarkReturnPct = benchmarkReturnFromCloses(closes);
    // Label the window with the ACTUAL first covered date so the comparison is
    // never overstated when available history is shorter than the holding period.
    let windowLabel: string | null = null;
    if (windowed.length > 0) {
      const actualStart = new Date(windowed[0].t * 1000).toISOString().slice(0, 10);
      if (earliestPurchase) {
        const wanted = earliestPurchase.toISOString().slice(0, 10);
        windowLabel =
          actualStart === wanted
            ? `since earliest purchase (${wanted})`
            : `from ${actualStart} (earliest purchase ${wanted}; limited by available history)`;
      } else {
        windowLabel = `from ${actualStart} (full available range — purchase dates missing)`;
      }
    }
    return compareToBenchmark({
      portfolioReturnPct: summary.totalReturnPct,
      benchmarkReturnPct,
      benchmarkName: benchmarkOption.name,
      windowLabel,
    });
  }, [benchmarkWindowed, earliestPurchase, summary.totalReturnPct, benchmarkOption.name]);

  // Sector over/under-weight vs the dated, real NIFTY 500 sector reference.
  // Never fabricated: unmapped sectors are surfaced explicitly, and the whole
  // comparison reports unavailable when no live sector weights exist.
  const sectorComparison = useMemo(
    () => compareSectorWeights(allocation.map(a => ({ sector: a.sector, weightPct: a.weightPct }))),
    [allocation],
  );

  const lastUpdated = useMemo(() => {
    const ts = results.map(r => r.dataUpdatedAt).filter(t => t > 0);
    return ts.length ? Math.max(...ts) : null;
  }, [results]);

  const anyLoading = results.some(r => r.isLoading);
  const selectedRow = enriched.find(r => r.raw.symbol === selected) ?? null;

  function mergeHoldings(incoming: RawHolding[]) {
    setIsSample(false);
    setHoldings(prev => {
      const map = new Map(prev.map(h => [h.symbol.toUpperCase(), h]));
      for (const h of incoming) map.set(h.symbol.toUpperCase(), h);
      return Array.from(map.values());
    });
  }

  function loadSample() {
    setHoldings(SAMPLE_HOLDINGS);
    setIsSample(true);
    setCurrentId(null);
    setCurrentName(null);
    setSavedSig(signature([]));
    setBenchmarkKey(resolveBenchmarkPref(null));
  }

  function clearAll() {
    setHoldings([]);
    setIsSample(false);
  }

  function removeOne(symbol: string) {
    setHoldings(prev => prev.filter(h => h.symbol !== symbol));
    if (selected === symbol) setSelected(null);
  }

  // ----- Persistence actions -----
  function newEmpty() {
    setHoldings([]);
    setIsSample(false);
    setCurrentId(null);
    setCurrentName(null);
    setSavedSig(signature([]));
    setBenchmarkKey(resolveBenchmarkPref(null));
  }

  async function switchTo(id: string) {
    try {
      const full = await pf.loadPortfolio(id);
      const raws = full.holdings.map(holdingToRaw);
      setHoldings(raws);
      setCurrentId(full.id);
      setCurrentName(full.name);
      setSavedSig(signature(raws));
      setIsSample(false);
      setBenchmarkKey(resolveBenchmarkPref(full.id));
    } catch {
      /* leave current view untouched on load failure */
    }
  }

  // Persist the benchmark selection so it survives refresh/session. Scoped to
  // the current portfolio (or the shared default scope when nothing is loaded).
  function selectBenchmark(key: BenchmarkKey) {
    setBenchmarkKey(key);
    saveBenchmarkPref(currentId, key);
  }

  async function saveCurrent() {
    if (!currentId) return;
    try {
      await pf.saveHoldings(currentId, holdings);
      setSavedSig(signature(holdings));
    } catch {
      /* network error: dirty flag stays set so the user can retry */
    }
  }

  async function createNamed(name: string) {
    try {
      const created = await pf.create(name, holdings, pf.list.length === 0);
      setCurrentId(created.id);
      setCurrentName(created.name);
      setSavedSig(signature(holdings));
      setIsSample(false);
      saveBenchmarkPref(created.id, benchmarkKey);
    } catch {
      /* no-op */
    }
  }

  async function saveAs(name: string) {
    try {
      const created = await pf.create(name, holdings, false);
      setCurrentId(created.id);
      setCurrentName(created.name);
      setSavedSig(signature(holdings));
      setIsSample(false);
      saveBenchmarkPref(created.id, benchmarkKey);
    } catch {
      /* no-op */
    }
  }

  async function rename(name: string) {
    if (!currentId) return;
    try {
      const updated = await pf.rename(currentId, name);
      setCurrentName(updated.name);
    } catch {
      /* no-op */
    }
  }

  async function setDefault() {
    if (!currentId) return;
    try {
      await pf.setDefault(currentId);
    } catch {
      /* no-op */
    }
  }

  function exportCsv() {
    if (holdings.length === 0) return;
    const blob = new Blob([buildPortfolioCsv(holdings)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const base = (currentName ?? "portfolio").replace(/[^a-z0-9-_]+/gi, "_");
    a.download = `${base}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function deleteCurrent() {
    if (!currentId) return;
    if (!window.confirm(`Delete "${currentName ?? "this portfolio"}"? This cannot be undone.`)) return;
    const deletedId = currentId;
    const wasDefault = isDefault;
    try {
      await pf.remove(deletedId);
      // Promote a fallback so the user keeps a loaded portfolio and the
      // auto-load-on-refresh path (which keys off the default) still works.
      const remaining = pf.list.filter(p => p.id !== deletedId);
      const next = remaining.find(p => p.isDefault) ?? remaining[0] ?? null;
      if (next) {
        // If we deleted the default, promote the next one server-side so a
        // refresh reloads it instead of an empty view.
        if (wasDefault) {
          try {
            await pf.setDefault(next.id);
          } catch {
            /* non-fatal: switch still loads it for this session */
          }
        }
        await switchTo(next.id);
      } else {
        newEmpty();
      }
    } catch {
      /* no-op */
    }
  }

  return (
    <div className="space-y-4" data-testid="page-portfolio-analyser">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Portfolio Analyser</h1>
          <p className="text-xs text-muted-foreground">
            Read-only structure analytics for your holdings · live prices via Kite / Yahoo · saved
            privately to your account
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {lastUpdated && (
            <span className="text-[11px] text-muted-foreground" data-testid="last-updated">
              Updated {fmtAge(lastUpdated)}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => setUploadOpen(true)} data-testid="btn-add">
            <Plus className="mr-1 h-3.5 w-3.5" /> Add Holdings
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => results.forEach(r => r.refetch())}
            disabled={holdings.length === 0 || anyLoading}
            data-testid="btn-recalculate"
          >
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${anyLoading ? "animate-spin" : ""}`} /> Recalculate
          </Button>
        </div>
      </div>

      <ComplianceBanner />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <PortfolioToolbar
          list={pf.list}
          listReady={pf.listReady}
          currentId={currentId}
          currentName={currentName}
          isDefault={isDefault}
          dirty={dirty}
          saving={pf.saving}
          hasHoldings={holdings.length > 0 && !isSample}
          onSwitch={switchTo}
          onNew={newEmpty}
          onSave={saveCurrent}
          onSaveAs={saveAs}
          onCreateNamed={createNamed}
          onRename={rename}
          onSetDefault={setDefault}
          onDelete={deleteCurrent}
          onExport={exportCsv}
        />
        {dirty && currentId && (
          <span className="text-[11px] text-amber-400" data-testid="dirty-indicator">
            Unsaved changes
          </span>
        )}
        {isSample && (
          <span className="text-[11px] text-amber-400">Sample data — saving is disabled</span>
        )}
      </div>

      {isSample && (
        <div
          className="flex items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-400"
          data-testid="sample-banner"
        >
          <span className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4" />
            <span>
              <strong>Sample portfolio (preview only).</strong> Tickers and live prices are real;
              quantity, average rate and purchase dates are illustrative placeholders — not your data.
            </span>
          </span>
          <button onClick={clearAll} className="shrink-0 hover:text-foreground" data-testid="dismiss-sample">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {holdings.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-16 text-center"
          data-testid="empty-state"
        >
          <FolderOpen className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">No holdings loaded</p>
            <p className="text-xs text-muted-foreground">
              {pf.list.length > 0
                ? "Pick a saved portfolio from the switcher, import a CSV, or add holdings manually."
                : "Import a CSV or add holdings manually, then Save to keep it on your account."}{" "}
              Nothing is fabricated — every figure is computed from your input and live market data.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button size="sm" onClick={() => setUploadOpen(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add Holdings
            </Button>
            <Button variant="outline" size="sm" onClick={loadSample} data-testid="btn-load-sample">
              <FlaskConical className="mr-1 h-3.5 w-3.5" /> Load sample (preview only)
            </Button>
          </div>
        </div>
      ) : (
        <>
          <KpiStrip summary={summary} />
          {summary.missingCount > 0 && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-400"
              data-testid="enrichment-warning"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <strong>
                  {summary.missingCount} of {summary.holdingsCount} holding(s) could not be
                  price-enriched.
                </strong>{" "}
                Your uploaded quantities and rates are preserved — returns are calculated only where a
                live CMP is available. Hover the dash in each row for the precise reason.
                <div className="mt-0.5 text-amber-400/80">
                  {summary.enrichedCount} enriched · {summary.missingCount} missing live price ·{" "}
                  {fmtINR(summary.investedNotEnriched)} invested not currently enriched.
                </div>
              </div>
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
            <HoldingsTable rows={enriched} onSelect={setSelected} onRemove={removeOne} />
            <SectorAllocationPanel allocation={allocation} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <RiskPanel risk={risk} />
            <AllocationPanel rows={analyticsRows} />
            <CostBasisPanel holdingPeriod={holdingPeriod} dividends={dividends} />
            <BenchmarkPanel
              comparison={benchmark}
              sectorComparison={sectorComparison}
              series={benchmarkSeries}
              seriesLoading={benchmarkQ.isLoading}
              options={BENCHMARK_OPTIONS}
              selectedKey={benchmarkKey}
              onSelect={selectBenchmark}
            />
          </div>
          <Methodology />
        </>
      )}

      <UploadModal
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onImport={mergeHoldings}
        onAddOne={h => mergeHoldings([h])}
      />
      <StockDeepDive row={selectedRow} open={selected != null} onOpenChange={v => !v && setSelected(null)} />
    </div>
  );
}
