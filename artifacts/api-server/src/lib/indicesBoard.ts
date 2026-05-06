/**
 * Indices Board — single source of truth for the dedicated "Indices" tab.
 *
 * Powers the page that lists Indian indices (NIFTY 50, BANK NIFTY, FINNIFTY,
 * MIDCPNIFTY, SENSEX), global benchmarks (S&P 500, Nasdaq, Dow Jones, FTSE
 * 100, Nikkei 225) and commodities (Gold, Silver, WTI Crude, Brent) with
 * the full per-instrument fact-pack the spec calls for:
 *
 *   - Live: LTP / OHLC / change / change %
 *   - Historical: 52w high & low, previous-day OHLC
 *   - Daily indicators: EMA 9 / 20 / 50 / 100 / 200, daily VWAP-equivalent
 *     (intraday session VWAP when intraday bars are available)
 *   - Market profile: VAH / VAL / POC (intraday volume profile)
 *   - Key levels: classic floor pivots → 3 supports + 3 resistances
 *
 * Data flow per instrument:
 *   1.  Yahoo daily 1y chart   → 52w extrema, prev-day OHLC, daily EMAs
 *   2.  Yahoo intraday 5m / 1d → session VWAP, volume profile (VAH/VAL/POC)
 *   3.  For Indian indices, when a Kite session is alive: prefer the live
 *       Kite quote (LTP + today's OHLC) over Yahoo's ~15-min-delayed feed.
 *   4.  S/R levels are floor-trader pivots derived from prev-day OHLC, the
 *       same convention the rest of the app uses (see indicators.pivots).
 *
 * Failure semantics: when a chart call fails or returns insufficient bars
 * we leave the field undefined and append a human-readable note to the row
 * so the UI can surface the partial state honestly. We never fabricate
 * placeholder numbers (no synthetic data anywhere in this codebase).
 *
 * Cached for 10s globally — matches the kiteIndexQuotes cadence so live
 * refreshes feel real-time without hammering Yahoo.
 */

import { fetchChart, fetchChartRaw, fetchIntraday, type YahooChart } from "./yahoo";
import { fetchKiteIntraday, hasKiteIntradayCoverage } from "./kiteIntraday";
import { ema, sessionVwap, volumeProfile } from "./indicators";
import { getKiteIndexQuotes, type KiteIndexQuote } from "./kiteIndexQuotes";
import { getGiftNifty } from "./giftNifty";
import { getTvQuotes, type TvQuote } from "./tvQuotes";
import { logger } from "./logger";

export type IndicesCategory = "INDIA" | "GLOBAL" | "COMMODITY" | "ADR" | "FX";

export interface InstrumentCfg {
  /** Canonical key — stable identifier the frontend keys rows by. */
  key: string;
  /** Display name shown in the UI. */
  name: string;
  category: IndicesCategory;
  /** Yahoo Finance ticker used for **live** quote + intraday bars (always set). */
  yahoo: string;
  /** Optional alternate Yahoo ticker used **only** for the daily 1y history
   *  (EMAs, prev OHLC, 52w extrema, pivots). Required for symbols whose
   *  exact ticker (e.g. NIFTY_MID_SELECT.NS) returns a live tick but no
   *  historical bars; in that case we fall back to the closest daily-chart
   *  proxy (e.g. ^NSEMDCP50) and surface a `notes` entry. Defaults to `yahoo`. */
  yahooDaily?: string;
  /** When `yahooDaily` differs from `yahoo`, a one-line proxy disclosure
   *  attached to the row's notes — keeps the UI honest about the source. */
  proxyNote?: string;
  /** Optional yahoo-symbol used by getKiteIndexQuotes when overriding LTP/OHLC. */
  kiteYahooKey?: string;
  /**
   * Optional TradingView ticker (e.g. "TVC:SPX", "NYSE:INFY", "FX_IDC:USDINR")
   * used to override Yahoo's ~15-min-delayed LTP/change/percent with a
   * near-real-time TradingView scanner quote. When set and the TV fetch
   * succeeds, `item.source` flips to "tv" (rendered as a green LIVE pill);
   * on failure the row falls back to Yahoo with no behaviour change.
   * Indian indices intentionally don't set this — they prefer Kite.
   */
  tvSymbol?: string;
  /** Hint for the UI — e.g. "USD", "₹". */
  currency: string;
}

