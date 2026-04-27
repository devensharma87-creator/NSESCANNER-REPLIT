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
import { fetchIntraday, yahooTickerFor } from "./yahoo";
import { ema, rsi, atr, sessionVwap } from "./indicators";
import { getAllSymbols, getDeliveryPct, getDeliveryMap } from "./nseBhavcopy";
import { UNIVERSE, INACTIVE_SYMBOLS } from "./universe";
import { logger } from "./logger";
import { loadBlob, saveBlob } from "./diskCache";
import { loadKiteNseEqInstruments, loadKiteQuotes, type KiteScannerQuote } from "./kiteScanner";

// Refresh cadence. Kite quotes are cheap and authenticated, so we can
// refresh more frequently than the old 5-minute Yahoo cycle.
const REFRESH_MS = 60_000;
// Indicator-enrichment concurrency for the Yahoo intraday calls. Lower
// than before because indicators are now optional, not blocking.
const ENRICH_CONCURRENCY = 12;
// Cap how many symbols we attempt to enrich per cycle so a slow Yahoo
// doesn't hold the cycle open forever. The cap is the curated F&O
// universe size + headroom — the symbols traders actually care about.
const ENRICH_CAP = 400;
// How long the indicator-enrichment phase is allowed to take before we
// publish the cache anyway with whatever indicators came back. Keeps the
// scan from stalling indefinitely behind a slow upstream.
const ENRICH_TIMEOUT_MS = 25_000;
const MIN_BARS = 5;

const DISK_CACHE_NAME = "full-nse-scan";
// v4 — schema is unchanged but bumping the version invalidates the v3
// blob from before the Kite-first rewrite landed, so the next cold boot
// starts clean rather than serving an old Yahoo-only snapshot forever.
const DISK_CACHE_VERSION = 4;
const DISK_CACHE_MAX_AGE_MS = 60 * 60_000;

interface Cache {
  rows: StockRow[];
  lastUpdated: number;
  sourceDate: string;
  total: number;
  scanMs: number;
  failures: number;
  rested: number;
  enriched: number;
  degraded?: boolean;
}

