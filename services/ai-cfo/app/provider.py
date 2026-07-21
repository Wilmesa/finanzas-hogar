import json
import os
from abc import ABC, abstractmethod

import httpx

from .models import InsightBundle, InsightSnapshot
from .prompt import SYSTEM_PROMPT


class InsightProvider(ABC):
    @abstractmethod
    async def generate(self, snapshot: InsightSnapshot) -> InsightBundle:
        raise NotImplementedError


class DeterministicProvider(InsightProvider):
    async def generate(self, snapshot: InsightSnapshot) -> InsightBundle:
        if not snapshot.evidence:
            return InsightBundle(
                status="insufficient_data",
                summary="Aún no hay suficientes movimientos verificados para crear un análisis.",
                alerts=[], spendingFindings=[], opportunities=[], goals=[], news=[]
            )
        evidence_id = snapshot.evidence[0].id
        return InsightBundle(
            status="ok",
            summary=f"El hogar ha registrado gastos por {snapshot.metrics.spent} {snapshot.currency} en el periodo.",
            alerts=[{
                "severity": "info",
                "message": f"El gasto diario seguro calculado es {snapshot.metrics.safeDailySpend} {snapshot.currency}.",
                "evidenceIds": [evidence_id],
            }],
            spendingFindings=[], opportunities=[], goals=[], news=[]
        )


class OpenAIProvider(InsightProvider):
    def __init__(self) -> None:
        self.api_key = os.environ["OPENAI_API_KEY"]
        self.model = os.getenv("OPENAI_MODEL", "gpt-5.6-terra")

    async def generate(self, snapshot: InsightSnapshot) -> InsightBundle:
        schema = InsightBundle.model_json_schema()
        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.post(
                "https://api.openai.com/v1/responses",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "model": self.model,
                    "reasoning": {"effort": "low"},
                    "input": [
                        {"role": "developer", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": snapshot.model_dump_json()},
                    ],
                    "text": {
                        "verbosity": "low",
                        "format": {
                            "type": "json_schema",
                            "name": "financial_insight_bundle",
                            "strict": True,
                            "schema": schema,
                        },
                    },
                },
            )
            response.raise_for_status()
            payload = response.json()
        output_text = payload.get("output_text")
        if not output_text:
            for item in payload.get("output", []):
                for content in item.get("content", []):
                    if content.get("type") == "output_text":
                        output_text = content.get("text")
                        break
        if not output_text:
            raise ValueError("OpenAI no devolvió texto estructurado")
        return InsightBundle.model_validate(json.loads(output_text))


def provider_from_environment() -> InsightProvider:
    provider = os.getenv("AI_PROVIDER", "disabled").lower()
    if provider == "openai":
        return OpenAIProvider()
    return DeterministicProvider()

