/**
 * Backtest Lab — Stage 4: Snapshot Premium Replay pricer.
 *
 * Prices F&O directional trades from REAL captured option_chain_snapshot rows.
 * This is a pure analytics module — read-only against captured snapshots,
 * completely isolated from signal generation, gates, sizing, and the capital
 * ledger.
 *
 * THE ONE RULE (enforced here): every premium this module returns is either
 *   (a) traceable to a specific captured snapshot row (capturedAt ISO stored),
 *   (b) explicitly Black-Scholes modelled from a captured IV and loudly flagged,
 *   (c) marked UNAVAILABLE and excluded from ₹ P&L aggregates.
 *
 * No interpolation, no zero-filling, no averaging across strikes, no silent
 * fallback to the proxy. A trade whose neither leg can be resolved is returned
 * as PricingMode="UNAVAILABLE" with null P&L — it is counted but never priced.
 *
 * The DB query functions (SnapshotFetcher, ExpiryFetcher) are INJECTED so this
 * module is fully testable without a real database. Production implementations
 * live in routes/backtest.ts. Tests provide mock implementations.
 */

import type { BacktestTradeOut, FnoCostBreakdown, BacktestPricingModeMix, BacktestDataQualityOut, SnapshotUnderlyingCoverage } from "./types";
import { FNO_COST_PARAMS, FNO_COST_PARAMS_ASOF } from "../fnoCostModel";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard tolerance: snapshots further than this from the signal time are NOT
 *  considered "real captured" for that leg. Never silently exceed this. */
export const REPLAY_ENTRY_TOLERANCE_MIN = 5;

/** A run whose resolvable-trade rate falls below this is flagged LOW COVERAGE. */
export const REPLAY_MIN_COVERAGE_PCT = 60;

/**
 * F&O cost rates for Stage-4 premium replay are now sourced exclusively from
 * the canonical `fnoCostModel.FNO_COST_PARAMS` (imported above).
 *
 * DO NOT add local rate constants here. All statutory rates (STT, exchange,
 * SEBI, GST, stamp duty) must come from `FNO_COST_PARAMS` so that every
 * F&O report and replay surface agrees on the same numbers.
 *
 * Rates in effect (via FNO_COST_PARAMS, as-of FNO_COST_PARAMS_ASOF):
 *   STT: 0.15% on sell-side option premium (Budget 2026, eff. 2026-04-01)
 *   Exchange txn: 0.03503% on total premium turnover (NSE)
 *   SEBI: ₹10 per crore on total turnover
 *   GST: 18% on (brokerage + exchange + SEBI)
 *   Stamp duty: 0.003% on buy-side premium
 *   Default spread: SPREAD_BPS_PER_SIDE bps per side (25 bps)
 */

/** Risk-free rate for Black-Scholes (RBI repo rate approximation, 2026). */
const BS_RISK_FREE_RATE = 0.065;

// ---------------------------------------------------------------------------
// Injected fetcher types (for testability — no direct DB imports here)
// ---------------------------------------------------------------------------

export interface SnapshotRow {
  ltp: number | null;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  iv: number | null;
  delta: number | null;
  theta: number | null;
  spot: number | null;
  capturedAt: Date | string;
}

/** Fetches the nearest snapshot at or before `atTime` within `toleranceMin`. */
export type SnapshotFetcher = (params: {
  underlying: string;
  expiry: string;         // YYYY-MM-DD
  strike: number;
  optType: "CE" | "PE";
  atTime: string;         // ISO timestamp (the target time)
  toleranceMin: number;
}) => Promise<SnapshotRow | null>;

/** Fetches the nearest expiry date (≥ signalDate) with snapshot coverage. */
export type ExpiryFetcher = (params: {
  underlying: string;
  signalDate: string;     // YYYY-MM-DD (entry date)
}) => Promise<string | null>;  // YYYY-MM-DD or null

// ---------------------------------------------------------------------------
// Black-Scholes pricer
// ---------------------------------------------------------------------------

/** Normal CDF approximation (Abramowitz & Stegun). */
function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = (1 / Math.sqrt(2 * Math.PI)) * Math.exp((-x * x) / 2);
  const poly =
    t * (0.319381530 +
      t * (-0.356563782 +
        t * (1.781477937 +
          t * (-1.821255978 + t * 1.330274429))));
  const cdf = 1 - d * poly;
  return x >= 0 ? cdf : 1 - cdf;
}

