"use client";
import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useParams } from "next/navigation";
import { ProjectShell } from "@/components/project-shell";
import { supabase } from "@/lib/supabase";

type Row = { metric_date: string; topic: string | null; llm_provider: string | null; brand_name: string; website: string | null; visibility_score: number | null; citation_count: number };
type CompetitorRow = { brand_name: string; website: string | null; visibility_score: number | null; citations: number };
const LLMS = ["chatgpt", "gemini", "perplexity", "google_ai_overview", "claude"];
const labels: Record<string, string> = { chatgpt: "ChatGPT", gemini: "Gemini", perplexity: "Perplexity", google_ai_overview: "Google AI Overview", claude: "Claude" };

export default function CompetitorsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [rows, setRows] = useState<Row[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [topic, setTopic] = useState("All");
  const [llms, setLlms] = useState<string[]>([]);
  const [period, setPeriod] = useState("Last 7 Days");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const start = useMemo(() => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    const days = period === "Today" ? 0 : period === "Last 2 Days" ? 1 : period === "Last 14 Days" ? 13 : period === "Last 30 Days" ? 29 : period === "Last 90 Days" ? 89 : period === "All Time" ? 3650 : 6;
    date.setDate(date.getDate() - days);
    return date.toISOString().slice(0, 10);
  }, [period]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      const { data: project } = await supabase.from("projects").select("topics").eq("id", projectId).single();
      setTopics(project?.topics ?? []);
      const { data, error: fetchError } = await supabase.from("competitors").select("metric_date,topic,llm_provider,brand_name,website,visibility_score,citation_count").eq("project_id", projectId).gte("metric_date", start).order("metric_date", { ascending: false });
      if (fetchError) setError(fetchError.message);
      setRows(data ?? []);
      setLoading(false);
    })();
  }, [projectId, start]);

  const filtered = rows.filter((row) => (topic === "All" || row.topic === topic) && (llms.length === 0 || llms.includes(row.llm_provider || "")));
  const aggregated = useMemo<CompetitorRow[]>(() => {
    const map = new Map<string, { brand_name: string; website: string | null; scores: number[]; citations: number }>();
    for (const row of filtered) {
      const existing = map.get(row.brand_name) || { brand_name: row.brand_name, website: row.website, scores: [], citations: 0 };
      if (row.visibility_score != null) existing.scores.push(row.visibility_score);
      existing.citations += row.citation_count;
      map.set(row.brand_name, existing);
    }
    return [...map.values()].map((item) => ({
      brand_name: item.brand_name,
      website: item.website,
      visibility_score: item.scores.length ? item.scores.reduce((sum, value) => sum + value, 0) / item.scores.length : null,
      citations: item.citations,
    })).sort((a, b) => (b.visibility_score ?? -1) - (a.visibility_score ?? -1));
  }, [rows, topic, llms]);

  const searchTerm = search.trim().toLocaleLowerCase();
  const searchResults = aggregated.filter((row) => [row.brand_name, row.website ?? ""].some((value) => value.toLocaleLowerCase().includes(searchTerm)));
  const visibleRows = expanded ? searchResults : searchResults.slice(0, 10);

  return <ProjectShell><div className="ops-page">
    <p className="page-eyebrow">Competitors</p>
    <h2 className="page-title mt-1">Competitor landscape</h2>
    <p className="page-description mt-2">Competitor brands extracted from tracked AI responses and ranked by visibility.</p>
    <div className="mt-8 ops-filter-panel">
      <div className="ops-filter-row"><span className="ops-filter-label">Period</span>{["Today", "Last 2 Days", "Last 7 Days", "Last 14 Days", "Last 30 Days", "Last 90 Days", "All Time"].map((value) => <button key={value} onClick={() => setPeriod(value)} className={`ops-filter-btn ${period === value ? "is-active" : ""}`}>{value}</button>)}</div>
      <div className="ops-filter-row"><span className="ops-filter-label">Topic</span><button onClick={() => setTopic("All")} className={`ops-filter-pill ${topic === "All" ? "is-active" : ""}`}>All</button>{topics.map((value) => <button key={value} onClick={() => setTopic(value)} className={`ops-filter-pill ${topic === value ? "is-active" : ""}`}>{value}</button>)}</div>
      <div className="ops-filter-row"><span className="ops-filter-label">Engines</span>{LLMS.map((engine) => <button key={engine} onClick={() => setLlms((current) => current.includes(engine) ? current.filter((item) => item !== engine) : [...current, engine])} className={`ops-filter-pill ${llms.includes(engine) ? "is-active" : ""}`}>{labels[engine]}</button>)}</div>
    </div>
    {error && <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    <section className="mt-6 platform-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">Competitor brands</h3>
        <span className="text-sm text-[#66736c]">{searchResults.length.toLocaleString()} {searchResults.length === 1 ? "brand" : "brands"}</span>
      </div>
      <label className="mt-4 flex w-full max-w-xl items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 focus-within:border-[var(--green)]">
        <Search size={16} className="shrink-0 text-[#66736c]" aria-hidden="true" />
        <input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setExpanded(false); }} placeholder="Search by brand or website…" aria-label="Search competitor brands" className="w-full bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[#87918b]" />
      </label>
      <div className="mt-4 overflow-x-auto">
        <table className="platform-table min-w-[760px]">
          <thead><tr className="border-b border-[var(--line)] text-xs uppercase tracking-[0.12em] text-[#66736c]">
            <th className="px-3 py-3">No.</th><th className="px-3 py-3">Brand</th><th className="px-3 py-3">Website</th><th className="px-3 py-3">Visibility Score</th><th className="px-3 py-3">Number of Citations</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={5} className="px-3 py-10 text-center">Loading…</td></tr> : visibleRows.map((row, index) => <tr key={row.brand_name} className="border-b border-[#eef0ee]">
              <td className="px-3 py-3">{index + 1}</td><td className="px-3 py-3 font-semibold">{row.brand_name}</td>
              <td className="px-3 py-3">{row.website ? <a href={row.website} target="_blank" rel="noreferrer" title={row.website} className="break-all text-[var(--green)] hover:underline">{row.website}</a> : "—"}</td>
              <td className="px-3 py-3 font-semibold">{row.visibility_score != null ? row.visibility_score.toFixed(1) + "%" : "—"}</td><td className="px-3 py-3">{row.citations}</td>
            </tr>)}
            {!loading && !searchResults.length && <tr><td colSpan={5} className="px-3 py-10 text-center text-sm text-[#66736c]">{searchTerm ? "No brands match your search." : "No competitor data found for this period."}</td></tr>}
          </tbody>
        </table>
      </div>
      {!loading && searchResults.length > 10 && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
        <p className="text-sm text-[#66736c]">Showing {visibleRows.length.toLocaleString()} of {searchResults.length.toLocaleString()} brands</p>
        <button type="button" onClick={() => setExpanded((value) => !value)} className="ops-filter-btn">{expanded ? "Show first 10" : `Show all ${searchResults.length.toLocaleString()} brands`}</button>
      </div>}
    </section>
  </div></ProjectShell>;
}
