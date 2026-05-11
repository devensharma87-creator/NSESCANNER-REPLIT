from __future__ import annotations

import math
import os
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import streamlit as st
import yfinance as yf

try:
    import plotly.graph_objects as go
    from plotly.subplots import make_subplots
except Exception:  # pragma: no cover
    go = None
    make_subplots = None


# ================================================================
# PRO SWING STOCK SCANNER - FINAL VERSION
# ================================================================
# Educational/research decision-support tool only.
# It is not investment advice and does not guarantee profit.
# For NSE tickers use suffix .NS, e.g. RELIANCE.NS.
# ================================================================

APP_VERSION = "3.0 Pro Dashboard"
JOURNAL_COLUMNS = [
    "Date",
    "Symbol",
    "Action",
    "Setup",
    "Score",
    "Entry",
    "Stop Loss",
    "Target 1",
    "Target 2",
    "Quantity",
    "Capital Used",
    "Risk Amount",
    "R:R to T1",
    "Status",
    "Exit Price",
    "P/L",
    "Notes",
]

DEFAULT_NSE_WATCHLIST = [
    "RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "INFY", "SBIN", "LT", "AXISBANK",
    "KOTAKBANK", "BHARTIARTL", "ITC", "MARUTI", "SUNPHARMA", "TITAN", "ULTRACEMCO",
    "BAJFINANCE", "ASIANPAINT", "HINDUNILVR", "NTPC", "POWERGRID", "ADANIPORTS",
    "COALINDIA", "ONGC", "M&M", "TATAMOTORS", "TATASTEEL", "JSWSTEEL", "HCLTECH",
    "TECHM", "WIPRO", "GRASIM", "CIPLA", "DRREDDY", "APOLLOHOSP", "DIVISLAB",
]


# ----------------------------
# Data models
# ----------------------------

@dataclass
class Zone:
    lower: float
    upper: float
    label: str
    strength: float = 1.0
    created: str = ""

    @property
    def mid(self) -> float:
        return (self.lower + self.upper) / 2.0

    @property
    def width(self) -> float:
        return abs(self.upper - self.lower)


@dataclass
class ScanConfig:
    lookback_period: str = "2y"
    atr_period: int = 14
    ema_fast: int = 20
    ema_mid: int = 50
    ema_slow: int = 200
    rsi_period: int = 14
    adx_period: int = 14
    zone_lookback: int = 140
    fvg_lookback: int = 120
    volume_profile_days: int = 90
    near_52w_pct: float = 5.0
    buy_zone_atr_buffer: float = 0.75
    min_rr: float = 2.0
    min_score: float = 55.0
    min_avg_value_lakhs: float = 25.0
    capital: float = 500000.0
    risk_per_trade_pct: float = 1.0
    include_fundamentals: bool = True
    market_context_required: bool = False
    use_index_filter: bool = True


# ----------------------------
# Safe helpers
# ----------------------------

def safe_float(x, default: float = np.nan) -> float:
    try:
        if x is None:
            return default
        val = float(x)
        if np.isinf(val):
            return default
        return val
    except Exception:
        return default


def safe_round(x, digits: int = 2):
    val = safe_float(x)
    if np.isnan(val):
        return np.nan
    return round(val, digits)


def pct(x) -> float:
    val = safe_float(x)
    if np.isnan(val):
        return np.nan
    return val * 100.0


def fmt_price(x) -> str:
    val = safe_float(x)
    if np.isnan(val):
        return "NA"
    return f"{val:,.2f}"


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def clean_symbol(symbol: str, suffix: str) -> str:
    s = str(symbol).strip().upper()
    if not s:
        return ""
    # If user already typed an exchange suffix, keep it.
    if "." in s or s.startswith("^"):
        return s
    return f"{s}{suffix}" if suffix else s


def parse_tickers(text: str, suffix: str) -> List[str]:
    parts: List[str] = []
    for token in text.replace("\n", ",").replace(";", ",").split(","):
        s = clean_symbol(token, suffix)
        if s:
            parts.append(s)
    seen = set()
    out = []
    for item in parts:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


def zones_overlap(a: Zone, b: Zone) -> bool:
    return max(a.lower, b.lower) <= min(a.upper, b.upper)


def zone_text(z: Optional[Zone]) -> str:
    if not z:
        return ""
    return f"{z.label}: {z.lower:.2f}-{z.upper:.2f}"


# ----------------------------
# Data fetch
# ----------------------------

@st.cache_data(ttl=60 * 15, show_spinner=False)
def fetch_price_history(symbol: str, period: str = "2y", interval: str = "1d") -> pd.DataFrame:
    try:
        df = yf.download(
            symbol,
            period=period,
            interval=interval,
            auto_adjust=False,
            progress=False,
            threads=False,
        )
    except Exception:
        return pd.DataFrame()

    if df is None or df.empty:
        return pd.DataFrame()

    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [str(c[0]).title() for c in df.columns]
    else:
        df.columns = [str(c).title() for c in df.columns]

    required = ["Open", "High", "Low", "Close", "Volume"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        return pd.DataFrame()

    df = df[required].copy()
    df = df.dropna(subset=["Open", "High", "Low", "Close"])
    df["Volume"] = df["Volume"].fillna(0)
    df = df[df["Volume"] >= 0]
    df.index = pd.to_datetime(df.index)
    return df


@st.cache_data(ttl=60 * 60 * 6, show_spinner=False)
def fetch_fundamentals(symbol: str) -> Dict[str, object]:
    """Compact fundamental snapshot. Data availability varies by exchange."""
    out: Dict[str, object] = {
        "market_cap": np.nan,
        "trailing_pe": np.nan,
        "forward_pe": np.nan,
        "peg_ratio": np.nan,
        "price_to_book": np.nan,
        "debt_to_equity": np.nan,
        "roe": np.nan,
        "roa": np.nan,
        "revenue_growth": np.nan,
        "earnings_growth": np.nan,
        "profit_margins": np.nan,
        "operating_margins": np.nan,
        "free_cashflow": np.nan,
        "sector": "",
        "industry": "",
        "quarterly_revenue_growth_pct": np.nan,
        "quarterly_net_income_growth_pct": np.nan,
        "quarterly_comment": "Data unavailable",
        "fundamental_status": "Unknown",
    }
    try:
        t = yf.Ticker(symbol)
        info = getattr(t, "info", {}) or {}
        mapping = {
            "marketCap": "market_cap",
            "trailingPE": "trailing_pe",
            "forwardPE": "forward_pe",
            "pegRatio": "peg_ratio",
            "priceToBook": "price_to_book",
            "debtToEquity": "debt_to_equity",
            "returnOnEquity": "roe",
            "returnOnAssets": "roa",
            "revenueGrowth": "revenue_growth",
            "earningsGrowth": "earnings_growth",
            "profitMargins": "profit_margins",
            "operatingMargins": "operating_margins",
            "freeCashflow": "free_cashflow",
            "sector": "sector",
            "industry": "industry",
        }
        for src, dst in mapping.items():
            if src in info and info[src] is not None:
                out[dst] = info[src]

        qf = pd.DataFrame()
        for attr in ["quarterly_financials", "quarterly_income_stmt"]:
            try:
                candidate = getattr(t, attr)
                if isinstance(candidate, pd.DataFrame) and not candidate.empty:
                    qf = candidate.copy()
                    break
            except Exception:
                pass

        if not qf.empty and len(qf.columns) >= 2:
            qf.columns = pd.to_datetime(qf.columns, errors="coerce")
            qf = qf.loc[:, qf.columns.notna()].sort_index(axis=1, ascending=False)
            revenue_row = first_existing_index(qf, ["Total Revenue", "Operating Revenue", "Revenue"])
            income_row = first_existing_index(qf, ["Net Income", "Net Income Common Stockholders", "Net Income Applicable To Common Shares"])
            comments: List[str] = []
            if revenue_row and len(qf.loc[revenue_row].dropna()) >= 2:
                vals = qf.loc[revenue_row].dropna()
                latest, previous = safe_float(vals.iloc[0]), safe_float(vals.iloc[1])
                if previous != 0 and not np.isnan(latest) and not np.isnan(previous):
                    gr = (latest - previous) / abs(previous) * 100
                    out["quarterly_revenue_growth_pct"] = gr
                    comments.append(f"QoQ revenue {gr:.1f}%")
            if income_row and len(qf.loc[income_row].dropna()) >= 2:
                vals = qf.loc[income_row].dropna()
                latest, previous = safe_float(vals.iloc[0]), safe_float(vals.iloc[1])
                if previous != 0 and not np.isnan(latest) and not np.isnan(previous):
                    gr = (latest - previous) / abs(previous) * 100
                    out["quarterly_net_income_growth_pct"] = gr
                    comments.append(f"QoQ net income {gr:.1f}%")
            if comments:
                out["quarterly_comment"] = "; ".join(comments)

        f_score, _ = fundamental_score(out)
        if f_score >= 18:
            out["fundamental_status"] = "Strong"
        elif f_score >= 11:
            out["fundamental_status"] = "Acceptable"
        elif f_score >= 5:
            out["fundamental_status"] = "Weak/Mixed"
        else:
            out["fundamental_status"] = "Poor/Unavailable"
    except Exception as exc:
        out["quarterly_comment"] = f"Fundamental fetch failed: {type(exc).__name__}"
        out["fundamental_status"] = "Unavailable"
    return out


def first_existing_index(df: pd.DataFrame, names: List[str]) -> Optional[str]:
    exact = {str(idx).lower().strip(): idx for idx in df.index}
    for name in names:
        if name.lower().strip() in exact:
            return exact[name.lower().strip()]
    # Fuzzy fallback
    for idx in df.index:
        txt = str(idx).lower()
        for name in names:
            if name.lower() in txt:
                return idx
    return None


# ----------------------------
# Indicators
# ----------------------------

def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    high_low = df["High"] - df["Low"]
    high_close = (df["High"] - df["Close"].shift()).abs()
    low_close = (df["Low"] - df["Close"].shift()).abs()
    tr = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()


def adx(df: pd.DataFrame, period: int = 14) -> pd.DataFrame:
    high = df["High"]
    low = df["Low"]
    close = df["Close"]
    up_move = high.diff()
    down_move = -low.diff()
    plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
    minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)
    tr = pd.concat([
        high - low,
        (high - close.shift()).abs(),
        (low - close.shift()).abs(),
    ], axis=1).max(axis=1)
    atr_smoothed = tr.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    plus_di = 100 * pd.Series(plus_dm, index=df.index).ewm(alpha=1 / period, min_periods=period, adjust=False).mean() / atr_smoothed.replace(0, np.nan)
    minus_di = 100 * pd.Series(minus_dm, index=df.index).ewm(alpha=1 / period, min_periods=period, adjust=False).mean() / atr_smoothed.replace(0, np.nan)
    dx = ((plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)) * 100
    out = pd.DataFrame(index=df.index)
    out["ADX"] = dx.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    out["PlusDI"] = plus_di
    out["MinusDI"] = minus_di
    return out


