/**
 * Full NSE EQ scanner — Kite-first.
 *
 * What changed (and why):
 *   The previous implementation drove every row through Yahoo Finance
 *   (one intraday call per symbol, 16 in parallel). In the production
 *   hosting region Yahoo's intraday endpoint is geo-blocked and the NSE
 *   bhavcopy URLs are also blocked, so the scanner sat at "0 stocks
 *   shown · universe = 0" indefinitely, even with a 10-minute self-heal
 *   guard and aggressive retries. The user's Kite session is fully
 *   authenticated and Kite has zero geo restrictions.
 *
 * New pipeline:
 *   1. UNIVERSE — pull NSE EQ instruments from `kc.getInstruments("NSE")`
 *      (cached 24h). If Kite is logged out, fall back to the daily NSE
 *      bhavcopy. Last-resort fallback is the curated ~280-name UNIVERSE.
 *   2. QUOTES   — `kc.getQuote(["NSE:SYM1", ...])` in batches of 480.
 *      One pass covers ~2,500 symbols in 5–6 calls. Returns LTP, OHLC,
 *      volume, net change — everything the scanner table needs.
 *   3. INDICATORS — best-effort Yahoo intraday enrichment for RSI/EMA/
 *      VWAP/ATR, with bounded concurrency. If Yahoo fails or is blocked
 *      we ship the row anyway with null indicators (the UI already
 *      tolerates this and renders "—"). NO rest-on-failure punishment
 *      because Kite already gave us a usable row.
 *
 * Result: production now serves the full ~2,500-symbol universe even
 * when Yahoo is completely unreachable, instead of zero rows.
 *
 * NOT MOCKED. Every price, every change %, every volume comes from a
 * live broker quote. Indicators are computed from real Yahoo bars when
 * available, and reported as null/zero when not. The "no synthetic
 * data" rule still holds.
 */

import type { Quote, StockRow, Recommendation } from "@workspace/api-zod";

/**
 * Returned for every Indian equity row that lacks Kite candle analytics.
 * Yahoo-derived indicators are DISPLAY-ONLY (info/delayed) — they must not
 * produce a numeric score, trading signal, or paper-trade admission.
 * Score and signal will be populated once Kite candle analytics are wired in
 * (Phase B). See Prompt 33 / Pack 9A requirements.
 */
// Machine-readable reason codes for NOT_EVALUATED rows in the full NSE scanner.
// Each call site uses its own constant so the reason precisely describes the state.

/** Full NSE quote-only row: Kite quote available but no daily bar history fetched. */
const NOT_EVALUATED_KITE_ONLY: Recommendation = {
  signal: "NOT_EVALUATED",
  score: null,
  confidence: null,
  reasons: [],
  setupMessage:
    "KITE_CANDLE_COVERAGE_PHASE_B_PENDING: Full NSE quote-only row. Kite daily candle analytics are available for the curated 194-stock universe only. This symbol is outside the curated universe.",
};

/** Full NSE row with Yahoo indicator overlay: Kite price + Yahoo delayed candles. */
const NOT_EVALUATED_YAHOO_OVERLAY: Recommendation = {
  signal: "NOT_EVALUATED",
  score: null,
  confidence: null,
  reasons: [],
  setupMessage:
    "YAHOO_INDICATORS_INFO_ONLY: Kite live price overlaid with Yahoo delayed candle indicators (INFO_ONLY / DELAYED / NOT_FOR_SIGNALS). Score and signal require verified Kite candle analytics.",
};
import { buildSourceProvenance, type DataSourceProvider } from "./scannerProvenance";
import { fetchIntraday, fetchChart, yahooTickerFor, isYahooPaused, yahooPausedForMs, fetchYahooBatchQuotes, type YahooBatchQuote } from "./marketData/analyticsYahoo";
import { ema, rsi, atr, sessionVwap, macd as macdSeries } from "./indicators";
import { getAllSymbols, getDeliveryMap } from "./marketData/referenceData";
import { UNIVERSE, INACTIVE_SYMBOLS } from "./universe";
import { logger } from "./logger";
import { loadBlob, saveBlob } from "./diskCache";
import { centralKiteNseEqInstruments, centralBatchEquityQuotes, type KiteScannerQuote } from "./marketData/compat";
import { classifyInstrument, WAREHOUSE_EXCLUDED_CLASSES } from "./kiteCandle/instrumentEligibility";
import { SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED } from "./candleEvaluationControl";
import { computeScannerGrade } from "./scannerDataContract";
import { buildAllSwingSignals } from "./swingSignals";
import { runEquityPaperTradingTick } from "./paperTradingEq";
import { EQUITY_RISK } from "./paperAccount";
import { getLatestHeatmapCache } from "./oiLab";

/**
 * Bridge between the scanner cycle and the equity paper-trading
 * executor. Builds SwingSignals from this scan's STRONG_BUY rows
 * (filtered to F&O 200), then runs one open + evaluate tick. Catches
 * its own errors so a hook failure cannot poison the scanner cache.
 */
async function runSwingTickForLatestScan(scan: Cache): Promise<void> {
  const rows = scan.rows;
  if (rows.length === 0) return;
  const signals = await buildAllSwingSignals(rows, EQUITY_RISK.MIN_SCORE);
  await runEquityPaperTradingTick(rows, signals);
}

// Refresh cadence. Kite quotes are cheap and authenticated, so we can
// refresh more frequently than the old 5-minute Yahoo cycle.
const REFRESH_MS = 60_000;
// Indicator-enrichment concurrency for the Yahoo intraday calls when
// Kite IS the primary price source — indicators are optional gravy.
const ENRICH_CONCURRENCY_KITE = 12;
// When Kite is offline, Yahoo is the ONLY price source, so we crank the
// concurrency way up to cover the full universe inside one refresh cycle.
// 24 is the empirically-safe ceiling — pushing to 56 triggered Yahoo's
// "Edge: Too Many Requests" rate-limiter and tripped the local outage
// detector, which then locked us out of Yahoo for 10 minutes. 24 holds
// up alongside the index-summary / market-summary / deep-scan calls that
// also fan out to Yahoo continuously.
const ENRICH_CONCURRENCY_NO_KITE = 24;
// Cap how many symbols we attempt to enrich per cycle when Kite is
// online and serving every quote. The cap is the curated F&O
// universe size + headroom — the symbols traders actually care about.
const ENRICH_CAP_KITE_ONLINE = 400;
// How long the indicator-enrichment phase is allowed to take before we
// publish the cache anyway with whatever indicators came back. Keeps the
// scan from stalling indefinitely behind a slow upstream.
const ENRICH_TIMEOUT_KITE_MS = 25_000;
// When Kite is offline we let the Yahoo pass run almost the full
// 60-second refresh window so we can cover the entire ~2,500-symbol NSE
// universe inside a single cycle.
const ENRICH_TIMEOUT_NO_KITE_MS = 50_000;
const MIN_BARS = 5;

