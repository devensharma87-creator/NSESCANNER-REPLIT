"""
================================================================
KITE TICKER — Background WebSocket Worker
================================================================
True tick-level streaming from Kite via WebSocket. Bridges the gap
between Streamlit's request-response model and a persistent feed.

Architecture
------------
    Kite WS  ───┐
                ▼
        ┌──────────────────┐
        │ KiteTicker thread│  (daemon, survives Streamlit re-runs)
        │  - on_ticks      │
        │  - on_connect    │
        │  - on_close      │
        └────────┬─────────┘
                 ▼
        ┌──────────────────┐
        │   TickStore      │  (thread-safe singleton, in-memory)
        │  - latest()      │
        │  - history(tok)  │
        │  - subscribe(tok)│
        └────────┬─────────┘
                 ▼
    Streamlit UI polls TickStore every render

Why a thread + store (not a queue):
    Streamlit re-runs the script on every interaction. A queue would
    drain only when the script polls it, missing ticks between renders.
    The store keeps a rolling window of recent ticks for *every*
    subscribed instrument, so the UI always reads the latest snapshot.

Why a singleton:
    @st.cache_resource ensures one TickerWorker exists per process,
    not one per Streamlit re-run. Re-runs grab the same instance.

Usage in Streamlit:
    from kite_ticker import get_ticker

    ticker = get_ticker(api_key, access_token)
    ticker.subscribe([256265, 260105])   # NIFTY, BANKNIFTY tokens

    snapshot = ticker.latest(256265)
    print(snapshot["last_price"])
================================================================
"""

from __future__ import annotations

import logging
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Set

try:
    from kiteconnect import KiteTicker
except ImportError:
    KiteTicker = None


IST = timezone(timedelta(hours=5, minutes=30))
HISTORY_PER_TOKEN = 1000   # rolling window of recent ticks per instrument
log = logging.getLogger("kite_ticker")
log.setLevel(logging.INFO)


# ================================================================
# Thread-safe tick store
# ================================================================

@dataclass
class TickSnapshot:
    """One instant in time for one instrument."""
    instrument_token: int
    last_price: float = 0.0
    last_qty: int = 0
    avg_price: float = 0.0
    volume: int = 0
    buy_qty: int = 0
    sell_qty: int = 0
    open_price: float = 0.0
    high_price: float = 0.0
    low_price: float = 0.0
    close_price: float = 0.0
    oi: int = 0
    oi_day_high: int = 0
    oi_day_low: int = 0
    change: float = 0.0
    depth: Dict = field(default_factory=dict)
    ts: datetime = field(default_factory=lambda: datetime.now(IST))


class TickStore:
    """
    Holds the latest snapshot + a rolling history for each subscribed
    instrument. All public methods are thread-safe.
    """

    def __init__(self, history_size: int = HISTORY_PER_TOKEN):
        self._latest: Dict[int, TickSnapshot] = {}
        self._history: Dict[int, deque] = {}
        self._history_size = history_size
        self._lock = threading.RLock()
        self._stats = {"ticks_received": 0, "last_tick_ts": None}

    def update(self, tick: dict) -> None:
        token = tick.get("instrument_token")
        if token is None:
            return
        snap = TickSnapshot(
            instrument_token=token,
            last_price=tick.get("last_price", 0.0) or 0.0,
            last_qty=tick.get("last_traded_quantity", 0) or 0,
            avg_price=tick.get("average_traded_price", 0.0) or 0.0,
            volume=tick.get("volume_traded", 0) or 0,
            buy_qty=tick.get("total_buy_quantity", 0) or 0,
            sell_qty=tick.get("total_sell_quantity", 0) or 0,
            open_price=(tick.get("ohlc") or {}).get("open", 0.0) or 0.0,
            high_price=(tick.get("ohlc") or {}).get("high", 0.0) or 0.0,
            low_price=(tick.get("ohlc") or {}).get("low", 0.0) or 0.0,
            close_price=(tick.get("ohlc") or {}).get("close", 0.0) or 0.0,
            oi=tick.get("oi", 0) or 0,
            oi_day_high=tick.get("oi_day_high", 0) or 0,
            oi_day_low=tick.get("oi_day_low", 0) or 0,
            change=tick.get("change", 0.0) or 0.0,
            depth=tick.get("depth", {}) or {},
            ts=datetime.now(IST),
        )
        with self._lock:
            self._latest[token] = snap
            if token not in self._history:
                self._history[token] = deque(maxlen=self._history_size)
            self._history[token].append(snap)
            self._stats["ticks_received"] += 1
            self._stats["last_tick_ts"] = snap.ts

    def latest(self, token: int) -> Optional[TickSnapshot]:
        with self._lock:
            return self._latest.get(token)

    def all_latest(self) -> Dict[int, TickSnapshot]:
        with self._lock:
            return dict(self._latest)

    def history(self, token: int) -> List[TickSnapshot]:
        with self._lock:
            return list(self._history.get(token, []))

    def stats(self) -> dict:
        with self._lock:
            return dict(self._stats)


