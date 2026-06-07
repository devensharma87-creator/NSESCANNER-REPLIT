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
  createSeriesMarkers,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  CrosshairMode,
  LineStyle,
  TickMarkType,
  type IChartApi,
  type ISeriesApi,
  type ISeriesPrimitive,
  type IPrimitivePaneView,
  type IPrimitivePaneRenderer,
  type SeriesAttachedParameter,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type {
  EmaPeriod,
  FvgZone,
  SweepMarker,
  FibLevel,
  FixedVolumeProfile,
  KeyLevel,
} from "@/lib/charting/indicators";
import {
  FNO_VWAP_COLOR,
  type FnoSmcResult,
  type SmcZone,
} from "@/lib/charting/fnoSmc";

// All candle timestamps are epoch-UTC seconds. The instruments are Indian /
// global exchange data, so axis + crosshair labels are rendered in IST
// (Asia/Kolkata) rather than the browser's locale or UTC.
const IST = "Asia/Kolkata";
const istTime = new Intl.DateTimeFormat("en-GB", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: false });
const istDay = new Intl.DateTimeFormat("en-GB", { timeZone: IST, day: "2-digit", month: "short" });
const istMonth = new Intl.DateTimeFormat("en-GB", { timeZone: IST, month: "short" });
const istYear = new Intl.DateTimeFormat("en-GB", { timeZone: IST, year: "numeric" });
const istDayYear = new Intl.DateTimeFormat("en-GB", { timeZone: IST, day: "2-digit", month: "short", year: "numeric" });
const istFull = new Intl.DateTimeFormat("en-GB", {
  timeZone: IST,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

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
  /** Cumulative Volume Delta (candle-direction proxy); rendered in its own sub-pane. */
  cvdSeries?: (number | null)[] | null;
  /** Point-of-Control price level, drawn as a horizontal line. null → not drawn. */
  pocPrice?: number | null;
  /** Recent Fair-Value-Gap zones, drawn as top/bottom price lines. */
  fvgZones?: FvgZone[];
  /** Liquidity-sweep events, drawn as arrows on the main series. */
  sweepMarkers?: SweepMarker[];
  /** Auto-Fibonacci retracement + extension levels, drawn as dashed price lines. */
  fibLevels?: FibLevel[] | null;
  /** Fixed Volume Profile (POC/VAH/VAL + per-price histogram). null → not drawn. */
  volumeProfile?: FixedVolumeProfile | null;
  showVolumeProfile?: boolean;
  /** Ranked Support/Resistance levels with source tags, drawn as labeled lines. */
  keyLevels?: KeyLevel[] | null;
  showKeyLevels?: boolean;
  /** All-in-One F&O Trend + SMC suite result (EMAs, VWAP bands, zones, structure, signals). */
  suite?: FnoSmcResult | null;
  showVolume: boolean;
  showRsi: boolean;
  showCvd: boolean;
  showTime: boolean;
  height?: number;
}

const POC_COLOR = "#FFB347";
const FVG_BULLISH = "rgba(38, 166, 154, 0.9)";
const FVG_BEARISH = "rgba(239, 83, 80, 0.9)";
const CVD_COLOR = "#6C9EBF";

// Fixed Volume Profile histogram colors.
const VP_POC_FILL = "rgba(255, 179, 71, 0.55)";
const VP_VA_FILL = "rgba(108, 158, 191, 0.42)";
const VP_OUT_FILL = "rgba(108, 158, 191, 0.20)";
const VP_VAH_VAL_COLOR = "rgba(108, 158, 191, 0.85)";

// Support / Resistance + Fibonacci line colors.
const SUPPORT_COLOR = "#26A69A";
const RESISTANCE_COLOR = "#EF5350";
const FIB_RETRACE_COLOR = "rgba(212, 175, 55, 0.75)";
const FIB_EXT_COLOR = "rgba(155, 138, 251, 0.75)";

type MainSeries = ISeriesApi<"Candlestick"> | ISeriesApi<"Line">;
type DrawTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];

/**
 * Custom lightweight-charts v5 primitive that paints a Fixed Volume Profile as a
 * left-anchored horizontal histogram behind the price series. POC bars are
 * highlighted; bars inside the value area are brighter than those outside.
 */
class VolumeProfileRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly _source: VolumeProfilePrimitive) {}

  draw(target: DrawTarget): void {
    const series = this._source.series();
    const vp = this._source.profile();
    if (!series || !vp || vp.maxVol <= 0) return;
    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const maxBarW = scope.bitmapSize.width * 0.26;
      for (const row of vp.rows) {
        if (row.vol <= 0) continue;
        const yHi = series.priceToCoordinate(row.priceHi);
        const yLo = series.priceToCoordinate(row.priceLo);
        if (yHi == null || yLo == null) continue;
        const top = Math.min(yHi, yLo) * scope.verticalPixelRatio;
        const bottom = Math.max(yHi, yLo) * scope.verticalPixelRatio;
        const h = Math.max(1, bottom - top - 1);
        const w = (row.vol / vp.maxVol) * maxBarW;
        if (w <= 0) continue;
        const isPoc = row.priceLo <= vp.poc && vp.poc < row.priceHi;
        const inVa = row.mid >= vp.val && row.mid <= vp.vah;
        ctx.fillStyle = isPoc ? VP_POC_FILL : inVa ? VP_VA_FILL : VP_OUT_FILL;
        ctx.fillRect(0, top, w, h);
      }
    });
  }
}

class VolumeProfilePaneView implements IPrimitivePaneView {
  constructor(private readonly _source: VolumeProfilePrimitive) {}
  zOrder(): "bottom" {
    return "bottom";
  }
  renderer(): IPrimitivePaneRenderer {
    return new VolumeProfileRenderer(this._source);
  }
}

class VolumeProfilePrimitive implements ISeriesPrimitive<Time> {
  private _chart: IChartApi | null = null;
  private _series: MainSeries | null = null;
  private readonly _paneView: VolumeProfilePaneView;

  constructor(private readonly _vp: FixedVolumeProfile) {
    this._paneView = new VolumeProfilePaneView(this);
  }
  attached(param: SeriesAttachedParameter<Time>): void {
    this._chart = param.chart;
    this._series = param.series as MainSeries;
  }
  detached(): void {
    this._chart = null;
    this._series = null;
  }
  paneViews(): readonly IPrimitivePaneView[] {
    return [this._paneView];
  }
  profile(): FixedVolumeProfile {
    return this._vp;
  }
  series(): MainSeries | null {
    return this._series;
  }
  chart(): IChartApi | null {
    return this._chart;
  }
}

// Suite (F&O Trend + SMC) zone fills. Boxes are translucent so candles read
// through them; supply/demand carry a faint border, FVGs are borderless.
function zoneStyle(type: SmcZone["type"]): { fill: string; border: string | null; label: string | null } {
  switch (type) {
    case "demand":
      return { fill: "rgba(0, 230, 118, 0.12)", border: "rgba(0, 230, 118, 0.55)", label: "#00C853" };
    case "supply":
      return { fill: "rgba(255, 82, 82, 0.12)", border: "rgba(255, 82, 82, 0.55)", label: "#D50000" };
    case "fvgBull":
      return { fill: "rgba(38, 166, 154, 0.16)", border: null, label: null };
    case "fvgBear":
      return { fill: "rgba(239, 83, 80, 0.16)", border: null, label: null };
  }
}

/**
 * Custom v5 primitive that paints the suite's supply/demand + FVG zones as
 * translucent rectangles extending from the zone's origin bar to the right edge
 * of the chart. Drawn at the bottom z-order so price always sits on top.
 */
class ZoneBoxRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly _source: ZoneBoxPrimitive) {}

  draw(target: DrawTarget): void {
    const chart = this._source.chart();
    const series = this._source.series();
    if (!chart || !series) return;
    const ts = chart.timeScale();
    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const rightEdge = scope.bitmapSize.width;
      for (const z of this._source.zones()) {
        const yT = series.priceToCoordinate(z.top);
        const yB = series.priceToCoordinate(z.bottom);
        if (yT == null || yB == null) continue;
        const xc = ts.timeToCoordinate(toTime(z.time));
        const x1 = Math.max(0, (xc == null ? 0 : xc) * hr);
        const top = Math.min(yT, yB) * vr;
        const bottom = Math.max(yT, yB) * vr;
        const h = Math.max(1, bottom - top);
        const w = rightEdge - x1;
        if (w <= 0) continue;
        const s = zoneStyle(z.type);
        ctx.fillStyle = s.fill;
        ctx.fillRect(x1, top, w, h);
        if (s.border) {
          ctx.strokeStyle = s.border;
          ctx.lineWidth = 1;
          ctx.strokeRect(x1, top, w, h);
        }
        if (z.label && s.label) {
          ctx.fillStyle = s.label;
          ctx.font = `${10 * vr}px ui-monospace, monospace`;
          ctx.textBaseline = "top";
          ctx.fillText(z.label, x1 + 4 * hr, top + 2 * vr);
        }
      }
    });
  }
}