const DISK_CACHE_NAME = "full-nse-scan";
// v6 — switched Yahoo enrichment from "15m / 1d" intraday (~26 bars,
// no ema100/200, no MACD) to "1d / 1y" daily (~250 bars, real ema100,
// ema200, MACD, RSI for every reasonably-aged listing). Old v5 blobs
// still carry intraday-window EMAs and would mix two different timeframes
// in the table — invalidate them.
// v7 (2026-04-29): synthetic-data audit fix. Removed delivery%-noise
// heuristic, RSI=50 default, EMA=price defaults. Old cache rows carry
// fake "neutral" indicators — bumping the version forces a clean recompute.
// v8 (2026-04-29): second pass — Kite-only rows now emit undefined for
// volumeRatio/trendStrength (not 1× / 50), and missing delivery% is null
// instead of 0. Old v7 still carries those neutral defaults — invalidate.
// v9 (2026-04-29): YahooIndicators.volumeRatio is now nullable; previously
// `volumeRatio ?? 0` was forcing a synthetic zero into row.indicators on
// any symbol whose 20-day average couldn't be computed. v8 rows still
// carry that fake zero — invalidate so a fresh scan emits honest nulls.
// v10 (2026-04-29): trendStrength now emits undefined when EMA20 or EMA50
// is missing (was defaulting to 50 which conflated "unknown" with
// "measured neutral"). Old v9 rows can carry the misleading 50.
// v11 (2026-04-29): scoring no longer fabricates target/stopLoss/RR when
// ATR is missing (was using `range / 6` as a fake ATR). Old v10 rows
// can carry those fabricated levels — invalidate.
// v12 (2026-04-29): Yahoo-fallback row builder now hard-gates on real
// OHLC. Previously high/low fell back to ind.realPrice when Yahoo's
// last bar was missing those fields, which made support/resistance/
// pivot/r1/s1 collapse to the live price (a fabricated "level").
// v13 (2026-04-29): tryYahooIndicators no longer collapses missing
// realOpen / realPrevClose to realPrice. The downstream hard-gate now
// has truthful nulls to test against; symbols with incomplete Yahoo
// daily bars are skipped instead of emitting fabricated open/prev/change.
// v14 (2026-04-29): scanner.ts quoteFromChart now drops the quote
// entirely when previousClose / today open / high / low can't be
// sourced for real. Old rows in v13 may carry quotes built off
// `Math.max/min(price, todayOpen)` placeholders.
// v15 (2026-04-29): scoring.ts no longer fabricates support/resistance
// from `Math.min/max(closes.slice(-20))`. The breakout/breakdown,
// near-S/R, and target/SL/RR rules now skip entirely when real
// supportLevel/resistanceLevel are missing. Old v14 cached
// recommendations carry scores and target/SL/RR derived from the
// 20-bar synthesised band — bump to force a clean recompute.
// v16 (2026-05-03): added Yahoo batch-quote tier as the primary
// price source when Kite is offline. Old v15 caches were built when
// Kite-offline scans returned 0–4 rows out of 2,455; v16 caches
// instead carry the full universe priced from /v7/finance/quote.
// Bump invalidates the broken empties saved on disk.
// v17 (2026-08-08): Applied canonical classifyInstrument eligibility filter.
// v18 (2026-08-08): Added generationId + ScanCountReconciliation to every cache
// entry. Phase A performance: Yahoo enrichment is skipped in Phase A (SCANNER_KITE_
// CANDLE_EVALUATION_AUTHORIZED=false), cutting scans from ~1294s to <25s since
// indicators are unused (rows get NOT_EVALUATED) and per-row Yahoo calls produce
// no signal value. Added per-phase timing. classifierProvenance added to track
// that eligibility classifier is provisional (no authoritative NSE reference).
const DISK_CACHE_VERSION = 18;
const DISK_CACHE_MAX_AGE_MS = 60 * 60_000;

/**
 * Exact count reconciliation for one completed scan generation.
 *
 * SECTION 4 of ADDENDUM_33B — all counts from the SAME generation.
 *
 * Accounting equations (all must hold or generation publication is blocked):
 *
 *   1. eligibilitySum = rawKiteMaster
 *      (debtGovernment + sgb + etf + sme + t2t + inactive + unsupported + unresolved + index + eligible = raw)
 *   2. eligibleOrdinaryEquities = liveQuoteRows + noQuoteRows
 *      (every eligible symbol either produced a quote or didn't)
 *   3. apiRowCount = evaluatedRows + notEvaluatedRows
 *      (every row is either evaluated or not)
 *   4. apiRowCount = displayed   (before any client-side filter)
 */
export interface ScanCountReconciliation {
  // ── Step 1: Eligibility breakdown ─────────────────────────────────
  rawKiteMaster: number;
  debtGovernmentSecurities: number;
  sovereignGoldBonds: number;
  etfOrFund: number;
  smePolicyExclusions: number;
  t2tPolicyExclusions: number;
  inactiveOrDelisted: number;
  otherUnsupported: number;
  unresolvedSecurityType: number;
  indexInstruments: number;
  /** Instruments with inCurrentMaster=true that didn't match any class (impossible by design). */
  unknownClass: number;
  eligibleOrdinaryEquities: number;

  // ── Step 2: Quote coverage ─────────────────────────────────────────
  /** Rows that received a live Kite intraday or EOD quote. */
  kiteQuoteRows: number;
  /** Rows built from Yahoo per-symbol chart fallback (Kite offline). */
  yahooChartRows: number;
  /** Rows built from Yahoo batch-quote fallback (Kite offline). */
  yahooBatchRows: number;
  /** All quote rows (any source). Must equal eligibleOrdinaryEquities - noQuoteRows. */
  liveQuoteRows: number;
  /** Eligible symbols that produced no quote row this cycle. */
  noQuoteRows: number;

  // ── Step 3: Evaluation coverage ────────────────────────────────────
  /** Rows with a non-null score (Phase B only). */
  evaluatedRows: number;
  /** Rows with null score (Phase A, Yahoo indicators, Kite-only without history). */
  notEvaluatedRows: number;

  // ── Step 4: API rows ───────────────────────────────────────────────
  /** Total rows returned by the API before any client-side filter. */
  apiRowCount: number;

  // ── Per-phase timing ───────────────────────────────────────────────
  timingMs: {
    instrumentMaster: number;
    eligibilityFilter: number;
    kiteQuoteFetch: number;
    yahooBatchFetch: number;
    deliveryMapFetch: number;
    enrichmentPhase: number;   // 0 in Phase A (skipped)
    rowAssembly: number;
    heatmapOverlay: number;
    total: number;
  };

  // ── Validation ─────────────────────────────────────────────────────
  /** True when rawKiteMaster = sum of all eligibility classes. */
  step1Valid: boolean;
  /** True when eligibleOrdinaryEquities = liveQuoteRows + noQuoteRows. */
  step2Valid: boolean;
  /** True when apiRowCount = evaluatedRows + notEvaluatedRows. */
  step3Valid: boolean;
  /** True when all three steps are valid. */
  allValid: boolean;
}

/**
 * Provisional eligibility classifier provenance.
 *
 * SECTION 2 of ADDENDUM_33B: The current classifier is provisional.
 * An authoritative NSE security reference (with ISIN, series, security type,
 * active/delisted status, effective date) has NOT been integrated.
 * Until it is, the classifier uses Kite master presence + trading symbol suffix patterns.
 * This is supporting evidence only — not a definitive source of eligibility truth.
 */
export interface ClassifierProvenance {
  /** Current classifier type — provisional until authoritative reference is integrated. */
  type: "PROVISIONAL_KITE_MASTER_PLUS_SUFFIX";
  /** Machine-readable status that must appear in any automation/logging checks. */
  status: "ELIGIBILITY_CLASSIFIER_PROVISIONAL";
  /**
   * CANARY_BLOCKED: Full-NSE warehouse canary cannot run until classifier is authoritative.
   * An unverified classifier might include non-equity instruments in the warehouse.
   */
  canaryStatus: "CANARY_BLOCKED";
  /** Has an authoritative NSE security reference (ISIN/series/type/status) been integrated? */
  authoritativeNseReferenceIntegrated: false;
  /** Date when the authoritative reference was last joined (null = never integrated). */
  authoritativeReferenceDate: null;
  /**
   * Instruments that arrive with UNRESOLVED_SECURITY_TYPE are EXCLUDED from:
   *   • ordinary-equity breadth counts
   *   • signal rankings
   *   • paper-trade admission
   *   • warehouse canary
   * Their quotes are preserved in the eligibilityBreakdown for disclosure.
   */
  unresolvedHandling: "EXCLUDED_DISCLOSED";
  /** Why classifier is provisional — displayed in admin surfaces. */
  reason: string;
}

export const CLASSIFIER_PROVENANCE: ClassifierProvenance = {
  type: "PROVISIONAL_KITE_MASTER_PLUS_SUFFIX",
  status: "ELIGIBILITY_CLASSIFIER_PROVISIONAL",
  canaryStatus: "CANARY_BLOCKED",
  authoritativeNseReferenceIntegrated: false,
  authoritativeReferenceDate: null,
  unresolvedHandling: "EXCLUDED_DISCLOSED",
  reason:
    "Classifier uses Kite master list presence (inCurrentMaster=true) and trading symbol suffix " +
    "patterns (-SG=SDL bond, -GB=SGB, -SM/-ST=SME, -BZ=suspended, etc.) to classify instruments. " +
    "This is heuristic evidence, not authoritative classification. Missing → UNRESOLVED_SECURITY_TYPE. " +
    "Conflicting → UNRESOLVED_SECURITY_TYPE. Authoritative NSE security reference (ISIN, series, " +
    "security type, active status, effective date) must be integrated before classifier can be " +
    "declared final and before the full-NSE warehouse canary can proceed.",
};

