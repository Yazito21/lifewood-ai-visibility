import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { htmlToText } from "./html-text.ts";

const filler = "We help teams collect and annotate training data across many languages. ".repeat(5);

Deno.test("strips scripts and tags", () => {
  const text = htmlToText(`<html><body><script>alert(1)</script><p>Hello&nbsp;&amp; world</p><p>${filler}</p></body></html>`);
  assert(text !== null);
  assert(text.includes("Hello & world"));
  assert(!text.includes("alert"));
});

Deno.test("title and meta description come first", () => {
  const text = htmlToText(`<html><head><title>Acme</title><meta name="description" content="Data partner"></head><body><p>${filler}</p></body></html>`);
  assert(text !== null);
  assert(text.startsWith("Acme. Data partner."), text.slice(0, 40));
});

Deno.test("truncates to budget", () => {
  const text = htmlToText(`<p>${"word ".repeat(2000)}</p>`, 4000);
  assert(text !== null);
  assert(text.length <= 4000);
});

Deno.test("returns null for near-empty shells", () => {
  assertEquals(htmlToText(`<html><body><div id="root"></div><script src="x.js"></script></body></html>`), null);
});
