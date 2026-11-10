import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { analyzeLlmsTxt } from "./llms-txt.ts";

Deno.test("valid llms.txt", () => {
  const r = analyzeLlmsTxt("# Lifewood\n\n> Data and AI services.\n\n## Services\n- [Annotation](https://lifewood.com/annotation): labelling\n- [AI data](https://lifewood.com/data)\n\n## About\n- [Company](https://lifewood.com/about)");
  assertEquals(r, { exists: true, hasTitle: true, hasSummary: true, sectionCount: 2, linkCount: 3, valid: true });
});

Deno.test("missing llms.txt", () => {
  assertEquals(analyzeLlmsTxt(null), { exists: false, hasTitle: false, hasSummary: false, sectionCount: 0, linkCount: 0, valid: false });
});

Deno.test("llms.txt without links is invalid", () => {
  const r = analyzeLlmsTxt("# Brand\n> Summary\n## Section\nJust text.");
  assertEquals(r.valid, false);
  assertEquals(r.sectionCount, 1);
});

Deno.test("an HTML page served at /llms.txt does not count", () => {
  assertEquals(analyzeLlmsTxt("<!doctype html><html><body>Not found</body></html>").exists, false);
});
