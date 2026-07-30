"""Risk scoring — Layer 3.

Per-change score = 40% rule score + 30% semantic similarity score + 30% NLP
context score (keyword/criticality heuristics over the diff text itself).

Repo drift score = severity-weighted accumulation across history, squashed
to 0-100, with a chronological trend so the dashboard can plot trajectory.

Accumulated repo score = decay-weighted sum of all prior scan scores.
Each scan's contribution decays by DECAY_FACTOR per scan so old risky
commits fade but are not forgotten.  Half-life ≈ 5 scans at 0.85.

Trend alert = confidence-weighted check on whether the accumulated score
jumped more than a configurable threshold over a rolling time window.
"""
import math
from datetime import datetime, timezone
import re

SEVERITY_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]

# context terms that raise the stakes of an otherwise identical change
_CRITICAL_CONTEXT = re.compile(
    r"(?i)\b(prod|production|payment|billing|customer|master|admin|root|"
    r"database|db|secret|credential|public|external|internet)\b"
)
_SAFE_CONTEXT = re.compile(r"(?i)\b(test|staging|dev|local|sandbox|example|sample|mock)\b")


def nlp_context_score(file_path: str, added: list[str], removed: list[str]) -> float:
    """0-100. How risk-amplifying is the surrounding context of this change?"""
    text = file_path + " " + " ".join(added + removed)
    score = 50.0
    score += 12.0 * min(len(_CRITICAL_CONTEXT.findall(text)), 4)
    score -= 15.0 * min(len(_SAFE_CONTEXT.findall(text)), 2)
    score += min(len(added) + len(removed), 10)  # bigger diffs, more surface
    return max(0.0, min(100.0, score))


def final_score(rule_score: float | None, similarity: float | None,
                context: float) -> tuple[float, float]:
    """Return (risk_score 0-100, confidence 0-1) using the 40/30/30 weights.

    Missing components redistribute their weight to what's present, and
    confidence reflects how many independent signals agreed and their quality.

    Confidence formula (replaces the old 3-bucket lookup that always produced
    0.85 for rule-only hits):

        base  = 0.45 + 0.15 × signals_present          (0.60 / 0.75 / 0.90)
        bonus = 0.08 if a deterministic rule fired       (hard rule = high trust)
        boost = 0.06 × (similarity / 1.0) if semantic   (scaled by match quality)

        confidence = clamp(base + bonus + boost, 0.50, 0.98)

    Typical outputs:
        context-only              → ~0.60
        rule-only                 → ~0.68 + rule bonus   → ~0.76–0.80
        rule + semantic (sim=0.7) → ~0.90 + boost(0.04) → ~0.94 (capped 0.98)
        all three present         → ~0.90 + 0.08 + boost → capped at 0.98
    """
    parts, weights = [], []
    if rule_score is not None:
        parts.append(rule_score); weights.append(0.40)
    if similarity is not None:
        parts.append(similarity * 100.0); weights.append(0.30)
    parts.append(context); weights.append(0.30)

    total_w = sum(weights)
    score = sum(p * w for p, w in zip(parts, weights)) / total_w

    signals = (rule_score is not None) + (similarity is not None) + 1  # always ≥1 (context)
    base = 0.45 + 0.15 * signals                                        # 0.60 | 0.75 | 0.90
    bonus = 0.08 if rule_score is not None else 0.0                     # deterministic rule bonus
    boost = 0.06 * min(similarity, 1.0) if similarity is not None else 0.0  # semantic quality
    confidence = max(0.50, min(0.98, base + bonus + boost))

    return round(score, 1), round(confidence, 2)


def severity_from_score(score: float, rule_severity: str | None) -> str:
    by_score = ("CRITICAL" if score >= 85 else
                "HIGH" if score >= 65 else
                "MEDIUM" if score >= 45 else "LOW")
    if rule_severity is None:
        return by_score
    # never rank below the deterministic rule's own severity
    return max(by_score, rule_severity, key=SEVERITY_ORDER.index)


def drift_score(finding_scores: list[float]) -> float:
    """Repo-level accumulation, 0-100.

    Sum of per-finding scores squashed with a saturating curve: a repo with
    one CRITICAL is bad; a repo with twelve does not need to score 1200.
    """
    if not finding_scores:
        return 0.0
    raw = sum(s / 100.0 for s in finding_scores)          # in 'critical units'
    return round(100.0 * (1.0 - math.exp(-raw / 2.5)), 1)


#: Exponential decay factor applied per scan age.
#: 0.85 gives a half-life of ≈5 scans: older risky scans fade but persist.
DECAY_FACTOR = 0.85


