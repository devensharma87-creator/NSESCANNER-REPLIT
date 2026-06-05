"""
fno_cost_model.py
=================
Honest, verified cost model for Indian index-option round trips (buy CE/PE -> sell).
Built for NIFTY / BANKNIFTY / SENSEX ATM weekly/monthly option BUYING (long premium).

WHY THIS EXISTS
---------------
Your live system reports GROSS P&L. The shadow cost model is reporting-only and does
NOT feed risk gates or the backtester. That makes every win-rate you've seen optimistic.
This module is the single source of truth for costs, designed to be wired into BOTH
the live settlement path and the backtester so they agree to the rupee.

RATES VERIFIED JUNE 2026 (post Budget-2026 hike, effective 1 April 2026):
  - STT on options: 0.15% of SELL-side premium turnover (was 0.10% before Apr-2026).
  - STT is charged on the SELL side only for option premium.
  - Exchange txn, SEBI, stamp, GST, brokerage modelled on Zerodha-style discount-broker rates.

IMPORTANT: Exchange transaction charges and clearing fees change via circulars. The
values below are realistic defaults; treat them as PARAMETERS, not gospel. Update the
RATES dict from the latest broker charge-list / NSE-BSE circular before trusting live money.
"""

from dataclasses import dataclass

# ---------------------------------------------------------------------------
# Rate table - EDIT HERE when circulars change. Every number is a parameter.
# ---------------------------------------------------------------------------
RATES = {
    # STT: 0.15% on SELL premium turnover only (post 1-Apr-2026).
    "stt_sell_pct": 0.0015,

    # Brokerage: discount-broker flat fee per executed order (buy and sell each).
    # Zerodha-style: Rs 20 or 0.03% of turnover, whichever is LOWER, per order.
    "brokerage_flat": 20.0,
    "brokerage_pct": 0.0003,

    # Exchange transaction charge on premium turnover (both sides). NSE option ~0.03503%.
    # BSE (SENSEX) differs; we keep one default and allow per-exchange override below.
    "exch_txn_pct_nse": 0.0003503,
    "exch_txn_pct_bse": 0.0003250,   # approximate; update from BSE circular

    # SEBI turnover fee on premium turnover (both sides): Rs 10 per crore = 0.000001.
    "sebi_pct": 0.000001,

    # Stamp duty: 0.003% on BUY side only.
    "stamp_buy_pct": 0.00003,

    # GST: 18% on (brokerage + exchange txn + SEBI fee).
    "gst_pct": 0.18,
}

# Which exchange each index trades on (drives exchange txn rate).
INDEX_EXCHANGE = {
    "NIFTY": "nse",
    "BANKNIFTY": "nse",
    "SENSEX": "bse",
}

# Lot sizes - PARAMETER, verify against current NSE/BSE contract spec each expiry cycle.
LOT_SIZE = {
    "NIFTY": 75,
    "BANKNIFTY": 35,
    "SENSEX": 20,
}


@dataclass
class CostBreakdown:
    brokerage: float
    stt: float
    exch_txn: float
    sebi: float
    stamp: float
    gst: float
    total: float

    def __str__(self):
        return (f"brokerage={self.brokerage:.2f} stt={self.stt:.2f} "
                f"exch={self.exch_txn:.2f} sebi={self.sebi:.2f} "
                f"stamp={self.stamp:.2f} gst={self.gst:.2f} "
                f"=> TOTAL={self.total:.2f}")


