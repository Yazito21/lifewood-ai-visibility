import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AI_CRAWLERS, parseRobots } from "./crawlers.ts";

Deno.test("blocks GPTBot but allows others", () => {
  const r = parseRobots("User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /");
  assertEquals(r.exists, true);
  assertEquals(r.crawlers.GPTBot, "blocked");
  assertEquals(r.crawlers.ClaudeBot, "allowed");
});

Deno.test("wildcard disallow-all blocks every crawler", () => {
  const r = parseRobots("User-agent: *\nDisallow: /");
  for (const name of AI_CRAWLERS) assertEquals(r.crawlers[name], "blocked");
});

Deno.test("partial disallow", () => {
  assertEquals(parseRobots("User-agent: *\nDisallow: /private").crawlers.PerplexityBot, "partial");
});

Deno.test("empty disallow allows", () => {
  assertEquals(parseRobots("User-agent: *\nDisallow:").crawlers.GPTBot, "allowed");
});

Deno.test("group with several user agents applies to each", () => {
  const r = parseRobots("User-agent: ClaudeBot\nUser-agent: CCBot\nDisallow: /\n\nUser-agent: *\nDisallow:");
  assertEquals(r.crawlers.ClaudeBot, "blocked");
  assertEquals(r.crawlers.CCBot, "blocked");
  assertEquals(r.crawlers.GPTBot, "allowed");
});

Deno.test("user agent match ignores case", () => {
  assertEquals(parseRobots("user-agent: gptbot\ndisallow: /").crawlers.GPTBot, "blocked");
});

Deno.test("missing robots allows all", () => {
  const r = parseRobots(null);
  assertEquals(r.exists, false);
  for (const name of AI_CRAWLERS) assertEquals(r.crawlers[name], "allowed");
});

Deno.test("collects Sitemap lines", () => {
  const r = parseRobots("Sitemap: https://example.com/sitemap.xml\nUser-agent: *\nDisallow:\nsitemap: https://example.com/news.xml");
  assertEquals(r.sitemaps, ["https://example.com/sitemap.xml", "https://example.com/news.xml"]);
});
