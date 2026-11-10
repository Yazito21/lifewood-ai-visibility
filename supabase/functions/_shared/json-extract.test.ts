import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractJson } from "./json-extract.ts";

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