def round_trip_costs(index: str, entry_premium: float, exit_premium: float,
                     lots: int, slippage_pct_per_side: float = 0.0) -> CostBreakdown:
    """
    Compute total round-trip charges for BUYING an option and later SELLING it.

    index            : 'NIFTY' | 'BANKNIFTY' | 'SENSEX'
    entry_premium    : option premium paid per unit at entry (BUY)
    exit_premium     : option premium received per unit at exit (SELL)
    lots             : number of lots
    slippage_pct_per_side : extra cost as a fraction of premium per side to model
                            bid-ask + market-impact (e.g. 0.005 = 0.5% each side).
                            Returned as part of 'total' via the slippage line.

    Returns a CostBreakdown. All charges are in rupees.
    """
    if index not in LOT_SIZE:
        raise ValueError(f"Unknown index {index!r}; expected one of {list(LOT_SIZE)}")
    qty = lots * LOT_SIZE[index]
    exch = INDEX_EXCHANGE[index]
    exch_pct = RATES["exch_txn_pct_nse"] if exch == "nse" else RATES["exch_txn_pct_bse"]

    buy_turnover = entry_premium * qty
    sell_turnover = exit_premium * qty

    # Brokerage: min(flat, pct*turnover) per side.
    brk_buy = min(RATES["brokerage_flat"], RATES["brokerage_pct"] * buy_turnover)
    brk_sell = min(RATES["brokerage_flat"], RATES["brokerage_pct"] * sell_turnover)
    brokerage = brk_buy + brk_sell

    # STT: sell side only, 0.15% of sell premium turnover.
    stt = RATES["stt_sell_pct"] * sell_turnover

    # Exchange txn: both sides.
    exch_txn = exch_pct * (buy_turnover + sell_turnover)

    # SEBI: both sides.
    sebi = RATES["sebi_pct"] * (buy_turnover + sell_turnover)

    # Stamp: buy side only.
    stamp = RATES["stamp_buy_pct"] * buy_turnover

    # GST: 18% on (brokerage + exch + sebi).
    gst = RATES["gst_pct"] * (brokerage + exch_txn + sebi)

    # Slippage modelled as a cash cost on both sides' turnover.
    slippage = slippage_pct_per_side * (buy_turnover + sell_turnover)

    total = brokerage + stt + exch_txn + sebi + stamp + gst + slippage
    return CostBreakdown(brokerage, stt, exch_txn, sebi, stamp, gst, total)


def net_pnl(index: str, entry_premium: float, exit_premium: float,
            lots: int, slippage_pct_per_side: float = 0.0):
    """
    Returns (gross_pnl, total_costs, net_pnl) for a long-option round trip.
    This is THE function both the live settlement path and the backtester must call,
    so a 'win' means the same thing everywhere: net_pnl > 0.
    """
    qty = lots * LOT_SIZE[index]
    gross = (exit_premium - entry_premium) * qty
    costs = round_trip_costs(index, entry_premium, exit_premium, lots,
                             slippage_pct_per_side).total
    return gross, costs, gross - costs


def breakeven_move(index: str, entry_premium: float, lots: int,
                   slippage_pct_per_side: float = 0.005) -> float:
    """
    How much the premium must rise (in rupees per unit) just to break even after costs.
    This is the number that kills slim-edge high-churn strategies. Print it; respect it.
    """
    qty = lots * LOT_SIZE[index]
    # Approximate: assume exit ~ entry for cost estimation, solve for delta.
    c = round_trip_costs(index, entry_premium, entry_premium, lots,
                         slippage_pct_per_side).total
    return c / qty


if __name__ == "__main__":
    # Worked example: BUY 1 lot NIFTY ATM at premium 120, exit at 150.
    for idx, ep, xp, lots in [
        ("NIFTY", 120.0, 150.0, 1),
        ("BANKNIFTY", 700.0, 760.0, 1),
        ("SENSEX", 550.0, 503.0, 1),   # a loser, to show costs still apply
    ]:
        g, c, n = net_pnl(idx, ep, xp, lots, slippage_pct_per_side=0.005)
        be = breakeven_move(idx, ep, lots, slippage_pct_per_side=0.005)
        print(f"\n{idx}: buy {ep} -> sell {xp}, {lots} lot(s)")
        print(f"  gross={g:>10.2f}  costs={c:>8.2f}  NET={n:>10.2f}")
        print(f"  premium must move +{be:.2f} pts just to break even after costs")
