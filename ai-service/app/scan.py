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

from fastapi import APIRouter, Depends, HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from typing import Callable, Any

from .security import verify_internal_api_key
from pydantic import BaseModel

from .models import AnalyzeRequest, AnalyzeResponse

# ---------------------------------------------------------------------------
# Load mine_repo from the project root (one level above the app/ package).
# Using importlib avoids adding the project root to sys.path globally.
# ---------------------------------------------------------------------------
_mine_repo_path = os.path.join(os.path.dirname(__file__), "..", "mine_repo.py")
_spec = importlib.util.spec_from_file_location("mine_repo", _mine_repo_path)
assert _spec is not None and _spec.loader is not None, "Could not load mine_repo.py"
_mine_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mine_module)

mine: Callable[..., Any] = _mine_module.mine
MineError: type = _mine_module.MineError

# ---------------------------------------------------------------------------

# Limiter instance — must use the same key_func as main.py so both routes
# share the same per-IP counter namespace on app.state.limiter.
_rate_limit_enabled = os.getenv("DISABLE_RATE_LIMIT", "false").lower() != "true"
limiter = Limiter(key_func=get_remote_address, enabled=_rate_limit_enabled)

router = APIRouter(dependencies=[Depends(verify_internal_api_key)])


class ScanRequest(BaseModel):
    repo_url: str
    scan_id: str  # round-tripped for logging/correlation only, not used internally
    prior_scores: list[float] = []      # forwarded to run_analysis for accumulated score
    prior_trend_points: list[dict] = [] # forwarded for trend_alert() (Feature 6)


@router.post(
    "/scan",
    response_model=AnalyzeResponse,
    responses={
        401: {"description": "Missing or invalid X-Internal-Api-Key"},
        429: {"description": "Rate limit exceeded"},
    },
)
@limiter.limit(os.getenv("RATE_LIMIT_PER_HOUR", "10") + "/hour")
def scan(request: Request, req: ScanRequest):
    # mine the repo — raises MineError for invalid/unreachable URLs
    try:
        raw_changes = mine(req.repo_url)
    except MineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Deferred import avoids circular dependency:
    # scan.py is imported by main.py which defines run_analysis.
    from .main import run_analysis  # noqa: PLC0415

    analyze_req = AnalyzeRequest(
        repo_id=req.scan_id,
        changes=raw_changes,
        prior_scores=req.prior_scores,
        prior_trend_points=req.prior_trend_points,
    )
    return run_analysis(analyze_req)
