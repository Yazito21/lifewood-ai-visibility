import test from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import {
  aggregateCompetitorRows, aggregateOwnRow, competitorsObservedInPeriod, hostFromUrl, rankBrands, rankPeriod,
  type DirectCompetitor, type DirectObservation, type OwnMetric,
} from "./leaderboard.ts";

const comp = (id: string, name: string): DirectCompetitor => ({ id, category: "Overall", normalized_domain: id, brand_name: name, website: `https://${id}.com` });
const own = (date: string, engine: string, score: number | null, run: string | null = "r-" + date): OwnMetric => ({
  metric_date: date, category: "Overall", llm_provider: engine, visibility_score: score, citation_count: 2, run_id: run,
});
const obs = (brand: string, date: string, engine: string, presence: number, responses: number, run = "r-" + date): DirectObservation => ({
  brand_id: brand, metric_date: date, llm_provider: engine, presence_count: presence, response_count: responses, citation_count: 1,
  tracking_location: "MY", run_id: run,
});

test("hostFromUrl strips scheme and www", () => {
  strictEqual(hostFromUrl("https://www.Example.com/path"), "example.com");
  strictEqual(hostFromUrl("example.com"), "example.com");
  strictEqual(hostFromUrl(null), null);
});

test("rankBrands sorts by score, then citations, then name", () => {
  const ranked = rankBrands([
    { key: "b", brand_name: "Beta", website: null, visibility_score: 50, citations: 1 },
    { key: "a", brand_name: "Alpha", website: null, visibility_score: 50, citations: 1 },
    { key: "c", brand_name: "Gamma", website: null, visibility_score: 50, citations: 9 },
    { key: "d", brand_name: "Delta", website: null, visibility_score: 70, citations: 0 },
  ]);
  deepStrictEqual(ranked.map((r) => [r.brand_name, r.rank]), [["Delta", 1], ["Gamma", 2], ["Alpha", 3], ["Beta", 4]]);
});

test("aggregateCompetitorRows ignores observations without a matching own-metric scope", () => {
  const rows = aggregateCompetitorRows(
    [comp("x", "X")],
    [obs("x", "2026-10-01", "chatgpt", 1, 2), obs("x", "2026-10-02", "chatgpt", 2, 2), obs("x", "2026-10-01", "chatgpt", 2, 2, "stale")],
    [own("2026-10-01", "chatgpt", 40)],
  );
  strictEqual(rows[0].visibility_score, 50);
  strictEqual(rows[0].citations, 1);
});

test("competitorsObservedInPeriod drops brands with no matched observations", () => {
  const active = competitorsObservedInPeriod(
    [comp("x", "X"), comp("y", "Y"), comp("z", "Z")],
    [obs("x", "2026-10-01", "chatgpt", 1, 2), obs("y", "2026-10-01", "chatgpt", 1, 0), obs("z", "2026-10-09", "chatgpt", 1, 2)],
    [own("2026-10-01", "chatgpt", 40)],
  );
  deepStrictEqual(active.map((c) => c.id), ["x"]);
});

test("aggregateOwnRow averages non-null scores", () => {
  const row = aggregateOwnRow([own("2026-10-01", "chatgpt", 40), own("2026-10-02", "chatgpt", 60), own("2026-10-03", "chatgpt", null)], "Brand", null);
  strictEqual(row.key, "__tracked_brand__");
  strictEqual(row.visibility_score, 50);
  strictEqual(row.citations, 6);
});

test("rankPeriod ranks the tracked brand among active competitors", () => {
  const result = rankPeriod(
    [comp("x", "X"), comp("y", "Y")],
    { observations: [obs("x", "2026-10-01", "chatgpt", 2, 2)], own: [own("2026-10-01", "chatgpt", 40)] },
    "Brand", "https://brand.com",
  );
  deepStrictEqual(result.rows.map((r) => [r.brand_name, r.rank]), [["X", 1], ["Brand", 2]]);
  strictEqual(result.active.length, 1);
});
