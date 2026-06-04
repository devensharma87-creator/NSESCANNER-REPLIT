/**
 * F&O paper-trading P&L reports.
 *
 * Reads exclusively from `paper_trade_fo` (status = CLOSED). Every
 * aggregate — calendar pills, monthly/yearly totals, charges — is
 * computed from real persisted trade rows. Nothing is mocked or filled
 * with placeholder data; if there are no closed trades for a date the
 * day simply has no pill.
 *
 * "Taxes & Charges" mirrors the Console-style cards in the user's
 * screenshots and is computed using the standard public NSE/exchange
 * fee schedule for option buying / selling. These formulas are
 * deterministic from the trade premium turnover and are applied
 * symmetrically to every closed paper trade so the user sees the same
 * after-charges P&L they would see at a discount broker.
 */
import { db, paperTradeFoTable } from "@workspace/db";
import { and, eq, gte, lt } from "drizzle-orm";
import type { PaperTradeFoRow } from "@workspace/db";
import {
  loadSpotLifecycleByKey,
  lifecycleKeyOf,
  type FnoSpotLifecycle,
} from "./fnoSpotLifecycle";

function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : parseFloat(v);
}

/**
 * Strict numeric coercion for fields a CLOSED paper trade MUST have.
 * Throws instead of silently substituting 0 — surfaces data integrity
 * problems in the trade ledger rather than masking them as a free
 * winning/losing trade in the report.
 */
function requireNum(v: string | number | null | undefined, field: string, id: string): number {
  if (v == null) {
    throw new Error(`paper_trade_fo ${id}: required field '${field}' is null on a CLOSED row`);
  }
  const n = typeof v === "number" ? v : parseFloat(v);
  if (!Number.isFinite(n)) {
    throw new Error(`paper_trade_fo ${id}: required field '${field}' is not a finite number`);
  }
  return n;
}

/**
 * Standard discount-broker option F&O charges (Zerodha-equivalent
 * schedule, effective FY 2025-26 — STT was raised to 0.1% on options
 * sell-side in the Union Budget 2024 with effect from 1-Oct-2024):
 *
 *   - Brokerage: ₹20 flat per executed order. A round-trip = 2 orders.
 *   - STT: 0.1% on sell-side option premium turnover.
 *   - Exchange transaction charges: 0.03503% on total option premium turnover (NSE).
 *   - SEBI charges: ₹10 per crore of total turnover.
 *   - GST: 18% on (brokerage + transaction charges + SEBI charges).
 *   - Stamp duty: 0.003% on buy-side option premium turnover.
 *
 * All values returned in ₹.
 */
export interface ChargesBreakdown {
  brokerage: number;
  stt: number;
  transactionCharges: number;
  sebiCharges: number;
  gst: number;
  stampDuty: number;
  total: number;
}

export function computeFOCharges(
  buyTurnover: number,
  sellTurnover: number,
): ChargesBreakdown {
  const totalTurnover = buyTurnover + sellTurnover;
  const brokerage = 40; // 2 orders × ₹20
  const stt = 0.001 * sellTurnover; // 0.1% of sell-side option premium (post 1-Oct-2024)
  const transactionCharges = 0.0003503 * totalTurnover;
  const sebiCharges = (10 / 1e7) * totalTurnover;
  const gst = 0.18 * (brokerage + transactionCharges + sebiCharges);
  const stampDuty = 0.00003 * buyTurnover;
  const total =
    brokerage + stt + transactionCharges + sebiCharges + gst + stampDuty;
  return {
    brokerage,
    stt,
    transactionCharges,
    sebiCharges,
    gst,
    stampDuty,
    total,
  };
}