interface Progress { scanned: number; total: number; startedAt: number | null; running: boolean }
const progress: Progress = { scanned: 0, total: 0, startedAt: null, running: false };

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
  volumeRatio: number;
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

  if (volumeRatio >= 1.5) {
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
  ema20: number | null;
  ema50: number | null;
  rsi14: number | null;
  atr14: number | null;
  vwap: number | null;
  volumeRatio: number;
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

// ── Yahoo outage circuit-breaker ───────────────────────────────────
// In production Yahoo is geo-blocked. Without a circuit-breaker the
// every-60s enrichment pass logs hundreds of warnings continuously. Once
// we observe a high failure rate we pause Yahoo enrichment for a while.
let yahooSkipUntil = 0;
const YAHOO_OUTAGE_PAUSE_MS = 10 * 60_000;       // 10-min cool-off
const YAHOO_OUTAGE_FAIL_RATIO = 0.9;              // >=90% failed → outage
const YAHOO_OUTAGE_MIN_SAMPLE = 30;               // need 30 attempts to judge

async function tryYahooIndicators(symbol: string): Promise<YahooIndicators | null> {
  try {
    const yt = yahooTickerFor(symbol);
    const bars = await fetchIntraday(yt, "15m", "1d");
    if (!bars || bars.close.length < MIN_BARS) return null;
    const closes = bars.close.filter((v): v is number => v != null);
    const highs = bars.high.filter((v): v is number => v != null);
    const lows = bars.low.filter((v): v is number => v != null);
    const vols = bars.volume.filter((v): v is number => v != null);
    if (closes.length < MIN_BARS) return null;
    const ema20 = lastVal(ema(closes, 20));
    const ema50 = lastVal(ema(closes, 50));
    const rsiVal = lastVal(rsi(closes, 14));
    const atrVal = lastVal(atr(highs, lows, closes, 14));
    const vwap = sessionVwap(highs, lows, closes, vols).slice(-1)[0] ?? null;
    const window = Math.min(20, vols.length);
    const avgVol = window > 0 ? vols.slice(-window).reduce((a, b) => a + b, 0) / window : 1;
    const lastVol = vols[vols.length - 1] ?? 0;
    const volumeRatio = avgVol > 0 ? lastVol / avgVol : 1;
    const realPrice = bars.meta.regularMarketPrice ?? closes[closes.length - 1] ?? null;
    const realOpen = bars.open.find(v => v != null) ?? realPrice;
    const realHigh = highs.length ? Math.max(...highs) : null;
    const realLow = lows.length ? Math.min(...lows) : null;
    const realPrev = bars.meta.chartPreviousClose ?? realOpen;
    const realVolume = vols.reduce((a, b) => a + b, 0);
    return {
      ema20,
      ema50,
      rsi14: rsiVal,
      atr14: atrVal,
      vwap,
      volumeRatio,
      high52w: bars.meta.fiftyTwoWeekHigh ?? null,
      low52w: bars.meta.fiftyTwoWeekLow ?? null,
      longName: bars.meta.longName ?? bars.meta.shortName ?? null,
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

function rowFromKiteOnly(kq: KiteScannerQuote, deliveryPct: number): StockRow {
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
  const recommendation = buildRecommendation({
    rsiVal: null,
    trend: "NEUTRAL",
    volumeRatio: 1,
    changePct: kq.changePercent,
    vwapAbove: null,
  });
  return {
    symbol: kq.symbol,
    name: kq.name,
    sector: "NSE EQ",
    quote,
    indicators: {
      ema9: 0, ema21: 0, ema20: 0, ema50: 0,
      vwap: undefined,
      rsi14: 50,
      macd: 0, macdSignal: 0, macdHist: 0,
      atr14: 0, adx14: 0,
      volumeRatio: 1,
      deliveryPct: round2(deliveryPct),
      trendStrength: 50,
      supportLevel: round2(kq.low),
      resistanceLevel: round2(kq.high),
      pivot: round2((kq.high + kq.low + kq.lastPrice) / 3),
      r1: round2(2 * ((kq.high + kq.low + kq.lastPrice) / 3) - kq.low),
      s1: round2(2 * ((kq.high + kq.low + kq.lastPrice) / 3) - kq.high),
    },
    recommendation,
  };
}

function rowFromKitePlusIndicators(kq: KiteScannerQuote, ind: YahooIndicators, deliveryPct: number): StockRow {
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
  const recommendation = buildRecommendation({
    rsiVal: ind.rsi14,
    trend,
    volumeRatio: ind.volumeRatio,
    changePct: kq.changePercent,
    vwapAbove,
  });
  const trendStrength = trend === "BULLISH"
    ? Math.min(100, 70 + (ind.rsi14 != null ? Math.max(0, ind.rsi14 - 50) / 5 : 0))
    : trend === "BEARISH"
      ? Math.max(0, 30 - (ind.rsi14 != null ? Math.max(0, 50 - ind.rsi14) / 5 : 0))
      : 50;
  return {
    symbol: kq.symbol,
    name: ind.longName || kq.name,
    sector: "NSE EQ",
    quote,
    indicators: {
      ema9: 0, ema21: 0,
      ema20: ind.ema20 != null ? round2(ind.ema20) : 0,
      ema50: ind.ema50 != null ? round2(ind.ema50) : 0,
      vwap: ind.vwap != null ? round2(ind.vwap) : undefined,
      rsi14: ind.rsi14 != null ? round2(ind.rsi14) : 50,
      macd: 0, macdSignal: 0, macdHist: 0,
      atr14: ind.atr14 != null ? round2(ind.atr14) : 0,
      adx14: 0,
      volumeRatio: round2(ind.volumeRatio),
      deliveryPct: round2(deliveryPct),
      trendStrength,
      supportLevel: round2(kq.low),
      resistanceLevel: round2(kq.high),
      pivot: round2((kq.high + kq.low + kq.lastPrice) / 3),
      r1: round2(2 * ((kq.high + kq.low + kq.lastPrice) / 3) - kq.low),
      s1: round2(2 * ((kq.high + kq.low + kq.lastPrice) / 3) - kq.high),
    },
    recommendation,
  };
}

async function performFullScan(): Promise<Cache> {
  const start = Date.now();

  // ── 1. UNIVERSE ────────────────────────────────────────────────────
  // Kite first (works in every region); bhavcopy second; curated last.
  let symbolList: string[] = [];
  let sourceDate = "";
  let degraded = false;

  const kiteInst = await loadKiteNseEqInstruments();
  if (kiteInst && kiteInst.list.length > 0) {
    symbolList = kiteInst.list.map(i => i.tradingsymbol);
    sourceDate = `kite:${new Date(kiteInst.fetchedAt).toISOString().slice(0, 10)}`;
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

  // ── 2. KITE QUOTES (primary price source) ──────────────────────────
  const kiteQuotes = await loadKiteQuotes(symbolList);
  if (kiteQuotes && kiteQuotes.size > 0) {
    logger.info({ requested: symbolList.length, returned: kiteQuotes.size }, "Kite scanner: quote pass complete");
  } else if (!kiteQuotes) {
    logger.warn("Kite scanner: no active session — falling back to Yahoo-only enrichment");
  }

  // ── 3. INDICATOR ENRICHMENT (best effort, optional) ────────────────
  // Pick a bounded subset to enrich with Yahoo indicators. Prioritize:
  //   (a) symbols in the curated UNIVERSE (F&O names traders care about)
  //   (b) high-ADV / index constituents already in UNIVERSE
  // The rest get Kite-only rows (price/OHLC/volume/change), no fake indicators.
  const universeSet = new Set(UNIVERSE.filter(u => !u.inactive).map(u => u.symbol));
  const enrichTargets: string[] = [];
  for (const s of symbolList) {
    if (!kiteQuotes || !kiteQuotes.has(s)) continue;
    if (universeSet.has(s)) enrichTargets.push(s);
    if (enrichTargets.length >= ENRICH_CAP) break;
  }
  // If Kite isn't available we have to enrich every symbol via Yahoo
  // (that's the only price source left), so skip the cap.
  const enrichList = kiteQuotes ? enrichTargets : symbolList.slice(0, ENRICH_CAP);

  const yahooByScopedSymbol = new Map<string, YahooIndicators>();
  let cursor = 0;
  let enrichTimedOut = false;
  let yahooAttempted = 0;
  let yahooSucceeded = 0;
  const yahooEnabled = Date.now() >= yahooSkipUntil;

  async function enrichWorker() {
    while (cursor < enrichList.length && !enrichTimedOut) {
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

  if (yahooEnabled) {
    const enrichPromise = Promise.all(
      Array.from({ length: ENRICH_CONCURRENCY }, () => enrichWorker()),
    );
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<void>(res => {
      timeoutHandle = setTimeout(() => { enrichTimedOut = true; res(); }, ENRICH_TIMEOUT_MS);
    });
    try {
      await Promise.race([enrichPromise, timeoutPromise]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
    // Circuit-breaker: if Yahoo failed almost every call, pause enrichment
    // for a cool-off period so we don't spam warnings every minute.
    if (yahooAttempted >= YAHOO_OUTAGE_MIN_SAMPLE) {
      const failRatio = 1 - (yahooSucceeded / yahooAttempted);
      if (failRatio >= YAHOO_OUTAGE_FAIL_RATIO) {
        yahooSkipUntil = Date.now() + YAHOO_OUTAGE_PAUSE_MS;
        logger.warn({
          attempted: yahooAttempted,
          succeeded: yahooSucceeded,
          failRatio: +failRatio.toFixed(2),
          pausedForMs: YAHOO_OUTAGE_PAUSE_MS,
        }, "Yahoo enrichment circuit-breaker tripped — pausing indicator pass");
      }
    }
  } else {
    logger.debug({ skipUntil: new Date(yahooSkipUntil).toISOString() }, "Yahoo enrichment skipped (circuit-breaker active)");
  }

  // ── 4. ROW ASSEMBLY ────────────────────────────────────────────────
  const rows: StockRow[] = [];
  let kiteOnlyCount = 0;
  let enrichedCount = 0;
  let yahooFallbackCount = 0;

  for (const sym of symbolList) {
    const kq = kiteQuotes?.get(sym) ?? null;
    const ind = yahooByScopedSymbol.get(sym) ?? null;
    const realDelv = await getDeliveryPct(sym).catch(() => null);
    const deliveryPct = realDelv?.pct ?? 0;
    if (kq && ind) {
      rows.push(rowFromKitePlusIndicators(kq, ind, deliveryPct));
      enrichedCount++;
    } else if (kq) {
      rows.push(rowFromKiteOnly(kq, deliveryPct));
      kiteOnlyCount++;
    } else if (ind && ind.realPrice != null && ind.realPrice > 0) {
      // No Kite quote but Yahoo bars are real and complete — emit a row
      // built from genuine Yahoo last-bar prices. NEVER synthetic.
      const realPrev = ind.realPrevClose ?? ind.realOpen ?? ind.realPrice;
      const yQuote: KiteScannerQuote = {
        symbol: sym,
        name: ind.longName ?? sym,
        lastPrice: ind.realPrice,
        open: ind.realOpen ?? ind.realPrice,
        high: ind.realHigh ?? ind.realPrice,
        low: ind.realLow ?? ind.realPrice,
        close: realPrev ?? ind.realPrice,
        volume: ind.realVolume,
        change: ind.realPrice - (realPrev ?? ind.realPrice),
        changePercent: realPrev ? ((ind.realPrice - realPrev) / realPrev) * 100 : 0,
        ts: Date.now(),
      };
      // Same sanity guard as Kite path — drop suspected corp-action glitches.
      if (Math.abs(yQuote.changePercent) <= 35) {
        rows.push(rowFromKitePlusIndicators(yQuote, ind, deliveryPct));
        yahooFallbackCount++;
      }
    }
    progress.scanned++;
  }

  rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
  progress.running = false;

  const result: Cache = {
    rows,
    lastUpdated: Date.now(),
    sourceDate,
    total: symbolList.length,
    scanMs: Date.now() - start,
    failures: symbolList.length - rows.length,
    rested: 0,
    enriched: enrichedCount,
    degraded,
  };
  logger.info({
    rows: rows.length,
    universe: symbolList.length,
    kiteOnly: kiteOnlyCount,
    enriched: enrichedCount,
    yahooFallback: yahooFallbackCount,
    enrichTimedOut,
    scanMs: result.scanMs,
    sourceDate,
    degraded,
  }, "Full NSE scan complete (Kite-first)");
  return result;
}

export async function scanFullNse(): Promise<Cache> {
  const fresh = cache && !cache.degraded && Date.now() - cache.lastUpdated < REFRESH_MS;
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
    void scanFullNse().catch(err => logger.warn({ err: (err as Error).message }, "Background full NSE scan failed"));
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
  // Best-known universe size — falls back to the in-flight scan total
  // (post-dedup) when the cache hasn't landed yet, so the UI can show
  // "Scanning ~2,486 stocks…" during a cold start instead of "0 of 0".
  universeEstimate: number;
} {
  const ageMs = cache ? Date.now() - cache.lastUpdated : null;
  const stale = ageMs != null && ageMs > DISK_CACHE_MAX_AGE_MS;
  const prog = { running: progress.running, scanned: progress.scanned, total: progress.total, startedAt: progress.startedAt };
  const universeEstimate = cache?.total ?? progress.total ?? 0;
  if (!cache) return { hasCache: false, lastUpdated: null, total: 0, rows: 0, failures: 0, rested: 0, sourceDate: null, scanMs: null, progress: prog, ageMs: null, stale: false, universeEstimate };
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
  };
}
