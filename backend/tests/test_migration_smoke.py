"""Migration smoke tests for MarketScanner (Hrishi Associates).

Verifies the environment wiring — Emergent ingress -> uvicorn shim (:8001)
-> Node Express api-server (:8055). No application code is under test
here; these are pure infrastructure checks per the review request.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://zero-compromise-v1.preview.emergentagent.com").rstrip("/")
ADMIN_PASSWORD = "HrishiAdmin@2026"


# ── Anonymous / public endpoints ────────────────────────────────────────
class TestAnonymousEndpoints:
    def test_auth_status_anonymous_returns_json(self):
        # Fresh session — no cookies.
        r = requests.get(f"{BASE_URL}/api/auth/status", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert set(["authenticated", "passwordConfigured", "publicMode"]).issubset(data.keys())
        # This is the contract stated in the review request.
        assert data["authenticated"] is False, (
            "Anonymous /api/auth/status must report authenticated:false. "
            f"Got {data} — likely proxy cookie-jar leak in /app/backend/server.py."
        )
        assert data["passwordConfigured"] is True

    def test_kite_status_returns_json_offline(self):
        # /api/kite/status is behind the global auth gate; log in first.
        s = requests.Session()
        s.post(f"{BASE_URL}/api/auth/login",
               json={"password": ADMIN_PASSWORD}, timeout=15)
        r = s.get(f"{BASE_URL}/api/kite/status", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        # No Kite credentials yet — expect offline / not-logged-in payload.
        assert data.get("loggedIn") is False
        assert data.get("credentialsConfigured") is False
        assert "readiness" in data
        assert data["readiness"].get("sessionValid") is False


# ── Admin login flow ────────────────────────────────────────────────────
class TestAdminLoginFlow:
    def test_login_wrong_password_401(self):
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/login",
                   json={"password": "wrong-password"}, timeout=15)
        assert r.status_code == 401
        assert r.json().get("error") == "invalid password"

    def test_login_missing_password_400(self):
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/login", json={}, timeout=15)
        assert r.status_code == 400

    def test_login_success_sets_cookie_and_status_flips(self):
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/login",
                   json={"password": ADMIN_PASSWORD}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json() == {"ok": True}
        # Expect a scanner_session cookie (signed).
        cookie_names = [c.name for c in s.cookies]
        assert any("scanner_session" in n for n in cookie_names), (
            f"scanner_session cookie not set; got cookies={cookie_names}"
        )
        # Reuse the same session to hit /auth/status; should now be authed.
        r2 = s.get(f"{BASE_URL}/api/auth/status", timeout=15)
        assert r2.status_code == 200
        assert r2.json()["authenticated"] is True

    def test_logout_clears_session(self):
        s = requests.Session()
        s.post(f"{BASE_URL}/api/auth/login",
               json={"password": ADMIN_PASSWORD}, timeout=15)
        assert s.get(f"{BASE_URL}/api/auth/status").json()["authenticated"] is True
        r = s.post(f"{BASE_URL}/api/auth/logout", timeout=15)
        assert r.status_code == 200
        # After logout, this session should no longer be authed.
        # NOTE: request goes through proxy — result may be corrupted by
        # shared-client cookie jar in the shim.
        auth_after = s.get(f"{BASE_URL}/api/auth/status").json()["authenticated"]
        assert auth_after is False, (
            f"Post-logout auth still true — proxy cookie leak? {auth_after}"
        )


# ── Session isolation between clients (regression for proxy cookie jar) ─
class TestSessionIsolation:
    def test_two_clients_do_not_share_session(self):
        """Client A logs in; Client B (fresh, no cookies) MUST still see
        authenticated:false. If B sees True, the uvicorn proxy shim is
        sharing httpx.AsyncClient cookies across all users — a critical
        security bug."""
        a = requests.Session()
        a.post(f"{BASE_URL}/api/auth/login",
               json={"password": ADMIN_PASSWORD}, timeout=15)
        assert a.get(f"{BASE_URL}/api/auth/status").json()["authenticated"] is True

        b = requests.Session()  # brand new, no cookies at all
        data = b.get(f"{BASE_URL}/api/auth/status", timeout=15).json()
        assert data["authenticated"] is False, (
            "SECURITY: anonymous client B sees authenticated:true after "
            "client A logged in. Proxy shim /app/backend/server.py uses a "
            "shared httpx.AsyncClient whose cookie jar leaks session "
            "cookies across all requests."
        )


# ── Frontend reachability ───────────────────────────────────────────────
class TestFrontendReachability:
    def test_frontend_root_serves_html(self):
        r = requests.get(BASE_URL + "/", timeout=15)
        assert r.status_code == 200
        assert "<html" in r.text.lower() or "<!doctype" in r.text.lower()


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v", "--tb=short"]))
