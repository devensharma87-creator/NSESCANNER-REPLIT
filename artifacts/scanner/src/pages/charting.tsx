/**
 * Charting — read-only technical-analysis terminal (Phase 2 MVP).
 *
 * Symbol search across indices / equities / global, a 9-step timeframe
 * switcher, candlestick/line + volume, a multi-EMA ribbon (11/20/50/100/200),
 * session-anchored VWAP (intraday), and an RSI sub-pane. All indicator math
 * is computed client-side from the normalized /api/chart/candles feed. This
 * tab never places orders or mutates any state.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  useSearchChartInstruments,
  getSearchChartInstrumentsQueryKey,
  useGetChartCandles,
  getGetChartCandlesQueryKey,
  useGetOptionAnalytics,
  getGetOptionAnalyticsQueryKey,
  type ChartInstrument,
} from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, AlertTriangle, CandlestickChart, LineChart as LineIcon, X, Maximize2, Minimize2 } from "lucide-react";
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
  fibLevels,
  fixedVolumeProfile,
  computeKeyLevels,
  sliceByWindow,
  VP_WINDOWS,
  EMA_PERIODS,
  type EmaPeriod,
  type IndicatorCandle,
  type VpWindow,
  type OptionLevels,
} from "@/lib/charting/indicators";
import { findFno } from "@/data/fnoUniverse";

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

// Declutter: everything OFF by default — the default view is clean candles +
// volume only. The toggle pills stay visible so the tools are one tap away.
const DEFAULT_EMA_VISIBLE: Record<EmaPeriod, boolean> = {
  11: false,
  20: false,
  50: false,
  100: false,
  200: false,
};

// Fit-to-screen: the chart fills the viewport from its own top edge down to a
// small bottom gap, so the whole chart + time axis is visible without scrolling
// (Kite-style). These bound that computed height.
const BOTTOM_GAP_PX = 14; // breathing room below the chart card
const MIN_CHART_PX = 340; // never collapse smaller than this

// SSR / first-paint fallback before we can measure the real top offset.
function clampHeight(innerHeight: number): number {
  return Math.max(MIN_CHART_PX, Math.min(1100, Math.round(innerHeight * 0.7)));
}

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
  // Declutter: overlays/oscillators start OFF; only volume is on by default.
  const [showVwap, setShowVwap] = useState(false);
  const [showVolume, setShowVolume] = useState(true);
  const [showRsi, setShowRsi] = useState(false);
  // Institutional / SMC indicators (off by default to keep the default view clean).
  const [showFvg, setShowFvg] = useState(false);
  const [showCvd, setShowCvd] = useState(false);
  const [showPoc, setShowPoc] = useState(false);
  const [showSweeps, setShowSweeps] = useState(false);
  // Pro-grade overlays (Kite-style): auto-Fibonacci, Fixed Volume Profile, S/R.
  const [showFib, setShowFib] = useState(false);
  const [showVp, setShowVp] = useState(false);
  const [vpWindow, setVpWindow] = useState<VpWindow>("ALL");
  const [showKeyLevels, setShowKeyLevels] = useState(false);

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

  // Volume-derived overlays (VWAP, CVD, POC, Volume Profile) need real volume.
  // On null-volume sources (delayed Yahoo / global) they are honestly disabled.
  // For spot indices the backend overlays nearest-month FUTURES volume on the
  // Kite path, so VWAP/VP become available there too (labelled "· FUT").
  const hasVolume = useMemo(
    () => candles.some(c => c.v != null && Number.isFinite(c.v) && c.v > 0),
    [candles],
  );

  // Session VWAP is intraday-only AND volume-weighted, so it needs both an
  // intraday timeframe and a volume-bearing source (futures volume for indices).
  const vwapSeries = useMemo(
    () => (showVwap && intraday && hasVolume ? vwap(indicatorCandles, true) : null),
    [showVwap, intraday, hasVolume, indicatorCandles],
  );
  const rsiSeries = useMemo(
    () => (showRsi ? rsiClose(indicatorCandles, 14) : null),
    [showRsi, indicatorCandles],
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

  // ── Pro overlays: auto-Fibonacci, Fixed Volume Profile, Support/Resistance ──
  const currentPrice = useMemo(() => {
    const last = candles[candles.length - 1];
    return last && Number.isFinite(last.c) ? last.c : null;
  }, [candles]);

  const fibResult = useMemo(
    () => (showFib ? fibLevels(indicatorCandles) : null),
    [showFib, indicatorCandles],
  );

  const volumeProfile = useMemo(
    () => (showVp && hasVolume ? fixedVolumeProfile(sliceByWindow(indicatorCandles, vpWindow)) : null),
    [showVp, hasVolume, indicatorCandles, vpWindow],
  );

  // Option-chain S/R only exists for F&O underlyings (NSE index/equity). It is
  // fetched lazily — only when S/R is toggled on for an F&O symbol that isn't a
  // global instrument — so the rest of the tab never touches the option feed.
  const fno = useMemo(
    () => (selection.segment === "global" ? undefined : findFno(selection.symbol)),
    [selection.symbol, selection.segment],
  );
  const wantOptionLevels = showKeyLevels && !!fno;
  const optionAnalyticsQ = useGetOptionAnalytics(
    selection.symbol,
    undefined,
    {
      query: {
        enabled: wantOptionLevels,
        staleTime: 60_000,
        refetchInterval: 60_000,
        queryKey: getGetOptionAnalyticsQueryKey(selection.symbol, undefined),
      },
    },
  );

  const optionLevels: OptionLevels | null = useMemo(() => {
    if (!wantOptionLevels) return null;
    const a = optionAnalyticsQ.data;
    if (!a) return null;
    const supports = (a.topSupport ?? [])
      .map(s => s.strike)
      .filter((s): s is number => Number.isFinite(s) && s > 0);
    const resistances = (a.topResistance ?? [])
      .map(r => r.strike)
      .filter((r): r is number => Number.isFinite(r) && r > 0);
    if (supports.length === 0 && resistances.length === 0) return null;
    return { supports, resistances };
  }, [wantOptionLevels, optionAnalyticsQ.data]);

  const keyLevelsResult = useMemo(
    () =>
      showKeyLevels && currentPrice != null
        ? computeKeyLevels(indicatorCandles, currentPrice, optionLevels)
        : null,
    [showKeyLevels, currentPrice, indicatorCandles, optionLevels],
  );
  const keyLevelsFlat = useMemo(
    () => (keyLevelsResult ? [...keyLevelsResult.supports, ...keyLevelsResult.resistances] : null),
    [keyLevelsResult],
  );

  // Responsive, viewport-driven chart height (~70vh, clamped) so the chart
  // breathes on large screens but stays usable on laptops.
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const chartCardRef = useRef<HTMLDivElement | null>(null);
  const [fitHeight, setFitHeight] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Fit-to-screen: measure the chart card's top edge and fill the viewport down
  // to a small bottom gap, so the entire chart + time axis is visible without
  // scrolling (Kite-style), in BOTH normal and full-screen modes. The
  // toolbar/header heights are absorbed automatically because we measure the
  // live top offset. We observe the toolbar + header (the chrome ABOVE the
  // chart) — NOT the page root — so layout shifts that a window "resize" misses
  // (header name truncation, badge-row wrapping, async Kite/Stale/Vol·FUT
  // badges) still trigger a remeasure, WITHOUT the chart's own height change
  // feeding back into the observer (which caused a ResizeObserver loop crash).
  useLayoutEffect(() => {
    let raf = 0;
    function measure() {
      const el = chartCardRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const avail = window.innerHeight - top - BOTTOM_GAP_PX;
      const next = Math.max(MIN_CHART_PX, Math.round(avail));
      setFitHeight((prev) => (prev != null && Math.abs(prev - next) <= 1 ? prev : next));
    }
    function schedule() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    }
    measure();
    window.addEventListener("resize", schedule);
    const ro = new ResizeObserver(schedule);
    if (toolbarRef.current) ro.observe(toolbarRef.current);
    if (headerRef.current) ro.observe(headerRef.current);
    // Re-measure shortly after paint so toolbar wrapping/fonts settle first.
    const t = window.setTimeout(measure, 120);
    return () => {
      window.removeEventListener("resize", schedule);
      ro.disconnect();
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
  }, [isFullscreen]);

  // Escape exits full-screen.
  useEffect(() => {
    if (!isFullscreen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setIsFullscreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  const effectiveHeight =
    fitHeight ?? clampHeight(typeof window === "undefined" ? 900 : window.innerHeight);

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
    <div className={isFullscreen ? "fixed inset-0 z-50 overflow-auto bg-background p-3 space-y-3" : "space-y-3"}>
      {/* ── Toolbar ─────────────────────────────────────────────── */}
      <Card ref={toolbarRef} className="p-3 space-y-3">
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
              disabled={!intraday || !hasVolume}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-mono transition-colors disabled:opacity-40 ${
                showVwap && intraday && hasVolume ? "border-border bg-muted/40" : "border-transparent text-muted-foreground/60"
              }`}
              title={
                !intraday
                  ? "VWAP is intraday-only"
                  : !hasVolume
                    ? "VWAP needs volume — unavailable on this source"
                    : "Session VWAP (volume-weighted)"
              }
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

            <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />

            <button
              onClick={() => setShowFib(v => !v)}
              className={`rounded-full border px-2 py-0.5 text-[11px] font-mono transition-colors ${
                showFib ? "border-border bg-muted/40" : "border-transparent text-muted-foreground/60"
              }`}
              title="Auto-Fibonacci — retracement (0→1.0) + extensions (1.272 / 1.618) off the dominant swing"
              data-testid="toggle-fib"
            >
              Fib
            </button>
            <button
              onClick={() => setShowVp(v => !v)}
              disabled={!hasVolume}
              className={`rounded-full border px-2 py-0.5 text-[11px] font-mono transition-colors disabled:opacity-40 ${
                showVp && hasVolume ? "border-border bg-muted/40" : "border-transparent text-muted-foreground/60"
              }`}
              title={
                hasVolume
                  ? "Fixed Volume Profile — volume-by-price histogram with POC / VAH / VAL"
                  : "Volume Profile needs volume — unavailable on this source"
              }
              data-testid="toggle-vp"
            >
              Vol Profile
            </button>
            {showVp && hasVolume && (
              <div className="flex rounded-md border border-border overflow-hidden" data-testid="vp-window">
                {VP_WINDOWS.map(w => (
                  <button
                    key={w.value}
                    onClick={() => setVpWindow(w.value)}
                    className={`px-1.5 py-0.5 text-[10px] font-mono transition-colors ${
                      vpWindow === w.value ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/40"
                    }`}
                    data-testid={`vp-window-${w.value}`}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => setShowKeyLevels(v => !v)}
              className={`rounded-full border px-2 py-0.5 text-[11px] font-mono transition-colors ${
                showKeyLevels ? "border-border bg-muted/40" : "border-transparent text-muted-foreground/60"
              }`}
              title="Support / Resistance — 3+3 ranked levels from Fibonacci + Price Action + (for F&O) Option-Chain OI; labels show the backing sources"
              data-testid="toggle-key-levels"
            >
              S/R
            </button>
          </div>
        </div>
      </Card>

      {/* ── Header / badges ─────────────────────────────────────── */}
      <div ref={headerRef} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1">
        <h2 className="font-mono text-lg font-semibold tracking-tight shrink-0">{selection.symbol}</h2>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{selection.name}</span>
        <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1.5">
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
          {segment === "index" && source === "kite" && hasVolume && (
            <Badge
              variant="outline"
              className="text-[10px] uppercase font-mono"
              title="Spot indices have no volume; this chart uses nearest-month index futures volume for VWAP / Volume Profile."
              data-testid="badge-futures-volume"
            >
              Vol · {selection.symbol} FUT
            </Badge>
          )}
          <button
            onClick={() => setIsFullscreen(v => !v)}
            className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-mono text-muted-foreground transition-colors hover:bg-muted/40"
            title={isFullscreen ? "Exit full screen (Esc)" : "Full screen"}
            data-testid="toggle-fullscreen"
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{isFullscreen ? "Exit" : "Full screen"}</span>
          </button>
        </div>
      </div>

      {/* ── Chart surface ───────────────────────────────────────── */}
      <Card ref={chartCardRef} className="p-2 sm:p-3">
        {isLoading && (
          <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height: effectiveHeight }} data-testid="chart-loading">
            <div className="flex flex-col items-center gap-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
              Loading candles…
            </div>
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center justify-center gap-3 text-center" style={{ height: effectiveHeight }} data-testid="chart-error">
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
          <div className="flex flex-col items-center justify-center gap-3 text-center" style={{ height: effectiveHeight }} data-testid="chart-empty">
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
            fibLevels={fibResult?.levels ?? null}
            volumeProfile={volumeProfile}
            showVolumeProfile={showVp}
            keyLevels={keyLevelsFlat}
            showKeyLevels={showKeyLevels}
            showVolume={showVolume}
            showRsi={showRsi}
            showCvd={showCvd}
            showTime={timeframeShowsTime(timeframe)}
            height={effectiveHeight}
          />
        )}
      </Card>

      <div className="px-1 text-[11px] text-muted-foreground space-y-1">
        <p>
          Read-only charting. Price data is sourced live from Zerodha Kite where available, otherwise from
          delayed Yahoo Finance. All overlays (EMA, VWAP, RSI, FVG, CVD, POC, Sweeps, Fibonacci, Volume
          Profile, Support/Resistance) are computed client-side in your browser for visualization only — this
          is not trading advice.
        </p>
        <p>
          <span className="font-mono">CVD*</span> is a candle-direction proxy (bar volume signed by close vs
          open), not true tick-level order-flow delta — this feed has no bid/ask aggression data.
          <span className="font-mono"> POC</span> / <span className="font-mono">Vol Profile</span> are
          volume-profile approximations (no intrabar ticks) and need volume, so they are disabled on sources
          that don't provide it (e.g. delayed Yahoo / global symbols).
        </p>
        <p>
          <span className="font-mono">VWAP</span> is the intraday volume-weighted average price. Spot indices
          carry no volume of their own, so on the Kite feed this chart overlays the nearest-month index
          <span className="font-mono"> FUTURES</span> volume (shown by the{" "}
          <span className="font-mono">Vol · FUT</span> badge) to make VWAP and Volume Profile meaningful — the
          TradingView convention. When no real volume is available, VWAP is honestly disabled (no fabricated
          volume).
        </p>
        <p>
          <span className="font-mono">Fibonacci</span> is drawn off the dominant swing in the loaded window
          (solid retracements 0→1.0, with the 0.5 / 0.618 golden pocket emphasized, plus dotted 1.272 / 1.618
          extensions). <span className="font-mono">Support/Resistance</span>{" "}
          ranks the 3 nearest levels on each side by clustering Fibonacci, price-action swings and — for F&amp;O
          underlyings — option-chain OI; each label shows the sources that back it. Levels appear only when
          there is enough data; nothing is fabricated.
        </p>
      </div>
    </div>
  );
}
