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
import { centralKiteHistoricalByToken, centralIndexTokenMap, centralInstrumentToken } from "./marketData/compat";
import { fetchChart, fetchChartRaw, fetchFundamentals } from "./marketData/analyticsYahoo";
import { isFreshFor } from "./chartDatafeed";
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

/** Source tag for the per-symbol daily-bar fetch path that returned bars. */
export type SwingDailyBarSource = "kite" | "yahoo" | "none";

export interface SwingDailyBarsResult {
  /** OHLCV bars or null when both Kite and Yahoo failed. */
  bars: DailyBars | null;
  /** Which provider produced the bars (`"none"` when the fetch failed). */
  source: SwingDailyBarSource;
  /** Newest bar instant (epoch ms) or null — part of the uniform candle contract. */
  asOf: number | null;
  /** Whether the newest bar is within the daily (`1D`) freshness budget. */
  fresh: boolean;
}

/** Newest bar timestamp (epoch ms) of a daily-bar series, or null. */
function barsAsOfMs(bars: DailyBars): number | null {
  const t = bars.ts[bars.ts.length - 1];
  return typeof t === "number" && Number.isFinite(t) ? t : null;
}

/** Daily OHLCV for an NSE EQ symbol. Tries Kite via the throttled
 *  historical adapter first, Yahoo on miss. `daysBack ≥ 500` keeps the
 *  scoring module's 252-bar 52w window and 220-bar EMA seed safe.
 *  Returns the producing `source` so the deep-scan orchestrator can be
 *  HONEST about Kite-vs-Yahoo provenance (the fallback is explicit, never
 *  silent) — and never fabricates bars (null on a genuine miss). */
export async function fetchDailyBars(symbol: string, daysBack = 500): Promise<SwingDailyBarsResult> {
  const token = await centralInstrumentToken(symbol).catch(() => null);
  if (token) {
    const kite = await centralKiteHistoricalByToken(token, `swing:${symbol}`, "day", daysBack);
    if (kite && kite.close.length >= 220) {
      const bars = chartToBars(kite);
      const asOf = barsAsOfMs(bars);
      return { bars, source: "kite", asOf, fresh: isFreshFor(asOf == null ? null : asOf / 1000, "1D") };
    }
  }
  const range = daysBack > 365 ? "2y" : "1y";
  const yahoo = await fetchChart(symbol, range, "1d", "NS");
  if (!yahoo || yahoo.close.length < 220) {
    logger.debug({ symbol, kiteToken: token, yahooLen: yahoo?.close.length ?? 0 }, "swing-scan daily-bar fetch failed");
    return { bars: null, source: "none", asOf: null, fresh: false };
  }
  const bars = chartToBars(yahoo);
  const asOf = barsAsOfMs(bars);
  return { bars, source: "yahoo", asOf, fresh: isFreshFor(asOf == null ? null : asOf / 1000, "1D") };
}

/** Benchmark bars for relative strength: NIFTY 50 (^NSEI). 1 year is
 *  enough — RS lookbacks top out at 120 bars. Public Yahoo-only path
 *  retained for callers (and tests) that want the original behaviour;
 *  `fetchBenchmarkBarsResilient` below is the production entry point
 *  used by the deep-scan orchestrator (S3a, 2026-05-28). */
export async function fetchBenchmarkBars(daysBack = 365): Promise<DailyBars | null> {
  const range = daysBack > 365 ? "2y" : "1y";
  const yahoo = await fetchChartRaw("^NSEI", range, "1d");
  if (!yahoo || yahoo.close.length < 140) return null;
  return chartToBars(yahoo);
}

/* ───────────────── S3a: resilient benchmark loader ───────────────── */
/**
 * Minimum overlap window the swing RS formula needs to compute rs120
 * (largest of the three windows). Below this we treat the bars as
 * unusable — same threshold used by the legacy `fetchBenchmarkBars`.
 */
const BENCH_MIN_BARS = 140;

/**
 * Well-known NIFTY 50 instrument token. Kept here as a hard-coded
 * defense-in-depth fallback even though `getIndexTokenMap()` already
 * seeds the same value before attempting live revalidation. This way
 * the swing benchmark can resolve a token even if the Kite session is
 * not yet established (e.g. pre-06:00-IST first scan after a restart),
 * provided `fetchKiteHistoricalByToken` itself can still authenticate.
 */
const NIFTY50_INSTRUMENT_TOKEN = 256265;

/** Source tag for the benchmark fetch path that actually returned bars. */
export type SwingBenchmarkSource = "yahoo" | "yahoo_retry" | "kite" | "none";

export interface SwingBenchmarkResult {
  /** OHLCV bars or null when every fallback failed. */
  bars: DailyBars | null;
  /** Which path produced the bars (`"none"` when all failed). */
  source: SwingBenchmarkSource;
  /** Bar count (0 when none). */
  barCount: number;
  /** First bar's UTC ISO date (`YYYY-MM-DD`), or null. */
  firstDate: string | null;
  /** Last bar's UTC ISO date (`YYYY-MM-DD`), or null. */
  lastDate: string | null;
  /** Last-attempt error message per source we tried, ≤200 chars. */
  errors: { yahoo?: string; yahooRetry?: string; kite?: string };
  /** Wall-clock elapsed time across all attempts, ms. */
  durationMs: number;
}

/** Internal seam: production passes nothing; tests override Yahoo/Kite.
 *  Returns a ChartLike (the projection chartToBars consumes). */
