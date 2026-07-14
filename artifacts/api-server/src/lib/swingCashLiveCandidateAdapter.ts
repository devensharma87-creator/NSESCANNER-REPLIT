/**
 * Swing CASH Live-Readiness — Phase 2: the ONE live data boundary.
 *
 * Everything that turns "a stored candidate snapshot" back into a *live*
 * `SwingCashCandidate` for a fresh re-check flows through here. Nothing else in
 * the staging lane talks to the market-data layer directly.
 *
 * Trust rules (mirrored from Phase 1 + the central market-data policy):
 *   - Kite is the ONLY authoritative source. A fresh, complete Kite quote is the
 *     only thing the Phase-1 data-trust gate will ever classify as trade-grade.
 *   - Yahoo / INDstocks / cache are NEVER trade-grade here. They flow through as
 *     their honest source name and the gate downgrades them (UNTRUSTED / STALE).
 *   - Missing / stale / unavailable data is labelled, NEVER fabricated. When no
 *     fresh quote can be obtained we null out `ltpAsOfMs` / `dailyCandleAsOfMs`
 *     and drop the source so the composer fails CLOSED (DATA_UNAVAILABLE/STALE).
 *
 * The fetcher is injectable so unit tests never touch the network; the default
 * `createKiteSwingQuoteFetcher()` wraps the trusted router's
 * `getEquityQuoteResolved`.
 */

import type { ValidationStatus } from "./marketData/types";
import { getEquityQuoteResolved, type ResolvedQuote } from "./marketData/router";
import type { SwingCashCandidate } from "./swingCashTypes";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * A normalised live quote for a single swing-cash symbol. This is the ONLY
 * shape the staging service consumes from the market-data layer — it deliberately
 * exposes just what the Phase-1 gates need plus honest provenance.
 */
export interface SwingLiveQuote {
  symbol: string;
  /** True only when a usable quote was produced (ok && finite ltp). */
  ok: boolean;
  ltp: number | null;
  /** Honest source name from the trusted layer ("kite" = authoritative). */
  dataSource: string | null;
  ltpAsOfMs: number | null;
  dailyCandleAsOfMs: number | null;
  ohlc: { open: number; high: number; low: number; close: number } | null;
  /** Layer's staleness verdict (informational; the gate re-derives from asOf). */
  isStale: boolean;
  /** Layer's per-datum validation outcome (informational). */
  validationStatus: ValidationStatus;
  /** Concrete reason when !ok — never silent. */
  reason: string | null;
}

export type SwingQuoteFetcher = (symbol: string) => Promise<SwingLiveQuote | null>;

/** Owner-supplied event/corporate-action affirmation (never inferred). */
export interface SwingEventOverride {
  /** Owner affirms the result schedule is KNOWN (so daysToResult is authoritative). */
  resultDateKnown?: boolean | null;
  /** ISO yyyy-mm-dd of the next result, if known. */
  resultDate?: string | null;
  /** Owner-confirmed corporate-action risk flag. */
  corporateActionRisk?: boolean | null;
}

export interface SwingRecheckAvailability {
  /** True when a fresh, finite LTP replaced the snapshot price. */
  ltpRefreshed: boolean;
  /** Source of the live quote attempt ("kite" / "yahoo" / null). */
  quoteSource: string | null;
  /** Layer's staleness verdict for the live attempt. */
  liveStaleSuspected: boolean;
  validationStatus: ValidationStatus;
  /** Fields carried forward from the frozen snapshot (NOT re-fetched live). */
  carriedFromSnapshot: string[];
  /** Honest notes about what could / could not be refreshed. */
  reasons: string[];
}