/**
 * Standard Black-Scholes European option price.
 * @param S    Spot price
 * @param K    Strike price
 * @param T    Time to expiry in years (≥ 0)
 * @param r    Risk-free rate (e.g. 0.065)
 * @param sigma Annualised implied volatility as a fraction (e.g. 0.20 = 20%)
 * @param isCall true = CALL, false = PUT
 * @returns Option premium ≥ 0
 */
export function bsOptionPrice(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  isCall: boolean,
): number {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
    return Math.max(0, isCall ? S - K : K - S);
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  if (isCall) {
    return S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
  } else {
    return K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
  }
}

/** Compute fractional years from capturedAt to the option's expiry (market close). */
function yearsToExpiry(capturedAtIso: string, expiryYmd: string): number {
  const t0 = new Date(capturedAtIso).getTime();
  // Expiry closes at 15:30 IST = 10:00 UTC
  const t1 = new Date(`${expiryYmd}T10:00:00.000Z`).getTime();
  return Math.max(0, (t1 - t0) / (1000 * 60 * 60 * 24 * 365.25));
}

// ---------------------------------------------------------------------------
// Leg resolution
// ---------------------------------------------------------------------------

export interface ResolvedLeg {
  premium: number;
  /** The actual data source used for the premium. */
  source: "ltp" | "mid" | "bs";
  capturedAtIso: string;
  withinTolerance: boolean;
  /** Real bid-ask spread from snapshot, if present (for cost model). */
  spread: number | null;
  iv: number | null;
  delta: number | null;
  theta: number | null;
}

/**
 * Resolve the premium from a snapshot row.
 * Priority: LTP → mid(bid,ask) → Black-Scholes from IV.
 * Returns null when the row cannot yield any premium.
 */
export function resolvePremiumFromRow(
  row: SnapshotRow,
  expiry: string,
  strike: number,
  isCall: boolean,
): ResolvedLeg | null {
  const capturedAtIso =
    row.capturedAt instanceof Date
      ? row.capturedAt.toISOString()
      : String(row.capturedAt);

  const ltp = row.ltp !== null && row.ltp !== undefined && Number.isFinite(Number(row.ltp))
    ? Number(row.ltp)
    : null;
  const bid = row.bid !== null && row.bid !== undefined && Number.isFinite(Number(row.bid))
    ? Number(row.bid)
    : null;
  const ask = row.ask !== null && row.ask !== undefined && Number.isFinite(Number(row.ask))
    ? Number(row.ask)
    : null;
  const iv = row.iv !== null && row.iv !== undefined && Number.isFinite(Number(row.iv))
    ? Number(row.iv)
    : null;
  const spot = row.spot !== null && row.spot !== undefined && Number.isFinite(Number(row.spot))
    ? Number(row.spot)
    : null;

  const realSpread =
    row.spread !== null && row.spread !== undefined && Number.isFinite(Number(row.spread))
      ? Number(row.spread)
      : bid !== null && ask !== null
        ? Math.max(0, ask - bid)
        : null;

  // 1. Use LTP (real captured premium)
  if (ltp !== null && ltp > 0) {
    return {
      premium: ltp,
      source: "ltp",
      capturedAtIso,
      withinTolerance: true, // caller already checked tolerance
      spread: realSpread,
      iv: iv !== null ? Number(row.iv) : null,
      delta: row.delta !== null ? Number(row.delta) : null,
      theta: row.theta !== null ? Number(row.theta) : null,
    };
  }

  // 2. Use mid(bid, ask) — label as mid
  if (bid !== null && ask !== null && (bid + ask) > 0) {
    const mid = (bid + ask) / 2;
    return {
      premium: mid,
      source: "mid",
      capturedAtIso,
      withinTolerance: true,
      spread: realSpread,
      iv,
      delta: row.delta !== null ? Number(row.delta) : null,
      theta: row.theta !== null ? Number(row.theta) : null,
    };
  }

  // 3. Fall back to Black-Scholes from captured IV (requires spot + IV)
  if (iv !== null && iv > 0 && spot !== null && spot > 0) {
    const T = yearsToExpiry(capturedAtIso, expiry);
    const sigma = iv / 100; // IV stored as percentage (e.g. 14.5 → 0.145)
    const bsPrice = bsOptionPrice(spot, strike, T, BS_RISK_FREE_RATE, sigma, isCall);
    if (bsPrice >= 0) {
      return {
        premium: bsPrice,
        source: "bs",
        capturedAtIso,
        withinTolerance: true,
        spread: null,   // no real spread when LTP/mid missing
        iv,
        delta: row.delta !== null ? Number(row.delta) : null,
        theta: row.theta !== null ? Number(row.theta) : null,
      };
    }
  }

  return null; // Cannot resolve any premium — UNAVAILABLE for this leg
}

