import test from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { effectiveStatus, fmtDate, fmtScore, rating, setText, suggestedTargets, targetsFor, textFor } from "./report-view.ts";
import type { Narrative, ReportSnapshot } from "./report-types.ts";

const narrative: Narrative = {
  executiveSummary: { position: ["Generated one", "Generated two"] },
  kpiNotes: { visibility: "v", rank: "r", citations: "c", shareOfVoice: "s" },
  competitorSummary: "cs",
  pillars: {
    website: { position: ["w0", "w1"] }, knowledge: { position: [] }, authority: { position: [] },
    community: { position: [] }, monitoring: { position: [] },
  },
  targetNotes: "",
};

test("edit overrides generated text", () => {
  strictEqual(textFor(narrative, { text: { "executiveSummary.position.0": "Edited" } }, "executiveSummary.position.0"), "Edited");
  strictEqual(textFor(narrative, {}, "executiveSummary.position.1"), "Generated two");
});

test("missing path gives empty string", () => {
  strictEqual(textFor(narrative, {}, "executiveSummary.position.7"), "");
  strictEqual(textFor(null, {}, "competitorSummary"), "");
});

test("path into pillar lists", () => {
  strictEqual(textFor(narrative, {}, "pillars.website.position.1"), "w1");
});

test("setText null resets", () => {
  const edited = setText({}, "competitorSummary", "Mine");
  deepStrictEqual(edited, { text: { competitorSummary: "Mine" } });
  deepStrictEqual(setText(edited, "competitorSummary", null), { text: {} });
});

const snap = (overall: number | null, rank: number | null, cats: [string, number | null, number | null][]): ReportSnapshot => ({
  overall: { visibilityScore: overall, rank },
  byCategory: cats.map(([category, visibilityScore, r]) => ({ category, visibilityScore, rank: r, rankText: String(r) })),
} as unknown as ReportSnapshot);

test("suggestedTargets overall 40 → 50 and rank 5 → 3", () => {
  const [overall] = suggestedTargets(snap(40, 5, []));
  deepStrictEqual(overall, { scope: "Overall", currentScore: 40, targetScore: 50, currentRank: 5, targetRank: 3 });
});

test("suggestedTargets low score uses +5", () => {
  strictEqual(suggestedTargets(snap(10, 1, []))[0].targetScore, 15);
  strictEqual(suggestedTargets(snap(10, 1, []))[0].targetRank, 1);
});

test("suggestedTargets caps at 100 and keeps nulls", () => {
  strictEqual(suggestedTargets(snap(98, null, []))[0].targetScore, 100);
  strictEqual(suggestedTargets(snap(null, null, []))[0].targetScore, null);
});

test("suggestedTargets picks up to 3 lowest categories", () => {
  const scopes = suggestedTargets(snap(40, 2, [["A", 50, 1], ["B", 10, 4], ["C", 30, 2], ["D", 20, 3]])).map((t) => t.scope);
  deepStrictEqual(scopes, ["Overall", "B", "D", "C"]);
});

test("targetsFor applies edits by scope", () => {
  const rows = targetsFor(snap(40, 5, []), { targets: [{ scope: "Overall", targetScore: 70, targetRank: 1 }] });
  strictEqual(rows[0].targetScore, 70);
  strictEqual(rows[0].targetRank, 1);
});

test("stale running report is failed", () => {
  const now = Date.parse("2026-11-05T10:00:00Z");
  strictEqual(effectiveStatus({ status: "running", updated_at: "2026-11-05T09:49:00Z" }, now), "failed");
});

test("fresh running stays running", () => {
  const now = Date.parse("2026-11-05T10:00:00Z");
  strictEqual(effectiveStatus({ status: "running", updated_at: "2026-11-05T09:55:00Z" }, now), "running");
  strictEqual(effectiveStatus({ status: "completed", updated_at: "2026-11-01T00:00:00Z" }, now), "completed");
});

test("rating bands and null", () => {
  deepStrictEqual(rating(null), { label: "Not measured", tone: "fair" });
  deepStrictEqual(rating(92), { label: "Excellent", tone: "good" });
  deepStrictEqual(rating(75), { label: "Good", tone: "good" });
  deepStrictEqual(rating(60), { label: "Fair", tone: "fair" });
  deepStrictEqual(rating(59), { label: "Poor", tone: "poor" });
  deepStrictEqual(rating(39), { label: "Critical", tone: "poor" });
});

test("fmtDate and fmtScore", () => {
  strictEqual(fmtDate("2026-11-03"), "3 November 2026");
  strictEqual(fmtScore(null), "—");
  strictEqual(fmtScore(42.456), "42.5");
  strictEqual(fmtScore(42, 0), "42");
});
