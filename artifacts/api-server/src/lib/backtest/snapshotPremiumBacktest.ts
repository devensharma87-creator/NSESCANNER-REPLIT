/**
 * Backtest Lab — Stage 4: DB-backed runner for SNAPSHOT_PREMIUM_REPLAY.
 *
 * Wires the pure premiumReplay.ts pricer to the real database:
 *   - makeExpiryFetcher   — queries option_chain_snapshot for the nearest expiry.
 *   - makeSnapshotFetcher — queries option_chain_snapshot for the nearest captured
 *                           row within REPLAY_ENTRY_TOLERANCE_MIN.
 *   - buildUnderlyingCoverage — per-underlying coverage stats for the detail gate.
 *   - runSnapshotPremiumReplay — top-level runner called from the route handler.
 *
 * Does NOT import from optionChainSnapshotIngestor or modify any snapshot data.
 * Read-only against option_chain_snapshot.
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { LOT_SIZES } from "../optionChain";
import { loadHistoricalCandles, isSupportedInstrument } from "./candleSource";
import { runDirectional } from "./directional";
import {
  priceTradesFromSnapshots,
  computeRunCoverage,
  buildSnapshotPremiumDataQuality,
  REPLAY_ENTRY_TOLERANCE_MIN,
  type SnapshotFetcher,
  type ExpiryFetcher,
  type SnapshotRow,
} from "./premiumReplay";
import type {
  BacktestTradeOut,
  BacktestDataQualityOut,
  SnapshotUnderlyingCoverage,
} from "./types";

// ---------------------------------------------------------------------------
// DB-backed fetcher factories
// ---------------------------------------------------------------------------

/**
 * Returns a SnapshotFetcher that queries option_chain_snapshot for the nearest
 * row AT OR BEFORE `atTime` within `toleranceMin` minutes.
 * Uses strict "at or before" to avoid any look-ahead bias.
 */
export function makeSnapshotFetcher(): SnapshotFetcher {
  return async (params) => {
    const { underlying, expiry, strike, optType, atTime, toleranceMin } = params;
    const result = await db.execute(sql`
      SELECT
        ltp::float8        AS ltp,
        bid::float8        AS bid,
        ask::float8        AS ask,
        spread::float8     AS spread,
        iv::float8         AS iv,
        delta::float8      AS delta,
        theta::float8      AS theta,
        spot::float8       AS spot,
        captured_at        AS "capturedAt"
      FROM option_chain_snapshot
      WHERE underlying     = ${underlying}
        AND expiry         = ${expiry}::date
        AND strike::float8 = ${strike}::float8
        AND opt_type       = ${optType}
        AND captured_at   <= ${atTime}::timestamptz
        AND captured_at   >= ${atTime}::timestamptz - ${toleranceMin} * INTERVAL '1 minute'
      ORDER BY captured_at DESC
      LIMIT 1
    `);
    const row = result.rows?.[0] as unknown as SnapshotRow | undefined;
    return row ?? null;
  };
}

/**
 * Returns an ExpiryFetcher that finds the nearest option expiry (≥ signalDate)
 * present in the snapshot archive for the given underlying.
 * Memoised per (underlying, signalDate) pair to avoid repeated queries.
 */
export function makeExpiryFetcher(): ExpiryFetcher {
  const cache = new Map<string, string | null>();
  return async (params) => {
    const { underlying, signalDate } = params;
    const key = `${underlying}:${signalDate}`;
    if (cache.has(key)) return cache.get(key)!;

    const result = await db.execute(sql`
      SELECT MIN(expiry)::text AS expiry
      FROM option_chain_snapshot
      WHERE underlying = ${underlying}
        AND expiry    >= ${signalDate}::date
        AND expiry    <= ${signalDate}::date + INTERVAL '35 days'
    `);
    const expiry =
      ((result.rows?.[0] as { expiry: string | null } | undefined)?.expiry) ?? null;
    cache.set(key, expiry);
    return expiry;
  };
}

