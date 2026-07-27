"""Inter-service authentication dependency.

Usage
-----
from .security import verify_internal_api_key
from fastapi import Depends

# Per-route
@app.post("/analyze", dependencies=[Depends(verify_internal_api_key)])

# Router-level (protects every route in the router)
router = APIRouter(dependencies=[Depends(verify_internal_api_key)])
"""
import os

from fastapi import Depends, Header, HTTPException


def verify_internal_api_key(
    x_internal_api_key: str = Header(...),
) -> None:
    """FastAPI dependency — validates the X-Internal-Api-Key header.

    Raises
    ------
    HTTPException 500  INTERNAL_API_KEY env var is not set (server misconfigured).
    HTTPException 401  Header is absent or does not match the expected secret.
    """
    expected = os.environ.get("INTERNAL_API_KEY")
    if not expected:
        raise HTTPException(
            status_code=500,
            detail="INTERNAL_API_KEY is not configured on the server.",
        )
    if x_internal_api_key != expected:
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing internal API key.",
        )
