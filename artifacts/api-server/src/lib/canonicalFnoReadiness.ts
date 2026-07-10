/**
 * CanonicalFnoReadiness — Checkpoint 1, Part B.
 *
 * Single honest, read-only roll-up of "is F&O data trade-grade right now,
 * and if not, exactly why?". Pure composition of ALREADY-COMPUTED facts from
 * existing primitives — no new data fetches, no scheduler, no strategy or
 * broker changes:
 *
 *   - getKiteReadiness()        → Kite session / feed / market-session state
 *   - getLastFnoCycleState()    → last completed signal cycle (bars success,
 *                                 per-index suppression reasons, signal counts)
 *   - getLastRun() (option-chain snapshot ingestor) → last option-chain
 *                                 capture outcome (write-only substrate; used
 *                                 here for display-only readiness, never for
 *                                 trading decisions)
 *   - classifyDataFailure()     → Part A's reason-code classifier, reused so
 *                                 the digest and this surface share one
 *                                 known-cause vocabulary
 *   - isPaperAutoTradingEnabled() → dev-vs-prod paper-trading gate
 *
 * The module splits into a pure builder (`buildCanonicalFnoReadiness`, unit
 * tested with explicit inputs per repo convention) and a thin async gatherer
 * (`getCanonicalFnoReadiness`) that reads the live singletons and calls it.
 *
 * VISIBILITY ONLY. Never places orders, never mutates any trading/signal
 * state, never fabricates readiness. Yahoo/cache/display-only sources are
 * never marked trade-grade.
 */

import { getKiteReadiness } from "./kiteReadiness";
import { getLastFnoCycleState, OPTION_INDICES } from "./optionSignals";
import { getLastRun as getLastOptionSnapshotRun, isOptionSnapshotEnabled } from "./optionChainSnapshotIngestor";
import { classifyDataFailure, type DataFailureContext } from "./fnoFailureDiagnosis";
import { isNseHoliday, computeMarketStatus } from "./marketEvents";
import { isPaperAutoTradingEnabled } from "./paperAutoTradeFlag";

export type KiteSessionState = "ACTIVE" | "MISSING" | "EXPIRED" | "UNKNOWN";
export type FeedConnState = "CONNECTED" | "DISCONNECTED" | "STALE" | "UNKNOWN";
export type MarketSessionLabel = "preopen" | "open" | "closed" | "holiday" | "unknown";
export type BarsStatus = "READY" | "PARTIAL" | "MISSING" | "UNKNOWN";
export type OptionChainReadinessStatus = "READY" | "PARTIAL" | "MISSING" | "STALE" | "UNKNOWN";
export type SignalCycleStatus = "READY" | "NO_SETUP" | "DATA_BLOCKED" | "MARKET_CLOSED" | "UNKNOWN";

export interface CanonicalFnoReadiness {
  checkedAt: string;
  kiteSession: KiteSessionState;
  feedStatus: FeedConnState;
  marketSession: MarketSessionLabel;
  dailyBars: { status: BarsStatus; readyCount: number; totalCount: number; reason: string | null };
  intradayBars: { status: BarsStatus; readyCount: number; totalCount: number; reason: string | null };
  optionChain: { status: OptionChainReadinessStatus; reason: string | null };
  signalCycle: {
    lastCycleAt: string | null;
    generatedSignals: number;
    tradeableSignals: number;
    suppressedSignals: number;
    status: SignalCycleStatus;
    reasons: string[];
    /** Names of suppressed indices (e.g. ["BANKNIFTY"]) for per-index granularity in reports. */
    suppressedIndices: string[];
  };
  tradeGrade: boolean;
  canGenerateSignals: boolean;
  canOpenPaperTrades: boolean;
  telegramSummary: string;
}

export type FnoCycleMetaLike = NonNullable<ReturnType<typeof getLastFnoCycleState>>;

export interface OptionSnapshotRunLike {
  underlyingsAttempted: number;
  underlyingsOk: number;
  errors: Array<{ underlying: string; expiry?: string; message: string }>;
}

