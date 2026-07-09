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
  optionSignalHistoryTable,
} from "@workspace/db";
import type { PaperTradeFoRow } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { isPaperAutoTradingEnabled } from "./paperAutoTradeFlag";
import { alertFnoTradeableSignal, alertFnoExitSignal } from "./fnoSignalAlerts";
import { isSignalHygieneV2Enabled } from "./signalHygieneFlag";
import {
  isAutoTradeableSizingTier,
  assertTradeableForOpen,
  deriveTradeClass,
} from "./optionSignalVetoes";
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
import { computeFnoLotSizing } from "./fnoSizingHelper";
import { fetchOptionChain, LOT_SIZES, type OcResponse } from "./optionChain";
import { getCachedLotSizeForIndex } from "./kiteFnoInstruments";
// Type-only: does not create a runtime import of fnoExitDecision.ts at
// module load time (the runtime import is dynamic, inside
// evaluateOrphanedOpenTrades, to match this file's existing lazy-import
// convention for optionSignalLifecycle).
import type { FnoExitQuoteProvenance, FnoExitDecision } from "./fnoExitDecision";
import type { FnoExitMonitorCycleAccumulator } from "./fnoExitMonitorHealth";
import {
  buildOptionChainProvenance,
  type OcSourceProvider,
} from "./marketData/optionChainProvenance";
import {
  captureExitMarketPremium,
  applyMarketShadowToDb,
} from "./fnoMarketShadowCapture";
import { logger } from "./logger";
import { computeMarketStatus } from "./marketEvents";
import { isActionableForFno, type DataQualityLabel } from "./tradingConfig";
import {
  logFnoReasoning,
  type FnoReasoningDecision,
} from "./fnoSignalReasoningLogger";
import {
  evaluateFnoPaperRiskGuards,
  FNO_GUARD_CONFIG,
  type RecentStoppedTrade,
} from "./fnoPaperRiskGuards";

/**
 * Risk tier for an auto-opened paper trade.
 *   STANDARD — high-conviction detector (trend_continuation, vwap_reclaim,
 *              volume_breakout, ema_pullback, mean_reversion). Uses
 *              FNO_RISK budgets (2% loss cap, 65 conf floor —
 *              FNO_RISK.MIN_CONFIDENCE === CONFIDENCE_THRESHOLDS.MIN_FNO_TRADE).
 *   BASELINE — always-on directional outlook (tier="BASELINE"). Uses
 *              FNO_BASELINE_RISK budgets (0.5% loss cap / 0.25% micro, 55 conf floor).
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

/**
 * Forward premium-path watermark set-fragment for the MTM sweep (P5, 2026-06-10).
 *
 * Records the OPTION PREMIUM's high/low watermark observed AFTER entry plus the
 * instant (DB `now()`, i.e. UTC) each watermark was set. COALESCE seeds the
 * first observation; GREATEST/LEAST keep each watermark monotone and make the
 * update idempotent (re-applying the same ltp is a no-op); the timestamp only
 * advances when a strictly new watermark is established. These additive nullable
 * columns let the cockpit later derive a TRUE premium-path MFE/MAE for trades
 * opened from this point on. Pre-change rows stay NULL — honestly unavailable,
 * never backfilled, never fabricated.
 */
export function premiumPathWatermarkSet(ltp: number) {
  const v = toDbNumeric(ltp, 2);
  return {
    highestPremiumAfterEntry: sql`GREATEST(COALESCE(${paperTradeFoTable.highestPremiumAfterEntry}, ${v}::numeric), ${v}::numeric)`,
    highestPremiumAt: sql`CASE WHEN ${paperTradeFoTable.highestPremiumAfterEntry} IS NULL OR ${v}::numeric > ${paperTradeFoTable.highestPremiumAfterEntry} THEN now() ELSE ${paperTradeFoTable.highestPremiumAt} END`,
    lowestPremiumAfterEntry: sql`LEAST(COALESCE(${paperTradeFoTable.lowestPremiumAfterEntry}, ${v}::numeric), ${v}::numeric)`,
    lowestPremiumAt: sql`CASE WHEN ${paperTradeFoTable.lowestPremiumAfterEntry} IS NULL OR ${v}::numeric < ${paperTradeFoTable.lowestPremiumAfterEntry} THEN now() ELSE ${paperTradeFoTable.lowestPremiumAt} END`,
  };
}

/**
 * Resolves the canonical lot size for the given index.
 *
 * Source priority:
 *   1. Kite instrument master (via getCachedLotSizeForIndex — synchronous if
 *      the instruments cache was warmed by a prior sweep, which is the normal
 *      production path). contractGrade = "instrument_master".
 *   2. Static LOT_SIZES fallback when the cache is cold (early startup, Kite
 *      offline). contractGrade = "static_fallback". Drift alarm fires when the
 *      static value differs from what the master last reported.
 *
 * Static map must NEVER silently override the master — master wins whenever
 * the cache is warm. Historical rows are not rewritten.
 */
