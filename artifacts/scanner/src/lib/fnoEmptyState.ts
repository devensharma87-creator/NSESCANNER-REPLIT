import type { OptionSignalSet } from "@workspace/api-client-react";
import type { KiteReadiness } from "@/components/global-status-banner";

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
  if (data?.marketState && data.marketState !== "open") {
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

  const stateLabel = marketState === "open" ? "Open"
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
