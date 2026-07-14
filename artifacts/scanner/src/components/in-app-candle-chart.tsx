/**
 * InAppCandleChart — fully in-house candle chart built on TradingView's
 * open-source `lightweight-charts` library. Renders OHLC candles, EMA 20
 * and EMA 50 overlays, and a volume histogram. Data comes from our own
 * /api/stocks/:symbol/history endpoint (live Kite/Yahoo OHLC), so it works
 * for every NSE/BSE symbol — no third-party widget restrictions.
 */
import { useEffect, useMemo, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

interface Candle {
  t: string | Date;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface Props {
  candles: Candle[];
  ema20Series?: (number | null)[] | null;
  ema50Series?: (number | null)[] | null;
  height?: number;
}

function toTime(t: string | Date): UTCTimestamp {
  const d = t instanceof Date ? t : new Date(t);
  return Math.floor(d.getTime() / 1000) as UTCTimestamp;
}

export function InAppCandleChart({ candles, ema20Series, ema50Series, height = 460 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const ema20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  const candleData = useMemo(
    () =>
      candles.map(c => ({
        time: toTime(c.t),
        open: c.o,
        high: c.h,
        low: c.l,
        close: c.c,
      })),
    [candles],
  );

  const volumeData = useMemo(
    () =>
      candles.map(c => ({
        time: toTime(c.t),
        value: c.v,
        color: c.c >= c.o ? "rgba(0, 162, 91, 0.45)" : "rgba(235, 59, 0, 0.45)",
      })),
    [candles],
  );

  const ema20Data = useMemo(() => {
    if (!ema20Series) return [];
    const out: { time: Time; value: number }[] = [];
    for (let i = 0; i < candles.length; i++) {
      const v = ema20Series[i];
      if (v != null && Number.isFinite(v)) {
        out.push({ time: toTime(candles[i]!.t), value: v });
      }
    }
    return out;
  }, [candles, ema20Series]);

  const ema50Data = useMemo(() => {
    if (!ema50Series) return [];
    const out: { time: Time; value: number }[] = [];
    for (let i = 0; i < candles.length; i++) {
      const v = ema50Series[i];
      if (v != null && Number.isFinite(v)) {
        out.push({ time: toTime(candles[i]!.t), value: v });
      }
    }
    return out;
  }, [candles, ema50Series]);

  // Create chart once.
  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;

    const chart = createChart(host, {
      width: host.clientWidth,
      height,
      layout: {
        background: { color: "transparent" },
        textColor: "rgba(220, 220, 230, 0.85)",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
      },
      grid: {
        vertLines: { color: "rgba(120, 120, 140, 0.08)" },
        horzLines: { color: "rgba(120, 120, 140, 0.08)" },
      },
      rightPriceScale: {
        borderColor: "rgba(120, 120, 140, 0.25)",
        scaleMargins: { top: 0.06, bottom: 0.22 },
      },
      timeScale: {
        borderColor: "rgba(120, 120, 140, 0.25)",
        timeVisible: false,
        secondsVisible: false,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      autoSize: false,
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#00A25B",
      downColor: "#EB3B00",
      borderUpColor: "#00A25B",
      borderDownColor: "#EB3B00",
      wickUpColor: "#00A25B",
      wickDownColor: "#EB3B00",
      priceLineWidth: 1,
    });
    candleSeriesRef.current = candleSeries;

    const ema20 = chart.addSeries(LineSeries, {
      color: "#F2C94C",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    ema20Ref.current = ema20;

    const ema50 = chart.addSeries(LineSeries, {
      color: "#BB6BD9",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    ema50Ref.current = ema50;

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });
    volumeRef.current = volume;

    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        chart.applyOptions({ width: w, height });
      }
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      ema20Ref.current = null;
      ema50Ref.current = null;
      volumeRef.current = null;
    };
  }, [height]);

  // Update data when inputs change.
  useEffect(() => {
    candleSeriesRef.current?.setData(candleData);
    volumeRef.current?.setData(volumeData);
    ema20Ref.current?.setData(ema20Data);
    ema50Ref.current?.setData(ema50Data);
    chartRef.current?.timeScale().fitContent();
  }, [candleData, volumeData, ema20Data, ema50Data]);

  return (
    <div className="relative w-full">
      <div ref={containerRef} style={{ width: "100%", height }} />
      <div className="absolute top-2 left-3 flex items-center gap-3 text-[10px] font-mono uppercase tracking-wider text-muted-foreground pointer-events-none">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm" style={{ background: "#F2C94C" }} />
          EMA 20
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm" style={{ background: "#BB6BD9" }} />
          EMA 50
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-muted-foreground/40" />
          Volume
        </span>
      </div>
    </div>
  );
}
