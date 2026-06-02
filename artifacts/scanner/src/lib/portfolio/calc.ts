/**
 * Portfolio Analyser — pure financial calculations.
 *
 * Formula correctness is enforced here and covered by calc.test.ts:
 *   Invested      = Qty * Rate
 *   Current       = Qty * CMP
 *   Day Change    = Qty * (CMP - PrevClose)
 *   Day % Change  = (CMP - PrevClose) / PrevClose * 100
 *   Total Return  = Current - Invested        (NOT Invested - Current)
 *   Total Return% = Total Return / Invested * 100
 *   Weight %      = Current / TotalCurrent * 100
 */
import type {
  RawHolding,
  LiveMetrics,
  HoldingMetrics,
  PortfolioSummary,
  SectorAllocation,
  CashFlow,
} from "./types";

export function investedValue(qty: number, rate: number): number {
  return qty * rate;
}

export function currentValue(qty: number, cmp: number | null): number | null {
  return cmp == null ? null : qty * cmp;
}

export function dayChange(qty: number, cmp: number | null, prevClose: number | null): number | null {
  if (cmp == null || prevClose == null) return null;
  return qty * (cmp - prevClose);
}

export function dayChangePct(cmp: number | null, prevClose: number | null): number | null {
  if (cmp == null || prevClose == null || prevClose === 0) return null;
  return ((cmp - prevClose) / prevClose) * 100;
}

export function totalReturn(current: number | null, invested: number): number | null {
  return current == null ? null : current - invested;
}

export function totalReturnPct(ret: number | null, invested: number): number | null {
  if (ret == null || invested === 0) return null;
  return (ret / invested) * 100;
}

export function weightPct(current: number | null, totalCurrent: number | null): number | null {
  if (current == null || totalCurrent == null || totalCurrent === 0) return null;
  return (current / totalCurrent) * 100;
}

/** Per-holding metrics. `totalCurrent` is required for weight; pass null to defer. */
export function computeHoldingMetrics(
  raw: RawHolding,
  live: LiveMetrics,
  totalCurrent: number | null,
): HoldingMetrics {
  const invested = investedValue(raw.qty, raw.rate);
  const current = currentValue(raw.qty, live.cmp);
  const ret = totalReturn(current, invested);
  return {
    invested,
    currentValue: current,
    dayChange: dayChange(raw.qty, live.cmp, live.previousClose),
    dayChangePct: dayChangePct(live.cmp, live.previousClose),
    totalReturn: ret,
    totalReturnPct: totalReturnPct(ret, invested),
    weightPct: weightPct(current, totalCurrent),
  };
}

/** Sum of current values across holdings; null only when EVERY holding lacks a CMP. */
export function totalCurrentValue(
  rows: { raw: RawHolding; live: LiveMetrics }[],
): number | null {
  let sum = 0;
  let any = false;
  for (const { raw, live } of rows) {
    const cv = currentValue(raw.qty, live.cmp);
    if (cv != null) {
      sum += cv;
      any = true;
    }
  }
  return any ? sum : null;
}

export function computeSummary(
  rows: { raw: RawHolding; live: LiveMetrics }[],
): PortfolioSummary {
  let totalInvested = 0;
  let totalCurrent = 0;
  let totalDayChange = 0;
  let totalPrevValue = 0;
  let anyCurrent = false;
  let anyDay = false;
  let winners = 0;
  let losers = 0;

  const cashflows: CashFlow[] = [];
  let xirrExcluded = 0;
  const now = new Date();

  for (const { raw, live } of rows) {
    const invested = investedValue(raw.qty, raw.rate);
    totalInvested += invested;

    const cv = currentValue(raw.qty, live.cmp);
    if (cv != null) {
      totalCurrent += cv;
      anyCurrent = true;
      const ret = cv - invested;
      if (ret > 0) winners += 1;
      else if (ret < 0) losers += 1;
    }

    const dc = dayChange(raw.qty, live.cmp, live.previousClose);
    if (dc != null && live.previousClose != null) {
      totalDayChange += dc;
      totalPrevValue += raw.qty * live.previousClose;
      anyDay = true;
    }

    // XIRR cashflows: -invested at purchase date, +current value today.
    const d = raw.purchaseDate ? new Date(raw.purchaseDate) : null;
    if (d && !Number.isNaN(d.getTime()) && cv != null) {
      cashflows.push({ date: d, amount: -invested });
      cashflows.push({ date: now, amount: cv });
    } else {
      xirrExcluded += 1;
    }
  }

  const ret = anyCurrent ? totalCurrent - totalInvested : null;
  return {
    totalInvested,
    totalCurrent: anyCurrent ? totalCurrent : null,
    totalReturn: ret,
    totalReturnPct: ret != null && totalInvested !== 0 ? (ret / totalInvested) * 100 : null,
    dayChange: anyDay ? totalDayChange : null,
    dayChangePct: anyDay && totalPrevValue !== 0 ? (totalDayChange / totalPrevValue) * 100 : null,
    holdingsCount: rows.length,
    winners,
    losers,
    approxXirr: xirr(cashflows),
    xirrExcluded,
  };
}