export interface BenchmarkInjections {
  yahooFetch?: () => Promise<ChartLike | null>;
  kiteFetch?: () => Promise<ChartLike | null>;
  /** Sleep override for the inter-attempt backoff in tests. */
  sleepMs?: (ms: number) => Promise<void>;
}

function isoDate(tsMs: number | undefined): string | null {
  if (typeof tsMs !== "number" || !Number.isFinite(tsMs)) return null;
  return new Date(tsMs).toISOString().slice(0, 10);
}

function trimErr(s: string): string {
  return s.length > 200 ? s.slice(0, 200) : s;
}

async function defaultYahooFetch(daysBack: number) {
  const range = daysBack > 365 ? "2y" : "1y";
  return fetchChartRaw("^NSEI", range, "1d");
}

async function defaultKiteFetch(daysBack: number) {
  // Resolve the NIFTY 50 token via the shared resolver (uses live
  // instrument dump when a Kite session is up; falls back to the
  // hard-coded 256265 seed otherwise). Either way, the subsequent
  // historical-data call needs an authenticated session, so when
  // there is no session this layer still returns null and the
  // resilient loader records a `kite` error.
  let token: number | null = null;
  try {
    const map = await centralIndexTokenMap();
    if (map) token = map.get("^NSEI") ?? null;
  } catch {
    // Swallow — fall back to hard-coded token below.
  }
  if (!token || !Number.isFinite(token)) token = NIFTY50_INSTRUMENT_TOKEN;
  return centralKiteHistoricalByToken(token, "swing:^NSEI", "day", daysBack);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * S3a (2026-05-28) — resilient NIFTY 50 benchmark loader for the swing
 * scanner. Order:
 *   1. Yahoo `^NSEI` daily (existing path)
 *   2. Yahoo retry (one attempt, 750 ms backoff)
 *   3. Kite historical via NIFTY 50 instrument token (256265, live-
 *      revalidated by `getIndexTokenMap`)
 *   4. None — caller keeps existing neutral RS behaviour
 *
 * NEVER throws — every layer is wrapped, every error is recorded in
 * the returned `errors` map. Bars are validated against `BENCH_MIN_BARS`
 * before they are accepted from any source — a too-short response is
 * recorded as an error for that source and the next fallback runs.
 *
 * No change to the RS formula, no change to RS weights, no change to
 * any scoring/recommendation/entry/stop/target/RR path.
 */
export async function fetchBenchmarkBarsResilient(
  daysBack = 365,
  inj?: BenchmarkInjections,
): Promise<SwingBenchmarkResult> {
  const startedMs = Date.now();
  const errors: SwingBenchmarkResult["errors"] = {};
  const sleepFn = inj?.sleepMs ?? sleep;
  const yahooFn = inj?.yahooFetch ?? (() => defaultYahooFetch(daysBack));
  const kiteFn = inj?.kiteFetch ?? (() => defaultKiteFetch(daysBack));

  const tryAccept = (chart: ChartLike | null): DailyBars | null => {
    if (!chart) return null;
    if (!Array.isArray(chart.close) || chart.close.length < BENCH_MIN_BARS) return null;
    return chartToBars(chart);
  };

  const sampleDates = (bars: DailyBars): { first: string | null; last: string | null } => ({
    first: isoDate(bars.ts[0]),
    last: isoDate(bars.ts[bars.ts.length - 1]),
  });

  // ── Attempt 1: Yahoo (existing path) ─────────────────────────────
  try {
    const y1 = await yahooFn();
    const bars = tryAccept(y1);
    if (bars) {
      const { first, last } = sampleDates(bars);
      return { bars, source: "yahoo", barCount: bars.ts.length, firstDate: first, lastDate: last, errors, durationMs: Date.now() - startedMs };
    }
    if (y1) errors.yahoo = `insufficient_bars:${y1.close?.length ?? 0}`;
    else errors.yahoo = "null_response";
  } catch (e) {
    errors.yahoo = trimErr((e as Error).message ?? "yahoo_threw");
  }

  // ── Attempt 2: Yahoo retry with backoff ──────────────────────────
  try {
    await sleepFn(750);
    const y2 = await yahooFn();
    const bars = tryAccept(y2);
    if (bars) {
      const { first, last } = sampleDates(bars);
      return { bars, source: "yahoo_retry", barCount: bars.ts.length, firstDate: first, lastDate: last, errors, durationMs: Date.now() - startedMs };
    }
    if (y2) errors.yahooRetry = `insufficient_bars:${y2.close?.length ?? 0}`;
    else errors.yahooRetry = "null_response";
  } catch (e) {
    errors.yahooRetry = trimErr((e as Error).message ?? "yahoo_retry_threw");
  }

  // ── Attempt 3: Kite NIFTY 50 historical ──────────────────────────
  try {
    const k = await kiteFn();
    const bars = tryAccept(k);
    if (bars) {
      const { first, last } = sampleDates(bars);
      return { bars, source: "kite", barCount: bars.ts.length, firstDate: first, lastDate: last, errors, durationMs: Date.now() - startedMs };
    }
    if (k) errors.kite = `insufficient_bars:${k.close?.length ?? 0}`;
    else errors.kite = "null_response";
  } catch (e) {
    errors.kite = trimErr((e as Error).message ?? "kite_threw");
  }

  // ── All paths failed ─────────────────────────────────────────────
  logger.warn(
    { errors },
    "swing-scan benchmark: all sources failed; RS scores will be neutral",
  );
  return { bars: null, source: "none", barCount: 0, firstDate: null, lastDate: null, errors, durationMs: Date.now() - startedMs };
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