export const INSTRUMENTS: InstrumentCfg[] = [
  // ── Indian indices ────────────────────────────────────────────────
  { key: "NIFTY50",     name: "NIFTY 50",         category: "INDIA",     yahoo: "^NSEI",                 kiteYahooKey: "^NSEI",                currency: "₹" },
  { key: "BANKNIFTY",   name: "BANK NIFTY",       category: "INDIA",     yahoo: "^NSEBANK",              kiteYahooKey: "^NSEBANK",             currency: "₹" },
  { key: "FINNIFTY",    name: "FIN NIFTY",        category: "INDIA",     yahoo: "NIFTY_FIN_SERVICE.NS",  kiteYahooKey: "NIFTY_FIN_SERVICE.NS", currency: "₹" },
  // MIDCPNIFTY underlying is "Nifty Midcap Select" (live = NIFTY_MID_SELECT.NS,
  // Kite = NSE:NIFTY MID SELECT). Yahoo's chart endpoint returns only a single
  // live tick for that symbol with no historical bars, so we use the broader
  // Nifty Midcap 50 (^NSEMDCP50) as the daily-history proxy for EMAs / pivots
  // / 52w extrema. The two midcap baskets historically track within ~1%.
  { key: "MIDCPNIFTY",  name: "MIDCAP NIFTY",     category: "INDIA",
    yahoo: "NIFTY_MID_SELECT.NS",
    yahooDaily: "^NSEMDCP50",
    proxyNote: "Daily indicators use Nifty Midcap 50 proxy (Yahoo lacks history for Nifty Midcap Select)",
    kiteYahooKey: "NIFTY_MID_SELECT.NS",
    currency: "₹" },
  { key: "SENSEX",      name: "SENSEX",           category: "INDIA",     yahoo: "^BSESN",                kiteYahooKey: "^BSESN",               currency: "₹" },
  { key: "BANKEX",      name: "BANKEX",           category: "INDIA",     yahoo: "BSE-BANK.BO",           kiteYahooKey: "BSE-BANK.BO",          currency: "₹" },

  // ── Global indices ───────────────────────────────────────────────
  // GIFT NIFTY (NSE IFSC) is sourced live from TradingView (NSEIX:NIFTY1!)
  // by the Markets-board builder via a dedicated branch — see giftNifty.ts.
  // It is intentionally NOT in this Yahoo-backed list because Yahoo doesn't
  // carry it and substituting ^NSEI cash spot was the source of a sign-
  // inversion bug in the pre-market read. The board builder injects the
  // GIFT entry separately when the TradingView fetch succeeds; if it fails,
  // the entry is omitted rather than fabricated.
  // tvSymbol picks the TradingView ticker that the scanner endpoint streams
  // near-real-time quotes for. TVC:* are TradingView's own continuous index
  // feeds (real-time on free tier). Index-name tickers like NASDAQ:IXIC and
  // SSE:000001 use the exchange's own real-time index quote. ADRs use the
  // NYSE/NASDAQ listing directly; US equities are real-time on TV's free tier.
  { key: "SP500",       name: "S&P 500",          category: "GLOBAL",    yahoo: "^GSPC",                 tvSymbol: "SP:SPX",         currency: "$" },
  { key: "NASDAQ",      name: "NASDAQ",           category: "GLOBAL",    yahoo: "^IXIC",                 tvSymbol: "NASDAQ:IXIC",    currency: "$" },
  { key: "DOWJONES",    name: "Dow Jones",        category: "GLOBAL",    yahoo: "^DJI",                  tvSymbol: "DJ:DJI",         currency: "$" },
  { key: "FTSE100",     name: "FTSE 100",         category: "GLOBAL",    yahoo: "^FTSE",                 tvSymbol: "TVC:UKX",        currency: "£" },
  { key: "DAX",         name: "DAX",              category: "GLOBAL",    yahoo: "^GDAXI",                tvSymbol: "XETR:DAX",       currency: "€" },
  { key: "NIKKEI225",   name: "Nikkei 225",       category: "GLOBAL",    yahoo: "^N225",                 tvSymbol: "TVC:NI225",      currency: "¥" },
  { key: "HANGSENG",    name: "Hang Seng",        category: "GLOBAL",    yahoo: "^HSI",                  tvSymbol: "HSI:HSI",        currency: "HK$" },
  { key: "SHANGHAI",    name: "Shanghai Comp.",   category: "GLOBAL",    yahoo: "000001.SS",             tvSymbol: "SSE:000001",     currency: "¥" },
  { key: "VIX",         name: "VIX (Volatility)", category: "GLOBAL",    yahoo: "^VIX",                  tvSymbol: "TVC:VIX",        currency: "" },

  // ── Commodities (CME futures continuous on Yahoo, TVC spot on TV) ──
  // TVC:GOLD / TVC:SILVER are TradingView's continuous spot feeds (XAU/USD,
  // XAG/USD style). They print on a slightly different scale than the CME
  // front-month futures (Yahoo's GC=F / SI=F), so the LTP shown on the
  // card and the EMA/pivot levels (which are still derived from Yahoo
  // futures history) live on slightly different bases. The gap is usually
  // small (~0.3-1% basis), but during contango/backwardation dislocations
  // or rolls it can widen — we surface that disclosure as a per-row note
  // (see `proxyNote` propagation in getIndicesBoard) rather than fabricate
  // a false equivalence.
  { key: "GOLD",        name: "Gold",             category: "COMMODITY", yahoo: "GC=F",                  tvSymbol: "TVC:GOLD",       currency: "$" },
  { key: "SILVER",      name: "Silver",           category: "COMMODITY", yahoo: "SI=F",                  tvSymbol: "TVC:SILVER",     currency: "$" },
  // NYMEX:CL1! and ICEEUR:BRN1! are the front-month futures contracts —
  // same series Yahoo's CL=F / BZ=F track (continuous front-month roll),
  // so the EMAs/pivots derived from Yahoo daily history line up cleanly
  // with the TV LTP. TVC:USOIL / TVC:UKOIL are spot CFDs that don't return
  // a row from the scanner endpoint at all (verified empty), so the
  // futures tickers are the only working option for the spot-style label.
  { key: "CRUDE_WTI",   name: "Crude Oil (WTI)",  category: "COMMODITY", yahoo: "CL=F",                  tvSymbol: "NYMEX:CL1!",     currency: "$" },
  { key: "CRUDE_BRENT", name: "Brent Oil",        category: "COMMODITY", yahoo: "BZ=F",                  tvSymbol: "ICEEUR:BRN1!",   currency: "$" },

  // ── Indian ADRs (NYSE / NASDAQ listings of Indian companies) ──────
  // Quoted in USD. Useful as an after-hours sentiment read on India once
  // the cash session has closed. All confirmed live on Yahoo (251 daily
  // bars / yr). VEDL is delisted (Vedanta went private 2023); skipped.
  { key: "ADR_INFY",  name: "Infosys (INFY)",          category: "ADR", yahoo: "INFY", tvSymbol: "NYSE:INFY",    currency: "$" },
  { key: "ADR_HDB",   name: "HDFC Bank (HDB)",         category: "ADR", yahoo: "HDB",  tvSymbol: "NYSE:HDB",     currency: "$" },
  { key: "ADR_IBN",   name: "ICICI Bank (IBN)",        category: "ADR", yahoo: "IBN",  tvSymbol: "NYSE:IBN",     currency: "$" },
  { key: "ADR_WIT",   name: "Wipro (WIT)",             category: "ADR", yahoo: "WIT",  tvSymbol: "NYSE:WIT",     currency: "$" },
  { key: "ADR_RDY",   name: "Dr. Reddy's (RDY)",       category: "ADR", yahoo: "RDY",  tvSymbol: "NYSE:RDY",     currency: "$" },
  { key: "ADR_MMYT",  name: "MakeMyTrip (MMYT)",       category: "ADR", yahoo: "MMYT", tvSymbol: "NASDAQ:MMYT",  currency: "$" },

  // ── FX / Macro (currency pair + dollar index) ─────────────────────
  // FX_IDC:USDINR is TradingView's interbank (24×5) USD/INR feed.
  // TVC:DXY is TradingView's continuous Dollar Index quote.
  { key: "USDINR",      name: "USD / INR",        category: "FX",        yahoo: "INR=X",                 tvSymbol: "FX_IDC:USDINR",  currency: "₹" },
  { key: "DXY",         name: "Dollar Index",     category: "FX",        yahoo: "DX-Y.NYB",              tvSymbol: "TVC:DXY",        currency: "$" },
];

