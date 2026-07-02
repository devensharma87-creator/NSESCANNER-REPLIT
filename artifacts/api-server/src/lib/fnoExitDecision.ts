/**
 * F&O Exit Monitoring Reliability — pure trust/freshness gate for the
 * existing SPOT-based lifecycle exit trigger.
 *
 * SCOPE / DESIGN DECISION (architect-reviewed 2026-07-02):
 *
 * The F&O paper-trader's SL/target trigger is, and remains, SPOT-based —
 * `evaluateTransition()` (optionSignalLifecycle.ts) compares the underlying
 * index spot against LOCKED spot entry/stop/target1/target2 levels, with a
 * documented deterministic "stop wins on same-bar tie" priority rule. When a
 * spot trigger fires, the trade settles at the FROZEN plan premium (see
 * `pickExitPremium` in paperTradingFO.ts) — NOT a freshly re-quoted option
 * premium. This is intentional, documented, load-bearing design (see
 * `fnoPremiumExitOverlay.ts` header) that this task does NOT change: doing
 * so would alter realized P&L determinism for every future trade, which is
 * a strategy change, not a reliability fix, and is out of scope for this
 * DO-NOT list ("no entry/signal/scoring changes").
 *
 * The spec's literal Phase 2 language ("use latest fresh Kite option quote
 * as the exit price") is satisfied in spirit, not letter: `pickExitPremium`
 * already returns a Kite-derived, pre-locked value (never Yahoo/synthetic),
 * and the premium-collapse failure mode is separately covered by the
 * existing `decidePremiumHardStop` backstop (own 120s freshness gate). This
 * is a reasoned, documented spec deviation — see
 * FNO_EXIT_MONITORING_RELIABILITY_REPORT.md.
 *
 * The REAL, verified gap this module closes: the spot snapshot fed into
 * `evaluateTransition` can silently fall back from live Kite LTP to a
 * potentially-stale bar-close (optionSignals.ts ~L2522-2540) with NO trust
 * check before a terminal (STOPPED/TARGET1_HIT/TARGET2_HIT) lifecycle write
 * is made. `evaluateFnoPaperTradeExit` wraps `evaluateTransition` with an
 * explicit, fail-CLOSED trust/freshness gate on the spot quote's
 * provenance, using the SAME `DataQualityLabel` taxonomy already enforced
 * at signal-emission time (tradingConfig.ts) — Yahoo/stale spot data can
 * evaluate a trigger for DIAGNOSTIC purposes only (`wouldHaveExited`), it
 * can never actually close a trade.
 *
 * Zero math duplication: the stop/target comparison logic lives ONLY in
 * `evaluateTransition`; this module never re-implements it.
 */
import {
  evaluateTransition,
  type LifecycleStatus,
  type LifecycleExitReason,
  type SpotSnapshot,
} from "./optionSignalLifecycle";
import type { DataQualityLabel } from "./tradingConfig";

/** Matches PREMIUM_OVERLAY_FRESHNESS_WINDOW_MS convention (fnoPremiumExitOverlay.ts) — one ~30s sweep cycle of slack. */
export const SPOT_EXIT_FRESHNESS_WINDOW_MS = 120_000;

/** Fixed, documented priority rule applied inside `evaluateTransition`. Surfaced for observability/tests — not independently computed here. */
export const FNO_EXIT_PRIORITY_RULE = "STOP_WINS_ON_SAME_BAR_TIE" as const;

export type FnoExitBlockedReason =
  | "CONTRACT_INVALID"
  | "KITE_UNAVAILABLE"
  | "SOURCE_NOT_TRADE_GRADE"
  | "STALE_QUOTE";

export interface FnoExitQuoteProvenance {
  /** Same taxonomy already enforced at F&O signal emission (tradingConfig.ts). */
  source: DataQualityLabel;
  /** Whether the Kite broker session is currently ACTIVE (not just configured). */
  kiteSessionActive: boolean;
  /** ms epoch of the quote this snapshot represents, or null if unknown/never observed. */
  asOfMs: number | null;
}

export interface FnoExitDecisionInput {
  currentStatus: LifecycleStatus;
  direction: "BULLISH" | "BEARISH";
  entry: number;
  stop: number;
  target1: number;
  target2: number;
  snapshot: SpotSnapshot;
  provenance: FnoExitQuoteProvenance;
  /** ms epoch "now". */
  nowMs: number;
  /** Defaults to SPOT_EXIT_FRESHNESS_WINDOW_MS. */
  freshnessWindowMs?: number;
  /**
   * Caller-supplied contract validity (e.g. strike/expiry still resolvable
   * against the instrument master). Defaults to true — this module does not
   * fabricate contract validation that doesn't already exist upstream.
   */
  contractValid?: boolean;
}

interface DecisionBase {
  quoteSource: DataQualityLabel;
  quoteAsOfMs: number | null;
  quoteFreshnessSec: number | null;
}

