"""
fno_backtester.py
=================
Replays the Signal Core spec (signal_core_spec.md) over historical 15-min index
candles, derives Entry/Stop/T1/T2 from structure, simulates each trade bar-by-bar,
applies REAL costs (fno_cost_model.net_pnl), and reports honest metrics including
the time-of-day breakdown that your live data proved matters most.

DESIGN RULES (to keep it honest):
  - NO LOOK-AHEAD. A bar's signal is decided on that bar's CLOSE; the trade can only
    fill on the NEXT bar onward. Indicators use only data up to the decision bar.
  - One trade per (index, signal) — no duplicate logging. A "win" = net P&L > 0,
    using the same cost function as live settlement.
  - Option premium is APPROXIMATED from spot moves via a delta proxy when a real
    historical option chain isn't supplied (documented below). Supply a real chain
    for production-grade numbers.

EXPECTED INPUT CSV (Kite 15-min export), one file per index:
    columns: date, open, high, low, close, volume
    date is IST timestamp parseable by pandas. 15-min bars, 09:15..15:30.

USAGE:
    python3 fno_backtester.py --selftest          # runs on synthetic data
    python3 fno_backtester.py --csv NIFTY.csv --index NIFTY
"""

import argparse
import numpy as np
import pandas as pd
from fno_cost_model import net_pnl, LOT_SIZE

# ---------------------------------------------------------------------------
# Indicators (all causal — no look-ahead)
# ---------------------------------------------------------------------------
def ema(s, span):
    return s.ewm(span=span, adjust=False).mean()

def rsi(s, period=14):
    d = s.diff()
    up = d.clip(lower=0).ewm(alpha=1/period, adjust=False).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1/period, adjust=False).mean()
    rs = up / dn.replace(0, np.nan)
    return (100 - 100/(1+rs)).fillna(50)

