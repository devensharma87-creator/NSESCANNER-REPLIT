/**
 * Scanner data-path source honesty — Part C (scan-level) and Part D (row-level).
 *
 * Part C — ScannerSourceHealth: aggregates row-level provenance into a single
 * scan-level contract surfaced at GET /api/scan/health. One honest banner
 * instead of every consumer re-deriving the aggregate.
 *
 * Part D — ScannerRowSource: flat, consumer-friendly re-expression of the
 * existing SourceProvenance using the scanner UI vocabulary. Derived pure from
 * SourceProvenance; SourceProvenance itself is NOT replaced.
 *
 * INVARIANT: canDriveSignals / canDriveTradeAlerts are ONLY true when
 * sourceStatus === "TRADE_GRADE" (fresh Kite authoritative, non-delayed).
 * Yahoo, stale Kite, EOD Kite, cache, and no-feed rows are ALL false.
 *
 * CONSTRAINT: zero trading/F&O/swing/threshold/broker/scheduler/DB changes.
 * This module is pure (no I/O). All I/O stays in the callers.
 */

import type { SourceProvenance } from "./scannerProvenance";

// ── Part D — row-level source contract ───────────────────────────────────────

/**
 * Source vocabulary for a scanner row's data point.
 * - kite      Kite Connect live or EOD quote
 * - yahoo     Yahoo Finance delayed daily quote
 * - cache     Cached row with no deterministic source label (future extensibility)
 * - computed  Entirely derived/computed, no live feed (future extensibility)
 * - none      No source resolved (feed unavailable or no provenance)
 */
export type ScannerRowSourceKind = "kite" | "yahoo" | "cache" | "computed" | "none";

/**
 * Trust status for a scanner row's data point.
 * - TRADE_GRADE  Kite authoritative, fresh intraday — suitable for signals and trade alerts
 * - DELAYED      Authoritative source but end-of-day/delayed (e.g. fresh EOD Kite bar)
 * - INFO_ONLY    Secondary/analytics source (Yahoo, cache) — never drives signals or trades
 * - STALE        Any source past its freshness budget — treat as reference only
 * - NO_FEED      No source resolved at all — cannot be used for any purpose
 */
export type ScannerRowSourceStatus =
  | "TRADE_GRADE"
  | "DELAYED"
  | "INFO_ONLY"
  | "STALE"
  | "NO_FEED";

/** Part D — row-level source contract. */
export interface ScannerRowSource {
  symbol: string;
  source: ScannerRowSourceKind;
  sourceStatus: ScannerRowSourceStatus;
  /** ISO 8601 string of the quote timestamp, or null when unavailable. */
  asOf: string | null;
  freshnessSec: number | null;
  /**
   * True ONLY when sourceStatus === "TRADE_GRADE" (fresh Kite intraday).
   * Yahoo, stale, EOD, cache, and no-feed rows are always false.
   */
  canDriveSignals: boolean;
  /**
   * True ONLY when sourceStatus === "TRADE_GRADE".
   * Mirrors canDriveSignals — a row that can't drive signals can't drive trade alerts.
   */
  canDriveTradeAlerts: boolean;
  /** First user-facing warning from provenance.warnings, or null. */
  warning: string | null;
}

// ── Part C — scan-level aggregate ────────────────────────────────────────────

/**
 * Aggregate source status across all rows in a scanner result set.
 * - KITE_TRADE_GRADE  All rows are fresh Kite trade-grade (ideal state)
 * - KITE_PARTIAL      Some rows are trade-grade; others are stale/missing
 * - YAHOO_INFO_ONLY   All rows are Yahoo-sourced (no live Kite feed)
 * - STALE_CACHE       All rows are stale Kite (feed reconnecting)
 * - MIXED_SOURCES     Mix of Kite/Yahoo/stale/missing across rows
 * - NO_FEED           No data available at all
 */
export type ScannerSourceStatusKind =
  | "KITE_TRADE_GRADE"
  | "KITE_PARTIAL"
  | "YAHOO_INFO_ONLY"
  | "STALE_CACHE"
  | "MIXED_SOURCES"
  | "NO_FEED";

