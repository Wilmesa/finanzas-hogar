import hmac
import os

from fastapi import Depends, FastAPI, Header, HTTPException

from .models import ChatRequest, ChatResponse, InsightBundle, InsightSnapshot
from .provider import provider_from_environment
from .validator import validate_bundle

app = FastAPI(title="OKLE AI-CFO", version="0.2.0")


def internal_auth(x_internal_token: str | None = Header(default=None)) -> None:
    expected = os.getenv("AI_CFO_INTERNAL_TOKEN", "")
    if not expected or not x_internal_token or not hmac.compare_digest(expected, x_internal_token):
        raise HTTPException(status_code=401, detail="unauthorized")


@app.get("/health")
async def health() -> dict:
    provider = os.getenv("AI_PROVIDER", "disabled").lower()
    key_present = provider == "deterministic" or (
        provider == "openai" and bool(os.getenv("OPENAI_API_KEY"))
    ) or (provider == "gemini" and bool(os.getenv("GEMINI_API_KEY"))) or (
        provider == "openai_compatible"
        and bool(os.getenv("AI_COMPATIBLE_API_KEY"))
        and bool(os.getenv("AI_COMPATIBLE_BASE_URL"))
        and bool(os.getenv("AI_COMPATIBLE_MODEL"))
    )
    return {
        "status": "ok",
        "provider": provider,
        "model": (
            os.getenv("OPENAI_MODEL") if provider == "openai"
            else os.getenv("GEMINI_MODEL") if provider == "gemini"
            else os.getenv("AI_COMPATIBLE_MODEL") if provider == "openai_compatible"
            else provider
        ),
        "keyPresent": key_present,
        "generationEnabled": provider in {"openai", "gemini", "openai_compatible", "deterministic"} and key_present,
        "providerName": (
            os.getenv("AI_COMPATIBLE_PROVIDER_NAME", "OpenAI compatible")
            if provider == "openai_compatible" else provider
        ),
    }


@app.post("/internal/v1/insights/generate", response_model=InsightBundle, dependencies=[Depends(internal_auth)])
async def generate_insights(snapshot: InsightSnapshot) -> InsightBundle:
    if os.getenv("AI_PROVIDER", "disabled").lower() == "disabled":
        raise HTTPException(status_code=503, detail="AI-CFO is disabled")
    provider = provider_from_environment()
    result = await provider.generate(snapshot)
    return validate_bundle(result, snapshot)


@app.post("/internal/v1/chat", response_model=ChatResponse, dependencies=[Depends(internal_auth)])
async def chat(request: ChatRequest) -> ChatResponse:
    if os.getenv("AI_PROVIDER", "disabled").lower() == "disabled":
        raise HTTPException(status_code=503, detail="AI-CFO is disabled")
    return await provider_from_environment().chat(request)
