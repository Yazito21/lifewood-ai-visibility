import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isPublicHttpUrl, readTextCapped } from "./url-guard.ts";

Deno.test("allows public http(s) hosts", () => {
  assertEquals(isPublicHttpUrl("https://lifewood.com"), true);
  assertEquals(isPublicHttpUrl("http://www.example.co.uk/about"), true);
});

Deno.test("rejects internal and non-http targets", () => {
  for (const url of [
    "http://169.254.169.254/latest/meta-data", "http://localhost:54321", "http://127.0.0.1", "http://10.0.0.5",
    "http://192.168.1.1", "http://172.16.0.1", "http://kong:8000", "http://printer.local", "http://db.internal",
    "http://[::1]/", "ftp://lifewood.com", "file:///etc/passwd", "not a url",
  ]) assertEquals(isPublicHttpUrl(url), false, url);
});

Deno.test("readTextCapped stops at the byte cap", async () => {
  const response = new Response("a".repeat(5000));
  const text = await readTextCapped(response, 1000);
  assertEquals(text.length, 1000);
});

Deno.test("readTextCapped returns short bodies whole", async () => {
  assertEquals(await readTextCapped(new Response("hello"), 1000), "hello");
});
