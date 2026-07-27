"""Risk scoring — Layer 3.

Per-change score = 40% rule score + 30% semantic similarity score + 30% NLP
context score (keyword/criticality heuristics over the diff text itself).

Repo drift score = severity-weighted accumulation across history, squashed
to 0-100, with a chronological trend so the dashboard can plot trajectory.

Accumulated repo score = decay-weighted sum of all prior scan scores.
Each scan's contribution decays by DECAY_FACTOR per scan so old risky
commits fade but are not forgotten.  Half-life ≈ 5 scans at 0.85.
"""
import math
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
    confidence reflects how many independent signals agreed.
    """
    parts, weights = [], []
    if rule_score is not None:
        parts.append(rule_score); weights.append(0.40)
    if similarity is not None:
        parts.append(similarity * 100.0); weights.append(0.30)
    parts.append(context); weights.append(0.30)

    total_w = sum(weights)
    score = sum(p * w for p, w in zip(parts, weights)) / total_w

    signals = (rule_score is not None) + (similarity is not None) + 1
    confidence = {1: 0.55, 2: 0.8, 3: 0.95}[signals]
    if rule_score is not None:
        confidence = min(1.0, confidence + 0.05)  # deterministic hit = high trust
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


def risk_trend(dated_scores: list[tuple[str, float]]) -> list[dict]:
    """Chronological cumulative drift for the dashboard's trend chart."""
    dated = sorted(dated_scores, key=lambda t: t[0])
    trend, running = [], []
    for date, s in dated:
        running.append(s)
        trend.append({"date": date, "cumulative_drift": drift_score(running)})
    return trend