function lotSizeFor(indexSymbol: string): number | null {
  const sym = indexSymbol.toUpperCase();
  const masterLotSize = getCachedLotSizeForIndex(sym);
  if (masterLotSize != null) {
    const staticLotSize = LOT_SIZES[sym];
    if (staticLotSize != null && masterLotSize !== staticLotSize) {
      logger.warn(
        { sym, masterLotSize, staticLotSize },
        "LOT_SIZE_DRIFT: Kite instrument master lot size differs from static map — static map is stale; using master",
      );
    }
    return masterLotSize;
  }
  const staticLotSize = LOT_SIZES[sym];
  if (staticLotSize && staticLotSize > 0) {
    logger.info(
      { sym, staticLotSize },
      "lotSizeFor: Kite instrument cache cold; using static fallback (contractGrade=static_fallback)",
    );
    return staticLotSize;
  }
  return null;
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

  // 2026-06-10 (P1): explicit fail-closed tradeability assertion — the single
  // authoritative FIRST gate, pure-evaluated and unit-tested in isolation
  // (assertTradeableForOpen in optionSignalVetoes.ts). Defense-in-depth ON TOP
  // OF the individual gates below: it refuses to open unless the signal is
  // genuinely TRADEABLE (auto-tradeable sizing tier AND tradeClass==='TRADEABLE'
  // under hygiene v2), carries NO recovery/chase veto, and rests on Kite-trusted
  // premium — returning a precise structured reason. The per-gate checks below
  // are KEPT as secondary nets with richer per-reason logging; mapping a veto to
  // INFO_ONLY_NOT_TRADEABLE keeps the missed-signal wire enum stable.
  const eligibility = assertTradeableForOpen({
    sizingTier: tier,
    tradeClass: signal.tradeClass ?? null,
    premiumTrusted: signal.premiumTrusted ?? null,
    tags: signal.tags ?? null,
    hygieneEnabled: isSignalHygieneV2Enabled(),
  });
  if (!eligibility.trade_open_allowed) {
    const skip: SkipReason =
      eligibility.reason === "PREMIUM_UNTRUSTED"
        ? "PREMIUM_UNTRUSTED"
        : "INFO_ONLY_NOT_TRADEABLE";
    if (recordSkip(skip)) {
      logger.info(
        {
          indexSymbol,
          setupKey,
          tier,
          confidence,
          tradeClass: signal.tradeClass ?? null,
          blockReason: eligibility.reason,
          detail: eligibility.detail,
          premiumSource: signal.premiumSource ?? null,
        },
        `Paper FO skip: tradeability gate refused open (${eligibility.reason})`,
      );
    }
    return null;
  }

  // 2026-06-09 hygiene v2: BASELINE (and any non-STANDARD demoted/vetoed)
  // signals are strictly INFO_ONLY — the auto-trader refuses to open them,
  // so they never enter the heat budget, the daily cap, the circuit
  // breaker, or the win-rate sample. The legacy BASELINE lane below is
  // left intact and reachable only when the flag is OFF (rollback).
  if (!isAutoTradeableSizingTier(tier, isSignalHygieneV2Enabled())) {
    if (recordSkip("INFO_ONLY_NOT_TRADEABLE")) {
      logger.info(
        { indexSymbol, setupKey, tier, confidence },
        "Paper FO skip: INFO_ONLY (non-STANDARD tier not auto-tradeable under hygiene v2)",
      );
    }
    return null;
  }

  // Premium-provenance backstop (owner policy 2026-06-10, fail-closed).
  // enrichBundlesWithOptionLevels() stamps `premiumTrusted` from the option
  // chain's source: TRUE only for a complete, non-stale, non-expired Kite
  // chain. The open path sizes the trade (entry/stop/target) off that
  // premium, so an open is permitted ONLY when premium is explicitly
  // Kite-trusted. Anything else — NSE-direct/Yahoo fallback, unknown source,
  // stale, missing chain, or a signal that somehow reached open unenriched
  // (premiumTrusted === undefined) — is refused with an exact reason. This
  // is defense-in-depth: Phase 2 already demotes such signals to INFO_ONLY,
  // but the open path gates on sizing tier, not tradeClass, so this explicit
  // assertion is what guarantees no untrusted option premium ever opens a
  // paper trade.
  if (signal.premiumTrusted !== true) {
    if (recordSkip("PREMIUM_UNTRUSTED")) {
      logger.info(
        {
          indexSymbol,
          setupKey,
          tier,
          confidence,
          premiumSource: signal.premiumSource ?? null,
          premiumWarning: signal.premiumWarning ?? null,
        },
        "Paper FO skip: option premium is not Kite-trusted (fail-closed)",
      );
    }
    return null;
  }

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

  // ─── F&O Paper Risk Guards ─────────────────────────────────────────────
  // Evaluates DTE/theta, low-premium, re-entry cooldown, and SENSEX-disable
  // guards based on replay-diagnostics evidence. Shadow mode (default): never
  // blocks, only logs what would have been blocked. Paper-block mode: blocks
  // the open when a hard-block guard fires. Does NOT change signal scoring.
  {
    const guardInput = {
      underlying: indexSymbol as "NIFTY" | "BANKNIFTY" | "SENSEX",
      direction: direction as "BULLISH" | "BEARISH",
      optionType: signal.leg.type as "CALL" | "PUT",
      strike: signal.leg.strike,
      entryPremium: optionEntry,
      entryTime: new Date().toISOString(),
      expiry: signal.leg.expiry ?? null,
      pricingMode: null,
      setupKey: setupKey,
      setupName: signal.setupName ?? null,
      candidateTier: tier,
      premiumTrusted: signal.premiumTrusted ?? null,
      expectedGrossEdge: null,
      estimatedCosts: null,
    };

    // Load recent STOPPED trades for cooldown check (last 90 min window).
    const cooldownWindowMs = FNO_GUARD_CONFIG.sameStrikeStopCooldown.minutes * 60_000;
    const cooldownCutoff = new Date(Date.now() - cooldownWindowMs);
    let recentStoppedTrades: RecentStoppedTrade[] = [];
    try {
      const recentRows = await db
        .select({
          indexSymbol: paperTradeFoTable.indexSymbol,
          direction: paperTradeFoTable.direction,
          optionType: paperTradeFoTable.optionType,
          strike: paperTradeFoTable.strike,
          exitedAt: paperTradeFoTable.exitedAt,
          exitReason: paperTradeFoTable.exitReason,
        })
        .from(paperTradeFoTable)
        .where(
          and(
            eq(paperTradeFoTable.exitReason, "STOPPED"),
            sql`${paperTradeFoTable.exitedAt} >= ${cooldownCutoff}`,
          ),
        )
        .limit(50);
      recentStoppedTrades = recentRows
        .filter((r) => r.strike !== null && r.optionType !== null && r.exitedAt !== null)
        .map((r) => ({
          underlying: r.indexSymbol,
          direction: r.direction,
          optionType: r.optionType!,
          strike: Number(r.strike),
          exitTime:
            r.exitedAt instanceof Date
              ? r.exitedAt.toISOString()
              : String(r.exitedAt),
          exitReason: r.exitReason ?? "STOPPED",
        }));
    } catch (err) {
      // Fail-open: cooldown check skipped if DB query fails.
      logger.warn(
        { indexSymbol, setupKey, err: (err as Error).message },
        "Paper FO risk guard: recent-stops query failed (cooldown check skipped)",
      );
    }

    const guardDecision = evaluateFnoPaperRiskGuards(
      guardInput,
      recentStoppedTrades,
      FNO_GUARD_CONFIG,
    );

    if (guardDecision.reasons.length > 0) {
      logger.info(
        {
          indexSymbol,
          setupKey,
          mode: FNO_GUARD_CONFIG.mode,
          allowed: guardDecision.allowed,
          severity: guardDecision.severity,
          reasons: guardDecision.reasons,
          metrics: guardDecision.metrics,
        },
        `Paper FO risk guard: ${guardDecision.allowed ? "ALLOWED" : "BLOCKED"} (${FNO_GUARD_CONFIG.mode})`,
      );
    }

    if (!guardDecision.allowed) {
      if (recordSkip("PAPER_RISK_GUARD_BLOCKED")) {
        // Already logged above.
      }
      return null;
    }
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

      // ─── Dynamic lot sizing (OWNER-APPROVED 2026-06-11) ──────────────
      // Risk base = availableCash (paper_account.balance), NOT the seed.
      // PAPER_FIXED_LOTS is now a CEILING only, not a verbatim lot count:
      //   riskPerLot         = |entry − stop| × lotSize
      //   perTradeRiskBudget = availableCash × maxLossPctPerTrade
      //   heatCap            = availableCash × MAX_FNO_HEAT_PCT
      //   byTradeRisk        = floor(perTradeRiskBudget / riskPerLot)
      //   byHeat             = floor((heatCap − currentHeat) / riskPerLot)
      //   finalLots          = min(byTradeRisk, byHeat, ceiling)
      // `maxLossPctPerTrade` is already tier-aware (STANDARD 2 % vs the
      // sub-tiered BASELINE 0.25/0.5/2 %), so BASELINE naturally sizes
      // smaller; the ceiling only caps the absolute upside per index and
      // now applies to BOTH tiers (a thin-data fallback still can't open a
      // 10-lot NIFTY because its tiny risk budget binds first).
      // `currentHeat` is read HERE (moved up from the old post-sizing gate)
      // via tx.execute so it honours the account-row FOR UPDATE lock — the
      // SAME snapshot then feeds the final fail-closed heat assertion below.
      const perLotLoss = perShareLoss * lotSize;
      const currentHeat = parseHeatRow(await tx.execute(HEAT_SQL_FNO));
      const ceilingLots = PAPER_FIXED_LOTS[indexSymbol.toUpperCase()] ?? null;
      const sizing = computeFnoLotSizing({
        indexSymbol,
        entryPremium: optionEntry,
        stopPremium: optionStop,
        lotSize,
        availableCash: balance,
        maxLossPctPerTrade,
        currentHeat,
        maxFnoHeatPct: PORTFOLIO_HEAT.MAX_FNO_HEAT_PCT,
        absoluteMaxLots: ceilingLots,
      });
      if (sizing.verdict === "REJECT") {
        const skip: SkipReason =
          sizing.reason === "RISK_TOO_WIDE_FOR_MIN_LOT"
            ? "RISK_TOO_WIDE_FOR_MIN_LOT"
            : sizing.reason === "PORTFOLIO_HEAT_CAP"
              ? "PORTFOLIO_HEAT_CAP"
              : "INVALID_PREMIUM_PLAN";
        if (recordSkip(skip)) {
          logger.info(
            {
              indexSymbol, setupKey, tier,
              reason: sizing.reason,
              riskPerLot: +sizing.riskPerLot.toFixed(2),
              perTradeRiskBudget: +sizing.perTradeRiskBudget.toFixed(2),
              heatCap: +sizing.heatCap.toFixed(2),
              currentHeat: +currentHeat.toFixed(2),
              byTradeRisk: sizing.maxLotsByTradeRisk,
              byHeat: sizing.maxLotsByPortfolioHeat,
              ceiling: ceilingLots,
              availableCash: +balance.toFixed(2),
              maxLossPctPerTrade,
            },
            `Paper FO skip: dynamic sizing rejected (${sizing.reason})`,
          );
        }
        return null;
      }
      let lots = sizing.lots;
      // Surface when the dynamic budget cut below the configured ceiling
      // (e.g. NIFTY ceiling 10 → 7 by per-trade risk) so the owner sees
      // the risk-base model working rather than assuming a fixed-lot open.
      if (ceilingLots !== null && lots < ceilingLots) {
        logger.info(
          {
            indexSymbol, setupKey, tier,
            ceiling: ceilingLots,
            finalLots: lots,
            boundBy:
              sizing.maxLotsByTradeRisk <= sizing.maxLotsByPortfolioHeat
                ? "per-trade risk"
                : "portfolio heat",
            byTradeRisk: sizing.maxLotsByTradeRisk,
            byHeat: sizing.maxLotsByPortfolioHeat,
          },
          `Paper FO: dynamic sizing reduced lots from ceiling ${ceilingLots} to ${lots}`,
        );
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

      // ─── FINAL fail-closed portfolio heat assertion ──────────────────
      // Sum of ₹-at-risk across every OPEN F&O position must stay below
      // MAX_FNO_HEAT_PCT × availableCash (NOT seed — matches the risk-base
      // model above). The dynamic sizer already fit `lots` under this cap
      // using the SAME `currentHeat` snapshot, and the post-stop / VOLATILE
      // multipliers only ever REDUCE lots — so this can only trip on a
      // logic regression. Kept as defense-in-depth: FAIL CLOSED, never
      // silently shrink (shrinking would invalidate the setup's planned RR).
      const newTradeHeat = lots * perLotLoss;
      const projectedHeat = currentHeat + newTradeHeat;
      const heatCap = balance * PORTFOLIO_HEAT.MAX_FNO_HEAT_PCT;
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
              availableCash: +balance.toFixed(2),
              maxHeatPct: PORTFOLIO_HEAT.MAX_FNO_HEAT_PCT,
            },
            `Paper FO skip: portfolio heat cap would be breached post-sizing (${(projectedHeat / balance * 100).toFixed(2)}% > ${(PORTFOLIO_HEAT.MAX_FNO_HEAT_PCT * 100).toFixed(2)}%)`,
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

      // P14 — diagnostics-only reasoning log for the successful open.
      // Fire-and-forget; never blocks trading. Captures the full
      // decision context so the owner can reconstruct WHY this trade
      // was opened later.
      void logFnoReasoning({
        decision: "OPENED",
        signalDate,
        indexSymbol,
        indexName: signal.indexName,
        setupKey,
        direction,
        optionType: signal.leg.type,
        tier,
        reasonCode: "OPENED",
        confidence,
        lifecycleStatus: "TRIGGERED",
        dataQuality: (signal.dataQuality as string | undefined) ?? null,
        selectedStrike: signal.leg.strike,
        optionEntry,
        optionStop,
        optionTarget1: optionT1,
        optionTarget2: optionT2,
        optionLtp: signal.optionLtp ?? null,
        spot: signal.spot ?? null,
        regime: (signal.regime as string | undefined) ?? null,
        confluenceScore: signal.confluenceScore ?? null,
        ivr: signal.ivRank ?? null,
        ivp: signal.ivPercentile ?? null,
        maxLossPct: maxLossPctPerTrade,
        lots,
        lotSize,
      });

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
 * Public MTM sweep for OPEN paper_trade_fo rows, called from the signal
 * cycle in optionSignals.ts AFTER enrichBundlesWithOptionLevels has
 * populated `signal.optionLtp`. This is the path that actually drives
 * max_runup / max_drawdown growth — the lifecycle-hook `markToMarket`
 * below runs BEFORE enrichment, so its `signal.optionLtp` is always
 * undefined and it always early-returns (P20 root cause).
 *
 * Observability-only. Touches only:
 *   - paper_trade_fo.last_premium
 *   - paper_trade_fo.last_evaluated_at
 *   - paper_trade_fo.max_runup    (GREATEST — never resets downward)
 *   - paper_trade_fo.max_drawdown (LEAST    — never resets upward)
 *
 * No decision-affecting fields are written. No close-path side effects.
 * Fail-quiet per signal so one malformed row cannot abort the sweep.
 *
 * Idempotent: re-running with the same LTP set is a no-op (GREATEST/LEAST
 * preserve extremes; last_premium converges to the freshest tick).
 */
export async function markOpenFnoTradesToMarket(
  signals: OptionSignal[],
  signalDate: string,
): Promise<void> {
  for (const signal of signals) {
    const setupKey = signal.setupKey;
    if (!setupKey) continue;
    const ltp = signal.optionLtp;
    if (ltp == null || !Number.isFinite(ltp)) continue;
    const direction: "BULLISH" | "BEARISH" =
      signal.bias === "BEARISH" ? "BEARISH" : "BULLISH";
    try {
      const row = await db
        .select({
          id: paperTradeFoTable.id,
          entryPremium: paperTradeFoTable.entryPremium,
          lots: paperTradeFoTable.lots,
          lotSize: paperTradeFoTable.lotSize,
        })
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
      if (row.length === 0) continue;
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
          ...premiumPathWatermarkSet(ltp),
        })
        .where(and(eq(paperTradeFoTable.id, r.id), eq(paperTradeFoTable.status, "OPEN")));
    } catch (err) {
      logger.warn(
        {
          err: (err as Error).message,
          idx: signal.index,
          setup: setupKey,
        },
        "markOpenFnoTradesToMarket: MTM update failed for one row, continuing",
      );
    }
  }
}

