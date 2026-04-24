/**
 * Black-Scholes-Merton pricing & Greeks for European options.
 *
 * All inputs in standard finance units:
 *   S    — spot
 *   K    — strike
 *   T    — time to expiry, in YEARS (decimal)
 *   r    — risk-free rate (decimal — e.g. 0.0675 for 6.75%)
 *   q    — continuous dividend yield (decimal). For Indian indices this is
 *          effectively zero; for individual equities pass dividendYield/100.
 *   sigma— annualised implied volatility (decimal — e.g. 0.18 for 18%)
 *
 * Greeks returned per-option (NOT per lot). Theta is per CALENDAR DAY
 * (not per year), which is the convention traders read on screens.
 *
 * The IV solver uses Newton-Raphson with a bisection fallback so it converges
 * for deep-ITM/OTM legs where vega → 0 and the Newton step diverges.
 */

const SQRT_2PI = Math.sqrt(2 * Math.PI);

/** Standard normal PDF. */
function pdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

/** Standard normal CDF — Abramowitz & Stegun 26.2.17 (≤7.5e-8 error). */
function cdf(x: number): number {
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1.0 / (1.0 + p * ax);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1.0 + sign * y);
}

export type OptionType = "CE" | "PE";

export interface BsInputs {
  S: number; K: number; T: number; r: number; q: number; sigma: number; type: OptionType;
}

export interface BsResult {
  price: number;
  delta: number;
  gamma: number;
  vega: number;     // per 1% change in IV (i.e. ∂price/∂σ * 0.01)
  theta: number;    // per CALENDAR day
  rho: number;      // per 1% change in r
}

/** Price + Greeks. Falls back to intrinsic when T or sigma collapses to ~0. */
export function priceAndGreeks(inp: BsInputs): BsResult {
  const { S, K, r, q, type } = inp;
  let { T, sigma } = inp;
  // Numerical floors — at expiry or with zero vol, BS degenerates to intrinsic.
  if (!Number.isFinite(T) || T <= 0) T = 1 / 365 / 24; // 1 hour
  if (!Number.isFinite(sigma) || sigma <= 0) sigma = 1e-6;

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;

  const Nd1 = cdf(d1), Nd2 = cdf(d2);
  const NMd1 = cdf(-d1), NMd2 = cdf(-d2);
  const eqT = Math.exp(-q * T), erT = Math.exp(-r * T);

  let price: number, delta: number, theta: number, rho: number;

  if (type === "CE") {
    price = S * eqT * Nd1 - K * erT * Nd2;
    delta = eqT * Nd1;
    theta = (-(S * eqT * pdf(d1) * sigma) / (2 * sqrtT)
             - r * K * erT * Nd2
             + q * S * eqT * Nd1) / 365;
    rho   = (K * T * erT * Nd2) / 100;
  } else {
    price = K * erT * NMd2 - S * eqT * NMd1;
    delta = -eqT * NMd1;
    theta = (-(S * eqT * pdf(d1) * sigma) / (2 * sqrtT)
             + r * K * erT * NMd2
             - q * S * eqT * NMd1) / 365;
    rho   = (-K * T * erT * NMd2) / 100;
  }

  const gamma = (eqT * pdf(d1)) / (S * sigma * sqrtT);
  const vega  = (S * eqT * pdf(d1) * sqrtT) / 100;

  return { price, delta, gamma, vega, theta, rho };
}

/** Just the price — convenience when Greeks aren't needed. */
export function bsPrice(inp: BsInputs): number {
  return priceAndGreeks(inp).price;
}

/**
 * Implied volatility from market price. Returns null if no sane root exists
 * (e.g. market price < intrinsic, which happens around stale ticks).
 */
export function impliedVolatility(args: {
  S: number; K: number; T: number; r: number; q: number; type: OptionType; marketPrice: number;
}): number | null {
  const { S, K, T, r, q, type, marketPrice } = args;
  const intrinsic = type === "CE" ? Math.max(0, S - K * Math.exp(-r * T)) : Math.max(0, K * Math.exp(-r * T) - S);
  if (marketPrice < intrinsic - 1e-4) return null;
  if (T <= 0) return null;

  // Newton-Raphson from a sane initial guess (Brenner-Subrahmanyam approx).
  let sigma = Math.max(0.05, Math.sqrt((2 * Math.PI) / T) * (marketPrice / S));
  for (let i = 0; i < 50; i++) {
    const { price, vega } = priceAndGreeks({ S, K, T, r, q, sigma, type });
    const diff = price - marketPrice;
    if (Math.abs(diff) < 1e-4) return sigma;
    if (vega < 1e-8) break; // Newton step would explode; bail to bisection.
    sigma = sigma - diff / (vega * 100);
    if (!Number.isFinite(sigma) || sigma <= 0 || sigma > 5) break;
  }

  // Bisection fallback over [0.01, 5.0] — guaranteed to converge if a root exists.
  let lo = 1e-4, hi = 5.0;
  const f = (s: number) => bsPrice({ S, K, T, r, q, sigma: s, type }) - marketPrice;
  let flo = f(lo), fhi = f(hi);
  if (flo * fhi > 0) return null;
  for (let i = 0; i < 100; i++) {
    const mid = 0.5 * (lo + hi);
    const fmid = f(mid);
    if (Math.abs(fmid) < 1e-4 || (hi - lo) < 1e-5) return mid;
    if (flo * fmid < 0) { hi = mid; fhi = fmid; }
    else                { lo = mid; flo = fmid; }
  }
  return 0.5 * (lo + hi);
}

/**
 * Years between `now` and an NSE expiry date string in DD-MMM-YYYY format
 * (e.g. "30-Apr-2026"). Expiry is assumed to settle at 15:30 IST.
 * Falls back to 1 day if the date can't be parsed (so Greeks remain finite).
 */
export function yearsToExpiry(expiry: string, now: Date = new Date()): number {
  const months: Record<string, number> = {
    JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
    JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
  };
  const dmy = expiry.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  const iso = expiry.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  let expiryUtcMs: number;
  if (dmy) {
    const day = Number(dmy[1]);
    const mon = months[dmy[2].toUpperCase()];
    const year = Number(dmy[3]);
    if (mon == null) return 1 / 365;
    // NSE settles at 15:30 IST == 10:00 UTC
    expiryUtcMs = Date.UTC(year, mon, day, 10, 0, 0);
  } else if (iso) {
    // ISO date-only — also enforce 15:30 IST settlement
    const year = Number(iso[1]);
    const mon  = Number(iso[2]) - 1;
    const day  = Number(iso[3]);
    expiryUtcMs = Date.UTC(year, mon, day, 10, 0, 0);
  } else {
    // Try full ISO datetime parse as a last resort
    const t = Date.parse(expiry);
    if (!Number.isFinite(t)) return 1 / 365;
    expiryUtcMs = t;
  }
  const diffMs = expiryUtcMs - now.getTime();
  if (diffMs <= 0) return 1 / 365 / 24; // 1 hour floor at/after expiry
  return diffMs / (365 * 24 * 60 * 60 * 1000);
}
