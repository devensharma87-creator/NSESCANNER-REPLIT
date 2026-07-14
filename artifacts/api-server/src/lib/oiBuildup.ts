/**
 * OI buildup classifier — pure, deterministic, never throws.
 *
 * Implements the methodology's "OI buildup matrix" (§2): combine the direction
 * of PRICE with the direction of OPEN INTEREST to label what kind of move
 * happened, not just its direction.
 *
 *   Price ↑ + OI ↑ → Long buildup      (Bullish)
 *   Price ↓ + OI ↑ → Short buildup     (Bearish)
 *   Price ↑ + OI ↓ → Short covering    (Bullish, cautious)
 *   Price ↓ + OI ↓ → Long unwinding    (Bearish, weak hands)
 *   |Δprice| or |ΔOI| within epsilon   → Neutral
 *   price or OI input null             → Data unavailable
 *
 * REPORTING ONLY. Consumed by the Pre/Post-market report for display; never
 * feeds a trading decision.
 */

export type OiBuildupClass =
  | "LONG_BUILDUP"
  | "SHORT_BUILDUP"
  | "SHORT_COVERING"
  | "LONG_UNWINDING"
  | "NEUTRAL"
  | "DATA_UNAVAILABLE";

export type OiBuildupBias = "BULLISH" | "BEARISH" | "NEUTRAL" | "UNKNOWN";

export interface OiBuildupResult {
  classification: OiBuildupClass;
  bias: OiBuildupBias;
  /** Human-readable one-liner. */
  note: string;
}

export interface OiBuildupOptions {
  /** Below this |price change %| the price leg is treated as flat. Default 0.05. */
  priceEpsPct?: number;
  /** Below this |OI change %| the OI leg is treated as flat. Default 0.5. */
  oiEpsPct?: number;
}

const DEFAULT_PRICE_EPS = 0.05;
const DEFAULT_OI_EPS = 0.5;

/**
 * Classify a single instrument's buildup from its price change % and OI change %.
 * Both inputs are PERCENTAGES (e.g. -0.19 for -0.19%). Either being null yields
 * DATA_UNAVAILABLE so a missing feed is surfaced honestly rather than guessed.
 */
export function classifyOiBuildup(
  priceChgPct: number | null | undefined,
  oiChgPct: number | null | undefined,
  opts: OiBuildupOptions = {},
): OiBuildupResult {
  if (priceChgPct == null || oiChgPct == null || !Number.isFinite(priceChgPct) || !Number.isFinite(oiChgPct)) {
    return {
      classification: "DATA_UNAVAILABLE",
      bias: "UNKNOWN",
      note: "Insufficient data to classify buildup (price or OI change missing).",
    };
  }

  const priceEps = opts.priceEpsPct ?? DEFAULT_PRICE_EPS;
  const oiEps = opts.oiEpsPct ?? DEFAULT_OI_EPS;

  const priceUp = priceChgPct > priceEps;
  const priceDown = priceChgPct < -priceEps;
  const oiUp = oiChgPct > oiEps;
  const oiDown = oiChgPct < -oiEps;

  if (!((priceUp || priceDown) && (oiUp || oiDown))) {
    return {
      classification: "NEUTRAL",
      bias: "NEUTRAL",
      note: "Price and/or OI essentially flat — no decisive buildup.",
    };
  }

  if (priceUp && oiUp) {
    return { classification: "LONG_BUILDUP", bias: "BULLISH", note: "Price up + OI up → fresh longs adding (bullish)." };
  }
  if (priceDown && oiUp) {
    return { classification: "SHORT_BUILDUP", bias: "BEARISH", note: "Price down + OI up → fresh shorts adding (bearish)." };
  }
  if (priceUp && oiDown) {
    return { classification: "SHORT_COVERING", bias: "BULLISH", note: "Price up + OI down → shorts covering (bullish, but cautious)." };
  }
  // priceDown && oiDown
  return { classification: "LONG_UNWINDING", bias: "BEARISH", note: "Price down + OI down → longs exiting (bearish, weak hands)." };
}
