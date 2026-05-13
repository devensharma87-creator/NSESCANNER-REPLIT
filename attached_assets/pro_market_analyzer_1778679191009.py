"""
================================================================
PRO MARKET ANALYZER - F&O Trading Command Center
================================================================
A single-pane live market dashboard for Indian F&O traders.

Data Sources
------------
- Kite Connect (broker)  : live holdings, positions, margins, quotes
- NSE public APIs        : option chain, FII/DII flows, gainers/losers,
                           index breadth, advances/declines, pre-open
- yfinance               : indices, global cues, intraday charts
- Web scraping (BS4)     : pre-market / post-market / news

Designed by priority:
    1. Live Alerts (unusual OI buildup, S/R breaks)
    2. Option Chain analytics (OI, PCR, Max Pain, OI shifts)
    3. Index Breadth (adv/dec, sector heatmap, VIX)
    4. FII/DII flows (cash + F&O segment)

Educational/research decision-support tool. Not investment advice.
================================================================
"""

from __future__ import annotations

import io
import json
import math
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, time as dtime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import requests
import streamlit as st

try:
    import yfinance as yf
except Exception:
    yf = None

try:
    import plotly.graph_objects as go
    from plotly.subplots import make_subplots
except Exception:
    go = None
    make_subplots = None

try:
    from kiteconnect import KiteConnect
except Exception:
    KiteConnect = None

# Local helper modules (live alongside this file)
try:
    from kite_auto_login import kite_login_button, KiteSession
except Exception:
    kite_login_button = None
    KiteSession = None

try:
    from kite_ticker import (
        get_ticker, TickerWorker, INDEX_TOKENS, resolve_option_tokens,
    )
except Exception:
    get_ticker = None
    TickerWorker = None
    INDEX_TOKENS = {}
    resolve_option_tokens = None

try:
    from strategy_builder import tab_strategy_builder
except Exception as _e:
    tab_strategy_builder = None
    _strategy_import_error = str(_e)

try:
    from trade_simulator_ui import tab_trade_simulator
except Exception as _e:
    tab_trade_simulator = None
    _trade_sim_import_error = str(_e)

try:
    from iv_history import stats as iv_history_stats
except Exception:
    iv_history_stats = None


# ================================================================
# CONFIG
# ================================================================

APP_VERSION = "1.3 — Pro F&O Command Center (live MTM + IV rank + trade simulator)"
IST = timezone(timedelta(hours=5, minutes=30))

INDICES = {
    "NIFTY 50": "^NSEI",
    "BANK NIFTY": "^NSEBANK",
    "FIN NIFTY": "NIFTY_FIN_SERVICE.NS",
    "NIFTY MIDCAP": "^NSEMDCP50",
    "INDIA VIX": "^INDIAVIX",
    "SENSEX": "^BSESN",
}

GLOBAL_CUES = {
    "DOW FUT": "YM=F",
    "NASDAQ FUT": "NQ=F",
    "S&P FUT": "ES=F",
    "GIFT NIFTY": "^NSEI",  # proxy
    "SGX NIKKEI": "^N225",
    "HANG SENG": "^HSI",
    "FTSE": "^FTSE",
    "DAX": "^GDAXI",
    "CRUDE": "CL=F",
    "GOLD": "GC=F",
    "DXY": "DX-Y.NYB",
    "USDINR": "INR=X",
}

SECTORS = {
    "BANK": "^NSEBANK",
    "IT": "^CNXIT",
    "AUTO": "^CNXAUTO",
    "PHARMA": "^CNXPHARMA",
    "FMCG": "^CNXFMCG",
    "METAL": "^CNXMETAL",
    "ENERGY": "^CNXENERGY",
    "REALTY": "^CNXREALTY",
    "PSU BANK": "^CNXPSUBANK",
    "FIN SERV": "NIFTY_FIN_SERVICE.NS",
    "MEDIA": "^CNXMEDIA",
    "INFRA": "^CNXINFRA",
}

# NSE expects a real-browser-looking session with cookies first.
NSE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/",
    "Connection": "keep-alive",
}


# ================================================================
# UTILS
# ================================================================

def now_ist() -> datetime:
    return datetime.now(IST)


def is_market_open() -> bool:
    n = now_ist()
    if n.weekday() >= 5:
        return False
    return dtime(9, 15) <= n.time() <= dtime(15, 30)


def fmt_num(x: Optional[float], digits: int = 2) -> str:
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return "—"
    if abs(x) >= 1e7:
        return f"{x/1e7:.{digits}f}Cr"
    if abs(x) >= 1e5:
        return f"{x/1e5:.{digits}f}L"
    if abs(x) >= 1e3:
        return f"{x:,.{digits}f}"
    return f"{x:.{digits}f}"


def fmt_pct(x: Optional[float], digits: int = 2) -> str:
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return "—"
    return f"{x:+.{digits}f}%"


def safe(d: Dict, *keys, default=None):
    cur = d
    for k in keys:
        if not isinstance(cur, dict) or k not in cur:
            return default
        cur = cur[k]
    return cur if cur is not None else default


# ================================================================
# NSE DATA LAYER (cookie-bootstrapped session)
# ================================================================

@st.cache_resource(show_spinner=False)
def nse_session() -> requests.Session:
    s = requests.Session()
    s.headers.update(NSE_HEADERS)
    try:
        s.get("https://www.nseindia.com/", timeout=8)
        s.get("https://www.nseindia.com/option-chain", timeout=8)
    except Exception:
        pass
    return s


def nse_get(url: str, retries: int = 2, timeout: int = 10) -> Optional[Dict]:
    s = nse_session()
    for attempt in range(retries + 1):
        try:
            r = s.get(url, timeout=timeout)
            if r.status_code == 401 or r.status_code == 403:
                # cookies likely expired -> rebootstrap
                s.get("https://www.nseindia.com/", timeout=timeout)
                continue
            if r.ok and r.text.strip():
                try:
                    return r.json()
                except Exception:
                    return None
        except Exception:
            time.sleep(0.6)
    return None


@st.cache_data(ttl=30, show_spinner=False)
def fetch_option_chain(symbol: str = "NIFTY") -> Optional[Dict]:
    sym = symbol.upper()
    if sym in ("NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"):
        url = f"https://www.nseindia.com/api/option-chain-indices?symbol={sym}"
    else:
        url = f"https://www.nseindia.com/api/option-chain-equities?symbol={sym}"
    return nse_get(url)


@st.cache_data(ttl=60, show_spinner=False)
def fetch_fii_dii() -> Optional[List[Dict]]:
    return nse_get("https://www.nseindia.com/api/fiidiiTradeReact")


