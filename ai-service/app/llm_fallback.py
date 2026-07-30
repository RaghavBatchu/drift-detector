"""LLM Fallback Layer — Layer 3.5.

Acts as an AI Security Auditor for configuration diffs that escape
both the Rule Engine (Layer 1) and the FAISS semantic search (Layer 2).

When EXPLAIN_LLM=1 and a Gemini API key is configured, each unflagged
diff is sent to the Gemini API with a structured security-audit prompt.
The LLM either:
  - Detects a hidden risk → dynamically synthesises a Finding dict
    (severity, risk_score, category, explanation, remediation).
  - Confirms it is clean → returns a LOW-risk informational marker.

If the LLM is disabled, the key is missing, or any call fails (network,
quota, parse), the function returns None and the diff is treated as
0-risk, preserving the existing behaviour.

Rate controls:
  - LLM_MAX_FALLBACK_CALLS env var (default 50) caps total calls per scan
    to avoid runaway spend on large repos.
  - A per-run dedup set prevents the same (file_path, commit_hash) pair
    from being sent more than once.

Env vars consumed:
  GEMINI_API_KEY   — Google Gemini API key (preferred)
  LLM_API_KEY      — Alias for the above (backward compat)
  EXPLAIN_LLM      — Set to "1" to enable (default: off)
  LLM_MAX_FALLBACK_CALLS — Integer cap, default 50
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

_ENABLED: bool = os.getenv("EXPLAIN_LLM", "0") == "1"
_API_KEY: str = (
    os.getenv("GEMINI_API_KEY")
    or os.getenv("LLM_API_KEY")
    or ""
)
_MAX_CALLS: int = int(os.getenv("LLM_MAX_FALLBACK_CALLS", "50"))
_MODEL: str = os.getenv("LLM_MODEL", "gemini-1.5-flash")
_TIMEOUT: int = 20  # seconds

# Runtime counters (reset on each scan via LLMFallbackAuditor instance)
_CALLS_THIS_RUN: int = 0

# ---------------------------------------------------------------------------
# Gemini client — lazy import so the service starts even without the SDK
# ---------------------------------------------------------------------------
_genai = None
_genai_error: Optional[str] = None

if _ENABLED and _API_KEY:
    try:
        import google.generativeai as _genai_module  # type: ignore[import]
        _genai_module.configure(api_key=_API_KEY)
        _genai = _genai_module
        logger.info("[llm_fallback] Gemini client initialised (model=%s)", _MODEL)
    except ImportError:
        _genai_error = (
            "google-generativeai is not installed. "
            "Run: pip install google-generativeai>=0.7"
        )
        logger.warning("[llm_fallback] %s", _genai_error)
    except Exception as exc:
        _genai_error = f"Gemini init failed: {exc}"
        logger.warning("[llm_fallback] %s", _genai_error)
elif _ENABLED and not _API_KEY:
    _genai_error = "EXPLAIN_LLM=1 but no GEMINI_API_KEY / LLM_API_KEY set."
    logger.warning("[llm_fallback] %s", _genai_error)

# ---------------------------------------------------------------------------
# Prompt template
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """\
You are a senior DevOps security auditor specialising in infrastructure configuration security.
Your role is to review configuration diffs that were NOT flagged by any static analysis rule
or vector similarity check. You must determine whether this change contains:
- Subtle security misconfigurations
- Privilege escalation risks
- Architectural drift (e.g. moving from secure to insecure defaults)
- Hidden credential or token exposure
- Dangerous permission changes
- Network exposure widening
- Any other security concern not covered by standard static analysis

Be conservative: only flag genuine security concerns, not style issues.
"""

_USER_PROMPT_TEMPLATE = """\
Analyze this configuration change for security issues:

FILE: {file_path}
ADDED LINES:
{added}

REMOVED LINES:
{removed}

Respond ONLY with a JSON object (no markdown, no code fences) in this exact format:
{{
  "is_risk": true | false,
  "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
  "risk_score": <integer 0-100>,
  "category": "<one of: network_exposure | secrets_auth | insecure_protocols | access_control | resource_limits | configuration_drift | other>",
  "explanation": "<concise plain-English explanation of the risk, 1-3 sentences>",
  "remediation": "<specific actionable fix, 1-2 sentences>"
}}