/** Fetch and resolve one leg (entry OR exit) for a trade. */
export async function resolveSnapshotLeg(
  params: {
    underlying: string;
    expiry: string;
    strike: number;
    optType: "CE" | "PE";
    atTime: string;
    isCall: boolean;
  },
  fetcher: SnapshotFetcher,
): Promise<{ leg: ResolvedLeg; withinTolerance: boolean } | null> {
  const row = await fetcher({
    underlying: params.underlying,
    expiry: params.expiry,
    strike: params.strike,
    optType: params.optType,
    atTime: params.atTime,
    toleranceMin: REPLAY_ENTRY_TOLERANCE_MIN,
  });

  if (!row) return null;

  const leg = resolvePremiumFromRow(row, params.expiry, params.strike, params.isCall);
  if (!leg) return null;

  return { leg, withinTolerance: true }; // fetcher already enforced tolerance
}

// ---------------------------------------------------------------------------
// Pricing mode assignment
// ---------------------------------------------------------------------------

/** Determine the PricingMode from the resolved entry and exit legs. */
export function assignPricingMode(
  entryLeg: ResolvedLeg | null,
  exitLeg: ResolvedLeg | null,
): import("./types").PricingMode {
  if (!entryLeg || !exitLeg) return "UNAVAILABLE";

  const entryReal = entryLeg.source === "ltp" || entryLeg.source === "mid";
  const exitReal = exitLeg.source === "ltp" || exitLeg.source === "mid";
  const entryBs = entryLeg.source === "bs";
  const exitBs = exitLeg.source === "bs";

  if (entryReal && exitReal) return "REAL_CAPTURED_PREMIUM";
  if ((entryReal && exitBs) || (entryBs && exitReal)) return "REAL_PARTIAL";
  if (entryBs && exitBs) return "BLACK_SCHOLES_MODELLED";
  return "UNAVAILABLE";
}

// ---------------------------------------------------------------------------
// Cost model
// ---------------------------------------------------------------------------

/**
 * Compute itemised F&O round-trip costs for one Stage-4 replay trade.
 * All rate constants come from the canonical FNO_COST_PARAMS — no local
 * rate literals are allowed in this module.
 *
 * STT: sell side only (0.15%, eff. 2026-04-01).
 * Stamp duty: buy side only (0.003%).
 * Exchange txn + SEBI: both legs.
 * GST: on (brokerage + exchange + SEBI).
 * Spread cost: half-spread on each leg (real when captured, canonical
 *   SPREAD_BPS_PER_SIDE default when not).
 */
