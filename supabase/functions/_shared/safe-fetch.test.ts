import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fetchPublic } from "./safe-fetch.ts";

type Reply = { status: number; headers?: Record<string, string>; body?: string };

function fakeFetch(replies: Record<string, Reply | Error>): typeof fetch {
  return ((input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const reply = replies[url];
    if (!reply) return Promise.reject(new Error("unexpected " + url));
    if (reply instanceof Error) return Promise.reject(reply);
    return Promise.resolve(new Response(reply.body ?? "", { status: reply.status, headers: reply.headers }));
  }) as typeof fetch;
}

Deno.test("follows a redirect and re-checks the target", async () => {
  const result = await fetchPublic("https://example.com/a", {
    accept: "text/html",
    fetch: fakeFetch({
      "https://example.com/a": { status: 301, headers: { location: "https://example.com/b" } },
      "https://example.com/b": { status: 200, headers: { "content-type": "text/html" }, body: "<p>hi</p>" },
    }),
  });
  assertEquals(result.ok, true);
  assertEquals(result.url, "https://example.com/b");
  assertEquals(result.status, 200);
  if (result.ok) assertEquals(result.body, "<p>hi</p>");
});

Deno.test("rejects redirect to internal host", async () => {
  const result = await fetchPublic("https://example.com/a", {
    accept: "text/html",
    fetch: fakeFetch({ "https://example.com/a": { status: 302, headers: { location: "http://localhost/" } } }),
  });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "unsafe_url");
});

Deno.test("rejects an unsafe starting URL without fetching", async () => {
  const result = await fetchPublic("http://10.0.0.1/", { accept: "text/html", fetch: fakeFetch({}) });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "unsafe_url");
});

Deno.test("stops after 3 redirects", async () => {
  const replies: Record<string, Reply> = {};
  for (let i = 0; i < 5; i++) replies[`https://example.com/${i}`] = { status: 302, headers: { location: `https://example.com/${i + 1}` } };
  const result = await fetchPublic("https://example.com/0", { accept: "text/html", fetch: fakeFetch(replies) });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "too_many_redirects");
});

Deno.test("reports http errors", async () => {
  const result = await fetchPublic("https://example.com/missing", {
    accept: "text/html",
    fetch: fakeFetch({ "https://example.com/missing": { status: 404, body: "nope" } }),
  });
  assertEquals(result.ok, false);
  assertEquals(result.status, 404);
  if (!result.ok) assertEquals(result.reason, "http_error");
});

Deno.test("reports network failures", async () => {
  const result = await fetchPublic("https://example.com/", {
    accept: "text/html",
    fetch: fakeFetch({ "https://example.com/": new TypeError("connection refused") }),
  });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "network");
});

Deno.test("caps the body", async () => {
  const result = await fetchPublic("https://example.com/big", {
    accept: "text/html",
    maxBytes: 1000,
    fetch: fakeFetch({ "https://example.com/big": { status: 200, body: "x".repeat(2_000_000) } }),
  });
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.body.length, 1000);
});