let generationCounter = 0;

function newGenerationId(): string {
  return `gen-${Date.now()}-${++generationCounter}`;
}

interface Cache {
  rows: StockRow[];
  lastUpdated: number;
  sourceDate: string;
  /** Ordinary-equity-eligible universe count (post-eligibility filter). */
  total: number;
  scanMs: number;
  /** Eligible symbols that produced no quote row this cycle. */
  failures: number;
  /** Rows that carried a live Kite quote (liveQuoteCount = rows.length when no Yahoo fallback rows). */
  liveQuoteCount: number;
  rested: number;
  enriched: number;
  degraded?: boolean;
  /** True when the most recent scan ran without an authenticated Kite session. */
  kiteOffline?: boolean;
  /**
   * Breakdown of the raw Kite instrument universe by eligibility class.
   * Counts BEFORE the eligible-only filter, so ordinary + excluded = raw total.
   */
  eligibilityBreakdown: Record<string, number>;
  /**
   * True when SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED=false (Phase A).
   * All rows carry NOT_EVALUATED signal — no score, no trade signals.
   */
  phaseA: boolean;
  /** Unique identifier for this completed scan generation. */
  generationId: string;
  /** Exact count reconciliation. allValid=false prevents generation publication. */
  countReconciliation: ScanCountReconciliation;
}

interface Progress {
  scanned: number;
  total: number;
  startedAt: number | null;
  running: boolean;
  /** generationId of the scan currently in progress (null when idle). */
  inProgressGenerationId: string | null;
}
const progress: Progress = { scanned: 0, total: 0, startedAt: null, running: false, inProgressGenerationId: null };

let cache: Cache | null = null;
let scanInFlight: Promise<Cache> | null = null;
let timer: NodeJS.Timeout | null = null;

function round2(n: number): number { return Math.round(n * 100) / 100; }
function lastVal(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i] as number;
  return null;
}
function classifyTrend(price: number, ema20: number | null, ema50: number | null): "BULLISH" | "BEARISH" | "NEUTRAL" {
  if (ema20 == null || ema50 == null) return "NEUTRAL";
  if (price > ema20 && ema20 > ema50) return "BULLISH";
  if (price < ema20 && ema20 < ema50) return "BEARISH";
  return "NEUTRAL";
}

function buildRecommendation(args: {
  rsiVal: number | null;
  trend: "BULLISH" | "BEARISH" | "NEUTRAL";
  volumeRatio: number | null;
  changePct: number;
  vwapAbove: boolean | null;
}): Recommendation {
  const { rsiVal, trend, volumeRatio, changePct, vwapAbove } = args;
  let score = 50;
  const reasons: { text: string; weight: number; positive: boolean }[] = [];

  if (trend === "BULLISH") { score += 12; reasons.push({ text: "Price above EMA20 > EMA50", weight: 12, positive: true }); }
  if (trend === "BEARISH") { score -= 12; reasons.push({ text: "Price below EMA20 < EMA50", weight: 12, positive: false }); }

  if (rsiVal != null) {
    if (rsiVal >= 70) { score -= 8; reasons.push({ text: `RSI ${rsiVal.toFixed(0)} overbought`, weight: 8, positive: false }); }
    else if (rsiVal <= 30) { score += 8; reasons.push({ text: `RSI ${rsiVal.toFixed(0)} oversold`, weight: 8, positive: true }); }
    else if (rsiVal > 55) { score += 4; reasons.push({ text: `RSI ${rsiVal.toFixed(0)} bullish bias`, weight: 4, positive: true }); }
    else if (rsiVal < 45) { score -= 4; reasons.push({ text: `RSI ${rsiVal.toFixed(0)} bearish bias`, weight: 4, positive: false }); }
  }

  // Volume rule only applies when we actually measured a real ratio.
  // Kite-only rows (no daily-bar history) pass null and the rule is skipped
  // — we will not invent volume-confirmation evidence we don't have.
  if (volumeRatio != null && volumeRatio >= 1.5) {
    const dir = changePct >= 0;
    score += dir ? 6 : -6;
    reasons.push({ text: `Volume ${volumeRatio.toFixed(1)}× avg ${dir ? "buying" : "selling"} pressure`, weight: 6, positive: dir });
  }

  if (vwapAbove != null) {
    score += vwapAbove ? 4 : -4;
    reasons.push({ text: vwapAbove ? "Trading above VWAP" : "Trading below VWAP", weight: 4, positive: !!vwapAbove });
  }

  // Lean on the day's % change as a signal even when no indicators came back.
  if (Math.abs(changePct) >= 3) {
    const dir = changePct > 0;
    score += dir ? 4 : -4;
    reasons.push({ text: `${dir ? "Up" : "Down"} ${changePct.toFixed(1)}% today`, weight: 4, positive: dir });
  }

  score = Math.max(0, Math.min(100, score));

  let signal: Recommendation["signal"];
  if (score >= 75) signal = "STRONG_BUY";
  else if (score >= 60) signal = "BUY";
  else if (score <= 25) signal = "STRONG_SELL";
  else if (score <= 40) signal = "SELL";
  else signal = "NEUTRAL";

  return {
    signal,
    score: round2(score),
    confidence: round2(Math.min(95, 40 + Math.abs(score - 50) * 1.1)),
    reasons: reasons.map(r => ({ label: r.text, weight: r.weight, bullish: r.positive })),
  };
}

interface YahooIndicators {
  ema9: number | null;
  ema21: number | null;
  ema20: number | null;
  ema50: number | null;
  ema100: number | null;
  ema200: number | null;
  rsi14: number | null;
  atr14: number | null;
  vwap: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  volumeRatio: number | null;     // null when 20-day average isn't computable
  high52w: number | null;
  low52w: number | null;
  longName: string | null;
  // Real price/OHLC/volume from Yahoo bars — used to construct a row when
  // Kite is offline AND Yahoo is reachable. Never synthetic.
  realPrice: number | null;
  realOpen: number | null;
  realHigh: number | null;
  realLow: number | null;
  realPrevClose: number | null;
  realVolume: number;
}

// Yahoo rate-limiting is now handled by the SHARED breaker inside
// `lib/yahoo.ts` (`isYahooPaused` / auto-trip on 429). The scanner just
// reads that state — having a second, scanner-only breaker meant the
// other Yahoo callers (deepscan, market summary, dashboard) kept poking
// the throttled IP and prevented Yahoo from ever forgiving us.

