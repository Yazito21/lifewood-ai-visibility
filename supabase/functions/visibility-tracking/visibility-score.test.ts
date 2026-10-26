import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { calculateEntityVisibility } from "./visibility-score.ts";

const contains = (aliases: string[]) => (row: { response_text?: unknown }) => {
  const text = String(row.response_text ?? "").toLowerCase();
  return aliases.reduce((count, alias) => {
    const escaped = alias.toLowerCase();
    return count + (text.includes(escaped) ? 1 : 0);
  }, 0);
};

Deno.test("independent fixture calculation: same response denominator for tracked brand and competitor", () => {
  const raw = [
    { response_id: "r1", prompt_id: "p1", status: "completed", response_text: "Dr D and Renewlife are mentioned." },
    { response_id: "r2", prompt_id: "p2", status: "completed", response_text: "Renewlife is mentioned twice: Renewlife." },
    { response_id: "r3", prompt_id: "p3", status: "completed", response_text: "No brands here." },
    { response_id: "r4", prompt_id: "p4", status: "failed", response_text: "Dr D" },
    { response_id: "r5", prompt_id: "p5", status: "completed", response_text: "" },
  ];
  const tracked = calculateEntityVisibility(raw, contains(["dr d"]));
  const competitor = calculateEntityVisibility(raw, contains(["renewlife"]));
  assertEquals(tracked, { mention_count: 1, presence_count: 1, response_count: 3, visibility_score: 33.3 });
  assertEquals(competitor, { mention_count: 2, presence_count: 2, response_count: 3, visibility_score: 66.7 });
});

Deno.test("deduplicates response IDs and counts multiple aliases/mentions as one presence", () => {
  const rows = [
    { response_id: "same", prompt_id: "p1", status: "completed", response_text: "Lifewood Lifewood" },
    { response_id: "same", prompt_id: "p1", status: "completed", response_text: "Lifewood" },
    { response_id: "other", prompt_id: "p2", status: "completed", response_text: "No mention" },
  ];
  const metric = calculateEntityVisibility(rows, contains(["lifewood", "life wood"]));
  assertEquals(metric.response_count, 2);
  assertEquals(metric.presence_count, 1);
  assertEquals(metric.visibility_score, 50);
});

Deno.test("only successful nonempty responses form the denominator", () => {
  assertEquals(
    calculateEntityVisibility([
      { response_id: "a", status: "completed", response_text: "Brand" },
      { response_id: "b", status: "failed", response_text: "Brand" },
      { response_id: "c", status: "completed", response_text: " " },
    ], contains(["brand"])),
    { mention_count: 1, presence_count: 1, response_count: 1, visibility_score: 100 },
  );
});
