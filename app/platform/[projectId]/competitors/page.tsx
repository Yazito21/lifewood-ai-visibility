"use client";
import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useParams } from "next/navigation";
import { ProjectShell } from "@/components/project-shell";
import { TrackingDataScope } from "@/components/tracking-data-scope";
import { supabase } from "@/lib/supabase";
import { brandDisplayName } from "@/lib/brand-display";

type CompetitorRow = { brand_name: string; website: string | null; visibility_score: number | null; citations: number };
const LLMS = ["chatgpt", "gemini", "perplexity", "google_ai_overview", "claude"];
const labels: Record<string, string> = { chatgpt: "ChatGPT", gemini: "Gemini", perplexity: "Perplexity", google_ai_overview: "Google AI Overview", claude: "Claude" };
function localDateString(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

export default function CompetitorsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [aggregated, setAggregated] = useState<CompetitorRow[]>([]);
  const [trackingLocation, setTrackingLocation] = useState("MY");
  const [scope, setScope] = useState<"current" | "legacy">("current");
  const [topics, setTopics] = useState<string[]>([]);
  const [topic, setTopic] = useState("All");
  const [llms, setLlms] = useState<string[]>([]);
  const [period, setPeriod] = useState("Last 7 Days");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState(localDateString());
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const start = useMemo(() => {
    if (period === "Custom") return customStart || new Date().toISOString().slice(0, 10);
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    const days = period === "Today" ? 0 : period === "Last 2 Days" ? 1 : period === "Last 7 Days" ? 6 : period === "Last 14 Days" ? 13 : period === "Last 30 Days" ? 29 : period === "Last 90 Days" ? 89 : period === "All Time" ? 36500 : 6;
    date.setDate(date.getDate() - days);
    return localDateString(date);
  }, [period, customStart]);
  const end = period === "Custom" ? customEnd : localDateString();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      const { data: project, error: projectError } = await supabase.from("projects").select("topics,tracking_market").eq("id", projectId).single();
      const location = project?.tracking_market ?? "MY";
      const dataLocation = scope === "legacy" ? "LEGACY" : location;
      const allRows: CompetitorRow[] = [];
      let fetchError: { message: string } | null = null;
      for (let offset = 0; ; offset += 1000) {
        const { data: batch, error } = await supabase.rpc("get_cumulative_competitors", {
          p_project_id: projectId, p_start_date: start, p_end_date: end,
          p_topic: topic === "All" ? null : topic, p_engines: llms, p_tracking_location: dataLocation,
        }).range(offset, offset + 999);
        if (error) { fetchError = error; break; }
        const rows = (batch ?? []) as CompetitorRow[];
        allRows.push(...rows);
        if (rows.length < 1000) break;
      }
      if (cancelled) return;
      setTopics(project?.topics ?? []);
      setTrackingLocation(location);
      if (projectError || fetchError) setError((projectError || fetchError)?.message ?? "Unable to load competitor data.");
      setAggregated(allRows);
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [projectId, start, end, topic, llms, scope]);



  const searchTerm = search.trim().toLocaleLowerCase();
  const searchResults = aggregated.map((row) => ({
    ...row,
    displayName: brandDisplayName(row.brand_name, row.website),
  })).filter((row) =>
    [row.displayName, row.brand_name, row.website ?? ""].some((value) => value.toLocaleLowerCase().includes(searchTerm))
  );
  const visibleRows = expanded ? searchResults : searchResults.slice(0, 10);

  return <ProjectShell><div className="ops-page">
    <p className="page-eyebrow">Competitive Landscape</p>
    <h2 className="page-title mt-1">Direct Competitors</h2>
    <p className="page-description mt-2">Only direct competitors relevant to the tracked brand’s business line, deduplicated across the selected reporting period. Publishers, directories and unrelated businesses are excluded.</p>
    <TrackingDataScope trackingLocation={trackingLocation} scope={scope} onScopeChange={setScope} />
    <div className="mt-8 ops-filter-panel">
      <div className="ops-filter-row"><span className="ops-filter-label">Period</span>{["Today", "Last 2 Days", "Last 7 Days", "Last 14 Days", "Last 30 Days", "Last 90 Days", "All Time", "Custom"].map((value) => <button key={value} onClick={() => setPeriod(value)} className={`ops-filter-btn ${period === value ? "is-active" : ""}`}>{value}</button>)}{period === "Custom" && <><label className="sr-only" htmlFor="period-start">Start date</label><input id="period-start" type="date" value={customStart} max={customEnd} onChange={(event) => setCustomStart(event.target.value)} className="platform-input max-w-[180px] text-xs" /><span className="text-xs font-semibold text-[var(--muted-foreground)]">to</span><label className="sr-only" htmlFor="period-end">End date</label><input id="period-end" type="date" value={customEnd} min={customStart || undefined} onChange={(event) => setCustomEnd(event.target.value)} className="platform-input max-w-[180px] text-xs" /></>}
      </div>
      <div className="ops-filter-row"><span className="ops-filter-label">Topic</span><button onClick={() => setTopic("All")} className={`ops-filter-pill ${topic === "All" ? "is-active" : ""}`}>All</button>{topics.map((value) => <button key={value} onClick={() => setTopic(value)} className={`ops-filter-pill ${topic === value ? "is-active" : ""}`}>{value}</button>)}</div>
      <div className="ops-filter-row"><span className="ops-filter-label">Engines</span>{LLMS.map((engine) => <button key={engine} onClick={() => setLlms((current) => current.includes(engine) ? current.filter((item) => item !== engine) : [...current, engine])} className={`ops-filter-pill ${llms.includes(engine) ? "is-active" : ""}`}>{labels[engine]}</button>)}</div>
    </div>
    {error && <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    <section className="mt-6 platform-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">Direct competitors discovered</h3>
        <span className="text-sm text-[#66736c]">{searchResults.length.toLocaleString()} {searchResults.length === 1 ? "entry" : "entries"}</span>
      </div>
      <label className="mt-4 flex w-full max-w-xl items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 focus-within:border-[var(--green)]">
        <Search size={16} className="shrink-0 text-[#66736c]" aria-hidden="true" />
        <input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setExpanded(false); }} placeholder="Search competitor or website…" aria-label="Search direct competitors" className="w-full bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[#87918b]" />
      </label>
      <div className="mt-4 overflow-x-auto">
        <table className="platform-table min-w-[900px]">
          <thead><tr className="border-b border-[var(--line)] text-xs uppercase tracking-[0.12em] text-[#66736c]">
            <th className="px-3 py-3">No.</th><th className="px-3 py-3">Competitor</th><th className="px-3 py-3">Website</th><th className="px-3 py-3">Visibility Score</th><th className="px-3 py-3">Number of Citations</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={5} className="px-3 py-10 text-center">Loading…</td></tr> : visibleRows.map((row, index) => <tr key={row.website ?? row.brand_name} className="border-b border-[#eef0ee]">
              <td className="px-3 py-3">{index + 1}</td><td className="px-3 py-3 font-semibold">{row.displayName}</td>
              <td className="px-3 py-3">{row.website ? <a href={row.website} target="_blank" rel="noreferrer" title={row.website} className="break-all text-[var(--green)] hover:underline">{row.website}</a> : "—"}</td>
              <td className="px-3 py-3 font-semibold">{row.visibility_score != null ? row.visibility_score.toFixed(1) + "%" : "—"}</td><td className="px-3 py-3">{row.citations}</td>
            </tr>)}
            {!loading && !searchResults.length && <tr><td colSpan={6} className="px-3 py-10 text-center text-sm text-[#66736c]">{searchTerm ? "No competitors match your search." : "No direct competitors found for this period."}</td></tr>}
          </tbody>
        </table>
      </div>
      {!loading && searchResults.length > 10 && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
        <p className="text-sm text-[#66736c]">Showing {visibleRows.length.toLocaleString()} of {searchResults.length.toLocaleString()} entries</p>
        <button type="button" onClick={() => setExpanded((value) => !value)} className="ops-filter-btn">{expanded ? "Show first 10" : `Show all ${searchResults.length.toLocaleString()} entries`}</button>
      </div>}
    </section>
  </div></ProjectShell>;
}
