/**
 * Directional vetoes for the F&O signal engine (2026-06-09 hygiene fix).
 *
 * Two pure, per-tick checks that catch the two failure modes observed on
 * 2026-06-09 on NIFTY / BANKNIFTY / SENSEX:
 *
 *   RECOVERY_MODE_VETO — the engine emitted fresh PUTs (bearish) into a
 *     V-shaped intraday RECOVERY off the session low. We veto a fresh
 *     bearish setup when the tape shows a genuine, multi-factor recovery
 *     (NOT a fixed % bounce): an ATR-normalized bounce off the day low
 *     AND higher-lows AND a rising/reclaimed RSI AND price reclaiming
 *     EMA9 or VWAP. All four must agree, so a real trend-down day (no
 *     recovery) still emits its PUT.
 *
 *   CHASE_RISK_VETO — after the recovery the engine flipped and chased
 *     LATE, EXTENDED CALLs (bullish) at the top of a vertical run. We veto
 *     a fresh bullish setup when price is stretched ≥2×ATR above VWAP AND
 *     RSI is overbought (≥70) AND the last few bars are a vertical run
 *     (≥1.5×ATR). This is a DEMOTE, not a permanent ban: because the
 *     check is recomputed every tick from the current tape, once price
 *     pulls back / retests (extension and RSI cool), the same setup is
 *     allowed to become TRADEABLE again — i.e. "wait for the pullback".
 *
 * Both vetoes DEMOTE the setup to INFO_ONLY (BASELINE tier) rather than
 * hard-hiding it, so the card still shows with an explicit reason tag and
 * the audit trail records why it was not tradeable.
 *
 * Pure + deterministic — no I/O, no clock — so it is fully unit-testable
 * and replayable against historical bar sequences.
 */

/** Recovery-veto thresholds (blocks a fresh BEARISH / PUT setup). */
export const RECOVERY_VETO = {
  /** Spot must be at least this many ATRs above the intraday low. */
  MIN_BOUNCE_ATR: 0.75,
  /** Window (bars) for the higher-lows test: min of last N vs prior N. */
  HIGHER_LOW_WINDOW: 3,
  /** RSI must be rising vs this many bars ago. */
  RSI_SLOPE_LOOKBACK: 4,
  /** RSI must also have reclaimed at/above this level. */
  RSI_RECLAIM_LEVEL: 42,
} as const;

/** Chase-veto thresholds (blocks a fresh BULLISH / CALL setup). */
export const CHASE_VETO = {
  RSI_OVERBOUGHT: 70,
  /** Spot must be at least this many ATRs above VWAP (extension). */
  MIN_EXTENSION_ATR: 2.0,
  /** Vertical-run lookback in bars. */
  VERTICAL_LOOKBACK: 4,
  /** Net up-move over the lookback must be at least this many ATRs. */
  VERTICAL_MIN_ATR: 1.5,
} as const;

export interface VetoInputs {
  /** Latest spot (== closes.at(-1) in practice, passed explicitly). */
  spot: number;
  /**
   * Authoritative session VWAP, or `null` when structurally unavailable
   * (e.g. cash-index zero-volume candles). Must never be a spot-derived
   * substitute. When `null`, all VWAP-dependent veto rules are skipped
   * and the function returns { recovery: false, chase: false }.
   */
  vwap: number | null;
  ema9: number;
  /** 15-min ATR. Guards bail when <= 0. */
  atr15: number;
  /** Latest RSI(14) scalar. */
  rsi14: number;
  /** Intraday session highs / lows / closes (oldest → newest). */
  highs: number[];
  lows: number[];
  closes: number[];
  /** RSI(14) series aligned to the bar series; may contain nulls (warm-up). */
  rsiSeries: (number | null)[];
}

export interface VetoEvaluation {
  /** True ⇒ a fresh BEARISH (PUT) setup should be demoted to INFO_ONLY. */
  recovery: boolean;
  /** True ⇒ a fresh BULLISH (CALL) setup should be demoted to INFO_ONLY. */
  chase: boolean;
  recoveryReason?: string;
  chaseReason?: string;
}

/**
 * FNO_SIGNAL_HYGIENE_V2 trade-class mapping for a signal's conviction tier.
 * Under hygiene v2 only HIGH_CONVICTION signals are TRADEABLE; BASELINE (and
 * any signal demoted to BASELINE by a veto/gate, including a post-emission OI
 * demotion) is strictly INFO_ONLY. When the flag is OFF the legacy BASELINE
 * lane auto-trades, so the field reports TRADEABLE to match execution
 * semantics (true rollback). Callers must re-derive after any tier mutation.
 */
