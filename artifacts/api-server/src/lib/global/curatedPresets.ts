/**
 * Curated, read-only library of starter screener presets.
 *
 * Returned by `GET /global/screener-presets/library`. The UI Fork action
 * persists an editable copy via `POST /global/screener-presets`. Kept in
 * code so they stay in sync with new filter capabilities.
 *
 * Note: FX only supports `1h` / `1d` timeframes (see `FOREX_TFS` in
 * universe.ts).
 */

import type { ScreenerBodyInput } from "./screener";

export type CuratedPreset = {
  slug: string;
  name: string;
  description: string;
  body: ScreenerBodyInput;
};

export const CURATED_PRESETS: readonly CuratedPreset[] = [
  {
    slug: "crypto-oversold-1h",
    name: "Crypto oversold 1h",
    description:
      "Coins printing RSI(14) ≤ 30 on the hourly — short-term mean-reversion candidates.",
    body: {
      assetClasses: ["crypto"],
      timeframe: "1h",
      filters: { maxRsi14: 30 },
      limit: 25,
    },
  },
  {
    slug: "crypto-breakout-4h",
    name: "Crypto breakout 4h",
    description:
      "Coins breaking above their 20-bar 4h high with Supertrend already pointing up.",
    body: {
      assetClasses: ["crypto"],
      timeframe: "4h",
      filters: { breakoutLookback: 20, requireSupertrendUp: true },
      limit: 25,
    },
  },
  {
    slug: "fx-trend-up-1h",
    name: "FX trend-up 1h",
    description:
      "FX pairs with EMA cascade up (20 > 50 > 200) and price above the 50-SMA on the hourly.",
    body: {
      assetClasses: ["forex"],
      timeframe: "1h",
      filters: { trendUp: true, priceAboveSma50: true },
      limit: 25,
    },
  },
  {
    slug: "equities-breakout-1d",
    name: "Equities breakout 1d",
    description:
      "Stocks breaking above their 50-day high while trading above their 50-day SMA.",
    body: {
      assetClasses: ["equity"],
      timeframe: "1d",
      filters: { breakoutLookback: 50, priceAboveSma50: true },
      limit: 25,
    },
  },
  {
    slug: "commodities-momentum-1d",
    name: "Commodities momentum 1d",
    description:
      "Commodities up at least 5% over the past week with daily Supertrend pointing up.",
    body: {
      assetClasses: ["commodity"],
      timeframe: "1d",
      filters: { min1wChangePct: 5, requireSupertrendUp: true },
      limit: 25,
    },
  },
  {
    slug: "indices-oversold-bounce-1d",
    name: "Indices oversold bounce 1d",
    description:
      "Indices pulling back under RSI(14) ≤ 35 while still holding above their 200-day SMA.",
    body: {
      assetClasses: ["index"],
      timeframe: "1d",
      filters: { maxRsi14: 35, priceAboveSma200: true },
      limit: 25,
    },
  },
];
