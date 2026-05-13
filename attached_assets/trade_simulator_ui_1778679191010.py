"""
================================================================
TRADE SIMULATOR UI — Live P&L tracking for saved positions
================================================================
Streamlit tab that loads saved virtual positions from SQLite and
marks them to market in real time. Data flow:

   SQLite (saved_positions) ─┐
                             ▼
                    ┌──────────────────┐
   NSE chain ─────► │  mark_to_market  │ ──► Per-leg P&L
   KiteTicker ────► │   (trade_sim)    │     Net P&L
   Black-Scholes ─► └──────────────────┘     Greeks now

Three data-source priorities (in order):
  1. KiteTicker WebSocket (sub-second, if connected)
  2. NSE option chain (30s cache)
  3. Black-Scholes theoretical (always works)
================================================================
"""

from __future__ import annotations

from datetime import date
from typing import Dict, List, Optional

import numpy as np
import pandas as pd
import streamlit as st

try:
    import plotly.graph_objects as go
except Exception:
    go = None

from options_math import (
    Leg, days_to_year, payoff_at_price,
    DEFAULT_RISK_FREE_RATE, DEFAULT_DIVIDEND_YIELD,
    LOT_SIZES, parse_expiry, compute_strategy_metrics,
)
from trade_simulator import (
    deserialize_legs, mark_to_market,
    list_open_positions, list_all_positions,
    close_position, delete_position,
)


# ================================================================
# Helpers
# ================================================================

def _fmt_money(x: float) -> str:
    if x is None or (isinstance(x, float) and (np.isnan(x) or np.isinf(x))):
        return "—"
    if abs(x) >= 1e7:
        return f"₹{x/1e7:+.2f}Cr"
    if abs(x) >= 1e5:
        return f"₹{x/1e5:+.2f}L"
    return f"₹{x:+,.0f}"


def _chain_lookup_factory(chain_df: pd.DataFrame, expiry: str):
    """Return a closure that looks up (LTP, IV) for any (strike, side)."""
    def lookup(strike: float, side: str):
        if chain_df is None or chain_df.empty:
            return 0.0, 0.0
        row = chain_df[(chain_df["expiry"] == expiry) &
                       (chain_df["strike"] == strike)]
        if row.empty:
            return 0.0, 0.0
        ltp_col = f"{side}_LTP"
        iv_col = f"{side}_IV"
        ltp = float(row[ltp_col].iloc[0]) if ltp_col in row.columns else 0.0
        iv = float(row[iv_col].iloc[0]) / 100 if iv_col in row.columns else 0.0
        return ltp, iv
    return lookup


# ================================================================
# Single position card with live MTM
# ================================================================

