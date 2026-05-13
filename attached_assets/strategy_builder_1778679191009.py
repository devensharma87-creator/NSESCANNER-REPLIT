"""
================================================================
STRATEGY BUILDER UI — Multi-leg options dashboard
================================================================
Streamlit tab for building, analyzing, and stress-testing multi-leg
options strategies. Plugs into the existing pro_market_analyzer.

UI sections:
    1. Underlying + expiry picker  → pulls live option chain
    2. Strategy preset selector    → loads template legs
    3. Leg editor                  → add/remove/edit per leg
    4. Live metrics                → cost, max P&L, breakevens, PoP, margin
    5. Payoff diagram              → at expiry + T+0 mark-to-market curve
    6. Greeks dashboard            → per-leg + net
    7. Scenario sliders            → shift spot/IV/DTE, see P&L morph

All math lives in options_math.py. This file is pure UI.
================================================================
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import streamlit as st

try:
    import plotly.graph_objects as go
    from plotly.subplots import make_subplots
except Exception:
    go = None
    make_subplots = None

from options_math import (
    Leg, Greeks, StrategyMetrics,
    bs_price, bs_greeks, implied_volatility,
    leg_payoff_at_expiry, leg_value_now, leg_greeks,
    compute_strategy_metrics, payoff_curve,
    days_to_year, parse_expiry,
    LOT_SIZES, PRESETS,
    DEFAULT_RISK_FREE_RATE, DEFAULT_DIVIDEND_YIELD,
    preset_long_call, preset_long_put,
    preset_long_straddle, preset_short_straddle,
    preset_long_strangle, preset_short_strangle,
    preset_iron_condor, preset_bull_call_spread,
    preset_bear_put_spread, preset_butterfly,
)

from trade_simulator import save_strategy
from iv_history import (
    record_atm_iv, get_history, compute_iv_metrics,
    interpret_iv_rank,
)


# ================================================================
# Helpers
# ================================================================

def _fmt_money(x: float) -> str:
    if x == float("inf"):
        return "∞"
    if x == float("-inf"):
        return "-∞"
    if abs(x) >= 1e7:
        return f"₹{x/1e7:+.2f}Cr"
    if abs(x) >= 1e5:
        return f"₹{x/1e5:+.2f}L"
    if abs(x) >= 1e3:
        return f"₹{x:+,.0f}"
    return f"₹{x:+.0f}"


def _strike_step(name: str) -> int:
    """Standard strike intervals on NSE."""
    return {"NIFTY": 50, "FINNIFTY": 50, "BANKNIFTY": 100,
            "MIDCPNIFTY": 25, "SENSEX": 100}.get(name, 50)


def _atm_strike(spot: float, step: int) -> int:
    return int(round(spot / step) * step)


def _otm_strikes(atm: int, step: int, distance: int = 2) -> Tuple[int, int]:
    """Return (OTM_PUT_strike, OTM_CALL_strike) at `distance` × step from ATM."""
    return atm - distance * step, atm + distance * step


# ================================================================
# Chain helpers — pull premium/IV for a given strike from cached chain
# ================================================================

def _chain_lookup(chain_df: pd.DataFrame, expiry: str, strike: float,
                  side: str) -> Tuple[float, float]:
    """Return (LTP, IV) for one (expiry, strike, CE/PE). 0,0 if not found."""
    if chain_df is None or chain_df.empty:
        return 0.0, 0.0
    row = chain_df[(chain_df["expiry"] == expiry) &
                   (chain_df["strike"] == strike)]
    if row.empty:
        return 0.0, 0.0
    ltp_col = f"{side}_LTP"
    iv_col = f"{side}_IV"
    ltp = float(row[ltp_col].iloc[0]) if ltp_col in row.columns else 0.0
    iv = float(row[iv_col].iloc[0]) / 100.0 if iv_col in row.columns else 0.0
    return ltp, iv


# ================================================================
# Leg editor — interactive table
# ================================================================

def _render_leg_editor(legs: List[Leg], chain_df: pd.DataFrame,
                       expiry: str, lot_size: int) -> List[Leg]:
    """
    Render each leg as an editable row. Returns updated legs list.
    """
    st.markdown('<div class="section-title">Legs</div>', unsafe_allow_html=True)

    if not legs:
        st.info("No legs yet. Pick a preset above or click ➕ Add Leg.")
        return legs

    # Available strikes from the chain
    if chain_df is not None and not chain_df.empty:
        available_strikes = sorted(
            chain_df[chain_df["expiry"] == expiry]["strike"].unique().tolist()
        )
    else:
        available_strikes = []

    new_legs = []
    for i, leg in enumerate(legs):
        with st.container(border=True):
            cols = st.columns([1.2, 1.4, 1.2, 1.2, 1.6, 1.4, 0.6])

            side = cols[0].selectbox(
                "Side", ["BUY", "SELL"],
                index=0 if leg.side == "BUY" else 1,
                key=f"leg_{i}_side",
            )

            opt_type = cols[1].selectbox(
                "Type", ["CE", "PE"],
                index=0 if leg.option_type == "CE" else 1,
                key=f"leg_{i}_type",
            )

            if available_strikes:
                # Find closest available strike
                closest_idx = min(range(len(available_strikes)),
                                  key=lambda k: abs(available_strikes[k] - leg.strike))
                strike = cols[2].selectbox(
                    "Strike", available_strikes,
                    index=closest_idx,
                    key=f"leg_{i}_strike",
                )
            else:
                strike = cols[2].number_input(
                    "Strike", value=float(leg.strike), step=50.0,
                    key=f"leg_{i}_strike",
                )

            qty = cols[3].number_input(
                "Lots", value=int(leg.quantity), min_value=1, step=1,
                key=f"leg_{i}_qty",
            )

            # Auto-refresh premium/IV from chain if available
            chain_ltp, chain_iv = _chain_lookup(chain_df, expiry, strike, opt_type)
            default_premium = chain_ltp if chain_ltp > 0 else leg.premium
            default_iv = chain_iv if chain_iv > 0 else leg.iv

            premium = cols[4].number_input(
                "Premium ₹", value=float(default_premium),
                step=0.05, format="%.2f",
                key=f"leg_{i}_prem",
                help="LTP from live chain. Override if you want to model fills.",
            )

            iv_pct = cols[5].number_input(
                "IV %", value=float(default_iv * 100),
                step=0.5, format="%.2f",
                key=f"leg_{i}_iv",
                help="Implied volatility. Used for Greeks and mark-to-market curve.",
            )

            if cols[6].button("🗑", key=f"leg_{i}_del",
                              help="Remove this leg"):
                continue   # skip — drops from new_legs

            new_legs.append(Leg(
                strike=float(strike),
                option_type=opt_type,
                side=side,
                quantity=int(qty),
                premium=float(premium),
                iv=float(iv_pct) / 100,
                lot_size=lot_size,
            ))

    return new_legs


# ================================================================
# Preset loader
# ================================================================

def _load_preset(preset_name: str, spot: float, name: str,
                 chain_df: pd.DataFrame, expiry: str,
                 lot_size: int) -> List[Leg]:
    """Build legs for the chosen preset, pulling live LTPs/IVs from chain."""
    step = _strike_step(name)
    atm = _atm_strike(spot, step)

    def get(strike, side):
        ltp, iv = _chain_lookup(chain_df, expiry, strike, side)
        return ltp, iv

    if preset_name == "Long Call":
        ltp, iv = get(atm, "CE")
        return preset_long_call(spot, atm, ltp, iv, lot_size)

    if preset_name == "Long Put":
        ltp, iv = get(atm, "PE")
        return preset_long_put(spot, atm, ltp, iv, lot_size)

    if preset_name == "Long Straddle":
        ce, iv_c = get(atm, "CE")
        pe, iv_p = get(atm, "PE")
        return preset_long_straddle(spot, atm, ce, pe, iv_c, iv_p, lot_size)

    if preset_name == "Short Straddle":
        ce, iv_c = get(atm, "CE")
        pe, iv_p = get(atm, "PE")
        return preset_short_straddle(spot, atm, ce, pe, iv_c, iv_p, lot_size)

    if preset_name == "Long Strangle":
        otm_pe_k, otm_ce_k = _otm_strikes(atm, step, distance=2)
        ce, iv_c = get(otm_ce_k, "CE")
        pe, iv_p = get(otm_pe_k, "PE")
        return preset_long_strangle(spot, otm_ce_k, otm_pe_k, ce, pe,
                                    iv_c, iv_p, lot_size)

    if preset_name == "Short Strangle":
        otm_pe_k, otm_ce_k = _otm_strikes(atm, step, distance=2)
        ce, iv_c = get(otm_ce_k, "CE")
        pe, iv_p = get(otm_pe_k, "PE")
        return preset_short_strangle(spot, otm_ce_k, otm_pe_k, ce, pe,
                                     iv_c, iv_p, lot_size)

    if preset_name == "Iron Condor":
        # Standard 1-2 step wings around ATM
        short_pe_k = atm - 1 * step
        long_pe_k = atm - 3 * step
        short_ce_k = atm + 1 * step
        long_ce_k = atm + 3 * step
        ce_s, _ = get(short_ce_k, "CE")
        ce_l, iv_avg = get(long_ce_k, "CE")
        pe_s, _ = get(short_pe_k, "PE")
        pe_l, _ = get(long_pe_k, "PE")
        return preset_iron_condor(spot, short_ce_k, long_ce_k,
                                  short_pe_k, long_pe_k,
                                  ce_s, ce_l, pe_s, pe_l,
                                  iv_avg or 0.15, lot_size)

    if preset_name == "Bull Call Spread":
        long_k = atm
        short_k = atm + 2 * step
        long_p, iv = get(long_k, "CE")
        short_p, _ = get(short_k, "CE")
        return preset_bull_call_spread(spot, long_k, short_k,
                                       long_p, short_p, iv, lot_size)

    if preset_name == "Bear Put Spread":
        long_k = atm
        short_k = atm - 2 * step
        long_p, iv = get(long_k, "PE")
        short_p, _ = get(short_k, "PE")
        return preset_bear_put_spread(spot, long_k, short_k,
                                      long_p, short_p, iv, lot_size)

    if preset_name == "Long Butterfly":
        low = atm - 2 * step
        mid = atm
        high = atm + 2 * step
        low_p, iv = get(low, "CE")
        mid_p, _ = get(mid, "CE")
        high_p, _ = get(high, "CE")
        return preset_butterfly(spot, low, mid, high,
                                low_p, mid_p, high_p,
                                iv, lot_size, opt_type="CE")

    return []


# ================================================================
# Metrics row
# ================================================================

def _render_metrics(metrics: StrategyMetrics, legs: List[Leg]):
    """Top metrics row: cost, max P&L, breakevens, PoP, margin."""
    from pro_market_analyzer import metric_card  # reuse the card style

    cost_label = "Credit received" if metrics.net_cost < 0 else "Debit paid"
    cost_val = _fmt_money(abs(metrics.net_cost))

    if metrics.max_profit == float("inf"):
        max_p_val, max_p_dir = "Unlimited", "up"
    else:
        max_p_val = _fmt_money(metrics.max_profit)
        max_p_dir = "up" if metrics.max_profit > 0 else "dn"

    if metrics.max_loss == float("-inf"):
        max_l_val, max_l_dir = "Unlimited", "dn"
    else:
        max_l_val = _fmt_money(metrics.max_loss)
        max_l_dir = "dn" if metrics.max_loss < 0 else "up"

    be_str = ", ".join(f"{b:,.0f}" for b in metrics.breakevens) or "—"

    pop_pct = metrics.pop * 100 if not np.isnan(metrics.pop) else None
    pop_str = f"{pop_pct:.1f}%" if pop_pct is not None else "—"
    pop_dir = "up" if pop_pct and pop_pct >= 50 else "dn"

    cols = st.columns(5)
    cols[0].markdown(metric_card(cost_label, cost_val), unsafe_allow_html=True)
    cols[1].markdown(metric_card("Max Profit", max_p_val, "", max_p_dir),
                     unsafe_allow_html=True)
    cols[2].markdown(metric_card("Max Loss", max_l_val, "", max_l_dir),
                     unsafe_allow_html=True)
    cols[3].markdown(metric_card("Breakeven(s)", be_str),
                     unsafe_allow_html=True)
    cols[4].markdown(metric_card("Probability of Profit", pop_str, "", pop_dir),
                     unsafe_allow_html=True)

    # Risk-reward + margin row
    if metrics.max_profit not in (float("inf"), 0) and \
       metrics.max_loss not in (float("-inf"), 0):
        rr = abs(metrics.max_profit / metrics.max_loss)
        rr_str = f"1 : {rr:.2f}"
    else:
        rr_str = "—"

    cols2 = st.columns(5)
    cols2[0].markdown(metric_card("Risk : Reward", rr_str),
                      unsafe_allow_html=True)
    cols2[1].markdown(metric_card("Est. Margin",
                                  _fmt_money(metrics.margin_estimate).replace("+", "")),
                      unsafe_allow_html=True)
    cols2[2].markdown(metric_card("Net Δ", f"{metrics.greeks.delta:+.2f}"),
                      unsafe_allow_html=True)
    cols2[3].markdown(metric_card("Net Θ /day", f"{metrics.greeks.theta:+.0f}"),
                      unsafe_allow_html=True)
    cols2[4].markdown(metric_card("Net Vega /1%", f"{metrics.greeks.vega:+.0f}"),
                      unsafe_allow_html=True)


# ================================================================
# Payoff diagram
# ================================================================

def _render_payoff_chart(legs: List[Leg], metrics: StrategyMetrics,
                         spot: float, T: float, r: float, sigma: float,
                         q: float):
    """The signature multi-leg P&L chart. Shows expiry payoff + T+0 curve."""
    if go is None:
        st.warning("Plotly not installed.")
        return
    if metrics.price_grid.size == 0:
        return

    prices = metrics.price_grid
    expiry_payoff = metrics.payoff_curve

    # T+0 curve: mark-to-market P&L assuming we hold the strategy NOW
    # (uses BS pricing with current IV and T)
    if T > 0:
        t0_payoff = np.array([
            sum(leg_value_now(l, p, T, r, l.iv if l.iv > 0 else sigma, q)
                for l in legs)
            for p in prices
        ])
    else:
        t0_payoff = expiry_payoff

    fig = go.Figure()

    # Profit region shading
    fig.add_trace(go.Scatter(
        x=prices, y=np.where(expiry_payoff >= 0, expiry_payoff, 0),
        fill="tozeroy", fillcolor="rgba(0,214,143,0.15)",
        line=dict(width=0), name="Profit zone", showlegend=False,
    ))
    fig.add_trace(go.Scatter(
        x=prices, y=np.where(expiry_payoff < 0, expiry_payoff, 0),
        fill="tozeroy", fillcolor="rgba(255,77,109,0.15)",
        line=dict(width=0), name="Loss zone", showlegend=False,
    ))

    # T+0 curve (today)
    fig.add_trace(go.Scatter(
        x=prices, y=t0_payoff,
        line=dict(color="#22d3ee", width=1.5, dash="dot"),
        name=f"T+0 (today, {int(T*365)}d to expiry)",
    ))

    # Expiry payoff (main)
    fig.add_trace(go.Scatter(
        x=prices, y=expiry_payoff,
        line=dict(color="#e5e7eb", width=2.5),
        name="At expiry",
    ))

    # Spot marker
    fig.add_vline(x=spot, line_color="#ffb020", line_width=1.5,
                  line_dash="dash",
                  annotation_text=f"Spot {spot:,.0f}",
                  annotation_position="top")

    # Breakeven markers
    for be in metrics.breakevens:
        fig.add_vline(x=be, line_color="#a78bfa", line_width=0.8,
                      line_dash="dot",
                      annotation_text=f"BE {be:,.0f}",
                      annotation_position="bottom")

    # Zero line
    fig.add_hline(y=0, line_color="#374151", line_width=0.5)

    fig.update_layout(
        title="Payoff Diagram",
        height=500,
        paper_bgcolor="#0a0e14",
        plot_bgcolor="#0a0e14",
        font=dict(color="#e5e7eb"),
        xaxis_title="Underlying price at expiry",
        yaxis_title="P&L (₹)",
        hovermode="x unified",
        legend=dict(bgcolor="rgba(17,22,31,0.8)", bordercolor="#1f2937",
                    borderwidth=1),
    )
    st.plotly_chart(fig, use_container_width=True)


# ================================================================
# Per-leg Greeks table
# ================================================================

def _render_greeks_table(legs: List[Leg], spot: float, T: float,
                         r: float, q: float):
    if not legs:
        return
    rows = []
    for leg in legs:
        g = leg_greeks(leg, spot, T, r, q)
        rows.append({
            "Side": leg.side,
            "Type": leg.option_type,
            "Strike": leg.strike,
            "Lots": leg.quantity,
            "Premium": leg.premium,
            "IV %": leg.iv * 100,
            "Δ": g.delta,
            "Γ": g.gamma,
            "Θ /day": g.theta,
            "Vega /1%": g.vega,
        })
    df = pd.DataFrame(rows)
    st.dataframe(
        df.style.format({
            "Strike": "{:.0f}", "Premium": "{:.2f}", "IV %": "{:.1f}",
            "Δ": "{:+.2f}", "Γ": "{:.5f}",
            "Θ /day": "{:+.0f}", "Vega /1%": "{:+.0f}",
        }),
        use_container_width=True, hide_index=True,
    )


# ================================================================
# Scenario analysis — sliders to stress-test
# ================================================================

def _render_scenario(legs: List[Leg], spot: float, T: float, r: float,
                     sigma: float, q: float):
    """What-if sliders: spot, IV, days to expiry."""
    st.markdown('<div class="section-title">Scenario Analysis</div>',
                unsafe_allow_html=True)
    st.caption("Stress-test the position by shifting spot, IV, or time.")

    c1, c2, c3 = st.columns(3)

    spot_shift_pct = c1.slider(
        "Spot shift %", -10.0, 10.0, 0.0, 0.25,
        help="Percent change in underlying from current spot",
    )
    iv_shift_pct = c2.slider(
        "IV shift (absolute %)", -10.0, 10.0, 0.0, 0.5,
        help="Add/subtract from current IV. e.g., +5 = IV goes from 15% to 20%",
    )
    dte_now = int(T * 365)
    days_left = c3.slider(
        "Days remaining", 0, max(dte_now, 1), dte_now,
        help="Roll time forward (lower = closer to expiry)",
    )

    # Adjusted parameters
    new_spot = spot * (1 + spot_shift_pct / 100)
    new_T = days_to_year(days_left)

    # For each leg, shift its IV by the same absolute amount
    shifted_legs = [
        Leg(strike=l.strike, option_type=l.option_type, side=l.side,
            quantity=l.quantity, premium=l.premium,
            iv=max(0.001, l.iv + iv_shift_pct / 100),
            lot_size=l.lot_size)
        for l in legs
    ]

    if new_T > 0:
        # Mark-to-market value at the shifted scenario
        mtm = sum(leg_value_now(l, new_spot, new_T, r, l.iv, q)
                  for l in shifted_legs)
    else:
        mtm = sum(leg_payoff_at_expiry(l, new_spot) for l in shifted_legs)

    shifted_greeks = Greeks()
    for l in shifted_legs:
        shifted_greeks = shifted_greeks + leg_greeks(l, new_spot, max(new_T, 1e-6), r, q)

    from pro_market_analyzer import metric_card
    cols = st.columns(5)
    cols[0].markdown(metric_card("Scenario spot", f"{new_spot:,.0f}",
                                 f"{spot_shift_pct:+.2f}%",
                                 "up" if spot_shift_pct > 0 else "dn"),
                     unsafe_allow_html=True)
    cols[1].markdown(metric_card("Avg IV", f"{(sum(l.iv for l in shifted_legs)/len(shifted_legs))*100:.1f}%",
                                 f"{iv_shift_pct:+.1f}%",
                                 "up" if iv_shift_pct > 0 else "dn"),
                     unsafe_allow_html=True)
    cols[2].markdown(metric_card("Days left", str(days_left),
                                 f"{days_left - dte_now:+d}d",
                                 "dn" if days_left < dte_now else "up"),
                     unsafe_allow_html=True)
    cols[3].markdown(metric_card("Scenario P&L", _fmt_money(mtm),
                                 "", "up" if mtm >= 0 else "dn"),
                     unsafe_allow_html=True)
    cols[4].markdown(metric_card("Scenario Δ", f"{shifted_greeks.delta:+.2f}"),
                     unsafe_allow_html=True)


# ================================================================
# IV Rank widget
# ================================================================

def _render_iv_rank_widget(symbol: str, spot: float, expiry: str,
                           chain_df: pd.DataFrame):
    """Show IV Rank, IV Percentile, and historical chart."""
    from pro_market_analyzer import metric_card

    step = _strike_step(symbol)
    atm = _atm_strike(spot, step)
    atm_ce_iv = _chain_lookup(chain_df, expiry, atm, "CE")[1]
    atm_pe_iv = _chain_lookup(chain_df, expiry, atm, "PE")[1]
    atm_ivs = [iv for iv in (atm_ce_iv, atm_pe_iv) if iv > 0]
    today_iv = (sum(atm_ivs) / len(atm_ivs)) * 100 if atm_ivs else 0

    history = get_history(symbol, days=365)
    metrics = compute_iv_metrics(history, today_iv) if today_iv > 0 else None

    with st.expander(
        f"📈 IV Rank — {symbol} ATM IV is **{today_iv:.1f}%**"
        + (f" · Rank **{metrics['iv_rank']:.0f}**" if metrics and metrics["iv_rank"] is not None else ""),
        expanded=False,
    ):
        if not metrics or metrics["iv_rank"] is None:
            st.info(
                f"Building IV history. Current sample: "
                f"{metrics['days_of_data'] if metrics else 0} days. "
                "Visit this tab daily during market hours to build the dataset. "
                "After ~30 days you'll see meaningful rank/percentile."
            )
            return

        cols = st.columns(5)
        rank_dir = "up" if metrics["iv_rank"] >= 50 else "dn"
        pct_dir = "up" if metrics["iv_percentile"] >= 50 else "dn"
        cols[0].markdown(metric_card("Today IV", f"{today_iv:.1f}%"),
                         unsafe_allow_html=True)
        cols[1].markdown(metric_card("IV Rank",
                                     f"{metrics['iv_rank']:.0f}",
                                     "of 100", rank_dir),
                         unsafe_allow_html=True)
        cols[2].markdown(metric_card("IV Percentile",
                                     f"{metrics['iv_percentile']:.0f}%",
                                     "of days", pct_dir),
                         unsafe_allow_html=True)
        cols[3].markdown(metric_card("52w Range",
                                     f"{metrics['iv_low']:.1f}–{metrics['iv_high']:.1f}%"),
                         unsafe_allow_html=True)
        cols[4].markdown(metric_card("Sample",
                                     f"{metrics['days_of_data']}d"),
                         unsafe_allow_html=True)

        label, advice = interpret_iv_rank(metrics["iv_rank"])
        if metrics["iv_rank"] >= 75:
            st.warning(f"**{label}** — {advice}")
        elif metrics["iv_rank"] < 25:
            st.success(f"**{label}** — {advice}")
        else:
            st.info(f"**{label}** — {advice}")

        # Historical chart
        if go is not None and len(history) >= 5:
            fig = go.Figure()
            fig.add_trace(go.Scatter(
                x=history["date"], y=history["atm_iv"],
                line=dict(color="#22d3ee", width=2),
                name="ATM IV %",
                fill="tozeroy", fillcolor="rgba(34,211,238,0.08)",
            ))
            fig.add_hline(y=today_iv, line_color="#ffb020",
                          line_dash="dash", line_width=1.5,
                          annotation_text=f"Today {today_iv:.1f}%",
                          annotation_position="right")
            fig.add_hline(y=metrics["iv_mean"], line_color="#6b7280",
                          line_dash="dot", line_width=0.8,
                          annotation_text=f"Mean {metrics['iv_mean']:.1f}%",
                          annotation_position="left")
            fig.update_layout(
                height=260, paper_bgcolor="#0a0e14",
                plot_bgcolor="#0a0e14", font=dict(color="#e5e7eb"),
                yaxis_title="ATM IV (%)", xaxis_title="",
                margin=dict(l=10, r=10, t=10, b=10),
                showlegend=False,
            )
            st.plotly_chart(fig, use_container_width=True)


# ================================================================
# Live ticker hook — refresh leg premiums from WebSocket/chain
# ================================================================

def _live_refresh_legs(legs: List[Leg], chain_df: pd.DataFrame,
                      expiry: str, ticker=None,
                      option_tokens_map: Optional[Dict] = None) -> List[Leg]:
    """
    Return a new list of legs with current LTPs.
    Tries WebSocket first (sub-second), falls back to chain (30s cache).

    Note: this only updates `premium` for downstream calculations like
    payoff chart. The entry premium is preserved in saved positions.
    Use this for "what is this position worth right now?" not "what did
    I pay?"
    """
    rev_tokens = {}
    if ticker and option_tokens_map:
        for tok, info in option_tokens_map.items():
            rev_tokens[(info["strike"], info["side"])] = tok

    refreshed = []
    for leg in legs:
        new_premium = leg.premium
        new_iv = leg.iv

        # 1. WebSocket
        if rev_tokens and (leg.strike, leg.option_type) in rev_tokens:
            tok = rev_tokens[(leg.strike, leg.option_type)]
            snap = ticker.latest(tok) if ticker else None
            if snap and snap.last_price > 0:
                new_premium = snap.last_price

        # 2. Chain
        else:
            ltp, iv = _chain_lookup(chain_df, expiry, leg.strike,
                                    leg.option_type)
            if ltp > 0:
                new_premium = ltp
            if iv > 0:
                new_iv = iv

        refreshed.append(Leg(
            strike=leg.strike, option_type=leg.option_type, side=leg.side,
            quantity=leg.quantity, premium=new_premium, iv=new_iv,
            lot_size=leg.lot_size,
        ))
    return refreshed


# ================================================================
# Save as Position — bridge to Trade Simulator
# ================================================================

def _render_save_position(legs: List[Leg], name: str, expiry: str,
                          underlying: float, net_cost: float):
    """Modal-ish form to save the current strategy as an open virtual position."""
    with st.expander("💾 Save as virtual position (tracked in Trade Simulator)"):
        st.caption(
            "Saves the current legs + entry premiums to local DB. Track real-time "
            "P&L in the Trade Simulator tab."
        )
        c1, c2 = st.columns([2, 1])
        pos_name = c1.text_input(
            "Position name",
            value=f"{name} {expiry} "
                  f"{st.session_state.get('current_preset_name', 'Custom')}",
            key="save_pos_name",
        )
        notes = c1.text_area("Notes (optional)", height=80,
                             key="save_pos_notes",
                             placeholder="Why this trade? What's the thesis?")
        c2.metric("Entry cost",
                  f"₹{abs(net_cost):,.0f} "
                  f"{'credit' if net_cost < 0 else 'debit'}")
        c2.metric("Entry spot", f"{underlying:,.0f}")

        if c2.button("✓ Save", type="primary", use_container_width=True):
            try:
                pid = save_strategy(
                    name=pos_name,
                    symbol=name,
                    expiry=expiry,
                    legs=legs,
                    entry_spot=underlying,
                    notes=notes or "",
                )
                st.success(f"Saved as position #{pid}. "
                           "Switch to **Trade Simulator** tab to track P&L live.")
            except Exception as e:
                st.error(f"Save failed: {e}")


# ================================================================
# Main tab entry point
# ================================================================

def tab_strategy_builder(fetch_option_chain_fn, parse_option_chain_fn,
                         yf_quote_fn=None, ticker=None):
    """
    Main entry. Pass the chain-fetching functions from the parent module
    to avoid duplicating that logic here.

    Parameters
    ----------
    fetch_option_chain_fn : callable(symbol) -> raw chain dict from NSE
    parse_option_chain_fn : callable(raw) -> (df, meta) parsed chain
    yf_quote_fn : optional callable for yfinance quote (unused for now)
    ticker : optional TickerWorker instance from kite_ticker.get_ticker().
        When provided AND live mode toggle is on, leg premiums refresh
        sub-second instead of every 30s from the chain.
    """
    st.markdown('<div class="section-title">Multi-Leg Strategy Builder</div>',
                unsafe_allow_html=True)

    # Initialize legs in session state
    if "strategy_legs" not in st.session_state:
        st.session_state["strategy_legs"] = []

    # ----- Underlying & expiry selector -----
    c1, c2, c3, c4 = st.columns([1.5, 2, 1, 1])
    name = c1.selectbox("Underlying",
                        ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"],
                        key="strat_underlying")

    raw = fetch_option_chain_fn(name)
    if not raw:
        st.error("Could not load option chain. NSE may be rate-limited.")
        return

    chain_df, chain_meta = parse_option_chain_fn(raw)
    if chain_df.empty:
        st.warning("Empty option chain.")
        return

    underlying = float(chain_meta.get("underlying", 0))
    expiries = chain_meta.get("expiries", [])
    expiry = c2.selectbox("Expiry", expiries, key="strat_expiry") if expiries else None

    # Days to expiry
    expiry_date = parse_expiry(expiry) if expiry else None
    dte = max((expiry_date - date.today()).days, 0) if expiry_date else 30
    c3.markdown(
        f'<div style="padding-top:32px;font-family:JetBrains Mono,monospace;'
        f'color:#22d3ee">{dte}d</div>',
        unsafe_allow_html=True,
    )

    lot_size = LOT_SIZES.get(name, 75)
    c4.markdown(
        f'<div style="padding-top:32px;font-family:JetBrains Mono,monospace;'
        f'color:#22d3ee">Lot {lot_size}</div>',
        unsafe_allow_html=True,
    )

    # Filter chain to selected expiry only for downstream lookups
    chain_at_expiry = chain_df[chain_df["expiry"] == expiry] if expiry else chain_df

    # ----- Record today's ATM IV for historical tracking -----
    # (silent — runs once per render, db handles idempotency)
    if underlying > 0 and expiry:
        step = _strike_step(name)
        atm = _atm_strike(underlying, step)
        atm_ce_iv = _chain_lookup(chain_df, expiry, atm, "CE")[1]
        atm_pe_iv = _chain_lookup(chain_df, expiry, atm, "PE")[1]
        # Average ATM CE and PE IV
        atm_ivs = [iv for iv in (atm_ce_iv, atm_pe_iv) if iv > 0]
        if atm_ivs:
            atm_iv_pct = (sum(atm_ivs) / len(atm_ivs)) * 100
            try:
                record_atm_iv(name, atm_iv_pct, underlying, atm, expiry)
            except Exception:
                pass   # don't break the UI on DB errors

    # ----- IV Rank widget -----
    _render_iv_rank_widget(name, underlying, expiry, chain_df)

    # ----- Preset bar -----
    st.markdown('<div class="section-title">Strategy Presets</div>',
                unsafe_allow_html=True)
    preset_cols = st.columns(5)
    preset_names = list(PRESETS.keys())
    for i, p in enumerate(preset_names):
        col = preset_cols[i % 5]
        if col.button(p, key=f"preset_{p}", use_container_width=True,
                      help=PRESETS[p]):
            st.session_state["strategy_legs"] = _load_preset(
                p, underlying, name, chain_df, expiry, lot_size
            )
            st.session_state["current_preset_name"] = p
            st.rerun()

    current_preset = st.session_state.get("current_preset_name")
    if current_preset:
        st.caption(f"📋 Current preset: **{current_preset}** — {PRESETS[current_preset]}")

    # ----- Manual leg controls -----
    btn_cols = st.columns([1, 1, 1, 3])
    if btn_cols[0].button("➕ Add Leg", use_container_width=True):
        atm = _atm_strike(underlying, _strike_step(name))
        ltp, iv = _chain_lookup(chain_df, expiry, atm, "CE")
        st.session_state["strategy_legs"].append(
            Leg(strike=atm, option_type="CE", side="BUY", quantity=1,
                premium=ltp, iv=iv, lot_size=lot_size)
        )
        st.rerun()
    if btn_cols[1].button("🧹 Clear All", use_container_width=True):
        st.session_state["strategy_legs"] = []
        st.session_state.pop("current_preset_name", None)
        st.rerun()
    live_mode = btn_cols[2].toggle(
        "🔴 Live",
        value=st.session_state.get("strat_live_mode", False),
        key="strat_live_mode",
        help="When ON, leg premiums refresh from WebSocket (sub-second) "
             "or chain (30s). Greeks and payoff auto-update.",
    )

    # ----- Leg editor -----
    legs = _render_leg_editor(
        st.session_state["strategy_legs"], chain_df, expiry, lot_size
    )
    st.session_state["strategy_legs"] = legs

    if not legs:
        st.info("Add legs above to see metrics, payoff diagram, and Greeks.")
        return

    # ----- Apply live refresh if enabled -----
    # Note: we don't overwrite session state (preserves user-entered IVs).
    # Live legs are a derived view used only for display.
    if live_mode:
        live_legs = _live_refresh_legs(
            legs, chain_df, expiry,
            ticker=ticker,
            option_tokens_map=st.session_state.get("live_option_tokens", {}),
        )
        display_legs = live_legs
        st.caption(
            "🔴 Live mode ON. Premiums refresh from "
            + ("WebSocket + " if ticker and ticker.is_connected() else "")
            + "NSE chain. Hit Streamlit's rerun (or use autorefresh) to see updates."
        )
    else:
        display_legs = legs

    # ----- Compute metrics -----
    T = days_to_year(dte) if dte > 0 else 1/365   # avoid zero-T edge case
    r = DEFAULT_RISK_FREE_RATE
    q = DEFAULT_DIVIDEND_YIELD

    # Average IV for use in PoP calc and as fallback for T+0 curve
    valid_ivs = [l.iv for l in display_legs if l.iv > 0]
    avg_iv = sum(valid_ivs) / len(valid_ivs) if valid_ivs else 0.15

    # Wider grid for big spreads / butterflies — auto-scale
    spread = max(abs(l.strike - underlying) for l in display_legs) if display_legs else underlying * 0.1
    price_range = (underlying - max(spread * 2, underlying * 0.15),
                   underlying + max(spread * 2, underlying * 0.15))

    metrics = compute_strategy_metrics(
        display_legs, underlying, T, r, avg_iv, q, price_range=price_range
    )

    # ----- Metrics row -----
    _render_metrics(metrics, display_legs)

    # ----- Payoff chart -----
    _render_payoff_chart(display_legs, metrics, underlying, T, r, avg_iv, q)

    # ----- Per-leg Greeks -----
    st.markdown('<div class="section-title">Per-Leg Greeks</div>',
                unsafe_allow_html=True)
    _render_greeks_table(display_legs, underlying, T, r, q)

    # ----- Scenario analysis -----
    _render_scenario(display_legs, underlying, T, r, avg_iv, q)

    # ----- Save as virtual position -----
    _render_save_position(legs, name, expiry, underlying, metrics.net_cost)

    # ----- Trade ticket preview -----
    with st.expander("📋 Trade ticket preview (paste-ready)"):
        for l in legs:
            sign = "+" if l.side == "BUY" else "-"
            st.code(
                f"{sign}{l.quantity}× {name} {expiry} "
                f"{int(l.strike)} {l.option_type} @ ₹{l.premium:.2f}",
                language="text",
            )
        total_qty = sum(l.quantity for l in legs)
        st.caption(
            f"Total: {len(legs)} legs, {total_qty} lots, "
            f"{total_qty * lot_size} contracts. "
            f"Net {'credit' if metrics.net_cost < 0 else 'debit'}: "
            f"{_fmt_money(abs(metrics.net_cost))}"
        )
