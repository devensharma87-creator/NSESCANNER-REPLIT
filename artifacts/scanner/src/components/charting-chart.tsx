/**
 * ChartingChart — the rendering surface for the read-only Charting tab.
 *
 * Built on TradingView's open-source `lightweight-charts` v5. Renders a
 * candlestick OR line main series, an optional volume histogram, a
 * multi-EMA ribbon, an optional VWAP overlay, and an optional RSI sub-pane.
 *
 * It is purely presentational: all indicator math is computed by the caller
 * (lib/charting/indicators.ts) and passed in as index-aligned series. No
 * network, no trading logic.
 */
import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { EmaPeriod } from "@/lib/charting/indicators";

export interface RenderCandle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number | null;
}

export const EMA_COLORS: Record<EmaPeriod, string> = {
  11: "#56CCF2",
  20: "#F2C94C",
  50: "#BB6BD9",
  100: "#2D9CDB",
  200: "#EB5757",
};

export const VWAP_COLOR = "#F2994A";

interface Props {
  candles: RenderCandle[];
  chartType: "candles" | "line";
  emaSeries: Partial<Record<EmaPeriod, (number | null)[]>>;
  vwapSeries?: (number | null)[] | null;
  rsiSeries?: (number | null)[] | null;
  showVolume: boolean;
  showRsi: boolean;
  showTime: boolean;
  height?: number;
}

function toTime(tSec: number): UTCTimestamp {
  return Math.floor(tSec) as UTCTimestamp;
}

function alignedLine(
  candles: RenderCandle[],
  series: (number | null)[] | null | undefined,
): { time: UTCTimestamp; value: number }[] {
  if (!series) return [];
  const out: { time: UTCTimestamp; value: number }[] = [];
  for (let i = 0; i < candles.length; i++) {
    const v = series[i];
    if (v != null && Number.isFinite(v)) {
      out.push({ time: toTime(candles[i]!.t), value: v });
    }
  }
  return out;
}

export function ChartingChart({
  candles,
  chartType,
  emaSeries,
  vwapSeries,
  rsiSeries,
  showVolume,
  showRsi,
  showTime,
  height = 480,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  // Structural rebuild: anything that changes the set/shape of series.
  const emaKey = (Object.keys(emaSeries) as unknown as EmaPeriod[])
    .filter(p => emaSeries[p])
    .sort((a, b) => a - b)
    .join(",");
  const hasVwap = !!vwapSeries;

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
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(120, 120, 140, 0.08)" },
        horzLines: { color: "rgba(120, 120, 140, 0.08)" },
      },
      rightPriceScale: {
        borderColor: "rgba(120, 120, 140, 0.25)",
        scaleMargins: { top: 0.08, bottom: showVolume ? 0.24 : 0.08 },
      },
      timeScale: {
        borderColor: "rgba(120, 120, 140, 0.25)",
        timeVisible: showTime,
        secondsVisible: false,
      },
      crosshair: { mode: CrosshairMode.Normal },
      autoSize: false,
    });
    chartRef.current = chart;

    // ── Main series (candles or line) ──────────────────────────────
    if (chartType === "candles") {
      const s = chart.addSeries(CandlestickSeries, {
        upColor: "#00A25B",
        downColor: "#EB3B00",
        borderUpColor: "#00A25B",
        borderDownColor: "#EB3B00",
        wickUpColor: "#00A25B",
        wickDownColor: "#EB3B00",
        priceLineWidth: 1,
      });
      s.setData(
        candles.map(c => ({ time: toTime(c.t), open: c.o, high: c.h, low: c.l, close: c.c })),
      );
    } else {
      const s = chart.addSeries(LineSeries, {
        color: "#4FC3F7",
        lineWidth: 2,
        priceLineVisible: false,
      });
      s.setData(candles.map(c => ({ time: toTime(c.t), value: c.c })));
    }

    // ── Volume ─────────────────────────────────────────────────────
    if (showVolume) {
      const vol = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "vol",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      vol.setData(
        candles
          .filter(c => c.v != null)
          .map(c => ({
            time: toTime(c.t),
            value: c.v as number,
            color: c.c >= c.o ? "rgba(0, 162, 91, 0.45)" : "rgba(235, 59, 0, 0.45)",
          })),
      );
    }

    // ── EMA ribbon ─────────────────────────────────────────────────
    for (const p of Object.keys(emaSeries) as unknown as EmaPeriod[]) {
      const series = emaSeries[p];
      if (!series) continue;
      const line = chart.addSeries(LineSeries, {
        color: EMA_COLORS[p],
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      line.setData(alignedLine(candles, series));
    }

    // ── VWAP overlay ───────────────────────────────────────────────
    if (vwapSeries) {
      const line = chart.addSeries(LineSeries, {
        color: VWAP_COLOR,
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      line.setData(alignedLine(candles, vwapSeries));
    }

    // ── RSI sub-pane (paneIndex 1) ─────────────────────────────────
    if (showRsi && rsiSeries) {
      const rsi: ISeriesApi<"Line"> = chart.addSeries(
        LineSeries,
        {
          color: "#9B8AFB",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
        },
        1,
      );
      rsi.setData(alignedLine(candles, rsiSeries));
      rsi.createPriceLine({ price: 70, color: "rgba(235,87,87,0.5)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "70" });
      rsi.createPriceLine({ price: 30, color: "rgba(0,162,91,0.5)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "30" });
      const panes = chart.panes();
      if (panes.length > 1) panes[1]!.setHeight(Math.round(height * 0.28));
    }

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        chart.applyOptions({ width: Math.floor(entry.contentRect.width), height });
      }
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, chartType, emaKey, hasVwap, showVolume, showRsi, showTime, height, emaSeries, vwapSeries, rsiSeries]);

  return <div ref={containerRef} style={{ width: "100%", height }} />;
}
