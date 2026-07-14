/**
 * Portfolio Analyser — allocation views (pure, tested).
 *
 * Several lenses on the same book: by sector, by stock weight, by market-cap
 * bucket, by P&L contribution, and a winner/loser split. Each view degrades to
 * an explicit "unavailable" message when the underlying datum (e.g. reliable
 * market-cap) is missing — never a fabricated slice.
 */
import type { RawHolding, LiveMetrics, HoldingMetrics } from "./types";
import { investedValue } from "./calc";

export interface AllocRow {
  raw: RawHolding;
  live: LiveMetrics;
  metrics: HoldingMetrics;
}

export type AllocationMode = "sector" | "stock" | "marketcap" | "pnl" | "winloss";

export interface AllocationSlice {
  label: string;
  /** Primary magnitude (₹) for the slice, null when not applicable. */
  value: number | null;
  /** Share of the relevant total (%), null when not computable. */
  weightPct: number | null;
  /** Optional sub-text (e.g. holding count). */
  meta?: string;
  /** Sign hint for colouring (P&L views). */
  sign?: "pos" | "neg" | "neutral";
}

export interface AllocationView {
  mode: AllocationMode;
  slices: AllocationSlice[];
  /** Non-null when the whole view cannot be computed from available data. */
  unavailable: string | null;
}

/** Market-cap buckets (₹ crore). Configurable; documented in the methodology. */
export const MARKET_CAP_BUCKETS = {
  LARGE_MIN_CR: 20000,
  MID_MIN_CR: 5000,
} as const;

function currentOf(r: AllocRow): number | null {
  return r.metrics.currentValue;
}

function totalCurrent(rows: AllocRow[]): number | null {
  let sum = 0;
  let any = false;
  for (const r of rows) {
    const cv = currentOf(r);
    if (cv != null) {
      sum += cv;
      any = true;
    }
  }
  return any ? sum : null;
}

function bySector(rows: AllocRow[]): AllocationView {
  const total = totalCurrent(rows);
  const map = new Map<string, { value: number; invested: number; any: boolean; count: number }>();
  for (const r of rows) {
    const sector = (r.live.sector || r.raw.sector || "Unknown").trim() || "Unknown";
    const e = map.get(sector) ?? { value: 0, invested: 0, any: false, count: 0 };
    e.invested += investedValue(r.raw.qty, r.raw.rate);
    e.count += 1;
    const cv = currentOf(r);
    if (cv != null) {
      e.value += cv;
      e.any = true;
    }
    map.set(sector, e);
  }
  const slices = Array.from(map.entries())
    .map(([label, e]) => ({
      label,
      value: e.any ? e.value : e.invested,
      weightPct: e.any && total != null && total > 0 ? (e.value / total) * 100 : null,
      meta: `${e.count} holding${e.count === 1 ? "" : "s"}`,
    }))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return { mode: "sector", slices, unavailable: null };
}

function byStock(rows: AllocRow[]): AllocationView {
  const total = totalCurrent(rows);
  const slices = rows
    .map(r => {
      const cv = currentOf(r);
      return {
        label: r.raw.symbol,
        value: cv,
        weightPct: cv != null && total != null && total > 0 ? (cv / total) * 100 : null,
        meta: r.raw.name && r.raw.name !== r.raw.symbol ? r.raw.name : undefined,
      };
    })
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return { mode: "stock", slices, unavailable: null };
}

