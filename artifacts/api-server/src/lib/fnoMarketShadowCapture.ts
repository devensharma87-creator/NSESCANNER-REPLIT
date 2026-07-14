/**
 * Exit-premium market shadow capture.
 *
 * Records the REAL Kite option-chain LTP at the moment a paper F&O trade
 * closes — OBSERVATION ONLY. This field NEVER affects P&L, exit decisions,
 * account balance, Telegram alerts, or any signal path.
 *
 * Purpose: let the cockpit measure slippage / liquidity quality by comparing
 * the frozen plan-level exit_premium (authoritative settlement) with the live
 * market price at the same instant.
 *
 * Source rule: only Kite-sourced chains are accepted (chain.spotSource ===
 * "kite"). NSE-direct or unavailable sources are recorded as unavailable
 * with the appropriate reason. The authoritative exit_premium is never
 * replaced.
 *
 * Schema columns (applied via ALTER TABLE ADD COLUMN IF NOT EXISTS in
 * `applyFoMarketShadowColumns()`, never drizzle-kit push):
 *   exit_premium_market              NUMERIC(18,4)
 *   exit_premium_market_source       TEXT
 *   exit_premium_market_as_of        TIMESTAMPTZ
 *   exit_premium_market_age_sec      INTEGER
 *   exit_premium_market_gap          NUMERIC(18,4)
 *   exit_premium_market_gap_pct      NUMERIC(8,4)
 *   market_shadow_gross_pnl          NUMERIC(18,2)
 *   exit_premium_market_unavailable_reason  TEXT
 */

