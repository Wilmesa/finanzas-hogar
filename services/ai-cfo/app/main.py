import hmac
import os

from fastapi import Depends, FastAPI, Header, HTTPException

from .models import InsightBundle, InsightSnapshot
from .provider import provider_from_environment
from .validator import validate_bundle

app = FastAPI(title="Finanzas AI-CFO", version="0.1.0")


def internal_auth(x_internal_token: str | None = Header(default=None)) -> None:
    expected = os.getenv("AI_CFO_INTERNAL_TOKEN", "")
    if not expected or not x_internal_token or not hmac.compare_digest(expected, x_internal_token):
        raise HTTPException(status_code=401, detail="unauthorized")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "provider": os.getenv("AI_PROVIDER", "disabled")}


@app.post("/internal/v1/insights/generate", response_model=InsightBundle, dependencies=[Depends(internal_auth)])
async def generate_insights(snapshot: InsightSnapshot) -> InsightBundle:
    provider = provider_from_environment()
    result = await provider.generate(snapshot)
    return validate_bundle(result, snapshot)

