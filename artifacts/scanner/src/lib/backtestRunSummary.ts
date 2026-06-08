import type { BacktestFilterConfig } from "@workspace/api-client-react";

// Filter toggles that depend on option/spread/volume history we do NOT have — always
// auto-disabled and shown as such (never silently applied).
export const AUTO_DISABLED_FILTERS: (keyof BacktestFilterConfig)[] = [
  "optionChainConfirmation",
  "avoidWideSpread",
  "avoidLowVolume",
];

export const FILTER_LABELS: Record<keyof BacktestFilterConfig, string> = {
  vwapFilter: "VWAP Filter",
  emaTrendFilter: "EMA Trend Filter",
  optionChainConfirmation: "Option Chain Confirmation",
  avoidChopZone: "Avoid Chop Zone",
  avoidLast15Minutes: "Avoid Last 15 Minutes",
  avoidWideSpread: "Avoid Wide Spread Options",
  avoidLowVolume: "Avoid Low Volume Options",
  minimumRiskReward: "Minimum Risk:Reward",
};

export const DEFAULT_FILTERS: Required<BacktestFilterConfig> = {
  vwapFilter: true,
  emaTrendFilter: true,
  optionChainConfirmation: false,
  avoidChopZone: true,
  avoidLast15Minutes: true,
  avoidWideSpread: false,
  avoidLowVolume: false,
  minimumRiskReward: 1.5,
};

// Named confirmation-filter presets shown as one-click pills in the Backtest Lab.
// MIRROR of the server-side FILTER_PRESETS (api-server base.ts) — the frontend
// cannot import the server lib, so DEFAULT_FILTERS is already duplicated here by
// design and these presets follow the same convention. Keep the two in sync.
// All presets keep the hard safety rails (market hours, 15:20 force-exit,
// last-15-min entry cutoff, defined-risk geometry); they differ only in how many
// discretionary confirmation gates stack + the per-day trade cap. Practical is
// the default and trades all six strategies on the 2-year data.
export type FilterPresetId = "PRACTICAL" | "CONSERVATIVE" | "AGGRESSIVE";

export interface FilterPreset {
  id: FilterPresetId;
  label: string;
  description: string;
  filters: Required<BacktestFilterConfig>;
  maxTradesPerDay: number;
}

export const FILTER_PRESETS: Record<FilterPresetId, FilterPreset> = {
  PRACTICAL: {
    id: "PRACTICAL",
    label: "Practical",
    description:
      "Balanced default — VWAP + chop-zone confirmation and a 1.5 reward:risk floor, EMA-trend gate off (the single biggest blocker). Trades all six strategies on the 2-year data.",
    filters: {
      vwapFilter: true,
      emaTrendFilter: false,
      optionChainConfirmation: false,
      avoidChopZone: true,
      avoidLast15Minutes: true,
      avoidWideSpread: false,
      avoidLowVolume: false,
      minimumRiskReward: 1.5,
    },
    maxTradesPerDay: 3,
  },
  CONSERVATIVE: {
    id: "CONSERVATIVE",
    label: "Conservative",
    description:
      "Strictest — every confirmation gate on (VWAP + EMA-trend + chop-zone), 1.5 reward:risk floor, tight 2-trades/day cap. Fewer, higher-conviction setups.",
    filters: {
      vwapFilter: true,
      emaTrendFilter: true,
      optionChainConfirmation: false,
      avoidChopZone: true,
      avoidLast15Minutes: true,
      avoidWideSpread: false,
      avoidLowVolume: false,
      minimumRiskReward: 1.5,
    },
    maxTradesPerDay: 2,
  },
  AGGRESSIVE: {
    id: "AGGRESSIVE",
    label: "Aggressive",
    description:
      "Loosest — discretionary confirmations off and no reward:risk floor (last-15-min cutoff and all hard risk rails stay on), 5-trades/day cap. Most trades, most noise.",
    filters: {
      vwapFilter: false,
      emaTrendFilter: false,
      optionChainConfirmation: false,
      avoidChopZone: false,
      avoidLast15Minutes: true,
      avoidWideSpread: false,
      avoidLowVolume: false,
      minimumRiskReward: 0,
    },
    maxTradesPerDay: 5,
  },
};

export const DEFAULT_PRESET_ID: FilterPresetId = "PRACTICAL";

export const FILTER_PRESET_ORDER: FilterPresetId[] = [
  "PRACTICAL",
  "CONSERVATIVE",
  "AGGRESSIVE",
];

