"""
================================================================
TRADE SIMULATOR — Virtual position tracking
================================================================
Save a multi-leg strategy as an "open" virtual position and track its
P&L in real time using either:
  - Live LTPs from the NSE option chain (default, free)
  - Live LTPs from KiteTicker WebSocket (sub-second updates)
  - Black-Scholes theoretical values (fallback / what-if mode)

Storage uses the SQLite layer in iv_history.py (table: saved_positions).
Legs are serialized to JSON so we can round-trip without losing precision.
================================================================
"""

from __future__ import annotations

import json
from datetime import date, datetime
from typing import Dict, List, Optional, Tuple

import pandas as pd

from options_math import (
    Leg, Greeks, bs_price, leg_payoff_at_expiry, leg_value_now,
    leg_greeks, payoff_at_price, days_to_year,
    DEFAULT_RISK_FREE_RATE, DEFAULT_DIVIDEND_YIELD,
)
from iv_history import (
    save_position as _db_save,
    list_positions as _db_list,
    close_position as _db_close,
    delete_position as _db_delete,
)


# ================================================================
# Serialization helpers
# ================================================================

def serialize_legs(legs: List[Leg]) -> str:
    """Convert list of Legs to JSON string for storage."""
    return json.dumps([{
        "strike": l.strike,
        "option_type": l.option_type,
        "side": l.side,
        "quantity": l.quantity,
        "premium": l.premium,
        "iv": l.iv,
        "lot_size": l.lot_size,
    } for l in legs])


def deserialize_legs(legs_json: str) -> List[Leg]:
    """Parse JSON back into Leg objects."""
    data = json.loads(legs_json)
    return [Leg(**leg_dict) for leg_dict in data]


# ================================================================
# Public API — save / load / close / delete
# ================================================================

def save_strategy(name: str, symbol: str, expiry: str, legs: List[Leg],
                  entry_spot: float, notes: str = "") -> int:
    """
    Persist a strategy as an open virtual position.

    `entry_cost` and `entry_iv` are derived from the legs themselves.
    Returns the position ID.
    """
    if not legs:
        raise ValueError("Cannot save empty strategy.")
    entry_cost = sum(l.cost for l in legs)
    valid_ivs = [l.iv for l in legs if l.iv > 0]
    entry_iv = sum(valid_ivs) / len(valid_ivs) if valid_ivs else 0.0

    return _db_save(
        name=name, symbol=symbol, expiry=expiry,
        legs_json=serialize_legs(legs),
        entry_spot=entry_spot, entry_cost=entry_cost,
        entry_iv=entry_iv, notes=notes,
    )


def list_open_positions() -> pd.DataFrame:
    """Return all open positions as a DataFrame."""
    return _db_list(open_only=True)


def list_all_positions() -> pd.DataFrame:
    """Return open + closed positions."""
    return _db_list(open_only=False)


def close_position(position_id: int, realized_pnl: float) -> None:
    _db_close(position_id, realized_pnl)


def delete_position(position_id: int) -> None:
    _db_delete(position_id)


# ================================================================
# Mark-to-market — the core of the simulator
# ================================================================