export interface IndexBoardItem {
  key: string;
  name: string;
  category: IndicesCategory;
  yahooSymbol: string;
  currency: string;
  /**
   * Origin of the LTP/change values:
   *   - "kite" → live Zerodha tick (Indian indices)
   *   - "tv"   → TradingView scanner quote (global / commodities / ADRs / FX).
   *             The actual freshness is reported separately in `tvUpdateMode`
   *             so the UI can distinguish true real-time ("streaming") from
   *             exchange-imposed 10/15-min delays ("delayed_streaming_*").
   *   - "yahoo" → Yahoo Finance fallback (when TV is unavailable). Yahoo's
   *               chart endpoint typically lags ~15min for major markets.
   *   - null   → no data
   */
  source: "kite" | "tv" | "yahoo" | null;
  /**
   * TradingView `update_mode` for the row, when source = "tv".
   *   - "streaming"             → true real-time tick
   *   - "delayed_streaming_600" → ~10-min delayed but still live-updating
   *   - "delayed_streaming_900" → ~15-min delayed but still live-updating
   *   - other (e.g. "endofday") → snapshot, treated as stale
   * The frontend uses this to render an accurate pill ("LIVE" vs "LIVE 15m").
   */
  tvUpdateMode?: string | null;
  asOf?: number;

