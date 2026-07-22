import { afterEach, describe, expect, it, vi } from "vitest";
import { NewsService } from "./news.service.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NewsService", () => {
  it("mantiene cobertura nacional, regional y mundial si una fuente oficial bloquea la ingesta", async () => {
    const rss = (url: string) => `<?xml version="1.0"?><rss><channel><item>
      <title>Actualización económica verificable</title>
      <link>${url}</link>
      <pubDate>Wed, 22 Jul 2026 12:00:00 GMT</pubDate>
      <description>Resumen publicado por la fuente original.</description>
    </item></channel></rss>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        return url.includes("banrep.gov.co")
          ? new Response("<html>Página anti-bot</html>", {
              status: 200,
              headers: { "content-type": "text/html" },
            })
          : new Response(
              rss(`https://example.invalid/${encodeURIComponent(url)}`),
              {
                status: 200,
                headers: { "content-type": "application/rss+xml" },
              },
            );
      }),
    );
    const prisma = {
      newsArticle: { upsert: vi.fn(async () => ({})) },
    };
    const service = new NewsService(prisma as never);

    const result = await service.refresh();

    expect(result.imported).toBe(3);
    expect(
      result.sources.find(
        (source) => source.source === "Banco de la República",
      ),
    ).toMatchObject({ ok: false, imported: 0 });
    expect(
      result.sources.filter(
        (source) => source.source.startsWith("Google News") && source.ok,
      ),
    ).toHaveLength(3);
    expect(prisma.newsArticle.upsert).toHaveBeenCalledTimes(3);
  });
});
