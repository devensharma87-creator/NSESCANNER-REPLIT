#!/usr/bin/env python3
"""
kite_fetch_indices.py
=====================
Pulls 2 years of 15-minute candles for NIFTY 50, NIFTY BANK, and SENSEX from
Kite Connect, and writes three CSVs in the EXACT format fno_backtester.py expects:

    date,open,high,low,close,volume

WHY THIS SHAPE
--------------
The backtester (tools/fno-backtester/fno_backtester.py) calls load_csv(), which
lowercases headers and expects a 'date' column plus OHLCV. This script's output
is guaranteed to match, so there is no format-mismatch step.

HOW IT RUNS IN YOUR REPO (the part your developer wires)
--------------------------------------------------------
Your app already authenticates to Kite for live data. This tool should reuse that
SAME access token rather than logging in again. Two integration options:

  1. (Preferred) Your developer exposes the current Kite access_token + api_key to
     this script via env vars KITE_API_KEY / KITE_ACCESS_TOKEN, sourced from the
     same place the live app reads them. Run it as a one-off Replit/Railway job.

  2. If your live auth is in TypeScript and awkward to share, port this fetch loop
     to TS using the same kiteconnect session the app already holds. The LOGIC below
     (chunking, interval, CSV shape) is the contract to preserve — language doesn't matter.

THE KITE CONSTRAINT THIS HANDLES
--------------------------------
Kite caps a single 15-minute request at ~200 days. 2 years ~ 730 days, so we loop
in 180-day chunks (safety margin under the cap) and concatenate. We pace requests
to respect rate limits.

DATA NOTES
----------
- These are SPOT indices; their candles do not expire (unlike option contracts).
- Index spot candles have volume = 0 on some feeds. The backtester's VWAP uses
  volume; if your index feed returns 0 volume, see the FALLBACK note at the bottom.
- Run this OUTSIDE market hours for stable, fully-formed candles.
"""

import os
import csv
import time
import datetime as dt

# kiteconnect is the official Zerodha SDK. In-repo, install with:
#   pip install kiteconnect
from kiteconnect import KiteConnect

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
YEARS_BACK = 2
CHUNK_DAYS = 180            # under Kite's ~200-day 15-min cap, with margin
INTERVAL = "15minute"
PACE_SECONDS = 0.4         # gentle pacing between requests (rate-limit safety)

# The three index spots. instrument_token is resolved at runtime from the
# instrument master so we never hard-code tokens that can drift.
INDEX_LOOKUP = {
    # output_filename : (exchange, tradingsymbol-as-listed-in-instrument-master)
    "NIFTY.csv":     ("NSE", "NIFTY 50"),
    "BANKNIFTY.csv": ("NSE", "NIFTY BANK"),
    "SENSEX.csv":    ("BSE", "SENSEX"),
}


def get_kite() -> KiteConnect:
    api_key = os.environ.get("KITE_API_KEY")
    access_token = os.environ.get("KITE_ACCESS_TOKEN")
    if not api_key or not access_token:
        raise SystemExit(
            "Set KITE_API_KEY and KITE_ACCESS_TOKEN (reuse the live app's token).")
    kite = KiteConnect(api_key=api_key)
    kite.set_access_token(access_token)
    return kite


def resolve_tokens(kite: KiteConnect):
    """Map each target index to its live instrument_token via the instrument master."""
    resolved = {}
    # Cache instrument dumps per exchange to avoid repeat downloads.
    dumps = {}
    for fname, (exch, symbol) in INDEX_LOOKUP.items():
        if exch not in dumps:
            dumps[exch] = kite.instruments(exch)
        match = next((i for i in dumps[exch]
                      if i["tradingsymbol"] == symbol), None)
        if not match:
            # Index names vary by feed; print candidates to help the dev adjust.
            cands = [i["tradingsymbol"] for i in dumps[exch]
                     if "NIFTY" in i["tradingsymbol"] or "SENSEX" in i["tradingsymbol"]][:20]
            raise SystemExit(
                f"Could not find {symbol!r} on {exch}. Nearby names: {cands}")
        resolved[fname] = match["instrument_token"]
        print(f"  {fname:14s} -> {symbol} (token {match['instrument_token']})")
    return resolved


def fetch_index(kite: KiteConnect, token: int):
    """Loop in CHUNK_DAYS windows over YEARS_BACK; return concatenated candles."""
    end = dt.datetime.now()
    start = end - dt.timedelta(days=365 * YEARS_BACK)
    all_rows = []
    cursor = start
    while cursor < end:
        chunk_end = min(cursor + dt.timedelta(days=CHUNK_DAYS), end)
        candles = kite.historical_data(
            instrument_token=token,
            from_date=cursor,
            to_date=chunk_end,
            interval=INTERVAL,
        )
        all_rows.extend(candles)
        print(f"    {cursor.date()} -> {chunk_end.date()}: {len(candles)} candles")
        cursor = chunk_end + dt.timedelta(days=1)
        time.sleep(PACE_SECONDS)
    return all_rows


def write_csv(path: str, rows):
    """Write in the EXACT shape the backtester's load_csv expects."""
    # Dedupe on timestamp (chunk boundaries can overlap by a candle) and sort.
    seen = {}
    for r in rows:
        seen[r["date"]] = r
    ordered = [seen[k] for k in sorted(seen)]
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["date", "open", "high", "low", "close", "volume"])
        for r in ordered:
            w.writerow([r["date"].isoformat(), r["open"], r["high"],
                        r["low"], r["close"], r.get("volume", 0)])
    print(f"  wrote {path}: {len(ordered)} unique candles")


def main():
    print(f"Fetching {YEARS_BACK}y of {INTERVAL} candles for 3 indices...")
    kite = get_kite()
    print("Resolving instrument tokens:")
    tokens = resolve_tokens(kite)
    for fname, token in tokens.items():
        print(f"\n{fname}:")
        rows = fetch_index(kite, token)
        write_csv(fname, rows)
    print("\nDone. Feed each into the backtester, e.g.:")
    print("  python3 fno_backtester.py --csv NIFTY.csv --index NIFTY")


if __name__ == "__main__":
    main()

# ---------------------------------------------------------------------------
# FALLBACK NOTE — volume on index spot
# ---------------------------------------------------------------------------
# Kite index-spot candles may return volume=0 (indices aren't "traded"). The
# backtester's VWAP and Volume-Breakout logic need real volume. Two honest options:
#
#   (A) Backtest on index FUTURES (near-month, continuous) instead of spot — futures
#       have real volume and track the index closely. This is the more accurate
#       choice for a volume-aware strategy. Your developer would resolve the
#       near-month future token and roll it across expiries.
#
#   (B) Keep spot but make VWAP volume-agnostic (use a typical-price moving anchor).
#       Simpler, but it's no longer a true VWAP.
#
# RECOMMENDATION: discuss with the advisor before choosing. If the live system trades
# off index VWAP computed from a volume feed, the backtest must use the SAME volume
# basis or the comparison is invalid. This is a correctness decision, not a convenience one.
