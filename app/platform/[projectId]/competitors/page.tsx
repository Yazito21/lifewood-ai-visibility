"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Minus, Search, Trophy } from "lucide-react";
import { useParams } from "next/navigation";
import { ProjectShell } from "@/components/project-shell";
import { supabase } from "@/lib/supabase";
import { MIN_TRACKING_DATE, malaysiaDateString, shiftDateString, reportingDateRange, REPORTING_PERIODS } from "@/lib/reporting-date";
import { brandDisplayName } from "@/lib/brand-display";
import { MetricInfo } from "@/components/metric-info";
import { DownloadReportButton } from "@/components/download-report-button";
import { trackingLocationLabel } from "@/lib/tracking-locations";
import {
  loadCompetitorRegistry, loadPeriodScope, rankPeriod, rootWebsite,
  type BrandMetric, type DateRange, type DirectCompetitor, type DirectObservation, type OwnMetric,
} from "@/lib/leaderboard";

type RankedBrand = BrandMetric & {
  rank: number;
  previousRank: number | null;
  previousVisibility: number | null;
  previousCitations: number | null;
};
const LLMS = ["chatgpt", "gemini", "perplexity", "google_ai_overview", "claude"];
const labels: Record<string, string> = {
  chatgpt: "ChatGPT", gemini: "Gemini", perplexity: "Perplexity",
  google_ai_overview: "Google AI Overview", claude: "Claude",
};