export interface CanonicalFnoReadinessInputs {
  now: Date;
  kite: {
    sessionValid: boolean;
    sessionPresent: boolean;
    feedConnected: boolean;
    feedRunning: boolean;
    /** Raw market-session phase as reported by Kite readiness (pre-holiday-aware). */
    marketSession: "open" | "closed" | "pre_open";
  };
  cycle: FnoCycleMetaLike | null;
  optionSnapshot: {
    enabled: boolean;
    lastRun: OptionSnapshotRunLike | null;
  };
  totalIndices: number;
  paperAutoTradingEnabled: boolean;
}

/** IST wall-clock market session label, distinguishing NSE holidays from plain closed. */
export function deriveMarketSessionLabel(now: Date, rawStatus: "open" | "closed" | "pre_open"): MarketSessionLabel {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const dow = ist.getUTCDay();
  if (dow !== 0 && dow !== 6 && isNseHoliday(ist)) return "holiday";
  if (rawStatus === "pre_open") return "preopen";
  return rawStatus;
}

function barsStatus(readyCount: number, totalCount: number, hasCycle: boolean): BarsStatus {
  if (!hasCycle || totalCount <= 0) return "UNKNOWN";
  if (readyCount <= 0) return "MISSING";
  if (readyCount >= totalCount) return "READY";
  return "PARTIAL";
}

/**
 * Split the F&O cycle's per-index suppression list into daily-vs-intraday
 * failure counts using the same substring markers `optionSignals.ts` already
 * stamps (`no_live_kite_intraday`, `daily_history_*`). Any suppression text
 * that doesn't match either marker (e.g. an unexpected exception) is
 * conservatively attributed to the intraday stage, since that check runs
 * first in the pipeline and a failure there prevents the daily check from
 * ever running.
 */
function splitSuppressionByStage(suppressed: { index: string; reasons: string[] }[]): {
  intradayFailed: number;
  dailyFailed: number;
  intradayReason: string | null;
  dailyReason: string | null;
} {
  let intradayFailed = 0;
  let dailyFailed = 0;
  let intradayReasonRaw: string | null = null;
  let dailyReasonRaw: string | null = null;
  for (const s of suppressed) {
    const reasonText = s.reasons[0] ?? "";
    if (reasonText.includes("daily_history")) {
      dailyFailed++;
      if (!dailyReasonRaw) dailyReasonRaw = reasonText;
    } else {
      // Covers `no_live_kite_intraday` and any unmatched/exception text.
      intradayFailed++;
      if (!intradayReasonRaw) intradayReasonRaw = reasonText;
    }
  }
  return { intradayFailed, dailyFailed, intradayReason: intradayReasonRaw, dailyReason: dailyReasonRaw };
}

function humanizeReason(raw: string | null, ctx: DataFailureContext): string | null {
  if (!raw) return null;
  return classifyDataFailure(raw, ctx).message;
}

