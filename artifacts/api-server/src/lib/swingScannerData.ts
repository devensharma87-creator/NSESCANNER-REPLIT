/**
 * Swing-scanner data layer — Kite-first daily bars with Yahoo fallback,
 * plus a light Yahoo fundamentals projection.
 *
 * Why two paths for bars?
 *   Kite gives us properly adjusted EOD candles via the same throttle
 *   queue we already pay for OI back-fill (~2.5 req/s, capped queue).
 *   Yahoo `fetchChart` is a free fallback when (a) Kite has no session
 *   yet, (b) the instrument isn't in the EQ dump (rare for NIFTY 500),
 *   or (c) the Kite throttle queue is saturated. We never fabricate
 *   bars — both paths null-out and the caller skips the symbol.
 *
 * Why `fetchFundamentals` and NOT `fetchStatements`?
 *   The Python module's `fundamental_score` only consumes a handful of
 *   pre-aggregated ratios (P/E, P/B, ROE, D/E, margins, growth). The
 *   light `fetchFundamentals` helper already returns exactly those — at
 *   one quoteSummary call per symbol with ~4 modules. `fetchStatements`
 *   pulls 11 modules including history rows we throw away — too heavy
 *   to fan out across 500 symbols. The QoQ deltas stay NaN; the score
 *   gracefully degrades (those branches simply don't fire). When the
 *   owner needs QoQ they can drill into stock-detail which has the full
 *   statements view already.
 */
import type { DailyBars, FundamentalsSnapshot } from "./swingScanner";
import { EMPTY_FUNDAMENTALS, fundamentalScore, fundamentalStatusFromScore } from "./swingScanner";
import { fetchKiteHistoricalByToken } from "./kiteIntraday";
import { getInstrumentToken } from "./kiteFeed";
import { fetchChart, fetchChartRaw, fetchFundamentals } from "./yahoo";
import { logger } from "./logger";

interface ChartLike {
  timestamps: number[];
  open: number[]; high: number[]; low: number[]; close: number[]; volume: number[];
}

/** Project a YahooChart-shaped object (also returned by the Kite
 *  historical adapter) into the OHLCV view the scoring module needs.
 *  Filters incomplete rows. */
function chartToBars(chart: ChartLike): DailyBars {
  const ts: number[] = [];
  const open: number[] = []; const high: number[] = []; const low: number[] = [];
  const close: number[] = []; const volume: number[] = [];
  for (let i = 0; i < chart.timestamps.length; i++) {
    const o = chart.open[i], h = chart.high[i], l = chart.low[i], c = chart.close[i];
    if (![o, h, l, c].every(v => Number.isFinite(v) && (v as number) > 0)) continue;
    ts.push(chart.timestamps[i]! * 1000);
    open.push(o!); high.push(h!); low.push(l!); close.push(c!);
    volume.push(Number.isFinite(chart.volume[i]!) ? chart.volume[i]! : 0);
  }
  return { ts, open, high, low, close, volume };
}

/** Daily OHLCV for an NSE EQ symbol. Tries Kite via the throttled
 *  historical adapter first, Yahoo on miss. `daysBack ≥ 500` keeps the
 *  scoring module's 252-bar 52w window and 220-bar EMA seed safe. */
export async function fetchDailyBars(symbol: string, daysBack = 500): Promise<DailyBars | null> {
  const token = await getInstrumentToken(symbol).catch(() => null);
  if (token) {
    const kite = await fetchKiteHistoricalByToken(token, `swing:${symbol}`, "day", daysBack);
    if (kite && kite.close.length >= 220) return chartToBars(kite);
  }
  const range = daysBack > 365 ? "2y" : "1y";
  const yahoo = await fetchChart(symbol, range, "1d", "NS");
  if (!yahoo || yahoo.close.length < 220) {
    logger.debug({ symbol, kiteToken: token, yahooLen: yahoo?.close.length ?? 0 }, "swing-scan daily-bar fetch failed");
    return null;
  }
  return chartToBars(yahoo);
}

