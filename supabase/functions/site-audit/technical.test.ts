import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkPage, checkSiteWide } from "./technical.ts";
import { parseRobots } from "./crawlers.ts";

const words = (n: number) => Array.from({ length: n }, (_, i) => "word" + i).join(" ");

Deno.test("checkPage reads title, meta description, h1 count, canonical, viewport, lang", () => {
  const html = `<html lang="en"><head><title>Data annotation services | Lifewood</title>
    <meta name="description" content="Lifewood provides data annotation.">
    <meta name="viewport" content="width=device-width">
    <link rel="canonical" href="https://a.com/services">
    <script type="application/ld+json">{"@type":"Service"}</script></head>
    <body><h1>Services</h1><h1>Again</h1><p>${words(320)}</p></body></html>`;
  const r = checkPage({ url: "https://a.com/services", status: 200, html, ms: 10 });
  assertEquals(r.title, "Data annotation services | Lifewood");
  assertEquals(r.titleLength, 35);
  assertEquals(r.metaDescription, "Lifewood provides data annotation.");
  assertEquals(r.h1Count, 2);
  assertEquals(r.canonical, "https://a.com/services");
  assertEquals(r.hasViewport, true);
  assertEquals(r.lang, "en");
  assertEquals(r.wordCount >= 320, true);
  assertEquals(r.hasSchema, true);
  assertEquals(r.jsDependent, false);
});

Deno.test("missing fields are null or zero", () => {
  const r = checkPage({ url: "https://a.com/x", status: 200, html: `<html><body><p>${words(300)}</p></body></html>`, ms: 1 });
  assertEquals(r.title, null);
  assertEquals(r.metaDescription, null);
  assertEquals(r.metaDescriptionLength, 0);
  assertEquals(r.h1Count, 0);
  assertEquals(r.canonical, null);
  assertEquals(r.hasViewport, false);
  assertEquals(r.lang, null);
});

Deno.test("flags JS-only shell", () => {
  const scripts = Array.from({ length: 6 }, (_, i) => `<script src="/a${i}.js"></script>`).join("");
  const r = checkPage({ url: "https://a.com/", status: 200, html: `<html><head><title>App</title></head><body><div id="root"></div>${scripts}</body></html>`, ms: 1 });
  assertEquals(r.jsDependent, true);
});

Deno.test("checkSiteWide http origin fails https", () => {
  const home = checkPage({ url: "http://a.com/", status: 200, html: `<html><head><meta name="viewport" content="x"><link rel="canonical" href="http://a.com/"></head><body>${words(300)}</body></html>`, ms: 1 });
  const r = checkSiteWide("http://a.com", home, parseRobots("User-agent: *\nDisallow:"), true);
  assertEquals(r, { https: false, robotsTxt: true, sitemap: true, canonical: true, viewport: true, serverRendered: true });
});

Deno.test("checkSiteWide without homepage", () => {
  const r = checkSiteWide("https://a.com", null, parseRobots(null), false);
  assertEquals(r, { https: true, robotsTxt: false, sitemap: false, canonical: false, viewport: false, serverRendered: false });
});
