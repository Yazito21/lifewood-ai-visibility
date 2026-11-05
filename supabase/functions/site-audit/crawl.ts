import { fetchPublic } from "../_shared/safe-fetch.ts";
import type { CrawlResult, FetchedHtml } from "./types.ts";

type Deps = { fetch?: typeof fetch; deadline?: number };

const KEY_PATTERNS = [
  /about/, /services|solutions|products/, /pricing|plans/, /case-stud|customers|portfolio/,
  /blog|insights|resources|news/, /faq/, /contact/,
];
const ASSET = /\.(pdf|jpe?g|png|gif|svg|webp|xml|zip|mp4|css|js)$/i;
const MAX_CHILD_SITEMAPS = 3;
const CONCURRENCY = 4;

export function parseSitemap(xml: string): { urls: string[]; childSitemaps: string[] } {
  const locs = (block: string) => [...block.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => m[1].trim());
  const urls = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)].flatMap((m) => locs(m[1]));
  const childSitemaps = [...xml.matchAll(/<sitemap>([\s\S]*?)<\/sitemap>/gi)].flatMap((m) => locs(m[1]));
  return { urls, childSitemaps };
}

function normalise(url: string): string | null {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

/** Up to `max` same-host pages, key sections first (about, services, pricing, ...), then shortest paths. */
export function pickKeyPages(homepageUrl: string, candidates: string[], max = 10): string[] {
  const home = new URL(homepageUrl);
  const host = home.hostname.replace(/^www\./, "");
  const homeKey = home.origin + "/";
  const seen = new Set<string>();
  const pool: string[] = [];
  for (const candidate of candidates) {
    const url = normalise(candidate);
    if (!url) continue;
    const parsed = new URL(url);
    if (parsed.hostname.replace(/^www\./, "") !== host || parsed.search || ASSET.test(parsed.pathname)) continue;
    if (parsed.origin + parsed.pathname === homeKey || seen.has(url)) continue;
    seen.add(url);
    pool.push(url);
  }
  const picked: string[] = [];
  for (const pattern of KEY_PATTERNS) {
    const match = pool
      .filter((url) => !picked.includes(url) && pattern.test(new URL(url).pathname.toLowerCase()))
      .sort((a, b) => a.length - b.length)[0];
    if (match && picked.length < max) picked.push(match);
  }
  const rest = pool.filter((url) => !picked.includes(url)).sort((a, b) => a.length - b.length || a.localeCompare(b));
  return [...picked, ...rest].slice(0, max);
}

function originFor(domain: string): string {
  const withScheme = /^https?:\/\//i.test(domain) ? domain : "https://" + domain.replace(/^\/+/, "");
  return new URL(withScheme).origin;
}

async function fetchText(url: string, accept: string, doFetch?: typeof fetch): Promise<string | null> {
  const page = await fetchPublic(url, { accept, fetch: doFetch });
  return page.ok ? page.body : null;
}

async function fetchHtml(url: string, doFetch?: typeof fetch): Promise<FetchedHtml | null> {
  const started = Date.now();
  const page = await fetchPublic(url, { accept: "text/html", fetch: doFetch });
  if (!page.ok || !page.contentType.includes("html")) return null;
  return { url: page.url, status: page.status, html: page.body, ms: Date.now() - started };
}

export function pageLinks(html: string, base: string): string[] {
  const out: string[] = [];
  for (const match of html.matchAll(/<a\s[^>]*href\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      out.push(new URL(match[1], base).toString());
    } catch {
      // ignore malformed links
    }
  }
  return out;
}

const FAILURE_TEXT: Record<string, string> = {
  unsafe_url: "The website address is not a public site.",
  timeout: "The website did not respond within 8 seconds.",
  network: "The website could not be reached.",
  too_many_redirects: "The website redirected too many times.",
};

function unreachable(origin: string, error: string): CrawlResult {
  return { origin, reachable: false, error, homepage: null, pages: [], robotsText: null, llmsText: null, sitemapUrls: [] };
}

/** Homepage, robots.txt, llms.txt, sitemap(s) and up to 10 key pages of a website. */
export async function crawlSite(domain: string, deps: Deps = {}): Promise<CrawlResult> {
  let origin: string;
  try {
    origin = originFor(domain);
  } catch {
    return unreachable(domain, "The website address is not valid.");
  }
  const home = await fetchPublic(origin + "/", { accept: "text/html", fetch: deps.fetch });
  if (!home.ok) {
    return unreachable(origin, home.reason === "http_error" ? `The website returned HTTP ${home.status}.` : FAILURE_TEXT[home.reason]);
  }
  const homeOrigin = new URL(home.url).origin;
  const homepage: FetchedHtml = { url: home.url, status: home.status, html: home.body, ms: 0 };

  const [robotsText, llmsText] = await Promise.all([
    fetchText(homeOrigin + "/robots.txt", "text/plain", deps.fetch),
    fetchText(homeOrigin + "/llms.txt", "text/plain", deps.fetch),
  ]);
  const sitemapSources = [...(robotsText ?? "").matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1]);
  if (!sitemapSources.length) sitemapSources.push(homeOrigin + "/sitemap.xml");

  const sitemapUrls: string[] = [];
  const children: string[] = [];
  for (const source of sitemapSources.slice(0, 2)) {
    const xml = await fetchText(source, "application/xml,text/xml", deps.fetch);
    if (!xml) continue;
    const parsed = parseSitemap(xml);
    sitemapUrls.push(...parsed.urls);
    children.push(...parsed.childSitemaps);
  }
  for (const child of children.slice(0, MAX_CHILD_SITEMAPS)) {
    if (deps.deadline && Date.now() > deps.deadline) break;
    const xml = await fetchText(child, "application/xml,text/xml", deps.fetch);
    if (xml) sitemapUrls.push(...parseSitemap(xml).urls);
  }

  const targets = pickKeyPages(homepage.url, [...sitemapUrls, ...pageLinks(homepage.html, homepage.url)]);
  const pages: FetchedHtml[] = [];
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    if (deps.deadline && Date.now() > deps.deadline) break;
    const batch = await Promise.all(targets.slice(i, i + CONCURRENCY).map((url) => fetchHtml(url, deps.fetch)));
    pages.push(...batch.filter((page): page is FetchedHtml => page !== null));
  }
  return { origin: homeOrigin, reachable: true, homepage, pages, robotsText, llmsText, sitemapUrls };
}