class ZoneBoxPaneView implements IPrimitivePaneView {
  constructor(private readonly _source: ZoneBoxPrimitive) {}
  zOrder(): "bottom" {
    return "bottom";
  }
  renderer(): IPrimitivePaneRenderer {
    return new ZoneBoxRenderer(this._source);
  }
}

class ZoneBoxPrimitive implements ISeriesPrimitive<Time> {
  private _chart: IChartApi | null = null;
  private _series: MainSeries | null = null;
  private readonly _paneView: ZoneBoxPaneView;

  constructor(private readonly _zones: SmcZone[]) {
    this._paneView = new ZoneBoxPaneView(this);
  }
  attached(param: SeriesAttachedParameter<Time>): void {
    this._chart = param.chart;
    this._series = param.series as MainSeries;
  }
  detached(): void {
    this._chart = null;
    this._series = null;
  }
  paneViews(): readonly IPrimitivePaneView[] {
    return [this._paneView];
  }
  zones(): SmcZone[] {
    return this._zones;
  }
  series(): MainSeries | null {
    return this._series;
  }
  chart(): IChartApi | null {
    return this._chart;
  }
}

const SMC_BOS_COLOR = "#2962FF";
const SMC_CHOCH_COLOR = "#FF6D00";
const SIGNAL_LONG_COLOR = "#00C853";
const SIGNAL_SHORT_COLOR = "#D50000";

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
  cvdSeries,
  pocPrice,
  fvgZones,
  sweepMarkers,
  fibLevels,
  volumeProfile,
  showVolumeProfile,
  keyLevels,
  showKeyLevels,
  suite,
  showVolume,
  showRsi,
  showCvd,
  showTime,
  height = 480,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const legendRef = useRef<HTMLDivElement | null>(null);

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
      localization: {
        timeFormatter: (t: UTCTimestamp) => {
          const ms = (t as number) * 1000;
          return showTime ? istFull.format(ms) : istDayYear.format(ms);
        },
      },
      timeScale: {
        borderColor: "rgba(120, 120, 140, 0.25)",
        timeVisible: showTime,
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: 8,
        tickMarkFormatter: (t: UTCTimestamp, tickMarkType: TickMarkType) => {
          const ms = (t as number) * 1000;
          switch (tickMarkType) {
            case TickMarkType.Year:
              return istYear.format(ms);
            case TickMarkType.Month:
              return istMonth.format(ms);
            case TickMarkType.DayOfMonth:
              return istDay.format(ms);
            case TickMarkType.Time:
            case TickMarkType.TimeWithSeconds:
              return istTime.format(ms);
            default:
              return istDay.format(ms);
          }
        },
      },
      crosshair: { mode: CrosshairMode.Normal },
      autoSize: false,
    });
    chartRef.current = chart;

    // ── Main series (candles or line) ──────────────────────────────
    let mainSeries: ISeriesApi<"Candlestick"> | ISeriesApi<"Line">;
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
      mainSeries = s;
    } else {
      const s = chart.addSeries(LineSeries, {
        color: "#4FC3F7",
        lineWidth: 2,
        priceLineVisible: false,
      });
      s.setData(candles.map(c => ({ time: toTime(c.t), value: c.c })));
      mainSeries = s;
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
        lineStyle: LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
      });
      line.setData(alignedLine(candles, vwapSeries));
    }

    // ── POC line (volume-profile point of control) ─────────────────
    if (pocPrice != null && Number.isFinite(pocPrice)) {
      mainSeries.createPriceLine({
        price: pocPrice,
        color: POC_COLOR,
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: "POC",
      });
    }

    // ── FVG zones (top/bottom boundary price lines) ────────────────
    if (fvgZones && fvgZones.length > 0) {
      for (const z of fvgZones) {
        const color = z.type === "bullish" ? FVG_BULLISH : FVG_BEARISH;
        mainSeries.createPriceLine({
          price: z.top,
          color,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: `FVG ${z.type === "bullish" ? "▲" : "▼"}`,
        });
        mainSeries.createPriceLine({
          price: z.bottom,
          color,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: false,
        });
      }
    }

    // ── Liquidity-sweep markers (plain arrows, no text — declutter) ─
    if (sweepMarkers && sweepMarkers.length > 0) {
      const markers: SeriesMarker<Time>[] = sweepMarkers.map(s => ({
        time: toTime(s.time),
        position: s.type === "HIGH_SWEEP" ? "aboveBar" : "belowBar",
        shape: s.type === "HIGH_SWEEP" ? "arrowDown" : "arrowUp",
        color: s.type === "HIGH_SWEEP" ? "#FF8A65" : "#81C784",
      }));
      createSeriesMarkers(mainSeries, markers);
    }

    // ── Fixed Volume Profile (histogram primitive + POC/VAH/VAL) ───
    if (showVolumeProfile && volumeProfile && volumeProfile.maxVol > 0) {
      mainSeries.attachPrimitive(new VolumeProfilePrimitive(volumeProfile));
      mainSeries.createPriceLine({
        price: volumeProfile.poc,
        color: POC_COLOR,
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: "POC",
      });
      mainSeries.createPriceLine({
        price: volumeProfile.vah,
        color: VP_VAH_VAL_COLOR,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "VAH",
      });
      mainSeries.createPriceLine({
        price: volumeProfile.val,
        color: VP_VAH_VAL_COLOR,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "VAL",
      });
    }

    // ── Auto-Fibonacci (solid; gold retracement, purple extension) ──
    // Retracements are SOLID so they read clearly on indices (where the dashed
    // version was easy to lose among the gridlines); the 0.5 / 0.618 "golden
    // pocket" is emphasized with a thicker line. Extensions stay dotted as they
    // sit outside the swing range.
    if (fibLevels && fibLevels.length > 0) {
      for (const f of fibLevels) {
        const isExt = f.kind === "extension";
        const inPocket = !isExt && (f.ratio === 0.5 || f.ratio === 0.618);
        mainSeries.createPriceLine({
          price: f.price,
          color: isExt ? FIB_EXT_COLOR : FIB_RETRACE_COLOR,
          lineWidth: inPocket ? 2 : 1,
          lineStyle: isExt ? LineStyle.Dotted : LineStyle.Solid,
          axisLabelVisible: true,
          title: `Fib ${f.ratio}`,
        });
      }
    }

    // ── Support / Resistance (solid, labels show backing sources) ──
    if (showKeyLevels && keyLevels && keyLevels.length > 0) {
      for (const k of keyLevels) {
        mainSeries.createPriceLine({
          price: k.price,
          color: k.kind === "support" ? SUPPORT_COLOR : RESISTANCE_COLOR,
          lineWidth: 2,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: `${k.label} · ${k.sources.join(" + ")}`,
        });
      }
    }

    // ── F&O Trend + SMC suite ──────────────────────────────────────
    // Zones (S/D + FVG) as a behind-price primitive; EMA + VWAP bands as
    // overlay lines; BOS/CHoCH + signal arrows as markers; the latest
    // signal's entry/SL/target as price lines. All math is computed upstream.
    if (suite) {
      if (suite.zones.length > 0) {
        mainSeries.attachPrimitive(new ZoneBoxPrimitive(suite.zones));
      }

      for (const e of suite.emas) {
        const line = chart.addSeries(LineSeries, {
          color: e.color,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: false,
          title: `EMA${e.period}`,
        });
        line.setData(alignedLine(candles, e.values));
      }

      if (suite.vwap) {
        const mid = chart.addSeries(LineSeries, {
          color: FNO_VWAP_COLOR,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: false,
          title: "VWAP",
        });
        mid.setData(alignedLine(candles, suite.vwap.vwap));
        for (const band of [suite.vwap.upper, suite.vwap.lower]) {
          if (!band.some(v => v != null)) continue;
          const b = chart.addSeries(LineSeries, {
            color: FNO_VWAP_COLOR,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          });
          b.setData(alignedLine(candles, band));
        }
      }

      const suiteMarkers: SeriesMarker<Time>[] = [];
      for (const ev of suite.structure) {
        suiteMarkers.push({
          time: toTime(ev.time),
          position: ev.dir === "up" ? "aboveBar" : "belowBar",
          shape: ev.dir === "up" ? "arrowUp" : "arrowDown",
          color: ev.kind === "BOS" ? SMC_BOS_COLOR : SMC_CHOCH_COLOR,
          text: ev.kind,
        });
      }
      for (const sig of suite.signals) {
        suiteMarkers.push({
          time: toTime(sig.time),
          position: sig.dir === "long" ? "belowBar" : "aboveBar",
          shape: sig.dir === "long" ? "arrowUp" : "arrowDown",
          color: sig.dir === "long" ? SIGNAL_LONG_COLOR : SIGNAL_SHORT_COLOR,
          text: sig.dir === "long" ? "LONG" : "SHORT",
        });
      }
      if (suiteMarkers.length > 0) {
        suiteMarkers.sort((a, b) => (a.time as number) - (b.time as number));
        createSeriesMarkers(mainSeries, suiteMarkers);
      }

      if (suite.latestSignal) {
        const s = suite.latestSignal;
        mainSeries.createPriceLine({
          price: s.entry,
          color: "#90CAF9",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `Entry ${s.dir === "long" ? "▲" : "▼"}`,
        });
        mainSeries.createPriceLine({
          price: s.sl,
          color: RESISTANCE_COLOR,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: "SL",
        });
        mainSeries.createPriceLine({
          price: s.tgt,
          color: SUPPORT_COLOR,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: `TGT ${s.rr}R`,
        });
      }
    }

    // ── Sub-panes (RSI, then CVD), assigned indices in order ───────
    let nextPane = 1;

    if (showRsi && rsiSeries) {
      const paneIndex = nextPane++;
      const rsi: ISeriesApi<"Line"> = chart.addSeries(
        LineSeries,
        {
          color: "#9B8AFB",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
        },
        paneIndex,
      );
      rsi.setData(alignedLine(candles, rsiSeries));
      rsi.createPriceLine({ price: 70, color: "rgba(235,87,87,0.5)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "70" });
      rsi.createPriceLine({ price: 30, color: "rgba(0,162,91,0.5)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "30" });
      const panes = chart.panes();
      if (panes.length > paneIndex) panes[paneIndex]!.setHeight(Math.round(height * 0.28));
    }

    // ── CVD sub-pane (candle-direction proxy) ──────────────────────
    if (showCvd && cvdSeries && cvdSeries.some(v => v != null)) {
      const paneIndex = nextPane++;
      const cvd: ISeriesApi<"Line"> = chart.addSeries(
        LineSeries,
        {
          color: CVD_COLOR,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
        },
        paneIndex,
      );
      cvd.setData(alignedLine(candles, cvdSeries));
      cvd.createPriceLine({ price: 0, color: "rgba(120,120,140,0.5)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false });
      const panes = chart.panes();
      if (panes.length > paneIndex) panes[paneIndex]!.setHeight(Math.round(height * 0.26));
    }

    chart.timeScale().fitContent();

    // ── Crosshair-following OHLC legend (data-rich, pro-terminal style) ──
    // Reads straight from the supplied candle data, so it works for both
    // candle and line chart types and never fabricates a value.
    {
      const idxByTime = new Map<number, number>();
      candles.forEach((c, i) => idxByTime.set(Math.floor(c.t), i));
      const fmt = (n: number) =>
        n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const renderLegend = (t: number | null) => {
        const el = legendRef.current;
        if (!el) return;
        let i = candles.length - 1;
        if (t != null && idxByTime.has(t)) i = idxByTime.get(t)!;
        const c = candles[i];
        if (!c) {
          el.innerHTML = "";
          return;
        }
        const prev = i > 0 ? candles[i - 1] : undefined;
        const base = prev ? prev.c : c.o;
        const chg = c.c - base;
        const pct = base ? (chg / base) * 100 : 0;
        const up = chg >= 0;
        const col = up ? "#00A25B" : "#EB3B00";
        const sign = up ? "+" : "";
        const lbl = (k: string, v: number) =>
          `<span style="opacity:.55">${k}</span>\u00A0${fmt(v)}`;
        el.innerHTML =
          `${lbl("O", c.o)}\u00A0\u00A0${lbl("H", c.h)}\u00A0\u00A0${lbl("L", c.l)}\u00A0\u00A0${lbl("C", c.c)}` +
          `\u00A0\u00A0<span style="color:${col}">${sign}${fmt(chg)} (${sign}${pct.toFixed(2)}%)</span>`;
      };
      renderLegend(null);
      chart.subscribeCrosshairMove(param => {
        const t = typeof param.time === "number" ? (param.time as number) : null;
        renderLegend(t);
      });
    }

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
  }, [candles, chartType, emaKey, hasVwap, showVolume, showRsi, showCvd, showTime, height, emaSeries, vwapSeries, rsiSeries, cvdSeries, pocPrice, fvgZones, sweepMarkers, fibLevels, volumeProfile, showVolumeProfile, keyLevels, showKeyLevels, suite]);

  return (
    <div style={{ position: "relative", width: "100%", height }}>
      <div
        ref={legendRef}
        className="pointer-events-none absolute left-2 top-1.5 z-10 font-mono text-[11px] tracking-tight text-foreground/90"
        data-testid="chart-ohlc-legend"
      />
      <div ref={containerRef} style={{ width: "100%", height }} />
    </div>
  );
}
