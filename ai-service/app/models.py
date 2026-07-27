"""JSON contract for the AI service.

This is the frozen contract between the Node backend and this service.
Backend sends ChangePayload(s); we return AnalysisReport.
"""
from typing import Optional
from pydantic import BaseModel, Field


class ConfigChange(BaseModel):
    """One config change extracted by the Git miner."""
    file_path: str = Field(..., examples=["k8s/deployment.yaml"])
    commit_hash: str = Field(default="", examples=["a1b2c3d"])
    commit_date: str = Field(default="", examples=["2026-03-14T10:22:00Z"])
    author: str = Field(default="")
    added_lines: list[str] = Field(default_factory=list)
    removed_lines: list[str] = Field(default_factory=list)


class AnalyzeRequest(BaseModel):
    repo_id: str = Field(default="local", description="Backend's repo identifier")
    changes: list[ConfigChange]
    prior_scores: list[float] = Field(
        default_factory=list,
        description="Previous per-scan drift scores (0-100), oldest first. "
                    "Used to compute the decay-weighted accumulated repo score.",
    )
    prior_trend_points: list[dict] = Field(
        default_factory=list,
        description="Previous trend points as [{date: ISO-str, score: float (0-100)}], "
                    "oldest first.  Used by trend_alert() to detect sustained score jumps "
                    "within a rolling calendar window (Feature 6).",
    )


class Finding(BaseModel):
    file_path: str
    commit_hash: str
    commit_date: str
    severity: str                      # CRITICAL | HIGH | MEDIUM | LOW
    risk_score: float                  # 0-100 final weighted score
    confidence: float                  # 0-1
    rule_id: Optional[str]             # null if caught only by semantic layer
    rule_name: Optional[str]
    category: str                      # network_exposure | secrets_auth | ...
    evidence: list[str]                # exact lines that triggered it
    matched_by: str                    # "rule" | "semantic" | "rule+semantic"
    nearest_pattern: Optional[str]     # closest seed pattern (semantic layer)
    similarity: Optional[float]        # cosine similarity to nearest pattern
    explanation: str                   # plain-English reason
    remediation: str                   # suggested fix
    # Integration-only fields — used by dashboard mapping layer
    author: str = ""                   # commit author, passed through from ConfigChange
    change_summary: str = ""           # server-synthesised one-liner for the UI
    evidence_side: str = ""            # "added" | "removed" — which side triggered it


class AnalyzeResponse(BaseModel):
    repo_id: str
    drift_score: float                 # 0-100, per-scan accumulation of this scan's findings
    repo_score: float                  # 0-100, decay-weighted accumulation across ALL scans
    risk_trend: list[dict]             # [{date, cumulative_score}] chronological
    summary: dict                      # counts by severity
    findings: list[Finding]
    analyzed_changes: int
    engine_info: dict                  # which embedder/index backend is live
    trend_alert: Optional[dict] = None # Feature 6: fired when score jumped > threshold in window
