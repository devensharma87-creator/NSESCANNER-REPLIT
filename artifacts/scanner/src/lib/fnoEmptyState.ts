import type { OptionSignalSet } from "@workspace/api-client-react";
import type { KiteReadiness } from "@/components/global-status-banner";

// ── Session-expiry banner state ───────────────────────────────────────────────

export type FnoBannerKind =
  | "KITE_SESSION_EXPIRED"
  | "FNO_DATA_WARMING_UP"
  | "FNO_ALL_SUPPRESSED";

export type FnoBannerState =
  | { show: false }
  | {
      show: true;
      kind: FnoBannerKind;
      gapTradingDays: number | null;
      lastSignalAt: string | null;
      /** True when the gap is caused by a data/infra issue, not market conditions. */
      isDataIssue: boolean;
    };

/**
 * PURE: derive the F&O Kite-session / data-gap banner state.
 * Show only for owners (readiness !== null) during market hours.
 * Never shown if market is closed (expected empty state).
 *
 * Priority: KITE_SESSION_EXPIRED > DAILY_HISTORY_WARMUP > FNO_ALL_SUPPRESSED.
 * KITE_SESSION_EXPIRED wins because it requires user action (reconnect);
 * DAILY_HISTORY_WARMUP is transient and auto-clears after ~2 min.
 */
export function deriveSessionBannerState(
  data: OptionSignalSet | undefined,
  readiness: KiteReadiness | null,
  gapTradingDays: number | null | undefined,
  lastSignalAny: string | null | undefined,
): FnoBannerState {
  if (readiness == null) return { show: false }; // non-owner
  // Only trust marketStatus.marketOpen — never fall back to deprecated marketState.
  // Stale React Query cache can hold marketState="closed" from a prior session, which
  // would incorrectly suppress the banner during actual market hours.
  const marketClosed = data?.marketStatus != null && !data.marketStatus.marketOpen;
  if (marketClosed) return { show: false };

  const suppressed = data?.diagnostics?.suppressed ?? [];
  // Only surface the banner when all 3 F&O indices are suppressed.
  if (suppressed.length < 3) return { show: false };

  const reasons = suppressed.flatMap(s => s.reasons ?? []);
  const hasKiteExpiry = reasons.some(r => r.includes("no_live_kite_intraday"));
  const hasWarmup = reasons.some(r => r.includes("daily_history_warmup_kite"));

  const gap = gapTradingDays ?? null;
  const last = lastSignalAny ?? null;

  // Session expiry requires user action → highest priority.
  if (hasKiteExpiry || !readiness.sessionValid) {
    return { show: true, kind: "KITE_SESSION_EXPIRED", gapTradingDays: gap, lastSignalAt: last, isDataIssue: true };
  }
  // Warmup is transient (auto-clears ~2 min after login) → second priority.
  if (hasWarmup) {
    return { show: true, kind: "FNO_DATA_WARMING_UP", gapTradingDays: gap, lastSignalAt: last, isDataIssue: true };
  }
  return { show: true, kind: "FNO_ALL_SUPPRESSED", gapTradingDays: gap, lastSignalAt: last, isDataIssue: false };
}

/** F&O universe surfaced in the per-index diagnostics table (spec PART C). */
export const FNO_TABLE_INDICES = ["NIFTY", "BANKNIFTY", "SENSEX"] as const;

/**
 * PURE cause-of-emptiness deriver for the F&O live tab (unit-tested). Priority
 * matches spec C.1: market closed → Kite live intraday offline → option chain
 * unavailable → nothing cleared the confidence floor / risk gates. It reads ONLY
 * server-provided state (marketState + readiness + suppressed reason strings) and
 * NEVER recomputes a signal or changes any trading decision.
 */
export function deriveFnoEmptyReason(
  data: OptionSignalSet | undefined,
  readiness: KiteReadiness | null,
): string {
  // Only trust marketStatus.marketOpen — never fall back to deprecated marketState.
  // Stale React Query cache can hold marketState="closed" from a prior closed session;
  // using it would falsely say "market is closed" during actual trading hours.
  // When marketStatus is absent (pre-fix stale cache), assume market might be open
  // and show the generic empty-state message — it clears on the next fresh fetch.
  if (data?.marketStatus != null && !data.marketStatus.marketOpen) {
    return "No setups because the market is closed.";
  }
  const kiteOffline = readiness ? (!readiness.sessionValid || !readiness.feedConnected) : false;
  if (kiteOffline) {
    return "No setups because Kite live intraday data is unavailable. Reconnect Kite.";
  }
  const reasons = (data?.diagnostics?.suppressed ?? []).flatMap(s => s.reasons ?? []);
  const chainUnavailable = reasons.some(r => /option[\s_-]?chain|chain unavailable/i.test(r));
  if (chainUnavailable) {
    return "No setups because the option chain is unavailable.";
  }
  return "No setups because no candidate cleared the confidence floor or risk gates right now.";
}

export interface FnoIndexRow {
  index: string;
  liveKiteData: string;
  lastCandle: string;
  optionChain: string;
  candidate: string;
  state: string;
  reason: string;
}

/**
 * PURE per-index diagnostics table builder (unit-tested). Assembles cells ONLY
 * from data already on the wire (signals + diagnostics.suppressed + marketState)
 * plus owner readiness. Unknown cells render as "—" — never a fabricated value.
 */
export function buildFnoIndexRows(
  data: OptionSignalSet | undefined,
  readiness: KiteReadiness | null,
): FnoIndexRow[] {
  const signals = data?.signals ?? [];
  const suppressed = data?.diagnostics?.suppressed ?? [];
  const marketState = data?.marketState;

  // Owner readiness is global (not per-index). For non-owners readiness is null
  // → "—" (honest unknown), never a fake "Live".
  const liveKite = readiness == null
    ? "—"
    : readiness.sessionValid && readiness.feedConnected
      ? "Live"
      : "Offline";

  // Prefer the reliable marketStatus fields; fall back to deprecated marketState.
  const stateLabel = data?.marketStatus != null
    ? (data.marketStatus.marketOpen ? "Open"
       : data.marketStatus.reason === "PRE_OPEN" ? "Pre-open"
       : "Closed")
    : marketState === "open" ? "Open"
      : marketState === "pre_open" ? "Pre-open"
      : marketState === "closed" ? "Closed"
      : "—";

  return FNO_TABLE_INDICES.map(index => {
    const idxSignals = signals.filter(s => s.index === index);
    const sup = suppressed.find(s => s.index === index);
    const reasons = sup?.reasons ?? [];
    const reasonText = reasons.length ? reasons.join("; ") : (idxSignals.length ? "Setups live" : "—");
    const chainUnavailable = reasons.some(r => /option[\s_-]?chain|chain unavailable/i.test(r));
    const optionChain = idxSignals.length ? "Available" : chainUnavailable ? "Unavailable" : "—";
    return {
      index,
      liveKiteData: liveKite,
      lastCandle: "—",
      optionChain,
      candidate: idxSignals.length ? `Yes (${idxSignals.length})` : "No",
      state: stateLabel,
      reason: reasonText,
    };
  });
}