def rolling_vwap(df: pd.DataFrame, window: int = 20) -> pd.Series:
    tp = (df["High"] + df["Low"] + df["Close"]) / 3.0
    pv = tp * df["Volume"]
    vol = df["Volume"].rolling(window).sum().replace(0, np.nan)
    return pv.rolling(window).sum() / vol


def anchored_vwap(df: pd.DataFrame, anchor: str = "month") -> pd.Series:
    x = df.copy()
    tp = (x["High"] + x["Low"] + x["Close"]) / 3.0
    if anchor == "year":
        key = x.index.to_period("Y")
    elif anchor == "quarter":
        key = x.index.to_period("Q")
    else:
        key = x.index.to_period("M")
    pv = tp * x["Volume"]
    return pv.groupby(key).cumsum() / x["Volume"].groupby(key).cumsum().replace(0, np.nan)


def add_indicators(df: pd.DataFrame, cfg: ScanConfig) -> pd.DataFrame:
    out = df.copy()
    out["TP"] = (out["High"] + out["Low"] + out["Close"]) / 3.0
    out["EMA20"] = out["Close"].ewm(span=cfg.ema_fast, adjust=False).mean()
    out["EMA50"] = out["Close"].ewm(span=cfg.ema_mid, adjust=False).mean()
    out["EMA200"] = out["Close"].ewm(span=cfg.ema_slow, adjust=False).mean()
    out["RSI14"] = rsi(out["Close"], cfg.rsi_period)
    out["ATR14"] = atr(out, cfg.atr_period)
    adx_df = adx(out, cfg.adx_period)
    out = out.join(adx_df)
    out["AvgVol20"] = out["Volume"].rolling(20).mean()
    out["AvgValue20"] = (out["Close"] * out["Volume"]).rolling(20).mean()
    out["VolRatio"] = out["Volume"] / out["AvgVol20"].replace(0, np.nan)
    out["52wHigh"] = out["High"].rolling(252, min_periods=120).max()
    out["52wLow"] = out["Low"].rolling(252, min_periods=120).min()
    out["MonthlyAVWAP"] = anchored_vwap(out, "month")
    out["QuarterlyAVWAP"] = anchored_vwap(out, "quarter")
    out["YTDAVWAP"] = anchored_vwap(out, "year")
    out["VWAP20"] = rolling_vwap(out, 20)
    out["High20"] = out["High"].rolling(20).max()
    out["Low20"] = out["Low"].rolling(20).min()
    out["High50"] = out["High"].rolling(50).max()
    out["Low50"] = out["Low"].rolling(50).min()
    return out


# ----------------------------
# Price action / SMC / ICT
# ----------------------------

def find_pivots(df: pd.DataFrame, left: int = 3, right: int = 3) -> Tuple[pd.Series, pd.Series]:
    pivot_high = pd.Series(False, index=df.index)
    pivot_low = pd.Series(False, index=df.index)
    if len(df) < left + right + 1:
        return pivot_high, pivot_low
    highs = df["High"].values
    lows = df["Low"].values
    for i in range(left, len(df) - right):
        h_window = highs[i - left:i + right + 1]
        l_window = lows[i - left:i + right + 1]
        if highs[i] == np.nanmax(h_window) and np.sum(h_window == highs[i]) == 1:
            pivot_high.iloc[i] = True
        if lows[i] == np.nanmin(l_window) and np.sum(l_window == lows[i]) == 1:
            pivot_low.iloc[i] = True
    return pivot_high, pivot_low


def market_structure(df: pd.DataFrame) -> Dict[str, object]:
    ph, pl = find_pivots(df, 3, 3)
    highs = df.loc[ph, "High"].tail(5)
    lows = df.loc[pl, "Low"].tail(5)
    close = safe_float(df["Close"].iloc[-1])
    prev_close = safe_float(df["Close"].iloc[-2]) if len(df) > 1 else close
    last_swing_high = safe_float(highs.iloc[-1]) if not highs.empty else np.nan
    last_swing_low = safe_float(lows.iloc[-1]) if not lows.empty else np.nan

    bos_bull = not np.isnan(last_swing_high) and close > last_swing_high
    bos_bear = not np.isnan(last_swing_low) and close < last_swing_low
    higher_highs = len(highs) >= 2 and highs.iloc[-1] > highs.iloc[-2]
    higher_lows = len(lows) >= 2 and lows.iloc[-1] > lows.iloc[-2]
    lower_highs = len(highs) >= 2 and highs.iloc[-1] < highs.iloc[-2]
    lower_lows = len(lows) >= 2 and lows.iloc[-1] < lows.iloc[-2]

    if bos_bull or (higher_highs and higher_lows):
        bias = "Bullish"
    elif bos_bear or (lower_highs and lower_lows):
        bias = "Bearish"
    else:
        bias = "Sideways"

    bullish_sweep = False
    bearish_sweep = False
    if not np.isnan(last_swing_low):
        bullish_sweep = bool(df["Low"].iloc[-1] < last_swing_low and close > last_swing_low and close > prev_close)
    if not np.isnan(last_swing_high):
        bearish_sweep = bool(df["High"].iloc[-1] > last_swing_high and close < last_swing_high and close < prev_close)

    choch_bull = bias != "Bullish" and not np.isnan(last_swing_high) and close > last_swing_high
    choch_bear = bias != "Bearish" and not np.isnan(last_swing_low) and close < last_swing_low

    return {
        "bias": bias,
        "last_swing_high": last_swing_high,
        "last_swing_low": last_swing_low,
        "bos_bull": bool(bos_bull),
        "bos_bear": bool(bos_bear),
        "bullish_sweep": bool(bullish_sweep),
        "bearish_sweep": bool(bearish_sweep),
        "choch_bull": bool(choch_bull),
        "choch_bear": bool(choch_bear),
    }


def detect_fvg(df: pd.DataFrame, lookback: int = 120) -> Tuple[List[Zone], List[Zone]]:
    x = df.tail(lookback).copy()
    bullish: List[Zone] = []
    bearish: List[Zone] = []
    if len(x) < 3:
        return bullish, bearish
    for i in range(2, len(x)):
        c1 = x.iloc[i - 2]
        c2 = x.iloc[i - 1]
        c3 = x.iloc[i]
        dt = x.index[i].strftime("%Y-%m-%d")
        # Daily ICT approximation: bullish imbalance if candle1 high < candle3 low.
        if c1["High"] < c3["Low"]:
            displacement = abs(c2["Close"] - c2["Open"])
            rng = max(c2["High"] - c2["Low"], 1e-9)
            strength = 1.0 + clamp(displacement / rng, 0, 1.5)
            bullish.append(Zone(lower=safe_float(c1["High"]), upper=safe_float(c3["Low"]), label="Bullish FVG", strength=strength, created=dt))
        # Bearish imbalance if candle1 low > candle3 high.
        if c1["Low"] > c3["High"]:
            displacement = abs(c2["Close"] - c2["Open"])
            rng = max(c2["High"] - c2["Low"], 1e-9)
            strength = 1.0 + clamp(displacement / rng, 0, 1.5)
            bearish.append(Zone(lower=safe_float(c3["High"]), upper=safe_float(c1["Low"]), label="Bearish FVG", strength=strength, created=dt))
    return bullish, bearish


def detect_supply_demand_zones(df: pd.DataFrame, cfg: ScanConfig) -> Tuple[List[Zone], List[Zone]]:
    x = df.tail(cfg.zone_lookback).copy()
    if x.empty:
        return [], []
    ph, pl = find_pivots(x, 3, 3)
    atr_now = safe_float(df["ATR14"].iloc[-1], safe_float((df["High"] - df["Low"]).tail(14).mean()))
    buffer = max(0.30 * atr_now, safe_float(df["Close"].iloc[-1]) * 0.0025)
    avg_vol = x["Volume"].rolling(20).mean()

    demand: List[Zone] = []
    supply: List[Zone] = []
    for idx in x.index[pl]:
        loc = x.index.get_loc(idx)
        row = x.loc[idx]
        next_window = x.iloc[loc + 1: loc + 8]
        displacement = 0.0
        if not next_window.empty:
            displacement = (next_window["High"].max() - row["Low"]) / max(atr_now, 1e-9)
        vol_strength = safe_float(row["Volume"] / avg_vol.loc[idx], 1.0) if idx in avg_vol.index else 1.0
        strength = clamp(0.8 + 0.4 * vol_strength + 0.25 * displacement, 0.5, 4.0)
        lower = safe_float(row["Low"] - buffer)
        upper = safe_float(min(row["Open"], row["Close"]) + buffer)
        if lower < upper:
            demand.append(Zone(lower=lower, upper=upper, label="Demand", strength=strength, created=idx.strftime("%Y-%m-%d")))

    for idx in x.index[ph]:
        loc = x.index.get_loc(idx)
        row = x.loc[idx]
        next_window = x.iloc[loc + 1: loc + 8]
        displacement = 0.0
        if not next_window.empty:
            displacement = (row["High"] - next_window["Low"].min()) / max(atr_now, 1e-9)
        vol_strength = safe_float(row["Volume"] / avg_vol.loc[idx], 1.0) if idx in avg_vol.index else 1.0
        strength = clamp(0.8 + 0.4 * vol_strength + 0.25 * displacement, 0.5, 4.0)
        lower = safe_float(max(row["Open"], row["Close"]) - buffer)
        upper = safe_float(row["High"] + buffer)
        if lower < upper:
            supply.append(Zone(lower=lower, upper=upper, label="Supply", strength=strength, created=idx.strftime("%Y-%m-%d")))

    # Keep meaningful recent/strong zones.
    demand = sorted(demand, key=lambda z: (z.strength, z.created), reverse=True)[:15]
    supply = sorted(supply, key=lambda z: (z.strength, z.created), reverse=True)[:15]
    return demand, supply


def nearest_support_zone(zones: List[Zone], price: float, max_atr_distance: float, atr_now: float) -> Optional[Zone]:
    candidates = []
    for z in zones:
        touching = z.lower <= price <= z.upper
        below = z.upper < price
        if touching or below:
            dist = 0.0 if touching else price - z.upper
            if dist <= max_atr_distance * atr_now:
                candidates.append((dist, -z.strength, z))
    if not candidates:
        return None
    return sorted(candidates, key=lambda x: (x[0], x[1]))[0][2]


def nearest_resistance_zone(zones: List[Zone], price: float, max_atr_distance: float, atr_now: float) -> Optional[Zone]:
    candidates = []
    for z in zones:
        touching = z.lower <= price <= z.upper
        above = z.lower > price
        if touching or above:
            dist = 0.0 if touching else z.lower - price
            if dist <= max_atr_distance * atr_now:
                candidates.append((dist, -z.strength, z))
    if not candidates:
        return None
    return sorted(candidates, key=lambda x: (x[0], x[1]))[0][2]


