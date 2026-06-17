/**
 * Live intraday bias for an option-chain underlying.
 *
 * Sources 15-minute candles **Kite-first** (real broker feed, no Yahoo
 * 15-min delay) with a Yahoo fallback, then computes a price-action bias
 * from VWAP / EMA9 / EMA21 / RSI14 — exactly the same recipe used by the
 * F&O Intraday Signals engine and `marketTrend.getMarketTrend()` so the
 * three surfaces never disagree.
 *
 * The strategies route blends this with the option-chain's structural
 * bias (PCR + max-pain) to produce the "current market situation" bias
 * that drives recommendations.
 *
 * Honours the no-synthetic-data rule: when intraday data is unavailable
 * OR insufficient (< 6 bars to compute EMA21/RSI14 reliably) the function
 * returns `null` and the caller falls through to structural bias only —
 * never a fabricated neutral verdict.
 */

import { centralIndexCandles, centralEquityCandles } from "./marketData/compat";
import { ema, rsi, sessionVwap } from "./indicators";

export interface LiveBiasSnapshot {
  /** Where the candles came from on this fetch. */
  source: "kite";
  /** ISO timestamp of when this snapshot was computed. */
  fetchedAt: string;
  /** Last 15-min close. */
  last: number;
  /** Session VWAP at the last bar. */
  vwap: number;
  ema9: number;
  ema21: number;
  rsi14: number;
  /** Directional bias derived from the live read. */
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  /** Age of the most-recent bar in minutes (lets the UI flag staleness). */
  ageMin: number;
  /** Plain-English explanation — surfaced verbatim in card rationales. */
  reason: string;
}

/** Index → Yahoo symbol the underlying historical chart endpoint expects.
 *  Must cover every index in `INDEX_SET` of `optionChain.ts` so that the
 *  Strategies tab gets a live read for *all* selectable underlyings. */
const INDEX_TO_YAHOO: Record<string, string> = {
  NIFTY: "^NSEI",
  BANKNIFTY: "^NSEBANK",
  // Yahoo's chart endpoint accepts both the legacy ^CNXFIN and the newer
  // NIFTY_FIN_SERVICE.NS — INDEX_TABLE in kiteIntraday now carries both
  // aliases, so either path resolves to the same Kite token.
  FINNIFTY: "^CNXFIN",
  MIDCPNIFTY: "NIFTY_MID_SELECT.NS",
  // NIFTYNXT50 has no working Yahoo intraday symbol — the synthetic key
  // resolves through Kite's INDEX_TABLE only. Yahoo fallback will fail
  // (graceful null), which is acceptable: Kite is the live source the
  // user actually relies on for this index.
  NIFTYNXT50: "NIFTY_NEXT_50.NS",
  SENSEX: "^BSESN",
  BANKEX: "BSE-BANK.BO",
};

/** Slice an intraday candle series down to the *current trading session*.
 *  Without this, computing VWAP over multiple days of 15m bars dilutes the
 *  current-session anchor and the live read no longer reflects today's
 *  tape — exactly what the Strategies engine needs to react to.
 *
 *  Strategy: take all bars whose IST date matches the most-recent bar's
 *  IST date. NSE sessions are 09:15–15:30 IST (single date), so this
 *  cleanly bounds to one session even if the upstream returned 5 days. */
function sliceCurrentSession(intra: {
  high: number[]; low: number[]; close: number[]; volume: number[]; timestamps: number[];
}): { high: number[]; low: number[]; close: number[]; volume: number[]; timestamps: number[] } {
  const ts = intra.timestamps;
  if (ts.length === 0) return intra;
  const istDate = (sec: number) =>
    new Date((sec + 5.5 * 3600) * 1000).toISOString().slice(0, 10);
  const lastDay = istDate(ts[ts.length - 1]!);
  // Find the first index whose IST date equals lastDay — bars are
  // chronological so a single forward scan from the tail is enough.
  let startIdx = ts.length;
  for (let i = ts.length - 1; i >= 0; i--) {
    if (istDate(ts[i]!) === lastDay) startIdx = i;
    else break;
  }
  return {
    high: intra.high.slice(startIdx),
    low: intra.low.slice(startIdx),
    close: intra.close.slice(startIdx),
    volume: intra.volume.slice(startIdx),
    timestamps: intra.timestamps.slice(startIdx),
  };
}

