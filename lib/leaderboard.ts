// Leaderboard loading and ranking, shared by the Leaderboards page and the audit report.
// Moved from app/platform/[projectId]/competitors/page.tsx without behaviour changes.
import type { SupabaseClient } from "@supabase/supabase-js";

export type DirectCompetitor = {
  id: string;
  category: string;
  normalized_domain: string;
  brand_name: string;
  website: string | null;
};
export type DirectObservation = {
  brand_id: string;
  metric_date: string;
  llm_provider: string;
  presence_count: number;
  response_count: number;
  citation_count: number;
  tracking_location: string;
  run_id: string | null;
};
export type OwnMetric = {
  metric_date: string;
  category: string;
  llm_provider: string;
  visibility_score: number | string | null;
  citation_count: number | null;
  run_id: string | null;
};
export type BrandMetric = {
  key: string;
  brand_name: string;
  website: string | null;
  visibility_score: number;
  citations: number;
};
export type RankedBrandMetric = BrandMetric & { rank: number };
export type DateRange = { start: string; end: string };
export type PeriodScope = { observations: DirectObservation[]; own: OwnMetric[] };

export const TRACKED_BRAND_KEY = "__tracked_brand__";

export function hostFromUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    return new URL(value.includes("://") ? value : "https://" + value).hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "") || null;
  } catch { return null; }
}
export function rootWebsite(value: string | null | undefined) {
  const host = hostFromUrl(value);
  return host ? "https://" + host : null;
}
export function numberValue(value: number | string | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}
const scopeKey = (row: { metric_date: string; llm_provider: string; run_id: string | null }) => `${row.metric_date}::${row.llm_provider}::${row.run_id}`;

