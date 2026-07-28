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


def test_env_var_password_does_not_fire_sec_001():
    env_var_lines = [
        'POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}',
        'POSTGRES_PASSWORD: "${POSTGRES_PASSWORD}"',
        'DB_PASS: $POSTGRES_PASSWORD',
        'SECRET_KEY: {{ SECRET_KEY }}',
        'password = process.env.DB_PASS',
        'api_key = os.getenv("API_KEY")',
    ]
    for line in env_var_lines:
        hits = engine.evaluate([line], [])
        assert not any(h["rule"].id == "SEC-001" for h in hits), f"Line '{line}' false-triggered SEC-001"



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


# ---------------------------------------------------------------------------
# Feature 6: trend_alert() unit tests
# ---------------------------------------------------------------------------

import pytest  # noqa: E402
from datetime import datetime, timezone, timedelta  # noqa: E402


def _now_iso(offset_days: int = 0) -> str:
    """Return an ISO-8601 UTC timestamp offset_days from now."""
    dt = datetime.now(tz=timezone.utc) + timedelta(days=offset_days)
    return dt.isoformat()


def test_trend_alert_no_fire_below_threshold():
    """Delta below threshold returns None."""
    points = [
        {"date": _now_iso(-10), "score": 20.0},
        {"date": _now_iso(-1),  "score": 34.0},  # delta = 14 < 15
    ]
    assert scoring.trend_alert(points, threshold=15.0, window_days=30) is None


def test_trend_alert_fires_above_threshold():
    """Delta above threshold returns alert dict with all required fields."""
    points = [
        {"date": _now_iso(-10), "score": 20.0},
        {"date": _now_iso(-1),  "score": 40.0},  # delta = 20 > 15
    ]
    alert = scoring.trend_alert(points, threshold=15.0, window_days=30)
    assert alert is not None
    assert alert["fired"] is True
    assert alert["delta"] == pytest.approx(20.0, abs=0.01)
    assert alert["score_start"] == pytest.approx(20.0, abs=0.01)
    assert alert["score_end"] == pytest.approx(40.0, abs=0.01)
    assert alert["window_days"] == 30
    assert alert["threshold"] == 15.0
    assert alert["points_in_window"] == 2
    assert isinstance(alert["message"], str) and len(alert["message"]) > 20


def test_trend_alert_returns_none_for_single_point():
    """Only one point in window cannot compute delta — returns None."""
    points = [{"date": _now_iso(-1), "score": 80.0}]
    assert scoring.trend_alert(points, threshold=15.0, window_days=30) is None


def test_trend_alert_returns_none_for_empty():
    """Empty list returns None (no data)."""
    assert scoring.trend_alert([], threshold=15.0, window_days=30) is None


def test_trend_alert_ignores_points_outside_window():
    """Large jump outside window is not counted; in-window delta stays below threshold."""
    points = [
        {"date": _now_iso(-60), "score": 10.0},
        {"date": _now_iso(-40), "score": 35.0},  # delta=25 but both outside 30-day window
        {"date": _now_iso(-5),  "score": 36.0},
        {"date": _now_iso(-1),  "score": 37.0},  # in-window delta=1 < 15
    ]
    assert scoring.trend_alert(points, threshold=15.0, window_days=30) is None


def test_trend_alert_confidence_scales_with_data_points():
    """More points in window yields higher confidence, capped at 0.95."""
    # 7 points in window, score rises 4 pts/day → delta = 24 > 15
    points = [
        {"date": _now_iso(-i), "score": 10.0 + (7 - i) * 4}
        for i in range(7, 0, -1)
    ]
    alert = scoring.trend_alert(points, threshold=15.0, window_days=30)
    assert alert is not None
    assert alert["confidence"] == pytest.approx(0.95)  # 7 pts → capped


def test_trend_alert_confidence_minimum_two_points():
    """Two points → confidence = 0.63 (0.55 + 0.08 × 1)."""
    points = [
        {"date": _now_iso(-5), "score": 10.0},
        {"date": _now_iso(-1), "score": 30.0},  # delta = 20 > 15
    ]
    alert = scoring.trend_alert(points, threshold=15.0, window_days=30)
    assert alert is not None
    assert alert["confidence"] == pytest.approx(0.63, abs=0.001)


def test_trend_alert_exactly_at_threshold_does_not_fire():
    """Delta exactly equal to threshold does NOT fire (strict > required)."""
    points = [
        {"date": _now_iso(-5), "score": 10.0},
        {"date": _now_iso(-1), "score": 25.0},  # delta == 15.0 exactly
    ]
    assert scoring.trend_alert(points, threshold=15.0, window_days=30) is None


def test_trend_alert_custom_window_and_threshold():
    """Custom window and threshold parameters are respected."""
    points = [
        {"date": _now_iso(-8), "score": 50.0},
        {"date": _now_iso(-3), "score": 60.0},  # delta = 10 > threshold=8
    ]
    alert = scoring.trend_alert(points, threshold=8.0, window_days=10)
    assert alert is not None
    assert alert["threshold"] == 8.0
    assert alert["window_days"] == 10
