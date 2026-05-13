/**
 * F&O paper trading executor.
 *
 * Sits as a side-effect hook on top of the existing option signal
 * lifecycle. It does NOT generate signals or fetch market data — it
 * only translates lifecycle transitions into virtual broker actions:
 *
 *   PENDING -> TRIGGERED  ⇒  open a paper position (1 row in paper_trade_fo)
 *   TRIGGERED -> STOPPED  ⇒  close at locked stop premium
 *   ANY      -> TARGET2_HIT  ⇒  close at locked T2 premium
 *   sweep at 15:30 IST ⇒  close at the row's appropriate premium
 *
 * Position sizing is risk-driven (max 2% loss per trade), not lot-fixed,
 * so the more dangerous a setup is the smaller the position. Combined
 * with the 4-trades-per-day cap and a 65-confidence floor (aligned with
 * the confluence-engine emission floor in optionSignals.ts), the goal is
 * to make the paper account behave the way a disciplined retail trader
 * would, not a YOLO scalper.
 *
 * Concurrency: the unique index on
 * (signalDate, indexSymbol, setupKey, direction) in paper_trade_fo
 * guarantees we cannot open two trades for the same signal even if the
 * lifecycle hook fires twice in parallel — the second insert just hits
 * `ON CONFLICT DO NOTHING` and we refund the (never-actually-debited)
 * balance.
 */
import {
  db,
  paperAccountTable,
  paperTradeFoTable,
} from "@workspace/db";
import type { PaperTradeFoRow } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { isPaperAutoTradingEnabled } from "./paperAutoTradeFlag";
import type { OptionSignal } from "@workspace/api-zod";
import {
  ensureDailyReset,
  FNO_RISK,
  FNO_BASELINE_RISK,
  FNO_BASELINE_GUARDRAILS,
  FNO_LIQUIDITY,
  PAPER_FIXED_LOTS,
  POST_STOP_COOLDOWN,
  REGIME_SIZING,
  PORTFOLIO_HEAT,
  SEED_CAPITAL,
  HEAT_SQL_FNO,
  parseHeatRow,
  riskPctForConfidence,
  getDailyRealizedDrawdown,
  getWeeklyRealizedDrawdown,
} from "./paperAccount";
import { fetchOptionChain, LOT_SIZES } from "./optionChain";
import { logger } from "./logger";
import { computeMarketStatus } from "./marketEvents";
import { isActionableForFno, type DataQualityLabel } from "./tradingConfig";

/**
 * Risk tier for an auto-opened paper trade.
 *   STANDARD — high-conviction detector (trend_continuation, vwap_reclaim,
 *              volume_breakout, ema_pullback, mean_reversion). Uses
 *              FNO_RISK budgets (2% loss cap, 70 conf floor).
 *   BASELINE — always-on directional outlook (tier="BASELINE"). Uses
 *              FNO_BASELINE_RISK budgets (1% loss cap, 55 conf floor).
 *              Shares the same MAX_TRADES_PER_DAY cap so overall daily
 *              exposure is unchanged regardless of mix.
 */
export type TradeTier = "STANDARD" | "BASELINE";

type LifecycleStatus =
  | "PENDING"
  | "TRIGGERED"
  | "TARGET1_HIT"
  | "TARGET2_HIT"
  | "STOPPED"
  | "EXPIRED";

const PAST_TRIGGER: LifecycleStatus[] = [
  "TRIGGERED",
  "TARGET1_HIT",
  "TARGET2_HIT",
  "STOPPED",
];

export interface LifecycleHookInput {
  /** Status BEFORE this evaluation (null = brand-new row). */
  prev: LifecycleStatus | null;
  /** Status AFTER this evaluation. */
  next: LifecycleStatus;
  /** True when the lifecycle just wrote a non-null exitedAt for this row. */
  exited: boolean;
  /** The full signal we're tracking. */
  signal: OptionSignal;
  /** IST date string this signal lives under. */
  signalDate: string;
  /** Direction stored on the lifecycle row (BULLISH | BEARISH). */
  direction: "BULLISH" | "BEARISH";
  /** Risk tier — controls per-trade loss cap and confidence floor. Defaults to STANDARD. */
  tier?: TradeTier;
}

function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : parseFloat(v);
}

function toDbNumeric(n: number, scale = 4): string {
  return Number.isFinite(n) ? n.toFixed(scale) : "0";
}

function lotSizeFor(indexSymbol: string): number | null {
  const ls = LOT_SIZES[indexSymbol.toUpperCase()];
  return ls && ls > 0 ? ls : null;
}

/**
 * Try to open a paper trade. Returns the row on success, or null with
 * a logged reason on every kind of failure (cap, sizing, balance, etc.).
 *
 * Single DB transaction — daily cap check, balance debit, trade insert
 * and counter bumps all commit together or none of them do. This is the
 * fix for two real-world races the architect surfaced:
 *
 *   1) Two concurrent triggers both pass the "dayTradeCount < 4" pre-check
 *      and both insert, taking the cap to 5. With the conditional UPDATE
 *      below, only one transaction can satisfy `dayTradeCount < cap` at a
 *      time, so the second one rolls back.
 *
 *   2) Money debited but trade insert errors mid-way. Without a tx the
 *      ledger silently leaks balance forever. With the tx, ANY failure
 *      after BEGIN rolls everything back.
 *
 * Idempotent on the (signalDate, indexSymbol, setupKey, direction) key —
 * a second call short-circuits to the existing row without re-debiting.
 */
/**
 * BASELINE-lane-only daily stats for the BASELINE guardrails. Joins
 * paper_trade_fo to option_signal_history.tier so we can isolate the
 * lane without adding a column to paper_trade_fo. Same-day, IST-anchored
 * via signal_date (the ledger key already reflects IST trade date).
 *
 * Returns:
 *   openCount         — BASELINE rows opened today (any status)
 *   realizedLossAbs   — sum of negative realized_pnl from CLOSED BASELINE
 *                       rows today (positive number; 0 if no losses)
 *   consecutiveLosses — count of MOST-RECENT BASELINE closes today that
 *                       were stops/losses, breaking the streak on the
 *                       first non-loss
 */
type SqlExecutor = { execute: (typeof db)["execute"] };

interface BaselineDayStats {
  openCount: number;
  realizedLossAbs: number;
  /** Open-position MTM loss from BASELINE-tier positions whose
   *  last_premium has dropped below entry. Adds to realizedLossAbs in
   *  the daily-cap check so we don't open a second BASELINE while the
   *  first is floating badly but not yet stopped. */
  unrealizedLossAbs: number;
  consecutiveLosses: number;
}

/**
 * Returns BASELINE-lane day stats, or `null` on query failure.
 *
 * Reviewer amendment 2026-05-11.c: this function used to fail-OPEN
 * (return zeros, allowing the trade through). For risk guardrails on
 * a real-money-paths system, fail-open is unacceptable — a stats
 * outage must NOT be a free pass to stack BASELINE risk. We now
 * fail-CLOSED: the caller checks for `null` and skips with the
 * `BASELINE_GUARDRAIL_STATS_UNAVAILABLE` reason.
 */
async function getBaselineDayStats(
  signalDate: string,
  executor: SqlExecutor = db,
): Promise<BaselineDayStats | null> {
  try {
    const result = await executor.execute(sql`
      SELECT
        COUNT(*)::int AS open_count,
        COALESCE(SUM(CASE
          WHEN p.status = 'CLOSED' AND p.realized_pnl < 0
          THEN -p.realized_pnl ELSE 0
        END), 0)::numeric AS loss_abs,
        COALESCE(SUM(CASE
          WHEN p.status = 'OPEN'
           AND p.last_premium IS NOT NULL
           AND p.last_premium < p.entry_premium
          THEN (p.entry_premium - p.last_premium) * p.lots * p.lot_size
          ELSE 0
        END), 0)::numeric AS unrealized_loss_abs
      FROM paper_trade_fo p
      JOIN option_signal_history h
        ON h.signal_date = p.signal_date
       AND h.index_symbol = p.index_symbol
       AND h.setup_key   = p.setup_key
       AND h.direction   = p.direction
      WHERE p.signal_date = ${signalDate}
        AND h.tier = 'BASELINE'
    `);
    const row = (result as unknown as {
      rows: Array<{
        open_count: number | string;
        loss_abs: number | string;
        unrealized_loss_abs: number | string;
      }>;
    }).rows[0];
    const openCount = row ? Number(row.open_count) : 0;
    const realizedLossAbs = row ? Number(row.loss_abs) : 0;
    const unrealizedLossAbs = row ? Number(row.unrealized_loss_abs) : 0;

    // Consecutive most-recent BASELINE losses today (stops or negative-pnl exits).
    const streakResult = await executor.execute(sql`
      SELECT p.realized_pnl, p.exit_reason
      FROM paper_trade_fo p
      JOIN option_signal_history h
        ON h.signal_date = p.signal_date
       AND h.index_symbol = p.index_symbol
       AND h.setup_key   = p.setup_key
       AND h.direction   = p.direction
      WHERE p.signal_date = ${signalDate}
        AND p.status = 'CLOSED'
        AND h.tier = 'BASELINE'
      ORDER BY p.exited_at DESC
      LIMIT 10
    `);
    const closes = (streakResult as unknown as {
      rows: Array<{ realized_pnl: string | number | null; exit_reason: string | null }>;
    }).rows;
    let consecutiveLosses = 0;
    for (const c of closes) {
      const pnl = c.realized_pnl == null ? 0 : Number(c.realized_pnl);
      if (pnl < 0) consecutiveLosses++;
      else break;
    }
    return { openCount, realizedLossAbs, unrealizedLossAbs, consecutiveLosses };
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, signalDate },
      "getBaselineDayStats: query failed; BASELINE guardrails fail-CLOSED (open will be skipped)",
    );
    return null;
  }
}