def _render_position_card(pos: pd.Series, chain_df: pd.DataFrame,
                          spot: float, ticker=None):
    """Render one open position with its live P&L breakdown."""
    from pro_market_analyzer import metric_card

    legs = deserialize_legs(pos["legs_json"])
    entry_cost = float(pos["entry_cost"])
    entry_spot = float(pos["entry_spot"])
    expiry = pos["expiry"]
    symbol = pos["symbol"]
    expiry_date = parse_expiry(expiry)
    dte = max((expiry_date - date.today()).days, 0) if expiry_date else 7

    # Chain lookup for this expiry
    chain_at_expiry = (chain_df[chain_df["expiry"] == expiry]
                       if chain_df is not None and not chain_df.empty
                       else pd.DataFrame())
    chain_lookup = _chain_lookup_factory(chain_at_expiry, expiry)

    # Get option tokens map from session state (if user subscribed via Live Ticker tab)
    option_tokens_map = st.session_state.get("live_option_tokens", {})

    # Mark to market
    mtm = mark_to_market(
        legs, spot=spot,
        chain_lookup_fn=chain_lookup,
        ticker=ticker,
        option_tokens_map=option_tokens_map,
        days_to_expiry=dte,
    )

    total_pnl = mtm["total_pnl"]
    sources = mtm["data_sources"]

    with st.container(border=True):
        # Header
        head_cols = st.columns([3, 1, 1, 1])
        head_cols[0].markdown(
            f"### {pos['name']}\n"
            f"<span style='color:#6b7280;font-family:JetBrains Mono,monospace;font-size:12px;'>"
            f"{symbol} · {expiry} · {dte}d to expiry · "
            f"opened {pos['created_at'][:16].replace('T', ' ')}"
            f"</span>",
            unsafe_allow_html=True,
        )

        # P&L summary
        pnl_pct = (total_pnl / abs(entry_cost) * 100) if abs(entry_cost) > 0 else 0
        pnl_dir = "up" if total_pnl >= 0 else "dn"
        head_cols[1].markdown(metric_card("Current P&L", _fmt_money(total_pnl),
                                          f"{pnl_pct:+.1f}%", pnl_dir),
                              unsafe_allow_html=True)
        head_cols[2].markdown(metric_card("Entry",
                                          f"₹{abs(entry_cost):,.0f} "
                                          f"{'cr' if entry_cost < 0 else 'db'}"),
                              unsafe_allow_html=True)
        spot_chg = (spot - entry_spot) / entry_spot * 100
        head_cols[3].markdown(metric_card("Spot move",
                                          f"{spot_chg:+.2f}%",
                                          f"{entry_spot:.0f} → {spot:.0f}",
                                          "up" if spot_chg > 0 else "dn"),
                              unsafe_allow_html=True)

        # Per-leg breakdown
        st.markdown("**Legs:**")
        leg_rows = []
        for leg_data in mtm["per_leg"]:
            leg_rows.append({
                "": leg_data["side"],
                "Type": leg_data["type"],
                "Strike": int(leg_data["strike"]),
                "Lots": leg_data["qty"],
                "Entry ₹": leg_data["entry_price"],
                "Current ₹": leg_data["current_price"],
                "Δ Price": leg_data["current_price"] - leg_data["entry_price"],
                "P&L ₹": leg_data["pnl"],
                "Src": leg_data["source"],
            })
        leg_df = pd.DataFrame(leg_rows)

        def color_pnl(val):
            try:
                v = float(val)
                if v > 0:
                    return "color:#00d68f"
                if v < 0:
                    return "color:#ff4d6d"
            except (ValueError, TypeError):
                pass
            return ""

        st.dataframe(
            leg_df.style.format({
                "Entry ₹": "{:.2f}", "Current ₹": "{:.2f}",
                "Δ Price": "{:+.2f}", "P&L ₹": "{:+,.0f}",
            }).map(color_pnl, subset=["Δ Price", "P&L ₹"]),
            use_container_width=True, hide_index=True,
        )

        # Notes
        if pos.get("notes"):
            st.caption(f"💭 {pos['notes']}")

        # Data source indicators
        src_str = ", ".join(sorted(sources))
        st.caption(
            f"📡 Data sources: **{src_str}** "
            f"(WS=WebSocket tick, CHAIN=NSE 30s, BS=Black-Scholes)"
        )

        # Actions
        act_cols = st.columns([1, 1, 1, 4])
        if act_cols[0].button("✓ Close position",
                              key=f"close_{pos['id']}",
                              type="primary",
                              help="Mark closed with current P&L as realized"):
            close_position(int(pos["id"]), total_pnl)
            st.success(f"Closed with P&L {_fmt_money(total_pnl)}")
            st.rerun()
        if act_cols[1].button("🗑 Delete",
                              key=f"del_{pos['id']}",
                              help="Permanently remove from DB"):
            delete_position(int(pos["id"]))
            st.rerun()

    return total_pnl


# ================================================================
# Mini payoff projection (shows expiry breakeven vs current spot)
# ================================================================

