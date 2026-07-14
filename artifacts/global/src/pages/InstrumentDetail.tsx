import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useRoute } from "wouter";
import {
  useGetGlobalInstrumentDetail,
  useGetGlobalCandles,
  useGetGlobalInstrumentIndicators,
  useAddGlobalWatchlist,
  useDeleteGlobalWatchlist,
  useGetGlobalWatchlist,
  getGetGlobalWatchlistQueryKey,
  getGetGlobalInstrumentDetailQueryKey,
  getGetGlobalCandlesQueryKey,
  getGetGlobalInstrumentIndicatorsQueryKey,
  type GlobalTimeframe,
  type GlobalInstrumentDetail,
  type GlobalCandle,
  type GlobalIndicatorPoint,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Star, StarOff, AlertTriangle } from "lucide-react";

const TIMEFRAMES: GlobalTimeframe[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

const OVERLAY_INDICATORS = [
  { id: "sma20",  label: "SMA 20",  color: "#06b6d4" },
  { id: "sma50",  label: "SMA 50",  color: "#a78bfa" },
  { id: "sma200", label: "SMA 200", color: "#f97316" },
  { id: "ema20",  label: "EMA 20",  color: "#22c55e" },
  { id: "ema50",  label: "EMA 50",  color: "#eab308" },
  { id: "vwap",   label: "VWAP",    color: "#ec4899" },
  { id: "supertrend", label: "Supertrend", color: "#14b8a6" },
  { id: "bb20",   label: "BB(20,2)", color: "#94a3b8" },
] as const;

type OverlayId = typeof OVERLAY_INDICATORS[number]["id"];

const OSCILLATORS = [
  { id: "rsi14", label: "RSI(14)" },
  { id: "macd",  label: "MACD" },
] as const;

type OscillatorId = typeof OSCILLATORS[number]["id"];

export function InstrumentDetailPage() {
  const [, params] = useRoute<{ symbol: string }>("/i/:symbol");
  const symbol = (params?.symbol ?? "").toUpperCase();
  const [timeframe, setTimeframe] = useState<GlobalTimeframe>("1h");
  const [overlays, setOverlays] = useState<Set<OverlayId>>(new Set(["ema20", "ema50"]));
  const [oscillator, setOscillator] = useState<OscillatorId | null>("rsi14");

  const detail = useGetGlobalInstrumentDetail(symbol, {
    query: { queryKey: getGetGlobalInstrumentDetailQueryKey(symbol), enabled: !!symbol, refetchInterval: 30_000, refetchOnWindowFocus: false },
  });

  const supportedTfs = detail.data?.instrument.supportedTimeframes ?? TIMEFRAMES;
  // Snap to a supported tf if the user-selected one isn't allowed for this asset
  useEffect(() => {
    if (supportedTfs.length > 0 && !supportedTfs.includes(timeframe)) {
      setTimeframe(supportedTfs.includes("1h") ? "1h" : (supportedTfs[supportedTfs.length - 1] ?? "1d"));
    }
  }, [supportedTfs, timeframe]);

  const candleParams = { timeframe, limit: 300 };
  const candles = useGetGlobalCandles(
    symbol,
    candleParams,
    { query: { queryKey: getGetGlobalCandlesQueryKey(symbol, candleParams), enabled: !!symbol && supportedTfs.includes(timeframe), refetchInterval: 30_000, refetchOnWindowFocus: false } },
  );
  const indicatorParams = {
    timeframe,
    list: [...overlays, ...(oscillator ? [oscillator] : [])].join(","),
    limit: 300,
  };
  const indicators = useGetGlobalInstrumentIndicators(
    symbol,
    indicatorParams,
    { query: { queryKey: getGetGlobalInstrumentIndicatorsQueryKey(symbol, indicatorParams), enabled: !!symbol && supportedTfs.includes(timeframe), refetchInterval: 30_000, refetchOnWindowFocus: false } },
  );

  const wl = useGetGlobalWatchlist({ query: { queryKey: getGetGlobalWatchlistQueryKey(), refetchOnWindowFocus: false } });
  const isWatched = (wl.data?.items ?? []).some((i) => i.symbol === symbol);
  const qc = useQueryClient();
  const addWl = useAddGlobalWatchlist({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getGetGlobalWatchlistQueryKey() }) },
  });
  const delWl = useDeleteGlobalWatchlist({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getGetGlobalWatchlistQueryKey() }) },
  });

  if (!symbol) return <div>Bad URL.</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <span className="font-mono">{symbol}</span>
              <span className="text-muted-foreground">·</span>
              <span>{detail.data?.instrument.displayName ?? ""}</span>
              {detail.data?.instrument.assetClass && (
                <Badge variant="secondary" className="ml-1">{detail.data.instrument.assetClass}</Badge>
              )}
            </h1>
            <div className="text-xs text-muted-foreground">
              source: {detail.data?.instrument.source} ·{" "}
              {detail.data?.quote?.updatedAt
                ? `updated ${new Date(detail.data.quote.updatedAt).toLocaleTimeString()}`
                : "no live quote yet"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={isWatched ? "default" : "outline"}
            size="sm"
            onClick={() =>
              isWatched ? delWl.mutate({ symbol }) : addWl.mutate({ data: { symbol } })
            }
            data-testid="button-toggle-watch"
          >
            {isWatched ? <Star className="h-4 w-4 mr-1 fill-current" /> : <StarOff className="h-4 w-4 mr-1" />}
            {isWatched ? "Watching" : "Watch"}
          </Button>
        </div>
      </div>

      <QuoteStrip detail={detail.data} />

      {detail.data?.instrument.notes && (
        <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-md p-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>{detail.data.instrument.notes}</span>
        </div>
      )}

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground mr-1">Timeframe:</span>
            {TIMEFRAMES.map((tf) => {
              const supported = supportedTfs.includes(tf);
              const active = timeframe === tf;
              return (
                <Button
                  key={tf}
                  variant={active ? "default" : "outline"}
                  size="sm"
                  disabled={!supported}
                  onClick={() => setTimeframe(tf)}
                  data-testid={`btn-tf-${tf}`}
                  className="h-7 px-2 text-xs"
                >
                  {tf}
                </Button>
              );
            })}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-muted-foreground">Overlays:</span>
            {OVERLAY_INDICATORS.map((ind) => (
              <label key={ind.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                <Checkbox
                  checked={overlays.has(ind.id)}
                  onCheckedChange={(v) => {
                    setOverlays((prev) => {
                      const next = new Set(prev);
                      if (v) next.add(ind.id); else next.delete(ind.id);
                      return next;
                    });
                  }}
                  data-testid={`check-overlay-${ind.id}`}
                />
                <span style={{ color: ind.color }}>●</span>{ind.label}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Oscillator:</span>
            {OSCILLATORS.map((o) => (
              <Button
                key={o.id}
                variant={oscillator === o.id ? "default" : "outline"}
                size="sm"
                onClick={() => setOscillator(oscillator === o.id ? null : o.id)}
                className="h-7 px-2 text-xs"
                data-testid={`btn-osc-${o.id}`}
              >
                {o.label}
              </Button>
            ))}
          </div>
        </div>

        {(candles.isLoading || indicators.isLoading) ? (
          <Skeleton className="h-[420px] w-full" />
        ) : candles.error ? (
          <Card className="p-6 text-center text-destructive text-sm">
            Couldn't load candles: {(candles.error as Error)?.message ?? "upstream error"}
          </Card>
        ) : (
          <ChartView
            candles={candles.data?.candles ?? []}
            overlays={overlays}
            oscillator={oscillator}
            indicators={indicators.data?.indicators ?? null}
          />
        )}
      </Card>
    </div>
  );
}

function QuoteStrip({ detail }: { detail: GlobalInstrumentDetail | undefined }) {
  if (!detail) return null;
  const q = detail.quote;
  if (!q) return <Card className="p-3 text-sm text-muted-foreground">Live quote not yet available</Card>;
  const up = (q.changePct ?? 0) >= 0;
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <Stat label="Price" value={fmt(q.price)} sub={detail.instrument.currency ?? undefined} />
      <Stat label="Δ" value={q.changeAbs != null ? `${q.changeAbs >= 0 ? "+" : ""}${fmt(q.changeAbs)}` : "—"} tone={up ? "pos" : "neg"} />
      <Stat label="Δ%" value={q.changePct != null ? `${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(2)}%` : "—"} tone={up ? "pos" : "neg"} />
      <Stat label="Day H/L" value={`${fmt(q.dayHigh)} / ${fmt(q.dayLow)}`} />
      <Stat label="Volume" value={fmtVol(q.volume)} />
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "pos" | "neg" }) {
  const cls = tone === "pos" ? "text-emerald-600 dark:text-emerald-400"
            : tone === "neg" ? "text-rose-600 dark:text-rose-400"
            : "";
  return (
    <Card className="p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`font-mono text-lg tabular-nums ${cls}`}>
        {value}
        {sub && <span className="text-xs text-muted-foreground ml-1">{sub}</span>}
      </div>
    </Card>
  );
}

function fmt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (Math.abs(v) >= 1) return v.toFixed(4);
  return v.toFixed(6);
}
function fmtVol(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v === 0) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

type IndicatorMap = { [key: string]: GlobalIndicatorPoint[] };

function ChartView({
  candles,
  overlays,
  oscillator,
  indicators,
}: {
  candles: GlobalCandle[];
  overlays: Set<OverlayId>;
  oscillator: OscillatorId | null;
  indicators: IndicatorMap | null;
}) {
  const mainRef = useRef<HTMLDivElement | null>(null);
  const oscRef = useRef<HTMLDivElement | null>(null);
  const mainChartRef = useRef<IChartApi | null>(null);
  const oscChartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const overlayLinesRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const oscLinesRef = useRef<Map<string, ISeriesApi<"Line"> | ISeriesApi<"Histogram">>>(new Map());

  const candleData = useMemo(
    () => candles.map((c) => ({ time: (c.t / 1000) as Time, open: c.open, high: c.high, low: c.low, close: c.close })),
    [candles],
  );

  // Init main chart
  useEffect(() => {
    if (!mainRef.current) return;
    const chart = createChart(mainRef.current, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: "#94a3b8", fontFamily: "Inter, sans-serif" },
      grid: { vertLines: { color: "rgba(148,163,184,0.1)" }, horzLines: { color: "rgba(148,163,184,0.1)" } },
      timeScale: { borderColor: "rgba(148,163,184,0.2)", timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: "rgba(148,163,184,0.2)" },
      crosshair: { mode: 1 },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });
    mainChartRef.current = chart;
    candleSeriesRef.current = series;
    return () => { chart.remove(); mainChartRef.current = null; candleSeriesRef.current = null; overlayLinesRef.current.clear(); };
  }, []);

  // Init oscillator chart
  useEffect(() => {
    if (!oscillator || !oscRef.current) {
      if (oscChartRef.current) { oscChartRef.current.remove(); oscChartRef.current = null; oscLinesRef.current.clear(); }
      return;
    }
    const chart = createChart(oscRef.current, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: "#94a3b8", fontFamily: "Inter, sans-serif" },
      grid: { vertLines: { color: "rgba(148,163,184,0.1)" }, horzLines: { color: "rgba(148,163,184,0.1)" } },
      timeScale: { borderColor: "rgba(148,163,184,0.2)", timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: "rgba(148,163,184,0.2)" },
      crosshair: { mode: 1 },
    });
    oscChartRef.current = chart;
    return () => { chart.remove(); oscChartRef.current = null; oscLinesRef.current.clear(); };
  }, [oscillator]);

  // Push candles
  useEffect(() => {
    if (candleSeriesRef.current && candleData.length) {
      candleSeriesRef.current.setData(candleData);
      mainChartRef.current?.timeScale().fitContent();
    }
  }, [candleData]);

  // Push overlay lines
  useEffect(() => {
    if (!mainChartRef.current || !indicators) return;
    const chart = mainChartRef.current;
    const wanted = new Set<string>();
    const overlayKeyMap: Record<OverlayId, { keys: string[]; colors: string[]; styles?: number[] }> = {
      sma20:  { keys: ["sma20"],  colors: ["#06b6d4"] },
      sma50:  { keys: ["sma50"],  colors: ["#a78bfa"] },
      sma200: { keys: ["sma200"], colors: ["#f97316"] },
      ema20:  { keys: ["ema20"],  colors: ["#22c55e"] },
      ema50:  { keys: ["ema50"],  colors: ["#eab308"] },
      vwap:   { keys: ["vwap"],   colors: ["#ec4899"] },
      supertrend: { keys: ["supertrend"], colors: ["#14b8a6"] },
      bb20:   { keys: ["bbUpper", "bbMiddle", "bbLower"], colors: ["#94a3b8", "#64748b", "#94a3b8"] },
    };
    for (const id of overlays) {
      const conf = overlayKeyMap[id];
      conf.keys.forEach((k, i) => {
        wanted.add(k);
        let s = overlayLinesRef.current.get(k);
        if (!s) {
          s = chart.addSeries(LineSeries, { color: conf.colors[i], lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
          overlayLinesRef.current.set(k, s);
        }
        const series = indicators[k] ?? [];
        const data = series
          .filter((p): p is { t: number; v: number } => p.v != null)
          .map((p) => ({ time: (p.t / 1000) as Time, value: p.v }));
        s.setData(data);
      });
    }
    // Remove lines no longer wanted
    for (const [key, series] of overlayLinesRef.current.entries()) {
      if (!wanted.has(key)) {
        chart.removeSeries(series);
        overlayLinesRef.current.delete(key);
      }
    }
  }, [overlays, indicators]);

  // Push oscillator data
  useEffect(() => {
    if (!oscChartRef.current || !indicators) return;
    const chart = oscChartRef.current;
    // Reset pane
    for (const [, s] of oscLinesRef.current.entries()) chart.removeSeries(s);
    oscLinesRef.current.clear();

    if (oscillator === "rsi14") {
      const line = chart.addSeries(LineSeries, { color: "#a78bfa", lineWidth: 1 });
      const data = (indicators.rsi14 ?? []).filter((p): p is { t: number; v: number } => p.v != null)
        .map((p) => ({ time: (p.t / 1000) as Time, value: p.v }));
      line.setData(data);
      oscLinesRef.current.set("rsi14", line);
      // Reference 30/70 lines
      [30, 70].forEach((lvl) => {
        const ref = chart.addSeries(LineSeries, { color: "rgba(148,163,184,0.4)", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
        if (data.length) ref.setData(data.map((p) => ({ time: p.time, value: lvl })));
        oscLinesRef.current.set(`rsi-ref-${lvl}`, ref);
      });
    } else if (oscillator === "macd") {
      const macdLine = chart.addSeries(LineSeries, { color: "#3b82f6", lineWidth: 1 });
      const sigLine = chart.addSeries(LineSeries, { color: "#f97316", lineWidth: 1 });
      const hist = chart.addSeries(HistogramSeries, { color: "#94a3b8" });
      const macdData = (indicators.macd ?? []).filter((p): p is { t: number; v: number } => p.v != null)
        .map((p) => ({ time: (p.t / 1000) as Time, value: p.v }));
      const sigData = (indicators.macdSignal ?? []).filter((p): p is { t: number; v: number } => p.v != null)
        .map((p) => ({ time: (p.t / 1000) as Time, value: p.v }));
      const histData = (indicators.macdHist ?? []).filter((p): p is { t: number; v: number } => p.v != null)
        .map((p) => ({ time: (p.t / 1000) as Time, value: p.v, color: p.v >= 0 ? "#22c55e" : "#ef4444" }));
      macdLine.setData(macdData);
      sigLine.setData(sigData);
      hist.setData(histData);
      oscLinesRef.current.set("macd", macdLine);
      oscLinesRef.current.set("macdSignal", sigLine);
      oscLinesRef.current.set("macdHist", hist);
    }
    chart.timeScale().fitContent();
  }, [oscillator, indicators]);

  return (
    <div className="space-y-2">
      <div ref={mainRef} className="w-full h-[420px]" data-testid="chart-main" />
      {oscillator && (
        <div ref={oscRef} className="w-full h-[140px]" data-testid="chart-osc" />
      )}
    </div>
  );
}
