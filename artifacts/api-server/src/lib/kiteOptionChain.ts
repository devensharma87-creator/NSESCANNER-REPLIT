/**
 * Kite Connect option-chain fallback.
 *
 * NSE's public option-chain API is geo-restricted and silently returns an empty
 * `{}` body to non-Indian cloud IPs (Replit / Vercel / Cloudflare workers / etc).
 * The Zerodha Kite Connect REST API is not geo-restricted: once the user has an
 * active session, we can reconstruct the same option chain from:
 *   1. `kc.getInstruments("NFO")`  →  the F&O instruments dump (refreshed daily)
 *   2. `kc.getQuote([...tokens])`  →  per-leg OI, ChgOI, Volume, IV, LTP, depth
 *
 * Output format mirrors `OcResponse` from optionChain.ts so the route handler
 * and frontend can consume both sources interchangeably.
 */

import { logger } from "./logger";
import { getRestClient } from "./kiteAuth";
import type { OcResponse, OcRow, OcSide } from "./optionChain";
import { deriveSideMetrics, finalizeChain } from "./optionChain";
import { priceAndGreeks, impliedVolatility, yearsToExpiry } from "./blackScholes";
import { loadFnoInstruments, isFnoInstrumentsCacheReady, type FnoInstrument } from "./kiteFnoInstruments";

const RISK_FREE_RATE = 0.0675;

type KiteInstrument = FnoInstrument & { instrument_type: "CE" | "PE" | "FUT" | "EQ" };

interface KiteQuote {
  instrument_token: number;
  last_price: number;
  volume?: number;
  oi?: number;
  oi_day_high?: number;
  oi_day_low?: number;
  net_change?: number;
  ohlc?: { open: number; high: number; low: number; close: number };
  depth?: {
    buy?: Array<{ price: number; quantity: number; orders: number }>;
    sell?: Array<{ price: number; quantity: number; orders: number }>;
  };
  // Kite quote includes oi but NOT IV — we approximate IV from premium below
}

// Per-underlying chain cache (15 seconds — same as NSE-side cache)
interface ChainCache { data: OcResponse; ts: number }
const chainCache = new Map<string, ChainCache>();
const CHAIN_TTL = 15_000;

const STRIKE_STEPS: Record<string, number> = {
  NIFTY: 50, BANKNIFTY: 100, FINNIFTY: 50, MIDCPNIFTY: 25, NIFTYNXT50: 100,
  SENSEX: 100, BANKEX: 100,
};

function inferStrikeStep(strikes: number[]): number {
  if (strikes.length < 2) return 50;
  const sorted = [...new Set(strikes)].sort((a, b) => a - b);
  let minDiff = Infinity;
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i]! - sorted[i - 1]!;
    if (d > 0 && d < minDiff) minDiff = d;
  }
  return Number.isFinite(minDiff) ? minDiff : 50;
}

function classifyMoneyness(strike: number, spot: number, type: "CE" | "PE", step: number): "ITM" | "ATM" | "OTM" {
  if (Math.abs(strike - spot) <= step / 2) return "ATM";
  if (type === "CE") return strike < spot ? "ITM" : "OTM";
  return strike > spot ? "ITM" : "OTM";
}

/** Classify a leg's OI buildup using both price-change and OI-change signs.
 *  Returns NEUTRAL when either signal sits inside its dead-band — no fresh
 *  positions = no buildup, regardless of the other dimension's drift. The
 *  Heatmap and OI Insights surfaces both rely on this returning all 5
 *  buckets (incl. NEUTRAL) so callers can trust the tag without re-deriving. */
function classifyOiBuildup(priceChg: number, oiChg: number): OcSide["oiBuildup"] {
  const PRICE_DEAD = 0.0001; // ₹0.0001 — any FP wobble below this is noise
  const OI_DEAD    = 1;      // 1 contract — anything below is rounding
  if (Math.abs(priceChg) < PRICE_DEAD || Math.abs(oiChg) < OI_DEAD) return "NEUTRAL";
  const pUp = priceChg > 0, oUp = oiChg > 0;
  if (pUp && oUp) return "LONG_BUILDUP";
  if (!pUp && oUp) return "SHORT_BUILDUP";
  if (pUp && !oUp) return "SHORT_COVERING";
  return "LONG_UNWINDING";
}

