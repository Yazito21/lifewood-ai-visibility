import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  brandScore, citabilityScore, eeatScore, GEO_WEIGHTS, geoScore, platformScore, rating, schemaScore, seoHealth, technicalScore,
} from "./scoring.ts";
import { parseRobots } from "./crawlers.ts";
import { analyzeLlmsTxt } from "./llms-txt.ts";
import { extractSchema } from "./schema.ts";
import type { PageCheck, SiteChecks } from "./technical.ts";

const allSite: SiteChecks = { https: true, robotsTxt: true, sitemap: true, canonical: true, viewport: true, serverRendered: true };
const goodPage: PageCheck = {
  url: "https://a.com/x", status: 200, title: "A good page title for search engines", titleLength: 36,
  metaDescription: "m".repeat(120), metaDescriptionLength: 120, h1Count: 1, canonical: "https://a.com/x", hasViewport: true,
  lang: "en", wordCount: 500, textToHtmlRatio: 0.3, jsDependent: false, hasSchema: true,
};

Deno.test("weights sum to 100", () => {
  assertEquals(Object.values(GEO_WEIGHTS).reduce((a, b) => a + b, 0), 100);
});

Deno.test("geoScore all 100", () => {
  assertEquals(geoScore({ citability: 100, brand: 100, eeat: 100, technical: 100, schema: 100, platform: 100 }), 100);
});

Deno.test("geoScore mixed", () => {
  assertEquals(geoScore({ citability: 80, brand: 50, eeat: 60, technical: 90, schema: 40, platform: 30 }), 63);
});

Deno.test("renormalises when a category is missing", () => {
  assertEquals(geoScore({ citability: 80, brand: 50, eeat: 60, technical: 90, schema: 40, platform: null }), 66);
});

Deno.test("geoScore all missing is null", () => {
  assertEquals(geoScore({ citability: null, brand: null, eeat: null, technical: null, schema: null, platform: null }), null);
});

Deno.test("rating bands", () => {
  assertEquals([90, 89, 75, 74, 60, 59, 40, 39, 0].map(rating), ["Excellent", "Good", "Good", "Fair", "Fair", "Poor", "Poor", "Critical", "Critical"]);
});

Deno.test("technicalScore all crawlers blocked, no llms.txt", () => {
  assertEquals(technicalScore(parseRobots("User-agent: *\nDisallow: /"), analyzeLlmsTxt(null), allSite), 40);
});

Deno.test("technicalScore everything right", () => {
  const llms = analyzeLlmsTxt("# A\n> s\n## S\n- [x](https://a.com/x)");
  assertEquals(technicalScore(parseRobots(null), llms, allSite), 100);
});

Deno.test("technicalScore partial access counts half", () => {
  // 6 key crawlers partial → 20 of 40
  assertEquals(technicalScore(parseRobots("User-agent: *\nDisallow: /private"), analyzeLlmsTxt(null), allSite), 60);
});

Deno.test("schemaScore with nothing", () => {
  assertEquals(schemaScore(extractSchema("")), 0);
});

Deno.test("schemaScore full", () => {
  const html = `<script type="application/ld+json">${JSON.stringify({ "@graph": [
    { "@type": "Organization", sameAs: ["https://linkedin.com/company/a", "https://x.com/a"] },
    { "@type": "WebSite" }, { "@type": "Article" }, { "@type": "FAQPage" }, { "@type": "Product" }, { "@type": "BreadcrumbList" },
  ] })}</script>`;
  assertEquals(schemaScore(extractSchema(html)), 100);
});

Deno.test("brandScore", () => {
  const none = { linkedin: null, youtube: null, x: null, facebook: null, instagram: null, tiktok: null, github: null };
  assertEquals(brandScore({ wikipedia: { found: false, title: null, url: null }, wikidata: { found: false, id: null }, social: none }, 0), 0);
  const all = { ...none, linkedin: "l", youtube: "y", x: "x", facebook: "f", instagram: "i" };
  assertEquals(brandScore({ wikipedia: { found: true, title: "A", url: "u" }, wikidata: { found: true, id: "Q" }, social: all }, 20), 100);
  assertEquals(brandScore({ wikipedia: { found: false, title: null, url: null }, wikidata: { found: false, id: null }, social: none }, 4), 6);
});

Deno.test("citability, eeat and platform scores", () => {
  assertEquals(citabilityScore([]), null);
  assertEquals(citabilityScore([{ score: 40, passages: 1, best: [], worst: [] }, { score: 61, passages: 1, best: [], worst: [] }]), 51);
  assertEquals(eeatScore(null), null);
  assertEquals(eeatScore({
    experience: { score: 10, evidence: "" }, expertise: { score: 20, evidence: "" },
    authoritativeness: { score: 5, evidence: "" }, trustworthiness: { score: 25, evidence: "" },
  }), 60);
  assertEquals(platformScore([{ visibilityScore: null }]), null);
  assertEquals(platformScore([{ visibilityScore: 20 }, { visibilityScore: 140 }, { visibilityScore: null }]), 60);
});

Deno.test("seoHealth perfect site", () => {
  assertEquals(seoHealth(allSite, [goodPage]), 100);
});

Deno.test("seoHealth no pages is null", () => {
  assertEquals(seoHealth(allSite, []), null);
});

Deno.test("seoHealth half page checks", () => {
  const weak: PageCheck = { ...goodPage, title: null, titleLength: 0, metaDescription: null, metaDescriptionLength: 0, h1Count: 0 };
  // site 40 + 60 * (3/6) = 70
  assertEquals(seoHealth(allSite, [weak]), 70);
});

Deno.test("platform alone gives no GEO score", () => {
  assertEquals(geoScore({ citability: null, brand: null, eeat: null, technical: null, schema: null, platform: 30 }), null);
});