function getPeriodStart(period: string, customStart: string, customEnd: string) { return reportingDateRange(period, customStart, customEnd).start; }
function MetricChange({ value, suffix = "", lowerIsBetter = false }: { value: number | null; suffix?: string; lowerIsBetter?: boolean }) {
  if (value === null || !Number.isFinite(value)) return <span className="ml-2 text-xs font-medium text-[#87918b]">N/A</span>;
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
  const [trackingMarket, setTrackingMarket] = useState("MY");
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState("All");
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
    async function load() {
      setLoading(true);
      setError("");
      try {
        const { data: project, error: projectError } = await supabase.from("projects")
          .select("brand_name,brand_domains,brand_terms,categories,tracking_market").eq("id", projectId).single();
        if (projectError) throw projectError;
        const location = project?.tracking_market ?? "MY";
        const selectedCategory = category === "All" ? "Overall" : category;
        const brandName = project?.brand_name ?? "";
        const brandDomains: string[] = project?.brand_domains ?? [];
        const filteredRegistry = await loadCompetitorRegistry(supabase, projectId, selectedCategory, brandName, brandDomains);
        const competitorIds = filteredRegistry.map((row) => row.id);
        const scopeArgs = { projectId, competitorIds, location, category: selectedCategory, engines: llms };
        const current = await loadPeriodScope(supabase, { ...scopeArgs, range: { start, end } });
        const previous = previousRange ? await loadPeriodScope(supabase, { ...scopeArgs, range: previousRange }) : { observations: [], own: [] };
        if (cancelled) return;
        setProjectName(project?.brand_name ?? "Tracked brand");
        setTrackingMarket(location);
        setProjectWebsite(rootWebsite(project?.brand_domains?.[0] ?? null));
        setCategories((project?.categories ?? []).filter((value: string) => value && value !== "Overall"));
        setDirectCompetitors(filteredRegistry);
        setCurrentCompetitorObservations(current.observations);
        setPreviousCompetitorObservations(previous.observations);
        setCurrentOwnMetrics(current.own);
        setPreviousOwnMetrics(previous.own);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load leaderboard data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [projectId, start, end, category, llms, previousRange]);

  // Match the Dashboard denominator: only count distinct direct competitors
  // observed during the selected period, location, category, and engine filters.
  // Build the previous-period ranking from its own active set so rank deltas
  // compare like-for-like periods rather than today's registry against old data.
  const currentRanking = useMemo(
    () => rankPeriod(directCompetitors, { observations: currentCompetitorObservations, own: currentOwnMetrics }, projectName, projectWebsite),
    [directCompetitors, currentCompetitorObservations, currentOwnMetrics, projectName, projectWebsite],
  );
  const previousRanking = useMemo(
    () => rankPeriod(directCompetitors, { observations: previousCompetitorObservations, own: previousOwnMetrics }, projectName, projectWebsite),
    [directCompetitors, previousCompetitorObservations, previousOwnMetrics, projectName, projectWebsite],
  );
  const currentActiveCompetitors = currentRanking.active;
  const currentRows = currentRanking.rows;
  const previousRows = previousRanking.rows;
  const previousByKey = useMemo(() => new Map(previousRows.map((row) => [row.key, row])), [previousRows]);
  const rows: RankedBrand[] = currentRows.map((row) => {
    const previous = previousByKey.get(row.key);
    return { ...row, previousRank: previous?.rank ?? null, previousVisibility: previous?.visibility_score ?? null, previousCitations: previous?.citations ?? null };
  });
  const searchTerm = search.trim().toLocaleLowerCase();
  const searchResults = rows.filter((row) => [row.brand_name, brandDisplayName(row.brand_name, row.website), row.website ?? ""].some((value) => value.toLocaleLowerCase().includes(searchTerm)));
  const visibleRows = expanded ? searchResults : searchResults.slice(0, 10);

  return <ProjectShell><div className="ops-page">
    <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 flex-1">
    <p className="page-eyebrow">Competitive Landscape</p>
    <h2 className="page-title mt-1">Leaderboards</h2>
    <p className="page-description mt-2">See how {projectName} stacks up against its direct competitors. Use the Period, Category and Engines filters to choose what to compare, and the leaderboard updates to match. You can search for a brand by name and expand the table to see every competitor. Only brands with valid results for your selection are ranked, and ties are broken by visibility, then citations, then name. The arrow beside each rank shows how it moved since the previous period, with green for an improvement and red for a drop.</p>
    </div>
    <DownloadReportButton disabled={loading} build={async () => {
      const { buildLeaderboardReport } = await import("@/lib/page-reports");
      const coverageNote = currentActiveCompetitors.length < directCompetitors.length
        ? "Competitor coverage: " + currentActiveCompetitors.length + " of " + directCompetitors.length + " registered direct competitors have verified observations for the selected scope. Missing or stale observations are excluded."
        : undefined;
      return buildLeaderboardReport({
        projectName, locationLabel: trackingLocationLabel(trackingMarket), period, start, end,
        categoryLabel: category === "All" ? "All categories" : category, engineLabels: llms.map((id) => labels[id] ?? id), totalEngines: LLMS.length, previousRange, coverageNote,
        rows: rows.map((row) => ({ rank: row.rank, brand_name: brandDisplayName(row.brand_name, row.website), website: row.website, isTracked: row.key === "__tracked_brand__", visibility_score: row.visibility_score, citations: row.citations, previousRank: row.previousRank, previousVisibility: row.previousVisibility, previousCitations: row.previousCitations })),
      });
    }} /></div>
    <div className="mt-8 ops-filter-panel">
      <div className="ops-filter-row"><span className="ops-filter-label">Period</span>{REPORTING_PERIODS.map((value) => <button key={value} onClick={() => setPeriod(value)} className={`ops-filter-btn ${period === value ? "is-active" : ""}`}>{value}</button>)}{period === "Custom" && <><label className="sr-only" htmlFor="period-start">Start date</label><input id="period-start" type="date" value={customStart} min={MIN_TRACKING_DATE} max={customEnd} onChange={(event) => setCustomStart(event.target.value)} className="platform-input max-w-[180px] text-xs" /><span className="text-xs font-semibold text-[var(--muted-foreground)]">to</span><label className="sr-only" htmlFor="period-end">End date</label><input id="period-end" type="date" value={customEnd} min={customStart || MIN_TRACKING_DATE} onChange={(event) => setCustomEnd(event.target.value)} className="platform-input max-w-[180px] text-xs" /></>}</div>
      <div className="ops-filter-row"><span className="ops-filter-label">Category</span><button onClick={() => setCategory("All")} className={`ops-filter-pill ${category === "All" ? "is-active" : ""}`}>All</button>{categories.map((value) => <button key={value} onClick={() => setCategory(value)} className={`ops-filter-pill ${category === value ? "is-active" : ""}`}>{value}</button>)}</div>
      <div className="ops-filter-row"><span className="ops-filter-label">Engines</span>{LLMS.map((engine) => <button key={engine} onClick={() => setLlms((current) => current.includes(engine) ? current.filter((item) => item !== engine) : [...current, engine])} className={`ops-filter-pill ${llms.includes(engine) ? "is-active" : ""}`}>{labels[engine]}</button>)}</div>
    </div>
    {error && <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    {!loading && currentActiveCompetitors.length < directCompetitors.length && <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Competitor coverage: {currentActiveCompetitors.length} of {directCompetitors.length} registered direct competitors have verified observations for the selected published date/category/engine/location scope. Missing or stale observations are excluded; no older-date fallback is used.</div>}
    <section className="mt-6 platform-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-semibold">Direct competitor rankings</h3><p className="mt-1 text-sm text-[#66736c]">Your brand and its competitors, ordered from the strongest visibility score to the weakest for the filters you chose.</p></div><span className="text-sm text-[#66736c]">{searchResults.length.toLocaleString()} entries including tracked brand</span></div>
      <label className="mt-4 flex w-full max-w-xl items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 focus-within:border-[var(--green)]"><Search size={16} className="shrink-0 text-[#66736c]" aria-hidden="true" /><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setExpanded(false); }} placeholder="Search brand or website…" aria-label="Search brands" className="w-full bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[#87918b]" /></label>
      <div className="mt-4 overflow-x-auto"><table className="platform-table min-w-[980px]"><thead><tr className="border-b border-[var(--line)] text-xs uppercase tracking-[0.12em] text-[#66736c]">
        <th className="px-3 py-3 text-left">Rank<MetricInfo metric="visibility_rank" /></th><th className="px-3 py-3 text-left">Brand Name</th><th className="px-3 py-3 text-left">Website</th><th className="px-3 py-3 text-left">Visibility Score<MetricInfo metric="visibility_score" /></th><th className="px-3 py-3 text-left">Citation Occurrences<MetricInfo metric="citation_occurrences" /></th>
      </tr></thead><tbody>
        {loading ? <tr><td colSpan={5} className="px-3 py-10 text-center">Loading leaderboard…</td></tr> : visibleRows.map((row) => <tr key={row.key} className={`border-b border-[#eef0ee] ${row.key === "__tracked_brand__" ? "bg-[var(--accent)]/50" : ""}`}>
          <td className="whitespace-nowrap px-3 py-3"><span className="inline-flex items-center gap-1 font-semibold">{row.key === "__tracked_brand__" && currentActiveCompetitors.length > 0 && <Trophy size={14} className="text-[var(--green)]" />}{row.key === "__tracked_brand__" && currentActiveCompetitors.length === 0 ? "N/A" : row.rank}</span>{row.key === "__tracked_brand__" && currentActiveCompetitors.length === 0 ? <span className="ml-2 text-xs font-medium text-[#87918b]">No verified competitors</span> : row.previousRank === null && previousRange ? <span className="ml-2 text-xs font-medium text-[#87918b]">New</span> : <MetricChange value={row.previousRank === null ? null : row.previousRank - row.rank} />}</td>
          <td className="px-3 py-3 font-semibold">{brandDisplayName(row.brand_name, row.website)}{row.key === "__tracked_brand__" && <span className="ml-2 rounded-full bg-[var(--primary)]/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--primary)]">Your brand</span>}</td>
          <td className="max-w-[260px] px-3 py-3">{row.website ? <a href={row.website} target="_blank" rel="noreferrer" title={row.website} className="break-all text-[var(--green)] hover:underline">{row.website}</a> : "N/A"}</td>
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
