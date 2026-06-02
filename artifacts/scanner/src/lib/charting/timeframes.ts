/**
 * Timeframe + segment configuration for the read-only Charting tab.
 * Pure data + helpers — no React, no network — so it is trivially testable
 * and shared between the page and the chart component.
 */
import type {
  ChartCandlesResponseTimeframe,
  ChartInstrumentSegment,
} from "@workspace/api-client-react";

export type Timeframe = ChartCandlesResponseTimeframe;
export type Segment = ChartInstrumentSegment;

export interface TimeframeMeta {
  value: Timeframe;
  label: string;
  /** Intraday timeframes get session-anchored VWAP; higher TFs do not. */
  intraday: boolean;
}

export const TIMEFRAMES: TimeframeMeta[] = [
  { value: "1m", label: "1m", intraday: true },
  { value: "3m", label: "3m", intraday: true },
  { value: "5m", label: "5m", intraday: true },
  { value: "15m", label: "15m", intraday: true },
  { value: "30m", label: "30m", intraday: true },
  { value: "1h", label: "1H", intraday: true },
  { value: "1D", label: "1D", intraday: false },
  { value: "1W", label: "1W", intraday: false },
  { value: "1M", label: "1M", intraday: false },
];

export const DEFAULT_TIMEFRAME: Timeframe = "15m";

export function isIntraday(tf: Timeframe): boolean {
  return TIMEFRAMES.find(t => t.value === tf)?.intraday ?? false;
}

export const SEGMENTS: { value: Segment; label: string }[] = [
  { value: "index", label: "Indices" },
  { value: "equity", label: "Equity" },
  { value: "global", label: "Global" },
];

/** True when the timeframe's time axis should show intraday HH:MM labels. */
export function timeframeShowsTime(tf: Timeframe): boolean {
  return isIntraday(tf);
}
