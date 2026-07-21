import asyncio

import pytest

from app.models import InsightBundle, InsightSnapshot
from app.provider import DeterministicProvider, GeminiProvider, OpenAICompatibleProvider, provider_from_environment
from app.validator import validate_bundle


def snapshot() -> InsightSnapshot:
    return InsightSnapshot.model_validate({
        "scope": "household",
        "period": {"start": "2026-07-01", "end": "2026-07-19", "daysRemaining": 12},
        "currency": "COP",
        "metrics": {"income": "8000000", "spent": "4650000", "savingsRate": 0.18, "safeDailySpend": "92000"},
        "evidence": [{"id": "metric:spent", "kind": "metric", "label": "Gasto", "value": "4650000"}],
    })


def test_deterministic_provider_is_grounded():
    source = snapshot()
    bundle = asyncio.run(DeterministicProvider().generate(source))
    assert bundle.status == "ok"
    assert bundle.alerts[0].evidenceIds == ["metric:spent"]


def test_validator_rejects_unknown_evidence():
    source = snapshot()
    bundle = InsightBundle.model_validate({
        "status": "ok", "summary": "x",
        "alerts": [{"severity": "info", "message": "x", "evidenceIds": ["private:secret"]}],
        "spendingFindings": [], "opportunities": [], "goals": [], "news": []
    })
    with pytest.raises(ValueError, match="Evidencias inexistentes"):
        validate_bundle(bundle, source)


def test_disabled_provider_cannot_generate(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "disabled")
    with pytest.raises(ValueError, match="no está habilitado"):
        provider_from_environment()


def test_deterministic_provider_reports_insufficient_data():
    source = snapshot().model_copy(update={"evidence": []})
    bundle = asyncio.run(DeterministicProvider().generate(source))
    assert bundle.status == "insufficient_data"
    assert bundle.opportunities == []


def test_gemini_provider_is_selected_without_exposing_key(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "test-only-key")
    monkeypatch.setenv("GEMINI_MODEL", "test-model")
    provider = provider_from_environment()
    assert isinstance(provider, GeminiProvider)
    assert provider.model == "test-model"


def test_openai_compatible_provider_supports_custom_vendor(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "openai_compatible")
    monkeypatch.setenv("AI_COMPATIBLE_PROVIDER_NAME", "Proveedor de prueba")
    monkeypatch.setenv("AI_COMPATIBLE_BASE_URL", "https://provider.example/v1")
    monkeypatch.setenv("AI_COMPATIBLE_API_KEY", "test-only-key")
    monkeypatch.setenv("AI_COMPATIBLE_MODEL", "custom-model")
    provider = provider_from_environment()
    assert isinstance(provider, OpenAICompatibleProvider)
    assert provider.model == "custom-model"
    assert provider.provider_name == "Proveedor de prueba"
