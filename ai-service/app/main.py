"""Configuration Drift Detector — AI/ML analysis service.

Run:  uvicorn app.main:app --reload --port 8001
Docs: http://localhost:8001/docs
"""
from collections import Counter

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .models import AnalyzeRequest, AnalyzeResponse, Finding
from .rule_engine import RuleEngine
from .semantic import SemanticMatcher, EMBEDDER, INDEX_BACKEND
from . import scoring
from .explain import explain

app = FastAPI(title="Drift Detector — AI Service", version="0.1.0")

# ---------------------------------------------------------------------------
# CORS — allow the Next.js dashboard to call this service from the browser.
# In Docker Compose the dashboard makes server-side calls (no CORS needed),
# but browser-based tools (swagger UI, direct fetch) also benefit from this.
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",   # local dev / browser
        "http://dashboard:3000",   # inter-container (Docker network)
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = RuleEngine()
matcher = SemanticMatcher()


@app.get("/health")
def health():
    return {"status": "ok", "rules_loaded": len(engine.rules),
            "seed_patterns": len(matcher.patterns),
            "embedder": EMBEDDER, "index": INDEX_BACKEND}


def run_analysis(req: AnalyzeRequest) -> AnalyzeResponse:
    """Core rule/semantic/scoring pipeline — shared by /analyze and /scan."""
    findings: list[Finding] = []
    dated_scores: list[tuple[str, float]] = []

    for ch in req.changes:
        rule_hits = engine.evaluate(ch.added_lines, ch.removed_lines)
        pattern, sim = matcher.nearest(ch.file_path, ch.added_lines, ch.removed_lines)
        context = scoring.nlp_context_score(ch.file_path, ch.added_lines, ch.removed_lines)

        if rule_hits:
            for hit in rule_hits:
                rule = hit["rule"]
                matched_by = "rule+semantic" if pattern else "rule"
                score, conf = scoring.final_score(
                    rule.base_score, sim if pattern else None, context)
                raw = {
                    "file_path": ch.file_path, "rule_id": rule.id,
                    "rule_name": rule.name, "category": rule.category,
                    "description": rule.description,
                    "rule_remediation": rule.remediation,
                    "evidence": hit["evidence"], "matched_by": matched_by,
                    "nearest_pattern": pattern["text"] if pattern else None,
                    "similarity": sim if pattern else None,
                }
                expl, rem = explain(raw)
                findings.append(Finding(
                    file_path=ch.file_path, commit_hash=ch.commit_hash,
                    commit_date=ch.commit_date,
                    severity=scoring.severity_from_score(score, rule.severity),
                    risk_score=score, confidence=conf,
                    rule_id=rule.id, rule_name=rule.name, category=rule.category,
                    evidence=hit["evidence"], matched_by=matched_by,
                    nearest_pattern=raw["nearest_pattern"],
                    similarity=round(sim, 3) if pattern else None,
                    explanation=expl, remediation=rem,
                    author=ch.author,
                    change_summary=f"{rule.name} detected in {ch.file_path}",
                    evidence_side=rule.applies_to,
                ))
                dated_scores.append((ch.commit_date or "0000", score))
        elif pattern:
            # semantic-only catch: no rule fired, but it's close to a known risk
            score, conf = scoring.final_score(None, sim, context)
            raw = {
                "file_path": ch.file_path, "evidence": ch.added_lines or ch.removed_lines,
                "matched_by": "semantic", "nearest_pattern": pattern["text"],
                "similarity": sim,
            }
            expl, rem = explain(raw)
            findings.append(Finding(
                file_path=ch.file_path, commit_hash=ch.commit_hash,
                commit_date=ch.commit_date,
                severity=scoring.severity_from_score(score, None),
                risk_score=score, confidence=conf,
                rule_id=None, rule_name=None, category=pattern["category"],
                evidence=(ch.added_lines or ch.removed_lines)[:5],
                matched_by="semantic", nearest_pattern=pattern["text"],
                similarity=round(sim, 3), explanation=expl, remediation=rem,
                author=ch.author,
                change_summary=f"Semantic match to \"{pattern['text'][:60]}\" in {ch.file_path}",
                evidence_side="added" if ch.added_lines else "removed",
            ))
            dated_scores.append((ch.commit_date or "0000", score))

    findings.sort(key=lambda f: f.risk_score, reverse=True)
    return AnalyzeResponse(
        repo_id=req.repo_id,
        drift_score=scoring.drift_score([f.risk_score for f in findings]),
        risk_trend=scoring.risk_trend(dated_scores),
        summary=dict(Counter(f.severity for f in findings)),
        findings=findings,
        analyzed_changes=len(req.changes),
        engine_info={"embedder": EMBEDDER, "index": INDEX_BACKEND,
                     "rules": len(engine.rules), "seed_patterns": len(matcher.patterns)},
    )


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest):
    return run_analysis(req)


# /scan endpoint — URL-in, AnalyzeResponse-out
from .scan import router as scan_router  # noqa: E402 — after app & run_analysis are defined
app.include_router(scan_router)