/** Per-bucket row counts for scanner result provenance distribution. */
export interface ScannerRowCounts {
  total: number;
  kiteLive: number;
  kiteStale: number;
  yahooDelayed: number;
  yahooStale: number;
  cache: number;
  noFeed: number;
}

/** Part C — scan-level source health aggregate. */
export interface ScannerSourceHealth {
  scanId: string | null;
  scanAt: string | null;
  marketSession: "open" | "closed" | "pre_open" | "unknown";
  sourceStatus: ScannerSourceStatusKind;
  /** True ONLY when sourceStatus === "KITE_TRADE_GRADE" (all rows live Kite). */
  tradeGrade: boolean;
  /** Same invariant as tradeGrade. */
  canDriveSignals: boolean;
  rowCounts: ScannerRowCounts;
  /** ISO 8601 string of the oldest row asOf across all rows, or null. */
  oldestAsOf: string | null;
  /** ISO 8601 string of the newest row asOf across all rows, or null. */
  newestAsOf: string | null;
  warning: string | null;
  /** Deep-link action hint (e.g. "/kite"), or null. */
  action: string | null;
}

// ── Derivation helpers (pure) ─────────────────────────────────────────────────

function deriveRowSource(prov: SourceProvenance | null | undefined): ScannerRowSourceKind {
  if (!prov || prov.sourceProvider === null) return "none";
  return prov.sourceProvider; // "kite" | "yahoo" — only values in SourceProvenance
}

function deriveRowSourceStatus(
  source: ScannerRowSourceKind,
  prov: SourceProvenance | null | undefined,
): ScannerRowSourceStatus {
  if (source === "none") return "NO_FEED";
  if (source === "cache" || source === "computed") return "INFO_ONLY";
  // Stale overrides source — past freshness budget is not usable regardless of provider
  if (prov?.isStale === true) return "STALE";
  if (source === "kite") {
    // A fresh EOD Kite bar is authoritative but delayed — not same-session trade-grade
    return prov?.delayed ? "DELAYED" : "TRADE_GRADE";
  }
  // yahoo (fresh): always INFO_ONLY — delayed secondary reference, never trade-grade
  return "INFO_ONLY";
}

/**
 * Derive the Part D row-level source contract from an existing SourceProvenance.
 * Pure — no network or DB calls.
 *
 * This is a RE-EXPRESSION of SourceProvenance using the scanner UI vocabulary.
 * SourceProvenance is NOT replaced; both coexist on StockRow.
 */
export function toScannerRowSource(
  prov: SourceProvenance | null | undefined,
  symbol: string,
): ScannerRowSource {
  const source = deriveRowSource(prov);
  const sourceStatus = deriveRowSourceStatus(source, prov);
  const canDriveSignals = sourceStatus === "TRADE_GRADE";
  const asOf = prov?.asOf != null ? new Date(prov.asOf * 1000).toISOString() : null;
  const warning = prov?.warnings?.length ? (prov.warnings[0] ?? null) : null;

  return {
    symbol,
    source,
    sourceStatus,
    asOf,
    freshnessSec: prov?.freshnessSec ?? null,
    canDriveSignals,
    canDriveTradeAlerts: canDriveSignals,
    warning,
  };
}

/**
 * Build the Part C scan-level source health from a set of scanner rows.
 * Accepts any row shape carrying `symbol` + optional `provenance`.
 * Pure — no network or DB calls.
 */
