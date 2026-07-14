/**
 * Per-setup "why this setup" explanation (display-only, P3).
 *
 * Pure derivation from fields the signal ALREADY carries on the wire — it adds
 * NO new computation, re-runs NO gate threshold, and fabricates nothing. The
 * paper-trade-allowed flag is taken straight from the server-authoritative
 * `tradeClass` (TRADEABLE ⇒ the auto-trader may open it); the human reason is
 * merely LABELLED from the existing veto tags / premium-trust / tier fields so
 * the owner can see at a glance why a surfaced setup is or isn't auto-tradeable.
 *
 * This module never imports server code (cross-artifact boundary) and never
 * places an order or mutates a signal.
 */
import type { OptionSignal } from "@workspace/api-client-react";

/** Veto tag strings as emitted on `OptionSignal.tags` by the signal engine. */
export const VETO_TAG = {
  RECOVERY: "RECOVERY_MODE_VETO",
  CHASE: "CHASE_RISK_VETO",
} as const;

export type PaperTradeReason =
  | "TRADEABLE"
  | "RECOVERY_VETO"
  | "CHASE_VETO"
  | "PREMIUM_UNTRUSTED"
  | "INFO_ONLY_TIER"
  | "INFO_ONLY";

const PAPER_TRADE_REASON_TEXT: Record<PaperTradeReason, string> = {
  TRADEABLE: "Auto-tradeable — STANDARD-tier high-conviction setup on Kite-trusted premium.",
  RECOVERY_VETO: "Blocked — recovery-mode veto (counter-trend bounce risk).",
  CHASE_VETO: "Blocked — chase-risk veto (late, extended entry).",
  PREMIUM_UNTRUSTED: "Blocked — option premium is not Kite-trusted (fallback / stale / missing).",
  INFO_ONLY_TIER: "Info-only — BASELINE tier, surfaced for context but never auto-traded.",
  INFO_ONLY: "Info-only — not classified TRADEABLE; surfaced for context only.",
};

export interface SetupExplanation {
  /** HIGH_CONVICTION / BASELINE / "—" when absent. */
  tier: string;
  regime: string | null;
  regimeReason: string | null;
  /** e.g. "BUY CALL (bullish)" / "BUY PUT (bearish)". */
  direction: string;
  trigger: string | null;
  /** Human veto label when a recovery/chase veto tag is present; null otherwise. */
  vetoStatus: string | null;
  dataQuality: string | null;
  premiumSource: string | null;
  premiumTrusted: boolean;
  premiumWarning: string | null;
  riskReward: number | null;
  /** Server-authoritative: true only when tradeClass === "TRADEABLE". */
  paperTradeAllowed: boolean;
  paperTradeReason: PaperTradeReason;
  paperTradeReasonText: string;
}

const hasTag = (sig: OptionSignal, tag: string): boolean =>
  Array.isArray(sig.tags) && sig.tags.includes(tag);

/**
 * Resolve why a signal is (not) auto-tradeable. The allow flag is purely
 * `tradeClass === "TRADEABLE"` (fail-closed when undefined). When NOT tradeable
 * the reason is labelled from existing fields in the same priority the engine
 * applies: recovery veto → chase veto → untrusted premium → BASELINE tier →
 * generic info-only.
 */
export function derivePaperTradeReason(sig: OptionSignal): PaperTradeReason {
  if (sig.tradeClass === "TRADEABLE") return "TRADEABLE";
  if (hasTag(sig, VETO_TAG.RECOVERY)) return "RECOVERY_VETO";
  if (hasTag(sig, VETO_TAG.CHASE)) return "CHASE_VETO";
  if (sig.premiumTrusted !== true) return "PREMIUM_UNTRUSTED";
  if (sig.tier === "BASELINE") return "INFO_ONLY_TIER";
  return "INFO_ONLY";
}

export function deriveSetupExplanation(sig: OptionSignal): SetupExplanation {
  const isCall = sig.leg?.type === "CALL";
  const direction = isCall ? "BUY CALL (bullish)" : "BUY PUT (bearish)";

  const vetoStatus = hasTag(sig, VETO_TAG.RECOVERY)
    ? "Recovery-mode veto"
    : hasTag(sig, VETO_TAG.CHASE)
      ? "Chase-risk veto"
      : null;

  const reason = derivePaperTradeReason(sig);

  return {
    tier: sig.tier ?? "—",
    regime: sig.regime ?? null,
    regimeReason: sig.regimeReason ?? null,
    direction,
    trigger: sig.entryTrigger ?? null,
    vetoStatus,
    dataQuality: sig.dataQuality ?? null,
    premiumSource: sig.premiumSource ?? null,
    premiumTrusted: sig.premiumTrusted === true,
    premiumWarning: sig.premiumWarning ?? null,
    riskReward: sig.leg?.riskRewardRatio ?? null,
    paperTradeAllowed: sig.tradeClass === "TRADEABLE",
    paperTradeReason: reason,
    paperTradeReasonText: PAPER_TRADE_REASON_TEXT[reason],
  };
}
