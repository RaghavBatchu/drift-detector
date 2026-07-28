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


# ---------------------------------------------------------------------------
# False-positive / false-negative regression tests (fix/rule-engine)
# ---------------------------------------------------------------------------

def test_dockerfile_arg_declaration_does_not_fire_sec_001():
    """Bare ARG declarations name a build-time variable — they hold no value."""
    arg_lines = [
        "ARG POSTGRES_PASSWORD",
        "ARG SECRET_KEY",
        "ARG API_KEY",
        "ARG ACCESS_KEY",
        "  ARG PASSWD",          # indented
    ]
    for line in arg_lines:
        hits = engine.evaluate([line], [])
        assert not any(h["rule"].id == "SEC-001" for h in hits), (
            f"Dockerfile ARG line '{line}' false-triggered SEC-001"
        )


def test_dockerfile_env_bare_var_reference_does_not_fire_sec_001():
    """ENV KEY=$VARNAME — bare $VAR (no braces) is a Dockerfile variable reference."""
    env_lines = [
        "ENV PASSWORD=$BUILD_PASSWORD",
        "ENV API_KEY=$MY_API_KEY",
        "ENV SECRET_KEY=$SECRET_KEY",
        "ENV ACCESS_KEY=$ACCESS_KEY_VAR",
    ]
    for line in env_lines:
        hits = engine.evaluate([line], [])
        assert not any(h["rule"].id == "SEC-001" for h in hits), (
            f"Dockerfile ENV bare-var line '{line}' false-triggered SEC-001"
        )


def test_comment_lines_do_not_fire_sec_001():
    """Comment lines are never executable config — keywords inside them must not fire."""
    comment_lines = [
        "# password = changeme",
        "# api_key = AKIAIOSFODNN7EXAMPLE",
        "# secret_key = abc123supersecret",
        "  # passwd = hunter2",
    ]
    for line in comment_lines:
        hits = engine.evaluate([line], [])
        assert not any(h["rule"].id == "SEC-001" for h in hits), (
            f"Comment line '{line}' false-triggered SEC-001"
        )


def test_comment_lines_do_not_fire_acc_001():
    """'# USER root' in a Dockerfile comment must not trigger ACC-001."""
    comment_lines = [
        "# USER root",
        "  # user root",
        "# Previously: USER root was used here",
    ]
    for line in comment_lines:
        hits = engine.evaluate([line], [])
        assert not any(h["rule"].id == "ACC-001" for h in hits), (
            f"Comment line '{line}' false-triggered ACC-001"
        )


def test_non_root_user_instruction_does_not_fire_acc_001():
    """USER <non-root> in Dockerfile must not trigger ACC-001."""
    safe_user_lines = [
        "USER appuser",
        "USER node",
        "USER 1000",
        "  USER myservice",
    ]
    for line in safe_user_lines:
        hits = engine.evaluate([line], [])
        assert not any(h["rule"].id == "ACC-001" for h in hits), (
            f"Non-root USER line '{line}' false-triggered ACC-001"
        )


def test_user_root_still_fires_acc_001():
    """Sanity: 'USER root' must still be caught by ACC-001."""
    hits = engine.evaluate(["USER root"], [])
    assert any(h["rule"].id == "ACC-001" for h in hits), (
        "USER root should fire ACC-001 but did not"
    )


def test_pnpm_lock_file_is_skipped_entirely():
    """pnpm-lock.yaml is auto-generated — even password-like content must not fire."""
    from app.rule_engine import RuleEngine
    _engine = RuleEngine()
    risky_lines = [
        'password = "hunter2secret"',
        'cidr_blocks = ["0.0.0.0/0"]',
        "privileged: true",
    ]
    hits = _engine.evaluate(risky_lines, [], file_path="pnpm-lock.yaml")
    assert hits == [], (
        f"pnpm-lock.yaml should be skipped entirely, but got hits: {hits}"
    )


def test_yarn_lock_file_is_skipped_entirely():
    """yarn.lock is auto-generated — no rule should fire for any content."""
    from app.rule_engine import RuleEngine
    _engine = RuleEngine()
    risky_lines = [
        'password = "supersecret123"',
        '0.0.0.0/0',
    ]
    hits = _engine.evaluate(risky_lines, [], file_path="yarn.lock")
    assert hits == [], (
        f"yarn.lock should be skipped entirely, but got hits: {hits}"
    )


def test_package_lock_json_is_skipped_entirely():
    """package-lock.json is auto-generated — no rule should fire."""
    from app.rule_engine import RuleEngine
    _engine = RuleEngine()
    risky_lines = ['  "password": "abc123secretvalue"']
    hits = _engine.evaluate(risky_lines, [], file_path="frontend/package-lock.json")
    assert hits == [], (
        f"package-lock.json should be skipped entirely, but got hits: {hits}"
    )


def test_lock_file_skip_does_not_affect_normal_yaml():
    """app.yaml / docker-compose.yml — must NOT be skipped (not a lock file)."""
    from app.rule_engine import RuleEngine
    _engine = RuleEngine()
    hits = _engine.evaluate(['password = "hunter2secret"'], [], file_path="config/app.yaml")
    assert any(h["rule"].id == "SEC-001" for h in hits), (
        "Normal YAML with hardcoded password should still fire SEC-001"
    )





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


# ---------------------------------------------------------------------------
# Approach 2: LLM Fallback Inspector unit tests
# ---------------------------------------------------------------------------
from app.explain import llm_fallback_inspect  # noqa: E402


def test_llm_fallback_disabled_by_default(monkeypatch):
    """When EXPLAIN_LLM is disabled, return None for unflagged changes."""
    monkeypatch.delenv("EXPLAIN_LLM", raising=False)
    res = llm_fallback_inspect("test.yaml", ["custom_param: 123"], [])
    assert res is None


def test_llm_fallback_catches_unflagged_risk_when_enabled(monkeypatch):
    """When EXPLAIN_LLM=1, mock HTTP response and verify finding structure."""
    monkeypatch.setenv("EXPLAIN_LLM", "1")
    monkeypatch.setenv("LLM_API_KEY", "test-mock-key")

    mock_body = json.dumps({
        "choices": [
            {
                "message": {
                    "content": json.dumps({
                        "is_risky": True,
                        "severity": "HIGH",
                        "risk_score": 75.0,
                        "category": "misconfiguration",
                        "summary": "Unsafe custom config flag detected",
                        "explanation": "Setting custom_insecure_mode: true bypasses TLS validation.",
                        "remediation": "Change custom_insecure_mode to false."
                    })
                }
            }
        ]
    }).encode("utf-8")

    class MockHTTPResponse:
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def read(self):
            return mock_body

    import urllib.request
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout=None: MockHTTPResponse())

    res = llm_fallback_inspect("config/custom.yaml", ["custom_insecure_mode: true"], [])
    assert res is not None
    assert res["matched_by"] == "llm_fallback"
    assert res["rule_id"] == "LLM-INSPECT"
    assert res["severity"] == "HIGH"
    assert res["risk_score"] == 75.0
    assert "TLS validation" in res["explanation"]