  // Live snapshot
  ltp?: number;
  open?: number;
  high?: number;
  low?: number;
  change?: number;
  changePercent?: number;

  // Historical
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  prevOpen?: number;
  prevHigh?: number;
  prevLow?: number;
  prevClose?: number;

  // Daily-close EMAs
  ema9?: number;
  ema20?: number;
  ema50?: number;
  ema100?: number;
  ema200?: number;

  // Session indicators
  vwap?: number;

  // Market profile (intraday volume distribution)
  vah?: number;
  val?: number;
  poc?: number;

  // Floor-trader pivots from previous day OHLC
  pivot?: number;
  support: number[];      // S1, S2, S3 (always length 3 when prevOHLC present)
  resistance: number[];   // R1, R2, R3 (always length 3 when prevOHLC present)

  /** Human-readable diagnostic notes (e.g. "intraday bars unavailable"). */
  notes: string[];
}

export interface IndicesBoardSnapshot {
  items: IndexBoardItem[];
  lastUpdated: string;
  /** True when the Indian-index LTPs were sourced from a live Kite session. */
  kiteAuthenticated: boolean;
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Helpers                                                            */
/* ─────────────────────────────────────────────────────────────────── */

function lastVal(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i] as number;
  return null;
}

function round(n: number | null | undefined, p = 2): number | undefined {
  if (n == null || !Number.isFinite(n)) return undefined;
  const m = Math.pow(10, p);
  return Math.round(n * m) / m;
}

/** Compute classic floor-trader pivots with R3 / S3 (extends indicators.pivots). */
function pivotsR3(prevHigh: number, prevLow: number, prevClose: number) {
  const p = (prevHigh + prevLow + prevClose) / 3;
  const range = prevHigh - prevLow;
  return {
    pivot: p,
    r1: 2 * p - prevLow,
    s1: 2 * p - prevHigh,
    r2: p + range,
    s2: p - range,
    r3: prevHigh + 2 * (p - prevLow),
    s3: prevLow  - 2 * (prevHigh - p),
  };
}

/** Pick out the most recent two **completed** daily bars from a Yahoo daily
 *  chart. The latest bar may correspond to today's still-forming session,
 *  in which case "previous day" is index n-2. We treat any bar whose
 *  timestamp matches today (UTC date or local date) as the live session
 *  and step back one further when needed. */
function splitTodayPrev(daily: YahooChart): { todayIdx: number | null; prevIdx: number | null } {
  const n = daily.timestamps.length;
  if (n === 0) return { todayIdx: null, prevIdx: null };
  const lastTs = daily.timestamps[n - 1]! * 1000;
  const lastIsToday = isSameDayUTC(lastTs, Date.now()) || isSameDayLocal(lastTs, Date.now());
  if (lastIsToday) {
    return { todayIdx: n - 1, prevIdx: n >= 2 ? n - 2 : null };
  }
  // Latest bar is yesterday's close — there is no "today" bar yet (pre-open
  // or weekend). The "previous day" is the latest bar.
  return { todayIdx: null, prevIdx: n - 1 };
}