function lastVal(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i] as number;
  return null;
}

export async function computeLiveBias(
  underlying: string,
  kind: "INDEX" | "EQUITY",
): Promise<LiveBiasSnapshot | null> {
  const sym = underlying.toUpperCase();

  // STRICT KITE-ONLY (2026-05-06). The live-bias card drives F&O entry
  // decisions; a 15-min-stale Yahoo bias is worse than no bias because
  // it looks fresh in the UI. When Kite intraday is unavailable we
  // return null and the UI surfaces "Live data unavailable".
  let intra: { high: number[]; low: number[]; close: number[]; volume: number[]; timestamps: number[] } | null = null;
  const source: "kite" = "kite";

  if (kind === "INDEX") {
    const yh = INDEX_TO_YAHOO[sym];
    if (!yh) return null;
    const k = await centralIndexCandles(yh, "15minute", 5).catch(() => null);
    if (k && k.close.length >= 6) intra = k;
  } else {
    const k = await centralEquityCandles(sym, "15minute", 5).catch(() => null);
    if (k && k.close.length >= 6) intra = k;
  }

  if (!intra || intra.close.length < 6) return null;

  const last = intra.close[intra.close.length - 1]!;
  // VWAP is an intraday indicator with a daily reset by design — a true
  // session anchor. Computing it over multiple days of bars (which the
  // upstream returns to give EMAs/RSI enough warm-up) would dilute the
  // current-session read and make "spot above/below VWAP" meaningless.
  // EMA9/EMA21/RSI14 are continuous trend indicators that benefit from
  // the multi-day warm-up, so they keep using the full series.
  const sessionBars = sliceCurrentSession(intra);
  const vwap = lastVal(sessionVwap(
    sessionBars.high, sessionBars.low, sessionBars.close, sessionBars.volume,
  ));
  const e9 = lastVal(ema(intra.close, 9));
  const e21 = lastVal(ema(intra.close, 21));
  const r14 = lastVal(rsi(intra.close, 14));
  // Honest absence beats a mechanically-neutral verdict — same policy the
  // marketTrend engine uses. If any indicator can't compute, return null.
  if (vwap == null || e9 == null || e21 == null || r14 == null) return null;

  const above = last > vwap && e9 > e21;
  const below = last < vwap && e9 < e21;
  let bias: LiveBiasSnapshot["bias"] = "NEUTRAL";
  let reason: string;
  if (above && r14 >= 50) {
    bias = "BULLISH";
    reason = `spot ${last.toFixed(2)} above VWAP ${vwap.toFixed(2)}, EMA9>EMA21, RSI ${r14.toFixed(0)}`;
  } else if (below && r14 <= 50) {
    bias = "BEARISH";
    reason = `spot ${last.toFixed(2)} below VWAP ${vwap.toFixed(2)}, EMA9<EMA21, RSI ${r14.toFixed(0)}`;
  } else {
    reason = `spot ${last.toFixed(2)}, VWAP ${vwap.toFixed(2)}, RSI ${r14.toFixed(0)} — no clear directional read`;
  }

  // ageMin: timestamps are unix seconds. Lets the UI flag stale reads
  // (e.g. > 30 min after market close).
  const lastTsSec = intra.timestamps[intra.timestamps.length - 1] ?? Math.floor(Date.now() / 1000);
  const ageMin = Math.max(0, Math.round((Date.now() / 1000 - lastTsSec) / 60));

  return {
    source,
    fetchedAt: new Date().toISOString(),
    last: +last.toFixed(2),
    vwap: +vwap.toFixed(2),
    ema9: +e9.toFixed(2),
    ema21: +e21.toFixed(2),
    rsi14: +r14.toFixed(2),
    bias,
    ageMin,
    reason,
  };
}