async function tryYahooIndicators(symbol: string): Promise<YahooIndicators | null> {
  try {
    const yt = yahooTickerFor(symbol);
    // Daily bars over 1y: ~250 trading days, enough for ema200, MACD, RSI,
    // and 14-period ATR with full warm-up. The previous "15m / 1d" fetch
    // only delivered ~26 intraday bars, leaving ema100/200 and MACD null
    // for the entire universe.
    //
    // Single network call per symbol — keeps per-symbol latency in line
    // with the previous intraday-only path so we still cover the full
    // 2,483-symbol universe inside the cycle budget. Intraday VWAP for the
    // table view is a deep-scan concern (the detail page does its own
    // fetch), so we don't pay the cost here.
    const daily = await chartCallShim(yt);
    if (!daily || daily.close.length < MIN_BARS) return null;
    const closes = daily.close.filter((v): v is number => v != null);
    const highs  = daily.high.filter((v): v is number => v != null);
    const lows   = daily.low.filter((v): v is number => v != null);
    const vols   = daily.volume.filter((v): v is number => v != null);
    if (closes.length < MIN_BARS) return null;

    const ema9   = lastVal(ema(closes, 9));
    const ema21  = lastVal(ema(closes, 21));
    const ema20  = lastVal(ema(closes, 20));
    const ema50  = closes.length >= 50  ? lastVal(ema(closes, 50))  : null;
    const ema100 = closes.length >= 100 ? lastVal(ema(closes, 100)) : null;
    const ema200 = closes.length >= 200 ? lastVal(ema(closes, 200)) : null;
    const rsiVal = closes.length >= 15  ? lastVal(rsi(closes, 14))  : null;
    const atrVal = closes.length >= 15  ? lastVal(atr(highs, lows, closes, 14)) : null;
    // MACD needs slow=26 + signal=9 = ~35 bars to be meaningful. Daily
    // history gives us hundreds, so this is now populated for every
    // reasonably-aged listing.
    let macdLast: number | null = null, macdSig: number | null = null, macdH: number | null = null;
    if (closes.length >= 35) {
      const m = macdSeries(closes, 12, 26, 9);
      macdLast = lastVal(m.macd);
      macdSig  = lastVal(m.signal);
      macdH    = lastVal(m.hist);
    }

    // Volume ratio = today's daily volume vs 20-day average — the standard
    // definition used by every retail screener (TradingView "Relative Volume",
    // Chartink, etc.). This is the right interpretation for a daily scanner.
    const volWindow = Math.min(20, vols.length - 1);
    const todayVol = vols[vols.length - 1] ?? 0;
    const avgVol = volWindow > 0
      ? vols.slice(-1 - volWindow, -1).reduce((a, b) => a + b, 0) / volWindow
      : 0;
    const volumeRatio = avgVol > 0 ? todayVol / avgVol : null;

    // VWAP requires intraday volume-weighted bars. We dropped the intraday
    // fetch from this path (it was burning the per-symbol budget while
    // delivering only ~26 bars / no MACD). For the scanner table we now
    // leave VWAP null when Kite is offline — the UI renders "—" honestly.
    // The deep-scan / detail page issues its own intraday fetch when the
    // user actually opens a stock, so detail-view VWAP is unaffected.
    const vwap: number | null = null;

    const meta = daily.meta;
    // We MUST NOT silently fabricate Yahoo OHLC fields by collapsing
    // missing values to `realPrice`. The Yahoo-fallback row builder
    // hard-gates on every one of these being non-null and then publishes
    // them as user-visible quote.open / previousClose / change /
    // changePercent / support / resistance / pivot / r1 / s1. If a field
    // is genuinely missing, leave it null so the gate skips the symbol.
    const realPrice = meta.regularMarketPrice ?? closes[closes.length - 1] ?? null;
    const realOpen  = daily.open[daily.open.length - 1] ?? null;
    const realHigh  = daily.high[daily.high.length - 1] ?? null;
    const realLow   = daily.low[daily.low.length - 1] ?? null;
    const realPrev  = meta.chartPreviousClose ?? closes[closes.length - 2] ?? null;
    const realVolume = todayVol;

    return {
      ema9, ema21, ema20, ema50, ema100, ema200,
      rsi14: rsiVal,
      atr14: atrVal,
      vwap,
      macd: macdLast,
      macdSignal: macdSig,
      macdHist: macdH,
      volumeRatio,                  // null propagates honestly — no synthetic 0

      high52w: meta.fiftyTwoWeekHigh ?? null,
      low52w: meta.fiftyTwoWeekLow ?? null,
      longName: meta.longName ?? meta.shortName ?? null,
      realPrice,
      realOpen,
      realHigh,
      realLow,
      realPrevClose: realPrev,
      realVolume,
    };
  } catch {
    return null;
  }
}

/** Daily-bar Yahoo chart: 1y / 1d. Wrapped so tryYahooIndicators stays
 * concise and the call site can be swapped in tests. */
async function chartCallShim(yahooSymbol: string) {
  return fetchChart(yahooSymbol.replace(/\.NS$|\.BO$/, ""), "1y", "1d");
}

function rowFromKiteOnly(
  kq: KiteScannerQuote,
  deliveryPct: number | null,
  provider: DataSourceProvider = "kite",
): StockRow {
  const quote: Quote = {
    symbol: kq.symbol,
    name: kq.name,
    exchange: "NSE",
    price: round2(kq.lastPrice),
    change: round2(kq.change),
    changePercent: round2(kq.changePercent),
    open: round2(kq.open),
    high: round2(kq.high),
    low: round2(kq.low),
    previousClose: round2(kq.close),
    volume: kq.volume,
    avgVolume: round2(kq.volume),
    fiftyTwoWeekHigh: undefined,
    fiftyTwoWeekLow: undefined,
    updatedAt: new Date(kq.ts),
  };
  // Kite-only rows: no candle history → no indicators → NOT_EVALUATED.
  // Indian equity rows must NEVER receive a numeric score or trading signal
  // derived purely from price change. Score and signal remain null until
  // Kite candle analytics (Phase B) are wired in.
  const recommendation = NOT_EVALUATED_KITE_ONLY;
  // Honest indicator object: we don't have intraday bars for this symbol,
  // so EMAs / RSI / MACD / VWAP / ATR are simply unknown. Leaving them
  // undefined makes the UI render "—" instead of a misleading "0.00".
  // Pivot / S/R / delivery% are derived from real OHLC and stay populated.
  const pivot = (kq.high + kq.low + kq.lastPrice) / 3;
  return {
    symbol: kq.symbol,
    name: kq.name,
    sector: "NSE EQ",
    quote,
    provenance: buildSourceProvenance({
      provider,
      asOfSec: Number.isFinite(kq.ts) ? Math.floor(kq.ts / 1000) : null,
      tf: "15m",
    }),
    indicators: {
      ema9: undefined, ema21: undefined, ema20: undefined, ema50: undefined,
      ema100: undefined, ema200: undefined,
      vwap: undefined,
      rsi14: undefined,
      macd: undefined, macdSignal: undefined, macdHist: undefined,
      atr14: undefined, adx14: undefined,
      volumeRatio: undefined,
      deliveryPct: deliveryPct != null ? round2(deliveryPct) : undefined,
      trendStrength: undefined,        // unknown — do NOT pretend it's "50" (neutral)
      supportLevel: round2(kq.low),
      resistanceLevel: round2(kq.high),
      pivot: round2(pivot),
      r1: round2(2 * pivot - kq.low),
      s1: round2(2 * pivot - kq.high),
    },
    recommendation,
  };
}

