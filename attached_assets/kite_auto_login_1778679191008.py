"""
================================================================
KITE AUTO-LOGIN HELPER
================================================================
Zerodha invalidates access tokens daily at ~06:00 IST. This module
automates the daily refresh:

  1. Spins up a tiny local HTTP server on 127.0.0.1:5000
  2. Opens the Kite login URL in your default browser
  3. You log in once (with 2FA) — Kite redirects to localhost:5000
  4. Server captures the request_token from the redirect URL
  5. Exchanges request_token + api_secret for an access_token
  6. Persists the token to ~/.kite_session.json with timestamp
  7. Subsequent calls reuse the token until it expires next morning

CRITICAL setup step (one-time):
  Log into https://kite.trade -> your app -> set redirect URL to:
      http://127.0.0.1:5000/

Usage:
  from kite_auto_login import KiteSession
  ks = KiteSession(api_key="xxx", api_secret="yyy")
  kite = ks.connect()       # interactive first time, silent after
  print(kite.profile())

For Streamlit:
  See `kite_login_button()` at the bottom — renders a one-click button.
================================================================
"""

from __future__ import annotations

import json
import os
import socket
import sys
import threading
import time
import webbrowser
from datetime import datetime, time as dtime, timezone, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse, parse_qs

try:
    from kiteconnect import KiteConnect
except ImportError:
    KiteConnect = None


IST = timezone(timedelta(hours=5, minutes=30))
DEFAULT_SESSION_FILE = Path.home() / ".kite_session.json"
DEFAULT_REDIRECT_HOST = "127.0.0.1"
DEFAULT_REDIRECT_PORT = 5000
TOKEN_INVALIDATION_HOUR_IST = 6  # Kite invalidates at ~06:00 IST


# ================================================================
# Token store
# ================================================================

def _is_token_fresh(generated_at: datetime) -> bool:
    """A token is fresh until the next 06:00 IST after it was generated."""
    now = datetime.now(IST)
    cutoff = generated_at.astimezone(IST).replace(
        hour=TOKEN_INVALIDATION_HOUR_IST, minute=0, second=0, microsecond=0
    )
    # If generated before today's cutoff, cutoff stays today.
    # If generated after today's cutoff, cutoff is tomorrow's.
    if generated_at.astimezone(IST) >= cutoff:
        cutoff = cutoff + timedelta(days=1)
    return now < cutoff


def load_token(path: Path = DEFAULT_SESSION_FILE) -> Optional[dict]:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
        generated_at = datetime.fromisoformat(data["generated_at"])
        if _is_token_fresh(generated_at):
            return data
        return None
    except Exception:
        return None


def save_token(api_key: str, access_token: str, user_id: str = "",
               path: Path = DEFAULT_SESSION_FILE) -> None:
    payload = {
        "api_key": api_key,
        "access_token": access_token,
        "user_id": user_id,
        "generated_at": datetime.now(IST).isoformat(),
    }
    path.write_text(json.dumps(payload, indent=2))
    # Lock down permissions (Unix) — token == account access
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


# ================================================================
# Local redirect-catcher HTTP server
# ================================================================

class _RequestTokenHandler(BaseHTTPRequestHandler):
    """Single-shot handler that captures ?request_token=... from Kite's redirect."""

    captured_token: Optional[str] = None
    captured_error: Optional[str] = None

    def do_GET(self):  # noqa: N802 (BaseHTTPRequestHandler API)
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        token = params.get("request_token", [None])[0]
        status = params.get("status", [None])[0]
        action = params.get("action", [None])[0]

        if token and status == "success":
            _RequestTokenHandler.captured_token = token
            self._send_html(_SUCCESS_HTML)
        else:
            error = params.get("message", ["Login failed or cancelled."])[0]
            _RequestTokenHandler.captured_error = error
            self._send_html(_FAILURE_HTML.format(error=error))

    def log_message(self, format, *args):  # silence default logging
        return

    def _send_html(self, body: str):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(body.encode("utf-8"))


_SUCCESS_HTML = """<!doctype html>
<html><head><title>Kite login successful</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0a0e14;color:#e5e7eb;
       display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
  .card{background:#11161f;border:1px solid #1f2937;border-radius:14px;
        padding:32px 40px;text-align:center;max-width:420px}
  h1{color:#00d68f;margin:0 0 8px;font-weight:700}
  p{color:#6b7280;margin:0;font-family:ui-monospace,monospace;font-size:13px}
</style></head>
<body><div class="card">
  <h1>✓ Connected to Kite</h1>
  <p>Token captured. You can close this tab and return to the dashboard.</p>
</div></body></html>"""

