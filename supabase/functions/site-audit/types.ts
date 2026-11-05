export type CrawlerAccess = "allowed" | "blocked" | "partial";

export type RobotsResult = { exists: boolean; crawlers: Record<string, CrawlerAccess>; sitemaps: string[] };

export type LlmsTxtResult = {
  exists: boolean; hasTitle: boolean; hasSummary: boolean; sectionCount: number; linkCount: number; valid: boolean;
};

export type FetchedHtml = { url: string; status: number; html: string; ms: number };

export type CrawlResult = {
  origin: string;
  reachable: boolean;
  error?: string;
  homepage: FetchedHtml | null;
  pages: FetchedHtml[];
  robotsText: string | null;
  llmsText: string | null;
  sitemapUrls: string[];
};

export type EeatDimension = { score: number; evidence: string };
export type EeatResult = {
  experience: EeatDimension;
  expertise: EeatDimension;
  authoritativeness: EeatDimension;
  trustworthiness: EeatDimension;
};
