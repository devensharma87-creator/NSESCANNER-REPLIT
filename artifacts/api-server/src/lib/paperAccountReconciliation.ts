/**
 * B.1/B.2 — Paper account ↔ paper_trade_fo/eq reconciliation (Phase-2 kickoff).
 *
 * Read-only tie-out. For a segment (`FNO` or `EQUITY`) on a specific IST
 * trading date, compute the two sides of the identity:
 *
 *     seed_capital
 *   - Σ capital_deployed on trades OPENED today and STILL OPEN
 *   + Σ (capital_deployed + realized_pnl) on trades CLOSED today
 *   + Σ (capital_deployed) on trades that carried in and closed today
 *   = paper_account.balance                                     [expected]
 *
 * A pass is `|expected - actual| ≤ 0.01 * count`. Anything else is a
 * reconciliation drift and MUST be surfaced — no auto-repair.
 *
 * This module does NOT mutate state, does NOT charge trades, and does NOT
 * settle open positions. Unrealized P&L on carryover open positions is
 * shown as an INFO-ONLY line (marked-to-market on lastPremium * lots *
 * lotSize) so the owner can see the "true" account value at a glance, but
 * it does not enter the reconciliation identity — an open trade's P&L
 * hasn't been realised.
 *
 * Charges are NOT yet subtracted from `paper_account.balance` in the
 * current writer path (see paperTradingFO.ts closePaperTradeForSignal),
 * so the identity above assumes gross settlement. When the charge model
 * (B.6/B.7) is wired end-to-end, a `chargesToday` term will land here.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

export type ReconciliationSegment = "FNO" | "EQUITY";

export interface ReconciliationResult {
  segment: ReconciliationSegment;
  istDate: string;
  computedAt: string;
  /** Static seed capital from paper_account.seed_capital. */
  seedCapital: number;
  /** Live paper_account.balance as recorded. */
  actualBalance: number;
  /** paper_account.day_realized_pnl as recorded. */
  recordedDayRealizedPnl: number;
  /** Sum of capital_deployed on rows OPENED today AND still OPEN. */
  capitalDeployedTodayOpen: number;
  /** Rows closed today: gross settlement math for the identity. */
  closedTodayCount: number;
  closedTodayCapitalReturned: number;
  closedTodayRealizedPnl: number;
  /** Rows that carried in (opened on a prior IST day) and are still OPEN today. */
  carryOverOpenCount: number;
  carryOverCapitalDeployed: number;
  /** Unrealized MTM P&L on open rows (info-only, NOT part of the identity). */
  openMarkToMarketPnl: number;
  /** Expected balance from the identity (see module docstring). */
  expectedBalance: number;
  /** actualBalance − expectedBalance. Non-zero = drift. */
  driftAmount: number;
  /** True when |drift| within tolerance and all sanity checks pass. */
  reconciled: boolean;
  /** Owner-facing notes — populated on any deviation. Empty when reconciled=true. */
  notes: string[];
  /** B.6/B.7 — Gross vs Net P&L. Charges is a READ-ONLY estimate computed on
   *  the fly from a static schedule (see estimateChargesFor); the paper
   *  ledger currently records GROSS P&L only. When durable charges
   *  columns land in paper_trade_fo/eq, this field switches to summed
   *  DB values and the reconciliation identity updates accordingly. */
  chargesEstimate: {
    /** ₹ — estimated total charges (brokerage + STT + exchange + GST + SEBI + stamp). */
    estimatedTotal: number;
    /** Same, but ONLY for trades closed today (lifetime is separate). */
    estimatedToday: number;
    /** True until a durable charges column is written on every close. */
    estimated: true;
    /** Free-text schedule fingerprint so callers see which model was used. */
    schedule: string;
  };
  /** Gross realized P&L across all CLOSED rows for the segment (lifetime). */
  grossRealizedPnl: number;
  /** Estimated Net = Gross − chargesEstimate.estimatedTotal (lifetime). */
  estimatedNetRealizedPnl: number;
}

/**
 * Format an IST calendar day string (YYYY-MM-DD) for the given instant.
 * Passing no argument yields today's IST trading date. Kept local — the
 * repo has multiple `istDateKey` variants and I don't want to import a
 * specific one here (behaviour identical: shift by 5h30m, slice ISO).
 */