def _render_position_payoff(pos: pd.Series, spot: float):
    """Small payoff chart showing entry profile + current spot marker."""
    if go is None:
        return
    legs = deserialize_legs(pos["legs_json"])
    entry_spot = float(pos["entry_spot"])

    spread = max(abs(l.strike - entry_spot) for l in legs)
    price_range = (entry_spot - max(spread * 1.5, entry_spot * 0.10),
                   entry_spot + max(spread * 1.5, entry_spot * 0.10))

    expiry_date = parse_expiry(pos["expiry"])
    dte = max((expiry_date - date.today()).days, 0) if expiry_date else 7
    T = days_to_year(max(dte, 1)) if dte > 0 else 1/365
    valid_ivs = [l.iv for l in legs if l.iv > 0]
    avg_iv = sum(valid_ivs) / len(valid_ivs) if valid_ivs else 0.15

    m = compute_strategy_metrics(
        legs, entry_spot, T, DEFAULT_RISK_FREE_RATE, avg_iv,
        DEFAULT_DIVIDEND_YIELD, price_range=price_range,
    )

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=m.price_grid,
        y=np.where(m.payoff_curve >= 0, m.payoff_curve, 0),
        fill="tozeroy", fillcolor="rgba(0,214,143,0.15)",
        line=dict(width=0), showlegend=False,
    ))
    fig.add_trace(go.Scatter(
        x=m.price_grid,
        y=np.where(m.payoff_curve < 0, m.payoff_curve, 0),
        fill="tozeroy", fillcolor="rgba(255,77,109,0.15)",
        line=dict(width=0), showlegend=False,
    ))
    fig.add_trace(go.Scatter(
        x=m.price_grid, y=m.payoff_curve,
        line=dict(color="#e5e7eb", width=2),
        name="At expiry",
    ))
    fig.add_vline(x=entry_spot, line_color="#6b7280", line_width=1,
                  line_dash="dash", annotation_text=f"Entry {entry_spot:.0f}",
                  annotation_position="top left")
    fig.add_vline(x=spot, line_color="#ffb020", line_width=1.5,
                  annotation_text=f"Now {spot:.0f}",
                  annotation_position="top right")
    for be in m.breakevens:
        fig.add_vline(x=be, line_color="#a78bfa", line_width=0.6,
                      line_dash="dot")
    fig.add_hline(y=0, line_color="#374151", line_width=0.5)
    fig.update_layout(
        height=240, paper_bgcolor="#0a0e14", plot_bgcolor="#0a0e14",
        font=dict(color="#e5e7eb"),
        margin=dict(l=10, r=10, t=10, b=10),
        showlegend=False,
        xaxis_title="Spot at expiry", yaxis_title="P&L",
    )
    st.plotly_chart(fig, use_container_width=True)


# ================================================================
# Closed positions history
# ================================================================

def _render_closed_history():
    all_pos = list_all_positions()
    closed = all_pos[all_pos["closed_at"].notna()] if not all_pos.empty else pd.DataFrame()
    if closed.empty:
        st.write("No closed positions yet.")
        return

    closed = closed.copy()
    closed["P&L"] = closed["close_pnl"].astype(float)
    closed["closed_at"] = closed["closed_at"].str[:16].str.replace("T", " ")
    closed["created_at"] = closed["created_at"].str[:16].str.replace("T", " ")

    show_cols = ["name", "symbol", "expiry", "entry_cost", "P&L",
                 "created_at", "closed_at"]
    df = closed[show_cols]

    total_pnl = closed["P&L"].sum()
    n_wins = (closed["P&L"] > 0).sum()
    n_total = len(closed)
    win_rate = (n_wins / n_total * 100) if n_total > 0 else 0
    avg_win = closed[closed["P&L"] > 0]["P&L"].mean() if n_wins > 0 else 0
    avg_loss = closed[closed["P&L"] <= 0]["P&L"].mean() if (n_total - n_wins) > 0 else 0

    from pro_market_analyzer import metric_card
    c1, c2, c3, c4 = st.columns(4)
    c1.markdown(metric_card("Total Realized P&L",
                            _fmt_money(total_pnl),
                            f"{n_total} trades",
                            "up" if total_pnl >= 0 else "dn"),
                unsafe_allow_html=True)
    c2.markdown(metric_card("Win Rate", f"{win_rate:.0f}%",
                            f"{n_wins}W / {n_total - n_wins}L"),
                unsafe_allow_html=True)
    c3.markdown(metric_card("Avg Win", _fmt_money(avg_win) if avg_win else "—"),
                unsafe_allow_html=True)
    c4.markdown(metric_card("Avg Loss",
                            _fmt_money(avg_loss) if avg_loss else "—"),
                unsafe_allow_html=True)

    st.dataframe(
        df.style.format({"entry_cost": "{:+,.0f}", "P&L": "{:+,.0f}"}),
        use_container_width=True, hide_index=True,
    )