/** Per-trade detail row exposed in the trade-detail table. */
export interface TradeDetailRow {
  id: string;
  signalDate: string;
  exitedAt: string;
  indexSymbol: string;
  indexName: string;
  setupKey: string;
  direction: "BULLISH" | "BEARISH";
  optionType: "CALL" | "PUT";
  strike: number;
  lots: number;
  lotSize: number;
  entryPremium: number;
  exitPremium: number;
  stopPremium: number;
  target1Premium: number;
  target2Premium: number;
  capitalDeployed: number;
  realizedPnl: number;
  charges: number;
  netPnl: number;
  /** Planned R = (entry - stop) per share. */
  plannedRiskPerShare: number;
  /** Achieved (exit - entry) per share, signed in trade direction. */
  achievedPerShare: number;
  /** Achieved / |planned| — positive on profit, negative on loss. */
  rMultiple: number;
  exitReason:
    | "TARGET1_HIT"
    | "TARGET2_HIT"
    | "STOPPED"
    | "EXPIRED"
    | "MANUAL_OVERRIDE"
    | "TIME_EXIT_1520";
  durationSec: number;
  /** Read-only: highest unrealized P&L observed (peak); null when not recorded. */
  maxRunup: number | null;
  /** Read-only: lowest unrealized P&L observed (≤ 0); null when not recorded. */
  maxDrawdown: number | null;
  /** Read-only spot lifecycle joined from option_signal_history; null when absent. */
  spotLifecycle: FnoSpotLifecycle | null;
}

/**
 * IST date string YYYY-MM-DD from any UTC Date. We add 5h30m and slice
 * the ISO so DST and locale settings can never affect bucketing.
 */
function istDateOf(d: Date): string {
  return new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function rowToDetail(
  r: PaperTradeFoRow,
  spotLifecycle?: FnoSpotLifecycle | null,
): TradeDetailRow {
  // CLOSED rows are written by closePaperTradeForSignal as a single
  // transaction with all six exit fields populated. If we ever read a
  // CLOSED row missing any of them, that is a ledger integrity bug —
  // fail the request loudly rather than fabricating a "free" trade.
  if (r.status !== "CLOSED") {
    throw new Error(`paper_trade_fo ${r.id}: report row must have status=CLOSED, got ${r.status}`);
  }
  if (!r.exitedAt) {
    throw new Error(`paper_trade_fo ${r.id}: CLOSED row missing exitedAt`);
  }
  if (!r.exitReason) {
    throw new Error(`paper_trade_fo ${r.id}: CLOSED row missing exitReason`);
  }
  const entry = requireNum(r.entryPremium, "entryPremium", r.id);
  const exit = requireNum(r.exitPremium, "exitPremium", r.id);
  const stop = requireNum(r.stopPremium, "stopPremium", r.id);
  const realized = requireNum(r.realizedPnl, "realizedPnl", r.id);
  const lots = r.lots;
  const lotSize = r.lotSize;
  const buyTurnover = entry * lots * lotSize;
  const sellTurnover = exit * lots * lotSize;
  const charges = computeFOCharges(buyTurnover, sellTurnover).total;
  const plannedRiskPerShare = Math.abs(entry - stop);
  // Option buying P&L is (exit - entry) per share regardless of CALL/PUT
  // because direction is already encoded in the choice of CALL vs PUT.
  const achievedPerShare = exit - entry;
  const rMultiple =
    plannedRiskPerShare > 0 ? achievedPerShare / plannedRiskPerShare : 0;
  const openedAtMs = r.openedAt.getTime();
  const exitedAtMs = r.exitedAt.getTime();
  return {
    id: r.id,
    signalDate: r.signalDate,
    exitedAt: r.exitedAt.toISOString(),
    indexSymbol: r.indexSymbol,
    indexName: r.indexName,
    setupKey: r.setupKey,
    direction: r.direction as "BULLISH" | "BEARISH",
    optionType: r.optionType as "CALL" | "PUT",
    strike: requireNum(r.strike, "strike", r.id),
    lots,
    lotSize,
    entryPremium: entry,
    exitPremium: exit,
    stopPremium: stop,
    target1Premium: requireNum(r.target1Premium, "target1Premium", r.id),
    target2Premium: requireNum(r.target2Premium, "target2Premium", r.id),
    capitalDeployed: requireNum(r.capitalDeployed, "capitalDeployed", r.id),
    realizedPnl: realized,
    charges,
    netPnl: realized - charges,
    plannedRiskPerShare,
    achievedPerShare,
    rMultiple,
    exitReason: r.exitReason as TradeDetailRow["exitReason"],
    durationSec: Math.max(0, Math.round((exitedAtMs - openedAtMs) / 1000)),
    maxRunup: r.maxRunup == null ? null : requireNum(r.maxRunup, "maxRunup", r.id),
    maxDrawdown:
      r.maxDrawdown == null ? null : requireNum(r.maxDrawdown, "maxDrawdown", r.id),
    spotLifecycle: spotLifecycle ?? null,
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
  /** Average R multiple actually achieved across all trades. */
  avgRMultiple: number;
  profitFactor: number;
  /** Expectancy = (winRate × avgWin) - (lossRate × avgLoss). Per-trade expected value. */
  expectancy: number;
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
    expectancy: 0,
  };
}

function aggregateTotals(rows: TradeDetailRow[]): ReportTotals {
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
    expectancy:
      rows.length > 0
        ? ((wins / rows.length) * (wins > 0 ? winSum / wins : 0)) -
          ((losses / rows.length) * (losses > 0 ? lossSum / losses : 0))
        : 0,
  };
}

