/**
 * NSE Option Chain fetcher.
 *
 * NSE blocks bare GETs to its public API endpoints with a 401/403 unless the
 * request comes with the same set of cookies that nseindia.com sets when you
 * load the option-chain page in a browser. We mimic that "warm-up" by first
 * GET-ing the option-chain HTML (collecting Set-Cookie headers), then re-using
 * those cookies for all subsequent /api/option-chain-* calls. The cookie jar
 * is refreshed every 25 minutes (NSE cookies live ~30 min).
 */

import { logger } from "./logger";
import { fetchKiteOptionChain } from "./kiteOptionChain";
import { getKiteIndexQuotes } from "./kiteIndexQuotes";
import { getLiveQuote } from "./kiteFeed";
import { priceAndGreeks, yearsToExpiry } from "./blackScholes";
import { computeMaxPainStrike } from "./optionAnalytics";

// Indian risk-free rate proxy (10Y G-sec yield, refreshed quarterly).
const RISK_FREE_RATE = 0.0675;

const NSE_BASE = "https://www.nseindia.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) " +
  "Version/17.0 Safari/605.1.15";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  Referer: `${NSE_BASE}/option-chain`,
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  Connection: "keep-alive",
};

interface CookieJar { cookies: string; ts: number }
let jar: CookieJar | null = null;
const JAR_TTL_MS = 25 * 60 * 1000;
const FETCH_TIMEOUT_MS = 7000;

