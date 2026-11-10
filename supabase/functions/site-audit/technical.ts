import { htmlToText } from "../_shared/html-text.ts";
import type { FetchedHtml, RobotsResult } from "./types.ts";

export type PageCheck = {
  url: string;
  status: number;
  title: string | null;
  titleLength: number;
  metaDescription: string | null;
  metaDescriptionLength: number;
  h1Count: number;
  canonical: string | null;
  hasViewport: boolean;
  lang: string | null;
  wordCount: number;
  textToHtmlRatio: number;
  jsDependent: boolean;
  hasSchema: boolean;
};

export type SiteChecks = {
  https: boolean;
  robotsTxt: boolean;
  sitemap: boolean;
  canonical: boolean;
  viewport: boolean;
  serverRendered: boolean;
};

function decode(text: string): string {
  return text
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function metaContent(html: string, name: string): string | null {
  const a = html.match(new RegExp(`<meta[^>]+name\\s*=\\s*["']${name}["'][^>]*content\\s*=\\s*["']([^"']*)["']`, "i"));
  const b = html.match(new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*name\\s*=\\s*["']${name}["']`, "i"));
  const value = a?.[1] ?? b?.[1];
  return value === undefined ? null : decode(value);
}

function visibleText(html: string): string {
  return decode(
    html
      .replace(/<head[\s\S]*?<\/head>/gi, " ")
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

/** Per-page SEO checks (ported from the geo-technical skill's checklist). */
export function checkPage(page: FetchedHtml): PageCheck {
  const { html } = page;
  const rawTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const title = rawTitle === undefined ? null : decode(rawTitle) || null;
  const metaDescription = metaContent(html, "description");
  const canonical = html.match(/<link[^>]+rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i)?.[1] ??
    html.match(/<link[^>]+href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["']canonical["']/i)?.[1] ?? null;
  const text = visibleText(html);
  const wordCount = text ? text.split(" ").filter(Boolean).length : 0;
  const scriptCount = (html.match(/<script[^>]+src\s*=/gi) ?? []).length;
  const appRoot = /<div[^>]+id\s*=\s*["'](root|__next|app)["']/i.test(html);
  const jsDependent = htmlToText(html) === null || (wordCount < 50 && (appRoot || scriptCount > 5));
  return {
    url: page.url,
    status: page.status,
    title,
    titleLength: title?.length ?? 0,
    metaDescription,
    metaDescriptionLength: metaDescription?.length ?? 0,
    h1Count: (html.match(/<h1[\s>]/gi) ?? []).length,
    canonical,
    hasViewport: metaContent(html, "viewport") !== null,
    lang: html.match(/<html[^>]+lang\s*=\s*["']([^"']+)["']/i)?.[1] ?? null,
    wordCount,
    textToHtmlRatio: html.length ? Math.round((text.length / html.length) * 1000) / 1000 : 0,
    jsDependent,
    hasSchema: /application\/ld\+json/i.test(html),
  };
}

/** Site-wide checks for the SEO audit. */
export function checkSiteWide(origin: string, homepage: PageCheck | null, robots: RobotsResult, sitemapFound: boolean): SiteChecks {
  return {
    https: origin.startsWith("https://"),
    robotsTxt: robots.exists,
    sitemap: sitemapFound,
    canonical: Boolean(homepage?.canonical),
    viewport: Boolean(homepage?.hasViewport),
    serverRendered: homepage ? !homepage.jsDependent : false,
  };
}