export function deriveTradeClass(
  signalTier: "HIGH_CONVICTION" | "BASELINE",
  hygieneEnabled: boolean,
): "TRADEABLE" | "INFO_ONLY" {
  if (!hygieneEnabled) return "TRADEABLE";
  return signalTier === "HIGH_CONVICTION" ? "TRADEABLE" : "INFO_ONLY";
}

/**
 * Whether the paper auto-trader may OPEN a trade for a given sizing tier.
 * Under FNO_SIGNAL_HYGIENE_V2 only the STANDARD sizing lane (HIGH_CONVICTION
 * confidence ≥65) is auto-tradeable; BASELINE/MICRO are INFO_ONLY. When the
 * flag is OFF the legacy BASELINE lane is allowed again (rollback).
 */
export function isAutoTradeableSizingTier(
  sizingTier: string,
  hygieneEnabled: boolean,
): boolean {
  if (!hygieneEnabled) return true;
  return sizingTier === "STANDARD";
}

function lastFinite(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
}

function finiteAtOffset(arr: (number | null)[], offsetFromEnd: number): number | null {
  const i = arr.length - 1 - offsetFromEnd;
  if (i < 0 || i >= arr.length) return null;
  const v = arr[i];
  return v != null && Number.isFinite(v) ? v : null;
}

export function evaluateDirectionalVetoes(v: VetoInputs): VetoEvaluation {
  const { spot, vwap, ema9, atr15, rsi14, highs, lows, closes, rsiSeries } = v;

  // Authoritative VWAP is required for all veto rules in this function.
  // When vwap===null (structurally unavailable — e.g. cash-index zero-volume
  // candles), skip all VWAP-dependent rules rather than substitute spot.
  if (vwap === null) {
    return { recovery: false, chase: false };
  }

  let recovery = false;
  let recoveryReason: string | undefined;
  let chase = false;
  let chaseReason: string | undefined;

  const baseGuard =
    atr15 > 0 && Number.isFinite(spot) && Number.isFinite(vwap) && Number.isFinite(atr15);

  // ---- RECOVERY_MODE_VETO (blocks fresh BEARISH) ----
  const enoughLows = lows.length >= RECOVERY_VETO.HIGHER_LOW_WINDOW * 2;
  if (baseGuard && enoughLows && Number.isFinite(ema9)) {
    const dayLow = Math.min(...lows);
    const bounceAtr = (spot - dayLow) / atr15;

    const w = RECOVERY_VETO.HIGHER_LOW_WINDOW;
    const recentMinLow = Math.min(...lows.slice(-w));
    const priorMinLow = Math.min(...lows.slice(-2 * w, -w));
    const higherLows = recentMinLow > priorMinLow;

    const rsiNow = lastFinite(rsiSeries) ?? rsi14;
    const rsiPast = finiteAtOffset(rsiSeries, RECOVERY_VETO.RSI_SLOPE_LOOKBACK);
    const rsiRising = rsiPast != null ? rsiNow > rsiPast : false;
    const rsiReclaim = rsi14 >= RECOVERY_VETO.RSI_RECLAIM_LEVEL;

    const meanReclaim = spot >= ema9 || spot >= vwap;

    if (
      bounceAtr >= RECOVERY_VETO.MIN_BOUNCE_ATR &&
      higherLows &&
      rsiRising &&
      rsiReclaim &&
      meanReclaim
    ) {
      recovery = true;
      recoveryReason =
        `recovery-mode veto: bounce ${bounceAtr.toFixed(2)}×ATR off intraday low, ` +
        `higher-lows, RSI ${rsi14.toFixed(1)} rising & reclaimed ≥${RECOVERY_VETO.RSI_RECLAIM_LEVEL}, ` +
        `price reclaimed EMA9/VWAP — fresh PUT demoted to INFO_ONLY`;
    }
  }

  // ---- CHASE_RISK_VETO (blocks fresh BULLISH) ----
  const enoughCloses = closes.length >= CHASE_VETO.VERTICAL_LOOKBACK + 1;
  if (baseGuard && enoughCloses) {
    const extensionAtr = (spot - vwap) / atr15;
    const overbought = rsi14 >= CHASE_VETO.RSI_OVERBOUGHT;
    const past = closes[closes.length - 1 - CHASE_VETO.VERTICAL_LOOKBACK]!;
    const verticalAtr = (spot - past) / atr15;

    if (
      extensionAtr >= CHASE_VETO.MIN_EXTENSION_ATR &&
      overbought &&
      verticalAtr >= CHASE_VETO.VERTICAL_MIN_ATR
    ) {
      chase = true;
      chaseReason =
        `chase-risk veto: spot ${extensionAtr.toFixed(2)}×ATR above VWAP, ` +
        `RSI ${rsi14.toFixed(1)} ≥${CHASE_VETO.RSI_OVERBOUGHT}, ` +
        `vertical run ${verticalAtr.toFixed(2)}×ATR over ${CHASE_VETO.VERTICAL_LOOKBACK} bars — ` +
        `late CALL demoted to INFO_ONLY until pullback/retest`;
    }
  }

  return { recovery, chase, recoveryReason, chaseReason };
}

