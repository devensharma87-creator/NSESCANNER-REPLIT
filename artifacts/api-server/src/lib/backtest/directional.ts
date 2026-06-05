/**
 * Backtest Lab — Mode B (DIRECTIONAL): 2-year replay of the engine's
 * RECONSTRUCTABLE directional layer on historical 15-min index SPOT candles.
 *
 * What is REAL here:
 *   - The spot OHLC (real Kite history), every entry/exit SPOT, and every
 *     indicator (EMA / RSI / ATR / ADX / BB-width) + the regime classification,
 *     all computed by the SAME pure libs the live engine uses.
 *
 * What is MODELED (and flagged on every trade via `modeled: true`):
 *   - Option P&L. There are NO historical option premiums, so per-trade P&L is
 *     a clearly-labeled DELTA PROXY: |delta| · directionSign · (exitSpot −
 *     entrySpot) · lotSize · lots, with an ATM |delta| ≈ 0.5. Entry/exit
 *     PREMIUMS are left null (unknown) — only the modeled CHANGE is shown.
 *   - The VWAP input to the regime trend-direction check. Historical index
 *     candles carry NO volume, so a true VWAP is impossible. We substitute an
 *     honest EQUAL-weighted session-mean of typical price (NOT pretending to be
 *     volume-weighted) and say so in the data-quality panel.
 *
 * No look-ahead: bars are walked strictly forward; an open trade is managed only
 * by bars at or after entry, and never held overnight (closed at the session's
 * 15:20 IST / final bar).
 */

import { ema, rsi, atr, adx } from "../indicators";
import { classifyRegime } from "../regimeClassifier";
import type {
  BacktestDataQualityOut,
  BacktestTradeOut,
  BacktestCoverageWindow,
} from "./types";

export interface Candle {
  /** Wall-clock IST instant encoded in the Date's UTC fields. */
  t: Date;
  o: number;
  h: number;
  l: number;
  c: number;
}

interface IndexCfg {
  expiryWeekday: number;
  expiryCadence: "weekly" | "monthly";
  strikeStep: number;
}

// Real configured values (mirror optionChain.ts IndexCfg / STRIKE_STEPS).
const INDEX_CFG: Record<string, IndexCfg> = {
  NIFTY: { expiryWeekday: 2, expiryCadence: "weekly", strikeStep: 50 },
  BANKNIFTY: { expiryWeekday: 4, expiryCadence: "monthly", strikeStep: 100 },
  SENSEX: { expiryWeekday: 2, expiryCadence: "weekly", strikeStep: 100 },
};

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const ATM_DELTA = 0.5; // ATM long-option delta magnitude (modeled).
const WARMUP_BARS = 30; // ADX(14) needs ~2× period to stabilise.
const FORCE_EXIT_MIN = 15 * 60 + 20; // 15:20 IST.
const MAX_LOTS = 50;
const RSI_BULL = [50, 72] as const;
const RSI_BEAR = [28, 50] as const;