def accumulated_drift_score(
    prior_scores: list[float],
    new_score: float,
    decay: float = DECAY_FACTOR,
) -> float:
    """Decay-weighted accumulated repo drift score, 0-100.

    Combines all historical per-scan drift scores (oldest first) with the
    latest score into a single number using exponential decay:

        accumulated = saturate( Σ score_i × decay^(n - 1 - i) )

    where n is the total number of scores (including new_score) and i is the
    0-based index.  The newest scan has weight decay^0 = 1.0; each older
    scan carries an additional decay factor.

    The saturating transform matches drift_score() so the result stays on a
    0-100 scale regardless of how many scans have run.

    Args:
        prior_scores: All previous per-scan drift scores (0-100), oldest first.
        new_score:    The drift score from the scan just completed (0-100).
        decay:        Decay factor per scan (default DECAY_FACTOR = 0.85).

    Returns:
        Accumulated drift score in [0, 100].
    """
    scores = prior_scores + [new_score]          # full history, oldest first
    n = len(scores)
    weighted_sum = sum(
        (s / 100.0) * (decay ** (n - 1 - i))
        for i, s in enumerate(scores)
    )
    # Same saturating curve as drift_score() for scale consistency.
    return round(100.0 * (1.0 - math.exp(-weighted_sum / 2.5)), 1)


#: Default window for trend alerts, in calendar days.
TREND_ALERT_WINDOW_DAYS: int = 30

#: Default threshold: alert if score rose by more than this many points (0-100).
TREND_ALERT_THRESHOLD: float = 15.0


def trend_alert(
    trend_points: list[dict],
    threshold: float = TREND_ALERT_THRESHOLD,
    window_days: int = TREND_ALERT_WINDOW_DAYS,
) -> dict | None:
    """Return a trend-level alert if the score jumped more than *threshold*
    within the last *window_days* calendar days, or ``None`` if the trend
    is within acceptable bounds.

    This is the "death by a thousand cuts" detector from Feature 6: it fires
    even when *no single scan* is individually Critical, as long as the
    *accumulated* score rose sharply over a sustained period.

    Args:
        trend_points: List of ``{"date": ISO-8601-str, "score": float}``
                      dicts, oldest first.  ``score`` is on the 0-100 scale
                      (the same scale stored in ``trend_points.score``).
        threshold:    Score-point rise that triggers an alert (default 15).
        window_days:  Rolling calendar window to inspect (default 30 days).

    Returns:
        A dict with the following keys when an alert fires::

            {
                "fired": True,
                "score_start": float,   # oldest score in window (0-100)
                "score_end": float,     # newest score in window (0-100)
                "delta": float,         # score_end - score_start
                "window_days": int,     # the window used
                "threshold": float,     # the threshold used
                "points_in_window": int,# how many trend points fell inside
                "confidence": float,    # 0-1; higher when more data is present
                "message": str,         # human-readable summary
            }

        ``None`` if the score did not rise above *threshold* in the window,
        or if there are fewer than 2 trend points (insufficient history).
    """
    if len(trend_points) < 2:
        return None

    now = datetime.now(tz=timezone.utc)

    def _parse(date_str: str) -> datetime:
        """Parse ISO-8601 date string; fall back to UTC epoch on failure."""
        try:
            dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            return datetime(1970, 1, 1, tzinfo=timezone.utc)

    # -----------------------------------------------------------------------
    # Collect points inside the rolling window.  We always anchor the window
    # at "now" so re-running the same dataset at different wall-clock times
    # gives consistent results as data ages out.
    # -----------------------------------------------------------------------
    cutoff = now.timestamp() - window_days * 86_400
    in_window = [
        pt for pt in trend_points
        if _parse(pt["date"]).timestamp() >= cutoff
    ]

    # Need at least two points to compute a delta.
    if len(in_window) < 2:
        return None

    # Sort chronologically so oldest is first.
    in_window.sort(key=lambda p: _parse(p["date"]).timestamp())

    score_start: float = in_window[0]["score"]
    score_end: float = in_window[-1]["score"]
    delta: float = round(score_end - score_start, 2)

    if delta <= threshold:
        return None

    # -----------------------------------------------------------------------
    # Confidence: more data points in the window = more reliable signal.
    # 2 pts → 0.60; 3 pts → 0.75; 5+ pts → 0.95 (capped).
    # -----------------------------------------------------------------------
    n = len(in_window)
    confidence = round(min(0.55 + 0.08 * (n - 1), 0.95), 2)

    message = (
        f"Accumulated drift score rose {delta:+.1f} points over the last "
        f"{window_days} days ({score_start:.1f} → {score_end:.1f}). "
        f"This may indicate sustained risk accumulation even if no single "
        f"commit was individually critical."
    )

    return {
        "fired": True,
        "score_start": round(score_start, 2),
        "score_end": round(score_end, 2),
        "delta": delta,
        "window_days": window_days,
        "threshold": threshold,
        "points_in_window": n,
        "confidence": confidence,
        "message": message,
    }


def risk_trend(dated_scores: list[tuple[str, float]]) -> list[dict]:
    """Chronological cumulative drift for the dashboard's trend chart."""
    dated = sorted(dated_scores, key=lambda t: t[0])
    trend, running = [], []
    for date, s in dated:
        running.append(s)
        trend.append({"date": date, "cumulative_drift": drift_score(running)})
    return trend