// ── Paper-trade open eligibility (2026-06-10, P1 defense-in-depth) ─────────────
//
// A single PURE, fail-closed assertion the paper-trade open path runs FIRST,
// before it touches the account. It is defense-in-depth on top of the
// individual gates already in `openPaperTrade`: it refuses to open unless the
// signal is genuinely tradeable AND rests on Kite-trusted premium, returning a
// precise structured reason for every refusal. No I/O, no clock — unit-tested
// in isolation. It deliberately does NOT re-implement risk/liquidity/DD/heat
// gates (those need DB state); those remain in `openPaperTrade` after this gate.

/** Audit tags (set in optionSignals.toSignal) that mark a veto-demoted setup. */
export const VETO_TAGS = {
  RECOVERY: "RECOVERY_MODE_VETO",
  CHASE: "CHASE_RISK_VETO",
} as const;

/** Structured reason a paper-trade open was refused at the tradeability gate. */
export type TradeOpenBlockReason =
  | "RECOVERY_VETO"
  | "CHASE_VETO"
  | "INFO_ONLY_NOT_TRADEABLE"
  | "PREMIUM_UNTRUSTED";

export interface TradeOpenSignalView {
  /** Sizing tier resolved for this open attempt (e.g. STANDARD | BASELINE). */
  sizingTier: string;
  /** Conviction trade-class stamped on the signal (deriveTradeClass output). */
  tradeClass?: "TRADEABLE" | "INFO_ONLY" | null;
  /** True only when option premium is a complete, non-stale Kite chain. */
  premiumTrusted?: boolean | null;
  /** Signal audit tags; may contain RECOVERY_MODE_VETO / CHASE_RISK_VETO. */
  tags?: readonly string[] | null;
  /** FNO_SIGNAL_HYGIENE_V2 state at evaluation time. */
  hygieneEnabled: boolean;
}

export interface TradeOpenDecision {
  /** True ⇒ the signal cleared the tradeability gate (risk gates still apply). */
  trade_open_allowed: boolean;
  /** Precise refusal reason, or null when allowed. */
  reason: TradeOpenBlockReason | null;
  /** Human-readable detail for logs / diagnostics, or null when allowed. */
  detail: string | null;
}

/**
 * Fail-closed tradeability assertion. Order is chosen so the MOST specific
 * reason wins: an explicit veto tag is reported as RECOVERY/CHASE rather than a
 * generic INFO_ONLY, even though a veto already demotes the setup upstream.
 *
 *   1. RECOVERY_MODE_VETO tag present       → RECOVERY_VETO
 *   2. CHASE_RISK_VETO tag present          → CHASE_VETO
 *   3. sizing tier not auto-tradeable       → INFO_ONLY_NOT_TRADEABLE
 *   4. hygiene on AND tradeClass!=TRADEABLE → INFO_ONLY_NOT_TRADEABLE
 *   5. premium not Kite-trusted             → PREMIUM_UNTRUSTED
 *   else                                    → allowed
 */
export function assertTradeableForOpen(view: TradeOpenSignalView): TradeOpenDecision {
  const tags = view.tags ?? [];
  if (tags.includes(VETO_TAGS.RECOVERY)) {
    return {
      trade_open_allowed: false,
      reason: "RECOVERY_VETO",
      detail: "recovery-mode veto active — fresh PUT into an intraday V-recovery",
    };
  }
  if (tags.includes(VETO_TAGS.CHASE)) {
    return {
      trade_open_allowed: false,
      reason: "CHASE_VETO",
      detail: "chase-risk veto active — late CALL at top of a vertical run",
    };
  }
  if (!isAutoTradeableSizingTier(view.sizingTier, view.hygieneEnabled)) {
    return {
      trade_open_allowed: false,
      reason: "INFO_ONLY_NOT_TRADEABLE",
      detail: `sizing tier ${view.sizingTier} is not auto-tradeable under hygiene v2`,
    };
  }
  if (view.hygieneEnabled && view.tradeClass !== "TRADEABLE") {
    return {
      trade_open_allowed: false,
      reason: "INFO_ONLY_NOT_TRADEABLE",
      detail: `tradeClass ${view.tradeClass ?? "unknown"} is not TRADEABLE`,
    };
  }
  if (view.premiumTrusted !== true) {
    return {
      trade_open_allowed: false,
      reason: "PREMIUM_UNTRUSTED",
      detail: "option premium is not Kite-trusted (delayed/stale/missing source)",
    };
  }
  return { trade_open_allowed: true, reason: null, detail: null };
}