export interface FnoExitDecisionExit extends DecisionBase {
  kind: "EXIT";
  next: LifecycleStatus;
  triggered: boolean;
  exitReason: LifecycleExitReason;
  /** Locked plan premium level corresponding to exitReason (settlement is FROZEN_PREMIUM, never a re-quoted live premium). */
  settlement: "FROZEN_PREMIUM";
  tradeGrade: true;
  priorityRule: typeof FNO_EXIT_PRIORITY_RULE;
}

export interface FnoExitDecisionHold extends DecisionBase {
  kind: "HOLD";
  next: LifecycleStatus;
  triggered: boolean;
  tradeGrade: true;
}

export interface FnoExitDecisionBlocked extends DecisionBase {
  kind: "BLOCKED";
  blockedReason: FnoExitBlockedReason;
  tradeGrade: false;
  /** Diagnostic only — NEVER used to actually close/mutate a trade. */
  wouldHaveExited: boolean;
  wouldHaveExitReason: LifecycleExitReason | null;
}

export type FnoExitDecision =
  | FnoExitDecisionExit
  | FnoExitDecisionHold
  | FnoExitDecisionBlocked;

function freshnessSecOf(nowMs: number, asOfMs: number | null): number | null {
  if (asOfMs == null || !Number.isFinite(asOfMs)) return null;
  return Math.max(0, Math.round((nowMs - asOfMs) / 1000));
}

/**
 * Decide whether a single OPEN F&O paper trade's underlying signal-lifecycle
 * row is eligible to advance to a terminal exit state, given the trust and
 * freshness of the spot quote driving the evaluation.
 *
 * Fail-CLOSED: any of CONTRACT_INVALID / KITE_UNAVAILABLE /
 * SOURCE_NOT_TRADE_GRADE (Yahoo/proxy/cache) / STALE_QUOTE (including a
 * missing quote, asOfMs=null) blocks the decision from closing anything —
 * `evaluateTransition` is still run so the caller can observe
 * `wouldHaveExited` for diagnostics, but that result MUST NOT be used to
 * mutate the lifecycle row or the paper trade.
 *
 * Precedence (first match wins, mirrors the codebase's existing
 * GlobalDataHealthStatus precedence style):
 *   1. contractValid === false        → CONTRACT_INVALID
 *   2. !kiteSessionActive              → KITE_UNAVAILABLE
 *   3. source === "DELAYED_YAHOO"      → SOURCE_NOT_TRADE_GRADE
 *   4. source === "STALE" || asOfMs==null → STALE_QUOTE
 *   5. freshnessSec > freshnessWindow  → STALE_QUOTE
 *   6. otherwise (LIVE_KITE_FULL/PARTIAL, session active, fresh) → trade-grade
 */
export function evaluateFnoPaperTradeExit(
  input: FnoExitDecisionInput,
): FnoExitDecision {
  const {
    currentStatus,
    direction,
    entry,
    stop,
    target1,
    target2,
    snapshot,
    provenance,
    nowMs,
    contractValid = true,
  } = input;
  const freshnessWindowMs =
    input.freshnessWindowMs ?? SPOT_EXIT_FRESHNESS_WINDOW_MS;
  const quoteFreshnessSec = freshnessSecOf(nowMs, provenance.asOfMs);

  const base: DecisionBase = {
    quoteSource: provenance.source,
    quoteAsOfMs: provenance.asOfMs,
    quoteFreshnessSec,
  };

  const trans = evaluateTransition(
    currentStatus,
    direction,
    entry,
    stop,
    target1,
    target2,
    snapshot,
  );

  const blockedResult = (
    blockedReason: FnoExitBlockedReason,
  ): FnoExitDecisionBlocked => ({
    kind: "BLOCKED",
    blockedReason,
    tradeGrade: false,
    wouldHaveExited: trans.exited,
    wouldHaveExitReason: trans.exitReason ?? null,
    ...base,
  });

  if (!contractValid) return blockedResult("CONTRACT_INVALID");
  if (!provenance.kiteSessionActive) return blockedResult("KITE_UNAVAILABLE");
  if (provenance.source === "DELAYED_YAHOO")
    return blockedResult("SOURCE_NOT_TRADE_GRADE");
  if (provenance.source === "STALE" || provenance.asOfMs == null)
    return blockedResult("STALE_QUOTE");
  if (quoteFreshnessSec != null && quoteFreshnessSec * 1000 > freshnessWindowMs)
    return blockedResult("STALE_QUOTE");

  if (trans.exited && trans.exitReason) {
    return {
      kind: "EXIT",
      next: trans.next,
      triggered: trans.triggered,
      exitReason: trans.exitReason,
      settlement: "FROZEN_PREMIUM",
      tradeGrade: true,
      priorityRule: FNO_EXIT_PRIORITY_RULE,
      ...base,
    };
  }
  return {
    kind: "HOLD",
    next: trans.next,
    triggered: trans.triggered,
    tradeGrade: true,
    ...base,
  };
}