# ================================================================
# Background ticker worker
# ================================================================

class TickerWorker:
    """
    Owns one KiteTicker WebSocket connection in a daemon thread.

    Thread-safe operations:
      - subscribe(tokens) / unsubscribe(tokens) (deduplicates, batches)
      - latest(token), history(token), stats()
      - stop()
    """

    def __init__(self, api_key: str, access_token: str, debug: bool = False):
        if KiteTicker is None:
            raise ImportError(
                "kiteconnect package not installed. Run: pip install kiteconnect"
            )
        self.api_key = api_key
        self.access_token = access_token
        self.store = TickStore()

        self._kt: Optional[KiteTicker] = None
        self._subscribed: Set[int] = set()
        self._pending: Set[int] = set()        # to subscribe once connected
        self._mode = "full"                    # ltp | quote | full
        self._lock = threading.RLock()
        self._connected = False
        self._stop_flag = False
        self._thread: Optional[threading.Thread] = None
        self._debug = debug
        self._last_error: Optional[str] = None

    # --- Public API ---------------------------------------------------

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_flag = False
        self._thread = threading.Thread(target=self._run, daemon=True,
                                        name="KiteTickerWorker")
        self._thread.start()

    def stop(self) -> None:
        self._stop_flag = True
        try:
            if self._kt:
                self._kt.close(code=1000, reason="user_stop")
        except Exception:
            pass

    def subscribe(self, tokens: List[int], mode: str = "full") -> None:
        """Add tokens to the live subscription. Safe to call any time."""
        with self._lock:
            new = set(tokens) - self._subscribed
            if not new:
                return
            self._mode = mode
            if self._connected and self._kt:
                tok_list = list(new)
                try:
                    self._kt.subscribe(tok_list)
                    self._kt.set_mode(mode, tok_list)
                    self._subscribed.update(new)
                except Exception as e:
                    self._last_error = f"subscribe: {e}"
                    self._pending.update(new)
            else:
                self._pending.update(new)

    def unsubscribe(self, tokens: List[int]) -> None:
        with self._lock:
            to_remove = set(tokens) & self._subscribed
            if not to_remove:
                return
            if self._connected and self._kt:
                try:
                    self._kt.unsubscribe(list(to_remove))
                except Exception:
                    pass
            self._subscribed -= to_remove
            self._pending -= to_remove

    def is_connected(self) -> bool:
        return self._connected

    def subscribed_tokens(self) -> Set[int]:
        with self._lock:
            return set(self._subscribed)

    def latest(self, token: int) -> Optional[TickSnapshot]:
        return self.store.latest(token)

    def history(self, token: int) -> List[TickSnapshot]:
        return self.store.history(token)

    def stats(self) -> dict:
        s = self.store.stats()
        s["connected"] = self._connected
        s["subscribed_count"] = len(self._subscribed)
        s["last_error"] = self._last_error
        return s

    # --- Internals ----------------------------------------------------

    def _run(self):
        """Build the KiteTicker, wire callbacks, and run it forever."""
        self._kt = KiteTicker(self.api_key, self.access_token)
        kt = self._kt

        def on_ticks(_ws, ticks):
            for t in ticks:
                self.store.update(t)

        def on_connect(ws, _response):
            self._connected = True
            self._last_error = None
            with self._lock:
                # subscribe to everything queued + anything previously subscribed
                # (handles reconnect mid-day)
                all_tokens = list(self._pending | self._subscribed)
                if all_tokens:
                    try:
                        ws.subscribe(all_tokens)
                        ws.set_mode(self._mode, all_tokens)
                        self._subscribed.update(all_tokens)
                        self._pending.clear()
                    except Exception as e:
                        self._last_error = f"on_connect subscribe: {e}"

        def on_close(_ws, code, reason):
            self._connected = False
            self._last_error = f"closed code={code} reason={reason}"

        def on_error(_ws, code, reason):
            self._last_error = f"error code={code} reason={reason}"

        def on_reconnect(_ws, attempts_count):
            log.info(f"reconnecting attempt={attempts_count}")

        def on_noreconnect(_ws):
            self._connected = False
            self._last_error = "noreconnect — gave up reconnecting"

        kt.on_ticks = on_ticks
        kt.on_connect = on_connect
        kt.on_close = on_close
        kt.on_error = on_error
        kt.on_reconnect = on_reconnect
        kt.on_noreconnect = on_noreconnect

        # connect() is blocking and runs the WS loop. threaded=True returns
        # immediately but then this worker thread itself has nothing to do —
        # we want this thread to BE the WS loop, so threaded=False.
        try:
            kt.connect(threaded=False, disable_ssl_verification=False)
        except Exception as e:
            self._last_error = f"connect: {e}"
            self._connected = False


