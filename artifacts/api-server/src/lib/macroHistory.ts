import { fetchChartRaw } from "./marketData/analyticsYahoo";
import { logger } from "./logger";

export interface MacroPoint {
  t: string;
  c: number;
}

export interface MacroSparkline {
  symbol: string;
  label: string;
  invert: boolean;
  points: MacroPoint[];
}

export interface MacroHistorySnapshot {
  series: MacroSparkline[];
  generatedAt: string;
}

const SERIES: { symbol: string; label: string; invert: boolean }[] = [
  { symbol: "^INDIAVIX", label: "India VIX", invert: true },
  { symbol: "^VIX",      label: "VIX",       invert: true },
  { symbol: "DX-Y.NYB",  label: "DXY",       invert: true },
  { symbol: "CL=F",      label: "Crude",     invert: false },
];

const TTL_MS = 5 * 60 * 1000;
let cache: { ts: number; snap: MacroHistorySnapshot } | null = null;

async function fetchOne(symbol: string, label: string, invert: boolean): Promise<MacroSparkline | null> {
  const r = await fetchChartRaw(symbol, "5d", "1d");
  if (!r) return null;
  const points: MacroPoint[] = [];
  for (let i = 0; i < r.timestamps.length; i++) {
    const close = r.close[i];
    const ts = r.timestamps[i];
    if (typeof close !== "number" || !Number.isFinite(close) || close <= 0) continue;
    if (typeof ts !== "number" || !Number.isFinite(ts)) continue;
    points.push({ t: new Date(ts * 1000).toISOString(), c: Number(close.toFixed(4)) });
  }
  if (points.length < 2) return null;
  return { symbol, label, invert, points };
}

export async function getMacroHistory(opts: { force?: boolean } = {}): Promise<MacroHistorySnapshot> {
  if (!opts.force && cache && Date.now() - cache.ts < TTL_MS) return cache.snap;
  const settled = await Promise.all(SERIES.map(s => fetchOne(s.symbol, s.label, s.invert).catch((err) => {
    logger.warn({ err: (err as Error).message, symbol: s.symbol }, "macroHistory: fetch failed");
    return null;
  })));
  const series = settled.filter((s): s is MacroSparkline => s != null);
  const snap: MacroHistorySnapshot = { series, generatedAt: new Date().toISOString() };
  cache = { ts: Date.now(), snap };
  return snap;
}
