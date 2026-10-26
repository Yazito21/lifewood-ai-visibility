import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { rankAgainstEligiblePopulation } from "./rank-population.ts";

Deno.test("excludes competitors with missing observations but keeps valid zero scores", () => {
  assertEquals(rankAgainstEligiblePopulation(3, [5, null, undefined, 0]), { rank: 2, populationCount: 3 });
});

Deno.test("uses competition ranking for ties", () => {
  assertEquals(rankAgainstEligiblePopulation(5, [5, 7, 5, 2]), { rank: 2, populationCount: 5 });
  assertEquals(rankAgainstEligiblePopulation(7, [7, 7, 2]), { rank: 1, populationCount: 4 });
});

Deno.test("population changes with scoped eligible competitor set", () => {
  const dayOne = rankAgainstEligiblePopulation(4, [6, 3, 1]);
  const dayTwo = rankAgainstEligiblePopulation(4, [6, 3, 1, 8, null]);
  assertEquals(dayOne, { rank: 2, populationCount: 4 });
  assertEquals(dayTwo, { rank: 3, populationCount: 5 });
});

Deno.test("returns unavailable for a scope without tracked-brand observations", () => {
  assertEquals(rankAgainstEligiblePopulation(null, [10, 2]), { rank: null, populationCount: 0 });
});