function isSameDayUTC(a: number, b: number): boolean {
  const da = new Date(a), db = new Date(b);
  return da.getUTCFullYear() === db.getUTCFullYear()
      && da.getUTCMonth()    === db.getUTCMonth()
      && da.getUTCDate()     === db.getUTCDate();
}
function isSameDayLocal(a: number, b: number): boolean {
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear()
      && da.getMonth()    === db.getMonth()
      && da.getDate()     === db.getDate();
}

/** Build one row by combining a daily chart, an intraday chart and the
 *  optional live overrides (TradingView for global / commodities / ADRs /
 *  FX, Kite for Indian indices). Side-effect free; returns the row.
 *
 *  Override precedence (lowest → highest):
 *    Yahoo daily-meta  →  Yahoo intraday-meta  →  TradingView  →  Kite
 *
 *  TradingView wins over Yahoo because it's near-real-time vs ~15min
 *  delayed; Kite wins over TradingView because it's an actual exchange
 *  tick. Indian indices intentionally skip TV (their Kite path is
 *  already live + the TV symbol would just duplicate the Kite price). */
function buildItem(
  cfg: InstrumentCfg,
  daily: YahooChart | null,
  intra: YahooChart | null,
  tv: TvQuote | undefined,
  kite: KiteIndexQuote | undefined,
): IndexBoardItem {
  const item: IndexBoardItem = {
    key: cfg.key,
    name: cfg.name,
    category: cfg.category,
    yahooSymbol: cfg.yahoo,
    currency: cfg.currency,
    source: null,
    support: [],
    resistance: [],
    notes: [],
  };

  // ── Daily-derived fields ──────────────────────────────────────────
  if (daily && daily.close.length > 0) {
    const { todayIdx, prevIdx } = splitTodayPrev(daily);

    if (prevIdx != null) {
      const o = daily.open[prevIdx], h = daily.high[prevIdx], l = daily.low[prevIdx], c = daily.close[prevIdx];
      item.prevOpen  = round(o, 4);
      item.prevHigh  = round(h, 4);
      item.prevLow   = round(l, 4);
      item.prevClose = round(c, 4);
      if (h != null && l != null && c != null) {
        const piv = pivotsR3(h, l, c);
        item.pivot       = round(piv.pivot, 4);
        item.resistance  = [round(piv.r1, 4)!, round(piv.r2, 4)!, round(piv.r3, 4)!];
        item.support     = [round(piv.s1, 4)!, round(piv.s2, 4)!, round(piv.s3, 4)!];
      }
    } else {
      item.notes.push("Previous-day OHLC unavailable from Yahoo");
    }

    if (todayIdx != null) {
      item.open = round(daily.open[todayIdx], 4);
      item.high = round(daily.high[todayIdx], 4);
      item.low  = round(daily.low[todayIdx], 4);
    } else {
      // No "today" daily bar yet — borrow today's session high/low from
      // Yahoo's chart-meta (regularMarketDayHigh / regularMarketDayLow).
      // `open` cannot be derived from meta and is left undefined here; the
      // intraday block below fills it in from the first 5m bar when bars
      // are available. We never fabricate placeholder values.
      item.high = round(daily.meta.regularMarketDayHigh, 4);
      item.low  = round(daily.meta.regularMarketDayLow,  4);
    }

    item.fiftyTwoWeekHigh = round(daily.meta.fiftyTwoWeekHigh, 4);
    item.fiftyTwoWeekLow  = round(daily.meta.fiftyTwoWeekLow, 4);

    // Daily EMA cascade — uses **closing** prices, the standard convention.
    const closes = daily.close.filter((v): v is number => v != null);
    if (closes.length >= 9)   item.ema9   = round(lastVal(ema(closes, 9)),   4);
    if (closes.length >= 20)  item.ema20  = round(lastVal(ema(closes, 20)),  4);
    if (closes.length >= 50)  item.ema50  = round(lastVal(ema(closes, 50)),  4);
    if (closes.length >= 100) item.ema100 = round(lastVal(ema(closes, 100)), 4);
    if (closes.length >= 200) item.ema200 = round(lastVal(ema(closes, 200)), 4);
    if (closes.length < 200)  item.notes.push(`Only ${closes.length} daily bars available (need 200 for EMA200)`);

    // Daily-meta LTP fallback. Only trusted when daily is the **same** ticker
    // as the live source — when a proxy (yahooDaily) is in play this price
    // belongs to the proxy basket, not the actual underlying, so we skip it
    // here and let the intraday block below populate LTP from the live ticker.
    if (!cfg.yahooDaily || cfg.yahooDaily === cfg.yahoo) {
      item.ltp = round(daily.meta.regularMarketPrice, 4);
      item.source = "yahoo";
      item.asOf = daily.meta.regularMarketTime;
    }
  } else {
    item.notes.push("Daily chart unavailable from Yahoo");
  }

  // ── Intraday-derived fields ──────────────────────────────────────
  if (intra && intra.close.length >= 6) {
    item.vwap = round(lastVal(sessionVwap(intra.high, intra.low, intra.close, intra.volume)), 4);
    // Use up to the last 80 intraday bars for the volume profile to focus
    // on the current session (5m × 80 = ~6.5h, full Indian session).
    const vp = volumeProfile(intra.high, intra.low, intra.close, intra.volume, 24, 80);
    if (vp) {
      item.poc = round(vp.pointOfControl, 4);
      item.vah = round(vp.valueAreaHigh,  4);
      item.val = round(vp.valueAreaLow,   4);
    }
    // Refine today's OHLC from intraday bars — far more accurate than
    // Yahoo's daily-bar snapshot during a live session.
    const sessionH = Math.max(...intra.high.filter((v): v is number => v != null));
    const sessionL = Math.min(...intra.low.filter((v): v is number => v != null));
    const firstO   = intra.open.find((v): v is number => v != null);
    if (Number.isFinite(sessionH)) item.high = round(sessionH, 4);
    if (Number.isFinite(sessionL)) item.low  = round(sessionL, 4);
    if (firstO != null && item.open == null) item.open = round(firstO, 4);
    // Intraday LTP from the **live** ticker (always — overrides daily-meta
    // when daily came from a proxy basket; same value otherwise so this
    // is a no-op there).
    const intraLtp = round(intra.meta.regularMarketPrice, 4) ?? round(lastVal(intra.close as (number | null)[]), 4);
    if (intraLtp != null) {
      item.ltp = intraLtp;
      item.source = "yahoo";
      item.asOf = intra.meta.regularMarketTime ?? item.asOf;
    }
    // When a daily proxy is in use (yahooDaily != yahoo) the prevClose we
    // captured above belongs to the proxy basket, so change/percent against
    // it would be nonsense. Override prevClose with the live ticker's own
    // chart-previous-close so the headline change% reflects the actual
    // underlying. The pivots stay derived from the proxy (consistent with
    // the EMAs they sit alongside) and are documented via the proxyNote.
    if (cfg.yahooDaily && cfg.yahooDaily !== cfg.yahoo) {
      const livePrev = round(intra.meta.chartPreviousClose, 4);
      if (livePrev != null) item.prevClose = livePrev;
    }
  } else if (intra) {
    item.notes.push("Intraday bars too sparse for VWAP/profile");
  } else {
    item.notes.push("Intraday chart unavailable from Yahoo");
  }

  // ── Live TradingView override (Global / Commodities / ADRs / FX) ──
  // Replace Yahoo's ~15-min-delayed LTP with TV's near-real-time quote.
  // We only override the LIVE fields (ltp / change / changePercent /
  // prevClose / asOf) — the historical analytics (EMAs, 52w hi/lo,
  // pivots, OHLC for the day, VWAP, value area) all stay on Yahoo so
  // they remain on the same scale and reference frame as before.
  // change/changePercent get recomputed below from the TV-overridden
  // ltp + prevClose so they're internally consistent with the headline.
  if (tv) {
    item.ltp = round(tv.price, 4) ?? item.ltp;
    item.prevClose = round(tv.previousClose, 4) ?? item.prevClose;
    item.source = "tv";
    item.tvUpdateMode = tv.updateMode;
    item.asOf = tv.asOf;
    // Spot-vs-futures basis disclosure: when the TV ticker is a spot/CFD
    // feed (TVC:GOLD, TVC:SILVER) but Yahoo's history is the CME futures
    // contract, the LTP and the EMA/pivot levels live on slightly
    // different price bases. Tell the user honestly.
    if (cfg.tvSymbol === "TVC:GOLD" || cfg.tvSymbol === "TVC:SILVER") {
      item.notes.push("LTP is TradingView spot; EMAs / pivots are Yahoo futures (small basis gap)");
    }
  }

  // ── Live Kite override (Indian indices) ───────────────────────────
  if (kite) {
    item.ltp           = round(kite.price, 4);
    item.open          = round(kite.open,  4) ?? item.open;
    item.high          = round(kite.high,  4) ?? item.high;
    item.low           = round(kite.low,   4) ?? item.low;
    item.prevClose     = round(kite.previousClose, 4) ?? item.prevClose;
    item.source        = "kite";
    item.asOf          = kite.asOf;
  }

  // ── Derived: change vs prev close ─────────────────────────────────
  if (item.ltp != null && item.prevClose != null && item.prevClose > 0) {
    const ch  = item.ltp - item.prevClose;
    const pct = (ch / item.prevClose) * 100;
    item.change = round(ch, 4);
    item.changePercent = round(pct, 3);
  }

  return item;
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Public API                                                          */
/* ─────────────────────────────────────────────────────────────────── */

let cache: { ts: number; snap: IndicesBoardSnapshot } | null = null;
const TTL_MS = 10_000;

export async function getIndicesBoard(opts: { force?: boolean } = {}): Promise<IndicesBoardSnapshot> {
  if (!opts.force && cache && Date.now() - cache.ts < TTL_MS) return cache.snap;

  // Fetch the live overlays in parallel:
  //   - Kite batch (Indian indices, when a session is alive)
  //   - TradingView batch (everything else with a tvSymbol set)
  // Both are best-effort: a failure leaves the corresponding rows on
  // Yahoo with the "DELAYED" label rather than poisoning the whole board.
  const tvTickers = INSTRUMENTS.map(c => c.tvSymbol).filter((s): s is string => !!s);
  // Hard-cap each overlay source so a single hung HTTP socket cannot keep the
  // whole board in a "Loading…" state forever (T008). Yahoo helpers already
  // self-timeout at 6s; Kite + TradingView did not, hence this guard.
  const OVERLAY_TIMEOUT_MS = 8_000;
  // NB: clear the timer once the underlying promise settles so we don't log a
  // spurious "overlay source timeout" on every fast/successful response and
  // don't leave dangling timers under load.
  const withDeadline = <T,>(op: string, p: Promise<T>, fallback: T): Promise<T> =>
    new Promise<T>(resolve => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        logger.warn({ op, ms: OVERLAY_TIMEOUT_MS }, "indicesBoard: overlay source timeout; using fallback");
        resolve(fallback);
      }, OVERLAY_TIMEOUT_MS);
      p.then(
        v => { if (settled) return; settled = true; clearTimeout(timer); resolve(v); },
        err => { if (settled) return; settled = true; clearTimeout(timer); throw err; },
      ).catch(err => {
        // Re-throw asynchronously so the outer .catch() on Promise.all sees it.
        if (!settled) { settled = true; clearTimeout(timer); }
        Promise.reject(err);
      });
    });
  const [kiteMap, tvMap] = await Promise.all([
    withDeadline("kiteIndexQuotes", getKiteIndexQuotes(), null as Map<string, KiteIndexQuote> | null).catch(err => {
      logger.warn({ err: (err as Error).message }, "indicesBoard: Kite batch failed; falling back to Yahoo");
      return null;
    }),
    withDeadline("tvQuotes", getTvQuotes(tvTickers), new Map()).catch(err => {
      logger.warn({ err: (err as Error).message }, "indicesBoard: TradingView batch failed; falling back to Yahoo");
      return new Map();
    }),
  ]);

  // Fan out one daily + one intraday call per instrument in parallel. The
  // Yahoo helpers are already wrapped in 6s hard timeouts, so a single
  // dead ticker can't hold the whole board.
  const items = await Promise.all(INSTRUMENTS.map(async cfg => {
    const dailyTicker = cfg.yahooDaily ?? cfg.yahoo;
    // Intraday: prefer Kite when the symbol is in the Indian-index basket
    // (zero delay vs Yahoo's ~15-min lag); otherwise Yahoo (covers global
    // benchmarks and commodities Kite doesn't carry). Daily 1y stays on
    // Yahoo for everyone — Kite's daily series only goes back ~60 days.
    const intradayKite = hasKiteIntradayCoverage(cfg.yahoo)
      ? fetchKiteIntraday(cfg.yahoo, "5minute", 1).catch(() => null)
      : Promise.resolve(null);
    // INDIA category cfg.yahoo entries are NSE-style bare symbols (or already
    // fully-qualified ".NS") — `fetchChart` correctly applies the rename map +
    // ".NS" suffix. Every other category (GLOBAL, COMMODITY, ADR, FX) ships
    // an already-qualified Yahoo ticker (^GSPC, GC=F, INR=X, HDB, MMYT,
    // 000001.SS, DX-Y.NYB). Routing those through `fetchChart` blindly
    // appends ".NS" → "HDB.NS", "DX-Y.NYB.NS", etc., which Yahoo doesn't
    // recognise and answers with "delisted". Use the raw path for them.
    const dailyPromise = cfg.category === "INDIA"
      ? fetchChart(dailyTicker, "1y", "1d").catch(() => null)
      : fetchChartRaw(dailyTicker, "1y", "1d").catch(() => null);
    const [daily, intraK] = await Promise.all([
      dailyPromise,
      intradayKite,
    ]);
    const intra = intraK && intraK.close.length >= 4
      ? intraK
      : await fetchIntraday(cfg.yahoo, "5m", "1d").catch(() => null);
    const kite = cfg.kiteYahooKey && kiteMap ? kiteMap.get(cfg.kiteYahooKey) : undefined;
    const tv = cfg.tvSymbol ? tvMap.get(cfg.tvSymbol) : undefined;
    const row = buildItem(cfg, daily, intra, tv, kite);
    if (cfg.proxyNote && cfg.yahooDaily && cfg.yahooDaily !== cfg.yahoo) {
      row.notes.push(cfg.proxyNote);
    }
    return row;
  }));

  // GIFT NIFTY — fetched from TradingView (NSEIX:NIFTY1!) since Yahoo
  // does not carry it. Injected here as a regular GLOBAL row so the
  // Markets-board UI shows it identically to the Yahoo-backed entries.
  // If the source is unavailable the row is OMITTED — never substituted
  // with NIFTY 50 cash spot, which would mislabel a Friday-cash close as
  // an overnight pre-open print and invert the sign.
  try {
    const g = await getGiftNifty();
    if (g) {
      const giftItem: IndexBoardItem = {
        key: "GIFTNIFTY",
        name: "GIFT NIFTY",
        category: "GLOBAL",
        yahooSymbol: "NSEIX:NIFTY1!",
        currency: "₹",
        source: "tv", // TradingView · NSEIX:NIFTY1! — same provenance as the
                      // generalised tvQuotes path; pill freshness is driven
                      // by the real update_mode below, never hardcoded.
        tvUpdateMode: g.updateMode,
        asOf: g.asOf,
        ltp: g.price,
        prevClose: g.previousClose,
        change: g.change,
        changePercent: g.changePercent,
        support: [],
        resistance: [],
        notes: ["Source: TradingView · NSEIX:NIFTY1! (NSE-IX front-month future)"],
      };
      // Place GIFT NIFTY as the FIRST GLOBAL entry (most direct pre-open signal).
      const firstGlobalIdx = items.findIndex(i => i.category === "GLOBAL");
      if (firstGlobalIdx >= 0) items.splice(firstGlobalIdx, 0, giftItem);
      else items.push(giftItem);
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "indicesBoard: GIFT NIFTY fetch failed; row omitted");
  }

  const snap: IndicesBoardSnapshot = {
    items,
    lastUpdated: new Date().toISOString(),
    kiteAuthenticated: kiteMap != null,
  };
  cache = { ts: Date.now(), snap };
  return snap;
}
