import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractJson, parseProfile, parseSuggestions } from "./llm-json.ts";

Deno.test("extractJson reads plain JSON", () => {
  assertEquals(extractJson('{"a":1}'), { a: 1 });
});

Deno.test("extractJson reads a fenced block", () => {
  assertEquals(extractJson('```json\n{"a":1}\n```'), { a: 1 });
});

Deno.test("extractJson reads JSON surrounded by prose", () => {
  assertEquals(extractJson('Sure! {"a":1} hope this helps'), { a: 1 });
});

Deno.test("extractJson rejects text without JSON", () => {
  assertThrows(() => extractJson("no json"), Error, "MODEL_JSON_INVALID");
});

Deno.test("parseProfile requires a summary", () => {
  assertThrows(() => parseProfile('{"offerings":["a"]}'), Error, "MODEL_JSON_INVALID");
});

Deno.test("parseProfile keeps only non-empty strings in lists", () => {
  const profile = parseProfile('{"summary":"Data partner","offerings":["a","",3]}');
  assertEquals(profile.offerings, ["a"]);
  assertEquals(profile.audiences, []);
});

Deno.test("parseSuggestions trims and drops empty prompts", () => {
  assertEquals(parseSuggestions('{"prompts":[" best x? ",""]}'), ["best x?"]);
});

Deno.test("parseSuggestions rejects a reply without prompts", () => {
  assertThrows(() => parseSuggestions('{"items":[]}'), Error, "MODEL_JSON_INVALID");
});
