import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { crawlSite, parseSitemap, pickKeyPages } from "./crawl.ts";

Deno.test("parses urlset and sitemapindex", () => {
  assertEquals(parseSitemap("<urlset><url><loc>https://a.com/</loc></url><url><loc> https://a.com/about </loc></url></urlset>"),
    { urls: ["https://a.com/", "https://a.com/about"], childSitemaps: [] });
  assertEquals(parseSitemap("<sitemapindex><sitemap><loc>https://a.com/s1.xml</loc></sitemap></sitemapindex>"),
    { urls: [], childSitemaps: ["https://a.com/s1.xml"] });
});

Deno.test("pickKeyPages prefers about/services/pricing and skips other hosts and assets", () => {
  const picked = pickKeyPages("https://a.com/", [
    "https://other.com/about", "https://a.com/logo.png", "https://a.com/blog/post-1", "https://a.com/services",
    "https://a.com/about-us", "https://a.com/?p=1", "https://a.com/pricing", "https://a.com/", "https://a.com/services",
  ]);
  assertEquals(picked.slice(0, 3), ["https://a.com/about-us", "https://a.com/services", "https://a.com/pricing"]);
  assertEquals(picked.includes("https://a.com/blog/post-1"), true);
  assertEquals(picked.some((u) => u.includes("other.com") || u.endsWith(".png") || u.includes("?") || u === "https://a.com/"), false);
});

Deno.test("pickKeyPages caps at max", () => {
  const urls = Array.from({ length: 30 }, (_, i) => `https://a.com/page-${i}`);
  assertEquals(pickKeyPages("https://a.com/", urls, 10).length, 10);
});

Deno.test("crawlSite marks unreachable homepage", async () => {
  const result = await crawlSite("a.com", { fetch: (() => Promise.reject(new TypeError("down"))) as typeof fetch });
  assertEquals(result.reachable, false);
  assertEquals(typeof result.error, "string");
  assertEquals(result.pages, []);
});

Deno.test("crawlSite fetches robots, llms.txt, sitemap and key pages", async () => {
  const site: Record<string, { body: string; type: string }> = {
    "https://a.com/": { body: '<html><title>A</title><a href="/contact">c</a></html>', type: "text/html" },
    "https://a.com/robots.txt": { body: "User-agent: *\nDisallow:\nSitemap: https://a.com/sitemap.xml", type: "text/plain" },
    "https://a.com/llms.txt": { body: "# A\n> s\n## S\n- [x](https://a.com/x)", type: "text/plain" },
    "https://a.com/sitemap.xml": { body: "<urlset><url><loc>https://a.com/about</loc></url></urlset>", type: "application/xml" },
    "https://a.com/about": { body: "<html>about</html>", type: "text/html" },
    "https://a.com/contact": { body: "<html>contact</html>", type: "text/html" },
  };
  const fake = ((input: string | URL | Request) => {
    const page = site[String(input)];
    return Promise.resolve(page ? new Response(page.body, { status: 200, headers: { "content-type": page.type } }) : new Response("no", { status: 404 }));
  }) as typeof fetch;
  const result = await crawlSite("https://a.com", { fetch: fake });
  assertEquals(result.reachable, true);
  assertEquals(result.origin, "https://a.com");
  assertEquals(result.robotsText?.includes("Sitemap"), true);
  assertEquals(result.llmsText?.startsWith("# A"), true);
  assertEquals(result.sitemapUrls, ["https://a.com/about"]);
  assertEquals(result.pages.map((p) => p.url).sort(), ["https://a.com/about", "https://a.com/contact"]);
});
