import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { reduceEvidenceRows, type EvidenceRow } from "./evidence-reducer.ts";

const base: EvidenceRow = {
  response_id: "response-1",
  brand_id: "brand-1",
  topic: "AEO/GEO",
  match_source: "alias",
  matched_value: "Lifewood",
};

Deno.test("merges identical duplicate evidence deterministically", () => {
  const row = { ...base, occurrence_count: 2, first_position: 12, confidence: "medium", evidence_text: "Evidence A" };
  assertEquals(reduceEvidenceRows([row, row]), reduceEvidenceRows([row, row]));
  const [merged] = reduceEvidenceRows([row, row]);
  assertEquals(merged.occurrence_count, 4);
  assertEquals(merged.first_position, 12);
  assertEquals(merged.evidence_text, "Evidence A");
});

Deno.test("conflicting duplicates merge all evidence and are input-order independent", () => {
  const a = { ...base, occurrence_count: 2, first_position: 12, confidence: "medium", evidence_text: "Z excerpt" };
  const b = { ...base, occurrence_count: 3, first_position: 4, confidence: "high", evidence_text: "A excerpt" };
  const expected = reduceEvidenceRows([a, b]);
  assertEquals(expected, reduceEvidenceRows([b, a]));
  const [merged] = expected;
  assertEquals(merged.occurrence_count, 5);
  assertEquals(merged.first_position, 4);
  assertEquals(merged.confidence, "high");
  assertEquals(merged.evidence_text, "A excerpt\n---\nZ excerpt");
});

Deno.test("preserves separate conflict keys as separate rows", () => {
  const other = { ...base, matched_value: "Lifewood Data", occurrence_count: 1, first_position: 8, evidence_text: "Other" };
  assertEquals(reduceEvidenceRows([other, { ...base, occurrence_count: 1, first_position: 3, evidence_text: "First" }]).length, 2);
});
