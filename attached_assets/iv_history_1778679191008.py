"""
================================================================
IV HISTORY — Implied Volatility tracking & analytics
================================================================
Persists daily ATM IV snapshots for each tracked underlying to a
local SQLite database. Computes IV Rank and IV Percentile from
the historical window — the two metrics premium sellers live by.

  IV Rank       = (today_IV - 1y_low) / (1y_high - 1y_low)
  IV Percentile = pct of days in window with IV < today's IV

Why both?
  - IV Rank tells you where IV sits between its extremes (good for
    "is this near the top or bottom?" intuition)
  - IV Percentile tells you how often IV has been lower than today
    (better for "is selling premium currently statistically attractive?")

Why local SQLite (not a cloud service)?
  - Zero ops, single file at ~/.market_analyzer/iv_history.db
  - One ATM IV record per (symbol, date) — tiny footprint
  - Survives across Streamlit re-runs (cache_resource caches the
    connection, not the data)
================================================================
"""

from __future__ import annotations

import os
import sqlite3
import threading
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd


IST = timezone(timedelta(hours=5, minutes=30))
DEFAULT_DB_PATH = Path.home() / ".market_analyzer" / "iv_history.db"
TRACKED_SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"]


# ================================================================
# Schema
# ================================================================

_SCHEMA = """
CREATE TABLE IF NOT EXISTS iv_history (
    symbol      TEXT NOT NULL,
    date        TEXT NOT NULL,             -- ISO date (YYYY-MM-DD), IST
    atm_iv      REAL NOT NULL,             -- ATM IV in % (e.g. 13.5)
    spot        REAL NOT NULL,
    atm_strike  REAL NOT NULL,
    pcr_oi      REAL,                       -- snapshot of PCR for context
    max_pain    REAL,
    expiry      TEXT,                       -- which expiry we captured
    captured_at TEXT NOT NULL,              -- full ISO timestamp
    PRIMARY KEY (symbol, date)
);

CREATE INDEX IF NOT EXISTS idx_iv_symbol_date
    ON iv_history (symbol, date DESC);

CREATE TABLE IF NOT EXISTS saved_positions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    symbol       TEXT NOT NULL,
    expiry       TEXT NOT NULL,
    legs_json    TEXT NOT NULL,             -- JSON-encoded list of legs
    entry_spot   REAL,
    entry_cost   REAL,                       -- net debit (+) or credit (-)
    entry_iv     REAL,                       -- avg IV at entry
    notes        TEXT,
    created_at   TEXT NOT NULL,
    closed_at    TEXT,                       -- NULL if open
    close_pnl    REAL                        -- realized P&L on close
);

CREATE INDEX IF NOT EXISTS idx_pos_open
    ON saved_positions (closed_at);
"""


# ================================================================
# Connection management — thread-safe singleton
# ================================================================

_conn_lock = threading.Lock()
_conn_per_thread: Dict[int, sqlite3.Connection] = {}


def _connect(db_path: Path = DEFAULT_DB_PATH) -> sqlite3.Connection:
    """
    One connection per thread (SQLite default). Initializes the schema
    on first connect.
    """
    db_path.parent.mkdir(parents=True, exist_ok=True)
    tid = threading.get_ident()
    with _conn_lock:
        if tid not in _conn_per_thread:
            conn = sqlite3.connect(
                str(db_path), check_same_thread=False, isolation_level=None,
            )
            conn.row_factory = sqlite3.Row
            conn.executescript(_SCHEMA)
            _conn_per_thread[tid] = conn
        return _conn_per_thread[tid]


# ================================================================
# Daily IV recording
# ================================================================

def record_atm_iv(symbol: str, atm_iv_pct: float, spot: float,
                  atm_strike: float, expiry: str,
                  pcr_oi: Optional[float] = None,
                  max_pain: Optional[float] = None,
                  db_path: Path = DEFAULT_DB_PATH) -> bool:
    """
    Record today's ATM IV snapshot. Idempotent: re-running on the same
    day updates the row (so the dashboard can refresh the snapshot
    multiple times before market close without inserting duplicates).

    Returns True if recorded, False if input was invalid.
    """
    if atm_iv_pct <= 0 or atm_iv_pct > 200:
        return False
    if spot <= 0:
        return False

    today = datetime.now(IST).date().isoformat()
    captured_at = datetime.now(IST).isoformat()
    conn = _connect(db_path)
    conn.execute(
        """
        INSERT INTO iv_history
          (symbol, date, atm_iv, spot, atm_strike, pcr_oi, max_pain,
           expiry, captured_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(symbol, date) DO UPDATE SET
          atm_iv = excluded.atm_iv,
          spot = excluded.spot,
          atm_strike = excluded.atm_strike,
          pcr_oi = excluded.pcr_oi,
          max_pain = excluded.max_pain,
          expiry = excluded.expiry,
          captured_at = excluded.captured_at
        """,
        (symbol.upper(), today, float(atm_iv_pct), float(spot),
         float(atm_strike),
         float(pcr_oi) if pcr_oi is not None else None,
         float(max_pain) if max_pain is not None else None,
         expiry, captured_at),
    )
    return True


