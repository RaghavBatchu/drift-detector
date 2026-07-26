"""URL-in, AnalyzeResponse-out endpoint.

POST /scan accepts a public repo URL and a caller-supplied scan_id,
mines the repo's config history (via mine_repo.mine()), and runs the
full rule/semantic/scoring pipeline (via main.run_analysis()).

The endpoint is synchronous — no job queue, no polling. The dashboard's
own async background-task pattern (Commit 7) wraps this call so the
Next.js side stays non-blocking without adding complexity here.
"""
import importlib.util
import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .models import AnalyzeRequest, AnalyzeResponse

# ---------------------------------------------------------------------------
# Load mine_repo from the project root (one level above the app/ package).
# Using importlib avoids adding the project root to sys.path globally.
# ---------------------------------------------------------------------------
_mine_repo_path = os.path.join(os.path.dirname(__file__), "..", "mine_repo.py")
_spec = importlib.util.spec_from_file_location("mine_repo", _mine_repo_path)
_mine_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mine_module)

mine: callable = _mine_module.mine
MineError: type = _mine_module.MineError

# ---------------------------------------------------------------------------

router = APIRouter()


class ScanRequest(BaseModel):
    repo_url: str
    scan_id: str  # round-tripped for logging/correlation only, not used internally


@router.post("/scan", response_model=AnalyzeResponse)
def scan(req: ScanRequest):
    # mine the repo — raises MineError for invalid/unreachable URLs
    try:
        raw_changes = mine(req.repo_url)
    except MineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Deferred import avoids circular dependency:
    # scan.py is imported by main.py which defines run_analysis.
    from .main import run_analysis  # noqa: PLC0415

    analyze_req = AnalyzeRequest(repo_id=req.scan_id, changes=raw_changes)
    return run_analysis(analyze_req)
