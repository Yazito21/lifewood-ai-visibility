"use client";
// Build verification trigger: deploy the latest main revision.
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import { useParams } from "next/navigation";
import { ProjectShell } from "@/components/project-shell";
import { supabase } from "@/lib/supabase";

type Row = { metric_date: string; topic: string | null; llm_provider: string | null; url: string; page_name: string | null; brand_name: string | null; is_brand_related: boolean; frequency: number };
type AggregatedRow = { url: string; page_name: string | null; brand_name: string | null; frequency: number };
const LLMS = ["chatgpt", "gemini", "perplexity", "google_ai_overview", "claude"];
const labels: Record<string, string> = { chatgpt: "ChatGPT", gemini: "Gemini", perplexity: "Perplexity", google_ai_overview: "Google AI Overview", claude: "Claude" };

function CitationTable({ title, data }: { title: string; data: AggregatedRow[] }) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const filteredData = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    if (!term) return data;
    return data.filter((row) =>
      [row.url, row.page_name ?? "", row.brand_name ?? ""].some((value) =>
        value.toLocaleLowerCase().includes(term)
      )
    );
  }, [data, query]);
  const visibleData = expanded ? filteredData : filteredData.slice(0, 10);

  return (
    <section className="platform-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">{title}</h3>
        <span className="text-sm text-[#66736c]">{filteredData.length.toLocaleString()} {filteredData.length === 1 ? "page" : "pages"}</span>
      </div>
      <label className="mt-4 flex w-full max-w-xl items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 focus-within:border-[var(--green)]">
        <Search size={16} className="shrink-0 text-[#66736c]" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setExpanded(false); }}
          placeholder="Search by brand, page name, or URL…"
          aria-label={`Search ${title}`}
          className="w-full bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[#87918b]"
        />
      </label>
      <div className="mt-4 overflow-x-auto">
        <table className="platform-table min-w-[760px]">
          <thead><tr className="border-b border-[var(--line)] text-xs uppercase tracking-[0.12em] text-[#66736c]">
            <th className="px-3 py-3">No.</th><th className="px-3 py-3">Page</th><th className="px-3 py-3">Page Name</th><th className="px-3 py-3">Brand Name</th><th className="px-3 py-3">Frequency</th>
          </tr></thead>
          <tbody>
            {visibleData.map((row, index) => <tr key={row.url} className="border-b border-[#eef0ee]">
              <td className="px-3 py-3">{index + 1}</td>
              <td className="max-w-[380px] px-3 py-3"><a href={row.url} target="_blank" rel="noreferrer" title={row.url} className="inline-flex max-w-[360px] items-center gap-1 truncate font-semibold text-[var(--green)] hover:underline">{row.url}<ExternalLink size={13} className="shrink-0" /></a></td>
              <td className="px-3 py-3">{row.page_name || "—"}</td>
              <td className="px-3 py-3">{row.brand_name || "—"}</td>
              <td className="px-3 py-3 font-semibold">{row.frequency}</td>
            </tr>)}
            {!visibleData.length && <tr><td colSpan={5} className="px-3 py-10 text-center text-sm text-[#66736c]">{query.trim() ? "No pages match your search." : "No citations found."}</td></tr>}
          </tbody>
        </table>
      </div>
      {filteredData.length > 10 && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
        <p className="text-sm text-[#66736c]">Showing {visibleData.length.toLocaleString()} of {filteredData.length.toLocaleString()} pages</p>
        <button type="button" onClick={() => setExpanded((value) => !value)} className="ops-filter-btn">
          {expanded ? "Show first 10" : `Show all ${filteredData.length.toLocaleString()} pages`}
        </button>
      </div>}
    </section>
  );
}

export default function CitationsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [rows, setRows] = useState<Row[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [topic, setTopic] = useState("All");
  const [llms, setLlms] = useState<string[]>([]);
  const [period, setPeriod] = useState("Last 7 Days");
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
      const { data, error: fetchError } = await supabase.from("citations").select("metric_date,topic,llm_provider,url,page_name,brand_name,is_brand_related,frequency").eq("project_id", projectId).gte("metric_date", start).order("metric_date", { ascending: false });
      if (fetchError) setError(fetchError.message);
      setRows(data ?? []);
      setLoading(false);
    })();
  }, [projectId, start]);

  const filtered = rows.filter((row) => (topic === "All" || row.topic === topic) && (llms.length === 0 || llms.includes(row.llm_provider || "")));
  const aggregate = (brandOnly: boolean): AggregatedRow[] => {
    const map = new Map<string, AggregatedRow>();
    for (const row of filtered) {
      if (brandOnly && !row.is_brand_related) continue;
      const old = map.get(row.url);
      map.set(row.url, { url: row.url, page_name: row.page_name, brand_name: row.brand_name, frequency: (old?.frequency ?? 0) + row.frequency });
    }
    return [...map.values()].sort((a, b) => b.frequency - a.frequency);
  };
  const brandPages = aggregate(true);
  const allPages = aggregate(false);

  return <ProjectShell><div className="ops-page">
    <p className="page-eyebrow">Citations</p>
    <h2 className="page-title mt-1">Citation intelligence</h2>
    <p className="page-description mt-2">Every cited page extracted from the tracked AI responses.</p>
    <div className="mt-8 ops-filter-panel">
      <div className="ops-filter-row"><span className="ops-filter-label">Period</span>{["Today", "Last 2 Days", "Last 7 Days", "Last 14 Days", "Last 30 Days", "Last 90 Days", "All Time"].map((value) => <button key={value} onClick={() => setPeriod(value)} className={`ops-filter-btn ${period === value ? "is-active" : ""}`}>{value}</button>)}</div>
      <div className="ops-filter-row"><span className="ops-filter-label">Topic</span><button onClick={() => setTopic("All")} className={`ops-filter-pill ${topic === "All" ? "is-active" : ""}`}>All</button>{topics.map((value) => <button key={value} onClick={() => setTopic(value)} className={`ops-filter-pill ${topic === value ? "is-active" : ""}`}>{value}</button>)}</div>
      <div className="ops-filter-row"><span className="ops-filter-label">Engines</span>{LLMS.map((engine) => <button key={engine} onClick={() => setLlms((current) => current.includes(engine) ? current.filter((item) => item !== engine) : [...current, engine])} className={`ops-filter-pill ${llms.includes(engine) ? "is-active" : ""}`}>{labels[engine]}</button>)}</div>
    </div>
    {error && <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    <div className="mt-6 space-y-5">{loading ? <div className="h-80 animate-pulse platform-card" /> : <>
      <CitationTable title="Brand-related Pages" data={brandPages} />
      <CitationTable title="All Cited Pages" data={allPages} />
    </>}</div>
  </div></ProjectShell>;
}