/** IST calendar date (yyyy-mm-dd) for a given epoch-ms. */
export function istDateKey(nowMs: number): string {
  return new Date(nowMs + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Whole-day difference (target − today), or null when either date is invalid. */
export function daysBetweenIstDates(todayIst: string, targetIst: string): number | null {
  const a = Date.parse(`${todayIst}T00:00:00Z`);
  const b = Date.parse(`${targetIst}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/** Map a trusted-router `ResolvedQuote` into the normalised swing live quote. */
export function mapResolvedToLiveQuote(symbol: string, r: ResolvedQuote): SwingLiveQuote {
  if (!r.ok || !r.data) {
    return {
      symbol,
      ok: false,
      ltp: null,
      dataSource: r.source ?? null,
      ltpAsOfMs: null,
      dailyCandleAsOfMs: null,
      ohlc: null,
      isStale: r.meta?.isStale ?? true,
      validationStatus: r.meta?.validationStatus ?? "unavailable",
      reason: r.reason ?? "quote_unavailable",
    };
  }
  const q = r.data;
  const m = q.meta;
  const asOfMs = m.asOf ? Date.parse(m.asOf) : NaN;
  const asOf = Number.isFinite(asOfMs) ? asOfMs : null;
  const { open, high, low } = q;
  const ohlc =
    Number.isFinite(open) && Number.isFinite(high) && Number.isFinite(low)
      ? { open: open as number, high: high as number, low: low as number, close: q.lastPrice }
      : null;
  const ltp = Number.isFinite(q.lastPrice) ? q.lastPrice : null;
  return {
    symbol,
    ok: ltp != null,
    ltp,
    dataSource: r.source ?? null,
    // For a live quote the day's OHLC is as-of the same quote instant.
    ltpAsOfMs: asOf,
    dailyCandleAsOfMs: asOf,
    ohlc,
    isStale: m.isStale,
    validationStatus: m.validationStatus,
    reason: ltp == null ? "ltp_missing" : null,
  };
}

/**
 * Default production fetcher — routes through the trusted market-data layer.
 * Kite-authoritative; failover/analytics sources flow through unbranded and the
 * Phase-1 gate downgrades them. Never throws (errors → null quote → fail-closed).
 */
export function createKiteSwingQuoteFetcher(): SwingQuoteFetcher {
  return async (symbol: string): Promise<SwingLiveQuote | null> => {
    try {
      const r = await getEquityQuoteResolved(symbol, "EQUITY");
      return mapResolvedToLiveQuote(symbol.toUpperCase(), r);
    } catch {
      return null;
    }
  };
}

function applyEventOverride(
  candidate: SwingCashCandidate,
  ov: SwingEventOverride,
  nowMs: number,
  reasons: string[],
): void {
  if (ov.resultDateKnown === true) {
    candidate.resultScheduleKnown = true;
    candidate.eventDataAvailable = true;
    if (ov.resultDate) {
      const days = daysBetweenIstDates(istDateKey(nowMs), ov.resultDate);
      if (days != null) {
        candidate.daysToResult = days;
        candidate.isResultDay = days === 0;
      } else {
        reasons.push("EVENT_OVERRIDE_RESULT_DATE_INVALID");
      }
    }
  }
  if (ov.corporateActionRisk != null) {
    candidate.corporateActionRisk = ov.corporateActionRisk;
    candidate.eventDataAvailable = true;
  }
}

/**
 * Rebuild a live `SwingCashCandidate` from a frozen snapshot + a fresh quote.
 *
 * The IMMUTABLE swing plan (entry/stop/target/atr/sector/zone/signal age) and the
 * slower-moving liquidity/event inputs are carried verbatim from the snapshot —
 * we never recompute the plan. Only the live-changing data-trust fields (ltp,
 * source, freshness, ohlc) are overwritten from the fresh quote. When no fresh
 * quote exists we drop the freshness/source so the composer fails CLOSED.
 *
 * Pure: no I/O. Safe to unit-test directly.
 */
export function rebuildCandidateForRecheck(
  snapshot: SwingCashCandidate,
  quote: SwingLiveQuote | null,
  override: SwingEventOverride | null,
  nowMs: number,
): { candidate: SwingCashCandidate; availability: SwingRecheckAvailability } {
  const reasons: string[] = [];
  const fresh = !!quote && quote.ok && quote.ltp != null && Number.isFinite(quote.ltp);

  if (!quote) reasons.push("LIVE_QUOTE_NOT_FETCHED");
  else if (!quote.ok) reasons.push(quote.reason ?? "LIVE_QUOTE_UNAVAILABLE");
  else if (quote.ltp == null) reasons.push("LIVE_LTP_MISSING");

  // The day's OHLC candle and its as-of timestamp move together. We never stamp
  // a FRESH daily-candle timestamp over a snapshot candle carried forward — that
  // would claim freshness we don't have and could mask missing daily data as
  // trade-grade. The LTP refreshes independently of the daily candle.
  const freshDaily = fresh && quote!.ohlc != null;
  if (fresh && !freshDaily) reasons.push("LIVE_OHLC_MISSING_DAILY_CARRIED");

  const candidate: SwingCashCandidate = {
    ...snapshot,
    nowMs,
    // Live-changing data-trust fields — refreshed when fresh, else fail-closed.
    ltp: fresh ? (quote!.ltp as number) : snapshot.ltp,
    dataSource: fresh ? quote!.dataSource : null,
    ltpAsOfMs: fresh ? quote!.ltpAsOfMs : null,
    dailyCandleAsOfMs: freshDaily ? quote!.dailyCandleAsOfMs : snapshot.dailyCandleAsOfMs,
    ohlc: freshDaily ? quote!.ohlc : snapshot.ohlc,
  };

  if (override) applyEventOverride(candidate, override, nowMs, reasons);

  const availability: SwingRecheckAvailability = {
    ltpRefreshed: fresh,
    quoteSource: quote?.dataSource ?? null,
    liveStaleSuspected: quote?.isStale ?? true,
    validationStatus: quote?.validationStatus ?? "unavailable",
    carriedFromSnapshot: [
      "swing_plan(entry/stop/target/atr/zone)",
      "liquidity_inputs",
      "event_inputs",
      "signal_age",
    ],
    reasons,
  };

  return { candidate, availability };
}