@st.cache_data(ttl=45, show_spinner=False)
def fetch_gainers_losers() -> Optional[Dict]:
    return nse_get("https://www.nseindia.com/api/live-analysis-variations?index=gainers")


@st.cache_data(ttl=45, show_spinner=False)
def fetch_losers() -> Optional[Dict]:
    return nse_get("https://www.nseindia.com/api/live-analysis-variations?index=loosers")


@st.cache_data(ttl=60, show_spinner=False)
def fetch_pre_open() -> Optional[Dict]:
    return nse_get("https://www.nseindia.com/api/market-data-pre-open?key=NIFTY")


@st.cache_data(ttl=60, show_spinner=False)
def fetch_market_status() -> Optional[Dict]:
    return nse_get("https://www.nseindia.com/api/marketStatus")


@st.cache_data(ttl=120, show_spinner=False)
def fetch_advance_decline() -> Optional[Dict]:
    return nse_get("https://www.nseindia.com/api/live-analysis-advance-decline")


# ================================================================
# OPTION CHAIN ANALYTICS
# ================================================================

def parse_option_chain(raw: Dict) -> Tuple[pd.DataFrame, Dict]:
    if not raw or "records" not in raw:
        return pd.DataFrame(), {}
    records = raw["records"]
    data = records.get("data", [])
    underlying = records.get("underlyingValue", np.nan)
    expiries = records.get("expiryDates", [])
    rows = []
    for d in data:
        strike = d.get("strikePrice")
        expiry = d.get("expiryDate")
        ce = d.get("CE", {}) or {}
        pe = d.get("PE", {}) or {}
        rows.append({
            "expiry": expiry,
            "strike": strike,
            "CE_OI": ce.get("openInterest", 0),
            "CE_chgOI": ce.get("changeinOpenInterest", 0),
            "CE_IV": ce.get("impliedVolatility", 0),
            "CE_LTP": ce.get("lastPrice", 0),
            "CE_vol": ce.get("totalTradedVolume", 0),
            "CE_chg": ce.get("change", 0),
            "PE_OI": pe.get("openInterest", 0),
            "PE_chgOI": pe.get("changeinOpenInterest", 0),
            "PE_IV": pe.get("impliedVolatility", 0),
            "PE_LTP": pe.get("lastPrice", 0),
            "PE_vol": pe.get("totalTradedVolume", 0),
            "PE_chg": pe.get("change", 0),
        })
    df = pd.DataFrame(rows)
    return df, {"underlying": underlying, "expiries": expiries}


def compute_pcr(df: pd.DataFrame) -> Tuple[float, float]:
    if df.empty:
        return float("nan"), float("nan")
    pcr_oi = df["PE_OI"].sum() / max(df["CE_OI"].sum(), 1)
    pcr_vol = df["PE_vol"].sum() / max(df["CE_vol"].sum(), 1)
    return pcr_oi, pcr_vol


def compute_max_pain(df: pd.DataFrame) -> Optional[float]:
    """Strike at which total option-writer payout is minimized."""
    if df.empty:
        return None
    strikes = sorted(df["strike"].unique())
    pain = []
    for k in strikes:
        ce_pain = ((k - df["strike"]).clip(lower=0) * df["CE_OI"]).sum()
        pe_pain = ((df["strike"] - k).clip(lower=0) * df["PE_OI"]).sum()
        pain.append((k, ce_pain + pe_pain))
    return min(pain, key=lambda x: x[1])[0]


def oi_analysis_classify(price_chg: float, oi_chg: float) -> str:
    """Classic 4-quadrant OI interpretation."""
    if price_chg > 0 and oi_chg > 0:
        return "Long Build-up"
    if price_chg > 0 and oi_chg < 0:
        return "Short Covering"
    if price_chg < 0 and oi_chg > 0:
        return "Short Build-up"
    if price_chg < 0 and oi_chg < 0:
        return "Long Unwinding"
    return "Neutral"


def detect_unusual_oi(df: pd.DataFrame, underlying: float, top_n: int = 5) -> pd.DataFrame:
    """Find strikes with unusually high OI change relative to existing OI."""
    if df.empty:
        return pd.DataFrame()
    out = []
    for _, r in df.iterrows():
        for side in ("CE", "PE"):
            oi = r[f"{side}_OI"] or 0
            chg = r[f"{side}_chgOI"] or 0
            if oi < 5000:  # ignore micro strikes
                continue
            ratio = chg / oi if oi else 0
            if abs(ratio) < 0.15:
                continue
            out.append({
                "strike": r["strike"],
                "side": side,
                "OI": oi,
                "chgOI": chg,
                "%chgOI": ratio * 100,
                "LTP": r[f"{side}_LTP"],
                "IV": r[f"{side}_IV"],
                "distance%": (r["strike"] - underlying) / underlying * 100 if underlying else 0,
            })
    res = pd.DataFrame(out)
    if res.empty:
        return res
    res["abs"] = res["chgOI"].abs()
    return res.sort_values("abs", ascending=False).head(top_n).drop(columns="abs")


# ================================================================
# YFINANCE LAYER (indices / sectors / global)
# ================================================================

@st.cache_data(ttl=30, show_spinner=False)
def yf_quote(ticker: str) -> Dict[str, Any]:
    if yf is None:
        return {}
    try:
        t = yf.Ticker(ticker)
        # fast_info is much cheaper than .info
        fi = getattr(t, "fast_info", {}) or {}
        last = fi.get("last_price") or fi.get("lastPrice")
        prev = fi.get("previous_close") or fi.get("previousClose")
        if last is None or prev is None:
            hist = t.history(period="2d", interval="1d")
            if len(hist) >= 2:
                last = float(hist["Close"].iloc[-1])
                prev = float(hist["Close"].iloc[-2])
            elif len(hist) == 1:
                last = float(hist["Close"].iloc[-1])
                prev = float(hist["Open"].iloc[-1])
        if last is None or prev is None:
            return {}
        return {
            "last": float(last),
            "prev": float(prev),
            "chg": float(last) - float(prev),
            "chg_pct": (float(last) - float(prev)) / float(prev) * 100,
        }
    except Exception:
        return {}


@st.cache_data(ttl=60, show_spinner=False)
def yf_intraday(ticker: str, period: str = "1d", interval: str = "5m") -> pd.DataFrame:
    if yf is None:
        return pd.DataFrame()
    try:
        df = yf.download(ticker, period=period, interval=interval, progress=False, auto_adjust=False)
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        return df
    except Exception:
        return pd.DataFrame()


# ================================================================
# KITE LAYER
# ================================================================