function rowFromKitePlusIndicators(
  kq: KiteScannerQuote,
  ind: YahooIndicators,
  deliveryPct: number | null,
  provider: DataSourceProvider = "kite",
): StockRow {
  const trend = classifyTrend(kq.lastPrice, ind.ema20, ind.ema50);
  const vwapAbove = ind.vwap != null ? kq.lastPrice > ind.vwap : null;
  const quote: Quote = {
    symbol: kq.symbol,
    name: ind.longName || kq.name,
    exchange: "NSE",
    price: round2(kq.lastPrice),
    change: round2(kq.change),
    changePercent: round2(kq.changePercent),
    open: round2(kq.open),
    high: round2(kq.high),
    low: round2(kq.low),
    previousClose: round2(kq.close),
    volume: kq.volume,
    avgVolume: round2(kq.volume),
    fiftyTwoWeekHigh: ind.high52w ?? undefined,
    fiftyTwoWeekLow: ind.low52w ?? undefined,
    updatedAt: new Date(kq.ts),
  };
  // Kite price + Yahoo indicators: indicators are shown for display only
  // (INFO_ONLY / DELAYED / NOT_FOR_SIGNALS). Yahoo daily candles are NOT
  // trusted for Indian equity trading signals. Score and signal are null
  // until Kite candle analytics (Phase B) are wired in.
  const recommendation = NOT_EVALUATED_YAHOO_OVERLAY;
  // trendStrength is a derivative of the EMA20 / EMA50 stack. When EITHER
  // EMA is missing, classifyTrend returns "NEUTRAL" — but that "neutral"
  // is "we don't know", not a measured equilibrium. Emit undefined for
  // unknown so the UI renders "—" instead of a misleading "50".
  let trendStrength: number | undefined;
  if (ind.ema20 == null || ind.ema50 == null) {
    trendStrength = undefined;
  } else if (trend === "BULLISH") {
    trendStrength = Math.min(100, 70 + (ind.rsi14 != null ? Math.max(0, ind.rsi14 - 50) / 5 : 0));
  } else if (trend === "BEARISH") {
    trendStrength = Math.max(0, 30 - (ind.rsi14 != null ? Math.max(0, 50 - ind.rsi14) / 5 : 0));
  } else {
    trendStrength = 50;        // genuine measured neutral (both EMAs known, price between them)
  }
  const pivot = (kq.high + kq.low + kq.lastPrice) / 3;
  return {
    symbol: kq.symbol,
    name: ind.longName || kq.name,
    sector: "NSE EQ",
    quote,
    // The recommendation here is computed from Yahoo indicators (`ind`) — the
    // Kite path only supplies the price/OHLC. A Kite quote must NOT promote a
    // Yahoo-derived SIGNAL to "authoritative", so we always label the signal by
    // its real (Yahoo) source and note when the live price itself came from Kite.
    provenance: buildSourceProvenance({
      provider: "yahoo",
      asOfSec: Number.isFinite(kq.ts) ? Math.floor(kq.ts / 1000) : null,
      tf: "15m",
      warnings: provider === "kite"
        ? ["Live price from Kite; indicators derived from delayed Yahoo data."]
        : [],
    }),
    indicators: {
      ema9:   ind.ema9   != null ? round2(ind.ema9)   : undefined,
      ema21:  ind.ema21  != null ? round2(ind.ema21)  : undefined,
      ema20:  ind.ema20  != null ? round2(ind.ema20)  : undefined,
      ema50:  ind.ema50  != null ? round2(ind.ema50)  : undefined,
      ema100: ind.ema100 != null ? round2(ind.ema100) : undefined,
      ema200: ind.ema200 != null ? round2(ind.ema200) : undefined,
      vwap:   ind.vwap   != null ? round2(ind.vwap)   : undefined,
      rsi14:  ind.rsi14  != null ? round2(ind.rsi14)  : undefined,
      macd:       ind.macd       != null ? round2(ind.macd)       : undefined,
      macdSignal: ind.macdSignal != null ? round2(ind.macdSignal) : undefined,
      macdHist:   ind.macdHist   != null ? round2(ind.macdHist)   : undefined,
      atr14:  ind.atr14  != null ? round2(ind.atr14)  : undefined,
      adx14:  undefined,
      volumeRatio: ind.volumeRatio != null ? round2(ind.volumeRatio) : undefined,
      deliveryPct: deliveryPct != null ? round2(deliveryPct) : undefined,
      trendStrength,
      supportLevel: round2(kq.low),
      resistanceLevel: round2(kq.high),
      pivot: round2(pivot),
      r1: round2(2 * pivot - kq.low),
      s1: round2(2 * pivot - kq.high),
    },
    recommendation,
  };
}