def get_history(symbol: str, days: int = 365,
                db_path: Path = DEFAULT_DB_PATH) -> pd.DataFrame:
    """Pull last N days of IV history for one symbol."""
    cutoff = (datetime.now(IST).date() - timedelta(days=days)).isoformat()
    conn = _connect(db_path)
    df = pd.read_sql_query(
        """
        SELECT date, atm_iv, spot, atm_strike, pcr_oi, max_pain
        FROM iv_history
        WHERE symbol = ? AND date >= ?
        ORDER BY date ASC
        """,
        conn, params=(symbol.upper(), cutoff),
    )
    if not df.empty:
        df["date"] = pd.to_datetime(df["date"])
    return df


# ================================================================
# Analytics
# ================================================================

def compute_iv_metrics(history: pd.DataFrame,
                       today_iv: float) -> Dict[str, Optional[float]]:
    """
    Returns:
      iv_rank      : (today - low) / (high - low) × 100
      iv_percentile: pct of days with IV < today's IV
      iv_high      : max IV in window
      iv_low       : min IV in window
      iv_mean      : average IV
      iv_median    : median IV
      iv_std       : standard deviation
      days_of_data : sample size
    """
    if history.empty or "atm_iv" not in history.columns:
        return {k: None for k in ("iv_rank", "iv_percentile", "iv_high",
                                  "iv_low", "iv_mean", "iv_median",
                                  "iv_std", "days_of_data")}

    ivs = history["atm_iv"].dropna()
    if len(ivs) < 2:
        return {
            "iv_rank": None, "iv_percentile": None,
            "iv_high": float(ivs.iloc[0]) if len(ivs) else None,
            "iv_low": float(ivs.iloc[0]) if len(ivs) else None,
            "iv_mean": float(ivs.iloc[0]) if len(ivs) else None,
            "iv_median": float(ivs.iloc[0]) if len(ivs) else None,
            "iv_std": 0.0, "days_of_data": len(ivs),
        }

    hi, lo = float(ivs.max()), float(ivs.min())
    iv_rank = ((today_iv - lo) / (hi - lo) * 100) if hi > lo else 50.0
    iv_pctile = float((ivs < today_iv).sum() / len(ivs) * 100)
    return {
        "iv_rank": float(np.clip(iv_rank, 0, 100)),
        "iv_percentile": iv_pctile,
        "iv_high": hi,
        "iv_low": lo,
        "iv_mean": float(ivs.mean()),
        "iv_median": float(ivs.median()),
        "iv_std": float(ivs.std()),
        "days_of_data": len(ivs),
    }


def interpret_iv_rank(rank: Optional[float]) -> Tuple[str, str]:
    """Returns (label, advice) for the given IV Rank."""
    if rank is None:
        return ("—", "Not enough history yet. Record daily for a few weeks.")
    if rank < 25:
        return ("Very Low",
                "IV is cheap. Premium buying (long straddles/strangles) "
                "is statistically more attractive than selling.")
    if rank < 50:
        return ("Below Average",
                "IV slightly cheap. Neutral — consider directional debit spreads.")
    if rank < 75:
        return ("Above Average",
                "IV elevated. Premium selling (short strangles, condors, "
                "credit spreads) starts to look attractive.")
    return ("Very High",
            "IV is expensive. Strong edge for premium sellers — but size "
            "down because vol expansion has just happened.")


# ================================================================
# Saved positions (for trade simulator)
# ================================================================

