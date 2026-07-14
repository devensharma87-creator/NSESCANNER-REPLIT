"""
Phase-1 Continuation smoke tests (BUG-30/31/35 + SENSEX preset).

Covers /api/system/mode, /api/system/reconciliation (GET + run),
/api/system/mode-override (HALT set + clear + invalid), /api/metrics
auth gating and key gauge presence.

Uses the public REACT_APP_BACKEND_URL only. Uses the admin site
master password (see /app/memory/test_credentials.md).
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
ADMIN_PASSWORD = "HrishiAdmin@2026"


@pytest.fixture(scope="module")
def anon():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def owner():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    assert r.json().get("ok") is True
    # sanity — session cookie recognized
    st = s.get(f"{BASE_URL}/api/auth/status", timeout=10).json()
    assert st.get("authenticated") is True
    return s


# ---------- BUG-28/29 combined snapshot ----------
class TestSystemMode:
    def test_anonymous_forbidden(self, anon):
        r = anon.get(f"{BASE_URL}/api/system/mode", timeout=10)
        assert r.status_code == 401

    def test_snapshot_shape(self, owner):
        r = owner.get(f"{BASE_URL}/api/system/mode", timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert set(["mode", "clockDrift", "tokenStaleness", "instrumentsIntegrity"]).issubset(d.keys())

        m = d["mode"]
        for k in ("derived", "override", "effective", "drivers", "dbLatencyMs", "autoOpensAllowed"):
            assert k in m, f"mode missing {k}"
        assert m["effective"] in ("NORMAL", "DEGRADED", "READ_ONLY", "HALT")

        cd = d["clockDrift"]
        for k in ("status", "driftMs", "source", "note"):
            assert k in cd, f"clockDrift missing {k}"

        ts = d["tokenStaleness"]
        for k in ("active", "totalTracked", "staleCount", "stalePct"):
            assert k in ts, f"tokenStaleness missing {k}"

        ii = d["instrumentsIntegrity"]
        for k in ("lastCheckedDate", "lastResult", "failedToday"):
            assert k in ii, f"instrumentsIntegrity missing {k}"


# ---------- BUG-29 mode override ----------
class TestModeOverride:
    def test_invalid_mode_returns_400(self, owner):
        r = owner.post(f"{BASE_URL}/api/system/mode-override", json={"mode": "BOGUS"}, timeout=10)
        assert r.status_code == 400
        d = r.json()
        assert d.get("error") == "invalid_mode"
        assert "HALT" in d.get("allowed", [])

    def test_set_halt_then_clear(self, owner):
        # Set HALT
        r = owner.post(f"{BASE_URL}/api/system/mode-override", json={"mode": "HALT"}, timeout=10)
        assert r.status_code == 200
        m = r.json()["mode"]
        assert m["effective"] == "HALT"
        assert m["override"] == "HALT"
        assert m["autoOpensAllowed"] is False

        # GET verifies persistence of override
        g = owner.get(f"{BASE_URL}/api/system/mode", timeout=10).json()["mode"]
        assert g["effective"] == "HALT"

        # Clear back
        r2 = owner.post(f"{BASE_URL}/api/system/mode-override", json={"mode": None}, timeout=10)
        assert r2.status_code == 200
        m2 = r2.json()["mode"]
        assert m2["override"] is None
        assert m2["effective"] in ("NORMAL", "DEGRADED", "READ_ONLY")
        assert m2["autoOpensAllowed"] is True


# ---------- BUG-31 EOD reconciliation ----------
class TestReconciliation:
    def test_anonymous_forbidden(self, anon):
        assert anon.get(f"{BASE_URL}/api/system/reconciliation", timeout=10).status_code == 401
        assert anon.post(f"{BASE_URL}/api/system/reconciliation/run", timeout=10).status_code == 401

    def test_list_shape(self, owner):
        r = owner.get(f"{BASE_URL}/api/system/reconciliation", timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d.get("reports"), list)

    def test_run_and_persist(self, owner):
        r = owner.post(f"{BASE_URL}/api/system/reconciliation/run", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d.get("ok") is True
        rep = d["report"]
        assert rep["status"] in ("OK", "MISMATCH")
        checks = rep["checks"]
        assert len(checks) >= 3
        ids = {c["id"] for c in checks}
        # canonical check ids expected
        expected = {"FO_OPEN_AFTER_CLOSE", "FO_CLOSED_MISSING_PNL", "EQ_CLOSED_MISSING_PNL"}
        assert expected.issubset(ids), f"missing check ids: {expected - ids}"
        for c in checks:
            assert c["status"] in ("OK", "MISMATCH", "SKIPPED")
            assert isinstance(c["detail"], str)

        # persisted: GET now must include today's report
        g = owner.get(f"{BASE_URL}/api/system/reconciliation", timeout=10).json()
        assert any(r.get("ist_date") == rep["istDate"] for r in g["reports"])


# ---------- BUG-89 /metrics ----------
class TestMetrics:
    def test_anonymous_forbidden(self, anon):
        assert anon.get(f"{BASE_URL}/api/metrics", timeout=10).status_code == 401

    def test_prometheus_gauges(self, owner):
        r = owner.get(f"{BASE_URL}/api/metrics", timeout=10)
        assert r.status_code == 200
        assert "text/plain" in r.headers.get("Content-Type", "")
        body = r.text
        for gauge in [
            "marketscanner_system_mode_code",
            "marketscanner_tokens_tracked",
            "marketscanner_instruments_refresh_failed_today",
        ]:
            assert gauge in body, f"gauge missing from /metrics: {gauge}"