async function refreshJar(): Promise<CookieJar | null> {
  try {
    // Hit a few HTML pages to get all the cookies NSE expects.
    const cookies: string[] = [];
    for (const path of ["/", "/option-chain", "/get-quotes/equity?symbol=RELIANCE"]) {
      const r = await fetch(NSE_BASE + path, {
        method: "GET",
        headers: { ...BROWSER_HEADERS, Accept: "text/html" },
        redirect: "follow",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const setCookies = (r.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
      for (const sc of setCookies) {
        const kv = sc.split(";", 1)[0];
        if (kv) cookies.push(kv);
      }
    }
    if (cookies.length === 0) {
      logger.warn("NSE jar refresh: no cookies returned");
      return null;
    }
    // Dedupe by cookie name, keep latest occurrence
    const map = new Map<string, string>();
    for (const c of cookies) {
      const idx = c.indexOf("=");
      if (idx > 0) map.set(c.slice(0, idx), c);
    }
    return { cookies: Array.from(map.values()).join("; "), ts: Date.now() };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "NSE jar refresh failed");
    return null;
  }
}

async function nseFetch(path: string): Promise<unknown | null> {
  if (!jar || Date.now() - jar.ts > JAR_TTL_MS) {
    jar = await refreshJar();
    if (!jar) return null;
  }
  try {
    const r = await fetch(NSE_BASE + path, {
      headers: { ...BROWSER_HEADERS, Cookie: jar.cookies },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (r.status === 401 || r.status === 403) {
      // Cookies expired mid-flight; force one retry with fresh jar
      jar = await refreshJar();
      if (!jar) return null;
      const r2 = await fetch(NSE_BASE + path, {
        headers: { ...BROWSER_HEADERS, Cookie: jar.cookies },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!r2.ok) return null;
      return await r2.json();
    }
    if (!r.ok) return null;
    return await r.json();
  } catch (err) {
    logger.warn({ err: (err as Error).message, path }, "NSE fetch failed");
    return null;
  }
}

// ─── Public types (mirror openapi.yaml) ──────────────────────────────────
export interface OcSide {
  oi?: number; chgOi?: number; oiChgPct?: number | null;
  volume?: number; volOiRatio?: number | null;
  iv?: number;
  ltp?: number; ltpChgPct?: number | null;
  /** Absolute LTP change vs prev close (₹). Null when prev close unavailable
   *  (NSE-direct path doesn't return per-leg prev close). */
  ltpChange?: number | null;
  /** Per-leg OHLC for the current session. Populated from Kite's per-instrument
   *  `ohlc` block. Null/undefined from the NSE-direct path (NSE doesn't
   *  return per-leg session OHLC). */
  open?: number | null;
  high?: number | null;
  low?: number | null;
  bid?: number; ask?: number; bidQty?: number; askQty?: number;
  delta?: number; theta?: number; gamma?: number; vega?: number;
  intrinsic?: number; intrinsicPct?: number | null; timeValue?: number;
  moneyness?: "ITM" | "ATM" | "OTM";
  oiBuildup?: "LONG_BUILDUP" | "SHORT_BUILDUP" | "LONG_UNWINDING" | "SHORT_COVERING" | "NEUTRAL";
}
export interface OcRow {
  strike: number;
  ce?: OcSide;
  pe?: OcSide;
  pcrOi?: number | null;
  pcrVol?: number | null;
  isMaxPain?: boolean;
}
/**
 * Spot provenance — describes where the underlying spot price came from.
 *
 * IMPORTANT: `spotTrusted: true` means the spot is real-time and from an
 * approved source (Kite or NSE-direct). It does NOT mean the spot is
 * approved for F&O signal generation, paper-trade decisions, or risk sizing.
 * Those paths remain Kite-only (via kiteIndexQuotes / kiteIntraday) and
 * are not affected by this field.
 */
export type OcSpotSource = "kite" | "nse" | "unavailable";

/** Source provenance for the nearest-month future price. */
export type OcFutureSource = "kite" | "unavailable";

export interface OcResponse {
  underlying: string;
  underlyingName: string;
  kind: "INDEX" | "EQUITY";
  spot: number;
  prevClose: number;
  changePercent: number;
  expiry: string;
  expiries: string[];
  atmStrike: number;
  strikeStep: number;
  lotSize?: number;
  maxPainStrike?: number | null;
  rows: OcRow[];
  source: string;
  generatedAt: string;
  /**
   * Where the underlying spot price originated.
   * - "kite": live Kite broker feed (trusted)
   * - "nse": NSE-direct option-chain underlyingValue (trusted for display)
   * - "unavailable": no trusted source online
   *
   * NOTE: spotTrusted means the display spot is real. It does NOT
   * grant permission for signal generation, paper-trade, or risk sizing.
   * Those remain Kite-only.
   */
  spotSource: OcSpotSource;
  /** True when spot is from a real-time trusted source (Kite or NSE). */
  spotTrusted: boolean;

  // ── Nearest-month futures (Sprint 3 — Phase B) ──────────────────────────
  /**
   * LTP of the nearest-month liquid FUT contract from Kite instrument master.
   * Null when Kite is unavailable or no FUT contract found for this underlying.
   * NOT a synthetic/modelled value — this is a real exchange-traded price.
   *
   * Source: same underlying, current nearest-month FUT, same-exchange only.
   * NOT approved: weekly mini-futures, Yahoo, unofficial synthetic.
   * NOT used for: paper-trade gate, F&O signal permission, risk sizing.
   */
  futurePrice?: number | null;
  /** Source provenance for the future price. */
  futureSource?: OcFutureSource;
  /** Expiry of the FUT contract used for `futurePrice`. */
  futureExpiry?: string | null;

  // ── Synthetic future (Sprint 3 — Phase B) ───────────────────────────────
  /**
   * Synthetic future price derived from put-call parity at the ATM strike:
   *   syntheticFuture = Strike + CE_LTP - PE_LTP
   *
   * MODELLED VALUE — labelled "SYNTH FUTURE · MODELLED" in UI.
   * Null when ATM CE or PE LTP is missing or zero.
   * NOT used for: paper-trade gate, F&O signal permission, risk sizing.
   */
  syntheticFuture?: number | null;
  /** Always true when syntheticFuture is non-null — marks this as a
   *  calculated value, not an exchange-provided price. */
  syntheticFutureModelled?: true;
}

/**
 * Derived per-side metrics that BOTH the NSE and Kite paths need to compute
 * once a leg is built. Strict no-synthetic-data policy:
 *   • `oiChgPct` returns null when the prior-day OI baseline (`oi - chgOi`)
 *     is non-positive (would be a divide-by-zero or sign-flipped baseline).
 *   • `volOiRatio` returns null when OI is zero/missing (cannot divide).
 *   • `intrinsicPct` returns null when LTP is zero (cannot divide).
 * Callers that have a real prev-close LTP also pass `prevCloseLtp` so we can
 * derive `ltpChgPct`; the NSE-direct path never has it (NSE doesn't return
 * prev-close per option leg) and leaves it undefined.
 */
export function deriveSideMetrics(side: OcSide, prevCloseLtp?: number): void {
  const oi = side.oi;
  const chgOi = side.chgOi;
  if (oi != null && chgOi != null) {
    const baseline = oi - chgOi;
    side.oiChgPct = baseline > 0 ? +((chgOi / baseline) * 100).toFixed(2) : null;
  } else {
    side.oiChgPct = null;
  }
  if (oi != null && oi > 0 && side.volume != null) {
    side.volOiRatio = +(side.volume / oi).toFixed(3);
  } else {
    side.volOiRatio = null;
  }
  if (side.intrinsic != null && side.ltp != null && side.ltp > 0) {
    side.intrinsicPct = +((side.intrinsic / side.ltp) * 100).toFixed(1);
  } else {
    side.intrinsicPct = null;
  }
  if (prevCloseLtp != null && prevCloseLtp > 0 && side.ltp != null) {
    side.ltpChgPct = +(((side.ltp - prevCloseLtp) / prevCloseLtp) * 100).toFixed(2);
  } else {
    side.ltpChgPct = null;
  }
}

/**
 * Final pass over a freshly-built chain: stamp per-strike PCR (OI + Volume),
 * compute Max-Pain once and tag both the row + the chain header. Mutates the
 * passed chain in place and returns it for chainability.
 */
export function finalizeChain(chain: OcResponse): OcResponse {
  for (const r of chain.rows) {
    const ceOi = r.ce?.oi ?? 0;
    const peOi = r.pe?.oi ?? 0;
    r.pcrOi = ceOi > 0 ? +(peOi / ceOi).toFixed(3) : null;
    const ceVol = r.ce?.volume ?? 0;
    const peVol = r.pe?.volume ?? 0;
    r.pcrVol = ceVol > 0 ? +(peVol / ceVol).toFixed(3) : null;
    r.isMaxPain = false;
  }
  if (chain.rows.length > 0) {
    const mp = computeMaxPainStrike(chain);
    chain.maxPainStrike = mp;
    const mpRow = chain.rows.find(r => r.strike === mp);
    if (mpRow) mpRow.isMaxPain = true;
  } else {
    chain.maxPainStrike = null;
  }
  return chain;
}

// NSE endpoint dispatch
const INDEX_SET = new Set(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50", "SENSEX", "BANKEX"]);

interface NseRecord {
  records: {
    expiryDates: string[];
    underlyingValue: number;
    data: NseRow[];
    timestamp?: string;
  };
  filtered?: { data: NseRow[] };
}
interface NseRow {
  strikePrice: number;
  expiryDate: string;
  CE?: NseLeg;
  PE?: NseLeg;
}
interface NseLeg {
  openInterest?: number;
  changeinOpenInterest?: number;
  totalTradedVolume?: number;
  impliedVolatility?: number;
  lastPrice?: number;
  bidQty?: number; bidprice?: number;
  askQty?: number; askPrice?: number;
  underlying?: string;
  identifier?: string;
}

const STRIKE_STEPS: Record<string, number> = {
  NIFTY: 50, BANKNIFTY: 100, FINNIFTY: 50, MIDCPNIFTY: 25,
  NIFTYNXT50: 100, SENSEX: 100, BANKEX: 100,
};
// NSE-direct lot sizes for indices. Kite path reads `lot_size` directly from
// the instruments dump (always current); these are the fallback used only
// when the Kite session is inactive AND we're hitting NSE from an Indian IP.
// Equity lots are not enumerated here — `chain.lotSize` will be `undefined`
// for stocks under the NSE-direct path, which collapses Strategies' per-lot
// rupee maths to per-share. That's a known fallback limitation; the Kite
// path (the primary source) handles all symbols correctly.
export const LOT_SIZES: Record<string, number> = {
  NIFTY: 75, BANKNIFTY: 30, FINNIFTY: 65, MIDCPNIFTY: 140,
  NIFTYNXT50: 25, SENSEX: 10, BANKEX: 15,
};

function normaliseExpiry(d: string): string {
  // NSE returns "26-Mar-2026" → ISO "2026-03-26"
  const m = d.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return d;
  const months: Record<string, string> = {
    Jan:"01",Feb:"02",Mar:"03",Apr:"04",May:"05",Jun:"06",
    Jul:"07",Aug:"08",Sep:"09",Oct:"10",Nov:"11",Dec:"12",
  };
  return `${m[3]}-${months[m[2]!] ?? "01"}-${m[1]}`;
}
function denormaliseExpiry(iso: string): string {
  // "2026-03-26" → "26-Mar-2026"
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const labels = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const monthIdx = parseInt(m[2]!, 10) - 1;
  return `${m[3]}-${labels[monthIdx] ?? "Jan"}-${m[1]}`;
}

function classifyMoneyness(strike: number, spot: number, type: "CE" | "PE", step: number): "ITM" | "ATM" | "OTM" {
  if (Math.abs(strike - spot) <= step / 2) return "ATM";
  if (type === "CE") return strike < spot ? "ITM" : "OTM";
  return strike > spot ? "ITM" : "OTM";
}
function classifyOiBuildup(priceChg: number, oiChg: number): OcSide["oiBuildup"] {
  // Standard Indian-market convention:
  //   price ↑ + OI ↑ = LONG BUILDUP
  //   price ↓ + OI ↑ = SHORT BUILDUP
  //   price ↑ + OI ↓ = SHORT COVERING
  //   price ↓ + OI ↓ = LONG UNWINDING
  const pUp = priceChg > 0, oUp = oiChg > 0;
  if (pUp && oUp) return "LONG_BUILDUP";
  if (!pUp && oUp) return "SHORT_BUILDUP";
  if (pUp && !oUp) return "SHORT_COVERING";
  if (!pUp && !oUp && (priceChg !== 0 || oiChg !== 0)) return "LONG_UNWINDING";
  return "NEUTRAL";
}

interface CachedChain { ts: number; data: OcResponse }
const chainCache = new Map<string, CachedChain>();
const CHAIN_TTL = 30 * 1000; // 30 sec — NSE updates option chain every 3 minutes during open hours

export function isFnoUnderlying(sym: string): boolean {
  // Indices always F&O
  if (INDEX_SET.has(sym.toUpperCase())) return true;
  // Equity F&O list — keep this minimal but accurate. NSE has ~190 names; the
  // chain endpoint returns 404 for non-F&O symbols which we surface to the
  // caller anyway, so an exact list isn't critical.
  return EQUITY_FNO_SET.has(sym.toUpperCase());
}

// Curated NSE Equity F&O list (Apr 2026 — top names by OI).
const EQUITY_FNO_SET = new Set<string>([
  "RELIANCE","TCS","HDFCBANK","ICICIBANK","INFY","SBIN","BHARTIARTL","ITC","HINDUNILVR","KOTAKBANK",
  "LT","AXISBANK","MARUTI","SUNPHARMA","TITAN","BAJFINANCE","NTPC","ULTRACEMCO","HCLTECH","ASIANPAINT",
  "WIPRO","NESTLEIND","M&M","POWERGRID","TATASTEEL","TECHM","JSWSTEEL","INDUSINDBK","BAJAJFINSV","HDFCLIFE",
  "DRREDDY","CIPLA","COALINDIA","BPCL","HEROMOTOCO","TMPV","BRITANNIA","SHRIRAMFIN","SBILIFE","EICHERMOT",
  "ONGC","GRASIM","BAJAJ-AUTO","ADANIPORTS","ADANIENT","HINDALCO","APOLLOHOSP","TATACONSUM","TRENT","JIOFIN",
  "TATAMOTORS","DIVISLAB","DLF","ADANIGREEN","ADANIPOWER","TATAPOWER","HAVELLS","SIEMENS","CHOLAFIN","DMART",
  "GODREJCP","DABUR","COLPAL","MARICO","PIDILITIND","ICICIPRULI","ICICIGI","LICI","BEL","HAL",
  "AMBUJACEM","ACC","DALBHARAT","MUTHOOTFIN","HDFCAMC","BERGEPAINT","BIOCON","LUPIN","TORNTPHARM","ZYDUSLIFE",
  "AUROPHARMA","ALKEM","GLENMARK","SRF","UPL","PIIND","COROMANDEL","DEEPAKNTR","FLUOROCHEM","INDIGO",
  "IRCTC","NAUKRI","ZOMATO","NYKAA","PAYTM","POLICYBZR","DIXON","KPITTECH","MPHASIS","COFORGE",
  "PERSISTENT","LTIM","TIINDIA","BHEL","CUMMINSIND","BHARATFORG","CONCOR","ABB","BOSCHLTD","TVSMOTOR",
  "ASHOKLEY","MOTHERSON","BALKRISIND","ESCORTS","EXIDEIND","MRF","APOLLOTYRE","IDFCFIRSTB","FEDERALBNK","BANKBARODA",
  "PNB","CANBK","AUBANK","BANDHANBNK","RBLBANK","IDEA","INDUSTOWER","RECLTD","PFC","IRFC",
  "SBICARD","CHAMBLFERT","GNFC","MCX","ANGELONE","CDSL","BSOFT","NAVINFLUOR","ASTRAL","POLYCAB",
  "VBL","TATACOMM","UNITDSPR","JUBLFOOD","PAGEIND","HINDPETRO","IOC","GAIL","PETRONET","IGL",
  "GUJGASLTD","MGL","NMDC","JINDALSTEL","SAIL","NATIONALUM","HINDCOPPER","VEDL","GMRINFRA","MAZDOCK",
  "OFSS","MFSL","RAMCOCEM","VOLTAS","BLUESTARCO","BATAINDIA","TRIDENT","RAJESHEXPO","ABFRL","ABCAPITAL",
  "OBEROIRLTY","PRESTIGE","PHOENIXLTD","GODREJPROP","TATAELXSI","CYIENT","INDHOTEL","JUBLPHARMA","LAURUSLABS","SYNGENE",
  "POONAWALLA","M&MFIN","BAJAJHLDNG","ADANIENSOL","JSWENERGY","TATAPOWER","NHPC","TVSMOTOR","CGPOWER","MAXHEALTH",
  "FORTIS","SHREECEM","JKCEMENT","SUNDRMFAST","TIINDIA","SONACOMS","KEI","ICICIPRULI","SUPREMEIND","HONAUT",
]);

export async function fetchOptionChain(underlying: string, expiryFilter?: string): Promise<OcResponse | null> {
  const sym = underlying.toUpperCase();
  const cacheKey = `${sym}:${expiryFilter ?? "_"}`;
  const cached = chainCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CHAIN_TTL) return cached.data;

  const isIndex = INDEX_SET.has(sym);

  // ── Source 1: Kite Connect (works from any IP if user has authenticated) ──
  try {
    const kiteResult = await fetchKiteOptionChain(sym, expiryFilter);
    if (kiteResult) {
      // Kite path — spot is from Kite broker feed.
      kiteResult.spotSource = "kite";
      kiteResult.spotTrusted = true;
      chainCache.set(cacheKey, { data: kiteResult, ts: Date.now() });
      return kiteResult;
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message, sym }, "Kite option-chain attempt failed; falling back to NSE");
  }

  // ── Source 2: NSE direct (works from Indian IPs) ──
  const path = isIndex
    ? `/api/option-chain-indices?symbol=${encodeURIComponent(sym)}`
    : `/api/option-chain-equities?symbol=${encodeURIComponent(sym)}`;

  const json = (await nseFetch(path)) as NseRecord | null;
  if (!json?.records?.expiryDates?.length) {
    // Empty `{}` body is NSE's geo-fence response from non-Indian IPs.
    // Distinguishing it from "not in F&O list" is impossible without a probe,
    // so surface both possibilities to the caller.
    logger.warn({ sym, isIndex, gotKeys: json ? Object.keys(json) : null }, "NSE option chain unavailable (empty response)");
    return null;
  }

  const expiriesIso = json.records.expiryDates.map(normaliseExpiry).sort();
  // Pick the requested expiry (must match an available one) or nearest
  const activeIso = expiryFilter && expiriesIso.includes(expiryFilter) ? expiryFilter : expiriesIso[0]!;
  const activeRaw = denormaliseExpiry(activeIso);

  const spot = json.records.underlyingValue;
  const step = isIndex
    ? STRIKE_STEPS[sym] ?? 50
    : inferEquityStep(json.records.data, spot);
  const atmStrike = Math.round(spot / step) * step;

  const filtered = json.records.data.filter(d => d.expiryDate === activeRaw);
  const T = yearsToExpiry(activeRaw);
  const byStrike = new Map<number, OcRow>();
  for (const d of filtered) {
    const row: OcRow = byStrike.get(d.strikePrice) ?? { strike: d.strikePrice };
    if (d.CE) row.ce = mapLeg(d.CE, d.strikePrice, spot, step, "CE", T);
    if (d.PE) row.pe = mapLeg(d.PE, d.strikePrice, spot, step, "PE", T);
    byStrike.set(d.strikePrice, row);
  }
  const allRows = Array.from(byStrike.values()).sort((a, b) => a.strike - b.strike);

  const prevClose = spot / (1 + 0); // NSE doesn't return prev close on this endpoint; default to spot
  const changePercent = 0;

  const data: OcResponse = {
    underlying: sym,
    underlyingName: sym,
    kind: isIndex ? "INDEX" : "EQUITY",
    spot,
    prevClose,
    changePercent,
    expiry: activeIso,
    expiries: expiriesIso,
    atmStrike,
    strikeStep: step,
    lotSize: LOT_SIZES[sym],
    rows: allRows,
    source: "NSE",
    generatedAt: new Date().toISOString(),
    // NSE-direct: spot is from NSE underlyingValue field — real-time during market.
    // Trusted for display. NOT for signal generation or paper-trade decisions.
    spotSource: "nse",
    spotTrusted: true,
  };
  finalizeChain(data);
  chainCache.set(cacheKey, { ts: Date.now(), data });
  return data;
}

function mapLeg(leg: NseLeg, strike: number, spot: number, step: number, type: "CE" | "PE", T: number): OcSide {
  const ltp = leg.lastPrice ?? 0;
  const oi = leg.openInterest ?? 0;
  const oiChg = leg.changeinOpenInterest ?? 0;
  const intrinsic = type === "CE" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  const timeValue = Math.max(0, ltp - intrinsic);

  // Greeks via Black-Scholes when we have IV and a positive expiry. NSE quotes
  // IV in % (e.g. 18.5 for 18.5%) so we divide by 100 for the model.
  const ivPct = leg.impliedVolatility;
  let delta: number | undefined, gamma: number | undefined, theta: number | undefined, vega: number | undefined;
  if (ivPct && ivPct > 0 && spot > 0 && T > 0) {
    const g = priceAndGreeks({
      S: spot, K: strike, T, r: RISK_FREE_RATE, q: 0,
      sigma: ivPct / 100, type,
    });
    delta = +g.delta.toFixed(4);
    gamma = +g.gamma.toFixed(6);
    theta = +g.theta.toFixed(3);
    vega  = +g.vega.toFixed(3);
  }

  const side: OcSide = {
    oi,
    chgOi: oiChg,
    volume: leg.totalTradedVolume ?? 0,
    iv: ivPct,
    ltp,
    bid: leg.bidprice,
    ask: leg.askPrice,
    bidQty: leg.bidQty,
    askQty: leg.askQty,
    delta, gamma, theta, vega,
    intrinsic: +intrinsic.toFixed(2),
    timeValue: +timeValue.toFixed(2),
    moneyness: classifyMoneyness(strike, spot, type, step),
    // NSE doesn't surface premium-change directly, so use OI direction relative to recent flow.
    // Refined classification using both Δprice and ΔOI happens in optionAnalytics for top strikes;
    // per-strike here uses ΔOI vs. spot-vs-strike heuristic.
    oiBuildup: classifyOiBuildup(type === "CE" ? spot - strike : strike - spot, oiChg),
  };
  // NSE-direct path: prev-close LTP per option leg is NOT in the response, so
  // `ltpChgPct` stays undefined (the helper writes null when no baseline is
  // passed). Kite path passes its own `q.ohlc.close`.
  deriveSideMetrics(side);
  return side;
}

function inferEquityStep(rows: NseRow[], spot: number): number {
  // Equity strike steps vary (₹2.5 for Bata, ₹100 for MRF). Infer from
  // consecutive strike differences near spot.
  const strikes = Array.from(new Set(rows.map(r => r.strikePrice))).sort((a, b) => a - b);
  if (strikes.length < 2) return 5;
  const diffs: number[] = [];
  for (let i = 1; i < strikes.length; i++) {
    const d = strikes[i]! - strikes[i - 1]!;
    if (d > 0) diffs.push(d);
  }
  if (diffs.length === 0) return 5;
  diffs.sort((a, b) => a - b);
  // Use the median diff between strikes near spot as the step
  return diffs[Math.floor(diffs.length / 2)]!;
}

/**
 * Fetch a trusted spot price for a symbol. Kite-only.
 *
 * Sources checked in order:
 *   1. Kite index quotes (for indices: NIFTY, BANKNIFTY, etc.)
 *   2. Kite live tick feed (for equities via getLiveQuote)
 *
 * Returns null when no trusted source is available.
 * NO Yahoo fallback. NO synthetic spot.
 *
 * NOTE: This spot is for option-chain display/warmup only.
 * F&O signal generation and paper-trade decisions use
 * kiteIndexQuotes / kiteIntraday directly — not this helper.
 */
export async function getSpotForUnderlying(symbol: string): Promise<{ price: number; source: OcSpotSource } | null> {
  const sym = symbol.toUpperCase();

  // 1. Kite index quotes batch (indices)
  const KITE_LTP_KEY: Record<string, string> = {
    NIFTY:      "^NSEI",
    BANKNIFTY:  "^NSEBANK",
    FINNIFTY:   "NIFTY_FIN_SERVICE.NS",
    MIDCPNIFTY: "NIFTY_MID_SELECT.NS",
    SENSEX:     "^BSESN",
    BANKEX:     "BSE-BANK.BO",
  };
  const ltpKey = KITE_LTP_KEY[sym];
  if (ltpKey) {
    try {
      const map = await getKiteIndexQuotes();
      const live = map?.get(ltpKey);
      if (live && Number.isFinite(live.price) && live.price > 0) {
        return { price: live.price, source: "kite" };
      }
    } catch {
      logger.debug({ sym }, "Kite index quote unavailable for spot lookup");
    }
  }

  // 2. Kite live tick feed (equities subscribed via WebSocket)
  const tick = getLiveQuote(sym);
  if (tick && Number.isFinite(tick.ltp) && tick.ltp > 0) {
    return { price: tick.ltp, source: "kite" };
  }

  // No trusted source available — return null, NO Yahoo fallback.
  logger.info(
    { sym },
    "getSpotForUnderlying: no trusted spot source available (Kite offline or symbol not subscribed)",
  );
  return null;
}