export function aggregateCompetitorRows(directCompetitors: DirectCompetitor[], observations: DirectObservation[], ownMetrics: OwnMetric[]): BrandMetric[] {
  const byId = new Map<string, DirectObservation[]>();
  const ownScopeKeys = new Set(ownMetrics.filter((row) => row.visibility_score !== null && row.run_id).map(scopeKey));
  for (const observation of observations) {
    const bucket = byId.get(observation.brand_id) ?? [];
    bucket.push(observation);
    byId.set(observation.brand_id, bucket);
  }
  return directCompetitors.map((competitor) => {
    const records = byId.get(competitor.id) ?? [];
    const matchedRecords = records.filter((row) => numberValue(row.response_count) > 0 && ownScopeKeys.has(scopeKey(row)));
    const scores = matchedRecords.map((row) => 100 * numberValue(row.presence_count) / numberValue(row.response_count));
    return {
      key: competitor.normalized_domain,
      brand_name: competitor.brand_name || competitor.normalized_domain,
      website: rootWebsite(competitor.website || competitor.normalized_domain),
      visibility_score: scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0,
      citations: matchedRecords.reduce((sum, row) => sum + numberValue(row.citation_count), 0),
    };
  });
}
export function aggregateOwnRow(metrics: OwnMetric[], projectName: string, projectWebsite: string | null): BrandMetric {
  const scores = metrics.filter((row) => row.visibility_score !== null).map((row) => numberValue(row.visibility_score));
  return {
    key: TRACKED_BRAND_KEY,
    brand_name: projectName,
    website: projectWebsite,
    visibility_score: scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0,
    citations: metrics.reduce((sum, row) => sum + numberValue(row.citation_count), 0),
  };
}
export function competitorsObservedInPeriod(directCompetitors: DirectCompetitor[], observations: DirectObservation[], ownMetrics: OwnMetric[]) {
  // A competitor enters this period leaderboard only when its observation has
  // a valid response count and a tracked-brand metric exists for the exact
  // same date and engine. Missing/stale scope rows are not zero-valued entries.
  const ownScopes = new Set(ownMetrics.filter((row) => row.visibility_score !== null && row.run_id).map(scopeKey));
  const eligibleIds = new Set(observations.filter((row) => numberValue(row.response_count) > 0 && ownScopes.has(scopeKey(row))).map((row) => row.brand_id));
  return directCompetitors.filter((competitor) => eligibleIds.has(competitor.id));
}
export function rankBrands(rows: BrandMetric[]): RankedBrandMetric[] {
  // Deterministic tie-breaks: visibility score, citations, then canonical name.
  return [...rows].sort((a, b) => b.visibility_score - a.visibility_score || b.citations - a.citations || a.brand_name.localeCompare(b.brand_name))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

/** Ranked rows for one period: the tracked brand plus competitors observed in that period. */
export function rankPeriod(registry: DirectCompetitor[], scope: PeriodScope, brandName: string, brandWebsite: string | null) {
  const active = competitorsObservedInPeriod(registry, scope.observations, scope.own);
  const rows = rankBrands([aggregateOwnRow(scope.own, brandName, brandWebsite), ...aggregateCompetitorRows(active, scope.observations, scope.own)]);
  return { rows, active };
}

/**
 * Active competitors registered for the category ("Overall" = every category), excluding the tracked brand
 * (matched by domain or name).
 */
export async function loadCompetitorRegistry(
  client: SupabaseClient, projectId: string, selectedCategory: string, brandName: string, brandDomains: string[],
): Promise<DirectCompetitor[]> {
  const assignmentRows: Array<{ category: string; brand_id: string; role: string }> = [];
  for (let offset = 0; ; offset += 1000) {
    let query = client.from("category_brand_assignments").select("category,brand_id,role")
      .eq("project_id", projectId).eq("include_in_metrics", true).eq("role", "competitor")
      .order("category").range(offset, offset + 999);
    if (selectedCategory !== "Overall") query = query.eq("category", selectedCategory);
    const { data, error } = await query;
    if (error) throw error;
    const batch = (data ?? []) as Array<{ category: string; brand_id: string; role: string }>;
    assignmentRows.push(...batch);
    if (batch.length < 1000) break;
  }
  const brandIds = [...new Set(assignmentRows.map((row) => row.brand_id))];
  const brandRows: Array<{ id: string; canonical_name: string; normalized_key: string; primary_website: string | null; is_active: boolean }> = [];
  for (let i = 0; i < brandIds.length; i += 80) {
    const { data, error } = await client.from("brand_registry")
      .select("id,canonical_name,normalized_key,primary_website,is_active")
      .eq("project_id", projectId).eq("is_active", true).in("id", brandIds.slice(i, i + 80));
    if (error) throw error;
    brandRows.push(...((data ?? []) as typeof brandRows));
  }
  const byId = new Map(brandRows.map((row) => [row.id, row]));
  const unique = new Map<string, DirectCompetitor>();
  for (const assignment of assignmentRows) {
    const brand = byId.get(assignment.brand_id);
    if (!brand) continue;
    unique.set(brand.id, {
      id: brand.id, category: selectedCategory,
      normalized_domain: brand.id,
      brand_name: brand.canonical_name,
      website: rootWebsite(brand.primary_website),
    });
  }
  const domains = brandDomains.map((value) => hostFromUrl(value)).filter(Boolean);
  // Preserve registry identity and exclude the tracked brand here. The rank population is filtered
  // later by response-backed observations that match the tracked brand's date and engine.
  return [...unique.values()].filter((row) => {
    const domain = row.normalized_domain || hostFromUrl(row.website);
    return domain && !domains.includes(domain) && row.brand_name.trim().toLocaleLowerCase() !== brandName.trim().toLocaleLowerCase();
  });
}

// Published run per date and engine: every selected engine has its own runs, so look each one up.
async function fetchPublishedRunIds(client: SupabaseClient, projectId: string, range: DateRange, location: string, selectedCategory: string, engines: string[]) {
  const published = new Map<string, string>();
  for (const engine of engines) {
    const { data, error } = await client.rpc("get_published_run_ids_for_leaderboard", {
      p_project_id: projectId,
      p_start_date: range.start,
      p_end_date: range.end,
      p_category: selectedCategory,
      p_provider: engine,
      p_tracking_location: location,
    });
    if (error) throw error;
    for (const row of (data ?? []) as Array<{ metric_date: string; run_id: string }>) published.set(row.metric_date + "::" + engine, row.run_id);
  }
  return published;
}

async function fetchObservations(client: SupabaseClient, projectId: string, ids: string[], range: DateRange, location: string, engines: string[], selectedCategory: string) {
  if (!ids.length || !engines.length) return [] as DirectObservation[];
  const all: DirectObservation[] = [];
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await client.from("category_brand_observations")
        .select("brand_id,metric_date,llm_provider,presence_count,response_count,citation_count,tracking_location,run_id")
        .eq("project_id", projectId).eq("category", selectedCategory).eq("tracking_location", location)
        .gte("metric_date", range.start).lte("metric_date", range.end)
        .in("brand_id", chunk).in("llm_provider", engines)
        .order("metric_date", { ascending: true }).range(offset, offset + 999);
      if (error) throw error;
      const batch = (data ?? []) as DirectObservation[];
      all.push(...batch);
      if (batch.length < 1000) break;
    }
  }
  return all;
}