/**
 * Helper: build a MissedSignal payload from a `(signal, ...)` context
 * inside openPaperTrade. Centralised so the dozen-plus skip points all
 * record uniform fields without re-typing the signal-shape boilerplate.
 */
function buildMissedFromOpenCtx(args: {
  signal: OptionSignal;
  signalDate: string;
  indexSymbol: string;
  setupKey: string;
  direction: "BULLISH" | "BEARISH";
  confidence: number;
  tier: TradeTier;
  skipReason: SkipReason;
}): MissedSignal {
  const { signal, signalDate, indexSymbol, setupKey, direction, confidence, tier, skipReason } = args;
  return {
    signalDate,
    indexSymbol,
    indexName: signal.indexName ?? indexSymbol,
    setupKey,
    direction,
    confidence,
    tier,
    status: (signal.status as LifecycleStatus | undefined) ?? "TRIGGERED",
    reason: null,
    skipReason,
    dataQuality: (signal.dataQuality as string | undefined) ?? "UNKNOWN",
    optionEntry: signal.optionEntry ?? signal.optionLtp ?? null,
    optionStop: signal.optionStopLoss ?? null,
    optionTarget1: signal.optionTarget1 ?? null,
    optionTarget2: signal.optionTarget2 ?? null,
    observedAt: new Date(),
  };
}

