"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Minus, Search, Trophy } from "lucide-react";
import { useParams } from "next/navigation";
import { ProjectShell } from "@/components/project-shell";
import { supabase } from "@/lib/supabase";
import { MIN_TRACKING_DATE, malaysiaDateString, shiftDateString, reportingDateRange, REPORTING_PERIODS } from "@/lib/reporting-date";
import { brandDisplayName } from "@/lib/brand-display";

type DirectCompetitor = {
  id: string;
  topic: string;
  normalized_domain: string;
  brand_name: string;
  website: string | null;
};
type DirectObservation = {
  competitor_id: string;
  metric_date: string;
  llm_provider: string;
  presence_count: number;
  response_count: number;
  citation_count: number;
  tracking_location: string;
};
type OwnMetric = {
  metric_date: string;
  topic: string;
  llm_provider: string;
  visibility_score: number | string | null;
  citation_count: number | null;
};
type BrandMetric = {
  key: string;
  brand_name: string;
  website: string | null;
  visibility_score: number;
  citations: number;
};
type RankedBrand = BrandMetric & {
  rank: number;
  previousRank: number | null;
  previousVisibility: number | null;
  previousCitations: number | null;
};
type DateRange = { start: string; end: string };
const LLMS = ["chatgpt", "gemini", "perplexity", "google_ai_overview", "claude"];
const labels: Record<string, string> = {
  chatgpt: "ChatGPT", gemini: "Gemini", perplexity: "Perplexity",
  google_ai_overview: "Google AI Overview", claude: "Claude",
};

function hostFromUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    return new URL(value.includes("://") ? value : "https://" + value).hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "") || null;
  } catch { return null; }
}
function rootWebsite(value: string | null | undefined) {
  const host = hostFromUrl(value);
  return host ? "https://" + host : null;
}
function numberValue(value: number | string | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}
function aggregateCompetitorRows(directCompetitors: DirectCompetitor[], observations: DirectObservation[]): BrandMetric[] {
  const byId = new Map<string, DirectObservation[]>();
  for (const observation of observations) {
    const bucket = byId.get(observation.competitor_id) ?? [];
    bucket.push(observation);
    byId.set(observation.competitor_id, bucket);
  }
  return directCompetitors.map((competitor) => {
    const records = byId.get(competitor.id) ?? [];
    const scores = records.filter((row) => numberValue(row.response_count) > 0)
      .map((row) => 100 * numberValue(row.presence_count) / numberValue(row.response_count));
    return {
      key: competitor.normalized_domain,
      brand_name: competitor.brand_name || competitor.normalized_domain,
      website: rootWebsite(competitor.website || competitor.normalized_domain),
      visibility_score: scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0,
      citations: records.reduce((sum, row) => sum + numberValue(row.citation_count), 0),
    };
  });
}
function aggregateOwnRow(metrics: OwnMetric[], projectName: string, projectWebsite: string | null): BrandMetric {
  const scores = metrics.filter((row) => row.visibility_score !== null).map((row) => numberValue(row.visibility_score));
  return {
    key: "__tracked_brand__",
    brand_name: projectName,
    website: projectWebsite,
    visibility_score: scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0,
    citations: metrics.reduce((sum, row) => sum + numberValue(row.citation_count), 0),
  };
}
function competitorsObservedInPeriod(directCompetitors: DirectCompetitor[], observations: DirectObservation[]) {
  const activeIds = new Set(
    observations
      .filter((row) => numberValue(row.presence_count) > 0 || numberValue(row.citation_count) > 0)
      .map((row) => row.competitor_id),
  );
  return directCompetitors.filter((competitor) => activeIds.has(competitor.id));
}
function rankBrands(rows: BrandMetric[]) {
  return [...rows].sort((a, b) => b.visibility_score - a.visibility_score || b.citations - a.citations || a.brand_name.localeCompare(b.brand_name))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}
