#!/usr/bin/env python3
"""
kite_fetch_indices.py  (REFERENCE / ALTERNATIVE fetcher)
========================================================
Pulls ~2 years of 15-minute candles for NIFTY 50, NIFTY BANK, and SENSEX from
Kite Connect and writes three CSVs in the EXACT format fno_backtester.py expects:

    date,open,high,low,close,volume

>>> WHICH FETCHER SHOULD I USE? <<<
This Python script needs the Kite token as env vars (KITE_API_KEY /
KITE_ACCESS_TOKEN). THIS APP DOES NOT STORE THE TOKEN THAT WAY — the live daily
token lives (encrypted) in the Postgres `kite_session` table. So the WIRED,
repo-native path is the TypeScript script, which reuses the live session with
zero token juggling:

    pnpm --filter @workspace/api-server run fetch:index-candles
    # -> writes tools/fno-backtester/data/{NIFTY,BANKNIFTY,SENSEX}.csv

Use THIS Python script only if you happen to have a Kite access token available
as an env var (e.g. a throwaway local login) and prefer Python. The fetch LOGIC
(chunking, interval, CSV shape) is identical to the TS version — the output is
the contract, language does not matter.

SPOT vs FUTURES — settled (do not switch to futures)
----------------------------------------------------
We fetch SPOT indices. The live engine computes index VWAP from Kite SPOT
candles where cash-index volume is 0, falls back to typical price when volume
is 0, and leaves the volume-breakout detector dormant. A backtest MUST use the
same volume basis as live, so futures (real volume) would test a strategy the
live system does NOT run = invalid. The backtester's session_vwap mirrors the
same typical-price fallback, so zero-volume spot data is valid.

Run OUTSIDE market hours for stable, fully-formed candles.
"""

import os
import csv
import time
import datetime as dt
from pathlib import Path

# kiteconnect is the official Zerodha SDK. Install with: pip install kiteconnect
from kiteconnect import KiteConnect

YEARS_BACK = 2
CHUNK_DAYS = 100           # comfortably under Kite's ~200-day 15-min cap
INTERVAL = "15minute"
PACE_SECONDS = 0.45        # gentle pacing between requests (3 req/s limit)

# Write next to the backtester so `--csv data/NIFTY.csv` just works.
OUT_DIR = Path(__file__).resolve().parent / "data"

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
            "Set KITE_API_KEY and KITE_ACCESS_TOKEN, or use the wired TS fetcher:\n"
            "  pnpm --filter @workspace/api-server run fetch:index-candles")
    kite = KiteConnect(api_key=api_key)
    kite.set_access_token(access_token)
    return kite


def resolve_tokens(kite: KiteConnect):
    """Map each target index to its live instrument_token via the instrument master."""
    resolved = {}
    dumps = {}
    for fname, (exch, symbol) in INDEX_LOOKUP.items():
        if exch not in dumps:
            dumps[exch] = kite.instruments(exch)
        match = next((i for i in dumps[exch]
                      if i["tradingsymbol"] == symbol), None)
        if not match:
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


def write_csv(fname: str, rows):
    """Write in the EXACT shape the backtester's load_csv expects."""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / fname
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
    print(f"Fetching {YEARS_BACK}y of {INTERVAL} SPOT candles for 3 indices...")
    kite = get_kite()
    print("Resolving instrument tokens:")
    tokens = resolve_tokens(kite)
    for fname, token in tokens.items():
        print(f"\n{fname}:")
        rows = fetch_index(kite, token)
        write_csv(fname, rows)
    print("\nDone. Feed each into the backtester, e.g.:")
    print("  python3 tools/fno-backtester/fno_backtester.py --csv tools/fno-backtester/data/NIFTY.csv --index NIFTY")


if __name__ == "__main__":
    main()
