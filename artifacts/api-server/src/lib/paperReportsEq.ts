/**
 * Equity (delivery) paper-trading P&L reports.
 *
 * Reads exclusively from `paper_trade_eq` (status = CLOSED). Every
 * aggregate — calendar pills, monthly + yearly totals, per-trade
 * charges — is computed from real persisted trade rows. Nothing is
 * mocked; if there are no closed trades for a date the day simply
 * has no pill.
 *
 * Charge schedule mirrors the Zerodha/Console "Equity-Delivery"
 * tariff for FY 2025-26 — the user is benchmarking paper P&L against
 * what the same trade would actually cost at a discount broker, so
 * we apply the full set: STT + NSE EQ txn + SEBI + GST + stamp duty
 * + DP charges per scrip per sell.
 */
import { db, paperTradeEqTable } from "@workspace/db";
import { and, eq, gte, lt } from "drizzle-orm";
import type { PaperTradeEqRow } from "@workspace/db";

function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : parseFloat(v);
}

function requireNum(v: string | number | null | undefined, field: string, id: string): number {
  if (v == null) {
    throw new Error(`paper_trade_eq ${id}: required field '${field}' is null on a CLOSED row`);
  }
  const n = typeof v === "number" ? v : parseFloat(v);
  if (!Number.isFinite(n)) {
    throw new Error(`paper_trade_eq ${id}: required field '${field}' is not a finite number`);
  }
  return n;
}

/**
 * NSE Equity Delivery charges, FY 2025-26 (Zerodha-equivalent schedule):
 *
 *   - Brokerage: ₹0 (delivery is free at most discount brokers)
 *   - STT: 0.1% on BOTH buy and sell turnover
 *   - Exchange transaction charges (NSE EQ): 0.00297% on both sides
 *   - SEBI charges: ₹10 per crore on both sides
 *   - GST: 18% on (brokerage + transaction charges + SEBI charges)
 *   - Stamp duty: 0.015% on BUY side only
 *   - DP charges: ₹15.93 (= ₹13.5 + 18% GST) per scrip per sell — flat
 *     per sell-side scrip (not per share, not per turnover).
 *
 * `distinctSellScrips` is normally 1 for a single round-trip trade and
 * is exposed as a parameter so monthly/yearly aggregates can pass the
 * actual unique-symbol count — DP is per-scrip, not per-trade, so two
 * sells of the same scrip on the same day would still count as 1 DP
 * charge in real life. For the per-trade detail row we always pass 1.
 */
export interface ChargesBreakdown {
  brokerage: number;
  stt: number;
  transactionCharges: number;
  sebiCharges: number;
  gst: number;
  stampDuty: number;
  dpCharges: number;
  total: number;
}

export function computeEquityCharges(
  buyTurnover: number,
  sellTurnover: number,
  distinctSellScrips: number,
): ChargesBreakdown {
  const totalTurnover = buyTurnover + sellTurnover;
  const brokerage = 0;
  const stt = 0.001 * (buyTurnover + sellTurnover);
  const transactionCharges = 0.0000297 * totalTurnover;
  const sebiCharges = (10 / 1e7) * totalTurnover;
  const gst = 0.18 * (brokerage + transactionCharges + sebiCharges);
  const stampDuty = 0.00015 * buyTurnover;
  const dpCharges = 15.93 * Math.max(0, Math.floor(distinctSellScrips));
  const total =
    brokerage + stt + transactionCharges + sebiCharges + gst + stampDuty + dpCharges;
  return {
    brokerage,
    stt,
    transactionCharges,
    sebiCharges,
    gst,
    stampDuty,
    dpCharges,
    total,
  };
}

