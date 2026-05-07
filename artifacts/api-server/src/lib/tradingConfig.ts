import { activeProvider } from "./dataProvider";

export const CONFIDENCE_THRESHOLDS = {
  // Aligned with HC_EMISSION_FLOOR (optionSignals.ts) so we stop the
  // double-gate: if the confluence engine emits the signal at >=65, the
  // paper trader trusts it. Was 70 pre-Phase-3, before the confluence
  // engine started haircutting confidence directly.
  MIN_FNO_TRADE: 65,
  MIN_SWING_TRADE: 65,
  MIN_BASELINE_DISPLAY: 35,
  HTF_CONFLICT_HAIRCUT: 12,
} as const;

export const DATA_QUALITY_LABELS = [
  "LIVE_KITE_FULL",
  "LIVE_KITE_PARTIAL",
  "DELAYED_YAHOO",
  "STALE",
] as const;
export type DataQualityLabel = (typeof DATA_QUALITY_LABELS)[number];

export function resolveDataQuality(intraSrc: "kite" | "yahoo" | null): DataQualityLabel {
  if (intraSrc === "kite") {
    return activeProvider() === "kite" ? "LIVE_KITE_FULL" : "LIVE_KITE_PARTIAL";
  }
  return intraSrc === "yahoo" ? "DELAYED_YAHOO" : "STALE";
}

/**
 * Whether a signal with this data-quality label is actionable for paper
 * F&O trading.
 *
 * Policy (PERMANENTLY KITE-ONLY as of 2026-05-06 — hard cut, no override):
 *   - LIVE_KITE_*  → always actionable.
 *   - DELAYED_YAHOO → NEVER actionable. The previous PAPER_TRADE_ALLOW_YAHOO
 *                    escape hatch was REMOVED — the user explicitly
 *                    demanded Yahoo never touch F&O. Emission is also
 *                    Kite-gated upstream (optionSignals.ts), so this
 *                    label should not even appear at the trade gate;
 *                    if it does, refuse the entry.
 *   - STALE        → never actionable.
 */
export function isActionableForFno(quality: DataQualityLabel): boolean {
  return quality === "LIVE_KITE_FULL" || quality === "LIVE_KITE_PARTIAL";
}

export const VOL_REGIME_THRESHOLDS = {
  LOW: 10,
  NORMAL: 18,
  HIGH: 28,
} as const;

export type VolRegime = "LOW" | "NORMAL" | "HIGH" | "EXTREME";

export function classifyVolRegime(realizedVol14: number | null): VolRegime {
  if (realizedVol14 == null) return "NORMAL";
  if (realizedVol14 < VOL_REGIME_THRESHOLDS.LOW) return "LOW";
  if (realizedVol14 < VOL_REGIME_THRESHOLDS.NORMAL) return "NORMAL";
  if (realizedVol14 < VOL_REGIME_THRESHOLDS.HIGH) return "HIGH";
  return "EXTREME";
}
