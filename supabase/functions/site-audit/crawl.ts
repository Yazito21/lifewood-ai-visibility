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

const PER_FETCH_MS = 8_000;

/** Per-fetch timeout: 8 s, or less when the deadline is closer. */
function fetchTimeout(deadline?: number): number {
  return deadline ? Math.max(500, Math.min(PER_FETCH_MS, deadline - Date.now())) : PER_FETCH_MS;
}
const pastDeadline = (deadline?: number) => Boolean(deadline && Date.now() > deadline);

async function fetchText(url: string, accept: string, deps: Deps): Promise<string | null> {
  const page = await fetchPublic(url, { accept, fetch: deps.fetch, timeoutMs: fetchTimeout(deps.deadline) });
  return page.ok ? page.body : null;
}

async function fetchHtml(url: string, deps: Deps): Promise<FetchedHtml | null> {
  const started = Date.now();
  const page = await fetchPublic(url, { accept: "text/html", fetch: deps.fetch, timeoutMs: fetchTimeout(deps.deadline) });
  if (!page.ok || !page.contentType.includes("html")) return null;
  return { url: page.url, status: page.status, html: page.body, ms: Date.now() - started };
}

const CHALLENGE = /cf-chl|challenge-platform|__cf_bm|just a moment\.\.\.|attention required|captcha|access denied|sucuri|incapsula|ddos-guard|are you a robot/i;

/** True when a homepage is a bot challenge or has no readable content and no links. */
export function looksBlocked(html: string): boolean {
  if (CHALLENGE.test(html.slice(0, 20_000))) return true;
  const text = html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ");
  const words = text.split(/\s+/).filter(Boolean).length;
  return words < 30 && !/<a\s[^>]*href/i.test(html);
}

const sameSite = (url: string, origin: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "") === new URL(origin).hostname.replace(/^www\./, "");
  } catch {
    return false;
  }
};

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
  const home = await fetchPublic(origin + "/", { accept: "text/html", fetch: deps.fetch, timeoutMs: PER_FETCH_MS });
  if (!home.ok) {
    return unreachable(origin, home.reason === "http_error" ? `The website returned HTTP ${home.status}.` : FAILURE_TEXT[home.reason]);
  }
  if (!home.contentType.includes("html")) return unreachable(origin, "The website did not return a web page.");
  if (looksBlocked(home.body)) return unreachable(origin, "The website blocks automated visitors (bot protection), so it could not be audited.");
  const homeOrigin = new URL(home.url).origin;
  const homepage: FetchedHtml = { url: home.url, status: home.status, html: home.body, ms: 0 };

  const [robotsText, llmsText] = await Promise.all([
    fetchText(homeOrigin + "/robots.txt", "text/plain", deps),
    fetchText(homeOrigin + "/llms.txt", "text/plain", deps),
  ]);
  // Sitemaps are only read from the site's own host.
  const sitemapSources = [...(robotsText ?? "").matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1]).filter((url) => sameSite(url, homeOrigin));
  if (!sitemapSources.length) sitemapSources.push(homeOrigin + "/sitemap.xml");

  const sitemapUrls: string[] = [];
  const children: string[] = [];
  for (const source of sitemapSources.slice(0, 2)) {
    if (pastDeadline(deps.deadline)) break;
    const xml = await fetchText(source, "application/xml,text/xml", deps);
    if (!xml) continue;
    const parsed = parseSitemap(xml);
    sitemapUrls.push(...parsed.urls);
    children.push(...parsed.childSitemaps);
  }
  for (const child of children.filter((url) => sameSite(url, homeOrigin)).slice(0, MAX_CHILD_SITEMAPS)) {
    if (pastDeadline(deps.deadline)) break;
    const xml = await fetchText(child, "application/xml,text/xml", deps);
    if (xml) sitemapUrls.push(...parseSitemap(xml).urls);
  }

  const targets = pickKeyPages(homepage.url, [...sitemapUrls, ...pageLinks(homepage.html, homepage.url)]);
  const pages: FetchedHtml[] = [];
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    if (pastDeadline(deps.deadline)) break;
    const batch = await Promise.all(targets.slice(i, i + CONCURRENCY).map((url) => fetchHtml(url, deps)));
    pages.push(...batch.filter((page): page is FetchedHtml => page !== null));
  }
  return { origin: homeOrigin, reachable: true, homepage, pages, robotsText, llmsText, sitemapUrls };
}