export function buildScannerSourceHealth(
  rows: Array<{ symbol: string; provenance?: SourceProvenance | null }>,
  options: {
    marketSession?: "open" | "closed" | "pre_open" | "unknown";
    scanAt?: string | null;
    scanId?: string | null;
  } = {},
): ScannerSourceHealth {
  const { marketSession = "unknown", scanAt = null, scanId = null } = options;

  if (rows.length === 0) {
    return {
      scanId, scanAt, marketSession,
      sourceStatus: "NO_FEED",
      tradeGrade: false,
      canDriveSignals: false,
      rowCounts: {
        total: 0, kiteLive: 0, kiteStale: 0,
        yahooDelayed: 0, yahooStale: 0, cache: 0, noFeed: 0,
      },
      oldestAsOf: null,
      newestAsOf: null,
      warning: "No scanner rows available.",
      action: null,
    };
  }

  let kiteLive = 0;
  let kiteStale = 0;
  let yahooDelayed = 0;
  let yahooStale = 0;
  let cache = 0;
  let noFeed = 0;
  // Phase A scanner upgrade: rows where a Kite REST batch quote was used for
  // price/OHLC/volume/prevClose while the signal/indicator source is Yahoo.
  let kitePriceRows = 0;
  let oldestAsOfSec: number | null = null;
  let newestAsOfSec: number | null = null;

  for (const row of rows) {
    const prov = row.provenance;
    const source = deriveRowSource(prov);
    const status = deriveRowSourceStatus(source, prov);

    if (status === "TRADE_GRADE") kiteLive++;
    else if (source === "kite") kiteStale++;              // STALE or DELAYED from Kite
    else if (source === "yahoo" && status !== "STALE") yahooDelayed++;
    else if (source === "yahoo") yahooStale++;
    else if (source === "cache" || source === "computed") cache++;
    else noFeed++;

    if (prov?.kitePriceOverlay === true) kitePriceRows++;

    if (prov?.asOf != null) {
      if (oldestAsOfSec === null || prov.asOf < oldestAsOfSec) oldestAsOfSec = prov.asOf;
      if (newestAsOfSec === null || prov.asOf > newestAsOfSec) newestAsOfSec = prov.asOf;
    }
  }

  const total = rows.length;
  const rowCounts: ScannerRowCounts = {
    total, kiteLive, kiteStale, yahooDelayed, yahooStale, cache, noFeed,
  };

  let sourceStatus: ScannerSourceStatusKind;
  let tradeGrade = false;
  let warning: string | null = null;
  let action: string | null = null;

  if (total === noFeed) {
    sourceStatus = "NO_FEED";
    warning = "No data feed available for any scanner row.";
    action = "/kite";
  } else if (total === kiteLive) {
    sourceStatus = "KITE_TRADE_GRADE";
    tradeGrade = true;
  } else if (yahooDelayed + yahooStale === total && kitePriceRows > 0) {
    // Phase A: all rows are Yahoo-indicator sourced, but Kite REST batch quotes
    // are supplying live price/OHLC/volume/prevClose. Scanner remains info-only
    // (canDriveSignals=false) until Phase B wires Kite candles for indicators.
    sourceStatus = "KITE_PARTIAL";
    warning =
      `Kite price overlay active for ${kitePriceRows} of ${total} rows. ` +
      "Scanner indicators still use Yahoo daily candles — info-only until Kite candle warehouse is active (Phase B).";
  } else if (yahooDelayed + yahooStale === total) {
    sourceStatus = "YAHOO_INFO_ONLY";
    warning =
      "All rows are sourced from delayed Yahoo Finance data (~15 min delayed). " +
      "Signals are info-only — not trade-grade.";
    action = "/kite";
  } else if (
    kiteStale > 0 &&
    kiteLive === 0 &&
    yahooDelayed === 0 &&
    yahooStale === 0 &&
    noFeed === 0
  ) {
    sourceStatus = "STALE_CACHE";
    warning = "Scanner data is stale — Kite feed may be reconnecting.";
  } else if (kiteLive > 0 && yahooDelayed === 0 && yahooStale === 0) {
    sourceStatus = "KITE_PARTIAL";
    const degraded = kiteStale + noFeed + cache;
    warning = `${kiteLive} of ${total} rows are trade-grade. ${degraded} rows have degraded or missing data.`;
  } else {
    sourceStatus = "MIXED_SOURCES";
    warning =
      `Mixed sources: ${kiteLive} Kite live, ${kiteStale} Kite stale, ` +
      `${yahooDelayed} Yahoo delayed, ${yahooStale} Yahoo stale, ${noFeed} no feed.`;
  }

  return {
    scanId,
    scanAt,
    marketSession,
    sourceStatus,
    tradeGrade,
    canDriveSignals: tradeGrade,
    rowCounts,
    oldestAsOf: oldestAsOfSec != null ? new Date(oldestAsOfSec * 1000).toISOString() : null,
    newestAsOf: newestAsOfSec != null ? new Date(newestAsOfSec * 1000).toISOString() : null,
    warning,
    action,
  };
}
