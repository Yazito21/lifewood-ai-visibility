import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildCitationOccurrenceRows, canonicalCitationUrl } from "./citation-occurrences.ts";

Deno.test("citation occurrence unit is one canonical URL per response and entity", () => {
  const responses = [
    { response_id: "r1", project_id: "p", topic: "Skin", metric_date: "2026-10-26", provider: "chatgpt", tracking_location: "MY", run_id: "run", citations: [
      { url: "https://www.brand.test/page?utm_source=one#part" },
      { url: "https://brand.test/page" },
      { url: "https://competitor.test/article" },
    ] },
    { response_id: "r2", project_id: "p", topic: "Skin", metric_date: "2026-10-26", provider: "chatgpt", tracking_location: "MY", run_id: "run", citations: [
      { url: "https://brand.test/page" },
    ] },
    { response_id: "r3", project_id: "p", topic: "Mind", metric_date: "2026-10-26", provider: "gemini", tracking_location: "MY", run_id: "run2", citations: [
      { url: "https://brand.test/page" },
    ] },
  ];
  const rows = buildCitationOccurrenceRows(responses, new Map([
    ["Skin", [{ id: "competitor", websites: ["competitor.test"] }]],
    ["Mind", []],
  ]), "tracked", ["brand.test"]);
  assertEquals(rows.length, 4);
  assertEquals(rows.filter(row => row.entity_id === "tracked").length, 3);
  assertEquals(rows.filter(row => row.entity_id === "competitor").length, 1);
  assertEquals(rows.filter(row => row.canonical_url === "https://brand.test/page").length, 3);
  assertEquals(rows.find(row => row.canonical_domain === "competitor.test")?.topic, "Skin");
});

Deno.test("canonical URL normalizes tracking parameters, fragment, www and protocol", () => {
  assertEquals(canonicalCitationUrl("http://www.example.test/a/?utm_campaign=x#section"), "https://example.test/a");
});