/** Pure builder — unit tested directly with explicit inputs, no live I/O. */
export function buildCanonicalFnoReadiness(inputs: CanonicalFnoReadinessInputs): CanonicalFnoReadiness {
  const { now, kite, cycle, optionSnapshot, totalIndices, paperAutoTradingEnabled } = inputs;
  const checkedAt = now.toISOString();
  const marketSession = deriveMarketSessionLabel(now, kite.marketSession);

  const kiteSession: KiteSessionState = kite.sessionValid ? "ACTIVE" : kite.sessionPresent ? "EXPIRED" : "MISSING";
  const feedStatusOut: FeedConnState = kite.feedConnected ? "CONNECTED" : kite.feedRunning ? "STALE" : "DISCONNECTED";

  const classifyCtx: DataFailureContext = {
    sessionValid: kite.sessionValid,
    marketSession: kite.marketSession,
    feedConnected: kite.feedConnected,
  };

  let dailyBars: CanonicalFnoReadiness["dailyBars"];
  let intradayBars: CanonicalFnoReadiness["intradayBars"];

  if (cycle) {
    const { intradayFailed, dailyFailed, intradayReason, dailyReason } = splitSuppressionByStage(cycle.suppressed);
    // Indices that fail on the intraday stage never reach the daily check, so
    // they are absent from that index's readiness rather than double-counted
    // as a daily failure too.
    const intradayReadyCount = Math.max(0, totalIndices - intradayFailed);
    const dailyReadyCount = Math.max(0, totalIndices - intradayFailed - dailyFailed);
    intradayBars = {
      status: barsStatus(intradayReadyCount, totalIndices, true),
      readyCount: intradayReadyCount,
      totalCount: totalIndices,
      reason: humanizeReason(intradayReason, { ...classifyCtx, failedStep: "intradayBars" }),
    };
    dailyBars = {
      status: barsStatus(dailyReadyCount, totalIndices, true),
      readyCount: dailyReadyCount,
      totalCount: totalIndices,
      reason: humanizeReason(dailyReason, { ...classifyCtx, failedStep: "dailyBars" }),
    };
  } else {
    intradayBars = { status: "UNKNOWN", readyCount: 0, totalCount: totalIndices, reason: null };
    dailyBars = { status: "UNKNOWN", readyCount: 0, totalCount: totalIndices, reason: null };
  }

  const optionChain = (() => {
    if (!optionSnapshot.enabled) {
      return { status: "UNKNOWN" as OptionChainReadinessStatus, reason: "Option-chain snapshot ingestion disabled." };
    }
    const run = optionSnapshot.lastRun;
    if (!run) {
      return { status: "UNKNOWN" as OptionChainReadinessStatus, reason: "No option-chain snapshot has run yet." };
    }
    if (run.underlyingsOk >= run.underlyingsAttempted && run.underlyingsAttempted > 0) {
      return { status: "READY" as OptionChainReadinessStatus, reason: null };
    }
    if (run.underlyingsOk > 0) {
      const firstErr = run.errors[0];
      return {
        status: "PARTIAL" as OptionChainReadinessStatus,
        reason: firstErr ? `${firstErr.underlying}: ${firstErr.message}` : "Partial option-chain capture.",
      };
    }
    const firstErr = run.errors[0];
    return {
      status: "MISSING" as OptionChainReadinessStatus,
      reason: firstErr ? `${firstErr.underlying}: ${firstErr.message}` : "Option-chain capture failed for all underlyings.",
    };
  })();

  const marketClosed = marketSession === "closed" || marketSession === "holiday";
  const dataBlocked =
    kiteSession !== "ACTIVE" ||
    feedStatusOut === "DISCONNECTED" ||
    dailyBars.status === "MISSING" ||
    intradayBars.status === "MISSING";

  let signalCycleStatus: SignalCycleStatus;
  if (marketClosed) {
    signalCycleStatus = "MARKET_CLOSED";
  } else if (!cycle) {
    signalCycleStatus = "UNKNOWN";
  } else if (dataBlocked) {
    signalCycleStatus = "DATA_BLOCKED";
  } else if (cycle.signalCount === 0) {
    signalCycleStatus = "NO_SETUP";
  } else {
    signalCycleStatus = "READY";
  }

  const cycleReasons = cycle ? cycle.suppressed.map((s) => s.reasons[0] ?? s.index).filter(Boolean) : [];
  const suppressedIndices = cycle ? cycle.suppressed.map((s) => s.index) : [];

  const tradeGrade =
    kiteSession === "ACTIVE" &&
    feedStatusOut === "CONNECTED" &&
    marketSession === "open" &&
    dailyBars.status === "READY" &&
    intradayBars.status === "READY";

  const canGenerateSignals =
    kiteSession === "ACTIVE" &&
    feedStatusOut !== "DISCONNECTED" &&
    dailyBars.status !== "MISSING" &&
    dailyBars.status !== "UNKNOWN" &&
    intradayBars.status !== "MISSING" &&
    intradayBars.status !== "UNKNOWN";

  const canOpenPaperTrades = canGenerateSignals && (cycle?.highConvictionCount ?? 0) > 0 && paperAutoTradingEnabled;

  const telegramSummary = buildTelegramSummary({
    kiteSession,
    feedStatus: feedStatusOut,
    marketSession,
    dailyBars,
    intradayBars,
    optionChain,
    signalCycleStatus,
    generatedSignals: cycle?.signalCount ?? 0,
    tradeableSignals: cycle?.highConvictionCount ?? 0,
    suppressedSignals: cycle?.suppressed.length ?? 0,
    suppressedIndices,
  });

  return {
    checkedAt,
    kiteSession,
    feedStatus: feedStatusOut,
    marketSession,
    dailyBars,
    intradayBars,
    optionChain,
    signalCycle: {
      lastCycleAt: cycle ? new Date(cycle.ts).toISOString() : null,
      generatedSignals: cycle?.signalCount ?? 0,
      tradeableSignals: cycle?.highConvictionCount ?? 0,
      suppressedSignals: cycle?.suppressed.length ?? 0,
      status: signalCycleStatus,
      reasons: cycleReasons,
      suppressedIndices,
    },
    tradeGrade,
    canGenerateSignals,
    canOpenPaperTrades,
    telegramSummary,
  };
}

