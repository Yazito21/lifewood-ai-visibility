"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Minus, Search } from "lucide-react";
import { useParams } from "next/navigation";
import { ProjectShell } from "@/components/project-shell";
import { TrackingDataScope } from "@/components/tracking-data-scope";
import { supabase } from "@/lib/supabase";
import { malaysiaDateString, shiftDateString } from "@/lib/reporting-date";
import { brandDisplayName } from "@/lib/brand-display";

type CompetitorSource = {
  metric_date: string;
  topic: string;
  llm_provider: string;
  brand_name: string | null;
  website: string | null;
  visibility_score: number | string | null;
  citation_count: number | null;
  tracking_location: string | null;
};
type CitationSource = {
  metric_date: string;
  topic: string;
  llm_provider: string;
  url: string;
  brand_name: string | null;
  frequency: number | null;
  tracking_location: string | null;
};
type BrandMetric = {
  key: string;
  brand_name: string;
  website: string | null;
  visibility_score: number | null;
  citations: number;
};
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

function hostFromUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const host = new URL(value.includes("://") ? value : "https://" + value).hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    return host || null;
  } catch { return null; }
}
function rootWebsite(value: string | null | undefined) {
  const host = hostFromUrl(value);
  return host ? "https://" + host : null;
}
function brandKey(name: string | null | undefined, website: string | null | undefined) {
  return hostFromUrl(website) ?? hostFromUrl(name) ?? (name ?? "").trim().toLocaleLowerCase();
}
function asNumber(value: number | string | null | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function ranked(rows: BrandMetric[]) {
  return [...rows].sort((a, b) => {
    if (a.visibility_score !== null && b.visibility_score !== null && a.visibility_score !== b.visibility_score) return b.visibility_score - a.visibility_score;
    if (a.visibility_score !== null && b.visibility_score === null) return -1;
    if (a.visibility_score === null && b.visibility_score !== null) return 1;
    return b.citations - a.citations || a.brand_name.localeCompare(b.brand_name);
  }).map((row, index) => ({ ...row, rank: index + 1 }));
}
function collectBrands(competitors: CompetitorSource[], citations: CitationSource[]) {
  const map = new Map<string, { brand_name: string; website: string | null; visibility: number[]; citations: number }>();
  function ensure(name: string | null | undefined, website: string | null | undefined) {
    const key = brandKey(name, website);
    if (!key) return null;
    let item = map.get(key);
    if (!item) {
      item = { brand_name: name?.trim() || hostFromUrl(website) || key, website: rootWebsite(website), visibility: [], citations: 0 };
      map.set(key, item);
    }
    if (name?.trim() && (!item.brand_name || name.trim().length > item.brand_name.length)) item.brand_name = name.trim();
    if (!item.website && website) item.website = rootWebsite(website);
    return item;
  }
  for (const row of competitors) {
    const item = ensure(row.brand_name, row.website);
    if (item && row.visibility_score !== null && row.visibility_score !== undefined) item.visibility.push(asNumber(row.visibility_score));
  }
  for (const row of citations) {
    const website = rootWebsite(row.url);
    const item = ensure(row.brand_name || hostFromUrl(website), website);
    if (item) item.citations += asNumber(row.frequency);
  }
  return [...map.entries()].map(([key, item]) => ({
    key,
    brand_name: item.brand_name,
    website: item.website,
    visibility_score: item.visibility.length ? item.visibility.reduce((sum, value) => sum + value, 0) / item.visibility.length : null,
    citations: item.citations,
  }));
}
function MetricChange({ value, suffix = "", lowerIsBetter = false }: { value: number | null; suffix?: string; lowerIsBetter?: boolean }) {
  if (value === null || !Number.isFinite(value)) return <span className="ml-2 text-xs font-medium text-[#87918b]">—</span>;
  if (Math.abs(value) < 0.0001) return <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-[#87918b]"><Minus size={12} /> 0{suffix}</span>;
  const positive = value > 0;
  const good = lowerIsBetter ? !positive : positive;
  return <span className={`ml-2 inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold ${good ? "text-emerald-700" : "text-rose-700"}`}>
    {positive ? <ArrowUp size={12} /> : <ArrowDown size={12} />}{Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}{suffix}
  </span>;
}
function periodStart(period: string, customStart: string) {
  const today = malaysiaDateString();
  if (period === "Custom") return customStart || today;
  const days = period === "Today" ? 0 : period === "Last 2 Days" ? 1 : period === "Last 7 Days" ? 6 : period === "Last 14 Days" ? 13 : period === "Last 30 Days" ? 29 : period === "Last 90 Days" ? 89 : period === "All Time" ? 36500 : 6;
  return shiftDateString(today, -days);
}

export default function LeaderboardsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [competitors, setCompetitors] = useState<CompetitorSource[]>([]);
  const [citations, setCitations] = useState<CitationSource[]>([]);
  const [previousCompetitors, setPreviousCompetitors] = useState<CompetitorSource[]>([]);
  const [previousCitations, setPreviousCitations] = useState<CitationSource[]>([]);
  const [trackingLocation, setTrackingLocation] = useState("MY");
  const [scope, setScope] = useState<"current" | "legacy">("current");
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

  const start = useMemo(() => periodStart(period, customStart), [period, customStart]);
  const end = period === "Custom" ? customEnd : malaysiaDateString();
  const previousRange = useMemo(() => {
    if (period === "All Time" || !start || !end || end < start) return null;
    const days = Math.round((Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / 86400000) + 1;
    const previousEnd = shiftDateString(start, -1);
    return { start: shiftDateString(previousEnd, -days + 1), end: previousEnd };
  }, [period, start, end]);

  useEffect(() => {
    let cancelled = false;
    async function fetchAll<T>(table: "competitors" | "citations", from: string, to: string, location: string, selectedTopic: string, engines: string[]) {
      if (!engines.length) return [] as T[];
      const all: T[] = [];
      for (let offset = 0; ; offset += 1000) {
        let query = supabase.from(table).select("*").eq("project_id", projectId).gte("metric_date", from).lte("metric_date", to).eq("tracking_location", location).in("llm_provider", engines).order("metric_date", { ascending: true }).range(offset, offset + 999);
        if (selectedTopic !== "All") query = query.eq("topic", selectedTopic);
        else if (table === "competitors") query = query.eq("topic", "Overall");
        const { data, error: queryError } = await query;
        if (queryError) throw queryError;
        const batch = (data ?? []) as unknown as T[];
        all.push(...batch);
        if (batch.length < 1000) break;
      }
      return all;
    }
    async function load() {
      setLoading(true);
      setError("");
      try {
        const { data: project, error: projectError } = await supabase.from("projects").select("topics,tracking_market").eq("id", projectId).single();
        if (projectError) throw projectError;
        const location = scope === "legacy" ? "LEGACY" : (project?.tracking_market ?? "MY");
        const current = await Promise.all([
          fetchAll<CompetitorSource>("competitors", start, end, location, topic, llms),
          fetchAll<CitationSource>("citations", start, end, location, topic, llms),
        ]);
        const previous = previousRange ? await Promise.all([
          fetchAll<CompetitorSource>("competitors", previousRange.start, previousRange.end, location, topic, llms),
          fetchAll<CitationSource>("citations", previousRange.start, previousRange.end, location, topic, llms),
        ]) : [[], []] as [CompetitorSource[], CitationSource[]];
        if (cancelled) return;
        setTopics((project?.topics ?? []).filter((value: string) => value && value !== "Overall"));
        setTrackingLocation(project?.tracking_market ?? "MY");
        setCompetitors(current[0]);
        setCitations(current[1]);
        setPreviousCompetitors(previous[0]);
        setPreviousCitations(previous[1]);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load leaderboard data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [projectId, start, end, topic, llms, scope, previousRange]);

  const currentRows = useMemo(() => ranked(collectBrands(competitors, citations)), [competitors, citations]);
  const previousRows = useMemo(() => ranked(collectBrands(previousCompetitors, previousCitations)), [previousCompetitors, previousCitations]);
  const previousByKey = useMemo(() => new Map(previousRows.map((row) => [row.key, row])), [previousRows]);
  const rows: RankedBrand[] = currentRows.map((row) => {
    const previous = previousByKey.get(row.key);
    return { ...row, previousRank: previous?.rank ?? null, previousVisibility: previous?.visibility_score ?? null, previousCitations: previous?.citations ?? null };
  });
  const searchTerm = search.trim().toLocaleLowerCase();
  const searchResults = rows.filter((row) => [row.brand_name, brandDisplayName(row.brand_name, row.website), row.website ?? ""].some((value) => value.toLocaleLowerCase().includes(searchTerm)));
  const visibleRows = expanded ? searchResults : searchResults.slice(0, 10);

  return <ProjectShell><div className="ops-page">
    <p className="page-eyebrow">Brand Performance</p>
    <h2 className="page-title mt-1">Leaderboards</h2>
    <p className="page-description mt-2">All brands mentioned in project responses and/or represented in cited pages, ranked by visibility score and then citation count. Changes compare with the immediately preceding period of the same length.</p>
    <TrackingDataScope trackingLocation={trackingLocation} scope={scope} onScopeChange={setScope} />
    <div className="mt-8 ops-filter-panel">
      <div className="ops-filter-row"><span className="ops-filter-label">Period</span>{["Today", "Last 2 Days", "Last 7 Days", "Last 14 Days", "Last 30 Days", "Last 90 Days", "All Time", "Custom"].map((value) => <button key={value} onClick={() => setPeriod(value)} className={`ops-filter-btn ${period === value ? "is-active" : ""}`}>{value}</button>)}{period === "Custom" && <><label className="sr-only" htmlFor="period-start">Start date</label><input id="period-start" type="date" value={customStart} max={customEnd} onChange={(event) => setCustomStart(event.target.value)} className="platform-input max-w-[180px] text-xs" /><span className="text-xs font-semibold text-[var(--muted-foreground)]">to</span><label className="sr-only" htmlFor="period-end">End date</label><input id="period-end" type="date" value={customEnd} min={customStart || undefined} onChange={(event) => setCustomEnd(event.target.value)} className="platform-input max-w-[180px] text-xs" /></>}</div>
      <div className="ops-filter-row"><span className="ops-filter-label">Topic</span><button onClick={() => setTopic("All")} className={`ops-filter-pill ${topic === "All" ? "is-active" : ""}`}>All</button>{topics.map((value) => <button key={value} onClick={() => setTopic(value)} className={`ops-filter-pill ${topic === value ? "is-active" : ""}`}>{value}</button>)}</div>
      <div className="ops-filter-row"><span className="ops-filter-label">Engines</span>{LLMS.map((engine) => <button key={engine} onClick={() => setLlms((current) => current.includes(engine) ? current.filter((item) => item !== engine) : [...current, engine])} className={`ops-filter-pill ${llms.includes(engine) ? "is-active" : ""}`}>{labels[engine]}</button>)}</div>
    </div>
    {error && <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    <section className="mt-6 platform-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-semibold">Brand rankings</h3><span className="text-sm text-[#66736c]">{searchResults.length.toLocaleString()} brands</span></div>
      <label className="mt-4 flex w-full max-w-xl items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 focus-within:border-[var(--green)]"><Search size={16} className="shrink-0 text-[#66736c]" aria-hidden="true" /><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setExpanded(false); }} placeholder="Search brand or website…" aria-label="Search brands" className="w-full bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[#87918b]" /></label>
      <div className="mt-4 overflow-x-auto"><table className="platform-table min-w-[1120px]"><thead><tr className="border-b border-[var(--line)] text-xs uppercase tracking-[0.12em] text-[#66736c]">
        <th className="px-3 py-3 text-left">Rank</th><th className="px-3 py-3 text-left">Brand Name</th><th className="px-3 py-3 text-left">Website</th><th className="px-3 py-3 text-left">Location (State, Country)</th><th className="px-3 py-3 text-left">Visibility Score</th><th className="px-3 py-3 text-left">Number of Citations</th>
      </tr></thead><tbody>
        {loading ? <tr><td colSpan={6} className="px-3 py-10 text-center">Loading leaderboard…</td></tr> : visibleRows.map((row) => <tr key={row.key} className="border-b border-[#eef0ee]">
          <td className="whitespace-nowrap px-3 py-3"><span className="font-semibold">{row.rank}</span>{row.previousRank === null && previousRange ? <span className="ml-2 text-xs font-medium text-[#87918b]">New</span> : <MetricChange value={row.previousRank === null ? null : row.previousRank - row.rank} lowerIsBetter />}</td>
          <td className="px-3 py-3 font-semibold">{brandDisplayName(row.brand_name, row.website)}</td>
          <td className="max-w-[260px] px-3 py-3">{row.website ? <a href={row.website} target="_blank" rel="noreferrer" title={row.website} className="break-all text-[var(--green)] hover:underline">{row.website}</a> : "—"}</td>
          <td className="px-3 py-3 text-sm text-[#66736c]">Not available</td>
          <td className="whitespace-nowrap px-3 py-3"><span className="font-semibold">{row.visibility_score === null ? "—" : row.visibility_score.toFixed(1) + "%"}</span><MetricChange value={row.visibility_score === null || row.previousVisibility === null ? null : row.visibility_score - row.previousVisibility} suffix=" pp" /></td>
          <td className="whitespace-nowrap px-3 py-3"><span className="font-semibold">{row.citations.toLocaleString()}</span><MetricChange value={row.previousCitations === null ? null : row.citations - row.previousCitations} /></td>
        </tr>)}
        {!loading && !searchResults.length && <tr><td colSpan={6} className="px-3 py-10 text-center text-sm text-[#66736c]">{searchTerm ? "No brands match your search." : "No brands were found for the selected period and filters."}</td></tr>}
      </tbody></table></div>
      {!loading && searchResults.length > 10 && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4"><p className="text-sm text-[#66736c]">Showing {visibleRows.length.toLocaleString()} of {searchResults.length.toLocaleString()} brands</p><button type="button" onClick={() => setExpanded((value) => !value)} className="ops-filter-btn">{expanded ? "Show first 10" : `Show all ${searchResults.length.toLocaleString()} brands`}</button></div>}
      <p className="mt-4 text-xs text-[#87918b]">Brand locations are not currently stored in the tracking database, so the location column is shown as Not available rather than guessing. Citation counts use the recorded cited-page frequencies; mention-only brands remain listed with zero citations.</p>
    </section>
  </div></ProjectShell>;
}