function expiryISO(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  if (!dt || Number.isNaN(dt.getTime())) return "";
  return dt.toISOString().slice(0, 10);
}

// Underlying → Kite spot tradingsymbol mapping.
// NSE indices use the index name on `NSE` (e.g. NSE:NIFTY 50 / NSE:NIFTY BANK).
// BSE indices use the index name on `BSE` (e.g. BSE:SENSEX / BSE:BANKEX).
// Equities use the regular tradingsymbol on `NSE`.
const INDEX_SPOT_MAP: Record<string, string> = {
  NIFTY:      "NSE:NIFTY 50",
  BANKNIFTY:  "NSE:NIFTY BANK",
  FINNIFTY:   "NSE:NIFTY FIN SERVICE",
  MIDCPNIFTY: "NSE:NIFTY MID SELECT",
  NIFTYNXT50: "NSE:NIFTY NEXT 50",
  SENSEX:     "BSE:SENSEX",
  BANKEX:     "BSE:BANKEX",
};

function spotKey(underlying: string): string {
  return INDEX_SPOT_MAP[underlying] ?? `NSE:${underlying}`;
}

async function loadInstruments(kc: any): Promise<KiteInstrument[]> {
  return await loadFnoInstruments(kc) as KiteInstrument[];
}

/**
 * Fetch option chain via Kite. Returns null when no Kite session is active.
 * Throws if the call to Kite fails for any other reason.
 */