function istDay(now: Date = new Date()): string {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

/**
 * Static charges schedule for a paper F&O options round-trip. Numbers below
 * mirror the Zerodha/BSE/NSE fee card for equity/index options at
 * publication time; charges are computed on premium notional (not lot
 * notional) as per SEBI. If Zerodha revises the plate, update ONE number.
 *
 * Fields (rate × base):
 *   • brokerage — ₹20 flat per executed order, so ₹40 per round-trip
 *   • STT       — 0.10% on SELL premium notional (options, delivery)
 *   • exchange  — 0.053% on premium turnover (NSE/BSE similar)
 *   • sebi      — ₹10 per crore of premium turnover
 *   • gst       — 18% on brokerage + exchange + sebi
 *   • stampDuty — 0.003% on BUY premium notional
 *
 * For paper EQUITY (CNC/delivery): brokerage=0 (Zerodha equity delivery),
 * STT=0.1% on both legs, stampDuty=0.015% on BUY, exchange≈0.00297%,
 * gst=18% on exchange+sebi.
 */
const CHARGES_SCHEDULE_FNO_V1 = "FNO_V1_2026Q1";
const CHARGES_SCHEDULE_EQ_V1 = "EQ_CNC_V1_2026Q1";

function estimateChargesForFno(
  buyPremiumNotional: number,
  sellPremiumNotional: number,
): number {
  const brokerage = 40; // ₹20 × 2 legs
  const stt = 0.001 * sellPremiumNotional;
  const exchange = 0.00053 * (buyPremiumNotional + sellPremiumNotional);
  const sebi = (buyPremiumNotional + sellPremiumNotional) * (10 / 1e7);
  const stamp = 0.00003 * buyPremiumNotional;
  const gst = 0.18 * (brokerage + exchange + sebi);
  return Number((brokerage + stt + exchange + sebi + stamp + gst).toFixed(2));
}

function estimateChargesForEq(
  buyNotional: number,
  sellNotional: number,
): number {
  const brokerage = 0;
  const stt = 0.001 * (buyNotional + sellNotional);
  const exchange = 0.0000297 * (buyNotional + sellNotional);
  const sebi = (buyNotional + sellNotional) * (10 / 1e7);
  const stamp = 0.00015 * buyNotional;
  const gst = 0.18 * (exchange + sebi);
  return Number((brokerage + stt + exchange + sebi + stamp + gst).toFixed(2));
}

/** Boundaries of the IST calendar day as UTC ISO strings. Rows are
 *  timestamptz — comparing against these produces the "opened today IST"
 *  and "closed today IST" filters used by the queries below. */
function istDayBounds(dayIst: string): { startUtc: string; endUtc: string } {
  // 00:00 IST → 18:30 UTC previous day; 24:00 IST → 18:30 UTC same day.
  const startUtc = new Date(`${dayIst}T00:00:00+05:30`).toISOString();
  const [y, m, d] = dayIst.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const endUtc = new Date(next.getTime() - 5.5 * 60 * 60 * 1000).toISOString();
  return { startUtc, endUtc };
}

/**
 * Compute a reconciliation snapshot for a segment on a given IST date.
 * `dayIst` defaults to today. Never throws — a DB failure returns a
 * result with `reconciled=false` and a note explaining the failure.
 */
export async function reconcilePaperAccount(
  segment: ReconciliationSegment,
  dayIst?: string,
): Promise<ReconciliationResult> {
  const targetDay = dayIst ?? istDay();
  const { startUtc, endUtc } = istDayBounds(targetDay);
  const computedAt = new Date().toISOString();
  const notes: string[] = [];

  try {
    // paper_account row for the segment.
    const acctRes = await db.execute(sql`
      SELECT segment,
             seed_capital::float AS seed_capital,
             balance::float AS balance,
             day_realized_pnl::float AS day_realized_pnl
        FROM paper_account
       WHERE segment = ${segment}
       LIMIT 1
    `);
    const acctRow = (acctRes as unknown as {
      rows: Array<{
        seed_capital: number;
        balance: number;
        day_realized_pnl: number;
      }>;
    }).rows[0];
    if (!acctRow) {
      return {
        segment,
        istDate: targetDay,
        computedAt,
        seedCapital: 0,
        actualBalance: 0,
        recordedDayRealizedPnl: 0,
        capitalDeployedTodayOpen: 0,
        closedTodayCount: 0,
        closedTodayCapitalReturned: 0,
        closedTodayRealizedPnl: 0,
        carryOverOpenCount: 0,
        carryOverCapitalDeployed: 0,
        openMarkToMarketPnl: 0,
        expectedBalance: 0,
        driftAmount: 0,
        reconciled: false,
        notes: [`paper_account row missing for segment=${segment}`],
        chargesEstimate: {
          estimatedTotal: 0,
          estimatedToday: 0,
          estimated: true,
          schedule:
            segment === "FNO" ? CHARGES_SCHEDULE_FNO_V1 : CHARGES_SCHEDULE_EQ_V1,
        },
        grossRealizedPnl: 0,
        estimatedNetRealizedPnl: 0,
      };
    }

    const seedCapital = Number(acctRow.seed_capital ?? 0);
    const actualBalance = Number(acctRow.balance ?? 0);
    const recordedDayRealizedPnl = Number(acctRow.day_realized_pnl ?? 0);

    // Trades table depends on the segment.
    const table = segment === "FNO" ? "paper_trade_fo" : "paper_trade_eq";

    // Opened today AND still OPEN → capital deployed today.
    const openedTodayRes = await db.execute(sql.raw(`
      SELECT COALESCE(SUM(capital_deployed), 0)::float AS deployed,
             COUNT(*)::int AS n
        FROM ${table}
       WHERE status = 'OPEN'
         AND opened_at >= '${startUtc}'
         AND opened_at <  '${endUtc}'
    `));
    const openedTodayRow = (openedTodayRes as unknown as {
      rows: Array<{ deployed: number; n: number }>;
    }).rows[0] ?? { deployed: 0, n: 0 };

    // Closed today → gross return.
    const closedTodayRes = await db.execute(sql.raw(`
      SELECT COALESCE(SUM(capital_deployed), 0)::float AS deployed,
             COALESCE(SUM(realized_pnl), 0)::float AS pnl,
             COUNT(*)::int AS n
        FROM ${table}
       WHERE status = 'CLOSED'
         AND exited_at >= '${startUtc}'
         AND exited_at <  '${endUtc}'
    `));
    const closedTodayRow = (closedTodayRes as unknown as {
      rows: Array<{ deployed: number; pnl: number; n: number }>;
    }).rows[0] ?? { deployed: 0, pnl: 0, n: 0 };

    // Carryover OPEN — trades opened before today, still open today.
    const carryRes = await db.execute(sql.raw(`
      SELECT COALESCE(SUM(capital_deployed), 0)::float AS deployed,
             COUNT(*)::int AS n
        FROM ${table}
       WHERE status = 'OPEN'
         AND opened_at < '${startUtc}'
    `));
    const carryRow = (carryRes as unknown as {
      rows: Array<{ deployed: number; n: number }>;
    }).rows[0] ?? { deployed: 0, n: 0 };

    // Marked-to-market unrealized P&L on all open rows (info-only).
    // For F&O: (last_premium - entry_premium) * lots * lot_size.
    // For EQ:  paper_trade_eq stores unrealized on a different column set;
    //          keep the query segment-conditional and fall back to 0 if
    //          the column layout doesn't match (defensive — never throw).
    let openMarkToMarketPnl = 0;
    try {
      if (segment === "FNO") {
        const mtmRes = await db.execute(sql`
          SELECT COALESCE(SUM((last_premium - entry_premium) * lots * lot_size), 0)::float AS mtm
            FROM paper_trade_fo
           WHERE status = 'OPEN'
        `);
        openMarkToMarketPnl = Number(
          (mtmRes as unknown as { rows: Array<{ mtm: number }> }).rows[0]?.mtm ?? 0,
        );
      } else {
        // Equity paper: (last_price - entry_price) * qty. Column names in
        // paper_trade_eq may vary — best-effort, honest 0 fallback.
        try {
          const mtmRes = await db.execute(sql`
            SELECT COALESCE(SUM((last_price - entry_price) * quantity), 0)::float AS mtm
              FROM paper_trade_eq
             WHERE status = 'OPEN'
          `);
          openMarkToMarketPnl = Number(
            (mtmRes as unknown as { rows: Array<{ mtm: number }> }).rows[0]?.mtm ?? 0,
          );
        } catch {
          notes.push("EQUITY mark-to-market unavailable (column mapping differs) — showing 0");
        }
      }
    } catch (err) {
      notes.push(`mark-to-market query failed: ${(err as Error).message}`);
    }

    // Identity:
    // expected_balance = seed_capital
    //   - deployed_today_still_open
    //   + closed_today_returned  (capital_deployed + realized_pnl of closed rows today)
    //   - carryover_still_open   (their capital is deployed and gone from cash)
    //
    // NOTE: on IST-day boundaries, the writer refills day counters — but
    // NOT balance/seed. Balance is a rolling ledger. So the identity is:
    // actual = seed - Σ(deployed on all OPEN rows) + Σ(realized_pnl on all CLOSED rows).
    //
    // Rewriting in terms of the queries above:
    // expected = seed - (deployedTodayOpen + carryDeployed) + realized_lifetime
    //
    // We don't have realized_lifetime in one query — but for a fresh IST
    // day where the writer resets nothing on balance, realized-today
    // stands in for realised-since-seed IF seed itself was set at the
    // start of the ledger. If the seed has been refilled at any point,
    // the identity here surfaces the drift instead of hiding it.
    //
    // To make this bullet-proof, we sum realized_pnl across ALL closed
    // rows for the segment (whole ledger, not just today):
    const lifetimeRes = await db.execute(sql.raw(`
      SELECT COALESCE(SUM(realized_pnl), 0)::float AS pnl_lifetime,
             COALESCE(SUM(capital_deployed), 0)::float AS deployed_lifetime_closed
        FROM ${table}
       WHERE status = 'CLOSED'
    `));
    const lifetimeRow = (lifetimeRes as unknown as {
      rows: Array<{ pnl_lifetime: number; deployed_lifetime_closed: number }>;
    }).rows[0] ?? { pnl_lifetime: 0, deployed_lifetime_closed: 0 };

    const totalOpenDeployed = Number(openedTodayRow.deployed) + Number(carryRow.deployed);
    const expectedBalance =
      seedCapital - totalOpenDeployed + Number(lifetimeRow.pnl_lifetime);
    const driftAmount = Number((actualBalance - expectedBalance).toFixed(2));

    // Tolerance: 1 paisa per row involved. Grows with row count to absorb
    // rounding on numeric(18,2) truncation across many rows.
    const rowCount =
      Number(openedTodayRow.n) + Number(closedTodayRow.n) + Number(carryRow.n);
    const tolerance = Math.max(0.05, 0.01 * rowCount);
    const reconciled = Math.abs(driftAmount) <= tolerance;
    if (!reconciled) {
      notes.push(
        `drift ₹${driftAmount.toFixed(2)} exceeds tolerance ₹${tolerance.toFixed(
          2,
        )} (${rowCount} rows involved) — writer path likely missed a balance update, or a charge was applied that this identity doesn't yet account for`,
      );
    }

    // B.6/B.7 — charges estimate (read-only). Sum lifetime buy+sell notional
    // across CLOSED trades and apply the static schedule. For F&O the
    // notional is `entry_premium × lots × lot_size` on the buy side and
    // `exit_premium × lots × lot_size` on the sell side. For equity we
    // use `entry_price × quantity` / `exit_price × quantity`. Best-effort
    // — a query-column mismatch returns 0 with a note (never throws).
    let chargesTotal = 0;
    let chargesToday = 0;
    let grossRealizedPnl = Number(lifetimeRow.pnl_lifetime);
    try {
      if (segment === "FNO") {
        const notionalRes = await db.execute(sql`
          SELECT COALESCE(SUM(entry_premium * lots * lot_size), 0)::float AS buy_notional,
                 COALESCE(SUM(exit_premium  * lots * lot_size), 0)::float AS sell_notional
            FROM paper_trade_fo
           WHERE status = 'CLOSED'
        `);
        const n = (notionalRes as unknown as {
          rows: Array<{ buy_notional: number; sell_notional: number }>;
        }).rows[0] ?? { buy_notional: 0, sell_notional: 0 };
        chargesTotal = estimateChargesForFno(
          Number(n.buy_notional),
          Number(n.sell_notional),
        );
        const todayNotionalRes = await db.execute(sql.raw(`
          SELECT COALESCE(SUM(entry_premium * lots * lot_size), 0)::float AS buy_notional,
                 COALESCE(SUM(exit_premium  * lots * lot_size), 0)::float AS sell_notional
            FROM paper_trade_fo
           WHERE status = 'CLOSED'
             AND exited_at >= '${startUtc}'
             AND exited_at <  '${endUtc}'
        `));
        const t = (todayNotionalRes as unknown as {
          rows: Array<{ buy_notional: number; sell_notional: number }>;
        }).rows[0] ?? { buy_notional: 0, sell_notional: 0 };
        chargesToday = estimateChargesForFno(
          Number(t.buy_notional),
          Number(t.sell_notional),
        );
      } else {
        // EQUITY paper — best-effort. Column mismatch returns 0.
        try {
          const notionalRes = await db.execute(sql`
            SELECT COALESCE(SUM(entry_price * quantity), 0)::float AS buy_notional,
                   COALESCE(SUM(exit_price  * quantity), 0)::float AS sell_notional
              FROM paper_trade_eq
             WHERE status = 'CLOSED'
          `);
          const n = (notionalRes as unknown as {
            rows: Array<{ buy_notional: number; sell_notional: number }>;
          }).rows[0] ?? { buy_notional: 0, sell_notional: 0 };
          chargesTotal = estimateChargesForEq(
            Number(n.buy_notional),
            Number(n.sell_notional),
          );
          const todayNotionalRes = await db.execute(sql.raw(`
            SELECT COALESCE(SUM(entry_price * quantity), 0)::float AS buy_notional,
                   COALESCE(SUM(exit_price  * quantity), 0)::float AS sell_notional
              FROM paper_trade_eq
             WHERE status = 'CLOSED'
               AND exited_at >= '${startUtc}'
               AND exited_at <  '${endUtc}'
          `));
          const t = (todayNotionalRes as unknown as {
            rows: Array<{ buy_notional: number; sell_notional: number }>;
          }).rows[0] ?? { buy_notional: 0, sell_notional: 0 };
          chargesToday = estimateChargesForEq(
            Number(t.buy_notional),
            Number(t.sell_notional),
          );
        } catch {
          notes.push("EQUITY charges estimate unavailable (column mapping differs) — showing 0");
        }
      }
    } catch (err) {
      notes.push(`charges estimate query failed: ${(err as Error).message}`);
    }

    return {
      segment,
      istDate: targetDay,
      computedAt,
      seedCapital,
      actualBalance,
      recordedDayRealizedPnl,
      capitalDeployedTodayOpen: Number(openedTodayRow.deployed),
      closedTodayCount: Number(closedTodayRow.n),
      closedTodayCapitalReturned:
        Number(closedTodayRow.deployed) + Number(closedTodayRow.pnl),
      closedTodayRealizedPnl: Number(closedTodayRow.pnl),
      carryOverOpenCount: Number(carryRow.n),
      carryOverCapitalDeployed: Number(carryRow.deployed),
      openMarkToMarketPnl,
      expectedBalance: Number(expectedBalance.toFixed(2)),
      driftAmount,
      reconciled,
      notes,
      chargesEstimate: {
        estimatedTotal: chargesTotal,
        estimatedToday: chargesToday,
        estimated: true,
        schedule:
          segment === "FNO" ? CHARGES_SCHEDULE_FNO_V1 : CHARGES_SCHEDULE_EQ_V1,
      },
      grossRealizedPnl,
      estimatedNetRealizedPnl: Number((grossRealizedPnl - chargesTotal).toFixed(2)),
    };
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, segment, targetDay },
      "reconcilePaperAccount failed",
    );
    return {
      segment,
      istDate: targetDay,
      computedAt,
      seedCapital: 0,
      actualBalance: 0,
      recordedDayRealizedPnl: 0,
      capitalDeployedTodayOpen: 0,
      closedTodayCount: 0,
      closedTodayCapitalReturned: 0,
      closedTodayRealizedPnl: 0,
      carryOverOpenCount: 0,
      carryOverCapitalDeployed: 0,
      openMarkToMarketPnl: 0,
      expectedBalance: 0,
      driftAmount: 0,
      reconciled: false,
      notes: [`reconciliation query failed: ${(err as Error).message}`],
      chargesEstimate: {
        estimatedTotal: 0,
        estimatedToday: 0,
        estimated: true,
        schedule:
          segment === "FNO" ? CHARGES_SCHEDULE_FNO_V1 : CHARGES_SCHEDULE_EQ_V1,
      },
      grossRealizedPnl: 0,
      estimatedNetRealizedPnl: 0,
    };
  }
}
