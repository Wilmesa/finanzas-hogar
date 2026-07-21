import { Injectable, ServiceUnavailableException } from "@nestjs/common";

@Injectable()
export class AiCfoClient {
  async generate(snapshot: unknown): Promise<unknown> {
    const url = process.env.AI_CFO_URL;
    const token = process.env.AI_CFO_INTERNAL_TOKEN;
    if (!url || !token)
      throw new ServiceUnavailableException("AI-CFO no está configurado");
    const response = await fetch(`${url}/internal/v1/insights/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-token": token,
      },
      body: JSON.stringify(snapshot),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok)
      throw new ServiceUnavailableException(
        `AI-CFO respondió ${response.status}`,
      );
    return response.json();
  }
}
