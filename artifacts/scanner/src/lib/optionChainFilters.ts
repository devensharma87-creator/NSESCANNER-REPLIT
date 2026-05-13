import type { OptionChainStrikeRow } from "@workspace/api-client-react";

export type StrikeFilter = "all" | "atm5" | "atm10" | "highOi" | "unusual" | "oiSpike";

export const OI_SPIKE_MIN_OI = 5_000;
export const OI_SPIKE_MIN_RATIO = 0.15;
export const UNUSUAL_VOL_OI_RATIO = 1.5;
export const HIGH_OI_PCT_OF_MAX = 0.3;

export interface ApplyStrikeFilterArgs {
  rows: readonly OptionChainStrikeRow[];
  filter: StrikeFilter;
  atmStrike: number;
  maxOi: number;
}

export function applyStrikeFilter({ rows, filter, atmStrike, maxOi }: ApplyStrikeFilterArgs): OptionChainStrikeRow[] {
  if (!rows.length) return [];
  const atmIdx = rows.findIndex(r => r.strike === atmStrike);

  switch (filter) {
    case "atm5": {
      if (atmIdx < 0) return [...rows];
      const lo = Math.max(0, atmIdx - 5);
      const hi = Math.min(rows.length, atmIdx + 6);
      return rows.slice(lo, hi);
    }
    case "atm10": {
      if (atmIdx < 0) return [...rows];
      const lo = Math.max(0, atmIdx - 10);
      const hi = Math.min(rows.length, atmIdx + 11);
      return rows.slice(lo, hi);
    }
    case "highOi": {
      const threshold = maxOi * HIGH_OI_PCT_OF_MAX;
      return rows.filter(r => (r.ce?.oi ?? 0) >= threshold || (r.pe?.oi ?? 0) >= threshold);
    }
    case "unusual": {
      return rows.filter(r => {
        const ceVol = r.ce?.volOiRatio ?? 0;
        const peVol = r.pe?.volOiRatio ?? 0;
        return ceVol >= UNUSUAL_VOL_OI_RATIO || peVol >= UNUSUAL_VOL_OI_RATIO;
      });
    }
    case "oiSpike": {
      return rows.filter(r => isOiSpike(r.ce) || isOiSpike(r.pe));
    }
    case "all":
    default:
      return [...rows];
  }
}

function isOiSpike(side: OptionChainStrikeRow["ce"]): boolean {
  if (!side) return false;
  const oi = side.oi ?? 0;
  const chg = side.chgOi ?? 0;
  if (oi < OI_SPIKE_MIN_OI) return false;
  if (oi <= 0) return false;
  return Math.abs(chg) / oi >= OI_SPIKE_MIN_RATIO;
}