function buildTelegramSummary(f: {
  kiteSession: KiteSessionState;
  feedStatus: FeedConnState;
  marketSession: MarketSessionLabel;
  dailyBars: CanonicalFnoReadiness["dailyBars"];
  intradayBars: CanonicalFnoReadiness["intradayBars"];
  optionChain: CanonicalFnoReadiness["optionChain"];
  signalCycleStatus: SignalCycleStatus;
  generatedSignals: number;
  tradeableSignals: number;
  suppressedSignals: number;
  suppressedIndices: string[];
}): string {
  const parts = [
    `Kite: ${f.kiteSession} | Feed: ${f.feedStatus} | Market: ${f.marketSession}`,
    `F&O readiness: ${f.signalCycleStatus}`,
    `Daily bars: ${f.dailyBars.readyCount}/${f.dailyBars.totalCount}${f.dailyBars.reason ? ` (${f.dailyBars.reason})` : ""}`,
    `Intraday bars: ${f.intradayBars.readyCount}/${f.intradayBars.totalCount}${f.intradayBars.reason ? ` (${f.intradayBars.reason})` : ""}`,
    `Option chain: ${f.optionChain.status}`,
    `Signals: generated ${f.generatedSignals} | tradeable ${f.tradeableSignals} | suppressed ${f.suppressedSignals}`,
  ];
  if (f.suppressedIndices.length > 0 && (f.signalCycleStatus === "DATA_BLOCKED" || f.suppressedSignals > 0)) {
    parts.push(`Suppressed: ${f.suppressedIndices.join(", ")}`);
  }
  return parts.join("\n");
}

/**
 * Derive the compact top-line readiness label used by the pre-market report
 * ("F&O readiness: READY / PARTIAL / DATA_BLOCKED / MARKET_CLOSED / NO_SETUP").
 * This is a display-only refinement of `signalCycle.status` — it never
 * changes the underlying typed contract, it just recovers the PARTIAL case
 * (some but not all indices have bars) that `signalCycle.status` folds into
 * DATA_BLOCKED for the machine-readable field.
 */
export function deriveFnoReadinessLabel(
  r: CanonicalFnoReadiness,
): "READY" | "PARTIAL" | "DATA_BLOCKED" | "MARKET_CLOSED" | "NO_SETUP" {
  if (r.signalCycle.status === "MARKET_CLOSED") return "MARKET_CLOSED";
  // Incomplete bar coverage (some but not all indices) is reported honestly
  // as PARTIAL even when the indices that DID succeed still produced
  // signals — overstating that as full READY would hide the gap.
  if (r.dailyBars.status === "PARTIAL" || r.intradayBars.status === "PARTIAL") return "PARTIAL";
  if (r.signalCycle.status === "READY") return "READY";
  if (r.signalCycle.status === "NO_SETUP") return "NO_SETUP";
  return "DATA_BLOCKED";
}

/** Thin async gatherer: reads the live singletons and delegates to the pure builder. */
export async function getCanonicalFnoReadiness(now: Date = new Date()): Promise<CanonicalFnoReadiness> {
  const kite = await getKiteReadiness();
  const cycle = getLastFnoCycleState();
  const enabled = isOptionSnapshotEnabled();
  const lastRun = enabled ? getLastOptionSnapshotRun() : null;

  return buildCanonicalFnoReadiness({
    now,
    kite: {
      sessionValid: kite.sessionValid,
      sessionPresent: kite.sessionPresent,
      feedConnected: kite.feedConnected,
      feedRunning: kite.feedRunning,
      marketSession: kite.marketSession,
    },
    cycle,
    optionSnapshot: { enabled, lastRun },
    totalIndices: OPTION_INDICES.length,
    paperAutoTradingEnabled: isPaperAutoTradingEnabled(),
  });
}
