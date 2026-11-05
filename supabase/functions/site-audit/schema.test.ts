import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractSchema, mergeSchema } from "./schema.ts";

const ld = (json: string) => `<script type="application/ld+json">${json}</script>`;

Deno.test("extracts Organization with sameAs from @graph", () => {
  const html = ld(JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", name: "A", sameAs: ["https://www.linkedin.com/company/a", "https://x.com/a"] },
      { "@type": "WebSite", url: "https://a.com" },
    ],
  }));
  const r = extractSchema(html);
  assertEquals(r.hasOrganization, true);
  assertEquals(r.hasWebSite, true);
  assertEquals(r.sameAs.length, 2);
  assertEquals(r.types.includes("WebSite"), true);
  assertEquals(r.blocks, 1);
});

Deno.test("LocalBusiness subtypes count as organization", () => {
  assertEquals(extractSchema(ld('{"@type":"AutomotiveBusiness","name":"B"}')).hasOrganization, true);
});

Deno.test("counts invalid JSON-LD blocks", () => {
  const r = extractSchema(ld('{"@type":"Organization"}') + ld("{not json"));
  assertEquals(r.blocks, 2);
  assertEquals(r.invalidBlocks, 1);
});

Deno.test("no schema", () => {
  assertEquals(extractSchema("<html></html>"), {
    blocks: 0, invalidBlocks: 0, types: [], sameAs: [], hasOrganization: false, hasWebSite: false, contentTypes: [],
  });
});

Deno.test("content types and array @type", () => {
  const r = extractSchema(ld('[{"@type":["Article","NewsArticle"]},{"@type":"FAQPage"},{"@type":"Person"}]'));
  assertEquals(r.contentTypes.sort(), ["Article", "FAQPage"]);
});

Deno.test("mergeSchema unions pages", () => {
  const a = extractSchema(ld('{"@type":"Organization","sameAs":"https://x.com/a"}'));
  const b = extractSchema(ld('{"@type":"Product"}') + ld("{bad"));
  const m = mergeSchema([a, b]);
  assertEquals(m.blocks, 3);
  assertEquals(m.invalidBlocks, 1);
  assertEquals(m.hasOrganization, true);
  assertEquals(m.contentTypes, ["Product"]);
  assertEquals(m.sameAs, ["https://x.com/a"]);
});