import { db, paperTradeFoTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import type { OcResponse } from "./optionChain";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Reason codes for when the real market LTP cannot be captured.
 * Stored in exit_premium_market_unavailable_reason (null means available).
 */
export type ExitPremiumMarketUnavailableReason =
  | "CHAIN_MISSING"        // fetchOptionChain returned null
  | "SOURCE_NOT_KITE"      // chain.spotSource !== "kite" (NSE-direct, etc.)
  | "STRIKE_NOT_IN_CHAIN"  // strike not found in chain.rows
  | "LTP_MISSING"          // OcSide found but ltp is null/undefined
  | "LTP_INVALID"          // ltp is non-finite or ≤ 0
  | "FETCH_ERROR";         // chain fetch threw (used by callers that catch)

export type ExitMarketShadowResult =
  | {
      available: true;
      marketLtp: number;
      source: string;
      asOf: Date;
      ageSec: number;
      gap: number;
      gapPct: number;
      shadowGrossPnl: number;
    }
  | {
      available: false;
      unavailableReason: ExitPremiumMarketUnavailableReason;
    };

/** Floating-point tolerance for strike matching (₹). NSE strikes are integer
 *  multiples of 50/100 but paper_trade_fo stores them as NUMERIC(18,4),
 *  producing values like 22500.0000; 0.05 safely covers any round-trip jitter
 *  while remaining well below the smallest NSE step (50). */
const STRIKE_MATCH_TOLERANCE = 0.05;

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Extract the LTP for a specific (strike, optionType) from an option chain.
 * Returns null when:
 *   - The strike is not present in chain.rows.
 *   - The side (CE/PE) has no ltp, or ltp is non-finite / ≤ 0.
 *
 * Pure — no side effects.
 */
export function extractStrikeLtpFromChain(
  chain: OcResponse,
  strike: number,
  optionType: "CE" | "PE",
): number | null {
  const row = chain.rows.find(
    (r) => Math.abs(r.strike - strike) <= STRIKE_MATCH_TOLERANCE,
  );
  if (!row) return null;
  const side = optionType === "CE" ? row.ce : row.pe;
  const ltp = side?.ltp;
  if (ltp == null || !Number.isFinite(ltp) || ltp <= 0) return null;
  return ltp;
}

/**
 * Compute the shadow gap and gross P&L from market LTP vs frozen plan.
 * Pure — no side effects.
 *
 * gap = marketLtp − frozenExitPremium (signed, ₹)
 *   • Positive: market was HIGHER than the frozen plan exit premium.
 *   • Negative: market was LOWER than the frozen plan exit premium.
 *
 * gapPct = gap / frozenExitPremium × 100, rounded to 4dp.
 *   Zero when frozenExitPremium is 0 (avoids division by zero).
 *
 * shadowGrossPnl = (marketLtp − entryPremium) × lots × lotSize (₹).
 *   Uses market LTP instead of the frozen exit premium — the gross P&L
 *   the trade WOULD have produced if settled at the live market price.
 */
export function computeMarketShadow(
  marketLtp: number,
  entryPremium: number,
  frozenExitPremium: number,
  lots: number,
  lotSize: number,
): { gap: number; gapPct: number; shadowGrossPnl: number } {
  const gap = marketLtp - frozenExitPremium;
  const gapPct =
    frozenExitPremium !== 0
      ? +((gap / frozenExitPremium) * 100).toFixed(4)
      : 0;
  const shadowGrossPnl = (marketLtp - entryPremium) * lots * lotSize;
  return {
    gap: +gap.toFixed(4),
    gapPct,
    shadowGrossPnl: +shadowGrossPnl.toFixed(2),
  };
}

/**
 * Given a CLOSED paper-trade row and a freshly-fetched option chain,
 * compute the market-shadow result.
 *
 * Pure — no DB or network access. Call `applyMarketShadowToDb` to persist.
 *
 * Source rule: only chains with spotSource === "kite" are accepted. NSE-direct
 * chains (spotSource === "nse") are rejected because their per-strike LTPs
 * are not guaranteed real-time and must not be mixed with live Kite data.
 */
export function captureExitMarketPremium(
  row: {
    id: string;
    strike: string | number | null;
    optionType: string;
    entryPremium: string | number | null;
    exitPremium: string | number | null;
    lots: number;
    lotSize: number;
  },
  chain: OcResponse | null,
): ExitMarketShadowResult {
  if (!chain) {
    return { available: false, unavailableReason: "CHAIN_MISSING" };
  }

  if (chain.spotSource !== "kite") {
    return { available: false, unavailableReason: "SOURCE_NOT_KITE" };
  }

  const strike =
    typeof row.strike === "number"
      ? row.strike
      : parseFloat(String(row.strike ?? "0"));
  const optionType = (row.optionType === "PE" ? "PE" : "CE") as "CE" | "PE";

  const strikeRow = chain.rows.find(
    (r) => Math.abs(r.strike - strike) <= STRIKE_MATCH_TOLERANCE,
  );
  if (!strikeRow) {
    return { available: false, unavailableReason: "STRIKE_NOT_IN_CHAIN" };
  }

  const side = optionType === "CE" ? strikeRow.ce : strikeRow.pe;
  const ltp = side?.ltp;
  if (ltp == null) {
    return { available: false, unavailableReason: "LTP_MISSING" };
  }
  if (!Number.isFinite(ltp) || ltp <= 0) {
    return { available: false, unavailableReason: "LTP_INVALID" };
  }

  const entryPremium =
    typeof row.entryPremium === "number"
      ? row.entryPremium
      : parseFloat(String(row.entryPremium ?? "0"));
  const frozenExitPremium =
    typeof row.exitPremium === "number"
      ? row.exitPremium
      : parseFloat(String(row.exitPremium ?? "0"));

  const chainAsOf = new Date(chain.generatedAt);
  const ageSec = Math.max(
    0,
    Math.round((Date.now() - chainAsOf.getTime()) / 1000),
  );

  const { gap, gapPct, shadowGrossPnl } = computeMarketShadow(
    ltp,
    entryPremium,
    frozenExitPremium,
    row.lots,
    row.lotSize,
  );

  return {
    available: true,
    marketLtp: ltp,
    source: "KITE_CHAIN",
    asOf: chainAsOf,
    ageSec,
    gap,
    gapPct,
    shadowGrossPnl,
  };
}

// ─── Schema migration ─────────────────────────────────────────────────────────

/**
 * Idempotent ALTER TABLE: adds the 8 market-shadow columns to paper_trade_fo.
 * Safe to call multiple times; ADD COLUMN IF NOT EXISTS is a no-op when the
 * column already exists. Never use drizzle-kit push (push would attempt to
 * DROP the strategy_definitions / strategy_engine_state tables).
 */
export async function applyFoMarketShadowColumns(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE paper_trade_fo
      ADD COLUMN IF NOT EXISTS exit_premium_market              NUMERIC(18, 4),
      ADD COLUMN IF NOT EXISTS exit_premium_market_source       TEXT,
      ADD COLUMN IF NOT EXISTS exit_premium_market_as_of        TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS exit_premium_market_age_sec      INTEGER,
      ADD COLUMN IF NOT EXISTS exit_premium_market_gap          NUMERIC(18, 4),
      ADD COLUMN IF NOT EXISTS exit_premium_market_gap_pct      NUMERIC(8, 4),
      ADD COLUMN IF NOT EXISTS market_shadow_gross_pnl          NUMERIC(18, 2),
      ADD COLUMN IF NOT EXISTS exit_premium_market_unavailable_reason TEXT
  `);
}

let shadowMigrationPromise: Promise<void> | null = null;

/**
 * Memoized, idempotent schema-ready gate. First caller triggers the
 * migration; every subsequent caller (same process lifetime) awaits the
 * same resolved promise — effectively free after the first call.
 *
 * On failure the promise is cleared so a later call can retry (transient
 * DB blip should not permanently prevent shadow recording).
 */
export function ensureFoMarketShadowColumns(): Promise<void> {
  if (!shadowMigrationPromise) {
    shadowMigrationPromise = applyFoMarketShadowColumns().catch(
      (err: unknown) => {
        shadowMigrationPromise = null;
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "fno market shadow: schema column migration failed, will retry on next close",
        );
        throw err;
      },
    );
  }
  return shadowMigrationPromise;
}

/** @internal Reset memoized migration promise for tests. */
export function __resetFoMarketShadowColumnsGuardForTests(): void {
  shadowMigrationPromise = null;
}

// ─── DB write ─────────────────────────────────────────────────────────────────

/**
 * Persist shadow fields for a CLOSED paper_trade_fo row.
 *
 * Awaits `ensureFoMarketShadowColumns()` before writing so the columns
 * always exist on first use. Best-effort callers should fire-and-forget
 * with `.catch(() => {})` — this function is not responsible for
 * swallowing errors; the caller chooses the error policy.
 *
 * Writes one UPDATE per trade. Never touches status / exit_premium /
 * realized_pnl / account balance — those are settled by
 * `closePaperTradeForSignal` inside its transaction.
 */
export async function applyMarketShadowToDb(
  tradeId: string,
  result: ExitMarketShadowResult,
): Promise<void> {
  await ensureFoMarketShadowColumns();

  if (result.available) {
    await db
      .update(paperTradeFoTable)
      .set({
        exitPremiumMarket: String(result.marketLtp.toFixed(4)),
        exitPremiumMarketSource: result.source,
        exitPremiumMarketAsOf: result.asOf,
        exitPremiumMarketAgeSec: result.ageSec,
        exitPremiumMarketGap: String(result.gap.toFixed(4)),
        exitPremiumMarketGapPct: String(result.gapPct.toFixed(4)),
        marketShadowGrossPnl: String(result.shadowGrossPnl.toFixed(2)),
        exitPremiumMarketUnavailableReason: null,
      })
      .where(eq(paperTradeFoTable.id, tradeId));
  } else {
    await db
      .update(paperTradeFoTable)
      .set({
        exitPremiumMarket: null,
        exitPremiumMarketSource: null,
        exitPremiumMarketAsOf: null,
        exitPremiumMarketAgeSec: null,
        exitPremiumMarketGap: null,
        exitPremiumMarketGapPct: null,
        marketShadowGrossPnl: null,
        exitPremiumMarketUnavailableReason: result.unavailableReason,
      })
      .where(eq(paperTradeFoTable.id, tradeId));
  }
}