// Identify which preset a given (filters, maxTradesPerDay) pair matches, or null
// when the owner has hand-tuned away from every preset ("Custom").
export function matchPreset(
  filters: Required<BacktestFilterConfig>,
  maxTradesPerDay: number,
): FilterPresetId | null {
  for (const id of FILTER_PRESET_ORDER) {
    const p = FILTER_PRESETS[id];
    if (p.maxTradesPerDay !== maxTradesPerDay) continue;
    const keys = Object.keys(p.filters) as (keyof BacktestFilterConfig)[];
    const same = keys.every((k) => p.filters[k] === filters[k]);
    if (same) return id;
  }
  return null;
}

// Compact abbreviations for the user-configurable confirmation toggles, used in the
// runs-list per-row filter summary (auto-disabled option/spread/volume filters are
// excluded — they never apply in a backtest).
export const FILTER_ABBR: Partial<Record<keyof BacktestFilterConfig, string>> = {
  vwapFilter: "VWAP",
  emaTrendFilter: "EMA",
  avoidChopZone: "Chop",
  avoidLast15Minutes: "Last15",
};

function numFmt(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return n.toFixed(digits);
}

// Build a compact, honest summary of how a saved run was configured. Official-engine
// runs persist null filters (engine replay) and are labelled as such rather than
// fabricating defaults.
export function summarizeRunFilters(
  filters: BacktestFilterConfig | null | undefined,
  maxTradesPerDay: number | null | undefined,
  ignoredFilters?: readonly string[] | null,
  ignoredFiltersRationale?: string | null,
): { short: string; full: string } {
  if (!filters) {
    return {
      short: "engine replay",
      full: "Engine replay — this run used the official engine, not custom confirmation filters.",
    };
  }
  const ignored = new Set((ignoredFilters ?? []) as (keyof BacktestFilterConfig)[]);
  const merged: Required<BacktestFilterConfig> = { ...DEFAULT_FILTERS, ...filters };
  const abbrKeys = Object.keys(FILTER_ABBR) as (keyof BacktestFilterConfig)[];
  // Active toggles = enabled in the run AND not ignored by this strategy.
  const on = abbrKeys.filter((k) => Boolean(merged[k]) && !ignored.has(k));
  // Run-enabled toggles this strategy ignores by design — struck out, never silently applied.
  const struckAbbr = abbrKeys.filter((k) => Boolean(merged[k]) && ignored.has(k));
  const rrIgnored = ignored.has("minimumRiskReward");
  const parts: string[] = [];
  parts.push(on.length > 0 ? on.map((k) => FILTER_ABBR[k]).join("·") : "no filters");
  if (!rrIgnored) parts.push(`R:R ${numFmt(merged.minimumRiskReward)}`);
  if (typeof maxTradesPerDay === "number") parts.push(`≤${maxTradesPerDay}/day`);
  if (struckAbbr.length > 0 || rrIgnored) {
    const struck = [...struckAbbr.map((k) => FILTER_ABBR[k]), ...(rrIgnored ? ["R:R"] : [])];
    parts.push(`ignored ${struck.join("·")}`);
  }
  const short = parts.join(" · ");

  const fullLines = abbrKeys.map((k) =>
    ignored.has(k)
      ? `${FILTER_LABELS[k]}: ${merged[k] ? "on" : "off"} (ignored by this strategy)`
      : `${FILTER_LABELS[k]}: ${merged[k] ? "on" : "off"}`,
  );
  fullLines.push(
    rrIgnored
      ? `${FILTER_LABELS.minimumRiskReward}: ${numFmt(merged.minimumRiskReward)} (ignored by this strategy)`
      : `${FILTER_LABELS.minimumRiskReward}: ${numFmt(merged.minimumRiskReward)}`,
  );
  // Explain WHY the ignored filters are skipped, right beneath the filter lines —
  // only when this strategy actually ignores something and a rationale is provided.
  const hasIgnored = struckAbbr.length > 0 || rrIgnored || ignored.size > 0;
  const rationale = (ignoredFiltersRationale ?? "").trim();
  if (hasIgnored && rationale) {
    fullLines.push(`Why ignored: ${rationale}`);
  }
  if (typeof maxTradesPerDay === "number") fullLines.push(`Max trades/day: ${maxTradesPerDay}`);
  fullLines.push(
    `Auto-disabled (no historical data): ${AUTO_DISABLED_FILTERS.map((k) => FILTER_LABELS[k]).join(", ")}`,
  );
  return { short, full: fullLines.join("\n") };
}