function getPeriodStart(period: string, customStart: string, customEnd: string) { return reportingDateRange(period, customStart, customEnd).start; }
function MetricChange({ value, suffix = "", lowerIsBetter = false }: { value: number | null; suffix?: string; lowerIsBetter?: boolean }) {
  if (value === null || !Number.isFinite(value)) return <span className="ml-2 text-xs font-medium text-[#87918b]">—</span>;
  if (Math.abs(value) < 0.0001) return <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-[#87918b]"><Minus size={12} /> 0{suffix}</span>;
  const positive = value > 0;
  const good = lowerIsBetter ? !positive : positive;
  return <span className={`ml-2 inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold ${good ? "text-emerald-700" : "text-rose-700"}`}>
    {positive ? <ArrowUp size={12} /> : <ArrowDown size={12} />}{Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}{suffix}
  </span>;
}

export default function LeaderboardsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [directCompetitors, setDirectCompetitors] = useState<DirectCompetitor[]>([]);
  const [currentCompetitorObservations, setCurrentCompetitorObservations] = useState<DirectObservation[]>([]);
  const [previousCompetitorObservations, setPreviousCompetitorObservations] = useState<DirectObservation[]>([]);
  const [currentOwnMetrics, setCurrentOwnMetrics] = useState<OwnMetric[]>([]);
  const [previousOwnMetrics, setPreviousOwnMetrics] = useState<OwnMetric[]>([]);
  const [projectName, setProjectName] = useState("Tracked brand");
  const [projectWebsite, setProjectWebsite] = useState<string | null>(null);
  const [topics, setTopics] = useState<string[]>([]);
  const [topic, setTopic] = useState("All");
  const [llms, setLlms] = useState<string[]>(["chatgpt"]);
  const [period, setPeriod] = useState("Last 7 Days");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState(malaysiaDateString());
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const start = useMemo(() => getPeriodStart(period, customStart, customEnd), [period, customStart, customEnd]);
  const end = period === "Custom" ? customEnd : malaysiaDateString();
  const previousRange = useMemo<DateRange | null>(() => {
    if (period === "All Time" || !start || !end || end < start) return null;
    const days = Math.round((Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / 86400000) + 1;
    const previousEnd = shiftDateString(start, -1);
    return { start: shiftDateString(previousEnd, -days + 1), end: previousEnd };
  }, [period, start, end]);

  useEffect(() => {
    let cancelled = false;
    async function fetchCompetitorRegistry(selectedTopic: string) {
      const all: DirectCompetitor[] = [];
      for (let offset = 0; ; offset += 1000) {
        let query = supabase.from("direct_competitors").select("id,topic,normalized_domain,brand_name,website")
          .eq("project_id", projectId).eq("topic", selectedTopic).order("normalized_domain").range(offset, offset + 999);
        const { data, error: queryError } = await query;
        if (queryError) throw queryError;
        const batch = (data ?? []) as DirectCompetitor[];
        all.push(...batch);
        if (batch.length < 1000) break;
      }
      const unique = new Map<string, DirectCompetitor>();
      for (const row of all) {
        const domain = (row.normalized_domain || hostFromUrl(row.website) || "").toLowerCase().replace(/^www\./, "");
        if (domain && !unique.has(domain)) unique.set(domain, { ...row, normalized_domain: domain, website: rootWebsite(row.website || domain) });
      }
      return [...unique.values()];
    }
    async function fetchObservations(ids: string[], range: DateRange, location: string, engines: string[]) {
      if (!ids.length || !engines.length) return [] as DirectObservation[];
      const all: DirectObservation[] = [];
      for (let i = 0; i < ids.length; i += 80) {
        const chunk = ids.slice(i, i + 80);
        for (let offset = 0; ; offset += 1000) {
          const { data, error: queryError } = await supabase.from("direct_competitor_observations")
            .select("competitor_id,metric_date,llm_provider,presence_count,response_count,citation_count,tracking_location")
            .eq("project_id", projectId).eq("tracking_location", location)
            .gte("metric_date", range.start).lte("metric_date", range.end)
            .in("competitor_id", chunk).in("llm_provider", engines)
            .order("metric_date", { ascending: true }).range(offset, offset + 999);
          if (queryError) throw queryError;
          const batch = (data ?? []) as DirectObservation[];
          all.push(...batch);
          if (batch.length < 1000) break;
        }
      }
      return all;
    }
    async function fetchOwnMetrics(range: DateRange, location: string, selectedTopic: string, engines: string[]) {
      if (!engines.length) return [] as OwnMetric[];
      const all: OwnMetric[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error: queryError } = await supabase.from("visibility_daily")
          .select("metric_date,topic,llm_provider,visibility_score,citation_count")
          .eq("project_id", projectId).eq("tracking_location", location)
          .eq("topic", selectedTopic).gte("metric_date", range.start).lte("metric_date", range.end)
          .in("llm_provider", engines).order("metric_date", { ascending: true }).range(offset, offset + 999);
        if (queryError) throw queryError;
        const batch = (data ?? []) as OwnMetric[];
        all.push(...batch);
        if (batch.length < 1000) break;
      }
      return all;
    }
    async function load() {
      setLoading(true);
      setError("");
      try {
        const { data: project, error: projectError } = await supabase.from("projects")
          .select("brand_name,brand_domains,brand_terms,topics,tracking_market").eq("id", projectId).single();
        if (projectError) throw projectError;
        const location = project?.tracking_market ?? "MY";
        const selectedTopic = topic === "All" ? "Overall" : topic;
        const registry = await fetchCompetitorRegistry(selectedTopic);
        const ids = registry.map((row) => row.id);
        const currentRange = { start, end };
        const [currentObservations, currentOwn] = await Promise.all([
          fetchObservations(ids, currentRange, location, llms),
          fetchOwnMetrics(currentRange, location, selectedTopic, llms),
        ]);
        const [previousObservations, previousOwn] = previousRange ? await Promise.all([
          fetchObservations(ids, previousRange, location, llms),
          fetchOwnMetrics(previousRange, location, selectedTopic, llms),
        ]) : [[], []] as [DirectObservation[], OwnMetric[]];
        if (cancelled) return;
        const domains = (project?.brand_domains ?? []).map((value: string) => hostFromUrl(value)).filter(Boolean);
        // Keep the full project registry here, but exclude the tracked brand itself.
        // The period-specific leaderboard below is derived from competitors with
        // at least one positive presence or citation observation in each date range.
        const filteredRegistry = registry.filter((row) => {
          const domain = row.normalized_domain || hostFromUrl(row.website);
          return domain && !domains.includes(domain) && row.brand_name.trim().toLocaleLowerCase() !== (project?.brand_name ?? "").trim().toLocaleLowerCase();
        });
        const eligibleIds = new Set(filteredRegistry.map((competitor) => competitor.id));
        setProjectName(project?.brand_name ?? "Tracked brand");
        setProjectWebsite(rootWebsite(project?.brand_domains?.[0] ?? null));
        setTopics((project?.topics ?? []).filter((value: string) => value && value !== "Overall"));
        setDirectCompetitors(filteredRegistry);
        setCurrentCompetitorObservations(currentObservations.filter((row) => eligibleIds.has(row.competitor_id)));
        setPreviousCompetitorObservations(previousObservations.filter((row) => eligibleIds.has(row.competitor_id)));
        setCurrentOwnMetrics(currentOwn);
        setPreviousOwnMetrics(previousOwn);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load leaderboard data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [projectId, start, end, topic, llms, previousRange]);

  // Match the Dashboard denominator: only count distinct direct competitors
  // observed during the selected period, location, topic, and engine filters.
  // Build the previous-period ranking from its own active set so rank deltas
  // compare like-for-like periods rather than today's registry against old data.
  const currentActiveCompetitors = useMemo(
    () => competitorsObservedInPeriod(directCompetitors, currentCompetitorObservations),
    [directCompetitors, currentCompetitorObservations],
  );
  const previousActiveCompetitors = useMemo(
    () => competitorsObservedInPeriod(directCompetitors, previousCompetitorObservations),
    [directCompetitors, previousCompetitorObservations],
  );
  const currentRows = useMemo(() => rankBrands([
    aggregateOwnRow(currentOwnMetrics, projectName, projectWebsite),
    ...aggregateCompetitorRows(currentActiveCompetitors, currentCompetitorObservations),
  ]), [projectName, projectWebsite, currentOwnMetrics, currentActiveCompetitors, currentCompetitorObservations]);
  const previousRows = useMemo(() => rankBrands([
    aggregateOwnRow(previousOwnMetrics, projectName, projectWebsite),
    ...aggregateCompetitorRows(previousActiveCompetitors, previousCompetitorObservations),
  ]), [projectName, projectWebsite, previousOwnMetrics, previousActiveCompetitors, previousCompetitorObservations]);
  const previousByKey = useMemo(() => new Map(previousRows.map((row) => [row.key, row])), [previousRows]);
  const rows: RankedBrand[] = currentRows.map((row) => {
    const previous = previousByKey.get(row.key);
    return { ...row, previousRank: previous?.rank ?? null, previousVisibility: previous?.visibility_score ?? null, previousCitations: previous?.citations ?? null };
  });
  const searchTerm = search.trim().toLocaleLowerCase();
  const searchResults = rows.filter((row) => [row.brand_name, brandDisplayName(row.brand_name, row.website), row.website ?? ""].some((value) => value.toLocaleLowerCase().includes(searchTerm)));
  const visibleRows = expanded ? searchResults : searchResults.slice(0, 10);

  return <ProjectShell><div className="ops-page">
    <p className="page-eyebrow">Competitive Landscape</p>
    <h2 className="page-title mt-1">Leaderboards</h2>
    <p className="page-description mt-2">See where {projectName} ranks against its tracked brand and direct competitors. Other brands mentioned in AI responses are excluded unless they are classified as direct competitors.</p>
    <div className="mt-8 ops-filter-panel">
      <div className="ops-filter-row"><span className="ops-filter-label">Period</span>{REPORTING_PERIODS.map((value) => <button key={value} onClick={() => setPeriod(value)} className={`ops-filter-btn ${period === value ? "is-active" : ""}`}>{value}</button>)}{period === "Custom" && <><label className="sr-only" htmlFor="period-start">Start date</label><input id="period-start" type="date" value={customStart} min={MIN_TRACKING_DATE} max={customEnd} onChange={(event) => setCustomStart(event.target.value)} className="platform-input max-w-[180px] text-xs" /><span className="text-xs font-semibold text-[var(--muted-foreground)]">to</span><label className="sr-only" htmlFor="period-end">End date</label><input id="period-end" type="date" value={customEnd} min={customStart || MIN_TRACKING_DATE} onChange={(event) => setCustomEnd(event.target.value)} className="platform-input max-w-[180px] text-xs" /></>}</div>
      <div className="ops-filter-row"><span className="ops-filter-label">Topic</span><button onClick={() => setTopic("All")} className={`ops-filter-pill ${topic === "All" ? "is-active" : ""}`}>All</button>{topics.map((value) => <button key={value} onClick={() => setTopic(value)} className={`ops-filter-pill ${topic === value ? "is-active" : ""}`}>{value}</button>)}</div>
      <div className="ops-filter-row"><span className="ops-filter-label">Engines</span>{LLMS.map((engine) => <button key={engine} onClick={() => setLlms((current) => current.includes(engine) ? current.filter((item) => item !== engine) : [...current, engine])} className={`ops-filter-pill ${llms.includes(engine) ? "is-active" : ""}`}>{labels[engine]}</button>)}</div>
    </div>
    {error && <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    <section className="mt-6 platform-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-semibold">Direct competitor rankings</h3><span className="text-sm text-[#66736c]">{searchResults.length.toLocaleString()} entries including tracked brand</span></div>
      <label className="mt-4 flex w-full max-w-xl items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 focus-within:border-[var(--green)]"><Search size={16} className="shrink-0 text-[#66736c]" aria-hidden="true" /><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setExpanded(false); }} placeholder="Search brand or website…" aria-label="Search brands" className="w-full bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[#87918b]" /></label>
      <div className="mt-4 overflow-x-auto"><table className="platform-table min-w-[980px]"><thead><tr className="border-b border-[var(--line)] text-xs uppercase tracking-[0.12em] text-[#66736c]">
        <th className="px-3 py-3 text-left">Rank</th><th className="px-3 py-3 text-left">Brand Name</th><th className="px-3 py-3 text-left">Website</th><th className="px-3 py-3 text-left">Visibility Score</th><th className="px-3 py-3 text-left">Number of Citations</th>
      </tr></thead><tbody>
        {loading ? <tr><td colSpan={5} className="px-3 py-10 text-center">Loading leaderboard…</td></tr> : visibleRows.map((row) => <tr key={row.key} className={`border-b border-[#eef0ee] ${row.key === "__tracked_brand__" ? "bg-[var(--accent)]/50" : ""}`}>
          <td className="whitespace-nowrap px-3 py-3"><span className="inline-flex items-center gap-1 font-semibold">{row.key === "__tracked_brand__" && currentActiveCompetitors.length > 0 && <Trophy size={14} className="text-[var(--green)]" />}{row.key === "__tracked_brand__" && currentActiveCompetitors.length === 0 ? "—" : row.rank}</span>{row.key === "__tracked_brand__" && currentActiveCompetitors.length === 0 ? <span className="ml-2 text-xs font-medium text-[#87918b]">No verified competitors</span> : row.previousRank === null && previousRange ? <span className="ml-2 text-xs font-medium text-[#87918b]">New</span> : <MetricChange value={row.previousRank === null ? null : row.previousRank - row.rank} lowerIsBetter />}</td>
          <td className="px-3 py-3 font-semibold">{brandDisplayName(row.brand_name, row.website)}{row.key === "__tracked_brand__" && <span className="ml-2 rounded-full bg-[var(--primary)]/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--primary)]">Your brand</span>}</td>
          <td className="max-w-[260px] px-3 py-3">{row.website ? <a href={row.website} target="_blank" rel="noreferrer" title={row.website} className="break-all text-[var(--green)] hover:underline">{row.website}</a> : "—"}</td>
          <td className="whitespace-nowrap px-3 py-3"><span className="font-semibold">{row.visibility_score.toFixed(1)}%</span><MetricChange value={row.previousVisibility === null ? null : row.visibility_score - row.previousVisibility} suffix=" pp" /></td>
          <td className="whitespace-nowrap px-3 py-3"><span className="font-semibold">{row.citations.toLocaleString()}</span><MetricChange value={row.previousCitations === null ? null : row.citations - row.previousCitations} /></td>
        </tr>)}
        {!loading && !searchResults.length && <tr><td colSpan={5} className="px-3 py-10 text-center text-sm text-[#66736c]">{searchTerm ? "No brands match your search." : "No tracked brand or direct competitors were found for the selected period and filters."}</td></tr>}
      </tbody></table></div>
      {!loading && searchResults.length > 10 && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4"><p className="text-sm text-[#66736c]">Showing {visibleRows.length.toLocaleString()} of {searchResults.length.toLocaleString()} entries</p><button type="button" onClick={() => setExpanded((value) => !value)} className="ops-filter-btn">{expanded ? "Show first 10" : `Show all ${searchResults.length.toLocaleString()} entries`}</button></div>}
      <p className="mt-4 text-xs text-[#87918b]">Only the tracked brand and the project's classified direct competitors are included. Rank is ordered by visibility score, with citation count as the tie-breaker. Changes compare against the preceding period of the same length.</p>
    </section>
  </div></ProjectShell>;
}
