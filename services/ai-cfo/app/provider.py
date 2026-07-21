import json
import os
from abc import ABC, abstractmethod
from urllib.parse import urlparse

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


class GeminiProvider(InsightProvider):
    def __init__(self) -> None:
        self.api_key = os.environ["GEMINI_API_KEY"]
        self.model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

    async def generate(self, snapshot: InsightSnapshot) -> InsightBundle:
        schema = InsightBundle.model_json_schema()
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.post(
                url,
                headers={"x-goog-api-key": self.api_key},
                json={
                    "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
                    "contents": [{"role": "user", "parts": [{"text": snapshot.model_dump_json()}]}],
                    "generationConfig": {
                        "responseMimeType": "application/json",
                        "responseJsonSchema": schema,
                    },
                },
            )
            response.raise_for_status()
            payload = response.json()
        try:
            output_text = payload["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError, TypeError) as error:
            raise ValueError("Gemini no devolvió texto estructurado") from error
        return InsightBundle.model_validate(json.loads(output_text))


class OpenAICompatibleProvider(InsightProvider):
    """Adaptador para Groq, OpenRouter, NVIDIA NIM y gateways compatibles."""

    def __init__(self) -> None:
        self.api_key = os.environ["AI_COMPATIBLE_API_KEY"]
        self.model = os.environ["AI_COMPATIBLE_MODEL"]
        self.provider_name = os.getenv("AI_COMPATIBLE_PROVIDER_NAME", "OpenAI compatible")
        self.base_url = os.environ["AI_COMPATIBLE_BASE_URL"].rstrip("/")
        self.structured_mode = os.getenv("AI_COMPATIBLE_STRUCTURED_MODE", "json_schema")
        parsed = urlparse(self.base_url)
        allow_http = os.getenv("AI_ALLOW_INSECURE_HTTP", "false").lower() == "true"
        if parsed.scheme not in ({"https", "http"} if allow_http else {"https"}) or not parsed.netloc:
            raise ValueError("AI_COMPATIBLE_BASE_URL debe ser una URL HTTPS válida")
        if self.structured_mode not in {"json_schema", "json_object", "prompt"}:
            raise ValueError("AI_COMPATIBLE_STRUCTURED_MODE no es válido")

    async def generate(self, snapshot: InsightSnapshot) -> InsightBundle:
        schema = InsightBundle.model_json_schema()
        payload: dict = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": snapshot.model_dump_json()},
            ],
            "temperature": 0.1,
        }
        if self.structured_mode == "json_schema":
            payload["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": "financial_insight_bundle",
                    "strict": True,
                    "schema": schema,
                },
            }
        elif self.structured_mode == "json_object":
            payload["response_format"] = {"type": "json_object"}
        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                    **(
                        {"HTTP-Referer": os.environ["AI_COMPATIBLE_HTTP_REFERER"]}
                        if os.getenv("AI_COMPATIBLE_HTTP_REFERER") else {}
                    ),
                    **(
                        {"X-Title": os.environ["AI_COMPATIBLE_APP_NAME"]}
                        if os.getenv("AI_COMPATIBLE_APP_NAME") else {}
                    ),
                },
                json=payload,
            )
            response.raise_for_status()
            result = response.json()
        try:
            output_text = result["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as error:
            raise ValueError(f"{self.provider_name} no devolvió texto estructurado") from error
        return InsightBundle.model_validate(json.loads(output_text))


def provider_from_environment() -> InsightProvider:
    provider = os.getenv("AI_PROVIDER", "disabled").lower()
    if provider == "openai":
        return OpenAIProvider()
    if provider == "gemini":
        return GeminiProvider()
    if provider == "openai_compatible":
        return OpenAICompatibleProvider()
    if provider == "deterministic":
        return DeterministicProvider()
    raise ValueError("AI_PROVIDER no está habilitado")
