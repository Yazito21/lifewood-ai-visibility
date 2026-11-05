// Types shared by the report pages. The audit/narrative shapes mirror
// supabase/functions/site-audit (index.ts audit JSON, narrative.ts Narrative).

export type Presence = { social: number; directories: number; websites: number };

export type BenchmarkRow = {
  name: string;
  website: string | null;
  isTracked: boolean;
  rank: number | null;
  visibilityScore: number | null;
  shareOfVoice: number | null;
  citations: number;
  presence: Presence;
};

export type ReportSnapshot = {
  version: 1;
  brand: { name: string; website: string | null; categories: string[] };
  period: { start: string; end: string; label: string };
  location: string;
  engines: string[];
  promptCount: number;
  hasData: boolean;
  overall: {
    visibilityScore: number | null;
    scoreChange: number | null;
    rank: number | null;
    population: number | null;
    rankText: string;
    shareOfVoice: number | null;
    brandCitations: number;
  };
  trend: { date: string; score: number | null }[];
  byEngine: { engine: string; label: string; visibilityScore: number | null }[];
  byCategory: { category: string; visibilityScore: number | null; rank: number | null; rankText: string }[];
  competitors: BenchmarkRow[];
  gaps: { prompt: string; category: string | null; competitors: string[] }[];
  topCitedPages: { url: string; frequency: number; isBrand: boolean }[];
  topCitedDomains: { hostname: string; responses: number }[];
  brandSiteCited: boolean;
  thirdPartyHosts: number;
};

export type PillarKey = "website" | "knowledge" | "authority" | "community" | "monitoring";

export type Narrative = {
  executiveSummary: { position: string[] };
  kpiNotes: { visibility: string; rank: string; citations: string; shareOfVoice: string };
  competitorSummary: string;
  pillars: Record<PillarKey, { position: string[] }>;
  targetNotes: string;
  fallback?: true;
};

export type CrawlerAccess = "allowed" | "blocked" | "partial";

export type PageCheck = {
  url: string; status: number; title: string | null; titleLength: number; metaDescription: string | null;
  metaDescriptionLength: number; h1Count: number; canonical: string | null; hasViewport: boolean; lang: string | null;
  wordCount: number; textToHtmlRatio: number; jsDependent: boolean; hasSchema: boolean;
};

export type CompetitorCheck = {
  name: string; website: string; reachable: boolean; error?: string; aiCrawlersAllowed: number; aiCrawlersTotal: number;
  llmsTxt: boolean; schemaTypes: string[]; citability: number | null; knowledgeAssets: number | null;
};

export type GeoCategory = "citability" | "brand" | "eeat" | "technical" | "schema" | "platform";
export type FindingKey = GeoCategory | "seo";

export type Audit = {
  site: {
    origin: string;
    reachable: boolean;
    error?: string;
    robots: { exists: boolean; crawlers: Record<string, CrawlerAccess>; sitemaps: string[] };
    llmsTxt: { exists: boolean; valid: boolean; sectionCount: number; linkCount: number };
    siteChecks: { https: boolean; robotsTxt: boolean; sitemap: boolean; canonical: boolean; viewport: boolean; serverRendered: boolean };
    pages: PageCheck[];
    citability: { url: string; score: number; passages: number; best: { heading: string | null; text: string; score: number }[] }[];
    schema: { blocks: number; invalidBlocks: number; types: string[]; sameAs: string[]; hasOrganization: boolean; hasWebSite: boolean; contentTypes: string[] };
    knowledgeAssets: Record<string, number>;
    brandAuthority: {
      wikipedia: { found: boolean; url: string | null };
      wikidata: { found: boolean; id: string | null };
      social: Record<string, string | null>;
    };
    manualCheckLinks: { platform: string; url: string }[];
    eeat: Record<"experience" | "expertise" | "authoritativeness" | "trustworthiness", { score: number; evidence: string }> | null;
  };
  scores: Record<GeoCategory, number | null> & { geo: number | null; seo: number | null };
  findings: Record<FindingKey, string[]>;
  competitors: CompetitorCheck[];
  notices: string[];
  budgetSkipped: string[];
};

export type TargetEdit = { scope: string; targetScore: number | null; targetRank: number | null };

export type ReportEdits = {
  text?: Record<string, string>;
  manual?: { domainAuthority?: Record<string, string> };
  targets?: TargetEdit[];
};

export type ReportStatus = "queued" | "running" | "completed" | "failed";

export type AuditReportRow = {
  id: string;
  project_id: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  period_start: string;
  period_end: string;
  period_label: string | null;
  tracking_location: string;
  status: ReportStatus;
  step: string | null;
  visibility_snapshot: ReportSnapshot | null;
  audit: Audit | null;
  narrative: Narrative | null;
  edits: ReportEdits;
  ai_visibility_score: number | null;
  geo_score: number | null;
  seo_score: number | null;
  error: string | null;
};