def atr(df, period=14):
    h, l, c = df['high'], df['low'], df['close']
    tr = pd.concat([h-l, (h-c.shift()).abs(), (l-c.shift()).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1/period, adjust=False).mean()

def session_vwap(df):
    """VWAP resets each trading day.

    VOLUME BASIS — must match the LIVE system or the backtest is invalid.
    The live engine (artifacts/api-server/src/lib/indicators.ts `sessionVwap`)
    computes index VWAP from Kite SPOT candles, where cash-index volume is 0
    for NIFTY/BANKNIFTY/SENSEX. Its rule is `out[i] = v > 0 ? pv/v : typ` — i.e.
    when cumulative volume is 0 it FALLS BACK to the bar's typical price rather
    than going undefined. We replicate that here so a zero-volume spot feed
    produces the SAME VWAP basis live uses (and a real-volume futures feed, if
    ever supplied, still yields a true cumulative VWAP). Returning NaN on zero
    volume — as a naive VWAP would — silently kills every VWAP-gated signal and
    makes the backtest disagree with live. Do not "fix" this back to NaN.
    """
    tp = (df['high'] + df['low'] + df['close']) / 3
    day = df.index.date
    pv = (tp * df['volume']).groupby(day).cumsum()
    vv = df['volume'].groupby(day).cumsum()
    vwap = pv / vv.replace(0, np.nan)
    # Where cumulative volume is 0 (spot index), use typical price — matches live.
    return vwap.where(vv > 0, tp)

def detect_fvg(df):
    """
    Fair Value Gap (3-bar imbalance), causal.
    Bullish FVG at bar i: low[i] > high[i-2]  (gap up, unfilled).
    Bearish FVG at bar i: high[i] < low[i-2].
    Returns two boolean Series.
    """
    bull = df['low'] > df['high'].shift(2)
    bear = df['high'] < df['low'].shift(2)
    return bull.fillna(False), bear.fillna(False)

def smc_structure(df, swing=3):
    """
    Minimal SMC: rolling swing highs/lows -> structural direction.
    +1 if last confirmed structure is a higher-high (bullish BOS), -1 lower-low, 0 none.
    Causal: uses a centered window only on PAST bars by shifting.
    """
    hh = df['high'].rolling(swing*2+1, center=True).max() == df['high']
    ll = df['low'].rolling(swing*2+1, center=True).min() == df['low']
    # shift so a swing is only "known" after it completes (no look-ahead)
    hh = hh.shift(swing).fillna(False)
    ll = ll.shift(swing).fillna(False)
    dir_ = pd.Series(0, index=df.index)
    last = 0
    last_high = last_low = np.nan
    out = []
    for i in range(len(df)):
        if hh.iloc[i]:
            if not np.isnan(last_high) and df['high'].iloc[i] > last_high:
                last = 1
            last_high = df['high'].iloc[i]
        if ll.iloc[i]:
            if not np.isnan(last_low) and df['low'].iloc[i] < last_low:
                last = -1
            last_low = df['low'].iloc[i]
        out.append(last)
    return pd.Series(out, index=df.index)

# ---------------------------------------------------------------------------
# Signal core (the confluence gate from the spec)
# ---------------------------------------------------------------------------
def build_signals(df):
    df = df.copy()
    df['ema9'] = ema(df['close'], 9)
    df['ema20'] = ema(df['close'], 20)
    df['ema50'] = ema(df['close'], 50)
    df['vwap'] = session_vwap(df)
    df['rsi'] = rsi(df['close'])
    df['atr'] = atr(df)
    df['fvg_bull'], df['fvg_bear'] = detect_fvg(df)
    df['smc'] = smc_structure(df)

    bull_stack = (df['ema9'] > df['ema20']) & (df['ema20'] > df['ema50']) & (df['close'] > df['ema9'])
    bear_stack = (df['ema9'] < df['ema20']) & (df['ema20'] < df['ema50']) & (df['close'] < df['ema9'])
    bull_vwap = df['close'] > df['vwap']
    bear_vwap = df['close'] < df['vwap']
    bull_smc = df['smc'] > 0
    bear_smc = df['smc'] < 0
    # FVG alignment: a bullish FVG present in the last 5 bars (recent demand reaction)
    bull_fvg = df['fvg_bull'].rolling(5).max().fillna(0).astype(bool)
    bear_fvg = df['fvg_bear'].rolling(5).max().fillna(0).astype(bool)

    df['long_gate'] = bull_stack & bull_vwap & bull_smc & bull_fvg
    df['short_gate'] = bear_stack & bear_vwap & bear_smc & bear_fvg
    return df

# ---------------------------------------------------------------------------
# Trade simulation (no look-ahead, real costs, premium via delta proxy)
# ---------------------------------------------------------------------------
def simulate(df, index, rr_min=1.5, slippage=0.005, delta_proxy=0.5,
             premium_per_spot=None):
    """
    delta_proxy: ATM option delta (~0.5). Premium change ~ delta * spot change.
    premium_per_spot: starting ATM premium as a function of spot; if None, use
                      a crude 0.4% of spot (realistic-ish ATM weekly). REPLACE with
                      a real historical chain for production numbers.
    """
    trades = []
    i = 50  # warm-up
    n = len(df)
    while i < n - 1:
        row = df.iloc[i]
        direction = None
        if row['long_gate']:
            direction = 'LONG'
        elif row['short_gate']:
            direction = 'SHORT'
        if direction is None:
            i += 1
            continue

        spot = row['close']
        a = row['atr']
        # structural stop distance per spec
        stop_dist = max(0.0030*spot, 1.0*a)
        stop_dist = min(stop_dist, max(0.0045*spot, 0.6*a)*1.5)  # reject-cap guard
        t1_dist = max(1.5*stop_dist, 0.010*spot)   # >=1.5R and a floor
        if t1_dist / stop_dist < rr_min:
            i += 1
            continue
        t2_dist = t1_dist * 1.7

        if direction == 'LONG':
            entry, stop, t1, t2 = spot, spot-stop_dist, spot+t1_dist, spot+t2_dist
        else:
            entry, stop, t1, t2 = spot, spot+stop_dist, spot-t1_dist, spot-t2_dist

        # premium proxy
        start_prem = (premium_per_spot(spot) if premium_per_spot else 0.004*spot)
        # walk forward from NEXT bar — no look-ahead
        outcome, exit_spot = 'EXPIRED', None
        for j in range(i+1, n):
            hi, lo = df['high'].iloc[j], df['low'].iloc[j]
            same_day = df.index[j].date() == df.index[i].date()
            if not same_day:   # intraday only; force-exit handled below
                exit_spot = df['close'].iloc[j-1]; outcome='TIME_EXIT'; jx=j-1; break
            if direction == 'LONG':
                if lo <= stop: outcome, exit_spot, jx = 'STOPPED', stop, j; break
                if hi >= t2: outcome, exit_spot, jx = 'T2', t2, j; break
                if hi >= t1: outcome, exit_spot, jx = 'T1', t1, j; break
            else:
                if hi >= stop: outcome, exit_spot, jx = 'STOPPED', stop, j; break
                if lo <= t2: outcome, exit_spot, jx = 'T2', t2, j; break
                if lo <= t1: outcome, exit_spot, jx = 'T1', t1, j; break
        else:
            exit_spot = df['close'].iloc[-1]; jx = n-1
        if exit_spot is None:
            exit_spot = df['close'].iloc[-1]; jx = n-1

        # spot move -> premium move via delta proxy
        spot_move = (exit_spot - entry) if direction=='LONG' else (entry - exit_spot)
        exit_prem = max(0.05, start_prem + delta_proxy*spot_move)
        g, c, npnl = net_pnl(index, start_prem, exit_prem, lots=1, slippage_pct_per_side=slippage)

        trades.append(dict(
            entry_time=df.index[i], exit_time=df.index[jx], direction=direction,
            outcome=outcome, entry_spot=entry, exit_spot=exit_spot,
            entry_prem=round(start_prem,2), exit_prem=round(exit_prem,2),
            gross=round(g,2), costs=round(c,2), net=round(npnl,2),
            hour=df.index[i].hour))
        i = jx + 1   # no overlapping trades
    return pd.DataFrame(trades)

# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------
def report(tr, index):
    if tr.empty:
        print(f"\n[{index}] No trades generated — confluence gate is strict (expected).")
        return
    wins = tr[tr['net']>0]; losses = tr[tr['net']<=0]
    decided = tr[tr['outcome'].isin(['T1','T2','STOPPED'])]
    wr = (decided['net']>0).mean()*100 if len(decided) else float('nan')
    pf = wins['net'].sum() / abs(losses['net'].sum()) if losses['net'].sum()!=0 else float('inf')
    print(f"\n{'='*60}\n[{index}] BACKTEST RESULT (net of real costs)\n{'='*60}")
    print(f"  Trades:            {len(tr)}")
    print(f"  Decided win rate:  {wr:.1f}%   (T1/T2 vs STOPPED)")
    print(f"  Net P&L:           Rs {tr['net'].sum():,.0f}")
    print(f"  Total costs paid:  Rs {tr['costs'].sum():,.0f}")
    print(f"  Profit factor:     {pf:.2f}")
    print(f"  Avg win:           Rs {wins['net'].mean() if len(wins) else 0:,.0f}")
    print(f"  Avg loss:          Rs {losses['net'].mean() if len(losses) else 0:,.0f}")
    print(f"  Expectancy/trade:  Rs {tr['net'].mean():,.0f}")
    eq = tr['net'].cumsum()
    print(f"  Max drawdown:      Rs {(eq.cummax()-eq).max():,.0f}")
    print(f"\n  --- BY HOUR (the window that matters) ---")
    by_h = tr.groupby('hour').agg(trades=('net','size'),
                                  win_rate=('net', lambda x:(x>0).mean()*100),
                                  net=('net','sum'))
    print(by_h.round(1).to_string())

# ---------------------------------------------------------------------------
# Self-test with synthetic data
# ---------------------------------------------------------------------------
def make_synthetic(days=180, seed=7):
    rng = np.random.default_rng(seed)
    rows, ts = [], []
    price = 23000.0
    start = pd.Timestamp('2024-01-01 09:15')
    d = start
    for _ in range(days):
        if d.weekday() < 5:
            drift = rng.normal(0, 1) * 8  # daily regime
            for b in range(25):  # 09:15..15:30 = 25 bars
                o = price
                price += drift*0.1 + rng.normal(0, 12)
                h = max(o, price) + abs(rng.normal(0,6))
                l = min(o, price) - abs(rng.normal(0,6))
                v = abs(rng.normal(100000, 30000))
                ts.append(d + pd.Timedelta(minutes=15*b))
                rows.append((o, h, l, price, v))
        d += pd.Timedelta(days=1)
        d = d.replace(hour=9, minute=15)
    df = pd.DataFrame(rows, columns=['open','high','low','close','volume'], index=pd.DatetimeIndex(ts))
    return df

def load_csv(path):
    df = pd.read_csv(path)
    df.columns = [c.strip().lower() for c in df.columns]
    df['date'] = pd.to_datetime(df['date'])
    return df.set_index('date').sort_index()[['open','high','low','close','volume']]

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument('--selftest', action='store_true')
    ap.add_argument('--csv'); ap.add_argument('--index', default='NIFTY')
    a = ap.parse_args()
    if a.selftest:
        print("Running self-test on synthetic data (engine validation only)...")
        df = make_synthetic()
        sig = build_signals(df)
        tr = simulate(sig, 'NIFTY')
        report(tr, 'NIFTY (SYNTHETIC)')
        print("\nNOTE: synthetic numbers are meaningless for strategy — they only prove the engine runs end-to-end without look-ahead.")
    elif a.csv:
        df = load_csv(a.csv)
        sig = build_signals(df)
        tr = simulate(sig, a.index)
        report(tr, a.index)
        tr.to_csv(f'backtest_trades_{a.index}.csv', index=False)
        print(f"\nPer-trade detail written to backtest_trades_{a.index}.csv")
    else:
        ap.print_help()