def get_kite() -> Optional[Any]:
    if KiteConnect is None:
        return None
    api_key = st.session_state.get("kite_api_key") or os.environ.get("KITE_API_KEY")
    access_token = st.session_state.get("kite_access_token") or os.environ.get("KITE_ACCESS_TOKEN")
    if not api_key or not access_token:
        return None
    try:
        k = KiteConnect(api_key=api_key)
        k.set_access_token(access_token)
        return k
    except Exception:
        return None


def kite_holdings_df(k) -> pd.DataFrame:
    try:
        h = k.holdings()
        if not h:
            return pd.DataFrame()
        df = pd.DataFrame(h)
        df["invested"] = df["average_price"] * df["quantity"]
        df["current"] = df["last_price"] * df["quantity"]
        df["pnl_pct"] = (df["last_price"] - df["average_price"]) / df["average_price"] * 100
        return df[["tradingsymbol", "exchange", "quantity", "average_price",
                   "last_price", "invested", "current", "pnl", "pnl_pct",
                   "day_change_percentage"]]
    except Exception:
        return pd.DataFrame()


def kite_positions_df(k) -> pd.DataFrame:
    try:
        p = k.positions()
        nets = p.get("net", []) if isinstance(p, dict) else []
        if not nets:
            return pd.DataFrame()
        df = pd.DataFrame(nets)
        return df
    except Exception:
        return pd.DataFrame()


# ================================================================
# ALERT ENGINE
# ================================================================

@dataclass
class Alert:
    level: str           # INFO / WARN / CRIT
    category: str        # OI / FLOW / PRICE / BREADTH
    title: str
    detail: str
    ts: datetime = field(default_factory=now_ist)


def build_alerts(oc_df: pd.DataFrame, oc_meta: Dict, idx_quotes: Dict,
                 adv_dec: Optional[Dict], pcr: float, max_pain: Optional[float]) -> List[Alert]:
    alerts: List[Alert] = []

    # 1. Unusual OI alerts
    underlying = oc_meta.get("underlying", np.nan)
    if not oc_df.empty and underlying:
        unusual = detect_unusual_oi(oc_df, underlying, top_n=8)
        for _, r in unusual.iterrows():
            lvl = "CRIT" if abs(r["%chgOI"]) > 50 else "WARN"
            direction = "writing" if r["chgOI"] > 0 else "unwinding"
            alerts.append(Alert(
                level=lvl, category="OI",
                title=f"{r['side']} {r['strike']:.0f} — heavy {direction}",
                detail=f"ΔOI {r['chgOI']:+,.0f} ({r['%chgOI']:+.1f}%) · "
                       f"LTP {r['LTP']:.1f} · {r['distance%']:+.1f}% from spot",
            ))

    # 2. PCR extremes
    if not math.isnan(pcr):
        if pcr > 1.5:
            alerts.append(Alert("WARN", "OI",
                                f"PCR {pcr:.2f} — extreme bullish skew",
                                "Heavy put writing. Watch for short squeeze, but also reversal risk."))
        elif pcr < 0.7:
            alerts.append(Alert("WARN", "OI",
                                f"PCR {pcr:.2f} — extreme bearish skew",
                                "Heavy call writing. Resistance heavy."))

    # 3. Max pain divergence
    if max_pain and underlying and not math.isnan(underlying):
        gap_pct = (underlying - max_pain) / max_pain * 100
        if abs(gap_pct) > 1.0:
            side = "above" if gap_pct > 0 else "below"
            alerts.append(Alert("INFO", "OI",
                                f"Spot {gap_pct:+.2f}% {side} Max Pain {max_pain:.0f}",
                                "Options writers pulling toward max pain into expiry."))

    # 4. VIX spike
    vix = idx_quotes.get("INDIA VIX", {})
    if vix.get("chg_pct", 0) > 5:
        alerts.append(Alert("CRIT", "PRICE",
                            f"VIX spiking {vix['chg_pct']:+.1f}%",
                            f"VIX at {vix['last']:.2f}. Volatility expansion — size down."))
    elif vix.get("chg_pct", 0) < -5:
        alerts.append(Alert("INFO", "PRICE",
                            f"VIX cooling {vix['chg_pct']:+.1f}%",
                            f"VIX at {vix['last']:.2f}. Vol crush — favorable for premium sellers."))

    # 5. Breadth alerts
    if adv_dec:
        adv = adv_dec.get("advances") or adv_dec.get("ADVANCES") or 0
        dec = adv_dec.get("declines") or adv_dec.get("DECLINES") or 0
        try:
            adv, dec = int(adv), int(dec)
            if dec > 0 and adv / dec < 0.4:
                alerts.append(Alert("WARN", "BREADTH",
                                    f"Breadth weak — A/D {adv}/{dec}",
                                    "Broad market participation poor despite index moves."))
            elif adv > 0 and dec / max(adv, 1) < 0.4:
                alerts.append(Alert("INFO", "BREADTH",
                                    f"Breadth strong — A/D {adv}/{dec}",
                                    "Broad-based buying."))
        except Exception:
            pass

    # 6. Index big-move alerts
    for name, q in idx_quotes.items():
        if name == "INDIA VIX":
            continue
        if abs(q.get("chg_pct", 0)) > 1.0:
            lvl = "WARN" if abs(q["chg_pct"]) > 1.5 else "INFO"
            alerts.append(Alert(lvl, "PRICE",
                                f"{name} {q['chg_pct']:+.2f}%",
                                f"At {fmt_num(q['last'])} (Δ {fmt_num(q['chg'])})"))

    return alerts


# ================================================================
# UI — STYLING
# ================================================================

