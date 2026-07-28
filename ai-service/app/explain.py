import json
import logging
import os

logger = logging.getLogger(__name__)


def explain(finding: dict) -> tuple[str, str]:
    """Return (explanation, remediation) from an assembled finding dict."""
    ev = finding["evidence"][0].strip() if finding["evidence"] else "the change"
    where = finding["file_path"]

    if finding["matched_by"] in ("rule", "rule+semantic"):
        expl = (f"{finding['rule_name']}: `{ev}` in {where} matched rule "
                f"{finding['rule_id']} ({finding['category'].replace('_', ' ')}). "
                f"{finding['description']}")
        rem = finding["rule_remediation"]
    else:
        expl = (f"No hardcoded rule matched, but `{ev}` in {where} is "
                f"semantically close (similarity {finding['similarity']:.2f}) to a "
                f"known-risky pattern: \"{finding['nearest_pattern']}\".")
        rem = ("Review this change against your security baseline; if the "
               "similarity is confirmed, apply the same remediation as the "
               "matched known-risky pattern.")

    if finding["matched_by"] == "rule+semantic":
        expl += (f" The semantic layer independently agreed "
                 f"(similarity {finding['similarity']:.2f}).")
    return expl, rem


def llm_fallback_inspect(
    file_path: str,
    added_lines: list[str],
    removed_lines: list[str],
    author: str = "",
    commit_hash: str = "",
    commit_date: str = "",
) -> dict | None:
    """LLM Fallback Inspector — Layer 4 (Approach 2).

    When a configuration change does NOT trigger any rule in the Rule Engine
    and does NOT match any seed pattern in the Semantic FAISS layer, this inspector
    sends the unflagged diff to an LLM provider (OpenAI, Gemini, Groq, Ollama, etc.)
    to check for unknown/novel security misconfigurations or policy drift.

    Returns a Finding-compatible dict if risk is detected, or None if safe/disabled.
    """
    explain_enabled = os.getenv("EXPLAIN_LLM", "0").lower() in ("1", "true", "yes")
    if not explain_enabled:
        return None

    api_key = (
        os.getenv("LLM_API_KEY")
        or os.getenv("OPENAI_API_KEY")
        or os.getenv("GEMINI_API_KEY")
        or os.getenv("GROQ_API_KEY")
    )
    base_url = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    model = os.getenv("LLM_MODEL", "gpt-4o-mini")
    timeout = float(os.getenv("LLM_TIMEOUT", "5.0"))

    # If calling a non-local API (like OpenAI/Gemini/Groq) and no API key is set, skip gracefully
    if not api_key and "localhost" not in base_url and "127.0.0.1" not in base_url:
        logger.warning(
            "EXPLAIN_LLM=1 is set, but no LLM_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY was provided."
        )
        return None

    added_text = "\n".join(added_lines) if added_lines else "(none)"
    removed_text = "\n".join(removed_lines) if removed_lines else "(none)"

    prompt_user = (
        f"File Path: {file_path}\n"
        f"Added Lines:\n{added_text}\n\n"
        f"Removed Lines:\n{removed_text}\n"
    )

    system_prompt = (
        "You are an expert AI DevOps security auditor.\n"
        "Your task is to analyze configuration/code diffs that were NOT caught by static rule engines.\n"
        "Determine if the change introduces security risks, credential leaks, unintended exposure, dangerous permissions, or architectural drift.\n\n"
        "Return ONLY a JSON object with this exact structure (no markdown fences, raw JSON only):\n"
        "{\n"
        '  "is_risky": true or false,\n'
        '  "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",\n'
        '  "risk_score": 0.0 to 100.0,\n'
        '  "category": "secrets_auth" | "network_exposure" | "access_control" | "dependency" | "misconfiguration",\n'
        '  "summary": "short summary of the risk",\n'
        '  "explanation": "detailed explanation of why this change is risky",\n'
        '  "remediation": "concrete actionable remediation step or code fix"\n'
        "}\n\n"
        "If the change is benign or safe, set is_risky to false and risk_score to 0."
    )

    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt_user},
        ],
        "temperature": 0.1,
    }

    try:
        import urllib.request

        url = f"{base_url}/chat/completions"
        req_data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=req_data, headers=headers, method="POST")

        with urllib.request.urlopen(req, timeout=timeout) as response:
            resp_body = response.read().decode("utf-8")
            res_data = json.loads(resp_body)
            content = res_data["choices"][0]["message"]["content"].strip()

            # Clean markdown JSON code block if LLM returned ```json ... ```
            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:].strip()

            parsed = json.loads(content)

            if not parsed.get("is_risky", False) or float(parsed.get("risk_score", 0)) <= 0:
                return None

            risk_score = float(parsed.get("risk_score", 50.0))
            severity = str(parsed.get("severity", "MEDIUM")).upper()
            if severity not in ("CRITICAL", "HIGH", "MEDIUM", "LOW"):
                severity = "MEDIUM"

            return {
                "file_path": file_path,
                "commit_hash": commit_hash,
                "commit_date": commit_date,
                "severity": severity,
                "risk_score": round(risk_score, 1),
                "confidence": 0.85,
                "rule_id": "LLM-INSPECT",
                "rule_name": "LLM Security Fallback Inspection",
                "category": str(parsed.get("category", "misconfiguration")),
                "evidence": (added_lines or removed_lines)[:5],
                "matched_by": "llm_fallback",
                "nearest_pattern": "LLM Fallback Audit",
                "similarity": None,
                "explanation": str(parsed.get("explanation", "Potential security risk identified by LLM analysis.")),
                "remediation": str(parsed.get("remediation", "Review configuration change against security best practices.")),
                "author": author,
                "change_summary": str(parsed.get("summary", f"LLM detected security risk in {file_path}")),
                "evidence_side": "added" if added_lines else "removed",
            }

    except Exception as exc:
        logger.warning(f"LLM fallback inspection failed or timed out: {exc}")
        return None