/**
 * P22: Pure helper. Pick the LTP for a (strike, optionType) from an
 * already-fetched option chain. Returns null when the chain is missing,
 * has no matching row, or the leg has no usable ltp. Exposed for unit
 * tests; also used by markAllOpenFnoTradesToMarket below.
 */
export function pickLtpFromChain(
  chain: OcResponse | null | undefined,
  strike: number,
  optionType: "CE" | "PE",
): number | null {
  if (!chain || !Array.isArray(chain.rows)) return null;
  // Strikes are nominally integers (NSE 50/100-step), but paper_trade_fo
  // stores them as numeric(_, 4) so the round-tripped value can be e.g.
  // 48000.0000. Use a sub-step epsilon (0.01) so float jitter never causes
  // a spurious miss — strict === would be brittle.
  const row = chain.rows.find((r) => Math.abs(r.strike - strike) < 0.01);
  if (!row) return null;
  const side = optionType === "CE" ? row.ce : row.pe;
  const ltp = side?.ltp;
  if (ltp == null || !Number.isFinite(ltp) || ltp <= 0) return null;
  return ltp;
}

/**
 * P22: per-cycle MTM-sweep diagnostics, surfaced via getOperationalAlerts().
 * Process-local; resets on restart. Observability only — never read by any
 * trading-decision path.
 */
interface MtmSweepCycleStats {
  considered: number;
  updatedFromChain: number;
  skippedAlreadyFresh: number;
  skippedNoQuote: number;
  errors: number;
}
let mtmSweepLastCycle: MtmSweepCycleStats | null = null;
let mtmSweepLastSuccessAt: Date | null = null;
let mtmSweepLastErrorAt: Date | null = null;
let mtmSweepLastErrorClass: string | null = null;
let mtmSweepLastErrorMessage: string | null = null;
let mtmSweepCyclesTotal = 0;
let mtmSweepRowsUpdatedTotal = 0;

export interface MtmSweepHealth {
  cyclesTotal: number;
  rowsUpdatedTotal: number;
  lastCycle: MtmSweepCycleStats | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorClass: string | null;
  lastErrorMessage: string | null;
}

export function getMtmSweepHealth(): MtmSweepHealth {
  return {
    cyclesTotal: mtmSweepCyclesTotal,
    rowsUpdatedTotal: mtmSweepRowsUpdatedTotal,
    lastCycle: mtmSweepLastCycle,
    lastSuccessAt: mtmSweepLastSuccessAt ? mtmSweepLastSuccessAt.toISOString() : null,
    lastErrorAt: mtmSweepLastErrorAt ? mtmSweepLastErrorAt.toISOString() : null,
    lastErrorClass: mtmSweepLastErrorClass,
    lastErrorMessage: mtmSweepLastErrorMessage,
  };
}

/** Test-only reset of the sweep-health counters. */
export function __resetMtmSweepHealthForTests(): void {
  mtmSweepLastCycle = null;
  mtmSweepLastSuccessAt = null;
  mtmSweepLastErrorAt = null;
  mtmSweepLastErrorClass = null;
  mtmSweepLastErrorMessage = null;
  mtmSweepCyclesTotal = 0;
  mtmSweepRowsUpdatedTotal = 0;
}

/**
 * Window (ms) within which an OPEN row is considered "already freshly
 * marked" by the cohort-driven path (markOpenFnoTradesToMarket above)
 * and therefore skipped by the chain-driven sweep. Chosen comfortably
 * larger than a single signal cycle so the chain sweep does not
 * duplicate work the cohort path just did.
 */
const MTM_FRESHNESS_WINDOW_MS = 45_000;

/**
 * P22: Chain-driven MTM fallback. Marks every OPEN paper_trade_fo row for
 * the current IST day to market by pulling the latest option chain per
 * unique index and looking up the row's stored strike/optionType. Closes
 * the cohort-staleness gap noted at P21b EOD: the existing
 * markOpenFnoTradesToMarket only iterates the current signal cohort, so a
 * row whose (index, setup, direction) drops out of the cohort goes idle
 * until force-exit or the cohort returns.
 *
 * Observability-only. Touches only:
 *   - paper_trade_fo.last_premium
 *   - paper_trade_fo.last_evaluated_at
 *   - paper_trade_fo.max_runup    (GREATEST — monotone)
 *   - paper_trade_fo.max_drawdown (LEAST    — monotone)
 *
 * Never writes status / exit_premium / exit_reason / realized_pnl, never
 * opens or closes a trade, never reads paper_account, never affects
 * sizing / gates / DD / heat / circuit-breakers.
 *
 * Rate-limit / cost: at most one fetchOptionChain() call per unique
 * indexSymbol (typically NIFTY / BANKNIFTY / SENSEX → ≤3). The chain
 * layer already has its own ~5s TTL cache; intra-TTL re-calls are free.
 *
 * Fail-safe: every error (DB, chain, finite-math) is caught and logged;
 * the function always resolves. The caller in optionSignals.ts
 * additionally wraps it in `.catch(...)`.
 *
 * `chainFetcher` is injectable for tests; production passes the real
 * `fetchOptionChain`.
 */