/**
 * IST calendar bounds for a YYYY-MM, expressed as the absolute UTC
 * instants representing IST-midnight on the first day of `month` and
 * IST-midnight on the first day of the next month. The upper bound is
 * exclusive so the SQL filter never double-counts the last day.
 */
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
  // IST midnight = UTC 18:30 of the previous calendar day. Easier to
  // express as `IST-midnight = UTC = (Y-M-D 00:00) - 5h30m`.
  const fromUtc = new Date(Date.UTC(y, mm - 1, 1) - 5.5 * 60 * 60 * 1000);
  const toUtc = new Date(Date.UTC(y, mm, 1) - 5.5 * 60 * 60 * 1000);
  return { from, to, fromUtc, toUtc };
}

/**
 * Fetch all CLOSED trades whose `exitedAt` falls inside `[fromUtc, toUtc)`.
 *
 * Bucketing the report by exit time (the moment realized P&L is
 * recognised) is the same convention every retail console uses, and it
 * is what the user sees in the screenshots they shared. The lifecycle
 * hook today closes nearly all trades on the same IST day they opened,
 * so signalDate and the IST date of exitedAt usually agree — but for
 * any boundary case (manual late close, EOD sweep that runs after IST
 * midnight) the report attributes P&L to the day the cash actually hit
 * the paper account, not the day the signal was generated.
 */
async function fetchClosedTradesByExit(
  fromUtc: Date,
  toUtc: Date,
): Promise<TradeDetailRow[]> {
  const rows = await db
    .select()
    .from(paperTradeFoTable)
    .where(
      and(
        eq(paperTradeFoTable.status, "CLOSED"),
        gte(paperTradeFoTable.exitedAt, fromUtc),
        lt(paperTradeFoTable.exitedAt, toUtc),
      ),
    )
    .orderBy(paperTradeFoTable.exitedAt);
  const lifecycles = await loadSpotLifecycleByKey(rows);
  return rows.map((r) => rowToDetail(r, lifecycles.get(lifecycleKeyOf(r))));
}

export interface MonthlyReport {
  month: string;
  from: string;
  to: string;
  totals: ReportTotals;
  days: DayBucket[];
  trades: TradeDetailRow[];
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
  fy: string; // "YYYY-YYYY"
  from: string;
  to: string;
  totals: ReportTotals;
  months: MonthBucket[];
  generatedAt: string;
}

/**
 * Indian Financial Year — 1 April YYYY 00:00 IST through 1 April YYYY+1 00:00 IST (exclusive).
 */
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
  // Pre-seed all 12 FY months so the UI grid is always complete.
  for (let i = 0; i < 12; i++) {
    const monthIdx = (3 + i) % 12; // 3=April (0-indexed)
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
      // Outside the pre-seeded window — should be impossible given the
      // exitedAt SQL filter. Refuse silently swallowing it.
      throw new Error(
        `paper_trade_fo ${t.id}: exit IST month ${monthKey} is outside FY ${fy} despite the SQL filter`,
      );
    }
    b.realizedPnl += t.realizedPnl;
    b.netPnl += t.netPnl;
    b.charges += t.charges;
    b.tradeCount++;
    if (t.netPnl > 0) b.wins++;
    else if (t.netPnl < 0) b.losses++;
  }
  const months = Array.from(byMonth.values()); // already in FY order due to insertion
  return {
    fy,
    from,
    to,
    totals: aggregateTotals(trades),
    months,
    generatedAt: new Date().toISOString(),
  };
}
