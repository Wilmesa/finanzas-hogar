import { Injectable } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";

interface NormalizedNews {
  source: string;
  sourceUrl: string;
  title: string;
  publishedAt: Date;
  factSummary: string;
  topics: string[];
}

function decodeXml(value: string): string {
  return value
    .replaceAll("<![CDATA[", "")
    .replaceAll("]]>", "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function element(xml: string, name: string): string {
  return decodeXml(
    xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] ??
      "",
  );
}

function validDate(value: string): Date {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

@Injectable()
export class NewsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const latest = await this.prisma.newsArticle.findFirst({
      orderBy: { fetchedAt: "desc" },
    });
    if (!latest || Date.now() - latest.fetchedAt.getTime() > 60 * 60 * 1000) {
      await this.refresh();
    }
    return this.prisma.newsArticle.findMany({
      orderBy: { publishedAt: "desc" },
      take: 30,
    });
  }

  async refresh() {
    const results = await Promise.allSettled([
      this.fetchBanrep(),
      this.fetchAlphaVantage(),
    ]);
    const articles = results.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    );
    for (const article of articles) {
      await this.prisma.newsArticle.upsert({
        where: { sourceUrl: article.sourceUrl },
        create: article,
        update: { ...article, fetchedAt: new Date() },
      });
    }
    return { imported: articles.length };
  }

  private async fetchBanrep(): Promise<NormalizedNews[]> {
    const response = await fetch(
      "https://www.banrep.gov.co/en/noticias-rss?page=1",
      { signal: AbortSignal.timeout(12_000) },
    );
    if (!response.ok) return [];
    const xml = await response.text();
    return [...xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi)]
      .slice(0, 15)
      .map((match) => {
        const item = match[1] ?? "";
        const sourceUrl = element(item, "link");
        return {
          source: "Banco de la República",
          sourceUrl,
          title: element(item, "title"),
          publishedAt: validDate(element(item, "pubDate")),
          factSummary: element(item, "description").slice(0, 800),
          topics: ["colombia", "economía"],
        };
      })
      .filter((item) => item.sourceUrl && item.title);
  }

  private async fetchAlphaVantage(): Promise<NormalizedNews[]> {
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!apiKey) return [];
    const query = new URLSearchParams({
      function: "NEWS_SENTIMENT",
      topics: "economy_monetary,economy_macro",
      limit: "20",
      apikey: apiKey,
    });
    const response = await fetch(`https://www.alphavantage.co/query?${query}`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      feed?: Array<{
        title: string;
        url: string;
        time_published: string;
        summary: string;
        topics?: Array<{ topic: string }>;
      }>;
    };
    return (payload.feed ?? []).map((item) => ({
      source: "Alpha Vantage",
      sourceUrl: item.url,
      title: item.title,
      publishedAt: validDate(
        item.time_published.replace(
          /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/,
          "$1-$2-$3T$4:$5:$6Z",
        ),
      ),
      factSummary: item.summary.slice(0, 800),
      topics: (item.topics ?? []).map((topic) => topic.topic).slice(0, 5),
    }));
  }
}