# ================================================================
# Main tab
# ================================================================

def tab_trade_simulator(fetch_option_chain_fn, parse_option_chain_fn,
                        ticker=None):
    """
    Main trade simulator tab. Lists open positions, marks them to market,
    shows per-leg P&L, allows close/delete.

    Parameters
    ----------
    fetch_option_chain_fn, parse_option_chain_fn : NSE chain fetchers
    ticker : optional TickerWorker for sub-second updates
    """
    st.markdown('<div class="section-title">Trade Simulator</div>',
                unsafe_allow_html=True)
    st.caption(
        "Virtual positions saved from the Strategy Builder. P&L marks to "
        "market live using WebSocket → NSE chain → Black-Scholes fallback."
    )

    open_pos = list_open_positions()

    # Top summary row
    if not open_pos.empty:
        st.markdown('<div class="section-title">Open Positions</div>',
                    unsafe_allow_html=True)

        # Group positions by symbol so we only fetch each chain once
        chains_by_symbol = {}
        spots_by_symbol = {}
        for sym in open_pos["symbol"].unique():
            raw = fetch_option_chain_fn(sym)
            if raw:
                df, meta = parse_option_chain_fn(raw)
                chains_by_symbol[sym] = df
                spots_by_symbol[sym] = float(meta.get("underlying", 0))

        # Render each position
        total_open_pnl = 0
        for _, pos in open_pos.iterrows():
            sym = pos["symbol"]
            chain_df = chains_by_symbol.get(sym, pd.DataFrame())
            spot = spots_by_symbol.get(sym, float(pos["entry_spot"]))

            cols = st.columns([3, 2])
            with cols[0]:
                pnl = _render_position_card(pos, chain_df, spot, ticker)
                total_open_pnl += pnl
            with cols[1]:
                _render_position_payoff(pos, spot)

        # Aggregate footer
        st.markdown('<div class="section-title">Open Positions Total</div>',
                    unsafe_allow_html=True)
        from pro_market_analyzer import metric_card
        c1, c2, c3 = st.columns(3)
        c1.markdown(metric_card("Total Open P&L",
                                _fmt_money(total_open_pnl),
                                "", "up" if total_open_pnl >= 0 else "dn"),
                    unsafe_allow_html=True)
        c2.markdown(metric_card("Open Positions", str(len(open_pos))),
                    unsafe_allow_html=True)
        ws_state = ("🟢 WS connected" if ticker and ticker.is_connected()
                    else "🔵 NSE chain only")
        c3.markdown(metric_card("Data feed", ws_state),
                    unsafe_allow_html=True)
    else:
        st.info(
            "No open positions. Go to **Strategy Builder**, design a strategy, "
            "and click **💾 Save as virtual position**. It will appear here "
            "with live P&L."
        )

    # Closed history
    st.markdown('<div class="section-title">Closed Positions</div>',
                unsafe_allow_html=True)
    _render_closed_history()
