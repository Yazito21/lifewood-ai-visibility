import { fetchPublic } from "../_shared/safe-fetch.ts";
import { scorePageCitability } from "./citability.ts";
import { parseSitemap } from "./crawl.ts";
import { AI_CRAWLERS, parseRobots } from "./crawlers.ts";
import { countKnowledgeAssets, totalAssets } from "./knowledge-assets.ts";
import { analyzeLlmsTxt } from "./llms-txt.ts";
import { extractSchema } from "./schema.ts";

export type CompetitorInput = { name: string; website: string | null };

export type CompetitorCheck = {
  name: string;
  website: string;
  reachable: boolean;
  error?: string;
  aiCrawlersAllowed: number;
  aiCrawlersTotal: number;
  llmsTxt: boolean;
  schemaTypes: string[];
  citability: number | null;
  knowledgeAssets: number | null;
};

function origin(website: string): string {
  return new URL(/^https?:\/\//i.test(website) ? website : "https://" + website).origin;
}

/** Light GEO check of a competitor: homepage, robots.txt, llms.txt and sitemap only. */
export async function checkCompetitor(c: CompetitorInput & { website: string }, doFetch?: typeof fetch): Promise<CompetitorCheck> {
  const base: CompetitorCheck = {
    name: c.name, website: c.website, reachable: false, aiCrawlersAllowed: 0, aiCrawlersTotal: AI_CRAWLERS.length,
    llmsTxt: false, schemaTypes: [], citability: null, knowledgeAssets: null,
  };
  let root: string;
  try {
    root = origin(c.website);
  } catch {
    return { ...base, error: "Invalid website address." };
  }
  const home = await fetchPublic(root + "/", { accept: "text/html", fetch: doFetch });
  if (!home.ok) return { ...base, error: home.reason === "http_error" ? `HTTP ${home.status}` : home.reason };
  const homeOrigin = new URL(home.url).origin;
  const text = (url: string) => fetchPublic(url, { accept: "text/plain,application/xml", fetch: doFetch }).then((p) => (p.ok ? p.body : null));
  const [robotsText, llmsText, sitemapXml] = await Promise.all([
    text(homeOrigin + "/robots.txt"), text(homeOrigin + "/llms.txt"), text(homeOrigin + "/sitemap.xml"),
  ]);
  const robots = parseRobots(robotsText);
  const schema = extractSchema(home.body);
  const urls = sitemapXml ? parseSitemap(sitemapXml).urls : [];
  return {
    ...base,
    reachable: true,
    aiCrawlersAllowed: Object.values(robots.crawlers).filter((state) => state === "allowed").length,
    llmsTxt: analyzeLlmsTxt(llmsText).exists,
    schemaTypes: schema.types,
    citability: scorePageCitability(home.body).passages ? scorePageCitability(home.body).score : null,
    knowledgeAssets: sitemapXml ? totalAssets(countKnowledgeAssets(urls)) : null,
  };
}