export async function markAllOpenFnoTradesToMarket(
  signalDate: string,
  chainFetcher: (
    underlying: string,
  ) => Promise<OcResponse | null> = (sym) => fetchOptionChain(sym),
  /**
   * Optional db handle override — production passes nothing (uses the
   * module-level pool); tests pass a transaction handle so seeded rows
   * and the sweep run inside the same rolled-back txn and leave zero
   * footprint on the dev DB.
   */
  dbHandle: Pick<typeof db, "select" | "update"> = db,
): Promise<MtmSweepCycleStats> {
  const stats: MtmSweepCycleStats = {
    considered: 0,
    updatedFromChain: 0,
    skippedAlreadyFresh: 0,
    skippedNoQuote: 0,
    errors: 0,
  };
  mtmSweepCyclesTotal += 1;
  try {
    const openRows = await dbHandle
      .select({
        id: paperTradeFoTable.id,
        indexSymbol: paperTradeFoTable.indexSymbol,
        optionType: paperTradeFoTable.optionType,
        strike: paperTradeFoTable.strike,
        entryPremium: paperTradeFoTable.entryPremium,
        lots: paperTradeFoTable.lots,
        lotSize: paperTradeFoTable.lotSize,
        lastEvaluatedAt: paperTradeFoTable.lastEvaluatedAt,
      })
      .from(paperTradeFoTable)
      .where(
        and(
          eq(paperTradeFoTable.signalDate, signalDate),
          eq(paperTradeFoTable.status, "OPEN"),
        ),
      );

    stats.considered = openRows.length;
    if (openRows.length === 0) {
      mtmSweepLastCycle = stats;
      mtmSweepLastSuccessAt = new Date();
      return stats;
    }

    const nowMs = Date.now();
    const chainByIndex = new Map<string, OcResponse | null>();
    for (const row of openRows) {
      try {
        // Skip rows the cohort path already refreshed within the window.
        const lastEvalMs = row.lastEvaluatedAt
          ? new Date(row.lastEvaluatedAt).getTime()
          : 0;
        if (nowMs - lastEvalMs < MTM_FRESHNESS_WINDOW_MS) {
          stats.skippedAlreadyFresh += 1;
          continue;
        }

        let chain = chainByIndex.get(row.indexSymbol);
        if (chain === undefined) {
          chain = await chainFetcher(row.indexSymbol).catch(() => null);
          chainByIndex.set(row.indexSymbol, chain);
        }
        const ot = (row.optionType === "PE" ? "PE" : "CE") as "CE" | "PE";
        const strikeNum = num(row.strike);
        const ltp = pickLtpFromChain(chain, strikeNum, ot);
        if (ltp == null) {
          stats.skippedNoQuote += 1;
          continue;
        }
        const entry = num(row.entryPremium);
        const upnl = (ltp - entry) * row.lots * row.lotSize;
        if (!Number.isFinite(upnl)) {
          stats.skippedNoQuote += 1;
          continue;
        }
        await dbHandle
          .update(paperTradeFoTable)
          .set({
            lastPremium: toDbNumeric(ltp, 4),
            lastEvaluatedAt: new Date(),
            maxRunup: sql`GREATEST(${paperTradeFoTable.maxRunup}, ${toDbNumeric(upnl, 2)}::numeric)`,
            maxDrawdown: sql`LEAST(${paperTradeFoTable.maxDrawdown}, ${toDbNumeric(upnl, 2)}::numeric)`,
            ...premiumPathWatermarkSet(ltp),
          })
          .where(
            and(
              eq(paperTradeFoTable.id, row.id),
              eq(paperTradeFoTable.status, "OPEN"),
            ),
          );
        stats.updatedFromChain += 1;
        mtmSweepRowsUpdatedTotal += 1;
      } catch (err) {
        stats.errors += 1;
        mtmSweepLastErrorAt = new Date();
        mtmSweepLastErrorClass = (err as Error).name ?? "Error";
        mtmSweepLastErrorMessage = String((err as Error).message ?? "").slice(0, 200);
        logger.warn(
          {
            err: (err as Error).message,
            idx: row.indexSymbol,
            id: row.id,
          },
          "markAllOpenFnoTradesToMarket: per-row MTM update failed, continuing",
        );
      }
    }
    mtmSweepLastCycle = stats;
    mtmSweepLastSuccessAt = new Date();
    return stats;
  } catch (err) {
    stats.errors += 1;
    mtmSweepLastCycle = stats;
    mtmSweepLastErrorAt = new Date();
    mtmSweepLastErrorClass = (err as Error).name ?? "Error";
    mtmSweepLastErrorMessage = String((err as Error).message ?? "").slice(0, 200);
    logger.warn(
      { err: (err as Error).message },
      "markAllOpenFnoTradesToMarket: top-level failure, swallowed (observability-only)",
    );
    return stats;
  }
}

/**
 * Update the live last-known premium on an open row so we have a fresh
 * value for MTM display and for the EXPIRED close fallback. Also keeps
 * max_runup / max_drawdown in step.
 *
 * NOTE (P20): this lifecycle-hook path is effectively a no-op for MFE/MAE
 * because the lifecycle fires BEFORE option-premium enrichment in
 * optionSignals.ts (see line ~2360 vs ~2409). `signal.optionLtp` is
 * undefined here and we early-return. Kept for the future case where
 * the hook DOES carry a fresh LTP (e.g. from an enriched re-emission),
 * and as a defensive write of last_premium when one arrives. The actual
 * intra-session MFE/MAE growth is driven by `markOpenFnoTradesToMarket`
 * above.
 */
