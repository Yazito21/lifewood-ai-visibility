import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { filterSuggestions, sanitizeExclude } from "./prompt-dedupe.ts";

const brandTerms = ["Lifewood", "lifewood.com"];

Deno.test("drops a suggestion that repeats an existing prompt", () => {
  const result = filterSuggestions(["best data annotation companies"], ["Best data annotation companies?"], { mode: "discovery", brandTerms, limit: 5 });
  assertEquals(result, []);
});

Deno.test("drops duplicates within the batch", () => {
  const result = filterSuggestions(["Top AI data vendors", "top AI data vendors!"], [], { mode: "discovery", brandTerms, limit: 5 });
  assertEquals(result, ["Top AI data vendors"]);
});

Deno.test("discovery mode drops prompts naming the brand", () => {
  const result = filterSuggestions(["Is Lifewood good?", "Who reviews lifewood.com?", "Best data partners?"], [], { mode: "discovery", brandTerms, limit: 5 });
  assertEquals(result, ["Best data partners?"]);
});

Deno.test("brand mode keeps prompts naming the brand", () => {
  const result = filterSuggestions(["Is Lifewood good?"], [], { mode: "brand", brandTerms, limit: 5 });
  assertEquals(result, ["Is Lifewood good?"]);
});

Deno.test("returns at most the limit", () => {
  const result = filterSuggestions(["a one", "b two", "c three", "d four"], [], { mode: "discovery", brandTerms, limit: 2 });
  assertEquals(result.length, 2);
});

Deno.test("discovery mode drops brand names inside CJK text", () => {
  const result = filterSuggestions(["Lifewood的数据标注服务怎么样？", "数据标注公司推荐"], [], { mode: "discovery", brandTerms, limit: 5 });
  assertEquals(result, ["数据标注公司推荐"]);
});

Deno.test("a subdomain does not turn into a brand needle", () => {
  const result = filterSuggestions(["Best data annotation vendors?"], [], { mode: "discovery", brandTerms: ["Lifewood", "data.lifewood.com"], limit: 5 });
  assertEquals(result, ["Best data annotation vendors?"]);
});

Deno.test("short brand names are still filtered", () => {
  const result = filterSuggestions(["Is HP a good laptop brand?", "Best laptops for students?"], [], { mode: "discovery", brandTerms: ["HP"], limit: 5 });
  assertEquals(result, ["Best laptops for students?"]);
});

Deno.test("brand name does not match inside a longer word", () => {
  const result = filterSuggestions(["Which helpdesk tools are best?", "Does Help support small teams?"], [], { mode: "discovery", brandTerms: ["Help"], limit: 5 });
  assertEquals(result, ["Which helpdesk tools are best?"]);
});

Deno.test("sanitizeExclude keeps a bounded list of strings", () => {
  const result = sanitizeExclude(["a", 3, "", "x".repeat(400), ...Array.from({ length: 60 }, (_, i) => "p" + i)]);
  assertEquals(result[0], "a");
  assertEquals(result.length, 40);
  assertEquals(result.every((item) => item.length <= 300), true);
});
