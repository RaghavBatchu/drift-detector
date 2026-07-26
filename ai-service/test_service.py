"""Run: python3 -m pytest test_service.py -q

Notes on auth
-------------
INTERNAL_API_KEY must be set before the FastAPI app is imported so that
security.verify_internal_api_key can read it.  We set it here at module
level.  The ``_authed`` client carries the header on every request;
tests that call run_analysis() directly bypass the dependency system and
need no header.
"""
import json
import os

# Must be set before importing the app so security.py can read it.
_TEST_API_KEY = "test-internal-api-key"
os.environ.setdefault("INTERNAL_API_KEY", _TEST_API_KEY)

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app                  # noqa: E402
from app.rule_engine import RuleEngine    # noqa: E402
from app import scoring                   # noqa: E402

# Unauthenticated client — used only to test the rejection path.
_anon = TestClient(app, raise_server_exceptions=False)

# Authenticated client — used for all normal HTTP-level tests.
client = TestClient(app, headers={"X-Internal-Api-Key": _TEST_API_KEY})
engine = RuleEngine()


def test_health():
    # /health is intentionally open — no auth header needed.
    r = _anon.get("/health").json()
    assert r["status"] == "ok" and r["rules_loaded"] >= 15


def test_analyze_rejects_missing_key():
    """POST /analyze without the header must return 401."""
    payload = json.load(open("demo_payload.json"))
    r = _anon.post("/analyze", json=payload)
    assert r.status_code == 401


def test_scan_rejects_missing_key():
    """POST /scan without the header must return 401."""
    r = _anon.post("/scan", json={"repo_url": "https://example.com/repo", "scan_id": "x"})
    assert r.status_code == 401


def test_hardcoded_secret_fires():
    hits = engine.evaluate(['password = "hunter2secret"'], [])
    assert any(h["rule"].id == "SEC-001" for h in hits)


def test_open_cidr_fires():
    hits = engine.evaluate(['cidr_blocks = ["0.0.0.0/0"]'], [])
    assert any(h["rule"].id == "NET-001" for h in hits)


def test_deny_removal_fires_on_removed_only():
    assert engine.evaluate([], ['default_action = "deny"'])
    assert not any(h["rule"].id == "NET-003"
                   for h in engine.evaluate(['default_action = "deny"'], []))


def test_benign_change_is_silent():
    hits = engine.evaluate(["  image: nginx:1.27.1", "  app: web"], [])
    assert hits == []


def test_score_weights_and_bounds():
    s, conf = scoring.final_score(90, 0.8, 70)
    assert 0 <= s <= 100 and s == round(0.4 * 90 + 0.3 * 80 + 0.3 * 70, 1)
    assert conf == 1.0


def test_drift_score_saturates():
    assert scoring.drift_score([90] * 20) <= 100
    assert scoring.drift_score([]) == 0.0


def test_analyze_contract():
    payload = json.load(open("demo_payload.json"))
    d = client.post("/analyze", json=payload).json()
    assert {"drift_score", "risk_trend", "summary", "findings"} <= d.keys()
    f = d["findings"][0]
    assert {"severity", "risk_score", "evidence", "explanation",
            "remediation", "matched_by"} <= f.keys()
    # findings sorted by risk, trend chronological & monotone
    scores = [x["risk_score"] for x in d["findings"]]
    assert scores == sorted(scores, reverse=True)
    trend = [t["cumulative_drift"] for t in d["risk_trend"]]
    assert trend == sorted(trend)