CUSTOM_CSS = """
<style>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;800&family=Inter+Tight:wght@300;500;700;900&display=swap');

:root {
    --bg: #0a0e14;
    --panel: #11161f;
    --panel-2: #161c27;
    --border: #1f2937;
    --text: #e5e7eb;
    --muted: #6b7280;
    --green: #00d68f;
    --red: #ff4d6d;
    --amber: #ffb020;
    --cyan: #22d3ee;
    --violet: #a78bfa;
}

html, body, [class*="css"]  {
    font-family: 'Inter Tight', sans-serif;
    background: var(--bg) !important;
    color: var(--text) !important;
}
.stApp { background: linear-gradient(180deg, #0a0e14 0%, #0d1219 100%); }

h1, h2, h3, h4 {
    font-family: 'Inter Tight', sans-serif;
    font-weight: 800;
    letter-spacing: -0.02em;
}

.hero {
    border: 1px solid var(--border);
    background: linear-gradient(135deg, rgba(0,214,143,0.05), rgba(34,211,238,0.03));
    padding: 18px 22px;
    border-radius: 14px;
    margin-bottom: 18px;
}
.hero h1 {
    font-size: 28px; margin: 0;
    background: linear-gradient(90deg, #fff 30%, var(--cyan));
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent;
}
.hero .sub { color: var(--muted); font-family: 'JetBrains Mono', monospace; font-size: 13px; margin-top: 4px;}
.market-pill {
    display: inline-block; padding: 3px 10px; border-radius: 999px;
    font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600;
    letter-spacing: 0.05em;
}
.pill-open { background: rgba(0,214,143,0.15); color: var(--green); border: 1px solid rgba(0,214,143,0.35);}
.pill-closed { background: rgba(255,77,109,0.12); color: var(--red); border: 1px solid rgba(255,77,109,0.35);}

.metric-card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 14px 16px;
    transition: border-color 0.2s, transform 0.2s;
}
.metric-card:hover { border-color: #2a3441; transform: translateY(-1px);}
.metric-card .label { font-size: 11px; color: var(--muted); letter-spacing: 0.08em; text-transform: uppercase;}
.metric-card .value { font-family: 'JetBrains Mono', monospace; font-size: 22px; font-weight: 700; margin-top: 4px;}
.metric-card .delta { font-family: 'JetBrains Mono', monospace; font-size: 13px; margin-top: 2px;}
.up { color: var(--green); }
.dn { color: var(--red); }
.flat { color: var(--muted); }

.alert-row {
    display: flex; align-items: flex-start; gap: 10px;
    padding: 10px 12px; margin-bottom: 6px;
    background: var(--panel); border: 1px solid var(--border); border-left-width: 3px;
    border-radius: 8px;
}
.alert-crit { border-left-color: var(--red);}
.alert-warn { border-left-color: var(--amber);}
.alert-info { border-left-color: var(--cyan);}
.alert-row .tag {
    font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700;
    padding: 2px 6px; border-radius: 4px; letter-spacing: 0.08em;
}
.tag-crit { background: rgba(255,77,109,0.15); color: var(--red);}
.tag-warn { background: rgba(255,176,32,0.15); color: var(--amber);}
.tag-info { background: rgba(34,211,238,0.15); color: var(--cyan);}
.alert-row .title { font-weight: 600; font-size: 14px;}
.alert-row .detail { font-size: 12px; color: var(--muted); margin-top: 2px; font-family: 'JetBrains Mono', monospace;}

.section-title {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px; letter-spacing: 0.15em; color: var(--muted);
    text-transform: uppercase; margin: 18px 0 8px 0;
    border-bottom: 1px solid var(--border); padding-bottom: 6px;
}
[data-testid="stMetricValue"] { font-family: 'JetBrains Mono', monospace !important;}
.stTabs [data-baseweb="tab-list"] { gap: 4px; background: var(--panel); padding: 4px; border-radius: 10px;}
.stTabs [data-baseweb="tab"] { background: transparent; color: var(--muted); border-radius: 8px; padding: 8px 14px;}
.stTabs [aria-selected="true"] { background: var(--panel-2); color: var(--text);}
</style>
"""


