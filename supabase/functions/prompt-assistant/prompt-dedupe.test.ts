import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { filterSuggestions } from "./prompt-dedupe.ts";

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