export async function fetchKiteOptionChain(
  underlying: string,
  expiryFilter?: string,
): Promise<OcResponse | null> {
  const sym = underlying.toUpperCase();
  const cacheKey = `${sym}:${expiryFilter ?? "_"}`;
  const cached = chainCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CHAIN_TTL) return cached.data;

  const client = await getRestClient();
  if (!client) return null;
  const { kc } = client;

  // 1. Filter F&O instruments for this underlying (option legs only)
  const all = await loadInstruments(kc);
  const legs = all.filter(
    i => i.name === sym && (i.instrument_type === "CE" || i.instrument_type === "PE"),
  );
  if (legs.length === 0) {
    logger.warn({ sym }, "Kite: no F&O legs found for underlying");
    return null;
  }

  // 2. Group expiries; pick the requested expiry or nearest-future
  const expiries = Array.from(new Set(legs.map(l => expiryISO(l.expiry))).values()).filter(Boolean).sort();
  const todayIso = new Date().toISOString().slice(0, 10);
  const futureExpiries = expiries.filter(e => e >= todayIso);
  const activeExpiry =
    expiryFilter && expiries.includes(expiryFilter) ? expiryFilter
    : (futureExpiries[0] ?? expiries[0]!);

  const activeLegs = legs.filter(l => expiryISO(l.expiry) === activeExpiry);
  if (activeLegs.length === 0) return null;

  // 3. Fetch live quote for the spot underlying + all legs.
  // Kite getQuote takes max ~500 instruments per call → batch.
  // SENSEX/BANKEX legs sit on BFO segment; everything else on NFO. Use the
  // segment that's actually present on the instrument row rather than
  // hard-coding NFO so the BFO-served chains are quoted correctly.
  const spotSym = spotKey(sym);
  const legSyms = activeLegs.map(l => `${l.exchange}:${l.tradingsymbol}`);
  const allSyms = [spotSym, ...legSyms];
  const BATCH = 400;
  const quoteMap = new Map<string, KiteQuote>();
  for (let i = 0; i < allSyms.length; i += BATCH) {
    const batch = allSyms.slice(i, i + BATCH);
    try {
      const q = (await kc.getQuote(batch)) as Record<string, KiteQuote>;
      for (const [k, v] of Object.entries(q)) quoteMap.set(k, v);
    } catch (err) {
      logger.warn({ err: (err as Error).message, batchStart: i }, "Kite getQuote batch failed");
      // Continue with what we have; partial chain is better than none
    }
  }

  const spotQ = quoteMap.get(spotSym);
  const spot = spotQ?.last_price ?? 0;
  const prevClose = spotQ?.ohlc?.close ?? spot;
  const changePct = prevClose > 0 ? ((spot - prevClose) / prevClose) * 100 : 0;

  if (!spot) {
    logger.warn({ sym, spotSym }, "Kite: spot quote missing");
    return null;
  }

  // 4. Build per-strike rows (CE + PE)
  // Kite quotes don't include IV, so we solve it from the market price using
  // Black-Scholes (Newton-Raphson + bisection fallback) and then use the same
  // model to derive Greeks. Time-to-expiry is computed once from the active
  // expiry — it's the same for every leg in this chain.
  const T = yearsToExpiry(activeExpiry);
  const strikeMap = new Map<number, OcRow>();
  for (const leg of activeLegs) {
    const q = quoteMap.get(`${leg.exchange}:${leg.tradingsymbol}`);
    if (!q) continue;

    // Defensive: a malformed broker payload could send NaN/Infinity for any of
    // these numerics. Coerce non-finite values to safe defaults so downstream
    // math (chgOi mapping, IV solver, Greeks) never propagates NaN to the UI.
    const ltp    = Number.isFinite(q.last_price) ? q.last_price : 0;
    const oi     = Number.isFinite(q.oi) ? q.oi : 0;
    const prevClose = q.ohlc?.close;
    const netChg = Number.isFinite(q.net_change) && q.net_change !== 0
      ? q.net_change!
      : (Number.isFinite(prevClose) && prevClose! > 0 ? ltp - prevClose! : 0);
    // Kite getQuote doesn't give us yesterday's close OI directly. We infer
    // today's OI change from the relationship between current OI and the
    // day's high/low OI range.
    //
    // Key insight: at market open (09:15 IST), the very first OI tick equals
    // the previous day's closing OI — no trades have happened yet. So:
    //   - If OI has been BUILDING (net new positions), oi_day_low stays near
    //     prevCloseOI and oiNow rises above it → chgOi = oiNow - oi_day_low.
    //   - If OI has been UNWINDING (positions released), oi_day_high stays near
    //     prevCloseOI and oiNow drops below it → chgOi = oiNow - oi_day_high.
    //
    // We use the midpoint of [oiLo, oiHi] as the decision boundary: OI above
    // midpoint implies net buildup (prevClose ≈ oiLo), below implies net
    // unwinding (prevClose ≈ oiHi). This is accurate for monotonic moves and
    // directionally correct for mixed sessions — a major improvement over the
    // prior midpoint-centering formula which systematically underestimated OI
    // changes by ~35% compared to exchange-reported deltas.
    const oiNow = oi ?? 0;
    const oiHi  = q.oi_day_high ?? oiNow;
    const oiLo  = q.oi_day_low  ?? oiNow;
    const oiRange = Math.max(0, oiHi - oiLo);
    let chgOi = 0;
    if (oiRange > 0 && oiNow > 0) {
      const midpoint = (oiHi + oiLo) / 2;
      if (oiNow >= midpoint) {
        chgOi = Math.round(oiNow - oiLo);
      } else {
        chgOi = Math.round(oiNow - oiHi);
      }
    }

    const optType = leg.instrument_type as "CE" | "PE";
    const intrinsic = optType === "CE"
      ? Math.max(0, spot - leg.strike)
      : Math.max(0, leg.strike - spot);
    const timeValue = Math.max(0, ltp - intrinsic);

    // Solve IV when we have a real bid+ask (or a non-zero LTP) and there's at
    // least some time-value left in the option. Deep-ITM legs and stale ticks
    // get null IV — we surface that to the UI rather than fabricate a number.
    let ivPct: number | undefined;
    let delta: number | undefined, gamma: number | undefined, theta: number | undefined, vega: number | undefined;
    if (ltp > 0 && T > 0 && timeValue > 0.05) {
      const sigma = impliedVolatility({
        S: spot, K: leg.strike, T, r: RISK_FREE_RATE, q: 0,
        type: optType, marketPrice: ltp,
      });
      if (sigma != null && sigma > 0 && sigma < 5) {
        ivPct = +(sigma * 100).toFixed(2);
        const g = priceAndGreeks({ S: spot, K: leg.strike, T, r: RISK_FREE_RATE, q: 0, sigma, type: optType });
        delta = +g.delta.toFixed(4);
        gamma = +g.gamma.toFixed(6);
        theta = +g.theta.toFixed(3);
        vega  = +g.vega.toFixed(3);
      }
    }
    // For deep-ITM legs without solvable IV, delta is essentially ±1 / 0 by
    // construction — surface that so the UI never renders a totally blank row.
    //
    // The threshold is a percentage of spot (5%), NOT an absolute strike count.
    // STRIKE_STEPS only has entries for indices; for high-priced stocks the
    // fallback `50` would mean 5 strikes ≈ ₹250 — which on a ₹100k stock is
    // 0.25% (almost ATM) and would aggressively misclassify slightly-OTM legs
    // as deep-OTM. Percentage-of-spot scales correctly across all underlyings.
    if (delta == null && T > 0) {
      const deepBand = spot * 0.05;
      if (optType === "CE") {
        delta = leg.strike < spot - deepBand ? 1
              : leg.strike > spot + deepBand ? 0
              : undefined;
      } else {
        delta = leg.strike > spot + deepBand ? -1
              : leg.strike < spot - deepBand ? 0
              : undefined;
      }
    }

    const side: OcSide = {
      oi: oi != null ? oi : undefined,
      chgOi,
      volume: q.volume,
      iv: ivPct,
      ltp,
      bid: q.depth?.buy?.[0]?.price,
      ask: q.depth?.sell?.[0]?.price,
      bidQty: q.depth?.buy?.[0]?.quantity,
      askQty: q.depth?.sell?.[0]?.quantity,
      delta, gamma, theta, vega,
      intrinsic,
      timeValue,
      moneyness: classifyMoneyness(leg.strike, spot, optType, STRIKE_STEPS[sym] ?? 50),
      oiBuildup: classifyOiBuildup(netChg, chgOi),
    };
    // Kite quote includes per-leg `ohlc.close` — yesterday's settlement of the
    // option contract itself. Pass it so `ltpChgPct` is a real day-over-day %
    // (vs the NSE-direct path where this baseline doesn't exist and the field
    // stays null).
    const prevCloseLtp = q.ohlc?.close;
    deriveSideMetrics(side, Number.isFinite(prevCloseLtp) ? prevCloseLtp : undefined);

    let row = strikeMap.get(leg.strike);
    if (!row) { row = { strike: leg.strike }; strikeMap.set(leg.strike, row); }
    if (optType === "CE") row.ce = side;
    else row.pe = side;
  }

  const rows = Array.from(strikeMap.values()).sort((a, b) => a.strike - b.strike);
  if (rows.length === 0) return null;

  const strikeStep = STRIKE_STEPS[sym] ?? inferStrikeStep(rows.map(r => r.strike));
  const atmStrike = rows.reduce((closest, r) =>
    Math.abs(r.strike - spot) < Math.abs(closest - spot) ? r.strike : closest,
    rows[0]!.strike,
  );
  const lotSize = activeLegs[0]?.lot_size;

  const isIndex = sym in INDEX_SPOT_MAP;
  const out: OcResponse = {
    underlying: sym,
    underlyingName: isIndex ? INDEX_SPOT_MAP[sym]!.replace(/^[A-Z]+:/, "") : sym,
    kind: isIndex ? "INDEX" : "EQUITY",
    spot,
    prevClose,
    changePercent: Number(changePct.toFixed(2)),
    expiry: activeExpiry,
    expiries,
    atmStrike,
    strikeStep,
    lotSize,
    rows,
    source: "kite",
    generatedAt: new Date().toISOString(),
  };

  // Stamp per-strike PCR (pcrOi/pcrVol), `isMaxPain` on the single max-pain
  // strike, and the top-level `maxPainStrike` pointer. Mirrors what the NSE
  // path does in `fetchOptionChain` so both sources hand the UI an identical
  // shape — without this, Kite-sourced chains would silently miss the MaxPain
  // marker and the per-strike PCR pill.
  finalizeChain(out);
  chainCache.set(cacheKey, { data: out, ts: Date.now() });
  return out;
}

export function isKiteOptionChainReady(): boolean {
  return isFnoInstrumentsCacheReady();
}
