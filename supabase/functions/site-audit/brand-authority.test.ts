import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { findSocialProfiles, lookupWikidata, lookupWikipedia, manualCheckLinks } from "./brand-authority.ts";

function jsonFetch(body: unknown): typeof fetch {
  return (() => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }))) as typeof fetch;
}

Deno.test("finds LinkedIn from sameAs and YouTube from footer link", () => {
  const html = '<footer><a href="https://www.youtube.com/@lifewood">YT</a><a href="https://example.com">x</a></footer>';
  const r = findSocialProfiles(html, ["https://www.linkedin.com/company/lifewood"]);
  assertEquals(r.linkedin, "https://www.linkedin.com/company/lifewood");
  assertEquals(r.youtube, "https://www.youtube.com/@lifewood");
  assertEquals(r.x, null);
});

Deno.test("share links are not profiles", () => {
  const r = findSocialProfiles('<a href="https://www.linkedin.com/sharing/share-offsite/?url=x">share</a><a href="https://twitter.com/intent/tweet?text=x">t</a>', []);
  assertEquals(r.linkedin, null);
  assertEquals(r.x, null);
});

Deno.test("wikipedia exact title match", async () => {
  const r = await lookupWikipedia("Lifewood", { fetch: jsonFetch({ query: { search: [{ title: "Lifewood" }, { title: "Life" }] } }) });
  assertEquals(r, { found: true, title: "Lifewood", url: "https://en.wikipedia.org/wiki/Lifewood" });
});

Deno.test("wikipedia disambiguated title counts", async () => {
  const r = await lookupWikipedia("Acme", { fetch: jsonFetch({ query: { search: [{ title: "Acme (company)" }] } }) });
  assertEquals(r.found, true);
  assertEquals(r.url, "https://en.wikipedia.org/wiki/Acme_(company)");
});

Deno.test("wikipedia unrelated result is not found", async () => {
  const r = await lookupWikipedia("Lifewood", { fetch: jsonFetch({ query: { search: [{ title: "Wood" }] } }) });
  assertEquals(r, { found: false, title: null, url: null });
});

Deno.test("wikipedia network failure is not found", async () => {
  const r = await lookupWikipedia("Lifewood", { fetch: (() => Promise.reject(new TypeError("x"))) as typeof fetch });
  assertEquals(r.found, false);
});

Deno.test("wikidata exact label", async () => {
  const r = await lookupWikidata("Lifewood", { fetch: jsonFetch({ search: [{ id: "Q1", label: "lifewood" }] }) });
  assertEquals(r, { found: true, id: "Q1" });
  const miss = await lookupWikidata("Lifewood", { fetch: jsonFetch({ search: [{ id: "Q2", label: "Lifewood Ltd fan club" }] }) });
  assertEquals(miss, { found: false, id: null });
});

Deno.test("manual links encode the brand", () => {
  const links = manualCheckLinks("Lifewood & Co");
  assertEquals(links.map((l) => l.platform), ["Reddit", "YouTube", "LinkedIn", "G2", "Trustpilot", "Crunchbase"]);
  assertEquals(links[0].url, "https://www.reddit.com/search/?q=Lifewood+%26+Co");
});