/** Per-trade detail row exposed in the trade-detail table. */
export interface EquityTradeDetailRow {
  id: string;
  signalDate: string;
  exitedAt: string;
  symbol: string;
  name: string;
  exchange: string;
  qty: number;
  entryPrice: number;
  exitPrice: number;
  stopPrice: number;
  target1Price: number;
  target2Price: number;
  capitalDeployed: number;
  realizedPnl: number;
  charges: number;
  netPnl: number;
  /** Planned R = (entry - stop) per share, always positive for a long. */
  plannedRiskPerShare: number;
  /** Achieved (exit - entry) per share. */
  achievedPerShare: number;
  /** Achieved / |planned| — positive on profit, negative on loss. */
  rMultiple: number;
  exitReason:
    | "TARGET2_HIT"
    | "STOPPED"
    | "TRAIL_STOP_HIT"
    | "TIME_STOP"
    | "SIGNAL_FLIP"
    | "MANUAL_OVERRIDE";
  /** Calendar days the trade was held (rounded). */
  daysHeld: number;
  /** True when the stop was trailed up to T1 before the exit. */
  trailedToT1: boolean;
}

function istDateOf(d: Date): string {
  return new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function rowToDetail(r: PaperTradeEqRow): EquityTradeDetailRow {
  if (r.status !== "CLOSED") {
    throw new Error(`paper_trade_eq ${r.id}: report row must have status=CLOSED, got ${r.status}`);
  }
  if (!r.exitedAt) {
    throw new Error(`paper_trade_eq ${r.id}: CLOSED row missing exitedAt`);
  }
  if (!r.exitReason) {
    throw new Error(`paper_trade_eq ${r.id}: CLOSED row missing exitReason`);
  }
  const entry = requireNum(r.entryPrice, "entryPrice", r.id);
  const exit = requireNum(r.exitPrice, "exitPrice", r.id);
  const stop = requireNum(r.stopPrice, "stopPrice", r.id);
  const realized = requireNum(r.realizedPnl, "realizedPnl", r.id);
  const buyTurnover = entry * r.qty;
  const sellTurnover = exit * r.qty;
  const charges = computeEquityCharges(buyTurnover, sellTurnover, 1).total;
  const plannedRiskPerShare = Math.abs(entry - stop);
  const achievedPerShare = exit - entry;
  const rMultiple = plannedRiskPerShare > 0 ? achievedPerShare / plannedRiskPerShare : 0;
  // Days held = IST CALENDAR-day difference (exitedAt − openedAt). Use
  // calendar dates rather than (exit-open)/86400000 rounding because
  // a position opened at 09:30 IST and closed at 15:25 the same day
  // is "0 days held", and closed the next morning at 09:35 IST is
  // "1 day held" — the prior Math.round() flipped these arbitrarily
  // around the half-day boundary.
  const istDate = (d: Date) =>
    new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const openKey = istDate(r.openedAt);
  const exitKey = istDate(r.exitedAt);
  const [oy, om, od] = openKey.split("-").map(Number);
  const [ey, em, ed] = exitKey.split("-").map(Number);
  const openMs = Date.UTC(oy!, om! - 1, od!);
  const exitMs = Date.UTC(ey!, em! - 1, ed!);
  const daysHeld = Math.max(0, Math.floor((exitMs - openMs) / (24 * 60 * 60 * 1000)));
  return {
    id: r.id,
    signalDate: r.signalDate,
    exitedAt: r.exitedAt.toISOString(),
    symbol: r.symbol,
    name: r.name,
    exchange: r.exchange,
    qty: r.qty,
    entryPrice: entry,
    exitPrice: exit,
    stopPrice: stop,
    target1Price: requireNum(r.target1Price, "target1Price", r.id),
    target2Price: requireNum(r.target2Price, "target2Price", r.id),
    capitalDeployed: requireNum(r.capitalDeployed, "capitalDeployed", r.id),
    realizedPnl: realized,
    charges,
    netPnl: realized - charges,
    plannedRiskPerShare,
    achievedPerShare,
    rMultiple,
    exitReason: r.exitReason as EquityTradeDetailRow["exitReason"],
    daysHeld,
    trailedToT1: (r.trailedToT1 ?? 0) > 0,
  };
}

interface DayBucket {
  date: string;
  realizedPnl: number;
  netPnl: number;
  charges: number;
  tradeCount: number;
  wins: number;
  losses: number;
}

interface MonthBucket {
  month: string; // YYYY-MM
  realizedPnl: number;
  netPnl: number;
  charges: number;
  tradeCount: number;
  wins: number;
  losses: number;
}

export interface ReportTotals {
  realizedPnl: number;
  netPnl: number;
  charges: number;
  tradeCount: number;
  wins: number;
  losses: number;
  winRatePct: number;
  avgWin: number;
  avgLoss: number;
  bestTrade: number;
  worstTrade: number;
  avgRMultiple: number;
  profitFactor: number;
}

function emptyTotals(): ReportTotals {
  return {
    realizedPnl: 0,
    netPnl: 0,
    charges: 0,
    tradeCount: 0,
    wins: 0,
    losses: 0,
    winRatePct: 0,
    avgWin: 0,
    avgLoss: 0,
    bestTrade: 0,
    worstTrade: 0,
    avgRMultiple: 0,
    profitFactor: 0,
  };
}

function aggregateTotals(rows: EquityTradeDetailRow[]): ReportTotals {
  if (rows.length === 0) return emptyTotals();
  let realized = 0,
    charges = 0,
    netSum = 0;
  let wins = 0,
    losses = 0;
  let winSum = 0,
    lossSum = 0;
  let best = -Infinity,
    worst = Infinity;
  let rSum = 0;
  for (const r of rows) {
    realized += r.realizedPnl;
    charges += r.charges;
    netSum += r.netPnl;
    if (r.netPnl > 0) {
      wins++;
      winSum += r.netPnl;
    } else if (r.netPnl < 0) {
      losses++;
      lossSum += Math.abs(r.netPnl);
    }
    if (r.netPnl > best) best = r.netPnl;
    if (r.netPnl < worst) worst = r.netPnl;
    rSum += r.rMultiple;
  }
  return {
    realizedPnl: realized,
    netPnl: netSum,
    charges,
    tradeCount: rows.length,
    wins,
    losses,
    winRatePct: rows.length === 0 ? 0 : (wins / rows.length) * 100,
    avgWin: wins > 0 ? winSum / wins : 0,
    avgLoss: losses > 0 ? lossSum / losses : 0,
    bestTrade: best === -Infinity ? 0 : best,
    worstTrade: worst === Infinity ? 0 : worst,
    avgRMultiple: rSum / rows.length,
    profitFactor: lossSum > 0 ? winSum / lossSum : winSum > 0 ? Infinity : 0,
  };
}

function monthBoundsIst(month: string): {
  from: string;
  to: string;
  fromUtc: Date;
  toUtc: Date;
} {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) {
    throw new Error("Invalid month format, expected YYYY-MM");
  }
  const y = Number(m[1]);
  const mm = Number(m[2]);
  if (mm < 1 || mm > 12) {
    throw new Error("Invalid month, expected 01-12");
  }
  const lastDay = new Date(Date.UTC(y, mm, 0)).getUTCDate();
  const from = `${y}-${String(mm).padStart(2, "0")}-01`;
  const to = `${y}-${String(mm).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const fromUtc = new Date(Date.UTC(y, mm - 1, 1) - 5.5 * 60 * 60 * 1000);
  const toUtc = new Date(Date.UTC(y, mm, 1) - 5.5 * 60 * 60 * 1000);
  return { from, to, fromUtc, toUtc };
}

async function fetchClosedTradesByExit(
  fromUtc: Date,
  toUtc: Date,
): Promise<EquityTradeDetailRow[]> {
  const rows = await db
    .select()
    .from(paperTradeEqTable)
    .where(
      and(
        eq(paperTradeEqTable.status, "CLOSED"),
        gte(paperTradeEqTable.exitedAt, fromUtc),
        lt(paperTradeEqTable.exitedAt, toUtc),
      ),
    )
    .orderBy(paperTradeEqTable.exitedAt);
  return rows.map(rowToDetail);
}

export interface MonthlyReport {
  month: string;
  from: string;
  to: string;
  totals: ReportTotals;
  days: DayBucket[];
  trades: EquityTradeDetailRow[];
  generatedAt: string;
}

export async function getMonthlyReport(month: string): Promise<MonthlyReport> {
  const { from, to, fromUtc, toUtc } = monthBoundsIst(month);
  const trades = await fetchClosedTradesByExit(fromUtc, toUtc);
  const byDay = new Map<string, DayBucket>();
  for (const t of trades) {
    const dateKey = istDateOf(new Date(t.exitedAt));
    const b =
      byDay.get(dateKey) ??
      ({
        date: dateKey,
        realizedPnl: 0,
        netPnl: 0,
        charges: 0,
        tradeCount: 0,
        wins: 0,
        losses: 0,
      } as DayBucket);
    b.realizedPnl += t.realizedPnl;
    b.netPnl += t.netPnl;
    b.charges += t.charges;
    b.tradeCount++;
    if (t.netPnl > 0) b.wins++;
    else if (t.netPnl < 0) b.losses++;
    byDay.set(dateKey, b);
  }
  const days = Array.from(byDay.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  return {
    month,
    from,
    to,
    totals: aggregateTotals(trades),
    days,
    trades,
    generatedAt: new Date().toISOString(),
  };
}

export interface YearlyReport {
  fy: string;
  from: string;
  to: string;
  totals: ReportTotals;
  months: MonthBucket[];
  generatedAt: string;
}

function fyBoundsIst(fy: string): {
  from: string;
  to: string;
  startYear: number;
  fromUtc: Date;
  toUtc: Date;
} {
  const m = fy.match(/^(\d{4})-(\d{4})$/);
  if (!m || Number(m[2]) !== Number(m[1]) + 1) {
    throw new Error("Invalid FY format, expected YYYY-YYYY (consecutive years)");
  }
  const startYear = Number(m[1]);
  const endYear = Number(m[2]);
  const fromUtc = new Date(Date.UTC(startYear, 3, 1) - 5.5 * 60 * 60 * 1000);
  const toUtc = new Date(Date.UTC(endYear, 3, 1) - 5.5 * 60 * 60 * 1000);
  return {
    from: `${startYear}-04-01`,
    to: `${endYear}-03-31`,
    startYear,
    fromUtc,
    toUtc,
  };
}

export async function getYearlyReport(fy: string): Promise<YearlyReport> {
  const { from, to, startYear, fromUtc, toUtc } = fyBoundsIst(fy);
  const trades = await fetchClosedTradesByExit(fromUtc, toUtc);
  const byMonth = new Map<string, MonthBucket>();
  for (let i = 0; i < 12; i++) {
    const monthIdx = (3 + i) % 12;
    const yr = startYear + (i >= 9 ? 1 : 0);
    const key = `${yr}-${String(monthIdx + 1).padStart(2, "0")}`;
    byMonth.set(key, {
      month: key,
      realizedPnl: 0,
      netPnl: 0,
      charges: 0,
      tradeCount: 0,
      wins: 0,
      losses: 0,
    });
  }
  for (const t of trades) {
    const monthKey = istDateOf(new Date(t.exitedAt)).slice(0, 7);
    const b = byMonth.get(monthKey);
    if (!b) {
      throw new Error(
        `paper_trade_eq ${t.id}: exit IST month ${monthKey} is outside FY ${fy} despite the SQL filter`,
      );
    }
    b.realizedPnl += t.realizedPnl;
    b.netPnl += t.netPnl;
    b.charges += t.charges;
    b.tradeCount++;
    if (t.netPnl > 0) b.wins++;
    else if (t.netPnl < 0) b.losses++;
  }
  const months = Array.from(byMonth.values());
  return {
    fy,
    from,
    to,
    totals: aggregateTotals(trades),
    months,
    generatedAt: new Date().toISOString(),
  };
}
