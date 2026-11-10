import { KEY_CRAWLERS } from "./crawlers.ts";
import type { BrandAuthority } from "./brand-authority.ts";
import type { PageCitability } from "./citability.ts";
import type { KnowledgeAssets } from "./knowledge-assets.ts";
import type { SchemaResult } from "./schema.ts";
import type { PageCheck, SiteChecks } from "./technical.ts";
import type { EeatResult, LlmsTxtResult, RobotsResult } from "./types.ts";

export type FindingKey = "citability" | "brand" | "eeat" | "technical" | "schema" | "platform" | "seo";
export type Findings = Record<FindingKey, string[]>;

export type FindingInput = {
  robots: RobotsResult;
  llms: LlmsTxtResult;
  site: SiteChecks;
  pages: PageCheck[];
  citability: PageCitability[];
  schema: SchemaResult;
  brand: BrandAuthority;
  assets: KnowledgeAssets;
  eeat: EeatResult | null;
  byEngine: { engine: string; visibilityScore: number | null }[];
  thirdPartyHosts: number;
};

const list = (items: string[]) => items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

/** 2–3 plain, evidence-backed findings per category, derived only from measured checks. */
export function buildFindings(f: FindingInput): Findings {
  const blocked = KEY_CRAWLERS.filter((name) => f.robots.crawlers[name] === "blocked");
  const partial = KEY_CRAWLERS.filter((name) => f.robots.crawlers[name] === "partial");
  const technical: string[] = [];
  if (blocked.length) technical.push(`${list(blocked)} ${blocked.length === 1 ? "is" : "are"} blocked in robots.txt, so ${blocked.length === 1 ? "that AI crawler cannot" : "those AI crawlers cannot"} read the site.`);
  else if (partial.length) technical.push(`AI crawlers can read most of the site; some sections are disallowed in robots.txt.`);
  else technical.push("All major AI crawlers are allowed to read the site.");
  technical.push(f.llms.exists ? (f.llms.valid ? "An llms.txt file guides AI systems to key pages." : "llms.txt exists but is missing a title, summary or linked sections.") : "No llms.txt file found.");
  if (!f.site.serverRendered) technical.push("Key content depends on JavaScript, which many AI crawlers do not run.");
  else if (!f.site.sitemap) technical.push("No XML sitemap was found.");

  const seo: string[] = [];
  const n = f.pages.length;
  const noMeta = f.pages.filter((p) => !p.metaDescription).length;
  const badH1 = f.pages.filter((p) => p.h1Count !== 1).length;
  const thin = f.pages.filter((p) => p.wordCount < 300).length;
  if (n) {
    if (noMeta) seo.push(`${noMeta} of ${n} pages have no meta description.`);
    if (badH1) seo.push(`${badH1} of ${n} pages do not have exactly one H1 heading.`);
    if (thin) seo.push(`${thin} of ${n} pages have fewer than 300 words.`);
    if (!seo.length) seo.push(`All ${n} audited pages have a meta description, one H1 and substantial text.`);
  }
  if (!f.site.https) seo.push("The site is not served over HTTPS.");

  const citability: string[] = [];
  const scored = f.citability.filter((p) => p.passages > 0);
  if (!scored.length) citability.push("No passages long enough for AI systems to quote were found.");
  else {
    const best = scored.flatMap((p) => p.best).sort((a, b) => b.score - a.score)[0];
    if (best) citability.push(`The most quotable passage is under "${best.heading ?? "Introduction"}".`);
    const weak = scored.filter((p) => p.score < 40).length;
    if (weak) citability.push(`${weak} of ${scored.length} pages have mostly vague passages with few facts or figures.`);
  }

  const brand: string[] = [];
  brand.push(f.brand.wikipedia.found ? "The brand has a Wikipedia article." : "No Wikipedia article was found for the brand.");
  const profiles = Object.entries(f.brand.social).filter(([, url]) => url).map(([name]) => name);
  brand.push(profiles.length ? `Social profiles linked from the site: ${list(profiles.map((p) => p === "x" ? "X" : p[0].toUpperCase() + p.slice(1)))}.` : "The site does not link to any social profiles.");
  if (f.thirdPartyHosts) brand.push(`${f.thirdPartyHosts} third-party websites were cited alongside AI answers in this period.`);

  const schema: string[] = [];
  if (!f.schema.blocks) schema.push("No structured data (JSON-LD) was found.");
  else {
    schema.push(f.schema.hasOrganization ? "Organization markup is present." : "Organization markup is missing.");
    if (f.schema.invalidBlocks) schema.push(`${f.schema.invalidBlocks} structured-data blocks contain invalid JSON.`);
    if (f.schema.sameAs.length < 2) schema.push("Organization markup links to fewer than two external profiles (sameAs).");
  }

  const eeat: string[] = [];
  if (f.eeat) {
    const dims = Object.entries(f.eeat) as [string, { score: number; evidence: string }][];
    const weakest = [...dims].sort((a, b) => a[1].score - b[1].score)[0];
    const strongest = [...dims].sort((a, b) => b[1].score - a[1].score)[0];
    eeat.push(`Strongest signal: ${strongest[0]}${strongest[1].evidence ? ` (${strongest[1].evidence})` : ""}.`);
    eeat.push(`Weakest signal: ${weakest[0]}${weakest[1].evidence ? ` (${weakest[1].evidence})` : ""}.`);
  }
  const assetTotal = Object.values(f.assets).reduce((a, b) => a + b, 0);
  eeat.push(assetTotal ? `${assetTotal} resource pages (blog, case studies, guides and similar) were found in the sitemap.` : "No resource pages such as blog posts, case studies or guides were found in the sitemap.");

  const platform: string[] = [];
  const engines = f.byEngine.filter((e) => e.visibilityScore !== null);
  if (!engines.length) platform.push("No AI visibility tracking data for this period.");
  else {
    const top = [...engines].sort((a, b) => (b.visibilityScore ?? 0) - (a.visibilityScore ?? 0));
    platform.push(`Highest AI visibility on ${top[0].engine}.`);
    if (top.length > 1) platform.push(`Lowest AI visibility on ${top.at(-1)!.engine}.`);
  }

  return { technical, seo, citability, brand, schema, eeat, platform };
}