async function fetchOwnMetrics(client: SupabaseClient, projectId: string, range: DateRange, location: string, selectedCategory: string, engines: string[]) {
  if (!engines.length) return [] as OwnMetric[];
  const all: OwnMetric[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.from("visibility_daily")
      .select("metric_date,category,llm_provider,visibility_score,citation_count,run_id")
      .eq("project_id", projectId).eq("tracking_location", location)
      .eq("category", selectedCategory).gte("metric_date", range.start).lte("metric_date", range.end)
      .in("llm_provider", engines).order("metric_date", { ascending: true }).range(offset, offset + 999);
    if (error) throw error;
    const batch = (data ?? []) as OwnMetric[];
    all.push(...batch);
    if (batch.length < 1000) break;
  }
  return all;
}

/** Published-run observations and tracked-brand metrics for one period, limited to the given competitors. */
export async function loadPeriodScope(
  client: SupabaseClient,
  args: { projectId: string; competitorIds: string[]; range: DateRange; location: string; category: string; engines: string[] },
): Promise<PeriodScope> {
  const { projectId, competitorIds, range, location, category, engines } = args;
  const [observationsRaw, ownRaw, published] = await Promise.all([
    fetchObservations(client, projectId, competitorIds, range, location, engines, category),
    fetchOwnMetrics(client, projectId, range, location, category, engines),
    fetchPublishedRunIds(client, projectId, range, location, category, engines),
  ]);
  const isPublished = (row: { run_id: string | null; metric_date: string; llm_provider: string }) =>
    Boolean(row.run_id) && published.get(row.metric_date + "::" + row.llm_provider) === row.run_id;
  const eligible = new Set(competitorIds);
  return {
    observations: observationsRaw.filter((row) => isPublished(row) && eligible.has(row.brand_id)),
    own: ownRaw.filter(isPublished),
  };
}

/** The leaderboard for one period, as the Leaderboards page computes it. */
export async function loadLeaderboard(
  client: SupabaseClient,
  args: { projectId: string; category: string; engines: string[]; start: string; end: string; location: string; brandName: string; brandDomains: string[] },
) {
  const registry = await loadCompetitorRegistry(client, args.projectId, args.category, args.brandName, args.brandDomains);
  const scope = await loadPeriodScope(client, {
    projectId: args.projectId, competitorIds: registry.map((row) => row.id), range: { start: args.start, end: args.end },
    location: args.location, category: args.category, engines: args.engines,
  });
  const { rows, active } = rankPeriod(registry, scope, args.brandName, rootWebsite(args.brandDomains[0] ?? null));
  return { rows, activeCompetitors: active.length, totalCompetitors: registry.length };
}