def fixed_volume_profile(df: pd.DataFrame, days: int = 90, bins: int = 48) -> Dict[str, float]:
    x = df.tail(days).dropna(subset=["High", "Low", "Close", "Volume"]).copy()
    if x.empty or x["High"].max() <= x["Low"].min():
        return {"poc": np.nan, "vah": np.nan, "val": np.nan}
    prices = ((x["High"] + x["Low"] + x["Close"]) / 3.0).values
    volumes = x["Volume"].values
    hist, edges = np.histogram(prices, bins=bins, weights=volumes)
    if hist.sum() <= 0:
        return {"poc": np.nan, "vah": np.nan, "val": np.nan}
    centers = (edges[:-1] + edges[1:]) / 2.0
    poc_idx = int(np.argmax(hist))
    selected = {poc_idx}
    vol_sum = hist[poc_idx]
    total = hist.sum()
    left = poc_idx - 1
    right = poc_idx + 1
    while vol_sum < total * 0.70 and (left >= 0 or right < len(hist)):
        left_vol = hist[left] if left >= 0 else -1
        right_vol = hist[right] if right < len(hist) else -1
        if right_vol >= left_vol:
            selected.add(right)
            vol_sum += max(right_vol, 0)
            right += 1
        else:
            selected.add(left)
            vol_sum += max(left_vol, 0)
            left -= 1
    chosen = centers[list(selected)]
    return {"poc": safe_float(centers[poc_idx]), "val": safe_float(np.min(chosen)), "vah": safe_float(np.max(chosen))}



# ----------------------------
# Advanced confirmation modules
# ----------------------------

def pct_change_over(df: pd.DataFrame, bars: int) -> float:
    if df is None or df.empty or len(df) <= bars:
        return np.nan
    start = safe_float(df["Close"].iloc[-bars-1])
    end = safe_float(df["Close"].iloc[-1])
    if start <= 0 or np.isnan(start) or np.isnan(end):
        return np.nan
    return (end / start - 1.0) * 100.0


def series_slope_pct(series: pd.Series, bars: int = 10) -> float:
    if series is None or len(series.dropna()) <= bars:
        return np.nan
    a = safe_float(series.dropna().iloc[-bars-1])
    b = safe_float(series.dropna().iloc[-1])
    if a == 0 or np.isnan(a) or np.isnan(b):
        return np.nan
    return (b / a - 1.0) * 100.0