// ---------------------------------------------------------------------------
// Per-underlying coverage query
// ---------------------------------------------------------------------------

/**
 * Compute snapshot coverage for one underlying over a date window.
 * capturedBuckets = distinct captured_at timestamps (each is one 5-min bucket).
 * expectedBuckets = distinct trading days (days with ANY snapshot) × 75.
 *   (75 = 375 market minutes ÷ 5-min interval: 09:15–15:30 IST)
 */
export async function buildUnderlyingCoverage(
  underlying: string,
  from: string,
  to: string,
): Promise<SnapshotUnderlyingCoverage> {
  const result = await db.execute(sql`
    SELECT
      MIN(captured_at)                                     AS earliest,
      MAX(captured_at)                                     AS latest,
      COUNT(DISTINCT captured_at)::int                     AS captured_buckets,
      COUNT(DISTINCT captured_at::date)::int               AS trading_days,
      COALESCE(ARRAY_AGG(DISTINCT expiry::text ORDER BY expiry::text), ARRAY[]::text[]) AS expiries
    FROM option_chain_snapshot
    WHERE underlying  = ${underlying}
      AND captured_at >= ${from}::date
      AND captured_at  < ${to}::date + INTERVAL '1 day'
  `);

  const row = (result.rows?.[0] ?? {}) as {
    earliest: Date | string | null;
    latest: Date | string | null;
    captured_buckets: number | null;
    trading_days: number | null;
    expiries: string[] | null;
  };

  const capturedBuckets = Number(row.captured_buckets) || 0;
  const tradingDays = Number(row.trading_days) || 0;
  const expectedBuckets = tradingDays * 75;
  const coveragePct =
    expectedBuckets > 0
      ? Math.round((capturedBuckets / expectedBuckets) * 10000) / 100
      : 0;

  const toIso = (v: Date | string | null) =>
    v == null ? null : (v instanceof Date ? v : new Date(v)).toISOString();

  return {
    underlying,
    earliest: toIso(row.earliest),
    latest: toIso(row.latest),
    capturedBuckets,
    expectedBuckets,
    coveragePct,
    expiries: (row.expiries ?? []).filter((e): e is string => typeof e === "string"),
    hasData: capturedBuckets > 0,
  };
}

