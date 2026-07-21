import asyncio

import pytest

from app.models import InsightBundle, InsightSnapshot
from app.provider import DeterministicProvider
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