async function markToMarket(input: LifecycleHookInput): Promise<void> {
  const { signal, signalDate, direction } = input;
  const setupKey = signal.setupKey;
  if (!setupKey) return;
  const ltp = signal.optionLtp;
  // Match site 1's guard: a non-finite ltp (NaN/±Inf) would render as "0" via
  // toDbNumeric and falsely seed the lowest-premium watermark at 0.
  if (ltp == null || !Number.isFinite(ltp)) return;

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
      ...premiumPathWatermarkSet(ltp),
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
 * P0 hotfix — per-cycle stats for the orphaned-OPEN spot-exit sweep.
 * Process-local; resets on restart. Observability only.
 */
export interface OrphanExitCycleStats {
  /** OPEN paper_trade_fo rows examined for the IST day. */
  considered: number;
  /** OPEN paper rows with no matching option_signal_history row. */
  lifecycleNotFound: number;
  /** Lifecycle already terminal/exited — left to reconcileOrphanedPaperTrades. */
  alreadyTerminal: number;
  /** Closed at the locked stop premium (STOPPED). */
  stopped: number;
  /** Closed at the locked T2 premium (TARGET2_HIT). */
  target2: number;
  /** Lifecycle advanced to TARGET1_HIT (runner stays OPEN — no close). */
  target1Advanced: number;
  /** Evaluated, no exit/advance this cycle. */
  noExit: number;
  /** Leg had no usable fresh chain LTP — frozen MTM telemetry (no decision impact). */
  staleMtm: number;
  /**
   * An exit was about to be committed (STOPPED/TARGET2_HIT) but the F&O Exit
   * Monitoring Reliability trust gate (fnoExitDecision.ts) rejected the quote
   * as not trade-grade — the row stays OPEN and is retried next cycle. See
   * paperTradeFoTable exit-monitor audit columns for the per-row reason.
   */
  blocked: number;
  errors: number;
}

let orphanExitLastCycle: OrphanExitCycleStats | null = null;
let orphanExitLastSuccessAt: Date | null = null;
let orphanExitLastErrorAt: Date | null = null;
let orphanExitLastErrorClass: string | null = null;
let orphanExitLastErrorMessage: string | null = null;
let orphanExitCyclesTotal = 0;
let orphanExitClosedTotal = 0;
let orphanExitLifecycleAdvanceFailures = 0;

export interface OrphanExitSweepHealth {
  cyclesTotal: number;
  closedTotal: number;
  /**
   * Count of post-close lifecycle-advance failures (close succeeded but the
   * best-effort lifecycle bookkeeping update threw). Pure cosmetic residue —
   * the paper trade is already settled — but tracked so a stale non-terminal
   * lifecycle row is measurable in diagnostics rather than silent.
   */
  lifecycleAdvanceFailures: number;
  lastCycle: OrphanExitCycleStats | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorClass: string | null;
  lastErrorMessage: string | null;
}

export function getOrphanExitSweepHealth(): OrphanExitSweepHealth {
  return {
    cyclesTotal: orphanExitCyclesTotal,
    closedTotal: orphanExitClosedTotal,
    lifecycleAdvanceFailures: orphanExitLifecycleAdvanceFailures,
    lastCycle: orphanExitLastCycle,
    lastSuccessAt: orphanExitLastSuccessAt ? orphanExitLastSuccessAt.toISOString() : null,
    lastErrorAt: orphanExitLastErrorAt ? orphanExitLastErrorAt.toISOString() : null,
    lastErrorClass: orphanExitLastErrorClass,
    lastErrorMessage: orphanExitLastErrorMessage,
  };
}

/** Test-only reset of the orphan-exit sweep-health counters. */
export function __resetOrphanExitSweepHealthForTests(): void {
  orphanExitLastCycle = null;
  orphanExitLastSuccessAt = null;
  orphanExitLastErrorAt = null;
  orphanExitLastErrorClass = null;
  orphanExitLastErrorMessage = null;
  orphanExitCyclesTotal = 0;
  orphanExitClosedTotal = 0;
  orphanExitLifecycleAdvanceFailures = 0;
}

// ───────────────────────────────────────────────────────────────────────────
// TIME_EXIT_1520 force-exit health (read-only, process-local).
//
// Minimal observability counters for the 15:20 IST force-exit. Mirrors the
// existing MTM / orphan / premium-overlay health pattern: pure in-process
// counters, reset on api-server restart, NEVER alter trading behaviour. Only
// `forceCloseAllOpenFnoFor1520` writes these; `getTimeExit1520Health` reads.
// ───────────────────────────────────────────────────────────────────────────

let timeExit1520RunsTotal = 0;
let timeExit1520RowsClosedTotal = 0;
let timeExit1520LastRunAt: Date | null = null;
let timeExit1520LastRunDate: string | null = null; // IST yyyy-mm-dd of last run
let timeExit1520LastRowsClosed: number | null = null;
let timeExit1520LastErrorAt: Date | null = null;
let timeExit1520LastErrorClass: string | null = null;
let timeExit1520LastErrorMessage: string | null = null;

export interface TimeExit1520Health {
  runsTotal: number;
  rowsClosedTotal: number;
  lastRunAt: string | null;
  lastRunDate: string | null;
  lastRowsClosed: number | null;
  lastErrorAt: string | null;
  lastErrorClass: string | null;
  lastErrorMessage: string | null;
}

export function getTimeExit1520Health(): TimeExit1520Health {
  return {
    runsTotal: timeExit1520RunsTotal,
    rowsClosedTotal: timeExit1520RowsClosedTotal,
    lastRunAt: timeExit1520LastRunAt ? timeExit1520LastRunAt.toISOString() : null,
    lastRunDate: timeExit1520LastRunDate,
    lastRowsClosed: timeExit1520LastRowsClosed,
    lastErrorAt: timeExit1520LastErrorAt ? timeExit1520LastErrorAt.toISOString() : null,
    lastErrorClass: timeExit1520LastErrorClass,
    lastErrorMessage: timeExit1520LastErrorMessage,
  };
}

/** Test-only reset of the 15:20 force-exit health counters. */
export function __resetTimeExit1520HealthForTests(): void {
  timeExit1520RunsTotal = 0;
  timeExit1520RowsClosedTotal = 0;
  timeExit1520LastRunAt = null;
  timeExit1520LastRunDate = null;
  timeExit1520LastRowsClosed = null;
  timeExit1520LastErrorAt = null;
  timeExit1520LastErrorClass = null;
  timeExit1520LastErrorMessage = null;
}

/** IST (Asia/Kolkata) calendar date as yyyy-mm-dd. Read-only, no side effects. */
function istDateString(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * P0 hotfix — Orphaned-OPEN spot-exit re-evaluation.
 *
 * Closes the exit-freeze gap: when the live signal cohort flips direction
 * (or otherwise drops a setup), `recordOrUpdate()` stops re-evaluating that
 * lifecycle row, so a TRIGGERED row whose spot has since breached its locked
 * stop/target stays frozen (`exited_at IS NULL`) — and the existing
 * `reconcileOrphanedPaperTrades` only fires once the lifecycle is ALREADY
 * terminal. The paper trade therefore stays OPEN, missing its stop, until the
 * 15:20 force-exit settles it at a (possibly stale) lastPremium.
 *
 * This sweep independently re-evaluates EVERY OPEN paper_trade_fo row for the
 * IST day against fresh spot, reusing the SAME pure `evaluateTransition()` the
 * live lifecycle uses, with the SAME locked spot levels persisted on the
 * `option_signal_history` row. On a stop/target exit it CLOSES the paper trade
 * FIRST via `closePaperTradeForSignal` — settling STOPPED at the locked
 * `stop_premium` and TARGET2_HIT at the locked `target2_premium`, which are
 * immune to the stale-`last_premium` anomaly — and only THEN advances the
 * lifecycle row (CAS-guarded, best-effort bookkeeping). This close-first
 * ordering is failure-safe: if the close throws, the lifecycle stays
 * non-terminal so the next sweep retries the row instead of skipping it as
 * `alreadyTerminal`, so there is never a window where the lifecycle is terminal
 * while the paper trade is still OPEN (which 15:20 would settle at stale LTP). A
 * T1 touch only advances the lifecycle (the runner stays OPEN, no close),
 * matching the live state machine.
 *
 * Spot source: the fresh option-chain underlying (`chain.spot`). No bar
 * high/low is available here, so the snapshot falls back to spot — the same
 * conservative, non-synthetic envelope `evaluateTransition` documents. This is
 * marginally less sensitive than wick-based detection but never fabricates an
 * extreme; the live cohort path (with bar high/low) remains the primary
 * evaluator, and this sweep is the safety net for rows it has abandoned.
 *
 * NOT gated by `isPaperAutoTradingEnabled()`: like `forceCloseAllOpenFnoFor1520`
 * and `reconcileOrphanedPaperTrades`, it only ever CLOSES existing trades — the
 * dev-vs-prod isolation rule gates OPENs, not corrective exits. In dev there
 * are no open rows so it is a no-op.
 *
 * Fail-safe: per-row and top-level try/catch; always resolves. `chainFetcher`,
 * `dbHandle` and `closer` are injectable for tests (mirrors the
 * `markAllOpenFnoTradesToMarket` seam); production passes nothing.
 */
export async function evaluateOrphanedOpenTrades(
  signalDate: string,
  chainFetcher: (
    underlying: string,
  ) => Promise<OcResponse | null> = (sym) => fetchOptionChain(sym),
  dbHandle: Pick<typeof db, "select" | "update"> = db,
  closer: (
    signalDate: string,
    indexSymbol: string,
    setupKey: string,
    direction: "BULLISH" | "BEARISH",
    reason: CloseReason,
  ) => Promise<PaperTradeFoRow | null> = closePaperTradeForSignal,
  exitMonitorCycle?: FnoExitMonitorCycleAccumulator,
): Promise<OrphanExitCycleStats> {
  const stats: OrphanExitCycleStats = {
    considered: 0,
    lifecycleNotFound: 0,
    alreadyTerminal: 0,
    stopped: 0,
    target2: 0,
    target1Advanced: 0,
    noExit: 0,
    staleMtm: 0,
    blocked: 0,
    errors: 0,
  };
  orphanExitCyclesTotal += 1;
  try {
    // Dynamic import avoids a static circular import: optionSignalLifecycle
    // imports this module at top level. evaluateTransition is pure and only
    // used at call time, so the runtime cycle is benign.
    const { evaluateTransition } = await import("./optionSignalLifecycle");
    // Dynamic import for the same reason: fnoExitDecision is a leaf pure
    // module with no cycle risk, but importing it lazily here keeps this
    // hot path's import graph consistent with the rest of the function.
    const { evaluateFnoPaperTradeExit } = await import("./fnoExitDecision");
    const { recordFnoExitCheck, noteFnoExitMonitorScan, noteFnoExitMonitorDecision, noteFnoExitMonitorError } =
      await import("./fnoExitMonitorHealth");

    const openRows = await dbHandle
      .select({
        id: paperTradeFoTable.id,
        signalDate: paperTradeFoTable.signalDate,
        indexSymbol: paperTradeFoTable.indexSymbol,
        setupKey: paperTradeFoTable.setupKey,
        direction: paperTradeFoTable.direction,
        optionType: paperTradeFoTable.optionType,
        strike: paperTradeFoTable.strike,
      })
      .from(paperTradeFoTable)
      .where(
        and(
          eq(paperTradeFoTable.signalDate, signalDate),
          eq(paperTradeFoTable.status, "OPEN"),
        ),
      );

    stats.considered = openRows.length;
    if (openRows.length === 0) {
      orphanExitLastCycle = stats;
      orphanExitLastSuccessAt = new Date();
      return stats;
    }

    const chainByIndex = new Map<
      string,
      { chain: OcResponse | null; fetchedAtMs: number }
    >();

    for (const row of openRows) {
      try {
        // Scheduler summary counter: every open row reaching this point has
        // been examined for a potential exit this sweep, regardless of
        // whether it turns out to be an exit candidate below (mirrors the
        // unconditional increment in optionSignalLifecycle.ts's cohort loop;
        // architect-reviewed, 2026-07-02).
        noteFnoExitMonitorScan(exitMonitorCycle);
        const dir: "BULLISH" | "BEARISH" =
          row.direction === "BEARISH" ? "BEARISH" : "BULLISH";

        // Load the locked lifecycle plan for this paper trade (4-tuple key).
        const lc = await dbHandle
          .select({
            status: optionSignalHistoryTable.status,
            entry: optionSignalHistoryTable.entry,
            stopLoss: optionSignalHistoryTable.stopLoss,
            target1: optionSignalHistoryTable.target1,
            target2: optionSignalHistoryTable.target2,
            exitedAt: optionSignalHistoryTable.exitedAt,
          })
          .from(optionSignalHistoryTable)
          .where(
            and(
              eq(optionSignalHistoryTable.signalDate, row.signalDate),
              eq(optionSignalHistoryTable.indexSymbol, row.indexSymbol),
              eq(optionSignalHistoryTable.setupKey, row.setupKey),
              eq(optionSignalHistoryTable.direction, row.direction),
            ),
          )
          .limit(1);

        if (lc.length === 0) {
          stats.lifecycleNotFound += 1;
          logger.warn(
            { id: row.id, idx: row.indexSymbol, setup: row.setupKey, dir },
            "evaluateOrphanedOpenTrades: ORPHAN_OPEN_LIFECYCLE_NOT_FOUND — OPEN paper trade has no lifecycle row; skipping",
          );
          continue;
        }
        const h = lc[0]!;
        const currentStatus = (h.status as LifecycleStatus) ?? "PENDING";

        // Already-terminal lifecycle (with recorded exit) belongs to
        // reconcileOrphanedPaperTrades — never double-process here.
        if (
          h.exitedAt != null ||
          currentStatus === "STOPPED" ||
          currentStatus === "TARGET2_HIT" ||
          currentStatus === "EXPIRED"
        ) {
          stats.alreadyTerminal += 1;
          continue;
        }

        // Fresh chain (cached per index): gives spot + a staleness probe.
        // fetchedAtMs is captured at the moment of the fetch call (not chain
        // .generatedAt) so it also honestly reflects the cached-hit case —
        // every row sharing this index's cache entry shares the SAME fetch
        // instant, which is what actually determines quote freshness for the
        // exit-monitoring trust gate below.
        let cached = chainByIndex.get(row.indexSymbol);
        if (cached === undefined) {
          const fetchedAtMs = Date.now();
          const chain = await chainFetcher(row.indexSymbol).catch(() => null);
          cached = { chain, fetchedAtMs };
          chainByIndex.set(row.indexSymbol, cached);
        }
        const chain = cached.chain;
        const spot = chain?.spot;
        if (spot == null || !Number.isFinite(spot) || spot <= 0) {
          // No fresh spot → cannot evaluate this cycle; the 15:20 / EOD nets
          // remain the backstop. Counted as a stale-MTM signal.
          stats.staleMtm += 1;
          continue;
        }

        // Telemetry only: a leg with no usable chain LTP means the MTM sweep
        // has frozen last_premium (deep-OTM / illiquid). Does NOT affect the
        // exit decision — stop/target settle at the locked premium plan.
        const ot = (row.optionType === "PE" ? "PE" : "CE") as "CE" | "PE";
        if (pickLtpFromChain(chain, num(row.strike), ot) == null) {
          stats.staleMtm += 1;
        }

        const entry = num(h.entry);
        const stop = num(h.stopLoss);
        const t1 = num(h.target1);
        const t2 = num(h.target2);
        const trans = evaluateTransition(currentStatus, dir, entry, stop, t1, t2, {
          spot,
        });

        const now = new Date();
        const nowMs = now.getTime();

        // F&O Exit Monitoring Reliability trust gate: only relevant for the
        // exit-committing branch below (STOPPED/TARGET2_HIT) — T1 touch and
        // other non-exit advances stay on the pre-existing `trans` path
        // unchanged, since they don't settle a trade at a frozen premium.
        // `chain.spotSource === "kite"` is the ONLY trusted provenance this
        // function has (the chain fetch is Kite-first with an NSE/unavailable
        // fallback for DISPLAY purposes — see optionChain.ts); anything else
        // is treated as not trade-grade so a stale/NSE-fallback spot can
        // never freeze-settle a trade. `wouldHaveExited`/diagnostics are
        // still computed via `trans` for the retry, never used to close.
        const isExitCandidate =
          trans.exited && (trans.next === "STOPPED" || trans.next === "TARGET2_HIT");
        if (isExitCandidate) {
          const provenance: FnoExitQuoteProvenance = {
            source: chain?.spotSource === "kite" ? "LIVE_KITE_FULL" : "STALE",
            kiteSessionActive: chain?.spotSource === "kite",
            asOfMs: chain?.spotSource === "kite" ? cached.fetchedAtMs : null,
          };
          const decision = evaluateFnoPaperTradeExit({
            currentStatus,
            direction: dir,
            entry,
            stop,
            target1: t1,
            target2: t2,
            snapshot: { spot },
            provenance,
            nowMs,
          });
          if (decision.kind === "BLOCKED") {
            stats.blocked += 1;
            noteFnoExitMonitorDecision(exitMonitorCycle, { id: row.id }, decision);
            await recordFnoExitCheck({ id: row.id }, decision, now).catch((auditErr) => {
              noteFnoExitMonitorError(exitMonitorCycle);
              logger.warn(
                { err: (auditErr as Error).message, id: row.id },
                "evaluateOrphanedOpenTrades: exit-monitor audit stamp failed (non-fatal)",
              );
            });
            logger.warn(
              {
                id: row.id,
                idx: row.indexSymbol,
                setup: row.setupKey,
                dir,
                blockedReason: decision.blockedReason,
                wouldHaveExited: decision.wouldHaveExited,
                wouldHaveExitReason: decision.wouldHaveExitReason,
              },
              "evaluateOrphanedOpenTrades: ORPHAN_OPEN_EXIT_BLOCKED — quote not trade-grade, exit deferred to next cycle",
            );
            continue;
          }
          // EXIT/HOLD: stamp the audit trail same as the committing path
          // records below, but do it here too so a HOLD from this gate
          // (should not happen when isExitCandidate is true, kept for
          // defense-in-depth) is still observable.
          noteFnoExitMonitorDecision(exitMonitorCycle, { id: row.id }, decision);
          await recordFnoExitCheck({ id: row.id }, decision, now).catch((auditErr) => {
            noteFnoExitMonitorError(exitMonitorCycle);
            logger.warn(
              { err: (auditErr as Error).message, id: row.id },
              "evaluateOrphanedOpenTrades: exit-monitor audit stamp failed (non-fatal)",
            );
          });
        }

        // Exit (STOPPED / TARGET2_HIT). Ordering is deliberately CLOSE-FIRST,
        // then advance the lifecycle — the reverse of the advance-then-close
        // flow elsewhere. This is failure-safe: if the close throws, the
        // lifecycle stays non-terminal so the NEXT sweep retries this row
        // instead of skipping it as `alreadyTerminal`. That eliminates any
        // window where the lifecycle is terminal but the paper trade is still
        // OPEN — the exact state the 15:20 force-exit would otherwise settle at
        // the stale last_premium. closePaperTradeForSignal settles at the
        // locked stop/T2 premium and never reads the lifecycle row, so closing
        // before the advance is correct.
        if (isExitCandidate) {
          const reason: CloseReason =
            trans.next === "STOPPED" ? "STOPPED" : "TARGET2_HIT";
          const out = await closer(
            row.signalDate,
            row.indexSymbol,
            row.setupKey,
            dir,
            reason,
          );
          if (out) {
            if (reason === "STOPPED") stats.stopped += 1;
            else stats.target2 += 1;
            orphanExitClosedTotal += 1;
            logger.info(
              {
                id: row.id,
                idx: row.indexSymbol,
                setup: row.setupKey,
                dir,
                reason,
                spot,
                stop,
                t2,
              },
              reason === "STOPPED"
                ? "evaluateOrphanedOpenTrades: ORPHAN_OPEN_STOP_HIT — closed frozen orphan at locked stop"
                : "evaluateOrphanedOpenTrades: ORPHAN_OPEN_TARGET2_HIT — closed frozen orphan at locked T2",
            );
            // Shadow market-premium capture (observation only).
            // Reuses the chain already fetched for this sweep cycle — zero
            // extra network calls. Fire-and-forget: never affects close,
            // P&L, balance, or any trading decision.
            void applyMarketShadowToDb(
              out.id,
              captureExitMarketPremium(out, chain),
            ).catch(() => {});
            // Best-effort lifecycle advance — bookkeeping ONLY. The paper trade
            // is already settled, so a 0-row CAS (concurrent path advanced it)
            // or a failure here cannot reintroduce the wrong-settlement class;
            // isolated try/catch keeps it from polluting the row error counter.
            try {
              await dbHandle
                .update(optionSignalHistoryTable)
                .set({
                  status: trans.next,
                  exitedAt: now,
                  exitReason: trans.exitReason ?? trans.next,
                  exitPrice:
                    trans.exitPrice != null ? toDbNumeric(trans.exitPrice, 4) : null,
                  lastSpot: toDbNumeric(spot, 4),
                  lastEvaluatedAt: now,
                })
                .where(
                  and(
                    eq(optionSignalHistoryTable.signalDate, row.signalDate),
                    eq(optionSignalHistoryTable.indexSymbol, row.indexSymbol),
                    eq(optionSignalHistoryTable.setupKey, row.setupKey),
                    eq(optionSignalHistoryTable.direction, row.direction),
                    eq(optionSignalHistoryTable.status, currentStatus),
                    sql`${optionSignalHistoryTable.exitedAt} IS NULL`,
                  ),
                );
            } catch (lcErr) {
              orphanExitLifecycleAdvanceFailures += 1;
              logger.warn(
                { err: (lcErr as Error).message, id: row.id },
                "evaluateOrphanedOpenTrades: lifecycle advance failed AFTER a successful close (paper already settled; cosmetic only)",
              );
            }
          }
          continue;
        }

        // T1 touch (runner stays OPEN): advance lifecycle, no close.
        if (
          !trans.exited &&
          trans.next === "TARGET1_HIT" &&
          currentStatus === "TRIGGERED"
        ) {
          const advanced = await dbHandle
            .update(optionSignalHistoryTable)
            .set({
              status: "TARGET1_HIT",
              lastSpot: toDbNumeric(spot, 4),
              lastEvaluatedAt: now,
            })
            .where(
              and(
                eq(optionSignalHistoryTable.signalDate, row.signalDate),
                eq(optionSignalHistoryTable.indexSymbol, row.indexSymbol),
                eq(optionSignalHistoryTable.setupKey, row.setupKey),
                eq(optionSignalHistoryTable.direction, row.direction),
                eq(optionSignalHistoryTable.status, "TRIGGERED"),
                sql`${optionSignalHistoryTable.exitedAt} IS NULL`,
              ),
            )
            .returning();
          if (advanced.length > 0) {
            stats.target1Advanced += 1;
            logger.info(
              { id: row.id, idx: row.indexSymbol, setup: row.setupKey, dir, spot, t1 },
              "evaluateOrphanedOpenTrades: ORPHAN_OPEN_TARGET1_HIT — advanced frozen orphan to T1 (runner stays open)",
            );
          }
          continue;
        }

        // Any other non-exit advance (e.g. PENDING→TRIGGERED): keep the
        // lifecycle honest, no close.
        if (!trans.exited && trans.next !== currentStatus) {
          await dbHandle
            .update(optionSignalHistoryTable)
            .set({
              status: trans.next,
              ...(trans.triggered ? { triggeredAt: now } : {}),
              lastSpot: toDbNumeric(spot, 4),
              lastEvaluatedAt: now,
            })
            .where(
              and(
                eq(optionSignalHistoryTable.signalDate, row.signalDate),
                eq(optionSignalHistoryTable.indexSymbol, row.indexSymbol),
                eq(optionSignalHistoryTable.setupKey, row.setupKey),
                eq(optionSignalHistoryTable.direction, row.direction),
                eq(optionSignalHistoryTable.status, currentStatus),
                sql`${optionSignalHistoryTable.exitedAt} IS NULL`,
              ),
            );
          stats.noExit += 1;
          continue;
        }

        stats.noExit += 1;
      } catch (err) {
        stats.errors += 1;
        noteFnoExitMonitorError(exitMonitorCycle);
        orphanExitLastErrorAt = new Date();
        orphanExitLastErrorClass = (err as Error).name ?? "Error";
        orphanExitLastErrorMessage = String((err as Error).message ?? "").slice(0, 200);
        logger.warn(
          { err: (err as Error).message, id: row.id, idx: row.indexSymbol },
          "evaluateOrphanedOpenTrades: per-row evaluation failed, continuing",
        );
      }
    }
    orphanExitLastCycle = stats;
    orphanExitLastSuccessAt = new Date();
    return stats;
  } catch (err) {
    stats.errors += 1;
    orphanExitLastCycle = stats;
    orphanExitLastErrorAt = new Date();
    orphanExitLastErrorClass = (err as Error).name ?? "Error";
    orphanExitLastErrorMessage = String((err as Error).message ?? "").slice(0, 200);
    logger.warn(
      { err: (err as Error).message },
      "evaluateOrphanedOpenTrades: top-level failure, swallowed (safety-net)",
    );
    return stats;
  }
}

export type FnoExitEvaluationStatus =
  | "NOT_FOUND"
  | "NOT_OPEN"
  | "LIFECYCLE_NOT_FOUND"
  | "NO_FRESH_SPOT"
  | "EVALUATED";

export interface FnoExitEvaluationTrade {
  id: string;
  signalDate: string;
  indexSymbol: string;
  setupKey: string;
  direction: "BULLISH" | "BEARISH";
}

export interface FnoExitEvaluationResult {
  status: FnoExitEvaluationStatus;
  trade?: FnoExitEvaluationTrade;
  decision?: FnoExitDecision;
}

/**
 * F&O Exit Monitoring Reliability (T005) — evaluate ONE open paper trade's
 * exit eligibility on demand, using the EXACT SAME quote-provenance +
 * trust-gate path as `evaluateOrphanedOpenTrades`'s per-row block (fresh
 * chain fetch, `chain.spotSource === "kite"` provenance, `evaluateFnoPaperTradeExit`
 * for the trust/freshness gate over `evaluateTransition`). Zero math
 * duplication — this is a read-only evaluation with NO DB writes and NO
 * Telegram side effects, safe to call from a "run dry" diagnostic endpoint.
 * Callers that want to actually close a trade must separately invoke
 * `closePaperTradeForSignal` (T005's "run now" endpoint does this, gated on
 * `decision.kind === "EXIT"` only — never forces a close on HOLD/BLOCKED).
 */
export async function evaluateSingleFnoTradeExit(
  tradeId: string,
  chainFetcher: (
    underlying: string,
  ) => Promise<OcResponse | null> = (sym) => fetchOptionChain(sym),
  dbHandle: Pick<typeof db, "select"> = db,
): Promise<FnoExitEvaluationResult> {
  const { evaluateFnoPaperTradeExit } = await import("./fnoExitDecision");

  const rows = await dbHandle
    .select({
      id: paperTradeFoTable.id,
      signalDate: paperTradeFoTable.signalDate,
      indexSymbol: paperTradeFoTable.indexSymbol,
      setupKey: paperTradeFoTable.setupKey,
      direction: paperTradeFoTable.direction,
      status: paperTradeFoTable.status,
    })
    .from(paperTradeFoTable)
    .where(eq(paperTradeFoTable.id, tradeId))
    .limit(1);

  if (rows.length === 0) return { status: "NOT_FOUND" };
  const row = rows[0]!;
  const dir: "BULLISH" | "BEARISH" = row.direction === "BEARISH" ? "BEARISH" : "BULLISH";
  const trade: FnoExitEvaluationTrade = {
    id: row.id,
    signalDate: row.signalDate,
    indexSymbol: row.indexSymbol,
    setupKey: row.setupKey,
    direction: dir,
  };
  if (row.status !== "OPEN") return { status: "NOT_OPEN", trade };

  const lc = await dbHandle
    .select({
      status: optionSignalHistoryTable.status,
      entry: optionSignalHistoryTable.entry,
      stopLoss: optionSignalHistoryTable.stopLoss,
      target1: optionSignalHistoryTable.target1,
      target2: optionSignalHistoryTable.target2,
    })
    .from(optionSignalHistoryTable)
    .where(
      and(
        eq(optionSignalHistoryTable.signalDate, row.signalDate),
        eq(optionSignalHistoryTable.indexSymbol, row.indexSymbol),
        eq(optionSignalHistoryTable.setupKey, row.setupKey),
        eq(optionSignalHistoryTable.direction, row.direction),
      ),
    )
    .limit(1);

  if (lc.length === 0) return { status: "LIFECYCLE_NOT_FOUND", trade };
  const h = lc[0]!;
  const currentStatus = (h.status as LifecycleStatus) ?? "PENDING";

  const fetchedAtMs = Date.now();
  const chain = await chainFetcher(row.indexSymbol).catch(() => null);
  const spot = chain?.spot;
  if (spot == null || !Number.isFinite(spot) || spot <= 0) {
    return { status: "NO_FRESH_SPOT", trade };
  }

  const provenance: FnoExitQuoteProvenance = {
    source: chain?.spotSource === "kite" ? "LIVE_KITE_FULL" : "STALE",
    kiteSessionActive: chain?.spotSource === "kite",
    asOfMs: chain?.spotSource === "kite" ? fetchedAtMs : null,
  };

  const decision = evaluateFnoPaperTradeExit({
    currentStatus,
    direction: dir,
    entry: num(h.entry),
    stop: num(h.stopLoss),
    target1: num(h.target1),
    target2: num(h.target2),
    snapshot: { spot },
    provenance,
    nowMs: Date.now(),
  });

  return { status: "EVALUATED", trade, decision };
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

  const txResult = await db.transaction(async (tx) => {
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

    // P14 — diagnostics-only reasoning log for the close. One row per
    // close (no dedup) so we capture every exit. Decision discriminator
    // maps the lifecycle reason to a CLOSED_* tag.
    const closeDecisionMap: Record<CloseReason, FnoReasoningDecision> = {
      STOPPED: "CLOSED_STOPPED",
      TARGET1_HIT: "CLOSED_TARGET1",
      TARGET2_HIT: "CLOSED_TARGET2",
      EXPIRED: "CLOSED_EXPIRED",
      MANUAL_OVERRIDE: "CLOSED_MANUAL",
      TIME_EXIT_1520: "CLOSED_TIME_EXIT_1520",
    };
    void logFnoReasoning({
      decision: closeDecisionMap[reason],
      signalDate,
      indexSymbol,
      indexName: r.indexName,
      setupKey,
      direction,
      optionType: r.optionType,
      reasonCode: reason,
      exitReason: reason,
      lifecycleStatus:
        reason === "STOPPED" ? "STOPPED" :
        reason === "TARGET1_HIT" ? "TARGET1_HIT" :
        reason === "TARGET2_HIT" ? "TARGET2_HIT" :
        reason === "EXPIRED" ? "EXPIRED" : null,
      selectedStrike: num(r.strike),
      optionEntry: num(r.entryPremium),
      optionStop: num(r.stopPremium),
      optionTarget1: num(r.target1Premium),
      optionTarget2: num(r.target2Premium),
      optionLtp: num(r.lastPremium),
      optionExit: exitPremium,
      realizedPnl,
      lots: r.lots,
      lotSize: r.lotSize,
    });

    return updated[0]!;
  });

  // Fire exit alert after transaction commits.
  // Safe-fail — alertFnoExitSignal never throws and never blocks the close path.
  if (txResult) {
    alertFnoExitSignal({
      paperTradeId:   txResult.id,
      indexSymbol,
      direction,
      setupKey,
      signalDate,
      optionType:     (r.optionType as "CE" | "PE" | null) ?? null,
      entryPremium:   num(r.entryPremium),
      exitPremium:    num(txResult.exitPremium),
      stopPremium:    r.stopPremium    != null ? num(r.stopPremium)    : null,
      target1Premium: r.target1Premium != null ? num(r.target1Premium) : null,
      lots:           r.lots,
      lotSize:        r.lotSize,
      realizedPnl:    num(txResult.realizedPnl),
      reason,
      openedAt:  r.openedAt instanceof Date
        ? r.openedAt
        : new Date(String(r.openedAt ?? 0)),
      exitedAt:  txResult.exitedAt instanceof Date
        ? txResult.exitedAt
        : new Date(String(txResult.exitedAt ?? 0)),
    });
  }
  return txResult;
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
  // Read-only observability: record the run BEFORE any work so a throwing
  // select is still reflected as an attempted run. Behaviour is unchanged —
  // the catch re-throws so the caller's success-latch semantics are preserved.
  timeExit1520RunsTotal++;
  timeExit1520LastRunAt = new Date();
  timeExit1520LastRunDate = istDateString(timeExit1520LastRunAt);
  try {
    const openRows = await db
      .select({
        signalDate: paperTradeFoTable.signalDate,
        indexSymbol: paperTradeFoTable.indexSymbol,
        setupKey: paperTradeFoTable.setupKey,
        direction: paperTradeFoTable.direction,
      })
      .from(paperTradeFoTable)
      .where(eq(paperTradeFoTable.status, "OPEN"));
    if (openRows.length === 0) {
      timeExit1520LastRowsClosed = 0;
      return 0;
    }
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
        if (out) {
          closed++;
          // Shadow market-premium capture (observation only, best-effort).
          // Fetches the chain for the closed trade's index; fire-and-forget.
          // Never affects close outcome, P&L, or balance.
          void (async () => {
            try {
              const chain = await fetchOptionChain(out.indexSymbol);
              await applyMarketShadowToDb(
                out.id,
                captureExitMarketPremium(out, chain),
              );
            } catch { /* shadow observation only */ }
          })();
        }
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
    timeExit1520LastRowsClosed = closed;
    timeExit1520RowsClosedTotal += closed;
    return closed;
  } catch (err) {
    timeExit1520LastErrorAt = new Date();
    timeExit1520LastErrorClass = (err as Error)?.constructor?.name ?? "Error";
    timeExit1520LastErrorMessage = String((err as Error)?.message ?? err).slice(0, 200);
    throw err;
  }
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
  // Reconcile re-opens TODAY's still-live triggers after a mid-day restart.
  // option_signal_history does NOT persist the option-premium source, so we
  // cannot assume the persisted option levels were Kite-sourced (a pre-deploy
  // cycle could have projected them from an NSE/Yahoo fallback chain). Re-derive
  // current trust from a fresh chain per index (cached) and stamp it onto the
  // synthetic signal; openPaperTrade's fail-closed premium backstop then refuses
  // to re-open anything whose premium is not currently Kite-trusted. This both
  // restores reconciliation for legitimate (Kite-trusted) rows AND keeps the
  // untrusted-premium guarantee intact across restarts.
  const trustByIndex = new Map<
    string,
    { trusted: boolean; source: OcSourceProvider }
  >();
  const resolveTrust = async (indexSymbol: string) => {
    const cached = trustByIndex.get(indexSymbol);
    if (cached) return cached;
    let verdict: { trusted: boolean; source: OcSourceProvider } = {
      trusted: false,
      source: "unknown",
    };
    try {
      const chain = await fetchOptionChain(indexSymbol);
      const prov = buildOptionChainProvenance(chain);
      verdict = { trusted: prov.trustedForSignals, source: prov.sourceProvider };
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, idx: indexSymbol },
        "reconcileMissingPaperTrades: trust probe failed; treating premium as untrusted",
      );
    }
    trustByIndex.set(indexSymbol, verdict);
    return verdict;
  };
  for (const r of rows) {
    const optEntry = num(r.option_entry);
    const optStop = num(r.option_stop_loss);
    if (!optEntry || !optStop) continue;

    const dir: "BULLISH" | "BEARISH" =
      r.direction === "BEARISH" ? "BEARISH" : "BULLISH";
    const { trusted: premiumTrusted, source: premiumSource } =
      await resolveTrust(r.index_symbol);

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
    //
    // Computed BEFORE the synthetic signal so we can stamp a matching
    // `tradeClass` — the P1 `assertTradeableForOpen` first gate reads it.
    const tier: TradeTier =
      r.persisted_tier === "BASELINE"
        ? "BASELINE"
        : r.persisted_tier === "HIGH_CONVICTION"
          ? "STANDARD"
          : r.setup_key === "BASELINE"
            ? "BASELINE"
            : "STANDARD";
    // The reconcile signal MUST carry the SAME tradeClass the in-cycle path
    // would derive from this tier (STANDARD⇒HIGH_CONVICTION⇒TRADEABLE,
    // BASELINE⇒INFO_ONLY under hygiene). Without it the P1 first gate refuses
    // EVERY reconciled open (tradeClass undefined ≠ "TRADEABLE"), silently
    // killing mid-day-restart backfill for legit Kite-trusted STANDARD rows.
    // tags: [] — a reconciled re-open carries no FRESH recovery/chase veto
    // (a vetoed setup is INFO_ONLY and would never have been persisted as a
    // triggered trade in the first place).
    const tradeClass = deriveTradeClass(
      tier === "BASELINE" ? "BASELINE" : "HIGH_CONVICTION",
      isSignalHygieneV2Enabled(),
    );
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
      premiumTrusted,
      premiumSource,
      premiumWarning: premiumTrusted
        ? undefined
        : `Reconcile: option-chain source "${premiumSource}" is not Kite-trusted right now — refusing to re-open.`,
      tradeClass,
      tags: [],
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
 *   Heat / sizing:   RISK_TOO_WIDE_FOR_MIN_LOT, PORTFOLIO_HEAT_CAP,
 *                    PORTFOLIO_HEAT, BUDGET_TOO_TIGHT, INSUFFICIENT_BALANCE
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
  | "RISK_TOO_WIDE_FOR_MIN_LOT"
  | "PORTFOLIO_HEAT_CAP"
  | "PORTFOLIO_HEAT"
  | "BUDGET_TOO_TIGHT"
  | "INFO_ONLY_NOT_TRADEABLE"
  | "PREMIUM_UNTRUSTED"
  | "INSUFFICIENT_BALANCE"
  /** F&O risk guard blocked this open (DTE/theta, low premium, re-entry cooldown, or SENSEX disable). */
  | "PAPER_RISK_GUARD_BLOCKED";

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

  // P14 — diagnostics-only reasoning log. Fire-and-forget; never blocks
  // trading. Mirrors the ring-buffer dedup contract: one row per
  // (signal, gate) per day so "which gates are failing most often"
  // counts are honest. The logger swallows all errors internally.
  void logFnoReasoning({
    decision: m.skipReason === "MISSED_WINDOW" ? "MISSED_WINDOW" : "SKIPPED",
    signalDate: m.signalDate,
    indexSymbol: m.indexSymbol,
    indexName: m.indexName,
    setupKey: m.setupKey,
    direction: m.direction,
    tier: m.tier,
    confidence: m.confidence,
    reasonCode: m.skipReason,
    lifecycleStatus: m.status,
    exitReason: m.reason,
    dataQuality: m.dataQuality,
    optionEntry: m.optionEntry,
    optionStop: m.optionStop,
    optionTarget1: m.optionTarget1,
    optionTarget2: m.optionTarget2,
    capturedAt: m.observedAt,
  });

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
      const opened = await openPaperTrade({
        prev: null,
        next: status,
        exited: false,
        signal,
        signalDate,
        direction,
        tier,
      });
      // Alert owner when a genuine new paper trade is opened (all gates passed).
      // alertFnoTradeableSignal is safe-fail — never blocks the F&O cycle.
      if (opened) {
        const openedAt =
          opened.openedAt instanceof Date
            ? opened.openedAt
            : new Date(opened.openedAt as string);
        alertFnoTradeableSignal({
          indexSymbol:    signal.index,
          direction,
          setupKey:       signal.setupKey ?? "",
          signalDate,
          confidence:     Math.round(signal.confidence ?? 0),
          entryPremium:   Number(opened.entryPremium) || 0,
          stopPremium:    opened.stopPremium    != null ? Number(opened.stopPremium)    : null,
          target1Premium: opened.target1Premium != null ? Number(opened.target1Premium) : null,
          target2Premium: opened.target2Premium != null ? Number(opened.target2Premium) : null,
          lots:           opened.lots,
          lotSize:        opened.lotSize,
          strike:         opened.strike         != null ? Number(opened.strike)         : null,
          expiry:         signal.leg?.expiry     ?? null,
          optionType:     (opened.optionType as "CE" | "PE" | null) ?? null,
          paperTradeId:   opened.id,
          openedAt,
        });
      }
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, idx: signal.index, setup: signal.setupKey },
        "Paper FO post-enrichment open failed",
      );
    }
  }
}
