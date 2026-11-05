import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  eeatMessages, fallbackNarrative, narrativeMessages, parseEeat, parseNarrative, PILLAR_KEYS, stripUnknownNumbers,
} from "./narrative.ts";

const full = {
  executiveSummary: { position: ["a", "b", "c"] },
  kpiNotes: { visibility: "v", rank: "r", citations: "c", shareOfVoice: "s" },
  competitorSummary: "cs",
  pillars: Object.fromEntries(PILLAR_KEYS.map((k) => [k, { position: [k + " one", k + " two", k + " three"] }])),
  targetNotes: "t",
};

Deno.test("parses a full narrative", () => {
  const n = parseNarrative(JSON.stringify(full), "");
  assertEquals(n.executiveSummary.position, ["a", "b", "c"]);
  assertEquals(n.kpiNotes.rank, "r");
  assertEquals(n.pillars.monitoring.position, ["monitoring one", "monitoring two", "monitoring three"]);
  assertEquals(n.fallback, undefined);
});

Deno.test("fills missing lists with []", () => {
  const n = parseNarrative('{"competitorSummary":"x"}', "");
  assertEquals(n.executiveSummary.position, []);
  assertEquals(n.pillars.website.position, []);
  assertEquals(n.kpiNotes.visibility, "");
  assertEquals(n.targetNotes, "");
});

Deno.test("ignores extra keys such as initiatives", () => {
  const n = parseNarrative(JSON.stringify({ ...full, pillars: { website: { position: ["p"], initiatives: [{ text: "x" }] } } }), "");
  assertEquals(Object.keys(n.pillars.website), ["position"]);
});

Deno.test("rejects text without JSON", () => {
  assertThrows(() => parseNarrative("sorry", ""), Error, "MODEL_JSON_INVALID");
});

Deno.test("strips sentences with unknown numbers", () => {
  assertEquals(
    stripUnknownNumbers("Your score is 42.5. You could reach 80 soon. Rank 3 of 12.", "score 42.5 rank 3 of 12"),
    "Your score is 42.5. Rank 3 of 12.",
  );
});

Deno.test("allows thousands separators and percentages", () => {
  assertEquals(stripUnknownNumbers("1,200 citations. Share is 35%.", "1200 citations, share 35"), "1,200 citations. Share is 35%.");
});

Deno.test("text without numbers is unchanged", () => {
  assertEquals(stripUnknownNumbers("Strong brand. Weak schema!", ""), "Strong brand. Weak schema!");
});

Deno.test("parseNarrative applies the number guard to every string", () => {
  const n = parseNarrative(JSON.stringify({ ...full, competitorSummary: "You rank 2. Competitors average 99." }), "rank 2");
  assertEquals(n.competitorSummary, "You rank 2.");
});

Deno.test("parseEeat clamps to 25 and rejects missing dimension", () => {
  const e = parseEeat(JSON.stringify({
    experience: { score: 40, evidence: "e" }, expertise: { score: -3, evidence: "x" },
    authoritativeness: { score: 12.4, evidence: "a" }, trustworthiness: { score: "20", evidence: "t" },
  }));
  assertEquals([e.experience.score, e.expertise.score, e.authoritativeness.score, e.trustworthiness.score], [25, 0, 12, 20]);
  assertThrows(() => parseEeat('{"experience":{"score":1,"evidence":""}}'), Error, "MODEL_JSON_INVALID");
});

Deno.test("eeatMessages caps pages and words", () => {
  const pages = Array.from({ length: 8 }, (_, i) => ({ url: `https://a.com/${i}`, text: "word ".repeat(3000) }));
  const user = eeatMessages("A", pages)[1].content;
  assertEquals((user.match(/https:\/\/a\.com\//g) ?? []).length, 5);
  assertEquals(user.split(/\s+/).filter((w) => w === "word").length <= 6000, true);
});

Deno.test("narrativeMessages forbid Prepared by and AEO", () => {
  const system = narrativeMessages({ brand: "A", facts: { score: 1 } })[0].content;
  assertEquals(system.includes("Prepared by"), true);
  assertEquals(system.includes("AI visibility"), true);
  assertEquals(system.includes("only numbers that appear in the input"), true);
});

Deno.test("fallback narrative copies findings into pillars", () => {
  const n = fallbackNarrative({ technical: ["GPTBot is blocked."], citability: ["Few quotable passages."], brand: ["No Wikipedia page."] });
  assertEquals(n.fallback, true);
  assertEquals(n.pillars.website.position.includes("GPTBot is blocked."), true);
  assertEquals(n.pillars.authority.position, ["No Wikipedia page."]);
});