# ================================================================
# Singleton accessor for Streamlit
# ================================================================

def get_ticker(api_key: str, access_token: str) -> TickerWorker:
    """
    Streamlit-friendly accessor. Cached via @st.cache_resource so
    the same TickerWorker is reused across re-runs.

    Outside Streamlit, this falls back to a module-level singleton.
    """
    try:
        import streamlit as st

        @st.cache_resource(show_spinner=False)
        def _cached(api_key: str, access_token: str) -> TickerWorker:
            w = TickerWorker(api_key, access_token)
            w.start()
            return w

        return _cached(api_key, access_token)
    except ImportError:
        return _module_singleton(api_key, access_token)


_module_singleton_lock = threading.Lock()
_module_singleton_instance: Optional[TickerWorker] = None


def _module_singleton(api_key: str, access_token: str) -> TickerWorker:
    global _module_singleton_instance
    with _module_singleton_lock:
        if _module_singleton_instance is None:
            _module_singleton_instance = TickerWorker(api_key, access_token)
            _module_singleton_instance.start()
        return _module_singleton_instance


# ================================================================
# Instrument-token resolution helpers
# ================================================================

# Hardcoded major-index tokens (these never change). For F&O options,
# you must look up tokens from the daily instrument dump.
INDEX_TOKENS = {
    "NIFTY 50":      256265,
    "NIFTY BANK":    260105,
    "NIFTY FIN SERVICE": 257801,
    "NIFTY MIDCAP SELECT": 288009,
    "INDIA VIX":     264969,
    "SENSEX":        265,
}


def resolve_option_tokens(kite, name: str, expiry: str,
                          strikes: List[int]) -> Dict[int, dict]:
    """
    Look up instrument tokens for a list of (strike, side=CE/PE) for a
    given index option (NIFTY/BANKNIFTY/etc.) and expiry.

    Parameters
    ----------
    kite : KiteConnect instance
    name : "NIFTY" | "BANKNIFTY" | "FINNIFTY" | "MIDCPNIFTY"
    expiry : "YYYY-MM-DD"
    strikes : list of strike prices (ints)

    Returns
    -------
    { instrument_token: {"strike": k, "side": "CE"/"PE", "symbol": str} }
    """
    instruments = kite.instruments("NFO")
    target_strikes = set(strikes)
    out = {}
    for inst in instruments:
        if inst["name"] != name:
            continue
        if inst["instrument_type"] not in ("CE", "PE"):
            continue
        if str(inst["expiry"]) != expiry:
            continue
        if int(inst["strike"]) not in target_strikes:
            continue
        out[inst["instrument_token"]] = {
            "strike": int(inst["strike"]),
            "side": inst["instrument_type"],
            "symbol": inst["tradingsymbol"],
        }
    return out


# ================================================================
# Self-test (run with: python kite_ticker.py)
# ================================================================

if __name__ == "__main__":
    import os
    import sys

    api_key = os.environ.get("KITE_API_KEY")
    access_token = os.environ.get("KITE_ACCESS_TOKEN")
    if not api_key or not access_token:
        print("Set KITE_API_KEY and KITE_ACCESS_TOKEN env vars.")
        sys.exit(1)

    worker = TickerWorker(api_key, access_token)
    worker.start()

    print("Waiting for connection...")
    for _ in range(20):
        if worker.is_connected():
            break
        time.sleep(0.5)
    if not worker.is_connected():
        print("Failed to connect:", worker.stats().get("last_error"))
        sys.exit(1)

    print("Connected. Subscribing to NIFTY + BANKNIFTY indices.")
    worker.subscribe([INDEX_TOKENS["NIFTY 50"], INDEX_TOKENS["NIFTY BANK"]],
                     mode="full")

    try:
        for i in range(30):
            time.sleep(1)
            nifty = worker.latest(INDEX_TOKENS["NIFTY 50"])
            bnf = worker.latest(INDEX_TOKENS["NIFTY BANK"])
            if nifty and bnf:
                print(f"NIFTY {nifty.last_price:.2f}  |  "
                      f"BANKNIFTY {bnf.last_price:.2f}  |  "
                      f"ticks={worker.stats()['ticks_received']}")
    finally:
        worker.stop()
