"""
================================================================
OPTIONS MATH — Black-Scholes pricing, Greeks, Payoff
================================================================
Pure-Python options math. No external deps beyond numpy/scipy stats.
Designed for Indian index options (NIFTY/BANKNIFTY/FINNIFTY) but
works for any European-style option.

Why Black-Scholes when we have live LTPs?
    Live LTPs give us the current premium. Black-Scholes gives us:
      - Greeks (Delta, Gamma, Theta, Vega) for risk
      - Implied volatility from price (reverse engineer)
      - "What-if" scenarios (price/IV/time slid forward)
    NSE provides IV directly in the option chain, so we can usually
    skip the IV-solve step and use their IV for Greeks calc.

Indian-market notes:
    - Risk-free rate: use ~6.5–7% (RBI repo proxy)
    - Dividend yield: ~1.2% for NIFTY (rough)
    - Settlement: European (so plain Black-Scholes applies cleanly)
================================================================
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Dict, List, Literal, Optional, Tuple

import numpy as np
from scipy.stats import norm


# ================================================================
# Defaults for Indian index options
# ================================================================

DEFAULT_RISK_FREE_RATE = 0.065   # 6.5% — close to RBI repo
DEFAULT_DIVIDEND_YIELD = 0.012   # 1.2% — NIFTY dividend yield proxy

LOT_SIZES = {
    "NIFTY":      75,    # current lot size
    "BANKNIFTY":  30,
    "FINNIFTY":   65,
    "MIDCPNIFTY": 120,
    "SENSEX":     20,
}


# ================================================================
# Core Black-Scholes
# ================================================================

def _d1_d2(S: float, K: float, T: float, r: float, sigma: float,
           q: float = 0.0) -> Tuple[float, float]:
    """Standard d1, d2 for Black-Scholes with continuous dividend yield q."""
    if T <= 0 or sigma <= 0:
        # Avoid division by zero at expiry / zero vol — caller should handle
        return float("nan"), float("nan")
    vol_root_t = sigma * math.sqrt(T)
    d1 = (math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / vol_root_t
    d2 = d1 - vol_root_t
    return d1, d2


def bs_price(S: float, K: float, T: float, r: float, sigma: float,
             option_type: Literal["CE", "PE"], q: float = 0.0) -> float:
    """
    Black-Scholes price (European, with continuous dividend yield q).

    Parameters
    ----------
    S : spot price
    K : strike
    T : time to expiry in YEARS (e.g. 7 days = 7/365)
    r : risk-free rate (annualized, decimal)
    sigma : volatility (annualized, decimal)
    option_type : "CE" (call) or "PE" (put)
    q : continuous dividend yield (annualized, decimal)
    """
    if T <= 0:  # at/after expiry, return intrinsic
        return max(0, S - K) if option_type == "CE" else max(0, K - S)
    if sigma <= 0:
        # zero vol → deterministic, return discounted intrinsic
        fwd = S * math.exp((r - q) * T)
        intrinsic = max(0, fwd - K) if option_type == "CE" else max(0, K - fwd)
        return intrinsic * math.exp(-r * T)

    d1, d2 = _d1_d2(S, K, T, r, sigma, q)
    disc_S = S * math.exp(-q * T)
    disc_K = K * math.exp(-r * T)
    if option_type == "CE":
        return disc_S * norm.cdf(d1) - disc_K * norm.cdf(d2)
    return disc_K * norm.cdf(-d2) - disc_S * norm.cdf(-d1)


# ================================================================
# Greeks (per 1 unit; multiply by lot size × qty for portfolio)
# ================================================================

@dataclass
class Greeks:
    delta: float = 0.0
    gamma: float = 0.0
    theta: float = 0.0   # per DAY (we divide annualized theta by 365)
    vega: float = 0.0    # per 1 vol-point (i.e. 1% change in IV)
    rho: float = 0.0     # per 1% change in rate

    def __add__(self, other: "Greeks") -> "Greeks":
        return Greeks(
            self.delta + other.delta,
            self.gamma + other.gamma,
            self.theta + other.theta,
            self.vega + other.vega,
            self.rho + other.rho,
        )

    def scale(self, factor: float) -> "Greeks":
        return Greeks(self.delta * factor, self.gamma * factor,
                      self.theta * factor, self.vega * factor,
                      self.rho * factor)


def bs_greeks(S: float, K: float, T: float, r: float, sigma: float,
              option_type: Literal["CE", "PE"], q: float = 0.0) -> Greeks:
    """All Greeks in one shot. Theta in per-day terms, Vega per 1% IV change."""
    if T <= 0 or sigma <= 0:
        # At expiry: delta is the step function, all other Greeks are 0
        if T <= 0:
            if option_type == "CE":
                delta = 1.0 if S > K else (0.5 if S == K else 0.0)
            else:
                delta = -1.0 if S < K else (-0.5 if S == K else 0.0)
            return Greeks(delta=delta)
        return Greeks()

    d1, d2 = _d1_d2(S, K, T, r, sigma, q)
    nd1 = norm.cdf(d1)
    nd2 = norm.cdf(d2)
    npd1 = norm.pdf(d1)   # pdf is the same regardless of CE/PE
    disc_q = math.exp(-q * T)
    disc_r = math.exp(-r * T)
    sqrt_t = math.sqrt(T)

    if option_type == "CE":
        delta = disc_q * nd1
        theta_ann = (-disc_q * S * npd1 * sigma / (2 * sqrt_t)
                     - r * K * disc_r * nd2
                     + q * S * disc_q * nd1)
        rho = K * T * disc_r * nd2 / 100
    else:  # PE
        delta = -disc_q * norm.cdf(-d1)
        theta_ann = (-disc_q * S * npd1 * sigma / (2 * sqrt_t)
                     + r * K * disc_r * norm.cdf(-d2)
                     - q * S * disc_q * norm.cdf(-d1))
        rho = -K * T * disc_r * norm.cdf(-d2) / 100

    gamma = disc_q * npd1 / (S * sigma * sqrt_t)
    vega = S * disc_q * npd1 * sqrt_t / 100     # per 1% IV change
    theta = theta_ann / 365                      # per day

    return Greeks(delta=delta, gamma=gamma, theta=theta, vega=vega, rho=rho)


# ================================================================
# Implied volatility (when we have a market price and need to back out IV)
# ================================================================

def implied_volatility(market_price: float, S: float, K: float, T: float,
                       r: float, option_type: Literal["CE", "PE"],
                       q: float = 0.0,
                       tol: float = 1e-5, max_iter: int = 100) -> float:
    """
    Solve for IV given a market price. Brent's method-style bisection.
    Returns IV as a decimal (e.g. 0.18 for 18%).

    Returns NaN if the price is outside arbitrage bounds.
    """
    if T <= 0 or market_price <= 0:
        return float("nan")

    intrinsic = max(0, S - K) if option_type == "CE" else max(0, K - S)
    upper_bound = S if option_type == "CE" else K
    if market_price < intrinsic * 0.99 or market_price > upper_bound * 1.01:
        return float("nan")

    lo, hi = 1e-4, 5.0   # 0.01% to 500% vol
    for _ in range(max_iter):
        mid = (lo + hi) / 2
        price = bs_price(S, K, T, r, mid, option_type, q)
        if abs(price - market_price) < tol:
            return mid
        if price < market_price:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


# ================================================================
# Strategy data model
# ================================================================

@dataclass
class Leg:
    """One option leg in a multi-leg strategy."""
    strike: float
    option_type: Literal["CE", "PE"]
    side: Literal["BUY", "SELL"]
    quantity: int                   # number of lots
    premium: float                  # per-unit premium (LTP or theoretical)
    iv: float = 0.0                 # IV at trade time (decimal, e.g. 0.18)
    lot_size: int = 75

    @property
    def signed_qty(self) -> int:
        """+ for long, - for short. In units, not lots."""
        sign = 1 if self.side == "BUY" else -1
        return sign * self.quantity * self.lot_size

    @property
    def cost(self) -> float:
        """Cash flow at entry. Long = debit (positive cost paid out).
        Short = credit (negative cost = cash received)."""
        sign = 1 if self.side == "BUY" else -1
        return sign * self.premium * self.quantity * self.lot_size


# Use module-level functions below — cleaner than methods that have to
# read multiple Leg attributes.


def leg_payoff_at_expiry(leg: Leg, S_T: float) -> float:
    """P&L for one leg at a given underlying price at expiry."""
    if leg.option_type == "CE":
        intrinsic = max(0.0, S_T - leg.strike)
    else:
        intrinsic = max(0.0, leg.strike - S_T)
    units = leg.quantity * leg.lot_size
    if leg.side == "BUY":
        return (intrinsic - leg.premium) * units
    else:  # SELL — collected premium, must pay intrinsic
        return (leg.premium - intrinsic) * units


def leg_value_now(leg: Leg, S: float, T: float, r: float, sigma: float,
                  q: float = 0.0) -> float:
    """Mark-to-market value of the leg right now (not at expiry)."""
    price = bs_price(S, leg.strike, T, r, sigma, leg.option_type, q)
    units = leg.quantity * leg.lot_size
    if leg.side == "BUY":
        return (price - leg.premium) * units
    return (leg.premium - price) * units


def leg_greeks(leg: Leg, S: float, T: float, r: float, q: float = 0.0) -> Greeks:
    """Greeks for the leg, signed and scaled by lot × qty."""
    if leg.iv <= 0:
        return Greeks()
    g = bs_greeks(S, leg.strike, T, r, leg.iv, leg.option_type, q)
    sign = 1 if leg.side == "BUY" else -1
    units = leg.quantity * leg.lot_size
    return g.scale(sign * units)


# ================================================================
# Strategy aggregation
# ================================================================

@dataclass
class StrategyMetrics:
    net_cost: float                   # debit (+) or credit (-) at entry
    max_profit: float                 # capped at +inf if unbounded
    max_loss: float                   # capped at -inf if unbounded
    breakevens: List[float]
    payoff_curve: np.ndarray          # array of P&L values
    price_grid: np.ndarray            # corresponding underlying prices
    greeks: Greeks                    # net Greeks at current spot
    pop: float                        # probability of profit (0-1)
    margin_estimate: float            # rough margin required (₹)


def payoff_at_price(legs: List[Leg], S_T: float) -> float:
    """Total P&L at a single price at expiry."""
    return sum(leg_payoff_at_expiry(l, S_T) for l in legs)


def payoff_curve(legs: List[Leg], price_lo: float, price_hi: float,
                 n_points: int = 401) -> Tuple[np.ndarray, np.ndarray]:
    """Compute P&L across a price range. Returns (prices, payoffs)."""
    prices = np.linspace(price_lo, price_hi, n_points)
    payoffs = np.array([payoff_at_price(legs, p) for p in prices])
    return prices, payoffs


def find_breakevens(prices: np.ndarray, payoffs: np.ndarray) -> List[float]:
    """Find zero-crossings in the payoff curve."""
    bes = []
    for i in range(len(prices) - 1):
        y0, y1 = payoffs[i], payoffs[i + 1]
        if y0 == 0:
            bes.append(prices[i])
        elif y0 * y1 < 0:    # sign change
            # linear interpolation
            t = y0 / (y0 - y1)
            bes.append(prices[i] + t * (prices[i + 1] - prices[i]))
    return bes


def probability_of_profit(legs: List[Leg], S: float, T: float, r: float,
                          sigma: float, q: float = 0.0) -> float:
    """
    P[strategy is profitable at expiry] under risk-neutral lognormal.

    Method: simulate via the breakevens + per-region payoff signs.
    For most strategies (defined by breakevens), this reduces to a
    sum of cumulative-normal regions.
    """
    if T <= 0 or sigma <= 0 or S <= 0:
        return float("nan")

    # Dense grid around current price ±4σ
    sigma_t = sigma * math.sqrt(T)
    lo = S * math.exp(-4 * sigma_t)
    hi = S * math.exp(4 * sigma_t)
    prices, payoffs = payoff_curve(legs, lo, hi, n_points=1001)

    # Lognormal PDF under risk-neutral measure (drift = r - q - 0.5σ²)
    drift = (r - q - 0.5 * sigma * sigma) * T
    log_ratio = np.log(prices / S)
    log_pdf = norm.pdf((log_ratio - drift) / sigma_t) / (prices * sigma_t)

    # Numerically integrate over profitable region
    profit_mask = payoffs > 0
    if not profit_mask.any():
        return 0.0
    integrand = log_pdf * profit_mask
    # np.trapz was renamed to np.trapezoid in NumPy 2.0
    _trapz = getattr(np, "trapezoid", None) or getattr(np, "trapz")
    pop = _trapz(integrand, prices)
    return float(np.clip(pop, 0.0, 1.0))


def estimate_margin(legs: List[Leg], S: float, lot_size: int) -> float:
    """
    Rough margin estimate. Real SPAN margin requires the exchange's
    parameter file — this is an approximation.

    Heuristics:
      - Long-only strategies (all BUY): margin = total premium paid
      - Short legs: ~12% of notional per short leg, minus premium credit
        from spreads (where loss is capped)
    Broker will give you the truth — use this only for ballpark sizing.
    """
    long_premium = sum(l.cost for l in legs if l.side == "BUY")
    short_legs = [l for l in legs if l.side == "SELL"]

    if not short_legs:
        return long_premium   # debit only

    # If there's a long leg covering each short of the same type (a spread),
    # margin is the max spread width × lots, capped at the credit received.
    # Simplified: just take 12% of notional for each naked short.
    short_notional = sum(S * l.quantity * l.lot_size for l in short_legs)
    naive_margin = short_notional * 0.12

    # Subtract credit from short legs (you keep this if assigned)
    short_credit = sum(-l.cost for l in short_legs)   # negative cost = credit
    net_margin = max(naive_margin - short_credit, 0) + long_premium

    return float(net_margin)


def compute_strategy_metrics(legs: List[Leg], S: float, T: float, r: float,
                             sigma: float, q: float = 0.0,
                             price_range: Tuple[float, float] = None,
                             n_points: int = 401) -> StrategyMetrics:
    """All metrics in one call. Use this for the main UI."""
    if not legs:
        return StrategyMetrics(
            net_cost=0, max_profit=0, max_loss=0,
            breakevens=[], payoff_curve=np.array([]),
            price_grid=np.array([]), greeks=Greeks(),
            pop=float("nan"), margin_estimate=0,
        )

    # Price grid: ±20% from spot by default (covers most expiry moves)
    if price_range is None:
        price_lo = S * 0.80
        price_hi = S * 1.20
    else:
        price_lo, price_hi = price_range

    prices, payoffs = payoff_curve(legs, price_lo, price_hi, n_points)

    net_cost = sum(l.cost for l in legs)
    max_p = float(payoffs.max())
    min_p = float(payoffs.min())

    # Check for unbounded P&L: if payoff is still rising/falling at the
    # edge of the grid, mark as unbounded
    edge_slope_lo = payoffs[1] - payoffs[0]
    edge_slope_hi = payoffs[-1] - payoffs[-2]
    if edge_slope_hi > 0.01 * abs(max_p) and max_p == payoffs[-1]:
        max_p = float("inf")
    if edge_slope_lo < -0.01 * abs(min_p) and min_p == payoffs[0]:
        min_p = float("-inf")
    if edge_slope_lo > 0.01 * abs(min_p) and min_p == payoffs[0]:
        min_p = float("-inf")
    if edge_slope_hi < -0.01 * abs(max_p) and max_p == payoffs[-1]:
        max_p = float("inf")

    bes = find_breakevens(prices, payoffs)
    pop = probability_of_profit(legs, S, T, r, sigma, q)

    # Net Greeks
    net_g = Greeks()
    for l in legs:
        net_g = net_g + leg_greeks(l, S, T, r, q)

    lot_size = legs[0].lot_size if legs else 75
    margin = estimate_margin(legs, S, lot_size)

    return StrategyMetrics(
        net_cost=net_cost,
        max_profit=max_p,
        max_loss=min_p,
        breakevens=bes,
        payoff_curve=payoffs,
        price_grid=prices,
        greeks=net_g,
        pop=pop,
        margin_estimate=margin,
    )


# ================================================================
# Strategy presets (the common ones every F&O trader uses)
# ================================================================

def preset_long_call(S: float, atm: float, premium_ce: float,
                     iv: float, lot_size: int, qty: int = 1) -> List[Leg]:
    return [Leg(strike=atm, option_type="CE", side="BUY",
                quantity=qty, premium=premium_ce, iv=iv, lot_size=lot_size)]


def preset_long_put(S: float, atm: float, premium_pe: float,
                    iv: float, lot_size: int, qty: int = 1) -> List[Leg]:
    return [Leg(strike=atm, option_type="PE", side="BUY",
                quantity=qty, premium=premium_pe, iv=iv, lot_size=lot_size)]


def preset_long_straddle(S: float, atm: float, ce: float, pe: float,
                         iv_ce: float, iv_pe: float, lot_size: int,
                         qty: int = 1) -> List[Leg]:
    """Buy ATM CE + Buy ATM PE. Profits from big move either way."""
    return [
        Leg(atm, "CE", "BUY", qty, ce, iv_ce, lot_size),
        Leg(atm, "PE", "BUY", qty, pe, iv_pe, lot_size),
    ]


def preset_short_straddle(S: float, atm: float, ce: float, pe: float,
                          iv_ce: float, iv_pe: float, lot_size: int,
                          qty: int = 1) -> List[Leg]:
    """Sell ATM CE + Sell ATM PE. Profits if underlying stays near ATM."""
    return [
        Leg(atm, "CE", "SELL", qty, ce, iv_ce, lot_size),
        Leg(atm, "PE", "SELL", qty, pe, iv_pe, lot_size),
    ]


def preset_long_strangle(S: float, otm_ce_strike: float, otm_pe_strike: float,
                         ce: float, pe: float, iv_ce: float, iv_pe: float,
                         lot_size: int, qty: int = 1) -> List[Leg]:
    """Buy OTM CE + Buy OTM PE. Cheaper than straddle, needs bigger move."""
    return [
        Leg(otm_ce_strike, "CE", "BUY", qty, ce, iv_ce, lot_size),
        Leg(otm_pe_strike, "PE", "BUY", qty, pe, iv_pe, lot_size),
    ]


def preset_short_strangle(S: float, otm_ce_strike: float, otm_pe_strike: float,
                          ce: float, pe: float, iv_ce: float, iv_pe: float,
                          lot_size: int, qty: int = 1) -> List[Leg]:
    """Sell OTM CE + Sell OTM PE. The classic IV-crush trade."""
    return [
        Leg(otm_ce_strike, "CE", "SELL", qty, ce, iv_ce, lot_size),
        Leg(otm_pe_strike, "PE", "SELL", qty, pe, iv_pe, lot_size),
    ]


def preset_iron_condor(S: float, short_ce: float, long_ce: float,
                       short_pe: float, long_pe: float,
                       ce_short_p: float, ce_long_p: float,
                       pe_short_p: float, pe_long_p: float,
                       iv: float, lot_size: int, qty: int = 1) -> List[Leg]:
    """
    Iron Condor = Bear Call Spread + Bull Put Spread.
    Limited risk, limited reward, profits if underlying stays in middle.
    """
    return [
        Leg(short_ce, "CE", "SELL", qty, ce_short_p, iv, lot_size),
        Leg(long_ce,  "CE", "BUY",  qty, ce_long_p,  iv, lot_size),
        Leg(short_pe, "PE", "SELL", qty, pe_short_p, iv, lot_size),
        Leg(long_pe,  "PE", "BUY",  qty, pe_long_p,  iv, lot_size),
    ]


def preset_bull_call_spread(S: float, long_strike: float, short_strike: float,
                            long_p: float, short_p: float, iv: float,
                            lot_size: int, qty: int = 1) -> List[Leg]:
    """Buy lower-strike CE, sell higher-strike CE. Bullish, limited risk."""
    return [
        Leg(long_strike,  "CE", "BUY",  qty, long_p,  iv, lot_size),
        Leg(short_strike, "CE", "SELL", qty, short_p, iv, lot_size),
    ]


def preset_bear_put_spread(S: float, long_strike: float, short_strike: float,
                           long_p: float, short_p: float, iv: float,
                           lot_size: int, qty: int = 1) -> List[Leg]:
    """Buy higher-strike PE, sell lower-strike PE. Bearish, limited risk."""
    return [
        Leg(long_strike,  "PE", "BUY",  qty, long_p,  iv, lot_size),
        Leg(short_strike, "PE", "SELL", qty, short_p, iv, lot_size),
    ]


def preset_butterfly(S: float, low: float, mid: float, high: float,
                     low_p: float, mid_p: float, high_p: float,
                     iv: float, lot_size: int, opt_type: str = "CE",
                     qty: int = 1) -> List[Leg]:
    """
    Long Butterfly: 1 long low + 2 short mid + 1 long high.
    Profits if underlying lands near `mid` at expiry.
    """
    return [
        Leg(low,  opt_type, "BUY",  qty,     low_p,  iv, lot_size),
        Leg(mid,  opt_type, "SELL", qty * 2, mid_p,  iv, lot_size),
        Leg(high, opt_type, "BUY",  qty,     high_p, iv, lot_size),
    ]


PRESETS = {
    "Long Call":         "Bullish. Unlimited upside, limited downside (premium paid).",
    "Long Put":          "Bearish. Unlimited downside, limited upside (premium paid).",
    "Long Straddle":     "Big move expected. ATM CE + ATM PE. Profits from volatility.",
    "Short Straddle":    "Range-bound expected. Sell ATM CE + PE. Profits from time decay & IV crush.",
    "Long Strangle":     "Big move expected, cheaper than straddle. OTM CE + OTM PE.",
    "Short Strangle":    "Range-bound. Sell OTM CE + OTM PE. The IV-crush classic.",
    "Iron Condor":       "Limited-risk range trade. 4 legs around the expected range.",
    "Bull Call Spread":  "Mildly bullish. Buy lower CE + sell higher CE.",
    "Bear Put Spread":   "Mildly bearish. Buy higher PE + sell lower PE.",
    "Long Butterfly":    "Pin trade. Profits if underlying lands at middle strike at expiry.",
}


# ================================================================
# Helpers
# ================================================================

def days_to_year(days: float) -> float:
    """Convert calendar days to years. 365 for option pricing (not 252)."""
    return days / 365.0


def calendar_days_until(target: date) -> int:
    """Days from today to expiry date."""
    return (target - date.today()).days


def parse_expiry(expiry_str: str) -> Optional[date]:
    """Parse '15-May-2026' or '2026-05-15' to date."""
    for fmt in ("%d-%b-%Y", "%Y-%m-%d", "%d-%B-%Y"):
        try:
            return datetime.strptime(expiry_str, fmt).date()
        except ValueError:
            continue
    return None


# ================================================================
# Self-test
# ================================================================

if __name__ == "__main__":
    print("=== Pricing sanity check ===")
    # NIFTY at 24800, 30 days to expiry, 15% vol, 25000 CE
    S, K, T, r, sigma = 24800, 25000, 30/365, 0.065, 0.15
    p_ce = bs_price(S, K, T, r, sigma, "CE")
    p_pe = bs_price(S, K, T, r, sigma, "PE")
    print(f"NIFTY {S} → 25000 CE = ₹{p_ce:.2f}, PE = ₹{p_pe:.2f}")
    print(f"  Put-call parity check: C - P = {p_ce - p_pe:.2f},  "
          f"S - K·e^(-rT) = {S - K*math.exp(-r*T):.2f}")

    print("\n=== Greeks ===")
    g = bs_greeks(S, K, T, r, sigma, "CE")
    print(f"25000 CE: Δ={g.delta:.4f}  Γ={g.gamma:.6f}  "
          f"Θ={g.theta:.2f}/day  V={g.vega:.2f}/1% IV")

    print("\n=== Long Straddle on NIFTY ===")
    legs = preset_long_straddle(S, 24800, 180, 150, 0.15, 0.16, 75)
    m = compute_strategy_metrics(legs, S, T, r, 0.15)
    print(f"Net cost: ₹{m.net_cost:,.0f}")
    print(f"Max profit: {'unlimited' if m.max_profit == float('inf') else f'₹{m.max_profit:,.0f}'}")
    print(f"Max loss: ₹{m.max_loss:,.0f}")
    print(f"Breakevens: {[round(x) for x in m.breakevens]}")
    print(f"PoP: {m.pop:.1%}")
    print(f"Net Δ={m.greeks.delta:.2f}  Θ={m.greeks.theta:.2f}/day  V={m.greeks.vega:.2f}")
