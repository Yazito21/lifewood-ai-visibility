"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, ArrowDown, ArrowUp, Minus } from "lucide-react";
import { useParams } from "next/navigation";
import { ProjectShell } from "@/components/project-shell";
import { TrackingDataScope } from "@/components/tracking-data-scope";
import { supabase } from "@/lib/supabase";
import { malaysiaDateString, shiftDateString } from "@/lib/reporting-date";
import { brandDisplayName } from "@/lib/brand-display";

type Snapshot = {
  metric_date: string;
  topic: string;
  llm_provider: string;
  brand_name: string;
  website: string | null;
  visibility_score: number | string | null;
  citation_count: number | null;
  tracking_location: string;
};
type LeaderboardRow = {
  key: string;
  brand_name: string;
  website: string | null;
  location: string | null;
  visibility_score: number;
  citations: number;
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
const periods = ["Today", "Last 2 Days", "Last 7 Days", "Last 14 Days", "Last 30 Days", "Last 90 Days", "All Time", "Custom"];

function periodStart(period: string, customStart: string) {
  const today = malaysiaDateString();
  if (period === "Custom") return customStart || today;
  const days = period === "Today" ? 0 : period === "Last 2 Days" ? 1 : period === "Last 7 Days" ? 6 : period === "Last 14 Days" ? 13 : period === "Last 30 Days" ? 29 : period === "Last 90 Days" ? 89 : period === "All Time" ? 36500 : 6;
  return shiftDateString(today, -days);
}
function numeric(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function brandKey(row: Pick<Snapshot, "brand_name" | "website">) {
  const website = (row.website ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
  return website || row.brand_name.trim().toLowerCase();
}
function aggregateRows(rows: Snapshot[]) {
  const grouped = new Map<string, { brand_name: string; website: string | null; visibility: number[]; citations: number }>();
  for (const row of rows) {
    const key = brandKey(row);
    const existing = grouped.get(key) ?? {
      brand_name: row.brand_name,
      website: row.website,
      visibility: [],
      citations: 0,
    };
    if (row.brand_name.length > existing.brand_name.length) existing.brand_name = row.brand_name;
    if (!existing.website && row.website) existing.website = row.website;
    existing.visibility.push(numeric(row.visibility_score));
    existing.citations += numeric(row.citation_count);
    grouped.set(key, existing);
  }
  return new Map([...grouped.entries()].map(([key, value]) => [key, {
    key,
    brand_name: value.brand_name,
    website: value.website,
    location: null as string | null,
    visibility_score: value.visibility.length ? value.visibility.reduce((sum, score) => sum + score, 0) / value.visibility.length : 0,
    citations: value.citations,
  }]));
}
function rankRows(rows: ReturnType<typeof aggregateRows>) {
  return [...rows.values()].sort((a, b) =>
    b.visibility_score - a.visibility_score ||
    b.citations - a.citations ||
    a.brand_name.localeCompare(b.brand_name)
  ).map((row, index) => ({ ...row, rank: index + 1 }));
}
function Change({ value, suffix = "", invert = false }: { value: number | null; suffix?: string; invert?: boolean }) {
  if (value === null || !Number.isFinite(value)) return <span className="ml-2 text-xs font-medium text-[#87918b]">—</span>;
  if (Math.abs(value) < 0.0001) return <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-[#87918b]"><Minus size={12} /> 0{suffix}</span>;
  const positive = value > 0;
  const good = invert ? !positive : positive;
  return <span className={\`ml-2 inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold \${good ? "text-emerald-700" : "text-rose-700"}\`}>
    {positive ? <ArrowUp size={12} /> : <ArrowDown size={12} />}{Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}{suffix}
  </span>;
}

export default function LeaderboardPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
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
  const comparison = useMemo(() => {
    if (period === "All Time" || !start || !end || end < start) return null;
    const duration = Math.round((new Date(end + "T00:00:00Z").getTime() - new Date(start + "T00:00:00Z").getTime()) / 86400000) + 1;
    const previousEnd = shiftDateString(start, -1);
    return { start: shiftDateString(previousEnd, -(duration - 1)), end: previousEnd };
  }, [period, start, end]);

  useEffect(() => {
    let cancelled = false;
    async function fetchSnapshots(dataLocation: string, from: string, to: string, selectedTopic: string, engines: string[]) {
      const all: Snapshot[] = [];
      for (let offset = 0; ; offset += 1000) {
        let query = supabase.from("competitors")
          .select("metric_date,topic,llm_provider,brand_name,website,visibility_score,citation_count,tracking_location")
          .eq("project_id", projectId)
          .eq("tracking_location", dataLocation)
          .gte("metric_date", from)
          .lte("metric_date", to)
          .in("llm_provider", engines)
          .order("metric_date", { ascending: true })
          .range(offset, offset + 999);
        query = query.eq("topic", selectedTopic === "All" ? "Overall" : selectedTopic);
        const { data, error: queryError } = await query;
        if (queryError) throw queryError;
        const batch = (data ?? []) as Snapshot[];
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
        const location = project?.tracking_market ?? "MY";
        const dataLocation = scope === "legacy" ? "LEGACY" : location;
        if (!llms.length) {
          if (cancelled) return;
          setTopics(project?.topics ?? []);
          setTrackingLocation(location);
          setRows([]);
          setLoading(false);
          return;
        }
        const currentPromise = fetchSnapshots(dataLocation, start, end, topic, llms);
        const previousPromise = comparison
          ? fetchSnapshots(dataLocation, comparison.start, comparison.end, topic, llms)
          : Promise.resolve([] as Snapshot[]);
        const [currentSnapshots, previousSnapshots] = await Promise.all([currentPromise, previousPromise]);
        if (cancelled) return;
        const current = rankRows(aggregateRows(currentSnapshots));
        const previous = rankRows(aggregateRows(previousSnapshots));
        const previousByKey = new Map(previous.map((row) => [row.key, row]));
        setRows(current.map((row) => {
          const old = previousByKey.get(row.key);
          return {
            ...row,
            location: null,
            previousRank: old?.rank ?? null,
            previousVisibility: old?.visibility_score ?? null,
            previousCitations: old?.citations ?? null,
          };
        }));
        setTopics(project?.topics ?? []);
        setTrackingLocation(location);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load leaderboard data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [projectId, start, end, topic, llms, scope, comparison]);

  const searchTerm = search.trim().toLocaleLowerCase();
  const searchResults = rows.filter((row) =>
    [brandDisplayName(row.brand_name, row.website), row.brand_name, row.website ?? ""]
      .some((value) => value.toLocaleLowerCase().includes(searchTerm))
  );
  const visibleRows = expanded ? searchResults : searchResults.slice(0, 10);

  return <ProjectShell><div className="ops-page">
    <p className="page-eyebrow">Competitive Landscape</p>
    <h2 className="page-title mt-1">Brand Leaderboard</h2>
    <p className="page-description mt-2">Rank every brand and website detected in the selected AI-response dataset by visibility, with citation counts and changes against the previous equivalent period.</p>
    <TrackingDataScope trackingLocation={trackingLocation} scope={scope} onScopeChange={setScope} />
    <div className="mt-8 ops-filter-panel">
      <div className="ops-filter-row"><span className="ops-filter-label">Period</span>{periods.map((value) => <button key={value} onClick={() => setPeriod(value)} className={\`ops-filter-btn \${period === value ? "is-active" : ""}\`}>{value}</button>)}{period === "Custom" && <><label className="sr-only" htmlFor="period-start">Start date</label><input id="period-start" type="date" value={customStart} max={customEnd} onChange={(event) => setCustomStart(event.target.value)} className="platform-input max-w-[180px] text-xs" /><span className="text-xs font-semibold text-[var(--muted-foreground)]">to</span><label className="sr-only" htmlFor="period-end">End date</label><input id="period-end" type="date" value={customEnd} min={customStart || undefined} onChange={(event) => setCustomEnd(event.target.value)} className="platform-input max-w-[180px] text-xs" /></>}</div>
      <div className="ops-filter-row"><span className="ops-filter-label">Topic</span><button onClick={() => setTopic("All")} className={\`ops-filter-pill \${topic === "All" ? "is-active" : ""}\`}>All</button>{topics.map((value) => <button key={value} onClick={() => setTopic(value)} className={\`ops-filter-pill \${topic === value ? "is-active" : ""}\`}>{value}</button>)}</div>
      <div className="ops-filter-row"><span className="ops-filter-label">Engines</span>{LLMS.map((engine) => <button key={engine} onClick={() => setLlms((current) => current.includes(engine) ? current.filter((item) => item !== engine) : [...current, engine])} className={\`ops-filter-pill \${llms.includes(engine) ? "is-active" : ""}\`}>{labels[engine]}</button>)}</div>
    </div>
    {error && <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    <section className="mt-6 platform-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="text-lg font-semibold">Leaderboard rankings</h3><p className="mt-1 text-xs text-[#66736c]">Rank is ordered by visibility score, then citations. All-time results have no previous-period comparison.</p></div>
        <span className="text-sm text-[#66736c]">{searchResults.length.toLocaleString()} {searchResults.length === 1 ? "brand" : "brands"}</span>
      </div>
      <label className="mt-4 flex w-full max-w-xl items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 focus-within:border-[var(--green)]">
        <Search size={16} className="shrink-0 text-[#66736c]" aria-hidden="true" />
        <input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setExpanded(false); }} placeholder="Search brand or website…" aria-label="Search leaderboard" className="w-full bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[#87918b]" />
      </label>
      <div className="mt-4 overflow-x-auto">
        <table className="platform-table min-w-[1120px]">
          <thead><tr className="border-b border-[var(--line)] text-xs uppercase tracking-[0.12em] text-[#66736c]">
            <th className="px-3 py-3 text-left">Rank</th><th className="px-3 py-3 text-left">Brand Name</th><th className="px-3 py-3 text-left">Website</th><th className="px-3 py-3 text-left">Location (State, Country)</th><th className="px-3 py-3 text-left">Visibility Score</th><th className="px-3 py-3 text-left">Number of Citations</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={6} className="px-3 py-10 text-center">Loading leaderboard…</td></tr> : visibleRows.map((row) => {
              const rankChange = row.previousRank === null ? null : row.previousRank - row.rank;
              const visibilityChange = row.previousVisibility === null ? null : row.visibility_score - row.previousVisibility;
              const citationChange = row.previousCitations === null ? null : row.citations - row.previousCitations;
              return <tr key={row.key} className="border-b border-[#eef0ee]">
                <td className="whitespace-nowrap px-3 py-3"><span className="font-semibold">{row.rank}</span>{row.previousRank === null && comparison ? <span className="ml-2 text-xs font-medium text-[#87918b]">New</span> : <Change value={rankChange} suffix="" />}</td>
                <td className="px-3 py-3 font-semibold">{brandDisplayName(row.brand_name, row.website)}</td>
                <td className="max-w-[260px] px-3 py-3">{row.website ? <a href={row.website} target="_blank" rel="noreferrer" title={row.website} className="break-all text-[var(--green)] hover:underline">{row.website}</a> : "—"}</td>
                <td className="px-3 py-3 text-sm text-[#66736c]" title="Brand location is not included in the current tracking dataset">Not available</td>
                <td className="whitespace-nowrap px-3 py-3"><span className="font-semibold">{row.visibility_score.toFixed(1)}%</span><Change value={visibilityChange} suffix=" pp" /></td>
                <td className="whitespace-nowrap px-3 py-3"><span className="font-semibold">{row.citations.toLocaleString()}</span><Change value={citationChange} /></td>
              </tr>;
            })}
            {!loading && !searchResults.length && <tr><td colSpan={6} className="px-3 py-10 text-center text-sm text-[#66736c]">{searchTerm ? "No brands match your search." : "No brand data was found for the selected filters and period."}</td></tr>}
          </tbody>
        </table>
      </div>
      {!loading && searchResults.length > 10 && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
        <p className="text-sm text-[#66736c]">Showing {visibleRows.length.toLocaleString()} of {searchResults.length.toLocaleString()} brands</p>
        <button type="button" onClick={() => setExpanded((value) => !value)} className="ops-filter-btn">{expanded ? "Show first 10" : \`Show all \${searchResults.length.toLocaleString()} brands\`}</button>
      </div>}
      <p className="mt-4 text-xs text-[#87918b]">Brand locations are not currently captured in the source data, so they are shown as unavailable rather than guessed. Visibility is averaged across daily records and selected engines; citations are summed for the selected period.</p>
    </section>
  </div></ProjectShell>;
}
