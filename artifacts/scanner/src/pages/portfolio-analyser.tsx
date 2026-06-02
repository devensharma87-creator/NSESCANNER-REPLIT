import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  getStockDetail,
  searchChartInstruments,
  getChartCandles,
} from "@workspace/api-client-react";
import { Plus, RefreshCw, Database, FlaskConical, X, FolderOpen, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ComplianceBanner } from "@/components/portfolio/compliance-banner";
import { KpiStrip } from "@/components/portfolio/kpi-strip";
import { HoldingsTable } from "@/components/portfolio/holdings-table";
import { SectorAllocationPanel } from "@/components/portfolio/sector-allocation";
import { StockDeepDive } from "@/components/portfolio/stock-deepdive";
import { UploadModal } from "@/components/portfolio/upload-modal";
import { fmtAge, fmtINR } from "@/components/portfolio/format";
import type { RawHolding, LiveMetrics, EnrichedRow, EnrichmentMeta } from "@/lib/portfolio/types";
import {
  computeHoldingMetrics,
  computeSummary,
  computeSectorAllocation,
  totalCurrentValue,
} from "@/lib/portfolio/calc";
import { computeAnalytics } from "@/lib/portfolio/score";
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
};

/** Real, well-known NSE tickers — only qty/rate/date are sample values for preview. */
const SAMPLE_HOLDINGS: RawHolding[] = [
  { symbol: "RELIANCE", name: "Reliance Industries", sector: "Energy", qty: 25, rate: 2450, purchaseDate: "2024-03-12" },
  { symbol: "TCS", name: "Tata Consultancy Services", sector: "IT", qty: 15, rate: 3650, purchaseDate: "2024-06-01" },
  { symbol: "HDFCBANK", name: "HDFC Bank", sector: "Banking", qty: 40, rate: 1520, purchaseDate: "2023-11-20" },
  { symbol: "INFY", name: "Infosys", sector: "IT", qty: 30, rate: 1480, purchaseDate: "2024-01-15" },
  { symbol: "ITC", name: "ITC", sector: "FMCG", qty: 120, rate: 410, purchaseDate: "2023-08-05" },
];

export default function PortfolioAnalyser() {
  const [holdings, setHoldings] = useState<RawHolding[]>([]);
  const [isSample, setIsSample] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

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
  }

  function clearAll() {
    setHoldings([]);
    setIsSample(false);
  }

  function removeOne(symbol: string) {
    setHoldings(prev => prev.filter(h => h.symbol !== symbol));
    if (selected === symbol) setSelected(null);
  }

  return (
    <div className="space-y-4" data-testid="page-portfolio-analyser">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Portfolio Analyser</h1>
          <p className="text-xs text-muted-foreground">
            Read-only structure analytics for your holdings · live prices via Kite / Yahoo
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
              Import a CSV or add holdings manually. Nothing is fabricated — every figure is computed
              from your input and live market data.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button size="sm" onClick={() => setUploadOpen(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add Holdings
            </Button>
            <Button variant="outline" size="sm" onClick={loadSample} data-testid="btn-load-sample">
              <FlaskConical className="mr-1 h-3.5 w-3.5" /> Load sample (preview only)
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled
              title="Database-backed portfolios are not configured in v1"
              data-testid="btn-load-db"
            >
              <Database className="mr-1 h-3.5 w-3.5" /> Load from Database
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