export function computeSectorAllocation(
  rows: { raw: RawHolding; live: LiveMetrics }[],
): SectorAllocation[] {
  const totalCurrent = totalCurrentValue(rows);
  const map = new Map<string, { invested: number; current: number; anyCurrent: boolean }>();
  for (const { raw, live } of rows) {
    const sector = (live.sector || raw.sector || "Unknown").trim() || "Unknown";
    const entry = map.get(sector) ?? { invested: 0, current: 0, anyCurrent: false };
    entry.invested += investedValue(raw.qty, raw.rate);
    const cv = currentValue(raw.qty, live.cmp);
    if (cv != null) {
      entry.current += cv;
      entry.anyCurrent = true;
    }
    map.set(sector, entry);
  }
  return Array.from(map.entries())
    .map(([sector, e]) => ({
      sector,
      invested: e.invested,
      currentValue: e.anyCurrent ? e.current : null,
      pnl: e.anyCurrent ? e.current - e.invested : null,
      weightPct: e.anyCurrent ? weightPct(e.current, totalCurrent) : null,
    }))
    .sort((a, b) => (b.currentValue ?? b.invested) - (a.currentValue ?? a.invested));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Sum of discounted cash flows at a given annual rate. */
function xnpv(rate: number, cfs: CashFlow[], t0: number): number {
  let sum = 0;
  for (const cf of cfs) {
    const years = (cf.date.getTime() - t0) / (365 * DAY_MS);
    sum += cf.amount / Math.pow(1 + rate, years);
  }
  return sum;
}

function dxnpv(rate: number, cfs: CashFlow[], t0: number): number {
  let sum = 0;
  for (const cf of cfs) {
    const years = (cf.date.getTime() - t0) / (365 * DAY_MS);
    sum += (-years * cf.amount) / Math.pow(1 + rate, years + 1);
  }
  return sum;
}

/**
 * Annualised XIRR over dated cash flows (Newton-Raphson, bisection fallback).
 * Returns a fraction (0.18 = 18%). Null when there is no sign change, fewer
 * than two flows, or the solver fails to converge — never a fabricated number.
 */
export function xirr(cfs: CashFlow[]): number | null {
  if (cfs.length < 2) return null;
  const hasPos = cfs.some(c => c.amount > 0);
  const hasNeg = cfs.some(c => c.amount < 0);
  if (!hasPos || !hasNeg) return null;

  const t0 = Math.min(...cfs.map(c => c.date.getTime()));

  // Newton-Raphson.
  let rate = 0.1;
  for (let i = 0; i < 100; i += 1) {
    const f = xnpv(rate, cfs, t0);
    const df = dxnpv(rate, cfs, t0);
    if (!Number.isFinite(f) || !Number.isFinite(df) || df === 0) break;
    const next = rate - f / df;
    if (!Number.isFinite(next) || next <= -0.9999) break;
    if (Math.abs(next - rate) < 1e-7) return clampRate(next);
    rate = next;
  }

  // Bisection fallback over a wide bracket.
  let lo = -0.9999;
  let hi = 100;
  let flo = xnpv(lo, cfs, t0);
  let fhi = xnpv(hi, cfs, t0);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    const fmid = xnpv(mid, cfs, t0);
    if (!Number.isFinite(fmid)) return null;
    if (Math.abs(fmid) < 1e-6 || (hi - lo) / 2 < 1e-7) return clampRate(mid);
    if (flo * fmid < 0) {
      hi = mid;
      fhi = fmid;
    } else {
      lo = mid;
      flo = fmid;
    }
  }
  return clampRate((lo + hi) / 2);
}

function clampRate(r: number): number | null {
  return Number.isFinite(r) ? r : null;
}
