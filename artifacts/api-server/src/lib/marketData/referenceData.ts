/**
 * Central reference-data service for NSE bhavcopy.
 *
 * Consumer files must not import `nseBhavcopy` directly. This module
 * re-exports bhavcopy functions through the central backbone so that
 * all reference-data access is traceable and auditable.
 *
 * Classification: REFERENCE DATA (not market data).
 * sourceProvider = "nse_bhavcopy"
 * sourceTier = "reference"
 * notForSignals = true
 * notForTradeDecisions = true
 */

/** Delivery % for a single symbol (from daily NSE bhavcopy CSV). */
export { getDeliveryPct } from "../nseBhavcopy";

/** Pre-fetched delivery map (all symbols, single async call). */
export { getDeliveryMap } from "../nseBhavcopy";

/** Full NSE EQ symbol list from bhavcopy (universe resolution). */
export { getAllSymbols } from "../nseBhavcopy";
