/**
 * Charting — read-only technical-analysis terminal (Phase 2 MVP).
 *
 * Symbol search across indices / equities / global, a 9-step timeframe
 * switcher, candlestick/line + volume, a multi-EMA ribbon (11/20/50/100/200),
 * session-anchored VWAP (intraday), and an RSI sub-pane. All indicator math
 * is computed client-side from the normalized /api/chart/candles feed. This
 * tab never places orders or mutates any state.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useSearchChartInstruments,
  getSearchChartInstrumentsQueryKey,
  useGetChartCandles,
  getGetChartCandlesQueryKey,
  type ChartInstrument,
} from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, AlertTriangle, CandlestickChart, LineChart as LineIcon, X } from "lucide-react";
import {
  ChartingChart,
  EMA_COLORS,
  VWAP_COLOR,
  type RenderCandle,
} from "@/components/charting-chart";
import {
  TIMEFRAMES,
  SEGMENTS,
  DEFAULT_TIMEFRAME,
  isIntraday,
  timeframeShowsTime,
  type Timeframe,
  type Segment,
} from "@/lib/charting/timeframes";
import {
  emaRibbon,
  rsiClose,
  vwap,
  cvdProxy,
  volumeProfilePoc,
  detectFvgs,
  detectSweeps,
  EMA_PERIODS,
  type EmaPeriod,
  type IndicatorCandle,
} from "@/lib/charting/indicators";

function useDebounced<T>(value: T, delayMs: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return v;
}

interface Selection {
  symbol: string;
  name: string;
  segment: Segment;
}

const DEFAULT_SELECTION: Selection = { symbol: "NIFTY", name: "NIFTY 50", segment: "index" };

const DEFAULT_EMA_VISIBLE: Record<EmaPeriod, boolean> = {
  11: false,
  20: true,
  50: true,
  100: false,
  200: false,
};

function fmtAge(asOf: number | null | undefined): string {
  if (asOf == null) return "—";
  const sec = Math.max(0, Math.floor(Date.now() / 1000 - asOf));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export default function ChartingPage() {
  const [segment, setSegment] = useState<Segment>("index");
  const [selection, setSelection] = useState<Selection>(DEFAULT_SELECTION);
  const [timeframe, setTimeframe] = useState<Timeframe>(DEFAULT_TIMEFRAME);
  const [chartType, setChartType] = useState<"candles" | "line">("candles");

  const [emaVisible, setEmaVisible] = useState<Record<EmaPeriod, boolean>>(DEFAULT_EMA_VISIBLE);
  const [showVwap, setShowVwap] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const [showRsi, setShowRsi] = useState(true);
  // Institutional / SMC indicators (off by default to keep the default view clean).
  const [showFvg, setShowFvg] = useState(false);
  const [showCvd, setShowCvd] = useState(false);
  const [showPoc, setShowPoc] = useState(false);
  const [showSweeps, setShowSweeps] = useState(false);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounced(query, 250);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);

  // Close the search dropdown on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const searchQ = useSearchChartInstruments(
    { q: debouncedQuery || undefined, segment },
    {
      query: {
        staleTime: 60_000,
        enabled: searchOpen,
        queryKey: getSearchChartInstrumentsQueryKey({ q: debouncedQuery || undefined, segment }),
      },
    },
  );
  const results: ChartInstrument[] = searchQ.data?.instruments ?? [];

  const candlesQ = useGetChartCandles(
    { symbol: selection.symbol, segment: selection.segment, tf: timeframe },
    {
      query: {
        enabled: !!selection.symbol,
        refetchInterval: 60_000,
        staleTime: 30_000,
        queryKey: getGetChartCandlesQueryKey({
          symbol: selection.symbol,
          segment: selection.segment,
          tf: timeframe,
        }),
      },
    },
  );

  const resp = candlesQ.data;
  const candles: RenderCandle[] = useMemo(
    () =>
      (resp?.candles ?? []).map(c => ({
        t: c.t,
        o: c.o,
        h: c.h,
        l: c.l,
        c: c.c,
        v: c.v ?? null,
      })),
    [resp],
  );

  const indicatorCandles: IndicatorCandle[] = candles;

  const emaAll = useMemo(() => emaRibbon(indicatorCandles), [indicatorCandles]);
  const emaSeries = useMemo(() => {
    const out: Partial<Record<EmaPeriod, (number | null)[]>> = {};
    for (const p of EMA_PERIODS) if (emaVisible[p]) out[p] = emaAll[p];
    return out;
  }, [emaAll, emaVisible]);

  const intraday = isIntraday(timeframe);
  const vwapSeries = useMemo(
    () => (showVwap && intraday ? vwap(indicatorCandles, true) : null),
    [showVwap, intraday, indicatorCandles],
  );
  const rsiSeries = useMemo(
    () => (showRsi ? rsiClose(indicatorCandles, 14) : null),
    [showRsi, indicatorCandles],
  );

  // CVD and POC are volume-derived; on null-volume sources (e.g. delayed Yahoo /
  // global symbols) they are honestly unavailable, so the toggles are disabled.
  const hasVolume = useMemo(
    () => candles.some(c => c.v != null && Number.isFinite(c.v) && c.v > 0),
    [candles],
  );
  const cvdSeries = useMemo(
    () => (showCvd && hasVolume ? cvdProxy(indicatorCandles) : null),
    [showCvd, hasVolume, indicatorCandles],
  );
  const pocPrice = useMemo(
    () => (showPoc && hasVolume ? volumeProfilePoc(indicatorCandles) : null),
    [showPoc, hasVolume, indicatorCandles],
  );
  const fvgZones = useMemo(
    () => (showFvg ? detectFvgs(indicatorCandles, 6) : []),
    [showFvg, indicatorCandles],
  );
  const sweepMarkers = useMemo(
    () => (showSweeps ? detectSweeps(indicatorCandles, 5) : []),
    [showSweeps, indicatorCandles],
  );

  function pick(inst: ChartInstrument) {
    setSelection({ symbol: inst.symbol, name: inst.name, segment: inst.segment });
    setSegment(inst.segment);
    setSearchOpen(false);
    setQuery("");
  }

  const source = resp?.source ?? null;
  const isLoading = candlesQ.isLoading;
  const isError = candlesQ.isError;
  const hasNoData = !isLoading && !isError && source === "none";
  const hasData = !isLoading && !isError && candles.length > 0;

  return (
    <div className="space-y-3">
      {/* ── Toolbar ─────────────────────────────────────────────── */}
      <Card className="p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Segment selector */}
          <div className="flex rounded-md border border-border overflow-hidden">
            {SEGMENTS.map(s => (
              <button
                key={s.value}
                onClick={() => setSegment(s.value)}
                className={`px-3 py-1.5 text-xs font-mono uppercase tracking-wide transition-colors ${
                  segment === s.value
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-muted/40"
                }`}
                data-testid={`segment-${s.value}`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Symbol search */}
          <div ref={searchBoxRef} className="relative flex-1 min-w-[200px] max-w-sm">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchOpen ? query : selection.symbol}
                onChange={e => setQuery(e.target.value)}
                onFocus={() => {
                  setSearchOpen(true);
                  setQuery("");
                }}
                placeholder="Search symbol…"
                className="pl-8 pr-8 font-mono"
                data-testid="symbol-search"
              />
              {searchOpen && (
                <button
                  onClick={() => setSearchOpen(false)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {searchOpen && (
              <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg max-h-72 overflow-y-auto">
                {searchQ.isLoading && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>
                )}
                {!searchQ.isLoading && results.length === 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">No matches</div>
                )}
                {results.map(inst => (
                  <button
                    key={`${inst.segment}:${inst.symbol}`}
                    onClick={() => pick(inst)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50"
                    data-testid={`result-${inst.symbol}`}
                  >
                    <span className="flex flex-col">
                      <span className="font-mono font-semibold">{inst.symbol}</span>
                      <span className="text-xs text-muted-foreground truncate max-w-[220px]">
                        {inst.name}
                      </span>
                    </span>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {inst.type}
                    </Badge>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Chart-type toggle */}
          <div className="flex rounded-md border border-border overflow-hidden ml-auto">
            <button
              onClick={() => setChartType("candles")}
              className={`px-2.5 py-1.5 transition-colors ${
                chartType === "candles" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/40"
              }`}
              title="Candlesticks"
              data-testid="chart-type-candles"
            >
              <CandlestickChart className="h-4 w-4" />
            </button>
            <button
              onClick={() => setChartType("line")}
              className={`px-2.5 py-1.5 transition-colors ${
                chartType === "line" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/40"
              }`}
              title="Line"
              data-testid="chart-type-line"
            >
              <LineIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Timeframe + indicator toggles */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap rounded-md border border-border overflow-hidden">
            {TIMEFRAMES.map(tf => (
              <button
                key={tf.value}
                onClick={() => setTimeframe(tf.value)}
                className={`px-2.5 py-1 text-xs font-mono transition-colors ${
                  timeframe === tf.value ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/40"
                }`}
                data-testid={`tf-${tf.value}`}
              >
                {tf.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {EMA_PERIODS.map(p => (
              <button
                key={p}
                onClick={() => setEmaVisible(prev => ({ ...prev, [p]: !prev[p] }))}
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-mono transition-colors ${
                  emaVisible[p] ? "border-border bg-muted/40" : "border-transparent text-muted-foreground/60"
                }`}
                data-testid={`ema-${p}`}
              >
                <span
                  className="inline-block w-2 h-2 rounded-sm"
                  style={{ background: emaVisible[p] ? EMA_COLORS[p] : "rgba(120,120,140,0.4)" }}
                />
                EMA{p}
              </button>
            ))}
            <button
              onClick={() => setShowVwap(v => !v)}
              disabled={!intraday}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-mono transition-colors disabled:opacity-40 ${
                showVwap && intraday ? "border-border bg-muted/40" : "border-transparent text-muted-foreground/60"
              }`}
              title={intraday ? "Session VWAP" : "VWAP is intraday-only"}
              data-testid="toggle-vwap"
            >
              <span className="inline-block w-2 h-2 rounded-sm" style={{ background: VWAP_COLOR }} />
              VWAP
            </button>
            <button
              onClick={() => setShowVolume(v => !v)}
              className={`rounded-full border px-2 py-0.5 text-[11px] font-mono transition-colors ${
                showVolume ? "border-border bg-muted/40" : "border-transparent text-muted-foreground/60"
              }`}
              data-testid="toggle-volume"
            >
              VOL
            </button>
            <button
              onClick={() => setShowRsi(v => !v)}
              className={`rounded-full border px-2 py-0.5 text-[11px] font-mono transition-colors ${
                showRsi ? "border-border bg-muted/40" : "border-transparent text-muted-foreground/60"
              }`}
              data-testid="toggle-rsi"
            >
              RSI
            </button>

            <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />

            <button
              onClick={() => setShowFvg(v => !v)}
              className={`rounded-full border px-2 py-0.5 text-[11px] font-mono transition-colors ${
                showFvg ? "border-border bg-muted/40" : "border-transparent text-muted-foreground/60"
              }`}
              title="Fair Value Gaps — 3-candle price imbalances"
              data-testid="toggle-fvg"
            >
              FVG
            </button>
            <button
              onClick={() => setShowCvd(v => !v)}
              disabled={!hasVolume}
              className={`rounded-full border px-2 py-0.5 text-[11px] font-mono transition-colors disabled:opacity-40 ${
                showCvd && hasVolume ? "border-border bg-muted/40" : "border-transparent text-muted-foreground/60"
              }`}
              title={
                hasVolume
                  ? "Cumulative Volume Delta — candle-direction proxy (not true order-flow)"
                  : "CVD needs volume — unavailable on this source"
              }
              data-testid="toggle-cvd"
            >
              CVD*
            </button>
            <button
              onClick={() => setShowPoc(v => !v)}
              disabled={!hasVolume}
              className={`rounded-full border px-2 py-0.5 text-[11px] font-mono transition-colors disabled:opacity-40 ${
                showPoc && hasVolume ? "border-border bg-muted/40" : "border-transparent text-muted-foreground/60"
              }`}
              title={
                hasVolume
                  ? "Point of Control — volume-profile approximation"
                  : "POC needs volume — unavailable on this source"
              }
              data-testid="toggle-poc"
            >
              POC
            </button>
            <button
              onClick={() => setShowSweeps(v => !v)}
              className={`rounded-full border px-2 py-0.5 text-[11px] font-mono transition-colors ${
                showSweeps ? "border-border bg-muted/40" : "border-transparent text-muted-foreground/60"
              }`}
              title="Liquidity Sweeps — stop-runs beyond recent highs/lows that reject"
              data-testid="toggle-sweeps"
            >
              Sweeps
            </button>
          </div>
        </div>
      </Card>

      {/* ── Header / badges ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 px-1">
        <h2 className="font-mono text-lg font-semibold tracking-tight">{selection.symbol}</h2>
        <span className="text-sm text-muted-foreground truncate max-w-[260px]">{selection.name}</span>
        <div className="ml-auto flex items-center gap-2">
          {source && (
            <Badge
              variant={source === "kite" ? "default" : source === "yahoo" ? "secondary" : "outline"}
              className="text-[10px] uppercase font-mono"
              data-testid="badge-source"
            >
              {source === "kite" ? "Kite" : source === "yahoo" ? "Yahoo · delayed" : "Data unavailable"}
            </Badge>
          )}
          {hasData && (
            <Badge
              variant={source === "kite" && resp?.fresh ? "default" : "outline"}
              className="text-[10px] uppercase font-mono"
              data-testid="badge-fresh"
            >
              {source === "kite"
                ? resp?.fresh
                  ? "Live"
                  : `Stale · ${fmtAge(resp?.asOf)}`
                : `Last updated ${fmtAge(resp?.asOf)}`}
            </Badge>
          )}
        </div>
      </div>

      {/* ── Chart surface ───────────────────────────────────────── */}
      <Card className="p-2 sm:p-3">
        {isLoading && (
          <div className="flex h-[480px] items-center justify-center text-sm text-muted-foreground" data-testid="chart-loading">
            <div className="flex flex-col items-center gap-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
              Loading candles…
            </div>
          </div>
        )}

        {isError && (
          <div className="flex h-[480px] flex-col items-center justify-center gap-3 text-center" data-testid="chart-error">
            <AlertTriangle className="h-7 w-7 text-amber-500" />
            <div className="text-sm text-muted-foreground">
              Couldn't load the datafeed. Please retry.
            </div>
            <Button variant="outline" size="sm" onClick={() => candlesQ.refetch()}>
              Retry
            </Button>
          </div>
        )}

        {hasNoData && (
          <div className="flex h-[480px] flex-col items-center justify-center gap-3 text-center" data-testid="chart-empty">
            <AlertTriangle className="h-7 w-7 text-muted-foreground" />
            <div className="max-w-md text-sm text-muted-foreground">
              {resp?.message ?? "No data available for this instrument / timeframe right now."}
            </div>
            <Button variant="outline" size="sm" onClick={() => candlesQ.refetch()}>
              Retry
            </Button>
          </div>
        )}

        {hasData && (
          <ChartingChart
            candles={candles}
            chartType={chartType}
            emaSeries={emaSeries}
            vwapSeries={vwapSeries}
            rsiSeries={rsiSeries}
            cvdSeries={cvdSeries}
            pocPrice={pocPrice}
            fvgZones={fvgZones}
            sweepMarkers={sweepMarkers}
            showVolume={showVolume}
            showRsi={showRsi}
            showCvd={showCvd}
            showTime={timeframeShowsTime(timeframe)}
          />
        )}
      </Card>

      <div className="px-1 text-[11px] text-muted-foreground space-y-1">
        <p>
          Read-only charting. Price data is sourced live from Zerodha Kite where available, otherwise from
          delayed Yahoo Finance. All indicators (EMA, VWAP, RSI, FVG, CVD, POC, Liquidity Sweeps) are computed
          client-side in your browser for visualization only — this is not trading advice.
        </p>
        <p>
          <span className="font-mono">CVD*</span> is a candle-direction proxy (bar volume signed by close vs
          open), not true tick-level order-flow delta — this feed has no bid/ask aggression data.
          <span className="font-mono"> POC</span> is a volume-profile approximation. Both need volume and are
          disabled on sources that don't provide it (e.g. delayed Yahoo / global symbols).
        </p>
      </div>
    </div>
  );
}