def resample_weekly(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame()
    w = pd.DataFrame()
    w["Open"] = df["Open"].resample("W-FRI").first()
    w["High"] = df["High"].resample("W-FRI").max()
    w["Low"] = df["Low"].resample("W-FRI").min()
    w["Close"] = df["Close"].resample("W-FRI").last()
    w["Volume"] = df["Volume"].resample("W-FRI").sum()
    return w.dropna(subset=["Open", "High", "Low", "Close"])


def weekly_confirmation(df: pd.DataFrame) -> Dict[str, object]:
    w = resample_weekly(df)
    if w.empty or len(w) < 40:
        return {"trend": "Unavailable", "rsi": np.nan, "ema10": np.nan, "ema30": np.nan, "comment": "Not enough weekly candles"}
    w = w.copy()
    w["EMA10W"] = w["Close"].ewm(span=10, adjust=False).mean()
    w["EMA30W"] = w["Close"].ewm(span=30, adjust=False).mean()
    w["RSI14W"] = rsi(w["Close"], 14)
    last = w.iloc[-1]
    close = safe_float(last["Close"])
    ema10 = safe_float(last["EMA10W"])
    ema30 = safe_float(last["EMA30W"])
    rsi_w = safe_float(last["RSI14W"])
    ema10_slope = series_slope_pct(w["EMA10W"], 4)
    if close > ema10 > ema30 and ema10_slope > 0:
        trend = "Bullish"
        comment = "Weekly close above rising 10W/30W EMA"
    elif close > ema30 and rsi_w >= 45:
        trend = "Neutral+"
        comment = "Weekly trend acceptable but not fully strong"
    elif close < ema30:
        trend = "Weak"
        comment = "Weekly close below 30W EMA"
    else:
        trend = "Neutral"
        comment = "Weekly structure mixed"
    return {"trend": trend, "rsi": rsi_w, "ema10": ema10, "ema30": ema30, "comment": comment}


def relative_strength_snapshot(stock_df: pd.DataFrame, benchmark_df: Optional[pd.DataFrame]) -> Dict[str, float]:
    out = {"rs20": np.nan, "rs50": np.nan, "rs120": np.nan, "rs_score": 0.0}
    if benchmark_df is None or benchmark_df.empty or stock_df.empty:
        return out
    s = stock_df.copy()
    b = benchmark_df.copy()
    s.index = pd.to_datetime(s.index).normalize()
    b.index = pd.to_datetime(b.index).normalize()
    # Align by available trading dates.
    merged = pd.concat([s["Close"].rename("stock"), b["Close"].rename("bench")], axis=1).dropna()
    if len(merged) < 140:
        return out
    for bars, key in [(20, "rs20"), (50, "rs50"), (120, "rs120")]:
        if len(merged) > bars:
            stock_ret = (merged["stock"].iloc[-1] / merged["stock"].iloc[-bars-1] - 1.0) * 100.0
            bench_ret = (merged["bench"].iloc[-1] / merged["bench"].iloc[-bars-1] - 1.0) * 100.0
            out[key] = stock_ret - bench_ret
    score = 0.0
    if not np.isnan(out["rs20"]):
        score += clamp(out["rs20"], -10, 10) * 0.20
    if not np.isnan(out["rs50"]):
        score += clamp(out["rs50"], -15, 15) * 0.25
    if not np.isnan(out["rs120"]):
        score += clamp(out["rs120"], -25, 25) * 0.15
    out["rs_score"] = round(clamp(score + 5.0, 0, 10), 1)
    return out


def candle_confirmation(df: pd.DataFrame) -> Dict[str, object]:
    if df is None or len(df) < 3:
        return {"signal": "Unavailable", "score": 0.0, "comment": "Not enough candles"}
    c = df.iloc[-1]
    p = df.iloc[-2]
    o, h, l, cl = map(safe_float, [c["Open"], c["High"], c["Low"], c["Close"]])
    po, ph, pl, pcl = map(safe_float, [p["Open"], p["High"], p["Low"], p["Close"]])
    rng = max(h - l, 1e-9)
    body = abs(cl - o)
    upper_wick = h - max(o, cl)
    lower_wick = min(o, cl) - l
    close_location = (cl - l) / rng
    score = 0.0
    signal = "Neutral"
    comment = "No clear bullish candle trigger"
    if cl > o and pcl < po and cl > po and o <= pcl:
        signal, score, comment = "Bullish Engulfing", 3.0, "Bullish engulfing candle"
    elif cl > o and lower_wick >= 1.8 * body and close_location >= 0.60:
        signal, score, comment = "Hammer / Rejection", 2.5, "Lower-wick rejection from support"
    elif cl > ph and close_location >= 0.65:
        signal, score, comment = "Previous High Break", 2.0, "Close broke previous candle high"
    elif cl > o and close_location >= 0.75:
        signal, score, comment = "Strong Bull Close", 1.5, "Close in upper part of candle"
    elif upper_wick >= 2.0 * body and close_location <= 0.45:
        signal, score, comment = "Rejection / Supply Wick", -2.0, "Upper-wick rejection; avoid chasing"
    return {"signal": signal, "score": score, "comment": comment}


def volatility_and_gap_risk(df: pd.DataFrame, atr_now: float, close: float) -> Dict[str, object]:
    out = {"atr_pct": np.nan, "gap_pct": np.nan, "risk_label": "Normal", "warning": ""}
    if close > 0 and not np.isnan(atr_now):
        out["atr_pct"] = atr_now / close * 100.0
    if df is not None and len(df) >= 2:
        today_open = safe_float(df["Open"].iloc[-1])
        prev_close = safe_float(df["Close"].iloc[-2])
        if prev_close > 0:
            out["gap_pct"] = (today_open / prev_close - 1.0) * 100.0
    atr_pct = out["atr_pct"]
    gap_pct = out["gap_pct"]
    warnings = []
    if not np.isnan(atr_pct) and atr_pct > 6.5:
        out["risk_label"] = "High Volatility"
        warnings.append(f"ATR% high: {atr_pct:.1f}%")
    elif not np.isnan(atr_pct) and atr_pct < 0.8:
        out["risk_label"] = "Low Volatility"
        warnings.append(f"ATR% very low: {atr_pct:.1f}%; move may be slow")
    if not np.isnan(gap_pct) and abs(gap_pct) > 3.5:
        out["risk_label"] = "Gap Risk"
        warnings.append(f"Large opening gap: {gap_pct:.1f}%")
    out["warning"] = "; ".join(warnings)
    return out


def setup_quality_grade(score: float, rr: float, weekly_trend: str, rs_score: float, warnings: str) -> str:
    penalty_warning = any(key in str(warnings).lower() for key in ["liquidity low", "inside supply", "bearish structure", "market index context weak"])
    if score >= 78 and rr >= 2 and weekly_trend in ["Bullish", "Neutral+"] and rs_score >= 5.5 and not penalty_warning:
        return "A"
    if score >= 68 and rr >= 1.8 and not penalty_warning:
        return "B+"
    if score >= 58 and rr >= 1.5:
        return "B"
    if score >= 50:
        return "C / Watch Only"
    return "D / Avoid"


def add_action_icons(action: str) -> str:
    txt = str(action)
    if "BUY ZONE" in txt:
        return "🟢 " + txt
    if "BREAKOUT" in txt:
        return "🔵 " + txt
    if "PULLBACK" in txt or "RECLAIM" in txt:
        return "🟡 " + txt
    if "WATCH" in txt:
        return "👀 " + txt
    if "AVOID" in txt:
        return "🔴 " + txt
    return "⚪ " + txt


def inject_custom_css() -> None:
    st.markdown(
        """
        <style>
            .main .block-container {padding-top: 1.2rem; padding-bottom: 2rem; max-width: 1500px;}
            section[data-testid="stSidebar"] {background: linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%);}
            .hero-card {
                border-radius: 24px;
                padding: 26px 28px;
                background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 52%, #0f766e 100%);
                color: white;
                box-shadow: 0 18px 45px rgba(15, 23, 42, .22);
                margin-bottom: 18px;
            }
            .hero-title {font-size: 2.3rem; font-weight: 800; letter-spacing: .02em; margin: 0;}
            .hero-subtitle {font-size: 1.02rem; opacity: .9; margin-top: 8px; max-width: 1100px;}
            .pill-row {display:flex; flex-wrap:wrap; gap:8px; margin-top:16px;}
            .pill {background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.22); border-radius: 999px; padding: 6px 11px; font-size: .82rem;}
            .note-card {border-left: 5px solid #2563eb; background: #eff6ff; padding: 14px 18px; border-radius: 14px; margin: 10px 0 18px 0;}
            div[data-testid="metric-container"] {background:#ffffff; border:1px solid #e5e7eb; border-radius:18px; padding:15px; box-shadow:0 8px 20px rgba(15,23,42,.06);}
            div[data-testid="stDataFrame"] {border-radius: 14px; overflow: hidden;}
            .small-muted {font-size: .86rem; color:#64748b;}
        </style>
        """,
        unsafe_allow_html=True,
    )


def render_hero() -> None:
    st.markdown(
        f"""
        <div class="hero-card">
            <div class="hero-title">📈 Pro Swing Stock Scanner</div>
            <div class="hero-subtitle">Version {APP_VERSION} · Scanner → Ranking → Chart Confirmation → Entry Trigger → Position Size → Journal. Built for swing-trading confluence, not blind tips.</div>
            <div class="pill-row">
                <span class="pill">52-week high/low</span>
                <span class="pill">SMC / ICT / FVG</span>
                <span class="pill">Demand & Supply</span>
                <span class="pill">VWAP + Anchored VWAP</span>
                <span class="pill">Fixed Volume Profile</span>
                <span class="pill">Relative Strength</span>
                <span class="pill">Weekly Trend</span>
                <span class="pill">Fundamentals + Quarterly</span>
                <span class="pill">ATR Risk</span>
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def result_column_config() -> Dict[str, object]:
    return {
        "Score": st.column_config.ProgressColumn("Score", min_value=0, max_value=100, format="%.1f"),
        "Technical Score": st.column_config.NumberColumn("Tech", format="%.1f"),
        "SMC/ICT Score": st.column_config.NumberColumn("SMC", format="%.1f"),
        "VWAP/Volume Score": st.column_config.NumberColumn("VWAP/Vol", format="%.1f"),
        "Fundamental Score": st.column_config.NumberColumn("Fund", format="%.1f"),
        "Relative Strength Score": st.column_config.ProgressColumn("RS Score", min_value=0, max_value=10, format="%.1f"),
        "Close": st.column_config.NumberColumn("Close", format="%.2f"),
        "Entry": st.column_config.NumberColumn("Entry", format="%.2f"),
        "Stop Loss": st.column_config.NumberColumn("Stop", format="%.2f"),
        "Target 1": st.column_config.NumberColumn("T1", format="%.2f"),
        "Target 2": st.column_config.NumberColumn("T2", format="%.2f"),
        "R:R to T1": st.column_config.NumberColumn("R:R", format="%.2f"),
        "ATR %": st.column_config.NumberColumn("ATR %", format="%.2f"),
        "RS 20D": st.column_config.NumberColumn("RS 20D", format="%.2f"),
        "RS 50D": st.column_config.NumberColumn("RS 50D", format="%.2f"),
        "RS 120D": st.column_config.NumberColumn("RS 120D", format="%.2f"),
        "Avg Value Lakhs": st.column_config.NumberColumn("Avg Value ₹L", format="%.1f"),
        "Entry Trigger": st.column_config.TextColumn("Entry Trigger", width="large"),
        "Warnings": st.column_config.TextColumn("Warnings", width="large"),
        "Reasons": st.column_config.TextColumn("Reasons", width="large"),
    }


def score_breakdown_chart(row: pd.Series):
    if go is None:
        return None
    labels = ["Technical", "SMC/ICT", "VWAP/Volume", "Momentum", "Fundamental", "Risk", "Market"]
    values = [
        safe_float(row.get("Technical Score")),
        safe_float(row.get("SMC/ICT Score")),
        safe_float(row.get("VWAP/Volume Score")),
        safe_float(row.get("Momentum Score")),
        safe_float(row.get("Fundamental Score")),
        safe_float(row.get("Risk Score")),
        safe_float(row.get("Market Context Score")),
    ]
    fig = go.Figure(go.Bar(x=labels, y=values, text=[f"{v:.1f}" if not np.isnan(v) else "" for v in values], textposition="outside"))
    fig.update_layout(height=300, margin=dict(l=10, r=10, t=20, b=10), yaxis_title="Score", template="plotly_white")
    return fig

# ----------------------------
# Fundamental scoring
# ----------------------------

def fundamental_score(f: Dict[str, object]) -> Tuple[float, List[str]]:
    score = 0.0
    reasons: List[str] = []
    pe = safe_float(f.get("trailing_pe"))
    pb = safe_float(f.get("price_to_book"))
    de = safe_float(f.get("debt_to_equity"))
    roe = safe_float(f.get("roe"))
    roa = safe_float(f.get("roa"))
    rev_g = safe_float(f.get("revenue_growth"))
    earn_g = safe_float(f.get("earnings_growth"))
    margins = safe_float(f.get("profit_margins"))
    op_margins = safe_float(f.get("operating_margins"))
    q_rev = safe_float(f.get("quarterly_revenue_growth_pct"))
    q_net = safe_float(f.get("quarterly_net_income_growth_pct"))

    if not np.isnan(roe) and roe > 0.15:
        score += 5; reasons.append("ROE strong")
    elif not np.isnan(roe) and roe > 0.08:
        score += 2; reasons.append("ROE acceptable")
    if not np.isnan(roa) and roa > 0.05:
        score += 2; reasons.append("ROA positive")
    if not np.isnan(rev_g) and rev_g > 0.10:
        score += 4; reasons.append("Revenue growth strong")
    elif not np.isnan(rev_g) and rev_g > 0:
        score += 2; reasons.append("Revenue growth positive")
    if not np.isnan(earn_g) and earn_g > 0.10:
        score += 4; reasons.append("Earnings growth strong")
    elif not np.isnan(earn_g) and earn_g > 0:
        score += 2; reasons.append("Earnings growth positive")
    if not np.isnan(margins) and margins > 0.10:
        score += 3; reasons.append("Profit margin healthy")
    if not np.isnan(op_margins) and op_margins > 0.12:
        score += 2; reasons.append("Operating margin healthy")
    if not np.isnan(de) and de < 100:
        score += 3; reasons.append("Debt/equity comfortable")
    elif not np.isnan(de) and de < 180:
        score += 1; reasons.append("Debt/equity acceptable")
    if not np.isnan(pe) and 0 < pe < 40:
        score += 2; reasons.append("P/E not extreme")
    if not np.isnan(pb) and 0 < pb < 8:
        score += 1; reasons.append("P/B acceptable")
    if not np.isnan(q_rev) and q_rev > 0:
        score += 2; reasons.append("Latest quarter revenue improved")
    if not np.isnan(q_net) and q_net > 0:
        score += 2; reasons.append("Latest quarter profit improved")
    return min(score, 30.0), reasons


# ----------------------------
# Trade plan construction
# ----------------------------

def build_buy_zone(
    close: float,
    atr_now: float,
    demand: Optional[Zone],
    fvg: Optional[Zone],
    volume_profile: Dict[str, float],
    ema20: float,
    cfg: ScanConfig,
) -> Tuple[Zone, str]:
    candidates: List[Tuple[float, Zone, str]] = []
    if demand:
        dist = 0 if demand.lower <= close <= demand.upper else abs(close - demand.upper)
        candidates.append((dist, demand, "Demand zone"))
    if fvg:
        dist = 0 if fvg.lower <= close <= fvg.upper else abs(close - fvg.upper)
        candidates.append((dist, fvg, "Bullish FVG"))
    val = safe_float(volume_profile.get("val"))
    poc = safe_float(volume_profile.get("poc"))
    if not np.isnan(val) and not np.isnan(poc):
        z = Zone(lower=val - 0.20 * atr_now, upper=min(poc + 0.20 * atr_now, close + 0.60 * atr_now), label="Volume value area", strength=1.0)
        dist = 0 if z.lower <= close <= z.upper else abs(close - z.upper)
        candidates.append((dist, z, "Volume profile value area"))
    if not np.isnan(ema20):
        z = Zone(lower=ema20 - 0.45 * atr_now, upper=ema20 + 0.45 * atr_now, label="EMA20 mean reversion", strength=0.8)
        candidates.append((abs(close - ema20), z, "EMA20 pullback zone"))

    if candidates:
        candidates = sorted(candidates, key=lambda item: item[0])
        base = candidates[0][1]
        reason = candidates[0][2]
        lower = base.lower - 0.10 * atr_now
        upper = base.upper + cfg.buy_zone_atr_buffer * atr_now
    else:
        lower = close - 0.75 * atr_now
        upper = close + 0.25 * atr_now
        reason = "ATR pullback zone"

    # Do not chase too far above current price.
    upper = min(upper, close + 0.50 * atr_now)
    lower = min(lower, upper - 0.10 * atr_now)
    return Zone(lower=safe_float(lower), upper=safe_float(upper), label="Buy Zone"), reason


def build_stop(entry: float, atr_now: float, demand: Optional[Zone], fvg: Optional[Zone], last_swing_low: float, low_52: float) -> Tuple[float, str]:
    supports = []
    if demand:
        supports.append((demand.lower, "below demand"))
    if fvg:
        supports.append((fvg.lower, "below bullish FVG"))
    if not np.isnan(last_swing_low) and last_swing_low < entry:
        supports.append((last_swing_low, "below swing low"))
    if not np.isnan(low_52) and low_52 < entry:
        supports.append((low_52, "below 52w low"))

    atr_stop = entry - 1.50 * atr_now
    if supports:
        support_level, support_reason = min(supports, key=lambda x: abs(entry - x[0]))
        structural_stop = support_level - 0.25 * atr_now
        stop = max(min(structural_stop, entry - 0.65 * atr_now), atr_stop)
        return safe_float(stop), support_reason
    return safe_float(atr_stop), "ATR stop"


def build_targets(
    entry: float,
    stop: float,
    atr_now: float,
    supply: Optional[Zone],
    last_swing_high: float,
    high_52: float,
    volume_profile: Dict[str, float],
) -> Tuple[float, float, float, str]:
    risk = max(entry - stop, 0.10 * atr_now)
    r2 = entry + 2.0 * risk
    r3 = entry + 3.0 * risk
    potential_resistances = []
    if supply and supply.lower > entry:
        potential_resistances.append((supply.lower, "nearest supply"))
    if not np.isnan(last_swing_high) and last_swing_high > entry:
        potential_resistances.append((last_swing_high, "swing high"))
    vah = safe_float(volume_profile.get("vah"))
    if not np.isnan(vah) and vah > entry:
        potential_resistances.append((vah, "value-area high"))
    if not np.isnan(high_52) and high_52 > entry:
        potential_resistances.append((high_52, "52-week high"))

    target1 = r2
    reason = "2R target"
    if potential_resistances:
        nearest = sorted(potential_resistances, key=lambda x: x[0])[0]
        # Use resistance only if it is not too close; otherwise keep 2R as minimum target.
        if nearest[0] >= entry + 1.2 * risk:
            target1 = min(r2, nearest[0])
            reason = f"{reason} / {nearest[1]}"
    target2 = max(r3, target1 + 0.75 * risk)
    if not np.isnan(high_52) and high_52 > target1:
        target2 = min(max(target2, high_52), entry + 4.5 * risk)
    rr = (target1 - entry) / risk if risk > 0 else np.nan
    return safe_float(target1), safe_float(target2), safe_float(rr), reason


def entry_trigger(
    close: float,
    buy_zone: Zone,
    prev_high: float,
    last_swing_high: float,
    monthly_vwap: float,
    bias: str,
    atr_now: float,
) -> Tuple[str, float]:
    tick = max(0.05, close * 0.0005)
    in_zone = buy_zone.lower <= close <= buy_zone.upper
    above_zone = close > buy_zone.upper
    trigger_price = max(prev_high + tick, close + tick)

    if in_zone:
        trigger = max(prev_high + tick, monthly_vwap if not np.isnan(monthly_vwap) else 0)
        trigger = max(trigger, close + tick * 0.5)
        return f"Buy only after bullish close above previous high / VWAP: {trigger:.2f}", safe_float(trigger)
    if above_zone:
        pullback_level = buy_zone.upper
        breakout = last_swing_high if not np.isnan(last_swing_high) and last_swing_high > close else prev_high + tick
        if bias == "Bullish":
            return f"Wait for pullback to {buy_zone.lower:.2f}-{buy_zone.upper:.2f}, then buy bullish reversal; aggressive breakout above {breakout:.2f}", safe_float(breakout)
        return f"Wait. Buy only after close above swing high {breakout:.2f} or pullback reversal near {pullback_level:.2f}", safe_float(breakout)
    # Price below zone
    reclaim = buy_zone.lower + 0.25 * (buy_zone.upper - buy_zone.lower)
    return f"No buy yet. Wait for reclaim of buy zone and close above {reclaim:.2f}", safe_float(reclaim)


def position_size(capital: float, risk_pct: float, entry: float, stop: float) -> Tuple[int, float, float, float]:
    risk_cap = capital * risk_pct / 100.0
    risk_per_share = max(entry - stop, 0.0)
    if risk_per_share <= 0 or entry <= 0:
        return 0, 0.0, risk_cap, risk_per_share
    qty = math.floor(risk_cap / risk_per_share)
    capital_used = qty * entry
    # Avoid position value larger than available capital.
    if capital_used > capital:
        qty = math.floor(capital / entry)
        capital_used = qty * entry
    actual_risk = qty * risk_per_share
    return int(max(qty, 0)), safe_float(capital_used), safe_float(actual_risk), safe_float(risk_per_share)


# ----------------------------
# Scanner core
# ----------------------------

def analyze_market_context(suffix: str) -> Dict[str, object]:
    if suffix == ".NS":
        index_symbols = {"NIFTY": "^NSEI", "BANKNIFTY": "^NSEBANK"}
    else:
        index_symbols = {"SPY": "SPY", "QQQ": "QQQ"}
    rows = []
    bullish_count = 0
    usable_count = 0
    for name, symbol in index_symbols.items():
        df = fetch_price_history(symbol, period="1y")
        if df.empty or len(df) < 100:
            rows.append({"Index": name, "Symbol": symbol, "Trend": "Unavailable", "Close": np.nan, "RSI14": np.nan, "Comment": "No data"})
            continue
        x = add_indicators(df, ScanConfig(lookback_period="1y"))
        last = x.iloc[-1]
        close = safe_float(last["Close"])
        trend = "Bullish" if close > last["EMA20"] > last["EMA50"] else "Weak" if close < last["EMA50"] else "Neutral"
        if trend == "Bullish":
            bullish_count += 1
        usable_count += 1
        rows.append({
            "Index": name,
            "Symbol": symbol,
            "Trend": trend,
            "Close": round(close, 2),
            "RSI14": round(safe_float(last["RSI14"]), 1),
            "Comment": "Above 20/50 EMA" if trend == "Bullish" else "Below/near key EMAs",
        })
    overall = "Bullish" if usable_count and bullish_count == usable_count else "Neutral" if bullish_count else "Weak"
    benchmark_symbol = index_symbols.get("NIFTY") if suffix == ".NS" else index_symbols.get("SPY")
    return {"overall": overall, "rows": pd.DataFrame(rows), "benchmark_symbol": benchmark_symbol}


def score_and_plan(symbol: str, cfg: ScanConfig, market_bias: str = "Neutral", benchmark_df: Optional[pd.DataFrame] = None) -> Dict[str, object]:
    raw = fetch_price_history(symbol, period=cfg.lookback_period)
    if raw.empty or len(raw) < 220:
        return {"Symbol": symbol, "Status": "Insufficient price data"}

    df = add_indicators(raw, cfg)
    last = df.iloc[-1]
    prev = df.iloc[-2]
    close = safe_float(last["Close"])
    atr_now = safe_float(last["ATR14"], max(close * 0.025, 1.0))
    ema20 = safe_float(last["EMA20"])
    ema50 = safe_float(last["EMA50"])
    ema200 = safe_float(last["EMA200"])
    rsi_now = safe_float(last["RSI14"])
    adx_now = safe_float(last["ADX"])
    plus_di = safe_float(last["PlusDI"])
    minus_di = safe_float(last["MinusDI"])
    vol_ratio = safe_float(last["VolRatio"])
    avg_value_lakhs = safe_float(last["AvgValue20"]) / 100000.0
    monthly_vwap = safe_float(last["MonthlyAVWAP"])
    quarterly_vwap = safe_float(last["QuarterlyAVWAP"])
    ytd_vwap = safe_float(last["YTDAVWAP"])
    vwap20 = safe_float(last["VWAP20"])
    high_52 = safe_float(last["52wHigh"], safe_float(df["High"].tail(252).max()))
    low_52 = safe_float(last["52wLow"], safe_float(df["Low"].tail(252).min()))
    pct_from_52_low = (close / low_52 - 1) * 100 if low_52 and low_52 > 0 else np.nan
    pct_from_52_high = (close / high_52 - 1) * 100 if high_52 and high_52 > 0 else np.nan
    near_low = bool(not np.isnan(pct_from_52_low) and pct_from_52_low <= cfg.near_52w_pct)
    near_high = bool(not np.isnan(pct_from_52_high) and abs(pct_from_52_high) <= cfg.near_52w_pct)

    weekly = weekly_confirmation(raw)
    rs = relative_strength_snapshot(raw, benchmark_df)
    candle = candle_confirmation(df)
    risk_flags = volatility_and_gap_risk(df, atr_now, close)
    ema20_slope = series_slope_pct(df["EMA20"], 10)
    ema50_slope = series_slope_pct(df["EMA50"], 20)
    distance_ema20_atr = (close - ema20) / atr_now if atr_now > 0 else np.nan

    ms = market_structure(df)
    bull_fvgs, bear_fvgs = detect_fvg(df, cfg.fvg_lookback)
    demand_zones, supply_zones = detect_supply_demand_zones(df, cfg)
    vp = fixed_volume_profile(df, cfg.volume_profile_days)
    demand = nearest_support_zone(demand_zones, close, 4.0, atr_now)
    bull_fvg = nearest_support_zone(bull_fvgs, close, 4.0, atr_now)
    supply = nearest_resistance_zone(supply_zones, close, 6.0, atr_now)

    technical_score = 0.0
    smc_score = 0.0
    volume_score = 0.0
    momentum_score = 0.0
    risk_score = 0.0
    context_score = 0.0
    reasons: List[str] = []
    warnings: List[str] = []

    # Trend / market structure score - 25
    if close > ema20 > ema50:
        technical_score += 7; reasons.append("Trend bullish: Close > EMA20 > EMA50")
    elif close > ema20:
        technical_score += 3; reasons.append("Price above EMA20")
    if close > ema200:
        technical_score += 5; reasons.append("Price above EMA200")
    else:
        warnings.append("Below EMA200; higher trend is weak")
    if ms["bias"] == "Bullish":
        technical_score += 6; reasons.append("Bullish market structure")
    elif ms["bias"] == "Sideways":
        technical_score += 2; reasons.append("Sideways structure; breakout needed")
    else:
        warnings.append("Bearish structure")
    if plus_di > minus_di and adx_now >= 18:
        technical_score += 4; reasons.append("ADX/DI confirms upward strength")
    elif adx_now < 15:
        warnings.append("ADX low; trend strength weak")
    if close > safe_float(df["High20"].iloc[-2]):
        technical_score += 3; reasons.append("20-day breakout")
    if str(weekly.get("trend")) == "Bullish":
        technical_score += 5; reasons.append("Weekly trend confirms swing direction")
    elif str(weekly.get("trend")) == "Neutral+":
        technical_score += 2; reasons.append("Weekly trend acceptable")
    elif str(weekly.get("trend")) == "Weak":
        warnings.append("Weekly trend weak")
    if not np.isnan(ema20_slope) and ema20_slope > 0:
        technical_score += 2; reasons.append("EMA20 slope positive")
    if not np.isnan(ema50_slope) and ema50_slope > 0:
        technical_score += 2; reasons.append("EMA50 slope positive")
    if not np.isnan(distance_ema20_atr) and distance_ema20_atr > 2.5:
        warnings.append("Price extended far above EMA20; wait for pullback")
    technical_score = min(technical_score, 34)

    # SMC/ICT/price action - 20
    in_demand = bool(demand and demand.lower <= close <= demand.upper + cfg.buy_zone_atr_buffer * atr_now)
    in_fvg = bool(bull_fvg and bull_fvg.lower <= close <= bull_fvg.upper + cfg.buy_zone_atr_buffer * atr_now)
    if in_demand:
        smc_score += 6; reasons.append(f"Near demand zone from {demand.created}")
    if in_fvg:
        smc_score += 5; reasons.append(f"Near bullish FVG from {bull_fvg.created}")
    if demand and bull_fvg and zones_overlap(demand, bull_fvg):
        smc_score += 4; reasons.append("Demand overlaps bullish FVG")
    if ms["bullish_sweep"]:
        smc_score += 3; reasons.append("Bullish liquidity sweep")
    if ms["choch_bull"]:
        smc_score += 2; reasons.append("Bullish CHoCH/BOS")
    if supply and supply.lower <= close <= supply.upper:
        warnings.append("Price is inside supply; avoid chasing")
    smc_score = min(smc_score, 20)

    # VWAP / fixed volume profile / liquidity - 20
    if close > monthly_vwap:
        volume_score += 4; reasons.append("Above monthly anchored VWAP")
    if close > quarterly_vwap:
        volume_score += 3; reasons.append("Above quarterly anchored VWAP")
    if close > ytd_vwap:
        volume_score += 2; reasons.append("Above YTD anchored VWAP")
    if close > vwap20:
        volume_score += 2; reasons.append("Above 20-day VWAP")
    if not np.isnan(vp["val"]) and vp["val"] <= close <= vp["vah"]:
        volume_score += 3; reasons.append("Inside fixed volume value area")
    if not np.isnan(vp["poc"]) and abs(close - vp["poc"]) <= 1.25 * atr_now:
        volume_score += 2; reasons.append("Near volume POC")
    if not np.isnan(vol_ratio) and vol_ratio > 1.25 and close > safe_float(prev["Close"]):
        volume_score += 4; reasons.append("Positive volume expansion")
    elif not np.isnan(vol_ratio) and vol_ratio >= 0.80:
        volume_score += 1; reasons.append("Volume acceptable")
    if avg_value_lakhs < cfg.min_avg_value_lakhs:
        warnings.append(f"Liquidity low: avg traded value {avg_value_lakhs:.1f} lakhs")
        volume_score -= 4
    if safe_float(rs.get("rs50")) > 0:
        volume_score += 3; reasons.append("50-day relative strength positive vs benchmark")
    if safe_float(rs.get("rs120")) > 0:
        volume_score += 2; reasons.append("120-day relative strength positive vs benchmark")
    if safe_float(rs.get("rs20")) < -3:
        warnings.append("Short-term relative strength weak vs benchmark")
    volume_score = clamp(volume_score, 0, 25)

    # Momentum / 52-week context - 15
    if 45 <= rsi_now <= 68:
        momentum_score += 5; reasons.append("RSI in healthy swing zone")
    elif 35 <= rsi_now < 45:
        momentum_score += 2; reasons.append("RSI recovering")
    elif rsi_now > 75:
        warnings.append("RSI overextended")
    if near_high and close > ema50:
        momentum_score += 5; reasons.append("Near 52-week high with trend strength")
    if near_low and (ms["bullish_sweep"] or close > ema20 or rsi_now > 45):
        momentum_score += 5; reasons.append("Near 52-week low with reversal signs")
    elif not near_low and not near_high:
        momentum_score += 2; reasons.append("Mid-range 52-week location")
    if close > safe_float(prev["High"]):
        momentum_score += 2; reasons.append("Closed above previous candle high")
    if safe_float(candle.get("score")) > 0:
        momentum_score += safe_float(candle.get("score")); reasons.append(str(candle.get("comment")))
    elif safe_float(candle.get("score")) < 0:
        warnings.append(str(candle.get("comment")))
    if not np.isnan(safe_float(risk_flags.get("atr_pct"))) and 1.0 <= safe_float(risk_flags.get("atr_pct")) <= 5.5:
        momentum_score += 1; reasons.append("ATR% suitable for swing trading")
    if risk_flags.get("warning"):
        warnings.append(str(risk_flags.get("warning")))
    momentum_score = min(momentum_score, 21)

    # Fundamentals and quarterly results - 25
    f = fetch_fundamentals(symbol) if cfg.include_fundamentals else {"fundamental_status": "Skipped", "quarterly_comment": "Skipped"}
    f_score, f_reasons = fundamental_score(f) if cfg.include_fundamentals else (0.0, [])
    fundamentals_component = min(f_score, 25)
    reasons.extend(f_reasons[:5])

    # Market context - 5
    if market_bias == "Bullish":
        context_score += 5; reasons.append("Market index context supportive")
    elif market_bias == "Neutral":
        context_score += 2
    else:
        warnings.append("Market index context weak")
        if cfg.market_context_required:
            context_score -= 3
    context_score = clamp(context_score, 0, 5)

    # Buy zone, entry trigger, SL, targets, position sizing
    buy_zone, buy_zone_basis = build_buy_zone(close, atr_now, demand, bull_fvg, vp, ema20, cfg)
    entry = close if buy_zone.lower <= close <= buy_zone.upper else min(close, buy_zone.upper)
    # For breakout trades, planning with trigger price is better than current close.
    trigger_text, trigger_price = entry_trigger(close, buy_zone, safe_float(prev["High"]), safe_float(ms["last_swing_high"]), monthly_vwap, str(ms["bias"]), atr_now)
    if close > buy_zone.upper and str(ms["bias"]) == "Bullish":
        planned_entry = max(trigger_price, close)
    elif buy_zone.lower <= close <= buy_zone.upper:
        planned_entry = max(trigger_price, close)
    else:
        planned_entry = max(trigger_price, buy_zone.lower)

    stop, stop_basis = build_stop(planned_entry, atr_now, demand, bull_fvg, safe_float(ms["last_swing_low"]), low_52)
    t1, t2, rr, target_basis = build_targets(planned_entry, stop, atr_now, supply, safe_float(ms["last_swing_high"]), high_52, vp)
    qty, capital_used, risk_amount, risk_per_share = position_size(cfg.capital, cfg.risk_per_trade_pct, planned_entry, stop)

    if rr >= cfg.min_rr:
        risk_score += 7; reasons.append(f"R:R acceptable: {rr:.2f}R")
    elif rr >= 1.5:
        risk_score += 3; warnings.append(f"R:R moderate: {rr:.2f}R")
    else:
        warnings.append(f"R:R weak: {rr:.2f}R")
    if risk_per_share <= 2.2 * atr_now:
        risk_score += 3
    else:
        warnings.append("Stop distance wide versus ATR")
    risk_score = min(risk_score, 10)

    raw_score = technical_score + smc_score + volume_score + momentum_score + fundamentals_component + context_score + risk_score
    # Normalize from enhanced max 140 to 100.
    final_score = round(clamp(raw_score / 140.0 * 100.0, 0, 100), 1)

    action = classify_action(final_score, close, buy_zone, rr, ms["bias"], warnings, cfg)
    setup = classify_setup(final_score, action, near_low, near_high)

    potential = "High" if final_score >= 75 and rr >= cfg.min_rr else "Medium" if final_score >= 60 else "Low"
    if "AVOID" in action:
        potential = "Low"

    quality_grade = setup_quality_grade(final_score, rr, str(weekly.get("trend")), safe_float(rs.get("rs_score")), " | ".join(warnings))

    return {
        "Symbol": symbol,
        "Status": "OK",
        "Action": action,
        "Setup": setup,
        "Potential": potential,
        "Quality Grade": quality_grade,
        "Action View": add_action_icons(action),
        "Score": final_score,
        "Technical Score": round(technical_score, 1),
        "SMC/ICT Score": round(smc_score, 1),
        "VWAP/Volume Score": round(volume_score, 1),
        "Momentum Score": round(momentum_score, 1),
        "Fundamental Score": round(fundamentals_component, 1),
        "Risk Score": round(risk_score, 1),
        "Market Context Score": round(context_score, 1),
        "Relative Strength Score": safe_float(rs.get("rs_score")),
        "Weekly Trend": weekly.get("trend"),
        "Weekly RSI": round(safe_float(weekly.get("rsi")), 1) if not np.isnan(safe_float(weekly.get("rsi"))) else np.nan,
        "Weekly Comment": weekly.get("comment"),
        "RS 20D": round(safe_float(rs.get("rs20")), 2) if not np.isnan(safe_float(rs.get("rs20"))) else np.nan,
        "RS 50D": round(safe_float(rs.get("rs50")), 2) if not np.isnan(safe_float(rs.get("rs50"))) else np.nan,
        "RS 120D": round(safe_float(rs.get("rs120")), 2) if not np.isnan(safe_float(rs.get("rs120"))) else np.nan,
        "Candle Signal": candle.get("signal"),
        "ATR %": round(safe_float(risk_flags.get("atr_pct")), 2) if not np.isnan(safe_float(risk_flags.get("atr_pct"))) else np.nan,
        "Gap %": round(safe_float(risk_flags.get("gap_pct")), 2) if not np.isnan(safe_float(risk_flags.get("gap_pct"))) else np.nan,
        "Volatility Risk": risk_flags.get("risk_label"),
        "EMA20 Slope %": round(ema20_slope, 2) if not np.isnan(ema20_slope) else np.nan,
        "EMA50 Slope %": round(ema50_slope, 2) if not np.isnan(ema50_slope) else np.nan,
        "Distance from EMA20 ATR": round(distance_ema20_atr, 2) if not np.isnan(distance_ema20_atr) else np.nan,
        "Close": round(close, 2),
        "Buy Zone Lower": round(buy_zone.lower, 2),
        "Buy Zone Upper": round(buy_zone.upper, 2),
        "Buy Zone Basis": buy_zone_basis,
        "Entry Trigger": trigger_text,
        "Trigger Price": round(trigger_price, 2),
        "Entry": round(planned_entry, 2),
        "Stop Loss": round(stop, 2),
        "Stop Basis": stop_basis,
        "Target 1": round(t1, 2),
        "Target 2": round(t2, 2),
        "Target Basis": target_basis,
        "R:R to T1": round(rr, 2) if not np.isnan(rr) else np.nan,
        "Risk/Share": round(risk_per_share, 2),
        "Quantity": qty,
        "Capital Used": round(capital_used, 2),
        "Risk Amount": round(risk_amount, 2),
        "ATR14": round(atr_now, 2),
        "52w Low": round(low_52, 2),
        "% From 52w Low": round(pct_from_52_low, 2),
        "52w High": round(high_52, 2),
        "% From 52w High": round(pct_from_52_high, 2),
        "Near 52w Low": near_low,
        "Near 52w High": near_high,
        "Market Structure": ms["bias"],
        "Last Swing High": round(safe_float(ms["last_swing_high"]), 2) if not np.isnan(safe_float(ms["last_swing_high"])) else np.nan,
        "Last Swing Low": round(safe_float(ms["last_swing_low"]), 2) if not np.isnan(safe_float(ms["last_swing_low"])) else np.nan,
        "RSI14": round(rsi_now, 1),
        "ADX14": round(adx_now, 1),
        "Vol Ratio": round(vol_ratio, 2) if not np.isnan(vol_ratio) else np.nan,
        "Avg Value Lakhs": round(avg_value_lakhs, 1) if not np.isnan(avg_value_lakhs) else np.nan,
        "Monthly AVWAP": round(monthly_vwap, 2) if not np.isnan(monthly_vwap) else np.nan,
        "Quarterly AVWAP": round(quarterly_vwap, 2) if not np.isnan(quarterly_vwap) else np.nan,
        "YTD AVWAP": round(ytd_vwap, 2) if not np.isnan(ytd_vwap) else np.nan,
        "VP POC": round(vp["poc"], 2) if not np.isnan(vp["poc"]) else np.nan,
        "VP VAL": round(vp["val"], 2) if not np.isnan(vp["val"]) else np.nan,
        "VP VAH": round(vp["vah"], 2) if not np.isnan(vp["vah"]) else np.nan,
        "Demand Zone": zone_text(demand),
        "Bullish FVG": zone_text(bull_fvg),
        "Supply Zone": zone_text(supply),
        "Sector": f.get("sector", "") if cfg.include_fundamentals else "",
        "Industry": f.get("industry", "") if cfg.include_fundamentals else "",
        "Fundamental Status": f.get("fundamental_status", "Skipped"),
        "P/E": safe_round(f.get("trailing_pe"), 2) if cfg.include_fundamentals else np.nan,
        "P/B": safe_round(f.get("price_to_book"), 2) if cfg.include_fundamentals else np.nan,
        "Debt/Equity": safe_round(f.get("debt_to_equity"), 2) if cfg.include_fundamentals else np.nan,
        "ROE %": round(pct(f.get("roe")), 2) if cfg.include_fundamentals and not np.isnan(pct(f.get("roe"))) else np.nan,
        "Revenue Growth %": round(pct(f.get("revenue_growth")), 2) if cfg.include_fundamentals and not np.isnan(pct(f.get("revenue_growth"))) else np.nan,
        "Earnings Growth %": round(pct(f.get("earnings_growth")), 2) if cfg.include_fundamentals and not np.isnan(pct(f.get("earnings_growth"))) else np.nan,
        "Quarterly Results": f.get("quarterly_comment", "Skipped") if cfg.include_fundamentals else "Skipped",
        "Warnings": " | ".join(warnings[:8]),
        "Reasons": " | ".join(reasons[:14]),
    }


def classify_action(score: float, close: float, buy_zone: Zone, rr: float, bias: str, warnings: List[str], cfg: ScanConfig) -> str:
    in_zone = buy_zone.lower <= close <= buy_zone.upper
    above_zone = close > buy_zone.upper
    below_zone = close < buy_zone.lower
    weak_warning = any(w.lower().startswith("bearish") or "liquidity low" in w.lower() or "inside supply" in w.lower() for w in warnings)
    if score < 50 or rr < 1.2 or bias == "Bearish" or weak_warning:
        return "AVOID / NO TRADE"
    if score >= 78 and in_zone and rr >= cfg.min_rr:
        return "BUY ZONE - WAIT TRIGGER"
    if score >= 72 and above_zone and rr >= cfg.min_rr:
        return "BUY BREAKOUT / RETEST ONLY"
    if score >= 65 and above_zone:
        return "WAIT FOR PULLBACK"
    if score >= 60 and below_zone:
        return "WAIT FOR RECLAIM"
    if score >= 58:
        return "WATCHLIST"
    return "WAIT FOR CONFIRMATION"


def classify_setup(score: float, action: str, near_low: bool, near_high: bool) -> str:
    if "BUY ZONE" in action and score >= 78:
        return "A+ Buying Zone"
    if "BREAKOUT" in action:
        return "Breakout / Retest Setup"
    if near_low and score >= 60:
        return "52w Low Reversal Setup"
    if near_high and score >= 65:
        return "52w High Momentum Setup"
    if "WATCHLIST" in action:
        return "Watchlist"
    if "AVOID" in action:
        return "Avoid / Weak Setup"
    return "Wait for Confirmation"


# ----------------------------
# Charting
# ----------------------------

def plot_trade_chart(symbol: str, row: pd.Series, cfg: ScanConfig, candles: int = 180):
    if go is None or make_subplots is None:
        st.warning("Plotly is not installed. Install with: pip install plotly")
        return
    df = fetch_price_history(symbol, period=cfg.lookback_period)
    if df.empty:
        st.warning("Chart data unavailable.")
        return
    x = add_indicators(df, cfg).tail(candles)
    fig = make_subplots(
        rows=2,
        cols=1,
        shared_xaxes=True,
        vertical_spacing=0.03,
        row_heights=[0.74, 0.26],
        subplot_titles=("Price Action / VWAP / Trade Plan", "Volume"),
    )
    fig.add_trace(go.Candlestick(
        x=x.index,
        open=x["Open"], high=x["High"], low=x["Low"], close=x["Close"],
        name="Candles",
        increasing_line_color="#16a34a",
        decreasing_line_color="#dc2626",
    ), row=1, col=1)
    line_specs = {
        "EMA20": ("#2563eb", 1.5),
        "EMA50": ("#7c3aed", 1.5),
        "EMA200": ("#111827", 1.7),
        "MonthlyAVWAP": ("#f59e0b", 1.4),
        "QuarterlyAVWAP": ("#0f766e", 1.4),
    }
    for col, (color, width) in line_specs.items():
        if col in x.columns:
            fig.add_trace(go.Scatter(x=x.index, y=x[col], mode="lines", name=col, line=dict(color=color, width=width)), row=1, col=1)

    volume_colors = np.where(x["Close"] >= x["Open"], "#86efac", "#fecaca")
    fig.add_trace(go.Bar(x=x.index, y=x["Volume"], name="Volume", marker_color=volume_colors, opacity=0.75), row=2, col=1)
    if "AvgVol20" in x.columns:
        fig.add_trace(go.Scatter(x=x.index, y=x["AvgVol20"], mode="lines", name="AvgVol20", line=dict(color="#64748b", width=1.2)), row=2, col=1)

    x0 = x.index[0]
    x1 = x.index[-1]
    shapes = []
    annotations = []
    zone_specs = [
        (safe_float(row.get("Buy Zone Lower")), safe_float(row.get("Buy Zone Upper")), "Buy Zone", "rgba(34,197,94,0.18)", "#16a34a"),
        (safe_float(row.get("VP VAL")), safe_float(row.get("VP VAH")), "Value Area", "rgba(245,158,11,0.13)", "#f59e0b"),
    ]
    for y0, y1, label, fill, line_color in zone_specs:
        if np.isnan(y0) or np.isnan(y1):
            continue
        shapes.append(dict(type="rect", xref="x", yref="y", x0=x0, x1=x1, y0=min(y0, y1), y1=max(y0, y1), fillcolor=fill, line=dict(color=line_color, width=1), layer="below"))
        annotations.append(dict(x=x1, y=(y0 + y1) / 2, text=f" {label}", showarrow=False, xanchor="left", bgcolor="rgba(255,255,255,.75)", bordercolor=line_color, font=dict(size=11)))

    levels = [
        (safe_float(row.get("Entry")), "Entry", "#2563eb", "dash"),
        (safe_float(row.get("Stop Loss")), "Stop", "#dc2626", "dot"),
        (safe_float(row.get("Target 1")), "Target 1", "#16a34a", "dash"),
        (safe_float(row.get("Target 2")), "Target 2", "#22c55e", "dash"),
        (safe_float(row.get("VP POC")), "POC", "#f97316", "dot"),
    ]
    for y, label, color, dash in levels:
        if np.isnan(y):
            continue
        shapes.append(dict(type="line", xref="x", yref="y", x0=x0, x1=x1, y0=y, y1=y, line=dict(color=color, width=1.5, dash=dash)))
        annotations.append(dict(x=x1, y=y, text=f" {label} {y:.2f}", showarrow=False, xanchor="left", bgcolor="rgba(255,255,255,.8)", bordercolor=color, font=dict(size=11, color=color)))

    title = f"{symbol} · {row.get('Action', '')} · Score {row.get('Score', '')} · Grade {row.get('Quality Grade', '')}"
    fig.update_layout(
        title=dict(text=title, x=0.01, xanchor="left"),
        xaxis_rangeslider_visible=False,
        height=780,
        shapes=shapes,
        annotations=annotations,
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
        margin=dict(l=20, r=70, t=90, b=20),
        template="plotly_white",
        hovermode="x unified",
    )
    fig.update_yaxes(title_text="Price", row=1, col=1, showgrid=True, gridcolor="rgba(148,163,184,.22)")
    fig.update_yaxes(title_text="Volume", row=2, col=1, showgrid=True, gridcolor="rgba(148,163,184,.22)")
    fig.update_xaxes(showgrid=False)
    st.plotly_chart(fig, use_container_width=True)


# ----------------------------
# Journal utilities
# ----------------------------

def ensure_journal(df: Optional[pd.DataFrame] = None) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame(columns=JOURNAL_COLUMNS)
    out = df.copy()
    for c in JOURNAL_COLUMNS:
        if c not in out.columns:
            out[c] = ""
    return out[JOURNAL_COLUMNS]


def journal_add_candidate(journal: pd.DataFrame, candidate: pd.Series, notes: str = "") -> pd.DataFrame:
    row = {
        "Date": datetime.now().strftime("%Y-%m-%d"),
        "Symbol": candidate.get("Symbol", ""),
        "Action": candidate.get("Action", ""),
        "Setup": candidate.get("Setup", ""),
        "Score": candidate.get("Score", ""),
        "Entry": candidate.get("Entry", ""),
        "Stop Loss": candidate.get("Stop Loss", ""),
        "Target 1": candidate.get("Target 1", ""),
        "Target 2": candidate.get("Target 2", ""),
        "Quantity": candidate.get("Quantity", ""),
        "Capital Used": candidate.get("Capital Used", ""),
        "Risk Amount": candidate.get("Risk Amount", ""),
        "R:R to T1": candidate.get("R:R to T1", ""),
        "Status": "Planned",
        "Exit Price": "",
        "P/L": "",
        "Notes": notes,
    }
    return pd.concat([journal, pd.DataFrame([row])], ignore_index=True)


# ----------------------------
# Streamlit UI
# ----------------------------

def app() -> None:
    st.set_page_config(page_title="Pro Swing Stock Scanner", layout="wide", initial_sidebar_state="expanded")
    inject_custom_css()
    render_hero()

    if "scan_results" not in st.session_state:
        st.session_state.scan_results = pd.DataFrame()
    if "journal" not in st.session_state:
        st.session_state.journal = ensure_journal()

    with st.sidebar:
        st.header("1) Universe")
        suffix = st.selectbox("Market suffix", [".NS", "", ".BO"], index=0, help=".NS=NSE, .BO=BSE, blank=US/other Yahoo symbols")
        watchlist_text = st.text_area(
            "Tickers / Watchlist",
            value=", ".join(DEFAULT_NSE_WATCHLIST),
            height=210,
            help="Comma/newline separated. For NSE, type RELIANCE or RELIANCE.NS.",
        )
        uploaded_watchlist = st.file_uploader("Optional: upload watchlist CSV", type=["csv"], help="CSV may contain Symbol or Ticker column.")
        max_tickers = st.slider("Max tickers per scan", 5, 250, 60, 5)

        st.header("2) Strategy Settings")
        cfg = ScanConfig(
            lookback_period=st.selectbox("History", ["1y", "2y", "5y"], index=1),
            near_52w_pct=st.slider("Near 52w high/low threshold (%)", 1.0, 15.0, 5.0, 0.5),
            min_rr=st.slider("Minimum R:R", 1.0, 4.0, 2.0, 0.25),
            min_score=st.slider("Minimum display score", 0.0, 90.0, 50.0, 5.0),
            zone_lookback=st.slider("Supply/Demand lookback candles", 60, 260, 140, 10),
            fvg_lookback=st.slider("FVG lookback candles", 40, 220, 120, 10),
            volume_profile_days=st.slider("Fixed volume profile days", 30, 220, 90, 10),
            buy_zone_atr_buffer=st.slider("Buy-zone ATR buffer", 0.25, 1.50, 0.75, 0.05),
            min_avg_value_lakhs=st.slider("Min avg traded value, lakhs", 0.0, 1000.0, 25.0, 25.0),
        )

        st.header("3) Risk Management")
        cfg.capital = st.number_input("Trading capital", min_value=10000.0, value=500000.0, step=10000.0)
        cfg.risk_per_trade_pct = st.slider("Risk per trade (%)", 0.25, 5.0, 1.0, 0.25)
        cfg.include_fundamentals = st.checkbox("Include fundamentals / quarterly results", value=True)
        cfg.use_index_filter = st.checkbox("Use NIFTY/SPY market context", value=True)
        cfg.market_context_required = st.checkbox("Strict: avoid buys if market weak", value=False)

        run_scan = st.button("Run Full Scanner", type="primary", use_container_width=True)

    tickers = parse_tickers(watchlist_text, suffix)
    if uploaded_watchlist is not None:
        try:
            wdf = pd.read_csv(uploaded_watchlist)
            col = "Symbol" if "Symbol" in wdf.columns else "Ticker" if "Ticker" in wdf.columns else wdf.columns[0]
            csv_tickers = [clean_symbol(x, suffix) for x in wdf[col].dropna().astype(str).tolist()]
            tickers.extend(csv_tickers)
        except Exception as exc:
            st.sidebar.warning(f"Watchlist CSV could not be read: {exc}")
    tickers = list(dict.fromkeys([t for t in tickers if t]))[:max_tickers]

    st.markdown(
        """<div class="note-card"><b>Decision-support only.</b> This scanner ranks confluence and prepares trade plans. Confirm the chart, index trend, sector trend, news/events, liquidity, and risk before taking any trade.</div>""",
        unsafe_allow_html=True,
    )

    market_context = {"overall": "Neutral", "rows": pd.DataFrame(), "benchmark_symbol": None}
    benchmark_df = pd.DataFrame()
    if cfg.use_index_filter:
        with st.expander("Market Context", expanded=True):
            market_context = analyze_market_context(suffix)
            c1, c2 = st.columns([1, 3])
            c1.metric("Overall Market Bias", market_context["overall"])
            c2.dataframe(market_context["rows"], use_container_width=True, hide_index=True)
            if market_context.get("benchmark_symbol"):
                benchmark_df = fetch_price_history(str(market_context.get("benchmark_symbol")), period=cfg.lookback_period)

    if run_scan:
        if not tickers:
            st.warning("Enter at least one ticker.")
            st.stop()
        rows: List[Dict[str, object]] = []
        progress = st.progress(0)
        status = st.empty()
        for i, symbol in enumerate(tickers, start=1):
            status.write(f"Scanning {symbol} ({i}/{len(tickers)})...")
            try:
                rows.append(score_and_plan(symbol, cfg, market_context.get("overall", "Neutral"), benchmark_df))
            except Exception as exc:
                rows.append({"Symbol": symbol, "Status": f"Error: {type(exc).__name__}: {exc}"})
            progress.progress(i / len(tickers))
        status.empty()
        result = pd.DataFrame(rows)
        if "Status" in result.columns:
            ok = result[result["Status"].eq("OK")].copy()
            bad = result[~result["Status"].eq("OK")].copy()
        else:
            ok, bad = result.copy(), pd.DataFrame()
        if not ok.empty:
            ok = ok.sort_values(["Score", "R:R to T1", "Potential"], ascending=[False, False, True]).reset_index(drop=True)
        st.session_state.scan_results = ok
        st.session_state.scan_errors = bad

    result = st.session_state.scan_results.copy()
    if result.empty:
        st.subheader("Professional Workflow")
        st.markdown(
            """
            **Step 1 - Scanner:** find 52-week high/low setups, reversals, breakouts, and pullback candidates.  
            **Step 2 - Ranking:** sort by confluence score, risk/reward, fundamentals, liquidity, and market context.  
            **Step 3 - Chart Confirmation:** verify demand/supply, FVG, VWAP, volume profile, and candle trigger visually.  
            **Step 4 - Entry Trigger:** avoid blind entries; buy only after reclaim, breakout, or bullish reversal trigger.  
            **Step 5 - Position Size:** calculate quantity from fixed risk per trade.  
            **Step 6 - Trade Journal:** track planned, active, closed, result, and notes to improve the system.
            """
        )
        st.stop()

    st.subheader("A) Ranked Scanner Results")
    fc1, fc2, fc3, fc4, fc5 = st.columns(5)
    min_score_filter = fc1.slider("Filter min score", 0, 100, int(cfg.min_score), 5)
    action_filter = fc2.multiselect("Action", sorted(result["Action"].dropna().unique().tolist()), default=[])
    setup_filter = fc3.multiselect("Setup", sorted(result["Setup"].dropna().unique().tolist()), default=[])
    only_rr = fc4.checkbox(f"Only R:R >= {cfg.min_rr}", value=False)
    hide_avoid = fc5.checkbox("Hide avoid/no trade", value=True)

    filtered = result[result["Score"] >= min_score_filter].copy()
    if action_filter:
        filtered = filtered[filtered["Action"].isin(action_filter)]
    if setup_filter:
        filtered = filtered[filtered["Setup"].isin(setup_filter)]
    if only_rr:
        filtered = filtered[filtered["R:R to T1"] >= cfg.min_rr]
    if hide_avoid:
        filtered = filtered[~filtered["Action"].str.contains("AVOID", na=False)]

    metric_cols = st.columns(5)
    metric_cols[0].metric("Scanned OK", len(result))
    metric_cols[1].metric("Filtered", len(filtered))
    metric_cols[2].metric("Buy/Retest", int(result["Action"].str.contains("BUY", na=False).sum()))
    metric_cols[3].metric("A+ setups", int((result["Setup"] == "A+ Buying Zone").sum()))
    metric_cols[4].metric("Avg Score", f"{safe_float(result['Score'].mean()):.1f}" if not result.empty else "NA")

    display_cols = [
        "Symbol", "Action View", "Setup", "Quality Grade", "Potential", "Score",
        "Technical Score", "SMC/ICT Score", "VWAP/Volume Score", "Fundamental Score", "Relative Strength Score",
        "Close", "Buy Zone Lower", "Buy Zone Upper", "Entry Trigger", "Entry", "Stop Loss", "Target 1", "Target 2", "R:R to T1",
        "Quantity", "Risk Amount", "Weekly Trend", "RS 20D", "RS 50D", "RS 120D", "Candle Signal", "ATR %",
        "% From 52w Low", "% From 52w High", "Market Structure", "RSI14", "ADX14", "Avg Value Lakhs",
        "Fundamental Status", "Quarterly Results", "Warnings", "Reasons",
    ]
    table_df = filtered[[c for c in display_cols if c in filtered.columns]].copy()
    st.dataframe(table_df, use_container_width=True, height=560, hide_index=True, column_config=result_column_config())

    csv = filtered.to_csv(index=False).encode("utf-8")
    st.download_button("Download filtered scan CSV", csv, file_name="pro_swing_scan_results.csv", mime="text/csv")

    with st.expander("Full detailed data"):
        st.dataframe(filtered, use_container_width=True)

    if hasattr(st.session_state, "scan_errors") and not st.session_state.scan_errors.empty:
        with st.expander("Skipped / error tickers"):
            st.dataframe(st.session_state.scan_errors, use_container_width=True)

    st.subheader("B) Chart Confirmation")
    if filtered.empty:
        st.warning("No stocks match the current filters.")
    else:
        selected_symbol = st.selectbox("Select stock for chart confirmation", filtered["Symbol"].tolist())
        selected_row = filtered[filtered["Symbol"] == selected_symbol].iloc[0]
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Action", selected_row.get("Action", ""))
        c2.metric("Score", selected_row.get("Score", ""))
        c3.metric("Entry", selected_row.get("Entry", ""))
        c4.metric("R:R", selected_row.get("R:R to T1", ""))
        st.write("**Entry Trigger:**", selected_row.get("Entry Trigger", ""))
        st.write("**Weekly / RS Confirmation:**", f"Weekly: {selected_row.get('Weekly Trend', '')} | RS20: {selected_row.get('RS 20D', '')} | RS50: {selected_row.get('RS 50D', '')} | Candle: {selected_row.get('Candle Signal', '')}")
        st.write("**Main Reasons:**", selected_row.get("Reasons", ""))
        warn = str(selected_row.get("Warnings", ""))
        if warn:
            st.warning(warn)
        sb_fig = score_breakdown_chart(selected_row)
        if sb_fig is not None:
            st.plotly_chart(sb_fig, use_container_width=True)
        plot_trade_chart(selected_symbol, selected_row, cfg, candles=220)

        st.subheader("C) Add to Trade Journal")
        notes = st.text_input("Journal notes for selected setup", value="")
        if st.button("Add selected setup to journal", type="secondary"):
            st.session_state.journal = journal_add_candidate(st.session_state.journal, selected_row, notes)
            st.success(f"Added {selected_symbol} to journal.")

    st.subheader("D) Trade Journal")
    upload_journal = st.file_uploader("Upload existing journal CSV", type=["csv"], key="journal_upload")
    if upload_journal is not None:
        try:
            st.session_state.journal = ensure_journal(pd.read_csv(upload_journal))
            st.success("Journal loaded.")
        except Exception as exc:
            st.warning(f"Could not load journal: {exc}")

    st.session_state.journal = ensure_journal(st.session_state.journal)
    edited = st.data_editor(
        st.session_state.journal,
        use_container_width=True,
        num_rows="dynamic",
        height=300,
        column_config={
            "Status": st.column_config.SelectboxColumn("Status", options=["Planned", "Active", "Closed", "Cancelled"], required=False),
        },
    )
    st.session_state.journal = ensure_journal(edited)
    journal_csv = st.session_state.journal.to_csv(index=False).encode("utf-8")
    st.download_button("Download trade journal CSV", journal_csv, file_name="swing_trade_journal.csv", mime="text/csv")

    with st.expander("How to use this like a pro swing trader"):
        st.markdown(
            """
            - Prefer **BUY ZONE - WAIT TRIGGER** and **BUY BREAKOUT / RETEST ONLY**. Do not buy just because a stock appears in the table.  
            - Confirm chart structure manually: clean trend, demand/FVG support, VWAP reclaim, and no immediate supply overhead.  
            - Follow the trigger. If price does not trigger, there is no trade.  
            - Risk only the planned amount. Never increase quantity because you feel confident.  
            - Avoid new entries when the market context is weak, unless you are trading a very strong relative-strength stock.  
            - Review journal after 30-50 trades and adjust rules based on actual outcomes. Prefer stocks with strong weekly trend, positive relative strength, clean candle trigger, and manageable ATR%.
            """
        )


if __name__ == "__main__":
    app()