async function openPaperTrade(input: LifecycleHookInput): Promise<PaperTradeFoRow | null> {
  // Belt-and-braces: every caller already gates above this, but a hard
  // gate inside the only function that mutates `paper_trade_fo` makes
  // the read-only-mode invariant impossible to bypass via a future
  // caller that forgets the check.
  if (!isPaperAutoTradingEnabled()) return null;
  const { signal, signalDate, direction } = input;
  const tier: TradeTier = input.tier ?? "STANDARD";
  const minConfidence =
    tier === "BASELINE" ? FNO_BASELINE_RISK.MIN_CONFIDENCE : FNO_RISK.MIN_CONFIDENCE;
  // Confidence-driven sub-tier sizing (2026-05-11):
  //   STANDARD              → FNO_RISK.MAX_LOSS_PCT_PER_TRADE   (2.0 %)
  //   BASELINE 60-64 ("baseline") → FNO_BASELINE_RISK.BASELINE_RISK_PCT  (0.5 %)
  //   BASELINE 55-59 ("micro")    → FNO_BASELINE_RISK.MICRO_RISK_PCT     (0.25 %)
  // Resolved AFTER the confidence gate below so we don't size on a
  // sub-floor signal.

  const indexSymbol = signal.index;
  const setupKey = signal.setupKey;
  if (!setupKey) return null;

  // Pre-checks that do NOT touch the account.
  const confidence = Math.round(signal.confidence ?? 0);

  // Confidence-driven sizing — pure function of (tier, conf). Resolved
  // up-front so every downstream skip log can include the realised
  // risk-pct (helpful when explaining why a 55-conf MICRO got cut from
  // a heat or budget cap that a 65-conf STANDARD wouldn't have).
  const maxLossPctPerTrade = riskPctForConfidence(tier, confidence);

  // Local skip-recorder closure so the dozen-plus silent skip points
  // below stay readable. Returns the `newlyRecorded` boolean so the
  // caller can gate its INFO log (we still want one log line per skip
  // class per signal, but not on every poll cycle).
  const recordSkip = (skipReason: SkipReason): boolean =>
    recordMissedSignal(
      buildMissedFromOpenCtx({
        signal, signalDate, indexSymbol, setupKey,
        direction, confidence, tier, skipReason,
      }),
    );

  if (confidence < minConfidence) {
    if (recordSkip("CONFIDENCE_FLOOR")) {
      logger.info(
        { indexSymbol, setupKey, tier, confidence, floor: minConfidence, maxLossPctPerTrade },
        `Paper FO skip: ${tier} confidence < ${minConfidence}`,
      );
    }
    return null;
  }
  const lotSize = lotSizeFor(indexSymbol);
  if (!lotSize) {
    logger.info({ indexSymbol }, "Paper FO skip: unknown lot size");
    return null;
  }

  // Existing-row short-circuit (idempotency, lock-free).
  const existing = await db
    .select()
    .from(paperTradeFoTable)
    .where(
      and(
        eq(paperTradeFoTable.signalDate, signalDate),
        eq(paperTradeFoTable.indexSymbol, indexSymbol),
        eq(paperTradeFoTable.setupKey, setupKey),
        eq(paperTradeFoTable.direction, direction),
      ),
    )
    .limit(1);
  if (existing.length > 0) return existing[0]!;

  if (computeMarketStatus(new Date()) !== "open") {
    if (recordSkip("MARKET_CLOSED")) {
      logger.info(
        { indexSymbol, setupKey },
        "Paper FO skip: market not open (weekend/holiday/outside hours) — intraday only",
      );
    }
    return null;
  }

  const recentClosed = await db
    .select({
      exitReason: paperTradeFoTable.exitReason,
      exitedAt: paperTradeFoTable.exitedAt,
    })
    .from(paperTradeFoTable)
    .where(
      and(
        eq(paperTradeFoTable.signalDate, signalDate),
        eq(paperTradeFoTable.status, "CLOSED"),
      ),
    )
    .orderBy(sql`${paperTradeFoTable.exitedAt} DESC`)
    .limit(FNO_RISK.MAX_CONSECUTIVE_STOPS_PER_DAY);
  if (recentClosed.length >= FNO_RISK.MAX_CONSECUTIVE_STOPS_PER_DAY) {
    const allStopped = recentClosed.every(r => r.exitReason === "STOPPED");
    if (allStopped) {
      if (recordSkip("CONSECUTIVE_STOPS")) {
        logger.info(
          { indexSymbol, setupKey, consecutiveStops: recentClosed.length },
          `Paper FO skip: ${FNO_RISK.MAX_CONSECUTIVE_STOPS_PER_DAY} consecutive stops today — pausing`,
        );
      }
      return null;
    }
  }

  // Phase-1 portfolio drawdown caps. Even if every other gate passes,
  // we never open a new trade once today's realised loss has touched
  // 2.5 % of seed (or this week's has touched 5 %). Counted from
  // CLOSED paperTradeFo rows only — open MTM doesn't gate.
  const [dailyDD, weeklyDD] = await Promise.all([
    getDailyRealizedDrawdown(),
    getWeeklyRealizedDrawdown(),
  ]);
  if (dailyDD.capReached) {
    if (recordSkip("DAILY_DD_CAP")) {
      logger.info(
        { indexSymbol, setupKey, drawdownPct: dailyDD.drawdownPct, capPct: dailyDD.capPct },
        `Paper FO skip: daily DD cap hit (${(dailyDD.drawdownPct * 100).toFixed(2)}% ≥ ${(dailyDD.capPct * 100).toFixed(2)}%)`,
      );
    }
    return null;
  }
  if (weeklyDD.capReached) {
    if (recordSkip("WEEKLY_DD_CAP")) {
      logger.info(
        { indexSymbol, setupKey, drawdownPct: weeklyDD.drawdownPct, capPct: weeklyDD.capPct },
        `Paper FO skip: weekly DD cap hit (${(weeklyDD.drawdownPct * 100).toFixed(2)}% ≥ ${(weeklyDD.capPct * 100).toFixed(2)}%)`,
      );
    }
    return null;
  }

  // NOTE: BASELINE-lane guardrails moved INSIDE the open-txn (after the
  // account FOR UPDATE acquire) so two concurrent BASELINE triggers can
  // never both pass a stale precheck and exceed the daily cap.

  const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const istMin = istNow.getUTCHours() * 60 + istNow.getUTCMinutes();
  // STANDARD lane: 15:25 cutoff (10 min before square-off).
  // BASELINE lane: 14:45 cutoff (under-conviction setups need more runway).
  if (istMin >= 15 * 60 + 25) {
    if (recordSkip("TIME_FILTER_LATE")) {
      logger.info(
        { indexSymbol, setupKey, istMin },
        "Paper FO skip: past 15:25 IST late-session cutoff — not enough runway",
      );
    }
    return null;
  }
  if (tier === "BASELINE" && istMin >= FNO_BASELINE_GUARDRAILS.LATE_ENTRY_CUTOFF_IST_MIN) {
    if (recordSkip("BASELINE_LATE")) {
      logger.info(
        { indexSymbol, setupKey, istMin,
          cutoff: FNO_BASELINE_GUARDRAILS.LATE_ENTRY_CUTOFF_IST_MIN },
        "Paper FO skip: BASELINE past 14:45 IST cutoff — under-conviction late chase rejected",
      );
    }
    return null;
  }

  // Validate premium plan.
  const optionEntry = signal.optionEntry ?? signal.optionLtp ?? 0;
  let optionStop = signal.optionStopLoss ?? 0;
  const optionT1 = signal.optionTarget1 ?? optionEntry;
  const optionT2 = signal.optionTarget2 ?? optionT1;

  const PAPER_MAX_PREMIUM_LOSS_PCT = 0.30;
  const minStop = optionEntry * (1 - PAPER_MAX_PREMIUM_LOSS_PCT);
  if (optionStop > 0 && optionStop < minStop) {
    logger.info(
      { indexSymbol, setupKey, rawStop: optionStop, cappedStop: +minStop.toFixed(2), entry: optionEntry },
      "Paper FO: tightening premium stop to 30% max loss cap",
    );
    optionStop = minStop;
  }

  const perShareLoss = optionEntry - optionStop;
  if (!(optionEntry > 0) || !(perShareLoss > 0)) {
    if (recordSkip("INVALID_PREMIUM_PLAN")) {
      logger.info(
        { indexSymbol, setupKey, optionEntry, optionStop },
        "Paper FO skip: invalid premium plan",
      );
    }
    return null;
  }

  // ─── Pass-1 option-leg liquidity gates ────────────────────────────────
  // (a) Cheap-premium gate runs on the cached `optionEntry` — no extra
  //     network call. Catches the worst illiquidity instantly.
  if (optionEntry < FNO_LIQUIDITY.MIN_OPTION_LTP) {
    if (recordSkip("LIQUIDITY_LTP")) {
      logger.info(
        { indexSymbol, setupKey, optionEntry, floor: FNO_LIQUIDITY.MIN_OPTION_LTP },
        "Paper FO skip: option premium below liquidity floor (illiquid)",
      );
    }
    return null;
  }
  // (b) Spread + OI gates need a fresh chain pull. Best-effort: if the
  //     fetch fails or the leg row is missing we WARN and proceed —
  //     LTP gate above is the primary safety, and we don't want a
  //     transient NSE hiccup to wedge the paper trader.
  // Chain-fetch failure ⇒ FAIL OPEN with warn (LTP gate above is the
  // primary safety; transient NSE blips must not wedge the trader).
  // Strike-row missing entirely ⇒ FAIL CLOSED — that's an anomaly we
  // shouldn't paper around. Bid/ask=0 (between trades) ⇒ skip spread
  // check only. OI=0 with chain present ⇒ FAIL CLOSED (truly thin).
  let chain: Awaited<ReturnType<typeof fetchOptionChain>> = null;
  let chainFetchOk = true;
  try {
    chain = await fetchOptionChain(indexSymbol, signal.leg.expiry ?? undefined);
  } catch (err) {
    chainFetchOk = false;
    logger.warn(
      { indexSymbol, setupKey, err: (err as Error).message },
      "Paper FO: liquidity probe chain-fetch threw (proceeding with LTP-only gate)",
    );
  }
  if (chainFetchOk) {
    if (!chain) {
      logger.warn(
        { indexSymbol, setupKey },
        "Paper FO: liquidity probe chain-fetch returned null (proceeding with LTP-only gate)",
      );
    } else {
      const row = chain.rows?.find((rw) => Math.abs(rw.strike - signal.leg.strike) < 0.01);
      const side = row ? (signal.leg.type === "CALL" ? row.ce : row.pe) : undefined;
      if (!side) {
        if (recordSkip("LIQUIDITY_CHAIN_MISSING")) {
          logger.info(
            { indexSymbol, setupKey, strike: signal.leg.strike, type: signal.leg.type },
            "Paper FO skip: strike row missing from chain (liquidity check failed-closed on anomaly)",
          );
        }
        return null;
      }
      const bid = side.bid ?? 0;
      const ask = side.ask ?? 0;
      const ltpRef = side.ltp ?? optionEntry;
      const oi = side.oi ?? 0;
      if (bid > 0 && ask > 0 && ltpRef > 0) {
        const spreadPct = (ask - bid) / ltpRef;
        if (spreadPct > FNO_LIQUIDITY.MAX_BID_ASK_SPREAD_PCT) {
          if (recordSkip("LIQUIDITY_SPREAD")) {
            logger.info(
              { indexSymbol, setupKey, bid, ask, ltpRef, spreadPct: +spreadPct.toFixed(4),
                cap: FNO_LIQUIDITY.MAX_BID_ASK_SPREAD_PCT },
              "Paper FO skip: bid-ask spread too wide (illiquid book)",
            );
          }
          return null;
        }
      }
      // OI=0 with chain present is a real liquidity red flag, not a
      // missing-data case — fail closed.
      if (oi < FNO_LIQUIDITY.MIN_OPTION_OI) {
        if (recordSkip("LIQUIDITY_OI")) {
          logger.info(
            { indexSymbol, setupKey, oi, floor: FNO_LIQUIDITY.MIN_OPTION_OI },
            "Paper FO skip: open interest below liquidity floor (thin book)",
          );
        }
        return null;
      }
    }
  }

  // Make sure the account row exists and has been refilled if a new
  // IST day rolled over since the last access.
  await ensureDailyReset("FNO");

  let openedRow: PaperTradeFoRow | null = null;
  try {
    openedRow = await db.transaction(async (tx) => {
      // SELECT ... FOR UPDATE on the account row serialises every
      // concurrent open for this segment — anything that mutates the
      // F&O account today must queue behind this lock.
      const acctRows = await tx.execute(sql`
        SELECT segment, balance, day_trade_count
          FROM paper_account
         WHERE segment = 'FNO'
         FOR UPDATE
      `);
      const rs = (acctRows as unknown as {
        rows: Array<{ balance: string | number; day_trade_count: number }>;
      }).rows;
      if (rs.length === 0) return null;
      const balance = num(rs[0]!.balance);
      const dayCount = rs[0]!.day_trade_count;

      if (dayCount >= FNO_RISK.MAX_TRADES_PER_DAY) {
        if (recordSkip("DAILY_TRADE_CAP")) {
          logger.info({ dayCount, indexSymbol, setupKey, cap: FNO_RISK.MAX_TRADES_PER_DAY }, "Paper FO skip: daily cap reached (txn-checked)");
        }
        return null;
      }

      // ─── BASELINE-lane guardrails (2026-05-11) — TXN-INTERNAL ───────
      // Re-evaluated under the FOR UPDATE lock so two parallel BASELINE
      // triggers cannot both pass a stale precheck. STANDARD signals
      // bypass this entire block. Stats query runs via tx.execute so it
      // honours the same lock and snapshot as the open-row insert below.
      if (tier === "BASELINE") {
        const baselineStats = await getBaselineDayStats(signalDate, tx);
        // Fail-CLOSED (2026-05-11.c, reviewer-amended): if BASELINE
        // stats can't be computed we MUST NOT silently allow the open
        // — block and surface the reason so the owner can see why.
        if (baselineStats === null) {
          // Reviewer-requested ALERT (2026-05-11.d): bump severity tag
          // and a process-level counter so the daily-summary endpoint
          // surfaces this as a flagged operational event. Always log
          // (not gated by recordSkip dedup) so every occurrence shows
          // up in the audit trail; the ring-buffer dedup still applies
          // to the user-facing "missed signals" feed.
          baselineStatsUnavailableAlertCount += 1;
          baselineStatsUnavailableLastAt = new Date();
          logger.warn(
            {
              event: "ALERT",
              alert: "BASELINE_GUARDRAIL_STATS_UNAVAILABLE",
              indexSymbol, setupKey, signalDate,
              count: baselineStatsUnavailableAlertCount,
            },
            "ALERT: BASELINE guardrail stats unavailable — fail-CLOSED (block)",
          );
          recordSkip("BASELINE_GUARDRAIL_STATS_UNAVAILABLE");
          return null;
        }
        if (baselineStats.openCount >= FNO_BASELINE_GUARDRAILS.MAX_TRADES_PER_DAY) {
          if (recordSkip("BASELINE_DAILY_CAP")) {
            logger.info(
              { indexSymbol, setupKey, baselineOpenCount: baselineStats.openCount,
                cap: FNO_BASELINE_GUARDRAILS.MAX_TRADES_PER_DAY },
              `Paper FO skip: BASELINE daily cap (${baselineStats.openCount}/${FNO_BASELINE_GUARDRAILS.MAX_TRADES_PER_DAY})`,
            );
          }
          return null;
        }
        const baselineDdCap = SEED_CAPITAL.FNO * FNO_BASELINE_GUARDRAILS.MAX_DAILY_LOSS_PCT;
        // 2026-05-11.b: Cap counts realized + unrealized BASELINE loss
        // so we can't pile on a second BASELINE while the first is
        // floating badly but not yet stopped (reviewer feedback).
        const totalBaselineLossAbs =
          baselineStats.realizedLossAbs + baselineStats.unrealizedLossAbs;
        if (totalBaselineLossAbs >= baselineDdCap) {
          if (recordSkip("BASELINE_DAILY_DD_CAP")) {
            logger.info(
              { indexSymbol, setupKey,
                realizedLossAbs: +baselineStats.realizedLossAbs.toFixed(2),
                unrealizedLossAbs: +baselineStats.unrealizedLossAbs.toFixed(2),
                totalLossAbs: +totalBaselineLossAbs.toFixed(2),
                cap: +baselineDdCap.toFixed(2),
                capPct: FNO_BASELINE_GUARDRAILS.MAX_DAILY_LOSS_PCT },
              `Paper FO skip: BASELINE daily loss cap hit (realized ₹${baselineStats.realizedLossAbs.toFixed(0)} + unrealized ₹${baselineStats.unrealizedLossAbs.toFixed(0)} ≥ ${(FNO_BASELINE_GUARDRAILS.MAX_DAILY_LOSS_PCT * 100).toFixed(2)}% of seed)`,
            );
          }
          return null;
        }
        if (baselineStats.consecutiveLosses >= FNO_BASELINE_GUARDRAILS.MAX_CONSECUTIVE_LOSSES) {
          if (recordSkip("BASELINE_CONSECUTIVE_LOSSES")) {
            logger.info(
              { indexSymbol, setupKey, streak: baselineStats.consecutiveLosses,
                cap: FNO_BASELINE_GUARDRAILS.MAX_CONSECUTIVE_LOSSES },
              `Paper FO skip: ${baselineStats.consecutiveLosses} consecutive BASELINE losses today — lane locked`,
            );
          }
          return null;
        }
      }

      // Sizing — two paths:
      //   (a) Owner-configured FIXED lot count for this index (NIFTY 10,
      //       SENSEX 40, BANKNIFTY 30 today) — use it verbatim, but warn
      //       when the implied per-trade risk exceeds the configured cap
      //       so the dashboard / logs still surface the over-risk event.
      //       STANDARD tier ONLY — BASELINE is the conservative
      //       half-size fallback lane (1% risk vs 2%, 55 conf vs 65); it
      //       deliberately keeps dynamic budget sizing so a thin-data
      //       fallback can't accidentally open a 10-lot NIFTY position.
      //   (b) Otherwise (BASELINE tier OR no mapping for this index) the
      //       original risk-budget formula:
      //       lots = floor(balance × maxLossPct / (perShareLoss × lotSize))
      const fixedLots =
        tier === "STANDARD"
          ? PAPER_FIXED_LOTS[indexSymbol.toUpperCase()]
          : undefined;
      const perLotLoss = perShareLoss * lotSize;
      let lots: number;
      if (typeof fixedLots === "number" && fixedLots > 0) {
        lots = fixedLots;
        const impliedRisk = lots * perLotLoss;
        const riskBudget = balance * maxLossPctPerTrade;
        if (impliedRisk > riskBudget) {
          logger.warn(
            {
              indexSymbol,
              setupKey,
              tier,
              fixedLots,
              impliedRisk: +impliedRisk.toFixed(2),
              riskBudget: +riskBudget.toFixed(2),
              maxLossPctPerTrade,
            },
            "Paper FO: fixed-lot override exceeds per-trade risk cap (proceeding by owner choice)",
          );
        }
      } else {
        const budget = balance * maxLossPctPerTrade;
        lots = Math.floor(budget / perLotLoss);
        if (lots < 1) {
          if (recordSkip("BUDGET_TOO_TIGHT")) {
            logger.info(
              { indexSymbol, setupKey, tier, budget, perLotLoss, maxLossPctPerTrade },
              "Paper FO skip: position too risky for budget (lots < 1)",
            );
          }
          return null;
        }
      }

      // ─── Pass-2B sizing scales (multiplicative, after base sizing) ───
      // Both scales apply on TOP of fixed-lot AND dynamic-budget paths
      // so the trader can't bypass them by configuring fixed lots.
      // Floor at 1 lot — we never round down to zero (a phantom-zero
      // row would be inserted otherwise; we want to either trade or
      // skip cleanly).

      // (1) POST-STOP MULTIPLIER: after a STOPPED close on the same
      //     index within the cool-down window, halve size for the next
      //     entry. Read inside the txn so a parallel close that just
      //     committed is honoured. Cool-down is index-scoped, NOT
      //     setup-scoped — a NIFTY EMA_PULLBACK stop also dampens the
      //     next NIFTY MEAN_REVERSION entry.
      const cooldownCutoff = new Date(
        Date.now() - POST_STOP_COOLDOWN.COOLDOWN_MINUTES * 60 * 1000,
      );
      const lastStopRows = await tx.execute(sql`
        SELECT exited_at
          FROM paper_trade_fo
         WHERE index_symbol = ${indexSymbol}
           AND exit_reason = 'STOPPED'
           AND exited_at IS NOT NULL
           AND exited_at >= ${cooldownCutoff.toISOString()}
         ORDER BY exited_at DESC
         LIMIT 1
      `);
      const lastStopRow = (lastStopRows as unknown as {
        rows: Array<{ exited_at: string | Date }>;
      }).rows[0];
      if (lastStopRow) {
        const beforeLots = lots;
        lots = Math.max(1, Math.floor(lots * POST_STOP_COOLDOWN.SIZE_MULT));
        logger.info(
          {
            indexSymbol,
            setupKey,
            tier,
            beforeLots,
            afterLots: lots,
            sizeMult: POST_STOP_COOLDOWN.SIZE_MULT,
            cooldownMinutes: POST_STOP_COOLDOWN.COOLDOWN_MINUTES,
            lastStopAt: lastStopRow.exited_at,
          },
          `Paper FO: post-stop cool-down active — sizing halved`,
        );
      }

      // (2) PORTFOLIO REGIME SCALING: when this signal's regime is
      //     VOLATILE (high realised vol / wide BB but stop envelope
      //     intact), halve size. Stacks multiplicatively with
      //     POST_STOP_COOLDOWN. EXPIRY_DAY is handled at the signal
      //     layer (forced to BASELINE tier) so doesn't need a scale.
      //     `signal.regime` is the per-index regime label from
      //     classifyRegime in optionSignals.ts, surfaced via toSignal.
      const signalRegime = (signal as unknown as { regime?: string }).regime;
      if (signalRegime === "VOLATILE") {
        const beforeLots = lots;
        lots = Math.max(1, Math.floor(lots * REGIME_SIZING.VOLATILE_MULT));
        logger.info(
          {
            indexSymbol,
            setupKey,
            tier,
            beforeLots,
            afterLots: lots,
            sizeMult: REGIME_SIZING.VOLATILE_MULT,
            regime: signalRegime,
          },
          `Paper FO: VOLATILE regime active — sizing halved`,
        );
      }

      // ─── Pass-2B portfolio heat cap (per-segment, segment-scoped) ───
      // Sum of ₹-at-risk across every OPEN position in the F&O book
      // must stay below MAX_FNO_HEAT_PCT × seed. The new trade's
      // contribution = lots × lot_size × perShareLoss. Computed inside
      // the txn so we honour any concurrent close that just freed up
      // heat. FAIL CLOSED — if the projected heat breaches the cap, we
      // do NOT silently shrink the trade, we skip it (the trader can
      // see the missed signal). Shrinking would invalidate the
      // setup's planned RR.
      // Reads via tx.execute so the snapshot honours the account-row
      // FOR UPDATE lock — two parallel opens cannot both pass the cap
      // and then collectively breach it on commit.
      const currentHeat = parseHeatRow(await tx.execute(HEAT_SQL_FNO));
      const newTradeHeat = lots * lotSize * perShareLoss;
      const projectedHeat = currentHeat + newTradeHeat;
      const heatCap = SEED_CAPITAL.FNO * PORTFOLIO_HEAT.MAX_FNO_HEAT_PCT;
      if (projectedHeat > heatCap) {
        if (recordSkip("PORTFOLIO_HEAT")) {
          logger.info(
            {
              indexSymbol,
              setupKey,
              tier,
              currentHeat: +currentHeat.toFixed(2),
              newTradeHeat: +newTradeHeat.toFixed(2),
              projectedHeat: +projectedHeat.toFixed(2),
              heatCap: +heatCap.toFixed(2),
              maxHeatPct: PORTFOLIO_HEAT.MAX_FNO_HEAT_PCT,
            },
            `Paper FO skip: portfolio heat cap would be breached (${(projectedHeat / SEED_CAPITAL.FNO * 100).toFixed(2)}% > ${(PORTFOLIO_HEAT.MAX_FNO_HEAT_PCT * 100).toFixed(2)}%)`,
          );
        }
        return null;
      }

      const capitalDeployed = lots * optionEntry * lotSize;
      if (balance < capitalDeployed) {
        if (recordSkip("INSUFFICIENT_BALANCE")) {
          logger.info(
            { indexSymbol, setupKey, capitalDeployed, balance },
            "Paper FO skip: insufficient balance for premium",
          );
        }
        return null;
      }

      const now = new Date();
      // Insert is still ON CONFLICT DO NOTHING — if a concurrent writer
      // somehow won the (date,idx,setup,dir) race despite our account
      // lock, we discover that here and roll the txn back cleanly.
      const inserted = await tx
        .insert(paperTradeFoTable)
        .values({
          signalDate,
          indexSymbol,
          setupKey,
          direction,
          indexName: signal.indexName,
          optionType: signal.leg.type,
          strike: toDbNumeric(signal.leg.strike, 4),
          lots,
          lotSize,
          entryPremium: toDbNumeric(optionEntry, 4),
          stopPremium: toDbNumeric(optionStop, 4),
          target1Premium: toDbNumeric(optionT1, 4),
          target2Premium: toDbNumeric(optionT2, 4),
          capitalDeployed: toDbNumeric(capitalDeployed, 2),
          lastPremium: toDbNumeric(signal.optionLtp ?? optionEntry, 4),
          openedAt: now,
          lastEvaluatedAt: now,
          status: "OPEN",
        })
        .onConflictDoNothing()
        .returning();
      if (inserted.length === 0) {
        logger.info({ indexSymbol, setupKey }, "Paper FO skip: trade row already exists");
        return null;
      }

      // Atomic debit + counter bumps. Cap predicate repeated as
      // defence-in-depth — even if another path ever holds the account
      // row outside this codepath we still cannot oversize.
      const debited = await tx
        .update(paperAccountTable)
        .set({
          balance: sql`${paperAccountTable.balance} - ${toDbNumeric(capitalDeployed, 2)}::numeric`,
          dayTradeCount: sql`${paperAccountTable.dayTradeCount} + 1`,
          dayOpenCount: sql`${paperAccountTable.dayOpenCount} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(paperAccountTable.segment, "FNO"),
            sql`${paperAccountTable.balance} >= ${toDbNumeric(capitalDeployed, 2)}::numeric`,
            sql`${paperAccountTable.dayTradeCount} < ${FNO_RISK.MAX_TRADES_PER_DAY}`,
          ),
        )
        .returning();
      if (debited.length === 0) {
        // Cap or balance changed under us — abort. Throwing forces the
        // transaction to roll back, which removes the inserted row.
        throw new Error("paper_open_aborted_cap_or_balance");
      }

      logger.info(
        {
          indexSymbol,
          setupKey,
          tier,
          direction,
          lots,
          lotSize,
          capitalDeployed: capitalDeployed.toFixed(2),
          entryPremium: optionEntry,
          stopPremium: optionStop,
          target1Premium: optionT1,
          target2Premium: optionT2,
          confidence,
          maxLossPctPerTrade,
          newBalance: num(debited[0]!.balance),
        },
        `Paper FO OPENED (${tier})`,
      );
      return inserted[0]!;
    });
  } catch (err) {
    if ((err as Error).message === "paper_open_aborted_cap_or_balance") {
      logger.info({ indexSymbol, setupKey }, "Paper FO skip: txn aborted (cap/balance lost the race)");
      return null;
    }
    throw err;
  }
  return openedRow;
}

/**
 * Update the live last-known premium on an open row so we have a fresh
 * value for MTM display and for the EXPIRED close fallback. Also keeps
 * max_runup / max_drawdown in step.
 */
async function markToMarket(input: LifecycleHookInput): Promise<void> {
  const { signal, signalDate, direction } = input;
  const setupKey = signal.setupKey;
  if (!setupKey) return;
  const ltp = signal.optionLtp;
  if (ltp == null) return;

  const row = await db
    .select()
    .from(paperTradeFoTable)
    .where(
      and(
        eq(paperTradeFoTable.signalDate, signalDate),
        eq(paperTradeFoTable.indexSymbol, signal.index),
        eq(paperTradeFoTable.setupKey, setupKey),
        eq(paperTradeFoTable.direction, direction),
        eq(paperTradeFoTable.status, "OPEN"),
      ),
    )
    .limit(1);
  if (row.length === 0) return;
  const r = row[0]!;
  const entry = num(r.entryPremium);
  const upnl = (ltp - entry) * r.lots * r.lotSize;
  await db
    .update(paperTradeFoTable)
    .set({
      lastPremium: toDbNumeric(ltp, 4),
      lastEvaluatedAt: new Date(),
      maxRunup: sql`GREATEST(${paperTradeFoTable.maxRunup}, ${toDbNumeric(upnl, 2)}::numeric)`,
      maxDrawdown: sql`LEAST(${paperTradeFoTable.maxDrawdown}, ${toDbNumeric(upnl, 2)}::numeric)`,
    })
    .where(and(eq(paperTradeFoTable.id, r.id), eq(paperTradeFoTable.status, "OPEN")));
}

export type CloseReason =
  | "TARGET1_HIT"
  | "TARGET2_HIT"
  | "STOPPED"
  | "EXPIRED"
  | "MANUAL_OVERRIDE"
  /** Pass-1 force-exit at 15:20 IST — closes any still-OPEN paper FO trade
   *  before the last-10-min liquidity drop. Settles at lastPremium. */
  | "TIME_EXIT_1520";

/**
 * Reconcile paper_trade_fo rows that are still OPEN despite the
 * underlying option_signal_history row having reached a terminal
 * lifecycle state. This is the safety net the architect surfaced —
 * if `onLifecycleUpsert()` ever crashed (transient DB error, network
 * blip) AFTER the lifecycle row had been advanced past trigger, the
 * paper trade would otherwise stay OPEN until manual intervention
 * because subsequent recordOrUpdate calls short-circuit on
 * `if (row.exitedAt)` and the EOD sweep skips already-exited rows.
 *
 * Called from ensureDailyReset (after the IST midnight refill) and
 * from expireOpenSignalsForToday (after the EOD lifecycle sweep) so
 * orphans get cleaned up at every natural boundary.
 *
 * Mapping is deliberate:
 *   lifecycle TARGET1_HIT  -> paper TARGET1_HIT (settles at T1)
 *   lifecycle TARGET2_HIT  -> paper TARGET2_HIT (settles at T2)
 *   lifecycle STOPPED      -> paper STOPPED     (settles at SL)
 *   lifecycle EXPIRED      -> paper EXPIRED     (settles at lastPremium)
 */
export async function reconcileOrphanedPaperTrades(): Promise<number> {
  // Inline SQL because we need a join across two tables; pulling both
  // sides into JS would race against concurrent writers.
  const orphans = await db.execute(sql`
    SELECT p.id, p.signal_date, p.index_symbol, p.setup_key, p.direction,
           h.status AS lifecycle_status
      FROM paper_trade_fo p
      JOIN option_signal_history h
        ON h.signal_date = p.signal_date
       AND h.index_symbol = p.index_symbol
       AND h.setup_key = p.setup_key
       AND h.direction = p.direction
     WHERE p.status = 'OPEN'
       AND h.exited_at IS NOT NULL
       AND h.status IN ('TARGET1_HIT','TARGET2_HIT','STOPPED','EXPIRED')
  `);
  const rows = (orphans as unknown as {
    rows: Array<{
      id: string;
      signal_date: string;
      index_symbol: string;
      setup_key: string;
      direction: "BULLISH" | "BEARISH";
      lifecycle_status: "TARGET1_HIT" | "TARGET2_HIT" | "STOPPED" | "EXPIRED";
    }>;
  }).rows;
  if (rows.length === 0) return 0;

  let closed = 0;
  for (const r of rows) {
    const reason: CloseReason =
      r.lifecycle_status === "TARGET2_HIT" ? "TARGET2_HIT" :
      r.lifecycle_status === "STOPPED" ? "STOPPED" :
      r.lifecycle_status === "TARGET1_HIT" ? "TARGET1_HIT" :
      "EXPIRED";
    try {
      const out = await closePaperTradeForSignal(
        r.signal_date,
        r.index_symbol,
        r.setup_key,
        r.direction,
        reason,
      );
      if (out) closed++;
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, id: r.id },
        "reconcileOrphanedPaperTrades: close failed for one row, continuing",
      );
    }
  }
  if (closed > 0) {
    logger.info({ closed }, "Reconciled orphaned paper F&O trades against lifecycle");
  }
  return closed;
}

/**
 * Close a paper trade if one is OPEN for this signal. Idempotent — a
 * second call after CLOSED is a no-op. Caller passes the reason; we
 * pick the exit premium from the locked plan (or lastPremium for
 * EXPIRED / MANUAL).
 *
 * Single transaction: trade-row CAS, account credit and counter
 * decrement all commit together. Without this the architect surfaced
 * a real bug — if `credit()` failed after the row was set CLOSED, the
 * account would be permanently short-credited.
 */
export async function closePaperTradeForSignal(
  signalDate: string,
  indexSymbol: string,
  setupKey: string,
  direction: "BULLISH" | "BEARISH",
  reason: CloseReason,
): Promise<PaperTradeFoRow | null> {
  // Read row outside the txn — cheap, and lets us bail early when there
  // is nothing OPEN to close. The CAS inside the txn is what actually
  // protects against double-close races.
  const rows = await db
    .select()
    .from(paperTradeFoTable)
    .where(
      and(
        eq(paperTradeFoTable.signalDate, signalDate),
        eq(paperTradeFoTable.indexSymbol, indexSymbol),
        eq(paperTradeFoTable.setupKey, setupKey),
        eq(paperTradeFoTable.direction, direction),
        eq(paperTradeFoTable.status, "OPEN"),
      ),
    )
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0]!;
  const exitPremium = pickExitPremium(r, reason);
  const proceeds = exitPremium * r.lots * r.lotSize;
  const realizedPnl = proceeds - num(r.capitalDeployed);
  const now = new Date();

  return await db.transaction(async (tx) => {
    const updated = await tx
      .update(paperTradeFoTable)
      .set({
        status: "CLOSED",
        exitedAt: now,
        exitPremium: toDbNumeric(exitPremium, 4),
        exitReason: reason,
        realizedPnl: toDbNumeric(realizedPnl, 2),
        lastPremium: toDbNumeric(exitPremium, 4),
        lastEvaluatedAt: now,
      })
      .where(and(eq(paperTradeFoTable.id, r.id), eq(paperTradeFoTable.status, "OPEN")))
      .returning();
    if (updated.length === 0) {
      // Lost the CAS race — another close already credited the account.
      // Returning null inside a tx that did no other writes is safe; the
      // empty txn commits as a no-op.
      return null;
    }
    await tx
      .update(paperAccountTable)
      .set({
        balance: sql`${paperAccountTable.balance} + ${toDbNumeric(proceeds, 2)}::numeric`,
        dayRealizedPnl: sql`${paperAccountTable.dayRealizedPnl} + ${toDbNumeric(realizedPnl, 2)}::numeric`,
        dayOpenCount: sql`GREATEST(${paperAccountTable.dayOpenCount} - 1, 0)`,
        updatedAt: now,
      })
      .where(eq(paperAccountTable.segment, "FNO"));
    logger.info(
      {
        id: r.id,
        indexSymbol,
        setupKey,
        direction,
        reason,
        lots: r.lots,
        entry: num(r.entryPremium),
        exit: exitPremium,
        realizedPnl: realizedPnl.toFixed(2),
      },
      "Paper FO CLOSED",
    );
    return updated[0]!;
  });
}

function pickExitPremium(r: PaperTradeFoRow, reason: CloseReason): number {
  switch (reason) {
    case "TARGET1_HIT":
      return num(r.target1Premium);
    case "TARGET2_HIT":
      return num(r.target2Premium);
    case "STOPPED":
      return num(r.stopPremium);
    case "EXPIRED":
    case "MANUAL_OVERRIDE":
    case "TIME_EXIT_1520":
    default:
      return num(r.lastPremium);
  }
}

/**
 * Pass-1 15:20 IST force-exit. Closes every still-OPEN paper F&O trade
 * at lastPremium with reason `TIME_EXIT_1520`. Idempotent — once a row
 * is CLOSED the subsequent call is a no-op (selectOpen + per-row CAS).
 *
 * Called from the existing 30s `getOptionSignals` interval in
 * `optionSignals.ts` once IST time crosses 15:20. The natural side
 * effect of the close (status='OPEN' → 'CLOSED') ensures subsequent
 * ticks find an empty set and no-op cheaply.
 *
 * Returns the count of trades actually closed by this call.
 */
export async function forceCloseAllOpenFnoFor1520(): Promise<number> {
  const openRows = await db
    .select({
      signalDate: paperTradeFoTable.signalDate,
      indexSymbol: paperTradeFoTable.indexSymbol,
      setupKey: paperTradeFoTable.setupKey,
      direction: paperTradeFoTable.direction,
    })
    .from(paperTradeFoTable)
    .where(eq(paperTradeFoTable.status, "OPEN"));
  if (openRows.length === 0) return 0;
  let closed = 0;
  for (const r of openRows) {
    try {
      const out = await closePaperTradeForSignal(
        r.signalDate,
        r.indexSymbol,
        r.setupKey,
        r.direction as "BULLISH" | "BEARISH",
        "TIME_EXIT_1520",
      );
      if (out) closed++;
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, indexSymbol: r.indexSymbol, setupKey: r.setupKey },
        "forceCloseAllOpenFnoFor1520: close failed for one row, continuing",
      );
    }
  }
  if (closed > 0) {
    logger.info({ closed }, "Paper FO 15:20 force-exit completed");
  }
  return closed;
}

/**
 * Catch-up reconciliation: find today's triggered lifecycle rows that
 * have NO matching paper_trade_fo row, and retroactively open (and,
 * if the lifecycle already exited, close) them. Runs once per server
 * instance on the first lifecycle hook call, so a restart mid-day
 * never silently drops trades.
 */
export async function reconcileMissingPaperTrades(): Promise<number> {
  // Read-only-mode short-circuit. When PAPER_TRADING_ENABLED is off
  // (dev/preview default) we never open new rows, including via the
  // mid-day reconciliation backfill. Production deployments leave the
  // flag on and behave exactly as before.
  if (!isPaperAutoTradingEnabled()) return 0;

  // No global activeProvider() gate. The previous version short-circuited
  // here whenever the Kite WebSocket had not yet received its first tick
  // (liveQuotes === 0), which silently skipped backfill on a mid-day
  // restart. The lifecycle rows we're reconciling were created by an
  // earlier cycle that already verified data quality at write time, and
  // openPaperTrade still enforces premium validation, market-open, the
  // daily cap, and consecutive-stops checks — so removing this top-level
  // gate cannot introduce trades against bad data.

  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const today = ist.toISOString().slice(0, 10);

  const result = await db.execute(sql`
    SELECT h.signal_date, h.index_symbol, h.index_name, h.setup_key, h.direction,
           h.option_type, h.strike, h.entry, h.stop_loss, h.target1, h.target2,
           h.option_entry, h.option_stop_loss, h.option_target1, h.option_target2,
           h.confidence, h.status AS lifecycle_status, h.tier AS persisted_tier
      FROM option_signal_history h
      LEFT JOIN paper_trade_fo p
        ON p.signal_date = h.signal_date
       AND p.index_symbol = h.index_symbol
       AND p.setup_key    = h.setup_key
       AND p.direction     = h.direction
     WHERE h.signal_date   = ${today}
       AND h.triggered_at IS NOT NULL
       AND p.id IS NULL
       AND h.exited_at IS NULL
  `);
  // Reconcile is intentionally restricted to LIVE (not-yet-exited)
  // lifecycle rows. Backfilling already-stopped signals would record
  // phantom losses for trades we never actually had a chance to take —
  // and on a deploy mid-day right after a market reversal, that can
  // produce a misleading "every trade is a stop" picture on the paper
  // book. We DO catch up live triggers (so a deploy doesn't drop them)
  // for both STANDARD and BASELINE setups; the previous BASELINE
  // exclusion was an artefact of the old "BASELINE = informational
  // only" model and is no longer correct now that BASELINE is an
  // actual auto-trade lane.
  const rows = (result as unknown as {
    rows: Array<{
      signal_date: string;
      index_symbol: string;
      index_name: string;
      setup_key: string;
      direction: string;
      option_type: string;
      strike: string;
      entry: string;
      stop_loss: string;
      target1: string;
      target2: string;
      option_entry: string | null;
      option_stop_loss: string | null;
      option_target1: string | null;
      option_target2: string | null;
      confidence: number;
      lifecycle_status: string;
      persisted_tier: string | null;
    }>;
  }).rows;
  if (rows.length === 0) return 0;

  let opened = 0;
  for (const r of rows) {
    const optEntry = num(r.option_entry);
    const optStop = num(r.option_stop_loss);
    if (!optEntry || !optStop) continue;

    const dir: "BULLISH" | "BEARISH" =
      r.direction === "BEARISH" ? "BEARISH" : "BULLISH";
    const syntheticSignal = {
      index: r.index_symbol,
      indexName: r.index_name,
      setupKey: r.setup_key,
      confidence: r.confidence,
      optionEntry: optEntry,
      optionLtp: optEntry,
      optionStopLoss: optStop,
      optionTarget1: num(r.option_target1) || optEntry,
      optionTarget2: num(r.option_target2) || num(r.option_target1) || optEntry,
      bias: r.direction,
      leg: {
        type: r.option_type,
        strike: num(r.strike),
        entry: num(r.entry),
        stopLoss: num(r.stop_loss),
        target1: num(r.target1),
        target2: num(r.target2),
      },
    } as unknown as OptionSignal;

    try {
      // Tier the synthetic open the same way the in-cycle path does:
      // BASELINE setups go through the conservative lane (1% loss cap,
      // 55 conf floor); everything else uses STANDARD.
      //
      // Pass-2A fix (HIGH): prefer the PERSISTED tier from
      // option_signal_history when present. A vol-clamped HC setup
      // (Pass-2A) is emitted as `tier="BASELINE"` and persisted as such
      // by the lifecycle insert; if reconciliation derived tier from
      // `setup_key` alone, that would silently re-promote it back to
      // STANDARD here (defeating the whole soft-demote). Fall back to
      // the setup_key heuristic only for legacy null rows.
      const tier: TradeTier =
        r.persisted_tier === "BASELINE"
          ? "BASELINE"
          : r.persisted_tier === "HIGH_CONVICTION"
            ? "STANDARD"
            : r.setup_key === "BASELINE"
              ? "BASELINE"
              : "STANDARD";
      const trade = await openPaperTrade({
        prev: null,
        next: "TRIGGERED",
        exited: false,
        signal: syntheticSignal,
        signalDate: r.signal_date,
        direction: dir,
        tier,
      });
      if (trade) opened++;
      // No close branch here: we filter to exited_at IS NULL above, so
      // every reconciled row is a still-live trigger that the running
      // lifecycle hook will close naturally when its target/stop hits.
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, idx: r.index_symbol, setup: r.setup_key },
        "reconcileMissingPaperTrades: open failed for one row, continuing",
      );
    }
  }
  if (opened > 0) {
    logger.info({ opened, checked: rows.length }, "Reconciled missing paper F&O trades");
  }
  return opened;
}

let didStartupReconcile = false;

/**
 * Single entry point invoked by the option signal lifecycle library
 * after every successful upsert. Quiet on failure — never throws.
 *
 * IMPORTANT: this hook fires BEFORE option-premium enrichment, so
 * signal.optionEntry etc. are still undefined here. It must NOT
 * attempt to open paper trades (which need premiums). Opens are
 * handled by `tryOpenPaperTrades()` which runs AFTER enrichment
 * in the signal cycle.  This hook only does MTM + close.
 */
export async function onLifecycleUpsert(input: LifecycleHookInput): Promise<void> {
  try {
    const { next, exited } = input;

    // Always mark-to-market — this also records max_runup / max_drawdown.
    await markToMarket(input);

    // Did the lifecycle just record an exit?
    if (exited) {
      const reason: CloseReason =
        next === "TARGET2_HIT" ? "TARGET2_HIT" :
        next === "STOPPED" ? "STOPPED" :
        next === "TARGET1_HIT" ? "TARGET1_HIT" :
        "EXPIRED";
      await closePaperTradeForSignal(
        input.signalDate,
        input.signal.index,
        input.signal.setupKey ?? "",
        input.direction,
        reason,
      );
    }
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, idx: input.signal.index, setup: input.signal.setupKey },
      "Paper FO lifecycle hook failed",
    );
  }
}

/**
 * Post-enrichment paper trade opener.  Called from the signal cycle
 * AFTER `enrichBundlesWithOptionLevels()` has populated option
 * premiums on every signal.  For each signal that is past trigger,
 * idempotently opens a paper trade (existing-row short-circuit makes
 * repeated calls harmless).
 *
 * Also runs the one-time startup reconciliation on first invocation
 * so any signals that triggered AND exited while the server was down
 * get retroactively created + closed.
 */
/**
 * In-memory ring buffer of signals we observed AFTER they had already
 * terminated (exitedAt set on first sight, no OPEN row to close).
 *
 * We deliberately do NOT auto-open these as paper trades — that would
 * create phantom same-cycle open+close rows and consume daily-cap slots
 * for opportunities the system never actually had a chance to take.
 * But we DO need visibility into them so the owner can see how many
 * signals slip through due to system-side latency (signal cycles every
 * 30s; a fast-moving setup like a small-cap CE on a gap-up day can
 * trigger and hit T2 in the same bar).
 *
 * Capped to MAX_MISSED so a runaway day cannot grow this unbounded.
 */
/**
 * Why the engine declined to open this trade.
 *
 *   MISSED_WINDOW       — signal was already exited when first observed
 *                         (terminal status arrived inside one polling
 *                         cycle), so opening + immediately closing
 *                         would be a phantom trade.
 *   DATA_QUALITY_DELAYED — Signal carried DELAYED_YAHOO data quality
 *                         (HARD-REFUSED since 2026-05-06: PAPER_TRADE_ALLOW_YAHOO
 *                         override removed entirely. With the upstream
 *                         optionSignals.ts now strictly Kite-gated this
 *                         skip should never fire on the F&O hot path.)
 *   DATA_QUALITY_STALE  — bars older than the Kite 15-min freshness floor.
 *   CONFIDENCE_FLOOR    — confidence was below the tier's MIN floor
 *                         (BASELINE 55 / STANDARD 70).
 */
/**
 * Why the engine declined to open a trade. Every silent rejection in
 * `openPaperTrade` is mirrored to a SkipReason so the audit panel can
 * show the *terminal* reason for every signal observed this session.
 *
 * Names mirror the pro-trader audit categories (NO_TRADE_*) but stay
 * compact for table display. Categorised:
 *
 *   Data feed:       DATA_QUALITY_DELAYED, DATA_QUALITY_STALE
 *   Anti-phantom:    MISSED_WINDOW
 *   Confidence:      CONFIDENCE_FLOOR
 *   Time / market:   MARKET_CLOSED, TIME_FILTER_LATE, BASELINE_LATE
 *   Liquidity:       LIQUIDITY_LTP, LIQUIDITY_SPREAD, LIQUIDITY_OI, LIQUIDITY_CHAIN_MISSING
 *   Risk plan:       INVALID_PREMIUM_PLAN
 *   Daily caps:      DAILY_TRADE_CAP, BASELINE_DAILY_CAP, CONSECUTIVE_STOPS,
 *                    BASELINE_CONSECUTIVE_LOSSES
 *   Drawdown caps:   DAILY_DD_CAP, WEEKLY_DD_CAP, BASELINE_DAILY_DD_CAP
 *   Heat / sizing:   PORTFOLIO_HEAT, BUDGET_TOO_TIGHT, INSUFFICIENT_BALANCE
 */
export type SkipReason =
  | "MISSED_WINDOW"
  | "DATA_QUALITY_DELAYED"
  | "DATA_QUALITY_STALE"
  | "CONFIDENCE_FLOOR"
  | "MARKET_CLOSED"
  | "TIME_FILTER_LATE"
  | "BASELINE_LATE"
  | "LIQUIDITY_LTP"
  | "LIQUIDITY_SPREAD"
  | "LIQUIDITY_OI"
  | "LIQUIDITY_CHAIN_MISSING"
  | "INVALID_PREMIUM_PLAN"
  | "DAILY_TRADE_CAP"
  | "BASELINE_DAILY_CAP"
  | "CONSECUTIVE_STOPS"
  | "BASELINE_CONSECUTIVE_LOSSES"
  | "DAILY_DD_CAP"
  | "WEEKLY_DD_CAP"
  | "BASELINE_DAILY_DD_CAP"
  | "BASELINE_GUARDRAIL_STATS_UNAVAILABLE"
  | "PORTFOLIO_HEAT"
  | "BUDGET_TOO_TIGHT"
  | "INSUFFICIENT_BALANCE";

export interface MissedSignal {
  signalDate: string;
  indexSymbol: string;
  indexName: string;
  setupKey: string;
  direction: "BULLISH" | "BEARISH";
  confidence: number;
  tier: TradeTier;
  status: LifecycleStatus;
  /** Lifecycle terminal reason (TARGET2_HIT/STOPPED/etc) when known. Null
   *  when the signal was skipped pre-execution (e.g. confidence floor). */
  reason: CloseReason | null;
  /** Why the engine declined to open. See SkipReason. */
  skipReason: SkipReason;
  /** Data-quality label at the moment of skip (LIVE_KITE_*, DELAYED_YAHOO,
   *  STALE, UNKNOWN). Surfaced in the UI so the owner can correlate
   *  Kite-outage windows with would-be trades. */
  dataQuality: string;
  optionEntry: number | null;
  optionStop: number | null;
  optionTarget1: number | null;
  optionTarget2: number | null;
  observedAt: Date;
}

const MAX_MISSED = 200;
const missedRing: MissedSignal[] = [];
const missedSeen = new Set<string>();

function missedKey(
  m: Pick<MissedSignal, "signalDate" | "indexSymbol" | "setupKey" | "direction" | "skipReason">,
): string {
  // Include skipReason so a signal that first hit the confidence floor
  // and later hit the missed-window race shows up as two distinct rows
  // (different operational stories for the owner).
  return `${m.signalDate}|${m.indexSymbol}|${m.setupKey}|${m.direction}|${m.skipReason}`;
}

/** Returns true iff this is the first time we've recorded this key. */
function recordMissedSignal(m: MissedSignal): boolean {
  const k = missedKey(m);
  if (missedSeen.has(k)) return false;
  missedSeen.add(k);
  missedRing.push(m);
  if (missedRing.length > MAX_MISSED) {
    const dropped = missedRing.shift();
    if (dropped) missedSeen.delete(missedKey(dropped));
  }
  return true;
}

/** Newest-first list of missed signals (read-only copy). */
export function getMissedSignals(): MissedSignal[] {
  return [...missedRing].reverse();
}

/* ───────────────── Operational alerts (2026-05-11.d) ───────────────── */

/** Process-level counter for BASELINE_GUARDRAIL_STATS_UNAVAILABLE events.
 *  Surfaced via the daily-summary endpoint so the owner sees fail-closed
 *  outages explicitly rather than implicitly via the missed-signals ring. */
let baselineStatsUnavailableAlertCount = 0;
let baselineStatsUnavailableLastAt: Date | null = null;

export interface PaperOperationalAlerts {
  baselineStatsUnavailable: {
    count: number;
    lastAt: string | null;
  };
}

export function getOperationalAlerts(): PaperOperationalAlerts {
  return {
    baselineStatsUnavailable: {
      count: baselineStatsUnavailableAlertCount,
      lastAt: baselineStatsUnavailableLastAt
        ? baselineStatsUnavailableLastAt.toISOString()
        : null,
    },
  };
}

export async function tryOpenPaperTrades(
  signals: OptionSignal[],
  signalDate: string,
): Promise<void> {
  if (!didStartupReconcile) {
    didStartupReconcile = true;
    try {
      await reconcileMissingPaperTrades();
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "Startup paper trade reconciliation failed");
    }
  }

  // No global activeProvider() short-circuit here. The previous check
  // — "skip ALL unless activeProvider() === 'kite'" — gated on whether
  // the Kite WebSocket had received at least one tick (liveQuotes > 0).
  // That conflated "no live ticks yet" with "no Kite data available",
  // so a slow tick burst at open suppressed every trade for the day
  // even when getHistoricalData was returning fresh bars and signals
  // had dataQuality === LIVE_KITE_PARTIAL.
  //
  // Per-signal `dataQuality` is the accurate gate (and is already
  // checked below via isActionableForFno) — it reflects whether THIS
  // signal's intraday bar source was actually live Kite vs Yahoo.

  for (const signal of signals) {
    const quality = signal.dataQuality as DataQualityLabel | undefined;
    if (!quality || !isActionableForFno(quality)) {
      const skipReason: SkipReason =
        quality === "STALE" ? "DATA_QUALITY_STALE" : "DATA_QUALITY_DELAYED";
      const dir: "BULLISH" | "BEARISH" =
        signal.bias === "BEARISH" ? "BEARISH" : "BULLISH";
      const tierForSkip: TradeTier =
        signal.tier === "BASELINE" ? "BASELINE" : "STANDARD";
      const newlyRecorded = recordMissedSignal({
        signalDate,
        indexSymbol: signal.index,
        indexName: signal.indexName ?? signal.index,
        setupKey: signal.setupKey ?? "",
        direction: dir,
        confidence: Math.round(signal.confidence ?? 0),
        tier: tierForSkip,
        status: (signal.status as LifecycleStatus | undefined) ?? "TRIGGERED",
        reason: null,
        skipReason,
        dataQuality: quality ?? "UNKNOWN",
        optionEntry: signal.optionEntry ?? signal.optionLtp ?? null,
        optionStop: signal.optionStopLoss ?? null,
        optionTarget1: signal.optionTarget1 ?? null,
        optionTarget2: signal.optionTarget2 ?? null,
        observedAt: new Date(),
      });
      if (newlyRecorded) {
        logger.info(
          { index: signal.index, setupKey: signal.setupKey, dataQuality: quality ?? "UNKNOWN", skipReason },
          "Paper FO skip: signal data quality is not actionable (delayed/stale source)",
        );
      }
      continue;
    }

    // BASELINE signals get the conservative auto-trade lane (1% loss
    // cap, 55 conf floor) instead of being silently dropped. They share
    // the same daily cap as STANDARD trades so total exposure is
    // unchanged regardless of mix.
    const tier: TradeTier = signal.tier === "BASELINE" ? "BASELINE" : "STANDARD";

    const direction: "BULLISH" | "BEARISH" =
      signal.bias === "BEARISH" ? "BEARISH" : "BULLISH";
    const status = signal.status as LifecycleStatus | undefined;
    if (!status || !PAST_TRIGGER.includes(status)) continue;

    // Already-exited signal handling. Two cases:
    //
    //   (a) We DID open this trade earlier in this session, but the
    //       lifecycle close hook never fired (server restart / crash
    //       between TRIGGERED and the exit-bar evaluation). In that
    //       case there's still an OPEN paper_trade_fo row that needs
    //       to be CLOSED so the day's KPIs and the heat indicator stay
    //       honest. closePaperTradeForSignal() short-circuits to null
    //       when no OPEN row matches, so it's safe to call
    //       unconditionally.
    //
    //   (b) We never opened it (deploy mid-day right after the stop
    //       hit). The close call above is a no-op, and we MUST NOT
    //       open + immediately close — that would record a phantom
    //       loss for a slot we never actually held and consume one of
    //       the 4 daily-cap slots that the running server still has
    //       left to use on real opportunities.
    //
    // Either way: never fall through to openPaperTrade for an
    // already-exited signal.
    if (signal.exitedAt) {
      const reason: CloseReason =
        status === "TARGET2_HIT" ? "TARGET2_HIT" :
        status === "STOPPED" ? "STOPPED" :
        status === "TARGET1_HIT" ? "TARGET1_HIT" :
        "EXPIRED";
      const closed = await closePaperTradeForSignal(
        signalDate,
        signal.index,
        signal.setupKey ?? "",
        direction,
        reason,
      );
      if (closed != null) {
        // We HAD an OPEN row and just closed it (lifecycle missed
        // during downtime). Always log this — it's a real
        // state-reconciliation event, not a high-frequency miss.
        logger.info(
          { index: signal.index, setupKey: signal.setupKey, status, closedExistingOpenRow: true },
          "Paper FO: closed orphaned OPEN row for already-exited signal (lifecycle missed during downtime)",
        );
      } else {
        // We genuinely never opened this. Record once in the missed-
        // trades ring buffer so the owner can see what slipped through
        // due to system-side latency. Anti-phantom rule still applies —
        // we don't open + immediately close — but the owner now has
        // visibility into "would-be" P&L. Gate the INFO log on the
        // first record so the same MIDCPNIFTY missed-window doesn't
        // spam the log every poll cycle for the rest of the session.
        const newlyRecorded = recordMissedSignal({
          signalDate,
          indexSymbol: signal.index,
          indexName: signal.indexName ?? signal.index,
          setupKey: signal.setupKey ?? "",
          direction,
          confidence: Math.round(signal.confidence ?? 0),
          tier,
          status,
          reason,
          skipReason: "MISSED_WINDOW",
          dataQuality: (signal.dataQuality as string | undefined) ?? "UNKNOWN",
          optionEntry: signal.optionEntry ?? signal.optionLtp ?? null,
          optionStop: signal.optionStopLoss ?? null,
          optionTarget1: signal.optionTarget1 ?? null,
          optionTarget2: signal.optionTarget2 ?? null,
          observedAt: new Date(),
        });
        if (newlyRecorded) {
          logger.info(
            { index: signal.index, setupKey: signal.setupKey, status, closedExistingOpenRow: false },
            "Paper FO skip: signal already exited and we never opened it (missed entry window)",
          );
        }
      }
      continue;
    }

    try {
      await openPaperTrade({
        prev: null,
        next: status,
        exited: false,
        signal,
        signalDate,
        direction,
        tier,
      });
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, idx: signal.index, setup: signal.setupKey },
        "Paper FO post-enrichment open failed",
      );
    }
  }
}