function byMarketCap(rows: AllocRow[]): AllocationView {
  const total = totalCurrent(rows.filter(r => r.live.marketCapCr != null));
  if (total == null) {
    return {
      mode: "marketcap",
      slices: [],
      unavailable: "Market-cap allocation unavailable — no reliable market-cap data for these holdings.",
    };
  }
  const buckets = new Map<string, { value: number; count: number }>([
    ["Large-cap", { value: 0, count: 0 }],
    ["Mid-cap", { value: 0, count: 0 }],
    ["Small-cap", { value: 0, count: 0 }],
  ]);
  let covered = 0;
  let uncovered = 0;
  for (const r of rows) {
    const cv = currentOf(r);
    if (r.live.marketCapCr == null || cv == null) {
      uncovered += 1;
      continue;
    }
    const key =
      r.live.marketCapCr >= MARKET_CAP_BUCKETS.LARGE_MIN_CR
        ? "Large-cap"
        : r.live.marketCapCr >= MARKET_CAP_BUCKETS.MID_MIN_CR
          ? "Mid-cap"
          : "Small-cap";
    const e = buckets.get(key)!;
    e.value += cv;
    e.count += 1;
    covered += 1;
  }
  void covered;
  const slices: AllocationSlice[] = Array.from(buckets.entries())
    .filter(([, e]) => e.count > 0)
    .map(([label, e]) => ({
      label,
      value: e.value,
      weightPct: total > 0 ? (e.value / total) * 100 : null,
      meta: `${e.count} holding${e.count === 1 ? "" : "s"}`,
    }));
  return {
    mode: "marketcap",
    slices,
    unavailable:
      uncovered > 0
        ? `${uncovered} holding(s) excluded — market-cap unavailable for them.`
        : null,
  };
}

function byPnl(rows: AllocRow[]): AllocationView {
  let totalAbs = 0;
  const raw = rows
    .map(r => ({ symbol: r.raw.symbol, pnl: r.metrics.totalReturn }))
    .filter((x): x is { symbol: string; pnl: number } => x.pnl != null);
  if (raw.length === 0) {
    return { mode: "pnl", slices: [], unavailable: "P&L contribution unavailable — no live values resolved." };
  }
  for (const x of raw) totalAbs += Math.abs(x.pnl);
  const slices = raw
    .map(x => ({
      label: x.symbol,
      value: x.pnl,
      weightPct: totalAbs > 0 ? (Math.abs(x.pnl) / totalAbs) * 100 : null,
      sign: x.pnl > 0 ? ("pos" as const) : x.pnl < 0 ? ("neg" as const) : ("neutral" as const),
    }))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return { mode: "pnl", slices, unavailable: null };
}

function byWinLoss(rows: AllocRow[]): AllocationView {
  let winVal = 0;
  let loseVal = 0;
  let flatVal = 0;
  let winCount = 0;
  let loseCount = 0;
  let flatCount = 0;
  let any = false;
  for (const r of rows) {
    const ret = r.metrics.totalReturn;
    const cv = currentOf(r);
    if (ret == null || cv == null) continue;
    any = true;
    if (ret > 0) {
      winVal += cv;
      winCount += 1;
    } else if (ret < 0) {
      loseVal += cv;
      loseCount += 1;
    } else {
      flatVal += cv;
      flatCount += 1;
    }
  }
  if (!any) {
    return { mode: "winloss", slices: [], unavailable: "Winner/loser split unavailable — no live values resolved." };
  }
  const total = winVal + loseVal + flatVal;
  const slices: AllocationSlice[] = [
    { label: "Winners", value: winVal, weightPct: total > 0 ? (winVal / total) * 100 : null, meta: `${winCount} holding${winCount === 1 ? "" : "s"}`, sign: "pos" },
    { label: "Losers", value: loseVal, weightPct: total > 0 ? (loseVal / total) * 100 : null, meta: `${loseCount} holding${loseCount === 1 ? "" : "s"}`, sign: "neg" },
  ];
  if (flatCount > 0) {
    slices.push({ label: "Flat", value: flatVal, weightPct: total > 0 ? (flatVal / total) * 100 : null, meta: `${flatCount} holding${flatCount === 1 ? "" : "s"}`, sign: "neutral" });
  }
  return { mode: "winloss", slices, unavailable: null };
}

export function computeAllocation(rows: AllocRow[], mode: AllocationMode): AllocationView {
  if (rows.length === 0) {
    return { mode, slices: [], unavailable: "No holdings loaded." };
  }
  switch (mode) {
    case "sector":
      return bySector(rows);
    case "stock":
      return byStock(rows);
    case "marketcap":
      return byMarketCap(rows);
    case "pnl":
      return byPnl(rows);
    case "winloss":
      return byWinLoss(rows);
  }
}