export function computeFnoCosts(
  entryPremium: number,
  exitPremium: number,
  qty: number,
  entrySpread: number | null,
  exitSpread: number | null,
): FnoCostBreakdown {
  const entryTurnover = entryPremium * qty;
  const exitTurnover = exitPremium * qty;
  const totalTurnover = entryTurnover + exitTurnover;

  const brokerage = FNO_COST_PARAMS.BROKERAGE_PER_SIDE_INR * 2;             // ₹20 × 2 orders
  const stt = exitTurnover * FNO_COST_PARAMS.STT_RATE_SELL_PREMIUM;          // 0.15% sell side
  const exchangeTxn = totalTurnover * FNO_COST_PARAMS.EXCHANGE_TXN_RATE;     // 0.03503% both legs
  const sebiCharges = totalTurnover * FNO_COST_PARAMS.SEBI_RATE;             // ₹10/crore both legs
  const gst = (brokerage + exchangeTxn + sebiCharges) * FNO_COST_PARAMS.GST_RATE;
  const stampDuty = entryTurnover * FNO_COST_PARAMS.STAMP_DUTY_RATE_BUY;     // 0.003% buy only

  // Spread: use real bid-ask half-spread when available; canonical default bps otherwise.
  const defaultSpreadRate = FNO_COST_PARAMS.SPREAD_BPS_PER_SIDE / 10_000;   // 25 bps per side
  let spreadCost: number;
  let spreadModelled: boolean;
  if (entrySpread !== null && exitSpread !== null) {
    spreadCost = (entrySpread / 2 + exitSpread / 2) * qty;
    spreadModelled = false;
  } else {
    spreadCost =
      (entryPremium * defaultSpreadRate + exitPremium * defaultSpreadRate) * qty;
    spreadModelled = true;
  }

  const total = r2(brokerage + stt + exchangeTxn + sebiCharges + gst + stampDuty + spreadCost);

  return {
    brokerage: r2(brokerage),
    stt: r2(stt),
    exchangeTxn: r2(exchangeTxn),
    sebiCharges: r2(sebiCharges),
    gst: r2(gst),
    stampDuty: r2(stampDuty),
    spreadCost: r2(spreadCost),
    spreadModelled,
    total,
  };
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Per-trade pricer
// ---------------------------------------------------------------------------

/** Input: a directional trade as produced by runDirectional (BacktestTradeOut). */
export interface TradeToPrice {
  id: string;
  indexSymbol: string;
  optionType: string | null;  // "CALL" | "PUT"
  strike: number | null;
  entryAt: string | null;     // ISO
  exitAt: string | null;      // ISO
  lots: number | null;
  lotSize: number | null;
  qty: number | null;
  entrySpot: number | null;
}

export interface PricedTradeResult {
  pricingMode: import("./types").PricingMode;
  optionEntry: number | null;       // real captured entry premium
  optionExit: number | null;        // real captured exit premium
  entryPremiumSource: string;       // ISO or "modelled" or "unavailable"
  exitPremiumSource: string;
  entryIv: number | null;
  entryDelta: number | null;
  entryTheta: number | null;
  grossPnl: number | null;          // (exit - entry) × qty; null when UNAVAILABLE
  costs: FnoCostBreakdown | null;
  netPnl: number | null;            // grossPnl - costs.total; null when UNAVAILABLE
  withinTolerance: boolean;         // both legs within REPLAY_ENTRY_TOLERANCE_MIN
}

/**
 * Price one directional trade from captured snapshots.
 * Returns a PricedTradeResult — never fabricates; UNAVAILABLE when no data.
 */
export async function priceTradeFromSnapshots(
  trade: TradeToPrice,
  expiryFetcher: ExpiryFetcher,
  snapshotFetcher: SnapshotFetcher,
): Promise<PricedTradeResult> {
  const UNAVAILABLE: PricedTradeResult = {
    pricingMode: "UNAVAILABLE",
    optionEntry: null,
    optionExit: null,
    entryPremiumSource: "unavailable",
    exitPremiumSource: "unavailable",
    entryIv: null,
    entryDelta: null,
    entryTheta: null,
    grossPnl: null,
    costs: null,
    netPnl: null,
    withinTolerance: false,
  };

  if (
    !trade.optionType ||
    trade.strike === null ||
    !trade.entryAt ||
    !trade.exitAt ||
    trade.qty === null ||
    trade.qty <= 0
  ) {
    return UNAVAILABLE;
  }

  const optType: "CE" | "PE" =
    trade.optionType.toUpperCase() === "CALL" ||
    trade.optionType.toUpperCase() === "CE"
      ? "CE"
      : "PE";
  const isCall = optType === "CE";

  // Get the signal date (YYYY-MM-DD from ISO)
  const entryDate = trade.entryAt.slice(0, 10);

  // Resolve the nearest expiry >= entry date that has snapshot coverage
  const expiry = await expiryFetcher({
    underlying: trade.indexSymbol,
    signalDate: entryDate,
  });
  if (!expiry) return UNAVAILABLE;

  // Resolve entry leg
  const entryResult = await resolveSnapshotLeg(
    {
      underlying: trade.indexSymbol,
      expiry,
      strike: trade.strike,
      optType,
      atTime: trade.entryAt,
      isCall,
    },
    snapshotFetcher,
  );

  // Resolve exit leg
  const exitResult = await resolveSnapshotLeg(
    {
      underlying: trade.indexSymbol,
      expiry,
      strike: trade.strike,
      optType,
      atTime: trade.exitAt,
      isCall,
    },
    snapshotFetcher,
  );

  const entryLeg = entryResult?.leg ?? null;
  const exitLeg = exitResult?.leg ?? null;

  const pricingMode = assignPricingMode(entryLeg, exitLeg);

  const entryPremiumSource = entryLeg
    ? entryLeg.source === "bs"
      ? "modelled"
      : entryLeg.capturedAtIso
    : "unavailable";
  const exitPremiumSource = exitLeg
    ? exitLeg.source === "bs"
      ? "modelled"
      : exitLeg.capturedAtIso
    : "unavailable";

  if (pricingMode === "UNAVAILABLE") {
    return {
      ...UNAVAILABLE,
      entryPremiumSource,
      exitPremiumSource,
      entryIv: entryLeg?.iv ?? null,
      entryDelta: entryLeg?.delta ?? null,
      entryTheta: entryLeg?.theta ?? null,
    };
  }

  // P&L: long premium trade — always buy a call or put
  const entryPremium = entryLeg!.premium;
  const exitPremium = exitLeg!.premium;
  const qty = trade.qty;
  const grossPnl = r2((exitPremium - entryPremium) * qty);

  const costs = computeFnoCosts(
    entryPremium,
    exitPremium,
    qty,
    entryLeg!.spread,
    exitLeg!.spread,
  );
  const netPnl = r2(grossPnl - costs.total);

  return {
    pricingMode,
    optionEntry: r2(entryPremium),
    optionExit: r2(exitPremium),
    entryPremiumSource,
    exitPremiumSource,
    entryIv: entryLeg!.iv,
    entryDelta: entryLeg!.delta,
    entryTheta: entryLeg!.theta,
    grossPnl,
    costs,
    netPnl,
    withinTolerance: entryLeg!.withinTolerance && exitLeg!.withinTolerance,
  };
}

/** Price all trades from the directional engine using captured snapshots. */
export async function priceTradesFromSnapshots(
  trades: BacktestTradeOut[],
  expiryFetcher: ExpiryFetcher,
  snapshotFetcher: SnapshotFetcher,
): Promise<Array<BacktestTradeOut & PricedTradeResult>> {
  const results: Array<BacktestTradeOut & PricedTradeResult> = [];
  for (const trade of trades) {
    const priced = await priceTradeFromSnapshots(trade, expiryFetcher, snapshotFetcher);
    results.push({
      ...trade,
      // Overwrite pnl with netPnl (null for UNAVAILABLE — excluded from aggregates)
      pnl: priced.netPnl,
      modeled: priced.pricingMode !== "REAL_CAPTURED_PREMIUM",
      ...priced,
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Coverage gate
// ---------------------------------------------------------------------------

/** Compute the mode-mix summary for a completed SNAPSHOT_PREMIUM_REPLAY run. */
export function computeRunCoverage(
  results: Array<{ pricingMode: import("./types").PricingMode }>,
): BacktestPricingModeMix {
  let realCaptured = 0;
  let realPartial = 0;
  let bsModelled = 0;
  let syntheticDeltaProxy = 0;
  let unavailable = 0;

  for (const r of results) {
    switch (r.pricingMode) {
      case "REAL_CAPTURED_PREMIUM": realCaptured++; break;
      case "REAL_PARTIAL": realPartial++; break;
      case "BLACK_SCHOLES_MODELLED": bsModelled++; break;
      case "SYNTHETIC_DELTA_PROXY": syntheticDeltaProxy++; break;
      case "UNAVAILABLE": unavailable++; break;
    }
  }

  const total = results.length;
  const priced = realCaptured + realPartial + bsModelled + syntheticDeltaProxy;
  const coveragePct = total > 0 ? r2((priced / total) * 100) : 0;
  const lowCoverage = total > 0 && coveragePct < REPLAY_MIN_COVERAGE_PCT;
  const coverageFlag = lowCoverage
    ? `LOW COVERAGE — ${coveragePct}% of trades could not be priced from captured data; ₹ P&L reflects only the priced subset and may not be representative.`
    : null;

  return {
    realCaptured,
    realPartial,
    bsModelled,
    syntheticDeltaProxy,
    unavailable,
    total,
    coveragePct,
    lowCoverage,
    coverageFlag,
  };
}

/** Build the DataQuality blob for a SNAPSHOT_PREMIUM_REPLAY run. */
export function buildSnapshotPremiumDataQuality(params: {
  mix: BacktestPricingModeMix;
  underlyingCoverage: SnapshotUnderlyingCoverage[];
  lots: number;
  preCoverageRequest: boolean;
}): BacktestDataQualityOut {
  const { mix, underlyingCoverage, lots } = params;
  const warnings: string[] = [];
  const notes: string[] = [];

  if (params.preCoverageRequest) {
    warnings.push(
      "No captured snapshot data for the requested window — no trades could be priced from real premiums. Choose a date range within the captured archive.",
    );
    return {
      mode: "SNAPSHOT_PREMIUM_REPLAY",
      candleCoverage: null,
      optionDataAvailable: false,
      ivAvailable: false,
      oiAvailable: false,
      snapshotCoverage: null,
      modeledFields: [],
      warnings,
      notes: ["Request a date range within the captured snapshot archive to get real-premium pricing."],
      pricingModeMix: mix,
      underlyingCoverage,
    };
  }

  if (mix.lowCoverage && mix.coverageFlag) {
    warnings.push(mix.coverageFlag);
  }

  if (mix.unavailable > 0) {
    warnings.push(
      `${mix.unavailable} trade${mix.unavailable === 1 ? "" : "s"} excluded (UNAVAILABLE): no usable snapshot data for either entry or exit — excluded from ₹ P&L, counted in trade list.`,
    );
  }

  if (mix.bsModelled > 0) {
    warnings.push(
      `${mix.bsModelled} trade${mix.bsModelled === 1 ? "" : "s"} priced via Black-Scholes from captured IV (LTP/mid absent) — labelled BLACK_SCHOLES_MODELLED.`,
    );
  }

  if (mix.realPartial > 0) {
    notes.push(
      `${mix.realPartial} trade${mix.realPartial === 1 ? "" : "s"} have one leg priced from a real snapshot and the other modelled (REAL_PARTIAL).`,
    );
  }

  const modeSummary =
    `${mix.total} trades: ` +
    `${mix.realCaptured} REAL_CAPTURED` +
    (mix.realPartial > 0 ? `, ${mix.realPartial} REAL_PARTIAL` : "") +
    (mix.bsModelled > 0 ? `, ${mix.bsModelled} BS_MODELLED` : "") +
    (mix.unavailable > 0 ? `, ${mix.unavailable} UNAVAILABLE-excluded` : "");

  notes.push(modeSummary);
  notes.push(
    `P&L = net of F&O costs (brokerage ₹${FNO_COST_PARAMS.BROKERAGE_PER_SIDE_INR * 2}/trade, STT ${(FNO_COST_PARAMS.STT_RATE_SELL_PREMIUM * 100).toFixed(2)}% sell, exchange ${(FNO_COST_PARAMS.EXCHANGE_TXN_RATE * 100).toFixed(5)}%, SEBI, GST ${FNO_COST_PARAMS.GST_RATE * 100}%, stamp ${(FNO_COST_PARAMS.STAMP_DUTY_RATE_BUY * 100).toFixed(3)}% buy; canonical fnoCostModel rates eff. ${FNO_COST_PARAMS_ASOF}). ` +
    `Spread cost ${mix.realCaptured + mix.realPartial > 0 ? "from real bid-ask where captured" : `defaulted to ${FNO_COST_PARAMS.SPREAD_BPS_PER_SIDE} bps of premium per side`}.`,
  );
  notes.push(
    `Directional signals (EMA/RSI/ATR/regime) from real 15-min spot candles. Option premiums from captured option_chain_snapshot rows (${REPLAY_ENTRY_TOLERANCE_MIN}-min tolerance). Position size: ${lots} lot${lots === 1 ? "" : "s"}.`,
  );

  const ivAvail = underlyingCoverage.some((u) => u.hasData);

  return {
    mode: "SNAPSHOT_PREMIUM_REPLAY",
    candleCoverage: null,
    optionDataAvailable: mix.realCaptured + mix.realPartial > 0,
    ivAvailable: ivAvail,
    oiAvailable: false,
    snapshotCoverage: null,
    modeledFields:
      mix.bsModelled > 0
        ? [`${mix.bsModelled} trade${mix.bsModelled === 1 ? "" : "s"} priced via Black-Scholes from captured IV (LTP absent)`]
        : [],
    warnings,
    notes,
    pricingModeMix: mix,
    underlyingCoverage,
  };
}