export interface DirectionalOptions {
  indexSymbol: string;
  lotSize: number;
  startingCapital: number;
  riskPerTradePct: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function istMinuteOfDay(t: Date): number {
  return t.getUTCHours() * 60 + t.getUTCMinutes();
}

function dayKey(t: Date): string {
  return `${t.getUTCFullYear()}-${t.getUTCMonth()}-${t.getUTCDate()}`;
}

/**
 * Run the directional replay. `candles` MUST be ascending by time and already
 * filtered to the requested window. Returns modeled trades (never fabricated
 * option premiums).
 */
export function runDirectional(
  candles: Candle[],
  opts: DirectionalOptions,
): BacktestTradeOut[] {
  const cfg = INDEX_CFG[opts.indexSymbol];
  if (!cfg || candles.length < WARMUP_BARS + 2) return [];

  const closes = candles.map((c) => c.c);
  const highs = candles.map((c) => c.h);
  const lows = candles.map((c) => c.l);

  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(highs, lows, closes, 14);
  const adx14 = adx(highs, lows, closes, 14);

  // Equal-weighted session-mean of typical price (labeled VWAP substitute).
  const sessionMean: number[] = new Array(candles.length).fill(NaN);
  {
    let curDay = "";
    let sum = 0;
    let cnt = 0;
    for (let i = 0; i < candles.length; i++) {
      const k = dayKey(candles[i]!.t);
      if (k !== curDay) {
        curDay = k;
        sum = 0;
        cnt = 0;
      }
      const typ = (highs[i]! + lows[i]! + closes[i]!) / 3;
      sum += typ;
      cnt += 1;
      sessionMean[i] = sum / cnt;
    }
  }

  const riskAmount = (opts.startingCapital * opts.riskPerTradePct) / 100;
  const trades: BacktestTradeOut[] = [];

  type Open = {
    dir: "BULL" | "BEAR";
    entryIdx: number;
    entrySpot: number;
    stop: number;
    target: number;
    atr: number;
    lots: number;
    regime: string;
  };
  let open: Open | null = null;

  const closeTrade = (o: Open, exitIdx: number, reason: string) => {
    const exitSpot = closes[exitIdx]!;
    const sign = o.dir === "BULL" ? 1 : -1;
    const optionMovePerUnit = ATM_DELTA * sign * (exitSpot - o.entrySpot);
    const pnl = round2(optionMovePerUnit * opts.lotSize * o.lots);
    const cfgStep = cfg.strikeStep;
    const strike = Math.round(o.entrySpot / cfgStep) * cfgStep;
    trades.push({
      id: `dir:${opts.indexSymbol}:${candles[o.entryIdx]!.t.toISOString()}`,
      indexSymbol: opts.indexSymbol,
      setupKey: "DIRECTIONAL_TREND",
      setupName: `Directional ${o.dir === "BULL" ? "trend-long (CALL)" : "trend-short (PUT)"}`,
      direction: o.dir === "BULL" ? "BULLISH" : "BEARISH",
      optionType: o.dir === "BULL" ? "CALL" : "PUT",
      strike,
      entryAt: candles[o.entryIdx]!.t.toISOString(),
      exitAt: candles[exitIdx]!.t.toISOString(),
      entrySpot: round2(o.entrySpot),
      exitSpot: round2(exitSpot),
      optionEntry: null, // no historical premium — unknown, not fabricated
      optionExit: null,
      optionStop: null,
      optionTarget1: null,
      optionTarget2: null,
      lots: o.lots,
      lotSize: opts.lotSize,
      qty: opts.lotSize * o.lots,
      pnl,
      exitReason: reason,
      confidence: null,
      tier: null,
      regime: o.regime,
      modeled: true,
      maxFavorableExcursion: null,
      maxAdverseExcursion: null,
    });
  };

  for (let i = WARMUP_BARS; i < candles.length; i++) {
    const c = candles[i]!;
    const isLastBarOfDay =
      i === candles.length - 1 || dayKey(candles[i + 1]!.t) !== dayKey(c.t);
    const atForceExit = istMinuteOfDay(c.t) >= FORCE_EXIT_MIN;

    // ---- manage an open trade first (no look-ahead: only bars >= entry) ----
    if (open) {
      if (open.dir === "BULL") {
        if (c.l <= open.stop) {
          closeTradeAtPrice(open, i, open.stop, "STOP");
          open = null;
        } else if (c.h >= open.target) {
          closeTradeAtPrice(open, i, open.target, "TARGET");
          open = null;
        }
      } else {
        if (c.h >= open.stop) {
          closeTradeAtPrice(open, i, open.stop, "STOP");
          open = null;
        } else if (c.l <= open.target) {
          closeTradeAtPrice(open, i, open.target, "TARGET");
          open = null;
        }
      }
      if (open && (atForceExit || isLastBarOfDay)) {
        closeTrade(open, i, atForceExit ? "TIME_EXIT_1520" : "EOD_EXIT");
        open = null;
      }
      continue; // one position at a time
    }

    // ---- no new entries on the closing leg of the session ----
    if (atForceExit || isLastBarOfDay) continue;

    const e9 = ema9[i];
    const e21 = ema21[i];
    const r = rsi14[i];
    const a = atr14[i];
    const ax = adx14[i];
    const sm = sessionMean[i];
    if (
      e9 == null || e21 == null || r == null || a == null || ax == null ||
      !Number.isFinite(sm) || a <= 0
    ) {
      continue;
    }

    const nowForRegime = new Date(c.t.getTime() - IST_OFFSET_MS);
    const reg = classifyRegime({
      bars: { h: highs.slice(0, i + 1), l: lows.slice(0, i + 1), c: closes.slice(0, i + 1) },
      spot: c.c,
      vwap: sm,
      ema9: e9,
      ema21: e21,
      atr15: a,
      expiryWeekday: cfg.expiryWeekday,
      expiryCadence: cfg.expiryCadence,
      now: nowForRegime,
    });

    let dir: "BULL" | "BEAR" | null = null;
    if (reg.regime === "TRENDING_BULL" && r >= RSI_BULL[0] && r <= RSI_BULL[1]) dir = "BULL";
    else if (reg.regime === "TRENDING_BEAR" && r >= RSI_BEAR[0] && r <= RSI_BEAR[1]) dir = "BEAR";
    if (!dir) continue;

    const entrySpot = c.c;
    const stop = dir === "BULL" ? entrySpot - a : entrySpot + a;
    const target = dir === "BULL" ? entrySpot + 2 * a : entrySpot - 2 * a;
    // Modeled risk-based sizing: option loss-per-unit at stop ≈ |delta|·ATR.
    const perUnitRisk = ATM_DELTA * a;
    const lots = Math.max(
      1,
      Math.min(MAX_LOTS, Math.floor(riskAmount / (perUnitRisk * opts.lotSize)) || 1),
    );
    open = { dir, entryIdx: i, entrySpot, stop, target, atr: a, lots, regime: reg.regime };
  }

  // Any trade still open at the very end exits at the last bar (no overnight).
  if (open) closeTrade(open, candles.length - 1, "EOD_EXIT");

  return trades;

  // Helper that closes at an exact stop/target price (intrabar fill).
  function closeTradeAtPrice(o: Open, exitIdx: number, price: number, reason: string) {
    const sign = o.dir === "BULL" ? 1 : -1;
    const optionMovePerUnit = ATM_DELTA * sign * (price - o.entrySpot);
    const pnl = round2(optionMovePerUnit * opts.lotSize * o.lots);
    const strike = Math.round(o.entrySpot / cfg!.strikeStep) * cfg!.strikeStep;
    trades.push({
      id: `dir:${opts.indexSymbol}:${candles[o.entryIdx]!.t.toISOString()}`,
      indexSymbol: opts.indexSymbol,
      setupKey: "DIRECTIONAL_TREND",
      setupName: `Directional ${o.dir === "BULL" ? "trend-long (CALL)" : "trend-short (PUT)"}`,
      direction: o.dir === "BULL" ? "BULLISH" : "BEARISH",
      optionType: o.dir === "BULL" ? "CALL" : "PUT",
      strike,
      entryAt: candles[o.entryIdx]!.t.toISOString(),
      exitAt: candles[exitIdx]!.t.toISOString(),
      entrySpot: round2(o.entrySpot),
      exitSpot: round2(price),
      optionEntry: null,
      optionExit: null,
      optionStop: null,
      optionTarget1: null,
      optionTarget2: null,
      lots: o.lots,
      lotSize: opts.lotSize,
      qty: opts.lotSize * o.lots,
      pnl,
      exitReason: reason,
      confidence: null,
      tier: null,
      regime: o.regime,
      modeled: true,
      maxFavorableExcursion: null,
      maxAdverseExcursion: null,
    });
  }
}

export function buildDirectionalDataQuality(params: {
  coverage: BacktestCoverageWindow | null;
  tradeCount: number;
  missingInstruments: string[];
}): BacktestDataQualityOut {
  const warnings: string[] = [];
  if (params.missingInstruments.length > 0) {
    warnings.push(
      `Historical option data unavailable for: ${params.missingInstruments.join(", ")} — those instruments were skipped (no fabricated data).`,
    );
  }
  if (params.coverage && params.coverage.count > 0 && params.tradeCount === 0) {
    warnings.push("No directional trend setups qualified in this window.");
  }
  if (!params.coverage || params.coverage.count === 0) {
    warnings.push("Historical spot candles unavailable for the selection.");
  }

  return {
    mode: "DIRECTIONAL",
    candleCoverage: params.coverage,
    optionDataAvailable: false,
    ivAvailable: false,
    oiAvailable: false,
    snapshotCoverage: null,
    modeledFields: [
      "pnl (ATM delta proxy ≈ 0.5 on the real spot move)",
      "optionEntry / optionExit premiums (no historical option prices — left blank)",
      "VWAP input → equal-weighted session-mean substitute (index candles carry no volume)",
      "position sizing (risk-based, on modeled per-unit option risk)",
    ],
    warnings,
    notes: [
      "Entry/exit SPOTS, indicators (EMA/RSI/ATR/ADX) and the regime are 100% real, computed by the same pure libs as the live engine.",
      "Option P&L is a directional proxy only — it does NOT model IV crush, theta, gamma, or spread/slippage. Treat it as a directional-edge study, not a money-accurate option backtest.",
      "Intraday only: no positions are held overnight (exit at 15:20 IST or session close).",
    ],
  };
}
