/**
 * Backtest Lab V2 — builds the causal StrategyContext for a single index's
 * historical 15-min SPOT candles. Every series is computed strictly forward; no
 * value at index i ever depends on a bar > i.
 */

import { ema, rsi, atr, adx } from "../../indicators";
import type { Candle } from "../directional";
import {
  INDEX_CFG,
  OR_BARS,
  type IndexCfg,
  type StrategyContext,
} from "./base";

function dayKey(t: Date): string {
  return `${t.getUTCFullYear()}-${t.getUTCMonth()}-${t.getUTCDate()}`;
}
function istMinuteOfDay(t: Date): number {
  return t.getUTCHours() * 60 + t.getUTCMinutes();
}

interface SessionAgg {
  high: number;
  low: number;
  close: number;
}

export function buildContext(indexSymbol: string, candles: Candle[]): StrategyContext | null {
  const cfg: IndexCfg | undefined = INDEX_CFG[indexSymbol];
  if (!cfg || candles.length === 0) return null;

  const n = candles.length;
  const closes = candles.map((c) => c.c);
  const highs = candles.map((c) => c.h);
  const lows = candles.map((c) => c.l);
  const opens = candles.map((c) => c.o);

  const ema9 = ema(closes, 9);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(highs, lows, closes, 14);
  const adx14 = adx(highs, lows, closes, 14);

  const sessionMean = new Array<number>(n).fill(NaN);
  const istMinute = new Array<number>(n).fill(0);
  const barInSession = new Array<number>(n).fill(0);
  const isLastBarOfDay = new Array<boolean>(n).fill(false);
  const orHigh = new Array<number | null>(n).fill(null);
  const orLow = new Array<number | null>(n).fill(null);
  const dayHighSoFar = new Array<number>(n).fill(NaN);
  const dayLowSoFar = new Array<number>(n).fill(NaN);
  const prevDayHigh = new Array<number | null>(n).fill(null);
  const prevDayLow = new Array<number | null>(n).fill(null);
  const prevDayClose = new Array<number | null>(n).fill(null);
  const cprHigh = new Array<number | null>(n).fill(null);
  const cprLow = new Array<number | null>(n).fill(null);

  let curDay = "";
  let sum = 0;
  let cnt = 0;
  let curOrHi = -Infinity;
  let curOrLo = Infinity;
  let curDayHi = -Infinity;
  let curDayLo = Infinity;
  // The previous COMPLETED session's aggregate, carried into the current day.
  let prevAgg: SessionAgg | null = null;
  // The session being accumulated (becomes prevAgg when the day flips).
  let liveAgg: SessionAgg | null = null;

  for (let i = 0; i < n; i++) {
    const t = candles[i]!.t;
    const k = dayKey(t);
    istMinute[i] = istMinuteOfDay(t);

    if (k !== curDay) {
      // A new day starts: the day we just finished becomes "previous".
      if (liveAgg) prevAgg = liveAgg;
      curDay = k;
      sum = 0;
      cnt = 0;
      curOrHi = -Infinity;
      curOrLo = Infinity;
      curDayHi = -Infinity;
      curDayLo = Infinity;
      liveAgg = { high: highs[i]!, low: lows[i]!, close: closes[i]! };
    } else {
      liveAgg!.high = Math.max(liveAgg!.high, highs[i]!);
      liveAgg!.low = Math.min(liveAgg!.low, lows[i]!);
      liveAgg!.close = closes[i]!;
    }

    const bis = cnt; // 0-based position within the session BEFORE adding this bar
    barInSession[i] = bis;

    // Opening range: accumulate over the first OR_BARS bars of the session.
    if (bis < OR_BARS) {
      curOrHi = Math.max(curOrHi, highs[i]!);
      curOrLo = Math.min(curOrLo, lows[i]!);
    }
    // OR is "ready" only once the opening window has fully formed.
    if (bis >= OR_BARS && Number.isFinite(curOrHi) && Number.isFinite(curOrLo)) {
      orHigh[i] = curOrHi;
      orLow[i] = curOrLo;
    }

    // Running intraday extremes inclusive of this bar.
    curDayHi = Math.max(curDayHi, highs[i]!);
    curDayLo = Math.min(curDayLo, lows[i]!);
    dayHighSoFar[i] = curDayHi;
    dayLowSoFar[i] = curDayLo;

    // Session mean of typical price (VWAP substitute).
    const typ = (highs[i]! + lows[i]! + closes[i]!) / 3;
    sum += typ;
    cnt += 1;
    sessionMean[i] = sum / cnt;

    // Previous-day levels + CPR (from the prior completed session only).
    if (prevAgg) {
      prevDayHigh[i] = prevAgg.high;
      prevDayLow[i] = prevAgg.low;
      prevDayClose[i] = prevAgg.close;
      const pivot = (prevAgg.high + prevAgg.low + prevAgg.close) / 3;
      const bc = (prevAgg.high + prevAgg.low) / 2;
      const tc = 2 * pivot - bc;
      cprHigh[i] = Math.max(bc, tc);
      cprLow[i] = Math.min(bc, tc);
    }

    isLastBarOfDay[i] = i === n - 1 || dayKey(candles[i + 1]!.t) !== k;
  }

  return {
    indexSymbol,
    cfg,
    candles,
    closes,
    highs,
    lows,
    opens,
    ema9,
    ema20,
    ema50,
    rsi14,
    atr14,
    adx14,
    sessionMean,
    istMinute,
    barInSession,
    isLastBarOfDay,
    orHigh,
    orLow,
    dayHighSoFar,
    dayLowSoFar,
    prevDayHigh,
    prevDayLow,
    prevDayClose,
    cprHigh,
    cprLow,
  };
}
