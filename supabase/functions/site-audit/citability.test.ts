import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { scorePageCitability, scorePassage } from "./citability.ts";

const A = "Lifewood is a data annotation company founded in 2004 that serves 40% of Fortune 500 AI teams. According to Gartner, demand for labelled data grew 25% in 2024. The company employs 1,200 people across Malaysia, the Philippines and China. For example, Lifewood annotated 3 million images for an autonomous driving client using Labelbox. Our research shows that accurate labels cut model errors by 30%.";
const B = "We are passionate about what we do. It is our mission to make things better for everyone, and we think that this matters a lot to them.";
const C = "What is generative engine optimization? Generative engine optimization means structuring content so AI assistants such as ChatGPT and Perplexity can quote it. First, answer the question directly. Second, add statistics. Finally, cite sources.";

// Expected values produced by geo-seo-claude scripts/citability_scorer.py score_passage on the same text.
Deno.test("matches the Python scorer on a fact-dense passage", () => {
  assertEquals(scorePassage(A, "About Lifewood"), { total: 78, answerBlock: 30, selfContainment: 14, structure: 12, statistics: 12, uniqueness: 10 });
});

Deno.test("matches the Python scorer on a vague passage", () => {
  assertEquals(scorePassage(B, null), { total: 30, answerBlock: 21, selfContainment: 4, structure: 5, statistics: 0, uniqueness: 0 });
});

Deno.test("matches the Python scorer on a question heading with a list", () => {
  assertEquals(scorePassage(C, "What is GEO?"), { total: 50, answerBlock: 30, selfContainment: 14, structure: 6, statistics: 0, uniqueness: 0 });
});

Deno.test("definition passage with a statistic scores higher than vague text", () => {
  const good = scorePassage(A, null).total;
  const vague = scorePassage(B, null).total;
  assertEquals(good > vague + 15, true);
});

Deno.test("page score averages passages", () => {
  const filler = "This sentence adds enough words to pass the twenty word minimum for a content block in the scorer.";
  const html = `<html><body><nav><p>${filler}</p></nav><h2>About Lifewood</h2><p>${A}</p><h2>Why us</h2><p>${B}</p><p>${filler}</p></body></html>`;
  const r = scorePageCitability(html);
  assertEquals(r.passages, 2);
  const expected = Math.round((scorePassage(A, "About Lifewood").total + scorePassage(`${B} ${filler}`, "Why us").total) / 2);
  assertEquals(r.score, expected);
  assertEquals(r.best[0].heading, "About Lifewood");
  assertEquals(r.worst[0].heading, "Why us");
});

Deno.test("empty page scores 0", () => {
  assertEquals(scorePageCitability("<html><body><p>Short.</p></body></html>"), { score: 0, passages: 0, best: [], worst: [] });
});
