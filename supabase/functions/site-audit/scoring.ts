import { KEY_CRAWLERS } from "./crawlers.ts";
import type { BrandAuthority } from "./brand-authority.ts";
import type { PageCitability } from "./citability.ts";
import type { SchemaResult } from "./schema.ts";
import type { PageCheck, SiteChecks } from "./technical.ts";
import type { EeatResult, LlmsTxtResult, RobotsResult } from "./types.ts";

/** GEO category weights from the geo-audit skill. */
export const GEO_WEIGHTS = { citability: 25, brand: 20, eeat: 20, technical: 15, schema: 10, platform: 10 } as const;
export type GeoCategory = keyof typeof GEO_WEIGHTS;
export type Rating = "Excellent" | "Good" | "Fair" | "Poor" | "Critical";

const clamp = (n: number) => Math.max(0, Math.min(100, n));

export function rating(score: number): Rating {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 60) return "Fair";
  if (score >= 40) return "Poor";
  return "Critical";
}

/** Key AI crawler access 40, llms.txt 20, server-rendered 20, HTTPS 10, sitemap 10. */
export function technicalScore(robots: RobotsResult, llms: LlmsTxtResult, site: SiteChecks): number {
  const access = KEY_CRAWLERS.reduce((sum, name) => {
    const state = robots.crawlers[name];
    return sum + (state === "allowed" ? 1 : state === "partial" ? 0.5 : 0);
  }, 0) / KEY_CRAWLERS.length;
  const score = 40 * access + (llms.exists ? 12 : 0) + (llms.valid ? 8 : 0) +
    (site.serverRendered ? 20 : 0) + (site.https ? 10 : 0) + (site.sitemap ? 10 : 0);
  return Math.round(clamp(score));
}

/** Organization 35, sameAs ≥2 → 20 (1 → 10), WebSite 10, content types 5 each up to 20, no invalid blocks 15. */
export function schemaScore(s: SchemaResult): number {
  const sameAs = s.sameAs.length >= 2 ? 20 : s.sameAs.length === 1 ? 10 : 0;
  const score = (s.hasOrganization ? 35 : 0) + sameAs + (s.hasWebSite ? 10 : 0) +
    Math.min(20, 5 * s.contentTypes.length) + (s.blocks > 0 && s.invalidBlocks === 0 ? 15 : 0);
  return Math.round(clamp(score));
}

/** Wikipedia 30, Wikidata 20, LinkedIn 10, YouTube 10, X 5, Facebook 5, Instagram 5, AI-cited third-party hosts up to 15. */
export function brandScore(b: BrandAuthority, thirdPartyHosts: number): number {
  const score = (b.wikipedia.found ? 30 : 0) + (b.wikidata.found ? 20 : 0) +
    (b.social.linkedin ? 10 : 0) + (b.social.youtube ? 10 : 0) + (b.social.x ? 5 : 0) +
    (b.social.facebook ? 5 : 0) + (b.social.instagram ? 5 : 0) + Math.min(15, 1.5 * Math.max(0, thirdPartyHosts));
  return Math.round(clamp(score));
}

export function citabilityScore(pages: PageCitability[]): number | null {
  if (!pages.length) return null;
  return Math.round(pages.reduce((sum, p) => sum + p.score, 0) / pages.length);
}

export function eeatScore(e: EeatResult | null): number | null {
  if (!e) return null;
  return Math.round(clamp(e.experience.score + e.expertise.score + e.authoritativeness.score + e.trustworthiness.score));
}

/** Mean AI visibility score across tracked engines (measured by the platform). */
export function platformScore(byEngine: { visibilityScore: number | null }[]): number | null {
  const values = byEngine.map((e) => e.visibilityScore).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!values.length) return null;
  return Math.round(values.reduce((sum, v) => sum + clamp(v), 0) / values.length);
}

/** Weighted mean over the measured categories; weights of missing categories are redistributed. */
export function geoScore(scores: Record<GeoCategory, number | null>): number | null {
  let total = 0;
  let weight = 0;
  for (const [category, w] of Object.entries(GEO_WEIGHTS) as [GeoCategory, number][]) {
    const value = scores[category];
    if (value === null || !Number.isFinite(value)) continue;
    total += value * w;
    weight += w;
  }
  return weight ? Math.round(total / weight) : null;
}

function pageScore(p: PageCheck): number {
  const checks = [
    p.status === 200,
    p.titleLength >= 30 && p.titleLength <= 65,
    p.metaDescriptionLength >= 70 && p.metaDescriptionLength <= 160,
    p.h1Count === 1,
    p.wordCount >= 300,
    p.hasSchema,
  ];
  return checks.filter(Boolean).length / checks.length;
}

/** Site-wide 40 (https 10, robots 5, sitemap 10, canonical 5, viewport 5, server-rendered 5) + 60 × mean page score. */
export function seoHealth(site: SiteChecks, pages: PageCheck[]): number | null {
  if (!pages.length) return null;
  const siteWide = (site.https ? 10 : 0) + (site.robotsTxt ? 5 : 0) + (site.sitemap ? 10 : 0) +
    (site.canonical ? 5 : 0) + (site.viewport ? 5 : 0) + (site.serverRendered ? 5 : 0);
  const pagePart = 60 * pages.reduce((sum, p) => sum + pageScore(p), 0) / pages.length;
  return Math.round(clamp(siteWide + pagePart));
}