/** Quick check: does the archive have ANY data for this underlying + window? */
async function hasSnapshotData(underlying: string, from: string, to: string): Promise<boolean> {
  const r = await db.execute(sql`
    SELECT 1 FROM option_chain_snapshot
    WHERE underlying  = ${underlying}
      AND captured_at >= ${from}::date
      AND captured_at  < ${to}::date + INTERVAL '1 day'
    LIMIT 1
  `);
  return (r.rows?.length ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Top-level runner
// ---------------------------------------------------------------------------

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function runSnapshotPremiumReplay(params: {
  instruments: string[];
  fromDate: string | null;
  toDate: string | null;
  startingCapital: number;
  riskPerTradePct: number;
  lots: number;
}): Promise<{
  trades: BacktestTradeOut[];
  from: string;
  to: string;
  dataQuality: BacktestDataQualityOut;
  totalGrossPnl: number;
  totalCosts: number;
  totalNetPnl: number;
}> {
  const { instruments } = params;

  // Step 1: Generate directional signals on real spot candles (same as Mode B).
  const directionalTrades: BacktestTradeOut[] = [];
  const missing: string[] = [];
  let covFrom: number | null = null;
  let covTo: number | null = null;

  for (const sym of instruments) {
    if (!isSupportedInstrument(sym)) { missing.push(sym); continue; }
    const { candles, available } = await loadHistoricalCandles(
      sym,
      params.fromDate,
      params.toDate,
    );
    if (!available || candles.length === 0) { missing.push(sym); continue; }

    const lo = candles[0]!.t.getTime();
    const hi = candles[candles.length - 1]!.t.getTime();
    covFrom = covFrom === null ? lo : Math.min(covFrom, lo);
    covTo   = covTo   === null ? hi : Math.max(covTo,   hi);

    const lotSize = LOT_SIZES[sym] ?? 1;
    const symTrades = runDirectional(candles, {
      indexSymbol: sym,
      lotSize,
      startingCapital: params.startingCapital,
      riskPerTradePct: params.riskPerTradePct,
    });
    directionalTrades.push(...symTrades);
  }

  directionalTrades.sort((a, b) => {
    const ta = a.entryAt ? Date.parse(a.entryAt) : 0;
    const tb = b.entryAt ? Date.parse(b.entryAt) : 0;
    return ta - tb;
  });

  const from =
    covFrom !== null ? ymd(new Date(covFrom)) : params.fromDate ?? ymd(new Date());
  const to =
    covTo   !== null ? ymd(new Date(covTo))   : params.toDate   ?? ymd(new Date());

  // Step 2: Check if snapshot archive has ANY coverage for this window.
  let anySnapshotData = false;
  for (const sym of instruments) {
    if (await hasSnapshotData(sym, from, to)) { anySnapshotData = true; break; }
  }

  // Step 3: Per-underlying coverage details (always computed for the report).
  const underlyingCoverage: SnapshotUnderlyingCoverage[] = await Promise.all(
    instruments.map((sym) => buildUnderlyingCoverage(sym, from, to)),
  );

  // Step 4: If no snapshot data at all → return pre-coverage result (no proxy fallback).
  if (!anySnapshotData || directionalTrades.length === 0) {
    const emptyMix = {
      realCaptured: 0, realPartial: 0, bsModelled: 0,
      syntheticDeltaProxy: 0, unavailable: directionalTrades.length,
      total: directionalTrades.length, coveragePct: 0,
      lowCoverage: true,
      coverageFlag: "No captured snapshot data for the requested window — no trades could be priced.",
    };
    const dataQuality = buildSnapshotPremiumDataQuality({
      mix: emptyMix,
      underlyingCoverage,
      lots: params.lots,
      preCoverageRequest: true,
    });
    // Return the directional trades with UNAVAILABLE pricing (no P&L, no fabrication).
    const unavailableTrades = directionalTrades.map((t) => ({
      ...t,
      pnl: null,
      pricingMode: "UNAVAILABLE" as const,
      entryPremiumSource: "unavailable",
      exitPremiumSource: "unavailable",
      entryIv: null, entryDelta: null, entryTheta: null,
      grossPnl: null, costs: null, netPnl: null, withinTolerance: false,
      modeled: true,
    }));
    return { trades: unavailableTrades, from, to, dataQuality, totalGrossPnl: 0, totalCosts: 0, totalNetPnl: 0 };
  }

  // Step 5: Price each trade from snapshots.
  const expiryFetcher = makeExpiryFetcher();
  const snapshotFetcher = makeSnapshotFetcher();

  const pricedTrades = await priceTradesFromSnapshots(
    directionalTrades,
    expiryFetcher,
    snapshotFetcher,
  );

  // Step 6: Compute mode-mix coverage.
  const mix = computeRunCoverage(pricedTrades);

  // Step 7: Run-level cost aggregates.
  let totalGrossPnl = 0;
  let totalCosts = 0;
  let totalNetPnl = 0;
  for (const t of pricedTrades) {
    if (t.grossPnl !== null && t.grossPnl !== undefined) totalGrossPnl += t.grossPnl;
    if (t.costs?.total !== null && t.costs?.total !== undefined) totalCosts += t.costs.total;
    if (t.netPnl !== null && t.netPnl !== undefined) totalNetPnl += t.netPnl;
  }
  totalGrossPnl = Math.round(totalGrossPnl * 100) / 100;
  totalCosts    = Math.round(totalCosts * 100) / 100;
  totalNetPnl   = Math.round(totalNetPnl * 100) / 100;

  const dataQuality = buildSnapshotPremiumDataQuality({
    mix,
    underlyingCoverage,
    lots: params.lots,
    preCoverageRequest: false,
  });

  return { trades: pricedTrades, from, to, dataQuality, totalGrossPnl, totalCosts, totalNetPnl };
}
