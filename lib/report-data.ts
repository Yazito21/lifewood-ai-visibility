// Gathers the AI visibility snapshot for an audit report, using the same queries as the
// Dashboard, Analytics, Citations and Leaderboards pages so the numbers match the app.
import type { SupabaseClient } from "@supabase/supabase-js";
import { hostFromUrl, loadLeaderboard, TRACKED_BRAND_KEY } from "./leaderboard.ts";
import { classifyHost } from "./presence.ts";
import { latestSnapshots, rankDisplay, type DailyMetric } from "./rank-snapshot.ts";
import { reportingDateRange } from "./reporting-date.ts";
import type { BenchmarkRow, Presence, ReportSnapshot } from "./report-types.ts";

export type PeriodChoice = "Last 7 Days" | "Last 30 Days" | "Last 90 Days" | "Custom";
export type ReportPeriod = { label: string; start: string; end: string };

export const ENGINE_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT", gemini: "Gemini", perplexity: "Perplexity", google_ai_overview: "Google AI Overview", claude: "Claude",
};

const MAX_COMPETITORS = 3;
const TOP_N = 10;

export function periodFromChoice(choice: PeriodChoice, customStart = "", customEnd = "", today?: string): ReportPeriod {
  const range = today ? reportingDateRange(choice, customStart, customEnd, today) : reportingDateRange(choice, customStart, customEnd);
  return { label: choice, ...range };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Each brand's visibility as a share of the summed visibility of all compared brands (1 dp). */
export function benchmarkShareOfVoice(scores: number[]): (number | null)[] {
  const total = scores.reduce((sum, s) => sum + Math.max(0, s), 0);
  return scores.map((s) => (total > 0 ? round1((100 * Math.max(0, s)) / total) : null));
}

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

async function pagedRpc<T>(client: SupabaseClient, name: string, args: Record<string, unknown>, max = 5000): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; offset < max; offset += 1000) {
    const { data, error } = await client.rpc(name, args).range(offset, offset + 999);
    if (error) throw error;
    const batch = (data ?? []) as T[];
    out.push(...batch);
    if (batch.length < 1000) break;
  }
  return out;
}

type MentionRow = { hostname: string | null; associated_brand_ids: string[] | null };

async function presenceByBrand(client: SupabaseClient, projectId: string, period: ReportPeriod, location: string): Promise<Map<string, Presence>> {
  const { data: brands, error: brandError } = await client.from("brand_registry")
    .select("id,primary_website,additional_websites,is_tracked_brand").eq("project_id", projectId).eq("is_active", true);
  if (brandError) throw brandError;
  const owned = new Set<string>();
  for (const brand of (brands ?? []) as { primary_website: string | null; additional_websites: string[] | null }[]) {
    for (const site of [brand.primary_website, ...(brand.additional_websites ?? [])]) {
      const host = hostFromUrl(site);
      if (host) owned.add(host);
    }
  }
  const isOwned = (host: string) => [...owned].some((own) => host === own || host.endsWith("." + own));
  const hostsByBrand = new Map<string, Map<string, keyof Presence>>();
  for (let offset = 0; offset < 20000; offset += 1000) {
    const { data, error } = await client.from("third_party_mentions")
      .select("hostname,associated_brand_ids")
      .eq("project_id", projectId).eq("tracking_location", location)
      .gte("metric_date", period.start).lte("metric_date", period.end)
      .range(offset, offset + 999);
    if (error) throw error;
    const batch = (data ?? []) as MentionRow[];
    for (const row of batch) {
      const host = (row.hostname ?? "").toLowerCase().replace(/^www\./, "");
      if (!host || isOwned(host)) continue;
      for (const brandId of row.associated_brand_ids ?? []) {
        const hosts = hostsByBrand.get(brandId) ?? new Map<string, keyof Presence>();
        hosts.set(host, classifyHost(host));
        hostsByBrand.set(brandId, hosts);
      }
    }
    if (batch.length < 1000) break;
  }
  const out = new Map<string, Presence>();
  for (const [brandId, hosts] of hostsByBrand) {
    const presence: Presence = { social: 0, directories: 0, websites: 0 };
    for (const kind of hosts.values()) presence[kind]++;
    out.set(brandId, presence);
  }
  // Key the tracked brand under TRACKED_BRAND_KEY as well, so callers need not know its registry id.
  const tracked = ((brands ?? []) as { id: string; is_tracked_brand: boolean }[]).find((b) => b.is_tracked_brand);
  if (tracked && out.has(tracked.id)) out.set(TRACKED_BRAND_KEY, out.get(tracked.id)!);
  return out;
}