def save_position(name: str, symbol: str, expiry: str,
                  legs_json: str, entry_spot: float, entry_cost: float,
                  entry_iv: float, notes: str = "",
                  db_path: Path = DEFAULT_DB_PATH) -> int:
    """Persist a strategy as an open virtual position. Returns row id."""
    conn = _connect(db_path)
    cur = conn.execute(
        """
        INSERT INTO saved_positions
          (name, symbol, expiry, legs_json, entry_spot, entry_cost,
           entry_iv, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (name, symbol, expiry, legs_json, entry_spot, entry_cost,
         entry_iv, notes, datetime.now(IST).isoformat()),
    )
    return cur.lastrowid


def list_positions(open_only: bool = True,
                   db_path: Path = DEFAULT_DB_PATH) -> pd.DataFrame:
    conn = _connect(db_path)
    where = "WHERE closed_at IS NULL" if open_only else ""
    df = pd.read_sql_query(
        f"SELECT * FROM saved_positions {where} ORDER BY created_at DESC",
        conn,
    )
    return df


def close_position(position_id: int, realized_pnl: float,
                   db_path: Path = DEFAULT_DB_PATH) -> bool:
    conn = _connect(db_path)
    conn.execute(
        """
        UPDATE saved_positions
        SET closed_at = ?, close_pnl = ?
        WHERE id = ? AND closed_at IS NULL
        """,
        (datetime.now(IST).isoformat(), float(realized_pnl), position_id),
    )
    return True


def delete_position(position_id: int,
                    db_path: Path = DEFAULT_DB_PATH) -> bool:
    conn = _connect(db_path)
    conn.execute("DELETE FROM saved_positions WHERE id = ?", (position_id,))
    return True


def stats(db_path: Path = DEFAULT_DB_PATH) -> Dict:
    """Quick stats for the dashboard footer."""
    conn = _connect(db_path)
    out = {}
    for sym in TRACKED_SYMBOLS:
        row = conn.execute(
            "SELECT COUNT(*) as n, MIN(date) as first, MAX(date) as last "
            "FROM iv_history WHERE symbol = ?", (sym,),
        ).fetchone()
        out[sym] = {"days": row["n"], "first": row["first"], "last": row["last"]}
    return out


# ================================================================
# Self-test (run with: python iv_history.py)
# ================================================================

if __name__ == "__main__":
    import random
    import tempfile

    # Test with a temp DB so we don't pollute the real one
    test_db = Path(tempfile.mkdtemp()) / "test.db"
    print(f"Test DB: {test_db}")

    # Seed 60 days of synthetic NIFTY IV history (mean 14%, std 2%)
    random.seed(42)
    base = datetime.now(IST).date()
    for d in range(60, 0, -1):
        day_date = base - timedelta(days=d)
        iv = max(8, min(25, 14 + random.gauss(0, 2)))
        # Manually insert with historical date
        conn = _connect(test_db)
        conn.execute(
            "INSERT OR REPLACE INTO iv_history "
            "(symbol, date, atm_iv, spot, atm_strike, expiry, captured_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("NIFTY", day_date.isoformat(), iv, 24800, 24800,
             "22-May-2026", datetime.now(IST).isoformat()),
        )

    # Record today's IV
    record_atm_iv("NIFTY", 18.5, 24800, 24800, "22-May-2026", db_path=test_db)

    # Query
    hist = get_history("NIFTY", days=90, db_path=test_db)
    print(f"\nHistory: {len(hist)} rows")
    print(f"  First: {hist['date'].min().date() if not hist.empty else 'none'}")
    print(f"  Last:  {hist['date'].max().date() if not hist.empty else 'none'}")
    print(f"  Range: {hist['atm_iv'].min():.2f}% — {hist['atm_iv'].max():.2f}%")

    metrics = compute_iv_metrics(hist, today_iv=18.5)
    print(f"\nMetrics for today_iv=18.5%:")
    for k, v in metrics.items():
        if v is not None and isinstance(v, float):
            print(f"  {k:18s} {v:.2f}")
        else:
            print(f"  {k:18s} {v}")

    label, advice = interpret_iv_rank(metrics["iv_rank"])
    print(f"\nIV Rank label: {label}")
    print(f"Advice: {advice}")

    # Test saved positions
    pid = save_position(
        "Test Iron Condor", "NIFTY", "22-May-2026",
        legs_json='[{"strike":24850,"option_type":"CE","side":"SELL","quantity":1,"premium":85,"iv":0.13,"lot_size":75}]',
        entry_spot=24800, entry_cost=-8850, entry_iv=0.13,
        notes="Test position", db_path=test_db,
    )
    print(f"\nSaved position id={pid}")
    print(f"Open positions: {len(list_positions(db_path=test_db))}")