_FAILURE_HTML = """<!doctype html>
<html><head><title>Kite login failed</title>
<style>
  body{{font-family:system-ui,sans-serif;background:#0a0e14;color:#e5e7eb;
        display:flex;align-items:center;justify-content:center;height:100vh;margin:0}}
  .card{{background:#11161f;border:1px solid #1f2937;border-radius:14px;
         padding:32px 40px;text-align:center;max-width:420px}}
  h1{{color:#ff4d6d;margin:0 0 8px;font-weight:700}}
  p{{color:#6b7280;margin:0;font-family:ui-monospace,monospace;font-size:13px}}
</style></head>
<body><div class="card">
  <h1>✗ Login failed</h1>
  <p>{error}</p>
</div></body></html>"""


def _port_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind((host, port))
            return True
        except OSError:
            return False


def _wait_for_request_token(host: str, port: int, timeout_sec: int = 180) -> str:
    """Spin up server in a thread, wait for the redirect, return the token."""
    if not _port_free(host, port):
        raise RuntimeError(
            f"Port {port} is already in use. Close whatever is using it "
            f"(another instance? a dev server?) and retry."
        )

    _RequestTokenHandler.captured_token = None
    _RequestTokenHandler.captured_error = None

    server = HTTPServer((host, port), _RequestTokenHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    try:
        deadline = time.time() + timeout_sec
        while time.time() < deadline:
            if _RequestTokenHandler.captured_token:
                return _RequestTokenHandler.captured_token
            if _RequestTokenHandler.captured_error:
                raise RuntimeError(
                    f"Kite returned an error: {_RequestTokenHandler.captured_error}"
                )
            time.sleep(0.25)
        raise TimeoutError(
            f"Did not receive request_token within {timeout_sec}s. "
            f"Did you finish login in the browser?"
        )
    finally:
        server.shutdown()
        server.server_close()


# ================================================================
# Main session class
# ================================================================

class KiteSession:
    """
    Manages the full Kite Connect lifecycle: cached token -> reuse,
    expired/missing token -> interactive browser login -> persist.

    Parameters
    ----------
    api_key : str
        Your Kite Connect API key (from kite.trade developer console).
    api_secret : str
        Your API secret (only needed to exchange request_token -> access_token).
    session_file : Path, optional
        Where to persist the token. Defaults to ~/.kite_session.json.
    redirect_host, redirect_port : str, int
        Where the local server listens. Must match the redirect URL
        you registered with Kite (default: http://127.0.0.1:5000/).
    """

    def __init__(
        self,
        api_key: str,
        api_secret: str,
        session_file: Path = DEFAULT_SESSION_FILE,
        redirect_host: str = DEFAULT_REDIRECT_HOST,
        redirect_port: int = DEFAULT_REDIRECT_PORT,
    ):
        if KiteConnect is None:
            raise ImportError(
                "kiteconnect package not installed. Run: pip install kiteconnect"
            )
        self.api_key = api_key
        self.api_secret = api_secret
        self.session_file = Path(session_file)
        self.redirect_host = redirect_host
        self.redirect_port = redirect_port
        self._kite: Optional["KiteConnect"] = None

    # --- Public API ---------------------------------------------------

    def connect(self, force_relogin: bool = False) -> "KiteConnect":
        """
        Return an authenticated KiteConnect instance.

        Uses cached token if fresh, otherwise launches interactive login.
        """
        if not force_relogin:
            cached = load_token(self.session_file)
            if cached and cached.get("api_key") == self.api_key:
                k = KiteConnect(api_key=self.api_key)
                k.set_access_token(cached["access_token"])
                if self._verify(k):
                    self._kite = k
                    return k
                # cached token rejected by server — fall through to relogin

        token = self._interactive_login()
        k = KiteConnect(api_key=self.api_key)
        k.set_access_token(token)
        try:
            profile = k.profile()
            save_token(self.api_key, token, profile.get("user_id", ""),
                       self.session_file)
        except Exception:
            save_token(self.api_key, token, "", self.session_file)
        self._kite = k
        return k

    def status(self) -> dict:
        """Return token freshness info without triggering a login."""
        cached = load_token(self.session_file)
        if not cached:
            return {"connected": False, "reason": "no_cached_token"}
        generated_at = datetime.fromisoformat(cached["generated_at"])
        cutoff = generated_at.astimezone(IST).replace(
            hour=TOKEN_INVALIDATION_HOUR_IST, minute=0, second=0, microsecond=0
        )
        if generated_at.astimezone(IST) >= cutoff:
            cutoff = cutoff + timedelta(days=1)
        return {
            "connected": True,
            "user_id": cached.get("user_id", ""),
            "generated_at": cached["generated_at"],
            "expires_at": cutoff.isoformat(),
            "expires_in_hours": round(
                (cutoff - datetime.now(IST)).total_seconds() / 3600, 1
            ),
        }

    def clear(self) -> None:
        """Delete the cached token file."""
        if self.session_file.exists():
            self.session_file.unlink()
        self._kite = None

    # --- Internals ----------------------------------------------------

    def _login_url(self) -> str:
        return f"https://kite.trade/connect/login?api_key={self.api_key}&v=3"

    def _interactive_login(self) -> str:
        """Open browser, capture redirect, exchange for access token."""
        url = self._login_url()
        print(f"[kite-auto-login] Opening browser: {url}")
        try:
            webbrowser.open(url)
        except Exception:
            print(f"[kite-auto-login] Could not open browser. Visit manually: {url}")

        request_token = _wait_for_request_token(
            self.redirect_host, self.redirect_port
        )
        print(f"[kite-auto-login] Got request_token, exchanging for access_token...")

        kite = KiteConnect(api_key=self.api_key)
        data = kite.generate_session(request_token, api_secret=self.api_secret)
        access_token = data["access_token"]
        print(f"[kite-auto-login] Done. Token saved to {self.session_file}")
        return access_token

    def _verify(self, kite: "KiteConnect") -> bool:
        """Cheap call to confirm the token still works."""
        try:
            kite.profile()
            return True
        except Exception:
            return False


# ================================================================
# Streamlit convenience widget
# ================================================================

def kite_login_button(api_key: str, api_secret: str,
                      session_file: Path = DEFAULT_SESSION_FILE):
    """
    Streamlit helper. Renders status + login/logout buttons.
    Returns an authenticated KiteConnect instance or None.

    Usage in your app:
        kite = kite_login_button(api_key, api_secret)
        if kite:
            holdings = kite.holdings()
    """
    import streamlit as st  # local import — keeps this module usable headless

    ks = KiteSession(api_key, api_secret, session_file=session_file)
    status = ks.status()

    cols = st.columns([3, 1, 1])

    if status["connected"]:
        cols[0].success(
            f"✓ Kite connected as **{status['user_id']}**  ·  "
            f"token expires in **{status['expires_in_hours']}h** "
            f"(~{status['expires_at'][:16].replace('T', ' ')} IST)"
        )
        if cols[1].button("🔄 Refresh", use_container_width=True,
                          help="Force re-login (e.g., switching accounts)"):
            ks.clear()
            st.rerun()
        if cols[2].button("Logout", use_container_width=True):
            ks.clear()
            st.rerun()
        try:
            return ks.connect()
        except Exception as e:
            st.error(f"Reconnect failed: {e}")
            return None

    cols[0].warning("Kite not connected. Click Login — a browser tab will open.")
    if cols[1].button("🔐 Login", type="primary", use_container_width=True):
        with st.spinner("Waiting for browser login... (up to 3 min)"):
            try:
                ks.connect()
                st.success("Logged in. Reloading...")
                st.rerun()
            except Exception as e:
                st.error(f"Login failed: {e}")
    return None


# ================================================================
# CLI entry point — for running headless / cron / morning refresh
# ================================================================

def _cli():
    """
    Run as: python kite_auto_login.py
    Reads KITE_API_KEY and KITE_API_SECRET from env, refreshes token.
    Suitable for a 6:30 IST cron job.
    """
    api_key = os.environ.get("KITE_API_KEY")
    api_secret = os.environ.get("KITE_API_SECRET")
    if not api_key or not api_secret:
        print("Set KITE_API_KEY and KITE_API_SECRET environment variables.")
        sys.exit(1)

    ks = KiteSession(api_key, api_secret)
    kite = ks.connect(force_relogin="--force" in sys.argv)
    profile = kite.profile()
    print(f"✓ Connected as {profile['user_name']} ({profile['user_id']})")

    status = ks.status()
    print(f"  Token expires: {status['expires_at']} ({status['expires_in_hours']}h)")


if __name__ == "__main__":
    _cli()