const EMPTY_PRESENCE: Presence = { social: 0, directories: 0, websites: 0 };

/** Everything the report needs from tracking data, for one project and period. */
export async function gatherSnapshot(client: SupabaseClient, projectId: string, period: ReportPeriod): Promise<ReportSnapshot> {
  const { data: project, error: projectError } = await client.from("projects")
    .select("brand_name,brand_domains,brand_terms,categories,tracking_market").eq("id", projectId).single();
  if (projectError) throw projectError;
  const brandName: string = project?.brand_name ?? "";
  const brandDomains: string[] = project?.brand_domains ?? [];
  const categories: string[] = (project?.categories ?? []).filter((c: string) => c && c !== "Overall");
  const location: string = project?.tracking_market ?? "MY";
  const brandHosts = brandDomains.map((d) => hostFromUrl(d)).filter((h): h is string => Boolean(h));
  const isBrandUrl = (url: string) => {
    const host = hostFromUrl(url);
    return Boolean(host && brandHosts.some((b) => host === b || host.endsWith("." + b)));
  };

  // Overall + per-category visibility (Dashboard query).
  const { data: overallRows, error: overallError } = await client.from("visibility_daily")
    .select("metric_date,category,visibility_score,visibility_rank,rank_population_count,rank_population_status")
    .eq("project_id", projectId).eq("llm_provider", "Overall").eq("tracking_location", location)
    .gte("metric_date", period.start).lte("metric_date", period.end).order("metric_date");
  if (overallError) throw overallError;
  const metrics = (overallRows ?? []) as DailyMetric[];
  const snapshots = latestSnapshots(metrics, ["Overall", ...categories]);
  const overallSnap = snapshots.get("Overall");
  const overallRank = rankDisplay(overallSnap);

  // Per-engine visibility and share of voice (Analytics query), paged past the 1,000-row API limit.
  const engineRows: unknown[] = [];
  for (let offset = 0; offset < 20000; offset += 1000) {
    const { data, error: engineError } = await client.from("visibility_daily")
      .select("metric_date,category,llm_provider,visibility_score,share_of_voice_score")
      .eq("project_id", projectId).eq("tracking_location", location).neq("llm_provider", "Overall")
      .gte("metric_date", period.start).lte("metric_date", period.end).order("metric_date").range(offset, offset + 999);
    if (engineError) throw engineError;
    engineRows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  const perEngine = (engineRows as { metric_date: string; category: string; llm_provider: string; visibility_score: unknown; share_of_voice_score: unknown }[])
    .filter((row) => row.llm_provider && row.llm_provider !== "Overall");
  const engines = [...new Set(perEngine.map((row) => row.llm_provider))];
  const latestByEngine = engines.map((engine) => [...perEngine].reverse().find((row) => row.llm_provider === engine && row.category === "Overall" && num(row.visibility_score) !== null));
  const shares = latestByEngine.map((row) => num(row?.share_of_voice_score)).filter((v): v is number => v !== null);

  // Citations (Citations page RPCs).
  const citationArgs = { p_project_id: projectId, p_start_date: period.start, p_end_date: period.end, p_category: null, p_engines: [], p_tracking_location: location };
  const [brandPages, allPages, thirdParty, gapsResult, promptCount, presence] = await Promise.all([
    pagedRpc<{ url: string; frequency: number }>(client, "get_cumulative_citations", { ...citationArgs, p_brand_related_only: true }),
    pagedRpc<{ url: string; frequency: number }>(client, "get_cumulative_citations", { ...citationArgs, p_brand_related_only: false }, 1000),
    pagedRpc<{ hostname: string; response_frequency: number }>(client, "get_third_party_mentions", citationArgs),
    client.rpc("get_report_prompt_gaps", { p_project_id: projectId, p_start_date: period.start, p_end_date: period.end, p_tracking_location: location, p_limit: TOP_N }),
    client.from("prompts").select("id", { count: "exact", head: true }).eq("project_id", projectId),
    presenceByBrand(client, projectId, period, location),
  ]);
  // The gaps table is helpful but not essential: if it fails, the report still generates without it.
  const gapRows = gapsResult.error ? [] : (gapsResult.data ?? []);

  // Competitor benchmark (Leaderboards logic, all engines, all categories).
  const leaderboard = engines.length
    ? await loadLeaderboard(client, { projectId, category: "Overall", engines, start: period.start, end: period.end, location, brandName, brandDomains })
    : { rows: [], activeCompetitors: 0, totalCompetitors: 0 };
  const trackedRow = leaderboard.rows.find((row) => row.key === TRACKED_BRAND_KEY);
  const topCompetitors = leaderboard.rows.filter((row) => row.key !== TRACKED_BRAND_KEY).slice(0, MAX_COMPETITORS);
  const benchRows = trackedRow ? [trackedRow, ...topCompetitors] : [];
  const sov = benchmarkShareOfVoice(benchRows.map((row) => row.visibility_score));
  const competitors: BenchmarkRow[] = benchRows.length
    ? benchRows.map((row, i) => ({
      name: row.brand_name,
      website: row.website,
      isTracked: row.key === TRACKED_BRAND_KEY,
      rank: leaderboard.activeCompetitors > 0 ? row.rank : null,
      visibilityScore: round1(row.visibility_score),
      shareOfVoice: sov[i],
      citations: row.citations,
      presence: presence.get(row.key) ?? EMPTY_PRESENCE,
    }))
    : [{
      name: brandName, website: brandDomains[0] ? "https://" + (hostFromUrl(brandDomains[0]) ?? brandDomains[0]) : null, isTracked: true,
      rank: null, visibilityScore: null, shareOfVoice: null, citations: 0, presence: presence.get(TRACKED_BRAND_KEY) ?? EMPTY_PRESENCE,
    }];

  return {
    version: 1,
    brand: { name: brandName, website: brandDomains[0] ?? null, categories },
    period: { start: period.start, end: period.end, label: period.label },
    location,
    engines,
    promptCount: promptCount.count ?? 0,
    hasData: metrics.length > 0,
    overall: {
      visibilityScore: num(overallSnap?.visibility_score),
      scoreChange: overallSnap?.scoreChange ?? null,
      rank: overallSnap?.visibility_rank ?? null,
      population: overallSnap?.rank_population_status === "verified" ? overallSnap.rank_population_count : null,
      rankText: overallRank.text,
      shareOfVoice: shares.length ? round1(shares.reduce((a, b) => a + b, 0) / shares.length) : null,
      brandCitations: brandPages.reduce((sum, row) => sum + (num(row.frequency) ?? 0), 0),
    },
    trend: metrics.filter((row) => row.category === "Overall").map((row) => ({ date: row.metric_date, score: num(row.visibility_score) })),
    byEngine: engines.map((engine, i) => ({ engine, label: ENGINE_LABELS[engine] ?? engine, visibilityScore: num(latestByEngine[i]?.visibility_score) })),
    byCategory: categories.map((category) => {
      const snap = snapshots.get(category);
      return { category, visibilityScore: num(snap?.visibility_score), rank: snap?.visibility_rank ?? null, rankText: rankDisplay(snap).text };
    }),
    competitors,
    gaps: (gapRows as { prompt: string; category: string | null; competitors: string[] | null }[])
      .map((row) => ({ prompt: row.prompt, category: row.category, competitors: row.competitors ?? [] })),
    topCitedPages: allPages.slice(0, TOP_N).map((row) => ({ url: row.url, frequency: num(row.frequency) ?? 0, isBrand: isBrandUrl(row.url) })),
    topCitedDomains: thirdParty.slice(0, TOP_N).map((row) => ({ hostname: row.hostname, responses: num(row.response_frequency) ?? 0 })),
    brandSiteCited: brandPages.some((row) => isBrandUrl(row.url)),
    thirdPartyHosts: thirdParty.length,
  };
}
