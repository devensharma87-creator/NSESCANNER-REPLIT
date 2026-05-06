import { activeProvider } from "./dataProvider";

export const CONFIDENCE_THRESHOLDS = {
  MIN_FNO_TRADE: 70,
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
 * Policy:
 *   - LIVE_KITE_*  → always actionable.
 *   - STALE        → never actionable. Older than the Yahoo 15-min floor;
 *                    prices cannot be trusted for new entries.
 *   - DELAYED_YAHOO → actionable BY DEFAULT. Set env var
 *                    `PAPER_TRADE_KITE_ONLY=1` to restore the strict
 *                    Kite-only policy. Reason for the default flip:
 *                    when Kite is throttled / session-expired / down,
 *                    the UI keeps emitting signals (Yahoo fallback) but
 *                    the engine was silently dropping ALL of them, so
 *                    the user saw "many triggered, zero executed" with
 *                    no audit trail. The downstream MissedSignals card
 *                    surfaces the dataQuality on every skip regardless.
 */
export function isActionableForFno(quality: DataQualityLabel): boolean {
  if (quality === "LIVE_KITE_FULL" || quality === "LIVE_KITE_PARTIAL") return true;
  if (quality === "STALE") return false;
  return process.env.PAPER_TRADE_KITE_ONLY !== "1";
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