def mark_to_market(legs: List[Leg], spot: float,
                   chain_lookup_fn=None,
                   ticker=None, option_tokens_map: Optional[Dict] = None,
                   days_to_expiry: int = 7,
                   fallback_iv: float = 0.15) -> Dict:
    """
    Compute current P&L for a position. Tries data sources in order:
      1. KiteTicker (sub-second, if ticker + tokens_map provided)
      2. Chain lookup (30s refresh, if chain_lookup_fn provided)
      3. Black-Scholes theoretical (always works)

    Parameters
    ----------
    legs : entry legs (entry premium stored on each)
    spot : current underlying price
    chain_lookup_fn : callable(strike, side) -> (ltp, iv) — usually
        a partial of strategy_builder._chain_lookup bound to (chain_df, expiry)
    ticker : optional TickerWorker instance for WebSocket lookups
    option_tokens_map : {token: {"strike": k, "side": s}} — needed for ticker
    days_to_expiry : for BS pricing fallback
    fallback_iv : for BS pricing fallback

    Returns
    -------
    dict with:
      total_pnl, per_leg [{leg, entry, current, pnl, source}],
      net_greeks, current_value
    """
    r = DEFAULT_RISK_FREE_RATE
    q = DEFAULT_DIVIDEND_YIELD
    T = days_to_year(days_to_expiry) if days_to_expiry > 0 else 1 / 365

    # Build reverse lookup: (strike, side) -> token for WebSocket lookups
    rev_tokens = {}
    if ticker and option_tokens_map:
        for tok, info in option_tokens_map.items():
            rev_tokens[(info["strike"], info["side"])] = tok

    per_leg = []
    net_greeks = Greeks()
    total_pnl = 0.0
    current_value_total = 0.0

    for leg in legs:
        # Try sources in priority order
        current_price = None
        source = "BS"   # default fallback

        # 1. WebSocket
        if rev_tokens and (leg.strike, leg.option_type) in rev_tokens:
            tok = rev_tokens[(leg.strike, leg.option_type)]
            snap = ticker.latest(tok) if ticker else None
            if snap and snap.last_price > 0:
                current_price = snap.last_price
                source = "WS"

        # 2. Chain lookup
        if current_price is None and chain_lookup_fn:
            ltp, _iv = chain_lookup_fn(leg.strike, leg.option_type)
            if ltp > 0:
                current_price = ltp
                source = "CHAIN"

        # 3. Black-Scholes theoretical
        if current_price is None:
            iv = leg.iv if leg.iv > 0 else fallback_iv
            current_price = bs_price(spot, leg.strike, T, r, iv,
                                     leg.option_type, q)
            source = "BS"

        units = leg.quantity * leg.lot_size
        # Long: current value - entry cost. Short: entry credit - current cost.
        if leg.side == "BUY":
            entry_val = leg.premium * units
            current_val = current_price * units
            pnl = current_val - entry_val
        else:
            entry_val = leg.premium * units   # cash collected at entry
            current_val = current_price * units   # cash needed to close
            pnl = entry_val - current_val

        # Net contribution to portfolio Greeks (use current IV or fallback)
        g = leg_greeks(leg, spot, T, r, q)
        net_greeks = net_greeks + g

        per_leg.append({
            "side": leg.side,
            "type": leg.option_type,
            "strike": leg.strike,
            "qty": leg.quantity,
            "entry_price": leg.premium,
            "current_price": current_price,
            "entry_value": entry_val if leg.side == "BUY" else -entry_val,
            "current_value": current_val if leg.side == "BUY" else -current_val,
            "pnl": pnl,
            "source": source,
        })
        total_pnl += pnl
        current_value_total += (
            current_val if leg.side == "BUY" else -current_val
        )

    return {
        "total_pnl": total_pnl,
        "per_leg": per_leg,
        "net_greeks": net_greeks,
        "current_value": current_value_total,
        "data_sources": {row["source"] for row in per_leg},
    }


def realize_pnl_at_close(position_id: int, current_pnl: float) -> None:
    """Mark a position as closed with the given realized P&L."""
    close_position(position_id, current_pnl)


# ================================================================
# Self-test
# ================================================================

if __name__ == "__main__":
    # Build a fake iron condor and round-trip it
    legs = [
        Leg(24850, "CE", "SELL", 1, 85.0, 0.13, 75),
        Leg(25000, "CE", "BUY",  1, 25.0, 0.13, 75),
        Leg(24750, "PE", "SELL", 1, 80.0, 0.13, 75),
        Leg(24600, "PE", "BUY",  1, 22.0, 0.13, 75),
    ]
    js = serialize_legs(legs)
    back = deserialize_legs(js)
    print(f"Serialized: {len(js)} chars")
    print(f"Round-trip: {len(back)} legs")
    assert all(a.strike == b.strike and a.side == b.side for a, b in zip(legs, back))
    print("✓ Round-trip preserves data")

    # MTM with synthetic chain
    fake_chain = {
        (24850, "CE"): (75.0, 0.13),
        (25000, "CE"): (20.0, 0.13),
        (24750, "PE"): (60.0, 0.13),
        (24600, "PE"): (15.0, 0.13),
    }

    def fake_lookup(strike, side):
        return fake_chain.get((strike, side), (0, 0))

    mtm = mark_to_market(legs, spot=24820, chain_lookup_fn=fake_lookup,
                         days_to_expiry=5)
    print(f"\nMTM at spot 24820, 5 DTE:")
    print(f"  Total P&L: ₹{mtm['total_pnl']:+,.0f}")
    for r in mtm["per_leg"]:
        print(f"  {r['side']:4s} {r['type']} {r['strike']:.0f} "
              f"entry ₹{r['entry_price']:.2f} → curr ₹{r['current_price']:.2f} "
              f"= ₹{r['pnl']:+,.0f} ({r['source']})")
    print(f"  Sources used: {mtm['data_sources']}")
