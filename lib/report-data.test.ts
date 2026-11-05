import test from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { benchmarkShareOfVoice, gatherSnapshot, periodFromChoice } from "./report-data.ts";

type Rows = Record<string, unknown[]>;

/** Minimal chainable stand-in for the Supabase client: every query on a table returns its fixture rows. */
function fakeClient(tables: Rows, rpcs: Rows = {}) {
  const query = (rows: unknown[]) => {
    const result = { data: rows, error: null, count: rows.length };
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "neq", "gte", "lte", "lt", "in", "order", "range", "limit", "not"]) {
      chain[method] = () => chain;
    }
    chain.single = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    chain.maybeSingle = chain.single;
    chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
    return chain;
  };
  return {
    from: (table: string) => query(tables[table] ?? []),
    rpc: (name: string) => query(rpcs[name] ?? []),
  } as never;
}

test("periodFromChoice Last 30 Days", () => {
  deepStrictEqual(periodFromChoice("Last 30 Days", "", "", "2026-11-05"), { label: "Last 30 Days", start: "2026-10-07", end: "2026-11-05" });
});

test("periodFromChoice Custom swaps reversed dates", () => {
  deepStrictEqual(periodFromChoice("Custom", "2026-10-20", "2026-10-10", "2026-11-05"), { label: "Custom", start: "2026-10-10", end: "2026-10-20" });
});

test("benchmark share of voice sums to 100", () => {
  const shares = benchmarkShareOfVoice([30, 10, 0, 60]);
  deepStrictEqual(shares, [30, 10, 0, 60]);
  deepStrictEqual(benchmarkShareOfVoice([1, 2]), [33.3, 66.7]);
  deepStrictEqual(benchmarkShareOfVoice([0, 0]), [null, null]);
});

test("empty period snapshot", async () => {
  const client = fakeClient({ projects: [{ brand_name: "Brand", brand_domains: ["brand.com"], brand_terms: [], categories: ["Cat A"], tracking_market: "MY" }] });
  const s = await gatherSnapshot(client, "p1", { label: "Last 7 Days", start: "2026-10-30", end: "2026-11-05" });
  strictEqual(s.version, 1);
  strictEqual(s.hasData, false);
  strictEqual(s.overall.visibilityScore, null);
  strictEqual(s.location, "MY");
  strictEqual(s.competitors.length, 1);
  strictEqual(s.competitors[0].isTracked, true);
  deepStrictEqual(s.gaps, []);
  strictEqual(s.brandSiteCited, false);
});

test("snapshot reads overall, engines, citations and third-party hosts", async () => {
  const client = fakeClient({
    projects: [{ brand_name: "Brand", brand_domains: ["https://brand.com"], brand_terms: [], categories: ["Cat A"], tracking_market: "MY" }],
    visibility_daily: [
      { metric_date: "2026-11-01", category: "Overall", llm_provider: "Overall", visibility_score: 40, visibility_rank: 3, rank_population_count: 10, rank_population_status: "verified" },
      { metric_date: "2026-11-02", category: "Overall", llm_provider: "Overall", visibility_score: 45, visibility_rank: 2, rank_population_count: 10, rank_population_status: "verified" },
    ],
    prompts: [{ id: 1 }, { id: 2 }],
  }, {
    get_cumulative_citations: [{ url: "https://brand.com/a", page_name: null, brand_name: "Brand", frequency: 5 }, { url: "https://other.com/b", page_name: null, brand_name: null, frequency: 2 }],
    get_third_party_mentions: [{ hostname: "g2.com", website_name: "G2", frequency: 3, response_frequency: 2, brand_coverage: 1, source_types: [], example_url: null }],
  });
  const s = await gatherSnapshot(client, "p1", { label: "Last 7 Days", start: "2026-10-30", end: "2026-11-05" });
  strictEqual(s.hasData, true);
  strictEqual(s.overall.visibilityScore, 45);
  strictEqual(s.overall.rank, 2);
  strictEqual(s.overall.rankText, "2/10");
  strictEqual(s.overall.scoreChange, 5);
  deepStrictEqual(s.trend.map((t) => t.score), [40, 45]);
  strictEqual(s.brandSiteCited, true);
  strictEqual(s.topCitedPages[0].isBrand, true);
  strictEqual(s.thirdPartyHosts, 1);
  strictEqual(s.topCitedDomains[0].hostname, "g2.com");
  strictEqual(s.promptCount, 2);
});