/** Benchmark bars for relative strength: NIFTY 50 (^NSEI). 1 year is
 *  enough — RS lookbacks top out at 120 bars. ^NSEI has no NSE-EQ
 *  instrument_token, so we skip Kite and go straight to Yahoo via the
 *  raw chart path (no `.NS` suffix appending). */
export async function fetchBenchmarkBars(daysBack = 365): Promise<DailyBars | null> {
  const range = daysBack > 365 ? "2y" : "1y";
  const yahoo = await fetchChartRaw("^NSEI", range, "1d");
  if (!yahoo || yahoo.close.length < 140) return null;
  return chartToBars(yahoo);
}

/* ─────────────────────── Fundamentals bridge ─────────────────────── */

/** In-process projection cache. The underlying `fetchFundamentals`
 *  already caches the raw Yahoo payload for 1h, but we cache the
 *  *projected* snapshot for 6h because re-projecting on every scan is
 *  pure CPU we don't need. The status field is computed from the
 *  scoring module so projection drift can't sneak in. */
const FUND_CACHE = new Map<string, { ts: number; snap: FundamentalsSnapshot }>();
const FUND_TTL_MS = 6 * 60 * 60 * 1000;

export async function fetchFundamentalsForSwing(symbol: string): Promise<FundamentalsSnapshot> {
  const cached = FUND_CACHE.get(symbol);
  if (cached && Date.now() - cached.ts < FUND_TTL_MS) return cached.snap;
  let snap: FundamentalsSnapshot;
  try {
    const f = await fetchFundamentals(symbol, "NS");
    if (!f) {
      snap = { ...EMPTY_FUNDAMENTALS, fundamentalStatus: "Unavailable", quarterlyComment: "Yahoo fundamentals unavailable" };
    } else {
      // Yahoo gives ROE/margins/growth as percentages already (e.g. 15.4
      // for 15.4%). The scoring module expects ratios (0.154). Divide
      // by 100 in the projection.
      snap = {
        trailingPe: numOrNaN(f.peRatio),
        priceToBook: numOrNaN(f.pbRatio),
        debtToEquity: numOrNaN(f.debtToEquity),
        roe: ratioFromPct(f.roe),
        roa: NaN,           // not in YahooFundamentals; the score branch is optional
        revenueGrowth: ratioFromPct(f.revenueGrowthYoy),
        earningsGrowth: ratioFromPct(f.earningsGrowthYoy),
        profitMargins: ratioFromPct(f.profitMargin),
        operatingMargins: ratioFromPct(f.operatingMargin),
        // Quarterly QoQ would need a separate (heavy) `fetchStatements`
        // call per symbol; deferred. The score's QoQ branches simply
        // don't fire when these are NaN.
        quarterlyRevenueGrowthPct: NaN,
        quarterlyNetIncomeGrowthPct: NaN,
        sector: "",         // sector/industry aren't on YahooFundamentals — UI hides empty cells
        industry: "",
        fundamentalStatus: "Unknown",
        quarterlyComment: "Quarterly comparison not loaded (use stock-detail page)",
      };
      const fs = fundamentalScore(snap);
      snap.fundamentalStatus = fundamentalStatusFromScore(fs.score);
    }
  } catch (err) {
    snap = { ...EMPTY_FUNDAMENTALS, fundamentalStatus: "Unavailable", quarterlyComment: `Fundamental fetch failed: ${(err as Error).message}` };
  }
  FUND_CACHE.set(symbol, { ts: Date.now(), snap });
  return snap;
}

function numOrNaN(v: unknown): number {
  if (v === null || v === undefined) return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function ratioFromPct(v: unknown): number {
  const n = numOrNaN(v);
  if (!Number.isFinite(n)) return NaN;
  // YahooFundamentals helpers already × 100 (e.g. roe = 15.4 for 15.4%);
  // anything with absolute value > 1 we treat as a percentage and
  // convert to a fraction. Defensive: a value of 0.18 stays 0.18.
  return Math.abs(n) > 1 ? n / 100 : n;
}
