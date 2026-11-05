import test from "node:test";
import { strictEqual } from "node:assert/strict";
import { classifyHost } from "./presence.ts";

test("linkedin subdomain is social", () => {
  strictEqual(classifyHost("uk.linkedin.com"), "social");
  strictEqual(classifyHost("www.reddit.com"), "social");
});

test("g2 is a directory", () => {
  strictEqual(classifyHost("g2.com"), "directories");
  strictEqual(classifyHost("www.clutch.co"), "directories");
});

test("news site is a website", () => {
  strictEqual(classifyHost("www.reuters.com"), "websites");
});

test("lookalike hosts are not matched", () => {
  strictEqual(classifyHost("notlinkedin.com"), "websites");
});