def render_hero():
    n = now_ist()
    open_now = is_market_open()
    pill = (
        '<span class="market-pill pill-open">● LIVE · MARKET OPEN</span>'
        if open_now else
        '<span class="market-pill pill-closed">● MARKET CLOSED</span>'
    )
    st.markdown(
        f"""
        <div class="hero">
            <h1>PRO MARKET ANALYZER</h1>
            <div class="sub">
                {pill} &nbsp;·&nbsp; {n.strftime('%A, %d %b %Y · %H:%M:%S IST')}
                &nbsp;·&nbsp; v{APP_VERSION}
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def metric_card(label: str, value: str, delta: Optional[str] = None, direction: str = "flat"):
    delta_html = f'<div class="delta {direction}">{delta}</div>' if delta else ""
    return f"""
    <div class="metric-card">
        <div class="label">{label}</div>
        <div class="value">{value}</div>
        {delta_html}
    </div>
    """


def render_alerts(alerts: List[Alert]):
    if not alerts:
        st.info("No active alerts. Market is calm or feeds are unavailable.")
        return
    order = {"CRIT": 0, "WARN": 1, "INFO": 2}
    alerts = sorted(alerts, key=lambda a: order.get(a.level, 3))
    html = []
    for a in alerts:
        cls = a.level.lower()
        html.append(f"""
        <div class="alert-row alert-{cls}">
            <span class="tag tag-{cls}">{a.level}</span>
            <div style="flex:1">
                <div class="title">{a.title} <span style="color:var(--muted);font-size:11px;font-family:'JetBrains Mono',monospace;">· {a.category}</span></div>
                <div class="detail">{a.detail}</div>
            </div>
            <div style="color:var(--muted);font-size:11px;font-family:'JetBrains Mono',monospace;">{a.ts.strftime('%H:%M:%S')}</div>
        </div>
        """)
    st.markdown("\n".join(html), unsafe_allow_html=True)


# ================================================================
# TABS
# ================================================================

def tab_overview(idx_quotes: Dict, alerts: List[Alert]):
    st.markdown('<div class="section-title">Indian Indices</div>', unsafe_allow_html=True)
    cols = st.columns(len(INDICES))
    for col, (name, _) in zip(cols, INDICES.items()):
        q = idx_quotes.get(name, {})
        if not q:
            col.markdown(metric_card(name, "—"), unsafe_allow_html=True)
            continue
        d = "up" if q["chg_pct"] > 0 else ("dn" if q["chg_pct"] < 0 else "flat")
        arrow = "▲" if q["chg_pct"] > 0 else "▼" if q["chg_pct"] < 0 else "▬"
        col.markdown(
            metric_card(
                name,
                fmt_num(q["last"]),
                f"{arrow} {fmt_num(q['chg'])} ({fmt_pct(q['chg_pct'])})",
                d,
            ),
            unsafe_allow_html=True,
        )

    st.markdown('<div class="section-title">Live Alerts</div>', unsafe_allow_html=True)
    render_alerts(alerts[:12])


def tab_option_chain():
    c1, c2, c3 = st.columns([2, 2, 1])
    sym = c1.selectbox("Symbol", ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"], 0)
    raw = fetch_option_chain(sym)
    if not raw:
        st.error("NSE option chain unavailable. Try again — rate-limited or session expired.")
        return
    df, meta = parse_option_chain(raw)
    if df.empty:
        st.warning("Empty option chain.")
        return

    expiries = meta.get("expiries", [])
    expiry = c2.selectbox("Expiry", expiries, 0) if expiries else None
    n_strikes = c3.number_input("Strikes ± ATM", 5, 30, 12)

    if expiry:
        df = df[df["expiry"] == expiry].copy()

    underlying = meta.get("underlying", np.nan)
    if not df.empty and not math.isnan(underlying):
        atm = df.iloc[(df["strike"] - underlying).abs().argsort()].iloc[0]["strike"]
        df = df[(df["strike"] >= atm - n_strikes * 50) & (df["strike"] <= atm + n_strikes * 50)]

    pcr_oi, pcr_vol = compute_pcr(df)
    max_pain = compute_max_pain(df)
    total_ce_oi = df["CE_OI"].sum()
    total_pe_oi = df["PE_OI"].sum()

    m1, m2, m3, m4, m5 = st.columns(5)
    m1.markdown(metric_card("Spot", fmt_num(underlying)), unsafe_allow_html=True)
    m2.markdown(metric_card("PCR (OI)", f"{pcr_oi:.2f}",
                            "Bullish" if pcr_oi > 1 else "Bearish",
                            "up" if pcr_oi > 1 else "dn"), unsafe_allow_html=True)
    m3.markdown(metric_card("PCR (Vol)", f"{pcr_vol:.2f}"), unsafe_allow_html=True)
    m4.markdown(metric_card("Max Pain", fmt_num(max_pain) if max_pain else "—"), unsafe_allow_html=True)
    m5.markdown(metric_card("Total CE / PE OI",
                            f"{fmt_num(total_ce_oi)} / {fmt_num(total_pe_oi)}"),
                unsafe_allow_html=True)

    # OI Profile chart
    if go is not None:
        fig = go.Figure()
        fig.add_trace(go.Bar(y=df["strike"], x=-df["CE_OI"], orientation="h",
                             name="CE OI", marker_color="#ff4d6d"))
        fig.add_trace(go.Bar(y=df["strike"], x=df["PE_OI"], orientation="h",
                             name="PE OI", marker_color="#00d68f"))
        fig.add_trace(go.Bar(y=df["strike"], x=-df["CE_chgOI"], orientation="h",
                             name="ΔCE OI", marker_color="#ffb020", opacity=0.6))
        fig.add_trace(go.Bar(y=df["strike"], x=df["PE_chgOI"], orientation="h",
                             name="ΔPE OI", marker_color="#22d3ee", opacity=0.6))
        if not math.isnan(underlying):
            fig.add_hline(y=underlying, line_color="#ffffff", line_width=1.2,
                          line_dash="dash", annotation_text=f"Spot {underlying:.0f}",
                          annotation_position="right")
        if max_pain:
            fig.add_hline(y=max_pain, line_color="#a78bfa", line_width=1, line_dash="dot",
                          annotation_text=f"Max Pain {max_pain:.0f}",
                          annotation_position="left")
        fig.update_layout(
            title="Open Interest Profile",
            barmode="overlay", height=600,
            paper_bgcolor="#0a0e14", plot_bgcolor="#0a0e14",
            font=dict(color="#e5e7eb"),
            xaxis_title="OI (CE ◄  ► PE)",
            yaxis_title="Strike",
        )
        st.plotly_chart(fig, use_container_width=True)

    st.markdown('<div class="section-title">Unusual OI Buildup</div>', unsafe_allow_html=True)
    unusual = detect_unusual_oi(df, underlying, top_n=10)
    if unusual.empty:
        st.write("Nothing flagged at this threshold.")
    else:
        st.dataframe(unusual.style.format({
            "strike": "{:.0f}", "OI": "{:,.0f}", "chgOI": "{:+,.0f}",
            "%chgOI": "{:+.1f}%", "LTP": "{:.2f}", "IV": "{:.2f}",
            "distance%": "{:+.2f}%",
        }), use_container_width=True, hide_index=True)

    st.markdown('<div class="section-title">Full Chain</div>', unsafe_allow_html=True)
    display = df[["CE_OI", "CE_chgOI", "CE_IV", "CE_LTP", "strike",
                  "PE_LTP", "PE_IV", "PE_chgOI", "PE_OI"]].copy()
    st.dataframe(display.style.format({
        "CE_OI": "{:,.0f}", "CE_chgOI": "{:+,.0f}", "CE_IV": "{:.1f}", "CE_LTP": "{:.2f}",
        "strike": "{:.0f}",
        "PE_OI": "{:,.0f}", "PE_chgOI": "{:+,.0f}", "PE_IV": "{:.1f}", "PE_LTP": "{:.2f}",
    }), use_container_width=True, hide_index=True, height=480)


def tab_breadth(idx_quotes: Dict):
    st.markdown('<div class="section-title">Sector Heatmap</div>', unsafe_allow_html=True)
    rows = []
    for name, ticker in SECTORS.items():
        q = yf_quote(ticker)
        if q:
            rows.append({"Sector": name, "Last": q["last"], "Chg %": q["chg_pct"]})
    if rows:
        sdf = pd.DataFrame(rows).sort_values("Chg %", ascending=False)
        if go is not None:
            colors = ["#00d68f" if v > 0 else "#ff4d6d" for v in sdf["Chg %"]]
            fig = go.Figure(go.Bar(
                y=sdf["Sector"], x=sdf["Chg %"], orientation="h",
                marker_color=colors,
                text=[f"{v:+.2f}%" for v in sdf["Chg %"]],
                textposition="outside",
            ))
            fig.update_layout(height=420, paper_bgcolor="#0a0e14", plot_bgcolor="#0a0e14",
                              font=dict(color="#e5e7eb"), xaxis_title="% Change",
                              margin=dict(l=10, r=10, t=10, b=10))
            st.plotly_chart(fig, use_container_width=True)

    st.markdown('<div class="section-title">Advances / Declines</div>', unsafe_allow_html=True)
    ad = fetch_advance_decline()
    if ad and "data" in ad:
        ad_df = pd.DataFrame(ad["data"])
        st.dataframe(ad_df, use_container_width=True, hide_index=True)
    else:
        st.write("Advance/decline data unavailable right now.")

    st.markdown('<div class="section-title">India VIX</div>', unsafe_allow_html=True)
    vix = idx_quotes.get("INDIA VIX", {})
    if vix:
        d = "up" if vix["chg_pct"] > 0 else "dn"
        st.markdown(metric_card("INDIA VIX", fmt_num(vix["last"]),
                                fmt_pct(vix["chg_pct"]), d), unsafe_allow_html=True)
        if vix["last"] < 12:
            st.info("VIX very low — complacency. Favors premium sellers, but black-swan risk elevated.")
        elif vix["last"] > 18:
            st.warning("VIX elevated — defensive sizing recommended.")


def tab_flows():
    st.markdown('<div class="section-title">FII / DII — Cash Segment</div>', unsafe_allow_html=True)
    fd = fetch_fii_dii()
    if fd:
        df = pd.DataFrame(fd)
        if not df.empty:
            cols = [c for c in ["category", "date", "buyValue", "sellValue", "netValue"] if c in df.columns]
            if cols:
                df = df[cols]
            num_cols = [c for c in ["buyValue", "sellValue", "netValue"] if c in df.columns]
            for c in num_cols:
                df[c] = pd.to_numeric(df[c], errors="coerce")
            st.dataframe(
                df.style.format({c: "{:,.2f}" for c in num_cols})
                  .map(lambda v: "color:#00d68f" if isinstance(v, (int, float)) and v > 0
                                else "color:#ff4d6d" if isinstance(v, (int, float)) and v < 0 else "",
                       subset=["netValue"] if "netValue" in df.columns else []),
                use_container_width=True, hide_index=True,
            )
            if go is not None and "netValue" in df.columns and "category" in df.columns:
                fig = go.Figure(go.Bar(
                    x=df["category"], y=df["netValue"],
                    marker_color=["#00d68f" if v >= 0 else "#ff4d6d" for v in df["netValue"]],
                    text=[fmt_num(v) for v in df["netValue"]], textposition="outside",
                ))
                fig.update_layout(title="Today's Net Activity (₹ Cr)",
                                  paper_bgcolor="#0a0e14", plot_bgcolor="#0a0e14",
                                  font=dict(color="#e5e7eb"), height=320)
                st.plotly_chart(fig, use_container_width=True)
    else:
        st.write("FII/DII feed unavailable. NSE sometimes rate-limits — refresh in a minute.")

    st.markdown('<div class="section-title">Top Gainers</div>', unsafe_allow_html=True)
    g = fetch_gainers_losers()
    if g and "NIFTY" in g:
        gdf = pd.DataFrame(g["NIFTY"]["data"])
        keep = [c for c in ["symbol", "ltp", "netPrice", "tradedQuantity", "turnoverInLakhs"]
                if c in gdf.columns]
        st.dataframe(gdf[keep].head(15) if keep else gdf.head(15),
                     use_container_width=True, hide_index=True)

    st.markdown('<div class="section-title">Top Losers</div>', unsafe_allow_html=True)
    losers = fetch_losers()
    if losers and "NIFTY" in losers:
        ldf = pd.DataFrame(losers["NIFTY"]["data"])
        keep = [c for c in ["symbol", "ltp", "netPrice", "tradedQuantity", "turnoverInLakhs"]
                if c in ldf.columns]
        st.dataframe(ldf[keep].head(15) if keep else ldf.head(15),
                     use_container_width=True, hide_index=True)


def tab_pre_post():
    st.markdown('<div class="section-title">Pre-Open Market (NIFTY)</div>', unsafe_allow_html=True)
    pre = fetch_pre_open()
    if pre and "data" in pre:
        pdf = pd.DataFrame(pre["data"])
        # NSE nests metadata under 'metadata' key
        if "metadata" in pdf.columns:
            meta = pd.json_normalize(pdf["metadata"])
            keep = [c for c in ["symbol", "lastPrice", "change", "pChange",
                                "previousClose", "totalTradedVolume"] if c in meta.columns]
            if keep:
                st.dataframe(meta[keep], use_container_width=True, hide_index=True, height=420)
        else:
            st.dataframe(pdf, use_container_width=True, hide_index=True)
    else:
        st.write("Pre-open data is only meaningful 9:00–9:15 IST or unavailable now.")

    st.markdown('<div class="section-title">Global Cues</div>', unsafe_allow_html=True)
    rows = []
    for name, t in GLOBAL_CUES.items():
        q = yf_quote(t)
        if q:
            rows.append({
                "Market": name,
                "Last": fmt_num(q["last"]),
                "Chg": fmt_num(q["chg"]),
                "Chg %": fmt_pct(q["chg_pct"]),
            })
    if rows:
        st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)


def tab_portfolio():
    st.markdown('<div class="section-title">Kite Connect Setup</div>', unsafe_allow_html=True)
    if KiteConnect is None:
        st.error("`kiteconnect` package not installed. Run: `pip install kiteconnect`")
        return
    if kite_login_button is None:
        st.error("`kite_auto_login.py` not found alongside this file.")
        return

    # Credentials. Persist in session_state, but the heavy work
    # (browser login, token caching) is handled by KiteSession.
    with st.expander("API credentials (one-time setup)",
                     expanded=not st.session_state.get("kite_api_key")):
        c1, c2 = st.columns(2)
        api_key = c1.text_input(
            "API Key",
            value=st.session_state.get("kite_api_key", os.environ.get("KITE_API_KEY", "")),
            type="password",
            help="From kite.trade developer console",
        )
        api_secret = c2.text_input(
            "API Secret",
            value=st.session_state.get("kite_api_secret", os.environ.get("KITE_API_SECRET", "")),
            type="password",
            help="From kite.trade developer console. Used once to exchange request_token.",
        )
        if api_key:
            st.session_state["kite_api_key"] = api_key
        if api_secret:
            st.session_state["kite_api_secret"] = api_secret
        st.caption(
            "Make sure your Kite app's Redirect URL is set to "
            "`http://127.0.0.1:5000/` in the developer console."
        )

    if not api_key or not api_secret:
        st.info("Add your API key and secret above to enable one-click daily login.")
        return

    # The login widget handles everything — cached token reuse,
    # browser-based login, status, logout.
    k = kite_login_button(api_key, api_secret)
    if not k:
        return

    st.markdown('<div class="section-title">Holdings</div>', unsafe_allow_html=True)
    hdf = kite_holdings_df(k)
    if hdf.empty:
        st.write("No holdings.")
    else:
        total_inv = hdf["invested"].sum()
        total_cur = hdf["current"].sum()
        total_pnl = hdf["pnl"].sum()
        c1, c2, c3, c4 = st.columns(4)
        c1.markdown(metric_card("Invested", f"₹{fmt_num(total_inv)}"), unsafe_allow_html=True)
        c2.markdown(metric_card("Current", f"₹{fmt_num(total_cur)}"), unsafe_allow_html=True)
        d = "up" if total_pnl >= 0 else "dn"
        c3.markdown(metric_card("Net P&L", f"₹{fmt_num(total_pnl)}",
                                fmt_pct(total_pnl/total_inv*100), d), unsafe_allow_html=True)
        c4.markdown(metric_card("Positions", str(len(hdf))), unsafe_allow_html=True)

        st.dataframe(hdf.style.format({
            "average_price": "{:.2f}", "last_price": "{:.2f}",
            "invested": "{:,.0f}", "current": "{:,.0f}", "pnl": "{:+,.0f}",
            "pnl_pct": "{:+.2f}%", "day_change_percentage": "{:+.2f}%",
        }), use_container_width=True, hide_index=True)

    st.markdown('<div class="section-title">F&O / Intraday Positions</div>', unsafe_allow_html=True)
    pdf = kite_positions_df(k)
    if pdf.empty:
        st.write("No open positions.")
    else:
        st.dataframe(pdf, use_container_width=True, hide_index=True)

    st.markdown('<div class="section-title">Margins</div>', unsafe_allow_html=True)
    try:
        m = k.margins()
        st.json(m)
    except Exception as e:
        st.error(str(e))


# ================================================================
# LIVE TICKER TAB (KiteTicker WebSocket)
# ================================================================

def tab_live_ticker():
    st.markdown('<div class="section-title">Live WebSocket Feed</div>',
                unsafe_allow_html=True)

    if get_ticker is None or kite_login_button is None:
        st.error("Helper modules missing. Make sure `kite_ticker.py` and "
                 "`kite_auto_login.py` are next to this file.")
        return

    api_key = st.session_state.get("kite_api_key", os.environ.get("KITE_API_KEY", ""))
    api_secret = st.session_state.get("kite_api_secret",
                                      os.environ.get("KITE_API_SECRET", ""))

    if not api_key or not api_secret:
        st.info("Add your API credentials in the **My Portfolio** tab first.")
        return

    # Reuse the auto-login token. KiteSession returns a connected
    # KiteConnect; we lift the access token out of it.
    try:
        ks = KiteSession(api_key, api_secret)
        kite = ks.connect()
        # Pull access_token from the cached session file
        from kite_auto_login import load_token
        cached = load_token()
        if not cached:
            st.error("No cached token. Log in via the Portfolio tab first.")
            return
        access_token = cached["access_token"]
    except Exception as e:
        st.error(f"Auth failed: {e}")
        return

    ticker = get_ticker(api_key, access_token)

    # Connection status row
    stats = ticker.stats()
    c1, c2, c3, c4 = st.columns(4)
    state = "🟢 Connected" if stats["connected"] else "🔴 Disconnected"
    c1.markdown(metric_card("WebSocket", state), unsafe_allow_html=True)
    c2.markdown(metric_card("Ticks received", f"{stats['ticks_received']:,}"),
                unsafe_allow_html=True)
    c3.markdown(metric_card("Subscribed", str(stats["subscribed_count"])),
                unsafe_allow_html=True)
    last_ts = stats.get("last_tick_ts")
    last_str = last_ts.strftime("%H:%M:%S") if last_ts else "—"
    c4.markdown(metric_card("Last tick", last_str), unsafe_allow_html=True)
    if stats.get("last_error"):
        st.warning(f"Last error: {stats['last_error']}")

    # Subscribe to indices on first load
    if not ticker.subscribed_tokens() and INDEX_TOKENS:
        ticker.subscribe(list(INDEX_TOKENS.values()), mode="full")
        st.info("Subscribing to indices... refresh in 2-3s.")

    # Index ticker grid
    st.markdown('<div class="section-title">Indices · Live</div>',
                unsafe_allow_html=True)
    cols = st.columns(len(INDEX_TOKENS))
    for col, (name, token) in zip(cols, INDEX_TOKENS.items()):
        snap = ticker.latest(token)
        if snap and snap.last_price:
            chg_pct = (snap.last_price - snap.close_price) / snap.close_price * 100 \
                if snap.close_price else 0
            d = "up" if chg_pct > 0 else ("dn" if chg_pct < 0 else "flat")
            arrow = "▲" if chg_pct > 0 else "▼" if chg_pct < 0 else "▬"
            col.markdown(
                metric_card(
                    name,
                    fmt_num(snap.last_price),
                    f"{arrow} {fmt_pct(chg_pct)}  ·  Vol {fmt_num(snap.volume)}",
                    d,
                ),
                unsafe_allow_html=True,
            )
        else:
            col.markdown(metric_card(name, "—"), unsafe_allow_html=True)

    # Option chain live subscription
    st.markdown('<div class="section-title">Option Chain · Live Ticks</div>',
                unsafe_allow_html=True)

    c1, c2, c3 = st.columns([2, 2, 1])
    name = c1.selectbox("Underlying", ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"], 0)
    # pull expiries from NSE chain (cached)
    raw = fetch_option_chain(name)
    expiries = []
    underlying_price = None
    if raw and "records" in raw:
        expiries = raw["records"].get("expiryDates", [])
        underlying_price = raw["records"].get("underlyingValue")
    expiry_choice = c2.selectbox("Expiry", expiries, 0) if expiries else None
    n_strikes = c3.number_input("Strikes ± ATM", 3, 15, 5,
                                key="live_ticker_strikes")

    if c1.button("📡 Subscribe to option chain", type="primary"):
        if underlying_price and expiry_choice:
            step = 50 if name in ("NIFTY", "FINNIFTY") else 100
            atm = round(underlying_price / step) * step
            target_strikes = [atm + i * step
                              for i in range(-n_strikes, n_strikes + 1)]
            try:
                # Convert "DD-Mon-YYYY" → "YYYY-MM-DD"
                expiry_dt = datetime.strptime(expiry_choice, "%d-%b-%Y").date()
                tokens_map = resolve_option_tokens(
                    kite, name, str(expiry_dt), target_strikes
                )
                if tokens_map:
                    ticker.subscribe(list(tokens_map.keys()), mode="full")
                    st.session_state["live_option_tokens"] = tokens_map
                    st.success(f"Subscribed to {len(tokens_map)} option strikes.")
                else:
                    st.warning("No instruments found for that expiry/strike range.")
            except Exception as e:
                st.error(f"Subscription failed: {e}")

    # Render live option chain table
    tokens_map = st.session_state.get("live_option_tokens", {})
    if tokens_map:
        rows = []
        for tok, info in tokens_map.items():
            snap = ticker.latest(tok)
            rows.append({
                "Strike": info["strike"],
                "Side": info["side"],
                "LTP": snap.last_price if snap else 0,
                "Bid": (snap.depth.get("buy", [{}])[0].get("price", 0)
                        if snap and snap.depth else 0),
                "Ask": (snap.depth.get("sell", [{}])[0].get("price", 0)
                        if snap and snap.depth else 0),
                "Vol": snap.volume if snap else 0,
                "OI": snap.oi if snap else 0,
                "Last update": snap.ts.strftime("%H:%M:%S") if snap else "—",
            })
        live_df = pd.DataFrame(rows)
        # Pivot so CE | Strike | PE
        ce = live_df[live_df["Side"] == "CE"].set_index("Strike").drop(columns="Side")
        pe = live_df[live_df["Side"] == "PE"].set_index("Strike").drop(columns="Side")
        pivot = ce.add_suffix("_CE").join(pe.add_suffix("_PE"), how="outer")
        pivot = pivot.sort_index()
        st.dataframe(pivot.style.format({
            "LTP_CE": "{:.2f}", "Bid_CE": "{:.2f}", "Ask_CE": "{:.2f}",
            "Vol_CE": "{:,.0f}", "OI_CE": "{:,.0f}",
            "LTP_PE": "{:.2f}", "Bid_PE": "{:.2f}", "Ask_PE": "{:.2f}",
            "Vol_PE": "{:,.0f}", "OI_PE": "{:,.0f}",
        }), use_container_width=True, height=420)

        st.caption(
            f"📡 Subscribed: {name} expiry {expiry_choice}, ATM±{n_strikes} strikes. "
            "Auto-refresh the page (button below) to see ticks update."
        )

    if st.button("⏱ Refresh now"):
        st.rerun()


# ================================================================
# MAIN
# ================================================================

def main():
    st.set_page_config(page_title="Pro Market Analyzer",
                       page_icon="📊", layout="wide",
                       initial_sidebar_state="collapsed")
    st.markdown(CUSTOM_CSS, unsafe_allow_html=True)
    render_hero()

    # Sidebar controls
    with st.sidebar:
        st.markdown("### Controls")
        refresh_options = {
            "Off": None, "5s (live)": 5, "15s": 15,
            "30s (default)": 30, "60s": 60,
        }
        refresh_label = st.selectbox(
            "Auto-refresh", list(refresh_options.keys()),
            index=0,
            help="5s is fine on local. NSE rate-limits aggressive refresh — "
                 "use 30s+ if you start seeing failures.",
        )
        refresh_interval = refresh_options[refresh_label]

        if st.button("🔄 Force refresh all data"):
            st.cache_data.clear()
            st.rerun()
        st.caption("Tip: 5–15s feels live but stresses NSE. 30s is safe.")

        # IV history stats
        if iv_history_stats is not None:
            with st.expander("📈 IV history coverage"):
                try:
                    stats = iv_history_stats()
                    for sym, s in stats.items():
                        if s["days"] > 0:
                            st.caption(
                                f"**{sym}**: {s['days']}d "
                                f"({s['first']} → {s['last']})"
                            )
                        else:
                            st.caption(f"**{sym}**: no data yet")
                except Exception as e:
                    st.caption(f"Error: {e}")

    # Pull index quotes once for the whole app
    idx_quotes = {name: yf_quote(t) for name, t in INDICES.items()}

    # Build alerts (needs option chain + breadth context)
    oc_raw = fetch_option_chain("NIFTY")
    oc_df, oc_meta = parse_option_chain(oc_raw) if oc_raw else (pd.DataFrame(), {})
    if not oc_df.empty:
        # use only nearest expiry for alerts
        nearest_expiry = oc_meta.get("expiries", [None])[0]
        oc_df_alert = oc_df[oc_df["expiry"] == nearest_expiry] if nearest_expiry else oc_df
        pcr_alert, _ = compute_pcr(oc_df_alert)
        max_pain_alert = compute_max_pain(oc_df_alert)
    else:
        oc_df_alert, pcr_alert, max_pain_alert = pd.DataFrame(), float("nan"), None

    ad_raw = fetch_advance_decline()
    ad_first = (ad_raw["data"][0] if ad_raw and "data" in ad_raw and ad_raw["data"] else {}) if ad_raw else {}

    alerts = build_alerts(oc_df_alert, oc_meta, idx_quotes, ad_first, pcr_alert, max_pain_alert)

    # Get a ticker instance if Kite is set up — share across tabs that need it
    shared_ticker = None
    try:
        if get_ticker is not None:
            api_key = st.session_state.get("kite_api_key", os.environ.get("KITE_API_KEY", ""))
            api_secret = st.session_state.get("kite_api_secret",
                                              os.environ.get("KITE_API_SECRET", ""))
            if api_key and api_secret and KiteSession is not None:
                # Only attempt ticker if we have a fresh token (no interactive login here)
                from kite_auto_login import load_token
                cached = load_token()
                if cached and cached.get("api_key") == api_key:
                    shared_ticker = get_ticker(api_key, cached["access_token"])
    except Exception:
        shared_ticker = None

    tabs = st.tabs([
        "🎯 Overview & Alerts",
        "⛓ Option Chain",
        "🧮 Strategy Builder",
        "📈 Trade Simulator",
        "📊 Breadth & Sectors",
        "💸 FII / DII Flows",
        "🌅 Pre/Post & Global",
        "📡 Live Ticker",
        "💼 My Portfolio (Kite)",
    ])

    with tabs[0]:
        tab_overview(idx_quotes, alerts)
    with tabs[1]:
        tab_option_chain()
    with tabs[2]:
        if tab_strategy_builder is not None:
            tab_strategy_builder(
                fetch_option_chain, parse_option_chain,
                yf_quote_fn=yf_quote, ticker=shared_ticker,
            )
        else:
            st.error("Strategy Builder module failed to load. "
                     "Make sure `strategy_builder.py`, `options_math.py`, "
                     "`iv_history.py`, `trade_simulator.py` are alongside this "
                     "file, and run `pip install scipy`.")
    with tabs[3]:
        if tab_trade_simulator is not None:
            tab_trade_simulator(
                fetch_option_chain, parse_option_chain,
                ticker=shared_ticker,
            )
        else:
            st.error("Trade Simulator module failed to load. "
                     "Check `trade_simulator_ui.py` is alongside this file.")
    with tabs[4]:
        tab_breadth(idx_quotes)
    with tabs[5]:
        tab_flows()
    with tabs[6]:
        tab_pre_post()
    with tabs[7]:
        tab_live_ticker()
    with tabs[8]:
        tab_portfolio()

    st.markdown(
        f"""<div style="text-align:center;color:#6b7280;
        font-family:'JetBrains Mono',monospace;font-size:11px;margin-top:24px;">
        v{APP_VERSION} · Data: Kite + NSE + yfinance · Educational use only — not investment advice
        </div>""",
        unsafe_allow_html=True,
    )

    if refresh_interval is not None:
        time.sleep(refresh_interval)
        st.rerun()


if __name__ == "__main__":
    main()
