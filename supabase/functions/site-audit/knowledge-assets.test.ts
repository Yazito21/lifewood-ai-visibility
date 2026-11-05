import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { countKnowledgeAssets, totalAssets } from "./knowledge-assets.ts";

Deno.test("counts assets by path and skips index pages", () => {
  const r = countKnowledgeAssets([
    "https://a.com/blog", "https://a.com/blog/", "https://a.com/blog/post-1", "https://a.com/insights/ai-trends",
    "https://a.com/case-studies/bank", "https://a.com/customers/acme", "https://a.com/whitepaper/geo-2026",
    "https://a.com/guides/start", "https://a.com/faq/billing", "https://a.com/docs/api", "https://a.com/news/launch",
    "https://a.com/about", "https://a.com/blog/post-1",
  ]);
  assertEquals(r, { blog: 2, case_studies: 2, whitepapers: 1, guides: 1, faq: 1, docs: 1, news: 1 });
  assertEquals(totalAssets(r), 9);
});

Deno.test("no urls gives zeros", () => {
  assertEquals(totalAssets(countKnowledgeAssets([])), 0);
});

Deno.test("first matching kind wins", () => {
  assertEquals(countKnowledgeAssets(["https://a.com/blog/guide-to-x"]).blog, 1);
  assertEquals(countKnowledgeAssets(["https://a.com/blog/guide-to-x"]).guides, 0);
});