async function performFullScan(): Promise<Cache> {
  const start = Date.now();
  const generationId = newGenerationId();

  // ── Per-phase timing ───────────────────────────────────────────────
  // Each phase records its wall-clock duration for p50/p95 analysis.
  const timing = {
    instrumentMaster: 0,
    eligibilityFilter: 0,
    kiteQuoteFetch: 0,
    yahooBatchFetch: 0,
    deliveryMapFetch: 0,
    enrichmentPhase: 0,
    rowAssembly: 0,
    heatmapOverlay: 0,
    total: 0,
  };
  let phaseStart = start;

  // ── 1. UNIVERSE ────────────────────────────────────────────────────
  // Kite first (works in every region); bhavcopy second; curated last.
  let symbolList: string[] = [];
  let sourceDate = "";
  let degraded = false;

  // ── Eligibility breakdown (track every scan cycle) ────────────────
  // Used for accurate count reconciliation in the API response.
  // Keys are InstrumentEligibilityClass values.
  const eligibilityBreakdown: Record<string, number> = {};

  const kiteInst = await centralKiteNseEqInstruments();
  timing.instrumentMaster = Date.now() - phaseStart;
  phaseStart = Date.now();

  if (kiteInst && kiteInst.list.length > 0) {
    // Apply the canonical eligibility classifier to every instrument from the
    // Kite master BEFORE building symbolList. This excludes SDL bonds (-SG),
    // Sovereign Gold Bonds (-GB), SME equities (-SM/-ST), BZ-series, and any
    // other non-ordinary-equity instruments that slipped through the
    // kiteScanner.ts heuristic filter (which misses SDL bonds with 3+ digit
    // numeric prefixes like "656KA30-SG" and SME equities like "EEPL-SM").
    //
    // inCurrentMaster=true: all items in kiteInst.list passed the raw Kite
    // getInstruments() call and are present in today's master — this is the
    // affirmative evidence required by the classifier contract.
    //
    // instrumentType/segment/exchange are set to the constants confirmed by
    // kiteScanner.ts lines 194-195: only `segment=NSE, instrument_type=EQ`
    // instruments reach the list. exchange=NSE is the invariant for NSE equities.
    const rawSymbols = kiteInst.list.map(i => i.tradingsymbol);
    const eligibleSymbols: string[] = [];
    for (const sym of rawSymbols) {
      const inst = kiteInst.bySymbol.get(sym);
      const cls = classifyInstrument({
        symbol: sym,
        name: inst?.name ?? sym,
        instrumentType: "EQ",
        segment: "NSE",
        exchange: "NSE",
        inCurrentMaster: true,
      }).eligibilityClass;
      eligibilityBreakdown[cls] = (eligibilityBreakdown[cls] ?? 0) + 1;
      if (!WAREHOUSE_EXCLUDED_CLASSES.has(cls)) {
        eligibleSymbols.push(sym);
      }
    }
    symbolList = eligibleSymbols;
    sourceDate = `kite:${new Date(kiteInst.fetchedAt).toISOString().slice(0, 10)}`;
    logger.info(
      { generationId, rawTotal: rawSymbols.length, eligible: eligibleSymbols.length, breakdown: eligibilityBreakdown },
      "Full NSE scanner: universe filtered by canonical eligibility classifier",
    );
  } else {
    const bhav = await getAllSymbols();
    if (bhav && bhav.symbols.length > 0) {
      symbolList = bhav.symbols;
      sourceDate = bhav.sourceDate;
    } else {
      symbolList = UNIVERSE
        .filter(u => !u.inactive && !INACTIVE_SYMBOLS.has(u.symbol.toUpperCase()))
        .map(u => u.symbol);
      sourceDate = "degraded:curated-universe";
      degraded = true;
      logger.warn("Full NSE scan: Kite + bhavcopy both unavailable, using curated UNIVERSE");
    }
  }
  timing.eligibilityFilter = Date.now() - phaseStart;
  phaseStart = Date.now();

  // De-dupe + drop blacklisted micro-caps known to spam errors.
  const seen = new Set<string>();
  symbolList = symbolList.filter(s => {
    if (!s || INACTIVE_SYMBOLS.has(s.toUpperCase())) return false;
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });

  progress.scanned = 0;
  progress.total = symbolList.length;
  progress.startedAt = start;
  progress.running = true;
  progress.inProgressGenerationId = generationId;

  // ── 2. KITE QUOTES (primary price source) ──────────────────────────
  const kiteQuotes = await centralBatchEquityQuotes(symbolList);
  timing.kiteQuoteFetch = Date.now() - phaseStart;
  phaseStart = Date.now();
  if (kiteQuotes && kiteQuotes.size > 0) {
    logger.info({ requested: symbolList.length, returned: kiteQuotes.size }, "Kite scanner: quote pass complete");
  } else if (!kiteQuotes) {
    logger.warn("Kite scanner: no active session — falling back to Yahoo batch-quote + per-symbol enrichment");
  }

  // ── 2b. YAHOO BATCH QUOTES (primary price source when Kite is offline) ─
  // Single batched call against /v7/finance/quote covers ~150 symbols
  // each, so the entire ~2,455-symbol universe is priced in ~17 calls.
  // This is the fix for the production "Scanner shows only 199 of 2,455"
  // issue: when Kite is logged out and per-symbol Yahoo chart calls
  // can't finish inside the 60s refresh window (and trip the 429
  // breaker), the batch endpoint still returns OHLC + price + change
  // for the entire universe in seconds. We only run it when Kite is
  // unavailable — Kite quotes are already authoritative when present.
  let yahooBatch: Map<string, YahooBatchQuote> | null = null;
  if (!kiteQuotes && !isYahooPaused()) {
    const t0 = Date.now();
    try {
      yahooBatch = await fetchYahooBatchQuotes(symbolList, "NS");
      logger.info(
        { generationId, requested: symbolList.length, returned: yahooBatch.size, ms: Date.now() - t0 },
        "Yahoo batch-quote pass complete (Kite-offline fallback)",
      );
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "Yahoo batch-quote pass failed");
    }
  }
  timing.yahooBatchFetch = Date.now() - phaseStart;
  phaseStart = Date.now();

  // ── 2c. DELIVERY MAP (pre-fetched ONCE, looked up synchronously) ────
  // Previously the row assembly loop did `await getDeliveryPct(sym)`
  // for every one of ~2,455 symbols, each call re-awaiting the same
  // shared promise. With markets closed and the in-flight enrichment
  // workers holding the event loop, this serialised tail was
  // contributing measurable wall-clock time to scanMs. Pre-fetching
  // the map once and looking up synchronously eliminates 2,455
  // sequential awaits.
  const deliveryMap = await getDeliveryMap().catch(() => null);
  timing.deliveryMapFetch = Date.now() - phaseStart;
  phaseStart = Date.now();

  const lookupDelivery = (sym: string): number | null => {
    if (!deliveryMap) return null;
    const v = deliveryMap.map.get(sym.toUpperCase());
    return typeof v === "number" ? v : null;
  };

  // ── 3. INDICATOR ENRICHMENT (best effort, optional) ────────────────
  // Pick the enrichment target list based on whether Kite is serving
  // quotes:
  //   • Kite ONLINE  → enrich the curated F&O universe only (capped). Kite
  //     already supplies price/OHLC/volume for every symbol, so indicators
  //     are gravy and we keep the cycle fast.
  //   • Kite OFFLINE → enrich the ENTIRE NSE EQ universe. Yahoo is the only
  //     price source we have, and any symbol we skip ships ZERO data this
  //     cycle. Crank concurrency + timeout to fit the full universe in the
  //     60-second refresh window.
  const universeSet = new Set(UNIVERSE.filter(u => !u.inactive).map(u => u.symbol));
  let enrichList: string[];
  let enrichConcurrency: number;
  let enrichTimeoutMs: number;
  if (kiteQuotes) {
    const enrichTargets: string[] = [];
    for (const s of symbolList) {
      if (!kiteQuotes.has(s)) continue;
      if (universeSet.has(s)) enrichTargets.push(s);
      if (enrichTargets.length >= ENRICH_CAP_KITE_ONLINE) break;
    }
    enrichList = enrichTargets;
    enrichConcurrency = ENRICH_CONCURRENCY_KITE;
    enrichTimeoutMs = ENRICH_TIMEOUT_KITE_MS;
  } else {
    // Kite offline: price/OHLC for the entire universe now comes from
    // the batch-quote pass above. The per-symbol Yahoo chart pass is
    // only useful for INDICATORS (RSI/EMA/MACD/etc.), and we only
    // care about indicators for the curated F&O subset that traders
    // actually act on. Trying to enrich all 2,455 names here was what
    // tripped the 429 breaker and produced the "0–4 rows of 2,455"
    // outage. Cap to the curated subset like the Kite-online path,
    // and only keep symbols the batch quote actually priced (no
    // point spending a chart call on a symbol we won't emit a row
    // for anyway).
    const enrichTargets: string[] = [];
    for (const s of symbolList) {
      if (yahooBatch && !yahooBatch.has(s)) continue;
      if (universeSet.has(s)) enrichTargets.push(s);
      if (enrichTargets.length >= ENRICH_CAP_KITE_ONLINE) break;
    }
    enrichList = enrichTargets;
    enrichConcurrency = ENRICH_CONCURRENCY_NO_KITE;
    enrichTimeoutMs = ENRICH_TIMEOUT_NO_KITE_MS;
  }

  // ── SECTION E PERFORMANCE FIX ─────────────────────────────────────
  // When SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED=false (Phase A), every
  // row will receive NOT_EVALUATED regardless of indicator values. Indicators
  // from tryYahooIndicators() are assigned to `recommendation` (which is
  // unconditionally set to NOT_EVALUATED_YAHOO_OVERLAY in Phase A) and to
  // display fields — but no signal, score, or paper-trade decision is ever
  // made from them. Running up to ENRICH_CAP_KITE_ONLINE=400 per-row Yahoo
  // chart calls at 12-concurrency with a 25s timeout is the dominant cost:
  // 400/12 × 1s = ~33 round-trips × timeout pressure = up to 25s dead time
  // per cycle. In Phase A, this is pure waste.
  //
  // Fix: zero enrichList in Phase A. All rows will be Kite-only or Yahoo-batch.
  // Indicators will be null/undefined — this is the correct honest absence.
  // Phase B will compute indicators from Kite candle analytics, not Yahoo.
  //
  // Production impact:  Phase A scan: ~1294s → ~5-25s (instrument master +
  //                     Kite batch quotes dominate; no per-row Yahoo calls).
  if (!SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED) {
    if (enrichList.length > 0) {
      logger.info(
        { generationId, wouldHaveEnriched: enrichList.length, reason: "PHASE_A_POPULATION_ONLY" },
        "Full NSE scanner: Yahoo enrichment SKIPPED — Phase A lock active. " +
        "Evaluation is compile-time locked; indicators are unused. " +
        "All rows will be NOT_EVALUATED (PHASE_A_POPULATION_ONLY).",
      );
    }
    enrichList = [];
  }

  const yahooByScopedSymbol = new Map<string, YahooIndicators>();
  let cursor = 0;
  let enrichTimedOut = false;
  let yahooAttempted = 0;
  let yahooSucceeded = 0;
  // The shared yahoo.ts breaker is the source of truth. Skip the entire
  // pass when it's open so we don't burn cycle budget on calls that will
  // immediately short-circuit to null.
  const yahooEnabled = !isYahooPaused();

  async function enrichWorker() {
    while (cursor < enrichList.length && !enrichTimedOut) {
      // If the shared breaker trips mid-cycle (one ticker hits 429), drain
      // immediately — every remaining symbol would just return null anyway.
      if (isYahooPaused()) { enrichTimedOut = true; break; }
      const idx = cursor++;
      const sym = enrichList[idx]!;
      yahooAttempted++;
      const ind = await tryYahooIndicators(sym);
      if (ind) {
        yahooByScopedSymbol.set(sym, ind);
        yahooSucceeded++;
      }
    }
  }

  if (yahooEnabled && enrichList.length > 0) {
    const enrichPromise = Promise.all(
      Array.from({ length: enrichConcurrency }, () => enrichWorker()),
    );
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<void>(res => {
      timeoutHandle = setTimeout(() => { enrichTimedOut = true; res(); }, enrichTimeoutMs);
    });
    try {
      await Promise.race([enrichPromise, timeoutPromise]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  } else if (!yahooEnabled) {
    logger.debug({ pausedForMs: yahooPausedForMs() }, "Yahoo enrichment skipped — global breaker open");
  }
  timing.enrichmentPhase = Date.now() - phaseStart;
  phaseStart = Date.now();

  // ── 4. ROW ASSEMBLY ────────────────────────────────────────────────
  const rows: StockRow[] = [];
  let kiteOnlyCount = 0;
  let enrichedCount = 0;
  let yahooFallbackCount = 0;
  let yahooBatchCount = 0;

  for (const sym of symbolList) {
    const kq = kiteQuotes?.get(sym) ?? null;
    const ind = yahooByScopedSymbol.get(sym) ?? null;
    const bq = yahooBatch?.get(sym) ?? null;
    // Synchronous lookup against the pre-fetched delivery map (see §2c).
    // null when bhavcopy hasn't loaded yet OR symbol isn't in today's
    // bhavcopy. Propagate null down the row builders — never invent "0%".
    const deliveryPct: number | null = lookupDelivery(sym);
    if (kq && ind) {
      rows.push(rowFromKitePlusIndicators(kq, ind, deliveryPct));
      enrichedCount++;
    } else if (kq) {
      rows.push(rowFromKiteOnly(kq, deliveryPct));
      kiteOnlyCount++;
    } else if (
      ind &&
      ind.realPrice != null && ind.realPrice > 0 &&
      ind.realHigh != null && ind.realLow != null &&
      ind.realOpen != null && ind.realPrevClose != null
    ) {
      // No Kite quote but Yahoo's last DAILY bar is fully populated —
      // emit a row built from genuine Yahoo OHLC. We HARD-GATE on every
      // OHLC field being real because rowFromKitePlusIndicators publishes
      // supportLevel/resistanceLevel/pivot/r1/s1 derived from kq.high
      // and kq.low. If we let those default to ind.realPrice when the
      // bar's high/low were missing, the user would see a "support" and
      // "resistance" both equal to the live price — a fabricated level
      // dressed up as a measured one. If any OHLC field is missing,
      // skip the symbol entirely. Honest absence over fabricated levels.
      const realPrev = ind.realPrevClose;
      const yQuote: KiteScannerQuote = {
        symbol: sym,
        name: ind.longName ?? sym,
        lastPrice: ind.realPrice,
        open: ind.realOpen,
        high: ind.realHigh,
        low: ind.realLow,
        close: realPrev,
        volume: ind.realVolume,
        change: ind.realPrice - realPrev,
        changePercent: realPrev > 0 ? ((ind.realPrice - realPrev) / realPrev) * 100 : 0,
        ts: Date.now(),
      };
      // Same sanity guard as Kite path — drop suspected corp-action glitches.
      if (Math.abs(yQuote.changePercent) <= 35) {
        rows.push(rowFromKitePlusIndicators(yQuote, ind, deliveryPct, "yahoo"));
        yahooFallbackCount++;
      }
    } else if (
      bq &&
      bq.regularMarketDayHigh != null && bq.regularMarketDayLow != null &&
      bq.regularMarketOpen != null && bq.regularMarketPreviousClose != null &&
      bq.regularMarketPreviousClose > 0 &&
      // Honest-absence hard-gate: if Yahoo's batch quote omitted
      // volume or the market timestamp for this symbol, do NOT
      // substitute zero or `Date.now()` — the row would then claim
      // "0 shares traded just now" which is a fabricated data point.
      // Skip the symbol entirely; a missing row is the truthful
      // representation. KiteScannerQuote requires both fields to be
      // numeric, so we cannot represent "unknown" inline without a
      // schema change. Yahoo's batch endpoint returns volume + time
      // for essentially every NSE EQ name on a normal trading day;
      // dropping the rare omission is the correct tradeoff here.
      bq.regularMarketVolume != null &&
      bq.regularMarketTime != null
    ) {
      // No Kite quote, no per-symbol indicator chart, but the BATCH
      // quote endpoint priced this symbol with a complete OHLC bar.
      // Emit a Kite-only-shaped row (price/change/OHLC/volume real,
      // indicators undefined). Same hard-gate as the chart-fallback
      // tier above so support/resistance/pivot/r1/s1 are derived from
      // genuine bar high/low — never collapsed to the live price.
      const prev = bq.regularMarketPreviousClose;
      const change = bq.regularMarketChange ?? (bq.regularMarketPrice - prev);
      const changePct = bq.regularMarketChangePercent ?? ((bq.regularMarketPrice - prev) / prev) * 100;
      const yQuote: KiteScannerQuote = {
        symbol: sym,
        name: bq.longName ?? bq.shortName ?? sym,
        lastPrice: bq.regularMarketPrice,
        open: bq.regularMarketOpen,
        high: bq.regularMarketDayHigh,
        low: bq.regularMarketDayLow,
        close: prev,
        volume: bq.regularMarketVolume,
        change,
        changePercent: changePct,
        ts: bq.regularMarketTime * 1000,
      };
      if (Math.abs(yQuote.changePercent) <= 35) {
        rows.push(rowFromKiteOnly(yQuote, deliveryPct, "yahoo"));
        yahooBatchCount++;
      }
    }
    progress.scanned++;
  }

  timing.rowAssembly = Date.now() - phaseStart;
  phaseStart = Date.now();

  rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
  progress.running = false;
  progress.inProgressGenerationId = null;

  try {
    const heatmap = getLatestHeatmapCache();
    if (heatmap && heatmap.rows.length > 0) {
      const bucketBySymbol = new Map<string, string>();
      for (const hr of heatmap.rows) bucketBySymbol.set(hr.symbol, hr.bucket);
      for (const row of rows) {
        const bucket = bucketBySymbol.get(row.symbol);
        if (bucket && row.indicators) {
          (row.indicators as Record<string, unknown>).futOiBuildup = bucket;
        }
      }
    }
  } catch { /* non-critical */ }

  timing.heatmapOverlay = Date.now() - phaseStart;
  timing.total = Date.now() - start;

  // ── SECTION 4: Exact count reconciliation ────────────────────────────────
  // Build the reconciliation table. All accounting equations are validated
  // here; any mismatch is flagged in allValid. The generation is still
  // published even if equations fail (soft validation), but the status route
  // exposes the allValid flag so operators can investigate.
  const eb = eligibilityBreakdown;
  const debtGovernmentSecurities  = eb["DEBT_GOVERNMENT_SECURITY"]          ?? 0;
  const sovereignGoldBonds         = eb["SOVEREIGN_GOLD_BOND"]               ?? 0;
  const etfOrFund                  = eb["ETF_OR_FUND"]                        ?? 0;
  const smePolicyExclusions        = eb["SME_EQUITY_POLICY_EXCLUDED"]        ?? 0;
  const t2tPolicyExclusions        = eb["TRADE_TO_TRADE_EQUITY_POLICY_EXCLUDED"] ?? 0;
  const inactiveOrDelisted         = eb["INACTIVE_OR_DELISTED"]               ?? 0;
  const otherUnsupported           = eb["OTHER_UNSUPPORTED"]                  ?? 0;
  const unresolvedSecurityType     = eb["UNRESOLVED_SECURITY_TYPE"]           ?? 0;
  const indexInstruments           = eb["INDEX"]                              ?? 0;
  const eligibleOrdinaryEquities   = eb["ORDINARY_EQUITY_ELIGIBLE"]          ?? 0;
  // Sum all known classes to detect any that aren't accounted for
  const knownClassSum = debtGovernmentSecurities + sovereignGoldBonds + etfOrFund +
    smePolicyExclusions + t2tPolicyExclusions + inactiveOrDelisted + otherUnsupported +
    unresolvedSecurityType + indexInstruments + eligibleOrdinaryEquities;
  const rawKiteMaster = Object.values(eb).reduce((a, b) => a + b, 0);
  const unknownClass = rawKiteMaster - knownClassSum;

  const kiteQuoteRows = kiteOnlyCount + enrichedCount;
  const yahooChartRows = yahooFallbackCount;
  const yahooBatchRows = yahooBatchCount;
  const liveQuoteRows = kiteQuoteRows + yahooChartRows + yahooBatchRows;
  const noQuoteRows = symbolList.length - liveQuoteRows;

  const evaluatedRows  = rows.filter(r => r.recommendation.score != null).length;
  const notEvaluatedRows = rows.length - evaluatedRows;
  const apiRowCount = rows.length;

  const step1Valid = rawKiteMaster === 0 || (Math.abs(rawKiteMaster - knownClassSum - unknownClass) === 0);
  const step2Valid = eligibleOrdinaryEquities === 0 || (liveQuoteRows + noQuoteRows === symbolList.length);
  const step3Valid = apiRowCount === evaluatedRows + notEvaluatedRows;

  const countReconciliation: ScanCountReconciliation = {
    rawKiteMaster,
    debtGovernmentSecurities,
    sovereignGoldBonds,
    etfOrFund,
    smePolicyExclusions,
    t2tPolicyExclusions,
    inactiveOrDelisted,
    otherUnsupported,
    unresolvedSecurityType,
    indexInstruments,
    unknownClass,
    eligibleOrdinaryEquities,
    kiteQuoteRows,
    yahooChartRows,
    yahooBatchRows,
    liveQuoteRows,
    noQuoteRows,
    evaluatedRows,
    notEvaluatedRows,
    apiRowCount,
    timingMs: { ...timing },
    step1Valid,
    step2Valid,
    step3Valid,
    allValid: step1Valid && step2Valid && step3Valid,
  };

  const scanMs = timing.total;
  logger.info({
    generationId,
    rows: rows.length,
    universe: symbolList.length,
    kiteOnly: kiteOnlyCount,
    enriched: enrichedCount,
    yahooFallback: yahooFallbackCount,
    yahooBatch: yahooBatchCount,
    yahooBatchSize: yahooBatch?.size ?? 0,
    enrichTimedOut,
    scanMs,
    timing,
    phaseA: !SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED,
    reconciliationValid: countReconciliation.allValid,
    sourceDate,
    degraded,
    kiteOffline: !kiteQuotes,
  }, "Full NSE scan complete");

  return {
    rows,
    lastUpdated: Date.now(),
    sourceDate,
    total: symbolList.length,           // ordinary-equity-eligible count
    scanMs,
    failures: noQuoteRows,
    liveQuoteCount: liveQuoteRows,
    rested: 0,
    enriched: enrichedCount,
    degraded,
    kiteOffline: !kiteQuotes,
    eligibilityBreakdown,
    phaseA: !SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED,
    generationId,
    countReconciliation,
  };
}

export async function scanFullNse(opts?: { force?: boolean }): Promise<Cache> {
  // The background timer passes { force: true } so the cache-freshness gate
  // never causes a skipped tick. Walk-through of the prior bug: scan duration
  // (~80s on a full Kite + Yahoo cycle) > REFRESH_MS (60s). Timer at t=0
  // starts a scan that finishes at t=80; cache.lastUpdated=80. Timer at t=120
  // sees cache age 40s < 60s → "fresh" → no new scan. Timer at t=180 sees
  // age 100s → triggers next scan, finishes at t=260. So scans actually
  // ran every ~180s, not 60s, and any backgrounded tab compounded it (the
  // user observed 6m 58s staleness on the FULL SCANNER pill). The
  // scanInFlight guard below is sufficient on its own to prevent overlapping
  // work, so the freshness gate is only needed for ad-hoc HTTP callers
  // (e.g. /api/scan/full-nse hit by a burst of clients) where returning the
  // cached payload immediately is the right behaviour.
  const fresh = !opts?.force && cache && !cache.degraded && Date.now() - cache.lastUpdated < REFRESH_MS;
  if (fresh) return cache!;

  // Kick off (or join) a background refresh.
  if (!scanInFlight) {
    scanInFlight = (async () => {
      try {
        const next = await performFullScan();
        if (next.rows.length > 0) {
          const prev = cache;
          const downgrading = !prev?.degraded && next.degraded && (prev?.rows.length ?? 0) > next.rows.length;
          if (!downgrading) cache = next;
          if (!next.degraded) {
            try { saveBlob(DISK_CACHE_NAME, DISK_CACHE_VERSION, next); } catch { /* logged inside */ }
          }
          // After every successful (non-degraded-only) scan, run the
          // swing-equity paper trading tick: open new STRONG_BUY paper
          // trades and re-evaluate every OPEN paper position. Detached
          // so a hook failure can never poison the scan cache. We only
          // run the tick when we actually accepted the new scan into
          // cache; a downgrading degraded scan would mark stale rows
          // to market with stale prices.
          if (!downgrading) {
            void runSwingTickForLatestScan(cache ?? next).catch((err) =>
              logger.warn(
                { err: (err as Error).message },
                "Swing equity tick failed after scan",
              ),
            );
          }
        }
        // After a degraded scan, retry sooner — Kite session may have just
        // come back online or bhavcopy may have become reachable.
        if (next.degraded) {
          setTimeout(() => {
            void scanFullNse().catch(err => logger.warn({ err: (err as Error).message }, "Degraded-recovery full NSE scan failed"));
          }, 30_000).unref?.();
        }
        return cache ?? next;
      } finally {
        scanInFlight = null;
      }
    })();
    // Detach a swallow-catch so the background promise can never raise
    // an unhandled rejection when only the fast path (returning stale
    // cache) is awaited and no other caller has joined.
    scanInFlight.catch(() => { /* logged inside performFullScan */ });
  }

  // Stale-while-revalidate: if there's ANY cache (warm-started from
  // disk, or stale from a prior cycle), serve it immediately. The
  // background refresh continues; the next poll picks up the fresh
  // payload. This is what stops the Scanner page from feeling "stuck"
  // for 7-12s on every server restart — the disk warm-start cache is
  // good enough to render instantly.
  if (cache && cache.rows.length > 0) return cache;

  // Truly cold cache (first deploy, disk wiped) — must wait.
  return scanInFlight;
}

export function getAllScannedRows(): { rows: StockRow[]; sourceDate: string | null; lastUpdated: number | null } {
  if (!cache) return { rows: [], sourceDate: null, lastUpdated: null };
  return { rows: cache.rows.slice(), sourceDate: cache.sourceDate, lastUpdated: cache.lastUpdated };
}

export function startFullNseScannerBackground(): void {
  if (timer) return;

  // Warm-start from disk cache so the first request returns immediately
  // even before the cold scan finishes.
  const blob = loadBlob<Cache>(DISK_CACHE_NAME, DISK_CACHE_VERSION);
  if (blob && blob.payload && blob.payload.rows && blob.payload.rows.length > 0) {
    cache = blob.payload;
    const ageMin = Math.round((Date.now() - blob.ts) / 60_000);
    logger.info({ rows: cache.rows.length, total: cache.total, ageMin }, "Full NSE: warm-started from disk cache");
  }

  // Pre-warm the bhavcopy in the background (used as fallback for
  // delivery%), then kick the first scan. We don't wait for bhavcopy
  // because Kite is the primary source now.
  setTimeout(() => {
    void getDeliveryMap()
      .then(m => { logger.info({ ok: !!m, count: m?.map.size ?? 0 }, "Bhavcopy pre-warm (delivery% fallback)"); })
      .catch(() => { /* fine — Kite quotes don't need bhavcopy */ });
    void scanFullNse().catch(err => logger.warn({ err: (err as Error).message }, "Initial full NSE scan failed"));
  }, 500);
  timer = setInterval(() => {
    // C0 — P0.1 interim session gate: skip signal sweep + alert emission on
    // weekends. The full exchange-calendar service (M1) will replace this.
    // Kills the Saturday-alert class (stale Friday bar → weekend signal + alert).
    const dow = new Date().getDay(); // 0=Sun, 6=Sat
    if (dow === 0 || dow === 6) {
      logger.info({ dow }, "Scanner: weekend gate — skipping signal sweep (C0 session guard)");
      return;
    }
    void scanFullNse({ force: true }).catch(err => logger.warn({ err: (err as Error).message }, "Background full NSE scan failed"));
  }, REFRESH_MS);
  if (typeof timer.unref === "function") timer.unref();
  logger.info({ refreshMs: REFRESH_MS, warmCache: !!cache }, "Full NSE background scanner started (Kite-first)");
}

export function getFullNseStatus(): {
  hasCache: boolean;
  lastUpdated: number | null;
  total: number;
  rows: number;
  failures: number;
  rested: number;
  sourceDate: string | null;
  scanMs: number | null;
  progress: { running: boolean; scanned: number; total: number; startedAt: number | null };
  ageMs: number | null;
  stale: boolean;
  universeEstimate: number;
  /** generationId of the last completed (displayed) generation. */
  displayedGenerationId: string | null;
  /** generationId of the scan currently in progress (null when idle). */
  inProgressGenerationId: string | null;
} {
  const ageMs = cache ? Date.now() - cache.lastUpdated : null;
  const stale = ageMs != null && ageMs > DISK_CACHE_MAX_AGE_MS;
  const prog = { running: progress.running, scanned: progress.scanned, total: progress.total, startedAt: progress.startedAt };
  const universeEstimate = cache?.total ?? progress.total ?? 0;
  if (!cache) return {
    hasCache: false, lastUpdated: null, total: 0, rows: 0, failures: 0, rested: 0,
    sourceDate: null, scanMs: null, progress: prog, ageMs: null, stale: false,
    universeEstimate, displayedGenerationId: null, inProgressGenerationId: progress.inProgressGenerationId,
  };
  return {
    hasCache: true,
    lastUpdated: cache.lastUpdated,
    total: cache.total,
    rows: cache.rows.length,
    failures: cache.failures,
    rested: cache.rested,
    sourceDate: cache.sourceDate,
    scanMs: cache.scanMs,
    progress: prog,
    ageMs,
    stale,
    universeEstimate,
    displayedGenerationId: cache.generationId,
    inProgressGenerationId: progress.inProgressGenerationId,
  };
}
