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
 * Policy (PERMANENTLY KITE-ONLY as of 2026-05-06):
 *   - LIVE_KITE_*  → always actionable.
 *   - DELAYED_YAHOO → NEVER actionable. Yahoo's 15-min delay caused
 *                    phantom stop hits, wrong entry prices, and the
 *                    "signal triggered but broker says different" gap
 *                    that dominated the audit backlog. F&O signal
 *                    emission itself is now Kite-gated upstream
 *                    (optionSignals.ts skips emission on Yahoo bars),
 *                    so this label should rarely appear at the trade
 *                    gate — but if it does, we refuse the entry.
 *   - STALE        → never actionable.
 *
 * Escape hatch: `PAPER_TRADE_ALLOW_YAHOO=1` re-permits Yahoo-quality
 * signals if you ever need to trade on the delayed feed (e.g. a known
 * Kite outage where you accept the lag). Default is OFF.
 */
export function isActionableForFno(quality: DataQualityLabel): boolean {
  if (quality === "LIVE_KITE_FULL" || quality === "LIVE_KITE_PARTIAL") return true;
  if (quality === "STALE") return false;
  // DELAYED_YAHOO: refuse by default; allow only with explicit override.
  return process.env.PAPER_TRADE_ALLOW_YAHOO === "1";
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