If there is NO security risk, respond with:
{{
  "is_risk": false,
  "severity": "LOW",
  "risk_score": 0,
  "category": "other",
  "explanation": "No security risk detected in this configuration change.",
  "remediation": "No action required."
}}
"""

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def status() -> dict:
    """Return a status dict for inclusion in engine_info."""
    if not _ENABLED:
        return {"enabled": False, "reason": "EXPLAIN_LLM not set"}
    if _genai is None:
        return {"enabled": False, "reason": _genai_error or "unknown init error"}
    return {"enabled": True, "model": _MODEL, "max_calls": _MAX_CALLS}


class LLMFallbackAuditor:
    """Stateful auditor — tracks per-scan call count and dedup set.

    Instantiate once per ``run_analysis()`` call so caps reset between scans.
    """

    def __init__(self) -> None:
        self._call_count: int = 0
        self._seen: set[tuple[str, str]] = set()

    def audit_diff(
        self,
        file_path: str,
        commit_hash: str,
        commit_date: str,
        author: str,
        added_lines: list[str],
        removed_lines: list[str],
    ) -> Optional[dict]:
        """Audit a single unflagged diff via the Gemini API.

        Returns a Finding-compatible dict if a risk is detected, a LOW-risk
        dict if the LLM confirms it is clean (and LLM_EMIT_LOW_FINDINGS=1),
        or None if the LLM is disabled / quota is exceeded / an error occurs.
        """
        if _genai is None:
            return None

        if self._call_count >= _MAX_CALLS:
            logger.debug(
                "[llm_fallback] call cap (%d) reached, skipping %s",
                _MAX_CALLS, file_path,
            )
            return None

        dedup_key = (file_path, commit_hash)
        if dedup_key in self._seen:
            return None
        self._seen.add(dedup_key)

        # Trim large diffs to keep prompt tokens bounded
        added_text = "\n".join(added_lines[:60]) or "(none)"
        removed_text = "\n".join(removed_lines[:60]) or "(none)"

        prompt = _USER_PROMPT_TEMPLATE.format(
            file_path=file_path,
            added=added_text,
            removed=removed_text,
        )

        try:
            t0 = time.monotonic()
            model = _genai.GenerativeModel(
                model_name=_MODEL,
                system_instruction=_SYSTEM_PROMPT,
            )
            response = model.generate_content(
                prompt,
                generation_config=_genai.types.GenerationConfig(  # type: ignore[attr-defined]
                    temperature=0.1,   # near-deterministic for security analysis
                    max_output_tokens=512,
                ),
                request_options={"timeout": _TIMEOUT},
            )
            self._call_count += 1
            elapsed = time.monotonic() - t0
            logger.debug(
                "[llm_fallback] %s audited in %.2fs (call %d/%d)",
                file_path, elapsed, self._call_count, _MAX_CALLS,
            )
        except Exception as exc:
            logger.warning("[llm_fallback] Gemini call failed for %s: %s", file_path, exc)
            return None

        # Parse JSON — strip markdown fences if the model includes them
        raw_text = (response.text or "").strip()
        raw_text = re.sub(r"^```(?:json)?\s*", "", raw_text)
        raw_text = re.sub(r"\s*```$", "", raw_text)

        try:
            data = json.loads(raw_text)
        except json.JSONDecodeError:
            logger.warning(
                "[llm_fallback] JSON parse failed for %s. Response: %s",
                file_path, raw_text[:200],
            )
            return None

        # Validate required fields
        required = {"is_risk", "severity", "risk_score", "category", "explanation", "remediation"}
        if not required.issubset(data.keys()):
            logger.warning(
                "[llm_fallback] Incomplete JSON response for %s: %s",
                file_path, list(data.keys()),
            )
            return None

        is_risk: bool = bool(data.get("is_risk", False))
        severity: str = str(data.get("severity", "LOW")).upper()
        risk_score: float = max(0.0, min(100.0, float(data.get("risk_score", 0))))
        category: str = str(data.get("category", "other"))
        explanation: str = str(data.get("explanation", ""))
        remediation: str = str(data.get("remediation", "No action required."))

        if not is_risk:
            # LLM confirmed clean — emit only if LLM_EMIT_LOW_FINDINGS=1
            if os.getenv("LLM_EMIT_LOW_FINDINGS", "0") != "1":
                return None
            # Return a low-confidence informational finding
            return _build_finding(
                file_path=file_path,
                commit_hash=commit_hash,
                commit_date=commit_date,
                author=author,
                added_lines=added_lines,
                removed_lines=removed_lines,
                severity="LOW",
                risk_score=5.0,
                category=category,
                explanation=f"LLM audit: no security risk detected. {explanation}",
                remediation=remediation,
                confidence=0.60,
            )

        # Clamp confidence based on severity to stay realistic
        _severity_confidence = {
            "CRITICAL": 0.82,
            "HIGH": 0.78,
            "MEDIUM": 0.72,
            "LOW": 0.65,
        }
        confidence = _severity_confidence.get(severity, 0.70)

        return _build_finding(
            file_path=file_path,
            commit_hash=commit_hash,
            commit_date=commit_date,
            author=author,
            added_lines=added_lines,
            removed_lines=removed_lines,
            severity=severity,
            risk_score=risk_score,
            category=category,
            explanation=explanation,
            remediation=remediation,
            confidence=confidence,
        )


def _build_finding(
    *,
    file_path: str,
    commit_hash: str,
    commit_date: str,
    author: str,
    added_lines: list[str],
    removed_lines: list[str],
    severity: str,
    risk_score: float,
    category: str,
    explanation: str,
    remediation: str,
    confidence: float,
) -> dict:
    """Build a Finding-compatible dict from LLM output."""
    evidence = (added_lines or removed_lines)[:5]
    evidence_side = "added" if added_lines else "removed"
    change_summary = (
        f"[AI Audit] {explanation[:80]}…" if len(explanation) > 80 else f"[AI Audit] {explanation}"
    )
    return {
        "file_path": file_path,
        "commit_hash": commit_hash,
        "commit_date": commit_date,
        "author": author,
        "severity": severity,
        "risk_score": round(risk_score, 1),
        "confidence": round(confidence, 2),
        "rule_id": None,
        "rule_name": None,
        "category": category,
        "evidence": evidence,
        "matched_by": "llm",
        "nearest_pattern": None,
        "similarity": None,
        "explanation": explanation,
        "remediation": remediation,
        "change_summary": change_summary,
        "evidence_side": evidence_side,
    }
